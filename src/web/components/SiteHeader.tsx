import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

const NAV = [
  { href: "/#validation", label: "Validation" },
  { href: "/benefits", label: "Benefits" },
  { href: "/engineering", label: "Engineering" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" aria-label="Process Discovery Engine, home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-ink-muted">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`hover:text-ink ${n.href.startsWith("/#") ? "hidden md:inline" : ""}`}>
              {n.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="eyebrow hidden rounded-md border border-line px-4 py-2.5 text-ink transition hover:border-ink-faint sm:inline-block"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
