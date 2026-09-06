import { AlertTriangle, ArrowRight, CheckCircle2, Database, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildDemoScenario, formatUsdMicros } from "@/domain/demo";

export default function Home() {
  const scenario = buildDemoScenario();
  const [prepaid, accrual, reversal] = scenario.journalEntries;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-6 lg:px-8 lg:py-12">
      <header className="flex flex-col gap-4 border-b pb-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database aria-hidden="true" className="size-4" />
            August 2026 close · deterministic demo
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Spendify close foundation</h1>
          <p className="text-sm leading-6 text-muted-foreground md:text-base">
            Rated usage, prepaid consumption, missing-invoice accrual, reversal, and source lineage—calculated entirely in integer micros.
          </p>
        </div>
        <Badge variant="warning" className="w-fit">Human review required</Badge>
      </header>

      <section aria-labelledby="summary-heading" className="space-y-4">
        <h2 id="summary-heading" className="sr-only">Close summary</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Rated usage", formatUsdMicros(scenario.totalUsageMicros), "6B tokens at $2 / 1M"],
            ["Credits consumed", formatUsdMicros(scenario.creditResult.consumedMicros), "FIFO; balance $0.00"],
            ["Missing invoice accrual", formatUsdMicros(scenario.creditResult.uncoveredMicros), "Invoice not received"],
            ["Draft entries", "3", "All balance exactly"],
          ].map(([label, value, detail]) => (
            <Card key={label}>
              <CardHeader className="pb-3">
                <CardDescription>{label}</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">{value}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Usage allocation</CardTitle>
            <CardDescription>Each amount retains its provider source event ID.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Source event</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenario.allocations.map((allocation) => (
                  <TableRow key={allocation.usageEvent.id}>
                    <TableCell className="font-medium">
                      {allocation.usageEvent.usagePurpose === "customer_facing" ? "Customer-facing" : "Internal R&D"}
                    </TableCell>
                    <TableCell>{allocation.accountCode} · {allocation.accountName}</TableCell>
                    <TableCell className="max-w-52 truncate font-mono text-xs text-muted-foreground" title={allocation.usageEvent.sourceEventId}>
                      {allocation.usageEvent.sourceEventId}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUsdMicros(allocation.costMicros)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review queue</CardTitle>
            <CardDescription>Automation stops at accounting judgment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {scenario.exceptions.map((exception) => (
              <div className="flex gap-3" key={exception.id}>
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{exception.exceptionType === "missing_invoice" ? "Missing invoice" : "R&D accounting review"}</p>
                  <p className="text-sm leading-5 text-muted-foreground">{exception.message}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Balanced draft journals</CardTitle>
          <CardDescription>Recognition flows into the next-period reversal with exact source lineage.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
          {[prepaid, accrual, reversal].map((entry, index) => (
            <div className="contents" key={entry.id}>
              <div className="rounded-md bg-muted p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{entry.entryType.replaceAll("_", " ")}</p>
                  <CheckCircle2 aria-label="Balanced" className="size-4 text-muted-foreground" />
                </div>
                <p className="font-mono text-lg tabular-nums">
                  {formatUsdMicros(entry.lines.reduce((sum, line) => sum + line.debitMicros, 0n))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Effective {entry.effectiveDate} · draft</p>
              </div>
              {index < 2 ? <ArrowRight aria-hidden="true" className="mx-auto hidden size-4 text-muted-foreground lg:block" /> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <footer className="flex items-center gap-2 border-t pt-6 text-xs text-muted-foreground">
        <Scale aria-hidden="true" className="size-4" />
        All amounts are integer micros. No ERP posting or automated capitalization occurs.
      </footer>
    </main>
  );
}
