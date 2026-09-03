"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OrdersTab from "./orders-tab";
import ReceivingAccountsTab from "./receiving-accounts-tab";
import MerchantsTab from "./merchants-tab";
import SmsLogTab from "./sms-log-tab";

type Tab = "orders" | "accounts" | "merchants" | "sms";

const TABS: { id: Tab; label: string }[] = [
  { id: "orders", label: "Orders" },
  { id: "accounts", label: "Receiving numbers" },
  { id: "merchants", label: "Merchants" },
  { id: "sms", label: "SMS log" },
];

export default function DashboardClient({ adminEmail }: { adminEmail: string }) {
  const [tab, setTab] = useState<Tab>("orders");
  const router = useRouter();

  async function handleLogout() {
    document.cookie = "admin_session=; Max-Age=0; path=/";
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100vh" }}>
      <header
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--line)", background: "var(--paper)" }}
      >
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            Gateway Admin
          </p>
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            {adminEmail}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm px-3 py-1.5 rounded-lg"
          style={{ border: "1px solid var(--line)", color: "var(--ink-soft)" }}
        >
          Sign out
        </button>
      </header>

      <nav className="px-5 pt-4 flex gap-1 overflow-x-auto" style={{ background: "var(--background)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3.5 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap"
            style={{
              background: tab === t.id ? "var(--paper)" : "transparent",
              color: tab === t.id ? "var(--teal)" : "var(--ink-soft)",
              border: tab === t.id ? "1px solid var(--line)" : "1px solid transparent",
              borderBottom: tab === t.id ? "1px solid var(--paper)" : "none",
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main
        className="p-5"
        style={{ background: "var(--paper)", borderTop: "1px solid var(--line)" }}
      >
        {tab === "orders" && <OrdersTab />}
        {tab === "accounts" && <ReceivingAccountsTab />}
        {tab === "merchants" && <MerchantsTab />}
        {tab === "sms" && <SmsLogTab />}
      </main>
    </div>
  );
}
