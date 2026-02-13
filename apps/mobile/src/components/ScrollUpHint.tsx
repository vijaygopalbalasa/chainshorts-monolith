import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

const KEY = "cs_scroll_onboarding";

export function ScrollUpHint({ onDismiss }: { onDismiss?: () => void }) {
  const [show, setShow] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (v !== "1") setShow(true); });
  }, []);

  useEffect(() => {
    if (!show) return;
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -6, duration: 350, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 350, useNativeDriver: true }),
      ])
    );
    anim.start();
    const t = setTimeout(close, 6000);
    return () => { anim.stop(); clearTimeout(t); };
  }, [show]);

  const close = () => {
    AsyncStorage.setItem(KEY, "1");
    Animated.timing(fade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setShow(false);
      onDismiss?.();
    });
  };

  if (!show) return null;

  return (
    <Animated.View style={[styles.container, { opacity: fade }]}>
      <Pressable style={styles.card} onPress={close}>
        <Animated.View style={{ transform: [{ translateY: bounce }] }}>
          <Ionicons name="arrow-up-circle" size={28} color="#14F195" />
        </Animated.View>
        <View>
          <Text style={styles.title}>Swipe up</Text>
          <Text style={styles.sub}>for more stories</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 110,
    alignSelf: "center",
    zIndex: 999,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#111",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Manrope_700Bold",
  },
  sub: {
    color: "#888",
    fontSize: 13,
    fontFamily: "Manrope_400Regular",
  },
});

export default ScrollUpHint;
