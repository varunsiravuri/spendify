create extension if not exists pgcrypto;

create type provider_type as enum ('ai', 'cloud');
create type usage_purpose as enum ('customer_facing', 'internal');
create type close_status as enum ('draft', 'in_review', 'approved', 'posted');
create type exception_type as enum ('missing_invoice', 'rd_human_review');
create type exception_severity as enum ('info', 'warning', 'error');
create type exception_status as enum ('open', 'resolved');
create type journal_entry_type as enum ('prepaid_usage', 'missing_invoice_accrual', 'accrual_reversal');
create type journal_status as enum ('draft', 'approved', 'posted');
create type approval_status as enum ('pending', 'approved', 'rejected');
create type actor_type as enum ('system', 'human');

create table providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_type provider_type not null,
  created_at timestamptz not null default now()
);

create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  sku text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_price_micros bigint not null check (unit_price_micros >= 0),
  pricing_unit bigint not null check (pricing_unit > 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  check (effective_to is null or effective_to > effective_from),
  unique (provider_id, sku, effective_from)
);

create table cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  department text not null,
  is_research_and_development boolean not null default false
);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  source_event_id text not null,
  rate_card_id uuid not null references rate_cards(id),
  occurred_at timestamptz not null,
  quantity bigint not null check (quantity > 0),
  cost_center_id uuid not null references cost_centers(id),
  usage_purpose usage_purpose not null,
  customer_reference text,
  ingested_at timestamptz not null default now(),
  check (
    (usage_purpose = 'customer_facing' and customer_reference is not null)
    or (usage_purpose = 'internal' and customer_reference is null)
  ),
  unique (provider_id, source_event_id)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  source_invoice_id text not null,
  period_start date not null,
  period_end date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_micros bigint not null check (total_micros >= 0),
  received_at timestamptz not null,
  check (period_end >= period_start),
  unique (provider_id, source_invoice_id)
);

create table prepaid_credit_lots (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  original_micros bigint not null check (original_micros >= 0),
  remaining_micros bigint not null check (remaining_micros >= 0),
  purchased_at timestamptz not null,
  expires_at timestamptz,
  check (remaining_micros <= original_micros),
  check (expires_at is null or expires_at > purchased_at)
);

create table close_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status close_status not null default 'draft',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (period_end >= period_start),
  check (completed_at is null or completed_at >= started_at),
  unique (period_start, period_end)
);

create table exceptions (
  id uuid primary key default gen_random_uuid(),
  close_run_id uuid not null references close_runs(id),
  exception_type exception_type not null,
  severity exception_severity not null,
  status exception_status not null default 'open',
  message text not null,
  requires_human_review boolean not null,
  created_at timestamptz not null default now()
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  close_run_id uuid not null references close_runs(id),
  entry_type journal_entry_type not null,
  status journal_status not null default 'draft',
  effective_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  memo text not null,
  reverses_journal_entry_id uuid unique references journal_entries(id),
  created_at timestamptz not null default now()
);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  account_code text not null,
  description text not null,
  debit_micros bigint not null default 0 check (debit_micros >= 0),
  credit_micros bigint not null default 0 check (credit_micros >= 0),
  cost_center_id uuid references cost_centers(id),
  check (
    (debit_micros > 0 and credit_micros = 0)
    or (credit_micros > 0 and debit_micros = 0)
  ),
  unique (journal_entry_id, line_number)
);

create table journal_line_sources (
  journal_line_id uuid not null references journal_lines(id) on delete restrict,
  usage_event_id uuid not null references usage_events(id) on delete restrict,
  attributed_micros bigint not null check (attributed_micros > 0),
  primary key (journal_line_id, usage_event_id)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  close_run_id uuid not null references close_runs(id),
  journal_entry_id uuid references journal_entries(id),
  status approval_status not null default 'pending',
  reviewer_reference text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null and reviewer_reference is not null)
  )
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  actor_type actor_type not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  previous_event_hash text,
  event_hash text not null unique
);

create function reject_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_no_update
before update on audit_events
for each row execute function reject_audit_event_mutation();

create trigger audit_events_no_delete
before delete on audit_events
for each row execute function reject_audit_event_mutation();

create trigger audit_events_no_truncate
before truncate on audit_events
for each statement execute function reject_audit_event_mutation();

create function assert_journal_entry_balanced()
returns trigger
language plpgsql
as $$
declare
  target_entry_id uuid;
  line_count bigint;
  debit_total numeric;
  credit_total numeric;
begin
  if tg_table_name = 'journal_entries' then
    target_entry_id := new.id;
  else
    if tg_op = 'UPDATE' and new.journal_entry_id <> old.journal_entry_id then
      raise exception 'journal lines cannot move between entries';
    end if;
    target_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  end if;

  select count(*), coalesce(sum(debit_micros), 0), coalesce(sum(credit_micros), 0)
    into line_count, debit_total, credit_total
    from public.journal_lines
    where journal_entry_id = target_entry_id;

  if line_count < 2 then
    raise exception 'journal entry % must contain at least two lines', target_entry_id;
  end if;

  if debit_total <> credit_total then
    raise exception 'journal entry % is unbalanced: debits %, credits %',
      target_entry_id, debit_total, credit_total;
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_must_balance
after insert or update or delete on journal_lines
deferrable initially deferred
for each row execute function assert_journal_entry_balanced();

create constraint trigger journal_entries_must_have_balanced_lines
after insert or update on journal_entries
deferrable initially deferred
for each row execute function assert_journal_entry_balanced();

alter table providers enable row level security;
alter table rate_cards enable row level security;
alter table cost_centers enable row level security;
alter table usage_events enable row level security;
alter table invoices enable row level security;
alter table prepaid_credit_lots enable row level security;
alter table close_runs enable row level security;
alter table exceptions enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table journal_line_sources enable row level security;
alter table approvals enable row level security;
alter table audit_events enable row level security;

comment on column rate_cards.unit_price_micros is 'Integer currency micros per pricing_unit; application rating uses deterministic round-half-up.';
comment on table journal_line_sources is 'Normalized source-to-journal lineage with the amount attributed to each usage event.';
comment on table audit_events is 'Append-only audit log; updates, deletes, and truncation are rejected by triggers.';
