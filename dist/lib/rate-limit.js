const buckets = new Map();
/**
 * Fixed-window in-memory rate limiter.
 * Returns true when the call is allowed, false when the limit is exceeded.
 * Suitable for a single API instance; swap for a shared store if scaled out.
 */
export function isRateLimited(key, limit, windowMs, now = Date.now()) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
}
/** Test/housekeeping helper to forget all counters. */
export function resetRateLimits() {
    buckets.clear();
}
//# sourceMappingURL=rate-limit.js.map