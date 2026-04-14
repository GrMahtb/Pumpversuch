'use strict';
console.log('HTB Pumpversuch app.js v12 loaded');

const BASE = '/Pumpversuch/';
const STORAGE_DRAFT = 'htb-pumpversuch-draft-v12';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v12';
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
  selection: {
    foerder: true,
    schluck: true
  },
  foerder: {
    dm: '',
    endteufe: '',
    ruhe: ''
  },
  schluck: {
    dm: '',
    endteufe: '',
    ruhe: ''
  },
  versuche: []
};

const timerMap = {};

/* ───────────────── helpers ───────────────── */

function uid() {
  return crypto?.randomUUID?.() || ('id_' + Date.now() + '_' + Math.random().toString(16).slice(2));
}
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
function h(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function pdfSafe(v) {
  return String(v ?? '')
    .replace(/Δ/g, 'Diff.')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/•/g, '-')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
}
function fmtComma(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
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
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
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
    String(str || '')
      .split(',')
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
  return {
    foerder: !!state.selection.foerder,
    schluck: !!state.selection.schluck
  };
}
function getSelectedWellKeys() {
  const sel = getSelectedWells();
  const keys = [];
  if (sel.foerder) keys.push('foerder');
  if (sel.schluck) keys.push('schluck');
  return keys;
}
function getWellLabel(key) {
  return key === 'foerder' ? 'Förderbrunnen' : 'Schluckbrunnen';
}
function getWellLabelPdf(key) {
  return key === 'foerder' ? 'Foerderbrunnen' : 'Schluckbrunnen';
}
function getValueField(key) {
  return key === 'foerder' ? 'foerder_m' : 'schluck_m';
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
    const av = Number(a.min);
    const bv = Number(b.min);
    const af = Number.isFinite(av);
    const bf = Number.isFinite(bv);
    if (af && bf) return av - bv;
    if (af) return -1;
    if (bf) return 1;
    return 0;
  });
  syncIntervalleStrFromRows(v);
}
function getEffectiveRateM3h(v) {
  const n = Number(v.manualRateM3h);
  return Number.isFinite(n) ? n.toFixed(3) : '';
}
function getEffectiveRateLs(v) {
  const m3h = Number(v.manualRateM3h);
  return Number.isFinite(m3h) ? (m3h / 3.6).toFixed(3) : '';
}
function getContinueStep(v) {
  const rows = (v.messungen || []).slice().sort((a, b) => Number(a.min) - Number(b.min));
  if (rows.length >= 2) {
    const last = Number(rows[rows.length - 1].min);
    const prev = Number(rows[rows.length - 2].min);
    const step = last - prev;
    if (Number.isFinite(step) && step > 0) return step;
  }
  return 15;
}

/* ───────────────── defaults ───────────────── */

function defaultVersuch() {
  const ints = [...DEFAULT_INTERVALLE];
  return {
    id: uid(),
    manualRateM3h: '',
    startzeit: '',
    elapsedMs: 0,
    intervalleStr: ints.join(', '),
    messungen: ints.map(min => ({
      min,
      foerder_m: '',
      schluck_m: ''
    }))
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
        schluck_m: hit.schluck_m ?? ''
      } : {
        min,
        foerder_m: '',
        schluck_m: ''
      };
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
    v: 12,
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

  if (Array.isArray(snapshot.versuche) && snapshot.versuche.length) {
    state.versuche = snapshot.versuche.map(v => hydrateVersuch(v));
  } else {
    state.versuche = [];
  }

  Object.keys(timerMap).forEach(hardStopTimer);

  if (render) {
    syncMetaToUi();
    syncBrunnenToUi();
    syncSelectionToUi();
    renderVersuche();
  }
}

let _saveT = null;
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
    if (!raw) return;
    applySnapshot(JSON.parse(raw), true);
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
    });
  });
}

/* ───────────────── render stages ───────────────── */

function buildTableHeadHtml() {
  const sel = getSelectedWells();
  let html = '<tr><th>Min</th>';
  if (sel.foerder) html += '<th class="th-foerder">Förderbrunnen m ab OK</th>';
  if (sel.schluck) html += '<th class="th-schluck">Schluckbrunnen m ab OK</th>';
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
        <input class="mess-input minute-input" data-role="min" data-row="${rowIdx}" type="number" step="1" inputmode="numeric" value="${h(row.min)}" />
        ${isLast ? `<button class="row-plus" data-role="row-plus" data-row="${rowIdx}" type="button">+</button>` : ``}
      </div>
    </td>
  `;

  if (sel.foerder) {
    html += `<td><input class="mess-input" data-role="foerder-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.foerder_m)}" /></td>`;
  }
  if (sel.schluck) {
    html += `<td><input class="mess-input" data-role="schluck-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.schluck_m)}" /></td>`;
  }

  html += `</tr>`;
  return html;
}

function buildVersuchHtml(v, idx) {
  const effM3h = getEffectiveRateM3h(v);
  const effLs = getEffectiveRateLs(v);
  const wellText = getSelectedWellKeys().map(getWellLabel).join(' / ');

  const rowsHtml = v.messungen.map((row, rowIdx) => buildTableRowHtml(v, row, rowIdx)).join('');

  return `
    <details class="card card--collapsible versuch-card" data-vid="${h(v.id)}" open>
      <summary class="card__title">
        <span>${getStageTitle(idx)}</span>
        <span class="versuch-summary-meta">${h(wellText)} · ${effM3h ? `${effM3h} m³/h · ${effLs} l/s` : 'keine Förderrate'}</span>
      </summary>

      <div class="card__body versuch-body">
        <div class="versuch-row">
          <span class="rate-label">Förderrate Kopf [m³/h]</span>
          <input class="rate-input" data-role="manual-rate-m3h" type="number" step="0.001" inputmode="decimal" value="${h(v.manualRateM3h)}" />
          <span class="rate-unit">=</span>
          <span class="rate-conv" data-role="head-rate-ls">${effLs ? `${h(effLs)} l/s` : '—'}</span>
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
              <button class="timer-btn timer-btn--stop" data-role="timer-stop" type="button">Stop</button>
              <button class="timer-btn timer-btn--ghost" data-role="timer-reset" type="button">Reset</button>
            </div>
          </div>
          <div class="timer-info" data-role="startzeit">${v.startzeit ? `Startzeit: ${h(v.startzeit)}` : 'Noch nicht gestartet'}</div>
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
      </div>
    `;
    return;
  }

  host.innerHTML = state.versuche.map((v, idx) => buildVersuchHtml(v, idx)).join('');

  document.querySelectorAll('.versuch-card').forEach(card => {
    const v = getVersuchById(card.dataset.vid);
    if (v) updateTimerUi(card, v);
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

  const alarmMins = mins.filter(iv => iv > 0);
  const elapsedMin = elapsedMs / 60000;
  const nextIv = alarmMins.find(iv => elapsedMin < iv);

  if (nextEl) {
    if (nextIv !== undefined) {
      const restSec = Math.max(0, Math.ceil((nextIv * 60000 - elapsedMs) / 1000));
      nextEl.textContent = `Nächste Messung: ${nextIv} min (in ${restSec}s)`;
    } else {
      nextEl.textContent = 'Alle Messintervalle erreicht';
    }
  }

  card.querySelectorAll('tbody tr').forEach(r => r.classList.remove('row-active'));
  const passed = mins.filter(iv => elapsedMin >= iv);
  const lastPassed = passed.length ? passed[passed.length - 1] : mins[0];
  const rowIdx = versuch.messungen.findIndex(m => Number(m.min) === Number(lastPassed));
  if (rowIdx >= 0) {
    const row = card.querySelector(`tr[data-row="${rowIdx}"]`);
    row?.classList.add('row-active');
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

  const elapsedMin = versuch.elapsedMs / 60000;
  const passedAlarmCount = mins.filter(iv => elapsedMin >= iv).length;

  if (passedAlarmCount > t.alarmCount) {
    t.alarmCount = passedAlarmCount;
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

  const elapsedMin = t.accumulatedMs / 60000;
  t.alarmCount = mins.filter(iv => iv > 0 && elapsedMin >= iv).length;
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

/* ───────────────── computed stage info ───────────────── */

function updateStageComputed(card, versuch) {
  const effM3h = getEffectiveRateM3h(versuch);
  const effLs = getEffectiveRateLs(versuch);

  const lsEl = card.querySelector('[data-role="head-rate-ls"]');
  if (lsEl) lsEl.textContent = effLs ? `${effLs} l/s` : '—';

  const summary = card.querySelector('.versuch-summary-meta');
  const wellText = getSelectedWellKeys().map(getWellLabel).join(' / ');
  if (summary) {
    summary.textContent = effM3h
      ? `${wellText} · ${effM3h} m³/h · ${effLs} l/s`
      : `${wellText} · keine Förderrate`;
  }
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
    });
    el.addEventListener('change', () => {
      collectBrunnenFromUi();
      saveDraftDebounced();
    });
  });

  $('sel-foerder')?.addEventListener('change', () => {
    const ok = collectSelectionFromUi();
    if (!ok) return;
    renderVersuche();
    saveDraftDebounced();
  });

  $('sel-schluck')?.addEventListener('change', () => {
    const ok = collectSelectionFromUi();
    if (!ok) return;
    renderVersuche();
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

    if (role === 'manual-rate-m3h') {
      versuch.manualRateM3h = el.value;
      updateStageComputed(card, versuch);
      saveDraftDebounced();
      return;
    }

    if (role === 'min') {
      const idx = Number(el.dataset.row);
      if (versuch.messungen[idx]) versuch.messungen[idx].min = el.value;
      saveDraftDebounced();
      return;
    }

    if (role === 'foerder-m') {
      const idx = Number(el.dataset.row);
      if (versuch.messungen[idx]) versuch.messungen[idx].foerder_m = el.value;
      saveDraftDebounced();
      return;
    }

    if (role === 'schluck-m') {
      const idx = Number(el.dataset.row);
      if (versuch.messungen[idx]) versuch.messungen[idx].schluck_m = el.value;
      saveDraftDebounced();
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
        alert('Bitte gültige Intervalle eingeben, z. B. 0, 1, 2, 3, 4, 5, 15, 30.');
        el.value = versuch.intervalleStr;
        return;
      }

      const old = Array.isArray(versuch.messungen) ? versuch.messungen : [];
      versuch.intervalleStr = ints.join(', ');
      versuch.messungen = ints.map(min => {
        const hit = old.find(m => Number(m.min) === Number(min));
        return hit || { min, foerder_m: '', schluck_m: '' };
      });

      hardStopTimer(versuch.id);
      renderVersuche();
      saveDraftDebounced();
      return;
    }

    if (role === 'min') {
      sortMessungen(versuch);
      hardStopTimer(versuch.id);
      renderVersuche();
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
      const last = versuch.messungen.length ? Number(versuch.messungen[versuch.messungen.length - 1].min) : 0;
      const nextMin = Number.isFinite(last) ? last + step : step;
      versuch.messungen.push({
        min: nextMin,
        foerder_m: '',
        schluck_m: ''
      });
      syncIntervalleStrFromRows(versuch);
      renderVersuche();
      saveDraftDebounced();
      return;
    }

    if (role === 'del') {
      const idx = state.versuche.findIndex(v => v.id === versuch.id);
      if (!confirm(`${getStageTitle(idx)} wirklich löschen?`)) return;
      hardStopTimer(versuch.id);
      state.versuche = state.versuche.filter(v => v.id !== versuch.id);
      renderVersuche();
      saveDraftDebounced();
      return;
    }

    if (role === 'timer-start') { startTimer(versuch.id); return; }
    if (role === 'timer-stop') { stopTimer(versuch.id); return; }
    if (role === 'timer-reset') { resetTimer(versuch.id); return; }
  });
}

/* ───────────────── history ui ───────────────── */

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
          Objekt: <b>${h(snap.meta?.objekt || '—')}</b> · Ort: <b>${h(snap.meta?.ort || '—')}</b> · Brunnen: <b>${h(wells.join(' / ') || '—')}</b> · Stufen: <b>${h(count)}</b>
        </div>
        <div class="historyBtns">
          <button type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
          <button type="button" data-hact="pdf" data-id="${h(entry.id)}">PDF</button>
          <button type="button" data-hact="del" data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ───────────────── pdf ───────────────── */

function drawTextSafe(page, text, options) {
  page.drawText(pdfSafe(text), options);
}

function getRowsForExport(v) {
  return clone(v.messungen || []).sort((a, b) => {
    const av = Number(a.min);
    const bv = Number(b.min);
    const af = Number.isFinite(av);
    const bf = Number.isFinite(bv);
    if (af && bf) return av - bv;
    if (af) return -1;
    if (bf) return 1;
    return 0;
  });
}

function drawMetaGrid(page, x, yTop, w, rowH, meta, fontR, fontB, K) {
  const rows = [
    [
      ['Objekt', meta.objekt || ''],
      ['Grundstueck', meta.grundstueck || ''],
      ['Geprueft durch', meta.geprueftDurch || ''],
      ['Geprueft am', dateDE(meta.geprueftAm) || '']
    ],
    [
      ['Ort', meta.ort || ''],
      ['Auftragsnummer', meta.auftragsnummer || ''],
      ['Geologie', meta.geologie || ''],
      ['Bauleitung', meta.bauleitung || '']
    ],
    [
      ['Bohrmeister', meta.bohrmeister || ''],
      ['Koordination', meta.koordination || ''],
      ['', ''],
      ['', '']
    ]
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

function buildPdfCols(selection) {
  const cols = [{ key: 'min', label: 'Minuten', w: 0.14 }];
  if (selection.foerder) {
    cols.push({ key: 'foerder_m', label: 'Foerderbrunnen m ab OK', w: 0.24 });
    cols.push({ key: 'foerder_diff', label: 'Diff. Ruhe', w: 0.14 });
  }
  if (selection.schluck) {
    cols.push({ key: 'schluck_m', label: 'Schluckbrunnen m ab OK', w: 0.24 });
    cols.push({ key: 'schluck_diff', label: 'Diff. Ruhe', w: 0.14 });
  }

  const sum = cols.reduce((a, c) => a + c.w, 0);
  cols.forEach(c => { c.w = c.w / sum; });
  return cols;
}

function drawStageTable(page, opt) {
  const {
    x, yTop, w,
    versuch,
    selection,
    foerder,
    schluck,
    fontR,
    fontB,
    K,
    grey
  } = opt;

  const rows = getRowsForExport(versuch);
  const cols = buildPdfCols(selection);

  const titleH = 16;
  const headH = 18;
  const rowH = 11.2;
  const totalH = titleH + headH + rows.length * rowH;

  page.drawRectangle({ x, y: yTop - titleH, width: w, height: titleH, color: grey, borderColor: K, borderWidth: 0.8 });

  const rateM3h = getEffectiveRateM3h(versuch);
  const rateLs = getEffectiveRateLs(versuch);

  drawTextSafe(page, `${pdfSafe(versuch._stageTitle || 'Stufe')}   ${rateLs || '—'} l/s   ${rateM3h || '—'} m3/h`, {
    x: x + 4,
    y: yTop - titleH + 4,
    size: 8.7,
    font: fontB,
    color: K
  });

  const yHead = yTop - titleH - headH;
  page.drawRectangle({ x, y: yHead, width: w, height: headH, borderColor: K, borderWidth: 0.8 });

  const xs = [x];
  cols.forEach(c => xs.push(xs[xs.length - 1] + w * c.w));

  for (let i = 1; i < xs.length - 1; i++) {
    page.drawLine({
      start: { x: xs[i], y: yTop - totalH },
      end: { x: xs[i], y: yTop - titleH },
      thickness: 0.6,
      color: K
    });
  }

  cols.forEach((c, i) => {
    drawTextSafe(page, c.label, {
      x: xs[i] + 3,
      y: yHead + 6,
      size: 7,
      font: fontB,
      color: K
    });
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

    cols.forEach((c, i) => {
      let text = '—';

      if (c.key === 'min') text = String(r.min ?? '');
      if (c.key === 'foerder_m') text = r.foerder_m !== '' ? fmtComma(r.foerder_m, 3) : '—';
      if (c.key === 'foerder_diff') text = calcDelta(r.foerder_m, foerder.ruhe) || '—';
      if (c.key === 'schluck_m') text = r.schluck_m !== '' ? fmtComma(r.schluck_m, 3) : '—';
      if (c.key === 'schluck_diff') text = calcDelta(r.schluck_m, schluck.ruhe) || '—';

      drawTextSafe(page, text, {
        x: xs[i] + 3,
        y: nextY + 3,
        size: 7.2,
        font: fontR,
        color: K
      });
    });

    y = nextY;
  });

  return yTop - totalH;
}

async function exportPdf(snapshot = null) {
  const snap = snapshot || collectSnapshot();

  if (!window.PDFLib) {
    alert('PDF-Library noch nicht geladen. Bitte kurz warten.');
    return;
  }

  const versuche = Array.isArray(snap.versuche) ? snap.versuche : [];
  if (!versuche.length) {
    alert('Es ist noch keine Pumpstufe vorhanden.');
    return;
  }

  const selection = snap.selection || { foerder: true, schluck: true };
  if (!selection.foerder && !selection.schluck) {
    alert('Es ist kein Brunnen ausgewählt.');
    return;
  }

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();

  const fontR = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo = null;
  try {
    const bytes = await fetch(`${BASE}logo.png?v=12`).then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
    logo = await pdf.embedPng(bytes);
  } catch {}

  const PAGE_W = 595.28; // A4 Hochformat
  const PAGE_H = 841.89;
  const mm = (v) => v * 72 / 25.4;

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
    const x0 = margin;
    const y0 = margin;
    const W = PAGE_W - 2 * margin;
    const H = PAGE_H - 2 * margin;

    page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: K, borderWidth: 1.2 });

    const hdrH = mm(13);
    page.drawRectangle({
      x: x0,
      y: y0 + H - hdrH,
      width: W,
      height: hdrH,
      color: GREY,
      borderColor: K,
      borderWidth: 0.8
    });

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
      x: x0,
      y: cy - metaRowH,
      width: W,
      height: metaRowH,
      color: GREY,
      borderColor: K,
      borderWidth: 0.7
    });

    const wellTexts = [];
    if (selection.foerder) {
      wellTexts.push(`Foerderbrunnen: Ø ${foerder.dm || '—'} mm · ET ${foerder.endteufe || '—'} m · RW ${foerder.ruhe || '—'} m`);
    }
    if (selection.schluck) {
      wellTexts.push(`Schluckbrunnen: Ø ${schluck.dm || '—'} mm · ET ${schluck.endteufe || '—'} m · RW ${schluck.ruhe || '—'} m`);
    }

    drawTextSafe(page, wellTexts.join('   |   '), {
      x: x0 + 4,
      y: cy - metaRowH + 6,
      size: 7.2,
      font: fontR,
      color: K
    });

    cy -= metaRowH + mm(3);

    drawStageTable(page, {
      x: x0,
      yTop: cy,
      w: W,
      versuch: v,
      selection,
      foerder,
      schluck,
      fontR,
      fontB,
      K,
      grey: GREY
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

  const fileName = `${dateTag(new Date())}_HTB_Pumpversuch_${obj || 'Protokoll'}.pdf`;

  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ───────────────── history ui ───────────────── */

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
          Objekt: <b>${h(snap.meta?.objekt || '—')}</b> · Ort: <b>${h(snap.meta?.ort || '—')}</b> · Brunnen: <b>${h(wells.join(' / ') || '—')}</b> · Stufen: <b>${h(count)}</b>
        </div>
        <div class="historyBtns">
          <button type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
          <button type="button" data-hact="pdf" data-id="${h(entry.id)}">PDF</button>
          <button type="button" data-hact="del" data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
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
  renderHistoryList();
  initInstallButton();

  $('btnAddVersuch')?.addEventListener('click', () => {
    const v = defaultVersuch();
    state.versuche.push(v);
    renderVersuche();
    saveDraftDebounced();

    setTimeout(() => {
      const card = document.querySelector(`.versuch-card[data-vid="${v.id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    navigator.serviceWorker.register(`${BASE}sw.js?v=12`).catch(err => {
      console.error('SW registration failed:', err);
    });
  }
});
