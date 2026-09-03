"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge, EmptyState, LoadingState, PrimaryButton, TextInput } from "./ui";

interface Account {
  id: string;
  provider: string;
  msisdn: string;
  label: string | null;
  device_key: string;
  is_active: boolean;
  created_at: string;
}

const PROVIDERS = ["BKASH", "NAGAD", "ROCKET", "UPAY"];

export default function ReceivingAccountsTab() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState("BKASH");
  const [msisdn, setMsisdn] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/receiving-accounts", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/receiving-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, msisdn, label: label || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create account");
        setSaving(false);
        return;
      }
      setMsisdn("");
      setLabel("");
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(acc: Account) {
    await fetch(`/api/admin/receiving-accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !acc.is_active }),
    });
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          The numbers customers are told to Send Money to. Each has a unique device key for its SMS forwarder.
        </p>
        <PrimaryButton onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Add number"}
        </PrimaryButton>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl p-4 mb-5 space-y-3"
          style={{ border: "1px solid var(--line)", background: "var(--background)" }}
        >
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-soft)" }}>
                Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-soft)" }}>
                Number
              </label>
              <TextInput
                placeholder="01712345678"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-soft)" }}>
                Label (optional)
              </label>
              <TextInput placeholder="Primary" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Saving\u2026" : "Save number"}
          </PrimaryButton>
        </form>
      )}

      {accounts === null && <LoadingState />}
      {accounts !== null && accounts.length === 0 && (
        <EmptyState message="No receiving numbers yet. Add the owner's bKash/Nagad number to start accepting payments." />
      )}

      <div className="space-y-3">
        {accounts?.map((acc) => (
          <div key={acc.id} className="rounded-xl p-4" style={{ border: "1px solid var(--line)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular" style={{ color: "var(--ink)" }}>
                    {acc.msisdn}
                  </span>
                  <StatusBadge status={acc.provider} />
                  {acc.label && (
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                      {acc.label}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: acc.is_active ? "var(--ok)" : "var(--ink-soft)" }}>
                  {acc.is_active ? "Active" : "Inactive"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRevealedKey(revealedKey === acc.id ? null : acc.id)}
                  className="text-xs px-2.5 py-1.5 rounded-md"
                  style={{ border: "1px solid var(--line)", color: "var(--ink-soft)" }}
                >
                  {revealedKey === acc.id ? "Hide setup" : "SMS forwarder setup"}
                </button>
                <button
                  onClick={() => toggleActive(acc)}
                  className="text-xs px-2.5 py-1.5 rounded-md"
                  style={{ border: "1px solid var(--line)", color: "var(--ink-soft)" }}
                >
                  {acc.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>

            {revealedKey === acc.id && (
              <div
                className="mt-3 rounded-lg p-3 text-xs space-y-2"
                style={{ background: "var(--background)", border: "1px solid var(--line)" }}
              >
                <p style={{ color: "var(--ink-soft)" }}>
                  Configure the SMS-forwarder app on the phone holding this SIM to POST to:
                </p>
                <code className="block break-all tabular" style={{ color: "var(--teal)" }}>
                  {origin}/api/sms/ingest
                </code>
                <p style={{ color: "var(--ink-soft)" }}>with JSON body field &quot;deviceKey&quot;:</p>
                <code className="block break-all tabular" style={{ color: "var(--teal)" }}>
                  {acc.device_key}
                </code>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
