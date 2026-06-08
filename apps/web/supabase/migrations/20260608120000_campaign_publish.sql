/*
 * Meta publishing — campaign columns for the publish flow.
 * audience already exists (enhancements_v2); add column if not exists is a no-op.
 * profitability_run_id was assumed by the approval gate but never added — it is
 * the link the publish gate requires (approved + linked run + MRMC-gated budget).
 */
alter table public.campaigns
    add column if not exists published_meta     jsonb,
    add column if not exists audience           jsonb default '{}'::jsonb,
    add column if not exists creative_image_ref text,
    add column if not exists ticket_link        text,
    add column if not exists page_id            varchar(255),
    add column if not exists profitability_run_id uuid references public.show_analyses (id) on delete set null;
