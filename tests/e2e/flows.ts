// Shared e2e steps for the trust features (trust spec §4, §6): the demo second factor and signing a contract.
import { expect, type Page } from "@playwright/test";

/** Demo persona second factor: fill the published code and continue. */
export async function pass2fa(page: Page) {
  await page.waitForURL(/\/signin\/2fa/);
  await page.getByTestId("demo-code").click();
  await expect(page.locator("#code")).toHaveValue(/^\d{6}$/);
  await page.getByTestId("verify-2fa").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

/** Signs the current version on the deal page: tick "I agree", a fresh demo code (step-up), sign with this browser's key. */
export async function signContract(page: Page) {
  await page.getByTestId("sign-contract").waitFor();
  await page.getByTestId("sign-agree").check();
  const { code } = (await (await page.request.get("/api/auth/2fa/demo-code")).json()) as { code: string };
  await page.locator("#sign-totp").fill(code);
  await page.getByTestId("accept-terms").click();
}
