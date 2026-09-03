import Link from "next/link";

export default function Home() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--background)" }}
    >
      <div className="max-w-md text-center">
        <p className="text-sm font-medium" style={{ color: "var(--ink-soft)" }}>
          bKash &middot; Nagad &middot; Rocket &middot; Upay
        </p>
        <h1 className="text-3xl font-semibold mt-2" style={{ color: "var(--teal)" }}>
          Payment Gateway
        </h1>
        <p className="text-sm mt-3" style={{ color: "var(--ink-soft)" }}>
          Automatic Send Money verification via SMS matching. Manage receiving numbers, merchants, and
          transactions from the admin panel.
        </p>
        <Link
          href="/admin/login"
          className="inline-block mt-6 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
          style={{ background: "var(--teal)" }}
        >
          Go to admin panel
        </Link>
      </div>
    </div>
  );
}
