import { describe, expect, it } from "vitest";

import {
  applyCreditsToAllocations,
  calculateUsageCost,
  consumePrepaidCredits,
  generateMissingInvoiceAccrual,
  generateNextPeriodReversal,
  splitUsageForAccounting,
  validateJournalEntryBalances,
} from "@/domain/accounting";
import { buildDemoScenario, formatUsdMicros } from "@/domain/demo";
import { prepaidCreditLotSchema, rateCardSchema, usageEventSchema } from "@/domain/models";

const providerId = "10000000-0000-4000-8000-000000000001";
const rateCardId = "20000000-0000-4000-8000-000000000001";
const costCenterId = "30000000-0000-4000-8000-000000000002";

describe("calculateUsageCost", () => {
  it("calculates exact integer-micro cost", () => {
    const rate = rateCardSchema.parse({
      id: rateCardId,
      providerId,
      sku: "tokens",
      currency: "USD",
      unitPriceMicros: 2_000_000n,
      pricingUnit: 1_000_000n,
      effectiveFrom: "2026-08-01T00:00:00Z",
      effectiveTo: null,
    });

    expect(calculateUsageCost(4_000_000_000n, rate)).toBe(8_000_000_000n);
  });

  it("rounds half a micro upward without floating point", () => {
    expect(calculateUsageCost(1n, { unitPriceMicros: 1n, pricingUnit: 2n })).toBe(1n);
    expect(calculateUsageCost(1n, { unitPriceMicros: 1n, pricingUnit: 3n })).toBe(0n);
  });
});

describe("consumePrepaidCredits", () => {
  it("consumes eligible lots by expiry then purchase time and reports uncovered micros", () => {
    const lots = [
      prepaidCreditLotSchema.parse({
        id: "50000000-0000-4000-8000-000000000001",
        providerId,
        currency: "USD",
        originalMicros: 7_000_000n,
        remainingMicros: 7_000_000n,
        purchasedAt: "2026-01-01T00:00:00Z",
        expiresAt: null,
      }),
      prepaidCreditLotSchema.parse({
        id: "50000000-0000-4000-8000-000000000002",
        providerId,
        currency: "USD",
        originalMicros: 5_000_000n,
        remainingMicros: 5_000_000n,
        purchasedAt: "2026-02-01T00:00:00Z",
        expiresAt: "2026-12-31T00:00:00Z",
      }),
    ];

    const result = consumePrepaidCredits({
      amountMicros: 14_000_000n,
      currency: "USD",
      asOf: "2026-08-31T23:59:59Z",
      lots,
    });

    expect(result.consumptions.map(({ lotId }) => lotId)).toEqual([lots[1].id, lots[0].id]);
    expect(result.consumedMicros).toBe(12_000_000n);
    expect(result.uncoveredMicros).toBe(2_000_000n);
    expect(result.lots.map(({ remainingMicros }) => remainingMicros)).toEqual([0n, 0n]);
    expect(lots.map(({ remainingMicros }) => remainingMicros)).toEqual([7_000_000n, 5_000_000n]);
    expect(() =>
      consumePrepaidCredits({
        amountMicros: 1n,
        currency: "USD",
        asOf: "2026-08-31T23:59:59+05:30",
        lots,
      }),
    ).toThrow("Timestamp must be normalized to UTC");
  });
});

describe("classification and journal generation", () => {
  const internalUsage = usageEventSchema.parse({
    id: "40000000-0000-4000-8000-000000000002",
    providerId,
    sourceEventId: "provider:event:2",
    rateCardId,
    occurredAt: "2026-08-31T23:00:00Z",
    quantity: 10n,
    costCenterId,
    usagePurpose: "internal",
    customerReference: null,
    ingestedAt: "2026-09-01T00:00:00Z",
  });

  it("maps customer usage to COGS and internal R&D to OpEx plus review", () => {
    const customerUsage = usageEventSchema.parse({
      ...internalUsage,
      id: "40000000-0000-4000-8000-000000000001",
      sourceEventId: "provider:event:1",
      usagePurpose: "customer_facing",
      customerReference: "customer-1",
    });
    const allocations = splitUsageForAccounting({
      ratedUsage: [
        { usageEvent: customerUsage, costMicros: 8_000_000n },
        { usageEvent: internalUsage, costMicros: 4_000_000n },
      ],
      rdCostCenterIds: new Set([costCenterId]),
    });

    expect(allocations.map(({ accountCode }) => accountCode)).toEqual(["6100", "7200"]);
    expect(allocations.map(({ requiresRdHumanReview }) => requiresRdHumanReview)).toEqual([false, true]);
    expect(() =>
      usageEventSchema.parse({
        ...internalUsage,
        customerReference: "not-allowed-for-internal-usage",
      }),
    ).toThrow("Customer reference must match the usage purpose");
  });

  it("creates an exact accrual and next-period reversal", () => {
    const [allocation] = splitUsageForAccounting({
      ratedUsage: [{ usageEvent: internalUsage, costMicros: 2_000_000n }],
      rdCostCenterIds: new Set([costCenterId]),
    });
    const accrual = generateMissingInvoiceAccrual({
      id: "80000000-0000-4000-8000-000000000002",
      closeRunId: "60000000-0000-4000-8000-000000000001",
      effectiveDate: "2026-08-31",
      currency: "USD",
      createdAt: "2026-09-01T00:10:01Z",
      allocations: [{ ...allocation, accruedMicros: 2_000_000n }],
      lineIds: [
        "82000000-0000-4000-8000-000000000001",
        "82000000-0000-4000-8000-000000000002",
      ],
    });
    const reversal = generateNextPeriodReversal({
      id: "80000000-0000-4000-8000-000000000003",
      effectiveDate: "2026-09-01",
      createdAt: "2026-09-01T00:10:01Z",
      accrual,
      lineIds: [
        "83000000-0000-4000-8000-000000000001",
        "83000000-0000-4000-8000-000000000002",
      ],
    });

    expect(validateJournalEntryBalances(accrual)).toEqual({ debitMicros: 2_000_000n, creditMicros: 2_000_000n });
    expect(reversal.reversesJournalEntryId).toBe(accrual.id);
    expect(reversal.lines.map(({ debitMicros, creditMicros }) => [debitMicros, creditMicros])).toEqual([
      [0n, 2_000_000n],
      [2_000_000n, 0n],
    ]);
  });

  it("rejects a journal that is out of balance by one micro", () => {
    expect(() =>
      validateJournalEntryBalances({
        lines: [
          { debitMicros: 10n, creditMicros: 0n },
          { debitMicros: 0n, creditMicros: 9n },
        ],
      } as never),
    ).toThrow("out of balance by 1 micros");
  });
});

describe("seeded demo", () => {
  it("produces the documented costs, credits, journals, lineage, and R&D flag", () => {
    const scenario = buildDemoScenario();

    expect(scenario.totalUsageMicros).toBe(12_000_000_000n);
    expect(scenario.allocations.map(({ costMicros }) => costMicros)).toEqual([8_000_000_000n, 4_000_000_000n]);
    expect(scenario.creditResult.consumedMicros).toBe(10_000_000_000n);
    expect(scenario.creditResult.uncoveredMicros).toBe(2_000_000_000n);
    expect(scenario.journalEntries).toHaveLength(3);
    expect(scenario.journalEntries.map(validateJournalEntryBalances)).toEqual([
      { debitMicros: 10_000_000_000n, creditMicros: 10_000_000_000n },
      { debitMicros: 2_000_000_000n, creditMicros: 2_000_000_000n },
      { debitMicros: 2_000_000_000n, creditMicros: 2_000_000_000n },
    ]);
    expect(scenario.journalEntries[1].lines[0].sourceUsageEventIds).toEqual([
      "40000000-0000-4000-8000-000000000002",
    ]);
    expect(scenario.exceptions.some(({ exceptionType }) => exceptionType === "rd_human_review")).toBe(true);
    expect(scenario.approval.status).toBe("pending");

    const reversedInput = [...scenario.allocations].reverse().map((allocation) => ({
      usageEvent: allocation.usageEvent,
      costMicros: allocation.costMicros,
      accountCode: allocation.accountCode,
      accountName: allocation.accountName,
      requiresRdHumanReview: allocation.requiresRdHumanReview,
    }));
    const reordered = applyCreditsToAllocations(reversedInput, 10_000_000_000n);
    expect(reordered.map(({ usageEvent, accruedMicros }) => [usageEvent.id, accruedMicros])).toEqual([
      ["40000000-0000-4000-8000-000000000001", 0n],
      ["40000000-0000-4000-8000-000000000002", 2_000_000_000n],
    ]);
  });

  it("formats micros without converting through floating point", () => {
    expect(formatUsdMicros(12_000_000_000n)).toBe("$12,000.00");
    expect(formatUsdMicros(1_234_567n)).toBe("$1.234567");
    expect(formatUsdMicros(-50_000n)).toBe("-$0.05");
  });
});
