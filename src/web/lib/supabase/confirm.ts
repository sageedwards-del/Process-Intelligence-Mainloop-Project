import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "./env";

/** The email OTP types a sign-in link can carry; anything else is refused. */
const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

export type ConfirmParams =
  | { kind: "token"; tokenHash: string; type: EmailOtpType; next: string }
  | { kind: "code"; code: string; next: string }
  | { kind: "invalid"; next: string };

/**
 * Reads a sign-in link's query. The email template sends `token_hash` and `type` (works in any
 * browser or device); links in Supabase's default format arrive via its /verify redirect with a
 * PKCE `code` instead, which only works in the browser that asked for it.
 *
 * `next` is either a same-site path (`/sample#insights`) or, from the template's
 * `next={{ .RedirectTo }}`, the full redirect URL, whose own `next` holds the path.
 */
export function parseConfirm(params: URLSearchParams): ConfirmParams {
  let next = params.get("next") ?? "";
  if (/^https?:\/\//i.test(next)) {
    try {
      next = new URL(next).searchParams.get("next") ?? "/app";
    } catch {
      next = "/app";
    }
  }
  const path = safeNext(next);

  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  if (tokenHash && type && TYPES.has(type)) return { kind: "token", tokenHash, type, next: path };
  const code = params.get("code");
  if (code) return { kind: "code", code, next: path };
  return { kind: "invalid", next: path };
}
