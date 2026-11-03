import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * README screenshots and the demo GIF's frames, on the public Meridian demo. Not part of the
 * normal run: `MEDIA=1 npx playwright test e2e/media.spec.ts --project desktop`, then
 * `scripts/make-demo-gif.py` (see its header) turns the frames into docs/media/demo.gif.
 */
test.skip(!process.env.MEDIA, "set MEDIA=1 to regenerate docs/media");

const OUT = resolve(__dirname, "../../../docs/media");
let frame = 0;
const shot = (page: Page, name?: string) =>
  Promise.all([
    name ? page.screenshot({ path: `${OUT}/${name}.png` }) : null,
    page.screenshot({ path: `${OUT}/frames/${String(frame++).padStart(2, "0")}.png` }),
  ]);
const settle = (page: Page) => page.waitForTimeout(800);
/** Scroll so the element sits near the top of the viewport. */
const top = (l: Locator, offset = 24) => l.evaluate((el, o) => (el.scrollIntoView({ block: "start" }), window.scrollBy(0, -o)), offset);
/** Hide the dev server's badge from the shots. */
const clean = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

test.use({ viewport: { width: 1280, height: 800 } });

test("README screenshots and demo frames", async ({ page }) => {
  await page.goto("/");
  await clean(page);
  await settle(page);
  await shot(page, "home");

  await page.goto("/sample/meridian");
  const map = page.getByRole("img", { name: /^Process map/ });
  await expect(map).toBeVisible({ timeout: 60_000 });
  await clean(page);
  await top(page.getByRole("region", { name: "Filters" }));
  await settle(page);
  await shot(page, "explorer");
  await top(page.getByRole("radiogroup", { name: "Show on paths" }), 40);
  await settle(page);
  await shot(page, "map");

  await page.getByRole("heading", { name: "Variants" }).click();
  await page.getByRole("button", { name: /^Variant 2: .* Filter to these cases/ }).click();
  await top(page.getByRole("region", { name: "Filters" }));
  await settle(page);
  await shot(page);
  await page.getByRole("button", { name: /^Remove filter: Variant 2/ }).click();
  await page.getByRole("heading", { name: "Variants" }).click();

  await page.getByRole("heading", { name: "Bottlenecks" }).click();
  await page.getByText("People whose cases wait longer than peers").click();
  await top(page.getByRole("heading", { name: "Bottlenecks" }), 40);
  await settle(page);
  await shot(page, "bottlenecks");

  await top(page.getByRole("heading", { name: "Process model and conformance" }), 60);
  await page.waitForTimeout(1500);
  await shot(page, "bpmn");
  await page.getByRole("tab", { name: "Conformance" }).click();
  await settle(page);
  await shot(page, "conformance");

  await top(page.getByText("How this process runs").first(), 140);
  await settle(page);
  await shot(page, "insights");
});

test("phone screenshot", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto("/sample/meridian");
  await expect(page.getByRole("img", { name: /^Process map/ })).toBeVisible({ timeout: 60_000 });
  await clean(page);
  await top(page.getByRole("region", { name: "Filters" }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phone.png` });
  await page.close();
});
