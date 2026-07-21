/**
 * Remove duplicate StudentFeePayment rows for the same
 * (studentProfileId, academicYearId, year, month). Keeps the newest.
 *
 * Run: npx tsx scripts/dedupe-fee-payments.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function groupKey(p: {
  studentProfileId: string;
  academicYearId: string;
  year: number;
  month: number;
}): string {
  return `${p.studentProfileId}:${p.academicYearId}:${p.year}-${p.month}`;
}

async function main() {
  const payments = await prisma.studentFeePayment.findMany({
    orderBy: { updatedAt: "desc" },
  });

  const seen = new Set<string>();
  const idsToDelete: string[] = [];

  for (const p of payments) {
    const key = groupKey(p);
    if (seen.has(key)) {
      idsToDelete.push(p.id);
      continue;
    }
    seen.add(key);
  }

  if (idsToDelete.length === 0) {
    console.log(`No duplicates found among ${payments.length} fee payments.`);
    return;
  }

  const result = await prisma.studentFeePayment.deleteMany({
    where: { id: { in: idsToDelete } },
  });

  console.log(
    `Deleted ${result.count} duplicate fee payment(s); kept ${seen.size} unique row(s) from ${payments.length}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
