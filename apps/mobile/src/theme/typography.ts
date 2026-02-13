export const fonts = {
  display: "BricolageGrotesque_700Bold",
  heading: "BricolageGrotesque_600SemiBold",
  body: "Manrope_500Medium",
  bodyStrong: "Manrope_700Bold",
  mono: "Courier"
} as const;

export const textStyles = {
  hero: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.8
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5
  },
  subtitle: {
    fontFamily: fonts.bodyStrong,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18
  },
  badge: {
    fontFamily: fonts.bodyStrong,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6
  },
  /** Monospace style for wallet addresses, tx hashes, and lamport amounts */
  address: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0
  }
} as const;
