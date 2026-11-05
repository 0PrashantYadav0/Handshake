// The agent desk with real Claude and the real PayPal sandbox (docs/agents.md). Each run places one sandbox hold.
import { expect, test, type Page } from "@playwright/test";
import { pass2fa } from "./flows";
import { approveInPopup } from "./paypal-popup";

async function runDesk(page: Page, scenario: "honest" | "cheat") {
  await page.goto("/signin?next=/agents");
  await page.getByTestId("persona-buyer").click();
  await pass2fa(page);
  await page.goto("/agents");
  await page.getByTestId(`desk-${scenario}`).click();
  await page.getByTestId("desk-start").click();

  // The agents negotiate and sign on their own, then stop at the person's step.
  const gate = page.getByTestId("desk-gate");
  await expect(gate).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("desk-say").first()).toBeVisible();
  await expect(page.getByTestId("desk-tool").filter({ hasText: "sign_contract" })).toHaveCount(2);

  const buttons = page.frameLocator('iframe[name^="__zoid__paypal_buttons"]').first();
  await expect(buttons.locator('[data-funding-source="paypal"]')).toBeVisible({ timeout: 30_000 });
  let popup!: Page;
  await expect(async () => {
    [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5_000 }), buttons.locator('[data-funding-source="paypal"]').click()]);
  }).toPass({ timeout: 60_000 });
  await approveInPopup(popup);
  await popup.waitForEvent("close", { timeout: 60_000 });
}

test("hijacking seller: the injected budget changes nothing, and the purchase itself is refused by code", async ({ page }) => {
  await page.goto("/signin?next=/agents");
  await page.getByTestId("persona-buyer").click();
  await pass2fa(page);
  await page.goto("/agents");
  await page.getByTestId("desk-hijack").click();
  await page.getByTestId("desk-start").click();
  await expect(page.getByTestId("desk-guard").filter({ hasText: "over this agent's ceiling" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("desk-gate")).toHaveCount(0);
});

test.describe("with the sandbox buyer", () => {
test.skip(!process.env.E2E_PAYPAL_BUYER_EMAIL || !process.env.E2E_PAYPAL_BUYER_PASSWORD, "Needs the sandbox buyer: E2E_PAYPAL_BUYER_EMAIL and E2E_PAYPAL_BUYER_PASSWORD");

test("honest seller: two agents make the deal, a person approves the hold, the rule releases the money", async ({ page }) => {
  await runDesk(page, "honest");
  await expect(page.getByTestId("desk-verdicts")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("desk-result").getByTestId("deal-status")).toHaveText(/^(captured|paid|in_review)$/, { timeout: 90_000 });
});

test("cheating seller: the wrong item fails twice, the hold is voided and nobody is paid", async ({ page }) => {
  await runDesk(page, "cheat");
  await expect(page.getByTestId("desk-outcome")).toContainText("Voided", { timeout: 150_000 });
});
});
