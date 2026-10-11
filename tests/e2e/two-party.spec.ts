// Two parties, no external services (trust spec §13): demo 2FA for both, join, both sign with browser keys, terms agreed,
// the contract page verifies both signatures in the browser, and the seller's key shows on /security.
// The draft comes from make-draft.ts (fake model), so this runs without Anthropic or PayPal keys.
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { pass2fa, signContract } from "./flows";

const status = (page: Page) => page.getByTestId("deal-status").first();

test("both parties sign with device keys; the contract verifies in the browser", async ({ page: buyer, browser }) => {
  const code = execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "tests/e2e/make-draft.ts"], {
    encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--conditions=react-server" },
  }).trim().split("\n").at(-1)!;
  expect(code).toMatch(/^HS-[A-Z0-9]{4}$/);

  await buyer.goto(`/signin?next=/deal/${code}`);
  await buyer.getByTestId("persona-buyer").click();
  await pass2fa(buyer);
  await expect(buyer.locator("#next-h")).toHaveText("Share the link with your seller");
  await expect(buyer.getByTestId("sign-contract")).toHaveCount(0); // nothing to sign before the seller joins

  const seller = await (await browser.newContext()).newPage();
  await seller.goto(`/deal/${code}`);
  await seller.getByTestId("persona-seller").click();
  await pass2fa(seller);
  await seller.getByTestId("join").click();
  await expect(seller.getByTestId("contract-fingerprint")).toHaveText(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
  await signContract(seller);
  await expect(seller.getByText(/You signed v1/)).toBeVisible();

  await buyer.reload();
  await expect(buyer.locator("#next-h")).toHaveText(/signed\. Sign to continue\./);
  await signContract(buyer);
  await expect(status(buyer)).toHaveText("terms_agreed");

  await buyer.goto(`/deal/${code}/contract`);
  await expect(buyer.getByTestId("sig-buyer")).toHaveText("Verified in your browser");
  await expect(buyer.getByTestId("sig-seller")).toHaveText("Verified in your browser");
  const [download] = await Promise.all([buyer.waitForEvent("download"), buyer.getByTestId("download-contract").click()]);
  const bundle = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")) as { signatures: unknown[]; document: { code: string } };
  expect(bundle.document.code).toBe(code);
  expect(bundle.signatures).toHaveLength(2);

  await seller.goto("/security");
  await expect(seller.getByTestId("signing-keys")).toContainText("This browser");
});
