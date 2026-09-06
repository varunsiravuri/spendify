begin;

insert into providers (id, name, provider_type, created_at) values
  ('10000000-0000-4000-8000-000000000001', 'Northstar AI', 'ai', '2026-08-01T00:00:00Z');

insert into rate_cards (
  id, provider_id, sku, currency, unit_price_micros, pricing_unit, effective_from
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'inference-token', 'USD', 2000000, 1000000, '2026-08-01T00:00:00Z'
);

insert into cost_centers (id, code, name, department, is_research_and_development) values
  ('30000000-0000-4000-8000-000000000001', 'CUSTOMER', 'Customer workloads', 'Cost of Revenue', false),
  ('30000000-0000-4000-8000-000000000002', 'RND-PLATFORM', 'AI Platform', 'Research & Development', true);

insert into usage_events (
  id, provider_id, source_event_id, rate_card_id, occurred_at, quantity,
  cost_center_id, usage_purpose, customer_reference, ingested_at
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', 'northstar:usage:customer:2026-08',
    '20000000-0000-4000-8000-000000000001', '2026-08-31T22:00:00Z', 4000000000,
    '30000000-0000-4000-8000-000000000001', 'customer_facing', 'customer-portfolio',
    '2026-09-01T00:05:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001', 'northstar:usage:internal:2026-08',
    '20000000-0000-4000-8000-000000000001', '2026-08-31T23:00:00Z', 2000000000,
    '30000000-0000-4000-8000-000000000002', 'internal', null,
    '2026-09-01T00:05:00Z'
  );

insert into prepaid_credit_lots (
  id, provider_id, currency, original_micros, remaining_micros, purchased_at, expires_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'USD', 10000000000, 0,
  '2026-08-01T00:00:00Z', null
);

insert into close_runs (id, period_start, period_end, status, started_at, completed_at) values (
  '60000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-31',
  'in_review', '2026-09-01T00:10:00Z', '2026-09-01T00:10:01Z'
);

insert into exceptions (
  id, close_run_id, exception_type, severity, status, message, requires_human_review, created_at
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', 'missing_invoice', 'warning', 'open',
    'Northstar AI invoice is missing; 2000000000 micros accrued.', true, '2026-09-01T00:10:01Z'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001', 'rd_human_review', 'info', 'open',
    'R&D usage remains departmental OpEx. Any capitalization requires human review.', true,
    '2026-09-01T00:10:01Z'
  );

insert into journal_entries (
  id, close_run_id, entry_type, status, effective_date, currency, memo,
  reverses_journal_entry_id, created_at
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', 'prepaid_usage', 'draft', '2026-08-31', 'USD',
    'Recognize usage funded by prepaid credits', null, '2026-09-01T00:10:01Z'
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001', 'missing_invoice_accrual', 'draft', '2026-08-31', 'USD',
    'Accrue rated usage not covered by prepaid credits; provider invoice missing', null,
    '2026-09-01T00:10:01Z'
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000001', 'accrual_reversal', 'draft', '2026-09-01', 'USD',
    'Automatic reversal of 80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002', '2026-09-01T00:10:01Z'
  );

insert into journal_lines (
  id, journal_entry_id, line_number, account_code, description,
  debit_micros, credit_micros, cost_center_id
) values
  ('81000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 1, '6100', 'Customer-facing AI usage', 8000000000, 0, '30000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 2, '7200', 'Internal AI usage funded by credits', 2000000000, 0, '30000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000001', 3, '1410', 'Prepaid AI credits consumed', 0, 10000000000, null),
  ('82000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', 1, '7200', 'Unbilled departmental AI expense', 2000000000, 0, '30000000-0000-4000-8000-000000000002'),
  ('82000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', 2, '2110', 'Accrued provider payable', 0, 2000000000, null),
  ('83000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003', 1, '7200', 'Reverse unbilled departmental AI expense', 0, 2000000000, '30000000-0000-4000-8000-000000000002'),
  ('83000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000003', 2, '2110', 'Reverse accrued provider payable', 2000000000, 0, null);

insert into journal_line_sources (journal_line_id, usage_event_id, attributed_micros) values
  ('81000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 8000000000),
  ('81000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 2000000000),
  ('81000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 8000000000),
  ('81000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', 2000000000),
  ('82000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 2000000000),
  ('82000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 2000000000),
  ('83000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 2000000000),
  ('83000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 2000000000);

insert into approvals (
  id, close_run_id, journal_entry_id, status, reviewer_reference, decided_at, created_at
) values (
  '90000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', null, 'pending', null, null,
  '2026-09-01T00:10:01Z'
);

insert into audit_events (
  id, aggregate_type, aggregate_id, event_type, actor_type, occurred_at, payload,
  previous_event_hash, event_hash
) values (
  'a0000000-0000-4000-8000-000000000001', 'close_run',
  '60000000-0000-4000-8000-000000000001', 'close_run.calculated', 'system',
  '2026-09-01T00:10:01Z',
  '{"usage_micros":"12000000000","prepaid_micros":"10000000000","accrual_micros":"2000000000","invoice_received":false}'::jsonb,
  null, encode(digest('spendify-demo-close-v1', 'sha256'), 'hex')
);

commit;
