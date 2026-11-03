import type { Metadata } from "next";
import { DemoPage } from "../DemoPage";

export const metadata: Metadata = {
  title: "Demo · synthetic invoices · Process Discovery Engine",
  description: "Explore a synthetic invoice-approval process with known problems built in: map, variants, bottlenecks and what they cost.",
};

export default function MeridianPage() {
  return <DemoPage id="meridian" />;
}
