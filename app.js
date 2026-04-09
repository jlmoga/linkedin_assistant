/* ===================================================
   Rumb – App Logic
   =================================================== */

'use strict';

// ── Configuration & State ───────────────────────────
const DB_NAME = 'LinkedInAssistantDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const AI_TIMEOUT_MS = 45000; // 45 segons de temps d'espera per cada intent

let db;
let analysisAbortController = null;
let activeModel = 'gemini-pro-latest'; // Model estable mestre (Aliased per Google per evitar 503 per versió)

/**
 * Actualitza l'estat de la IA a la interfície de forma unificada.
 */
function updateAiStatus(message, showProgress = true) {
  if (headerStatusDot && headerStatusText) {
    headerStatusDot.className = 'badge-dot blue';
    headerStatusText.textContent = message;
  }
  if (showProgress && progressStatus) {
    progressStatus.textContent = message;
  }
  console.log(`[AI Status] ${message}`);
}

/**
 * Descobreix el millor model disponible per a la clau d'IA facilitada.
 * Opcionalment permet excloure un model concret (per exemple, si està fallant).
 */
async function discoverBestAvailableModel(apiKey, excludeModel = null) {
  try {
    updateAiStatus("Buscant alternatives de models IA...", true);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const availableModels = data.models || [];
    
    // Filtrem models que suporten generació de contingut i opcionalment excloem el que falla
    let candidates = availableModels
      .filter(m => m.supportedMethods && m.supportedMethods.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    
    if (excludeModel) {
        candidates = candidates.filter(c => c !== excludeModel);
    }
    
    if (candidates.length === 0) return null;

    // Prioritat jeràrquica dinàmica: Versió més alta primer, preferint Pro > Flash
    const sorted = candidates.sort((a, b) => {
      const getVersion = (name) => {
          const match = name.match(/(\d+\.\d+|\d+)/);
          return match ? parseFloat(match[0]) : 0;
      };
      
      const vA = getVersion(a);
      const vB = getVersion(b);
      
      if (vA !== vB) return vB - vA; // Versió més alta primer (p.ex. 3.1 > 2.5)
      
      const getModelTypePriority = (name) => {
        const n = name.toLowerCase();
        if (n.includes('pro')) return 0;
        if (n.includes('flash')) return 1;
        return 2;
      };
      
      const pA = getModelTypePriority(a);
      const pB = getModelTypePriority(b);
      
      if (pA !== pB) return pA - pB;
      return b.localeCompare(a); // Versió més recent primer dins del mateix rang
    });
    
    const best = sorted[0];
    console.log("Model seleccionat com a alternativa robusta:", best);
    return best;
  } catch (err) {
    console.error("Error descobrint models alternatives:", err);
    return null;
  }
}

/**
 * Helper per fer crides a Gemini amb suport de reintents (Exponential Backoff).
 * Útil per gestionar errors 503 (High Demand) i 429 (Rate Limit).
 */
async function fetchGeminiWithRetry(url, options, maxRetries = 3, initialDelay = 1000, onRetry = null, signal = null, currentModelName = 'gemini-2.5-flash') {
  let lastError;
  let currentUrl = url;
  let localActiveModel = currentModelName;
  let fallbackAttempted = false;

  for (let i = 0; i < maxRetries; i++) {
    if (signal && signal.aborted) throw new Error('AbortError');

    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), AI_TIMEOUT_MS);
      
      // Combinem el senyal del timeout amb el senyal de l'usuari (si existeix)
      // AbortSignal.any() està suportat en navegadors moderns (Chrome 116+)
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
      
      const fetchOptions = { ...options, signal: combinedSignal };
      const response = await fetch(currentUrl, fetchOptions);
      
      clearTimeout(timeoutId);
      
      if (response.ok) return response;

      const responseStatus = response.status;

      // --- ESTRATÈGIA DE FALLBACK PER CANVI DE MODEL ---
      let triggerFallback = false;
      
      if (responseStatus === 404) {
        // Model no trobat: fem fallback immediat
        triggerFallback = true;
      } else if (!fallbackAttempted) {
        if (responseStatus === 500 && i >= 0) {
          // Error intern del servidor: provem un cop i si persisteix canviem
          triggerFallback = true;
        } else if ((responseStatus === 503 || responseStatus === 429) && i === maxRetries - 1) {
          // Saturació/Límit: esgotem reintents del model preferit i llavors busquem alternativa
          triggerFallback = true;
        }
      }

      if (triggerFallback) {
        updateAiStatus(`Intentant canviar de model per resoldre error ${responseStatus}...`, true);
        const apiKey = new URL(currentUrl).searchParams.get('key');
        const fallbackModel = await discoverBestAvailableModel(apiKey, localActiveModel);
        
        if (fallbackModel && fallbackModel !== localActiveModel) {
          const oldModel = localActiveModel;
          console.warn(`Fallback Actiu: Canviant de ${oldModel} a ${fallbackModel} per error ${responseStatus}`);
          updateAiStatus(`Canviant de ${oldModel} a ${fallbackModel} per saturació...`, true);
          
          // Actualitzem l'estat global i local per a la nova URL
          activeModel = fallbackModel;
          localActiveModel = fallbackModel;
          fallbackAttempted = true;
          
          // Reconstruïm la URL amb el nou model
          const urlObj = new URL(currentUrl);
          urlObj.pathname = urlObj.pathname.replace(currentModelName || activeModel, fallbackModel);
          currentUrl = urlObj.toString();
          
          // Reiniciem reintents per al nou model
          i = -1; 
          continue;
        } else if (responseStatus === 404) {
          throw new Error("El model seleccionat no existeix i no s'han trobat alternatives.");
        }
      }

      // --- ESTRATÈGIA DE REINTENTS AMB EL MATEIX MODEL ---
      if (responseStatus === 503 || responseStatus === 429 || responseStatus === 500) {
        lastError = new Error(`IA ocupada/Error (${responseStatus}). S\'han esgotat els reintents.`);
        const delay = initialDelay * Math.pow(2, Math.max(0, i));
        
        if (onRetry) onRetry(i + 1, maxRetries);
        updateAiStatus(`IA ocupada (${responseStatus}). Reintentant en ${Math.round(delay/1000)}s...`, true);
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, delay);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('AbortError'));
            }, { once: true });
          }
        });
        continue;
      }

      // Altres errors (400, 401, 403) no són reintentables ni canvien de model
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody.error?.message || `Error ${responseStatus}`;
      lastError = new Error(message);
      throw lastError;

    } catch (err) {
      // Gestió d'errors de Timeout / Abort
      if (err.name === 'AbortError' || err.message === 'AbortError') {
        if (signal && signal.aborted) throw err; // L'usuari ha cancel·lat realment
        
        // Si arribem aquí, és que ha estat un timeout
        lastError = new Error(`Temps d'espera esgotat (${AI_TIMEOUT_MS/1000}s).`);
        updateAiStatus(`Temps d'espera esgotat. Reintentant...`, true);
        
        const delay = initialDelay * Math.pow(2, Math.max(0, i));
        await new Promise(res => setTimeout(res, delay));
        continue;
      }

      lastError = err;
      
      // Errors de xarxa (TypeError en fetch)
      if (err instanceof TypeError || err.message.includes('fetch')) {
        const delay = initialDelay * Math.pow(2, Math.max(0, i));
        updateAiStatus(`Error de xarxa. Reintentant en ${Math.round(delay/1000)}s...`, true);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("S'ha produït un error desconegut de connexió a la IA.");
}

/**
 * Funció mestra per a totes les crides a la IA de l'aplicació.
 * Centralitza la construcció de l'URL, la clau d'API, els reintents i el parseig.
 */
async function callGemini(prompt, onRetry = null, signal = null, isJson = false) {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const apiKey = profile.geminiKey || '';
  
  if (!apiKey) {
    throw new Error("Falta la clau d'IA (API Key).");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;

  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(isJson && { generationConfig: { responseMimeType: "application/json" } })
    })
  };

  const response = await fetchGeminiWithRetry(endpoint, fetchOptions, 3, 1000, onRetry, signal, activeModel);
  const data = await response.json();
  
  let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  if (isJson) {
    // Netejar possible markdown que posem a vegades (```json ...)
    resultText = resultText.replace(/```json/gi, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(resultText);
    } catch (e) {
      console.error("Error parsejant JSON de la IA:", resultText);
      throw new Error("La IA no ha retornat un format JSON vàlid.");
    }
  }

  return resultText;
}

// ── DOM Elements ────────────────────────────────────
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Profile Elements
const inputLinkedinUrl = document.getElementById('input-linkedin-url');
const inputDispoDies = document.getElementById('input-dispo-dies');
const inputAddress = document.getElementById('input-address');
const inputRadius = document.getElementById('input-radius');
const modalityChips = document.querySelectorAll('#modalitat-selector .chip');
const inputSbaMin = document.getElementById('input-sba-min');
const inputSbaDesitjat = document.getElementById('input-sba-desitjat');
const inputMaxDays = document.getElementById('input-max-days');
const inputCommuteTime = document.getElementById('input-commute-time');
const btnStopAnalysis = document.getElementById('btn-stop-analysis');

const dropZoneCv = document.getElementById('drop-zone-cv');
const inputCvPdf = document.getElementById('input-cv-pdf');
const cvStatus = document.getElementById('cv-status');
const cvFilename = document.getElementById('cv-filename');
const btnDownloadCv = document.getElementById('btn-download-cv');
const btnRemoveCv = document.getElementById('btn-remove-cv');

const inputNoGo = document.getElementById('input-no-go');
const inputCore = document.getElementById('input-core');
const tagListNoGo = document.getElementById('tag-list-no-go');
const tagListCore = document.getElementById('tag-list-core');

// Offer Elements
const inputOfertaUrl = document.getElementById('input-oferta-url');
const btnExaminar = document.getElementById('btn-examinar');
const ofertaError = document.getElementById('oferta-error');
const cvMissingMsg = document.getElementById('cv-missing-msg');
const ofertaResults = document.getElementById('oferta-analysis-results');
const ofertaUrlInputArea = document.getElementById('oferta-url-input-area');

// New Status & Comparison UI
const ofertaStatusContainer = document.getElementById('oferta-status-container');
const statusLoader = document.getElementById('status-loader');
const statusMessageMain = document.getElementById('status-message-main');
const statusMessageSub = document.getElementById('status-message-sub');
const contentOferta = document.getElementById('content-oferta');
const contentCv = document.getElementById('content-cv');
const contentAnalisi = document.getElementById('content-analisi');

const btnAnalitzarCv = document.getElementById('btn-analitzar-cv');
const btnCopyJson = document.getElementById('btn-copy-json');
const textareaCvJson = document.getElementById('textarea-cv-json');
const inputGeminiKey = document.getElementById('input-gemini-key');
const inputRolActual = document.getElementById('input-rol-actual');
const textareaResumProf = document.getElementById('textarea-resum-prof');
const readonlySkillsList = document.getElementById('readonly-skills-list');
const btnNovaAnalisi = document.getElementById('btn-nova-analisi');
const analysisControls = document.querySelector('.analysis-controls');

const cvNextStepsContainer = document.getElementById('cv-next-steps-container');
const btnGotoOfertes = document.getElementById('btn-goto-ofertes');
const btnGotoVentall = document.getElementById('btn-goto-ventall');

const progressContainer = document.getElementById('analysis-progress-container');
const progressStatus = document.getElementById('analysis-status-text');
const progressPercent = document.getElementById('analysis-percentage');
const progressFiller = document.getElementById('analysis-progress-filler');

const btnGuardarPerfil = document.getElementById('btn-guardar-perfil');
const saveStatusMsg = document.getElementById('save-status-msg');

// Header Status elements
const headerStatusBadge = document.getElementById('header-status-badge');
const headerStatusDot = document.getElementById('header-status-dot');
const headerStatusText = document.getElementById('header-status-text');

const btnClearNoGo = document.getElementById('btn-clear-no-go');
const btnClearCore = document.getElementById('btn-clear-core');
const btnNavCarta = document.getElementById('btn-nav-carta');

// Letter elements
const cartaEmpty = document.getElementById('carta-presentacio-empty');
const cartaActive = document.getElementById('carta-presentacio-active');
const contentCarta = document.getElementById('content-carta');
const btnGenerarCarta = document.getElementById('btn-generar-carta');
const btnCopiarCarta = document.getElementById('btn-copiar-carta');
const btnImprimirCarta = document.getElementById('btn-imprimir-carta');

// Letter configuration selectors
const btnCheckContacte = document.getElementById('btn-check-contacte');
const btnCheckEmpresa = document.getElementById('btn-check-empresa');
const btnCheckResaltar = document.getElementById('btn-check-resaltar');
const selectToCarta = document.getElementById('select-to-carta');
const selectEnfocament = document.getElementById('select-enfocament-carta');
const selectLongitud = document.getElementById('select-longitud-carta');
const selectIdioma = document.getElementById('select-idioma-carta');
const textareaNotesCarta = document.getElementById('textarea-notes-carta');

// Ventall Professional Elements
const ventallEmpty = document.getElementById('ventall-empty');
const ventallActive = document.getElementById('ventall-active');
const btnGenerarOcupacions = document.getElementById('btn-generar-ocupacions');
const ocupacionsLoader = document.getElementById('ocupacions-loader');
const ventallResults = document.getElementById('ventall-results');
const llistaOcupacions = document.getElementById('llista-ocupacions');
const diccionariOcupacionsText = document.getElementById('diccionari-ocupacions-text');
const diccionariSkillsText = document.getElementById('diccionari-skills-text');
const btnStopOcupacions = document.getElementById('btn-stop-ocupacions');

// Ventall Progress Bar Elements
const ventallProgressFiller = document.getElementById('ventall-progress-filler');
const ventallPercentage = document.getElementById('ventall-percentage');
const ventallStatusText = document.getElementById('ventall-status-text');

// ── State Management ────────────────────────────────
let originalProfileData = {};
let stagedCvFile = null;
let isAnalysingCv = false; // To track if we're in the middle of IA analysis
let currentJobAnalysis = null; // Store latest analysis for cover letter generation

// Memòria cau per a crides ESCO (per sessió)
const escoCache = {
  search: new Map(),
  resource: new Map()
};

// ── Initialization ──────────────────────────────────
init();

async function init() {
  await initDB();
  loadProfileData();
  setupEventListeners();
  restoreActiveTab();
  checkProfileStatus(); // Check if CV is ready
  updateCoverLetterUI(); // Inicialitzar vista de carta

  // Initial change check
  checkFormChanges();
}

// ── Database (IndexedDB) ────────────────────────────
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve();
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveFileToDB(key, file) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getFileFromDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeFileFromDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ── Tab Navigation ──────────────────────────────────
function activateTab(tabId) {
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  tabPanels.forEach(panel => {
    const isActive = panel.id === `panel-${tabId}`;
    if (isActive) {
      panel.removeAttribute('hidden');
      panel.classList.add('active');
    } else {
      panel.setAttribute('hidden', '');
      panel.classList.remove('active');
    }
  });

  sessionStorage.setItem('activeTab', tabId);

  // Auto-resize resum professional textarea if tab is CV
  if (tabId === 'el-meu-cv' && typeof textareaResumProf !== 'undefined' && textareaResumProf) {
    setTimeout(() => {
      textareaResumProf.style.height = 'auto';
      textareaResumProf.style.height = textareaResumProf.scrollHeight + 'px';
    }, 10);
  }
}

function restoreActiveTab() {
  const savedTab = sessionStorage.getItem('activeTab');
  if (savedTab && document.querySelector(`[data-tab="${savedTab}"]`)) {
    activateTab(savedTab);
  } else {
    activateTab('examina-oferta');
  }
}

function updateCoverLetterUI() {
  if (!cartaEmpty || !cartaActive) return;
  
  if (currentJobAnalysis) {
    cartaEmpty.hidden = true;
    cartaActive.hidden = false;
  } else {
    cartaEmpty.hidden = false;
    cartaActive.hidden = true;
  }
}

// ── Profile Data Handling ───────────────────────────
function loadProfileData() {
  const data = JSON.parse(localStorage.getItem('userProfile') || '{}');

  // Ensure we have current values even if loading empty
  if (data.linkedinUrl) inputLinkedinUrl.value = data.linkedinUrl;
  if (data.dispoDies) inputDispoDies.value = data.dispoDies;
  if (data.address) inputAddress.value = data.address;
  if (data.radius) inputRadius.value = data.radius;
  if (data.sbaMin) inputSbaMin.value = data.sbaMin;
  if (data.sbaDesitjat) inputSbaDesitjat.value = data.sbaDesitjat;
  if (data.maxDays) inputMaxDays.value = data.maxDays;
  if (data.commuteTime) inputCommuteTime.value = data.commuteTime;
  if (data.cvJson) textareaCvJson.value = data.cvJson;
  if (data.geminiKey) inputGeminiKey.value = data.geminiKey;

  modalityChips.forEach(chip => {
    chip.classList.remove('active');
    if (data.modalities && data.modalities.includes(chip.dataset.value)) {
      chip.classList.add('active');
    }
  });

  if (data.noGoTags) renderTags(tagListNoGo, data.noGoTags, 'noGoTags');
  if (data.coreTags) renderTags(tagListCore, data.coreTags, 'coreTags');

  // Deep copy for change detection
  originalProfileData = collectFormData();

  // Sincronització inicial dels camps de lectura (Rol, Resum, Skills)
  syncJsonToReadonlyFields();

  // Load CV status from DB
  getFileFromDB('cv_pdf').then(file => {
    if (file) {
      updateCvUI(file.name);
    }
  });

  syncJsonToReadonlyFields();
  checkProfileStatus();
}

function saveProfileField(field, value) {
  // Now this only updates temporary UI/state until "Save" is clicked
  // We'll rely on checkFormChanges to enable the button
  checkFormChanges();
}

function checkFormChanges() {
  const currentData = collectFormData();

  const hasProfileChanges = JSON.stringify(currentData) !== JSON.stringify(originalProfileData);
  const hasFileChanges = stagedCvFile !== null;

  const hasChanges = hasProfileChanges || hasFileChanges;

  if (btnGuardarPerfil) {
    btnGuardarPerfil.disabled = !hasChanges;
  }
}

function collectFormData() {
  const modalities = Array.from(document.querySelectorAll('#modalitat-selector .chip.active'))
    .map(c => c.dataset.value);

  return {
    linkedinUrl: inputLinkedinUrl.value.trim(),
    dispoDies: inputDispoDies.value,
    address: inputAddress.value.trim(),
    radius: inputRadius.value,
    sbaMin: inputSbaMin.value,
    sbaDesitjat: inputSbaDesitjat.value,
    maxDays: inputMaxDays.value,
    commuteTime: inputCommuteTime.value,
    cvJson: textareaCvJson.value,
    geminiKey: inputGeminiKey.value.trim(),
    modalities: modalities.sort(), // Sort to ensure predictable comparison
    noGoTags: Array.from(tagListNoGo.querySelectorAll('.tag span:first-child')).map(s => s.textContent.replace('#', '')).sort(),
    coreTags: Array.from(tagListCore.querySelectorAll('.tag span:first-child')).map(s => s.textContent.replace('#', '')).sort()
  };
}

function syncUiToJson(currentData) {
  if (!currentData.cvJson || !currentData.cvJson.trim()) return;
  try {
    let parsed = JSON.parse(currentData.cvJson);
    let conf = parsed.configuracio_usuari || parsed;
    if (!conf) return;

    if (!conf.preferencies_i_filtres_infranquejables) conf.preferencies_i_filtres_infranquejables = {};
    let prefs = conf.preferencies_i_filtres_infranquejables;

    prefs.salari_minim_anual = currentData.sbaMin ? parseInt(currentData.sbaMin, 10) : "";
    prefs.salari_desitjat = currentData.sbaDesitjat ? parseInt(currentData.sbaDesitjat, 10) : "";

    if (!prefs.limits_desplaçament) prefs.limits_desplaçament = {};
    prefs.limits_desplaçament.distancia_maxima_km = currentData.radius ? parseInt(currentData.radius, 10) : "";
    prefs.limits_desplaçament.temps_maxim_minuts = currentData.commuteTime ? timeToMinutes(currentData.commuteTime) : 0;

    if (!prefs.modalitat_treball) prefs.modalitat_treball = {};
    prefs.modalitat_treball.dies_presencials_maxims_setmana = currentData.maxDays ? parseInt(currentData.maxDays, 10) : 0;
    prefs.modalitat_treball.preferida = currentData.modalities ? currentData.modalities.join(', ') : "";
    prefs.modalitat_treball.accepta_100_remot = currentData.modalities ? currentData.modalities.includes('Remot') : false;
    prefs.modalitat_treball.accepta_100_presencial = currentData.modalities ? currentData.modalities.includes('Presencial') : false;

    if (!conf.perfil_tecnic) conf.perfil_tecnic = {};
    
    // Sincronització directa: el que l'usuari veu a la UI és el que es desa al JSON
    conf.perfil_tecnic.stack_core = currentData.coreTags || [];
    conf.perfil_tecnic.tecnologies_vetades = currentData.noGoTags || [];
    
    // Actualitzem també la UI per seguretat (encara que ja ho estigui)
    renderTags(tagListCore, conf.perfil_tecnic.stack_core, 'coreTags');
    renderTags(tagListNoGo, conf.perfil_tecnic.tecnologies_vetades, 'noGoTags');

    if (!conf.identitat_i_logistica) conf.identitat_i_logistica = {};
    if (!conf.identitat_i_logistica.adreça_base) conf.identitat_i_logistica.adreça_base = {};
    if (currentData.address) conf.identitat_i_logistica.adreça_base.poblacio = currentData.address;
    if (currentData.dispoDies) conf.identitat_i_logistica.disponibilitat_incorporacio_dies = parseInt(currentData.dispoDies, 10);

    const newJson = JSON.stringify(parsed, null, 2);
    currentData.cvJson = newJson;
    textareaCvJson.value = newJson;
  } catch (e) {
    console.warn("No s'ha pogut sincronitzar la UI amb el JSON:", e);
  }
}

/**
 * Sincronitza les dades del JSON (expert) cap a la UI de tags (chips).
 * Útil per quan l'usuari edita el JSON manualment.
 */
function syncJsonToTagsUI() {
  const jsonText = textareaCvJson.value.trim();
  if (!jsonText) return;

  try {
    const parsed = JSON.parse(jsonText);
    const conf = parsed.configuracio_usuari || parsed;
    if (!conf || !conf.perfil_tecnic) return;

    const coreTags = conf.perfil_tecnic.stack_core || [];
    const noGoTags = conf.perfil_tecnic.tecnologies_vetades || [];

    // Renderitzem els tags a la llista de la UI
    renderTags(tagListCore, coreTags, 'coreTags');
    renderTags(tagListNoGo, noGoTags, 'noGoTags');
    
  } catch (e) {
    // Si el JSON és invàlid, no fem res (l'usuari pot estar a mig editar)
    console.warn("JSON invàlid al textarea, no es poden sincronitzar els tags.");
  }
}

function syncJsonToReadonlyFields() {
  if (!textareaCvJson.value.trim()) {
    if (inputRolActual) inputRolActual.value = '';
    if (textareaResumProf) textareaResumProf.value = '';
    renderReadonlySkills([]);
    return;
  }
  try {
    let parsed = JSON.parse(textareaCvJson.value);
    let conf = parsed.configuracio_usuari || parsed;
    
    if (conf.identitat_i_logistica && conf.identitat_i_logistica.rol_actual) {
      if (inputRolActual) inputRolActual.value = conf.identitat_i_logistica.rol_actual;
    } else {
      if (inputRolActual) inputRolActual.value = '';
    }
    
    if (conf.resum_professional) {
      if (textareaResumProf) {
        textareaResumProf.value = conf.resum_professional;
        textareaResumProf.style.height = 'auto';
        textareaResumProf.style.height = textareaResumProf.scrollHeight + 'px';
      }
    } else {
      if (textareaResumProf) {
        textareaResumProf.value = '';
        textareaResumProf.style.height = 'auto';
      }
    }

    if (conf.perfil_tecnic && Array.isArray(conf.perfil_tecnic.skills)) {
      renderReadonlySkills(conf.perfil_tecnic.skills);
    } else {
      renderReadonlySkills([]);
    }
  } catch(e) {
    // ignorar errors de parseig mentres s'escriu manualment
  }
}

/**
 * Renderitza les habilitats en format de xips de només lectura.
 */
function renderReadonlySkills(skills) {
  if (!readonlySkillsList) return;
  
  if (!skills || skills.length === 0) {
    readonlySkillsList.innerHTML = '<span style="color: #9aa0a6; font-size: 0.75rem;">S\'obtindrà de l\'anàlisi...</span>';
    return;
  }

  readonlySkillsList.innerHTML = '';
  skills.forEach(skill => {
    const tagEl = document.createElement('div');
    tagEl.className = 'tag readonly';
    tagEl.innerHTML = `<span>#${skill}</span>`;
    readonlySkillsList.appendChild(tagEl);
  });
}

async function saveAllProfileData() {
  // 0. Sincronitza primer el JSON (expert) cap als tags de la UI
  // Això permet que si l'usuari ha editat manualment el JSON, els chips s'actualitzin
  syncJsonToTagsUI();

  const currentData = collectFormData();

  // 1. Sincronitza la UI cap al JSON per a la resta de camps (adreça, sba, etc.)
  syncUiToJson(currentData);

  // 1. Save profile to localStorage
  localStorage.setItem('userProfile', JSON.stringify(currentData));
  originalProfileData = JSON.parse(JSON.stringify(currentData));

  // 2. Save file to IndexedDB if staged
  if (stagedCvFile) {
    await saveFileToDB('cv_pdf', stagedCvFile);
    stagedCvFile = null;
  }

  // 3. UI Updates
  btnGuardarPerfil.disabled = true;
  showSaveSuccess();
  checkProfileStatus();
}

function showSaveSuccess() {
  if (saveStatusMsg) {
    saveStatusMsg.removeAttribute('hidden');
    setTimeout(() => {
      saveStatusMsg.setAttribute('hidden', '');
    }, 4000);
  }
}

// ── Event Listeners ─────────────────────────────────
function setupEventListeners() {
  // Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // Inputs
  inputLinkedinUrl.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    const isValid = !url || isValidUrl(url); // Accept empty or valid URL
    inputLinkedinUrl.style.borderColor = isValid ? '' : '#d93025';
    if (isValid) saveProfileField('linkedinUrl', url);
  });

  inputDispoDies.addEventListener('input', (e) => {
    saveProfileField('dispoDies', e.target.value);
    checkProfileStatus();
  });

  inputAddress.addEventListener('input', (e) => {
    saveProfileField('address', e.target.value);
    checkProfileStatus();
  });
  inputRadius.addEventListener('input', (e) => {
    saveProfileField('radius', e.target.value);
    checkProfileStatus();
  });
  inputSbaMin.addEventListener('input', (e) => {
    saveProfileField('sbaMin', e.target.value);
    checkProfileStatus();
  });
  inputSbaDesitjat.addEventListener('input', (e) => {
    saveProfileField('sbaDesitjat', e.target.value);
    checkProfileStatus();
  });
  inputMaxDays.addEventListener('input', (e) => {
    saveProfileField('maxDays', e.target.value);
    checkProfileStatus();
  });
  inputCommuteTime.addEventListener('input', (e) => {
    saveProfileField('commuteTime', e.target.value);
    checkProfileStatus();
  });
  textareaCvJson.addEventListener('input', (e) => {
    saveProfileField('cvJson', e.target.value);
    syncJsonToReadonlyFields();
    checkProfileStatus();
  });

  // Quan es perd el focus del JSON, intentem sincronitzar els tags si el JSON és vàlid
  textareaCvJson.addEventListener('blur', () => {
    syncJsonToTagsUI();
  });

  btnCopyJson.addEventListener('click', () => {
    const json = textareaCvJson.value.trim();
    if (!json) return;

    navigator.clipboard.writeText(json).then(() => {
      const originalText = btnCopyJson.innerHTML;
      btnCopyJson.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="margin-right: 6px;">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Copiat!</span>
      `;
      btnCopyJson.classList.add('success');

      setTimeout(() => {
        btnCopyJson.innerHTML = originalText;
        btnCopyJson.classList.remove('success');
      }, 2000);
    });
  });
  inputGeminiKey.addEventListener('input', (e) => saveProfileField('geminiKey', e.target.value));

  btnAnalitzarCv.addEventListener('click', () => handleCvAnalysis());

  if (btnClearNoGo) {
    btnClearNoGo.addEventListener('click', () => {
      renderTags(tagListNoGo, [], 'noGoTags');
      checkFormChanges();
    });
  }

  if (btnClearCore) {
    btnClearCore.addEventListener('click', () => {
      renderTags(tagListCore, [], 'coreTags');
      checkFormChanges();
    });
  }

  // Offer Tab Handlers
  inputOfertaUrl.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    const isValid = !url || isValidUrl(url);
    ofertaError.hidden = isValid;
    checkProfileStatus();
  });

  btnExaminar.addEventListener('click', () => {
    const url = inputOfertaUrl.value.trim();
    if (isValidUrl(url)) {
      startAnalysis(url);
    } else {
      ofertaError.hidden = false;
    }
  });

  if (btnNovaAnalisi) {
    btnNovaAnalisi.addEventListener('click', () => {
      // Mostrar àrea d'input
      ofertaUrlInputArea.hidden = false;
      // Amagar resultats, status i controls
      ofertaResults.hidden = true;
      ofertaStatusContainer.hidden = true;
      if (analysisControls) analysisControls.hidden = true;

      // Netejar continguts previs de les columnes
      if (contentOferta) contentOferta.innerHTML = '';
      if (contentAnalisi) contentAnalisi.innerHTML = '';

      // Opcionalment netejar el camp de URL anterior
      inputOfertaUrl.value = '';

      // Sincronitzar estat inicial
      checkProfileStatus();
      
      // Deshabilitar/amagar botó de navegació a carta
      if (btnNavCarta) {
        btnNavCarta.hidden = true;
      }
      
      // Resetear estat de carta de presentació
      currentJobAnalysis = null;
      updateCoverLetterUI();

      // Scroll cap a dalt
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Modality Chips
  modalityChips.forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const activeModalities = Array.from(document.querySelectorAll('#modalitat-selector .chip.active'))
        .map(c => c.dataset.value);
      saveProfileField('modalities', activeModalities);
      checkProfileStatus(); // Sincronitzar amb el Markdown
    });
  });

  // CV PDF Handling
  dropZoneCv.addEventListener('click', () => inputCvPdf.click());

  dropZoneCv.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneCv.classList.add('drag-over');
  });

  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    dropZoneCv.addEventListener(evt, () => dropZoneCv.classList.remove('drag-over'));
  });

  dropZoneCv.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length) handleCvUpload(files[0]);
  });

  inputCvPdf.addEventListener('change', (e) => {
    if (e.target.files.length) handleCvUpload(e.target.files[0]);
  });

  btnRemoveCv.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('Estàs segur que vols eliminar el CV?')) {
      removeFileFromDB('cv_pdf').then(() => {
        cvStatus.setAttribute('hidden', '');
        dropZoneCv.querySelector('.drop-zone-info').removeAttribute('hidden');
        inputCvPdf.value = '';
        btnAnalitzarCv.disabled = true;
      });
    }
  });

  btnDownloadCv.addEventListener('click', async (e) => {
    e.stopPropagation();
    const file = await getFileFromDB('cv_pdf');
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      // Use the stored file name or a default if not found
      a.download = file.name || 'el-meu-cv.pdf';
      document.body.appendChild(a);
      a.click();

      // Cleanup with a delay to ensure download starts correctly
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
  });

  // Tag Inputs
  setupTagInput(inputNoGo, tagListNoGo, 'noGoTags');
  setupTagInput(inputCore, tagListCore, 'coreTags');

  // SAVE BUTTON
  if (btnGuardarPerfil) {
    btnGuardarPerfil.addEventListener('click', () => saveAllProfileData());
  }
  
  // COVER LETTER BUTTONS
  if (btnGenerarCarta) {
    btnGenerarCarta.addEventListener('click', () => handleGenerateCoverLetter());
  }
  if (btnCopiarCarta) {
    btnCopiarCarta.addEventListener('click', () => copyCoverLetterToClipboard());
  }

  if (btnImprimirCarta) {
    btnImprimirCarta.addEventListener('click', () => window.imprimirCarta());
  }

  // Cover Letter Chip Toggles
  [btnCheckContacte, btnCheckEmpresa, btnCheckResaltar].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
      });
    }
  });

  // VENTALL PROFESSIONAL
  if (btnGenerarOcupacions) {
    btnGenerarOcupacions.addEventListener('click', () => handleGenerarOcupacions());
  }

  // STOP ANALYSIS
  if (btnStopAnalysis) {
    btnStopAnalysis.addEventListener('click', () => stopAnalysis());
  }
  if (btnStopOcupacions) {
    btnStopOcupacions.addEventListener('click', () => stopAnalysis());
  }

  // NAVIGATION FROM CV NEXT STEPS
  if (btnGotoOfertes) {
    btnGotoOfertes.addEventListener('click', () => {
      document.getElementById('tab-examina-oferta').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  if (btnGotoVentall) {
    btnGotoVentall.addEventListener('click', () => {
      document.getElementById('tab-ventall-professional').click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ── CV Upload Logic ─────────────────────────────────
async function handleCvUpload(file) {
  if (file.type !== 'application/pdf') {
    updateHeaderStatus("amber", "Error fitxer", "Només s'admeten fitxers PDF.");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    updateHeaderStatus("amber", "Error mida", "El fitxer és massa gran (màxim 2MB).");
    return;
  }

  stagedCvFile = file;
  updateCvUI(file.name);
  checkFormChanges();
}

function updateCvUI(name) {
  cvFilename.textContent = name;
  cvStatus.removeAttribute('hidden');
  dropZoneCv.querySelector('.drop-zone-info').setAttribute('hidden', '');
  btnAnalitzarCv.disabled = false;
}

// ── Tag Input Logic ─────────────────────────────────
function setupTagInput(input, list, storageKey) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      addTag(input, list, storageKey);
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim()) addTag(input, list, storageKey);
  });
}

function addTag(input, list, storageKey) {
  const tagValue = input.value.trim().replace(/^#/, '');
  if (!tagValue) return;

  const currentTags = Array.from(list.querySelectorAll('.tag span:first-child'))
    .map(s => s.textContent.replace('#', ''));

  if (!currentTags.includes(tagValue)) {
    currentTags.push(tagValue);
    renderTags(list, currentTags, storageKey);
    checkFormChanges();
  }
  input.value = '';
}

function renderTags(list, tags, storageKey) {
  list.innerHTML = '';
  tags.forEach(tag => {
    const tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.innerHTML = `
      <span>#${tag}</span>
      <span class="tag-remove" data-tag="${tag}">&times;</span>
    `;
    tagEl.querySelector('.tag-remove').addEventListener('click', () => {
      removeTag(tag, storageKey, list);
    });
    list.appendChild(tagEl);
  });
}

function removeTag(tagValue, storageKey, list) {
  let tags = Array.from(list.querySelectorAll('.tag span:first-child'))
    .map(s => s.textContent.replace('#', ''));
  tags = tags.filter(t => t !== tagValue);
  renderTags(list, tags, storageKey);
  checkFormChanges();
}

// ── CV Analysis & AI Logic ─────────────────────────
async function handleCvAnalysis() {
  const apiKey = inputGeminiKey.value.trim();
  if (!apiKey) {
    updateHeaderStatus("amber", "API key", "Si us plau, afegeix la teva Gemini API Key primer.");
    return;
  }

  const file = await getFileFromDB('cv_pdf');
  if (!file) {
    updateHeaderStatus("amber", "Falta CV", "No s'ha trobat cap fitxer CV a la base de dades local.");
    return;
  }

  try {
    analysisAbortController = new AbortController();
    resetProgress();
    updateProgress(10, 'Llegint PDF de la base de dades...');

    const arrayBuffer = await file.arrayBuffer();
    updateProgress(30, 'Extraient text del document...');

    const rawText = await extractTextFromPDF(arrayBuffer);
    if (!rawText.trim()) throw new Error('No s\'ha pogut extreure text del PDF.');

    updateAiStatus('Generant anàlisi experta amb Gemini IA...');

    const jsonResult = await callGeminiAPI(apiKey, rawText, (retryCount, total) => {
      updateAiStatus(`Generant anàlisi experta amb Gemini IA... (reintent de connexió IA ${retryCount}/${total})`);
    }, analysisAbortController.signal);

    updateProgress(90, 'Estructurant dades finals...');
    
    // Obtenim les veritats manuals de la UI abans de desar el nou JSON
    const currentUi = collectFormData();
    
    // L'objecte de l'IA pot portar configuracio_usuari fora o dins (depenent de la resposta exacte)
    let conf = jsonResult.configuracio_usuari || jsonResult;
    if (!conf.perfil_tecnic) conf.perfil_tecnic = {};
    
    // APLICAR REGLES:
    // 1. No-Go: Sempre és manual. El que hi hagi a la UI passa al JSON.
    conf.perfil_tecnic.tecnologies_vetades = currentUi.noGoTags || [];
    
    // 2. Core: Fusió de manual (UI) + AI (el que ha extregut de les experiències), sense duplicats.
    const aiCore = conf.perfil_tecnic.stack_core || [];
    conf.perfil_tecnic.stack_core = [...new Set([...aiCore, ...currentUi.coreTags])].sort();

    // 3. Skills: Suma de tots els "skills_experiencia" (unió única) de l'historial laboral
    let allSkills = new Set();
    if (Array.isArray(conf.historial_laboral)) {
      conf.historial_laboral.forEach(exp => {
        if (Array.isArray(exp.skills_experiencia)) {
          exp.skills_experiencia.forEach(s => {
            if (s && typeof s === 'string') allSkills.add(s.trim());
          });
        }
      });
    }
    conf.perfil_tecnic.skills = [...allSkills].sort();

    textareaCvJson.value = JSON.stringify(jsonResult, null, 2);
    
    // Sincronitzar els tags de la UI per assegurar que es veu la llista final unificada
    renderTags(tagListCore, conf.perfil_tecnic.stack_core, 'coreTags');
    renderTags(tagListNoGo, conf.perfil_tecnic.tecnologies_vetades, 'noGoTags');

    syncJsonToReadonlyFields();
    checkFormChanges();
    checkProfileStatus();

    updateAiStatus('Anàlisi completada amb èxit!');
    updateProgress(100, 'Anàlisi completada amb èxit!');
    setTimeout(() => progressContainer.hidden = true, 3000);

  } catch (err) {
    if (err.message === 'AbortError' || err.name === 'AbortError') {
       console.log("Anàlisi aturada per l'usuari.");
       return;
    }
    console.error('Error en l\'anàlisi:', err);
    updateProgress(0, 'IA No Disponible');
    updateHeaderStatus("amber", "IA No Disponible", err.message);
  } finally {
    analysisAbortController = null;
    btnAnalitzarCv.disabled = false;
  }
}

async function extractTextFromPDF(data) {
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += strings.join(' ') + '\n';
  }
  return fullText;
}

async function callGeminiAPI(key, text, onRetry = null, signal = null) {
  // Recollim preferències de l'usuari per passar-les a la IA
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const modalities = profile.modalities || [];

  const userSettings = {
    nom: profile.address ? "Usuari" : "",
    adreça: profile.address || "",
    salariMinim: profile.sbaMin || "",
    salariDesitjat: profile.sbaDesitjat || "",
    radiKm: profile.radius || "",
    tempsMinuts: timeToMinutes(profile.commuteTime || "00:45"),
    maxDiesPresencials: profile.maxDays || 0,
    acceptaRemot: modalities.includes('Remot'),
    acceptaPresencial: modalities.includes('Presencial'),
    acceptaHibrid: modalities.includes('Híbrid'),
    dispoDies: profile.dispoDies || ""
  };

  const prompt = `
    Actua com una experta senior en recruiting i recursos humans, i simultàniament com a experta en l'àmbit professional de l'usuari que ha escrit el CV.
    La teva tasca és analitzar el contingut d'un currículum i evertir-lo en un JSON estructurat.
    
    IMPORTANT: Tens unes preferències de l'usuari que HAS D'INCORPORAR EXACTAMENT al JSON final:
    - Nom Complet: ${userSettings.nom} (o el que trobis al CV si és més complet)
    - Adreça: ${userSettings.adreça}
    - Salari mínim anual: ${userSettings.salariMinim}
    - Salari desitjat anual: ${userSettings.salariDesitjat}
    - Distància màxima de desplaçament (km): ${userSettings.radiKm}
    - Temps màxim desplaçament (minuts): ${userSettings.tempsMinuts}
    - Dies presencials màxims per setmana: ${userSettings.maxDaysPresencials}
    - Accepta 100% Remot: ${userSettings.acceptaRemot}
    - Accepta 100% Presencial: ${userSettings.acceptaPresencial}
    - Modalitat preferida: ${modalities.join(', ')}
    - Disponibilitat d'incorporació (dies): ${userSettings.dispoDies}

    Genera EXCLUSIVAMENT un objecte JSON amb el següent format exacte:
    
    {
      "configuracio_usuari": {
        "identitat_i_logistica": {
          "nom_complet": "...",
          "rol_actual": "...",
          "adreça_base": {
            "carrer_i_numero": "Extrau el carrer de l'adreça facilitada",
            "codi_postal": "Extrau el CP de l'adreça facilitada",
            "poblacio": "Extrau la població de l'adreça facilitada"
          },
          "disponibilitat_incorporacio_dies": (int: ${userSettings.dispoDies ? userSettings.dispoDies : "extreure del CV si apareix, si no ''"})
        },
        "preferencies_i_filtres_infranquejables": {
          "salari_minim_anual": (int: ${userSettings.salariMinim}),
          "salari_desitjat": (int: ${userSettings.salariDesitjat}),
          "modalitat_treball": {
            "preferida": "Resumeix les modalitats seleccionades",
            "dies_presencials_maxims_setmana": (int: ${userSettings.maxDaysPresencials}),
            "accepta_100_presencial": (bool: ${userSettings.acceptaPresencial}),
            "accepta_100_remot": (bool: ${userSettings.acceptaRemot})
          },
          "limits_desplaçament": {
            "distancia_maxima_km": (int: ${userSettings.radiKm}),
            "temps_maxim_minuts": (int: ${userSettings.tempsMinuts})
          }
        },
        "resum_professional": "Un resum executiu redactat des d'un punt de vista de recruiting, destacant el valor diferencial de l'usuari.",
        "perfil_tecnic": {
          "stack_core": ["...", "..."],
          "stack_secundari": ["...", "..."],
          "skills": ["Aquest camp és la suma de tous els 'skills_experiencia' de l'historial laboral."],
          "tecnologies_vetades": ["...", "..."],
          "idiomes": [{"idioma": "...", "nivell": "..."}]
        },
        "educacio_i_certificacions": [{"titol": "...", "institucio": "...", "any_finalitzacio": (int)}],
        "historial_laboral": [
          {
            "empresa": "...",
            "sector": "...",
            "carrec": "...",
            "periode": "...",
            "stack_utilitzat": ["Llista de tecnologies/eines concretes. Ex: Python, AWS."],
            "skills_experiencia": ["Conceptes que donin informació sobre skills necessaris or usats. Ex: 'gestió de riscos', 'gestió d'equips', 'arquitectura microserveis'."],
            "responsabilitats": ["...", "..."],
            "fites_clau": "..."
          }
        ]
      },
      "NOTES_LOGICA": {
        "distribucio_stack": "Classifica les tecnologies en Core o Secundari. El 'stack_core' ha de contenir les eines principals i recurrents dels darrers 10 anys. El 'stack_secundari' ha d'incloure tecnologies d'experiències laborals de fa més de 10 anys, així com eines auxiliars o secundàries esmentades al CV (habilitats puntuals, cursos) que no siguin el focus central de la carrera actual.",
        "deteccio_tecnologies": "Sigues exhaustiu detectant tecnologies tant si apareixen en frases, llistes separades per comes o format hashtags (ex: #Python). En cas de hashtags, elimina el símbol '#' excepte si és part del nom de la tecnologia (per exemple: C# s'ha de mantenir tal qual).",
        "extreccio_skills": "Com a experta en recruiting, analitza les responsabilitats i fites de cada experiència per extreure skills rellevants. Alguns seran directes, d'altres requeriran inferència (ex: si explica que va resoldre conflictes tècnics, inclou 'resolució d'incidències complexes')."
      }
    }

    Aquí tens el text del format CV:
    ---
    ${text}
    ---

    Respon NOMÉS amb el JSON. No incloguis markdown code blocks.
  `;

  return await callGemini(prompt, onRetry, signal, true);
}

// ── Progress UI Logic ───────────────────────────────
function stopAnalysis() {
  if (analysisAbortController) {
    analysisAbortController.abort();
    analysisAbortController = null;
    
    // Neteja El meu CV (si aplica)
    if (progressContainer) progressContainer.hidden = true;
    
    // Neteja Ventall Professional (si aplica)
    if (ocupacionsLoader) ocupacionsLoader.style.display = 'none';
    if (btnGenerarOcupacions) btnGenerarOcupacions.disabled = false;
    
    updateHeaderStatus("amber", "Anàlisi cancel·lada", "Has aturat el procés d'anàlisi manualment.");
  }
}

function resetProgress() {
  progressContainer.hidden = false;
  progressFiller.style.width = '0%';
  progressPercent.textContent = '0%';
}

function updateProgress(percent, status) {
  progressFiller.style.width = percent + '%';
  progressPercent.textContent = percent + '%';
  progressStatus.textContent = status;
}

function updateVentallProgress(percent, status) {
  if (ventallProgressFiller) ventallProgressFiller.style.width = percent + '%';
  if (ventallPercentage) ventallPercentage.textContent = percent + '%';
  if (ventallStatusText) ventallStatusText.textContent = status;
  updateAiStatus(status); // També mantenim el sincronisme amb el badge global d'IA
}

// ── Ventall Professional Logic ──────────────────────
async function handleGenerarOcupacions() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const apiKey = profile.geminiKey || '';
  if (!apiKey) {
    alert("Si us plau, afegeix la teva Gemini API Key a 'El meu CV' abans d'explorar les ocupacions.");
    return;
  }

  // Inicialitzem controlador per cancel·lació
  analysisAbortController = new AbortController();
  const signal = analysisAbortController.signal;

  try {
    btnGenerarOcupacions.disabled = true;
    ocupacionsLoader.style.display = 'flex';
    updateVentallProgress(0, "Connectant amb l'eina intel·ligent i perfilant l'historial...");

    // --- PREPARACIÓ DE DADES PER ALS PROMPTS ---
    let cvData = {};
    try {
      cvData = JSON.parse(profile.cvJson || '{}');
    } catch (e) {
      console.warn("CV JSON invàlid al perfil per al ventall profesional.");
    }
    const conf = cvData.configuracio_usuari || cvData;
    
    const rolActual = conf.identitat_i_logistica?.rol_actual || '';
    const resumProf = conf.resum_professional || '';
    let carrecs = [];
    if (conf.historial_laboral && Array.isArray(conf.historial_laboral)) {
      carrecs = conf.historial_laboral.map(h => h.carrec).filter(c => c);
    }
    
    const promptData = `Rol actual: ${rolActual}\nResum professional: ${resumProf}\nExperiència (càrrecs previs): ${carrecs.join(', ')}`;
    const promptOcupacions = `Actua com un expert europeu en el mercat laboral i la classificació ESCO. Retorna un array JSON (anglès) de fins a 8 ocupacions potencials segons aquest perfil:\n${promptData}\nRespon EXCLUSIVAMENT amb un array ["job1", "job2"].`;

    const skillsConsolidades = conf.perfil_tecnic?.skills || [];
    const stackCore = conf.perfil_tecnic?.stack_core || [];
    const stackSecundari = conf.perfil_tecnic?.stack_secundari || [];
    const idiomes = (conf.perfil_tecnic?.idiomes || []).map(i => i.idioma);
    const educacio = (conf.educacio_i_certificacions || []).map(e => e.titol);
    let stackExp = [];
    if (conf.historial_laboral && Array.isArray(conf.historial_laboral)) {
      conf.historial_laboral.forEach(h => {
        if (h.skills_experiencia) stackExp.push(...h.skills_experiencia);
        if (h.stack_utilitzat) stackExp.push(...h.stack_utilitzat);
      });
    }

    const skillsPromptData = `Primary: ${(skillsConsolidades.concat(stackCore)).join(', ')}\nSecondary: ${(stackSecundari.concat(stackExp)).join(', ')}\nIdiomes: ${idiomes.join(', ')}\nEducació: ${educacio.join(', ')}`;
    const promptSkills = `Tradueix i normalitza aquestes habilitats a la terminologia ESCO (en anglès). Retorna un array JSON exhaustiu (80-120 termes). No ometis res:\n${skillsPromptData}\nRespon EXCLUSIVAMENT amb l'array ["skill1", "skill2"].`;
    // --- FI PREPARACIÓ ---

    const [dataOcc, userSkills] = await Promise.all([
      (async () => {
        updateVentallProgress(5, "Consultant la IA sobre les ocupacions més adients per a tu...");
        return callGemini(promptOcupacions, (retry, total) => {
          updateVentallProgress(5 + (retry * 2), `Explorant ventall... (reintent ${retry}/${total})`);
        }, signal, true);
      })(),
      (async () => {
        // No actualitzem el text aquí perquè s'encavalcaria amb el de dalt, 
        // deixem que la barra es mogui quan ambdues acabin o via callGemini
        return callGemini(promptSkills, null, signal, true);
      })()
    ]);
    
    updateVentallProgress(45, "✓ IA: Perfil i ocupacions identificades. Iniciant processament ESCO...");

    const ocupacionsArray = Array.isArray(dataOcc) ? dataOcc : (dataOcc.ocupacions || []);
    const userSkillsDictionary = (Array.isArray(userSkills) ? userSkills : (userSkills.skills || userSkills.userSkills || [])).map(s => s.toLowerCase());

    // --- RESTAURACIÓ DICCIIONARIS ---
    if (diccionariOcupacionsText) {
      diccionariOcupacionsText.textContent = JSON.stringify(ocupacionsArray, null, 2);
    }
    if (diccionariSkillsText) {
      diccionariSkillsText.textContent = JSON.stringify(userSkillsDictionary, null, 2);
    }
    // --- FI RESTAURACIÓ DICCIIONARIS ---

    // 3. Renderitzat incremental
    ventallResults.hidden = false;
    llistaOcupacions.innerHTML = ''; // Netegem per carregar una a una
    
    // Mostrem el resum global (encara buit o amb 0)
    const globalContainer = renderGlobalSummaryPlaceholder();
    
    let escoCallsCompleted = 0;
    let resultsForGlobal = [];
    const totalOcc = ocupacionsArray.length;

    // Pintem cada ocupació a mesura que arriba
    const fetchAndRender = async (ocDesc) => {
        try {
            const ocObj = await fetchEscoData(ocDesc, signal);
            resultsForGlobal.push(ocObj);
            
            // Renderitzem la carta individual
            const card = renderOccupationCard(ocObj, userSkillsDictionary);
            llistaOcupacions.appendChild(card);
            
            escoCallsCompleted++;
            
            // Percentatge: anem del 45% al 98% durant el processament ESCO
            const currentPct = Math.round(45 + ((escoCallsCompleted / totalOcc) * 50));
            updateVentallProgress(currentPct, `Processant ocupacions ESCO (${escoCallsCompleted} de ${totalOcc})...`);
            
            // Actualitzem el resum global amb les dades que anem tenint
            updateGlobalSummary(globalContainer, resultsForGlobal, userSkillsDictionary);
            
        } catch (e) {
            console.error('Error processant ocupació:', ocDesc, e);
            escoCallsCompleted++;
        }
    };

    // Lancem totes les crides en paral·lel però es renderitzaran individualment
    await Promise.all(ocupacionsArray.map(ocDesc => fetchAndRender(ocDesc)));

    updateVentallProgress(100, "✓ Procés completat correctament.");
    
    // Actualitzem el text del resum global per indicar finalització
    if (globalContainer) {
      const countLabel = globalContainer.querySelector('#global-count-val');
      if (countLabel) countLabel.textContent = `✓ Basat en ${ocupacionsArray.length} ocupacions analitzades.`;
    }
    ventallResults.hidden = false;

  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'AbortError') {
      console.log('Anàlisi cancel·lada per l\'usuari.');
      return;
    }
    console.error('Error Ventall:', err);
    ventallResults.hidden = false;
    llistaOcupacions.innerHTML = `
      <div class="info-alert" style="background-color: #fce8e6; border-color: #ea4335; color: #b21414;">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span><strong>IA No Disponible:</strong> ${err.message || 'No s\'ha pogut processar la informació.'}</span>
      </div>
    `;
  } finally {
    btnGenerarOcupacions.disabled = false;
    ocupacionsLoader.style.display = 'none';
    analysisAbortController = null;
  }
}

/**
 * Recupera dades d'ESCO per a una ocupació, utilitzant memòria cau (cache).
 */
async function fetchEscoData(ocDesc, signal) {
  if (escoCache.resource.has(ocDesc)) return escoCache.resource.get(ocDesc);

  const urlSearch = `https://ec.europa.eu/esco/api/search?text=${encodeURIComponent(ocDesc)}&type=occupation&language=en&limit=1`;
  const rSearch = await fetch(urlSearch, { signal });
  if (!rSearch.ok) throw new Error('Error ESCO Search');
  
  const searchData = await rSearch.json();
  if (!searchData._embedded || searchData._embedded.results.length === 0) return { titol: ocDesc, skills: [] };
  
  const uri = searchData._embedded.results[0].uri;
  const titleEsco = searchData._embedded.results[0].title;
  if (escoCache.resource.has(uri)) return escoCache.resource.get(uri);

  const urlResource = `https://ec.europa.eu/esco/api/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`;
  const rRes = await fetch(urlResource, { signal });
  if (!rRes.ok) throw new Error('Error ESCO Resource');
  
  const resData = await rRes.json();
  let skills = [];
  if (resData._links?.hasEssentialSkill) skills.push(...resData._links.hasEssentialSkill.map(s => ({ ...s, isEssential: true })));
  if (resData._links?.hasOptionalSkill) skills.push(...resData._links.hasOptionalSkill.map(s => ({ ...s, isEssential: false })));

  const result = { titol: titleEsco || ocDesc, skills, uri };
  escoCache.resource.set(ocDesc, result);
  escoCache.resource.set(uri, result);
  return result;
}

function renderGlobalSummaryPlaceholder() {
  const container = document.createElement('div');
  container.className = 'global-summary-card';
  container.style.cssText = 'padding: 24px; background: var(--li-blue-faint); border-radius: var(--radius-lg); border: 1px solid var(--li-blue-light); margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;';
  llistaOcupacions.appendChild(container);
  return container;
}

function updateGlobalSummary(container, results, userSkillsDict) {
  let essM = 0, essT = 0, optM = 0, optT = 0;
  results.forEach(oc => {
    (oc.skills || []).forEach(sk => {
      const titleLower = (sk.title || '').toLowerCase();
      const isM = userSkillsDict.some(u => titleLower.includes(u) || u.includes(titleLower));
      if (sk.isEssential) { essT++; if(isM) essM++; }
      else { optT++; if(isM) optM++; }
    });
  });

  const getPct = (m, t) => t === 0 ? 'N/A' : Math.round((m/t)*100) + '%';
  const essConf = getPct(essM, essT);
  const optConf = getPct(optM, optT);

  // Mantenim l'estructura per no recrear el botó cada vegada
  if (!container.innerHTML || container.innerHTML.includes('Esperant dades')) {
    container.innerHTML = `
      <div style="flex: 1; min-width: 300px;">
        <h4 style="margin: 0 0 16px 0; font-size: 1.1rem; color: var(--li-blue); font-weight: 700;">Assoliment global del teu perfil professional (ESCO)</h4>
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <!-- Impact Box Essential -->
          <div style="background: #fff; border: 1px solid #cce8d5; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 120px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div id="global-ess-val" style="font-size: 2.2rem; font-weight: 800; color: #137333; line-height: 1;">${essConf}</div>
            <div style="font-size: 0.75rem; color: #137333; font-weight: 600; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px;">Essencials</div>
          </div>
          <!-- Impact Box Optional -->
          <div style="background: #fff; border: 1px solid #fbe7b2; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 120px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div id="global-opt-val" style="font-size: 2.2rem; font-weight: 800; color: #b06000; line-height: 1;">${optConf}</div>
            <div style="font-size: 0.75rem; color: #b06000; font-weight: 600; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px;">Opcionals</div>
          </div>
        </div>
        <p id="global-count-val" style="font-size: 0.8rem; color: var(--text-secondary); margin: 12px 0 0 4px; font-style: italic;">
          Processant ocupacions... (${results.length})
        </p>
      </div>
      <div style="flex-shrink: 0; display: flex; align-items: center;">
        <button id="btn-global-improvements" class="primary-btn" style="white-space: nowrap; padding: 12px 24px;">Millores globals del teu CV</button>
      </div>
    `;

    // Lògica del botó global (Prompts originals)
    const btnGlobal = container.querySelector('#btn-global-improvements');
    const globalResponseBox = document.createElement('div');
    globalResponseBox.id = 'global-response-box';
    globalResponseBox.style.cssText = 'display: none; flex-direction: column; gap: 8px; padding: 16px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; margin-top: 16px; width: 100%;';
    container.appendChild(globalResponseBox);

    btnGlobal.onclick = async () => {
      btnGlobal.disabled = true;
      btnGlobal.innerHTML = '<span class="status-loader" style="width: 14px; height: 14px;"></span> Analitzant...';
      globalResponseBox.style.display = 'flex';
      globalResponseBox.innerHTML = '<p style="color:var(--text-secondary); font-style:italic; text-align:center;">L\'IA està analitzant la teva estratègia per a totes les ocupacions...</p>';

      try {
        const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
        let cvJson = {}; try { cvJson = JSON.parse(profile.cvJson || '{}'); } catch(e){}
        const conf = cvJson.configuracio_usuari || cvJson;
        const userHistorial = JSON.stringify(conf.historial_laboral || []);
        const userResum = conf.perfil_tecnic?.resum_professional || conf.resum_professional || "No especificat";
        const currentOcupacions = results.map(o => o.titol).join(', ');

        const prompt = `Ets un expert en recruiting i orientador de recerca de feina directe i objectiu. Absten-te d'afalacs innecessaris.
El candidat té la següent llista d'ocupacions potencials identificades: ${currentOcupacions}.
Resum Professional: ${userResum}
Historial laboral: ${userHistorial}

LA TEVA MISSIÓ:
Analitza el perfil del candidat i proporciona propostes de millora generals i estratègiques ESTRUCTURADES OCUPACIÓ PER OCUPACIÓ.
No facis una anàlisi skill a skill. Explica com ha de presentar la seva experiència o quina mentalitat/enfocament ha d'adoptar per ser un candidat d'èxit en cadascuna d'aquestes línies professionals.
Respon en Markdown pur, concís, max 500 paraules.`;

        const res = await callGemini(prompt, null, null, false);
        const disclaimer = 'ⓘ Dues consultes consecutives poden generar resultats diferents. Contrasta els consells amb el teu criteri.';
        
        globalResponseBox.innerHTML = `
          <div class="ia-response-content markdown-body">${marked.parse(res)}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; margin-top: 12px; padding-top: 8px; border-top: 1px solid #ddd;">${disclaimer}</div>
          <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
            <button id="btn-print-global" class="secondary-btn compact" style="gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              Imprimir informe global
            </button>
          </div>
        `;

        globalResponseBox.querySelector('#btn-print-global').onclick = () => {
          const win = window.open('', '_blank');
          win.document.write(`<html><head><title>Estratègia Professional</title><style>body{font-family:sans-serif; padding:40px; line-height:1.6;} h1,h2,h3{color:#0a66c2;}</style></head><body><h1>Informe d'Estratègia Professional</h1>${globalResponseBox.querySelector('.ia-response-content').innerHTML}</body></html>`);
          win.document.close();
          win.print();
        };

      } catch (err) {
        globalResponseBox.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
      } finally {
        btnGlobal.disabled = false;
        btnGlobal.innerHTML = 'Millores globals del teu CV';
      }
    };
  } else {
    // Només actualitzem els valors dels badges
    container.querySelector('#global-ess-val').textContent = essConf;
    container.querySelector('#global-opt-val').textContent = optConf;
    
    // Actualització del text de recompte
    const statusText = container.innerHTML.includes('✓ Procés completat') 
      ? `✓ Basat en ${results.length} ocupacions analitzades.`
      : `Anàlisi en curs... (${results.length} ocupacions processades)`;
    
    container.querySelector('#global-count-val').textContent = statusText;
  }
}

function renderOccupationCard(ocObj, userSkillsDictionary) {
  const card = document.createElement('div');
  card.style.cssText = 'padding: 16px; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 12px; display: flex; flex-direction: column; gap: 0;';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer; gap: 16px; padding-bottom: 8px;';
  
  const titleArea = document.createElement('div');
  titleArea.style.cssText = 'display: flex; align-items: center; gap: 12px; flex: 1;';

  // Badges de percentatge individuals
  const essT = (ocObj.skills || []).filter(s => s.isEssential).length;
  const essM = (ocObj.skills || []).filter(s => s.isEssential && userSkillsDictionary.some(u => (s.title||'').toLowerCase().includes(u) || u.includes((s.title||'').toLowerCase()))).length;
  const optT = (ocObj.skills || []).filter(s => !s.isEssential).length;
  const optM = (ocObj.skills || []).filter(s => !s.isEssential && userSkillsDictionary.some(u => (s.title||'').toLowerCase().includes(u) || u.includes((s.title||'').toLowerCase()))).length;

  const getPct = (m, t) => t === 0 ? 'N/A' : Math.round((m/t)*100) + '%';
  const essP = getPct(essM, essT);
  const optP = getPct(optM, optT);

  const badges = document.createElement('div');
  badges.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  badges.innerHTML = `
    <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: #e6f4ea; color: #137333; font-weight: bold; text-align: center;">ESN: ${essP}</span>
    <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: #fef7e0; color: #b06000; font-weight: bold; text-align: center;">OPC: ${optP}</span>
  `;

  const title = document.createElement('span');
  title.style.cssText = 'font-weight: 600; font-size: 1.1rem; text-transform: capitalize; color: var(--text-primary);';
  title.textContent = ocObj.titol;

  titleArea.appendChild(badges);
  titleArea.appendChild(title);
  
  const chevron = document.createElement('span');
  chevron.style.paddingTop = '4px';
  chevron.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  chevron.style.transition = 'transform 0.2s';

  header.appendChild(titleArea);
  header.appendChild(chevron);
  card.appendChild(header);

  const content = document.createElement('div');
  content.style.cssText = 'display: none; flex-direction: column; gap: 12px; border-top: 1px solid var(--border); pt-12px;';
  content.style.paddingTop = '12px';
  card.appendChild(content);

  // Lògica de separació de skills
  const skills = ocObj.skills || [];
  const matched = [];
  const unmatched = [];
  
  skills.forEach(sk => {
     const skLower = (sk.title || '').toLowerCase();
     if (userSkillsDictionary.some(u => skLower.includes(u) || u.includes(skLower))) matched.push(sk);
     else unmatched.push(sk);
  });

  // Ordenar coincidències (essencials primer)
  matched.sort((a,b) => (b.isEssential ? 1 : 0) - (a.isEssential ? 1 : 0));

  // Llista inicial: Tots els matches + 5 extres (mínim 10 total)
  const initialExtrasCount = Math.max(5, 10 - matched.length);
  const initialList = [...matched, ...unmatched.slice(0, initialExtrasCount)];
  const remaining = unmatched.slice(initialExtrasCount);

  const mainList = document.createElement('div');
  mainList.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
  initialList.forEach(sk => mainList.appendChild(processSkillElement(sk, userSkillsDictionary)));
  content.appendChild(mainList);

  if (remaining.length > 0) {
    const btnRest = document.createElement('button');
    btnRest.className = 'secondary-btn compact';
    btnRest.style.margin = '8px 0';
    btnRest.textContent = `Mostra la resta (+${remaining.length} habilitats per explorar)`;
    content.appendChild(btnRest);

    const compactBox = document.createElement('div');
    compactBox.style.cssText = 'display: none; flex-wrap: wrap; gap: 6px; padding: 12px; background: var(--li-blue-faint); border-radius: 8px; border: 1px solid var(--li-blue-light);';
    remaining.forEach(sk => compactBox.appendChild(processSkillElement(sk, userSkillsDictionary, true)));
    content.appendChild(compactBox);

    btnRest.onclick = () => {
      btnRest.style.display = 'none';
      compactBox.style.display = 'flex';
    };
  }

  header.onclick = () => {
    const isShown = content.style.display === 'flex';
    content.style.display = isShown ? 'none' : 'flex';
    chevron.style.transform = isShown ? 'rotate(0deg)' : 'rotate(180deg)';
  };

  // --- Botons d'Accions ---
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end;';
  
  const btnPrint = document.createElement('button');
  btnPrint.className = 'secondary-btn compact';
  btnPrint.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Imprimir';
  
  const btnImprove = document.createElement('button');
  btnImprove.className = 'secondary-btn compact';
  btnImprove.style.background = 'var(--li-blue-faint)';
  btnImprove.style.color = 'var(--li-blue)';
  btnImprove.textContent = 'Millora el teu CV ✨';

  actions.appendChild(btnPrint);
  actions.appendChild(btnImprove);
  content.appendChild(actions);

  const aiBox = document.createElement('div');
  aiBox.style.cssText = 'display: none; padding: 12px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; font-size: 0.85rem; margin-top: 8px;';
  content.appendChild(aiBox);

  btnImprove.onclick = async (e) => {
    e.stopPropagation();
    btnImprove.disabled = true;
    btnImprove.innerHTML = '<span class="status-loader" style="width:12px; height:12px;"></span> Analitzant...';
    aiBox.style.display = 'block';
    aiBox.innerHTML = '<p style="color:var(--text-secondary); font-style:italic;">L\'IA està analitzant la teva trajectòria per a aquesta ocupació...</p>';

    try {
      const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
      let cvJson = {}; try { cvJson = JSON.parse(profile.cvJson || '{}'); } catch(e){}
      const userResum = cvJson.configuracio_usuari?.perfil_tecnic?.resum_professional || "No especificat";
      const userHistorial = JSON.stringify(cvJson.configuracio_usuari?.historial_laboral || []);
      
      const missingEss = skills.filter(s => s.isEssential && !userSkillsDictionary.some(u => (s.title||'').toLowerCase().includes(u)));
      const missingArr = missingEss.slice(0, 10).map(s => s.title).join(', ');

      const prompt = `Ets un expert en recruiting i orientador de recerca de feina directe i objectiu. El candidat s'està preparant per l'ocupació de "${ocObj.titol}".
Habilitats ESSENCIALS que li falten: ${missingArr}
Context CV: ${userResum}
Historial laboral: ${userHistorial}

LA TEVA MISSIÓ:
Analitza CADA UNA d'aquestes habilitats (màxim 10). Per a cada habilitat:
- Si NO hi ha indici al CV, respon: "No es detecta experiència demostrable."
- Si n'hi ha, estructura la resposta amb:
   1. "Anàlisi de l'experiència al CV": Justificació de quines experiències fan entreveure el skill.
   2. "Proposta de millora": Redactat alternatiu exacte per incloure'l.

Respon en Markdown pur, extremadament concís, max 1000 paraules.`;
      
      const res = await callGemini(prompt, null, null, false);
      aiBox.innerHTML = `<div class="markdown-body">${marked.parse(res)}</div>`;
    } catch (err) {
      aiBox.innerHTML = `<p style="color:var(--li-red);">Error: ${err.message}</p>`;
    } finally {
      btnImprove.disabled = false;
      btnImprove.innerHTML = 'Millora el teu CV ✨';
    }
  };

  btnPrint.onclick = (e) => {
    e.stopPropagation();
    const printWindow = window.open('', '_blank');
    const skillsHtml = skills.map(s => {
      const match = userSkillsDictionary.some(u => (s.title||'').toLowerCase().includes(u));
      return `<li>${match?'✅':'❌'} <strong>${s.title}</strong> (${s.isEssential?'Essencial':'Opcional'})</li>`;
    }).join('');
    
    printWindow.document.write(`
      <html><head><title>Anàlisi Ocupació: ${ocObj.titol}</title>
      <style>
        body{font-family:sans-serif; padding:40px; color:#333; line-height:1.6; max-width:800px; margin:0 auto;} 
        h2,h3{color:#0a66c2;} 
        .skills-list{display:grid; grid-template-columns:1fr 1fr; gap:10px; list-style:none; padding:0; font-size:0.9rem;}
        .markdown-body{background:#f8f9fa; padding:20px; border-radius:8px; border:1px solid #ddd;}
      </style></head>
      <body>
        <h2>Anàlisi Professional: ${ocObj.titol}</h2>
        <div style="margin-bottom:20px; padding:15px; background:#f0f4f8; border-radius:8px;">
           <strong>Assoliment Essencials:</strong> ${essP} | <strong>Assoliment Opcionals:</strong> ${optP}
        </div>
        <h3>Habilitats requerides (ESCO)</h3>
        <ul class="skills-list">${skills.map(s => {
          const match = userSkillsDictionary.some(u => (s.title||'').toLowerCase().includes(u) || u.includes((s.title||'').toLowerCase()));
          return `<li>${match?'✅':'❌'} ${s.title} (${s.isEssential?'Essencial':'Opc'})</li>`;
        }).join('')}</ul>
        ${aiBox.style.display === 'block' ? `<h3>Suggeriments de la IA</h3><div class="markdown-body">${aiBox.innerHTML}</div>` : ''}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return card;
}

function processSkillElement(sk, userSkillsDictionary, isCompact = false) {
  const skMatchName = (sk.title || '').toLowerCase();
  const matchedUsrSk = userSkillsDictionary.find(usrSk => skMatchName.includes(usrSk) || usrSk.includes(skMatchName));
  const isMatch = !!matchedUsrSk;

  if (isCompact) {
    const chip = document.createElement('span');
    chip.style.cssText = `
      display: inline-flex;
      align-items: center;
      font-size: 0.75rem;
      padding: 3px 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-secondary);
      white-space: nowrap;
    `;
    chip.textContent = sk.title;
    if (sk.isEssential) {
      chip.style.borderColor = 'var(--li-blue-light)';
      chip.style.color = 'var(--li-blue)';
    }
    return chip;
  }

  const sku = document.createElement('div');
  sku.style.cssText = 'display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem; padding: 6px 10px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px;';
  
  const skillNameArea = document.createElement('div');
  skillNameArea.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';
  
  const typeBadge = document.createElement('span');
  typeBadge.style.cssText = sk.isEssential 
      ? 'font-size: 0.7rem; padding: 2px 6px; background: var(--li-blue-faint); color: var(--li-blue); border-radius: 12px; font-weight: bold; min-width: 65px; text-align: center;'
      : 'font-size: 0.7rem; padding: 2px 6px; background: var(--bg-body); color: var(--text-secondary); border-radius: 12px; min-width: 65px; text-align: center;';
  typeBadge.textContent = sk.isEssential ? 'Essencial' : 'Opcional';
  
  const sTitle = document.createElement('span');
  sTitle.textContent = sk.title;
  sTitle.style.color = 'var(--text-primary)';
  
  skillNameArea.appendChild(typeBadge);
  skillNameArea.appendChild(sTitle);
  
  const rightArea = document.createElement('div');
  rightArea.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  if (isMatch) {
    const matchNote = document.createElement('span');
    matchNote.style.cssText = 'font-size: 0.75rem; color: var(--li-blue); font-style: italic; opacity: 0.8;';
    matchNote.textContent = `(${matchedUsrSk})`;
    rightArea.appendChild(matchNote);
  }

  const matchIcon = document.createElement('span');
  matchIcon.innerHTML = isMatch 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#057642" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' 
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d11124" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  
  rightArea.appendChild(matchIcon);
  sku.appendChild(skillNameArea);
  sku.appendChild(rightArea);
  return sku;
}
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function startAnalysis(url) {
  // Amagar l'àrea d'entrada de URL
  if (ofertaUrlInputArea) ofertaUrlInputArea.hidden = true;

  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const renderedCv = renderJsonToMarkdown(profile.cvJson);

  // 0. Mostrar controls d'anàlisi (botó Nova anàlisi)
  if (analysisControls) analysisControls.hidden = false;

  // 1. Mostrar l'indicador d'estat actiu
  ofertaStatusContainer.hidden = false;
  statusLoader.style.display = 'block';
  statusMessageMain.innerHTML = `<strong>Analitzant l'oferta...</strong>`;
  statusMessageSub.textContent = `Intentant llegir: ${url}`;

  // 2. Mostrar la zona de comparativa
  ofertaResults.hidden = false;

  // Columna Dreta: El teu Perfil (Immediat)
  contentCv.innerHTML = marked.parse(renderedCv);

  // Columna Esquerra: Detalls de l'oferta
  contentOferta.innerHTML = `
    <div class="text-center py-10">
      <p class="text-secondary italic">Explorant els detalls del lloc de treball...</p>
      <div class="status-loader mx-auto mt-4"></div>
    </div>
  `;

  // Columna Central: Netejar anàlisis previs
  if (contentAnalisi) contentAnalisi.innerHTML = '';

  // Columna Central: Netejar anàlisis previs
  if (contentAnalisi) contentAnalisi.innerHTML = '';

  try {
    const response = await fetch(url, { mode: 'no-cors' }); // 'no-cors' no permet llegir el body
    // En realitat, des del navegador, no podrem llegir LinkedIn directament sense un proxy.
    // Així que forçarem el fallback de copy-paste per ara per garantir funcionalitat.
    throw new Error('CORS_RESTRICTION');
  } catch (err) {
    showManualPasteUI();
  }
}

function showManualPasteUI() {
  if (ofertaUrlInputArea) ofertaUrlInputArea.hidden = true;

  statusMessageMain.innerHTML = `<strong>Accés restringit per LinkedIn</strong>`;
  statusMessageSub.textContent = `Si us plau, enganxa el text de l'oferta a la columna esquerra.`;
  statusLoader.style.display = 'none';

  contentOferta.innerHTML = `
    <div class="manual-paste-area p-4">
      <h4 class="mb-2 font-bold text-li-blue">📋 Enganxa el text de l'oferta</h4>
      <p class="text-xs mb-4 text-secondary">LinkedIn no permet la lectura directa. Per analitzar-ho, selecciona tot el text de l'oferta (Ctrl+A), copia (Ctrl+C) i enganxa-ho aquí:</p>
      <textarea id="textarea-manual-offer" 
                class="w-full h-80 p-3 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-400 outline-none" 
                placeholder="Exple: Títol, Empresa, Descripció, Requisits..."></textarea>
      <button id="btn-analitzar-manual" class="primary-btn mt-4 w-full">Continuar amb l'anàlisi de l'oferta</button>
    </div>
  `;

  document.getElementById('btn-analitzar-manual').addEventListener('click', () => {
    const jobText = document.getElementById('textarea-manual-offer').value.trim();
    if (jobText) {
      processJobAnalysis(jobText);
    } else {
      updateHeaderStatus("amber", "Falta oferta", "Has d'enganxar algun contingut per analitzar.");
    }
  });
}

async function processJobAnalysis(jobText) {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const cvData = profile.cvJson ? (typeof profile.cvJson === 'string' ? JSON.parse(profile.cvJson) : profile.cvJson) : {};
  const config = cvData.configuracio_usuari || cvData || {};

  const geminiKey = profile.geminiKey;
  if (!geminiKey) {
    updateHeaderStatus("amber", "API key", "Has de configurar la teva API Key de Google Gemini a la secció de Perfil.");
    return;
  }

  // Recollim les "veritats" de l'usuari per comparar
  // Sumem hashtags de la UI i dades del JSON per als Stacks (sense duplicats)
  const manualNoGo = profile.noGoTags || [];
  const manualCore = profile.coreTags || [];
  const jsonNoGo = config.perfil_tecnic?.tecnologies_vetades || [];
  const jsonCore = config.perfil_tecnic?.stack_core || [];

  const userNoGo = [...new Set([...manualNoGo, ...jsonNoGo])];
  const userCore = [...new Set([...manualCore, ...jsonCore])];
  const userSec = config.perfil_tecnic?.stack_secundari || [];
  const userMinSba = config.preferencies_i_filtres_infranquejables?.salari_minim_anual || 0;
  const userDesitjatSba = config.preferencies_i_filtres_infranquejables?.salari_desitjat || 0;
  const userModality = config.preferencies_i_filtres_infranquejables?.modalitat_treball?.preferida || "";
  const userSectors = config.historial_laboral?.map(h => h.sector).filter(Boolean) || [];
  const userEdu = config.educacio_i_certificacions?.map(e => `${e.titol} (${e.institucio})`).filter(Boolean) || [];
  const userIdiomes = config.perfil_tecnic?.idiomes?.map(i => `${i.idioma} (${i.nivell})`).filter(Boolean) || [];

  // Estat de càrrega
  statusLoader.style.display = 'block';
  statusMessageMain.innerHTML = `<strong>L'IA està avaluant el teu "fit" real...</strong>`;
  statusMessageSub.textContent = `Analitzant semàfors de compatibilitat.`;

  contentAnalisi.innerHTML = `
    <div class="text-center py-10">
      <p class="text-secondary italic">Generant dashboard de compatibilitat...</p>
      <div class="status-loader mx-auto mt-4"></div>
    </div>
  `;

  const prompt = `
    Ets un expert en recruiting. Compara aquest perfil amb l'oferta de feina.
    
    PERFIL USUARI:
    - Stack Core: ${userCore.join(', ')}
    - Stack Secundari: ${userSec.join(', ')}
    - No-Go (Vetats): ${userNoGo.join(', ')}
    - Salari Mínim: ${userMinSba} €/any
    - Salari Desitjat: ${userDesitjatSba} €/any
    - Modalitat Preferida: ${userModality}
    - Sectors d'Experiència: ${userSectors.join(', ')}
    - Educació i Certificats: ${userEdu.join(', ')}
    - Idiomes: ${userIdiomes.join(', ')}
    
    OFERTA DE FEINA:
    ${jobText}
    
    Respon EXCLUSIVAMENT amb un objecte JSON amb aquesta estructura EXACTA. Repeteixo: Retorna exclusivament el JSON.
    {
      "no_go": { "status": "green", "resum": "No hi ha vetos.", "user_data": "L'usuari ha vetat: PHP, Ruby", "offer_data": "L'oferta no menciona requisits vetats." },
      "core_matches": { "status": "green", "resum": "Gran coincidència core.", "user_data": "El core és: Java, Angular, SQL", "offer_data": "L'oferta demana extensivament Angular i Java." },
      "secondary_matches": { "status": "amber", "resum": "Coincidència parcial.", "user_data": "Stack secundari: Docker, Kubernetes", "offer_data": "S'esmenta només Docker breument." },
      "ubicacio_modalitat": { "status": "green", "resum": "Modalitat correcte.", "user_data": "Demana 100% Remot.", "offer_data": "L'oferta admet teletreball integral." },
      "salari": { "status": "amber", "resum": "Entre el mínim i desitjat.", "user_data": "El mínim és 40k, el desitjat 55k.", "offer_data": "Rang visible de 45.000€ a 50.000€." },
      "sector": { "status": "green", "resum": "Coincidència de sector informàtic.", "user_data": "Sectors previs: Banca, IT", "offer_data": "És una empresa tecnològica." },
      "educacio": { "status": "green", "resum": "Format adequat.", "user_data": "Enginyeria Informàtica (UPC)", "offer_data": "Es demana Grau en Informàtica." },
      "idiomes": { "status": "green", "resum": "Certificacions suficients.", "user_data": "Anglès (B2), Castellà (Nadiu)", "offer_data": "L'oferta demana anglès alt." }
    }
    
    NOTES LÒGICA (Molt Important):
    1. no_go status: 'amber' si trobes algun veto dins l'oferta, 'green' si no.
    2. core_matches i secondary_matches: Fes match SEMÀNTIC fort ("PMO"="PMO IT"). "status" del core: 'green' si alguna tecnologia core fa match, 'amber' si no.
    3. salari status: 'red' si la franja de l'oferta és estrictament inferior al salari mínim, 'amber' si l'oferta no parla de rang, 'green' si és igual o superior.
    4. educacio status: CONTA rigorosament quantes coincidències hi ha entre el demanat a l'oferta i l'Educació/Certificats de l'usuari. Si l'oferta no demana titulacions o s'hi superen les 2 coincidències: 'green'. Si n'hi ha 1 o 2: 'amber'. Si es demanen títols però no hi ha cap coincidència (0): 'red'.
    5. idiomes status: 'green' si TOTS els idiomes requerits a l'oferta es troben en l'usuari (o si no se'n demana cap). 'amber' si només una part dels sol·licitats coincideixen. 'red' si se'n reclamen explícitament i no hi ha cap coincidència (0).
  `;

  try {
    const onRetry = (retry, total) => {
      updateAiStatus(`Avaluant el teu "fit"... (reintent ${retry}/${total})`);
    };

    const resultText = await callGemini(prompt, onRetry, null, true);

    console.log("---------------- GEMINI RESULT RAW ----------------");
    console.log(resultText);
    console.log("---------------------------------------------------");

    let analysis = {};
    if (typeof resultText === 'object') {
        analysis = resultText;
    } else {
        // Netejar possible markdown del JSON (elimina ```json i ```)
        const cleanText = resultText.replace(/```json/gi, "").replace(/```/g, "").trim();
        const startIndex = cleanText.indexOf('{');
        const endIndex = cleanText.lastIndexOf('}');

        if (startIndex !== -1 && endIndex !== -1) {
          const cleanJson = cleanText.substring(startIndex, endIndex + 1);
          try {
            analysis = JSON.parse(cleanJson);
          } catch (e) {
            console.error("JSON parse failed. Cleaned string was:", cleanJson);
            throw e;
          }
        } else {
          console.error("No JSON braces found in Gemini response.");
          analysis = {};
        }
    }

    renderAnalysisDashboard(analysis);

    // Mostrem el text de l'oferta ja processat a la columna esquerra
    contentOferta.innerHTML = marked.parse(jobText);

    statusLoader.style.display = 'none';
    statusMessageMain.innerHTML = `✔ **Anàlisi de compatibilitat completada**`;
    statusMessageSub.textContent = `Dashboard generat basat en el teu perfil.`;
    updateAiStatus("Anàlisi de compatibilitat completada");
    
    // Guardar darrera anàlisi i actualitzar UI de carta
    currentJobAnalysis = analysis;
    updateCoverLetterUI();
    
    // Habilitar botó de navegació a carta de presentació
    if (btnNavCarta) {
      btnNavCarta.hidden = false;
      btnNavCarta.disabled = false;
      btnNavCarta.style.opacity = '1';
    }

  } catch (err) {
    console.error('Error de Gemini on Job Analysis:', err);
    updateHeaderStatus("amber", "IA No Disponible", err.message);
    
    // Netejar la UI del loader i mostrar l'error de forma visual al panell central
    statusLoader.style.display = 'none';
    statusMessageMain.innerHTML = `<span style="color:red">🔴 IA No Disponible</span>`;
    statusMessageSub.textContent = "Detalls: " + err.message;
    
    showManualPasteUI();
  }
}

function calcularIndicadorGlobal(data) {
  const pesCriteris = {
    no_go: 0.25,
    salari: 0.20,
    ubicacio_modalitat: 0.15,
    core_matches: 0.15,
    idiomes: 0.10,
    secondary_matches: 0.05,
    sector: 0.05,
    educacio: 0.05
  };

  const ptsMap = {
    no_go: { green: 100, amber: 50, red: 0 },
    salari: { green: 100, amber: 60, red: 0 },
    ubicacio_modalitat: { green: 100, amber: 40, red: 0 },
    core_matches: { green: 100, amber: 50, red: 0 },
    idiomes: { green: 100, amber: 50, red: 0 },
    secondary_matches: { green: 100, amber: 50, red: 0 },
    sector: { green: 100, amber: 60, red: 0 },
    educacio: { green: 100, amber: 50, red: 0 }
  };

  let scoreFinal = 0;
  Object.keys(pesCriteris).forEach(k => {
    const item = data[k] || {};
    const status = item.status || 'red';
    const rawVal = ptsMap[k][status] !== undefined ? ptsMap[k][status] : 0;
    scoreFinal += rawVal * pesCriteris[k];
  });
  return Math.round(scoreFinal);
}

function renderAnalysisDashboard(data) {
  const score = calcularIndicadorGlobal(data);

  let html = `
    <div class="global-indicator-card">
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
        <h3 style="margin: 0; color: #333;">Índex de Compatibilitat Global</h3>
        <span style="font-weight: 700; font-size: 1.4rem; color: #1a1a1a;">${score}%</span>
      </div>
      <div class="global-bar-container">
        <div class="global-marker" id="global-score-marker" style="left: 0%;">
          <div class="marker-triangle"></div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #666; margin-top: 8px; margin-bottom: 16px;">
        <span>Descartable</span>
        <span>Potencial</span>
        <span>Ideal</span>
      </div>
      <div style="font-size: 0.8rem; color: #555; background: #eef3f8; padding: 8px 12px; border-radius: 6px; display: flex; align-items: flex-start; gap: 8px; border-left: 3px solid #0a66c2;">
        <span style="font-weight: bold; font-size: 0.9rem;">ℹ️</span>
        <span>Dues execucions consecutives de l'anàlisi de la mateixa oferta poden donar valors de compatibilitat lleugerament diferents per la naturalesa de la IA.</span>
      </div>
    </div>
    <div class="analysis-dashboard">
  `;

  const disclaimers = {
    no_go: "🟢 0 coincidències detectades (neta d'exclusions) | 🟡 Es detecta 1 requisit vetat | 🔴 2 o més requisits vetats detectats",
    core_matches: "🟢 Es detecten més de 2 coincidències amb l'stack Core | 🟡 Es detecten 1 o 2 coincidències | 🔴 No hi ha cap coincidència Core",
    secondary_matches: "🟢 Es detecten més de 2 coincidències amb l'stack Secundari | 🟡 Es detecten 1 o 2 coincidències | 🔴 No hi ha cap coincidència aplicable",
    ubicacio_modalitat: "🟢 Compleix o encaixa amb la teva preferència de mobilitat territorial i teletreball | 🟡 Discrepa de la teva preferència base pactada",
    salari: "🟢 L'oferta arriba o supera el salari desitjat | 🟡 No informat o comprès entre el mínim i el desitjat | 🔴 Inferior al mínim requerit",
    sector: "🟢 L'empresa pertany a un sector on ja tens experiència prèvia | 🟡 Canvi de sector (nou per al teu perfil)",
    educacio: "🟢 Es troben més de dues coincidències (o no se n'exigeix cap) | 🟡 Es troben una o dues coincidències | 🔴 No es troba cap coincidència i se n'exigeixen explícitament",
    idiomes: "🟢 Es compleixen TOTS els idiomes requerits o l'oferta no en demana explícitament | 🟡 S'ha detectat una coincidència parcial | 🔴 Es reclamen idiomes sobre els que no tens coneixement"
  };

  const titleMap = {
    no_go: "Filtres Infranquejables (No-Go)",
    core_matches: "Coincidències Stack Core",
    secondary_matches: "Encaix Stack Secundari",
    ubicacio_modalitat: "Ubicació Territorial i Modalitat",
    salari: "Avaluació Salarial Oferta",
    sector: "Compatibilitat de Sector",
    educacio: "Educació i Certificats (Requerits)",
    idiomes: "Idiomes Requerits"
  };

  const keysToRender = ['no_go', 'core_matches', 'secondary_matches', 'ubicacio_modalitat', 'salari', 'sector', 'educacio', 'idiomes'];

  const pesCriteris = {
    no_go: 25, salari: 20, ubicacio_modalitat: 15, core_matches: 15,
    idiomes: 10, secondary_matches: 5, sector: 5, educacio: 5
  };

  const ptsMap = {
    no_go: { green: 100, amber: 50, red: 0 },
    salari: { green: 100, amber: 60, red: 0 },
    ubicacio_modalitat: { green: 100, amber: 40, red: 0 },
    core_matches: { green: 100, amber: 50, red: 0 },
    idiomes: { green: 100, amber: 50, red: 0 },
    secondary_matches: { green: 100, amber: 50, red: 0 },
    sector: { green: 100, amber: 60, red: 0 },
    educacio: { green: 100, amber: 50, red: 0 }
  };

  keysToRender.forEach(k => {
    const item = data[k] || {};
    const status = item.status || 'red';
    const resum = item.resum || 'Sense informació detectada...';
    const user_data = item.user_data || "Sense dades locals...";
    const offer_data = item.offer_data || "L'oferta no detalla res relacionat.";

    const maxPes = pesCriteris[k] || 0;
    const rawVal = ptsMap[k][status] !== undefined ? ptsMap[k][status] : 0;
    const earnedPes = (rawVal * maxPes) / 100;
    const earnedText = Number.isInteger(earnedPes) ? earnedPes : earnedPes.toFixed(1);

    // El disseny en badge per mostrar el pes
    const weightBadge = `<span style="display:inline-block; background:#eef3f8; color:#0a66c2; padding: 2px 6px; border-radius: 4px; font-size:0.75rem; font-weight:bold; margin-right: 8px;">${earnedText}% / ${maxPes}%</span>`;

    html += `
      <details class="analysis-item">
        <summary class="analysis-summary">
          <div class="analysis-info">
            <p class="analysis-label" style="display:flex; align-items:center;">${weightBadge}${titleMap[k]}</p>
            <p class="analysis-value" style="font-size: 0.9rem; margin-top: 4px;">${resum}</p>
          </div>
          <div class="status-indicator">
            <div class="status-circle ${status}"></div>
          </div>
        </summary>
        <div class="analysis-details">
          <div class="kpi-grid">
            <div class="kpi-column">
              <h5>📍 El Teu Perfil (JSON)</h5>
              <p>${user_data}</p>
            </div>
            <div class="kpi-column">
              <h5>📄 Detalls a l'Oferta</h5>
              <p>${offer_data}</p>
            </div>
          </div>
          <div class="kpi-disclaimer">
            <strong>ℹ️ Regles de mesura d'aquest KPI:</strong> ${disclaimers[k]}
          </div>
        </div>
      </details>
    `;
  });

  html += `</div>`;
  contentAnalisi.innerHTML = html;

  const btnPrint = document.getElementById('btn-imprimir-analisi');
  if (btnPrint) btnPrint.hidden = false;

  // Activar la transició CSS del marcador d'score global amb un petit delay d'1 frame
  setTimeout(() => {
    const marker = document.getElementById('global-score-marker');
    if (marker) {
      marker.style.left = `${score}%`;
    }
  }, 50);
}

function checkProfileStatus() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const hasCv = !!(profile.cvJson && profile.cvJson.trim());
  const hasApiKey = !!(profile.geminiKey && profile.geminiKey.trim());
  
  // Update Ventall Professional Tab State
  if (ventallEmpty && ventallActive) {
    if (hasCv) {
      ventallEmpty.hidden = true;
      ventallActive.hidden = false;
    } else {
      ventallEmpty.hidden = false;
      ventallActive.hidden = true;
      if (ventallResults) ventallResults.hidden = true;
    }
  }
  
  // Verificació de dades de configuració informades (camps base)
  const hasConfig = !!(profile.address && profile.address.trim() && 
                       profile.sbaMin && 
                       profile.modalities && profile.modalities.length > 0);

  // Visibilitat del 'Next Steps' al CV
  if (cvNextStepsContainer) {
    cvNextStepsContainer.hidden = !hasCv;
  }

  // Lògica de l'indicador de la capçalera (user rules)
  if (!hasCv) {
    updateHeaderStatus("amber", "Revisa JSON");
  } else if (!hasConfig) {
    updateHeaderStatus("amber", "Revisa 'El meu CV'");
  } else if (!hasApiKey) {
    updateHeaderStatus("amber", "API key");
  } else {
    updateHeaderStatus("green", "Actiu");
  }

  btnExaminar.disabled = !hasCv || !isValidUrl(inputOfertaUrl.value.trim());
  btnExaminar.title = hasCv ? "" : "Has de generar el teu CV al Perfil primer";
  cvMissingMsg.hidden = hasCv;

  // Refrescar el resum Markdown a la dreta per assegurar sincronització
  if (hasCv && contentCv) {
    contentCv.innerHTML = marked.parse(renderJsonToMarkdown(profile.cvJson));
    const btnPrintCv = document.getElementById('btn-imprimir-cv');
    if (btnPrintCv) btnPrintCv.hidden = false;
  } else {
    const btnPrintCv = document.getElementById('btn-imprimir-cv');
    if (btnPrintCv) btnPrintCv.hidden = true;
  }

  // Mostrar la l'àrea d'entrada si no hi ha resultats visibles
  if (ofertaResults.hidden && ofertaUrlInputArea) {
    ofertaUrlInputArea.hidden = false;
  }

  // Mostrar la targeta d'estat inicial si hi ha CV però encara NO estem analitzant
  if (hasCv && ofertaResults.hidden) {
    ofertaStatusContainer.hidden = false;
    if (analysisControls) analysisControls.hidden = true; // S'amaga per defecte a l'inici
    statusLoader.style.display = 'none'; // Roda aturada
    statusMessageMain.innerHTML = `<strong>Prepara't per l'anàlisi</strong>`;
    statusMessageSub.textContent = `Introdueix una URL i clica "Examinar" per començar.`;
  } else if (!hasCv) {
    ofertaStatusContainer.hidden = true;
    if (analysisControls) analysisControls.hidden = true;
  }
}

function updateHeaderStatus(type, text, tooltipText = "") {
  if (!headerStatusBadge || !headerStatusDot || !headerStatusText) return;
  
  headerStatusText.textContent = text;
  headerStatusBadge.title = tooltipText; // Afegim el tooltip de HTML de tota la vida
  
  if (type === "amber") {
    headerStatusBadge.classList.add('amber');
    headerStatusDot.classList.add('amber');
  } else {
    headerStatusBadge.classList.remove('amber');
    headerStatusDot.classList.remove('amber');
    headerStatusBadge.title = ""; // Netejar tooltip si estem actius
  }
}

function renderJsonToMarkdown(jsonStr) {
  if (!jsonStr) return "_No hi ha dades de CV disponibles._";

  try {
    const data = (typeof jsonStr === 'string') ? JSON.parse(jsonStr) : jsonStr;
    const config = data.configuracio_usuari || data || {};

    // Recuperem el perfil general pel "merge" de dades manuals
    const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');

    const identitat = config.identitat_i_logistica || {};
    const pref = config.preferencies_i_filtres_infranquejables || {};
    const tecnic = config.perfil_tecnic || {};

    // Ubicació (Prioritat a la manual si n'hi ha)
    const manualAddress = profile.address;
    const ubi = identitat.adreça_base || identitat.ubicacio || {};
    let ubiStr = manualAddress || ((typeof ubi === 'string') ? ubi :
      [ubi.carrer_i_numero, ubi.poblacio || ubi.ciutat, ubi.codi_postal].filter(Boolean).join(', '));
    if (!ubiStr) ubiStr = "No especificada";

    let md = `# ${identitat.nom_complet || "Candidat Professional"}\n`;
    md += `**Rol Actual:** ${identitat.rol_actual || "No especificat"}\n`;
    md += `**Ubicació Base:** ${ubiStr}\n\n`;

    md += `## 📝 Resum Professional\n${config.resum_professional || "Sense resum"}\n\n`;

    // MERGE DE PREFERÈNCIES (Manual > JSON)
    const salary = profile.sbaMin || pref.salari_minim_anual || "N/A";
    const desiredSalary = profile.sbaDesitjat || pref.salari_desitjat || "N/A";
    const modality = (profile.modalities?.length > 0) ? profile.modalities.join(', ') : (pref.modalitat_treball?.preferida || "N/A");
    const radius = profile.radius || pref.limits_desplaçament?.distancia_maxima_km || "N/A";
    const commute = profile.commuteTime || "N/A";

    md += `## 🎯 Preferències i Filtres Infranquejables\n`;
    md += `- **Salari Mínim:** ${salary} €/any (Desitjat: ${desiredSalary})\n`;
    md += `- **Modalitat:** ${modality}\n`;
    md += `- **Presencialitat:** Màx. ${profile.maxDays || pref.modalitat_treball?.dies_presencials_maxims_setmana || "0"} dies/setmana\n`;
    md += `- **Mobilitat:** Fins a ${radius} km / ${commute} minuts\n\n`;

    // MERGE DE TAGS (Manual > JSON)
    const coreTags = (profile.coreTags?.length > 0) ? profile.coreTags : (tecnic.stack_core || []);
    const vetoTags = (profile.noGoTags?.length > 0) ? profile.noGoTags : (tecnic.tecnologies_vetades || []);

    md += `## 🛠️ Perfil Tècnic\n`;
    md += `### Stack Principal (Core)\n${coreTags.join(', ') || "N/A"}\n\n`;

    if (tecnic.stack_secundari?.length) {
      md += `### Stack Secundari\n${tecnic.stack_secundari.join(', ')}\n\n`;
    }

    if (vetoTags.length) {
      md += `### 🚫 Tecnologies Vetades (No-Go)\n${vetoTags.join(', ')}\n\n`;
    }

    if (tecnic.idiomes?.length) {
      md += `### 🌐 Idiomes\n`;
      tecnic.idiomes.forEach(l => md += `- **${l.idioma}:** ${l.nivell}\n`);
      md += `\n`;
    }

    if (config.historial_laboral?.length) {
      md += `## 💼 Historial Laboral\n`;
      config.historial_laboral.forEach(exp => {
        md += `### ${exp.carrec} | ${exp.empresa}\n`;
        md += `*${exp.periode} | Sector: ${exp.sector || "N/A"}*\n\n`;

        if (exp.responsabilitats?.length) {
          md += `**Responsabilitats:**\n`;
          exp.responsabilitats.forEach(r => md += `- ${r}\n`);
          md += `\n`;
        }

        if (exp.fites_clau) {
          md += `**🏆 Fita Clau:** ${exp.fites_clau}\n\n`;
        }

        if (exp.stack_utilitzat?.length) {
          md += `**Stack utilitzat:** ${exp.stack_utilitzat.join(', ')}\n\n`;
        }
        md += `---\n\n`;
      });
    }

    const edu = config.educacio_i_certificacions || config.formacio_academica || [];
    if (edu.length) {
      md += `## 🎓 Educació i Certificacions\n`;
      edu.forEach(e => {
        md += `- **${e.titol}** - ${e.institucio || e.centre} (${e.any_finalitzacio || e.any_fi || "Present"})\n`;
      });
    }

    return md;
  } catch (e) {
    console.error("Error renderitzant Markdown:", e);
    return "⚠️ _Error en processar el format del CV JSON. Revisa la consola._";
  }
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + minutes;
}

// ── Debugging Helpers ────────────────────────────────
async function listModels() {
  const key = inputGeminiKey.value.trim();
  if (!key) {
    updateHeaderStatus("amber", "API key", "API Key no trobada");
    return;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1/models?key=${key}`;
  try {
    const response = await fetch(endpoint);
    const data = await response.json();
    console.log('--- Models Disponibles ---');
    console.log(data);
    alert('Models llistats a la consola (F12).');
  } catch (e) {
    console.error('Error llistant models:', e);
  }
}

// ── Exportació PDF / Impressió ──────────────────────────
window.imprimirInforme = function () {
  const ofertaDocs = document.getElementById('content-oferta');
  const analisiDocs = document.getElementById('content-analisi');

  if (!ofertaDocs || !analisiDocs || !analisiDocs.innerHTML.trim()) {
    updateHeaderStatus("amber", "Sense anàlisi", "Primer has de completar l'anàlisi d'una oferta per poder-la imprimir.");
    return;
  }

  const ofertaHTML = ofertaDocs.innerHTML;
  let analisiHTML = analisiDocs.innerHTML;

  // Reemplaçar les etiquetes `<details>` per `<details open>` per forçar-ne l'expansió al print
  analisiHTML = analisiHTML.replace(/<details/g, '<details open');

  const printWindow = window.open('', '_blank');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ca">
      <head>
        <meta charset="UTF-8">
        <title>Informe d'Anàlisi de Compatibilitat</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
          html { font-size: 80%; }
          body { 
            font-family: 'Roboto', Arial, sans-serif; 
            padding: 40px; 
            color: #1a1a1a; 
            line-height: 1.6;
            background: #ffffff;
            max-width: 900px;
            margin: 0 auto;
          }
          h1, h2, h3, h5 { color: #000; margin-bottom: 0.5rem; }
          .oferta-section { 
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px; 
            background: #fdfdfd;
          }
          .analisi-section { margin-top: 20px; }
          .global-indicator-card {
            border: 2px solid #ccc;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 25px;
            background: #fafafa;
          }
          .global-bar-container {
            width: 100%; height: 20px; border-radius: 10px; position: relative;
            background: linear-gradient(to right, #e74c3c 0%, #e74c3c 50%, #f39c12 50%, #f39c12 75%, #2ecc71 75%, #2ecc71 100%);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            margin-top: 15px; margin-bottom: 10px;
          }
          .global-marker { position: absolute; top: -12px; height: 44px; width: 4px; background: #000; transform: translateX(-50%); }
          .marker-triangle { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #000; }

          .analysis-item { border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 8px; display: block; background: #fff; }
          .analysis-summary { list-style: none; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eed; padding-bottom: 10px; margin-bottom: 10px; }
          .analysis-summary::-webkit-details-marker { display: none; }
          .analysis-label { font-weight: bold; font-size: 1.1rem; margin: 0; }
          .kpi-grid { display: flex; gap: 20px; margin-top: 15px; }
          .kpi-column { flex: 1; min-width: 0; }
          .kpi-column p { margin: 0; font-size: 0.95rem; }
          .kpi-disclaimer { margin-top: 15px; background: #f0f0f0; padding: 10px; border-radius: 5px; font-size: 0.85rem; }
          .status-circle { width: 16px; height: 16px; border-radius: 50%; -webkit-print-color-adjust: exact; print-color-adjust: exact;}
          .status-circle.green { background-color: #2ecc71; }
          .status-circle.amber { background-color: #f39c12; }
          .status-circle.red { background-color: #e74c3c; }
          
          /* Ocultar fletxes de Markdown si n'hi ha */
          pre { white-space: pre-wrap; font-family: inherit; }
          @media print {
            body { padding: 0; }
            .analysis-item { page-break-inside: avoid; }
            .global-indicator-card { page-break-after: avoid; }
          }
        </style>
      </head>
      <body>
        <div style="margin-bottom: 20px;">
          <img src="img/logo.jpg" alt="Logo" style="height: 60px; width: auto;">
        </div>
        <h1 style="border-bottom: 2px solid #0a66c2; padding-bottom: 10px; margin-bottom: 30px;">Informe d'Anàlisi d'Oferta</h1>
        
        <h2>Dashboard de Compatibilitat</h2>
        <div class="analisi-section">
          ${analisiHTML}
        </div>

        <h2 style="margin-top: 40px;">Detalls Original de l'Oferta Capturada</h2>
        <div class="oferta-section">
          ${ofertaHTML}
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  // Petit marge perquè els estils CSS incrustats s'apliquin abans de fer pop el Print
  setTimeout(() => {
    printWindow.print();
    // printWindow.close(); // Millor no auto-tancar, l'usuari pot voler revisar o guardar la pestanya
  }, 500);
}

window.imprimirCV = function () {
  const cvDocs = document.getElementById('content-cv');

  if (!cvDocs || !cvDocs.innerHTML.trim()) {
    updateHeaderStatus("amber", "Sense perfil", "No hi ha dades generades per imprimir el CV.");
    return;
  }

  const cvHTML = cvDocs.innerHTML;

  const printWindow = window.open('', '_blank');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ca">
      <head>
        <meta charset="UTF-8">
        <title>Visualització Curricular - Rumb</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
          html { font-size: 80%; }
          body { 
            font-family: 'Roboto', Arial, sans-serif; 
            padding: 40px; 
            color: #1a1a1a; 
            line-height: 1.6;
            background: #ffffff;
            max-width: 900px;
            margin: 0 auto;
          }
          h1, h2, h3, h4, h5 { color: #000; margin-bottom: 0.5rem; margin-top: 1.5rem; }
          h1 { border-bottom: 2px solid #0a66c2; padding-bottom: 10px; margin-bottom: 30px; margin-top: 0; }
          .cv-section { 
            padding: 10px;
          }
          /* Ocultar fletxes de Markdown si n'hi ha */
          pre { white-space: pre-wrap; font-family: inherit; }
          hr { border: 0; height: 1px; background: #ddd; margin: 20px 0; }
          ul { margin-top: 5px; }
          li { margin-bottom: 5px; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div style="margin-bottom: 20px;">
          <img src="img/logo.jpg" alt="Logo" style="height: 60px; width: auto;">
        </div>
        <div class="cv-section">
          ${cvHTML}
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
  }, 500);
}
// ── Cover Letter Logic ──────────────────────────────
async function handleGenerateCoverLetter() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const geminiKey = profile.geminiKey;
  
  if (!geminiKey) {
    updateHeaderStatus("amber", "Falta API Key", "Configura la teva Gemini API Key a la pestanya 'Configuració'.");
    activateTab('configuracio');
    return;
  }

  if (!currentJobAnalysis) {
    updateHeaderStatus("amber", "Sense anàlisi", "Cal fer una anàlisi d'oferta abans de generar la carta.");
    activateTab('examina-oferta');
    return;
  }

  // Estat de càrrega
  btnGenerarCarta.disabled = true;
  btnGenerarCarta.innerHTML = `<span class="spinner-small"></span> Generant...`;
  contentCarta.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 40px;">
      <div class="spinner-medium" style="margin-bottom: 20px;"></div>
      <p style="color: var(--text-secondary); font-weight: 500;">La màgia està succeint... Redactant la teva carta personalitzada.</p>
    </div>
  `;

  try {
    const jobText = document.getElementById('content-oferta').innerText; // El text net de l'oferta
    
    // Recollir configuració
    const config = {
      contacte: btnCheckContacte.classList.contains('active'),
      empresa: btnCheckEmpresa.classList.contains('active'),
      resaltar: btnCheckResaltar.classList.contains('active'),
      formalitat: selectToCarta.options[selectToCarta.selectedIndex].text,
      enfocament: selectEnfocament.options[selectEnfocament.selectedIndex].text,
      longitud: selectLongitud.options[selectLongitud.selectedIndex].text,
      idioma: selectIdioma.options[selectIdioma.selectedIndex].text,
      notes: textareaNotesCarta.value.trim(),
      dataActual: new Date().toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    };

    const prompt = `
      Actua com un Career Coach Senior i Expert en Copywriting Persuasiu.
      LA TEVA TASCA ÉS REDACTAR UNA CARTA DE PRESENTACIÓ LLIMPIDA, PROFESSIONAL I LLESTA PER A SER ENVIADA.

      DADES D'ENTRADA:
      1. PERFIL CANDIDAT (El meu CV): ${JSON.stringify(profile)}
      2. DETALL DE L'OFERTA (Text): ${jobText}
      3. ANÀLISI DE COMPATIBILITAT: ${JSON.stringify(currentJobAnalysis)}
      
      PREFERÈNCIES DE FORMAT I ESTIL:
      - Data d'avui: ${config.dataActual}
      - Idioma del contingut: ${config.idioma}
      - Nivell de formalitat: ${config.formalitat}
      - Enfocament argumental: ${config.enfocament}
      - Longitud desitjada: ${config.longitud}
      - Dades de l'Usuari (Remitent): ${config.contacte ? "SÍ (Inclou el meu nom, email i dades de contacte si estan disponibles al perfil)" : "NO"}
      - Dades de l'Empresa (Destinatari): ${config.empresa ? "SÍ (Busca a l'oferta el nom de l'empresa, adreça o responsable de selecció i inclou-los. Si no hi són o són genèrics, ignora-ho)" : "NO"}
      - Resaltar conceptes clau: ${config.resaltar ? "SÍ (Resalta en negreta —**paraula**— aquells conceptes, eines o habilitats realment crítics per a la posició, però FES-HO AMB MODERACIÓ, sense abusar)" : "NO"}
      - Notes addicionals de l'usuari: ${config.notes || "Cap"}

      INSTRUCCIONS CRÍTIQUES (IMPORTANT):
      - Genera SEMPRE el contingut amb un format Markdown clar i estructurat (fent servir encapçalaments, paràgrafs ben definits i llistes si cal).
      - NO incloguis cap tipus de consell, nota, explicació o "placeholder" tipus "[Insereix aquí la teva experiència]".
      - Si demano incloure la data, inclou exactament: ${config.dataActual} a la capçalera (o la seva traducció a l'idioma de la carta).
      - La carta ha d'estar redactada de principi a fi, de manera que l'usuari només l'hagi de revisar i copiar.
      - Sigues natural, evita clixés d'Intel·ligència Artificial i paraules buides.
      - PROHIBICIÓ DE PARAULES: No utilitzis paraules com "entusiasme", "emoció", "apassionat" o adjectius buits similars que sonin a tòpic d'IA.
      - TONALITAT: Evita l'excés de triumfalisme o un to excessivament corporatiu-irreal. Sigues professional, sobri i basat en dades/fets (proposta de valor real dels KPIs).
      - L'objectiu és destacar com els punts forts detectats a l'anàlisi (KPIs) encaixen amb l'oferta de forma pragmàtica.
      - Entrega el contingut EXCLUSIVAMENT en format Markdown pur, sense comentaris previs ni posteriors.
    `;

    const onRetry = (retry, total) => {
      updateAiStatus(`Redactant la carta... (reintent ${retry}/${total})`);
    };

    updateAiStatus("Redactant la teva carta personalitzada...");
    const resultText = await callGemini(prompt, onRetry);

    // Renderitzar i netejar
    contentCarta.innerHTML = marked.parse(resultText);
    btnCopiarCarta.disabled = false;
    btnImprimirCarta.disabled = false;
    updateAiStatus("Carta generada amb èxit!");

  } catch (err) {
    console.error('Error generant carta:', err);
    const errorMsg = err?.message || "S'ha produït un error inesperat a la IA.";
    updateHeaderStatus("amber", "IA No Disponible", errorMsg);
    contentCarta.innerHTML = `<p style="color:red; padding: 20px;">🔴 Error al generar la carta: ${errorMsg}</p>`;
  } finally {
    btnGenerarCarta.disabled = false;
    btnGenerarCarta.innerHTML = `Generar Carta de Presentació ✨`;
  }
}

async function copyCoverLetterToClipboard() {
  const text = contentCarta.innerText;
  try {
    await navigator.clipboard.writeText(text);
    const originalText = btnCopiarCarta.innerHTML;
    btnCopiarCarta.innerHTML = `✅ Copiat!`;
    setTimeout(() => {
      btnCopiarCarta.innerHTML = originalText;
    }, 2000);
  } catch (err) {
    console.error('Error al copiar:', err);
  }
}

window.imprimirCarta = function () {
  const content = document.getElementById('content-carta');

  if (!content || !content.innerHTML.trim() || content.innerHTML.includes('Selecciona el to')) {
    updateHeaderStatus("amber", "Sense contingut", "Primer has de generar una carta per imprimir-la.");
    return;
  }

  const cartaHTML = content.innerHTML;

  const printWindow = window.open('', '_blank');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ca">
      <head>
        <meta charset="UTF-8">
        <title>Carta de Presentació - Rumb</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
          body { 
            font-family: 'Roboto', Arial, sans-serif; 
            padding: 40px; 
            color: #1a1a1a; 
            line-height: 1.6;
            background: #ffffff;
            max-width: 800px;
            margin: 0 auto;
          }
          h1, h2, h3, h4, h5 { color: #000; margin-bottom: 0.5rem; margin-top: 1.5rem; }
          p { margin-bottom: 12px; }
          ul, ol { margin-bottom: 16px; padding-left: 20px; }
          li { margin-bottom: 6px; }
          .carta-section { padding: 10px; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div style="margin-bottom: 20px;">
          <img src="img/logo.jpg" alt="Logo" style="height: 60px; width: auto;">
        </div>
        <div class="carta-section">
          ${cartaHTML}
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
  }, 500);
}
