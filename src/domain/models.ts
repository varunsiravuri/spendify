import { z } from "zod";

export const idSchema = z.string().uuid();
export const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Timestamp must be normalized to UTC (Z)");
export const isoDateSchema = z.string().date();
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const moneyMicrosSchema = z.bigint();
export const nonNegativeMoneyMicrosSchema = moneyMicrosSchema.nonnegative();
export const positiveIntegerSchema = z.bigint().positive();

export const providerSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  providerType: z.enum(["ai", "cloud"]),
  createdAt: utcTimestampSchema,
});

export const rateCardSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  sku: z.string().min(1),
  currency: currencySchema,
  unitPriceMicros: nonNegativeMoneyMicrosSchema,
  pricingUnit: positiveIntegerSchema,
  effectiveFrom: utcTimestampSchema,
  effectiveTo: utcTimestampSchema.nullable(),
}).refine(
  ({ effectiveFrom, effectiveTo }) => effectiveTo === null || effectiveTo > effectiveFrom,
  { message: "Rate card end must be after its start", path: ["effectiveTo"] },
);

export const usageEventSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  sourceEventId: z.string().min(1),
  rateCardId: idSchema,
  occurredAt: utcTimestampSchema,
  quantity: positiveIntegerSchema,
  costCenterId: idSchema,
  usagePurpose: z.enum(["customer_facing", "internal"]),
  customerReference: z.string().min(1).nullable(),
  ingestedAt: utcTimestampSchema,
}).refine(
  ({ usagePurpose, customerReference }) =>
    (usagePurpose === "customer_facing" && customerReference !== null) ||
    (usagePurpose === "internal" && customerReference === null),
  { message: "Customer reference must match the usage purpose", path: ["customerReference"] },
);

export const invoiceSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  sourceInvoiceId: z.string().min(1),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  currency: currencySchema,
  totalMicros: nonNegativeMoneyMicrosSchema,
  receivedAt: utcTimestampSchema,
}).refine(({ periodStart, periodEnd }) => periodEnd >= periodStart, {
  message: "Invoice period end cannot precede its start",
  path: ["periodEnd"],
});

export const prepaidCreditLotSchema = z.object({
  id: idSchema,
  providerId: idSchema,
  currency: currencySchema,
  originalMicros: nonNegativeMoneyMicrosSchema,
  remainingMicros: nonNegativeMoneyMicrosSchema,
  purchasedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema.nullable(),
})
  .refine(({ originalMicros, remainingMicros }) => remainingMicros <= originalMicros, {
    message: "Remaining credit cannot exceed the original lot",
    path: ["remainingMicros"],
  })
  .refine(({ purchasedAt, expiresAt }) => expiresAt === null || expiresAt > purchasedAt, {
    message: "Credit expiry must be after purchase",
    path: ["expiresAt"],
  });

export const costCenterSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  department: z.string().min(1),
  isResearchAndDevelopment: z.boolean(),
});

export const closeRunSchema = z.object({
  id: idSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  status: z.enum(["draft", "in_review", "approved", "posted"]),
  startedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema.nullable(),
})
  .refine(({ periodStart, periodEnd }) => periodEnd >= periodStart, {
    message: "Close period end cannot precede its start",
    path: ["periodEnd"],
  })
  .refine(({ startedAt, completedAt }) => completedAt === null || completedAt >= startedAt, {
    message: "Close completion cannot precede its start",
    path: ["completedAt"],
  });

export const exceptionSchema = z.object({
  id: idSchema,
  closeRunId: idSchema,
  exceptionType: z.enum(["missing_invoice", "rd_human_review"]),
  severity: z.enum(["info", "warning", "error"]),
  status: z.enum(["open", "resolved"]),
  message: z.string().min(1),
  requiresHumanReview: z.boolean(),
  createdAt: utcTimestampSchema,
});

export const journalLineSchema = z
  .object({
    id: idSchema,
    accountCode: z.string().min(1),
    description: z.string().min(1),
    debitMicros: nonNegativeMoneyMicrosSchema,
    creditMicros: nonNegativeMoneyMicrosSchema,
    costCenterId: idSchema.nullable(),
    sourceUsageEventIds: z.array(idSchema),
  })
  .refine(
    ({ debitMicros, creditMicros }) =>
      (debitMicros > 0n && creditMicros === 0n) ||
      (creditMicros > 0n && debitMicros === 0n),
    "A journal line must have exactly one positive debit or credit",
  );

export const journalEntrySchema = z.object({
  id: idSchema,
  closeRunId: idSchema,
  entryType: z.enum(["prepaid_usage", "missing_invoice_accrual", "accrual_reversal"]),
  status: z.enum(["draft", "approved", "posted"]),
  effectiveDate: isoDateSchema,
  currency: currencySchema,
  memo: z.string().min(1),
  reversesJournalEntryId: idSchema.nullable(),
  lines: z.array(journalLineSchema).min(2),
  createdAt: utcTimestampSchema,
});

export const approvalSchema = z.object({
  id: idSchema,
  closeRunId: idSchema,
  journalEntryId: idSchema.nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  reviewerReference: z.string().min(1).nullable(),
  decidedAt: utcTimestampSchema.nullable(),
  createdAt: utcTimestampSchema,
}).refine(
  ({ status, reviewerReference, decidedAt }) =>
    (status === "pending" && reviewerReference === null && decidedAt === null) ||
    (status !== "pending" && reviewerReference !== null && decidedAt !== null),
  { message: "Approval decision metadata must match its status" },
);

export const auditEventSchema = z.object({
  id: idSchema,
  sequence: z.bigint().positive(),
  aggregateType: z.string().min(1),
  aggregateId: idSchema,
  eventType: z.string().min(1),
  actorType: z.enum(["system", "human"]),
  occurredAt: utcTimestampSchema,
  payload: z.record(z.string(), z.unknown()),
  previousEventHash: z.string().nullable(),
  eventHash: z.string().min(1),
});

export type Provider = z.infer<typeof providerSchema>;
export type RateCard = z.infer<typeof rateCardSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type PrepaidCreditLot = z.infer<typeof prepaidCreditLotSchema>;
export type CostCenter = z.infer<typeof costCenterSchema>;
export type CloseRun = z.infer<typeof closeRunSchema>;
export type Exception = z.infer<typeof exceptionSchema>;
export type JournalLine = z.infer<typeof journalLineSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
