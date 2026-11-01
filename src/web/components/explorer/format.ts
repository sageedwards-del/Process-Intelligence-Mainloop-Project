/** Durations as a person would say them: "45 min", "6.5 h", "3.2 d". */
export function formatDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return "<1 min";
  if (min < 90) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 36) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} d`;
}

export const formatInt = (n: number) => Math.round(n).toLocaleString("en");

export function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
