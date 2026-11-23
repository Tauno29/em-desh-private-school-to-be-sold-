-- Em-Desh Private School Supabase schema
-- Run this once in Supabase Dashboard > SQL Editor before deploying the server.
-- The application uses the server-side service-role key; never expose that key in browser code.

create table if not exists public.learners (
  id uuid primary key default gen_random_uuid(),
  student_id varchar(32) not null unique,
  first_name varchar(80) not null,
  last_name varchar(80) not null,
  grade varchar(8) not null,
  class_name varchar(80) not null default '',
  guardian_name varchar(120) not null,
  guardian_phone varchar(40) not null default '',
  status varchar(16) not null default 'active',
  pin_hash text not null,
  created_at varchar(40) not null,
  updated_at varchar(40) not null
);
create index if not exists learners_created_idx on public.learners (created_at);
create index if not exists learners_status_idx on public.learners (status);

create table if not exists public.sessions (
  token_hash varchar(128) primary key,
  role varchar(16) not null,
  learner_id uuid null,
  expires_at varchar(40) not null,
  created_at varchar(40) not null
);
create index if not exists sessions_learner_idx on public.sessions (learner_id);
create index if not exists sessions_expiry_idx on public.sessions (expires_at);

create table if not exists public.login_throttle (
  throttle_key varchar(255) primary key,
  failed_attempts integer not null,
  locked_until varchar(40) not null,
  updated_at varchar(40) not null
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  first_name varchar(80) not null,
  last_name varchar(80) not null,
  grade varchar(8) not null,
  father_name varchar(120) not null default '',
  father_phone varchar(40) not null default '',
  father_occupation varchar(120) not null default '',
  mother_name varchar(120) not null default '',
  mother_phone varchar(40) not null default '',
  mother_occupation varchar(120) not null default '',
  guardian_name varchar(120) not null,
  guardian_email varchar(160) not null default '',
  guardian_phone varchar(40) not null default '',
  message text not null,
  status varchar(16) not null default 'new',
  created_at varchar(40) not null,
  updated_at varchar(40) not null
);
create index if not exists applications_created_idx on public.applications (created_at);
create index if not exists applications_status_idx on public.applications (status);

create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  caption varchar(120) not null default '',
  object_path varchar(255) not null unique,
  content_type varchar(80) not null,
  size_bytes integer not null,
  status varchar(16) not null default 'pending',
  created_at varchar(40) not null
);
create index if not exists gallery_created_idx on public.gallery_images (created_at);
create index if not exists gallery_status_idx on public.gallery_images (status);

create table if not exists public.behavior_records (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null,
  note varchar(500) not null,
  recorded_on varchar(40) not null,
  created_at varchar(40) not null
);
create index if not exists behavior_learner_idx on public.behavior_records (learner_id);
create index if not exists behavior_recorded_idx on public.behavior_records (recorded_on);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null,
  subject varchar(60) not null,
  score integer not null,
  term varchar(40) not null default '',
  recorded_on varchar(40) not null,
  created_at varchar(40) not null
);
create index if not exists tests_learner_idx on public.test_results (learner_id);
create index if not exists tests_recorded_idx on public.test_results (recorded_on);

create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null,
  object_path varchar(255) not null unique,
  file_name varchar(255) not null,
  content_type varchar(80) not null,
  size_bytes integer not null,
  term varchar(40) not null default '',
  status varchar(16) not null default 'pending',
  created_at varchar(40) not null
);
create index if not exists reports_learner_idx on public.report_cards (learner_id);
create index if not exists reports_created_idx on public.report_cards (created_at);

-- Keep the bucket private. The server creates signed upload/view URLs.
insert into storage.buckets (id, name, public)
values ('school-files', 'school-files', false)
on conflict (id) do update set public = false;

-- These policies do not grant anonymous access. Server-side service-role operations bypass RLS.
alter table public.learners enable row level security;
alter table public.sessions enable row level security;
alter table public.login_throttle enable row level security;
alter table public.applications enable row level security;
alter table public.gallery_images enable row level security;
alter table public.behavior_records enable row level security;
alter table public.test_results enable row level security;
alter table public.report_cards enable row level security;
