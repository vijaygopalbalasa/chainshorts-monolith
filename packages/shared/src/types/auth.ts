export interface AuthChallengeRequest {
  walletAddress: string;
}

export interface AuthChallengeResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface AuthVerifyRequest {
  walletAddress: string;
  message: string;
  signature: string;
}

export interface AuthSession {
  sessionToken: string;
  walletAddress: string;
  expiresAt: string;
}
