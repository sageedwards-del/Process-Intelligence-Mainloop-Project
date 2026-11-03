/** Supabase project URL and publishable key, shared by the browser, server and proxy clients. */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy src/web/.env.example to .env.local.",
    );
  }
  return { url, key };
}

const BASE = "http://same-site.invalid";

/**
 * Only same-site paths are allowed as post-login destinations, so a link can't redirect off-site.
 * The path is resolved the way a browser would (which drops tabs and newlines, so "/\t/evil.com"
 * becomes "//evil.com") and kept only if it stays on the same origin.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/app"): string {
  const s = typeof value === "string" ? value : "";
  if (!s.startsWith("/")) return fallback;
  try {
    const url = new URL(s, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
