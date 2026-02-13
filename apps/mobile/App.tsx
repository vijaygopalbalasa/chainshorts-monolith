import "react-native-gesture-handler";
import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NavigationContainer,
  NavigatorScreenParams,
  createNavigationContainerRef,
  type Theme
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  useFonts as useBricolageFonts
} from "@expo-google-fonts/bricolage-grotesque";
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold, useFonts as useManropeFonts } from "@expo-google-fonts/manrope";
import { SessionProvider } from "./src/state/sessionStore";
import {
  FeedScreen,
  OnboardingScreen,
  SavedScreen,
  ArticleWebViewScreen,
  PredictScreen,
  LeaderboardScreen,
  PortfolioScreen,
  WalletScreen,
} from "./src/screens";
import { hasCompletedOnboarding, markOnboardingComplete } from "./src/state/onboardingStorage";
import { useSession } from "./src/state/sessionStore";
import { fetchArticleById, setAuthFailureHandler } from "./src/services/api";
import { syncPushRegistration } from "./src/services/pushRegistration";
import { useToast } from "./src/context/ToastContext";
import { textStyles, ThemeProvider, useTheme } from "./src/theme";
import { ToastProvider } from "./src/context/ToastContext";
import { ToastContainer } from "./src/components";
import { parseHttpUrl } from "./src/utils/url";

void SplashScreen.preventAutoHideAsync();

class ScreenErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

function ErrorFallback() {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: palette.parchment }}>
      <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 16, color: palette.coal, marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 13, color: palette.muted, textAlign: "center" }}>
        Pull down to refresh or switch tabs.
      </Text>
    </View>
  );
}

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

type RootTabParamList = {
  Feed: undefined;
  Predict: { focusPollId?: string } | undefined;
  Leaderboard: undefined;
  Portfolio: undefined;
  Wallet: undefined;
};

type RootStackParamList = {
  Tabs: NavigatorScreenParams<RootTabParamList>;
  Saved: undefined;
  ArticleWebView: { url: string; title?: string };
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const navFonts: Theme["fonts"] = {
  regular: {
    fontFamily: "Manrope_500Medium",
    fontWeight: "400"
  },
  medium: {
    fontFamily: "Manrope_700Bold",
    fontWeight: "500"
  },
  bold: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontWeight: "700"
  },
  heavy: {
    fontFamily: "BricolageGrotesque_700Bold",
    fontWeight: "800"
  }
};

export default function App() {
  const [bricolageLoaded] = useBricolageFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold
  });

  const [manropeLoaded] = useManropeFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold
  });

  const ready = bricolageLoaded && manropeLoaded;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <ToastProvider>
            <SessionProvider>
              <AppShell />
            </SessionProvider>
          </ToastProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { palette, isDark } = useTheme();
  const { showToast } = useToast();

  const { session, hydrated, clearSession } = useSession();
  const [onboardingKnown, setOnboardingKnown] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const navTheme = useMemo<Theme>(
    () => ({
      dark: isDark,
      colors: {
        primary: palette.ember,
        background: palette.parchment,
        card: isDark ? "rgba(4, 8, 12, 0.94)" : "rgba(245, 248, 250, 0.94)",
        text: palette.coal,
        border: palette.line,
        notification: palette.rose
      },
      fonts: navFonts
    }),
    [isDark, palette]
  );

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      const done = await hasCompletedOnboarding();
      if (!mounted) return;
      setOnboardingComplete(done);
      setOnboardingKnown(true);
    };
    void hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void syncPushRegistration(session).catch(() => {
      // Push is best-effort and should never block app usage.
      // eslint-disable-next-line no-console
      console.warn("Push registration skipped due to configuration/runtime state.");
    });
  }, [hydrated, session]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      clearSession();
      if (navigationRef.isReady()) {
        navigationRef.navigate("Tabs", {
          screen: "Wallet"
        });
      }
    });

    return () => {
      setAuthFailureHandler(null);
    };
  }, [clearSession]);

  useEffect(() => {
    const fgSub = Notifications.addNotificationReceivedListener(() => {
      // Foreground banner/list display is handled by the notification handler in pushRegistration.ts.
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: unknown;
        articleId?: unknown;
        pollId?: unknown;
      } | null;
      const type = data && typeof data.type === "string" ? data.type : undefined;
      const pollId = data && typeof data.pollId === "string" ? data.pollId : undefined;

      if (type === "prediction_created") {
        if (navigationRef.isReady()) {
          navigationRef.navigate("Tabs", {
            screen: "Predict",
            params: pollId ? { focusPollId: pollId } : undefined,
          });
        }
        return;
      }

      if (type === "stake_resolved" || type === "payout_claimable") {
        if (navigationRef.isReady()) {
          navigationRef.navigate("Tabs", {
            screen: "Portfolio"
          });
        }
        return;
      }

      if (navigationRef.isReady()) {
        navigationRef.navigate("Tabs", {
          screen: "Feed"
        });
      }

      const articleId = data && typeof data.articleId === "string" ? data.articleId : undefined;
      if (!articleId) {
        return;
      }

      void fetchArticleById(articleId, session.sessionToken)
        .then((article) => {
          const sourceUrl = parseHttpUrl(article.sourceUrl)?.toString();
          if (sourceUrl) {
            void WebBrowser.openBrowserAsync(sourceUrl).catch(() => {
              showToast("Could not open this article right now.", "error");
            });
          }
        })
        .catch(() => {
          // Feed navigation already happened; ignore article lookup errors.
        });
    });

    return () => {
      fgSub.remove();
      subscription.remove();
    };
  }, [session.sessionToken, showToast]);

  const completeOnboarding = async () => {
    await markOnboardingComplete();
    setOnboardingComplete(true);
  };

  if (!onboardingKnown) {
    return null;
  }

  if (!onboardingComplete) {
    return <OnboardingScreen onContinue={() => void completeOnboarding()} />;
  }

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={MainTabs} />
          <Stack.Screen
            name="Saved"
            component={SavedScreen}
            options={{
              presentation: "card",
              animation: "slide_from_right"
            }}
          />
          <Stack.Screen
            name="ArticleWebView"
            component={ArticleWebViewScreen}
            options={{
              presentation: "modal",
              animation: "slide_from_bottom"
            }}
          />
        </Stack.Navigator>
        <ToastContainer />
      </NavigationContainer>

    </>
  );
}

const FeedScreenGuarded = () => <ScreenErrorBoundary><FeedScreen /></ScreenErrorBoundary>;
const PredictScreenGuarded = () => <ScreenErrorBoundary><PredictScreen /></ScreenErrorBoundary>;
const LeaderboardScreenGuarded = () => <ScreenErrorBoundary><LeaderboardScreen /></ScreenErrorBoundary>;
const PortfolioScreenGuarded = () => <ScreenErrorBoundary><PortfolioScreen /></ScreenErrorBoundary>;
const WalletScreenGuarded = () => <ScreenErrorBoundary><WalletScreen /></ScreenErrorBoundary>;

function MainTabs() {
  const { palette, isDark } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.ember,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          height: 78,
          paddingBottom: 12,
          paddingTop: 10,
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={85}
            tint={isDark ? "dark" : "light"}
            style={[
              StyleSheet.absoluteFill,
              {
                borderTopWidth: 1,
                borderTopColor: palette.line,
              }
            ]}
          />
        ),
        tabBarLabel: ({ focused }) => {
          const labels: Record<string, string> = {
            Feed: "FEED",
            Predict: "PREDICT",
            Leaderboard: "LEADERS",
            Portfolio: "PORTFOLIO",
            Wallet: "WALLET"
          };
          return (
            <Text
              style={{
                ...textStyles.badge,
                color: focused ? palette.ember : palette.muted
              }}
            >
              {labels[route.name] ?? route.name.toUpperCase()}
            </Text>
          );
        },
        tabBarIcon: ({ focused, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "newspaper-outline";
          if (route.name === "Feed") iconName = "newspaper-outline";
          else if (route.name === "Predict") iconName = "trending-up-outline";
          else if (route.name === "Leaderboard") iconName = "trophy-outline";
          else if (route.name === "Portfolio") iconName = "pie-chart-outline";
          else if (route.name === "Wallet") iconName = "wallet-outline";

          return (
            <Ionicons
              name={iconName}
              size={size ?? 24}
              color={focused ? palette.coal : palette.muted}
            />
          );
        }
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreenGuarded} />
      <Tab.Screen name="Predict" component={PredictScreenGuarded} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreenGuarded} />
      <Tab.Screen name="Portfolio" component={PortfolioScreenGuarded} />
      <Tab.Screen name="Wallet" component={WalletScreenGuarded} />
    </Tab.Navigator>
  );
}
