import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { SessionState } from "../types";
import { registerPushToken, unregisterPushToken } from "./api";

const DEVICE_ID_KEY = "chainshorts:push:device-id:v1";
const TOKEN_KEY = "chainshorts:push:token:v1";

function randomHex(size: number): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return `dev_${Date.now().toString(16)}`;
  }

  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getDeviceId(): Promise<string> {
  const cached = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (cached) {
    return cached;
  }

  const next = `dev_${randomHex(12)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function getExpoProjectId(): string | undefined {
  const fromEasConfig = Constants.easConfig?.projectId;
  if (fromEasConfig) {
    return fromEasConfig;
  }

  const expoConfigExtra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return expoConfigExtra?.eas?.projectId;
}

function isPlaceholderProjectId(projectId: string): boolean {
  const trimmed = projectId.trim();
  if (!trimmed) return true;
  if (trimmed.includes("${")) return true;
  if (trimmed === "00000000-0000-0000-0000-000000000000") return true;
  if (/^replace/i.test(trimmed)) return true;
  return false;
}

export async function syncPushRegistration(session: SessionState): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true
    })
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Chainshorts Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#14F195",
    });
  }

  const permission = await Notifications.getPermissionsAsync();
  const finalStatus = permission.status === "granted" ? permission.status : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== "granted") {
    return;
  }

  const projectId = getExpoProjectId();
  if (!projectId || isPlaceholderProjectId(projectId)) {
    throw new Error("Missing Expo project id. Set EXPO_PUBLIC_EAS_PROJECT_ID before production builds.");
  }
  const pushToken = (
    await Notifications.getExpoPushTokenAsync({ projectId })
  ).data;

  const deviceId = await getDeviceId();
  await registerPushToken({
    deviceId,
    expoPushToken: pushToken,
    platform: Platform.OS === "ios" ? "ios" : "android",
    walletAddress: session.mode === "wallet" ? session.walletAddress : undefined,
    sessionToken: session.mode === "wallet" ? session.sessionToken : undefined,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    appVersion: Constants.expoConfig?.version
  });

  await AsyncStorage.setItem(TOKEN_KEY, pushToken);
}

export async function removePushRegistration(session: SessionState): Promise<void> {
  const [deviceId, token] = await Promise.all([AsyncStorage.getItem(DEVICE_ID_KEY), AsyncStorage.getItem(TOKEN_KEY)]);
  if (!deviceId || !token) {
    return;
  }

  await unregisterPushToken({
    deviceId,
    expoPushToken: token,
    walletAddress: session.mode === "wallet" ? session.walletAddress : undefined,
    sessionToken: session.mode === "wallet" ? session.sessionToken : undefined
  });
}
