/**
 * The Engineering page's data-flow diagram: five icon steps joined by arrows, left to right
 * from lg up and top to bottom below. Copy in app/engineering/content.ts. Server component, no client JS.
 */
import { FLOW, FLOW_NOTE, type FlowIcon } from "@/app/engineering/content";

const PATHS: Record<FlowIcon, React.ReactNode> = {
  upload: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 17v-6M9.5 13.5 12 11l2.5 2.5" />
    </>
  ),
  store: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  analyse: (
    <>
      <rect x="3" y="3" width="6" height="5" rx="1" />
      <rect x="15" y="9.5" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <path d="M9 5.5h3v13H9M12 12h3" />
    </>
  ),
  claude: <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7zM18.5 15.5c.3 1.9 1 2.6 2.5 3-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.4 2.2-1.1 2.5-3z" />,
  check: (
    <>
      <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
};

function Icon({ name, ai }: { name: FlowIcon; ai: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-16 place-items-center rounded-2xl ${ai ? "bg-[linear-gradient(135deg,var(--ai-from),var(--ai-to))]" : "bg-primary"} text-primary-ink shadow-[0_12px_30px_-14px_rgba(14,20,22,0.5)]`}
    >
      <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
    </span>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div aria-hidden className="flex items-center justify-center gap-2 py-4 lg:flex-col lg:py-0 lg:pt-5">
      <span className="font-mono text-[0.68rem] text-primary">{label}</span>
      <svg viewBox="0 0 40 12" className="hidden h-3 w-10 text-primary lg:block" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6h37M33 1.5 38 6l-5 4.5" />
      </svg>
      <svg viewBox="0 0 12 24" className="h-6 w-3 text-primary lg:hidden" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 1v21M1.5 17.5 6 22l4.5-4.5" />
      </svg>
    </div>
  );
}

export function DataFlow() {
  return (
    <figure className="mt-12">
      <ol className="flex flex-col items-stretch lg:flex-row lg:items-start">
        {FLOW.map((s, i) => (
          <li key={s.title} className="contents">
            <div className="flex flex-col items-center text-center lg:w-0 lg:flex-1">
              <Icon name={s.icon} ai={s.icon === "claude"} />
              <p className="mt-4 font-mono text-[0.7rem] text-ink-faint">{String(i + 1).padStart(2, "0")}</p>
              <h3 className={`mt-1 text-lg font-medium ${s.icon === "claude" ? "ai-gradient" : ""}`}>{s.title}</h3>
              <p className="mt-2 max-w-[15rem] text-sm leading-relaxed text-ink-muted">{s.body}</p>
              <p className="eyebrow mt-3 rounded-full border border-line px-3 py-1 text-[0.6rem] text-ink-muted">{s.where}</p>
            </div>
            {s.passes && <Arrow label={s.passes} />}
          </li>
        ))}
      </ol>
      <figcaption className="mx-auto mt-12 max-w-2xl text-center text-sm leading-relaxed text-ink-faint">{FLOW_NOTE}</figcaption>
    </figure>
  );
}
