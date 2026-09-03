export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    PENDING: { bg: "#F1EEE6", fg: "var(--ink-soft)" },
    SUBMITTED: { bg: "#FEF6E7", fg: "var(--warn)" },
    MATCHED: { bg: "#E6F4EC", fg: "var(--ok)" },
    APPROVED: { bg: "#E6F4EC", fg: "var(--ok)" },
    REJECTED: { bg: "#FBEAE9", fg: "var(--err)" },
    EXPIRED: { bg: "#F1EEE6", fg: "var(--ink-soft)" },
    PARSED: { bg: "#E6F4EC", fg: "var(--ok)" },
    UNPARSED: { bg: "#FBEAE9", fg: "var(--err)" },
    IGNORED: { bg: "#F1EEE6", fg: "var(--ink-soft)" },
  };
  const style = map[status] ?? { bg: "#F1EEE6", fg: "var(--ink-soft)" };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      {status}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10 text-sm" style={{ color: "var(--ink-soft)" }}>
      {message}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="text-center py-10 text-sm" style={{ color: "var(--ink-soft)" }}>
      Loading&hellip;
    </div>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60 ${props.className ?? ""}`}
      style={{ background: "var(--teal)", ...props.style }}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ border: "1px solid var(--line)", color: "var(--ink)", ...props.style }}
    />
  );
}
