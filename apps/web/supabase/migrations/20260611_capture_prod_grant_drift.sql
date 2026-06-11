-- Capture prod GRANT drift (permission drift — NOT a security change).
--
-- Production carried table-level privileges on public tables granted to the
-- anon / authenticated / service_role roles that were never written as a
-- migration (applied outside the migration system). The schema guard
-- (`supabase db diff --linked`) flagged them as un-migrated drift on PR #1
-- (workflow run 27369146118, job "Prod schema is fully committed").
--
-- These grants are INERT: row level security is enabled on every one of these
-- tables, so RLS policies — not table-level grants — gate all access. This
-- migration only records the existing prod state so the live schema matches the
-- committed migrations; it grants no new access and is a no-op applied to prod.
-- Roles, tables, and privileges below are reproduced verbatim from the db-diff
-- output — nothing added, removed, or reordered.

grant delete on table "public"."accounts" to "anon";
grant insert on table "public"."accounts" to "anon";
grant select on table "public"."accounts" to "anon";
grant update on table "public"."accounts" to "anon";
grant delete on table "public"."ad_report_snapshots" to "anon";
grant insert on table "public"."ad_report_snapshots" to "anon";
grant select on table "public"."ad_report_snapshots" to "anon";
grant update on table "public"."ad_report_snapshots" to "anon";
grant update on table "public"."ad_report_snapshots" to "authenticated";
grant update on table "public"."ad_report_snapshots" to "service_role";
grant delete on table "public"."campaign_audit_log" to "anon";
grant insert on table "public"."campaign_audit_log" to "anon";
grant select on table "public"."campaign_audit_log" to "anon";
grant update on table "public"."campaign_audit_log" to "anon";
grant delete on table "public"."campaign_audit_log" to "authenticated";
grant update on table "public"."campaign_audit_log" to "authenticated";
grant delete on table "public"."campaigns" to "anon";
grant insert on table "public"."campaigns" to "anon";
grant select on table "public"."campaigns" to "anon";
grant update on table "public"."campaigns" to "anon";
grant delete on table "public"."conversations" to "anon";
grant insert on table "public"."conversations" to "anon";
grant select on table "public"."conversations" to "anon";
grant update on table "public"."conversations" to "anon";
grant delete on table "public"."messages" to "anon";
grant insert on table "public"."messages" to "anon";
grant select on table "public"."messages" to "anon";
grant update on table "public"."messages" to "anon";
grant delete on table "public"."show_analyses" to "anon";
grant insert on table "public"."show_analyses" to "anon";
grant select on table "public"."show_analyses" to "anon";
grant update on table "public"."show_analyses" to "anon";
grant delete on table "public"."show_ticket_tiers" to "anon";
grant insert on table "public"."show_ticket_tiers" to "anon";
grant select on table "public"."show_ticket_tiers" to "anon";
grant update on table "public"."show_ticket_tiers" to "anon";
grant delete on table "public"."tenant_data_records" to "anon";
grant insert on table "public"."tenant_data_records" to "anon";
grant select on table "public"."tenant_data_records" to "anon";
grant update on table "public"."tenant_data_records" to "anon";
grant delete on table "public"."tenant_members" to "anon";
grant insert on table "public"."tenant_members" to "anon";
grant select on table "public"."tenant_members" to "anon";
grant update on table "public"."tenant_members" to "anon";
grant delete on table "public"."tenant_members" to "authenticated";
grant insert on table "public"."tenant_members" to "authenticated";
grant update on table "public"."tenant_members" to "authenticated";
grant delete on table "public"."tenants" to "anon";
grant insert on table "public"."tenants" to "anon";
grant select on table "public"."tenants" to "anon";
grant update on table "public"."tenants" to "anon";
grant delete on table "public"."ticket_tailor_connections" to "authenticated";
grant insert on table "public"."ticket_tailor_connections" to "authenticated";
grant update on table "public"."ticket_tailor_connections" to "authenticated";
grant delete on table "public"."ticket_tailor_events" to "authenticated";
grant insert on table "public"."ticket_tailor_events" to "authenticated";
grant update on table "public"."ticket_tailor_events" to "authenticated";
grant delete on table "public"."ticket_tailor_orders" to "authenticated";
grant insert on table "public"."ticket_tailor_orders" to "authenticated";
grant update on table "public"."ticket_tailor_orders" to "authenticated";
grant delete on table "public"."usage_events" to "anon";
grant insert on table "public"."usage_events" to "anon";
grant select on table "public"."usage_events" to "anon";
grant update on table "public"."usage_events" to "anon";
grant delete on table "public"."usage_events" to "authenticated";
grant update on table "public"."usage_events" to "authenticated";
