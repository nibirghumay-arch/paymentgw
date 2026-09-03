// ============================================================
// SMS Parser — extracts { trxId, amount, senderMsisdn } from
// raw "Cash In / Send Money received" SMS text sent by bKash,
// Nagad, Rocket, and Upay.
//
// IMPORTANT: These providers occasionally tweak SMS wording.
// Treat this as a living module — when a message fails to
// parse, it's stored with parseStatus=UNPARSED so an admin can
// review it and you can add a new pattern below.
// ============================================================

export type Provider = "BKASH" | "NAGAD" | "ROCKET" | "UPAY";

export interface ParsedSms {
  matched: boolean;
  isMoneyReceived: boolean; // false = parsed but irrelevant (e.g. cash-out, payment sent)
  trxId?: string;
  amountBdt?: number;
  senderMsisdn?: string;
}

function toNumber(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ""));
}

// ------------------------------------------------------------
// bKash
// Real examples:
//  "You have received Tk 3,000.00 from 017XXXXXXXX. Fee Tk 0.00.
//   Balance Tk 3,003.55. TrxID 7EL5RFAUE9 at 21/05/2020 19:58"
//  "You have received Tk 500.00 from 017XXXXXXXX. Fee Tk 0.00.
//   New Balance: Tk 501.14. TrxID CFC6TG8FNU"
// ------------------------------------------------------------
function parseBkash(text: string): ParsedSms {
  const receivedRe =
    /received\s+Tk\.?\s*([\d,]+\.?\d*)\s+from\s+(\d{9,15}|[A-Za-z0-9]+)[.,]?.*?TrxID\s*[:\s]?\s*([A-Z0-9]{6,12})/is;

  const match = text.match(receivedRe);
  if (match) {
    const [, amount, sender, trxId] = match;
    return {
      matched: true,
      isMoneyReceived: true,
      trxId: trxId.toUpperCase(),
      amountBdt: toNumber(amount),
      senderMsisdn: /^\d{9,15}$/.test(sender) ? sender : undefined,
    };
  }

  // Recognized as a bKash message but not a "money received" event
  // (cash out, payment sent, mobile recharge, etc.)
  if (/trxid/i.test(text)) {
    return { matched: true, isMoneyReceived: false };
  }

  return { matched: false, isMoneyReceived: false };
}

// ------------------------------------------------------------
// Nagad
// Real examples:
//  "You have received Tk. 500.00 from 017XXXXXXXX. Balance:
//   Tk. 1200.00. Ref: TxnID:AB12CD34EF Date:01/09/2026 10:22"
//  "Money Received. Amount: Tk 500.00 Sender: 017XXXXXXXX
//   TxnID: 9Z8Y7X6W5V Balance: Tk 1200.00"
// ------------------------------------------------------------
function parseNagad(text: string): ParsedSms {
  const receivedRe =
    /received\s+Tk\.?\s*([\d,]+\.?\d*)\s+from\s+(\d{9,15})[.,]?.*?(?:TxnID|Txn ID|Ref(?:erence)?)\s*[:\s]?\s*([A-Z0-9]{6,15})/is;

  const match = text.match(receivedRe);
  if (match) {
    const [, amount, sender, trxId] = match;
    return {
      matched: true,
      isMoneyReceived: true,
      trxId: trxId.toUpperCase(),
      amountBdt: toNumber(amount),
      senderMsisdn: sender,
    };
  }

  // Alternate "Money Received" layout
  const altRe =
    /Money Received.*?Amount:?\s*Tk\.?\s*([\d,]+\.?\d*).*?Sender:?\s*(\d{9,15}).*?Txn\s?ID:?\s*([A-Z0-9]{6,15})/is;
  const altMatch = text.match(altRe);
  if (altMatch) {
    const [, amount, sender, trxId] = altMatch;
    return {
      matched: true,
      isMoneyReceived: true,
      trxId: trxId.toUpperCase(),
      amountBdt: toNumber(amount),
      senderMsisdn: sender,
    };
  }

  if (/nagad|txnid/i.test(text)) {
    return { matched: true, isMoneyReceived: false };
  }

  return { matched: false, isMoneyReceived: false };
}

// ------------------------------------------------------------
// Rocket (DBBL Mobile Banking)
// Real example style:
//  "You have received Tk 500.00 from 017XXXXXXXX. Ref XXXXX
//   TrxID 1234567890123 Bal Tk 900.00"
// ------------------------------------------------------------
function parseRocket(text: string): ParsedSms {
  const receivedRe =
    /received\s+Tk\.?\s*([\d,]+\.?\d*)\s+from\s+(\d{9,15})[.,]?.*?TrxID\s*[:\s]?\s*([A-Z0-9]{6,15})/is;

  const match = text.match(receivedRe);
  if (match) {
    const [, amount, sender, trxId] = match;
    return {
      matched: true,
      isMoneyReceived: true,
      trxId: trxId.toUpperCase(),
      amountBdt: toNumber(amount),
      senderMsisdn: sender,
    };
  }

  if (/trxid/i.test(text)) {
    return { matched: true, isMoneyReceived: false };
  }

  return { matched: false, isMoneyReceived: false };
}

// ------------------------------------------------------------
// Upay
// ------------------------------------------------------------
function parseUpay(text: string): ParsedSms {
  const receivedRe =
    /received\s+(?:BDT|Tk\.?)\s*([\d,]+\.?\d*)\s+from\s+(\d{9,15})[.,]?.*?(?:TxnID|TrxID)\s*[:\s]?\s*([A-Z0-9]{6,15})/is;

  const match = text.match(receivedRe);
  if (match) {
    const [, amount, sender, trxId] = match;
    return {
      matched: true,
      isMoneyReceived: true,
      trxId: trxId.toUpperCase(),
      amountBdt: toNumber(amount),
      senderMsisdn: sender,
    };
  }

  if (/upay|txnid/i.test(text)) {
    return { matched: true, isMoneyReceived: false };
  }

  return { matched: false, isMoneyReceived: false };
}

const PARSERS: Record<Provider, (text: string) => ParsedSms> = {
  BKASH: parseBkash,
  NAGAD: parseNagad,
  ROCKET: parseRocket,
  UPAY: parseUpay,
};

export function parseSms(provider: Provider, rawText: string): ParsedSms {
  const parser = PARSERS[provider];
  if (!parser) return { matched: false, isMoneyReceived: false };
  return parser(rawText);
}

// Auto-detect provider from message body if the forwarder app
// doesn't tag it (fallback only — prefer explicit provider from
// the receiving account's device_key mapping).
export function detectProvider(text: string): Provider | null {
  if (/bkash/i.test(text)) return "BKASH";
  if (/nagad/i.test(text)) return "NAGAD";
  if (/rocket/i.test(text)) return "ROCKET";
  if (/upay/i.test(text)) return "UPAY";
  return null;
}
