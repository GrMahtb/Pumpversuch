'use strict';

console.log('HTB Pumpversuch app.js v28 loaded');

const BASE = '/Pumpversuch/';
const STORAGE_DRAFT = 'htb-pumpversuch-draft-v13';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v13';
const HISTORY_MAX = 30;

const DEFAULT_INTERVALLE = [0, 1, 2, 3, 4, 5, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

const $ = (id) => document.getElementById(id);

const state = {
  meta: {
    objekt: '',
    grundstueck: '',
    ort: '',
    geologie: '',
    auftragsnummer: '',
    bauleitung: '',
    bohrmeister: '',
    koordination: '',
    geprueftDurch: '',
    geprueftAm: ''
  },
  selection: { foerder: true, schluck: true },
  foerder: { dm: '', endteufe: '', ruhe: '' },
  schluck: { dm: '', endteufe: '', ruhe: '' },
  versuche: []
};

const timerMap = {};
let _saveT = null;
let _liveT = null;

/* ───────────────── helpers ───────────────── */
function uid() {
  return crypto?.randomUUID?.() || ('id_' + Date.now() + '_' + Math.random().toString(16).slice(2));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function h(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pdfSafe(v) {
  return String(v ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[•→]/g, '-')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function fmtComma(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
}

function fmtMaybe(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
}

function fmtSci(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const [m, e] = n.toExponential(digits).split('e');
  return `${m.replace('.', ',')}e${Number(e)}`;
}

function fmtKf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 0.001) return `${fmtComma(n, 6)} m/s`;
  return `${fmtSci(n, 2)} m/s`;
}

function dateTag(d = new Date()) {
  return String(d.getDate()).padStart(2, '0') +
         String(d.getMonth() + 1).padStart(2, '0') +
         String(d.getFullYear());
}

function dateDE(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function formatTimeHHMMSS(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function parseIntervalStr(str) {
  return [...new Set(
    String(str || '').split(',')
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isFinite(n) && n >= 0)
  )].sort((a, b) => a - b);
}

function m3hToLs(v) {
  const n = Number(v);
  return Number.isFinite(n) ? (n / 3.6).toFixed(3) : '';
}

function calcDelta(messwert, ruhe) {
  const m = Number(messwert);
  const r = Number(ruhe);
  if (!Number.isFinite(m) || !Number.isFinite(r) || String(messwert).trim() === '') return '';
  return (m - r).toFixed(3);
}

function getVersuchById(id) {
  return state.versuche.find(v => v.id === id);
}

function getStageTitle(idx) {
  return `Stufe ${idx + 1}`;
}

function getSelectedWells() {
  return { foerder: !!state.selection.foerder, schluck: !!state.selection.schluck };
}

function getWellLabel(key) {
  return key === 'foerder' ? 'Förderbrunnen' : 'Schluckbrunnen';
}

function syncIntervalleStrFromRows(v) {
  v.intervalleStr = (v.messungen || [])
    .map(m => Number(m.min))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
    .join(', ');
}

function sortMessungen(v) {
  v.messungen.sort((a, b) => {
    const av = Number(a.min), bv = Number(b.min);
    const af = Number.isFinite(av), bf = Number.isFinite(bv);
    if (af && bf) return av - bv;
    if (af) return -1;
    if (bf) return 1;
    return 0;
  });
  syncIntervalleStrFromRows(v);
}

function getManualRateM3hNumber(v) {
  const n = Number(v?.manualRateM3h);
  return Number.isFinite(n) ? n : NaN;
}

function getEffectiveRateM3h(v) {
  const n = getManualRateM3hNumber(v);
  return Number.isFinite(n) ? n.toFixed(3) : '';
}

function getEffectiveRateLs(v) {
  const m3h = getManualRateM3hNumber(v);
  return Number.isFinite(m3h) ? (m3h / 3.6).toFixed(3) : '';
}

function getAverageFoerderMengeNumber(v) {
  const values = (v.messungen || [])
    .filter(m =>
      String(m.foerder_menge ?? '').trim() !== '' &&
      Number.isFinite(Number(m.foerder_menge))
    )
    .map(m => Number(m.foerder_menge));

  if (!values.length) return NaN;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function getAverageFoerderMenge(v) {
  const avg = getAverageFoerderMengeNumber(v);
  return Number.isFinite(avg) ? avg.toFixed(3) : '';
}

function getCalcRateM3hNumber(v) {
  const manual = getManualRateM3hNumber(v);
  if (Number.isFinite(manual) && manual > 0) return manual;

  const avg = getAverageFoerderMengeNumber(v);
  if (Number.isFinite(avg) && avg > 0) return avg;

  return NaN;
}

function getCalcRateM3h(v) {
  const n = getCalcRateM3hNumber(v);
  return Number.isFinite(n) ? n.toFixed(3) : '';
}

function getCalcRateLs(v) {
  const n = getCalcRateM3hNumber(v);
  return Number.isFinite(n) ? (n / 3.6).toFixed(3) : '';
}

function getCalcRateSource(v) {
  const manual = getManualRateM3hNumber(v);
  if (Number.isFinite(manual) && manual > 0) return 'manuelle Förderrate';

  const avg = getAverageFoerderMengeNumber(v);
  if (Number.isFinite(avg) && avg > 0) return 'Ø Fördermenge';

  return '';
}

function getContinueStep(v) {
  const rows = (v.messungen || []).slice().sort((a, b) => Number(a.min) - Number(b.min));
  if (rows.length >= 2) {
    const step = Number(rows[rows.length - 1].min) - Number(rows[rows.length - 2].min);
    if (Number.isFinite(step) && step > 0) return step;
  }
  return 15;
}

function getRowsForExport(v) {
  return clone(v.messungen || []).sort((a, b) => {
    const av = Number(a.min), bv = Number(b.min);
    if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
    return Number.isFinite(av) ? -1 : 1;
  });
}

function scheduleLiveRender() {
  clearTimeout(_liveT);
  _liveT = setTimeout(() => renderLiveTab(), 90);
}

/* ───────────────── Kf / Diagramm helpers ───────────────── */
function getDisplacementCm(raw, ruhe) {
  const m = Number(raw);
  const r = Number(ruhe);
  if (!Number.isFinite(m) || !Number.isFinite(r) || String(raw ?? '').trim() === '') return NaN;
  return Math.abs((m - r) * 100);
}

function getProcessHeadChangeM(raw, ruhe, key) {
  const m = Number(raw);
  const r = Number(ruhe);
  if (!Number.isFinite(m) || !Number.isFinite(r) || String(raw ?? '').trim() === '') return NaN;
  return key === 'foerder' ? (m - r) : (r - m);
}

function getWellChartPoints(versuch, key, brunnen) {
  const field = key === 'foerder' ? 'foerder_m' : 'schluck_m';
  const ruhe = Number(brunnen?.ruhe);

  return getRowsForExport(versuch)
    .map(row => ({ x: Number(row.min), y: getDisplacementCm(row[field], ruhe) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
}

function niceNum(range, round) {
  if (!Number.isFinite(range) || range <= 0) return 1;

  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * Math.pow(10, exponent);
}

function getNiceAxis(minVal, maxVal, ticks = 6) {
  let min = Number.isFinite(minVal) ? minVal : 0;
  let max = Number.isFinite(maxVal) ? maxVal : 1;

  if (min === max) {
    if (min === 0) max = 1;
    else {
      min = Math.min(0, min);
      max = max * 1.1;
    }
  }

  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(2, ticks - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  return { min: niceMin, max: niceMax, step };
}

function buildTicks(axis) {
  const ticks = [];
  for (let v = axis.min; v <= axis.max + axis.step / 2; v += axis.step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function fmtAxisTick(v, decimals = 0) {
  if (!Number.isFinite(v)) return '—';
  return String(Number(v.toFixed(decimals))).replace('.', ',');
}

function estimateRowKfDupuitSichardt({ qM3h, dmMm, endteufe, ruhe, dyn, key }) {
  const Q = Number(qM3h) / 3600;
  const rw = Number(dmMm) / 2000;
  const ET = Number(endteufe);
  const RWS = Number(ruhe);
  const dynLevel = Number(dyn);

  if (![Q, rw, ET, RWS, dynLevel].every(Number.isFinite)) return NaN;
  if (Q <= 0 || rw <= 0 || ET <= 0) return NaN;

  const H0 = ET - RWS;
  const Hd = ET - dynLevel;
  const s = key === 'foerder' ? (dynLevel - RWS) : (RWS - dynLevel);

  if (!Number.isFinite(H0) || !Number.isFinite(Hd) || !Number.isFinite(s)) return NaN;
  if (H0 <= 0 || Hd <= 0 || s <= 0) return NaN;

  const denom = key === 'foerder'
    ? (H0 * H0 - Hd * Hd)
    : (Hd * Hd - H0 * H0);

  if (!(denom > 0)) return NaN;

  let k = 1e-4;

  for (let i = 0; i < 40; i++) {
    const R = Math.max(rw * 20, 3000 * s * Math.sqrt(Math.max(k, 1e-12)));
    const ln = Math.log(R / rw);
    if (!(ln > 0)) return NaN;

    const kNew = (Q * ln) / (Math.PI * denom);
    if (!Number.isFinite(kNew) || kNew <= 0) return NaN;

    if (Math.abs(kNew - k) / k < 1e-6) {
      k = kNew;
      break;
    }
    k = kNew;
  }

  return Number.isFinite(k) && k > 0 ? k : NaN;
}

function getStageKfEstimate(versuch, key, brunnen) {
  const rateM3h = getCalcRateM3hNumber(versuch);
  if (!Number.isFinite(rateM3h) || rateM3h <= 0) {
    return {
      kf: NaN,
      used: 0,
      total: 0,
      reason: 'Keine gültige Förderrate vorhanden'
    };
  }

  const field = key === 'foerder' ? 'foerder_m' : 'schluck_m';
  const series = getRowsForExport(versuch)
    .map(row => {
      const min = Number(row.min);
      const raw = row[field];
      const kf = estimateRowKfDupuitSichardt({
        qM3h: rateM3h,
        dmMm: brunnen?.dm,
        endteufe: brunnen?.endteufe,
        ruhe: brunnen?.ruhe,
        dyn: raw,
        key
      });

      const s = getProcessHeadChangeM(raw, brunnen?.ruhe, key);

      if (!Number.isFinite(kf) || !Number.isFinite(min) || !Number.isFinite(s) || s <= 0) return null;
      return { min, kf, s };
    })
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);

  if (!series.length) {
    return {
      kf: NaN,
      used: 0,
      total: 0,
      reason: 'Noch keine auswertbaren Messpunkte'
    };
  }

  const tail = series.length >= 4 ? series.slice(Math.floor(series.length / 2)) : series;
  const weights = tail.map(p => Math.max(1, p.min || 1));
  const sumW = weights.reduce((a, b) => a + b, 0);

  const logMean = Math.exp(
    tail.reduce((sum, item, idx) => sum + Math.log(item.kf) * weights[idx], 0) / sumW
  );

  const minK = Math.min(...tail.map(x => x.kf));
  const maxK = Math.max(...tail.map(x => x.kf));
  const spread = maxK / minK;

  let quality = 'gering';
  if (tail.length >= 4 && spread <= 3) quality = 'gut';
  else if (tail.length >= 3 && spread <= 10) quality = 'mittel';

  return {
    kf: logMean,
    used: tail.length,
    total: series.length,
    minK,
    maxK,
    spread,
    quality,
    rateM3h,
    rateSource: getCalcRateSource(versuch),
    method: 'Dupuit/Thiem + Sichardt (iterativ)'
  };
}

/* ───────────────── defaults ───────────────── */
function defaultMessung(min) {
  return { min, foerder_m: '', schluck_m: '', foerder_menge: '' };
}

function defaultVersuch() {
  const ints = [...DEFAULT_INTERVALLE];
  return {
    id: uid(),
    manualRateM3h: '',
    startzeit: '',
    elapsedMs: 0,
    intervalleStr: ints.join(', '),
    messungen: ints.map(min => defaultMessung(min))
  };
}

function hydrateVersuch(v) {
  const base = defaultVersuch();
  const ints = v?.intervalleStr ? parseIntervalStr(v.intervalleStr) : [...DEFAULT_INTERVALLE];
  const existing = Array.isArray(v?.messungen) ? v.messungen : [];

  return {
    ...base,
    ...v,
    elapsedMs: Number(v?.elapsedMs || 0),
    intervalleStr: ints.join(', '),
    messungen: ints.map(min => {
      const hit = existing.find(m => Number(m.min) === Number(min));
      return hit ? {
        min,
        foerder_m: hit.foerder_m ?? '',
        schluck_m: hit.schluck_m ?? '',
        foerder_menge: hit.foerder_menge ?? ''
      } : defaultMessung(min);
    })
  };
}

/* ───────────────── sync ui ───────────────── */
const META_FIELDS = [
  ['meta-objekt', 'objekt'],
  ['meta-grundstueck', 'grundstueck'],
  ['meta-ort', 'ort'],
  ['meta-geologie', 'geologie'],
  ['meta-auftragsnummer', 'auftragsnummer'],
  ['meta-bauleitung', 'bauleitung'],
  ['meta-bohrmeister', 'bohrmeister'],
  ['meta-koordination', 'koordination'],
  ['meta-geprueftDurch', 'geprueftDurch'],
  ['meta-geprueftAm', 'geprueftAm']
];

const BRUNNEN_FIELDS = [
  ['foerder-dm', 'foerder', 'dm'],
  ['foerder-endteufe', 'foerder', 'endteufe'],
  ['foerder-ruhe', 'foerder', 'ruhe'],
  ['schluck-dm', 'schluck', 'dm'],
  ['schluck-endteufe', 'schluck', 'endteufe'],
  ['schluck-ruhe', 'schluck', 'ruhe']
];

function syncMetaToUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id);
    if (el) el.value = state.meta[key] || '';
  });
}

function syncBrunnenToUi() {
  BRUNNEN_FIELDS.forEach(([id, group, key]) => {
    const el = $(id);
    if (el) el.value = state[group][key] || '';
  });
}

function syncSelectionToUi() {
  if ($('sel-foerder')) $('sel-foerder').checked = !!state.selection.foerder;
  if ($('sel-schluck')) $('sel-schluck').checked = !!state.selection.schluck;
  updateBrunnenVisibility();
}

function updateBrunnenVisibility() {
  if ($('box-foerder')) $('box-foerder').hidden = !state.selection.foerder;
  if ($('box-schluck')) $('box-schluck').hidden = !state.selection.schluck;
}

function collectMetaFromUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id);
    if (el) state.meta[key] = el.value || '';
  });
}

function collectBrunnenFromUi() {
  BRUNNEN_FIELDS.forEach(([id, group, key]) => {
    const el = $(id);
    if (el) state[group][key] = el.value || '';
  });
}

function collectSelectionFromUi() {
  const foerder = !!$('sel-foerder')?.checked;
  const schluck = !!$('sel-schluck')?.checked;

  if (!foerder && !schluck) {
    state.selection.foerder = true;
    state.selection.schluck = false;
    syncSelectionToUi();
    alert('Mindestens ein Brunnen muss ausgewählt sein.');
    return false;
  }

  state.selection.foerder = foerder;
  state.selection.schluck = schluck;
  updateBrunnenVisibility();
  return true;
}

/* ───────────────── draft / history ───────────────── */
function collectSnapshot() {
  collectMetaFromUi();
  collectBrunnenFromUi();
  collectSelectionFromUi();

  return {
    v: 13,
    meta: clone(state.meta),
    selection: clone(state.selection),
    foerder: clone(state.foerder),
    schluck: clone(state.schluck),
    versuche: clone(state.versuche)
  };
}

function applySnapshot(snapshot, render = true) {
  if (!snapshot) return;

  state.meta = { ...state.meta, ...(snapshot.meta || {}) };
  state.selection = { ...state.selection, ...(snapshot.selection || {}) };
  state.foerder = { ...state.foerder, ...(snapshot.foerder || {}) };
  state.schluck = { ...state.schluck, ...(snapshot.schluck || {}) };
  state.versuche = Array.isArray(snapshot.versuche) && snapshot.versuche.length
    ? snapshot.versuche.map(v => hydrateVersuch(v))
    : [];

  Object.keys(timerMap).forEach(hardStopTimer);

  if (render) {
    syncMetaToUi();
    syncBrunnenToUi();
    syncSelectionToUi();
    renderVersuche();
    renderLiveTab();
  }
}

function saveDraftDebounced() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_DRAFT, JSON.stringify(collectSnapshot()));
    } catch {}
  }, 250);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (raw) applySnapshot(JSON.parse(raw), true);
  } catch {}
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
  } catch {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {}
}

function saveCurrentToHistory() {
  const snap = collectSnapshot();
  const entry = {
    id: uid(),
    savedAt: Date.now(),
    title: `${snap.meta.objekt || '—'} · ${snap.meta.ort || '—'}`,
    snapshot: snap
  };

  const list = readHistory();
  list.unshift(entry);
  writeHistory(list);
  renderHistoryList();
}

/* ───────────────── tabs ───────────────── */
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.pane').forEach(p => {
        const on = p.id === `tab-${btn.dataset.tab}`;
        p.classList.toggle('is-active', on);
        p.hidden = !on;
      });

      if (btn.dataset.tab === 'verlauf') renderHistoryList();
      if (btn.dataset.tab === 'live') renderLiveTab();
    });
  });
}

/* ───────────────── render stages ───────────────── */
function buildTableHeadHtml() {
  const sel = getSelectedWells();
  let html = '<tr><th>Min</th>';
  if (sel.foerder) html += '<th class="th-foerder">Förderbrunnen m ab OK</th>';
  if (sel.schluck) html += '<th class="th-schluck">Schluckbrunnen m ab OK</th>';
  html += '<th class="th-menge">Fördermenge [m³/h]</th>';
  html += '</tr>';
  return html;
}

function buildTableRowHtml(v, row, rowIdx) {
  const sel = getSelectedWells();
  const isLast = rowIdx === v.messungen.length - 1;

  let html = `<tr data-row="${rowIdx}">`;

  html += `
    <td>
      <div class="minute-cell">
        <input class="mess-input minute-input" data-role="min" data-row="${rowIdx}"
          type="number" step="1" inputmode="numeric" value="${h(row.min)}" />
        ${isLast ? `<button class="row-plus" data-role="row-plus" data-row="${rowIdx}" type="button">+</button>` : ''}
      </div>
    </td>
  `;

  if (sel.foerder) {
    html += `
      <td>
        <input class="mess-input" data-role="foerder-m" data-row="${rowIdx}"
          type="number" step="0.001" inputmode="decimal" value="${h(row.foerder_m)}" />
      </td>
    `;
  }

  if (sel.schluck) {
    html += `
      <td>
        <input class="mess-input" data-role="schluck-m" data-row="${rowIdx}"
          type="number" step="0.001" inputmode="decimal" value="${h(row.schluck_m)}" />
      </td>
    `;
  }

  html += `
    <td>
      <input class="mess-input menge-input" data-role="foerder-menge" data-row="${rowIdx}"
        type="number" step="0.001" inputmode="decimal" value="${h(row.foerder_menge)}" />
    </td>
  `;

  html += `</tr>`;
  return html;
}

function buildVersuchHtml(v, idx) {
  const effLs = getEffectiveRateLs(v);
  const avgFoerderMenge = getAverageFoerderMenge(v);
  const rowsHtml = v.messungen.map((row, rowIdx) => buildTableRowHtml(v, row, rowIdx)).join('');

  return `
<details class="card card--collapsible versuch-card" data-vid="${h(v.id)}" open>
  <summary class="card__title">
    <span>${getStageTitle(idx)}</span>
  </summary>

  <div class="card__body versuch-body">
    <div class="versuch-row">
      <span class="rate-label">Förderrate [m³/h]</span>
      <input class="rate-input" data-role="manual-rate-m3h" type="number"
        step="0.001" inputmode="decimal" value="${h(v.manualRateM3h)}" />

      <span class="rate-unit">=</span>
      <span class="rate-conv" data-role="head-rate-ls">${effLs ? `${h(effLs)} l/s` : '—'}</span>

      <span class="rate-label">Ø Fördermenge [m³/h]</span>
      <input
        class="rate-input rate-input--readonly"
        data-role="avg-foerder-menge"
        type="text"
        value="${h(avgFoerderMenge || '—')}"
        readonly
      />
    </div>

    <div class="versuch-row">
      <span class="interval-label">Intervallzeile [min]</span>
      <input class="interval-input" data-role="intervalle" type="text" value="${h(v.intervalleStr)}" />
    </div>

    <div class="timer-box">
      <div class="timer-row">
        <div class="timer-display" data-role="elapsed">${formatElapsed(v.elapsedMs || 0)}</div>
        <div class="timer-buttons">
          <button class="timer-btn timer-btn--start" data-role="timer-start" type="button">Start</button>
          <button class="timer-btn timer-btn--stop"  data-role="timer-stop"  type="button">Stop</button>
          <button class="timer-btn timer-btn--ghost" data-role="timer-reset" type="button">Reset</button>
        </div>
      </div>

      <div class="timer-info" data-role="startzeit">
        ${v.startzeit ? `Startzeit: ${h(v.startzeit)}` : 'Noch nicht gestartet'}
      </div>
      <div class="timer-info timer-next" data-role="naechstes"></div>
    </div>

    <div class="table-wrap">
      <table class="mess-table">
        <thead>${buildTableHeadHtml()}</thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <div class="versuch-tools">
      <button class="del-btn" data-role="del" type="button">Stufe löschen</button>
    </div>
  </div>
</details>
`;
}

function renderVersuche() {
  const host = $('versucheContainer');
  if (!host) return;

  if (!state.versuche.length) {
    host.innerHTML = `
<div class="empty-state">
  Noch keine Pumpstufe angelegt.<br />
  Bitte über den Plus-Button eine neue Stufe hinzufügen.
</div>`;
    return;
  }

  host.innerHTML = state.versuche.map((v, idx) => buildVersuchHtml(v, idx)).join('');

  document.querySelectorAll('.versuch-card').forEach(card => {
    const v = getVersuchById(card.dataset.vid);
    if (v) {
      updateStageRateDisplay(card, v);
      updateTimerUi(card, v);
    }
  });
}

/* ───────────────── timer ───────────────── */
function ensureTimer(vid, versuch) {
  if (!timerMap[vid]) {
    const elapsedMin = Number(versuch?.elapsedMs || 0) / 60000;
    const mins = (versuch.messungen || [])
      .map(m => Number(m.min))
      .filter(n => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);

    timerMap[vid] = {
      running: false,
      startMs: 0,
      accumulatedMs: Number(versuch?.elapsedMs || 0),
      raf: null,
      alarmCount: mins.filter(iv => iv > 0 && elapsedMin >= iv).length
    };
  }
  return timerMap[vid];
}

function getElapsedMs(vid, versuch) {
  const t = timerMap[vid];
  if (!t) return Number(versuch?.elapsedMs || 0);
  return t.running ? t.accumulatedMs + (Date.now() - t.startMs) : t.accumulatedMs;
}

function updateTimerUi(card, versuch) {
  if (!card || !versuch) return;

  const vid = versuch.id;
  const t = ensureTimer(vid, versuch);
  const elapsedMs = getElapsedMs(vid, versuch);

  versuch.elapsedMs = elapsedMs;

  const elapsedEl = card.querySelector('[data-role="elapsed"]');
  const startBtn = card.querySelector('[data-role="timer-start"]');
  const stopBtn = card.querySelector('[data-role="timer-stop"]');
  const startZeitEl = card.querySelector('[data-role="startzeit"]');
  const nextEl = card.querySelector('[data-role="naechstes"]');

  if (elapsedEl) elapsedEl.textContent = formatElapsed(elapsedMs);
  if (startZeitEl) startZeitEl.textContent = versuch.startzeit ? `Startzeit: ${versuch.startzeit}` : 'Noch nicht gestartet';

  if (startBtn) {
    startBtn.textContent = t.running ? 'Läuft' : (versuch.elapsedMs > 0 ? 'Weiter' : 'Start');
    startBtn.disabled = t.running;
  }

  if (stopBtn) stopBtn.disabled = !t.running;

  const mins = (versuch.messungen || [])
    .map(m => Number(m.min))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  const elapsedMin = elapsedMs / 60000;
  const nextIv = mins.filter(iv => iv > 0).find(iv => elapsedMin < iv);

  if (nextEl) {
    nextEl.textContent = nextIv !== undefined
      ? `Nächste Messung: ${nextIv} min (in ${Math.max(0, Math.ceil((nextIv * 60000 - elapsedMs) / 1000))}s)`
      : 'Alle Messintervalle erreicht';
  }

  card.querySelectorAll('tbody tr').forEach(r => r.classList.remove('row-active'));

  const passed = mins.filter(iv => elapsedMin >= iv);
  const lastPassed = passed.length ? passed[passed.length - 1] : mins[0];
  const rowIdx = versuch.messungen.findIndex(m => Number(m.min) === Number(lastPassed));

  if (rowIdx >= 0) {
    card.querySelector(`tr[data-row="${rowIdx}"]`)?.classList.add('row-active');
  }
}

function tickTimer(vid) {
  const versuch = getVersuchById(vid);
  const t = timerMap[vid];
  if (!versuch || !t || !t.running) return;

  const card = document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  if (!card) return;

  versuch.elapsedMs = getElapsedMs(vid, versuch);
  updateTimerUi(card, versuch);

  const mins = (versuch.messungen || [])
    .map(m => Number(m.min))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const passedCount = mins.filter(iv => versuch.elapsedMs / 60000 >= iv).length;
  if (passedCount > t.alarmCount) {
    t.alarmCount = passedCount;
    if ('vibrate' in navigator) navigator.vibrate([120, 80, 120]);
  }

  t.raf = requestAnimationFrame(() => tickTimer(vid));
}

function startTimer(vid) {
  const versuch = getVersuchById(vid);
  if (!versuch) return;

  const t = ensureTimer(vid, versuch);
  if (t.running) return;

  if (!versuch.startzeit) versuch.startzeit = formatTimeHHMMSS(new Date());

  const mins = (versuch.messungen || [])
    .map(m => Number(m.min))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  t.alarmCount = mins.filter(iv => iv > 0 && t.accumulatedMs / 60000 >= iv).length;
  t.running = true;
  t.startMs = Date.now();

  const card = document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card, versuch);
  tickTimer(vid);
  saveDraftDebounced();
}

function stopTimer(vid) {
  const versuch = getVersuchById(vid);
  const t = timerMap[vid];
  if (!versuch || !t || !t.running) return;

  t.accumulatedMs += (Date.now() - t.startMs);
  versuch.elapsedMs = t.accumulatedMs;
  t.running = false;

  if (t.raf) cancelAnimationFrame(t.raf);
  t.raf = null;

  const card = document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card, versuch);
  saveDraftDebounced();
}

function resetTimer(vid) {
  const versuch = getVersuchById(vid);
  if (!versuch) return;

  const t = ensureTimer(vid, versuch);

  if (t.raf) cancelAnimationFrame(t.raf);
  t.running = false;
  t.startMs = 0;
  t.accumulatedMs = 0;
  t.raf = null;
  t.alarmCount = 0;

  versuch.elapsedMs = 0;
  versuch.startzeit = '';

  const card = document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card, versuch);
  saveDraftDebounced();
}

function hardStopTimer(vid) {
  const t = timerMap[vid];
  if (!t) return;
  try {
    if (t.raf) cancelAnimationFrame(t.raf);
  } catch {}
  delete timerMap[vid];
}

/* ───────────────── stage header computed ───────────────── */
function updateStageRateDisplay(card, versuch) {
  const effLs = getEffectiveRateLs(versuch);
  const avgFoerderMenge = getAverageFoerderMenge(versuch);

  const lsEl = card.querySelector('[data-role="head-rate-ls"]');
  const avgEl = card.querySelector('[data-role="avg-foerder-menge"]');

  if (lsEl) lsEl.textContent = effLs ? `${effLs} l/s` : '—';
  if (avgEl) avgEl.value = avgFoerderMenge || '—';
}

/* ───────────────── live tab ───────────────── */
function buildLiveChartSvg(points, key) {
  const color = key === 'foerder' ? '#56b7ff' : '#ffb45a';
  const W = 560;
  const H = 280;
  const ml = 58;
  const mr = 18;
  const mt = 18;
  const mb = 42;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const xMaxData = points.length ? Math.max(...points.map(p => p.x)) : 10;
  const yMaxData = points.length ? Math.max(...points.map(p => p.y)) : 10;

  const xAxis = getNiceAxis(0, xMaxData > 0 ? xMaxData : 10, 6);
  const yAxis = getNiceAxis(0, yMaxData > 0 ? yMaxData : 10, 6);

  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);

  const tx = (v) => ml + ((v - xAxis.min) / (xAxis.max - xAxis.min || 1)) * pw;
  const ty = (v) => mt + ph - ((v - yAxis.min) / (yAxis.max - yAxis.min || 1)) * ph;

  const gridY = yTicks.map(v => `
    <line x1="${ml}" y1="${ty(v)}" x2="${W - mr}" y2="${ty(v)}" stroke="rgba(255,255,255,.12)" stroke-width="1" />
    <text x="${ml - 8}" y="${ty(v) + 4}" text-anchor="end" fill="rgba(220,240,255,.75)" font-size="11">${h(fmtAxisTick(v, 0))}</text>
  `).join('');

  const gridX = xTicks.map(v => `
    <line x1="${tx(v)}" y1="${mt}" x2="${tx(v)}" y2="${mt + ph}" stroke="rgba(255,255,255,.08)" stroke-width="1" />
    <text x="${tx(v)}" y="${H - 16}" text-anchor="middle" fill="rgba(220,240,255,.75)" font-size="11">${h(fmtAxisTick(v, 0))}</text>
  `).join('');

  const polyPoints = points.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ');
  const circles = points.map(p => `
    <circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1.2" />
  `).join('');

  return `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Diagramm">
  <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#0b1725" />
  ${gridY}
  ${gridX}
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2" />
  <line x1="${ml}" y1="${mt + ph}" x2="${W - mr}" y2="${mt + ph}" stroke="rgba(255,255,255,.35)" stroke-width="1.2" />
  <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="rgba(255,255,255,.35)" stroke-width="1.2" />
  ${points.length ? `<polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />` : ''}
  ${circles}
  <text x="${ml + pw / 2}" y="${H - 4}" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700">Zeit [min]</text>
  <text x="16" y="${mt + ph / 2}" transform="rotate(-90 16 ${mt + ph / 2})" text-anchor="middle" fill="#ffffff" font-size="12" font-weight="700">Absenkung [cm]</text>
  ${!points.length ? `<text x="${ml + pw / 2}" y="${mt + ph / 2}" text-anchor="middle" fill="rgba(220,240,255,.72)" font-size="13">Noch keine Messwerte</text>` : ''}
</svg>`;
}

function buildLiveWellPanelHtml(versuch, idx, key, brunnen) {
  const est = getStageKfEstimate(versuch, key, brunnen);
  const points = getWellChartPoints(versuch, key, brunnen);
  const title = getWellLabel(key);
  const wellCls = key === 'foerder' ? 'live-well--foerder' : 'live-well--schluck';

  const qClass = est.quality ? `kf-quality kf-quality--${est.quality}` : '';
  const qualityText = est.quality === 'gut'
    ? 'stabil'
    : est.quality === 'mittel'
      ? 'mittel'
      : 'vorläufig';

  return `
    <section class="live-well ${wellCls}">
      <div class="live-well__head">
        <div>
          <div class="live-well__title">${h(title)}</div>
          <div class="live-well__sub">
            Ø ${h(fmtMaybe(brunnen?.dm, 0))} mm ·
            ET ${h(fmtMaybe(brunnen?.endteufe, 2))} m ·
            RW ${h(fmtMaybe(brunnen?.ruhe, 3))} m
          </div>
        </div>

        <div class="kf-box">
          <div class="kf-box__label">Kf-Abschätzung</div>
          <div class="kf-box__value">${Number.isFinite(est.kf) ? h(fmtKf(est.kf)) : '—'}</div>
          <div class="kf-box__note">
            ${
              Number.isFinite(est.kf)
                ? `Basis: ${h(est.rateSource || 'Rate')} · ${h(fmtMaybe(est.rateM3h, 3))} m³/h · ${h(String(est.used))} Messpunkte`
                : h(est.reason || 'Noch keine Auswertung möglich')
            }
          </div>
          ${Number.isFinite(est.kf) ? `<div class="${qClass}">${h(qualityText)}</div>` : ''}
        </div>
      </div>

      <div class="live-chart">
        ${buildLiveChartSvg(points, key)}
      </div>
    </section>
  `;
}

function renderLiveTab() {
  const host = $('liveContainer');
  if (!host) return;

  if (!state.versuche.length) {
    host.innerHTML = `
      <section class="card">
        <div class="empty-state">
          Noch keine Pumpstufe vorhanden.<br />
          Bitte zuerst im Protokoll eine Pumpstufe anlegen.
        </div>
      </section>
    `;
    return;
  }

  const sel = getSelectedWells();

  host.innerHTML = state.versuche.map((v, idx) => {
    const rateM3h = getCalcRateM3h(v);
    const rateLs = getCalcRateLs(v);
    const rateSource = getCalcRateSource(v);

    return `
      <section class="card live-stage">
        <div class="live-stage__head">
          <div>
            <div class="live-stage__title">${h(getStageTitle(idx))}</div>
            <div class="live-stage__meta">
              Rate für Auswertung: <b>${h(rateM3h || '—')} m³/h</b> ·
              <b>${h(rateLs || '—')} l/s</b>
              ${rateSource ? ` · Quelle: ${h(rateSource)}` : ''}
            </div>
          </div>
        </div>

        <div class="live-grid">
          ${sel.foerder ? buildLiveWellPanelHtml(v, idx, 'foerder', state.foerder) : ''}
          ${sel.schluck ? buildLiveWellPanelHtml(v, idx, 'schluck', state.schluck) : ''}
        </div>
      </section>
    `;
  }).join('');
}

/* ───────────────── input hooks ───────────────── */
function hookStaticInputs() {
  META_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      collectMetaFromUi();
      saveDraftDebounced();
    });
    el.addEventListener('change', () => {
      collectMetaFromUi();
      saveDraftDebounced();
    });
  });

  BRUNNEN_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      collectBrunnenFromUi();
      saveDraftDebounced();
      scheduleLiveRender();
    });
    el.addEventListener('change', () => {
      collectBrunnenFromUi();
      saveDraftDebounced();
      scheduleLiveRender();
    });
  });

  $('sel-foerder')?.addEventListener('change', () => {
    if (!collectSelectionFromUi()) return;
    renderVersuche();
    renderLiveTab();
    saveDraftDebounced();
  });

  $('sel-schluck')?.addEventListener('change', () => {
    if (!collectSelectionFromUi()) return;
    renderVersuche();
    renderLiveTab();
    saveDraftDebounced();
  });
}

function hookVersuchDelegation() {
  const host = $('versucheContainer');
  if (!host || host.dataset.bound === '1') return;
  host.dataset.bound = '1';

  host.addEventListener('input', (e) => {
    const el = e.target.closest('[data-role]');
    if (!el) return;

    const card = el.closest('.versuch-card');
    if (!card) return;

    const versuch = getVersuchById(card.dataset.vid);
    if (!versuch) return;

    const role = el.dataset.role;
    const idx = Number(el.dataset.row);

    if (role === 'manual-rate-m3h') {
      versuch.manualRateM3h = el.value;
      updateStageRateDisplay(card, versuch);
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }

    if (role === 'min') {
      if (versuch.messungen[idx]) versuch.messungen[idx].min = el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }

    if (role === 'foerder-m') {
      if (versuch.messungen[idx]) versuch.messungen[idx].foerder_m = el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }

    if (role === 'schluck-m') {
      if (versuch.messungen[idx]) versuch.messungen[idx].schluck_m = el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }

    if (role === 'foerder-menge') {
      if (versuch.messungen[idx]) versuch.messungen[idx].foerder_menge = el.value;
      updateStageRateDisplay(card, versuch);
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
  });

  host.addEventListener('change', (e) => {
    const el = e.target.closest('[data-role]');
    if (!el) return;

    const card = el.closest('.versuch-card');
    if (!card) return;

    const versuch = getVersuchById(card.dataset.vid);
    if (!versuch) return;

    const role = el.dataset.role;

    if (role === 'intervalle') {
      const ints = parseIntervalStr(el.value);
      if (!ints.length) {
        alert('Bitte gültige Intervalle eingeben.');
        el.value = versuch.intervalleStr;
        return;
      }

      const old = Array.isArray(versuch.messungen) ? versuch.messungen : [];
      versuch.intervalleStr = ints.join(', ');
      versuch.messungen = ints.map(min => {
        const hit = old.find(m => Number(m.min) === Number(min));
        return hit || defaultMessung(min);
      });

      hardStopTimer(versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }

    if (role === 'min') {
      sortMessungen(versuch);
      hardStopTimer(versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
    }
  });

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;

    const card = btn.closest('.versuch-card');
    if (!card) return;

    const versuch = getVersuchById(card.dataset.vid);
    if (!versuch) return;

    const role = btn.dataset.role;

    if (role === 'row-plus') {
      sortMessungen(versuch);
      const step = getContinueStep(versuch);
      const last = versuch.messungen.length
        ? Number(versuch.messungen[versuch.messungen.length - 1].min)
        : 0;

      versuch.messungen.push(defaultMessung(Number.isFinite(last) ? last + step : step));
      syncIntervalleStrFromRows(versuch);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }

    if (role === 'del') {
      const idx = state.versuche.findIndex(v => v.id === versuch.id);
      if (!confirm(`${getStageTitle(idx)} wirklich löschen?`)) return;

      hardStopTimer(versuch.id);
      state.versuche = state.versuche.filter(v => v.id !== versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }

    if (role === 'timer-start') { startTimer(versuch.id); return; }
    if (role === 'timer-stop')  { stopTimer(versuch.id);  return; }
    if (role === 'timer-reset') { resetTimer(versuch.id); return; }
  });
}

/* ───────────────── history ui ───────────────── */
function buildHistoryKfHtml(snapshot) {
  const versuche = Array.isArray(snapshot?.versuche) ? snapshot.versuche : [];
  if (!versuche.length) return '';

  const lines = versuche.map((raw, idx) => {
    const v = hydrateVersuch(raw);
    const parts = [];
    if (snapshot.selection?.foerder) {
      const estF = getStageKfEstimate(v, 'foerder', snapshot.foerder || {});
      parts.push(`Förder: ${Number.isFinite(estF.kf) ? fmtKf(estF.kf) : '—'}`);
    }
    if (snapshot.selection?.schluck) {
      const estS = getStageKfEstimate(v, 'schluck', snapshot.schluck || {});
      parts.push(`Schluck: ${Number.isFinite(estS.kf) ? fmtKf(estS.kf) : '—'}`);
    }
    return `<div class="historyKf__line">${h(`${getStageTitle(idx)} · ${parts.join(' · ')}`)}</div>`;
  });

  return `
    <div class="historyKf">
      <div class="historyKf__title">Kf-Abschätzung</div>
      ${lines.join('')}
    </div>
  `;
}

function hookHistoryDelegation() {
  const host = $('historyList');
  if (!host || host.dataset.bound === '1') return;
  host.dataset.bound = '1';

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-hact]');
    if (!btn) return;

    const id = btn.dataset.id;
    const act = btn.dataset.hact;
    const list = readHistory();
    const entry = list.find(x => x.id === id);

    if (act === 'del') {
      writeHistory(list.filter(x => x.id !== id));
      renderHistoryList();
      return;
    }

    if (!entry) return;

    if (act === 'load') {
      applySnapshot(entry.snapshot, true);
      saveDraftDebounced();
      document.querySelector('.tab[data-tab="protokoll"]')?.click();
      return;
    }

    if (act === 'pdf') {
      try {
        await exportPdf(entry.snapshot);
      } catch (err) {
        console.error(err);
        alert('PDF-Fehler: ' + (err?.message || String(err)));
      }
    }
  });
}

function renderHistoryList() {
  const host = $('historyList');
  if (!host) return;

  const list = readHistory();
  if (!list.length) {
    host.innerHTML = `<div class="text"><p>Noch keine Protokolle gespeichert.</p></div>`;
    return;
  }

  host.innerHTML = list.map(entry => {
    const snap = entry.snapshot || {};
    const count = Array.isArray(snap.versuche) ? snap.versuche.length : 0;
    const wells = [];
    if (snap.selection?.foerder) wells.push('Förderbrunnen');
    if (snap.selection?.schluck) wells.push('Schluckbrunnen');

    return `
<div class="historyItem">
  <div class="historyTop">
    <span>${h(entry.title)}</span>
    <span style="color:var(--muted);font-size:.82em">${h(new Date(entry.savedAt).toLocaleString('de-DE'))}</span>
  </div>
  <div class="historySub">
    Objekt: <b>${h(snap.meta?.objekt || '—')}</b> · Ort: <b>${h(snap.meta?.ort || '—')}</b> ·
    Brunnen: <b>${h(wells.join(' / ') || '—')}</b> · Stufen: <b>${h(count)}</b>
  </div>
  ${buildHistoryKfHtml(snap)}
  <div class="historyBtns">
    <button type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
    <button type="button" data-hact="pdf"  data-id="${h(entry.id)}">PDF</button>
    <button type="button" data-hact="del"  data-id="${h(entry.id)}">Löschen</button>
  </div>
</div>
`;
  }).join('');
}

/* ───────────────── pdf ───────────────── */
function drawTextSafe(page, text, options) {
  page.drawText(pdfSafe(text), options);
}

function getPdfRateM3hNumber(v) {
  const manual = Number(v?.manualRateM3h);
  if (Number.isFinite(manual) && manual > 0) return manual;

  const avg = getAverageFoerderMengeNumber(v);
  if (Number.isFinite(avg) && avg > 0) return avg;

  return NaN;
}

function getPdfRateM3h(v) {
  const n = getPdfRateM3hNumber(v);
  return Number.isFinite(n) ? n.toFixed(3) : '—';
}

function getPdfRateLs(v) {
  const n = getPdfRateM3hNumber(v);
  return Number.isFinite(n) ? (n / 3.6).toFixed(3) : '—';
}

function getWellRowsForPdf(versuch, key, ruhe) {
  const field = key === 'foerder' ? 'foerder_m' : 'schluck_m';
  const ruheNum = Number(ruhe);

  return getRowsForExport(versuch).map(r => {
    const min = Number(r.min);
    const raw = r[field];
    const hasValue = String(raw ?? '').trim() !== '' && Number.isFinite(Number(raw));
    const valueNum = hasValue ? Number(raw) : null;

    const deltaM = (hasValue && Number.isFinite(ruheNum)) ? Math.abs(valueNum - ruheNum) : null;
    const deltaCm = deltaM !== null ? deltaM * 100 : null;

    return {
      min: Number.isFinite(min) ? min : null,
      valueNum,
      deltaM,
      deltaCm
    };
  });
}

function drawMetaGrid(page, x, yTop, w, rowH, meta, fontR, fontB, K) {
  const rows = [
    [['Objekt', meta.objekt || ''], ['Grundstück', meta.grundstueck || ''], ['Geprüft durch', meta.geprueftDurch || ''], ['Geprüft am', dateDE(meta.geprueftAm) || '']],
    [['Ort', meta.ort || ''], ['Auftragsnummer', meta.auftragsnummer || ''], ['Geologie', meta.geologie || ''], ['Bauleitung', meta.bauleitung || '']],
    [['Bohrmeister', meta.bohrmeister || ''], ['Koordination', meta.koordination || ''], ['', ''], ['', '']]
  ];

  rows.forEach((row, rIdx) => {
    const y = yTop - rowH * (rIdx + 1);
    page.drawRectangle({ x, y, width: w, height: rowH, borderColor: K, borderWidth: 0.7 });

    const cw = w / 4;

    for (let i = 1; i < 4; i++) {
      page.drawLine({
        start: { x: x + i * cw, y },
        end: { x: x + i * cw, y: y + rowH },
        thickness: 0.7,
        color: K
      });
    }

    row.forEach((cell, i) => {
      const cx = x + i * cw + 4;
      if (cell[0]) drawTextSafe(page, cell[0], { x: cx, y: y + rowH - 10, size: 7, font: fontB, color: K });
      if (cell[1]) drawTextSafe(page, cell[1], { x: cx, y: y + 4, size: 8, font: fontR, color: K });
    });
  });
}

function drawWellTable(page, opt) {
  const {
    x, yTop, w, key, rows, ruhe,
    fontR, fontB, K, grey
  } = opt;

  const title = key === 'foerder' ? 'Förderbrunnen' : 'Schluckbrunnen';
  const titleH = 13;
  const headH = 15;
  const rowH = 8.2;
  const totalH = titleH + headH + rows.length * rowH;

  page.drawRectangle({
    x, y: yTop - titleH, width: w, height: titleH,
    color: grey, borderColor: K, borderWidth: 0.7
  });

  drawTextSafe(page, `${title} · RW ${fmtComma(ruhe, 3)} m`, {
    x: x + 4, y: yTop - titleH + 3.8, size: 7.8, font: fontB, color: K
  });

  const yHead = yTop - titleH - headH;

  page.drawRectangle({
    x, y: yHead, width: w, height: headH,
    borderColor: K, borderWidth: 0.7
  });

  const colWidths = [0.18, 0.42, 0.40];
  const xs = [x];
  colWidths.forEach(cw => xs.push(xs[xs.length - 1] + w * cw));

  for (let i = 1; i < xs.length - 1; i++) {
    page.drawLine({
      start: { x: xs[i], y: yTop - totalH },
      end: { x: xs[i], y: yTop - titleH },
      thickness: 0.6,
      color: K
    });
  }

  drawTextSafe(page, 'Min', {
    x: xs[0] + 3, y: yHead + 5, size: 6.8, font: fontB, color: K
  });
  drawTextSafe(page, 'm ab OK Brunnen', {
    x: xs[1] + 3, y: yHead + 5, size: 6.8, font: fontB, color: K
  });
  drawTextSafe(page, 'Δ Ruhewasser [m]', {
    x: xs[2] + 3, y: yHead + 5, size: 6.8, font: fontB, color: K
  });

  let y = yHead;

  rows.forEach(r => {
    const nextY = y - rowH;

    page.drawLine({
      start: { x, y: nextY },
      end: { x: x + w, y: nextY },
      thickness: 0.6,
      color: K
    });

    drawTextSafe(page, Number.isFinite(r.min) ? String(r.min) : '—', {
      x: xs[0] + 3, y: nextY + 2.4, size: 6.7, font: fontR, color: K
    });

    drawTextSafe(page, r.valueNum !== null ? fmtComma(r.valueNum, 3) : '—', {
      x: xs[1] + 3, y: nextY + 2.4, size: 6.7, font: fontR, color: K
    });

    drawTextSafe(page, r.deltaM !== null ? fmtComma(r.deltaM, 3) : '—', {
      x: xs[2] + 3, y: nextY + 2.4, size: 6.7, font: fontR, color: K
    });

    y = nextY;
  });

  return totalH;
}

function drawWellChart(page, opt) {
  const {
    x, y, w, h, key, rows,
    fontR, fontB, K, grey, degrees, gridColor, lineColor
  } = opt;

  const title = key === 'foerder' ? 'Diagramm Förderbrunnen' : 'Diagramm Schluckbrunnen';

  page.drawRectangle({
    x, y, width: w, height: h,
    borderColor: K, borderWidth: 0.7
  });

  page.drawRectangle({
    x, y: y + h - 13, width: w, height: 13,
    color: grey, borderColor: K, borderWidth: 0.7
  });

  drawTextSafe(page, title, {
    x: x + 4, y: y + h - 9, size: 7.6, font: fontB, color: K
  });

  const plotPadL = 42;
  const plotPadR = 10;
  const plotPadT = 40;
  const plotPadB = 12;

  const px = x + plotPadL;
  const py = y + plotPadB;
  const pw = w - plotPadL - plotPadR;
  const ph = h - plotPadT - plotPadB;
  const plotTop = py + ph;

  const valid = rows.filter(r => Number.isFinite(r.min) && Number.isFinite(r.deltaCm));
  const maxXData = valid.length ? Math.max(...valid.map(p => p.min)) : 10;
  const maxYData = valid.length ? Math.max(...valid.map(p => p.deltaCm)) : 10;

  const xAxis = getNiceAxis(0, maxXData > 0 ? maxXData : 10, 6);
  const yAxis = getNiceAxis(0, maxYData > 0 ? maxYData : 10, 6);

  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);

  const tx = (v) => px + ((v - xAxis.min) / (xAxis.max - xAxis.min || 1)) * pw;
  const ty = (v) => py + ((v - yAxis.min) / (yAxis.max - yAxis.min || 1)) * ph;

  yTicks.forEach(v => {
    const yy = ty(v);
    page.drawLine({
      start: { x: px, y: yy },
      end: { x: px + pw, y: yy },
      thickness: 0.5,
      color: gridColor
    });
    drawTextSafe(page, fmtAxisTick(v, 0), {
      x: px - 22,
      y: yy - 2,
      size: 6.2,
      font: fontR,
      color: K
    });
  });

  xTicks.forEach(v => {
    const xx = tx(v);
    page.drawLine({
      start: { x: xx, y: py },
      end: { x: xx, y: py + ph },
      thickness: 0.5,
      color: gridColor
    });

    drawTextSafe(page, fmtAxisTick(v, 0), {
      x: xx - 6,
      y: plotTop + 4,
      size: 6.2,
      font: fontR,
      color: K
    });
  });

  page.drawRectangle({
    x: px, y: py, width: pw, height: ph,
    borderColor: K, borderWidth: 0.7
  });

  drawTextSafe(page, 'Zeit [min]', {
    x: px + pw / 2 - 18,
    y: plotTop + 16,
    size: 6.8,
    font: fontB,
    color: K
  });

  drawTextSafe(page, 'Absenkung [cm]', {
    x: x + 10,
    y: py + ph / 2 - 22,
    size: 6.8,
    font: fontB,
    color: K,
    rotate: degrees(90)
  });

  if (!valid.length) {
    drawTextSafe(page, 'Noch keine Messwerte', {
      x: px + pw / 2 - 28,
      y: py + ph / 2,
      size: 7,
      font: fontR,
      color: K
    });
    return;
  }

  for (let i = 0; i < valid.length - 1; i++) {
    const a = valid[i];
    const b = valid[i + 1];
    page.drawLine({
      start: { x: tx(a.min), y: ty(a.deltaCm) },
      end: { x: tx(b.min), y: ty(b.deltaCm) },
      thickness: 1.3,
      color: lineColor
    });
  }

  valid.forEach(p => {
    page.drawCircle({
      x: tx(p.min),
      y: ty(p.deltaCm),
      size: 2.1,
      color: lineColor,
      borderColor: K,
      borderWidth: 0.3
    });
  });
}

function drawStageSplitLayout(page, opt) {
  const {
    x, yTop, yBottom, w, versuch,
    foerder, schluck, fontR, fontB, K, grey, degrees, rgb
  } = opt;

  const stageH = 22;
  page.drawRectangle({
    x, y: yTop - stageH, width: w, height: stageH,
    color: grey, borderColor: K, borderWidth: 0.8
  });

  const rateLs = getPdfRateLs(versuch);
  const rateM3h = getPdfRateM3h(versuch);

  drawTextSafe(page, `Pumpversuch   ${versuch._stageTitle || 'Stufe'}   ${rateLs} [l/s]`, {
    x: x + 4, y: yTop - stageH + 11, size: 8.5, font: fontB, color: K
  });
  drawTextSafe(page, `${rateM3h} [m³/h]`, {
    x: x + 4, y: yTop - stageH + 4, size: 7.5, font: fontR, color: K
  });

  const keys = ['foerder', 'schluck'];
  const gap = 10;
  const colW = (w - gap) / 2;
  const contentTop = yTop - stageH - 6;

  keys.forEach((key, i) => {
    const well = key === 'foerder' ? foerder : schluck;
    const rows = getWellRowsForPdf(versuch, key, well?.ruhe);
    const colX = x + i * (colW + gap);
    const tableTop = contentTop;

    const tableH = drawWellTable(page, {
      x: colX,
      yTop: tableTop,
      w: colW,
      key,
      rows,
      ruhe: well?.ruhe,
      fontR,
      fontB,
      K,
      grey
    });

    const chartTop = tableTop - tableH - 6;
    const chartY = yBottom;
    const chartH = Math.max(95, chartTop - chartY);

    drawWellChart(page, {
      x: colX,
      y: chartY,
      w: colW,
      h: chartH,
      key,
      rows,
      fontR,
      fontB,
      K,
      grey,
      degrees,
      gridColor: rgb(0.82, 0.82, 0.82),
      lineColor: key === 'foerder' ? rgb(0.16, 0.46, 0.84) : rgb(0.90, 0.56, 0.16)
    });
  });
}

async function exportPdf(snapshot = null) {
  const snap = snapshot || collectSnapshot();

  if (!window.PDFLib) {
    alert('PDF-Library noch nicht geladen.');
    return;
  }

  const fontkit = window.fontkit || window.PDFLibFontkit;
  if (!fontkit) {
    alert('fontkit nicht geladen.');
    return;
  }

  const versuche = Array.isArray(snap.versuche) ? snap.versuche : [];
  if (!versuche.length) {
    alert('Es ist noch keine Pumpstufe vorhanden.');
    return;
  }

  const { PDFDocument, rgb, degrees } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fontBytesR = await fetch(`${BASE}fonts/arial.ttf?v=60`).then(r => {
    if (!r.ok) throw new Error('arial.ttf nicht gefunden');
    return r.arrayBuffer();
  });

  let fontBytesB = null;
  try {
    fontBytesB = await fetch(`${BASE}fonts/arialbd.ttf?v=60`).then(r => {
      if (!r.ok) throw new Error('arialbd.ttf nicht gefunden');
      return r.arrayBuffer();
    });
  } catch {}

  const fontR = await pdf.embedFont(fontBytesR, { subset: true });
  const fontB = fontBytesB ? await pdf.embedFont(fontBytesB, { subset: true }) : fontR;

  let logo = null;
  try {
    const bytes = await fetch(`${BASE}logo.png?v=28`).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    });
    logo = await pdf.embedPng(bytes);
  } catch {}

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const mm = v => v * 72 / 25.4;

  const K = rgb(0, 0, 0);
  const GREY = rgb(0.90, 0.90, 0.90);

  const meta = snap.meta || {};
  const foerder = snap.foerder || {};
  const schluck = snap.schluck || {};

  for (let i = 0; i < versuche.length; i++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const v = hydrateVersuch(versuche[i]);
    v._stageTitle = getStageTitle(i);

    const margin = mm(8);
    const x0 = margin, y0 = margin;
    const W = PAGE_W - 2 * margin;
    const H = PAGE_H - 2 * margin;

    page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: K, borderWidth: 1.2 });

    const hdrH = mm(13);
    page.drawRectangle({ x: x0, y: y0 + H - hdrH, width: W, height: hdrH, color: GREY, borderColor: K, borderWidth: 0.8 });

    if (logo) {
      const lh = hdrH * 0.75;
      const scale = lh / logo.height;
      page.drawImage(logo, {
        x: x0 + mm(2),
        y: y0 + H - hdrH + (hdrH - lh) / 2,
        width: logo.width * scale,
        height: lh
      });
    }

    drawTextSafe(page, 'Pumpversuch', {
      x: x0 + mm(32),
      y: y0 + H - hdrH + mm(4.2),
      size: 13,
      font: fontB,
      color: K
    });

    drawTextSafe(page, 'HTB Baugesellschaft m.b.H.', {
      x: x0 + mm(32),
      y: y0 + H - hdrH + mm(1.5),
      size: 8,
      font: fontR,
      color: K
    });

    let cy = y0 + H - hdrH - mm(2);
    const metaRowH = mm(9);

    drawMetaGrid(page, x0, cy, W, metaRowH, meta, fontR, fontB, K);
    cy -= metaRowH * 3;

    page.drawRectangle({
      x: x0, y: cy - metaRowH, width: W, height: metaRowH,
      color: GREY, borderColor: K, borderWidth: 0.7
    });

    const wellTexts = [
      `Förderbrunnen: Ø ${foerder.dm || '—'} mm · ET ${foerder.endteufe || '—'} m · RW ${foerder.ruhe || '—'} m`,
      `Schluckbrunnen: Ø ${schluck.dm || '—'} mm · ET ${schluck.endteufe || '—'} m · RW ${schluck.ruhe || '—'} m`
    ];

    drawTextSafe(page, wellTexts.join('   |   '), {
      x: x0 + 4,
      y: cy - metaRowH + 6,
      size: 7.1,
      font: fontR,
      color: K
    });

    cy -= metaRowH + mm(3);

    drawStageSplitLayout(page, {
      x: x0,
      yTop: cy,
      yBottom: y0 + mm(9),
      w: W,
      versuch: v,
      foerder,
      schluck,
      fontR,
      fontB,
      K,
      grey: GREY,
      degrees,
      rgb
    });

    page.drawLine({
      start: { x: x0, y: y0 + mm(5.5) },
      end: { x: x0 + W, y: y0 + mm(5.5) },
      thickness: 0.8,
      color: K
    });

    drawTextSafe(page, `Exportiert: ${new Date().toLocaleString('de-DE')}`, {
      x: x0 + 4,
      y: y0 + 4,
      size: 7,
      font: fontR,
      color: K
    });

    drawTextSafe(page, `Seite ${i + 1}/${versuche.length}`, {
      x: x0 + W - 40,
      y: y0 + 4,
      size: 7,
      font: fontR,
      color: K
    });
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const obj = (snap.meta?.objekt || 'Pumpversuch')
    .replace(/[^\wäöüÄÖÜß\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const fileName = `${dateTag()}_HTB_Pumpversuch_${obj || 'Protokoll'}.pdf`;

  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ───────────────── reset / install ───────────────── */
function resetAll() {
  if (!confirm('Alle Eingaben wirklich zurücksetzen?')) return;

  Object.keys(timerMap).forEach(hardStopTimer);

  state.meta = {
    objekt: '',
    grundstueck: '',
    ort: '',
    geologie: '',
    auftragsnummer: '',
    bauleitung: '',
    bohrmeister: '',
    koordination: '',
    geprueftDurch: '',
    geprueftAm: ''
  };

  state.selection = { foerder: true, schluck: true };
  state.foerder = { dm: '', endteufe: '', ruhe: '' };
  state.schluck = { dm: '', endteufe: '', ruhe: '' };
  state.versuche = [];

  syncMetaToUi();
  syncBrunnenToUi();
  syncSelectionToUi();
  renderVersuche();
  renderLiveTab();
  saveDraftDebounced();
}

function initInstallButton() {
  let installPrompt = null;
  const btn = $('btnInstall');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (btn) btn.hidden = false;
  });

  btn?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    btn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (btn) btn.hidden = true;
  });
}

/* ───────────────── init ───────────────── */
window.addEventListener('DOMContentLoaded', () => {
  state.versuche = [];
  state.selection = { foerder: true, schluck: true };

  initTabs();
  hookStaticInputs();
  hookVersuchDelegation();
  hookHistoryDelegation();

  loadDraft();
  syncMetaToUi();
  syncBrunnenToUi();
  syncSelectionToUi();
  renderVersuche();
  renderLiveTab();
  renderHistoryList();
  initInstallButton();

  $('btnAddVersuch')?.addEventListener('click', () => {
    const v = defaultVersuch();
    state.versuche.push(v);
    renderVersuche();
    renderLiveTab();
    saveDraftDebounced();

    setTimeout(() => {
      document.querySelector(`.versuch-card[data-vid="${v.id}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 40);
  });

  $('btnSave')?.addEventListener('click', () => {
    saveCurrentToHistory();
    saveDraftDebounced();
    alert('Pumpversuch im Verlauf gespeichert.');
  });

  $('btnPdf')?.addEventListener('click', async () => {
    try {
      await exportPdf();
    } catch (err) {
      console.error(err);
      alert('PDF-Fehler: ' + (err?.message || String(err)));
    }
  });

  $('btnReset')?.addEventListener('click', resetAll);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${BASE}sw.js?v=28`).catch(err => console.error('SW:', err));
  }
});
