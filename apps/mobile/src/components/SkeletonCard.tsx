import { useEffect, useRef, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { elevation, radii, spacing, useTheme } from "../theme";

function SkeletonBlock({ width, height, borderRadius = 6 }: { width: number | string; height: number; borderRadius?: number }) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.85] });

  return (
    <Animated.View
      style={[
        styles.block,
        { width: width as number, height, borderRadius, opacity }
      ]}
    />
  );
}

export function SkeletonCard({ viewportHeight }: { viewportHeight?: number }) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);
  const compactViewport = typeof viewportHeight === "number" && viewportHeight <= 440;
  const heroHeight = useMemo(() => {
    if (!viewportHeight) {
      return 168;
    }
    return Math.max(116, Math.min(168, Math.round(viewportHeight * 0.28)));
  }, [viewportHeight]);

  return (
    <View style={[styles.card, viewportHeight ? { height: "100%", minHeight: 0 } : null]}>
      {/* Hero placeholder */}
      <View style={[styles.hero, { height: heroHeight }]} />

      <View style={[styles.body, compactViewport && styles.bodyCompact]}>
        {/* Headline */}
        <SkeletonBlock width="90%" height={compactViewport ? 18 : 22} borderRadius={6} />
        <SkeletonBlock width="70%" height={compactViewport ? 18 : 22} borderRadius={6} />

        {/* Summary lines */}
        <View style={[styles.summaryLines, compactViewport && styles.summaryLinesCompact]}>
          <SkeletonBlock width="100%" height={compactViewport ? 12 : 14} />
          <SkeletonBlock width="100%" height={compactViewport ? 12 : 14} />
          <SkeletonBlock width="100%" height={compactViewport ? 12 : 14} />
          <SkeletonBlock width="100%" height={compactViewport ? 12 : 14} />
          <SkeletonBlock width="80%" height={compactViewport ? 12 : 14} />
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.footerSecondary}>
        <SkeletonBlock width="48%" height={42} borderRadius={6} />
        <SkeletonBlock width="48%" height={42} borderRadius={6} />
      </View>
    </View>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  card: {
    backgroundColor: palette.milk,
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
    minHeight: 520,
    ...elevation.card
  },
  hero: {
    backgroundColor: palette.line
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm
  },
  bodyCompact: {
    paddingHorizontal: spacing.md + 2,
    paddingTop: spacing.md
  },
  summaryLines: {
    marginTop: spacing.md,
    gap: spacing.xs + 2
  },
  summaryLinesCompact: {
    marginTop: spacing.sm
  },
  block: {
    backgroundColor: palette.line
  },
  footerSecondary: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    justifyContent: "space-between"
  }
});
