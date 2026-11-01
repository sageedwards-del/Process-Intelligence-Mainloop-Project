import { Wordmark } from "@/components/Wordmark";
import { REPO } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark />
        <p>
          Built by Sage Edwards · MIT licence ·{" "}
          <a href={REPO} className="text-primary underline-offset-4 hover:underline">
            Source
          </a>
        </p>
      </div>
    </footer>
  );
}
