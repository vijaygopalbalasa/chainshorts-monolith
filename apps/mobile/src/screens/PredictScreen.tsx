import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { FeedCard } from "@chainshorts/shared";
import { useTheme } from "../theme";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";
import {
  fetchClientConfig,
  fetchDisputeStatus,
  fetchPredictionById,
  fetchPredictionPool,
  fetchPredictionSponsoredCards,
  fetchPredictions,
  trackSponsoredImpression,
  fetchUserPredictionStakes,
  fetchWalletBalances,
  type DisputeStatus,
  type PredictionMarket,
  type PredictionPayout,
  type PredictionUserPortfolio,
} from "../services/api";
import { MarketCard, type MarketData } from "../components/MarketCard";
import { QuickStakeSheet } from "../components/QuickStakeSheet";
import { DisputeModal } from "../components/DisputeModal";
import { PredictionOddsPool, normalizeYesNoPercents } from "../components/PredictionOddsPool";
import { SponsoredCard } from "../components/SponsoredCard";

const YES_COLOR = "#14F195";
const NO_COLOR = "#FF3344";
const PURPLE = "#9945FF";
const CYAN = "#00CFFF";
const AMBER = "#F59E0B";

type PredictFilter = "active" | "resolved" | "frozen" | "claimable";
type PredictRouteParams = { focusPollId?: string } | undefined;
type PredictRoute = RouteProp<{ Predict: PredictRouteParams }, "Predict">;
type UserResolvedStake = PredictionUserPortfolio["resolvedStakes"][number];
type UserActiveStake = PredictionUserPortfolio["activeStakes"][number];
type UserStakeSummary = { yes: number; no: number; total: number; txSignature?: string };
type UserResolvedSummary = {
  primaryStake: UserResolvedStake;
  side: "yes" | "no" | "mixed";
  amountSkr: number;
  txSignature?: string;
  pendingPayout?: PredictionPayout;
  frozenPayout?: PredictionPayout;
  claimedPayout?: PredictionPayout;
  expiredPayout?: PredictionPayout;
};
type PredictSponsoredStrategy = {
  enabled: boolean;
  sponsoredMinGap: number;
  sponsoredMaxGap: number;
  maxSponsoredPerPage: number;
};
type PredictListItem =
  | { kind: "market"; market: PredictionMarket }
  | { kind: "sponsored"; card: FeedCard };

const DEFAULT_PREDICT_SPONSORED_STRATEGY: PredictSponsoredStrategy = {
  enabled: true,
  sponsoredMinGap: 3,
  sponsoredMaxGap: 6,
  maxSponsoredPerPage: 2,
};

function formatTotalPool(markets: PredictionMarket[]): string {
  const total = markets.reduce((sum, m) => sum + (m.pool?.totalPoolSkr ?? 0), 0);
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M SKR`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}K SKR`;
  return `${total} SKR`;
}

function inferMarketCategory(market: PredictionMarket): string {
  // Use question text only — articleContext often contains unrelated article tags
  const q = market.question.toLowerCase();

  // 1. Price — check first: any specific $ amount OR directional price language
  if (/\$[\d]|above \$|below \$|stay above|stay below|surpass|exceed|\bprice\b|per coin|per token|fall to|drop to|rise to|reach \$|hit \$/.test(q)) return "Price";

  // 2. Regulatory — legislative & legal actions (word-bounded to avoid "sec" in "second")
  if (/\bact\b|\bbill\b|congress|senate|parliament|legislation|signed into law|passed|vote by|etf approved|\bsec\b|\bcftc\b|\bregulat|\blawsuit\b|\bban\b|\blicense\b|compliance/.test(q)) return "Regulatory";

  // 3. DeFi — protocols, on-chain mechanics
  if (/\bdefi\b|\bdex\b|yield|staking|liquidity|tvl|\bdao\b|governance|lending|borrow|protocol|aave|uniswap|compound/.test(q)) return "DeFi";

  // 4. NFT
  if (/\bnft\b|collectible|\bmint\b|opensea|ordinal/.test(q)) return "NFT";

  // 5. Security
  if (/hack|exploit|breach|drain|phish|attack|vulnerabilit/.test(q)) return "Security";

  // 6. Macro
  if (/\bfed\b|federal reserve|interest rate|inflation|\bgdp\b|macro|recession/.test(q)) return "Macro";

  return "Ecosystem";
}

function formatResolutionExplanation(market: PredictionMarket): string {
  const source = (market.resolutionSource ?? "").trim();
  if (!source) {
    return market.resolvedOutcome
      ? `Resolved ${market.resolvedOutcome.toUpperCase()} based on platform verification checks at deadline.`
      : "Resolved using platform verification checks.";
  }
  if (source.startsWith("admin_")) {
    return `Resolved by admin review (${source.replace(/_/g, " ")}).`;
  }
  if (source.includes("coingecko")) {
    return `Resolved ${market.resolvedOutcome?.toUpperCase() ?? ""} using CoinGecko price data at deadline.`;
  }
  if (source.includes("ai_auto")) {
    return `Resolved ${market.resolvedOutcome?.toUpperCase() ?? ""} using automated verification consensus.`;
  }
  if (source.includes("dispute_upheld")) {
    return `Outcome corrected after dispute review and re-resolution.`;
  }
  return `Resolution source: ${source.replace(/_/g, " ")}.`;
}

function isDisputeWindowOpen(resolvedAt: string | undefined, challengeWindowHours: number, nowMs = Date.now()): boolean {
  if (!resolvedAt) return false;
  const resolvedMs = new Date(resolvedAt).getTime();
  if (!Number.isFinite(resolvedMs)) return false;
  return nowMs < resolvedMs + challengeWindowHours * 60 * 60 * 1000;
}

function formatChallengeWindow(resolvedAt: string | undefined, challengeWindowHours: number, nowMs: number): string {
  if (!resolvedAt) return "Not available";
  const resolvedMs = new Date(resolvedAt).getTime();
  if (!Number.isFinite(resolvedMs)) return "Not available";
  const deadline = resolvedMs + challengeWindowHours * 60 * 60 * 1000;
  const remaining = deadline - nowMs;
  if (remaining <= 0) return "Finalization window closed";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${mins}m left for disputes`;
}

function formatDeadlineCountdown(deadlineAt: string): string {
  const deadline = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadline)) return "Unknown";
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "Ended";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatClaimCountdown(claimableAt: string, nowMs: number): string {
  const target = new Date(claimableAt).getTime();
  if (!Number.isFinite(target) || target <= nowMs) {
    return "Claim now in Portfolio";
  }
  const remaining = target - nowMs;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) {
    return `Claimable in ${hours}h ${mins}m`;
  }
  return `Claimable in ${mins}m`;
}

function isPayoutClaimable(payout: PredictionPayout | undefined, nowMs: number): boolean {
  if (!payout) return false; // no payout record — not claimable
  if (!payout.claimableAt) return true; // null = cancelled-market refund, immediately claimable
  const claimableMs = new Date(payout.claimableAt).getTime();
  return Number.isFinite(claimableMs) ? claimableMs <= nowMs : true;
}

function getPayoutSortTime(payout: PredictionPayout): number {
  if (!payout.claimableAt) return 0;
  const claimableMs = new Date(payout.claimableAt).getTime();
  return Number.isFinite(claimableMs) ? claimableMs : Number.POSITIVE_INFINITY;
}

function choosePendingPayout(
  current: PredictionPayout | undefined,
  candidate: PredictionPayout
): PredictionPayout {
  if (!current) return candidate;
  return getPayoutSortTime(candidate) < getPayoutSortTime(current) ? candidate : current;
}

function getResolvedStakePriority(stake: UserResolvedStake): number {
  switch (stake.status) {
    case "claimed":
      return 4;
    case "won":
      return 3;
    case "lost":
      return 2;
    case "cancelled":
      return 1;
    default:
      return 0;
  }
}

function getDisplayPayout(summary: UserResolvedSummary | undefined): PredictionPayout | undefined {
  if (!summary) return undefined;
  return summary.pendingPayout ?? summary.frozenPayout ?? summary.claimedPayout ?? summary.expiredPayout;
}

function SkeletonCard({ palette }: { palette: any }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={{
      backgroundColor: palette.milk,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 16,
      marginBottom: 12,
      opacity: pulse,
    }}>
      <View style={{ height: 12, width: "40%", backgroundColor: palette.line, borderRadius: 4, marginBottom: 12 }} />
      <View style={{ height: 16, width: "90%", backgroundColor: palette.line, borderRadius: 4, marginBottom: 8 }} />
      <View style={{ height: 16, width: "70%", backgroundColor: palette.line, borderRadius: 4, marginBottom: 16 }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, height: 44, backgroundColor: palette.line, borderRadius: 12 }} />
        <View style={{ flex: 1, height: 44, backgroundColor: palette.line, borderRadius: 12 }} />
      </View>
    </Animated.View>
  );
}

function EmptyState({ palette, filter, query }: { palette: any; filter: PredictFilter; query: string }) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -8, duration: 1200, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [bounce]);

  return (
    <View style={{ paddingVertical: 60, alignItems: "center" }}>
      <Animated.View style={{ transform: [{ translateY: bounce }], marginBottom: 20 }}>
        <View style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: `${PURPLE}20`,
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Ionicons name="analytics-outline" size={36} color={PURPLE} />
        </View>
      </Animated.View>
      <Text style={{
        fontFamily: "BricolageGrotesque_700Bold",
        fontSize: 20,
        color: palette.coal,
        marginBottom: 8,
      }}>
        {query.trim()
          ? "No Matches Found"
          : filter === "claimable"
            ? "No Claimable Payouts"
            : "No Markets In This State"}
      </Text>
      <Text style={{
        fontFamily: "Manrope_500Medium",
        fontSize: 14,
        color: palette.muted,
        textAlign: "center",
        maxWidth: 260,
        lineHeight: 20,
      }}>
        {query.trim()
          ? "Try a different keyword or clear search."
          : filter === "claimable"
            ? "You have no pending payouts. Stake on a market to earn SKR when it resolves correctly."
            : "Pull to refresh. New prediction markets are generated from current crypto coverage."}
      </Text>
    </View>
  );
}

export function PredictScreen() {
  const { palette } = useTheme();
  const styles = getStyles(palette);
  const tabBarHeight = useBottomTabBarHeight();
  const { session } = useSession();
  const { showToast } = useToast();
  const navigation = useNavigation<any>();
  const route = useRoute<PredictRoute>();

  const [activeMarkets, setActiveMarkets] = useState<PredictionMarket[]>([]);
  const [resolvedMarkets, setResolvedMarkets] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [skrBalance, setSkrBalance] = useState(0);
  const [platformWallet, setPlatformWallet] = useState("");
  const [disputeChallengeHours, setDisputeChallengeHours] = useState(48);
  const [disputeDepositSkr, setDisputeDepositSkr] = useState(50);
  const [activeFilter, setActiveFilter] = useState<PredictFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  type SortOption = "newest" | "pool_desc" | "deadline_asc" | "stakes_desc";
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [predictionSponsoredCards, setPredictionSponsoredCards] = useState<FeedCard[]>([]);
  const [predictSponsoredStrategy, setPredictSponsoredStrategy] = useState<PredictSponsoredStrategy>(
    DEFAULT_PREDICT_SPONSORED_STRATEGY
  );

  const [userResolvedByPollId, setUserResolvedByPollId] = useState<Record<string, UserResolvedSummary>>({});
  const [userActiveByPollId, setUserActiveByPollId] = useState<Record<string, UserStakeSummary>>({});

  const [stakeSheetVisible, setStakeSheetVisible] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<PredictionMarket | null>(null);
  const [selectedSide, setSelectedSide] = useState<"yes" | "no">("yes");

  const [detailMarket, setDetailMarket] = useState<PredictionMarket | null>(null);
  const [disputeModalVisible, setDisputeModalVisible] = useState(false);
  const [detailDisputeStatus, setDetailDisputeStatus] = useState<DisputeStatus | null>(null);

  const headerFade = useRef(new Animated.Value(0)).current;
  const balanceGlow = useRef(new Animated.Value(0)).current;
  const handledFocusPollId = useRef<string | null>(null);
  const activeCursorRef = useRef<string | undefined>(undefined);
  const resolvedCursorRef = useRef<string | undefined>(undefined);
  const activeHasMoreRef = useRef(true);
  const resolvedHasMoreRef = useRef(true);
  const sponsoredImpressionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    Animated.timing(headerFade, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [headerFade]);

  useEffect(() => {
    if (skrBalance > 0) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(balanceGlow, { toValue: 1, duration: 1500, useNativeDriver: false }),
          Animated.timing(balanceGlow, { toValue: 0, duration: 1500, useNativeDriver: false }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
    return undefined;
  }, [skrBalance, balanceGlow]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const PAGE_SIZE = 50;

  const loadActiveMarkets = useCallback(async (reset: boolean) => {
    if (!reset && !activeHasMoreRef.current) return;
    const cursor = reset ? undefined : activeCursorRef.current;
    const data = await fetchPredictions({ status: "active", limit: PAGE_SIZE, cursor });
    activeCursorRef.current = data.nextCursor;
    activeHasMoreRef.current = !!data.nextCursor;
    if (reset) {
      setActiveMarkets(data.items);
    } else {
      setActiveMarkets((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of data.items) byId.set(m.id, m);
        return Array.from(byId.values());
      });
    }
  }, []);

  const loadResolvedMarkets = useCallback(async (reset: boolean) => {
    if (!reset && !resolvedHasMoreRef.current) return;
    const cursor = reset ? undefined : resolvedCursorRef.current;
    const data = await fetchPredictions({ status: "resolved", limit: PAGE_SIZE, cursor });
    resolvedCursorRef.current = data.nextCursor;
    resolvedHasMoreRef.current = !!data.nextCursor;
    if (reset) {
      setResolvedMarkets(data.items);
    } else {
      setResolvedMarkets((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of data.items) byId.set(m.id, m);
        return Array.from(byId.values());
      });
    }
  }, []);

  const loadWalletContext = useCallback(async () => {
    if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
      setSkrBalance(0);
      setUserResolvedByPollId({});
      setUserActiveByPollId({});
      return;
    }

    const [walletResult, portfolioResult] = await Promise.allSettled([
      fetchWalletBalances(session.walletAddress, session.sessionToken),
      fetchUserPredictionStakes({
        wallet: session.walletAddress,
        sessionToken: session.sessionToken,
        limit: 500,
      }),
    ]);

    if (walletResult.status === "fulfilled") {
      setSkrBalance(Math.round((walletResult.value.skrUi ?? 0) * 1_000_000) / 1_000_000);
    }

    if (portfolioResult.status === "fulfilled") {
      const portfolio = portfolioResult.value;
      const resolvedMap: Record<string, UserResolvedSummary> = {};
      for (const stake of portfolio.resolvedStakes) {
        const pollId = stake.poll.id;
        const existing = resolvedMap[pollId];
        if (!existing) {
          const summary: UserResolvedSummary = {
            primaryStake: stake,
            side: stake.side,
            amountSkr: stake.amountSkr,
            txSignature: stake.txSignature,
          };
          if (stake.payout?.status === "pending") {
            summary.pendingPayout = stake.payout;
          } else if (stake.payout?.status === "frozen") {
            summary.frozenPayout = stake.payout;
          } else if (stake.payout?.status === "claimed") {
            summary.claimedPayout = stake.payout;
          } else if (stake.payout?.status === "expired") {
            summary.expiredPayout = stake.payout;
          }
          resolvedMap[pollId] = summary;
          continue;
        }

        existing.amountSkr += stake.amountSkr;
        existing.side = existing.side === stake.side ? existing.side : "mixed";
        if (!existing.txSignature && stake.txSignature) {
          existing.txSignature = stake.txSignature;
        }
        if (getResolvedStakePriority(stake) > getResolvedStakePriority(existing.primaryStake)) {
          existing.primaryStake = stake;
        }

        if (stake.payout?.status === "pending") {
          existing.pendingPayout = choosePendingPayout(existing.pendingPayout, stake.payout);
        } else if (stake.payout?.status === "frozen" && !existing.frozenPayout) {
          existing.frozenPayout = stake.payout;
        } else if (stake.payout?.status === "claimed" && !existing.claimedPayout) {
          existing.claimedPayout = stake.payout;
        } else if (stake.payout?.status === "expired" && !existing.expiredPayout) {
          existing.expiredPayout = stake.payout;
        }
      }

      const activeMap: Record<string, UserStakeSummary> = {};
      for (const stake of portfolio.activeStakes as UserActiveStake[]) {
        const pollId = stake.poll.id;
        const current = activeMap[pollId] ?? { yes: 0, no: 0, total: 0 };
        if (stake.side === "yes") {
          current.yes += stake.amountSkr;
        } else {
          current.no += stake.amountSkr;
        }
        current.total += stake.amountSkr;
        // Keep the most recent stake's txSignature for the on-chain link
        if (stake.txSignature) current.txSignature = stake.txSignature;
        activeMap[pollId] = current;
      }

      setUserResolvedByPollId(resolvedMap);
      setUserActiveByPollId(activeMap);
    }
  }, [session]);

  const loadConfig = useCallback(async () => {
    try {
      const config = await fetchClientConfig();
      setPlatformWallet(config.platformWallet ?? "");
      setDisputeChallengeHours(config.predictions?.disputeChallengeHours ?? 48);
      setDisputeDepositSkr(config.predictions?.disputeDepositSkr ?? 50);
    } catch {
      // Config is best-effort — defaults remain active
    }
  }, []);

  const loadPredictionSponsored = useCallback(async () => {
    try {
      const response = await fetchPredictionSponsoredCards({
        limit: 10,
        sessionToken: session.mode === "wallet" ? session.sessionToken : undefined,
      });
      setPredictionSponsoredCards(response.cards ?? []);
      setPredictSponsoredStrategy(response.strategy ?? DEFAULT_PREDICT_SPONSORED_STRATEGY);
    } catch {
      setPredictionSponsoredCards([]);
      setPredictSponsoredStrategy(DEFAULT_PREDICT_SPONSORED_STRATEGY);
    }
  }, [session.mode, session.sessionToken]);

  const loadAll = useCallback(async () => {
    activeCursorRef.current = undefined;
    resolvedCursorRef.current = undefined;
    activeHasMoreRef.current = true;
    resolvedHasMoreRef.current = true;
    const requests = [
      ["active markets", loadActiveMarkets(true)],
      ["resolved markets", loadResolvedMarkets(true)],
      ["wallet context", loadWalletContext()],
      ["config", loadConfig()],
      ["sponsored cards", loadPredictionSponsored()],
    ] as const;
    const results = await Promise.allSettled(
      requests.map(([, request]) => request)
    );
    return results.reduce<string[]>((failed, result, index) => {
      if (result.status === "rejected") {
        failed.push(requests[index]?.[0] ?? `section ${index + 1}`);
      }
      return failed;
    }, []);
  }, [loadActiveMarkets, loadResolvedMarkets, loadWalletContext, loadConfig, loadPredictionSponsored]);

  const onEndReached = useCallback(async () => {
    if (loadingMore) return;
    const isActiveSide = activeFilter === "active";
    const isResolvedSide = activeFilter === "resolved" || activeFilter === "frozen" || activeFilter === "claimable";
    if (isActiveSide && !activeHasMoreRef.current) return;
    if (isResolvedSide && !resolvedHasMoreRef.current) return;
    setLoadingMore(true);
    try {
      if (isActiveSide) await loadActiveMarkets(false);
      else await loadResolvedMarkets(false);
    } finally {
      setLoadingMore(false);
    }
  }, [activeFilter, loadingMore, loadActiveMarkets, loadResolvedMarkets]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const failedSections = await loadAll();
        if (failedSections.length > 0) {
          const allFailed = failedSections.length === 5;
          showToast(
            allFailed
              ? "Failed to load prediction markets"
              : `Some prediction data could not be loaded: ${failedSections.join(", ")}`,
            allFailed ? "error" : "info"
          );
        }
      } catch {
        showToast("Failed to load prediction markets", "error");
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [loadAll, showToast]);

  // Re-fetch wallet context (stakes) when the tab is focused — catches cashouts
  // or claims made in PortfolioScreen that would otherwise leave stale stake badges.
  useFocusEffect(
    useCallback(() => {
      void loadWalletContext();
    }, [loadWalletContext])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const failedSections = await loadAll();
      if (failedSections.length > 0) {
        const allFailed = failedSections.length === 5;
        showToast(
          allFailed
            ? "Refresh failed"
            : `Some data could not be refreshed: ${failedSections.join(", ")}`,
          allFailed ? "error" : "info"
        );
      }
    } catch {
      showToast("Refresh failed", "error");
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, showToast]);

  const refreshDetailDisputeStatus = useCallback(async (pollId: string) => {
    if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
      setDetailDisputeStatus(null);
      return;
    }
    try {
      const status = await fetchDisputeStatus({
        pollId,
        wallet: session.walletAddress,
        sessionToken: session.sessionToken,
      });
      setDetailDisputeStatus(status);
    } catch {
      setDetailDisputeStatus(null);
    }
  }, [session]);

  useEffect(() => {
    if (!detailMarket?.id) {
      setDetailDisputeStatus(null);
      return;
    }
    void refreshDetailDisputeStatus(detailMarket.id);
  }, [detailMarket?.id, refreshDetailDisputeStatus]);

  useEffect(() => {
    if (!detailMarket?.id || detailMarket.status !== "active") {
      return;
    }
    let cancelled = false;
    const pollId = detailMarket.id;
    const refreshPool = async () => {
      try {
        const pool = await fetchPredictionPool(pollId, session.mode === "wallet" ? session.sessionToken : undefined);
        if (cancelled) return;
        setDetailMarket((prev) => (prev && prev.id === pollId ? { ...prev, pool } : prev));
        setActiveMarkets((prev) => prev.map((m) => (m.id === pollId ? { ...m, pool } : m)));
      } catch {
        // best-effort live refresh
      }
    };
    void refreshPool();
    const interval = setInterval(() => {
      void refreshPool();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [detailMarket?.id, detailMarket?.status, session.mode, session.sessionToken]);

  useEffect(() => {
    if (!detailMarket?.id) {
      return;
    }
    const latest = [...activeMarkets, ...resolvedMarkets].find((market) => market.id === detailMarket.id);
    if (!latest) {
      return;
    }
    setDetailMarket((prev) => {
      if (!prev || prev.id !== latest.id) {
        return prev;
      }
      if (prev === latest) {
        return prev;
      }
      return latest;
    });
  }, [detailMarket?.id, activeMarkets, resolvedMarkets]);

  useEffect(() => {
    const focusPollId = route.params?.focusPollId;
    if (!focusPollId || handledFocusPollId.current === focusPollId) {
      return;
    }

    handledFocusPollId.current = focusPollId;

    const existing = [...activeMarkets, ...resolvedMarkets].find((market) => market.id === focusPollId);
    if (existing) {
      setDetailMarket(existing);
      navigation.setParams?.({ focusPollId: undefined });
      return;
    }

    const loadFocused = async () => {
      try {
        const focused = await fetchPredictionById(
          focusPollId,
          session.mode === "wallet" ? session.walletAddress : undefined,
          session.mode === "wallet" ? session.sessionToken : undefined
        );
        setDetailMarket(focused);
      } catch {
        showToast("Could not open selected market", "error");
      } finally {
        navigation.setParams?.({ focusPollId: undefined });
      }
    };

    void loadFocused();
  }, [route.params?.focusPollId, activeMarkets, resolvedMarkets, navigation, session, showToast]);

  const openStakeSheet = useCallback((market: PredictionMarket, side: "yes" | "no") => {
    if (session.mode !== "wallet" || !session.walletAddress) {
      showToast("Connect your wallet to stake", "info");
      return;
    }
    setSelectedMarket(market);
    setSelectedSide(side);
    setStakeSheetVisible(true);
  }, [session, showToast]);

  const shareMarket = useCallback(async (market: PredictionMarket) => {
    try {
      const deepLink = `https://chainshorts.live/?market=${encodeURIComponent(market.id)}`;
      await Share.share({
        message: `${market.question}\n\nPredict this market on Chainshorts:\n${deepLink}`,
        url: deepLink,
      });
    } catch {
      showToast("Unable to share market right now", "error");
    }
  }, [showToast]);

  const filterStats = useMemo(() => ({
    active: activeMarkets.length,
    resolved: resolvedMarkets.length,
    frozen: resolvedMarkets.filter((m) => !!m.disputeFreeze).length,
    claimable: resolvedMarkets.filter((m) => {
      const payout = userResolvedByPollId[m.id]?.pendingPayout;
      return isPayoutClaimable(payout, nowMs);
    }).length,
  }), [activeMarkets, resolvedMarkets, userResolvedByPollId, nowMs]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const market of [...activeMarkets, ...resolvedMarkets]) {
      set.add(inferMarketCategory(market));
    }
    return ["all", ...Array.from(set)];
  }, [activeMarkets, resolvedMarkets]);

  useEffect(() => {
    if (!categoryOptions.includes(activeCategory)) {
      setActiveCategory("all");
    }
  }, [categoryOptions, activeCategory]);

  // HOT = top 2 active markets by pool size that have at least 1 stake — sort-independent
  const hotPollIds = useMemo(() => {
    const withStakes = activeMarkets.filter((m) => (m.pool?.totalStakers ?? 0) > 0);
    const top2 = [...withStakes]
      .sort((a, b) => (b.pool?.totalPoolSkr ?? 0) - (a.pool?.totalPoolSkr ?? 0))
      .slice(0, 2);
    return new Set(top2.map((m) => m.id));
  }, [activeMarkets]);

  const endingSoonMarkets = useMemo(() => {
    const now = nowMs;
    return activeMarkets
      .filter((m) => new Date(m.deadlineAt).getTime() > now)
      .filter((m) => !userActiveByPollId[m.id])
      .sort((a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime())
      .slice(0, 6);
  }, [activeMarkets, userActiveByPollId, nowMs]);

  const filteredMarkets = useMemo(() => {
    let base: PredictionMarket[];
    if (activeFilter === "active") base = activeMarkets;
    else if (activeFilter === "resolved") base = resolvedMarkets;
    else if (activeFilter === "frozen") base = resolvedMarkets.filter((m) => !!m.disputeFreeze);
    else if (activeFilter === "claimable") {
      base = resolvedMarkets.filter((m) => {
        const payout = userResolvedByPollId[m.id]?.pendingPayout;
        return isPayoutClaimable(payout, nowMs);
      });
    }
    else base = activeMarkets;

    const sorted = [...base];
    if (sortBy === "pool_desc") {
      sorted.sort((a, b) => (b.pool?.totalPoolSkr ?? 0) - (a.pool?.totalPoolSkr ?? 0));
    } else if (sortBy === "deadline_asc") {
      sorted.sort((a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime());
    } else if (sortBy === "stakes_desc") {
      sorted.sort((a, b) => (b.pool?.totalStakers ?? 0) - (a.pool?.totalStakers ?? 0));
    }

    const byCategory =
      activeCategory === "all"
        ? sorted
        : sorted.filter((m) => inferMarketCategory(m) === activeCategory);

    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return byCategory;
    }
    return byCategory.filter((m) => {
      const haystack = `${m.question} ${m.articleContext ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [activeFilter, sortBy, activeMarkets, resolvedMarkets, userResolvedByPollId, activeCategory, searchQuery, nowMs]);

  const listItems = useMemo<PredictListItem[]>(() => {
    const base = filteredMarkets.map((market) => ({ kind: "market" as const, market }));
    if (
      activeFilter !== "active" ||
      !predictSponsoredStrategy.enabled ||
      predictionSponsoredCards.length === 0 ||
      predictSponsoredStrategy.maxSponsoredPerPage <= 0
    ) {
      return base;
    }

    const injected: PredictListItem[] = [];
    let organicSinceAd = 0;
    let adIdx = 0;
    let insertedAds = 0;
    const minGap = Math.max(1, predictSponsoredStrategy.sponsoredMinGap);
    const maxGap = Math.max(minGap, predictSponsoredStrategy.sponsoredMaxGap);
    const span = Math.max(1, maxGap - minGap + 1);
    let nextGap = minGap;

    for (const item of base) {
      injected.push(item);
      organicSinceAd += 1;
      if (insertedAds >= predictSponsoredStrategy.maxSponsoredPerPage) {
        continue;
      }
      if (organicSinceAd >= nextGap) {
        const ad = predictionSponsoredCards[adIdx % predictionSponsoredCards.length];
        if (ad) {
          injected.push({ kind: "sponsored", card: ad });
          adIdx += 1;
          insertedAds += 1;
          organicSinceAd = 0;
          nextGap = minGap + (adIdx % span);
        }
      }
    }

    return injected;
  }, [activeFilter, filteredMarkets, predictSponsoredStrategy, predictionSponsoredCards]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: PredictListItem | null }> }) => {
      for (const row of viewableItems) {
        const item = row.item;
        if (!item || item.kind !== "sponsored") continue;
        const sponsoredId = item.card.sponsored?.id;
        if (!sponsoredId || sponsoredImpressionsRef.current.has(sponsoredId)) continue;
        sponsoredImpressionsRef.current.add(sponsoredId);
        void trackSponsoredImpression(sponsoredId);
      }
    }
  ).current;

  const toMarketData = useCallback((market: PredictionMarket): MarketData => {
    const userResolved = userResolvedByPollId[market.id];
    const payout = getDisplayPayout(userResolved);
    const activeStake = userActiveByPollId[market.id];
    const myStake = activeStake
      ? {
          side: activeStake.yes > 0 && activeStake.no > 0 ? "mixed" as const : activeStake.yes > 0 ? "yes" as const : "no" as const,
          amountSkr: activeStake.total,
        }
      : userResolved
        ? { side: userResolved.side, amountSkr: userResolved.amountSkr }
        : undefined;

    return {
      id: market.id,
      question: market.question,
      yesOdds: market.pool?.yesOdds ?? 1,
      noOdds: market.pool?.noOdds ?? 1,
      yesPct: market.pool?.yesPct,
      noPct: market.pool?.noPct,
      totalPoolSkr: market.pool?.totalPoolSkr ?? 0,
      totalStakers: market.pool?.totalStakers ?? 0,
      deadlineAt: market.deadlineAt,
      status: market.status,
      resolvedOutcome: market.resolvedOutcome as "yes" | "no" | undefined,
      resolvedAt: market.resolvedAt,
      disputeFreeze: market.disputeFreeze,
      pendingClaimableAt: payout?.status === "pending" ? (payout.claimableAt ?? null) : undefined,
      categoryTag: inferMarketCategory(market),
      myStake,
    };
  }, [userResolvedByPollId, userActiveByPollId]);

  const glowBorderColor = balanceGlow.interpolate({
    inputRange: [0, 1],
    outputRange: ["#14F19540", "#14F19590"],
  });

  const detailUserSummary = detailMarket ? userResolvedByPollId[detailMarket.id] : undefined;
  const detailUserStake = detailUserSummary?.primaryStake;
  const detailActiveStake = detailMarket ? userActiveByPollId[detailMarket.id] : undefined;
  const detailMyStakeSide = detailActiveStake
    ? detailActiveStake.yes > 0 && detailActiveStake.no > 0 ? "mixed" as const
      : detailActiveStake.yes > 0 ? "yes" as const : "no" as const
    : null;
  const detailPayout = getDisplayPayout(detailUserSummary);
  const detailClaimReady = isPayoutClaimable(detailPayout, nowMs);
  const detailResolutionExplanation = detailMarket ? formatResolutionExplanation(detailMarket) : null;
  const canDisputeWindow =
    !!detailMarket &&
    detailMarket.status === "resolved" &&
    !!detailUserStake &&
    isDisputeWindowOpen(detailMarket.resolvedAt, disputeChallengeHours, nowMs) &&
    !detailDisputeStatus;
  const canDispute = canDisputeWindow && !!platformWallet;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Animated.View style={[styles.header, { opacity: headerFade }]}> 
          <Text style={styles.title}>PREDICT</Text>
        </Animated.View>
        <View style={styles.listContent}>
          <SkeletonCard palette={palette} />
          <SkeletonCard palette={palette} />
          <SkeletonCard palette={palette} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Animated.View style={[styles.header, { opacity: headerFade }]}> 
        <View style={styles.titleRow}>
          <Ionicons name="trending-up" size={22} color={YES_COLOR} style={{ marginRight: 8 }} />
          <Text style={styles.title}>PREDICT</Text>
        </View>
        {session.mode === "wallet" && (
          <Animated.View style={[styles.balancePill, { borderColor: glowBorderColor }]}> 
            <View style={styles.balanceDot} />
            <Text style={styles.balanceText}>{skrBalance.toLocaleString()} SKR</Text>
          </Animated.View>
        )}
      </Animated.View>

      <FlatList
        data={listItems}
        keyExtractor={(item) => (item.kind === "market" ? item.market.id : item.card.id)}
        renderItem={({ item, index }) => {
          if (item.kind === "sponsored") {
            return <SponsoredCard card={item.card} />;
          }
          const market = item.market;
          return (
            <MarketCard
              market={toMarketData(market)}
              onStakeYes={() => openStakeSheet(market, "yes")}
              onStakeNo={() => openStakeSheet(market, "no")}
              onPress={() => setDetailMarket(market)}
              onCategoryPress={(category) => {
                setActiveCategory(category);
                setActiveFilter("active");
              }}
              isHot={activeFilter === "active" && hotPollIds.has(market.id)}
              index={index}
              nowMs={nowMs}
            />
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={() => { void onEndReached(); }}
        onEndReachedThreshold={0.4}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 65 }}
        removeClippedSubviews={false}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={8}
        initialNumToRender={6}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <ActivityIndicator size="small" color={YES_COLOR} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={YES_COLOR}
            colors={[YES_COLOR]}
          />
        }
        ListHeaderComponent={
          <>
            <View style={styles.statsBar}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{[...activeMarkets, ...resolvedMarkets].reduce((sum, m) => sum + (m.pool?.totalStakers ?? 0), 0)}</Text>
                <Text style={styles.statLabel}>Stakes</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: YES_COLOR }]}>{formatTotalPool(activeMarkets)}</Text>
                <Text style={styles.statLabel}>Total Pool</Text>
              </View>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={CYAN} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search markets..."
                placeholderTextColor={palette.muted}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={palette.muted} />
                </Pressable>
              )}
            </View>

            {activeFilter === "active" && endingSoonMarkets.length > 0 && (
              <View style={styles.endingSoonSection}>
                <Text style={styles.endingSoonTitle}>Ending Soon</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.endingSoonList}>
                  {endingSoonMarkets.map((market) => (
                    <Pressable
                      key={market.id}
                      style={styles.endingSoonCard}
                      onPress={() => setDetailMarket(market)}
                    >
                      <Text style={styles.endingSoonQuestion} numberOfLines={2}>{market.question}</Text>
                      <View style={styles.endingSoonMeta}>
                        <Ionicons name="time-outline" size={12} color={AMBER} />
                        <Text style={styles.endingSoonMetaText}>Ends in {formatDeadlineCountdown(market.deadlineAt)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {categoryOptions.map((category) => {
                const isSelected = activeCategory === category;
                return (
                  <Pressable
                    key={category}
                    style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                    onPress={() => setActiveCategory(category)}
                  >
                    <Text style={[styles.categoryChipText, isSelected && styles.categoryChipTextActive]}>
                      {category === "all" ? "ALL" : category.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.filterRow}>
              {([
                { key: "active", label: "ACTIVE" },
                { key: "resolved", label: "RESOLVED" },
                { key: "frozen", label: "FROZEN" },
                { key: "claimable", label: "CLAIMABLE" },
              ] as Array<{ key: PredictFilter; label: string }>).map((item) => {
                const active = activeFilter === item.key;
                const count = filterStats[item.key];
                return (
                  <Pressable
                    key={item.key}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setActiveFilter(item.key)}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>
                      {item.label} {count}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.sortBtn, sortBy !== "newest" && { borderColor: CYAN, backgroundColor: `${CYAN}15` }]}
                onPress={() => setSortModalVisible(true)}
              >
                <Ionicons name="funnel-outline" size={14} color={sortBy !== "newest" ? CYAN : palette.muted} />
              </Pressable>
            </View>
          </>
        }
        ListEmptyComponent={<EmptyState palette={palette} filter={activeFilter} query={searchQuery} />}
      />

      {/* Sort Modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSortModalVisible(false)} />
        <View style={styles.sortSheet}>
          <View style={styles.handle} />
          <Text style={styles.sortTitle}>Sort Markets</Text>
          {([
            { key: "newest", label: "Newest First", icon: "time-outline" },
            { key: "pool_desc", label: "Highest Pool", icon: "trending-up-outline" },
            { key: "deadline_asc", label: "Ending Soon", icon: "hourglass-outline" },
            { key: "stakes_desc", label: "Most Stakes", icon: "people-outline" },
          ] as Array<{ key: string; label: string; icon: keyof typeof Ionicons.glyphMap }>).map((opt) => {
            const isActive = sortBy === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.sortOption, isActive && { backgroundColor: `${CYAN}15` }]}
                onPress={() => { setSortBy(opt.key as any); setSortModalVisible(false); }}
              >
                <Ionicons name={opt.icon} size={18} color={isActive ? CYAN : palette.muted} />
                <Text style={[styles.sortOptionText, isActive && { color: CYAN }]}>{opt.label}</Text>
                {isActive && <Ionicons name="checkmark" size={16} color={CYAN} style={{ marginLeft: "auto" }} />}
              </Pressable>
            );
          })}
        </View>
      </Modal>

      {selectedMarket && (
        <QuickStakeSheet
          visible={stakeSheetVisible}
          onClose={() => setStakeSheetVisible(false)}
          pollId={selectedMarket.id}
          side={selectedSide}
          odds={selectedSide === "yes" ? (selectedMarket.pool?.yesOdds ?? 1) : (selectedMarket.pool?.noOdds ?? 1)}
          userBalance={skrBalance}
          platformWallet={platformWallet}
          minStakeSkr={selectedMarket.minStakeSkr ?? 10}
          maxStakeSkr={selectedMarket.maxStakeSkr ?? 999_999_999}
          onSuccess={(stakedAmount) => {
            // Optimistic update — immediately deduct staked amount so balance reflects reality
            // while the on-chain refresh catches up in the background
            setSkrBalance((prev) => Math.max(0, prev - stakedAmount));
            void onRefresh();
          }}
          onNavigateToSwap={() => navigation.navigate("Wallet" as never)}
        />
      )}

      <Modal
        visible={!!detailMarket}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailMarket(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDetailMarket(null)} />
        {detailMarket ? (
          <View style={[styles.detailSheet, { paddingBottom: tabBarHeight + 8 }]}>
            <View style={styles.handle} />

            <View style={styles.detailHeaderRow}>
              <View style={[styles.detailStatusBadge, {
                backgroundColor: detailMarket.disputeFreeze
                  ? `${AMBER}15`
                  : detailMarket.status === "active"
                    ? `${YES_COLOR}15`
                    : `${PURPLE}15`
              }]}> 
                <Text style={[styles.detailStatusText, {
                  color: detailMarket.disputeFreeze ? AMBER : detailMarket.status === "active" ? YES_COLOR : PURPLE
                }]}> 
                  {detailMarket.disputeFreeze
                    ? "FROZEN"
                    : detailMarket.status === "active"
                      ? "ACTIVE"
                      : "RESOLVED"}
                </Text>
              </View>
              <View style={styles.detailHeaderActions}>
                <Pressable onPress={() => { void shareMarket(detailMarket); }}>
                  <Ionicons name="share-social-outline" size={20} color={palette.muted} />
                </Pressable>
                <Pressable onPress={() => setDetailMarket(null)}>
                  <Ionicons name="close" size={22} color={palette.muted} />
                </Pressable>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              bounces={false}
            >
            <Text style={styles.detailQuestion}>{detailMarket.question}</Text>

            <PredictionOddsPool
              yesPct={normalizeYesNoPercents({
                yesPct: detailMarket.pool?.yesPct,
                noPct: detailMarket.pool?.noPct
              }).yesPct}
              noPct={normalizeYesNoPercents({
                yesPct: detailMarket.pool?.yesPct,
                noPct: detailMarket.pool?.noPct
              }).noPct}
              totalPoolSkr={detailMarket.pool?.totalPoolSkr ?? 0}
              totalStakers={detailMarket.pool?.totalStakers ?? 0}
            />

            <View style={styles.detailMetaRow}>
              <View style={styles.detailMetaChip}>
                <Ionicons name="time-outline" size={12} color={palette.muted} />
                <Text style={styles.detailMetaText}>
                  {detailMarket.status === "active"
                    ? `Ends ${new Date(detailMarket.deadlineAt).toLocaleString()}`
                    : detailMarket.resolvedAt
                      ? `Resolved ${new Date(detailMarket.resolvedAt).toLocaleString()}`
                      : "Resolved"}
                </Text>
              </View>
            </View>

            {detailMarket.status === "active" ? (
              <>
                <View style={styles.detailActionRow}>
                  <Pressable
                    style={[styles.detailStakeBtn, { backgroundColor: YES_COLOR }]}
                    onPress={() => {
                      setDetailMarket(null);
                      openStakeSheet(detailMarket, "yes");
                    }}
                  >
                    <Text style={styles.detailStakeBtnText}>
                      {(detailMyStakeSide === "yes" || detailMyStakeSide === "mixed") ? "ADD YES" : "STAKE YES"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.detailStakeBtn, { backgroundColor: NO_COLOR }]}
                    onPress={() => {
                      setDetailMarket(null);
                      openStakeSheet(detailMarket, "no");
                    }}
                  >
                    <Text style={[styles.detailStakeBtnText, { color: "#FFFFFF" }]}>
                      {(detailMyStakeSide === "no" || detailMyStakeSide === "mixed") ? "ADD NO" : "STAKE NO"}
                    </Text>
                  </Pressable>
                </View>
                {detailActiveStake?.txSignature && (
                  <Pressable
                    style={({ pressed }) => [styles.txInlineLinkRow, pressed && { opacity: 0.5 }]}
                    onPress={() => {
                      void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${detailActiveStake.txSignature}`).catch(() => {
                        showToast("Could not open transaction details right now", "error");
                      });
                    }}
                  >
                    <Ionicons name="receipt-outline" size={12} color={palette.muted} />
                    <Text style={styles.txInlineLinkText}>View stake transaction</Text>
                    <Ionicons name="open-outline" size={11} color={palette.muted} />
                  </Pressable>
                )}
              </>
            ) : (
              <View style={styles.resolutionSection}>
                {detailMarket.resolvedOutcome ? (
                  <View style={styles.resolutionBadgeRow}>
                    <View style={[styles.resolutionOutcomeBadge, {
                      backgroundColor: detailMarket.resolvedOutcome === "yes" ? `${YES_COLOR}15` : `${NO_COLOR}15`
                    }]}> 
                      <Text style={[styles.resolutionOutcomeText, {
                        color: detailMarket.resolvedOutcome === "yes" ? YES_COLOR : NO_COLOR
                      }]}> 
                        RESOLVED {detailMarket.resolvedOutcome.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {detailMarket.disputeFreeze && (
                  <View style={styles.warningBox}>
                    <Ionicons name="lock-closed-outline" size={14} color={AMBER} />
                    <Text style={styles.warningText}>
                      Payouts are frozen while a dispute is under review.
                    </Text>
                  </View>
                )}

                {detailResolutionExplanation && (
                  <View style={styles.resolutionNoteBox}>
                    <Ionicons name="information-circle-outline" size={14} color={CYAN} />
                    <Text style={styles.resolutionNoteText}>{detailResolutionExplanation}</Text>
                  </View>
                )}

                {detailDisputeStatus && (
                  <View style={styles.disputeStatusRow}>
                    <Text style={styles.disputeStatusLabel}>Your dispute:</Text>
                    <View style={styles.disputeStatusBadge}>
                      <Text style={styles.disputeStatusText}>{detailDisputeStatus.status.toUpperCase()}</Text>
                    </View>
                  </View>
                )}

                <View style={styles.claimDelayBox}>
                  <Ionicons name="hourglass-outline" size={14} color={PURPLE} />
                  <Text style={styles.claimDelayText}>
                    {detailPayout?.status === "pending"
                      ? detailPayout.claimableAt
                        ? formatClaimCountdown(detailPayout.claimableAt, nowMs)
                        : "Claim now in Portfolio"
                      : detailPayout?.status === "frozen"
                        ? "Payout frozen while dispute review is in progress"
                        : detailPayout?.status === "claimed"
                          ? "Payout already claimed"
                          : detailPayout?.status === "expired"
                            ? "Claim window expired"
                            : "No pending winner payout for this market"}
                  </Text>
                </View>

                {detailMarket.resolvedAt && (
                  <View style={styles.challengeRow}>
                    <Ionicons name="hourglass-outline" size={14} color={AMBER} />
                    <Text style={styles.challengeText}>
                      {formatChallengeWindow(detailMarket.resolvedAt, disputeChallengeHours, nowMs)}
                    </Text>
                  </View>
                )}

                {canDispute && detailMarket.resolvedOutcome && detailMarket.resolvedAt ? (
                  <Pressable
                    style={styles.disputeBtn}
                    onPress={() => setDisputeModalVisible(true)}
                  >
                    <Ionicons name="warning-outline" size={14} color="#040608" />
                    <Text style={styles.disputeBtnText}>{`FILE DISPUTE (${disputeDepositSkr} SKR)`}</Text>
                  </Pressable>
                ) : null}

                {canDisputeWindow && !platformWallet ? (
                  <View style={styles.warningBox}>
                    <Ionicons name="warning-outline" size={14} color={AMBER} />
                    <Text style={styles.warningText}>
                      Dispute filing is temporarily unavailable.
                    </Text>
                  </View>
                ) : null}

                {detailPayout?.status === "pending" && detailClaimReady && (
                  <Text style={styles.claimHintText}>Go to Portfolio to claim your payout.</Text>
                )}

                {/* On-chain transaction links */}
                {(detailUserStake?.txSignature || detailPayout?.txSignature) && (
                  <View style={styles.txLinksRow}>
                    {detailUserStake?.txSignature && (
                      <Pressable
                        style={({ pressed }) => [styles.txLinkBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => {
                          void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${detailUserStake.txSignature}`).catch(() => {
                            showToast("Could not open transaction details right now", "error");
                          });
                        }}
                      >
                        <Ionicons name="link-outline" size={12} color={PURPLE} />
                        <Text style={styles.txLinkText}>View stake</Text>
                        <Ionicons name="open-outline" size={11} color={PURPLE} />
                      </Pressable>
                    )}
                    {detailPayout?.txSignature && (
                      <Pressable
                        style={({ pressed }) => [styles.txLinkBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => {
                          void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${detailPayout.txSignature}`).catch(() => {
                            showToast("Could not open transaction details right now", "error");
                          });
                        }}
                      >
                        <Ionicons name="link-outline" size={12} color={YES_COLOR} />
                        <Text style={[styles.txLinkText, { color: YES_COLOR }]}>View claim</Text>
                        <Ionicons name="open-outline" size={11} color={YES_COLOR} />
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            )}
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      {detailMarket && detailUserStake && detailMarket.resolvedOutcome && detailMarket.resolvedAt && (
        <DisputeModal
          visible={disputeModalVisible}
          onClose={() => setDisputeModalVisible(false)}
          pollId={detailMarket.id}
          question={detailMarket.question}
          resolvedOutcome={detailMarket.resolvedOutcome}
          resolvedAt={detailMarket.resolvedAt}
          platformWallet={platformWallet}
          challengeWindowHours={disputeChallengeHours}
          disputeDepositSkr={disputeDepositSkr}
          onSuccess={() => {
            void Promise.all([onRefresh(), refreshDetailDisputeStatus(detailMarket.id)]);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (palette: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.parchment,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: palette.line,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    title: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 24,
      letterSpacing: -0.5,
      color: palette.coal,
    },
    balancePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "#14F19512",
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1.5,
    },
    balanceDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "#14F195",
    },
    balanceText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: "#14F195",
    },
    listContent: {
      padding: 16,
      paddingBottom: 32,
    },
    statsBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: palette.milk,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.line,
      padding: 14,
      marginBottom: 14,
    },
    statItem: {
      flex: 1,
      alignItems: "center",
    },
    statValue: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: palette.coal,
      marginBottom: 2,
    },
    statLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      letterSpacing: 0.3,
    },
    statDivider: {
      width: 1,
      height: 28,
      backgroundColor: palette.line,
    },
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: palette.milk,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: CYAN,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      marginTop: 2,
    },
    searchInput: {
      flex: 1,
      fontFamily: "Manrope_600SemiBold",
      fontSize: 14,
      color: palette.coal,
      paddingVertical: 2,
    },
    endingSoonSection: {
      marginBottom: 12,
    },
    endingSoonTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      letterSpacing: 0.4,
      color: AMBER,
      marginBottom: 8,
      textTransform: "uppercase",
    },
    endingSoonList: {
      gap: 8,
      paddingRight: 6,
    },
    endingSoonCard: {
      width: 230,
      backgroundColor: palette.milk,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: `${AMBER}35`,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    endingSoonQuestion: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      lineHeight: 16,
      color: palette.coal,
      marginBottom: 6,
    },
    endingSoonMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    endingSoonMetaText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 11,
      color: AMBER,
    },
    categoryRow: {
      gap: 8,
      marginBottom: 10,
      paddingRight: 8,
    },
    categoryChip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: palette.milk,
    },
    categoryChipActive: {
      borderColor: PURPLE,
      backgroundColor: `${PURPLE}14`,
    },
    categoryChipText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.5,
      color: palette.muted,
    },
    categoryChipTextActive: {
      color: PURPLE,
    },
    filterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    filterChip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: palette.milk,
    },
    filterChipActive: {
      borderColor: CYAN,
      backgroundColor: `${CYAN}15`,
    },
    filterText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      color: palette.muted,
      letterSpacing: 0.4,
    },
    filterTextActive: {
      color: CYAN,
    },
    sortBtn: {
      width: 32,
      height: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.line,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.parchment,
    },
    sortSheet: {
      backgroundColor: palette.milk,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 36,
    },
    sortTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: palette.coal,
      marginBottom: 16,
      marginTop: 4,
    },
    sortOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: 12,
      marginBottom: 4,
    },
    sortOptionText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 15,
      color: palette.coal,
    },
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.58)",
    },
    detailSheet: {
      backgroundColor: palette.milk,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 18,
      paddingTop: 12,
      maxHeight: "85%",
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: palette.line,
      alignSelf: "center",
      marginBottom: 12,
    },
    detailHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    detailHeaderActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    detailStatusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    detailStatusText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.5,
    },
    detailQuestion: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 19,
      lineHeight: 26,
      color: palette.coal,
      marginBottom: 12,
    },
    detailMetaRow: {
      flexDirection: "row",
      marginBottom: 14,
    },
    detailMetaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: palette.parchment,
      borderWidth: 1,
      borderColor: palette.line,
    },
    detailMetaText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },
    detailActionRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 4,
    },
    detailStakeBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    detailStakeBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      letterSpacing: 0.5,
      color: "#040608",
    },
    resolutionSection: {
      marginTop: 2,
      gap: 10,
    },
    resolutionBadgeRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
    },
    resolutionOutcomeBadge: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    resolutionOutcomeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.5,
    },
    warningBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: `${AMBER}12`,
      borderWidth: 1,
      borderColor: `${AMBER}30`,
    },
    warningText: {
      flex: 1,
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: AMBER,
    },
    resolutionNoteBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: `${CYAN}10`,
      borderWidth: 1,
      borderColor: `${CYAN}30`,
    },
    resolutionNoteText: {
      flex: 1,
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: palette.coal,
      lineHeight: 17,
    },
    disputeStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    disputeStatusLabel: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: palette.muted,
    },
    disputeStatusBadge: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: `${AMBER}18`,
    },
    disputeStatusText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      letterSpacing: 0.5,
      color: AMBER,
    },
    claimDelayBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: `${PURPLE}12`,
      borderWidth: 1,
      borderColor: `${PURPLE}30`,
    },
    claimDelayText: {
      flex: 1,
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: PURPLE,
    },
    challengeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    challengeText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: AMBER,
    },
    disputeBtn: {
      marginTop: 2,
      backgroundColor: AMBER,
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    disputeBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
      letterSpacing: 0.5,
      color: "#040608",
    },
    claimHintText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: palette.muted,
    },
    txLinksRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    txLinkBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "#9945FF14",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    txLinkText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 11,
      color: "#9945FF",
    },
    txInlineLinkRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      marginTop: 10,
      paddingVertical: 4,
    },
    txInlineLinkText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
  });
