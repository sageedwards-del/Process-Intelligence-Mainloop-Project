import type { DemoId } from "@/lib/analysis/demos";

/** Stroke icons for the two demos: a travel receipt for the real expense claims, an invoice in a flask for the synthetic sample. */
const PATHS: Record<DemoId, React.ReactNode> = {
  bpic2020: (
    <>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
      <path d="m14.5 15.5 1.5-1 1.5 1" />
    </>
  ),
  meridian: (
    <>
      <path d="M9.5 3h5M10.5 3v5.2L5.4 17.6A2.2 2.2 0 0 0 7.3 21h9.4a2.2 2.2 0 0 0 1.9-3.4L13.5 8.2V3" />
      <path d="M7.6 14h8.8" />
      <circle cx="10.5" cy="17.2" r=".6" />
      <circle cx="13.6" cy="16.4" r=".6" />
    </>
  ),
};

export function DemoIcon({ id, size = "sm" }: { id: DemoId; size?: "sm" | "lg" }) {
  const ai = id === "meridian";
  const box = size === "lg" ? "size-28 rounded-3xl" : "size-10 rounded-xl";
  const icon = size === "lg" ? "size-14" : "size-5";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center text-primary-ink ${box} ${ai ? "bg-[linear-gradient(135deg,var(--ai-from),var(--ai-to))]" : "bg-primary"} ${size === "lg" ? "shadow-[0_20px_50px_-24px_rgba(14,20,22,0.55)]" : ""}`}
    >
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth={size === "lg" ? 1.3 : 1.6} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[id]}
      </svg>
    </span>
  );
}
