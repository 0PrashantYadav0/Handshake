// The two deal notices (02 section 5.6; 04 section 16), sent through deps.email after the transaction commits. Nothing else emails.
import type { Deps } from "./types";

type Parties = { public_code: string; buyer: { email: string }; seller: { email: string } | null };

export async function notifyBuyerReview(deps: Deps, deal: Parties): Promise<void> {
  await deps.email.send({
    to: deal.buyer.email,
    subject: `Your decision is needed on ${deal.public_code}`,
    text: `The AI could not decide deal ${deal.public_code}. Open it to approve or reject the proof.`,
  });
}

export async function notifyCaptureDeclined(deps: Deps, deal: Parties): Promise<void> {
  const text = `PayPal declined the capture for deal ${deal.public_code}. The deal is back in review.`;
  for (const to of [deal.buyer.email, deal.seller?.email].filter((e): e is string => !!e)) {
    await deps.email.send({ to, subject: "PayPal declined the capture", text });
  }
}
