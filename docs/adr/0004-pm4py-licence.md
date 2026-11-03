# ADR 0004: pm4py is AGPL-3.0, not GPL-3.0

- **Status:** Proposed
- **Date:** 2026-11-02
- **Amends:** ADR 0001 (its last consequence assumed GPL-3.0)

## Context

ADR 0001 says pm4py is GPL-3.0 and that running it as a separate network service keeps the main app's MIT licence clean. GPL-3.0 has no network clause, so serving it over HTTP never counted as distribution. While converting the BPI Challenge logs, pm4py printed a banner saying "License: AGPL v3 — Commercial use requires open-sourcing your application", so we checked the facts.

## Facts (checked 2026-11-02)

- **We pin `pm4py==2.7.23.11`** (`src/miner/pyproject.toml`, `src/miner/uv.lock`), released to PyPI on 2026-10-15. Its wheel metadata says `License-Expression: AGPL-3.0-or-later`, its bundled `LICENSE` is the GNU Affero GPL v3, and its source headers (e.g. `pm4py/meta.py`) say "GNU Affero General Public License ... version 3 ... or any later version".
- **The change came in 2.7.12** (PyPI, 2024-11-08). Every release from 2.2.0 to **2.7.11.14** (2024-10-28, the last GPL release) declares `GPL 3.0` and ships the GPL v3 text. From 2.7.12 on, PyPI says `AGPL 3.0` and the wheel ships the AGPL v3 text. In the GitHub repo, commit `652abda1b2` on 2024-10-28 ("updated license to AGPL") is the switch. The repo had already moved from Apache to GPL in 2018 (`9004c1e036`). The CHANGELOG doesn't mention the change.
- **Who owns it:** since 2024 pm4py has been run by Process Intelligence Solutions GmbH, a spin-off of Fraunhofer FIT. The repo is now `process-intelligence-solutions/pm4py`, and GitHub reports `AGPL-3.0`.
- **The vendor's reading** (processintelligence.solutions/pm4py, Licensing and FAQ): any software that imports pm4py is a "covered work" whether or not pm4py is modified. If users reach it over a network, the vendor says the source of "your entire application" must be offered under the AGPL. The alternative is a commercial licence ("Request a Quote"; no public price), which also lists startup terms that defer fees and an evaluation licence.
- **What the AGPL text says:** §13 asks a modified version to offer its Corresponding Source to "all users interacting with it remotely through a computer network". `src/miner` imports pm4py, so it is a work based on pm4py. The Next.js app talks to the miner only over HTTP with JSON, imports none of its code, and the two are deployed apart. That is the usual line for a separate program rather than a combined work. The vendor's "entire application" wording goes further than this, and we haven't had it reviewed by a lawyer.
- **Our position today:** `src/miner/README.md#licensing` and the root `README.md` already say the miner carries AGPL obligations. `SOURCE_URL` makes `/health` report a source link. The whole repo is public and MIT-licensed. MIT is compatible with the AGPL, so the miner's own files can stay MIT while the miner plus pm4py is conveyed under AGPL terms.

## Options

| Option | What it takes | For | Against |
| --- | --- | --- | --- |
| **A. Pin the last GPL release (2.7.11.14)** | Downgrade, rerun miner tests and the pm4py cross-check | No network clause. ADR 0001's reasoning holds again | Frozen at October 2024: no fixes or security patches, and newer Python and numpy/pandas may break it (untested here). Choosing a version to avoid a licence is fragile and has to be repeated at every upgrade |
| **B. Accept the AGPL for the miner** | Keep the source public (it already is). Declare the deployed miner AGPL-3.0-or-later. Offer users a source link | Costs nothing. Matches what we already do. Keeps current pm4py | The web app must stay open (MIT is fine) or stay at arm's length over HTTP. A closed-source fork of the product, e.g. a private Mainloop build, would no longer be covered |
| **C. Buy a commercial licence** | Request a quote from Process Intelligence Solutions | No copyleft. Covers a closed product and adds support and early releases | Unknown, ongoing cost and a vendor contract. Not needed while everything is public |
| **D. Replace the pm4py endpoints** | Rewrite Inductive Miner, token replay and XES import (TS engine or a permissively licensed library) | Removes the dependency for good. One runtime | Weeks of work and a correctness risk. ADR 0001 chose pm4py to avoid exactly this. XES import is the easy part; Inductive Miner and conformance are hard |

## Recommendation

**Option B for now, with D as the exit if the product ever needs to be closed source.**

The repository is public and MIT, so the AGPL asks for nothing we don't already do, as long as we:

1. Treat the deployed miner as AGPL-3.0-or-later: mention it in the miner's README and `pyproject.toml` description and keep `SOURCE_URL` set in production. Changing the `license` field is a separate, deliberate change.
2. Give end users a source link they can actually reach. Users reach the miner through the web app, not through `/health`, so add one where miner results appear (BPMN and conformance views) or in the site footer. It should point at the deployed commit.
3. Keep the boundary clean: the web app calls the miner only over HTTP, and no pm4py code or miner Python is bundled into the web app.
4. Decide again before any closed-source or white-label deployment. At that point the choice is C (quote) or D (replace), and D should start with XES import, the cheapest of the three to own.

Option A isn't recommended: we'd be dodging the licence by freezing on a two-year-old release with no security fixes.

## Consequences

- ADR 0001's last consequence ("pm4py is GPL-3.0 ... keeps the main app's MIT license clean") is wrong about the licence. The separate-service design still keeps the web app's own code out of the miner's covered work, but the miner itself now has a network source obligation.
- M6 (deploy) gains two checks: `SOURCE_URL` is set, and a source link is shown in the app.
- Progress (2026-11-02): the footer's "Source" link on every page points at the whole repository, miner included, at the deployed commit (`VERCEL_GIT_COMMIT_SHA`, `src/web/lib/site.ts`); that is the prominent offer of source. The Engineering page's mining-service section says pm4py is AGPL-3.0 and where the source is. (A separate AGPL line in the footer was tried and removed at the user's request; it isn't required by the licence.) Still to do at deploy: set `SOURCE_URL` on the miner. This ADR stays Proposed until the user accepts option B.
- If Throughline's licence or distribution model changes, revisit this ADR first.

## Sources

- PyPI JSON API, per version: `https://pypi.org/pypi/pm4py/<version>/json` (fields `license`, `license_expression`, upload times), and the wheels for 2.7.11.14 and 2.7.12 (bundled `LICENSE`, `pm4py/meta.py` header).
- Installed wheel: `pm4py-2.7.23.11.dist-info/METADATA`, `licenses/LICENSE`, and the banner in `pm4py/__init__.py`.
- GitHub: `https://github.com/process-intelligence-solutions/pm4py`, history of `LICENSE` (commits `652abda1b2` 2024-10-28 and `457b659248` 2024-11-08).
- Vendor licensing page and FAQ: `https://processintelligence.solutions/pm4py#licensing`.
- GNU AGPL v3, §13: `https://www.gnu.org/licenses/agpl-3.0.html`.
