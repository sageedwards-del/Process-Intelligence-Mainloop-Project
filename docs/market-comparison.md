# Market comparison

Where the Process Discovery Engine (codename Throughline) sits next to the process-intelligence products a client
may already own or be evaluating. Facts were checked on 2026-11-02 against the sources at the end; vendor figures are
as each vendor states them. The site's FAQ ("Who are the industry leaders…", `src/web/app/faq.ts`) is the short,
public version of this page.

## The market in one paragraph

Gartner's 2026 Magic Quadrant for Process Intelligence Platforms names **Celonis, SAP Signavio, ARIS and Pega** as
Leaders. Microsoft (Power Automate Process Mining), UiPath, IBM and Apromore (acquired by Salesforce, completed
November 2025) sell well-known tools. **pm4py** and **ProM** are the main free, open-source options, used mostly in
research and teaching. Fluxicon **Disco** remains the analyst's favourite for fast CSV-to-map work.

## Comparison

| | Celonis | SAP Signavio | ARIS | Power Automate PM | Disco / Apromore | pm4py | **Process Discovery Engine** |
|---|---|---|---|---|---|---|---|
| Built for | Enterprise transformation programmes | SAP estates, S/4HANA moves | Process modelling plus mining | Microsoft Power Platform shops | Process analysts | Researchers, data scientists | An ops or finance manager in the first days of an engagement |
| Data in | 100+ live connectors, object-centric data model | SAP extractors | Connectors | Dataverse, connectors | CSV, XES | Python, CSV, XES, OCEL | CSV, Excel, XES upload (50 MB) |
| Time to first map | Weeks to months (data engineering) | Weeks | Weeks | Days | Minutes | Minutes, with code | Minutes |
| Cost sizing | Value frameworks, consultant-led | Value accelerators | Cost attributes | Basic | None | None | Every figure from an editable cost model, formula shown (labour, time, compliance; waiting priced only through its consequences, ADR 0002) |
| AI | Copilot, agent tools (MCP) | Joule | AI assistant | Copilot | — | — | Insights, Ask and a go / no-go memo; every cited figure checked by code before it's shown (ADR 0005) |
| Conformance | Yes | Yes | Yes | Limited | Apromore: yes | Yes (token replay, alignments) | Token replay against the most common paths, BPMN via pm4py |
| Price | Enterprise licence, on request | Enterprise licence | Enterprise licence | Listed: process-mining add-on $5,000 per tenant per month | Disco: licence; Apromore: enterprise / community | Free, AGPL-3.0 | Free, MIT (miner AGPL via pm4py) |
| Track record | Market leader, large install base | SAP install base | Long-established | Microsoft distribution | Widely used in teaching and audit | De-facto research library | One person's portfolio project |

## Where it fits

It does not compete with the platforms. Its slot is **the first one or two weeks of an engagement at a mid-market
firm**: one process, an export rather than a connector, no data team and no licence yet, and a need for a defensible
"fix this / don't bother" answer with the money sized. That is the Forward Deployed Engineer loop the project was built
around: discover, size, prototype, go / no-go.

**What it does that the others don't do by default**
- Shows the formula for every currency figure, built from a cost model the reader can edit.
- Refuses to price waiting as labour; classifies waits (queue, nights, batch runs, planned dates, automatic steps) and
  counts only queue time beyond the usual as excess (ADR 0003).
- Lets the AI write, but shows nothing whose cited metrics don't exist or whose numbers don't match them.
- Is validated in public: BPIC 2020 and 2019 results match published analyses; the engine's process graph matches
  pm4py exactly (`docs/validation.md`).

**What it lacks** (and won't pretend to have): live connectors, object-centric mining (OCEL 2.0 import is a possible
next step), task mining, real-time monitoring, a query language, enterprise support and a track record.

## When to recommend something else

| Situation | Recommend |
|---|---|
| The client already runs Celonis or Signavio | Use it; bring this method (cost model, wait classification, grounded write-up) to its data |
| Many processes, live monitoring, action automation | Celonis or another Leader |
| An analyst wants to explore a log quickly, no cost question | Disco or Apromore |
| A data scientist wants algorithms and notebooks | pm4py |
| One process, an export, and "is this worth fixing?" | The Process Discovery Engine |

## Sources

- Celonis, Leader in the 2026 Gartner Magic Quadrant for Process Intelligence:
  https://www.celonis.com/news/press/celonis-recognized-as-a-leader-in-the-2026-gartner-magic-quadrant-for-process-intelligence
- SAP News, SAP Signavio a Leader in the 2026 Gartner Magic Quadrant:
  https://news.sap.com/2026/05/sap-signavio-gartner-magic-quadrant-process-intelligence-platforms/
- ARIS, Leader in the 2026 Gartner Magic Quadrant: https://aris.com/newsroom/aris-leader-in-gartner-magic-quadrant-for-process-intelligence/
- Pega, Leader in the 2026 Gartner Magic Quadrant:
  https://www.nasdaq.com/press-release/pega-named-leader-gartnerr-magic-quadranttm-process-intelligence-2026-05-12
- Microsoft Power Automate pricing: https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing
- Salesforce, agreement to acquire Apromore: https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-apromore/
- pm4py: https://github.com/process-intelligence-solutions/pm4py
- Positioning and the original comparison: `docs/build-plan.md` ("Positioning").
