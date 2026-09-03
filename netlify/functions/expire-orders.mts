// Netlify Scheduled Function — runs every 5 minutes.
//
// Netlify functions are request-scoped, so there is no place for a
// setInterval. This calls the app's own housekeeping route, which
// expires stale orders and retries merchant webhooks that failed
// their first delivery.
//
// Requires CRON_SECRET to be set in the site's environment (the same
// value the route checks). URL is discovered from Netlify's own
// URL/DEPLOY_URL env vars, so this works on production and previews.

import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.PUBLIC_BASE_URL || process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.CRON_SECRET;

  if (!base || !secret) {
    console.error("expire-orders: missing PUBLIC_BASE_URL/URL or CRON_SECRET — skipping");
    return;
  }

  const res = await fetch(`${base}/api/cron/expire`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`expire-orders: HTTP ${res.status} ${body}`);
    return;
  }
  console.log(`expire-orders: ${body}`);
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
