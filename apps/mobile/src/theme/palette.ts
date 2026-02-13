export const lightPalette = {
  /** Primary text — dark */
  coal: "#0A1018",
  /** Secondary text */
  obsidian: "#131C28",
  /** Body/tertiary text */
  ink: "#4D6880",
  /** Primary background — light */
  parchment: "#F5F8FA",
  /** Card/elevated surface — pure white */
  milk: "#FFFFFF",
  /** PRIMARY ACCENT — Solana signature green ⚡ */
  ember: "#14F195",
  /** Accent dark variant */
  emberDark: "#0ECC7E",
  /** Secondary accent — info/cyan */
  cyan: "#00CFFF",
  /** Success / live indicator */
  lime: "#14F195",
  /** Solana purple */
  violet: "#9945FF",
  /** Alert / special events */
  rose: "#FF4B8A",
  /** Subdued/muted text */
  muted: "#7A96A8",
  /** Borders/dividers */
  line: "#E1E8ED",
  /** Success states */
  success: "#14F195",
  /** Error/danger states */
  danger: "#FF3344",
  /** Pure white for elevated/neutral surfaces and inverse text */
  white: "#FFFFFF"
} as const;

export const darkPalette = {
  coal: "#DDE9EF",
  obsidian: "#AABFCC",
  ink: "#7A96A8",
  parchment: "#040608",
  milk: "#0A1018",
  ember: "#14F195",
  emberDark: "#0ECC7E",
  cyan: "#00CFFF",
  lime: "#14F195",
  violet: "#9945FF",
  rose: "#FF4B8A",
  muted: "#4D6880",
  line: "#131C28",
  success: "#14F195",
  danger: "#FF3344",
  white: "#FFFFFF"
} as const;

/** Palette uses string values so light/dark palettes are both assignable */
export type Palette = { [K in keyof typeof lightPalette]: string };

/** Default export is the light palette for static StyleSheet usage */
export const palette = lightPalette;
