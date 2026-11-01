# @throughline/web

The Throughline web app: Next.js 16 (App Router, Turbopack), Tailwind 4, server-side use of
`@throughline/engine`.

```bash
npm run dev                          # from the repo root, http://localhost:3000
npm run build -w @throughline/web    # production build
```

- `app/globals.css`: design tokens (light app, dark hero) and small utilities (`eyebrow`, `dot-grid`).
- `lib/heroMap.ts`: lays out the Meridian sample's process map for the landing hero (engine + ELK, cached).
- `lib/sampleFigures.ts`: the landing page's cost figures, computed by the engine.

This Next.js version differs from older ones: read `AGENTS.md` and `node_modules/next/dist/docs/` first.
