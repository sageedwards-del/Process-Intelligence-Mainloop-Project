import type { MemoOutput } from "@/lib/ai/memo";
import { formatMoney } from "../explorer/format";

/** The memo as Markdown, with citations as footnotes and the shares the reader set. */
export function memoMarkdown(memo: MemoOutput, shares: Record<number, number>): string {
  const money = (n: number) => formatMoney(n, memo.currency);
  const notes: string[] = [];
  const cite = (text: string) =>
    text.replace(/\[\[([^\]]+)\]\]/g, (_, raw: string) => {
      const id = raw.trim();
      if (!notes.includes(id)) notes.push(id);
      return `[^${notes.indexOf(id) + 1}]`;
    });
  const opps = memo.opportunities.map((o, i) => {
    const share = shares[i] ?? o.addressableShare;
    return { ...o, share, saving: o.annualBase * share };
  });
  const total = opps.reduce((s, o) => s + o.saving, 0);
  const lines = [
    `# Opportunity memo: ${memo.recommendation === "go" ? "Go" : "No-go"}`,
    "",
    cite(memo.headline),
    "",
    `**Annual opportunity:** ${money(total)}${opps.length ? ` (${opps.map((o) => money(o.saving)).join(" + ")})` : ""}, scaled from ${memo.logSpanDays.toFixed(0)} days of log.`,
    "",
    "## Current state",
    "",
    cite(memo.currentState),
    "",
    "## Opportunities",
    ...opps.flatMap((o, i) => [
      "",
      `### ${i + 1}. ${o.title}: ${money(o.saving)} a year`,
      "",
      `Formula: ${money(o.annualBase)} a year (${o.sizing.join(" + ")}) × ${Math.round(o.share * 100)}% addressable`,
      "",
      `- **Why that share:** ${cite(o.shareRationale)}`,
      `- **Evidence:** ${cite(o.evidence)}`,
      `- **Approach:** ${cite(o.approach)}`,
      `- **Risks:** ${cite(o.risks)}`,
    ]),
    "",
    "## Recommendation",
    "",
    cite(memo.rationale),
    "",
    "## Assumptions to validate on site",
    "",
    ...memo.assumptions.map((a) => `- ${cite(a)}`),
    "",
    "---",
    "",
    "Drafted by AI from the engine's metrics; every figure was checked against the metric it cites.",
    "",
  ];
  for (const [i, id] of notes.entries()) {
    const m = memo.metrics[id];
    lines.push(`[^${i + 1}]: \`${id}\`${m ? ` ${m.label}${m.formula ? `. ${m.formula}` : ""}` : ""}`);
  }
  return lines.join("\n");
}
