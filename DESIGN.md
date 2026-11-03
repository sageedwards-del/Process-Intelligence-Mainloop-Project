# Design

The visual and writing rules for the web app (`src/web`). Tokens live in
[`src/web/app/globals.css`](src/web/app/globals.css); this file says how to use them. The architecture is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Who it's for

An ops or finance manager, not a process-mining analyst. Business impact comes first: what it costs, where, and how sure
we are. Algorithm depth is available but never in the way.

## Direction: light and editorial

Paper-light pages, near-black type, a faint dot grid, generous whitespace, thin hairline borders, almost no shadow.
Chosen from three mock-ups over an earlier "light app, dark hero" direction; references are Mainloop's own site for the
engineered look and Celonis' network graphics for the process map.

## Colour tokens

Use the Tailwind names (`bg-surface`, `text-ink-muted`, `border-line`, `bg-primary`…), never raw hex, except the two
status colours noted below.

| Token | Light | Use |
|---|---|---|
| `--bg` | `#f6f8f8` | Page background |
| `--surface` | `#ffffff` | Cards, header, panels |
| `--ink` | `#0e1416` | Body text, headings |
| `--ink-muted` | `#4d585c` | Secondary text, nav |
| `--ink-faint` | `#7c878b` | Labels, captions, non-happy map edges |
| `--line` | `#dde4e5` | Borders and dividers |
| `--dot` | `#cbd4d6` | The dot grid |
| `--primary` / `--primary-hover` / `--primary-ink` | teal `#24686e` | **Action**: buttons, links, active filters, the happy path |
| `--ai-from` → `--ai-to` | `#2f6db8` → `#5a4bd6` | **Emphasis and Claude-written output** only |
| `--map-edge`, `--map-node`, `--map-muted`, `--map-callout` | | The process map (landing hero) |

Each token has a dark-mode value under `prefers-color-scheme: dark`; new tokens need both.

**Status colours** are not tokens yet: errors use `#b42318`, warnings (e.g. a small-sample flag) use `#b54708`. Use these
exact values with `role="alert"` for errors; promote them to tokens when you next touch them.

**Rules of thumb**
- Teal means "you can act on this". Don't use it for decoration.
- The indigo gradient means "this is the point" or "Claude wrote this". Use `ai-gradient` on at most one phrase per
  section, and `ai-bar` as the left edge of a card holding Claude's text.
- Red/amber appear only in the map's wait scale and in alerts.

## Type

- **Geist Sans** for prose, **Geist Mono** (`font-mono`) for figures, formulas, metric IDs and edge labels.
- `eyebrow` utility: mono, 0.75rem, 0.22em tracking, uppercase. Used for section kickers (`eyebrow text-primary`),
  field labels (`eyebrow text-[0.65rem] text-ink-faint`) and button text.
- Headings: `font-medium` with negative tracking (`tracking-[-0.02em]`, the hero `-0.035em`), not bold.
- Prose: `leading-relaxed`, `max-w-2xl` for readable lines.

## Layout

- Page frame: `mx-auto max-w-7xl px-4 sm:px-8`. Sections separated by `border-b border-line` and `py-20`–`py-24`.
- Cards: `rounded-xl border border-line bg-surface`; inner items `rounded-lg border border-line bg-bg/40`. The hero map
  card is the one place with a soft shadow.
- Empty states: `dot-grid` with a dashed `border-line`.
- Buttons: primary `eyebrow rounded-md bg-primary text-primary-ink hover:bg-primary-hover`; secondary `eyebrow
  rounded-md border border-line hover:border-ink-faint`. Chips and filter pills are `rounded-full`.
- Shared chrome: `SiteHeader`, `SiteFooter`, `Wordmark` in `src/web/components/`.

## Diagrams

- Explanatory diagrams are HTML and Tailwind, not SVG or a diagram library, so text stays real, reflows at phone width
  and needs no client JS (`components/benefits/Illustrations.tsx`, `components/engineering/DataFlow.tsx`).
- The Engineering page's data flow (`#data-flow`) is five icon tiles joined by labelled arrows: left to right from `lg`,
  top to bottom below. Tiles are `bg-primary` rounded squares with a stroke icon; the Claude step uses the AI gradient.
  One short sentence per step and a "where it runs" pill; no code names. Steps are an `<ol>`.
- Done / Next / Planned chips: `components/engineering/StatusChip.tsx`.

## Demo page

`/sample` and `/sample/meridian` (`app/sample/DemoPage.tsx`) are laid out as three numbered steps (choose data, discover the
process, generate insights), with a strip of jump links under the intro. Step 2 defines cases, events, activities and
variants in a `<dl>` with a per-demo example and a "how to read it" line (examples in `lib/analysis/demos.ts`), then
explains the map before the explorer, all inside a collapsed "Understanding process discovery terminology" `<details>`. In the explorer, Variants, Bottlenecks, Rules & violations and Root causes are collapsed panels whose summary line says what's inside (route count and top share; the top wait; rules broken and in how many cases). Bottlenecks is itself a stack of `<details>` groups with counts; only "Costliest waits between steps" starts open. Variants show the top four, each route behind a "N steps" toggle (click, not hover, so it works on touch), with a "show the top 12 of N" button (the analysis keeps the 12 most common). Step 3 says what each Claude tab does before the AI panel.

## Process model and conformance

`components/miner/ModelPanel.tsx`, a card under the explorer on the demos and every dataset, with two tabs like the AI
panel. **BPMN model** draws bpmn-js's `NavigatedViewer` in a `dot-grid` box sized to the diagram's shape (240–520 px tall),
fitted to the viewport, pan and zoom by mouse; the bpmn.io watermark must stay visible (bpmn-js licence). **Conformance**
is a four-figure `<dl>` (fit rate, fitting / all, average and log fitness), steps that don't fit by case count, a
weekly bar strip in teal (paler for thin weeks), a collapsed lowest-fitness case list and a button to show the
reference model. Copy says the reference is "the way most cases go", not the intended process, and that differences
need checking with the people who do the work. Demos show committed results at once; datasets show a dashed empty
state with one primary button per tab.

## AI-powered insights

Product pages say "AI" / "AI-powered insights" and don't name the model; the Engineering page, code and docs do. The
Insights tab shows a highlighted "How this process runs" summary (`ai-bar` edge), then "Recommended actions" as closed
`<details>`: a numbered teal dot, the action as an instruction and a confidence chip; opened, Why, Expected impact,
First steps, Verify on site, and the numbered sources. Demo cards carry a small icon tile (`app/sample/DemoArt.tsx`;
teal for real data, the AI gradient for synthetic) and a large one on dot grid beside the selected demo's description.

## Header, footer and error pages

The header has Demo, Validation, Benefits and Engineering, plus one account button: "Workspace" when signed in,
"Sign in" otherwise. The button reads the session inside `<Suspense>`, so pages stay prerendered. On phones the links wrap
to their own row under the wordmark; nothing is hidden. The footer carries the contact email, the MIT licence, the Source link (at the deployed commit, which also serves the
miner's AGPL source offer) and the Mainloop/Leyton disclaimer. `app/not-found.tsx` and
`app/error.tsx` keep the site's look and always offer a way home.

## Phone width

Every page must work at **375 px with no horizontal page scroll**. Stack grids below `lg`, hide secondary nav below
`md`, give flex children `min-w-0` so long activity names wrap, and let the process map scroll inside its own container
rather than the page. Check desktop and 375 px in the browser before calling UI work done.

## The process map

Our own SVG (`components/explorer/ProcessMapView.tsx`), laid out by ELK top to bottom with orthogonal routes.
- Edge width = frequency (1–7 px); the happy path is teal, other edges `--ink-faint` at lower opacity.
- With the median-wait KPI, edges run teal → amber → red relative to the edges on screen; edges out of Start and into
  End carry no wait and get no colour or label.
- Edge labels are mono in a small `surface` pill; every edge has a `<title>` with count and median wait.
- The landing hero animates case tokens along the happy path (`.case-token`) and turns them off under
  `prefers-reduced-motion`.

## Numbers and Claude's text

- Every currency figure shows its formula (built from the `CostModel`); figures are mono. Use the helpers in
  `components/explorer/format.ts` (`formatMoney`, `formatDuration`, `formatInt`) rather than formatting inline.
- Show n beside every rate, flag small samples, and say "correlated with", never "caused by".
- Claude's text appears only after the grounding check passes. Citations render through `components/ai/Cited.tsx`:
  each `[[metric id]]` becomes a small teal numbered marker (`[1]`, mono, the ID in its tooltip) pointing at a
  collapsible sources list that shows each metric's figures and formula.

## Copy

- Plain, short sentences for a manager. Name the money and the step, then the evidence.
- Only claim what's built. The Engineering page marks each capability done / next / planned; keep landing copy in step.
- Product name on screen: "Process Discovery Engine *for Mainloop*". "Throughline" is the internal codename.

## Accessibility

Semantic elements first (native `<details>` for the FAQ, a `<dialog>` for the case drill-down, real buttons), `aria-label`
on the map SVG, `role="alert"` for errors, visible focus, and motion only where it can be turned off.
