export const REPO = "https://github.com/sageedwards-del/process-discovery-engine";

/** The commit this build came from (set by Vercel at build time), so source links match what's deployed. */
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || "main";

/** The whole source at the deployed commit, mining service included: the footer's "Source" link, which is also the AGPL's offer of source to the miner's network users (ADR 0004). */
export const SOURCE = `${REPO}/tree/${COMMIT}`;

/** For reviewers: how to reach the author. Add a LinkedIn URL to show it next to the email. */
export const CONTACT_EMAIL = "sage_edwards@brown.edu";
export const LINKEDIN: string | null = null;

/**
 * The canonical origin, for metadataBase, robots.txt and the sitemap: NEXT_PUBLIC_SITE_URL in
 * production, the deployment's own URL on Vercel previews, localhost otherwise.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/** SITE_NOINDEX=1 keeps the whole site out of search engines (robots.txt and a noindex header). */
export const SITE_NOINDEX = process.env.SITE_NOINDEX === "1";

/** Public pages, in the sitemap. Everything signed-in (/app, /login, /auth, /api) is noindex. */
export const PUBLIC_PATHS = ["/", "/sample", "/sample/meridian", "/benefits", "/engineering"] as const;
