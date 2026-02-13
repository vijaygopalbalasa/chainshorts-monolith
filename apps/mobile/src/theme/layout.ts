export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999
} as const;

/** Shadow anchored to pure black for dark-theme depth */
export const shadowColor = "#000000";

export const elevation = {
  card: {
    shadowColor,
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  floating: {
    shadowColor,
    shadowOpacity: 0.75,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10
  },
  overlay: {
    shadowColor,
    shadowOpacity: 0.88,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 20 },
    elevation: 14
  }
};
