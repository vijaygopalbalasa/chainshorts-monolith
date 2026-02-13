import { useEffect, useRef, useMemo } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radii, spacing, textStyles, useTheme } from "../theme";

interface CategoryChipsProps {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
  labels?: Record<string, string>;
}

function Chip({
  category,
  label,
  active,
  onPress
}: {
  category: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);
  const bg = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(bg, {
      toValue: active ? 1 : 0,
      duration: 160,
      useNativeDriver: false
    }).start();
  }, [active, bg]);

  // Active: Solana green background. Inactive: transparent dark surface.
  const backgroundColor = bg.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.milk, palette.ember]
  });

  const borderColor = bg.interpolate({
    inputRange: [0, 1],
    outputRange: [palette.line, palette.ember]
  });

  const labelColor = active ? "#040608" : palette.coal;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label} category`}
    >
      <Animated.View style={[styles.chip, { backgroundColor, borderColor }]}>
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function CategoryChips({ categories, selected, onSelect, labels }: CategoryChipsProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Filter by category">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {categories.map((category) => (
          <Chip
            key={category}
            category={category}
            label={labels?.[category] ?? category}
            active={selected === category}
            onPress={() => onSelect(category)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    marginBottom: spacing.md
  },
  row: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm
  },
  chip: {
    height: 34,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0
  },
  label: {
    ...textStyles.badge
  }
});
