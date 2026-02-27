"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";

/* ─── Nav ─── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links = [
    { label: "FEATURES", href: "#features" },
    { label: "PREDICT", href: "#predict" },
    { label: "EARN", href: "#earn" },
  ];

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(7, 11, 15, 0.96)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(20, 241, 149, 0.12)" : "1px solid transparent",
      }}
      role="banner"
    >
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8"
        aria-label="Primary"
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group" aria-label="Chainshorts home">
          <Image
            src="/logo.png"
            alt="Chainshorts"
            width={36}
            height={36}
            className="rounded-sm"
            priority
          />
          <span
            className="text-sm font-bold tracking-widest uppercase"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            CHAINSHORTS
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="nav-link">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="https://github.com/vijaygopalbalasa/chainshorts"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            GITHUB
          </a>
          <a
            href="#download"
            className="btn-green"
            style={{ padding: "8px 18px", fontSize: "12px" }}
          >
            GET THE APP
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2"
          style={{ color: "var(--color-green)" }}
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div
          className="md:hidden border-t"
          style={{
            background: "rgba(7, 11, 15, 0.98)",
            borderColor: "rgba(20, 241, 149, 0.15)",
          }}
        >
          <ul className="mx-auto max-w-6xl flex flex-col gap-0 px-5">
            {links.map((l) => (
              <li key={l.href} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                <a
                  href={l.href}
                  className="block py-4 text-sm font-mono tracking-widest uppercase"
                  style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li className="py-4">
              <a
                href="#download"
                className="btn-green w-full text-center"
                style={{ display: "block" }}
                onClick={() => setOpen(false)}
              >
                GET THE APP
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}

/* ─── Animated stat counter ─── */
function StatCounter({ target, suffix = "" }: { target: number | string; suffix?: string }) {
  const [display, setDisplay] = useState("0");
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (typeof target === "string") {
      setDisplay(target);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const duration = 1200;
          const steps = 40;
          const increment = target / steps;
          let current = 0;
          const timer = setInterval(() => {
            current = Math.min(current + increment, target);
            setDisplay(Math.floor(current).toString());
            if (current >= target) clearInterval(timer);
          }, duration / steps);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

/* ─── Phone mockup ─── */
function PhoneMockup() {
  const [activeTab, setActiveTab] = useState<"feed" | "predict">("feed");

  return (
    <div
      className="phone-mockup relative mx-auto w-full max-w-xs"
      style={{ borderRadius: "4px", overflow: "hidden" }}
    >
      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          background: "#0A0E13",
          borderBottom: "1px solid var(--color-border)",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--color-dim)",
        }}
      >
        <span>09:41</span>
        <div className="flex items-center gap-1">
          <span style={{ color: "var(--color-green)" }}>CHAINSHORTS</span>
        </div>
        <span>SOL</span>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b"
        style={{ borderColor: "var(--color-border)", background: "#0A0E13" }}
      >
        {(["feed", "predict"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2.5 text-center"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: activeTab === tab ? "var(--color-green)" : "var(--color-dim)",
              background: "transparent",
              cursor: "pointer",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--color-green)" : "2px solid transparent",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "feed" ? (
        <div className="p-4 space-y-3" style={{ background: "var(--color-surface)", minHeight: "280px" }}>
          {/* Breaking badge */}
          <div className="flex items-center gap-2">
            <div className="live-dot" style={{ width: "6px", height: "6px" }} />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "9px",
                color: "var(--color-green)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              BREAKING
            </span>
          </div>
          {/* Article card */}
          <div
            className="p-3"
            style={{
              border: "1px solid rgba(20, 241, 149, 0.20)",
              background: "rgba(20, 241, 149, 0.03)",
              borderLeft: "2px solid var(--color-green)",
            }}
          >
            <p
              className="font-bold leading-tight"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                color: "var(--color-text)",
                marginBottom: "8px",
              }}
            >
              Bitcoin hits $100K as spot ETF inflows surge past $2B in 24 hours
            </p>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "11px",
                color: "var(--color-muted)",
                lineHeight: "1.6",
              }}
            >
              Institutional demand accelerates as BlackRock's IBIT records single-day record.
              Analysts cite Fed pause as catalyst. Altcoins rally on risk-on sentiment.
            </p>
            <div
              className="mt-2 flex items-center gap-2"
              style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--color-dim)" }}
            >
              <span>CoinDesk</span>
              <span>·</span>
              <span>2m ago</span>
              <span>·</span>
              <span style={{ color: "var(--color-green)" }}>60 WORDS</span>
            </div>
          </div>
          {/* Second article stub */}
          <div
            className="p-3"
            style={{
              border: "1px solid var(--color-border)",
              background: "transparent",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                color: "var(--color-text)",
                fontWeight: 600,
                marginBottom: "6px",
              }}
            >
              Solana DEX volume overtakes Ethereum for third consecutive week
            </p>
            <div
              className="flex items-center gap-2"
              style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--color-dim)" }}
            >
              <span>The Block</span>
              <span>·</span>
              <span>8m ago</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3" style={{ background: "var(--color-surface)", minHeight: "280px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              color: "var(--color-dim)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            ACTIVE MARKET
          </div>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--color-text)",
              lineHeight: "1.4",
            }}
          >
            Will BTC close above $100K this week?
          </p>
          {/* YES bar */}
          <div style={{ marginTop: "12px" }}>
            <div className="flex justify-between mb-1">
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-green)" }}>
                YES
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-green)" }}>
                48%
              </span>
            </div>
            <div style={{ height: "6px", background: "var(--color-border)", borderRadius: "0" }}>
              <div
                style={{
                  height: "100%",
                  width: "48%",
                  background: "var(--color-green)",
                  transition: "width 0.6s ease",
                }}
              />
            </div>
          </div>
          {/* NO bar */}
          <div>
            <div className="flex justify-between mb-1">
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-muted)" }}>
                NO
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-muted)" }}>
                52%
              </span>
            </div>
            <div style={{ height: "6px", background: "var(--color-border)", borderRadius: "0" }}>
              <div
                style={{
                  height: "100%",
                  width: "52%",
                  background: "var(--color-muted)",
                  opacity: 0.4,
                }}
              />
            </div>
          </div>
          {/* Pool info */}
          <div
            className="flex items-center justify-between mt-3 pt-3"
            style={{
              borderTop: "1px solid var(--color-border)",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
            }}
          >
            <span style={{ color: "var(--color-dim)" }}>POOL</span>
            <span style={{ color: "var(--color-green)" }}>48,240 SKR</span>
          </div>
          {/* Stake button */}
          <div className="mt-3">
            <div
              className="text-center py-2"
              style={{
                background: "var(--color-green)",
                color: "#070B0F",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
              }}
            >
              STAKE SKR
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav stub */}
      <div
        className="flex border-t"
        style={{
          borderColor: "var(--color-border)",
          background: "#0A0E13",
        }}
      >
        {["Feed", "Predict", "Swap", "Wallet"].map((tab, i) => (
          <div
            key={tab}
            className="flex-1 py-3 text-center"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "8px",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: i === 0 ? "var(--color-green)" : "var(--color-dim)",
            }}
          >
            {tab}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Ticker ─── */
function Ticker() {
  const items = [
    { symbol: "SOL", change: "+8.2%", up: true },
    { symbol: "BTC", change: "+3.1%", up: true },
    { symbol: "ETH", change: "-0.5%", up: false },
    { symbol: "SKR", change: "+12.4%", up: true },
    { symbol: "JUP", change: "+5.7%", up: true },
    { symbol: "RAY", change: "-1.2%", up: false },
    { symbol: "BONK", change: "+18.3%", up: true },
    { symbol: "WIF", change: "+6.9%", up: true },
  ];

  const repeatedItems = [...items, ...items, ...items, ...items];

  return (
    <div
      className="overflow-hidden py-3 relative"
      style={{
        background: "rgba(20, 241, 149, 0.04)",
        borderTop: "1px solid rgba(20, 241, 149, 0.10)",
        borderBottom: "1px solid rgba(20, 241, 149, 0.10)",
      }}
    >
      <div className="ticker-track">
        {repeatedItems.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2 px-6"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", whiteSpace: "nowrap" }}
          >
            <span style={{ color: "var(--color-muted)" }}>{item.symbol}</span>
            <span style={{ color: item.up ? "var(--color-green)" : "#FF4757" }}>
              {item.change}
            </span>
            <span style={{ color: "var(--color-border)", margin: "0 4px" }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Three pillars ─── */
function PillarCard({
  number,
  icon,
  title,
  description,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="pillar-card p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "48px",
            fontWeight: 700,
            color: "rgba(20, 241, 149, 0.12)",
            lineHeight: 1,
          }}
        >
          {number}
        </span>
        <div
          className="flex h-10 w-10 items-center justify-center"
          style={{
            border: "1px solid rgba(20, 241, 149, 0.20)",
            background: "rgba(20, 241, 149, 0.06)",
            color: "var(--color-green)",
          }}
        >
          {icon}
        </div>
      </div>
      <div>
        <h3
          className="font-bold uppercase tracking-wider"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "13px",
            color: "var(--color-green)",
            marginBottom: "8px",
            letterSpacing: "0.12em",
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            color: "var(--color-muted)",
            lineHeight: "1.75",
          }}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

/* ─── How it works step ─── */
function HowStep({
  num,
  title,
  description,
  isLast,
}: {
  num: string;
  title: string;
  description: string;
  isLast?: boolean;
}) {
  return (
    <div className={`relative flex flex-col items-center text-center ${!isLast ? "step-connector" : ""}`}>
      <div
        className="flex h-10 w-10 items-center justify-center mb-4"
        style={{
          border: "1px solid rgba(20, 241, 149, 0.35)",
          background: "rgba(20, 241, 149, 0.06)",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--color-green)",
        }}
      >
        {num}
      </div>
      <h3
        className="font-bold uppercase tracking-wider mb-2"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "11px",
          color: "var(--color-text)",
          letterSpacing: "0.14em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--color-muted)",
          lineHeight: "1.65",
          maxWidth: "160px",
        }}
      >
        {description}
      </p>
    </div>
  );
}

/* ─── Main page ─── */
export default function Home() {
  return (
    <main id="main-content" tabIndex={-1} style={{ background: "var(--color-bg)" }}>
      <Nav />

      {/* ── HERO ── */}
      <section
        className="relative overflow-hidden scanline-overlay"
        style={{ paddingTop: "96px", paddingBottom: "80px", minHeight: "100vh" }}
      >
        {/* Dot grid */}
        <div
          className="pointer-events-none absolute inset-0 dot-grid"
          style={{ opacity: 0.6 }}
        />

        {/* Radial glows */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: "-10%",
            left: "-5%",
            width: "60%",
            height: "70%",
            background: "radial-gradient(ellipse, rgba(20, 241, 149, 0.07) 0%, transparent 65%)",
          }}
        />
        <div
          className="pointer-events-none absolute"
          style={{
            bottom: "-10%",
            right: "-5%",
            width: "50%",
            height: "60%",
            background: "radial-gradient(ellipse, rgba(153, 69, 255, 0.06) 0%, transparent 60%)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* Left: Text */}
            <div>
              {/* Badge */}
              <div className="section-badge mb-8 inline-flex">
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    background: "var(--color-green)",
                    borderRadius: "50%",
                    marginRight: "6px",
                    animation: "green-ping 1.5s infinite",
                  }}
                />
                BUILT FOR SEEKER
              </div>

              {/* Main headline */}
              <h1
                className="leading-none mb-6"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  color: "var(--color-green)",
                }}
              >
                <span
                  className="block"
                  style={{ fontSize: "clamp(48px, 8vw, 88px)", lineHeight: "1.0" }}
                >
                  CRYPTO NEWS
                </span>
                <span
                  className="block"
                  style={{ fontSize: "clamp(48px, 8vw, 88px)", lineHeight: "1.0" }}
                >
                  IN 60 WORDS.
                </span>
                <span
                  className="block"
                  style={{
                    fontSize: "clamp(48px, 8vw, 88px)",
                    lineHeight: "1.0",
                    color: "var(--color-text)",
                  }}
                >
                  PREDICT. WIN.
                  <span className="cursor-blink" aria-hidden="true">_</span>
                </span>
              </h1>

              {/* Sub headline */}
              <p
                className="mb-8 max-w-lg"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "16px",
                  color: "var(--color-muted)",
                  lineHeight: "1.75",
                }}
              >
                26+ sources. Real-time markets. SKR rewards.{" "}
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                  No noise — just signal.
                </span>
              </p>

              {/* CTAs */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://github.com/vijaygopalbalasa/chainshorts/releases/latest/download/chainshorts-dapp-store.apk"
                  className="btn-green"
                >
                  [ DOWNLOAD APK ]
                </a>
                <a
                  href="https://dapp.solanamobile.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline"
                >
                  [ DAPP STORE ]
                </a>
              </div>

              {/* Trust line */}
              <div
                className="mt-8 flex flex-wrap items-center gap-4"
                style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-dim)" }}
              >
                <span>✓ SOLANA MOBILE NATIVE</span>
                <span>✓ NO ACCOUNT NEEDED</span>
                <span>✓ WALLET-VERIFIED REACTIONS</span>
              </div>
            </div>

            {/* Right: Phone mockup */}
            <div className="flex justify-center lg:justify-end">
              <div style={{ width: "100%", maxWidth: "320px" }}>
                <PhoneMockup />
                <p
                  className="mt-3 text-center"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--color-dim)",
                    letterSpacing: "0.10em",
                  }}
                >
                  INTERACTIVE PREVIEW — TAP TO SWITCH
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TICKER ── */}
      <Ticker />

      {/* ── THREE PILLARS ── */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          {/* Header */}
          <div className="mb-12">
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--color-green)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              // WHAT YOU GET
            </p>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 4vw, 42px)",
                fontWeight: 700,
                color: "var(--color-text)",
                lineHeight: "1.15",
              }}
            >
              INTELLIGENCE. MARKETS. REWARDS.
            </h2>
          </div>

          {/* Cards */}
          <div className="grid gap-5 lg:grid-cols-3">
            <PillarCard
              number="01"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              }
              title="SIGNAL FEED"
              description="60-word crypto intelligence from 26+ sources. Browse, filter by category, search, bookmark. No wallet required to read."
            />
            <PillarCard
              number="02"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              }
              title="PREDICTION MARKETS"
              description="Stake SKR on YES/NO outcomes. Early cashout with 5% penalty. 48h settlement window. Dispute incorrect resolutions with deposit-backed evidence."
            />
            <PillarCard
              number="03"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              }
              title="SKR ECONOMY"
              description="Win predictions to earn SKR. Track your P&L on the leaderboard. Swap SOL/USDC/USDT/SKR via Jupiter in-app with 1% platform fee."
            />
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <section
        style={{
          background: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-12">
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
            {[
              { value: 26, suffix: "+", label: "Sources" },
              { value: 60, suffix: "", label: "Words per story" },
              { value: "48h", suffix: "", label: "Payout window" },
              { value: 0, suffix: "", label: "Login required" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div
                  className="stat-number mb-2"
                  style={{ fontSize: "clamp(36px, 5vw, 56px)" }}
                >
                  <StatCounter target={stat.value} suffix={stat.suffix} />
                </div>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--color-dim)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PREDICT SECTION ── */}
      <section id="predict" className="py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 items-center">
            {/* Left: market card illustration */}
            <div>
              {/* Section label */}
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--color-green)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                }}
              >
                // PREDICTION MARKETS
              </p>
              <h2
                className="mb-6"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(24px, 3.5vw, 40px)",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  lineHeight: "1.15",
                }}
              >
                NEWS DRIVES MARKETS.<br />MARKETS REWARD SIGNAL.
              </h2>
              <p
                className="mb-8"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "15px",
                  color: "var(--color-muted)",
                  lineHeight: "1.75",
                }}
              >
                Every article you read is a data point. Use that edge to stake SKR
                on YES/NO outcomes. Win markets, claim payouts, climb the leaderboard.
              </p>

              <div className="space-y-4">
                {[
                  { label: "Active markets", value: "159+" },
                  { label: "Settlement window", value: "48 hours" },
                  { label: "Dispute protection", value: "50 SKR deposit" },
                  { label: "Early cashout", value: "5% penalty" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between py-3 px-4"
                    style={{
                      border: "1px solid var(--color-border)",
                      borderLeft: "2px solid rgba(20, 241, 149, 0.30)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--color-dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.10em",
                      }}
                    >
                      {row.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                        color: "var(--color-green)",
                        fontWeight: 700,
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: market card mock */}
            <div>
              <div
                className="terminal-card p-6"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between pb-4 mb-4"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="live-dot" />
                    <span style={{ fontSize: "10px", color: "var(--color-green)", letterSpacing: "0.14em" }}>
                      LIVE MARKET
                    </span>
                  </div>
                  <span style={{ fontSize: "10px", color: "var(--color-dim)" }}>
                    CLOSES IN 6H 23M
                  </span>
                </div>

                <h3
                  className="mb-5"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--color-text)",
                    lineHeight: "1.4",
                  }}
                >
                  Will SOL flip ETH in market cap by end of Q1 2026?
                </h3>

                {/* Probability bars */}
                {[
                  { label: "YES", pct: 63, green: true },
                  { label: "NO", pct: 37, green: false },
                ].map((bar) => (
                  <div key={bar.label} className="mb-3">
                    <div
                      className="flex justify-between mb-1.5"
                      style={{ fontSize: "11px" }}
                    >
                      <span style={{ color: bar.green ? "var(--color-green)" : "var(--color-muted)" }}>
                        {bar.label}
                      </span>
                      <span style={{ color: bar.green ? "var(--color-green)" : "var(--color-muted)" }}>
                        {bar.pct}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: "0",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${bar.pct}%`,
                          height: "100%",
                          background: bar.green ? "var(--color-green)" : "rgba(139, 163, 160, 0.30)",
                        }}
                      />
                    </div>
                  </div>
                ))}

                {/* Pool + stakers */}
                <div
                  className="grid grid-cols-3 gap-3 mt-5 pt-4"
                  style={{ borderTop: "1px solid var(--color-border)" }}
                >
                  {[
                    { label: "POOL", value: "124,840 SKR" },
                    { label: "STAKERS", value: "341" },
                    { label: "MY STAKE", value: "500 YES" },
                  ].map((s) => (
                    <div key={s.label}>
                      <p style={{ fontSize: "9px", color: "var(--color-dim)", marginBottom: "4px", letterSpacing: "0.12em" }}>
                        {s.label}
                      </p>
                      <p style={{ fontSize: "11px", color: "var(--color-text)", fontWeight: 600 }}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div
                    className="text-center py-2.5"
                    style={{
                      background: "var(--color-green)",
                      color: "#070B0F",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.10em",
                      cursor: "pointer",
                    }}
                  >
                    STAKE YES
                  </div>
                  <div
                    className="text-center py-2.5"
                    style={{
                      border: "1px solid var(--color-border)",
                      color: "var(--color-muted)",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.10em",
                      cursor: "pointer",
                    }}
                  >
                    STAKE NO
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section
        id="earn"
        className="py-24"
        style={{
          background: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="mb-12 text-center">
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--color-green)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              // HOW IT WORKS
            </p>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(24px, 3.5vw, 40px)",
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              FIVE STEPS. ZERO FRICTION.
            </h2>
          </div>

          {/* Steps */}
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { num: "01", title: "INSTALL", desc: "Download from Solana dApp Store or direct APK. Android only." },
              { num: "02", title: "READ", desc: "Browse 60-word summaries. Filter by category. Bookmark." },
              { num: "03", title: "CONNECT", desc: "Link your Seeker wallet via Mobile Wallet Adapter." },
              { num: "04", title: "PREDICT", desc: "Stake SKR on YES/NO markets. Cashout anytime with 5% fee." },
              { num: "05", title: "WIN", desc: "Claim payouts after 48h settlement. Top the leaderboard.", isLast: true },
            ].map((step) => (
              <HowStep
                key={step.num}
                num={step.num}
                title={step.title}
                description={step.desc}
                isLast={step.isLast}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── LEADERBOARD PREVIEW ── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 items-start">
            {/* Left: text */}
            <div>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--color-green)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                }}
              >
                // LEADERBOARD
              </p>
              <h2
                className="mb-6"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(24px, 3.5vw, 40px)",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  lineHeight: "1.15",
                }}
              >
                COMPETE FOR<br />THE TOP SPOT.
              </h2>
              <p
                className="mb-8"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "15px",
                  color: "var(--color-muted)",
                  lineHeight: "1.75",
                }}
              >
                Every correct prediction earns SKR and pushes you up the ranks.
                Sort by profit, win rate, or total volume. Your stats always visible inline.
              </p>
              <a href="#download" className="btn-green">
                START COMPETING
              </a>
            </div>

            {/* Right: fake leaderboard */}
            <div>
              <div
                className="terminal-card overflow-hidden"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {/* Table header */}
                <div
                  className="lb-row"
                  style={{
                    background: "rgba(20, 241, 149, 0.04)",
                    borderBottom: "1px solid rgba(20, 241, 149, 0.15)",
                  }}
                >
                  <span style={{ fontSize: "9px", color: "var(--color-dim)", letterSpacing: "0.14em" }}>RANK</span>
                  <span style={{ fontSize: "9px", color: "var(--color-dim)", letterSpacing: "0.14em" }}>WALLET</span>
                  <span style={{ fontSize: "9px", color: "var(--color-dim)", letterSpacing: "0.14em", textAlign: "right" }}>PROFIT</span>
                  <span style={{ fontSize: "9px", color: "var(--color-dim)", letterSpacing: "0.14em", textAlign: "right" }}>WIN %</span>
                </div>

                {/* Top rows */}
                {[
                  { rank: "#1", wallet: "7xKp...mN3f", profit: "+18,420 SKR", winRate: "76%", top: true },
                  { rank: "#2", wallet: "9rZt...Bq2w", profit: "+12,840 SKR", winRate: "71%", top: false },
                  { rank: "#3", wallet: "4hQm...Xv7k", profit: "+9,310 SKR", winRate: "68%", top: false },
                  { rank: "#4", wallet: "2nLs...Dp5e", profit: "+7,220 SKR", winRate: "65%", top: false },
                ].map((row, i) => (
                  <div
                    key={row.rank}
                    className="lb-row"
                    style={{
                      background: row.top ? "rgba(20, 241, 149, 0.04)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        color: row.top ? "var(--color-green)" : "var(--color-dim)",
                        fontWeight: row.top ? 700 : 400,
                      }}
                    >
                      {row.rank}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                      {row.wallet}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--color-green)",
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {row.profit}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text)",
                        textAlign: "right",
                      }}
                    >
                      {row.winRate}
                    </span>
                  </div>
                ))}

                {/* YOU row */}
                <div
                  className="lb-row"
                  style={{
                    background: "rgba(153, 69, 255, 0.08)",
                    borderTop: "1px solid rgba(153, 69, 255, 0.20)",
                    borderBottom: "none",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "var(--color-purple)", fontWeight: 700 }}>
                    #?
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-purple)" }}>
                    YOU
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-muted)", textAlign: "right" }}>
                    —
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-muted)", textAlign: "right" }}>
                    —
                  </span>
                </div>
              </div>

              {/* Filter pills */}
              <div className="mt-3 flex gap-2">
                {["ALL TIME", "THIS WEEK", "THIS MONTH"].map((pill, i) => (
                  <span
                    key={pill}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "9px",
                      letterSpacing: "0.12em",
                      padding: "4px 10px",
                      border: `1px solid ${i === 0 ? "rgba(20, 241, 149, 0.40)" : "var(--color-border)"}`,
                      color: i === 0 ? "var(--color-green)" : "var(--color-dim)",
                      background: i === 0 ? "rgba(20, 241, 149, 0.06)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CTA ── */}
      <section id="download" className="pb-24 pt-0">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div
            className="relative overflow-hidden p-8 sm:p-12"
            style={{
              background: "var(--color-surface)",
              border: "1px solid rgba(20, 241, 149, 0.20)",
              boxShadow: "0 0 80px rgba(20, 241, 149, 0.06), inset 0 1px 0 rgba(20, 241, 149, 0.06)",
            }}
          >
            {/* Background glow */}
            <div
              className="pointer-events-none absolute"
              style={{
                top: "-40%",
                right: "-10%",
                width: "50%",
                height: "200%",
                background: "radial-gradient(ellipse, rgba(20, 241, 149, 0.05) 0%, transparent 65%)",
              }}
            />

            <div className="relative z-10 grid gap-8 lg:grid-cols-2 items-center">
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--color-green)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    marginBottom: "12px",
                  }}
                >
                  // GET STARTED
                </p>
                <h2
                  className="mb-4"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(28px, 4vw, 48px)",
                    fontWeight: 700,
                    color: "var(--color-text)",
                    lineHeight: "1.1",
                  }}
                >
                  SIGNAL TO YOUR POCKET.
                </h2>
                <p
                  className="mb-8"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "15px",
                    color: "var(--color-muted)",
                    lineHeight: "1.75",
                    maxWidth: "440px",
                  }}
                >
                  Download the Android build for Seeker-ready usage. Or start
                  the advertiser workflow for feed and Predict placement inventory.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href="https://github.com/vijaygopalbalasa/chainshorts/releases/latest/download/chainshorts-dapp-store.apk"
                    className="btn-green"
                  >
                    DOWNLOAD APK
                  </a>
                  <a
                    href="https://advertiser.chainshorts.live"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline"
                  >
                    ADVERTISE
                  </a>
                </div>
              </div>

              {/* Feature bullets */}
              <div className="grid gap-3">
                {[
                  {
                    icon: "◎",
                    title: "SEEKER-NATIVE",
                    desc: "Mobile Wallet Adapter auth. No browser extension. No seed phrases exposed.",
                  },
                  {
                    icon: "⚡",
                    title: "REAL-TIME MARKETS",
                    desc: "159+ active prediction markets auto-generated from breaking news.",
                  },
                  {
                    icon: "◈",
                    title: "JUPITER SWAPS BUILT IN",
                    desc: "Swap SOL/USDC/USDT/SKR in-app via Jupiter. 1% platform fee funds rewards pool.",
                  },
                  {
                    icon: "◉",
                    title: "DISPUTE PROTECTION",
                    desc: "48h challenge window. Deposit-backed disputes. Admin-reviewed resolutions.",
                  },
                ].map((feat) => (
                  <div
                    key={feat.title}
                    className="flex gap-4 p-4"
                    style={{
                      border: "1px solid var(--color-border)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "18px",
                        color: "var(--color-green)",
                        lineHeight: 1,
                        flexShrink: 0,
                        marginTop: "1px",
                      }}
                    >
                      {feat.icon}
                    </span>
                    <div>
                      <p
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "10px",
                          color: "var(--color-text)",
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          marginBottom: "4px",
                        }}
                      >
                        {feat.title}
                      </p>
                      <p
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "13px",
                          color: "var(--color-muted)",
                          lineHeight: "1.6",
                        }}
                      >
                        {feat.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        style={{
          borderTop: "1px solid rgba(20, 241, 149, 0.15)",
          background: "var(--color-surface)",
          boxShadow: "0 -1px 0 rgba(20, 241, 149, 0.08)",
        }}
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: logo + built on */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-7 w-7 items-center justify-center text-xs font-bold"
                  style={{
                    background: "var(--color-green)",
                    color: "#070B0F",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  CS
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "12px",
                    color: "var(--color-text)",
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  CHAINSHORTS
                </span>
              </div>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--color-dim)",
                  letterSpacing: "0.10em",
                }}
              >
                BUILT ON SOLANA
              </p>
            </div>

            {/* Center links */}
            <div className="flex flex-wrap gap-5">
              {[
                { label: "Privacy Policy", href: "/privacy-policy" },
                { label: "Terms", href: "/terms" },
                { label: "Advertise", href: "https://advertiser.chainshorts.live" },
                { label: "GitHub", href: "https://github.com/vijaygopalbalasa/chainshorts" },
              ].map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--color-dim)",
                    textDecoration: "none",
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    transition: "color 0.2s ease",
                  }}
                  className="hover:text-[var(--color-green)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Right: copyright */}
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--color-dim)",
                letterSpacing: "0.08em",
              }}
            >
              © 2026 CHAINSHORTS
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
