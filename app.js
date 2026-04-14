'use strict';
console.log('HTB Pumpversuch app.js v8 loaded');

const BASE = '/Pumpversuch/';
const STORAGE_DRAFT = 'htb-pumpversuch-draft-v8';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v8';
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
function lsToM3h(v) {
  const n = Number(v);
  return Number.isFinite(n) ? (n * 3.6).toFixed(3) : '';
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
function getSortedMinutesFromRows(v) {
  return (v.messungen || [])
    .map(m => Number(m.min))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}
function syncIntervalleStrFromRows(v) {
  v.intervalleStr = getSortedMinutesFromRows(v).join(', ');
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

/* ───────────────── defaults ───────────────── */

function defaultVersuch(idx = 0) {
  const ints = [...DEFAULT_INTERVALLE];
  return {
    id: uid(),
    foerderrate_ls: '',
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

function hydrateVersuch(v, idx = 0) {
  const base = defaultVersuch(idx);
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

/* ───────────────── field sync ───────────────── */

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

/* ───────────────── draft / history ───────────────── */

function collectSnapshot() {
  collectMetaFromUi();
  collectBrunnenFromUi();
  return {
    v: 8,
    meta: clone(state.meta),
    foerder: clone(state.foerder),
    schluck: clone(state.schluck),
    versuche: clone(state.versuche)
  };
}

function applySnapshot(snapshot, render = true) {
  if (!snapshot) return;

  state.meta = { ...state.meta, ...(snapshot.meta || {}) };
  state.foerder = { ...state.foerder, ...(snapshot.foerder || {}) };
  state.schluck = { ...state.schluck, ...(snapshot.schluck || {}) };

  if (Array.isArray(snapshot.versuche) && snapshot.versuche.length) {
    state.versuche = snapshot.versuche.map((v, i) => hydrateVersuch(v, i));
  } else {
    state.versuche = [];
  }

  Object.keys(timerMap).forEach(hardStopTimer);

  if (render) {
    syncMetaToUi();
    syncBrunnenToUi();
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

/* ───────────────── render versuche ───────────────── */

function buildVersuchHtml(v, idx) {
  const m3h = lsToM3h(v.foerderrate_ls);
  const summaryRate = v.foerderrate_ls
    ? `${h(v.foerderrate_ls)} l/s · ${h(m3h || '0')} m³/h`
    : 'keine Förderrate';

  const rows = v.messungen.map((m, rowIdx) => {
    return `
      <tr data-row="${rowIdx}">
        <td>
          <input class="mess-input minute-input" data-role="min" data-row="${rowIdx}" type="number" step="1" inputmode="numeric" value="${h(m.min)}" />
        </td>
        <td>
          <input class="mess-input" data-role="foerder-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(m.foerder_m)}" />
        </td>
        <td>
          <input class="mess-input" data-role="schluck-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(m.schluck_m)}" />
        </td>
        <td class="rate-cell">${m3h ? h(m3h) : '—'}</td>
      </tr>
    `;
  }).join('');

  return `
    <details class="card card--collapsible versuch-card" data-vid="${h(v.id)}" open>
      <summary class="card__title">
        <span>${getStageTitle(idx)}</span>
        <span class="versuch-summary-meta">${summaryRate}</span>
      </summary>
      <div class="card__body versuch-body">
        <div class="versuch-row">
          <span class="rate-label">Förderrate</span>
          <input class="rate-input" data-role="foerderrate" type="number" step="0.01" inputmode="decimal" value="${h(v.foerderrate_ls)}" />
          <span class="rate-unit">l/s =</span>
          <span class="rate-conv" data-role="m3h">${m3h ? h(m3h) + ' m³/h' : '—'}</span>
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
            <thead>
              <tr>
                <th>Min</th>
                <th class="th-foerder">Förderbrunnen m ab OK</th>
                <th class="th-schluck">Schluckbrunnen m ab OK</th>
                <th>Förderrate [m³/h]</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
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
        Noch kein Pumpversuch angelegt.<br />
        Bitte über den Plus-Button einen neuen Versuch hinzufügen.
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
    const rowMinutes = getSortedMinutesFromRows(versuch);
    timerMap[vid] = {
      running: false,
      startMs: 0,
      accumulatedMs: Number(versuch?.elapsedMs || 0),
      raf: null,
      alarmCount: rowMinutes.filter(iv => iv > 0 && elapsedMin >= iv).length
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

  const mins = getSortedMinutesFromRows(versuch);
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

  const mins = getSortedMinutesFromRows(versuch).filter(iv => iv > 0);
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

  const elapsedMin = t.accumulatedMs / 60000;
  const mins = getSortedMinutesFromRows(versuch);
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

/* ───────────────── static input hooks ───────────────── */

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
}

/* ───────────────── versuch events ───────────────── */

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

    if (role === 'foerderrate') {
      versuch.foerderrate_ls = el.value;
      const out = card.querySelector('[data-role="m3h"]');
      const conv = lsToM3h(el.value);
      if (out) out.textContent = conv ? `${conv} m³/h` : '—';
      card.querySelectorAll('.rate-cell').forEach(cell => {
        cell.textContent = conv ? `${conv}` : '—';
      });
      const summary = card.querySelector('.versuch-summary-meta');
      if (summary) {
        summary.textContent = el.value ? `${el.value} l/s · ${conv || '0'} m³/h` : 'keine Förderrate';
      }
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

    if (role === 'del') {
      if (!confirm(`${getStageTitle(state.versuche.findIndex(v => v.id === versuch.id))} wirklich löschen?`)) return;
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
    return `
      <div class="historyItem">
        <div class="historyTop">
          <span>${h(entry.title)}</span>
          <span style="color:var(--muted);font-size:.82em">${h(new Date(entry.savedAt).toLocaleString('de-DE'))}</span>
        </div>
        <div class="historySub">
          Objekt: <b>${h(snap.meta?.objekt || '—')}</b> · Ort: <b>${h(snap.meta?.ort || '—')}</b> · Pumpstufen: <b>${h(count)}</b>
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

/* ───────────────── pdf helpers ───────────────── */

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

function numericSeries(messungen, key) {
  return (messungen || [])
    .map(m => ({ x: Number(m.min), y: Number(m[key]) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
}

function niceNumber(x, round) {
  const exp = Math.floor(Math.log10(Math.abs(x) || 1));
  const f = x / Math.pow(10, exp);
  let nf;
  if (round) {
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
  } else {
    if (f <= 1) nf = 1;
    else if (f <= 2) nf = 2;
    else if (f <= 5) nf = 5;
    else nf = 10;
  }
  return nf * Math.pow(10, exp);
}

function niceAxis(minVal, maxVal, maxTicks = 5) {
  let min = Number(minVal);
  let max = Number(maxVal);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 10;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / Math.max(1, maxTicks - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = niceMin; t <= niceMax + step * 0.5; t += step) {
    ticks.push(Number(t.toFixed(10)));
  }
  return { min: niceMin, max: niceMax, ticks };
}

function drawDashedHLine(page, x1, x2, y, color, dash = 4, gap = 3, thickness = 0.7) {
  for (let x = x1; x < x2; x += dash + gap) {
    page.drawLine({
      start: { x, y },
      end: { x: Math.min(x + dash, x2), y },
      thickness,
      color
    });
  }
}

function drawMetaRow(page, x, y, w, h, cells, fontR, fontB, K) {
  const colW = w / cells.length;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: K, borderWidth: 0.7 });
  for (let i = 1; i < cells.length; i++) {
    page.drawLine({
      start: { x: x + i * colW, y },
      end: { x: x + i * colW, y: y + h },
      thickness: 0.7,
      color: K
    });
  }
  cells.forEach((c, i) => {
    const cx = x + i * colW + 5;
    page.drawText(String(c.label || ''), { x: cx, y: y + h - 10, size: 7, font: fontB, color: K });
    page.drawText(String(c.value || ''), { x: cx, y: y + 5, size: 8.2, font: fontR, color: K });
  });
}

function drawMeasurementTable(page, opt) {
  const { x, yTop, w, h, messungen, foerderRuhe, schluckRuhe, foerderrateM3h, fontR, fontB, K, blue, orange } = opt;
  const rows = messungen || [];
  const head = 18;
  const available = h - head;
  const rowH = Math.max(12, Math.min(18, available / Math.max(1, rows.length)));

  const cols = [0.12, 0.18, 0.16, 0.18, 0.16, 0.20];
  const xs = [x];
  for (let i = 0; i < cols.length; i++) xs.push(xs[i] + w * cols[i]);

  const yHead = yTop - head;
  const totalH = head + rows.length * rowH;

  page.drawRectangle({ x, y: yTop - totalH, width: w, height: totalH, borderColor: K, borderWidth: 1 });

  for (let i = 0; i < cols.length; i++) {
    page.drawRectangle({
      x: xs[i],
      y: yHead,
      width: xs[i + 1] - xs[i],
      height: head,
      borderColor: K,
      borderWidth: 0.6
    });
  }

  page.drawText('Min', { x: xs[0] + 8, y: yHead + 5, size: 7.5, font: fontB, color: K });
  page.drawText('FB m', { x: xs[1] + 6, y: yHead + 5, size: 7.5, font: fontB, color: blue });
page.drawText('FB Diff.', { x: xs[2] + 6, y: yHead + 5, size: 7.5, font: fontB, color: blue });
  page.drawText('SB m', { x: xs[3] + 6, y: yHead + 5, size: 7.5, font: fontB, color: orange });
page.drawText('SB Diff.', { x: xs[4] + 6, y: yHead + 5, size: 7.5, font: fontB, color: orange });
  page.drawText('Rate m³/h', { x: xs[5] + 6, y: yHead + 5, size: 7.2, font: fontB, color: K });

  let y = yHead;
  rows.forEach((m) => {
    const nextY = y - rowH;
    page.drawLine({ start: { x, y: nextY }, end: { x: x + w, y: nextY }, thickness: 0.6, color: K });

    const fDelta = calcDelta(m.foerder_m, foerderRuhe);
    const sDelta = calcDelta(m.schluck_m, schluckRuhe);

    page.drawText(String(m.min ?? ''), { x: xs[0] + 8, y: nextY + 4.2, size: 7.4, font: fontR, color: K });
    page.drawText(m.foerder_m !== '' ? fmtComma(m.foerder_m, 3) : '—', { x: xs[1] + 6, y: nextY + 4.2, size: 7.2, font: fontR, color: K });
    page.drawText(fDelta !== '' ? fmtComma(fDelta, 3) : '—', { x: xs[2] + 6, y: nextY + 4.2, size: 7.2, font: fontR, color: K });
    page.drawText(m.schluck_m !== '' ? fmtComma(m.schluck_m, 3) : '—', { x: xs[3] + 6, y: nextY + 4.2, size: 7.2, font: fontR, color: K });
    page.drawText(sDelta !== '' ? fmtComma(sDelta, 3) : '—', { x: xs[4] + 6, y: nextY + 4.2, size: 7.2, font: fontR, color: K });
    page.drawText(foerderrateM3h ? fmtComma(foerderrateM3h, 3) : '—', { x: xs[5] + 6, y: nextY + 4.2, size: 7.2, font: fontR, color: K });

    y = nextY;
  });
}

function drawChart(page, opt) {
  const { x, y, w, h, title, subtitle, color, points, ruhe, fontR, fontB, K, grid, xMax = 180 } = opt;

  page.drawRectangle({ x, y, width: w, height: h, borderColor: K, borderWidth: 1 });

  page.drawText(title, { x: x + 8, y: y + h - 14, size: 10, font: fontB, color });
  page.drawText(subtitle || '', { x: x + 8, y: y + h - 25, size: 7.2, font: fontR, color: K });

  const padL = 40;
  const padR = 10;
  const padB = 24;
  const padT = 34;
  const px = x + padL;
  const py = y + padB;
  const pw = w - padL - padR;
  const ph = h - padB - padT;

  const yVals = [];
  points.forEach(p => yVals.push(p.y));
  if (Number.isFinite(Number(ruhe))) yVals.push(Number(ruhe));
  let yMin = yVals.length ? Math.min(...yVals) : 0;
  let yMax = yVals.length ? Math.max(...yVals) : 10;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  const yAxis = niceAxis(yMin, yMax, 5);
  const xAxis = niceAxis(0, xMax, 7);

  const sx = (v) => px + ((v - xAxis.min) / (xAxis.max - xAxis.min)) * pw;
  const sy = (v) => py + ((v - yAxis.min) / (yAxis.max - yAxis.min)) * ph;

  yAxis.ticks.forEach(t => {
    const gy = sy(t);
    page.drawLine({ start: { x: px, y: gy }, end: { x: px + pw, y: gy }, thickness: 0.4, color: grid });
    page.drawText(fmtComma(t, 2), { x: x + 3, y: gy - 3, size: 7, font: fontR, color: K });
  });

  xAxis.ticks.forEach(t => {
    const gx = sx(t);
    page.drawLine({ start: { x: gx, y: py }, end: { x: gx, y: py + ph }, thickness: 0.4, color: grid });
    page.drawText(String(Math.round(t)), { x: gx - 4, y: y + 7, size: 7, font: fontR, color: K });
  });

  page.drawLine({ start: { x: px, y: py }, end: { x: px + pw, y: py }, thickness: 1, color: K });
  page.drawLine({ start: { x: px, y: py }, end: { x: px, y: py + ph }, thickness: 1, color: K });

  page.drawText('Min', { x: px + pw - 12, y: y + 7, size: 7.5, font: fontB, color: K });

  if (Number.isFinite(Number(ruhe))) {
    const ry = sy(Number(ruhe));
    drawDashedHLine(page, px, px + pw, ry, K);
    page.drawText(`Ruhewasser: ${fmtComma(ruhe, 3)} m`, {
      x: px + 6,
      y: ry + 3,
      size: 7,
      font: fontR,
      color: K
    });
  }

  if (!points.length) {
    page.drawText('Keine Messpunkte vorhanden', {
      x: px + 10,
      y: py + ph / 2,
      size: 9,
      font: fontR,
      color: K
    });
    return;
  }

  const pts = points.map(p => ({ x: sx(p.x), y: sy(p.y) }));
  for (let i = 1; i < pts.length; i++) {
    page.drawLine({
      start: { x: pts[i - 1].x, y: pts[i - 1].y },
      end: { x: pts[i].x, y: pts[i].y },
      thickness: 1.6,
      color
    });
  }
  pts.forEach(p => {
    page.drawCircle({ x: p.x, y: p.y, size: 2.2, color });
    page.drawCircle({ x: p.x, y: p.y, size: 2.6, borderColor: K, borderWidth: 0.4 });
  });
}

async function exportPdf(snapshot = null) {
  const snap = snapshot || collectSnapshot();

  if (!window.PDFLib) {
    alert('PDF-Library noch nicht geladen. Bitte kurz warten.');
    return;
  }

  const versuche = Array.isArray(snap.versuche) ? snap.versuche : [];
  if (!versuche.length) {
    alert('Es ist noch kein Pumpversuch vorhanden.');
    return;
  }

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();

  const fontR = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo = null;
  try {
    const bytes = await fetch(`${BASE}logo.png?v=8`).then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
    logo = await pdf.embedPng(bytes);
  } catch {}

  const PAGE_W = 841.89;
  const PAGE_H = 595.28;
  const mm = (v) => v * 72 / 25.4;

  const K = rgb(0, 0, 0);
  const GRID = rgb(0.85, 0.85, 0.85);
  const BLUE = rgb(0.231, 0.616, 0.867);
  const ORANGE = rgb(0.961, 0.651, 0.137);
  const YELLOW = rgb(1, 0.929, 0);
  const BLACK = rgb(0.08, 0.08, 0.08);

  const meta = snap.meta || {};
  const foerder = snap.foerder || {};
  const schluck = snap.schluck || {};

  for (let i = 0; i < versuche.length; i++) {
    const v = hydrateVersuch(versuche[i], i);
    const rows = getRowsForExport(v);
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    const margin = mm(8);
    const x0 = margin;
    const y0 = margin;
    const W = PAGE_W - 2 * margin;
    const H = PAGE_H - 2 * margin;

    page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: K, borderWidth: 1.2 });

    const hdrH = mm(14);
    page.drawRectangle({
      x: x0,
      y: y0 + H - hdrH,
      width: W,
      height: hdrH,
      color: BLACK,
      borderColor: K,
      borderWidth: 0.8
    });

    if (logo) {
      const lh = hdrH * 0.78;
      const scale = lh / logo.height;
      page.drawImage(logo, {
        x: x0 + mm(3),
        y: y0 + H - hdrH + (hdrH - lh) / 2,
        width: logo.width * scale,
        height: lh
      });
    }

    page.drawText('Pumpversuch-Protokoll', {
      x: x0 + mm(37),
      y: y0 + H - hdrH + mm(4.5),
      size: 13,
      font: fontB,
      color: rgb(1, 1, 1)
    });

    page.drawText('HTB Baugesellschaft m.b.H.', {
      x: x0 + mm(37),
      y: y0 + H - hdrH + mm(1.5),
      size: 8,
      font: fontR,
      color: rgb(0.75, 0.75, 0.75)
    });

    page.drawText(`${getStageTitle(i)} · ${v.foerderrate_ls || '—'} l/s · ${lsToM3h(v.foerderrate_ls) || '—'} m³/h`, {
      x: x0 + W - mm(88),
      y: y0 + H - hdrH + mm(4),
      size: 10,
      font: fontB,
      color: YELLOW
    });

    let cy = y0 + H - hdrH - mm(7);
    const rowH = mm(10);

    drawMetaRow(page, x0, cy - rowH, W, rowH, [
      { label: 'Objekt', value: meta.objekt || '' },
      { label: 'Grundstück / Straße', value: meta.grundstueck || '' },
      { label: 'Geprüft durch', value: meta.geprueftDurch || '' },
      { label: 'Geprüft am', value: dateDE(meta.geprueftAm) || '' }
    ], fontR, fontB, K);
    cy -= rowH;

    drawMetaRow(page, x0, cy - rowH, W, rowH, [
      { label: 'Ort', value: meta.ort || '' },
      { label: 'Auftragsnummer', value: meta.auftragsnummer || '' },
      { label: 'Geologie', value: meta.geologie || '' },
      { label: 'Bauleitung', value: meta.bauleitung || '' }
    ], fontR, fontB, K);
    cy -= rowH;

    drawMetaRow(page, x0, cy - rowH, W, rowH, [
      { label: 'Bohrmeister', value: meta.bohrmeister || '' },
      { label: 'Koordination', value: meta.koordination || '' },
      { label: 'Förderbrunnen', value: `Ø ${foerder.dm || '—'} mm · ET ${foerder.endteufe || '—'} m · RW ${foerder.ruhe || '—'} m` },
      { label: 'Schluckbrunnen', value: `Ø ${schluck.dm || '—'} mm · ET ${schluck.endteufe || '—'} m · RW ${schluck.ruhe || '—'} m` }
    ], fontR, fontB, K);
    cy -= rowH;

    const contentTop = cy - mm(4);
    const contentBottom = y0 + mm(8);
    const contentH = contentTop - contentBottom;

    const tableW = W * 0.47;
    const chartsX = x0 + tableW + mm(4);
    const chartsW = W - tableW - mm(4);

    drawMeasurementTable(page, {
      x: x0,
      yTop: contentTop,
      w: tableW,
      h: contentH,
      messungen: rows,
      foerderRuhe: foerder.ruhe,
      schluckRuhe: schluck.ruhe,
      foerderrateM3h: lsToM3h(v.foerderrate_ls),
      fontR,
      fontB,
      K,
      blue: BLUE,
      orange: ORANGE
    });

    const chartGap = mm(4);
    const chartH = (contentH - chartGap) / 2;
    const maxX = Math.max(180, ...(rows || []).map(m => Number(m.min) || 0));

    drawChart(page, {
      x: chartsX,
      y: contentBottom + chartH + chartGap,
      w: chartsW,
      h: chartH,
      title: 'Förderbrunnen',
      subtitle: 'Wasserstand [m ab OK Brunnenausbau]',
      color: BLUE,
      points: numericSeries(rows, 'foerder_m'),
      ruhe: Number(foerder.ruhe),
      fontR,
      fontB,
      K,
      grid: GRID,
      xMax: maxX
    });

    drawChart(page, {
      x: chartsX,
      y: contentBottom,
      w: chartsW,
      h: chartH,
      title: 'Schluckbrunnen',
      subtitle: 'Wasserstand [m ab OK Brunnenausbau]',
      color: ORANGE,
      points: numericSeries(rows, 'schluck_m'),
      ruhe: Number(schluck.ruhe),
      fontR,
      fontB,
      K,
      grid: GRID,
      xMax: maxX
    });

    page.drawLine({
      start: { x: x0, y: y0 + mm(5.5) },
      end: { x: x0 + W, y: y0 + mm(5.5) },
      thickness: 0.8,
           color: K
    });

    page.drawText(`Exportiert: ${new Date().toLocaleString('de-DE')}`, {
      x: x0 + 4,
      y: y0 + 4,
      size: 7,
      font: fontR,
      color: K
    });

    page.drawText(`Seite ${i + 1}/${versuche.length}`, {
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

  state.foerder = { dm: '', endteufe: '', ruhe: '' };
  state.schluck = { dm: '', endteufe: '', ruhe: '' };
  state.versuche = [];

  syncMetaToUi();
  syncBrunnenToUi();
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

  initTabs();
  hookStaticInputs();
  hookVersuchDelegation();
  hookHistoryDelegation();

  loadDraft();

  syncMetaToUi();
  syncBrunnenToUi();
  renderVersuche();
  renderHistoryList();
  initInstallButton();

  $('btnAddVersuch')?.addEventListener('click', () => {
    const v = defaultVersuch(state.versuche.length);
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
    navigator.serviceWorker.register(`${BASE}sw.js?v=8`).catch(err => {
      console.error('SW registration failed:', err);
    });
  }
});
