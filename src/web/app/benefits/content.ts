import type { Source } from "../faq";

/**
 * Copy for the Benefits page. Edit wording here; layout is in page.tsx and the
 * illustrations in components/benefits/Illustrations.tsx.
 * Written against Mainloop's Forward Deployed Engineer posting. Each point maps to
 * something built: the explorer's map and rules (01), CostModel figures with their
 * formulas (02), rules, root causes and AI insights (03), the go / no-go memo
 * (04). Copy must only claim what's built; the illustrations' figures come from the
 * Meridian sample and docs/validation.md.
 */

export interface MainloopPoint {
  n: string;
  title: string;
  body: string;
  /** What it rests on in the product, and where to see it. */
  builtOn: { label: string; href: string };
}

export const POSTING: Source = {
  label: "Mainloop: Forward Deployed Engineer job posting",
  href: "https://leytonglobal-spain.teamtailor.com/jobs/8330839-forward-deployed-engineer-mainloop",
};

export const MAINLOOP_POINTS: MainloopPoint[] = [
  {
    n: "01",
    title: "Arrive knowing where to look",
    body: "An export from the client’s system shows where cases wait, loop back or skip a control before the first interview. Time on site then goes to the steps that matter.",
    builtOn: { label: "Process map, waits and rules", href: "/sample/meridian" },
  },
  {
    n: "02",
    title: "Put numbers on the complaint",
    body: "“Two days a month reconciling this by hand” becomes a measured wait, a count of repeats and a cost with its formula. That number is checked against what people say, so the benefit is sized from day one.",
    builtOn: { label: "Cost model with formulas", href: "/engineering#engine" },
  },
  {
    n: "03",
    title: "Find what nobody mentioned",
    body: "A payment made without approval, a queue behind one approver, a loop nobody counts: the FDE can raise them with evidence, not a hunch. On public data it found the same two unapproved payments a published analysis did.",
    builtOn: { label: "Rules, root causes and AI-powered insights", href: "/#validation" },
  },
  {
    n: "04",
    title: "Make an honest “no” easy to defend",
    body: "The memo sizes each opportunity with its formula and the assumptions to check, so “not worth automating” is a result with numbers behind it.",
    builtOn: { label: "The go / no-go memo", href: "/sample/meridian" },
  },
];

export const MAINLOOP_CLOSING =
  "After handover, the client’s own team can re-run the analysis on fresh data to see whether the waits came down. And because logs show where work waits, not why, it complements time on site rather than replacing it.";
