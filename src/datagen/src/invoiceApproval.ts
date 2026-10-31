import type { RawEvent } from "@throughline/engine";
import { Random } from "./random.js";

/**
 * Accounts-payable invoice approval at "Meridian Advisory", a fictional
 * professional-services firm (see docs/discovery-notes.md).
 *
 * Happy path:
 *   Receive Invoice → Register Invoice → Match to Engagement → Partner Approval
 *   → [Director Approval if amount > 10k] → Approve Payment → Schedule Payment → Pay Invoice
 *
 * Injected problems (all recorded in the ground truth):
 *   1. Slow approver   — one partner takes ~6× longer to approve.
 *   2. Rework loop     — price mismatches send invoices through
 *                        Request Credit Note → Receive Credit Note → Match to Engagement again.
 *   3. Four-eyes break — the clerk who registered the invoice also approves the payment.
 *   4. Missing control — some invoices over 10k are paid without Director Approval.
 *   5. Duplicates      — the same vendor invoice is entered and paid twice.
 *   Consequence: invoices on "2/10 net 30" terms paid after 10 days lose the 2% discount.
 */

export const ACTIVITIES = {
  receive: "Receive Invoice",
  register: "Register Invoice",
  match: "Match to Engagement",
  requestCredit: "Request Credit Note",
  receiveCredit: "Receive Credit Note",
  partner: "Partner Approval",
  reject: "Reject Invoice",
  director: "Director Approval",
  approvePayment: "Approve Payment",
  schedule: "Schedule Payment",
  pay: "Pay Invoice",
} as const;

export const DISCOUNT_TERMS = "2/10 net 30";
export const DIRECTOR_THRESHOLD = 10_000;
export const DISCOUNT_WINDOW_HOURS = 240;

const CLERKS = ["A. Silva", "J. Okafor", "M. Rossi", "L. Chen"];
const CONTROLLERS = ["T. Novak", "H. Berg"];
const DIRECTOR = "E. Varga";
const SYSTEM = "Payment Run";
const VENDOR_PORTAL = "Vendor Portal";

const PRACTICES = [
  { area: "Tax", partner: "P. Moreau" },
  { area: "Advisory", partner: "R. Patel" },
  { area: "Audit", partner: "K. Nakamura" },
  { area: "Legal", partner: "S. Dubois" },
] as const;

const VENDOR_NAMES = [
  "Northwind Legal Research", "Atlas Office Supply", "Brightline IT Services", "Calder Travel Group",
  "Delta Courier", "Evergreen Facilities", "Fjord Data Subscriptions", "Granite Recruiting",
  "Harbor Print & Design", "Ironbridge Consulting", "Juniper Catering", "Keystone Software",
  "Lumen Translation", "Meridian Cloud Hosting", "Nova Market Data", "Orbit Telecom",
  "Pioneer Training", "Quartz Insurance Brokers", "Redwood Archives", "Summit Expert Witnesses",
];

export interface InvoiceLogOptions {
  cases?: number;
  seed?: number;
  /** First possible case start (epoch ms). Default 2 Mar 2026. */
  start?: number;
  /** Window over which case starts are spread, in days. Default 180. */
  spanDays?: number;
  /** Partner whose approvals are slow. */
  slowPartner?: string;
  rates?: Partial<InjectionRates>;
}

export interface InjectionRates {
  priceMismatch: number;
  repeatMismatch: number;
  reject: number;
  skipDirector: number;
  sameClerkApproves: number;
  duplicate: number;
  discountVendorShare: number;
}

const DEFAULT_RATES: InjectionRates = {
  priceMismatch: 0.12,
  repeatMismatch: 0.25,
  reject: 0.04,
  skipDirector: 0.06,
  sameClerkApproves: 0.03,
  duplicate: 0.01,
  discountVendorShare: 0.35,
};

export interface GroundTruth {
  slowApprover: { activity: string; resource: string };
  reworkActivity: string;
  segregationViolations: string[];
  missingDirectorApproval: string[];
  duplicates: string[];
  missedDiscounts: string[];
  missedDiscountValue: number;
}

export interface GeneratedLog {
  rows: RawEvent[];
  groundTruth: GroundTruth;
}

const HOUR = 3_600_000;

export function generateInvoiceLog(opts: InvoiceLogOptions = {}): GeneratedLog {
  const n = opts.cases ?? 5000;
  const rng = new Random(opts.seed ?? 42);
  const start = opts.start ?? Date.UTC(2026, 2, 2, 8);
  const spanMs = (opts.spanDays ?? 180) * 24 * HOUR;
  const slowPartner = opts.slowPartner ?? "P. Moreau";
  const rates = { ...DEFAULT_RATES, ...opts.rates };

  const vendors = VENDOR_NAMES.map((name, i) => ({
    name,
    code: `V${String(i + 1).padStart(3, "0")}`,
    terms: rng.chance(rates.discountVendorShare) ? DISCOUNT_TERMS : "net 30",
  }));

  const truth: GroundTruth = {
    slowApprover: { activity: ACTIVITIES.partner, resource: slowPartner },
    reworkActivity: ACTIVITIES.match,
    segregationViolations: [],
    missingDirectorApproval: [],
    duplicates: [],
    missedDiscounts: [],
    missedDiscountValue: 0,
  };

  interface Header {
    vendor: (typeof vendors)[number];
    invoiceNumber: string;
    amount: number;
    practice: (typeof PRACTICES)[number];
    t0: number;
  }

  const rows: RawEvent[] = [];
  const headers: Header[] = [];
  let caseSeq = 0;

  const emitCase = (h: Header): string => {
    const caseId = `INV-${String(++caseSeq).padStart(5, "0")}`;
    const attrs = {
      vendor: h.vendor.name,
      invoice_number: h.invoiceNumber,
      amount: h.amount,
      practice_area: h.practice.area,
      partner: h.practice.partner,
      discount_terms: h.vendor.terms,
    };
    let t = h.t0;
    const ev = (activity: string, resource: string) => rows.push({ caseId, activity, timestamp: Math.round(t / 1000) * 1000, resource, attrs });
    const wait = (medianHours: number, sigma = 0.6) => (t += rng.logNormal(medianHours, sigma) * HOUR);

    const clerk = rng.pick(CLERKS);
    ev(ACTIVITIES.receive, clerk);
    wait(3);
    ev(ACTIVITIES.register, clerk);
    wait(6);
    ev(ACTIVITIES.match, rng.pick(CLERKS));

    if (rng.chance(rates.priceMismatch)) {
      let again = true;
      while (again) {
        wait(2, 0.4);
        ev(ACTIVITIES.requestCredit, rng.pick(CLERKS));
        wait(72, 0.5);
        ev(ACTIVITIES.receiveCredit, VENDOR_PORTAL);
        wait(4);
        ev(ACTIVITIES.match, rng.pick(CLERKS));
        again = rng.chance(rates.repeatMismatch);
      }
    }

    const partner = h.practice.partner;
    wait(partner === slowPartner ? 110 : 18, 0.55);
    if (rng.chance(rates.reject)) {
      ev(ACTIVITIES.reject, partner);
      return caseId;
    }
    ev(ACTIVITIES.partner, partner);

    if (h.amount > DIRECTOR_THRESHOLD) {
      if (rng.chance(rates.skipDirector)) {
        truth.missingDirectorApproval.push(caseId);
      } else {
        wait(20);
        ev(ACTIVITIES.director, DIRECTOR);
      }
    }

    wait(8);
    if (rng.chance(rates.sameClerkApproves)) {
      ev(ACTIVITIES.approvePayment, clerk);
      truth.segregationViolations.push(caseId);
    } else {
      ev(ACTIVITIES.approvePayment, rng.pick(CONTROLLERS));
    }

    wait(1, 0.3);
    ev(ACTIVITIES.schedule, SYSTEM);
    t = nextPaymentRun(t);
    ev(ACTIVITIES.pay, SYSTEM);

    if (h.vendor.terms === DISCOUNT_TERMS && t - h.t0 > DISCOUNT_WINDOW_HOURS * HOUR) {
      truth.missedDiscounts.push(caseId);
      truth.missedDiscountValue += h.amount * 0.02;
    }
    return caseId;
  };

  for (let i = 0; i < n; i++) {
    const vendor = rng.pick(vendors);
    const h: Header = {
      vendor,
      invoiceNumber: `${vendor.code}-${String(10000 + i)}`,
      amount: Math.round(rng.logNormal(3800, 0.9) * 100) / 100,
      practice: rng.pick(PRACTICES),
      t0: start + rng.next() * spanMs,
    };
    headers.push(h);
    emitCase(h);
  }

  // Duplicates: the same vendor invoice is received again a few days later.
  const dupCount = Math.round(n * rates.duplicate);
  for (let i = 0; i < dupCount; i++) {
    const original = rng.pick(headers);
    const id = emitCase({ ...original, t0: original.t0 + rng.int(2, 9) * 24 * HOUR });
    truth.duplicates.push(id);
  }

  truth.missedDiscountValue = Math.round(truth.missedDiscountValue * 100) / 100;
  return { rows, groundTruth: truth };
}

/** Payment runs execute Tuesdays and Thursdays at 10:00 UTC. */
function nextPaymentRun(t: number): number {
  const d = new Date(t);
  for (let add = 0; add < 8; add++) {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 10));
    const dow = day.getUTCDay();
    if ((dow === 2 || dow === 4) && day.getTime() > t) return day.getTime();
  }
  throw new Error("unreachable");
}

/**
 * The rules a Meridian finance controller would state, expressed in the
 * engine's rule format. Used as the demo dataset's default rule set.
 */
export const INVOICE_RULES = [
  {
    id: "four-eyes",
    name: "Registering clerk must not approve payment",
    type: "segregation",
    activities: [ACTIVITIES.register, ACTIVITIES.approvePayment],
  },
  {
    id: "director-over-10k",
    name: "Invoices over €10k need Director Approval before payment",
    type: "precedence",
    before: ACTIVITIES.director,
    after: ACTIVITIES.pay,
    where: [{ attribute: "amount", op: "gt", value: DIRECTOR_THRESHOLD }],
  },
  {
    id: "no-duplicates",
    name: "No vendor invoice paid twice",
    type: "duplicate",
    keys: ["vendor", "invoice_number"],
  },
  {
    id: "early-payment-discount",
    name: "Pay 2/10 invoices within 10 days",
    type: "sla",
    from: ACTIVITIES.receive,
    to: ACTIVITIES.pay,
    maxHours: DISCOUNT_WINDOW_HOURS,
    where: [{ attribute: "discount_terms", op: "eq", value: DISCOUNT_TERMS }],
  },
] as const satisfies readonly import("@throughline/engine").Rule[];
