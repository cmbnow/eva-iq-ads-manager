'use client';

import { useEffect, useState } from 'react';

import { Calculator, FileUp, Save } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import {
  type SavedShow,
  getWalkupForShow,
  listAnalyses,
  parseOfferSheet,
  saveAnalysis,
} from '../_lib/offer-actions';
import {
  type AnalysisResult,
  type BonusMode,
  type BonusTier,
  type GigExpense,
  type OfferStructure,
  type ShowInputs,
  type TicketTier,
  analyzeShow,
  blendTicketPricing,
} from '../_lib/offer-engine';
import { type WalkupResult } from '../_lib/walkup-projection';

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

// Fees are sub-dollar — show full cents (e.g. -$1.03), never rounded to whole $.
const cents = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function daysFromToday(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return String(Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000)));
}

type FormState = {
  show_name: string;
  show_date: string;
  venue_capacity: string;
  avg_ticket_price: string;
  offer_structure: OfferStructure;
  guarantee: string;
  backend_promoter_share: string;
  opening_cost: string;
  conservative_attendance: string;
  target_attendance: string;
  sellout_attendance: string;
  baseline_attendance: string;
  days_remaining: string;
  historical_cpa: string;
};

const DEFAULTS: FormState = {
  show_name: '',
  show_date: '',
  venue_capacity: '1000',
  avg_ticket_price: '25',
  offer_structure: 'straight_guarantee',
  guarantee: '5000',
  backend_promoter_share: '0.8',
  opening_cost: '',
  conservative_attendance: '400',
  target_attendance: '700',
  sellout_attendance: '1000',
  baseline_attendance: '',
  days_remaining: '45',
  historical_cpa: '',
};

export function OfferEngineClient({
  fbAvgCheckPerHead,
  fbMarginRate,
}: {
  // A5: per-tenant F&B basis (from server props). null = not configured.
  fbAvgCheckPerHead: number | null;
  fbMarginRate: number | null;
}) {
  const [f, setF] = useState<FormState>(DEFAULTS);
  // Derived F&B contribution/head = gross avg check × margin rate. Undefined when
  // the tenant hasn't set its basis -> engine excludes F&B and flags it.
  const fbContribution =
    fbAvgCheckPerHead != null && fbMarginRate != null
      ? fbAvgCheckPerHead * fbMarginRate
      : undefined;
  const [tiers, setTiers] = useState<BonusTier[]>([
    { at_tickets: 500, bonus: 500 },
  ]);
  const [bonusMode, setBonusMode] = useState<BonusMode>('incremental');
  const [gigExpenses, setGigExpenses] = useState<GigExpense[]>([
    { label: '', planned: 0 },
  ]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [walkup, setWalkup] = useState<WalkupResult | null>(null);
  const [saved, setSaved] = useState<SavedShow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketTier[]>([
    {
      name: 'General Admission',
      face_price: 25,
      fee: 0,
      fee_recipient: 'venue',
      capacity: 1000,
    },
  ]);
  const [globals, setGlobals] = useState({
    processor_pct: '0.029',
    processor_flat: '0.30',
    basket: '1',
  });

  // Live: blended FACE price (feeds artist deal) + venue-kept fee/head (adds to TMAV).
  const blended = blendTicketPricing(tickets, {
    processor_pct:
      globals.processor_pct === '' ? undefined : Number(globals.processor_pct),
    processor_flat:
      globals.processor_flat === ''
        ? undefined
        : Number(globals.processor_flat),
    avg_tickets_per_order:
      globals.basket === '' ? undefined : Number(globals.basket),
  });

  useEffect(() => {
    listAnalyses()
      .then(setSaved)
      .catch(() => {});
  }, []);

  function set<K extends keyof FormState>(k: K, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  function pricingGlobals() {
    return {
      processor_pct:
        globals.processor_pct === ''
          ? undefined
          : Number(globals.processor_pct),
      processor_flat:
        globals.processor_flat === ''
          ? undefined
          : Number(globals.processor_flat),
      avg_tickets_per_order:
        globals.basket === '' ? undefined : Number(globals.basket),
    };
  }

  function buildInputs(): ShowInputs {
    const num = (s: string, d?: number) => (s === '' ? d : Number(s));
    return {
      venue_capacity: Number(f.venue_capacity),
      avg_ticket_price: blended.avg_ticket_price, // FACE only (from ticket tiers)
      net_fee_per_head: blended.net_fee_per_head, // venue-kept fee -> TMAV
      // Persist the FULL tier structure + globals so a reloaded show reproduces
      // the exact blend (not a collapsed single GA tier).
      ticket_tiers: tickets,
      ticket_pricing_globals: pricingGlobals(),
      offer_structure: f.offer_structure,
      guarantee: num(f.guarantee, 0),
      backend_promoter_share: num(f.backend_promoter_share),
      // A3: itemized gig expenses derive the gig fixed cost; keep
      // fixed_show_expenses populated (their sum) for the legacy field + reload.
      gig_expenses: gigExpenses.filter(
        (e) => e.label.trim() !== '' || e.planned || e.actual != null,
      ),
      fixed_show_expenses: gigExpenses.reduce(
        (s, e) => s + (e.actual ?? e.planned ?? 0),
        0,
      ),
      opening_cost: num(f.opening_cost, 0),
      bonus_tiers: f.offer_structure === 'bonus_escalator' ? tiers : undefined,
      bonus_mode:
        f.offer_structure === 'bonus_escalator' ? bonusMode : undefined,
      conservative_attendance: Number(f.conservative_attendance),
      target_attendance: Number(f.target_attendance),
      sellout_attendance: Number(f.sellout_attendance),
      baseline_attendance: num(f.baseline_attendance),
      days_remaining: Number(f.days_remaining),
      // A5: from tenant config (check × rate); undefined => F&B excluded + flagged.
      f_and_b_contribution_per_head: fbContribution,
      historical_cpa: num(f.historical_cpa),
    };
  }

  function run() {
    setMsg(null);
    const inputs = buildInputs();
    setResult(analyzeShow(inputs));
    // B1: live walk-up projection from this tenant's Ticket Tailor sales,
    // matched to a TT event by the show date. Null when there's no match.
    setWalkup(null);
    getWalkupForShow({
      showDate: f.show_date || null,
      target_attendance: inputs.target_attendance,
      sellout_attendance: inputs.sellout_attendance,
    })
      .then(setWalkup)
      .catch(() => setWalkup(null));
  }

  async function onSave() {
    if (!result) return;
    const res = await saveAnalysis({
      showName: f.show_name || 'Untitled show',
      showDate: f.show_date || null,
      inputs: buildInputs(),
      result,
    });
    if ('id' in res) {
      setMsg('Saved.');
      listAnalyses()
        .then(setSaved)
        .catch(() => {});
    } else setMsg(res.error);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setMsg('Reading offer sheet…');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
      const data = btoa(bin);
      const res = await parseOfferSheet({
        data,
        mediaType: file.type || 'application/pdf',
      });
      if (res.ok) {
        const x = res.fields;
        setF((p) => ({
          ...p,
          show_name: x.show_name ?? p.show_name,
          show_date: x.show_date ?? p.show_date,
          days_remaining: x.show_date
            ? daysFromToday(x.show_date) || p.days_remaining
            : p.days_remaining,
          venue_capacity: x.venue_capacity?.toString() ?? p.venue_capacity,
          avg_ticket_price:
            x.avg_ticket_price?.toString() ?? p.avg_ticket_price,
          offer_structure:
            (x.offer_structure as OfferStructure) ?? p.offer_structure,
          guarantee: x.guarantee?.toString() ?? p.guarantee,
          backend_promoter_share:
            x.backend_promoter_share?.toString() ?? p.backend_promoter_share,
          conservative_attendance:
            x.conservative_attendance?.toString() ?? p.conservative_attendance,
          target_attendance:
            x.target_attendance?.toString() ?? p.target_attendance,
          sellout_attendance:
            x.sellout_attendance?.toString() ?? p.sellout_attendance,
        }));
        if (x.bonus_tiers?.length)
          setTiers(
            x.bonus_tiers.map((t) => ({
              at_tickets: t.at_tickets ?? t.from_attendance ?? 0,
              bonus: t.bonus ?? t.bonus_paid ?? 0,
            })),
          );
        if (x.fixed_show_expenses != null)
          setGigExpenses([
            {
              label: 'Fixed expenses',
              planned: Number(x.fixed_show_expenses),
            },
          ]);
        if (x.avg_ticket_price != null) {
          setTickets((p) => {
            const first = p[0] ?? {
              name: 'General Admission',
              fee: 0,
              fee_recipient: 'venue' as const,
              capacity: 1000,
            };
            return [
              { ...first, face_price: Number(x.avg_ticket_price) },
              ...p.slice(1),
            ];
          });
        }
        setMsg(
          'Prefilled from the sheet — confirm every field (incl. ticket face/fee per tier), then Run analysis.',
        );
      } else setMsg(res.error);
    } catch {
      setMsg('Could not read that file.');
    }
    setParsing(false);
  }

  function loadSaved(s: SavedShow) {
    const i = s.inputs;
    setF({
      show_name: s.showName,
      show_date: s.showDate ?? '',
      venue_capacity: String(i.venue_capacity ?? ''),
      avg_ticket_price: String(i.avg_ticket_price ?? ''),
      offer_structure: i.offer_structure,
      guarantee: String(i.guarantee ?? ''),
      backend_promoter_share: String(i.backend_promoter_share ?? ''),
      opening_cost: i.opening_cost != null ? String(i.opening_cost) : '',
      conservative_attendance: String(i.conservative_attendance ?? ''),
      target_attendance: String(i.target_attendance ?? ''),
      sellout_attendance: String(i.sellout_attendance ?? ''),
      baseline_attendance:
        i.baseline_attendance != null ? String(i.baseline_attendance) : '',
      days_remaining: String(i.days_remaining ?? ''),
      historical_cpa: i.historical_cpa != null ? String(i.historical_cpa) : '',
    });
    if (i.bonus_tiers)
      setTiers(
        i.bonus_tiers.map((t) => ({
          at_tickets: t.at_tickets ?? t.from_attendance ?? 0,
          bonus: t.bonus ?? t.bonus_paid ?? 0,
        })),
      );
    if (i.bonus_mode) setBonusMode(i.bonus_mode);
    if (i.gig_expenses?.length) setGigExpenses(i.gig_expenses);
    // Rebuild the tier UI from the persisted tiers (source of truth). Fall back to
    // a single GA tier only for OLD saves made before tiers were persisted.
    if (i.ticket_tiers && i.ticket_tiers.length) {
      setTickets(i.ticket_tiers);
    } else {
      setTickets([
        {
          name: 'General Admission',
          face_price: i.avg_ticket_price ?? 0,
          fee: 0,
          fee_recipient: 'venue',
          capacity: i.venue_capacity ?? 0,
        },
      ]);
    }
    if (i.ticket_pricing_globals) {
      const g = i.ticket_pricing_globals;
      setGlobals({
        processor_pct: g.processor_pct != null ? String(g.processor_pct) : '',
        processor_flat:
          g.processor_flat != null ? String(g.processor_flat) : '',
        basket:
          g.avg_tickets_per_order != null
            ? String(g.avg_tickets_per_order)
            : '',
      });
    }
    setResult(s.result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className={'space-y-6'}>
      {/* Inputs */}
      <Card>
        <CardHeader>
          <div className={'flex flex-wrap items-center justify-between gap-2'}>
            <CardTitle className={'text-base'}>Show offer</CardTitle>
            <label
              className={
                'border-input hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm'
              }
            >
              <FileUp className={'h-4 w-4'} />{' '}
              {parsing ? 'Reading…' : 'Upload offer sheet (PDF)'}
              <input
                type={'file'}
                accept={'application/pdf,image/*'}
                className={'hidden'}
                onChange={onUpload}
              />
            </label>
          </div>
        </CardHeader>
        <CardContent className={'grid grid-cols-2 gap-3 md:grid-cols-3'}>
          <Field
            label={'Show name'}
            v={f.show_name}
            on={(x) => set('show_name', x)}
          />
          <Field
            label={'Show date'}
            type={'date'}
            v={f.show_date}
            on={(x) =>
              setF((p) => ({
                ...p,
                show_date: x,
                days_remaining: daysFromToday(x) || p.days_remaining,
              }))
            }
          />
          <Field
            label={'Days remaining'}
            v={f.days_remaining}
            on={(x) => set('days_remaining', x)}
          />
          <Field
            label={'Venue capacity'}
            v={f.venue_capacity}
            on={(x) => set('venue_capacity', x)}
          />
          <div>
            <p className={'text-muted-foreground mb-1 text-xs'}>
              Offer structure
            </p>
            <select
              value={f.offer_structure}
              onChange={(e) => set('offer_structure', e.target.value)}
              className={
                'border-input bg-background h-9 w-full rounded-md border px-2 text-sm'
              }
            >
              <option value={'straight_guarantee'}>Straight guarantee</option>
              <option value={'backend'}>Backend</option>
              <option value={'hybrid'}>Hybrid</option>
              <option value={'bonus_escalator'}>Bonus / escalator</option>
            </select>
          </div>
          <Field
            label={'Guarantee ($)'}
            v={f.guarantee}
            on={(x) => set('guarantee', x)}
          />
          {f.offer_structure === 'backend' || f.offer_structure === 'hybrid' ? (
            <Field
              label={'Promoter share (0–1)'}
              v={f.backend_promoter_share}
              on={(x) => set('backend_promoter_share', x)}
            />
          ) : null}
          <div className={'col-span-2 md:col-span-3'}>
            <p className={'text-muted-foreground mb-1 text-xs'}>
              Gig expenses (itemized) — label / planned / actual
            </p>
            {gigExpenses.map((e, i) => (
              <div key={i} className={'mb-1 flex flex-wrap items-center gap-2'}>
                <input
                  value={e.label}
                  placeholder={'Security, LD, Catering…'}
                  onChange={(ev) =>
                    setGigExpenses((p) =>
                      p.map((x, j) =>
                        j === i ? { ...x, label: ev.target.value } : x,
                      ),
                    )
                  }
                  className={
                    'border-input bg-background h-8 w-40 rounded-md border px-2 text-sm'
                  }
                />
                <input
                  type={'number'}
                  value={e.planned}
                  placeholder={'planned'}
                  onChange={(ev) =>
                    setGigExpenses((p) =>
                      p.map((x, j) =>
                        j === i
                          ? { ...x, planned: Number(ev.target.value) }
                          : x,
                      ),
                    )
                  }
                  className={
                    'border-input bg-background h-8 w-24 rounded-md border px-2 text-sm'
                  }
                />
                <input
                  type={'number'}
                  value={e.actual ?? ''}
                  placeholder={'actual'}
                  onChange={(ev) =>
                    setGigExpenses((p) =>
                      p.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              actual:
                                ev.target.value === ''
                                  ? undefined
                                  : Number(ev.target.value),
                            }
                          : x,
                      ),
                    )
                  }
                  className={
                    'border-input bg-background h-8 w-24 rounded-md border px-2 text-sm'
                  }
                />
                <button
                  className={'text-muted-foreground text-xs'}
                  onClick={() =>
                    setGigExpenses((p) => p.filter((_, j) => j !== i))
                  }
                >
                  remove
                </button>
              </div>
            ))}
            <div className={'mt-1 flex items-center gap-3'}>
              <button
                className={'text-primary text-xs'}
                onClick={() =>
                  setGigExpenses((p) => [...p, { label: '', planned: 0 }])
                }
              >
                + add expense
              </button>
              <span className={'text-muted-foreground text-xs'}>
                Total{' '}
                {dollars(
                  gigExpenses.reduce(
                    (s, e) => s + (e.actual ?? e.planned ?? 0),
                    0,
                  ),
                )}
              </span>
            </div>
            <p className={'text-muted-foreground mt-1 text-[11px]'}>
              Marketing is set by the ad engine, not entered here.
            </p>
          </div>
          <Field
            label={'Opening cost (per show)'}
            v={f.opening_cost}
            on={(x) => set('opening_cost', x)}
            placeholder={'0'}
            help={
              'Fixed cost to open the doors that night — staff, sound, light. ' +
              'Separate from artist/production costs. Covered by attendance, ' +
              'not used in the per-attendee ad math.'
            }
          />
          <Field
            label={'Conservative attendance'}
            v={f.conservative_attendance}
            on={(x) => set('conservative_attendance', x)}
          />
          <Field
            label={'Target attendance'}
            v={f.target_attendance}
            on={(x) => set('target_attendance', x)}
          />
          <Field
            label={'Sellout attendance'}
            v={f.sellout_attendance}
            on={(x) => set('sellout_attendance', x)}
          />
          <Field
            label={'Baseline (optional)'}
            v={f.baseline_attendance}
            on={(x) => set('baseline_attendance', x)}
          />
          <Field
            label={'Historical CPA (optional)'}
            v={f.historical_cpa}
            on={(x) => set('historical_cpa', x)}
          />

          {/* Ticket tiers + booking fee (face feeds artist deal; fee is the venue's) */}
          <div className={'col-span-2 md:col-span-3'}>
            <p className={'text-muted-foreground mb-1 text-xs'}>
              Ticket tiers — the artist deal uses FACE price only; the booking
              fee is always the venue&apos;s (adds to your margin, never
              shared).
            </p>
            {tickets.map((t, i) => (
              <div
                key={i}
                className={'mb-1 flex flex-wrap items-center gap-2 text-xs'}
              >
                <input
                  value={t.name}
                  onChange={(e) =>
                    updateTicket(setTickets, i, 'name', e.target.value)
                  }
                  placeholder={'Tier'}
                  className={
                    'border-input bg-background h-8 w-36 rounded border px-2'
                  }
                />
                <span className={'text-muted-foreground'}>face $</span>
                <input
                  type={'number'}
                  value={t.face_price}
                  onChange={(e) =>
                    updateTicket(
                      setTickets,
                      i,
                      'face_price',
                      Number(e.target.value),
                    )
                  }
                  className={
                    'border-input bg-background h-8 w-20 rounded border px-2'
                  }
                />
                <span className={'text-muted-foreground'}>fee $</span>
                <input
                  type={'number'}
                  value={t.fee}
                  onChange={(e) =>
                    updateTicket(setTickets, i, 'fee', Number(e.target.value))
                  }
                  className={
                    'border-input bg-background h-8 w-16 rounded border px-2'
                  }
                />
                <select
                  value={t.fee_recipient}
                  onChange={(e) =>
                    updateTicket(setTickets, i, 'fee_recipient', e.target.value)
                  }
                  className={
                    'border-input bg-background h-8 rounded border px-1'
                  }
                >
                  <option value={'venue'}>venue keeps</option>
                  <option value={'pass_through'}>pass-through</option>
                </select>
                <span className={'text-muted-foreground'}>cap</span>
                <input
                  type={'number'}
                  value={t.capacity}
                  onChange={(e) =>
                    updateTicket(
                      setTickets,
                      i,
                      'capacity',
                      Number(e.target.value),
                    )
                  }
                  className={
                    'border-input bg-background h-8 w-16 rounded border px-2'
                  }
                />
                <span
                  className={
                    blended.per_tier[i] &&
                    blended.per_tier[i]!.venue_net_fee < 0
                      ? 'text-red-600'
                      : 'text-cyan-600'
                  }
                >
                  net fee {cents(blended.per_tier[i]?.venue_net_fee ?? 0)}
                </span>
                {tickets.length > 1 ? (
                  <button
                    className={'text-muted-foreground'}
                    onClick={() =>
                      setTickets((p) => p.filter((_, j) => j !== i))
                    }
                  >
                    remove
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className={'text-primary text-xs'}
              onClick={() =>
                setTickets((p) => [
                  ...p,
                  {
                    name: 'Tier',
                    face_price: 0,
                    fee: 0,
                    fee_recipient: 'venue',
                    capacity: 0,
                  },
                ])
              }
            >
              + add ticket tier
            </button>
            <div
              className={
                'text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1'
              }
            >
              <span>
                Processing fee %
                <input
                  type={'number'}
                  value={globals.processor_pct}
                  onChange={(e) =>
                    setGlobals((p) => ({ ...p, processor_pct: e.target.value }))
                  }
                  className={
                    'border-input bg-background ml-1 h-7 w-16 rounded border px-1'
                  }
                />
              </span>
              <span>
                flat $
                <input
                  type={'number'}
                  value={globals.processor_flat}
                  onChange={(e) =>
                    setGlobals((p) => ({
                      ...p,
                      processor_flat: e.target.value,
                    }))
                  }
                  className={
                    'border-input bg-background ml-1 h-7 w-14 rounded border px-1'
                  }
                />
              </span>
              <span>
                tickets/order
                <input
                  type={'number'}
                  value={globals.basket}
                  onChange={(e) =>
                    setGlobals((p) => ({ ...p, basket: e.target.value }))
                  }
                  className={
                    'border-input bg-background ml-1 h-7 w-12 rounded border px-1'
                  }
                />
              </span>
            </div>
            <p className={'mt-2 text-xs'}>
              Blended FACE <strong>{dollars(blended.avg_ticket_price)}</strong>{' '}
              (feeds artist deal) · net booking fee/ticket{' '}
              <strong className={'text-cyan-600'}>
                {cents(blended.net_fee_per_head)}
              </strong>{' '}
              → adds to TMAV alongside F&B. The artist never shares the fee.
            </p>
            {blended.warnings.map((w, i) => (
              <p key={i} className={'text-xs text-orange-500'}>
                {w}
              </p>
            ))}
          </div>

          {f.offer_structure === 'bonus_escalator' ? (
            <div className={'col-span-2 md:col-span-3'}>
              <p className={'text-muted-foreground mb-1 text-xs'}>
                Bonus at tickets sold (threshold / bonus $)
              </p>
              <div className={'mb-2 flex flex-wrap items-center gap-3 text-xs'}>
                <label className={'flex items-center gap-1'}>
                  <input
                    type={'radio'}
                    name={'bonus_mode'}
                    checked={bonusMode === 'incremental'}
                    onChange={() => setBonusMode('incremental')}
                  />
                  Incremental (sum every threshold met)
                </label>
                <label className={'flex items-center gap-1'}>
                  <input
                    type={'radio'}
                    name={'bonus_mode'}
                    checked={bonusMode === 'only_one'}
                    onChange={() => setBonusMode('only_one')}
                  />
                  Only one (highest threshold met)
                </label>
              </div>
              {tiers.map((t, i) => (
                <div key={i} className={'mb-1 flex items-center gap-2'}>
                  <span className={'text-muted-foreground text-xs'}>@</span>
                  <TierInput
                    v={t.at_tickets}
                    on={(n) => updateTier(setTiers, i, 'at_tickets', n)}
                  />
                  <span className={'text-muted-foreground text-xs'}>→ $</span>
                  <TierInput
                    v={t.bonus}
                    on={(n) => updateTier(setTiers, i, 'bonus', n)}
                  />
                  <button
                    className={'text-muted-foreground text-xs'}
                    onClick={() => setTiers((p) => p.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}
              <button
                className={'text-primary text-xs'}
                onClick={() =>
                  setTiers((p) => [...p, { at_tickets: 0, bonus: 0 }])
                }
              >
                + add tier
              </button>
            </div>
          ) : null}

          <div className={'col-span-2 flex items-center gap-3 md:col-span-3'}>
            <Button onClick={run}>
              <Calculator className={'mr-2 h-4 w-4'} /> Run analysis
            </Button>
            {result ? (
              <Button variant={'outline'} onClick={onSave}>
                <Save className={'mr-2 h-4 w-4'} /> Save
              </Button>
            ) : null}
            {msg ? (
              <span className={'text-muted-foreground text-sm'}>{msg}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {result ? (
        <Results
          r={result}
          walkup={walkup}
          fbAvgCheckPerHead={fbAvgCheckPerHead}
          fbMarginRate={fbMarginRate}
        />
      ) : null}

      {saved.length ? (
        <Card>
          <CardHeader>
            <CardTitle className={'text-base'}>Saved show analyses</CardTitle>
          </CardHeader>
          <CardContent className={'space-y-1'}>
            {saved.map((s) => (
              <button
                key={s.id}
                onClick={() => loadSaved(s)}
                className={
                  'hover:bg-accent/50 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm'
                }
              >
                <span className={'font-medium'}>
                  {s.showName}
                  {s.showDate ? ` · ${s.showDate}` : ''}
                </span>
                <Badge
                  variant={
                    s.dealScore === 'A' || s.dealScore === 'B'
                      ? 'success'
                      : s.dealScore === 'C'
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  Deal {s.dealScore}
                </Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function paceEmoji(p: WalkupResult['pace_vs_target']): string {
  return p === 'ahead'
    ? '🔵'
    : p === 'on_track'
      ? '🟢'
      : p === 'behind'
        ? '🟡'
        : '⚪';
}

function Results({
  r,
  walkup,
  fbAvgCheckPerHead,
  fbMarginRate,
}: {
  r: AnalysisResult;
  walkup: WalkupResult | null;
  fbAvgCheckPerHead: number | null;
  fbMarginRate: number | null;
}) {
  const scoreVariant =
    r.deal_score === 'A' || r.deal_score === 'B'
      ? 'success'
      : r.deal_score === 'C'
        ? 'warning'
        : 'destructive';
  return (
    <div className={'space-y-4'}>
      {/* Headline */}
      <Card>
        <CardContent
          className={'flex flex-wrap items-center gap-x-8 gap-y-2 py-4'}
        >
          <div>
            <p className={'text-muted-foreground text-xs'}>TMV / TMAV</p>
            <p className={'text-2xl font-bold'}>
              {dollars(r.tmv)} / {dollars(r.tmav)}
            </p>
            <p className={'text-muted-foreground text-[11px]'}>
              TMAV = TMV {dollars(r.tmv)} + F&B {dollars(r.fb_per_head)}
              {r.net_fee_per_head ? ` + fee ${cents(r.net_fee_per_head)}` : ''}
            </p>
            {/* A5: F&B basis provenance / missing-basis notice. */}
            {r.fb_basis_missing ? (
              <p
                className={
                  'text-muted-foreground border-muted-foreground/30 mt-1 max-w-md rounded-md border border-dashed p-2 text-[11px] leading-snug'
                }
              >
                F&amp;B basis not set for this client — breakeven shown on
                ticket margin only. Set average check + margin in client
                settings to include F&amp;B.
              </p>
            ) : (
              <p className={'text-muted-foreground mt-1 text-[11px]'}>
                F&amp;B margin/head: <strong>{cents(r.fb_per_head)}</strong>
                {fbAvgCheckPerHead != null && fbMarginRate != null
                  ? ` (avg check ${cents(fbAvgCheckPerHead)} × ${Math.round(
                      fbMarginRate * 100,
                    )}%)`
                  : ''}
              </p>
            )}
          </div>
          <div>
            <p className={'text-muted-foreground text-xs'}>Deal score</p>
            <Badge variant={scoreVariant} className={'text-base'}>
              {r.deal_score}
            </Badge>
          </div>
          <div>
            <p className={'text-muted-foreground text-xs'}>
              Max rational marketing (MRMC)
            </p>
            <p className={'text-lg font-semibold'}>{dollars(r.mrmc)}</p>
          </div>
        </CardContent>
      </Card>

      {/* CPA guardrails */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>CPA guardrails</CardTitle>
        </CardHeader>
        <CardContent
          className={'grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'}
        >
          <Stat
            label={'Early (0.60×)'}
            value={dollars(r.cpa_guardrails.early)}
            good
          />
          <Stat label={'Mid (0.75×)'} value={dollars(r.cpa_guardrails.mid)} />
          <Stat label={'Late (0.90×)'} value={dollars(r.cpa_guardrails.late)} />
          <Stat
            label={'Ceiling (1.00×)'}
            value={dollars(r.cpa_guardrails.ceiling)}
            bad
          />
        </CardContent>
      </Card>

      {/* Breakeven (read-only, pre-marketing) */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>Breakeven (before ads)</CardTitle>
        </CardHeader>
        <CardContent
          className={'grid grid-cols-1 gap-3 text-sm sm:grid-cols-2'}
        >
          <div>
            <p className={'font-semibold'}>
              Bar covers the open: ~
              {r.breakeven_fb_only != null ? r.breakeven_fb_only : '—'} people
            </p>
            <p
              className={'text-muted-foreground mt-1 text-[11px] leading-snug'}
            >
              Gut check: F&B margin alone covering the cost to open.
            </p>
          </div>
          <div>
            <p className={'font-semibold'}>
              Show breakeven (before ads): ~
              {r.breakeven_full != null ? r.breakeven_full : '—'} people
            </p>
            <p
              className={'text-muted-foreground mt-1 text-[11px] leading-snug'}
            >
              The real floor — tickets + F&B covering the open AND the
              artist/production deal.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Budget tiers */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>
            Budget tiers (80% Purchase / 20% support)
          </CardTitle>
        </CardHeader>
        <CardContent className={'space-y-2 text-sm'}>
          {r.budget_tiers.map((t, i) => (
            <div key={i} className={'rounded-md border p-3'}>
              <div
                className={'flex flex-wrap items-center justify-between gap-2'}
              >
                <span className={'font-medium'}>{t.name}</span>
                <span className={'text-muted-foreground text-xs'}>
                  CPA assumption {dollars(t.cpa_assumption)}
                </span>
              </div>
              <div
                className={
                  'text-muted-foreground mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs'
                }
              >
                <span>
                  <strong className={'text-foreground'}>
                    {dollars(t.total_budget)}
                  </strong>{' '}
                  total
                </span>
                <span>
                  <strong className={'text-foreground'}>
                    {dollars(t.daily_budget)}
                  </strong>
                  /day
                </span>
                <span>{dollars(t.purchase_budget)} purchase</span>
                <span>{dollars(t.support_budget)} support</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* B1: walk-up pace (live ticket sales vs. the show's target) */}
      {walkup ? (
        <Card>
          <CardHeader>
            <CardTitle className={'text-base'}>Pace (live sales)</CardTitle>
          </CardHeader>
          <CardContent className={'space-y-1 text-sm'}>
            {walkup.too_early ? (
              <p className={'text-muted-foreground'}>
                Too early to project — sales data doesn&apos;t predict this far
                out yet.
              </p>
            ) : (
              <>
                <p className={'flex flex-wrap items-center gap-x-2 gap-y-1'}>
                  <span className={'text-lg'}>
                    {paceEmoji(walkup.pace_vs_target)}
                  </span>
                  <span className={'font-semibold'}>
                    Projected final: ~{walkup.projected_final}
                  </span>
                  {walkup.curve_is_estimated ? (
                    <span className={'text-muted-foreground text-xs'}>
                      (estimated)
                    </span>
                  ) : null}
                  <span className={'text-muted-foreground text-xs capitalize'}>
                    · {walkup.pace_vs_target.replace('_', ' ')} vs target
                  </span>
                </p>
                <p className={'text-muted-foreground text-[11px]'}>
                  {Math.round(walkup.fraction_complete * 100)}% of a typical
                  show&apos;s sales expected in by now.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Scenarios */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>Attendance scenarios</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={'grid grid-cols-1 gap-3 sm:grid-cols-3'}>
            {(['conservative', 'target', 'sellout'] as const).map((k) => {
              const s = r.scenarios[k];
              return (
                <div key={k} className={'rounded-md border p-3 text-sm'}>
                  <p className={'font-medium capitalize'}>
                    {k} · {s.attendance}
                  </p>
                  <p className={'text-muted-foreground text-xs'}>
                    Revenue {dollars(s.total_revenue)}
                  </p>
                  <p className={'text-muted-foreground text-xs'}>
                    Cost {dollars(s.total_cost)}
                  </p>
                  <p
                    className={
                      s.net_profit >= 0
                        ? 'font-semibold text-green-600'
                        : 'font-semibold text-red-600'
                    }
                  >
                    Net {dollars(s.net_profit)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Campaign plan + IC reconciliation */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>Campaign build plan</CardTitle>
        </CardHeader>
        <CardContent className={'space-y-2 text-sm'}>
          <p>
            Split: <strong>80%</strong> conversion / <strong>20%</strong>{' '}
            support (awareness, traffic, engagement). Always include retargeting
            + a frequency-fatigue guard at 3.5–4.0.
          </p>
          <p
            className={
              'rounded-md border border-blue-500/30 bg-blue-50 p-3 text-blue-800 dark:bg-blue-500/10 dark:text-blue-300'
            }
          >
            <strong>Optimization (EVA IQ rule):</strong>{' '}
            {r.campaign_plan.optimization_note}
          </p>
        </CardContent>
      </Card>

      {/* Risk flags */}
      {r.risk_flags.length ? (
        <Card>
          <CardHeader>
            <CardTitle className={'text-base'}>Risk flags</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className={'list-disc space-y-1 pl-5 text-sm text-orange-600'}>
              {r.risk_flags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Executive recommendation */}
      <Card>
        <CardHeader>
          <CardTitle className={'text-base'}>
            Executive recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className={'text-sm'}>
          <p className={'bg-muted rounded-md p-3'}>
            {r.executive_recommendation}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  v,
  on,
  type,
  placeholder,
  help,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  type?: string;
  placeholder?: string;
  help?: string;
}) {
  return (
    <div>
      <p className={'text-muted-foreground mb-1 text-xs'}>{label}</p>
      <input
        type={type ?? 'text'}
        value={v}
        placeholder={placeholder}
        onChange={(e) => on(e.target.value)}
        className={
          'border-input bg-background h-9 w-full rounded-md border px-2 text-sm'
        }
      />
      {help ? (
        <p className={'text-muted-foreground mt-1 text-[11px] leading-snug'}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

function TierInput({ v, on }: { v: number; on: (n: number) => void }) {
  return (
    <input
      type={'number'}
      value={v}
      onChange={(e) => on(Number(e.target.value))}
      className={
        'border-input bg-background h-8 w-24 rounded-md border px-2 text-sm'
      }
    />
  );
}

function updateTier(
  setTiers: React.Dispatch<React.SetStateAction<BonusTier[]>>,
  i: number,
  key: keyof BonusTier,
  val: number,
) {
  setTiers((p) => p.map((t, j) => (j === i ? { ...t, [key]: val } : t)));
}

function updateTicket(
  setTickets: React.Dispatch<React.SetStateAction<TicketTier[]>>,
  i: number,
  key: keyof TicketTier,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  val: any,
) {
  setTickets((p) => p.map((t, j) => (j === i ? { ...t, [key]: val } : t)));
}

function Stat({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div>
      <p className={'text-muted-foreground text-xs'}>{label}</p>
      <p
        className={
          good
            ? 'font-semibold text-green-600'
            : bad
              ? 'font-semibold text-red-600'
              : 'font-semibold'
        }
      >
        {value}
      </p>
    </div>
  );
}
