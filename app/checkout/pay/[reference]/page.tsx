import { one } from "@/lib/db";
import { notFound } from "next/navigation";
import CheckoutClient, { type OrderStatus } from "./checkout-client";

// Reads live order state on every request — never prerender or cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutRow {
  reference: string;
  amount_bdt: number;
  provider: string;
  receiving_msisdn: string;
  // Selected as `status::text`, so Postgres hands back the enum label verbatim.
  status: OrderStatus;
  expires_at: Date;
  return_url: string | null;
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  const order = await one<CheckoutRow>(
    `SELECT o.reference, o.amount_bdt, o.provider::text AS provider, o.status::text AS status,
            o.expires_at, o.return_url, r.msisdn AS receiving_msisdn
       FROM orders o
       JOIN receiving_accounts r ON r.id = o.receiving_account_id
      WHERE o.reference = $1`,
    [reference]
  );

  if (!order) notFound();

  return (
    <CheckoutClient
      reference={order.reference}
      amountBdt={Number(order.amount_bdt)}
      provider={order.provider}
      receivingNumber={order.receiving_msisdn}
      initialStatus={order.status}
      expiresAt={order.expires_at.toISOString()}
      returnUrl={order.return_url}
    />
  );
}
