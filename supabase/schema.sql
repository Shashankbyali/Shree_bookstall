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

create index if not exists "PrintJob_status_createdAt_idx"
  on "PrintJob" ("status", "createdAt");
create index if not exists "PrintJob_phone_idx"
  on "PrintJob" ("phone");
create index if not exists "PrintJob_createdAt_idx"
  on "PrintJob" ("createdAt");
create index if not exists "PrintFile_jobId_createdAt_idx"
  on "PrintFile" ("jobId", "createdAt");

alter table "PrintJob" enable row level security;
alter table "PrintFile" enable row level security;

insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', false)
on conflict (id) do nothing;
