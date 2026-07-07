═══════════════════════════════════════════════════════════════════════════
  HTB PUMPVERSUCH – Progressive Web App
  Technische Dokumentation  |  Version 86  |  PWA Build 98
  HTB Baugesellschaft m.b.H.  |  www.htb-bau.at
═══════════════════════════════════════════════════════════════════════════

INHALTSVERZEICHNIS
──────────────────────────────────────────────────────────────────────────

  §1   Übersicht & Kernfunktionen
  §2   Systemvoraussetzungen
  §3   Dateistruktur
  §4   Module & Tabs
         §4.1  Protokoll
         §4.2  Restsand
         §4.3  pH / Sulfat
         §4.4  Kolben
         §4.5  Verlauf
         §4.6  Live-Auswertung
         §4.7  Einstellungen
  §5   Technische Architektur
         §5.1  State Management
         §5.2  Datenspeicherung  (LocalStorage & IndexedDB)
         §5.3  Timer-System
         §5.4  Kf-Abschätzung  (Dupuit-Iteration)
         §5.5  PDF-Export  (pdf-lib)
         §5.6  Service Worker / Offline-Betrieb
  §6   Niederlassungen
  §7   Konfigurationskonstanten
  §8   Code-Gliederung  app.js §1–§27
  §9   Deployment
  §10  Versionierung


══════════════════════════════════════════════════════════════════════════
§1  ÜBERSICHT & KERNFUNKTIONEN
══════════════════════════════════════════════════════════════════════════

Die HTB Pumpversuch App ist eine browserbasierte Progressive Web App (PWA)
zur digitalen Erfassung, Protokollierung und Auswertung von Pumpversuchen
im Spezialtiefbau.

  ┌──────────────────────┬────────────────────────────────────────────────┐
  │  Protokollierung     │ Stammdaten, Brunnendaten, Pumpstufen           │
  │  Zeitmessung         │ Timer pro Stufe, konfig. Messintervalle        │
  │  Alarm               │ Ton (Web Audio) + Vibration + visuelles Flash  │
  │  Live-Auswertung     │ Absenkungsdiagramm (SVG), Kf-Abschätzung      │
  │  Wasserqualität      │ pH, LF, Temperatur, Sulfat, O₂                │
  │  Restsandmessung     │ Imhoff-Trichter [ml/l], Sieb/Gewicht [g]      │
  │  Kolbenentwicklung   │ Kolbenhübe-Protokoll, Restsandmessung [g/m³]  │
  │  Fotos               │ Kamera-Capture, Downscale auf ≤ 1400 px       │
  │  PDF-Export          │ Protokoll und Vollständiger Bericht (A4)      │
  │  Verlauf             │ bis zu 30 Einträge in IndexedDB (Foto-Blobs)  │
  │  Offline             │ Service Worker, Network-first + Cache-Fallback │
  │  PWA                 │ Installierbar, Dark / Light-Theme              │
  └──────────────────────┴────────────────────────────────────────────────┘


══════════════════════════════════════════════════════════════════════════
§2  SYSTEMVORAUSSETZUNGEN
══════════════════════════════════════════════════════════════════════════

Browser (Mindestversionen):
  Chrome ≥ 90  |  Safari ≥ 15  |  Firefox ≥ 90  |  Edge ≥ 90

Erforderliche Web-APIs:
  IndexedDB · Web Audio API · Service Worker · FileReader
  Canvas API · navigator.vibrate · Kamera (HTTPS)

JavaScript:
  ES2020+ (async/await, optional chaining ?., nullish coalescing ??)

Externe Laufzeitabhängigkeiten (CDN – kein lokales Bundle):
  pdf-lib 1.17.1    https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/
  @pdf-lib/fontkit  https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit/

Lokale Schriften (müssen unter /Pumpversuch/fonts/ liegen):
  LiberationSans-Regular.ttf
  LiberationSans-Bold.ttf

Server:
  Statischer HTTP(S)-Server ausreichend.
  HTTPS ist Pflicht für Service Worker und Kamera-Zugriff.
  Deployment-Pfad: /Pumpversuch/


══════════════════════════════════════════════════════════════════════════
§3  DATEISTRUKTUR
══════════════════════════════════════════════════════════════════════════

/Pumpversuch/
│
├── index.html                  Haupt-HTML · alle Tab-Layouts (§1–§7)
├── app.js                      Anwendungslogik · §1–§27 · ~3200 Zeilen
├── styles.css                  Styling · Dark/Light-Theme · Responsive
├── sw.js                       Service Worker (Network-first, Cache-Fallback)
├── manifest.json               PWA-Manifest (Icons, Theme, Start-URL)
│
├── logo.svg                    HTB-Logo (Dark-Theme)
├── logo_hell.svg               HTB-Logo (Light-Theme)
├── logo.png                    HTB-Logo-Fallback für PDF-Einbettung
├── icon.svg                    App-Icon (SVG, maskable)
├── launchericon-192x192.png    PWA-Icon 192 px
├── launchericon-512x512.png    PWA-Icon 512 px
├── cover-photo.jpg             Deckblatthintergrundbild (PDF-Vollbericht)
├── Fußzeile.png                Fußzeilen-Bilddatei für alle PDF-Seiten
│
├── fonts/
│   ├── LiberationSans-Regular.ttf
│   └── LiberationSans-Bold.ttf
│
└── README.txt                  Diese Dokumentation


══════════════════════════════════════════════════════════════════════════
§4  MODULE & TABS
══════════════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────────────
§4.1  PROTOKOLL  (Tab-ID: protokoll)
──────────────────────────────────────────────────────────────────────────

  §1.1  Stammdaten
    Niederlassung (Pflichtfeld für Save/PDF), Objekt, Grundstück/Straße,
    Ort, Geologie, Auftragsnummer, Auftraggeber, Bauleitung, Bohrmeister,
    Koordination, Geprüft durch/am, Übersichtsfoto (Kamera-Capture).

  §1.2  Brunnendaten
    Förderbrunnen:   Ø [mm], Endteufe [m], Ruhewasserstand [m ab OK].
    Rückgabebrunnen: dieselben Felder, optional aktivierbar.
    Mindestens ein Brunnen muss ausgewählt sein (Validierung).

  §1.3  Pumpstufen  (dynamisch, beliebig viele)
    – Förderrate [l/s] manuell oder automatisch aus Ø Fördermenge
    – Messintervalle [min] kommagetrennt, frei konfigurierbar
    – Messtabelle: Min | Förderbrunnen [m ab OK] | Rückgabe [m ab OK]
                   | Fördermenge [m³/h]
    – Timer: Start / Stop / Reset, Zeitanpassung per Modal (Offset [s])
    – Intervall-Alarm: Ton + Vibration + CSS-Animation
    – Beweisfoto Durchflussmesser (Kamera-Capture, direkt der Stufe)

  §1.4  Aktionen
    Speichern → Verlauf (IndexedDB) · PDF Protokoll · Reset

──────────────────────────────────────────────────────────────────────────
§4.2  RESTSAND  (Tab-ID: restsand)
──────────────────────────────────────────────────────────────────────────

  Imhoff-Trichter [ml/l] und Sieb / Gewicht [g].
  Jeweils mit Foto-Capture (Kamera) und Mengeneingabe.
  Freitextfeld für Bemerkungen.
  PDF-Export: eigenständiges Restsandprotokoll.

──────────────────────────────────────────────────────────────────────────
§4.3  pH / SULFAT  (Tab-ID: ph)
──────────────────────────────────────────────────────────────────────────

  Messdaten: Datum, Bauherr, Baustelle, Gewässername / Entnahmestelle.

  Messmethode (Radiobutton):
    Einzel:     Sulfat (Quantofix, 120 s) · Temperatur · Leitfähigkeit · pH
    Kombigerät: pH / LF / T / O₂ in einem Formular

  Grenzwert-Tabelle: Expositionsklassen XA1 / XA2 / XA3 nach ÖNORM.
  Anmachwasser-Grenzwert: ≤ 2000 mg/l SO₄²⁻  (ÖNORM EN 1008).
  PDF-Export: Prüfprotokoll Sulfatmessung Wasser.

──────────────────────────────────────────────────────────────────────────
§4.4  KOLBEN  (Tab-ID: kolben)
──────────────────────────────────────────────────────────────────────────

  Brunnenparameter: Ausbaudurchmesser [mm], Entnahme, Nummer, Brunnen OK.
  Kolbenhübe-Protokoll: dynamische Tabelle mit beliebig vielen Zeilen
    (Anzahl Hübe | Aufsandung [cm] | Anmerkung).
  Restsandmessung [g/m³] – Anforderung: < 1,0 g/m³.
  PDF-Export: Brunnen- / Kolbenentwicklung.

──────────────────────────────────────────────────────────────────────────
§4.5  VERLAUF  (Tab-ID: verlauf)
──────────────────────────────────────────────────────────────────────────

  Zeigt alle gespeicherten Protokolle aus IndexedDB (max. 30 Einträge).
  Pro Eintrag:
    Laden (→ Protokoll-Tab) · PDF Protokoll · Bericht Vollständig ·
    PDF Restsand · PDF Sulfat · PDF Kolben · Fotos exportieren · Löschen
  Fotos werden beim Löschen inkl. verknüpfter Blobs entfernt.
  Kf-Abschätzung wird direkt aus dem gespeicherten Snapshot berechnet.

──────────────────────────────────────────────────────────────────────────
§4.6  LIVE-AUSWERTUNG  (Tab-ID: live)
──────────────────────────────────────────────────────────────────────────

  Echtzeit-Absenkungsdiagramme (SVG) pro Pumpstufe und Brunnen.
  Achsen werden automatisch skaliert (NiceNum-Algorithmus).
  Kf-Abschätzung nach Dupuit mit Qualitätsindikator:
    gut    = ≥ 4 Punkte & Streuung ≤ Faktor 3
    mittel = ≥ 3 Punkte & Streuung ≤ Faktor 10
    gering = weniger Punkte oder größere Streuung
  Wird bei jeder Eingabe automatisch neu gerendert (Debounce 90 ms).

──────────────────────────────────────────────────────────────────────────
§4.7  EINSTELLUNGEN  (Tab-ID: settings)
──────────────────────────────────────────────────────────────────────────

  Darstellung:          Dark / Light Theme
  Alarm:                Alarmdauer [1–30 s], Ton Ein/Aus (iOS-kompatibel)
  PDF-Export-Standard:  Protokoll oder Vollständige Auswertung
  Vorlagen-Export:      JSON ohne Messwerte und Fotos (.htbpump.json)
  Vollständiger Export: JSON inkl. Fotos (Base64 DataURL, alle Daten)
  Import:               JSON laden und als aktiven Draft anwenden


══════════════════════════════════════════════════════════════════════════
§5  TECHNISCHE ARCHITEKTUR
══════════════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────────────
§5.1  STATE MANAGEMENT
──────────────────────────────────────────────────────────────────────────

Das globale Objekt `state` ist das einzige Daten-Singleton zur Laufzeit.

  Datenfluss-Regeln:
    DOM → State:   collectXxxFromUi()    vor jedem Save / Export
    State → DOM:   syncXxxToUi()         nach Load / Reset / applySnapshot
    DOM aufbauen:  renderXxx()           für dynamisch generierte Inhalte

  State-Struktur (vollständig):
    state.meta             Stammdaten (Objekt, Ort, Niederlassung, ...)
    state.selection        { foerder: bool, schluck: bool }
    state.foerder          { dm, endteufe, ruhe }
    state.schluck          { dm, endteufe, ruhe }
    state.overviewPhotoDataUrl   Base64 DataURL des Übersichtsfotos
    state.versuche         Array<Versuch>
                             { id, manualRateM3h, startzeit, elapsedMs,
                               intervalleStr, messungen[], photoDataUrl }
    state.restsand         { imhoff: { photoDataUrl, menge },
                             sieb:   { photoDataUrl, menge }, bemerkung }
    state.ph               { datum, bauherr, baustelle, gewaessername,
                             sulfat, temperatur, leitfaehigkeit, ph,
                             combined: { aktiv, ph, lf, temp, o2, photo } }
    state.kolben           { durchmesser, entnahme, nummer, brunnenOk,
                             rows[], restsandmessung }
    state.settings         { alarmDurationSec, pdfExportType,
                             alarmSoundEnabled, theme }

  Snapshot-Serialisierung: collectSnapshot() → JSON, Schema-Version v18.
  applySnapshot() stellt den vollständigen State aus einem JSON-Snapshot wieder her.

──────────────────────────────────────────────────────────────────────────
§5.2  DATENSPEICHERUNG  (LocalStorage & IndexedDB)
──────────────────────────────────────────────────────────────────────────

  LocalStorage – Draft  (automatisch, kontinuierlich):
    Key:      htb-pumpversuch-draft-v18
    Debounce: 250 ms nach jeder Eingabe
    Inhalt:   vollständiger Snapshot inkl. Fotos (Base64 DataURL)
    Laden:    beim App-Start (loadDraft → applySnapshot)

  IndexedDB – Verlauf  (manuell, auf Knopfdruck):
    DB:      htb-pumpversuch-db-v1  |  Version: 1
    ─────────────────────────────────────────────────────────────
    Store „history"
      keyPath:  id
      Index:    savedAt
      Felder:   id, savedAt, title, snapshot (ohne Foto-DataUrls),
                photoMode
    ─────────────────────────────────────────────────────────────
    Store „historyPhotos"
      keyPath:  id (Format: entryId::slot)
      Index:    entryId
      Felder:   id, entryId, slot, savedAt, blob (Blob-Objekt)
    ─────────────────────────────────────────────────────────────
    Max. 30 Einträge – keine automatische Überschreibung.

  Foto-Slot-Schlüssel:
    overview             Übersichtsfoto
    versuch:N            Beweisfoto Pumpstufe N  (0-basiert)
    restsand:imhoff      Imhoff-Foto
    restsand:sieb        Sieb-Foto
    ph:sulfat            Sulfat-Foto
    ph:temperatur        Temperatur-Foto
    ph:leitfaehigkeit    Leitfähigkeits-Foto
    ph:ph                pH-Foto
    ph:combined          Kombigerät-Foto

  Migration:
    Einmalige automatische Migration von LocalStorage-History in IndexedDB.
    Abschluss-Marker: htb-pumpversuch-history-migrated-v1 = '1'

──────────────────────────────────────────────────────────────────────────
§5.3  TIMER-SYSTEM
──────────────────────────────────────────────────────────────────────────

  Pro Pumpstufe existiert ein timerMap[versuchId]-Eintrag:
    {
      running:        bool          Timer läuft aktuell
      startMs:        number        Date.now() beim letzten Start
      accumulatedMs:  number        Bisherige Laufzeit vor letztem Start
      raf:            number|null   requestAnimationFrame Handle
      alarmCount:     number        Anzahl bereits ausgelöster Alarme
    }

  Ticker-Loop: requestAnimationFrame (tickTimer)
    → aktualisiert UI, prüft Intervall-Schwellen

  Alarm-Auslösung (triggerIntervalAlarm):
    → scheduleBeep()       Ton über Web Audio API (Doppelfrequenz-Beep)
    → navigator.vibrate()  Haptisches Feedback
    → CSS screen-flash     Bildschirm-Aufleuchten
    → CSS card--alarm      Visuelle Hervorhebung der aktiven Karte

  Floating Timer: Zeigt aktive Laufzeit als fixiertes Overlay,
    wenn der Timer-Block durch Scrollen außerhalb des Sichtfelds ist.

  Zeitanpassung: Modal mit Offset-Eingabe [s] (+ vor, – zurück),
    Quick-Buttons (±10 s, ±1 min), Live-Preview der neuen Zeit.

──────────────────────────────────────────────────────────────────────────
§5.4  Kf-ABSCHÄTZUNG  (Dupuit-Iteration)
──────────────────────────────────────────────────────────────────────────

  Funktion: estimateRowKfDupuit({ qM3h, dmMm, endteufe, ruhe, dyn, key })

  Methode:
    Dupuit-Gleichung für ungespannten Grundwasserleiter.
    Einflussradius nach Sichardt (empirisch):
      R = max(rw · 20,  3000 · s · √kf)

  Iteration:
    30 Schritte, Abbruch bei relativem Fehler < 1e-6.

  Qualitätsbewertung (getStageKfEstimate):
    Basis:     zweite Hälfte der sortierten Messpunkte (stabilere Phase)
    Gewicht:   Messzeit [min] (spätere Punkte stärker gewichtet)
    Mittelwert: gewichtetes geometrisches Mittel (log-space)
    Streuung:  max(kf) / min(kf) der verwendeten Punkte
    gut:       ≥ 4 Punkte & Streuung ≤ 3
    mittel:    ≥ 3 Punkte & Streuung ≤ 10
    gering:    weniger Punkte oder größere Streuung

──────────────────────────────────────────────────────────────────────────
§5.5  PDF-EXPORT  (pdf-lib)
──────────────────────────────────────────────────────────────────────────

  Bibliothek: pdf-lib 1.17.1 + fontkit (für TTF-Subsetting)
  Format:     DIN A4 Hochformat  595 × 842 pt
  Schriften:  LiberationSans Regular + Bold (embedded, subsetted)
  Fußzeile:   Fußzeile.png (vollbreit) + dynamischer Niederlassungstext

  PDF Protokoll (exportPdf, type='protokoll'):
    – Eine Seite pro Pumpstufe:
        MetaGrid (3 Zeilen à 4 Spalten) · Ruhewasserbalken ·
        Brunneninfo · Messtabellen (Förderbrunnen / Rückgabe) ·
        Absenkungsdiagramme
    – Optional: Beweisfoto-Seite pro Stufe (drawImagePage)

  PDF Vollständiger Bericht (exportPdf, type='vollstaendig'):
    Seite 1:   Deckblatt – Cover-Foto rechts, 5 Felder links,
               grauer Header-Balken mit Logo + Titel
    Seite 2:   Inhaltsverzeichnis mit automatisch generierten Einträgen
    Seite 3+:  Protokoll-Seiten + Beweisfotos (eine Stufe pro Seite)
    danach:    Übersichtsfoto · Restsand · pH/Sulfat · Kolben
    Seitennummerierung: physische Seite 3 = Dokumentseite 1

  Weitere Einzel-PDFs:
    exportRestsandPdf()   Restsand-Seite standalone
    exportPhPdf()         pH/Sulfat-Seite standalone
    exportKolbenPdf()     Kolben-Seite standalone

──────────────────────────────────────────────────────────────────────────
§5.6  SERVICE WORKER / OFFLINE-BETRIEB
──────────────────────────────────────────────────────────────────────────

  Datei:          sw.js
  Cache-Name:     htb-pumpversuch-v100
  Strategie:      Network-first → bei Netzwerkfehler aus Cache

  Gecachte Assets:
    index.html · app.js · styles.css · manifest.json
    logo.svg · icon.svg · LiberationSans-Regular.ttf

  Offline-Fallback:     index.html  (für navigate-Requests)
  Update-Verhalten:     skipWaiting() + clients.claim() → sofortige Aktivierung
  Cache-Bereinigung:    alte Cache-Versionen werden bei activate gelöscht


══════════════════════════════════════════════════════════════════════════
§6  NIEDERLASSUNGEN
══════════════════════════════════════════════════════════════════════════

  Niederlassung  Adresse                                          Telefon
  ─────────────  ──────────────────────────────────────────────── ──────────────────
  Arzl           A-6471 Arzl im Pitztal, Gewerbepark Pitztal 16  +43(0)5412/63975
  Nüziders       A-6714 Nüziders, Landstraße 19                  +43 5552/34 739
  Zirl           A-6170 Zirl, Neuraut 1                          +43 5238/58 873 1
  Schwoich       A-6334 Schwoich, Kufsteiner Wald 28             +43 5372/63 600
  Fusch          A-5672 Fusch a.d. Großglocknerstraße,           +43 6546/40 116
                 Achenstraße 2
  Wels           A-4600 Wels, Hans-Sachs-Straße 103              +43 7242/601 600
  Klagenfurt     A-9020 Klagenfurt, Josef-Sablatnig-Str. 251     +43 463/33 533 700

  E-Mail-Schema:   office.[niederlassung]@htb-bau.at
  Web:             www.htb-bau.at

  Wichtig: Die Niederlassung ist ein Pflichtfeld.
  Ohne gültige Auswahl können keine Protokolle gespeichert und keine
  PDFs exportiert werden. Die Niederlassung bestimmt den Footer-Text
  aller PDF-Seiten (Adresse · Telefon · E-Mail · Web).


══════════════════════════════════════════════════════════════════════════
§7  KONFIGURATIONSKONSTANTEN  (app.js §1)
══════════════════════════════════════════════════════════════════════════

  Konstante                      Wert / Beschreibung
  ───────────────────────────── ────────────────────────────────────────
  BASE                          '/Pumpversuch/'
  STORAGE_DRAFT                 'htb-pumpversuch-draft-v18'
  STORAGE_HISTORY  (Legacy)     'htb-pumpversuch-history-v18'
  HISTORY_MAX                   30  (max. Verlaufseinträge)
  DEFAULT_INTERVALLE            [0,1,2,3,4,5,15,30,45,60,
                                 75,90,105,120,135,150,165,180] min
  IDB_NAME                      'htb-pumpversuch-db-v1'
  IDB_VERSION                   1
  IDB_STORE_HISTORY             'history'
  IDB_STORE_PHOTOS              'historyPhotos'
  STORAGE_HISTORY_MIGRATED      'htb-pumpversuch-history-migrated-v1'
  PHOTO_STORED                  '__stored__'  (Blob-Platzhalter im Snapshot)


══════════════════════════════════════════════════════════════════════════
§8  CODE-GLIEDERUNG  app.js  (§1–§27)
══════════════════════════════════════════════════════════════════════════

  §1   Konstanten & Konfiguration
         Storage-Keys, Standardintervalle, IndexedDB-Konfig,
         Firmen- und Niederlassungsdaten
  §2   DOM-Hilfsfunktion  ($-Shortcut)
  §3   State – Zustandsobjekt
         getInitialState(), state-Singleton, timerMap
  §4   Hilfsfunktionen
         uid, clone, HTML-Escape, Zahlen-/Datumsformatierung,
         Intervall-Parsing, Einheitenumrechnung, SVG-Generator
  §5   Förderrate & Kf-Abschätzung
         Manuelle Rate, Ø Fördermenge, Dupuit-Iteration,
         Kf-Qualitätsbewertung, Chart-Datenpunkte
  §6   Standardwerte
         defaultMessung, defaultVersuch, hydrateVersuch
  §7   Feldzuordnung
         META_FIELDS, BRUNNEN_FIELDS (DOM-ID → State-Key)
  §8   UI-Synchronisation
         syncXxxToUi(), collectXxxFromUi(), renderXxx()
  §9   Datenspeicherung & Snapshots
         LocalStorage-Draft, IndexedDB, Foto-Blob-Handling,
         History-CRUD, Legacy-Migration
  §10  Tabs – Navigation
  §11  Audio & Alarm
         Web Audio API, iOS-AudioContext-Unlock, Beep, Vibration
  §12  Bild-Verarbeitung
         Downscale (max. 1400 px, JPEG 0.74),
         DataUrl ↔ Uint8Array/Blob, PDF-Embedding
  §13  Foto-Delegation
         Globaler Click/Change-Handler für alle Foto-Buttons/Inputs
  §14  Timer-Steuerung
         start/stop/reset/hardStop, rAF-Loop, Alarm-Triggering
  §15  Floating Timer Widget
         rAF-Loop, Sichtbarkeits-Prüfung, isElementVisible
  §16  Zeitanpassungs-Modal
         Offset [s], Quick-Buttons, Live-Preview
  §17  Pumpstufen – Rendering
         buildVersuchHtml(), buildTableRowHtml(), renderVersuche()
  §18  Pumpstufen – Event-Delegation
         Alle Interaktionen: Eingaben, Fotos, Timer, Intervalle, Löschen
  §19  Statische Eingabefelder – Event-Listener
         Meta, Brunnen, Restsand, pH, Kolben, Settings, Buttons
  §20  JSON Export / Import
         Vorlage (ohne Messwerte/Fotos), Vollexport inkl. Fotos
  §21  Live-Auswertung
         SVG-Diagramm, Kf-Panel, Auto-Skalierung (NiceNum)
  §22  Verlauf (History)
         renderHistoryList(), hookHistoryDelegation(), Foto-Export
  §23  PDF – Hilfsfunktionen
         loadPdfAssets, drawFooter, drawHeaderBar, drawMetaGrid,
         drawWellTable, drawWellChart, drawStageSplitLayout
  §24  PDF – Seiten
         drawNewFooterFull, drawCoverPage, drawTocPage,
         drawProtocolStagePage, drawRestsandPage, drawPhPage,
         drawKolbenPage, exportKolbenPdf
  §25  PDF – Exports
         addFullPdfPageNumbers, exportPdf (Protokoll / Vollbericht),
         exportRestsandPdf, exportPhPdf
  §26  Reset & Installation
         resetAll(), initInstallButton()
  §27  Initialisierung – DOMContentLoaded
         Hooks, Draft laden, UI aufbauen,
         History migrieren, Service Worker registrieren


══════════════════════════════════════════════════════════════════════════
§9  DEPLOYMENT
══════════════════════════════════════════════════════════════════════════

  1.  Alle Dateien in das Verzeichnis /Pumpversuch/ des Webservers laden.
  2.  Schriftarten unter /Pumpversuch/fonts/ ablegen.
  3.  HTTPS sicherstellen (Pflicht für Service Worker und Kamera).
  4.  Cache-Busting bei Änderungen:
        – ?v=N Parameter in index.html auf neue Nummer erhöhen.
        – CACHE-Name in sw.js ('htb-pumpversuch-v100') ebenfalls anpassen.
        – console.log-Versionsnummer in app.js aktualisieren.
  5.  MIME-Typen: Server muss application/json für .json ausliefern.

  Kein Build-Tool, kein Bundler erforderlich.
  Die App läuft direkt aus statischen Dateien auf einem einfachen Webserver.


══════════════════════════════════════════════════════════════════════════
§10  VERSIONIERUNG
══════════════════════════════════════════════════════════════════════════

  Komponente          Version / Key          Fundstelle
  ──────────────────  ─────────────────────  ────────────────────────────
  app.js              v86                    console.log beim Start
  PWA-Build           98                     Footer-Anzeige im Browser
  Service Worker      v100  (Cache-Name)     sw.js  CACHE-Konstante
  Snapshot-Schema     v18   (Key-Suffix)     STORAGE_DRAFT in app.js §1
  IndexedDB-Schema    1     (IDB_VERSION)    openHistoryDb() in app.js §9

  Versionierung erfolgt manuell.
  Bei Breaking Changes am Snapshot-Schema → STORAGE_DRAFT Key-Suffix erhöhen
  und ggf. eine Migrationsfunktion ergänzen (analog migrateLocalHistoryToIndexedDb).


═══════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════
