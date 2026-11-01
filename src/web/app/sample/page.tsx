import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Explorer } from "@/components/explorer/Explorer";

export const metadata: Metadata = {
  title: "Sample explorer · Process Discovery Engine",
  description: "Explore a synthetic invoice-approval process: map, variants, bottlenecks and what they cost.",
};

export default function SamplePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
          <p className="eyebrow text-primary">Sample · synthetic data</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">Meridian Advisory: invoice approval</h1>
          <p className="mt-3 max-w-3xl leading-relaxed text-ink-muted">
            Six months of invoices at a fictional professional-services firm, generated with known problems built in:
            a slow approving partner, a rework loop on matching, missed approvals and duplicate payments. Drag the
            sliders to simplify the map; switch to median wait to see where cases sit.
          </p>
          <div className="mt-10">
            <Explorer
              source={{ kind: "sample" }}
              costNote="Priced with the sample's cost model: €55 per staff hour and €4 per case per day of excess waiting."
            />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
