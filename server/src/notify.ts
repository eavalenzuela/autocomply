// Outbound notification delivery. The computed /api/notifications feed is in-app
// (a pull); this pushes events to a configured webhook (NOTIFY_WEBHOOK_URL) — e.g.
// a Slack incoming webhook, an email relay, or a SIEM. No-op when unset, so it is
// safe by default and only delivers once an operator configures a sink.
export interface NotifyEvent {
  kind: string;
  text: string;
  severity: "info" | "warn" | "bad";
}

export async function deliverNotifications(events: NotifyEvent[], at: string): Promise<number> {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url || events.length === 0) return 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "autocomply", at, events }),
    });
    if (!res.ok) {
      console.error(`[notify] webhook responded ${res.status}`);
      return 0;
    }
    return events.length;
  } catch (e) {
    console.error("[notify] delivery failed:", e);
    return 0;
  }
}
