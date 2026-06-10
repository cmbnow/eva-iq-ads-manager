/*
 * A5: F&B basis as tenant config.
 * Replaces the hardcoded planning default with per-tenant sourced figures.
 *
 *   fb_avg_check_per_head : GROSS average F&B spend per attendee (dollars),
 *                           measured from real POS sales (Toast). NOT ticket price.
 *   fb_margin_rate        : blended gross F&B margin (0..1) applied to the check.
 *
 * Planning F&B contribution per head = fb_avg_check_per_head * fb_margin_rate.
 * Both NULL by default ON PURPOSE: no tenant gets a fabricated number. A tenant
 * with either column NULL has F&B EXCLUDED from planning math until set.
 */
alter table public.tenants
    add column if not exists fb_avg_check_per_head numeric(10, 2),
    add column if not exists fb_margin_rate        numeric(5, 4);

alter table public.tenants
    add constraint tenants_fb_avg_check_nonneg
        check (fb_avg_check_per_head is null or fb_avg_check_per_head >= 0),
    add constraint tenants_fb_margin_rate_unit
        check (fb_margin_rate is null or (fb_margin_rate >= 0 and fb_margin_rate <= 1));

comment on column public.tenants.fb_avg_check_per_head is
    'GROSS avg F&B spend per attendee in dollars, sourced from POS (Toast). NOT ticket price. NULL = F&B excluded from planning.';
comment on column public.tenants.fb_margin_rate is
    'Blended gross F&B margin 0..1 applied to fb_avg_check_per_head. NULL = F&B excluded from planning.';
