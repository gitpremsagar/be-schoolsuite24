/**
 * Sanity-check: upsert on an existing fee payment keeps the same id.
 * Run: npx tsx scripts/verify-fee-upsert.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.studentFeePayment.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!existing) {
    console.log("SKIP: no fee payments to verify");
    return;
  }

  const beforeId = existing.id;
  const updated = await prisma.studentFeePayment.upsert({
    where: {
      studentProfileId_academicYearId_year_month: {
        studentProfileId: existing.studentProfileId,
        academicYearId: existing.academicYearId,
        year: existing.year,
        month: existing.month,
      },
    },
    create: {
      schoolId: existing.schoolId,
      academicYearId: existing.academicYearId,
      studentProfileId: existing.studentProfileId,
      classId: existing.classId,
      year: existing.year,
      month: existing.month,
      status: existing.status,
      amountDue: existing.amountDue,
      amountPaid: existing.amountPaid,
      paidAt: existing.paidAt,
      notes: existing.notes,
      createdById: existing.createdById,
      updatedById: existing.updatedById,
    },
    update: {
      notes: existing.notes,
      updatedById: existing.updatedById,
    },
  });

  const count = await prisma.studentFeePayment.count({
    where: {
      studentProfileId: existing.studentProfileId,
      academicYearId: existing.academicYearId,
      year: existing.year,
      month: existing.month,
    },
  });

  const ok = beforeId === updated.id && count === 1;
  console.log(
    JSON.stringify(
      {
        beforeId,
        afterId: updated.id,
        sameId: beforeId === updated.id,
        rowsForKey: count,
        ok,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
