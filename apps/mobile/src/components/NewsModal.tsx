import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { FeedCard } from "@chainshorts/shared";
import { useNavigation } from "@react-navigation/native";
import { elevation, radii, spacing, textStyles, useTheme } from "../theme";
import { parseHttpUrl } from "../utils/url";

interface NewsModalProps {
    visible: boolean;
    article: FeedCard | null;
    onClose: () => void;
}

export function NewsModal({ visible, article, onClose }: NewsModalProps) {
    const { palette } = useTheme();
    const styles = useMemo(() => getStyles(palette), [palette]);
    const navigation = useNavigation<any>();

    if (!article) return null;
    const sourceUrl = parseHttpUrl(article.sourceUrl)?.toString();
    const sourceHost = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : null;
    const canOpenSource = Boolean(sourceUrl);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close article info" />

            <View style={styles.sheet}>
                <View style={styles.handle} />

                <View style={styles.header}>
                    <View style={styles.sourceBadge}>
                        <View style={[styles.sourceDot, { backgroundColor: palette.ember }]} />
                        <Text style={styles.sourceText}>{article.sourceName.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.timeText}>
                        {new Date(article.publishedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                </View>

                <Text style={styles.headline}>{article.headline}</Text>
                <Text style={styles.summary}>{article.summary60}</Text>
                <View style={styles.sourceRow}>
                    <Ionicons name="globe-outline" size={14} color={palette.muted} />
                    <Text style={styles.sourceRowText} numberOfLines={1}>
                        {sourceHost ?? "Source URL unavailable"}
                    </Text>
                </View>

                <View style={styles.footerSpacing} />

                <Pressable
                    style={({ pressed }) => [
                        styles.readMoreBtn,
                        !canOpenSource && styles.readMoreBtnDisabled,
                        pressed && canOpenSource && styles.readMorePressed
                    ]}
                    disabled={!canOpenSource}
                    onPress={async () => {
                        if (!sourceUrl) {
                            return;
                        }
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        onClose();
                        navigation.navigate("ArticleWebView", { url: sourceUrl, title: article.headline });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canOpenSource }}
                    accessibilityLabel={canOpenSource ? "Open original publisher source" : "Source unavailable"}
                >
                    <LinearGradient
                        colors={canOpenSource ? [palette.ember, palette.emberDark] : [palette.line, palette.line]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.btnGradient}
                    >
                        <Text style={[styles.btnText, !canOpenSource && styles.btnTextDisabled]}>
                            {canOpenSource ? "OPEN ORIGINAL SOURCE" : "SOURCE UNAVAILABLE"}
                        </Text>
                        <Ionicons name="open-outline" size={16} color={canOpenSource ? "#040608" : palette.muted} />
                    </LinearGradient>
                </Pressable>
            </View>
        </Modal>
    );
}

const getStyles = (palette: any) =>
    StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: "rgba(4,6,8,0.7)"
        },
        sheet: {
            backgroundColor: palette.milk,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl + spacing.xl,
            paddingTop: spacing.md,
            ...elevation.overlay
        },
        handle: {
            width: 48,
            height: 5,
            borderRadius: radii.pill,
            backgroundColor: palette.line,
            alignSelf: "center",
            marginBottom: spacing.xl
        },
        header: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: spacing.md
        },
        sourceBadge: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: "rgba(255,255,255,0.04)",
            paddingHorizontal: spacing.sm,
            paddingVertical: 5,
            borderRadius: radii.sm,
            borderWidth: 1,
            borderColor: palette.line
        },
        sourceDot: {
            width: 6,
            height: 6,
            borderRadius: 3
        },
        sourceText: {
            fontFamily: "Manrope_700Bold",
            fontSize: 10,
            letterSpacing: 1.2,
            color: palette.coal
        },
        timeText: {
            ...textStyles.caption,
            color: palette.muted
        },
        headline: {
            ...textStyles.title,
            color: palette.coal,
            marginBottom: spacing.md
        },
        summary: {
            ...textStyles.body,
            color: palette.ink,
            lineHeight: 26
        },
        sourceRow: {
            marginTop: spacing.md,
            borderWidth: 1,
            borderColor: palette.line,
            borderRadius: radii.sm,
            backgroundColor: "rgba(255,255,255,0.03)",
            paddingHorizontal: spacing.sm,
            minHeight: 34,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs
        },
        sourceRowText: {
            ...textStyles.caption,
            color: palette.muted,
            flex: 1
        },
        footerSpacing: {
            height: spacing.xl
        },
        readMoreBtn: {
            borderRadius: radii.pill,
            overflow: "hidden",
            ...elevation.card
        },
        readMoreBtnDisabled: {
            shadowOpacity: 0,
            shadowRadius: 0,
            elevation: 0
        },
        readMorePressed: {
            opacity: 0.85
        },
        btnGradient: {
            height: 56,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm
        },
        btnText: {
            fontFamily: "Manrope_700Bold",
            fontSize: 13,
            letterSpacing: 1.8,
            color: "#040608"
        },
        btnTextDisabled: {
            color: palette.muted
        }
    });
