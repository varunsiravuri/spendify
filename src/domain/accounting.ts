import {
  journalEntrySchema,
  utcTimestampSchema,
  type JournalEntry,
  type JournalLine,
  type PrepaidCreditLot,
  type RateCard,
  type UsageEvent,
} from "@/domain/models";

export type RatedUsage = {
  usageEvent: UsageEvent;
  costMicros: bigint;
};

export type UsageAllocation = RatedUsage & {
  accountCode: "6100" | "7200";
  accountName: "AI cost of revenue" | "Departmental AI expense";
  requiresRdHumanReview: boolean;
};

export type CreditConsumption = {
  lotId: string;
  consumedMicros: bigint;
  remainingMicros: bigint;
};

const compareLots = (left: PrepaidCreditLot, right: PrepaidCreditLot) => {
  const leftExpiry = left.expiresAt ?? "9999-12-31T23:59:59Z";
  const rightExpiry = right.expiresAt ?? "9999-12-31T23:59:59Z";
  return (
    leftExpiry.localeCompare(rightExpiry) ||
    left.purchasedAt.localeCompare(right.purchasedAt) ||
    left.id.localeCompare(right.id)
  );
};

/** Rates an integer quantity using round-half-up at the single-micro boundary. */
export function calculateUsageCost(
  quantity: bigint,
  rateCard: Pick<RateCard, "unitPriceMicros" | "pricingUnit">,
): bigint {
  if (quantity < 0n) throw new Error("Usage quantity cannot be negative");
  if (rateCard.unitPriceMicros < 0n) throw new Error("Rate cannot be negative");
  if (rateCard.pricingUnit <= 0n) throw new Error("Pricing unit must be positive");

  const numerator = quantity * rateCard.unitPriceMicros;
  const quotient = numerator / rateCard.pricingUnit;
  const remainder = numerator % rateCard.pricingUnit;
  return remainder * 2n >= rateCard.pricingUnit ? quotient + 1n : quotient;
}

export function consumePrepaidCredits(input: {
  amountMicros: bigint;
  currency: string;
  asOf: string;
  lots: readonly PrepaidCreditLot[];
}) {
  if (input.amountMicros < 0n) throw new Error("Amount to consume cannot be negative");
  const asOf = utcTimestampSchema.parse(input.asOf);

  let uncoveredMicros = input.amountMicros;
  const consumptions: CreditConsumption[] = [];
  const updatedById = new Map<string, PrepaidCreditLot>();

  for (const lot of [...input.lots].sort(compareLots)) {
    const unavailable =
      lot.currency !== input.currency ||
      lot.remainingMicros === 0n ||
      (lot.expiresAt !== null && lot.expiresAt <= asOf);
    if (unavailable || uncoveredMicros === 0n) continue;

    const consumedMicros =
      lot.remainingMicros < uncoveredMicros ? lot.remainingMicros : uncoveredMicros;
    uncoveredMicros -= consumedMicros;
    const updatedLot = { ...lot, remainingMicros: lot.remainingMicros - consumedMicros };
    updatedById.set(lot.id, updatedLot);
    consumptions.push({ lotId: lot.id, consumedMicros, remainingMicros: updatedLot.remainingMicros });
  }

  return {
    consumptions,
    consumedMicros: input.amountMicros - uncoveredMicros,
    uncoveredMicros,
    lots: input.lots.map((lot) => updatedById.get(lot.id) ?? { ...lot }),
  };
}

export function splitUsageForAccounting(input: {
  ratedUsage: readonly RatedUsage[];
  rdCostCenterIds: ReadonlySet<string>;
}): UsageAllocation[] {
  return input.ratedUsage.map((rated) => {
    const customerFacing = rated.usageEvent.usagePurpose === "customer_facing";
    return {
      ...rated,
      accountCode: customerFacing ? "6100" : "7200",
      accountName: customerFacing ? "AI cost of revenue" : "Departmental AI expense",
      requiresRdHumanReview:
        !customerFacing && input.rdCostCenterIds.has(rated.usageEvent.costCenterId),
    };
  });
}

export function applyCreditsToAllocations(
  allocations: readonly UsageAllocation[],
  availableMicros: bigint,
) {
  if (availableMicros < 0n) throw new Error("Available credits cannot be negative");
  let remainingCredit = availableMicros;
  const orderedAllocations = [...allocations].sort(
    (left, right) =>
      left.usageEvent.occurredAt.localeCompare(right.usageEvent.occurredAt) ||
      left.usageEvent.id.localeCompare(right.usageEvent.id),
  );
  return orderedAllocations.map((allocation) => {
    const creditedMicros =
      allocation.costMicros < remainingCredit ? allocation.costMicros : remainingCredit;
    remainingCredit -= creditedMicros;
    return {
      ...allocation,
      creditedMicros,
      accruedMicros: allocation.costMicros - creditedMicros,
    };
  });
}

export function validateJournalEntryBalances(
  entry: Pick<JournalEntry, "lines">,
): { debitMicros: bigint; creditMicros: bigint } {
  const totals = entry.lines.reduce(
    (result, line) => ({
      debitMicros: result.debitMicros + line.debitMicros,
      creditMicros: result.creditMicros + line.creditMicros,
    }),
    { debitMicros: 0n, creditMicros: 0n },
  );
  if (totals.debitMicros !== totals.creditMicros) {
    throw new Error(
      `Journal entry is out of balance by ${totals.debitMicros - totals.creditMicros} micros`,
    );
  }
  return totals;
}

type AccrualAllocation = UsageAllocation & { accruedMicros: bigint };

export function generateMissingInvoiceAccrual(input: {
  id: string;
  closeRunId: string;
  effectiveDate: string;
  currency: string;
  createdAt: string;
  allocations: readonly AccrualAllocation[];
  lineIds: readonly string[];
}): JournalEntry {
  const outstanding = input.allocations.filter(({ accruedMicros }) => accruedMicros > 0n);
  if (outstanding.some(({ accruedMicros, costMicros }) => accruedMicros > costMicros)) {
    throw new Error("Accrued amount cannot exceed rated usage cost");
  }
  const totalMicros = outstanding.reduce((sum, item) => sum + item.accruedMicros, 0n);
  if (totalMicros === 0n) throw new Error("Cannot accrue a zero missing-invoice amount");
  if (input.lineIds.length !== outstanding.length + 1) {
    throw new Error("Accrual line IDs must cover each debit plus the payable credit");
  }

  const debitLines: JournalLine[] = outstanding.map((item, index) => ({
    id: input.lineIds[index],
    accountCode: item.accountCode,
    description: `Unbilled ${item.accountName.toLowerCase()}`,
    debitMicros: item.accruedMicros,
    creditMicros: 0n,
    costCenterId: item.usageEvent.costCenterId,
    sourceUsageEventIds: [item.usageEvent.id],
  }));
  const creditLine: JournalLine = {
    id: input.lineIds.at(-1)!,
    accountCode: "2110",
    description: "Accrued provider payable",
    debitMicros: 0n,
    creditMicros: totalMicros,
    costCenterId: null,
    sourceUsageEventIds: outstanding.map(({ usageEvent }) => usageEvent.id),
  };

  const entry = journalEntrySchema.parse({
    id: input.id,
    closeRunId: input.closeRunId,
    entryType: "missing_invoice_accrual",
    status: "draft",
    effectiveDate: input.effectiveDate,
    currency: input.currency,
    memo: "Accrue rated usage not covered by prepaid credits; provider invoice missing",
    reversesJournalEntryId: null,
    lines: [...debitLines, creditLine],
    createdAt: input.createdAt,
  });
  validateJournalEntryBalances(entry);
  return entry;
}

export function generateNextPeriodReversal(input: {
  id: string;
  effectiveDate: string;
  createdAt: string;
  accrual: JournalEntry;
  lineIds: readonly string[];
}): JournalEntry {
  if (input.accrual.entryType !== "missing_invoice_accrual") {
    throw new Error("Only a missing-invoice accrual can be reversed");
  }
  if (input.lineIds.length !== input.accrual.lines.length) {
    throw new Error("Reversal requires one new ID per journal line");
  }
  if (input.effectiveDate <= input.accrual.effectiveDate) {
    throw new Error("Reversal must be effective after the accrual");
  }

  const entry = journalEntrySchema.parse({
    ...input.accrual,
    id: input.id,
    entryType: "accrual_reversal",
    effectiveDate: input.effectiveDate,
    createdAt: input.createdAt,
    memo: `Automatic reversal of ${input.accrual.id}`,
    reversesJournalEntryId: input.accrual.id,
    lines: input.accrual.lines.map((line, index) => ({
      ...line,
      id: input.lineIds[index],
      debitMicros: line.creditMicros,
      creditMicros: line.debitMicros,
    })),
  });
  validateJournalEntryBalances(entry);
  return entry;
}
