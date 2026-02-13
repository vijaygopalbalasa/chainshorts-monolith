import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useTheme, radii, spacing } from "../theme";
import { useSession } from "../state/sessionStore";
import { useToast } from "../context/ToastContext";
import { getWalletAdapter } from "../wallet/createWalletAdapter";
import { buildSolTransferTransaction } from "../services/solTransfer";
import { prepareSkrTransferInstructions, buildTransactionWithFreshBlockhash, DEFAULT_SKR_MINT } from "../services/splTransfer";
import { friendlyError } from "../services/api";

interface SupportCardProps {
  platformWallet: string;
  userSolBalance: number;
  userSkrBalance: number;
  onSuccess?: () => void;
}

type SupportMode = "sol" | "skr";

export function SupportCard({
  platformWallet,
  userSolBalance,
  userSkrBalance,
  onSuccess,
}: SupportCardProps) {
  const { palette, isDark } = useTheme();
  const { session } = useSession();
  const { showToast } = useToast();

  const [mode, setMode] = useState<SupportMode>("sol");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const maxBalance = mode === "sol" ? userSolBalance : userSkrBalance;
  const isValid = numericAmount > 0 && numericAmount <= maxBalance;

  const handleAmountChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > (mode === "sol" ? 9 : 2)) return;
    setAmount(cleaned);
  };

  const handleSend = useCallback(async () => {
    if (!isValid || !session.walletAddress || !platformWallet) return;

    Keyboard.dismiss();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSending(true);

    try {
      const adapter = getWalletAdapter();

      if (mode === "sol") {
        const tx = await buildSolTransferTransaction({
          fromWallet: session.walletAddress,
          toWallet: platformWallet,
          amountSol: numericAmount,
        });
        await adapter.sendTransaction(tx);
      } else {
        const { instructions, payer } = await prepareSkrTransferInstructions({
          fromWallet: session.walletAddress,
          toWallet: platformWallet,
          amountUi: numericAmount,
          skrMint: DEFAULT_SKR_MINT,
        });
        if (adapter.buildAndSendTransaction) {
          await adapter.buildAndSendTransaction(instructions, payer);
        } else {
          const tx = await buildTransactionWithFreshBlockhash(instructions, payer);
          if (adapter.sendVersionedTransaction) {
            await adapter.sendVersionedTransaction(tx as any);
          } else {
            await adapter.sendTransaction(tx as any);
          }
        }
      }

      showToast("Thanks for supporting Chainshorts!", "success");
      setAmount("");
      onSuccess?.();
    } catch (error) {
      showToast(friendlyError(error, "Transfer failed — please try again"), "error");
    } finally {
      setSending(false);
    }
  }, [isValid, session.walletAddress, platformWallet, mode, numericAmount, showToast, onSuccess]);

  const accentColor = mode === "sol" ? "#14F195" : "#9945FF";
  // High contrast text colors
  const textPrimary = isDark ? "#FFFFFF" : "#111111";
  const textSecondary = isDark ? "#B0B0B0" : "#555555";
  const textTertiary = isDark ? "#888888" : "#777777";

  return (
    <View style={[styles.card, { backgroundColor: isDark ? "#111111" : "#FFFFFF", borderColor: isDark ? "#333333" : "#E0E0E0" }]}>
      {/* Top accent bar */}
      <LinearGradient
        colors={["#FF6B35", "#F7931A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.accentBar}
      />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: textPrimary }]}>Support the Project</Text>
        <View style={styles.tagRow}>
          <View style={[styles.tag, { backgroundColor: isDark ? "#2A2A2A" : "#F0F0F0" }]}>
            <Text style={[styles.tagText, { color: textSecondary }]}>Indie Dev</Text>
          </View>
          <View style={[styles.tag, { backgroundColor: isDark ? "#2A2A2A" : "#F0F0F0" }]}>
            <Text style={[styles.tagText, { color: textSecondary }]}>No VC</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.description, { color: textSecondary }]}>
        Help keep the servers running. Every contribution goes directly to infrastructure costs.
      </Text>

      {/* Token toggle */}
      <View style={[styles.toggleContainer, { backgroundColor: isDark ? "#1A1A1A" : "#F5F5F5" }]}>
        <Pressable
          style={[
            styles.toggleBtn,
            mode === "sol" && { backgroundColor: isDark ? "#222222" : "#FFFFFF" },
          ]}
          onPress={() => { setMode("sol"); setAmount(""); }}
        >
          <View style={[styles.tokenIndicator, { backgroundColor: "#14F195" }]} />
          <Text style={[styles.toggleText, { color: mode === "sol" ? textPrimary : textTertiary }]}>SOL</Text>
        </Pressable>
        <Pressable
          style={[
            styles.toggleBtn,
            mode === "skr" && { backgroundColor: isDark ? "#222222" : "#FFFFFF" },
          ]}
          onPress={() => { setMode("skr"); setAmount(""); }}
        >
          <View style={[styles.tokenIndicator, { backgroundColor: "#9945FF" }]} />
          <Text style={[styles.toggleText, { color: mode === "skr" ? textPrimary : textTertiary }]}>SKR</Text>
        </Pressable>
      </View>

      {/* Quick select */}
      <View style={styles.quickRow}>
        {(mode === "sol" ? ["0.1", "0.5", "1"] : ["10", "50", "100"]).map((val) => (
          <Pressable
            key={val}
            style={({ pressed }) => [
              styles.quickChip,
              { borderColor: amount === val ? accentColor : (isDark ? "#444444" : "#CCCCCC") },
              amount === val && { backgroundColor: accentColor + "20" },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => setAmount(val)}
          >
            <Text style={[styles.quickChipText, { color: amount === val ? accentColor : textSecondary }]}>
              {val}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Input */}
      <View style={[styles.inputContainer, { borderColor: isDark ? "#444444" : "#CCCCCC", backgroundColor: isDark ? "#1A1A1A" : "#FAFAFA" }]}>
        <TextInput
          style={[styles.input, { color: textPrimary }]}
          placeholder="Other amount"
          placeholderTextColor={textTertiary}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={handleAmountChange}
          maxLength={12}
        />
        <Text style={[styles.inputSuffix, { color: accentColor }]}>{mode.toUpperCase()}</Text>
      </View>

      <Text style={[styles.balance, { color: textTertiary }]}>
        Available: {maxBalance.toLocaleString(undefined, { maximumFractionDigits: mode === "sol" ? 4 : 0 })} {mode.toUpperCase()}
      </Text>

      {/* CTA */}
      <Pressable
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: accentColor },
          (!isValid || sending) && { opacity: 0.4 },
          pressed && isValid && { opacity: 0.85 },
        ]}
        onPress={handleSend}
        disabled={!isValid || sending}
      >
        {sending ? (
          <ActivityIndicator size="small" color={mode === "sol" ? "#000000" : "#FFFFFF"} />
        ) : (
          <>
            <Text style={[styles.ctaText, { color: mode === "sol" ? "#000000" : "#FFFFFF" }]}>
              Send {mode.toUpperCase()}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={mode === "sol" ? "#000000" : "#FFFFFF"} />
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  accentBar: {
    height: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: {
    fontFamily: "Manrope_700Bold",
    fontSize: 16,
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  description: {
    fontFamily: "Manrope_500Medium",
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  toggleContainer: {
    flexDirection: "row",
    marginHorizontal: spacing.md,
    borderRadius: 8,
    padding: 4,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 6,
  },
  tokenIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toggleText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
  },
  quickRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
  },
  quickChipText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 15,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 14,
  },
  input: {
    flex: 1,
    fontFamily: "Manrope_600SemiBold",
    fontSize: 18,
    padding: 0,
  },
  inputSuffix: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
  },
  balance: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: 16,
    borderRadius: 8,
  },
  ctaText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 15,
  },
});
