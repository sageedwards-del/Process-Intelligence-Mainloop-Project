export const REPO = "https://github.com/sageedwards-del/Process-Intelligence-Mainloop-Project";

/** The commit this build came from (set by Vercel at build time), so source links match what's deployed. */
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA || "main";

/** The mining service's source at the deployed commit: the AGPL's offer of source to its network users (ADR 0004). */
export const MINER_SOURCE = `${REPO}/tree/${COMMIT}/src/miner`;

/** For reviewers: how to reach the author. Add a LinkedIn URL to show it next to the email. */
export const CONTACT_EMAIL = "sage_edwards@brown.edu";
export const LINKEDIN: string | null = null;
