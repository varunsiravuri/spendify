import {
  applyCreditsToAllocations,
  calculateUsageCost,
  consumePrepaidCredits,
  generateMissingInvoiceAccrual,
  generateNextPeriodReversal,
  splitUsageForAccounting,
  validateJournalEntryBalances,
} from "@/domain/accounting";
import {
  approvalSchema,
  auditEventSchema,
  closeRunSchema,
  costCenterSchema,
  exceptionSchema,
  journalEntrySchema,
  prepaidCreditLotSchema,
  providerSchema,
  rateCardSchema,
  usageEventSchema,
} from "@/domain/models";

const ids = {
  provider: "10000000-0000-4000-8000-000000000001",
  rateCard: "20000000-0000-4000-8000-000000000001",
  customerCostCenter: "30000000-0000-4000-8000-000000000001",
  rdCostCenter: "30000000-0000-4000-8000-000000000002",
  customerUsage: "40000000-0000-4000-8000-000000000001",
  internalUsage: "40000000-0000-4000-8000-000000000002",
  creditLot: "50000000-0000-4000-8000-000000000001",
  closeRun: "60000000-0000-4000-8000-000000000001",
} as const;

export function buildDemoScenario() {
  const provider = providerSchema.parse({
    id: ids.provider,
    name: "Northstar AI",
    providerType: "ai",
    createdAt: "2026-08-01T00:00:00Z",
  });
  const rateCard = rateCardSchema.parse({
    id: ids.rateCard,
    providerId: ids.provider,
    sku: "inference-token",
    currency: "USD",
    unitPriceMicros: 2_000_000n,
    pricingUnit: 1_000_000n,
    effectiveFrom: "2026-08-01T00:00:00Z",
    effectiveTo: null,
  });
  const costCenters = [
    costCenterSchema.parse({
      id: ids.customerCostCenter,
      code: "CUSTOMER",
      name: "Customer workloads",
      department: "Cost of Revenue",
      isResearchAndDevelopment: false,
    }),
    costCenterSchema.parse({
      id: ids.rdCostCenter,
      code: "RND-PLATFORM",
      name: "AI Platform",
      department: "Research & Development",
      isResearchAndDevelopment: true,
    }),
  ];
  const usageEvents = [
    usageEventSchema.parse({
      id: ids.customerUsage,
      providerId: ids.provider,
      sourceEventId: "northstar:usage:customer:2026-08",
      rateCardId: ids.rateCard,
      occurredAt: "2026-08-31T22:00:00Z",
      quantity: 4_000_000_000n,
      costCenterId: ids.customerCostCenter,
      usagePurpose: "customer_facing",
      customerReference: "customer-portfolio",
      ingestedAt: "2026-09-01T00:05:00Z",
    }),
    usageEventSchema.parse({
      id: ids.internalUsage,
      providerId: ids.provider,
      sourceEventId: "northstar:usage:internal:2026-08",
      rateCardId: ids.rateCard,
      occurredAt: "2026-08-31T23:00:00Z",
      quantity: 2_000_000_000n,
      costCenterId: ids.rdCostCenter,
      usagePurpose: "internal",
      customerReference: null,
      ingestedAt: "2026-09-01T00:05:00Z",
    }),
  ];
  const originalCreditLot = prepaidCreditLotSchema.parse({
    id: ids.creditLot,
    providerId: ids.provider,
    currency: "USD",
    originalMicros: 10_000_000_000n,
    remainingMicros: 10_000_000_000n,
    purchasedAt: "2026-08-01T00:00:00Z",
    expiresAt: null,
  });
  const closeRun = closeRunSchema.parse({
    id: ids.closeRun,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    status: "in_review",
    startedAt: "2026-09-01T00:10:00Z",
    completedAt: "2026-09-01T00:10:01Z",
  });

  const ratedUsage = usageEvents.map((usageEvent) => ({
    usageEvent,
    costMicros: calculateUsageCost(usageEvent.quantity, rateCard),
  }));
  const allocations = splitUsageForAccounting({
    ratedUsage,
    rdCostCenterIds: new Set([ids.rdCostCenter]),
  });
  const totalUsageMicros = allocations.reduce((sum, item) => sum + item.costMicros, 0n);
  const credits = consumePrepaidCredits({
    amountMicros: totalUsageMicros,
    currency: "USD",
    asOf: "2026-08-31T23:59:59Z",
    lots: [originalCreditLot],
  });
  const fundedAllocations = applyCreditsToAllocations(allocations, credits.consumedMicros);

  const prepaidEntry = journalEntrySchema.parse({
    id: "80000000-0000-4000-8000-000000000001",
    closeRunId: ids.closeRun,
    entryType: "prepaid_usage",
    status: "draft",
    effectiveDate: "2026-08-31",
    currency: "USD",
    memo: "Recognize usage funded by prepaid credits",
    reversesJournalEntryId: null,
    createdAt: "2026-09-01T00:10:01Z",
    lines: [
      {
        id: "81000000-0000-4000-8000-000000000001",
        accountCode: "6100",
        description: "Customer-facing AI usage",
        debitMicros: 8_000_000_000n,
        creditMicros: 0n,
        costCenterId: ids.customerCostCenter,
        sourceUsageEventIds: [ids.customerUsage],
      },
      {
        id: "81000000-0000-4000-8000-000000000002",
        accountCode: "7200",
        description: "Internal AI usage funded by credits",
        debitMicros: 2_000_000_000n,
        creditMicros: 0n,
        costCenterId: ids.rdCostCenter,
        sourceUsageEventIds: [ids.internalUsage],
      },
      {
        id: "81000000-0000-4000-8000-000000000003",
        accountCode: "1410",
        description: "Prepaid AI credits consumed",
        debitMicros: 0n,
        creditMicros: 10_000_000_000n,
        costCenterId: null,
        sourceUsageEventIds: [ids.customerUsage, ids.internalUsage],
      },
    ],
  });
  validateJournalEntryBalances(prepaidEntry);

  const accrualEntry = generateMissingInvoiceAccrual({
    id: "80000000-0000-4000-8000-000000000002",
    closeRunId: ids.closeRun,
    effectiveDate: "2026-08-31",
    currency: "USD",
    createdAt: "2026-09-01T00:10:01Z",
    allocations: fundedAllocations,
    lineIds: [
      "82000000-0000-4000-8000-000000000001",
      "82000000-0000-4000-8000-000000000002",
    ],
  });
  const reversalEntry = generateNextPeriodReversal({
    id: "80000000-0000-4000-8000-000000000003",
    effectiveDate: "2026-09-01",
    createdAt: "2026-09-01T00:10:01Z",
    accrual: accrualEntry,
    lineIds: [
      "83000000-0000-4000-8000-000000000001",
      "83000000-0000-4000-8000-000000000002",
    ],
  });

  const exceptions = [
    exceptionSchema.parse({
      id: "70000000-0000-4000-8000-000000000001",
      closeRunId: ids.closeRun,
      exceptionType: "missing_invoice",
      severity: "warning",
      status: "open",
      message: "Northstar AI invoice is missing; usage beyond credits was accrued.",
      requiresHumanReview: true,
      createdAt: "2026-09-01T00:10:01Z",
    }),
    exceptionSchema.parse({
      id: "70000000-0000-4000-8000-000000000002",
      closeRunId: ids.closeRun,
      exceptionType: "rd_human_review",
      severity: "info",
      status: "open",
      message: "R&D usage remains OpEx. Any capitalization requires human review.",
      requiresHumanReview: true,
      createdAt: "2026-09-01T00:10:01Z",
    }),
  ];
  const approval = approvalSchema.parse({
    id: "90000000-0000-4000-8000-000000000001",
    closeRunId: ids.closeRun,
    journalEntryId: null,
    status: "pending",
    reviewerReference: null,
    decidedAt: null,
    createdAt: "2026-09-01T00:10:01Z",
  });
  const auditEvent = auditEventSchema.parse({
    id: "a0000000-0000-4000-8000-000000000001",
    sequence: 1n,
    aggregateType: "close_run",
    aggregateId: ids.closeRun,
    eventType: "close_run.calculated",
    actorType: "system",
    occurredAt: "2026-09-01T00:10:01Z",
    payload: {
      usageMicros: totalUsageMicros.toString(),
      prepaidMicros: credits.consumedMicros.toString(),
      accrualMicros: credits.uncoveredMicros.toString(),
      invoiceReceived: false,
    },
    previousEventHash: null,
    eventHash: "demo-close-v1-sha256",
  });

  return {
    provider,
    rateCard,
    costCenters,
    usageEvents,
    originalCreditLot,
    closeRun,
    allocations: fundedAllocations,
    creditResult: credits,
    totalUsageMicros,
    journalEntries: [prepaidEntry, accrualEntry, reversalEntry],
    exceptions,
    approval,
    auditEvent,
  };
}

export function formatUsdMicros(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const dollars = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  const centsAndMicros = fraction.replace(/0+$/, "").padEnd(2, "0");
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${centsAndMicros}`;
}
