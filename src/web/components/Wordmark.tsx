/** A line threaded through three nodes: the path a case takes through a process. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 text-ink" aria-label="Process Discovery Engine for Mainloop">
      <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
        <path d="M1 15 C8 15, 8 5, 14 5 S20 15, 27 15" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="3" cy="15" r="2.6" fill="currentColor" />
        <circle cx="14" cy="5" r="2.6" className="fill-primary" />
        <circle cx="25" cy="15" r="2.6" fill="currentColor" />
      </svg>
      <span className="flex flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-2" aria-hidden="true">
        <span className="text-[1.05rem] font-semibold tracking-tight sm:text-[1.15rem]">Process Discovery Engine</span>
        <em className="text-sm font-normal opacity-70">for Mainloop</em>
      </span>
    </span>
  );
}
