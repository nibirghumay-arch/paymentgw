"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge, EmptyState, LoadingState } from "./ui";

interface Sms {
  id: string;
  raw_text: string;
  received_at: string;
  provider: string;
  parse_status: string;
  parsed_trx_id: string | null;
  parsed_amount_bdt: number | null;
  receiving_msisdn: string;
  is_used: boolean;
}

const FILTERS = ["ALL", "PARSED", "UNPARSED", "IGNORED"];

export default function SmsLogTab() {
  const [sms, setSms] = useState<Sms[] | null>(null);
  const [filter, setFilter] = useState("ALL");

  const load = useCallback(async () => {
    const qs = filter !== "ALL" ? `?parseStatus=${filter}` : "";
    const res = await fetch(`/api/admin/sms${qs}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setSms(data.sms);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Every SMS forwarded from the owner&apos;s phones. Review &quot;UNPARSED&quot; messages if a payment
          isn&apos;t auto-matching.
        </p>
        <div className="flex gap-1.5">
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
      </div>

      {sms === null && <LoadingState />}
      {sms !== null && sms.length === 0 && <EmptyState message="No SMS received yet." />}

      <div className="space-y-2">
        {sms?.map((s) => (
          <div key={s.id} className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <StatusBadge status={s.parse_status} />
              <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                {s.provider} &middot; {s.receiving_msisdn}
              </span>
              <span className="text-xs ml-auto" style={{ color: "var(--ink-soft)" }}>
                {new Date(s.received_at).toLocaleString("en-BD", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <p className="text-sm font-mono break-words" style={{ color: "var(--ink)" }}>
              {s.raw_text}
            </p>
            {s.parse_status === "PARSED" && (
              <p className="text-xs mt-1.5 tabular" style={{ color: "var(--ink-soft)" }}>
                TrxID {s.parsed_trx_id} &middot; &#2547;{s.parsed_amount_bdt?.toFixed(2)} &middot;{" "}
                {s.is_used ? "matched to an order" : "not yet matched"}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
