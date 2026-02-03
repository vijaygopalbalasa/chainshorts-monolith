function randomNonce(length = 24): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  let value = "";

  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure randomness is unavailable in this runtime");
  }

  cryptoApi.getRandomValues(bytes);
  for (let index = 0; index < length; index += 1) {
    const random = (bytes.at(index) ?? 0) % charset.length;
    value += charset.charAt(random);
  }

  return value;
}

export function createSiwsChallenge(walletAddress: string): { nonce: string; message: string; expiresAt: string } {
  const nonce = randomNonce();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const message = [
    "Chainshorts wants you to sign in with your Solana account:",
    walletAddress,
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${expiresAt}`
  ].join("\n");

  return {
    nonce,
    message,
    expiresAt
  };
}

export function extractNonceFromMessage(message: string): string | null {
  const match = message.match(/^Nonce:\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
}
