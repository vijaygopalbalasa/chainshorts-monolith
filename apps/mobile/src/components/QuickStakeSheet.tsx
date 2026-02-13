import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
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
import { useTheme } from "../theme";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";
import { createPredictionStakeIntent, fetchPredictionById, stakeOnPrediction, friendlyError } from "../services/api";
import {
  prepareSkrTransferInstructions,
  buildTransactionWithFreshBlockhash,
  waitForSignatureConfirmation,
  DEFAULT_SKR_MINT
} from "../services/splTransfer";
import { getWalletAdapter } from "../wallet/createWalletAdapter";

interface QuickStakeSheetProps {
  visible: boolean;
  onClose: () => void;
  pollId: string;
  side: "yes" | "no";
  odds: number;
  userBalance: number;
  platformWallet: string;
  minStakeSkr?: number;
  maxStakeSkr?: number;
  onSuccess?: (stakedAmount: number, txSignature?: string) => void;
  onNavigateToSwap?: () => void;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];
const PURPLE = "#9945FF";
const CYAN = "#00CFFF";
type StakeFlowStage = "idle" | "awaiting_wallet" | "confirming_chain" | "verifying_payment" | "confirmed" | "failed";

export function QuickStakeSheet({
  visible,
  onClose,
  pollId,
  side,
  odds,
  userBalance,
  platformWallet,
  minStakeSkr = 10,
  maxStakeSkr = 999_999_999,
  onSuccess,
  onNavigateToSwap,
}: QuickStakeSheetProps) {
  const { palette } = useTheme();
  const { session } = useSession();
  const { showToast } = useToast();
  const styles = getStyles(palette);

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [noSkrAccount, setNoSkrAccount] = useState(false);
  const [stakeStage, setStakeStage] = useState<StakeFlowStage>("idle");
  const maxAmountLength = Math.max(1, String(Math.max(0, Math.floor(maxStakeSkr))).length);

  const effectiveAmount = isCustomMode ? (parseInt(customAmount, 10) || 0) : (selectedAmount ?? 0);
  const potentialWin = effectiveAmount ? Math.round(effectiveAmount * odds * 1_000_000) / 1_000_000 : 0;

  const handleQuickAmount = (amount: number) => {
    setIsCustomMode(false);
    setCustomAmount("");
    setSelectedAmount(amount);
  };

  const handleCustomFocus = () => {
    setIsCustomMode(true);
    setSelectedAmount(null);
  };

  const handleCustomChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, "");
    setCustomAmount(cleaned);
    setIsCustomMode(true);
    setSelectedAmount(null);
  };

  const handleStake = useCallback(async () => {
    const amount = isCustomMode ? (parseInt(customAmount, 10) || 0) : selectedAmount;
    if (!amount || amount <= 0 || !session.walletAddress || !session.sessionToken) {
      return;
    }
    if (amount < minStakeSkr) {
      showToast(`Minimum stake is ${minStakeSkr} SKR`, "error");
      return;
    }
    if (amount > maxStakeSkr) {
      showToast(`Maximum stake is ${maxStakeSkr} SKR`, "error");
      return;
    }
    if (amount > userBalance) {
      showToast("Insufficient SKR balance", "error");
      return;
    }
    if (!platformWallet) {
      showToast("Platform wallet not configured", "error");
      return;
    }

    Keyboard.dismiss();
    setIsStaking(true);
    setStakeStage("awaiting_wallet");
    try {
      const freshMarket = await fetchPredictionById(pollId, session.walletAddress, session.sessionToken);
      if (freshMarket.status !== "active") {
        showToast("This market is no longer active", "error");
        setStakeStage("failed");
        return;
      }
      if (freshMarket.deadlineAt && new Date(freshMarket.deadlineAt).getTime() <= Date.now()) {
        showToast("This market has already closed", "error");
        setStakeStage("failed");
        return;
      }
      if (amount < freshMarket.minStakeSkr) {
        showToast(`Minimum stake is ${freshMarket.minStakeSkr} SKR`, "error");
        setStakeStage("failed");
        return;
      }
      if (amount > freshMarket.maxStakeSkr) {
        showToast(`Maximum stake is ${freshMarket.maxStakeSkr} SKR`, "error");
        setStakeStage("failed");
        return;
      }

      const reservation = await createPredictionStakeIntent({
        pollId,
        wallet: session.walletAddress,
        side,
        amountSkr: amount,
        sessionToken: session.sessionToken,
      });

      // Step 1: Prepare transfer instructions + validate balances (RPC calls happen here)
      const { instructions, payer } = await prepareSkrTransferInstructions({
        fromWallet: session.walletAddress,
        toWallet: platformWallet,
        amountUi: amount,
        skrMint: DEFAULT_SKR_MINT,
      });

      // Step 2: Sign and send via MWA
      // Prefer buildAndSendTransaction — it fetches a FRESH blockhash INSIDE
      // the MWA session after authorization, preventing blockhash staleness
      // during Seed Vault's user review period (30-60s).
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

      // Wait for confirmation before API verification so backend RPC can parse balances.
      setStakeStage("confirming_chain");
      try {
        await waitForSignatureConfirmation({
          signature: txSignature,
          timeoutMs: 30_000
        });
      } catch (e) {
        if (e instanceof Error && e.message === "transaction_failed") {
          throw e;
        }
        console.warn("[QuickStakeSheet] Error confirming transaction, proceeding anyway...", e);
      }

      // Small delay before API call. The backend retries 4x with 1+2+3s backoff
      // if Helius hasn't indexed the confirmed tx yet, so 1s head start is enough.
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Record stake on API
      setStakeStage("verifying_payment");
      await stakeOnPrediction({

        pollId,
        wallet: session.walletAddress,
        side,
        amountSkr: amount,
        txSignature,
        sessionToken: session.sessionToken,
        paymentIntentId: reservation.paymentIntentId,
      });

      setStakeStage("confirmed");
      showToast(`Staked ${amount} SKR on ${side.toUpperCase()}!`, "success");
      onSuccess?.(amount, txSignature);
      onClose();
    } catch (error) {
      setStakeStage("failed");
      // Log error for debugging - use warn for expected user actions, error for unexpected issues
      const errMsg = error instanceof Error ? error.message : String(error);
      const errLower = errMsg.toLowerCase();
      const isCancellation = errLower.includes("cancellationexception") || errLower.includes("cancelled") || errLower.includes("canceled");

      if (isCancellation) {
        console.warn("[QuickStakeSheet] User cancelled transaction");
      } else {
        console.warn("[QuickStakeSheet] Stake error:", errMsg);
      }

      // Show user-friendly toast messages for all error types
      if (errMsg.includes("do not have an SKR token account") || errMsg.includes("Receive SKR first")) {
        // User has no SKR ATA - show helpful UI to guide them to swap
        setNoSkrAccount(true);
      } else if (isCancellation) {
        showToast("Transaction cancelled by wallet", "info");
      } else if (errLower.includes("rejected") || errLower.includes("denied")) {
        showToast("Transaction rejected by wallet", "error");
      } else if (errLower.includes("timeout") || errLower.includes("timed out")) {
        showToast("Wallet connection timed out — try again", "error");
      } else if (errLower.includes("insufficient")) {
        showToast("Insufficient SKR balance", "error");
      } else if (errLower.includes("transaction_not_found") || errLower.includes("transaction not found")) {
        showToast("Transaction not confirmed — try again", "error");
      } else if (errLower.includes("invalid_payment") || errLower.includes("invalid payment")) {
        showToast("Payment verification failed", "error");
      } else if (errLower.includes("simulation") || errLower.includes("simulate") || errLower.includes("simulated")) {
        showToast("Transaction failed — check SOL balance for fees", "error");
      } else if (errLower.includes("connection") || errLower.includes("network") || errLower.includes("fetch")) {
        showToast("Network error — check your connection", "error");
      } else if (errMsg.includes("WalletAdapter") || errMsg.includes("MobileWalletAdapter")) {
        showToast("Wallet connection failed — try again", "error");
      } else {
        showToast(friendlyError(error, "Stake failed"), "error");
      }
    } finally {
      setIsStaking(false);
    }
  }, [
    selectedAmount,
    customAmount,
    isCustomMode,
    session,
    pollId,
    side,
    platformWallet,
    minStakeSkr,
    maxStakeSkr,
    userBalance,
    showToast,
    onSuccess,
    onClose
  ]);

  const sideColor = side === "yes" ? "#22C55E" : "#EF4444";
  const sideLabel = side.toUpperCase();

  const handleGoToSwap = () => {
    onClose();
    onNavigateToSwap?.();
  };

  // Reset noSkrAccount state when modal opens
  // Also show "Get SKR" UI immediately if user has 0 balance
  React.useEffect(() => {
    if (visible) {
      // If user has 0 SKR balance, show the "Get SKR" UI immediately
      setNoSkrAccount(userBalance === 0);
      setStakeStage("idle");
      // Reset selection state so a previously selected amount from a different
      // market/side doesn't persist and pre-fill a stake on the new one.
      setSelectedAmount(null);
      setCustomAmount("");
      setIsCustomMode(false);
    }
  }, [visible, userBalance]);

  const stageMeta: Record<StakeFlowStage, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
    idle: { label: "", icon: "ellipse-outline", color: palette.muted },
    awaiting_wallet: { label: "Awaiting wallet approval", icon: "phone-portrait-outline", color: sideColor },
    confirming_chain: { label: "Confirming on-chain", icon: "git-network-outline", color: PURPLE },
    verifying_payment: { label: "Verifying payment", icon: "shield-checkmark-outline", color: CYAN },
    confirmed: { label: "Stake confirmed", icon: "checkmark-circle", color: "#22C55E" },
    failed: { label: "Verification failed — retry", icon: "alert-circle", color: "#EF4444" }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!isStaking) {
          onClose();
        }
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!isStaking) {
              onClose();
            }
          }}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* No SKR Account State - Guide user to swap */}
          {noSkrAccount ? (
            <View style={styles.noSkrContainer}>
              <Ionicons name="wallet-outline" size={48} color={palette.ember} />
              <Text style={styles.noSkrTitle}>No SKR Tokens Yet</Text>
              <Text style={styles.noSkrDescription}>
                To stake on predictions, you need SKR tokens in your wallet.
                Swap some SOL or USDC for SKR to get started.
              </Text>
              <Pressable style={styles.swapButton} onPress={handleGoToSwap}>
                <Ionicons name="swap-horizontal" size={18} color="#000" />
                <Text style={styles.swapButtonText}>GET SKR TOKENS</Text>
              </Pressable>
              <Pressable style={styles.dismissLink} onPress={onClose}>
                <Text style={styles.dismissLinkText}>Maybe later</Text>
              </Pressable>
            </View>
          ) : (
            <>
        <Text style={styles.title}>
          Stake on{" "}
          <Text style={{ color: sideColor }}>{sideLabel}</Text>
          {" "}({odds.toFixed(2)}x)
        </Text>

        <Text style={styles.limitsHint}>
          Min {minStakeSkr} SKR · Max {maxStakeSkr} SKR
        </Text>

        {stakeStage !== "idle" && (
          <View style={[styles.stageRow, { borderColor: `${stageMeta[stakeStage].color}40`, backgroundColor: `${stageMeta[stakeStage].color}12` }]}>
            {isStaking ? (
              <ActivityIndicator size="small" color={stageMeta[stakeStage].color} />
            ) : (
              <Ionicons name={stageMeta[stakeStage].icon} size={14} color={stageMeta[stakeStage].color} />
            )}
            <Text style={[styles.stageText, { color: stageMeta[stakeStage].color }]}>
              {stageMeta[stakeStage].label}
            </Text>
          </View>
        )}

        <View style={styles.amountsRow}>
          {QUICK_AMOUNTS.map((amount) => {
            const isSelected = !isCustomMode && selectedAmount === amount;
            const isDisabled = amount > userBalance || amount < minStakeSkr;
            return (
              <Pressable
                key={amount}
                style={[
                  styles.amountBtn,
                  isSelected && { borderColor: sideColor, backgroundColor: `${sideColor}15` },
                  isDisabled && styles.amountBtnDisabled,
                ]}
                onPress={() => !isDisabled && handleQuickAmount(amount)}
                disabled={isDisabled}
              >
                <Text
                  style={[
                    styles.amountText,
                    isSelected && { color: sideColor },
                    isDisabled && styles.amountTextDisabled,
                  ]}
                >
                  {amount}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Custom amount input */}
        <View style={styles.customRow}>
          <Text style={styles.customLabel}>Custom amount:</Text>
          <View style={[
            styles.customInputWrap,
            isCustomMode && { borderColor: sideColor },
          ]}>
            <TextInput
              style={styles.customInput}
              placeholder="Enter SKR"
              placeholderTextColor={palette.muted}
              keyboardType="number-pad"
              value={customAmount}
              onFocus={handleCustomFocus}
              onChangeText={handleCustomChange}
              maxLength={maxAmountLength}
            />
            <Text style={styles.customSuffix}>SKR</Text>
          </View>
        </View>

        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Your balance:</Text>
          <Text style={styles.balanceValue}>{userBalance.toLocaleString()} SKR</Text>
        </View>

        {effectiveAmount > 0 && (
          <View style={styles.potentialRow}>
            <Text style={styles.potentialLabel}>Potential win:</Text>
            <Text style={[styles.potentialValue, { color: sideColor }]}>
              {potentialWin.toLocaleString()} SKR ({odds.toFixed(2)}x)
            </Text>
          </View>
        )}

        <Pressable
          style={[
            styles.confirmBtn,
            { backgroundColor: sideColor },
            (!effectiveAmount || effectiveAmount < minStakeSkr || effectiveAmount > maxStakeSkr || effectiveAmount > userBalance || isStaking) && styles.confirmBtnDisabled,
          ]}
          onPress={handleStake}
          disabled={!effectiveAmount || effectiveAmount < minStakeSkr || effectiveAmount > maxStakeSkr || effectiveAmount > userBalance || isStaking}
        >
          {isStaking ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.confirmText}>
              {effectiveAmount && effectiveAmount > 0
                ? effectiveAmount > userBalance
                  ? "Insufficient balance"
                  : effectiveAmount > maxStakeSkr
                    ? `Max ${maxStakeSkr} SKR allowed`
                  : effectiveAmount < minStakeSkr
                    ? `Min ${minStakeSkr} SKR required`
                    : `STAKE ${effectiveAmount} SKR on ${sideLabel}`
                : `Select amount (min ${minStakeSkr} SKR)`}
            </Text>
          )}
        </Pressable>

        <Text style={styles.disclaimer}>
          5% platform fee from losing pool {"\u2022"} Cashout at 5% penalty
        </Text>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (palette: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
    },
    sheet: {
      backgroundColor: palette.milk,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 40,
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: palette.line,
      alignSelf: "center",
      marginBottom: 16,
    },
    title: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      color: palette.coal,
      marginBottom: 6,
    },
    limitsHint: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      marginBottom: 16,
    },
    stageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: -8,
      marginBottom: 14,
    },
    stageText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      letterSpacing: 0.2,
    },
    amountsRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 20,
    },
    amountBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: palette.line,
      alignItems: "center",
      backgroundColor: palette.parchment,
    },
    amountBtnDisabled: {
      opacity: 0.4,
    },
    amountText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: palette.coal,
    },
    amountTextDisabled: {
      color: palette.muted,
    },
    customRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    customLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
    },
    customInputWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1.5,
      borderColor: palette.line,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: palette.parchment,
      minWidth: 140,
    },
    customInput: {
      flex: 1,
      fontFamily: "Manrope_700Bold",
      fontSize: 16,
      color: palette.coal,
      padding: 0,
      minWidth: 60,
    },
    customSuffix: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      marginLeft: 6,
    },
    balanceRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    balanceLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
    },
    balanceValue: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: palette.coal,
    },
    potentialRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 20,
    },
    potentialLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
    },
    potentialValue: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
    },
    confirmBtn: {
      height: 52,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    confirmBtnDisabled: {
      opacity: 0.5,
    },
    confirmText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      letterSpacing: 0.5,
      color: "#FFFFFF",
    },
    disclaimer: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      textAlign: "center",
    },
    // No SKR Account state
    noSkrContainer: {
      alignItems: "center",
      paddingVertical: 20,
    },
    noSkrTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      color: palette.coal,
      marginTop: 16,
      marginBottom: 8,
    },
    noSkrDescription: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.muted,
      textAlign: "center",
      lineHeight: 22,
      marginBottom: 24,
      paddingHorizontal: 12,
    },
    swapButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: "#14F195",
      paddingVertical: 16,
      paddingHorizontal: 32,
      borderRadius: 12,
      width: "100%",
      marginBottom: 12,
    },
    swapButtonText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: "#000",
      letterSpacing: 0.5,
    },
    dismissLink: {
      padding: 12,
    },
    dismissLinkText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
      textDecorationLine: "underline",
    },
  });
