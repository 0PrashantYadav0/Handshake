// Shared e2e steps for the trust features (trust spec §4, §6): the demo second factor and signing a contract.
import { expect, type Page } from "@playwright/test";

/** H-2: every Content-Security-Policy violation on this page (and the pages it navigates to) lands in the returned list. */
export async function watchCsp(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)),
  );
  page.on("console", (m) => { if (m.text().startsWith("CSP violation")) seen.push(`${page.url()} ${m.text()}`); });
  return seen;
}

/** Each 30 s code works once (replay guard), so after a recent sign-in the server answers "Wait a few seconds": click again until it fills. */
async function fillDemoCode(page: Page, button: string, input: string) {
  await expect(async () => {
    await page.getByTestId(button).click();
    await expect(page.locator(input)).toHaveValue(/^\d{6}$/, { timeout: 2_000 });
  }).toPass({ timeout: 65_000, intervals: [3_000] });
}

/** Demo persona second factor: fill the published code and continue. */
export async function pass2fa(page: Page) {
  await page.waitForURL(/\/signin\/2fa/);
  await fillDemoCode(page, "demo-code", "#code");
  await page.getByTestId("verify-2fa").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

/** Signs the current version on the deal page: tick "I agree", a fresh demo code (step-up), sign with this browser's key. */
export async function signContract(page: Page) {
  await page.getByTestId("sign-contract").waitFor();
  await page.getByTestId("sign-agree").check();
  await fillDemoCode(page, "sign-demo-code", "#sign-totp");
  await page.getByTestId("accept-terms").click();
}
