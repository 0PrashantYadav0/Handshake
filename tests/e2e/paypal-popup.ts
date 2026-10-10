// The PayPal sandbox approval popup (06 "End to end"; research/paypal.md section 8).
// Selectors below are the best-known sandbox login form as of writing. PayPal changes them without notice:
// re-record on day 1 of sandbox access with `npx playwright codegen --target playwright-test http://localhost:3000/deal/<code>`
// and paste the recorded steps here. Nothing else in the suite knows about the popup's DOM.
import type { Page } from "@playwright/test";

export async function approveInPopup(popup: Page): Promise<void> {
  const email = process.env.E2E_PAYPAL_BUYER_EMAIL;
  const password = process.env.E2E_PAYPAL_BUYER_PASSWORD;
  if (!email || !password) throw new Error("E2E_PAYPAL_BUYER_EMAIL and E2E_PAYPAL_BUYER_PASSWORD must be set");

  await popup.waitForLoadState("domcontentloaded");

  // Login: the sandbox sometimes remembers the buyer (cookie) and skips straight to the review page.
  const emailBox = popup.locator("#email");
  if (await emailBox.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false)) {
    await emailBox.fill(email);
    await popup.locator("#btnNext").click();
    await popup.locator("#password").fill(password);
    await popup.locator("#btnLogin").click();
  }

  // Review page: "Pay Now" on classic checkout, "Continue" on the newer one; #payment-submit-btn is the current id for both.
  await popup
    .getByRole("button", { name: /pay now|continue|complete purchase/i })
    .or(popup.locator("#payment-submit-btn"))
    .first()
    .click({ timeout: 60_000 });
}
