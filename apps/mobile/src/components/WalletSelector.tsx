/**
 * WalletSelector — Bottom sheet modal for selecting a Solana wallet.
 *
 * Shows supported wallets with installation status.
 * Allows connecting to installed wallets or redirecting to install.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, useTheme } from "../theme";
import {
  getInstalledWallets,
  openWalletStore,
  type SupportedWallet,
} from "../wallet/walletRegistry";

// ── Wallet brand icons ────────────────────────────────────────────────────────
// Phantom — official SVG from phantom.app
const PHANTOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108" fill="none">
<rect width="108" height="108" rx="26" fill="#AB9FF2"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M46.5267 69.9229C42.0054 76.8509 34.4292 85.6182 24.348 85.6182C19.5824 85.6182 15 83.6563 15 75.1342C15 53.4305 44.6326 19.8327 72.1268 19.8327C87.768 19.8327 94 30.6846 94 43.0079C94 58.8258 83.7355 76.9122 73.5321 76.9122C70.2939 76.9122 68.7053 75.1342 68.7053 72.314C68.7053 71.5783 68.8275 70.7812 69.0719 69.9229C65.5893 75.8699 58.8685 81.3878 52.5754 81.3878C47.993 81.3878 45.6713 78.5063 45.6713 74.4598C45.6713 72.9884 45.9768 71.4556 46.5267 69.9229ZM83.6761 42.5794C83.6761 46.1704 81.5575 47.9658 79.1875 47.9658C76.7816 47.9658 74.6989 46.1704 74.6989 42.5794C74.6989 38.9885 76.7816 37.1931 79.1875 37.1931C81.5575 37.1931 83.6761 38.9885 83.6761 42.5794ZM70.2103 42.5795C70.2103 46.1704 68.0916 47.9658 65.7216 47.9658C63.3157 47.9658 61.233 46.1704 61.233 42.5795C61.233 38.9885 63.3157 37.1931 65.7216 37.1931C68.0916 37.1931 70.2103 38.9885 70.2103 42.5795Z" fill="#FFFDF8"/>
</svg>`;

// Solflare — official SVG (inline styles, no CSS classes)
const SOLFLARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
<rect fill="#ffef46" x="0" width="50" height="50" rx="12" ry="12"/>
<path fill="#02050a" stroke="#ffef46" stroke-miterlimit="10" stroke-width="0.5" d="M24.23,26.42l2.46-2.38,4.59,1.5c3.01,1,4.51,2.84,4.51,5.43,0,1.96-.75,3.26-2.25,4.93l-.46.5.17-1.17c.67-4.26-.58-6.09-4.72-7.43l-4.3-1.38h0ZM18.05,11.85l12.52,4.17-2.71,2.59-6.51-2.17c-2.25-.75-3.01-1.96-3.3-4.51v-.08h0ZM17.3,33.06l2.84-2.71,5.34,1.75c2.8.92,3.76,2.13,3.46,5.18l-11.65-4.22h0ZM13.71,20.95c0-.79.42-1.54,1.13-2.17.75,1.09,2.05,2.05,4.09,2.71l4.42,1.46-2.46,2.38-4.34-1.42c-2-.67-2.84-1.67-2.84-2.96M26.82,42.87c9.18-6.09,14.11-10.23,14.11-15.32,0-3.38-2-5.26-6.43-6.72l-3.34-1.13,9.14-8.77-1.84-1.96-2.71,2.38-12.81-4.22c-3.97,1.29-8.97,5.09-8.97,8.89,0,.42.04.83.17,1.29-3.3,1.88-4.63,3.63-4.63,5.8,0,2.05,1.09,4.09,4.55,5.22l2.75.92-9.52,9.14,1.84,1.96,2.96-2.71,14.73,5.22h0Z"/>
</svg>`;

// Backpack — official PNG (base64)
const BACKPACK_PNG_URI = "data:image/png;base64,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";

// Seed Vault — Solana Mobile official vault/shield icon
const SEED_VAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#1A0533"/>
<path d="M50 14 L78 27 L78 53 C78 68 65 78 50 86 C35 78 22 68 22 53 L22 27 Z" fill="#14F195"/>
<rect x="37" y="53" width="26" height="20" rx="4" fill="#1A0533"/>
<path d="M44 53 L44 46 C44 39 56 39 56 46 L56 53" stroke="#1A0533" stroke-width="5" stroke-linecap="round" fill="none"/>
<circle cx="50" cy="62" r="4" fill="#14F195"/>
<rect x="48" y="63" width="4" height="6" rx="2" fill="#14F195"/>
</svg>`;

// ── Icon renderer ─────────────────────────────────────────────────────────────
function WalletIcon({ walletId, size }: { walletId: string; size: number }) {
  switch (walletId) {
    case "phantom":
      return <SvgXml xml={PHANTOM_SVG} width={size} height={size} />;
    case "solflare":
      return <SvgXml xml={SOLFLARE_SVG} width={size} height={size} />;
    case "backpack":
      return (
        <Image
          source={{ uri: BACKPACK_PNG_URI }}
          style={{ width: size, height: size, borderRadius: size * 0.22 }}
          resizeMode="contain"
        />
      );
    case "seedvault":
      return <SvgXml xml={SEED_VAULT_SVG} width={size} height={size} />;
    default:
      return <Ionicons name="wallet-outline" size={size * 0.55} color="#14F195" />;
  }
}

interface WalletSelectorProps {
  visible: boolean;
  onSelectWallet: (walletId: string) => void;
  onCancel: () => void;
  isConnecting: boolean;
  connectingWalletId?: string | null;
}

interface WalletCardProps {
  wallet: SupportedWallet;
  index: number;
  visible: boolean;
  isConnecting: boolean;
  isSelected: boolean;
  onPress: () => void;
  onInstall: () => void;
}

// Get wallet brand accent color
function getWalletColor(walletId: string): string {
  switch (walletId) {
    case "seedvault": return "#14F195";
    case "phantom":   return "#AB9FF2";
    case "solflare":  return "#FC8E03";
    case "backpack":  return "#E33E3F";
    default:          return "#14F195";
  }
}

function WalletCard({
  wallet,
  index,
  visible,
  isConnecting,
  isSelected,
  onPress,
  onInstall,
}: WalletCardProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => getCardStyles(palette), [palette]);

  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 15,
          stiffness: 300,
          delay: index * 80,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          delay: index * 80,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(0.8);
      opacityAnim.setValue(0);
    }
  }, [visible, index, scaleAnim, opacityAnim]);

  return (
    <Animated.View
      style={{
        transform: [{ scale: scaleAnim }],
        opacity: opacityAnim,
      }}
    >
      <Pressable
        onPress={wallet.installed ? onPress : onInstall}
        disabled={isConnecting && !isSelected}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.cardPressed,
          isSelected && styles.cardSelected,
          !wallet.installed && styles.cardNotInstalled,
        ]}
      >
        <View style={styles.iconContainer}>
          <WalletIcon walletId={wallet.id} size={56} />
          {wallet.installed && (
            <View style={styles.installedBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
            </View>
          )}
        </View>

        <Text style={styles.name}>{wallet.name}</Text>
        <Text style={styles.description} numberOfLines={1}>
          {wallet.installed ? "Tap to connect" : "Tap to install"}
        </Text>

        {isConnecting && isSelected && (
          <View style={styles.connectingOverlay}>
            <ActivityIndicator size="small" color="#FFFFFF" />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function WalletSelector({
  visible,
  onSelectWallet,
  onCancel,
  isConnecting,
  connectingWalletId,
}: WalletSelectorProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => getStyles(palette), [palette]);

  const [wallets, setWallets] = useState<SupportedWallet[]>([]);
  const [loading, setLoading] = useState(true);

  const slideAnim = useRef(new Animated.Value(400)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      loadWallets();
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 25,
          stiffness: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 400,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  const loadWallets = async () => {
    setLoading(true);
    try {
      const installed = await getInstalledWallets();
      setWallets(installed);
    } catch {
      setWallets([]);
    } finally {
      setLoading(false);
    }
  };

  const handleWalletPress = useCallback(
    (walletId: string) => {
      onSelectWallet(walletId);
    },
    [onSelectWallet]
  );

  const handleInstallWallet = useCallback((walletId: string, walletName: string) => {
    Alert.alert(
      `Install ${walletName}`,
      `${walletName} is not installed. Would you like to install it from the Play Store?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Install",
          onPress: () =>
            openWalletStore(walletId).catch(() => {
              Alert.alert("Error", "Could not open Play Store.");
            }),
        },
      ]
    );
  }, []);

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={isConnecting ? undefined : onCancel}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.container,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.handleBar} />

          <View style={styles.header}>
            <Text style={styles.title}>Connect Wallet</Text>
            <Text style={styles.subtitle}>Select your Solana wallet</Text>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={palette.ember} />
            </View>
          ) : (
            <View style={styles.walletGrid}>
              {wallets.map((wallet, index) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  index={index}
                  visible={visible}
                  isConnecting={isConnecting}
                  isSelected={connectingWalletId === wallet.id}
                  onPress={() => handleWalletPress(wallet.id)}
                  onInstall={() => handleInstallWallet(wallet.id, wallet.name)}
                />
              ))}
            </View>
          )}

          <View style={styles.infoSection}>
            <Ionicons
              name="shield-checkmark-outline"
              size={16}
              color="#22C55E"
            />
            <Text style={styles.infoText}>
              Secure connection via Mobile Wallet Adapter
            </Text>
          </View>

          <Pressable
            onPress={onCancel}
            style={styles.cancelButton}
            disabled={isConnecting}
          >
            <Text style={[styles.cancelText, isConnecting && styles.cancelTextDisabled]}>
              Cancel
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const getStyles = (palette: ReturnType<typeof useTheme>["palette"]) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
    },
    container: {
      backgroundColor: palette.milk,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
      paddingTop: spacing.md,
    },
    handleBar: {
      width: 40,
      height: 4,
      backgroundColor: palette.line,
      borderRadius: radii.pill,
      alignSelf: "center",
      marginBottom: spacing.lg,
    },
    header: {
      alignItems: "center",
      marginBottom: spacing.xl,
    },
    title: {
      fontFamily: "BricolageGrotesque_700Bold",
      fontSize: 20,
      color: palette.coal,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontFamily: "Manrope_500Medium",
      fontSize: 14,
      color: palette.muted,
    },
    loadingContainer: {
      paddingVertical: spacing.xxl,
      alignItems: "center",
    },
    walletGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing.md,
      marginBottom: spacing.xl,
    },
    infoSection: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    infoText: {
      fontFamily: "Manrope_500Medium",
      fontSize: 12,
      color: palette.muted,
    },
    cancelButton: {
      alignItems: "center",
      paddingVertical: spacing.md,
    },
    cancelText: {
      fontFamily: "Manrope_600SemiBold",
      fontSize: 14,
      color: palette.muted,
    },
    cancelTextDisabled: {
      opacity: 0.5,
    },
  });

const getCardStyles = (palette: ReturnType<typeof useTheme>["palette"]) =>
  StyleSheet.create({
    card: {
      width: 140,
      backgroundColor: palette.parchment,
      borderRadius: radii.md,
      alignItems: "center",
      padding: spacing.md,
      borderWidth: 1,
      borderColor: palette.line,
    },
    cardPressed: {
      backgroundColor: palette.line,
      transform: [{ scale: 0.98 }],
    },
    cardSelected: {
      borderColor: palette.ember,
      borderWidth: 2,
    },
    cardNotInstalled: {
      opacity: 0.7,
    },
    iconContainer: {
      position: "relative",
      width: 56,
      height: 56,
      borderRadius: 16,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    installedBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      backgroundColor: palette.milk,
      borderRadius: radii.pill,
      padding: 2,
    },
    name: {
      fontFamily: "Manrope_700Bold",
      fontSize: 14,
      color: palette.coal,
      marginBottom: 2,
    },
    description: {
      fontFamily: "Manrope_500Medium",
      fontSize: 11,
      color: palette.muted,
    },
    connectingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
    },
  });
