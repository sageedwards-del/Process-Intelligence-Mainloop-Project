/**
 * The Benefits page's four illustrations. Figures come from the Meridian sample
 * (engine output at seed 42), a memo Claude wrote for it, and docs/validation.md;
 * each card names its source. Server components, no client JS.
 */

function Card({ source, children }: { source: string; children: React.ReactNode }) {
  return (
    <figure className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-[0_20px_60px_-40px_rgba(14,20,22,0.35)] sm:p-6">
      <div className="flex-1">{children}</div>
      <figcaption className="mt-5 border-t border-line pt-3 font-mono text-[0.7rem] text-ink-faint">{source}</figcaption>
    </figure>
  );
}

function Step({ label, hot = false }: { label: string; hot?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm font-medium ${hot ? "border-primary bg-primary text-primary-ink" : "border-line bg-bg"}`}>{label}</div>
  );
}

function Connector({ thick = false, children }: { thick?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-3 pl-6">
      <span aria-hidden className={`${thick ? "w-1.5 bg-primary" : "w-px bg-ink-faint"} my-0.5 min-h-5 rounded-full`} />
      {children && <span className="py-1.5 font-mono text-[0.72rem] leading-snug text-primary">{children}</span>}
    </div>
  );
}

/** 01: the process map points at the step to ask about. */
export function WhereToLook() {
  return (
    <Card source="Meridian sample · 5,050 invoices · engine output">
      <p className="eyebrow text-[0.6rem] text-ink-faint">Before the first interview</p>
      <div className="mt-4 flex flex-col">
        <Step label="Register Invoice" />
        <Connector />
        <Step label="Match to Engagement" />
        <Connector thick>
          median wait 22.9 h · 243 cases stuck
          <br />
          one partner&rsquo;s queue 4.8× peers&rsquo;
        </Connector>
        <Step label="Partner Approval" hot />
        <Connector />
        <Step label="Approve Payment" />
      </div>
    </Card>
  );
}

/** 02: a complaint becomes a figure with its formula. */
export function NumbersOnTheComplaint() {
  return (
    <Card source="Meridian sample · cost model output">
      <div className="relative w-fit max-w-[18rem] rounded-2xl rounded-bl-sm border border-line bg-bg px-4 py-3 italic text-ink-muted">
        &ldquo;Partner sign-off takes forever.&rdquo;
      </div>
      <p aria-hidden className="my-3 pl-4 font-mono text-primary">↓ measured</p>
      <div className="rounded-lg border border-line p-4">
        <p className="font-mono text-4xl font-medium tracking-tight tabular-nums">€13,520</p>
        <p className="mt-1 font-medium">of missed early-payment discounts sit in that wait</p>
        <p className="mt-3 font-mono text-[0.72rem] leading-relaxed text-ink-muted">
          77,157 working hours beyond the usual 2 d: €13,520 of &ldquo;Pay 2/10 invoices within 10 days&rdquo; losses, shared out by
          excess wait
        </p>
      </div>
    </Card>
  );
}

const SURPRISES = [
  { what: "Paid without final approval", figure: "2 declarations", where: "BPIC 2020 · the same two as the published analysis" },
  { what: "One user’s invoice receipts all run slow", figure: "387 items", where: "BPIC 2019 · not in the published report" },
  { what: "Clerk who registered also approved payment", figure: "137 invoices", where: "Meridian sample · four-eyes rule" },
];

/** 03: problems that weren't in the brief. */
export function NobodyMentioned() {
  return (
    <Card source="docs/validation.md and the Meridian sample">
      <p className="eyebrow text-[0.6rem] text-ink-faint">Not in the brief</p>
      <ul className="mt-4 space-y-3">
        {SURPRISES.map((s) => (
          <li key={s.what} className="flex gap-3 rounded-lg border border-line bg-bg p-3">
            <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium">{s.what}</p>
                <p className="font-mono text-sm tabular-nums">{s.figure}</p>
              </div>
              <p className="mt-0.5 font-mono text-[0.7rem] text-ink-faint">{s.where}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 04: the memo's decision, sized by code. */
export function HonestNo() {
  return (
    <Card source="Example from a memo Claude wrote for the Meridian sample">
      <p className="eyebrow ai-gradient w-fit text-[0.6rem]">Written by Claude, checked by code</p>
      <div className="mt-4 flex gap-2">
        <span className="eyebrow rounded-md bg-primary px-3 py-1.5 text-[0.65rem] text-primary-ink">Go</span>
        <span className="eyebrow rounded-md border border-line px-3 py-1.5 text-[0.65rem] text-ink-faint">No-go</span>
      </div>
      <p className="ai-gradient mt-4 w-fit text-lg font-medium">Block duplicate invoices before the payment run</p>
      <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-ink-muted">
        €54,563 a year (rule:no-duplicates) × 80% addressable
      </p>
      <p className="mt-1 font-mono text-2xl font-medium tabular-nums">= €43,650 a year</p>
      <p className="mt-4 text-sm text-ink-muted">
        <span className="font-medium text-ink">Check on site:</span> duplicates aren&rsquo;t already recovered from vendors.
      </p>
      <p className="mt-3 text-sm text-ink-muted">A no-go comes with the same figures, so stopping is a result too.</p>
    </Card>
  );
}
