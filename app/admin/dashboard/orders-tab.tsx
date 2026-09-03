"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge, EmptyState, LoadingState } from "./ui";

interface Order {
  id: string;
  reference: string;
  merchant_name: string;
  amount_bdt: number;
  provider: string;
  receiving_msisdn: string;
  status: string;
  submitted_trx_id: string | null;
  created_at: string;
}

const FILTERS = ["ALL", "PENDING", "SUBMITTED", "APPROVED", "REJECTED", "EXPIRED"];

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = filter !== "ALL" ? `?status=${filter}` : "";
    const res = await fetch(`/api/admin/orders${qs}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setActingOn(id);
    try {
      const res = await fetch(`/api/admin/orders/${id}/${action}`, { method: "POST" });
      if (res.ok) await load();
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 text-xs font-medium rounded-full"
            style={{
              background: filter === f ? "var(--teal)" : "transparent",
              color: filter === f ? "#fff" : "var(--ink-soft)",
              border: "1px solid " + (filter === f ? "var(--teal)" : "var(--line)"),
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {orders === null && <LoadingState />}
      {orders !== null && orders.length === 0 && <EmptyState message="No orders here yet." />}

      {orders !== null && orders.length > 0 && (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ borderBottom: "1px solid var(--line)" }}>
                <Th>Reference</Th>
                <Th>Merchant</Th>
                <Th>Amount</Th>
                <Th>Provider</Th>
                <Th>TrxID</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Td className="tabular">{o.reference.slice(0, 8)}</Td>
                  <Td>{o.merchant_name}</Td>
                  <Td className="tabular">&#2547;{o.amount_bdt.toFixed(2)}</Td>
                  <Td>{o.provider}</Td>
                  <Td className="tabular">{o.submitted_trx_id ?? "\u2014"}</Td>
                  <Td>
                    <StatusBadge status={o.status} />
                  </Td>
                  <Td style={{ color: "var(--ink-soft)" }}>
                    {new Date(o.created_at).toLocaleString("en-BD", { dateStyle: "short", timeStyle: "short" })}
                  </Td>
                  <Td>
                    {(o.status === "PENDING" || o.status === "SUBMITTED") && (
                      <div className="flex gap-1.5">
                        <button
                          disabled={actingOn === o.id}
                          onClick={() => act(o.id, "approve")}
                          className="text-xs px-2 py-1 rounded-md"
                          style={{ background: "#E6F4EC", color: "var(--ok)" }}
                        >
                          Approve
                        </button>
                        <button
                          disabled={actingOn === o.id}
                          onClick={() => act(o.id, "reject")}
                          className="text-xs px-2 py-1 rounded-md"
                          style={{ background: "#FBEAE9", color: "var(--err)" }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-2 text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
      {children}
    </th>
  );
}
function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td className={`px-5 py-2.5 ${className ?? ""}`} style={{ color: "var(--ink)", ...style }}>
      {children}
    </td>
  );
}
