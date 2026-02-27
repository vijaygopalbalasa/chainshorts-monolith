import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — Chainshorts",
  description: "Chainshorts privacy policy — how we collect, use, and protect your data.",
};

export default function PrivacyPolicy() {
  return (
    <main id="main-content" tabIndex={-1} style={{ background: "var(--color-bg)" }}>
      <Nav />
      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-28 pb-20">
        <div className="mb-10">
          <p className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: "var(--color-dim)" }}>
            Legal
          </p>
          <h1
            className="text-3xl font-bold mb-3"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            Privacy Policy
          </h1>
          <p className="text-sm" style={{ color: "var(--color-dim)" }}>
            Last updated: March 1, 2026
          </p>
        </div>

        <div className="legal-prose">
          <h2>1. Introduction</h2>
          <p>
            Chainshorts ("we", "our", or "us") operates the Chainshorts mobile application
            and the website at chainshorts.live. This Privacy Policy explains how we collect,
            use, and protect information when you use our services.
          </p>
          <p>
            By using Chainshorts, you agree to the collection and use of information in
            accordance with this policy. Contact us at:{" "}
            <a href="mailto:privacy@chainshorts.live">privacy@chainshorts.live</a>
          </p>

          <h2>2. Information We Collect</h2>
          <table>
            <thead>
              <tr>
                <th>Data Type</th>
                <th>What We Collect</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Wallet Address</td>
                <td>Your Solana public key (read-only)</td>
                <td>Authentication, reactions, SKR balance checks</td>
              </tr>
              <tr>
                <td>Reactions</td>
                <td>Article reactions you submit (signed on-chain)</td>
                <td>Community engagement features</td>
              </tr>
              <tr>
                <td>Prediction Stakes</td>
                <td>Stake amounts, market IDs, outcomes, payout records linked to your wallet</td>
                <td>Prediction market settlement, payout processing, leaderboard</td>
              </tr>
              <tr>
                <td>Dispute Records</td>
                <td>Dispute filings, deposit amounts, resolution outcomes linked to your wallet</td>
                <td>Dispute resolution process, admin review</td>
              </tr>
              <tr>
                <td>Session Tokens</td>
                <td>Cryptographic session (Ed25519 SIWS)</td>
                <td>Maintain login state</td>
              </tr>
              <tr>
                <td>Push Token</td>
                <td>Expo push token (device identifier)</td>
                <td>Sending news alerts and breaking news notifications</td>
              </tr>
              <tr>
                <td>Bookmarks</td>
                <td>Articles you save</td>
                <td>Saved articles feature</td>
              </tr>
              <tr>
                <td>SKR Transactions</td>
                <td>On-chain tx signatures for paid features</td>
                <td>Verifying stake, dispute deposit, and boost payments</td>
              </tr>
              <tr>
                <td>User Feedback</td>
                <td>Bug reports and suggestions you submit, linked to your wallet address</td>
                <td>Product improvement, support</td>
              </tr>
            </tbody>
          </table>

          <h2>3. What We Do NOT Collect</h2>
          <ul>
            <li>Private keys or seed phrases — ever</li>
            <li>Email addresses (not required to use Chainshorts)</li>
            <li>Phone numbers or real-world identity</li>
            <li>Credit card or payment information</li>
            <li>Location data</li>
          </ul>

          <h2>4. How We Use Your Information</h2>
          <p>We use collected information to:</p>
          <ul>
            <li>Authenticate your wallet session using SIWS (Sign-In With Solana)</li>
            <li>Display reaction counts and community sentiment on articles</li>
            <li>Send push notifications for breaking news and threat alerts</li>
            <li>Process prediction market stakes, settlements, and SKR payouts</li>
            <li>Manage dispute filings and freeze payouts during active disputes</li>
            <li>Verify SKR payments for deep-dive reports, content boosts, and disputes</li>
            <li>Respond to user feedback and improve the product</li>
            <li>Improve quality and reliability via anonymised usage telemetry</li>
          </ul>

          <h2>5. Third-Party Services</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Purpose</th>
                <th>Data Shared</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Railway</td>
                <td>API and worker hosting</td>
                <td>None beyond hosting</td>
              </tr>
              <tr>
                <td>Supabase / PostgreSQL</td>
                <td>Database</td>
                <td>All stored data above</td>
              </tr>
              <tr>
                <td>Content Processing Providers</td>
                <td>Article formatting and quality services</td>
                <td>Article text (no wallet session data)</td>
              </tr>
              <tr>
                <td>Helius</td>
                <td>Solana RPC and webhook events</td>
                <td>On-chain tx data (public)</td>
              </tr>
              <tr>
                <td>Expo Push</td>
                <td>Push notification delivery</td>
                <td>Push token + notification payload</td>
              </tr>
              <tr>
                <td>CoinGecko</td>
                <td>Token price data for prediction market resolution</td>
                <td>None (public API, read-only)</td>
              </tr>
              <tr>
                <td>Jupiter</td>
                <td>In-app token swap routing</td>
                <td>Swap parameters (no wallet private data)</td>
              </tr>
            </tbody>
          </table>

          <h2>6. Data Retention</h2>
          <p>
            Session tokens expire after 30 days of inactivity. Reactions are retained
            indefinitely as part of the community record. Prediction stake and payout
            records are retained indefinitely for audit and dispute purposes. Unclaimed
            payouts expire 30 days after settlement — after this point the payout record
            is retained but marked expired and no SKR transfer will occur. User feedback
            is retained until deletion is requested. You may request deletion of your
            off-chain data at any time.
          </p>

          <h2>7. Security</h2>
          <p>
            Our database enforces Row-Level Security (RLS) policies that restrict data
            access to authenticated sessions only. Your wallet data is never accessible to
            other users. All financial operations (staking, payouts, disputes) are protected
            by atomic database transactions.
          </p>

          <h2>8. Your Rights</h2>
          <ul>
            <li>Request a copy of all data we hold about your wallet address</li>
            <li>Request deletion of your off-chain data (reactions, bookmarks, feedback)</li>
            <li>Revoke all active sessions via the app Settings screen</li>
            <li>Disable push notifications at any time from Settings</li>
            <li>Note: prediction stake and payout records cannot be deleted as they are
              required for financial audit and dispute resolution</li>
          </ul>

          <h2>9. Children&apos;s Privacy</h2>
          <p>
            Chainshorts is not intended for users under 18 years of age. We do not knowingly
            collect data from minors.
          </p>

          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Updates will be posted at
            chainshorts.live/privacy-policy with a revised date. Continued use after changes
            constitutes acceptance.
          </p>

          <h2>11. Contact</h2>
          <p>
            For privacy questions or data requests:{" "}
            <a href="mailto:privacy@chainshorts.live">privacy@chainshorts.live</a>
          </p>
        </div>

        {/* Back link */}
        <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm"
            style={{ color: "var(--color-muted)" }}
          >
            <Zap size={14} style={{ color: "var(--color-ember)" }} />
            Back to Chainshorts
          </Link>
        </div>
      </div>
    </main>
  );
}
