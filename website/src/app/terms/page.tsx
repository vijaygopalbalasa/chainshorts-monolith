import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { Zap, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service — Chainshorts",
  description: "Chainshorts terms of service.",
};

export default function Terms() {
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
            Terms of Service
          </h1>
          <p className="text-sm" style={{ color: "var(--color-dim)" }}>
            Last updated: March 1, 2026
          </p>
        </div>

        {/* Warning callout */}
        <div
          className="flex gap-3 p-4 rounded-xl mb-8"
          style={{
            background: "rgba(240,90,40,0.08)",
            border: "1px solid rgba(240,90,40,0.25)",
          }}
        >
          <AlertTriangle size={16} style={{ color: "var(--color-ember)", flexShrink: 0, marginTop: 2 }} />
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            <strong style={{ color: "var(--color-text)" }}>Important: </strong>
            By using Chainshorts you agree to these terms. Chainshorts provides news
            summarization and community features — not financial advice. Crypto assets are
            volatile. Prediction markets involve real SKR tokens. Never stake more than you
            can afford to lose.
          </p>
        </div>

        <div className="legal-prose">
          <h2>1. Service Description</h2>
          <p>
            Chainshorts is a mobile application that aggregates and summarizes cryptocurrency
            and Web3 news. It provides community reaction features, prediction markets,
            and threat alerts based on on-chain data. All content is informational only and
            does not constitute financial, investment, or legal advice.
          </p>

          <h2>2. Eligibility</h2>
          <p>
            You must be at least 18 years old to use Chainshorts. By using the app you
            represent that you meet this requirement and are not prohibited from using
            blockchain applications in your jurisdiction.
          </p>

          <h2>3. Wallet Authentication</h2>
          <p>
            Chainshorts uses Sign-In With Solana (SIWS) for authentication. You authenticate
            by signing a challenge message with your Solana wallet. We never have access to
            your private keys. You are responsible for maintaining control of your wallet.
          </p>

          <h2>4. SKR Token Economy</h2>
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>SKR Required</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Free</td>
                <td>0 SKR</td>
                <td>Full news feed, reactions, prediction markets</td>
              </tr>
              <tr>
                <td>Signal</td>
                <td>100 SKR held</td>
                <td>Alpha feed, threat feed, priority alerts</td>
              </tr>
              <tr>
                <td>Alpha</td>
                <td>500 SKR held</td>
                <td>Signal + enhanced analytics</td>
              </tr>
              <tr>
                <td>Pro</td>
                <td>2,000 SKR held</td>
                <td>All features + API access + dev feed</td>
              </tr>
            </tbody>
          </table>
          <p>
            SKR token balances are read from the Solana blockchain. Chainshorts does not
            sell, issue, or guarantee the value of SKR tokens. Tier access may change if
            your balance changes.
          </p>

          <h2>5. Paid Features</h2>
          <p>
            Certain features require spending SKR tokens (Deep-Dive Reports: 100 SKR;
            Content Boosts: 50 SKR). Payments are on-chain transactions verified by our
            API. SKR payments are non-refundable once the transaction is confirmed on-chain.
          </p>

          <h2>6. Prediction Markets</h2>
          <p>
            Chainshorts prediction markets allow users to stake SKR on yes/no outcomes
            of crypto events. By participating you acknowledge:
          </p>
          <ul>
            <li>Stakes are real SKR tokens sent on-chain — they are at risk</li>
            <li>Markets are resolved by automated verification — outcomes are final unless successfully disputed</li>
            <li>Payouts become claimable 48 hours after market settlement</li>
            <li>Unclaimed payouts expire 30 days after settlement — expired payouts cannot be recovered</li>
            <li>Early cashout incurs a 5% penalty with a minimum of 10 SKR payout</li>
            <li>Market cancellations result in full SKR refunds to all stakers</li>
          </ul>

          <h2>7. Dispute Process</h2>
          <p>
            If you believe a market was resolved incorrectly, you may file a dispute within
            48 hours of settlement. Disputes require a 50 SKR deposit. During active dispute
            review, all payouts for that market are frozen. Dispute outcomes:
          </p>
          <ul>
            <li><strong>Upheld:</strong> Market is re-resolved, payouts recalculated, deposit returned</li>
            <li><strong>Rejected:</strong> Original resolution stands, dispute deposit is forfeited</li>
          </ul>
          <p>
            Dispute decisions by our admin team are final. We reserve the right to resolve
            disputes based on available on-chain and off-chain evidence.
          </p>

          <h2>8. Content Accuracy</h2>
          <p>
            News summaries may contain errors or omissions. We run quality verification checks
            but cannot guarantee 100% accuracy. Always
            verify important information from primary sources before making decisions.
          </p>

          <h2>9. On-Chain Reactions</h2>
          <p>
            Reactions are signed by your wallet and stored on our servers (not on-chain).
            These are linked to your wallet address and visible within the app.
            One wallet = one reaction per article.
          </p>

          <h2>10. Threat Alerts</h2>
          <p>
            Threat alerts are derived from on-chain data and are informational only. They
            do not constitute trading signals or investment advice. Past alert accuracy does
            not guarantee future performance.
          </p>

          <h2>11. User Feedback</h2>
          <p>
            You may submit bug reports or suggestions via the app. Feedback is stored linked
            to your wallet address and reviewed by our team. By submitting feedback you grant
            us a perpetual licence to use the content to improve the service.
          </p>

          <h2>12. Acceptable Use</h2>
          <ul>
            <li>Do not attempt to manipulate reaction counts or prediction markets</li>
            <li>Do not use the API to scrape or redistribute content at scale</li>
            <li>Do not submit or boost misleading or harmful content</li>
            <li>Do not attempt to reverse-engineer our security measures</li>
            <li>Do not file frivolous disputes to freeze other users&apos; payouts</li>
          </ul>

          <h2>13. Disclaimers</h2>
          <p>
            Chainshorts is provided "as is" without warranties of any kind. We do not
            guarantee uninterrupted service, data accuracy, or that the app will be free
            of errors. Prediction market outcomes and automated resolutions may be incorrect.
            Content may be inaccurate, incomplete, or outdated.
          </p>

          <h2>14. Limitation of Liability</h2>
          <p>
            Chainshorts shall not be liable for any financial losses, missed opportunities,
            or other damages arising from use of the app, reliance on its content, or
            participation in prediction markets. Our total liability to you shall not exceed
            $100 USD.
          </p>

          <h2>15. Changes to Terms</h2>
          <p>
            We may update these terms at any time. Updates are posted at
            chainshorts.live/terms with a revised date. Continued use constitutes acceptance.
          </p>

          <h2>16. Contact</h2>
          <p>
            Questions: <a href="mailto:legal@chainshorts.live">legal@chainshorts.live</a>
          </p>
        </div>

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
