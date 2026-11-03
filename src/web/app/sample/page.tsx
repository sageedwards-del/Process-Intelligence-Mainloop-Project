import type { Metadata } from "next";
import { DemoPage } from "./DemoPage";

export const metadata: Metadata = {
  title: "Demo · real travel-expense data · Process Discovery Engine",
  description: "Explore a real process: 10,500 travel expense claims from the BPI Challenge 2020, with map, bottlenecks, rules and AI-powered recommendations.",
};

export default function SamplePage() {
  return <DemoPage id="bpic2020" />;
}
