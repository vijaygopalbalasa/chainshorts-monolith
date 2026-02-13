import { Buffer } from "@craftzdog/react-native-buffer";
import {
  SolanaMobileWalletAdapterError,
  SolanaMobileWalletAdapterErrorCode,
  SolanaMobileWalletAdapterProtocolError,
  SolanaMobileWalletAdapterProtocolErrorCode,
  type AuthorizationResult
} from "@solana-mobile/mobile-wallet-adapter-protocol";
import { transact, type Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { TransactionInstruction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { clearStoredMwaAuthorization, loadStoredMwaAuthorization, saveStoredMwaAuthorization } from "./mwaAuthStorage";
import type { ConnectAndSignResult, WalletAdapter, WalletCapabilities } from "./WalletAdapter";
import { checkWalletInstalled, getWalletName } from "./walletRegistry";
import { withTimeout, WalletTimeoutError } from "./timeout";

// MWA spec requires identity.icon to be a RELATIVE URI (relative to identity.uri).
// Seed Vault (and other wallets) explicitly reject absolute https:// icon URLs
// with error -32602 "When specified, identity.icon must be a relative URI".
const APP_IDENTITY = {
  name: "Chainshorts",
  uri: "https://chainshorts.live",
  icon: "favicon.png",
} as const;

type MwaChain = NonNullable<Parameters<Web3MobileWallet["authorize"]>[0]["chain"]>;

const DEFAULT_CHAIN: MwaChain = "solana:mainnet";

function getConfiguredChain(): MwaChain {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.EXPO_PUBLIC_SOLANA_CHAIN;
  return value?.trim() ? (value.trim() as MwaChain) : DEFAULT_CHAIN;
}

function base64AddressToBase58(base64Address: string): string {
  const bytes = Buffer.from(base64Address, "base64");
  return bs58.encode(new Uint8Array(bytes));
}

function canSendTxFromCapabilities(
  capabilities: Awaited<ReturnType<Web3MobileWallet["getCapabilities"]>> | null
): boolean {
  if (!capabilities) return true;
  if ((capabilities.supported_transaction_versions?.length ?? 0) > 0) {
    return true;
  }
  return capabilities.supports_sign_and_send_transactions === true;
}

function extractDetachedSignature(payload: Uint8Array, originalMessage: Uint8Array): Uint8Array {
  if (payload.length === 64) {
    return payload;
  }

  const expectedSignedPayloadLength = originalMessage.length + 64;
  if (payload.length !== expectedSignedPayloadLength) {
    throw new Error("Wallet returned an unexpected signed payload format");
  }

  for (let index = 0; index < originalMessage.length; index += 1) {
    if (payload[64 + index] !== originalMessage[index]) {
      throw new Error("Wallet returned an invalid signed payload");
    }
  }

  return payload.slice(0, 64);
}

export interface AndroidMwaAdapterOptions {
  walletId?: string;
}

export class AndroidMwaAdapter implements WalletAdapter {
  private address: string | null = null;
  private base64Address: string | null = null;
  private authToken: string | null = null;
  private authorizedWalletId: string | null = null;
  private hydrated = false;
  private lastCapabilities: Awaited<ReturnType<Web3MobileWallet["getCapabilities"]>> | null = null;
  private targetWalletId: string | null = null;

  constructor(options?: AndroidMwaAdapterOptions) {
    const normalizedWalletId = options?.walletId?.trim().toLowerCase();
    this.targetWalletId = normalizedWalletId ? normalizedWalletId : null;
  }

  private shouldUseCachedAuthorization(cachedWalletId?: string): boolean {
    if (!this.targetWalletId) {
      return true;
    }
    if (!cachedWalletId) {
      // Legacy cache entries (without walletId) are only trusted for Seed Vault.
      return this.targetWalletId === "seedvault";
    }
    return cachedWalletId === this.targetWalletId;
  }

  private async hydrateCache(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    const cached = await loadStoredMwaAuthorization();
    if (!cached) return;
    if (!this.shouldUseCachedAuthorization(cached.walletId)) {
      return;
    }

    this.authToken = cached.authToken;
    this.base64Address = cached.base64Address;
    this.address = base64AddressToBase58(cached.base64Address);
    this.authorizedWalletId = cached.walletId ?? this.targetWalletId;
    // NOTE: walletUriBase is intentionally NOT loaded — cached ephemeral ports
    // are always stale after app restart and cause the first transact() to fail.
    // We always use solana-wallet:// scheme discovery (no baseUri).
  }

  private applyAuthorization(result: AuthorizationResult): void {
    const account = result.accounts[0];
    if (!account) {
      throw new Error("No account returned by wallet");
    }

    this.authToken = result.auth_token;
    this.base64Address = account.address;
    this.address = base64AddressToBase58(account.address);
    if (this.targetWalletId) {
      this.authorizedWalletId = this.targetWalletId;
    }
    // NOTE: wallet_uri_base (ephemeral App Link port) is intentionally ignored.
  }

  private async persistAuthorization(): Promise<void> {
    if (!this.authToken || !this.base64Address) {
      return;
    }

    await saveStoredMwaAuthorization({
      authToken: this.authToken,
      base64Address: this.base64Address,
      walletId: this.authorizedWalletId ?? this.targetWalletId ?? undefined
    });
  }

  private async clearAuthorizationState(): Promise<void> {
    this.address = null;
    this.base64Address = null;
    this.authToken = null;
    this.authorizedWalletId = null;
    this.lastCapabilities = null;
    await clearStoredMwaAuthorization();
  }

  private async authorize(wallet: Web3MobileWallet): Promise<AuthorizationResult> {
    const request = {
      chain: getConfiguredChain(),
      identity: APP_IDENTITY,
      auth_token: this.authToken ?? undefined
    } as const;

    try {
      return await wallet.authorize(request);
    } catch (error) {
      const staleAuth =
        error instanceof SolanaMobileWalletAdapterProtocolError &&
        error.code === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED &&
        this.authToken != null;

      if (!staleAuth) {
        throw error;
      }

      // Stale auth token — clear and retry without it
      this.authToken = null;
      this.base64Address = null;
      this.address = null;
      this.authorizedWalletId = null;
      await clearStoredMwaAuthorization();

      return wallet.authorize({
        chain: getConfiguredChain(),
        identity: APP_IDENTITY
      });
    }
  }

  private async ensureWalletInstalled(): Promise<void> {
    if (!this.targetWalletId || this.targetWalletId === "seedvault") {
      return;
    }

    const installed = await checkWalletInstalled(this.targetWalletId);
    if (!installed) {
      const walletName = getWalletName(this.targetWalletId);
      throw new Error(`${walletName} is not installed. Please install it from the Play Store.`);
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof WalletTimeoutError) {
      return new Error("Wallet connection timed out. Please try again.");
    }

    if (error instanceof SolanaMobileWalletAdapterError) {
      if (error.code === SolanaMobileWalletAdapterErrorCode.ERROR_WALLET_NOT_FOUND) {
        return new Error("No Solana wallet found. Install Phantom, Solflare, or Backpack from the Play Store.");
      }
      if (
        error.code === SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_CLOSED ||
        error.code === SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_TIMEOUT
      ) {
        return new Error("Wallet session ended. Please try again.");
      }
    }

    if (error instanceof SolanaMobileWalletAdapterProtocolError) {
      if (error.code === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED) {
        return new Error("Connection cancelled by user.");
      }
      if (error.code === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_TOO_MANY_PAYLOADS) {
        return new Error("Too many requests. Please try again.");
      }
      if (error.code === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED) {
        return new Error("Authorization failed. Please try again.");
      }
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("canceled") || msg.includes("cancelled") || msg.includes("rejected")) {
        return new Error("Connection cancelled by user.");
      }
      if (msg.includes("timeout")) {
        return new Error("Wallet connection timed out. Please try again.");
      }
      return error;
    }

    return new Error(`Wallet error: ${String(error)}`);
  }

  async connectAndSignChallenge(
    fetchChallenge: (address: string) => Promise<string>
  ): Promise<ConnectAndSignResult> {
    await this.hydrateCache();
    await this.ensureWalletInstalled();

    try {
      // IMPORTANT: No baseUri passed to transact() — always use solana-wallet:// scheme
      // discovery. Cached walletUriBase values are ephemeral ports that become stale
      // after the wallet app restarts, causing the first connection to always fail.
      // No withTimeout wrapper — MWA has its own internal 30s ERROR_SESSION_TIMEOUT.
      const result = await transact(async (wallet) => {
        // Step 1: authorize — gets the wallet address
        const authorization = await this.authorize(wallet);
        this.applyAuthorization(authorization);
        const account = authorization.accounts[0];
        if (!account) {
          throw new Error("Wallet authorization did not return an account");
        }
        const authorizedAddress = base64AddressToBase58(account.address);

        const capabilities = await wallet.getCapabilities();
        this.lastCapabilities = capabilities;

        // Step 2: fetch SIWS challenge INSIDE the live session — keeps session alive
        const challengeMessage = await fetchChallenge(authorizedAddress);
        const messageBytes = new TextEncoder().encode(challengeMessage);

        // Step 3: sign — still in same session, no second wallet popup
        const signedPayloads = await wallet.signMessages({
          addresses: [account.address],
          payloads: [messageBytes]
        });

        const signature = signedPayloads[0];
        if (!signature) {
          throw new Error("Missing message signature");
        }

        return {
          address: authorizedAddress,
          message: challengeMessage,
          signature: extractDetachedSignature(signature, messageBytes)
        };
      });

      await this.persistAuthorization();

      return result;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async connect(): Promise<string> {
    await this.hydrateCache();
    await this.ensureWalletInstalled();

    try {
      const result = await withTimeout(
        transact(async (wallet) => {
          const authorization = await this.authorize(wallet);
          const capabilities = await wallet.getCapabilities();
          return { authorization, capabilities };
        }),
        35000
      );

      this.applyAuthorization(result.authorization);
      this.lastCapabilities = result.capabilities;
      await this.persistAuthorization();

      if (!this.address) {
        throw new Error("Wallet connection did not return an address");
      }

      return this.address;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async disconnect(): Promise<void> {
    await this.hydrateCache();

    if (this.authToken) {
      try {
        const authToken = this.authToken;
        await withTimeout(
          transact(async (wallet) => {
            await wallet.deauthorize({ auth_token: authToken });
          }),
          10000
        );
      } catch {
        // Best-effort deauthorize. Local cache is still cleared below.
      }
    }

    await this.clearAuthorizationState();
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    await this.hydrateCache();

    try {
      const signedPayload = await withTimeout(
        transact(async (wallet) => {
          const authorization = await this.authorize(wallet);
          this.applyAuthorization(authorization);
          await this.persistAuthorization();

          const signedPayloads = await wallet.signMessages({
            addresses: [authorization.accounts[0].address],
            payloads: [message]
          });

          const signature = signedPayloads[0];
          if (!signature) {
            throw new Error("Missing message signature");
          }

          return signature;
        }),
        35000
      );

      return extractDetachedSignature(signedPayload, message);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    await this.hydrateCache();

    const rpcUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

    try {
      // Sign only so broadcast stays on our RPC path.
      const signedTx = await withTimeout(
        transact(async (wallet) => {
          const authorization = await this.authorize(wallet);
          this.applyAuthorization(authorization);
          await this.persistAuthorization();

          const signedTransactions = await wallet.signTransactions({
            transactions: [transaction],
          });

          const signed = signedTransactions[0];
          if (!signed) {
            throw new Error("Wallet did not return a signed transaction");
          }

          return signed;
        }),
        35000
      );

      // Send ourselves via our RPC
      const connection = new Connection(rpcUrl, "confirmed");
      const rawTx = signedTx.serialize();
      return await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async sendVersionedTransaction(transaction: VersionedTransaction): Promise<string> {
    await this.hydrateCache();

    const rpcUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

    try {
      // Sign only so broadcast stays on our RPC path.
      const signedTx = await withTimeout(
        transact(async (wallet) => {
          const authorization = await this.authorize(wallet);
          this.applyAuthorization(authorization);
          await this.persistAuthorization();

          const signedTransactions = await wallet.signTransactions({
            transactions: [transaction],
          });

          const signed = signedTransactions[0];
          if (!signed) {
            throw new Error("Wallet did not return a signed transaction");
          }

          return signed;
        }),
        35000
      );

      // Send ourselves via our RPC
      const connection = new Connection(rpcUrl, "confirmed");
      const rawTx = signedTx.serialize();
      return await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Build a transaction with a fresh blockhash inside the MWA session,
   * sign it via Seed Vault, then send it ourselves via our own RPC.
   *
   * Why signTransactions instead of signAndSendTransactions?
   * - We keep send/broadcast under our RPC control (retries, options, metrics).
   * - Wallets may still run local simulation before approval for both flows;
   *   this does not eliminate wallet-side simulation warnings.
   */
  async buildAndSendTransaction(
    instructions: TransactionInstruction[],
    payer: PublicKey
  ): Promise<string> {
    await this.hydrateCache();

    const rpcUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

    try {
      // Phase 1: Open MWA session, authorize, build tx, SIGN (not send)
      const signedTx = await withTimeout(
        transact(async (wallet) => {
          const authorization = await this.authorize(wallet);
          this.applyAuthorization(authorization);
          await this.persistAuthorization();

          // Fetch fresh blockhash INSIDE the MWA session, after authorization.
          const connection = new Connection(rpcUrl, "confirmed");
          const { context, value } = await connection.getLatestBlockhashAndContext("confirmed");

          const tx = new Transaction();
          tx.recentBlockhash = value.blockhash;
          tx.lastValidBlockHeight = value.lastValidBlockHeight;
          tx.feePayer = payer;
          for (const ix of instructions) {
            tx.add(ix);
          }

          // signTransactions keeps final broadcast on our RPC path.
          // Wallets may still simulate prior to user approval.
          const signedTransactions = await wallet.signTransactions({
            transactions: [tx],
          });

          const signed = signedTransactions[0];
          if (!signed) {
            throw new Error("Wallet did not return a signed transaction");
          }

          return { signed, minContextSlot: context.slot };
        }),
        60000
      );

      // Phase 2: Send the signed transaction ourselves via our Helius RPC
      const connection = new Connection(rpcUrl, "confirmed");
      const rawTx = signedTx.signed.serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
        minContextSlot: signedTx.minContextSlot,
      });

      return signature;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  getAddress(): string | null {
    return this.address;
  }

  getCapabilities(): WalletCapabilities {
    return {
      canSignMessage: true,
      canSendTransaction: canSendTxFromCapabilities(this.lastCapabilities),
      walletType: "mwa"
    };
  }
}
