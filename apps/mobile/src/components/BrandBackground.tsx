import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";

/**
 * Terminal-style background with theme awareness.
 * Dark mode: deep dark gradient with corner glows.
 * Light mode: solid parchment with subtle accents.
 */
export function BrandBackground() {
  const { palette, isDark } = useTheme();

  const gradientColors: [string, string, string] = isDark
    ? ["#0A1220", "#070B0F", "#0A0F1A"]
    : [palette.parchment, palette.parchment, palette.parchment];

  const glowOpacity = isDark ? 0.05 : 0.02;
  const purpleGlowOpacity = isDark ? 0.04 : 0.015;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Primary atmosphere gradient */}
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top-left Solana green corner glow */}
      <View
        style={[
          styles.glowTopLeft,
          { backgroundColor: `rgba(20, 241, 149, ${glowOpacity})` }
        ]}
      />

      {/* Bottom-right purple glow */}
      <View
        style={[
          styles.glowBottomRight,
          { backgroundColor: `rgba(153, 69, 255, ${purpleGlowOpacity})` }
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glowTopLeft: {
    position: "absolute",
    top: -60,
    left: -60,
    width: 200,
    height: 200,
    borderRadius: 999
  },
  glowBottomRight: {
    position: "absolute",
    bottom: -80,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 999
  }
});
