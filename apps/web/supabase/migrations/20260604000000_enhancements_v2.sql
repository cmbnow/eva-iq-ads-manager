/*
 * ===========================================================================
 * EVA IQ Enhancement v2 — conversations, messages, usage, campaigns, audit
 * All tenant-scoped with RLS via public.has_tenant_access(tenant_id).
 * ===========================================================================
 */

-- Conversations (persistent chat per client)
create table if not exists public.conversations
(
    id         uuid primary key default gen_random_uuid(),
    tenant_id  uuid not null references public.tenants (id) on delete cascade,
    user_id    uuid references auth.users (id) on delete set null,
    title      varchar(255) not null default 'New conversation',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index conversations_tenant_idx on public.conversations (tenant_id, updated_at desc);

-- Messages (user + assistant turns)
create table if not exists public.messages
(
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    tenant_id       uuid not null references public.tenants (id) on delete cascade,
    role            varchar(20) not null,            -- user | assistant | system
    content         text not null default '',
    image_refs      text[] not null default '{}',    -- storage paths
    tokens_in       integer not null default 0,
    tokens_out      integer not null default 0,
    model           varchar(100),
    created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- AI usage tracking (track only, no cap)
create table if not exists public.usage_events
(
    id         uuid primary key default gen_random_uuid(),
    tenant_id  uuid not null references public.tenants (id) on delete cascade,
    user_id    uuid references auth.users (id) on delete set null,
    feature    varchar(100) not null,               -- advisor_plan | advisor_chat | image | composer ...
    model      varchar(100),
    tokens_in  integer not null default 0,
    tokens_out integer not null default 0,
    created_at timestamptz not null default now()
);
create index usage_events_tenant_idx on public.usage_events (tenant_id, created_at desc);

-- Campaigns (ad-creation module structure; advisor-mode until Meta access)
create table if not exists public.campaigns
(
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants (id) on delete cascade,
    platform            public.ad_platform not null default 'meta',
    name                varchar(255) not null,
    objective           varchar(100),
    status              varchar(40) not null default 'draft', -- draft|pending_approval|approved|published|paused|archived
    copy                jsonb not null default '{}'::jsonb,    -- primary_text, headlines[], descriptions[], cta
    audience            jsonb not null default '{}'::jsonb,
    creative_brief      text,
    build_steps         jsonb not null default '[]'::jsonb,
    budget_daily        numeric,
    spend_cap           numeric,
    special_ad_category public.special_ad_category not null default 'none',
    external_id         varchar(255),                          -- Meta id once published
    created_by          uuid references auth.users (id) on delete set null,
    approved_by         uuid references auth.users (id) on delete set null,
    approved_at         timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index campaigns_tenant_idx on public.campaigns (tenant_id, created_at desc);

-- Append-only audit log for spend/publish actions
create table if not exists public.campaign_audit_log
(
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants (id) on delete cascade,
    campaign_id uuid references public.campaigns (id) on delete cascade,
    user_id     uuid references auth.users (id) on delete set null,
    action      varchar(100) not null,
    detail      jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
create index campaign_audit_tenant_idx on public.campaign_audit_log (tenant_id, created_at desc);

-- Link a saved CSV analysis to a chat conversation (optional)
alter table public.ad_report_snapshots
    add column if not exists conversation_id uuid references public.conversations (id) on delete set null;

-- updated_at triggers
create trigger set_conversations_updated_at before update on public.conversations
    for each row execute function kit.set_updated_at();
create trigger set_campaigns_updated_at before update on public.campaigns
    for each row execute function kit.set_updated_at();

/* ---------------------------------------------------------------------------
 * Row Level Security
 * ------------------------------------------------------------------------- */
alter table public.conversations enable row level security;
create policy conv_all on public.conversations for all to authenticated
    using (public.has_tenant_access(tenant_id)) with check (public.has_tenant_access(tenant_id));
grant select, insert, update, delete on public.conversations to authenticated, service_role;

alter table public.messages enable row level security;
create policy msg_all on public.messages for all to authenticated
    using (public.has_tenant_access(tenant_id)) with check (public.has_tenant_access(tenant_id));
grant select, insert, update, delete on public.messages to authenticated, service_role;

alter table public.usage_events enable row level security;
create policy usage_read on public.usage_events for select to authenticated
    using (public.has_tenant_access(tenant_id));
create policy usage_insert on public.usage_events for insert to authenticated
    with check (public.has_tenant_access(tenant_id));
grant select, insert on public.usage_events to authenticated;
grant select, insert, update, delete on public.usage_events to service_role;

alter table public.campaigns enable row level security;
create policy camp_all on public.campaigns for all to authenticated
    using (public.has_tenant_access(tenant_id)) with check (public.has_tenant_access(tenant_id));
grant select, insert, update, delete on public.campaigns to authenticated, service_role;

alter table public.campaign_audit_log enable row level security;
create policy audit_read on public.campaign_audit_log for select to authenticated
    using (public.has_tenant_access(tenant_id));
create policy audit_insert on public.campaign_audit_log for insert to authenticated
    with check (public.has_tenant_access(tenant_id));
grant select, insert on public.campaign_audit_log to authenticated;
grant select, insert, update, delete on public.campaign_audit_log to service_role;

/* ---------------------------------------------------------------------------
 * Storage bucket for screenshots (private, tenant-path scoped)
 * Path convention: <tenant_id>/<filename>
 * ------------------------------------------------------------------------- */
insert into storage.buckets (id, name, public)
values ('advisor-images', 'advisor-images', false)
on conflict (id) do nothing;

create policy advisor_images_rw on storage.objects for all to authenticated
    using (
        bucket_id = 'advisor-images'
        and public.has_tenant_access(((storage.foldername(name))[1])::uuid)
    )
    with check (
        bucket_id = 'advisor-images'
        and public.has_tenant_access(((storage.foldername(name))[1])::uuid)
    );
