// The one e2e: real UI, real PayPal sandbox, real Claude (06 "End to end", ten steps). Testids from 08 section 4.7.
import { expect, test, type Page } from "@playwright/test";
import { approveInPopup } from "./paypal-popup";

const CODE = /^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;
const status = (page: Page) => page.getByTestId("deal-status").first();

test("judge happy path: sentence to released payment", async ({ page: buyer, browser }) => {
  // 1. Buyer persona
  await buyer.goto("/");
  await buyer.getByTestId("persona-buyer").click();
  await expect(buyer.locator("header")).toContainText("Demo Buyer");

  // 2. Preset sentence -> extracted terms -> save
  await buyer.goto("/new");
  await buyer.getByTestId("preset-sentence").first().click();
  await buyer.getByTestId("extract-terms").click();
  const conditions = buyer.getByRole("group", { name: "Conditions" }).locator("li");
  await expect(conditions).toHaveCount(3, { timeout: 45_000 });
  await expect(conditions.last()).toContainText("written by hand");
  const code = (await buyer.getByTestId("deal-code").textContent())?.trim() ?? "";
  expect(code).toMatch(CODE);
  await buyer.getByTestId("save-terms").click();

  // 3. Sample listing photos -> accept -> share link
  await buyer.getByTestId("use-sample-reference").click();
  await expect(buyer.locator('img[alt^="Listing photo"]')).toHaveCount(2);
  await buyer.getByTestId("accept-and-share").click();
  await expect(buyer.locator("#share-url")).toHaveValue(new RegExp(`/deal/${code}$`));

  // 4. Seller in a second context: sign in, preview, join, accept
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await seller.goto(`/deal/${code}`);
  await seller.getByTestId("persona-seller").click();
  await expect(seller.getByTestId("deal-code")).toHaveText(code);
  await seller.getByTestId("join").click();
  await seller.getByTestId("accept-terms").click();
  await expect(status(seller)).toHaveText("terms_agreed");

  // 5. Buyer sees terms_agreed and the PayPal buttons iframe
  await buyer.goto(`/deal/${code}`);
  await expect(status(buyer)).toHaveText("terms_agreed");
  const buttons = buyer.frameLocator('iframe[name^="__zoid__paypal_buttons"]').first();
  await expect(buttons.locator('[data-funding-source="paypal"]')).toBeVisible({ timeout: 30_000 });

  // 6. Approve in the sandbox popup -> held
  test.skip(
    !process.env.E2E_PAYPAL_BUYER_EMAIL || !process.env.E2E_PAYPAL_BUYER_PASSWORD,
    "Steps 6-10 need the sandbox buyer: set E2E_PAYPAL_BUYER_EMAIL and E2E_PAYPAL_BUYER_PASSWORD (README, sandbox personal account 1)",
  );
  const popup = await Promise.all([
    buyer.waitForEvent("popup"),
    buttons.locator('[data-funding-source="paypal"]').click(),
  ]).then(([p]) => p);
  await approveInPopup(popup);
  await popup.waitForEvent("close", { timeout: 60_000 });
  await expect(status(buyer)).toHaveText("held", { timeout: 30_000 });

  // 7. Seller submits the good sample -> verdicts
  await seller.reload();
  await seller.getByTestId("use-sample-evidence-good").click();
  await expect(seller.locator('img[alt^="Proof photo"]')).toHaveCount(3); // two photos + the composed code photo
  await seller.getByTestId("tracking-input").fill("TRK-DEMO-0000");
  await seller.getByTestId("submit-evidence").click();
  const rows = seller.getByTestId("verdict-row");
  await expect(rows).toHaveCount(3, { timeout: 45_000 });
  for (const row of await rows.all()) await expect(row.locator(".hs-help").first()).not.toBeEmpty();

  // 8. in_review -> buyer approves; otherwise the rule already captured
  if ((await status(seller).textContent()) === "in_review") {
    await buyer.reload();
    await buyer.getByTestId("review-approve").click();
    await buyer.getByTestId("confirm-dialog-confirm").click(); // ReviewPanel confirms with the ConfirmDialog
  }
  await buyer.reload();
  await expect(status(buyer)).toHaveText(/^(captured|paid)$/, { timeout: 30_000 });
  const final = await status(buyer).textContent();

  // 9. Ledger row (AG Grid virtualises columns: filter down, then assert the pinned code cell)
  await buyer.goto("/ledger");
  await buyer.getByLabel("Search deals").fill(code);
  await expect(buyer.locator(".ag-cell").getByText(code, { exact: true })).toBeVisible();

  // 10. Evidence pack with the buyer's cookies
  const res = await buyer.context().request.get(`/api/deals/${code}/evidence-pack`);
  expect(res.status()).toBe(200);
  const pack = await res.json();
  expect(pack.format).toBe("handshake-evidence-pack/1");
  expect(pack.deal.status).toBe(final);
  expect(pack.submissions[0].verdicts).toHaveLength(3);
  expect(pack.events.length).toBeGreaterThanOrEqual(10);

  await sellerContext.close();
});
