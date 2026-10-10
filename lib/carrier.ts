// Carrier status mock (decisions D7). Pure; imported by the browser too (08). The README discloses it.
export type CarrierStatus = "delivered" | "in_transit" | "unknown";

export function carrierStatus(trackingNumber: string): CarrierStatus {
  const last = trackingNumber.trim().slice(-1);
  if (!/^\d$/.test(last)) return "unknown";
  return Number(last) % 2 === 0 ? "delivered" : "in_transit";
}
