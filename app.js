'use strict';
console.log('HTB Pumpversuch app.js v2 loaded');

/* ═══════════════════════════════════════════════
   KONSTANTEN
═══════════════════════════════════════════════ */
const STORAGE_DRAFT   = 'htb-pumpversuch-draft-v2';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v2';
const HISTORY_MAX     = 30;
const DEFAULT_INTERVALLE = [0, 1, 2, 3, 4, 5, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

const $ = id => document.getElementById(id);

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
const state = {
  meta: {
    objekt: '', grundstueck: '', ort: '',
    auftragsnummer: '', bohrmeister: '', geologie: '',
    bauleitung: '', koordination: '',
    geprueftDurch: '', geprueftAm: ''
  },
  foerder: { dm: '', endteufe: '', ruhe: '' },
  schluck: { dm: '', endteufe: '', ruhe: '' },
  versuche: []
};

// Timer-Map { [vid]: { running, startMs, accumulatedMs, raf, alarmCount } }
const timerMap = {};

/* ═══════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════ */
function uid() {
  return crypto?.randomUUID?.() || ('id_' + Date.now() + '_' + Math.random().toString(16).slice(2));
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function h(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtNum(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '';
}
function fmtComma(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
}
function parseIntervalStr(str) {
  return [...new Set(
    String(str || '').split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n >= 0)
  )].sort((a, b) => a - b);
}
function lsToM3h(ls) {
  const n = Number(ls);
  return Number.isFinite(n) && n >= 0 ? (n * 3.6).toFixed(4) : '';
}
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function formatTimeHHMMSS(date = new Date()) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
}
function dateDE(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function dateTag(d = new Date()) {
  return String(d.getDate()).padStart(2,'0')
    + String(d.getMonth()+1).padStart(2,'0')
    + String(d.getFullYear());
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
function getElapsedMs(vid, versuch) {
  const t = timerMap[vid];
  if (!t) return Number(versuch?.elapsedMs || 0);
  return t.running ? t.accumulatedMs + (Date.now() - t.startMs) : t.accumulatedMs;
}

/* ── niceAxis für Diagramme ── */
function niceNumber(x, round) {
  const exp = Math.floor(Math.log10(Math.abs(x) || 1));
  const f   = x / Math.pow(10, exp);
  let nf;
  if (round) { nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10; }
  else        { nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; }
  return nf * Math.pow(10, exp);
}
function niceAxis(minVal, maxVal, maxTicks = 5) {
  let min = Number(minVal), max = Number(maxVal);
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 10; }
  if (min === max) { min -= 1; max += 1; }
  const range = niceNumber(max - min, false);
  const step  = niceNumber(range / Math.max(1, maxTicks - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = niceMin; t <= niceMax + step * 0.5; t += step) ticks.push(Number(t.toFixed(10)));
  return { min: niceMin, max: niceMax, step, ticks };
}

/* ═══════════════════════════════════════════════
   DEFAULT VERSUCH
═══════════════════════════════════════════════ */
function defaultVersuch(idx = 0) {
  const intervalle = [...DEFAULT_INTERVALLE];
  return {
    id: uid(),
    titel: `Stufe ${idx + 1}`,
    foerderrate_ls: '',
    startzeit: null,
    elapsedMs: 0,
    intervalleStr: intervalle.join(', '),
    messungen: intervalle.map(min => ({ min, foerder_m: '', schluck_m: '' }))
  };
}
function hydrateVersuch(v, idx = 0) {
  const base      = defaultVersuch(idx);
  const intervalle = v?.intervalleStr ? parseIntervalStr(v.intervalleStr) : [...DEFAULT_INTERVALLE];
  const existing  = Array.isArray(v?.messungen) ? v.messungen : [];
  return {
    ...base, ...v,
    elapsedMs: Number(v?.elapsedMs || 0),
    intervalleStr: intervalle.join(', '),
    messungen: intervalle.map(min => {
      const hit = existing.find(m => Number(m.min) === Number(min));
      return hit ? { min, foerder_m: hit.foerder_m ?? '', schluck_m: hit.schluck_m ?? '' }
                 : { min, foerder_m: '', schluck_m: '' };
    })
  };
}

/* ═══════════════════════════════════════════════
   META / BRUNNEN SYNC
═══════════════════════════════════════════════ */
const META_FIELDS = [
  ['inp-objekt',        'objekt'],
  ['inp-grundstueck',   'grundstueck'],
  ['inp-ort',           'ort'],
  ['inp-auftragsnummer','auftragsnummer'],
  ['inp-bohrmeister',   'bohrmeister'],
  ['inp-geologie',      'geologie'],
  ['inp-bauleitung',    'bauleitung'],
  ['inp-koordination',  'koordination'],
  ['inp-geprueft-durch','geprueftDurch'],
  ['inp-geprueft-am',   'geprueftAm']
];
const BRUNNEN_FIELDS = [
  ['inp-foerder-dm',       'foerder', 'dm'],
  ['inp-foerder-endteufe', 'foerder', 'endteufe'],
  ['inp-foerder-ruhe',     'foerder', 'ruhe'],
  ['inp-schluck-dm',       'schluck', 'dm'],
  ['inp-schluck-endteufe', 'schluck', 'endteufe'],
  ['inp-schluck-ruhe',     'schluck', 'ruhe']
];
function syncMetaToUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id); if (el) el.value = state.meta[key] || '';
  });
}
function syncBrunnenToUi() {
  BRUNNEN_FIELDS.forEach(([id, section, key]) => {
    const el = $(id); if (el) el.value = state[section][key] || '';
  });
}
function collectMetaFromUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id); if (el) state.meta[key] = el.value || '';
  });
}
function collectBrunnenFromUi() {
  BRUNNEN_FIELDS.forEach(([id, section, key]) => {
    const el = $(id); if (el) state[section][key] = el.value || '';
  });
}
function hookStaticInputs() {
  // Stammdaten
  META_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input',  () => { collectMetaFromUi(); saveDraftDebounced(); });
    el.addEventListener('change', () => { collectMetaFromUi(); saveDraftDebounced(); });
  });
  // Brunnendaten
  BRUNNEN_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      collectBrunnenFromUi();
      refreshAllDeltas();
      saveDraftDebounced();
    });
    el.addEventListener('change', () => {
      collectBrunnenFromUi();
      refreshAllDeltas();
      saveDraftDebounced();
    });
  });
}

/* ═══════════════════════════════════════════════
   DRAFT
═══════════════════════════════════════════════ */
function collectState() {
  collectMetaFromUi();
  collectBrunnenFromUi();
  return {
    v: 2,
    meta:     clone(state.meta),
    foerder:  clone(state.foerder),
    schluck:  clone(state.schluck),
    versuche: clone(state.versuche)
  };
}
function applyState(snapshot, render = true) {
  if (!snapshot) return;
  state.meta    = { ...state.meta,    ...(snapshot.meta    || {}) };
  state.foerder = { ...state.foerder, ...(snapshot.foerder || {}) };
  state.schluck = { ...state.schluck, ...(snapshot.schluck || {}) };
  if (Array.isArray(snapshot.versuche) && snapshot.versuche.length) {
    state.versuche = snapshot.versuche.map((v, i) => hydrateVersuch(v, i));
  } else {
    state.versuche = [defaultVersuch(0), defaultVersuch(1), defaultVersuch(2)];
  }
  Object.keys(timerMap).forEach(k => {
    try { if (timerMap[k]?.raf) cancelAnimationFrame(timerMap[k].raf); } catch {}
    delete timerMap[k];
  });
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
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(collectState())); } catch {}
  }, 250);
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (!raw) return;
    applyState(JSON.parse(raw), true);
  } catch {}
}

/* ═══════════════════════════════════════════════
   TABS
═══════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.pane').forEach(pane => {
        const on = pane.id === `tab-${btn.dataset.tab}`;
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
      });
      if (btn.dataset.tab === 'verlauf') renderHistoryList();
    });
  });
}

/* ═══════════════════════════════════════════════
   RENDER VERSUCHE
═══════════════════════════════════════════════ */
function renderVersuche() {
  const host = $('versucheContainer');
  if (!host) return;
  host.innerHTML = '';
  state.versuche.forEach((v, idx) => host.appendChild(buildVersuchEl(v, idx)));
  // Globale Event-Delegation auf dem Container
  hookVersucheByDelegation(host);
}

function buildVersuchEl(versuch, idx) {
  const div = document.createElement('section');
  div.className = 'versuch-card';
  div.dataset.id = versuch.id;

  const m3h         = lsToM3h(versuch.foerderrate_ls);
  const elapsedDisp = formatElapsed(versuch.elapsedMs || 0);

  const rows = versuch.messungen.map((mess, mIdx) => {
    const fDelta = calcDelta(mess.foerder_m, state.foerder.ruhe);
    const sDelta = calcDelta(mess.schluck_m, state.schluck.ruhe);
    return `
      <tr data-midx="${mIdx}">
        <td class="min-cell">${h(mess.min)}&nbsp;min</td>
        <td><input class="mess-input" data-role="foerder-m" data-midx="${mIdx}"
              type="number" step="0.001" inputmode="decimal"
              value="${h(mess.foerder_m)}" placeholder="—"/></td>
        <td class="delta-cell" data-role="foerder-delta">${fDelta !== '' ? h(fDelta) : '—'}</td>
        <td><input class="mess-input" data-role="schluck-m" data-midx="${mIdx}"
              type="number" step="0.001" inputmode="decimal"
              value="${h(mess.schluck_m)}" placeholder="—"/></td>
        <td class="delta-cell" data-role="schluck-delta">${sDelta !== '' ? h(sDelta) : '—'}</td>
      </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="versuch-header">
      <input class="versuch-titel-input" data-role="titel"
             type="text" value="${h(versuch.titel)}"
             placeholder="Stufe ${idx+1}" spellcheck="false"/>
      <button class="versuch-del-btn" data-role="del" type="button">✕ Löschen</button>
    </div>

    <div class="versuch-foerderrate">
      <span class="foerderrate-label">Förderrate:</span>
      <input class="foerderrate-val" data-role="foerderrate"
             type="number" step="0.01" min="0" inputmode="decimal"
             value="${h(versuch.foerderrate_ls)}" placeholder="0.00"/>
      <span class="foerderrate-unit">l/s =</span>
      <span class="foerderrate-m3h" data-role="m3h">${m3h ? h(m3h) + ' m³/h' : '—'}</span>
    </div>

    <div class="intervall-row">
      <span class="intervall-label">Intervalle [min]:</span>
      <input class="intervall-input" data-role="intervalle" type="text"
             value="${h(versuch.intervalleStr)}"
             placeholder="0, 1, 2, 3, 4, 5, 15, 30 …"/>
    </div>

    <div class="stoppuhr-block">
      <div class="stoppuhr-row">
        <div class="stoppuhr-display" data-role="elapsed">${elapsedDisp}</div>
        <button class="btn-start" data-role="timer-start" type="button">▶ Start</button>
        <button class="btn-stop"  data-role="timer-stop"  type="button" disabled>■ Stop</button>
        <button class="btn-reset-timer" data-role="timer-reset" type="button">↺ Reset</button>
      </div>
      <div class="startzeit-display" data-role="startzeit">
        ${versuch.startzeit ? 'Startzeit: ' + h(versuch.startzeit) : 'Noch nicht gestartet'}
      </div>
      <div class="stoppuhr-naechstes" data-role="naechstes"></div>
    </div>

    <div class="mess-table-wrap">
      <table class="mess-table">
        <thead>
          <tr>
            <th rowspan="2" style="min-width:56px">Min</th>
            <th colspan="2" class="foerder-head">🔵 Förderbrunnen</th>
            <th colspan="2" class="schluck-head">🟠 Schluckbrunnen</th>
          </tr>
          <tr>
            <th class="foerder-head">m ab OK [m]</th>
            <th class="foerder-head">Δ Ruhe [m]</th>
            <th class="schluck-head">m ab OK [m]</th>
            <th class="schluck-head">Δ Ruhe [m]</th>
          </tr>
        </thead>
        <tbody data-role="mess-tbody">${rows}</tbody>
      </table>
    </div>`;

  return div;
}

/* ═══════════════════════════════════════════════
   EVENT DELEGATION — HAUPTFIX
   Alle Versuch-Events laufen über den Container,
   kein direktes Binding auf dynamisch generierte Elemente
═══════════════════════════════════════════════ */
let _delegationHooked = false;

function hookVersucheByDelegation(container) {
  if (_delegationHooked) return;
  _delegationHooked = true;

  /* INPUT — Messwerte, Titel, Förderrate, Intervalle */
  container.addEventListener('input', e => {
    const el      = e.target;
    const card    = el.closest('.versuch-card');
    if (!card) return;
    const vid     = card.dataset.id;
    const versuch = getVersuchById(vid);
    if (!versuch) return;
    const role    = el.dataset.role;

    if (role === 'titel') {
      versuch.titel = el.value;
      saveDraftDebounced();
      return;
    }

    if (role === 'foerderrate') {
      versuch.foerderrate_ls = el.value;
      const m3hEl = card.querySelector('[data-role="m3h"]');
      if (m3hEl) {
        const val = lsToM3h(el.value);
        m3hEl.textContent = val ? `${val} m³/h` : '—';
      }
      saveDraftDebounced();
      return;
    }

    if (role === 'foerder-m') {
      const mIdx = Number(el.dataset.midx);
      if (versuch.messungen[mIdx]) versuch.messungen[mIdx].foerder_m = el.value;
      updateDeltaCell(card, mIdx, 'foerder-delta', el.value, state.foerder.ruhe);
      saveDraftDebounced();
      return;
    }

    if (role === 'schluck-m') {
      const mIdx = Number(el.dataset.midx);
      if (versuch.messungen[mIdx]) versuch.messungen[mIdx].schluck_m = el.value;
      updateDeltaCell(card, mIdx, 'schluck-delta', el.value, state.schluck.ruhe);
      saveDraftDebounced();
      return;
    }
  });

  /* CHANGE — Intervalle (nur bei Verlust des Fokus) */
  container.addEventListener('change', e => {
    const el   = e.target;
    const card = el.closest('.versuch-card');
    if (!card) return;
    const vid     = card.dataset.id;
    const versuch = getVersuchById(vid);
    if (!versuch) return;
    const role    = el.dataset.role;

    if (role === 'intervalle') {
      const parsed = parseIntervalStr(el.value);
      if (!parsed.length) {
        alert('Bitte mindestens ein gültiges Intervall eingeben.');
        el.value = versuch.intervalleStr;
        return;
      }
      versuch.intervalleStr = parsed.join(', ');
      // Messungen neu aufbauen, bestehende Werte erhalten
      const old = Array.isArray(versuch.messungen) ? versuch.messungen : [];
      versuch.messungen = parsed.map(min => {
        const hit = old.find(m => Number(m.min) === Number(min));
        return hit || { min, foerder_m: '', schluck_m: '' };
      });
      hardStopTimer(vid);
      renderVersuche();
      saveDraftDebounced();
      return;
    }

    if (role === 'foerderrate') {
      versuch.foerderrate_ls = el.value;
      saveDraftDebounced();
    }

    if (role === 'titel') {
      versuch.titel = el.value;
      saveDraftDebounced();
    }
  });

  /* CLICK — Löschen, Timer-Buttons */
  container.addEventListener('click', e => {
    const btn  = e.target.closest('[data-role]');
    if (!btn) return;
    const card = btn.closest('.versuch-card');
    if (!card) return;
    const vid     = card.dataset.id;
    const versuch = getVersuchById(vid);
    if (!versuch) return;
    const role    = btn.dataset.role;

    if (role === 'del') {
      if (state.versuche.length <= 1) {
        alert('Mindestens ein Pumpversuch muss vorhanden sein.');
        return;
      }
      if (!confirm(`„${versuch.titel || 'Versuch'}" wirklich löschen?`)) return;
      hardStopTimer(vid);
      state.versuche = state.versuche.filter(v => v.id !== vid);
      renderVersuche();
      saveDraftDebounced();
      return;
    }

    if (role === 'timer-start')  { startTimer(vid); return; }
    if (role === 'timer-stop')   { stopTimer(vid);  return; }
    if (role === 'timer-reset')  { resetTimer(vid); return; }
  });
}

/* Hilfsfunktion: Delta-Zelle in einer Zeile aktualisieren */
function updateDeltaCell(card, mIdx, deltaRole, messwert, ruhe) {
  const row  = card.querySelector(`tr[data-midx="${mIdx}"]`);
  const cell = row?.querySelector(`[data-role="${deltaRole}"]`);
  if (!cell) return;
  const d = calcDelta(messwert, ruhe);
  cell.textContent = d !== '' ? d : '—';
}

/* ═══════════════════════════════════════════════
   DELTA REFRESH (wenn Ruhewasser geändert)
═══════════════════════════════════════════════ */
function refreshAllDeltas() {
  document.querySelectorAll('.versuch-card').forEach(card => {
    const versuch = getVersuchById(card.dataset.id);
    if (!versuch) return;
    versuch.messungen.forEach((mess, mIdx) => {
      updateDeltaCell(card, mIdx, 'foerder-delta', mess.foerder_m, state.foerder.ruhe);
      updateDeltaCell(card, mIdx, 'schluck-delta', mess.schluck_m, state.schluck.ruhe);
    });
  });
}

/* ═══════════════════════════════════════════════
   STOPPUHR
═══════════════════════════════════════════════ */
function ensureTimer(vid, versuch) {
  if (!timerMap
