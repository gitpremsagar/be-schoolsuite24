/**
 * Normalize StudentFeePayment rows so amountDue is remaining balance
 * (fee - paid), not the original fee amount.
 *
 * Run: npx tsx scripts/normalize-fee-amounts.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const classes = await prisma.class.findMany({
    select: { id: true, monthlyFee: true },
  });
  const feeByClass = new Map(
    classes.map((c) => [c.id, c.monthlyFee ?? 0] as const),
  );

  const payments = await prisma.studentFeePayment.findMany();
  let updated = 0;

  for (const p of payments) {
    const feeHint = feeByClass.get(p.classId) ?? 0;
    const paid = Math.max(0, p.amountPaid || 0);
    let due = Math.max(0, p.amountDue || 0);
    let status = p.status;
    let nextDue = due;
    let nextPaid = paid;

    if (
      (status === "PAID" || status === "WAIVED") &&
      due > 0 &&
      paid >= due - 0.001
    ) {
      nextDue = 0;
      nextPaid = paid;
    } else if (status === "PAID" && paid > 0 && paid < due - 0.001) {
      // Marked paid but only partially paid — treat amountDue as fee.
      nextDue = Math.max(0, due - paid);
      nextPaid = paid;
      status = nextDue <= 0 ? "PAID" : "PARTIAL";
    } else if (
      (status === "PARTIAL" || status === "UNPAID") &&
      feeHint > 0 &&
      Math.abs(due - feeHint) < 0.01 &&
      paid < due - 0.001
    ) {
      nextDue = Math.max(0, due - paid);
      nextPaid = paid;
      if (nextPaid <= 0) status = "UNPAID";
      else if (nextDue <= 0) status = "PAID";
      else status = "PARTIAL";
    } else if (status === "PAID" || status === "WAIVED") {
      nextDue = 0;
    }

    if (nextDue !== p.amountDue || nextPaid !== p.amountPaid || status !== p.status) {
      await prisma.studentFeePayment.update({
        where: { id: p.id },
        data: {
          amountDue: nextDue,
          amountPaid: nextPaid,
          status,
        },
      });
      updated += 1;
    }
  }

  console.log(`Normalized ${updated} of ${payments.length} fee payments.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
