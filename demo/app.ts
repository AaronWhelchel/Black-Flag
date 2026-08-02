/**
 * Black Flag — clean consumer shell (v0.5).
 * Explore (search any waterway, live weather, obstacles) · Plan (scenarios) ·
 * Vessel (your boats). Every number computed by @blackflag/core.
 */
import {
  recommendDeparture, evaluateDeparture, roughInletWindows,
  planTrip, routeDistanceNm, vesselSpeeds,
  fmtTime, cardinal,
} from '../packages/core/src/index.js';
import type { Explanation, TripInputs, TripVessel, SpeedChoice } from '../packages/core/src/index.js';
import { scenario as manasquan, vessel as restless31 } from '../packages/core/test/fixtures.js';
import { tahoeT16, t16Trip } from '../packages/core/test/fixtures-trip.js';
import { Chart, Buoy, ClickMode, MapMode, KIND_STYLE } from './map.js';
import { routeConflicts, suggestDetour, HAZARD_CLEARANCE_NM, extraDistanceNm } from '../packages/core/src/route.js';
import type { HazardMark } from '../packages/core/src/route.js';
import { SyncEngine } from '../packages/sync/src/index.js';
import { makeStore, DeviceStore } from './store.js';
import { fetchTripWx, fetchTripTides, TripWx, TripTides } from './tripdata.js';
// @ts-ignore — JSON bundled by esbuild
import hydroPack from './packs/hydro-east-na.json';
// @ts-ignore — JSON bundled by esbuild
import livePack from './packs/live-obs.json';

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);
const toMin = (iso: string) => { const m = iso.match(/T(\d{2}):(\d{2})/)!; return +m[1] * 60 + +m[2]; };
const minToLabel = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ================= Live pack (real NOAA data) =================

const mToFt = (m: number) => Math.round(m * 3.281 * 10) / 10;
const msToKt = (ms: number) => Math.round(ms * 1.944);
function obsAge(iso: string): { label: string; stale: boolean } {
  const built = Date.parse(livePack.built_at.replace('Z', ':00Z')) || Date.parse(livePack.built_at);
  const t = Date.parse(iso.replace('Z', ':00Z')) || Date.parse(iso);
  const days = Math.round((built - t) / 86400000);
  if (days >= 1) return { label: `obs ${days} d old — sensor gap`, stale: true };
  return { label: `obs ${Math.round((built - t) / 60000)} min old`, stale: (built - t) / 60000 > 15 };
}
const ALL_BUOYS: Buoy[] = (livePack.buoys as any[]).map(b => {
  const parts: string[] = [];
  if (b.wind) parts.push(`${cardinal(b.wind.dir_deg)} ${msToKt(b.wind.spd_ms)} kt`);
  if (b.wvht_m != null) parts.push(`seas ${mToFt(b.wvht_m)} ft @ ${b.dpd_s}s`);
  if (b.wtmp_c != null) parts.push(`water ${Math.round(b.wtmp_c * 9 / 5 + 32)}°F`);
  if (b.outage) parts.push(`(${b.outage})`);
  const age = obsAge(b.obs_time);
  return { id: b.id, lat: b.lat, lon: b.lon, obs: parts.join(' · '), age: age.label, stale: age.stale };
});

// ================= Map =================

const MANASQUAN_WPS = [
  { name: 'Manasquan', lat: 40.10, lon: -74.03 },
  { name: 'Fire Is. offing', lat: 40.55, lon: -73.05 },
  { name: 'Montauk', lat: 41.05, lon: -71.90 },
  { name: 'Block Island', lat: 41.17, lon: -71.58 },
];

const canvas = $('chart') as HTMLCanvasElement;
const chart = new Chart(canvas, {
  centerLon: -86.66, centerLat: 38.42, zoom: 11,
  mode: 'satellite', clickMode: 'browse',
  waypoints: [], buoys: ALL_BUOYS, obstacles: [],
  hydro: { lakes: (hydroPack as any).lakes, rivers: (hydroPack as any).rivers },
  showBuoys: true, showPiracy: false,
  onRouteChange: () => onRouteChange(),
  onObstaclePlace: (lat, lon) => beginObstacle(lat, lon),
  onMarkClick: (id) => openMark(id),
});

function sizeCanvas() {
  const w = canvas.parentElement!.clientWidth;
  canvas.width = Math.max(480, w);
  canvas.height = Math.round(Math.min(620, canvas.width * 0.72));
  chart.render();
}
window.addEventListener('resize', sizeCanvas);

for (const btn of [...document.querySelectorAll('#map-mode button')]) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#map-mode button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    chart.st.mode = (btn as HTMLElement).dataset.mode as MapMode;
    chart.render();
  });
}
for (const btn of [...document.querySelectorAll('#click-mode button')]) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#click-mode button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    chart.st.clickMode = (btn as HTMLElement).dataset.cm as ClickMode;
    show('plot-actions', chart.st.clickMode === 'plot');
    canvas.style.cursor = chart.st.clickMode === 'browse' ? 'grab' : 'crosshair';
  });
}
($('ly-buoys') as HTMLInputElement).addEventListener('change', (e) => { chart.st.showBuoys = (e.target as HTMLInputElement).checked; chart.render(); });
($('ly-piracy') as HTMLInputElement).addEventListener('change', (e) => { chart.st.showPiracy = (e.target as HTMLInputElement).checked; chart.render(); });

// ================= Shared explanation renderer =================

function renderExplanation<T>(exp: Explanation<T>, el: HTMLElement) {
  el.innerHTML =
    exp.reasoning.map(s => `<div class="step"><span class="rule">${esc(s.rule)}</span><p>${esc(s.detail)}</p><span class="src">${esc(s.source)}</span></div>`).join('') +
    (exp.alternatives.length ? `<div class="alts"><h4>Also considered</h4>${exp.alternatives.map(a => `<div class="alt">✗ ${esc((a as any).rejected_because)}</div>`).join('')}</div>` : '') +
    `<div class="caveats"><h4>Not accounted for</h4>${exp.caveats.map(c => `<div class="cv">• ${esc(c)}</div>`).join('')}</div>` +
    `<div class="prov">inputs ${exp.inputs_hash} · core v${exp.core_version} · confidence ${exp.confidence} · logged to trust ledger</div>`;
}
function wireWhy(btnId: string, bodyId: string) {
  $(btnId).addEventListener('click', () => {
    const b = $(bodyId);
    const open = b.style.display !== 'none';
    b.style.display = open ? 'none' : 'block';
    $(btnId).textContent = open ? 'Why? ▾' : 'Why? ▴';
  });
}
wireWhy('why-btn', 'why-body');
wireWhy('why-trip-btn', 'why-trip-body');

// ================= Sync engine + device store =================

let engine = new SyncEngine('demo-device', { now: () => Date.now() });
let store: DeviceStore | null = null;
function syncChip() {
  const n = engine.unsyncedCount();
  $('sync-chip').textContent = store?.persistent
    ? `✓ saved on device · ${n} op${n === 1 ? '' : 's'} queued`
    : `in-memory only here`;
}
let saveTimer: any = null;
function persistSoon() {
  syncChip();
  if (!store) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store!.save(engine.toSnapshot()), 250);
}

// ================= Vessels (captain-managed) =================

const BUILTIN_VESSELS: Record<string, { v: TripVessel; cruise: number }> = {
  'builtin-restless': { v: { ...restless31, type: 'cruiser', loa_ft: 31, max_recommended_seas_ft: 5 }, cruise: 17 },
  'builtin-t16': { v: tahoeT16, cruise: 22 },
};

function customVessels(): { id: string; v: TripVessel; cruise: number }[] {
  return engine.list('vessel').map(({ id, data }) => {
    const d = data as any;
    return {
      id,
      v: {
        name: d.name, type: d.type, loa_ft: d.loa_ft, max_recommended_seas_ft: d.max_seas_ft,
        engine_curve: d.curve, usable_gal: d.usable_gal, reserve_frac: d.reserve_frac,
        profile_confirmed_days_ago: 0,
      },
      cruise: d.cruise_kn,
    };
  });
}

function vesselById(id: string): { v: TripVessel; cruise: number } {
  if (BUILTIN_VESSELS[id]) return BUILTIN_VESSELS[id];
  const c = customVessels().find(x => x.id === id);
  return c ? { v: c.v, cruise: c.cruise } : BUILTIN_VESSELS['builtin-restless'];
}

function refreshVesselSelect() {
  const sel = $('free-vessel') as HTMLSelectElement;
  const current = sel.value;
  const opts = [
    ...customVessels().map(c => ({ id: c.id, label: `${c.v.name} (${c.v.loa_ft} ft ${c.v.type.replace('_', ' ')})` })),
    { id: 'builtin-restless', label: 'Restless-31 (31 ft cruiser) — sample' },
    { id: 'builtin-t16', label: 'Tahoe T16 (16 ft bowrider) — sample' },
  ];
  sel.innerHTML = opts.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('');
  sel.value = opts.some(o => o.id === current) ? current : opts[0].id;
}

// ---- vessel editor ----

let editingVesselId: string | null = null;

function curveRow(rpm = '', kn = '', gph = ''): string {
  return `<tr>
    <td><input type="number" class="c-rpm" value="${rpm}" min="0" step="100"></td>
    <td><input type="number" class="c-kn" value="${kn}" min="0" step="0.5"></td>
    <td><input type="number" class="c-gph" value="${gph}" min="0" step="0.1"></td>
    <td><button class="c-del">✕</button></td></tr>`;
}
function readCurve(): { rpm: number; kn: number; gph: number }[] {
  const rows = Array.from(document.querySelectorAll('#curve-body tr'));
  return rows.map(r => ({
    rpm: +(r.querySelector('.c-rpm') as HTMLInputElement).value,
    kn: +(r.querySelector('.c-kn') as HTMLInputElement).value,
    gph: +(r.querySelector('.c-gph') as HTMLInputElement).value,
  })).filter(p => p.kn > 0 && p.gph > 0);
}
function previewSpeeds() {
  const curve = readCurve();
  const usable = +($('v-fuel') as HTMLInputElement).value || 0;
  const reserve = (+($('v-reserve') as HTMLInputElement).value || 0) / 100;
  const cruise = +($('v-cruise') as HTMLInputElement).value || 0;
  if (curve.length < 2 || !usable || !cruise) { $('v-preview').textContent = 'Add at least two curve rows, fuel, and cruise speed to preview.'; return; }
  try {
    const s = vesselSpeeds(curve, cruise, usable, reserve);
    $('v-preview').textContent = `Derived: top ${s.top.kn} kn · cruise ${s.cruise.kn} kn (${s.cruise.gph} gph) · best economy ${s.best_economy.kn} kn, range ${s.best_economy.range_nm} nm under reserve.`;
  } catch { $('v-preview').textContent = 'Curve looks inconsistent — check the rows.'; }
}
function openEditor(id: string | null) {
  editingVesselId = id;
  show('v-editor', true);
  const tbody = $('curve-body');
  if (id) {
    const d = engine.get('vessel', id) as any;
    $('v-editor-title').textContent = `Edit ${d.name}`;
    ($('v-name') as HTMLInputElement).value = d.name;
    ($('v-type') as HTMLSelectElement).value = d.type;
    ($('v-loa') as HTMLInputElement).value = d.loa_ft;
    ($('v-seas') as HTMLInputElement).value = d.max_seas_ft;
    ($('v-fuel') as HTMLInputElement).value = d.usable_gal;
    ($('v-reserve') as HTMLInputElement).value = Math.round(d.reserve_frac * 100) as any;
    ($('v-cruise') as HTMLInputElement).value = d.cruise_kn;
    tbody.innerHTML = d.curve.map((p: any) => curveRow(p.rpm, p.kn, p.gph)).join('');
    show('v-delete' as any, true);
    $('v-delete').style.display = '';
  } else {
    $('v-editor-title').textContent = 'New vessel';
    ($('v-name') as HTMLInputElement).value = '';
    ($('v-type') as HTMLSelectElement).value = 'open_bow';
    ($('v-loa') as HTMLInputElement).value = '';
    ($('v-seas') as HTMLInputElement).value = '2';
    ($('v-fuel') as HTMLInputElement).value = '';
    ($('v-reserve') as HTMLInputElement).value = '20';
    ($('v-cruise') as HTMLInputElement).value = '';
    tbody.innerHTML = curveRow('1000', '5', '1.5') + curveRow('3500', '', '') + curveRow('5500', '', '');
  }
  previewSpeeds();
}
function renderVesselList() {
  const list = customVessels();
  $('vessel-list').innerHTML = list.length
    ? list.map(c => `<div class="vessel-item"><div><div class="nm">${esc(c.v.name)}</div><div class="meta">${c.v.loa_ft} ft ${esc(c.v.type.replace('_', ' '))} · ${c.v.usable_gal} gal usable · cruise ${c.cruise} kn</div></div><button class="btn" data-edit="${c.id}">Edit</button></div>`).join('')
    : `<div class="sub">No vessels yet — add yours to get real speeds, fuel, and risk numbers everywhere in the app.</div>`;
  document.querySelectorAll('#vessel-list [data-edit]').forEach(b =>
    b.addEventListener('click', () => openEditor((b as HTMLElement).dataset.edit!)));
}
$('v-new').addEventListener('click', () => openEditor(null));
$('v-addrow').addEventListener('click', () => { $('curve-body').insertAdjacentHTML('beforeend', curveRow()); });
$('curve-body').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains('c-del')) { t.closest('tr')?.remove(); previewSpeeds(); }
});
$('curve-body').addEventListener('input', previewSpeeds);
for (const id of ['v-fuel', 'v-reserve', 'v-cruise']) $(id).addEventListener('input', previewSpeeds);
$('v-cancel').addEventListener('click', () => show('v-editor', false));
$('v-save').addEventListener('click', () => {
  const name = ($('v-name') as HTMLInputElement).value.trim();
  const curve = readCurve();
  if (!name || curve.length < 2) { $('v-preview').textContent = 'A name and at least two engine-curve rows are required.'; return; }
  const id = editingVesselId ?? `v-${Date.now().toString(36)}`;
  engine.write('vessel', id, editingVesselId ? 'update' : 'create', {
    name,
    type: ($('v-type') as HTMLSelectElement).value,
    loa_ft: +($('v-loa') as HTMLInputElement).value || 20,
    max_seas_ft: +($('v-seas') as HTMLInputElement).value || 2,
    usable_gal: +($('v-fuel') as HTMLInputElement).value || 20,
    reserve_frac: (+($('v-reserve') as HTMLInputElement).value || 20) / 100,
    cruise_kn: +($('v-cruise') as HTMLInputElement).value || 15,
    curve: curve.sort((a, b) => a.kn - b.kn),
  });
  persistSoon();
  show('v-editor', false);
  renderVesselList();
  refreshVesselSelect();
  ($('free-vessel') as HTMLSelectElement).value = id;
  applyVesselChoice();
  engine.write('plan', 'free-plan', 'update', { vessel: id });
  persistSoon();
});
$('v-delete').addEventListener('click', () => {
  if (editingVesselId) {
    engine.write('vessel', editingVesselId, 'delete', {});
    persistSoon();
  }
  show('v-editor', false);
  renderVesselList();
  refreshVesselSelect();
  applyVesselChoice();
});

// ================= Trip planner (Explore free-plot) =================

let tripState: TripInputs = {
  ...JSON.parse(JSON.stringify(t16Trip)),
  waypoints: [], gulf_stream_crossing: false,
  forecast: { wind_kn: 10, wind_from_deg: 200, seas_ft: 2, seas_from_deg: 200 },
};
let speedChoice: SpeedChoice = 'best_economy';

function currentTripInputs(): TripInputs {
  return {
    ...tripState,
    speed_choice: speedChoice,
    crew: +($('in-crew') as HTMLInputElement).value || 1,
    fuel_price_usd_gal: +($('in-fuel') as HTMLInputElement).value || 4.85,
    provisions_usd_person_day: +($('in-food') as HTMLInputElement).value || 35,
    fishing_offset: ($('in-fish') as HTMLInputElement).checked,
  };
}

function renderTrip() {
  const v = tripState.vessel;
  $('trip-vessel-name').textContent = `${v.name} · ${v.loa_ft} ft ${v.type.replace('_', ' ')}`;
  const s = vesselSpeeds(v.engine_curve, tripState.cruise_kn, v.usable_gal, v.reserve_frac);
  $('sp-eco').textContent = String(s.best_economy.kn);
  $('sp-eco-d').textContent = `${s.best_economy.gph} gph · ${s.best_economy.nmpg} nm/gal · range ${s.best_economy.range_nm} nm`;
  $('sp-cru').textContent = String(s.cruise.kn);
  $('sp-cru-d').textContent = `${s.cruise.gph} gph · ${s.cruise.nmpg} nm/gal · range ${s.cruise.range_nm} nm`;
  $('sp-top').textContent = String(s.top.kn);
  $('sp-top-d').textContent = `${s.top.gph} gph · ${s.top.nmpg} nm/gal · range ${s.top.range_nm} nm`;
  document.querySelectorAll('.speed').forEach(el => el.classList.toggle('sel', (el as HTMLElement).dataset.speed === speedChoice));

  if (tripState.waypoints.length < 2) {
    $('trip-dist').textContent = '—';
    $('trip-time').textContent = 'switch to “Plot route” and tap the map';
    $('trip-fuel-flag').classList.add('hidden');
    $('b-fuel').textContent = '—'; $('b-prov').textContent = '—'; $('b-total').textContent = '—';
    $('why-trip-body').innerHTML = '';
    ($('risk-card')).className = 'card';
    $('risk-score').textContent = '—';
    $('risk-band').textContent = '—';
    $('risk-components').innerHTML = '';
    $('risk-mits').innerHTML = '';
    return;
  }
  const trip = planTrip(currentTripInputs());
  const p = trip.recommendation;
  $('trip-dist').textContent = String(p.distance_nm);
  $('trip-time').textContent = `${p.duration_h.value} h at ${p.chosen_speed_kn} kn`;
  const flag = $('trip-fuel-flag');
  if (!p.fuel_ok) {
    flag.classList.remove('hidden'); flag.className = 'badge no';
    flag.textContent = `FUEL: ${p.fuel_required.value} gal needed vs ${p.fuel_available.value} usable — ${p.refuel_stops_needed} refuel stop(s) or auxiliary fuel`;
  } else flag.classList.add('hidden');
  $('b-fuel-label').textContent = `Fuel — ${p.fuel_required.value} gal`;
  $('b-fuel').textContent = `$${p.fuel_cost_usd}`;
  $('b-prov-label').textContent = `Provisions — ${currentTripInputs().crew} crew × ${p.provisions_days} day${p.provisions_days > 1 ? 's' : ''}${currentTripInputs().fishing_offset ? ' (fishing −30%)' : ''}`;
  $('b-prov').textContent = `$${p.provisions_cost_usd}`;
  $('b-total').textContent = `$${p.total_budget_usd}`;
  renderExplanation(trip, $('why-trip-body'));

  const r = p.risk.recommendation;
  ($('risk-card')).className = `card risk-${r.band}`;
  $('risk-score').textContent = String(r.score);
  const bandEl = $('risk-band');
  bandEl.textContent = `${r.band.toUpperCase()} · /100`;
  bandEl.className = `badge ${r.band === 'low' ? 'go' : r.band === 'moderate' ? 'ok' : 'no'}`;
  $('risk-components').innerHTML = r.components.map(cm => `
    <div class="rc"><div class="name">${esc(cm.name.replace('_', ' '))} — ${cm.points}/${cm.max}</div>
    <div class="bar"><div class="fill" style="width:${(cm.points / cm.max) * 100}%"></div></div>
    <div class="det">${esc(cm.detail)}</div></div>`).join('');
  $('risk-mits').innerHTML = r.mitigations.length
    ? `<h4 class="name" style="font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-3)">What would lower this</h4>` +
      r.mitigations.map(m => `<div class="mit">${esc(m)}</div>`).join('') : '';
}
document.querySelectorAll('.speed').forEach(el => el.addEventListener('click', () => {
  speedChoice = (el as HTMLElement).dataset.speed as SpeedChoice;
  renderTrip();
}));
for (const id of ['in-crew', 'in-fuel', 'in-food', 'in-fish']) $(id).addEventListener('input', renderTrip);
($('risk-toggle') as HTMLInputElement).addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  $('risk-body').style.display = on ? 'block' : 'none';
  $('risk-off-note').style.display = on ? 'none' : 'block';
});

// ---- Trip data auto-fetch: plan a trip, get its NOAA data ----
let tripWx: TripWx | null = null;
let tripTides: TripTides | null = null;
let wxTimer: any = null;
let wxSeq = 0;

function renderTripWxCard(status?: string) {
  const el = $('trip-wx-body');
  if (status) { el.innerHTML = `<span class="sub">${esc(status)}</span>`; return; }
  if (!tripWx) return;
  const gust = tripWx.gust_kn ? ` (gusts ${tripWx.gust_kn} kt)` : '';
  const seas = tripWx.seas_ft !== null ? `${tripWx.seas_ft} ft seas (NWS marine grid)` : 'no marine wave grid here — seas not forecast (inland water)';
  el.innerHTML = `
    <div style="font-size:14px;color:var(--ink)"><b>${cardinal(tripWx.wind_from_deg)} ${tripWx.wind_kn} kt${gust}</b> · ${seas}</div>
    <div style="margin-top:4px;color:var(--ink)">${esc(tripWx.summary)}</div>
    <div class="sub" style="margin-top:6px">${esc(tripWx.detailed).slice(0, 220)}</div>
    ${tripTides ? `<div style="margin-top:8px;font-size:13px;color:var(--ink)">Tides — ${esc(tripTides.name)}: ${tripTides.events.map(e => `${e.type} ${e.t}`).join(' · ')}</div>` : `<div class="sub" style="margin-top:8px">No tide station within 60 nm of this route — inland water, no tidal planning needed.</div>`}
    <div class="sub" style="margin-top:8px;font-size:11px">${esc(tripWx.provenance)}${tripTides ? ' · ' + esc(tripTides.provenance) : ''} · fetched just now — feeding fuel, risk, and budget below</div>`;
}

async function refreshTripData() {
  if (chart.st.waypoints.length < 2) return;
  const seq = ++wxSeq;
  renderTripWxCard('Fetching NOAA forecast & tides for this route…');
  try {
    const wx = await fetchTripWx(chart.st.waypoints);
    if (seq !== wxSeq) return;               // a newer route superseded this fetch
    tripWx = wx;
    tripTides = await fetchTripTides(chart.st.waypoints).catch(() => null);
    if (seq !== wxSeq) return;
    // The real forecast now drives the intelligence core — no more demo weather.
    tripState.forecast = {
      wind_kn: wx.wind_kn, wind_from_deg: wx.wind_from_deg,
      seas_ft: wx.seas_ft ?? 1, seas_from_deg: wx.wind_from_deg,
    };
    tripState.forecast_age_hours = 0;
    tripState.data_vintage = {
      ...tripState.data_vintage,
      weather: `${wx.provenance} · fetched ${wx.fetched_at.slice(11, 16)}Z`,
      ...(tripTides ? { tides: tripTides.provenance } : {}),
    };
    renderTripWxCard();
    if (tripTides) $('tide-line').textContent = `Tides ${tripTides.name} (${tripTides.date}): ${tripTides.events.map(e => `${e.type} ${e.t}`).join(' · ')} · ${tripTides.provenance}`;
    renderTrip();
  } catch (e) {
    if (seq !== wxSeq) return;
    tripWx = null; tripTides = null;
    renderTripWxCard(String((e as Error).message) === 'offline'
      ? 'Can\u2019t reach forecast services right now (connection or firewall). Trip numbers below use the manual/demo conditions \u2014 honestly labeled in the Why panel.'
      : 'This route is outside NWS coverage and no model fallback answered for it. Trip numbers below use the manual/demo conditions \u2014 honestly labeled in the Why panel.');
  }
}
function scheduleTripData() {
  clearTimeout(wxTimer);
  wxTimer = setTimeout(refreshTripData, 900);
}
$('wx-refresh').addEventListener('click', refreshTripData);

// route changes (plot mode)
let restoring = false;
function onRouteChange() {
  tripState.waypoints = chart.st.waypoints;
  const nm = chart.st.waypoints.length >= 2 ? routeDistanceNm(chart.st.waypoints) : 0;
  $('route-readout').textContent = nm ? `${nm} nm plotted` : '';
  checkRouteSafety();
  renderTrip();
  if (($('scenario') as HTMLSelectElement | null) && tab === 'explore') scheduleTripData();
  if (!restoring) {
    engine.write('plan', 'free-plan', 'update', { waypoints: chart.st.waypoints, vessel: ($('free-vessel') as HTMLSelectElement).value });
    persistSoon();
  }
}
$('undo-wp').addEventListener('click', () => { chart.st.waypoints.pop(); onRouteChange(); chart.render(); });
$('clear-wp').addEventListener('click', () => { chart.st.waypoints = []; onRouteChange(); chart.render(); });

function applyVesselChoice() {
  const id = ($('free-vessel') as HTMLSelectElement).value;
  const { v, cruise } = vesselById(id);
  tripState.vessel = v;
  tripState.cruise_kn = cruise;
  renderTrip();
}
$('free-vessel').addEventListener('change', () => {
  applyVesselChoice();
  engine.write('plan', 'free-plan', 'update', { vessel: ($('free-vessel') as HTMLSelectElement).value });
  persistSoon();
});

// ================= Photos =================

function fileToThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 900;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ================= Route safety (hazard_clearance rule) =================

function hazardMarks(): HazardMark[] {
  return engine.list('obstacle')
    .map(({ id, data }) => ({ id, ...(data as any) }))
    .filter(o => (KIND_STYLE[o.kind] ?? KIND_STYLE.other).hazard)
    .map(o => ({ id: o.id, label: o.label, kind: o.kind, lat: o.lat, lon: o.lon }));
}

function checkRouteSafety() {
  const wps = chart.st.waypoints;
  const warnEl = $('route-warnings');
  if (wps.length < 2) { chart.st.dangerLegs = []; warnEl.style.display = 'none'; return; }
  const hazards = hazardMarks();
  const conflicts = hazards.flatMap(h =>
    routeConflicts(wps, [h], HAZARD_CLEARANCE_NM[h.kind] ?? 0.05));
  chart.st.dangerLegs = [...new Set(conflicts.map(c => c.leg_index))];
  if (!conflicts.length) { warnEl.style.display = 'none'; chart.render(); return; }
  const yd = (nm: number) => Math.round(nm * 2025);
  warnEl.style.display = 'block';
  warnEl.innerHTML =
    conflicts.slice(0, 4).map(c =>
      `<div style="color:var(--bad);font-size:13px;font-weight:600">⚠ Route passes ${yd(c.dist_nm)} yd from “${esc(c.hazard.label)}” (${esc(c.hazard.kind)})</div>`).join('') +
    `<div style="margin-top:8px;display:flex;gap:8px;align-items:center">
       <button class="btn primary" id="detour-btn">Route around hazards</button>
       <span class="sub">detours around your marks — land & depth come with chart packs; verify the water</span>
     </div>`;
  $('detour-btn').addEventListener('click', applyDetour);
  chart.render();
}

function applyDetour() {
  const hazards = hazardMarks();
  const before = [...chart.st.waypoints];
  const clearance = Math.max(...hazards.map(h => HAZARD_CLEARANCE_NM[h.kind] ?? 0.05), 0.05);
  const res = suggestDetour(before, hazards, clearance);
  chart.st.waypoints = res.waypoints;
  onRouteChange();
  const extra = extraDistanceNm(before, res.waypoints);
  const warnEl = $('route-warnings');
  if (res.resolved) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = `<div style="color:var(--good);font-size:13px;font-weight:600">✓ Detour added ${res.added} waypoint${res.added > 1 ? 's' : ''} (+${extra} nm) — clears all ${hazards.length} marked hazard${hazards.length > 1 ? 's' : ''}. Drag any waypoint to fine-tune.</div>`;
  }
  chart.render();
}

// ================= Obstacles =================

let pendingObstacle: { lat: number; lon: number } | null = null;
function beginObstacle(lat: number, lon: number) {
  pendingObstacle = { lat, lon };
  ($('obs-form')).style.display = 'flex';
  ($('obs-label') as HTMLInputElement).value = '';
  ($('obs-photo') as HTMLInputElement).value = '';
  ($('obs-label') as HTMLInputElement).focus();
  setTab('explore');
}
function refreshObstacles() {
  const list = engine.list('obstacle').map(({ id, data }) => ({ id, ...(data as any) }));
  chart.st.obstacles = list;
  $('obs-list').innerHTML = list.length
    ? list.map(o => `<div class="obs-item">
        <div style="display:flex;gap:8px;align-items:center">
          ${o.photo ? `<img src="${o.photo}" data-view="${o.id}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;cursor:pointer">` : ''}
          <div><b style="color:${(KIND_STYLE[o.kind] ?? KIND_STYLE.other).color}">${esc(o.label)}</b> <span class="k">· ${esc(o.kind)} · ${o.lat.toFixed(4)}, ${o.lon.toFixed(4)}</span></div>
        </div>
        <span><button data-view="${o.id}" style="color:var(--accent)">view</button><button data-del="${o.id}">remove</button></span>
      </div>`).join('')
    : `<div class="sub" style="margin-top:8px">Nothing marked yet.</div>`;
  document.querySelectorAll('#obs-list [data-del]').forEach(b =>
    b.addEventListener('click', () => {
      engine.write('obstacle', (b as HTMLElement).dataset.del!, 'delete', {});
      persistSoon(); refreshObstacles(); checkRouteSafety(); chart.render();
    }));
  document.querySelectorAll('#obs-list [data-view]').forEach(b =>
    b.addEventListener('click', () => openMark((b as HTMLElement).dataset.view!)));
  chart.render();
}

// ---- mark viewer ----
let viewingMarkId: string | null = null;
function openMark(id: string) {
  const d = engine.get('obstacle', id) as any;
  if (!d) return;
  viewingMarkId = id;
  $('mv-title').textContent = d.label;
  $('mv-meta').textContent = `${d.kind} · ${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`;
  const img = $('mv-photo') as HTMLImageElement;
  if (d.photo) { img.src = d.photo; img.style.display = 'block'; $('mv-nophoto').style.display = 'none'; }
  else { img.style.display = 'none'; $('mv-nophoto').style.display = 'block'; }
  ($('mark-view')).style.display = 'flex';
}
$('mv-close').addEventListener('click', () => { ($('mark-view')).style.display = 'none'; viewingMarkId = null; });
$('mv-remove').addEventListener('click', () => {
  if (viewingMarkId) { engine.write('obstacle', viewingMarkId, 'delete', {}); persistSoon(); }
  ($('mark-view')).style.display = 'none'; viewingMarkId = null;
  refreshObstacles(); checkRouteSafety();
});
$('mv-photo-input').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !viewingMarkId) return;
  const photo = await fileToThumb(file).catch(() => null);
  if (photo) {
    engine.write('obstacle', viewingMarkId, 'update', { photo });
    persistSoon(); refreshObstacles(); openMark(viewingMarkId);
  }
});
$('obs-save').addEventListener('click', async () => {
  if (!pendingObstacle) return;
  const label = ($('obs-label') as HTMLInputElement).value.trim() || 'Obstacle';
  const file = ($('obs-photo') as HTMLInputElement).files?.[0];
  const photo = file ? await fileToThumb(file).catch(() => undefined) : undefined;
  engine.write('obstacle', `o-${Date.now().toString(36)}`, 'create', {
    ...pendingObstacle, label, kind: ($('obs-kind') as HTMLSelectElement).value,
    ...(photo ? { photo } : {}),
  });
  persistSoon();
  pendingObstacle = null;
  ($('obs-form')).style.display = 'none';
  refreshObstacles();
  checkRouteSafety();
});
$('obs-cancel').addEventListener('click', () => { pendingObstacle = null; ($('obs-form')).style.display = 'none'; });

// ================= Search (gazetteer + OSM) & weather (NWS) =================

interface Place { name: string; region: string; lat: number; lon: number; zoom: number; }
const GAZETTEER: Place[] = [
  { name: 'Patoka Lake', region: 'Indiana', lat: 38.42, lon: -86.66, zoom: 11.5 },
  { name: 'Rough River Lake', region: 'Kentucky', lat: 37.617, lon: -86.505, zoom: 11.5 },
  { name: 'Lake Monroe', region: 'Indiana', lat: 39.07, lon: -86.44, zoom: 11.5 },
  { name: 'Kentucky Lake', region: 'Kentucky/Tennessee', lat: 36.77, lon: -88.12, zoom: 9.5 },
  { name: 'Lake Cumberland', region: 'Kentucky', lat: 36.92, lon: -85.05, zoom: 10 },
  { name: 'Lake Lanier', region: 'Georgia', lat: 34.24, lon: -83.95, zoom: 10.5 },
  { name: 'Lake of the Ozarks', region: 'Missouri', lat: 38.13, lon: -92.65, zoom: 10 },
  { name: 'Lake Travis', region: 'Texas', lat: 30.43, lon: -97.92, zoom: 10.5 },
  { name: 'Lake Tahoe', region: 'California/Nevada', lat: 39.09, lon: -120.03, zoom: 10 },
  { name: 'Chesapeake Bay', region: 'Maryland/Virginia', lat: 38.5, lon: -76.4, zoom: 8 },
  { name: 'Tampa Bay', region: 'Florida', lat: 27.75, lon: -82.55, zoom: 10 },
  { name: 'Manasquan Inlet', region: 'New Jersey', lat: 40.10, lon: -74.03, zoom: 12 },
  { name: 'Block Island', region: 'Rhode Island', lat: 41.17, lon: -71.58, zoom: 11 },
  { name: 'Key Largo', region: 'Florida', lat: 25.09, lon: -80.45, zoom: 10.5 },
  { name: 'Bimini', region: 'Bahamas', lat: 25.73, lon: -79.30, zoom: 11 },
];

const sr = $('search-results');
let searchTimer: any = null;

async function osmSearch(q: string): Promise<Place[]> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .filter((r: any) => ['water', 'natural', 'waterway', 'place', 'leisure'].includes(r.category) || /water|bay|lake|river|reservoir|harbour|harbor|marina/.test(`${r.category} ${r.type}`))
      .map((r: any) => ({
        name: r.display_name.split(',')[0],
        region: r.display_name.split(',').slice(1, 3).join(',').trim() + ' · OSM',
        lat: +r.lat, lon: +r.lon,
        zoom: r.type === 'bay' ? 9.5 : 11,
      }));
  } catch { return []; }
}

function showResults(list: Place[], note?: string) {
  if (!list.length && !note) { sr.style.display = 'none'; return; }
  sr.innerHTML =
    list.map((p, i) => `<div class="sr" data-i="${i}"><span class="nm">${esc(p.name)}</span><span class="meta">${esc(p.region)}</span></div>`).join('') +
    (note ? `<div class="sr" style="cursor:default"><span class="meta">${esc(note)}</span></div>` : '');
  sr.style.display = 'block';
  sr.querySelectorAll('[data-i]').forEach(el =>
    el.addEventListener('click', () => selectPlace(list[+(el as HTMLElement).dataset.i!])));
}

$('search').addEventListener('input', () => {
  const q = ($('search') as HTMLInputElement).value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { sr.style.display = 'none'; return; }
  const local = GAZETTEER.filter(p => `${p.name} ${p.region}`.toLowerCase().includes(q.toLowerCase()));
  showResults(local.slice(0, 6), 'searching OpenStreetMap…');
  searchTimer = setTimeout(async () => {
    const remote = await osmSearch(q);
    const merged = [...local, ...remote.filter(r => !local.some(l => Math.abs(l.lat - r.lat) < 0.05 && Math.abs(l.lon - r.lon) < 0.05))];
    showResults(merged.slice(0, 8), merged.length ? undefined : 'No waterways found (offline? try the built-in names)');
  }, 350);
});
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('#searchwrap')) sr.style.display = 'none'; });

async function selectPlace(p: Place) {
  sr.style.display = 'none';
  ($('search') as HTMLInputElement).value = p.name;
  setTab('explore');
  chart.flyTo(p.lon, p.lat, p.zoom);
  $('wx-title').textContent = p.name;
  $('wx-sub').textContent = p.region.replace(' · OSM', '');
  $('wx-body').innerHTML = `<div class="sub">Checking NWS conditions…</div>`;
  $('wx-src').textContent = '';
  try {
    const pt = await (await fetch(`https://api.weather.gov/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { signal: AbortSignal.timeout(8000) })).json();
    const url = pt?.properties?.forecast;
    if (!url) throw new Error('no forecast url');
    const fc = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
    const periods = fc?.properties?.periods?.slice(0, 4) ?? [];
    if (!periods.length) throw new Error('no periods');
    $('wx-body').innerHTML = periods.map((per: any) =>
      `<div class="wxp"><span class="t">${esc(per.name)}</span><span class="d"><b>${per.temperature}°${per.temperatureUnit}</b> · ${esc(per.windSpeed)} ${esc(per.windDirection ?? '')} · ${esc(per.shortForecast)}</span></div>`).join('') +
      `<div id="wx-detail">${esc(periods[0].detailedForecast)}</div>`;
    $('wx-src').textContent = `NWS forecast for ${pt.properties.relativeLocation?.properties?.city ?? p.name} · fetched just now · vintage shown per Explainability Standard`;
  } catch {
    $('wx-body').innerHTML = `<div class="sub">Live weather unreachable from this device right now (offline, non-US location, or blocked network). Nothing cached for this spot — Black Flag doesn’t guess.</div>`;
    $('wx-src').textContent = 'NWS covers US waters; international forecast sources are on the register roadmap.';
  }
}

// ================= Plan tab (scenarios — unchanged intelligence) =================

const rec = recommendDeparture(manasquan);
const rough = roughInletWindows(manasquan.tide_events, manasquan.swell, manasquan.inlet_faces_deg);
const recMin = toMin(rec.recommendation.depart_at);

const T0 = 5 * 60, T1 = 18 * 60;
const W = 640, PAD_L = 44, PAD_R = 14;
const x = (min: number) => PAD_L + ((min - T0) / (T1 - T0)) * (W - PAD_L - PAD_R);
function axisHours(): string {
  let s = '';
  for (let h = 5; h <= 18; h += 2) s += `<text class="ax" x="${x(h * 60)}" y="14" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
  return s;
}
function bandRects(h: number): string {
  return rough.map(w => `<rect x="${x(toMin(w.from))}" y="0" width="${x(toMin(w.until)) - x(toMin(w.from))}" height="${h}" class="rough"/>`).join('');
}
function lineChart(id: string, series: { t: number; v: number }[], yMax: number, unit: string, color: string, title: string, limit?: number) {
  const H = 120, PAD_T = 22, PAD_B = 6;
  const y = (v: number) => H - PAD_B - (v / yMax) * (H - PAD_T - PAD_B);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const grid = [0.5, 1].map(f => `<line class="grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(yMax * f)}" y2="${y(yMax * f)}"/>` +
    `<text class="ax" x="${PAD_L - 6}" y="${y(yMax * f) + 4}" text-anchor="end">${Math.round(yMax * f)}</text>`).join('');
  const limitLine = limit !== undefined && limit <= yMax
    ? `<line class="limit" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(limit)}" y2="${y(limit)}"/><text class="ax lim" x="${W - PAD_R}" y="${y(limit) - 4}" text-anchor="end">your limit ${limit} ${unit}</text>` : '';
  const last = series[series.length - 1];
  $(id).innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="tl">
      ${bandRects(H)}${grid}${limitLine}
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      <text class="lbl" x="${x(last.t) - 4}" y="${y(last.v) - 6}" text-anchor="end" fill="${color}">${title} ${last.v} ${unit}</text>
      <line id="${id}-cursor" class="cursor" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
      <line id="${id}-dep" class="dep" x1="0" x2="0" y1="0" y2="${H}"/>
      ${id === 'wind-chart' ? `<text class="ax" x="${x(9 * 60 + 20)}" y="${H - 8}" text-anchor="middle">slack 09:20</text>` : ''}
      ${axisHours()}
    </svg>`;
}
function initConditions() {
  lineChart('wind-chart', manasquan.forecast.map(h => ({ t: toMin(h.time), v: h.wind_kn })), 20, 'kt', 'var(--wind)', 'wind', manasquan.limits.max_wind_kn);
  lineChart('seas-chart', manasquan.forecast.map(h => ({ t: toMin(h.time), v: h.seas_ft })), 5, 'ft', 'var(--seas)', 'seas', manasquan.limits.max_seas_ft);
  const tip = $('tip');
  for (const cid of ['wind-chart', 'seas-chart']) {
    const el = $(cid);
    el.addEventListener('mousemove', (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const min = Math.round((T0 + ((ev.clientX - r.left) / r.width) * (T1 - T0)) / 60) * 60;
      const h = manasquan.forecast.find(f => toMin(f.time) === min);
      if (!h) return;
      tip.style.display = 'block';
      tip.style.left = `${ev.clientX + 12}px`; tip.style.top = `${ev.clientY + 12}px`;
      tip.innerHTML = `<b>${fmtTime(h.time)}</b> · wind ${h.wind_kn} kt ${cardinal(h.wind_from_deg)} (g ${h.gust_kn}) · seas ${h.seas_ft} ft`;
      for (const c of ['wind-chart', 'seas-chart']) {
        const cur = document.getElementById(`${c}-cursor`)!;
        cur.setAttribute('x1', String(x(min))); cur.setAttribute('x2', String(x(min)));
        cur.setAttribute('visibility', 'visible');
      }
    });
    el.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      for (const c of ['wind-chart', 'seas-chart']) document.getElementById(`${c}-cursor`)!.setAttribute('visibility', 'hidden');
    });
  }
}
function renderPassage(min: number) {
  const iso = `2026-08-04T${minToLabel(min)}-04:00`;
  const isRec = min === recMin;
  const ev = isRec ? rec.recommendation : evaluateDeparture(manasquan, iso);
  $('dep-time').textContent = minToLabel(min);
  $('arr-time').textContent = `arrive ~${fmtTime(ev.arrive_at)}`;
  const badge = $('verdict');
  if (isRec) { badge.className = 'badge go'; badge.textContent = `RECOMMENDED · confidence ${rec.confidence}`; }
  else if (ev.within_limits) { badge.className = 'badge ok'; badge.textContent = 'WITHIN YOUR LIMITS · not the best window'; }
  else { badge.className = 'badge no'; badge.textContent = ev.inlet_state === 'rough' ? 'NOT RECOMMENDED · inlet rough at transit' : 'NOT RECOMMENDED · outside your limits'; }
  $('headline-reason').textContent = isRec
    ? rec.reasoning[0].detail
    : ev.inlet_state === 'rough'
      ? `${rough[0] ? `Ebb against the swell — inlet rough ${fmtTime(rough[0].from)}–${fmtTime(rough[0].until)}. ` : ''}Recommended window: ${minToLabel(recMin)}.`
      : `Underway max ${ev.max_wind_underway_kn} kt / ${ev.max_seas_underway_ft} ft seas. Recommended window: ${minToLabel(recMin)}.`;
  const f = ev.fuel.recommendation;
  $('fuel-req').textContent = `${f.fuel_required.value}`;
  $('fuel-avail').textContent = `${f.fuel_available.value} gal available under your ${Math.round(manasquan.vessel.reserve_frac * 100)}% reserve`;
  $('fuel-hours').textContent = `${f.hours_underway.value} h underway`;
  ($('fuel-fill') as HTMLElement).style.width = `${Math.min(100, (f.fuel_required.value / manasquan.vessel.usable_gal) * 100)}%`;
  ($('fuel-fill') as HTMLElement).style.background = f.margin_ok ? 'var(--wind)' : 'var(--bad)';
  ($('fuel-reserve') as HTMLElement).style.left = `${(f.fuel_available.value / manasquan.vessel.usable_gal) * 100}%`;
  $('fuel-margin').textContent = f.margin_ok ? `margin +${f.margin.value} gal` : `SHORT ${-f.margin.value} gal`;
  ($('fuel-margin') as HTMLElement).className = f.margin_ok ? 'margin ok' : 'margin no';
  if (isRec) renderExplanation(rec, $('why-body'));
  else $('why-body').innerHTML = `<div class="step"><span class="rule">evaluation</span><p>Inlet ${ev.inlet_state} at transit · max ${ev.max_wind_underway_kn} kt / ${ev.max_seas_underway_ft} ft · fuel ${f.fuel_required.value}/${f.fuel_available.value} gal · arrive ${fmtTime(ev.arrive_at)}</p><span class="src">same core, same rules — drag back to ${minToLabel(recMin)} for the full recommendation</span></div>`;
  for (const c of ['wind-chart', 'seas-chart']) {
    const dep = document.getElementById(`${c}-dep`);
    if (dep) { dep.setAttribute('x1', String(x(min))); dep.setAttribute('x2', String(x(min))); }
  }
}
const slider = $('slider') as HTMLInputElement;
slider.min = String(5 * 60 + 30); slider.max = String(12 * 60); slider.step = '30';
slider.value = String(recMin);
($('slider-rec-mark') as HTMLElement).style.left = `${((recMin - 330) / (720 - 330)) * 100}%`;
slider.addEventListener('input', () => { $('slider-label').textContent = minToLabel(+slider.value); renderPassage(+slider.value); });
$('slider-label').textContent = minToLabel(recMin);

// Bimini scenario shares the trip panel with Explore
let planScenario: 'manasquan' | 'bimini' = 'manasquan';
function applyPlanScenario() {
  const s = planScenario;
  show('panel-passage', s === 'manasquan');
  show('panel-trip', s === 'bimini');
  show('conditions-card', s === 'manasquan');
  if (s === 'manasquan') {
    chart.st.waypoints = [...MANASQUAN_WPS];
    chart.flyTo(-72.9, 40.7, 7.2);
    $('tide-line').textContent = tideReadout(0);
    renderPassage(+slider.value);
  } else {
    tripState = JSON.parse(JSON.stringify(t16Trip));
    speedChoice = 'best_economy';
    ($('free-vessel') as HTMLSelectElement).value = 'builtin-t16';
    chart.st.waypoints = [...t16Trip.waypoints];
    chart.flyTo(-79.9, 25.5, 7.6);
    $('tide-line').textContent = tideReadout(1);
    renderTrip();
  }
  chart.render();
}
($('scenario') as HTMLSelectElement).addEventListener('change', (e) => {
  planScenario = (e.target as HTMLSelectElement).value as any;
  applyPlanScenario();
});

function tideReadout(i: number): string {
  const t = (livePack.tides as any[])[i];
  return t ? `Tides ${t.name} (${t.date}, CO-OPS ${t.station}): ${t.events.map((e: any) => `${e.type} ${e.t}`).join(' · ')} · fetched ${livePack.built_at}` : '';
}

// ================= Tabs =================

type Tab = 'explore' | 'plan' | 'vessel';
let tab: Tab = 'explore';
function setTab(t: Tab) {
  tab = t;
  for (const id of ['explore', 'plan', 'vessel']) {
    $(`tab-${id}`).classList.toggle('on', id === t);
    show(`view-${id}`, id === t);
  }
  if (t === 'explore') {
    show('panel-trip', true);
    show('trip-wx-card', true);
    show('conditions-card', false);
    chart.st.waypoints = tripStateFreeWaypoints();
    $('tide-line').textContent = '';
    restoring = true; onRouteChange(); restoring = false;
    chart.render();
  } else if (t === 'plan') {
    show('trip-wx-card', false);
    applyPlanScenario();
  } else {
    show('trip-wx-card', false);
    show('conditions-card', false);
    renderVesselList();
  }
}
let freeWaypointsCache: any[] = [];
function tripStateFreeWaypoints() {
  const saved = engine.get('plan', 'free-plan') as any;
  freeWaypointsCache = saved?.waypoints ?? freeWaypointsCache;
  return [...freeWaypointsCache];
}
$('tab-explore').addEventListener('click', () => setTab('explore'));
$('tab-plan').addEventListener('click', () => setTab('plan'));
$('tab-vessel').addEventListener('click', () => setTab('vessel'));

// ================= Vintage chips =================

$('vintage').innerHTML = [
  `obs/tides: NOAA · fetched ${livePack.built_at}`,
  `piracy: IMB 2025 snapshot`,
  `demo forecast for sample scenarios`,
].map(v => `<span class="chip">${esc(v)}</span>`).join('');

// ================= Boot =================

initConditions();
renderPassage(recMin);
refreshVesselSelect();
applyVesselChoice();
setTab('explore');
sizeCanvas();
makeStore().then(async (st) => {
  store = st;
  const snap = await st.load();
  if (snap) engine = SyncEngine.fromSnapshot(snap, { now: () => Date.now() });
  syncChip();
  refreshVesselSelect();
  refreshObstacles();
  const saved = engine.get('plan', 'free-plan') as any;
  if (saved?.vessel) { ($('free-vessel') as HTMLSelectElement).value = saved.vessel; }
  applyVesselChoice();
  if (tab === 'explore' && saved?.waypoints?.length) {
    restoring = true;
    chart.st.waypoints = [...saved.waypoints];
    onRouteChange();
    restoring = false;
    chart.render();
  }
});
