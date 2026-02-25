"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = getToken();
    router.replace(token ? "/dashboard" : "/login");
  }, [router]);
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <div style={{ color: "#14F195", fontFamily: "monospace" }}>Loading...</div>
    </div>
  );
}
