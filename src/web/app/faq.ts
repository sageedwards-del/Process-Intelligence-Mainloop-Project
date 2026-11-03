/**
 * The landing page's questions. Edit wording here; layout is in page.tsx.
 * Every factual claim in answers 2–5 was checked against its listed sources: answers 2–3 on 2026-11-01/02, answers 4–5
 * on 2026-11-02 at the original pages (company figures are quoted as each source states them, and most are vendor- or
 * customer-reported, which answer 4 says). Re-check prices and analyst rankings before relying on them; they change.
 * The Mainloop pitch lives on the Benefits page (benefits/content.ts).
 */

export interface Source {
  label: string;
  href: string;
}

export interface Faq {
  question: string;
  answer: string[];
  /** A small table after the first paragraphs; it scrolls inside its own box on phones. */
  table?: { caption: string; columns: string[]; rows: string[][] };
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
      "Every time someone registers an invoice, approves an expense or closes a ticket, the system records it: which case, what happened and when. Process discovery reads those records and draws a map of how the work actually flows.",
    ],
    bullets: [
      { lead: "A case", text: "is one thing moving through the process, such as one invoice." },
      { lead: "An event", text: "is one recorded step in that case, with its time." },
      { lead: "A variant", text: "is one route a case took from start to finish." },
    ],
    after: [
      "The map rarely matches the official process chart. It shows the detours, repeats and waits that a diagram drawn in a meeting leaves out. Discovery is one part of process mining: with the map in hand, teams compare it with the intended process and measure where the time goes.",
    ],
    sources: [VAN_DER_AALST],
  },
  {
    question: "Who uses process discovery, and why?",
    answer: [
      "Mostly organisations with busy back offices: finance, procurement, operations, customer service and audit. They use it on processes that run thousands of times and follow rules, such as paying suppliers or fulfilling orders. They're looking for:",
    ],
    bullets: [
      { lead: "Delays:", text: "where cases sit waiting, and at whose desk." },
      { lead: "Rework:", text: "steps done twice, like an invoice sent back and resubmitted." },
      { lead: "Broken rules:", text: "payments made without approval, or the same invoice paid twice." },
      { lead: "What to automate:", text: "manual steps that are frequent and predictable enough to be worth it." },
    ],
    after: [
      "Because every case leaves a trail, the answers are measured rather than guessed, so a team can see which fix would pay off before spending money on it.",
    ],
    sources: [MICROSOFT, VAN_DER_AALST],
  },
  {
    question: "What have companies found with it?",
    answer: [
      "A few published examples. Most of these figures come from the software vendor or the customer, so read them as reported results of wider improvement programmes, not audited numbers or the work of software alone.",
    ],
    bullets: [
      {
        lead: "Siemens, order handling:",
        text: "found 923,000 different routes through its order-to-cash process across 300 million activities. It reports 11% less rework and 10 million fewer manual touches a year.",
      },
      {
        lead: "Accenture, purchasing:",
        text: "found 14,000 ways a purchase request could move through its system, with turnaround up to 60 hours. It reports request-to-order time cut by 50%.",
      },
      {
        lead: "Deutsche Telekom Services Europe, paying suppliers:",
        text: "reports savings of over €66M, including €40M a year in early-payment discounts it now captures.",
      },
      {
        lead: "University Hospitals Coventry and Warwickshire (NHS), outpatient appointments:",
        text: "found 12,000 patients on more than one care pathway. After changing when reminder texts were sent, missed appointments fell from 10% to 4.4% for eligible patients, worth an estimated £2.8M a year.",
      },
      {
        lead: "İşbank, banking:",
        text: "found that 61% of cases went through an extra review step of 20 minutes each. Removing it saved 116,000 hours.",
      },
    ],
    after: ["The pattern is the same each time: the data shows something nobody had measured, and people then change the process."],
    sources: [
      { label: "Celonis: Siemens (vendor-reported)", href: "https://www.celonis.com/solutions/stories/siemens-digital-transformation-process-mining" },
      { label: "Accenture: Turning process friction into flow", href: "https://www.accenture.com/en/case-studies/about/turning-process-friction-into-flow" },
      { label: "Celonis: Accenture purchase-to-pay (vendor-reported)", href: "https://www.celonis.com/customer-success-stories/accenture-purchase-to-pay-process-mining" },
      { label: "Celonis: Deutsche Telekom procure-to-pay (vendor-reported)", href: "https://celonis.com/solutions/stories/deutsche-telekom-procure-to-pay-process-mining" },
      { label: "diginomica: Saving time and money in the NHS with process mining (28 Feb 2024)", href: "https://diginomica.com/saving-time-and-money-nhs-process-mining-and-celonis" },
      { label: "UiPath: İşbank (vendor-reported)", href: "https://www.uipath.com/resources/automation-case-studies/isbank-journey-of-operational-excellence-with-process-mining" },
    ],
  },
  {
    question: "Who are the industry leaders, and how is the Process Discovery Engine different?",
    answer: [
      "The biggest names are Celonis, SAP Signavio, ARIS and Pega, each named a Leader in Gartner's 2026 Magic Quadrant for Process Intelligence Platforms. Microsoft, UiPath, IBM and Apromore (now part of Salesforce) also sell well-known tools. pm4py and ProM are the main free, open-source options, used mostly in research.",
    ],
    table: {
      caption: "Some of the main tools",
      columns: ["Tool", "Known for", "How it's sold"],
      rows: [
        ["Celonis", "The market leader. Links each event to all the business objects it touches, and can trigger actions in other systems", "Enterprise licence, priced on request"],
        ["SAP Signavio", "Part of SAP; built around SAP systems and moves to S/4HANA", "Enterprise licence"],
        ["ARIS", "Process modelling and mining together", "Enterprise licence"],
        ["Microsoft Power Automate", "Process and task mining inside Microsoft's Power Platform", "Listed prices; the process-mining add-on is $5,000 per tenant per month"],
        ["pm4py", "Open-source Python library from research (this site's mining service uses it)", "Free, AGPL-3.0"],
      ],
    },
    bullets: [
      {
        lead: "What the Process Discovery Engine lacks:",
        text: "live connections to business systems (you upload a file), object-centric and desktop task mining, real-time monitoring, and the support and track record of a product. It's one person's project.",
      },
      {
        lead: "What it does differently:",
        text: "it's free and open source; every cost shows the formula behind it; the AI's figures are checked by code before they're shown; and its results were checked against published research and pm4py.",
      },
    ],
    after: [
      "It isn't meant to replace them. It's built for the first days of an engagement: finding where to look before anyone commits to a platform.",
    ],
    sources: [
      { label: "Celonis: Leader in the 2026 Gartner Magic Quadrant for Process Intelligence", href: "https://www.celonis.com/news/press/celonis-recognized-as-a-leader-in-the-2026-gartner-magic-quadrant-for-process-intelligence" },
      { label: "SAP News: SAP Signavio a Leader in the 2026 Gartner Magic Quadrant", href: "https://news.sap.com/2026/05/sap-signavio-gartner-magic-quadrant-process-intelligence-platforms/" },
      { label: "ARIS: Leader in the 2026 Gartner Magic Quadrant for Process Intelligence Platforms", href: "https://aris.com/newsroom/aris-leader-in-gartner-magic-quadrant-for-process-intelligence/" },
      { label: "Pega: Leader in the 2026 Gartner Magic Quadrant for Process Intelligence", href: "https://www.nasdaq.com/press-release/pega-named-leader-gartnerr-magic-quadranttm-process-intelligence-2026-05-12" },
      { label: "Microsoft: Power Automate pricing", href: "https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing" },
      { label: "Salesforce: agreement to acquire Apromore (completed 3 Nov 2025)", href: "https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-apromore/" },
      { label: "pm4py on GitHub", href: "https://github.com/process-intelligence-solutions/pm4py" },
    ],
  },
];
