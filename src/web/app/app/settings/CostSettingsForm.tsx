"use client";

import { startTransition, useActionState, useState } from "react";
import { CURRENCIES, type CostSettings } from "@throughline/engine";
import { saveCostSettings, type SaveState } from "./actions";

/** Edit the workspace's cost assumptions; a worked example under each field shows the formula it feeds. */
export function CostSettingsForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: CostSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveCostSettings, { status: "idle" });
  const [s, setS] = useState({
    currency: initial.currency,
    hourlyRate: String(initial.hourlyRate),
    delayCostPerCaseDay: String(initial.delayCostPerCaseDay),
    defaultHandlingMinutes: String(initial.defaultHandlingMinutes),
    capitalOn: Boolean(initial.capitalCost),
    capitalAttribute: initial.capitalCost?.attribute ?? "amount",
    capitalRatePct: String(initial.capitalCost ? +(initial.capitalCost.annualRate * 100).toFixed(4) : 8),
  });
  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setS((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const money = (n: number) =>
    Number.isFinite(n) ? new Intl.NumberFormat("en", { style: "currency", currency: s.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) : "–";
  const n = (v: string) => (v === "" ? NaN : Number(v));

  const input = "mt-2 w-full rounded-md border border-line bg-surface px-3 py-2.5 font-mono outline-none focus:border-primary disabled:opacity-60";
  const label = "eyebrow block text-[0.65rem] text-ink-faint";
  const example = "mt-2 font-mono text-xs text-ink-faint";

  return (
    <form
      // Submitting through onSubmit (not `action`) skips React's post-action form reset,
      // which would put the controlled checkbox out of step with its state.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-8"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <fieldset disabled={!canEdit} className="grid gap-8 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Currency</span>
          <select name="currency" value={s.currency} onChange={set("currency")} className={input}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Hourly rate (fully loaded staff hour)</span>
          <input name="hourlyRate" type="number" min={0} step="any" required value={s.hourlyRate} onChange={set("hourlyRate")} className={input} />
        </label>
        <label className="block">
          <span className={label}>Handling minutes per step</span>
          <input name="defaultHandlingMinutes" type="number" min={0} step="any" required value={s.defaultHandlingMinutes} onChange={set("defaultHandlingMinutes")} className={input} />
          <p className={example}>
            Rework: 100 repeats × {s.defaultHandlingMinutes || "?"} min × {money(n(s.hourlyRate))}/h ={" "}
            {money((100 * n(s.defaultHandlingMinutes) * n(s.hourlyRate)) / 60)}
          </p>
        </label>
        <label className="block">
          <span className={label}>Other cost per case-day of excess waiting</span>
          <input name="delayCostPerCaseDay" type="number" min={0} step="any" required value={s.delayCostPerCaseDay} onChange={set("delayCostPerCaseDay")} className={input} />
          <p className="mt-2 text-xs text-ink-muted">
            Leave at 0 unless waiting itself costs money per day, such as a contractual penalty. Losses a rule already prices
            (a missed discount) are shared out over the waits that caused them, so pricing them here too would count them twice.
            Only waiting beyond each step&rsquo;s median counts.
          </p>
          <p className={example}>
            Waiting: 3 excess case-days × {money(n(s.delayCostPerCaseDay))} = {money(3 * n(s.delayCostPerCaseDay))}
          </p>
        </label>
      </fieldset>

      <fieldset disabled={!canEdit} className="rounded-xl border border-line p-5">
        <legend className="px-2 text-sm font-medium">Capital cost (optional)</legend>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="capitalOn" checked={s.capitalOn} onChange={set("capitalOn")} className="mt-1 accent-[var(--primary)]" />
          <span className="text-ink-muted">
            Charge the cost of cash tied up while a case waits. Use it where waiting delays money coming in (billing, receivables), not
            for payables, where paying later saves cash.
          </span>
        </label>
        {s.capitalOn && (
          <div className="mt-5 grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Case attribute holding the amount</span>
              <input name="capitalAttribute" required value={s.capitalAttribute} onChange={set("capitalAttribute")} className={input} />
            </label>
            <label className="block">
              <span className={label}>Annual cost of capital (%)</span>
              <input name="capitalRatePct" type="number" min={0} max={100} step="any" required value={s.capitalRatePct} onChange={set("capitalRatePct")} className={input} />
            </label>
            <p className={`${example} sm:col-span-2`}>
              A {money(10_000)} case waiting 3 days: 10,000 × {s.capitalRatePct || "?"}% ÷ 365 × 3 ={" "}
              {money((10_000 * (n(s.capitalRatePct) / 100) * 3) / 365)}
            </p>
          </div>
        )}
      </fieldset>

      {state.status === "error" && (
        <ul role="alert" className="space-y-1 text-sm text-[#b42318]">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {state.status === "saved" && (
        <p role="status" className="text-sm text-primary">
          Saved. Every uploaded dataset in this workspace now uses these figures.
        </p>
      )}
      {canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className="eyebrow rounded-md bg-primary px-6 py-3.5 text-primary-ink transition hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save cost settings"}
        </button>
      ) : (
        <p className="text-sm text-ink-muted">You have read-only access to this workspace.</p>
      )}
    </form>
  );
}
