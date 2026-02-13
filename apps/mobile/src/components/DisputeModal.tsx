import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { radii, spacing, useTheme } from "../theme";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";
import {
  prepareSkrTransferInstructions,
  buildTransactionWithFreshBlockhash,
  waitForSignatureConfirmation,
  DEFAULT_SKR_MINT
} from "../services/splTransfer";
import { getWalletAdapter } from "../wallet/createWalletAdapter";
import {
  createPredictionDisputeIntent,
  fetchPredictionById,
  friendlyError,
  submitDispute,
  fetchDisputeStatus,
  type DisputeStatus
} from "../services/api";

interface DisputeModalProps {
  visible: boolean;
  onClose: () => void;
  pollId: string;
  question: string;
  resolvedOutcome: "yes" | "no";
  resolvedAt: string;
  platformWallet: string;
  challengeWindowHours?: number;
  disputeDepositSkr?: number;
  onSuccess?: () => void;
}

const DEFAULT_DISPUTE_DEPOSIT_SKR = 50;
const DEFAULT_CHALLENGE_WINDOW_HOURS = 48;
const MIN_REASON_LENGTH = 10;

function formatTimeRemaining(resolvedAt: string, challengeWindowHours: number): { text: string; expired: boolean } {
  const resolvedTime = new Date(resolvedAt).getTime();
  const deadlineTime = resolvedTime + challengeWindowHours * 60 * 60 * 1000;
  const now = Date.now();
  const remaining = deadlineTime - now;

  if (remaining <= 0) {
    return { text: "Challenge window expired", expired: true };
  }

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return { text: `${hours}h ${minutes}m remaining`, expired: false };
  }
  return { text: `${minutes}m remaining`, expired: false };
}

export function DisputeModal({
  visible,
  onClose,
  pollId,
  question,
  resolvedOutcome,
  resolvedAt,
  platformWallet,
  challengeWindowHours = DEFAULT_CHALLENGE_WINDOW_HOURS,
  disputeDepositSkr = DEFAULT_DISPUTE_DEPOSIT_SKR,
  onSuccess,
}: DisputeModalProps) {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => getStyles(palette, isDark), [palette, isDark]);
  const { session } = useSession();
  const { showToast } = useToast();

  const [reason, setReason] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(
    formatTimeRemaining(resolvedAt, challengeWindowHours)
  );
  const [submittedDispute, setSubmittedDispute] = useState<DisputeStatus | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Countdown timer update every minute
  useEffect(() => {
    if (!visible) return;

    setCountdown(formatTimeRemaining(resolvedAt, challengeWindowHours));
    const interval = setInterval(() => {
      setCountdown(formatTimeRemaining(resolvedAt, challengeWindowHours));
    }, 60_000);

    return () => clearInterval(interval);
  }, [visible, resolvedAt, challengeWindowHours]);

  // Pulse animation for countdown when urgent (< 2 hours)
  useEffect(() => {
    if (!visible || countdown.expired) return;

    const remaining = new Date(resolvedAt).getTime() + challengeWindowHours * 60 * 60 * 1000 - Date.now();
    const hoursRemaining = remaining / (60 * 60 * 1000);

    if (hoursRemaining < 2) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [visible, countdown.expired, resolvedAt, pulseAnim, challengeWindowHours]);

  useEffect(() => {
    if (!visible || !session.walletAddress || !session.sessionToken) {
      return;
    }

    let cancelled = false;
    const loadExistingDispute = async () => {
      try {
        setIsRefreshingStatus(true);
        const existing = await fetchDisputeStatus({
          pollId,
          wallet: session.walletAddress,
          sessionToken: session.sessionToken,
        });
        if (!cancelled) {
          setSubmittedDispute(existing ?? null);
        }
      } catch {
        // keep current local state on transient status lookup failures
      } finally {
        if (!cancelled) {
          setIsRefreshingStatus(false);
        }
      }
    };

    void loadExistingDispute();
    return () => {
      cancelled = true;
    };
  }, [visible, pollId, session.walletAddress, session.sessionToken]);

  useEffect(() => {
    if (
      !visible ||
      !submittedDispute ||
      !session.walletAddress ||
      !session.sessionToken ||
      (submittedDispute.status !== "pending" && submittedDispute.status !== "investigating")
    ) {
      return;
    }

    let cancelled = false;
    const refreshStatus = async () => {
      try {
        setIsRefreshingStatus(true);
        const latest = await fetchDisputeStatus({
          pollId,
          wallet: session.walletAddress,
          sessionToken: session.sessionToken
        });
        if (!cancelled && latest) {
          setSubmittedDispute(latest);
        }
      } catch {
        // Status refresh is best-effort.
      } finally {
        if (!cancelled) {
          setIsRefreshingStatus(false);
        }
      }
    };

    void refreshStatus();
    const interval = setInterval(() => {
      void refreshStatus();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, submittedDispute?.id, submittedDispute?.status, session.walletAddress, session.sessionToken, pollId]);

  const isReasonValid = reason.trim().length >= MIN_REASON_LENGTH;
  const canSubmit = isReasonValid && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !session.walletAddress || !session.sessionToken) return;

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Prevent duplicate disputes (and duplicate deposits) for the same market/wallet.
      let existing: DisputeStatus | null = null;
      try {
        existing = await fetchDisputeStatus({
          pollId,
          wallet: session.walletAddress,
          sessionToken: session.sessionToken,
        });
      } catch {
        // Preflight is best-effort; proceed and let server enforce uniqueness.
      }
      if (existing) {
        setSubmittedDispute(existing);
        showToast("You already filed a dispute for this market.", "info");
        return;
      }

      const freshMarket = await fetchPredictionById(pollId, session.walletAddress, session.sessionToken);
      if (freshMarket.status !== "resolved") {
        showToast("This market can no longer be disputed", "error");
        return;
      }
      if (!freshMarket.resolvedAt) {
        showToast("Resolution timestamp unavailable. Please try again.", "error");
        return;
      }

      const reservation = await createPredictionDisputeIntent({
        pollId,
        wallet: session.walletAddress,
        sessionToken: session.sessionToken,
      });

      // Build SKR transfer instructions + validate balances.
      // Use reservation.depositSkr (server-authoritative) rather than the prop default
      // so the on-chain amount always matches what the backend expects.
      const { instructions, payer } = await prepareSkrTransferInstructions({
        fromWallet: session.walletAddress,
        toWallet: platformWallet,
        amountUi: reservation.depositSkr,
        skrMint: DEFAULT_SKR_MINT,
      });

      // Sign and send via MWA — prefer buildAndSendTransaction for fresh blockhash
      const adapter = getWalletAdapter();
      let txSignature: string;
      if (adapter.buildAndSendTransaction) {
        txSignature = await adapter.buildAndSendTransaction(instructions, payer);
      } else {
        const tx = await buildTransactionWithFreshBlockhash(instructions, payer);
        if (adapter.sendVersionedTransaction) {
          txSignature = await adapter.sendVersionedTransaction(tx as any);
        } else {
          txSignature = await adapter.sendTransaction(tx as any);
        }
      }

      try {
        await waitForSignatureConfirmation({
          signature: txSignature,
          timeoutMs: 30_000
        });
      } catch (confirmError) {
        if (confirmError instanceof Error && confirmError.message === "transaction_failed") {
          throw confirmError;
        }
        // Backend verification retries transaction lookup; continue if local confirmation lags.
        console.warn("[DisputeModal] Deposit confirmation timeout, proceeding...", confirmError);
      }

      // Submit dispute to API
      const response = await submitDispute({
        pollId,
        wallet: session.walletAddress,
        reason: reason.trim(),
        evidenceUrls: evidenceUrls.trim() ? evidenceUrls.trim().split(/[\s,]+/).filter(Boolean) : [],
        depositTxSignature: txSignature,
        sessionToken: session.sessionToken,
        paymentIntentId: reservation.paymentIntentId,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Dispute submitted successfully", "success");
      setSubmittedDispute({
        id: response.disputeId,
        pollId,
        wallet: session.walletAddress,
        status: "pending",
        challengeDeadline: response.challengeDeadline,
        createdAt: new Date().toISOString()
      });
      onSuccess?.();
    } catch (error) {
      showToast(friendlyError(error, "Failed to submit dispute"), "error");
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, session, platformWallet, disputeDepositSkr, reason, evidenceUrls, showToast, onSuccess, pollId]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setReason("");
    setEvidenceUrls("");
    // Do NOT reset submittedDispute — prevents flash of deposit form on reopen
    // which could let a user trigger a duplicate on-chain deposit before preflight reloads
    onClose();
  }, [isSubmitting, onClose]);

  const outcomeColor = resolvedOutcome === "yes" ? "#14F195" : "#FF3344";
  const statusColor = submittedDispute?.status === "upheld"
    ? "#14F195"
    : submittedDispute?.status === "rejected" || submittedDispute?.status === "expired"
      ? "#FF3344"
      : "#F59E0B";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.sheet}
      >
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="shield-checkmark" size={22} color="#F59E0B" />
          </View>
          <Text style={styles.headerTitle}>File Dispute</Text>
        </View>

        {submittedDispute ? (
          <>
            <View style={styles.statusCard}>
              <Text style={styles.statusTitle}>Dispute Filed</Text>
              <Text style={styles.statusBody}>
                Your dispute is under review. Payouts stay frozen until this dispute is resolved.
              </Text>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Status</Text>
                <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
                  <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                    {submittedDispute.status.toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Dispute ID</Text>
                <Text style={styles.statusValue}>{submittedDispute.id.slice(0, 8)}...</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Deadline</Text>
                <Text style={styles.statusValue}>{new Date(submittedDispute.challengeDeadline).toLocaleString()}</Text>
              </View>
              {isRefreshingStatus && (
                <View style={styles.statusRefreshRow}>
                  <ActivityIndicator size="small" color={palette.muted} />
                  <Text style={styles.statusRefreshText}>Refreshing status…</Text>
                </View>
              )}
            </View>

            <Pressable style={styles.submitBtn} onPress={handleClose}>
              <Ionicons name="checkmark-circle" size={18} color="#000000" />
              <Text style={styles.submitText}>Done</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Countdown Timer */}
            <Animated.View style={[styles.countdownBanner, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.countdownIcon}>
                <Ionicons
                  name={countdown.expired ? "alert-circle" : "time-outline"}
                  size={16}
                  color={countdown.expired ? "#FF3344" : "#F59E0B"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.countdownLabel}>Challenge Window</Text>
                <Text style={[styles.countdownText, countdown.expired && { color: "#FF3344" }]}>
                  {countdown.text}
                </Text>
              </View>
            </Animated.View>
            {countdown.expired && (
              <Text style={styles.expiredWarning}>
                Device clock says the window expired. Submission is still allowed and server time is authoritative.
              </Text>
            )}

            {/* Question & Outcome */}
            <View style={styles.questionBox}>
              <Text style={styles.questionLabel}>RESOLVED PREDICTION</Text>
              <Text style={styles.questionText} numberOfLines={2}>
                {question}
              </Text>
              <View style={styles.outcomeRow}>
                <Text style={styles.outcomeLabel}>Outcome:</Text>
                <View style={[styles.outcomeBadge, { backgroundColor: `${outcomeColor}20` }]}>
                  <Text style={[styles.outcomeText, { color: outcomeColor }]}>
                    {resolvedOutcome.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            {/* Reason Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Reason for dispute <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[styles.textArea, !isReasonValid && reason.length > 0 && styles.inputError]}
                placeholder="Explain why you believe the resolution is incorrect (min 10 characters)"
                placeholderTextColor={palette.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={reason}
                onChangeText={setReason}
                editable={!isSubmitting}
                maxLength={500}
              />
              <Text style={styles.charCount}>
                {reason.length}/500 {!isReasonValid && reason.length > 0 && `(min ${MIN_REASON_LENGTH})`}
              </Text>
            </View>

            {/* Evidence URLs (optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Evidence URLs <Text style={styles.optional}>(optional)</Text>
              </Text>
              <TextInput
                style={styles.urlInput}
                placeholder="Links to news articles, on-chain data, etc."
                placeholderTextColor={palette.muted}
                value={evidenceUrls}
                onChangeText={setEvidenceUrls}
                editable={!isSubmitting}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            {/* Deposit Notice */}
            <View style={styles.depositNotice}>
              <Ionicons name="wallet-outline" size={16} color="#F59E0B" />
              <Text style={styles.depositText}>
                <Text style={styles.depositAmount}>{disputeDepositSkr} SKR</Text> deposit required.
                Refunded if dispute is successful.
              </Text>
            </View>

            {/* Submit Button */}
            <Pressable
              style={[
                styles.submitBtn,
                !canSubmit && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={18} color={canSubmit ? "#000000" : palette.muted} />
                  <Text style={[styles.submitText, !canSubmit && { color: palette.muted }]}>
                    {`Submit Dispute (${disputeDepositSkr} SKR)`}
                  </Text>
                </>
              )}
            </Pressable>

            {/* Disclaimer */}
            <Text style={styles.disclaimer}>
              Disputes are reviewed by the resolution committee. False disputes may result in deposit forfeiture.
            </Text>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (palette: Record<string, string>, isDark: boolean) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
    },
    sheet: {
      backgroundColor: palette.milk,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxl + spacing.lg,
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: palette.line,
      alignSelf: "center",
      marginBottom: spacing.lg,
    },

    // Header
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    headerIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: "rgba(245, 158, 11, 0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 22,
      color: palette.coal,
    },

    // Countdown
    countdownBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: isDark ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.1)",
      borderWidth: 1,
      borderColor: "rgba(245, 158, 11, 0.25)",
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    countdownIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: "rgba(245, 158, 11, 0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    countdownLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      letterSpacing: 0.5,
    },
    countdownText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 15,
      color: "#F59E0B",
      marginTop: 2,
    },
    expiredWarning: {
      marginTop: -spacing.md,
      marginBottom: spacing.md,
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: "#FF3344",
      lineHeight: 16,
    },

    // Submitted status view
    statusCard: {
      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      gap: spacing.sm,
    },
    statusTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: palette.coal,
    },
    statusBody: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
      lineHeight: 18,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    statusLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    statusValue: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      color: palette.coal,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.5,
    },
    statusRefreshRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    statusRefreshText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },

    // Question box
    questionBox: {
      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    questionLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 1,
      color: palette.muted,
      marginBottom: spacing.xs,
    },
    questionText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      lineHeight: 20,
      color: palette.coal,
      marginBottom: spacing.sm,
    },
    outcomeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    outcomeLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    outcomeBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
    },
    outcomeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.5,
    },

    // Input groups
    inputGroup: {
      marginBottom: spacing.md,
    },
    inputLabel: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 13,
      color: palette.coal,
      marginBottom: spacing.xs,
    },
    required: {
      color: "#FF3344",
    },
    optional: {
      fontFamily: "Manrope_500Medium",
      color: palette.muted,
    },
    textArea: {
      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.coal,
      minHeight: 100,
    },
    inputError: {
      borderColor: "#FF3344",
    },
    charCount: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      textAlign: "right",
      marginTop: 4,
    },
    urlInput: {
      backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.coal,
      height: 44,
    },

    // Deposit notice
    depositNotice: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: "rgba(245, 158, 11, 0.08)",
      borderRadius: radii.sm,
      padding: spacing.sm,
      marginBottom: spacing.lg,
    },
    depositText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      flex: 1,
    },
    depositAmount: {
      fontFamily: "Manrope_700Bold",
      color: "#F59E0B",
    },

    // Submit button
    submitBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: "#F59E0B",
      height: 52,
      borderRadius: radii.md,
      marginBottom: spacing.sm,
    },
    submitBtnDisabled: {
      backgroundColor: palette.line,
    },
    submitText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      letterSpacing: 0.3,
      color: "#000000",
    },

    // Disclaimer
    disclaimer: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      textAlign: "center",
      lineHeight: 16,
    },
  });
