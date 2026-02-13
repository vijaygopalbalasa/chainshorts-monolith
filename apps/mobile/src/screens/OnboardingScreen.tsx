import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandBackground } from "../components";
import { useToast } from "../context/ToastContext";
import { radii, spacing, useTheme } from "../theme";

interface OnboardingScreenProps {
  onContinue: () => void;
}

const FEATURES: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  title: string;
  body: string;
}> = [
  {
    icon: "flash-outline",
    accent: "#14F195",
    title: "60-Word News Briefs",
    body: "Crypto news simplified. Markets, DeFi, regulation, NFTs — all in one swipe."
  },
  {
    icon: "trending-up-outline",
    accent: "#F59E0B",
    title: "Prediction Markets",
    body: "Stake SKR on outcomes. Win big if you're right, climb the leaderboard."
  },
  {
    icon: "wallet-outline",
    accent: "#9945FF",
    title: "Solana Wallet",
    body: "Connect Phantom, Solflare, or Backpack. Your keys, your predictions."
  },
  {
    icon: "ribbon-outline",
    accent: "#00CFFF",
    title: "SKR Rewards",
    body: "Earn SKR for accurate predictions. Stake more, win more, climb the ranks."
  }
];

export function OnboardingScreen({ onContinue }: OnboardingScreenProps) {
  const { palette } = useTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => getStyles(palette), [palette]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <BrandBackground />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Logo row */}
        <View style={styles.logoRow}>
          <View style={styles.logoMark}>
            <Ionicons name="link" size={13} color="#070B0F" />
          </View>
          <Text style={styles.logoText}>CHAINSHORTS</Text>
        </View>

        {/* Hero block */}
        <View style={styles.heroBlock}>
          <View style={styles.heroLine2Row}>
            <Text style={styles.heroLine2} numberOfLines={1} adjustsFontSizeToFit>WEB3 IN 60 WORDS.</Text>
          </View>
          <Text style={styles.heroClaim}>
            Read first. Decide faster.{"\n"}
            From Bitcoin to Solana to regulation, one feed.
          </Text>
        </View>

        {/* Feature rows */}
        <View style={styles.featureList}>
          {FEATURES.map((feature) => (
            <View key={feature.title} style={styles.featureRow}>
              {/* Left accent bar */}
              <View style={[styles.accentBar, { backgroundColor: feature.accent }]} />

              {/* Icon box */}
              <View style={[styles.featureIconBox, { borderColor: feature.accent + "28" }]}>
                <Ionicons name={feature.icon} size={18} color={feature.accent} />
              </View>

              {/* Text */}
              <View style={styles.featureTextBlock}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureBody}>{feature.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Follow on X */}
        <Pressable
          style={({ pressed }) => [styles.xCard, pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] }]}
          onPress={() => {
            void WebBrowser.openBrowserAsync("https://x.com/chainshorts").catch(() => {
              showToast("Could not open Chainshorts on X right now.", "error");
            });
          }}
        >
          <View style={styles.xLogoWrap}>
            <Text style={styles.xLogo}>𝕏</Text>
          </View>
          <View style={styles.xCardBody}>
            <Text style={styles.xCardTitle}>Follow @chainshorts</Text>
          </View>
          <View style={styles.xFollowBtn}>
            <Text style={styles.xFollowBtnText}>Follow</Text>
          </View>
        </Pressable>

        {/* Bottom spacer — clears fixed CTA footer */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* CTA — fixed at bottom */}
      <View style={styles.ctaContainer}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel="Start reading Chainshorts"
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onContinue();
          }}
        >
          <LinearGradient
            colors={["#14F195", "#0ECC7E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            <Text style={styles.ctaText}>ENTER CHAINSHORTS</Text>
            <Ionicons name="arrow-forward" size={15} color="#040608" />
          </LinearGradient>
        </Pressable>
        <Text style={styles.disclaimer}>No signup required · Connect wallet to predict · Built on Solana</Text>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.parchment
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm
  },

  // Logo
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  logoMark: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: palette.ember,
    alignItems: "center",
    justifyContent: "center"
  },
  logoText: {
    fontFamily: "Manrope_800ExtraBold",
    fontSize: 18,
    letterSpacing: 2.4,
    color: palette.coal
  },

  // Hero
  heroBlock: {
    marginTop: spacing.xl + spacing.lg
  },
  heroLine1: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -1.2,
    color: palette.coal
  },
  heroLine2Row: {
    flexDirection: "row",
    alignItems: "center"
  },
  heroLine2: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.2,
    color: palette.ember
  },
  heroClaim: {
    fontFamily: "Manrope_500Medium",
    fontSize: 13,
    lineHeight: 20,
    color: palette.muted,
    marginTop: spacing.md
  },

  // Features
  featureList: {
    marginTop: spacing.xl,
    gap: spacing.sm
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.milk,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    overflow: "hidden"
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 999
  },
  featureIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.milk
  },
  featureTextBlock: {
    flex: 1
  },
  featureTitle: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    lineHeight: 18,
    color: palette.coal
  },
  featureBody: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    lineHeight: 17,
    color: palette.muted,
    marginTop: 2
  },

  // CTA
  ctaContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.parchment
  },
  cta: {
    borderRadius: radii.sm,
    overflow: "hidden"
  },
  ctaPressed: {
    opacity: 0.85
  },
  ctaGradient: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm
  },
  ctaText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    letterSpacing: 2.0,
    color: "#040608"
  },
  disclaimer: {
    fontFamily: "Manrope_500Medium",
    fontSize: 10,
    letterSpacing: 0.3,
    color: palette.muted,
    textAlign: "center"
  },

  // Follow on X card — white on dark, high contrast
  xCard: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xl,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    backgroundColor: "#FFFFFF",
    gap: spacing.md
  },
  xLogoWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center"
  },
  xLogo: {
    fontFamily: "Manrope_800ExtraBold",
    fontSize: 16,
    color: "#fff",
    lineHeight: 20
  },
  xCardBody: {
    flex: 1
  },
  xCardTitle: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    lineHeight: 18,
    color: "#0A0A0A"
  },
  xCardSub: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    lineHeight: 15,
    color: "#555",
    marginTop: 2
  },
  xFollowBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "#0A0A0A"
  },
  xFollowBtnText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 12,
    color: "#fff",
    letterSpacing: 0.3
  }
});
