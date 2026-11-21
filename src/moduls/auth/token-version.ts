import { prisma } from "../../lib/prisma.js";

/**
 * Atomically increment a user's tokenVersion, treating a missing or null
 * value as 0.
 *
 * Prisma's `{ increment: 1 }` silently writes `null` for MongoDB documents
 * that were created before the field existed, leaving the version unchanged.
 * The aggregation-pipeline update below works for old and new documents.
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  await prisma.$runCommandRaw({
    update: "User",
    updates: [
      {
        q: { _id: { $oid: userId } },
        u: [
          {
            $set: {
              tokenVersion: { $add: [{ $ifNull: ["$tokenVersion", 0] }, 1] },
            },
          },
        ],
      },
    ],
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  return user?.tokenVersion ?? 0;
}
