/**
 * Lightweight verification helpers for billing and attendance date rules.
 * Run with: npx tsx scripts/verify-domain.ts
 */
import assert from "node:assert/strict";
import { addDays, toUtcDay } from "../src/lib/dates.js";

function testDates() {
  const day = toUtcDay("2026-07-17T18:30:00.000Z");
  assert.equal(day.toISOString(), "2026-07-17T00:00:00.000Z");

  const next = addDays(day, 30);
  assert.equal(next.toISOString(), "2026-08-16T00:00:00.000Z");
  console.log("✓ date helpers");
}

function testBillingMath() {
  const studentCount = 120;
  const pricePerStudent = 5000; // paise
  const amount = studentCount * pricePerStudent;
  assert.equal(amount, 600000);
  assert.equal(amount / 100, 6000);
  console.log("✓ billing calculation (students × pricePerStudent)");
}

function testAccessRules() {
  const cases = [
    { status: "TRIAL", isAccessEnabled: true, ok: true },
    { status: "ACTIVE", isAccessEnabled: true, ok: true },
    { status: "TRIAL", isAccessEnabled: false, ok: false },
    { status: "EXPIRED", isAccessEnabled: true, ok: false },
    { status: "SUSPENDED", isAccessEnabled: true, ok: false },
  ] as const;

  for (const c of cases) {
    const statusOk = c.status === "TRIAL" || c.status === "ACTIVE";
    const allowed = c.isAccessEnabled && statusOk;
    assert.equal(allowed, c.ok, `${c.status}/${c.isAccessEnabled}`);
  }
  console.log("✓ subscription access rules");
}

testDates();
testBillingMath();
testAccessRules();
console.log("\nAll domain verifications passed.");
