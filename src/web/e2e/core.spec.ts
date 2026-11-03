import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { freshEmail, minerUp, requestLink, signIn } from "./helpers";

const MERIDIAN_CSV = resolve(__dirname, "../../../data/sample/meridian-invoices.csv");

/** A three-case XES log, small enough to write inline. */
const XES = `<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1.0" xmlns="http://www.xes-standard.org/">
${["A", "B", "C"]
  .map(
    (id, i) => `  <trace><string key="concept:name" value="${id}"/>
${["Receive", "Check", "Pay"]
  .map((act, j) => `    <event><string key="concept:name" value="${act}"/><string key="org:resource" value="clerk"/><date key="time:timestamp" value="2026-03-0${i + 1}T${String(j + 8).padStart(2, "0")}:00:00.000+00:00"/></event>`)
  .join("\n")}
  </trace>`,
  )
  .join("\n")}
</log>`;

test.describe("upload to insight", () => {
  test("sign in, upload the Meridian CSV, filter the map and find the partner delay", async ({ page }) => {
    await signIn(page, freshEmail("csv"));

    // Upload: the browser parses the CSV and guesses the mapping.
    await page.goto("/app/upload");
    // The file input only reads files once React has hydrated.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles(MERIDIAN_CSV);
    const create = page.getByRole("button", { name: /Create dataset \(37,587 events\)/ });
    await expect(create).toBeEnabled();
    await create.click();
    await page.waitForURL("**/app");
    await page.getByRole("link", { name: /meridian-invoices/ }).first().click();
    await page.waitForURL("**/app/datasets/**");

    // The map renders (laid out in the worker).
    await expect(page.getByRole("img", { name: /^Process map: \d+ activities/ })).toBeVisible({ timeout: 60_000 });
    const filters = page.getByRole("region", { name: "Filters" });
    await expect(filters).toContainText("5,050 of 5,050 cases");

    // A variant filter changes the counts.
    await page.getByRole("heading", { name: "Variants" }).click();
    await page.getByRole("button", { name: /^Variant 1: .* Filter to these cases/ }).click();
    await expect(filters).not.toContainText("5,050 of 5,050 cases");
    await expect(filters).toContainText(/[\d,]+ of 5,050 cases/);
    await page.getByRole("button", { name: /^Remove filter: Variant 1/ }).click();
    await expect(filters).toContainText("5,050 of 5,050 cases");

    // The bottleneck list names the injected partner delay.
    await page.getByRole("heading", { name: "Bottlenecks" }).click();
    await page.getByText("People whose cases wait longer than peers").click();
    await expect(page.getByRole("listitem").filter({ hasText: /P\. Moreau on Partner Approval.*slower/ })).toBeVisible();
  });

  test("XES goes through Storage and the miner, and the dataset gets a BPMN model", async ({ page }) => {
    test.skip(!(await minerUp()), "needs the miner on MINER_URL (default http://127.0.0.1:8010)");
    await signIn(page, freshEmail("xes"));

    await page.goto("/app/upload");
    // The file input only reads files once React has hydrated.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles({ name: "tiny.xes", mimeType: "application/xml", buffer: Buffer.from(XES) });
    const create = page.getByRole("button", { name: /Create dataset \(9 events\)/ });
    await expect(create).toBeEnabled({ timeout: 60_000 });
    await create.click();
    await page.waitForURL("**/app");
    await page.getByRole("link", { name: "tiny" }).first().click();

    await page.getByRole("button", { name: "Discover the BPMN model" }).click();
    await expect(page.getByRole("img", { name: "Discovered BPMN process model" })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".djs-element").first()).toBeAttached();
    await page.getByRole("tab", { name: "Conformance" }).click();
    await page.getByRole("button", { name: "Check conformance" }).click();
    await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 90_000 });
  });
});

test("a sign-in link works in a different browser than the one that asked for it", async ({ page, browser }) => {
  const link = await requestLink(page, freshEmail("other-browser"));
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const phone = await other.newPage();
  await phone.goto(link);
  await phone.waitForURL("**/app");
  await expect(phone.getByText(/^Signed in as e2e-other-browser-/)).toBeVisible();
  // The link works once.
  const again = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await again.goto(link);
  await again.waitForURL("**/login?error=link");
  await other.close();
});

test.describe("public demo", () => {
  // Insights come from the committed demo outputs (lib/ai/demo-outputs/), not a live model call.
  test("Meridian demo shows insights, the BPMN model and conformance without signing in @phone", async ({ page }) => {
    await page.goto("/sample/meridian");
    await expect(page.getByRole("img", { name: /^Process map/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("How this process runs")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recommended actions" })).toBeVisible();
    await expect(page.locator(".bjs-powered-by")).toBeAttached();
    await page.getByRole("tab", { name: "Conformance" }).click();
    await expect(page.getByText("84.8%")).toBeVisible();
    // No horizontal page scroll at any width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("security headers and robots", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await request.get("/login")).headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /app");
  });
});
