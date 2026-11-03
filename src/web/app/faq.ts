/**
 * The landing page's three questions. Edit wording here; layout is in page.tsx.
 * Every factual claim in answers 2–3 was checked against the listed sources
 * (opened 2026-11-01; answer 3 rewritten and re-checked 2026-11-02; answer 2 re-sourced to the 2022 Process Mining Handbook 2026-11-02). Keep 1–3 sources per answer. The Mainloop pitch lives on the Benefits page (benefits/content.ts).
 */

export interface Source {
  label: string;
  href: string;
}

export interface Faq {
  question: string;
  answer: string[];
  /** Rendered as a bulleted list after the first paragraph. */
  bullets?: { lead: string; text: string }[];
  /** Paragraphs after the bullets. */
  after?: string[];
  signature?: string;
  sources?: Source[];
}

const VAN_DER_AALST: Source = {
  label: "W. van der Aalst, “Process Mining: A 360 Degree Overview”, Process Mining Handbook, Springer (2022, open access)",
  href: "https://link.springer.com/chapter/10.1007/978-3-031-08848-3_1",
};
const MICROSOFT: Source = {
  label: "Microsoft Learn: Overview of process mining in Power Automate",
  href: "https://learn.microsoft.com/en-us/power-automate/process-mining-overview",
};

export const FAQ: Faq[] = [
  {
    question: "Why was this website built?",
    answer: [
      "I built the Process Discovery Engine as a portfolio project for Mainloop. Your work at the frontier of consulting, software development, and agentic coding is very exciting, and I wanted to build something an FDE could actually use on an engagement!",
    ],
    signature: "— Sage Edwards, Brown University",
  },
  {
    question: "What is process discovery?",
    answer: [
      "Process discovery builds a map of how a process actually runs from the records it leaves behind. Business systems log each step, such as an invoice being registered, approved or paid. Each record is an event tied to a case (one invoice), an activity (what happened) and a timestamp, and often the person who did it. Put a case’s events in order and you get one real run of the process; put thousands together and you see the real flow, including the detours.",
      "Discovery is one part of process mining. The discovered map can then be compared with the intended process (conformance checking) and overlaid with performance figures such as waiting times. Process models can also be drawn by hand; discovery starts from evidence instead.",
    ],
    sources: [VAN_DER_AALST],
  },
  {
    question: "Who uses process discovery, and why?",
    answer: [
      "Most companies already have the raw material. Business software, from ERP and finance systems to CRM and ticketing tools, records each step a case goes through and when it happened. Process discovery turns those records into a picture of where work actually waits, loops back or skips a step: the bottlenecks.",
      "Its main users are organisations with busy back offices: finance and accounts-payable teams, operations, customer service and auditors, on high-volume, rule-heavy processes like purchase-to-pay and order-to-cash. Once a bottleneck is visible it can be measured and priced, so they can see which fixes would save the most money, and which aren’t worth it.",
      "The savings can be large. Deutsche Telekom reports saving more than €66M in procure-to-pay by tackling duplicate payments and lost cash discounts (a figure published by its software vendor, Celonis). It’s now an established software category: Gartner published its first Magic Quadrant for process mining in 2023.",
    ],
    sources: [
      MICROSOFT,
      {
        label: "Celonis: 12+ case studies (vendor-reported figures)",
        href: "https://celonis.com/blog/12-case-studies-that-drive-home-the-power-of-process-mining",
      },
      {
        label: "Celonis: first Gartner Magic Quadrant for Process Mining Tools (2023)",
        href: "https://www.celonis.com/news/press/celonis-named-a-leader-in-first-ever-2023-gartner-magic-quadrant-for-process-mining-tools",
      },
    ],
  },
];
