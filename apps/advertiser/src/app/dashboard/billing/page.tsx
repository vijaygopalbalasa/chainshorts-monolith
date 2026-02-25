"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Copy, CreditCard, ExternalLink, Receipt, ShieldCheck } from "lucide-react";
import { getToken } from "@/lib/auth";
import {
  createBillingRequest,
  getBilling,
  getCampaignPaymentRequest,
  getCampaigns,
  payCampaign,
  type BillingOverview,
  type BillingRequest,
  type Campaign,
} from "@/lib/api";

export default function BillingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [txById, setTxById] = useState<Record<string, string>>({});
  const [qrById, setQrById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestForm, setRequestForm] = useState<{
    cardId: string;
    requestType: "billing_review" | "refund_request";
    note: string;
  }>({
    cardId: "",
    requestType: "billing_review",
    note: "",
  });

  const load = async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [billingResult, campaignsResult] = await Promise.allSettled([
        getBilling(token),
        getCampaigns(token),
      ]);
      const nextErrors: string[] = [];

      if (billingResult.status === "fulfilled") {
        setBilling(billingResult.value);
      } else {
        setBilling(null);
        nextErrors.push("billing overview");
      }

      if (campaignsResult.status === "fulfilled") {
        const nextCampaigns = campaignsResult.value.campaigns ?? [];
        const nextPaidCampaigns = nextCampaigns.filter((campaign) => campaign.billingStatus === "paid");
        setCampaigns(nextCampaigns);
        setRequestForm((prev) => ({
          ...prev,
          cardId:
            nextPaidCampaigns.some((campaign) => campaign.id === prev.cardId)
              ? prev.cardId
              : nextPaidCampaigns[0]?.id ?? "",
        }));
      } else {
        setCampaigns([]);
        setRequestForm((prev) => ({ ...prev, cardId: "" }));
        nextErrors.push("campaigns");
      }

      if (nextErrors.length) {
        setError(`Some billing data could not be loaded: ${nextErrors.join(", ")}`);
      }
    } catch {
      setError("Failed to load billing");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [router]);

  useEffect(() => {
    if (!billing?.openInvoices.length) {
      setQrById({});
      return;
    }
    let cancelled = false;
    void Promise.allSettled(
      billing.openInvoices.map(async (invoice) => {
        const dataUrl = await QRCode.toDataURL(invoice.paymentRequestUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 180,
        });
        return [invoice.id, dataUrl] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      const rows = results
        .filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === "fulfilled")
        .map((result) => result.value);
      setQrById(Object.fromEntries(rows));
    }).catch(() => {
      if (!cancelled) setQrById({});
    });
    return () => {
      cancelled = true;
    };
  }, [billing?.openInvoices]);

  const outstandingUsdc = (billing?.summary.outstandingUsdc ?? billing?.summary.outstandingSkr ?? 0);
  const paidUsdc = (billing?.summary.paidUsdc ?? billing?.summary.paidSkr ?? 0);
  const defaultPackage = billing?.pricing.defaultImpressionLimit ?? 5000;
  const paidCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.billingStatus === "paid"),
    [campaigns]
  );

  const pricingRows = useMemo(() => {
    if (!billing) return [];
    return [
      { label: "Classic CPM", value: `$${((billing.pricing.cpmClassicUsdc ?? billing.pricing.cpmClassicSkr ?? 0) / 100).toFixed(2)} USDC` },
      { label: "Banner CPM", value: `$${((billing.pricing.cpmBannerUsdc ?? billing.pricing.cpmBannerSkr ?? 0) / 100).toFixed(2)} USDC` },
      { label: "Spotlight CPM", value: `$${((billing.pricing.cpmSpotlightUsdc ?? billing.pricing.cpmSpotlightSkr ?? 0) / 100).toFixed(2)} USDC` },
      { label: "Portrait CPM", value: `$${((billing.pricing.cpmPortraitUsdc ?? 0) / 100).toFixed(2)} USDC` },
      { label: "Predict Multiplier", value: `${billing.pricing.predictMultiplierPct}%` },
      { label: "Feed + Predict Multiplier", value: `${billing.pricing.bothMultiplierPct}%` },
    ];
  }, [billing]);

  const copyText = async (value: string, message: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setError("Clipboard access is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setError("Could not copy to clipboard. Please copy the value manually.");
    }
  };

  const handlePay = async (campaignId: string) => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const txSignature = (txById[campaignId] ?? "").trim();
    if (!txSignature) {
      setError("Paste the confirmed transaction signature before submitting payment.");
      return;
    }

    setSubmittingId(campaignId);
    setError(null);
    setNotice(null);
    try {
      let paymentIntentId = billing?.openInvoices.find((item) => item.id === campaignId)?.paymentIntentId;
      try {
        const refreshed = await getCampaignPaymentRequest(token, campaignId);
        paymentIntentId = refreshed.paymentIntentId;
      } catch (refreshError: unknown) {
        const message = refreshError instanceof Error ? refreshError.message : "Unable to refresh payment request";
        if (/already paid/i.test(message)) {
          setNotice("Campaign is already funded.");
          await load();
          return;
        }
        throw refreshError;
      }

      const result = await payCampaign(token, campaignId, txSignature, paymentIntentId);
      setNotice(result.alreadyPaid ? "Campaign is already funded." : "Payment verified. Campaign is now eligible to run.");
      setTxById((prev) => ({ ...prev, [campaignId]: "" }));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment verification failed");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleCreateRequest = async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const selectedCampaign = paidCampaigns.find((campaign) => campaign.id === requestForm.cardId);
    if (!selectedCampaign || requestForm.note.trim().length < 10) {
      setError("Select a campaign and include enough detail for the operations team.");
      return;
    }

    setRequestSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await createBillingRequest(token, {
        cardId: requestForm.cardId,
        requestType: requestForm.requestType,
        note: requestForm.note.trim(),
      });
      setNotice("Billing request submitted. The operations team will review it manually.");
      setRequestForm((prev) => ({ ...prev, note: "" }));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to submit billing request");
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Billing</h1>
          <p className="mt-2 text-sm text-gray-500">
            Approved campaigns stay locked until payment is received on-chain. If anything needs review, use the manual billing request queue below.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard icon={<Receipt className="text-green-600" size={18} />} label="Outstanding" value={loading ? "-" : `$${(outstandingUsdc / 100).toFixed(2)} USDC`} />
        <MetricCard icon={<CreditCard className="text-green-600" size={18} />} label="Paid" value={loading ? "-" : `$${(paidUsdc / 100).toFixed(2)} USDC`} />
        <MetricCard icon={<ShieldCheck className="text-green-600" size={18} />} label="Awaiting Payment" value={loading ? "-" : `${billing?.summary.approvedAwaitingPayment ?? 0}`} />
        <MetricCard icon={<Receipt className="text-green-600" size={18} />} label="Default Package" value={`${defaultPackage.toLocaleString()} impressions`} />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Payment Destination</h2>
            <p className="mt-1 text-sm text-gray-500">
              You can pay with a wallet deep link / QR code below, or transfer manually and submit the confirmed signature.
            </p>
          </div>
          <button
            type="button"
            onClick={() => billing?.platformWallet ? void copyText(billing.platformWallet, "Platform wallet copied.") : undefined}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Copy size={14} />
            Copy Wallet
          </button>
        </div>
        <div className="mt-4 rounded-xl bg-gray-950 px-4 py-4 text-sm text-green-300 font-mono break-all">
          {billing?.platformWallet ?? "Loading..."}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">Pricing</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {pricingRows.map((row) => (
            <div key={row.label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{row.label}</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{row.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">Open Invoices</h2>
        {loading ? (
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-gray-100" />
        ) : !billing || billing.openInvoices.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-sm text-gray-500">
            No approved campaigns are waiting for payment.
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {billing.openInvoices.map((invoice) => {
              const invoiceAmount = (invoice.billingAmountUsdc ?? invoice.billingAmountSkr ?? 0);
              return (
                <div key={invoice.id} className="rounded-2xl border border-gray-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{invoice.headline}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                        {invoice.cardFormat} • {invoice.placement} • {invoice.impressionLimit?.toLocaleString() ?? defaultPackage.toLocaleString()} impressions
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Ends {new Date(invoice.endsAt).toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Payment reservation until {new Date(invoice.paymentIntentExpiresAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Invoice</div>
                      <div className="mt-1 text-xl font-extrabold text-gray-900">${(invoiceAmount / 100).toFixed(2)} USDC</div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[220px,1fr]">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Scan To Pay</div>
                      <div className="mt-3 flex justify-center">
                        {qrById[invoice.id] ? (
                          <img src={qrById[invoice.id]} alt="Invoice QR code" className="h-[180px] w-[180px] rounded-xl bg-white p-2" />
                        ) : (
                          <div className="h-[180px] w-[180px] animate-pulse rounded-xl bg-gray-200" />
                        )}
                      </div>
                      <div className="mt-3 grid gap-2">
                        <a
                          href={invoice.paymentRequestUrl}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700"
                        >
                          <ExternalLink size={14} />
                          Open In Wallet
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyText(invoice.paymentRequestUrl, "Payment link copied.")}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <Copy size={14} />
                          Copy Payment Link
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Manual Verification</div>
                      <p className="mt-2 text-sm text-gray-500">
                        After the transaction confirms, paste the signature here so Chainshorts can verify the payment and unlock delivery.
                      </p>
                      <div className="mt-4 flex flex-col gap-3">
                        <input
                          value={txById[invoice.id] ?? ""}
                          onChange={(event) => setTxById((prev) => ({ ...prev, [invoice.id]: event.target.value }))}
                          placeholder="Paste confirmed transaction signature"
                          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-green-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handlePay(invoice.id)}
                          disabled={submittingId === invoice.id}
                          className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingId === invoice.id ? "Verifying..." : "Verify Payment"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Payment History */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h2>
        {loading ? (
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        ) : paidCampaigns.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No payments yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Campaign</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Paid On</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paidCampaigns.map((campaign) => {
                  const amount = (campaign.billingAmountUsdc ?? campaign.billingAmountSkr ?? 0);
                  return (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-medium line-clamp-1">{campaign.headline}</td>
                      <td className="px-4 py-3 text-gray-900 font-semibold">${(amount / 100).toFixed(2)} USDC</td>
                      <td className="px-4 py-3 text-gray-500">{campaign.paymentReceivedAt ? new Date(campaign.paymentReceivedAt).toLocaleDateString() : "\u2014"}</td>
                      <td className="px-4 py-3">
                        {campaign.paymentTxSignature ? (
                          <a href={`https://solscan.io/tx/${campaign.paymentTxSignature}`} target="_blank" rel="noopener noreferrer"
                             className="text-green-600 hover:text-green-700 font-mono text-xs">
                            {campaign.paymentTxSignature.slice(0, 8)}...{campaign.paymentTxSignature.slice(-4)} ↗
                          </a>
                        ) : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">Manual Billing Review</h2>
        <p className="mt-1 text-sm text-gray-500">
          For invoice corrections or refund requests, submit a manual request. The operations team will handle it case by case.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[260px,220px,1fr,140px]">
          <select
            value={requestForm.cardId}
            onChange={(event) => setRequestForm((prev) => ({ ...prev, cardId: event.target.value }))}
            className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900"
          >
            <option value="">Select paid campaign</option>
            {paidCampaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.headline.slice(0, 48)}
              </option>
            ))}
          </select>
          <select
            value={requestForm.requestType}
            onChange={(event) => setRequestForm((prev) => ({
              ...prev,
              requestType: event.target.value as "billing_review" | "refund_request",
            }))}
            className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900"
          >
            <option value="billing_review">Billing Review</option>
            <option value="refund_request">Refund Request</option>
          </select>
          <textarea
            value={requestForm.note}
            onChange={(event) => setRequestForm((prev) => ({ ...prev, note: event.target.value }))}
            rows={3}
            className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900"
            placeholder="Describe the issue, expected resolution, and any transaction context."
          />
          <button
            type="button"
            onClick={() => void handleCreateRequest()}
            disabled={requestSubmitting}
            className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {requestSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Request History</h3>
          {!billing?.requests.length ? (
            <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-sm text-gray-500">
              No billing requests yet.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {billing.requests.map((request: BillingRequest) => (
                <div key={request.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{request.headline}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                        {request.requestType.replace(/_/g, " ")} • {request.status}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(request.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-gray-700">{request.note}</p>
                  {request.adminNote ? (
                    <div className="mt-3 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      <span className="font-semibold text-gray-900">Ops note:</span> {request.adminNote}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</div>
        <div className="rounded-lg bg-green-50 p-2">{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-extrabold text-gray-900">{value}</div>
    </div>
  );
}
