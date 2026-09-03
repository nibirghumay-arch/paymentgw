"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PROVIDER_INFO } from "@/lib/providers";

export type OrderStatus = "PENDING" | "SUBMITTED" | "MATCHED" | "APPROVED" | "REJECTED" | "EXPIRED";

interface Props {
  reference: string;
  amountBdt: number;
  provider: string;
  receivingNumber: string;
  initialStatus: OrderStatus;
  expiresAt: string;
  returnUrl: string | null;
}

function formatBdt(n: number): string {
  return new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function useCountdown(expiresAt: string) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return { remaining, label: `${mins}:${secs.toString().padStart(2, "0")}` };
}

export default function CheckoutClient({
  reference,
  amountBdt,
  provider,
  receivingNumber,
  initialStatus,
  expiresAt,
  returnUrl,
}: Props) {
  const info = PROVIDER_INFO[provider] ?? PROVIDER_INFO.BKASH;
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [trxId, setTrxId] = useState("");
  const [customerMsisdn, setCustomerMsisdn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { remaining, label: countdownLabel } = useCountdown(expiresAt);

  const isTerminal = status === "APPROVED" || status === "REJECTED" || status === "EXPIRED";

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${reference}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
    } catch {
      // silent — will retry on next tick
    }
  }, [reference]);

  useEffect(() => {
    if (isTerminal) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(poll, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll, isTerminal]);

  useEffect(() => {
    if (status === "APPROVED" && returnUrl) {
      const t = setTimeout(() => {
        window.location.href = returnUrl;
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [status, returnUrl]);

  useEffect(() => {
    if (remaining === 0 && !isTerminal) {
      setStatus("EXPIRED");
    }
  }, [remaining, isTerminal]);

  async function handleCopyNumber() {
    try {
      await navigator.clipboard.writeText(receivingNumber);
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 1800);
    } catch {
      // clipboard unavailable — no-op, number is still visible to copy manually
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanTrx = trxId.trim();
    if (cleanTrx.length < 6) {
      setError("That doesn't look like a complete TrxID. Check your SMS and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${reference}/submit-trx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trxId: cleanTrx,
          ...(customerMsisdn ? { customerMsisdn: customerMsisdn.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't submit that TrxID. Please check it and try again.");
        setSubmitting(false);
        return;
      }
      setStatus(data.status);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "var(--background)" }}
    >
      <div className="w-full max-w-sm">
        {/* Header: amount, always visible, this is the anchor of trust */}
        <div className="text-center mb-6">
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Amount to pay
          </p>
          <p className="tabular text-4xl font-semibold mt-1" style={{ color: "var(--teal)" }}>
            &#2547;{formatBdt(amountBdt)}
          </p>
        </div>

        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
        >
          {/* Provider strip */}
          <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: info.color }}
              aria-hidden
            />
            <span className="font-medium" style={{ color: "var(--ink)" }}>
              Pay with {info.name}
            </span>
            {!isTerminal && (
              <span className="ml-auto text-xs tabular" style={{ color: "var(--ink-soft)" }}>
                Expires in {countdownLabel}
              </span>
            )}
          </div>

          <div className="p-5">
            {status === "APPROVED" && <ApprovedPanel returnUrl={returnUrl} />}
            {status === "REJECTED" && <RejectedPanel />}
            {status === "EXPIRED" && <ExpiredPanel />}

            {(status === "PENDING" || status === "SUBMITTED") && (
              <>
                {/* Step 1: instructions */}
                <ol className="space-y-3 mb-5">
                  <li className="text-sm" style={{ color: "var(--ink)" }}>
                    <span className="font-medium">1. Open {info.name}</span> and choose{" "}
                    <span className="font-medium">{info.sendMoneyHint}</span>
                    <span style={{ color: "var(--ink-soft)" }}> (dial {info.ussd} if you don&apos;t have the app)</span>
                  </li>
                  <li className="text-sm" style={{ color: "var(--ink)" }}>
                    <span className="font-medium">2. Send exactly </span>
                    <span className="tabular font-medium">&#2547;{formatBdt(amountBdt)}</span> to:
                    <button
                      type="button"
                      onClick={handleCopyNumber}
                      className="mt-2 w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left tabular font-medium"
                      style={{ background: "var(--background)", border: "1px solid var(--line)", color: "var(--teal)" }}
                    >
                      <span>{receivingNumber}</span>
                      <span className="text-xs font-normal" style={{ color: "var(--ink-soft)" }}>
                        {copiedNumber ? "Copied" : "Tap to copy"}
                      </span>
                    </button>
                  </li>
                  <li className="text-sm" style={{ color: "var(--ink)" }}>
                    <span className="font-medium">3. Enter the TrxID</span> from the confirmation SMS below.
                  </li>
                </ol>

                {status === "SUBMITTED" ? (
                  <div
                    className="rounded-lg px-4 py-3 text-sm flex items-start gap-2.5"
                    style={{ background: "#FEF6E7", border: "1px solid #F3D9A0", color: "var(--warn)" }}
                  >
                    <span className="mt-0.5">&#9679;</span>
                    <span>
                      Checking your payment against incoming transactions&hellip; this usually takes a few seconds
                      and updates automatically.
                    </span>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                      <label htmlFor="trxId" className="block text-sm font-medium mb-1.5" style={{ color: "var(--ink)" }}>
                        Transaction ID (TrxID)
                      </label>
                      <input
                        id="trxId"
                        type="text"
                        autoCapitalize="characters"
                        placeholder="e.g. 8N7K2P1Q9R"
                        value={trxId}
                        onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                        className="tabular w-full rounded-lg px-3 py-2.5 text-base outline-none"
                        style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
                        maxLength={20}
                      />
                    </div>
                    <div>
                      <label htmlFor="msisdn" className="block text-sm font-medium mb-1.5" style={{ color: "var(--ink)" }}>
                        Your {info.name} number <span className="font-normal" style={{ color: "var(--ink-soft)" }}>(optional)</span>
                      </label>
                      <input
                        id="msisdn"
                        type="tel"
                        placeholder="01XXXXXXXXX"
                        value={customerMsisdn}
                        onChange={(e) => setCustomerMsisdn(e.target.value)}
                        className="tabular w-full rounded-lg px-3 py-2.5 text-base outline-none"
                        style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
                        maxLength={11}
                      />
                    </div>

                    {error && (
                      <p className="text-sm" style={{ color: "var(--err)" }}>
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-lg py-3 font-medium text-white disabled:opacity-60"
                      style={{ background: "var(--teal)" }}
                    >
                      {submitting ? "Checking\u2026" : "Confirm payment"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: "var(--ink-soft)" }}>
          Reference: <span className="tabular">{reference.slice(0, 8)}</span>
        </p>
      </div>
    </div>
  );
}

function ApprovedPanel({ returnUrl }: { returnUrl: string | null }) {
  return (
    <div className="text-center py-4">
      <div
        className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: "#E6F4EC" }}
      >
        <span style={{ color: "var(--ok)" }}>&#10003;</span>
      </div>
      <p className="font-medium" style={{ color: "var(--ink)" }}>
        Payment verified
      </p>
      <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
        {returnUrl ? "Redirecting you back\u2026" : "Your payment has been confirmed."}
      </p>
    </div>
  );
}

function RejectedPanel() {
  return (
    <div className="text-center py-4">
      <div
        className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: "#FBEAE9" }}
      >
        <span style={{ color: "var(--err)" }}>&#10005;</span>
      </div>
      <p className="font-medium" style={{ color: "var(--ink)" }}>
        Payment rejected
      </p>
      <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
        This TrxID couldn&apos;t be verified. Contact support with your TrxID for help.
      </p>
    </div>
  );
}

function ExpiredPanel() {
  return (
    <div className="text-center py-4">
      <p className="font-medium" style={{ color: "var(--ink)" }}>
        This payment session expired
      </p>
      <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
        Go back to the site and start a new payment.
      </p>
    </div>
  );
}
