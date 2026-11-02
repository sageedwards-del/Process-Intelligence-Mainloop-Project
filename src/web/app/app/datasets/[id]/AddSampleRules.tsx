"use client";

import { useState, useTransition } from "react";
import { addSampleRules } from "./actions";

export function AddSampleRules({ datasetId }: { datasetId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p>
        No business rules are set up for this dataset yet. If it is an export of the Meridian sample, you can add the sample&rsquo;s
        four rules (four eyes, director approval over €10k, duplicate payments, the 2/10 discount window) with their cost per
        violation.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await addSampleRules(datasetId);
            setError(res.error ?? null);
          })
        }
        className="eyebrow mt-3 rounded-md border border-primary px-4 py-2.5 text-[0.6rem] text-primary hover:bg-primary hover:text-primary-ink disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add the sample rules"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}
