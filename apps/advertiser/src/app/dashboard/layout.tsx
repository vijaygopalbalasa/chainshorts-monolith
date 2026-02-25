"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { getToken, getStoredUser, clearToken } from "@/lib/auth";
import { logout } from "@/lib/api";
import { LayoutDashboard, Megaphone, Receipt, Settings, LogOut } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/billing", label: "Billing", icon: Receipt },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function truncateAddress(addr: string): string {
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  useEffect(() => {
    setMounted(true);
    if (!getToken()) {
      router.replace("/login");
    }
  }, [router]);

  if (!mounted) return null;

  const handleLogout = async () => {
    const token = getToken();
    if (token) {
      try {
        await logout(token);
      } catch {
        // Logout is best-effort; clear local token regardless.
      }
    }
    clearToken();
    router.replace("/login");
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-gray-200 gap-2.5">
          <img src="/logo.png" alt="Chainshorts" className="w-7 h-7 rounded-lg" />
          <span className="font-semibold text-gray-900 text-sm">
            Chainshorts <span className="text-gray-400 font-normal">Advertisers</span>
          </span>
        </div>
        <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <div className="px-2 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Menu
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-green-50 text-green-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <item.icon size={18} className={isActive ? "text-green-600" : "text-gray-400"} />
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 mb-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold font-mono text-xs">
              {user?.walletAddress ? user.walletAddress.slice(0, 2) : "0x"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono font-medium text-gray-700 truncate">
                {user?.walletAddress ? truncateAddress(user.walletAddress) : "Unknown"}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Advertiser</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors"
          >
            <LogOut size={18} className="text-gray-400" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header (visible only on small screens) */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:hidden">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Chainshorts" className="w-7 h-7 rounded-lg" />
            <span className="font-semibold text-gray-900 text-sm">
              Chainshorts <span className="text-gray-400 font-normal">Advertisers</span>
            </span>
          </div>
          <button onClick={handleLogout} className="p-2 text-gray-500">
            <LogOut size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 pb-24 md:pb-8">
          {children}
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="grid grid-cols-3 gap-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                    isActive
                      ? "bg-green-50 text-green-700"
                      : "text-gray-500"
                  }`}
                >
                  <item.icon size={16} className={isActive ? "text-green-600" : "text-gray-400"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
