import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "chainshorts:onboarding:v1";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(KEY, "1");
}
