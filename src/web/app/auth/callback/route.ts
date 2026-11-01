import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** The magic link lands here with a one-time code, which becomes a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext(searchParams.get("next")), origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
