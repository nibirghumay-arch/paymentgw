"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge, EmptyState, LoadingState, PrimaryButton, TextInput } from "./ui";

interface Merchant {
  id: string;
  name: string;
  api_key: string;
  webhook_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface NewCredentials {
  name: string;
  apiKey: string;
  apiSecret: string;
}

export default function MerchantsTab() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCreds, setNewCreds] = useState<NewCredentials | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/merchants", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setMerchants(data.merchants);
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
      const res = await fetch("/api/admin/merchants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, webhookUrl: webhookUrl || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create merchant");
        setSaving(false);
        return;
      }
      setNewCreds({ name: data.merchant.name, apiKey: data.merchant.apiKey, apiSecret: data.merchant.apiSecret });
      setName("");
      setWebhookUrl("");
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {newCreds && (
        <div
          className="rounded-xl p-4 mb-5 space-y-2"
          style={{ background: "#FEF6E7", border: "1px solid #F3D9A0" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--warn)" }}>
            Save these now — the API secret won&apos;t be shown again
          </p>
          <div className="text-xs space-y-1 tabular">
            <p>
              <span style={{ color: "var(--ink-soft)" }}>API key: </span>
              <span style={{ color: "var(--ink)" }}>{newCreds.apiKey}</span>
            </p>
            <p>
              <span style={{ color: "var(--ink-soft)" }}>API secret: </span>
              <span style={{ color: "var(--ink)" }}>{newCreds.apiSecret}</span>
            </p>
          </div>
          <button
            onClick={() => setNewCreds(null)}
            className="text-xs underline"
            style={{ color: "var(--warn)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Websites authorized to create payment orders through this gateway.
        </p>
        <PrimaryButton onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New merchant"}
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
                Site / app name
              </label>
              <TextInput placeholder="My Store" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-soft)" }}>
                Webhook URL (optional)
              </label>
              <TextInput
                placeholder="https://mystore.com/webhooks/payment"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? "Creating\u2026" : "Create merchant"}
          </PrimaryButton>
        </form>
      )}

      {merchants === null && <LoadingState />}
      {merchants !== null && merchants.length === 0 && (
        <EmptyState message="No merchants yet. Create one to get an API key for your website." />
      )}

      <div className="space-y-3">
        {merchants?.map((m) => (
          <div key={m.id} className="rounded-xl p-4" style={{ border: "1px solid var(--line)" }}>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: "var(--ink)" }}>
                {m.name}
              </span>
              <StatusBadge status={m.is_active ? "APPROVED" : "REJECTED"} />
            </div>
            <p className="text-xs mt-1 tabular" style={{ color: "var(--ink-soft)" }}>
              {m.api_key}
            </p>
            {m.webhook_url && (
              <p className="text-xs mt-0.5 break-all" style={{ color: "var(--ink-soft)" }}>
                Webhook: {m.webhook_url}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
