import { memo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import type { FeedCard } from "@chainshorts/shared";
import { radii, spacing } from "../theme";
import { trackSponsoredClick, optInSponsoredCard } from "../services/api";
import { parseHttpUrl } from "../utils/url";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";

interface SponsoredCardProps {
  card: FeedCard;
}

function getSponsoredBadgeLabel(card: FeedCard): string {
  return "SPONSORED";
}

export const SponsoredCard = memo(function SponsoredCard({
  card,
}: SponsoredCardProps) {
  const sponsored = card.sponsored!;
  const format = sponsored.cardFormat || "classic";
  const { session } = useSession();
  const { showToast } = useToast();
  const [isOptingIn, setIsOptingIn] = useState(false);
  const [leadConfirmOpen, setLeadConfirmOpen] = useState(false);

  const openExternal = async (url: string, message: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      showToast(message, "error");
    }
  };

  const handleTap = async () => {
    if (sponsored.campaignGoal === "lead_gen") {
      if (session.mode !== "wallet" || !session.walletAddress || !session.sessionToken) {
        showToast("Connect your wallet to claim airdrops or allowlists.", "info");
        return;
      }
      if (isOptingIn || leadConfirmOpen) return;

      setLeadConfirmOpen(true);
      Alert.alert(
        "Share Wallet Address",
        `Do you want to securely share your public wallet address with ${sponsored.advertiserName} to ${sponsored.ctaText.toLowerCase()}?`,
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => setLeadConfirmOpen(false),
          },
          {
            text: "Share",
            style: "default",
            onPress: async () => {
              setLeadConfirmOpen(false);
              setIsOptingIn(true);
              try {
                await optInSponsoredCard({
                  cardId: sponsored.id,
                  wallet: session.walletAddress!,
                  sessionToken: session.sessionToken!
                });
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                showToast("Wallet shared! You earned +2 ChainRep.", "success");
              } catch {
                showToast("Failed to share wallet. Please try again.", "error");
              } finally {
                setIsOptingIn(false);
              }
            }
          }
        ],
        {
          cancelable: true,
          onDismiss: () => setLeadConfirmOpen(false),
        }
      );
      return;
    }

    if (sponsored.campaignGoal === "action" && sponsored.actionUrl) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void trackSponsoredClick(sponsored.id);
      
      // Fallback blink execution (Dialect deep link) or Phantom browse
      // https://dial.to/?action=...
      const blinkUrl = `https://dial.to/?action=${encodeURIComponent(sponsored.actionUrl)}`;
      await openExternal(blinkUrl, "This sponsored action is not available right now.");
      return;
    }

    // Default Traffic CTA
    const safeDestinationUrl = parseHttpUrl(sponsored.destinationUrl)?.toString();
    if (!safeDestinationUrl) {
      showToast("This sponsored link is not available right now.", "error");
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void trackSponsoredClick(sponsored.id);
    await openExternal(safeDestinationUrl, "This sponsored link is not available right now.");
  };

  if (format === "portrait") {
    return <PortraitLayout card={card} handleTap={handleTap} />;
  }
  if (format === "banner") {
    return <BannerLayout card={card} handleTap={handleTap} />;
  }
  if (format === "spotlight") {
    return <SpotlightLayout card={card} handleTap={handleTap} />;
  }

  return <ClassicLayout card={card} handleTap={handleTap} />;
});

function ClassicLayout({ card, handleTap }: { card: FeedCard; handleTap: () => void }) {
  const sponsored = card.sponsored!;
  const accent = sponsored.accentColor;
  const animScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(animScale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(animScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start();

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: animScale }] }}>
      <Pressable
        style={styles.card}
        onPress={handleTap}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="link"
        accessibilityLabel={`Sponsored: ${card.headline}`}
      >
        {/* Hero — image or accent gradient — flex:2 (~40% of card) */}
        <View style={{ flex: 2 }}>
          {card.imageUrl ? (
            <ImageBackground
              source={{ uri: card.imageUrl }}
              style={styles.hero}
              imageStyle={styles.heroImage}
              resizeMode="cover"
            >
              <HeroLayer card={card} accent={accent} advertiserName={sponsored.advertiserName} />
            </ImageBackground>
          ) : (
            <LinearGradient
              colors={
                sponsored.campaignGoal === "lead_gen"
                  ? [accent + "55", "#241038", "#080C12"]
                  : [accent + "30", "#080C12"]
              }
              start={{ x: 0.3, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <HeroLayer card={card} accent={accent} advertiserName={sponsored.advertiserName} />
            </LinearGradient>
          )}
        </View>

        {/* Body */}
        <View style={styles.body}>
          {/* Left accent bar */}
          <View style={[styles.accentBar, { backgroundColor: accent }]} />

          <View style={styles.bodyInner}>
            <Text style={styles.headline} numberOfLines={3}>
              {card.headline}
            </Text>

            <Text style={styles.bodyText} numberOfLines={4}>
              {card.summary60}
            </Text>

            {/* CTA */}
            <View style={styles.ctaRow}>
              <LinearGradient
                colors={[accent, accent + "CC"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaBtn}
              >
                <Text style={styles.ctaBtnText}>{sponsored.ctaText}</Text>
                <Ionicons name="arrow-forward" size={13} color="#000" />
              </LinearGradient>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function BannerLayout({ card, handleTap }: { card: FeedCard; handleTap: () => void }) {
  const sponsored = card.sponsored!;
  const accent = sponsored.accentColor;
  const animScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(animScale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(animScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start();

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: animScale }] }}>
      <Pressable
        style={styles.card}
        onPress={handleTap}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="link"
        accessibilityLabel={`Sponsored: ${card.headline}`}
      >
        {/* Header row */}
        <View style={[styles.bannerHeader, { borderBottomColor: accent }]}>
          <Text style={styles.bannerAdvertiserName}>{sponsored.advertiserName.toUpperCase()}</Text>
          <View style={[styles.bannerBadge, { backgroundColor: accent }]}>
            <Text style={styles.bannerBadgeText}>{getSponsoredBadgeLabel(card)}</Text>
          </View>
        </View>

        {/* Image Strip ~30% */}
        <View style={{ flex: 3 }}>
          {card.imageUrl ? (
            <ImageBackground
              source={{ uri: card.imageUrl }}
              style={styles.hero}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={["#0A0E14", accent + "40", "#0A0E14"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.hero}
            />
          )}
        </View>

        <LinearGradient
          colors={[accent, accent + "66"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 4 }}
        />

        {/* Body */}
        <View style={styles.bannerBody}>
          <View>
            <Text style={styles.bannerHeadline} numberOfLines={2}>{card.headline}</Text>
            <Text style={styles.bannerBodyText} numberOfLines={3}>{card.summary60}</Text>
          </View>
          <View style={[styles.bannerCta, { backgroundColor: accent }]}>
            <Text style={styles.bannerCtaText}>{sponsored.ctaText}</Text>
            <Ionicons name="arrow-forward" size={14} color="#000" />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function SpotlightLayout({ card, handleTap }: { card: FeedCard; handleTap: () => void }) {
  const sponsored = card.sponsored!;
  const accent = sponsored.accentColor;
  const animScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(animScale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(animScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start();

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: animScale }] }}>
      <Pressable
        style={styles.card}
        onPress={handleTap}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="link"
        accessibilityLabel={`Sponsored: ${card.headline}`}
      >
        {/* ~65% Hero Image */}
        <View style={{ flex: 6.5 }}>
          {card.imageUrl ? (
            <ImageBackground
              source={{ uri: card.imageUrl }}
              style={styles.hero}
              imageStyle={styles.heroImage}
              resizeMode="cover"
            >
              <SpotlightOverlay card={card} />
            </ImageBackground>
          ) : (
            <View style={[styles.hero, { backgroundColor: "#0A0E14" }]}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: accent + "55", opacity: 0.5 }]} />
              <SpotlightOverlay card={card} />
            </View>
          )}
        </View>

        <View style={{ height: 3, backgroundColor: accent }} />

        <View style={styles.spotlightBody}>
          <Text style={styles.spotlightBodyText} numberOfLines={2}>{card.summary60}</Text>
          <View style={[styles.spotlightCta, { borderColor: accent }]}>
            <Text style={[styles.spotlightCtaText, { color: accent }]}>{sponsored.ctaText}</Text>
            <Ionicons name="arrow-forward" size={14} color={accent} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function SpotlightOverlay({ card }: { card: FeedCard }) {
  const sponsored = card.sponsored!;
  const accent = sponsored.accentColor;
  const badgeLabel = getSponsoredBadgeLabel(card);
  return (
    <View style={styles.heroOverlay}>
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.95)"]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.spotlightBadgeContainer}>
        <View style={[styles.sponsoredBadge, { backgroundColor: accent }]}>
          <Text style={[styles.sponsoredBadgeText, { color: '#000', borderColor: 'transparent' }]}>{badgeLabel}</Text>
        </View>
      </View>
      <View style={styles.spotlightTextContainer}>
        <Text style={styles.spotlightAdvertiserName}>
          {sponsored.advertiserName.toUpperCase()}
        </Text>
        <Text style={styles.spotlightHeadline} numberOfLines={2}>{card.headline}</Text>
      </View>
    </View>
  );
}

function PortraitLayout({ card, handleTap }: { card: FeedCard; handleTap: () => void }) {
  const sponsored = card.sponsored!;
  const accent = sponsored.accentColor;
  const animScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(animScale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(animScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start();

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: animScale }] }}>
      <Pressable
        style={styles.card}
        onPress={handleTap}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="link"
        accessibilityLabel={`Sponsored: ${card.headline}`}
      >
        {/* Full-bleed image fills entire card */}
        <View style={{ flex: 1 }}>
          {card.imageUrl ? (
            <ImageBackground
              source={{ uri: card.imageUrl }}
              style={styles.hero}
              imageStyle={styles.heroImage}
              resizeMode="cover"
            >
              <PortraitOverlay card={card} accent={accent} />
            </ImageBackground>
          ) : (
            <LinearGradient
              colors={[accent + "40", "#080C12", "#080C12"]}
              start={{ x: 0.3, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <PortraitOverlay card={card} accent={accent} />
            </LinearGradient>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function PortraitOverlay({ card, accent }: { card: FeedCard; accent: string }) {
  const sponsored = card.sponsored!;
  const badgeLabel = getSponsoredBadgeLabel(card);
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Dark gradient overlay - bottom heavy */}
      <LinearGradient
        colors={["transparent", "transparent", "rgba(0,0,0,0.7)", "rgba(0,0,0,0.96)"]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Top row: SPONSORED badge + advertiser name */}
      <View style={[styles.heroOverlay, { padding: spacing.sm }]}>
        <View style={styles.heroTopRow}>
          <View style={styles.sponsoredBadge}>
            <Text style={styles.sponsoredBadgeText}>{badgeLabel}</Text>
          </View>
          <Text style={[styles.advertiserName, { color: accent }]}>
            {sponsored.advertiserName.toUpperCase()}
          </Text>
        </View>
      </View>
      {/* Bottom overlay: headline + CTA */}
      <View style={styles.portraitBottom}>
        <Text style={styles.portraitHeadline} numberOfLines={3}>
          {card.headline}
        </Text>
        <LinearGradient
          colors={[accent, accent + "CC"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.portraitCtaBtn}
        >
          <Text style={styles.ctaBtnText}>{sponsored.ctaText}</Text>
          <Ionicons name="arrow-forward" size={14} color="#000" />
        </LinearGradient>
      </View>
    </View>
  );
}

function HeroLayer({ card, accent, advertiserName }: { card: FeedCard; accent: string; advertiserName: string }) {
  const badgeLabel = getSponsoredBadgeLabel(card);
  return (
    <View style={styles.heroOverlay}>
      {/* Dark gradient for readability */}
      <LinearGradient
        colors={["rgba(0,0,0,0.5)", "transparent"]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Top row */}
      <View style={styles.heroTopRow}>
        <View style={styles.sponsoredBadge}>
          <Text style={styles.sponsoredBadgeText}>{badgeLabel}</Text>
        </View>
        <Text style={[styles.advertiserName, { color: accent }]}>
          {advertiserName.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "#0C0E14",
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  hero: {
    flex: 1,
    width: "100%",
  },
  heroImage: {
    borderTopLeftRadius: radii.lg - 1,
    borderTopRightRadius: radii.lg - 1,
  },
  heroOverlay: {
    flex: 1,
    padding: spacing.sm,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sponsoredBadge: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  sponsoredBadgeText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 9,
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.7)",
  },
  advertiserName: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 1.0,
  },
  placementLabel: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 9,
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.6)",
    marginTop: 2,
  },
  body: {
    flex: 3,
    flexDirection: "row",
    backgroundColor: "#0C0E14",
  },
  accentBar: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 999,
    margin: spacing.sm,
    marginRight: 0,
  },
  bodyInner: {
    flex: 1,
    padding: spacing.md,
    paddingLeft: spacing.sm,
    gap: 6,
    justifyContent: "space-between",
  },
  headline: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 21,
    lineHeight: 27,
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  bodyText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
    lineHeight: 22,
    color: "#AAAAAA",
    flex: 1,
  },
  ctaRow: {
    flexDirection: "row",
  },
  contextChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  contextChipText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 11,
    lineHeight: 15,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  ctaBtnText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 13,
    color: "#000000",
  },

  // Banner styles
  bannerHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    backgroundColor: "#0A0E14",
  },
  bannerAdvertiserName: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    color: "#F0F0F0",
    letterSpacing: 0.8,
  },
  bannerBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bannerBadgeText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 9,
    color: "#000",
    letterSpacing: 1.2,
  },
  bannerBody: {
    flex: 7,
    padding: spacing.md,
    justifyContent: "space-between",
    backgroundColor: "#0C0E14",
  },
  bannerHeadline: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 24,
    lineHeight: 28,
    color: "#FFFFFF",
    marginBottom: spacing.xs,
  },
  bannerBodyText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
    lineHeight: 21,
    color: "#AAAAAA",
  },
  bannerContextChip: {
    marginTop: spacing.sm,
  },
  bannerCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: spacing.md,
  },
  bannerCtaText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 15,
    color: "#000000",
  },

  // Spotlight styles
  spotlightBadgeContainer: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 10,
  },
  spotlightTextContainer: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    right: spacing.md,
  },
  spotlightAdvertiserName: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    color: "#A0A4AE",
    letterSpacing: 1.0,
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  spotlightHeadline: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 26,
    lineHeight: 30,
    color: "#FFFFFF",
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  spotlightBody: {
    flex: 3.5,
    padding: spacing.md,
    justifyContent: "center",
    backgroundColor: "#0C0E14",
  },
  spotlightBodyText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
    lineHeight: 21,
    color: "#AAAAAA",
    marginBottom: spacing.md,
  },
  spotlightSupportText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: spacing.md,
  },
  spotlightCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "transparent",
  },
  spotlightCtaText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 15,
  },

  // Portrait styles
  portraitBottom: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    gap: spacing.md,
  },
  portraitHeadline: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 26,
    lineHeight: 32,
    color: "#FFFFFF",
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  portraitCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.pill,
  },
});
