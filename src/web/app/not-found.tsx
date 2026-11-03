import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="dot-grid flex-1">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
          <p className="eyebrow text-primary">404</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">This page doesn&rsquo;t exist.</h1>
          <p className="mt-4 max-w-xl leading-relaxed text-ink-muted">
            It may have moved, or the dataset may belong to a workspace you&rsquo;re not in.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/" className="eyebrow rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover">
              Home
            </Link>
            <Link href="/sample" className="eyebrow rounded-md border border-line bg-surface px-6 py-4 transition hover:border-ink-faint">
              Explore the demo
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
