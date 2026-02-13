import { useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useTheme, spacing, textStyles } from "../theme";
import { useToast } from "../context/ToastContext";
import { parseHttpUrl } from "../utils/url";

type RootStackParamList = {
    ArticleWebView: { url: string; title?: string };
};

type WebViewScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "ArticleWebView">;
type WebViewScreenRouteProp = RouteProp<RootStackParamList, "ArticleWebView">;

export function ArticleWebViewScreen() {
    const navigation = useNavigation<WebViewScreenNavigationProp>();
    const route = useRoute<WebViewScreenRouteProp>();
    const { url, title } = route.params;

    const { palette } = useTheme();
    const { showToast } = useToast();
    const styles = useMemo(() => getStyles(palette), [palette]);
    const parsedUrl = useMemo(() => parseHttpUrl(url ?? ""), [url]);
    const displayHost = parsedUrl ? parsedUrl.hostname.replace(/^www\./, "") : "source";
    const safeUrl = parsedUrl?.toString();

    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);

    if (!safeUrl) {
        return (
            <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
                <View style={styles.header}>
                    <Pressable onPress={() => navigation.goBack()} style={styles.iconButton}>
                        <Ionicons name="close" size={24} color={palette.coal} />
                    </Pressable>
                </View>
                <View style={styles.center}>
                    <Text style={styles.errorText}>Invalid article URL.</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
            {/* Custom Header Bar */}
            <View style={styles.header}>
                <Pressable
                    onPress={() => navigation.goBack()}
                    style={styles.iconButton}
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: true }}
                    hitSlop={8}
                >
                    <Ionicons name="chevron-back" size={24} color={palette.coal} />
                </Pressable>

                    <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {title || displayHost}
                    </Text>
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                        <Ionicons name="lock-closed" size={10} color={palette.success} /> {displayHost}
                    </Text>
                </View>

                <Pressable
                    onPress={() => {
                        void WebBrowser.openBrowserAsync(safeUrl).catch(() => {
                            showToast("Could not open this article in your browser right now.", "error");
                        });
                    }}
                    style={styles.iconButton}
                    android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: true }}
                    hitSlop={8}
                >
                    <Ionicons name="open-outline" size={20} color={palette.coal} />
                </Pressable>
            </View>

            {/* Progress Bar */}
            {loading && (
                <View style={styles.progressContainer}>
                    <Animated.View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
                </View>
            )}

            {/* WebView */}
            <WebView
                source={{ uri: safeUrl }}
                style={styles.webview}
                originWhitelist={["http://*", "https://*"]}
                onShouldStartLoadWithRequest={(request) =>
                    request.url === "about:blank" || parseHttpUrl(request.url) !== null
                }
                onLoadStart={() => setLoading(true)}
                onLoadEnd={() => setLoading(false)}
                onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
                cacheEnabled={false}
                incognito
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction
                mixedContentMode="never"
                setSupportMultipleWindows={false}
                javaScriptCanOpenWindowsAutomatically={false}
                thirdPartyCookiesEnabled={false}
                sharedCookiesEnabled={false}
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                geolocationEnabled={false}
                showsVerticalScrollIndicator={false}
            />
        </SafeAreaView>
    );
}

const getStyles = (palette: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: palette.parchment,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: palette.line,
        backgroundColor: palette.parchment,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: "center",
        paddingHorizontal: spacing.sm,
    },
    headerTitle: {
        ...textStyles.subtitle,
        color: palette.coal,
        fontSize: 14,
    },
    headerSubtitle: {
        ...textStyles.caption,
        color: palette.muted,
        fontSize: 10,
        marginTop: 2,
    },
    iconButton: {
        padding: spacing.xs,
    },
    progressContainer: {
        height: 2,
        width: "100%",
        backgroundColor: "transparent",
    },
    progressBar: {
        height: "100%",
        backgroundColor: palette.ember,
    },
    webview: {
        flex: 1,
        backgroundColor: palette.milk,
    },
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    errorText: {
        ...textStyles.body,
        color: palette.danger,
    }
});
