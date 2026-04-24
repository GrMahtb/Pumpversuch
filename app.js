'use strict';
console.log('HTB Pumpversuch app.js v55 loaded');

const BASE = '/Pumpversuch/';
const STORAGE_DRAFT   = 'htb-pumpversuch-draft-v17';
const STORAGE_HISTORY = 'htb-pumpversuch-history-v17';
const HISTORY_MAX = 30;
const DEFAULT_INTERVALLE = [0,1,2,3,4,5,15,30,45,60,75,90,105,120,135,150,165,180];

/* ── Firmendaten aus Referenz-PDF ── */
const FIRMA = {
  name:    'HTB Baugesellschaft m.b.H.',
  slogan:  'BAUEN MIT SPEZIALISTEN ALS PARTNER',
  adresse: 'A-6471 Arzl im Pitztal, Gewerbepark Pitztal 16',
  tel:     'Tel. +43(0)5412/63975',
  email:   'office.arzl@htb-bau.at',
  web:     'www.htb-bau.at',
  sparte:  'SPEZIALTIEF BAU'
};

const $ = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
function getInitialState(){
  return {
    meta:{
      objekt:'',grundstueck:'',ort:'',geologie:'',auftragsnummer:'',auftraggeber:'',
      bauleitung:'',bohrmeister:'',koordination:'',geprueftDurch:'',geprueftAm:''
    },
    selection:{ foerder:true, schluck:false },
    foerder:{ dm:'', endteufe:'', ruhe:'' },
    schluck:{ dm:'', endteufe:'', ruhe:'' },
    overviewPhotoDataUrl:'',
    versuche:[],
    restsand:{
      imhoff:{ photoDataUrl:'', menge:'' },
      sieb:{ photoDataUrl:'', menge:'' },
      bemerkung:''
    },
    ph:{
      datum:'',bauherr:'',baustelle:'',gewaessername:'',
      sulfat:{ wert:'', photoDataUrl:'' },
      temperatur:{ wert:'', photoDataUrl:'' },
      ph:{ wert:'', photoDataUrl:'' }
    },
    settings:{ alarmDurationSec:4, pdfExportType:'protokoll' }
  };
}
const state = getInitialState();

const timerMap = {};
let _saveT = null;
let _liveT = null;
let _audioCtx = null;
let _alarmGain = null;
let _timeAdjustVid = null;
let _floatingRaf = null;
let _ocrTargetVid = null;
let _ocrTargetRowIdx = null;

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
const uid = () => crypto?.randomUUID?.() || ('id_'+Date.now()+'_'+Math.random().toString(16).slice(2));
const clone = v => JSON.parse(JSON.stringify(v));

function h(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function pdfSafe(v){
  return String(v ?? '')
    .replace(/[–—]/g,'-')
    .replace(/[•→]/g,'-')
    .replace(/[\u0000-\u001F\u007F]/g,'');
}
function fmtComma(v,d=3){
  const n=Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.',',') : '—';
}
function fmtMaybe(v,d=3){
  const n=Number(v);
  return Number.isFinite(n) ? n.toFixed(d).replace('.',',') : '—';
}
function fmtSci(v,d=2){
  const n=Number(v);
  if(!Number.isFinite(n) || n<=0) return '—';
  const [m,e]=n.toExponential(d).split('e');
  return `${m.replace('.',',')}e${Number(e)}`;
}
function fmtKf(v){
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0) return '—';
  return n>=0.001 ? `${fmtComma(n,6)} m/s` : `${fmtSci(n,2)} m/s`;
}
function dateTag(d=new Date()){
  return `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getFullYear())}`;
}
function dateDE(iso){
  const s=String(iso||'').trim();
  if(!s) return '';
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function todayIso(){ return new Date().toISOString().slice(0,10); }
function todayDE(){ return dateDE(todayIso()); }
function formatTimeHHMMSS(d=new Date()){
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function formatElapsed(ms){
  const t=Math.max(0,Math.floor(ms/1000));
  const hh=Math.floor(t/3600);
  const mm=Math.floor((t%3600)/60);
  const ss=t%60;
  return hh>0 ? `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function parseIntervalStr(str){
  return [...new Set(
    String(str||'')
      .split(',')
      .map(s=>Number(String(s).trim()))
      .filter(n=>Number.isFinite(n)&&n>=0)
  )].sort((a,b)=>a-b);
}
function lsToM3h(v){
  const n=Number(v);
  return Number.isFinite(n) ? (n*3.6).toFixed(3) : '';
}
function clamp(n,lo,hi){ return Math.max(lo,Math.min(hi,n)); }
function getVersuchById(id){ return state.versuche.find(v=>v.id===id); }
function getStageTitle(idx){ return `Stufe ${idx+1}`; }
function getSelectedWells(){ return { foerder:!!state.selection.foerder, schluck:!!state.selection.schluck }; }
function getWellLabel(key){ return key==='foerder' ? 'Förderbrunnen' : 'Rückgabebrunnen'; }
function syncIntervalleStrFromRows(v){
  v.intervalleStr=(v.messungen||[])
    .map(m=>Number(m.min))
    .filter(n=>Number.isFinite(n)&&n>=0)
    .sort((a,b)=>a-b)
    .join(', ');
}
function sortMessungen(v){
  v.messungen.sort((a,b)=>{
    const av=Number(a.min), bv=Number(b.min);
    const af=Number.isFinite(av), bf=Number.isFinite(bv);
    if(af&&bf) return av-bv;
    if(af) return -1;
    if(bf) return 1;
    return 0;
  });
  syncIntervalleStrFromRows(v);
}
function getContinueStep(v){
  const rows=(v.messungen||[]).slice().sort((a,b)=>Number(a.min)-Number(b.min));
  if(rows.length>=2){
    const step=Number(rows[rows.length-1].min)-Number(rows[rows.length-2].min);
    if(Number.isFinite(step)&&step>0) return step;
  }
  return 15;
}
function getRowsForExport(v){
  return clone(v.messungen||[]).sort((a,b)=>{
    const av=Number(a.min), bv=Number(b.min);
    if(Number.isFinite(av)&&Number.isFinite(bv)) return av-bv;
    return Number.isFinite(av)?-1:1;
  });
}
function scheduleLiveRender(){
  clearTimeout(_liveT);
  _liveT=setTimeout(()=>renderLiveTab(),90);
}
const camSvg = (w=18,h=15) =>
  `<svg viewBox="0 0 24 20" width="${w}" height="${h}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1" y="4" width="22" height="15" rx="2" stroke="white" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="4.5" stroke="white" stroke-width="1.8"/>
    <path d="M8.5 4 L10.2 1.5 L13.8 1.5 L15.5 4" stroke="white" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
    <rect x="18.5" y="6" width="2.5" height="1.8" rx="0.9" fill="white"/>
  </svg>`;

/* ══════════════════════════════════════════════════════
   RATE / Kf
══════════════════════════════════════════════════════ */
function getManualRateM3hNumber(v){
  const n=Number(v?.manualRateM3h);
  return Number.isFinite(n)?n:NaN;
}
function getEffectiveRateM3h(v){
  const n=getManualRateM3hNumber(v);
  return Number.isFinite(n)?n.toFixed(3):'';
}
function getEffectiveRateLs(v){
  const n=getManualRateM3hNumber(v);
  return Number.isFinite(n)?(n/3.6).toFixed(3):'';
}
function getAverageFoerderMengeNumber(v){
  const vals=(v.messungen||[])
    .filter(m=>String(m.foerder_menge??'').trim()!=='' && Number.isFinite(Number(m.foerder_menge)))
    .map(m=>Number(m.foerder_menge));
  return vals.length ? vals.reduce((s,n)=>s+n,0)/vals.length : NaN;
}
function getAverageFoerderMenge(v){
  const a=getAverageFoerderMengeNumber(v);
  return Number.isFinite(a)?a.toFixed(3):'';
}
function getCalcRateM3hNumber(v){
  const m=getManualRateM3hNumber(v);
  if(Number.isFinite(m)&&m>0) return m;
  const a=getAverageFoerderMengeNumber(v);
  if(Number.isFinite(a)&&a>0) return a;
  return NaN;
}
function getCalcRateM3h(v){
  const n=getCalcRateM3hNumber(v);
  return Number.isFinite(n)?n.toFixed(3):'';
}
function getCalcRateLs(v){
  const n=getCalcRateM3hNumber(v);
  return Number.isFinite(n)?(n/3.6).toFixed(3):'';
}
function getCalcRateSource(v){
  const m=getManualRateM3hNumber(v);
  if(Number.isFinite(m)&&m>0) return 'manuelle Förderrate';
  const a=getAverageFoerderMengeNumber(v);
  if(Number.isFinite(a)&&a>0) return 'Ø Fördermenge';
  return '';
}
function getProcessHeadChangeM(raw,ruhe,key){
  const m=Number(raw), r=Number(ruhe);
  if(!Number.isFinite(m)||!Number.isFinite(r)||String(raw??'').trim()==='') return NaN;
  return key==='foerder' ? (m-r) : (r-m);
}
function getDisplacementCm(raw,ruhe){
  const d=getProcessHeadChangeM(raw,ruhe,'foerder');
  return Number.isFinite(d) ? Math.abs(d*100) : NaN;
}
function estimateRowKfDupuit({ qM3h,dmMm,endteufe,ruhe,dyn,key }){
  const Q=Number(qM3h)/3600;
  const rw=Number(dmMm)/2000;
  const ET=Number(endteufe);
  const RWS=Number(ruhe);
  const dynL=Number(dyn);

  if(![Q,rw,ET,RWS,dynL].every(Number.isFinite) || Q<=0 || rw<=0 || ET<=0) return NaN;

  const H0=ET-RWS;
  const Hd=ET-dynL;
  const s=key==='foerder' ? (dynL-RWS) : (RWS-dynL);
  if(!Number.isFinite(H0)||!Number.isFinite(Hd)||!Number.isFinite(s)||H0<=0||Hd<=0||s<=0) return NaN;

  const denom = key==='foerder' ? (H0*H0-Hd*Hd) : (Hd*Hd-H0*H0);
  if(!(denom>0)) return NaN;

  let k=1e-4;
  for(let i=0;i<30;i++){
    const R=Math.max(rw*20,3000*s*Math.sqrt(Math.max(k,1e-12)));
    const ln=Math.log(R/rw);
    if(!(ln>0)) return NaN;
    const kNew=(Q*ln)/(Math.PI*denom);
    if(!Number.isFinite(kNew)||kNew<=0) return NaN;
    if(Math.abs(kNew-k)/k<1e-6){ k=kNew; break; }
    k=kNew;
  }
  return Number.isFinite(k)&&k>0 ? k : NaN;
}
function getStageKfEstimate(versuch,key,brunnen){
  const rateM3h=getCalcRateM3hNumber(versuch);
  if(!Number.isFinite(rateM3h)||rateM3h<=0) return { kf:NaN, reason:'Keine Förderrate' };

  const field=key==='foerder'?'foerder_m':'schluck_m';
  const rows=getRowsForExport(versuch).map(row=>{
    const min=Number(row.min);
    const raw=row[field];
    const kf=estimateRowKfDupuit({
      qM3h:rateM3h, dmMm:brunnen?.dm, endteufe:brunnen?.endteufe, ruhe:brunnen?.ruhe, dyn:raw, key
    });
    const s=getProcessHeadChangeM(raw,brunnen?.ruhe,key);
    if(!Number.isFinite(kf)||!Number.isFinite(min)||!Number.isFinite(s)||s<=0) return null;
    return { min,kf,s };
  }).filter(Boolean).sort((a,b)=>a.min-b.min);

  if(!rows.length) return { kf:NaN, reason:'Noch keine auswertbaren Messpunkte' };

  const tail=rows.length>=4 ? rows.slice(Math.floor(rows.length/2)) : rows;
  const weights=tail.map(p=>Math.max(1,p.min||1));
  const sumW=weights.reduce((a,b)=>a+b,0);
  const logMean=Math.exp(tail.reduce((sum,it,i)=>sum+Math.log(it.kf)*weights[i],0)/sumW);
  const minK=Math.min(...tail.map(x=>x.kf));
  const maxK=Math.max(...tail.map(x=>x.kf));
  const spread=maxK/minK;

  let quality='gering';
  if(tail.length>=4&&spread<=3) quality='gut';
  else if(tail.length>=3&&spread<=10) quality='mittel';

  return {
    kf:logMean,
    quality,
    used:tail.length,
    total:rows.length,
    rateM3h,
    rateSource:getCalcRateSource(versuch)
  };
}
function getWellChartPoints(versuch,key,brunnen){
  const field=key==='foerder'?'foerder_m':'schluck_m';
  const ruhe=Number(brunnen?.ruhe);
  return getRowsForExport(versuch)
    .map(row=>({ x:Number(row.min), y:getDisplacementCm(row[field],ruhe) }))
    .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
    .sort((a,b)=>a.x-b.x);
}
function niceNum(r,round){
  if(!Number.isFinite(r)||r<=0) return 1;
  const exp=Math.floor(Math.log10(r));
  const f=r/Math.pow(10,exp);
  let nf;
  if(round){
    if(f<1.5) nf=1;
    else if(f<3) nf=2;
    else if(f<7) nf=5;
    else nf=10;
  }else{
    if(f<=1) nf=1;
    else if(f<=2) nf=2;
    else if(f<=5) nf=5;
    else nf=10;
  }
  return nf*Math.pow(10,exp);
}
function getNiceAxis(lo,hi,ticks=6){
  let min=Number.isFinite(lo)?lo:0;
  let max=Number.isFinite(hi)?hi:1;
  if(min===max){
    if(min===0) max=1;
    else { min=Math.min(0,min); max=max*1.1; }
  }
  const r=niceNum(max-min,false);
  const step=niceNum(r/Math.max(2,ticks-1),true);
  return { min:Math.floor(min/step)*step, max:Math.ceil(max/step)*step, step };
}
function buildTicks(ax){
  const t=[];
  for(let v=ax.min;v<=ax.max+ax.step/2;v+=ax.step) t.push(Number(v.toFixed(10)));
  return t;
}
function fmtTick(v,d=0){
  return Number.isFinite(v) ? String(Number(v.toFixed(d))).replace('.',',') : '—';
}

/* ══════════════════════════════════════════════════════
   DEFAULTS
══════════════════════════════════════════════════════ */
function defaultMessung(min){
  return { min, foerder_m:'', schluck_m:'', foerder_menge:'' };
}
function defaultVersuch(){
  const ints=[...DEFAULT_INTERVALLE];
  return {
    id:uid(),
    manualRateM3h:'',
    startzeit:'',
    elapsedMs:0,
    intervalleStr:ints.join(', '),
    messungen:ints.map(defaultMessung),
    photoDataUrl:''
  };
}
function hydrateVersuch(v){
  const base=defaultVersuch();
  const ints=v?.intervalleStr ? parseIntervalStr(v.intervalleStr) : [...DEFAULT_INTERVALLE];
  const existing=Array.isArray(v?.messungen) ? v.messungen : [];
  return {
    ...base,...v,
    elapsedMs:Number(v?.elapsedMs||0),
    intervalleStr:ints.join(', '),
    photoDataUrl:typeof v?.photoDataUrl==='string' ? v.photoDataUrl : '',
    messungen:ints.map(min=>{
      const hit=existing.find(m=>Number(m.min)===Number(min));
      return hit ? {
        min,
        foerder_m:hit.foerder_m??'',
        schluck_m:hit.schluck_m??'',
        foerder_menge:hit.foerder_menge??''
      } : defaultMessung(min);
    })
  };
}

/* ══════════════════════════════════════════════════════
   FIELD MAPS
══════════════════════════════════════════════════════ */
const META_FIELDS = [
  ['meta-objekt','objekt'],
  ['meta-grundstueck','grundstueck'],
  ['meta-ort','ort'],
  ['meta-geologie','geologie'],
  ['meta-auftragsnummer','auftragsnummer'],
  ['meta-auftraggeber','auftraggeber'],
  ['meta-bauleitung','bauleitung'],
  ['meta-bohrmeister','bohrmeister'],
  ['meta-koordination','koordination'],
  ['meta-geprueftDurch','geprueftDurch'],
  ['meta-geprueftAm','geprueftAm']
];
const BRUNNEN_FIELDS = [
  ['foerder-dm','foerder','dm'],
  ['foerder-endteufe','foerder','endteufe'],
  ['foerder-ruhe','foerder','ruhe'],
  ['schluck-dm','schluck','dm'],
  ['schluck-endteufe','schluck','endteufe'],
  ['schluck-ruhe','schluck','ruhe']
];

/* ══════════════════════════════════════════════════════
   SYNC UI
══════════════════════════════════════════════════════ */
function syncMetaToUi(){ META_FIELDS.forEach(([id,key])=>{ const el=$(id); if(el) el.value=state.meta[key]||''; }); }
function collectMetaFromUi(){ META_FIELDS.forEach(([id,key])=>{ const el=$(id); if(el) state.meta[key]=el.value||''; }); }
function syncBrunnenToUi(){ BRUNNEN_FIELDS.forEach(([id,g,k])=>{ const el=$(id); if(el) el.value=state[g][k]||''; }); }
function collectBrunnenFromUi(){ BRUNNEN_FIELDS.forEach(([id,g,k])=>{ const el=$(id); if(el) state[g][k]=el.value||''; }); }
function updateBrunnenVisibility(){
  if($('box-foerder')) $('box-foerder').hidden=!state.selection.foerder;
  if($('box-schluck')) $('box-schluck').hidden=!state.selection.schluck;
}
function syncSelectionToUi(){
  if($('sel-foerder')) $('sel-foerder').checked=!!state.selection.foerder;
  if($('sel-schluck')) $('sel-schluck').checked=!!state.selection.schluck;
  updateBrunnenVisibility();
}
function collectSelectionFromUi(){
  const f=!!$('sel-foerder')?.checked;
  const s=!!$('sel-schluck')?.checked;
  if(!f&&!s){
    state.selection.foerder=true;
    state.selection.schluck=false;
    syncSelectionToUi();
    alert('Mindestens ein Brunnen muss ausgewählt sein.');
    return false;
  }
  state.selection.foerder=f;
  state.selection.schluck=s;
  updateBrunnenVisibility();
  return true;
}
function updateMainPdfButtonLabel(){
  const btn=$('btnPdf');
  if(btn) btn.textContent=state.settings.pdfExportType==='vollstaendig'?'PDF Vollständig':'PDF Protokoll';
}
function syncSettingsToUi(){
  $('settings-alarmDuration').value=state.settings.alarmDurationSec ?? 4;
  const a=$('pdfType-protokoll');
  const b=$('pdfType-vollstaendig');
  if(a) a.checked=state.settings.pdfExportType!=='vollstaendig';
  if(b) b.checked=state.settings.pdfExportType==='vollstaendig';
  updateMainPdfButtonLabel();
}
function collectSettingsFromUi(){
  state.settings.alarmDurationSec=clamp(Number($('settings-alarmDuration')?.value||4),1,30);
  state.settings.pdfExportType=$('pdfType-vollstaendig')?.checked ? 'vollstaendig' : 'protokoll';
  updateMainPdfButtonLabel();
}

function renderOverviewPhotoThumb(){
  const box=$('overviewPhotoThumb');
  if(!box) return;
  if(!state.overviewPhotoDataUrl){
    box.hidden=true;
    box.innerHTML='';
    return;
  }
  box.hidden=false;
  box.innerHTML=`<img src="${h(state.overviewPhotoDataUrl)}" alt="Übersichtsfoto"/><button class="overview-del-btn" data-photo-del="overview" type="button">Foto entfernen</button>`;
}
function renderRestsandPhotoAreas(){
  const defs=[
    { key:'imhoff', area:'imhoffPhotoArea', inputId:'imhoffPhotoInput', label:'Foto aufnehmen' },
    { key:'sieb',   area:'siebPhotoArea',   inputId:'siebPhotoInput',   label:'Foto aufnehmen' }
  ];
  defs.forEach(def=>{
    const area=$(def.area); if(!area) return;
    const has=!!state.restsand[def.key].photoDataUrl;
    area.innerHTML=`
      <button class="restsand-photo-btn" data-rs-photo="${def.key}" type="button">${camSvg(26,22)} ${has?'Foto ändern':def.label}</button>
      <input type="file" accept="image/*" capture="environment" id="${def.inputId}" data-rs-input="${def.key}" style="display:none"/>
      ${has?`<img class="restsand-thumb" src="${h(state.restsand[def.key].photoDataUrl)}" alt="${def.key}"/><button class="restsand-del-btn" data-photo-del="restsand-${def.key}" type="button">Entfernen</button>`:''}
    `;
  });
}
function renderPhPhotoAreas(){
  const defs=[
    { key:'sulfat', area:'sulfatPhotoArea', inputId:'sulfatPhotoInput', label:'Foto Teststäbchen' },
    { key:'temperatur', area:'tempPhotoArea', inputId:'tempPhotoInput', label:'Foto Thermometer' },
    { key:'ph', area:'phPhotoArea', inputId:'phPhotoInput', label:'Foto pH-Meter' }
  ];
  defs.forEach(def=>{
    const area=$(def.area); if(!area) return;
    const data=def.key==='ph' ? state.ph.ph.photoDataUrl : state.ph[def.key].photoDataUrl;
    const has=!!data;
    area.innerHTML=`
      <button class="restsand-photo-btn" data-ph-photo="${def.key}" type="button">${camSvg(22,18)} ${has?'Foto ändern':def.label}</button>
      <input type="file" accept="image/*" capture="environment" id="${def.inputId}" data-ph-input="${def.key}" style="display:none"/>
      ${has?`<img class="ph-thumb" src="${h(data)}" alt="${def.key}"/><button class="restsand-del-btn" data-photo-del="ph-${def.key}" type="button">Entfernen</button>`:''}
    `;
  });
}
function syncRestsandToUi(){
  $('restsand-imhoff-menge').value=state.restsand.imhoff.menge||'';
  $('restsand-sieb-menge').value=state.restsand.sieb.menge||'';
  $('restsand-bemerkung').value=state.restsand.bemerkung||'';
  renderRestsandPhotoAreas();
}
function collectRestsandFromUi(){
  state.restsand.imhoff.menge=$('restsand-imhoff-menge')?.value||'';
  state.restsand.sieb.menge=$('restsand-sieb-menge')?.value||'';
  state.restsand.bemerkung=$('restsand-bemerkung')?.value||'';
}
function syncPhToUi(){
  $('ph-datum').value=state.ph.datum||'';
  $('ph-bauherr').value=state.ph.bauherr||'';
  $('ph-baustelle').value=state.ph.baustelle||'';
  $('ph-gewaessername').value=state.ph.gewaessername||'';
  $('ph-sulfat-wert').value=state.ph.sulfat.wert||'';
  $('ph-temp-wert').value=state.ph.temperatur.wert||'';
  $('ph-ph-wert').value=state.ph.ph.wert||'';
  renderPhPhotoAreas();
}
function collectPhFromUi(){
  state.ph.datum=$('ph-datum')?.value||'';
  state.ph.bauherr=$('ph-bauherr')?.value||'';
  state.ph.baustelle=$('ph-baustelle')?.value||'';
  state.ph.gewaessername=$('ph-gewaessername')?.value||'';
  state.ph.sulfat.wert=$('ph-sulfat-wert')?.value||'';
  state.ph.temperatur.wert=$('ph-temp-wert')?.value||'';
  state.ph.ph.wert=$('ph-ph-wert')?.value||'';
}

/* ══════════════════════════════════════════════════════
   SNAPSHOT / STORAGE
══════════════════════════════════════════════════════ */
function collectSnapshot(){
  collectMetaFromUi();
  collectBrunnenFromUi();
  collectSelectionFromUi();
  collectRestsandFromUi();
  collectPhFromUi();
  collectSettingsFromUi();

  return {
    v:17,
    meta:clone(state.meta),
    selection:clone(state.selection),
    foerder:clone(state.foerder),
    schluck:clone(state.schluck),
    overviewPhotoDataUrl:state.overviewPhotoDataUrl||'',
    versuche:clone(state.versuche),
    restsand:clone(state.restsand),
    ph:clone(state.ph),
    settings:clone(state.settings)
  };
}
function applySnapshot(snap,render=true){
  const base=getInitialState();
  snap=snap||{};

  state.meta={...base.meta,...(snap.meta||{})};
  state.selection={...base.selection,...(snap.selection||{})};
  state.foerder={...base.foerder,...(snap.foerder||{})};
  state.schluck={...base.schluck,...(snap.schluck||{})};
  state.overviewPhotoDataUrl=typeof snap.overviewPhotoDataUrl==='string'?snap.overviewPhotoDataUrl:'';
  state.versuche=Array.isArray(snap.versuche)?snap.versuche.map(v=>hydrateVersuch(v)):[];
  state.restsand={
    imhoff:{...base.restsand.imhoff,...((snap.restsand||{}).imhoff||{})},
    sieb:{...base.restsand.sieb,...((snap.restsand||{}).sieb||{})},
    bemerkung:(snap.restsand||{}).bemerkung||''
  };
  state.ph={
    ...base.ph,...(snap.ph||{}),
    sulfat:{...base.ph.sulfat,...((snap.ph||{}).sulfat||{})},
    temperatur:{...base.ph.temperatur,...((snap.ph||{}).temperatur||{})},
    ph:{...base.ph.ph,...((snap.ph||{}).ph||{})}
  };
  state.settings={...base.settings,...(snap.settings||{})};

  Object.keys(timerMap).forEach(hardStopTimer);

  if(render){
    syncMetaToUi();
    syncBrunnenToUi();
    syncSelectionToUi();
    renderOverviewPhotoThumb();
    syncRestsandToUi();
    syncPhToUi();
    syncSettingsToUi();
    renderVersuche();
    renderLiveTab();
    renderHistoryList();
  }
}
function saveDraftDebounced(){
  clearTimeout(_saveT);
  _saveT=setTimeout(()=>{
    try{ localStorage.setItem(STORAGE_DRAFT,JSON.stringify(collectSnapshot())); }catch{}
  },250);
}
function loadDraft(){
  try{
    const raw=localStorage.getItem(STORAGE_DRAFT);
    if(raw) applySnapshot(JSON.parse(raw),true);
  }catch(e){
    console.warn('Draft load failed',e);
  }
}
function readHistory(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_HISTORY)||'[]'); }
  catch{ return []; }
}
function writeHistory(list){
  try{ localStorage.setItem(STORAGE_HISTORY,JSON.stringify(list.slice(0,HISTORY_MAX))); }catch{}
}
function saveCurrentToHistory(msg='Im Verlauf gespeichert.'){
  const snap=collectSnapshot();
  const title=`${snap.meta.objekt||'—'} · ${snap.meta.ort||'—'}`;
  const entry={ id:uid(), savedAt:Date.now(), title, snapshot:snap };
  const list=readHistory();
  list.unshift(entry);
  writeHistory(list);
  renderHistoryList();
  if(msg) alert(msg);
}

/* ══════════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════════ */
function initTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('is-active',b===btn));
      document.querySelectorAll('.pane').forEach(p=>{
        const on=p.id===`tab-${btn.dataset.tab}`;
        p.classList.toggle('is-active',on);
        p.hidden=!on;
      });
      if(btn.dataset.tab==='verlauf') renderHistoryList();
      if(btn.dataset.tab==='live') renderLiveTab();
      updateFloatingTimerWidget();
    });
  });
}

/* ══════════════════════════════════════════════════════
   AUDIO / ALARM
══════════════════════════════════════════════════════ */
function getAlarmAudioContext(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return null;
  if(!_audioCtx){
    try{
      _audioCtx=new AC();
      _alarmGain=_audioCtx.createGain();
      _alarmGain.gain.value=1.0;
      _alarmGain.connect(_audioCtx.destination);
    }catch{
      return null;
    }
  }
  return _audioCtx;
}
function unlockAlarmAudio(){
  const ctx=getAlarmAudioContext();
  if(!ctx) return false;
  try{
    if(ctx.state==='suspended') ctx.resume();
    const buf=ctx.createBuffer(1,1,22050);
    const src=ctx.createBufferSource();
    src.buffer=buf;
    src.connect(ctx.destination);
    src.start(0);
    return true;
  }catch{
    return false;
  }
}
function installAudioUnlock(){
  const fn=()=>unlockAlarmAudio();
  ['pointerdown','touchstart','touchend','keydown','click'].forEach(evt=>{
    window.addEventListener(evt,fn,{passive:true});
  });
}
function scheduleBeep(ctx,start,duration=0.10,freq=2350,volume=0.52){
  const out=_alarmGain||ctx.destination;
  [freq,freq*1.015].forEach(f=>{
    const osc=ctx.createOscillator();
    const g=ctx.createGain();
    osc.type='square';
    osc.frequency.setValueAtTime(f,start);
    g.gain.setValueAtTime(0.0001,start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001,volume),start+0.005);
    g.gain.setValueAtTime(Math.max(0.0001,volume),start+Math.max(0.03,duration-0.02));
    g.gain.exponentialRampToValueAtTime(0.0001,start+duration);
    osc.connect(g); g.connect(out);
    osc.start(start); osc.stop(start+duration+0.02);
  });
}
function playIntervalBeep(){
  try{
    const p=[120,90,120,90,120,360];
    const tot=Math.max(1,Math.round(Number(state.settings.alarmDurationSec||4)/0.9));
    const vib=[]; for(let i=0;i<tot;i++) vib.push(...p);
    navigator.vibrate?.(vib);
  }catch{}

  const ctx=getAlarmAudioContext();
  if(!ctx) return false;
  try{ if(ctx.state==='suspended') ctx.resume(); }catch{}
  if(ctx.state==='suspended') return false;

  const dur=clamp(Number(state.settings.alarmDurationSec||4),1,30);
  const now=ctx.currentTime+0.02;
  const cycle=0.90;
  for(let t=0;t<dur;t+=cycle){
    scheduleBeep(ctx,now+t+0.00,0.10,2350,0.52);
    scheduleBeep(ctx,now+t+0.20,0.10,2350,0.52);
    scheduleBeep(ctx,now+t+0.40,0.12,2550,0.56);
  }
  return true;
}

/* ══════════════════════════════════════════════════════
   IMAGE HELPERS
══════════════════════════════════════════════════════ */
async function downscaleImageFile(file,maxDim=1600,quality=0.78){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let { width,height }=img;
        const scale=Math.min(1,maxDim/Math.max(width,height));
        width=Math.round(width*scale);
        height=Math.round(height*scale);
        const canvas=document.createElement('canvas');
        canvas.width=width;
        canvas.height=height;
        canvas.getContext('2d').drawImage(img,0,0,width,height);
        try{
          resolve(canvas.toDataURL('image/jpeg',quality));
        }catch(e){ reject(e); }
      };
      img.onerror=reject;
      img.src=reader.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
function dataUrlToUint8Array(dataUrl){
  const b64=dataUrl.split(',')[1]||'';
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes;
}
async function embedDataUrlImage(pdf,dataUrl){
  if(!dataUrl) return null;
  const bytes=dataUrlToUint8Array(dataUrl);
  return /^data:image\/png/i.test(dataUrl) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
}
async function handlePhotoSelected(file){
  return downscaleImageFile(file,1600,0.78);
}

/* ══════════════════════════════════════════════════════
   GLOBAL PHOTO DELEGATION
══════════════════════════════════════════════════════ */
function hookGlobalPhotoDelegation(){
  document.addEventListener('click',async(e)=>{
    const btn=e.target.closest('button');
    if(!btn) return;

    if(btn.id==='overviewPhotoBtnTrigger'){
      $('overviewPhotoInput')?.click();
      return;
    }
    if(btn.dataset.rsPhoto){
      $(`${btn.dataset.rsPhoto}PhotoInput`)?.click();
      return;
    }
    if(btn.dataset.phPhoto){
      const map={ sulfat:'sulfatPhotoInput', temperatur:'tempPhotoInput', ph:'phPhotoInput' };
      $(map[btn.dataset.phPhoto])?.click();
      return;
    }
    if(btn.dataset.photoDel){
      const what=btn.dataset.photoDel;
      if(what==='overview'){
        state.overviewPhotoDataUrl='';
        renderOverviewPhotoThumb();
        saveDraftDebounced();
        return;
      }
      if(what.startsWith('restsand-')){
        const k=what.replace('restsand-','');
        state.restsand[k].photoDataUrl='';
        renderRestsandPhotoAreas();
        saveDraftDebounced();
        return;
      }
      if(what.startsWith('ph-')){
        const k=what.replace('ph-','');
        if(k==='ph') state.ph.ph.photoDataUrl='';
        else state.ph[k].photoDataUrl='';
        renderPhPhotoAreas();
        saveDraftDebounced();
      }
    }
  });

  document.addEventListener('change',async(e)=>{
    const input=e.target;
    if(!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    const file=input.files[0];
    try{
      const dataUrl=await handlePhotoSelected(file);
      if(input.id==='overviewPhotoInput'){
        state.overviewPhotoDataUrl=dataUrl;
        renderOverviewPhotoThumb();
      }else if(input.dataset.rsInput){
        state.restsand[input.dataset.rsInput].photoDataUrl=dataUrl;
        renderRestsandPhotoAreas();
      }else if(input.dataset.phInput){
        if(input.dataset.phInput==='ph') state.ph.ph.photoDataUrl=dataUrl;
        else state.ph[input.dataset.phInput].photoDataUrl=dataUrl;
        renderPhPhotoAreas();
      }
      saveDraftDebounced();
    }catch(err){
      console.error(err);
      alert('Foto konnte nicht verarbeitet werden.');
    }finally{
      input.value='';
    }
  });
}

/* ══════════════════════════════════════════════════════
   OCR – speziell für FLYPPER WS-F4 LCD-Display
   Zahl steht mittig im Display, Format: X,XXX m³
   Aufrunden auf 2 Nachkommastellen (z.B. 2,144 → 2,15)
══════════════════════════════════════════════════════ */
function openOcrModal(vid, rowIdx){
  _ocrTargetVid = vid;
  _ocrTargetRowIdx = rowIdx;
  $('ocrPreviewImg').src = '';
  $('ocrResultInput').value = '';
  $('ocrStatus').textContent = 'Bitte Foto des Durchflussmessers aufnehmen…';
  $('ocrModal').hidden = false;
  setTimeout(() => $('ocrFileInput').click(), 100);
}
function closeOcrModal(){
  $('ocrModal').hidden = true;
  _ocrTargetVid = null;
  _ocrTargetRowIdx = null;
}
function canvasToDataUrl(canvas){
  return canvas.toDataURL('image/jpeg', 0.95);
}

/* Rundet IMMER auf 2 Nachkommastellen AUF (ceiling) */
function ceilTo2(n){
  return Math.ceil(n * 100) / 100;
}

/* Vorverarbeitung speziell für FLYPPER WS-F4:
   - LCD-Display ist in der oberen Mitte des runden Gehäuses
   - Crop: horizontal 12-88%, vertikal 28-56%
   - 4x Upscale
   - Graustufen → Invertieren (dunkle Segmente → hell für Tesseract)
   - Kontrastverstärkung + Schwellenwert
*/
async function preprocessForOcr(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.width;
      const srcH = img.height;

      // Crop direkt auf das LCD-Display-Rechteck
      const cropX = Math.round(srcW * 0.12);
      const cropY = Math.round(srcH * 0.28);
      const cropW = Math.round(srcW * 0.76);
      const cropH = Math.round(srcH * 0.28);

      // 4x Upscale für bessere Texterkennung
      const scale = 4;
      const tmp = document.createElement('canvas');
      tmp.width  = cropW * scale;
      tmp.height = cropH * scale;
      const ctx = tmp.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, tmp.width, tmp.height);

      const imageData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const d = imageData.data;

      for(let i = 0; i < d.length; i += 4){
        // Graustufen
        const gray = Math.round(d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
        // Kontrast strecken
        let v = clamp(Math.round((gray - 100) * 2.2 + 100), 0, 255);
        // LCD-Segmente sind DUNKEL auf hellem Grund → INVERTIEREN für Tesseract
        // (helle Zeichen auf dunklem Grund = besser erkennbar)
        v = v > 130 ? 0 : 255;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvasToDataUrl(tmp));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/* Variante ohne Inversion — als Fallback */
async function preprocessForOcrNoInvert(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.width;
      const srcH = img.height;

      // etwas größerer Bereich als Fallback
      const cropX = Math.round(srcW * 0.08);
      const cropY = Math.round(srcH * 0.25);
      const cropW = Math.round(srcW * 0.84);
      const cropH = Math.round(srcH * 0.32);

      const scale = 3;
      const tmp = document.createElement('canvas');
      tmp.width  = cropW * scale;
      tmp.height = cropH * scale;
      const ctx = tmp.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, tmp.width, tmp.height);

      const imageData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const d = imageData.data;

      for(let i = 0; i < d.length; i += 4){
        const gray = Math.round(d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
        let v = clamp(Math.round((gray - 110) * 2.0 + 110), 0, 255);
        // Keine Inversion
        v = v > 128 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvasToDataUrl(tmp));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/* Bestes Ergebnis aus OCR-Text extrahieren.
   FLYPPER zeigt: [kleines Zeichen] [Zahl] m³
   Format: X,XXX oder X.XXX (immer 3 Nachkommastellen am Display)
   Wir runden AUF auf 2 Nachkommastellen.
*/
function extractBestDecimalValue(text){
  const raw = String(text || '')
    // Häufige OCR-Fehler bei LCD-Segmenten
    .replace(/[Oo]/g, '0')
    .replace(/[lIi|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '9')
    .replace(/[Zz]/g, '2')
    // Sonstige Bereinigung
    .replace(/[^0-9,.\n ]+/g, ' ');

  // Primär: Format X,XXX oder X.XXX (3 Nachkommastellen wie am Display)
  const pattern3 = raw.match(/\d{1,3}[.,]\d{3}/g) || [];
  const vals3 = pattern3
    .map(s => Number(s.replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 9999);

  if(vals3.length){
    // Bevorzuge Werte im realistischen m³-Bereich (Fördermenge 0.01–250)
    const preferred = vals3.filter(n => n >= 0.01 && n <= 250).sort((a, b) => a - b);
    const best = preferred[0] ?? vals3[0];
    return ceilTo2(best);
  }

  // Fallback: X,XX oder X.XX (2 Nachkommastellen)
  const pattern2 = raw.match(/\d{1,3}[.,]\d{2}/g) || [];
  const vals2 = pattern2
    .map(s => Number(s.replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 9999);

  if(vals2.length){
    const preferred = vals2.filter(n => n >= 0.01 && n <= 250).sort((a, b) => a - b);
    const best = preferred[0] ?? vals2[0];
    return ceilTo2(best);
  }

  // Letzter Fallback: irgendeine Zahl
  const allNums = raw.match(/\d{1,4}[.,]\d{1,4}|\d{2,4}/g) || [];
  const allVals = allNums
    .map(s => Number(s.replace(',', '.')))
    .filter(n => Number.isFinite(n) && n >= 0.01 && n <= 250)
    .sort((a, b) => a - b);

  return allVals.length ? ceilTo2(allVals[0]) : undefined;
}

/* Mehrere OCR-Versuche mit verschiedenen Konfigurationen */
async function runOcrWithFallbacks(originalDataUrl, processedUrl, processedUrlNoInvert){
  if(!window.Tesseract) throw new Error('Tesseract nicht geladen');

  // Alle Versuche der Reihe nach — erster Treffer mit plausiblem Wert gewinnt
  const configs = [
    // Invertiert (hell auf dunkel) — PSM 7 = einzelne Zeile
    { label:'Display invertiert (Zeile)', img: processedUrl,          psm: 7 },
    // Invertiert — PSM 8 = einzelnes Wort
    { label:'Display invertiert (Wort)',  img: processedUrl,          psm: 8 },
    // Nicht invertiert — PSM 7
    { label:'Display normal (Zeile)',     img: processedUrlNoInvert,  psm: 7 },
    // Nicht invertiert — PSM 6 = Block
    { label:'Display normal (Block)',     img: processedUrlNoInvert,  psm: 6 },
    // Original, keine Verarbeitung — PSM 7
    { label:'Original (Zeile)',           img: originalDataUrl,       psm: 7 },
  ];

  const allTexts = [];

  for(const cfg of configs){
    try{
      const { data: { text } } = await Tesseract.recognize(cfg.img, 'eng', {
        tessedit_pageseg_mode:     String(cfg.psm),
        tessedit_char_whitelist:   '0123456789,.',
        preserve_interword_spaces: '1',
        logger: m => {
          if(m.status === 'recognizing text'){
            $('ocrStatus').textContent =
              `${cfg.label}… ${Math.round(m.progress * 100)}%`;
          }
        }
      });

      allTexts.push(text || '');
      const best = extractBestDecimalValue(text || '');
      if(best !== undefined){
        $('ocrStatus').textContent =
          `Erkannt via ${cfg.label}: ${best.toFixed(2).replace('.', ',')} m³`;
        return { best, text };
      }
    }catch(err){
      console.warn(`OCR-Versuch "${cfg.label}" fehlgeschlagen:`, err);
    }
  }

  // Alle Texte zusammenführen und noch einmal probieren
  const merged = allTexts.join('\n');
  const best = extractBestDecimalValue(merged);
  return { best, text: merged };
}

function initOcrHandlers(){
  $('ocrFileInput')?.addEventListener('change', async(e) => {
    const file = e.target.files?.[0];
    if(!file) return;

    try{
      $('ocrStatus').textContent = 'Bild wird geladen…';
      const originalDataUrl = await downscaleImageFile(file, 2400, 0.92);
      $('ocrPreviewImg').src = originalDataUrl;

      $('ocrStatus').textContent = 'Display wird zugeschnitten und aufbereitet…';
      const processedUrl        = await preprocessForOcr(originalDataUrl);
      const processedUrlNoInvert = await preprocessForOcrNoInvert(originalDataUrl);

      $('ocrStatus').textContent = 'Texterkennung läuft…';
      const { best } = await runOcrWithFallbacks(
        originalDataUrl, processedUrl, processedUrlNoInvert
      );

      if(best !== undefined){
        $('ocrResultInput').value = best.toFixed(2).replace('.', ',');
        $('ocrStatus').textContent =
          `Erkannt: ${best.toFixed(2).replace('.', ',')} m³ (aufgerundet auf 2 Stellen) – bitte prüfen.`;
      }else{
        $('ocrResultInput').value = '';
        $('ocrStatus').textContent =
          'Keine Zahl erkannt – bitte manuell eingeben. ' +
          'Tipp: Foto gerade und nah am Display aufnehmen.';
      }
    }catch(err){
      console.error(err);
      $('ocrStatus').textContent = 'Fehler bei der Texterkennung.';
    }finally{
      e.target.value = '';
    }
  });

  $('ocrAccept')?.addEventListener('click', () => {
    const v = getVersuchById(_ocrTargetVid);
    const rawInput = String($('ocrResultInput').value).replace(',', '.');
    const num = Number(rawInput);

    if(v && Number.isFinite(num) && num > 0){
      const idx = _ocrTargetRowIdx;
      if(v.messungen[idx]){
        // Nochmal ceiling anwenden, falls Nutzer manuell geändert hat
        v.messungen[idx].foerder_menge = ceilTo2(num).toFixed(2);
        renderVersuche();
        saveDraftDebounced();
        scheduleLiveRender();
      }
    }
    closeOcrModal();
  });

  $('ocrCancel')?.addEventListener('click', closeOcrModal);
  $('ocrModal')?.addEventListener('click', e => {
    if(e.target.id === 'ocrModal') closeOcrModal();
  });
}
/* ══════════════════════════════════════════════════════
   TIMER
══════════════════════════════════════════════════════ */
function ensureTimer(vid,versuch){
  if(!timerMap[vid]){
    const elapsedMin=Number(versuch?.elapsedMs||0)/60000;
    const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
    timerMap[vid]={
      running:false,
      startMs:0,
      accumulatedMs:Number(versuch?.elapsedMs||0),
      raf:null,
      alarmCount:mins.filter(iv=>iv>0&&elapsedMin>=iv).length
    };
  }
  return timerMap[vid];
}
function getElapsedMs(vid,versuch){
  const t=timerMap[vid];
  if(!t) return Number(versuch?.elapsedMs||0);
  return t.running ? t.accumulatedMs+(Date.now()-t.startMs) : t.accumulatedMs;
}
function updateHeadTimer(card,versuch){
  const el=card?.querySelector('.versuch-head-timer');
  if(!el) return;
  const ms=getElapsedMs(versuch.id,versuch);
  el.textContent=formatElapsed(ms);
  el.classList.toggle('is-running',!!timerMap[versuch.id]?.running);
}
function updateTimerUi(card,versuch){
  if(!card||!versuch) return;
  const t=ensureTimer(versuch.id,versuch);
  const ms=getElapsedMs(versuch.id,versuch);
  versuch.elapsedMs=ms;

  updateHeadTimer(card,versuch);

  const elapsedEl=card.querySelector('[data-role="elapsed"]');
  const startBtn=card.querySelector('[data-role="timer-start"]');
  const stopBtn=card.querySelector('[data-role="timer-stop"]');
  const startZeitEl=card.querySelector('[data-role="startzeit"]');
  const nextEl=card.querySelector('[data-role="naechstes"]');

  if(elapsedEl) elapsedEl.textContent=formatElapsed(ms);
  if(startZeitEl) startZeitEl.textContent=versuch.startzeit ? `Startzeit: ${versuch.startzeit}` : 'Noch nicht gestartet';
  if(startBtn){
    startBtn.textContent=t.running ? 'Läuft' : (versuch.elapsedMs>0 ? 'Weiter' : 'Start');
    startBtn.disabled=t.running;
  }
  if(stopBtn) stopBtn.disabled=!t.running;

  const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
  const eMin=ms/60000;
  const nextIv=mins.filter(iv=>iv>0).find(iv=>eMin<iv);
  if(nextEl){
    nextEl.textContent = nextIv!==undefined
      ? `Nächste Messung: ${nextIv} min (in ${Math.max(0,Math.ceil((nextIv*60000-ms)/1000))}s)`
      : 'Alle Messintervalle erreicht';
  }

  card.querySelectorAll('tbody tr').forEach(r=>r.classList.remove('row-active'));
  const passed=mins.filter(iv=>eMin>=iv);
  const lastPassed=passed.length ? passed[passed.length-1] : mins[0];
  const rowIdx=versuch.messungen.findIndex(m=>Number(m.min)===Number(lastPassed));
  if(rowIdx>=0) card.querySelector(`tr[data-row="${rowIdx}"]`)?.classList.add('row-active');
}
function triggerIntervalAlarm(vid){
  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  const display=card?.querySelector('[data-role="elapsed"]');

  document.body.classList.remove('screen-flash');
  void document.body.offsetWidth;
  document.body.classList.add('screen-flash');

  card?.classList.remove('versuch-card--alarm');
  void card?.offsetWidth;
  card?.classList.add('versuch-card--alarm');

  display?.classList.remove('timer-display--alarm');
  void display?.offsetWidth;
  display?.classList.add('timer-display--alarm');

  playIntervalBeep();

  setTimeout(()=>document.body.classList.remove('screen-flash'),1800);
  setTimeout(()=>{
    card?.classList.remove('versuch-card--alarm');
    display?.classList.remove('timer-display--alarm');
  },Math.max(2400,Number(state.settings.alarmDurationSec||4)*1000+600));
}
function tickTimer(vid){
  const versuch=getVersuchById(vid);
  const t=timerMap[vid];
  if(!versuch||!t||!t.running) return;

  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  versuch.elapsedMs=getElapsedMs(vid,versuch);
  if(card) updateTimerUi(card,versuch);

  const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  const passed=mins.filter(iv=>versuch.elapsedMs/60000>=iv).length;
  if(passed>t.alarmCount){
    t.alarmCount=passed;
    triggerIntervalAlarm(vid);
  }

  updateFloatingTimerWidget();
  t.raf=requestAnimationFrame(()=>tickTimer(vid));
}
function startTimer(vid){
  const versuch=getVersuchById(vid);
  if(!versuch) return;
  unlockAlarmAudio();
  const t=ensureTimer(vid,versuch);
  if(t.running) return;
  if(!versuch.startzeit) versuch.startzeit=formatTimeHHMMSS(new Date());

  const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
  t.alarmCount=mins.filter(iv=>iv>0&&t.accumulatedMs/60000>=iv).length;
  t.running=true;
  t.startMs=Date.now();

  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card,versuch);
  tickTimer(vid);
  startFloatingLoop();
  saveDraftDebounced();
}
function stopTimer(vid){
  const versuch=getVersuchById(vid);
  const t=timerMap[vid];
  if(!versuch||!t||!t.running) return;

  t.accumulatedMs += (Date.now()-t.startMs);
  versuch.elapsedMs=t.accumulatedMs;
  t.running=false;
  if(t.raf) cancelAnimationFrame(t.raf);
  t.raf=null;

  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card,versuch);
  updateFloatingTimerWidget();
  stopFloatingLoopIfIdle();
  saveDraftDebounced();
}
function resetTimer(vid){
  const versuch=getVersuchById(vid);
  if(!versuch) return;
  const t=ensureTimer(vid,versuch);
  if(t.raf) cancelAnimationFrame(t.raf);
  t.running=false;
  t.startMs=0;
  t.accumulatedMs=0;
  t.raf=null;
  t.alarmCount=0;
  versuch.elapsedMs=0;
  versuch.startzeit='';
  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card,versuch);
  updateFloatingTimerWidget();
  stopFloatingLoopIfIdle();
  saveDraftDebounced();
}
function hardStopTimer(vid){
  const t=timerMap[vid];
  if(!t) return;
  try{ if(t.raf) cancelAnimationFrame(t.raf); }catch{}
  delete timerMap[vid];
  updateFloatingTimerWidget();
  stopFloatingLoopIfIdle();
}

/* ══════════════════════════════════════════════════════
   FLOATING TIMER
══════════════════════════════════════════════════════ */
function getFirstRunningStage(){
  return state.versuche.find(v=>timerMap[v.id]?.running) || null;
}
function isElementVisible(el){
  if(!el) return false;
  const r=el.getBoundingClientRect();
  if(r.width===0&&r.height===0) return false;
  if(getComputedStyle(el).display==='none') return false;
  return r.top>=0&&r.bottom<=window.innerHeight&&r.left>=0&&r.right<=window.innerWidth;
}
function updateFloatingTimerWidget(){
  const wrap=$('floatingTimer');
  const label=$('floatingTimerLabel');
  const display=$('floatingTimerDisplay');
  if(!wrap||!label||!display) return;

  const stage=getFirstRunningStage();
  if(!stage){
    wrap.hidden=true;
    return;
  }
  const idx=state.versuche.findIndex(v=>v.id===stage.id);
  const card=document.querySelector(`.versuch-card[data-vid="${stage.id}"]`);
  const timerBox=card?.querySelector('.timer-box');

  label.textContent=getStageTitle(idx);
  display.textContent=formatElapsed(getElapsedMs(stage.id,stage));
  wrap.hidden=isElementVisible(timerBox);
}
function startFloatingLoop(){
  if(_floatingRaf) return;
  const loop=()=>{
    updateFloatingTimerWidget();
    if(Object.values(timerMap).some(t=>t.running)) _floatingRaf=requestAnimationFrame(loop);
    else{
      cancelAnimationFrame(_floatingRaf);
      _floatingRaf=null;
    }
  };
  _floatingRaf=requestAnimationFrame(loop);
}
function stopFloatingLoopIfIdle(){
  if(!Object.values(timerMap).some(t=>t.running) && _floatingRaf){
    cancelAnimationFrame(_floatingRaf);
    _floatingRaf=null;
  }
}
function initFloatingTimer(){
  $('floatingTimer')?.addEventListener('click',()=>{
    const stage=getFirstRunningStage();
    if(stage) openTimeAdjustModal(stage.id);
  });
  window.addEventListener('scroll',updateFloatingTimerWidget,{passive:true});
  window.addEventListener('resize',updateFloatingTimerWidget);
}

/* ══════════════════════════════════════════════════════
   TIME ADJUST MODAL
══════════════════════════════════════════════════════ */
function openTimeAdjustModal(vid){
  _timeAdjustVid=vid;
  $('timeAdjustInput').value='0';
  updateTimeAdjustPreview();
  $('timeAdjustModal').hidden=false;
}
function closeTimeAdjustModal(){
  $('timeAdjustModal').hidden=true;
  _timeAdjustVid=null;
}
function updateTimeAdjustPreview(){
  const v=getVersuchById(_timeAdjustVid);
  if(!v) return;
  const next=Math.max(0,getElapsedMs(v.id,v)+Number($('timeAdjustInput')?.value||0)*1000);
  $('timeAdjustPreview').textContent=`Neue Zeit: ${formatElapsed(next)}`;
}
function applyTimeAdjustment(){
  const v=getVersuchById(_timeAdjustVid);
  if(!v) return;
  const offset=Number($('timeAdjustInput')?.value||0);
  const t=ensureTimer(v.id,v);
  const next=Math.max(0,getElapsedMs(v.id,v)+offset*1000);

  if(t.running){
    t.startMs=Date.now();
    t.accumulatedMs=next;
  }else{
    t.accumulatedMs=next;
  }

  v.elapsedMs=next;
  if(!v.startzeit && next>0) v.startzeit=formatTimeHHMMSS(new Date());

  const card=document.querySelector(`.versuch-card[data-vid="${v.id}"]`);
  updateTimerUi(card,v);
  updateFloatingTimerWidget();
  saveDraftDebounced();
  closeTimeAdjustModal();
}
function initTimeAdjustModal(){
  $('timeAdjustInput')?.addEventListener('input',updateTimeAdjustPreview);
  document.querySelectorAll('.modal-adj-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $('timeAdjustInput').value=String(Number($('timeAdjustInput').value||0)+Number(btn.dataset.adj||0));
      updateTimeAdjustPreview();
    });
  });
  $('timeAdjustApply')?.addEventListener('click',applyTimeAdjustment);
  $('timeAdjustCancel')?.addEventListener('click',closeTimeAdjustModal);
  $('timeAdjustModal')?.addEventListener('click',e=>{ if(e.target.id==='timeAdjustModal') closeTimeAdjustModal(); });
}

/* ══════════════════════════════════════════════════════
   RENDER STAGES
══════════════════════════════════════════════════════ */
function buildTableHeadHtml(){
  const sel=getSelectedWells();
  let html='<tr><th style="width:56px">Min</th>';
  if(sel.foerder) html+=`<th class="th-foerder">Förderbrunnen<br><span style="font-size:.75em;font-weight:600">m ab OK</span></th>`;
  if(sel.schluck) html+=`<th class="th-schluck">Rückgabe<br><span style="font-size:.75em;font-weight:600">m ab OK</span></th>`;
  html+='<th>Fördermenge<br><span style="font-size:.75em;font-weight:600">m³/h</span></th></tr>';
  return html;
}
function buildTableRowHtml(v,row,rowIdx){
  const sel=getSelectedWells();
  const isLast=rowIdx===v.messungen.length-1;
  let html=`<tr data-row="${rowIdx}">
    <td><div class="minute-cell">
      <input class="mess-input minute-input" data-role="min" data-row="${rowIdx}" type="number" step="1" inputmode="numeric" value="${h(row.min)}">
      ${isLast?`<button class="row-plus" data-role="row-plus" data-row="${rowIdx}" type="button">+</button>`:''}
    </div></td>`;
  if(sel.foerder) html+=`<td><input class="mess-input" data-role="foerder-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.foerder_m)}"></td>`;
  if(sel.schluck) html+=`<td><input class="mess-input" data-role="schluck-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.schluck_m)}"></td>`;
  html+=`<td><div class="menge-wrap">
    <input class="mess-input" data-role="foerder-menge" data-row="${rowIdx}" type="number" step="0.01" inputmode="decimal" value="${h(row.foerder_menge)}">
    <button class="scan-btn" data-role="scan-menge" data-row="${rowIdx}" type="button" title="Wert scannen">
      <svg viewBox="0 0 24 20" width="16" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="4" width="22" height="15" rx="2" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/>
        <path d="M8.5 4 L10.2 1.5 L13.8 1.5 L15.5 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
        <rect x="18.5" y="6" width="2.5" height="1.8" rx="0.9" fill="currentColor"/>
      </svg>
    </button>
  </div></td></tr>`;
  return html;
}
function buildVersuchHtml(v,idx){
  const effLs=getEffectiveRateLs(v);
  const effM3h=getEffectiveRateM3h(v);
  const avg=getAverageFoerderMenge(v);
  const hasPhoto=!!v.photoDataUrl;
  const t=timerMap[v.id];
  const isRunning=!!(t?.running);

  return `
<details class="card card--collapsible versuch-card" data-vid="${h(v.id)}" open>
  <summary class="card__title">
    <span class="versuch-head-title">${getStageTitle(idx)}</span>
    <span class="versuch-head-timer ${isRunning?'is-running':''}">${formatElapsed(v.elapsedMs||0)}</span>
    <span class="versuch-head-spacer"></span>
    <span class="versuch-head-actions">
      ${hasPhoto?`<button class="photo-del-btn" data-role="photo-del" type="button" title="Foto entfernen">✕</button>`:''}
      <button class="photo-btn ${hasPhoto?'photo-btn--has':''}" data-role="photo-btn" type="button" title="Beweisfoto" aria-label="Beweisfoto">${camSvg(16,13)}</button>
      <input class="photo-input" data-role="photo-input" type="file" accept="image/*" capture="environment">
    </span>
  </summary>
  <div class="card__body versuch-body">
    ${hasPhoto?`<div class="photo-thumb-wrap"><img class="photo-thumb" src="${h(v.photoDataUrl)}" alt="Beweisfoto"><div class="photo-thumb-caption">Beweisfoto Durchflussmesser</div></div>`:''}

    <div class="versuch-row">
      <span class="rate-label">Förderrate [l/s]</span>
      <input class="rate-input" data-role="manual-rate-ls" type="number" step="0.001" inputmode="decimal" value="${h(effLs)}">
      <span class="rate-unit">=</span>
      <span class="rate-conv" data-role="head-rate-m3h">${effM3h?`${h(effM3h)} m³/h`:'—'}</span>
      <span class="rate-label">Ø Fördermenge</span>
      <input class="rate-input rate-input--readonly" data-role="avg-foerder-menge" type="text" value="${h(avg||'—')}" readonly>
    </div>

    <div class="versuch-row">
      <span class="interval-label">Intervalle [min]</span>
      <input class="interval-input" data-role="intervalle" type="text" value="${h(v.intervalleStr)}">
    </div>

    <div class="timer-box">
      <div class="timer-row">
        <div class="timer-display" data-role="elapsed" title="Tippen zum Anpassen">${formatElapsed(v.elapsedMs||0)}</div>
        <span class="timer-edit-hint">tippen = anpassen</span>
        <div class="timer-buttons">
          <button class="timer-btn timer-btn--start" data-role="timer-start" type="button">Start</button>
          <button class="timer-btn timer-btn--stop"  data-role="timer-stop"  type="button">Stop</button>
          <button class="timer-btn timer-btn--ghost" data-role="timer-reset" type="button">Reset</button>
        </div>
      </div>
      <div class="timer-info" data-role="startzeit">${v.startzeit?`Startzeit: ${h(v.startzeit)}`:'Noch nicht gestartet'}</div>
      <div class="timer-info timer-next" data-role="naechstes"></div>
    </div>

    <div class="table-wrap">
      <table class="mess-table">
        <thead>${buildTableHeadHtml()}</thead>
        <tbody>${v.messungen.map((row,rowIdx)=>buildTableRowHtml(v,row,rowIdx)).join('')}</tbody>
      </table>
    </div>

    <div class="versuch-tools">
      <button class="del-btn" data-role="del" type="button">Stufe löschen</button>
    </div>
  </div>
</details>`;
}
function updateStageRateDisplay(card,versuch){
  if(!card||!versuch) return;
  const m3hEl=card.querySelector('[data-role="head-rate-m3h"]');
  const avgEl=card.querySelector('[data-role="avg-foerder-menge"]');
  if(m3hEl) m3hEl.textContent=getEffectiveRateM3h(versuch)?`${getEffectiveRateM3h(versuch)} m³/h`:'—';
  if(avgEl) avgEl.value=getAverageFoerderMenge(versuch)||'—';
}
function renderVersuche(){
  const host=$('versucheContainer');
  if(!host) return;

  if(!state.versuche.length){
    host.innerHTML=`<div class="empty-state">Noch keine Pumpstufe angelegt.<br>Bitte über den Plus-Button eine neue Stufe hinzufügen.</div>`;
    updateFloatingTimerWidget();
    return;
  }

  host.innerHTML=state.versuche.map((v,idx)=>buildVersuchHtml(v,idx)).join('');
  document.querySelectorAll('.versuch-card').forEach(card=>{
    const v=getVersuchById(card.dataset.vid);
    if(v){
      updateStageRateDisplay(card,v);
      updateTimerUi(card,v);
    }
  });
  updateFloatingTimerWidget();
}

/* ══════════════════════════════════════════════════════
   STAGE DELEGATION
══════════════════════════════════════════════════════ */
function hookVersuchDelegation(){
  const host=$('versucheContainer');
  if(!host || host.dataset.bound==='1') return;
  host.dataset.bound='1';

  host.addEventListener('input',(e)=>{
    const el=e.target.closest('[data-role]');
    if(!el) return;
    const card=el.closest('.versuch-card');
    if(!card) return;
    const versuch=getVersuchById(card.dataset.vid);
    if(!versuch) return;

    const role=el.dataset.role;
    const idx=Number(el.dataset.row);

    if(role==='manual-rate-ls'){
      versuch.manualRateM3h=String(el.value).trim()===''?'':lsToM3h(el.value);
      updateStageRateDisplay(card,versuch);
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
    if(role==='min'){
      if(versuch.messungen[idx]) versuch.messungen[idx].min=el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
    if(role==='foerder-m'){
      if(versuch.messungen[idx]) versuch.messungen[idx].foerder_m=el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
    if(role==='schluck-m'){
      if(versuch.messungen[idx]) versuch.messungen[idx].schluck_m=el.value;
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
    if(role==='foerder-menge'){
      if(versuch.messungen[idx]) versuch.messungen[idx].foerder_menge=el.value;
      updateStageRateDisplay(card,versuch);
      saveDraftDebounced();
      scheduleLiveRender();
      return;
    }
  });

  host.addEventListener('change',async(e)=>{
    const el=e.target.closest('[data-role]');
    if(!el) return;
    const card=el.closest('.versuch-card');
    if(!card) return;
    const versuch=getVersuchById(card.dataset.vid);
    if(!versuch) return;
    const role=el.dataset.role;

    if(role==='photo-input'){
      const file=el.files?.[0];
      if(file){
        try{
          versuch.photoDataUrl=await handlePhotoSelected(file);
          renderVersuche();
          saveDraftDebounced();
        }catch(err){
          console.error(err);
          alert('Foto konnte nicht verarbeitet werden.');
        }finally{
          el.value='';
        }
      }
      return;
    }

    if(role==='intervalle'){
      const ints=parseIntervalStr(el.value);
      if(!ints.length){
        alert('Bitte gültige Intervalle eingeben.');
        el.value=versuch.intervalleStr;
        return;
      }
      const old=Array.isArray(versuch.messungen)?versuch.messungen:[];
      versuch.intervalleStr=ints.join(', ');
      versuch.messungen=ints.map(min=>{
        const hit=old.find(m=>Number(m.min)===Number(min));
        return hit || defaultMessung(min);
      });
      hardStopTimer(versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }

    if(role==='min'){
      sortMessungen(versuch);
      hardStopTimer(versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
    }
  });

  host.addEventListener('click',(e)=>{
    const card=e.target.closest('.versuch-card');
    if(!card) return;
    const versuch=getVersuchById(card.dataset.vid);
    if(!versuch) return;

    const headTimer=e.target.closest('.versuch-head-timer');
    if(headTimer){
      e.preventDefault();
      e.stopPropagation();
      openTimeAdjustModal(versuch.id);
      return;
    }

    const bodyTimer=e.target.closest('.timer-display');
    if(bodyTimer){
      e.preventDefault();
      e.stopPropagation();
      openTimeAdjustModal(versuch.id);
      return;
    }

    const btn=e.target.closest('[data-role]');
    if(!btn) return;
    const role=btn.dataset.role;

    if(role==='photo-btn'){
      e.preventDefault(); e.stopPropagation();
      unlockAlarmAudio();
      card.querySelector('[data-role="photo-input"]')?.click();
      return;
    }
    if(role==='photo-del'){
      e.preventDefault(); e.stopPropagation();
      if(!confirm('Beweisfoto wirklich entfernen?')) return;
      versuch.photoDataUrl='';
      renderVersuche();
      saveDraftDebounced();
      return;
    }
    if(role==='scan-menge'){
      e.preventDefault(); e.stopPropagation();
      openOcrModal(versuch.id,Number(btn.dataset.row));
      return;
    }
    if(role==='row-plus'){
      sortMessungen(versuch);
      const step=getContinueStep(versuch);
      const last=versuch.messungen.length ? Number(versuch.messungen[versuch.messungen.length-1].min) : 0;
      versuch.messungen.push(defaultMessung(Number.isFinite(last)?last+step:step));
      syncIntervalleStrFromRows(versuch);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }
    if(role==='del'){
      const idx=state.versuche.findIndex(v=>v.id===versuch.id);
      if(!confirm(`${getStageTitle(idx)} wirklich löschen?`)) return;
      hardStopTimer(versuch.id);
      state.versuche=state.versuche.filter(v=>v.id!==versuch.id);
      renderVersuche();
      renderLiveTab();
      saveDraftDebounced();
      return;
    }
    if(role==='timer-start'){ e.stopPropagation(); startTimer(versuch.id); return; }
    if(role==='timer-stop'){ e.stopPropagation(); stopTimer(versuch.id); return; }
    if(role==='timer-reset'){ e.stopPropagation(); resetTimer(versuch.id); return; }
  });
}

/* ══════════════════════════════════════════════════════
   STATIC INPUTS
══════════════════════════════════════════════════════ */
function hookStaticInputs(){
  META_FIELDS.forEach(([id])=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input',()=>{ collectMetaFromUi(); saveDraftDebounced(); });
    el.addEventListener('change',()=>{ collectMetaFromUi(); saveDraftDebounced(); });
  });

  BRUNNEN_FIELDS.forEach(([id])=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input',()=>{ collectBrunnenFromUi(); saveDraftDebounced(); scheduleLiveRender(); });
    el.addEventListener('change',()=>{ collectBrunnenFromUi(); saveDraftDebounced(); scheduleLiveRender(); });
  });

  $('sel-foerder')?.addEventListener('change',()=>{ if(!collectSelectionFromUi()) return; renderVersuche(); renderLiveTab(); saveDraftDebounced(); });
  $('sel-schluck')?.addEventListener('change',()=>{ if(!collectSelectionFromUi()) return; renderVersuche(); renderLiveTab(); saveDraftDebounced(); });

  ['restsand-imhoff-menge','restsand-sieb-menge','restsand-bemerkung'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input',()=>{ collectRestsandFromUi(); saveDraftDebounced(); });
    el.addEventListener('change',()=>{ collectRestsandFromUi(); saveDraftDebounced(); });
  });

  ['ph-datum','ph-bauherr','ph-baustelle','ph-gewaessername','ph-sulfat-wert','ph-temp-wert','ph-ph-wert'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input',()=>{ collectPhFromUi(); saveDraftDebounced(); });
    el.addEventListener('change',()=>{ collectPhFromUi(); saveDraftDebounced(); });
  });

  $('settings-alarmDuration')?.addEventListener('input',()=>{ collectSettingsFromUi(); saveDraftDebounced(); });
  $('pdfType-protokoll')?.addEventListener('change',()=>{ collectSettingsFromUi(); saveDraftDebounced(); });
  $('pdfType-vollstaendig')?.addEventListener('change',()=>{ collectSettingsFromUi(); saveDraftDebounced(); });

  $('btnAddVersuch')?.addEventListener('click',()=>{
    const v=defaultVersuch();
    state.versuche.push(v);
    renderVersuche();
    renderLiveTab();
    saveDraftDebounced();
    setTimeout(()=>document.querySelector(`.versuch-card[data-vid="${v.id}"]`)?.scrollIntoView({behavior:'smooth',block:'start'}),40);
  });

  $('btnSave')?.addEventListener('click',()=> saveCurrentToHistory('Pumpversuch im Verlauf gespeichert.'));
  $('btnSaveRestsand')?.addEventListener('click',()=> saveCurrentToHistory('Restsanddaten im Verlauf gespeichert.'));
  $('btnSavePh')?.addEventListener('click',()=> saveCurrentToHistory('pH/Sulfat-Daten im Verlauf gespeichert.'));

  $('btnPdf')?.addEventListener('click',async()=>{
    try{ await exportPdf(null,state.settings.pdfExportType); }
    catch(err){ console.error(err); alert('PDF-Fehler: '+(err?.message||String(err))); }
  });

  $('btnPdfRestsand')?.addEventListener('click',async()=>{
    try{ await exportRestsandPdf(); }
    catch(err){ console.error(err); alert('Restsand-PDF Fehler'); }
  });

  $('btnPdfPh')?.addEventListener('click',async()=>{
    try{ await exportPhPdf(); }
    catch(err){ console.error(err); alert('Sulfat/pH-PDF Fehler'); }
  });

  $('btnReset')?.addEventListener('click',resetAll);

  $('btnExportTemplate')?.addEventListener('click',exportTemplateJson);
  $('btnImportTemplate')?.addEventListener('click',()=> $('importFileInput')?.click());
  $('btnExportFull')?.addEventListener('click',exportFullJson);
  $('btnImportFull')?.addEventListener('click',()=> $('importFullInput')?.click());

  $('importFileInput')?.addEventListener('change',handleTemplateImport);
  $('importFullInput')?.addEventListener('change',handleFullImport);
}

/* ══════════════════════════════════════════════════════
   EXPORT / IMPORT JSON
══════════════════════════════════════════════════════ */
function downloadJson(obj,filename){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function buildTemplateSnapshot(){
  const snap=collectSnapshot();
  snap.overviewPhotoDataUrl='';
  snap.versuche=(snap.versuche||[]).map(v=>{
    const hv=hydrateVersuch(v);
    hv.messungen=(hv.messungen||[]).map(m=>({ min:m.min, foerder_m:'', schluck_m:'', foerder_menge:'' }));
    hv.elapsedMs=0;
    hv.startzeit='';
    hv.photoDataUrl='';
    return hv;
  });
  snap.restsand={ imhoff:{photoDataUrl:'',menge:''}, sieb:{photoDataUrl:'',menge:''}, bemerkung:'' };
  snap.ph={
    datum:'',bauherr:'',baustelle:'',gewaessername:'',
    sulfat:{wert:'',photoDataUrl:''},
    temperatur:{wert:'',photoDataUrl:''},
    ph:{wert:'',photoDataUrl:''}
  };
  return snap;
}
function exportTemplateJson(){
  const snap=buildTemplateSnapshot();
  const obj=(snap.meta.objekt||'Vorlage').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  downloadJson(snap,`${dateTag()}_HTB_Vorlage_${obj||'Pumpversuch'}.htbpump.json`);
}
function exportFullJson(){
  const snap=collectSnapshot();
  const obj=(snap.meta.objekt||'Export').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  downloadJson(snap,`${dateTag()}_HTB_Pumpversuch_${obj||'Export'}.json`);
}
async function handleTemplateImport(e){
  const file=e.target.files?.[0];
  if(!file) return;
  try{
    const raw=await file.text();
    applySnapshot(JSON.parse(raw),true);
    saveDraftDebounced();
    alert('Vorlage importiert.');
  }catch(err){
    console.error(err);
    alert('Vorlage konnte nicht importiert werden.');
  }finally{
    e.target.value='';
  }
}
async function handleFullImport(e){
  const file=e.target.files?.[0];
  if(!file) return;
  try{
    const raw=await file.text();
    applySnapshot(JSON.parse(raw),true);
    saveDraftDebounced();
    alert('Vollständiger Import erfolgreich.');
  }catch(err){
    console.error(err);
    alert('Datei konnte nicht importiert werden.');
  }finally{
    e.target.value='';
  }
}

/* ══════════════════════════════════════════════════════
   LIVE TAB
══════════════════════════════════════════════════════ */
function buildLiveChartSvg(points,key){
  const color=key==='foerder' ? '#56b7ff' : '#ffb45a';
  const W=560,H=280,ml=58,mr=18,mt=18,mb=42;
  const pw=W-ml-mr, ph=H-mt-mb;
  const xMax=points.length?Math.max(...points.map(p=>p.x)):10;
  const yMax=points.length?Math.max(...points.map(p=>p.y)):10;
  const xAxis=getNiceAxis(0,xMax>0?xMax:10,6);
  const yAxis=getNiceAxis(0,yMax>0?yMax:10,6);
  const xTicks=buildTicks(xAxis), yTicks=buildTicks(yAxis);
  const tx=v=>ml+((v-xAxis.min)/(xAxis.max-xAxis.min||1))*pw;
  const ty=v=>mt+ph-((v-yAxis.min)/(yAxis.max-yAxis.min||1))*ph;
  const gridY=yTicks.map(v=>`<line x1="${ml}" y1="${ty(v)}" x2="${W-mr}" y2="${ty(v)}" stroke="rgba(255,255,255,.12)" stroke-width="1"/><text x="${ml-8}" y="${ty(v)+4}" text-anchor="end" fill="rgba(220,240,255,.75)" font-size="11">${h(fmtTick(v,0))}</text>`).join('');
  const gridX=xTicks.map(v=>`<line x1="${tx(v)}" y1="${mt}" x2="${tx(v)}" y2="${mt+ph}" stroke="rgba(255,255,255,.08)" stroke-width="1"/><text x="${tx(v)}" y="${H-16}" text-anchor="middle" fill="rgba(220,240,255,.75)" font-size="11">${h(fmtTick(v,0))}</text>`).join('');
  const poly=points.map(p=>`${tx(p.x)},${ty(p.y)}`).join(' ');
  const circles=points.map(p=>`<circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.2"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#0b1725"/>
    ${gridY}${gridX}
    <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>
    ${points.length?`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`:''}
    ${circles}
    <text x="${ml+pw/2}" y="${H-4}" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">Zeit [min]</text>
    <text x="16" y="${mt+ph/2}" transform="rotate(-90 16 ${mt+ph/2})" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">Absenkung [cm]</text>
    ${!points.length?`<text x="${ml+pw/2}" y="${mt+ph/2}" text-anchor="middle" fill="rgba(220,240,255,.72)" font-size="13">Noch keine Messwerte</text>`:''}
  </svg>`;
}
function buildLiveWellPanelHtml(versuch,key,brunnen){
  const est=getStageKfEstimate(versuch,key,brunnen);
  const points=getWellChartPoints(versuch,key,brunnen);
  const qClass=est.quality?`kf-quality kf-quality--${est.quality}`:'';
  const qText=est.quality==='gut'?'stabil':est.quality==='mittel'?'mittel':'vorläufig';

  return `
<section class="live-well ${key==='foerder'?'live-well--foerder':'live-well--schluck'}">
  <div class="live-well__head">
    <div>
      <div class="live-well__title">${h(getWellLabel(key))}</div>
      <div class="live-well__sub">Ø ${h(fmtMaybe(brunnen?.dm,0))} mm · ET ${h(fmtMaybe(brunnen?.endteufe,2))} m · RW ${h(fmtMaybe(brunnen?.ruhe,3))} m</div>
    </div>
    <div class="kf-box">
      <div class="kf-box__label">Kf-Abschätzung</div>
      <div class="kf-box__value">${Number.isFinite(est.kf)?h(fmtKf(est.kf)):'—'}</div>
      <div class="kf-box__note">${Number.isFinite(est.kf)?`Basis: ${h(est.rateSource||'Rate')} · ${h(fmtMaybe(est.rateM3h,3))} m³/h · ${h(String(est.used))} Punkte`:h(est.reason||'Noch keine Auswertung möglich')}</div>
      ${Number.isFinite(est.kf)?`<div class="${qClass}">${h(qText)}</div>`:''}
    </div>
  </div>
  <div class="live-chart">${buildLiveChartSvg(points,key)}</div>
</section>`;
}
function renderLiveTab(){
  const host=$('liveContainer');
  if(!host) return;
  if(!state.versuche.length){
    host.innerHTML=`<section class="card"><div class="empty-state">Noch keine Pumpstufe vorhanden.</div></section>`;
    return;
  }

  const sel=getSelectedWells();
  const single=(sel.foerder?1:0)+(sel.schluck?1:0)===1;

  host.innerHTML=state.versuche.map((v,idx)=>{
    const rateM3h=getCalcRateM3h(v), rateLs=getCalcRateLs(v), rateSource=getCalcRateSource(v);
    return `<section class="card live-stage">
      <div class="live-stage__head">
        <div>
          <div class="live-stage__title">${h(getStageTitle(idx))}</div>
          <div class="live-stage__meta">Rate für Auswertung: <b>${h(rateM3h||'—')} m³/h</b> · <b>${h(rateLs||'—')} l/s</b>${rateSource?` · Quelle: ${h(rateSource)}`:''}</div>
        </div>
      </div>
      <div class="live-grid ${single?'live-grid--single':''}">
        ${sel.foerder?buildLiveWellPanelHtml(v,'foerder',state.foerder):''}
        ${sel.schluck?buildLiveWellPanelHtml(v,'schluck',state.schluck):''}
      </div>
    </section>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════
   HISTORY + FOTOEXPORT
══════════════════════════════════════════════════════ */
function buildHistoryKfHtml(snapshot){
  const versuche=Array.isArray(snapshot?.versuche)?snapshot.versuche:[];
  if(!versuche.length) return '';
  const lines=versuche.map((raw,idx)=>{
    const v=hydrateVersuch(raw);
    const parts=[];
    if(snapshot.selection?.foerder){
      const e=getStageKfEstimate(v,'foerder',snapshot.foerder||{});
      parts.push(`Förderbrunnen: ${Number.isFinite(e.kf)?fmtKf(e.kf):'—'}`);
    }
    if(snapshot.selection?.schluck){
      const e=getStageKfEstimate(v,'schluck',snapshot.schluck||{});
      parts.push(`Rückgabe: ${Number.isFinite(e.kf)?fmtKf(e.kf):'—'}`);
    }
    return `<div class="historyKf__line">${h(`${getStageTitle(idx)} · ${parts.join(' · ')}`)}</div>`;
  });
  return `<div class="historyKf"><div class="historyKf__title">Kf-Abschätzung</div>${lines.join('')}</div>`;
}
function collectSnapshotPhotos(snapshot){
  const photos=[];
  const obj=(snapshot.meta?.objekt||'Pumpversuch').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_') || 'Pumpversuch';

  if(snapshot.overviewPhotoDataUrl) photos.push({ name:`${obj}_Uebersicht`, dataUrl:snapshot.overviewPhotoDataUrl });
  (snapshot.versuche||[]).forEach((v,i)=>{ if(v.photoDataUrl) photos.push({ name:`${obj}_Stufe_${i+1}_Durchflussmesser`, dataUrl:v.photoDataUrl }); });
  if(snapshot.restsand?.imhoff?.photoDataUrl) photos.push({ name:`${obj}_Restsand_Imhoff`, dataUrl:snapshot.restsand.imhoff.photoDataUrl });
  if(snapshot.restsand?.sieb?.photoDataUrl) photos.push({ name:`${obj}_Restsand_Sieb`, dataUrl:snapshot.restsand.sieb.photoDataUrl });
  if(snapshot.ph?.sulfat?.photoDataUrl) photos.push({ name:`${obj}_Sulfat`, dataUrl:snapshot.ph.sulfat.photoDataUrl });
  if(snapshot.ph?.temperatur?.photoDataUrl) photos.push({ name:`${obj}_Temperatur`, dataUrl:snapshot.ph.temperatur.photoDataUrl });
  if(snapshot.ph?.ph?.photoDataUrl) photos.push({ name:`${obj}_pH`, dataUrl:snapshot.ph.ph.photoDataUrl });
  return photos;
}
function guessExtFromDataUrl(dataUrl){
  if(/^data:image\/png/i.test(dataUrl)) return 'png';
  if(/^data:image\/webp/i.test(dataUrl)) return 'webp';
  return 'jpg';
}
function downloadDataUrl(dataUrl,filename){
  const a=document.createElement('a');
  a.href=dataUrl;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function exportPhotosFromSnapshot(snapshot){
  const photos=collectSnapshotPhotos(snapshot);
  if(!photos.length){ alert('Keine Fotos in dieser Messung vorhanden.'); return; }
  for(let i=0;i<photos.length;i++){
    const p=photos[i];
    downloadDataUrl(p.dataUrl,`${p.name}.${guessExtFromDataUrl(p.dataUrl)}`);
    await new Promise(r=>setTimeout(r,250));
  }
  alert(`${photos.length} Foto(s) wurden exportiert.`);
}

function renderHistoryList(){
  const host=$('historyList');
  if(!host) return;
  const list=readHistory();

  if(!list.length){
    host.innerHTML=`<div class="text"><p>Noch keine Protokolle gespeichert.</p></div>`;
    return;
  }

  host.innerHTML=list.map(entry=>{
    const snap=entry.snapshot||{};
    const count=Array.isArray(snap.versuche)?snap.versuche.length:0;
    const rsImhoff=snap.restsand?.imhoff?.menge || '—';
    const rsSieb=snap.restsand?.sieb?.menge || '—';
    const sulfat=snap.ph?.sulfat?.wert || '—';
    const temp=snap.ph?.temperatur?.wert || '—';
    const phv=snap.ph?.ph?.wert || '—';

    return `<details class="historyItem" data-hid="${h(entry.id)}">
      <summary class="historyItem__head">
        <span class="historyItem__chevron">▸</span>
        <span class="historyItem__title">${h(entry.title)}</span>
        <span class="historyItem__date">${h(new Date(entry.savedAt).toLocaleString('de-DE'))}</span>
      </summary>

      <div class="historyItem__body">
        <div class="historySections">
          <details class="historySection" open>
            <summary>Protokoll</summary>
            <div class="historySection__body">
              Objekt: <b>${h(snap.meta?.objekt||'—')}</b><br>
              Ort: <b>${h(snap.meta?.ort||'—')}</b><br>
              Pumpstufen: <b>${count}</b><br>
              Beweisfotos: <b>${(snap.versuche||[]).filter(v=>!!v.photoDataUrl).length}</b>
            </div>
          </details>

          <details class="historySection">
            <summary>Restsandmessung</summary>
            <div class="historySection__body">
              Imhoff: <b>${h(String(rsImhoff))}</b><br>
              Sieb/Gewicht: <b>${h(String(rsSieb))}</b><br>
              Fotos: <b>${(snap.restsand?.imhoff?.photoDataUrl?1:0)+(snap.restsand?.sieb?.photoDataUrl?1:0)}</b>
            </div>
          </details>

          <details class="historySection">
            <summary>pH / Sulfat</summary>
            <div class="historySection__body">
              Sulfat: <b>${h(String(sulfat))}</b><br>
              Temperatur: <b>${h(String(temp))}</b><br>
              pH: <b>${h(String(phv))}</b>
            </div>
          </details>
        </div>

        ${buildHistoryKfHtml(snap)}

        <div class="historyBtns">
          <button type="button" data-hact="load" data-id="${h(entry.id)}">Laden</button>
          <button type="button" data-hact="pdf-protokoll" data-id="${h(entry.id)}">PDF Protokoll</button>
          <button type="button" data-hact="pdf-voll" data-id="${h(entry.id)}">PDF Vollständig</button>
          <button type="button" data-hact="pdf-restsand" data-id="${h(entry.id)}">PDF Restsand</button>
          <button type="button" data-hact="pdf-ph" data-id="${h(entry.id)}">PDF Sulfat</button>
          <button type="button" class="btn--export-photos" data-hact="photos" data-id="${h(entry.id)}">Fotos exportieren</button>
          <button type="button" data-hact="del" data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>
    </details>`;
  }).join('');
}

function hookHistoryDelegation(){
  const host=$('historyList');
  if(!host || host.dataset.bound==='1') return;
  host.dataset.bound='1';

  host.addEventListener('click',async(e)=>{
    const btn=e.target.closest('[data-hact]');
    if(!btn) return;

    const id=btn.dataset.id;
    const act=btn.dataset.hact;
    const list=readHistory();
    const entry=list.find(x=>x.id===id);

    if(act==='del'){
      writeHistory(list.filter(x=>x.id!==id));
      renderHistoryList();
      return;
    }
    if(!entry) return;

    if(act==='load'){
      applySnapshot(entry.snapshot,true);
      saveDraftDebounced();
      document.querySelector('.tab[data-tab="protokoll"]')?.click();
      return;
    }
    if(act==='pdf-protokoll'){
      try{ await exportPdf(entry.snapshot,'protokoll'); }catch(err){ console.error(err); alert('PDF-Fehler'); }
      return;
    }
    if(act==='pdf-voll'){
      try{ await exportPdf(entry.snapshot,'vollstaendig'); }catch(err){ console.error(err); alert('PDF-Fehler'); }
      return;
    }
    if(act==='pdf-restsand'){
      try{ await exportRestsandPdf(entry.snapshot); }catch(err){ console.error(err); alert('Restsand-PDF Fehler'); }
      return;
    }
    if(act==='pdf-ph'){
      try{ await exportPhPdf(entry.snapshot); }catch(err){ console.error(err); alert('Sulfat-PDF Fehler'); }
      return;
    }
    if(act==='photos'){
      try{ await exportPhotosFromSnapshot(entry.snapshot); }catch(err){ console.error(err); alert('Fotoexport fehlgeschlagen.'); }
    }
  });
}

/* ══════════════════════════════════════════════════════
   PDF HELPERS
══════════════════════════════════════════════════════ */
function drawTextSafe(page,text,options){
  page.drawText(pdfSafe(text),options);
}
async function loadPdfAssets(pdf){
  const fontkit=window.fontkit || window.PDFLibFontkit;
  if(!fontkit) throw new Error('fontkit nicht geladen');

  pdf.registerFontkit(fontkit);

  const fontBytesR=await fetch(`${BASE}fonts/arial.ttf?v=60`).then(r=>r.arrayBuffer());
  let fontBytesB=null;
  try{ fontBytesB=await fetch(`${BASE}fonts/arialbd.ttf?v=60`).then(r=>r.arrayBuffer()); }catch{}
  const fontR=await pdf.embedFont(fontBytesR,{ subset:true });
  const fontB=fontBytesB ? await pdf.embedFont(fontBytesB,{ subset:true }) : fontR;

  let logo=null;
  try{
    const bytes=await fetch(`${BASE}logo.png?v=30`).then(r=>r.arrayBuffer());
    logo=await pdf.embedPng(bytes);
  }catch{}

  return { fontR,fontB,logo };
}
function getPdfCtx(PDFLib,assets){
  const { rgb, degrees } = PDFLib;
  const PAGE_W=595.28, PAGE_H=841.89;
  const mm=v=>v*72/25.4;
  const K=rgb(0,0,0);
  const GREY=rgb(0.90,0.90,0.90);
  return { PAGE_W,PAGE_H,mm,K,GREY,rgb,degrees,...assets };
}

function getPdfRateM3hNumber(v){
  const m=Number(v?.manualRateM3h);
  if(Number.isFinite(m)&&m>0) return m;
  const a=getAverageFoerderMengeNumber(v);
  if(Number.isFinite(a)&&a>0) return a;
  return NaN;
}
function getPdfRateM3h(v){
  const n=getPdfRateM3hNumber(v);
  return Number.isFinite(n)?n.toFixed(3):'—';
}
function getPdfRateLs(v){
  const n=getPdfRateM3hNumber(v);
  return Number.isFinite(n)?(n/3.6).toFixed(3):'—';
}
function getWellRowsForPdf(versuch,key,ruhe){
  const field=key==='foerder'?'foerder_m':'schluck_m';
  const ruheNum=Number(ruhe);
  return getRowsForExport(versuch).map(r=>{
    const min=Number(r.min), raw=r[field];
    const hasValue=String(raw??'').trim()!=='' && Number.isFinite(Number(raw));
    const valueNum=hasValue ? Number(raw) : null;
    const deltaM=(hasValue&&Number.isFinite(ruheNum)) ? Math.abs(valueNum-ruheNum) : null;
    const deltaCm=deltaM!==null ? deltaM*100 : null;
    return { min:Number.isFinite(min)?min:null, valueNum, deltaM, deltaCm };
  });
}

function drawFooter(page,ctx,subtitle=''){
  const { mm,fontR,K,PAGE_W }=ctx;
  const y=mm(8);
  drawTextSafe(page,`${FIRMA.name} ${FIRMA.adresse} ${FIRMA.tel}`,{ x:mm(12), y, size:7.8, font:fontR, color:K });
  drawTextSafe(page,`${FIRMA.email} · ${FIRMA.web}${subtitle ? ' · '+subtitle : ''}`,{ x:mm(12), y:mm(4), size:7.8, font:fontR, color:K });
}
function drawHeaderBar(page,ctx,title,sub=''){
  const { mm,fontR,fontB,K,GREY,logo,PAGE_W,PAGE_H }=ctx;
  const margin=mm(8), W=PAGE_W-2*margin, H=PAGE_H-2*margin;
  const hdrH=mm(13);

  page.drawRectangle({ x:margin, y:margin+H-hdrH, width:W, height:hdrH, color:GREY, borderColor:K, borderWidth:0.8 });
  if(logo){
    const lh=hdrH*0.75;
    const scale=lh/logo.height;
    page.drawImage(logo,{ x:margin+mm(2), y:margin+H-hdrH+(hdrH-lh)/2, width:logo.width*scale, height:lh });
  }
  drawTextSafe(page,title,{ x:margin+mm(32), y:margin+H-hdrH+mm(4.2), size:13, font:fontB, color:K });
  if(sub) drawTextSafe(page,sub,{ x:margin+mm(32), y:margin+H-hdrH+mm(1.5), size:8, font:fontR, color:K });
}

function drawMetaGrid(page,x,yTop,w,rowH,meta,fontR,fontB,K){
  const rows=[
    [['Objekt',meta.objekt||''],['Geprüft durch',meta.geprueftDurch||''],['Straße',meta.grundstueck||''],['Geprüft am',dateDE(meta.geprueftAm)||'']],
    [['Ort',meta.ort||''],['Geologie',meta.geologie||''],['Auftragsnummer',meta.auftragsnummer||''],['Auftraggeber',meta.auftraggeber||'']],
    [['Bohrmeister',meta.bohrmeister||''],['Bauleitung',meta.bauleitung||''],['Koordination',meta.koordination||''],['','']]
  ];
  rows.forEach((row,rIdx)=>{
    const y=yTop-rowH*(rIdx+1);
    page.drawRectangle({ x, y, width:w, height:rowH, borderColor:K, borderWidth:0.7 });
    const cw=w/4;
    for(let i=1;i<4;i++) page.drawLine({ start:{x:x+i*cw,y}, end:{x:x+i*cw,y:y+rowH}, thickness:0.7, color:K });
    row.forEach((cell,i)=>{
      const cx=x+i*cw+4;
      if(cell[0]) drawTextSafe(page,cell[0],{ x:cx, y:y+rowH-10, size:7, font:fontB, color:K });
      if(cell[1]) drawTextSafe(page,cell[1],{ x:cx, y:y+4, size:8, font:fontR, color:K });
    });
  });
}

function drawWellTable(page,opt){
  const { x,yTop,w,key,rows,fontR,fontB,K,grey }=opt;
  const title=getWellLabel(key);
  const titleH=13, headH=15, rowH=8.2;
  const totalH=titleH+headH+rows.length*rowH;

  page.drawRectangle({ x, y:yTop-titleH, width:w, height:titleH, color:grey, borderColor:K, borderWidth:0.7 });
  drawTextSafe(page,title,{ x:x+4, y:yTop-titleH+3.8, size:7.8, font:fontB, color:K });

  const yHead=yTop-titleH-headH;
  page.drawRectangle({ x, y:yHead, width:w, height:headH, borderColor:K, borderWidth:0.7 });

  const colWidths=[0.18,0.42,0.40];
  const xs=[x]; colWidths.forEach(cw=>xs.push(xs[xs.length-1]+w*cw));
  for(let i=1;i<xs.length-1;i++){
    page.drawLine({ start:{x:xs[i],y:yTop-totalH}, end:{x:xs[i],y:yTop-titleH}, thickness:0.6, color:K });
  }

  drawTextSafe(page,'Min',{ x:xs[0]+3, y:yHead+5, size:6.8, font:fontB, color:K });
  drawTextSafe(page,'m ab OK Brunnen',{ x:xs[1]+3, y:yHead+5, size:6.8, font:fontB, color:K });
  drawTextSafe(page,'Δ Ruhewasser [m]',{ x:xs[2]+3, y:yHead+5, size:6.8, font:fontB, color:K });

  let y=yHead;
  rows.forEach(r=>{
    const nextY=y-rowH;
    page.drawLine({ start:{x,y:nextY}, end:{x:x+w,y:nextY}, thickness:0.6, color:K });
    drawTextSafe(page, Number.isFinite(r.min)?String(r.min):'—', { x:xs[0]+3, y:nextY+2.4, size:6.7, font:fontR, color:K });
    drawTextSafe(page, r.valueNum!==null?fmtComma(r.valueNum,3):'—', { x:xs[1]+3, y:nextY+2.4, size:6.7, font:fontR, color:K });
    drawTextSafe(page, r.deltaM!==null?fmtComma(r.deltaM,3):'—', { x:xs[2]+3, y:nextY+2.4, size:6.7, font:fontR, color:K });
    y=nextY;
  });

  page.drawRectangle({ x, y:yTop-totalH, width:w, height:totalH, borderColor:K, borderWidth:0.7 });
  return totalH;
}
function drawWellChart(page,opt){
  const { x,y,w,h,key,rows,fontR,fontB,K,grey,degrees,gridColor,lineColor }=opt;

  page.drawRectangle({ x, y, width:w, height:h, borderColor:K, borderWidth:0.7 });
  page.drawRectangle({ x, y:y+h-13, width:w, height:13, color:grey, borderColor:K, borderWidth:0.7 });
  drawTextSafe(page,`Diagramm ${getWellLabel(key)}`,{ x:x+4, y:y+h-9, size:7.6, font:fontB, color:K });

  const plotPadL=42, plotPadR=10, plotPadT=40, plotPadB=12;
  const px=x+plotPadL, py=y+plotPadB;
  const pw=w-plotPadL-plotPadR, ph=h-plotPadT-plotPadB;
  const plotTop=py+ph;
  const valid=rows.filter(r=>Number.isFinite(r.min)&&Number.isFinite(r.deltaCm));
  const maxX=valid.length?Math.max(...valid.map(p=>p.min)):10;
  const maxY=valid.length?Math.max(...valid.map(p=>p.deltaCm)):10;
  const xAxis=getNiceAxis(0,maxX>0?maxX:10,6);
  const yAxis=getNiceAxis(0,maxY>0?maxY:10,6);
  const xTicks=buildTicks(xAxis), yTicks=buildTicks(yAxis);
  const tx=v=>px+((v-xAxis.min)/(xAxis.max-xAxis.min||1))*pw;
  const ty=v=>py+((v-yAxis.min)/(yAxis.max-yAxis.min||1))*ph;

  yTicks.forEach(v=>{
    const yy=ty(v);
    page.drawLine({ start:{x:px,y:yy}, end:{x:px+pw,y:yy}, thickness:0.5, color:gridColor });
    drawTextSafe(page, fmtTick(v,0), { x:px-22, y:yy-2, size:6.2, font:fontR, color:K });
  });
  xTicks.forEach(v=>{
    const xx=tx(v);
    page.drawLine({ start:{x:xx,y:py}, end:{x:xx,y:py+ph}, thickness:0.5, color:gridColor });
    drawTextSafe(page, fmtTick(v,0), { x:xx-6, y:plotTop+4, size:6.2, font:fontR, color:K });
  });

  page.drawRectangle({ x:px, y:py, width:pw, height:ph, borderColor:K, borderWidth:0.7 });
  drawTextSafe(page,'Zeit [min]',{ x:px+pw/2-18, y:plotTop+16, size:6.8, font:fontB, color:K });
  drawTextSafe(page,'Absenkung [cm]',{ x:x+10, y:py+ph/2-22, size:6.8, font:fontB, color:K, rotate:degrees(90) });

  if(!valid.length){
    drawTextSafe(page,'Noch keine Messwerte',{ x:px+pw/2-28, y:py+ph/2, size:7, font:fontR, color:K });
    return;
  }

  for(let i=0;i<valid.length-1;i++){
    const a=valid[i], b=valid[i+1];
    page.drawLine({ start:{x:tx(a.min),y:ty(a.deltaCm)}, end:{x:tx(b.min),y:ty(b.deltaCm)}, thickness:1.3, color:lineColor });
  }
  valid.forEach(p=>{
    page.drawCircle({ x:tx(p.min), y:ty(p.deltaCm), size:2.1, color:lineColor, borderColor:K, borderWidth:0.3 });
  });
}

function drawStageSplitLayout(page,opt){
  const { x,yTop,yBottom,w,versuch,foerder,schluck,fontR,fontB,K,grey,degrees,rgb,selection }=opt;
  const stageH=22;
  page.drawRectangle({ x, y:yTop-stageH, width:w, height:stageH, color:grey, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page, `Pumpversuch   ${versuch._stageTitle||'Stufe'}   ${getPdfRateLs(versuch)} [l/s]`, { x:x+4, y:yTop-stageH+11, size:8.5, font:fontB, color:K });
  drawTextSafe(page, `${getPdfRateM3h(versuch)} [m³/h]`, { x:x+4, y:yTop-stageH+4, size:7.5, font:fontR, color:K });

  const keys=['foerder','schluck'].filter(k=>selection[k]);
  if(!keys.length) return;

  const gap=10;
  const colW=keys.length>1 ? (w-gap)/2 : w;
  const contentTop=yTop-stageH-6;

  keys.forEach((key,i)=>{
    const well=key==='foerder'?foerder:schluck;
    const rows=getWellRowsForPdf(versuch,key,well?.ruhe);
    const colX=x+i*(colW+gap);
    const tableTop=contentTop;
    const tableH=drawWellTable(page,{ x:colX, yTop:tableTop, w:colW, key, rows, fontR, fontB, K, grey });
    const chartTop=tableTop-tableH-6;
    const chartY=yBottom;
    const chartH=Math.max(95, chartTop-chartY);

    drawWellChart(page,{
      x:colX, y:chartY, w:colW, h:chartH, key, rows,
      fontR, fontB, K, grey, degrees,
      gridColor: rgb(0.82,0.82,0.82),
      lineColor: key==='foerder' ? rgb(0.16,0.46,0.84) : rgb(0.90,0.56,0.16)
    });
  });
}

async function drawImagePage(pdf,ctx,title,subtitle,dataUrl){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY,logo }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:x0, y:y0, width:W, height:H, borderColor:K, borderWidth:1.2 });
  const hdrH=mm(13);
  page.drawRectangle({ x:x0, y:y0+H-hdrH, width:W, height:hdrH, color:GREY, borderColor:K, borderWidth:0.8 });

  if(logo){
    const lh=hdrH*0.75, scale=lh/logo.height;
    page.drawImage(logo,{ x:x0+mm(2), y:y0+H-hdrH+(hdrH-lh)/2, width:logo.width*scale, height:lh });
  }

  drawTextSafe(page,title,{ x:x0+mm(32), y:y0+H-hdrH+mm(4.2), size:13, font:fontB, color:K });
  if(subtitle) drawTextSafe(page,subtitle,{ x:x0+mm(32), y:y0+H-hdrH+mm(1.5), size:8, font:fontR, color:K });

  if(dataUrl){
    try{
      const img=await embedDataUrlImage(pdf,dataUrl);
      const areaX=x0+mm(8), areaY=y0+mm(12), areaW=W-mm(16), areaH=H-hdrH-mm(18);
      const ratio=img.width/img.height;
      let dw=areaW, dh=dw/ratio;
      if(dh>areaH){ dh=areaH; dw=dh*ratio; }
      const dx=areaX+(areaW-dw)/2, dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
    }catch(err){
      console.error(err);
      drawTextSafe(page,'Bild konnte nicht eingebettet werden.',{ x:x0+20, y:y0+H/2, size:10, font:fontR, color:K });
    }
  }else{
    page.drawRectangle({ x:x0+mm(15), y:y0+mm(20), width:W-mm(30), height:H-hdrH-mm(35), borderColor:K, borderWidth:0.8 });
    drawTextSafe(page,'Kein Bild vorhanden.',{ x:x0+35, y:y0+H/2, size:10, font:fontR, color:K });
  }
  drawFooter(page,ctx,title);
}

async function drawCoverPage(pdf,ctx,snap){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,logo }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(14),W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:margin, y:margin, width:W, height:H, borderColor:K, borderWidth:1.2 });

  if(logo){
    const w=mm(55), h=logo.height*(w/logo.width);
    page.drawImage(logo,{ x:margin+mm(4), y:PAGE_H-margin-h-mm(2), width:w, height:h });
  }

  drawTextSafe(page,FIRMA.name,{ x:margin+mm(4), y:PAGE_H-margin-mm(18), size:11, font:fontB, color:K });
  drawTextSafe(page,FIRMA.slogan,{ x:margin+mm(4), y:PAGE_H-margin-mm(25), size:8.5, font:fontR, color:K });

  drawTextSafe(page,'Pumpversuch',{ x:margin+mm(4), y:PAGE_H-margin-mm(38), size:24, font:fontB, color:K });
  drawTextSafe(page,'BAUVORHABEN',{ x:margin+mm(4), y:PAGE_H-margin-mm(53), size:10, font:fontB, color:K });
  drawTextSafe(page,snap.meta?.objekt || '—',{ x:margin+mm(4), y:PAGE_H-margin-mm(62), size:18, font:fontR, color:K });

  drawTextSafe(page,'AUFTRAGGEBER',{ x:margin+mm(4), y:PAGE_H-margin-mm(78), size:10, font:fontB, color:K });
  drawTextSafe(page,snap.meta?.auftraggeber || '—',{ x:margin+mm(4), y:PAGE_H-margin-mm(87), size:16, font:fontR, color:K });

  drawTextSafe(page,`Arzl, am ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,{
    x:margin+mm(4), y:PAGE_H-margin-mm(104), size:12, font:fontR, color:K
  });

  const photo=snap.overviewPhotoDataUrl || snap.versuche?.find(v=>v.photoDataUrl)?.photoDataUrl || '';
  if(photo){
    try{
      const img=await embedDataUrlImage(pdf,photo);
      const areaX=margin+mm(4), areaY=margin+mm(20), areaW=W-mm(8), areaH=mm(110);
      const ratio=img.width/img.height;
      let dw=areaW, dh=dw/ratio;
      if(dh>areaH){ dh=areaH; dw=dh*ratio; }
      const dx=areaX+(areaW-dw)/2, dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
    }catch(err){ console.error(err); }
  }

  drawFooter(page,ctx,'Pumpversuch');
}

async function drawTocPage(pdf,ctx,snap,hasOverview,hasRestsand,hasPh){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,logo }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(14),W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:margin, y:margin, width:W, height:H, borderColor:K, borderWidth:1.2 });

  if(logo){
    const w=mm(52), h=logo.height*(w/logo.width);
    page.drawImage(logo,{ x:margin+mm(4), y:PAGE_H-margin-h-mm(2), width:w, height:h });
  }

  drawTextSafe(page,'Inhaltsverzeichnis',{ x:margin+mm(4), y:PAGE_H-margin-mm(32), size:22, font:fontB, color:K });

  const lines=['1. Protokoll Pumpversuch'];
  let n=2;
  if(hasOverview) lines.push(`${n++}. Übersichtsfoto`);
  if(hasRestsand) lines.push(`${n++}. Restsandmessung`);
  if(hasPh) lines.push(`${n++}. pH / Sulfat`);

  let y=PAGE_H-margin-mm(50);
  lines.forEach(line=>{
    drawTextSafe(page,line,{ x:margin+mm(8), y, size:14, font:fontR, color:K });
    y-=mm(10);
  });

  drawFooter(page,ctx,'Pumpversuch');
}

async function drawProtocolStagePage(pdf,ctx,snap,versuch,index){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY,logo,rgb,degrees }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:x0, y:y0, width:W, height:H, borderColor:K, borderWidth:1.2 });

  drawHeaderBar(page,ctx,'Pumpversuch',FIRMA.name);

  let cy=y0+H-mm(13)-mm(2);
  const metaRowH=mm(9);
  drawMetaGrid(page,x0,cy,W,metaRowH,snap.meta||{},fontR,fontB,K);
  cy -= metaRowH*3;

  const ruheHdrH=10, ruheRowH=13;
  page.drawRectangle({ x:x0, y:cy-ruheHdrH, width:W, height:ruheHdrH, color:GREY, borderColor:K, borderWidth:0.7 });
  drawTextSafe(page,'Ruhewasserspiegel [m]',{ x:x0+4, y:cy-ruheHdrH+2.5, size:7.5, font:fontB, color:K });
  cy -= ruheHdrH;

  const selection=snap.selection||{foerder:true,schluck:true};
  const wellsRW=[];
  if(selection.foerder) wellsRW.push({ label:'Förderbrunnen ab OK Brunnenausbau', value:snap.foerder?.ruhe?fmtComma(snap.foerder.ruhe,3):'—' });
  if(selection.schluck) wellsRW.push({ label:'Rückgabebrunnen ab OK Brunnenausbau', value:snap.schluck?.ruhe?fmtComma(snap.schluck.ruhe,3):'—' });

  page.drawRectangle({ x:x0, y:cy-ruheRowH, width:W, height:ruheRowH, borderColor:K, borderWidth:0.7 });
  if(wellsRW.length===2){
    const labelW=W*0.37, valueW=W*0.13;
    const xs=[x0,x0+labelW,x0+labelW+valueW,x0+labelW+valueW+labelW,x0+W];
    for(let k=1;k<4;k++) page.drawLine({ start:{x:xs[k],y:cy-ruheRowH}, end:{x:xs[k],y:cy}, thickness:0.7, color:K });
    drawTextSafe(page,wellsRW[0].label,{ x:xs[0]+3, y:cy-ruheRowH+4, size:6.2, font:fontR, color:K });
    drawTextSafe(page,wellsRW[0].value,{ x:xs[1]+3, y:cy-ruheRowH+4, size:7.2, font:fontR, color:K });
    drawTextSafe(page,wellsRW[1].label,{ x:xs[2]+3, y:cy-ruheRowH+4, size:6.2, font:fontR, color:K });
    drawTextSafe(page,wellsRW[1].value,{ x:xs[3]+3, y:cy-ruheRowH+4, size:7.2, font:fontR, color:K });
  }else if(wellsRW.length===1){
    const labelW=W*0.74;
    const xs=[x0,x0+labelW,x0+W];
    page.drawLine({ start:{x:xs[1],y:cy-ruheRowH}, end:{x:xs[1],y:cy}, thickness:0.7, color:K });
    drawTextSafe(page,wellsRW[0].label,{ x:xs[0]+3, y:cy-ruheRowH+4, size:6.2, font:fontR, color:K });
    drawTextSafe(page,wellsRW[0].value,{ x:xs[1]+3, y:cy-ruheRowH+4, size:7.2, font:fontR, color:K });
  }
  cy -= ruheRowH;

  page.drawRectangle({ x:x0, y:cy-metaRowH, width:W, height:metaRowH, color:GREY, borderColor:K, borderWidth:0.7 });
  const wellTexts=[];
  if(selection.foerder) wellTexts.push(`Förderbrunnen: Ø ${snap.foerder?.dm||'—'} mm · ET ${snap.foerder?.endteufe||'—'} m`);
  if(selection.schluck) wellTexts.push(`Rückgabebrunnen: Ø ${snap.schluck?.dm||'—'} mm · ET ${snap.schluck?.endteufe||'—'} m`);
  drawTextSafe(page,wellTexts.join('   |   '),{ x:x0+4, y:cy-metaRowH+6, size:7.1, font:fontR, color:K });
  cy -= metaRowH+mm(3);

  versuch._stageTitle=getStageTitle(index);
  drawStageSplitLayout(page,{
    x:x0,yTop:cy,yBottom:y0+mm(9),w:W,
    versuch,foerder:snap.foerder||{},schluck:snap.schluck||{},
    fontR,fontB,K,grey:GREY,degrees,rgb,selection
  });

  drawFooter(page,ctx,'Pumpversuch');
}

async function drawRestsandPage(pdf,ctx,snap){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:x0, y:y0, width:W, height:H, borderColor:K, borderWidth:1.2 });
  drawHeaderBar(page,ctx,'Restsandmessung',FIRMA.name);

  const titleY=y0+H-mm(24);
  page.drawRectangle({ x:x0, y:titleY-mm(10), width:W, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`Objekt: ${snap.meta?.objekt || '—'} · Datum: ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,{ x:x0+4, y:titleY-mm(7), size:8.8, font:fontB, color:K });

  const colGap=mm(6);
  const colW=(W-colGap)/2;
  const topY=titleY-mm(6);
  const blockH=H-mm(46);

  const defs=[
    { title:'Imhoff-Trichter', data:snap.restsand?.imhoff, valueLabel:'Menge [ml/l]' },
    { title:'Sieb / Gewicht', data:snap.restsand?.sieb, valueLabel:'Menge [g]' }
  ];

  for(let i=0;i<defs.length;i++){
    const x=x0+i*(colW+colGap);
    page.drawRectangle({ x, y:y0+mm(20), width:colW, height:blockH, borderColor:K, borderWidth:0.8 });
    page.drawRectangle({ x, y:topY-mm(10), width:colW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
    drawTextSafe(page,defs[i].title,{ x:x+4, y:topY-mm(7), size:10, font:fontB, color:K });

    const photoUrl=defs[i].data?.photoDataUrl || '';
    if(photoUrl){
      try{
        const img=await embedDataUrlImage(pdf,photoUrl);
        const areaX=x+mm(4), areaW=colW-mm(8), areaTop=topY-mm(16), areaBottom=y0+mm(45), areaH=areaTop-areaBottom;
        const ratio=img.width/img.height;
        let dw=areaW, dh=dw/ratio;
        if(dh>areaH){ dh=areaH; dw=dh*ratio; }
        const dx=areaX+(areaW-dw)/2, dy=areaBottom+(areaH-dh)/2;
        page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
      }catch(err){ console.error(err); }
    }else{
      drawTextSafe(page,'Kein Foto vorhanden.',{ x:x+18, y:y0+blockH/2, size:10, font:fontR, color:K });
    }

    page.drawRectangle({ x, y:y0+mm(20), width:colW, height:mm(14), color:GREY, borderColor:K, borderWidth:0.8 });
    drawTextSafe(page,`${defs[i].valueLabel}: ${defs[i].data?.menge || '—'}`,{ x:x+4, y:y0+mm(24), size:10, font:fontB, color:K });
  }

  if(snap.restsand?.bemerkung){
    drawTextSafe(page,`Bemerkung: ${snap.restsand.bemerkung}`,{ x:x0+4, y:y0+7, size:8, font:fontR, color:K });
  }

  drawFooter(page,ctx,'Restsandmessung');
}

async function drawPhPage(pdf,ctx,snap){
  const { PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY }=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;

  page.drawRectangle({ x:x0, y:y0, width:W, height:H, borderColor:K, borderWidth:1.2 });
  drawHeaderBar(page,ctx,'Prüfprotokoll Sulfatmessung Wasser',FIRMA.name);

  const headerTop=y0+H-mm(20), rowH=mm(10);
  const cells=[
    ['Datum', dateDE(snap.ph?.datum)||dateDE(snap.meta?.geprueftAm)||todayDE(), x0, W*0.45],
    ['Bauherr', snap.ph?.bauherr || snap.meta?.auftraggeber || '—', x0+W*0.55, W*0.45]
  ];
  cells.forEach(c=>{
    page.drawRectangle({ x:c[2], y:headerTop-rowH, width:c[3], height:rowH, borderColor:K, borderWidth:0.8 });
    drawTextSafe(page,`${c[0]}: ${c[1]}`,{ x:c[2]+4, y:headerTop-rowH+4, size:9, font:fontR, color:K });
  });

  page.drawRectangle({ x:x0, y:headerTop-rowH*2-mm(2), width:W, height:rowH, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`Baustelle: ${snap.ph?.baustelle || snap.meta?.objekt || '—'}`,{ x:x0+4, y:headerTop-rowH*2-mm(2)+4, size:9, font:fontR, color:K });

  page.drawRectangle({ x:x0, y:headerTop-rowH*3-mm(4), width:W, height:rowH, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`Gewässername / Entnahmestelle: ${snap.ph?.gewaessername || '—'}`,{ x:x0+4, y:headerTop-rowH*3-mm(4)+4, size:9, font:fontR, color:K });

  const sectionY=headerTop-rowH*4-mm(10);
  page.drawRectangle({ x:x0, y:sectionY, width:W, height:mm(9), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,'Messung mittels Teststäbchen "Quantofix" – Ergebnis nach 120 sec',{ x:x0+4, y:sectionY+3.5, size:9, font:fontB, color:K });

  const topBlockY=sectionY-mm(95);
  const leftW=W*0.38;
  const rightW=W-leftW-mm(6);

  page.drawRectangle({ x:x0, y:topBlockY, width:leftW, height:mm(88), borderColor:K, borderWidth:0.8 });
  page.drawRectangle({ x:x0+leftW+mm(6), y:topBlockY, width:rightW, height:mm(88), borderColor:K, borderWidth:0.8 });

  if(snap.ph?.sulfat?.photoDataUrl){
    try{
      const img=await embedDataUrlImage(pdf,snap.ph.sulfat.photoDataUrl);
      const areaX=x0+4, areaY=topBlockY+mm(12), areaW=leftW-8, areaH=mm(70);
      const ratio=img.width/img.height;
      let dw=areaW, dh=dw/ratio;
      if(dh>areaH){ dh=areaH; dw=dh*ratio; }
      const dx=areaX+(areaW-dw)/2, dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
    }catch(err){ console.error(err); }
  }
  page.drawRectangle({ x:x0, y:topBlockY, width:leftW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`${snap.ph?.sulfat?.wert || '—'} mg/l SO4²-`,{ x:x0+4, y:topBlockY+3.2, size:10, font:fontB, color:K });

  const rx=x0+leftW+mm(6);
  drawTextSafe(page,'Gültig für erhärteten Beton / Suspension:',{ x:rx+4, y:topBlockY+mm(74), size:9, font:fontB, color:K });
  page.drawRectangle({ x:rx+4, y:topBlockY+mm(42), width:rightW-8, height:mm(26), borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,'Grenzwerte Expositionsklassen',{ x:rx+10, y:topBlockY+mm(62), size:8.5, font:fontB, color:K });
  drawTextSafe(page,'SO4²- [mg/l]  XA1: ≥200 ≤600   XA2: >600 ≤3000   XA3: >3000 ≤6000',{ x:rx+10, y:topBlockY+mm(52), size:7.2, font:fontR, color:K });
  drawTextSafe(page,'Gültig für Anmachwasser (ÖNORM EN 1008)',{ x:rx+4, y:topBlockY+mm(34), size:9, font:fontB, color:K });
  drawTextSafe(page,'Schwefelgehalt als SO4²- darf 2 000 mg/l nicht überschreiten.',{ x:rx+8, y:topBlockY+mm(24), size:7.2, font:fontR, color:K });

  const bottomY=y0+mm(16), blockH=mm(70), blockW=(W-mm(8))/2;

  page.drawRectangle({ x:x0, y:bottomY, width:blockW, height:blockH, borderColor:K, borderWidth:0.8 });
  page.drawRectangle({ x:x0, y:bottomY+blockH-mm(10), width:blockW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,'Temperatur Messung',{ x:x0+4, y:bottomY+blockH-mm(7), size:10, font:fontB, color:K });
  if(snap.ph?.temperatur?.photoDataUrl){
    try{
      const img=await embedDataUrlImage(pdf,snap.ph.temperatur.photoDataUrl);
      const areaX=x0+4, areaY=bottomY+mm(10), areaW=blockW-8, areaH=blockH-mm(24);
      const ratio=img.width/img.height;
      let dw=areaW, dh=dw/ratio;
      if(dh>areaH){ dh=areaH; dw=dh*ratio; }
      const dx=areaX+(areaW-dw)/2, dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
    }catch(err){ console.error(err); }
  }
  page.drawRectangle({ x:x0, y:bottomY, width:blockW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`${snap.ph?.temperatur?.wert || '—'} °C Wert`,{ x:x0+4, y:bottomY+3.2, size:10, font:fontB, color:K });

  const px=x0+blockW+mm(8);
  page.drawRectangle({ x:px, y:bottomY, width:blockW, height:blockH, borderColor:K, borderWidth:0.8 });
  page.drawRectangle({ x:px, y:bottomY+blockH-mm(10), width:blockW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,'pH Messung',{ x:px+4, y:bottomY+blockH-mm(7), size:10, font:fontB, color:K });
  if(snap.ph?.ph?.photoDataUrl){
    try{
      const img=await embedDataUrlImage(pdf,snap.ph.ph.photoDataUrl);
      const areaX=px+4, areaY=bottomY+mm(10), areaW=blockW-8, areaH=blockH-mm(24);
      const ratio=img.width/img.height;
      let dw=areaW, dh=dw/ratio;
      if(dh>areaH){ dh=areaH; dw=dh*ratio; }
      const dx=areaX+(areaW-dw)/2, dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{ x:dx, y:dy, width:dw, height:dh });
    }catch(err){ console.error(err); }
  }
  page.drawRectangle({ x:px, y:bottomY, width:blockW, height:mm(10), color:GREY, borderColor:K, borderWidth:0.8 });
  drawTextSafe(page,`${snap.ph?.ph?.wert || '—'} pH Wert`,{ x:px+4, y:bottomY+3.2, size:10, font:fontB, color:K });

  drawFooter(page,ctx,'Sulfatmessung Wasser');
}

/* ══════════════════════════════════════════════════════
   PDF EXPORTS
══════════════════════════════════════════════════════ */
async function exportPdf(snapshot=null,type='protokoll'){
  const snap=snapshot || collectSnapshot();
  if(!window.PDFLib){ alert('PDF-Library noch nicht geladen.'); return; }

  const versuche=(snap.versuche||[]).map(v=>hydrateVersuch(v));
  if(!versuche.length){ alert('Es ist noch keine Pumpstufe vorhanden.'); return; }

  const { PDFDocument }=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);

  if(type==='vollstaendig'){
    const hasOverview=!!snap.overviewPhotoDataUrl;
    const hasRestsand=!!(snap.restsand?.imhoff?.photoDataUrl || snap.restsand?.sieb?.photoDataUrl || snap.restsand?.imhoff?.menge || snap.restsand?.sieb?.menge || snap.restsand?.bemerkung);
    const hasPh=!!(snap.ph?.sulfat?.wert || snap.ph?.temperatur?.wert || snap.ph?.ph?.wert || snap.ph?.sulfat?.photoDataUrl || snap.ph?.temperatur?.photoDataUrl || snap.ph?.ph?.photoDataUrl);

    await drawCoverPage(pdf,ctx,snap);
    await drawTocPage(pdf,ctx,snap,hasOverview,hasRestsand,hasPh);

    for(let i=0;i<versuche.length;i++){
      await drawProtocolStagePage(pdf,ctx,snap,versuche[i],i);
      if(versuche[i].photoDataUrl){
        await drawImagePage(pdf,ctx,`Foto Durchflussmesser ${getStageTitle(i)}`,`${snap.meta?.objekt||''} · ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,versuche[i].photoDataUrl);
      }
    }

    if(hasOverview){
      const title=`Übersicht Pumpversuch ${snap.meta?.objekt || ''} ${snap.meta?.ort ? snap.meta.ort+' ' : ''}am ${dateDE(snap.meta?.geprueftAm)||todayDE()}`.replace(/\s+/g,' ').trim();
      await drawImagePage(pdf,ctx,title,'Übersichtsfoto',snap.overviewPhotoDataUrl);
    }

    if(hasRestsand) await drawRestsandPage(pdf,ctx,snap);
    if(hasPh) await drawPhPage(pdf,ctx,snap);
  }else{
    for(let i=0;i<versuche.length;i++){
      await drawProtocolStagePage(pdf,ctx,snap,versuche[i],i);
    }
  }

  const bytes=await pdf.save();
  const blob=new Blob([bytes],{ type:'application/pdf' });
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Pumpversuch').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const suffix=type==='vollstaendig' ? 'Vollauswertung' : 'Protokoll';
  const fileName=`${dateTag()}_HTB_Pumpversuch_${suffix}_${obj||'Dokument'}.pdf`;

  const w=window.open(url,'_blank');
  if(!w){
    const a=document.createElement('a');
    a.href=url;
    a.download=fileName;
    a.click();
  }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function exportRestsandPdf(snapshot=null){
  const snap=snapshot || collectSnapshot();
  if(!window.PDFLib){ alert('PDF-Library noch nicht geladen.'); return; }
  const { PDFDocument }=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  await drawRestsandPage(pdf,ctx,snap);
  const bytes=await pdf.save();
  const blob=new Blob([bytes],{ type:'application/pdf' });
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Restsand').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const fileName=`${dateTag()}_HTB_Restsandprotokoll_${obj||'Dokument'}.pdf`;
  const w=window.open(url,'_blank');
  if(!w){ const a=document.createElement('a'); a.href=url; a.download=fileName; a.click(); }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function exportPhPdf(snapshot=null){
  const snap=snapshot || collectSnapshot();
  if(!window.PDFLib){ alert('PDF-Library noch nicht geladen.'); return; }
  const { PDFDocument }=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  await drawPhPage(pdf,ctx,snap);
  const bytes=await pdf.save();
  const blob=new Blob([bytes],{ type:'application/pdf' });
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Sulfatmessung').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const fileName=`${dateTag()}_HTB_Sulfatprotokoll_${obj||'Dokument'}.pdf`;
  const w=window.open(url,'_blank');
  if(!w){ const a=document.createElement('a'); a.href=url; a.download=fileName; a.click(); }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

/* ══════════════════════════════════════════════════════
   RESET / INSTALL
══════════════════════════════════════════════════════ */
function resetAll(){
  if(!confirm('Alle Eingaben wirklich zurücksetzen?')) return;
  Object.keys(timerMap).forEach(hardStopTimer);
  const base=getInitialState();

  state.meta=clone(base.meta);
  state.selection=clone(base.selection);
  state.foerder=clone(base.foerder);
  state.schluck=clone(base.schluck);
  state.overviewPhotoDataUrl='';
  state.versuche=[];
  state.restsand=clone(base.restsand);
  state.ph=clone(base.ph);
  state.settings=clone(base.settings);

  syncMetaToUi();
  syncBrunnenToUi();
  syncSelectionToUi();
  renderOverviewPhotoThumb();
  syncRestsandToUi();
  syncPhToUi();
  syncSettingsToUi();
  renderVersuche();
  renderLiveTab();
  saveDraftDebounced();
}
function initInstallButton(){
  let installPrompt=null;
  const btn=$('btnInstall');

  window.addEventListener('beforeinstallprompt',(e)=>{
    e.preventDefault();
    installPrompt=e;
    if(btn) btn.hidden=false;
  });

  btn?.addEventListener('click',async()=>{
    if(!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt=null;
    btn.hidden=true;
  });

  window.addEventListener('appinstalled',()=>{
    installPrompt=null;
    if(btn) btn.hidden=true;
  });
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded',()=>{
  installAudioUnlock();
  initTabs();
  hookStaticInputs();
  hookVersuchDelegation();
  hookHistoryDelegation();
  hookGlobalPhotoDelegation();
  initTimeAdjustModal();
  initFloatingTimer();
  initOcrHandlers();

  loadDraft();

  syncMetaToUi();
  syncBrunnenToUi();
  syncSelectionToUi();
  renderOverviewPhotoThumb();
  syncRestsandToUi();
  syncPhToUi();
  syncSettingsToUi();
  renderVersuche();
  renderLiveTab();
  renderHistoryList();
  initInstallButton();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register(`${BASE}sw.js?v=55`).catch(err=>console.error('SW:',err));
  }
});
