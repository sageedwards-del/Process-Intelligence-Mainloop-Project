import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateInvoiceLog } from "./invoiceApproval.js";
import { toCsv } from "./csv.js";

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "5000" },
    seed: { type: "string", default: "42" },
    out: { type: "string", default: resolve(import.meta.dirname, "../../../data/sample") },
  },
});

const { rows, groundTruth } = generateInvoiceLog({ cases: Number(values.cases), seed: Number(values.seed) });
mkdirSync(values.out!, { recursive: true });
const csvPath = resolve(values.out!, "meridian-invoices.csv");
const truthPath = resolve(values.out!, "meridian-invoices.ground-truth.json");
writeFileSync(csvPath, toCsv(rows));
writeFileSync(truthPath, JSON.stringify(groundTruth, null, 2) + "\n");

console.log(`Wrote ${rows.length} events to ${csvPath}`);
console.log(
  `Injected: ${groundTruth.segregationViolations.length} four-eyes breaks, ` +
    `${groundTruth.missingDirectorApproval.length} missing director approvals, ` +
    `${groundTruth.duplicates.length} duplicates, ${groundTruth.missedDiscounts.length} missed discounts ` +
    `(€${groundTruth.missedDiscountValue.toLocaleString("en")})`,
);
