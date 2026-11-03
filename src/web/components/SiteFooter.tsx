import { Wordmark } from "@/components/Wordmark";
import { CONTACT_EMAIL, LINKEDIN, MINER_SOURCE, REPO } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark />
        <div className="sm:text-right">
          <p>
            By Sage Edwards, Brown University ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
            {LINKEDIN && (
              <>
                {" · "}
                <a href={LINKEDIN} className="text-primary underline-offset-4 hover:underline">
                  LinkedIn
                </a>
              </>
            )}
            {" · "}MIT licence ·{" "}
            <a href={REPO} className="text-primary underline-offset-4 hover:underline">
              Source
            </a>
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            The mining service uses pm4py and is AGPL-3.0:{" "}
            <a href={MINER_SOURCE} className="underline underline-offset-2 hover:text-ink-muted">
              its source
            </a>
            .
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            An independent portfolio project, made for an application to Mainloop. Not affiliated with or endorsed by Mainloop or
            Leyton.
          </p>
        </div>
      </div>
    </footer>
  );
}
