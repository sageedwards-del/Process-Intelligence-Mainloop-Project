import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitSearch {
  messages: { ID: string; To: { Address: string }[] }[];
}

/** Signs in with a magic link: submits /login, reads the email from local Supabase's Mailpit, follows the link. */
/** Asks for a sign-in link on /login and returns it from local Supabase's Mailpit. */
export async function requestLink(page: Page, email: string, next = "/app"): Promise<string> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(email)).toBeVisible();

  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await res.json()) as MailpitSearch;
        if (!messages[0]) return false;
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
        link = /href="([^"]*\/auth\/confirm\?token_hash=[^"]*)"/.exec(msg.HTML)?.[1]?.replaceAll("&amp;", "&");
        return Boolean(link);
      },
      { message: "the sign-in email (token-hash template) arrives in Mailpit", timeout: 30_000 },
    )
    .toBe(true);
  // Local Supabase's Site URL is 127.0.0.1:3000; open the link on the test's own origin so the cookie lands there.
  const url = new URL(link!);
  return `${url.pathname}${url.search}`;
}

/** Signs in with a magic link read from Mailpit. */
export async function signIn(page: Page, email: string, next = "/app") {
  await page.goto(await requestLink(page, email, next));
  await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
}

/** A fresh address per run, so every run gets a new user and workspace (and a fresh AI limit). */
export const freshEmail = (tag: string) => `e2e-${tag}-${Date.now()}@throughline.test`;

/** True when the miner answers /health (the XES and BPMN steps need it). */
export async function minerUp(): Promise<boolean> {
  const url = process.env.MINER_URL ?? "http://127.0.0.1:8010";
  try {
    return (await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
