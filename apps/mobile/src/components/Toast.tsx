import { useEffect, useRef, useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast, type ToastMessage } from "../context/ToastContext";
import { radii, spacing, textStyles, useTheme } from "../theme";

export function ToastContainer() {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  const { toasts, dismissToast } = useToast();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { top: insets.top + 8 }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </View>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, { toValue: 1, useNativeDriver: true, damping: 20, stiffness: 200 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 })
    ]).start();
  }, [opacity, translateY]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -8, duration: 180, useNativeDriver: true })
    ]).start(onDismiss);
  };

  // Toast colors - always use dark backgrounds with light text for visibility
  const bg =
    toast.type === "success"
      ? "#0D3D2D" // Dark green
      : toast.type === "error"
        ? "#3D1419" // Dark red
        : "#1A1F2E"; // Dark blue-gray

  const borderColor =
    toast.type === "success"
      ? "#14F195"
      : toast.type === "error"
        ? "#FF3344"
        : "#3D4A5C";

  return (
    <Animated.View style={[styles.toast, { backgroundColor: bg, borderColor, opacity, transform: [{ translateY }] }]}>
      <Pressable style={styles.inner} onPress={dismiss} accessibilityRole="alert" accessibilityLabel={toast.message}>
        <Text style={styles.text}>{toast.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const getStyles = (palette: any) => StyleSheet.create({
  container: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 9999,
    gap: spacing.xs,
    pointerEvents: "box-none"
  },
  toast: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8
  },
  inner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2
  },
  text: {
    ...textStyles.caption,
    color: "#FFFFFF",
    lineHeight: 20
  }
});
