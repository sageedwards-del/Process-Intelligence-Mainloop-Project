import type { Status } from "@/app/engineering/content";

const STATUS: Record<Status, { label: string; style: string }> = {
  done: { label: "Done", style: "bg-primary text-primary-ink" },
  next: { label: "Next", style: "border border-primary text-primary" },
  planned: { label: "Planned", style: "border border-line text-ink-faint" },
};

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`eyebrow inline-block shrink-0 rounded px-2 py-1 text-[0.62rem] ${s.style}`}>{s.label}</span>;
}
