/**
 * Reset incorrect student joining dates that were set to 18 Jul 2026
 * (likely a bulk-create default) back to 1 Apr 2026.
 *
 * Only students whose joiningDate falls on calendar day 18 Jul 2026
 * (UTC or Asia/Kolkata) are updated. All other dates are left alone.
 *
 * Run: npx tsx scripts/reset-wrong-joining-dates.ts
 * Dry run: npx tsx scripts/reset-wrong-joining-dates.ts --dry-run
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WRONG_YMD = "2026-07-18";
const CORRECT_DATE = new Date("2026-04-01T00:00:00.000Z");

function ymdInTimeZone(date: Date, timeZone: string): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isWrongAdmissionDay(date: Date): boolean {
  return (
    ymdInTimeZone(date, "UTC") === WRONG_YMD ||
    ymdInTimeZone(date, "Asia/Kolkata") === WRONG_YMD
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Broad window covering 18 Jul 2026 in both UTC and IST.
  const windowStart = new Date("2026-07-17T18:30:00.000Z");
  const windowEnd = new Date("2026-07-18T23:59:59.999Z");

  const candidates = await prisma.studentProfile.findMany({
    where: {
      joiningDate: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    select: {
      id: true,
      admissionNumber: true,
      joiningDate: true,
      user: { select: { name: true } },
    },
    orderBy: { admissionNumber: "asc" },
  });

  const toUpdate = candidates.filter(
    (s) => s.joiningDate != null && isWrongAdmissionDay(s.joiningDate),
  );

  console.log(
    dryRun
      ? `Dry run: would reset ${toUpdate.length} student(s).`
      : `Resetting ${toUpdate.length} student(s) from ${WRONG_YMD} → 2026-04-01…`,
  );

  for (const s of toUpdate) {
    console.log(
      `  ${s.admissionNumber} · ${s.user.name} · ${s.joiningDate?.toISOString()}`,
    );
  }

  if (dryRun || toUpdate.length === 0) {
    if (toUpdate.length === 0) console.log("Nothing to update.");
    return;
  }

  const result = await prisma.studentProfile.updateMany({
    where: { id: { in: toUpdate.map((s) => s.id) } },
    data: { joiningDate: CORRECT_DATE },
  });

  console.log(
    `Updated ${result.count} student profile(s). New joiningDate: ${CORRECT_DATE.toISOString()}`,
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
