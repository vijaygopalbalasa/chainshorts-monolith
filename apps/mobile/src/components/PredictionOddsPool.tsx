import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";

const YES_COLOR = "#14F195";
const NO_COLOR = "#FF3344";

function clampPercent(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}

export function normalizeYesNoPercents(input: { yesPct?: number; noPct?: number }): { yesPct: number; noPct: number } {
  const yesCandidate = Number(input.yesPct);
  const noCandidate = Number(input.noPct);

  const yesValid = Number.isFinite(yesCandidate) && yesCandidate > 0;
  const noValid = Number.isFinite(noCandidate) && noCandidate > 0;

  if (yesValid) {
    const yes = clampPercent(yesCandidate);
    return { yesPct: yes, noPct: 100 - yes };
  }
  if (noValid) {
    const no = clampPercent(noCandidate);
    return { yesPct: 100 - no, noPct: no };
  }
  return { yesPct: 50, noPct: 50 };
}

interface PredictionOddsPoolProps {
  yesPct?: number;
  noPct?: number;
  totalPoolSkr: number;
  totalStakers?: number;
}

export function PredictionOddsPool({ yesPct, noPct, totalPoolSkr, totalStakers }: PredictionOddsPoolProps) {
  const { palette } = useTheme();
  const styles = getStyles(palette);
  const normalized = normalizeYesNoPercents({ yesPct, noPct });

  return (
    <View style={styles.container}>
      <View style={styles.oddsBar}>
        <View style={[styles.yesBar, { flex: normalized.yesPct }]} />
        <View style={[styles.noBar, { flex: normalized.noPct }]} />
      </View>
      <View style={styles.oddsLabels}>
        <Text style={[styles.oddsLabel, { color: YES_COLOR }]}>YES {normalized.yesPct}%</Text>
        <Text style={[styles.oddsLabel, { color: NO_COLOR }]}>NO {normalized.noPct}%</Text>
      </View>
      <View style={styles.poolRow}>
        <Text style={styles.poolText}>{totalPoolSkr.toLocaleString()} SKR in pool</Text>
        {typeof totalStakers === "number" && totalStakers >= 0 ? (
          <Text style={styles.poolText}>
            {"\u2022"} {totalStakers} staker{totalStakers === 1 ? "" : "s"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const getStyles = (palette: any) =>
  StyleSheet.create({
    container: {
      marginBottom: 12,
    },
    oddsBar: {
      flexDirection: "row",
      height: 8,
      borderRadius: 4,
      overflow: "hidden",
      marginBottom: 6,
      backgroundColor: palette.line,
    },
    yesBar: {
      backgroundColor: YES_COLOR,
    },
    noBar: {
      backgroundColor: NO_COLOR,
    },
    oddsLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    oddsLabel: {
      fontFamily: "Manrope_700Bold",
      fontSize: 12,
    },
    poolRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    poolText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
  });
