import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chainshorts Advertiser Portal",
  description: "Create and manage sponsored cards on the Chainshorts Web3 news feed",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="antialiased bg-white text-gray-900 selection:bg-green-100 selection:text-green-900">
      <body className="min-h-screen flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
