// The one status pill (08 section 2, section 4.7): icon + word, data-status on the pill, the raw status in a hidden span.
import { STATUS_LABEL, type DealStatus } from "@/lib/status-labels";

// 08 section 2 icons: pencil, check, lock, hourglass, hand, arrow-right, check-circle, x-circle (16-unit stroke paths).
const ICON: Record<DealStatus, string> = {
  draft: "M11.5 2.5l2 2L5.5 13H3.5v-2z",
  terms_agreed: "M3 8.5l3 3 7-7",
  held: "M5 7V5a3 3 0 0 1 6 0v2M3.5 7h9v6.5h-9z",
  proof_submitted: "M4 2h8M4 14h8M5 2c0 4 6 4 6 8M11 2c0 4-6 4-6 8M5 14c0-2 2-3 3-3s3 1 3 3",
  in_review: "M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v4.5M11.5 8.5a1 1 0 0 1 2 0v2a4 4 0 0 1-4 4H8a3 3 0 0 1-2.5-1.3l-2.2-3.2a1 1 0 0 1 1.6-1.2L5.5 10",
  captured: "M2.5 8h11M9.5 4l4 4-4 4",
  paid: "M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM5 8l2 2 4-4",
  voided: "M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM6 6l4 4M10 6l-4 4",
};

export function StatusPill({ status }: { status: DealStatus }) {
  return (
    <span className="hs-pill" data-status={status}>
      <span hidden data-testid="deal-status">{status}</span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICON[status]} />
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}
