"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        setLoading(false);
        return;
      }
      router.push("/admin/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-sm font-medium" style={{ color: "var(--ink-soft)" }}>
            Gateway Admin
          </p>
          <h1 className="text-2xl font-semibold mt-1" style={{ color: "var(--teal)" }}>
            Sign in
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: "var(--ink)" }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-base outline-none"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={{ color: "var(--ink)" }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-base outline-none"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 font-medium text-white disabled:opacity-60"
            style={{ background: "var(--teal)" }}
          >
            {loading ? "Signing in\u2026" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
