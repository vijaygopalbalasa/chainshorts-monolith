import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Alert, ActivityIndicator, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { FeedCard } from "@chainshorts/shared";
import { BrandBackground, SectionTitle, SkeletonCard } from "../components";
import { useToast } from "../context/ToastContext";
import { fetchBookmarks, friendlyError, removeBookmark } from "../services/api";
import { useSession } from "../state/sessionStore";
import { elevation, radii, spacing, textStyles, useTheme } from "../theme";
import { parseHttpUrl } from "../utils/url";

export function SavedScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  const { session } = useSession();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const [items, setItems] = useState<FeedCard[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const inFlightRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const load = useCallback(
    async (mode: "reset" | "append") => {
      if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
        setItems([]);
        setCursor(undefined);
        setHasMore(false);
        return;
      }

      if (inFlightRef.current) return;
      if (mode === "append" && (!hasMoreRef.current || !cursorRef.current)) return;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const response = await fetchBookmarks({
          wallet: session.walletAddress,
          cursor: mode === "append" ? cursorRef.current : undefined,
          sessionToken: session.sessionToken
        });

        setItems((previous) => (mode === "append" ? [...previous, ...response.items] : response.items));
        setCursor(response.nextCursor);
        setHasMore(Boolean(response.nextCursor));
        cursorRef.current = response.nextCursor;
        hasMoreRef.current = Boolean(response.nextCursor);
      } catch (error) {
        showToast(friendlyError(error, "Couldn't load saved stories — please try again"), "error");
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [session.mode, session.sessionToken, session.walletAddress, showToast]
  );

  useEffect(() => {
    void load("reset");
  }, [load, session.mode, session.sessionToken, session.walletAddress]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load("reset");
    setRefreshing(false);
  }, [load]);

  const remove = useCallback(
    async (article: FeedCard) => {
      if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
        return;
      }

      try {
        await removeBookmark({
          wallet: session.walletAddress,
          articleId: article.id,
          sessionToken: session.sessionToken
        });
        setItems((previous) => previous.filter((item) => item.id !== article.id));
      } catch (error) {
        showToast(friendlyError(error, "Couldn't remove bookmark — please try again"), "error");
      }
    },
    [session.mode, session.sessionToken, session.walletAddress, showToast]
  );

  const confirmRemove = useCallback(
    (item: FeedCard) => {
      Alert.alert(
        "Remove Bookmark",
        `Remove "${item.headline}" from your saved stories?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void remove(item);
            }
          }
        ]
      );
    },
    [remove]
  );

  if (session.mode !== "wallet") {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <BrandBackground />
        <SectionTitle title="Saved" subtitle="Bookmark stories once your wallet is connected." />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Wallet required</Text>
          <Text style={styles.emptyBody}>Connect your wallet from the Wallet tab to save and sync stories.</Text>
          <Pressable
            style={styles.connectButton}
            onPress={() => navigation.navigate("Wallet" as never)}
            accessibilityRole="button"
            accessibilityLabel="Go to wallet to connect"
          >
            <Text style={styles.connectButtonText}>Connect Wallet</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <BrandBackground />
      <SectionTitle title="Saved" subtitle="Your personal Chainshorts watchlist." />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.ink} />}
        onEndReachedThreshold={0.2}
        onEndReached={() => void load("append")}
        ListFooterComponent={loading ? <ActivityIndicator color={palette.coal} style={{ marginVertical: spacing.lg }} /> : null}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skeletonWrap}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No bookmarks yet</Text>
              <Text style={styles.emptyBody}>Save stories from the feed to build your research stack.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardSource}>{item.sourceName}</Text>
            <Text style={styles.cardHeadline}>{item.headline}</Text>
            <Text style={styles.cardSummary}>{item.summary60}</Text>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionButton, styles.actionPrimary]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.sourceName} article`}
                onPress={async () => {
                  const sourceUrl = parseHttpUrl(item.sourceUrl)?.toString();
                  if (!sourceUrl) {
                    showToast("This article has an invalid source URL.", "error");
                    return;
                  }
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  void WebBrowser.openBrowserAsync(sourceUrl).catch(() => {
                    showToast("Could not open this article right now.", "error");
                  });
                }}
              >
                <Text style={styles.actionPrimaryText}>Open</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel="Share story"
                onPress={() => void Share.share({ message: `${item.headline}\n\n${item.sourceUrl}` })}
              >
                <Text style={styles.actionText}>Share</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.headline} from saved`}
                onPress={() => confirmRemove(item)}
              >
                <Text style={styles.actionText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.parchment,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  list: {
    gap: spacing.sm,
    paddingBottom: 110
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.milk,
    padding: spacing.md,
    ...elevation.card
  },
  cardSource: {
    ...textStyles.badge,
    color: palette.emberDark
  },
  cardHeadline: {
    ...textStyles.subtitle,
    color: palette.coal,
    marginTop: spacing.xs
  },
  cardSummary: {
    ...textStyles.body,
    color: palette.ink,
    marginTop: spacing.sm
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md
  },
  actionButton: {
    minHeight: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.line,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.white
  },
  actionPrimary: {
    backgroundColor: palette.coal,
    borderColor: palette.coal
  },
  actionText: {
    ...textStyles.badge,
    color: palette.ink
  },
  actionPrimaryText: {
    ...textStyles.badge,
    color: palette.parchment
  },
  emptyState: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radii.md,
    backgroundColor: palette.milk,
    marginTop: spacing.xl,
    padding: spacing.lg,
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
  connectButton: {
    marginTop: spacing.md,
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: palette.coal,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl
  },
  connectButtonText: {
    ...textStyles.subtitle,
    color: palette.parchment
  },
  skeletonWrap: {
    gap: spacing.sm,
    marginTop: spacing.sm
  }
});
