export const PROVIDER_INFO: Record<
  string,
  { name: string; color: string; ussd: string; sendMoneyHint: string }
> = {
  BKASH: {
    name: "bKash",
    color: "var(--bkash-pink)",
    ussd: "*247#",
    sendMoneyHint: "Send Money",
  },
  NAGAD: {
    name: "Nagad",
    color: "var(--nagad-orange)",
    ussd: "*167#",
    sendMoneyHint: "Send Money",
  },
  ROCKET: {
    name: "Rocket",
    color: "var(--rocket-purple)",
    ussd: "*322#",
    sendMoneyHint: "Send Money",
  },
  UPAY: {
    name: "Upay",
    color: "var(--upay-blue)",
    ussd: "*268#",
    sendMoneyHint: "Send Money",
  },
};
