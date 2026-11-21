/**
 * Fixed-window in-memory rate limiter.
 * Returns true when the call is allowed, false when the limit is exceeded.
 * Suitable for a single API instance; swap for a shared store if scaled out.
 */
export declare function isRateLimited(key: string, limit: number, windowMs: number, now?: number): boolean;
/** Test/housekeeping helper to forget all counters. */
export declare function resetRateLimits(): void;
//# sourceMappingURL=rate-limit.d.ts.map