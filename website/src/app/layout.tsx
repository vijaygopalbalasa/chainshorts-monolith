import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#070B0F",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Chainshorts — Crypto News in 60 Words. Predict. Win.",
  description:
    "26+ sources. Real-time prediction markets. SKR rewards. No noise — just signal. Built for Solana Mobile Seeker.",
  keywords: ["crypto news", "solana", "web3", "60 words", "inshorts", "chainshorts", "SKR", "prediction markets", "seeker"],
  authors: [{ name: "Chainshorts" }],
  openGraph: {
    title: "Chainshorts — Crypto News in 60 Words. Predict. Win.",
    description:
      "26+ sources. Real-time prediction markets. SKR rewards. No noise — just signal.",
    url: "https://chainshorts.live",
    siteName: "Chainshorts",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Chainshorts" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chainshorts — Crypto News in 60 Words. Predict. Win.",
    description: "26+ sources. Real-time prediction markets. SKR rewards. No noise — just signal.",
    images: ["/og-image.png"],
  },
  metadataBase: new URL("https://chainshorts.live"),
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
