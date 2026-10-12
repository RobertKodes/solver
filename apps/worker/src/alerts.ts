export type AlertEvent =
  | { type: "new_best"; mint: string; symbol: string; timeLog2: number }
  | { type: "submitted"; mint: string; symbol: string; track: string }
  | { type: "verdict"; mint: string; symbol: string; verdict: string }
  | { type: "low_runway"; mint: string; symbol: string; hours: number }
  | { type: "model_swap"; mint: string; symbol: string; requested: string; served: string };

export interface AlertTarget {
  channel: "telegram" | "discord" | "webhook";
  /** telegram: "<botToken>:<chatId>" ; discord/webhook: URL */
  target: string;
  events: AlertEvent["type"][];
  mint?: string;
}

export function formatAlert(e: AlertEvent): string {
  switch (e.type) {
    case "new_best": return `$${e.symbol} drafted a new best: 2^${e.timeLog2}`;
    case "submitted": return `$${e.symbol} submitted to HashSmash (${e.track})`;
    case "verdict": return `$${e.symbol} review verdict: ${e.verdict}`;
    case "low_runway": return `$${e.symbol} has ~${e.hours.toFixed(1)}h of compute left`;
    case "model_swap": return `$${e.symbol} ran on ${e.served} instead of ${e.requested}`;
  }
}

export async function dispatch(e: AlertEvent, targets: AlertTarget[], post: typeof fetch = fetch) {
  const text = formatAlert(e);
  const due = targets.filter((t) => t.events.includes(e.type) && (!t.mint || t.mint === e.mint));
  await Promise.allSettled(due.map((t) => {
    if (t.channel === "telegram") {
      const i = t.target.lastIndexOf(":");
      const [token, chat] = [t.target.slice(0, i), t.target.slice(i + 1)];
      return post(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }) });
    }
    const body = t.channel === "discord" ? { content: text } : { ...e, text };
    return post(t.target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }));
  return due.length;
}
