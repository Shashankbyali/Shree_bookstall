import { NextRequest, NextResponse } from "next/server";
import {
  ConfigError,
  createOwnerSession,
  verifyOwnerCredentials,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Slows down password guessing against the single owner account.
  const limited = rateLimit(req, "login", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  try {
    if (!verifyOwnerCredentials(username, password)) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }
    await createOwnerSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      // A misconfigured deployment should say so plainly rather than look like
      // wrong credentials, but must never fall back to a default password.
      console.error("Owner login is misconfigured:", error.message);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
