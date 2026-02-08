import bs58 from "bs58";
import nacl from "tweetnacl";

export function verifySolanaSignature(message: string, signatureBase58: string, publicKeyBase58: string): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signatureBase58);
    const publicKeyBytes = bs58.decode(publicKeyBase58);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}
