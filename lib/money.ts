// Minor units (integer cents) <-> PayPal's "80.00" strings. Integer arithmetic only.
const dollars = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

/** For PayPal amount.value. Throws on 0, negative or non-integer: no PayPal write carries a bad amount. */
export function toPaypalValue(minor: number): string {
  if (!Number.isInteger(minor) || minor <= 0) throw new Error(`toPaypalValue: not a positive integer: ${minor}`);
  return dollars(minor);
}

/** Parses a PayPal amount string. Throws on more than 2 decimals or anything that is not a number. */
export function fromPaypalValue(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`fromPaypalValue: not a 2-decimal amount: ${JSON.stringify(value)}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export const formatUsd = (minor: number) => `$${dollars(minor)}`;
