"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-xl border border-line bg-surface p-6">
        <p className="font-medium">Check your email</p>
        <p className="mt-2 leading-relaxed text-ink-muted">
          We sent a sign-in link to <span className="font-mono text-ink">{state.email}</span>. It works once and
          expires after an hour.
        </p>
      </div>
    );
  }

  const linkError = params.get("error") === "link";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={params.get("next") ?? "/app"} />
      <label className="block">
        <span className="eyebrow text-ink-faint">Work email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className="mt-2 w-full rounded-md border border-line bg-surface px-4 py-3 text-base outline-none focus:border-primary"
        />
      </label>
      {(state.status === "error" || linkError) && (
        <p role="alert" className="text-sm text-[#b42318]">
          {state.status === "error" ? state.message : "That sign-in link has expired or was already used. Request a new one."}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="eyebrow w-full rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
