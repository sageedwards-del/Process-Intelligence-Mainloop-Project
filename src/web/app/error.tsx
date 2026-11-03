"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { Wordmark } from "@/components/Wordmark";

/** Shown when a page throws: a way back instead of the framework's default screen. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="dot-grid flex-1">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
        <Link href="/" aria-label="Process Discovery Engine, home">
          <Wordmark />
        </Link>
        <p className="eyebrow mt-16 text-primary">Something went wrong</p>
        <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">This page couldn&rsquo;t load.</h1>
        <p className="mt-4 max-w-xl leading-relaxed text-ink-muted">Try again, or head back to the home page. If it keeps happening, the service may be briefly unavailable.</p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button type="button" onClick={() => retry()} className="eyebrow rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover">
            Try again
          </button>
          <Link href="/" className="eyebrow rounded-md border border-line bg-surface px-6 py-4 transition hover:border-ink-faint">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
