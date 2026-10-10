// The one status pill (08 section 2, section 4.7): data-status on the pill, the raw status in a hidden span.
import { STATUS_LABEL, type DealStatus } from "@/lib/status-labels";

export function StatusPill({ status }: { status: DealStatus }) {
  return (
    <span className="hs-pill" data-status={status}>
      <span hidden data-testid="deal-status">{status}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}
