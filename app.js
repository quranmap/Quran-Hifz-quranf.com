// app.js (ES Module)
import { loadQuranData, getAyah, getSuraMeta, getSuraRefs, getWords } from "./data.js";
import {
  initStylePicker, applyStyleThemeById, loadStyleThemeId, saveStyleThemeId, STYLE_THEMES,
  initSurfacePicker, applySurfaceThemeById, loadSurfaceThemeId, saveSurfaceThemeId
} from "./styles.js";

function getAllRefs() {
  const out = [];
  for (let s = 1; s <= 114; s++) {
    const refs = getSuraRefs(s) || [];
    for (const r of refs) out.push(r);
  }
  return out;
}

let suppressHashRender = false;
// ✅ Whole Quran standardmäßig NICHT rendern (Performance!)
window.__renderAllQuran = false;

/* ============================================================================
   DEBUG (per URL)
   - ?debug=1            -> alles an
   - ?debug=layout,data  -> nur bestimmte Bereiche
   - optional: ?debug=1&forcePhone=1
============================================================================ */

function parseDebug() {
  const raw = new URLSearchParams(location.search).get("debug");
  if (!raw) return { enabled: false, tags: new Set() };

  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "all") return { enabled: true, tags: new Set(["all"]) };

  const tags = new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return { enabled: true, tags };
}

const DBG = parseDebug();
const debugOn = (tag) =>
  DBG.enabled && (DBG.tags.has("all") || DBG.tags.size === 0 || DBG.tags.has(tag));

const dlog = (tag, ...args) => debugOn(tag) && console.log(`[${tag}]`, ...args);
const dgroup = (tag, title) => debugOn(tag) && console.groupCollapsed(`[${tag}] ${title}`);
const dgroupEnd = (tag) => debugOn(tag) && console.groupEnd();

function dumpLayoutVars() {
  const cs = getComputedStyle(document.documentElement);
  const vars = {
    "--vw": cs.getPropertyValue("--vw").trim(),
    "--vh": cs.getPropertyValue("--vh").trim(),
    "--stage-w": cs.getPropertyValue("--stage-w").trim(),
    "--stage-h": cs.getPropertyValue("--stage-h").trim(),
    "--bar-lr": cs.getPropertyValue("--bar-lr").trim(),
    "--bar-bottom": cs.getPropertyValue("--bar-bottom").trim(),
    rotatePhone: document.documentElement.classList.contains("rotate-phone"),
    href: location.href,
  };
  dlog("layout", "CSS vars snapshot:", vars);
  return vars;
}

function domReady() {
  return new Promise((resolve) => {
    if (document.readyState !== "loading") return resolve();
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

// =========================
// Render Scheduler (Idle-first)
// =========================
const _ric =
  window.requestIdleCallback ||
  function (cb) {
    return setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 16);
  };

const _cic =
  window.cancelIdleCallback ||
  function (id) {
    clearTimeout(id);
  };

function scheduleRender(fn, { timeout = 120 } = {}) {
  return _ric(() => fn(), { timeout });
}

function cancelScheduledRender(id) {
  if (id == null) return;
  _cic(id);
}

/* ============================================================================
   PHONE DETECTION + ROTATION (läuft sofort, ohne auf Daten zu warten)
============================================================================ */

function isPhoneDevice() {
  const ua = navigator.userAgent || "";
  const uaMobile = /Mobi|Android|iPhone|iPod/i.test(ua);
  const uaIpad = /iPad/i.test(ua);

  const mobileHint =
    (navigator.userAgentData && navigator.userAgentData.mobile) === true;

  let coarse = false;
  try {
    coarse = matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }

  const touch = (navigator.maxTouchPoints || 0) > 0;

  // "Phone": mobile UA OR (coarse + touch), but exclude iPad explicitly
  const maybePhone = (uaMobile || mobileHint || (coarse && touch)) && !uaIpad;
  return !!maybePhone;
}

function recalc() {
  const rotated = document.documentElement.classList.contains("rotate-phone");

  const vw = rotated ? window.innerHeight : window.innerWidth;
  const vh = rotated ? window.innerWidth : window.innerHeight;

  // ✅ 16:9 Stage (wie bisher)
  const stageW = Math.min(vw, vh * (16 / 9));
  const stageH = stageW * (9 / 16);

  // ✅ links/rechts: maximal möglich
  const barLR = Math.max(0, (vw - stageW) / 2);

  // ✅ Stage View Height: darf über 16:9 wachsen, aber nur begrenzt
  // (damit bei hohen Fenstern mehr Inhalt sichtbar wird, ohne Skalierung zu ändern)
  const extraV = Math.max(0, vh - stageH);
  const maxExtra = stageH * 0.35;              // feinjustieren: 0.20 .. 0.45
  const stageVH = stageH + Math.min(extraV, maxExtra);

  // ✅ Bottom-Bar bleibt dünn (oder 0), NIE riesig
  const maxBottom = stageH * 0.012;            // feinjustieren: 0.005 .. 0.020
  const barBottom = 0; // ✅ kein Bottom-Balken mehr (kein schwarzer Streifen bei hohen Fenstern)

  const root = document.documentElement.style;
  root.setProperty("--vw", vw + "px");
  root.setProperty("--vh", vh + "px");
  root.setProperty("--stage-w", stageW + "px");
  root.setProperty("--stage-h", stageH + "px");
  root.setProperty("--stage-vh", stageVH + "px");   // ✅ NEU
  root.setProperty("--bar-lr", barLR + "px");
  root.setProperty("--bar-bottom", barBottom + "px");

  // ✅ frame-top nicht mehr benutzt
  root.setProperty("--frame-top", "0px");

  if (debugOn("layout")) {
    dgroup("layout", "recalc()");
    dlog("layout", { rotated, vw, vh, stageW, stageH, barLR, barBottom, frameTop: 0 });
    dumpLayoutVars();
    dgroupEnd("layout");
  }
}
// Preview-Simulator: ?forcePhone=1 erzwingt Phone-Rotation
const forcePhone = new URLSearchParams(location.search).get("forcePhone") === "1";

if (forcePhone || isPhoneDevice()) {
  document.documentElement.classList.add("rotate-phone");
  dlog("layout", "rotate-phone enabled", { forcePhone });
} else {
  dlog("layout", "rotate-phone disabled", { forcePhone });
}

recalc();

/* ✅ ROOT FIX: Theme sofort anwenden (vor domReady / vor dem ersten “echten” Paint)
   - verhindert “Statusbar ohne Style -> Welcome -> Style” Flash
   - ✅ Fix: echte Defaults (Style + Surface) passend zu den richtigen Listen
*/
const DEFAULT_STYLE_ID = "style-082";   // Blue Slate 082
const DEFAULT_SURFACE_ID = "style-070"; // Blue/Grey 070

try{
  const saved = loadStyleThemeId();

  // wenn leer -> Default speichern (damit Picker nicht auf [0] fällt)
  if (!saved && DEFAULT_STYLE_ID) {
    try { saveStyleThemeId(DEFAULT_STYLE_ID); } catch {}
  }

  applyStyleThemeById(saved || DEFAULT_STYLE_ID);
}catch(e){
  console.warn("[style] early apply failed:", e);
}

try{
  const savedSurf = loadSurfaceThemeId();

  // wenn leer -> Default speichern (damit Surface-Picker nicht auf sorted[0] fällt)
  if (!savedSurf && DEFAULT_SURFACE_ID) {
    try { saveSurfaceThemeId(DEFAULT_SURFACE_ID); } catch {}
  }

  applySurfaceThemeById(savedSurf || DEFAULT_SURFACE_ID);
}catch(e){
  console.warn("[surface] early apply failed:", e);
}
window.addEventListener("resize", recalc);
window.addEventListener("orientationchange", recalc);

// Run after initial layout (hilft bei manchen Browsern/Rotation)
requestAnimationFrame(() => {
  recalc();
  requestAnimationFrame(recalc);
});

/* ============================================================================
   DATA LOAD (parallel, blockiert Layout nicht)
============================================================================ */

let dataReady = false;

const dataPromise = loadQuranData()
  .then(() => {
    dataReady = true;
  })
  .catch((err) => {
    console.error("[data] loadQuranData failed:", err);
    try {
      const el = document.getElementById("stage") || document.body;
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:12px;z-index:9999;padding:12px;border:1px solid #f00;background:#200;color:#fff;font:14px/1.4 system-ui;";
      box.textContent = `Fehler beim Laden der Quran-Daten: ${err?.message || err}`;
      el.appendChild(box);
    } catch {}
    throw err;
  });

  /* ============================================================================
   TRANSLATIONS (Ayah-Mode only)
   - index: translations_index.json
   - files: translate/FINAL/<Language>/<Name>.json
   - fallback: tries local ./<basename>.json if path fails (dev)
   ============================================================================ */

// ✅ R2 Custom Domain (Audio Bucket) – muss VOR den Translation-Konstanten existieren
const AUDIO_BASE_URL = "https://audio.quranm.com";

// ✅ Translations liegen jetzt in R2 unter https://audio.quranm.com/translate/FINAL/...
const TRANSLATIONS_ROOT = `${AUDIO_BASE_URL}/translate/FINAL`;
const TRANSLATIONS_INDEX_URL = `${TRANSLATIONS_ROOT}/translations_index.json`;
const MAX_ACTIVE_TRANSLATIONS = 10;

let translationsIndex = null;               // geladenes index json
const translationCache = new Map();         // file -> json
let activeTranslations = [];                // [{ language, label, file }]

const LS_ACTIVE_TRANSLATIONS = "quranm_active_translations_v1";

function saveActiveTranslationFiles(files) {
  try {
    const arr = (files || []).map(String);
    localStorage.setItem(LS_ACTIVE_TRANSLATIONS, JSON.stringify(arr));
  } catch {}
}

function loadActiveTranslationFiles() {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_TRANSLATIONS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(String);
  } catch {
    return [];
  }
}

// Default: 1 Übersetzung aktiv (später per UI änderbar)
const DEFAULT_ACTIVE_TRANSLATION_FILES = [
  "English/Saheeh International.json"
];

function _basename(path) {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function translationUrlFor(file) {
  // file ist z.B. "English/Saheeh International.json"
  return `${TRANSLATIONS_ROOT}/${file}`;
}

async function fetchJsonWithFallbacks(urlCandidates) {
  let lastErr = null;
  for (const url of urlCandidates) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetchJsonWithFallbacks failed");
}

async function ensureTranslationsIndex() {
  if (translationsIndex) return translationsIndex;

  try {
    // 1) normal
    // 2) fallback: "./translations_index.json"
    translationsIndex = await fetchJsonWithFallbacks([
      TRANSLATIONS_INDEX_URL,
      `./${TRANSLATIONS_INDEX_URL}`
    ]);
  } catch (e) {
    // ✅ Wichtig: Index ist OPTIONAL – App darf niemals deswegen crashen
    console.warn(
      "[tr] translations_index.json konnte nicht geladen werden (OK für dev).",
      e
    );
    translationsIndex = { root: "", languages: [] };
  }

  return translationsIndex;
}

function findIndexItemByFile(file) {
  const idx = translationsIndex;
  if (!idx || !Array.isArray(idx.languages)) return null;

  for (const lang of idx.languages) {
    const items = lang?.items || [];
    for (const it of items) {
      if (it?.file === file) {
        return { language: lang.language, label: it.label, file: it.file };
      }
    }
  }
  return null;
}

async function loadTranslationFile(file) {
  if (translationCache.has(file)) return translationCache.get(file);

  const urlMain = translationUrlFor(file);        // jetzt absolute URL (R2)
  const base = _basename(file);

  // Kandidaten: zuerst R2, dann (optional) lokale dev-fallbacks
  const candidates = [urlMain];

  // Falls jemand lokal noch Dateien hat, versuchen wir die auch:
  // (wichtig: NICHT "./" vor eine https URL hängen)
  const urlRel = `translate/FINAL/${file}`;
  candidates.push(
    urlRel,               // translate/FINAL/English/Name.json
    `./${urlRel}`,        // ./translate/FINAL/English/Name.json
    `./${file}`,          // ./English/Name.json (manchmal so in dev)
    `./${base}`           // ./Name.json (wie bei deinem Upload)
  );

  const json = await fetchJsonWithFallbacks(candidates);

  translationCache.set(file, json);
  return json;
}

function stripHtmlToText(html) {
  // Sup-Footnotes usw. entfernen + HTML sauber zu Text
  const el = document.createElement("div");
  el.innerHTML = String(html || "")
    .replace(/<sup\b[^>]*>.*?<\/sup>/gi, ""); // <sup ...>..</sup> kill
  return (el.textContent || "").trim();
}

function getTranslationTextFromJson(tJson, surah, ayah) {
  // Format wie in Saheeh: chapters["2"][12].text (0-index für ayah)
  try {
    const ch = tJson?.chapters?.[String(surah)];
    if (!Array.isArray(ch)) return "";
    const row = ch[Number(ayah) - 1];
    const raw = row?.text ?? "";
    return stripHtmlToText(raw);
  } catch {
    return "";
  }
}

async function initTranslations() {
  await ensureTranslationsIndex();

  // 1) persisted files (wenn vorhanden)
  const persisted = loadActiveTranslationFiles().slice(0, MAX_ACTIVE_TRANSLATIONS);

  let filesToUse = [];
  if (persisted.length) {
    filesToUse = persisted;
  } else {
    filesToUse = DEFAULT_ACTIVE_TRANSLATION_FILES.slice(0, MAX_ACTIVE_TRANSLATIONS);
  }

  activeTranslations = filesToUse
    .map((file) => findIndexItemByFile(file) || { language: "", label: _basename(file).replace(/\.json$/i,""), file })
    .filter(Boolean);

  // falls persisted tot ist: neu speichern
  saveActiveTranslationFiles(activeTranslations.map(t => t.file));

  // Warm cache
  await Promise.all(activeTranslations.map((t) => loadTranslationFile(t.file).catch(() => null)));

  // ✅ Wenn UI schon existiert: Dropdown neu aufbauen/label refresh
  try { window.__initTranslationsDropdown?.(); } catch {}
}

function buildAyahTranslationsHtml(a, escFn) {
  // escFn ist deine bestehende esc()-Funktion aus renderAyahWords
  const lines = [];

  // 1) vorhandenes Deutsch aus Quran-Dataset (falls da)
  if (a?.textDe) {
    lines.push(
      `<div class="trLine"><span class="trLabel">Deutsch</span><span class="trText" lang="de">${escFn(a.textDe)}</span></div>`
    );
  }

  // 2) aktive JSON-Übersetzungen (geladen/Cache)
  for (const t of activeTranslations) {
    const tJson = translationCache.get(t.file);
    if (!tJson) continue;

    const txt = getTranslationTextFromJson(tJson, a.surah, a.ayah);
    if (!txt) continue;

    const label = t.language ? `${escFn(t.language)} — ${escFn(t.label)}` : escFn(t.label);
    lines.push(
      `<div class="trLine"><span class="trLabel">${label}</span><span class="trText" lang="en">${escFn(txt)}</span></div>`
    );
  }

  if (!lines.length) return "";
  return `<div class="ayahTrans ayahTransList">${lines.join("")}</div>`;
}

function buildBasmTranslationsHtml(escFn) {
  const lines = [];

  // Wir nehmen 1:1 als "Basmallah-Übersetzung" (funktioniert bei sehr vielen Translations)
  for (const t of activeTranslations) {
    const tJson = translationCache.get(t.file);
    if (!tJson) continue;

    const txt = getTranslationTextFromJson(tJson, 1, 1);
    if (!txt) continue;

    const label = t.language ? `${escFn(t.language)} — ${escFn(t.label)}` : escFn(t.label);
    lines.push(
      `<div class="trLine"><span class="trLabel">${label}</span><span class="trText" lang="en">${escFn(txt)}</span></div>`
    );
  }

  if (!lines.length) return "";
  return `<div class="ayahTrans ayahTransList">${lines.join("")}</div>`;
}


/* ============================================================================
   ROUTER HELPERS (Hash) – URL -> Ref
   Beispiele:
   - http://localhost:8000/#/2:1
   - http://localhost:8000/#/2:255
============================================================================ */

function parseRefLoose(input) {
  const s = String(input || "")
    .trim()
    // alles was vorne wie "#", "#/", "##///" usw. ist weg
    .replace(/^#+\/?/, "")
    // falls jemand "ref=#/2/255" reinpaste't: alles vor letztem # weg
    .replace(/^.*#\/?/, "")
    // Trenner normalisieren
    .replace(/[.\s\-_/]+/g, ":");

  // 1) Nur Sura: "2" => "2:1"
  const mOnlySura = s.match(/^(\d{1,3})$/);
  if (mOnlySura) {
    const surah = Number(mOnlySura[1]);
    if (Number.isNaN(surah)) return null;
    if (surah < 1 || surah > 114) return null;
    return `${surah}:1`;
  }

  // 2) Sura:Ayah "2:255" (oder "2 255", "2-255", "2/255" => wird oben zu ":" normalisiert)
  const m = s.match(/^(\d{1,3}):(\d{1,3})$/);
  if (!m) return null;

  const surah = Number(m[1]);
  const ayah = Number(m[2]);

  if (Number.isNaN(surah) || Number.isNaN(ayah)) return null;
  if (surah < 1 || surah > 114) return null;
  if (ayah < 1 || ayah > 999) return null;

  return `${surah}:${ayah}`;
}

function normalizeRef(input) {
  const loose = parseRefLoose(input);
  if (!loose) return null;

  // Solange Daten noch nicht da sind: nur "loose" zulassen (hash setzen ok)
  if (!dataReady) return loose;

  const [suraStr, ayahStr] = loose.split(":");
  const surah = Number(suraStr);
  const ayah = Number(ayahStr);

  const meta = getSuraMeta(surah);
  if (!meta) return null;

  const maxAyah = Number(meta.ayahCount || 0);
  if (!maxAyah) return null;
  if (ayah < 1 || ayah > maxAyah) return null;

  return loose;
}

function getRefFromHash() {
  // location.hash kann sein: "#/2:255", "#/7/7", "#7-7", "##/7/7"
  const raw = (location.hash || "");
  const loose = parseRefLoose(raw);
  return normalizeRef(loose);
}

function setRefToHash(ref) {
  const n = parseRefLoose(ref);
  if (!n) return false;

  const next = `#/${n}`;
  if (location.hash !== next) {
    suppressHashRender = true;   // <- verhindert, dass hashchange direkt nochmal rendert
    location.hash = next;
  }
  return true;
}

// =========================
// Nav Persist (lastRef + viewMode)
// =========================
const LS_LAST_REF = "q_lastRef";
const LS_VIEW_MODE = "q_viewMode";

function persistNavState() {
  try {
    if (/^\d+:\d+$/.test(currentRef)) localStorage.setItem(LS_LAST_REF, currentRef);
    if (viewMode) localStorage.setItem(LS_VIEW_MODE, viewMode);
  } catch {}
}

function loadPersistedNavState() {
  try {
    const lastRef = localStorage.getItem(LS_LAST_REF) || "";
    const vm = localStorage.getItem(LS_VIEW_MODE) || "";
    return { lastRef, viewMode: vm };
  } catch {
    return { lastRef: "", viewMode: "" };
  }
}

// =========================
// ACCOUNT SYNC (Cloudflare Worker + D1)
// =========================

// ⚠️ HIER deine Worker-URL
const ACCOUNT_API_BASE = "https://quranmapi.u87bc15v3.workers.dev";

// Design-Key (Style Picker)
const LS_STYLE_THEME = "quranm_style_theme_v1";

// ✅ Fixe Auth-Keys (damit wir nicht “irgendeinen” JWT aus Versehen nehmen)
// (UMBENANNT, damit es nicht mit dem AUTH-Block oben kollidiert)
const LS_ACC_AUTH_TOKEN  = "q_auth_token_v1";
const LS_ACC_AUTH_SET_AT = "q_auth_set_at_v1"; // ms timestamp

// 114 Tage in ms
const AUTH_KEEP_MS = 114 * 24 * 60 * 60 * 1000;

function __setAuthToken(token){
  try{ localStorage.setItem(LS_ACC_AUTH_TOKEN, String(token || "")); }catch{}
  try{ localStorage.setItem(LS_ACC_AUTH_SET_AT, String(Date.now())); }catch{}
}

function __getAuthToken(){
  try{ return String(localStorage.getItem(LS_ACC_AUTH_TOKEN) || ""); }catch{ return ""; }
}

function __isAuthFresh(){
  try{
    const t = Number(localStorage.getItem(LS_ACC_AUTH_SET_AT) || "0");
    if (!Number.isFinite(t) || t <= 0) return false;
    return (Date.now() - t) <= AUTH_KEEP_MS;
  }catch{
    return false;
  }
}

// Token finden: erst unser fixer Key, fallback (damit deine bisherigen Tests nicht kaputt gehen)
function __findJwtInLocalStorage(){
  const direct = __getAuthToken().trim();
  if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(direct)) return direct;

  // fallback: irgendein JWT (nur als Übergang)
  try{
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k) continue;
      const v = String(localStorage.getItem(k) || "").trim();
      if (!v) continue;
      if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(v)) return v;
    }
  }catch{}
  return "";
}

function __authHeaders(){
  const token = __findJwtInLocalStorage();
  const h = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function __isLoggedIn(){
  const tok = __findJwtInLocalStorage();
  if (!tok) return false;

  // ✅ LocalStorage-Regel: nur 114 Tage “eingeloggt”
  // (Token bleibt gespeichert, aber wir behandeln ihn danach als “ausgeloggt”)
  return __isAuthFresh();
}

let __syncTimer = 0;
let __syncInFlight = false;
const LS_ACC_SYNC_CONFLICT = "q_account_sync_conflict_v1";

function __hasAccountSyncConflict(){
  try { return localStorage.getItem(LS_ACC_SYNC_CONFLICT) === "1"; }
  catch { return false; }
}

function __setAccountSyncConflict(on){
  try{
    if (on) localStorage.setItem(LS_ACC_SYNC_CONFLICT, "1");
    else localStorage.removeItem(LS_ACC_SYNC_CONFLICT);
  }catch{}
}

const LS_ACC_SYNC_LAST_AT = "q_account_sync_last_at_v1";
const LS_ACC_SYNC_STATUS  = "q_account_sync_status_v1";
const LS_ACC_SYNC_MODE    = "q_account_sync_mode_v1";

function __formatAccountSyncTime(ts){
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";

  try{
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(n));
  }catch{
    return "—";
  }
}

function __getAccountSyncSnapshot(){
  let status = "idle";
  let mode = "";
  let lastAt = 0;

  try { status = String(localStorage.getItem(LS_ACC_SYNC_STATUS) || "idle"); } catch {}
  try { mode = String(localStorage.getItem(LS_ACC_SYNC_MODE) || ""); } catch {}
  try { lastAt = Number(localStorage.getItem(LS_ACC_SYNC_LAST_AT) || "0"); } catch {}

  return { status, mode, lastAt };
}

function __setAccountSyncUiState(status, { mode="", save=true } = {}){
  const safeStatus = String(status || "").trim() || "idle";
  const safeMode = String(mode || "").trim();

  if (save) {
    try { localStorage.setItem(LS_ACC_SYNC_STATUS, safeStatus); } catch {}
    try {
      if (safeMode) localStorage.setItem(LS_ACC_SYNC_MODE, safeMode);
      else localStorage.removeItem(LS_ACC_SYNC_MODE);
    } catch {}
  }

  try { window.__refreshAccountSyncUi?.(); } catch {}
}

function __markAccountSynced(mode="live"){
  const now = Date.now();
  try { localStorage.setItem(LS_ACC_SYNC_LAST_AT, String(now)); } catch {}
  __setAccountSyncUiState("synced", { mode });
}

function __refreshAccountSyncUi(){
  const statusEl = document.getElementById("acctSyncStatusValue");
  const lastEl = document.getElementById("acctSyncLastValue");

  if (!statusEl || !lastEl) return;

  let inOk = false;
  try { inOk = !!__isLoggedIn?.(); } catch {}

  if (!inOk) {
    statusEl.textContent = "Local only";
    lastEl.textContent = "—";
    return;
  }

  if (__hasAccountSyncConflict()) {
    statusEl.textContent = "Browser ≠ Account";
    lastEl.textContent = "Use Load / Save";
    return;
  }

  const snap = __getAccountSyncSnapshot();

  let statusText = "Ready";

  if (snap.status === "pending") {
    statusText = snap.mode === "live" ? "Pending live sync" : "Pending sync";
  } else if (snap.status === "syncing") {
    if (snap.mode === "login") statusText = "Syncing login…";
    else if (snap.mode === "live") statusText = "Syncing live…";
    else if (snap.mode === "account") statusText = "Loading account…";
    else statusText = "Syncing…";
  } else if (snap.status === "synced") {
    if (snap.mode === "login") statusText = "Synced after login";
    else if (snap.mode === "live") statusText = "Live synced";
    else if (snap.mode === "account") statusText = "Synced from account";
    else statusText = "Synced";
  } else if (snap.status === "error") {
    if (snap.mode === "login") statusText = "Login sync error";
    else if (snap.mode === "live") statusText = "Live sync error";
    else if (snap.mode === "account") statusText = "Account load error";
    else statusText = "Sync error";
  }

  statusEl.textContent = statusText;
  lastEl.textContent = __formatAccountSyncTime(snap.lastAt);
}

window.__refreshAccountSyncUi = __refreshAccountSyncUi;
window.__setAccountSyncUiState = __setAccountSyncUiState;
window.__markAccountSynced = __markAccountSynced;

// ✅ Account-State: Bookmarks + Notes + Style + Favorites-Pages + Group-Titles/Map/Collapsed + Habashi Labels
function __collectLocalAccountState(){
  let bookmarks = [];
  let notes = {};
  let styleId = "";
  let surfaceId = "";

  // Favorites pages + grouping
  let favPresets = {};
  let favActivePreset = "actual";
  let favGroupTitles = [];
  let favGroupMap = {};
  let favGroupCollapsed = {};
  let habashiLabels = {};

  // Hifz
  let hifzResults = {};
  let hifzRepeatTarget = 5;
  let hifzStage = "1";
  let hifzRange = "5-10";
  let hifzStageTrendHistory = [];

  // ---- base keys
  try { bookmarks = JSON.parse(localStorage.getItem("q_bookmarks_v1") || "[]"); } catch { bookmarks = []; }
  try { notes = JSON.parse(localStorage.getItem("q_notes_v1") || "{}"); } catch { notes = {}; }
  try { styleId = String(localStorage.getItem(LS_STYLE_THEME) || ""); } catch { styleId = ""; }

  // ✅ NEW: Surface Theme (2. Style Button)
  try { surfaceId = String(loadSurfaceThemeId() || ""); } catch { surfaceId = ""; }

  // ---- favorites keys
  try { favPresets = JSON.parse(localStorage.getItem("q_fav_presets_v1") || "{}"); } catch { favPresets = {}; }
  try { favActivePreset = String(localStorage.getItem("q_fav_active_preset_v1") || "actual"); } catch { favActivePreset = "actual"; }
  try { favGroupTitles = JSON.parse(localStorage.getItem("q_fav_group_titles_v1") || "[]"); } catch { favGroupTitles = []; }
  try { favGroupMap = JSON.parse(localStorage.getItem("q_fav_group_map_v1") || "{}"); } catch { favGroupMap = {}; }
  try { favGroupCollapsed = JSON.parse(localStorage.getItem("q_fav_group_collapsed_v1") || "{}"); } catch { favGroupCollapsed = {}; }
  try { habashiLabels = JSON.parse(localStorage.getItem("q_habashi_labels_v1") || "{}"); } catch { habashiLabels = {}; }

  // ---- hifz keys
  try { hifzResults = JSON.parse(localStorage.getItem(LS_HIFZ_RESULTS) || "{}"); } catch { hifzResults = {}; }
  try { hifzRepeatTarget = Number(localStorage.getItem(LS_HIFZ_REPEAT_TARGET) || 5); } catch { hifzRepeatTarget = 5; }
  try { hifzStage = String(localStorage.getItem(LS_HIFZ_STAGE) || "1").trim() || "1"; } catch { hifzStage = "1"; }
  try { hifzRange = String(localStorage.getItem(LS_HIFZ_RANGE) || "5-10").trim() || "5-10"; } catch { hifzRange = "5-10"; }
  try { hifzStageTrendHistory = loadHifzStageTrendHistory(); } catch { hifzStageTrendHistory = []; }

  // ---- sanitize base
  if (!Array.isArray(bookmarks)) bookmarks = [];
  if (!notes || typeof notes !== "object") notes = {};
  bookmarks = bookmarks.map(String).filter(r => /^\d+:\d+$/.test(r));

  const cleanNotes = {};
  for (const k of Object.keys(notes)){
    const rk = String(k);
    const v = notes[k];
    if (!/^\d+:\d+$/.test(rk)) continue;
    if (typeof v !== "string") continue;
    if (!v.trim()) continue;
    cleanNotes[rk] = v;
  }

  // ---- sanitize favorites structures (keep it tolerant)
  if (!favPresets || typeof favPresets !== "object") favPresets = {};
  if (!Array.isArray(favGroupTitles)) favGroupTitles = [];
  if (!favGroupMap || typeof favGroupMap !== "object") favGroupMap = {};
  if (!favGroupCollapsed || typeof favGroupCollapsed !== "object") favGroupCollapsed = {};
  if (!habashiLabels || typeof habashiLabels !== "object") habashiLabels = {};

  // presets: ensure arrays + valid refs
  const cleanFavPresets = {};
  for (const name of Object.keys(favPresets)){
    const arr = Array.isArray(favPresets[name]) ? favPresets[name] : [];
    const clean = arr.map(String).filter(r => /^\d+:\d+$/.test(r));
    cleanFavPresets[String(name)] = clean;
  }

  // group titles: strings only
  const cleanGroupTitles = Array.from(new Set(favGroupTitles.map(v => String(v || "").trim()).filter(Boolean)));

  // group map: string->string
  const cleanGroupMap = {};
  for (const k of Object.keys(favGroupMap)){
    const kk = String(k || "").trim();
    const vv = String(favGroupMap[k] || "").trim();
    if (!kk || !vv) continue;
    cleanGroupMap[kk] = vv;
  }

  // collapsed: title->boolean
  const cleanCollapsed = {};
  for (const k of Object.keys(favGroupCollapsed)){
    const kk = String(k || "").trim();
    if (!kk) continue;
    cleanCollapsed[kk] = !!favGroupCollapsed[k];
  }

  // habashi labels: key->string
  const cleanHabashiLabels = {};
  for (const k of Object.keys(habashiLabels)){
    const kk = String(k || "").trim();
    const vv = String(habashiLabels[k] || "").trim();
    if (!kk || !vv) continue;
    cleanHabashiLabels[kk] = vv;
  }

  // ---- sanitize hifz
  const cleanHifzResults = {};
  const rawHifz = __normalizeHifzResultsMap(hifzResults);

  for (const ref of Object.keys(rawHifz)){
    const safeRef = String(ref || "").trim();
    if (!/^\d+:\d+$/.test(safeRef)) continue;

    const row = rawHifz[ref];
    if (!row || typeof row !== "object") continue;

    const cleanRow = {};
    for (const stageKey of Object.keys(row)){
      const safeStage = String(stageKey || "").trim();
      if (!/^(10|[1-9])$/.test(safeStage)) continue;

      const cell = row[stageKey];
      if (!cell || typeof cell !== "object") continue;

      const state = String(cell.state || "neutral").trim().toLowerCase();
      const goodCount = Math.max(0, Number(cell.goodCount) || 0);

      cleanRow[safeStage] = {
        state: (state === "good" || state === "bad") ? state : "neutral",
        goodCount
      };
    }

    if (Object.keys(cleanRow).length) {
      cleanHifzResults[safeRef] = cleanRow;
    }
  }

  if (!Number.isFinite(hifzRepeatTarget) || hifzRepeatTarget < 1) hifzRepeatTarget = 5;
  hifzRepeatTarget = Math.min(100, Math.floor(hifzRepeatTarget));

  hifzStage = /^(10|[1-9])$/.test(String(hifzStage || "")) ? String(hifzStage) : "1";
  hifzRange = String(hifzRange || "").trim() || "5-10";

  const cleanHifzStageTrendHistory = loadHifzStageTrendHistory().slice(-HIFZ_STAGE_TREND_KEEP_DAYS);

  // active preset sanitize
  favActivePreset = String(favActivePreset || "").trim() || "actual";

  return {
    bookmarks,
    notes: cleanNotes,

    // ✅ BOTH style systems
    styleId,
    surfaceId,

    favPresets: cleanFavPresets,
    favActivePreset,
    favGroupTitles: cleanGroupTitles,
    favGroupMap: cleanGroupMap,
    favGroupCollapsed: cleanCollapsed,
    habashiLabels: cleanHabashiLabels,

    // ✅ HIFZ
    hifzResults: cleanHifzResults,
    hifzRepeatTarget,
    hifzStage,
    hifzRange,
    hifzStageTrendHistory: cleanHifzStageTrendHistory,
  };
}

function __applyAccountStateToLocal(state){
  try{
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(state || {}, key);

    // Base
    const b = Array.isArray(state?.bookmarks) ? state.bookmarks : null;
    const n = (state?.notes && typeof state.notes === "object") ? state.notes : null;
    const s = (typeof state?.styleId === "string") ? String(state.styleId) : "";

    // ✅ NEW: 2nd theme button (surface)
    const sf = (typeof state?.surfaceId === "string") ? String(state.surfaceId) : "";

    const hasNonEmptyBookmarks = Array.isArray(b) && b.length > 0;
    const hasNonEmptyNotes = !!n && Object.keys(n).length > 0;

    const hasNonEmptyFavPresets =
      !!state?.favPresets &&
      typeof state.favPresets === "object" &&
      Object.keys(state.favPresets).length > 0;

    const hasNonEmptyFavGroupTitles =
      Array.isArray(state?.favGroupTitles) &&
      state.favGroupTitles.length > 0;

    const hasNonEmptyFavGroupMap =
      !!state?.favGroupMap &&
      typeof state.favGroupMap === "object" &&
      Object.keys(state.favGroupMap).length > 0;

    const hasNonEmptyFavGroupCollapsed =
      !!state?.favGroupCollapsed &&
      typeof state.favGroupCollapsed === "object" &&
      Object.keys(state.favGroupCollapsed).length > 0;

    const hasHifzResults = hasOwn("hifzResults");
    const hasHifzRepeatTarget = hasOwn("hifzRepeatTarget");
    const hasHifzStage = hasOwn("hifzStage");
    const hasHifzRange = hasOwn("hifzRange");
    const hasHifzStageTrendHistory = hasOwn("hifzStageTrendHistory");

    if (hasNonEmptyBookmarks) {
      localStorage.setItem("q_bookmarks_v1", JSON.stringify(b));
    }

    if (hasNonEmptyNotes) {
      localStorage.setItem("q_notes_v1", JSON.stringify(n));
    }

    if (s) {
      localStorage.setItem(LS_STYLE_THEME, s);
    }

    // ✅ save surface id via official helper (same key used everywhere)
    if (sf) {
      try { saveSurfaceThemeId(sf); } catch {}
    }

    // Favorites (optional/backward-compatible)
    if (hasNonEmptyFavPresets) {
      localStorage.setItem(LS_FAV_PRESETS, JSON.stringify(state.favPresets));
    }

    if (typeof state?.favActivePreset === "string" && state.favActivePreset.trim()) {
      localStorage.setItem(LS_FAV_ACTIVE_PRESET, String(state.favActivePreset));
    }

    if (hasNonEmptyFavGroupTitles) {
      localStorage.setItem(LS_FAV_GROUP_TITLES, JSON.stringify(state.favGroupTitles));
    }

    if (hasNonEmptyFavGroupMap) {
      localStorage.setItem(LS_FAV_GROUP_MAP, JSON.stringify(state.favGroupMap));
    }

    if (hasNonEmptyFavGroupCollapsed) {
      localStorage.setItem(LS_FAV_GROUP_COLLAPSED, JSON.stringify(state.favGroupCollapsed));
    }

    // ✅ HIFZ
    if (hasHifzResults) {
      const cleanResults = __normalizeHifzResultsMap(state?.hifzResults);
      if (Object.keys(cleanResults).length > 0) {
        __hifzResultsCache = cleanResults;
        localStorage.setItem(LS_HIFZ_RESULTS, JSON.stringify(cleanResults));
      }
    }

    if (hasHifzRepeatTarget) {
      const nTarget = Math.max(1, Math.min(100, Number(state?.hifzRepeatTarget) || 5));
      __hifzRepeatTargetCache = nTarget;
      localStorage.setItem(LS_HIFZ_REPEAT_TARGET, String(nTarget));
    }

    if (hasHifzStage) {
      const safeStage = /^(10|[1-9])$/.test(String(state?.hifzStage || "")) ? String(state.hifzStage) : "1";
      hifzStageValue = safeStage;
      localStorage.setItem(LS_HIFZ_STAGE, safeStage);
    }

    if (hasHifzRange) {
      const safeRange = String(state?.hifzRange || "").trim() || "5-10";
      hifzRangeValue = safeRange;
      localStorage.setItem(LS_HIFZ_RANGE, safeRange);
    }

    if (
      hasHifzStageTrendHistory &&
      Array.isArray(state?.hifzStageTrendHistory) &&
      state.hifzStageTrendHistory.length > 0
    ) {
      saveHifzStageTrendHistory(state.hifzStageTrendHistory);
    }

    // UI refresh hooks
    try { window.__refreshFavCount?.(); } catch(e) {}
    try { window.__refreshFavButtonDecor?.(); } catch(e) {}
    try { window.__refreshNoteIndicators?.(); } catch(e) {}
    try { window.__refreshAccountHifzScore?.(); } catch(e) {}

    // Wenn wir gerade in Favorites sind: Seite neu rendern
    try{
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
        renderFavoritesPage();
      }
    }catch{}

    // Style anwenden
    try{
      if (s) window.quranStyleSet?.(s);
    }catch{}

    // ✅ Surface anwenden (Preview=true damit kein extra Save/Sync-Loop entsteht)
    try{
      if (sf) applySurfaceThemeById(sf, { preview:true });
    }catch{}
  }catch{}
}
// Pull vom Server -> localStorage setzen
async function __accountPull(){
  if (!__isLoggedIn()) {
    throw new Error("Not logged in.");
  }

  let res;
  let txt = "";
  let j = null;

  try{
    res = await fetch(`${ACCOUNT_API_BASE}/api/state`, {
      method: "GET",
      headers: __authHeaders(),
    });
  }catch(e){
    throw new Error(`Account load request failed: ${String(e?.message || e)}`);
  }

  try{
    txt = await res.text();
  }catch(e){
    throw new Error(`Account load response could not be read: ${String(e?.message || e)}`);
  }

  try{
    j = txt ? JSON.parse(txt) : {};
  }catch{
    j = { ok:false, error: txt || "Bad JSON" };
  }

  if (!res.ok) {
    throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
  }

  if (!j || !j.ok) {
    throw new Error(j?.error || j?.message || "Account load failed.");
  }

  const state = (j.state && typeof j.state === "object") ? j.state : {};
  const keyCount = Object.keys(state).length;

  if (keyCount > 0) {
    __applyAccountStateToLocal(state);
  }

  return {
    ok: true,
    empty: keyCount === 0,
    keyCount
  };
}

async function __accountPush(){
  if (!__isLoggedIn()) return false;

  const payload = __collectLocalAccountState();

  try{
    const res = await fetch(`${ACCOUNT_API_BASE}/api/state`, {
      method: "PUT",
      headers: __authHeaders(),
      body: JSON.stringify({ state: payload }),
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    return !!(j && j.ok);
  }catch{
    return false;
  }
}

// Debounced: nach Änderungen (Bookmark/Note/Style) einmal speichern
function __accountScheduleSync(){
  if (!__isLoggedIn()) {
    try { window.__refreshAccountSyncUi?.(); } catch {}
    return;
  }

  if (__hasAccountSyncConflict()) {
    try { window.__refreshAccountSyncUi?.(); } catch {}
    return;
  }

  try { __setAccountSyncUiState("pending", { mode:"live" }); } catch {}

  if (__syncTimer) clearTimeout(__syncTimer);
  __syncTimer = setTimeout(async () => {
    __syncTimer = 0;
    if (__syncInFlight) return;

    __syncInFlight = true;

    try {
      __setAccountSyncUiState("syncing", { mode:"live" });

      const ok = await __accountPush();

      if (ok) __markAccountSynced("live");
      else __setAccountSyncUiState("error", { mode:"live" });
    } catch {
      __setAccountSyncUiState("error", { mode:"live" });
    } finally {
      __syncInFlight = false;
    }
  }, 350);
}

// Damit styles.js uns triggern kann:
window.__accountScheduleSync = __accountScheduleSync;

// ✅ Favorites Delta Sync (klein statt riesige favPresets zu pushen)
async function __accountSendFavEvent(ev){
  try{
    if (!__isLoggedIn()) return false;
    if (__hasAccountSyncConflict()) return false;

    const res = await fetch(`${ACCOUNT_API_BASE}/api/fav-event`, {
      method: "POST",
      headers: __authHeaders(),
      body: JSON.stringify({ event: ev || {} }),
    });

    const j = await res.json().catch(() => ({}));
    return !!(res.ok && j && j.ok);
  }catch{
    return false;
  }
}

// ✅ Queue: damit Events nicht “verloren gehen”, wenn du direkt logout machst
let __favEvQ = Promise.resolve(true);

function __accountFavEventQueued(ev){
  if (!__isLoggedIn()) return Promise.resolve(false);
  if (__hasAccountSyncConflict()) return Promise.resolve(false);
  __favEvQ = __favEvQ.then(() => __accountSendFavEvent(ev));
  return __favEvQ;
}

// ✅ Flush: vor Logout alles rausschieben
async function __accountFlushAll(){
  if (__hasAccountSyncConflict()) return;

  // 1) scheduled full sync sofort ausführen (falls timer läuft)
  try{
    if (__syncTimer){
      clearTimeout(__syncTimer);
      __syncTimer = 0;
      if (!__syncInFlight){
        __syncInFlight = true;
        try { await __accountPush(); } finally { __syncInFlight = false; }
      }
    }
  }catch{}

  // 2) fav-events queue abwarten
  try{ await __favEvQ; }catch{}
}

window.__accountFavEvent = __accountSendFavEvent;
window.__accountFavEventQueued = __accountFavEventQueued;
window.__accountFlushAll = __accountFlushAll;

// Beim Laden: wenn Token existiert -> Serverstate holen
domReady().then(() => {
  if (__isLoggedIn()){
    if (__hasAccountSyncConflict()) {
      try { window.__refreshAccountSyncUi?.(); } catch {}
      return;
    }

    try { __setAccountSyncUiState("syncing", { mode:"account" }); } catch {}

    __accountPull()
      .then((pull) => {
        if (pull?.ok) {
          try { __markAccountSynced("account"); } catch {}
        } else {
          try { __setAccountSyncUiState("error", { mode:"account" }); } catch {}
        }
      })
      .catch(() => {
        try { __setAccountSyncUiState("error", { mode:"account" }); } catch {}
      });
  } else {
    try { window.__refreshAccountSyncUi?.(); } catch {}
  }
});

// =========================
// BOOKMARKS (localStorage)
// =========================
const LS_BOOKMARKS = "q_bookmarks_v1";

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(LS_BOOKMARKS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // nur gültige refs
    return arr.filter((r) => /^\d+:\d+$/.test(String(r)));
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  try {
    const uniq = Array.from(new Set((list || []).map(String))).filter((r) => /^\d+:\d+$/.test(r));
    localStorage.setItem(LS_BOOKMARKS, JSON.stringify(uniq));

    // ✅ account sync (nur wenn eingeloggt)
    try { window.__accountScheduleSync?.(); } catch(e) {}

    return uniq;
  } catch {
    return (list || []).slice();
  }
}

function isBookmarked(ref) {
  const r = String(ref || "");
  const b = loadBookmarks();
  return b.includes(r);
}

function toggleBookmark(ref) {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return { ok: false, bookmarked: false, list: loadBookmarks() };

  const b = loadBookmarks();
  const idx = b.indexOf(r);

  let next;
  let bookmarked;
  if (idx >= 0) {
    b.splice(idx, 1);
    next = saveBookmarks(b);
    bookmarked = false;
  } else {
    b.push(r);
    next = saveBookmarks(b);
    bookmarked = true;
  }

  // ✅ NUR actual-count updaten (Presets sind getrennt!)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ NEU: Fav-Button Deko (Progress + Marks) neu berechnen
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}

  return { ok: true, bookmarked, list: next };
}

// =========================
// COPY (Ayah text + 1st translation + URL)
// =========================
async function copyTextToClipboard(text) {
  const s = String(text ?? "").trim();
  if (!s) return false;

  // modern
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {}

  // fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch {}

  return false;
}

async function buildCopyPayloadForRef(ref) {
  const a = getAyah(ref);
  if (!a) return "";

  const ar = String(a.textAr || "").trim();

  // first active translation (if loaded; else try load once)
  let tr = "";
  try {
    const first = (activeTranslations && activeTranslations[0]) ? activeTranslations[0] : null;
    if (first?.file) {
      let tJson = translationCache.get(first.file);
      if (!tJson) {
        try { tJson = await loadTranslationFile(first.file); } catch {}
      }
      if (tJson) tr = getTranslationTextFromJson(tJson, a.surah, a.ayah) || "";
    }
  } catch {}

  const url = (() => {
    // URL soll auf diese Ayah zeigen
    try {
      const base = location.href.split("#")[0];
      return `${base}#/${ref}`;
    } catch {
      return location.href;
    }
  })();

  const parts = [];
  if (ar) parts.push(ar);
  if (tr) parts.push(tr);
  parts.push(url);

  return parts.join("\n\n");
}

async function copyAyahRef(ref, { flashEl = null } = {}) {
  const payload = await buildCopyPayloadForRef(ref);
  const ok = await copyTextToClipboard(payload);

  if (flashEl) {
    flashEl.classList.add("is-copied");
    setTimeout(() => flashEl.classList.remove("is-copied"), 1000);
  }

  return ok;
}

// =========================
// NOTES (localStorage) – Ayah Notes
// =========================
const LS_NOTES = "q_notes_v1";
let __notesMapCache = {};
let __notesMapCacheReady = false;

function __normalizeNotesMap(obj){
  return (obj && typeof obj === "object") ? { ...obj } : {};
}

function __invalidateNotesMapCache(){
  __notesMapCache = {};
  __notesMapCacheReady = false;
}

function loadNotesMap(){
  if (__notesMapCacheReady) return __notesMapCache;

  try{
    const raw = localStorage.getItem(LS_NOTES);
    if (!raw) {
      __notesMapCache = {};
      __notesMapCacheReady = true;
      return __notesMapCache;
    }

    const obj = JSON.parse(raw);
    __notesMapCache = __normalizeNotesMap(obj);
    __notesMapCacheReady = true;
    return __notesMapCache;
  }catch{
    __notesMapCache = {};
    __notesMapCacheReady = true;
    return __notesMapCache;
  }
}

// ✅ Für "notes only" (Favorites Dropdown): alle Refs mit nicht-leeren Notes
function getNotesOnlyRefs(){
  try{
    const map = loadNotesMap();
    const keys = Object.keys(map || {});
    const refs = keys.filter((r) => {
      if (!/^\d+:\d+$/.test(String(r))) return false;
      const v = map?.[r];
      return (typeof v === "string") && !!v.trim();
    });
    return _sortRefs(refs);
  }catch{
    return [];
  }
}

function saveNotesMap(obj){
  const clean = __normalizeNotesMap(obj);

  __notesMapCache = clean;
  __notesMapCacheReady = true;

  try{
    localStorage.setItem(LS_NOTES, JSON.stringify(clean));
  }catch{}
}

function getNoteForRef(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return "";
  const map = loadNotesMap();
  const v = map?.[r];
  return (typeof v === "string") ? v : "";
}

function setNoteForRef(ref, text){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const t = String(text ?? "");
  const map = { ...loadNotesMap() };

  // leer => löschen
  if (!t.trim()){
    if (r in map) delete map[r];
  } else {
    map[r] = t;
  }

  saveNotesMap(map);

  // ✅ UI sofort updaten (Ayahcards + Mushaf)
  try { window.__refreshNoteIndicators?.(); } catch(e){}

  // ✅ account sync (nur wenn eingeloggt)
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

// toggles CSS classes im DOM je nach Note-Existenz
window.__refreshNoteIndicators = function(){
  try{
    const map = loadNotesMap();

    // Ayah cards
    document.querySelectorAll('button.ayahNoteBtn[data-note]').forEach((btn)=>{
      const r = String(btn.dataset?.note || "");
      const v = map?.[r];
      const has = (typeof v === "string") && !!v.trim();
      btn.classList.toggle("is-has-note", has);
    });

    // Mushaf numbers
    document.querySelectorAll('.mNo[data-ref]').forEach((noBtn)=>{
      const r = String(noBtn.getAttribute("data-ref") || "");
      const v = map?.[r];
      const has = (typeof v === "string") && !!v.trim();
      noBtn.classList.toggle("is-note", has);
    });
  }catch(e){}
};

window.addEventListener("storage", (e) => {
  if (!e || e.key !== LS_NOTES) return;
  __invalidateNotesMapCache();
  try { window.__refreshNoteIndicators?.(); } catch(e){}
});

function ensureNotesModal(){
  let ov = document.getElementById("notesOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "notesOverlay";
  ov.className = "notesOverlay";
  ov.innerHTML = `
    <div class="notesModal" role="dialog" aria-modal="true" aria-label="Notes">
      <div class="notesHeader">
        <div class="notesTitle">
          <span class="notesLabel">notes</span>
          <span class="notesRef" id="notesRef">—</span>
        </div>
        <button class="notesClose" id="notesClose" type="button" aria-label="Close notes" title="Close">✕</button>
      </div>

      <textarea class="notesText" id="notesText" spellcheck="false" placeholder="Write your notes here..."></textarea>

      <div class="notesFooter">
        <div class="notesHint">auto-saved</div>
      </div>
    </div>
  `;

  document.body.appendChild(ov);

  const modal = ov.querySelector(".notesModal");
  const btnClose = ov.querySelector("#notesClose");
  const refEl = ov.querySelector("#notesRef");
  const ta = ov.querySelector("#notesText");

  // Close handlers
  const close = () => {
    ov.classList.remove("is-open");
    ov.removeAttribute("data-ref");
  };

  ov.addEventListener("click", (e) => {
    // click outside modal closes
    if (e.target === ov) close();
  });

  btnClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  window.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
  });

  // Auto-save (debounced)
  let saveT = 0;
  ta.addEventListener("input", () => {
    const ref = ov.getAttribute("data-ref") || "";
    if (!ref) return;

    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => {
      setNoteForRef(ref, ta.value);
      saveT = 0;
    }, 250);
  });

  // expose helpers on element (internal)
  ov._notes = { close, refEl, ta, modal };

  return ov;
}

function openNotesForRef(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const ov = ensureNotesModal();
  const api = ov._notes;

  ov.setAttribute("data-ref", r);
  api.refEl.textContent = r;
  api.ta.value = getNoteForRef(r);

  ov.classList.add("is-open");

  // focus textarea
  try{
    api.ta.focus({ preventScroll: true });
    api.ta.setSelectionRange(api.ta.value.length, api.ta.value.length);
  }catch{}
}

// =========================
// FAVORITES PAGE (Ayah-Mode only)
// =========================
function _sortRefs(refs) {
  return (refs || [])
    .map(String)
    .filter((r) => /^\d+:\d+$/.test(r))
    .sort((a, b) => {
      const [as, aa] = a.split(":").map(Number);
      const [bs, ba] = b.split(":").map(Number);
      if (as !== bs) return as - bs;
      return aa - ba;
    });
}

function _isConsecutive(a, b) {
  const [as, aa] = String(a).split(":").map(Number);
  const [bs, ba] = String(b).split(":").map(Number);
  return as === bs && ba === aa + 1;
}

// =========================
// FAVORITES PRESETS (localStorage)
// =========================
const LS_FAV_PRESETS = "q_fav_presets_v1";
const LS_FAV_ACTIVE_PRESET = "q_fav_active_preset_v1";

// ✅ Virtual preset: zeigt alle Ayat mit Notes
const FAV_NOTES_ONLY_KEY = "__notes_only__";
const FAV_NOTES_ONLY_LABEL = "notes only";

// =========================
// HABASHI (hb-xx) UI + Labels + Locking
// =========================
const HABASHI_KEY_PREFIX = "hb-"; // hb-01, hb-02, ...
const HABASHI_GROUP_TITLE = "identify sihr/ayn threw quran"; // <- bleibt der interne Gruppen-Key
const HABASHI_GROUP_TITLE_UI = "identify sihr/ayn threw quran (Khalid al habashi presets)";
const LS_HABASHI_LABELS = "q_habashi_labels_v1"; // key -> "Pretty Name (Note)"
const LS_HABASHI_SEEDED = "q_habashi_seeded_v1"; // einmaliges Seed
const LS_FAV_GROUP_COLLAPSED = "q_fav_group_collapsed_v1"; // title -> true/false

// ✅ FIX: verhindert Crash nach Reset, wenn die Map nicht existiert.
// Wenn du später eine echte DE->EN Map hinzufügen willst, kannst du das hier ersetzen.
const HABASHI_DE_TO_EN = (typeof window !== "undefined" && window.HABASHI_DE_TO_EN)
  ? window.HABASHI_DE_TO_EN
  : {};

function isHabashiKey(name){
  const n = String(name || "").trim().toLowerCase();
  return n.startsWith(HABASHI_KEY_PREFIX) && /^hb-\d{2}$/.test(n);
}

function habashiKey(nr){
  const n = Number(nr || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${HABASHI_KEY_PREFIX}${String(n).padStart(2,"0")}`;
}

// baut den UI-Label-Text (English titles + English notes in parentheses)
function habashiLabel(theme){
  const nr = Number(theme?.nr || 0);
  const key = habashiKey(nr); // -> "hb-01"

  // ✅ English titles for ALL 36 Habashi pages
  const HABASHI_TITLE_EN_BY_KEY = {
    "hb-01": "General Ruqyah",
    "hb-02": "Evil Eye & Envy",
    "hb-03": "Sihr (Magic)",
    "hb-04": "Anxiety Relief",
    "hb-05": "Harq",
    "hb-06": "Learning & Focus",
    "hb-07": "Tawhid Proof",
    "hb-08": "Marriage & Family",
    "hb-09": "Jinn Diagnosis",
    "hb-10": "Punishment Verses",
    "hb-11": "Subduing Power",
    "hb-12": "Call to Guidance",
    "hb-13": "Jewish Jinn",
    "hb-14": "Christian Jinn",
    "hb-15": "Lover Jinn",
    "hb-16": "Parents’ Rights",
    "hb-17": "Oppression Warning",
    "hb-18": "Battle Verses",
    "hb-19": "Victory & Opening",
    "hb-20": "Patience (Sabr)",
    "hb-21": "Worship Verses",
    "hb-22": "Charity Blocks",
    "hb-23": "Blessings (Ni‘ma)",
    "hb-24": "Exit & Expulsion",
    "hb-25": "Stars & Planets",
    "hb-26": "Birds",
    "hb-27": "Sea",
    "hb-28": "Mountains",
    "hb-29": "Graves & Shirk",
    "hb-30": "Walking & Legs",
    "hb-31": "Reviving (Ihya’)",
    "hb-32": "Desire & Temptation",
    "hb-33": "Knots & Fortresses",
    "hb-34": "Angels",
    "hb-35": "Provision (Rizq)",
    "hb-36": "Paradise (Jannah)",
  };

  // ✅ English notes (in parentheses) for ALL 36 Habashi pages
  const HABASHI_NOTE_EN_BY_KEY = {
    "hb-01": "General ruqyah base ayat",
    "hb-02": "Protection from envy/ayn",
    "hb-03": "Break sihr and protect",
    "hb-04": "For calmness and peace",
    "hb-05": "Burn jinn interference",
    "hb-06": "Clear learning/focus blocks",
    "hb-07": "Weaken jinn, prove truth",
    "hb-08": "Sihr/ayn in marriage",
    "hb-09": "Reveal jinn presence",
    "hb-10": "Torment and weaken jinn",
    "hb-11": "Overpower strong jinn",
    "hb-12": "Invite to guidance",
    "hb-13": "Expose/harm “Jewish” jinn",
    "hb-14": "Expose/harm “Christian” jinn",
    "hb-15": "Expose/strike lover jinn",
    "hb-16": "Break satanic influence",
    "hb-17": "Warn and push exit",
    "hb-18": "Break/kill rebellious jinn",
    "hb-19": "Victory in hard cases",
    "hb-20": "Strengthen patience, weaken",
    "hb-21": "Burn ayn/hasad effects",
    "hb-22": "Remove charity blockages",
    "hb-23": "Expose the envier",
    "hb-24": "Expel from body/home",
    "hb-25": "Astral/star-related sihr",
    "hb-26": "Reveal flying jinn",
    "hb-27": "Reveal “diver” jinn",
    "hb-28": "Caves/mountain sihr cases",
    "hb-29": "Grave sihr & shirk",
    "hb-30": "Paralysis-related cases",
    "hb-31": "Extreme weakness, coma, cancer",
    "hb-32": "Lover jinn / dawah",
    "hb-33": "Break knots/fortresses",
    "hb-34": "Harsh jinn expulsion",
    "hb-35": "Solve rizq blockages",
    "hb-36": "No content listed",
  };

  // Title: use our English map first, fallback to existing DE->EN logic
  const de = String(theme?.title_de || "").trim();
  const titleEn =
    String(HABASHI_TITLE_EN_BY_KEY[key] || "").trim() ||
    (HABASHI_DE_TO_EN[de] || de || `Preset ${nr}`);

  // Note: use our English note first, fallback to JSON note fields
  const noteFromJson =
    String(theme?.note || "").trim() ||
    String(theme?.note_de || "").trim() ||
    String(theme?.note_en || "").trim() ||
    String(theme?.comment || "").trim() ||
    String(theme?.remark || "").trim() ||
    String(theme?.purpose || "").trim() ||
    String(theme?.why || "").trim() ||
    "";

  const noteEn =
    String(HABASHI_NOTE_EN_BY_KEY[key] || "").trim() ||
    noteFromJson;

  const notePart = noteEn ? ` (${noteEn})` : "";
  return `Habashi ${String(nr).padStart(2,"0")} — ${titleEn}${notePart}`;
}

async function fetchHabashiJson(){
  // deine Datei liegt neben index.html (wie vorher)
  const tryUrls = [
    "ruqyah_themes_with_ayahs.json",
    "./ruqyah_themes_with_ayahs.json",
    "ruqyah_themes_with_ayahs (1).json",
    "./ruqyah_themes_with_ayahs (1).json",
  ];
  let lastErr = null;
  for (const u of tryUrls){
    try{
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
      return await res.json();
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("Habashi JSON not found");
}

function loadHabashiLabels(){
  try{
    const raw = localStorage.getItem(LS_HABASHI_LABELS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveHabashiLabels(obj){
  try{ localStorage.setItem(LS_HABASHI_LABELS, JSON.stringify(obj || {})); }catch{}
}

// ✅ One-time seed into localStorage (new users automatically get it)
// - Presets hb-xx anlegen (wenn fehlen)
// - unter den Habashi-Titel mappen
// - Labels mit "— Note" speichern
async function seedHabashiPresetsIfNeeded(){
  try{
    if (localStorage.getItem(LS_HABASHI_SEEDED) === "1") return;
  }catch{}

  let json = null;
  try{
    json = await fetchHabashiJson();
  }catch(e){
    // ✅ JSON optional: App darf nicht crashen.
    // ❗️Aber: NICHT als "seeded" markieren, sonst wird nach einem temporären Fehler nie wieder versucht.
    return;
  }

  const themes = Array.isArray(json?.themes) ? json.themes : [];
  if (!themes.length){
    try{ localStorage.setItem(LS_HABASHI_SEEDED, "1"); }catch{}
    return;
  }

  const presets = loadFavPresets();
  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();
  const labels = loadHabashiLabels();

  let changed = false;
  let labelsChanged = false;

  // ensure title exists
  if (!titles.includes(HABASHI_GROUP_TITLE)){
    titles.push(HABASHI_GROUP_TITLE);
    changed = true;
  }

  // helper: "ayah_refs" -> ["2:1","2:2",...]
  const expandAyahRefs = (ayahRefs) => {
    const out = [];
    const arr = Array.isArray(ayahRefs) ? ayahRefs : [];
    for (const rr of arr){
      const s = Number(rr?.surah_id || 0);
      if (!Number.isFinite(s) || s < 1 || s > 114) continue;
      const a1 = Number(rr?.ayah_start || rr?.ayah || 0);
      const a2 = Number(rr?.ayah_end || a1);
      if (!Number.isFinite(a1) || a1 <= 0) continue;

      const lo = Math.max(1, Math.min(a1, a2));
      const hi = Math.max(lo, Math.max(a1, a2));
      for (let a = lo; a <= hi; a++) out.push(`${s}:${a}`);
    }
    const uniq = Array.from(new Set(out)).filter(r => /^\d+:\d+$/.test(r));
    try{ return _sortRefs(uniq); } catch { return uniq; }
  };

  for (const t of themes){
    const key = habashiKey(t?.nr);
    if (!key) continue;

    // add preset if missing
    if (!Array.isArray(presets[key]) || presets[key].length === 0){
      presets[key] = expandAyahRefs(t?.ayah_refs);
      changed = true;
    }

    // map to title (so it appears under this title)
    if (map[key] !== HABASHI_GROUP_TITLE){
      map[key] = HABASHI_GROUP_TITLE;
      changed = true;
    }

    // pretty label speichern
    const pretty = habashiLabel(t);
    if (pretty && labels[key] !== pretty){
      labels[key] = pretty;
      labelsChanged = true;
    }
  }

  if (changed){
    saveFavPresets(presets);
    saveFavGroupMap(map);
    saveFavGroupTitles(titles);
  }
  if (labelsChanged){
    saveHabashiLabels(labels);
  }

  try{ localStorage.setItem(LS_HABASHI_SEEDED, "1"); }catch{}
}

// ✅ Optional: Wenn du irgendwo schon “Notizen/Anmerkungen” pro hb-xx hast,
// kannst du sie jederzeit so speichern:
// labels["hb-01"] = "General Ruqyah (…deine Anmerkung…)"
// Dann zeigt UI automatisch diese Namen.

function labelForGroupTitle(title){
  const t = String(title || "");
  if (t === HABASHI_GROUP_TITLE) return HABASHI_GROUP_TITLE_UI;
  return t;
}

function labelForPresetName(name){
  const n = String(name || "");
  if (n === FAV_NOTES_ONLY_KEY) return FAV_NOTES_ONLY_LABEL;

  // ✅ Habashi pages: schöner Name aus localStorage (falls vorhanden)
  if (isHabashiKey(n)){
    try{
      const labels = loadHabashiLabels();
      const v = labels?.[n];
      if (typeof v === "string" && v.trim()) return v.trim();
    }catch{}
    // fallback
    return `${n}`; // bleibt hb-01, hb-02 ... wenn noch kein Label gesetzt wurde
  }

  return n || "actual";
}

function loadFavGroupCollapsed(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_COLLAPSED);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavGroupCollapsed(obj){
  try{ localStorage.setItem(LS_FAV_GROUP_COLLAPSED, JSON.stringify(obj || {})); }catch{}

  // ✅ Delta: nur collapsed-state schicken (klein)
  try{
    window.__accountFavEvent?.({
      t: "favGroupCollapsedSet",
      value: obj || {}
    });
  }catch{}
}

function isLockedTitle(title){
  return String(title || "") === HABASHI_GROUP_TITLE;
}

function isLockedPreset(name){
  const n = String(name || "");
  if (!n) return false;
  if (n === "actual") return true;
  if (n === FAV_NOTES_ONLY_KEY) return true;
  if (isHabashiKey(n)) return true;
  return false;
}

// ✅ Beim Start direkt die zuletzt aktive Favoritenseite laden (damit favCount nach Reload stimmt)
let favPresetActiveName = loadActiveFavPreset();   // "actual" ODER preset-name aus localStorage
let favActualSnapshot = [];                        // optional: merken, was "actual" beim Öffnen war

function loadFavPresets(){
  try{
    const raw = localStorage.getItem(LS_FAV_PRESETS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavPresets(obj){
  try{
    localStorage.setItem(LS_FAV_PRESETS, JSON.stringify(obj || {}));
  }catch{}

  // ❗️WICHTIG: KEIN auto full-sync mehr hier.
  // Favorites werden als Delta-Events gesynct (siehe toggleFavInActivePage / setPresetGroup / removeGroupTitle).
}

function normalizePresetName(name){
  // ✅ erlaubt deutlich längere Titel (du kannst das jederzeit erhöhen)
  const MAX_LEN = 200;

  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_LEN);
}

function listPresetNames(presetsObj){
  return Object.keys(presetsObj || {})
    .map(normalizePresetName)
    .filter(Boolean)
    .sort((a,b)=>a.localeCompare(b));
}

function saveActiveFavPreset(name){
  try{
    const n = normalizePresetName(name) || "actual";
    localStorage.setItem(LS_FAV_ACTIVE_PRESET, n);
  }catch{}

  // ✅ account sync (nur wenn eingeloggt)
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

function loadActiveFavPreset(){
  try{
    const raw = localStorage.getItem(LS_FAV_ACTIVE_PRESET);
    const n = normalizePresetName(raw);
    return n || "actual";
  }catch{
    return "actual";
  }
}

// =========================
// Favorites Groups (Titles) – localStorage + account delta sync
// =========================
const LS_FAV_GROUP_TITLES = "q_fav_group_titles_v1";   // ["Dua", "Study", ...]
const LS_FAV_GROUP_MAP    = "q_fav_group_map_v1";      // { "pageName": "Dua", ... }

function loadFavGroupTitles(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_TITLES);
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizePresetName).filter(Boolean);
  }catch{
    return [];
  }
}

function saveFavGroupTitles(arr){
  try{
    const clean = Array.from(new Set((arr || []).map(normalizePresetName))).filter(Boolean);
    localStorage.setItem(LS_FAV_GROUP_TITLES, JSON.stringify(clean));

    // ✅ delta sync: komplette titles-liste (sehr klein)
    try{
      window.__accountFavEventQueued?.({ t:"groupTitlesSet", titles: clean, at: Date.now() });
    }catch{}

    return clean;
  }catch{
    return (arr || []).slice();
  }
}

function loadFavGroupMap(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_MAP);
    const obj = JSON.parse(raw || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavGroupMap(obj){
  try{
    localStorage.setItem(LS_FAV_GROUP_MAP, JSON.stringify(obj || {}));
  }catch{}
}

function setPresetGroup(presetName, groupName){
  const name = normalizePresetName(presetName);
  const group = normalizePresetName(groupName);

  const map = loadFavGroupMap();
  if (!name || name === "actual") return;

  if (!group){
    delete map[name];
    saveFavGroupMap(map);

    // ✅ delta sync: ungroup
    try{
      window.__accountFavEventQueued?.({ t:"presetSetGroup", preset: name, group:"", at: Date.now() });
    }catch{}
    return;
  }

  map[name] = group;
  saveFavGroupMap(map);

  // group sicher in titles-list halten
  const titles = loadFavGroupTitles();
  if (!titles.includes(group)){
    titles.push(group);
    saveFavGroupTitles(titles);
  }

  // ✅ delta sync: set group for preset
  try{
    window.__accountFavEventQueued?.({ t:"presetSetGroup", preset: name, group, at: Date.now() });
  }catch{}
}

function removeGroupTitle(groupName){
  const g = normalizePresetName(groupName);
  if (!g) return;

  // title entfernen
  const titles = loadFavGroupTitles().filter(t => t !== g);
  saveFavGroupTitles(titles);

  // mapping cleanup
  const map = loadFavGroupMap();
  for (const k of Object.keys(map)){
    if (map[k] === g) delete map[k];
  }
  saveFavGroupMap(map);

  // ✅ delta sync: remove group server-side (entfernt auch map + collapsed)
  try{
    window.__accountFavEventQueued?.({ t:"groupRemove", group: g, at: Date.now() });
  }catch{}
}


function setActivePresetName(name){
  favPresetActiveName = normalizePresetName(name) || "actual";
  // ✅ merken, welche Seite zuletzt aktiv war
  saveActiveFavPreset(favPresetActiveName);

  // ✅ WICHTIG: favSet muss zur aktiven Seite passen (actual ODER preset-page ODER notes-only)
  try{
    favSet = new Set((getActiveFavRefs?.() || []).map(String));
  }catch(e){
    // fallback: niemals crashen
    try{ favSet = new Set(); }catch{}
  }

  // ✅ vorhandene Mushaf-Buttons sofort updaten (damit Fav-Ringe direkt erscheinen)
  try{
    document.querySelectorAll('.mNo[data-ref]').forEach((noBtn) => {
      const r = String(noBtn.getAttribute("data-ref") || "");
      noBtn.classList.toggle("is-fav", favSet.has(r));
    });
  }catch(e){}

  // ✅ Count im Statusbar-Favorites-Button updaten (passend zur aktiven Seite)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ Marks/Decor sofort aktualisieren (wichtig bei preset-page Wechsel)
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}
}

// ✅ Liefert IMMER nur die aktuell aktive Liste (actual ODER preset-page ODER notes-only)
function getActiveFavRefs(){
  if (!favPresetActiveName || favPresetActiveName === "actual") {
    return _sortRefs(loadBookmarks());
  }

  // ✅ "notes only" = alle Ayat, die Notes haben (unabhängig von Bookmarks/Presets)
  if (favPresetActiveName === FAV_NOTES_ONLY_KEY) {
    try { return getNotesOnlyRefs(); } catch { return []; }
  }

  const pObj = loadFavPresets();
  const arr = Array.isArray(pObj[favPresetActiveName]) ? pObj[favPresetActiveName] : [];
  return _sortRefs(arr);
}

// ✅ Toggle innerhalb der aktiven Seite
// - actual toggelt bookmarks
// - notes-only toggelt bookmarks (weil es nur ein Filter ist)
// - preset toggelt preset-array
function toggleFavInActivePage(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return { ok:false, bookmarked:false, list:[] };

  // actual + notes-only = echte bookmarks
if (!favPresetActiveName || favPresetActiveName === "actual" || favPresetActiveName === FAV_NOTES_ONLY_KEY || isHabashiKey(favPresetActiveName)) {
  const res = toggleBookmark(r);
  return res;
}

  // preset-page = nur preset ändern
  const pObj = loadFavPresets();
  const cur = _sortRefs(Array.isArray(pObj[favPresetActiveName]) ? pObj[favPresetActiveName] : []);
  const idx = cur.indexOf(r);

  let bookmarked;
  if (idx >= 0) {
    cur.splice(idx, 1);
    bookmarked = false;
  } else {
    cur.push(r);
    bookmarked = true;
  }

pObj[favPresetActiveName] = _sortRefs(cur);
saveFavPresets(pObj);

// ✅ Delta: nur EIN Ayah-Change senden
try{
  window.__accountFavEvent?.({
    t: "presetToggle",
    preset: String(favPresetActiveName || ""),
    ref: r,
    on: !!bookmarked
  });
}catch{}

  // ✅ Count im Statusbar-Favorites-Button updaten (Preset-Page hat sich geändert)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ Marks/Decor neu (falls gerade Ayah/Mushaf offen ist)
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}

  return { ok:true, bookmarked, list: pObj[favPresetActiveName] };
}

// =========================
// Favorites Gap Delay (CSS -> JS)
// =========================
function getFavGapMs(){
  try{
    const cs = getComputedStyle(document.documentElement);
    const raw = (cs.getPropertyValue("--fav-gap-ms") || "").trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 500;
  }catch{
    return 500;
  }
}

// =========================
// WebAudio (GainNode) – smooth fades + background-safe
// =========================
let __ac = null;
let __masterGain = null;

function __acNow(){
  try{ return (__ac && typeof __ac.currentTime === "number") ? __ac.currentTime : 0; }catch{ return 0; }
}

function __ensureAudioContext(){
  try{
    if (!__ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;

      __ac = new Ctx();
      __masterGain = __ac.createGain();
      __masterGain.gain.value = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
      __masterGain.connect(__ac.destination);
    }

    // Browser kann suspended starten -> bei User-Gesture (Play-Klick) resuming klappt meist
    if (__ac.state === "suspended") {
      __ac.resume().catch(() => {});
    }
    return __ac;
  }catch{
    return null;
  }
}

function __attachVerseAudioGraph(audioEl){
  if (!audioEl) return false;
  const ac = __ensureAudioContext();
  if (!ac || !__masterGain) return false;

  // schon attached?
  if (audioEl._edgeGain && audioEl._mediaSrc) return true;

  try{
    const src = ac.createMediaElementSource(audioEl);
    const edge = ac.createGain();

    // default = 1 (wird von __initVerseFade gesetzt)
    edge.gain.value = 1;

    src.connect(edge);
    edge.connect(__masterGain);

    audioEl._mediaSrc = src;
    audioEl._edgeGain = edge;

    // Wichtig: MediaElement laut lassen, Lautstärke kommt über GainNodes
    audioEl.volume = 1;

    return true;
  }catch(e){
    // createMediaElementSource kann pro Element nur 1x funktionieren – bei Fehler fallback
    return false;
  }
}

function __setMasterGainFromGlobalVolume(){
  try{
    if (__masterGain && __masterGain.gain) {
      const v = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
      __masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, v)), __acNow());
    }
  }catch{}
}

// =========================
// Ayah Edge (Fade + "Stille") (CSS :root -> JS)
// - pro Reciter steuerbar über :root Variablen
//   NEU (empfohlen):
//     --ayah-edge-ms-default: "<fadeMs> <fadeMinMul> - <silenceMs> <silenceMul>";
//     --ayah-edge-ms-<reciterKey>: "<fadeMs> <fadeMinMul> - <silenceMs> <silenceMul>";
//       Beispiel: "500 0.5 - 50 0.5"
//         - fadeMs:       Dauer vom Fade (ms)
//         - fadeMinMul:   wie tief der Fade runtergeht (0..1)
//         - silenceMs:    Dauer der "Stille"-Phase am Anfang + Ende (ms)
//         - silenceMul:   Lautstärke in der "Stille"-Phase (0..1)  (0 = echte Stille)
//   Backward-Compat (alt):
//     "fadeMs silenceMs" oder "fadeMs silenceMs minMul"
// =========================
function getAyahEdgeProfileForReciter(reciterKey){
  const clamp01 = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  };

  const toks = (s) => String(s || "").trim().split(/[,\s]+/).filter(Boolean);

  // Unterstützt:
  // 1) alt:  "<fadeMs> <silenceMs> <minMul>"
  // 2) neu:  "<fadeMs> <minMul> - <silenceMs> <silenceMul>"
  // 3) auch ohne "-" aber 4 Werte: "<fadeMs> <minMul> <silenceMs> <silenceMul>"
  const parseProfile = (raw) => {
    const str = String(raw || "").trim();
    if (!str) return { fadeMs: 0, silenceMs: 0, minMul: 0, silenceMul: 0 };

    let fadeMs = 0, silenceMs = 0, minMul = 0, silenceMul = 0;

    const groups = str.split("-").map(g => g.trim()).filter(Boolean);

    if (groups.length >= 2) {
      const a = toks(groups[0]); // fade group
      const b = toks(groups[1]); // silence group

      const f0 = parseFloat(a[0]);
      const f1 = (a.length >= 2) ? parseFloat(a[1]) : 0;

      const s0 = parseFloat(b[0]);
      const s1 = (b.length >= 2) ? parseFloat(b[1]) : 0;

      fadeMs = f0;
      minMul = f1;
      silenceMs = s0;
      silenceMul = s1;
    } else {
      const p = toks(groups[0]);
      const a0 = parseFloat(p[0]);
      const a1 = (p.length >= 2) ? parseFloat(p[1]) : 0;
      const a2 = (p.length >= 3) ? parseFloat(p[2]) : 0;
      const a3 = (p.length >= 4) ? parseFloat(p[3]) : 0;

      if (p.length >= 4) {
        // 4 Werte ohne "-" -> interpretieren wie: fadeMs minMul silenceMs silenceMul
        fadeMs = a0;
        minMul = a1;
        silenceMs = a2;
        silenceMul = a3;
      } else {
        // alt: fadeMs silenceMs minMul
        fadeMs = a0;
        silenceMs = a1;
        minMul = a2;
        silenceMul = 0;
      }
    }

    return {
      fadeMs: Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : 0,
      silenceMs: Number.isFinite(silenceMs) ? Math.max(0, silenceMs) : 0,
      minMul: clamp01(minMul),
      silenceMul: clamp01(silenceMul),
    };
  };

  try{
    const cs = getComputedStyle(document.documentElement);
    const key = String(reciterKey || "").trim();

    if (key){
      const rawK = (cs.getPropertyValue(`--ayah-edge-ms-${key}`) || "").trim();
      if (rawK) return parseProfile(rawK);
    }

    const raw = (cs.getPropertyValue("--ayah-edge-ms-default") || "").trim();
    return parseProfile(raw);
  }catch{
    return { fadeMs: 0, silenceMs: 0, minMul: 0, silenceMul: 0 };
  }
}

function __clamp01(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Setzt den "Fade-Multiplikator" (0..1) und wendet ihn sofort auf die echte Lautstärke an.
// Lautstärke bleibt dabei an deinem globalVolume/Slider gekoppelt.
function __applyVerseFadeMul(audioEl, mul){
  if (!audioEl) return;
  const m = __clamp01(mul);
  audioEl._fadeMul = m;

  // ✅ Wenn WebAudio aktiv ist: Edge über GainNode (smooth + background-safe)
  const eg = audioEl._edgeGain;
  if (eg && eg.gain) {
    try{
      // MasterGain kümmert sich um globalVolume, edgeGain ist nur 0..1 Mul
      eg.gain.setValueAtTime(m, __acNow());
      // MediaElement volume auf 1 lassen, damit wir nicht doppelt multiplizieren
      audioEl.volume = 1;
      return;
    }catch{}
  }

  // Fallback (ohne WebAudio)
  try{
    const base = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
    audioEl.volume = Math.max(0, Math.min(1, base * m));
  }catch{}
}

function __cancelVerseFadeRafs(audioEl){
  if (!audioEl) return;

  // alte RAF/timer (falls noch irgendwo)
  try{ if (audioEl._fadeInRaf)  cancelAnimationFrame(audioEl._fadeInRaf); }catch{}
  try{ if (audioEl._fadeOutRaf) cancelAnimationFrame(audioEl._fadeOutRaf); }catch{}
  audioEl._fadeInRaf = 0;
  audioEl._fadeOutRaf = 0;

  try{ if (audioEl._fadeEdgeTimer) clearInterval(audioEl._fadeEdgeTimer); }catch{}
  audioEl._fadeEdgeTimer = 0;

  // ✅ WebAudio schedules stoppen (damit keine “alten” ramps reinfunken)
  try{
    const eg = audioEl._edgeGain;
    if (eg && eg.gain) {
      const now = __acNow();
      eg.gain.cancelScheduledValues(now);
      // nicht knacken: aktuellen Wert halten
      eg.gain.setValueAtTime(__clamp01(audioEl._fadeMul ?? 1), now);
    }
  }catch{}
}

// 🔧 Wichtig: KEIN requestAnimationFrame mehr für die Fade-Logik.
// Hintergrund-Tabs drosseln/stoppen RAF → Audio kann sonst "stumm" hängen bleiben.
// Wir synchronisieren stattdessen über currentTime (wird via timeupdate + play-Event getriggert).
function __initVerseFade(audioEl, { fadeMs = 0, silenceMs = 0, minMul = 0, silenceMul = 0, queueMode = false } = {}){
  if (!audioEl) return;

  const msFade = Math.max(0, Number(fadeMs) || 0);
  const msSilence = Math.max(0, Number(silenceMs) || 0);

  const minLevel = Math.max(0, Math.min(1, Number(minMul) || 0));
  const silLevel = Math.max(0, Math.min(1, Number(silenceMul) || 0));

  __cancelVerseFadeRafs(audioEl);

  audioEl._fadeMs = msFade;
  audioEl._silenceMs = msSilence;
  audioEl._fadeMinMul = minLevel;
  audioEl._silenceMul = silLevel;
  audioEl._fadeMul = 1;

  audioEl._fadeInSilenceSec = msSilence / 1000;
  audioEl._fadeInFadeSec = msFade / 1000;

  audioEl._fadeOutSilenceSec = msSilence / 1000;
  audioEl._fadeOutFadeSec = msFade / 1000;

  audioEl._fadeCutSec = queueMode ? 0 : 0.06;

  audioEl._fadeInDone = false;
  audioEl._fadeOutDone = false;

  // ✅ WebAudio attach (wenn möglich)
  const webOk = __attachVerseAudioGraph(audioEl);

  // ✅ Startlevel:
  // - wenn silenceMs > 0 -> silenceMul
  // - sonst wenn fadeMs > 0 -> silenceMul (meist 0), und wir rammen hoch
  // - sonst -> 1
  const hasEdge = (msFade > 0) || (msSilence > 0);
  const startMul = !hasEdge ? 1 : silLevel;
  __applyVerseFadeMul(audioEl, startMul);

  // ✅ Fade-In Ramp sofort planen (smooth, ohne Stufen)
  if (webOk && audioEl._edgeGain && hasEdge) {
    try{
      const eg = audioEl._edgeGain;
      const now = __acNow();
      eg.gain.cancelScheduledValues(now);

      // kleine “safety” offset gegen clicks
      const t0 = now + 0.005;

      // Phase 1: Silence-Level halten
      const tSilEnd = t0 + (msSilence / 1000);

      eg.gain.setValueAtTime(startMul, t0);
      eg.gain.setValueAtTime(startMul, tSilEnd);

      // Phase 2: Fade-In auf 1
      if (msFade > 0) {
        eg.gain.linearRampToValueAtTime(1, tSilEnd + (msFade / 1000));
      } else {
        eg.gain.setValueAtTime(1, tSilEnd);
      }
    }catch{}
  }

  // ✅ Fade-Out planen, sobald duration sicher da ist + wir wissen wann play wirklich startet
  audioEl._needsFadeOutSchedule = hasEdge && webOk;
}

function __syncVerseEdgeMul(audioEl){
  if (!audioEl) return;

  const t = Number(audioEl.currentTime || 0);
  if (!Number.isFinite(t) || t < 0) return;

  const silenceSec = Math.max(0, Number(audioEl._fadeInSilenceSec) || 0);
  const fadeInSec = Math.max(0, Number(audioEl._fadeInFadeSec) || 0);

  const endSilenceSec = Math.max(0, Number(audioEl._fadeOutSilenceSec) || 0);
  const fadeOutSec = Math.max(0, Number(audioEl._fadeOutFadeSec) || 0);

  const silLevel = __clamp01(audioEl._silenceMul ?? 0);
  const floor = __clamp01(audioEl._fadeMinMul ?? 0);

  // 1) Start (Silence -> FadeIn -> 1)
  let mul = 1;

  const fadeInEnd = silenceSec + fadeInSec;

  if (t < silenceSec) {
    mul = silLevel;
  } else if (fadeInSec > 0 && t < fadeInEnd) {
    const p = Math.max(0, Math.min(1, (t - silenceSec) / fadeInSec));
    mul = silLevel + (1 - silLevel) * p;
  } else {
    mul = 1;
  }

  // 2) End (1 -> FadeOut->floor -> Silence(silLevel))
  const d = Number(audioEl.duration || 0);
  if (Number.isFinite(d) && d > 0) {
    const cutSec = Math.max(0, Number(audioEl._fadeCutSec || 0));
    const stopSec = Math.max(0, d - cutSec);

    const silenceStartSec = Math.max(0, stopSec - endSilenceSec);
    const fadeStartSec = Math.max(0, silenceStartSec - fadeOutSec);

    audioEl._fadeOutStartSec = fadeStartSec;
    audioEl._fadeOutSilenceStartSec = silenceStartSec;
    audioEl._fadeOutStopSec = stopSec;

    if (t >= silenceStartSec) {
      mul = silLevel;
      audioEl._fadeOutDone = true;
    } else if (fadeOutSec > 0 && t >= fadeStartSec) {
      const denom = Math.max(0.000001, (silenceStartSec - fadeStartSec));
      const p = Math.max(0, Math.min(1, (t - fadeStartSec) / denom));
      // p=0 -> 1.0, p=1 -> floor
      mul = 1 - (p * (1 - floor));
    }
  }

  __applyVerseFadeMul(audioEl, mul);
}


// =========================
// Ayah Edge Smooth Driver (Timer-only, Background-safe)
// - KEIN requestAnimationFrame (damit Background weiterläuft)
// - Smooth über setInterval (~60fps), stoppt automatisch nach Fade-In/Fade-Out
// - Wichtig: KEINE doppelte __syncVerseEdgeMul Definition mehr
// =========================
function __startFadeEdgeTimer(audioEl){
  if (!audioEl) return;
  if (audioEl._fadeEdgeTimer) return;

  audioEl._fadeEdgeTimer = setInterval(() => {
    try{
      if (!audioEl) return;
      if (audioEl.ended) { __cancelVerseFadeRafs(audioEl); return; }
      if (audioEl.paused || audioEl.seeking) return;

      __syncVerseEdgeMul(audioEl);

      // Wenn wir sicher “fertig” sind, Timer beenden
      if (audioEl._fadeInDone && audioEl._fadeOutDone) {
        __cancelVerseFadeRafs(audioEl);
      }
    }catch{}
  }, 16);
}

function __maybeStartVerseFadeIn(audioEl){
  if (!audioEl) return;

  // wenn kein Edge aktiv, sofort fertig
  const startSilSec = Math.max(0, Number(audioEl._fadeInSilenceSec) || 0);
  const fadeInSec   = Math.max(0, Number(audioEl._fadeInFadeSec) || 0);
  if ((startSilSec + fadeInSec) <= 0) {
    audioEl._fadeInDone = true;
    __applyVerseFadeMul(audioEl, 1);
    return;
  }

  __startFadeEdgeTimer(audioEl);
  __syncVerseEdgeMul(audioEl);
}

function __maybeStartVerseFadeOut(audioEl){
  if (!audioEl) return;

  const fadeOutSec    = Math.max(0, Number(audioEl._fadeOutFadeSec) || 0);
  const endSilenceSec = Math.max(0, Number(audioEl._fadeOutSilenceSec) || 0);
  if ((fadeOutSec + endSilenceSec) <= 0) return;

  __startFadeEdgeTimer(audioEl);
  __syncVerseEdgeMul(audioEl);
}

// =========================
// Favorites Playback Queue (nur Favorites-Seite)
// Pause/Resume + Auto-Scroll
// =========================
let favQueueRefs = [];
let favQueueIdx = 0;
let favQueueToken = 0;
let favQueuePaused = false;
let favQueueContinueFn = null;

const LS_FAV_REPEAT = "quranm_fav_repeat_v1";
const LS_SURAH_REPEAT = "quranm_surah_repeat_v1";
const LS_VOL = "quranm_volume_v1";

let surahRepeatOn = false;
let globalVolume = 0.3;

function _loadBool(key, def=false){
  try{
    const v = localStorage.getItem(key);
    if (v === null) return def;
    return v === "1" || v === "true";
  }catch(e){ return def; }
}
function _saveBool(key, val){
  try{ localStorage.setItem(key, val ? "1" : "0"); }catch(e){}
}

/* ✅ FIX: wenn LS_VOL nicht existiert -> default benutzen (nicht 0!) */
function _loadVol(def=0.3){
  try{
    const raw = localStorage.getItem(LS_VOL);
    if (raw === null || raw === "") return def;   // <-- wichtig
    const v = Number(raw);
    if (!Number.isFinite(v)) return def;
    return Math.min(1, Math.max(0, v));
  }catch(e){ return def; }
}

function _saveVol(v){
  try{ localStorage.setItem(LS_VOL, String(v)); }catch(e){}
}
function applyGlobalVolume(){
  // ✅ WebAudio master gain (für verseAudio smooth + background-safe)
  try{ __setMasterGainFromGlobalVolume(); }catch{}

  // Fallback / Safety: falls kein WebAudio attached ist
  try{
    if (verseAudio && !verseAudio._edgeGain){
      const mul = Number(verseAudio?._fadeMul);
      const m = Number.isFinite(mul) ? Math.max(0, Math.min(1, mul)) : 1;
      verseAudio.volume = Math.max(0, Math.min(1, globalVolume * m));
    }
  }catch(e){}

  // WordAudio lassen wir wie gehabt (du kannst später auch dafür WebAudio machen)
  try{ if (wordAudio)  wordAudio.volume  = globalVolume; }catch(e){}
}
function syncSurahRepeatUI(){
  try{
    const b = document.getElementById("suraRepeat");
    if (!b) return;
    b.classList.toggle("is-on", !!surahRepeatOn);
  }catch(e){}
}

function isFavRepeatOn(){
  try { return localStorage.getItem(LS_FAV_REPEAT) === "1"; } catch { return false; }
}
function setFavRepeatOn(on){
  try { localStorage.setItem(LS_FAV_REPEAT, on ? "1" : "0"); } catch {}
}

function syncFavRepeatUI(){
  try{
    const on = isFavRepeatOn();

    // Statusbar Button
    if (favRepeatBtn) favRepeatBtn.classList.toggle("is-on", on);

    // Topbar Button (kann beim Rendern neu entstehen)
    const top = document.querySelector("button.favTopRepeat");
    if (top) top.classList.toggle("is-on", on);
  }catch(e){}
}

function setFavPauseUI(show, paused){
  const sb = document.getElementById("statusbar");
  const btn = document.getElementById("favPause");
  if (sb) sb.classList.toggle("is-fav-playing", !!show);
  if (btn){
    btn.classList.toggle("is-paused", !!paused);
    btn.setAttribute("aria-label", paused ? "Resume Favorites" : "Pause Favorites");
  }
}

function __resetSuraPlayProgressState(){
  try{
    // diese Variablen existieren bei dir (Hold-Logik in syncUI)
    __progHoldPct = 0;
    __progHoldSurah = null;
    __progTarget = 0;
    __progVis = 0;
    __progLastT = 0;
  }catch(e){}

  // ✅ Progress-Bar konsequent über transform steuern (nicht width)
  try{
    const p = document.getElementById("progress");
    if (p) p.style.transform = "scaleX(0)";
  }catch(e){}
}

function __hideSuraPlayProgress(){
  try{
    const p = document.getElementById("progress");
    if (p) p.style.transform = "scaleX(0)";
  }catch(e){}
}

function setSuraPauseUI(show, paused, opts = {}) {
  const { syncContinue = true } = opts || {};
  try{
    const sb = document.getElementById("statusbar");
    const btn = document.getElementById("suraPause");
    const rep = document.getElementById("suraRepeat");
    if (!sb || !btn) return;

    // niemals in favorites zeigen
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      sb.classList.remove("is-surah-playing");
      btn.classList.remove("is-paused");
      btn.style.display = "none";
      if (rep) rep.style.display = "none";
      const p = document.getElementById("progress");
      if (p) p.style.transform = "scaleX(0)";
      // ✅ Continue Buttons (optional)
      if (syncContinue) {
        try { __syncContinueButtons(); } catch(e){}
      }
      return;
    }

    // ✅ Hard-UI: niemals “zufällig” sichtbar
    sb.classList.toggle("is-surah-playing", !!show);
    btn.classList.toggle("is-paused", !!paused);
    btn.style.display = show ? "" : "none";

    // ✅ Repeat nur wenn SurahPlay läuft (und nicht STOP)
    if (rep){
      rep.style.display = show ? "" : "none";
      rep.classList.toggle("is-on", !!surahRepeatOn);
    }

    // SVG Swap (play/pause)
    const playI  = btn.querySelector(".icon-play");
    const pauseI = btn.querySelector(".icon-pause");
    if (playI && pauseI) {
      playI.style.display  = paused ? "block" : "none";
      pauseI.style.display = paused ? "none"  : "block";
    }

    // Fortschritt: wenn aus -> komplett weg
    const p = document.getElementById("progress");
    if (p && !show) p.style.transform = "scaleX(0)";

    // ✅ Continue Buttons (optional)
    if (syncContinue) {
      try { __syncContinueButtons(); } catch(e){}
    }
  }catch(e){}
}

function __syncContinueButtons(){
  try{
    const sb = document.getElementById("statusbar");
    const suraActive = !!sb && sb.classList.contains("is-surah-playing"); // ✅ true bei Play + Pause, false bei STOP
    const s = Number((typeof surahPlaying !== "undefined" && surahPlaying) ? surahPlaying : 0);

    document.querySelectorAll("button.ayahContinueBtn").forEach((btn) => {
      const bs = Number(btn.dataset?.surah || 0);
      btn.hidden = !(suraActive && s && bs === s);
    });
  }catch(e){}
}

function stopFavoritesQueue(){
  favQueueToken++;          // kill pending timeouts
  favQueueRefs = [];
  favQueueIdx = 0;
  favQueuePaused = false;
  favQueueContinueFn = null;

  // ✅ hide the separate favPause button
  setFavPauseUI(false, false);
}

// spielt genau EIN ref über topPlay button ab (queueMode=true)
function _playFavRef(topPlayBtn, ref, { onEnded } = {}){
  const a = getAyah(ref);
  if (!a) return false;

  // wichtig: playFromButton holt sich verseRefPlaying u.a. über dataset.ref
  topPlayBtn.dataset.ref = ref;

  const url = ayahMp3Url(a.surah, a.ayah);
  playFromButton(topPlayBtn, url, { queueMode: true, onEnded });
  return true;
}

// ✅ NEU: Toggle (Start / Pause / Resume)
function toggleFavoritesQueue(view){
  const topPlayBtn = view?.querySelector("button.favTopPlay");
  if (!topPlayBtn) return;

  const refs = getActiveFavRefs();
  if (!refs.length) return;

  // 1) Noch nicht aktiv -> starten
  if (!favQueueRefs.length){
    startFavoritesQueue(view);
    return;
  }
  

  // 2) Aktiv -> Pause/Resume (NICHT stop)
  // Wenn gerade kein verseAudio existiert, machen wir lieber stop (damit es nicht “hängt”)
  if (!verseAudio){
    stopFavoritesQueue();
    try { stopVerseAudio({ stopQueue: true }); } catch {}
    topPlayBtn.classList.remove("is-playing", "is-paused");
    return;
  }

  // Pause/Resume über die vorhandene “echte Wahrheit” (toggleVersePause)
  const did = (typeof toggleVersePause === "function") ? toggleVersePause() : false;

  // Wenn toggle nicht ging, dann lieber stop (sauber)
  if (!did){
    stopFavoritesQueue();
    try { stopVerseAudio({ stopQueue: true }); } catch {}
    topPlayBtn.classList.remove("is-playing", "is-paused");
    return;
  }

  // UI-State
  favQueuePaused = !!verseAudio.paused;
  topPlayBtn.classList.toggle("is-paused", favQueuePaused);
  topPlayBtn.classList.toggle("is-playing", !favQueuePaused);

  // ✅ Wenn wir während einer “Gap-Pause” pausiert hatten (also noch nichts spielt),
  // dann beim Resume wieder weiterlaufen lassen:
  if (!favQueuePaused){
    try { favQueueContinueFn?.(); } catch(e) {}
  }
  setFavPauseUI(true, favQueuePaused);
  
}

function startFavoritesQueue(view){
  const topPlayBtn = view?.querySelector("button.favTopPlay");
  if (!topPlayBtn) return;

  const refs = getActiveFavRefs();
  if (!refs.length) return;

  // reset state
favQueueRefs = refs;

// ✅ Start-Ref (vom Tick/Continue) berücksichtigen
try{
  const startRef = String(window.__favStartRef || "");
  const idx = startRef ? favQueueRefs.indexOf(startRef) : -1;
  favQueueIdx = (idx >= 0) ? idx : 0;
}catch(e){
  favQueueIdx = 0;
}
  favQueuePaused = false;
  setFavPauseUI(true, false);
try { syncFavRepeatUI(); } catch(e) {}

  const myToken = ++favQueueToken;

  topPlayBtn.classList.add("is-playing");
  topPlayBtn.classList.remove("is-paused");

  const playNext = () => {
    favQueueContinueFn = playNext;

    if (favQueueToken !== myToken) return;      // gestoppt/neu gestartet
    if (!favQueueRefs.length) return;

    // ✅ wenn pausiert: nichts schedulen
    if (favQueuePaused) return;

// Ende erreicht?
if (favQueueIdx >= favQueueRefs.length) {
  // ✅ 2000ms Pause (konfigurierbar) bevor Stop oder Repeat
  const endDelay = (() => {
    try {
      const cs = getComputedStyle(document.documentElement);
      const raw = (cs.getPropertyValue("--fav-end-gap-ms") || "").trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 2000;
    } catch {
      return 2000;
    }
  })();

  setTimeout(() => {
    if (favQueueToken !== myToken) return;
    if (favQueuePaused) return;

    if (isFavRepeatOn()) {
      favQueueIdx = 0;
      playNext();
    } else {
      stopFavoritesQueue();
      topPlayBtn.classList.remove("is-playing", "is-paused");
    }
  }, endDelay);

  return; // wichtig: jetzt nicht weiterlaufen
}

    const curRef = favQueueRefs[favQueueIdx];
    const prevRef = favQueueIdx > 0 ? favQueueRefs[favQueueIdx - 1] : null;

    // Pause nur wenn NICHT consecutive
    const needGap = prevRef && !_isConsecutive(prevRef, curRef);
    const delay = needGap ? getFavGapMs() : 0;

    const doPlay = () => {
      if (favQueueToken !== myToken) return;
      if (favQueuePaused) return;

       // ✅ Nur Fokus/Highlight – Scroll entscheidet die Auto-Gate-Logik in playFromButton()
       try{
         focusAyahCard(view, curRef, { scroll: false });
       }catch(e){}

      const ok = _playFavRef(topPlayBtn, curRef, {
        onEnded: () => {
          if (favQueueToken !== myToken) return;
          if (favQueuePaused) return;
          favQueueIdx += 1;
          playNext();
        }
      });

      // falls irgendein Ref fehlt -> skip
      if (!ok) {
        favQueueIdx += 1;
        playNext();
      }
    };

    if (delay > 0) setTimeout(doPlay, delay);
    else doPlay();
  };

  playNext();
}

function renderFavoritesPage() {
  // Always render in qView
  const view = ensureQView();
  if (!view) return;

  // Hide mushaf view if visible
  const mv = document.querySelector(".mView");
  if (mv) mv.style.display = "none";
  view.style.display = "";

  view.dataset.mode = "favorites";
  document.getElementById("statusbar")?.classList.add("is-favorites");

  const refs = getActiveFavRefs();
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

  // Top bar (like surahTopBar)
  let html = `
    <div class="surahTopBar favTopBar">

      <div class="surahTopLeft">
        <button class="ayahBtn ayahPlay favTopPlay" type="button" aria-label="Play Favorites"></button>

        <button class="favTopClear" type="button" aria-label="Clear Favorites" title="Clear Favorites">
          <span class="favTopClearIcon" aria-hidden="true"></span>
        </button>

        <div class="favPresetCtl" id="favPresetCtl">
          <button class="favPresetBtn" id="favPresetBtn" type="button" aria-label="Favorites preset">
            <span class="favPresetText" id="favPresetText">actual</span>
            <span class="favPresetArrow" aria-hidden="true">▼</span>
          </button>

          <button class="favPresetPlus" id="favPresetPlus" type="button" aria-label="Save new preset" title="Save preset">+</button>

          <div class="favPresetMenu" id="favPresetMenu" role="listbox" aria-label="Favorites presets"></div>
        </div>
      </div>

      <div class="surahTopCenter">
        <div class="surahTitle">
          <span class="sEn">Favorites</span>
        </div>
      </div>

      <div class="surahTopRight">
        <button class="surahModeBtn" type="button" data-action="favBack" title="Back">
          <span class="modeText">Back →</span>
          <span class="modeArrow"></span>
        </button>
      </div>

    </div>

    <!-- ✅ Favorites Progress: sitzt oben in der Statusleiste (statusbar #suraProg) -->
  `;

if (!refs.length) {
  html += `<div class="favEmpty">No favorites yet.</div>`;
  view.innerHTML = html;
  try { window.__refreshNoteIndicators?.(); } catch(e){}
  

 /* (Favorites Ticks/Continue werden weiter unten nach view.innerHTML = html; gebunden) */


  applyAyahJustify(view);

  // ✅ Preset UI auch im Empty-State binden
  try{
    const ctl  = view.querySelector("#favPresetCtl");
    const btn  = view.querySelector("#favPresetBtn");
    const txt  = view.querySelector("#favPresetText");
    const menu = view.querySelector("#favPresetMenu");
    const plus = view.querySelector("#favPresetPlus");

    if (ctl && btn && txt && menu && plus) {
      function closeMenu(){ ctl.classList.remove("is-open","is-active"); }
      function openMenu(){ ctl.classList.add("is-open","is-active"); }
      function toggleMenu(){ ctl.classList.contains("is-open") ? closeMenu() : openMenu(); }

function rebuildMenu(){
  const p = loadFavPresets();
  const names = listPresetNames(p);

  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();

  const pagesFor = (title) =>
    names
      .filter(n => normalizePresetName(map?.[n] || "") === title)
      .sort((a,b)=>a.localeCompare(b));

  const loose =
    names
      .filter(n => !normalizePresetName(map?.[n] || ""))
      .sort((a,b)=>a.localeCompare(b));

  const countFor = (name) => {
    const key = String(name || "");
    if (!key || key === "actual") {
      try { return (loadBookmarks() || []).length; } catch { return 0; }
    }
    if (key === FAV_NOTES_ONLY_KEY) {
      try { return getNotesOnlyRefs().length; } catch { return 0; }
    }
    const arr = Array.isArray(p?.[key]) ? p[key] : [];
    return arr.length;
  };

  const collapsed = loadFavGroupCollapsed();

  // Habashi default collapsed
  if (collapsed[HABASHI_GROUP_TITLE] === undefined){
    collapsed[HABASHI_GROUP_TITLE] = true;
    saveFavGroupCollapsed(collapsed);
  }

  let out = "";

  // actual
  out += `
    <button class="favPresetOpt ${favPresetActiveName==="actual"?"is-active":""}" type="button" data-name="actual">
      <span class="favPresetName">actual <span class="favPresetAyCount">(${countFor("actual")})</span></span>
    </button>
  `;

  // notes-only
  out += `
    <button class="favPresetOpt ${favPresetActiveName===FAV_NOTES_ONLY_KEY?"is-active":""}" type="button" data-name="${FAV_NOTES_ONLY_KEY}">
      <span class="favPresetName">${FAV_NOTES_ONLY_LABEL} <span class="favPresetAyCount">(${countFor(FAV_NOTES_ONLY_KEY)})</span></span>
    </button>
  `;

  // Add Title+
  out += `
    <button class="favGroupAdd" type="button" data-action="addGroup">
      Add Title +
    </button>
  `;

  // ✅ 1) normale Titles (ohne Habashi)
  const normalTitles = (titles || []).filter(t => String(t) !== HABASHI_GROUP_TITLE);
  for (const t of normalTitles){
    const isCol = !!collapsed[t];
    const locked = isLockedTitle(t);

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint" aria-hidden="true"></span>
          ${locked ? "" : `<span class="favGroupDel" data-delgroup="${t}" aria-label="Delete title" title="Delete title">✕</span>`}
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      const lockedPage = isLockedPreset(n);
      const hb = isHabashiKey(n);

      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
          ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  // ✅ 2) Loose pages
  out += `
    <div class="favGroupBlock" data-group="">
      <button class="favGroupHdr favGroupLooseHdr" type="button" data-group="">
        <span class="favGroupCaret" aria-hidden="true">▼</span>
        <span class="favGroupHdrText">Loose pages</span>
        <span class="favGroupHdrHint">drop here</span>
      </button>
      <div class="favGroupBody">
  `;

  for (const n of loose){
    const lockedPage = isLockedPreset(n);
    const hb = isHabashiKey(n);

    out += `
      <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
        type="button"
        data-name="${n}"
        draggable="true"
        title="Drag this page onto a title">
        <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
      </button>
    `;
  }

  out += `
      </div>
    </div>
  `;

  // ✅ 3) Habashi Title ganz unten (unter Loose pages), NICHT löschbar
  if ((titles || []).includes(HABASHI_GROUP_TITLE)){
    const t = HABASHI_GROUP_TITLE;
    const isCol = !!collapsed[t];

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr is-habashi ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint">drop here</span>
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} is-habashi"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  menu.innerHTML = out;
}

      txt.textContent = labelForPresetName(favPresetActiveName);
      rebuildMenu();

      if (!btn._bound){
        btn._bound = true;
        btn.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); toggleMenu(); });
      }

      if (!menu._bound){
        menu._bound = true;
menu.addEventListener("click", (e) => {

  // ✅ 0) Collapse/Expand Titel (inkl. Klick auf Pfeil ODER Titelzeile)
  const hdr = e.target.closest?.(".favGroupHdr");
  if (hdr){
    e.preventDefault();
    e.stopPropagation();

    const groupKeyRaw = String(hdr.dataset?.group ?? "");
    // normale Titles benutzen ihren echten Titel als key in collapsed[]
    // loose pages benutzen "" als group (bleibt so)
    const titleKey = groupKeyRaw === "" ? "__loose__" : normalizePresetName(groupKeyRaw);

    const collapsed = loadFavGroupCollapsed();
    collapsed[titleKey] = !collapsed[titleKey];
    saveFavGroupCollapsed(collapsed);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Add Title+
  const addBtn = e.target.closest?.('button[data-action="addGroup"]');
  if (addBtn){
    e.preventDefault();
    e.stopPropagation();

    const nameRaw = prompt("Title name?");
    const title = normalizePresetName(nameRaw);
    if (!title) return;

    // ❗ Habashi ist “locked” (nicht neu anlegen/überschreiben)
    if (title === HABASHI_GROUP_TITLE) return;

    const titles = loadFavGroupTitles();
    if (!titles.includes(title)){
      titles.push(title);
      saveFavGroupTitles(titles);
    }

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Delete TITLE (Group) click?  (X neben dem Title)
  const delGroup = e.target.closest?.(".favGroupDel");
  if (delGroup){
    e.preventDefault();
    e.stopPropagation();

    const g = delGroup.dataset?.delgroup || "";
    const group = normalizePresetName(g);
    if (!group) return;

    // ❗ locked title (Habashi) darf nicht gelöscht werden
    if (typeof isLockedTitle === "function" && isLockedTitle(group)) return;

    const ok = confirm(`Do you want to delete the title "${group}"?`);
    if (!ok) return;

    // Title löschen + pages ungroup (keine Presets löschen!)
    removeGroupTitle(group);

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Delete page click?  (Dropdown soll dabei NICHT schließen)
  const del = e.target.closest?.(".favPresetDel");
  if (del) {
    e.preventDefault();
    e.stopPropagation();

    const name = del.dataset?.del || "";
    if (!name) return;

    // ❗ locked presets (actual / notes-only / hb-xx) nicht löschbar
    if (typeof isLockedPreset === "function" && isLockedPreset(name)) return;

    const ok = confirm("Do you want to delete this page?");
    if (!ok) return;

    const wasActive = (favPresetActiveName === name);

    const pObj = loadFavPresets();
    delete pObj[name];
    saveFavPresets(pObj);

    // mapping cleanup
    try{
      const map = loadFavGroupMap();
      if (map && map[name]) {
        delete map[name];
        saveFavGroupMap(map);
      }
    }catch{}

    if (wasActive) {
      setActivePresetName("actual");
      renderFavoritesPage();
    }

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Select page (Preset)
  const btnOpt = e.target.closest?.(".favPresetOpt");
  if (btnOpt) {
    e.preventDefault();
    e.stopPropagation();

    const name = btnOpt.dataset?.name || "";
    if (!name) return;

    setActivePresetName(name);
    syncLabel();
    renderFavoritesPage();

    // Dropdown NICHT schließen (wie bisher)
    rebuildMenu();
    return;
  }

});
      }

// ✅ Drag & Drop (Touch + Mouse) – ohne HTML5 dragstart/drop
if (!menu._dndBound){
  menu._dndBound = true;

  let dragName = "";
  let dragging = false;
  let startX = 0, startY = 0;
  let activeHdr = null;

  // ✅ merken womit wir gestartet sind (wichtig für Touch: Tap soll öffnen)
  let startBtn = null;
  let startWasTouch = false;

  // ✅ Drag “Ghost” = 1:1 Kopie des gezogenen Buttons (sieht exakt gleich aus)
  let ghostEl = null;

  const DRAG_PX = 8; // erst ab 8px Bewegung wird es “Drag”, sonst “Tap”

  const ensureGhostFromBtn = (btn) => {
    try { ghostEl?.remove?.(); } catch {}
    ghostEl = null;

    if (!btn) return null;

    // ✅ Wir kopieren 1:1 den Button (Text/Struktur)
    const g = btn.cloneNode(true);

    // Delete-X weg im Ghost
    try { g.querySelectorAll(".favPresetDel").forEach(x => x.remove()); } catch {}
    try { g.removeAttribute("id"); } catch {}

    // ✅ Ghost positioning
    g.classList.add("favDragGhost");
    g.style.position = "fixed";
    g.style.left = "0px";
    g.style.top = "0px";
    g.style.margin = "0";
    g.style.zIndex = "999999";
    g.style.pointerEvents = "none";
    g.style.opacity = "0";
    g.style.transform = "translate(-9999px,-9999px)";

    // ✅ Größe wie Original
    try{
      const r = btn.getBoundingClientRect();
      g.style.width = r.width + "px";
      g.style.height = r.height + "px";
    }catch{}

    // ✅ 1:1 Styles vom Original übernehmen (inkl. Light/Dark, Font, Background, Borders, etc.)
    try{
      const cs = getComputedStyle(btn);
      const props = [
        "font", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
        "color",
        "background", "backgroundColor",
        "border", "borderColor", "borderWidth", "borderStyle",
        "borderRadius",
        "boxShadow",
        "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "height", "minHeight",
        "display", "alignItems", "justifyContent", "gap",
        "textAlign", "whiteSpace"
      ];
      for (const p of props) g.style[p] = cs[p];

      // wichtig: im body kann width:auto anders laufen -> wir fixen width/height ja oben
      g.style.boxSizing = "border-box";
    }catch{}

    // ✅ optional: ganz leicht “lift”, aber theme-safe
    g.style.filter = "none";
    g.style.opacity = "0";

    document.body.appendChild(g);
    ghostEl = g;
    return ghostEl;
  };

  const showGhostFromBtn = (btn, x, y) => {
    const g = ensureGhostFromBtn(btn);
    if (!g) return;
    g.style.opacity = "1";
    // leicht versetzt, damit der Finger/Maus nicht alles verdeckt
    g.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const moveGhost = (x, y) => {
    if (!ghostEl) return;
    ghostEl.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const hideGhost = () => {
    if (!ghostEl) return;
    ghostEl.style.opacity = "0";
    ghostEl.style.transform = "translate(-9999px,-9999px)";
    try { ghostEl.remove(); } catch {}
    ghostEl = null;
  };

  const clearDrop = () => {
    try{
      menu.querySelectorAll(".favGroupHdr.is-drop").forEach(el => el.classList.remove("is-drop"));
    }catch{}
    activeHdr = null;
  };

  const hdrAt = (x, y) => {
    try{
      const el = document.elementFromPoint(x, y);
      return el?.closest?.(".favGroupHdr") || null;
    }catch{
      return null;
    }
  };

  const begin = (btn, name, x, y, wasTouch) => {
    dragName = name;
    dragging = false;
    startX = x;
    startY = y;
    clearDrop();

    startBtn = btn || null;
    startWasTouch = !!wasTouch;

    // ✅ WICHTIG: Ghost NICHT sofort zeigen.
    // Erst wenn wirklich Drag startet (nach DRAG_PX).
  };

  const move = (x, y, ev) => {
    if (!dragName) return;

    const dx = x - startX;
    const dy = y - startY;

    // ✅ erst ab “echter” Bewegung Drag starten
    if (!dragging){
      if ((dx*dx + dy*dy) < (DRAG_PX*DRAG_PX)) return;
      dragging = true;

      // Ghost erst JETZT anzeigen
      if (startBtn) showGhostFromBtn(startBtn, startX, startY);
    }

    // beim echten drag: scroll/selection verhindern
    try { ev.preventDefault(); } catch {}

    const hdr = hdrAt(x, y);
    if (hdr !== activeHdr){
      clearDrop();
      if (hdr){
        hdr.classList.add("is-drop");
        activeHdr = hdr;
      }
    }

    // ✅ bei JEDEM Move nachziehen
    moveGhost(x, y);
  };

  const end = (x, y) => {
    if (!dragName) return;

    // ✅ Wenn es KEIN Drag war, war es ein Tap.
    // Auf Touch öffnen wir dann die neue Favoritenliste direkt.
    if (!dragging){
      if (startWasTouch){
        // exakt wie im Dropdown-Click: Seite aktiv setzen + rendern + Menü updaten
        setActivePresetName(dragName);
        syncLabel();
        renderFavoritesPage();
        rebuildMenu();
      }

      dragName = "";
      dragging = false;
      clearDrop();
      hideGhost();
      startBtn = null;
      startWasTouch = false;
      return;
    }

    // ✅ echtes Drag: in Gruppe droppen
    const hdr = activeHdr || hdrAt(x, y);
    if (hdr){
      const group = hdr.dataset?.group || ""; // "" = loose
      setPresetGroup(dragName, group);
      rebuildMenu();
      syncLabel();
    }

    dragName = "";
    dragging = false;
    clearDrop();
    hideGhost();
    startBtn = null;
    startWasTouch = false;
  };

  // ==========
  // Mouse
  // ==========
  menu.addEventListener("mousedown", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return; // nicht draggen wenn man auf ✕ ist

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    if (e.button !== 0) return;

    begin(btn, name, e.clientX, e.clientY, false);

    const onMove = (ev) => move(ev.clientX, ev.clientY, ev);
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      end(ev.clientX, ev.clientY);
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }, true);

  // ==========
  // Touch
  // ==========
  menu.addEventListener("touchstart", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return;

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    const t = e.touches && e.touches[0];
    if (!t) return;

    begin(btn, name, t.clientX, t.clientY, true);
  }, { capture:true, passive:true });

  menu.addEventListener("touchmove", (e) => {
    if (!dragName) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    move(t.clientX, t.clientY, e);
  }, { capture:true, passive:false });

  menu.addEventListener("touchend", (e) => {
    if (!dragName) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    end(t ? t.clientX : startX, t ? t.clientY : startY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchcancel", () => {
    dragName = "";
    dragging = false;
    clearDrop();
    hideGhost();
    startBtn = null;
    startWasTouch = false;
  }, { capture:true, passive:true });
}

      if (!plus._bound){
        plus._bound = true;
plus.addEventListener("click", (e)=>{
  e.preventDefault(); e.stopPropagation();

  const name = normalizePresetName(prompt("Preset name?"));
  if (!name) return;

  const refs = getActiveFavRefs(); // ✅ speichert die aktuell sichtbare Seite
  const pObj = loadFavPresets();
  pObj[name] = refs;
  saveFavPresets(pObj);

  // ✅ delta sync: nur diese eine Seite (viel kleiner als full snapshot)
  try{
    window.__accountFavEventQueued?.({ t:"presetUpsert", preset: name, refs, at: Date.now() });
  }catch{}

  setActivePresetName(name);
  txt.textContent = name;
  rebuildMenu();
});
      }

      if (!ctl._outsideBound){
        ctl._outsideBound = true;
        view.addEventListener("pointerdown", (e)=>{
          if (!ctl.classList.contains("is-open")) return;
          if (ctl.contains(e.target)) return;
          closeMenu();
        }, { capture:true, passive:true });
      }
    }
  }catch{}

  // Back button
  try {
    const backBtn = view.querySelector('button[data-action="favBack"]');
    if (backBtn) backBtn.addEventListener("click", (e) => { e.preventDefault(); closeFavoritesPage(); });
  } catch {}

  // Play/Stop (bleibt wie bei dir)
  try {
    const topPlay = view.querySelector("button.favTopPlay");
    if (topPlay) topPlay.addEventListener("click", (e) => {
      e.preventDefault();
      if (!favQueueRefs || !favQueueRefs.length) startFavoritesQueue(view);
      else { stopFavoritesQueue(); try { stopVerseAudio({ stopQueue: true }); } catch {} topPlay.classList.remove("is-playing","is-paused"); }
    });
  } catch {}

  // Repeat toggle  ✅ gekoppelt mit Statusbar #favRepeat
  try {
    const rep = view.querySelector("button.favTopRepeat");
    if (rep) {
      rep.classList.toggle("is-on", isFavRepeatOn());

      // (Sicherheit) nicht doppelt binden, falls renderFavoritesPage öfter läuft
      if (!rep._bound) {
        rep._bound = true;

        rep.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

const next = !isFavRepeatOn();
setFavRepeatOn(next);

// ✅ nur noch einmal synchronisieren (macht Statusbar + Topbar)
try { window.__syncFavRepeatUI?.(); } catch {}
        });
      }
    }
  } catch {}

  // Clear
  try {
    const clearBtn = view.querySelector("button.favTopClear");
    if (clearBtn) clearBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm("ARE YOU SURE?!")) return;
      try { stopFavoritesQueue(); } catch {}
      try { stopVerseAudio({ stopQueue: true }); } catch {}
      try { saveBookmarks([]); } catch {}
      try { window.__refreshFavCount?.(); } catch {}
      renderFavoritesPage();
    });
  } catch {}

  return;
}

  const bmSetLocal =
    (favPresetActiveName === FAV_NOTES_ONLY_KEY)
      ? new Set(loadBookmarks())          // notes-only: Bookmark-Icon zeigt echte Bookmarks
      : new Set(refs);                    // actual/preset: basiert auf der aktiven Liste

  let prev = null;
  for (const r of refs) {
    if (prev && !_isConsecutive(prev, r)) {
      html += `<div class="favSep">—</div>`;
    }
    prev = r;

    const a = getAyah(r);
    if (!a) continue;

    const wordsHtml = buildWordSpans({ ...a, ayahNo: a.ayah });
    const mp3 = ayahMp3Url(a.surah, a.ayah);

html += `
  <div class="ayahCard ayahMainCard" data-ref="${a.ref}" tabindex="0">
    <div class="ayahHeaderRow">
      <div class="ayahRefRow">
        <button class="ayahBtn ayahPlay playAyah" type="button" data-audio="${mp3}" aria-label="Play Ayah"></button>

        <div class="ayahRef">${a.ref}</div>

        <button class="ayahBtn ayahBm${bmSetLocal.has(a.ref) ? " is-on" : ""}"
          type="button"
          data-bm="${a.ref}"
          aria-label="Bookmark ${a.ref}"
          title="Bookmark"></button>

        <button class="ayahCopy ayahCopyBtn"
          type="button"
          data-copy="${a.ref}"
          aria-label="Copy ${a.ref}"
          title="Copy">
          <svg class="copyIcon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
            <rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
          </svg>
        </button>

<button class="ayahNote ayahNoteBtn"
  type="button"
  data-note="${a.ref}"
  aria-label="Notes ${a.ref}"
  title="Notes">
  <svg class="noteIcon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h8a2 2 0 0 1 2 2v14l-6-3-6 3V5a2 2 0 0 1 2-2z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M9 7h6M9 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
</button>
      </div>

      <div class="ayahHeaderRight"></div>
    </div>

    <div class="ayahText">${wordsHtml}</div>
    ${buildAyahTranslationsHtml(a, esc)}
  </div>
`;
  }

  view.innerHTML = html;
  try { window.__refreshNoteIndicators?.(); } catch(e){}

// ✅ In Favorites: Bookmark-Toggle gehört zur aktiven Seite (actual ODER preset)
  // (Dieser Block fehlte im non-empty Render -> deshalb ging ent-favoritisieren "manchmal")
  try{
    view.querySelectorAll('button.ayahBm[data-bm]').forEach((btn) => {
      if (btn._favBound) return;
      btn._favBound = true;

      btn.addEventListener("click", (e) => {
        // nur in Favorites selbst abfangen
        if (view.dataset.mode !== "favorites") return;

        e.preventDefault();
        e.stopPropagation();

        const ref = btn.dataset?.bm || "";
        const res = toggleFavInActivePage(ref);

        if (res && res.ok) {
          btn.classList.toggle("is-on", !!res.bookmarked);

          // Wenn entfernt: Seite neu rendern (damit die Ayah wirklich verschwindet + Trenner stimmen)
          if (!res.bookmarked) {
            const keepScroll = view.scrollTop || 0;
            renderFavoritesPage();
            requestAnimationFrame(() => {
              try { view.scrollTop = keepScroll; } catch {}
            });
          }
        }
      }, { passive: false });
    });
  }catch(e){}

    // =========================
  // Favorites Presets UI bind
  // =========================
  try{
    const ctl  = view.querySelector("#favPresetCtl");
    const btn  = view.querySelector("#favPresetBtn");
    const txt  = view.querySelector("#favPresetText");
    const menu = view.querySelector("#favPresetMenu");
    const plus = view.querySelector("#favPresetPlus");

    if (ctl && btn && txt && menu && plus) {
      const presets = loadFavPresets();

      function closeMenu(){
        ctl.classList.remove("is-open", "is-active");
      }

      function openMenu(){
        // ✅ erst öffnen (UI fühlt sich sofort responsive an)
        ctl.classList.add("is-open", "is-active");

        // ✅ Habashi (hb-xx) nach Reset automatisch wiederherstellen,
        // bevor wir das Dropdown-Menü final aufbauen.
        // - safe: darf NIE crashen
        // - async ohne await (damit Click-Handler nicht kaputt geht)
        try{
          Promise.resolve(seedHabashiPresetsIfNeeded?.())
            .catch(()=>{})
            .finally(() => {
              try { rebuildMenu(); } catch {}
              try { syncLabel(); } catch {}
            });
        }catch{
          // fallback: wenigstens normal rebuilden
          try { rebuildMenu(); } catch {}
          try { syncLabel(); } catch {}
        }
      }

      function toggleMenu(){
        ctl.classList.contains("is-open") ? closeMenu() : openMenu();
      }

function rebuildMenu(){
  const p = loadFavPresets();
  const names = listPresetNames(p);

  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();

  const pagesFor = (title) =>
    names
      .filter(n => normalizePresetName(map?.[n] || "") === title)
      .sort((a,b)=>a.localeCompare(b));

  const loose =
    names
      .filter(n => !normalizePresetName(map?.[n] || ""))
      .sort((a,b)=>a.localeCompare(b));

  const countFor = (name) => {
    const key = String(name || "");
    if (!key || key === "actual") {
      try { return (loadBookmarks() || []).length; } catch { return 0; }
    }
    if (key === FAV_NOTES_ONLY_KEY) {
      try { return getNotesOnlyRefs().length; } catch { return 0; }
    }
    const arr = Array.isArray(p?.[key]) ? p[key] : [];
    return arr.length;
  };

  const collapsed = loadFavGroupCollapsed();

  // Habashi default collapsed
  if (collapsed[HABASHI_GROUP_TITLE] === undefined){
    collapsed[HABASHI_GROUP_TITLE] = true;
    saveFavGroupCollapsed(collapsed);
  }

  let out = "";

  // actual
  out += `
    <button class="favPresetOpt ${favPresetActiveName==="actual"?"is-active":""}" type="button" data-name="actual">
      <span class="favPresetName">actual <span class="favPresetAyCount">(${countFor("actual")})</span></span>
    </button>
  `;

  // notes-only
  out += `
    <button class="favPresetOpt ${favPresetActiveName===FAV_NOTES_ONLY_KEY?"is-active":""}" type="button" data-name="${FAV_NOTES_ONLY_KEY}">
      <span class="favPresetName">${FAV_NOTES_ONLY_LABEL} <span class="favPresetAyCount">(${countFor(FAV_NOTES_ONLY_KEY)})</span></span>
    </button>
  `;

  // Add Title+
  out += `
    <button class="favGroupAdd" type="button" data-action="addGroup">
      Add Title +
    </button>
  `;

  // ✅ 1) normale Titles (ohne Habashi)
  const normalTitles = (titles || []).filter(t => String(t) !== HABASHI_GROUP_TITLE);
  for (const t of normalTitles){
    const isCol = !!collapsed[t];
    const locked = isLockedTitle(t);

      out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint" aria-hidden="true"></span>
          ${locked ? "" : `<span class="favGroupDel" data-delgroup="${t}" aria-label="Delete title" title="Delete title">✕</span>`}
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      const lockedPage = isLockedPreset(n);
      const hb = isHabashiKey(n);

      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
          ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  // ✅ 2) Loose pages
  out += `
    <div class="favGroupBlock" data-group="">
      <button class="favGroupHdr favGroupLooseHdr" type="button" data-group="">
        <span class="favGroupCaret" aria-hidden="true">▼</span>
        <span class="favGroupHdrText">Loose pages</span>
        <span class="favGroupHdrHint">drop here</span>
      </button>
      <div class="favGroupBody">
  `;

  for (const n of loose){
    const lockedPage = isLockedPreset(n);
    const hb = isHabashiKey(n);

    out += `
      <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
        type="button"
        data-name="${n}"
        draggable="true"
        title="Drag this page onto a title">
        <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
      </button>
    `;
  }

  out += `
      </div>
    </div>
  `;

  // ✅ 3) Habashi Title ganz unten (unter Loose pages), NICHT löschbar
  if ((titles || []).includes(HABASHI_GROUP_TITLE)){
    const t = HABASHI_GROUP_TITLE;
    const isCol = !!collapsed[t];

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr is-habashi ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint">drop here</span>
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} is-habashi"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  menu.innerHTML = out;
}

      function syncLabel(){
        txt.textContent = labelForPresetName(favPresetActiveName);
      }

      // initial
      syncLabel();
      rebuildMenu();

      if (!btn._bound){
        btn._bound = true;
        btn.addEventListener("click", (e)=>{
          e.preventDefault();
          e.stopPropagation();
          toggleMenu();
        });
      }

menu.addEventListener("click", (e) => {

  // ✅ 1) Delete TITLE (Group) click?  (X neben dem Title)
  // MUSS VOR dem Header-Toggle kommen, sonst wird erst eingeklappt/ausgeklappt.
  const delGroup = e.target.closest?.(".favGroupDel");
  if (delGroup){
    e.preventDefault();
    e.stopPropagation();

    const g = delGroup.dataset?.delgroup || "";
    const group = normalizePresetName(g);

    // ❌ Loose pages + Habashi title dürfen NICHT gelöscht werden
    if (!group) return;
    if (typeof isLockedTitle === "function" && isLockedTitle(group)) return;

    const ok = confirm(`Do you want to delete the title "${group}"?`);
    if (!ok) return;

    // ✅ Title löschen + pages ungroup (keine Presets löschen!)
    removeGroupTitle(group);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 2) Delete page click?  (X bei der Seite)
  // MUSS VOR dem Header-Toggle kommen, damit X NICHT einklappt/ausklappt.
  const del = e.target.closest?.(".favPresetDel");
  if (del) {
    e.preventDefault();
    e.stopPropagation();

    const name = del.dataset?.del || "";
    if (!name) return;

    // ❌ locked pages dürfen NICHT gelöscht werden (actual, notes-only, habashi, etc.)
    if (typeof isLockedPreset === "function" && isLockedPreset(name)) return;

    const ok = confirm("Do you want to delete this page?");
    if (!ok) return;

    const wasActive = (favPresetActiveName === name);

    const pObj = loadFavPresets();
    delete pObj[name];
    saveFavPresets(pObj);

    // ✅ delta sync: preset löschen
try{
  window.__accountFavEventQueued?.({ t:"presetDelete", preset: name, at: Date.now() });
}catch{}

    // mapping cleanup
    try{
      const map = loadFavGroupMap();
      if (map && map[name]) {
        delete map[name];
        saveFavGroupMap(map);
      }
    }catch{}

    if (wasActive) {
      setActivePresetName("actual");
      renderFavoritesPage();

      // ✅ Dropdown danach wieder öffnen (damit es NICHT "zu bleibt")
      setTimeout(() => {
        const c = document.querySelector(".favPresetCtl");
        if (c) c.classList.add("is-open", "is-active");
      }, 0);

      return;
    }

    // ✅ Wenn NICHT aktiv: nur Menu updaten, Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 3) Title einklappen/ausklappen (Click auf .favGroupHdr)
  const hdrBtn = e.target.closest?.(".favGroupHdr");
  if (hdrBtn){
    e.preventDefault();
    e.stopPropagation();

    const groupRaw = hdrBtn.dataset?.group ?? "";
    const group = normalizePresetName(groupRaw);

    // "Loose pages" hat data-group="" -> wir speichern das unter einem festen Key
    const key = group ? group : "__loose__";

    const collapsed = loadFavGroupCollapsed();
    collapsed[key] = !collapsed[key];
    saveFavGroupCollapsed(collapsed);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 4) Add Title+
  const addBtn = e.target.closest?.('button[data-action="addGroup"]');
  if (addBtn){
    e.preventDefault();
    e.stopPropagation();

    const nameRaw = prompt("Title name?");
    const title = normalizePresetName(nameRaw);
    if (!title) return;

    const titles = loadFavGroupTitles();
    if (!titles.includes(title)){
      titles.push(title);
      saveFavGroupTitles(titles);
    }

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 5) Normal select click
  const opt = e.target.closest?.(".favPresetOpt");
  if (!opt) return;

  e.preventDefault();
  e.stopPropagation();

  const name = opt.dataset?.name || "actual";

  try { stopFavoritesQueue(); } catch {}
  try { stopVerseAudio({ stopQueue: true }); } catch {}

  // ✅ WICHTIG: actual bleibt actual (KEIN saveBookmarks!)
  setActivePresetName(name);

  closeMenu();

  // ✅ Sofort rendern
  renderFavoritesPage();

  // ✅ EXTRA: beim ersten Öffnen manchmal nötig -> erzwingt sichtbares Update
  setTimeout(() => {
    try { renderFavoritesPage(); } catch {}
    try { window.__refreshFavButtonDecor?.(); } catch {}
  }, 0);
});

  // (entfernt) ✅ Delete TITLE (Group) click? war hier doppelt und hat JS gecrasht

// ✅ Drag & Drop (Touch + Mouse) – ohne HTML5 dragstart/drop
if (!menu._dndBound){
  menu._dndBound = true;

  let dragName = "";
  let dragging = false;
  let startX = 0, startY = 0;
  let activeHdr = null;

  // ✅ Drag “Ghost” = 1:1 Kopie des gezogenen Buttons (sieht exakt gleich aus)
  let ghostEl = null;

const ensureGhostFromBtn = (btn) => {
  try { ghostEl?.remove?.(); } catch {}
  ghostEl = null;

  if (!btn) return null;

  // ✅ Wir kopieren 1:1 den Button (Text/Struktur)
  const g = btn.cloneNode(true);

  // Delete-X weg im Ghost
  try { g.querySelectorAll(".favPresetDel").forEach(x => x.remove()); } catch {}
  try { g.removeAttribute("id"); } catch {}

  // ✅ Ghost positioning
  g.classList.add("favDragGhost");
  g.style.position = "fixed";
  g.style.left = "0px";
  g.style.top = "0px";
  g.style.margin = "0";
  g.style.zIndex = "999999";
  g.style.pointerEvents = "none";
  g.style.opacity = "0";
  g.style.transform = "translate(-9999px,-9999px)";

  // ✅ Größe wie Original
  try{
    const r = btn.getBoundingClientRect();
    g.style.width = r.width + "px";
    g.style.height = r.height + "px";
  }catch{}

  // ✅ 1:1 Styles vom Original übernehmen (inkl. Light/Dark, Font, Background, Borders, etc.)
  try{
    const cs = getComputedStyle(btn);
    const props = [
      "font", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
      "color",
      "background", "backgroundColor",
      "border", "borderColor", "borderWidth", "borderStyle",
      "borderRadius",
      "boxShadow",
      "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "height", "minHeight",
      "display", "alignItems", "justifyContent", "gap",
      "textAlign", "whiteSpace"
    ];
    for (const p of props) g.style[p] = cs[p];

    // wichtig: im body kann width:auto anders laufen -> wir fixen width/height ja oben
    g.style.boxSizing = "border-box";
  }catch{}

  // ✅ optional: ganz leicht “lift”, aber theme-safe (kein hardcoded dunkler shadow)
  g.style.filter = "none";                 // <-- keine Farbverfälschung im White Mode
  g.style.opacity = "0";                   // wird in showGhost gesetzt

  document.body.appendChild(g);
  ghostEl = g;
  return ghostEl;
};

  const showGhostFromBtn = (btn, x, y) => {
    const g = ensureGhostFromBtn(btn);
    if (!g) return;
    g.style.opacity = "1";
    // leicht versetzt, damit der Finger/Maus nicht alles verdeckt
    g.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const moveGhost = (x, y) => {
    if (!ghostEl) return;
    ghostEl.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const hideGhost = () => {
    if (!ghostEl) return;
    ghostEl.style.opacity = "0";
    ghostEl.style.transform = "translate(-9999px,-9999px)";
    try { ghostEl.remove(); } catch {}
    ghostEl = null;
  };

  const clearDrop = () => {
    try{
      menu.querySelectorAll(".favGroupHdr.is-drop").forEach(el => el.classList.remove("is-drop"));
    }catch{}
    activeHdr = null;
  };

  const hdrAt = (x, y) => {
    try{
      const el = document.elementFromPoint(x, y);
      return el?.closest?.(".favGroupHdr") || null;
    }catch{
      return null;
    }
  };

  const begin = (btn, name, x, y) => {
    dragName = name;
    dragging = false;
    startX = x;
    startY = y;
    clearDrop();

    // ✅ Ghost sofort anzeigen (als Kopie vom Button)
    showGhostFromBtn(btn, x, y);
  };

  const move = (x, y, ev) => {
    if (!dragName) return;

    const dx = x - startX;
    const dy = y - startY;

    if (!dragging){
      if ((dx*dx + dy*dy) < (8*8)) return;
      dragging = true;
    }

    // beim echten drag: scroll/selection verhindern
    try { ev.preventDefault(); } catch {}

    const hdr = hdrAt(x, y);
    if (hdr !== activeHdr){
      clearDrop();
      if (hdr){
        hdr.classList.add("is-drop");
        activeHdr = hdr;
      }
    }

    // ✅ WICHTIG: bei JEDEM Move nachziehen (fix für Maus)
    moveGhost(x, y);
  };

  const end = (x, y) => {
    if (!dragName) return;

    if (dragging){
      const hdr = activeHdr || hdrAt(x, y);
      if (hdr){
        const group = hdr.dataset?.group || ""; // "" = loose
        setPresetGroup(dragName, group);
        rebuildMenu();
        syncLabel();
            
      }
      
    }

    dragName = "";
    dragging = false;
    clearDrop();

    hideGhost();
  };

  // ==========
  // Mouse
  // ==========
  menu.addEventListener("mousedown", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return; // nicht draggen wenn man auf ✕ ist

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    if (e.button !== 0) return;

    begin(btn, name, e.clientX, e.clientY);

    const onMove = (ev) => move(ev.clientX, ev.clientY, ev);
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      end(ev.clientX, ev.clientY);
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }, true);

  // ==========
  // Touch
  // ==========
  menu.addEventListener("touchstart", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return;

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    const t = e.touches && e.touches[0];
    if (!t) return;

    begin(btn, name, t.clientX, t.clientY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchmove", (e) => {
    if (!dragName) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    move(t.clientX, t.clientY, e);
  }, { capture:true, passive:false });

  menu.addEventListener("touchend", (e) => {
    if (!dragName) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    end(t ? t.clientX : startX, t ? t.clientY : startY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchcancel", () => {
    dragName = "";
    dragging = false;
    clearDrop();
  }, { capture:true, passive:true });
}

      if (!plus._bound){
        plus._bound = true;
        plus.addEventListener("click", (e)=>{
          e.preventDefault();
          e.stopPropagation();

          const nameRaw = prompt("Preset name?");
          const name = normalizePresetName(nameRaw);
          if (!name) return;

          const pObj = loadFavPresets();
          pObj[name] = getActiveFavRefs(); // ✅ speichert die aktuell sichtbare Seite
          saveFavPresets(pObj);

          setActivePresetName(name);
          syncLabel();
          rebuildMenu();
        });
      }

// ✅ click outside closes (GLOBAL, damit Klick auf Statusbar auch schließt)
if (!window.__favPresetOutsideBound){
  window.__favPresetOutsideBound = true;

  document.addEventListener("pointerdown", (e) => {
    // wir suchen immer das aktuell offene ctl (weil Favorites re-rendered)
    const openCtl = document.querySelector(".favPresetCtl.is-open");
    if (!openCtl) return;

    if (openCtl.contains(e.target)) return;

    // close = Klassen entfernen (wie closeMenu)
    openCtl.classList.remove("is-open", "is-active");
  }, { capture: true, passive: true });
}
    }
  }catch(e){}

  // ✅ Clear favorites (FavTopBar) – auch im non-empty branch
try {
  const clearBtn = view.querySelector("button.favTopClear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const ok = confirm("ARE YOU SURE?!");
    if (!ok) return;

    try { stopFavoritesQueue(); } catch {}
    try { stopVerseAudio({ stopQueue: true }); } catch {}

    try { saveBookmarks([]); } catch {}
    try { window.__refreshFavCount?.(); } catch {}

    renderFavoritesPage();
  });
} catch {}

  // Back button inside favorites topbar
  try {
    const backBtn = view.querySelector('button[data-action="favBack"]');
    if (backBtn) backBtn.addEventListener("click", (e) => { e.preventDefault(); closeFavoritesPage(); });
  } catch {}

  // Top play button = play first favorite
    // Top play button = play ALL favorites sequentially
    try {
      const topPlay = view.querySelector("button.favTopPlay");
      if (topPlay) topPlay.addEventListener("click", (e) => {
        e.preventDefault();
// ✅ nur Play/Stop (Pause kommt später als eigener Button)
if (!favQueueRefs || !favQueueRefs.length) {
  startFavoritesQueue(view);
} else {
  stopFavoritesQueue();
  try { stopVerseAudio({ stopQueue: true }); } catch {}
  topPlay.classList.remove("is-playing", "is-paused");
      }});
    } catch {}

}

function openFavoritesPage() {
  if (__inFavoritesPage) return;

    // ✅ Beim Betreten der Favoriten-Seite: ALLES andere Audio stoppen (ohne Listener)
  try { stopWordAudio(); } catch(e) {}
  try { stopVerseAudio({ stopQueue: true }); } catch(e) {}
  try { stopSurahQueue(); } catch(e) {}

  __inFavoritesPage = true;
    // ✅ Snapshot optional (actual bleibt actual)
  favActualSnapshot = _sortRefs(loadBookmarks());

  // ✅ letzte besuchte Favorites-Seite wiederherstellen
  setActivePresetName(loadActiveFavPreset());
  __favPrevViewMode = viewMode;
  __favPrevRef = currentRef;

  // Favorites page is Ayah-mode only
  viewMode = "ayah";
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ WICHTIG: Wenn wir aus Mushaf kommen, ist qView oft noch display:none.
  // Also: Mushaf-View ausblenden und qView sichtbar machen.
  try {
    const mv = document.querySelector(".mView");
    const qv = ensureQView();
    if (mv) mv.style.display = "none";
    if (qv) qv.style.display = "flex";
  } catch {}

  // Fav button becomes back
  try {
    const favBtnBtn = document.getElementById("favBtnBtn");
    const favText = document.getElementById("favText");
    if (favBtnBtn) favBtnBtn.classList.add("is-back");
    if (favText) favText.textContent = "Back →";
  } catch {}

  // ✅ Favorites page rendern – aber sicherstellen, dass Translations geladen sind
  const _doRenderFav = () => {
    renderFavoritesPage();
    try { window.__syncFavRepeatUI?.(); } catch(e) {}
    try { persistNavState?.(); } catch {}
  };

  // wenn Translations noch nicht “warm” sind: erst initTranslations, dann rendern
  if (!activeTranslations || activeTranslations.length === 0 || (translationCache?.size || 0) === 0) {
    try {
      Promise.resolve(initTranslations())
        .catch((e) => console.warn("[fav] initTranslations failed:", e))
        .finally(_doRenderFav);
    } catch (e) {
      console.warn("[fav] initTranslations call failed:", e);
      _doRenderFav();
    }
  } else {
    _doRenderFav();
  }
}

function closeFavoritesPage(opts = {}) {
  if (!__inFavoritesPage) return;

  const silent = !!opts.silent;

  // ✅ STOP favorites playback immer beim Verlassen
  try { stopFavoritesQueue(); } catch {}
  try { stopVerseAudio({ stopQueue: true }); } catch {}
  try { stopSurahQueue?.(); } catch {}
  try { stopWordAudio?.(); } catch {}

  // ✅ statusbar mode off
  document.getElementById("statusbar")?.classList.remove("is-favorites");
  document.getElementById("statusbar")?.classList.remove("is-fav-playing");

  __inFavoritesPage = false;

  // Restore button label
  try {
    const favBtnBtn = document.getElementById("favBtnBtn");
    const favText = document.getElementById("favText");
    if (favBtnBtn) favBtnBtn.classList.remove("is-back");
    if (favText) favText.textContent = "Favorites";
  } catch {}

  // Restore previous view mode
  viewMode = __favPrevViewMode || "ayah";
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ Normalfall: vorherige Ansicht wieder rendern
  // ✅ Silent-Fall: NICHT rendern (Navigation macht gleich renderCurrent / goToRef)
  if (!silent) {
    const ref = __favPrevRef || currentRef;
    renderCurrent(ref);
    try { persistNavState?.(); } catch {}
  }
}



function setSurahContext(surahNo) {
  const s = Number(surahNo);
  if (!Number.isFinite(s) || s < 1) return;

  // nur wenn wirklich geändert → ressourceschonend
  if (currentSurahInView !== s) currentSurahInView = s;

  // ✅ Dropdown-Label + Suraplay-Button synchron halten
  try { window.__refreshSurahDropdown?.(); } catch {}
  try { syncGlobalPlayStopUI?.(); } catch {}
  try {
    const playingSurah =
      (typeof surahPlaying !== "undefined" && surahPlaying) ? Number(surahPlaying) : 0;

    // ✅ wenn SurahPlay läuft, nur dann umstellen wenn es dieselbe Sura ist
    if (!playingSurah || playingSurah === s) window.__suraProgSetSurah?.(s);
  } catch {}
}


function goToRef(ref, { updateUrl = true } = {}) {
  const loose = parseRefLoose(ref);
  if (!loose) return false;

  // Wenn Daten noch laden: nur URL setzen (Renderer kommt dann nach initRouter)
  if (!dataReady) {
    if (updateUrl) setRefToHash(loose);
    dlog("router", "queued ref until data ready", loose);
    return true;
  }

  const n = normalizeRef(loose);
  if (!n) return false;

  const a = getAyah(n);
  if (!a) return false;

  const isVisibleEl = (el) => {
    if (!el) return false;
    try{
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (el.offsetParent === null && cs.position !== "fixed") return false;
    }catch{}
    return true;
  };

  const isHifzTrainModeActive = (() => {
    try{
      const mv = document.querySelector(".mView");
      if (!isVisibleEl(mv)) return false;
      return !!mv.querySelector(".hifzTrainTopBar");
    }catch{
      return false;
    }
  })();

  const isHifzTestModeActive = (() => {
    try{
      const qv = document.querySelector(".qView");
      if (!isVisibleEl(qv)) return false;
      return !!qv.querySelector(".hifzTestTopBar");
    }catch{
      return false;
    }
  })();

  const stageNow = String(hifzStageValue || "1");
  const shouldGuardRange =
    (isHifzTrainModeActive || isHifzTestModeActive) &&
    !isHifzStageWithoutRenderedRangeUi(stageNow);

  if (shouldGuardRange) {
    const allowedRefsRaw = (() => {
      if (stageNow === "7" || stageNow === "10") {
        return getAllRefs();
      }

      if (stageNow === "6" || stageNow === "8" || stageNow === "9") {
        return getCurrentSurahRefsForHifz(n);
      }

      const bounds = getHifzRangeBoundsForRef(n);
      const refsRaw = getCurrentSurahRefsForHifz(n);

      return refsRaw.filter((refInRange) => {
        const ay2 = getAyah(refInRange);
        if (!ay2 || ay2.surah !== Number(bounds?.surahNo || 0)) return false;
        return (
          ay2.ayah >= Number(bounds?.fromAyah || 0) &&
          ay2.ayah <= Number(bounds?.toAyah || 0)
        );
      });
    })();

    const allowedRefs = new Set(_sortRefs(allowedRefsRaw).map(String));

    if (!allowedRefs.has(String(n))) {
      if (isHifzTrainModeActive) {
        const view = document.querySelector(".mView");
        const flow = view?.querySelector(".mFlow");
        if (flow) {
          flow.innerHTML = buildHifzBadRangeMessageHtml(n);
          view.__mushafCacheDirty = true;
          view.__mushafBtnsCache = null;
          view.__mushafPosCache = null;
        }
      } else if (isHifzTestModeActive) {
        const view = document.querySelector(".qView");
        const mount = view?.querySelector(".allCardsMount");

        if (mount) {
          mount.innerHTML = buildHifzBadRangeMessageHtml(n);
          view.__ayahCacheDirty = true;
          view.__ayahCardsCache = null;
        } else if (view) {
          view.innerHTML = buildHifzBadRangeMessageHtml(n);
        }
      }

      try { window.__setJumpBusy?.(false); } catch(e) {}
      return false;
    }
  }

  if (updateUrl) setRefToHash(n);

  // ✅ immer die normalisierte Ref als aktuelle Wahrheit speichern
  currentRef = n;

  // 🟢 Sura für UI (Dropdown + Suraplay)
  setSurahContext(a.surah);

  // ✅ rendern + persistieren
  try { __autoScrollGate = false; } catch(e) {}   // <- User-Jump soll NICHT sofort zurückspringen
  renderCurrent(n);
  persistNavState();

  // ✅ Jump Busy aus (falls gesetzt)
  try { window.__setJumpBusy?.(false); } catch(e) {}

  // ✅ WICHTIG: Erfolg zurückgeben, damit doJump NICHT rot macht
  return true;
}

function initRouter(defaultRef = "2:255") {
  const fromUrl = getRefFromHash();
  const persisted = loadPersistedNavState();

  // viewMode aus storage setzen (falls gültig)
  if (persisted.viewMode === "ayah" || persisted.viewMode === "mushaf") {
    viewMode = persisted.viewMode;
  }

  hifzStageValue = loadHifzStageValue();
  hifzRangeValue = loadHifzRangeValue();

  const last = normalizeRef(persisted.lastRef);
  const def = normalizeRef(defaultRef) || defaultRef;

  const startRaw =
    (fromUrl && getAyah(fromUrl)) ? fromUrl :
    (last && getAyah(last)) ? last :
    def;

  const start = getHifzRangeBoundsForRef(startRaw).startRef;

  currentRef = start;
  const a0 = getAyah(start);
  if (a0) currentSurahInView = a0.surah;
  if (a0) setSurahContext(a0.surah);

  renderCurrent(start);
  persistNavState();

  window.addEventListener("hashchange", () => {
    if (suppressHashRender) {
      suppressHashRender = false;
      return;
    }

    // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
    try { closeFavoritesPage?.({ silent: true }); } catch {}

    const rRaw = getRefFromHash();
    if (rRaw && getAyah(rRaw)) {
      const r = getHifzRangeBoundsForRef(rRaw).startRef;
      currentRef = r;
      const a1 = getAyah(r);
      if (a1) currentSurahInView = a1.surah;
      if (a1) setSurahContext(a1.surah);
      try { window.__refreshSurahDropdown?.(); } catch(e) {}
      renderCurrent(r);
      persistNavState();
    }
  });

  if (DBG.enabled) {
    window.__quranDebug = window.__quranDebug || {};
    window.__quranDebug.go = (r) => goToRef(r);
    window.__quranDebug.toggleView = () => toggleViewMode();
  }
}

window.__refreshFavCount = function(){
  try {
    const el = document.getElementById("favCount");
    if (!el) return;

    // ✅ aktiv: current preset name (falls aus irgendeinem Grund noch leer -> actual)
    const active =
      (typeof favPresetActiveName !== "undefined" && favPresetActiveName)
        ? String(favPresetActiveName)
        : "actual";

    if (active === "actual") {
      el.textContent = String((loadBookmarks()?.length || 0));
      return;
    }

    // ✅ notes-only count
    if (active === FAV_NOTES_ONLY_KEY) {
      el.textContent = String((getNotesOnlyRefs()?.length || 0));
      return;
    }

    // ✅ preset-page count
    const pObj = loadFavPresets();
    const arr = Array.isArray(pObj?.[active]) ? pObj[active] : [];
    el.textContent = String(arr.length || 0);
  } catch(e) {}
};

// Public helpers (immer verfügbar)
window.__quran = window.__quran || {};
window.__quran.bookmarks = {
  list: () => loadBookmarks(),
  toggle: (r) => toggleBookmark(r),
  has: (r) => isBookmarked(r),
  clear: () => saveBookmarks([]),
};

/* ============================================================================
   UI DEMO (Buttons) – unabhängig von Quran-Daten
============================================================================ */
  const jumpBox = document.getElementById("jumpBox");

  let jumpBadTimer = null;
  function flashJumpBad() {
    if (!jumpBox) return;
    jumpBox.classList.add("is-bad");
    if (jumpBadTimer) clearTimeout(jumpBadTimer);
    jumpBadTimer = setTimeout(() => jumpBox.classList.remove("is-bad"), 700);
  }
let playing = false;
let paused = false;

function initDemoUI() {
  const progress = document.getElementById("progress");
  const playStop = document.getElementById("playStop");
  const playPause = document.getElementById("playPause");

  // ✅ Volume + Surah Repeat (Statusbar)
  const volSlider = document.getElementById("volSlider");
  const suraRepeatBtn = document.getElementById("suraRepeat");

  // ✅ Favorites Repeat (Statusbar)
  const favRepeatBtn = document.getElementById("favRepeat");

  // ✅ Hard reset: Pause-Buttons dürfen niemals “zufällig” sichtbar sein
  try { setSuraPauseUI(false, false); } catch(e){}
  try { setFavPauseUI(false, false); } catch(e){}

// ✅ Volume: localStorage hat Vorrang + mobile-sicher speichern
try{
  const hasVol = (() => {
    try { return localStorage.getItem(LS_VOL) !== null; } catch { return false; }
  })();

  // 1) Immer aus LS laden (wenn kaputt -> default 0.3)
  globalVolume = _loadVol(0.3);

  // 2) Wenn es noch keinen LS-Wert gab: default einmalig persistieren
  if (!hasVol) _saveVol(globalVolume);

  // 3) UI + Audio synchronisieren (immer)
  const syncVolUI = () => {
    if (volSlider) volSlider.value = String(Math.round(globalVolume * 100));
    applyGlobalVolume();
  };

  // initial sync
  syncVolUI();

  // 4) Slider binding (input + change = mobile sicher)
  if (volSlider && !volSlider._bound){
    volSlider._bound = true;

    const saveFromSlider = () => {
      const v01 = Math.min(1, Math.max(0, Number(volSlider.value) / 100));
      globalVolume = v01;
      _saveVol(globalVolume);
      applyGlobalVolume();
    };

    volSlider.addEventListener("input",  saveFromSlider, { passive:true });
    volSlider.addEventListener("change", saveFromSlider, { passive:true });

    // Extra: wenn Browser “back/forward cache” nutzt -> Wert erneut aus LS ziehen
    window.addEventListener("pageshow", () => {
      globalVolume = _loadVol(0.3);
      syncVolUI();
    }, { passive:true });
  }
}catch(e){}

  // ✅ Surah Repeat: Zustand aus localStorage laden + UI sync (bleibt nach Reload)
  try{
    surahRepeatOn = _loadBool(LS_SURAH_REPEAT, false);
    syncSurahRepeatUI();

    // Extra: wenn Browser “back/forward cache” nutzt -> Zustand erneut aus LS ziehen
    if (!window.__surahRepeatPageshowBound){
      window.__surahRepeatPageshowBound = true;
      window.addEventListener("pageshow", () => {
        surahRepeatOn = _loadBool(LS_SURAH_REPEAT, false);
        syncSurahRepeatUI();
      }, { passive:true });
    }
  }catch(e){}

  // ✅ bind Surah Repeat button (darf IMMER togglen; wir merken es in localStorage)
  try{
    if (suraRepeatBtn && !suraRepeatBtn._bound){
      suraRepeatBtn._bound = true;
      suraRepeatBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();

        // in Favorites nie relevant (Button ist dort sowieso versteckt)
        if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

        surahRepeatOn = !surahRepeatOn;
        _saveBool(LS_SURAH_REPEAT, surahRepeatOn);
        syncSurahRepeatUI();
      });
    }
  }catch(e){}

  // ✅ bind Favorites Repeat button (Statusbar) -> gekoppelt an FavTopRepeat
  try{
    function syncFavRepeatUI(){
      if (!favRepeatBtn) return;
      favRepeatBtn.classList.toggle("is-on", isFavRepeatOn());
    }
    // einmal initial
    syncFavRepeatUI();

    if (favRepeatBtn && !favRepeatBtn._bound){
      favRepeatBtn._bound = true;
      favRepeatBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();

        // nur in Favorites sinnvoll
        if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;

        const next = !isFavRepeatOn();
        setFavRepeatOn(next);

        // Statusbar Button UI
        favRepeatBtn.classList.toggle("is-on", next);

        // FavTopBar Button UI (falls sichtbar)
        const top = document.querySelector("button.favTopRepeat");
        if (top) top.classList.toggle("is-on", next);
      });
    }

    // verfügbar machen, damit renderFavoritesPage/openFavoritesPage es nachrendern können
    window.__syncFavRepeatUI = syncFavRepeatUI;
  }catch(e){}

  const suraProg = document.getElementById("suraProg");
  const suraProgTicks = document.getElementById("suraProgTicks");

    // ✅ Surah dropdown (Statusbar)
  const suraDrop = document.getElementById("suraDrop");
  const suraDropBtn = document.getElementById("suraDropBtn");
  const suraDropText = document.getElementById("suraDropText");
  const suraDropMenu = document.getElementById("suraDropMenu");

    // ✅ Font dropdown (Statusbar)
  const fontDrop = document.getElementById("fontDrop");
  const fontDropBtn = document.getElementById("fontDropBtn");
  const fontDropText = document.getElementById("fontDropText");
  const fontDropMenu = document.getElementById("fontDropMenu");

  // ✅ Reciter dropdown (Statusbar)
  const recDrop = document.getElementById("recDrop");
  const recDropBtn = document.getElementById("recDropBtn");
  const recDropText = document.getElementById("recDropText");
  const recDropMenu = document.getElementById("recDropMenu");

  // ✅ Translations dropdown (Statusbar)
  const trDrop = document.getElementById("trDrop");
  const trDropBtn = document.getElementById("trDropBtn");
  const trDropText = document.getElementById("trDropText");
  const trDropMenu = document.getElementById("trDropMenu");

  // ✅ Font Size (Statusbar)
  const fsCtl   = document.getElementById("fsCtl");
  const fsBtn   = document.getElementById("fsBtn");
  const fsVal   = document.getElementById("fsVal");
  const fsMinus = document.getElementById("fsMinus");
  const fsPlus  = document.getElementById("fsPlus");

  const themeBtn = document.getElementById("themeBtn");

    // ✅ Jump feedback UI (damit User sieht: er lädt/arbeitet)
  const statusbar = document.getElementById("statusbar");
  let jumpBusy = false;

  // ✅ Favorites Button (Statusbar)
const favBtnBtn = document.getElementById("favBtnBtn");
const favText   = document.getElementById("favText");
const favCount  = document.getElementById("favCount");

// ✅ Clear Favorites Button (Statusbar)
const favClearBtn = document.getElementById("favClearBtn");

if (favClearBtn && !favClearBtn._bound) {
  favClearBtn._bound = true;
  favClearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // nur sinnvoll in Favorites-Page
    if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;

    const ok = confirm("ARE YOU SURE?!");
    if (!ok) return;

    // ✅ Stop Favorites playback sofort
    try { stopFavoritesQueue(); } catch {}
    try { stopVerseAudio({ stopQueue: true }); } catch {}

    // ✅ Clear bookmarks
    try { saveBookmarks([]); } catch {}
    try { window.__refreshFavCount?.(); } catch {}

    // ✅ Re-render Favorites page (zeigt dann empty state)
    try { renderFavoritesPage(); } catch {}
  });
}

  // ✅ Mushaf/Ayah Toggle Button (Statusbar)
  const viewToggleBtn = document.getElementById("viewToggleBtn");

  function syncViewToggleBtn() {
    if (!viewToggleBtn) return;

    // Favoriten-Seite zählt wie "Ayah" (weil sie in qView gerendert wird)
    const isMushaf = (viewMode === "mushaf") && !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);
    viewToggleBtn.classList.toggle("is-mushaf", !!isMushaf);
  }

  // global verfügbar, damit toggleViewMode() / Favorites hooks es syncen können
  window.__syncViewToggleBtn = syncViewToggleBtn;

  if (viewToggleBtn && !viewToggleBtn._bound) {
    viewToggleBtn._bound = true;
    viewToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Wenn wir auf der Favoriten-Seite sind: erst zurück zur normalen View
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
        closeFavoritesPage(); // rendert die vorherige ViewMode + currentRef
        // danach togglen
      }

      toggleViewMode();       // rendert + fokussiert currentRef
      syncViewToggleBtn();
    });
  }

  // ✅ SuraPlay Tooltip (einmal)
  let suraTip = document.getElementById("suraProgTip");
  if (!suraTip) {
    suraTip = document.createElement("div");
    suraTip.id = "suraProgTip";
    suraTip.className = "suraProgTip";
    document.body.appendChild(suraTip);
  }

  // ✅ NEU: Word hover tooltip
  let wordTip = document.getElementById("wordTip");
  if (!wordTip) {
    wordTip = document.createElement("div");
    wordTip.id = "wordTip";
    wordTip.className = "qHoverTip";
    document.body.appendChild(wordTip);
  }

  // ✅ NEU: Mushaf Ayahnummer hover tooltip
  let mNoTip = document.getElementById("mNoTip");
  if (!mNoTip) {
    mNoTip = document.createElement("div");
    mNoTip.id = "mNoTip";
    mNoTip.className = "qHoverTip";
    document.body.appendChild(mNoTip);
  }

const escTip = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

let hifzHelpTip = document.getElementById("hifzHelpTip");
if (!hifzHelpTip) {
  hifzHelpTip = document.createElement("div");
  hifzHelpTip.id = "hifzHelpTip";
  hifzHelpTip.className = "suraProgTip";
  document.body.appendChild(hifzHelpTip);
}

if (!document.__hifzHelpTooltipBound) {
  document.__hifzHelpTooltipBound = true;

  let _lastHifzHelpKey = "";

  document.addEventListener("mousemove", (e) => {
    if (!tooltipsAllowed()) {
      _lastHifzHelpKey = "";
      _hideTip(hifzHelpTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip, #hifzHelpTip")) return;

    const helpEl = e.target?.closest?.("[data-hifz-help]");
    if (!helpEl) {
      _lastHifzHelpKey = "";
      _hideTip(hifzHelpTip);
      return;
    }

    const title = String(helpEl.dataset?.hifzHelpTitle || "Help");
    const text = String(helpEl.dataset?.hifzHelpText || "");
    const key = `${helpEl.dataset?.hifzHelp || ""}|${title}|${text}`;

    if (_lastHifzHelpKey !== key) {
      _lastHifzHelpKey = key;
      hifzHelpTip.innerHTML = `
        <div class="tipRef">${escTip(title)}</div>
        ${text ? `<div class="tipTr">${escTip(text)}</div>` : ``}
      `;
    }

    _placeTip(hifzHelpTip, e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
    const helpEl = e.target?.closest?.("[data-hifz-help]");
    if (!helpEl) return;

    const rel = e.relatedTarget;
    const stillInsideHelp = rel?.closest?.("[data-hifz-help]");
    if (stillInsideHelp) return;

    _lastHifzHelpKey = "";
    _hideTip(hifzHelpTip);
  }, { passive: true });
}

function _firstActiveTranslationText(ref){
    try{
      const a = getAyah(ref);
      if (!a) return "";
      const first = (activeTranslations && activeTranslations[0]) ? activeTranslations[0] : null;
      if (!first?.file) return "";
      const tJson = translationCache.get(first.file);
      if (!tJson) return "";
      return getTranslationTextFromJson(tJson, a.surah, a.ayah) || "";
    }catch{ return ""; }
  }

    // ✅ Tooltips während Playback AUS (Performance)
  // (Wichtig: verseAudio ist in deinem Code meist NICHT auf window)
  function tooltipsAllowed(){
    const a =
      (typeof verseAudio !== "undefined" && verseAudio) ? verseAudio :
      (window.verseAudio ? window.verseAudio : null);

    // erlaubt = NICHT am Spielen
    return !(a && !a.paused);
  }

function _placeTip(tipEl, x, y){
  if (!tipEl) return;

  // ✅ Pad/Offsets NICHT hard px: aus stage-w/h ableiten
  const cs = getComputedStyle(document.documentElement);
  const stageW = parseFloat(cs.getPropertyValue("--stage-w")) || window.innerWidth;
  const stageH = parseFloat(cs.getPropertyValue("--stage-h")) || window.innerHeight;

  const pad   = Math.max(1, stageW * 0.008);   // ~0.8% von stage-w
  const gapY  = Math.max(1, stageH * 0.012);   // Abstand zur Maus

  // ✅ sichtbar via Klasse (CSS Delay)
  tipEl.classList.add("is-show");

  // Stage bounds (damit nie ins Ornament / Bars gerät)
  const stageEl = document.getElementById("stage");
  const stageRect = stageEl ? stageEl.getBoundingClientRect() : { left:0, top:0, right:window.innerWidth, bottom:window.innerHeight };

  // Tooltip-Größe erst NACH "is-show" messen
  const rect = tipEl.getBoundingClientRect();

  // Ziel X: zentriert zur Maus
  let left = x - rect.width / 2;

  // Platz oben/unten NUR innerhalb der Stage rechnen
  const spaceBelow = stageRect.bottom - (y + gapY);
  const spaceAbove = (y - gapY) - stageRect.top;

  // Default: lieber unter der Maus, sonst darüber
  let top = (spaceBelow >= rect.height + pad) ? (y + gapY) : (y - rect.height - gapY);

  // ✅ NICHT in die Statusbar ragen (Statusbar ist oben in der Stage)
  let minTop = stageRect.top + pad;
  try{
    const sb = document.getElementById("statusbar");
    if (sb){
      const sbRect = sb.getBoundingClientRect();
      // Tooltip soll NICHT über die Statusbar (und nicht drauf)
      minTop = Math.max(minTop, (sbRect.bottom || 0) + pad);
    }
  }catch(e){}

  // ✅ NICHT auf die SurahTopBar (die “Topbar” in Ayah/Mushaf)
  // Wir nehmen die oberste sichtbare SurahTopBar innerhalb der Stage.
  try{
    const tops = Array.from(document.querySelectorAll(".surahTopBar"));
    let best = null;
    for (const el of tops){
      const r = el.getBoundingClientRect();
      // nur wenn innerhalb der Stage sichtbar
      const visible =
        r.bottom > stageRect.top &&
        r.top < stageRect.bottom &&
        r.right > stageRect.left &&
        r.left < stageRect.right;
      if (!visible) continue;

      // "oberste" Bar wählen (kleinster top, aber nicht komplett außerhalb)
      if (!best || r.top < best.top) best = r;
    }
    if (best){
      // Tooltip soll NICHT auf/über dieser Topbar liegen
      minTop = Math.max(minTop, (best.bottom || 0) + pad);
    }
  }catch(e){}

  // ✅ Clamp X/Y in die Stage (nie in die Ornament-Bars)
  const minLeft = stageRect.left + pad;
  const maxLeft = stageRect.right - rect.width - pad;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  const maxTop = stageRect.bottom - rect.height - pad;
  top = Math.max(minTop, Math.min(top, maxTop));

  tipEl.style.left = left + "px";
  tipEl.style.top  = top  + "px";
}

function _hideTip(tipEl){
  if (!tipEl) return;
  tipEl.classList.remove("is-show");
}

function _showSuraTipAt(x, y, ref, { compactRefOnly = false } = {}){
  const a = getAyah(ref);
  if (!a) return;

  if (compactRefOnly) {
    suraTip.innerHTML = `
      <div class="tipRef">${escTip(a.ref)}</div>
    `;
    _placeTip(suraTip, x, y);
    return;
  }

  const tr = _firstActiveTranslationText(ref);
  suraTip.innerHTML = `
    <div class="tipRef">${escTip(a.ref)}</div>
    <div class="tipAr" dir="rtl" lang="ar">${a.textAr || ""}</div>
    ${tr ? `<div class="tipTr">${escTip(tr)}</div>` : ``}
  `;

  _placeTip(suraTip, x, y);
}

  function _hideSuraTip(){
    _hideTip(suraTip);
  }

  // =========================
  // Ticks bauen
  // =========================
  let _ticksSurah = 0;

  function _getSuraProgRangeBounds(surahNo){
    try{
      const hifzVisible = !!document.querySelector(".hifzTrainTopBar, .hifzTestTopBar");
      if (!hifzVisible) return { fromAyah: 0, toAyah: 0 };

      const s = Number(surahNo || 0);
      const refsRaw = (typeof getSuraRefs === "function") ? (getSuraRefs(s) || []) : [];
      const rawRange = (typeof loadHifzRangeValue === "function")
        ? String(loadHifzRangeValue() || "1-999").trim()
        : "1-999";

      const m = rawRange.match(/^(\d+)\s*-\s*(\d+)$/);

      let fromAyah = 1;
      let toAyah = Number(getSuraMeta(s)?.ayahCount || refsRaw.length || 1);

      if (m) {
        fromAyah = Math.max(1, Number(m[1]) || 1);
        toAyah = Math.max(1, Number(m[2]) || fromAyah);
      }

      if (toAyah < fromAyah) {
        const tmp = fromAyah;
        fromAyah = toAyah;
        toAyah = tmp;
      }

      const maxAyah = Number(getSuraMeta(s)?.ayahCount || refsRaw.length || 1);
      fromAyah = Math.min(fromAyah, maxAyah);
      toAyah = Math.min(toAyah, maxAyah);

      return { fromAyah, toAyah };
    }catch{
      return { fromAyah: 0, toAyah: 0 };
    }
  }

function syncSuraTickDecor(surahNo){
  if (!suraProgTicks) return;

  const isVisibleEl = (el) => {
    if (!el) return false;
    try{
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (el.offsetParent === null && cs.position !== "fixed") return false;
    }catch{}
    return true;
  };

  const isHifzTestMode = (() => {
    try{
      const qv = document.querySelector(".qView");
      if (!isVisibleEl(qv)) return false;
      return !!qv.querySelector(".hifzTestTopBar");
    }catch{
      return false;
    }
  })();

  const isHifzTrainMode = (() => {
    try{
      const mv = document.querySelector(".mView");
      if (!isVisibleEl(mv)) return false;
      return !!mv.querySelector(".hifzTrainTopBar");
    }catch{
      return false;
    }
  })();

  const stageForTicks = (typeof loadHifzStageValue === "function") ? loadHifzStageValue() : "1";
  const hideRenderedRangeUi = isHifzTestMode && isHifzStageWithoutRenderedRangeUi(stageForTicks);

  try{
    if (statusbar){
      statusbar.classList.toggle("is-hifz-test", isHifzTestMode);
      statusbar.classList.toggle("is-hifz-train", isHifzTrainMode);
      statusbar.classList.toggle("is-hifz-range-ui", isHifzTestMode || isHifzTrainMode);
    }
  }catch{}

  const s = Number(surahNo || 0);
  if (!s) return;

  const bounds = _getSuraProgRangeBounds(s);
  const fromAyah = hideRenderedRangeUi ? 0 : Number(bounds?.fromAyah || 0);
  const toAyah = hideRenderedRangeUi ? 0 : Number(bounds?.toAyah || 0);

  suraProgTicks.querySelectorAll(".suraTick[data-ref]").forEach((btn) => {
    const ref = String(btn.dataset.ref || "");
    const a = getAyah(ref);
    const ay = Number(a?.ayah || 0);

    const ratioRaw = Number(getHifzProgressRatioForRef(ref, stageForTicks) || 0);
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    const result = getHifzResultForRef(ref, stageForTicks);

    btn.style.setProperty("--tick-progress-pct", `${(ratio * 100).toFixed(3)}%`);
    btn.classList.toggle("is-hifz-progress", ratio > 0);
    btn.classList.toggle("is-hifz-mastered", ratio >= 1);
    btn.classList.toggle("is-hifz-bad", result === "bad");
    btn.classList.toggle("is-range-start", !!fromAyah && ay === fromAyah);
    btn.classList.toggle("is-range-end", !!toAyah && ay === toAyah);
  });
}

function buildSuraTicks(surahNo){
  if (!suraProgTicks) return;

  const s = Number(surahNo || 0);
  const meta = getSuraMeta(s);
  if (!meta || !meta.ayahCount) {
    suraProgTicks.innerHTML = "";
    suraProgTicks.style.setProperty("--sura-tick-count", "1");
    _ticksSurah = 0;
    return;
  }

  const n = Number(meta.ayahCount);
  const stageForTicks = (typeof loadHifzStageValue === "function") ? loadHifzStageValue() : "1";
  const isHifzTestModeNow = (() => {
    try{
      const qv = document.querySelector(".qView");
      return !!qv && !!qv.querySelector(".hifzTestTopBar");
    }catch{
      return false;
    }
  })();
  const hideRenderedRangeUi = isHifzTestModeNow && isHifzStageWithoutRenderedRangeUi(stageForTicks);
  const bounds = _getSuraProgRangeBounds(s);
  const fromAyah = hideRenderedRangeUi ? 0 : Number(bounds?.fromAyah || 0);
  const toAyah = hideRenderedRangeUi ? 0 : Number(bounds?.toAyah || 0);

  // gleiche Sura + gleiche Anzahl -> nur Decor aktualisieren
  if (_ticksSurah === s && suraProgTicks.childElementCount === n) {
    syncSuraTickDecor(s);
    return;
  }

  _ticksSurah = s;
  suraProgTicks.style.setProperty("--sura-tick-count", String(n));

  let html = "";
  for (let i = 1; i <= n; i++){
    const pct = (n <= 0) ? 0 : (((i - 0.5) / n) * 100);
    const ref = `${s}:${i}`;

    const ratioRaw = Number(getHifzProgressRatioForRef(ref, stageForTicks) || 0);
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    const result = getHifzResultForRef(ref, stageForTicks);

    const cls = [
      "suraTick",
      ratio > 0 ? "is-hifz-progress" : "",
      ratio >= 1 ? "is-hifz-mastered" : "",
      result === "bad" ? "is-hifz-bad" : "",
      (fromAyah && i === fromAyah) ? "is-range-start" : "",
      (toAyah && i === toAyah) ? "is-range-end" : ""
    ].filter(Boolean).join(" ");

    html += `<button class="${cls}" type="button" style="left:${pct.toFixed(4)}%;--tick-progress-pct:${(ratio * 100).toFixed(3)}%" data-ref="${ref}" aria-label="${ref}"></button>`;
  }

  suraProgTicks.innerHTML = html;
}

window.__suraProgSetSurah = (s) => {
  try {
    buildSuraTicks(s);
    syncSuraTickDecor(s);
    markActiveTick(currentRef || `${Number(s || currentSurahInView || 1)}:1`);
  } catch {}
};

window.__suraProgRefresh = () => {
  try {
    buildSuraTicks(currentSurahInView || 1);
    syncSuraTickDecor(currentSurahInView || 1);
    markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
  } catch {}
};

try {
  buildSuraTicks(currentSurahInView || 1);
  syncSuraTickDecor(currentSurahInView || 1);
  markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
} catch {}

  // ✅ O(1): nur letztes + neues Element anfassen (keine querySelectorAll-Loops)
  let _lastActiveTickEl = null;
  let _lastActiveTickRef = "";

  function markActiveTick(ref){
    if (!suraProgTicks) return;

    const r = String(ref || "");

    try{
      const aNow = getAyah(r);
      syncSuraTickDecor(aNow?.surah || currentSurahInView || 0);
    }catch{}

    // Wenn wir schon auf diesem Ref sind und das Element noch im DOM ist -> nix tun
    if (_lastActiveTickRef === r && _lastActiveTickEl && _lastActiveTickEl.isConnected) return;

    // alten Active-Tick deaktivieren (nur 1 Element)
    if (_lastActiveTickEl && _lastActiveTickEl.isConnected) {
      _lastActiveTickEl.classList.remove("is-active");
    }

    // neuen Tick finden + aktivieren
    const btn = suraProgTicks.querySelector(`.suraTick[data-ref="${CSS.escape(r)}"]`);
    if (btn) {
      btn.classList.add("is-active");
      _lastActiveTickEl = btn;
      _lastActiveTickRef = r;
    } else {
      // falls nix gefunden: Cache zurücksetzen (verhindert falsches "stuck")
      _lastActiveTickEl = null;
      _lastActiveTickRef = r;
    }
  }

  // =========================
  // Tick Events + Tooltips
  // =========================
  if (suraProgTicks && !suraProgTicks.__bound) {
    suraProgTicks.__bound = true;

suraProgTicks.addEventListener("click", (e) => {
  const t = e.target.closest?.(".suraTick[data-ref]");
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();

  // ✅ Fix: nach Tick-Klick kurz “chillen”, damit der Balken nicht vor/zurück springt
  try { window.__suraProgFreezeUntil = performance.now() + 400; } catch(e) {}

  const ref = t.dataset.ref || "";
  if (!/^\d+:\d+$/.test(ref)) return;

  const [sStr, aStr] = ref.split(":");
  const s = Number(sStr), ay = Number(aStr);

  // ✅ Wenn Surah Queue läuft: dort weiterspielen
  if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
    try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
    return;
  }

  // ✅ Immer goToRef: hält URL/currentRef/currentSurahInView korrekt
  const ok = goToRef(ref, { updateUrl: true });

  // ✅ Mushaf: nach Render nochmal sicher zum Nummernblock scrollen
  // (weil Render/Chunking/Idle Timing sonst manchmal "zu spät" ist)
  if (ok && viewMode === "mushaf") {
    const mv = document.querySelector(".mView");
    if (mv && mv.style.display !== "none") {
      setTimeout(() => {
        try {
          scrollToMushafNoWhenReady(mv, ref, { updateUrl: false, scroll: true });
        } catch {}
      }, 0);
    }
  }

  // ✅ Tick sofort visuell aktiv setzen (falls du markActiveTick hast)
  try { markActiveTick?.(ref); } catch {}
});

    // ✅ SuraProg: Click anywhere on bar => jump to that ayah
    if (suraProg && !suraProg.__boundClick) {
      suraProg.__boundClick = true;

suraProg.addEventListener("click", (e) => {
        if (e.target?.closest?.(".suraTick")) return;

        e.preventDefault();
        e.stopPropagation();

        // ✅ Fix: nach Bar-Klick kurz “chillen”, damit der Balken nicht vor/zurück springt
        try { window.__suraProgFreezeUntil = performance.now() + 400; } catch(e) {}

        const s =
          (typeof surahPlaying !== "undefined" && surahPlaying)
            ? Number(surahPlaying)
            : Number(currentSurahInView || 0);

        const meta = getSuraMeta(s);
        const n = Number(meta?.ayahCount || 0);
        if (!s || n <= 0) return;

        // ✅ Kein Layout-Rect: offsetX/clientWidth benutzen
        // offsetX ist relativ zum Event-Target -> sicherstellen: wir wollen suraProg als Referenz
        const w = suraProg.clientWidth || 0;
        if (w <= 0) return;

        // click position 0..1
        const x01 = Math.max(0, Math.min(1, (e.offsetX || 0) / w));

        // nearest tick
        const idx0 = Math.min(n - 1, Math.floor(x01 * n));
        const ay = idx0 + 1;
        const ref = `${s}:${ay}`;

        if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
          try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
          return;
        }

        goToRef(ref, { updateUrl: true });
      });
    }

    // Hover: tooltip
    let _suraTipLastT = 0;
    let _suraTipLastRef = "";

    const _isVisibleEl = (el) => {
      if (!el) return false;
      try{
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
      }catch{}
      return true;
    };

    const _isHifzTestModeActive = () => {
      try{
        const qv = document.querySelector(".qView");
        if (!_isVisibleEl(qv)) return false;
        return !!qv.querySelector(".hifzTestTopBar");
      }catch{
        return false;
      }
    };

    const _isTickInsideRenderedTestRange = (tickEl) => {
      try{
        const ref = String(tickEl?.dataset?.ref || "");
        const a = getAyah(ref);
        if (!a) return false;

        const { fromAyah, toAyah } = _getSuraProgRangeBounds(a.surah);
        if (!fromAyah || !toAyah) return false;

        return a.ayah >= fromAyah && a.ayah <= toAyah;
      }catch{
        return false;
      }
    };

const _showSuraTipForTick = (tickEl, x, y) => {
  const ref = String(tickEl?.dataset?.ref || "");
  if (!ref) {
    _hideSuraTip();
    return;
  }

  const isInsideRenderedTestRange =
    _isHifzTestModeActive() && _isTickInsideRenderedTestRange(tickEl);

  const stageNow = String(hifzStageValue || "1");
  const compactForLockedStages =
    !!statusbar?.classList.contains("is-hifz-range-ui") &&
    /^(6|7|8|9|10)$/.test(stageNow);

  _showSuraTipAt(x, y, ref, {
    compactRefOnly: compactForLockedStages || isInsideRenderedTestRange
  });
};

suraProgTicks.addEventListener("pointermove", (e) => {
  const t = e.target?.closest?.(".suraTick[data-ref]");
  if (!t) {
    _hideSuraTip();
    return;
  }

  const ref = String(t.dataset.ref || "");
  const now = (performance && performance.now) ? performance.now() : Date.now();

  if (ref === _suraTipLastRef && (now - _suraTipLastT) < 40) return;

  _suraTipLastRef = ref;
  _suraTipLastT = now;

  _showSuraTipForTick(t, e.clientX, e.clientY);
}, { passive: true });

suraProgTicks.addEventListener("pointerover", (e) => {
  const t = e.target?.closest?.(".suraTick[data-ref]");
  if (!t) return;

  const r = t.getBoundingClientRect();
  _suraTipLastRef = String(t.dataset.ref || "");
  _suraTipLastT = 0;

  _showSuraTipForTick(
    t,
    r.left + (r.width / 2),
    r.top + (r.height / 2)
  );
}, { passive: true });

suraProgTicks.addEventListener("focusin", (e) => {
  const t = e.target?.closest?.(".suraTick[data-ref]");
  if (!t) return;

  const r = t.getBoundingClientRect();
  _suraTipLastRef = String(t.dataset.ref || "");
  _suraTipLastT = 0;

  _showSuraTipForTick(
    t,
    r.left + (r.width / 2),
    r.top + (r.height / 2)
  );
});

suraProgTicks.addEventListener("pointerleave", () => {
  _suraTipLastRef = "";
  _hideSuraTip();
});

suraProgTicks.addEventListener("focusout", (e) => {
  if (suraProgTicks.contains(e.relatedTarget)) return;
  _suraTipLastRef = "";
  _hideSuraTip();
});
        // =========================
    // Scroll-Progress 
    // =========================
    (function bindScrollProgress(){
      // nur 1x binden
      if (window.__scrollProgBound) return;
      window.__scrollProgBound = true;

      // Element anlegen (ohne HTML ändern)
      let scrollProg = document.getElementById("scrollProgress");
      if (!scrollProg && suraProg) {
        scrollProg = document.createElement("div");
        scrollProg.id = "scrollProgress";
        suraProg.appendChild(scrollProg);
      }
      if (!scrollProg) return;

      function _getActiveScrollView(){
  const mv = document.querySelector(".mView");
  const qv = document.querySelector(".qView");

  const isVisible = (el) => {
    if (!el) return false;
    try{
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    }catch{}
    // display:none => offsetParent meist null (außer fixed)
    try{
      const cs = getComputedStyle(el);
      if (el.offsetParent === null && cs.position !== "fixed") return false;
    }catch{}
    return true;
  };

  // ✅ Nimm die View, die wirklich sichtbar ist
  const v = isVisible(mv) ? mv : (isVisible(qv) ? qv : (mv || qv));
  if (!v) return null;

  // ✅ Favorites-Modus -> kein Scroll-Progress
  if (v.dataset && v.dataset.mode === "favorites") return null;

  return v;
}

function _shouldShow(){
  const sb = document.querySelector(".statusbar");
  if (!sb) return false;

  // ✅ ORIGINAL: nur wenn NICHT SurahPlay und NICHT Favorites
  if (sb.classList.contains("is-surah-playing")) return false;
  if (sb.classList.contains("is-favorites")) return false;

  return true;
}

      function _calcPct(view){
        // ✅ 1) Wenn currentRef zur aktuellen Sura passt: Progress nach Ayah-Index
        try{
          const a = (typeof getAyah === "function") ? getAyah(currentRef) : null;
          const s = Number(currentSurahInView || 0);

          if (a && s && Number(a.surah) === s) {
            const meta = (typeof getSuraMeta === "function") ? getSuraMeta(s) : null;
            const n = Number(meta?.ayahCount || 0);
            if (n > 1) {
              const pctAy = (Number(a.ayah) - 1) / (n - 1);   // 1. Ayah => 0, letzte => 1
              return Math.max(0, Math.min(1, pctAy));
            }
            if (n === 1) return 1;
          }
        }catch{}

        // ✅ 2) Fallback: klassisch nach scrollTop
        const max = Math.max(1, (view.scrollHeight - view.clientHeight));
        const pct = view.scrollTop / max;
        return Math.max(0, Math.min(1, pct));
      }

      let _rafPending = false;

function _update(){
  _rafPending = false;

  // ✅ Fix: nach Tick/Bar-Klick kurz “chillen” (kein Hin-und-Her)
  try{
    const fu = Number(window.__suraProgFreezeUntil || 0);
    if (fu && performance.now() < fu) return;
  }catch(e){}

  // wenn nicht erlaubt: auf 0 setzen (versteckt wird per CSS)
  if (!_shouldShow()) {
    scrollProg.style.transform = "scaleX(0)";
    return;
  }

  const view = _getActiveScrollView();
  if (!view) {
    scrollProg.style.transform = "scaleX(0)";
    return;
  }

  const pct = _calcPct(view);
  scrollProg.style.transform = `scaleX(${pct})`;

  // ✅ Orange Marker in der Statusleiste immer mit aktueller Ayah nachziehen
  try{
    markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
  }catch{}
}

      function _schedule(){
        if (_rafPending) return;
        _rafPending = true;
        requestAnimationFrame(_update);
      }

      // Events (passive => besser)
      window.addEventListener("scroll", _schedule, { passive: true, capture: true });
      window.addEventListener("resize", _schedule, { passive: true });

      // initial
      _schedule();

      // optional: für manuelles testen
      window.__updateScrollProgress = _schedule;
    })();
  }

  // =========================
  // ✅ NEU: Word hover tooltip (Wortübersetzung + 1. Ayah-Übersetzung)
  // =========================
  let _lastWordKey = "";
  document.addEventListener("mousemove", (e) => {
    // ✅ während Playback: Tooltips aus
    if (!tooltipsAllowed()) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    // nicht über anderen Tooltips
    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip")) return;

    const wEl = e.target?.closest?.(".w:not(.wMark)");
    if (!wEl) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    const ref = wEl.dataset?.ref || "";
    const wi  = Number(wEl.dataset?.wi);
    if (!/^\d+:\d+$/.test(ref) || !Number.isFinite(wi) || wi < 0) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    const key = `${ref}|${wi}`;
    if (_lastWordKey !== key) {
      _lastWordKey = key;

      const words = (typeof getWords === "function") ? getWords(ref) : null;
      const wObj = Array.isArray(words) ? words[wi] : null;

      const wordTr = (wObj?.de || wObj?.en || "").trim();
      const ayTr = (_firstActiveTranslationText(ref) || "").trim();

      // Wenn gar nix da ist -> kein Tooltip
      if (!wordTr && !ayTr) {
        _hideTip(wordTip);
        return;
      }

      wordTip.innerHTML = `
        ${wordTr ? `<div class="tipWord"><span class="tipLabel">word translate:</span> ${escTip(wordTr)}</div>` : ``}
        ${ayTr ? `<div class="tipTr"><span class="tipLabel">ayah translate:</span> ${escTip(ayTr)}</div>` : ``}
      `;
    }

    _placeTip(wordTip, e.clientX, e.clientY);
  }, { passive: true });

  // =========================
  // ✅ NEU: Mushaf Ayahnummer hover tooltip (nur Mushaf)
  // =========================
  let _lastNoRef = "";
  document.addEventListener("mousemove", (e) => {
    // ✅ während Playback: Tooltips aus
    if (!tooltipsAllowed()) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip")) return;

    // nur im Mushaf-Modus
    if (viewMode !== "mushaf") {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    const noEl = e.target?.closest?.(".mNo[data-ref]");
    if (!noEl) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    const ref = String(noEl.dataset?.ref || "");
    if (!ref) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    if (_lastNoRef !== ref) {
      _lastNoRef = ref;

      // Text wie Screenshot (nur schöner)
mNoTip.innerHTML = `
  <div class="tipRef">${escTip(ref)}</div>
  <div class="tipAr" dir="rtl" lang="ar">انقر بالزر الأيسر للتشغيل</div>
  <div class="tipAr" dir="rtl" lang="ar">Ctrl + نقرة يسار للإشارة المرجعية</div>
  <div class="tipAr" dir="rtl" lang="ar">Shift + نقرة يسار للملاحظات</div>
  <div class="tipAr" dir="rtl" lang="ar">Alt + نقرة يسار للنسخ</div>
  <div class="tipTr">Left click to play</div>
  <div class="tipTr">Shift + left click for notes</div>
  <div class="tipTr">Ctrl + left click to bookmark</div>
  <div class="tipTr">Alt + left click to copy</div>
  
`;
    }

    _placeTip(mNoTip, e.clientX, e.clientY);
  }, { passive: true });

  function refreshFavCount() {
    // ✅ Wichtig: nach Reload soll der Count zur aktiven Favorites-Seite passen (actual ODER preset)
    try {
      if (typeof window.__refreshFavCount === "function") {
        window.__refreshFavCount();
        return;
      }
    } catch {}

    // Fallback (sollte praktisch nie greifen)
    if (!favCount) return;
    const n = (loadBookmarks()?.length || 0);
    favCount.textContent = String(n);
  }

  // =========================
// Theme Toggle (Light/Dark)
// =========================
const LS_THEME = "quranm_theme_v1";

function applyTheme(mode){
  const m = (mode === "light") ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", m);
  try { localStorage.setItem(LS_THEME, m); } catch(e){}
}

function loadTheme(){
  try {
    const v = String(localStorage.getItem(LS_THEME) || "");
    return (v === "light" || v === "dark") ? v : "dark";
  } catch(e){
    return "dark";
  }
}

// init beim Laden
applyTheme(loadTheme());
// ✅ Style Picker init (Paletten/Designs)
try { initStylePicker(); } catch {}

// click toggle
if (themeBtn) {
themeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = (cur === "light") ? "dark" : "light";
  applyTheme(next);

  // ✅ WICHTIG: Palette neu anwenden, damit Light/Dark-Varianten greifen
  try {
    const saved = loadStyleThemeId();
    const fallback =
      (STYLE_THEMES.find(t => t?.label === "Charcoal Accent 31")?.id) ||
      (STYLE_THEMES.find(t => t?.id === "style-141")?.id) ||
      (STYLE_THEMES[0] ? STYLE_THEMES[0].id : "");
    applyStyleThemeById(saved || fallback);
  } catch (err) {
    console.warn("[theme] reapply style failed:", err);
  }
});
}

const FAV_PROGRESS_STEP = 2; // jede 2 Ayahs (weniger clunky)
let _favLastBucket = -1;
let _favLastPct = -1;
let _favRaf = 0;

// ✅ Marks Cache (damit wir nicht ständig neu bauen)
let _favMarksKey = "";
let _favLastMarksSurah = 0;

function setFavProgressPct(pct) {
  if (!favBtnBtn) return;
  const safe = Math.max(0, Math.min(100, pct));
  favBtnBtn.style.setProperty("--fav-prog", safe.toFixed(2) + "%");
}

// ✅ baut multi-linear-gradients für 1px Striche (Positionen in %)
// ✅ Quelle wird als srcRefs übergeben (actual ODER preset-page)
function _buildFavMarksBgForSurah(surahNo, srcRefs) {
  const s = Number(surahNo || 0);
  if (!s || s < 1 || s > 114) return "none";

  const meta = getSuraMeta(s);
  const ayahCount = Number(meta?.ayahCount || 0);
  if (!ayahCount || ayahCount <= 1) return "none";

  let list = [];
  try {
    list = (srcRefs || [])
      .map(String)
      .filter((r) => r.startsWith(s + ":"))
      .map((r) => Number(r.split(":")[1] || 0))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= ayahCount);
  } catch {
    list = [];
  }

  list = Array.from(new Set(list)).sort((a, b) => a - b);
  if (!list.length) return "none";

  if (list.length > 350) list = list.slice(0, 350);

  const layers = [];
  for (const ayahNo of list) {
    const pct = ((ayahNo - 1) / (ayahCount - 1)) * 100;

    layers.push(
      `linear-gradient(90deg,
        transparent calc(${pct.toFixed(4)}% - var(--u1w)),
        var(--color-fav-mark) calc(${pct.toFixed(4)}% - var(--u1w)),
        var(--color-fav-mark) calc(${pct.toFixed(4)}% + var(--u1w)),
        transparent calc(${pct.toFixed(4)}% + var(--u1w))
      )`
    );
  }

  return layers.join(",");
}

function updateFavMarksForSurah(surahNo) {
  if (!favBtnBtn) return;

  // ✅ In Favorites-Seite: Marks immer aus
  if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
    favBtnBtn.style.setProperty("--fav-mark-bg", "none");
    _favMarksKey = "";
    _favLastMarksSurah = 0;
    return;
  }

  const s = Number(surahNo || 0);
  if (!s) {
    favBtnBtn.style.setProperty("--fav-mark-bg", "none");
    _favMarksKey = "";
    _favLastMarksSurah = 0;
    return;
  }

  // ✅ Ayah/Mushaf: Quelle = aktive Seite (actual ODER preset)
  let srcRefs = [];
  let srcTag = "actual";
  try {
    srcRefs = getActiveFavRefs();
    srcTag = String(favPresetActiveName || "actual");
  } catch {
    srcRefs = [];
    srcTag = "actual";
  }

  // Cache-Key: surah + pageName + refs in surah
  let key = "";
  try {
    const inS = (srcRefs || [])
      .map(String)
      .filter((r) => r.startsWith(s + ":"))
      .sort()
      .join("|");
    key = `${s}::${srcTag}::${inS}`;
  } catch {
    key = `${s}::${srcTag}::`;
  }

  if (key === _favMarksKey) return;

  _favMarksKey = key;
  _favLastMarksSurah = s;

  const bg = _buildFavMarksBgForSurah(s, srcRefs);
  favBtnBtn.style.setProperty("--fav-mark-bg", bg);
}

function computeAyahScrollProgress(qv) {
  // 1) Bestimme die Sura, die gerade wirklich im View ist
  const all = qv.querySelectorAll(".ayahMainCard[data-ref]");
  if (!all || all.length === 0) return { idx: 0, pct: 0, bucket: 0, surah: 0 };

  const qTop = qv.getBoundingClientRect().top;

  // erste Card im sichtbaren Bereich
  let focusCard = all[0];
  for (let i = 0; i < all.length; i++) {
    const r = all[i].getBoundingClientRect();
    if ((r.bottom - qTop) > 12) { focusCard = all[i]; break; }
  }

  const ref = focusCard.getAttribute("data-ref") || "";
  const sInView = Number(ref.split(":")[0] || 0);
  if (sInView) setSurahContext(sInView);

  const s = sInView || currentSurahInView || 0;
  if (!s) return { idx: 0, pct: 0, bucket: 0, surah: 0 };

  const inSura = Array.from(all).filter((el) => (el.getAttribute("data-ref") || "").startsWith(s + ":"));
  const n = inSura.length;
  if (n <= 1) return { idx: 0, pct: 0, bucket: 0, surah: s };

  let idx = 0;
  for (let i = 0; i < n; i++) {
    const r = inSura[i].getBoundingClientRect();
    if ((r.top - qTop) <= 12) idx = i;
    else break;
  }

  const pct = (idx / (n - 1)) * 100;
  const bucket = Math.floor(idx / FAV_PROGRESS_STEP);
  return { idx, pct, bucket, surah: s };
}

function computeMushafScrollProgress(mv) {
  const allNos = Array.from(mv.querySelectorAll('.mNo[data-ref]'));
  if (!allNos.length) return { pct: 0, bucket: 0, surah: 0 };

  const mvTop = mv.getBoundingClientRect().top;
  const TH = 12;

  let anchor = allNos[0];
  for (const el of allNos) {
    const r = el.getBoundingClientRect();
    if ((r.bottom - mvTop) > TH) { anchor = el; break; }
  }

  const ref = anchor.getAttribute("data-ref") || "";
  const sInView = Number(ref.split(":")[0] || 0);
  if (sInView) setSurahContext(sInView);

  const s = sInView || currentSurahInView || 0;

  const surahNos = s
    ? Array.from(mv.querySelectorAll(`.mNo[data-ref^="${s}:"]`))
    : allNos;

  const n = surahNos.length;
  if (n <= 1) return { pct: 0, bucket: 0, surah: s || 0 };

  let idx = 0;
  for (let i = 0; i < n; i++) {
    const r = surahNos[i].getBoundingClientRect();
    if ((r.top - mvTop) <= TH) idx = i;
    else break;
  }

  const pct = (idx / (n - 1)) * 100;
  const bucket = Math.floor(idx / FAV_PROGRESS_STEP);
  return { pct, bucket, surah: s || 0 };
}

function updateFavProgress() {
  _favRaf = 0;
  if (!favBtnBtn) return;

  if (viewMode === "ayah") {
    const qv = document.querySelector(".qView");
    if (!qv || qv.style.display === "none") return;

    const { pct, bucket, surah } = computeAyahScrollProgress(qv);

    // marks: immer wenn Sura wechselt oder Favoriten geändert wurden (Key-Cache)
    if (surah && surah !== _favLastMarksSurah) updateFavMarksForSurah(surah);
    else updateFavMarksForSurah(surah);

    if (bucket !== _favLastBucket) {
      _favLastBucket = bucket;
      setFavProgressPct(pct);
    }
    return;
  }

  const mv = document.querySelector(".mView");
  if (!mv || mv.style.display === "none") return;

  const { pct, surah } = computeMushafScrollProgress(mv);

  if (surah && surah !== _favLastMarksSurah) updateFavMarksForSurah(surah);
  else updateFavMarksForSurah(surah);

  if (Math.abs(pct - _favLastPct) >= 0.2) {
    _favLastPct = pct;
    setFavProgressPct(pct);
  }
}

function scheduleFavProgressUpdate() {
  if (_favRaf) return;
  _favRaf = requestAnimationFrame(updateFavProgress);
}

// Scroll Listener (einmal binden, ohne Event-Stacking)
function bindFavProgressListeners() {
  const qv = document.querySelector(".qView");
  const mv = document.querySelector(".mView");

  if (qv && !qv._favProgBound) {
    qv._favProgBound = true;
    qv.addEventListener("scroll", scheduleFavProgressUpdate, { passive: true });
  }
  if (mv && !mv._favProgBound) {
    mv._favProgBound = true;
    mv.addEventListener("scroll", scheduleFavProgressUpdate, { passive: true });
  }
}

// ✅ Expose für Updates (nach Bookmark toggle, nach render, etc.)
window.__refreshFavButtonDecor = function(){
  try { scheduleFavProgressUpdate(); } catch(e) {}
};

// ✅ Expose, damit renderCurrent nach jedem Render nachbinden kann
window.__bindFavProgressListeners = bindFavProgressListeners;
window.__scheduleFavProgressUpdate = scheduleFavProgressUpdate;

// ✅ Favorites Button: öffnet Favoriten-Seite (Ayah-only), und wird dort zum Back-Button
if (favBtnBtn) {
  favBtnBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Wenn wir schon in der Favoriten-Seite sind: zurück
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      closeFavoritesPage();
      return;
    }

    // ✅ Direkt öffnen (openFavoritesPage kümmert sich selbst um Mushaf -> Favorites korrekt anzeigen)
    openFavoritesPage();
  });
}


// init
refreshFavCount();
bindFavProgressListeners();
scheduleFavProgressUpdate();



function setJumpBusy(on) {
  jumpBusy = !!on;

  // Statusbar + Surah Dropdown (wie vorher)
  if (statusbar) statusbar.classList.toggle("is-jumping", jumpBusy);
  if (suraDrop)  suraDrop.classList.toggle("is-jumping", jumpBusy);

  // ✅ Jumper auch als "loading" markieren (Spinner + Glow)
  const jumpBoxEl = document.getElementById("jumpBox");
  const jumpGoEl  = document.getElementById("jumpGo");
  if (jumpBoxEl) jumpBoxEl.classList.toggle("is-jumping", jumpBusy);
  if (jumpGoEl)  jumpGoEl.classList.toggle("is-jumping", jumpBusy);
}



  // global, damit Scroll-Helpers es wieder ausschalten können
  window.__setJumpBusy = setJumpBusy;

  function fmtSurahLine(s) {
    const sm = getSuraMeta(s);
    if (!sm) return `${s}`;
    // ✅ Zahl – Arabisch – Englisch (für Tooltips / Debug)
    return `${s} - ${sm.nameAr} • ${sm.nameTranslit}`;
  }

  function setSurahDropdownLabel(s) {
    if (!suraDropText) return;

    const n = Number(s) || 1;
    const sm = getSuraMeta(n);

    if (!sm) {
      suraDropText.textContent = `${n}`;
      return;
    }

    // ✅ Button: Zahl – Arabisch – Englisch
    suraDropText.textContent = `${n} - ${sm.nameAr} • ${sm.nameTranslit}`;
  }

  function closeSurahMenu() {
    if (!suraDrop) return;
    suraDrop.classList.remove("is-open", "is-active");
  }

  function openSurahMenu() {
    if (!suraDrop) return;
    closeAllStatusbarDropdowns("suraDrop");
    suraDrop.classList.add("is-open", "is-active");
  }

  function toggleSurahMenu() {
    if (!suraDrop) return;
    const open = suraDrop.classList.contains("is-open");
    if (open) closeSurahMenu();
    else openSurahMenu();
  }

  // Menu befüllen (114 Suren)
  function buildSurahMenu() {
    if (!suraDropMenu) return;
    let html = "";

    for (let s = 1; s <= 114; s++) {
      const sm = getSuraMeta(s);
      const en = sm?.nameTranslit ?? "";
      const ar = sm?.nameAr ?? "";

      html += `
        <button class="suraOpt" type="button" data-surah="${s}" title="${s} — ${ar} — ${en}">
          <span class="suraLine">
            <span class="suraNo">${s}</span>
            <span class="suraAr" dir="rtl" lang="ar">${ar}</span>
            <span class="suraEn">${en}</span>
          </span>
        </button>
      `;
    }

    suraDropMenu.innerHTML = html;
  }

  // click handlers
  if (suraDropBtn) {
    suraDropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSurahMenu();
    });
  }

if (suraDropMenu) {
  suraDropMenu.addEventListener("click", (e) => {
    // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
    try { closeFavoritesPage?.({ silent: true }); } catch {}

    const opt = e.target.closest?.(".suraOpt");
    if (!opt) return;

    const s = Number(opt.dataset?.surah || 0);
    if (!s || s < 1 || s > 114) return;

    // ✅ Jump feedback AN (wir schalten es aus, sobald Ziel wirklich gerendert ist)
    setJumpBusy(true);

    // ✅ springe zu Ayah 1 der Sura
    goToRef(`${s}:1`, { updateUrl: true });

    // ✅ Label sofort updaten (kann kurz "nur Zahl" sein, aber wird gleich gefixt)
    setSurahDropdownLabel(s);

    closeSurahMenu();
  });
}
  // initial menu + label
  // (Beim ersten Aufruf können Quran-Daten noch nicht fertig sein -> Menu wird danach refresh't)
  buildSurahMenu();
  setSurahDropdownLabel(currentSurahInView || 1);

  // ✅ Expose refresh, damit wir nach dataReady die echten Namen reinladen können
  window.__refreshSurahDropdown = function __refreshSurahDropdown() {
    buildSurahMenu();
    setSurahDropdownLabel(currentSurahInView || 1);
  };

// =========================
// ✅ Font Dropdown (Statusbar) + Persist
// =========================
const LS_AR_FONT = "quranm_arfont";

const FONT_OPTIONS = [
  { key: "Uthmani", label: "Uthmani" },
  { key: "IndoPak", label: "IndoPak" },
];

function setFontDropdownLabel(name) {
  if (!fontDropText) return;
  // Button-Label soll statisch sein
  fontDropText.textContent = "Font";
}

function closeFontMenu() {
  if (!fontDrop) return;
  fontDrop.classList.remove("is-open", "is-active");
}

function openFontMenu() {
  if (!fontDrop) return;
  closeAllStatusbarDropdowns("fontDrop");
  fontDrop.classList.add("is-open", "is-active");
}

function toggleFontMenu() {
  if (!fontDrop) return;
  const open = fontDrop.classList.contains("is-open");
  if (open) closeFontMenu();
  else openFontMenu();
}

function saveArabicFont(name) {
  try { localStorage.setItem(LS_AR_FONT, name); } catch(e){}
}

function loadArabicFont() {
  try {
    const v = localStorage.getItem(LS_AR_FONT);
    return (v === "IndoPak" || v === "Uthmani") ? v : "Uthmani";
  } catch(e){
    return "Uthmani";
  }
}

function applyArabicFont(fontName, { rerender = true } = {}) {
  const safeName = (fontName === "IndoPak") ? "IndoPak" : "Uthmani";

  // ✅ CSS Variable setzen (mit Fallbacks)
  document.documentElement.style.setProperty(
    "--font-ar",
    `"${safeName}","Amiri","Noto Naskh Arabic","Scheherazade New",serif`
  );

  setFontDropdownLabel(safeName);
  saveArabicFont(safeName);

  if (rerender) {
    try {
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
      else renderCurrent(currentRef);
    } catch(e){}
  }
}


function buildFontMenu() {
  if (!fontDropMenu) return;
  fontDropMenu.innerHTML = FONT_OPTIONS.map(opt => `
    <button class="fontOpt" type="button" data-font="${opt.key}">
      <span>${opt.label}</span>
    </button>
  `).join("");
}

if (fontDropBtn) {
  fontDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFontMenu();
  });
}

if (fontDropMenu) {
  fontDropMenu.addEventListener("click", (e) => {
    const opt = e.target.closest?.(".fontOpt");
    if (!opt) return;
    const name = opt.dataset?.font || "Uthmani";
    applyArabicFont(name);
    closeFontMenu();
  });
}

// ✅ init
buildFontMenu();

// ✅ Default beim Laden: gespeicherte Wahl (sonst Uthmani)
applyArabicFont(loadArabicFont(), { rerender: false });
const LS_RECITER = "quranm_reciter";

// ✅ Word-Highlighting Delay pro Reciter (persistiert)
// Positiv = Highlight kommt SPÄTER (z.B. try { window.__suraProgFreezeUntil = performance.now() + 200; } catch(e) {} => 200ms später)
const LS_RECITER_TIMING_DELAYS = "quranm_reciter_timing_delays_v1";

// ✅ GLOBAL DEFAULT: 0ms (ohne Reciter-Delay wird NICHT vorgezogen)
const DEFAULT_TIMING_LEAD_MS = 0;

// ✅ Optional: Default-Delays pro Reciter-Key (wenn du willst)
// Keys = RECITER_OPTIONS[].key (z.B. "alafasy")
const DEFAULT_RECITER_TIMING_DELAYS_MS = {
  // Beispiel:
  // alafasy: 200,
};

function _loadReciterTimingDelays() {
  try {
    const raw = localStorage.getItem(LS_RECITER_TIMING_DELAYS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

function _saveReciterTimingDelays(obj) {
  try {
    localStorage.setItem(LS_RECITER_TIMING_DELAYS, JSON.stringify(obj || {}));
  } catch {}
}

// Gibt Delay (ms) für einen Reciter-Key zurück: localStorage override -> Default Map -> 0
function getReciterTimingDelayMs(reciterKey) {
  const key = String(reciterKey || "").trim();
  if (!key) return 0;

  const overrides = _loadReciterTimingDelays();
  const o = Number(overrides?.[key]);
  if (Number.isFinite(o)) return o;

  const d = Number(DEFAULT_RECITER_TIMING_DELAYS_MS?.[key]);
  if (Number.isFinite(d)) return d;

  return 0;
}

// Lead fürs Highlighting = globalLead - reciterDelay
// Default: 0 - 0 = 0
// Beispiel: Delay 200 => leadMs = -200 => Highlight kommt später
function getActiveTimingLeadMs() {
  try {
    const rk = (typeof RECITER !== "undefined") ? RECITER : "";
    return DEFAULT_TIMING_LEAD_MS - getReciterTimingDelayMs(rk);
  } catch {
    return DEFAULT_TIMING_LEAD_MS;
  }
}

// ✅ Console-Helper (damit du live testen kannst)
window.__setReciterTimingDelay = function (reciterKey, ms) {
  const key = String(reciterKey || "").trim();
  const n = Number(ms);
  if (!key || !Number.isFinite(n)) return false;

  const obj = _loadReciterTimingDelays();
  obj[key] = Math.round(n);
  _saveReciterTimingDelays(obj);
  return true;
};

window.__getReciterTimingDelay = function (reciterKey) {
  return getReciterTimingDelayMs(reciterKey);
};

// ✅ 9 Reciter (Dropdown) — key = UI/Storage, audioFolder/timingsFolder = echte Ordnernamen
// Hinweis: Ordnernamen müssen GENAU so heißen wie in /reciter und /timings_out.
const RECITER_OPTIONS = [
  {
    key: "alafasy",
    label: "Mishari Rashid al Afasy",
    audioFolder: "Mishari Rashid al Afasy",
    timingsFolder: "Mishari Rashid al Afasy",
  },
  {
    key: "abdulbaset_abdulsamad_murattal",
    label: "Abdulbaset Abdulsamad (Murattal)",
    audioFolder: "Abdulbaset Abdulsamad Murattal",
    timingsFolder: "Abdulbaset Abdulsamad Murattal",
  },
  {
    key: "abdulbaset_abdulsamad_mujawwad",
    label: "Abdulbaset Abdulsamad (Mujawwad)",
    audioFolder: "Abdulbaset Abdulsamad Mujawwad",
    timingsFolder: "Abdulbaset Abdulsamad Mujawwad",
  },
  {
    key: "abdur_rahman_as_sudais",
    label: "Abdur Rahman as Sudais",
    audioFolder: "Abdur Rahman as Sudais",
    timingsFolder: "Abdur Rahman as Sudais",
  },
  {
    key: "abu_bakr_al_shatri",
    label: "Abu Bakr al Shatri",
    audioFolder: "Abu Bakr al Shatri",
    timingsFolder: "Abu Bakr al Shatri",
  },
  {
    key: "hani_ar_rifai",
    label: "Hani ar Rifai",
    audioFolder: "Hani ar Rifai",
    timingsFolder: "Hani ar Rifai",
  },
  {
    key: "mohamed_siddiq_al_minshawi_mujawwad",
    label: "Mohamed Siddiq al Minshawi (Mujawwad)",
    audioFolder: "Mohamed Siddiq al Minshawi Mujawwad",
    timingsFolder: "Mohamed Siddiq al Minshawi Mujawwad",
  },
  {
    key: "mohamed_siddiq_al_minshawi_murattal",
    label: "Mohamed Siddiq al Minshawi (Murattal)",
    audioFolder: "Mohamed Siddiq al Minshawi Murattal",
    timingsFolder: "Mohamed Siddiq al Minshawi Murattal",
  },
  {
    key: "saud_ash_shuraym",
    label: "Saud ash Shuraym",
    audioFolder: "Saud ash Shuraym",
    timingsFolder: "Saud ash Shuraym",
  },
];

function setReciterDropdownLabel(label) {
  if (!recDropText) return;
  // Button-Label soll statisch sein
  recDropText.textContent = "Reciter";
}

function closeAllStatusbarDropdowns(exceptId = "") {
  if (exceptId !== "suraDrop") suraDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "recDrop")  recDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "fontDrop") fontDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "trDrop")   trDrop?.classList.remove("is-open", "is-active");
}


function closeReciterMenu() {
  if (!recDrop) return;
  recDrop.classList.remove("is-open", "is-active");
}

function openReciterMenu() {
  if (!recDrop) return;
  closeAllStatusbarDropdowns("recDrop");
  recDrop.classList.add("is-open", "is-active");
}

function toggleReciterMenu() {
  if (!recDrop) return;
  const open = recDrop.classList.contains("is-open");
  if (open) closeReciterMenu();
  else openReciterMenu();
}

function saveReciter(key) {
  try { localStorage.setItem(LS_RECITER, key); } catch(e){}
}

function loadReciter() {
  try {
let v = String(localStorage.getItem(LS_RECITER) || "");

// Backward-compat: alter Key -> neuer Key
if (v === "abdulbaset_abdulsamad") v = "abdulbaset_abdulsamad_murattal";

return RECITER_OPTIONS.some(o => o.key === v) ? v : "alafasy";
  } catch(e){
    return "alafasy";
  }
}

function applyReciter(key, { rerender = true } = {}) {
  const opt = RECITER_OPTIONS.find(o => o.key === key) || RECITER_OPTIONS[0];

  // ✅ stoppe laufendes Audio beim Wechsel (sonst mischt es)
  try { stopWordAudio(); } catch(e){}
  try { stopVerseAudio(); } catch(e){}
  try { stopSurahQueue(); } catch(e){}

  RECITER = opt.key; // ✅ UI/Storage key
  RECITER_AUDIO_FOLDER = opt.audioFolder || opt.key; // ✅ echter MP3-Ordnername

  // ✅ Timing-Folder pro Reciter
  TIMINGS_ROOT = `${TIMINGS_BASE}/${opt.timingsFolder || opt.audioFolder || opt.key}`;

  // ✅ Timings sind reciter-spezifisch -> Cache leeren
  try { timingCache?.clear?.(); } catch {}

  setReciterDropdownLabel(opt.label);
  saveReciter(opt.key);

  // Menü-Active markieren
  if (recDropMenu) {
    recDropMenu.querySelectorAll(".recOpt").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.reciter === opt.key);
    });
  }

if (rerender) {
  try {
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
    else renderCurrent(currentRef);
  } catch(e){}
}
}

function buildReciterMenu() {
  if (!recDropMenu) return;

  recDropMenu.innerHTML = RECITER_OPTIONS.map(opt => `
    <button class="recOpt" type="button" data-reciter="${opt.key}">
      ${opt.label}
    </button>
  `).join("");
}

if (recDropBtn) {
  recDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleReciterMenu();
  });
}

if (recDropMenu) {
  recDropMenu.addEventListener("click", (e) => {
    const optBtn = e.target.closest?.(".recOpt");
    if (!optBtn) return;
    const key = optBtn.dataset?.reciter || "alafasy";
    applyReciter(key);
    closeReciterMenu();
  });
}

// init
buildReciterMenu();
applyReciter(loadReciter(), { rerender: false });

// ✅ Expose refresh hook so initTranslations() can rebuild menu after index load
window.__initTranslationsDropdown = function __initTranslationsDropdown() {
  setTrDropdownLabel();
  buildTranslationsMenu();
};

// init (build once; may still show "No translations index" until initTranslations finishes)
window.__initTranslationsDropdown();


// =========================
// ✅ Translations Dropdown (Statusbar) + Multi-Select (max 10)
// =========================

// (MAX_ACTIVE_TRANSLATIONS ist schon global oben definiert – NICHT nochmal const hier drin)
function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  ));
}

function setTrDropdownLabel() {
  if (!trDropText) return;
  // Button-Label soll statisch sein
  trDropText.textContent = "Translation";
}

function closeTrMenu() {
  if (!trDrop) return;
  trDrop.classList.remove("is-open", "is-active");
}

function openTrMenu() {
  if (!trDrop) return;
  closeAllStatusbarDropdowns("trDrop");
  trDrop.classList.add("is-open", "is-active");
}


function toggleTrMenu() {
  if (!trDrop) return;
  const open = trDrop.classList.contains("is-open");
  if (open) closeTrMenu();
  else openTrMenu();
}

function flashTranslationsLimit() {
  if (!trDropBtn) return;
  trDropBtn.classList.add("is-bad");
  setTimeout(() => trDropBtn.classList.remove("is-bad"), 450);
}

function isFileActive(file) {
  return (activeTranslations || []).some(t => t.file === file);
}

function buildTranslationsMenu() {
  if (!trDropMenu) return;

  if (!translationsIndex || !Array.isArray(translationsIndex.languages) || translationsIndex.languages.length === 0) {
    trDropMenu.innerHTML = `<div class="trLangTitle">No translations index</div>`;
    return;
  }

  const parts = [];

  // ✅ Sortierung: English -> German -> Rest alphabetisch
  const langs = (translationsIndex.languages || []).slice();
  const norm = (s) => String(s || "").trim().toLowerCase();

  langs.sort((a, b) => {
    const A = norm(a?.language);
    const B = norm(b?.language);

    const rank = (x) => (x === "english" ? 0 : (x === "german" ? 1 : 2));
    const rA = rank(A);
    const rB = rank(B);

    if (rA !== rB) return rA - rB;

    // beide "Rest" => alphabetisch
    if (rA === 2) return A.localeCompare(B);

    // beide gleich (english/english oder german/german)
    return 0;
  });

  for (const lang of langs) {
    const langName = lang?.language || "Language";
    const items = Array.isArray(lang?.items) ? lang.items : [];
    if (!items.length) continue;

    parts.push(`<div class="trLangTitle">${escHtml(langName)}</div>`);

    for (const it of items) {
      const file = it?.file || "";
      if (!file) continue;

      const label = (it?.label || _basename(file)).replace(/\.json$/i, "");
      const checked = isFileActive(file) ? "checked" : "";

parts.push(`
  <label class="trOpt ${checked ? "is-active" : ""}">
    <span class="trOptLabel">${escHtml(label)}</span>
    <input class="trChk" type="checkbox" data-file="${escHtml(file)}" ${checked}>
  </label>
`);
    }
  }

  trDropMenu.innerHTML = parts.join("");
}

// ✅ Button click
if (trDropBtn) {
  trDropBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTrMenu();
  });
}

// ✅ Klicks im Menü sollen NICHT schließen
if (trDropMenu) {
  trDropMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  trDropMenu.addEventListener("change", async (e) => {
    const chk = e.target?.closest?.(".trChk");
    if (!chk) return;

    const file = chk.dataset?.file || "";
    if (!file) return;

    const willEnable = !!chk.checked;

    if (willEnable) {
      if (!isFileActive(file) && (activeTranslations.length >= MAX_ACTIVE_TRANSLATIONS)) {
        chk.checked = false;
        flashTranslationsLimit();
        return;
      }

      const it =
        findIndexItemByFile(file) ||
        { language: "", label: _basename(file).replace(/\.json$/i, ""), file };

      activeTranslations = [...activeTranslations, it].slice(0, MAX_ACTIVE_TRANSLATIONS);

      // warm load
      try { await loadTranslationFile(file); } catch {}

    } else {
      activeTranslations = activeTranslations.filter(t => t.file !== file);
    }

    // persist
    saveActiveTranslationFiles(activeTranslations.map(t => t.file));

    // label refresh
    setTrDropdownLabel();

    // active mark refresh (CSS)
    const optLabel = chk.closest(".trOpt");
    if (optLabel) optLabel.classList.toggle("is-active", chk.checked);

    // rerender only in ayah mode
    try {
  if (viewMode === "ayah") {
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
    else renderCurrent(currentRef);
  }
} catch {}
  });
}

document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target;

    // ✅ Wenn gar kein Dropdown offen ist, sofort raus (spart viel)
    const anyOpen =
      suraDrop?.classList.contains("is-open") ||
      recDrop?.classList.contains("is-open") ||
      fontDrop?.classList.contains("is-open") ||
      trDrop?.classList.contains("is-open");

    if (!anyOpen) return;

    // ✅ Klick war IN einem Dropdown => NICHT schließen
    if (
      suraDrop?.contains(t) ||
      recDrop?.contains(t) ||
      fontDrop?.contains(t) ||
      trDrop?.contains(t)
    ) {
      return;
    }

    // ✅ Klick war außerhalb => alles zu
    closeAllStatusbarDropdowns("");
  },
  { capture: true, passive: true }
);


    // =========================
  // ✅ Font Size (Statusbar)
  // =========================

  const LS_AR_SCALE = "quranm_arFontScale";

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function getBaseAyahPx(){
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue("--ayah-font-ar-base").trim(); // e.g. "38px"
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 38;
  }

function setArabicScale(scale, { strong = false } = {}) {
  const s = clamp(Number(scale) || 1, 0.60, 1.80);

  // ✅ Arabic + Translations Scale setzen (kein rerender!)
  document.documentElement.style.setProperty("--ar-font-scale", String(s));
  document.documentElement.style.setProperty("--tr-font-scale", String(s));

  // UI label: px = base * scale (nur Anzeige)
  const px = Math.round(getBaseAyahPx() * s);
  if (fsVal) fsVal.textContent = `${px}px`;

  // Glow state: nur kurz beim Klick
  if (fsCtl) {
    fsCtl.classList.toggle("is-strong", !!strong);
    if (strong) setTimeout(() => fsCtl.classList.remove("is-strong"), 180);
  }

  // speichern
  try { localStorage.setItem(LS_AR_SCALE, String(s)); } catch(e){}

  // ✅ Wichtig: KEIN renderCurrent() / KEIN renderFavoritesPage()
  // Nur Fokus-Highlight “halten”, ohne Scroll (damit nix springt)
  requestAnimationFrame(() => {
    try {
      // Favorites Page: nichts machen (soll ruhig “normal” bleiben)
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv) focusAyahCard(qv, currentRef, { scroll: false });
      } else if (viewMode === "mushaf") {
        const mv = document.querySelector(".mView");
        if (!mv) return;
        mv.querySelectorAll(".mNo.is-focus").forEach(el => el.classList.remove("is-focus"));
        const btn = mv.querySelector(`.mNo[data-ref="${CSS.escape(String(currentRef))}"]`);
        if (btn) btn.classList.add("is-focus"); // kein scrollIntoView
      }
    } catch(e){}
  });
}

  // init: gespeicherte Scale laden
  let startScale = 1;
  try {
    const saved = parseFloat(localStorage.getItem(LS_AR_SCALE) || "");
    if (Number.isFinite(saved)) startScale = saved;
  } catch(e){}
  setArabicScale(startScale, { strong: false });

const STEP = 0.05; // fein genug

if (fsBtn) {
  fsBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    const rect = fsBtn.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const topHalf = y < rect.height / 2;

    const cs = getComputedStyle(document.documentElement);
    const cur = parseFloat(cs.getPropertyValue("--ar-font-scale")) || 1;

    // oben = PLUS, unten = MINUS
    setArabicScale(cur + (topHalf ? STEP : -STEP), { strong: true });
  });
}

  const jumpInput = document.getElementById("jumpInput");
  const jumpGo = document.getElementById("jumpGo");
  const jumpBox = document.getElementById("jumpBox");

  let jumpBadTimer = null;
  function flashJumpBad() {
    if (!jumpBox) return;
    jumpBox.classList.add("is-bad");
    if (jumpBadTimer) clearTimeout(jumpBadTimer);
    jumpBadTimer = setTimeout(() => jumpBox.classList.remove("is-bad"), 700);
  }
  // ===== Live Play Progress (smooth, performance-arm) =====
  let __playProgRaf = 0;

  function __computePlayProgress01() {
    // 0..1
    if (!verseAudio) return 0;

    // Wenn Surah-Queue aktiv: Fortschritt über Ayah-Index + Anteil innerhalb der aktuellen Ayah
    if (surahPlaying) {
      const meta = getSuraMeta(surahPlaying);
      const total = Number(meta?.ayahCount || 0) || 0;
      if (!total) return 0;

      const base = Math.max(0, (Number(surahAyahIdx || 1) - 1)) / total;

      let within = 0;
      const d = Number(verseAudio.duration || 0);
      const t = Number(verseAudio.currentTime || 0);
      if (d > 0 && Number.isFinite(d) && Number.isFinite(t)) {
        within = Math.max(0, Math.min(1, t / d)) / total;
      }

      return Math.max(0, Math.min(1, base + within));
    }

    // Sonst: nur innerhalb der aktuellen Ayah
    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    if (d > 0 && Number.isFinite(d) && Number.isFinite(t)) {
      return Math.max(0, Math.min(1, t / d));
    }
    return 0;
  }

  function __renderPlayProgress() {
    if (!progress) return;
    const p = __computePlayProgress01();
    progress.style.width = (p * 100).toFixed(3) + "%";
  }

  function __startPlayProgressRaf() {
    cancelAnimationFrame(__playProgRaf);

    const tick = () => {
      // nur live rendern wenn wirklich am Abspielen
      if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
        __renderPlayProgress();
        __playProgRaf = requestAnimationFrame(tick);
      }
    };

    __renderPlayProgress(); // sofort ein Update
    if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
      __playProgRaf = requestAnimationFrame(tick);
    }
  }

  function __stopPlayProgressRaf() {
    cancelAnimationFrame(__playProgRaf);
    __playProgRaf = 0;
    __renderPlayProgress(); // beim Pause/Stop einmal final setzen
  }

  function syncUI(opts = {}) {
  const { syncContinue = true } = opts || {};
  // ✅ echte Wahrheit: verseAudio
  const isPlaying = !!verseAudio && !verseAudio.paused;
  const isPaused  = !!verseAudio && verseAudio.paused;

  // Statusbar PlayStop (Icon)
  if (playStop) playStop.classList.toggle("is-playing", isPlaying);

  // PlayPause-Button (optional UI): nur aktiv wenn verseAudio existiert
  if (playPause) {
    playPause.disabled = !verseAudio;
    playPause.classList.toggle("is-paused", isPaused);
  }

  // ✅ Small Surah Pause Button (nur wenn surah queue läuft UND nicht favorites)
  try{
    const showSuraPause =
      (typeof surahPlaying !== "undefined") &&
      !!surahPlaying &&
      !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);

    const suraPaused = !!showSuraPause ? !!surahStoppedByUser : !!isPaused;
setSuraPauseUI(!!showSuraPause, suraPaused, { syncContinue });
  }catch(e){}

  // ✅ SuraPlay Progress (innerhalb aktueller Sura)
  // ✅ Live Progress (Surah-Queue: innerhalb der Sura / sonst: innerhalb der Ayah)
  if (progress) {
    // ✅ Fix: nach Tick/Bar-Klick kurz “chillen” (kein Hin-und-Her)
    try{
      const fu = Number(window.__suraProgFreezeUntil || 0);
      if (fu && performance.now() < fu) return;
    }catch(e){}

    let pct = 0;

    // falls kein Audio: 0%
    if (!verseAudio) {
      pct = 0;
    } else {
      const dur = Number(verseAudio.duration || 0);
      const cur = Number(verseAudio.currentTime || 0);

      // ✅ Auto-scroll decision: NUR kurz vor Ende der aktuellen Ayah festlegen
      // Wenn User wegscrollt, wird Gate false -> nächste Ayah scrollt nicht mehr automatisch.
      if (surahPlaying && !isPaused && dur > 0) {
        const remaining = dur - cur;
        if (remaining <= 0.35) { // ~350ms vor Ende
          __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
        }
      }

      const frac = (dur > 0) ? Math.max(0, Math.min(1, cur / dur)) : 0;

      // ✅ WICHTIG: Während "basm:*" läuft, soll KEIN Surah-Fortschritt angezeigt werden.
      // Sonst sieht man kurz vor Ende der Basmallah diesen komischen Mini-Blau-Balken.
      const isBasmNow = /^basm:/.test(String(verseRefPlaying || ""));

      if (isBasmNow) {
        pct = 0;
      } else if (surahPlaying) {
        const meta = getSuraMeta(surahPlaying);
        const n = Number(meta?.ayahCount || 0);

        if (n > 1) {
          // ✅ Bei Surah-Queue: Index lieber aus verseRefPlaying nehmen (stabil bei Ayah-Wechsel),
          // sonst fallback auf surahAyahIdx.
          let idx0 = Math.max(0, (Number(surahAyahIdx || 1) - 1)); // 0-based fallback

          try{
            const rNow = (verseRefPlaying && /^\d+:\d+$/.test(String(verseRefPlaying)))
              ? String(verseRefPlaying)
              : "";
            if (rNow) {
              const [rs, ra] = rNow.split(":").map(Number);
              if (Number.isFinite(rs) && Number.isFinite(ra) && rs === Number(surahPlaying)) {
                idx0 = Math.max(0, ra - 1);
              }
            }
          }catch{}

          pct = ((idx0 + frac) / n) * 100;
        } else {
          pct = frac * 100;
        }
      } else {
        // sonst: nur aktuelle Ayah
        pct = frac * 100;
      }
    }

    // ✅ WICHTIG: Wenn surahPlaying läuft und verseAudio gerade "kurz weg" ist (Ayah-Wechsel),
    // NICHT auf 0 springen -> letzten Wert halten.
    if (!verseAudio && surahPlaying && __progHoldSurah === surahPlaying) {
      pct = __progHoldPct;
    }

    // clamp
    pct = Math.max(0, Math.min(100, pct));

    // ✅ Wenn Surah-Queue spielt: niemals rückwärts laufen (verhindert mini “zurückspringen”)
    if (surahPlaying && __progHoldSurah === surahPlaying) {
      pct = Math.max(pct, __progHoldPct);
    }

    __progTarget = pct;

    // ✅ Hold-State updaten (nur im Surah-Queue)
    if (surahPlaying) {
      __progHoldSurah = surahPlaying;
      __progHoldPct = __progTarget;
    } else {
      __progHoldSurah = null;
      __progHoldPct = 0;
    }

    // ✅ Glättung: target -> vis (macht es “normal” smooth)
    const now = performance.now();
    const dt = __progLastT ? Math.min(80, now - __progLastT) : 16;
    __progLastT = now;

    // Zeitkonstante ~120ms: schnell genug, aber nicht “zappelig”
    const k = 1 - Math.pow(0.001, dt / 120);
    __progVis = __progVis + (__progTarget - __progVis) * k;

    // ✅ GPU-smooth statt width-layout
    progress.style.transform = `scaleX(${(__progVis / 100).toFixed(5)})`;
  }
}

  // ✅ Live Progress Loop (smooth, ohne Interval-Spam)
  let __progRaf = 0;
  let __progVis = 0;       // sichtbarer Wert (0..100)
  let __progTarget = 0;    // Zielwert (0..100)
  let __progLastT = 0;     // für dt
  let __progHoldPct = 0;   // letzter stabiler Prozentwert (für Ayah-Wechsel)
  let __progHoldSurah = null; // welche Sura zu __progHoldPct gehört

function __startProgRaf(){
  cancelAnimationFrame(__progRaf);

  // cheap: ~11 FPS UI (Buttons + Progress-State)
  let __lastCheap = 0;
  // expensive: 1 FPS (Continue-Buttons etc.)
  let __lastExp = 0;

  // Edge-Detection: wenn sich SurahPlay/Pause ändert, sofort Continue-Buttons syncen
  let __lastSuraActive = null;
  let __lastPaused = null;

  const tick = (now) => {
    try {
      // --- CHEAP TICK (≈ 8–12×/s) ---
      if (!__lastCheap || (now - __lastCheap) >= 90) {
        __lastCheap = now;

        // ✅ syncUI, aber OHNE teure Continue-Buttons (die kommen unten)
        syncUI({ syncContinue: false });

        // State lesen (nur simple booleans)
        const suraActive =
          (typeof surahPlaying !== "undefined") &&
          !!surahPlaying &&
          !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);

        const pausedNow = !!verseAudio && !!verseAudio.paused;

        // wenn sich State geändert hat: Continue sofort richtig setzen
        if (__lastSuraActive === null || __lastPaused === null ||
            suraActive !== __lastSuraActive || pausedNow !== __lastPaused) {
          __lastSuraActive = suraActive;
          __lastPaused = pausedNow;
          try { __syncContinueButtons(); } catch(e){}
        }
      }

      // --- EXPENSIVE TICK (≈ 1×/s) ---
      if (!__lastExp || (now - __lastExp) >= 1000) {
        __lastExp = now;
        try { __syncContinueButtons(); } catch(e){}
      }
    } catch {}

    if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
      __progRaf = requestAnimationFrame(tick);
    }
  };

  __progRaf = requestAnimationFrame(tick);
}

function __stopProgRaf(){
  cancelAnimationFrame(__progRaf);
  __progRaf = 0;
  try { syncUI({ syncContinue: true }); } catch {}
  try { __syncContinueButtons(); } catch(e){}
}

  // für playFromButton erreichbar machen
  window.__startStatusbarProg = __startProgRaf;
  window.__stopStatusbarProg  = __stopProgRaf;
  window.__syncUI = syncUI;

function flashStoppedGlow(){
  try{
    if (!playStop) return;
    playStop.classList.add("is-stopped");
    setTimeout(() => playStop.classList.remove("is-stopped"), 220);
  }catch(e){}
}

if (playStop) {
  playStop.addEventListener("click", () => {
    // Wort-Audio hat eigene Logik -> stoppen
    if (wordAudio) stopWordAudio();

    // ✅ FAVORITES MODE: Statusbar PlayStop steuert Favorites Queue
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      const qv = document.querySelector(".qView"); // Favorites rendert in qView
      if (!qv) return;

      // Play/Stop (kein Pause) – nutzt deine bestehende Favorites-Queue-Funktionen
      if (!favQueueRefs || favQueueRefs.length === 0) {
        startFavoritesQueue(qv);
      } else {
        stopFavoritesQueue();
        try { stopVerseAudio({ stopQueue: true }); } catch {}
      }

      // UI sync (playStop Icon)
      try { syncUI?.(); } catch {}
      return;
    }

    // ✅ NORMAL MODE (Ayah/Mushaf): dein bisheriges Verhalten
    if (verseAudio && !verseAudio.paused) {
      stopVerseAudio();
      stopSurahQueue();
      return;
    }

    startSurahPlayback(currentSurahInView, { fromAyah: 1, btn: playStop });
  });
}

const suraPauseBtn = document.getElementById("suraPause");
if (suraPauseBtn && !suraPauseBtn.__bound) {
  suraPauseBtn.__bound = true;

  suraPauseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Nur relevant wenn Surah Queue läuft
    if (typeof surahPlaying === "undefined" || !surahPlaying) return;
    if (!verseAudio) return;

    // Toggle pause/resume
    try{
      if (verseAudio.paused) {
        verseAudio.play();

        // ✅ wichtig: Surah-Queue ist wieder aktiv (für UI + playNext/onEnded)
        surahStoppedByUser = false;
      } else {
        verseAudio.pause();

        // ✅ wichtig: UI liest bei SurahPlay "surahStoppedByUser" als Pause-State
        surahStoppedByUser = true;
      }
    }catch(err){}

    // 1s Flash Glow
    try{
      suraPauseBtn.classList.add("is-flash");
      setTimeout(() => suraPauseBtn.classList.remove("is-flash"), 1000);
    }catch(err){}

    // UI sync
    try { syncUI?.(); } catch {}
  });
}

   if (playPause) {
    playPause.addEventListener("click", () => {
      // ✅ echte Pause/Resume für Ayah/Basm
      const did = toggleVersePause();
      if (did) syncUI();
    });
    // ✅ Favorites Pause Button (separat von playPause!)
const favPauseBtn = document.getElementById("favPause");
if (favPauseBtn) {
  favPauseBtn.addEventListener("click", () => {
    // nur während Favorites Page + Queue aktiv
    if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;
    if (!favQueueRefs || favQueueRefs.length === 0) return;

    // 1) Wenn gerade Ayah Audio läuft -> echte Pause/Resume
    if (verseAudio) {
      const did = (typeof toggleVersePause === "function") ? toggleVersePause() : false;
      if (!did) return;

      favQueuePaused = !!verseAudio.paused;
      setFavPauseUI(true, favQueuePaused);

      // optional: auch topbar button state mitziehen
      try{
        const qv = document.querySelector(".qView");
        const topPlay = qv?.querySelector("button.favTopPlay");
        if (topPlay){
          topPlay.classList.toggle("is-paused", favQueuePaused);
          topPlay.classList.toggle("is-playing", !favQueuePaused);
        }
      }catch(e){}
      return;
    }

    // 2) Wenn gerade kein verseAudio existiert (z.B. wir stehen in der Gap-Pause)
    favQueuePaused = !favQueuePaused;
    setFavPauseUI(true, favQueuePaused);

    // Resume: weiterlaufen lassen
    if (!favQueuePaused) {
      try { favQueueContinueFn?.(); } catch(e) {}
    }
  });
}
  }

function doJump() {
  // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
  try { closeFavoritesPage?.({ silent: true }); } catch {}

  const raw = (jumpInput?.value || "").trim();
  if (!raw) return;

  const ok = goToRef(raw, { updateUrl: true });
  if (!ok) {
    console.warn("[jump] invalid ref:", raw);

    // ❌ nur bei wirklich ungültig rot
    jumpInput?.classList.add("is-bad");
    if (jumpBox) jumpBox.classList.add("is-bad");

    setTimeout(() => {
      jumpInput?.classList.remove("is-bad");
      jumpBox?.classList.remove("is-bad");
    }, 600);

    // sicherheitshalber busy aus
    try { window.__setJumpBusy?.(false); } catch(e) {}
    return;
  }

  // ✅ gültig -> rot sofort weg + busy an
  jumpInput?.classList.remove("is-bad");
  jumpBox?.classList.remove("is-bad");

  // zeigt den Kreis/Spinner bis Scroll-Helper wieder ausschaltet
  try { window.__setJumpBusy?.(true); } catch(e) {}

  if (jumpInput) jumpInput.value = "";
  syncJumpActive();
}


  if (jumpGo) jumpGo.addEventListener("click", doJump);

  // ✅ Glow wenn Inhalt vorhanden (und beim Tippen live)
  const syncJumpActive = () => {
    if (!jumpBox || !jumpInput) return;
    const hasValue = (jumpInput.value || "").trim().length > 0;
    jumpBox.classList.toggle("is-active", hasValue);
  };

  if (jumpInput) {
    // initial
    syncJumpActive();

    // live beim Tippen / Paste / Delete
    jumpInput.addEventListener("input", syncJumpActive);

    // enter = jump
    jumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJump();
    });

    // optional: beim blur active-state nochmal syncen
    jumpInput.addEventListener("blur", syncJumpActive);
    jumpInput.addEventListener("focus", syncJumpActive);
  }

  syncUI();
  syncViewToggleBtn();
}

let verseAudio = null;
let verseBtnPlaying = null;
let verseRefPlaying = null; // ✅ welche Ayah-Ref spielt gerade (z.B. "2:255")

// ===== Sura Playback (Queue) =====
let surahPlaying = null;        // number | null
let surahAyahIdx = 1;           // aktuelle Ayah innerhalb der Sura
let surahStoppedByUser = false; // stop/pause durch User

function stopSurahQueue() {
  surahPlaying = null;
  surahAyahIdx = 1;
  surahStoppedByUser = false;

  // ✅ HARD: Statusbar Klassen sofort entfernen (damit nix “random” sichtbar bleibt)
  try{
    const sb = document.querySelector(".statusbar");
    sb?.classList.remove("is-surah-playing");
  }catch(e){}

  // ✅ Small Surah Pause Button aus
  try { setSuraPauseUI(false, false); } catch(e){}
  try { __resetSuraPlayProgressState(); } catch(e){}

  // ✅ iOS FIX: manchmal “repaintet” Safari nach STOP nicht -> alles wirkt weg bis scroll
  // Wir triggern einen harmlosen Reflow + mini scrollTop nudge im Scroll-Container.
  try{
    const v =
      document.querySelector(".qView") ||
      document.querySelector(".mView") ||
      null;

    if (v) {
      const st = v.scrollTop;

      // layer/reflow
      v.style.transform = "translateZ(0)";
      void v.offsetHeight;

      // mini nudge (unsichtbar)
      v.scrollTop = st + 1;
      v.scrollTop = st;

      requestAnimationFrame(() => {
        v.style.transform = "";
      });
    }

    // zusätzlich: manche iPhones brauchen ein “resize” ping
    window.dispatchEvent(new Event("resize"));
  }catch(e){}
}

function startSurahPlayback(surahNo, { fromAyah = 1, btn = null } = {}) {
  const meta = getSuraMeta(surahNo);
  if (!meta) return;

  // Es darf immer nur EIN Audio laufen
  stopWordAudio();
  stopVerseAudio();

  surahPlaying = surahNo;
  surahAyahIdx = Math.max(1, Number(fromAyah) || 1);
  surahStoppedByUser = false;

  // ✅ beim manuellen Start immer erlauben, zum Start zu springen
  try { __autoScrollGate = true; } catch(e){}

  // ✅ Small Surah Pause Button an (paused=false)
  try { setSuraPauseUI(true, false); } catch(e){}
  try { __resetSuraPlayProgressState(); } catch(e){}

  // ✅ Wenn Sura eine Standalone-Basmallah hat (alle außer 1 und 9),
  // und wir ab Ayah 1 starten: erst Basm spielen, dann Ayah 1.
  let basmPlayed = false;
  const shouldPlayBasmFirst = () => (!!meta?.hasStandaloneBasmallah && surahAyahIdx === 1);

  // ✅ Beim Start einmal zum passenden Start-Element scrollen (Basm oder Ayah)
  const scrollToStartOnce = () => {
    try{
      const targetRef = (shouldPlayBasmFirst() && !basmPlayed)
        ? `basm:${surahNo}`
        : `${surahNo}:${surahAyahIdx}`;

      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv && qv.style.display !== "none") {
          // focus (ohne sofortiges scroll), dann “when ready” scroll
          try { focusAyahCard(qv, targetRef, { scroll: false }); } catch(e){}
          try { scrollToAyahWhenReady(qv, targetRef, { scroll: true }); } catch(e){}
        }
      } else {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          // Mushaf: scroll zum Nummernblock
          try { scrollToMushafNoWhenReady(mv, targetRef, { updateUrl: false, scroll: true }); } catch(e){}
        }
      }
    }catch(e){}
  };

  const playNext = () => {
    if (!surahPlaying || surahStoppedByUser) return;

    // ✅ beim Start (und nach Resume) sicherstellen, dass wir einmal am Start sind
    if (!basmPlayed && surahAyahIdx === Math.max(1, Number(fromAyah) || 1)) {
      scrollToStartOnce();
    }

    // ✅ 1) optional: Basmallah vor Ayah 1
      if (shouldPlayBasmFirst() && !basmPlayed) {
      basmPlayed = true;

      const useBtn = btn || document.querySelector("#playStop") || document.body;
      if (useBtn && useBtn.dataset) useBtn.dataset.ref = `basm:${surahNo}`;

      const url = basmMp3Url(surahNo);
      playFromButton(useBtn, url, {
        queueMode: true,
        onEnded: () => {
          if (!surahPlaying || surahStoppedByUser) return;
          playNext();
        },
      });
      return;
    }

    // ✅ 2) normale Ayah-Queue
    if (surahAyahIdx > meta.ayahCount) {
      // ✅ Repeat: Surah wieder von vorn (inkl. Basmallah-Logik)
      if (surahRepeatOn) {
        surahAyahIdx = 1;
        basmPlayed = false;
        try { __autoScrollGate = true; } catch(e){}
        playNext();
        return;
      }

      stopSurahQueue();
      return;
    }

    const ref = `${surahNo}:${surahAyahIdx}`;
    const a = getAyah(ref);
    if (!a) {
      stopSurahQueue();
      return;
    }

    const useBtn = btn || document.querySelector("#playStop") || document.body;
    if (useBtn && useBtn.dataset) useBtn.dataset.ref = ref;

    const url = ayahMp3Url(a.surah, a.ayah);
    playFromButton(useBtn, url, {
      queueMode: true,
      onEnded: () => {
        if (!surahPlaying || surahStoppedByUser) return;
        surahAyahIdx += 1;
        playNext();
      },
    });
  };

  playNext();
}

// ✅ Surah-Play Button Toggle:
// - wenn gleiche Sura gerade spielt -> STOP (und NICHT neu starten)
// - wenn gleiche Sura pausiert -> Resume
// - sonst -> starte Sura ab Anfang
function toggleSurahPlaybackFromBtn(surahNo, btn) {
  const sameSurah = (surahPlaying === surahNo);

  // ✅ Wenn gerade irgendwas spielt (auch Ayah/Basm) und der User sieht Stop:
  // erster Klick = STOPPEN, nicht neu starten.
  if (verseAudio && !verseAudio.paused) {
    // Wenn es die gleiche SurahQueue ist -> stoppt sie sauber
    if (sameSurah) {
      stopVerseAudio();
      stopSurahQueue();
      return;
    }
    // Wenn es eine andere Wiedergabe ist (z.B. AyahPlay),
    // dann erst stoppen und NICHT sofort die Sura starten.
    stopVerseAudio();
    stopSurahQueue();
    return;
  }

  // Wenn gleiche Sura pausiert ist: Resume (optional)
  if (sameSurah && verseAudio && verseAudio.paused) {
    toggleVersePause();
    return;
  }

  let fromAyah = 1;
  let toAyah = null;

  try{
    const isHifzTopBtn = !!btn?.closest?.(".hifzTrainTopBar, .hifzTestTopBar");
    if (isHifzTopBtn) {
      const bounds = getHifzRangeBoundsForRef(`${surahNo}:1`);
      fromAyah = bounds.fromAyah;
      toAyah = bounds.toAyah;
    }
  }catch(e){}

  // Sonst: starte diese Sura ab Anfang oder im Hifz-Bereich nur im gewählten Bereich
  startSurahPlayback(surahNo, { fromAyah, toAyah, btn });
}

// ✅ welche Sura ist "im Fokus" der View (für Statusbar Play)

function syncVerseBtnState() {
  if (!verseBtnPlaying) return;

const isPaused  = !!verseAudio && (surahPlaying ? !!surahStoppedByUser : !!verseAudio.paused);
const isPlaying = !!verseAudio && !isPaused;

  verseBtnPlaying.classList.toggle("is-playing", isPlaying);
  verseBtnPlaying.classList.toggle("is-paused", isPaused);
  syncPlayingCardGlow();
  syncPlayingMushafFocus();

  syncGlobalPlayStopUI();
}

function syncGlobalPlayStopUI() {
  const anyPlaying = !!verseAudio && !verseAudio.paused;

  // ✅ “aktive” Sura bestimmen:
  // 1) wenn Queue läuft -> surahPlaying
  // 2) sonst wenn Ayah/Basm läuft -> Sura aus verseRefPlaying
  // 3) fallback -> currentSurahInView
  let activeSurah = surahPlaying;

  if (!activeSurah && verseRefPlaying) {
    const m = String(verseRefPlaying).match(/^(\d{1,3}):(\d{1,3})$/);
    if (m) activeSurah = Number(m[1]);
    else {
      const bm = String(verseRefPlaying).match(/^basm:(\d{1,3})$/);
      if (bm) activeSurah = Number(bm[1]);
    }
  }

  if (!activeSurah) activeSurah = currentSurahInView;

    // ✅ Statusbar dropdown label folgt dem "active" Surah Kontext
  const _suraDropText = document.getElementById("suraDropText");
  if (_suraDropText) {
    const sm = getSuraMeta(activeSurah);

    if (!sm) {
      _suraDropText.textContent = String(activeSurah);
    } else {
      // ✅ Zahl – Arabisch – Englisch (Bidi-sicher)
_suraDropText.innerHTML = `
  <span class="suraBtnLine" dir="ltr">
    <span class="suraBtnNo" style="font-weight:650;">${activeSurah}</span>
    <span class="suraBtnGap" aria-hidden="true">&nbsp;</span>
    <span class="suraBtnAr" dir="rtl" lang="ar">${sm.nameAr ?? ""}</span>
    <span class="suraBtnGap" aria-hidden="true">&nbsp;</span>
    <span class="suraBtnEn">${sm.nameTranslit ?? ""}</span>
  </span>
`;
    }
  }

  document.querySelectorAll(".btnCircle.playStop").forEach((btn) => {
    // 1) Statusbar Button (#playStop) = global
    if (btn.id === "playStop") {
      btn.classList.toggle("is-playing", anyPlaying);
      return;
    }

    // 2) SurahTopbar Buttons: Stop/Glow nur für die “aktive” Sura anzeigen,
    // auch wenn gerade nur eine Ayah läuft.
    if (btn.classList.contains("suraPlayBtn")) {
      const s = Number(btn.dataset?.surah || 0);
      const isActive = anyPlaying && activeSurah === s;
      btn.classList.toggle("is-playing", isActive);
      return;
    }

    // fallback
    btn.classList.toggle("is-playing", anyPlaying);
  });
}

function syncPlayingCardGlow() {
  const qv = document.querySelector(".qView");
  if (!qv) return;

  // alle Cards resetten
  qv.querySelectorAll(".ayahMainCard.is-playing").forEach((el) => el.classList.remove("is-playing"));

  // nur wenn wirklich Audio aktiv & nicht paused
  if (!verseAudio || verseAudio.paused || !verseRefPlaying) return;

  const card = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(verseRefPlaying)}"]`);
  if (card) card.classList.add("is-playing");
}

// ✅ Mushaf: Ring/Fokus auf der gerade spielenden Ayah-Nummer
function syncPlayingMushafFocus() {
  const mv = document.querySelector(".mView");
  if (!mv) return;

  // ✅ Focus weg + Ring reset (damit nach Stop/Pause nix “hängen bleibt”)
  mv.querySelectorAll(".mNo.is-focus").forEach((el) => {
    el.classList.remove("is-focus");
    try { el.style.setProperty("--ring", "0"); } catch {}
  });

  if (!verseAudio || verseAudio.paused || !verseRefPlaying) return;

  // Basmallah ist kein Mushaf-Ref
  if (/^basm:\d+$/i.test(String(verseRefPlaying))) return;

  const btn = mv.querySelector(`.mNo[data-ref="${CSS.escape(String(verseRefPlaying))}"]`);
  if (btn) {
    btn.classList.add("is-focus");
    try { btn.style.setProperty("--ring", "0"); } catch {}
  }
}

// =========================
// ✅ Mushaf Ring Progress RAF (smooth, nicht chunky)
// =========================
let __mushafRingRaf = 0;
let __mushafRingLastT = 0;

function __updateMushafRingNow() {
  try {
    const mv = document.querySelector(".mView");
    if (!mv) return;

    const btn = mv.querySelector(".mNo.is-focus");
    if (!btn) return;

    if (!verseAudio) return;

    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    if (!Number.isFinite(d) || d <= 0) {
      btn.style.setProperty("--ring", "0");
      return;
    }

    const p = Math.max(0, Math.min(1, t / d));
    btn.style.setProperty("--ring", String(p));
  } catch {}
}

function __startMushafRingRaf() {
  cancelAnimationFrame(__mushafRingRaf);
  __mushafRingRaf = 0;
  __mushafRingLastT = 0;

  const tick = (now) => {
    try {
      if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
        // ✅ throttle ~30fps (smooth, aber nicht unnötig teuer)
        const ts = (typeof now === "number") ? now : Date.now();
        if (!__mushafRingLastT || (ts - __mushafRingLastT) >= 33) {
          __mushafRingLastT = ts;
          __updateMushafRingNow();
        }
        __mushafRingRaf = requestAnimationFrame(tick);
      }
    } catch {}
  };

  // sofort setzen
  __updateMushafRingNow();
  __mushafRingRaf = requestAnimationFrame(tick);
}

function __stopMushafRingRaf({ reset = false } = {}) {
  cancelAnimationFrame(__mushafRingRaf);
  __mushafRingRaf = 0;
  __mushafRingLastT = 0;

  if (reset) {
    try {
      const mv = document.querySelector(".mView");
      mv?.querySelectorAll(".mNo").forEach((el) => el.style.setProperty("--ring", "0"));
    } catch {}
  }
}

function stopVerseAudio({ stopQueue = true } = {}) {
  // Wenn Ayah/Basm bewusst gestoppt wird, Sura-Queue auch beenden.
  // Beim Queue-Advance (ended) darf die Queue NICHT gekillt werden.
  if (stopQueue) stopSurahQueue();

  // ✅ Mushaf Ring RAF stoppen + reset (damit nichts “hängt”)
  try { __stopMushafRingRaf({ reset: true }); } catch {}

  // ✅ Ayah Edge Smooth RAF stoppen (sonst kann es “weiterlaufen” / CPU ziehen)
  try { __stopVerseEdgeSmoothRaf(); } catch {}

  // ✅ word timing highlight weg
  detachTimingRun();

  if (verseAudio) {
    // ✅ Ayah Fade RAFs stoppen (sonst kann im Hintergrund weiterlaufen)
    try { __cancelVerseFadeRafs(verseAudio); } catch {}

    try { verseAudio.pause(); } catch {}
    try { verseAudio.currentTime = 0; } catch {}
    verseRefPlaying = null;
  }
  verseAudio = null;

  if (verseBtnPlaying) {
    verseBtnPlaying.classList.remove("is-playing", "is-paused");
    verseBtnPlaying = null;
    syncPlayingCardGlow();
    syncPlayingMushafFocus();

    syncGlobalPlayStopUI();
  }
}

function toggleVersePause() {
  if (!verseAudio) return false;

// Toggle pause/resume (SurahPlay: nur USER-Pause zählt)
try{
  if (!surahStoppedByUser) {
    // user paused
    surahStoppedByUser = true;
    verseAudio.pause();
  } else {
    // user resumed
    surahStoppedByUser = false;
    verseAudio.play().catch(()=>{});
  }
}catch(err){}
  syncVerseBtnState();
  return true;
}

// =========================
// Auto-Follow while playing (nur wenn vorherige Ayah im Bild war)
// =========================
let __autoFollowNext = true;

// check: ist ein Element innerhalb des Scroll-Views sichtbar?
function __isElVisibleInScrollBox(el, boxEl, { margin = 18 } = {}) {
  try {
    if (!el || !boxEl) return false;
    const b = boxEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    // ✅ Strenger: Mittelpunkt des Elements muss im sichtbaren Bereich liegen
    const midY = (r.top + r.bottom) / 2;
    return (midY >= (b.top + margin)) && (midY <= (b.bottom - margin));
  } catch {
    return false;
  }
}

// =========================
// Auto-follow: nur scrollen, wenn vorherige Ayah im Bild war
// =========================
function __isRefVisibleNow(ref) {
  const raw = String(ref || "").trim();

  // ✅ Wenn Basmallah läuft: NICHT pauschal "true".
  // Stattdessen prüfen wir, ob Ayah 1 dieser Sura sichtbar ist.
  // (Sonst fliegst du am Ende der Basmallah immer wieder hoch.)
  const mBasm = raw.match(/^basm:(\d{1,3})$/);
  if (mBasm) {
    const s = Number(mBasm[1] || 0);
    if (!s) return false;
    const r1 = `${s}:1`; // Sichtbarkeit an Ayah 1 koppeln

    try {
      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (!qv || qv.style.display === "none") return false;

        const el = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(r1)}"]`);
        if (!el) return false;

        // ✅ strenger: Mittelpunkt muss im sichtbaren Bereich liegen
        return __isElVisibleInScrollBox(el, qv, { margin: 18 });
      } else {
        const mv = document.querySelector(".mView");
        if (!mv || mv.style.display === "none") return false;

        const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(r1)}"]`);
        if (!el) return false;

        return __isElVisibleInScrollBox(el, mv, { margin: 18 });
      }
    } catch {
      return false;
    }
  }

  // null/leer: beim initialen Start nicht blockieren
  if (!raw) return true;

  // normale Ayah
  if (!/^\d+:\d+$/.test(raw)) return false;

  try {
    if (viewMode === "ayah") {
      const qv = document.querySelector(".qView");
      if (!qv || qv.style.display === "none") return false;

      const el = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(raw)}"]`);
      if (!el) return false;

      return __isElVisibleInScrollBox(el, qv, { margin: 18 });
    } else {
      const mv = document.querySelector(".mView");
      if (!mv || mv.style.display === "none") return false;

      const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(raw)}"]`);
      if (!el) return false;

      return __isElVisibleInScrollBox(el, mv, { margin: 18 });
    }
  } catch {
    return false;
  }
}

let __autoScrollGate = true; // wird kurz vor Ende der Ayah gesetzt

// =========================
// SuraPlay Progress (smooth, nur wenn SurahPlay läuft)
// =========================
let __suraProgRaf = 0;

function __setSuraProgressPct(pct){
  try{
    const p = document.getElementById("progress");
    if (!p) return;
    const v = Math.max(0, Math.min(100, pct));
    // ✅ einheitlich wie dein anderer Progress: GPU-smooth via transform
    p.style.transform = `scaleX(${(v / 100).toFixed(6)})`;
  }catch(e){}
}

function __computeSuraProgressPct(){
  try{
    if (!surahPlaying || !verseAudio) return 0;

    // ✅ Wenn gerade Basmallah (Standalone) läuft: KEIN Progress anzeigen
    // startSurahPlayback setzt dataset.ref = `basm:<surah>` für die Basm-Audio :contentReference[oaicite:4]{index=4}
    const r = String(verseRefPlaying || "");
    if (/^basm:\d+$/.test(r)) return 0;

    const meta = getSuraMeta(Number(surahPlaying));
    const n = Number(meta?.ayahCount || 0);
    if (!n) return 0;

    const idx0 = Math.max(0, (Number(surahAyahIdx || 1) - 1)); // 0-based
    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    const frac = (d > 0 && Number.isFinite(d) && Number.isFinite(t)) ? Math.max(0, Math.min(1, t / d)) : 0;

    // ✅ n Segmente: Progress läuft von 0 .. 100 erst am Ende der letzten Ayah
    return ((idx0 + frac) / n) * 100;
  }catch(e){
    return 0;
  }
}

function __startSuraProgRaf(){
  cancelAnimationFrame(__suraProgRaf);

  let _lastT = 0;

  const tick = (now) => {
    if (surahPlaying && verseAudio && !verseAudio.paused && !verseAudio.ended) {
      const t = (typeof now === "number")
        ? now
        : ((performance && performance.now) ? performance.now() : Date.now());

      // ✅ throttle auf ~90ms (~11fps)
      if (!_lastT || (t - _lastT) >= 90) {
        _lastT = t;
        __setSuraProgressPct(__computeSuraProgressPct());
      }

      __suraProgRaf = requestAnimationFrame(tick);
    }
  };

  // ✅ sofort einmal setzen (damit es nicht “hinterher hängt”)
  __setSuraProgressPct(__computeSuraProgressPct());
  __suraProgRaf = requestAnimationFrame(tick);
}

function __stopSuraProgRaf({ reset = false } = {}){
  cancelAnimationFrame(__suraProgRaf);
  __suraProgRaf = 0;
  if (reset) __setSuraProgressPct(0);
}

function playFromButton(btn, url, { queueMode = false, onEnded = null } = {}) {
  if (!url) return;

  // ✅ Safety: falls irgendwo noch relative reciter/wbw URLs in data-audio stehen,
  // machen wir sie hier immer absolut zur R2 Audio Domain.
  try {
    let u = String(url || "").trim();

    // wenn jemand aus Versehen "audio.quranm.com/..." ohne https setzt
    if (/^audio\.quranm\.com\//i.test(u)) u = "https://" + u;

    // führenden Slash entfernen ("/reciter/..." -> "reciter/...")
    if (u.startsWith("/")) u = u.slice(1);

    // relative reciter/wbw automatisch zur Audio-Domain
    if (!/^https?:\/\//i.test(u) && (u.startsWith("reciter/") || u.startsWith("wbw/"))) {
      u = `${AUDIO_BASE_URL}/${u}`;
    }

    url = u;
  } catch (e) {}

  // Wenn Wort-Audio läuft: stoppen, weil jetzt Ayah/Basm startet
  stopWordAudio();

  // Single-Ayah Klick soll Sura-Queue beenden
  if (!queueMode) stopSurahQueue();

  // Gleicher Button nochmal => Pause/Resume
  if (verseAudio && verseBtnPlaying === btn) {
    toggleVersePause();
    return;
  }
  // ✅ Auto-scroll Gate wird kurz vor Ende der vorherigen Ayah gesetzt.
  // Default: true (damit Start/Manuell nicht blockiert).
  // Wichtig: gilt für SurahPlay UND FavPlay (wenn sie wirklich aktiv sind).
  const __statusbar = document.getElementById("statusbar");
  const __favPlaying = !!(__statusbar && __statusbar.classList.contains("is-fav-playing"));
  const __surahPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

  const __useAutoScrollGate = !!(queueMode && (__surahPlaying || __favPlaying));

  const __allowAutoScrollToNext =
    __useAutoScrollGate
      ? !!__autoScrollGate
      : true;

  // reset fürs nächste Segment (wird wieder kurz vor Ende gesetzt)
  __autoScrollGate = true;

  stopVerseAudio({ stopQueue: !queueMode });

verseAudio = new Audio(url);

// ✅ Wichtig für WebAudio / Analyzer: sonst "outputs zeroes due to CORS"
verseAudio.crossOrigin = "anonymous";

try { applyGlobalVolume(); } catch(e){}

  // ✅ Ayah Edge: pro Reciter aus CSS :root (Fade + Silence)
  try {
    const prof = getAyahEdgeProfileForReciter((typeof RECITER !== "undefined") ? RECITER : "");
    const fadeMs = Number(prof?.fadeMs || 0);
    const silenceMs = Number(prof?.silenceMs || 0);
    const minMul = Number(prof?.minMul || 0);
    const silenceMul = Number(prof?.silenceMul || 0);
    __initVerseFade(verseAudio, { fadeMs, silenceMs, minMul, silenceMul, queueMode });
  } catch (e) {}

  verseBtnPlaying = btn;

  // ✅ welche Ayah spielt gerade? (für Swap Ayah<->Mushaf)
  verseRefPlaying =
    btn?.dataset?.ref ||
    btn?.getAttribute?.("data-ref") ||
    btn?.closest?.(".mNo")?.dataset?.ref ||
    btn?.closest?.(".ayahMainCard")?.dataset?.ref ||
    null;

  // ✅ Highlight immer.
  // ✅ Scroll nur wenn vorherige Ayah im Bild war (== __allowAutoScrollToNext)
  try {
    if (verseRefPlaying && /^\d+:\d+$/.test(String(verseRefPlaying))) {
      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv && qv.style.display !== "none") {
          focusAyahCard(qv, verseRefPlaying, { scroll: false });
          syncPlayingCardGlow();

          if (__allowAutoScrollToNext) {
            scrollToAyahWhenReady(qv, verseRefPlaying, { scroll: true });
          }
        }
      } else {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          syncPlayingMushafFocus();

          if (__allowAutoScrollToNext) {
            scrollToMushafNoWhenReady(mv, verseRefPlaying, { updateUrl: false, scroll: true });
          }
        }
      }
    }
  } catch (e) {}

  // ✅ word timings highlight (nur wenn wir eine echte ref haben)
  if (verseRefPlaying && verseAudio) {
    attachTimingToVerseAudio(verseAudio, verseRefPlaying);
  }

  // UI state an
  btn.classList.add("is-playing");
  btn.classList.remove("is-paused");

const hardStop = () => {
  // ✅ In Queue-Mode NICHT resetten (sonst springt Balken zwischen Ayat/Basm auf 0)
  try { __stopSuraProgRaf({ reset: !queueMode }); } catch(e){}
  stopVerseAudio({ stopQueue: !queueMode });
};

  verseAudio.addEventListener(
    "ended",
    () => {
      // ✅ FAILSAFE: Auto-scroll Gate am *echten* Ende festlegen.
      // Manche Browser/MP3 liefern duration spät/komisch -> dann greift der 350ms-Check nicht.
       try {
         const sb = document.getElementById("statusbar");
         const favPlaying = !!(sb && sb.classList.contains("is-fav-playing"));
         const suraPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

         if (queueMode && (suraPlaying || favPlaying)) {
           __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
         }
       } catch {}

      // ✅ erst dieses Audio sauber stoppen,
      // dann ggf. die nächste Ayah starten (sonst killt hardStop die neu gestartete Audio)
      hardStop();
      try { onEnded && onEnded(); } catch {}
    },
    { once: true }
  );

  // ✅ 350ms vor Ende: merken, ob die aktuelle Ayah noch im Viewport ist.
  // Das verhindert "hochspringen", wenn der User weggescrollt hat.
  let __gatePreEndSet = false;

verseAudio.addEventListener("timeupdate", () => {
  try {
    const d = Number(verseAudio?.duration || 0);
    const t = Number(verseAudio?.currentTime || 0);
    if (!Number.isFinite(d) || d <= 0) return;

    // ✅ Fade-In + Fade-Out (damit Background nicht "stumm hängen" kann)
    try { __maybeStartVerseFadeIn(verseAudio); } catch {}
    try { __maybeStartVerseFadeOut(verseAudio); } catch {}

    // ✅ Mushaf Progress-Ring (nur wenn Mushaf sichtbar + echte Ayah-Ref)
    try {
      const r = String(verseRefPlaying || "");
      if (r && /^\d+:\d+$/.test(r) && viewMode !== "ayah") {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
          if (el && !el.classList.contains("is-copied")) {
            const p = Math.max(0, Math.min(1, t / d));   // 0..1
            el.style.setProperty("--ring", String(p));
          }
        }
      }
    } catch {}

    // --- Queue-Mode: ~350ms vor Ende -> AutoScroll-Gate setzen
    if (queueMode && !__gatePreEndSet) {
      const sb = document.getElementById("statusbar");
      const favPlaying = !!(sb && sb.classList.contains("is-fav-playing"));
      const suraPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

      if (suraPlaying || favPlaying) {
        if (t >= d - 0.35) {
          __gatePreEndSet = true;
          __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
        }
      }
    }

    // --- Single-Ayah Mode: harter Stop sehr kurz vor Ende
    if (!queueMode) {
      if (t >= d - 0.06) hardStop();
    }
  } catch {}
}, { passive: true });

  verseAudio.addEventListener("error", hardStop, { once: true });

  verseAudio.addEventListener("play", () => {

    // ✅ WebAudio: wir merken uns die AudioContext-Zeitbasis für dieses Element
    try{
      __ensureAudioContext();
      if (__ac) {
        // mapping: acTime ≈ currentTime + base
        verseAudio._acBase = __acNow() - Number(verseAudio.currentTime || 0);
      }
    }catch{}

    // ✅ Fade-Out exakt zur Track-Duration planen (wenn möglich)
    try{
      if (verseAudio._needsFadeOutSchedule && verseAudio._edgeGain && __ac && Number.isFinite(verseAudio.duration) && verseAudio.duration > 0) {
        const eg = verseAudio._edgeGain;
        const now = __acNow();
        const base = Number(verseAudio._acBase || 0);

        const d = Number(verseAudio.duration || 0);
        const cutSec = Math.max(0, Number(verseAudio._fadeCutSec || 0));

        const fadeOutSec = Math.max(0, Number(verseAudio._fadeOutFadeSec || 0));
        const silOutSec  = Math.max(0, Number(verseAudio._fadeOutSilenceSec || 0));

        const floor = Math.max(0, Math.min(1, Number(verseAudio._fadeMinMul || 0)));
        const silLv = Math.max(0, Math.min(1, Number(verseAudio._silenceMul || 0)));

        const stopSec = Math.max(0, d - cutSec);
        const silStartSec = Math.max(0, stopSec - silOutSec);
        const fadeStartSec = Math.max(0, silStartSec - fadeOutSec);

        // in AudioContext time
        const tFadeStart = base + fadeStartSec;
        const tSilStart  = base + silStartSec;

        // ab "now" nicht anfassen, was schon lief (fade-in bleibt). Wir planen nur wenn Zeiten in Zukunft liegen
        if (tFadeStart > now + 0.01) {
          // Wert zum Zeitpunkt fadeStart setzen (damit kein Sprung)
          eg.gain.setValueAtTime(1, tFadeStart);

          // Ramp auf floor bis silStart
          if (fadeOutSec > 0) {
            eg.gain.linearRampToValueAtTime(floor, tSilStart);
          } else {
            eg.gain.setValueAtTime(floor, tSilStart);
          }

          // Silence-Level ab silStart (bis Ende)
          eg.gain.setValueAtTime(silLv, tSilStart);
        }

        verseAudio._needsFadeOutSchedule = false;
      }
    }catch{}



    // ✅ Fade-In (nur einmal pro Track) + ggf. Fade-Out Resume
    try { __maybeStartVerseFadeIn(verseAudio); } catch {}
    try { __maybeStartVerseFadeOut(verseAudio); } catch {}

    syncVerseBtnState();

    // ✅ Mushaf Ring smooth starten (gilt für AyahPlay, SurahPlay, FavPlay)
    try { __startMushafRingRaf(); } catch {}

    // ✅ nur im SurahPlay live updaten
    if (surahPlaying) {
      try { __startSuraProgRaf(); } catch (e) {}
    }
  });

  // ✅ NUR 1x pause (alles zusammen)
  verseAudio.addEventListener("pause", () => {
    try {
      // ✅ Mushaf Ring RAF stoppen (Ring bleibt stehen, wirkt stabil)
      try { __stopMushafRingRaf({ reset: false }); } catch {}

      // Single-Ayah Mode: wenn Pause exakt am Ende, Stop erzwingen
      if (!queueMode) {
        const d = Number(verseAudio?.duration || 0);
        const t = Number(verseAudio?.currentTime || 0);
        if (Number.isFinite(d) && d > 0 && Number.isFinite(t) && t >= d - 0.06) {
          hardStop();
        }
      }

      syncVerseBtnState();

      // SurahPlay RAF anhalten (nicht resetten)
      if (surahPlaying) {
        try { __stopSuraProgRaf({ reset: false }); } catch (e) {}
      }

      // Statusbar Progress stoppen (falls aktiv)
      try { window.__stopStatusbarProg?.(); } catch {}
    } catch {}
  });

  verseAudio.play().catch(() => hardStop());
}

// ===== MP3-NAMEN (global, damit basmMp3Url/ayahMp3Url IMMER existieren)
let RECITER = "alafasy";               // ✅ UI/Storage key (Dropdown)
let RECITER_AUDIO_FOLDER = "Mishari Rashid al Afasy"; // ✅ echter Ordnername in /reciter

// ✅ AUDIO_BASE_URL ist bereits weiter oben definiert (vor TRANSLATIONS)

// ✅ Reciter root über R2
const AUDIO_ROOT = `${AUDIO_BASE_URL}/reciter`;

const pad3 = (n) => String(Number(n)).padStart(3, "0");

// encode einzelne Pfad-Segmente (Spaces usw.)
const encSeg = (s) => encodeURIComponent(String(s || ""));

// reciter/<Reciter Folder>/<001-114>/
const surahDir = (surahNo) => `${AUDIO_ROOT}/${encSeg(RECITER_AUDIO_FOLDER)}/${pad3(surahNo)}/`;

// basm: reciter/<reciter>/002/002000.mp3
const basmMp3Url = (surahNo) => `${surahDir(surahNo)}${pad3(surahNo)}000.mp3`;

// ayah: reciter/<reciter>/002/002001.mp3
// special: Sura 1 => 1:1 -> 001000.mp3
const ayahMp3Url = (surahNo, ayahNo) => {
  let idx = ayahNo;
  if (surahNo === 1) idx = ayahNo - 1;
  if (idx < 0) idx = 0;
  return `${surahDir(surahNo)}${pad3(surahNo)}${pad3(idx)}.mp3`;
};

// optional debug helper
window.__getReciter = () => RECITER;

// --- Word Audio (1x global), damit nur ein Wort gleichzeitig spielt ---
let wordAudio = null;
let wordElPlaying = null;

function stopWordAudio() {
  if (wordAudio) {
    try { wordAudio.pause(); } catch {}
    try { wordAudio.currentTime = 0; } catch {}
  }
  wordAudio = null;

  if (wordElPlaying) {
    wordElPlaying.classList.remove("is-playing", "is-paused");
    wordElPlaying = null;
  }
}

// ===================== Word Timings (highlight) =====================

// IMPORTANT:
// - timing JSON ms sind ABSOLUT im Surah-Audio (audio_url im JSON)
// - wir spielen aber Ayah-MP3s -> wir addieren Ayah-Start-ms als Offset

const TIMINGS_BASE = `${AUDIO_BASE_URL}/timings_out`;
let TIMINGS_ROOT = `${TIMINGS_BASE}/Mishari Rashid al Afasy`;
const timingCache = new Map(); // surahNo -> json
// ✅ DOM-Cache: ref -> Array<HTMLElement> (Index = data-wi)
const wordDomCache = new Map();

function invalidateWordDomCache() {
  wordDomCache.clear();
  // optional: aktives Highlight sicher resetten (verhindert "hängende" Klasse)
  if (timingActiveEl) {
    timingActiveEl.classList.remove("is-timing");
    timingActiveEl = null;
  }
}

function _wordScopeEl() {
  // Wichtig: nur in der aktuell sichtbaren View suchen (Ayah vs Mushaf)
  return (viewMode === "mushaf")
    ? (document.querySelector(".mView") || document)
    : (document.querySelector(".qView") || document);
}

function getWordElCached(ref, wi0) {
  const r = String(ref || "");
  if (!r) return null;

  // Cache-Key MUSS viewMode enthalten, sonst greift Ayah-Cache im Mushaf (und umgekehrt)
  const key = `${viewMode}|${r}`;

  let arr = wordDomCache.get(key);
  if (!arr) {
    const scope = _wordScopeEl();

    // CSS.escape schützt refs sauber
    const selRef = CSS.escape(r);

    // nur innerhalb der aktuellen View einsammeln
    const els = Array.from(scope.querySelectorAll(`.w[data-ref="${selRef}"]`));

    arr = [];
    for (const el of els) {
      const n = Number(el.dataset?.wi);
      if (Number.isFinite(n) && n >= 0) arr[n] = el;
    }
    wordDomCache.set(key, arr);
  }

  return arr[wi0] || null;
}

let timingActiveEl = null;

// aktueller timing-run (damit wir listener sauber entfernen)
let timingRun = null;

function timingUrlForSurah(surahNo) {
  const s = String(Number(surahNo)).padStart(3, "0");
  return `${TIMINGS_ROOT}/surah_${s}.json`;
}

async function getSurahTimings(surahNo) {
  const s = Number(surahNo);
  if (timingCache.has(s)) return timingCache.get(s);

  const url = timingUrlForSurah(s);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`timing fetch failed ${res.status}: ${url}`);
  const json = await res.json();

  timingCache.set(s, json);
  return json;
}

function clearTimingHighlight() {
  if (timingActiveEl) {
    timingActiveEl.classList.remove("is-timing");
    timingActiveEl = null;
  }
}

// wordIndex im JSON ist i.d.R. 1-based, bei uns data-wi ist 0-based
function setTimingWord(ref, wordIndex1Based) {
  const wi = Number(wordIndex1Based) - 1;
  if (!Number.isFinite(wi) || wi < 0) return;

  const el = getWordElCached(ref, wi);
  if (!el) return;

  if (timingActiveEl && timingActiveEl !== el) {
    timingActiveEl.classList.remove("is-timing");
  }
  timingActiveEl = el;
  timingActiveEl.classList.add("is-timing");
}


function detachTimingRun() {
  try { timingRun?.detach?.(); } catch {}
  timingRun = null;
  clearTimingHighlight();
}

async function attachTimingToVerseAudio(audioEl, ref) {
  // ref Format: "2:255"
  const [sStr, aStr] = String(ref || "").split(":");
  const s = Number(sStr);
  const a = Number(aStr);
  if (!s || !a || !audioEl) return;

  // alte run weg
  detachTimingRun();

  let timings;
  try {
    timings = await getSurahTimings(s);
  } catch (e) {
    // wenn timing json fehlt -> einfach kein highlighting
    return;
  }

  const list = timings?.ayahs?.[String(a)];
  if (!Array.isArray(list) || list.length === 0) return;

  // list entries: [wordIndex, startMs, endMs] (absolute in surah)
  // AyahStart = startMs vom ersten word
  const ayahStartMs = Number(list[0]?.[1] ?? 0);

  // wir laufen pointer-basiert durch (performant)
  const segs = list
    .map((x) => [Number(x[0]), Number(x[1]), Number(x[2])])
    .filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && Number.isFinite(x[2]))
    .sort((p, q) => p[1] - q[1]); // nach startMs

  let idx = 0;

  // ✅ NEGATIV = Highlight später (Delay)
  // Wenn es bei dir ca. 200ms zu früh ist -> -200 passt meistens
  const leadMs = -1;

  const onTime = () => {
    if (!audioEl) return;

    // currentTime ist relativ zur Ayah-MP3 -> auf absolute surah-ms mappen
    const absMs = ayahStartMs + (audioEl.currentTime * 1000) + leadMs;

    // idx vorziehen falls nötig
    while (idx < segs.length - 1 && absMs >= segs[idx][2]) idx++;

    const cur = segs[idx];
    if (!cur) return;

    const [wordIndex, startMs, endMs] = cur;
    if (absMs >= startMs && absMs < endMs) {
      setTimingWord(`${s}:${a}`, wordIndex);
    }
  };

  // initial (falls currentTime > 0)
  onTime();

  let rafId = 0;

const tick = () => {
  if (!audioEl) return;

  // ✅ Wenn Audio nicht wirklich "laufbereit" ist (Buffering/Seeking), Highlighting nicht vorwärts schieben
  // HAVE_FUTURE_DATA = 3 (genug Daten um weiterzuspielen)
  if (audioEl.paused || audioEl.seeking || (audioEl.readyState && audioEl.readyState < 3)) {
    rafId = requestAnimationFrame(tick);
    return;
  }

  const absMs = ayahStartMs + (audioEl.currentTime * 1000) + leadMs;

  while (idx < segs.length - 1 && absMs >= segs[idx][2]) idx++;

  const cur = segs[idx];
  if (cur) {
    const [wordIndex, startMs, endMs] = cur;
    if (absMs >= startMs && absMs < endMs) {
      setTimingWord(`${s}:${a}`, wordIndex);
    }
  }

  rafId = requestAnimationFrame(tick);
};

  const startRaf = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  };

  const stopRaf = () => {
    if (!rafId) return;
    try { cancelAnimationFrame(rafId); } catch {}
    rafId = 0;
  };

  // nur laufen lassen wenn wirklich play
  const onPlay = () => startRaf();
  const onPause = () => stopRaf();

  audioEl.addEventListener("play", onPlay);
  audioEl.addEventListener("pause", onPause);
  audioEl.addEventListener("ended", onPause);

  // initial: falls schon spielt
  if (!audioEl.paused) startRaf();

  timingRun = {
    detach: () => {
      stopRaf();
      try { audioEl.removeEventListener("play", onPlay); } catch {}
      try { audioEl.removeEventListener("pause", onPause); } catch {}
      try { audioEl.removeEventListener("ended", onPause); } catch {}
    },
  };

}

function installHifzRecallHotkeys() {
  if (window.__quranHifzRecallHotkeysInstalled) return;
  window.__quranHifzRecallHotkeysInstalled = true;

  document.addEventListener(
    "keydown",
    (e) => {
      const key = String(e.key || "");
      const code = String(e.code || "");

      const isSpace = code === "Space" || key === " ";
      const isBad = key === "1" || code === "Digit1" || code === "Numpad1";
      const isGood = key === "3" || code === "Digit3" || code === "Numpad3";

      if (!isSpace && !isBad && !isGood) return;
      if (e.repeat) return;

      const ae = document.activeElement;
      const typing =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (typing) return;

      if (viewMode !== "ayah") return;

      const qv = document.querySelector(".qView");
      if (!qv || qv.dataset.mode === "favorites" || qv.style.display === "none") return;

      const ref = String(currentRef || "");
      if (!/^\d+:\d+$/.test(ref)) return;

      const safeRef = CSS.escape(ref);
      const unhideBtn = qv.querySelector(`[data-hifz-unhide="${safeRef}"]`);
      const badBtn = qv.querySelector(`[data-hifz-mark="bad"][data-hifz-ref="${safeRef}"]`);
      const goodBtn = qv.querySelector(`[data-hifz-mark="good"][data-hifz-ref="${safeRef}"]`);

      const targetBtn = isSpace ? unhideBtn : (isBad ? badBtn : goodBtn);
      if (!targetBtn) return;

      e.preventDefault();
      e.stopPropagation();

      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }

      targetBtn.click();
    },
    { capture: true }
  );
}

function installSpacebarAudioHotkey() {
  if (window.__quranSpacebarHotkeyInstalled) return;
  window.__quranSpacebarHotkeyInstalled = true;

  document.addEventListener(
    "keydown",
    (e) => {
      const isSpace = e.code === "Space" || e.key === " ";
      if (!isSpace) return;

      // nicht triggern, wenn der User gerade tippt
      const ae = document.activeElement;
      const typing =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (typing) return;

      // Wort hat Priorität
      let did = false;

      if (wordAudio) {
        if (wordAudio.paused) {
          wordAudio.play().catch(() => {});
          wordElPlaying?.classList.remove("is-paused");
        } else {
          wordAudio.pause();
          wordElPlaying?.classList.add("is-paused");
        }
        did = true;
      } else {
        did = toggleVersePause(); // kommt aus dem Verse-Audio Block
      }

      if (did) e.preventDefault();
    },
    { capture: true }
  );
}

function installBookmarkHotkey() {
  if (window.__quranBookmarkHotkeyInstalled) return;
  window.__quranBookmarkHotkeyInstalled = true;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "b" && e.key !== "B") return;

    const ae = document.activeElement;
    const typing =
      ae &&
      (ae.tagName === "INPUT" ||
        ae.tagName === "TEXTAREA" ||
        ae.isContentEditable);
    if (typing) return;

    if (/^\d+:\d+$/.test(currentRef)) {
      const res = toggleBookmark(currentRef);
      // UI sync (nur falls Ayah view da)
      const qv = document.querySelector(".qView");
      if (qv) {
        const btn = qv.querySelector(`button.ayahBm[data-bm="${CSS.escape(currentRef)}"]`);
        if (btn) btn.classList.toggle("is-on", res.bookmarked);
      }
    }

    e.preventDefault();
  }, { capture: true });
}

function ensureQView() {
  const stage = document.getElementById("stage");
  if (!stage) return null;

  let view = stage.querySelector(".qView");
  if (!view) {
    view = document.createElement("div");
    view.className = "qView";
    stage.appendChild(view);
  }
  return view;
}

let __inFavoritesPage = false;
let __favPrevViewMode = "ayah";
let __favPrevRef = null;

// =========================
// HIFZ state (integrated into main views)
// =========================
const LS_HIFZ_STAGE = "q_hifzStage_v1";
const LS_HIFZ_RANGE = "q_hifzRange_v1";

let hifzStageValue = "1";
let hifzRangeValue = "5-10";

function loadHifzStageValue(){
  try{
    const v = String(localStorage.getItem(LS_HIFZ_STAGE) || "").trim();
    if (/^(10|[1-9])$/.test(v)) return v;
  }catch{}
  return "1";
}

function saveHifzStageValue(v){
  const safe = /^(10|[1-9])$/.test(String(v || "")) ? String(v) : "1";
  hifzStageValue = safe;
  try{ localStorage.setItem(LS_HIFZ_STAGE, safe); }catch{}
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

function loadHifzRangeValue(){
  try{
    const v = String(localStorage.getItem(LS_HIFZ_RANGE) || "").trim();
    if (v) return v;
  }catch{}
  return "5-10";
}

function saveHifzRangeValue(v){
  const safe = String(v || "").trim() || "5-10";
  hifzRangeValue = safe;
  try{ localStorage.setItem(LS_HIFZ_RANGE, safe); }catch{}
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

function getHifzRangeBoundsForRef(ref = currentRef){
  const ay = getAyah(ref);
  const surahNo = ay?.surah || currentSurahInView || 1;
  const refsRaw = (typeof getSuraRefs === "function") ? (getSuraRefs(surahNo) || []) : [];

  const rawRange = String(hifzRangeValue || "1-999").trim();
  const m = rawRange.match(/^(\d+)\s*-\s*(\d+)$/);

  let fromAyah = 1;
  let toAyah = Number(getSuraMeta(surahNo)?.ayahCount || refsRaw.length || 1);

  if (m) {
    fromAyah = Math.max(1, Number(m[1]) || 1);
    toAyah = Math.max(1, Number(m[2]) || fromAyah);
  }

  if (toAyah < fromAyah) {
    const tmp = fromAyah;
    fromAyah = toAyah;
    toAyah = tmp;
  }

  const maxAyah = Number(getSuraMeta(surahNo)?.ayahCount || refsRaw.length || 1);
  fromAyah = Math.min(fromAyah, maxAyah);
  toAyah = Math.min(toAyah, maxAyah);

  return {
    surahNo,
    fromAyah,
    toAyah,
    startRef: `${surahNo}:${fromAyah}`,
    endRef: `${surahNo}:${toAyah}`
  };
}


// =========================
// HIFZ STAGES (central definition)
// =========================
const HIFZ_STAGE_META = {
  "1": {
    id: "1",
    title: "Stage 1",
    short: "Sequential with help",
    menu: "order • previous ayah + first word",
    assist: "Previous ayah + first word",
    kind: "recite"
  },
  "2": {
    id: "2",
    title: "Stage 2",
    short: "Sequential without first-word help",
    menu: "order • previous ayah only",
    assist: "Previous ayah",
    kind: "recite"
  },
  "3": {
    id: "3",
    title: "Stage 3",
    short: "Random within the surah with help",
    menu: "range random ayah • previous ayah + first word",
    assist: "Previous ayah + first word",
    kind: "recite"
  },
  "4": {
    id: "4",
    title: "Stage 4",
    short: "Random within the surah with small help",
    menu: "range random ayah • previous ayah only",
    assist: "Previous ayah",
    kind: "recite"
  },
  "5": {
    id: "5",
    title: "Stage 5",
    short: "Random within selected range, ayah number only",
    menu: "range random ayah • ayah number",
    assist: "Ayah number only",
    kind: "recite"
  },
  "6": {
    id: "6",
    title: "Stage 6",
    short: "Random from the whole surah, ayah number only",
    menu: "all surah random ayah • ayah number only",
    assist: "Ayah number only",
    kind: "recite"
  },
  "7": {
    id: "7",
    title: "Stage 7",
    short: "Random from the whole Quran (Hafiz level)",
    menu: "whole Quran random ayah • no help",
    assist: "No help",
    kind: "recite"
  },
  "8": {
    id: "8",
    title: "Stage 8",
    short: "Writing, random from the whole surah with help",
    menu: "writing • all surah random ayah • previous ayah",
    assist: "Previous ayah shown",
    kind: "write"
  },
  "9": {
    id: "9",
    title: "Stage 9",
    short: "Writing, random from the whole surah without previous ayah help",
    menu: "writing • all surah random ayah • no help",
    assist: "Surah:Ayah only",
    kind: "write"
  },
  "10": {
    id: "10",
    title: "Stage 10",
    short: "Writing, random from the whole Quran without previous ayah help",
    menu: "writing • whole Quran random ayah • no help",
    assist: "Surah:Ayah only",
    kind: "write"
  }
};

function getHifzStageMeta(id){
  return HIFZ_STAGE_META[String(id)] || HIFZ_STAGE_META["1"];
}

function escHifzStageText(v){
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

function getHifzStageProgressMap(){
  try{
    const refs = getAllRefs();
    const ids = Object.keys(HIFZ_STAGE_META).sort((a, b) => Number(a) - Number(b));
    const sums = {};

    for (const id of ids) sums[id] = 0;

    if (!refs.length) {
      const empty = {};
      for (const id of ids) empty[id] = 0;
      return empty;
    }

    for (const ref of refs){
      for (const id of ids){
        const ratio = Number(getHifzProgressRatioForRef(ref, id) || 0);
        sums[id] += Math.max(0, Math.min(1, ratio));
      }
    }

    const out = {};
    for (const id of ids){
      out[id] = Math.max(0, Math.min(100, Math.round((sums[id] / refs.length) * 100)));
    }
    return out;
  }catch{
    return {
      "1": 0, "2": 0, "3": 0, "4": 0, "5": 0,
      "6": 0, "7": 0, "8": 0, "9": 0, "10": 0
    };
  }
}

function buildHifzStageDropdownHtml(selectedId){
  const selected = String(selectedId || "1");
  const progressMap = getHifzStageProgressMap();
  const items = Object.keys(HIFZ_STAGE_META).sort((a, b) => Number(a) - Number(b));
  const activeMeta = getHifzStageMeta(selected);
  const activePct = Number(progressMap[selected] || 0);

  const nativeOptions = items.map((id) => {
    const meta = getHifzStageMeta(id);
    const sel = id === selected ? " selected" : "";
    return `<option value="${id}"${sel}>${escHifzStageText(meta.title)}</option>`;
  }).join("");

  const menuItems = items.map((id) => {
    const meta = getHifzStageMeta(id);
    const pct = Number(progressMap[id] || 0);
    const selectedCls = id === selected ? " is-selected" : "";
    return `
      <button
        class="hifzStageDropItem${selectedCls}"
        type="button"
        data-stage-value="${id}"
        role="option"
        aria-selected="${id === selected ? "true" : "false"}"
        style="--stage-progress:${pct}%;">

        <span class="hifzStageDropItemMain">
          <span class="hifzStageDropItemTitle">${escHifzStageText(meta.title)}</span>
          <span class="hifzStageDropItemDesc">${escHifzStageText(meta.menu)}</span>
        </span>

        <span class="hifzStageDropItemSide">
          <span class="hifzStageDropItemPct">${pct}%</span>
        </span>
      </button>
    `;
  }).join("");

  return `
    <div class="hifzStageDrop" id="hifzStageDropTop" style="--hifz-stage-pct:${activePct}%;">
      <select class="hifzStageSelect hifzStageSelectNative" id="hifzStageSelectTop" aria-label="Choose Hifz level">
        ${nativeOptions}
      </select>

      <button class="hifzStageDropBtn" id="hifzStageDropBtnTop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Choose Hifz level">
        <span class="hifzStageDropBtnLabel" id="hifzStageDropLabelTop">${escHifzStageText(activeMeta.title)}</span>
        <span class="hifzStageDropBtnArrow" aria-hidden="true">▼</span>
      </button>

      <div class="hifzStageDropMenu" id="hifzStageDropMenuTop" role="listbox" aria-label="Choose Hifz level">
        ${menuItems}
      </div>
    </div>
  `;
}

function getHifzStageInfoHtml(esc){
  const st = getHifzStageMeta(hifzStageValue);
  return `
    <div class="hifzStageInfo ayahCard ayahMainCard" data-hifz-stage="${st.id}">
      <div class="hifzStageInfoTop">
        <div class="hifzStageBadge">${esc(st.title)}</div>
        <div class="hifzStageKind">${esc(st.kind === "write" ? "Writing check" : "Recitation check")}</div>
      </div>
      <div class="hifzStageLine">${esc(st.short)}</div>
      <div class="hifzStageAssist">Help: ${esc(st.assist)}</div>
    </div>
  `;
}

const LS_HIFZ_RESULTS = "q_hifz_results_v1";
const LS_HIFZ_REPEAT_TARGET = "q_hifz_repeat_target_v1";

let __hifzResultsCache = null;
let __hifzRepeatTargetCache = null;

function __normalizeHifzResultsMap(obj){
  return (obj && typeof obj === "object") ? obj : {};
}

function __resetHifzLocalCache(){
  __hifzResultsCache = null;
  __hifzRepeatTargetCache = null;
}

function loadHifzResults(){
  if (__hifzResultsCache && typeof __hifzResultsCache === "object") {
    return __hifzResultsCache;
  }

  try{
    const raw = localStorage.getItem(LS_HIFZ_RESULTS);
    if (!raw) {
      __hifzResultsCache = {};
      return __hifzResultsCache;
    }

    const obj = JSON.parse(raw);
    __hifzResultsCache = __normalizeHifzResultsMap(obj);
    return __hifzResultsCache;
  }catch{
    __hifzResultsCache = {};
    return __hifzResultsCache;
  }
}

function saveHifzResults(obj){
  const clean = __normalizeHifzResultsMap(obj);

  __hifzResultsCache = clean;

  try{
    localStorage.setItem(LS_HIFZ_RESULTS, JSON.stringify(clean));
  }catch{}

  try { recordHifzStageTrendSnapshot({ force: true }); } catch {}
  try { window.__refreshAccountHifzScore?.(); } catch(e) {}
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

function loadHifzRepeatTarget(){
  if (Number.isFinite(__hifzRepeatTargetCache)) {
    return __hifzRepeatTargetCache;
  }

  try{
    const v = Number(localStorage.getItem(LS_HIFZ_REPEAT_TARGET) || 5);
    if (Number.isFinite(v) && v >= 1 && v <= 100) {
      __hifzRepeatTargetCache = Math.floor(v);
      return __hifzRepeatTargetCache;
    }
  }catch{}

  __hifzRepeatTargetCache = 5;
  return __hifzRepeatTargetCache;
}

const LS_HIFZ_STAGE_TREND = "q_hifz_stage_trend_v1";
const LS_HIFZ_STAGE_TREND_COLLAPSED = "q_hifz_stage_trend_collapsed_v1";
const HIFZ_STAGE_TREND_KEEP_DAYS = 36525; // 100 Jahre daily
const HIFZ_STAGE_TREND_MIN_VIEW_DAYS = 14;
const HIFZ_STAGE_TREND_LABEL_TARGET = 12;

function loadHifzStageTrendCollapsed(){
  try{
    return localStorage.getItem(LS_HIFZ_STAGE_TREND_COLLAPSED) === "1";
  }catch{
    return false;
  }
}

function saveHifzStageTrendCollapsed(v){
  const on = !!v;

  try{
    if (on) localStorage.setItem(LS_HIFZ_STAGE_TREND_COLLAPSED, "1");
    else localStorage.removeItem(LS_HIFZ_STAGE_TREND_COLLAPSED);
  }catch{}

  return on;
}

function applyHifzStageTrendCollapsedUi(root = document){
  const collapsed = loadHifzStageTrendCollapsed();
  const scope = (root && typeof root.querySelectorAll === "function") ? root : document;

  scope.querySelectorAll(".hifzStageTrendCard").forEach((card) => {
    card.classList.toggle("is-collapsed", collapsed);

    const btn = card.querySelector('.hifzStageTrendToggle[data-action="toggleStageTrendCollapse"]');
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.setAttribute(
        "aria-label",
        collapsed ? "Expand Stage Progress" : "Collapse Stage Progress"
      );
      btn.setAttribute(
        "title",
        collapsed ? "Expand Stage Progress" : "Collapse Stage Progress"
      );
    }

    const body = card.querySelector(".hifzStageTrendBody");
    if (body) {
      body.hidden = collapsed;
      body.setAttribute("aria-hidden", collapsed ? "true" : "false");
    }
  });

  return collapsed;
}

function _hifzTrendDateKeyFromDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _hifzTrendTodayKey(){
  return _hifzTrendDateKeyFromDate(new Date());
}

function _hifzTrendShiftIso(baseIso, offsetDays){
  const d = new Date(`${baseIso}T12:00:00`);
  d.setDate(d.getDate() + Number(offsetDays || 0));
  return _hifzTrendDateKeyFromDate(d);
}

function _hifzTrendLabel(iso){
  const parts = String(iso || "").split("-");
  if (parts.length !== 3) return String(iso || "");
  return `${parts[2]}.${parts[1]}`;
}

function _normalizeHifzTrendStages(stages){
  const out = {};
  for (let i = 1; i <= 10; i += 1) {
    const key = String(i);
    const raw = Number(stages?.[key] || 0);
    out[key] = Math.max(0, Math.min(100, raw));
  }
  return out;
}

function _getHifzTrendAutoDays(requestedDays, historyCount){
  const explicit = Number(requestedDays);

  if (Number.isFinite(explicit) && explicit >= 2) {
    return Math.max(2, Math.floor(explicit));
  }

  if (Number(historyCount) >= 2) {
    return Math.max(2, Math.floor(historyCount));
  }

  return HIFZ_STAGE_TREND_MIN_VIEW_DAYS;
}

function _getHifzTrendLabelStep(seriesLength){
  const n = Math.max(1, Number(seriesLength) || 1);

  if (n <= 21) return 1;
  return Math.max(1, Math.ceil(n / HIFZ_STAGE_TREND_LABEL_TARGET));
}

function loadHifzStageTrendHistory(){
  try{
    const raw = localStorage.getItem(LS_HIFZ_STAGE_TREND);
    if (!raw) return [];

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    return arr
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
      .map((row) => ({
        date: String(row.date),
        stages: _normalizeHifzTrendStages(row.stages || {})
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-HIFZ_STAGE_TREND_KEEP_DAYS);
  }catch{
    return [];
  }
}

function saveHifzStageTrendHistory(list){
  try{
    const clean = Array.isArray(list)
      ? list
          .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
          .map((row) => ({
            date: String(row.date),
            stages: _normalizeHifzTrendStages(row.stages || {})
          }))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .slice(-HIFZ_STAGE_TREND_KEEP_DAYS)
      : [];

    localStorage.setItem(LS_HIFZ_STAGE_TREND, JSON.stringify(clean));
  }catch{}
}

function buildHifzStageTrendSnapshot(){
  if (!dataReady || typeof getAllRefs !== "function") return null;

  const refs = getAllRefs() || [];
  if (!refs.length) return null;

  const map = loadHifzResults();
  const target = Math.max(1, Number(loadHifzRepeatTarget()) || 1);
  const sums = {};

  for (let i = 1; i <= 10; i += 1) {
    sums[String(i)] = 0;
  }

  for (const ref of refs) {
    const row = (map?.[ref] && typeof map[ref] === "object") ? map[ref] : {};

    for (let i = 1; i <= 10; i += 1) {
      const key = String(i);
      const goodCount = Math.max(0, Number(row?.[key]?.goodCount || 0));
      sums[key] += Math.max(0, Math.min(1, goodCount / target));
    }
  }

  const total = Math.max(1, refs.length);
  const stages = {};

  for (let i = 1; i <= 10; i += 1) {
    const key = String(i);
    stages[key] = Math.round(((sums[key] / total) * 1000)) / 10;
  }

  return {
    date: _hifzTrendTodayKey(),
    stages
  };
}

function recordHifzStageTrendSnapshot({ force = false } = {}){
  const snap = buildHifzStageTrendSnapshot();
  if (!snap) return null;

  const hist = loadHifzStageTrendHistory();
  const idx = hist.findIndex((row) => row.date === snap.date);

  if (idx >= 0) {
    const same =
      JSON.stringify(_normalizeHifzTrendStages(hist[idx].stages || {})) ===
      JSON.stringify(_normalizeHifzTrendStages(snap.stages || {}));

    if (same && !force) {
      return hist[idx];
    }

    hist[idx] = {
      date: snap.date,
      stages: _normalizeHifzTrendStages(snap.stages || {})
    };
  } else {
    hist.push({
      date: snap.date,
      stages: _normalizeHifzTrendStages(snap.stages || {})
    });
  }

  saveHifzStageTrendHistory(hist);
  return snap;
}

function getHifzStageTrendSeries(days = null){
  const today = _hifzTrendTodayKey();
  const live = buildHifzStageTrendSnapshot();
  const history = loadHifzStageTrendHistory();

  if (live) {
    const idx = history.findIndex((row) => row.date === live.date);
    if (idx >= 0) history[idx] = live;
    else history.push(live);
  }

  history.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const countDays = _getHifzTrendAutoDays(days, history.length || (live ? 1 : 0));
  const byDate = new Map(history.map((row) => [row.date, _normalizeHifzTrendStages(row.stages || {})]));
  const fallbackStages =
    live?.stages ||
    (history.length ? history[history.length - 1].stages : null) ||
    _normalizeHifzTrendStages({});

  let carry = _normalizeHifzTrendStages(fallbackStages);
  const out = [];

  for (let i = countDays - 1; i >= 0; i -= 1) {
    const date = _hifzTrendShiftIso(today, -i);
    if (byDate.has(date)) {
      carry = _normalizeHifzTrendStages(byDate.get(date));
    }

    out.push({
      date,
      label: _hifzTrendLabel(date),
      stages: _normalizeHifzTrendStages(carry),
      isReal: byDate.has(date)
    });
  }

  return out;
}

function getHifzStageTrendColor(stage){
  const palette = {
    "1":  "rgba(var(--rgb-ok),0.96)",
    "2":  "rgba(var(--rgb-ok),0.72)",
    "3":  "rgba(var(--rgb-accent),0.96)",
    "4":  "rgba(var(--rgb-accent),0.72)",
    "5":  "rgba(var(--rgb-note),0.94)",
    "6":  "rgba(var(--rgb-note),0.72)",
    "7":  "rgba(var(--rgb-warn),0.95)",
    "8":  "rgba(var(--rgb-warn),0.72)",
    "9":  "rgba(var(--rgb-white),0.86)",
    "10": "rgba(var(--rgb-danger),0.92)"
  };

  return palette[String(stage)] || "rgba(var(--rgb-accent),0.78)";
}

function buildHifzStageTrendHtml(){
  const series = getHifzStageTrendSeries();
  if (!series.length) return "";

  const stages = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const latest = series[series.length - 1] || series[0];

  const width = 1000;
  const height = 258;
  const padL = 42;
  const padR = 18;
  const padT = 16;
  const padB = 30;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xAt = (idx) => {
    if (series.length <= 1) return padL + (plotW * 0.5);
    return padL + ((idx / (series.length - 1)) * plotW);
  };

  const yAt = (pct) => {
    const safe = Math.max(0, Math.min(100, Number(pct) || 0));
    return padT + (((100 - safe) / 100) * plotH);
  };

  const yTicks = [100, 75, 50, 25, 0];

  const gridHtml = yTicks.map((pct) => {
    const y = yAt(pct).toFixed(2);
    return `
      <line class="hifzStageTrendGridLine" x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}"></line>
      <text class="hifzStageTrendAxisText" x="${padL - 8}" y="${y}" text-anchor="end">${pct}%</text>
    `;
  }).join("");

const labelStep = _getHifzTrendLabelStep(series.length);

const xLabelsHtml = series.map((row, idx) => {
  const show = idx === 0 || idx === series.length - 1 || idx % labelStep === 0;
  if (!show) return "";

  const x = xAt(idx).toFixed(2);
  return `<text class="hifzStageTrendDateText" x="${x}" y="${height - 8}" text-anchor="middle">${row.label}</text>`;
}).join("");

  const smoothTrendValues = (vals) => {
    if (!Array.isArray(vals) || vals.length <= 2) return Array.isArray(vals) ? vals.slice() : [];

    const out = vals.map((v) => Number(v) || 0);

    for (let i = 0; i < vals.length; i += 1) {
      const prev2 = Number(vals[i - 2] ?? vals[i - 1] ?? vals[i]) || 0;
      const prev1 = Number(vals[i - 1] ?? vals[i]) || 0;
      const cur   = Number(vals[i]) || 0;
      const next1 = Number(vals[i + 1] ?? vals[i]) || 0;
      const next2 = Number(vals[i + 2] ?? vals[i + 1] ?? vals[i]) || 0;

      out[i] = (
        prev2 * 1 +
        prev1 * 2 +
        cur   * 4 +
        next1 * 2 +
        next2 * 1
      ) / 10;
    }

    out[0] = Number(vals[0]) || 0;
    out[vals.length - 1] = Number(vals[vals.length - 1]) || 0;

    return out;
  };

  const linesHtml = stages
    .slice()
    .reverse()
    .map((stage) => {
      const color = getHifzStageTrendColor(stage);
      const rawVals = series.map((row) => Number(row?.stages?.[stage] || 0));
      const smoothVals = smoothTrendValues(rawVals);

      const points = smoothVals.map((pct, idx) => {
        const x = xAt(idx).toFixed(2);
        const y = yAt(pct).toFixed(2);
        return `${x},${y}`;
      }).join(" ");

      const lastX = xAt(series.length - 1).toFixed(2);
      const lastY = yAt(smoothVals[smoothVals.length - 1] || 0).toFixed(2);

      return `
        <polyline class="hifzStageTrendLine" style="color:${color}" points="${points}"></polyline>
        <circle class="hifzStageTrendDot" style="color:${color}" cx="${lastX}" cy="${lastY}" r="3.4"></circle>
      `;
    })
    .join("");

  const legendHtml = stages.map((stage) => {
    const color = getHifzStageTrendColor(stage);
    const pctNum = Math.max(0, Math.min(100, Number(latest?.stages?.[stage] || 0)));
    const pct = pctNum.toFixed(1);

    return `
      <div
        class="hifzStageTrendLegendItem"
        style="--trend-color:${color}; --legend-progress:${pctNum}%;"
      >
        <span class="hifzStageTrendLegendFill" aria-hidden="true"></span>

        <span class="hifzStageTrendLegendContent">
          <span class="hifzStageTrendLegendSwatch" aria-hidden="true"></span>
          <span class="hifzStageTrendLegendStage">Stage ${stage}</span>
          <span class="hifzStageTrendLegendPct">${pct}%</span>
        </span>
      </div>
    `;
  }).join("");

  const hifzScoreText = formatHifzScore(getHifzScoreValue());
  const isCollapsed = loadHifzStageTrendCollapsed();

  return `
    <div class="ayahCard hifzStageTrendCard${isCollapsed ? " is-collapsed" : ""}">
      <div class="hifzStageTrendHeader">
        <div class="hifzStageTrendHeaderSide"></div>

        <button
          class="hifzStageTrendToggle"
          type="button"
          data-action="toggleStageTrendCollapse"
          aria-expanded="${isCollapsed ? "false" : "true"}"
          aria-label="${isCollapsed ? "Expand Stage Progress" : "Collapse Stage Progress"}"
          title="${isCollapsed ? "Expand Stage Progress" : "Collapse Stage Progress"}"
        >
          <span class="hifzStageTrendTitle">Stage Progress</span>
          <span class="hifzStageTrendArrow" aria-hidden="true">▾</span>
        </button>

        <div class="hifzStageTrendHeaderMeta">
          <span class="hifzStageTrendHeaderMetaLabel">Hifzscore</span>
          <span
            class="hifzHelpInfo"
            data-hifz-help="hifzscore-stage-progress"
            data-hifz-help-title="Hifzscore"
            data-hifz-help-text="this is a score for memorizing the quran in all 10 stages"
            aria-label="this is a score for memorizing the quran in all 10 stages">?</span>
          <span class="hifzStageTrendHeaderScore">${hifzScoreText}</span>
        </div>
      </div>

      <div class="hifzStageTrendBody"${isCollapsed ? ' hidden aria-hidden="true"' : ' aria-hidden="false"'}>
        <div class="hifzStageTrendFrame">
          <svg class="hifzStageTrendSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Stage progress over days">
            ${gridHtml}
            ${linesHtml}
            ${xLabelsHtml}
          </svg>
        </div>

        <div class="hifzStageTrendLegend">
          ${legendHtml}
        </div>
      </div>
    </div>
  `;
}

function saveHifzRepeatTarget(v){
  const n = Math.max(1, Math.min(100, Number(v) || 5));
  __hifzRepeatTargetCache = n;

  try{
    localStorage.setItem(LS_HIFZ_REPEAT_TARGET, String(n));
  }catch{}

  try { recordHifzStageTrendSnapshot({ force: true }); } catch {}
  try { window.__refreshAccountHifzScore?.(); } catch(e) {}
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

dataPromise.then(() => {
  try { recordHifzStageTrendSnapshot(); } catch {}
  try { window.__refreshAccountHifzScore?.(); } catch(e) {}
});

window.addEventListener("storage", (e) => {
  if (!e) return;

  if (e.key === LS_HIFZ_STAGE) {
    hifzStageValue = loadHifzStageValue();
  }

  if (e.key === LS_HIFZ_RANGE) {
    hifzRangeValue = loadHifzRangeValue();
  }

  if (e.key === LS_HIFZ_RESULTS || e.key === LS_HIFZ_REPEAT_TARGET) {
    __resetHifzLocalCache();
  }

  if (e.key === LS_HIFZ_STAGE_TREND) {
    try {
      renderCurrent(currentRef);
    } catch {}
  }
});

function getHifzStageRow(ref, stage){
  const r = String(ref || "");
  const s = String(stage || hifzStageValue || "1");
  if (!/^\d+:\d+$/.test(r)) return null;

  const map = loadHifzResults();
  const row = (map[r] && typeof map[r] === "object") ? map[r] : {};
  const cell = (row[s] && typeof row[s] === "object") ? row[s] : {
    state: "neutral",
    goodCount: 0
  };

  return {
    ref: r,
    stage: s,
    state: String(cell.state || "neutral"),
    goodCount: Math.max(0, Number(cell.goodCount) || 0)
  };
}

function getHifzResultForRef(ref, stage){
  const row = getHifzStageRow(ref, stage);
  return row ? row.state : "neutral";
}

function getHifzGoodCountForRef(ref, stage){
  const row = getHifzStageRow(ref, stage);
  return row ? row.goodCount : 0;
}

function getHifzProgressRatioForRef(ref, stage){
  const target = loadHifzRepeatTarget();
  const count = getHifzGoodCountForRef(ref, stage);
  return Math.max(0, Math.min(1, count / target));
}

const HIFZ_SCORE_MAX = 1000000000;
const HIFZ_SCORE_STAGE_MAX = HIFZ_SCORE_MAX / 10;

let __hifzQuranWordCountCache = null;
const __hifzAyahWordCountCache = new Map();

function getHifzAyahWordCount(ref){
  const safeRef = String(ref || "");
  if (__hifzAyahWordCountCache.has(safeRef)) {
    return __hifzAyahWordCountCache.get(safeRef) || 0;
  }

  let count = 0;
  try{
    const words = (typeof getWords === "function") ? (getWords(safeRef) || []) : [];
    count = words.filter((w) => String(w?.audioUrl || "").trim()).length;
  }catch{
    count = 0;
  }

  __hifzAyahWordCountCache.set(safeRef, count);
  return count;
}

function getHifzQuranWordCount(){
  if (Number.isFinite(__hifzQuranWordCountCache) && __hifzQuranWordCountCache > 0) {
    return __hifzQuranWordCountCache;
  }

  let total = 0;
  try{
    const refs = (typeof getAllRefs === "function") ? (getAllRefs() || []) : [];
    for (const ref of refs) {
      total += getHifzAyahWordCount(ref);
    }
  }catch{
    total = 0;
  }

  __hifzQuranWordCountCache = Math.max(1, total);
  return __hifzQuranWordCountCache;
}

function getHifzScoreValue(){
  const refs = (typeof getAllRefs === "function") ? (getAllRefs() || []) : [];
  if (!refs.length) return 0;

  const totalWords = getHifzQuranWordCount();
  const pointsPerWordPerStage = HIFZ_SCORE_STAGE_MAX / Math.max(1, totalWords);

  let score = 0;

  for (const ref of refs) {
    const wordCount = getHifzAyahWordCount(ref);
    if (!wordCount) continue;

    for (let stage = 1; stage <= 10; stage += 1) {
      const ratio = Number(getHifzProgressRatioForRef(ref, String(stage)) || 0);
      if (ratio <= 0) continue;
      score += wordCount * ratio * pointsPerWordPerStage;
    }
  }

  return Math.max(0, Math.min(HIFZ_SCORE_MAX, Math.round(score)));
}

function formatHifzScore(n){
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(Number(n) || 0)));
}

function refreshAccountHifzScoreUi(){
  const el = document.getElementById("acctHifzScoreValue");
  if (!el) return;

  let inOk = false;
  try { inOk = !!__isLoggedIn?.(); } catch {}

  if (!inOk) {
    el.textContent = `0/${HIFZ_SCORE_MAX}`;
    return;
  }

  const scoreNow = Math.max(0, Math.round(Number(getHifzScoreValue()) || 0));
  el.textContent = `${scoreNow}/${HIFZ_SCORE_MAX}`;
}

window.__refreshAccountHifzScore = refreshAccountHifzScoreUi;

function setHifzResultForRef(ref, stage, result){
  const r = String(ref || "");
  const s = String(stage || hifzStageValue || "1");
  const val = String(result || "").trim().toLowerCase();

  if (!/^\d+:\d+$/.test(r)) return;
  if (!(val === "good" || val === "bad")) return;

  const map = loadHifzResults();
  const row = (map[r] && typeof map[r] === "object") ? { ...map[r] } : {};
  const target = loadHifzRepeatTarget();

  if (val === "good") {
    const stageNum = Math.max(1, Math.min(10, Number(s) || 1));

    for (let i = 1; i <= stageNum; i += 1) {
      const stageId = String(i);
      const prev = (row[stageId] && typeof row[stageId] === "object") ? row[stageId] : {
        state: "neutral",
        goodCount: 0
      };

      row[stageId] = {
        state: "good",
        goodCount: Math.min(target, (Number(prev.goodCount) || 0) + 1)
      };
    }
  } else {
    row[s] = {
      state: "bad",
      goodCount: 0
    };
  }

  map[r] = row;
  saveHifzResults(map);
}

function getHifzBadRefsForStage(stage){
  const s = String(stage || hifzStageValue || "1");
  const map = loadHifzResults();
  const out = [];

  for (const ref of Object.keys(map || {})) {
    if (!/^\d+:\d+$/.test(String(ref || ""))) continue;
    if (getHifzResultForRef(ref, s) !== "bad") continue;
    out.push(String(ref));
  }

  return _sortRefs(out);
}

function getHifzNavigableRefsForCurrentStage(){
  const stage = String(hifzStageValue || "1");

  if (stage === "7" || stage === "10") {
    return _sortRefs(getAllRefs());
  }

  if (stage === "6" || stage === "8" || stage === "9") {
    return _sortRefs(getCurrentSurahRefsForHifz(currentRef));
  }

  return _sortRefs(getStage1TestRefsForCurrentSurah());
}

function buildHifzBadRefsTopbarHtml(){
  const stage = String(hifzStageValue || "1");
  const stageMeta = getHifzStageMeta(stage);
  const refs = getHifzBadRefsForStage(stage);
  const count = refs.length;

  const itemsHtml = refs.length
    ? refs.map((ref) => `
        <button class="hifzBadDropItem" type="button" data-hifz-bad-ref="${ref}" aria-label="Open ${escHifzStageText(ref)}">
          <span class="hifzBadDropItemRef">${escHifzStageText(ref)}</span>
        </button>
      `).join("")
    : `<div class="hifzBadDropEmpty">No ayahs marked as "bad" in ${escHifzStageText(stageMeta.title)}</div>`;

  return `
    <div class="hifzBadDrop" data-hifz-bad-drop>
      <button class="hifzBadDropBtn" type="button" data-hifz-bad-toggle aria-haspopup="dialog" aria-expanded="false" aria-label="Show ayahs marked as bad">
        <span class="hifzBadDropBtnLabel">ayahs marked as "bad"</span>
        <span class="hifzBadDropBtnCount">${count}</span>
        <span class="hifzBadDropBtnArrow" aria-hidden="true">▼</span>
      </button>

      <div class="hifzBadDropMenu" data-hifz-bad-menu>
        <div class="hifzBadDropHead">${escHifzStageText(stageMeta.title)}</div>
        ${itemsHtml}
      </div>
    </div>
  `;
}

function bindHifzBadDropInView(view, onPickRef){
  const scope = view && typeof view.querySelector === "function" ? view : null;
  if (!scope) return;

  const drop = scope.querySelector("[data-hifz-bad-drop]");
  if (!drop || drop._bound) return;
  drop._bound = true;

  const btn = drop.querySelector("[data-hifz-bad-toggle]");

  const close = () => {
    drop.classList.remove("is-open");
    if (btn) btn.setAttribute("aria-expanded", "false");
  };

  const toggle = () => {
    const nextOpen = !drop.classList.contains("is-open");
    drop.classList.toggle("is-open", nextOpen);
    if (btn) btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  };

  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
  }

  drop.addEventListener("click", (e) => {
    const item = e.target.closest("[data-hifz-bad-ref]");
    if (!item) return;

    e.preventDefault();
    e.stopPropagation();

    const ref = String(item.getAttribute("data-hifz-bad-ref") || "");
    if (!/^\d+:\d+$/.test(ref)) return;

    close();
    if (typeof onPickRef === "function") onPickRef(ref);
  });

  if (!document.__hifzBadDropOutsideBound) {
    document.__hifzBadDropOutsideBound = true;

    document.addEventListener("click", (e) => {
      document.querySelectorAll(".hifzBadDrop.is-open").forEach((openDrop) => {
        if (openDrop.contains(e.target)) return;
        openDrop.classList.remove("is-open");
        const openBtn = openDrop.querySelector("[data-hifz-bad-toggle]");
        if (openBtn) openBtn.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".hifzBadDrop.is-open").forEach((openDrop) => {
        openDrop.classList.remove("is-open");
        const openBtn = openDrop.querySelector("[data-hifz-bad-toggle]");
        if (openBtn) openBtn.setAttribute("aria-expanded", "false");
      });
    });
  }
}

function buildHifzBadRangeMessageHtml(ref){
  return `
    <div class="ayahCard ayahMainCard hifzRangeMissCard" data-hifz-range-miss="${escHifzStageText(ref)}">
      <div class="hifzRangeMissInner">
        <div class="hifzRangeMissRef">${escHifzStageText(ref)}</div>
        <div class="hifzRangeMissText">Ayah not in range, adjust the range</div>
      </div>
    </div>
  `;
}



function getStage1TestRefsForCurrentSurah(){
  const ay = getAyah(currentRef);
  const surahNo = ay?.surah || currentSurahInView || 1;
  const refsRaw = (typeof getSuraRefs === "function") ? (getSuraRefs(surahNo) || []) : [];

  const rawRange = String(hifzRangeValue || "1-999").trim();
  const m = rawRange.match(/^(\d+)\s*-\s*(\d+)$/);

  let fromAyah = 1;
  let toAyah = Number(getSuraMeta(surahNo)?.ayahCount || refsRaw.length || 1);

  if (m) {
    fromAyah = Math.max(1, Number(m[1]) || 1);
    toAyah = Math.max(1, Number(m[2]) || fromAyah);
  }

  if (toAyah < fromAyah) {
    const tmp = fromAyah;
    fromAyah = toAyah;
    toAyah = tmp;
  }

  const maxAyah = Number(getSuraMeta(surahNo)?.ayahCount || refsRaw.length || 1);
  fromAyah = Math.min(fromAyah, maxAyah);
  toAyah = Math.min(toAyah, maxAyah);

  return refsRaw.filter((r) => {
    const a = getAyah(r);
    if (!a || a.surah !== surahNo) return false;
    return a.ayah >= fromAyah && a.ayah <= toAyah;
  });
}

function getNextStage1Ref(ref){
  const refs = getStage1TestRefsForCurrentSurah();
  const cur = String(ref || currentRef || "");
  const idx = refs.indexOf(cur);
  if (idx < 0) return refs[0] || cur;
  return refs[idx + 1] || refs[0] || cur;
}

function getNextStage3Ref(ref){
  const refs = getStage1TestRefsForCurrentSurah();
  const cur = String(ref || currentRef || "");

  if (!refs.length) return cur;

  const pool = refs.filter((r) => r !== cur);
  if (!pool.length) return refs[0] || cur;

  return pool[Math.floor(Math.random() * pool.length)] || refs[0] || cur;
}

function getCurrentSurahRefsForHifz(ref){
  const ay = getAyah(ref || currentRef);
  const surahNo = ay?.surah || currentSurahInView || 1;
  return (typeof getSuraRefs === "function") ? (getSuraRefs(surahNo) || []) : [];
}

function getRenderedHifzTrainRefsForActiveView(){
  const activeView = getActiveHifzTrainMaskView();
  if (!activeView) return [];

  const allowedRefs = new Set(
    (getHifzNavigableRefsForCurrentStage() || [])
      .map((r) => String(r || "").trim())
      .filter((r) => isValidHifzTrainRef(r))
  );

  const seen = new Set();

  return Array.from(activeView.querySelectorAll('.mChunk[data-ref]'))
    .map((el) => String(el.getAttribute("data-ref") || "").trim())
    .filter((r) => {
      if (!isValidHifzTrainRef(r)) return false;
      if (allowedRefs.size && !allowedRefs.has(r)) return false;
      if (seen.has(r)) return false;
      seen.add(r);
      return true;
    });
}

function getNextStage5Ref(ref){
  const refs = getStage1TestRefsForCurrentSurah();
  const cur = String(ref || currentRef || "");

  if (!refs.length) return cur;

  const pool = refs.filter((r) => r !== cur);
  if (!pool.length) return refs[0] || cur;

  return pool[Math.floor(Math.random() * pool.length)] || refs[0] || cur;
}

function getNextStage6Ref(ref){
  const refs = getCurrentSurahRefsForHifz(ref);
  const cur = String(ref || currentRef || "");

  if (!refs.length) return cur;

  const pool = refs.filter((r) => r !== cur);
  if (!pool.length) return refs[0] || cur;

  return pool[Math.floor(Math.random() * pool.length)] || refs[0] || cur;
}

function getNextStage7Ref(ref){
  const refs = getAllRefs();
  const cur = String(ref || currentRef || "");

  if (!refs.length) return cur;

  const pool = refs.filter((r) => r !== cur);
  if (!pool.length) return refs[0] || cur;

  return pool[Math.floor(Math.random() * pool.length)] || refs[0] || cur;
}

function getNextStage8Ref(ref){
  const renderedRefs = getRenderedHifzTrainRefsForActiveView();
  const fallbackRefs = getCurrentSurahRefsForHifz(ref);
  const refs = renderedRefs.length ? renderedRefs : fallbackRefs;
  const cur = String(ref || currentRef || "");
  const idx = refs.indexOf(cur);

  if (idx < 0) {
    const fallbackIdx = fallbackRefs.indexOf(cur);
    if (fallbackIdx >= 0) return fallbackRefs[fallbackIdx + 1] || fallbackRefs[0] || cur;
    return refs[0] || cur;
  }

  return refs[idx + 1] || refs[0] || cur;
}

function getNextStage9Ref(ref){
  const renderedRefs = getRenderedHifzTrainRefsForActiveView();
  const fallbackRefs = getCurrentSurahRefsForHifz(ref);
  const refs = renderedRefs.length ? renderedRefs : fallbackRefs;
  const cur = String(ref || currentRef || "");
  const idx = refs.indexOf(cur);

  if (idx < 0) {
    const fallbackIdx = fallbackRefs.indexOf(cur);
    if (fallbackIdx >= 0) return fallbackRefs[fallbackIdx + 1] || fallbackRefs[0] || cur;
    return refs[0] || cur;
  }

  return refs[idx + 1] || refs[0] || cur;
}

function getNextStage10Ref(ref){
  const refs = getAllRefs();
  const cur = String(ref || currentRef || "");
  const idx = refs.indexOf(cur);
  if (idx < 0) return refs[0] || cur;
  return refs[idx + 1] || refs[0] || cur;
}

function isHifzSingleFocusStage(stage){
  const s = String(stage || "");
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].includes(s);
}

function isHifzRangeLockedStage(stage){
  const s = String(stage || "");
  return s === "6" || s === "7" || s === "8" || s === "9" || s === "10";
}

function getHifzRangeUiValueForStage(stage){
  const s = String(stage || "");

  if (s === "7" || s === "10") return "all of quran";
  if (s === "6" || s === "8" || s === "9") return "all of surah";

  return String(hifzRangeValue || "5-10");
}

function isHifzStageWithoutRenderedRangeUi(stage){
  const s = String(stage || "");
  return s === "6" || s === "7" || s === "8" || s === "9" || s === "10";
}

function syncHifzRangeInputUi(input){
  if (!input) return;

  const stage = String(hifzStageValue || "1");
  const locked = isHifzRangeLockedStage(stage);
  const uiValue = getHifzRangeUiValueForStage(stage);

  input.value = uiValue;
  input.placeholder = uiValue;
  input.readOnly = locked;
  input.setAttribute("aria-readonly", locked ? "true" : "false");
  input.inputMode = locked ? "none" : "text";
}

function getNextHifzFocusRef(ref){
  const stage = String(hifzStageValue || "1");

  if (stage === "10") {
    return getNextStage10Ref(ref);
  }

  if (stage === "7") {
    return getNextStage7Ref(ref);
  }

  if (stage === "9") {
    return getNextStage9Ref(ref);
  }

  if (stage === "8") {
    return getNextStage8Ref(ref);
  }

  if (stage === "6") {
    return getNextStage6Ref(ref);
  }

  if (stage === "5") {
    return getNextStage5Ref(ref);
  }

  if (stage === "3" || stage === "4") {
    return getNextStage3Ref(ref);
  }

  return getNextStage1Ref(ref);
}

const __hifzRevealMap = Object.create(null);

function isHifzAyahRevealed(ref){
  return !!__hifzRevealMap[String(ref || "")];
}

function setHifzAyahRevealed(ref, on = true){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;
  __hifzRevealMap[r] = !!on;
}

const __hifzTrainMaskRevealMap = Object.create(null);
const __hifzTrainMaskHoverTimers = Object.create(null);
let __hifzTrainMaskOn = false;
let __hifzTrainMaskPendingRateRef = "";
let __hifzTrainMaskSpaceCooldownUntil = 0;

function isValidHifzTrainRef(ref){
  return /^\d+:\d+$/.test(String(ref || "").trim());
}

function clearHifzTrainMaskHoverTimer(ref){
  const r = String(ref || "").trim();
  const t = __hifzTrainMaskHoverTimers[r];
  if (t) {
    clearTimeout(t);
    delete __hifzTrainMaskHoverTimers[r];
  }
}

function clearAllHifzTrainMaskHoverTimers(){
  Object.keys(__hifzTrainMaskHoverTimers).forEach((ref) => {
    clearHifzTrainMaskHoverTimer(ref);
  });
}

function clearHifzTrainMaskReveals(){
  Object.keys(__hifzTrainMaskRevealMap).forEach((ref) => {
    delete __hifzTrainMaskRevealMap[ref];
  });
}

function getHifzTrainMaskPendingRateRef(){
  return String(__hifzTrainMaskPendingRateRef || "");
}

function setHifzTrainMaskPendingRateRef(ref = ""){
  const r = String(ref || "").trim();
  __hifzTrainMaskPendingRateRef = isValidHifzTrainRef(r) ? r : "";
}

function isHifzTrainMaskOn(){
  return !!__hifzTrainMaskOn;
}

function isHifzTrainWriteStage(stage = hifzStageValue){
  return ["8", "9", "10"].includes(String(stage || hifzStageValue || "1"));
}

function isHifzTrainMaskRevealed(ref){
  return !!__hifzTrainMaskRevealMap[String(ref || "").trim()];
}

function isHifzTrainMaskRatePending(ref){
  return getHifzTrainMaskPendingRateRef() === String(ref || "").trim();
}

function buildHifzTrainMaskRateInnerHtml(){
  return `
    <span class="mTrainRateSplit" aria-hidden="true">
      <span class="mTrainRateHalf is-bad" data-rate="bad">1</span>
      <span class="mTrainRateHalf is-good" data-rate="good">3</span>
    </span>
  `;
}

function getActiveHifzTrainMaskView(){
  const mViews = Array.from(document.querySelectorAll(".mView"));
  return mViews.find((el) => el.offsetParent !== null) || null;
}

function focusHifzTrainMaskRefInView(view, ref, { updateUrl = false, scroll = false, behavior = "auto" } = {}){
  const host = view && typeof view.querySelectorAll === "function" ? view : getActiveHifzTrainMaskView();
  const r = String(ref || "").trim();
  if (!host || !isValidHifzTrainRef(r)) return;

  if (scroll && isHifzTrainWriteStage() && isHifzTrainMaskOn() && isHifzTrainMaskRatePending(r)) {
    scroll = false;
  }

  host.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
  const btn = host.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
  if (btn) {
    btn.classList.add("is-focus");

    if (scroll) {
      try {
        const hostRect = host.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const hostHeight = Math.max(0, Number(host.clientHeight) || Number(hostRect.height) || 0);
        const insetY = Math.min(96, Math.max(24, hostHeight * 0.12));
        const canMeasure = hostRect.height > 0 && btnRect.height > 0;

        const alreadyVisible =
          canMeasure &&
          btnRect.bottom > hostRect.top &&
          btnRect.top < hostRect.bottom;

        const alreadyComfortablyVisible =
          canMeasure &&
          btnRect.top >= (hostRect.top + insetY) &&
          btnRect.bottom <= (hostRect.bottom - insetY);

        const autoBusy =
          typeof window.__qrAutoScrollActiveUntil === "number" &&
          Date.now() < window.__qrAutoScrollActiveUntil;

        if (!alreadyComfortablyVisible) {
          if (!(autoBusy && alreadyVisible)) {
            const wantsSmooth = behavior === "smooth" && !autoBusy;
            const scrollBehavior = wantsSmooth ? "smooth" : "instant";
            __qrScrollElementToCenter(host, btn, { behavior: scrollBehavior });
          }
        }
      } catch {}
    }
  }

  currentRef = r;
  if (updateUrl) setRefToHash(r);
}

function syncHifzTrainMaskDom(root = document){
  const host = root && typeof root.querySelectorAll === "function" ? root : document;
  const firstChunk = host.querySelector('.mChunk[data-train-first="true"][data-ref]');
  const firstRef = String(firstChunk?.getAttribute("data-ref") || "");
  const stageNow = String(hifzStageValue || "1");
  const writeStage = isHifzTrainWriteStage(stageNow);

  const orderedRefs = Array.from(host.querySelectorAll(".mChunk[data-ref]"))
    .map((chunk) => String(chunk.getAttribute("data-ref") || ""))
    .filter((ref) => isValidHifzTrainRef(ref));

  const safeCurrentRef = isValidHifzTrainRef(currentRef) ? String(currentRef).trim() : "";
  const trainPendingRef = String(getHifzTrainMaskPendingRateRef() || "");
  let nextTargetRef = "";

  if (!writeStage && isHifzTrainMaskOn() && !trainPendingRef) {
    const hiddenRefs = orderedRefs.filter((ref) => !isHifzTrainMaskRevealed(ref));

    if (hiddenRefs.length) {
      const currentIdx = safeCurrentRef ? orderedRefs.indexOf(safeCurrentRef) : -1;

      if (currentIdx >= 0) {
        for (let i = currentIdx + 1; i < orderedRefs.length; i += 1) {
          const candidate = orderedRefs[i];
          if (!isHifzTrainMaskRevealed(candidate)) {
            nextTargetRef = candidate;
            break;
          }
        }

        if (!nextTargetRef) {
          for (let i = 0; i < currentIdx; i += 1) {
            const candidate = orderedRefs[i];
            if (!isHifzTrainMaskRevealed(candidate)) {
              nextTargetRef = candidate;
              break;
            }
          }
        }
      }

      if (!nextTargetRef) {
        nextTargetRef = hiddenRefs[0] || "";
      }
    }
  }

  host.querySelectorAll(".mChunk[data-ref]").forEach((chunk) => {
    const ref = String(chunk.getAttribute("data-ref") || "");
    if (!isValidHifzTrainRef(ref)) return;

    const hidden = isHifzTrainMaskOn() && !isHifzTrainMaskRevealed(ref);
    const firstHint = hidden && ref === firstRef;
    const pendingWrite = writeStage && isHifzTrainMaskOn() && !hidden && isHifzTrainMaskRatePending(ref);
    const pendingOpen = !pendingWrite && isHifzTrainMaskOn() && !hidden && isHifzTrainMaskRatePending(ref);
    const nextTarget = !writeStage && hidden && ref === nextTargetRef;

    chunk.classList.toggle("is-train-hidden", hidden);
    chunk.classList.toggle("is-train-first-hint", firstHint);
    chunk.classList.toggle("is-train-writing", pendingWrite);
    chunk.classList.toggle("is-train-next-target", nextTarget);

    const noBtn = chunk.querySelector(".mNo[data-ref]");
    if (!noBtn) return;

    const ratio = Math.max(0, Math.min(1, Number(getHifzProgressRatioForRef(ref, stageNow) || 0)));
    const result = String(getHifzResultForRef(ref, stageNow) || "");

    noBtn.style.setProperty("--hifz-ring", String(ratio));
    noBtn.classList.remove("is-hifz-bad", "is-hifz-progress", "is-hifz-mastered");

    if (result === "bad") {
      noBtn.classList.add("is-hifz-bad");
    } else if (ratio >= 1) {
      noBtn.classList.add("is-hifz-mastered");
    } else if (ratio > 0) {
      noBtn.classList.add("is-hifz-progress");
    }

    noBtn.classList.toggle("is-train-rate-open", pendingOpen);
    noBtn.classList.toggle("is-train-next-target", nextTarget);
    noBtn.setAttribute("data-train-state", pendingWrite ? "writing" : (pendingOpen ? "rating" : (hidden ? "hidden" : "normal")));

    if (pendingOpen) {
      if (!noBtn.querySelector(".mTrainRateSplit")) {
        noBtn.innerHTML = buildHifzTrainMaskRateInnerHtml();
      }
      noBtn.setAttribute("title", "rate with 1 bad and 3 good how good you remembered it");
      noBtn.setAttribute("aria-label", `Rate ${ref} with 1 bad and 3 good`);
    } else {
      const no = String(noBtn.getAttribute("data-ayah-no") || "");
      if (noBtn.querySelector(".mTrainRateSplit")) {
        noBtn.textContent = no;
      }
      noBtn.setAttribute(
        "title",
        pendingWrite
          ? "write the ayah inside this ayah box"
          : (firstHint ? "click/press space or hover to reveal ayah" : `Play ${ref}`)
      );
      noBtn.setAttribute(
        "aria-label",
        pendingWrite
          ? `Write ${ref} inside this ayah box`
          : (hidden ? `Reveal ${ref}` : `Play ${ref}`)
      );
    }
  });
}

function setHifzTrainMaskOn(on = true){
  const next = !!on;
  const pendingRef = String(getHifzTrainMaskPendingRateRef() || "");

  clearAllHifzTrainMaskHoverTimers();
  setHifzTrainMaskPendingRateRef("");

  if (!next && isHifzTrainWriteStage() && /^\d+:\d+$/.test(pendingRef)) {
    resetHifzWriteStateForRef(pendingRef);
    delete __hifzWriteResultFlashMap[pendingRef];
  }

  if (next) {
    clearHifzTrainMaskReveals(); // ✅ immer wieder von vorne
  }

  __hifzTrainMaskOn = next;
}

function revealHifzTrainMaskRef(ref){
  const r = String(ref || "").trim();
  if (!isValidHifzTrainRef(r)) return;
  if (!isHifzTrainMaskOn()) return;

  clearHifzTrainMaskHoverTimer(r);
  __hifzTrainMaskRevealMap[r] = true;
  setHifzTrainMaskPendingRateRef(r);

  if (isHifzTrainWriteStage()) {
    const activeView = getActiveHifzTrainMaskView();
    const keepScrollTop = Math.max(0, Number(activeView?.scrollTop) || 0);

    resetHifzWriteStateForRef(r);
    delete __hifzWriteResultFlashMap[r];
    suppressNextMushafCenterScroll(320);
    renderCurrent(r);

    const restoreScroll = () => {
      const nextView = getActiveHifzTrainMaskView();
      if (!nextView) return false;
      nextView.scrollTop = keepScrollTop;
      return true;
    };

    restoreScroll();
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(() => {
        restoreScroll();
        setTimeout(() => {
          restoreScroll();
        }, 0);
      });
    });
    return;
  }

  syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
}

function coverHifzTrainMaskRef(ref){
  const r = String(ref || "").trim();
  if (!isValidHifzTrainRef(r)) return;
  if (!isHifzTrainMaskOn()) return;
  if (!isHifzTrainMaskRevealed(r)) return;

  clearHifzTrainMaskHoverTimer(r);
  delete __hifzTrainMaskRevealMap[r];

  if (isHifzTrainMaskRatePending(r)) {
    setHifzTrainMaskPendingRateRef("");
  }

  if (isHifzTrainWriteStage()) {
    resetHifzWriteStateForRef(r);
    delete __hifzWriteResultFlashMap[r];
    suppressNextMushafCenterScroll(320);
    renderCurrent(String(currentRef || r));
    return;
  }

  syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
}

function scheduleHifzTrainMaskReveal(ref, delay = 1000){
  const r = String(ref || "").trim();
  if (!isValidHifzTrainRef(r)) return;
  if (!isHifzTrainMaskOn()) return;
  if (isHifzTrainMaskRevealed(r)) return;

  clearHifzTrainMaskHoverTimer(r);

  __hifzTrainMaskHoverTimers[r] = setTimeout(() => {
    delete __hifzTrainMaskHoverTimers[r];
    revealHifzTrainMaskRef(r);
  }, Math.max(0, Number(delay) || 0));
}

function revealCurrentOrFirstHiddenTrainAyah(view){
  const host = view && typeof view.querySelector === "function" ? view : getActiveHifzTrainMaskView();
  if (!host) return false;

  const hasAnyReveal = Object.keys(__hifzTrainMaskRevealMap).length > 0;
  const safeCurrent = isValidHifzTrainRef(currentRef) ? String(currentRef) : "";

  const currentHidden = (hasAnyReveal && safeCurrent)
    ? host.querySelector(`.mChunk.is-train-hidden[data-ref="${CSS.escape(safeCurrent)}"]`)
    : null;

  const fallbackHidden = host.querySelector(".mChunk.is-train-hidden[data-ref]");
  const chunk = currentHidden || fallbackHidden;
  if (!chunk) return false;

  const r = String(chunk.getAttribute("data-ref") || "");
  if (!isValidHifzTrainRef(r)) return false;

  revealHifzTrainMaskRef(r);
  focusHifzTrainMaskRefInView(host, r, { updateUrl: true, scroll: true, behavior: "smooth" });
  return true;
}

function rateHifzTrainMaskRef(ref, result){
  const r = String(ref || "").trim();
  const val = String(result || "").trim().toLowerCase();
  if (!isValidHifzTrainRef(r)) return;
  if (!(val === "good" || val === "bad")) return;

  setHifzResultForRef(r, String(hifzStageValue || "1"), val);

  if (isHifzTrainMaskRatePending(r)) {
    setHifzTrainMaskPendingRateRef("");
  }

  clearHifzTrainMaskHoverTimer(r);

  if (isHifzTrainWriteStage()) {
    const st = getHifzWriteStateForRef(r);
    st.cursor = 0;
    st.wrongCount = 0;
    st.flashGoodTokenIndex = -1;
    st.flashBadChar = "";
    st.flashBadTokenIndex = -1;
    st.showFullErrorPreview = false;
    st.flashTick = 0;
    st.lockUntil = 0;
    st.navToken = 0;
    delete __hifzWriteResultFlashMap[r];
  }
}

const __hifzWriteStateMap = Object.create(null);
let __hifzLastWrongRevealRef = "";

function stripArabicMarksForHifzWrite(text){
  return String(text || "")
    .replace(/[۞۩]/g, "")
    .replace(/[ۖۗۘۙۚۛۜ۝]/g, "")
    .replace(/[،؛,.!؟:;"'«»()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isArabicWriteCombiningMark(ch){
  return /[\u064B-\u065F\u0670\u06D6-\u06ED]/.test(String(ch || ""));
}

function segmentArabicWriteClusters(text){
  const out = [];
  let current = "";

  for (const ch of Array.from(String(text || ""))) {
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      out.push(" ");
      continue;
    }

    if (ch === "ـ") {
      continue;
    }

    if (isArabicWriteCombiningMark(ch)) {
      if (current) {
        current += ch;
      } else if (out.length && out[out.length - 1] !== " ") {
        out[out.length - 1] += ch;
      }
      continue;
    }

    if (current) {
      out.push(current);
    }
    current = ch;
  }

  if (current) {
    out.push(current);
  }

  return out;
}

function normalizeArabicWriteCompareChar(ch){
  const raw = String(ch || "");

  if (!raw) return "";

  if (/\s/.test(raw)) {
    return " ";
  }

  return raw
    .replace(/[ـ]/g, "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .trim();
}

function buildHifzWriteModelForRef(ref){
  const a = getAyah(ref);
  const raw = stripArabicMarksForHifzWrite(
    a?.textAr ||
    a?.textUthmani ||
    a?.uthmani ||
    a?.text ||
    ""
  );

  const sourceTokens = segmentArabicWriteClusters(raw);
  const tokens = [];

  for (const token of sourceTokens) {
    if (token === " ") {
      tokens.push({
        char: " ",
        expected: " ",
        isSpace: true
      });
      continue;
    }

    const expected = normalizeArabicWriteCompareChar(token);
    if (!expected) continue;

    tokens.push({
      char: token,
      expected,
      isSpace: false
    });
  }

  return {
    raw,
    tokens,
    targetChars: tokens.map((t) => t.expected),
    displayText: tokens.map((t) => t.char).join("")
  };
}

function getHifzWriteStateForRef(ref){
  const r = String(ref || "");

  if (!/^\d+:\d+$/.test(r)) {
    return {
      cursor: 0,
      wrongCount: 0,
      flashGoodTokenIndex: -1,
      flashBadChar: "",
      flashBadTokenIndex: -1,
      lastWrongChar: "",
      lastWrongTokenIndex: -1,
      showFullErrorPreview: false,
      flashTick: 0,
      lockUntil: 0,
      navToken: 0
    };
  }

  if (__hifzWriteStateMap[r] && typeof __hifzWriteStateMap[r] === "object") {
    return __hifzWriteStateMap[r];
  }

  __hifzWriteStateMap[r] = {
    cursor: 0,
    wrongCount: 0,
    flashGoodTokenIndex: -1,
    flashBadChar: "",
    flashBadTokenIndex: -1,
    lastWrongChar: "",
    lastWrongTokenIndex: -1,
    showFullErrorPreview: false,
    flashTick: 0,
    lockUntil: 0,
    navToken: 0
  };

  return __hifzWriteStateMap[r];
}
function clearHifzWriteFlashForRef(ref){
  const st = getHifzWriteStateForRef(ref);
  st.flashGoodTokenIndex = -1;
  st.flashBadChar = "";
  st.flashBadTokenIndex = -1;
  st.showFullErrorPreview = false;
}

function resetHifzWriteStateForRef(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;
  delete __hifzWriteStateMap[r];
}

function consumeHifzWriteInput(ref, rawInput){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return { status: "noop" };
  if (!["8", "9", "10"].includes(String(hifzStageValue || "1"))) return { status: "noop" };

  const model = buildHifzWriteModelForRef(r);
  if (!model.targetChars.length) return { status: "noop" };

  const state = getHifzWriteStateForRef(r);
  const units = segmentArabicWriteClusters(String(rawInput || ""));
  let progressed = false;

  for (const unit of units) {
    const normalized = normalizeArabicWriteCompareChar(unit);
    if (!normalized) continue;

    const expected = String(model.targetChars[state.cursor] || "");
    if (!expected) {
      return { status: "good" };
    }

    if (normalized === expected) {
      const tokenIndex = Number(state.cursor || 0);
      state.cursor = Math.min(model.targetChars.length, tokenIndex + 1);
      state.flashGoodTokenIndex = tokenIndex;
      state.flashBadChar = "";
      state.flashBadTokenIndex = -1;
      state.showFullErrorPreview = false;
      progressed = true;
      continue;
    }

    state.wrongCount = Math.max(0, Number(state.wrongCount) || 0) + 1;
    state.flashBadChar = /\s/.test(unit) ? " " : unit;
    state.flashBadTokenIndex = Number(state.cursor || 0);
    state.lastWrongChar = /\s/.test(unit) ? " " : unit;
    state.lastWrongTokenIndex = Number(state.cursor || 0);
    state.flashGoodTokenIndex = -1;
    state.showFullErrorPreview = state.wrongCount >= 2;
    __hifzLastWrongRevealRef = r;

    return {
      status: state.wrongCount >= 2 ? "bad" : "wrong",
      wrongCount: state.wrongCount,
      wrongChar: unit
    };
  }

  if (state.cursor >= model.targetChars.length) {
    return { status: "good" };
  }

  return { status: progressed ? "progress" : "noop" };
}
function getPrevStage1Ref(ref){
  const cur = String(ref || currentRef || "");
  const a = getAyah(cur);

  if (a) {
    const surahNo = Number(a.surah || currentSurahInView || 0);
    const ayahNo = Number(a.ayah || 0);

    if (surahNo >= 1 && ayahNo > 1) {
      const directPrev = `${surahNo}:${ayahNo - 1}`;
      const prevAyah = getAyah(directPrev);

      if (prevAyah && Number(prevAyah.surah || 0) === surahNo) {
        return directPrev;
      }
    }
  }

  const refs = getStage1TestRefsForCurrentSurah();
  const idx = refs.indexOf(cur);
  if (idx > 0) return refs[idx - 1] || "";

  return "";
}

function getFirstArabicWordForRef(ref){
  try{
    const a = getAyah(ref);
    const raw = String(
      a?.textAr ||
      a?.textUthmani ||
      a?.uthmani ||
      a?.text ||
      ""
    ).trim();

    if (raw) {
      const cleaned = raw
        .replace(/^[۞۩]+/g, "")
        .replace(/[ۖۗۘۙۚۛۜ۝۞]+/g, "")
        .trim();

      const first = cleaned.split(/\s+/)[0] || "";
      if (first) return first;
    }
  }catch{}

  try{
    const words = getWords(ref) || [];
    let buf = "";

    for (const w of words){
      const ar = String(w?.ar || "").trim();
      if (!ar) continue;

      if (!buf) {
        buf = ar;
        continue;
      }

      if (/^[\u064B-\u065F\u0670\u06D6-\u06ED]+$/.test(ar)) {
        buf += ar;
        continue;
      }

      break;
    }

    return buf.trim();
  }catch{}

  return "";
}

function buildHifzRecallActionsHtml(a, esc){
  const ref = String(a?.ref || "");
  const result = getHifzResultForRef(ref, hifzStageValue);

  return `
    <div class="hifzRecallBox" data-hifz-ref="${ref}">
      <div class="hifzRecallTitle">How did you remember it?</div>

      <div class="hifzRecallActions">
        <button
          class="hifzRecallBtn hifzRecallBad${result === "bad" ? " is-active" : ""}"
          type="button"
          data-hifz-mark="bad"
          data-hifz-ref="${ref}"
          aria-label="Mark ${esc(ref)} as bad">
          <span class="hifzRecallBtnMain">bad</span>
          <span class="hifzRecallBtnHint" aria-hidden="true">
            <span class="hifzRecallBtnKey">1</span>
          </span>
        </button>

        <button
          class="hifzRecallBtn hifzRecallGood${result === "good" ? " is-active" : ""}"
          type="button"
          data-hifz-mark="good"
          data-hifz-ref="${ref}"
          aria-label="Mark ${esc(ref)} as good">
          <span class="hifzRecallBtnMain">good</span>
          <span class="hifzRecallBtnHint" aria-hidden="true">
            <span class="hifzRecallBtnKey">3</span>
          </span>
        </button>
      </div>
    </div>
  `;
}

function buildHifzAyahHeaderHtml(a, mp3, esc){
  const ref = String(a?.ref || "");
  const stage = String(hifzStageValue || "1");
  const ratio = getHifzProgressRatioForRef(ref, stage);
  const result = getHifzResultForRef(ref, stage);
  const bmSetLocal = new Set(getActiveFavRefs());
  const progressPct = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  const progressAttr = `style="--hifz-progress:${ratio};"`;
  const stateClass =
    result === "bad"
      ? " is-hifz-bad"
      : (ratio >= 1 ? " is-hifz-mastered" : (ratio > 0 ? " is-hifz-progress" : ""));

  return `
    <div class="ayahHeaderRow hifzAyahHeaderRow${stateClass}" data-hifz-header="${ref}" ${progressAttr}>
      <div class="hifzAyahProgress" data-progress-label="${progressPct}%"></div>

      <div class="ayahRefRow">
        <button class="ayahBtn ayahPlay playAyah" type="button" data-audio="${mp3}" aria-label="Play Ayah"></button>
<button class="ayahBtn favContinuePlayBtn" type="button" data-ref="${ref}" aria-label="Continue Favorites from ${ref}" title="Continue from here">⟲</button>
        <div class="ayahRef">${ref}</div>

        <button class="ayahBtn ayahBm${bmSetLocal.has(ref) ? " is-on" : ""}"
          type="button"
          data-bm="${ref}"
          aria-label="Bookmark ${ref}"
          title="Bookmark"></button>

<button class="ayahCopy ayahCopyBtn"
  type="button"
  data-copy="${ref}"
  aria-label="Copy ${ref}"
  title="Copy">
  <svg class="copyIcon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
    <rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
  </svg>
</button>

<button class="ayahNote ayahNoteBtn"
  type="button"
  data-note="${ref}"
  aria-label="Notes ${ref}"
  title="Notes">
  <svg class="noteIcon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h8a2 2 0 0 1 2 2v14l-6-3-6 3V5a2 2 0 0 1 2-2z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M9 7h6M9 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
</button>

<button class="ayahContinueBtn"
  type="button"
  data-continue="${ref}"
  data-surah="${a.surah}"
  data-ayah="${a.ayah}"
  aria-label="Continue ${ref}"
  title="Continue">
  <span class="ayahContinueIcon" aria-hidden="true">▶</span>
  <span class="ayahContinueText">continue</span>
</button>
      </div>

      <div class="ayahHeaderRight"></div>
    </div>
  `;
}

const __hifzWriteResultFlashMap = Object.create(null);

function buildHifzWriteStageHtml(a, esc){
  const ref = String(a?.ref || "");
  const stage = String(hifzStageValue || "1");
  const goodCount = getHifzGoodCountForRef(ref, stage);
  const repeatTarget = loadHifzRepeatTarget();
  const stageMeta = HIFZ_STAGE_META[String(stage)] || {};
  const wantsPrevAyahHelper = /Previous ayah/i.test(String(stageMeta.assist || ""));

  const prevRefForHelper = wantsPrevAyahHelper ? getPrevStage1Ref(ref) : "";
  const prevAyahForHelper = prevRefForHelper ? getAyah(prevRefForHelper) : null;
  const prevWordsHtmlForHelper = prevAyahForHelper
    ? buildWordSpans({ ...prevAyahForHelper, ayahNo: prevAyahForHelper.ayah })
    : "";
  const prevTranslationsHtmlForHelper = prevAyahForHelper
    ? buildAyahTranslationsHtml(prevAyahForHelper, esc)
    : "";

  const prevLabelText = prevRefForHelper
    ? `Previous ayah ${esc(prevRefForHelper)}`
    : "Previous ayah";

  const currentLabelText = `Current ayah ${esc(ref)}`;

  const model = buildHifzWriteModelForRef(ref);
  const writeState = getHifzWriteStateForRef(ref);
  const visibleTokenCount = Math.max(0, Math.min(model.targetChars.length, Number(writeState.cursor) || 0));
  const flashGoodTokenIndex = Number(writeState.flashGoodTokenIndex);
  const flashBadTokenIndex = Number(writeState.flashBadTokenIndex);
  const badChar = String(writeState.flashBadChar || "");
  const persistentBadChar = String(writeState.lastWrongChar || "");
  const persistentBadTokenIndex = Number(writeState.lastWrongTokenIndex);
  const hasPersistentBad = !!persistentBadChar && persistentBadTokenIndex >= 0;
  const showFullErrorPreview = !!writeState.showFullErrorPreview && !!badChar;
  const resultFlash = String(__hifzWriteResultFlashMap[ref] || "");
  const safeInputId = `hifzWriteInput-${ref.replace(/:/g, "-")}`;
  const fullWriteText = String(model.displayText || "");

  const buildWrongStackHtml = (token, wrongChar) => {
    if (!token) return "";

    const baseHtml = token.isSpace
      ? `<span class="hifzWriteErrorStackBase is-space" aria-hidden="true">&nbsp;</span>`
      : `<span class="hifzWriteErrorStackBase">${esc(token.char)}</span>`;

    const overlayHtml = /\s/.test(wrongChar)
      ? `<span class="hifzWriteTextErrorInline is-space" aria-hidden="true">&nbsp;</span>`
      : `<span class="hifzWriteTextErrorInline">${esc(wrongChar)}</span>`;

    return `<span class="hifzWriteErrorStack${token.isSpace ? " is-space" : ""}">${baseHtml}${overlayHtml}</span>`;
  };

  let revealHtml = "";

  if (showFullErrorPreview) {
    for (let i = 0; i < model.tokens.length; i += 1) {
      const token = model.tokens[i];
      if (!token) continue;

      if (i === flashBadTokenIndex && badChar) {
        revealHtml += buildWrongStackHtml(token, badChar);
        continue;
      }

      if (i === persistentBadTokenIndex && hasPersistentBad) {
        revealHtml += buildWrongStackHtml(token, persistentBadChar);
        continue;
      }

      revealHtml += esc(token.char);
    }
  } else {
    const revealedParts = [];

    for (let i = 0; i < visibleTokenCount; i += 1) {
      const token = model.tokens[i];
      if (!token) continue;

      if (i === persistentBadTokenIndex && hasPersistentBad) {
        revealedParts.push(buildWrongStackHtml(token, persistentBadChar));
        continue;
      }

      if (i === flashGoodTokenIndex) {
        revealedParts.push(
          token.isSpace
            ? `<span class="hifzWriteTextFlash is-space" aria-hidden="true">&nbsp;</span>`
            : `<span class="hifzWriteTextFlash">${esc(token.char)}</span>`
        );
        continue;
      }

      revealedParts.push(esc(token.char));
    }

    if (hasPersistentBad && persistentBadTokenIndex === visibleTokenCount) {
      const token = model.tokens[visibleTokenCount];
      if (token) {
        revealedParts.push(buildWrongStackHtml(token, persistentBadChar));
      }
    }

    const caretHtml =
      visibleTokenCount < model.tokens.length && !resultFlash
        ? `<span class="hifzWriteCaret" aria-hidden="true"></span>`
        : "";

    revealHtml = `${revealedParts.join("")}${caretHtml}`;
  }

  const hintHtml =
    visibleTokenCount === 0 && !badChar && !persistentBadChar && !resultFlash
      ? `<span class="hifzWriteInputHint">Tap here and write in Arabic</span>`
      : "";

  const wrongHtml = "";

  const resultBadgeHtml =
    resultFlash === "good"
      ? `<span class="hifzWriteResultBadgeInline is-good">Correct</span>`
      : resultFlash === "bad"
          ? `<span class="hifzWriteResultBadgeInline is-bad">Bad</span>`
          : "";

  return `
    ${prevWordsHtmlForHelper ? `
      <div class="hifzStage1PrevLabel">${prevLabelText}</div>
      <div class="ayahText">${prevWordsHtmlForHelper}</div>
      ${prevTranslationsHtmlForHelper}
    ` : ""}

    <div class="hifzStage1FocusLabel">${currentLabelText}</div>

    <div class="hifzWriteStageBox">
      <div
        class="hifzWriteInputShell${badChar ? " is-flash-bad" : ""}${resultFlash === "good" ? " is-result-good" : ""}${resultFlash === "bad" ? " is-result-bad" : ""}"
        data-hifz-write-shell="${ref}"
        data-hifz-write-stage="${stage}"
        aria-label="Write ${esc(ref)} in Arabic">
        <input
          class="hifzWriteInput"
          id="${safeInputId}"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          dir="rtl"
          lang="ar"
          enterkeyhint="done"
          data-hifz-write-input="${ref}"
          aria-label="Write ${esc(ref)} in Arabic"
          placeholder=" ">

        <div class="hifzWriteInputView" aria-hidden="true">
          <span class="hifzWriteTextGhost">${esc(fullWriteText)}</span>
          <span class="hifzWriteTextReveal">${revealHtml}</span>
          ${hintHtml}
          ${wrongHtml}
        </div>
      </div>
    </div>

    <div class="hifzWriteMetaRow">
      <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
      ${resultBadgeHtml}
    </div>
  `;
}

function buildHifzAyahBodyHtml(a, wordsHtml, esc){
  const ref = String(a?.ref || "");
  const stage = String(hifzStageValue || "1");
  const goodCount = getHifzGoodCountForRef(ref, stage);
  const repeatTarget = loadHifzRepeatTarget();

  const progressTop = `
    <div class="hifzAyahBody" data-hifz-body="${ref}">
      <div class="hifzAyahInner">
  `;

  const progressBottom = `
      </div>
    </div>
  `;

  if (stage === "8" || stage === "9" || stage === "10") {
    return `
      ${progressTop}
        ${buildHifzWriteStageHtml(a, esc)}
      ${progressBottom}
    `;
  }

  const stageMeta = HIFZ_STAGE_META[String(stage)] || {};
  const wantsPrevAyahHelper = /Previous ayah/i.test(String(stageMeta.assist || ""));
  const focusRefForHelper = String(currentRef || ref || "");
  const prevRefForHelper = wantsPrevAyahHelper ? getPrevStage1Ref(focusRefForHelper) : "";
  const prevAyahForHelper = prevRefForHelper ? getAyah(prevRefForHelper) : null;
  const prevWordsHtmlForHelper = prevAyahForHelper
    ? buildWordSpans({ ...prevAyahForHelper, ayahNo: prevAyahForHelper.ayah })
    : "";
  const prevTranslationsHtmlForHelper = prevAyahForHelper
    ? buildAyahTranslationsHtml(prevAyahForHelper, esc)
    : "";
  const prevHelperLabelText = prevRefForHelper
    ? `Previous ayah ${esc(prevRefForHelper)}`
    : "Previous ayah";

  const isSingleFocusStage = isHifzSingleFocusStage(stage);

  if (!isSingleFocusStage) {
    return `
      ${progressTop}
        ${(ref === focusRefForHelper && prevWordsHtmlForHelper) ? `
        <div class="hifzStage1PrevLabel">${prevHelperLabelText}</div>
        <div class="ayahText">${prevWordsHtmlForHelper}</div>
        ${prevTranslationsHtmlForHelper}
        ` : ""}

        <div class="ayahText">${wordsHtml}</div>
        ${buildAyahTranslationsHtml(a, esc)}
        ${buildHifzRecallActionsHtml(a, esc)}
        <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
      ${progressBottom}
    `;
  }

  const focusRef = String(currentRef || "");
  const prevRef = getPrevStage1Ref(focusRef);
  const isFocus = ref === focusRef;
  const isPrev = ref === prevRef;
  const revealed = isHifzAyahRevealed(ref);
  const firstWord = getFirstArabicWordForRef(ref);

  const prevAyah = prevRef ? getAyah(prevRef) : null;
  const prevWordsHtml = prevAyah
    ? buildWordSpans({ ...prevAyah, ayahNo: prevAyah.ayah })
    : "";
  const prevTranslationsHtml = prevAyah
    ? buildAyahTranslationsHtml(prevAyah, esc)
    : "";

  const showPrevAyahHelper = stage === "1" || stage === "2" || stage === "3" || stage === "4";
  const prevLabelText = prevRef ? `Previous ayah ${esc(prevRef)}` : "Previous ayah";
  const currentLabelText = `Current ayah ${esc(ref)}`;

  const focusHeadingHtml = `<div class="hifzStage1FocusLabel">${currentLabelText}</div>`;

  const hiddenCurrentAyahHtml =
    (stage === "5" || stage === "6" || stage === "7")
      ? ``
      : (stage === "2" || stage === "4")
          ? `
        <div class="ayahText hifzFirstWordOnly" dir="rtl" lang="ar">
          <span class="hifzFirstWordDots" aria-hidden="true">....</span>
        </div>
      `
          : `
        <div class="ayahText hifzFirstWordOnly" dir="rtl" lang="ar">
          <span class="hifzFirstWord" dir="rtl" lang="ar">${esc(firstWord || "…")}</span><span class="hifzFirstWordDots" aria-hidden="true"> ...</span>
        </div>
      `;

  if (isPrev) {
    return `
      ${progressTop}
        <div class="hifzHiddenLabel">Helper ayah</div>
        <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
      ${progressBottom}
    `;
  }

  if (isFocus && !revealed) {
    return `
      ${progressTop}
        ${showPrevAyahHelper && prevWordsHtml ? `
        <div class="hifzStage1PrevLabel">${prevLabelText}</div>
        <div class="ayahText">${prevWordsHtml}</div>
        ${prevTranslationsHtml}
        ` : ""}

        ${focusHeadingHtml}
        ${hiddenCurrentAyahHtml}

        <div class="hifzHiddenBox">
          <button
            class="hifzUnhideBtn"
            type="button"
            data-hifz-unhide="${ref}"
            aria-label="Show ${esc(ref)}">
            <span class="hifzUnhideBtnMain">Show ayah</span>
            <span class="hifzUnhideBtnHint" aria-hidden="true">(space)</span>
          </button>
        </div>

        <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
      ${progressBottom}
    `;
  }

  if (isFocus && revealed) {
    return `
      ${progressTop}
        ${showPrevAyahHelper && prevWordsHtml ? `
        <div class="hifzStage1PrevLabel">${prevLabelText}</div>
        <div class="ayahText">${prevWordsHtml}</div>
        ${prevTranslationsHtml}
        ` : ""}

        <div class="hifzStage1FocusLabel">${currentLabelText}</div>
        <div class="ayahText">${wordsHtml}</div>
        ${buildAyahTranslationsHtml(a, esc)}
        ${buildHifzRecallActionsHtml(a, esc)}
        <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
      ${progressBottom}
    `;
  }

  return `
    ${progressTop}
      <div class="hifzHiddenLabel">Ayah hidden</div>
      <div class="hifzRepeatMeta">${goodCount}/${repeatTarget} right</div>
    ${progressBottom}
  `;
}

// =========================
// VIEW MODE: "ayah" | "mushaf"
// =========================
let viewMode = "ayah";
let currentRef = "2:255";
// Statusbar-Play soll immer wissen in welcher Sura man gerade ist
let currentSurahInView = 2;
let __suppressNextMushafCenterScrollUntil = 0;

function suppressNextMushafCenterScroll(delayMs = 260){
  __suppressNextMushafCenterScrollUntil =
    performance.now() + Math.max(0, Number(delayMs) || 0);
}

// =========================
// Render batching (perf + keine Render-Stürme)
// =========================
let __renderJobId = null;
let __renderPendingRef = null;

function __renderCurrentNow(ref) {
  // ======= HIER BEGINNT DEIN ALTER renderCurrent BODY =======
  const nextRef = String(ref || currentRef || "");
  const prevRef = String(currentRef || "");

  if (/^\d+:\d+$/.test(nextRef) && nextRef !== prevRef) {
    if (/^\d+:\d+$/.test(prevRef)) {
      setHifzAyahRevealed(prevRef, false);
    }
    setHifzAyahRevealed(nextRef, false);
  }

  currentRef = nextRef || currentRef;
  invalidateWordDomCache();

  const qv = document.querySelector(".qView");

  if (viewMode === "mushaf") {
    const prevMv = document.querySelector(".mView");
    const keepMushafScrollTop = Math.max(0, Number(prevMv?.scrollTop) || 0);
    const preserveMushafScrollAfterRate =
      !!prevMv &&
      isHifzTrainMaskOn() &&
      isHifzTrainMaskRatePending(nextRef) &&
      !!prevMv.querySelector(`.mNo.is-train-rate-open[data-ref="${CSS.escape(nextRef)}"]`);

    renderMushaf(currentRef);

    const mv = document.querySelector(".mView");
    if (qv) qv.style.display = "none";
    if (mv) {
      mv.style.display = "block";

      const suppressCenterScroll =
        performance.now() < (Number(__suppressNextMushafCenterScrollUntil) || 0);

      if (suppressCenterScroll) {
        __suppressNextMushafCenterScrollUntil = 0;
      }

      if (preserveMushafScrollAfterRate) {
        let restoreFrames = 18;

        const restoreMushafScroll = () => {
          const liveMv = document.querySelector(".mView");
          if (!liveMv) return;

          liveMv.scrollTop = keepMushafScrollTop;

          if (restoreFrames-- > 0 && (Number(liveMv.scrollTop) || 0) + 4 < keepMushafScrollTop) {
            requestAnimationFrame(restoreMushafScroll);
          }
        };

        requestAnimationFrame(restoreMushafScroll);
      } else {
        // ✅ erst scrollen, wenn .mNo existiert (Chunking!)
        scrollToMushafNoWhenReady(mv, currentRef, {
          updateUrl: false,
          scroll: !suppressCenterScroll
        });
      }
    }
  }
  else {
 if (verseAudio && !verseAudio.paused && verseRefPlaying && __autoScrollGate) {
  currentRef = verseRefPlaying; // ✅ nur auto-folgen, wenn Gate aktiv ist
}
    renderAyahWords(currentRef);

    const mv = document.querySelector(".mView");
    const qv2 = document.querySelector(".qView");

    if (mv) mv.style.display = "none";
    if (qv2) qv2.style.display = "flex"; // ✅ flex damit gap + scroll passt

    // ✅ nachdem Ayah-View sichtbar ist: sicher scrollen
    if (qv2) {
      // ✅ erst scrollen/fokussieren wenn die Ziel-Card existiert
      scrollToAyahWhenReady(qv2, currentRef, { scroll: "instant" });
    }
  }
    // ✅ Favorites Progress: nach jedem Render Views finden + Listener binden + update triggern
  try { window.__bindFavProgressListeners?.(); } catch(e) {}
  try { window.__scheduleFavProgressUpdate?.(); } catch(e) {}
  // ======= HIER ENDET DEIN ALTER renderCurrent BODY =======
}

// ✅ Öffentliche API bleibt gleich: renderCurrent()
// Aber intern wird gebatched: viele schnelle Calls -> 1 Render
function renderCurrent(ref) {
  // ✅ Favorites-Seite darf NICHT überschrieben werden
  if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

  __renderPendingRef = ref || __renderPendingRef || currentRef;

  // Wenn schon geplant -> nur Ref updaten, NICHT nochmal schedulen
  if (__renderJobId != null) return;

  // Idle-first, aber mit Timeout damit es nicht “hängt”
  __renderJobId = scheduleRender(() => {
    __renderJobId = null;

    const r = __renderPendingRef || currentRef;
    __renderPendingRef = null;

    __renderCurrentNow(r);
  }, { timeout: 80 });
}

function toggleViewMode() {
  viewMode = viewMode === "ayah" ? "mushaf" : "ayah";
  dlog("ui", "viewMode", viewMode);

  // ✅ Wenn currentRef aus irgendeinem Grund basm:* ist: fallback auf 2:1 der Sura
  if (!/^\d+:\d+$/.test(currentRef)) {
    const m = String(currentRef).match(/^basm:(\d{1,3})$/);
    if (m) currentRef = `${Number(m[1])}:1`;
  }

  // ✅ WICHTIG: SurahSelect/SurahPlay SOFORT korrekt setzen (auch ohne “Play”-Trigger)
  try {
    const a = getAyah(currentRef);
    if (a?.surah) setSurahContext(a.surah);
  } catch {}

  // Render + Persist wie gehabt
  renderCurrent(currentRef);
  persistNavState();

  // ✅ Statusbar Icon aktualisieren
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ (optional aber hilfreich) direkt einmal progress/update anstoßen
  try { window.__bindFavProgressListeners?.(); } catch(e) {}
  try { window.__scheduleFavProgressUpdate?.(); } catch(e) {}
}

// =========================
// WORD DISPLAY (textAr) + WORD AUDIO (wbw) MAPPING
// =========================

// Ordner wo deine 80k Word-by-Word MP3 liegen:
const WORD_AUDIO_ROOT = `${AUDIO_BASE_URL}/wbw`; // z.B. https://audio.quranm.com/wbw/002_013_013.mp3

const _pad3w = (n) => String(Number(n)).padStart(3, "0");

// Waqf/Stop marks die oft am Wort "dranhängen"
const _WAQF_MARKS = "ۖۗۘۙۚۛۜ۝۞۩";
const _reTrailingMarks = new RegExp(`^(.*?)([${_WAQF_MARKS}]+)$`);
const _reOnlyMarks = new RegExp(`^[${_WAQF_MARKS}]+$`);

function wordMp3Url(surahNo, ayahNo, wordNo) {
  return `${WORD_AUDIO_ROOT}/${_pad3w(surahNo)}_${_pad3w(ayahNo)}_${_pad3w(wordNo)}.mp3`;
}

function tokenizeTextAr(textAr) {
  const raw = String(textAr || "").trim();
  if (!raw) return [];

  const base = raw.split(/\s+/).filter(Boolean);
  const out = [];

  for (const tok of base) {
    const m = tok.match(_reTrailingMarks);
    if (m) {
      if (m[1]) out.push(m[1]);   // Wort ohne Mark
      out.push(m[2]);             // Mark(s) separat
    } else {
      out.push(tok);
    }
  }
  return out;
}

/**
 * Baut <span class="w">...</span> aus textAr (sichtbarer Text),
 * mappt aber Wortindex (wi) gegen ayah.words (für de/en später),
 * und setzt Audio:
 *  - data-audio  = "continuous" wbw (…_013.mp3)
 *  - data-audio2 = fallback aus JSON (falls du das später brauchst)
 */
function buildWordSpans({ ref, surah, ayahNo, textAr, words }) {
  const wordObjs = (words || []).filter((w) => !w.isAyahNoToken);
  const toks = tokenizeTextAr(textAr);

  let wi = 0; // zählt nur "sprechbare Wörter" (ohne waqf marks)
  return toks
    .map((t) => {
      // Nur Waqf-Mark => anzeigen, aber NICHT klickbar / ohne Audio
      if (_reOnlyMarks.test(t)) {
        return `<span class="w wMark" aria-hidden="true">${t}</span>`;
      }

      const w = wordObjs[wi] || null;

      // 1) dein erwartetes Schema (continuous)
      const primary = wordMp3Url(surah, ayahNo, wi + 1);

      // 2) fallback: was in JSON steht (kann "gapped" sein)
      const alt = w?.audioUrl ? String(w.audioUrl) : "";

      const html =
        `<span class="w" data-ref="${ref}" data-wi="${wi}" data-audio="${primary}" data-audio2="${alt}">${t}</span>`;

      wi++;
      return html;
    })
    .join("");
}

// Spielt Word-Audio von einem .w Span (mit fallback)
function playWordFromSpan(wEl) {
  const url1 = wEl?.dataset?.audio || "";
  const url2 = wEl?.dataset?.audio2 || "";

  if (!url1 && !url2) return;

  // Toggle: gleiches Wort nochmal -> stop
  if (wordElPlaying === wEl && wordAudio && !wordAudio.paused) {
    stopWordAudio();
    return;
  }

  stopWordAudio();

  wordElPlaying = wEl;
  wEl.classList.add("is-playing");

  const start = (url, isFallback = false) => {
    if (!url) return stopWordAudio();

    wordAudio = new Audio(url);
    wordAudio.preload = "auto";

    // ✅ WICHTIG: Wordplay-Volume direkt beim Erzeugen setzen
    try {
      const v = (typeof globalVolume === "number") ? globalVolume : 1;
      wordAudio.volume = Math.min(1, Math.max(0, v));
    } catch (e) {}

    wordAudio.addEventListener("ended", stopWordAudio, { once: true });

    wordAudio.addEventListener(
      "error",
      () => {
        if (!isFallback && url2 && url2 !== url1) start(url2, true);
        else stopWordAudio();
      },
      { once: true }
    );

    wordAudio.play().catch(() => {
      if (!isFallback && url2 && url2 !== url1) start(url2, true);
      else stopWordAudio();
    });
  };

  start(url1 || url2, false);
}

function setLiveTopbarSurah(view, surahNo) {
  const el = view?.querySelector?.("#liveSurahTopTitle");
  if (!el) return;

  const sm = getSuraMeta(surahNo);
  if (!sm) return;

  el.innerHTML = `
    <span class="sNum">${surahNo}</span>
    <span class="dot">•</span>
    <span class="sEn">${sm?.nameTranslit ?? ""}</span>
    <span class="dot">•</span>
    <span class="sAr" dir="rtl" lang="ar">${sm?.nameAr ?? ""}</span>
  `;
}

function renderAyahWords(ref) {
  const ay = getAyah(ref);
  if (!ay) return;

  const view = ensureQView();
  if (!view) return;

  // Ayah-Mode: wir nutzen die vorhandenen CSS-Klassen aus app.css
  view.dataset.mode = "suraCards";

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

  const surah = ay.surah;
const renderAll = window.__renderAllQuran === true;
const sm = getSuraMeta(surah);

  const surahNameAr = esc(sm?.nameAr ?? "");
  const surahNameTr = esc(sm?.nameTranslit ?? "");
  const surahNameDe = esc(sm?.nameDe ?? "");

const refsRaw = renderAll ? getAllRefs() : ((typeof getSuraRefs === "function") ? getSuraRefs(surah) : []);

const stageNow = String(hifzStageValue || "1");
const useWholeQuranRange = renderAll || stageNow === "7" || stageNow === "10";
const useWholeSurahRange = stageNow === "6" || stageNow === "8" || stageNow === "9";

const rawRange = String(hifzRangeValue || "5-10").trim();
const mRange = rawRange.match(/^(\d+)\s*-\s*(\d+)$/);

let fromAyah = 1;
let toAyah = Number(sm?.ayahCount || refsRaw.length || 1);

if (mRange) {
  fromAyah = Math.max(1, Number(mRange[1]) || 1);
  toAyah = Math.max(1, Number(mRange[2]) || fromAyah);
}

if (toAyah < fromAyah) {
  const tmp = fromAyah;
  fromAyah = toAyah;
  toAyah = tmp;
}

const maxAyah = Number(sm?.ayahCount || refsRaw.length || 1);
fromAyah = Math.min(fromAyah, maxAyah);
toAyah = Math.min(toAyah, maxAyah);

const refsInRange = useWholeQuranRange
  ? refsRaw
  : refsRaw.filter((r) => {
      const a = getAyah(r);
      if (!a || a.surah !== surah) return false;

      if (useWholeSurahRange) {
        return true;
      }

      return a.ayah >= fromAyah && a.ayah <= toAyah;
    });

const refs =
  isHifzSingleFocusStage(stageNow)
    ? refsInRange.filter((r) => r === String(currentRef || ""))
    : refsInRange;

const modeText = "Train";
const escTopBarAttr = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
const hifzStageInfoTitle = "Stage";
const hifzStageInfoText = "Chooses the current hifz stage. Higher stages remove more help and expect stronger recall.";
const hifzRepeatInfoTitle = "Right target";
const hifzRepeatInfoText = "Sets how many correct recalls are needed before one ayah counts as learned in the current stage.";
const hifzRangeInfoTitle = "Range";
const hifzRangeInfoText = "Limits the tested ayahs inside the current surah. Example: 5-10.";

// ✅ Ayah-Mode = Test-Mode
const topBarHtml = renderAll ? "" : `
  <div class="surahTopBar ayahTopBar hifzTestTopBar">
    <div class="surahTopFarLeft">
      <div class="hifzControlWithInfo">
        <div class="hifzControlField">
          ${buildHifzStageDropdownHtml(hifzStageValue)}
          <span
            class="hifzHelpInfo"
            data-hifz-help="stage"
            data-hifz-help-title="${escTopBarAttr(hifzStageInfoTitle)}"
            data-hifz-help-text="${escTopBarAttr(hifzStageInfoText)}"
            aria-label="${escTopBarAttr(hifzStageInfoText)}">?</span>
        </div>
      </div>

      <div class="hifzControlWithInfo">
        <div class="hifzControlField hifzRepeatSelectWrap">
          <select class="hifzRepeatSelect" id="hifzRepeatTargetTop" aria-label="How often repeated the ayah right to mark it as learned">
            ${(() => {
              const values = [
                ...Array.from({ length: 100 }, (_, i) => i + 1),
                ...Array.from({ length: 9 }, (_, i) => (i + 2) * 100),
                ...Array.from({ length: 18 }, (_, i) => 1500 + (i * 500))
              ];

              return values.map((n) => {
                const sel = n === loadHifzRepeatTarget() ? ' selected' : '';
                return `<option value="${n}"${sel}>${n}x right</option>`;
              }).join("");
            })()}
          </select>
          <span class="hifzRepeatArrow" aria-hidden="true">▼</span>
          <span
            class="hifzHelpInfo"
            data-hifz-help="repeat"
            data-hifz-help-title="${escTopBarAttr(hifzRepeatInfoTitle)}"
            data-hifz-help-text="${escTopBarAttr(hifzRepeatInfoText)}"
            aria-label="${escTopBarAttr(hifzRepeatInfoText)}">?</span>
        </div>
      </div>

      <div class="hifzControlWithInfo">
        <div class="hifzControlField">
          <input
            class="hifzRangeInput"
            id="hifzRangeInputTopAyah"
            type="text"
            inputmode="text"
            value="5-10"
            placeholder="5-10"
            aria-label="Ayah range to test">
          <span
            class="hifzHelpInfo"
            data-hifz-help="range"
            data-hifz-help-title="${escTopBarAttr(hifzRangeInfoTitle)}"
            data-hifz-help-text="${escTopBarAttr(hifzRangeInfoText)}"
            aria-label="${escTopBarAttr(hifzRangeInfoText)}">?</span>
        </div>
      </div>
    </div>

    <div class="surahTopLeft">
      <div class="surahTitle surahTopTitle">
        <span class="sEn">Test your skill</span>
      </div>
    </div>

    <div class="surahTopRight">
      ${buildHifzBadRefsTopbarHtml()}

      <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch to train mode">
        <span class="modeText">${modeText}</span>
        <span class="modeArrow">→</span>
      </button>
    </div>
  </div>
`;

// Basmallah Card (mit Übersetzungen aus activeTranslations; nimmt 1:1 als Basm-Text)
const basmCardHtml = (surahNo) => {
  if (surahNo === 1 || surahNo === 9) return "";

  // esc() existiert in renderAyahWords bereits
  const trHtml = buildBasmTranslationsHtml(esc);

  return `
    <div class="basmCard ayahCard ayahMainCard" data-ref="basm:${surahNo}" tabindex="0">
      <div class="basmHeader">
        <button class="ayahPlay" type="button" data-audio="${basmMp3Url(surahNo)}" aria-label="Play Basmallah"></button>
        <div class="basmLabel">Basmallah</div>
      </div>

      <div class="basmAr">بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>

      ${trHtml}
    </div>
  `;
};

function getHifzSurahProgressPct(surahNo){
  try{
    const stage = String(hifzStageValue || "1");
    const refs = getSuraRefs(Number(surahNo) || 0) || [];
    if (!refs.length) return 0;

    let sum = 0;
    let count = 0;

    for (const ref of refs){
      const ratio = Number(getHifzProgressRatioForRef(ref, stage) || 0);
      sum += Math.max(0, Math.min(1, ratio));
      count += 1;
    }

    if (!count) return 0;
    return Math.max(0, Math.min(100, Math.round((sum / count) * 100)));
  }catch{
    return 0;
  }
}


function buildHifzSurahSummaryHtml(){
  let cells = "";

  for (let s = 1; s <= 114; s++){
    const pct = getHifzSurahProgressPct(s);
    const ratio = pct / 100;
    const smx = getSuraMeta(s) || {};
    const surahAr = esc(smx?.nameAr ?? "");
    const surahTr = esc(smx?.nameTranslit ?? `Surah ${s}`);

    cells += `
      <div class="hifzSurahSummaryCell${pct > 0 ? " is-progress" : ""}${pct >= 100 ? " is-mastered" : ""}"
           style="--surah-progress:${ratio};"
           data-surah="${s}"
           data-pct="${pct}"
           data-tip-ref="Surah ${s}"
           data-tip-ar="${surahAr}"
           data-tip-tr="${surahTr} • ${pct}%">
        <div class="hifzSurahSummaryCellInner" aria-hidden="true">
          <span class="hifzSurahSummaryNo">${s}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="ayahCard hifzSurahSummaryCard">
      <div class="hifzSurahSummaryHeader">
        <div class="hifzSurahSummaryTitle">Surah Progress</div>
      </div>
      <div class="hifzSurahSummaryGrid">
        ${cells}
      </div>
    </div>
  `;
}

const basmHtml = "";

view.innerHTML =
  topBarHtml +
  basmHtml +
  `<div class="allCardsMount"></div>` +
  `<div class="hifzProgressBottomStack"><div class="hifzStageTrendMount"></div><div class="hifzSurahSummaryMount"></div></div>`;

const mount = view.querySelector(".allCardsMount");
const trendMount = view.querySelector(".hifzStageTrendMount");
const surahSummaryMount = view.querySelector(".hifzSurahSummaryMount");

if (trendMount) {
  trendMount.innerHTML = buildHifzStageTrendHtml();
}

const escSummary = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

if (surahSummaryMount) {
  surahSummaryMount.innerHTML = buildHifzSurahSummaryHtml();

  let _lastSurahSummaryTipKey = "";

  const _surahSummaryEscTip = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  const _surahSummaryTipEl = (() => {
    let el = document.getElementById("suraProgTip");
    if (!el) {
      el = document.createElement("div");
      el.id = "suraProgTip";
      el.className = "suraProgTip";
      document.body.appendChild(el);
    }
    return el;
  })();

  const _surahSummaryHideTip = () => {
    _lastSurahSummaryTipKey = "";
    if (_surahSummaryTipEl) {
      _surahSummaryTipEl.classList.remove("is-show");
      _surahSummaryTipEl.style.left = "-9999px";
      _surahSummaryTipEl.style.top = "-9999px";
    }
  };

  const _surahSummaryPlaceTip = (tipEl, x, y) => {
    if (typeof _placeTip === "function") {
      _placeTip(tipEl, x, y);
      return;
    }

    if (!tipEl) return;

    tipEl.classList.add("is-show");

    const stageEl = document.getElementById("stage");
    const stageRect = stageEl
      ? stageEl.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

    const pad = Math.max(8, window.innerWidth * 0.008);
    const gapY = Math.max(10, window.innerHeight * 0.012);

    const rect = tipEl.getBoundingClientRect();

    let left = x - rect.width / 2;
    const spaceBelow = stageRect.bottom - (y + gapY);
    const spaceAbove = (y - gapY) - stageRect.top;

    let top = (spaceBelow >= rect.height + pad)
      ? (y + gapY)
      : (y - gapY - rect.height);

    left = Math.max(stageRect.left + pad, Math.min(left, stageRect.right - rect.width - pad));
    top = Math.max(stageRect.top + pad, Math.min(top, stageRect.bottom - rect.height - pad));

    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  };

  const _surahSummaryTooltipsAllowed = () => {
    if (typeof tooltipsAllowed === "function") return !!tooltipsAllowed();
    return true;
  };

  const _renderSurahSummaryTip = (cell, clientX, clientY) => {
    if (!cell) {
      _surahSummaryHideTip();
      return;
    }

    if (!_surahSummaryTooltipsAllowed()) {
      _surahSummaryHideTip();
      return;
    }

    const key = `${cell.dataset.surah || ""}|${cell.dataset.pct || ""}`;

    if (_lastSurahSummaryTipKey !== key) {
      _lastSurahSummaryTipKey = key;

      _surahSummaryTipEl.innerHTML = `
        <div class="tipRef">${_surahSummaryEscTip(cell.dataset.tipRef || "")}</div>
        <div class="tipAr" dir="rtl" lang="ar">${cell.dataset.tipAr || ""}</div>
        <div class="tipTr">${_surahSummaryEscTip(cell.dataset.tipTr || "")}</div>
      `;
    }

    _surahSummaryPlaceTip(_surahSummaryTipEl, clientX, clientY);
  };

  surahSummaryMount.addEventListener("mouseenter", (e) => {
    const cell = e.target.closest?.(".hifzSurahSummaryCell[data-surah]");
    if (!cell) return;
    _renderSurahSummaryTip(cell, e.clientX, e.clientY);
  }, true);

  surahSummaryMount.addEventListener("mousemove", (e) => {
    const cell = e.target.closest?.(".hifzSurahSummaryCell[data-surah]");
    if (!cell) {
      _surahSummaryHideTip();
      return;
    }

    _renderSurahSummaryTip(cell, e.clientX, e.clientY);
  }, { passive: true });

  surahSummaryMount.addEventListener("mouseleave", () => {
    _surahSummaryHideTip();
  });
}
const hifzStageSelectTop = view.querySelector("#hifzStageSelectTop");
const hifzStageDropTop = view.querySelector("#hifzStageDropTop");
const hifzStageDropBtnTop = view.querySelector("#hifzStageDropBtnTop");
const hifzStageDropMenuTop = view.querySelector("#hifzStageDropMenuTop");
const hifzStageDropLabelTop = view.querySelector("#hifzStageDropLabelTop");

if (hifzStageSelectTop && !hifzStageSelectTop._bound) {
  hifzStageSelectTop._bound = true;
  hifzStageSelectTop.value = hifzStageValue || "1";

  const syncHifzStageDropUi = () => {
    const selected = String(hifzStageValue || hifzStageSelectTop.value || "1");
    const meta = getHifzStageMeta(selected);
    const pctMap = getHifzStageProgressMap();
    const pct = Number(pctMap[selected] || 0);

    hifzStageSelectTop.value = selected;

    if (hifzStageDropLabelTop) {
      hifzStageDropLabelTop.textContent = String(meta.title || "");
      hifzStageDropLabelTop.setAttribute("aria-label", String(meta.title || ""));
    }

    if (hifzStageDropTop) {
      hifzStageDropTop.style.setProperty("--hifz-stage-pct", `${pct}%`);
    }

    if (hifzStageDropMenuTop) {
      hifzStageDropMenuTop.querySelectorAll(".hifzStageDropItem[data-stage-value]").forEach((item) => {
        const on = String(item.getAttribute("data-stage-value") || "") === selected;
        item.classList.toggle("is-selected", on);
        item.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    if (hifzStageDropBtnTop) {
      hifzStageDropBtnTop.setAttribute("aria-expanded", hifzStageDropTop?.classList.contains("is-open") ? "true" : "false");
    }
  };

  const closeHifzStageDrop = () => {
    if (!hifzStageDropTop) return;
    hifzStageDropTop.classList.remove("is-open");
    if (hifzStageDropBtnTop) hifzStageDropBtnTop.setAttribute("aria-expanded", "false");
  };

  const toggleHifzStageDrop = () => {
    if (!hifzStageDropTop) return;
    const nextOpen = !hifzStageDropTop.classList.contains("is-open");
    hifzStageDropTop.classList.toggle("is-open", nextOpen);
    if (hifzStageDropBtnTop) hifzStageDropBtnTop.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  };

  const applyHifzStage = () => {
    saveHifzStageValue(hifzStageSelectTop.value);
    syncHifzStageDropUi();

    const inputNow = view.querySelector("#hifzRangeInputTopAyah");
    syncHifzRangeInputUi(inputNow);

    const stage = String(hifzStageValue || "1");
    let nextRef = currentRef;

    if (stage === "10") {
      nextRef = getNextStage10Ref(currentRef);
    } else if (stage === "9") {
      nextRef = getNextStage9Ref(currentRef);
    } else if (stage === "8") {
      nextRef = getNextStage8Ref(currentRef);
    } else if (stage === "7") {
      nextRef = getNextStage7Ref(currentRef);
    } else if (stage === "6") {
      nextRef = getNextStage6Ref(currentRef);
    } else if (stage === "5") {
      nextRef = getNextStage5Ref(currentRef);
    } else if (stage === "3" || stage === "4") {
      const bounds = getHifzRangeBoundsForRef(currentRef);
      const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

      const baseRef =
        currentAyahNo >= Number(bounds?.fromAyah || 0) &&
        currentAyahNo <= Number(bounds?.toAyah || 0)
          ? currentRef
          : String(bounds?.startRef || currentRef || "");

      nextRef = getNextStage3Ref(baseRef);
    } else {
      const bounds = getHifzRangeBoundsForRef(currentRef);
      const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

      nextRef =
        currentAyahNo >= Number(bounds?.fromAyah || 0) &&
        currentAyahNo <= Number(bounds?.toAyah || 0)
          ? currentRef
          : String(bounds?.startRef || currentRef || "");
    }

    closeHifzStageDrop();
    renderCurrent(nextRef);
  };

  hifzStageSelectTop.addEventListener("change", applyHifzStage);

  if (hifzStageDropBtnTop && !hifzStageDropBtnTop._bound) {
    hifzStageDropBtnTop._bound = true;
    hifzStageDropBtnTop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHifzStageDrop();
    });
  }

  if (hifzStageDropMenuTop && !hifzStageDropMenuTop._bound) {
    hifzStageDropMenuTop._bound = true;
    hifzStageDropMenuTop.addEventListener("click", (e) => {
      const item = e.target.closest(".hifzStageDropItem[data-stage-value]");
      if (!item) return;

      const value = String(item.getAttribute("data-stage-value") || "");
      if (!/^(10|[1-9])$/.test(value)) return;

      hifzStageSelectTop.value = value;
      hifzStageSelectTop.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  if (!document.__hifzStageDropOutsideBound) {
    document.__hifzStageDropOutsideBound = true;

    document.addEventListener("click", (e) => {
      const drop = document.getElementById("hifzStageDropTop");
      if (!drop) return;
      if (drop.contains(e.target)) return;
      drop.classList.remove("is-open");
      const btn = document.getElementById("hifzStageDropBtnTop");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const drop = document.getElementById("hifzStageDropTop");
      if (!drop) return;
      drop.classList.remove("is-open");
      const btn = document.getElementById("hifzStageDropBtnTop");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  syncHifzStageDropUi();
}

const hifzRepeatTargetTop = view.querySelector("#hifzRepeatTargetTop");
if (hifzRepeatTargetTop && !hifzRepeatTargetTop._bound) {
  hifzRepeatTargetTop._bound = true;
  hifzRepeatTargetTop.value = String(loadHifzRepeatTarget());

  const applyRepeatTarget = () => {
    saveHifzRepeatTarget(hifzRepeatTargetTop.value);
    hifzRepeatTargetTop.value = String(loadHifzRepeatTarget());
    renderCurrent(currentRef);
  };

  hifzRepeatTargetTop.addEventListener("change", applyRepeatTarget);
}

const hifzRangeInputTopAyah = view.querySelector("#hifzRangeInputTopAyah");
if (hifzRangeInputTopAyah && !hifzRangeInputTopAyah._bound) {
  hifzRangeInputTopAyah._bound = true;
  syncHifzRangeInputUi(hifzRangeInputTopAyah);

  const syncAyahRangeDraft = () => {
    if (isHifzRangeLockedStage(hifzStageValue)) return;
    saveHifzRangeValue(hifzRangeInputTopAyah.value);
  };

  const applyAyahRange = () => {
    syncAyahRangeDraft();
    syncHifzRangeInputUi(hifzRangeInputTopAyah);

    if (isHifzRangeLockedStage(hifzStageValue)) {
      renderCurrent(currentRef);
      return;
    }

    const bounds = getHifzRangeBoundsForRef(currentRef);
    const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

    const nextRef =
      currentAyahNo >= Number(bounds?.fromAyah || 0) &&
      currentAyahNo <= Number(bounds?.toAyah || 0)
        ? currentRef
        : String(bounds?.startRef || currentRef || "");

    renderCurrent(nextRef);
  };

  hifzRangeInputTopAyah.addEventListener("input", syncAyahRangeDraft);
  hifzRangeInputTopAyah.addEventListener("change", applyAyahRange);
  hifzRangeInputTopAyah.addEventListener("blur", applyAyahRange);

  hifzRangeInputTopAyah.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyAyahRange();
    }
  });
}

bindHifzBadDropInView(view, (ref) => {
  const allowedRefs = new Set(getHifzNavigableRefsForCurrentStage().map(String));

  if (!allowedRefs.has(String(ref))) {
    if (mount) {
      mount.innerHTML = buildHifzBadRangeMessageHtml(ref);
      view.__ayahCacheDirty = true;
      view.__ayahCardsCache = null;
    }
    return;
  }

  renderCurrent(ref);
});

if (mount && !mount._hifzUiBound) {
  mount._hifzUiBound = true;

  const setWriteResultFlash = (ref, value = "") => {
    const r = String(ref || "");
    if (!/^\d+:\d+$/.test(r)) return;

    const v = String(value || "").trim().toLowerCase();
    if (v === "good" || v === "bad") {
      __hifzWriteResultFlashMap[r] = v;
      return;
    }

    delete __hifzWriteResultFlashMap[r];
  };

  const focusWriteInputByRef = (ref) => {
    const refStr = String(ref || "");
    if (!/^\d+:\d+$/.test(refStr)) return null;

    const inputNow = document.querySelector(`[data-hifz-write-input="${refStr}"]`);
    if (!inputNow) return null;

    try {
      inputNow.focus({ preventScroll: true });
    } catch {
      try { inputNow.focus(); } catch {}
    }

    try {
      const len = String(inputNow.value || "").length;
      inputNow.setSelectionRange(len, len);
    } catch {}

    return inputNow;
  };

  const rerenderWithoutJump = (nextRef, { focusWrite = false, forceNow = false } = {}) => {
    const targetRef = String(nextRef || currentRef || "");
    const qv = mount.closest(".qView");
    const pageEl = document.scrollingElement || document.documentElement;

    const safeCurrentRef = String(currentRef || "");
    const targetSel = /^\d+:\d+$/.test(targetRef)
      ? `.ayahMainCard[data-ref="${CSS.escape(targetRef)}"]`
      : "";
    const currentSel = /^\d+:\d+$/.test(safeCurrentRef)
      ? `.ayahMainCard[data-ref="${CSS.escape(safeCurrentRef)}"]`
      : "";

    const anchorRef =
      (targetSel && mount.querySelector(targetSel) && targetRef) ||
      (currentSel && mount.querySelector(currentSel) && safeCurrentRef) ||
      "";

    const anchorSel = anchorRef
      ? `.ayahMainCard[data-ref="${CSS.escape(anchorRef)}"]`
      : "";

    const anchorBefore = anchorSel ? mount.querySelector(anchorSel) : null;
    const qvRectBefore = qv ? qv.getBoundingClientRect() : null;

    const prevTop = qv ? qv.scrollTop : 0;
    const prevLeft = qv ? qv.scrollLeft : 0;
    const prevPageTop = pageEl ? pageEl.scrollTop : 0;
    const prevPageLeft = pageEl ? pageEl.scrollLeft : 0;

    const prevAnchorTop =
      qv && qvRectBefore && anchorBefore
        ? (anchorBefore.getBoundingClientRect().top - qvRectBefore.top)
        : null;

    if (forceNow) {
      try {
        cancelScheduledRender(__renderJobId);
      } catch {}

      __renderJobId = null;
      __renderPendingRef = null;

      if (/^\d+:\d+$/.test(targetRef)) {
        currentRef = targetRef;
        try { setRefToHash(targetRef); } catch {}
      }

      __renderCurrentNow(targetRef);
    } else {
      renderCurrent(targetRef);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const qvNow = document.querySelector(".qView");
        const pageNow = document.scrollingElement || document.documentElement;

        if (pageNow) {
          pageNow.scrollTop = prevPageTop;
          pageNow.scrollLeft = prevPageLeft;
        }

        if (qvNow) {
          qvNow.scrollTop = prevTop;
          qvNow.scrollLeft = prevLeft;

          if (prevAnchorTop != null && anchorSel) {
            const anchorNow = qvNow.querySelector(anchorSel) || document.querySelector(anchorSel);
            if (anchorNow) {
              const qvRectNow = qvNow.getBoundingClientRect();
              const nowAnchorTop = anchorNow.getBoundingClientRect().top - qvRectNow.top;
              qvNow.scrollTop += (nowAnchorTop - prevAnchorTop);
            }
          }
        }

        if (focusWrite) {
          focusWriteInputByRef(targetRef);
        }
      });
    });
  };

const setWriteInputCooldown = (ref, delayMs = 0) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const st = getHifzWriteStateForRef(r);
  const until = performance.now() + Math.max(0, Number(delayMs) || 0);
  st.lockUntil = Math.max(Number(st.lockUntil) || 0, until);
};

const isWriteInputCoolingDown = (ref) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return false;

  const st = getHifzWriteStateForRef(r);
  return performance.now() < (Number(st.lockUntil) || 0);
};

const scheduleWriteFlashClear = (ref, delayMs = 500) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const st = getHifzWriteStateForRef(r);
  const tick = (Number(st.flashTick) || 0) + 1;
  st.flashTick = tick;

  setTimeout(() => {
    const cur = __hifzWriteStateMap[r];
    if (!cur) return;
    if (Number(cur.flashTick) !== tick) return;
    if (String(currentRef || "") !== r) return;
    if (isWriteInputCoolingDown(r)) return;

    clearHifzWriteFlashForRef(r);
    rerenderWithoutJump(r, { focusWrite: true, forceNow: false });
  }, delayMs);
};

const goNextAfterWriteResult = (ref, delayMs = 760) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const st = getHifzWriteStateForRef(r);
  const token = (Number(st.navToken) || 0) + 1;
  st.navToken = token;
  st.flashTick = (Number(st.flashTick) || 0) + 1;

  setWriteInputCooldown(r, delayMs);

  setTimeout(() => {
    const cur = __hifzWriteStateMap[r];
    if (!cur) return;
    if (Number(cur.navToken) !== token) return;
    if (String(currentRef || "") !== r) return;

    const nextRef = String(getNextHifzFocusRef(r) || "");

    setWriteResultFlash(r, "");
    resetHifzWriteStateForRef(r);

    if (nextRef && nextRef !== r) {
      setHifzAyahRevealed(nextRef, false);
      rerenderWithoutJump(nextRef, {
        focusWrite: ["8", "9", "10"].includes(String(hifzStageValue || "1")),
        forceNow: true
      });
      return;
    }

    setHifzAyahRevealed(r, false);
    rerenderWithoutJump(r, {
      focusWrite: ["8", "9", "10"].includes(String(hifzStageValue || "1")),
      forceNow: true
    });
  }, delayMs);
};

const handleWriteRawInput = (input, rawValue) => {
  if (!input) return;

  const ref = String(input.getAttribute("data-hifz-write-input") || "");
  if (!/^\d+:\d+$/.test(ref)) {
    input.value = "";
    return;
  }

  if (!["8", "9", "10"].includes(String(hifzStageValue || "1"))) {
    input.value = "";
    return;
  }

  input.value = "";

  if (isWriteInputCoolingDown(ref)) {
    focusWriteInputByRef(ref);
    return;
  }

  const safeRaw = String(rawValue || "");
  const outcome = consumeHifzWriteInput(ref, safeRaw);

  if (!outcome || outcome.status === "noop") {
    setWriteResultFlash(ref, "");
    focusWriteInputByRef(ref);
    return;
  }

  if (outcome.status === "progress") {
    setWriteResultFlash(ref, "");
    rerenderWithoutJump(ref, { focusWrite: true });
    scheduleWriteFlashClear(ref, 500);
    return;
  }

  if (outcome.status === "wrong") {
    setWriteResultFlash(ref, "");
    setWriteInputCooldown(ref, 650);
    rerenderWithoutJump(ref, { focusWrite: true });
    scheduleWriteFlashClear(ref, 650);
    return;
  }

  if (outcome.status === "good") {
    setHifzResultForRef(ref, hifzStageValue, "good");
    setWriteResultFlash(ref, "good");
    rerenderWithoutJump(ref, { focusWrite: false });
    goNextAfterWriteResult(ref, 760);
    return;
  }

  if (outcome.status === "bad") {
    setHifzResultForRef(ref, hifzStageValue, "bad");
    setWriteResultFlash(ref, "bad");
    rerenderWithoutJump(ref, { focusWrite: false });
    goNextAfterWriteResult(ref, 2500);
  }
};



  const ensureHifzGoodFlightFx = () => {
    let fx = document.querySelector(".hifzGoodFlightFx");
    if (fx) return fx;

    fx = document.createElement("div");
    fx.className = "hifzGoodFlightFx";
    fx.setAttribute("aria-hidden", "true");
    fx.innerHTML = `
      <svg class="hifzGoodFlightSvg" viewBox="0 0 1 1" preserveAspectRatio="none">
        <path class="hifzGoodFlightGlowPath"></path>
        <path class="hifzGoodFlightSparkPath"></path>
      </svg>
      <div class="hifzGoodFlightDust">
        <span class="hifzGoodFlightDustCore"></span>
        <span class="hifzGoodFlightDustMote is-a"></span>
        <span class="hifzGoodFlightDustMote is-b"></span>
        <span class="hifzGoodFlightDustMote is-c"></span>
        <span class="hifzGoodFlightDustMote is-d"></span>
      </div>
    `;
    document.body.appendChild(fx);
    return fx;
  };

  const clearHifzGoodFlightFx = () => {
    try { clearTimeout(Number(mount._hifzGoodFlightArrivalTimer || 0)); } catch(e) {}
    try { clearTimeout(Number(mount._hifzGoodFlightClearTimer || 0)); } catch(e) {}
    try {
      if (typeof mount._hifzGoodFlightRaf === "number" && mount._hifzGoodFlightRaf) {
        cancelAnimationFrame(mount._hifzGoodFlightRaf);
      }
    } catch(e) {}

    const fx = document.querySelector(".hifzGoodFlightFx");
    if (fx) {
      fx.classList.remove("is-active");
      fx.style.removeProperty("--flight-len");
      fx.style.removeProperty("--flight-ms");

      const dust = fx.querySelector(".hifzGoodFlightDust");
      if (dust) {
        dust.style.left = "0px";
        dust.style.top = "0px";
        dust.style.opacity = "0";
        dust.style.transform = "translate(-50%, -50%)";
      }
    }

    try {
      if (mount._hifzGoodFlightTick && mount._hifzGoodFlightTick.isConnected) {
        mount._hifzGoodFlightTick.classList.remove("is-good-arrival");
      }
    } catch(e) {}

    mount._hifzGoodFlightTick = null;
    mount._hifzGoodFlightArrivalTimer = 0;
    mount._hifzGoodFlightClearTimer = 0;
    mount._hifzGoodFlightRaf = 0;
  };

  const runHifzGoodFlightFromButton = (btn, ref) => {
    const r = String(ref || "");
    if (!btn || !/^\d+:\d+$/.test(r)) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const tickSelector = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? `.suraTick[data-ref="${CSS.escape(r)}"]`
      : `.suraTick[data-ref="${r.replace(/"/g, '\\"')}"]`;

    const tick = document.querySelector(tickSelector);
    if (!tick) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const fx = ensureHifzGoodFlightFx();
    clearHifzGoodFlightFx();

    const svg = fx.querySelector(".hifzGoodFlightSvg");
    const glowPath = fx.querySelector(".hifzGoodFlightGlowPath");
    const sparkPath = fx.querySelector(".hifzGoodFlightSparkPath");
    const dust = fx.querySelector(".hifzGoodFlightDust");

    if (!svg || !glowPath || !sparkPath || !dust) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const startRect = btn.getBoundingClientRect();
    const endRect = tick.getBoundingClientRect();

    const startX = startRect.left + (startRect.width * 0.50);
    const startY = startRect.top + (startRect.height * 0.50);

    const endX = endRect.left + (endRect.width * 0.50);
    const endY = endRect.top + (endRect.height * 0.54);

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.max(1, Math.hypot(dx, dy));

    const rootCs = getComputedStyle(document.documentElement);
    const stageH = parseFloat(rootCs.getPropertyValue("--stage-h")) || window.innerHeight;

    const nx = -dy / dist;
    const ny = dx / dist;

    const bendSign = Math.random() < 0.5 ? -1 : 1;
    const bendMain =
      Math.min(Math.max(dist * 0.26, stageH * 0.10), stageH * 0.28) *
      bendSign *
      (0.85 + (Math.random() * 0.45));

    const bendLate = bendMain * -(0.42 + (Math.random() * 0.30));

    const liftBase = Math.min(Math.max(dist * 0.18, stageH * 0.06), stageH * 0.18);
    const lift1 = liftBase * (0.95 + (Math.random() * 0.45));
    const lift2 = liftBase * (0.25 + (Math.random() * 0.35));

    const c1x = startX + (dx * (0.20 + (Math.random() * 0.08))) + (nx * bendMain);
    const c1y = startY + (dy * 0.10) + (ny * bendMain) - lift1;

    const c2x = startX + (dx * (0.72 + (Math.random() * 0.10))) + (nx * bendLate);
    const c2y = startY + (dy * 0.86) + (ny * bendLate) - lift2;

    const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

    svg.setAttribute("viewBox", `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`);
    glowPath.setAttribute("d", d);
    sparkPath.setAttribute("d", d);

    let pathLen = 1;
    try {
      pathLen = Math.max(1, glowPath.getTotalLength());
    } catch(e) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const duration = Math.round(
      Math.min(1620, Math.max(1080, dist * (1.65 + (Math.random() * 0.20))))
    );

    fx.style.setProperty("--flight-len", String(pathLen));
    fx.style.setProperty("--flight-ms", `${duration}ms`);

    fx.classList.remove("is-active");
    void fx.offsetWidth;
    fx.classList.add("is-active");

    const easeInOut = (t) => 0.5 - (Math.cos(Math.PI * t) / 2);
    const lookAhead = Math.min(0.03, Math.max(0.010, 26 / pathLen));

    const startedAt = performance.now();

    const step = (now) => {
      const raw = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = easeInOut(raw);

      let point;
      let ahead;

      try {
        point = glowPath.getPointAtLength(pathLen * eased);
        ahead = glowPath.getPointAtLength(pathLen * Math.min(1, eased + lookAhead));
      } catch(e) {
        dust.style.opacity = "0";
        mount._hifzGoodFlightRaf = 0;
        return;
      }

      const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
      const alpha =
        raw < 0.08
          ? (raw / 0.08)
          : (raw > 0.92 ? Math.max(0, (1 - raw) / 0.08) : 1);

      const scale = 0.92 + (Math.sin(raw * Math.PI) * 0.18);

      dust.style.left = `${point.x}px`;
      dust.style.top = `${point.y}px`;
      dust.style.opacity = String(alpha);
      dust.style.transform = `translate(-50%, -50%) rotate(${angle}rad) scale(${scale})`;

      if (raw < 1) {
        mount._hifzGoodFlightRaf = requestAnimationFrame(step);
      } else {
        dust.style.opacity = "0";
        mount._hifzGoodFlightRaf = 0;
      }
    };

    mount._hifzGoodFlightTick = tick;
    mount._hifzGoodFlightRaf = requestAnimationFrame(step);

    mount._hifzGoodFlightArrivalTimer = setTimeout(() => {
      try {
        if (tick.isConnected) {
          tick.classList.remove("is-good-arrival");
          void tick.offsetWidth;
          tick.classList.add("is-good-arrival");

          setTimeout(() => {
            try { tick.classList.remove("is-good-arrival"); } catch(e) {}
          }, 460);
        }
      } catch(e) {}
    }, Math.max(420, Math.round(duration * 0.88)));

    mount._hifzGoodFlightClearTimer = setTimeout(() => {
      clearHifzGoodFlightFx();
    }, duration + 320);

    return {
      started:true,
      arrivalDelay: Math.max(420, Math.round(duration * 0.88)),
      totalDelay: duration + 120
    };
  };

  const ensureHifzRecallFlightFx = () => {
    let fx = document.querySelector(".hifzRecallFlightFx");
    if (fx) return fx;

    fx = document.createElement("div");
    fx.className = "hifzRecallFlightFx";
    fx.setAttribute("aria-hidden", "true");
    fx.innerHTML = `
      <svg class="hifzRecallFlightSvg" viewBox="0 0 1 1" preserveAspectRatio="none">
        <path class="hifzRecallFlightGlowPath"></path>
        <path class="hifzRecallFlightSparkPath"></path>
      </svg>
      <div class="hifzRecallFlightDust">
        <span class="hifzRecallFlightDustCore"></span>
        <span class="hifzRecallFlightDustMote is-a"></span>
        <span class="hifzRecallFlightDustMote is-b"></span>
        <span class="hifzRecallFlightDustMote is-c"></span>
        <span class="hifzRecallFlightDustMote is-d"></span>
      </div>
    `;
    document.body.appendChild(fx);
    return fx;
  };

  const clearHifzRecallFlightFx = () => {
    try { clearTimeout(Number(mount._hifzRecallFlightArrivalTimer || 0)); } catch(e) {}
    try { clearTimeout(Number(mount._hifzRecallFlightClearTimer || 0)); } catch(e) {}
    try {
      if (typeof mount._hifzRecallFlightRaf === "number" && mount._hifzRecallFlightRaf) {
        cancelAnimationFrame(mount._hifzRecallFlightRaf);
      }
    } catch(e) {}

    const fx = document.querySelector(".hifzRecallFlightFx");
    if (fx) {
      fx.classList.remove("is-active");
      fx.removeAttribute("data-kind");
      fx.style.removeProperty("--flight-len");
      fx.style.removeProperty("--flight-ms");

      const dust = fx.querySelector(".hifzRecallFlightDust");
      if (dust) {
        dust.style.left = "0px";
        dust.style.top = "0px";
        dust.style.opacity = "0";
        dust.style.transform = "translate(-50%, -50%)";
      }
    }

    try {
      if (mount._hifzRecallFlightTick && mount._hifzRecallFlightTick.isConnected) {
        mount._hifzRecallFlightTick.classList.remove("is-good-arrival", "is-bad-arrival");
      }
    } catch(e) {}

    mount._hifzRecallFlightTick = null;
    mount._hifzRecallFlightArrivalTimer = 0;
    mount._hifzRecallFlightClearTimer = 0;
    mount._hifzRecallFlightRaf = 0;
  };

  const runHifzRecallFlightFromButton = (btn, ref, kind = "good") => {
    const r = String(ref || "");
    const markKind = String(kind || "").toLowerCase() === "bad" ? "bad" : "good";

    if (!btn || !/^\d+:\d+$/.test(r)) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const tickSelector = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? `.suraTick[data-ref="${CSS.escape(r)}"]`
      : `.suraTick[data-ref="${r.replace(/"/g, '\\"')}"]`;

    const tick = document.querySelector(tickSelector);
    if (!tick) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const fx = ensureHifzRecallFlightFx();
    clearHifzRecallFlightFx();

    const svg = fx.querySelector(".hifzRecallFlightSvg");
    const glowPath = fx.querySelector(".hifzRecallFlightGlowPath");
    const sparkPath = fx.querySelector(".hifzRecallFlightSparkPath");
    const dust = fx.querySelector(".hifzRecallFlightDust");

    if (!svg || !glowPath || !sparkPath || !dust) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const startRect = btn.getBoundingClientRect();
    const endRect = tick.getBoundingClientRect();

    const startX = startRect.left + (startRect.width * 0.50);
    const startY = startRect.top + (startRect.height * 0.50);

    const endX = endRect.left + (endRect.width * 0.50);
    const endY = endRect.top + (endRect.height * 0.54);

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.max(1, Math.hypot(dx, dy));

    const rootCs = getComputedStyle(document.documentElement);
    const stageH = parseFloat(rootCs.getPropertyValue("--stage-h")) || window.innerHeight;

    const nx = -dy / dist;
    const ny = dx / dist;

    const bendSign = Math.random() < 0.5 ? -1 : 1;
    const bendMain =
      Math.min(Math.max(dist * 0.26, stageH * 0.10), stageH * 0.28) *
      bendSign *
      (0.85 + (Math.random() * 0.45));

    const bendLate = bendMain * -(0.42 + (Math.random() * 0.30));

    const liftBase = Math.min(Math.max(dist * 0.18, stageH * 0.06), stageH * 0.18);
    const lift1 = liftBase * (0.95 + (Math.random() * 0.45));
    const lift2 = liftBase * (0.25 + (Math.random() * 0.35));

    const c1x = startX + (dx * (0.20 + (Math.random() * 0.08))) + (nx * bendMain);
    const c1y = startY + (dy * 0.10) + (ny * bendMain) - lift1;

    const c2x = startX + (dx * (0.72 + (Math.random() * 0.10))) + (nx * bendLate);
    const c2y = startY + (dy * 0.86) + (ny * bendLate) - lift2;

    const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

    svg.setAttribute("viewBox", `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`);
    glowPath.setAttribute("d", d);
    sparkPath.setAttribute("d", d);

    let pathLen = 1;
    try {
      pathLen = Math.max(1, glowPath.getTotalLength());
    } catch(e) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    const duration = Math.round(
      Math.min(1660, Math.max(1100, dist * (1.62 + (Math.random() * 0.20))))
    );

    fx.setAttribute("data-kind", markKind);
    fx.style.setProperty("--flight-len", String(pathLen));
    fx.style.setProperty("--flight-ms", `${duration}ms`);

    fx.classList.remove("is-active");
    void fx.offsetWidth;
    fx.classList.add("is-active");

    const easeInOut = (t) => 0.5 - (Math.cos(Math.PI * t) / 2);
    const lookAhead = Math.min(0.03, Math.max(0.010, 26 / pathLen));
    const startedAt = performance.now();

    const step = (now) => {
      const raw = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = easeInOut(raw);

      let point;
      let ahead;

      try {
        point = glowPath.getPointAtLength(pathLen * eased);
        ahead = glowPath.getPointAtLength(pathLen * Math.min(1, eased + lookAhead));
      } catch(e) {
        dust.style.opacity = "0";
        mount._hifzRecallFlightRaf = 0;
        return;
      }

      const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
      const alpha =
        raw < 0.08
          ? (raw / 0.08)
          : (raw > 0.92 ? Math.max(0, (1 - raw) / 0.08) : 1);

      const scale = 0.92 + (Math.sin(raw * Math.PI) * 0.18);

      dust.style.left = `${point.x}px`;
      dust.style.top = `${point.y}px`;
      dust.style.opacity = String(alpha);
      dust.style.transform = `translate(-50%, -50%) rotate(${angle}rad) scale(${scale})`;

      if (raw < 1) {
        mount._hifzRecallFlightRaf = requestAnimationFrame(step);
      } else {
        dust.style.opacity = "0";
        mount._hifzRecallFlightRaf = 0;
      }
    };

    const arrivalDelay = Math.max(430, Math.round(duration * 0.88));
    const arrivalClass = markKind === "bad" ? "is-bad-arrival" : "is-good-arrival";
    const arrivalClassMs = markKind === "bad" ? 560 : 460;

    mount._hifzRecallFlightTick = tick;
    mount._hifzRecallFlightRaf = requestAnimationFrame(step);

    mount._hifzRecallFlightArrivalTimer = setTimeout(() => {
      try {
        if (tick.isConnected) {
          tick.classList.remove("is-good-arrival", "is-bad-arrival");
          void tick.offsetWidth;
          tick.classList.add(arrivalClass);

          setTimeout(() => {
            try { tick.classList.remove("is-good-arrival", "is-bad-arrival"); } catch(e) {}
          }, arrivalClassMs);
        }
      } catch(e) {}
    }, arrivalDelay);

    mount._hifzRecallFlightClearTimer = setTimeout(() => {
      clearHifzRecallFlightFx();
    }, duration + 360);

    return {
      started:true,
      arrivalDelay,
      totalDelay: duration + 140
    };
  };

  const runHifzTrainMaskRateFlight = (btn, ref, kind = "good") => {
    const r = String(ref || "").trim();
    const markKind = String(kind || "").trim().toLowerCase() === "bad" ? "bad" : "good";

    if (!btn || !/^\d+:\d+$/.test(r)) {
      return { started:false, arrivalDelay:0, totalDelay:340 };
    }

    return runHifzRecallFlightFromButton(btn, r, markKind);
  };

  window.runHifzTrainMaskRateFlight = runHifzTrainMaskRateFlight;

  mount.addEventListener("click", (e) => {
    const writeShell = e.target.closest("[data-hifz-write-shell]");
    if (writeShell) {
      const ref = String(writeShell.getAttribute("data-hifz-write-shell") || "");
      setTimeout(() => focusWriteInputByRef(ref), 0);
      return;
    }

    const unhideBtn = e.target.closest("[data-hifz-unhide]");
    if (unhideBtn) {
      e.preventDefault();
      e.stopPropagation();

      const ref = String(unhideBtn.getAttribute("data-hifz-unhide") || "");
      if (!/^\d+:\d+$/.test(ref)) return;

      setHifzAyahRevealed(ref, true);
      rerenderWithoutJump(ref, { forceNow: true });
      return;
    }

    const btn = e.target.closest("[data-hifz-mark][data-hifz-ref]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const ref = String(btn.getAttribute("data-hifz-ref") || "");
    const mark = String(btn.getAttribute("data-hifz-mark") || "").toLowerCase();

    if (!/^\d+:\d+$/.test(ref)) return;
    if (!(mark === "good" || mark === "bad")) return;

    setHifzAyahRevealed(ref, false);
    setWriteResultFlash(ref, "");

    const body = btn.closest(".hifzAyahBody");
    if (body) {
      body.classList.remove("is-hifz-good", "is-hifz-bad");
      body.classList.add(mark === "good" ? "is-hifz-good" : "is-hifz-bad");
    }

    const goNext = () => {
      const focusWriteNext = ["8", "9", "10"].includes(String(hifzStageValue || "1"));

      if (isHifzSingleFocusStage(String(hifzStageValue || "1"))) {
        const nextRef = getNextHifzFocusRef(ref);
        if (nextRef && nextRef !== ref) {
          setHifzAyahRevealed(nextRef, false);
          rerenderWithoutJump(nextRef, {
            focusWrite: focusWriteNext,
            forceNow: true
          });
          return;
        }
      }

      setHifzAyahRevealed(ref, false);
      rerenderWithoutJump(ref, {
        focusWrite: focusWriteNext,
        forceNow: true
      });
    };

    const flight = runHifzRecallFlightFromButton(btn, ref, mark);

    if (flight.started) {
      setTimeout(() => {
        setHifzResultForRef(ref, hifzStageValue, mark);
        try { window.__suraProgRefresh?.(); } catch(e) {}
      }, flight.arrivalDelay);

      setTimeout(goNext, flight.totalDelay);
      return;
    }

    clearHifzRecallFlightFx();
    setHifzResultForRef(ref, hifzStageValue, mark);
    setTimeout(goNext, mark === "bad" ? 380 : 340);
  });

  mount.addEventListener("input", (e) => {
    const input = e.target.closest("[data-hifz-write-input]");
    if (!input) return;
    handleWriteRawInput(input, String(input.value || ""));
  });

  mount.addEventListener("compositionend", (e) => {
    const input = e.target.closest("[data-hifz-write-input]");
    if (!input) return;
    handleWriteRawInput(input, String(e.data || input.value || ""));
  });

mount.addEventListener("keydown", (e) => {
  const input = e.target.closest("[data-hifz-write-input]");
  if (!input) return;

  const ref = String(input.getAttribute("data-hifz-write-input") || "");

  if (e.key === "Enter") {
    e.preventDefault();
    return;
  }

  if (isWriteInputCoolingDown(ref) && e.key !== "Tab") {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (e.key === "Tab" && ["8", "9", "10"].includes(String(hifzStageValue || "1"))) {
    setTimeout(() => {
      const nextRef = String(input.getAttribute("data-hifz-write-input") || "");
      focusWriteInputByRef(nextRef);
    }, 0);
  }
});

if (["8", "9", "10"].includes(String(hifzStageValue || "1"))) {
  requestAnimationFrame(() => {
    focusWriteInputByRef(String(currentRef || ""));
  });
}
}

const CHUNK = 40; // normal
const FAST_CHUNK = 200; // ✅ viel kleiner (Performance!)
  const turboActive = (targetRef) =>
    window.__turboJumpRef === targetRef &&
    typeof window.__turboJumpUntil === "number" &&
    performance.now() < window.__turboJumpUntil;
let i = 0;
let lastSurah = null;
// ⭐ Favorites-Markierungen: immer aus der AKTIVEN Favoritenseite (actual ODER preset)
// (damit Mushaf die markierten Ayat der ausgewählten Seite zeigt)
let bmSet = new Set(getActiveFavRefs());

// Turbo nur bis Ziel wirklich im DOM ist
let targetIdx = -1;
let turboDone = false;

// Cache-Flags für Scroll-Handler (damit nicht ständig querySelectorAll)
view.__ayahCacheDirty = true;
view.__ayahCardsCache = null;

if (renderAll) {
  const target = parseRefLoose(ref) || ref;
  targetIdx = refs.indexOf(String(target));
}

function renderChunk() {
  const step =
    (renderAll && targetIdx >= 0 && !turboDone && i < targetIdx) ? FAST_CHUNK : CHUNK;

  const end = Math.min(refs.length, i + step);
  let html = "";

  for (; i < end; i++) {
    const r = refs[i];
    const a = getAyah(r);
    if (!a) continue;

        // ✅ Surah-Header einfügen, wenn Surah wechselt
    if (renderAll && a.surah !== lastSurah) {
      lastSurah = a.surah;
      const sm2 = getSuraMeta(lastSurah);
      const headerModeText = (viewMode === "mushaf") ? "Ayah mode" : "Mushaf mode";

html += `
  <div class="surahTopBar ayahSurahHeader" data-surah="${lastSurah}">
    <div class="surahTopFarLeft">
      <button class="btnCircle playStop suraPlayBtn" type="button" data-surah="${lastSurah}" aria-label="Play/Stop Sura ${lastSurah}">
        <svg class="icon icon-play" viewBox="0 0 24 24"><path d="M8 5v14l12-7z"></path></svg>
        <svg class="icon icon-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
      </button>
    </div>

    <div class="surahTitle is-compact">
      <span class="sNum">${lastSurah}</span>
      <span class="dot">•</span>
      <span class="sEn">${sm2?.nameTranslit ?? ""}</span>
      <span class="dot">•</span>
      <span class="sAr" dir="rtl" lang="ar">${sm2?.nameAr ?? ""}</span>
    </div>

    <div class="surahTopRight">
      <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch view mode">
        <span class="modeText">${headerModeText}</span>
        <span class="modeArrow">→</span>
      </button>
    </div>
  </div>
`;
html += basmCardHtml(lastSurah);

    }

    const ayahNo = a.ayah;
    const wordsHtml = buildWordSpans({ ...a, ayahNo });
    const mp3 = ayahMp3Url(a.surah, ayahNo);

html += `
  <div class="ayahCard ayahMainCard hifzAyahCard" data-ref="${a.ref}" tabindex="0">
    ${buildHifzAyahHeaderHtml(a, mp3, esc)}

    ${buildHifzAyahBodyHtml(a, wordsHtml, esc)}
  </div>
`;
  }

  mount.insertAdjacentHTML("beforeend", html);
  applyAyahJustify(mount);
  try { window.__refreshNoteIndicators?.(); } catch(e){}
  try { __syncContinueButtons(); } catch(e){}

    // ✅ neue Nodes drin → Cache für Scroll-Handler ist jetzt “dirty”
  view.__ayahCacheDirty = true;

  // ✅ Turbo stoppen, sobald Ziel wirklich gerendert ist (dann wieder sanft weiter)
  if (!turboDone && renderAll && targetIdx >= 0) {
    const targetRef = String(parseRefLoose(ref) || ref);
    const exists = !!view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(targetRef)}"]`);
    if (exists) turboDone = true;
  }

  // ✅ Weiter rendern (auch im Single-Sura Mode in Chunks!)
  if (i < refs.length) {
    if (renderAll) {
      view.__ayahRenderJob = scheduleRender(renderChunk, { timeout: 120 });
    } else {
      // single-sura: weiter in rAF-Chunks, damit ALLE Ayat gebaut werden
      view.__ayahRenderJob = requestAnimationFrame(renderChunk);
    }
  } else {
    // fertig
    view.__ayahRenderJob = null;
    syncPlayingCardGlow();
  }

}

renderChunk();

  // Click handling (nur einmal binden)
  if (!view.__ayahHandlersBound) {
    view.__ayahHandlersBound = true;
    view.addEventListener("click", (ev) => {
    const t = ev.target;

    // ✅ Notes button (Ayah Cards)
const noteBtn = t?.closest?.("button.ayahNote[data-note]");
if (noteBtn) {
  ev.preventDefault();
  ev.stopPropagation();
  const ref = noteBtn.dataset?.note || "";
  if (ref) openNotesForRef(ref);
  return;
}

// ✅ Copy button (Ayah Cards)
const copyBtn = t?.closest?.("button.ayahCopy[data-copy]");
if (copyBtn) {
  ev.preventDefault();
  ev.stopPropagation();
  const ref = copyBtn.dataset?.copy || "";
  if (ref) copyAyahRef(ref, { flashEl: copyBtn });
  return;
}



// ✅ Continue button (nur wenn SurahPlay aktiv + gleiche Sura)
const contBtn = t?.closest?.("button.ayahContinueBtn[data-continue]");
if (contBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const ref = String(contBtn.dataset?.continue || "");
  if (!/^\d+:\d+$/.test(ref)) return;

  const [sStr, aStr] = ref.split(":");
  const s = Number(sStr), ay = Number(aStr);

  // nur wenn gerade eine Sura-Queue läuft und es die gleiche Sura ist
  if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
    try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
  }
  return;
}

    const stageTrendToggleBtn = t?.closest?.('[data-action="toggleStageTrendCollapse"]');
if (stageTrendToggleBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  saveHifzStageTrendCollapsed(!loadHifzStageTrendCollapsed());
  applyHifzStageTrendCollapsedUi(view);
  return;
}

    const toggleBtn = t?.closest?.('[data-action="toggleView"]');
if (toggleBtn) {
  console.log("[toggleView] click", { viewModeBefore: viewMode, currentRef });
  toggleViewMode();
  console.log("[toggleView] after", { viewModeAfter: viewMode, currentRef });
  return;
}

const suraBtn = t?.closest?.("button.suraPlayBtn");
if (suraBtn) {
  const s = Number(suraBtn.dataset?.surah || 0);
  if (s >= 1 && s <= 114) {
    toggleSurahPlaybackFromBtn(s, suraBtn);
  }
  return;
}

// ⭐ Bookmark UI sync (nach initialem Render) ✅ immer nach aktiver Favoritenseite (actual ODER preset)
requestAnimationFrame(() => {
  const list = getActiveFavRefs();                 // ✅ active page
  const set = new Set((list || []).map(String));   // schneller lookup
  view.querySelectorAll("button.ayahBm[data-bm]").forEach((el) => {
    const r = el.getAttribute("data-bm") || "";
    el.classList.toggle("is-on", set.has(r));
  });
});

    // ✅ Word click
    const wEl = t?.closest?.(".w");
    if (wEl && wEl.dataset?.wi != null) {
stopSurahQueue();
stopVerseAudio();      // ✅ Ayah/Basm stoppen
playWordFromSpan(wEl);
return;
    }

// ⭐ Bookmark toggle ✅ immer über active page togglen (actual ODER preset) – überall in der App
const bmBtn = t?.closest?.("button.ayahBm");
if (bmBtn) {
  const r = bmBtn.dataset?.bm || bmBtn.getAttribute("data-bm") || "";

  const res = toggleFavInActivePage(r); // ✅ entscheidet selbst: actual vs preset

  if (res && res.ok) {
    // bmSet ist bei dir "actual bookmarks"-Cache -> nur updaten, wenn active page = actual
    const affectsActual = (!favPresetActiveName || favPresetActiveName === "actual");
    if (affectsActual) {
      if (res.bookmarked) bmSet.add(r);
      else bmSet.delete(r);
    }

    bmBtn.classList.toggle("is-on", !!res.bookmarked);
  }

  // ✅ Wenn wir auf der Favoriten-Seite sind: Liste direkt neu rendern
  if (__inFavoritesPage) {
    renderFavoritesPage();
  }
  return;
}

    
    const btn = t?.closest?.("button.ayahPlay");
    if (btn) {
      const isHifzTestModeHere = !!view.querySelector(".hifzTestTopBar");

      // ✅ Im Testmodus soll Ayah-Play gar nichts machen
      if (isHifzTestModeHere) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const card = btn.closest(".ayahMainCard");
      const r = card?.dataset?.ref || "";

      // ✅ Nur echte Ayah-Refs setzen (basm:* ignorieren)
      if (/^\d+:\d+$/.test(r)) {
        currentRef = r;
        setRefToHash(r);
        focusAyahCard(view, r);

        const a = getAyah(r);
        if (a) currentSurahInView = a.surah;
      }

      stopSurahQueue();
      playFromButton(btn, btn.dataset.audio);
      return;
    }

    // ✅ Card focus
    const card = t?.closest?.(".ayahMainCard");
    if (card?.dataset?.ref) {
    focusAyahCard(view, card.dataset.ref);
      }
    });
   }

    // ✅ erst fokussieren wenn die Ziel-Ayah wirklich gerendert ist (Chunking!)
    scrollToAyahWhenReady(view, ref, { scroll: "instant" });

    // ✅ falls gerade Audio läuft: Button-Status nach Render wieder herstellen
    if (verseAudio && verseRefPlaying) {
    const newCard = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(verseRefPlaying)}"]`);
    const newBtn  = newCard?.querySelector("button.ayahPlay");
    if (newBtn) verseBtnPlaying = newBtn;
    syncVerseBtnState();
    }
    syncPlayingCardGlow();

  // ✅ Ayah-Mode: Auto-Fokus beim Scrollen (wie Mushaf) — nur 1x binden + rAF throttle
  if (!view.__ayahScrollBound) {
    view.__ayahScrollBound = true;

    const rebuildAyahScrollCache = () => {
      view.__ayahCardsCache = Array.from(view.querySelectorAll(".ayahMainCard[data-ref]"))
        .filter((c) => /^\d+:\d+$/.test(c.dataset.ref || ""))
        .map((c) => ({
          el: c,
          ref: String(c.dataset.ref || ""),
          center: c.offsetTop + (c.offsetHeight / 2)
        }));

      view.__ayahCacheDirty = false;
    };

    const markAyahScrollCacheDirty = () => {
      view.__ayahCacheDirty = true;
    };

    window.addEventListener("resize", markAyahScrollCacheDirty, { passive: true });
    window.addEventListener("orientationchange", markAyahScrollCacheDirty, { passive: true });

    view.addEventListener("scroll", () => {
      // ✅ wenn Render-All pausiert war: beim Scrollen weiter rendern
      if (renderAll && i < refs.length && !view.__ayahRenderJob) {
        view.__ayahRenderJob = scheduleRender(renderChunk, { timeout: 120 });
      }

      // rAF-throttle (wie Mushaf)
      if (view.__ayahRAF) return;
      view.__ayahRAF = requestAnimationFrame(() => {
        view.__ayahRAF = 0;

        if (view.__ayahCacheDirty || !view.__ayahCardsCache) {
          rebuildAyahScrollCache();
        }

        const cards = view.__ayahCardsCache;
        if (!cards.length) return;

        const cy = view.scrollTop + (view.clientHeight * 0.40);

        let best = null;
        let bestDist = Infinity;

        for (const item of cards) {
          const d = Math.abs(item.center - cy);
          if (d < bestDist) {
            bestDist = d;
            best = item;
          }
        }

        const rBest = best?.ref;
        if (!rBest) return;

        // ✅ Wenn Ayah-Audio läuft: Fokus NICHT wechseln (lock wie Mushaf)
        if (verseAudio && !verseAudio.paused && verseRefPlaying) {
          focusAyahCard(view, verseRefPlaying, { scroll: false });
          syncPlayingCardGlow();
          return;
        }

        // ✅ Surah-Kontext sauber setzen (zentral), nur wenn nötig
        const aBest = getAyah(rBest);
        if (aBest?.surah && aBest.surah !== currentSurahInView) {
          currentSurahInView = aBest.surah;
          try { setSurahContext(aBest.surah); } catch (e) {}
        }

        // Ayahmode Topbar live halten (falls sichtbar)
        if (aBest?.surah) {
          try { setLiveTopbarSurah(view, aBest.surah); } catch (e) {}
        }

        // normaler Auto-Fokus
        focusAyahCard(view, rBest, { scroll: false });
        syncPlayingCardGlow();
      });
    }, { passive: true });
  }
    }

    // =========================
// Smooth scroll helper (ultra smooth, no jitter)
// Scrollt IM Container (qView / mView) und zentriert das Ziel
// =========================
let __qrScrollAnimToken = 0;

function __qrEaseInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function __qrClamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function __qrScrollContainerTo(container, targetY, { behavior = "smooth", duration = 420 } = {}) {
  if (!container) return;

  const maxY = Math.max(0, (container.scrollHeight || 0) - (container.clientHeight || 0));
  const to = __qrClamp(targetY, 0, maxY);

  // instant
  if (behavior === "instant" || behavior === "auto") {
    container.scrollTop = to;
    return;
  }

  const from = container.scrollTop;
  const delta = to - from;

  // already there
  if (Math.abs(delta) < 0.5) return;

  const token = ++__qrScrollAnimToken;
  const t0 = performance.now();

  // optional: mark as auto-scrolling (falls du irgendwo gate/logik hast)
  try { window.__qrAutoScrollActiveUntil = Date.now() + duration + 160; } catch (e) {}

  const step = (now) => {
    if (token !== __qrScrollAnimToken) return; // cancelled by newer scroll
    const t = __qrClamp((now - t0) / duration, 0, 1);
    const y = from + delta * __qrEaseInOut(t);
    container.scrollTop = y;
    if (t < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

function __qrScrollElementToCenter(container, el, { behavior = "smooth", duration = 420 } = {}) {
  if (!container || !el) return;

  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();

  const curTop = container.scrollTop;
  const elCenterInContainer = (eRect.top - cRect.top) + curTop + (eRect.height / 2);
  const targetCenter = (container.clientHeight / 2);

  const targetY = elCenterInContainer - targetCenter;
  __qrScrollContainerTo(container, targetY, { behavior, duration });
}

  function scrollToAyahWhenReady(view, ref, { scroll = "instant", timeoutFrames = 240 } = {}) {
  const targetRef = String(parseRefLoose(ref) || ref);

  let tries = 0;

  const tick = () => {
    const card = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(targetRef)}"]`);

    if (card) {
      // ✅ Wenn gerade Auto-Smooth-Scroll läuft ODER Audio läuft:
      // "instant" darf NICHT dazwischenfunken (sonst Zucken/Doppelscroll).
      let effectiveScroll = scroll;

      try {
        const now = Date.now();
        const autoBusy =
          typeof window.__qrAutoScrollActiveUntil === "number" &&
          now < window.__qrAutoScrollActiveUntil;

        const audioPlaying =
          (typeof verseAudio !== "undefined") &&
          verseAudio &&
          !verseAudio.paused;

        if (scroll === "instant" && (autoBusy || audioPlaying)) {
          effectiveScroll = false; // nur Fokus/Highlight, kein Jump
        }
      } catch (e) {}

      focusAyahCard(view, targetRef, { scroll: effectiveScroll });

      // ✅ Jump feedback AUS (Ziel ist jetzt da)
      try { window.__setJumpBusy?.(false); } catch {}

      return;
    }

    // solange Chunking noch läuft, warten wir ein paar Frames
    if (tries++ < timeoutFrames) {
      requestAnimationFrame(tick);
      return;
    }

    console.warn("[jump] target not rendered in time:", targetRef);
  };

  tick();
}

function scrollToMushafNoWhenReady(view, ref, { updateUrl = false, scroll = true, timeoutFrames = 240 } = {}) {
  const targetRef = String(parseRefLoose(ref) || ref);

  let tries = 0;

  const tick = () => {
    const btn = view.querySelector(`.mNo[data-ref="${CSS.escape(targetRef)}"]`);

    if (btn) {
      // entspricht deiner bestehenden Fokus-Logik: Klasse setzen, currentRef setzen, optional URL, optional scroll
      view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
      btn.classList.add("is-focus");

      currentRef = targetRef;
      if (updateUrl) setRefToHash(targetRef);

      // ✅ Im Hifz-Trainmode nach renderCurrent KEIN Mushaf-Refocus-Scroll
      let allowScroll = !!scroll;
      try {
        if (isHifzTrainMaskOn()) allowScroll = false;

        const now = Date.now();
        const autoBusy =
          typeof window.__qrAutoScrollActiveUntil === "number" &&
          now < window.__qrAutoScrollActiveUntil;
        if (autoBusy) allowScroll = false;
      } catch (e) {}

      if (allowScroll) {
        try {
          const viewRect = view.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          const topMargin = Math.max(24, viewRect.height * 0.10);
          const bottomMargin = Math.max(24, viewRect.height * 0.10);

          const fullyInsideVisibleBand =
            btnRect.top >= (viewRect.top + topMargin) &&
            btnRect.bottom <= (viewRect.bottom - bottomMargin);

          if (!fullyInsideVisibleBand) {
            __qrScrollElementToCenter(view, btn, { behavior: "smooth" });
          }
        } catch (e) {}
      }

      // ✅ Jump feedback AUS (Ziel ist jetzt da)
      try { window.__setJumpBusy?.(false); } catch {}
      return;
    }

    if (tries++ < timeoutFrames) {
      requestAnimationFrame(tick);
      return;
    }

    console.warn("[mushaf jump] target not rendered in time:", targetRef);
  };

  tick();
}

function focusAyahCard(view, ref, { scroll = false } = {}) {
  currentRef = ref;

  view.querySelectorAll(".ayahMainCard.is-focus").forEach((el) => el.classList.remove("is-focus"));
  const card = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(ref)}"]`);
  if (!card) return;

  card.classList.add("is-focus");
  card.focus({ preventScroll: true });

  // ✅ Surah-Kontext sauber halten (nur wenn echte Ayah + nur wenn sich Sura ändert)
  try {
    if (/^\d+:\d+$/.test(String(ref || ""))) {
      const a = getAyah(ref);
      if (a?.surah && a.surah !== currentSurahInView) {
        currentSurahInView = a.surah;
        try { setSurahContext(a.surah); } catch (e) {}
      }
      // Ayahmode Topbar live halten (falls sichtbar)
      if (a?.surah) {
        try { setLiveTopbarSurah(view, a.surah); } catch (e) {}
      }
    }
  } catch (e) {}

  // ✅ scroll modes:
  // false = gar nicht
  // "instant" = sofort (kein smooth)
  // true = smooth

  // ✅ Anti-Doppelscroll (verhindert jitter: 2x Scroll zur selben Ayah in kurzer Zeit)
  let allowScroll = true;
  try {
    const now = Date.now();
    const rKey = String(ref || "");
    const last = window.__lastFocusScroll || { ref: "", t: 0 };

    if ((scroll === true || scroll === "instant") && last.ref === rKey && (now - last.t) < 650) {
      allowScroll = false; // 2. Scroll zu schnell -> ignorieren
    } else if (scroll === true || scroll === "instant") {
      window.__lastFocusScroll = { ref: rKey, t: now };
    }
  } catch (e) {}

  if (allowScroll) {
    if (scroll === "instant") {
      __qrScrollElementToCenter(view, card, { behavior: "instant" });
    } else if (scroll === true) {
      __qrScrollElementToCenter(view, card, { behavior: "smooth" });
    }
  }

  // Ping (bleibt)
  card.classList.remove("is-ping");
  requestAnimationFrame(() => {
    card.classList.add("is-ping");
    setTimeout(() => card.classList.remove("is-ping"), 600);
  });
}

// =========================
// Mushaf Mode (Best-of, nutzt textAr via buildWordSpans)
// =========================
function ensureMView() {
  const stage = document.getElementById("stage");
  if (!stage) return null;

  let view = stage.querySelector(".mView");
  if (!view) {
    view = document.createElement("div");
    view.className = "mView";
    view.style.display = "none";
    stage.appendChild(view);
  }
  return view;
}

// =========================
// Mushaf Justify (ALWAYS ON)
// =========================
const mushafJustifyState = {
  on: true,          // ✅ immer an
};

function _mushafFlowEl() {
  return document.querySelector(".mView .mFlow");
}

// Fügt Spaces zwischen benachbarten Word-Spans ein (damit justify funktioniert)
// ✅ Wichtig: wir fügen NUR echte Leerzeichen ein – KEIN Marker-Text mehr.
function _mushafInsertSpaces(flow) {
  if (!flow) return;

  const isWord = (n) =>
    n?.nodeType === 1 && (n.classList.contains("w") || n.classList.contains("mw"));
  const isMark = (n) => n?.nodeType === 1 && n.classList.contains("wMark");

  flow.querySelectorAll(".mText, .mChunk").forEach((line) => {
    let n = line.firstChild;

    while (n) {
      const next = n.nextSibling;
      if (!next) break;

      // Nur wenn zwei ELEMENTE direkt nebeneinander liegen (kein Text dazwischen)
      if (n.nodeType === 1 && next.nodeType === 1) {
        const needSpace =
          (isWord(n) && isWord(next) && !isMark(next)) ||
          (isMark(n) && isWord(next));

        if (needSpace) {
          const after = n.nextSibling;

          // ✅ Schon ein whitespace-textnode vorhanden? Dann nix einfügen.
          const hasWS =
            after &&
            after.nodeType === 3 &&
            /^\s+$/.test(after.nodeValue || "");

          if (!hasWS) {
            n.after(document.createTextNode(" "));
          }
        }
      }

      n = next;
    }
  });
}

function applyMushafJustify() {
  const flow = _mushafFlowEl();
  if (!flow) return;

  // CSS-Justify aktiv (dein CSS ist schon da)
  flow.classList.add("is-justify");

  // Spaces einfügen (idempotent durch hasWS-check)
  _mushafInsertSpaces(flow);
}

// ✅ Mushaf Justify: immer an (kein Hotkey)
window.__quran = window.__quran || {};
// optional: falls du mal manuell triggern willst:
window.__quran.applyMushafJustify = applyMushafJustify;

// =========================
// Ayah-Mode Justify (Word-Spans) – ALWAYS ON
// =========================
function _ayahInsertSpaces(box) {
  if (!box) return;

  const isWord = (n) =>
    n?.nodeType === 1 && (n.classList.contains("w") || n.classList.contains("mw"));
  const isMark = (n) => n?.nodeType === 1 && n.classList.contains("wMark");

  let n = box.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (!next) break;

    // nur wenn 2 Elemente direkt nebeneinander liegen (kein Text dazwischen)
    if (n.nodeType === 1 && next.nodeType === 1) {
      const needSpace =
        (isWord(n) && isWord(next) && !isMark(next)) ||
        (isMark(n) && isWord(next));

      if (needSpace) {
        const after = n.nextSibling;

        // schon whitespace da? dann nix
        const hasWS =
          after &&
          after.nodeType === 3 &&
          /^\s+$/.test(after.nodeValue || "");

        if (!hasWS) n.after(document.createTextNode(" "));
      }
    }

    n = next;
  }
}

function applyAyahJustify(root) {
  if (!root) return;

  // ✅ Cache: wenn Width + Font-Scale gleich sind, skippen wir Messung
  const docCS = getComputedStyle(document.documentElement);
  const arScale = (docCS.getPropertyValue("--ar-font-scale") || "").trim();
  const stageW  = (docCS.getPropertyValue("--stage-w") || "").trim();
  const cacheKeyBase = `${arScale}|${stageW}`;

  root.querySelectorAll(".ayahText").forEach((el) => {
    // 1) Spaces sicherstellen (für justify)
    _ayahInsertSpaces(el);

    // ✅ Quick-cache: wenn Elementbreite + global key gleich, nicht erneut messen
    const w = el.clientWidth || 0;
    const cacheKey = `${cacheKeyBase}|${w}`;

    if (el.dataset.justifyKey === cacheKey) {
      // nichts tun (klassenzustand ist schon gesetzt)
      return;
    }

    // 2) Entscheiden ob justify sinnvoll ist (nur wenn Cache miss)
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 0;

    // Layout-read: nur im Cache-Miss
    const h = el.getBoundingClientRect().height || 0;

    const lines = (lh > 0) ? (h / lh) : 2;
    const shouldJustify = lines >= 1.35;

    el.classList.toggle("is-justify", shouldJustify);

    // Cache setzen
    el.dataset.justifyKey = cacheKey;
  });
}

// optional fürs Debug
window.__quran = window.__quran || {};
window.__quran.applyAyahJustify = applyAyahJustify;

function renderMushaf(ref) {
  const view = ensureMView();
  if (!view) return;

  const ay = getAyah(ref);
  if (!ay) {
    view.innerHTML = `<div class="ayahCard">Ayah nicht gefunden: <b>${ref}</b></div>`;
    return;
  }

  const surah = ay.surah;
  const sm = getSuraMeta(surah);
  const renderAll = window.__renderAllQuran === true;
  const refsRaw = renderAll
    ? getAllRefs()
    : ((typeof getSuraRefs === "function") ? getSuraRefs(surah) : []);

  const rawRange = String(hifzRangeValue || "5-10").trim();
  const mRange = rawRange.match(/^(\d+)\s*-\s*(\d+)$/);

  let fromAyah = 1;
  let toAyah = Number(sm?.ayahCount || refsRaw.length || 1);

  if (mRange) {
    fromAyah = Math.max(1, Number(mRange[1]) || 1);
    toAyah = Math.max(1, Number(mRange[2]) || fromAyah);
  }

  if (toAyah < fromAyah) {
    const tmp = fromAyah;
    fromAyah = toAyah;
    toAyah = tmp;
  }

  const maxAyah = Number(sm?.ayahCount || refsRaw.length || 1);
  fromAyah = Math.min(fromAyah, maxAyah);
  toAyah = Math.min(toAyah, maxAyah);

  const refs = renderAll
    ? refsRaw
    : refsRaw.filter((r) => {
        const a = getAyah(r);
        if (!a || a.surah !== surah) return false;
        return a.ayah >= fromAyah && a.ayah <= toAyah;
      });

  const toArDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

const modeText = "Test";
const trainModeOn = isHifzTrainMaskOn();
const escTopBarAttr = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
const escSummary = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
const hifzStageInfoTitle = "Stage";
const hifzStageInfoText = "Chooses the current hifz stage. Higher stages remove more help and expect stronger recall.";
const hifzRepeatInfoTitle = "Right target";
const hifzRepeatInfoText = "How many correct recalls this ayah needs before it counts as learned for the current stage.";
const hifzRangeInfoTitle = "Range";
const hifzRangeInfoText = "Limits the trained ayahs inside the current surah. Example: 5-10.";
const trainModeInfoTitle = isHifzTrainWriteStage()
  ? "Hides the ayahs in the active range behind a cover until you reveal them. Click, hover, or press Space to reveal. Press Ctrl + Space to cover the current ayah again. In stages 8 to 10, write the ayah directly inside the revealed ayah box. After two wrong letters the ayah is marked bad; when written correctly it is marked good. Press Escape to leave trainmode."
  : "Hides the ayahs in the active range behind a cover until you reveal them. Click, hover, or press Space to reveal. Press Ctrl + Space to cover the current ayah again. Then rate with 1 for bad or 3 for good. Press Escape to leave trainmode.";

// ✅ Mushaf: Favoriten-Markierung muss die AKTIVE Favoritenseite nutzen (actual ODER preset)
let favSet = new Set((getActiveFavRefs?.() || []).map(String));
const isFavActive = (ref) => favSet.has(String(ref || ""));

const topBarHtml = renderAll ? "" : `
  <div class="surahTopBar mushafTopBar hifzTrainTopBar">
    <div class="surahTopFarLeft">
      <button class="btnCircle playStop suraPlayBtn" type="button" data-surah="${surah}" aria-label="Play selected range">
        <svg class="icon icon-play" viewBox="0 0 24 24"><path d="M8 5v14l12-7z"></path></svg>
        <svg class="icon icon-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
      </button>

      <div class="hifzTopControls">
        <div class="hifzControlWithInfo">
          <div class="hifzControlField">
            ${buildHifzStageDropdownHtml(hifzStageValue)}
            <span
              class="hifzHelpInfo"
              data-hifz-help="stage"
              data-hifz-help-title="${escTopBarAttr(hifzStageInfoTitle)}"
              data-hifz-help-text="${escTopBarAttr(hifzStageInfoText)}"
              aria-label="${escTopBarAttr(hifzStageInfoText)}">?</span>
          </div>
        </div>

        <div class="hifzControlWithInfo">
          <div class="hifzControlField hifzRepeatSelectWrap">
            <select class="hifzRepeatSelect" id="hifzRepeatTargetTop" aria-label="How often repeated the ayah right to mark it as learned">
              ${(() => {
                const values = [
                  ...Array.from({ length: 100 }, (_, i) => i + 1),
                  ...Array.from({ length: 9 }, (_, i) => (i + 2) * 100),
                  ...Array.from({ length: 18 }, (_, i) => 1500 + (i * 500))
                ];

                return values.map((n) => {
                  const sel = n === loadHifzRepeatTarget() ? ' selected' : '';
                  return `<option value="${n}"${sel}>${n}x right</option>`;
                }).join("");
              })()}
            </select>
            <span class="hifzRepeatArrow" aria-hidden="true">▼</span>
            <span
              class="hifzHelpInfo"
              data-hifz-help="repeat"
              data-hifz-help-title="${escTopBarAttr(hifzRepeatInfoTitle)}"
              data-hifz-help-text="${escTopBarAttr(hifzRepeatInfoText)}"
              aria-label="${escTopBarAttr(hifzRepeatInfoText)}">?</span>
          </div>
        </div>

        <div class="hifzControlWithInfo">
          <div class="hifzControlField">
            <input
              class="hifzRangeInput"
              id="hifzRangeInputTop"
              type="text"
              inputmode="text"
              value="5-10"
              placeholder="5-10"
              aria-label="Ayah range to train">
            <span
              class="hifzHelpInfo"
              data-hifz-help="range"
              data-hifz-help-title="${escTopBarAttr(hifzRangeInfoTitle)}"
              data-hifz-help-text="${escTopBarAttr(hifzRangeInfoText)}"
              aria-label="${escTopBarAttr(hifzRangeInfoText)}">?</span>
          </div>
        </div>
      </div>
    </div>

    <div class="surahTopLeft">
      <div class="surahTitle surahTopTitle">
        <span class="sEn">Train</span>
      </div>
    </div>

    <div class="surahTopRight">
      ${buildHifzBadRefsTopbarHtml()}

      <button
        class="hifzTrainModeBtn${trainModeOn ? " is-on" : ""}"
        type="button"
        data-action="toggleTrainModeMask"
        aria-pressed="${trainModeOn ? "true" : "false"}">
        <span class="hifzTrainModeBtnLabel">TRAINMODE</span>
        <span
          class="hifzTrainModeBtnInfo hifzHelpInfo"
          data-hifz-help="trainmode"
          data-hifz-help-title="Trainmode"
          data-hifz-help-text="${escTopBarAttr(trainModeInfoTitle)}"
          aria-hidden="true">?</span>
      </button>

      <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch to test mode">
        <span class="modeText">${modeText}</span>
        <span class="modeArrow">→</span>
      </button>
    </div>
  </div>
`;

const centerTitleHtml = `
  <div class="mCenter">
    <div class="mMushafHeader">
      <div class="mSurahName" dir="rtl" lang="ar">سورة ${sm?.nameAr ?? ""}</div>
      ${
        (!renderAll && Number(fromAyah) <= 1 && Number(toAyah) >= 1 && Number(surah) !== 1 && Number(surah) !== 9)
          ? `<div class="mBasm" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>`
          : ``
      }
    </div>
  </div>
`;

view.innerHTML = `
  ${topBarHtml}
  ${renderAll ? "" : centerTitleHtml}
  <div class="mBody">
    <div class="mFlow" dir="rtl" lang="ar"></div>
  </div>
  <div class="hifzProgressBottomStack"><div class="hifzStageTrendMount"></div><div class="hifzSurahSummaryMount"></div></div>
`;

const flow = view.querySelector(".mFlow");
const trendMount = view.querySelector(".hifzStageTrendMount");
const surahSummaryMount = view.querySelector(".hifzSurahSummaryMount");

if (trendMount) {
  trendMount.innerHTML = buildHifzStageTrendHtml();
}

function buildHifzTrainInlineWriteHtml(a, esc){
  const ref = String(a?.ref || "");
  const stage = String(hifzStageValue || "1");

  const model = buildHifzWriteModelForRef(ref);
  const writeState = getHifzWriteStateForRef(ref);
  const visibleTokenCount = Math.max(0, Math.min(model.targetChars.length, Number(writeState.cursor) || 0));
  const flashGoodTokenIndex = Number(writeState.flashGoodTokenIndex);
  const flashBadTokenIndex = Number(writeState.flashBadTokenIndex);
  const badChar = String(writeState.flashBadChar || "");
  const persistentBadChar = String(writeState.lastWrongChar || "");
  const persistentBadTokenIndex = Number(writeState.lastWrongTokenIndex);
  const hasPersistentBad = !!persistentBadChar && persistentBadTokenIndex >= 0;
  const showFullErrorPreview = !!writeState.showFullErrorPreview && !!badChar;
  const resultFlash = String(__hifzWriteResultFlashMap[ref] || "");
  const safeInputId = `hifzTrainWriteInput-${ref.replace(/:/g, "-")}`;
  const fullWriteText = String(model.displayText || "");
  const firstTrainRef = String(getHifzNavigableRefsForCurrentStage()?.[0] || "");
  const showStartHint = ref === firstTrainRef;

  const buildWrongStackHtml = (token, wrongChar) => {
    if (!token) return "";

    const baseHtml = token.isSpace
      ? `<span class="hifzWriteErrorStackBase is-space" aria-hidden="true">&nbsp;</span>`
      : `<span class="hifzWriteErrorStackBase">${esc(token.char)}</span>`;

    const overlayHtml = /\s/.test(wrongChar)
      ? `<span class="hifzWriteTextErrorInline is-space" aria-hidden="true">&nbsp;</span>`
      : `<span class="hifzWriteTextErrorInline">${esc(wrongChar)}</span>`;

    return `<span class="hifzWriteErrorStack${token.isSpace ? " is-space" : ""}">${baseHtml}${overlayHtml}</span>`;
  };

  let revealHtml = "";

  if (showFullErrorPreview) {
    for (let i = 0; i < model.tokens.length; i += 1) {
      const token = model.tokens[i];
      if (!token) continue;

      if (i === flashBadTokenIndex && badChar) {
        revealHtml += buildWrongStackHtml(token, badChar);
        continue;
      }

      if (i === persistentBadTokenIndex && hasPersistentBad) {
        revealHtml += buildWrongStackHtml(token, persistentBadChar);
        continue;
      }

      revealHtml += esc(token.char);
    }
  } else {
    const revealedParts = [];

    for (let i = 0; i < visibleTokenCount; i += 1) {
      const token = model.tokens[i];
      if (!token) continue;

      if (i === persistentBadTokenIndex && hasPersistentBad) {
        revealedParts.push(buildWrongStackHtml(token, persistentBadChar));
        continue;
      }

      if (i === flashGoodTokenIndex) {
        revealedParts.push(
          token.isSpace
            ? `<span class="hifzWriteTextFlash is-space" aria-hidden="true">&nbsp;</span>`
            : `<span class="hifzWriteTextFlash">${esc(token.char)}</span>`
        );
        continue;
      }

      revealedParts.push(esc(token.char));
    }

    if (hasPersistentBad && persistentBadTokenIndex === visibleTokenCount) {
      const token = model.tokens[visibleTokenCount];
      if (token) {
        revealedParts.push(buildWrongStackHtml(token, persistentBadChar));
      }
    }

    const caretHtml =
      visibleTokenCount < model.tokens.length && !resultFlash
        ? `<span class="hifzWriteCaret" aria-hidden="true"></span>`
        : "";

    revealHtml = `${revealedParts.join("")}${caretHtml}`;
  }

  const hintHtml =
    showStartHint && visibleTokenCount === 0 && !badChar && !persistentBadChar && !resultFlash
      ? `<span class="hifzWriteInputHint">Tap here and write in Arabic</span>`
      : "";

  const wrongHtml = "";

  const resultBadgeHtml =
    resultFlash === "good"
      ? `<span class="hifzWriteResultBadgeInline is-good">Correct</span>`
      : resultFlash === "bad"
          ? `<span class="hifzWriteResultBadgeInline is-bad">Bad</span>`
          : "";

  return `
    <span class="hifzTrainInlineWrite" data-hifz-train-inline-write="${ref}">
      <span class="hifzWriteStageBox">
        <span
          class="hifzWriteInputShell${badChar ? " is-flash-bad" : ""}${resultFlash === "good" ? " is-result-good" : ""}${resultFlash === "bad" ? " is-result-bad" : ""}"
          data-hifz-write-shell="${ref}"
          data-hifz-write-stage="${stage}"
          aria-label="Write ${esc(ref)} in Arabic">
          <input
            class="hifzWriteInput"
            id="${safeInputId}"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            dir="rtl"
            lang="ar"
            enterkeyhint="done"
            data-hifz-write-input="${ref}"
            aria-label="Write ${esc(ref)} in Arabic"
            placeholder=" ">

          <span class="hifzWriteInputView" aria-hidden="true">
            <span class="hifzWriteTextGhost">${esc(fullWriteText)}</span>
            <span class="hifzWriteTextReveal">${revealHtml}</span>
            ${hintHtml}
            ${wrongHtml}
          </span>
        </span>
      </span>
    </span>
  `;
}

function buildHifzTrainRevealLastWrongHtml(a, esc){
  const ref = String(a?.ref || "");
  const state = __hifzWriteStateMap[ref];
  const wrongChar = String(state?.lastWrongChar || "");
  const wrongTokenIndex = Number(state?.lastWrongTokenIndex);

  if (!wrongChar || wrongTokenIndex < 0) {
    return buildWordSpans({
      ref: a.ref,
      surah: a.surah,
      ayahNo: a.ayah,
      textAr: a.textAr,
      words: a.words
    });
  }

  const rawDisplay = String(
    a?.textAr ||
    a?.textUthmani ||
    a?.uthmani ||
    a?.text ||
    ""
  ).replace(/[۞۩]/g, "");

  const displayTokens = segmentArabicWriteClusters(rawDisplay);
  let comparableIndex = 0;
  let applied = false;
  let html = "";

  for (const token of displayTokens) {
    const normalized = normalizeArabicWriteCompareChar(token);
    const isComparable = !!normalized;
    const isSpace = /\s/.test(token);

    if (isComparable && comparableIndex === wrongTokenIndex) {
      const baseHtml = isSpace
        ? `<span class="hifzWriteErrorStackBase is-space" aria-hidden="true">&nbsp;</span>`
        : `<span class="hifzWriteErrorStackBase">${esc(token)}</span>`;

      const overlayHtml = /\s/.test(wrongChar)
        ? `<span class="hifzWriteTextErrorInline is-space" aria-hidden="true">&nbsp;</span>`
        : `<span class="hifzWriteTextErrorInline">${esc(wrongChar)}</span>`;

      html += `<span class="hifzWriteErrorStack${isSpace ? " is-space" : ""}">${baseHtml}${overlayHtml}</span>`;
      applied = true;
    } else {
      html += isSpace ? " " : esc(token);
    }

    if (isComparable) {
      comparableIndex += 1;
    }
  }

  if (!applied) {
    return buildWordSpans({
      ref: a.ref,
      surah: a.surah,
      ayahNo: a.ayah,
      textAr: a.textAr,
      words: a.words
    });
  }

  return html;
}

const setHifzTrainWriteResultFlash = (ref, value = "") => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const v = String(value || "").trim().toLowerCase();
  if (v === "good" || v === "bad") {
    __hifzWriteResultFlashMap[r] = v;
    return;
  }

  delete __hifzWriteResultFlashMap[r];
};

const setHifzTrainWriteCooldown = (ref, delayMs = 0) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const st = getHifzWriteStateForRef(r);
  const until = performance.now() + Math.max(0, Number(delayMs) || 0);
  st.lockUntil = Math.max(Number(st.lockUntil) || 0, until);
};

const isHifzTrainWriteCoolingDown = (ref) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return false;

  const st = getHifzWriteStateForRef(r);
  return performance.now() < (Number(st.lockUntil) || 0);
};

const focusHifzTrainWriteInputByRef = (ref) => {
  const refStr = String(ref || "");
  if (!/^\d+:\d+$/.test(refStr)) return null;

  const activeView = getActiveHifzTrainMaskView();
  const inputNow =
    activeView?.querySelector(`[data-hifz-write-input="${CSS.escape(refStr)}"]`) ||
    document.querySelector(`[data-hifz-write-input="${CSS.escape(refStr)}"]`) ||
    null;

  if (!inputNow) return null;

  try {
    inputNow.focus({ preventScroll: true });
  } catch {
    try { inputNow.focus(); } catch {}
  }

  try {
    const len = String(inputNow.value || "").length;
    inputNow.setSelectionRange(len, len);
  } catch {}

  return inputNow;
};

const rerenderHifzTrainInlineWrite = (ref, { focus = false } = {}) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const activeView = getActiveHifzTrainMaskView();
  const textHost =
    activeView?.querySelector(`.mChunk[data-ref="${CSS.escape(r)}"] .mText`) ||
    null;
  const ayahNow = getAyah(r);

  if (textHost && ayahNow && isHifzTrainMaskOn() && isHifzTrainWriteStage() && isHifzTrainMaskRatePending(r)) {
    textHost.innerHTML = buildHifzTrainInlineWriteHtml(ayahNow, escSummary);
    try { syncHifzTrainMaskDom(activeView || document); } catch {}
  } else {
    renderCurrent(String(currentRef || r));
  }

  if (focus) {
    requestAnimationFrame(() => {
      focusHifzTrainWriteInputByRef(r);
    });
  }
};

const scheduleHifzTrainWriteFlashClear = (ref, delayMs = 500) => {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const st = getHifzWriteStateForRef(r);
  const tick = (Number(st.flashTick) || 0) + 1;
  st.flashTick = tick;

  setTimeout(() => {
    const cur = __hifzWriteStateMap[r];
    if (!cur) return;
    if (Number(cur.flashTick) !== tick) return;
    if (String(getHifzTrainMaskPendingRateRef() || "") !== r) return;
    if (isHifzTrainWriteCoolingDown(r)) return;

    clearHifzWriteFlashForRef(r);
    rerenderHifzTrainInlineWrite(r, { focus: true });
  }, delayMs);
};

const handleHifzTrainWriteRawInput = (input, rawValue) => {
  if (!input) return;

  const ref = String(input.getAttribute("data-hifz-write-input") || "");
  if (!/^\d+:\d+$/.test(ref)) {
    input.value = "";
    return;
  }

  if (!isHifzTrainWriteStage()) {
    input.value = "";
    return;
  }

  if (String(getHifzTrainMaskPendingRateRef() || "") !== ref) {
    input.value = "";
    return;
  }

  input.value = "";

  if (isHifzTrainWriteCoolingDown(ref)) {
    focusHifzTrainWriteInputByRef(ref);
    return;
  }

  const safeRaw = String(rawValue || "");
  const outcome = consumeHifzWriteInput(ref, safeRaw);

  if (!outcome || outcome.status === "noop") {
    setHifzTrainWriteResultFlash(ref, "");
    focusHifzTrainWriteInputByRef(ref);
    return;
  }

  if (outcome.status === "progress") {
    setHifzTrainWriteResultFlash(ref, "");
    rerenderHifzTrainInlineWrite(ref, { focus: true });
    scheduleHifzTrainWriteFlashClear(ref, 500);
    return;
  }

  if (outcome.status === "wrong") {
    setHifzTrainWriteResultFlash(ref, "");
    setHifzTrainWriteCooldown(ref, 650);
    rerenderHifzTrainInlineWrite(ref, { focus: true });
    scheduleHifzTrainWriteFlashClear(ref, 650);
    return;
  }

  if (outcome.status === "good" || outcome.status === "bad") {
    const mark = outcome.status === "good" ? "good" : "bad";
    const writeShell = input.closest("[data-hifz-write-shell]");
    const fxSource = writeShell || input;
    const flight =
      (typeof runHifzTrainMaskRateFlight === "function")
        ? runHifzTrainMaskRateFlight(fxSource, ref, mark)
        : { started:false, arrivalDelay:0, totalDelay:340 };

    setHifzTrainWriteResultFlash(ref, mark);
    rerenderHifzTrainInlineWrite(ref, { focus: false });

    const commit = () => {
      const stageNow = String(hifzStageValue || "1");
      const persistStageResult = !(stageNow === "9" || stageNow === "10");

      if (persistStageResult) {
        rateHifzTrainMaskRef(ref, mark);
      } else {
        if (isHifzTrainMaskRatePending(ref)) {
          setHifzTrainMaskPendingRateRef("");
        }

        clearHifzTrainMaskHoverTimer(ref);

        if (isHifzTrainWriteStage()) {
          resetHifzWriteStateForRef(ref);
          delete __hifzWriteResultFlashMap[ref];
        }
      }

      const nextRef = String(getNextHifzFocusRef(ref) || "");
      if (isValidHifzTrainRef(nextRef)) {
        currentRef = nextRef;
        setRefToHash(nextRef);
        revealHifzTrainMaskRef(nextRef);

        requestAnimationFrame(() => {
          const tryFocusNextWrite = () => {
            const activeView = getActiveHifzTrainMaskView();
            focusHifzTrainMaskRefInView(activeView, nextRef, { updateUrl: true, scroll: false, behavior: "auto" });
            return !!focusHifzTrainWriteInputByRef(nextRef);
          };

          if (tryFocusNextWrite()) return;

          requestAnimationFrame(() => {
            if (tryFocusNextWrite()) return;

            setTimeout(() => {
              if (tryFocusNextWrite()) return;

              setTimeout(() => {
                tryFocusNextWrite();
              }, 90);
            }, 0);
          });
        });
        return;
      }

      currentRef = ref;
      setRefToHash(ref);
      renderCurrent(String(currentRef || ref));
    };

    if (flight && flight.started) {
      setTimeout(commit, flight.arrivalDelay);
      return;
    }

    commit();
  }
};

function buildHifzSurahSummaryHtmlTrain(){
  let cells = "";

  const getHifzSurahProgressPctTrain = (surahNo) => {
    try{
      const stage = String(hifzStageValue || "1");
      const refs2 = getSuraRefs(Number(surahNo) || 0) || [];
      if (!refs2.length) return 0;

      let sum = 0;
      let count = 0;

      for (const ref2 of refs2){
        const ratio2 = Number(getHifzProgressRatioForRef(ref2, stage) || 0);
        sum += Math.max(0, Math.min(1, ratio2));
        count++;
      }

      if (!count) return 0;
      return Math.max(0, Math.min(100, Math.round((sum / count) * 100)));
    }catch{
      return 0;
    }
  };

  for (let s = 1; s <= 114; s++){
    const pct = getHifzSurahProgressPctTrain(s);
    const ratio = pct / 100;
    const smx = getSuraMeta(s) || {};
    const surahAr = escSummary(smx?.nameAr ?? "");
    const surahTr = escSummary(smx?.nameTranslit ?? `Surah ${s}`);

    cells += `
      <div class="hifzSurahSummaryCell${pct > 0 ? " is-progress" : ""}${pct >= 100 ? " is-mastered" : ""}"
           style="--surah-progress:${ratio};"
           data-surah="${s}"
           data-pct="${pct}"
           data-tip-ref="Surah ${s}"
           data-tip-ar="${surahAr}"
           data-tip-tr="${surahTr} • ${pct}%">
        <div class="hifzSurahSummaryCellInner" aria-hidden="true">
          <span class="hifzSurahSummaryNo">${s}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="ayahCard hifzSurahSummaryCard">
      <div class="hifzSurahSummaryHeader">
        <div class="hifzSurahSummaryTitle">Surah Progress</div>
      </div>
      <div class="hifzSurahSummaryGrid">
        ${cells}
      </div>
    </div>
  `;
}

if (surahSummaryMount) {
  surahSummaryMount.innerHTML = buildHifzSurahSummaryHtmlTrain();

  let _lastSurahSummaryTipKey = "";

  const _renderSurahSummaryTip = (cell, clientX, clientY) => {
    if (!cell) {
      _lastSurahSummaryTipKey = "";
      _hideSuraTip();
      return;
    }

    if (typeof tooltipsAllowed === "function" && !tooltipsAllowed()) {
      _lastSurahSummaryTipKey = "";
      _hideSuraTip();
      return;
    }

    const key = `${cell.dataset.surah || ""}|${cell.dataset.pct || ""}`;

    if (_lastSurahSummaryTipKey !== key) {
      _lastSurahSummaryTipKey = key;

      suraTip.innerHTML = `
        <div class="tipRef">${escTip(cell.dataset.tipRef || "")}</div>
        <div class="tipAr" dir="rtl" lang="ar">${cell.dataset.tipAr || ""}</div>
        <div class="tipTr">${escTip(cell.dataset.tipTr || "")}</div>
      `;
    }

    _placeTip(suraTip, clientX, clientY);
  };

  surahSummaryMount.addEventListener("mouseenter", (e) => {
    const cell = e.target.closest?.(".hifzSurahSummaryCell[data-surah]");
    if (!cell) return;
    _renderSurahSummaryTip(cell, e.clientX, e.clientY);
  }, true);

  surahSummaryMount.addEventListener("mousemove", (e) => {
    const cell = e.target.closest?.(".hifzSurahSummaryCell[data-surah]");
    if (!cell) {
      _lastSurahSummaryTipKey = "";
      _hideSuraTip();
      return;
    }

    _renderSurahSummaryTip(cell, e.clientX, e.clientY);
  }, { passive: true });

  surahSummaryMount.addEventListener("mouseleave", () => {
    _lastSurahSummaryTipKey = "";
    _hideSuraTip();
  });
}

const hifzStageSelectTop = view.querySelector("#hifzStageSelectTop");
const hifzStageDropTop = view.querySelector("#hifzStageDropTop");
const hifzStageDropBtnTop = view.querySelector("#hifzStageDropBtnTop");
const hifzStageDropMenuTop = view.querySelector("#hifzStageDropMenuTop");
const hifzStageDropLabelTop = view.querySelector("#hifzStageDropLabelTop");

if (hifzStageSelectTop && !hifzStageSelectTop._bound) {
  hifzStageSelectTop._bound = true;
  hifzStageSelectTop.value = hifzStageValue || "1";

  const syncHifzStageDropUi = () => {
    const selected = String(hifzStageValue || hifzStageSelectTop.value || "1");
    const meta = getHifzStageMeta(selected);
    const pctMap = getHifzStageProgressMap();
    const pct = Number(pctMap[selected] || 0);

    hifzStageSelectTop.value = selected;

    if (hifzStageDropLabelTop) {
      hifzStageDropLabelTop.textContent = meta.title;
    }

    if (hifzStageDropTop) {
      hifzStageDropTop.style.setProperty("--hifz-stage-pct", `${pct}%`);
    }

    if (hifzStageDropMenuTop) {
      hifzStageDropMenuTop.querySelectorAll(".hifzStageDropItem[data-stage-value]").forEach((item) => {
        const on = String(item.getAttribute("data-stage-value") || "") === selected;
        item.classList.toggle("is-selected", on);
        item.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    if (hifzStageDropBtnTop) {
      hifzStageDropBtnTop.setAttribute("aria-expanded", hifzStageDropTop?.classList.contains("is-open") ? "true" : "false");
    }
  };

  const closeHifzStageDrop = () => {
    if (!hifzStageDropTop) return;
    hifzStageDropTop.classList.remove("is-open");
    if (hifzStageDropBtnTop) hifzStageDropBtnTop.setAttribute("aria-expanded", "false");
  };

  const toggleHifzStageDrop = () => {
    if (!hifzStageDropTop) return;
    const nextOpen = !hifzStageDropTop.classList.contains("is-open");
    hifzStageDropTop.classList.toggle("is-open", nextOpen);
    if (hifzStageDropBtnTop) hifzStageDropBtnTop.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  };

  const applyHifzStage = () => {
    saveHifzStageValue(hifzStageSelectTop.value);
    syncHifzStageDropUi();

    const inputNow = view.querySelector("#hifzRangeInputTop");
    syncHifzRangeInputUi(inputNow);

    const stage = String(hifzStageValue || "1");
    let nextRef = currentRef;

    if (stage === "10") {
      nextRef = getNextStage10Ref(currentRef);
    } else if (stage === "9") {
      nextRef = getNextStage9Ref(currentRef);
    } else if (stage === "8") {
      nextRef = getNextStage8Ref(currentRef);
    } else if (stage === "7") {
      nextRef = getNextStage7Ref(currentRef);
    } else if (stage === "6") {
      nextRef = getNextStage6Ref(currentRef);
    } else if (stage === "5") {
      nextRef = getNextStage5Ref(currentRef);
    } else if (stage === "3" || stage === "4") {
      const bounds = getHifzRangeBoundsForRef(currentRef);
      const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

      const baseRef =
        currentAyahNo >= Number(bounds?.fromAyah || 0) &&
        currentAyahNo <= Number(bounds?.toAyah || 0)
          ? currentRef
          : String(bounds?.startRef || currentRef || "");

      nextRef = getNextStage3Ref(baseRef);
    } else {
      const bounds = getHifzRangeBoundsForRef(currentRef);
      const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

      nextRef =
        currentAyahNo >= Number(bounds?.fromAyah || 0) &&
        currentAyahNo <= Number(bounds?.toAyah || 0)
          ? currentRef
          : String(bounds?.startRef || currentRef || "");
    }

    closeHifzStageDrop();
    renderCurrent(nextRef);
  };

  hifzStageSelectTop.addEventListener("change", applyHifzStage);

  if (hifzStageDropBtnTop && !hifzStageDropBtnTop._bound) {
    hifzStageDropBtnTop._bound = true;
    hifzStageDropBtnTop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHifzStageDrop();
    });
  }

  if (hifzStageDropMenuTop && !hifzStageDropMenuTop._bound) {
    hifzStageDropMenuTop._bound = true;
    hifzStageDropMenuTop.addEventListener("click", (e) => {
      const item = e.target.closest(".hifzStageDropItem[data-stage-value]");
      if (!item) return;

      const value = String(item.getAttribute("data-stage-value") || "");
      if (!/^(10|[1-9])$/.test(value)) return;

      hifzStageSelectTop.value = value;
      hifzStageSelectTop.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  if (!document.__hifzStageDropOutsideBound) {
    document.__hifzStageDropOutsideBound = true;

    document.addEventListener("click", (e) => {
      const drop = document.getElementById("hifzStageDropTop");
      if (!drop) return;
      if (drop.contains(e.target)) return;
      drop.classList.remove("is-open");
      const btn = document.getElementById("hifzStageDropBtnTop");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const drop = document.getElementById("hifzStageDropTop");
      if (!drop) return;
      drop.classList.remove("is-open");
      const btn = document.getElementById("hifzStageDropBtnTop");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  syncHifzStageDropUi();
}

const hifzRepeatTargetTop = view.querySelector("#hifzRepeatTargetTop");
if (hifzRepeatTargetTop && !hifzRepeatTargetTop._bound) {
  hifzRepeatTargetTop._bound = true;
  hifzRepeatTargetTop.value = String(loadHifzRepeatTarget());

  const applyRepeatTarget = () => {
    saveHifzRepeatTarget(hifzRepeatTargetTop.value);
    hifzRepeatTargetTop.value = String(loadHifzRepeatTarget());
    renderCurrent(currentRef);
  };

  hifzRepeatTargetTop.addEventListener("change", applyRepeatTarget);
}

const hifzRangeInputTop = view.querySelector("#hifzRangeInputTop");
if (hifzRangeInputTop && !hifzRangeInputTop._bound) {
  hifzRangeInputTop._bound = true;
  syncHifzRangeInputUi(hifzRangeInputTop);

  const syncTrainRangeDraft = () => {
    if (isHifzRangeLockedStage(hifzStageValue)) return;
    saveHifzRangeValue(hifzRangeInputTop.value);
  };

  const applyTrainRange = () => {
    syncTrainRangeDraft();
    syncHifzRangeInputUi(hifzRangeInputTop);

    if (isHifzRangeLockedStage(hifzStageValue)) {
      renderCurrent(currentRef);
      return;
    }

    const bounds = getHifzRangeBoundsForRef(currentRef);
    const currentAyahNo = Number(getAyah(currentRef)?.ayah || 0);

    const nextRef =
      currentAyahNo >= Number(bounds?.fromAyah || 0) &&
      currentAyahNo <= Number(bounds?.toAyah || 0)
        ? currentRef
        : String(bounds?.startRef || currentRef || "");

    renderCurrent(nextRef);
  };

  hifzRangeInputTop.addEventListener("input", syncTrainRangeDraft);
  hifzRangeInputTop.addEventListener("change", applyTrainRange);
  hifzRangeInputTop.addEventListener("blur", applyTrainRange);

  hifzRangeInputTop.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyTrainRange();
    }
  });
}

bindHifzBadDropInView(view, (ref) => {
  const allowedRefs = new Set(getHifzNavigableRefsForCurrentStage().map(String));

  if (!allowedRefs.has(String(ref))) {
    if (flow) {
      flow.innerHTML = buildHifzBadRangeMessageHtml(ref);
      view.__mushafCacheDirty = true;
      view.__mushafBtnsCache = null;
      view.__mushafPosCache = null;
    }
    return;
  }

  renderCurrent(ref);
});

const CHUNK = 60;
const FAST_CHUNK = 250; // ✅ viel kleiner (Performance!)
  const turboActive = (targetRef) =>
    window.__turboJumpRef === targetRef &&
    typeof window.__turboJumpUntil === "number" &&
    performance.now() < window.__turboJumpUntil;

let i = 0;
let lastSurah = null;

let targetIdx = -1;
let turboDone = false;

// Cache-Flags für Scroll-Handler
view.__mushafCacheDirty = true;
view.__mushafBtnsCache = null;

if (renderAll) {
  const target = parseRefLoose(ref) || ref;
  targetIdx = refs.indexOf(String(target));
}

function renderChunk() {
  const step =
    (renderAll && targetIdx >= 0 && !turboDone && i < targetIdx) ? FAST_CHUNK : CHUNK;

  const end = Math.min(refs.length, i + step);
  let html = "";

  for (; i < end; i++) {
    const r = refs[i];
    const a = getAyah(r);
    if (!a) continue;

    // ✅ SurahTopBar vor jeder neuen Sura (nur wenn renderAll)
    if (renderAll && a.surah !== lastSurah) {
      lastSurah = a.surah;
      const sm2 = getSuraMeta(lastSurah);
      const headerModeText = (viewMode === "mushaf") ? "Ayah mode" : "Mushaf mode";

      html += `
  <div class="surahTopBar ayahSurahHeader" data-surah="${lastSurah}">
    <div class="surahTopFarLeft">
      <button class="btnCircle playStop suraPlayBtn" type="button" data-surah="${lastSurah}" aria-label="Play/Stop Sura ${lastSurah}">
        <svg class="icon icon-play" viewBox="0 0 24 24"><path d="M8 5v14l12-7z"></path></svg>
        <svg class="icon icon-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
      </button>
    </div>

    <div class="surahTopLeft">
      <div class="surahTitle is-compact">
        <span class="sNum">${lastSurah}</span>
        <span class="dot">•</span>
        <span class="sEn">${sm2?.nameTranslit ?? ""}</span>
        <span class="dot">•</span>
        <span class="sAr" dir="rtl" lang="ar">${sm2?.nameAr ?? ""}</span>
      </div>
    </div>

    <div class="surahTopRight">
      <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch view mode">
        <span class="modeText">${headerModeText}</span>
        <span class="modeArrow">→</span>
      </button>
    </div>
  </div>
`;

      // ✅ Arabischer Surah-Titel + Basmallah im Mushaf-Flow
      // Basmallah NUR wenn Ayah 1 dieser Sura in der aktuellen Range wirklich drin ist
      html += `
  <div class="mCenter">
    <div class="mMushafHeader">
      <div class="mSurahName" dir="rtl" lang="ar">سورة ${sm2?.nameAr ?? ""}</div>
      ${
        (lastSurah !== 1 && lastSurah !== 9 && Number(a?.ayah || 0) === 1)
          ? `<div class="mBasm" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>`
          : ``
      }
    </div>
  </div>
`;
    }

const no = toArDigits(a.ayah ?? "");
const wordsHtml = buildWordSpans({
  ref: a.ref,
  surah: a.surah,
  ayahNo: a.ayah,
  textAr: a.textAr,
  words: a.words
});

const hifzStageNow = String(hifzStageValue || "1");
const hifzResult = String(getHifzResultForRef(a.ref, hifzStageNow) || "");
const hifzRatio = Number(getHifzProgressRatioForRef(a.ref, hifzStageNow) || 0);
const hifzRing = Math.max(0, Math.min(1, hifzRatio));
const trainMaskHidden = isHifzTrainMaskOn() && !isHifzTrainMaskRevealed(a.ref);
const trainWritePending = isHifzTrainWriteStage(hifzStageNow) && isHifzTrainMaskOn() && !trainMaskHidden && isHifzTrainMaskRatePending(a.ref);
const trainRateOpen = !trainWritePending && isHifzTrainMaskOn() && !trainMaskHidden && isHifzTrainMaskRatePending(a.ref);
const trainWriteState = __hifzWriteStateMap[a.ref];
const trainShowLastWrong =
  !trainMaskHidden &&
  !trainWritePending &&
  String(__hifzLastWrongRevealRef || "") === String(a.ref) &&
  !!String(trainWriteState?.lastWrongChar || "");
const trainTextHtml = trainWritePending
  ? buildHifzTrainInlineWriteHtml(a, escSummary)
  : (trainShowLastWrong ? buildHifzTrainRevealLastWrongHtml(a, escSummary) : wordsHtml);
const trainHintTitle = trainWritePending
  ? "write the ayah inside this ayah box"
  : (trainRateOpen
      ? "rate with 1 bad and 3 good how good you remembered it"
      : ((i === 0 && trainMaskHidden) ? "click/press space or hover to reveal ayah" : `Play ${a.ref}`));
const trainAriaLabel = trainWritePending
  ? `Write ${a.ref} inside this ayah box`
  : (trainRateOpen
      ? `Rate ${a.ref} with 1 bad and 3 good`
      : (trainMaskHidden ? `Reveal ${a.ref}` : `Play ${a.ref}`));
const hifzNoClass =
  hifzResult === "bad"
    ? " is-hifz-bad"
    : (
        hifzRatio >= 1
          ? " is-hifz-mastered"
          : (hifzRatio > 0 ? " is-hifz-progress" : "")
      );

html += `
  <span class="mChunk${trainMaskHidden ? " is-train-hidden" : ""}${trainWritePending ? " is-train-writing" : ""}${(i === 0 && trainMaskHidden) ? " is-train-first-hint" : ""}" data-ref="${a.ref}"${i === 0 ? ` data-train-first="true"` : ""}>
    <span class="mText" dir="rtl" lang="ar">${trainTextHtml}</span>
    <button class="mNo${hifzNoClass}${trainRateOpen ? " is-train-rate-open" : ""}${((typeof favSet !== "undefined") && favSet && favSet.has(String(a.ref))) ? " is-fav" : ""}${getNoteForRef(a.ref).trim() ? " is-note" : ""}"
type="button"
data-ref="${a.ref}"
data-ayah-no="${no}"
data-train-state="${trainWritePending ? "writing" : (trainRateOpen ? "rating" : (trainMaskHidden ? "hidden" : "normal"))}"
style="--hifz-ring:${hifzRing};"
title="${trainHintTitle}"
aria-label="${trainAriaLabel}">${trainRateOpen ? buildHifzTrainMaskRateInnerHtml() : no}</button>
  </span>
`;
  }

  flow.insertAdjacentHTML("beforeend", html);
  view.__mushafCacheDirty = true;

  try { syncHifzTrainMaskDom(view); } catch(e) {}

  // ✅ WICHTIG: Justify/Spaces NACHDEM neuer Content im DOM ist
  try { applyMushafJustify(); } catch(e) {}

  if (!turboDone && renderAll && targetIdx >= 0) {
    const targetRef = String(parseRefLoose(ref) || ref);
    const exists = !!view.querySelector(`.mNo[data-ref="${CSS.escape(targetRef)}"]`);
    if (exists) turboDone = true;
  }

  if (i < refs.length) {
    if (renderAll) {
      view.__mushafRenderJob = scheduleRender(renderChunk, { timeout: 120 });
    } else {
      // single-sura: weiter in rAF-Chunks, damit alles gebaut wird
      view.__mushafRenderJob = requestAnimationFrame(renderChunk);
    }
  } else {
    view.__mushafRenderJob = null;

    // ✅ Safety: am Ende nochmal anwenden (damit die LETZTE Ayah immer passt)
    try { applyMushafJustify(); } catch(e) {}

    syncPlayingMushafFocus();
  }
}

renderChunk();


  // Fokus helper (wie alt)
  const setFocus = (r, { updateUrl = false, scroll = false } = {}) => {
    if (!r) return;

    view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
    const btn = view.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
    if (btn) btn.classList.add("is-focus");

    currentRef = r;

    if (updateUrl) setRefToHash(r);

    if (scroll && btn) __qrScrollElementToCenter(view, btn, { behavior: "smooth" });
  };

  // ✅ erst fokussieren/scrollen wenn die Ziel-Ayah in den gerenderten Chunks existiert
  scrollToMushafNoWhenReady(view, ref, { updateUrl: false, scroll: true });

    function ensureTrainRateFxLayer() {
    let layer = document.getElementById("trainRateFxLayer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "trainRateFxLayer";
    layer.className = "trainRateFxLayer";
    document.body.appendChild(layer);
    return layer;
  }

  function pruneTrainRateFxLayer(layer) {
    if (!layer) return;
    if (layer.querySelector(".trainRateFlight, .trainRateBurst")) return;
    layer.remove();
  }

  function runHifzRecallFlightFromButton(btn, ref, kind = "good") {
    const r = String(ref || "").trim();
    const markKind = String(kind || "").trim().toLowerCase() === "bad" ? "bad" : "good";

    if (!btn || !document.body.contains(btn) || !/^\d+:\d+$/.test(r)) {
      return { started:false, arrivalDelay:0, totalDelay:820 };
    }

    const rect = btn.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { started:false, arrivalDelay:0, totalDelay:820 };
    }

    const tickSelector = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? `.suraTick[data-ref="${CSS.escape(r)}"]`
      : `.suraTick[data-ref="${r.replace(/"/g, '\\"')}"]`;

    const tick = document.querySelector(tickSelector);

    const cx = rect.left + (rect.width / 2);
    const cy = rect.top + (rect.height / 2);

    let targetTick = null;
    let tx = cx;
    let ty = cy;

    if (tick && tick.isConnected) {
      const tickRect = tick.getBoundingClientRect();
      if (tickRect.width && tickRect.height) {
        targetTick = tick;
        tx = tickRect.left + (tickRect.width / 2);
        ty = tickRect.top + (tickRect.height * 0.54);
      }
    }

    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);

    const layer = ensureTrainRateFxLayer();

    const beam = document.createElement("div");
    beam.className = `trainRateFlight is-${markKind}`;
    beam.style.left = `${cx}px`;
    beam.style.top = `${cy}px`;
    beam.style.setProperty("--train-rate-angle", `${angle}rad`);
    beam.style.setProperty("--train-rate-len", `${dist}px`);

    const burst = document.createElement("div");
    burst.className = `trainRateBurst is-${markKind}`;
    burst.style.left = `${tx}px`;
    burst.style.top = `${ty}px`;

    layer.appendChild(beam);
    layer.appendChild(burst);

    const hitClass = markKind === "bad"
      ? "is-train-rate-hit-bad"
      : "is-train-rate-hit-good";

    const arrivalClass = markKind === "bad"
      ? "is-bad-arrival"
      : "is-good-arrival";

    const arrivalClassMs = markKind === "bad" ? 560 : 460;
    const arrivalDelay = targetTick ? 120 : 0;

    btn.classList.remove("is-train-rate-hit-good", "is-train-rate-hit-bad");
    void btn.offsetWidth;
    btn.classList.add(hitClass);

    const releaseHit = () => {
      btn.classList.remove("is-train-rate-hit-good", "is-train-rate-hit-bad");
    };

    const releaseTick = () => {
      try {
        targetTick?.classList.remove("is-good-arrival", "is-bad-arrival");
      } catch {}
    };

    const destroyBeam = () => {
      beam.remove();
      pruneTrainRateFxLayer(layer);
    };

    const destroyBurst = () => {
      burst.remove();
      pruneTrainRateFxLayer(layer);
    };

    const triggerArrival = () => {
      burst.classList.add("is-live");

      if (!targetTick) return;

      try {
        targetTick.classList.remove("is-good-arrival", "is-bad-arrival");
        void targetTick.offsetWidth;
        targetTick.classList.add(arrivalClass);

        window.setTimeout(() => {
          releaseTick();
        }, arrivalClassMs);
      } catch {}
    };

    requestAnimationFrame(() => {
      beam.classList.add("is-live");
    });

    const arrivalTimer = window.setTimeout(triggerArrival, arrivalDelay);
    const hitTimer = window.setTimeout(releaseHit, 520);
    const killTimer = window.setTimeout(() => {
      destroyBeam();
      destroyBurst();
      releaseTick();
    }, 820);

    beam.addEventListener("animationend", destroyBeam, { once: true });
    burst.addEventListener("animationend", destroyBurst, { once: true });

    return {
      started: true,
      arrivalDelay,
      totalDelay: 820,
      cleanup: () => {
        window.clearTimeout(arrivalTimer);
        window.clearTimeout(hitTimer);
        window.clearTimeout(killTimer);
        releaseHit();
        releaseTick();
        destroyBeam();
        destroyBurst();
      }
    };
  }

  function runHifzTrainMaskRateFlight(btn, ref, kind = "good") {
    return runHifzRecallFlightFromButton(btn, ref, kind);
  }

  window.runHifzRecallFlightFromButton = runHifzRecallFlightFromButton;
  window.runHifzTrainMaskRateFlight = runHifzTrainMaskRateFlight;

  // Click handling (einmal binden)
  if (!view._mushafBound) {
    view._mushafBound = true;

        if (!view._mushafTrainFxHotkeysBound) {
      view._mushafTrainFxHotkeysBound = true;

      document.addEventListener(
        "keydown",
        (e) => {
          const key = String(e.key || "");
          const code = String(e.code || "");

          const isBad = key === "1" || code === "Digit1" || code === "Numpad1";
          const isGood = key === "3" || code === "Digit3" || code === "Numpad3";

          if (!isBad && !isGood) return;
          if (e.repeat) return;
          if (String(viewMode || "") !== "mushaf") return;

          const ae = document.activeElement;
          const typing =
            ae &&
            (ae.tagName === "INPUT" ||
              ae.tagName === "TEXTAREA" ||
              ae.isContentEditable);

          if (typing) return;
          if (!isHifzTrainMaskOn()) return;

          const r = String(currentRef || "").trim();
          if (!/^\d+:\d+$/.test(r)) return;
          if (!isHifzTrainMaskRatePending(r)) return;

          const btn = document.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
          if (!btn) return;
          if (!btn.classList.contains("is-train-rate-open")) return;

          const rate = isBad ? "bad" : "good";
          const rateSource = btn.querySelector(`.mTrainRateHalf[data-rate="${rate}"]`);
          if (!rateSource) return;

          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }

          const flight =
            (typeof runHifzTrainMaskRateFlight === "function")
              ? runHifzTrainMaskRateFlight(rateSource, r, rate)
              : { started:false, arrivalDelay:0, totalDelay:340 };

          if (flight && flight.started) {
            setTimeout(() => {
              rateHifzTrainMaskRef(r, rate);

              if (isHifzTrainWriteStage()) {
                renderCurrent(r);
              } else {
                syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
              }
            }, flight.arrivalDelay);
            return;
          }

          rateHifzTrainMaskRef(r, rate);

          if (isHifzTrainWriteStage()) {
            renderCurrent(r);
          } else {
            syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
          }
        },
        true
      );
    }

    const getHiddenTrainChunkFromTarget = (target) => {
      if (!isHifzTrainMaskOn()) return null;
      return target?.closest?.(".mChunk.is-train-hidden[data-ref]") || null;
    };

    if (!view.__mushafHandlersBound) {
      view.__mushafHandlersBound = true;

      view.addEventListener("click", (e) => {
        const writeShell = e.target.closest?.("[data-hifz-write-shell]");
        if (writeShell) {
          const ref = String(writeShell.getAttribute("data-hifz-write-shell") || "");
          setTimeout(() => focusHifzTrainWriteInputByRef(ref), 0);
          return;
        }

      const trainModeBtn = e.target.closest?.('[data-action="toggleTrainModeMask"]');
      if (trainModeBtn) {
        e.preventDefault();
        e.stopPropagation();

        const nextOn = !isHifzTrainMaskOn();
        setHifzTrainMaskOn(nextOn);

        if (nextOn) {
          const firstTrainRef = String(view.querySelector('.mChunk[data-ref]')?.getAttribute('data-ref') || "");
          if (isValidHifzTrainRef(firstTrainRef)) {
            currentRef = firstTrainRef;
            setRefToHash(firstTrainRef);

            if (isHifzTrainWriteStage()) {
              revealHifzTrainMaskRef(firstTrainRef);

              requestAnimationFrame(() => {
                const activeView = getActiveHifzTrainMaskView();
                focusHifzTrainMaskRefInView(activeView, firstTrainRef, { updateUrl: true, scroll: false });
                focusHifzTrainWriteInputByRef(firstTrainRef);
              });
              return;
            }

            renderCurrent(firstTrainRef);
            return;
          }
        }

        renderCurrent(currentRef);
        return;
      }

        const stageTrendToggleBtn = e.target.closest?.('[data-action="toggleStageTrendCollapse"]');
        if (stageTrendToggleBtn) {
          e.preventDefault();
          e.stopPropagation();

          saveHifzStageTrendCollapsed(!loadHifzStageTrendCollapsed());
          applyHifzStageTrendCollapsedUi(view);
          return;
        }

        // ✅ View-Mode Toggle (Ayah/Mushaf)
        const toggleBtn = e.target.closest?.('[data-action="toggleView"]');
        if (toggleBtn) {
          toggleViewMode();
          return;
        }

const suraBtn = e.target.closest?.("button.suraPlayBtn");
if (suraBtn) {
  const s = Number(suraBtn.dataset?.surah || 0);
  if (s >= 1 && s <= 114) {
    toggleSurahPlaybackFromBtn(s, suraBtn);
  }
  return;
}

      const hiddenTrainChunk = getHiddenTrainChunkFromTarget(e.target);
      if (hiddenTrainChunk) {
        e.preventDefault();
        e.stopPropagation();

        const r = String(hiddenTrainChunk.getAttribute("data-ref") || "");
        if (!r) return;

        revealHifzTrainMaskRef(r);
        focusHifzTrainMaskRefInView(view, r, { updateUrl: true, scroll: false, behavior: "smooth" });

        if (isHifzTrainWriteStage()) {
          requestAnimationFrame(() => {
            focusHifzTrainWriteInputByRef(r);
          });
        }
        return;
      }

        // Word click: plays WBW deterministic audio (data-audio), fallback to data-audio2
        const wEl = e.target.closest(".w");
        if (wEl && !wEl.classList.contains("wMark")) {
          e.stopPropagation();

          const chunk = wEl.closest(".mChunk");
          const r = chunk?.getAttribute("data-ref");
          if (!r) return;

          // Fokus + URL
          setFocus(r, { updateUrl: true, scroll: false });

          stopSurahQueue();
          stopVerseAudio();

          playWordFromSpan(wEl);
          return;
        }

// Nummer-Kreis: Ayah MP3 / Favorit (Ctrl+Click)
const noBtn = e.target.closest(".mNo");

if (noBtn) {
  e.stopPropagation();
  const r = noBtn.getAttribute("data-ref");
  if (!r) return;

if (isHifzTrainWriteStage() && isHifzTrainMaskOn() && isHifzTrainMaskRatePending(r)) {
  e.preventDefault();
  e.stopPropagation();
  setTimeout(() => focusHifzTrainWriteInputByRef(r), 0);
  return;
}

if (isHifzTrainMaskOn() && noBtn.classList.contains("is-train-rate-open") && isHifzTrainMaskRatePending(r)) {
  e.preventDefault();
  e.stopPropagation();

  const rateEl = e.target.closest?.(".mTrainRateHalf[data-rate]");
  let rate = String(rateEl?.getAttribute("data-rate") || "").trim().toLowerCase();

  if (!(rate === "bad" || rate === "good")) {
    const rect = noBtn.getBoundingClientRect();
    rate = (e.clientX < (rect.left + (rect.width / 2))) ? "bad" : "good";
  }

  const flightSource = rateEl || noBtn;
  const flight =
    (typeof runHifzTrainMaskRateFlight === "function")
      ? runHifzTrainMaskRateFlight(flightSource, r, rate)
      : { started:false, arrivalDelay:0, totalDelay:340 };

  if (flight && flight.started) {
    setTimeout(() => {
      rateHifzTrainMaskRef(r, rate);

      if (isHifzTrainWriteStage()) {
        suppressNextMushafCenterScroll(320);
        renderCurrent(r);
      } else {
        syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
      }
    }, flight.arrivalDelay);
    return;
  }

  rateHifzTrainMaskRef(r, rate);

  if (isHifzTrainWriteStage()) {
    suppressNextMushafCenterScroll(320);
    renderCurrent(r);
  } else {
    syncHifzTrainMaskDom(getActiveHifzTrainMaskView() || document);
  }
  return;
}

    // ✅ SHIFT + Klick => NOTES (nur im Mushaf-Mode)
  if (viewMode === "mushaf" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    openNotesForRef(r);
    return;
  }

  // ✅ SHIFT + Klick => Notes (kein Play!)
  if (viewMode === "mushaf" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    openNotesForRef(r);
    return;
  }

  // ✅ ALT + Klick => NUR Copy (kein Play!)
  if (viewMode === "mushaf" && e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    copyAyahRef(r, { flashEl: noBtn });
    return;
  }

  // ✅ STRG/CTRL (oder Mac CMD) + Klick => Favorit togglen (nur im Mushaf-Mode)
  if (viewMode === "mushaf" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();

    // ✅ in Mushaf: aktive Favoritenseite togglen (actual ODER preset)
    const res =
      (typeof toggleFavInActivePage === "function")
        ? toggleFavInActivePage(r)
        : toggleBookmark(r);

    const isNowFav =
      (res && typeof res === "object" && "bookmarked" in res)
        ? !!res.bookmarked
        : !!res;

    // UI am Button
    noBtn.classList.toggle("is-fav", isNowFav);

    // ✅ WICHTIG: favSet updaten (das ist die Render-Quelle für Mushaf-Markierungen)
    try {
      if (isNowFav) favSet.add(r);
      else favSet.delete(r);
    } catch {}

    try { window.__refreshFavCount?.(); } catch {}
    try { window.__refreshFavButtonDecor?.(); } catch {}

    return;
  }

  // Normaler Klick:
  const a = getAyah(r);
  if (!a) return;

  setFocus(r, { updateUrl: true, scroll: false });

  // ✅ Wenn SurahPlay läuft: von HIER weiter spielen (wie Klick auf Fortschritts-Strich)
  if (surahPlaying && typeof startSurahPlayback === "function") {
    const playStop = document.getElementById("playStop");
    startSurahPlayback(a.surah, { fromAyah: a.ayah, btn: playStop || undefined });
    return;
  }

  // sonst: Ayah-MP3 (Single)
  stopSurahQueue();
  const url = ayahMp3Url(a.surah, a.ayah);
  playFromButton(noBtn, url);
  return;
}

        // Klick auf Chunk: nur Fokus + URL
        const chunk = e.target.closest(".mChunk");
        if (chunk) {
          const r = chunk.getAttribute("data-ref");
          if (!r) return;
          setFocus(r, { updateUrl: true, scroll: false });
        }
      });
    }

    view.addEventListener("input", (e) => {
      const input = e.target.closest("[data-hifz-write-input]");
      if (!input) return;
      handleHifzTrainWriteRawInput(input, String(input.value || ""));
    });

    view.addEventListener("compositionend", (e) => {
      const input = e.target.closest("[data-hifz-write-input]");
      if (!input) return;
      handleHifzTrainWriteRawInput(input, String(e.data || input.value || ""));
    });

    view.addEventListener("keydown", (e) => {
      const input = e.target.closest("[data-hifz-write-input]");
      if (!input) return;

      const ref = String(input.getAttribute("data-hifz-write-input") || "");

      if ((e.key === " " || e.code === "Space") && isHifzTrainWriteStage()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }

      if (isHifzTrainWriteCoolingDown(ref) && e.key !== "Tab") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "Tab" && isHifzTrainWriteStage()) {
        e.preventDefault();
        setTimeout(() => {
          focusHifzTrainWriteInputByRef(ref);
        }, 0);
      }
    });

    view.addEventListener("mouseover", (e) => {
      const chunk = getHiddenTrainChunkFromTarget(e.target);
      if (!chunk) return;

      const r = String(chunk.getAttribute("data-ref") || "");
      if (!r) return;

      scheduleHifzTrainMaskReveal(r, 1000);
    }, { passive: true });

    view.addEventListener("mouseout", (e) => {
      const chunk = e.target?.closest?.(".mChunk.is-train-hidden[data-ref]");
      if (!chunk) return;

      const r = String(chunk.getAttribute("data-ref") || "");
      if (!r) return;

      const rel = e.relatedTarget;
      const stillInsideSameChunk =
        rel?.closest?.(`.mChunk.is-train-hidden[data-ref="${CSS.escape(r)}"]`);

      if (stillInsideSameChunk) return;
      clearHifzTrainMaskHoverTimer(r);
    }, { passive: true });

    if (!document.__hifzTrainMaskHotkeysBound) {
      document.__hifzTrainMaskHotkeysBound = true;

      document.addEventListener("keydown", (e) => {
        const key = String(e.key || "");
        const code = String(e.code || "");

        const isSpace = code === "Space" || key === " ";
        const isCtrlSpace = isSpace && !!e.ctrlKey;
        const isBad = key === "1" || code === "Digit1" || code === "Numpad1";
        const isGood = key === "3" || code === "Digit3" || code === "Numpad3";
        const isEscape = key === "Escape" || code === "Escape";

        if (!isSpace && !isBad && !isGood && !isEscape) return;

        const ae = document.activeElement;
        const typing =
          ae &&
          (ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.isContentEditable);

        if (typing) return;
        if (!isHifzTrainMaskOn()) return;

        if (isSpace) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }

          if (e.repeat) return;
        } else if (e.repeat) {
          return;
        }

        if (isEscape) {
          setHifzTrainMaskOn(false);
          renderCurrent(currentRef);

          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }
          return;
        }

        const activeView = getActiveHifzTrainMaskView();
        if (!activeView) return;

        const now = (typeof performance !== "undefined" && typeof performance.now === "function")
          ? performance.now()
          : Date.now();

        if (isSpace && isHifzTrainWriteStage() && !isCtrlSpace) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }
          return;
        }

        if (isSpace) {
          if (now < __hifzTrainMaskSpaceCooldownUntil) return;

          if (isCtrlSpace) {
            const orderedRefs = Array.from(activeView.querySelectorAll(".mChunk[data-ref]"))
              .map((el) => String(el.getAttribute("data-ref") || "").trim())
              .filter((r) => isValidHifzTrainRef(r));

            const pendingRef = getHifzTrainMaskPendingRateRef();
            const currentRefStr = String(currentRef || "").trim();

            let refToCover =
              (pendingRef && isHifzTrainMaskRevealed(pendingRef))
                ? pendingRef
                : (isHifzTrainMaskRevealed(currentRefStr) ? currentRefStr : "");

            if (!refToCover) {
              const currentIdx = orderedRefs.indexOf(currentRefStr);
              for (let i = currentIdx - 1; i >= 0; i -= 1) {
                const candidate = orderedRefs[i];
                if (isHifzTrainMaskRevealed(candidate)) {
                  refToCover = candidate;
                  break;
                }
              }

              if (!refToCover) {
                for (let i = orderedRefs.length - 1; i >= 0; i -= 1) {
                  const candidate = orderedRefs[i];
                  if (isHifzTrainMaskRevealed(candidate)) {
                    refToCover = candidate;
                    break;
                  }
                }
              }
            }

            if (!refToCover) return;

            let prevRevealedRef = "";
            const coverIdx = orderedRefs.indexOf(refToCover);

            for (let i = coverIdx - 1; i >= 0; i -= 1) {
              const candidate = orderedRefs[i];
              if (isHifzTrainMaskRevealed(candidate)) {
                prevRevealedRef = candidate;
                break;
              }
            }

            __hifzTrainMaskSpaceCooldownUntil = now + 140;
            coverHifzTrainMaskRef(refToCover);

            if (prevRevealedRef) {
              focusHifzTrainMaskRefInView(activeView, prevRevealedRef, {
                updateUrl: true,
                scroll: false
              });
            }

            return;
          }

          if (!revealCurrentOrFirstHiddenTrainAyah(activeView)) return;

          __hifzTrainMaskSpaceCooldownUntil = now + 140;
          return;
        }

        const pendingRef = getHifzTrainMaskPendingRateRef();
        if (!pendingRef) return;
        if (isHifzTrainWriteStage()) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }

        const pendingBtnSelector = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
          ? `.mNo.is-train-rate-open[data-ref="${CSS.escape(pendingRef)}"]`
          : `.mNo.is-train-rate-open[data-ref="${pendingRef.replace(/"/g, '\\"')}"]`;

        const pendingBtn =
          activeView.querySelector(pendingBtnSelector) ||
          document.querySelector(pendingBtnSelector);

        const rate = isBad ? "bad" : "good";
        const flight =
          (typeof runHifzTrainMaskRateFlight === "function")
            ? runHifzTrainMaskRateFlight(pendingBtn, pendingRef, rate)
            : { started:false, arrivalDelay:0, totalDelay:340 };

        if (flight && flight.started) {
          setTimeout(() => {
            rateHifzTrainMaskRef(pendingRef, rate);
            renderCurrent(pendingRef);
          }, flight.arrivalDelay);
          return;
        }

        rateHifzTrainMaskRef(pendingRef, rate);
        renderCurrent(pendingRef);
      }, { capture: true });
    }
  }

// Scroll: Auto-Fokus (performant: Positions-Cache + rAF)

view.__mushafPosCache = null;
view.__mushafRAF = 0;
view.__mushafLastRef = "";

function rebuildMushafPosCache() {
  // Cache der Buttons + ihrer Position im Scroll-Container
  const btns = Array.from(view.querySelectorAll(".mNo"));
  view.__mushafBtnsCache = btns;

  const arr = [];
  for (const el of btns) {
    const ref = el.getAttribute("data-ref");
    if (!ref) continue;
    // centerY im Container-Koordinatensystem (scrollTop basiert)
    const cy = el.offsetTop + el.offsetHeight * 0.5;
    arr.push({ ref, cy, el });
  }

  // Sicherheit: nach cy sortieren (meist eh schon korrekt)
  arr.sort((a, b) => a.cy - b.cy);

  view.__mushafPosCache = arr;
  view.__mushafCacheDirty = false;
}

function findNearestRefByScroll() {
  const arr = view.__mushafPosCache;
  if (!arr || !arr.length) return "";

  const targetY = view.scrollTop + view.clientHeight * 0.40;

  // binary search nach nächstem cy
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].cy < targetY) lo = mid + 1;
    else hi = mid;
  }

  // lo ist der erste >= targetY, prüfe Nachbarn
  const a = arr[lo];
  const b = arr[lo - 1];
  if (!b) return a.ref;

  return (Math.abs(a.cy - targetY) < Math.abs(b.cy - targetY)) ? a.ref : b.ref;
}

function applyMushafFocus(refBest) {
  if (!refBest) return;
  if (refBest === view.__mushafLastRef) return;

  // Fokus-Klasse nur ändern wenn wirklich nötig
  view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
  const b = view.querySelector(`.mNo[data-ref="${CSS.escape(refBest)}"]`);
  if (b) b.classList.add("is-focus");

  view.__mushafLastRef = refBest;
  currentRef = refBest;

  const ab = getAyah(refBest);
  if (ab) currentSurahInView = ab.surah;
}

view.addEventListener("scroll", () => {
  // ✅ wenn Render-All pausiert war: beim Scrollen weiter rendern (nur Mushaf)
  if (renderAll && i < refs.length && !view.__mushafRenderJob) {
    view.__mushafRenderJob = scheduleRender(renderChunk, { timeout: 120 });
  }

  if (view.__mushafRAF) return; // rAF already scheduled
  view.__mushafRAF = requestAnimationFrame(() => {
    view.__mushafRAF = 0;

    if (view.__mushafCacheDirty || !view.__mushafPosCache) {
      rebuildMushafPosCache();
    }

    // ✅ Wenn Ayah-Audio läuft: Fokus NICHT wechseln
    if (verseAudio && !verseAudio.paused && verseRefPlaying) {
      applyMushafFocus(verseRefPlaying);
      return;
    }

    // ✅ Trainmode: passives Scrollen darf den aktiven Ref nicht auf die
    // Mittel-Ayah der sichtbaren Range umbiegen, sonst entstehen Gegen-Scrolls.
    if (isHifzTrainMaskOn()) {
      const lockedTrainRef = String(getHifzTrainMaskPendingRateRef() || currentRef || "").trim();
      if (isValidHifzTrainRef(lockedTrainRef)) {
        applyMushafFocus(lockedTrainRef);
      }
      return;
    }

    const refBest = findNearestRefByScroll();
    applyMushafFocus(refBest);
  });
}, { passive: true });

  }

// =========================
// FIRST VISIT WELCOME (Intentions + Surah Grid + Donate)
// =========================

// ✅ Welcome soll bei “neuem Besuch” wieder kommen,
// aber NICHT bei Reload -> wir merken nur “in diesem Tab schon gezeigt”
const SS_WELCOME_SHOWN_THIS_TAB = "q_welcome_shown_tab_v1";

const LS_INTENTS = "q_intents_v1";

// Keep DEFAULT_INTENTS small (used only when localStorage is empty)
const DEFAULT_INTENTS = [
  "I intend this hifz for Allah alone",
  "I intend to preserve Allah’s Book in my heart",
  "I intend to review it faithfully and not neglect it",
];

// All options in collapsible groups (accordion)
const INTENT_GROUPS = [
  {
    title: "Sincerity & Worship",
    items: [
      "I intend this hifz for Allah alone",
      "I intend to seek closeness to Allah through memorizing His Book",
      "I intend to deepen repentance (Tawba) through hifz",
      "I intend to strengthen sincerity (Ikhlas)",
      "I intend to grow in taqwa through memorizing the Quran",
      "I intend to nurture hope (Raja') through the Quran",
      "I intend to train patience (Sabr) through steady hifz",
      "I intend to strengthen trust in Allah (Tawakkul)",
      "I intend to develop humility through the Quran",
      "I intend to find sakina through hifz and review",
      "I intend to purify my heart (Tazkiya) through the Quran",
      "I intend to increase love for Allah and for goodness",
      "I intend to remember the Hereafter through hifz",
      "I intend to keep awareness of my mortality through the Quran",
      "I intend to deepen my understanding of Allah’s mercy",
      "I intend to understand Allah’s justice more deeply",
      "I intend to seek Allah’s guidance (Huda) through hifz",
      "I intend to awaken my heart when it becomes spiritually weak"
    ]
  },

  {
    title: "Preservation & Review",
    items: [
      "I intend to preserve Allah’s Book in my heart",
      "I intend to review it faithfully and not neglect it",
      "I intend to make the Quran my daily companion",
      "I intend to keep my memorization strong through repetition",
      "I intend to protect what I memorize from being forgotten",
      "I intend to stay consistent in hifz even when motivation is low",
      "I intend to complete my memorization with discipline and patience",
      "I intend to build regular consistency (Wird)",
      "I intend to train concentration (Khushu') during hifz",
      "I intend to improve my Tajwid while memorizing",
      "I intend to memorize specific surahs needed in daily worship",
      "I intend to keep personal notes that help me retain the Quran"
    ]
  },

  {
    title: "Understanding & Living by the Quran",
    items: [
      "I intend to understand the meaning and message of what I memorize",
      "I intend to grasp the structure and composition of a surah",
      "I intend to identify recurring themes while memorizing",
      "I intend to use the stories of the prophets as learning material",
      "I intend to clarify long-held questions through the Quran",
      "I intend to live by what I memorize",
      "I intend to let the Quran correct my character",
      "I intend to sharpen my moral compass through hifz",
      "I intend to put my life priorities in order through the Quran",
      "I intend to correct myself through honest self-reflection",
      "I intend to strengthen impulse control through the Quran",
      "I intend to take responsibility more consciously",
      "I intend to let the Quran guide my choices and priorities",
      "I intend to make the Quran proof for me, not against me"
    ]
  },

  {
    title: "Character, Habits & Daily Life",
    items: [
      "I intend to promote honesty",
      "I intend to strengthen a sense of justice",
      "I intend to cultivate compassion and mercy",
      "I intend to learn generosity",
      "I intend to practice modesty instead of ego",
      "I intend to practice forgiveness",
      "I intend to reduce envy",
      "I intend to restrain anger",
      "I intend to avoid spite and malice",
      "I intend to increase helpfulness",
      "I intend to deepen respect for others",
      "I intend to improve communication ethics",
      "I intend to derive practical action steps from what I memorize",
      "I intend to improve my habits through the Quran",
      "I intend to stabilize daily discipline and routine",
      "I intend to leave sins and harmful habits through the Quran"
    ]
  },

  {
    title: "Prayer, Family & Benefit",
    items: [
      "I intend to stand with the Quran in prayer",
      "I intend to beautify my salah with memorized Quran",
      "I intend to let hifz inspire my dua",
      "I intend to strengthen shared values in my family",
      "I intend to benefit my family through my hifz",
      "I intend to approach family conflicts with more kindness",
      "I intend to reflect on relationships through the guidance of the Quran",
      "I intend to teach and pass on the Quran when Allah allows",
      "I intend to encourage others to love and memorize the Quran",
      "I intend to be among the people of the Quran",
      "I intend to use my hifz in service of good"
    ]
  },

  {
    title: "Protection, Healing & Right Motives",
    items: [
      "I intend to ask Allah for protection from temptations",
      "I intend to gain steadfastness in trials through the Quran",
      "I intend to ask for healing and relief through the Quran",
      "I intend to nurture hope during low motivation",
      "I intend to reduce anxiety through the rhythm of hifz and review",
      "I intend to bring order to inner turmoil through the Quran",
      "I intend to build resilience through memorizing Allah’s Book",
      "I intend not to seek status through hifz",
      "I intend not to memorize for praise or reputation",
      "I intend not to use the Quran for showing off",
      "I intend not to make hifz about numbers, speed, or image",
      "I intend to renew my intention whenever it becomes weak",
      "I intend to ask Allah to protect my hifz from riya'",
      "I intend to keep this journey sincere even if no one sees it"
    ]
  },
];

// build checkboxes (grouped)
function renderChecks() {

const checksEl = document.getElementById("welcomeChecks");
if (!checksEl) throw new Error("#welcomeChecks not found");

  const selected = _loadIntents();

  checksEl.innerHTML = INTENT_GROUPS.map((g, gi) => {
    const groupId = `intentGroup_${gi}`;
    const itemsHtml = (g.items || []).map((label) => {
      const safe = String(label);
      const id = "intent_" + safe.replace(/\s+/g, "_").replace(/[^\w-]/g, "");
      const checked = selected.has(safe) ? "checked" : "";
      return `
        <label class="welcomeCheck" for="${id}">
          <input class="welcomeCheckBox" id="${id}" type="checkbox" data-intent="${safe}" ${checked}/>
          <span class="welcomeCheckText">${safe}</span>
        </label>
      `;
    }).join("");

    // <details> macht "aufklappbar" ohne extra JS
    return `
      <details class="intentGroup">
        <summary class="intentGroupSummary">${g.title}</summary>
        <div class="intentGroupItems">${itemsHtml}</div>
      </details>
    `;
  }).join("");

  // events: speichern wenn geklickt
  checksEl.querySelectorAll("input.welcomeCheckBox[data-intent]").forEach((chk) => {
    chk.addEventListener("change", () => {
      const label = chk.getAttribute("data-intent") || "";
      const set = _loadIntents();
      if (chk.checked) set.add(label);
      else set.delete(label);
      _saveIntents(set);
    });
  });
}
function _getAllIntentsSafe() {
  // 1) Wenn ALL_INTENTS existiert, nimm das
  if (typeof ALL_INTENTS !== "undefined" && Array.isArray(ALL_INTENTS) && ALL_INTENTS.length) {
    return ALL_INTENTS.map(String);
  }

  // 2) Sonst: aus INTENT_GROUPS flatten (wenn vorhanden)
  if (typeof INTENT_GROUPS !== "undefined" && Array.isArray(INTENT_GROUPS)) {
    const flat = INTENT_GROUPS.flatMap(g => Array.isArray(g?.items) ? g.items : []).map(String);
    return Array.from(new Set(flat));
  }

  // 3) Letzter Fallback: wenn DEFAULT_INTENTS existiert
  if (typeof DEFAULT_INTENTS !== "undefined" && Array.isArray(DEFAULT_INTENTS)) {
    return DEFAULT_INTENTS.map(String);
  }

  // 4) Nichts verfügbar -> leer
  return [];
}

function _loadIntents() {
  const all = _getAllIntentsSafe();
  const allSet = new Set(all);

  try {
    const raw = localStorage.getItem(LS_INTENTS);

    // Beim ersten Besuch: alles an (wenn wir überhaupt eine Liste haben)
    if (!raw) return new Set(all);

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(all);

    const set = new Set(
      arr
        .map(String)
        .filter((label) => allSet.has(label))
    );

    // Wenn nach dem Filtern nichts übrig bleibt: wieder alles an
    if (set.size === 0) return new Set(all);

    return set;
  } catch {
    return new Set(all);
  }
}
function _saveIntents(set) {
  try {
    const arr = Array.from(set || []).map(String);
    localStorage.setItem(LS_INTENTS, JSON.stringify(arr));
  } catch {}
}

function ensureWelcomeModal() {
  let ov = document.getElementById("welcomeOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "welcomeOverlay";
  ov.className = "welcomeOverlay";

  ov.innerHTML = `
    <div class="welcomeModal" role="dialog" aria-modal="true" aria-label="Welcome">
<div class="welcomeHeader">
  <div class="welcomeHeaderCenter">
    <div class="welcomeTitle">With what intentions do you memorize the Quran?</div>
    <div class="welcomeSubtitle">(Choose sincere intentions for hifz, review, and living by the Quran.)</div>
  </div>
  <button class="welcomeClose" id="welcomeClose" type="button" aria-label="Close">✕</button>
</div>

      <!-- ✅ ACCOUNT BAR (NEU) -->
      <div class="welcomeAuth" id="welcomeAuth">
        <div class="welcomeAuthTop">
          <div class="welcomeAuthTitle">
  Create an account
  <span class="welcomeAuthTitleHint">(no email required, save bookmarks and notes in the cloud instead of localstorage if needed)</span>
</div>
          <button class="welcomeAuthLogout" id="welcomeAuthLogout" type="button" aria-label="Log out">Log out</button>
        </div>

        <div class="welcomeAuthRow">
          <input
            class="welcomeAuthInput"
            id="welcomeUsername"
            type="text"
            autocomplete="username"
            placeholder="example Muhammad114"
          />
          <input
            class="welcomeAuthInput"
            id="welcomePassword"
            type="password"
            autocomplete="current-password"
            placeholder="Password"
          />

          <div class="welcomeAuthActions">
            <button class="welcomeAuthBtn" id="welcomeLoginBtn" type="button">Log in</button>
            <button class="welcomeAuthBtn is-primary" id="welcomeCreateBtn" type="button">Create account</button>
          </div>
        </div>

        <div class="welcomeAuthMsg" id="welcomeAuthMsg" aria-live="polite"></div>
      </div>

      <div class="welcomeBody">
        <div class="welcomeSection">
          <div class="welcomeChecks" id="welcomeChecks"></div>
        </div>

        <div class="welcomeSection">
          <div class="welcomeSectionTitle">Choose a Surah</div>
          <div class="welcomeSurahGrid" id="welcomeSurahGrid"></div>
        </div>

<div class="welcomeSection welcomeSectionDonate">

  <div class="welcomeDonateText">
    <p class="welcomeDonateP">
      Take part in earning Hasanat. 100% of donations go toward maintenance, and anything extra goes toward new features.
    </p>
  </div>

  <div class="welcomeDonateActions">
    <a class="welcomeDonateBtn" href="https://paypal.me/quranm" target="_blank" rel="noopener noreferrer">Donate</a>
  </div>

</div>

      </div>

      <!-- ✅ Footer wieder da: Continue Button -->
      <div class="welcomeFooter">
        <button class="welcomeContinue" id="welcomeContinue" type="button">Continue</button>
      </div>

    </div>
  `;

  document.body.appendChild(ov);

  const modal = ov.querySelector(".welcomeModal");
  const btnClose = ov.querySelector("#welcomeClose");
    const btnContinue = ov.querySelector("#welcomeContinue");

  // init (bind auth once)
  try { initWelcomeAuth(ov); } catch {}

  function closeAndRemember() {
    // ✅ "Shown this tab" setzen, damit "neuer Besuch" wieder Welcome zeigt
    try { sessionStorage.setItem(SS_WELCOME_SHOWN_THIS_TAB, "1"); } catch {}
    ov.classList.remove("is-open");
  }

  // outside click closes
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeAndRemember();
  });

  btnClose.addEventListener("click", (e) => {
    e.preventDefault();
    closeAndRemember();
  });

  btnContinue?.addEventListener("click", (e) => {
    e.preventDefault();
    closeAndRemember();
  });

  // close by ESC
  window.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("is-open")) return;
    if (e.key === "Escape") closeAndRemember();
  });

  // Clicking a Surah in grid -> go
  function renderSurahGrid() {
    const grid = ov.querySelector("#welcomeSurahGrid");
    if (!grid) return;

    function getWelcomeSurahProgressPct(surahNo){
      try{
        if (typeof getHifzSurahProgressPct === "function") {
          return Math.max(0, Math.min(100, Number(getHifzSurahProgressPct(surahNo) || 0)));
        }

        if (typeof getSuraRefs !== "function" || typeof getHifzProgressRatioForRef !== "function") {
          return 0;
        }

        const stage = String(
          (typeof hifzStageValue !== "undefined" && hifzStageValue) ? hifzStageValue : "1"
        );

        const refs = getSuraRefs(Number(surahNo) || 0) || [];
        if (!refs.length) return 0;

        let sum = 0;
        let count = 0;

        for (const ref of refs){
          const ratio = Number(getHifzProgressRatioForRef(ref, stage) || 0);
          sum += Math.max(0, Math.min(1, ratio));
          count += 1;
        }

        if (!count) return 0;
        return Math.max(0, Math.min(100, Math.round((sum / count) * 100)));
      }catch{
        return 0;
      }
    }

    // build styled grid 1..114 (matches app.css: .welcomeSuraCard / .welcomeSuraNo / .welcomeSuraAr / .welcomeSuraAyahs)
    grid.innerHTML = Array.from({ length: 114 }, (_, i) => {
      const s = i + 1;
      const meta = (typeof getSuraMeta === "function") ? getSuraMeta(s) : null;

      const nameEn = (meta && (meta.name_en || meta.nameEn || meta.name || meta.english)) ? String(meta.name_en || meta.nameEn || meta.name || meta.english) : `Surah ${s}`;
      const nameAr = (meta && (meta.name_ar || meta.nameAr || meta.arabic)) ? String(meta.name_ar || meta.nameAr || meta.arabic) : "";
      const ayahs  = (meta && (meta.ayahs || meta.verses || meta.count)) ? Number(meta.ayahs || meta.verses || meta.count) : 0;

      const ayahLabel = ayahs ? `${ayahs} Ayahs` : "";
      const pct = getWelcomeSurahProgressPct(s);
      const progressStyle = `--welcome-sura-progress-pct:${pct}%;`;

      return `
        <button class="welcomeSuraCard${pct > 0 ? " is-progress" : ""}${pct >= 100 ? " is-mastered" : ""}" type="button" data-s="${s}" style="${progressStyle}">
          <div class="welcomeSuraNo">${s}</div>

          <div class="welcomeSuraLeft">
            <div class="welcomeSuraName">${nameEn}</div>
          </div>

          <div class="welcomeSuraRight">
            <div class="welcomeSuraAr">${nameAr}</div>
            <div class="welcomeSuraAyahs">${ayahLabel}</div>
          </div>
        </button>
      `;
    }).join("");

    grid.querySelectorAll("button.welcomeSuraCard[data-s]").forEach((b) => {
      b.addEventListener("click", () => {
        const s = parseInt(b.getAttribute("data-s") || "0", 10);
        if (!Number.isFinite(s) || s < 1 || s > 114) return;
        closeAndRemember();
        try { goToRef(`${s}:1`); } catch {}
      });
    });
  }

  ov._welcome = {
    open() {
      // ✅ zuerst sichtbar machen, damit ein späterer Render-Fehler
      // das Öffnen nicht komplett verhindert
      ov.classList.add("is-open");

      // build current UI fresh
      try { renderChecks(); } catch (e) { console.warn("[welcome] renderChecks failed:", e); }
      try { renderSurahGrid(); } catch (e) { console.warn("[welcome] renderSurahGrid failed:", e); }

      // refresh auth UI each time
      try { refreshWelcomeAuthUI(); } catch (e) { console.warn("[welcome] refreshWelcomeAuthUI failed:", e); }

      // focus for accessibility
      try { modal.focus?.(); } catch {}
    }
  };

  return ov;
}

// =========================
// AUTH (Cloudflare Worker + D1)
// Username + Password (no email)
// Sync: localStorage -> account state
// =========================

const LS_AUTH_TOKEN  = "q_auth_token_v1";
const LS_AUTH_USER   = "q_auth_user_v1";
const LS_AUTH_SET_AT = "q_auth_set_at_v1"; // ✅ für 114 Tage Login

function _authBase() {
  // ✅ immer Worker nutzen (auch auf localhost)
  return "https://quranmapi.u87bc15v3.workers.dev";
}

function _setAuth(token, username) {
  try { localStorage.setItem(LS_AUTH_TOKEN, token || ""); } catch {}
  try { localStorage.setItem(LS_AUTH_USER, username || ""); } catch {}

  // ✅ wichtig: sonst ist __isLoggedIn() false und Pull läuft nie
  try { localStorage.setItem(LS_AUTH_SET_AT, String(Date.now())); } catch {}
}

function _clearAuth() {
  try { localStorage.removeItem(LS_AUTH_TOKEN); } catch {}
  try { localStorage.removeItem(LS_AUTH_USER); } catch {}
  try { localStorage.removeItem(LS_AUTH_SET_AT); } catch {}
}
function _getAuthToken() {
  try { return localStorage.getItem(LS_AUTH_TOKEN) || ""; } catch { return ""; }
}
function _getAuthUser() {
  try { return localStorage.getItem(LS_AUTH_USER) || ""; } catch { return ""; }
}

async function _api(path, opts = {}) {
  const token = _getAuthToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    (opts.headers || {})
  );
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(_authBase() + path, Object.assign({}, opts, { headers }));
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { ok:false, error: txt || "Bad JSON" }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function _exportLocalState() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // your app keys mostly start with q_ or quranm_
      if (k.startsWith("q_") || k.startsWith("quranm_")) {
        out[k] = localStorage.getItem(k);
      }
    }
  } catch {}
  return out;
}

function _applyState(stateObj) {
  if (!stateObj || typeof stateObj !== "object") return;
  try {
    Object.keys(stateObj).forEach((k) => {
      const v = stateObj[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    });
  } catch {}
}

function _mergeStates(localState, remoteState, { preferLocal = true } = {}) {
  if (!preferLocal) {
    return Object.assign({}, remoteState || {});
  }

  const merged = Object.assign({}, remoteState || {}, localState || {});

  // merge bookmarks by union (array of "sura:ayah") – nur wenn Local bewusst gewinnen darf
  const BK = (typeof LS_BOOKMARKS !== "undefined") ? LS_BOOKMARKS : "q_bookmarks_v1";
  try {
    const a = localState && localState[BK] ? JSON.parse(localState[BK]) : [];
    const b = remoteState && remoteState[BK] ? JSON.parse(remoteState[BK]) : [];
    const ua = Array.isArray(a) ? a : [];
    const ub = Array.isArray(b) ? b : [];
    const uni = Array.from(new Set([...ua, ...ub].map(String))).filter((r) => /^\d+:\d+$/.test(r));
    merged[BK] = JSON.stringify(uni);
  } catch {}

  return merged;
}

async function syncAccountState() {
  // 1) get remote
  let remote = {};
  let remoteLoaded = false;

  try {
    const got = await _api("/api/state", { method: "GET" });
    remote = (got && got.state) ? got.state : {};
    remoteLoaded = true;
  } catch {
    remote = {};
    remoteLoaded = false;
  }

  // 2) compare local vs remote
  const local = _exportLocalState();
  const BK = (typeof LS_BOOKMARKS !== "undefined") ? LS_BOOKMARKS : "q_bookmarks_v1";

  const SYNC_IGNORE_KEYS = new Set([
    "q_auth_token_v1",
    "q_auth_set_at_v1",
    "q_auth_user_v1",
    "q_account_sync_last_at_v1",
    "q_account_sync_status_v1",
    "q_account_sync_mode_v1",
    LS_ACC_SYNC_CONFLICT
  ]);

  function _stableSortDeep(value) {
    if (Array.isArray(value)) return value.map(_stableSortDeep);

    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach((k) => {
        out[k] = _stableSortDeep(value[k]);
      });
      return out;
    }

    return value;
  }

  function _normalizeStateForCompare(stateObj) {
    const src = (stateObj && typeof stateObj === "object") ? stateObj : {};
    const out = {};
    const keys = Object.keys(src)
      .map(String)
      .filter((k) => !SYNC_IGNORE_KEYS.has(k))
      .sort();

    for (const k of keys) {
      const raw = src[k];
      if (typeof raw !== "string") continue;

      if (k === BK) {
        try {
          const arr = JSON.parse(raw);
          const clean = Array.isArray(arr)
            ? arr.map(String).filter((r) => /^\d+:\d+$/.test(r)).sort()
            : [];
          out[k] = JSON.stringify(clean);
          continue;
        } catch {}
      }

      try {
        out[k] = JSON.stringify(_stableSortDeep(JSON.parse(raw)));
      } catch {
        out[k] = raw;
      }
    }

    return JSON.stringify(out);
  }

  if (!remoteLoaded) {
    try { window.__refreshAccountSyncUi?.(); } catch {}
    return { ok: false, mismatch: false };
  }

  const localNormalized = _normalizeStateForCompare(local);
  const remoteNormalized = _normalizeStateForCompare(remote);

  const statesDiffer = (localNormalized !== remoteNormalized);

  if (statesDiffer) {
    __setAccountSyncConflict(true);

    try { window.__refreshAccountSyncUi?.(); } catch {}

    try {
      window.alert(
        'Account storage ≠ Browser storage, click account button to upload Browser storage ("Save device") or import Account storage ("Load account")'
      );
    } catch {}

    return { ok: true, mismatch: true };
  }

  __setAccountSyncConflict(false);

  // 3) states already match -> local nur sauber aktualisieren
  const merged = _mergeStates(local, remote, { preferLocal: true });
  _applyState(merged);

  // ✅ Theme + Style AFTER state got applied
  try {
    applyTheme(loadTheme());
  } catch (e) {
    console.warn("[theme] applyTheme after sync failed:", e);
  }

  try {
    const sid = loadStyleThemeId();
    if (sid) applyStyleThemeById(sid);
  } catch (e) {
    console.warn("[style] re-apply style after sync failed:", e);
  }

  // refresh UI bits that depend on localStorage
  try { syncUI?.(); } catch {}
  try { renderChecks?.(); } catch {}
  try { window.__refreshAccountHifzScore?.(); } catch {}
  try { window.__refreshAccountSyncUi?.(); } catch {}

  return { ok: true, mismatch: false };
}

function initWelcomeAuth(ov) {
  if (!ov || ov.__authBound) return;
  ov.__authBound = true;

  const elUser = ov.querySelector("#welcomeUsername");
  const elPass = ov.querySelector("#welcomePassword");
  const btnLogin = ov.querySelector("#welcomeLoginBtn");
  const btnCreate = ov.querySelector("#welcomeCreateBtn");
  const btnLogout = ov.querySelector("#welcomeAuthLogout"); // bleibt vorhanden, wird aber versteckt
  const msg = ov.querySelector("#welcomeAuthMsg");

  function setMsg(t, isErr) {
    if (!msg) return;
    msg.textContent = t || "";
    msg.classList.toggle("is-error", !!isErr);
    msg.classList.toggle("is-ok", !isErr && !!t);
  }

  function setLoggedInUI(isIn) {
    ov.classList.toggle("is-logged-in", !!isIn);

    // ✅ Wir benutzen NICHT mehr den extra Logout-Button oben rechts
    if (btnLogout) btnLogout.style.display = "none";

    // ✅ Log in Button wird zu Log out
    if (btnLogin) btnLogin.textContent = isIn ? "Log out" : "Log in";

    // ✅ Create account Button nur wenn NICHT eingeloggt
    if (btnCreate) btnCreate.style.display = isIn ? "none" : "inline-flex";
  }

  window.refreshWelcomeAuthUI = function refreshWelcomeAuthUI() {
    const u = _getAuthUser();
    if (u) {
      setLoggedInUI(true);
      setMsg("Logged in", false);

      // optional: Eingabefelder leeren (damit nix rumliegt)
      try { elUser && (elUser.value = ""); } catch {}
      try { elPass && (elPass.value = ""); } catch {}
    } else {
      setLoggedInUI(false);
      setMsg("", false);
    }
  };

// =========================
// Account Panel (Statusbar)
// =========================
function initAccountPanel(){
  const picker = document.getElementById("acctPicker");
  const btn = document.getElementById("acctBtn");
  const menu = document.getElementById("acctMenu");
  const btnClose = document.getElementById("acctClose");

  const elUser = document.getElementById("acctUsername");
  const elPass = document.getElementById("acctPassword");
  const btnLogin = document.getElementById("acctLoginBtn");
  const btnCreate = document.getElementById("acctCreateBtn");
  const msg = document.getElementById("acctMsg");
  const elHifzScore = document.getElementById("acctHifzScoreValue");

  const btnExport = document.getElementById("acctExportBtn");
  const fileImport = document.getElementById("acctImportFile");

  if (!picker || !btn || !menu) return;

  function setMsg(t, isErr){
    if (!msg) return;
    msg.textContent = t || "";
    msg.classList.toggle("is-error", !!isErr);
    msg.classList.toggle("is-ok", !isErr && !!t);
  }

  function setLoggedInUI(isIn){
    if (btnLogin) btnLogin.textContent = isIn ? "Log out" : "Log in";
    if (btnCreate) btnCreate.style.display = isIn ? "none" : "inline-flex";
  }

  function refreshAccountUI(){
    const u = _getAuthUser();
    setLoggedInUI(!!u);

    try { window.__refreshAccountHifzScore?.(); } catch {}

    if (u) setMsg("Logged in", false);
    else setMsg("", false);
  }

  function open(){
    picker.classList.add("is-open");
    refreshAccountUI();
  }

  function close(){
    picker.classList.remove("is-open");
  }

  function toggle(){
    if (picker.classList.contains("is-open")) close();
    else open();
  }

  // ✅ NUR 1 Bind (verhindert “mehrfach gebunden” Chaos)
  if (picker.__acctBound) return;
  picker.__acctBound = true;

  // ✅ Event-Delegation: öffnet/schließt zuverlässig
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;

    // Klick auf Account-Button: toggle
    if (t && t.closest && t.closest("#acctBtn")) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }

    // Klick auf X: close
    if (t && t.closest && t.closest("#acctClose")) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    // Outside: wenn offen und Klick außerhalb -> close
    if (picker.classList.contains("is-open")) {
      if (!picker.contains(t)) close();
    }
  }, true);

  // ESC schließt
  window.addEventListener("keydown", (e)=>{
    if (!picker.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
  });

  async function doLoginOrCreate(mode){
    const username = (elUser?.value || "").trim();
    const password = (elPass?.value || "");

    if (username.length < 3) return setMsg("Username must be at least 3 characters.", true);
    if (password.length < 6) return setMsg("Password must be at least 6 characters.", true);

    setMsg("Working...", false);

    try{
      if (mode === "create"){
        await _api("/api/register", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
      }

      const res = await _api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      _setAuth(res.token || "", username);

      await syncAccountState();

      refreshAccountUI();

      try { if (elUser) elUser.value = ""; } catch {}
      try { if (elPass) elPass.value = ""; } catch {}

      setMsg(
        mode === "create"
          ? "Success. Your settings are now linked to your account."
          : "Logged in. Loading your saved settings...",
        false
      );
    }catch(e){
      setMsg(String(e?.message || e), true);
    }
  }

  // Log in / Log out
  btnLogin?.addEventListener("click", async ()=>{
    const u = _getAuthUser();
    if (u){
      _clearAuth();
      refreshAccountUI();
      setMsg("Logged out.", false);
      return;
    }
    await doLoginOrCreate("login");
  });

  btnCreate?.addEventListener("click", ()=>doLoginOrCreate("create"));

  // enter-to-login
  ;[elUser, elPass].forEach((inp)=>{
    inp?.addEventListener("keydown", (e)=>{
      if (e.key === "Enter") doLoginOrCreate("login");
    });
  });

  // Export/Import: bleibt wie vorher (wenn du willst, hängen wir’s wieder dran)
  btnExport?.addEventListener("click", ()=>{});
  fileImport?.addEventListener("change", ()=>{});

  refreshAccountUI();
}

async function doLoginOrCreate(mode) {
  const username = (elUser?.value || "").trim();
  const password = (elPass?.value || "");

  if (username.length < 3) return setMsg("Username must be at least 3 characters.", true);
  if (password.length < 6) return setMsg("Password must be at least 6 characters.", true);

  setMsg("Working...", false);

  try {
    if (mode === "create") {
      await _api("/api/register", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
    }

    const res = await _api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    _setAuth(res.token || "", username);
    refreshWelcomeAuthUI();

    // sync localStorage -> account (and pull account -> local)
    await syncAccountState();

    setMsg("Success. Your bookmarks are now linked to your account.", false);
  } catch (e) {
    setMsg(String(e?.message || e), true);
  }
}

  // ✅ Login Button: wenn eingeloggt => Logout, sonst Login
  btnLogin?.addEventListener("click", async () => {
    const u = _getAuthUser();
    if (u) {
      _clearAuth();
      refreshWelcomeAuthUI();
      setMsg("Logged out.", false);
      return;
    }
    await doLoginOrCreate("login");
  });

  btnCreate?.addEventListener("click", () => doLoginOrCreate("create"));

  // (falls der Button im HTML noch existiert: sicherheitshalber deaktiviert)
  btnLogout?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    _clearAuth();
    refreshWelcomeAuthUI();
    setMsg("Logged out.", false);
  });

  // enter-to-login
  [elUser, elPass].forEach((inp) => {
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLoginOrCreate("login");
    });
  });

  // init state
  refreshWelcomeAuthUI();
}

function _navIsReload() {
  try {
    const nav = performance.getEntriesByType("navigation")?.[0];
    return nav?.type === "reload";
  } catch {
    return false;
  }
}

function maybeShowWelcome() {
  const isReload = _navIsReload();

  // ✅ Beim Reload Welcome wieder erlauben, damit du es testen kannst
  if (isReload) {
    try { sessionStorage.removeItem(SS_WELCOME_SHOWN_THIS_TAB); } catch {}
  } else {
    // ✅ Nur bei normaler Navigation im selben Tab nicht doppelt öffnen
    try {
      if (sessionStorage.getItem(SS_WELCOME_SHOWN_THIS_TAB) === "1") return;
    } catch {}
  }

  try { sessionStorage.setItem(SS_WELCOME_SHOWN_THIS_TAB, "1"); } catch {}

  const ov = ensureWelcomeModal();
  ov._welcome?.open?.();
}

// ✅ Minimaler Binder: toggelt nur .is-open (wie dein Debug-Test)
function bindAccountMenuToggle(){
  const picker = document.getElementById("acctPicker");
  const btn = document.getElementById("acctBtn");
  const closeBtn = document.getElementById("acctClose");

  if (!picker || !btn) return;

  // nur 1x binden
  if (picker.__acctToggleBound) return;
  picker.__acctToggleBound = true;

  const close = () => picker.classList.remove("is-open");
  const toggle = () => picker.classList.toggle("is-open");

  // robust: capture-phase
  btn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }, true);

  // X schließt
  closeBtn?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  }, true);

  // outside closes
  document.addEventListener("pointerdown", (e) => {
    if (!picker.classList.contains("is-open")) return;
    if (picker.contains(e.target)) return;
    close();
  }, true);

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// =========================
// Account Menu Actions (Login/Create/Export/Import)
// =========================
function bindAccountMenuActions(){
  const picker = document.getElementById("acctPicker");
  const elUser = document.getElementById("acctUsername");
  const elPass = document.getElementById("acctPassword");
  const btnLogin = document.getElementById("acctLoginBtn");
  const btnCreate = document.getElementById("acctCreateBtn");
  const btnExport = document.getElementById("acctExportBtn");
  const fileImport = document.getElementById("acctImportFile");

  // ✅ Bug report UI
  const btnBug = document.getElementById("acctBugBtn");
  const bugBox = document.getElementById("acctBugBox");
  const bugClose = document.getElementById("acctBugClose");
  const bugText = document.getElementById("acctBugText");
  const bugCancel = document.getElementById("acctBugCancel");
  const bugSend = document.getElementById("acctBugSend");

  const msg = document.getElementById("acctMsg");
  const elHifzScore = document.getElementById("acctHifzScoreValue");
  const syncTools = document.getElementById("acctSyncTools");
  const syncHint = document.getElementById("acctSyncHint");
  const btnLoadAccount = document.getElementById("acctLoadAccountBtn");
  const btnSaveDevice = document.getElementById("acctSaveDeviceBtn");

  if (!picker || !btnLogin || !btnCreate || !btnExport || !fileImport || !msg) return;
  if (picker.__acctActionsBound) return;
  picker.__acctActionsBound = true;

  const LS_ACC_USER = "q_auth_user_v1";

  function setMsg(t, isErr){
    msg.textContent = t || "";
    msg.classList.toggle("is-error", !!isErr);
    msg.classList.toggle("is-ok", !isErr && !!t);
  }

  function isLoggedIn(){
    try { return !!__isLoggedIn?.(); } catch { return false; }
  }

  function refreshButtons(){
    const inOk = isLoggedIn();
    const hifzMax = (typeof HIFZ_SCORE_MAX !== "undefined") ? HIFZ_SCORE_MAX : 1000000000;

    btnLogin.textContent = inOk ? "Log out" : "Log in";
    btnCreate.style.display = inOk ? "none" : "inline-flex";

    if (syncTools) syncTools.style.display = inOk ? "flex" : "none";
    if (syncHint) syncHint.style.display = inOk ? "block" : "none";

    if (elHifzScore) {
      if (!inOk) {
        elHifzScore.textContent = `0/${hifzMax}`;
      } else {
        let scoreNow = 0;
        try { scoreNow = Math.max(0, Math.round(Number(getHifzScoreValue?.() || 0))); } catch {}
        elHifzScore.textContent = `${scoreNow}/${hifzMax}`;
      }
    }

    try { window.__refreshAccountSyncUi?.(); } catch {}

    if (inOk) setMsg("Logged in", false);
    else setMsg("", false);
  }

  async function api(path, { method="GET", body=null, auth=false } = {}){
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      try {
        const h = __authHeaders?.() || {};
        if (h.Authorization) headers.Authorization = h.Authorization;
      } catch {}
    }

    let res;
    try {
      res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      const msg = String(err?.message || err || "");
      const isLikelyCors =
        /Failed to fetch|NetworkError|Load failed/i.test(msg);

      if (isLikelyCors) {
        throw new Error(
          "Login blocked by CORS. The account API currently does not allow this website origin (https://quranf.com). The Cloudflare Worker must allow https://quranf.com in Access-Control-Allow-Origin."
        );
      }

      throw err;
    }

    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    return j;
  }

  async function doLoginOrCreate(mode){
    const username = (elUser?.value || "").trim();
    const password = (elPass?.value || "");

    if (username.length < 3) return setMsg("Username must be at least 3 characters.", true);
    if (password.length < 6) return setMsg("Password must be at least 6 characters.", true);

    setMsg("Working...", false);

    try{
      if (mode === "create"){
        await api("/api/register", { method:"POST", body:{ username, password }, auth:false });
      }

      const login = await api("/api/login", { method:"POST", body:{ username, password }, auth:false });

      // Token + 114d timestamp (deine bestehenden Helfer)
      try { __setAuthToken?.(login.token || ""); } catch {}
      try { localStorage.setItem(LS_ACC_USER, username); } catch {}

      let syncResult = { ok:false, mismatch:false };

      try {
        syncResult = await syncAccountState();
      } catch {}

      // UI refresh hooks
      try { window.__refreshFavCount?.(); } catch {}
      try { window.__refreshFavButtonDecor?.(); } catch {}
      try { window.__refreshNoteIndicators?.(); } catch {}
      try {
        const sid = localStorage.getItem("quranm_style_theme_v1") || "";
        if (sid) window.quranStyleSet?.(sid);
      } catch {}

      // Felder leeren
      try { elUser.value = ""; } catch {}
      try { elPass.value = ""; } catch {}

      refreshButtons();

      if (syncResult?.mismatch) {
        setMsg('Logged in. Use "Load account" or "Save device".', true);
      } else {
        try { window.__markAccountSynced?.("login"); } catch {}
        setMsg(
          mode === "create"
            ? "Account created. Login finished."
            : "Logged in.",
          false
        );
      }
    }catch(e){
      setMsg(String(e?.message || e), true);
    }
  }

  // Log in / Log out
btnLogin.addEventListener("click", async () => {
  if (isLoggedIn()){
    // ✅ erst alles rausschieben (damit nichts verloren geht)
    try { await window.__accountFlushAll?.(); } catch {}

    try { localStorage.removeItem("q_auth_token_v1"); } catch {}
    try { localStorage.removeItem("q_auth_set_at_v1"); } catch {}
    try { localStorage.removeItem(LS_ACC_USER); } catch {}

    refreshButtons();
    setMsg("Logged out.", false);
    return;
  }

  await doLoginOrCreate("login");
});

  btnCreate.addEventListener("click", () => doLoginOrCreate("create"));

  btnLoadAccount?.addEventListener("click", async () => {
    if (!isLoggedIn()) {
      setMsg("Please log in first.", true);
      return;
    }

    setMsg("Loading account storage to browser storage...", false);

    try {
      try { window.__setAccountSyncUiState?.("syncing", { mode:"account" }); } catch {}

      const pull = await __accountPull?.();
      if (!pull?.ok) throw new Error("Could not load account storage.");

      __setAccountSyncConflict(false);

      try { window.__markAccountSynced?.("account"); } catch {}
      refreshButtons();

      if (pull.empty) {
        setMsg("Account storage is empty. Nothing was loaded.", false);
      } else {
        setMsg(`Loaded account storage to browser storage (${pull.keyCount} keys). Reloading...`, false);
        setTimeout(() => {
          window.location.reload();
        }, 80);
      }
    } catch (e) {
      try { window.__setAccountSyncUiState?.("error", { mode:"account" }); } catch {}
      setMsg(String(e?.message || e), true);
    }
  });

  btnSaveDevice?.addEventListener("click", async () => {
    if (!isLoggedIn()) {
      setMsg("Please log in first.", true);
      return;
    }

    setMsg("Saving browser storage to account storage...", false);

    try {
      __setAccountSyncConflict(false);
      try { window.__setAccountSyncUiState?.("syncing", { mode:"live" }); } catch {}

      const ok = await __accountPush?.();
      if (!ok) throw new Error("Could not save browser storage to account storage.");

      try { window.__markAccountSynced?.("live"); } catch {}
      refreshButtons();
      setMsg("Saved browser storage to account storage.", false);
    } catch (e) {
      __setAccountSyncConflict(true);
      try { window.__setAccountSyncUiState?.("error", { mode:"live" }); } catch {}
      setMsg(String(e?.message || e), true);
    }
  });

  // Export settings JSON (inkl. Favorites Pages + Gruppen)
  btnExport.addEventListener("click", () => {
    try{
      const state = (typeof __collectLocalAccountState === "function")
        ? __collectLocalAccountState()
        : {
            bookmarks: JSON.parse(localStorage.getItem("q_bookmarks_v1") || "[]"),
            notes: JSON.parse(localStorage.getItem("q_notes_v1") || "{}"),

            // ✅ Style (Button 1)
            styleId: localStorage.getItem("quranm_style_theme_v1") || "",

            // ✅ Surface (Button 2)
            surfaceId: (typeof loadSurfaceThemeId === "function") ? (loadSurfaceThemeId() || "") : "",

            favPresets: JSON.parse(localStorage.getItem("q_fav_presets_v1") || "{}"),
            favActivePreset: localStorage.getItem("q_fav_active_preset_v1") || "actual",
            favGroupTitles: JSON.parse(localStorage.getItem("q_fav_group_titles_v1") || "[]"),
            favGroupMap: JSON.parse(localStorage.getItem("q_fav_group_map_v1") || "{}"),
            favGroupCollapsed: JSON.parse(localStorage.getItem("q_fav_group_collapsed_v1") || "{}"),
            habashiLabels: JSON.parse(localStorage.getItem("q_habashi_labels_v1") || "{}"),
          };

      const payload = { v: 1, exportedAt: new Date().toISOString(), state };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quranm_settings_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMsg("Exported settings JSON.", false);
    }catch(e){
      setMsg("Export failed: " + String(e?.message || e), true);
    }
  });

  // Import settings JSON (inkl. Favorites Pages + Gruppen)
  fileImport.addEventListener("change", async () => {
    const f = fileImport.files?.[0];
    if (!f) return;

    try{
      const text = await f.text();
      const j = JSON.parse(text);
      const st = j?.state || {};

      // base
      if (Array.isArray(st.bookmarks)) localStorage.setItem("q_bookmarks_v1", JSON.stringify(st.bookmarks));
      if (st.notes && typeof st.notes === "object") localStorage.setItem("q_notes_v1", JSON.stringify(st.notes));

      // ✅ Style (Button 1)
      if (typeof st.styleId === "string") localStorage.setItem("quranm_style_theme_v1", st.styleId);

      // ✅ Surface (Button 2)
      if (typeof st.surfaceId === "string" && st.surfaceId.trim()) {
        try { saveSurfaceThemeId(st.surfaceId); } catch {}
      }

      // favorites pages + grouping
      if (st.favPresets && typeof st.favPresets === "object") localStorage.setItem("q_fav_presets_v1", JSON.stringify(st.favPresets));
      if (typeof st.favActivePreset === "string") localStorage.setItem("q_fav_active_preset_v1", st.favActivePreset);
      if (Array.isArray(st.favGroupTitles)) localStorage.setItem("q_fav_group_titles_v1", JSON.stringify(st.favGroupTitles));
      if (st.favGroupMap && typeof st.favGroupMap === "object") localStorage.setItem("q_fav_group_map_v1", JSON.stringify(st.favGroupMap));
      if (st.favGroupCollapsed && typeof st.favGroupCollapsed === "object") localStorage.setItem("q_fav_group_collapsed_v1", JSON.stringify(st.favGroupCollapsed));
      if (st.habashiLabels && typeof st.habashiLabels === "object") localStorage.setItem("q_habashi_labels_v1", JSON.stringify(st.habashiLabels));

      // apply + refresh
      try { window.__refreshFavCount?.(); } catch {}
      try { window.__refreshFavButtonDecor?.(); } catch {}
      try { window.__refreshNoteIndicators?.(); } catch {}

      // ✅ Style anwenden
      try { if (st.styleId) window.quranStyleSet?.(st.styleId); } catch {}

      // ✅ Surface anwenden (Preview=true, damit kein Save/Sync-Loop)
      try {
        if (typeof st.surfaceId === "string" && st.surfaceId.trim()) {
          applySurfaceThemeById(st.surfaceId, { preview:true });
        }
      } catch {}

      // aktive Favoritenseite direkt setzen (falls Funktion existiert)
      try {
        if (typeof setActivePresetName === "function" && typeof st.favActivePreset === "string") {
          setActivePresetName(st.favActivePreset || "actual");
        }
      } catch {}

      // wenn eingeloggt: in Cloud speichern
      try { if (typeof __isLoggedIn === "function" ? __isLoggedIn() : false) await __accountPush?.(); } catch {}

      setMsg("Imported settings.", false);
    }catch(e){
      setMsg("Import failed: " + String(e?.message || e), true);
    }finally{
      try { fileImport.value = ""; } catch {}
    }
  });

  // =========================
  // Bug report (mailto)
  // =========================
  function openBugBox(){
    if (!bugBox) return;
    bugBox.classList.add("is-open");
    try { bugText?.focus({ preventScroll:true }); } catch {}
  }

  function closeBugBox(){
    if (!bugBox) return;
    bugBox.classList.remove("is-open");
    try { if (bugText) bugText.value = ""; } catch {}
  }

  btnBug?.addEventListener("click", () => {
    openBugBox();
  });

  bugClose?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    closeBugBox();
  });

  bugCancel?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    closeBugBox();
  });

  bugSend?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();

    const desc = String(bugText?.value || "").trim();
    if (desc.length < 10){
      setMsg("Please describe the bug (at least 10 characters).", true);
      return;
    }

    const lastRef = localStorage.getItem("q_lastRef") || "";
    const theme = localStorage.getItem("quranm_theme_v1") || "";
    const style = localStorage.getItem("quranm_style_theme_v1") || "";
    const viewMode = localStorage.getItem("q_viewMode") || "";

    const subject = `Quranm Bug Report`;
    const body =
`Bug description:
${desc}

---
Debug:
URL: ${location.href}
LastRef: ${lastRef}
ViewMode: ${viewMode}
Theme: ${theme}
Style: ${style}
UA: ${navigator.userAgent}
`;

    const mailto =
      `mailto:u87bc15v3@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try{
      // ✅ mailto in neuem Tab öffnen (weniger “Seite verlässt App”)
      window.open(mailto, "_blank", "noopener,noreferrer");

      // ✅ hilfreiche Anleitung
      setMsg("A new tab opened. Please send the email there. If you don’t see a compose screen, copy the text and email it to u87bc15v3@gmail.com.", false);

      // ✅ Fallback: Text in Clipboard kopieren
      try { navigator.clipboard?.writeText(body); } catch {}
      closeBugBox();
    }catch(err){
      // fallback: wenigstens kopieren
      try { navigator.clipboard?.writeText(body); } catch {}
      setMsg("Could not open email. I copied the bug report text — please paste it into an email to u87bc15v3@gmail.com.", true);
    }
  });

  refreshButtons();
}


/* ============================================================================
   Style Picker (left) — DISABLED (handled inside styles.js / initStylePicker)
============================================================================ */
function bindStylePickerClickOnly(){
  // ❌ früher: doppelte Handler (app.js + styles.js) -> open & instant close
  // ✅ jetzt: NOP, damit nur styles.js zuständig ist
  return;
}

/* ============================================================================
   MAIN
============================================================================ */

(async () => {
  await domReady();
  bindAccountMenuToggle();
  bindAccountMenuActions();
  initDemoUI();
  initStylePicker();          // ✅ Accent/Style Designs initialisieren
  initSurfacePicker();        // ✅ Surface (bg/stage/chips/line + fav bg) Designs initialisieren
  // bindStylePickerClickOnly(); // ❌ disabled (handled by styles.js)

  // ✅ WICHTIG:
  // initAccountPanel() hier NICHT mehr zusätzlich starten.
  // Der Account ist bereits final über bindAccountMenuToggle() + bindAccountMenuActions() verdrahtet.
  // Sonst hängen Login/Logout/Sync doppelt auf denselben Buttons.

  installHifzRecallHotkeys();
  installSpacebarAudioHotkey();
  installBookmarkHotkey();
  try { await seedHabashiPresetsIfNeeded(); } catch(e){ console.warn("[habashi] seed failed:", e); }

  // ✅ Daten: App darf auch ohne weiter laufen (Welcome etc.)
  try {
    await dataPromise;
  } catch (e) {
    console.warn("[data] continuing without data (welcome can still open):", e);
  }

  // ✅ Translations dürfen App nicht killen
  try {
    await initTranslations();
  } catch (e) {
    console.warn("[tr] initTranslations failed (ignored):", e);
  }

  if (DBG.enabled) {
    dgroup("data", "Quran data loaded");
    const m2 = getSuraMeta(2);
    const a2255 = getAyah("2:255");
    dlog("data", "Sura 2 meta:", m2);
    dlog("data", "Ayah 2:255:", a2255);
    dlog("data", "Words 2:255 length:", a2255?.words?.length);
    dlog("data", "First word 2:255:", a2255?.words?.[0]);
    dgroupEnd("data");
  }

  if (DBG.enabled) {
    window.__quranDebug = {
      DBG,
      recalc,
      dumpLayoutVars,
      getAyah,
      getSuraMeta,
      renderAyahWords,
      goToRef,
      initRouter,
    };
    dlog("debug", "window.__quranDebug ready");
  }

  // ✅ Router startet Rendering aus URL oder Default
  initRouter("2:255");

  // ✅ First visit welcome (normaler Flow)
  try { maybeShowWelcome(); } catch {}

  // ======================================================
  // TEMP (zum Testen): Welcome bei JEDEM Reload erzwingen
  // -> Wenn du fertig bist: diesen TEMP-Block einfach löschen
  // ======================================================
  try {
    sessionStorage.removeItem(SS_WELCOME_SHOWN_THIS_TAB);

    setTimeout(() => {
      try {
        const ov = ensureWelcomeModal();
        ov._welcome?.open?.();
      } catch {}
    }, 0);
  } catch {}
})();