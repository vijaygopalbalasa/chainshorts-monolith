"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Zap } from "lucide-react";

export default function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const onHomePage = pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = open ? "hidden" : previousOverflow || "";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const links = [
    { label: "Platform", sectionId: "platform" },
    { label: "Resolution", sectionId: "resolution" },
    { label: "Advertise", href: "https://advertiser.chainshorts.live" },
    { label: "Download", sectionId: "download" },
  ];

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(246, 248, 251, 0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? "1px solid var(--color-border)" : "1px solid transparent",
      }}
      role="banner"
    >
      <nav className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between" aria-label="Primary">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #1d4ed8, #0d9488)" }}
          >
            <Zap size={16} fill="white" strokeWidth={0} />
          </div>
          <span
            className="text-base font-bold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
          >
            Chainshorts
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <li key={l.sectionId ?? l.href}>
              <a
                href={l.href ?? (onHomePage ? `#${l.sectionId}` : `/#${l.sectionId}`)}
                target={l.href ? "_blank" : undefined}
                rel={l.href ? "noopener noreferrer" : undefined}
                className="text-sm transition-colors duration-200 hover:text-[var(--color-text)] focus-visible:text-[var(--color-text)] focus-visible:outline-none"
                style={{ color: "var(--color-muted)" }}
              >
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
            className="text-sm px-4 py-2 rounded-lg border transition-colors duration-200 hover:text-[var(--color-text)] focus-visible:text-[var(--color-text)] focus-visible:outline-none"
            style={{
              color: "var(--color-muted)",
              borderColor: "var(--color-border)",
            }}
          >
            GitHub
          </a>
          <a
            href={onHomePage ? "#download" : "/#download"}
            className="text-sm px-4 py-2 rounded-lg font-semibold transition-all duration-200 hover:brightness-110 focus-visible:brightness-110 focus-visible:outline-none"
            style={{
              background: "var(--color-violet)",
              color: "#fff",
            }}
          >
            Get the App
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 rounded-lg"
          style={{ color: "var(--color-muted)" }}
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
          aria-controls="mobile-nav-links"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div
          id="mobile-nav-links"
          className="md:hidden border-t"
          style={{
            background: "rgba(246, 248, 251, 0.99)",
            borderColor: "var(--color-border)",
          }}
        >
          <ul className="max-w-6xl mx-auto px-5 py-4 flex flex-col gap-4">
            {links.map((l) => (
              <li key={l.sectionId ?? l.href}>
                <a
                  href={l.href ?? (onHomePage ? `#${l.sectionId}` : `/#${l.sectionId}`)}
                  target={l.href ? "_blank" : undefined}
                  rel={l.href ? "noopener noreferrer" : undefined}
                  className="block text-sm py-2"
                  style={{ color: "var(--color-muted)" }}
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={onHomePage ? "#download" : "/#download"}
                className="block text-sm py-2.5 px-4 rounded-lg text-center font-semibold"
                style={{ background: "var(--color-violet)", color: "#fff" }}
                onClick={() => setOpen(false)}
              >
                Get the App
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
