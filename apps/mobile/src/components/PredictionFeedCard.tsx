import React, { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, spacing } from "../theme";
import type { FeedCard } from "@chainshorts/shared";
import { PredictionOddsPool, normalizeYesNoPercents } from "./PredictionOddsPool";

const YES_COLOR = "#14F195";
const NO_COLOR = "#FF3344";
const PURPLE = "#9945FF";

interface Props {
  card: FeedCard;
  onStake?: (pollId: string, side: "yes" | "no") => void;
  onPress?: (pollId: string) => void;
}

function formatTimeRemaining(deadlineAt: string | undefined | null): string {
  if (!deadlineAt) return "Open";

  const now = Date.now();
  const deadline = new Date(deadlineAt).getTime();

  // Guard against invalid dates
  if (Number.isNaN(deadline)) return "Open";

  const diff = deadline - now;

  if (diff <= 0) return "Ended";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "< 1m";
}

export function PredictionFeedCard({ card, onStake, onPress }: Props) {
  const { palette } = useTheme();
  const pred = card.prediction;
  const [timeLeft, setTimeLeft] = useState(pred ? formatTimeRemaining(pred.deadlineAt) : "");

  // Update countdown every minute
  useEffect(() => {
    if (!pred) return;
    const interval = setInterval(() => {
      setTimeLeft(formatTimeRemaining(pred.deadlineAt));
    }, 60000);
    return () => clearInterval(interval);
  }, [pred]);

  if (!pred) return null;

  const odds = normalizeYesNoPercents({
    yesPct: pred.yesOdds,
    noPct: pred.noOdds
  });

  return (
    <View style={[styles.container, { backgroundColor: palette.milk, borderColor: palette.line }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.marketBadge}>
          <Ionicons name="trending-up" size={12} color="#FFF" />
          <Text style={styles.marketBadgeText}>PREDICTION</Text>
        </View>
        <View style={[styles.timeBadge, { backgroundColor: palette.line }]}>
          <Ionicons name="time-outline" size={12} color={palette.muted} />
          <Text style={[styles.timeText, { color: palette.muted }]}>{timeLeft}</Text>
        </View>
      </View>

      {/* Question - tap to view in Predict tab */}
      <Pressable onPress={() => onPress?.(pred.pollId)}>
        <Text style={[styles.question, { color: palette.coal }]}>
          {pred.question}
        </Text>
      </Pressable>

      <PredictionOddsPool
        yesPct={odds.yesPct}
        noPct={odds.noPct}
        totalPoolSkr={pred.totalPoolSkr}
      />

      {/* Stake Buttons */}
      <View style={styles.buttonsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.stakeButton,
            styles.yesButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => onStake?.(pred.pollId, "yes")}
        >
          <Text style={styles.buttonText}>STAKE YES</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.stakeButton,
            styles.noButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => onStake?.(pred.pollId, "no")}
        >
          <Text style={styles.buttonText}>STAKE NO</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  marketBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PURPLE,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  marketBadgeText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 10,
    color: "#FFF",
    letterSpacing: 0.5,
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  timeText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
  },
  question: {
    fontFamily: "BricolageGrotesque_600SemiBold",
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 16,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  stakeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  yesButton: {
    backgroundColor: YES_COLOR,
  },
  noButton: {
    backgroundColor: NO_COLOR,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    color: "#000",
    letterSpacing: 0.5,
  },
});
