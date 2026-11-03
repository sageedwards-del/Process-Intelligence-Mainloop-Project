import { NextResponse, type NextRequest } from "next/server";
import { parseConfirm } from "@/lib/supabase/confirm";
import { createClient } from "@/lib/supabase/server";

/**
 * Where sign-in links land. With the token-hash email template (supabase/templates/) the link
 * works in any browser or device: the server verifies the hash and sets the session cookie.
 * A PKCE `code` from Supabase's default template is still accepted, but only works in the
 * browser that requested the link.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const link = parseConfirm(searchParams);
  if (link.kind !== "invalid") {
    const supabase = await createClient();
    const { error } =
      link.kind === "token"
        ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
        : await supabase.auth.exchangeCodeForSession(link.code);
    if (!error) return NextResponse.redirect(new URL(link.next, origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
