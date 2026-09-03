import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import CheckoutClient from "./checkout-client";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const db = getDb();

  const order = db
    .prepare(
      `SELECT o.*, r.msisdn as receiving_msisdn
       FROM orders o
       JOIN receiving_accounts r ON r.id = o.receiving_account_id
       WHERE o.reference = ?`
    )
    .get(reference) as any;

  if (!order) notFound();

  return (
    <CheckoutClient
      reference={order.reference}
      amountBdt={order.amount_bdt}
      provider={order.provider}
      receivingNumber={order.receiving_msisdn}
      initialStatus={order.status}
      expiresAt={order.expires_at}
      returnUrl={order.return_url}
    />
  );
}
