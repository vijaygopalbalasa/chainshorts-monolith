import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useSession } from "../state/sessionStore";
import { fetchLeaderboard, type LeaderboardEntry, type UserRank } from "../services/api";
import { useToast } from "../context/ToastContext";

/* ─── Constants ─────────────────────────────────────────────────────────────── */

const GOLD = "#FFD700";
const SILVER = "#A8A8A8";
const BRONZE = "#CD7F32";
const GREEN = "#14F195";
const RED = "#FF4455";

const PERIODS = ["all", "week", "month"] as const;
const PERIOD_LABELS: Record<string, string> = {
  all: "All Time",
  week: "This Week",
  month: "This Month",
};

const SORTS = ["profit", "winRate", "volume"] as const;
const SORT_LABELS: Record<string, string> = {
  profit: "Profit",
  winRate: "Win Rate",
  volume: "Volume",
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function shortWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 5)}...${wallet.slice(-4)}`;
}

function formatProfit(value: number): string {
  const abs = Math.abs(value);
  const prefix = value >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toLocaleString()}`;
}

function getRankColor(rank: number): string {
  if (rank === 1) return GOLD;
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  return "transparent";
}

/* ─── Row Component ─────────────────────────────────────────────────────────── */

function LeaderboardRow({
  item,
  isCurrentUser,
  palette,
  sortBy,
}: {
  item: LeaderboardEntry;
  isCurrentUser: boolean;
  palette: any;
  sortBy: "profit" | "winRate" | "volume";
}) {
  const medalColor = getRankColor(item.rank);
  const isTopThree = item.rank <= 3;
  const profitColor = item.totalProfitSkr >= 0 ? GREEN : RED;

  return (
    <View
      style={[
        rowStyles.row,
        {
          backgroundColor: isCurrentUser
            ? `${GREEN}0F`
            : palette.milk,
          borderLeftWidth: isCurrentUser ? 3 : 0,
          borderLeftColor: isCurrentUser ? GREEN : "transparent",
          borderBottomColor: palette.line,
        },
      ]}
    >
      {/* Rank */}
      <View style={rowStyles.rankCol}>
        {isTopThree ? (
          <View style={[rowStyles.medalBadge, { backgroundColor: `${medalColor}25`, borderColor: `${medalColor}60` }]}>
            <Text style={[rowStyles.medalText, { color: medalColor }]}>{item.rank}</Text>
          </View>
        ) : (
          <Text style={[rowStyles.rankText, { color: palette.muted }]}>{item.rank}</Text>
        )}
      </View>

      {/* Trader */}
      <View style={rowStyles.traderCol}>
        <Text
          style={[
            rowStyles.wallet,
            { color: isCurrentUser ? GREEN : palette.coal },
          ]}
          numberOfLines={1}
        >
          {shortWallet(item.wallet)}
          {isCurrentUser && (
            <Text style={[rowStyles.youBadge, { color: GREEN }]}> YOU</Text>
          )}
        </Text>
        <Text style={[rowStyles.subtext, { color: palette.muted }]}>
          {item.predictionCount} {item.predictionCount === 1 ? "bet" : "bets"}
        </Text>
      </View>

      {/* Win Rate */}
      <View style={rowStyles.wrCol}>
        <Text
          style={[
            rowStyles.statValue,
            {
              color:
                sortBy === "winRate"
                  ? palette.coal
                  : palette.muted,
              fontFamily:
                sortBy === "winRate"
                  ? "Manrope_700Bold"
                  : "Manrope_500Medium",
            },
          ]}
        >
          {item.winRate}%
        </Text>
      </View>

      {/* Profit */}
      <View style={rowStyles.profitCol}>
        <Text
          style={[
            rowStyles.profitValue,
            {
              color: profitColor,
              opacity: sortBy === "profit" ? 1 : 0.7,
            },
          ]}
        >
          {formatProfit(item.totalProfitSkr)}
        </Text>
        <Text style={[rowStyles.profitUnit, { color: palette.muted }]}>SKR</Text>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankCol: {
    width: 52,
    alignItems: "center",
  },
  medalBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  medalText: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 13,
  },
  rankText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 15,
  },
  traderCol: {
    flex: 1,
    marginRight: 8,
  },
  wallet: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    marginBottom: 1,
  },
  youBadge: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  subtext: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
  },
  wrCol: {
    width: 52,
    alignItems: "flex-end",
    marginRight: 16,
  },
  statValue: {
    fontSize: 14,
  },
  profitCol: {
    width: 72,
    alignItems: "flex-end",
  },
  profitValue: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 14,
  },
  profitUnit: {
    fontFamily: "Manrope_500Medium",
    fontSize: 10,
  },
});

/* ─── Column Headers ─────────────────────────────────────────────────────────── */

function ColumnHeaders({
  palette,
  sortBy,
}: {
  palette: any;
  sortBy: "profit" | "winRate" | "volume";
}) {
  return (
    <View
      style={[
        colStyles.row,
        { backgroundColor: `${palette.milk}CC`, borderBottomColor: palette.line, borderTopColor: palette.line },
      ]}
    >
      <View style={colStyles.rankCol}>
        <Text style={[colStyles.label, { color: palette.muted }]}>#</Text>
      </View>
      <View style={colStyles.traderCol}>
        <Text style={[colStyles.label, { color: palette.muted }]}>TRADER</Text>
      </View>
      <View style={colStyles.wrCol}>
        <Text
          style={[
            colStyles.label,
            { color: sortBy === "winRate" ? GREEN : palette.muted },
          ]}
        >
          WR
          {sortBy === "winRate" && " ↓"}
        </Text>
      </View>
      <View style={colStyles.profitCol}>
        <Text
          style={[
            colStyles.label,
            { color: sortBy === "profit" ? GREEN : palette.muted },
          ]}
        >
          PROFIT
          {sortBy === "profit" && " ↓"}
        </Text>
      </View>
    </View>
  );
}

const colStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingRight: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankCol: { width: 52, alignItems: "center" },
  traderCol: { flex: 1, marginRight: 8 },
  wrCol: { width: 52, alignItems: "flex-end", marginRight: 16 },
  profitCol: { width: 72, alignItems: "flex-end" },
  label: {
    fontFamily: "Manrope_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
});

/* ─── Your Stats Banner ──────────────────────────────────────────────────────── */

function YourStatsBanner({
  userRank,
  palette,
  fadeAnim,
}: {
  userRank: UserRank;
  palette: any;
  fadeAnim: Animated.Value;
}) {
  const profitColor = userRank.totalProfitSkr >= 0 ? GREEN : RED;

  return (
    <Animated.View
      style={[
        bannerStyles.card,
        {
          backgroundColor: palette.milk,
          borderColor: `${GREEN}40`,
          opacity: fadeAnim,
        },
      ]}
    >
      <View style={bannerStyles.headerRow}>
        <Ionicons name="person-circle-outline" size={14} color={GREEN} />
        <Text style={[bannerStyles.headerLabel, { color: GREEN }]}>YOUR STATS</Text>
        <View style={bannerStyles.spacer} />
        <View style={[bannerStyles.rankBadge, { backgroundColor: `${GREEN}18`, borderColor: `${GREEN}40` }]}>
          <Text style={[bannerStyles.rankText, { color: GREEN }]}>
            #{userRank.rank}
          </Text>
        </View>
        {userRank.percentile != null && userRank.percentile > 0 && (
          <Text style={[bannerStyles.percentile, { color: palette.muted }]}>
            · Top {userRank.percentile}%
          </Text>
        )}
      </View>

      <View style={bannerStyles.statsRow}>
        <View style={bannerStyles.stat}>
          <Text style={[bannerStyles.statVal, { color: profitColor }]}>
            {formatProfit(userRank.totalProfitSkr)}{" "}
            <Text style={[bannerStyles.statUnit, { color: palette.muted }]}>SKR</Text>
          </Text>
          <Text style={[bannerStyles.statLabel, { color: palette.muted }]}>Profit</Text>
        </View>
        <View style={[bannerStyles.statDivider, { backgroundColor: palette.line }]} />
        <View style={bannerStyles.stat}>
          <Text style={[bannerStyles.statVal, { color: palette.coal }]}>
            {userRank.winRate}%
          </Text>
          <Text style={[bannerStyles.statLabel, { color: palette.muted }]}>Win Rate</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  headerLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 1,
  },
  spacer: { flex: 1 },
  rankBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rankText: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 14,
  },
  percentile: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stat: {
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 28,
    marginHorizontal: 16,
  },
  statVal: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 20,
    marginBottom: 1,
  },
  statUnit: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
  },
  statLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
  },
});

/* ─── Main Screen ───────────────────────────────────────────────────────────── */

export function LeaderboardScreen() {
  const { palette } = useTheme();
  const styles = getStyles(palette);
  const { session } = useSession();
  const { showToast } = useToast();

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<UserRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [sortBy, setSortBy] = useState<"profit" | "winRate" | "volume">("profit");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;

  const currentWallet = session.mode === "wallet" ? session.walletAddress : undefined;

  const animateIn = useCallback(() => {
    fadeAnim.setValue(0);
    listAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(listAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, listAnim]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await fetchLeaderboard({
        period,
        sortBy,
        limit: 100,
        wallet: currentWallet,
        sessionToken: session.mode === "wallet" ? session.sessionToken : undefined,
      });
      setLeaderboard(data.leaderboard);
      setUserRank(data.userRank);
      animateIn();
    } catch {
      showToast("Failed to load leaderboard", "error");
      setLeaderboard([]);
      setUserRank(null);
    }
  }, [period, sortBy, currentWallet, session, animateIn, showToast]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadLeaderboard();
      setLoading(false);
    };
    void init();
  }, [loadLeaderboard]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLeaderboard();
    setRefreshing(false);
  }, [loadLeaderboard]);

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardEntry }) => (
      <LeaderboardRow
        item={item}
        isCurrentUser={!!currentWallet && item.wallet === currentWallet}
        palette={palette}
        sortBy={sortBy}
      />
    ),
    [currentWallet, palette, sortBy]
  );

  /* ─── Loading ─────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Ionicons name="trophy" size={20} color={GOLD} />
          <Text style={[styles.headerTitle, { color: palette.coal }]}>LEADERBOARD</Text>
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading rankings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ─── Main ────────────────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: palette.line }]}>
        <Ionicons name="trophy" size={20} color={GOLD} />
        <Text style={[styles.headerTitle, { color: palette.coal }]}>LEADERBOARD</Text>
        <View style={styles.headerRight}>
          <Text style={[styles.entryCount, { color: palette.muted }]}>
            {leaderboard.length} traders
          </Text>
        </View>
      </View>

      {/* ── Period Tabs ──────────────────────────────────────────────────────── */}
      <View style={[styles.periodRow, { borderBottomColor: palette.line }]}>
        {PERIODS.map((p) => {
          const isActive = period === p;
          return (
            <Pressable
              key={p}
              style={[styles.periodTab, isActive && { borderBottomColor: palette.coal }]}
              onPress={() => setPeriod(p)}
            >
              <Text
                style={[
                  styles.periodTabText,
                  { color: isActive ? palette.coal : palette.muted },
                ]}
              >
                {PERIOD_LABELS[p]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Sort Tabs ────────────────────────────────────────────────────────── */}
      <View style={[styles.sortRow, { backgroundColor: `${palette.milk}80`, borderBottomColor: palette.line }]}>
        <Text style={[styles.sortByLabel, { color: palette.muted }]}>Sort by</Text>
        {SORTS.map((s) => {
          const isActive = sortBy === s;
          return (
            <Pressable
              key={s}
              style={[
                styles.sortPill,
                isActive && { backgroundColor: GREEN, borderColor: GREEN },
                !isActive && { borderColor: palette.line },
              ]}
              onPress={() => setSortBy(s)}
            >
              <Text
                style={[
                  styles.sortPillText,
                  { color: isActive ? "#000" : palette.muted },
                ]}
              >
                {SORT_LABELS[s]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Animated.View
        style={[
          styles.listWrapper,
          {
            opacity: listAnim,
            transform: [
              {
                translateY: listAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      >
        <FlatList
          data={leaderboard}
          keyExtractor={(item) => item.wallet}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={GREEN}
            />
          }
          ListHeaderComponent={
            <>
              {/* Your Stats Banner */}
              {userRank && currentWallet && (
                <YourStatsBanner
                  userRank={userRank}
                  palette={palette}
                  fadeAnim={fadeAnim}
                />
              )}

              {/* Column Headers */}
              {leaderboard.length > 0 && (
                <ColumnHeaders palette={palette} sortBy={sortBy} />
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={[styles.emptyIconCircle, { backgroundColor: `${GOLD}12` }]}>
                <Ionicons name="trophy-outline" size={44} color={GOLD} />
              </View>
              <Text style={[styles.emptyTitle, { color: palette.coal }]}>
                No rankings yet
              </Text>
              <Text style={[styles.emptySubtext, { color: palette.muted }]}>
                Make predictions and settle them to appear on the leaderboard.
              </Text>
            </View>
          }
        />
      </Animated.View>
    </SafeAreaView>
  );
}

/* ─── Styles ────────────────────────────────────────────────────────────────── */

const getStyles = (palette: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.parchment,
    },

    /* Header */
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
    },
    headerTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      letterSpacing: 1.5,
    },
    headerRight: {
      flex: 1,
      alignItems: "flex-end",
    },
    entryCount: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
    },

    /* Period tabs */
    periodRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      paddingHorizontal: 16,
    },
    periodTab: {
      paddingVertical: 11,
      paddingHorizontal: 8,
      marginRight: 4,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    periodTabText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
    },

    /* Sort row */
    sortRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
    },
    sortByLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      marginRight: 4,
    },
    sortPill: {
      borderRadius: 16,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    sortPillText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
    },

    /* List */
    listWrapper: {
      flex: 1,
    },
    listContent: {
      paddingBottom: 32,
    },

    /* Loading */
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
    },
    loadingText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
    },

    /* Empty */
    emptyWrap: {
      paddingTop: 72,
      paddingHorizontal: 40,
      alignItems: "center",
    },
    emptyIconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    emptyTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      marginBottom: 8,
    },
    emptySubtext: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      textAlign: "center",
      lineHeight: 20,
    },
  });
