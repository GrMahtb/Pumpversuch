'use strict';
console.log('HTB Pumpversuch app.js v1-full loaded');

/* ═══════════════════════════════════════════════
   KONSTANTEN
═══════════════════════════════════════════════ */
const STORAGE_DRAFT   = 'htb-pumpversuch-draft-v1';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v1';
const HISTORY_MAX     = 30;

const DEFAULT_INTERVALLE = [0, 1, 2, 3, 4, 5, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];

const $ = (id) => document.getElementById(id);

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
const state = {
  meta: {
    objekt: '',
    grundstueck: '',
    ort: '',
    auftragsnummer: '',
    bohrmeister: '',
    geologie: '',
    bauleitung: '',
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

// Timer-Zustände je Versuch-ID
// { [id]: { running, startMs, accumulatedMs, raf, alarmCount } }
const timerMap = {};

/* ═══════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════ */
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
function fmtNum(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '';
}
function fmtComma(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '—';
}
function parseIntervalStr(str) {
  const arr = String(str || '')
    .split(',')
    .map(s => Number(String(s).trim()))
    .filter(n => Number.isFinite(n) && n >= 0);

  // eindeutige, sortierte Werte
  return [...new Set(arr)].sort((a, b) => a - b);
}
function lsToM3h(ls) {
  const n = Number(ls);
  return Number.isFinite(n) ? (n * 3.6).toFixed(4) : '';
}
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatTimeHHMMSS(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}
function dateDE(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}
function dateTag(d = new Date()) {
  return String(d.getDate()).padStart(2, '0')
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getFullYear());
}
function calcDelta(messwert, ruhe) {
  const m = Number(messwert);
  const r = Number(ruhe);
  if (!Number.isFinite(m) || !Number.isFinite(r) || String(messwert).trim() === '') return '';
  return (m - r).toFixed(3);
}
function niceNumber(x, round) {
  const exp = Math.floor(Math.log10(x));
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
    min = 0; max = 10;
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
  return { min: niceMin, max: niceMax, step, ticks };
}
function getCurrentVersuchIndexById(id) {
  return state.versuche.findIndex(v => v.id === id);
}
function getVersuchById(id) {
  return state.versuche.find(v => v.id === id);
}

/* ═══════════════════════════════════════════════
   DEFAULT-VERSUCH
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
    messungen: intervalle.map(min => ({
      min,
      foerder_m: '',
      schluck_m: ''
    }))
  };
}
function defaultVersuche3() {
  return [defaultVersuch(0), defaultVersuch(1), defaultVersuch(2)];
}
function hydrateVersuch(v, idx = 0) {
  const base = defaultVersuch(idx);
  const intervalle = v?.intervalleStr ? parseIntervalStr(v.intervalleStr) : [...DEFAULT_INTERVALLE];
  const existing = Array.isArray(v?.messungen) ? v.messungen : [];
  return {
    ...base,
    ...v,
    elapsedMs: Number(v?.elapsedMs || 0),
    intervalleStr: intervalle.join(', '),
    messungen: intervalle.map(min => {
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

/* ═══════════════════════════════════════════════
   META / BRUNNEN UI SYNC
═══════════════════════════════════════════════ */
const META_FIELDS = [
  ['inp-objekt', 'objekt'],
  ['inp-grundstueck', 'grundstueck'],
  ['inp-ort', 'ort'],
  ['inp-auftragsnummer', 'auftragsnummer'],
  ['inp-bohrmeister', 'bohrmeister'],
  ['inp-geologie', 'geologie'],
  ['inp-bauleitung', 'bauleitung'],
  ['inp-koordination', 'koordination'],
  ['inp-geprueft-durch', 'geprueftDurch'],
  ['inp-geprueft-am', 'geprueftAm']
];
const BRUNNEN_FIELDS = [
  ['inp-foerder-dm', 'foerder', 'dm'],
  ['inp-foerder-endteufe', 'foerder', 'endteufe'],
  ['inp-foerder-ruhe', 'foerder', 'ruhe'],
  ['inp-schluck-dm', 'schluck', 'dm'],
  ['inp-schluck-endteufe', 'schluck', 'endteufe'],
  ['inp-schluck-ruhe', 'schluck', 'ruhe']
];

function syncMetaToUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id);
    if (el) el.value = state.meta[key] || '';
  });
}
function syncBrunnenToUi() {
  BRUNNEN_FIELDS.forEach(([id, section, key]) => {
    const el = $(id);
    if (el) el.value = state[section][key] || '';
  });
}
function collectMetaFromUi() {
  META_FIELDS.forEach(([id, key]) => {
    const el = $(id);
    if (el) state.meta[key] = el.value || '';
  });
}
function collectBrunnenFromUi() {
  BRUNNEN_FIELDS.forEach(([id, section, key]) => {
    const el = $(id);
    if (el) state[section][key] = el.value || '';
  });
}
function hookMetaEvents() {
  META_FIELDS.forEach(([id]) => {
    $(id)?.addEventListener('input', () => {
      collectMetaFromUi();
      saveDraftDebounced();
    });
    $(id)?.addEventListener('change', () => {
      collectMetaFromUi();
      saveDraftDebounced();
    });
  });
  BRUNNEN_FIELDS.forEach(([id]) => {
    $(id)?.addEventListener('input', () => {
      collectBrunnenFromUi();
      refreshAllDeltas();
      saveDraftDebounced();
    });
    $(id)?.addEventListener('change', () => {
      collectBrunnenFromUi();
      refreshAllDeltas();
      saveDraftDebounced();
    });
  });
}

/* ═══════════════════════════════════════════════
   DRAFT / SNAPSHOT
═══════════════════════════════════════════════ */
function collectState() {
  collectMetaFromUi();
  collectBrunnenFromUi();
  return {
    v: 1,
    meta: clone(state.meta),
    foerder: clone(state.foerder),
    schluck: clone(state.schluck),
    versuche: clone(state.versuche)
  };
}
function applyState(snapshot, render = true) {
  if (!snapshot) return;

  state.meta = {
    ...state.meta,
    ...(snapshot.meta || {})
  };
  state.foerder = {
    ...state.foerder,
    ...(snapshot.foerder || {})
  };
  state.schluck = {
    ...state.schluck,
    ...(snapshot.schluck || {})
  };

  if (Array.isArray(snapshot.versuche) && snapshot.versuche.length) {
    state.versuche = snapshot.versuche.map((v, i) => hydrateVersuch(v, i));
  } else {
    state.versuche = defaultVersuche3();
  }

  // Timer nie aus Draft fortsetzen
  Object.keys(timerMap).forEach(k => {
    try {
      if (timerMap[k]?.raf) cancelAnimationFrame(timerMap[k].raf);
    } catch {}
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
    try {
      localStorage.setItem(STORAGE_DRAFT, JSON.stringify(collectState()));
    } catch {}
  }, 250);
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    applyState(parsed, true);
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
   VERSUCHE RENDER
═══════════════════════════════════════════════ */
function rebuildMessungenFromIntervalle(versuch) {
  const intervalle = parseIntervalStr(versuch.intervalleStr);
  const old = Array.isArray(versuch.messungen) ? versuch.messungen : [];
  versuch.messungen = intervalle.map(min => {
    const hit = old.find(m => Number(m.min) === Number(min));
    return hit ? {
      min,
      foerder_m: hit.foerder_m ?? '',
      schluck_m: hit.schluck_m ?? ''
    } : {
      min,
      foerder_m: '',
      schluck_m: ''
    };
  });
}
function renderVersuche() {
  const host = $('versucheContainer');
  if (!host) return;
  host.innerHTML = '';
  state.versuche.forEach((versuch, idx) => {
    host.appendChild(buildVersuchEl(versuch, idx));
  });
  hookVersucheEvents();
}
function buildVersuchEl(versuch, idx) {
  const div = document.createElement('section');
  div.className = 'versuch-card';
  div.dataset.id = versuch.id;

  const m3h = lsToM3h(versuch.foerderrate_ls);
  const elapsed = formatElapsed(getElapsedMs(versuch.id, versuch));

  const rows = versuch.messungen.map((mess, mIdx) => {
    const fDelta = calcDelta(mess.foerder_m, state.foerder.ruhe);
    const sDelta = calcDelta(mess.schluck_m, state.schluck.ruhe);
    return `
      <tr data-midx="${mIdx}">
        <td class="min-cell">${h(mess.min)}&nbsp;min</td>
        <td>
          <input class="mess-input js-foerder-m" type="number" step="0.001" data-midx="${mIdx}"
                 value="${h(mess.foerder_m)}" placeholder="—"/>
        </td>
        <td class="delta-cell js-foerder-delta">${fDelta !== '' ? h(fDelta) : '—'}</td>
        <td>
          <input class="mess-input js-schluck-m" type="number" step="0.001" data-midx="${mIdx}"
                 value="${h(mess.schluck_m)}" placeholder="—"/>
        </td>
        <td class="delta-cell js-schluck-delta">${sDelta !== '' ? h(sDelta) : '—'}</td>
      </tr>
    `;
  }).join('');

  div.innerHTML = `
    <div class="versuch-header">
      <input class="versuch-titel-input js-titel" type="text" value="${h(versuch.titel)}" placeholder="Stufe ${idx + 1}" spellcheck="false"/>
      <button class="versuch-del-btn js-del-versuch" type="button">✕ Löschen</button>
    </div>

    <div class="versuch-foerderrate">
      <span class="foerderrate-label">Förderrate:</span>
      <input class="foerderrate-val js-foerderrate-ls" type="number" step="0.01" min="0" value="${h(versuch.foerderrate_ls)}" placeholder="0.00"/>
      <span class="foerderrate-unit">l/s</span>
      <span class="foerderrate-unit">=</span>
      <span class="foerderrate-m3h js-m3h">${m3h ? `${h(m3h)} m³/h` : '—'}</span>
    </div>

    <div class="intervall-row">
      <span class="intervall-label">Intervalle [min]:</span>
      <input class="intervall-input js-intervalle" type="text"
             value="${h(versuch.intervalleStr)}"
             placeholder="0, 1, 2, 3, 4, 5, 15, 30, 45, 60 …"/>
    </div>

    <div class="stoppuhr-block">
      <div class="stoppuhr-row">
        <div class="stoppuhr-display js-elapsed">${elapsed}</div>
        <button class="btn-start js-btn-start" type="button">▶ Start</button>
        <button class="btn-stop js-btn-stop" type="button">■ Stop</button>
        <button class="btn-reset-timer js-btn-reset-timer" type="button">↺ Reset</button>
      </div>
      <div class="startzeit-display js-startzeit">${versuch.startzeit ? `Startzeit: ${h(versuch.startzeit)}` : 'Noch nicht gestartet'}</div>
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
    </div>
  `;

  updateTimerUi(div, versuch);
  return div;
}
function hookVersucheEvents() {
  document.querySelectorAll('.versuch-card').forEach(card => {
    const vid = card.dataset.id;
    const versuch = getVersuchById(vid);
    if (!versuch) return;

    card.querySelector('.js-titel')?.addEventListener('input', (e) => {
      versuch.titel = e.target.value;
      saveDraftDebounced();
    });

    card.querySelector('.js-del-versuch')?.addEventListener('click', () => {
      if (state.versuche.length <= 1) {
        alert('Mindestens ein Pumpversuch muss vorhanden sein.');
        return;
      }
      if (!confirm(`"${versuch.titel || 'Pumpversuch'}" wirklich löschen?`)) return;

      hardStopTimer(vid);
      state.versuche = state.versuche.filter(v => v.id !== vid);
      // Titel neu durchnummerieren, wenn Standardtitel
      state.versuche.forEach((v, i) => {
        if (!v.titel || /^Stufe \d+$/i.test(v.titel.trim())) {
          v.titel = `Stufe ${i + 1}`;
        }
      });
      renderVersuche();
      saveDraftDebounced();
    });

    card.querySelector('.js-foerderrate-ls')?.addEventListener('input', (e) => {
      versuch.foerderrate_ls = e.target.value;
      const m3hEl = card.querySelector('.js-m3h');
      if (m3hEl) {
        const val = lsToM3h(e.target.value);
        m3hEl.textContent = val ? `${val} m³/h` : '—';
      }
      saveDraftDebounced();
    });

    card.querySelector('.js-intervalle')?.addEventListener('change', (e) => {
      const value = e.target.value || '';
      const parsed = parseIntervalStr(value);
      if (!parsed.length) {
        alert('Bitte mindestens ein gültiges Intervall eingeben, z. B. 0, 1, 2, 3, 4, 5, 15, 30.');
        e.target.value = versuch.intervalleStr;
        return;
      }
      versuch.intervalleStr = parsed.join(', ');
      rebuildMessungenFromIntervalle(versuch);

      const t = timerMap[vid];
      if (t) {
        const elapsedMin = getElapsedMs(vid, versuch) / 60000;
        const passed = parsed.filter(iv => iv > 0 && elapsedMin >= iv).length;
        t.alarmCount = passed;
      }

      renderVersuche();
      saveDraftDebounced();
    });

    card.querySelectorAll('.js-foerder-m').forEach(inp => {
      inp.addEventListener('input', (e) => {
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
      inp.addEventListener('input', (e) => {
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

    card.querySelector('.js-btn-start')?.addEventListener('click', () => startTimer(vid));
    card.querySelector('.js-btn-stop')?.addEventListener('click', () => stopTimer(vid));
    card.querySelector('.js-btn-reset-timer')?.addEventListener('click', () => resetTimer(vid));

    updateTimerUi(card, versuch);
  });
}

/* ═══════════════════════════════════════════════
   TIMER
═══════════════════════════════════════════════ */
function ensureTimer(vid, versuch) {
  if (!timerMap[vid]) {
    const elapsedMin = (Number(versuch?.elapsedMs || 0)) / 60000;
    const intervalle = parseIntervalStr(versuch?.intervalleStr || DEFAULT_INTERVALLE.join(', '));
    timerMap[vid] = {
      running: false,
      startMs: 0,
      accumulatedMs: Number(versuch?.elapsedMs || 0),
      raf: null,
      alarmCount: intervalle.filter(iv => iv > 0 && elapsedMin >= iv).length
    };
  }
  return timerMap[vid];
}
function getElapsedMs(vid, versuch) {
  const t = timerMap[vid];
  if (!t) return Number(versuch?.elapsedMs || 0);
  if (t.running) {
    return t.accumulatedMs + (Date.now() - t.startMs);
  }
  return t.accumulatedMs;
}
function updateTimerUi(card, versuch) {
  if (!card || !versuch) return;
  const vid = versuch.id;
  const t = ensureTimer(vid, versuch);
  const elapsedMs = getElapsedMs(vid, versuch);
  versuch.elapsedMs = elapsedMs;

  const elapsedEl = card.querySelector('.js-elapsed');
  const startBtn  = card.querySelector('.js-btn-start');
  const stopBtn   = card.querySelector('.js-btn-stop');
  const startzeit = card.querySelector('.js-startzeit');
  const nextEl    = card.querySelector('.js-naechstes');

  if (elapsedEl) elapsedEl.textContent = formatElapsed(elapsedMs);
  if (startzeit) startzeit.textContent = versuch.startzeit ? `Startzeit: ${versuch.startzeit}` : 'Noch nicht gestartet';

  if (startBtn) {
    if (t.running) {
      startBtn.textContent = '▶ Läuft';
      startBtn.disabled = true;
    } else {
      startBtn.textContent = versuch.elapsedMs > 0 ? '▶ Weiter' : '▶ Start';
      startBtn.disabled = false;
    }
  }
  if (stopBtn) {
    stopBtn.disabled = !t.running;
  }

  const intervalle = parseIntervalStr(versuch.intervalleStr);
  const alarmIntervals = intervalle.filter(iv => iv > 0);
  const elapsedMin = elapsedMs / 60000;

  const nextIv = alarmIntervals.find(iv => elapsedMin < iv);
  if (nextEl) {
    if (nextIv !== undefined) {
      const restSec = Math.max(0, Math.ceil((nextIv * 60000 - elapsedMs) / 1000));
      nextEl.textContent = `⏱ Nächste Messung: ${nextIv} min (in ${restSec}s)`;
    } else {
      nextEl.textContent = '✅ Alle Messintervalle erreicht';
    }
  }

  // Highlight letzte erreichte Zeile
  const passedAll = intervalle.filter(iv => elapsedMin >= iv);
  const lastPassed = passedAll.length ? passedAll[passedAll.length - 1] : intervalle[0];
  card.querySelectorAll('tr[data-midx]').forEach(row => row.classList.remove('row-active'));
  const mIdx = versuch.messungen.findIndex(m => Number(m.min) === Number(lastPassed));
  if (mIdx >= 0) {
    const row = card.querySelector(`tr[data-midx="${mIdx}"]`);
    row?.classList.add('row-active');
  }
}
function tickTimer(vid) {
  const versuch = getVersuchById(vid);
  if (!versuch) return;

  const t = timerMap[vid];
  if (!t || !t.running) return;

  const card = document.querySelector(`.versuch-card[data-id="${vid}"]`);
  if (!card) return;

  const elapsedMs = getElapsedMs(vid, versuch);
  versuch.elapsedMs = elapsedMs;
  updateTimerUi(card, versuch);

  const intervalle = parseIntervalStr(versuch.intervalleStr);
  const alarmIntervals = intervalle.filter(iv => iv > 0);
  const elapsedMin = elapsedMs / 60000;
  const passedAlarmCount = alarmIntervals.filter(iv => elapsedMin >= iv).length;

  if (passedAlarmCount > t.alarmCount) {
    t.alarmCount = passedAlarmCount;
    if ('vibrate' in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  }

  t.raf = requestAnimationFrame(() => tickTimer(vid));
}
function startTimer(vid) {
  const versuch = getVersuchById(vid);
  if (!versuch) return;

  const t = ensureTimer(vid, versuch);
  if (t.running) return;

  if (!versuch.startzeit) {
    versuch.startzeit = formatTimeHHMMSS(new Date());
  }

  const elapsedMin = t.accumulatedMs / 60000;
  const intervalle = parseIntervalStr(versuch.intervalleStr);
  t.alarmCount = intervalle.filter(iv => iv > 0 && elapsedMin >= iv).length;
  t.running = true;
  t.startMs = Date.now();

  const card = document.querySelector(`.versuch-card[data-id="${vid}"]`);
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

  const card = document.querySelector(`.versuch-card[data-id="${vid}"]`);
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
  versuch.startzeit = null;

  const card = document.querySelector(`.versuch-card[data-id="${vid}"]`);
  updateTimerUi(card, versuch);
  card?.querySelectorAll('tr.row-active').forEach(r => r.classList.remove('row-active'));

  const firstIdx = versuch.messungen.findIndex(m => Number(m.min) === 0);
  if (firstIdx >= 0) {
    const row = card?.querySelector(`tr[data-midx="${firstIdx}"]`);
    row?.classList.add('row-active');
  }
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

/* ═══════════════════════════════════════════════
   DELTA REFRESH
═══════════════════════════════════════════════ */
function refreshAllDeltas() {
  document.querySelectorAll('.versuch-card').forEach(card => {
    const vid = card.dataset.id;
    const versuch = getVersuchById(vid);
    if (!versuch) return;

    versuch.messungen.forEach((mess, mIdx) => {
      const row = card.querySelector(`tr[data-midx="${mIdx}"]`);
      if (!row) return;
      const fEl = row.querySelector('.js-foerder-delta');
      const sEl = row.querySelector('.js-schluck-delta');

      const fd = calcDelta(mess.foerder_m, state.foerder.ruhe);
      const sd = calcDelta(mess.schluck_m, state.schluck.ruhe);

      if (fEl) fEl.textContent = fd !== '' ? fd : '—';
      if (sEl) sEl.textContent = sd !== '' ? sd : '—';
    });
  });
}

/* ═══════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════ */
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
  const snap = collectState();
  const entry = {
    id: uid(),
    savedAt: Date.now(),
    title: `${snap.meta?.objekt || '—'} · ${snap.meta?.ort || '—'}`,
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
    host.innerHTML = `<div class="text"><p>Noch keine Pumpversuche gespeichert.</p></div>`;
    return;
  }

  host.innerHTML = list.map(entry => {
    const snap = entry.snapshot || {};
    const stufen = Array.isArray(snap.versuche) ? snap.versuche.length : 0;
    return `
      <div class="historyItem">
        <div class="historyTop">
          <span>${h(entry.title)}</span>
          <span style="color:var(--muted);font-size:.82em">${h(new Date(entry.savedAt).toLocaleString('de-DE'))}</span>
        </div>
        <div class="historySub">
          Objekt: <b>${h(snap.meta?.objekt || '—')}</b> ·
          Ort: <b>${h(snap.meta?.ort || '—')}</b> ·
          Stufen: <b>${h(stufen)}</b>
        </div>
        <div class="historyBtns">
          <button class="btn btn--ghost" type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
          <button class="btn btn--ghost" type="button" data-hact="pdf"  data-id="${h(entry.id)}">PDF</button>
          <button class="btn btn--ghost" type="button" data-hact="del"  data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>
    `;
  }).join('');

  host.querySelectorAll('button[data-hact]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { hact, id } = btn.dataset;
      const list = readHistory();
      const entry = list.find(x => x.id === id);

      if (hact === 'del') {
        writeHistory(list.filter(x => x.id !== id));
        renderHistoryList();
        return;
      }
      if (!entry) return;

      if (hact === 'load') {
        applyState(entry.snapshot, true);
        saveDraftDebounced();
        document.querySelector('.tab[data-tab="protokoll"]')?.click();
      }
      if (hact === 'pdf') {
        try {
          await exportPdf(entry.snapshot);
        } catch (err) {
          console.error(err);
          alert('PDF-Fehler: ' + (err?.message || String(err)));
        }
      }
    });
  });
}

/* ═══════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════ */
function numericSeries(messungen, key) {
  return (messungen || [])
    .map(m => ({ x: Number(m.min), y: Number(m[key]) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}
function drawDashedHLine(page, x1, x2, y, color, dash = 5, gap = 3, thickness = 1) {
  for (let x = x1; x < x2; x += dash + gap) {
    page.drawLine({
      start: { x, y },
      end: { x: Math.min(x + dash, x2), y },
      thickness,
      color
    });
  }
}
function drawChart(page, opt) {
  const {
    x, y, w, h,
    title,
    color,
    points,
    ruhe,
    xMax = 180,
    fReg,
    fBold,
    K,
    subtitle = ''
  } = opt;

  // Rahmen
  page.drawRectangle({ x, y, width: w, height: h, borderColor: K, borderWidth: 1 });

  // Titel
  page.drawText(String(title || ''), {
    x: x + 8,
    y: y + h - 14,
    size: 10,
    font: fBold,
    color
  });
  if (subtitle) {
    page.drawText(String(subtitle), {
      x: x + 8,
      y: y + h - 26,
      size: 7.5,
      font: fReg,
      color: K
    });
  }

  const padL = 42;
  const padR = 10;
  const padB = 24;
  const padT = 34;
  const px = x + padL;
  const py = y + padB;
  const pw = w - padL - padR;
  const ph = h - padB - padT;

  if (pw <= 10 || ph <= 10) return;

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

  // Grid Y
  yAxis.ticks.forEach(t => {
    const gy = sy(t);
    page.drawLine({
      start: { x: px, y: gy },
      end: { x: px + pw, y: gy },
      thickness: 0.4,
      color: K,
      opacity: 0.25
    });
    page.drawText(fmtComma(t, 2), {
      x: x + 4,
      y: gy - 3,
      size: 7,
      font: fReg,
      color: K
    });
  });

  // Grid X
  xAxis.ticks.forEach(t => {
    const gx = sx(t);
    page.drawLine({
      start: { x: gx, y: py },
      end: { x: gx, y: py + ph },
      thickness: 0.4,
      color: K,
      opacity: 0.2
    });
    page.drawText(String(Math.round(t)), {
      x: gx - 4,
      y: y + 7,
      size: 7,
      font: fReg,
      color: K
    });
  });

  // Achsen
  page.drawLine({ start: { x: px, y: py }, end: { x: px + pw, y: py }, thickness: 1, color: K });
  page.drawLine({ start: { x: px, y: py }, end: { x: px, y: py + ph }, thickness: 1, color: K });

  page.drawText('Min', {
    x: px + pw - 12,
    y: y + 7,
    size: 7.5,
    font: fBold,
    color: K
  });
  page.drawText('m ab OK', {
    x: x + 4,
    y: y + h - 37,
    size: 7.5,
    font: fBold,
    color: K
  });

  // Ruhewasser-Linie
  if (Number.isFinite(Number(ruhe))) {
    const ry = sy(Number(ruhe));
    drawDashedHLine(page, px, px + pw, ry, K, 4, 3, 0.8);
    page.drawText(`Ruhewasser: ${fmtComma(ruhe, 3)} m`, {
      x: px + 6,
      y: ry + 3,
      size: 7,
      font: fReg,
      color: K
    });
  }

  if (points.length) {
    const pts = points
      .slice()
      .sort((a, b) => a.x - b.x)
      .map(p => ({ x: sx(p.x), y: sy(p.y) }));

    for (let i = 1; i < pts.length; i++) {
      page.drawLine({
        start: { x: pts[i - 1].x, y: pts[i - 1].y },
        end: { x: pts[i].x, y: pts[i].y },
        thickness: 1.7,
        color
      });
    }

    pts.forEach(p => {
      page.drawCircle({
        x: p.x,
        y: p.y,
        size: 2.3,
        color
      });
      page.drawCircle({
        x: p.x,
        y: p.y,
        size: 2.7,
        borderColor: K,
        borderWidth: 0.4
      });
    });
  } else {
    page.drawText('Keine Messpunkte vorhanden', {
      x: px + 12,
      y: py + ph / 2,
      size: 9,
      font: fReg,
      color: K
    });
  }
}
function drawMetaRow(page, x, y, w, h, cells, fReg, fBold, K) {
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
    page.drawText(String(c.label || ''), {
      x: cx,
      y: y + h - 10,
      size: 7,
      font: fBold,
      color: K
    });
    page.drawText(String(c.value || ''), {
      x: cx,
      y: y + 5,
      size: 8.5,
      font: fReg,
      color: K
    });
  });
}
function drawMeasurementTable(page, opt) {
  const {
    x, yTop, w, h,
    messungen,
    foerderRuhe,
    schluckRuhe,
    fReg, fBold, K,
    blue, orange
  } = opt;

  const rows = messungen || [];
  const head1 = 16;
  const head2 = 15;
  const available = h - head1 - head2;
  const rowH = Math.max(14, Math.min(18, available / Math.max(1, rows.length)));

  const c = [0.15, 0.22, 0.18, 0.22, 0.18];
  const xs = [x];
  for (let i = 0; i < c.length; i++) xs.push(xs[i] + w * c[i]);

  const yHead1 = yTop - head1;
  const yHead2 = yHead1 - head2;

  // Außenrahmen
  const totalH = head1 + head2 + rows.length * rowH;
  page.drawRectangle({ x, y: yTop - totalH, width: w, height: totalH, borderColor: K, borderWidth: 1 });

  // Header 1
  page.drawRectangle({ x, y: yHead2, width: xs[1] - xs[0], height: head1 + head2, color: { r: 0.95, g: 0.95, b: 0.95 }, borderColor: K, borderWidth: 0.6 });
  page.drawRectangle({ x: xs[1], y: yHead1, width: xs[3] - xs[1], height: head1, color: { r: 0.95, g: 0.95, b: 0.95 }, borderColor: K, borderWidth: 0.6 });
  page.drawRectangle({ x: xs[3], y: yHead1, width: xs[5] - xs[3], height: head1, color: { r: 0.95, g: 0.95, b: 0.95 }, borderColor: K, borderWidth: 0.6 });

  // Header 2
  for (let i = 1; i < 5; i++) {
    page.drawRectangle({
      x: xs[i],
      y: yHead2,
      width: xs[i + 1] - xs[i],
      height: head2,
      color: { r: 0.98, g: 0.98, b: 0.98 },
      borderColor: K,
      borderWidth: 0.6
    });
  }

  // Vertikale Linien Datenbereich
  for (let i = 1; i < xs.length - 1; i++) {
    page.drawLine({
      start: { x: xs[i], y: yTop - totalH },
      end: { x: xs[i], y: yHead2 },
      thickness: 0.6,
      color: K
    });
  }

  // Header Texte
  page.drawText('Min', {
    x: xs[0] + 8,
    y: yHead2 + 10,
    size: 8,
    font: fBold,
    color: K
  });
  page.drawText('Förderbrunnen', {
    x: xs[1] + 16,
    y: yHead1 + 4,
    size: 8.5,
    font: fBold,
    color: blue
  });
  page.drawText('Schluckbrunnen', {
    x: xs[3] + 14,
    y: yHead1 + 4,
    size: 8.5,
    font: fBold,
    color: orange
  });

  page.drawText('m ab OK', {
    x: xs[1] + 8,
    y: yHead2 + 4,
    size: 7.2,
    font: fBold,
    color: K
  });
  page.drawText('Δ Ruhe', {
    x: xs[2] + 10,
    y: yHead2 + 4,
    size: 7.2,
    font: fBold,
    color: K
  });
  page.drawText('m ab OK', {
    x: xs[3] + 8,
    y: yHead2 + 4,
    size: 7.2,
    font: fBold,
    color: K
  });
  page.drawText('Δ Ruhe', {
    x: xs[4] + 10,
    y: yHead2 + 4,
    size: 7.2,
    font: fBold,
    color: K
  });

  // Datenzeilen
  let y = yHead2;
  rows.forEach((m) => {
    const nextY = y - rowH;
    page.drawLine({
      start: { x, y: nextY },
      end: { x: x + w, y: nextY },
      thickness: 0.6,
      color: K
    });

    const fDelta = calcDelta(m.foerder_m, foerderRuhe);
    const sDelta = calcDelta(m.schluck_m, schluckRuhe);

    page.drawText(`${m.min}`, {
      x: xs[0] + 10,
      y: nextY + 4.5,
      size: 8,
      font: fBold,
      color: K
    });
    page.drawText(m.foerder_m !== '' ? fmtComma(m.foerder_m, 3) : '—', {
      x: xs[1] + 6,
      y: nextY + 4.5,
      size: 7.7,
      font: fReg,
      color: K
    });
    page.drawText(fDelta !== '' ? fmtComma(fDelta, 3) : '—', {
      x: xs[2] + 6,
      y: nextY + 4.5,
      size: 7.7,
      font: fReg,
      color: K
    });
    page.drawText(m.schluck_m !== '' ? fmtComma(m.schluck_m, 3) : '—', {
      x: xs[3] + 6,
      y: nextY + 4.5,
      size: 7.7,
      font: fReg,
      color: K
    });
    page.drawText(sDelta !== '' ? fmtComma(sDelta, 3) : '—', {
      x: xs[4] + 6,
      y: nextY + 4.5,
      size: 7.7,
      font: fReg,
      color: K
    });

    y = nextY;
  });

  return yTop - totalH;
}
async function exportPdf(optSnapshot = null) {
  const snap = optSnapshot || collectState();

  if (!window.PDFLib || !window.fontkit) {
    alert('PDF-Library/Fontkit noch nicht geladen. Bitte kurz warten und erneut versuchen.');
    return;
  }

  const { PDFDocument, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);

  // Fonts
  let fReg, fBold;
  try {
    const arial = await fetch('arial.ttf').then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
    fReg = await pdf.embedFont(arial, { subset: true });

    const arialBold = await fetch('ARIALBD.TTF').then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
    fBold = await pdf.embedFont(arialBold, { subset: true });
  } catch {
    const { StandardFonts } = window.PDFLib;
    fReg  = await pdf.embedFont(StandardFonts.Helvetica);
    fBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  }

  // Logo
  let logo = null;
  try {
    const logoBytes = await fetch('logo.png').then(r => r.arrayBuffer());
    logo = await pdf.embedPng(logoBytes);
  } catch {}

  const PAGE_W = 841.89; // A4 Landscape
  const PAGE_H = 595.28;
  const mm = (v) => v * 72 / 25.4;

  const K = rgb(0, 0, 0);
  const BLUE = rgb(0.231, 0.616, 0.867);
  const ORANGE = rgb(0.961, 0.651, 0.137);
  const HEADER_BG = rgb(0.08, 0.08, 0.08);
  const LIGHT = rgb(0.95, 0.95, 0.95);
  const YELLOW = rgb(1, 0.929, 0);

  const meta = snap.meta || {};
  const foerder = snap.foerder || {};
  const schluck = snap.schluck || {};
  const versuche = Array.isArray(snap.versuche) && snap.versuche.length ? snap.versuche : defaultVersuche3();

  for (let i = 0; i < versuche.length; i++) {
    const v = hydrateVersuch(versuche[i], i);

    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const margin = mm(8);
    const x0 = margin;
    const y0 = margin;
    const W = PAGE_W - 2 * margin;
    const H = PAGE_H - 2 * margin;

    page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: K, borderWidth: 1.2 });

    // Header
    const hdrH = mm(14);
    page.drawRectangle({ x: x0, y: y0 + H - hdrH, width: W, height: hdrH, color: HEADER_BG, borderColor: K, borderWidth: 0.8 });

    if (logo) {
      const lh = hdrH * 0.78;
      const scale = lh / logo.height;
      const ly = y0 + H - hdrH + (hdrH - lh) / 2;
      page.drawRectangle({
        x: x0 + mm(2),
        y: ly - mm(0.4),
        width: logo.width * scale + mm(2),
        height: lh + mm(0.8),
        color: YELLOW
      });
      page.drawImage(logo, {
        x: x0 + mm(3),
        y: ly,
        width: logo.width * scale,
        height: lh
      });
    }

    page.drawText('Pumpversuch-Protokoll', {
      x: x0 + mm(37),
      y: y0 + H - hdrH + mm(4.5),
      size: 13,
      font: fBold,
      color: rgb(1, 1, 1)
    });
    page.drawText('HTB Baugesellschaft m.b.H.', {
      x: x0 + mm(37),
      y: y0 + H - hdrH + mm(1.5),
      size: 8,
      font: fReg,
      color: rgb(0.75, 0.75, 0.75)
    });

    const rightText = `${v.titel || `Stufe ${i + 1}`} · ${v.foerderrate_ls || '—'} l/s · ${lsToM3h(v.foerderrate_ls) || '—'} m³/h`;
    page.drawText(rightText, {
      x: x0 + W - mm(86),
      y: y0 + H - hdrH + mm(4),
      size: 10,
      font: fBold,
      color: YELLOW
    });

    // Meta-Raster
    let cy = y0 + H - hdrH - mm(7);
    const metaW = W;
    const rowH = mm(10);

    drawMetaRow(page, x0, cy - rowH, metaW, rowH, [
      { label: 'Objekt', value: meta.objekt || '' },
      { label: 'Grundstück / Straße', value: meta.grundstueck || '' },
      { label: 'Geprüft durch', value: meta.geprueftDurch || '' },
      { label: 'Geprüft am', value: dateDE(meta.geprueftAm) || '' }
    ], fReg, fBold, K);
    cy -= rowH;

    drawMetaRow(page, x0, cy - rowH, metaW, rowH, [
      { label: 'Ort', value: meta.ort || '' },
      { label: 'Auftragsnummer', value: meta.auftragsnummer || '' },
      { label: 'Geologie', value: meta.geologie || '' },
      { label: 'Bauleitung', value: meta.bauleitung || '' }
    ], fReg, fBold, K);
    cy -= rowH;

    drawMetaRow(page, x0, cy - rowH, metaW, rowH, [
      { label: 'Bohrmeister', value: meta.bohrmeister || '' },
      { label: 'Koordination', value: meta.koordination || '' },
      { label: 'Förderbrunnen', value: `Ø ${foerder.dm || '—'} mm · ET ${foerder.endteufe || '—'} m · RW ${foerder.ruhe || '—'} m` },
      { label: 'Schluckbrunnen', value: `Ø ${schluck.dm || '—'} mm · ET ${schluck.endteufe || '—'} m · RW ${schluck.ruhe || '—'} m` }
    ], fReg, fBold, K);
    cy -= rowH;

    // Content area
    const contentTop = cy - mm(4);
    const contentBottom = y0 + mm(8);
    const contentH = contentTop - contentBottom;

    const tableW = W * 0.43;
    const chartsX = x0 + tableW + mm(4);
    const chartsW = W - tableW - mm(4);

    // Tabelle links
    drawMeasurementTable(page, {
      x: x0,
      yTop: contentTop,
      w: tableW,
      h: contentH,
      messungen: v.messungen || [],
      foerderRuhe: foerder.ruhe,
      schluckRuhe: schluck.ruhe,
      fReg,
      fBold,
      K,
      blue: BLUE,
      orange: ORANGE
    });

    // Diagramme rechts
    const chartGap = mm(4);
    const chartH = (contentH - chartGap) / 2;

    drawChart(page, {
      x: chartsX,
      y: contentBottom + chartH + chartGap,
      w: chartsW,
      h: chartH,
      title: '🔵 Diagramm Förderbrunnen',
      subtitle: 'Wasserstand [m ab OK Brunnenausbau]',
      color: BLUE,
      points: numericSeries(v.messungen, 'foerder_m'),
      ruhe: Number(foerder.ruhe),
      xMax: Math.max(180, ...(v.messungen || []).map(m => Number(m.min) || 0)),
      fReg,
      fBold,
      K
    });

    drawChart(page, {
      x: chartsX,
      y: contentBottom,
      w: chartsW,
      h: chartH,
      title: '🟠 Diagramm Schluckbrunnen',
      subtitle: 'Wasserstand [m ab OK Brunnenausbau]',
      color: ORANGE,
      points: numericSeries(v.messungen, 'schluck_m'),
      ruhe: Number(schluck.ruhe),
      xMax: Math.max(180, ...(v.messungen || []).map(m => Number(m.min) || 0)),
      fReg,
      fBold,
      K
    });

    // Footer
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
      font: fReg,
      color: K
    });
    page.drawText(`Seite ${i + 1}/${versuche.length}`, {
      x: x0 + W - 40,
      y: y0 + 4,
      size: 7,
      font: fReg,
      color: K
    });
  }

  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const obj = (snap.meta?.objekt || 'Pumpversuch').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_');
  const name = `${dateTag(new Date())}_HTB_Pumpversuch_${obj || 'Protokoll'}.pdf`;

  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ═══════════════════════════════════════════════
   RESET
═══════════════════════════════════════════════ */
function resetAll() {
  if (!confirm('Alle Eingaben wirklich zurücksetzen?')) return;

  Object.keys(timerMap).forEach(hardStopTimer);

  state.meta = {
    objekt: '',
    grundstueck: '',
    ort: '',
    auftragsnummer: '',
    bohrmeister: '',
    geologie: '',
    bauleitung: '',
    koordination: '',
    geprueftDurch: '',
    geprueftAm: ''
  };
  state.foerder = { dm: '', endteufe: '', ruhe: '' };
  state.schluck = { dm: '', endteufe: '', ruhe: '' };
  state.versuche = defaultVersuche3();

  syncMetaToUi();
  syncBrunnenToUi();
  renderVersuche();
  saveDraftDebounced();
}

/* ═══════════════════════════════════════════════
   INSTALL BUTTON
═══════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  if (!state.versuche.length) {
    state.versuche = defaultVersuche3();
  }

  initTabs();
  hookMetaEvents();
  loadDraft();

  if (!state.versuche.length) {
    state.versuche = defaultVersuche3();
  }

  syncMetaToUi();
  syncBrunnenToUi();
  renderVersuche();
  renderHistoryList();
  initInstallButton();

  $('btnAddVersuch')?.addEventListener('click', () => {
    const idx = state.versuche.length;
    const v = defaultVersuch(idx);
    state.versuche.push(v);
    renderVersuche();
    saveDraftDebounced();

    setTimeout(() => {
      const card = document.querySelector(`.versuch-card[data-id="${v.id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card?.querySelector('.js-titel')?.focus();
    }, 50);
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
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('SW registration failed:', err);
    });
  }
});
