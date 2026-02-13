import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { spacing, textStyles, useTheme } from "../theme";

export function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true
    }).start();
  }, [fade]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fade,
          transform: [
            {
              translateY: fade.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0]
              })
            }
          ]
        }
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </Animated.View>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs
  },
  title: {
    ...textStyles.hero,
    color: palette.coal
  },
  subtitle: {
    ...textStyles.subtitle,
    color: palette.emberDark,
    marginTop: spacing.xs
  }
});
