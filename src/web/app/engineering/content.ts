/**
 * Copy for the Engineering page. Edit wording here; layout is in page.tsx.
 * Keep every `status` in step with the Status section of docs/build-plan.md.
 */

export type Status = "done" | "next" | "planned";

export interface Box {
  name: string;
  tech: string;
  role: string;
  status: Status;
}

/** The four parts of the system, drawn as the architecture diagram. */
export const ARCHITECTURE: Box[] = [
  {
    name: "Web app",
    tech: "Next.js 16 · React · Tailwind",
    role: "This site. Pages are rendered on the server; the engine runs in the browser for instant filtering.",
    status: "done",
  },
  {
    name: "Engine",
    tech: "TypeScript · no dependencies",
    role: "Process maps, bottlenecks, rules and costs. Pure functions, so the same code runs in the browser and on the server.",
    status: "done",
  },
  {
    name: "Mining service",
    tech: "Python · FastAPI · pm4py 2.7.23.11",
    role: "Inductive Miner discovery, conformance checking and XES import, behind an authenticated HTTP API.",
    status: "done",
  },
  {
    name: "Data",
    tech: "Supabase · Postgres · Storage",
    role: "Workspaces, uploaded logs, cost settings and rules, isolated per workspace by row-level security.",
    status: "done",
  },
];

export interface Capability {
  title: string;
  body: string;
  status: Status;
}

export interface Section {
  id: string;
  eyebrow: string;
  heading: string;
  intro: string;
  items: Capability[];
}

export const SECTIONS: Section[] = [
  {
    id: "engine",
    eyebrow: "The engine",
    heading: "What the TypeScript engine computes.",
    intro:
      "The core lives in src/engine: pure functions over a compact, dictionary-encoded event log (activities and people as integer ids, timestamps in milliseconds). On 20,000 cases and 151,000 events it builds the process map in about 230 ms.",
    items: [
      {
        title: "Directly-follows graph",
        body: "How often each step follows another, with the waiting time between them (count, median, mean, 90th percentile). The hot loop uses typed arrays instead of string-keyed maps.",
        status: "done",
      },
      {
        title: "Process map",
        body: "Celonis-style sliders that keep only the most frequent activities and paths without leaving disconnected steps, with the most common route highlighted as the happy path.",
        status: "done",
      },
      {
        title: "Variants and filters",
        body: "Every distinct route through the process with its share of cases and median duration; filters by time range, attribute, variant, duration and activity.",
        status: "done",
      },
      {
        title: "Bottlenecks",
        body: "Transitions ranked by the cost of waiting beyond their usual (median) wait, people whose cases wait notably longer than their peers, and steps repeated within a case (rework).",
        status: "done",
      },
      {
        title: "Business-hours calendar",
        body: "Waits measured in working hours as well as calendar time, so a Friday-evening handoff doesn't make Monday's approver look slow.",
        status: "done",
      },
      {
        title: "Root-cause analysis",
        body: "Which case attributes are over-represented among slow or failing cases, with sample size, lift and a z-score; small segments are flagged, and results are framed as correlation, not cause.",
        status: "done",
      },
      {
        title: "Business rules",
        body: "Precedence (approve before pay), segregation of duties, conditional approvals (over €10k needs a director), deadlines and duplicate detection, each returning the violating cases.",
        status: "done",
      },
      {
        title: "Upload and data quality",
        body: "Guesses which columns hold the case, activity, timestamp and person; reads ISO, day-first, month-first and Unix timestamps; and reports dropped rows (with line numbers), date-only or shared timestamps, duplicates, single-event cases and near-duplicate activity names before anything is saved.",
        status: "done",
      },
      {
        title: "Cost model",
        body: "Every euro split into labour (hands-on time per step, including rework), time (losses waiting causes, such as missed discounts or capital tied up, shared out over the waits that caused them) and compliance (the expected loss from control failures, net of money usually recovered), with the formula and inputs behind each figure. Waiting is never priced by itself, so no loss is counted twice.",
        status: "done",
      },
    ],
  },
  {
    id: "miner",
    eyebrow: "The mining service",
    heading: "pm4py where it's strongest.",
    intro:
      "src/miner is a Python FastAPI service built on pm4py, the standard open-source process-mining library. It verifies Supabase sign-in tokens, enforces size limits, and is built and tested on its own; it isn't wired to the web app yet.",
    items: [
      {
        title: "POST /discover/inductive",
        body: "Runs pm4py's Inductive Miner to produce a process tree and a BPMN model, laid out in-house so it renders in a browser without extra system dependencies.",
        status: "done",
      },
      {
        title: "POST /conformance/token-replay",
        body: "Replays each case against a reference model and returns its fitness, plus the share of cases that fully conform.",
        status: "done",
      },
      {
        title: "POST /import/xes",
        body: "Reads IEEE XES files, the standard exchange format for event logs, and returns normalised events.",
        status: "done",
      },
      {
        title: "Connected to the web app",
        body: "BPMN and conformance tabs in the interface, calling the service with the signed-in user's token.",
        status: "planned",
      },
    ],
  },
  {
    id: "data",
    eyebrow: "Data and security",
    heading: "Each client's data stays in its own workspace.",
    intro:
      "The database schema lives in the repo as SQL migrations, so it can be recreated exactly. Every table carries a workspace id and is protected by Postgres row-level security: members can read, editors can write.",
    items: [
      {
        title: "Schema and policies",
        body: "Workspaces, members, datasets, events, cost models, rules, saved views and AI outputs, plus storage policies for uploaded files.",
        status: "done",
      },
      {
        title: "Passwordless sign-in",
        body: "Email magic links through Supabase Auth. The first sign-in creates the account and a private workspace; a request proxy refreshes sessions and keeps the workspace pages private.",
        status: "done",
      },
      {
        title: "Isolation tests",
        body: "pgTAP tests run against a local Supabase and prove that one user can't read or change another workspace's data, cost settings included.",
        status: "done",
      },
      {
        title: "Cost settings per workspace",
        body: "Owners and analysts set the hourly rate, handling minutes, an optional capital cost and any other per-day cost of waiting; every uploaded dataset in the workspace is priced from them, and viewers can only read them.",
        status: "done",
      },
    ],
  },
  {
    id: "verified",
    eyebrow: "How it's verified",
    heading: "Numbers you can check.",
    intro: "Every capability above is covered by automated tests, run on every push.",
    items: [
      {
        title: "Hand-computed logs",
        body: "Small logs whose maps, waits, costs and rule violations were worked out by hand, so each figure is checked exactly.",
        status: "done",
      },
      {
        title: "Synthetic data with known problems",
        body: "A generated invoice-approval log for a fictional firm with five injected problems: a slow approver, a rework loop, segregation-of-duties breaks, missing approvals and duplicate payments. Tests confirm the engine finds each one.",
        status: "done",
      },
      {
        title: "Cross-check against pm4py",
        body: "The engine's process graph matches pm4py's exactly on the sample and on a second log full of tied timestamps (date-only and batch-stamped steps): transition counts, start and end steps, and waiting times in both calendar and business hours.",
        status: "done",
      },
      {
        title: "Continuous integration",
        body: "GitHub Actions runs type checks, lint, the TypeScript and Python test suites and a production build on every push.",
        status: "done",
      },
    ],
  },
];

export const ROADMAP: Capability[] = [
  {
    title: "Explorer: map, variants, bottlenecks",
    body: "Any uploaded log (or the sample) opens as an interactive process map with activity and path sliders, frequency or median-wait view, variants, and priced bottlenecks. The engine and the map layout run in a Web Worker, so the page never freezes.",
    status: "done",
  },
  {
    title: "Explorer: filters, rules, root causes, case drill-down",
    body: "Filter by time range, attribute, activity or a clicked variant, shown as removable chips with the filtered case count. Business rules with violation counts, rates and cost (a click filters to the violators); a root-cause view that ranks segments correlated with slow cases, an activity or a rule's violators, with n and small-sample and significance flags; one case's timeline; and cost settings each workspace can edit.",
    status: "done",
  },
  { title: "XES and Excel upload", body: "XES files through the mining service, and Excel workbooks, alongside CSV.", status: "next" },
  {
    title: "Proven on real data",
    body: "Run public BPI Challenge event logs (real purchase-to-pay data) and compare results with published findings.",
    status: "next",
  },
  {
    title: "Claude findings and memo",
    body: "Findings that must cite real metric IDs, an “ask your process” agent, and a go / no-go memo.",
    status: "planned",
  },
  {
    title: "Deployment",
    body: "Hosted demo with infrastructure configuration in the repo, end-to-end tests and rollback.",
    status: "planned",
  },
];
