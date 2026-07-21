import { NextResponse } from "next/server";
import { clearOwnerSession } from "@/lib/auth";

export async function POST() {
  await clearOwnerSession();
  return NextResponse.json({ ok: true });
}
