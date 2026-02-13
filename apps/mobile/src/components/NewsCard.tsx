import { memo, useRef, useCallback, useMemo } from "react";
import {
  Animated,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  Dimensions
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  PanGestureHandler,
  State,
  type GestureEvent,
  type HandlerStateChangeEvent,
  type PanGestureHandlerEventPayload
} from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { FeedCard } from "@chainshorts/shared";
import { resolveFeedTopic } from "../utils/feedTopics";
import { elevation, radii, spacing, textStyles, useTheme } from "../theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Category → gradient map ───────────────────────────────────────────────
const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  markets: ["#08111D", "#1EA7FD"],
  defi: ["#021520", "#00A9A3"],
  infrastructure: ["#0B0F1A", "#5F7FFF"],
  security: ["#120010", "#B12734"],
  policy: ["#151012", "#CA8A04"],
  layer2: ["#0A0E1C", "#4F46E5"],
  gaming: ["#140A1A", "#EC4899"],
  ai: ["#0E1418", "#14B8A6"],
  bitcoin: ["#171108", "#F7931A"],
  ethereum: ["#0C101A", "#8B9AF9"],
  nft: ["#150810", "#F05A28"],
  solana: ["#0E0520", "#9945FF"]
};
const FALLBACK_GRADIENT: [string, string] = ["#0A0F1A", "#14F195"];

function getCategoryGradient(category?: string): [string, string] {
  if (!category) return FALLBACK_GRADIENT;
  return CATEGORY_GRADIENTS[category.toLowerCase()] ?? FALLBACK_GRADIENT;
}

// ─── Props ──────────────────────────────────────────────────────────────────
interface NewsCardProps {
  article: FeedCard;
  onOpen: () => void;
  onShare: () => void;
  onBookmarkToggle?: () => void;
  bookmarked?: boolean;
}


// ─── NewsCard ────────────────────────────────────────────────────────────────
export const NewsCard = memo(function NewsCard({
  article,
  onOpen,
  onShare,
  onBookmarkToggle,
  bookmarked,
}: NewsCardProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  // Swipe gesture state
  const translateX = useRef(new Animated.Value(0)).current;
  const bookmarkHintOpacity = useRef(new Animated.Value(0)).current;
  const lastTranslationX = useRef(0);

  const handleGestureEvent = useCallback(
    (event: GestureEvent<PanGestureHandlerEventPayload>) => {
      const dx = event.nativeEvent.translationX;
      lastTranslationX.current = dx;

      if (dx > 0) {
        translateX.setValue(Math.min(dx * 0.5, 60));
        bookmarkHintOpacity.setValue(Math.min((dx - 20) / 60, 1));
      } else {
        translateX.setValue(Math.max(dx * 0.25, -20));
        bookmarkHintOpacity.setValue(0);
      }
    },
    [translateX, bookmarkHintOpacity]
  );

  const resetCard = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 250
      }),
      Animated.timing(bookmarkHintOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      })
    ]).start();
  }, [translateX, bookmarkHintOpacity]);

  const handleStateChange = useCallback(
    (event: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
      const { state } = event.nativeEvent;
      if (
        state === State.END ||
        state === State.FAILED ||
        state === State.CANCELLED
      ) {
        const dx = lastTranslationX.current;
        if (state === State.END && dx > 80 && onBookmarkToggle) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onBookmarkToggle();
        }
        lastTranslationX.current = 0;
        resetCard();
      }
    },
    [onBookmarkToggle, resetCard]
  );

  const topic = resolveFeedTopic(article);
  const gradientColors = getCategoryGradient(topic);

  return (
    <PanGestureHandler
      onGestureEvent={handleGestureEvent}
      onHandlerStateChange={handleStateChange}
      activeOffsetX={[-10, 10]}
    >
      <Animated.View
        style={[
          styles.card,
          { borderColor: gradientColors[1], transform: [{ translateX }] }
        ]}
      >
        {/* Bookmark swipe hint */}
        <Animated.View
          style={[styles.bookmarkHint, { opacity: bookmarkHintOpacity }]}
          pointerEvents="none"
        >
          <Ionicons name="bookmark" size={16} color="#040608" />
        </Animated.View>

        {/* Hero image section */}
        <Pressable onPress={onOpen} style={{ flex: 1 }}>
          {article.imageUrl ? (
            <ImageBackground
              source={{ uri: article.imageUrl }}
              style={styles.hero}
              imageStyle={styles.heroImage}
              resizeMode="cover"
            >
              <HeroOverlay
                article={article}
                accentColor={gradientColors[1]}
                bookmarked={bookmarked ?? false}
                onShare={onShare}
                onBookmarkToggle={onBookmarkToggle ?? (() => {})}
              />
            </ImageBackground>
          ) : (
            <LinearGradient
              colors={gradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <HeroOverlay
                article={article}
                accentColor={gradientColors[1]}
                bookmarked={bookmarked ?? false}
                onShare={onShare}
                onBookmarkToggle={onBookmarkToggle ?? (() => {})}
              />
            </LinearGradient>
          )}
        </Pressable>

        {/* Body content section - fills remaining space */}
        <Pressable onPress={onOpen} style={styles.body}>
          {/* Category accent line */}
          <View style={[styles.categoryLine, { backgroundColor: gradientColors[1] }]} />

          <Text style={styles.headline}>
            {article.headline}
          </Text>

          <Text style={styles.metaTime}>
            <Text style={styles.metaCategory}>{topic.toUpperCase()}</Text>
            {" · "}
            {new Date(article.publishedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
            {" · "}
            {new Date(article.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>

          <Text style={styles.summary}>
            {article.summary60}
          </Text>

          {article.tokenContext ? (
            <View style={styles.tokenContextRow}>
              <Text style={styles.tokenSymbol}>{article.tokenContext.symbol}</Text>
              {typeof article.tokenContext.priceUsd === "number" ? (
                <Text style={styles.tokenPrice}>
                  ${article.tokenContext.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </Text>
              ) : null}
              {typeof article.tokenContext.change1hPct === "number" ? (
                <Text
                  style={[
                    styles.tokenChange,
                    article.tokenContext.change1hPct >= 0 ? styles.tokenChangePos : styles.tokenChangeNeg
                  ]}
                >
                  {article.tokenContext.change1hPct >= 0 ? "▲" : "▼"}
                  {Math.abs(article.tokenContext.change1hPct).toFixed(2)}%
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </PanGestureHandler>
  );
});

// ─── HeroOverlay ─────────────────────────────────────────────────────────────
function HeroOverlay({
  article,
  accentColor,
  bookmarked,
  onShare,
  onBookmarkToggle
}: {
  article: FeedCard;
  accentColor: string;
  bookmarked: boolean;
  onShare: () => void;
  onBookmarkToggle: () => void;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);
  return (
    <View style={styles.heroOverlay}>
      {/* Top gradient for better text visibility */}
      <LinearGradient
        colors={["rgba(0,0,0,0.6)", "transparent"]}
        style={styles.heroGradientTop}
        pointerEvents="none"
      />

      {/* Bottom gradient for smooth transition */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.4)"]}
        style={styles.heroGradientBottom}
        pointerEvents="none"
      />

      {/* Top row: Source badge + Actions */}
      <View style={styles.heroTopRow}>
        <View style={[styles.sourceBadge, { borderColor: accentColor }]}>
          <View style={[styles.sourceDot, { backgroundColor: accentColor }]} />
          <Text style={styles.sourceText}>{article.sourceName.toUpperCase()}</Text>
        </View>

        <View style={styles.heroActions}>
          <Pressable
            onPress={(e) => { e.stopPropagation(); onShare(); }}
            style={styles.heroIconButton}
            hitSlop={12}
            accessibilityLabel="Share this article"
          >
            <Ionicons name="share-social-outline" size={20} color="#fff" />
          </Pressable>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onBookmarkToggle();
            }}
            style={[styles.heroIconButton, bookmarked && styles.heroIconButtonActive]}
            hitSlop={12}
            accessibilityLabel={bookmarked ? "Remove bookmark" : "Save article"}
          >
            <Ionicons
              name={bookmarked ? "bookmark" : "bookmark-outline"}
              size={20}
              color={bookmarked ? "#14F195" : "#fff"}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const getStyles = (palette: any) => StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.milk,
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: palette.line,
    ...elevation.card
  },

  // Swipe bookmark hint
  bookmarkHint: {
    position: "absolute",
    left: 14,
    top: "50%",
    zIndex: 10,
    backgroundColor: palette.ember,
    borderRadius: radii.sm,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22
  },

  // Hero section
  hero: {
    flex: 1,
    width: "100%"
  },
  heroImage: {
    borderTopLeftRadius: radii.lg - 1,
    borderTopRightRadius: radii.lg - 1
  },
  heroOverlay: {
    flex: 1,
    justifyContent: "space-between"
  },
  heroGradientTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 80
  },
  heroGradientBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 60
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm
  },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  heroIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)"
  },
  heroIconButtonActive: {
    backgroundColor: "rgba(20,241,149,0.3)",
    borderColor: "rgba(20,241,149,0.5)"
  },
  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderWidth: 1.5
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  sourceText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 10,
    letterSpacing: 1,
    color: "#fff"
  },

  // Body section — flex:3 gives body 3x the hero space (75%/25% split)
  body: {
    flex: 3,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 4
  },
  categoryLine: {
    width: 40,
    height: 3,
    borderRadius: 2,
    marginBottom: 4
  },
  headline: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 22,
    lineHeight: 28,
    color: palette.coal,
    letterSpacing: -0.3
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  sourceName: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 12,
    color: palette.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  metaDivider: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.muted,
    opacity: 0.5
  },
  metaTime: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    color: palette.muted
  },
  metaCategory: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 0.8,
    color: palette.ember
  },
  summary: {
    fontFamily: "Manrope_500Medium",
    fontSize: 16,
    lineHeight: 26,
    color: palette.ink,
    letterSpacing: 0.1,
    marginTop: 4,
    flex: 1
  },

  // Token context
  tokenContextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: palette.parchment,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line
  },
  tokenSymbol: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    color: palette.coal,
    letterSpacing: 0.5
  },
  tokenPrice: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    color: palette.ink
  },
  tokenChange: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    letterSpacing: 0.3,
    marginLeft: "auto"
  },
  tokenChangePos: {
    color: palette.lime
  },
  tokenChangeNeg: {
    color: palette.danger
  }
});
