// Carrier mock (D7).
import { expect, it } from "vitest";
import { carrierStatus } from "@/lib/carrier";

it.each([
  ["TRK-DEMO-0000", "delivered"],
  ["TRK-DEMO-0001", "in_transit"],
  ["1Z999AA10123456784", "delivered"],
  ["TRK-DEMO-000A", "unknown"],
  ["", "unknown"],
  ["   ", "unknown"],
] as const)("carrierStatus(%j) -> %s", (input, expected) => {
  expect(carrierStatus(input)).toBe(expected);
});
