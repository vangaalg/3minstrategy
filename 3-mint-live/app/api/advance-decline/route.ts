/**
 * GET /api/advance-decline
 *
 * Fetches LTP + prev close for all 50 Nifty constituents via Breeze
 * and returns advances/declines/unchanged plus top movers.
 *
 * Refresh cadence on the dashboard: every 60-90s is plenty.
 * Each call makes ~50 Breeze /quotes requests (batched 10 at a time).
 *
 * Optional body (POST) lets the frontend pass a session token override:
 *   { sessionToken?: string }
 * For simplicity this route accepts both GET and POST.
 */

import { NextResponse } from "next/server";
import { fetchAdvanceDecline } from "@/lib/breeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  try {
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.sessionToken && typeof body.sessionToken === "string") {
          process.env.BREEZE_SESSION_TOKEN = body.sessionToken.trim();
        }
      } catch { /* ignore */ }
    }

    const snapshot = await fetchAdvanceDecline();
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET  = handle;
export const POST = handle;
