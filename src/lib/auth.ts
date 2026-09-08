import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";

const COOKIE_NAME = "sbs_owner_session";

export class ConfigError extends Error {}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new ConfigError(
      "JWT_SECRET is missing or too short. Set a random 32+ character value."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createOwnerSession() {
  const token = await new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearOwnerSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isOwnerAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload.role === "owner";
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so compare fixed-size digests of
  // the raw bytes instead of the bytes themselves.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Owner credentials come from the environment only.
 *
 * There is deliberately no default: this previously fell back to a username and
 * password that are published in the README, so any deployment missing its env
 * vars was open to anyone who had read the repo.
 */
export function verifyOwnerCredentials(username: string, password: string) {
  const expectedUser = process.env.OWNER_USERNAME?.trim();
  const expectedPass = process.env.OWNER_PASSWORD;

  if (!expectedUser || !expectedPass) {
    throw new ConfigError(
      "OWNER_USERNAME and OWNER_PASSWORD are not set, so owner login is disabled."
    );
  }
  if (expectedPass.length < 8) {
    throw new ConfigError("OWNER_PASSWORD must be at least 8 characters.");
  }

  return (
    constantTimeEqual(username, expectedUser) && constantTimeEqual(password, expectedPass)
  );
}
