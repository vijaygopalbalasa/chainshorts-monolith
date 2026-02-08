import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { createReactionSigningMessage } from "@chainshorts/shared";
import { createApp } from "./app.js";
import { MemoryRepository } from "./repositories/memoryRepository.js";
import type { FeedbackRow, OrphanedPaymentRow, Repository } from "./types/repository.js";

function createAdvertiserBillingTestRepository(): Repository {
  const repository = new MemoryRepository() as unknown as Repository;
  const advertiser = {
    id: "adv-test-1",
    email: null as string | null,
    walletAddress: null as string | null,
    companyName: "Acme Protocol" as string | null,
    websiteUrl: "https://acme.example" as string | null,
    isOnboarded: true,
    accountStatus: "active" as const,
    suspendedAt: null as string | null,
    suspensionReason: null as string | null,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    lastLoginAt: null as string | null,
  };
  const advertiserSessions = new Map<string, { sessionToken: string; advertiserId: string; expiresAt: string }>();
  const campaigns = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      advertiserName: "Acme Protocol",
      headline: "Launch with Acme",
      bodyText: "Reach active traders.",
      imageUrl: null,
      destinationUrl: "https://acme.example/campaign",
      ctaText: "Learn More",
      accentColor: "#10b981",
      cardFormat: "classic",
      placement: "feed" as const,
      targetAudience: "all",
      campaignGoal: "traffic",
      actionUrl: null as string | null,
      startsAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      impressionLimit: 5000,
      impressionCount: 0,
      clickCount: 0,
      leadCount: 0,
      isActive: false,
      approvalStatus: "approved" as const,
      approvedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      approvedBy: "admin",
      rejectionReason: null as string | null,
      billingAmountUsdc: 25,
      billingStatus: "payment_required" as const,
      paymentTxSignature: null as string | null,
      paymentReceivedAt: null as string | null,
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      advertiserName: "Acme Protocol",
      headline: "Already Funded",
      bodyText: "Paid campaign",
      imageUrl: null,
      destinationUrl: "https://acme.example/paid",
      ctaText: "Open",
      accentColor: "#10b981",
      cardFormat: "banner",
      placement: "predict" as const,
      targetAudience: "whales",
      campaignGoal: "action",
      actionUrl: "https://acme.example/action",
      startsAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      impressionLimit: 2500,
      impressionCount: 120,
      clickCount: 8,
      leadCount: 0,
      isActive: true,
      approvalStatus: "approved" as const,
      approvedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      approvedBy: "admin",
      rejectionReason: null as string | null,
      billingAmountUsdc: 30,
      billingStatus: "paid" as const,
      paymentTxSignature: "paid_signature_123",
      paymentReceivedAt: new Date("2026-01-02T00:00:00.000Z").toISOString(),
      createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    },
  ];
  const billingRequests: Array<{
    id: string;
    advertiserId: string;
    cardId: string;
    headline: string;
    requestType: "billing_review" | "refund_request";
    status: "open" | "reviewing" | "resolved" | "rejected";
    note: string;
    adminNote: string | null;
    resolvedBy: string | null;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  }> = [];

  repository.upsertAdvertiserByWallet = async (input) => {
    advertiser.walletAddress = input.walletAddress;
    return { ...advertiser };
  };
  repository.getAdvertiserById = async (id) => (id === advertiser.id ? { ...advertiser } : null);
  repository.createAdvertiserSession = async (advertiserId) => {
    const session = {
      sessionToken: `adv_sess_test_${advertiserSessions.size + 1}`,
      advertiserId,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    advertiserSessions.set(session.sessionToken, session);
    return session;
  };
  repository.getAdvertiserSession = async (token) => advertiserSessions.get(token) ?? null;
  repository.invalidateAdvertiserSession = async (token) => {
    advertiserSessions.delete(token);
  };
  repository.updateAdvertiserLastLogin = async () => {
    advertiser.lastLoginAt = new Date().toISOString();
  };
  repository.listSponsoredCardsByAdvertiser = async (advertiserId) =>
    advertiserId === advertiser.id ? campaigns.map((campaign) => ({ ...campaign })) : [];
  repository.getSponsoredCardForAdvertiser = async (cardId, advertiserId) => {
    if (advertiserId !== advertiser.id) return null;
    const campaign = campaigns.find((item) => item.id === cardId);
    return campaign ? { ...campaign } : null;
  };
  repository.createAdvertiserBillingRequest = async (input) => {
    if (input.advertiserId !== advertiser.id) {
      return { success: false as const, reason: "campaign_not_found" as const };
    }
    const campaign = campaigns.find((item) => item.id === input.cardId);
    if (!campaign) {
      return { success: false as const, reason: "campaign_not_found" as const };
    }
    if (input.requestType === "refund_request" && campaign.billingStatus !== "paid") {
      return { success: false as const, reason: "refund_requires_paid_campaign" as const };
    }
    const existing = billingRequests.find(
      (request) =>
        request.advertiserId === input.advertiserId &&
        request.cardId === input.cardId &&
        (request.status === "open" || request.status === "reviewing")
    );
    if (existing) {
      return { success: false as const, reason: "request_already_open" as const };
    }
    const now = new Date().toISOString();
    const id = `00000000-0000-4000-8000-${String(billingRequests.length + 1).padStart(12, "0")}`;
    billingRequests.unshift({
      id,
      advertiserId: input.advertiserId,
      cardId: input.cardId,
      headline: campaign.headline,
      requestType: input.requestType,
      status: "open",
      note: input.note,
      adminNote: null,
      resolvedBy: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    });
    return { success: true as const, requestId: id };
  };
  repository.listAdvertiserBillingRequests = async (advertiserId) =>
    advertiserId === advertiser.id
      ? billingRequests.map((request) => ({
          id: request.id,
          cardId: request.cardId,
          headline: request.headline,
          requestType: request.requestType,
          status: request.status,
          note: request.note,
          adminNote: request.adminNote,
          resolvedBy: request.resolvedBy,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
          resolvedAt: request.resolvedAt,
        }))
      : [];
  repository.listAdminAdvertiserBillingRequests = async () =>
    billingRequests.map((request) => ({
      id: request.id,
      advertiserId: request.advertiserId,
      advertiserName: advertiser.companyName ?? "Unknown",
      walletAddress: advertiser.walletAddress,
      cardId: request.cardId,
      headline: request.headline,
      requestType: request.requestType,
      status: request.status,
      note: request.note,
      adminNote: request.adminNote,
      resolvedBy: request.resolvedBy,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      resolvedAt: request.resolvedAt,
    }));
  repository.updateAdvertiserBillingRequestStatus = async (input) => {
    const request = billingRequests.find((item) => item.id === input.requestId);
    if (!request) return false;
    const now = new Date().toISOString();
    request.status = input.status;
    request.adminNote = input.adminNote ?? null;
    request.updatedAt = now;
    if (input.status === "resolved" || input.status === "rejected") {
      request.resolvedAt = now;
      request.resolvedBy = input.resolvedBy;
    } else {
      request.resolvedAt = null;
      request.resolvedBy = null;
    }
    return true;
  };

  return repository;
}

function createFeedbackTestRepository(): Repository {
  const repository = new MemoryRepository() as unknown as Repository;
  const feedbackRows: FeedbackRow[] = [];

  repository.createFeedback = async (input) => {
    const now = new Date().toISOString();
    const row: FeedbackRow = {
      id: `00000000-0000-4000-8000-${String(feedbackRows.length + 1).padStart(12, "0")}`,
      wallet: input.wallet,
      type: input.type,
      subject: input.subject,
      message: input.message,
      appVersion: input.appVersion ?? null,
      platform: input.platform ?? null,
      status: "new",
      adminNotes: null,
      createdAt: now,
      updatedAt: now
    };
    feedbackRows.unshift(row);
    return { id: row.id, createdAt: row.createdAt };
  };

  repository.listFeedback = async (opts) => {
    const filtered = opts.status
      ? feedbackRows.filter((row) => row.status === opts.status)
      : feedbackRows;
    return filtered.slice(opts.offset, opts.offset + opts.limit).map((row) => ({ ...row }));
  };

  repository.updateFeedback = async (id, update) => {
    const row = feedbackRows.find((item) => item.id === id);
    if (!row) {
      return false;
    }
    if (update.status !== undefined) {
      row.status = update.status;
    }
    if (update.adminNotes !== undefined) {
      row.adminNotes = update.adminNotes;
    }
    row.updatedAt = new Date().toISOString();
    return true;
  };

  return repository;
}

function createOrphanedPaymentsTestRepository(): Repository {
  const repository = new MemoryRepository() as unknown as Repository;
  const rows: OrphanedPaymentRow[] = [
    {
      id: "99999999-0000-4000-8000-000000000001",
      txSignature: "tx_sig_alpha_123456789",
      wallet: "9z5B8hC7z8uVQv7vP8mV1Qx8bR9C1d3EfGhJkLmN",
      purpose: "prediction_stake",
      expectedAmountSkr: 150,
      referenceType: "poll",
      referenceId: "poll_abc_123",
      failureReason: "market_not_active",
      status: "open",
      adminNotes: null,
      metadata: { side: "yes" } as Record<string, unknown>,
      createdAt: new Date("2026-02-01T10:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-02-01T10:00:00.000Z").toISOString(),
    },
  ];

  repository.listOrphanedPayments = async (opts) => {
    const filtered = opts.status ? rows.filter((row) => row.status === opts.status) : rows;
    return filtered.slice(opts.offset, opts.offset + opts.limit).map((row) => ({ ...row }));
  };

  repository.updateOrphanedPayment = async (id, update) => {
    const row = rows.find((item) => item.id === id);
    if (!row) {
      return false;
    }
    if (update.status !== undefined) {
      row.status = update.status;
    }
    if (update.adminNotes !== undefined) {
      row.adminNotes = update.adminNotes;
    }
    row.updatedAt = new Date().toISOString();
    return true;
  };

  return repository;
}

describe("api routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      repository: new MemoryRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createWalletSession(
    keypair: Keypair,
    targetApp: ReturnType<typeof createApp> = app
  ): Promise<string> {
    const wallet = keypair.publicKey.toBase58();
    const challengeResponse = await targetApp.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { walletAddress: wallet }
    });

    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json<{ message: string }>();

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey);

    const verifyResponse = await targetApp.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: {
        walletAddress: wallet,
        message: challenge.message,
        signature: bs58.encode(signatureBytes)
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    return verifyResponse.json<{ sessionToken: string }>().sessionToken;
  }

  async function createAdvertiserPortalSession(keypair: Keypair): Promise<string> {
    const wallet = keypair.publicKey.toBase58();
    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/advertiser/auth/challenge",
      payload: { walletAddress: wallet }
    });

    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json<{ message: string }>();

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey);

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/v1/advertiser/auth/verify",
      payload: {
        walletAddress: wallet,
        message: challenge.message,
        signature: bs58.encode(signatureBytes)
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    return verifyResponse.json<{ token: string }>().token;
  }

  it("auth challenge and verify succeeds with valid signature", async () => {
    const keypair = Keypair.generate();
    const body = { sessionToken: await createWalletSession(keypair) };
    expect(body.sessionToken.startsWith("sess_")).toBe(true);
  });

  it("returns feed pages with cursor pagination", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v1/feed?limit=1"
    });

    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ items: Array<{ id: string }>; nextCursor?: string }>();
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toBeDefined();

    const second = await app.inject({
      method: "GET",
      url: `/v1/feed?limit=1&cursor=${firstBody.nextCursor}`
    });

    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ items: Array<{ id: string }> }>();
    expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
  });

  it("fails cashout closed when transfer capability is unavailable", async () => {
    const repository = new MemoryRepository() as unknown as Repository;
    let reverted = false;

    repository.cashOutPredictionStake = async () => ({
      stakeAmount: 100,
      pollId: "poll_1",
      side: "yes" as const,
    });
    repository.updateStakeCashoutTransfer = async (_stakeId, _wallet, _txSignature, status) => {
      if (status === "failed") {
        reverted = true;
      }
    };

    const cashoutApp = createApp({
      repository,
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });

    try {
      const keypair = Keypair.generate();
      const wallet = keypair.publicKey.toBase58();
      const sessionToken = await createWalletSession(keypair, cashoutApp);

      const response = await cashoutApp.inject({
        method: "POST",
        url: "/v1/predictions/stakes/11111111-1111-4111-8111-111111111111/cashout",
        payload: { wallet },
        headers: {
          authorization: `Bearer ${sessionToken}`
        }
      });

      expect(response.statusCode).toBe(503);
      expect(response.json<{ error: string }>().error).toBe("cashout_temporarily_unavailable");
      expect(reverted).toBe(true);
    } finally {
      await cashoutApp.close();
    }
  });

  it("supports feed search", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/feed/search?q=sponsored"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<{ headline: string }> }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((item) => item.headline.toLowerCase().includes("sponsored"))).toBe(true);
  });

  it("accepts signed reactions", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);
    const nonce = "nonce12345";

    const message = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "insightful",
      nonce
    });

    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));

    const response = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "insightful",
        nonce,
        signature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean }>().ok).toBe(true);
  });

  it("returns reaction counts", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);

    const nonce = "nonce_for_counts_1";
    const message = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "bullish",
      nonce
    });
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));

    const react = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "bullish",
        nonce,
        signature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(react.statusCode).toBe(200);

    const counts = await app.inject({
      method: "GET",
      url: "/v1/reactions/counts?articleIds=art_01"
    });
    expect(counts.statusCode).toBe(200);
    const body = counts.json<{ items: Record<string, { bullish: number; total: number }> }>();
    expect(body.items.art_01?.bullish).toBe(1);
    expect(body.items.art_01?.total).toBe(1);
  });

  it("rejects signed reactions when session is missing", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const nonce = "nonce12345";

    const message = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "insightful",
      nonce
    });

    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));

    const response = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "insightful",
        nonce,
        signature
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe("session_required");
  });

  it("rejects duplicate signed reactions", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);
    const nonce = "nonce12345";

    const message = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "insightful",
      nonce
    });

    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));

    const first = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "insightful",
        nonce,
        signature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "insightful",
        nonce,
        signature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: string }>().error).toBe("duplicate_reaction");
  });

  it("rejects second reaction for same wallet/article with different nonce", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);

    const firstNonce = "nonce_wallet_unique_1";
    const firstMessage = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "bullish",
      nonce: firstNonce
    });
    const firstSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(firstMessage), keypair.secretKey));

    const first = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "bullish",
        nonce: firstNonce,
        signature: firstSignature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(first.statusCode).toBe(200);

    const secondNonce = "nonce_wallet_unique_2";
    const secondMessage = createReactionSigningMessage({
      articleId: "art_01",
      reactionType: "skeptical",
      nonce: secondNonce
    });
    const secondSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(secondMessage), keypair.secretKey));

    const second = await app.inject({
      method: "POST",
      url: "/v1/reactions/sign",
      payload: {
        articleId: "art_01",
        wallet,
        reactionType: "skeptical",
        nonce: secondNonce,
        signature: secondSignature
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(second.statusCode).toBe(409);
  });

  it("creates and removes bookmarks with wallet auth", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);

    const save = await app.inject({
      method: "POST",
      url: "/v1/bookmarks",
      payload: {
        wallet,
        articleId: "art_01"
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(save.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/v1/bookmarks?wallet=${wallet}`,
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === "art_01")).toBe(true);

    const remove = await app.inject({
      method: "DELETE",
      url: "/v1/bookmarks",
      payload: {
        wallet,
        articleId: "art_01"
      },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });
    expect(remove.statusCode).toBe(200);
  });

  it("revokes session on logout", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionToken = await createWalletSession(keypair);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      payload: { walletAddress: wallet },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });

    expect(logout.statusCode).toBe(200);

    // After logout, a wallet-authenticated action should return 401
    const bookmarkAfterLogout = await app.inject({
      method: "POST",
      url: "/v1/bookmarks",
      payload: { wallet, articleId: "art_01" },
      headers: {
        authorization: `Bearer ${sessionToken}`
      }
    });

    expect(bookmarkAfterLogout.statusCode).toBe(401);
    expect(bookmarkAfterLogout.json<{ error: string }>().error).toBe("session_invalid");
  });

  it("revokes all sessions on logout-all", async () => {
    const keypair = Keypair.generate();
    const wallet = keypair.publicKey.toBase58();
    const sessionA = await createWalletSession(keypair);
    const sessionB = await createWalletSession(keypair);

    const logoutAll = await app.inject({
      method: "POST",
      url: "/v1/auth/logout-all",
      payload: { walletAddress: wallet },
      headers: {
        authorization: `Bearer ${sessionA}`
      }
    });
    expect(logoutAll.statusCode).toBe(200);

    // Both sessions should now be invalid
    const bookmarkWithSecondSession = await app.inject({
      method: "POST",
      url: "/v1/bookmarks",
      payload: { wallet, articleId: "art_01" },
      headers: {
        authorization: `Bearer ${sessionB}`
      }
    });

    expect(bookmarkWithSecondSession.statusCode).toBe(401);
  });

  it("returns feed freshness", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/feed/freshness"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ stale: boolean; staleMinutes: number }>();
    expect(typeof body.stale).toBe("boolean");
    expect(typeof body.staleMinutes).toBe("number");
  });

  it("adds baseline security headers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("adds CORS headers for allowed origins", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://chainshorts.live"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://chainshorts.live");
  });

  it("does not add CORS headers for untrusted origins", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://evil.example"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows CORS preflight for trusted origins", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/feed",
      headers: {
        origin: "https://chainshorts.live",
        "access-control-request-method": "GET"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://chainshorts.live");
  });

  it("rejects CORS preflight for untrusted origins", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/feed",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string }>().error).toBe("origin_not_allowed");
  });

  it("registers and unregisters push tokens", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/push/register",
      payload: {
        deviceId: "test-device-01",
        expoPushToken: "ExponentPushToken[test-token-01]",
        platform: "android",
        locale: "en-US",
        appVersion: "1.0.0"
      }
    });
    expect(register.statusCode).toBe(200);

    const unregister = await app.inject({
      method: "POST",
      url: "/v1/push/unregister",
      payload: {
        deviceId: "test-device-01",
        expoPushToken: "ExponentPushToken[test-token-01]"
      }
    });
    expect(unregister.statusCode).toBe(200);
  });

  it("rejects invalid wallet address format", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: {
        walletAddress: "not-a-valid-wallet"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("requires a valid wallet session to submit feedback", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      payload: {
        type: "bug",
        subject: "Crash on swap",
        message: "The app crashes after opening the swap form."
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe("session_required");
  });

  it("creates feedback for authenticated wallet sessions", async () => {
    const keypair = Keypair.generate();
    const sessionToken = await createWalletSession(keypair);

    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: `Bearer ${sessionToken}`
      },
      payload: {
        type: "suggestion",
        subject: "Add market filters",
        message: "Please add quick filters for ending soon and active positions."
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; createdAt: string }>();
    expect(body.id.length).toBeGreaterThan(0);
    expect(new Date(body.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("validates feedback body length constraints", async () => {
    const keypair = Keypair.generate();
    const sessionToken = await createWalletSession(keypair);

    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: `Bearer ${sessionToken}`
      },
      payload: {
        type: "bug",
        subject: "x",
        message: "bad"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects whitespace-only feedback subject and message", async () => {
    const keypair = Keypair.generate();
    const sessionToken = await createWalletSession(keypair);

    const response = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: `Bearer ${sessionToken}`
      },
      payload: {
        type: "bug",
        subject: "   ",
        message: "          "
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rate limits feedback submissions", async () => {
    const keypair = Keypair.generate();
    const sessionToken = await createWalletSession(keypair);

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/feedback",
        headers: {
          authorization: `Bearer ${sessionToken}`
        },
        payload: {
          type: "other",
          subject: `Feedback ${index + 1}`,
          message: `This is feedback submission number ${index + 1}.`
        }
      });

      expect(response.statusCode).toBe(201);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: `Bearer ${sessionToken}`
      },
      payload: {
        type: "other",
        subject: "Feedback 6",
        message: "This submission should be blocked by the rate limit."
      }
    });

    expect(blocked.statusCode).toBe(429);
  });

  it("lists and updates feedback through admin routes", async () => {
    await app.close();
    app = createApp({
      repository: createFeedbackTestRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });

    const keypair = Keypair.generate();
    const sessionToken = await createWalletSession(keypair);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        authorization: `Bearer ${sessionToken}`
      },
      payload: {
        type: "bug",
        subject: "Wallet tab issue",
        message: "The stats card should refresh after claim completion."
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const feedbackId = createResponse.json<{ id: string }>().id;

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/feedback?limit=50",
      headers: {
        "x-admin-token": "test-admin-token"
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse.json<{ feedback: FeedbackRow[] }>();
    expect(listed.feedback).toHaveLength(1);
    expect(listed.feedback[0]?.id).toBe(feedbackId);
    expect(listed.feedback[0]?.status).toBe("new");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/v1/admin/feedback/${feedbackId}`,
      headers: {
        "x-admin-token": "test-admin-token"
      },
      payload: {
        status: "reviewed",
        adminNotes: "Triaged and queued for the next mobile release."
      }
    });

    expect(updateResponse.statusCode).toBe(204);

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/admin/feedback?status=reviewed&limit=50",
      headers: {
        "x-admin-token": "test-admin-token"
      }
    });

    expect(filtered.statusCode).toBe(200);
    const updated = filtered.json<{ feedback: FeedbackRow[] }>();
    expect(updated.feedback).toHaveLength(1);
    expect(updated.feedback[0]?.status).toBe("reviewed");
    expect(updated.feedback[0]?.adminNotes).toBe("Triaged and queued for the next mobile release.");
  });

  it("lists and updates orphaned payment exceptions through admin routes", async () => {
    await app.close();
    app = createApp({
      repository: createOrphanedPaymentsTestRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/orphan-payments?status=open&limit=50",
      headers: {
        "x-admin-token": "test-admin-token"
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse.json<{ payments: Array<{ id: string; status: string; failureReason: string }> }>();
    expect(listed.payments).toHaveLength(1);
    expect(listed.payments[0]?.status).toBe("open");
    expect(listed.payments[0]?.failureReason).toBe("market_not_active");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/v1/admin/orphan-payments/99999999-0000-4000-8000-000000000001",
      headers: {
        "x-admin-token": "test-admin-token"
      },
      payload: {
        status: "reviewing",
        adminNotes: "Confirmed payment on-chain. Queueing manual reconciliation."
      }
    });

    expect(updateResponse.statusCode).toBe(204);

    const listAfterUpdate = await app.inject({
      method: "GET",
      url: "/v1/admin/orphan-payments?status=reviewing&limit=50",
      headers: {
        "x-admin-token": "test-admin-token"
      }
    });

    expect(listAfterUpdate.statusCode).toBe(200);
    const updated = listAfterUpdate.json<{ payments: Array<{ status: string; adminNotes: string | null }> }>();
    expect(updated.payments).toHaveLength(1);
    expect(updated.payments[0]?.status).toBe("reviewing");
    expect(updated.payments[0]?.adminNotes).toBe("Confirmed payment on-chain. Queueing manual reconciliation.");
  });

  it("returns advertiser billing overview with Solana Pay invoice links", async () => {
    await app.close();
    app = createApp({
      repository: createAdvertiserBillingTestRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });
    const token = await createAdvertiserPortalSession(Keypair.generate());

    const response = await app.inject({
      method: "GET",
      url: "/v1/advertiser/billing",
      headers: {
        "x-advertiser-token": token,
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      openInvoices: Array<{
        id: string;
        paymentRequestUrl: string;
        billingAmountUsdc: number;
        paymentIntentId: string;
        paymentIntentExpiresAt: string;
      }>;
      summary: { approvedAwaitingPayment: number; outstandingUsdc: number };
    }>();
    expect(body.openInvoices).toHaveLength(1);
    expect(body.openInvoices[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.openInvoices[0]?.billingAmountUsdc).toBe(25);
    expect(body.openInvoices[0]?.paymentIntentId).toBeTruthy();
    expect(body.openInvoices[0]?.paymentIntentExpiresAt).toBeTruthy();
    expect(body.openInvoices[0]?.paymentRequestUrl.startsWith("solana:11111111111111111111111111111111?")).toBe(true);
    expect(body.summary.approvedAwaitingPayment).toBe(1);
    expect(body.summary.outstandingUsdc).toBe(25);
  });

  it("returns a payment request for approved unpaid advertiser campaigns", async () => {
    await app.close();
    app = createApp({
      repository: createAdvertiserBillingTestRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });
    const token = await createAdvertiserPortalSession(Keypair.generate());

    const response = await app.inject({
      method: "GET",
      url: "/v1/advertiser/campaigns/11111111-1111-4111-8111-111111111111/payment-request",
      headers: {
        "x-advertiser-token": token,
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      billingAmountUsdc: number;
      paymentRequestUrl: string;
      paymentIntentId: string;
      paymentIntentExpiresAt: string;
    }>();
    expect(body.billingAmountUsdc).toBe(25);
    expect(body.paymentIntentId).toBeTruthy();
    expect(body.paymentIntentExpiresAt).toBeTruthy();
    expect(body.paymentRequestUrl).toContain("amount=0.25");
  });

  it("creates and resolves advertiser billing requests through admin ops", async () => {
    await app.close();
    app = createApp({
      repository: createAdvertiserBillingTestRepository(),
      platformWallet: "11111111111111111111111111111111",
      adminToken: "test-admin-token",
    });
    const token = await createAdvertiserPortalSession(Keypair.generate());

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/advertiser/billing/requests",
      headers: {
        "x-advertiser-token": token,
      },
      payload: {
        cardId: "22222222-2222-4222-8222-222222222222",
        requestType: "refund_request",
        note: "Need manual review for this completed invoice."
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const requestId = createResponse.json<{ requestId: string }>().requestId;

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/advertiser-billing/requests",
      headers: {
        "x-admin-token": "test-admin-token",
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse.json<{ requests: Array<{ id: string; status: string }> }>();
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]?.id).toBe(requestId);
    expect(listed.requests[0]?.status).toBe("open");

    const resolveResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/advertiser-billing/requests/${requestId}/status`,
      headers: {
        "x-admin-token": "test-admin-token",
      },
      payload: {
        status: "resolved",
        adminNote: "Reviewed and queued for manual handling."
      }
    });

    expect(resolveResponse.statusCode).toBe(200);

    const listAfterResolve = await app.inject({
      method: "GET",
      url: "/v1/admin/advertiser-billing/requests",
      headers: {
        "x-admin-token": "test-admin-token",
      }
    });

    expect(listAfterResolve.statusCode).toBe(200);
    const resolved = listAfterResolve.json<{ requests: Array<{ status: string; adminNote: string | null }> }>();
    expect(resolved.requests[0]?.status).toBe("resolved");
    expect(resolved.requests[0]?.adminNote).toBe("Reviewed and queued for manual handling.");
  });
});
