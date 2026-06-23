'use strict';
console.log('HTB Pumpversuch app.js v86 loaded');

const BASE='/Pumpversuch/';
const STORAGE_DRAFT='htb-pumpversuch-draft-v18';
const STORAGE_HISTORY='htb-pumpversuch-history-v18';
const HISTORY_MAX=30;
const DEFAULT_INTERVALLE=[0,1,2,3,4,5,15,30,45,60,75,90,105,120,135,150,165,180];
const IDB_NAME='htb-pumpversuch-db-v1';
const IDB_VERSION=1;
const IDB_STORE_HISTORY='history';
const IDB_STORE_PHOTOS='historyPhotos';
const STORAGE_HISTORY_MIGRATED='htb-pumpversuch-history-migrated-v1';
const PHOTO_STORED='__stored__';
const FIRMA = {
  name:'HTB Baugesellschaft m.b.H.',
  slogan:'BAUEN MIT SPEZIALISTEN ALS PARTNER'
};

const FILIALEN = {
  Arzl: {
    adresse:'A-6471 Arzl im Pitztal, Gewerbepark Pitztal 16',
    tel:'Tel. +43(0)5412/63975',
    email:'office.arzl@htb-bau.at',
    web:'www.htb-bau.at'
  },
  'Nüziders': {
    adresse:'A-6714 Nüziders, Landstraße 19',
    tel:'Tel. +43 5552 / 34 739',
    email:'office.nueziders@htb-bau.at',
    web:'www.htb-bau.at'
  },
  Zirl: {
    adresse:'A-6170 Zirl, Neuraut 1',
    tel:'Tel. +43 5238 / 58 873 1',
    email:'office.ibk@htb-bau.at',
    web:'www.htb-bau.at'
  },
  Schwoich: {
    adresse:'A-6334 Schwoich, Kufsteiner Wald 28',
    tel:'Tel. +43 5372 / 63 600',
    email:'office.schwoich@htb-bau.at',
    web:'www.htb-bau.at'
  },
  Fusch: {
    adresse:'A-5672 Fusch an der Großglocknerstraße, Achenstraße 2',
    tel:'Tel. +43 6546 / 40 116',
    email:'office.fusch@htb-bau.at',
    web:'www.htb-bau.at'
  },
  Wels: {
    adresse:'A-4600 Wels, Hans-Sachs-Straße 103',
    tel:'Tel. +43 7242 / 601 600',
    email:'office.wels@htb-bau.at',
    web:'www.htb-bau.at'
  },
  Klagenfurt: {
    adresse:'A-9020 Klagenfurt, Josef-Sablatnig-Straße 251',
    tel:'Tel. +43 463 / 33 533 700',
    email:'office.klagenfurt@htb-bau.at',
    web:'www.htb-bau.at'
  }
};

function getFilialeData(filiale){
  return FILIALEN[filiale] || FILIALEN.Arzl;
}

const $=id=>document.getElementById(id);

/* ── STATE ── */
function getInitialState(){
return{
meta:{filiale:'',objekt:'',grundstueck:'',ort:'',geologie:'',auftragsnummer:'',auftraggeber:'',bauleitung:'',bohrmeister:'',koordination:'',geprueftDurch:'',geprueftAm:''},
selection:{foerder:true,schluck:false},
foerder:{dm:'',endteufe:'',ruhe:''},
schluck:{dm:'',endteufe:'',ruhe:''},
overviewPhotoDataUrl:'',
versuche:[],
restsand:{imhoff:{photoDataUrl:'',menge:''},sieb:{photoDataUrl:'',menge:''},bemerkung:''},
ph:{datum:'',bauherr:'',baustelle:'',gewaessername:'',sulfat:{wert:'',photoDataUrl:''},temperatur:{wert:'',photoDataUrl:''},leitfaehigkeit:{wert:'',photoDataUrl:''},ph:{wert:'',photoDataUrl:''},combined:{aktiv:false,ph:'',lf:'',temp:'',o2:'',photoDataUrl:''}},
kolben:{
  durchmesser:'',
  entnahme:'',
  nummer:'',
  brunnenOk:'',
  rows:[
    {huebe:'',aufsandung:'',anmerkungen:''}
  ],
  restsandmessung:''
},
settings:{alarmDurationSec:4,pdfExportType:'protokoll',alarmSoundEnabled:true,theme:'dark'}
};
}
const state=getInitialState();
const timerMap={};
let _saveT=null,_liveT=null,_audioCtx=null,_alarmGain=null,_timeAdjustVid=null,_floatingRaf=null,_alarmReady=false;

/* ── HELPERS ── */
// FIX: war crypto?.randomUUID?..(){ — doppelter Punkt war Syntaxfehler
const uid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return 'id_' + Date.now() + '_' + Math.random().toString(16).slice(2);
  }
};
const clone=v=>JSON.parse(JSON.stringify(v));
function h(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function pdfSafe(v){return String(v??'').replace(/[–—]/g,'-').replace(/[•→]/g,'-').replace(/[\u0000-\u001F\u007F]/g,'');}
function fmtComma(v,d=3){const n=Number(v);return Number.isFinite(n)?n.toFixed(d).replace('.',','):'—';}
function fmtMaybe(v,d=3){const n=Number(v);return Number.isFinite(n)?n.toFixed(d).replace('.',','):'—';}
function fmtSci(v,d=2){const n=Number(v);if(!Number.isFinite(n)||n<=0)return'—';const[m,e]=n.toExponential(d).split('e');return`${m.replace('.',',')}e${Number(e)}`;}
function fmtKf(v){const n=Number(v);if(!Number.isFinite(n)||n<=0)return'—';return n>=0.001?`${fmtComma(n,6)} m/s`:`${fmtSci(n,2)} m/s`;}
function dateTag(d=new Date()){return`${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getFullYear())}`;}
function dateDE(iso){const s=String(iso||'').trim();if(!s)return'';const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}.${m[2]}.${m[1]}`:s;}
function todayIso(){return new Date().toISOString().slice(0,10);}
function todayDE(){return dateDE(todayIso());}
function formatTimeHHMMSS(d=new Date()){return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
function formatElapsed(ms){const t=Math.max(0,Math.floor(ms/1000)),hh=Math.floor(t/3600),mm=Math.floor((t%3600)/60),ss=t%60;return hh>0?`${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;}
function parseIntervalStr(str){return[...new Set(String(str||'').split(',').map(s=>Number(String(s).trim())).filter(n=>Number.isFinite(n)&&n>=0))].sort((a,b)=>a-b);}
function lsToM3h(v){const n=Number(v);return Number.isFinite(n)?(n*3.6).toFixed(3):'';}
function clamp(n,lo,hi){return Math.max(lo,Math.min(hi,n));}
function getVersuchById(id){return state.versuche.find(v=>v.id===id);}
function getStageTitle(idx){return`Stufe ${idx+1}`;}
function getSelectedWells(){return{foerder:!!state.selection.foerder,schluck:!!state.selection.schluck};}
function getWellLabel(key){return key==='foerder'?'Förderbrunnen':'Rückgabebrunnen';}
function syncIntervalleStrFromRows(v){v.intervalleStr=(v.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b).join(', ');}
function sortMessungen(v){v.messungen.sort((a,b)=>{const av=Number(a.min),bv=Number(b.min),af=Number.isFinite(av),bf=Number.isFinite(bv);if(af&&bf)return av-bv;if(af)return -1;if(bf)return 1;return 0;});syncIntervalleStrFromRows(v);}
function getContinueStep(v){const rows=(v.messungen||[]).slice().sort((a,b)=>Number(a.min)-Number(b.min));if(rows.length>=2){const step=Number(rows[rows.length-1].min)-Number(rows[rows.length-2].min);if(Number.isFinite(step)&&step>0)return step;}return 15;}
function getRowsForExport(v){return clone(v.messungen||[]).sort((a,b)=>{const av=Number(a.min),bv=Number(b.min);if(Number.isFinite(av)&&Number.isFinite(bv))return av-bv;return Number.isFinite(av)?-1:1;});}
function scheduleLiveRender(){clearTimeout(_liveT);_liveT=setTimeout(()=>renderLiveTab(),90);}
const camSvg=(w=18,ht=15)=>`<svg viewBox="0 0 24 20" width="${w}" height="${ht}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1" y="4" width="22" height="15" rx="2" stroke="white" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="white" stroke-width="1.8"/><path d="M8.5 4 L10.2 1.5 L13.8 1.5 L15.5 4" stroke="white" stroke-width="1.8" fill="none" stroke-linejoin="round"/><rect x="18.5" y="6" width="2.5" height="1.8" rx="0.9" fill="white"/></svg>`;

/* ── RATE / Kf ── */
function getManualRateM3hNumber(v){const n=Number(v?.manualRateM3h);return Number.isFinite(n)?n:NaN;}
function getEffectiveRateM3h(v){const n=getManualRateM3hNumber(v);return Number.isFinite(n)?n.toFixed(3):'';}
function getEffectiveRateLs(v){const n=getManualRateM3hNumber(v);return Number.isFinite(n)?(n/3.6).toFixed(3):'';}
function getAverageFoerderMengeNumber(v){const vals=(v.messungen||[]).filter(m=>String(m.foerder_menge??'').trim()!==''&&Number.isFinite(Number(m.foerder_menge))).map(m=>Number(m.foerder_menge));return vals.length?vals.reduce((s,n)=>s+n,0)/vals.length:NaN;}
function getAverageFoerderMenge(v){const a=getAverageFoerderMengeNumber(v);return Number.isFinite(a)?a.toFixed(3):'';}
function getCalcRateM3hNumber(v){const m=getManualRateM3hNumber(v);if(Number.isFinite(m)&&m>0)return m;const a=getAverageFoerderMengeNumber(v);if(Number.isFinite(a)&&a>0)return a;return NaN;}
function getCalcRateM3h(v){const n=getCalcRateM3hNumber(v);return Number.isFinite(n)?n.toFixed(3):'';}
function getCalcRateLs(v){const n=getCalcRateM3hNumber(v);return Number.isFinite(n)?(n/3.6).toFixed(3):'';}
function getCalcRateSource(v){const m=getManualRateM3hNumber(v);if(Number.isFinite(m)&&m>0)return'manuelle Förderrate';const a=getAverageFoerderMengeNumber(v);if(Number.isFinite(a)&&a>0)return'Ø Fördermenge';return'';}
function getProcessHeadChangeM(raw,ruhe,key){const m=Number(raw),r=Number(ruhe);if(!Number.isFinite(m)||!Number.isFinite(r)||String(raw??'').trim()==='')return NaN;return key==='foerder'?(m-r):(r-m);}
function getDisplacementCm(raw,ruhe){const d=getProcessHeadChangeM(raw,ruhe,'foerder');return Number.isFinite(d)?Math.abs(d*100):NaN;}

function estimateRowKfDupuit({qM3h,dmMm,endteufe,ruhe,dyn,key}){
  const Q=Number(qM3h)/3600,rw=Number(dmMm)/2000,ET=Number(endteufe),RWS=Number(ruhe),dynL=Number(dyn);
  if(![Q,rw,ET,RWS,dynL].every(Number.isFinite)||Q<=0||rw<=0||ET<=0)return NaN;
  const H0=ET-RWS,Hd=ET-dynL,s=key==='foerder'?(dynL-RWS):(RWS-dynL);
  if(!Number.isFinite(H0)||!Number.isFinite(Hd)||!Number.isFinite(s)||H0<=0||Hd<=0||s<=0)return NaN;
  const denom=key==='foerder'?(H0*H0-Hd*Hd):(Hd*Hd-H0*H0);
  if(!(denom>0))return NaN;
  let k=1e-4;
  for(let i=0;i<30;i++){
    const R=Math.max(rw*20,3000*s*Math.sqrt(Math.max(k,1e-12)));
    const ln=Math.log(R/rw);
    if(!(ln>0))return NaN;
    const kNew=(Q*ln)/(Math.PI*denom);
    if(!Number.isFinite(kNew)||kNew<=0)return NaN;
    if(Math.abs(kNew-k)/k<1e-6){k=kNew;break;}
    k=kNew;
  }
  return Number.isFinite(k)&&k>0?k:NaN;
}

function getStageKfEstimate(versuch,key,brunnen){
  const rateM3h=getCalcRateM3hNumber(versuch);
  if(!Number.isFinite(rateM3h)||rateM3h<=0)return{kf:NaN,reason:'Keine Förderrate'};
  const rows=getRowsForExport(versuch).map(row=>{
    const min=Number(row.min),raw=row[key==='foerder'?'foerder_m':'schluck_m'];
    const kf=estimateRowKfDupuit({qM3h:rateM3h,dmMm:brunnen?.dm,endteufe:brunnen?.endteufe,ruhe:brunnen?.ruhe,dyn:raw,key});
    const s=getProcessHeadChangeM(raw,brunnen?.ruhe,key);
    if(!Number.isFinite(kf)||!Number.isFinite(min)||!Number.isFinite(s)||s<=0)return null;
    return{min,kf,s};
  }).filter(Boolean).sort((a,b)=>a.min-b.min);
  if(!rows.length)return{kf:NaN,reason:'Noch keine auswertbaren Messpunkte'};
  const tail=rows.length>=4?rows.slice(Math.floor(rows.length/2)):rows;
  const weights=tail.map(p=>Math.max(1,p.min||1));
  const sumW=weights.reduce((a,b)=>a+b,0);
  const logMean=Math.exp(tail.reduce((sum,it,i)=>sum+Math.log(it.kf)*weights[i],0)/sumW);
  const spread=Math.max(...tail.map(x=>x.kf))/Math.min(...tail.map(x=>x.kf));
  let quality='gering';
  if(tail.length>=4&&spread<=3)quality='gut';
  else if(tail.length>=3&&spread<=10)quality='mittel';
  return{kf:logMean,quality,used:tail.length,total:rows.length,rateM3h,rateSource:getCalcRateSource(versuch)};
}

function getWellChartPoints(versuch,key,brunnen){
  const ruhe=Number(brunnen?.ruhe);
  return getRowsForExport(versuch)
    .map(row=>({x:Number(row.min),y:getDisplacementCm(row[key==='foerder'?'foerder_m':'schluck_m'],ruhe)}))
    .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
    .sort((a,b)=>a.x-b.x);
}

function niceNum(r,round){if(!Number.isFinite(r)||r<=0)return 1;const exp=Math.floor(Math.log10(r)),f=r/Math.pow(10,exp);let nf;if(round){if(f<1.5)nf=1;else if(f<3)nf=2;else if(f<7)nf=5;else nf=10;}else{if(f<=1)nf=1;else if(f<=2)nf=2;else if(f<=5)nf=5;else nf=10;}return nf*Math.pow(10,exp);}
function getNiceAxis(lo,hi,ticks=6){let min=Number.isFinite(lo)?lo:0,max=Number.isFinite(hi)?hi:1;if(min===max){if(min===0)max=1;else{min=Math.min(0,min);max=max*1.1;}}const r=niceNum(max-min,false),step=niceNum(r/Math.max(2,ticks-1),true);return{min:Math.floor(min/step)*step,max:Math.ceil(max/step)*step,step};}
function buildTicks(ax){const t=[];for(let v=ax.min;v<=ax.max+ax.step/2;v+=ax.step)t.push(Number(v.toFixed(10)));return t;}
function fmtTick(v,d=0){return Number.isFinite(v)?String(Number(v.toFixed(d))).replace('.',','):'—';}

/* ── DEFAULTS ── */
function defaultMessung(min){return{min,foerder_m:'',schluck_m:'',foerder_menge:''};}
function defaultVersuch(){const ints=[...DEFAULT_INTERVALLE];return{id:uid(),manualRateM3h:'',startzeit:'',elapsedMs:0,intervalleStr:ints.join(', '),messungen:ints.map(defaultMessung),photoDataUrl:''};}
function hydrateVersuch(v){
  const base=defaultVersuch();
  const ints=v?.intervalleStr?parseIntervalStr(v.intervalleStr):[...DEFAULT_INTERVALLE];
  const existing=Array.isArray(v?.messungen)?v.messungen:[];
  return{...base,...v,elapsedMs:Number(v?.elapsedMs||0),intervalleStr:ints.join(', '),photoDataUrl:typeof v?.photoDataUrl==='string'?v.photoDataUrl:'',
    messungen:ints.map(min=>{const hit=existing.find(m=>Number(m.min)===Number(min));return hit?{min,foerder_m:hit.foerder_m??'',schluck_m:hit.schluck_m??'',foerder_menge:hit.foerder_menge??''}:defaultMessung(min);})};
}

/* ── FIELD MAPS ── */
const META_FIELDS=[
  ['meta-filiale','filiale'],
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
const BRUNNEN_FIELDS=[['foerder-dm','foerder','dm'],['foerder-endteufe','foerder','endteufe'],['foerder-ruhe','foerder','ruhe'],['schluck-dm','schluck','dm'],['schluck-endteufe','schluck','endteufe'],['schluck-ruhe','schluck','ruhe']];

/* ── SYNC UI ── */
function syncMetaToUi(){META_FIELDS.forEach(([id,key])=>{const el=$(id);if(el)el.value=state.meta[key]||'';});}
function collectMetaFromUi(){META_FIELDS.forEach(([id,key])=>{const el=$(id);if(el)state.meta[key]=el.value||'';});}
function syncBrunnenToUi(){BRUNNEN_FIELDS.forEach(([id,g,k])=>{const el=$(id);if(el)el.value=state[g][k]||'';});}
function collectBrunnenFromUi(){BRUNNEN_FIELDS.forEach(([id,g,k])=>{const el=$(id);if(el)state[g][k]=el.value||'';});}
function updateBrunnenVisibility(){if($('box-foerder'))$('box-foerder').hidden=!state.selection.foerder;if($('box-schluck'))$('box-schluck').hidden=!state.selection.schluck;}
function syncSelectionToUi(){if($('sel-foerder'))$('sel-foerder').checked=!!state.selection.foerder;if($('sel-schluck'))$('sel-schluck').checked=!!state.selection.schluck;updateBrunnenVisibility();}
function collectSelectionFromUi(){
  const f=!!$('sel-foerder')?.checked,s=!!$('sel-schluck')?.checked;
  if(!f&&!s){state.selection.foerder=true;state.selection.schluck=false;syncSelectionToUi();alert('Mindestens ein Brunnen muss ausgewählt sein.');return false;}
  state.selection.foerder=f;state.selection.schluck=s;updateBrunnenVisibility();return true;
}
function updateMainPdfButtonLabel(){const btn=$('btnPdf');if(btn)btn.textContent=state.settings.pdfExportType==='vollstaendig'?'PDF Vollständig':'PDF Protokoll';}
function applyTheme(theme){
const nextTheme=theme==='light'?'light':'dark';

if(!state.settings) state.settings={};
state.settings.theme=nextTheme;

document.body.classList.toggle('theme-light',nextTheme==='light');
document.body.classList.toggle('theme-dark',nextTheme==='dark');

const bg=nextTheme==='light'?'#f3f4f6':'#0d2f4f';
document.documentElement.style.background=bg;
document.body.style.background=bg;

const themeMeta=document.querySelector('meta[name="theme-color"]');
if(themeMeta) themeMeta.setAttribute('content',bg);

const brandLogo=$('brandLogo');
if(brandLogo){
const darkSrc=brandLogo.dataset.darkSrc||`${BASE}logo.svg?v=86`;
const lightSrc=brandLogo.dataset.lightSrc||`${BASE}logo_hell.svg?v=86`;
const nextSrc=nextTheme==='light'?lightSrc:darkSrc;
if(brandLogo.getAttribute('src')!==nextSrc){
brandLogo.setAttribute('src',nextSrc);
}
}
}
function syncSettingsToUi(){
if($('settings-alarmDuration')) $('settings-alarmDuration').value = state.settings.alarmDurationSec ?? 4;

const a = $('pdfType-protokoll');
const b = $('pdfType-vollstaendig');
if(a) a.checked = state.settings.pdfExportType !== 'vollstaendig';
if(b) b.checked = state.settings.pdfExportType === 'vollstaendig';

const themeDark = $('theme-dark');
const themeLight = $('theme-light');
if(themeDark) themeDark.checked = (state.settings.theme || 'dark') !== 'light';
if(themeLight) themeLight.checked = (state.settings.theme || 'dark') === 'light';

updateMainPdfButtonLabel();
updateAlarmSoundButton();
applyTheme(state.settings.theme || 'dark');
}
function collectSettingsFromUi(){
state.settings.alarmDurationSec=clamp(Number($('settings-alarmDuration')?.value||4),1,30);
state.settings.pdfExportType=$('pdfType-vollstaendig')?.checked?'vollstaendig':'protokoll';
state.settings.theme=$('theme-light')?.checked?'light':'dark';
updateMainPdfButtonLabel();
applyTheme(state.settings.theme);
}
function updateAlarmSoundButton(){
  const btn = $('btnAlarmSoundToggle');
  const status = $('alarmSoundStatus');
  if(!btn) return;

  const enabledPref = state.settings.alarmSoundEnabled !== false;
  const active = enabledPref && _alarmReady;

  btn.textContent = active ? 'Ton ausschalten' : 'Ton einschalten';
  btn.classList.toggle('btn--save', active);
  btn.classList.toggle('btn--ghost', !active);

  if(status){
    if(active){
      status.textContent = 'Alarmton ist aktiv.';
    }else if(enabledPref){
      status.textContent = 'Für iPhone: einmal hier oder vor dem Start direkt antippen, damit der Ton sicher freigegeben wird.';
    }else{
      status.textContent = 'Alarmton ist ausgeschaltet.';
    }
  }
}
function ensureRequiredFiliale(){
  collectMetaFromUi();
  const filiale = String(state.meta.filiale || '').trim();

  if(FILIALEN[filiale]) return true;

  document.querySelector('.tab[data-tab="protokoll"]')?.click();
  alert('Bitte bei den Stammdaten eine Filiale auswählen.');
  $('meta-filiale')?.focus();
  return false;
}
function renderOverviewPhotoThumb(){
  const box=$('overviewPhotoThumb');if(!box)return;
  if(!state.overviewPhotoDataUrl){box.hidden=true;box.innerHTML='';return;}
  box.hidden=false;
  box.innerHTML=`<img src="${h(state.overviewPhotoDataUrl)}" alt="Übersichtsfoto"><button class="overview-del-btn" data-photo-del="overview" type="button">Foto entfernen</button>`;
}
function renderRestsandPhotoAreas(){
  [{key:'imhoff',area:'imhoffPhotoArea',inputId:'imhoffPhotoInput'},{key:'sieb',area:'siebPhotoArea',inputId:'siebPhotoInput'}].forEach(def=>{
    const area=$(def.area);if(!area)return;
    const has=!!state.restsand[def.key].photoDataUrl;
    area.innerHTML=`<button class="restsand-photo-btn" data-rs-photo="${def.key}" type="button">${camSvg(26,22)} ${has?'Foto ändern':'Foto aufnehmen'}</button>
      <input type="file" accept="image/*" capture="environment" id="${def.inputId}" data-rs-input="${def.key}" style="display:none">
      ${has?`<img class="restsand-thumb" src="${h(state.restsand[def.key].photoDataUrl)}" alt="${def.key}"><button class="restsand-del-btn" data-photo-del="restsand-${def.key}" type="button">Entfernen</button>`:''}`;
  });
}
function renderPhPhotoAreas(){
  [{key:'sulfat',area:'sulfatPhotoArea',inputId:'sulfatPhotoInput',label:'Foto Teststäbchen'},
    {key:'temperatur',area:'tempPhotoArea',inputId:'tempPhotoInput',label:'Foto Thermometer'},
    {key:'leitfaehigkeit',area:'leitPhotoArea',inputId:'leitPhotoInput',label:'Foto Leitfähigkeitsmessgerät'},
    {key:'ph',area:'phPhotoArea',inputId:'phPhotoInput',label:'Foto pH-Meter'},
    {key:'combined',area:'kombiPhotoArea',inputId:'kombiPhotoInput',label:'Foto Kombigerät'}
  ].forEach(def=>{
    const area=$(def.area);if(!area)return;
    let data;
    if(def.key==='ph') data=state.ph.ph.photoDataUrl;
    else if(def.key==='combined') data=state.ph.combined?.photoDataUrl;
    else data=state.ph[def.key].photoDataUrl;
    const has=!!data;
    area.innerHTML=`<button class="restsand-photo-btn" data-ph-photo="${def.key}" type="button">${camSvg(22,18)} ${has?'Foto ändern':def.label}</button>
<input type="file" accept="image/*" capture="environment" id="${def.inputId}" data-ph-input="${def.key}" style="display:none">
${has?`<img class="ph-thumb" src="${h(data)}" alt="${def.key}"><button class="restsand-del-btn" data-photo-del="ph-${def.key}" type="button">Entfernen</button>`:''}`;
  });
}
function togglePhModeDisplay(){
  state.ph.combined = state.ph.combined || {};

  // Wichtig:
  // Wenn die Radio-Buttons im DOM existieren, ist der DOM-Zustand führend.
  // Dadurch ist die Anzeige nicht mehr um einen Klick versetzt.
  const domKombi = $('ph-mode-kombi');
  const isKombi = domKombi ? !!domKombi.checked : !!state.ph.combined.aktiv;

  state.ph.combined.aktiv = isKombi;

  const cardTemp = $('ph-card-temp');
  const cardLeit = $('ph-card-leit');
  const cardPh = $('ph-card-ph');
  const cardKombi = $('ph-card-kombi');

  if(isKombi){
    if(cardTemp) cardTemp.style.display = 'none';
    if(cardLeit) cardLeit.style.display = 'none';
    if(cardPh) cardPh.style.display = 'none';
    if(cardKombi) cardKombi.style.display = 'block';
  }else{
    if(cardTemp) cardTemp.style.display = 'block';
    if(cardLeit) cardLeit.style.display = 'block';
    if(cardPh) cardPh.style.display = 'block';
    if(cardKombi) cardKombi.style.display = 'none';
  }
}
function syncRestsandToUi(){if($('restsand-imhoff-menge'))$('restsand-imhoff-menge').value=state.restsand.imhoff.menge||'';if($('restsand-sieb-menge'))$('restsand-sieb-menge').value=state.restsand.sieb.menge||'';if($('restsand-bemerkung'))$('restsand-bemerkung').value=state.restsand.bemerkung||'';renderRestsandPhotoAreas();}
function collectRestsandFromUi(){state.restsand.imhoff.menge=$('restsand-imhoff-menge')?.value||'';state.restsand.sieb.menge=$('restsand-sieb-menge')?.value||'';state.restsand.bemerkung=$('restsand-bemerkung')?.value||'';}
function syncPhToUi(){
  if($('ph-datum'))$('ph-datum').value=state.ph.datum||'';
  if($('ph-bauherr'))$('ph-bauherr').value=state.ph.bauherr||'';
  if($('ph-baustelle'))$('ph-baustelle').value=state.ph.baustelle||'';
  if($('ph-gewaessername'))$('ph-gewaessername').value=state.ph.gewaessername||'';
  if($('ph-sulfat-wert'))$('ph-sulfat-wert').value=state.ph.sulfat.wert||'';
  if($('ph-temp-wert'))$('ph-temp-wert').value=state.ph.temperatur.wert||'';
  if($('ph-leitfaehigkeit-wert'))$('ph-leitfaehigkeit-wert').value=state.ph.leitfaehigkeit.wert||'';
  if($('ph-ph-wert'))$('ph-ph-wert').value=state.ph.ph.wert||'';

  if($('ph-combined-ph'))$('ph-combined-ph').value=state.ph.combined?.ph||'';
  if($('ph-combined-lf'))$('ph-combined-lf').value=state.ph.combined?.lf||'';
  if($('ph-combined-temp'))$('ph-combined-temp').value=state.ph.combined?.temp||'';
  if($('ph-combined-o2'))$('ph-combined-o2').value=state.ph.combined?.o2||'';

  const isKombi=!!state.ph.combined?.aktiv;
  if($('ph-mode-kombi'))$('ph-mode-kombi').checked=isKombi;
  if($('ph-mode-einzel'))$('ph-mode-einzel').checked=!isKombi;
  togglePhModeDisplay();

  renderPhPhotoAreas();
}
function collectPhFromUi(){
  state.ph.datum=$('ph-datum')?.value||'';
  state.ph.bauherr=$('ph-bauherr')?.value||'';
  state.ph.baustelle=$('ph-baustelle')?.value||'';
  state.ph.gewaessername=$('ph-gewaessername')?.value||'';
  state.ph.sulfat.wert=$('ph-sulfat-wert')?.value||'';
  state.ph.temperatur.wert=$('ph-temp-wert')?.value||'';
  state.ph.leitfaehigkeit.wert=$('ph-leitfaehigkeit-wert')?.value||'';
  state.ph.ph.wert=$('ph-ph-wert')?.value||'';

  state.ph.combined=state.ph.combined||{};
  state.ph.combined.aktiv=$('ph-mode-kombi')?.checked||false;
  state.ph.combined.ph=$('ph-combined-ph')?.value||'';
  state.ph.combined.lf=$('ph-combined-lf')?.value||'';
  state.ph.combined.temp=$('ph-combined-temp')?.value||'';
  state.ph.combined.o2=$('ph-combined-o2')?.value||'';
}

function renderKolbenRows(){
  const host = $('kolbenRowsContainer');
  if(!host) return;

  if(!Array.isArray(state.kolben.rows) || !state.kolben.rows.length){
    state.kolben.rows = [{huebe:'',aufsandung:'',anmerkungen:''}];
  }

  host.innerHTML = state.kolben.rows.map((row, i) => `
    <div class="kolben-row" data-kolben-row="${i}">
      <label class="field">
        <span class="field__label" style="display:none;">Anzahl Kolbenhübe</span>
        <input
          id="kolben-huebe-${i}"
          class="field__input"
          type="number"
          step="1"
          inputmode="numeric"
          placeholder="z.B. 15"
          value="${h(row.huebe || '')}"
        />
      </label>

      <label class="field">
        <span class="field__label" style="display:none;">Aufsandung [cm]</span>
        <input
          id="kolben-aufsandung-${i}"
          class="field__input"
          type="number"
          step="0.1"
          inputmode="decimal"
          placeholder="z.B. 3.5"
          value="${h(row.aufsandung || '')}"
        />
      </label>

      <label class="field">
        <span class="field__label" style="display:none;">Anmerkungen</span>
        <input
          id="kolben-anmerkungen-${i}"
          class="field__input"
          type="text"
          placeholder="Anmerkung"
          value="${h(row.anmerkungen || '')}"
        />
      </label>
    </div>
  `).join('');
}

function syncKolbenToUi(){
  if(!state.kolben){
    state.kolben = clone(getInitialState().kolben);
  }

  if(!Array.isArray(state.kolben.rows) || !state.kolben.rows.length){
    state.kolben.rows = [{huebe:'',aufsandung:'',anmerkungen:''}];
  }

  if($('kolben-ausbaudurchmesser')) $('kolben-ausbaudurchmesser').value = state.kolben.durchmesser || '';
  if($('kolben-entnahme')) $('kolben-entnahme').value = state.kolben.entnahme || '';
  if($('kolben-nummer')) $('kolben-nummer').value = state.kolben.nummer || '';
  if($('kolben-brunnenOk')) $('kolben-brunnenOk').value = state.kolben.brunnenOk || '';
  if($('kolben-restsandmessung')) $('kolben-restsandmessung').value = state.kolben.restsandmessung || '';

  renderKolbenRows();
}

function collectKolbenFromUi(){
  state.kolben.durchmesser = $('kolben-ausbaudurchmesser')?.value || '';
  state.kolben.entnahme = $('kolben-entnahme')?.value || '';
  state.kolben.nummer = $('kolben-nummer')?.value || '';
  state.kolben.brunnenOk = $('kolben-brunnenOk')?.value || '';
  state.kolben.restsandmessung = $('kolben-restsandmessung')?.value || '';

  const host = $('kolbenRowsContainer');
  if(host){
    const rows = [...host.querySelectorAll('[data-kolben-row]')].map((rowEl, i) => ({
      huebe: $(`kolben-huebe-${i}`)?.value || '',
      aufsandung: $(`kolben-aufsandung-${i}`)?.value || '',
      anmerkungen: $(`kolben-anmerkungen-${i}`)?.value || ''
    }));

    state.kolben.rows = rows.length
      ? rows
      : [{huebe:'',aufsandung:'',anmerkungen:''}];
  }
}
function addKolbenRow(){
  if(!state.kolben){
    state.kolben = clone(getInitialState().kolben);
  }

  collectKolbenFromUi();

  if(!Array.isArray(state.kolben.rows)){
    state.kolben.rows = [];
  }

  state.kolben.rows.push({
    huebe:'',
    aufsandung:'',
    anmerkungen:''
  });

  renderKolbenRows();
  saveDraftDebounced();

  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('#kolbenRowsContainer [data-kolben-row]');
    const lastRow = rows[rows.length - 1];

    lastRow?.scrollIntoView({
      behavior:'smooth',
      block:'center'
    });

    lastRow?.querySelector('input')?.focus();
  });
}
/* ── SNAPSHOT / STORAGE ── */
function collectSnapshot(){
  collectMetaFromUi();collectBrunnenFromUi();collectSelectionFromUi();collectRestsandFromUi();collectPhFromUi();collectKolbenFromUi();collectSettingsFromUi();
  return{v:18,meta:clone(state.meta),selection:clone(state.selection),foerder:clone(state.foerder),schluck:clone(state.schluck),overviewPhotoDataUrl:state.overviewPhotoDataUrl||'',versuche:clone(state.versuche),restsand:clone(state.restsand),ph:clone(state.ph),kolben:clone(state.kolben),settings:clone(state.settings)};
}
function applySnapshot(snap,render=true){
  const base=getInitialState();snap=snap||{};
  state.meta={...base.meta,...(snap.meta||{})};
  state.selection={...base.selection,...(snap.selection||{})};
  state.foerder={...base.foerder,...(snap.foerder||{})};
  state.schluck={...base.schluck,...(snap.schluck||{})};
  state.overviewPhotoDataUrl=typeof snap.overviewPhotoDataUrl==='string'?snap.overviewPhotoDataUrl:'';
  state.versuche=Array.isArray(snap.versuche)?snap.versuche.map(v=>hydrateVersuch(v)):[];
  state.restsand={imhoff:{...base.restsand.imhoff,...((snap.restsand||{}).imhoff||{})},sieb:{...base.restsand.sieb,...((snap.restsand||{}).sieb||{})},bemerkung:(snap.restsand||{}).bemerkung||''};
  state.ph={...base.ph,...(snap.ph||{}),sulfat:{...base.ph.sulfat,...((snap.ph||{}).sulfat||{})},temperatur:{...base.ph.temperatur,...((snap.ph||{}).temperatur||{})},leitfaehigkeit:{...base.ph.leitfaehigkeit,...((snap.ph||{}).leitfaehigkeit||{})},ph:{...base.ph.ph,...((snap.ph||{}).ph||{})},combined:{...base.ph.combined,...((snap.ph||{}).combined||{})}};
  state.kolben = {
  ...base.kolben,
  ...(snap.kolben || {}),
  rows: Array.isArray(snap.kolben?.rows) && snap.kolben.rows.length
    ? snap.kolben.rows.map(r => ({
        huebe: r?.huebe || '',
        aufsandung: r?.aufsandung || '',
        anmerkungen: r?.anmerkungen || ''
      }))
    : clone(base.kolben.rows)
};
  state.settings={...base.settings,...(snap.settings||{})};
  Object.keys(timerMap).forEach(hardStopTimer);
  if(render){syncMetaToUi();syncBrunnenToUi();syncSelectionToUi();renderOverviewPhotoThumb();syncRestsandToUi();syncPhToUi();syncKolbenToUi();syncSettingsToUi();renderVersuche();renderLiveTab();renderHistoryList();}
}
function saveDraftDebounced(){clearTimeout(_saveT);_saveT=setTimeout(()=>{try{localStorage.setItem(STORAGE_DRAFT,JSON.stringify(collectSnapshot()));}catch{}},250);}
function loadDraft(){try{const raw=localStorage.getItem(STORAGE_DRAFT);if(raw)applySnapshot(JSON.parse(raw),true);}catch(e){console.warn('Draft load failed',e);}}
function stripSnapshotPhotos(snap){
  const s = clone(snap || {});

  s.overviewPhotoDataUrl = '';

  s.versuche = Array.isArray(s.versuche)
    ? s.versuche.map(v => ({ ...v, photoDataUrl: '' }))
    : [];

  s.restsand = s.restsand || {};
  s.restsand.imhoff = s.restsand.imhoff || {};
  s.restsand.sieb = s.restsand.sieb || {};
  s.restsand.imhoff.photoDataUrl = '';
  s.restsand.sieb.photoDataUrl = '';

  s.ph = s.ph || {};
  s.ph.sulfat = s.ph.sulfat || {};
  s.ph.temperatur = s.ph.temperatur || {};
  s.ph.ph = s.ph.ph || {};
  s.ph.combined = s.ph.combined || {};
  s.ph.sulfat.photoDataUrl = '';
  s.ph.temperatur.photoDataUrl = '';
  s.ph.ph.photoDataUrl = '';
  s.ph.combined.photoDataUrl = '';

  s.kolben = s.kolben || {};

  return s;
}

function legacyReadHistoryFromLocalStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_HISTORY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(err){
    console.warn('Legacy history load failed:', err);
    return [];
  }
}

function openHistoryDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if(!db.objectStoreNames.contains(IDB_STORE_HISTORY)){
        const store = db.createObjectStore(IDB_STORE_HISTORY, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }

      if(!db.objectStoreNames.contains(IDB_STORE_PHOTOS)){
        const store = db.createObjectStore(IDB_STORE_PHOTOS, { keyPath: 'id' });
        store.createIndex('entryId', 'entryId', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
}

function dataUrlToBlob(dataUrl){
  const str = String(dataUrl || '');
  const parts = str.split(',');
  const meta = parts[0] || '';
  const b64  = parts[1] || '';
  const mimeMatch = meta.match(/data:([^;]+);base64/i);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);

  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Blob konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

function makePhotoKey(entryId, slot){
  return `${entryId}::${slot}`;
}

function snapshotToIndexedPayload(entryId, snap){
  const s = clone(snap || {});
  const photos = [];

  function stashPhoto(host, dataField, keyField, slot){
    if(!host) return;
    const dataUrl = String(host[dataField] || '');
    if(!dataUrl.startsWith('data:image/')) return;

    const photoKey = makePhotoKey(entryId, slot);
    photos.push({
      id: photoKey,
      entryId,
      slot,
      savedAt: Date.now(),
      blob: dataUrlToBlob(dataUrl)
    });

    host[keyField] = photoKey;
    host[dataField] = PHOTO_STORED;
  }

  stashPhoto(s, 'overviewPhotoDataUrl', 'overviewPhotoKey', 'overview');

  (s.versuche || []).forEach((v, i) => {
    stashPhoto(v, 'photoDataUrl', 'photoKey', `versuch:${i}`);
  });

  if(s.restsand?.imhoff) stashPhoto(s.restsand.imhoff, 'photoDataUrl', 'photoKey', 'restsand:imhoff');
  if(s.restsand?.sieb)   stashPhoto(s.restsand.sieb,   'photoDataUrl', 'photoKey', 'restsand:sieb');

  if(s.ph?.sulfat)      stashPhoto(s.ph.sulfat,      'photoDataUrl', 'photoKey', 'ph:sulfat');
  if(s.ph?.temperatur)  stashPhoto(s.ph.temperatur,  'photoDataUrl', 'photoKey', 'ph:temperatur');
  if(s.ph?.leitfaehigkeit)  stashPhoto(s.ph.leitfaehigkeit, 'photoDataUrl', 'photoKey', 'ph:leitfaehigkeit');
  if(s.ph?.ph)          stashPhoto(s.ph.ph,          'photoDataUrl', 'photoKey', 'ph:ph');
  if(s.ph?.combined)    stashPhoto(s.ph.combined,    'photoDataUrl', 'photoKey', 'ph:combined');
  return { snapshot: s, photos };
}

async function dbSaveHistoryEntry(entry){
  const payload = snapshotToIndexedPayload(entry.id, entry.snapshot);
  const record = {
    ...entry,
    snapshot: payload.snapshot,
    photoMode: 'blob'
  };

  const db = await openHistoryDb();

  return await new Promise((resolve,reject)=>{
    const tx = db.transaction([IDB_STORE_HISTORY, IDB_STORE_PHOTOS], 'readwrite');
    const historyStore = tx.objectStore(IDB_STORE_HISTORY);
    const photoStore = tx.objectStore(IDB_STORE_PHOTOS);

    historyStore.put(record);
    payload.photos.forEach(photo => photoStore.put(photo));

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('History konnte nicht gespeichert werden.'));
    tx.onabort = () => reject(tx.error || new Error('History-Transaktion abgebrochen.'));
  });
}

async function readHistory(){
  const db = await openHistoryDb();

  const list = await new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE_HISTORY, 'readonly');
    const store = tx.objectStore(IDB_STORE_HISTORY);
    const req = store.getAll();

    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error || new Error('History konnte nicht gelesen werden.'));
  });

  return list
    .sort((a,b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
    .slice(0, HISTORY_MAX);
}

async function getHistoryEntryById(id){
  const db = await openHistoryDb();

  return await new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE_HISTORY, 'readonly');
    const store = tx.objectStore(IDB_STORE_HISTORY);
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('History-Eintrag konnte nicht gelesen werden.'));
  });
}

async function deleteHistoryEntryById(id){
  const db = await openHistoryDb();

  return await new Promise((resolve,reject)=>{
    const tx = db.transaction([IDB_STORE_HISTORY, IDB_STORE_PHOTOS], 'readwrite');
    const historyStore = tx.objectStore(IDB_STORE_HISTORY);
    const photoStore = tx.objectStore(IDB_STORE_PHOTOS);
    const photoIndex = photoStore.index('entryId');

    historyStore.delete(id);

    const cursorReq = photoIndex.openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if(cursor){
        cursor.delete();
        cursor.continue();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error || new Error('Fotos konnten nicht gelöscht werden.'));

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('History-Löschen fehlgeschlagen.'));
    tx.onabort = () => reject(tx.error || new Error('History-Löschen abgebrochen.'));
  });
}

async function getPhotoDataUrlByKey(photoKey){
  if(!photoKey) return '';

  const db = await openHistoryDb();

  const record = await new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE_PHOTOS, 'readonly');
    const store = tx.objectStore(IDB_STORE_PHOTOS);
    const req = store.get(photoKey);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Foto konnte nicht geladen werden.'));
  });

  if(!record?.blob) return '';
  return blobToDataUrl(record.blob);
}

async function materializeSnapshotPhotos(snap){
  const s = clone(snap || {});

  async function restorePhoto(host, dataField, keyField){
    if(!host) return;
    const key = host[keyField];
    if(!key){
      if(host[dataField] === PHOTO_STORED) host[dataField] = '';
      return;
    }
    host[dataField] = await getPhotoDataUrlByKey(key);
  }

  await restorePhoto(s, 'overviewPhotoDataUrl', 'overviewPhotoKey');

  for(const v of (s.versuche || [])){
    await restorePhoto(v, 'photoDataUrl', 'photoKey');
  }

  await restorePhoto(s.restsand?.imhoff, 'photoDataUrl', 'photoKey');
  await restorePhoto(s.restsand?.sieb,   'photoDataUrl', 'photoKey');

  await restorePhoto(s.ph?.sulfat,      'photoDataUrl', 'photoKey');
  await restorePhoto(s.ph?.temperatur,  'photoDataUrl', 'photoKey');
  await restorePhoto(s.ph?.leitfaehigkeit, 'photoDataUrl', 'photoKey');
  await restorePhoto(s.ph?.ph,          'photoDataUrl', 'photoKey');
  await restorePhoto(s.ph?.combined,    'photoDataUrl', 'photoKey');
  return s;
}

async function migrateLocalHistoryToIndexedDb(){
  try{
    if(localStorage.getItem(STORAGE_HISTORY_MIGRATED) === '1') return;

    const existingDbEntries = await readHistory();
    if(existingDbEntries.length){
      localStorage.setItem(STORAGE_HISTORY_MIGRATED, '1');
      return;
    }

    const legacy = legacyReadHistoryFromLocalStorage();
    if(!legacy.length){
      localStorage.setItem(STORAGE_HISTORY_MIGRATED, '1');
      return;
    }

    for(const entry of legacy.slice(0, HISTORY_MAX)){
      if(!entry?.id || !entry?.snapshot) continue;
      await dbSaveHistoryEntry({
        id: entry.id,
        savedAt: entry.savedAt || Date.now(),
        title: entry.title || '—',
        snapshot: entry.snapshot,
        photoMode: entry.photoMode || 'migrated'
      });
    }

    try{ localStorage.removeItem(STORAGE_HISTORY); }catch{}
    localStorage.setItem(STORAGE_HISTORY_MIGRATED, '1');
  }catch(err){
    console.warn('History migration failed:', err);
  }
}

async function saveCurrentToHistory(msg='Im Verlauf gespeichert.'){
  if(!ensureRequiredFiliale()) return false;

  try{
    const current = await readHistory();

    if(current.length >= HISTORY_MAX){
      alert(`Im Verlauf sind bereits ${HISTORY_MAX} Einträge gespeichert. Bitte zuerst alte Einträge löschen. Es wird nichts automatisch überschrieben.`);
      return false;
    }

    const snap = collectSnapshot();
    const entry = {
      id: uid(),
      savedAt: Date.now(),
      title: `${snap.meta?.objekt || '—'} · ${snap.meta?.ort || '—'}`,
      snapshot: snap,
      photoMode: 'blob'
    };

    await dbSaveHistoryEntry(entry);
    await renderHistoryList();

    if(msg) alert(msg);
    return true;
  }catch(err){
    console.error(err);
    alert('Speichern im Verlauf fehlgeschlagen.');
    return false;
  }
}
/* ── TABS ── */
function initTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('is-active',b===btn));
      document.querySelectorAll('.pane').forEach(p=>{const on=p.id===`tab-${btn.dataset.tab}`;p.classList.toggle('is-active',on);p.hidden=!on;});
      if(btn.dataset.tab==='verlauf')renderHistoryList();
      if(btn.dataset.tab==='live')renderLiveTab();
      updateFloatingTimerWidget();
    });
  });
}

/* ── AUDIO ── */
function getAlarmAudioContext(){
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
  if(!_audioCtx){try{_audioCtx=new AC();_alarmGain=_audioCtx.createGain();_alarmGain.gain.value=1.0;_alarmGain.connect(_audioCtx.destination);}catch{return null;}}
  return _audioCtx;
}
function audioNeedsResume(ctx){
  return !ctx || ctx.state === 'suspended' || ctx.state === 'interrupted';
}

async function unlockAlarmAudio(){
  const ctx = getAlarmAudioContext();
  if(!ctx) return false;

  try{
    if(audioNeedsResume(ctx)){
      await ctx.resume();
      await new Promise(r => setTimeout(r, 30));
    }

    if(audioNeedsResume(ctx)){
      _alarmReady = false;
      updateAlarmSoundButton();
      return false;
    }

    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(_alarmGain || ctx.destination);
    src.start(0);

    _alarmReady = true;
    updateAlarmSoundButton();
    return true;
  }catch(err){
    console.warn('unlockAlarmAudio failed:', err);
    _alarmReady = false;
    updateAlarmSoundButton();
    return false;
  }
}

function installAudioUnlock(){
  const fn = () => {
    if(state.settings?.alarmSoundEnabled === false) return;
    void unlockAlarmAudio();
  };

  ['pointerdown','touchstart','touchend','keydown','click'].forEach(evt=>{
    window.addEventListener(evt, fn, { passive:true });
  });
}

function scheduleBeep(ctx,start,duration=0.10,freq=2350,volume=0.52){
  const out = _alarmGain || ctx.destination;
  [freq, freq*1.015].forEach(f=>{
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f,start);
    g.gain.setValueAtTime(0.0001,start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001,volume),start+0.005);
    g.gain.setValueAtTime(Math.max(0.0001,volume),start+Math.max(0.03,duration-0.02));
    g.gain.exponentialRampToValueAtTime(0.0001,start+duration);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start+duration+0.02);
  });
}

async function armAlarmSound(playTest=true){
  state.settings.alarmSoundEnabled = true;

  const ok = await unlockAlarmAudio();
  if(!ok) return false;

  if(playTest){
    const ctx = getAlarmAudioContext();
    if(!ctx) return false;

    const now = ctx.currentTime + 0.02;
    scheduleBeep(ctx, now,        0.08, 2100, 0.42);
    scheduleBeep(ctx, now + 0.18, 0.10, 2550, 0.50);
  }

  updateAlarmSoundButton();
  return true;
}

async function toggleAlarmSoundByUserGesture(){
  const active = state.settings.alarmSoundEnabled !== false && _alarmReady;

  if(active){
    state.settings.alarmSoundEnabled = false;
    _alarmReady = false;
    updateAlarmSoundButton();
    saveDraftDebounced();
    return;
  }

  state.settings.alarmSoundEnabled = true;
  const ok = await armAlarmSound(true);
  updateAlarmSoundButton();
  saveDraftDebounced();

  if(!ok){
    alert('Der Ton konnte auf diesem iPhone noch nicht freigeschaltet werden. Bitte Lautstärke prüfen und den Button erneut direkt antippen.');
  }
}

async function playIntervalBeep(){
  if(state.settings?.alarmSoundEnabled === false) return false;

  const ctx = getAlarmAudioContext();
  if(!ctx) return false;

  if(audioNeedsResume(ctx)){
    const ok = await unlockAlarmAudio();
    if(!ok) return false;
  }

  if(audioNeedsResume(ctx)) return false;

  try{
    const p=[120,90,120,90,120,360];
    const tot=Math.max(1,Math.round(Number(state.settings.alarmDurationSec||4)/0.9));
    const vib=[];
    for(let i=0;i<tot;i++) vib.push(...p);
    if(navigator.vibrate) navigator.vibrate(vib);
  }catch{}

  const dur = clamp(Number(state.settings.alarmDurationSec||4),1,30);
  const now = ctx.currentTime + 0.02;
  const cycle = 0.90;

  for(let t=0;t<dur;t+=cycle){
    scheduleBeep(ctx, now+t,       0.10, 2350, 0.52);
    scheduleBeep(ctx, now+t+0.20,  0.10, 2350, 0.52);
    scheduleBeep(ctx, now+t+0.40,  0.12, 2550, 0.56);
  }

  return true;
}

/* ── IMAGE HELPERS ── */
async function downscaleImageFile(file,maxDim=1600,quality=0.78){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{const img=new Image();img.onload=()=>{let{width,height}=img;const scale=Math.min(1,maxDim/Math.max(width,height));width=Math.round(width*scale);height=Math.round(height*scale);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(img,0,0,width,height);try{resolve(canvas.toDataURL('image/jpeg',quality));}catch(e){reject(e);}};img.onerror=reject;img.src=reader.result;};
    reader.onerror=reject;reader.readAsDataURL(file);
  });
}
function dataUrlToUint8Array(dataUrl){const b64=dataUrl.split(',')[1]||'',bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
async function embedDataUrlImage(pdf,dataUrl){if(!dataUrl)return null;const bytes=dataUrlToUint8Array(dataUrl);return/^data:image\/png/i.test(dataUrl)?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);}
async function handlePhotoSelected(file){return downscaleImageFile(file,1400,0.74);}

/* ── GLOBAL PHOTO DELEGATION ── */
function hookGlobalPhotoDelegation(){
  document.addEventListener('click',async e=>{
    const btn=e.target.closest('button');if(!btn)return;
    if(btn.id==='overviewPhotoBtnTrigger'){$('overviewPhotoInput')?.click();return;}
    if(btn.dataset.rsPhoto){document.getElementById(`${btn.dataset.rsPhoto}PhotoInput`)?.click();return;}
    if(btn.dataset.phPhoto){const map={sulfat:'sulfatPhotoInput',temperatur:'tempPhotoInput',leitfaehigkeit:'leitPhotoInput',ph:'phPhotoInput',combined:'kombiPhotoInput'};$(map[btn.dataset.phPhoto])?.click();return;}
    if(btn.dataset.photoDel){
      const what=btn.dataset.photoDel;
      if(what==='overview'){state.overviewPhotoDataUrl='';renderOverviewPhotoThumb();saveDraftDebounced();return;}
      if(what.startsWith('restsand-')){const k=what.replace('restsand-','');state.restsand[k].photoDataUrl='';renderRestsandPhotoAreas();saveDraftDebounced();return;}
      if(what.startsWith('ph-')){
        const k=what.replace('ph-','');
        if(k==='ph')state.ph.ph.photoDataUrl='';
        else if(k==='combined')state.ph.combined.photoDataUrl='';
        else state.ph[k].photoDataUrl='';
        renderPhPhotoAreas();
        saveDraftDebounced();
      }
    }
  });
  document.addEventListener('change',async e=>{
    const input=e.target;if(!(input instanceof HTMLInputElement)||!input.files||!input.files[0])return;
    const file=input.files[0];
    try{
      const dataUrl=await handlePhotoSelected(file);
      if(input.id==='overviewPhotoInput'){state.overviewPhotoDataUrl=dataUrl;renderOverviewPhotoThumb();}
      else if(input.dataset.rsInput){state.restsand[input.dataset.rsInput].photoDataUrl=dataUrl;renderRestsandPhotoAreas();}
      else if(input.dataset.phInput){
        if(input.dataset.phInput==='ph')state.ph.ph.photoDataUrl=dataUrl;
        else if(input.dataset.phInput==='combined')state.ph.combined.photoDataUrl=dataUrl;
        else state.ph[input.dataset.phInput].photoDataUrl=dataUrl;
        renderPhPhotoAreas();
      }
      saveDraftDebounced();
    }catch(err){console.error(err);alert('Foto konnte nicht verarbeitet werden.');}
    finally{input.value='';}
  });
}

/* ── TIMER ── */
function ensureTimer(vid,versuch){
  if(!timerMap[vid]){
    const elapsedMin=Number(versuch?.elapsedMs||0)/60000;
    const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
    timerMap[vid]={running:false,startMs:0,accumulatedMs:Number(versuch?.elapsedMs||0),raf:null,alarmCount:mins.filter(iv=>iv>0&&elapsedMin>=iv).length};
  }
  return timerMap[vid];
}
function getElapsedMs(vid,versuch){const t=timerMap[vid];if(!t)return Number(versuch?.elapsedMs||0);return t.running?t.accumulatedMs+(Date.now()-t.startMs):t.accumulatedMs;}

function updateTimerUi(card,versuch){
  if(!card||!versuch)return;
  const t=ensureTimer(versuch.id,versuch);
  const ms=getElapsedMs(versuch.id,versuch);
  versuch.elapsedMs=ms;
  const elapsedEl=card.querySelector('[data-role="elapsed"]');
  const startBtn=card.querySelector('[data-role="timer-start"]');
  const stopBtn=card.querySelector('[data-role="timer-stop"]');
  const startZeitEl=card.querySelector('[data-role="startzeit"]');
  const nextEl=card.querySelector('[data-role="naechstes"]');
  if(elapsedEl)elapsedEl.textContent=formatElapsed(ms);
  if(startZeitEl)startZeitEl.textContent=versuch.startzeit?`Startzeit: ${versuch.startzeit}`:'Noch nicht gestartet';
  if(startBtn){startBtn.textContent=t.running?'Läuft':(versuch.elapsedMs>0?'Weiter':'Start');startBtn.disabled=t.running;}
  if(stopBtn)stopBtn.disabled=!t.running;
  const mins=(versuch.messungen||[]).map(m=>Number(m.min)).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
  const eMin=ms/60000;
  const nextIv=mins.filter(iv=>iv>0).find(iv=>eMin<iv);
  if(nextEl)nextEl.textContent=nextIv!==undefined?`Nächste Messung: ${nextIv} min (in ${Math.max(0,Math.ceil((nextIv*60000-ms)/1000))}s)`:'Alle Messintervalle erreicht';
  card.querySelectorAll('tbody tr').forEach(r=>r.classList.remove('row-active'));
  const passed=mins.filter(iv=>eMin>=iv);
  const lastPassed=passed.length?passed[passed.length-1]:mins[0];
  const rowIdx=versuch.messungen.findIndex(m=>Number(m.min)===Number(lastPassed));
  if(rowIdx>=0){const row=card.querySelector(`tr[data-row="${rowIdx}"]`);if(row)row.classList.add('row-active');}
}

function triggerIntervalAlarm(vid){
  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  const display=card?.querySelector('[data-role="elapsed"]');

  document.body.classList.remove('screen-flash');
  void document.body.offsetWidth;
  document.body.classList.add('screen-flash');

  if(card){
    card.classList.remove('versuch-card--alarm');
    void card.offsetWidth;
    card.classList.add('versuch-card--alarm');
  }

  if(display){
    display.classList.remove('timer-display--alarm');
    void display.offsetWidth;
    display.classList.add('timer-display--alarm');
  }

  void playIntervalBeep();

  setTimeout(()=>document.body.classList.remove('screen-flash'),1800);
  setTimeout(()=>{
    if(card)card.classList.remove('versuch-card--alarm');
    if(display)display.classList.remove('timer-display--alarm');
  },Math.max(2400,Number(state.settings.alarmDurationSec||4)*1000+600));
}

function tickTimer(vid){
  const versuch=getVersuchById(vid);
  const t=timerMap[vid];
  if(!versuch||!t||!t.running)return;

  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  versuch.elapsedMs=getElapsedMs(vid,versuch);

  if(card)updateTimerUi(card,versuch);

  const mins=(versuch.messungen||[])
    .map(m=>Number(m.min))
    .filter(n=>Number.isFinite(n)&&n>0)
    .sort((a,b)=>a-b);

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
  if(!versuch)return;

  if(state.settings.alarmSoundEnabled !== false){
    void unlockAlarmAudio();
  }

  const t=ensureTimer(vid,versuch);
  if(t.running)return;

  if(!versuch.startzeit)versuch.startzeit=formatTimeHHMMSS(new Date());

  const mins=(versuch.messungen||[])
    .map(m=>Number(m.min))
    .filter(n=>Number.isFinite(n)&&n>=0)
    .sort((a,b)=>a-b);

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
  const versuch=getVersuchById(vid);const t=timerMap[vid];if(!versuch||!t||!t.running)return;
  t.accumulatedMs+=(Date.now()-t.startMs);versuch.elapsedMs=t.accumulatedMs;t.running=false;
  if(t.raf)cancelAnimationFrame(t.raf);t.raf=null;
  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card,versuch);updateFloatingTimerWidget();stopFloatingLoopIfIdle();saveDraftDebounced();
}
function resetTimer(vid){
  const versuch=getVersuchById(vid);if(!versuch)return;
  const t=ensureTimer(vid,versuch);if(t.raf)cancelAnimationFrame(t.raf);
  t.running=false;t.startMs=0;t.accumulatedMs=0;t.raf=null;t.alarmCount=0;
  versuch.elapsedMs=0;versuch.startzeit='';
  const card=document.querySelector(`.versuch-card[data-vid="${vid}"]`);
  updateTimerUi(card,versuch);updateFloatingTimerWidget();stopFloatingLoopIfIdle();saveDraftDebounced();
}
function hardStopTimer(vid){
  const t=timerMap[vid];if(!t)return;
  try{if(t.raf)cancelAnimationFrame(t.raf);}catch{}
  delete timerMap[vid];updateFloatingTimerWidget();stopFloatingLoopIfIdle();
}

/* ── FLOATING TIMER ── */
function getFirstRunningStage(){return state.versuche.find(v=>timerMap[v.id]?.running)||null;}
function isElementVisible(el){
  if(!el)return false;
  const r=el.getBoundingClientRect();
  if(r.width===0&&r.height===0)return false;
  if(getComputedStyle(el).display==='none')return false;
  return r.top>=0&&r.bottom<=window.innerHeight&&r.left>=0&&r.right<=window.innerWidth;
}
function updateFloatingTimerWidget(){
  const wrap=$('floatingTimer'),label=$('floatingTimerLabel'),display=$('floatingTimerDisplay');
  if(!wrap||!label||!display)return;
  const stage=getFirstRunningStage();
  if(!stage){wrap.hidden=true;return;}
  const idx=state.versuche.findIndex(v=>v.id===stage.id);
  const card=document.querySelector(`.versuch-card[data-vid="${stage.id}"]`);
  const timerBox=card?.querySelector('.timer-box');
  label.textContent=getStageTitle(idx);
  display.textContent=formatElapsed(getElapsedMs(stage.id,stage));
  wrap.hidden=isElementVisible(timerBox);
}
function startFloatingLoop(){
  if(_floatingRaf)return;
  const loop=()=>{updateFloatingTimerWidget();if(Object.values(timerMap).some(t=>t.running))_floatingRaf=requestAnimationFrame(loop);else{_floatingRaf=null;}};
  _floatingRaf=requestAnimationFrame(loop);
}
function stopFloatingLoopIfIdle(){if(!Object.values(timerMap).some(t=>t.running)&&_floatingRaf){cancelAnimationFrame(_floatingRaf);_floatingRaf=null;}}
function initFloatingTimer(){
  $('floatingTimer')?.addEventListener('click',()=>{const stage=getFirstRunningStage();if(stage)openTimeAdjustModal(stage.id);});
  window.addEventListener('scroll',updateFloatingTimerWidget,{passive:true});
  window.addEventListener('resize',updateFloatingTimerWidget);
}

/* ── TIME ADJUST MODAL ── */
function openTimeAdjustModal(vid){_timeAdjustVid=vid;$('timeAdjustInput').value='0';updateTimeAdjustPreview();$('timeAdjustModal').hidden=false;}
function closeTimeAdjustModal(){$('timeAdjustModal').hidden=true;_timeAdjustVid=null;}
function updateTimeAdjustPreview(){
  const v=getVersuchById(_timeAdjustVid);if(!v)return;
  const next=Math.max(0,getElapsedMs(v.id,v)+Number($('timeAdjustInput')?.value||0)*1000);
  $('timeAdjustPreview').textContent=`Neue Zeit: ${formatElapsed(next)}`;
}
function applyTimeAdjustment(){
  const v=getVersuchById(_timeAdjustVid);if(!v)return;
  const offset=Number($('timeAdjustInput')?.value||0);
  const t=ensureTimer(v.id,v);
  const next=Math.max(0,getElapsedMs(v.id,v)+offset*1000);
  if(t.running){t.startMs=Date.now();t.accumulatedMs=next;}else{t.accumulatedMs=next;}
  v.elapsedMs=next;if(!v.startzeit&&next>0)v.startzeit=formatTimeHHMMSS(new Date());
  const card=document.querySelector(`.versuch-card[data-vid="${v.id}"]`);
  updateTimerUi(card,v);updateFloatingTimerWidget();saveDraftDebounced();closeTimeAdjustModal();
}
function initTimeAdjustModal(){
  $('timeAdjustInput')?.addEventListener('input',updateTimeAdjustPreview);
  document.querySelectorAll('.modal-adj-btn').forEach(btn=>btn.addEventListener('click',()=>{
    $('timeAdjustInput').value=String(Number($('timeAdjustInput').value||0)+Number(btn.dataset.adj||0));
    updateTimeAdjustPreview();
  }));
  $('timeAdjustApply')?.addEventListener('click',applyTimeAdjustment);
  $('timeAdjustCancel')?.addEventListener('click',closeTimeAdjustModal);
  $('timeAdjustModal')?.addEventListener('click',e=>{if(e.target.id==='timeAdjustModal')closeTimeAdjustModal();});
}

/* ── RENDER STAGES ── */
function buildTableHeadHtml(){
  const sel=getSelectedWells();
  let html='<tr><th style="width:56px">Min</th>';
  if(sel.foerder)html+=`<th class="th-foerder">Förderbrunnen<br><span style="font-size:.75em;font-weight:600">m ab OK</span></th>`;
  if(sel.schluck)html+=`<th class="th-schluck">Rückgabe<br><span style="font-size:.75em;font-weight:600">m ab OK</span></th>`;
  html+='<th>Fördermenge<br><span style="font-size:.75em;font-weight:600">m³/h</span></th></tr>';
  return html;
}
function buildTableRowHtml(v,row,rowIdx){
  const sel=getSelectedWells();
  const isLast=rowIdx===v.messungen.length-1;
  let html=`<tr data-row="${rowIdx}"><td><div class="minute-cell"><input class="mess-input minute-input" data-role="min" data-row="${rowIdx}" type="number" step="1" inputmode="numeric" value="${h(row.min)}">${isLast?`<button class="row-plus" data-role="row-plus" data-row="${rowIdx}" type="button">+</button>`:''}</div></td>`;
  if(sel.foerder)html+=`<td><input class="mess-input" data-role="foerder-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.foerder_m)}"></td>`;
  if(sel.schluck)html+=`<td><input class="mess-input" data-role="schluck-m" data-row="${rowIdx}" type="number" step="0.001" inputmode="decimal" value="${h(row.schluck_m)}"></td>`;
  html+=`<td><input class="mess-input" data-role="foerder-menge" data-row="${rowIdx}" type="number" step="0.01" inputmode="decimal" value="${h(row.foerder_menge)}"></td></tr>`;
  return html;
}
function buildVersuchHtml(v,idx){
  const effLs=getEffectiveRateLs(v);
  const effM3h=getEffectiveRateM3h(v);
  const avg=getAverageFoerderMenge(v);
  const hasPhoto=!!v.photoDataUrl;
  return `
<details class="card card--collapsible versuch-card" data-vid="${h(v.id)}" open>
  <summary class="card__title">
    <span class="versuch-head-title">${getStageTitle(idx)}</span>
    <span class="versuch-head-spacer"></span>
    <span class="versuch-head-actions">
      ${hasPhoto?`<button class="photo-del-btn" data-role="photo-del" type="button" title="Foto entfernen">✕</button>`:''}
      <button class="photo-btn ${hasPhoto?'photo-btn--has':''}" data-role="photo-btn" type="button">${camSvg(16,13)}</button>
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
    </div>
    <div class="versuch-row versuch-row--avg">
      <span class="rate-label">Ø Fördermenge [m³/h]</span>
      <input class="rate-input rate-input--readonly" data-role="avg-foerder-menge" type="text" value="${h(avg||'—')}" readonly>
      <span class="rate-hint">Ø aus Messwerten</span>
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
          <button class="timer-btn timer-btn--stop" data-role="timer-stop" type="button">Stop</button>
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
  if(!card||!versuch)return;
  const m3hEl=card.querySelector('[data-role="head-rate-m3h"]');
  const avgEl=card.querySelector('[data-role="avg-foerder-menge"]');
  if(m3hEl)m3hEl.textContent=getEffectiveRateM3h(versuch)?`${getEffectiveRateM3h(versuch)} m³/h`:'—';
  if(avgEl)avgEl.value=getAverageFoerderMenge(versuch)||'—';
}
function renderVersuche(){
  const host=$('versucheContainer');if(!host)return;
  if(!state.versuche.length){host.innerHTML=`<div class="empty-state">Noch keine Pumpstufe angelegt.<br>Bitte über den Plus-Button eine neue Stufe hinzufügen.</div>`;updateFloatingTimerWidget();return;}
  host.innerHTML=state.versuche.map((v,idx)=>buildVersuchHtml(v,idx)).join('');
  document.querySelectorAll('.versuch-card').forEach(card=>{const v=getVersuchById(card.dataset.vid);if(v){updateStageRateDisplay(card,v);updateTimerUi(card,v);}});
  updateFloatingTimerWidget();
}

/* ── STAGE DELEGATION ── */
function hookVersuchDelegation(){
  const host=$('versucheContainer');
  if(!host||host.dataset.bound==='1')return;
  host.dataset.bound='1';
  host.addEventListener('input',e=>{
    const el=e.target.closest('[data-role]');if(!el)return;
    const card=el.closest('.versuch-card');if(!card)return;
    const versuch=getVersuchById(card.dataset.vid);if(!versuch)return;
    const role=el.dataset.role,idx=Number(el.dataset.row);
    if(role==='manual-rate-ls'){versuch.manualRateM3h=String(el.value).trim()===''?'':lsToM3h(el.value);updateStageRateDisplay(card,versuch);saveDraftDebounced();scheduleLiveRender();return;}
    if(role==='min'){if(versuch.messungen[idx])versuch.messungen[idx].min=el.value;saveDraftDebounced();scheduleLiveRender();return;}
    if(role==='foerder-m'){if(versuch.messungen[idx])versuch.messungen[idx].foerder_m=el.value;saveDraftDebounced();scheduleLiveRender();return;}
    if(role==='schluck-m'){if(versuch.messungen[idx])versuch.messungen[idx].schluck_m=el.value;saveDraftDebounced();scheduleLiveRender();return;}
    if(role==='foerder-menge'){if(versuch.messungen[idx])versuch.messungen[idx].foerder_menge=el.value;updateStageRateDisplay(card,versuch);saveDraftDebounced();scheduleLiveRender();return;}
  });
  host.addEventListener('change',async e=>{
    const el=e.target.closest('[data-role]');if(!el)return;
    const card=el.closest('.versuch-card');if(!card)return;
    const versuch=getVersuchById(card.dataset.vid);if(!versuch)return;
    const role=el.dataset.role;
    if(role==='photo-input'){
      const file=el.files&&el.files[0];
      if(file){try{versuch.photoDataUrl=await handlePhotoSelected(file);renderVersuche();saveDraftDebounced();}catch(err){console.error(err);alert('Foto konnte nicht verarbeitet werden.');}finally{el.value='';}}
      return;
    }
    if(role==='intervalle'){
      const ints=parseIntervalStr(el.value);
      if(!ints.length){alert('Bitte gültige Intervalle eingeben.');el.value=versuch.intervalleStr;return;}
      const old=Array.isArray(versuch.messungen)?versuch.messungen:[];
      versuch.intervalleStr=ints.join(', ');
      versuch.messungen=ints.map(min=>{const hit=old.find(m=>Number(m.min)===Number(min));return hit||defaultMessung(min);});
      hardStopTimer(versuch.id);renderVersuche();renderLiveTab();saveDraftDebounced();return;
    }
    if(role==='min'){sortMessungen(versuch);hardStopTimer(versuch.id);renderVersuche();renderLiveTab();saveDraftDebounced();}
  });
  host.addEventListener('click',e=>{
    const card=e.target.closest('.versuch-card');if(!card)return;
    const versuch=getVersuchById(card.dataset.vid);if(!versuch)return;
    if(e.target.closest('.timer-display')){e.preventDefault();e.stopPropagation();openTimeAdjustModal(versuch.id);return;}
    const btn=e.target.closest('[data-role]');if(!btn)return;
    const role=btn.dataset.role;
    if(role==='photo-btn'){e.preventDefault();e.stopPropagation();unlockAlarmAudio();card.querySelector('[data-role="photo-input"]')?.click();return;}
    if(role==='photo-del'){e.preventDefault();e.stopPropagation();if(!confirm('Beweisfoto wirklich entfernen?'))return;versuch.photoDataUrl='';renderVersuche();saveDraftDebounced();return;}
    if(role==='row-plus'){
      sortMessungen(versuch);
      const step=getContinueStep(versuch);
      const last=versuch.messungen.length?Number(versuch.messungen[versuch.messungen.length-1].min):0;
      versuch.messungen.push(defaultMessung(Number.isFinite(last)?last+step:step));
      syncIntervalleStrFromRows(versuch);renderVersuche();renderLiveTab();saveDraftDebounced();return;
    }
    if(role==='del'){const idx=state.versuche.findIndex(v=>v.id===versuch.id);if(!confirm(`${getStageTitle(idx)} wirklich löschen?`))return;hardStopTimer(versuch.id);state.versuche=state.versuche.filter(v=>v.id!==versuch.id);renderVersuche();renderLiveTab();saveDraftDebounced();return;}
    if(role==='timer-start'){e.stopPropagation();startTimer(versuch.id);return;}
    if(role==='timer-stop'){e.stopPropagation();stopTimer(versuch.id);return;}
    if(role==='timer-reset'){e.stopPropagation();resetTimer(versuch.id);return;}
  });
}

/* ── STATIC INPUTS ── */
function hookStaticInputs(){
META_FIELDS.forEach(([id])=>{const el=$(id);if(!el)return;el.addEventListener('input',()=>{collectMetaFromUi();saveDraftDebounced();});el.addEventListener('change',()=>{collectMetaFromUi();saveDraftDebounced();});});
BRUNNEN_FIELDS.forEach(([id])=>{const el=$(id);if(!el)return;el.addEventListener('input',()=>{collectBrunnenFromUi();saveDraftDebounced();scheduleLiveRender();});el.addEventListener('change',()=>{collectBrunnenFromUi();saveDraftDebounced();scheduleLiveRender();});});
$('sel-foerder')?.addEventListener('change',()=>{if(!collectSelectionFromUi())return;renderVersuche();renderLiveTab();saveDraftDebounced();});
$('sel-schluck')?.addEventListener('change',()=>{if(!collectSelectionFromUi())return;renderVersuche();renderLiveTab();saveDraftDebounced();});
['restsand-imhoff-menge','restsand-sieb-menge','restsand-bemerkung'].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('input',()=>{collectRestsandFromUi();saveDraftDebounced();});el.addEventListener('change',()=>{collectRestsandFromUi();saveDraftDebounced();});});
['ph-datum','ph-bauherr','ph-baustelle','ph-gewaessername','ph-sulfat-wert','ph-temp-wert','ph-leitfaehigkeit-wert','ph-ph-wert','ph-combined-ph','ph-combined-lf','ph-combined-temp','ph-combined-o2'].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('input',()=>{collectPhFromUi();saveDraftDebounced();});el.addEventListener('change',()=>{collectPhFromUi();saveDraftDebounced();});});
function handlePhModeChange(){
  collectPhFromUi();
  togglePhModeDisplay();
  saveDraftDebounced();
}
$('ph-mode-kombi')?.addEventListener('change', handlePhModeChange);
$('ph-mode-einzel')?.addEventListener('change', handlePhModeChange);
['kolben-ausbaudurchmesser','kolben-entnahme','kolben-nummer','kolben-brunnenOk','kolben-restsandmessung'].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('input',()=>{collectKolbenFromUi();saveDraftDebounced();});el.addEventListener('change',()=>{collectKolbenFromUi();saveDraftDebounced();});});
const kolbenRowsHost = $('kolbenRowsContainer');

if(kolbenRowsHost && kolbenRowsHost.dataset.bound !== '1'){
  kolbenRowsHost.dataset.bound = '1';

  kolbenRowsHost.addEventListener('input', () => {
    collectKolbenFromUi();
    saveDraftDebounced();
  });

  kolbenRowsHost.addEventListener('change', () => {
    collectKolbenFromUi();
    saveDraftDebounced();
  });
}

// Plus-Button robust über Event-Delegation.
// Dadurch funktioniert er auch dann, wenn DOM-Inhalte später neu gerendert werden.
if(document.body && document.body.dataset.kolbenPlusBound !== '1'){
  document.body.dataset.kolbenPlusBound = '1';

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btnAddKolbenRow');
    if(!btn) return;

    e.preventDefault();
    e.stopPropagation();

    addKolbenRow();
  });
}
$('settings-alarmDuration')?.addEventListener('input',()=>{collectSettingsFromUi();saveDraftDebounced();});
$('pdfType-protokoll')?.addEventListener('change',()=>{collectSettingsFromUi();saveDraftDebounced();});
$('pdfType-vollstaendig')?.addEventListener('change',()=>{collectSettingsFromUi();saveDraftDebounced();});
$('theme-dark')?.addEventListener('change',()=>{collectSettingsFromUi();renderLiveTab();saveDraftDebounced();});
$('theme-light')?.addEventListener('change',()=>{collectSettingsFromUi();renderLiveTab();saveDraftDebounced();});
$('btnAlarmSoundToggle')?.addEventListener('click',async()=>{await toggleAlarmSoundByUserGesture();});
$('btnAddVersuch')?.addEventListener('click',()=>{const v=defaultVersuch();state.versuche.push(v);renderVersuche();renderLiveTab();saveDraftDebounced();setTimeout(()=>document.querySelector(`.versuch-card[data-vid="${v.id}"]`)?.scrollIntoView({behavior:'smooth',block:'start'}),40);});
$('btnSave')?.addEventListener('click',()=>saveCurrentToHistory('Pumpversuch im Verlauf gespeichert.'));
$('btnSaveRestsand')?.addEventListener('click',()=>saveCurrentToHistory('Restsanddaten im Verlauf gespeichert.'));
$('btnSavePh')?.addEventListener('click',()=>saveCurrentToHistory('pH/Sulfat-Daten im Verlauf gespeichert.'));
$('btnSaveKolben')?.addEventListener('click',()=>saveCurrentToHistory('Kolbendaten im Verlauf gespeichert.'));
$('btnPdf')?.addEventListener('click',async()=>{try{await exportPdf(null,state.settings.pdfExportType);}catch(err){console.error(err);alert('PDF-Fehler: '+(err?.message||String(err)));}});
$('btnPdfRestsand')?.addEventListener('click',async()=>{try{await exportRestsandPdf();}catch(err){console.error(err);alert('Restsand-PDF Fehler');}});
$('btnPdfPh')?.addEventListener('click',async()=>{try{await exportPhPdf();}catch(err){console.error(err);alert('Sulfat/pH-PDF Fehler');}});
$('btnPdfKolben')?.addEventListener('click',async()=>{try{await exportKolbenPdf();}catch(err){console.error(err);alert('Kolben-PDF Fehler');}});
$('btnReset')?.addEventListener('click',resetAll);
$('btnExportTemplate')?.addEventListener('click',exportTemplateJson);
$('btnImportTemplate')?.addEventListener('click',()=>$('importFileInput')?.click());
$('btnExportFull')?.addEventListener('click',exportFullJson);
$('btnImportFull')?.addEventListener('click',()=>$('importFullInput')?.click());
$('importFileInput')?.addEventListener('change',handleTemplateImport);
$('importFullInput')?.addEventListener('change',handleFullImport);
}

/* ── EXPORT / IMPORT JSON ── */
function downloadJson(obj,filename){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function buildTemplateSnapshot(){
  const snap=collectSnapshot();snap.overviewPhotoDataUrl='';
  snap.versuche=(snap.versuche||[]).map(v=>{const hv=hydrateVersuch(v);hv.messungen=(hv.messungen||[]).map(m=>({min:m.min,foerder_m:'',schluck_m:'',foerder_menge:''}));hv.elapsedMs=0;hv.startzeit='';hv.photoDataUrl='';return hv;});
  snap.restsand={imhoff:{photoDataUrl:'',menge:''},sieb:{photoDataUrl:'',menge:''},bemerkung:''};
  snap.ph={datum:'',bauherr:'',baustelle:'',gewaessername:'',sulfat:{wert:'',photoDataUrl:''},temperatur:{wert:'',photoDataUrl:''},leitfaehigkeit:{wert:'',photoDataUrl:''},ph:{wert:'',photoDataUrl:''},combined:{aktiv:false,ph:'',lf:'',temp:'',o2:'',photoDataUrl:''}};
  snap.kolben = {
  durchmesser:'',
  entnahme:'',
  nummer:'',
  brunnenOk:'',
  rows:[
    {huebe:'',aufsandung:'',anmerkungen:''}
  ],
  restsandmessung:''
};
function exportTemplateJson(){const snap=buildTemplateSnapshot();const obj=(snap.meta.objekt||'Vorlage').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');downloadJson(snap,`${dateTag()}_HTB_Vorlage_${obj||'Pumpversuch'}.htbpump.json`);}
function exportFullJson(){const snap=collectSnapshot();const obj=(snap.meta.objekt||'Export').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');downloadJson(snap,`${dateTag()}_HTB_Pumpversuch_${obj||'Export'}.json`);}
async function handleTemplateImport(e){const file=e.target.files&&e.target.files[0];if(!file)return;try{const raw=await file.text();applySnapshot(JSON.parse(raw),true);saveDraftDebounced();alert('Vorlage importiert.');}catch(err){console.error(err);alert('Vorlage konnte nicht importiert werden.');}finally{e.target.value='';}}
async function handleFullImport(e){const file=e.target.files&&e.target.files[0];if(!file)return;try{const raw=await file.text();applySnapshot(JSON.parse(raw),true);saveDraftDebounced();alert('Vollständiger Import erfolgreich.');}catch(err){console.error(err);alert('Datei konnte nicht importiert werden.');}finally{e.target.value='';}}

/* ── LIVE TAB ── */
function buildLiveChartSvg(points,key){
const isLight=state.settings?.theme==='light';
const color=key==='foerder'
?(isLight?'#2f7fb7':'#56b7ff')
:(isLight?'#d6871b':'#ffb45a');

const palette=isLight
?{
bg:'#ffffff',
gridY:'rgba(0,0,0,.12)',
gridX:'rgba(0,0,0,.08)',
plotBorder:'rgba(17,17,17,.18)',
axisText:'#111111',
tickText:'rgba(17,17,17,.72)',
emptyText:'rgba(17,17,17,.55)',
pointStroke:'#111111'
}
:{
bg:'#0b1725',
gridY:'rgba(255,255,255,.12)',
gridX:'rgba(255,255,255,.08)',
plotBorder:'rgba(255,255,255,.18)',
axisText:'#ffffff',
tickText:'rgba(220,240,255,.75)',
emptyText:'rgba(220,240,255,.72)',
pointStroke:'#ffffff'
};

const W=560,H=280,ml=58,mr=18,mt=18,mb=42,pw=W-ml-mr,ph=H-mt-mb;
const xMax=points.length?Math.max(...points.map(p=>p.x)):10;
const yMax=points.length?Math.max(...points.map(p=>p.y)):10;
const xAxis=getNiceAxis(0,xMax>0?xMax:10,6),yAxis=getNiceAxis(0,yMax>0?yMax:10,6);
const xTicks=buildTicks(xAxis),yTicks=buildTicks(yAxis);
const tx=v=>ml+((v-xAxis.min)/(xAxis.max-xAxis.min||1))*pw;
const ty=v=>mt+ph-((v-yAxis.min)/(yAxis.max-yAxis.min||1))*ph;
const gridY=yTicks.map(v=>`<line x1="${ml}" y1="${ty(v)}" x2="${W-mr}" y2="${ty(v)}" stroke="${palette.gridY}" stroke-width="1"/><text x="${ml-8}" y="${ty(v)+4}" text-anchor="end" fill="${palette.tickText}" font-size="11">${h(fmtTick(v,0))}</text>`).join('');
const gridX=xTicks.map(v=>`<line x1="${tx(v)}" y1="${mt}" x2="${tx(v)}" y2="${mt+ph}" stroke="${palette.gridX}" stroke-width="1"/><text x="${tx(v)}" y="${H-16}" text-anchor="middle" fill="${palette.tickText}" font-size="11">${h(fmtTick(v,0))}</text>`).join('');
const poly=points.map(p=>`${tx(p.x)},${ty(p.y)}`).join(' ');
const circles=points.map(p=>`<circle cx="${tx(p.x)}" cy="${ty(p.y)}" r="3.5" fill="${color}" stroke="${palette.pointStroke}" stroke-width="1.2"/>`).join('');
return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="${palette.bg}"/>
${gridY}${gridX}
<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${palette.plotBorder}" stroke-width="1.2"/>
${points.length?`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`:''}
${circles}
<text x="${ml+pw/2}" y="${H-4}" text-anchor="middle" fill="${palette.axisText}" font-size="12" font-weight="700">Zeit [min]</text>
<text x="16" y="${mt+ph/2}" transform="rotate(-90 16 ${mt+ph/2})" text-anchor="middle" fill="${palette.axisText}" font-size="12" font-weight="700">Absenkung [cm]</text>
${!points.length?`<text x="${ml+pw/2}" y="${mt+ph/2}" text-anchor="middle" fill="${palette.emptyText}" font-size="13">Noch keine Messwerte</text>`:''}
</svg>`;
}
function buildLiveWellPanelHtml(versuch,key,brunnen){
  const est=getStageKfEstimate(versuch,key,brunnen);
  const points=getWellChartPoints(versuch,key,brunnen);
  const qClass=est.quality?`kf-quality kf-quality--${est.quality}`:'';
  const qText=est.quality==='gut'?'stabil':est.quality==='mittel'?'mittel':'vorläufig';
  return `<section class="live-well ${key==='foerder'?'live-well--foerder':'live-well--schluck'}">
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
  const host=$('liveContainer');if(!host)return;
  if(!state.versuche.length){host.innerHTML=`<section class="card"><div class="empty-state">Noch keine Pumpstufe vorhanden.</div></section>`;return;}
  const sel=getSelectedWells();
  const single=(sel.foerder?1:0)+(sel.schluck?1:0)===1;
  host.innerHTML=state.versuche.map((v,idx)=>{
    const rateM3h=getCalcRateM3h(v),rateLs=getCalcRateLs(v),rateSource=getCalcRateSource(v);
    return `<section class="card live-stage">
      <div class="live-stage__head">
        <div>
          <div class="live-stage__title">${h(getStageTitle(idx))}</div>
          <div class="live-stage__meta">Rate: <b>${h(rateM3h||'—')} m³/h</b> · <b>${h(rateLs||'—')} l/s</b>${rateSource?` · ${h(rateSource)}`:''}</div>
        </div>
      </div>
      <div class="live-grid ${single?'live-grid--single':''}">
        ${sel.foerder?buildLiveWellPanelHtml(v,'foerder',state.foerder):''}
        ${sel.schluck?buildLiveWellPanelHtml(v,'schluck',state.schluck):''}
      </div>
    </section>`;
  }).join('');
}

/* ── HISTORY ── */
function buildHistoryKfHtml(snapshot){
  const versuche=Array.isArray(snapshot?.versuche)?snapshot.versuche:[];if(!versuche.length)return'';
  const lines=versuche.map((raw,idx)=>{
    const v=hydrateVersuch(raw);const parts=[];
    if(snapshot.selection?.foerder){const e=getStageKfEstimate(v,'foerder',snapshot.foerder||{});parts.push(`Förderbrunnen: ${Number.isFinite(e.kf)?fmtKf(e.kf):'—'}`);}
    if(snapshot.selection?.schluck){const e=getStageKfEstimate(v,'schluck',snapshot.schluck||{});parts.push(`Rückgabe: ${Number.isFinite(e.kf)?fmtKf(e.kf):'—'}`);}
    return `<div class="historyKf__line">${h(`${getStageTitle(idx)} · ${parts.join(' · ')}`)}</div>`;
  });
  return `<div class="historyKf"><div class="historyKf__title">Kf-Abschätzung</div>${lines.join('')}</div>`;
}
function collectSnapshotPhotos(snapshot){
  const photos=[];const obj=(snapshot.meta?.objekt||'Pumpversuch').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_')||'Pumpversuch';
  if(snapshot.overviewPhotoDataUrl)photos.push({name:`${obj}_Uebersicht`,dataUrl:snapshot.overviewPhotoDataUrl});
  (snapshot.versuche||[]).forEach((v,i)=>{if(v.photoDataUrl)photos.push({name:`${obj}_Stufe_${i+1}`,dataUrl:v.photoDataUrl});});
  if(snapshot.restsand?.imhoff?.photoDataUrl)photos.push({name:`${obj}_Restsand_Imhoff`,dataUrl:snapshot.restsand.imhoff.photoDataUrl});
  if(snapshot.restsand?.sieb?.photoDataUrl)photos.push({name:`${obj}_Restsand_Sieb`,dataUrl:snapshot.restsand.sieb.photoDataUrl});
  if(snapshot.ph?.sulfat?.photoDataUrl)photos.push({name:`${obj}_Sulfat`,dataUrl:snapshot.ph.sulfat.photoDataUrl});
  if(snapshot.ph?.temperatur?.photoDataUrl)photos.push({name:`${obj}_Temperatur`,dataUrl:snapshot.ph.temperatur.photoDataUrl});
  if(snapshot.ph?.leitfaehigkeit?.photoDataUrl)photos.push({name:`${obj}_Leitfaehigkeit`,dataUrl:snapshot.ph.leitfaehigkeit.photoDataUrl});
  if(snapshot.ph?.ph?.photoDataUrl)photos.push({name:`${obj}_pH`,dataUrl:snapshot.ph.ph.photoDataUrl});
  if(snapshot.ph?.combined?.photoDataUrl)photos.push({name:`${obj}_pH_LF_T_O2`,dataUrl:snapshot.ph.combined.photoDataUrl});
  return photos;
}
function guessExtFromDataUrl(dataUrl){if(/^data:image\/png/i.test(dataUrl))return'png';if(/^data:image\/webp/i.test(dataUrl))return'webp';return'jpg';}
function downloadDataUrl(dataUrl,filename){const a=document.createElement('a');a.href=dataUrl;a.download=filename;document.body.appendChild(a);a.click();a.remove();}
async function exportPhotosFromSnapshot(snapshot){
  const photos=collectSnapshotPhotos(snapshot);
  if(!photos.length){alert('Keine Fotos vorhanden.');return;}
  for(let i=0;i<photos.length;i++){downloadDataUrl(photos[i].dataUrl,`${photos[i].name}.${guessExtFromDataUrl(photos[i].dataUrl)}`);await new Promise(r=>setTimeout(r,250));}
  alert(`${photos.length} Foto(s) exportiert.`);
}
async function renderHistoryList(){
  const host=$('historyList');if(!host)return;

  let list = [];
  try{
    list = await readHistory();
  }catch(err){
    console.error(err);
    host.innerHTML=`<div class="text"><p>Verlauf konnte nicht geladen werden.</p></div>`;
    return;
  }

  if(!list.length){
    host.innerHTML=`<div class="text"><p>Noch keine Protokolle gespeichert.</p></div>`;
    return;
  }

  host.innerHTML=list.map(entry=>{
    const snap=entry.snapshot||{};
    const count=Array.isArray(snap.versuche)?snap.versuche.length:0;
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
              Imhoff: <b>${h(String(snap.restsand?.imhoff?.menge||'—'))}</b><br>
              Sieb/Gewicht: <b>${h(String(snap.restsand?.sieb?.menge||'—'))}</b>
            </div>
          </details>
          <details class="historySection">
            <summary>pH / Sulfat</summary>
            <div class="historySection__body">
              Sulfat: <b>${h(String(snap.ph?.sulfat?.wert||'—'))}</b><br>
              Temperatur: <b>${h(String(snap.ph?.temperatur?.wert||'—'))}</b><br>
              Leitfähigkeit: <b>${h(String(snap.ph?.leitfaehigkeit?.wert||'—'))}</b><br>
              pH: <b>${h(String(snap.ph?.ph?.wert||'—'))}</b>
            </div>
          </details>
          <details class="historySection">
            <summary>Kolbenentwicklung</summary>
            <div class="historySection__body">
              Durchmesser: <b>${h(String(snap.kolben?.durchmesser||'—'))}</b> mm<br>
              Entnahme: <b>${h(String(snap.kolben?.entnahme||'—'))}</b><br>
              Brunnen OK: <b>${h(String(snap.kolben?.brunnenOk||'—'))}</b>
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
          <button type="button" data-hact="pdf-kolben" data-id="${h(entry.id)}">PDF Kolben</button>
          <button type="button" class="btn--export-photos" data-hact="photos" data-id="${h(entry.id)}">Fotos exportieren</button>
          <button type="button" data-hact="del" data-id="${h(entry.id)}">Löschen</button>
        </div>
      </div>
    </details>`;
  }).join('');
}
function hookHistoryDelegation(){
  const host=$('historyList');if(!host||host.dataset.bound==='1')return;
  host.dataset.bound='1';

  host.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-hact]');if(!btn)return;
    const id=btn.dataset.id,act=btn.dataset.hact;

    try{
      if(act==='del'){
        await deleteHistoryEntryById(id);
        renderHistoryList();
        return;
      }

      const entry = await getHistoryEntryById(id);
      if(!entry) return;

      const fullSnapshot = await materializeSnapshotPhotos(entry.snapshot);

      if(act==='load'){
        applySnapshot(fullSnapshot,true);
        saveDraftDebounced();
        document.querySelector('.tab[data-tab="protokoll"]')?.click();
        return;
      }

      if(act==='pdf-protokoll'){
        await exportPdf(fullSnapshot,'protokoll');
        return;
      }

      if(act==='pdf-voll'){
        await exportPdf(fullSnapshot,'vollstaendig');
        return;
      }

      if(act==='pdf-restsand'){
        await exportRestsandPdf(fullSnapshot);
        return;
      }

      if(act==='pdf-ph'){
        await exportPhPdf(fullSnapshot);
        return;
      }

      if(act==='pdf-kolben'){
        await exportKolbenPdf(fullSnapshot);
        return;
      }

      if(act==='photos'){
        await exportPhotosFromSnapshot(fullSnapshot);
        return;
      }
    }catch(err){
      console.error(err);

      if(act==='pdf-restsand') alert('Restsand-PDF Fehler');
      else if(act==='pdf-ph') alert('Sulfat-PDF Fehler');
      else if(act==='pdf-kolben') alert('Kolben-PDF Fehler');
      else if(act==='photos') alert('Fotoexport fehlgeschlagen.');
      else if(act?.startsWith('pdf-')) alert('PDF-Fehler');
      else alert('Verlaufseintrag konnte nicht verarbeitet werden.');
    }
  });
}

/* ── PDF HELPERS ── */
function drawTextSafe(page,text,options){page.drawText(pdfSafe(text),options);}

async function loadPdfAssets(pdf){
  const fontkit = window.fontkit || window.PDFLibFontkit;
  if(!fontkit) throw new Error('fontkit nicht geladen');
  pdf.registerFontkit(fontkit);

  const fontBytesR = await fetch(`${BASE}fonts/arial.ttf?v=60`).then(r=>r.arrayBuffer());
  let fontBytesB = null;
  try{ fontBytesB = await fetch(`${BASE}fonts/arialbd.ttf?v=60`).then(r=>r.arrayBuffer()); }catch{}

  const fontR = await pdf.embedFont(fontBytesR,{subset:true});
  const fontB = fontBytesB ? await pdf.embedFont(fontBytesB,{subset:true}) : fontR;

  let logo = null;
  try{
    const b = await fetch(`${BASE}logo.png?v=60`).then(r=>r.arrayBuffer());
    logo = await pdf.embedPng(b);
  }catch{}

  let coverPhoto = null;
  try{
    const b = await fetch(`${BASE}cover-photo.jpg?v=1`).then(r=>r.arrayBuffer());
    coverPhoto = await pdf.embedJpg(b);
  }catch{}

  // NEU: Fußzeile.png laden
  let fusszeile = null;
  try{
    const b = await fetch(`${BASE}Fu%C3%9Fzeile.png?v=1`).then(r=>r.arrayBuffer());
    fusszeile = await pdf.embedPng(b);
  }catch{
    try{
      const b = await fetch(`${BASE}Fusszeile.png?v=1`).then(r=>r.arrayBuffer());
      fusszeile = await pdf.embedPng(b);
    }catch{}
  }

  return { fontR, fontB, logo, coverPhoto, fusszeile };
}
function getPdfCtx(PDFLib,assets){
  const{rgb,degrees}=PDFLib;
  const PAGE_W=595.28,PAGE_H=841.89,mm=v=>v*72/25.4,K=rgb(0,0,0),GREY=rgb(0.90,0.90,0.90);
  return{PAGE_W,PAGE_H,mm,K,GREY,rgb,degrees,...assets};
}
function getPdfRateM3hNumber(v){const m=Number(v?.manualRateM3h);if(Number.isFinite(m)&&m>0)return m;const a=getAverageFoerderMengeNumber(v);if(Number.isFinite(a)&&a>0)return a;return NaN;}
function getPdfRateM3h(v){const n=getPdfRateM3hNumber(v);return Number.isFinite(n)?n.toFixed(3):'—';}
function getPdfRateLs(v){const n=getPdfRateM3hNumber(v);return Number.isFinite(n)?(n/3.6).toFixed(3):'—';}
function getWellRowsForPdf(versuch,key,ruhe){
  const field=key==='foerder'?'foerder_m':'schluck_m';const ruheNum=Number(ruhe);
  return getRowsForExport(versuch).map(r=>{
    const min=Number(r.min),raw=r[field];
    const hasValue=String(raw??'').trim()!==''&&Number.isFinite(Number(raw));
    const valueNum=hasValue?Number(raw):null;
    const deltaM=(hasValue&&Number.isFinite(ruheNum))?Math.abs(valueNum-ruheNum):null;
    const deltaCm=deltaM!==null?deltaM*100:null;
    return{min:Number.isFinite(min)?min:null,valueNum,deltaM,deltaCm};
  });
}
function getFooterTextSingleLine(meta, subtitle=''){
  const filial = getFilialeData(meta?.filiale);
  return `${FIRMA.name} · ${filial.tel} · ${filial.email} · ${filial.web} · ${filial.adresse}${subtitle ? ' · ' + subtitle : ''}`;
}
function getFooterFontSize(font, text, maxW, startSize = 6.4, minSize = 4.6){
  let size = startSize;
  const safeText = pdfSafe(text);
  while(size > minSize && font.widthOfTextAtSize(safeText, size) > maxW){
    size -= 0.2;
  }
  return size;
}

function drawFooter(page, ctx, subtitle=''){
  const { PAGE_W, mm, fontR, K, currentMeta } = ctx;
  const x = mm(12);
  const maxW = PAGE_W - x - mm(12);
  const text = getFooterTextSingleLine(currentMeta || {}, subtitle);
  const size = getFooterFontSize(fontR, text, maxW, 6.4, 4.6);
  drawTextSafe(page, text, { x, y: mm(8.8), size, font: fontR, color: K });
}
function drawHeaderBar(page,ctx,title,sub=''){
  const{mm,fontR,fontB,K,GREY,logo,PAGE_W,PAGE_H}=ctx;
  const margin=mm(8),W=PAGE_W-2*margin,H=PAGE_H-2*margin,hdrH=mm(13);
  page.drawRectangle({x:margin,y:margin+H-hdrH,width:W,height:hdrH,color:GREY,borderColor:K,borderWidth:0.8});
  if(logo){const lh=hdrH*0.75,scale=lh/logo.height;page.drawImage(logo,{x:margin+mm(2),y:margin+H-hdrH+(hdrH-lh)/2,width:logo.width*scale,height:lh});}
  drawTextSafe(page,title,{x:margin+mm(32),y:margin+H-hdrH+mm(4.2),size:13,font:fontB,color:K});
  if(sub)drawTextSafe(page,sub,{x:margin+mm(32),y:margin+H-hdrH+mm(1.5),size:8,font:fontR,color:K});
}
function drawMetaGrid(page,x,yTop,w,rowH,meta,fontR,fontB,K){
  const rows=[
    [['Objekt',meta.objekt||''],['Geprüft durch',meta.geprueftDurch||''],['Straße',meta.grundstueck||''],['Geprüft am',dateDE(meta.geprueftAm)||'']],
    [['Ort',meta.ort||''],['Geologie',meta.geologie||''],['Auftragsnummer',meta.auftragsnummer||''],['Auftraggeber',meta.auftraggeber||'']],
    [['Bohrmeister',meta.bohrmeister||''],['Bauleitung',meta.bauleitung||''],['Koordination',meta.koordination||''],['','']]
  ];
  rows.forEach((row,rIdx)=>{
    const y=yTop-rowH*(rIdx+1);
    page.drawRectangle({x,y,width:w,height:rowH,borderColor:K,borderWidth:0.7});
    const cw=w/4;
    for(let i=1;i<4;i++)page.drawLine({start:{x:x+i*cw,y},end:{x:x+i*cw,y:y+rowH},thickness:0.7,color:K});
    row.forEach((cell,i)=>{const cx=x+i*cw+4;if(cell[0])drawTextSafe(page,cell[0],{x:cx,y:y+rowH-10,size:7,font:fontB,color:K});if(cell[1])drawTextSafe(page,cell[1],{x:cx,y:y+4,size:8,font:fontR,color:K});});
  });
}
function drawWellTable(page,opt){
  const{x,yTop,w,key,rows,fontR,fontB,K,grey}=opt;
  const titleH=13,headH=15,rowH=8.2,totalH=titleH+headH+rows.length*rowH;
  page.drawRectangle({x,y:yTop-titleH,width:w,height:titleH,color:grey,borderColor:K,borderWidth:0.7});
  drawTextSafe(page,getWellLabel(key),{x:x+4,y:yTop-titleH+3.8,size:7.8,font:fontB,color:K});
  const yHead=yTop-titleH-headH;
  page.drawRectangle({x,y:yHead,width:w,height:headH,borderColor:K,borderWidth:0.7});
  const colWidths=[0.18,0.42,0.40];const xs=[x];colWidths.forEach(cw=>xs.push(xs[xs.length-1]+w*cw));
  for(let i=1;i<xs.length-1;i++)page.drawLine({start:{x:xs[i],y:yTop-totalH},end:{x:xs[i],y:yTop-titleH},thickness:0.6,color:K});
  drawTextSafe(page,'Min',{x:xs[0]+3,y:yHead+5,size:6.8,font:fontB,color:K});
  drawTextSafe(page,'m ab OK Brunnen',{x:xs[1]+3,y:yHead+5,size:6.8,font:fontB,color:K});
  drawTextSafe(page,'Δ Ruhewasser [m]',{x:xs[2]+3,y:yHead+5,size:6.8,font:fontB,color:K});
  let y=yHead;
  rows.forEach(r=>{
    const nextY=y-rowH;
    page.drawLine({start:{x,y:nextY},end:{x:x+w,y:nextY},thickness:0.6,color:K});
    drawTextSafe(page,Number.isFinite(r.min)?String(r.min):'—',{x:xs[0]+3,y:nextY+2.4,size:6.7,font:fontR,color:K});
    drawTextSafe(page,r.valueNum!==null?fmtComma(r.valueNum,3):'—',{x:xs[1]+3,y:nextY+2.4,size:6.7,font:fontR,color:K});
    drawTextSafe(page,r.deltaM!==null?fmtComma(r.deltaM,3):'—',{x:xs[2]+3,y:nextY+2.4,size:6.7,font:fontR,color:K});
    y=nextY;
  });
  page.drawRectangle({x,y:yTop-totalH,width:w,height:totalH,borderColor:K,borderWidth:0.7});
  return totalH;
}
function drawWellChart(page,opt){
  const{x,y,w,h,key,rows,fontR,fontB,K,grey,degrees,gridColor,lineColor}=opt;
  page.drawRectangle({x,y,width:w,height:h,borderColor:K,borderWidth:0.7});
  page.drawRectangle({x,y:y+h-13,width:w,height:13,color:grey,borderColor:K,borderWidth:0.7});
  drawTextSafe(page,`Diagramm ${getWellLabel(key)}`,{x:x+4,y:y+h-9,size:7.6,font:fontB,color:K});
  const plotPadL=42,plotPadR=10,plotPadT=40,plotPadB=12;
  const px=x+plotPadL,py=y+plotPadB,pw=w-plotPadL-plotPadR,ph=h-plotPadT-plotPadB,plotTop=py+ph;
  const valid=rows.filter(r=>Number.isFinite(r.min)&&Number.isFinite(r.deltaCm));
  const maxX=valid.length?Math.max(...valid.map(p=>p.min)):10;
  const maxY=valid.length?Math.max(...valid.map(p=>p.deltaCm)):10;
  const xAxis=getNiceAxis(0,maxX>0?maxX:10,6),yAxis=getNiceAxis(0,maxY>0?maxY:10,6);
  const xTicks=buildTicks(xAxis),yTicks=buildTicks(yAxis);
  const tx=v=>px+((v-xAxis.min)/(xAxis.max-xAxis.min||1))*pw;
  const ty=v=>py+((v-yAxis.min)/(yAxis.max-yAxis.min||1))*ph;
  yTicks.forEach(v=>{const yy=ty(v);page.drawLine({start:{x:px,y:yy},end:{x:px+pw,y:yy},thickness:0.5,color:gridColor});drawTextSafe(page,fmtTick(v,0),{x:px-22,y:yy-2,size:6.2,font:fontR,color:K});});
  xTicks.forEach(v=>{const xx=tx(v);page.drawLine({start:{x:xx,y:py},end:{x:xx,y:py+ph},thickness:0.5,color:gridColor});drawTextSafe(page,fmtTick(v,0),{x:xx-6,y:plotTop+4,size:6.2,font:fontR,color:K});});
  page.drawRectangle({x:px,y:py,width:pw,height:ph,borderColor:K,borderWidth:0.7});
  drawTextSafe(page,'Zeit [min]',{x:px+pw/2-18,y:plotTop+16,size:6.8,font:fontB,color:K});
  drawTextSafe(page,'Absenkung [cm]',{x:x+10,y:py+ph/2-22,size:6.8,font:fontB,color:K,rotate:degrees(90)});
  if(!valid.length){drawTextSafe(page,'Noch keine Messwerte',{x:px+pw/2-28,y:py+ph/2,size:7,font:fontR,color:K});return;}
  for(let i=0;i<valid.length-1;i++){const a=valid[i],b=valid[i+1];page.drawLine({start:{x:tx(a.min),y:ty(a.deltaCm)},end:{x:tx(b.min),y:ty(b.deltaCm)},thickness:1.3,color:lineColor});}
  valid.forEach(p=>page.drawCircle({x:tx(p.min),y:ty(p.deltaCm),size:2.1,color:lineColor,borderColor:K,borderWidth:0.3}));
}
function drawStageSplitLayout(page,opt){
  const{x,yTop,yBottom,w,versuch,foerder,schluck,fontR,fontB,K,grey,degrees,rgb,selection}=opt;
  const stageH=22;
  page.drawRectangle({x,y:yTop-stageH,width:w,height:stageH,color:grey,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Pumpversuch   ${versuch._stageTitle||'Stufe'}   ${getPdfRateLs(versuch)} [l/s]`,{x:x+4,y:yTop-stageH+11,size:8.5,font:fontB,color:K});
  drawTextSafe(page,`${getPdfRateM3h(versuch)} [m³/h]`,{x:x+4,y:yTop-stageH+4,size:7.5,font:fontR,color:K});
  const keys=['foerder','schluck'].filter(k=>selection[k]);if(!keys.length)return;
  const gap=10,colW=keys.length>1?(w-gap)/2:w,contentTop=yTop-stageH-6;
  keys.forEach((key,i)=>{
    const well=key==='foerder'?foerder:schluck;
    const rows=getWellRowsForPdf(versuch,key,well?.ruhe);
    const colX=x+i*(colW+gap),tableTop=contentTop;
    const tableH=drawWellTable(page,{x:colX,yTop:tableTop,w:colW,key,rows,fontR,fontB,K,grey});
    const chartY=yBottom,chartH=Math.max(95,tableTop-tableH-6-chartY);
    drawWellChart(page,{x:colX,y:chartY,w:colW,h:chartH,key,rows,fontR,fontB,K,grey,degrees,gridColor:rgb(0.82,0.82,0.82),lineColor:key==='foerder'?rgb(0.16,0.46,0.84):rgb(0.90,0.56,0.16)});
  });
}

async function drawImagePage(pdf,ctx,title,subtitle,dataUrl){
  const{PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY,logo}=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;
  page.drawRectangle({x:x0,y:y0,width:W,height:H,borderColor:K,borderWidth:1.2});
  const hdrH=mm(13);
  page.drawRectangle({x:x0,y:y0+H-hdrH,width:W,height:hdrH,color:GREY,borderColor:K,borderWidth:0.8});
  if(logo){const lh=hdrH*0.75,scale=lh/logo.height;page.drawImage(logo,{x:x0+mm(2),y:y0+H-hdrH+(hdrH-lh)/2,width:logo.width*scale,height:lh});}
  drawTextSafe(page,title,{x:x0+mm(32),y:y0+H-hdrH+mm(4.2),size:13,font:fontB,color:K});
  if(subtitle)drawTextSafe(page,subtitle,{x:x0+mm(32),y:y0+H-hdrH+mm(1.5),size:8,font:fontR,color:K});
  if(dataUrl){
    try{
      const img=await embedDataUrlImage(pdf,dataUrl);
      const areaX=x0+mm(8),areaY=y0+mm(12),areaW=W-mm(16),areaH=H-hdrH-mm(18);
      const ratio=img.width/img.height;let dw=areaW,dh=dw/ratio;
      if(dh>areaH){dh=areaH;dw=dh*ratio;}
      const dx=areaX+(areaW-dw)/2,dy=areaY+(areaH-dh)/2;
      page.drawImage(img,{x:dx,y:dy,width:dw,height:dh});
    }catch(err){console.error(err);drawTextSafe(page,'Bild konnte nicht eingebettet werden.',{x:x0+20,y:y0+H/2,size:10,font:fontR,color:K});}
  }else{
    page.drawRectangle({x:x0+mm(15),y:y0+mm(20),width:W-mm(30),height:H-hdrH-mm(35),borderColor:K,borderWidth:0.8});
    drawTextSafe(page,'Kein Bild vorhanden.',{x:x0+35,y:y0+H/2,size:10,font:fontR,color:K});
  }
  drawFooter(page,ctx,title);
}
/* ── NEU: Fußzeile mit Bild + Text ── */
function drawNewFooterFull(page, ctx, subtitle='') {
  const { PAGE_W, mm, fontR, K, fusszeile, currentMeta } = ctx;

  let imgH = 0;
  if(fusszeile){
    const scale = PAGE_W / fusszeile.width;
    imgH = fusszeile.height * scale;
    page.drawImage(fusszeile, { x: 0, y: 0, width: PAGE_W, height: imgH });
  }

  const x = mm(8);
  const maxW = PAGE_W - x - mm(8);
  const text = getFooterTextSingleLine(currentMeta || {}, subtitle);
  const size = getFooterFontSize(fontR, text, maxW, 6.0, 4.4);

  drawTextSafe(page, text, {
    x,
    y: imgH + mm(3.4),
    size,
    font: fontR,
    color: K
  });

  return imgH + mm(9.5);
}
async function drawCoverPage(pdf, ctx, snap) {
  const { PAGE_W, PAGE_H, mm, fontR, fontB, K, logo, coverPhoto, rgb } = ctx;
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // ── Fußzeile ──
  const footerH       = drawNewFooterFull(page, ctx);
  const contentBottom = footerH;

  // ── Layout-Maße ──
  const margin  = mm(10);
  const leftW   = PAGE_W * 0.52;
  const rightX  = leftW + mm(6);
  const rightW  = PAGE_W - rightX - margin;

  // ════════════════════════════════════════
  // KOPFBEREICH – grauer Balken
  // ════════════════════════════════════════
  const headerH    = mm(38);
  const headerBotY = PAGE_H - margin - headerH;

  // Grauer Hintergrund
page.drawRectangle({
  x: 0, y: headerBotY,
  width: PAGE_W, height: headerH,
  color: rgb(0.82, 0.82, 0.82)
});

// schwarze Linie oberhalb des Headers
page.drawLine({
  start: { x: 0, y: headerBotY + headerH },
  end:   { x: PAGE_W, y: headerBotY + headerH },
  thickness: 1.5,
  color: K
});

  // Logo links
  let logoY = headerBotY + mm(10);
  if (logo) {
    const maxLogoH = headerH - mm(14);
    const scale    = maxLogoH / logo.height;
    const lw       = logo.width  * scale;
    const lh       = logo.height * scale;
    logoY = headerBotY + mm(10);
    page.drawImage(logo, {
      x: margin,
      y: logoY,
      width: lw, height: lh
    });
    // HTB-Name unter Logo
    drawTextSafe(page, 'HTB Baugesellschaft m.b.H.', {
      x: margin,
      y: logoY - mm(5),
      size: 7.5, font: fontR, color: K
    });
  }

  // "Pumpversuch" rechts, einzeilig, schwarz
  drawTextSafe(page, 'Pumpversuch', {
    x: rightX,
    y: headerBotY + (headerH / 2) - mm(4),
    size: 30, font: fontB,
    color: K
  });

  // Trennlinie unter Kopfbereich
  page.drawLine({
    start: { x: 0,      y: headerBotY },
    end:   { x: PAGE_W, y: headerBotY },
    thickness: 1.5, color: K
  });

  // ════════════════════════════════════════
  // RECHTE SPALTE – Cover-Photo (bis Fußzeile)
  // ════════════════════════════════════════
  const photoTop   = headerBotY;
  const photoAreaH = photoTop - contentBottom;

  if (coverPhoto && photoAreaH > 0) {
    const ratio = coverPhoto.width / coverPhoto.height;
    let dw = rightW, dh = dw / ratio;
    if (dh > photoAreaH) { dh = photoAreaH; dw = dh * ratio; }
    page.drawImage(coverPhoto, {
      x: rightX + (rightW - dw) / 2,
      y: contentBottom,
      width: dw, height: dh
    });
  }

  // ════════════════════════════════════════
  // LINKE SPALTE – 5 Felder gleichmäßig verteilt
  // ════════════════════════════════════════

  // Gleicher Abstand links (vom Seitenrand) und rechts (zum Foto)
  const lineLeft  = margin + mm(6);
  const lineRight = rightX - mm(6);
  const lineW     = lineRight - lineLeft;

  const areaTop    = headerBotY - mm(4);
  const areaBottom = contentBottom + mm(4);
  const areaH      = areaTop - areaBottom;

  // Nur diese 5 Felder – Rest entfernt
  const fields = [
    { label: 'Bauvorhaben / Objekt', value: snap.meta?.objekt        || '—', big: false },
    { label: 'Auftraggeber',         value: snap.meta?.auftraggeber   || '—', big: false },
    { label: '',                     value: 'Pumpversuch',                    big: true  },
    { label: 'Geprüft durch',        value: snap.meta?.geprueftDurch  || '—', big: false },
    { label: 'Ort / Datum',          value: `${snap.meta?.ort || '—'}, am ${dateDE(snap.meta?.geprueftAm) || todayDE()}`, big: false },
  ];

  const slotH = areaH / fields.length;

  fields.forEach((field, i) => {
    const slotTop    = areaTop - i * slotH;
    const slotBottom = slotTop - slotH;

    // Vertikale Mitte des Slots für den Text
    const textY = slotBottom + slotH / 2;

    if (field.label) {
      // Kleines Label oben im Slot
      drawTextSafe(page, field.label.toUpperCase(), {
        x: lineLeft,
        y: textY + mm(5),
        size: 7, font: fontR, color: rgb(0.45, 0.45, 0.45)
      });
    }

    // Wert
    drawTextSafe(page, field.value, {
      x: lineLeft,
      y: textY - mm(2),
      size: field.big ? 20 : 12,
      font: fontB, color: K
    });

    // Schwarze Trennlinie unter dem Slot (außer nach dem letzten)
    if (i < fields.length - 1) {
      page.drawLine({
        start: { x: lineLeft,  y: slotBottom },
        end:   { x: lineRight, y: slotBottom },
        thickness: 0.7, color: K
      });
    }
  });
}
async function drawTocPage(pdf, ctx, snap, hasOverview, hasRestsand, hasPh, hasKolben) {
  const { PAGE_W, PAGE_H, mm, fontR, fontB, K, logo, rgb } = ctx;
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // ── Fußzeile ──
  const footerH       = drawNewFooterFull(page, ctx);
  const contentBottom = footerH;

  const margin = mm(10);
  const rightX = PAGE_W * 0.52 + mm(6);   // nur für "Pumpversuch"-Position

  // ════════════════════════════════════════
  // KOPFBEREICH – identisch mit Deckblatt
  // ════════════════════════════════════════
  const headerH    = mm(38);
  const headerBotY = PAGE_H - margin - headerH;

 page.drawRectangle({
  x: 0, y: headerBotY,
  width: PAGE_W, height: headerH,
  color: rgb(0.82, 0.82, 0.82)
});

// schwarze Linie oberhalb des Headers
page.drawLine({
  start: { x: 0, y: headerBotY + headerH },
  end:   { x: PAGE_W, y: headerBotY + headerH },
  thickness: 1.5,
  color: K
});

  if (logo) {
    const maxLogoH = headerH - mm(14);
    const scale    = maxLogoH / logo.height;
    const lw       = logo.width  * scale;
    const lh       = logo.height * scale;
    const logoY    = headerBotY + mm(10);
    page.drawImage(logo, {
      x: margin, y: logoY,
      width: lw, height: lh
    });
    drawTextSafe(page, 'HTB Baugesellschaft m.b.H.', {
      x: margin,
      y: logoY - mm(5),
      size: 7.5, font: fontR, color: K
    });
  }

  drawTextSafe(page, 'Pumpversuch', {
    x: rightX,
    y: headerBotY + (headerH / 2) - mm(4),
    size: 30, font: fontB, color: K
  });

  page.drawLine({
    start: { x: 0,      y: headerBotY },
    end:   { x: PAGE_W, y: headerBotY },
    thickness: 1.5, color: K
  });

  // ════════════════════════════════════════
  // INHALTSVERZEICHNIS – volle Seitenbreite, Text schwarz
  // ════════════════════════════════════════

  // Titel
  drawTextSafe(page, 'Inhaltsverzeichnis', {
    x: margin,
    y: headerBotY - mm(18),
    size: 22, font: fontB, color: K
  });

  // Akzentlinie unter Titel
  page.drawLine({
    start: { x: margin,         y: headerBotY - mm(23) },
    end:   { x: margin + mm(75), y: headerBotY - mm(23) },
    thickness: 1.5, color: K
  });

  // TOC-Einträge aufbauen
  const entries = [];
  let nr = 1;
  entries.push({ nr: String(nr++), title: 'Protokoll Pumpversuch', main: true });
  if (snap.versuche?.length > 1) {
    snap.versuche.forEach((_, i) => {
      entries.push({ nr: `1.${i + 1}`, title: `Stufe ${i + 1}`, main: false });
    });
  }
  if (hasOverview)  entries.push({ nr: String(nr++), title: 'Übersichtsfoto',                    main: true });
  if (hasRestsand)  entries.push({ nr: String(nr++), title: 'Restsandmessung',                   main: true });
  if (hasPh)        entries.push({ nr: String(nr++), title: 'Prüfprotokoll Sulfatmessung / pH',  main: true });
  if (hasKolben)    entries.push({ nr: String(nr++), title: 'Brunnen- / Kolbenentwicklung',       main: true });

  const tocLeft  = margin + mm(4);
  const nrX      = tocLeft;
  const titleX   = tocLeft + mm(14);
  const tocRight = PAGE_W - margin;
  const rowH     = mm(11);
  let y          = headerBotY - mm(34);

  entries.forEach((entry) => {
    // Nummer
    drawTextSafe(page, entry.nr + '.', {
      x: nrX, y: y + mm(2.5),
      size: entry.main ? 12 : 10,
      font: entry.main ? fontB : fontR,
      color: K
    });
    // Titel – schwarz
    drawTextSafe(page, entry.title, {
      x: titleX, y: y + mm(2.5),
      size: entry.main ? 12 : 10,
      font: entry.main ? fontB : fontR,
      color: K
    });

    // Helle Trennlinie
    page.drawLine({
      start: { x: margin,    y: y - mm(1) },
      end:   { x: tocRight,  y: y - mm(1) },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75)
    });

    y -= rowH + (entry.main ? mm(1.5) : 0);
  });
}

async function drawProtocolStagePage(pdf,ctx,snap,versuch,index){
  const{PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY,rgb,degrees}=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;
  page.drawRectangle({x:x0,y:y0,width:W,height:H,borderColor:K,borderWidth:1.2});
  drawHeaderBar(page,ctx,'Pumpversuch',FIRMA.name);
  let cy=y0+H-mm(13)-mm(2);
  const metaRowH=mm(9);
  drawMetaGrid(page,x0,cy,W,metaRowH,snap.meta||{},fontR,fontB,K);
  cy-=metaRowH*3;
  const ruheHdrH=10,ruheRowH=13;
  page.drawRectangle({x:x0,y:cy-ruheHdrH,width:W,height:ruheHdrH,color:GREY,borderColor:K,borderWidth:0.7});
  drawTextSafe(page,'Ruhewasserspiegel [m]',{x:x0+4,y:cy-ruheHdrH+2.5,size:7.5,font:fontB,color:K});
  cy-=ruheHdrH;
  const selection=snap.selection||{foerder:true,schluck:false};
  const wellsRW=[];
  if(selection.foerder)wellsRW.push({label:'Förderbrunnen ab OK',value:snap.foerder?.ruhe?fmtComma(snap.foerder.ruhe,3):'—'});
  if(selection.schluck)wellsRW.push({label:'Rückgabebrunnen ab OK',value:snap.schluck?.ruhe?fmtComma(snap.schluck.ruhe,3):'—'});
  page.drawRectangle({x:x0,y:cy-ruheRowH,width:W,height:ruheRowH,borderColor:K,borderWidth:0.7});
  if(wellsRW.length>=1){
    const colW=W/Math.max(wellsRW.length,1);
    wellsRW.forEach((wr,i)=>{
      if(i>0)page.drawLine({start:{x:x0+i*colW,y:cy-ruheRowH},end:{x:x0+i*colW,y:cy},thickness:0.7,color:K});
      drawTextSafe(page,wr.label,{x:x0+i*colW+3,y:cy-ruheRowH+4,size:6.2,font:fontR,color:K});
      drawTextSafe(page,wr.value,{x:x0+i*colW+3+colW*0.6,y:cy-ruheRowH+4,size:7.2,font:fontR,color:K});
    });
  }
  cy-=ruheRowH;
  page.drawRectangle({x:x0,y:cy-metaRowH,width:W,height:metaRowH,color:GREY,borderColor:K,borderWidth:0.7});
  const wellTexts=[];
  if(selection.foerder)wellTexts.push(`Förderbrunnen: Ø ${snap.foerder?.dm||'—'} mm · ET ${snap.foerder?.endteufe||'—'} m`);
  if(selection.schluck)wellTexts.push(`Rückgabebrunnen: Ø ${snap.schluck?.dm||'—'} mm · ET ${snap.schluck?.endteufe||'—'} m`);
  drawTextSafe(page,wellTexts.join('   |   '),{x:x0+4,y:cy-metaRowH+6,size:7.1,font:fontR,color:K});
  cy-=metaRowH+mm(3);
  versuch._stageTitle=getStageTitle(index);
  drawStageSplitLayout(page,{x:x0,yTop:cy,yBottom:y0+mm(9),w:W,versuch,foerder:snap.foerder||{},schluck:snap.schluck||{},fontR,fontB,K,grey:GREY,degrees,rgb,selection});
  drawFooter(page,ctx,'Pumpversuch');
}

async function drawRestsandPage(pdf,ctx,snap){
  const{PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY}=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;
  page.drawRectangle({x:x0,y:y0,width:W,height:H,borderColor:K,borderWidth:1.2});
  drawHeaderBar(page,ctx,'Restsandmessung',FIRMA.name);

  // Info-Balken unter Header
  const infoBarH=mm(10);
  const infoBarY=y0+H-mm(13)-mm(3)-infoBarH;
  page.drawRectangle({x:x0,y:infoBarY,width:W,height:infoBarH,color:GREY,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Objekt: ${snap.meta?.objekt||'—'}   ·   Datum: ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,
    {x:x0+4,y:infoBarY+mm(2.5),size:8.8,font:fontB,color:K});

  // Spalten
  const colGap=mm(6),colW=(W-colGap)/2;
  const contentTop=infoBarY-mm(4);         // Beginn der Spalten (unter Info-Balken + Abstand)
  const contentBottom=y0+mm(14);           // Boden (Platz für Fußzeile innerhalb Rahmen)
  const colH=contentTop-contentBottom;

  const defs=[
    {title:'Imhoff-Trichter',data:snap.restsand?.imhoff,valueLabel:'Menge [ml/l]'},
    {title:'Sieb / Gewicht',  data:snap.restsand?.sieb,  valueLabel:'Menge [g]'}
  ];

  for(let i=0;i<defs.length;i++){
    const cx=x0+i*(colW+colGap);

    // Außenrahmen Spalte
    page.drawRectangle({x:cx,y:contentBottom,width:colW,height:colH,borderColor:K,borderWidth:0.8});

    // Titelbalken oben
    const titleBarH=mm(11);
    page.drawRectangle({x:cx,y:contentTop-titleBarH,width:colW,height:titleBarH,color:GREY,borderColor:K,borderWidth:0.8});
    drawTextSafe(page,defs[i].title,{x:cx+5,y:contentTop-titleBarH+mm(3),size:10,font:fontB,color:K});

    // Foto
    const photoAreaTop=contentTop-titleBarH-mm(2);
    const photoAreaBottom=contentBottom+mm(14);
    const photoUrl=defs[i].data?.photoDataUrl||'';
    if(photoUrl){
      try{
        const img=await embedDataUrlImage(pdf,photoUrl);
        const areaX=cx+mm(3),areaW=colW-mm(6),areaH=photoAreaTop-photoAreaBottom;
        const ratio=img.width/img.height;
        let dw=areaW,dh=dw/ratio;
        if(dh>areaH){dh=areaH;dw=dh*ratio;}
        page.drawImage(img,{x:areaX+(areaW-dw)/2,y:photoAreaBottom+(areaH-dh)/2,width:dw,height:dh});
      }catch(err){console.error(err);}
    }else{
      drawTextSafe(page,'Kein Foto vorhanden.',
        {x:cx+14,y:contentBottom+colH/2,size:10,font:fontR,color:K});
    }

    // Wert-Balken unten
    const valBarH=mm(12);
    page.drawRectangle({x:cx,y:contentBottom,width:colW,height:valBarH,color:GREY,borderColor:K,borderWidth:0.8});
    drawTextSafe(page,`${defs[i].valueLabel}: ${defs[i].data?.menge||'—'}`,
      {x:cx+5,y:contentBottom+mm(3),size:10,font:fontB,color:K});
  }

  if(snap.restsand?.bemerkung){
    drawTextSafe(page,`Bemerkung: ${snap.restsand.bemerkung}`,
      {x:x0+4,y:y0+mm(10),size:8,font:fontR,color:K});
  }

  drawFooter(page,ctx,'Restsandmessung');
}

async function drawPhPage(pdf,ctx,snap){
  const{PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY}=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;
  page.drawRectangle({x:x0,y:y0,width:W,height:H,borderColor:K,borderWidth:1.2});
  drawHeaderBar(page,ctx,'Prüfprotokoll Sulfatmessung Wasser',FIRMA.name);

  const rowH=mm(10);

  // ── Meta-Zeilen ──
  const row1top=y0+H-mm(13)-mm(3);
  page.drawRectangle({x:x0,          y:row1top-rowH,width:W*0.48,height:rowH,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Datum: ${dateDE(snap.ph?.datum)||dateDE(snap.meta?.geprueftAm)||todayDE()}`,
    {x:x0+4,y:row1top-rowH+mm(2.5),size:9,font:fontR,color:K});
  page.drawRectangle({x:x0+W*0.52,  y:row1top-rowH,width:W*0.48,height:rowH,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Bauherr: ${snap.ph?.bauherr||snap.meta?.auftraggeber||'—'}`,
    {x:x0+W*0.52+4,y:row1top-rowH+mm(2.5),size:9,font:fontR,color:K});

  const row2top=row1top-rowH-mm(2);
  page.drawRectangle({x:x0,y:row2top-rowH,width:W,height:rowH,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Baustelle: ${snap.ph?.baustelle||snap.meta?.objekt||'—'}`,
    {x:x0+4,y:row2top-rowH+mm(2.5),size:9,font:fontR,color:K});

  const row3top=row2top-rowH-mm(2);
  page.drawRectangle({x:x0,y:row3top-rowH,width:W,height:rowH,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Gewässername / Entnahmestelle: ${snap.ph?.gewaessername||'—'}`,
    {x:x0+4,y:row3top-rowH+mm(2.5),size:9,font:fontR,color:K});

  // ── Abstand (wird für alle Sektionen gleich verwendet) ──
  const sectionGap=mm(6);

  // ── Messung mittels Teststäbchen ──
  const secBarH=mm(9);
  const secBarTop=row3top-rowH-sectionGap;
  page.drawRectangle({x:x0,y:secBarTop-secBarH,width:W,height:secBarH,color:GREY,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,'Messung mittels Teststäbchen "Quantofix" – Ergebnis nach 120 sec',
    {x:x0+4,y:secBarTop-secBarH+mm(2),size:9,font:fontB,color:K});

  // ── Hauptblock Sulfat ──
  const leftW=W*0.38,rightW=W-leftW-mm(6);
  const blockTop=secBarTop-secBarH-mm(3);
  const blockH=mm(90);
  const blockBottom=blockTop-blockH;

  // Linke Spalte – Foto
  page.drawRectangle({x:x0,y:blockBottom,width:leftW,height:blockH,borderColor:K,borderWidth:0.8});
  if(snap.ph?.sulfat?.photoDataUrl){
    try{
      const img=await embedDataUrlImage(pdf,snap.ph.sulfat.photoDataUrl);
      const areaX=x0+4,areaY=blockBottom+mm(12),areaW=leftW-8,areaH=blockH-mm(24);
      const ratio=img.width/img.height;
      let dw=areaW,dh=dw/ratio;
      if(dh>areaH){dh=areaH;dw=dh*ratio;}
      page.drawImage(img,{x:areaX+(areaW-dw)/2,y:areaY+(areaH-dh)/2,width:dw,height:dh});
    }catch(err){console.error(err);}
  }
  page.drawRectangle({x:x0,y:blockBottom,width:leftW,height:mm(10),color:GREY,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`${snap.ph?.sulfat?.wert||'—'} mg/l SO4(2-)`,
    {x:x0+4,y:blockBottom+mm(2.5),size:10,font:fontB,color:K});

  // ── Rechte Spalte – Grenzwerttabelle ──
  const rx=x0+leftW+mm(6);
  page.drawRectangle({x:rx,y:blockBottom,width:rightW,height:blockH,borderColor:K,borderWidth:0.8});

  // Tabellentitel
  let tY=blockTop-mm(4);
  drawTextSafe(page,'Grenzwerte – Expositionsklassen bei chemischem Angriff',
    {x:rx+4,y:tY,size:7.8,font:fontB,color:K});
  tY-=mm(4);
  drawTextSafe(page,'durch natuerliche Boeden und Grundwasser',
    {x:rx+4,y:tY,size:7.2,font:fontR,color:K});
  tY-=mm(5);

  // Tabelle (5 Spalten)
  const tX=rx+mm(2), tW=rightW-mm(4);
  const cRatios=[0.24,0.20,0.19,0.20,0.17];
  const cXs=[tX];
  cRatios.forEach(r=>cXs.push(cXs[cXs.length-1]+tW*r));

  const hH=mm(14),subH=mm(8),dH=mm(16);

  // Header-Zeile (grau)
  page.drawRectangle({x:tX,y:tY-hH,width:tW,height:hH,color:GREY,borderColor:K,borderWidth:0.5});
  for(let i=1;i<cXs.length-1;i++)
    page.drawLine({start:{x:cXs[i],y:tY-hH},end:{x:cXs[i],y:tY},thickness:0.5,color:K});

  const hdrTxts=[['Chemisches','Merkmal'],['Referenz-','pruefverf.'],['XA1'],['XA2'],['XA3']];
  hdrTxts.forEach((lines,i)=>{
    if(lines.length===2){
      drawTextSafe(page,lines[0],{x:cXs[i]+2,y:tY-mm(5),  size:6.2,font:fontB,color:K});
      drawTextSafe(page,lines[1],{x:cXs[i]+2,y:tY-mm(9.5),size:6.2,font:fontB,color:K});
    }else{
      drawTextSafe(page,lines[0],{x:cXs[i]+2,y:tY-hH/2-2, size:6.5,font:fontB,color:K});
    }
  });

  // Sub-Zeile "Grundwasser" – letzte 3 Spalten gemergt
  const subY=tY-hH;
  page.drawRectangle({x:tX,y:subY-subH,width:tW,height:subH,borderColor:K,borderWidth:0.5});
  page.drawLine({start:{x:cXs[1],y:subY-subH},end:{x:cXs[1],y:subY},thickness:0.5,color:K});
  const gwX=cXs[2], gwW=cXs[5]-cXs[2];
  drawTextSafe(page,'Grundwasser',
    {x:gwX+gwW/2-14,y:subY-subH+mm(1.8),size:7,font:fontB,color:K});

  // Daten-Zeile
  const dataY=subY-subH;
  page.drawRectangle({x:tX,y:dataY-dH,width:tW,height:dH,borderColor:K,borderWidth:0.5});
  for(let i=1;i<cXs.length-1;i++)
    page.drawLine({start:{x:cXs[i],y:dataY-dH},end:{x:cXs[i],y:dataY},thickness:0.5,color:K});

  const dataTxts=[
    ['SO4(2-)','mg/l'],
    ['EN 196-2'],
    ['>= 200 und','<= 600'],
    ['> 600 und','<= 3 000'],
    ['> 3 000 und','<= 6 000']
  ];
  dataTxts.forEach((lines,i)=>{
    if(lines.length===2){
      drawTextSafe(page,lines[0],{x:cXs[i]+2,y:dataY-mm(5),  size:6.2,font:fontR,color:K});
      drawTextSafe(page,lines[1],{x:cXs[i]+2,y:dataY-mm(9.5),size:6.2,font:fontR,color:K});
    }else{
      drawTextSafe(page,lines[0],{x:cXs[i]+2,y:dataY-dH/2-2, size:6.5,font:fontR,color:K});
    }
  });

  // Untertext
  let uY=dataY-dH-mm(5);
  drawTextSafe(page,'Gueltig fuer Anmachwasser (OENORM EN 1008):',
    {x:rx+4,y:uY,size:7.5,font:fontB,color:K});
  uY-=mm(5);
  drawTextSafe(page,'SO4(2-) darf 2 000 mg/l nicht ueberschreiten.',
    {x:rx+4,y:uY,size:7,font:fontR,color:K});

  // ── Temperatur + Leitfähigkeit + pH Blöcke ──
// Gleicher Abstand (sectionGap) wie zwischen Meta-Zeile und Teststäbchen-Balken
const btmBlockGap=sectionGap;
const btmTop=blockBottom-btmBlockGap;
const btmBottom=y0+mm(14);
const btmH=btmTop-btmBottom;

if(snap.ph?.combined?.aktiv || (snap.ph?.combined?.ph || snap.ph?.combined?.lf || snap.ph?.combined?.temp || snap.ph?.combined?.o2)){
  page.drawRectangle({x:x0,y:btmBottom,width:W,height:btmH,borderColor:K,borderWidth:0.8});
  const titleBarH=mm(10);
  page.drawRectangle({x:x0,y:btmTop-titleBarH,width:W,height:titleBarH,color:GREY,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,'Kombinierte Messung (pH / LF / T / O2)',{
    x:x0+4,
    y:btmTop-mm(7),
    size:9,
    font:fontB,
    color:K
  });

  const contentH=btmH-titleBarH;
  const colW=W/2;

  page.drawLine({
    start:{x:x0+colW,y:btmBottom},
    end:{x:x0+colW,y:btmTop-titleBarH},
    thickness:0.8,
    color:K
  });

  const photoUrl=snap.ph?.combined?.photoDataUrl;
  if(photoUrl){
    try{
      const img=await embedDataUrlImage(pdf,photoUrl);
      const aX=x0+4,aY=btmBottom+4,aW=colW-8,aH=contentH-8;
      const ratio=img.width/img.height;
      let dw=aW,dh=dw/ratio;
      if(dh>aH){dh=aH;dw=dh*ratio;}
      page.drawImage(img,{x:aX+(aW-dw)/2,y:aY+(aH-dh)/2,width:dw,height:dh});
    }catch(err){console.error(err);}
  }else{
    drawTextSafe(page,'Kein Foto vorhanden.',{
      x:x0+10,
      y:btmBottom+contentH/2,
      size:9,
      font:fontR,
      color:K
    });
  }

  const textX=x0+colW+mm(5);
  let textY=btmTop-titleBarH-mm(5);
  const rowGap=mm(6.5);

  const values=[
    {label:'pH-Wert:',val:snap.ph?.combined?.ph||'—',unit:''},
    {label:'Leitfähigkeit:',val:snap.ph?.combined?.lf||'—',unit:'µS/cm'},
    {label:'Temperatur:',val:snap.ph?.combined?.temp||'—',unit:'°C'},
    {label:'Sauerstoff O2:',val:snap.ph?.combined?.o2||'—',unit:'mg/l'}
  ];

  values.forEach(v=>{
    drawTextSafe(page,v.label,{x:textX,y:textY,size:8.5,font:fontB,color:K});
    drawTextSafe(page,`${v.val} ${v.unit}`.trim(),{x:textX+mm(32),y:textY,size:8.5,font:fontR,color:K});
    textY-=rowGap;
  });
}else{
  // exakt gedrittelte Breite innerhalb des Rahmens
  const bW=W/3;

  const bottomBlocks=[
    {
      x:x0,
      title:'Temperatur Messung',
      value:`${snap.ph?.temperatur?.wert||'—'} °C`,
      photoDataUrl:snap.ph?.temperatur?.photoDataUrl
    },
    {
      x:x0+bW,
      title:'Leitfähigkeit Messung',
      value:`${snap.ph?.leitfaehigkeit?.wert||'—'} µS/cm`,
      photoDataUrl:snap.ph?.leitfaehigkeit?.photoDataUrl
    },
    {
      x:x0+bW*2,
      title:'pH Messung',
      value:`${snap.ph?.ph?.wert||'—'} pH`,
      photoDataUrl:snap.ph?.ph?.photoDataUrl
    }
  ];

  for(const block of bottomBlocks){
    page.drawRectangle({x:block.x,y:btmBottom,width:bW,height:btmH,borderColor:K,borderWidth:0.8});
    page.drawRectangle({x:block.x,y:btmTop-mm(11),width:bW,height:mm(11),color:GREY,borderColor:K,borderWidth:0.8});

    drawTextSafe(page,block.title,{
      x:block.x+4,
      y:btmTop-mm(8),
      size:9,
      font:fontB,
      color:K
    });

    if(block.photoDataUrl){
      try{
        const img=await embedDataUrlImage(pdf,block.photoDataUrl);
        const aX=block.x+4,aY=btmBottom+mm(12),aW=bW-8,aH=btmH-mm(25);
        const ratio=img.width/img.height;
        let dw=aW,dh=dw/ratio;
        if(dh>aH){dh=aH;dw=dh*ratio;}
        page.drawImage(img,{x:aX+(aW-dw)/2,y:aY+(aH-dh)/2,width:dw,height:dh});
      }catch(err){console.error(err);}
    }

    page.drawRectangle({x:block.x,y:btmBottom,width:bW,height:mm(10),color:GREY,borderColor:K,borderWidth:0.8});
    drawTextSafe(page,block.value,{
      x:block.x+4,
      y:btmBottom+mm(2.5),
      size:9,
      font:fontB,
      color:K
    });
  }
}

  drawFooter(page,ctx,'Sulfatmessung Wasser');
}

async function drawKolbenPage(pdf,ctx,snap){
  const{PAGE_W,PAGE_H,mm,fontR,fontB,K,GREY}=ctx;
  const page=pdf.addPage([PAGE_W,PAGE_H]);
  const margin=mm(8),x0=margin,y0=margin,W=PAGE_W-2*margin,H=PAGE_H-2*margin;
  page.drawRectangle({x:x0,y:y0,width:W,height:H,borderColor:K,borderWidth:1.2});
  drawHeaderBar(page,ctx,'Brunnen- / Kolbenentwicklung',FIRMA.name);

  const metaRowH=mm(9);
  const cy=y0+H-mm(13)-mm(3);
  drawMetaGrid(page,x0,cy,W,metaRowH,snap.meta||{},fontR,fontB,K);

  const kolbenMetaTop=cy-metaRowH*3-mm(3);
  const kolbenMetaH=mm(14);
  const kolbenMetaY=kolbenMetaTop-kolbenMetaH;

  page.drawRectangle({x:x0,y:kolbenMetaY,width:W,height:kolbenMetaH,borderColor:K,borderWidth:0.8});

  const colW=W/4;
  for(let i=1;i<4;i++){
    page.drawLine({start:{x:x0+i*colW,y:kolbenMetaY},end:{x:x0+i*colW,y:kolbenMetaY+kolbenMetaH},thickness:0.8,color:K});
  }

  const kolben=snap.kolben||{};

  drawTextSafe(page,'Ausbaudurchmesser [mm]',{x:x0+4,y:kolbenMetaY+mm(8.5),size:7.2,font:fontB,color:K});
  drawTextSafe(page,String(kolben.durchmesser||'—'),{x:x0+4,y:kolbenMetaY+mm(3),size:9,font:fontR,color:K});

  drawTextSafe(page,'Entnahme',{x:x0+colW+4,y:kolbenMetaY+mm(8.5),size:7.2,font:fontB,color:K});
  drawTextSafe(page,String(kolben.entnahme||'—'),{x:x0+colW+4,y:kolbenMetaY+mm(3),size:9,font:fontR,color:K});

  drawTextSafe(page,'Nummer',{x:x0+colW*2+4,y:kolbenMetaY+mm(8.5),size:7.2,font:fontB,color:K});
  drawTextSafe(page,String(kolben.nummer||'—'),{x:x0+colW*2+4,y:kolbenMetaY+mm(3),size:9,font:fontR,color:K});

  drawTextSafe(page,'Brunnen OK',{x:x0+colW*3+4,y:kolbenMetaY+mm(8.5),size:7.2,font:fontB,color:K});
  drawTextSafe(page,String(kolben.brunnenOk||'—'),{x:x0+colW*3+4,y:kolbenMetaY+mm(3),size:9,font:fontR,color:K});

const tableTop = kolbenMetaY - mm(4);
const tableHeaderH = mm(8);

const allRows = Array.isArray(kolben.rows)
  ? kolben.rows.filter(r => r.huebe || r.aufsandung || r.anmerkungen)
  : [];

const rowsToDraw = allRows.length
  ? allRows
  : [{huebe:'',aufsandung:'',anmerkungen:''}];

const maxTableBottom = y0 + mm(54);
const minRowH = mm(5.2);
const maxRowH = mm(7.2);
const availableRowsH = tableTop - maxTableBottom - tableHeaderH;

const rowHeight = Math.max(
  minRowH,
  Math.min(maxRowH, availableRowsH / Math.max(1, rowsToDraw.length))
);

const tableH = tableHeaderH + rowHeight * rowsToDraw.length;
const tableBottom = tableTop - tableH;

page.drawRectangle({
  x:x0,
  y:tableBottom,
  width:W,
  height:tableH,
  borderColor:K,
  borderWidth:0.8
});

page.drawRectangle({
  x:x0,
  y:tableTop - tableHeaderH,
  width:W,
  height:tableHeaderH,
  color:GREY,
  borderColor:K,
  borderWidth:0.8
});

const w1 = W * 0.30;
const w2 = W * 0.30;
const w3 = W * 0.40;

const c1 = x0;
const c2 = c1 + w1;
const c3 = c2 + w2;

page.drawLine({
  start:{x:c2,y:tableBottom},
  end:{x:c2,y:tableTop},
  thickness:0.8,
  color:K
});

page.drawLine({
  start:{x:c3,y:tableBottom},
  end:{x:c3,y:tableTop},
  thickness:0.8,
  color:K
});

drawTextSafe(page,'Anzahl Kolbenhübe',{
  x:c1 + mm(2),
  y:tableTop - tableHeaderH + mm(2.5),
  size:8,
  font:fontB,
  color:K
});

drawTextSafe(page,'Aufsandung [cm]',{
  x:c2 + mm(2),
  y:tableTop - tableHeaderH + mm(2.5),
  size:8,
  font:fontB,
  color:K
});

drawTextSafe(page,'Anmerkungen',{
  x:c3 + mm(2),
  y:tableTop - tableHeaderH + mm(2.5),
  size:8,
  font:fontB,
  color:K
});

rowsToDraw.forEach((rData, i) => {
  const yRowTop = tableTop - tableHeaderH - rowHeight * i;
  const yRowBottom = yRowTop - rowHeight;

  if(i > 0){
    page.drawLine({
      start:{x:x0,y:yRowTop},
      end:{x:x0 + W,y:yRowTop},
      thickness:0.5,
      color:K
    });
  }

  drawTextSafe(page,String(rData.huebe || ''),{
    x:c1 + mm(3),
    y:yRowBottom + mm(1.8),
    size:8,
    font:fontR,
    color:K
  });

  drawTextSafe(page,String(rData.aufsandung || ''),{
    x:c2 + mm(3),
    y:yRowBottom + mm(1.8),
    size:8,
    font:fontR,
    color:K
  });

  drawTextSafe(page,String(rData.anmerkungen || ''),{
    x:c3 + mm(3),
    y:yRowBottom + mm(1.8),
    size:8,
    font:fontR,
    color:K
  });
});

  const restsandY=tableBottom-mm(3)-mm(10);
  page.drawRectangle({x:x0,y:restsandY,width:W,height:mm(10),borderColor:K,borderWidth:0.8});
  drawTextSafe(page,`Restsandmessung (gefordert < 1,0 g/m³):   ${kolben.restsandmessung||'—'} g/m³`,{
    x:x0+mm(3),
    y:restsandY+mm(3.2),
    size:9,
    font:fontB,
    color:K
  });

  const sigY=restsandY-mm(4)-mm(16);
  page.drawRectangle({x:x0+W-mm(60),y:sigY,width:mm(60),height:mm(16),borderColor:K,borderWidth:0.8});
  page.drawRectangle({x:x0+W-mm(60),y:sigY+mm(12),width:mm(60),height:mm(4),color:GREY,borderColor:K,borderWidth:0.8});
  drawTextSafe(page,'Auswertung HTB: Datum, Unterschrift',{
    x:x0+W-mm(60)+mm(2),
    y:sigY+mm(13),
    size:6.5,
    font:fontB,
    color:K
  });

  drawFooter(page,ctx,'Kolbenentwicklung');
}

async function exportKolbenPdf(snapshot=null){
  if(!snapshot && !ensureRequiredFiliale()) return;

  const snap=snapshot||collectSnapshot();
  if(!window.PDFLib){alert('PDF-Library noch nicht geladen.');return;}

  const{PDFDocument}=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  ctx.currentMeta = snap.meta || {};

  await drawKolbenPage(pdf,ctx,snap);

  const bytes=await pdf.save();
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Kolbenentwicklung').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const w=window.open(url,'_blank');
  if(!w){
    const a=document.createElement('a');
    a.href=url;
    a.download=`${dateTag()}_HTB_Kolbenprotokoll_${obj||'Dokument'}.pdf`;
    a.click();
  }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
/* ── PDF EXPORTS ── */
function addFullPdfPageNumbers(pdf, ctx){
  const { PAGE_W, mm, fontB, K } = ctx;
  const pages = pdf.getPages();

  // physische Seiten 1-2 = ohne Nummer
  // ab physischer Seite 3 beginnt Nummerierung mit 1
  for(let i = 2; i < pages.length; i++){
    const page = pages[i];
    const label = String(i - 1);
    const size = 8.5;
    const w = fontB.widthOfTextAtSize(label, size);

    drawTextSafe(page, label, {
      x: PAGE_W - mm(12) - w,
      y: mm(13.2),
      size,
      font: fontB,
      color: K
    });
  }
}
async function exportPdf(snapshot=null,type='protokoll'){
  if(!snapshot && !ensureRequiredFiliale()) return;

  const snap=snapshot||collectSnapshot();
  if(!window.PDFLib){alert('PDF-Library noch nicht geladen.');return;}

  const versuche=(snap.versuche||[]).map(v=>hydrateVersuch(v));
  if(!versuche.length){alert('Es ist noch keine Pumpstufe vorhanden.');return;}

  const{PDFDocument}=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  ctx.currentMeta = snap.meta || {};

  if(type==='vollstaendig'){
       const hasOverview=!!snap.overviewPhotoDataUrl;
    const hasRestsand=!!(
      snap.restsand?.imhoff?.photoDataUrl ||
      snap.restsand?.sieb?.photoDataUrl ||
      snap.restsand?.imhoff?.menge ||
      snap.restsand?.sieb?.menge ||
      snap.restsand?.bemerkung
    );
    const hasPh=!!(
      snap.ph?.sulfat?.wert ||
      snap.ph?.temperatur?.wert ||
      snap.ph?.leitfaehigkeit?.wert ||
      snap.ph?.ph?.wert ||
      snap.ph?.sulfat?.photoDataUrl ||
      snap.ph?.temperatur?.photoDataUrl ||
      snap.ph?.leitfaehigkeit?.photoDataUrl ||
      snap.ph?.ph?.photoDataUrl ||
      snap.ph?.combined?.ph ||
      snap.ph?.combined?.lf ||
      snap.ph?.combined?.temp ||
      snap.ph?.combined?.o2 ||
      snap.ph?.combined?.photoDataUrl
    );
    const hasKolben=!!(
      snap.kolben?.durchmesser ||
      snap.kolben?.entnahme ||
      snap.kolben?.nummer ||
      snap.kolben?.brunnenOk ||
      snap.kolben?.restsandmessung ||
      (snap.kolben?.rows || []).some(r=>r.huebe || r.aufsandung || r.anmerkungen)
    );

    await drawCoverPage(pdf,ctx,snap);
    await drawTocPage(pdf,ctx,snap,hasOverview,hasRestsand,hasPh,hasKolben);

    for(let i=0;i<versuche.length;i++){
      await drawProtocolStagePage(pdf,ctx,snap,versuche[i],i);

      if(versuche[i].photoDataUrl){
        await drawImagePage(
          pdf,
          ctx,
          `Foto Durchflussmesser ${getStageTitle(i)}`,
          `${snap.meta?.objekt||''} · ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,
          versuche[i].photoDataUrl
        );
      }
    }

    if(hasOverview){
      const title=`Übersicht ${snap.meta?.objekt||''} am ${dateDE(snap.meta?.geprueftAm)||todayDE()}`.replace(/\s+/g,' ').trim();
      await drawImagePage(pdf,ctx,title,'Übersichtsfoto',snap.overviewPhotoDataUrl);
    }

    if(hasRestsand) await drawRestsandPage(pdf,ctx,snap);
    if(hasPh) await drawPhPage(pdf,ctx,snap);
    if(hasKolben) await drawKolbenPage(pdf,ctx,snap);

    addFullPdfPageNumbers(pdf, ctx);
  }else{
    for(let i=0;i<versuche.length;i++){
      await drawProtocolStagePage(pdf,ctx,snap,versuche[i],i);

      // NEU: Beweisfoto auch im normalen Protokoll-PDF ausgeben
      if(versuche[i].photoDataUrl){
        await drawImagePage(
          pdf,
          ctx,
          `Foto Durchflussmesser ${getStageTitle(i)}`,
          `${snap.meta?.objekt||''} · ${dateDE(snap.meta?.geprueftAm)||todayDE()}`,
          versuche[i].photoDataUrl
        );
      }
    }
  }

  const bytes=await pdf.save();
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Pumpversuch').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const suffix=type==='vollstaendig'?'Vollauswertung':'Protokoll';
  const fileName=`${dateTag()}_HTB_Pumpversuch_${suffix}_${obj||'Dokument'}.pdf`;
  const w=window.open(url,'_blank');
  if(!w){const a=document.createElement('a');a.href=url;a.download=fileName;a.click();}
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function exportRestsandPdf(snapshot=null){
  if(!snapshot && !ensureRequiredFiliale()) return;

  const snap=snapshot||collectSnapshot();
  if(!window.PDFLib){alert('PDF-Library noch nicht geladen.');return;}

  const{PDFDocument}=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  ctx.currentMeta = snap.meta || {};

  await drawRestsandPage(pdf,ctx,snap);

  const bytes=await pdf.save();
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Restsand').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const w=window.open(url,'_blank');
  if(!w){
    const a=document.createElement('a');
    a.href=url;
    a.download=`${dateTag()}_HTB_Restsandprotokoll_${obj||'Dokument'}.pdf`;
    a.click();
  }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

async function exportPhPdf(snapshot=null){
  if(!snapshot && !ensureRequiredFiliale()) return;

  const snap=snapshot||collectSnapshot();
  if(!window.PDFLib){alert('PDF-Library noch nicht geladen.');return;}

  const{PDFDocument}=window.PDFLib;
  const pdf=await PDFDocument.create();
  const assets=await loadPdfAssets(pdf);
  const ctx=getPdfCtx(window.PDFLib,assets);
  ctx.currentMeta = snap.meta || {};

  await drawPhPage(pdf,ctx,snap);

  const bytes=await pdf.save();
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const obj=(snap.meta?.objekt||'Sulfatmessung').replace(/[^\wäöüÄÖÜß\- ]+/g,'').trim().replace(/\s+/g,'_');
  const w=window.open(url,'_blank');
  if(!w){
    const a=document.createElement('a');
    a.href=url;
    a.download=`${dateTag()}_HTB_Sulfatprotokoll_${obj||'Dokument'}.pdf`;
    a.click();
  }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
/* ── RESET / INSTALL ── */
function resetAll(){
  if(!confirm('Alle Eingaben wirklich zurücksetzen?'))return;
  Object.keys(timerMap).forEach(hardStopTimer);
  const base=getInitialState();
  state.meta=clone(base.meta);state.selection=clone(base.selection);
  state.foerder=clone(base.foerder);state.schluck=clone(base.schluck);
  state.overviewPhotoDataUrl='';state.versuche=[];
  state.restsand=clone(base.restsand);state.ph=clone(base.ph);state.kolben=clone(base.kolben);state.settings=clone(base.settings);
  syncMetaToUi();syncBrunnenToUi();syncSelectionToUi();renderOverviewPhotoThumb();
  syncRestsandToUi();syncPhToUi();renderKolbenRows();syncKolbenToUi();syncSettingsToUi();renderVersuche();renderLiveTab();saveDraftDebounced();
}

function initInstallButton(){
  let installPrompt=null;
  const btn=$('btnInstall');
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(btn)btn.hidden=false;});
  btn?.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;btn.hidden=true;});
  window.addEventListener('appinstalled',()=>{installPrompt=null;if(btn)btn.hidden=true;});
}

/* ── INIT ── */
window.addEventListener('DOMContentLoaded', async ()=>{
  installAudioUnlock();
  initTabs();
  renderKolbenRows();
  hookStaticInputs();
  hookVersuchDelegation();
  hookHistoryDelegation();
  hookGlobalPhotoDelegation();
  initTimeAdjustModal();
  initFloatingTimer();

  loadDraft();

  syncMetaToUi();
  syncBrunnenToUi();
  syncSelectionToUi();
  renderOverviewPhotoThumb();
  syncRestsandToUi();
  syncPhToUi();
  syncKolbenToUi();
  syncSettingsToUi();
  renderVersuche();
  renderLiveTab();

  await migrateLocalHistoryToIndexedDb();
  await renderHistoryList();

  initInstallButton();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register(`${BASE}sw.js?v=86`).catch(err=>console.error('SW:',err));
  }
});
