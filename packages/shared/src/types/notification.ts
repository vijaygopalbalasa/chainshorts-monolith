export interface PushSubscriptionInput {
  deviceId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  locale?: string;
  appVersion?: string;
}
