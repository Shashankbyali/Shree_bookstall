import { NextRequest, NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(req: NextRequest, scope: string) {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/**
 * Very small in-process limiter for the public endpoints, so a stranger with the
 * QR code cannot fill the storage bucket in a loop.
 *
 * Caveat: serverless instances do not share memory, so the effective limit is
 * per instance rather than global. That is enough to stop casual abuse; a real
 * guarantee would need a shared store such as Upstash.
 */
export function rateLimit(
  req: NextRequest,
  scope: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): NextResponse | null {
  const key = clientKey(req, scope);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return null;
  }

  bucket.count++;
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  return null;
}
