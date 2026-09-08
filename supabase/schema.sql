-- Shree BookStall — run this once in the Supabase SQL Editor.
-- Safe to re-run: every statement is idempotent.

create table if not exists "PrintJob" (
  "id" text primary key,
  "name" text not null,
  "phone" text not null,
  "notes" text,
  "status" text not null default 'pending',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists "PrintFile" (
  "id" text primary key,
  "jobId" text not null references "PrintJob" ("id") on delete cascade,
  "originalName" text not null,
  "storedName" text not null,
  "mimeType" text not null,
  "size" integer not null,
  "enhanced" boolean not null default false,
  "createdAt" timestamptz not null default now()
);

-- The auto crop + brighten step used to overwrite the customer's upload and
-- delete the original, so a bad crop destroyed the document with no way back.
-- These columns keep the untouched upload alongside the edited version.
alter table "PrintFile" add column if not exists "sourceStoredName" text;
alter table "PrintFile" add column if not exists "sourceMimeType" text;
alter table "PrintFile" add column if not exists "sourceSize" integer;
alter table "PrintFile" add column if not exists "sourceName" text;
-- Crop rect + brightness/contrast last applied, so the editor can reopen with
-- the owner's settings instead of resetting to defaults.
alter table "PrintFile" add column if not exists "enhanceSettings" jsonb;

create index if not exists "PrintJob_status_createdAt_idx"
  on "PrintJob" ("status", "createdAt");
create index if not exists "PrintJob_phone_idx"
  on "PrintJob" ("phone");
create index if not exists "PrintJob_createdAt_idx"
  on "PrintJob" ("createdAt");
create index if not exists "PrintFile_jobId_createdAt_idx"
  on "PrintFile" ("jobId", "createdAt");

-- Only the service role key (server side) touches these tables. RLS is on with
-- no policies, so the anon key cannot read customer names or phone numbers even
-- if it leaks.
alter table "PrintJob" enable row level security;
alter table "PrintFile" enable row level security;

-- Private bucket: files are only reachable through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', false)
on conflict (id) do nothing;
