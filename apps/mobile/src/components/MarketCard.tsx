import React, { memo, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme";
import { PredictionOddsPool, normalizeYesNoPercents } from "./PredictionOddsPool";

export interface MarketData {
  id: string;
  question: string;
  yesOdds: number;
  noOdds: number;
  yesPct?: number;
  noPct?: number;
  totalPoolSkr: number;
  totalStakers: number;
  deadlineAt: string;
  status: "active" | "resolved" | "cancelled";
  resolvedOutcome?: "yes" | "no";
  resolvedAt?: string;
  disputeFreeze?: boolean;
  pendingClaimableAt?: string | null;
  categoryTag?: string;
  myStake?: {
    side: "yes" | "no" | "mixed";
    amountSkr: number;
  };
}

export const QUICK_STAKE_AMOUNTS = [10, 50, 100, 500] as const;
export type QuickStakeAmount = typeof QUICK_STAKE_AMOUNTS[number];

interface MarketCardProps {
  market: MarketData;
  onStakeYes: () => void;
  onStakeNo: () => void;
  onQuickStake?: (side: "yes" | "no", amount: QuickStakeAmount) => void;
  onPress?: () => void;
  isHot?: boolean;
  index?: number;
  userBalance?: number;
  showQuickStake?: boolean;
  onCategoryPress?: (category: string) => void;
  nowMs?: number;
}

function formatTimeLeft(deadline: string, nowMs: number): { text: string; parts: { d: number; h: number; m: number } } {
  const end = new Date(deadline).getTime();
  const diff = end - nowMs;

  if (diff <= 0) return { text: "Ended", parts: { d: 0, h: 0, m: 0 } };

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return { text: `${days}d ${hours}h`, parts: { d: days, h: hours, m: mins } };
  return { text: `${hours}h ${mins}m`, parts: { d: 0, h: hours, m: mins } };
}

function oddsToPercent(yesOdds: number, noOdds: number, side: "yes" | "no"): number {
  const total = yesOdds + noOdds;
  if (total === 0) return 50;
  const raw = side === "yes" ? (noOdds / total) * 100 : (yesOdds / total) * 100;
  return Math.round(raw);
}

const YES_COLOR = "#14F195";
const NO_COLOR = "#FF3344";
const PURPLE = "#9945FF";
const AMBER = "#F59E0B";

function formatClaimableBadge(claimableAt: string | null | undefined, nowMs: number): string {
  if (claimableAt == null) {
    return "CLAIMABLE";
  }
  const target = new Date(claimableAt).getTime();
  if (!Number.isFinite(target)) {
    return "CLAIMABLE";
  }
  const remaining = target - nowMs;
  if (remaining <= 0) {
    return "CLAIMABLE";
  }
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) {
    return `CLAIM IN ${hours}H ${mins}M`;
  }
  return `CLAIM IN ${mins}M`;
}

function MarketCardComponent({
  market,
  onStakeYes,
  onStakeNo,
  onQuickStake,
  onPress,
  isHot,
  index = 0,
  userBalance = 0,
  showQuickStake = false,
  onCategoryPress,
  nowMs = Date.now(),
}: MarketCardProps) {
  const { palette } = useTheme();
  const styles = getStyles(palette);
  const yesScale = useRef(new Animated.Value(1)).current;
  const noScale = useRef(new Animated.Value(1)).current;

  const [selectedSide, setSelectedSide] = useState<"yes" | "no" | null>(null);
  const countdown = useMemo(() => formatTimeLeft(market.deadlineAt, nowMs), [market.deadlineAt, nowMs]);

  const isActive = market.status === "active";
  const isEnded = countdown.text === "Ended";
  const odds = normalizeYesNoPercents({
    yesPct: market.yesPct ?? oddsToPercent(market.yesOdds, market.noOdds, "yes"),
    noPct: market.noPct
  });
  const yesPercent = odds.yesPct;
  const noPercent = odds.noPct;

  const isFrozen = market.status === "resolved" && !!market.disputeFreeze;
  const claimStatus =
    market.pendingClaimableAt !== undefined
      ? formatClaimableBadge(market.pendingClaimableAt, nowMs)
      : null;
  const statusLabel = isFrozen
    ? "FROZEN"
    : claimStatus
      ? claimStatus
      : isActive
        ? "LIVE"
        : market.status.toUpperCase();
  const statusColor = isFrozen ? AMBER : claimStatus ? PURPLE : isActive ? YES_COLOR : palette.muted;

  const handleYesPress = () => {
    if (!isActive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(yesScale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.timing(yesScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    if (showQuickStake && onQuickStake) {
      setSelectedSide(selectedSide === "yes" ? null : "yes");
    } else {
      onStakeYes();
    }
  };

  const handleNoPress = () => {
    if (!isActive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(noScale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.timing(noScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    if (showQuickStake && onQuickStake) {
      setSelectedSide(selectedSide === "no" ? null : "no");
    } else {
      onStakeNo();
    }
  };

  const handleQuickStake = (amount: QuickStakeAmount) => {
    if (!selectedSide || !onQuickStake) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onQuickStake(selectedSide, amount);
  };

  const resolved = market.status === "resolved";
  const myStakeText = market.myStake
    ? market.myStake.side === "mixed"
      ? `\u2713 MIXED ${market.myStake.amountSkr} SKR`
      : `\u2713 ${market.myStake.side.toUpperCase()} ${market.myStake.amountSkr} SKR`
    : null;

  return (
    <Pressable
      style={[
        styles.card,
        isHot && styles.cardHot,
      ]}
      onPress={onPress}
    >
        {/* HOT badge row — own layout lane, right-aligned, above header */}
        {isHot && (
          <View style={styles.hotBadgeRow}>
            <View style={styles.hotBadge}>
              <Text style={styles.hotBadgeText}>HOT</Text>
            </View>
          </View>
        )}

        {/* Header row — LIVE status (left) | timer (right) */}
        <View style={styles.header}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={13} color={isEnded ? NO_COLOR : palette.muted} />
            <Text style={[styles.timerText, isEnded && { color: NO_COLOR }]}>
              {isActive
                ? isEnded
                  ? "Ended"
                  : `Ends in ${countdown.text}`
                : market.resolvedAt
                  ? new Date(market.resolvedAt).toLocaleDateString()
                  : "Closed"}
            </Text>
          </View>
        </View>

        {/* Question */}
        <Text style={[styles.question, isHot && styles.questionHot]} numberOfLines={3}>
          {market.question}
        </Text>

        {(market.categoryTag || myStakeText) && (
          <View style={styles.metaRow}>
            {market.categoryTag ? (
              <Pressable
                style={({ pressed }) => [styles.categoryBadge, pressed && { opacity: 0.75 }]}
                onPress={(event) => {
                  event.stopPropagation?.();
                  onCategoryPress?.(market.categoryTag!);
                }}
              >
                <Text style={styles.categoryBadgeText}>{market.categoryTag}</Text>
              </Pressable>
            ) : (
              <View />
            )}
            {myStakeText ? (
              <View style={[
                styles.myStakeBadge,
                market.myStake?.side === "yes"
                  ? { borderColor: `${YES_COLOR}40`, backgroundColor: `${YES_COLOR}10` }
                  : market.myStake?.side === "no"
                    ? { borderColor: `${NO_COLOR}40`, backgroundColor: `${NO_COLOR}10` }
                    : { borderColor: `${PURPLE}40`, backgroundColor: `${PURPLE}10` }
              ]}>
                <Text style={styles.myStakeBadgeText}>{myStakeText}</Text>
              </View>
            ) : null}
          </View>
        )}

        <PredictionOddsPool
          yesPct={yesPercent}
          noPct={noPercent}
          totalPoolSkr={market.totalPoolSkr}
          totalStakers={market.totalStakers}
        />

        {/* YES / NO buttons */}
        <View style={styles.buttonsRow}>
          <Animated.View style={[styles.buttonWrap, { transform: [{ scale: yesScale }] }]}>
            <Pressable
              style={[styles.voteButton, styles.yesButton, !isActive && styles.buttonDisabled]}
              onPress={handleYesPress}
              disabled={!isActive}
            >
              <View style={styles.buttonInner}>
                <Ionicons name="arrow-up-circle" size={18} color="#000000" />
                <Text style={styles.voteLabel}>YES</Text>
              </View>
              <Text style={styles.oddsPercent}>{yesPercent}%</Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={[styles.buttonWrap, { transform: [{ scale: noScale }] }]}>
            <Pressable
              style={[styles.voteButton, styles.noButton, !isActive && styles.buttonDisabled]}
              onPress={handleNoPress}
              disabled={!isActive}
            >
              <View style={styles.buttonInner}>
                <Ionicons name="arrow-down-circle" size={18} color="#FFFFFF" />
                <Text style={[styles.voteLabel, styles.voteLabelNo]}>NO</Text>
              </View>
              <Text style={[styles.oddsPercent, styles.oddsPercentNo]}>{noPercent}%</Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* Quick Stake Buttons */}
        {showQuickStake && selectedSide && isActive && (
          <View style={styles.quickStakeSection}>
            <View style={styles.quickStakeHeader}>
              <View style={[
                styles.quickStakeSideBadge,
                { backgroundColor: selectedSide === "yes" ? `${YES_COLOR}15` : `${NO_COLOR}15` }
              ]}>
                <Ionicons
                  name={selectedSide === "yes" ? "arrow-up" : "arrow-down"}
                  size={12}
                  color={selectedSide === "yes" ? YES_COLOR : NO_COLOR}
                />
                <Text style={[
                  styles.quickStakeSideText,
                  { color: selectedSide === "yes" ? YES_COLOR : NO_COLOR }
                ]}>
                  Quick Stake {selectedSide.toUpperCase()}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedSide(null)}
                hitSlop={10}
                style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              >
                <Ionicons name="close-circle" size={18} color={palette.muted} />
              </Pressable>
            </View>
            <View style={styles.quickStakeAmounts}>
              {QUICK_STAKE_AMOUNTS.map((amount) => {
                const disabled = amount > userBalance;
                const sideColor = selectedSide === "yes" ? YES_COLOR : NO_COLOR;
                return (
                  <Pressable
                    key={amount}
                    style={({ pressed }) => [
                      styles.quickStakeBtn,
                      { borderColor: disabled ? palette.line : `${sideColor}40` },
                      disabled && styles.quickStakeBtnDisabled,
                      pressed && !disabled && { backgroundColor: `${sideColor}15`, transform: [{ scale: 0.96 }] },
                    ]}
                    onPress={() => handleQuickStake(amount)}
                    disabled={disabled}
                  >
                    <Text style={[
                      styles.quickStakeBtnText,
                      { color: disabled ? palette.muted : sideColor },
                    ]}>
                      {amount}
                    </Text>
                    <Text style={[styles.quickStakeBtnUnit, { color: disabled ? palette.muted : palette.ink }]}>
                      SKR
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {userBalance > 0 && (
              <Text style={styles.quickStakeBalance}>
                Balance: {userBalance.toLocaleString()} SKR
              </Text>
            )}
          </View>
        )}

        {/* Resolved overlay */}
        {resolved && market.resolvedOutcome && (
          <View style={styles.resolvedBanner}>
            <Text style={styles.resolvedText}>
              Resolved: {market.resolvedOutcome.toUpperCase()}
            </Text>
          </View>
        )}
    </Pressable>
  );
}

export const MarketCard = memo(MarketCardComponent);

const getStyles = (palette: any) =>
  StyleSheet.create({
    card: {
      backgroundColor: palette.milk,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 16,
      marginBottom: 12,
      overflow: "hidden",
    },
    cardHot: {
      borderColor: "#14F19540",
      borderWidth: 1.5,
      shadowColor: "#14F195",
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    // HOT badge: sits in its own full-width row, right-aligned
    hotBadgeRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: 8,
    },
    hotBadge: {
      backgroundColor: "#FF6B35",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
    },
    hotBadgeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.8,
      color: "#FFFFFF",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: palette.muted,
    },
    statusDotLive: {
      backgroundColor: "#14F195",
    },
    statusDotResolved: {
      backgroundColor: "#9945FF",
    },
    statusLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.8,
      color: palette.muted,
    },
    statusLabelLive: {
      color: "#14F195",
    },
    timerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    timerText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    question: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 16,
      lineHeight: 22,
      color: palette.coal,
      marginBottom: 14,
    },
    questionHot: {
      fontSize: 18,
      lineHeight: 24,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 10,
    },
    categoryBadge: {
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      backgroundColor: `${PURPLE}14`,
      borderWidth: 1,
      borderColor: `${PURPLE}35`,
    },
    categoryBadgeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.5,
      color: PURPLE,
      textTransform: "uppercase",
    },
    myStakeBadge: {
      marginLeft: "auto",
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderWidth: 1,
    },
    myStakeBadgeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.3,
      color: palette.coal,
    },
    buttonsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 8,
    },
    buttonWrap: {
      flex: 1,
    },
    voteButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
    },
    yesButton: {
      backgroundColor: "#14F195",
    },
    noButton: {
      backgroundColor: "#FF3344",
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonInner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    voteLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      letterSpacing: 0.5,
      color: "#000000",
    },
    voteLabelNo: {
      color: "#FFFFFF",
    },
    oddsPercent: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: "#000000",
    },
    oddsPercentNo: {
      color: "#FFFFFF",
    },
    resolvedBanner: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: "#9945FFDD",
      paddingVertical: 6,
      alignItems: "center",
    },
    resolvedText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      letterSpacing: 0.5,
      color: "#FFFFFF",
    },
    // Quick stake styles
    quickStakeSection: {
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: palette.line,
    },
    quickStakeHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    quickStakeSideBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
    },
    quickStakeSideText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.3,
    },
    quickStakeAmounts: {
      flexDirection: "row",
      gap: 8,
    },
    quickStakeBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1.5,
      backgroundColor: "transparent",
    },
    quickStakeBtnDisabled: {
      opacity: 0.4,
    },
    quickStakeBtnText: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 16,
    },
    quickStakeBtnUnit: {
      fontFamily: "Manrope_500Medium",
      fontSize: 9,
      letterSpacing: 0.5,
      marginTop: 1,
    },
    quickStakeBalance: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      textAlign: "center",
      marginTop: 8,
    },
  });
