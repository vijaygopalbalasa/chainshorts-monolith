import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { elevation, radii, spacing, textStyles, useTheme } from "../theme";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";
import { DisputeModal } from "../components/DisputeModal";
import {
  fetchUserPredictionStakes,
  fetchClientConfig,
  claimPredictionPayout,
  cashOutPredictionStake,
  friendlyError,
  type PredictionUserPortfolio,
  type PredictionStake,
  type PredictionPayout,
} from "../services/api";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------- Types ----------
interface ResolutionDetails {
  outcome: "yes" | "no";
  resolvedAt: string;
  consensus: "3/3" | "2/3" | "manual"; // internal only — mapped to user-friendly labels below
  agentAgreement: number; // internal confidence — shown as "verification confidence" to users
  evidenceSources: Array<{ title: string; url: string }>;
  reason?: string;
}

/** Map internal consensus codes to user-facing labels (never reveal AI/agent details) */
function getVerificationLabel(consensus: ResolutionDetails["consensus"]): { label: string; level: "high" | "medium" | "review" } {
  switch (consensus) {
    case "3/3": return { label: "High confidence", level: "high" };
    case "2/3": return { label: "Majority verified", level: "medium" };
    case "manual": return { label: "Admin verified", level: "review" };
    default: return { label: "Verified", level: "high" };
  }
}

type ActiveStake = PredictionStake & {
  poll: {
    id: string;
    question: string;
    status: string;
    deadlineAt?: string;
  };
  potentialPayout: number;
};
type ResolvedStake = PredictionStake & {
  poll: {
    id: string;
    question: string;
    status: string;
    resolvedOutcome?: "yes" | "no";
    resolvedAt?: string;
  };
  payout?: PredictionPayout;
  resolution?: ResolutionDetails;
};
type PortfolioStake = ActiveStake | ResolvedStake;

// ---------- Constants ----------
const ACCENT = "#14F195";
const PROFIT = "#14F195";
const LOSS = "#FF3344";
const ACTIVE_CYAN = "#00CFFF";
const PURPLE = "#9945FF";
const AMBER = "#F59E0B";
const FILTER_KEYS = ["active", "won", "lost", "all"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

// ---------- Helpers ----------
/** Format SKR amount with up to 6 decimal places, stripping trailing zeros */
function fmtSkr(amount: number): string {
  return parseFloat(amount.toFixed(6)).toString();
}

function formatTimeLeft(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  return `${hours}h ${mins}m left`;
}

function isDisputeWindowOpen(resolvedAt: string | undefined, challengeWindowHours: number): boolean {
  if (!resolvedAt) return false;
  const resolvedTime = new Date(resolvedAt).getTime();
  const deadline = resolvedTime + challengeWindowHours * 60 * 60 * 1000;
  return Date.now() < deadline;
}

function formatDisputeTimeRemaining(resolvedAt: string, challengeWindowHours: number): string {
  const resolvedTime = new Date(resolvedAt).getTime();
  const deadline = resolvedTime + challengeWindowHours * 60 * 60 * 1000;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function getClaimableTimestamp(payout?: PredictionPayout): number {
  if (!payout?.claimableAt) {
    return 0;
  }
  const parsed = new Date(payout.claimableAt).getTime();
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function isPayoutClaimable(payout: PredictionPayout | undefined, nowMs: number): boolean {
  if (!payout) return false; // no payout record yet — not claimable
  // claimableAt === null/undefined: cancelled-market refund — immediately claimable
  if (!payout.claimableAt) return true;
  const ts = getClaimableTimestamp(payout);
  return ts > 0 && ts <= nowMs;
}

function formatClaimableCountdown(claimableAt: string, nowMs: number): string {
  const target = new Date(claimableAt).getTime();
  if (!Number.isFinite(target) || target <= nowMs) {
    return "Claim ready";
  }
  const remaining = target - nowMs;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) {
    return `Claimable in ${hours}h ${mins}m`;
  }
  return `Claimable in ${mins}m`;
}

// ---------- Shimmer skeleton ----------
function SkeletonBlock({ width, height, style }: { width: number | string; height: number; style?: any }) {
  const shimmer = useRef(new Animated.Value(0)).current;
  const { palette } = useTheme();

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: 8,
          backgroundColor: palette.line,
          opacity,
        },
        style,
      ]}
    />
  );
}

// ---------- Animated card wrapper ----------
function AnimatedCard({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      damping: 16,
      stiffness: 180,
      delay: index * 60,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          },
          {
            scale: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

// ---------- Win Rate Ring ----------
function WinRateRing({
  pct,
  palette,
}: {
  pct: number;
  palette: Record<string, string>;
}) {
  const size = 64;
  const stroke = 5;
  const segmentCount = 12;
  const filledSegments = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segmentCount);
  const dotSize = 4;
  const radius = size / 2 - stroke - dotSize / 2;

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: size, height: size, position: "relative" }}>
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
            borderColor: palette.line,
          }}
        />
        {Array.from({ length: segmentCount }).map((_, index) => {
          const angle = ((index / segmentCount) * Math.PI * 2) - (Math.PI / 2);
          const x = size / 2 + radius * Math.cos(angle) - dotSize / 2;
          const y = size / 2 + radius * Math.sin(angle) - dotSize / 2;
          const active = index < filledSegments;
          return (
            <View
              key={index}
              style={{
                position: "absolute",
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                left: x,
                top: y,
                backgroundColor: active ? ACCENT : palette.line,
              }}
            />
          );
        })}
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              fontSize: 18,
              color: ACCENT,
            }}
          >
            {pct}%
          </Text>
        </View>
      </View>
      <Text
        style={{
          fontFamily: "Manrope_700Bold",
          fontSize: 9,
          color: palette.muted,
          marginTop: 4,
          letterSpacing: 0.8,
        }}
      >
        WIN RATE
      </Text>
    </View>
  );
}

// ---------- Claim button with pulse ----------
function ClaimButton({
  onPress,
  disabled,
  loading,
  label,
  compact,
}: {
  onPress: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
  compact?: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (disabled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, disabled]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        style={({ pressed }) => [
          {
            paddingHorizontal: compact ? 14 : 18,
            paddingVertical: compact ? 7 : 10,
            borderRadius: radii.pill,
            backgroundColor: ACCENT,
            overflow: "hidden",
          },
          disabled && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onPress();
        }}
        disabled={disabled}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#040608" />
        ) : (
          <Text
            style={{
              fontFamily: "Manrope_700Bold",
              fontSize: compact ? 11 : 13,
              color: "#040608",
              letterSpacing: 0.5,
            }}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ====================================================================
// MAIN COMPONENT
// ====================================================================
export function PortfolioScreen() {
  const { palette, isDark } = useTheme();
  const s = useMemo(() => getStyles(palette, isDark), [palette, isDark]);
  const { session } = useSession();
  const { showToast } = useToast();

  const [portfolio, setPortfolio] = useState<PredictionUserPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [cashingOutId, setCashingOutId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [platformWallet, setPlatformWallet] = useState("");
  const [disputeChallengeHours, setDisputeChallengeHours] = useState(48);
  const [disputeDepositSkr, setDisputeDepositSkr] = useState(50);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Dispute modal state
  const [disputeModalVisible, setDisputeModalVisible] = useState(false);
  const [disputeStake, setDisputeStake] = useState<ResolvedStake | null>(null);

  // Cash-out confirmation modal state
  const [cashoutModalStake, setCashoutModalStake] = useState<ActiveStake | null>(null);
  const [cashoutSuccess, setCashoutSuccess] = useState<{ amount: number; txSignature: string | null } | null>(null);

  // Expanded resolution details state
  const [expandedResolutionId, setExpandedResolutionId] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ---------- data helpers ----------
  const loadConfig = useCallback(async () => {
    try {
      const config = await fetchClientConfig();
      setPlatformWallet(config.platformWallet ?? "");
      setDisputeChallengeHours(config.predictions?.disputeChallengeHours ?? 48);
      setDisputeDepositSkr(config.predictions?.disputeDepositSkr ?? 50);
    } catch {
      // Config is best-effort
    }
  }, []);

  const loadPortfolio = useCallback(async (showErrorToast = true) => {
    if (
      session.mode !== "wallet" ||
      !session.walletAddress ||
      !session.sessionToken
    ) {
      setPortfolio(null);
      setLoadError(false);
      return;
    }
    try {
      const data = await fetchUserPredictionStakes({
        wallet: session.walletAddress,
        sessionToken: session.sessionToken,
      });
      setPortfolio(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
      if (showErrorToast) {
        showToast("Failed to load portfolio", "error");
      }
    }
  }, [session, showToast]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadPortfolio(true), loadConfig()]);
      setLoading(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    };
    void init();
  }, [loadPortfolio, loadConfig, fadeAnim]);

  // Reload silently whenever the tab is re-focused (e.g. coming back from Predict)
  useFocusEffect(
    useCallback(() => {
      void loadPortfolio(false);
    }, [loadPortfolio])
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPortfolio(true), loadConfig()]);
    setRefreshing(false);
  }, [loadPortfolio, loadConfig]);

  // ---------- claims ----------
  const handleClaim = useCallback(
    async (payoutId: string) => {
      if (!session.walletAddress || !session.sessionToken) return;
      setClaimingId(payoutId);
      try {
        const result = await claimPredictionPayout({
          wallet: session.walletAddress,
          payoutId,
          sessionToken: session.sessionToken,
        });
        if (!result.success) {
          if (result.reason === "already_claimed") {
            showToast("This payout was already claimed", "info");
          } else if (result.reason === "frozen") {
            showToast("Payout frozen — dispute in progress", "info");
          } else if (result.reason === "not_yet_claimable") {
            showToast("Not claimable yet — check the countdown timer", "info");
          } else if (result.reason === "transfer_failed") {
            showToast("SKR transfer failed. Please retry the claim shortly.", "error");
            await loadPortfolio(false);
          } else if (result.reason === "manual_required") {
            showToast("Payout transfer is temporarily unavailable. Please retry shortly.", "error");
            await loadPortfolio(false);
          } else if (result.reason === "transfer_in_progress") {
            showToast("Payout transfer is already in progress. Please retry shortly.", "info");
          } else {
            showToast("Claim failed. Try again later.", "error");
          }
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(`${result.netPayoutSkr} SKR claimed!`, "success");
        await loadPortfolio(false);
      } catch (error) {
        showToast(friendlyError(error, "Claim failed — please try again"), "error");
      } finally {
        setClaimingId(null);
      }
    },
    [session, showToast, loadPortfolio]
  );

  const handleCashOut = useCallback(
    (stake: ActiveStake) => {
      if (!session.walletAddress || !session.sessionToken || cashingOutId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCashoutSuccess(null);
      setCashoutModalStake(stake);
    },
    [session, cashingOutId]
  );

  const handleCashOutConfirm = useCallback(async () => {
    if (!cashoutModalStake || !session.walletAddress || !session.sessionToken) return;
    setCashingOutId(cashoutModalStake.id);
    try {
      const result = await cashOutPredictionStake({
        stakeId: cashoutModalStake.id,
        wallet: session.walletAddress,
        sessionToken: session.sessionToken,
      });
      if (!result.ok || result.transferStatus !== "complete") {
        showToast("Cashout could not be completed. Your stake is still active.", "error");
        await loadPortfolio(false);
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCashoutSuccess({ amount: result.cashoutAmount, txSignature: result.txSignature });
      await loadPortfolio(false);
    } catch (err) {
      showToast(friendlyError(err, "Cash out failed — please try again"), "error");
      // Keep modal open so user can retry (don't close on error)
    } finally {
      setCashingOutId(null);
    }
  }, [cashoutModalStake, session, loadPortfolio, showToast]);

  const claimablePayouts = useMemo(() =>
    portfolio?.resolvedStakes
      .filter((st) => (st.status === "won" || st.status === "cancelled") && st.payout?.status === "pending")
      .map((st) => st.payout!)
      .filter((payout) => isPayoutClaimable(payout, nowMs))
      .filter(Boolean) ?? [],
    [portfolio?.resolvedStakes, nowMs]
  );

  const handleClaimAll = useCallback(async () => {
    if (
      !session.walletAddress ||
      !session.sessionToken ||
      claimablePayouts.length === 0
    )
      return;

    setClaimingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const payout of claimablePayouts) {
      try {
        const result = await claimPredictionPayout({
          wallet: session.walletAddress,
          payoutId: payout.id,
          sessionToken: session.sessionToken,
        });
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        `Claimed ${successCount} payout${successCount > 1 ? "s" : ""}!`,
        "success"
      );
    }
    if (failCount > 0) {
      showToast(
        `${failCount} claim${failCount > 1 ? "s" : ""} failed`,
        "error"
      );
    }

    await loadPortfolio(false);
    setClaimingAll(false);
  }, [session, claimablePayouts, showToast, loadPortfolio]);

  // ---------- derived ----------
  const allStakes: PortfolioStake[] = useMemo(() => {
    const combined = portfolio
      ? [...portfolio.activeStakes, ...portfolio.resolvedStakes]
      : [];
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return combined;
  }, [portfolio]);

  const filteredStakes = allStakes.filter((stake) => {
    if (filter === "all") return true;
    if (filter === "active") return stake.status === "active" || stake.status === "cashing_out";
    if (filter === "won")
      return stake.status === "won" || stake.status === "claimed";
    if (filter === "lost") return stake.status === "lost";
    return true;
  });

  const totalPnl =
    (portfolio?.totalWonSkr ?? 0) - (portfolio?.totalLostSkr ?? 0);
  const pnlPositive = totalPnl >= 0;
  const wonCount =
    portfolio?.resolvedStakes.filter(
      (st) => st.status === "won" || st.status === "claimed"
    ).length ?? 0;
  const lostCount =
    portfolio?.resolvedStakes.filter((st) => st.status === "lost").length ?? 0;
  const resolvedCount = wonCount + lostCount; // exclude cancelled (cashouts)
  const winRate =
    resolvedCount > 0 ? Math.round((wonCount / resolvedCount) * 100) : 0;

  // ---------- filter tab change ----------
  const switchFilter = (f: FilterKey) => {
    void Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFilter(f);
  };

  // ---------- toggle resolution expansion ----------
  const toggleResolutionDetails = useCallback((stakeId: string) => {
    void Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedResolutionId((prev) => (prev === stakeId ? null : stakeId));
  }, []);

  // ---------- open dispute modal ----------
  const openDisputeModal = useCallback((stake: ResolvedStake) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDisputeStake(stake);
    setDisputeModalVisible(true);
  }, []);

  // ---------- render a single stake card ----------
  const renderStake = useCallback(
    ({ item, index }: { item: PortfolioStake; index: number }) => {
      const isCashingOut = item.status === "cashing_out";
      const isActive = item.status === "active" || isCashingOut;
      const isClaimed = item.status === "claimed";
      const isWon = item.status === "won" || isClaimed;
      const isLost = item.status === "lost";
      const isCancelled = item.status === "cancelled";
      const itemPayout = "payout" in item ? item.payout : undefined;
      const isRefundCancelled = isCancelled && !!itemPayout;
      const isResolved = !isActive && !isCancelled;

      const statusColor = isCashingOut
        ? AMBER
        : isActive
        ? ACTIVE_CYAN
        : isClaimed
        ? ACTIVE_CYAN
        : isWon
        ? PROFIT
        : isRefundCancelled
        ? PURPLE
        : isCancelled
        ? AMBER
        : LOSS;
      const statusLabel = isClaimed
        ? "CLAIMED"
        : isCashingOut
        ? "CASHING OUT"
        : isWon
        ? "WON"
        : isLost
        ? "LOST"
        : isRefundCancelled
        ? "CANCELLED"
        : isCancelled
        ? "CASHED OUT"
        : "ACTIVE";
      const statusIcon: keyof typeof Ionicons.glyphMap = isActive
        ? isCashingOut
          ? "sync-outline"
          : "radio-button-on"
        : isClaimed
        ? "cash-outline"
        : isWon
        ? "checkmark-circle"
        : isRefundCancelled
        ? "refresh-circle"
        : isCancelled
        ? "exit-outline"
        : "close-circle";

      const resolvedNetPayout = itemPayout?.netPayoutSkr ?? item.payoutSkr ?? 0;
      // For lost stakes resolvedNetPayout is 0 (falsy), which would show "P&L: 0".
      // Use the stake status to derive the correct sign.
      const pnl = isLost ? -item.amountSkr : resolvedNetPayout > 0 ? resolvedNetPayout - item.amountSkr : 0;
      const potentialPayout =
        "potentialPayout" in item ? item.potentialPayout : 0;
      const potentialPnl = potentialPayout
        ? potentialPayout - item.amountSkr
        : 0;
      const deadlineAt =
        "potentialPayout" in item &&
        "deadlineAt" in ((item.poll as any) ?? {})
          ? (item.poll as any).deadlineAt
          : undefined;
      const canClaim =
        (isWon || isRefundCancelled) &&
        itemPayout?.status === "pending" &&
        isPayoutClaimable(itemPayout, nowMs);
      const claimCountdown =
        (isWon || isRefundCancelled) &&
        itemPayout?.status === "pending" &&
        itemPayout.claimableAt &&
        !isPayoutClaimable(itemPayout, nowMs)
          ? formatClaimableCountdown(itemPayout.claimableAt, nowMs)
          : null;

      // Resolution details for resolved stakes
      const resolvedStake = isResolved ? (item as ResolvedStake) : null;
      const resolution = resolvedStake?.resolution;
      const resolvedAt = resolvedStake?.poll?.resolvedAt;
      const resolvedOutcome = resolvedStake?.poll?.resolvedOutcome;
      const canDispute = isResolved && resolvedAt && isDisputeWindowOpen(resolvedAt, disputeChallengeHours);
      const canOpenDispute = canDispute && !!platformWallet;
      const isExpanded = expandedResolutionId === item.id;

      return (
        <AnimatedCard index={index}>
          <View style={s.stakeCard}>
            {/* Left accent bar */}
            <View style={[s.stakeAccentBar, { backgroundColor: statusColor }]} />

            {/* Top row: status + timer */}
            <View style={s.stakeHeader}>
              <View style={[s.statusBadge, { backgroundColor: `${statusColor}14` }]}>
                <Ionicons name={statusIcon} size={12} color={statusColor} />
                <Text style={[s.statusText, { color: statusColor }]}>
                  {statusLabel}
                </Text>
              </View>
              {isActive && deadlineAt && (
                <View style={s.timerChip}>
                  <Ionicons name="time-outline" size={12} color={palette.muted} />
                  <Text style={s.timerText}>{isCashingOut ? "Processing..." : formatTimeLeft(deadlineAt)}</Text>
                </View>
              )}
              {isResolved && resolvedAt && (
                <View style={s.timerChip}>
                  <Ionicons name="calendar-outline" size={12} color={palette.muted} />
                  <Text style={s.timerText}>
                    {new Date(resolvedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </Text>
                </View>
              )}
            </View>

            {/* Question */}
            <Text style={s.questionText} numberOfLines={2}>
              {item.poll?.question ?? "Unknown market"}
            </Text>

            {/* Details row */}
            <View style={s.stakeDetailsRow}>
              {/* Side chip */}
              <View
                style={[
                  s.sideChip,
                  {
                    backgroundColor:
                      item.side === "yes" ? `${PROFIT}14` : `${LOSS}14`,
                    borderColor:
                      item.side === "yes" ? `${PROFIT}30` : `${LOSS}30`,
                  },
                ]}
              >
                <Text
                  style={[
                    s.sideChipText,
                    { color: item.side === "yes" ? PROFIT : LOSS },
                  ]}
                >
                  {item.side.toUpperCase()}
                </Text>
              </View>

              {/* Stake */}
              <View style={s.detailBlock}>
                <Text style={s.detailLabel}>Stake</Text>
                <Text style={s.detailValue}>{item.amountSkr} SKR</Text>
              </View>

              {/* P&L */}
              <View style={s.detailBlock}>
                <Text style={s.detailLabel}>
                  {isActive ? "Potential" : isRefundCancelled ? "Refund" : isCancelled ? "Returned" : "P&L"}
                </Text>
                <Text
                  style={[
                    s.detailValue,
                    isActive && potentialPnl > 0 && { color: PROFIT },
                    isRefundCancelled && { color: PURPLE },
                    isCancelled && { color: AMBER },
                    !isActive && !isCancelled && pnl > 0 && { color: PROFIT },
                    !isActive && !isCancelled && pnl < 0 && { color: LOSS },
                  ]}
                >
                  {isCashingOut
                    ? `${item.amountSkr} SKR`
                    : isActive
                    ? `${potentialPnl >= 0 ? "+" : ""}${potentialPnl} SKR`
                    : isRefundCancelled
                    ? `${itemPayout?.netPayoutSkr ?? item.amountSkr} SKR`
                    : isCancelled
                    ? item.cashoutTransferStatus === "failed"
                      ? "0 SKR"
                      : `~${Math.floor(item.amountSkr * 0.95)} SKR`
                    : `${pnl >= 0 ? "+" : ""}${pnl} SKR`}
                </Text>
              </View>

              {/* Claim button for individual won stakes */}
              {canClaim && itemPayout && (
                <ClaimButton
                  onPress={() => handleClaim(itemPayout.id)}
                  disabled={claimingAll || claimingId === itemPayout.id}
                  loading={claimingId === itemPayout.id}
                  label="CLAIM"
                  compact
                />
              )}
            </View>

            {claimCountdown && (
              <View style={[s.claimCountdownRow, { backgroundColor: `${ACCENT}10`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 }]}>
                <Ionicons name="time-outline" size={14} color={ACCENT} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.claimCountdownText, { color: ACCENT, fontFamily: "Manrope_700Bold", fontSize: 13 }]}>{claimCountdown}</Text>
                  <Text style={[s.claimCountdownText, { color: palette.muted, fontSize: 11, marginTop: 1 }]}>
                    {isRefundCancelled
                      ? "Refund unlocks automatically at claim time."
                      : `${disputeChallengeHours}h dispute window — then SKR is yours to claim`}
                  </Text>
                </View>
              </View>
            )}

            {/* Frozen payout — dispute in progress */}
            {isWon && itemPayout?.status === "frozen" && (
              <View style={[s.claimCountdownRow, { backgroundColor: `${AMBER}10`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                <Ionicons name="shield-outline" size={12} color={AMBER} />
                <Text style={[s.claimCountdownText, { color: AMBER }]}>Payout frozen — dispute under review</Text>
              </View>
            )}

            {/* Expired payout — claim window missed */}
            {isWon && itemPayout?.status === "expired" && (
              <View style={[s.claimCountdownRow, { backgroundColor: `${LOSS}10`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                <Ionicons name="alert-circle-outline" size={12} color={LOSS} />
                <Text style={[s.claimCountdownText, { color: LOSS }]}>Claim window expired — payout no longer available</Text>
              </View>
            )}

            {/* Won but payout record not yet created — settlement in progress */}
            {isWon && !itemPayout && (
              <View style={[s.claimCountdownRow, { backgroundColor: `${ACCENT}08`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                <Ionicons name="sync-outline" size={12} color={palette.muted} />
                <Text style={[s.claimCountdownText, { color: palette.muted }]}>Payout processing — check back shortly</Text>
              </View>
            )}

            {/* Cash Out button — only on active stakes */}
            {isCashingOut && (
              <View style={[s.claimCountdownRow, { backgroundColor: `${AMBER}10`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                <Ionicons name="sync-outline" size={12} color={AMBER} />
                <Text style={[s.claimCountdownText, { color: AMBER }]}>Cashout is processing. Settlement is temporarily paused for this stake.</Text>
              </View>
            )}

            {item.status === "active" && (
              <Pressable
                onPress={() => handleCashOut(item as ActiveStake)}
                disabled={!!cashingOutId}
                style={({ pressed }) => ({
                  marginTop: 8,
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: "rgba(255, 184, 0, 0.4)",
                  backgroundColor: "rgba(255, 184, 0, 0.06)",
                  alignSelf: "flex-start" as const,
                  opacity: cashingOutId === item.id ? 0.5 : cashingOutId ? 0.35 : pressed ? 0.7 : 1,
                })}
              >
                <Text
                  style={{
                    color: "#FFB800",
                    fontSize: 11,
                    fontFamily: "Manrope_600SemiBold",
                    letterSpacing: 0.3,
                  }}
                >
                  {cashingOutId === item.id
                    ? "Cashing out..."
                    : `Exit Early: ~${fmtSkr(item.amountSkr * 0.95)} SKR (5% fee)`}
                </Text>
              </Pressable>
            )}

            {/* Cashout Info Section (for cashed-out stakes) */}
            {isCancelled && !isRefundCancelled && (
              <View style={[s.resolutionSection, { marginTop: 8 }]}>
                <View style={s.resolutionHeader}>
                  <View style={s.resolutionHeaderLeft}>
                    {item.cashoutTransferStatus === "failed" ? (
                      <View style={[s.resolutionOutcomeBadge, { backgroundColor: `${LOSS}15` }]}>
                        <Ionicons name="alert-circle-outline" size={14} color={LOSS} />
                        <Text style={[s.resolutionOutcomeText, { color: LOSS }]}>
                          Transfer Failed — SKR not received
                        </Text>
                      </View>
                    ) : (
                      <View style={[s.resolutionOutcomeBadge, { backgroundColor: `${AMBER}15` }]}>
                        <Ionicons name="exit-outline" size={14} color={AMBER} />
                        <Text style={[s.resolutionOutcomeText, { color: AMBER }]}>
                          Early Exit (5% fee)
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                {item.cashoutTransferStatus === "failed" && (
                  <View style={[s.claimCountdownRow, { backgroundColor: `${LOSS}08`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                    <Ionicons name="information-circle-outline" size={12} color={LOSS} />
                    <Text style={[s.claimCountdownText, { color: LOSS }]}>SKR was not sent. Contact support with your stake ID.</Text>
                  </View>
                )}
                {item.cashoutTxSignature && (
                  <View style={s.evidenceSection}>
                    <Text style={s.resolutionLabel}>TRANSACTIONS</Text>
                    <Pressable
                      style={({ pressed }) => [s.evidenceItem, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${item.cashoutTxSignature}`).catch(() => {
                          showToast("Could not open transaction details right now", "error");
                        });
                      }}
                    >
                      <Ionicons name="link-outline" size={13} color={AMBER} />
                      <Text style={s.evidenceTitle}>Cashout transaction</Text>
                      <Ionicons name="open-outline" size={12} color={palette.muted} />
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* Resolution Details Section (for resolved stakes) */}
            {isResolved && resolvedOutcome && (
              <View style={s.resolutionSection}>
                {/* Resolution Header - Tap to expand */}
                <Pressable
                  style={({ pressed }) => [s.resolutionHeader, pressed && { opacity: 0.8 }]}
                  onPress={() => toggleResolutionDetails(item.id)}
                >
                  <View style={s.resolutionHeaderLeft}>
                    <View style={[
                      s.resolutionOutcomeBadge,
                      { backgroundColor: resolvedOutcome === "yes" ? `${PROFIT}15` : `${LOSS}15` }
                    ]}>
                      <Ionicons
                        name={resolvedOutcome === "yes" ? "checkmark-circle" : "close-circle"}
                        size={14}
                        color={resolvedOutcome === "yes" ? PROFIT : LOSS}
                      />
                      <Text style={[
                        s.resolutionOutcomeText,
                        { color: resolvedOutcome === "yes" ? PROFIT : LOSS }
                      ]}>
                        Resolved {resolvedOutcome.toUpperCase()}
                      </Text>
                    </View>

                    {/* Verification confidence indicator */}
                    {resolution && (() => {
                      const vLabel = getVerificationLabel(resolution.consensus);
                      const badgeColor = vLabel.level === "high" ? PROFIT : AMBER;
                      return (
                        <View style={[s.consensusBadge, { backgroundColor: `${badgeColor}12` }]}>
                          <Ionicons
                            name={vLabel.level === "high" ? "checkmark-circle" : "shield-checkmark"}
                            size={11}
                            color={badgeColor}
                          />
                          <Text style={[s.consensusText, { color: badgeColor }]}>
                            {vLabel.label}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>

                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={palette.muted}
                  />
                </Pressable>

                {/* Expanded Resolution Details */}
                {isExpanded && (
                  <View style={s.resolutionExpanded}>
                    {/* Resolution Verification */}
                    {resolution && (
                      <View style={s.consensusSection}>
                        <Text style={s.resolutionLabel}>RESOLUTION CONFIDENCE</Text>
                        <View style={s.consensusBar}>
                          <View style={[
                            s.consensusBarFill,
                            { width: `${resolution.agentAgreement}%`, backgroundColor: PROFIT }
                          ]} />
                        </View>
                        <Text style={s.consensusDetail}>
                          {resolution.agentAgreement}% confidence
                        </Text>
                        {resolution.reason && (
                          <Text style={s.resolutionReason}>{resolution.reason}</Text>
                        )}
                      </View>
                    )}

                    {/* Evidence Sources */}
                    {resolution?.evidenceSources && resolution.evidenceSources.length > 0 && (
                      <View style={s.evidenceSection}>
                        <Text style={s.resolutionLabel}>EVIDENCE SOURCES</Text>
                        {resolution.evidenceSources.slice(0, 3).map((source, idx) => (
                          <Pressable
                            key={idx}
                            style={({ pressed }) => [s.evidenceItem, pressed && { opacity: 0.7 }]}
                            onPress={() => {
                              if (source.url) {
                                void WebBrowser.openBrowserAsync(source.url).catch(() => {
                                  showToast("Could not open this source right now", "error");
                                });
                              }
                            }}
                          >
                            <Ionicons name="link-outline" size={13} color={PURPLE} />
                            <Text style={s.evidenceTitle} numberOfLines={1}>
                              {source.title}
                            </Text>
                            <Ionicons name="open-outline" size={12} color={palette.muted} />
                          </Pressable>
                        ))}
                      </View>
                    )}

                    {/* On-chain Transaction Links */}
                    {(item.txSignature || itemPayout?.txSignature) && (
                      <View style={s.evidenceSection}>
                        <Text style={s.resolutionLabel}>TRANSACTIONS</Text>
                        {item.txSignature && (
                          <Pressable
                            style={({ pressed }) => [s.evidenceItem, pressed && { opacity: 0.7 }]}
                            onPress={() => {
                              void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${item.txSignature}`).catch(() => {
                                showToast("Could not open transaction details right now", "error");
                              });
                            }}
                          >
                            <Ionicons name="link-outline" size={13} color={PURPLE} />
                            <Text style={s.evidenceTitle}>Stake transaction</Text>
                            <Ionicons name="open-outline" size={12} color={palette.muted} />
                          </Pressable>
                        )}
                        {itemPayout?.txSignature && (
                          <Pressable
                            style={({ pressed }) => [s.evidenceItem, pressed && { opacity: 0.7 }]}
                            onPress={() => {
                              void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${itemPayout.txSignature}`).catch(() => {
                                showToast("Could not open transaction details right now", "error");
                              });
                            }}
                          >
                            <Ionicons name="link-outline" size={13} color={PROFIT} />
                            <Text style={s.evidenceTitle}>Claim transaction</Text>
                            <Ionicons name="open-outline" size={12} color={palette.muted} />
                          </Pressable>
                        )}
                      </View>
                    )}

                  </View>
                )}

                {/* File Dispute */}
                {canOpenDispute && (
                  <View style={s.disputeSection}>
                    <View style={s.disputeTimerRow}>
                      <Ionicons name="time-outline" size={13} color={AMBER} />
                      <Text style={s.disputeTimerText}>
                        Finalization window: {formatDisputeTimeRemaining(resolvedAt!, disputeChallengeHours)}
                      </Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [s.disputeBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
                      onPress={() => openDisputeModal(resolvedStake!)}
                    >
                      <Ionicons name="shield-checkmark" size={16} color="#000000" />
                      <Text style={s.disputeBtnText}>{`File Dispute (${disputeDepositSkr} SKR)`}</Text>
                    </Pressable>
                    <Text style={s.disputeHint}>
                      Deposit refunded if dispute is successful
                    </Text>
                  </View>
                )}
                {canDispute && !platformWallet && (
                  <View style={[s.claimCountdownRow, { backgroundColor: `${AMBER}10`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }]}>
                    <Ionicons name="warning-outline" size={12} color={AMBER} />
                    <Text style={[s.claimCountdownText, { color: AMBER }]}>Dispute unavailable — platform wallet not configured.</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </AnimatedCard>
      );
    },
    [
      palette,
      s,
      claimingId,
      claimingAll,
      handleClaim,
      cashingOutId,
      handleCashOut,
      expandedResolutionId,
      toggleResolutionDetails,
      openDisputeModal,
      nowMs,
      disputeChallengeHours,
      disputeDepositSkr,
      platformWallet
    ]
  );

  // ==========================================
  // LOADING STATE
  // ==========================================
  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Portfolio</Text>
        </View>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <SkeletonBlock width="100%" height={200} style={{ borderRadius: radii.lg }} />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} width="25%" height={40} style={{ flex: 1, borderRadius: radii.md }} />
            ))}
          </View>
          <SkeletonBlock width="100%" height={120} style={{ borderRadius: radii.md }} />
          <SkeletonBlock width="100%" height={120} style={{ borderRadius: radii.md }} />
        </View>
      </SafeAreaView>
    );
  }

  // ==========================================
  // NOT CONNECTED
  // ==========================================
  if (session.mode !== "wallet") {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Portfolio</Text>
        </View>
        <View style={s.connectContainer}>
          <LinearGradient
            colors={["#14F19520", "#9945FF15"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.connectIconRing}
          >
            <Ionicons name="pie-chart-outline" size={36} color={ACCENT} />
          </LinearGradient>
          <Text style={s.connectTitle}>Connect wallet to view portfolio</Text>
          <Text style={s.connectSubtext}>
            Track your positions, P&L, and claim payouts
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ==========================================
  // MAIN PORTFOLIO VIEW
  // ==========================================
  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Portfolio</Text>
        {portfolio && (
          <View style={s.headerStatBadge}>
            <Text style={s.headerStatText}>
              {allStakes.length} position{allStakes.length !== 1 ? "s" : ""}
            </Text>
          </View>
        )}
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <FlatList
          data={filteredStakes}
          keyExtractor={(item) => item.id}
          renderItem={renderStake}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={ACCENT}
            />
          }
          ListHeaderComponent={
            <>
              {/* -------- Hero P&L Dashboard -------- */}
              <View style={s.dashboardOuter}>
                <LinearGradient
                  colors={isDark ? ["#0A2A1A", "#1A0A30"] : ["#0B3D24", "#2D1463"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.dashboard}
                >
                  <View style={s.dashboardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pnlLabel}>Total P&L</Text>
                      <Text
                        style={[
                          s.pnlValue,
                          { color: pnlPositive ? PROFIT : LOSS },
                        ]}
                      >
                        {pnlPositive ? "+" : ""}
                        {totalPnl.toLocaleString()} SKR
                      </Text>
                    </View>
                    <WinRateRing pct={winRate} palette={palette} />
                  </View>

                  {/* Stats bar */}
                  <View style={s.dashboardStats}>
                    <View style={s.dashStatItem}>
                      <Text style={s.dashStatValue}>
                        {portfolio?.totalStakedSkr.toLocaleString() ?? "0"}
                      </Text>
                      <Text style={s.dashStatLabel}>Staked</Text>
                    </View>
                    <View style={s.dashStatDivider} />
                    <View style={s.dashStatItem}>
                      <Text style={s.dashStatValue}>
                        {portfolio?.activeStakes.length ?? 0}
                      </Text>
                      <Text style={s.dashStatLabel}>Active</Text>
                    </View>
                    <View style={s.dashStatDivider} />
                    <View style={s.dashStatItem}>
                      <Text style={[s.dashStatValue, { color: PROFIT }]}>
                        {wonCount}
                      </Text>
                      <Text style={s.dashStatLabel}>Won</Text>
                    </View>
                    <View style={s.dashStatDivider} />
                    <View style={s.dashStatItem}>
                      <Text style={[s.dashStatValue, { color: LOSS }]}>
                        {lostCount}
                      </Text>
                      <Text style={s.dashStatLabel}>Lost</Text>
                    </View>
                  </View>

                  {/* Bottom shine */}
                  <LinearGradient
                    colors={["transparent", "rgba(20, 241, 149, 0.05)"]}
                    style={s.dashboardShine}
                  />
                </LinearGradient>
              </View>

              {/* -------- Claimable Section -------- */}
              {claimablePayouts.length > 0 && (
                <View style={s.claimSection}>
                  <View style={s.claimBanner}>
                    <LinearGradient
                      colors={[`${ACCENT}15`, `${ACCENT}05`]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={s.claimBannerLeft}>
                      <View style={s.claimIconWrap}>
                        <Ionicons name="gift" size={18} color={ACCENT} />
                      </View>
                      <View>
                        <Text style={s.claimBannerTitle}>
                          {claimablePayouts.length} payout{claimablePayouts.length > 1 ? "s" : ""} ready
                        </Text>
                        <Text style={s.claimBannerSub}>
                          {claimablePayouts.reduce((sum, p) => sum + (p.netPayoutSkr ?? 0), 0)} SKR available
                        </Text>
                      </View>
                    </View>
                    <ClaimButton
                      onPress={handleClaimAll}
                      disabled={claimingAll || !!claimingId}
                      loading={claimingAll}
                      label="Claim All"
                    />
                  </View>
                </View>
              )}

              {/* -------- Filter Tabs -------- */}
              <View style={s.filterRow}>
                {FILTER_KEYS.map((f) => {
                  const active = filter === f;
                  const count =
                    f === "all"
                      ? allStakes.length
                      : f === "active"
                      ? portfolio?.activeStakes.length ?? 0
                      : f === "won"
                      ? wonCount
                      : lostCount;
                  return (
                    <Pressable
                      key={f}
                      style={[s.filterTab, active && s.filterTabActive]}
                      onPress={() => switchFilter(f)}
                    >
                      <Text style={[s.filterTabText, active && s.filterTabTextActive]}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </Text>
                      <View style={[s.filterCount, active && s.filterCountActive]}>
                        <Text style={[s.filterCountText, active && s.filterCountTextActive]}>
                          {count}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <View style={s.emptyIconWrap}>
                <Ionicons
                  name={loadError ? "cloud-offline-outline" : "analytics-outline"}
                  size={40}
                  color={loadError ? LOSS : palette.muted}
                />
              </View>
              <Text style={s.emptyTitle}>
                {loadError
                  ? "Failed to load"
                  : filter === "all"
                  ? "No positions yet"
                  : `No ${filter} positions`}
              </Text>
              <Text style={s.emptySub}>
                {loadError
                  ? "Check your connection and pull down to refresh"
                  : filter === "all" || (filter === "active" && allStakes.length === 0)
                  ? "Make your first prediction on the Predict tab"
                  : "Try a different filter"}
              </Text>
            </View>
          }
        />
      </Animated.View>

      {/* Cash Out Confirmation Modal */}
      <Modal
        visible={!!cashoutModalStake}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!cashingOutId) { setCashoutModalStake(null); setCashoutSuccess(null); } }}
      >
        <Pressable
          style={s.cashoutBackdrop}
          onPress={() => { if (!cashingOutId) { setCashoutModalStake(null); setCashoutSuccess(null); } }}
        />
        {cashoutModalStake && (
          <View style={s.cashoutModalWrap}>
            <View style={s.cashoutCard}>
              {cashoutSuccess ? (
                /* ── SUCCESS STATE ── */
                <>
                  <View style={[s.cashoutIconRow, { backgroundColor: "#14F19514" }]}>
                    <Ionicons name="checkmark-circle" size={28} color="#14F195" />
                  </View>
                  <Text style={s.cashoutSuccessTitle}>Cashed Out</Text>
                  <Text style={s.cashoutSuccessAmount}>{cashoutSuccess.amount} SKR</Text>
                  <Text style={s.cashoutSuccessSub}>returned to your wallet</Text>

                  {cashoutSuccess.txSignature && (
                    <Pressable
                      style={({ pressed }) => [s.cashoutTxLink, pressed && { opacity: 0.6 }]}
                      onPress={() => {
                        void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${cashoutSuccess.txSignature}`).catch(() => {
                          showToast("Could not open transaction details right now", "error");
                        });
                      }}
                    >
                      <Ionicons name="receipt-outline" size={13} color={ACTIVE_CYAN} />
                      <Text style={s.cashoutTxLinkText}>View transaction on Solscan</Text>
                      <Ionicons name="open-outline" size={12} color={ACTIVE_CYAN} />
                    </Pressable>
                  )}

                  <Pressable
                    style={({ pressed }) => [s.cashoutDoneBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => { setCashoutModalStake(null); setCashoutSuccess(null); }}
                  >
                    <Text style={s.cashoutDoneBtnText}>DONE</Text>
                  </Pressable>
                </>
              ) : (
                /* ── CONFIRM STATE ── */
                <>
                  <View style={s.cashoutIconRow}>
                    <Ionicons name="exit-outline" size={26} color="#FFB800" />
                  </View>
                  <Text style={s.cashoutTitle}>Exit Early?</Text>
                  <Text style={s.cashoutQuestion} numberOfLines={2}>
                    {cashoutModalStake.poll?.question ?? "This prediction"}
                  </Text>

                  <View style={s.cashoutAmountBox}>
                    <Text style={s.cashoutAmountLabel}>YOU'LL RECEIVE</Text>
                    <Text style={s.cashoutAmountValue}>
                      {fmtSkr(cashoutModalStake.amountSkr * 0.95)} SKR
                    </Text>
                    <View style={s.cashoutFeeRow}>
                      <Ionicons name="warning-outline" size={12} color="#FFB800" />
                      <Text style={s.cashoutFeeText}>
                        5% exit fee · {fmtSkr(cashoutModalStake.amountSkr * 0.05)} SKR forfeited
                      </Text>
                    </View>
                  </View>

                  <View style={s.cashoutBtnRow}>
                    <Pressable
                      style={({ pressed }) => [s.cashoutCancelBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => setCashoutModalStake(null)}
                      disabled={!!cashingOutId}
                    >
                      <Text style={s.cashoutCancelBtnText}>CANCEL</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [s.cashoutConfirmBtn, pressed && { opacity: 0.85 }, !!cashingOutId && { opacity: 0.5 }]}
                      onPress={() => void handleCashOutConfirm()}
                      disabled={!!cashingOutId}
                    >
                      {cashingOutId ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <Text style={s.cashoutConfirmBtnText}>CASH OUT</Text>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        )}
      </Modal>

      {/* Dispute Modal */}
      {disputeStake && disputeStake.poll?.resolvedOutcome && disputeStake.poll?.resolvedAt && (
        <DisputeModal
          visible={disputeModalVisible}
          onClose={() => {
            setDisputeModalVisible(false);
            setDisputeStake(null);
          }}
          pollId={disputeStake.pollId}
          question={disputeStake.poll.question}
          resolvedOutcome={disputeStake.poll.resolvedOutcome}
          resolvedAt={disputeStake.poll.resolvedAt}
          platformWallet={platformWallet}
          challengeWindowHours={disputeChallengeHours}
          disputeDepositSkr={disputeDepositSkr}
          onSuccess={() => void loadPortfolio(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ====================================================================
// STYLES
// ====================================================================
const getStyles = (palette: Record<string, string>, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.parchment,
    },

    // ---------- header ----------
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: palette.line,
    },
    headerTitle: {
      ...textStyles.title,
      color: palette.coal,
    },
    headerStatBadge: {
      backgroundColor: `${ACCENT}12`,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: `${ACCENT}25`,
    },
    headerStatText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      color: ACCENT,
      letterSpacing: 0.3,
    },

    // ---------- connect prompt ----------
    connectContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 40,
    },
    connectIconRing: {
      width: 80,
      height: 80,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    connectTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 18,
      color: palette.coal,
      textAlign: "center",
      marginBottom: 8,
    },
    connectSubtext: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.muted,
      textAlign: "center",
    },

    // ---------- Hero Dashboard ----------
    dashboardOuter: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
      borderRadius: radii.lg,
      ...elevation.card,
    },
    dashboard: {
      borderRadius: radii.lg,
      padding: spacing.xl,
      overflow: "hidden",
    },
    dashboardTop: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    pnlLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: "rgba(255,255,255,0.5)",
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    pnlValue: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 34,
      letterSpacing: -0.5,
    },
    dashboardStats: {
      flexDirection: "row",
      backgroundColor: "rgba(255,255,255,0.06)",
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
    },
    dashStatItem: {
      flex: 1,
      alignItems: "center",
    },
    dashStatValue: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: "#FFFFFF",
    },
    dashStatLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 10,
      color: "rgba(255,255,255,0.45)",
      marginTop: 2,
      letterSpacing: 0.4,
    },
    dashStatDivider: {
      width: 1,
      height: 28,
      backgroundColor: "rgba(255,255,255,0.1)",
      alignSelf: "center",
    },
    dashboardShine: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 60,
    },

    // ---------- claimable section ----------
    claimSection: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    claimBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: `${ACCENT}25`,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      paddingVertical: spacing.sm,
      overflow: "hidden",
    },
    claimBannerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flex: 1,
    },
    claimIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: `${ACCENT}18`,
      alignItems: "center",
      justifyContent: "center",
    },
    claimBannerTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: palette.coal,
    },
    claimBannerSub: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: ACCENT,
      marginTop: 1,
    },

    // ---------- filter tabs ----------
    filterRow: {
      flexDirection: "row",
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      backgroundColor: palette.milk,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 3,
      gap: 3,
    },
    filterTab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
      borderRadius: radii.sm,
      gap: 4,
    },
    filterTabActive: {
      backgroundColor: `${ACCENT}14`,
    },
    filterTabText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    filterTabTextActive: {
      fontFamily: "Manrope_700Bold",
      color: ACCENT,
    },
    filterCount: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.line,
      paddingHorizontal: 4,
    },
    filterCountActive: {
      backgroundColor: `${ACCENT}25`,
    },
    filterCountText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 9,
      color: palette.muted,
    },
    filterCountTextActive: {
      color: ACCENT,
    },

    // ---------- stake card ----------
    stakeCard: {
      backgroundColor: palette.milk,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.line,
      padding: spacing.md,
      paddingLeft: spacing.md + 4,
      marginBottom: spacing.sm,
      marginHorizontal: spacing.lg,
      overflow: "hidden",
    },
    stakeAccentBar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      borderTopLeftRadius: radii.md,
      borderBottomLeftRadius: radii.md,
    },
    stakeHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.sm,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      gap: 5,
    },
    statusText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.5,
    },
    timerChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    timerText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },
    questionText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: palette.coal,
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
    stakeDetailsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    sideChip: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
    },
    sideChipText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.3,
    },
    detailBlock: {
      flex: 1,
    },
    detailLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 10,
      color: palette.muted,
      letterSpacing: 0.3,
      marginBottom: 2,
    },
    detailValue: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: palette.coal,
    },
    claimCountdownRow: {
      marginTop: spacing.xs,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    claimCountdownText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },

    // ---------- resolution details ----------
    resolutionSection: {
      marginTop: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: palette.line,
    },
    resolutionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.xs,
    },
    resolutionHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flex: 1,
    },
    resolutionOutcomeBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    resolutionOutcomeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.3,
    },
    consensusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 4,
    },
    consensusText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.2,
    },
    resolutionExpanded: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
    },
    consensusSection: {
      marginBottom: spacing.md,
    },
    resolutionLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 9,
      letterSpacing: 0.8,
      color: palette.muted,
      marginBottom: spacing.xs,
    },
    consensusBar: {
      height: 4,
      backgroundColor: palette.line,
      borderRadius: 2,
      overflow: "hidden",
      marginBottom: 4,
    },
    consensusBarFill: {
      height: "100%",
      borderRadius: 2,
    },
    consensusDetail: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },
    resolutionReason: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.ink,
      marginTop: spacing.xs,
      fontStyle: "italic",
    },
    evidenceSection: {
      marginBottom: spacing.md,
    },
    evidenceItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: isDark ? "rgba(153, 69, 255, 0.08)" : "rgba(153, 69, 255, 0.06)",
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
      borderRadius: radii.sm,
      marginBottom: 4,
    },
    evidenceTitle: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: "#9945FF",
      flex: 1,
    },
    disputeSection: {
      backgroundColor: isDark ? "rgba(245, 158, 11, 0.06)" : "rgba(245, 158, 11, 0.08)",
      borderWidth: 1,
      borderColor: "rgba(245, 158, 11, 0.2)",
      borderRadius: radii.sm,
      padding: spacing.sm,
    },
    disputeTimerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginBottom: spacing.xs,
    },
    disputeTimerText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: "#F59E0B",
    },
    disputeBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      backgroundColor: "#F59E0B",
      height: 36,
      borderRadius: 6,
      marginTop: spacing.xs,
    },
    disputeBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      letterSpacing: 0.3,
      color: "#000000",
    },
    disputeHint: {
      fontFamily: "Manrope_500Medium",
      fontSize: 10,
      color: palette.muted,
      textAlign: "center",
      marginTop: spacing.xs,
    },

    // ---------- list ----------
    listContent: {
      paddingBottom: spacing.xxl,
    },

    // ---------- empty state ----------
    emptyContainer: {
      paddingVertical: 60,
      alignItems: "center",
    },
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 20,
      backgroundColor: `${palette.muted}12`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    emptyTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 17,
      color: palette.coal,
    },
    emptySub: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.muted,
      marginTop: 4,
    },

    // ── Cash-out modal ──────────────────────────────────────────────
    cashoutBackdrop: {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.72)",
    },
    cashoutModalWrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 24,
    },
    cashoutCard: {
      width: "100%",
      backgroundColor: isDark ? "#0F1519" : "#FFFFFF",
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDark ? "#1E2A32" : "#E5E7EB",
      padding: 24,
      alignItems: "center",
      gap: 4,
    },
    cashoutIconRow: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: "#FFB80014",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    cashoutTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 20,
      color: palette.coal,
      marginBottom: 4,
    },
    cashoutQuestion: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
      textAlign: "center",
      lineHeight: 18,
      marginBottom: 16,
      paddingHorizontal: 4,
    },
    cashoutAmountBox: {
      width: "100%",
      backgroundColor: isDark ? "#14F19508" : "#F0FDF4",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? "#14F19520" : "#BBF7D0",
      padding: 16,
      alignItems: "center",
      gap: 4,
      marginBottom: 8,
    },
    cashoutAmountLabel: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 10,
      color: palette.muted,
      letterSpacing: 1.2,
    },
    cashoutAmountValue: {
      fontFamily: "Manrope_700Bold",
      fontSize: 32,
      color: "#14F195",
      letterSpacing: -0.5,
    },
    cashoutFeeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 2,
    },
    cashoutFeeText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: "#FFB800",
    },
    cashoutBtnRow: {
      flexDirection: "row",
      gap: 10,
      width: "100%",
      marginTop: 16,
    },
    cashoutCancelBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? "#1E2A32" : "#E5E7EB",
      alignItems: "center",
    },
    cashoutCancelBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: palette.muted,
      letterSpacing: 0.5,
    },
    cashoutConfirmBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: "#FFB800",
      alignItems: "center",
      justifyContent: "center",
    },
    cashoutConfirmBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: "#000000",
      letterSpacing: 0.5,
    },
    // ── Success state ──
    cashoutSuccessTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 20,
      color: "#14F195",
      marginBottom: 4,
    },
    cashoutSuccessAmount: {
      fontFamily: "Manrope_700Bold",
      fontSize: 40,
      color: palette.coal,
      letterSpacing: -1,
    },
    cashoutSuccessSub: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: palette.muted,
      marginBottom: 16,
    },
    cashoutTxLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#00CFFF30",
      backgroundColor: "#00CFFF08",
      marginBottom: 8,
    },
    cashoutTxLinkText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: "#00CFFF",
    },
    cashoutDoneBtn: {
      width: "100%",
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: "#14F195",
      alignItems: "center",
      marginTop: 8,
    },
    cashoutDoneBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: "#000000",
      letterSpacing: 0.8,
    },
  });
