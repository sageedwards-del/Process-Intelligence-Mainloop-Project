/**
 * The landing page's four questions. Edit wording here; layout is in page.tsx.
 * Every factual claim in answers 2–4 was checked against the listed sources
 * (opened 2026-11-01). Answer 4 is argument, tied to the job posting.
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
  label: "W. van der Aalst, “Process Mining: Overview and Opportunities”, ACM TMIS (2012)",
  href: "https://vdaalst.com/publications/p685.pdf",
};
const MICROSOFT: Source = {
  label: "Microsoft Learn: Overview of process mining in Power Automate",
  href: "https://learn.microsoft.com/en-us/power-automate/process-mining-overview",
};
const POSTING: Source = {
  label: "Mainloop: Forward Deployed Engineer job posting",
  href: "https://leytonglobal-spain.teamtailor.com/jobs/8330839-forward-deployed-engineer-mainloop",
};

export const FAQ: Faq[] = [
  {
    question: "Why was this website built?",
    answer: [
      "I built the Process Discovery Engine as a portfolio project for Mainloop. You upload an event log exported from a finance or ticketing system. It shows how the work really runs, finds where cases wait or loop back, and prices each bottleneck in labour, time and compliance, with the formula behind every figure. Claude then writes findings, answers questions about the process and drafts a go / no-go memo, and code checks every figure it cites against the engine before it’s shown.",
      "It’s useful to Mainloop because it automates the first week of a Forward Deployed Engineer engagement: map the process, size the pain, then decide whether a prototype is worth building. It’s aimed at the firms Mainloop serves, professional-services teams with manual approvals, invoice cycles and reconciliations. It works from a plain CSV export, with no data team and no enterprise licence.",
    ],
    signature: "— Sage Edwards",
  },
  {
    question: "What is process discovery?",
    answer: [
      "Process discovery builds a map of how a process actually runs from the records it leaves behind. Business systems log each step, such as an invoice being registered, approved or paid. Each record is an event tied to a case (one invoice) and an activity (what happened), and often a timestamp and the person who did it. Put a case’s events in order and you get one real run of the process; put thousands together and you see the real flow, including the detours.",
      "Discovery is one of three kinds of process mining, alongside conformance checking (comparing reality with the intended process) and enhancement (adding facts like waiting times to the map). Process models used to be drawn by hand, without event data; discovery starts from evidence instead.",
    ],
    sources: [VAN_DER_AALST, MICROSOFT],
  },
  {
    question: "Who uses process discovery?",
    answer: [
      "Mostly organisations with busy back offices: finance and accounts-payable teams, operations, customer service, and auditors. The usual targets are high-volume, rule-heavy processes like purchase-to-pay, order-to-cash and accounts receivable.",
      "Two published examples: Deutsche Telekom reports saving more than €66M in its procure-to-pay process (a figure published by its software vendor, Celonis). And the City of Vienna’s Court of Audit used process mining to audit purchase-to-pay at Wiener Stadtwerke, the city’s infrastructure group, checking segregation of duties and the four-eyes principle.",
      "It’s now an established software category. Gartner published its first Magic Quadrant for process mining in 2023, and the tools are offered by specialists like Celonis and by platforms like Microsoft Power Automate.",
    ],
    sources: [
      {
        label: "Celonis: 12+ case studies (vendor-reported figures)",
        href: "https://celonis.com/blog/12-case-studies-that-drive-home-the-power-of-process-mining",
      },
      {
        label: "Fluxicon: Auditing with process mining, Part II (2023)",
        href: "https://fluxicon.com/blog/2023/02/auditing-data-analysis-concept/",
      },
      {
        label: "Celonis: first Gartner Magic Quadrant for Process Mining Tools (2023)",
        href: "https://www.celonis.com/news/press/celonis-named-a-leader-in-first-ever-2023-gartner-magic-quadrant-for-process-mining-tools",
      },
      MICROSOFT,
    ],
  },
  {
    question: "How could process discovery help Mainloop?",
    answer: [
      "Process discovery is flexible. It works on any system that records what happened and when, and the same analysis can be run by whoever holds the data. So it could help Mainloop in two ways:",
    ],
    bullets: [
      {
        lead: "For Forward Deployed Engineers.",
        text: "Before a site visit, an export from the client’s system shows where cases wait or loop back, so interviews start from evidence and focus on the right steps. Waits, rework and control breaks can be counted and priced, which gives the benefit estimate, and an honest “no”, a basis anyone can check.",
      },
      {
        lead: "For Mainloop’s clients.",
        text: "After handover, a client’s own team could re-run the same analysis on fresh data to see whether the automation really cut wait times, and to spot the next bottleneck without waiting for a new engagement.",
      },
    ],
    after: [
      "It suits the work Mainloop describes: approvals, reconciliations and invoicing at professional-services firms. Its limit is that logs show where work waits, not why, so it complements on-site observation rather than replacing it.",
    ],
    sources: [POSTING, VAN_DER_AALST],
  },
];
