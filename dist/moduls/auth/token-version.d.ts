/**
 * Atomically increment a user's tokenVersion, treating a missing or null
 * value as 0.
 *
 * Prisma's `{ increment: 1 }` silently writes `null` for MongoDB documents
 * that were created before the field existed, leaving the version unchanged.
 * The aggregation-pipeline update below works for old and new documents.
 */
export declare function bumpTokenVersion(userId: string): Promise<number>;
//# sourceMappingURL=token-version.d.ts.map