import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import bs58 from "bs58";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useToast } from "../context/ToastContext";
import { removePushRegistration } from "../services/pushRegistration";
import {
  fetchClientConfig,
  fetchLeaderboard,
  fetchUserPredictionStakes,
  fetchWalletBalances,
  friendlyError,
  logoutSession,
  requestChallenge,
  submitFeedback,
  verifyChallenge,
} from "../services/api";
import { useSession } from "../state/sessionStore";
import { elevation, radii, spacing, textStyles, useTheme, type ThemeMode } from "../theme";
import { getWalletAdapter, clearAdapterCache } from "../wallet";
import { getSwapQuote, buildSwapTransaction, formatTokenAmount, toRawAmount, SWAP_TOKENS, type SwapTokenKey, type SwapQuote } from "../services/jupiterSwap";
import { AndroidMwaAdapter } from "../wallet/AndroidMwaAdapter";
import { parseHttpUrl } from "../utils/url";
import { WalletSelector } from "../components/WalletSelector";
import { SupportCard } from "../components/SupportCard";
import { waitForSignatureConfirmation } from "../services/splTransfer";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const FALLBACK_PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim();
const FALLBACK_ADVERTISER_PORTAL_URL =
  process.env.EXPO_PUBLIC_ADVERTISER_PORTAL_URL?.trim() || "https://advertiser.chainshorts.live";

const TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF",
  USDC: "#2775CA",
  USDT: "#26A17B",
  SKR: "#14F195",
};
const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { mode: "system", label: "Auto", icon: "phone-portrait-outline" },
  { mode: "light", label: "Light", icon: "sunny-outline" },
  { mode: "dark", label: "Dark", icon: "moon-outline" },
];

function formatWalletAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/* ---------- Skeleton shimmer block ---------- */
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

/* ---------- X Card ---------- */
function XCard({
  isDark,
  palette,
  onOpenX,
}: {
  isDark: boolean;
  palette: any;
  onOpenX: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        {
          marginTop: spacing.sm,
          backgroundColor: "#000000",
          borderRadius: radii.md,
          overflow: "hidden",
        },
        pressed && { opacity: 0.9 },
      ]}
      onPress={onOpenX}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        {/* X Logo */}
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "Manrope_800ExtraBold", fontSize: 22, color: "#000000" }}>
            𝕏
          </Text>
        </View>

        {/* Text */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 15, color: "#FFFFFF" }}>
            @chainshorts
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 13, color: "#AAAAAA", marginTop: 2 }}>
            News, updates, alpha
          </Text>
        </View>

        {/* Follow CTA */}
        <View
          style={{
            backgroundColor: "#FFFFFF",
            paddingHorizontal: 16,
            paddingVertical: 9,
            borderRadius: radii.pill,
          }}
        >
          <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: "#000000" }}>
            Follow
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* ---------- Main WalletScreen ---------- */
export function WalletScreen() {
  const { palette, mode: themeMode, setMode, isDark } = useTheme();
  const styles = useMemo(() => getStyles(palette, isDark), [palette, isDark]);

  const { session, setWalletSession, clearSession } = useSession();
  const { showToast } = useToast();
  const navigation = useNavigation<any>();
  const tabBarHeight = useBottomTabBarHeight();

  const [loading, setLoading] = useState(true);
  const [walletBusy, setWalletBusy] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [connectingWalletId, setConnectingWalletId] = useState<string | null>(null);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof fetchWalletBalances>> | null>(null);
  const [predictionStats, setPredictionStats] = useState({
    wagered: 0,
    profit: 0,
    winRate: 0,
    rank: null as number | null,
  });
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(FALLBACK_PRIVACY_POLICY_URL);
  const [platformWallet, setPlatformWallet] = useState("");

  // Swap state
  const [swapFrom, setSwapFrom] = useState<SwapTokenKey>("SOL");
  const [swapTo, setSwapTo] = useState<SwapTokenKey>("USDC");
  const [swapAmountStr, setSwapAmountStr] = useState("");
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const swapQuoteTimestamp = useRef<number>(0);
  const swapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swapStatus, setSwapStatus] = useState<
    "idle" | "quoting" | "ready" | "building" | "signing" | "confirming" | "success" | "failed"
  >("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapTxSig, setSwapTxSig] = useState<string | null>(null);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const [swapPickerTarget, setSwapPickerTarget] = useState<"from" | "to">("from");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"bug" | "suggestion" | "other">("bug");
  const [feedbackSubject, setFeedbackSubject] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackKbHeight, setFeedbackKbHeight] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const heroSlide = useRef(new Animated.Value(30)).current;
  const feedbackCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the feedback sheet above the keyboard on Android
  useEffect(() => {
    if (!feedbackOpen) {
      setFeedbackKbHeight(0);
      return;
    }
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setFeedbackKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setFeedbackKbHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [feedbackOpen]);

  const walletConnected =
    session.mode === "wallet" && Boolean(session.walletAddress) && Boolean(session.sessionToken);

  const getSwapTokenBalance = useCallback((token: SwapTokenKey): number => {
    if (!balance) return 0;
    if (token === "SOL") return balance.solLamports / 1e9;
    if (token === "SKR") return balance.skrUi;
    if (token === "USDC") return balance.usdcUi ?? 0;
    return balance.usdtUi ?? 0;
  }, [balance]);

  const resetFeedbackForm = useCallback(() => {
    if (feedbackCloseTimerRef.current) {
      clearTimeout(feedbackCloseTimerRef.current);
      feedbackCloseTimerRef.current = null;
    }
    setFeedbackType("bug");
    setFeedbackSubject("");
    setFeedbackMessage("");
    setFeedbackSubmitting(false);
    setFeedbackSuccess(false);
  }, []);

  const closeFeedbackSheet = useCallback(() => {
    if (feedbackSubmitting) {
      return;
    }
    resetFeedbackForm();
    setFeedbackOpen(false);
  }, [feedbackSubmitting, resetFeedbackForm]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config = await fetchClientConfig(session.sessionToken).catch(() => null);
      if (config) {
        setPrivacyPolicyUrl(config.appLinks?.privacyPolicyUrl ?? FALLBACK_PRIVACY_POLICY_URL);
        setPlatformWallet(config.platformWallet ?? "");
      }
    } catch {
      // Config is best-effort
    }

    if (!walletConnected || !session.walletAddress || !session.sessionToken) {
      setBalance(null);
      setPredictionStats({ wagered: 0, profit: 0, winRate: 0, rank: null });
      setLoading(false);
      return;
    }

    try {
      const [balanceResult, stakesResult, leaderboardResult] = await Promise.allSettled([
        fetchWalletBalances(session.walletAddress, session.sessionToken),
        fetchUserPredictionStakes({
          wallet: session.walletAddress,
          sessionToken: session.sessionToken,
          limit: 100
        }),
        fetchLeaderboard({
          wallet: session.walletAddress,
          sessionToken: session.sessionToken,
          period: "all",
          limit: 100
        })
      ]);

      const walletBalance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
      setBalance(walletBalance);

      if (stakesResult.status === "fulfilled") {
        const portfolio = stakesResult.value;
        const wins = portfolio.resolvedStakes.filter((stake) => stake.status === "won" || stake.status === "claimed").length;
        const losses = portfolio.resolvedStakes.filter((stake) => stake.status === "lost").length;
        const resolvedCount = wins + losses;
        const winRate = resolvedCount > 0 ? Math.round((wins / resolvedCount) * 100) : 0;
        const profit = portfolio.totalWonSkr - portfolio.totalLostSkr;
        const rank = leaderboardResult.status === "fulfilled" ? leaderboardResult.value.userRank?.rank ?? null : null;

        setPredictionStats({
          wagered: portfolio.totalStakedSkr,
          profit,
          winRate,
          rank
        });
      } else {
        setPredictionStats({ wagered: 0, profit: 0, winRate: 0, rank: null });
      }

      if (balanceResult.status === "rejected") {
        const err = balanceResult.reason;
        showToast(friendlyError(err, "Couldn't load balance — please try again"), "error");
      }
      if (stakesResult.status === "rejected") {
        showToast(friendlyError(stakesResult.reason, "Couldn't load prediction stats"), "error");
      }

      fadeAnim.setValue(0);
      heroSlide.setValue(30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(heroSlide, { toValue: 0, damping: 18, stiffness: 160, useNativeDriver: true }),
      ]).start();
    } catch (error) {
      showToast(friendlyError(error, "Couldn't load wallet — please try again"), "error");
      fadeAnim.setValue(1);
    } finally {
      setLoading(false);
    }
  }, [session.sessionToken, session.walletAddress, showToast, walletConnected, fadeAnim, heroSlide]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-quote: debounce 650 ms after amount / token changes
  useEffect(() => {
    if (swapDebounceRef.current) clearTimeout(swapDebounceRef.current);
    const humanAmount = parseFloat(swapAmountStr);
    if (!swapAmountStr || isNaN(humanAmount) || humanAmount <= 0 || swapFrom === swapTo) {
      setSwapStatus("idle");
      setSwapQuote(null);
      setSwapError(null);
      return;
    }
    setSwapStatus("quoting");
    setSwapQuote(null);
    swapDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const fromToken = SWAP_TOKENS[swapFrom];
          const toToken = SWAP_TOKENS[swapTo];
          const rawAmount = toRawAmount(humanAmount, fromToken.decimals);
          const quote = await getSwapQuote(fromToken.mint, toToken.mint, rawAmount);
          setSwapQuote(quote);
          swapQuoteTimestamp.current = Date.now();
          setSwapStatus("ready");
          setSwapError(null);
        } catch (err) {
          setSwapError(err instanceof Error ? err.message : "Failed to get quote");
          setSwapStatus("failed");
        }
      })();
    }, 650);
    return () => {
      if (swapDebounceRef.current) clearTimeout(swapDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapAmountStr, swapFrom, swapTo]);

  const handleConnectPress = useCallback(() => {
    if (Platform.OS !== "android") {
      showToast("Wallet connect is currently available on Android/Seeker.", "info");
      return;
    }
    setShowWalletSelector(true);
  }, [showToast]);

  const handleWalletSelect = useCallback(async (walletId: string) => {
    setConnectingWalletId(walletId);
    setWalletBusy(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      clearAdapterCache();
      const adapter = getWalletAdapter({ walletId });

      if (!adapter.connectAndSignChallenge) {
        throw new Error("Wallet adapter does not support connectAndSignChallenge");
      }

      // Single MWA session: authorize → fetch challenge → sign — all inside one transact() call.
      // Previously this was split into connect() + signMessage() with an API call in between,
      // which caused the MWA ephemeral session to die before signing could happen.
      const { address, message, signature } = await adapter.connectAndSignChallenge(
        async (walletAddress) => {
          const { message: challengeMessage } = await requestChallenge(walletAddress);
          return challengeMessage;
        }
      );

      const verified = await verifyChallenge({
        walletAddress: address,
        message,
        signature: bs58.encode(signature),
      });

      setWalletSession(verified.walletAddress, verified.sessionToken);
      setShowWalletSelector(false);
      showToast("Wallet connected.", "success");
    } catch (error) {
      // Show the actual error message (normalized by AndroidMwaAdapter) so we can diagnose failures
      const msg = error instanceof Error ? error.message : "Wallet connection failed — please try again";
      showToast(msg, "error");
    } finally {
      setWalletBusy(false);
      setConnectingWalletId(null);
    }
  }, [setWalletSession, showToast]);

  const handleWalletSelectorCancel = useCallback(() => {
    if (!walletBusy) {
      setShowWalletSelector(false);
      setConnectingWalletId(null);
    }
  }, [walletBusy]);

  const disconnectWallet = useCallback(async () => {
    if (session.mode === "wallet" && session.walletAddress && session.sessionToken) {
      try {
        await logoutSession({
          walletAddress: session.walletAddress,
          sessionToken: session.sessionToken,
        });
      } catch {
        // local session is still cleared below
      }
      try {
        await removePushRegistration(session);
      } catch {
        // best effort
      }
    }
    const adapter = getWalletAdapter();
    await adapter.disconnect();
    clearAdapterCache();
    clearSession();
    showToast("Wallet disconnected.", "info");
  }, [clearSession, session, showToast]);

  useEffect(() => {
    return () => {
      if (feedbackCloseTimerRef.current) {
        clearTimeout(feedbackCloseTimerRef.current);
      }
    };
  }, []);

  const handleSubmitFeedback = useCallback(async () => {
    if (!walletConnected || !session.sessionToken) {
      showToast("Connect your wallet to send feedback", "info");
      setFeedbackOpen(false);
      setShowWalletSelector(true);
      return;
    }

    const subject = feedbackSubject.trim();
    const message = feedbackMessage.trim();

    if (!subject) {
      showToast("Add a short subject before sending", "info");
      return;
    }

    if (message.length < 5) {
      showToast("Please add a little more detail", "info");
      return;
    }

    setFeedbackSubmitting(true);
    try {
      await submitFeedback({
        sessionToken: session.sessionToken,
        type: feedbackType,
        subject,
        message
      });
      setFeedbackSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (feedbackCloseTimerRef.current) {
        clearTimeout(feedbackCloseTimerRef.current);
      }
      feedbackCloseTimerRef.current = setTimeout(() => {
        closeFeedbackSheet();
      }, 1600);
    } catch (error) {
      showToast(friendlyError(error, "Could not send feedback. Please try again."), "error");
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [
    closeFeedbackSheet,
    feedbackMessage,
    feedbackSubject,
    feedbackType,
    session.sessionToken,
    showToast,
    walletConnected
  ]);

  const copyAddress = useCallback(async () => {
    if (!session.walletAddress) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(session.walletAddress);
    showToast("Address copied", "success");
  }, [session.walletAddress, showToast]);

  const resetSwap = useCallback(() => {
    if (swapDebounceRef.current) clearTimeout(swapDebounceRef.current);
    setSwapStatus("idle");
    setSwapQuote(null);
    setSwapTxSig(null);
    setSwapError(null);
    setSwapAmountStr("");
    swapQuoteTimestamp.current = 0;
  }, []);

  const handleExecuteSwap = useCallback(async () => {
    if (!swapQuote || !session.walletAddress || (swapStatus !== "ready" && swapStatus !== "failed")) return;
    if (Date.now() - swapQuoteTimestamp.current > 25_000) {
      setSwapQuote(null);
      swapQuoteTimestamp.current = 0;
      setSwapStatus("idle");
      setSwapError("Quote expired — updating automatically");
      return;
    }
    setSwapError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const adapter = getWalletAdapter();
      if (!(adapter instanceof AndroidMwaAdapter)) {
        throw new Error("Swap requires the Android MWA wallet adapter");
      }
      setSwapStatus("building");
      const tx = await buildSwapTransaction(swapQuote, session.walletAddress);
      setSwapStatus("signing");
      const sig = await adapter.sendVersionedTransaction(tx);
      setSwapStatus("confirming");
      try {
        await waitForSignatureConfirmation({ signature: sig, timeoutMs: 30_000 });
      } catch (error) {
        if (!(error instanceof Error && error.message === "transaction_confirmation_timeout")) {
          throw error;
        }
      }
      setSwapTxSig(sig);
      setSwapStatus("success");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Auto-refresh balance after successful swap (wait for tx to settle)
      setTimeout(() => { void load(); }, 2500);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : "Swap failed");
      setSwapStatus("failed");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [swapQuote, swapStatus, session.walletAddress, load]);

  /* ---- Disconnected state ---- */
  const renderDisconnected = () => (
    <View style={styles.disconnectedContainer}>
      {/* Hero Icon */}
      <View style={styles.heroIconContainer}>
        <View style={styles.heroIconOuter}>
          <Ionicons name="wallet" size={48} color="#14F195" />
        </View>
        <View style={styles.heroIconGlow} />
      </View>

      {/* Title & Subtitle */}
      <Text style={styles.heroTitle}>Connect Your Wallet</Text>
      <Text style={styles.heroSubtitle}>
        Track balances and climb the prediction leaderboard
      </Text>

      {/* Features */}
      <View style={styles.featuresList}>
        {[
          { icon: "trophy-outline" as const, text: "Prediction leaderboard" },
          { icon: "swap-horizontal-outline" as const, text: "In-app Jupiter swaps" },
        ].map((f, i) => (
          <View key={i} style={styles.featureItem}>
            <Ionicons name={f.icon} size={16} color="#14F195" />
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* Supported Wallets - simple text */}
      <Text style={styles.walletsText}>
        {Platform.OS === "android"
          ? "Phantom · Solflare · Backpack · Seed Vault"
          : "Wallet connect currently supports Android/Seeker"}
      </Text>

      {/* CTA Button */}
      <Pressable
        style={({ pressed }) => [
          styles.connectBtn,
          pressed && styles.connectBtnPressed,
          walletBusy && styles.connectBtnDisabled,
        ]}
        disabled={walletBusy}
        onPress={handleConnectPress}
      >
        {walletBusy ? (
          <ActivityIndicator size="small" color="#040608" />
        ) : (
          <>
            <Ionicons name="link" size={18} color="#040608" />
            <Text style={styles.connectBtnText}>Connect Wallet</Text>
          </>
        )}
      </Pressable>

      {/* Security Footer */}
      <View style={styles.securityRow}>
        <Ionicons name="shield-checkmark" size={14} color={palette.muted} />
        <Text style={styles.securityText}>Sign-In With Solana · No private keys shared</Text>
      </View>

      {/* Appearance */}
      <View style={[styles.sectionCard, { marginTop: spacing.xl, width: "100%" }]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="color-palette-outline" size={16} color={palette.muted} />
          <Text style={styles.sectionLabel}>APPEARANCE</Text>
        </View>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((option) => {
            const active = themeMode === option.mode;
            return (
              <Pressable
                key={option.mode}
                style={[styles.themeBtn, active && styles.themeBtnActive]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setMode(option.mode);
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={14}
                  color={active ? "#040608" : palette.muted}
                />
                <Text style={[styles.themeBtnText, active && styles.themeBtnTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.themeHint}>
          {themeMode === "system"
            ? `Following system (${isDark ? "dark" : "light"})`
            : `${themeMode === "dark" ? "Dark" : "Light"} mode active`}
        </Text>
      </View>

      {/* Follow on X - Animated Border */}
      <XCard
        isDark={isDark}
        palette={palette}
        onOpenX={() => {
          void WebBrowser.openBrowserAsync("https://x.com/chainshorts").catch(() => {
            showToast("Could not open Chainshorts on X right now.", "error");
          });
        }}
      />
    </View>
  );

  /* ---- Skeleton loading state ---- */
  const renderSkeleton = () => (
    <View style={{ gap: spacing.lg, paddingTop: spacing.md }}>
      <SkeletonBlock width="100%" height={180} style={{ borderRadius: radii.lg }} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <SkeletonBlock width="33%" height={100} style={{ borderRadius: radii.md, flex: 1 }} />
        <SkeletonBlock width="33%" height={100} style={{ borderRadius: radii.md, flex: 1 }} />
        <SkeletonBlock width="33%" height={100} style={{ borderRadius: radii.md, flex: 1 }} />
      </View>
      <SkeletonBlock width="100%" height={60} style={{ borderRadius: radii.md }} />
      <SkeletonBlock width="100%" height={60} style={{ borderRadius: radii.md }} />
    </View>
  );

  /* ---- Connected state ---- */
  const renderConnected = () => (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: heroSlide }] }}>
      {/* Hero Balance Card */}
      <View style={styles.heroCardOuter}>
        <LinearGradient
          colors={isDark ? ["#0A2A1A", "#1A0A30"] : ["#0B3D24", "#2D1463"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* Wallet address bar */}
          <View style={styles.heroAddressRow}>
            <View style={styles.heroConnectedDot} />
            <Text style={styles.heroAddressText}>
              {formatWalletAddress(session.walletAddress ?? "")}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.heroCopyBtn, pressed && { opacity: 0.6 }]}
              onPress={copyAddress}
              hitSlop={12}
            >
              <Ionicons name="copy-outline" size={14} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>

          {/* Balance display — uniform grid */}
          <View style={styles.heroBalances}>
            <View style={styles.heroBalanceItem}>
              <Text style={[styles.heroBalanceAmount, { color: "#14F195" }]}>
                {balance?.skrUi?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "0"}
              </Text>
              <Text style={[styles.heroBalanceLabel, { color: "#14F195" }]}>SKR</Text>
            </View>

            <View style={styles.heroBalanceDivider} />

            <View style={styles.heroBalanceItem}>
              <Text style={styles.heroBalanceAmount}>
                {((balance?.solLamports ?? 0) / 1e9).toFixed(4)}
              </Text>
              <Text style={styles.heroBalanceLabel}>SOL</Text>
            </View>

            {(balance?.usdcUi ?? 0) > 0 && (
              <>
                <View style={styles.heroBalanceDivider} />
                <View style={styles.heroBalanceItem}>
                  <Text style={styles.heroBalanceAmount}>
                    {(balance?.usdcUi ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.heroBalanceLabel}>USDC</Text>
                </View>
              </>
            )}

            {(balance?.usdtUi ?? 0) > 0 && (
              <>
                <View style={styles.heroBalanceDivider} />
                <View style={styles.heroBalanceItem}>
                  <Text style={styles.heroBalanceAmount}>
                    {(balance?.usdtUi ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.heroBalanceLabel}>USDT</Text>
                </View>
              </>
            )}
          </View>

          {/* Bottom gradient shine */}
          <LinearGradient
            colors={["transparent", "rgba(20, 241, 149, 0.06)"]}
            style={styles.heroShine}
          />
        </LinearGradient>
      </View>

      {/* Prediction Stats */}
      <View style={[styles.sectionCard, { marginTop: spacing.lg }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>PREDICTION STATS</Text>
        </View>
        <View style={styles.predGrid}>
          <View style={styles.predItem}>
            <Text style={styles.predValue}>{predictionStats.wagered.toLocaleString()}</Text>
            <Text style={styles.predLabel}>Wagered</Text>
          </View>
          <View style={styles.predDivider} />
          <View style={styles.predItem}>
            <Text style={[styles.predValue, { color: predictionStats.profit >= 0 ? "#14F195" : "#FF3344" }]}>
              {predictionStats.profit >= 0 ? "+" : ""}{predictionStats.profit.toLocaleString()}
            </Text>
            <Text style={styles.predLabel}>Profit</Text>
          </View>
          <View style={styles.predDivider} />
          <View style={styles.predItem}>
            <Text style={styles.predValue}>{predictionStats.winRate}%</Text>
            <Text style={styles.predLabel}>Win Rate</Text>
          </View>
          <View style={styles.predDivider} />
          <View style={styles.predItem}>
            <Text style={styles.predValue}>{predictionStats.rank ? `#${predictionStats.rank}` : "--"}</Text>
            <Text style={styles.predLabel}>Rank</Text>
          </View>
        </View>
      </View>

      {/* ══════════════════════════════════════════════════════════════════
          SWAP — Premium DEX Interface
          ══════════════════════════════════════════════════════════════════ */}
      <View style={[styles.swapContainer, { marginTop: spacing.xl }]}>
        {/* Glass shell with gradient overlay */}
        <View style={styles.swapGlass}>
          {/* Header with decorative line */}
          <View style={styles.swapHeader}>
            <View style={styles.swapHeaderLeft}>
              <Text style={styles.swapHeaderTitle}>Swap</Text>
              <View style={styles.swapHeaderLine}>
                <View style={styles.swapHeaderLineFill} />
                <View style={styles.swapHeaderLineDot} />
              </View>
            </View>
            <View style={styles.swapPoweredBy}>
              <Ionicons name="flash" size={10} color="#14F195" />
              <Text style={styles.swapPoweredByText}>Jupiter</Text>
            </View>
          </View>

          {/* ─── FROM Panel ─── */}
          <View style={styles.swapFromPanel}>
            <View style={styles.swapPanelTop}>
              <Text style={styles.swapPanelTag}>You pay</Text>
              {balance && (
                <View style={styles.swapBalanceRow}>
                  <Text style={styles.swapBalanceLabel}>
                    {getSwapTokenBalance(swapFrom).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </Text>
                  <Pressable
                    hitSlop={14}
                    onPress={() => {
                      const maxBalance = getSwapTokenBalance(swapFrom);
                      const maxAmt = swapFrom === "SOL"
                        ? String(Math.max(0, maxBalance - 0.005).toFixed(6))
                        : String(maxBalance);
                      setSwapAmountStr(maxAmt);
                      void Haptics.selectionAsync();
                    }}
                  >
                    <Text style={styles.swapMaxPill}>MAX</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.swapInputRow}>
              {/* Token selector — large chunky pill */}
              <Pressable
                style={({ pressed }) => [styles.swapTokenPill, pressed && { transform: [{ scale: 0.96 }] }]}
                onPress={() => {
                  setSwapPickerTarget("from");
                  setSwapPickerOpen(true);
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.swapTokenBadge, { backgroundColor: TOKEN_COLORS[swapFrom] }]}>
                  <Text style={styles.swapTokenInitial}>{SWAP_TOKENS[swapFrom].symbol[0]}</Text>
                </View>
                <Text style={styles.swapTokenSymbol}>{SWAP_TOKENS[swapFrom].symbol}</Text>
                <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
              </Pressable>

              {/* Amount input — commanding presence */}
              <TextInput
                style={styles.swapAmountInput}
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.15)"
                keyboardType="decimal-pad"
                value={swapAmountStr}
                onChangeText={setSwapAmountStr}
                editable={swapStatus !== "building" && swapStatus !== "signing" && swapStatus !== "confirming" && swapStatus !== "success"}
                returnKeyType="done"
                maxLength={12}
              />
            </View>
          </View>

          {/* ─── Flip Button — Floating Orbital ─── */}
          <View style={styles.swapFlipWrapper}>
            <View style={styles.swapFlipTrack} />
            <Pressable
              style={({ pressed }) => [
                styles.swapFlipOrb,
                pressed && { transform: [{ scale: 0.88 }, { rotate: "180deg" }] },
              ]}
              onPress={() => {
                const prev = swapFrom;
                setSwapFrom(swapTo);
                setSwapTo(prev);
                setSwapAmountStr("");
                setSwapQuote(null);
                setSwapError(null);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
            >
              <Ionicons name="swap-vertical" size={20} color="#14F195" />
            </Pressable>
            <View style={styles.swapFlipTrack} />
          </View>

          {/* ─── TO Panel — Glows when quote ready ─── */}
          <View style={[styles.swapToPanel, swapQuote && styles.swapToPanelActive]}>
            <View style={styles.swapPanelTop}>
              <Text style={styles.swapPanelTag}>You receive</Text>
              {swapQuote && (() => {
                const inAmt = parseFloat(swapAmountStr) || 1;
                const outAmt = parseFloat(formatTokenAmount(swapQuote.outAmount, SWAP_TOKENS[swapTo].decimals));
                const rate = (outAmt / inAmt).toFixed(4);
                return (
                  <Text style={styles.swapRateLabel}>
                    1 {SWAP_TOKENS[swapFrom].symbol} ≈ {rate} {SWAP_TOKENS[swapTo].symbol}
                  </Text>
                );
              })()}
            </View>

            <View style={styles.swapInputRow}>
              {/* Token selector */}
              <Pressable
                style={({ pressed }) => [styles.swapTokenPill, pressed && { transform: [{ scale: 0.96 }] }]}
                onPress={() => {
                  setSwapPickerTarget("to");
                  setSwapPickerOpen(true);
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.swapTokenBadge, { backgroundColor: TOKEN_COLORS[swapTo] }]}>
                  <Text style={styles.swapTokenInitial}>{SWAP_TOKENS[swapTo].symbol[0]}</Text>
                </View>
                <Text style={styles.swapTokenSymbol}>{SWAP_TOKENS[swapTo].symbol}</Text>
                <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
              </Pressable>

              {/* Output amount or loading */}
              {swapStatus === "quoting" ? (
                <View style={styles.swapOutputLoading}>
                  <ActivityIndicator size="small" color="#14F195" />
                </View>
              ) : (
                <Text style={[styles.swapAmountOutput, swapQuote && styles.swapAmountOutputActive]} numberOfLines={1}>
                  {swapQuote ? formatTokenAmount(swapQuote.outAmount, SWAP_TOKENS[swapTo].decimals) : "0"}
                </Text>
              )}
            </View>

            {/* Price impact indicator */}
            {swapQuote && (() => {
              const impact = parseFloat(swapQuote.priceImpactPct);
              const severity = impact > 1 ? "high" : impact > 0.3 ? "med" : "low";
              return (
                <View style={styles.swapImpactRow}>
                  <Text style={styles.swapImpactLabel}>Price impact</Text>
                  <Text style={[
                    styles.swapImpactValue,
                    severity === "high" && { color: "#FF3344" },
                    severity === "med" && { color: "#F59E0B" },
                  ]}>
                    {impact < 0.01 ? "<0.01" : impact.toFixed(2)}%
                  </Text>
                </View>
              );
            })()}
          </View>

          {/* ─── Status States ─── */}
          {/* Progress */}
          {(swapStatus === "building" || swapStatus === "signing" || swapStatus === "confirming") && (
            <View style={styles.swapStatusBanner}>
              <ActivityIndicator size="small" color="#14F195" />
              <Text style={styles.swapStatusText}>
                {swapStatus === "building" && "Building transaction…"}
                {swapStatus === "signing" && "Approve in wallet…"}
                {swapStatus === "confirming" && "Confirming on Solana…"}
              </Text>
            </View>
          )}

          {/* Error */}
          {swapStatus === "failed" && swapError && (
            <View style={styles.swapErrorBanner}>
              <Ionicons name="alert-circle" size={16} color="#FF3344" />
              <Text style={styles.swapErrorText} numberOfLines={2}>{swapError}</Text>
            </View>
          )}

          {/* Success */}
          {swapStatus === "success" && swapTxSig ? (
            <View style={styles.swapSuccessBanner}>
              <View style={styles.swapSuccessTop}>
                <View style={styles.swapSuccessCheck}>
                  <Ionicons name="checkmark" size={18} color="#000" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.swapSuccessTitle}>Swap complete</Text>
                  <Text style={styles.swapSuccessDetail}>
                    {swapAmountStr} {SWAP_TOKENS[swapFrom].symbol} → {swapQuote ? formatTokenAmount(swapQuote.outAmount, SWAP_TOKENS[swapTo].decimals) : "?"} {SWAP_TOKENS[swapTo].symbol}
                  </Text>
                </View>
              </View>
              <View style={styles.swapSuccessActions}>
                <Pressable
                  style={({ pressed }) => [styles.swapViewTxBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    void WebBrowser.openBrowserAsync(`https://solscan.io/tx/${swapTxSig}`).catch(() => {
                      showToast("Could not open transaction details right now", "error");
                    });
                  }}
                >
                  <Ionicons name="open-outline" size={14} color="#14F195" />
                  <Text style={styles.swapViewTxText}>Solscan</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.swapNewBtn, pressed && { transform: [{ scale: 0.97 }] }]}
                  onPress={resetSwap}
                >
                  <Text style={styles.swapNewBtnText}>New Swap</Text>
                </Pressable>
              </View>
            </View>
          ) : swapStatus !== "building" && swapStatus !== "signing" && swapStatus !== "confirming" && (
            /* ─── CTA Button ─── */
            <Pressable
              style={({ pressed }) => [
                styles.swapCTA,
                (swapStatus === "ready" || swapStatus === "failed") && styles.swapCTAReady,
                pressed && (swapStatus === "ready" || swapStatus === "failed") && { transform: [{ scale: 0.98 }], opacity: 0.92 },
              ]}
              onPress={() => void handleExecuteSwap()}
              disabled={swapStatus !== "ready" && swapStatus !== "failed"}
            >
              {swapStatus === "quoting" ? (
                <ActivityIndicator size="small" color="#14F195" />
              ) : swapStatus === "ready" ? (
                <>
                  <Ionicons name="flash" size={18} color="#000" />
                  <Text style={styles.swapCTATextReady}>Swap</Text>
                </>
              ) : swapStatus === "failed" ? (
                <>
                  <Ionicons name="refresh" size={17} color="#000" />
                  <Text style={styles.swapCTATextReady}>Retry</Text>
                </>
              ) : (
                <Text style={styles.swapCTAText}>Enter an amount</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Token Picker Modal ── */}
      <Modal
        visible={swapPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSwapPickerOpen(false)}
      >
        <Pressable style={styles.swapPickerOverlay} onPress={() => setSwapPickerOpen(false)}>
          <View style={styles.swapPickerSheet}>
            <View style={styles.swapPickerHandle} />
            <Text style={styles.swapPickerTitle}>Select Token</Text>
            {(Object.keys(SWAP_TOKENS) as SwapTokenKey[]).map((key) => {
              const isSelected = swapPickerTarget === "from" ? swapFrom === key : swapTo === key;
              const col = TOKEN_COLORS[key];
              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [
                    styles.swapPickerRow,
                    isSelected && { backgroundColor: col + "14", borderColor: col + "35", borderWidth: 1 },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    if (swapPickerTarget === "from") {
                      if (key === swapTo) setSwapTo(swapFrom);
                      setSwapFrom(key);
                    } else {
                      if (key === swapFrom) setSwapFrom(swapTo);
                      setSwapTo(key);
                    }
                    setSwapQuote(null);
                    setSwapError(null);
                    setSwapAmountStr("");
                    setSwapPickerOpen(false);
                    void Haptics.selectionAsync();
                  }}
                >
                  <View style={[styles.swapPickerCoin, { backgroundColor: col }]}>
                    <Text style={styles.swapPickerCoinText}>{key[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.swapPickerTicker}>{SWAP_TOKENS[key].symbol}</Text>
                    <Text style={styles.swapPickerName}>{SWAP_TOKENS[key].label}</Text>
                  </View>
                  {isSelected && (
                    <View style={[styles.swapPickerCheckBg, { backgroundColor: col + "22" }]}>
                      <Ionicons name="checkmark" size={15} color={col} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={feedbackOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={closeFeedbackSheet}
      >
        <View style={styles.swapPickerOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeFeedbackSheet} />
          <View style={[styles.swapPickerSheet, { maxHeight: Dimensions.get("window").height * 0.85, marginBottom: feedbackKbHeight }]}>
            <View style={styles.swapPickerHandle} />
            <Text style={styles.swapPickerTitle}>Send Feedback</Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >

              {feedbackSuccess ? (
                <View
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: spacing.xl,
                    gap: spacing.sm,
                  }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#14F19522",
                    }}
                  >
                    <Ionicons name="checkmark" size={30} color="#14F195" />
                  </View>
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      fontSize: 20,
                      color: palette.coal,
                      letterSpacing: -0.4,
                    }}
                  >
                    Thanks, we got it.
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      fontSize: 13,
                      color: palette.muted,
                      textAlign: "center",
                    }}
                  >
                    Your feedback is now in our review queue.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md }}>
                    {[
                      { key: "bug" as const, label: "Bug", icon: "bug" as const, color: "#FF5A5A" },
                      { key: "suggestion" as const, label: "Suggestion", icon: "bulb" as const, color: "#8B5CF6" },
                      { key: "other" as const, label: "Other", icon: "chatbubble-ellipses" as const, color: "#14F195" },
                    ].map((item) => {
                      const active = feedbackType === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          style={({ pressed }) => [
                            {
                              flex: 1,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              borderRadius: radii.pill,
                              borderWidth: 1,
                              borderColor: active ? item.color : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                              backgroundColor: active ? `${item.color}22` : "transparent",
                              paddingVertical: 10,
                              opacity: pressed ? 0.8 : 1,
                            }
                          ]}
                          onPress={() => setFeedbackType(item.key)}
                        >
                          <Ionicons
                            name={item.icon}
                            size={14}
                            color={active ? item.color : palette.muted}
                          />
                          <Text
                            style={{
                              fontFamily: "Manrope_700Bold",
                              fontSize: 12,
                              color: active ? item.color : palette.coal,
                            }}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <TextInput
                    value={feedbackSubject}
                    onChangeText={setFeedbackSubject}
                    placeholder={feedbackType === "bug" ? "What broke?" : "What should we improve?"}
                    placeholderTextColor={palette.muted}
                    maxLength={100}
                    style={{
                      borderRadius: radii.lg,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.md,
                      marginBottom: spacing.sm,
                      color: palette.coal,
                      fontFamily: "Manrope_600SemiBold",
                      fontSize: 14,
                    }}
                  />

                  <TextInput
                    value={feedbackMessage}
                    onChangeText={setFeedbackMessage}
                    placeholder="Describe the issue or idea in detail..."
                    placeholderTextColor={palette.muted}
                    multiline
                    textAlignVertical="top"
                    maxLength={1000}
                    style={{
                      borderRadius: radii.lg,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.md,
                      minHeight: 100,
                      paddingTop: 14,
                      color: palette.coal,
                      fontFamily: "Manrope_500Medium",
                      fontSize: 14,
                    }}
                  />

                  <Text
                    style={{
                      marginTop: spacing.xs,
                      textAlign: "right",
                      fontFamily: "Manrope_500Medium",
                      fontSize: 11,
                      color: palette.muted,
                    }}
                  >
                    {feedbackMessage.length}/1000
                  </Text>

                  <Pressable
                    style={({ pressed }) => [
                      {
                        marginTop: spacing.md,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: spacing.xs,
                        borderRadius: radii.md,
                        backgroundColor: "#14F195",
                        paddingVertical: spacing.md,
                        opacity: feedbackSubmitting ? 0.7 : pressed ? 0.9 : 1,
                      }
                    ]}
                    disabled={feedbackSubmitting}
                    onPress={() => void handleSubmitFeedback()}
                  >
                    {feedbackSubmitting ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : (
                      <>
                        <Ionicons name="send" size={15} color="#000000" />
                        <Text
                          style={{
                            fontFamily: "Manrope_700Bold",
                            fontSize: 15,
                            color: "#000000",
                          }}
                        >
                          Send Feedback
                        </Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Quick Actions */}
      <Text style={[styles.quickActionsLabel, { marginTop: spacing.xl }]}>QUICK ACTIONS</Text>

      <Pressable
        style={({ pressed }) => [styles.actionRow, { marginTop: spacing.sm }, pressed && { opacity: 0.7 }]}
        onPress={() => navigation.navigate("Saved" as never)}
      >
        <View style={[styles.actionIconWrap, { backgroundColor: "#9945FF18" }]}>
          <Ionicons name="bookmark" size={16} color="#9945FF" />
        </View>
        <Text style={styles.actionLabel}>Saved Articles</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.muted} />
      </Pressable>

      {/* Follow on X - Animated Border */}
      <XCard
        isDark={isDark}
        palette={palette}
        onOpenX={() => {
          void WebBrowser.openBrowserAsync("https://x.com/chainshorts").catch(() => {
            showToast("Could not open Chainshorts on X right now.", "error");
          });
        }}
      />

      {/* Appearance */}
      <View style={[styles.sectionCard, { marginTop: spacing.lg }]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="color-palette-outline" size={16} color={palette.muted} />
          <Text style={styles.sectionLabel}>APPEARANCE</Text>
        </View>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((option) => {
            const active = themeMode === option.mode;
            return (
              <Pressable
                key={option.mode}
                style={[styles.themeBtn, active && styles.themeBtnActive]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setMode(option.mode);
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={14}
                  color={active ? "#040608" : palette.muted}
                />
                <Text style={[styles.themeBtnText, active && styles.themeBtnTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.themeHint}>
          {themeMode === "system"
            ? `Following system (${isDark ? "dark" : "light"})`
            : `${themeMode === "dark" ? "Dark" : "Light"} mode active`}
        </Text>
      </View>

      {/* Advertise with us */}
      <Pressable
        style={({ pressed }) => [
          styles.actionRow,
          {
            marginTop: spacing.md,
            borderColor: "rgba(255,147,0,0.30)",
            backgroundColor: isDark ? "rgba(255,147,0,0.05)" : "rgba(255,147,0,0.04)",
            overflow: "hidden",
          },
          pressed && { opacity: 0.7 },
        ]}
        onPress={() => {
          const safeUrl = parseHttpUrl(FALLBACK_ADVERTISER_PORTAL_URL)?.toString();
          if (!safeUrl) {
            showToast("Advertiser portal is not available right now", "error");
            return;
          }
          void WebBrowser.openBrowserAsync(safeUrl).catch(() => {
            showToast("Advertiser portal is not available right now", "error");
          });
        }}
      >
        {/* Left accent bar — mirrors the SponsoredCard bar */}
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: "#FF9300" }} />

        <View style={[styles.actionIconWrap, { backgroundColor: "#FF930030", marginLeft: 8, width: 38, height: 38 }]}>
          <Ionicons name="megaphone" size={20} color="#FF9300" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: palette.coal, letterSpacing: -0.2 }}>
            Advertise on Chainshorts
          </Text>
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#FF9300", marginTop: 2 }}>
            Launch and manage sponsored campaigns
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#FF9300" />
      </Pressable>

      {/* Privacy Policy */}
      <Pressable
        style={({ pressed }) => [styles.actionRow, { marginTop: spacing.md }, pressed && { opacity: 0.7 }]}
        onPress={() => {
          if (!privacyPolicyUrl) {
            showToast("Privacy policy URL not configured", "error");
            return;
          }
          const safeUrl = parseHttpUrl(privacyPolicyUrl)?.toString();
          if (!safeUrl) {
            showToast("Privacy policy URL is invalid", "error");
            return;
          }
          void WebBrowser.openBrowserAsync(safeUrl).catch(() => {
            showToast("Could not open the privacy policy right now", "error");
          });
        }}
      >
        <View style={[styles.actionIconWrap, { backgroundColor: "#00CFFF18" }]}>
          <Ionicons name="document-text" size={16} color="#00CFFF" />
        </View>
        <Text style={styles.actionLabel}>Privacy Policy</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.muted} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.actionRow, { marginTop: spacing.md }, pressed && { opacity: 0.7 }]}
        onPress={() => {
          if (!walletConnected) {
            showToast("Connect your wallet to send feedback", "info");
            setShowWalletSelector(true);
            return;
          }
          resetFeedbackForm();
          setFeedbackOpen(true);
        }}
      >
        <View style={[styles.actionIconWrap, { backgroundColor: "#14F19518" }]}>
          <Ionicons name="chatbubble-ellipses" size={16} color="#14F195" />
        </View>
        <Text style={styles.actionLabel}>Send Feedback</Text>
        <Ionicons name="chevron-forward" size={16} color={palette.muted} />
      </Pressable>

      {/* Support Chainshorts */}
      {platformWallet && (
        <View style={{ marginTop: spacing.lg }}>
          <SupportCard
            platformWallet={platformWallet}
            userSolBalance={(balance?.solLamports ?? 0) / 1e9}
            userSkrBalance={balance?.skrUi ?? 0}
            onSuccess={load}
          />
        </View>
      )}

      {/* Disconnect */}
      <Pressable
        style={({ pressed }) => [styles.disconnectBtn, { marginTop: spacing.xl }, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}
        onPress={() => void disconnectWallet()}
      >
        <Ionicons name="log-out-outline" size={18} color="#FF3344" />
        <Text style={styles.disconnectText}>Disconnect Wallet</Text>
      </Pressable>
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wallet</Text>
        {walletConnected && (
          <View style={styles.headerBadge}>
            <View style={styles.headerBadgeDot} />
            <Text style={styles.headerBadgeText}>Connected</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={loading && walletConnected}
            onRefresh={() => void load()}
            tintColor={palette.ember}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!walletConnected
          ? renderDisconnected()
          : loading
          ? renderSkeleton()
          : renderConnected()}
      </ScrollView>

      <WalletSelector
        visible={showWalletSelector}
        onSelectWallet={handleWalletSelect}
        onCancel={handleWalletSelectorCancel}
        isConnecting={walletBusy}
        connectingWalletId={connectingWalletId}
      />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const getStyles = (palette: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.parchment,
    },

    /* Header */
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
    headerBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "#14F19515",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: "#14F19530",
    },
    headerBadgeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "#14F195",
    },
    headerBadgeText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      color: "#14F195",
      letterSpacing: 0.3,
    },

    content: {
      padding: spacing.lg,
      paddingTop: spacing.md,
    },

    /* Disconnected / Connect CTA */
    disconnectedContainer: {
      flex: 1,
      alignItems: "center",
      paddingTop: spacing.xxl,
      paddingHorizontal: spacing.md,
    },
    heroIconContainer: {
      position: "relative",
      marginBottom: spacing.lg,
    },
    heroIconOuter: {
      width: 100,
      height: 100,
      borderRadius: 28,
      backgroundColor: palette.milk,
      borderWidth: 1,
      borderColor: "#14F19530",
      alignItems: "center",
      justifyContent: "center",
    },
    heroIconGlow: {
      position: "absolute",
      top: -10,
      left: -10,
      right: -10,
      bottom: -10,
      borderRadius: 38,
      backgroundColor: "#14F195",
      opacity: 0.06,
      zIndex: -1,
    },
    heroTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 28,
      color: palette.coal,
      textAlign: "center",
      marginBottom: spacing.xs,
    },
    heroSubtitle: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.muted,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: spacing.xl,
    },
    featuresList: {
      width: "100%",
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    featureItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.milk,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.line,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    featureText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.coal,
    },
    walletsText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      textAlign: "center",
      marginBottom: spacing.xl,
    },
    connectBtn: {
      width: "100%",
      height: 52,
      borderRadius: radii.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: "#14F195",
    },
    connectBtnPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.98 }],
    },
    connectBtnDisabled: {
      opacity: 0.6,
    },
    connectBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 16,
      color: "#040608",
    },
    securityRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: spacing.lg,
    },
    securityText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },

    /* Hero Balance Card */
    heroCardOuter: {
      borderRadius: radii.lg,
      ...elevation.card,
    },
    heroCard: {
      borderRadius: radii.lg,
      padding: spacing.xl,
      overflow: "hidden",
      minHeight: 180,
      justifyContent: "space-between",
    },
    heroAddressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: spacing.lg,
    },
    heroConnectedDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#14F195",
    },
    heroAddressText: {
      fontFamily: "Courier",
      fontSize: 13,
      color: "rgba(255,255,255,0.7)",
      letterSpacing: 0.5,
      flex: 1,
    },
    heroCopyBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    heroBalances: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-evenly",
    },
    heroBalanceItem: {
      flex: 1,
      alignItems: "center",
    },
    heroBalanceAmount: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      color: "rgba(255,255,255,0.9)",
      lineHeight: 26,
    },
    heroBalanceLabel: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 11,
      color: "rgba(255,255,255,0.5)",
      letterSpacing: 0.8,
      marginTop: 2,
    },
    heroBalanceDivider: {
      width: 1,
      height: 36,
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    heroShine: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 80,
    },

    /* Section Card */
    sectionCard: {
      backgroundColor: palette.milk,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.line,
      padding: spacing.md,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.8,
      color: palette.muted,
    },

    /* Prediction grid */
    predGrid: {
      flexDirection: "row",
      alignItems: "center",
    },
    predItem: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.xs,
    },
    predValue: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 18,
      color: palette.coal,
    },
    predLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      marginTop: 2,
    },
    predDivider: {
      width: 1,
      height: 30,
      backgroundColor: palette.line,
    },

    /* Quick Actions */
    quickActionsLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 11,
      letterSpacing: 0.8,
      color: palette.muted,
      marginTop: spacing.xs,
    },

    /* Action Row */
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.milk,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.line,
      padding: spacing.md,
    },
    actionIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    actionLabel: {
      flex: 1,
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: palette.coal,
    },

    /* Theme selector */
    themeRow: {
      flexDirection: "row",
      gap: 8,
    },
    themeBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.line,
      backgroundColor: palette.parchment,
    },
    themeBtnActive: {
      backgroundColor: "#14F195",
      borderColor: "#14F195",
    },
    themeBtnText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    themeBtnTextActive: {
      color: "#040608",
      fontFamily: "Manrope_700Bold",
    },
    themeHint: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
      marginTop: 8,
      textAlign: "center",
    },

    /* ══════════════════════════════════════════════════════════════════
       SWAP — Premium DEX Interface Styles
       ══════════════════════════════════════════════════════════════════ */
    swapContainer: {
      paddingHorizontal: 0,
    },
    swapGlass: {
      backgroundColor: isDark ? "#080C12" : "#FFFFFF",
      borderRadius: radii.lg,
      borderWidth: 2,
      borderColor: isDark ? "rgba(20,241,149,0.4)" : "rgba(20,241,149,0.5)",
      paddingBottom: spacing.md,
    },
    swapHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    swapHeaderLeft: {
      flexDirection: "column",
    },
    swapHeaderTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      color: palette.coal,
      letterSpacing: -0.5,
    },
    swapHeaderLine: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.xs,
      gap: 3,
    },
    swapHeaderLineFill: {
      width: 36,
      height: 2,
      backgroundColor: "#14F195",
      borderRadius: 1,
    },
    swapHeaderLineDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: "#14F195",
    },
    swapPoweredBy: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.pill,
      backgroundColor: isDark ? "rgba(20,241,149,0.08)" : "rgba(20,241,149,0.10)",
    },
    swapPoweredByText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 11,
      color: "#14F195",
      letterSpacing: 0.3,
    },

    /* FROM Panel */
    swapFromPanel: {
      marginHorizontal: spacing.sm,
      backgroundColor: isDark ? "#0C1018" : "#F6F8FA",
      borderRadius: radii.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    },
    swapPanelTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    swapPanelTag: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      textTransform: "capitalize",
    },
    swapBalanceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    swapBalanceLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    swapMaxPill: {
      fontFamily: "Manrope_700Bold",
      fontSize: 10,
      color: "#14F195",
      letterSpacing: 0.8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: isDark ? "rgba(20,241,149,0.12)" : "rgba(20,241,149,0.15)",
      borderRadius: 6,
      overflow: "hidden",
    },
    swapInputRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    /* Token selector pill */
    swapTokenPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingLeft: spacing.xs,
      paddingRight: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      flexShrink: 0,
    },
    swapTokenBadge: {
      width: 32,
      height: 32,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    swapTokenInitial: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 14,
      color: "rgba(0,0,0,0.7)",
    },
    swapTokenSymbol: {
      fontFamily: "Manrope_700Bold",
      fontSize: 15,
      color: palette.coal,
    },
    /* Amount input */
    swapAmountInput: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 32,
      color: palette.coal,
      textAlign: "right",
      flex: 1,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      includeFontPadding: false,
      letterSpacing: -1,
    },

    /* Flip button wrapper */
    swapFlipWrapper: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    swapFlipTrack: {
      flex: 1,
      height: 1,
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    },
    swapFlipOrb: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      backgroundColor: isDark ? "#101820" : "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: isDark ? "rgba(20,241,149,0.35)" : "rgba(20,241,149,0.5)",
      shadowColor: "#14F195",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isDark ? 0.3 : 0.2,
      shadowRadius: 8,
      elevation: 4,
    },

    /* TO Panel */
    swapToPanel: {
      marginHorizontal: spacing.sm,
      backgroundColor: isDark ? "#0A0F14" : "#F0FDF8",
      borderRadius: radii.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: isDark ? "rgba(20,241,149,0.08)" : "rgba(20,241,149,0.15)",
    },
    swapToPanelActive: {
      borderColor: isDark ? "rgba(20,241,149,0.25)" : "rgba(20,241,149,0.35)",
      backgroundColor: isDark ? "#080E12" : "#ECFDF5",
      // Subtle glow when quote ready
      shadowColor: "#14F195",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isDark ? 0.12 : 0.08,
      shadowRadius: 20,
      elevation: 4,
    },
    swapRateLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
    },
    swapOutputLoading: {
      flex: 1,
      alignItems: "flex-end",
      justifyContent: "center",
      paddingVertical: spacing.xs,
    },
    swapAmountOutput: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 32,
      color: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)",
      textAlign: "right",
      flex: 1,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      includeFontPadding: false,
      letterSpacing: -1,
    },
    swapAmountOutputActive: {
      color: "#14F195",
    },
    swapImpactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    },
    swapImpactLabel: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    swapImpactValue: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
    },

    /* Status banners */
    swapStatusBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.sm,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: isDark ? "rgba(20,241,149,0.06)" : "rgba(20,241,149,0.08)",
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: isDark ? "rgba(20,241,149,0.15)" : "rgba(20,241,149,0.2)",
    },
    swapStatusText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 13,
      color: isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)",
    },
    swapErrorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.sm,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: "rgba(255,51,68,0.06)",
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: "rgba(255,51,68,0.15)",
    },
    swapErrorText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 13,
      color: "#FF3344",
      flex: 1,
    },

    /* Success state */
    swapSuccessBanner: {
      marginHorizontal: spacing.sm,
      marginTop: spacing.md,
      padding: spacing.md,
      backgroundColor: isDark ? "rgba(20,241,149,0.06)" : "rgba(20,241,149,0.08)",
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: isDark ? "rgba(20,241,149,0.22)" : "rgba(20,241,149,0.3)",
    },
    swapSuccessTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    swapSuccessCheck: {
      width: 32,
      height: 32,
      borderRadius: radii.pill,
      backgroundColor: "#14F195",
      alignItems: "center",
      justifyContent: "center",
    },
    swapSuccessTitle: {
      fontFamily: "Manrope_700Bold",
      fontSize: 15,
      color: "#14F195",
    },
    swapSuccessDetail: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
      marginTop: 2,
    },
    swapSuccessActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    swapViewTxBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: isDark ? "rgba(20,241,149,0.3)" : "rgba(20,241,149,0.4)",
      backgroundColor: "transparent",
    },
    swapViewTxText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 12,
      color: "#14F195",
    },
    swapNewBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: "#14F195",
    },
    swapNewBtnText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 13,
      color: "#000000",
    },

    /* CTA Button */
    swapCTA: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.sm,
      marginTop: spacing.md,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    swapCTAReady: {
      backgroundColor: "#14F195",
      borderColor: "#14F195",
      // Glow effect
      shadowColor: "#14F195",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    swapCTAText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 16,
      color: palette.muted,
    },
    swapCTATextReady: {
      fontFamily: "Manrope_700Bold",
      fontSize: 17,
      color: "#000000",
      letterSpacing: -0.2,
    },
    /* Token Picker Modal */
    swapPickerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.62)",
      justifyContent: "flex-end",
    },
    swapPickerSheet: {
      backgroundColor: isDark ? "#0D1117" : "#FFFFFF",
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 12,
      paddingBottom: 36,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
    },
    swapPickerHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
      alignSelf: "center",
      marginBottom: 20,
    },
    swapPickerTitle: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 21,
      color: palette.coal,
      marginBottom: 16,
      letterSpacing: -0.5,
    },
    swapPickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 14,
      marginBottom: 4,
      borderWidth: 1,
      borderColor: "transparent",
    },
    swapPickerCoin: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    swapPickerCoinText: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 21,
      color: "rgba(0,0,0,0.72)",
    },
    swapPickerTicker: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 17,
      color: palette.coal,
      letterSpacing: -0.3,
    },
    swapPickerName: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
      marginTop: 2,
    },
    swapPickerCheckBg: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },

    /* Disconnect */
    disconnectBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: isDark ? "rgba(255, 51, 68, 0.08)" : "rgba(255, 51, 68, 0.06)",
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: "rgba(255, 51, 68, 0.25)",
      padding: spacing.md,
      marginTop: spacing.xs,
    },
    disconnectText: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: "#FF3344",
    },
  });
