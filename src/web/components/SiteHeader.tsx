import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "@/components/Wordmark";
import { createClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/sample", label: "Demo" },
  { href: "/#validation", label: "Validation" },
  { href: "/benefits", label: "Benefits" },
  { href: "/engineering", label: "Engineering" },
];

const BUTTON = "eyebrow rounded-md border border-line px-3 py-2 text-ink transition hover:border-ink-faint sm:px-4 sm:py-2.5";

/** "Workspace" when signed in, "Sign in" otherwise. Reads the session cookie, so it streams in under Suspense and pages stay prerendered. */
async function AccountLink() {
  // The Supabase client reads the clock, so this part renders at request time (the rest of the page stays prerendered).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? (
    <Link href="/app" className={BUTTON}>
      Workspace
    </Link>
  ) : (
    <Link href="/login" className={BUTTON}>
      Sign in
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-8 sm:py-5">
        <Link href="/" aria-label="Process Discovery Engine, home">
          <Wordmark />
        </Link>
        <Suspense
          fallback={
            <Link href="/login" className={`${BUTTON} md:order-last`}>
              Sign in
            </Link>
          }
        >
          <span className="md:order-last">
            <AccountLink />
          </span>
        </Suspense>
        {/* On phones the links wrap to their own row under the wordmark; nothing is hidden. */}
        <nav aria-label="Main" className="order-last flex w-full flex-wrap gap-x-5 gap-y-1 text-sm text-ink-muted md:order-none md:ml-auto md:w-auto md:gap-x-6">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
