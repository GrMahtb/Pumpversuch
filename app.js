'use strict';
console.log('HTB Pumpversuch app.js v1 loaded');

/* ═══════════════════════════════════════════════
   KONSTANTEN
═══════════════════════════════════════════════ */
const STORAGE_DRAFT   = 'htb-pumpversuch-draft-v1';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v1';
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

// Laufende Timer pro versuch { [id]: { running, startMs, raf, alarmIdx } }
const timerMap = {};

/* ═══════════════════════════════════════════════
   HILFSFUNKTIONEN
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
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}
function fmtComma(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
}
function parseIntervalStr(str) {
  return String(str || '').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 0);
}
function lsToM3h(ls) {
  const n = Number(ls);
  return Number.isFinite(n) ? (n * 3.6).toFixed(4) : '';
}
function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function formatTimeHHMM(date) {
  return String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0') + ':' + String(date.getSeconds()).padStart(2,'0');
}
function dateDE(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}
function dateTag(d = new Date()) {
  return String(d.getDate()).padStart(2,'0') +
         String(d.getMonth()+1).padStart(2,'0') +
         String(d.getFullYear());
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
    intervalleStr: intervalle.join(', '),
    messungen: intervalle.map(min => ({
      min,
      foerder_m: min === 0 ? '' : '',
      schluck_m: min === 0 ? '' : ''
    }))
  };
}

function hydrateVersuch(v, idx) {
  const base = defaultVersuch(idx);
  const intervalle = v.intervalleStr
    ? parseIntervalStr(v.intervalleStr)
    : DEFAULT_INTERVALLE;
  return {
    ...base, ...v,
    messungen: Array.isArray(v.messungen) && v.messungen.length
      ? v.messungen
      : intervalle.map(min => ({ min, foerder_m: '', schluck_m: '' }))
  };
}

/* ═══════════════════════════════════════════════
   DELTA BERECHNUNG
═══════════════════════════════════════════════ */
function calcDelta(messwert, ruhe) {
  const m = Number(messwert);
  const r = Number(ruhe);
  if (!Number.isFinite(m) || !Number.isFinite(r) || String(messwert).trim() === '') return '';
  return (m - r).toFixed(3);
}

/* ═══════════════════════════════════════════════
   DRAFT
═══════════════════════════════════════════════ */
let _saveT = null;
function saveDraftDebounced() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => {
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(collectState())); } catch {}
  }, 300);
}

function collectState() {
  return {
    v: 1,
    meta: { ...state.meta },
    foerder: { ...state.foerder },
    schluck: { ...state.schluck },
    versuche: state.versuche.map(v => ({ ...v }))
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (!raw) return;
    applyState(JSON.parse(raw), false);
  } catch {}
}

function applyState(snap, render = true) {
  if (!snap) return;
  if (snap.meta) state.meta = { ...state.meta, ...snap.meta };
  if (snap.foerder) state.foerder = { ...state.foerder, ...snap.foerder };
  if (snap.schluck) state.schluck = { ...state.schluck, ...snap.schluck };
  if (Array.isArray(snap.versuche)) {
    state.versuche = snap.versuche.length
      ? snap.versuche.map((v, i) => hydrateVersuch(v, i))
      : [defaultVersuch(0)];
  }
  if (render) {
    syncMetaToUi();
    syncBrunnenToUi();
    renderVersuche();
  }
}

/* ═══════════════════════════════════════════════
   META SYNC
═══════════════════════════════════════════════ */
const META_FIELDS = [
  ['inp-objekt',       'objekt'],
  ['inp-grundstueck',  'grundstueck'],
  ['inp-ort',          'ort'],
  ['inp-auftragsnummer','auftragsnummer'],
  ['inp-bohrmeister',  'bohrmeister'],
  ['inp-geologie',     'geologie'],
  ['inp-bauleitung',   'bauleitung'],
  ['inp-koordination', 'koordination'],
  ['inp-geprueft-durch','geprueftDurch'],
  ['inp-geprueft-am',  'geprueftAm']
];
const BRUNNEN_FIELDS = [
  ['inp-foerder-dm',      'foerder', 'dm'],
  ['inp-foerder-endteufe','foerder', 'endteufe'],
  ['inp-foerder-ruhe',    'foerder', 'ruhe'],
  ['inp-schluck-dm',      'schluck', 'dm'],
  ['inp-schluck-endteufe','schluck', 'endteufe'],
  ['inp-schluck-ruhe',    'schluck', 'ruhe'],
];

function syncMetaToUi() {
  META_FIELDS.forEach(([id, key]) => { const el = $(id); if (el) el.value = state.meta[key] || ''; });
}
function syncBrunnenToUi() {
  BRUNNEN_FIELDS.forEach(([id, brunnen, key]) => { const el = $(id); if (el) el.value = state[brunnen][key] || ''; });
}
function collectMetaFromUi() {
  META_FIELDS.forEach(([id, key]) => { const el = $(id); if (el) state.meta[key] = el.value || ''; });
}
function collectBrunnenFromUi() {
  BRUNNEN_FIELDS.forEach(([id, brunnen, key]) => { const el = $(id); if (el) state[brunnen][key] = el.value || ''; });
}
function hookMetaEvents() {
  META_FIELDS.forEach(([id]) => {
    $(id)?.addEventListener('input',  () => { collectMetaFromUi(); saveDraftDebounced(); });
    $(id)?.addEventListener('change', () => { collectMetaFromUi(); saveDraftDebounced(); });
  });
  BRUNNEN_FIELDS.forEach(([id]) => {
    $(id)?.addEventListener('input',  () => { collectBrunnenFromUi(); refreshAllDeltas(); saveDraftDebounced(); });
    $(id)?.addEventListener('change', () => { collectBrunnenFromUi(); refreshAllDeltas(); saveDraftDebounced(); });
  });
}

/* ═══════════════════════════════════════════════
   RENDER VERSUCHE
═══════════════════════════════════════════════ */
function renderVersuche() {
  const container = $('versucheContainer');
  if (!container) return;
  container.innerHTML = '';
  state.versuche.forEach((v, idx) => container.appendChild(buildVersuchEl(v, idx)));
  hookVersucheEvents();
}

function buildVersuchEl(versuch, idx) {
  const div = document.createElement('div');
  div.className = 'versuch-card';
  div.dataset.id = versuch.id;

  const foerderRuhe = state.foerder.ruhe;
  const schluckRuhe = state.schluck.ruhe;
  const m3h = lsToM3h(versuch.foerderrate_ls);
  const startzeitStr = versuch.startzeit
    ? `Startzeit: ${versuch.startzeit}`
    : 'Noch nicht gestartet';

  const rows = versuch.messungen.map((mess, mIdx) => {
    const fd = calcDelta(mess.foerder_m, foerderRuhe);
    const sd = calcDelta(mess.schluck_m, schluckRuhe);
    return `
      <tr data-midx="${mIdx}">
        <td class="min-cell">${mess.min}&nbsp;min</td>
        <td><input class="mess-input js-foerder-m" type="number" step="0.001"
             data-midx="${mIdx}" value="${h(mess.foerder_m)}" placeholder="—"/></td>
        <td class="delta-cell js-foerder-delta">${fd !== '' ? fd : '—'}</td>
        <td><input class="mess-input js-schluck-m" type="number" step="0.001"
             data-midx="${mIdx}" value="${h(mess.schluck_m)}" placeholder="—"/></td>
        <td class="delta-cell js-schluck-delta">${sd !== '' ? sd : '—'}</td>
      </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="versuch-header">
      <input class="versuch-titel-input js-titel" value="${h(versuch.titel)}" placeholder="Stufe ${idx+1}" spellcheck="false"/>
      <button class="versuch-del-btn js-del-versuch" type="button" title="Versuch löschen">✕ Löschen</button>
    </div>

    <div class="versuch-foerderrate">
      <span class="foerderrate-label">Förderrate:</span>
      <input class="foerderrate-val js-foerderrate-ls" type="number" step="0.01" min="0"
             value="${h(versuch.foerderrate_ls)}" placeholder="0.00"/>
      <span class="foerderrate-unit">l/s</span>
      <span class="foerderrate-unit">=</span>
      <span class="foerderrate-m3h js-m3h">${m3h ? m3h + ' m³/h' : '—'}</span>
    </div>

    <div class="intervall-row">
      <span class="intervall-label">Intervalle [min]:</span>
      <input class="intervall-input js-intervalle"
             value="${h(versuch.intervalleStr)}"
             placeholder="0, 1, 2, 3, 4, 5, 15, 30, …"/>
    </div>

    <div class="stoppuhr-block">
      <div class="stoppuhr-row">
        <div class="stoppuhr-display js-elapsed">00:00</div>
        <button class="btn-start js-btn-start" type="button">▶ Start</button>
        <button class="btn-stop  js-btn-stop"  type="button">■ Stop</button>
        <button class="btn-reset-timer js-btn-reset-timer" type="button">↺ Reset</button>
      </div>
      <div class="startzeit-display js-startzeit">${startzeitStr}</div>
      <div class="stoppuhr-naechstes js-naechstes"></div>
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
        <tbody class="js-mess-tbody">${rows}</tbody>
      </table>
    </div>`;

  return div;
}

function hookVersucheEvents() {
  document.querySelectorAll('.versuch-card').forEach(card => {
    const vid = card.dataset.id;
    const versuch = state.versuche.find(v => v.id === vid);
    if (!versuch) return;

    // Titel
    card.querySelector('.js-titel')?.addEventListener('input', e => {
      versuch.titel = e.target.value;
      saveDraftDebounced();
    });

    // Löschen
    card.querySelector('.js-del-versuch')?.addEventListener('click', () => {
      if (state.versuche.length <= 1) { alert('Mindestens ein Pumpversuch muss vorhanden sein.'); return; }
      if (!confirm(`"${versuch.titel}" wirklich löschen?`)) return;
      stopTimer(vid);
      state.versuche = state.versuche.filter(v => v.id !== vid);
      renderVersuche();
      saveDraftDebounced();
    });

    // Förderrate
    card.querySelector('.js-foerderrate-ls')?.addEventListener('input', e => {
      versuch.foerderrate_ls = e.target.value;
      const m3hEl = card.querySelector('.js-m3h');
      if (m3hEl) m3hEl.textContent = lsToM3h(e.target.value) ? lsToM3h(e.target.value) + ' m³/h' : '—';
      saveDraftDebounced();
    });

    // Intervalle
    card.querySelector('.js-intervalle')?.addEventListener('change', e => {
      versuch.intervalleStr = e.target.value;
      const newInterv = parseIntervalStr(e.target.value);
      versuch.messungen = newInterv.map(min => {
        const existing = versuch.messungen.find(m => m.min === min);
        return existing || { min, foerder_m: '', schluck_m: '' };
      });
      stopTimer(vid);
      renderVersuche();
      saveDraftDebounced();
    });

    // Messwert-Inputs
    card.querySelectorAll('.js-foerder-m').forEach(inp => {
      inp.addEventListener('input', e => {
        const mIdx = Number(e.target.dataset.midx);
        versuch.messungen[mIdx].foerder_m = e.target.value;
        const row = card.querySelector(`tr[data-midx="${mIdx}"]`);
        const deltaEl = row?.querySelector('.js-foerder-delta');
        if (deltaEl) {
          const d = calcDelta(e.target.value, state.foerder.ruhe);
          deltaEl.textContent = d !== '' ? d : '—';
        }
        saveDraftDebounced();
      });
    });
    card.querySelectorAll('.js-schluck-m').forEach(inp => {
      inp.addEventListener('input', e => {
        const mIdx = Number(e.target.dataset.midx);
        versuch.messungen[mIdx].schluck_m = e.target.value;
        const row = card.querySelector(`tr[data-midx="${mIdx}"]`);
        const deltaEl = row?.querySelector('.js-schluck-delta');
        if (deltaEl) {
          const d = calcDelta(e.target.value, state.schluck.ruhe);
          deltaEl.textContent = d !== '' ? d : '—';
        }
        saveDraftDebounced();
      });
    });

    // Stoppuhr
    card.querySelector('.js-btn-start')?.addEventListener('click', () => startTimer(vid, card, versuch));
    card.querySelector('.js-btn-stop') ?.addEventListener('click', () => stopTimer(vid, card));
    card.querySelector('.js-btn-reset-timer')?.addEventListener('click', () => resetTimer(vid, card, versuch));

    // Timer-UI initial setzen
    const t = timerMap[vid];
    if (t && t.running) {
      tickTimer(vid, card, versuch);
    }
  });
}

/* ═══════════════════════════════════════════════
   STOPPUHR / TIMER
═══════════════════════════════════════════════ */
function startTimer(vid, card, versuch) {
  if (timerMap[vid]?.running) return;
  const now = Date.now();
  timerMap[vid] = {
    running: true,
    startMs: now,
    raf: null,
    alarmIdx: 0
  };
  versuch.startzeit = formatTimeHHMM(new Date(now));
  const stEl = card.querySelector('.js-startzeit');
  if (stEl) stEl.textContent = `Startzeit: ${versuch.startzeit}`;
  saveDraftDebounced();
  tickTimer(vid, card, versuch);
}

function stopTimer(vid, card) {
  const t = timerMap[vid];
  if (!t) return;
  t.running = false;
  if (t.raf) cancelAnimationFrame(t.raf);
  t.raf = null;
  if (card) {
    const el = card.querySelector('.js-btn-start');
    if (el) { el.textContent = '▶ Start'; el.disabled = false; }
    const stopEl = card.querySelector('.js-btn-stop');
    if (stopEl) stopEl.disabled = true;
  }
}

function resetTimer(vid, card, versuch) {
  stopTimer(vid, card);
  timerMap[vid] = null;
  versuch.startzeit = null;
  if (card) {
    const el = card.querySelector('.js-elapsed');
    if (el) el.textContent = '00:00';
    const st = card.querySelector('.js-startzeit');
    if (st) st.textContent = 'Noch nicht gestartet';
    const nx = card.querySelector('.js-naechstes');
    if (nx) nx.textContent = '';
    const startBtn = card.querySelector('.js-btn-start');
    if (startBtn) { startBtn.textContent = '▶ Start'; startBtn.disabled = false; }
    // alle aktiven Zeilen zurücksetzen
    card.querySelectorAll('tr.row-active').forEach(r => r.classList.remove('row-active'));
  }
  saveDraftDebounced();
}

function tickTimer(vid, card, versuch) {
  const t = timerMap[vid];
  if (!t || !t.running) return;

  const elapsed = Date.now() - t.startMs;
  const elapsedMin = elapsed / 60000;

  // Display
  const elEl = card.querySelector('.js-elapsed');
  if (elEl) elEl.textContent = formatElapsed(elapsed);

  // Intervalle prüfen
  const intervalle = parseIntervalStr(versuch.intervalleStr);
  // Welche Intervalle wurden bereits überschritten?
  const alreadyPassed = intervalle.filter(iv => elapsedMin >= iv);
  const nextIv = intervalle.find(iv => elapsedMin < iv);

  // Nächstes Intervall anzeigen
  const nxEl = card.querySelector('.js-naechstes');
  if (nxEl) {
    if (nextIv !== undefined) {
      const remaining = (nextIv * 60000) - elapsed;
      const remSec = Math.ceil(remaining / 1000);
      nxEl.textContent = `⏱ Nächste Messung: ${nextIv} min (in ${remSec}s)`;
    } else {
      nxEl.textContent = '✅ Alle Messintervalle erreicht';
    }
  }

  // Aktive Zeile highlighten (letzte erreichte)
  const lastPassed = alreadyPassed.length > 0 ? alreadyPassed[alreadyPassed.length - 1] : null;
  card.querySelectorAll('tr[data-midx]').forEach(row => row.classList.remove('row-active'));
  if (lastPassed !== null) {
    const messIdx = versuch.messungen.findIndex(m => m.min === lastPassed);
    if (messIdx >= 0) {
      const activeRow = card.querySelector(`tr[data-midx="${messIdx}"]`);
      if (activeRow) activeRow.classList.add('row-active');
    }
  }

  // Vibration: Wenn ein neues Intervall gerade erreicht wurde
  if (t.alarmIdx < alreadyPassed.length) {
    // Neues Intervall erreicht!
    t.alarmIdx = alreadyPassed.length;
    if ('vibrate' in navigator) navigator.vibrate([150, 80, 150]);
  }

  t.raf = requestAnimationFrame(() => tickTimer(vid, card, versuch));
}

/* ═══════════════════════════════════════════════
   DELTA REFRESH
═══════════════════════════════════════════════ */
function refreshAllDeltas() {
  document.querySelectorAll('.versuch-card').forEach(card => {
    const vid = card.dataset.id;
    const versuch = state.versuche.find(v => v.id === vid);
    if (!versuch) return;
    versuch.messungen.forEach((mess, mIdx) => {
      const row = card.querySelector(`tr[data-midx="${mIdx}"]`);
      if (!row) return;
      const fEl = row.querySelector('.js-foerder-delta');
      const sEl = row.querySelector('.js-schluck-delta');
      if (fEl) {
        const d = calcDelta(mess.foerder_m, state.foerder.ruhe);
        fEl.textContent = d !== '' ? d : '—';
      }
      if (sEl) {
        const d = calcDelta(mess.schluck_m, state.schluck.ruhe);
        sEl.textContent = d !== '' ? d : '—';
      }
    });
  });
}

/* ═══════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════ */
function readHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]'); } catch { return []; } }
function writeHistory(list) { try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch {} }

function saveCurrentToHistory() {
  collectMetaFromUi();
  collectBrunnenFromUi();
  const snap = collectState();
  const entry = {
    id: uid(),
    savedAt: Date.now(),
    title: `${state.meta.objekt || '—'} · ${state.meta.ort || '—'}`,
    snapshot: snap
  };
  const list = readHistory();
  list.unshift(entry);
  writeHistory(list);
  renderHistoryList();
}

function renderHistoryList() {
  const host = $('historyList');
  if (!host) return;
  const list = readHistory();
  if (!list.length) {
    host.innerHTML = '<div class="text"><p>Noch keine Protokolle gespeichert.</p></div>';
    return;
  }
  host.innerHTML = list.map(entry => {
    const snap = entry.snapshot || {};
    const stufen = (snap.versuche || []).length;
    return `
      <div class="historyItem">
        <div class="historyTop">
          <span>${h(entry.title)}</span>
          <span style="color:var(--muted);font-size:.82em">${new Date(entry.savedAt).toLocaleString('de-DE')}</span>
        </div>
        <div class="historySub">
          Objekt: <b>${h(snap.meta?.objekt || '—')}</b> ·
          Ort: <b>${h(snap.meta?.ort || '—')}</b> ·
          Stufen: <b>${stufen}</b>
        </div>
        <div class="historyBtns">
          <button class="btn btn--ghost" type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
          <button class="btn btn--ghost" type="button" data-hact="pdf"  data-id="${h(entry.id)}">PDF</button>
          <button class="btn btn--ghost" type="button" data-hact="del"  data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>`;
  }).join('');

  host.querySelectorAll('button[data-hact]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, hact } = btn.dataset;
      if (hact === 'del') {
        writeHistory(readHistory().filter(e => e.id !== id));
        renderHistoryList();
      }
      if (hact === 'load') {
        const e = readHistory().find(e => e.id === id);
        if (!e) return;
        applyState(e.snapshot, true);
        saveDraftDebounced();
        document.querySelector('.tab[data-tab="protokoll"]')?.click();
      }
      if (hact === 'pdf') {
        const e = readHistory().find(e => e.id === id);
        if (e) await exportPdf(e.snapshot);
      }
    });
  });
}

/* ═══════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════ */
async function exportPdf(snap = null) {
  const data = snap || collectState();
  if (!window.PDFLib || !window.fontkit) {
    alert('PDF-Library noch nicht geladen. Bitte kurz warten und erneut versuchen.');
    return;
  }
  const { PDFDocument, rgb, degrees } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);

  // Fonts
  let fReg, fBold;
  try {
    const ar = await fetch('arial.ttf').then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); });
    fReg = await pdf.embedFont(ar, { subset: true });
    const ab = await fetch('ARIALBD.TTF').then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); });
    fBold = await pdf.embedFont(ab, { subset: true });
  } catch {
    const { StandardFonts } = window.PDFLib;
    fReg  = await pdf.embedFont(StandardFonts.Helvetica);
    fBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

  // Logo
  let logoImg = null;
  try {
    const lb = await fetch('logo.png').then(r => r.arrayBuffer());
    logoImg = await pdf.embedPng(lb);
  } catch {}

  const mm = v => v * 72 / 25.4;
  const K  = rgb(0, 0, 0);
  const FOERDER_COLOR = rgb(0.231, 0.616, 0.867);
  const SCHLUCK_COLOR = rgb(0.961, 0.651, 0.137);

  const meta    = data.meta || {};
  const foerder = data.foerder || {};
  const schluck = data.schluck || {};
  const versuche = data.versuche || [];

  // ── Für jeden Versuch eine Seite
  for (let vIdx = 0; vIdx < versuche.length; vIdx++) {
    const versuch = versuche[vIdx];
    const page = pdf.addPage([841.89, 595.28]); // A4 Landscape
    const PW = 841.89, PH = 595.28;
    const mg = mm(8);
    const x0 = mg, y0 = mg;
    const W  = PW - 2 * mg;
    const H  = PH - 2 * mg;

    // ── Rahmen
    page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: K, borderWidth: 1.5 });

    // ── Header
    const hdrH = mm(14);
    page.drawRectangle({ x: x0, y: y0 + H - hdrH, width: W, height: hdrH, color: rgb(.1,.1,.1), borderColor: K, borderWidth: 1 });
    if (logoImg) {
      const lh = hdrH * 0.75;
      const ls = lh / logoImg.height;
      const ly = y0 + H - hdrH + (hdrH - lh) / 2;
      // Gelber Hintergrund für Logo
      page.drawRectangle({ x: x0 + mm(2), y: ly - mm(0.5), width: logoImg.width * ls + mm(2), height: lh + mm(1), color: rgb(1, 0.929, 0) });
      page.drawImage(logoImg, { x: x0 + mm(3), y: ly, width: logoImg.width * ls, height: lh });
    }
    page.drawText('Pumpversuch-Protokoll', { x: x0 + mm(38), y: y0 + H - hdrH + mm(5), size: 14, font: fBold, color: rgb(1,1,1) });
    page.drawText('HTB Baugesellschaft m.b.H.', { x: x0 + mm(38), y: y0 + H - hdrH + mm(1.5), size: 9, font: fReg, color: rgb(.7,.7,.7) });

    // Stufen-Badge rechts im Header
    const stufenText = `${h(versuch.titel)}  ·  ${versuch.foerderrate_ls || '—'} l/s  =  ${lsToM3h(versuch.foerderrate_ls) || '—'} m³/h`;
    page.drawText(stufenText, { x: x0 + W - mm(90), y: y0 + H - hdrH + mm(4), size: 11, font: fBold, color: rgb(1,0.929,0) });

    // ── Meta-Block (Kopfzeile)
    const metaTop = y0 + H - hdrH - mm(1);
    const metaH   = mm(28);
    page.drawLine({ start: { x: x0, y: metaTop - metaH }, end: { x: x0 + W, y: metaTop - metaH }, thickness: 1, color: K });
    const col1 = x0 + mm(2);
    const col2 = x0 + W / 4 + mm(2);
    const col3 = x0 + W / 2 + mm(2);
    const col4 = x0 + W * 0.75 + mm(2);
    page.drawLine({ start: { x: x0 + W/4, y: metaTop }, end: { x: x0 + W/4, y: metaTop - metaH }, thickness: 0.5, color: K });
    page.drawLine({ start: { x: x0 + W/2, y: metaTop }, end: { x: x0 + W/2, y: metaTop - metaH }, thickness: 0.5, color: K });
    page.drawLine({ start: { x: x0 + W*.75, y: metaTop }, end: { x: x0 + W*.75, y: metaTop - metaH }, thickness: 0.5, color: K });

    const metaItems = [
      [col1, 'Objekt:', meta.objekt],
      [col2, 'Grundstück:', meta.grundstueck],
      [col3, 'Geprüft durch:', meta.geprueftDurch],
      [col4, 'Geprüft am:', dateDE(meta.geprueftAm)],
      [col1, 'Ort:', meta.ort],
      [col2, 'Auftragsnummer:', meta.auftragsnummer],
      [col3, 'Geologie:', meta.geologie],
      [col4, 'Bauleitung:', meta.bauleitung],
      [col1, 'Bohrmeister:', meta.bohrmeister],
      [col2, 'Koordination:', meta.koordination],
      [col3, 'Förderbr. Ø:', foerder.dm ? foerder.dm + ' mm' : ''],
      [col4, 'Schluckbr. Ø:', schluck.dm ? schluck.dm + ' mm' : ''],
    ];
    const mRowH = metaH / 3;
    metaItems.forEach((item, i) => {
      const rowY = metaTop - mRowH * (Math.floor(i / 4)) - mm(3);
      const cx = item[0];
      page.drawText(String(item[1]), { x: cx, y: rowY - mm(1.5), size: 7, font: fBold, color: rgb(.5,.5,.5) });
      page.drawText(String(item[2] || ''), { x: cx, y: rowY - mm(5), size: 9, font: fReg, color: K });
    });

    // ── Brunnen-Ruhewasserstand Zeile
    const rwY = metaTop - metaH + mm(2);
    page.drawText(`Ruhewasserstand Förderbr.: ${foerder.ruhe || '—'} m  |  Endteufe: ${foerder.endteufe || '—'} m`,
      { x: col1, y: rwY, size: 8, font: fReg, color: FOERDER_COLOR });
    page.drawText(`Ruhewasserstand Schluckbr.: ${schluck.ruhe || '—'} m  |  Endteufe: ${schluck.endteufe || '—'} m`,
      { x: col3, y: rwY, size: 8, font: fReg, color: SCHLUCK_COLOR });

    // ── Layout: Tabelle links (40%), Diagramme rechts (60%)
    const contentTop    = metaTop - metaH - mm(1);
    const contentBottom = y0 + mm(8);
    const contentH      = contentTop - contentBottom;
    const tableW        = W * 0.38;
    const chartAreaX    = x0 + tableW;
    const chartAreaW    = W - tableW;

    // ── TABELLE
    const thH = mm(8);
    const messungen = versuch.messungen || [];
    const rowCount  = messungen.length;
    const dataH     = contentH - thH;
    const rowH      = Math.min(mm(7), dataH / Math.max(1, rowCount));

    // Table Header
    page.drawRectangle({ x: x0, y: contentTop - thH, width: tableW, height: thH, color: rgb(.12,.12,.14), borderColor: K, borderWidth: 0.5 });
    const c0 = x0 + mm(1); const c1x = x0 + mm(16); const c2x = x0 + mm(30); const c3x = x0 + mm(44); const c4x = x0 + mm(58);
    page.drawText('Min',      { x: c0,  y: contentTop - thH + mm(3.2), size: 7.5, font: fBold, color: rgb(.8,.8,.8) });
    page.drawText('FB m',     { x: c1x, y: contentTop - thH + mm(4.5), size: 7,   font: fBold, color: FOERDER_COLOR });
    page.drawText('FB Δ',     { x: c2x, y: contentTop - thH + mm(4.5), size: 7,   font: fBold, color: FOERDER_COLOR });
    page.drawText('SB m',     { x: c3x, y: contentTop - thH + mm(4.5), size: 7,   font: fBold, color: SCHLUCK_COLOR });
    page.drawText('SB Δ',     { x: c4x, y: contentTop - thH + mm(4.5),
