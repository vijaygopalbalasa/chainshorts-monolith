import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkPalette, lightPalette, type Palette } from "./palette";

const THEME_MODE_STORAGE_KEY = "chainshorts_theme_mode_v1";

const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

interface ThemeContextValue {
  palette: Palette;
  isDark: boolean;
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  hydrated: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  palette: lightPalette,
  isDark: false,
  mode: "system",
  resolvedMode: "light",
  hydrated: false,
  setMode: () => {}
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    void AsyncStorage.getItem(THEME_MODE_STORAGE_KEY)
      .then((stored) => {
        if (!active || !stored) {
          return;
        }
        if (THEME_MODES.includes(stored as ThemeMode)) {
          setModeState(stored as ThemeMode);
        }
      })
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    void AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode).catch(() => {
      // Best effort persistence; UI should still switch instantly.
    });
  }, []);

  const systemDark = scheme === "dark";
  const isDark = mode === "dark" || (mode === "system" && systemDark);
  const resolvedMode: "light" | "dark" = isDark ? "dark" : "light";
  const value: ThemeContextValue = {
    palette: isDark ? darkPalette : lightPalette,
    isDark,
    mode,
    resolvedMode,
    hydrated,
    setMode
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
