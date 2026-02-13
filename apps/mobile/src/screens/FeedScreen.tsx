import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  InteractionManager,
  type LayoutChangeEvent,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import type { FeedCard } from "@chainshorts/shared";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { BrandBackground, CategoryChips, NewsCard, SkeletonCard, ScrollUpHint } from "../components";
import { SponsoredCard } from "../components/SponsoredCard";
import { PredictionFeedCard } from "../components/PredictionFeedCard";
import { QuickStakeSheet } from "../components/QuickStakeSheet";
import { parseHttpUrl } from "../utils/url";
import {
  fetchBookmarks,
  fetchClientConfig,
  fetchFeed,
  fetchFeedFreshness,
  fetchWalletBalances,
  friendlyError,
  removeBookmark,
  saveBookmark,
  searchFeed
} from "../services/api";
import type { FeedFreshnessResponse } from "../types";
import { useSession } from "../state/sessionStore";
import { spacing, textStyles, useTheme } from "../theme";
import { useToast } from "../context/ToastContext";
import { FEED_TOPIC_LABELS, FEED_TOPIC_ORDER, type FeedTopic, resolveFeedTopic } from "../utils/feedTopics";

const FEED_CACHE_KEY = "cs_feed_v2";
const FEED_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — stale but usable

function mergeUniqueById(previous: FeedCard[], incoming: FeedCard[]): FeedCard[] {
  const items = new Map<string, FeedCard>();
  for (const item of previous) {
    items.set(item.id, item);
  }
  for (const item of incoming) {
    items.set(item.id, item);
  }
  return [...items.values()];
}


function formatFreshnessAge(staleMinutes: number): string {
  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    return "just now";
  }
  if (staleMinutes < 60) {
    return `${Math.round(staleMinutes)}m ago`;
  }
  const hours = Math.floor(staleMinutes / 60);
  const minutes = Math.round(staleMinutes % 60);
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Returns true if the URL looks like a site homepage (path is / or empty). */
function isHomepageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" || parsed.pathname === "";
  } catch {
    return false;
  }
}

export function FeedScreen() {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => getStyles(palette, isDark), [isDark, palette]);
  const navigation = useNavigation<any>();

  const { session } = useSession();
  const { showToast } = useToast();

  const [items, setItems] = useState<FeedCard[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<FeedTopic>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [freshness, setFreshness] = useState<FeedFreshnessResponse | null>(null);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [feedViewportHeight, setFeedViewportHeight] = useState(0);
  const [showScrollHint, setShowScrollHint] = useState(true);

  const [usingCache, setUsingCache] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [activeSponsoredCard, setActiveSponsoredCard] = useState<FeedCard | null>(null);
  const sponsoredOverlayAnim = useRef(new Animated.Value(0)).current;
  // Prediction stake sheet state
  const [stakeSheetData, setStakeSheetData] = useState<{
    pollId: string;
    side: "yes" | "no";
    yesOdds: number;
    noOdds: number;
  } | null>(null);
  const [skrBalance, setSkrBalance] = useState(0);
  const [platformWallet, setPlatformWallet] = useState("");
  const flatListRef = useRef<FlatList<FeedCard>>(null);
  const currentSnapIndexRef = useRef(0);
  const activeSponsoredCardRef = useRef<FeedCard | null>(null);
  const storyCardHeightRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(false);
  // Refs for cursor and hasMore — avoids stale closure in load() and
  // prevents load from being recreated on every page, which would trigger
  // the reset useEffect and wipe accumulated items back to page 1.
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const bookmarkInFlightRef = useRef(new Set<string>());
  const searchInputRef = useRef<TextInput>(null);
  const tabBarHeight = useBottomTabBarHeight();
  const activeSearchQuery = useMemo(() => searchQuery.trim(), [searchQuery]);
  const storyCardHeight = useMemo(() => {
    if (!feedViewportHeight) {
      return undefined;
    }
    return feedViewportHeight;
  }, [feedViewportHeight]);

  // Auto-focus search input when search becomes visible
  useEffect(() => {
    if (searchVisible) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [searchVisible]);

  const loadBookmarksIndex = useCallback(async () => {
    if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
      setBookmarkIds(new Set());
      return;
    }

    try {
      const ids = new Set<string>();
      let nextCursor: string | undefined;
      for (let pageCount = 0; pageCount < 4; pageCount += 1) {
        const page = await fetchBookmarks({
          wallet: session.walletAddress,
          cursor: nextCursor,
          sessionToken: session.sessionToken
        });
        for (const item of page.items) {
          ids.add(item.id);
        }
        if (!page.nextCursor) {
          break;
        }
        nextCursor = page.nextCursor;
      }
      setBookmarkIds(ids);
    } catch {
      // Feed still works even if bookmark sync fails.
    }
  }, [session.mode, session.sessionToken, session.walletAddress]);

  const loadFreshness = useCallback(async () => {
    try {
      const status = await fetchFeedFreshness(session.sessionToken);
      setFreshness(status);
    } catch {
      // Keep feed usable on freshness fetch errors.
    }
  }, [session.sessionToken]);

  const load = useCallback(
    async (mode: "reset" | "append") => {
      if (inFlightRef.current) return;
      // Use refs so load() is not recreated when cursor/hasMore change —
      // prevents the reset useEffect from firing on every page load.
      if (mode === "append" && (!hasMoreRef.current || !cursorRef.current)) return;

      inFlightRef.current = true;
      setLoading(true);

      try {
        if (mode === "reset") {
          // Clear refs so a stale cursor from a previous session can't leak in
          cursorRef.current = undefined;
          hasMoreRef.current = true;
        }
        const nextCursor = mode === "append" ? cursorRef.current : undefined;
        // Pass wallet address for personalized feed filtering (hides predictions user already staked on)
        const walletForFilter = session.mode === "wallet" ? session.walletAddress : undefined;
        const response =
          activeSearchQuery.length >= 3
            ? await searchFeed(
              {
                q: activeSearchQuery,
                cursor: nextCursor,
                lang: "en",
                limit: 50,
                wallet: walletForFilter,
              },
              session.sessionToken
            )
            : await fetchFeed(
              {
                cursor: nextCursor,
                lang: "en",
                limit: 50,
                wallet: walletForFilter,
              },
              session.sessionToken
            );

        // Update refs first so subsequent calls see fresh values immediately
        cursorRef.current = response.nextCursor;
        hasMoreRef.current = Boolean(response.nextCursor);
        // Update state for any UI that needs reactivity
        setCursor(response.nextCursor);
        setHasMore(Boolean(response.nextCursor));

        const nextItems = response.items;
        setItems((previous) => (mode === "append" ? mergeUniqueById(previous, nextItems) : nextItems));
        if (mode === "reset") {
          setUsingCache(false);
          // Persist fresh feed to cache for offline-first next open
          void AsyncStorage.setItem(
            FEED_CACHE_KEY,
            JSON.stringify({ items: nextItems.slice(0, 30), cachedAt: Date.now() })
          ).catch(() => {});
          void loadFreshness();
          void loadBookmarksIndex();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        const isNetwork = /network|timeout|connect|reach/i.test(msg);
        showToast(isNetwork ? "No connection — pull to refresh" : "Couldn't load feed — pull to refresh", "error");
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    // cursor and hasMore intentionally removed — use refs to prevent load()
    // from being recreated on every page, which would reset the feed to page 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSearchQuery, loadBookmarksIndex, loadFreshness, session.sessionToken, showToast]
  );

  const visibleItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (selectedCategory !== "all" && resolveFeedTopic(item) !== selectedCategory) return false;
      if (seen.has(item.id)) return false; // drop duplicate IDs (e.g. same sponsored slot across pages)
      seen.add(item.id);
      return true;
    });
  }, [items, selectedCategory]);

  // On mount: load cached feed instantly so users see content on slow networks
  useEffect(() => {
    void AsyncStorage.getItem(FEED_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const cached = JSON.parse(raw) as { items: FeedCard[]; cachedAt: number };
        const age = Date.now() - (cached.cachedAt ?? 0);
        if (cached.items?.length > 0 && age < FEED_CACHE_TTL_MS) {
          setItems((prev) => (prev.length === 0 ? cached.items : prev));
          setUsingCache(true);
        }
      })
      .catch(() => {
        // Cache read failure is non-fatal — live fetch proceeds normally.
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load("reset");
  }, [load]);

  // Refresh feed when user taps Feed tab while already on Feed
  const isFocused = useIsFocused();
  const wasFocusedRef = useRef(isFocused);

  useEffect(() => {
    wasFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    if (session.mode === "wallet") {
      void loadBookmarksIndex();
    } else {
      setBookmarkIds(new Set());
    }
  }, [loadBookmarksIndex, session.mode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Scroll to top immediately so the user sees the latest content appear at position 0
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    await loadFreshness();
    await loadBookmarksIndex();
    await load("reset");
    setRefreshing(false);
  }, [load, loadBookmarksIndex, loadFreshness]);

  // Refresh feed when user taps or long-presses Feed tab while already on Feed
  useEffect(() => {
    const handler = () => {
      if (wasFocusedRef.current) {
        void onRefresh();
      }
    };
    const unsubTap = navigation.addListener("tabPress", handler);
    const unsubLong = navigation.addListener("tabLongPress", handler);
    return () => { unsubTap(); unsubLong(); };
  }, [navigation, onRefresh]);

  const openSource = useCallback((article: FeedCard) => {
    if (isHomepageUrl(article.sourceUrl)) {
      showToast("Original article unavailable — source only provides a homepage link.", "info");
      return;
    }
    const url = parseHttpUrl(article.sourceUrl)?.toString();
    if (url) {
      navigation.navigate("ArticleWebView", { url, title: article.headline });
    }
  }, [navigation, showToast]);

  const toggleBookmark = useCallback(
    async (article: FeedCard) => {
      if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
        showToast("Connect your wallet to save stories.", "info");
        return;
      }

      if (bookmarkInFlightRef.current.has(article.id)) {
        return;
      }
      bookmarkInFlightRef.current.add(article.id);

      const isBookmarked = bookmarkIds.has(article.id);
      try {
        if (isBookmarked) {
          await removeBookmark({
            wallet: session.walletAddress,
            articleId: article.id,
            sessionToken: session.sessionToken
          });
          setBookmarkIds((previous) => {
            const next = new Set(previous);
            next.delete(article.id);
            return next;
          });
        } else {
          await saveBookmark({
            wallet: session.walletAddress,
            articleId: article.id,
            sessionToken: session.sessionToken
          });
          setBookmarkIds((previous) => new Set(previous).add(article.id));
        }
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        showToast(friendlyError(error, "Couldn't update bookmark — please try again"), "error");
      } finally {
        bookmarkInFlightRef.current.delete(article.id);
      }
    },
    [bookmarkIds, session.mode, session.sessionToken, session.walletAddress, showToast]
  );

  // Determine feed status copy and indicator based on freshness
  const liveDotColor = freshness?.stale === true ? palette.ember : palette.lime;
  const livePillText = freshness?.stale === true ? "SYNCING FEED" : "LIVE FEED";
  const freshnessPillText = usingCache && !freshness
    ? "OFFLINE CACHE"
    : freshness
      ? `UPDATED ${formatFreshnessAge(freshness.staleMinutes).toUpperCase()}`
      : session.mode === "wallet"
        ? "WALLET VERIFIED"
        : "GUEST MODE";

  // Keep refs in sync with state/derived values for PanResponder closures
  useEffect(() => { activeSponsoredCardRef.current = activeSponsoredCard; }, [activeSponsoredCard]);
  useEffect(() => { storyCardHeightRef.current = storyCardHeight; }, [storyCardHeight]);

  // PanResponder on the sponsored overlay — detects swipes to scroll FlatList and dismiss
  const overlayPanResponder = useRef(
    PanResponder.create({
      // Don't claim on touch start — lets SponsoredCard Pressable receive taps
      onStartShouldSetPanResponder: () => false,
      // Claim once user moves enough to indicate a scroll gesture
      onMoveShouldSetPanResponder: (_, gs) =>
        activeSponsoredCardRef.current !== null && Math.abs(gs.dy) > 5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dy) < 20) return; // micro-movement, not a real swipe
        const h = storyCardHeightRef.current;
        if (!h) return;
        const dir = gs.dy < 0 ? 1 : -1; // swipe up = next card, swipe down = prev
        const nextIdx = Math.max(0, currentSnapIndexRef.current + dir);
        // Programmatically scroll FlatList to the adjacent snap point
        (flatListRef.current as any)?.scrollToOffset({ offset: nextIdx * h, animated: true });
        // Fade overlay out; defer Modal close until scroll animation finishes to avoid jank
        Animated.timing(sponsoredOverlayAnim, { toValue: 0, duration: 150, useNativeDriver: true })
          .start(() => InteractionManager.runAfterInteractions(() => setActiveSponsoredCard(null)));
      },
    })
  ).current;

  // Pulse animation for the live dot (loops while feed is live)
  useEffect(() => {
    if (freshness?.stale === false) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true })
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [freshness?.stale, pulseAnim]);

  // Fetch platform config and wallet balance when stake sheet opens
  useEffect(() => {
    if (!stakeSheetData) return;
    const loadPredictionData = async () => {
      try {
        const config = await fetchClientConfig();
        setPlatformWallet(config.platformWallet ?? "");
        if (session.mode === "wallet" && session.walletAddress) {
          const balances = await fetchWalletBalances(session.walletAddress);
          setSkrBalance(balances.skrUi ?? 0);
        }
      } catch {
        // Continue with defaults
      }
    };
    void loadPredictionData();
  }, [stakeSheetData, session.mode, session.walletAddress]);

  // First-load skeleton: items empty and loading
  const showSkeleton = items.length === 0 && loading;

  // Dismiss scroll hint when user scrolls
  const handleScroll = useCallback(() => {
    if (showScrollHint) {
      setShowScrollHint(false);
    }
  }, [showScrollHint]);

  // Hide sponsored overlay when user starts scrolling away
  const handleScrollBeginDrag = useCallback(() => {
    if (activeSponsoredCard) {
      Animated.timing(sponsoredOverlayAnim, { toValue: 0, duration: 150, useNativeDriver: true })
        .start(() => InteractionManager.runAfterInteractions(() => setActiveSponsoredCard(null)));
    }
    if (showScrollHint) setShowScrollHint(false);
  }, [activeSponsoredCard, sponsoredOverlayAnim, showScrollHint]);

  // Show sponsored overlay when user snaps to a sponsored card
  const handleMomentumScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = event.nativeEvent.contentOffset.y;
      const idx = storyCardHeight ? Math.round(y / storyCardHeight) : 0;
      currentSnapIndexRef.current = idx; // track for PanResponder swipe direction
      const item = visibleItems[idx];
      if (item?.cardType === "sponsored") {
        setActiveSponsoredCard(item);
        Animated.timing(sponsoredOverlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      } else {
        setActiveSponsoredCard(null);
        sponsoredOverlayAnim.setValue(0);
      }
    },
    [storyCardHeight, visibleItems, sponsoredOverlayAnim]
  );

  const onFeedLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    setFeedViewportHeight((previous) => (Math.abs(previous - height) > 1 ? height : previous));
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <BrandBackground />

      <View style={styles.feedHeadingRow}>
        <View>
          <Text style={styles.feedHeading}>CHAINSHORTS</Text>
          <Text style={styles.feedSubheading}>WEB3 NEWS IN 60 WORDS</Text>
        </View>
        <Pressable
          style={styles.searchIconButton}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setSearchVisible((v) => !v);
          }}
          accessibilityLabel="Toggle search"
          accessibilityRole="button"
        >
          <Ionicons name="search-outline" size={22} color={palette.ink} />
        </Pressable>
      </View>

      <CategoryChips
        categories={[...FEED_TOPIC_ORDER]}
        selected={selectedCategory}
        onSelect={(category) => {
          setSelectedCategory(category as FeedTopic);
          flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }}
        labels={FEED_TOPIC_LABELS}
      />

      {searchVisible ? (
        <View>
          <View style={styles.searchRow}>
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search web3 stories (min 3 chars)"
              placeholderTextColor={palette.muted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search stories"
              accessibilityHint="Type at least 3 characters to search"
            />
            <Pressable
              style={styles.searchCloseButton}
              onPress={() => {
                setSearchQuery("");
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setSearchVisible(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Ionicons name="close-outline" size={22} color={palette.parchment} />
            </Pressable>
          </View>
          {searchQuery.length > 0 && searchQuery.length < 3 ? (
            <Text style={styles.searchHint}>{searchQuery.length}/3 min</Text>
          ) : null}
        </View>
      ) : null}

      {showSkeleton ? (
        <View style={styles.skeletonContainer}>
          <Animated.View style={[styles.cardContainer, storyCardHeight ? { height: storyCardHeight } : null]}>
            <SkeletonCard viewportHeight={storyCardHeight} />
          </Animated.View>
          <Animated.View style={[styles.cardContainer, storyCardHeight ? { height: storyCardHeight } : null]}>
            <SkeletonCard viewportHeight={storyCardHeight} />
          </Animated.View>
        </View>
      ) : (
        <View style={styles.feedContainer} onLayout={onFeedLayout}>
          <FlatList
            ref={flatListRef}
            data={visibleItems}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            pagingEnabled={Boolean(storyCardHeight)}
            decelerationRate="fast"
            onScroll={handleScroll}
            scrollEventThrottle={100}
            onScrollBeginDrag={handleScrollBeginDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.coal} />}
            removeClippedSubviews={true}
            windowSize={5}
            maxToRenderPerBatch={3}
            renderItem={({ item }) => {
              const isSponsoredItem = item.cardType === "sponsored" && item.sponsored;
              const isPredictionItem = item.cardType === "prediction" && item.prediction;
              const containerStyle = [
                styles.cardContainer,
                storyCardHeight ? { height: storyCardHeight } : null,
                (isSponsoredItem || isPredictionItem) ? { paddingHorizontal: 0 } : null,
              ];
              if (isSponsoredItem) {
                return (
                  <View style={containerStyle}>
                    <SponsoredCard card={item} />
                  </View>
                );
              }
              if (isPredictionItem && item.prediction) {
                return (
                  <View style={containerStyle}>
                    <PredictionFeedCard
                      card={item}
                      onStake={(pollId, side) => {
                        setStakeSheetData({
                          pollId,
                          side,
                          yesOdds: item.prediction!.yesOdds,
                          noOdds: item.prediction!.noOdds,
                        });
                      }}
                      onPress={() => {
                        navigation.navigate("Predict" as never, { focusPollId: item.prediction?.pollId } as never);
                      }}
                    />
                  </View>
                );
              }
              return (
                <View style={containerStyle}>
                  <NewsCard
                    article={item}
                    onOpen={() => void openSource(item)}
                    onShare={() => {
                      if (isHomepageUrl(item.sourceUrl)) return;
                      void Share.share({ message: `${item.headline}\n\n${item.sourceUrl}` });
                    }}
                    bookmarked={bookmarkIds.has(item.id)}
                    onBookmarkToggle={() => void toggleBookmark(item)}
                  />
                </View>
              );
            }}
            onEndReachedThreshold={0.25}
            onEndReached={() => void load("append")}
            ListFooterComponent={null}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>
                    {selectedCategory === "all" ? "No stories yet" : `No ${FEED_TOPIC_LABELS[selectedCategory]} stories yet`}
                  </Text>
                  <Text style={styles.emptyBody}>
                    {selectedCategory === "all"
                      ? "Pull to refresh or check your API/worker connection."
                      : "Try another topic or pull to refresh for new coverage."}
                  </Text>
                  <Pressable
                    style={styles.emptyButton}
                    onPress={() => void load("reset")}
                    accessibilityLabel="Reload feed"
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyButtonText}>Reload Feed</Text>
                  </Pressable>
                </View>
              )
            }
          />
        </View>
      )}

      {/* First-time user scroll hint - shows only once per user lifetime */}
      {showScrollHint && !showSkeleton && visibleItems.length > 0 && (
        <ScrollUpHint onDismiss={() => setShowScrollHint(false)} />
      )}

      {searchVisible ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="box-none">
          <Pressable style={Platform.OS === "web" ? { flex: 1 } : StyleSheet.absoluteFill} onPress={() => setSearchVisible(false)} />
        </View>
      ) : null}

      {/* Full-screen sponsored card — Modal renders above tab bar and status bar */}
      <Modal
        visible={!!activeSponsoredCard}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => {
          Animated.timing(sponsoredOverlayAnim, { toValue: 0, duration: 150, useNativeDriver: true })
            .start(() => InteractionManager.runAfterInteractions(() => setActiveSponsoredCard(null)));
        }}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.sponsoredOverlay, { opacity: sponsoredOverlayAnim }]}
          {...overlayPanResponder.panHandlers}
        >
          <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
            {activeSponsoredCard && <SponsoredCard card={activeSponsoredCard} />}
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* Quick stake sheet for prediction cards in feed */}
      {stakeSheetData && (
        <QuickStakeSheet
          visible={!!stakeSheetData}
          onClose={() => setStakeSheetData(null)}
          pollId={stakeSheetData.pollId}
          side={stakeSheetData.side}
          odds={stakeSheetData.side === "yes" ? stakeSheetData.yesOdds : stakeSheetData.noOdds}
          userBalance={skrBalance}
          platformWallet={platformWallet}
          onSuccess={() => {
            setStakeSheetData(null);
            showToast("Stake placed successfully!", "success");
          }}
          onNavigateToSwap={() => navigation.navigate("Wallet" as never)}
        />
      )}

    </SafeAreaView>
  );
}

const getStyles = (palette: any, isDark: boolean) => {
  const surfaceTint = isDark ? "rgba(12, 21, 32, 0.95)" : "rgba(255, 255, 255, 0.92)";
  const surfaceTintStrong = isDark ? "rgba(12, 21, 32, 0.98)" : "rgba(255, 255, 255, 0.98)";

  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.parchment,
    paddingTop: spacing.sm
  },
  sponsoredOverlay: {
    zIndex: 100,
    backgroundColor: "#0C0E14",
  },
  feedHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm
  },
  feedHeading: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.2,
    color: palette.coal
  },
  feedSubheading: {
    ...textStyles.badge,
    color: palette.emberDark
  },
  feedContainer: {
    flex: 1
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs
  },
  metaRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  livePill: {
    minHeight: 34,
    borderRadius: 4,
    backgroundColor: surfaceTint,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: palette.lime
  },
  liveText: {
    ...textStyles.badge,
    color: palette.coal
  },
  sessionPill: {
    minHeight: 34,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: surfaceTint,
    paddingHorizontal: spacing.md,
    justifyContent: "center"
  },
  sessionText: {
    ...textStyles.badge,
    color: palette.ink
  },
  searchIconButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: surfaceTint,
    justifyContent: "center",
    alignItems: "center"
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 4,
    backgroundColor: surfaceTintStrong,
    paddingHorizontal: spacing.md,
    ...textStyles.body,
    color: palette.coal
  },
  searchCloseButton: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 4,
    backgroundColor: palette.ember,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.sm
  },
  searchHint: {
    ...textStyles.caption,
    color: palette.muted,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs
  },
  skeletonContainer: {
    flex: 1,
    paddingTop: spacing.xs
  },
  listContent: {},
  cardContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: surfaceTint,
    borderRadius: 8,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    alignItems: "center",
    gap: spacing.sm
  },
  emptyTitle: {
    ...textStyles.subtitle,
    color: palette.coal
  },
  emptyBody: {
    ...textStyles.body,
    color: palette.muted,
    textAlign: "center"
  },
  emptyButton: {
    minHeight: 42,
    borderRadius: 4,
    backgroundColor: palette.ember,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.xs
  },
  emptyButtonText: {
    ...textStyles.badge,
    color: "#040608"
  }
});
};
