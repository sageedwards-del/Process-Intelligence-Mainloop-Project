"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AskAnswer, AskEvent } from "@/lib/ai/ask";
import type { FindingsOutput } from "@/lib/ai/findings";
import type { MemoOutput } from "@/lib/ai/memo";
import { formatMoney } from "../explorer/format";
import { CitedText, Sources, citationOrder } from "./Cited";
import { memoMarkdown } from "./memoMarkdown";

type Tab = "findings" | "ask" | "memo";

/** Errors the API answers with; 401 means "sign in". */
interface Failure {
  status: number;
  message: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw { status: res.status, message: body.error ?? `Request failed (${res.status}).` } satisfies Failure;
  return body;
}

const failure = (e: unknown): Failure => (e && typeof e === "object" && "status" in e ? (e as Failure) : { status: 0, message: "The request failed. Check your connection." });

/**
 * Claude's side of the page: findings, Ask and the opportunity memo, all
 * written server-side from the engine's metrics and shown only after the
 * grounding check has matched every cited figure.
 */
export function AiPanel({ target, signInNext }: { target: string; signInNext: string }) {
  const [tab, setTab] = useState<Tab>("findings");
  const [signedOut, setSignedOut] = useState(false);
  const base = `/api/ai/${target}`;
  const onFailure = useCallback((f: Failure) => {
    if (f.status === 401) setSignedOut(true);
  }, []);

  return (
    <section className="mt-12 min-w-0 rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 pt-5 sm:px-6">
        <div className="pb-4">
          <p className="eyebrow ai-gradient w-fit">Written by Claude, checked by code</p>
          <h2 className="mt-2 text-xl font-medium">Findings, questions and the go / no-go memo</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Claude reads the engine&rsquo;s metrics and cites one for every figure. Before anything is shown, code checks that each cited metric exists
            and each figure matches it; text that fails is dropped or rewritten, never shown.
          </p>
        </div>
        <div role="tablist" className="flex gap-1">
          {(["findings", "ask", "memo"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`eyebrow border-b-2 px-3 pb-3 text-[0.65rem] ${tab === t ? "border-primary text-ink" : "border-transparent text-ink-faint hover:text-ink"}`}
            >
              {t === "findings" ? "Findings" : t === "ask" ? "Ask" : "Memo"}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-6 sm:px-6">
        {signedOut ? (
          <p className="text-sm text-ink-muted">
            Claude&rsquo;s analysis costs real API calls, so it needs an account.{" "}
            <Link href={`/login?next=${encodeURIComponent(signInNext)}`} className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>{" "}
            to read the findings, ask a question or write the memo.
          </p>
        ) : tab === "findings" ? (
          <FindingsTab base={base} onFailure={onFailure} />
        ) : tab === "ask" ? (
          <AskTab base={base} onFailure={onFailure} />
        ) : (
          <MemoTab base={base} onFailure={onFailure} />
        )}
      </div>
    </section>
  );
}

/** Loads the stored output on mount; `generate` asks Claude for a new one. */
function useStored<T>(url: string, key: string, onFailure: (f: Failure) => void) {
  const [data, setData] = useState<T | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [state, setState] = useState<"loading" | "idle" | "working">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call<Record<string, unknown>>(url)
      .then((r) => {
        if (!live) return;
        setData((r[key] as T) ?? null);
        setCreatedAt((r.createdAt as string) ?? null);
        setCanEdit(Boolean(r.canEdit));
      })
      .catch((e) => live && (onFailure(failure(e)), setError(failure(e).message)))
      .finally(() => live && setState("idle"));
    return () => {
      live = false;
    };
  }, [url, key, onFailure]);

  const generate = async () => {
    setState("working");
    setError(null);
    try {
      const r = await call<Record<string, unknown>>(url, { method: "POST" });
      setData(r[key] as T);
      setCreatedAt(r.createdAt as string);
    } catch (e) {
      onFailure(failure(e));
      setError(failure(e).message);
    } finally {
      setState("idle");
    }
  };
  return { data, createdAt, canEdit, state, error, generate };
}

function Working({ what }: { what: string }) {
  return (
    <p className="text-sm text-ink-muted" role="status">
      <span className="ai-gradient font-medium">Claude is {what}</span> and the grounding check is matching every figure. This takes up to a minute or two.
    </p>
  );
}

function Stamp({ createdAt, note }: { createdAt: string | null; note?: string }) {
  if (!createdAt) return null;
  return (
    <p className="font-mono text-xs text-ink-faint">
      Written {new Date(createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
      {note ? ` · ${note}` : ""}
    </p>
  );
}

type Issue = { field: string; message: string };

function Dropped({ dropped, rewritten = [], what }: { dropped: { issues: Issue[] }[]; rewritten?: Issue[]; what: string }) {
  if (!dropped.length && !rewritten.length) return null;
  if (!dropped.length) {
    return (
      <details className="mt-6 text-sm text-ink-muted">
        <summary className="cursor-pointer hover:text-ink">The first draft failed the grounding check in {rewritten.length} place{rewritten.length === 1 ? "" : "s"} and was rewritten</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
          {rewritten.map((issue, i) => (
            <li key={i}>{`${issue.field}: ${issue.message}`}</li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <details className="mt-6 text-sm text-ink-muted">
      <summary className="cursor-pointer hover:text-ink">
        {dropped.length} {what}
        {dropped.length === 1 ? "" : "s"} failed the grounding check and {dropped.length === 1 ? "isn't" : "aren't"} shown
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">
        {dropped.flatMap((d, i) => d.issues.map((issue, j) => <li key={`${i}-${j}`}>{`${issue.field}: ${issue.message}`}</li>))}
      </ul>
    </details>
  );
}

const CONFIDENCE: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

function FindingsTab({ base, onFailure }: { base: string; onFailure: (f: Failure) => void }) {
  const { data, createdAt, canEdit, state, error, generate } = useStored<FindingsOutput>(`${base}/findings`, "findings", onFailure);
  if (state === "loading") return <p className="text-sm text-ink-faint">Loading…</p>;
  return (
    <div>
      {state === "working" ? (
        <Working what="writing findings" />
      ) : !data ? (
        <p className="max-w-2xl text-sm text-ink-muted">
          No findings for the current data and cost settings yet. Claude writes three to five, ranked by money at stake: bottlenecks and where their
          waiting goes, batch steps, rework, cost to serve, rule violations and the segments correlated with slow cases.
        </p>
      ) : (
        <>
          <Stamp createdAt={createdAt} note={`${data.findings.length} findings passed the grounding check`} />
          <ol className="mt-4 space-y-4">
            {data.findings.map((f, i) => {
              const order = citationOrder([f.body, f.likelyCauses, ...f.checkNext]);
              return (
                <li key={i} className="relative overflow-hidden rounded-lg border border-line bg-bg/40 py-4 pl-6 pr-4">
                  <span aria-hidden className="ai-bar absolute inset-y-0 left-0 w-1" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="ai-gradient text-lg font-medium">{f.title}</h3>
                    <span className="eyebrow text-[0.55rem] text-ink-faint">{CONFIDENCE[f.confidence]}</span>
                  </div>
                  <p className="mt-2 leading-relaxed">
                    <CitedText text={f.body} order={order} />
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    <span className="font-medium text-ink">Possible causes, to check: </span>
                    <CitedText text={f.likelyCauses} order={order} />
                  </p>
                  {f.checkNext.length > 0 && (
                    <div className="mt-3 text-sm">
                      <p className="font-medium">Validate on site</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
                        {f.checkNext.map((c, j) => (
                          <li key={j}>
                            <CitedText text={c} order={order} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Sources order={order} metrics={data.metrics} currency={data.currency} />
                </li>
              );
            })}
          </ol>
          <Dropped dropped={data.dropped} rewritten={data.rewritten} what="finding" />
        </>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-[#b42318]">
          {error}
        </p>
      )}
      {canEdit && state === "idle" && (
        <button type="button" onClick={generate} className="eyebrow mt-6 rounded-md bg-primary px-4 py-2 text-[0.65rem] text-primary-ink hover:bg-primary-hover">
          {data ? "Write new findings" : "Write findings"}
        </button>
      )}
    </div>
  );
}

const SUGGESTIONS = ["Where do invoices wait longest, and what does it cost?", "Which cases are most likely to run slow, and is that a cause?", "How much of the rework could be real rework?"];

function AskTab({ base, onFailure }: { base: string; onFailure: (f: Failure) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<{ name: string; summary: string }[]>([]);
  const [answers, setAnswers] = useState<AskAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call<{ answers: AskAnswer[] }>(`${base}/ask`)
      .then((r) => live && setAnswers(r.answers))
      .catch((e) => live && onFailure(failure(e)));
    return () => {
      live = false;
    };
  }, [base, onFailure]);

  const submit = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setTools([]);
    setError(null);
    try {
      const res = await fetch(`${base}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw { status: res.status, message: body.error ?? `Request failed (${res.status}).` } satisfies Failure;
      }
      // Newline-delimited JSON: tool calls as they happen, then the checked answer.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as AskEvent;
          if (event.type === "tool") setTools((t) => [...t, { name: event.name, summary: event.summary }]);
          else if (event.type === "answer") setAnswers((a) => [event.answer, ...a]);
          else setError(event.message);
        }
      }
      setQuestion("");
    } catch (e) {
      onFailure(failure(e));
      setError(failure(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <label htmlFor="ask" className="text-sm font-medium">
          Ask about this process
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1000}
            placeholder="e.g. Why are high-value invoices slower?"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2"
          />
          <button type="submit" disabled={busy || !question.trim()} className="eyebrow rounded-md bg-primary px-4 py-2 text-[0.65rem] text-primary-ink hover:bg-primary-hover disabled:opacity-50">
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => (setQuestion(s), void submit(s))} className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      </form>

      {(busy || tools.length > 0) && (
        <ol className="mt-4 space-y-1 font-mono text-xs text-ink-faint" aria-live="polite">
          {tools.map((t, i) => (
            <li key={i}>
              → {t.name} <span className="text-ink-muted">({t.summary})</span>
            </li>
          ))}
          {busy && <li className="ai-gradient w-fit">Claude is working; the answer appears once its figures pass the check.</li>}
        </ol>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-[#b42318]">
          {error}
        </p>
      )}

      <ol className="mt-6 space-y-4">
        {answers.map((a, i) => (
          <AnswerCard key={`${a.createdAt}-${i}`} answer={a} />
        ))}
      </ol>
    </div>
  );
}

function AnswerCard({ answer: a }: { answer: AskAnswer }) {
  const order = a.answer ? citationOrder([a.answer]) : [];
  return (
    <li className="relative overflow-hidden rounded-lg border border-line bg-bg/40 py-4 pl-6 pr-4">
      <span aria-hidden className="ai-bar absolute inset-y-0 left-0 w-1" />
      <p className="font-medium">{a.question}</p>
      {a.answer ? (
        <div className="mt-2 space-y-2 leading-relaxed">
          {a.answer.split(/\n{2,}/).map((p, i) =>
            /^\s*[-*] /.test(p) ? (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {p.split("\n").map((item, j) => (
                  <li key={j}>
                    <CitedText text={item.replace(/^\s*[-*] /, "")} order={order} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i}>
                <CitedText text={p} order={order} />
              </p>
            ),
          )}
        </div>
      ) : (
        <div className="mt-2 text-sm text-ink-muted">
          <p>Claude&rsquo;s answer didn&rsquo;t pass the grounding check, so it isn&rsquo;t shown. Try asking it differently.</p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {a.issues.map((i, j) => (
              <li key={j}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {a.tools.length > 0 && <p className="mt-3 font-mono text-xs text-ink-faint">Engine calls: {a.tools.map((t) => t.name).join(", ")}</p>}
      <Sources order={order} metrics={a.metrics} currency={a.currency} />
    </li>
  );
}

function MemoTab({ base, onFailure }: { base: string; onFailure: (f: Failure) => void }) {
  const { data, createdAt, canEdit, state, error, generate } = useStored<MemoOutput>(`${base}/memo`, "memo", onFailure);
  // The addressable shares are assumptions: the reader can change them and see the savings move.
  // Kept per memo, so a new memo starts from Claude's shares again.
  const [edited, setEdited] = useState<{ memo: string | null; shares: Record<number, number> }>({ memo: null, shares: {} });
  const shares = edited.memo === createdAt ? edited.shares : {};
  const setShare = (i: number, share: number) => setEdited({ memo: createdAt, shares: { ...shares, [i]: share } });
  if (state === "loading") return <p className="text-sm text-ink-faint">Loading…</p>;

  const money = (n: number) => formatMoney(n, data?.currency ?? "EUR");
  const opportunities = (data?.opportunities ?? []).map((o, i) => {
    const share = shares[i] ?? o.addressableShare;
    return { ...o, share, saving: o.annualBase * share };
  });
  const total = opportunities.reduce((s, o) => s + o.saving, 0);
  const allText = data ? [data.headline, data.currentState, ...data.opportunities.flatMap((o) => [o.evidence, o.shareRationale, o.approach, o.risks]), data.rationale, ...data.assumptions] : [];
  const order = citationOrder(allText);

  return (
    <div>
      {state === "working" ? (
        <Working what="writing the memo" />
      ) : !data ? (
        <p className="max-w-2xl text-sm text-ink-muted">
          No memo for the current data and cost settings yet. The memo is the go / no-go call: the current state, up to three opportunities sized from
          rule, rework, labour and capital costs (never by adding up waits, which would count the same money twice), the formula behind each figure,
          and the assumptions to validate on site.
        </p>
      ) : (
        <article>
          <Stamp createdAt={createdAt} note="passed the grounding check" />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`eyebrow rounded-md px-3 py-1.5 text-[0.7rem] ${data.recommendation === "go" ? "bg-primary text-primary-ink" : "border border-ink text-ink"}`}>
              {data.recommendation === "go" ? "Go" : "No-go"}
            </span>
            <p className="ai-gradient text-lg font-medium">
              <CitedText text={data.headline} order={order} />
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              <h3 className="font-medium">Current state</h3>
              <p className="mt-1 leading-relaxed">
                <CitedText text={data.currentState} order={order} />
              </p>
            </div>
            <div className="rounded-lg border border-line p-4">
              <p className="eyebrow text-[0.55rem] text-ink-faint">Annual opportunity, as sized below</p>
              <p className="mt-1 font-mono text-2xl">{money(total)}</p>
              <p className="mt-1 break-words font-mono text-xs text-ink-faint">
                {opportunities.length ? opportunities.map((o) => money(o.saving)).join(" + ") : "No opportunity passed the check"}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                From {data.logSpanDays.toFixed(0)} days of log, scaled to a year. Totals come only from rule, rework, labour and capital costs.
              </p>
            </div>
          </div>

          <h3 className="mt-8 font-medium">Opportunities</h3>
          <ol className="mt-3 space-y-4">
            {opportunities.map((o, i) => (
              <li key={i} className="relative overflow-hidden rounded-lg border border-line bg-bg/40 py-4 pl-6 pr-4">
                <span aria-hidden className="ai-bar absolute inset-y-0 left-0 w-1" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h4 className="ai-gradient text-lg font-medium">
                    {i + 1}. {o.title}
                  </h4>
                  <span className="font-mono">{money(o.saving)} a year</span>
                </div>
                <p className="mt-1 break-words font-mono text-xs text-ink-faint">
                  {money(o.annualBase)} a year ({o.sizing.join(" + ")}) × {Math.round(o.share * 100)}% addressable
                </p>
                <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                  Addressable share
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(o.share * 100)}
                    onChange={(e) => setShare(i, Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
                    className="w-20 rounded border border-line bg-bg px-2 py-1 font-mono"
                  />
                  % <span className="text-xs">(Claude&rsquo;s assumption: {Math.round(o.addressableShare * 100)}%)</span>
                </label>
                <p className="mt-3 text-sm leading-relaxed">
                  <span className="font-medium">Why that share: </span>
                  <CitedText text={o.shareRationale} order={order} />
                </p>
                <p className="mt-2 text-sm leading-relaxed">
                  <span className="font-medium">Evidence: </span>
                  <CitedText text={o.evidence} order={order} />
                </p>
                <p className="mt-2 text-sm leading-relaxed">
                  <span className="font-medium">Approach: </span>
                  <CitedText text={o.approach} order={order} />
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  <span className="font-medium text-ink">Risks: </span>
                  <CitedText text={o.risks} order={order} />
                </p>
                <ul className="mt-3 space-y-0.5 font-mono text-xs text-ink-faint">
                  {o.sizing.map((id) => (
                    <li key={id} className="break-words">
                      {id}: {data.metrics[id]?.formula ?? ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <h3 className="mt-8 font-medium">Recommendation</h3>
          <p className="mt-1 leading-relaxed">
            <CitedText text={data.rationale} order={order} />
          </p>

          <h3 className="mt-8 font-medium">Assumptions to validate on site</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
            {data.assumptions.map((a, i) => (
              <li key={i}>
                <CitedText text={a} order={order} />
              </li>
            ))}
          </ul>
          <Sources order={order} metrics={data.metrics} currency={data.currency} />
          <Dropped dropped={data.dropped} rewritten={data.rewritten} what="opportunity" />
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([memoMarkdown(data, shares)], { type: "text/markdown" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "opportunity-memo.md";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            className="eyebrow mt-6 mr-3 rounded-md border border-primary px-4 py-2 text-[0.65rem] text-primary hover:bg-primary hover:text-primary-ink"
          >
            Download as Markdown
          </button>
        </article>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-[#b42318]">
          {error}
        </p>
      )}
      {canEdit && state === "idle" && (
        <button type="button" onClick={generate} className="eyebrow mt-6 rounded-md bg-primary px-4 py-2 text-[0.65rem] text-primary-ink hover:bg-primary-hover">
          {data ? "Write a new memo" : "Write the memo"}
        </button>
      )}
    </div>
  );
}
