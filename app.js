/* ===================================================
   Rumb – App Logic
   =================================================== */

'use strict';

// ── Configuration & State ───────────────────────────
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DB_NAME = 'LinkedInAssistantDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

let db;
let analysisAbortController = null;

/**
 * Helper per fer crides a Gemini amb suport de reintents (Exponential Backoff).
 * Útil per gestionar errors 503 (High Demand) i 429 (Rate Limit).
 */
async function fetchGeminiWithRetry(url, options, maxRetries = 3, initialDelay = 1000, onRetry = null, signal = null) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    // Si la petició s'ha avortat, sortim immediatament
    if (signal && signal.aborted) throw new Error('AbortError');

    try {
      const fetchOptions = signal ? { ...options, signal } : options;
      const response = await fetch(url, fetchOptions);
      
      // Si la resposta és OK, la retornem directament
      if (response.ok) return response;

      // Si l'error és 503 (High Demand) o 429 (Rate Limit), intentem reintentar
      if (response.status === 503 || response.status === 429) {
        const delay = initialDelay * Math.pow(2, i);
        if (onRetry) onRetry(i + 1, maxRetries);
        console.warn(`Gemini API ocupada (${response.status}). Reintentant en ${delay}ms... (Intent ${i + 1}/${maxRetries})`);
        
        // Espera amb suport per a cancel·lació
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

      // Per a altres errors (400, 401, 404, etc.), no reintentem i llancem l'error
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody.error?.message || `Error ${response.status}`;
      throw new Error(`Gemini API Error: ${message}`);

    } catch (err) {
      lastError = err;
      // Si és un error de xarxa (fetch failed), també podem reintentar
      if (err.name === 'TypeError' || err.message.includes('fetch')) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Error de xarxa. Reintentant en ${delay}ms... (Intent ${i + 1}/${maxRetries})`);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      throw err; // Si és un error de línia de codi o lògica, llancem
    }
  }
  throw lastError;
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
const ocupacionsLoaderText = document.getElementById('ocupacions-loader-text');
const btnStopOcupacions = document.getElementById('btn-stop-ocupacions');

// ── State Management ────────────────────────────────
let originalProfileData = {};
let stagedCvFile = null;
let isAnalysingCv = false; // To track if we're in the middle of IA analysis
let currentJobAnalysis = null; // Store latest analysis for cover letter generation

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

    updateProgress(60, 'Generant anàlisi experta amb Gemini IA...');

    const jsonResult = await callGeminiAPI(apiKey, rawText, (retryCount, total) => {
      updateProgress(60, `Generant anàlisi experta amb Gemini IA... (reintent de connexió IA ${retryCount}/${total})`);
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

    updateProgress(100, 'Anàlisi completada amb èxit!');
    setTimeout(() => progressContainer.hidden = true, 3000);

  } catch (err) {
    if (err.message === 'AbortError' || err.name === 'AbortError') {
       console.log("Anàlisi aturada per l'usuari.");
       return;
    }
    console.error('Error en l\'anàlisi:', err);
    updateProgress(0, 'Error: ' + err.message);
    updateHeaderStatus("amber", "Error d'anàlisi", err.message);
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

  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`;

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
    - Dies presencials màxims per setmana: ${userSettings.maxDiesPresencials}
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
            "dies_presencials_maxims_setmana": (int: ${userSettings.maxDiesPresencials}),
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
          "skills": ["Aquest camp és la suma de tots els 'skills_experiencia' de l'historial laboral."],
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
            "skills_experiencia": ["Conceptes que donin informació sobre skills necessaris o usats. Ex: 'gestió de riscos', 'gestió d'equips', 'arquitectura microserveis'."],
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

  const response = await fetchGeminiWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  }, 3, 1000, onRetry, signal);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error?.message || 'Error desconegut de l\'API.';
    throw new Error(`Error de Gemini: ${message}`);
  }

  const data = await response.json();
  try {
    const jsonStr = data.candidates[0].content.parts[0].text;
    // Netegem possibles blocs de codi markdown si el model els ha inclòs per error
    const cleanedJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJson);
  } catch (e) {
    throw new Error('No s\'ha pogut parsejar la resposta de la IA com a JSON.');
  }
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
    if (ocupacionsLoaderText) ocupacionsLoaderText.innerHTML = "Connectant amb l'eina intel·ligent i perfilant l'historial...";
    ventallResults.hidden = true;

    const cvData = JSON.parse(profile.cvJson);
    const conf = cvData.configuracio_usuari || cvData;
    
    // 1. Dades per al Prompt d'Ocupacions
    const rolActual = conf.identitat_i_logistica?.rol_actual || '';
    const resumProf = conf.resum_professional || '';
    let carrecs = [];
    if (conf.historial_laboral && Array.isArray(conf.historial_laboral)) {
      carrecs = conf.historial_laboral.map(h => h.carrec).filter(c => c);
    }
    
    const promptData = `
Rol actual: ${rolActual}
Resum professional: ${resumProf}
Experiència (càrrecs previs): ${carrecs.join(', ')}
    `;

    const promptOcupacions = `Actua com un expert europeu en el mercat laboral i la classificació ESCO (European Skills, Competences, Qualifications and Occupations).
Llegeix el següent perfil d'un candidat i retorna un array de fins a 8 ocupacions professionals potencials estandarditzades (idealment els noms exactes o molt propers que es farien servir a la base de dades ESCO en anglès - EN) que s'adaptin a aquest perfil per utilitzar en una cerca d'API posterior. Noms curts i clars.
Perfil:
${promptData}
Respon EXCLUSIVAMENT amb un array en format JSON, on cada element és una string amb el títol de l'ocupació en anglès.
Exemple: ["software developer", "ICT project manager", "data engineer", "data analyst", "system administrator"]`;

    // 2. Dades per al Prompt de Skills (Diccionari Usuari)
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

    const skillsPromptData = `
Primary Technical & Professional Skills: ${(skillsConsolidades.concat(stackCore)).join(', ')}
Secondary & Applied Skills: ${(stackSecundari.concat(stackExp)).join(', ')}
Idiomes: ${idiomes.join(', ')}
Educació/Certificacions: ${educacio.join(', ')}
    `;

    const promptSkills = `Actua com un expert en anàlisi de perfils professionals i ontologies ESCO.
Llegeix la llista de dades del candidat (tecnologies, habilitats de reclutament, idiomes i educació). La teva missió és TRADUIR, NORMALITZAR i MAPAR cadascun d'aquests conceptes a la terminologia d'habilitats de la base de dades ESCO (en anglès, en minúscules).
És absolutament crític que NO OMETIS ni resumeixis cap concepte introduït. Cada habilitat, incloses les "soft skills" (ex: "Interlocució amb clients", "Gestió de conflictes"), s'ha d'incloure amb l'equivalent ESCO adient (ex: "client communication", "customer relationship management", "conflict management").
Pots incloure sinònims o termes relacionats per maximitzar les probabilitats de 'match'. Genera un array molt ampli (entre 80 i 120 termes) per cobrir exhaustivament el perfil. Suprimeix els hashtags (#).
Dades del candidat:
${skillsPromptData}
Respon EXCLUSIVAMENT amb un array en format JSON, on cada element és una string de l'habilitat.
Exemple: ["agile methodologies", "project management", "javascript", "scrum", "client communication", "manage customer service", "conflict resolution"]`;

    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Llançar totes dues peticions a l'hora amb suport de reintents i signal
    const pOccupations = fetchGeminiWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptOcupacions }] }] })
    }, 3, 1000, null, signal).then(r => r.json());

    const pSkillsDict = fetchGeminiWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptSkills }] }] })
    }, 3, 1000, null, signal).then(r => r.json());

    const [occData, skillsDictData] = await Promise.all([pOccupations, pSkillsDict]);

    if (ocupacionsLoaderText) ocupacionsLoaderText.innerHTML += " ✓<br>Interpretant perfil ESCO recomanat...";

    const occJsonStr = occData.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    const ocupacionsArray = JSON.parse(occJsonStr);

    const skillsDictJsonStr = skillsDictData.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    const userSkillsDictionary = JSON.parse(skillsDictJsonStr).map(s => s.toLowerCase());

    if (ocupacionsLoaderText) ocupacionsLoaderText.innerHTML += " ✓<br>Creuant perfils amb la base de dades europea (0 de "+ocupacionsArray.length+")...";

    // Obtenir els detalls ESCO de cada ocupació
    let escoCallsCompleted = 0;
    const ocupacionsAmbSkills = await Promise.all(ocupacionsArray.map(async (ocDesc) => {
        const urlSearch = `https://ec.europa.eu/esco/api/search?text=${encodeURIComponent(ocDesc)}&type=occupation&language=en&limit=1`;
        try {
            const rSearch = await fetch(urlSearch, { signal });
            if (!rSearch.ok) return { titol: ocDesc, skills: [], hasError: true, errorMsg: 'Error en la cerca (ESCO API)' };
            
            const searchData = await rSearch.json();
            if (!searchData._embedded || searchData._embedded.results.length === 0) return { titol: ocDesc, skills: [] };
            
            const uri = searchData._embedded.results[0].uri;
            const titleEsco = searchData._embedded.results[0].title;
            const urlResource = `https://ec.europa.eu/esco/api/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`;
            
            const rRes = await fetch(urlResource, { signal });
            if (!rRes.ok) return { titol: titleEsco || ocDesc, skills: [], hasError: true, errorMsg: 'Error en detall (ESCO API)' };
            
            const resData = await rRes.json();
            let skills = [];
            if (resData._links && resData._links.hasEssentialSkill) {
               skills.push(...resData._links.hasEssentialSkill.map(s => ({ ...s, isEssential: true })));
            }
            if (resData._links && resData._links.hasOptionalSkill) {
               skills.push(...resData._links.hasOptionalSkill.map(s => ({ ...s, isEssential: false })));
            }
            
            escoCallsCompleted++;
            if (ocupacionsLoaderText) ocupacionsLoaderText.innerHTML = ocupacionsLoaderText.innerHTML.replace(/\([0-9]+ de [0-9]+\)\.\.\./, `(${escoCallsCompleted} de ${ocupacionsArray.length})...`);
            
            return { titol: titleEsco || ocDesc, skills };
        } catch (e) {
            console.error('Error ESCO:', e);
            escoCallsCompleted++;
            return { titol: ocDesc, skills: [], hasError: true, errorMsg: 'Error de connexió amb ESCO' };
        }
    }));

    renderOcupacions(ocupacionsAmbSkills, userSkillsDictionary, ocupacionsArray);
    ventallResults.hidden = false;

    // Reset abort controller on success
    analysisAbortController = null;

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
        <span><strong>Error d'anàlisi:</strong> ${err.message || 'No s\'ha pogut processar la informació. Revisa la teva connexió o la clau d\'API.'}</span>
      </div>
    `;
  } finally {
    btnGenerarOcupacions.disabled = false;
    ocupacionsLoader.style.display = 'none';
  }
}

function processSkillElement(sk, userSkillsDictionary) {
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
  
  const skMatchName = (sk.title || '').toLowerCase();
  const matchedUsrSk = userSkillsDictionary.find(usrSk => skMatchName.includes(usrSk) || usrSk.includes(skMatchName));
  const isMatch = !!matchedUsrSk;
  
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

function renderOcupacions(ocupacionsAmbSkills, userSkillsDictionary, diccionariOcupacionsStrArray) {
  if (!llistaOcupacions) return;
  llistaOcupacions.innerHTML = '';
  
  if (diccionariOcupacionsText) {
    diccionariOcupacionsText.textContent = JSON.stringify(diccionariOcupacionsStrArray, null, 2);
  }
  if (diccionariSkillsText) {
    diccionariSkillsText.textContent = JSON.stringify(userSkillsDictionary, null, 2);
  }
  
  if (!Array.isArray(ocupacionsAmbSkills) || ocupacionsAmbSkills.length === 0) {
    llistaOcupacions.innerHTML = '<p style="color: var(--text-secondary);">No s\'han trobat ocupacions clares per a aquest perfil.</p>';
  } else {
    // 1. Helper per a colors de percentatges
    const getPctColor = (match, total) => {
      if (total === 0) return { bg: '#f1f3f4', text: '#5f6368', pct: 'N/A' };
      const pct = Math.round((match / total) * 100);
      if (pct > 50) return { bg: '#e6f4ea', text: '#137333', pct: pct + '%' };
      if (pct >= 20) return { bg: '#fef7e0', text: '#b06000', pct: pct + '%' };
      return { bg: '#fce8e6', text: '#c5221f', pct: pct + '%' };
    };

    // 2. Càlcul de totals globals (ponderat/proporcional)
    let globalEssMatch = 0, globalEssTotal = 0;
    let globalOptMatch = 0, globalOptTotal = 0;

    ocupacionsAmbSkills.forEach(ocObj => {
      if (ocObj.hasError) return;
      const essT = (ocObj.skills || []).filter(sk => sk.isEssential).length;
      const essM = (ocObj.skills || []).filter(sk => sk.isEssential && userSkillsDictionary.some(usrSk => (sk.title || '').toLowerCase().includes(usrSk) || usrSk.includes((sk.title || '').toLowerCase()))).length;
      const optT = (ocObj.skills || []).filter(sk => !sk.isEssential).length;
      const optM = (ocObj.skills || []).filter(sk => !sk.isEssential && userSkillsDictionary.some(usrSk => (sk.title || '').toLowerCase().includes(usrSk) || usrSk.includes((sk.title || '').toLowerCase()))).length;
      
      globalEssMatch += essM; globalEssTotal += essT;
      globalOptMatch += optM; globalOptTotal += optT;
    });

    // 3. Render Resum Global
    const gEss = getPctColor(globalEssMatch, globalEssTotal);
    const gOpt = getPctColor(globalOptMatch, globalOptTotal);

    const globalCard = document.createElement('div');
    globalCard.className = 'global-summary-card';
    globalCard.style.cssText = 'padding: 24px; background: var(--li-blue-faint); border-radius: var(--radius-lg); border: 1px solid var(--li-blue-light); margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 20px;';
    
    globalCard.innerHTML = `
      <div style="flex: 1;">
        <h4 style="margin: 0 0 12px 0; font-size: 1.2rem; color: var(--li-blue); font-weight: 700; line-height: 1.3;">Assoliment global del teu perfil professional amb la BBDD ESCO</h4>
        <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
          <div style="font-size: 1rem; color: var(--text-primary);"><strong>Essencials:</strong> <span style="margin-left:6px; padding: 4px 12px; border-radius: 20px; background: ${gEss.bg}; color: ${gEss.text}; font-weight: 700;">${gEss.pct}</span></div>
          <div style="font-size: 1rem; color: var(--text-primary);"><strong>Opcionals:</strong> <span style="margin-left:6px; padding: 4px 12px; border-radius: 20px; background: ${gOpt.bg}; color: ${gOpt.text}; font-weight: 700;">${gOpt.pct}</span></div>
        </div>
      </div>
      <div style="flex-shrink: 0;">
        <button id="btn-global-improvements" class="primary-btn" style="white-space: nowrap;">Millores globals del teu CV</button>
      </div>
    `;

    const globalResponseBox = document.createElement('div');
    globalResponseBox.style.cssText = 'display: none; flex-direction: column; gap: 8px; padding: 16px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 24px;';
    
    llistaOcupacions.appendChild(globalCard);
    llistaOcupacions.appendChild(globalResponseBox);

    const btnGlobalImprovements = globalCard.querySelector('#btn-global-improvements');
    btnGlobalImprovements.addEventListener('click', async () => {
        btnGlobalImprovements.disabled = true;
        btnGlobalImprovements.innerHTML = '<span class="status-loader" style="width: 14px; height: 14px; border-width: 2px;"></span> Analitzant...';
        
        globalResponseBox.style.display = 'flex';
        globalResponseBox.innerHTML = '<p style="color: var(--text-secondary); text-align: center; font-style: italic;">L\'IA està analitzant la teva estratègia professional per a totes les ocupacions...</p>';
        
        try {
            const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
            let conf = {};
            try {
                const par = JSON.parse(profile.cvJson || '{}');
                conf = par.configuracio_usuari || par;
            } catch (e) {}

            const userHistorial = JSON.stringify(conf.historial_laboral || []);
            const userResum = conf.perfil_tecnic?.resum_professional || conf.resum_professional || "No especificat";
            const currentOcupacions = ocupacionsAmbSkills.map(oc => oc.titol).join(', ');

            const prompt = `Ets un expert en recruiting i orientador de recerca de feina directe i objectiu. Absten-te d'afalacs innecessaris.
El candidat té la següent llista d'ocupacions potencials identificades: ${currentOcupacions}.

Aquest és el seu Resum Professional:
${userResum}

I aquest és el seu historial laboral (empreses, responsabilitats i descripcions):
${userHistorial}

LA TEVA MISSIÓ:
Analitza el perfil del candidat i proporciona propostes de millora generals i estratègiques ESTRUCTURADES OCUPACIÓ PER OCUPACIÓ (per a cadascuna de les llistades).
No t'enfrontis a una anàlisi skill a skill. En lloc d'això, explica com el candidat ha de presentar la seva experiència o quina mentalitat/enfocament ha d'adoptar per ser un candidat d'èxit en cadascuna d'aquestes línies professionals.

Respon utilitzant format Markdown. Sigues extremadament concís i directe. El resultat global no pot excedir les 500 paraules.`;

            const apiKey = inputGeminiKey.value.trim();
            const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            
            const response = await fetchGeminiWithRetry(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const respObj = await response.json();
            const markdownText = respObj.candidates[0].content.parts[0].text;

            const disclaimerText = 'ℹ️ Dues consultes consecutives de millora del teu CV poden generar resultats lleugerament diferents. Contrasta els consells de la IA amb la teva propia experiència i criteri professionals.';
            
            globalResponseBox.innerHTML = `
                <div class="ia-response-content markdown-body" style="font-size: 0.9rem;">${marked.parse(markdownText)}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: left; font-style: italic; margin-top: 12px; padding-bottom: 8px; border-bottom: 1px solid #e1e3e8; opacity: 0.9;">${disclaimerText}</div>
                <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
                  <button id="btn-print-global" class="secondary-btn compact" style="gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    Imprimir informe global
                  </button>
                </div>
            `;

            // Lògica per imprimir l'informe global
            const btnPrintGlobal = globalResponseBox.querySelector('#btn-print-global');
            btnPrintGlobal.addEventListener('click', () => {
                const occItems = ocupacionsAmbSkills.map(o => `<li style="margin-bottom:4px; text-transform:capitalize;">${o.titol}</li>`).join('');
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html lang="ca">
                      <head>
                        <meta charset="UTF-8">
                        <title>Informe d'Estratègia Professional</title>
                        <style>
                          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
                          body { font-family: 'Roboto', sans-serif; padding: 40px; line-height: 1.6; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
                          h1, h2, h3, h4 { color: #0a66c2; margin-bottom: 0.6rem; margin-top: 1.5rem; }
                          p { margin-bottom: 12px; }
                          ul, ol { margin-bottom: 16px; padding-left: 20px; }
                          .markdown-body { font-size: 14px; }
                          .occ-list { background: #f0f4f8; border: 1px solid #d1d9e0; padding: 20px; border-radius: 8px; list-style-type: square; margin-bottom: 24px; }
                          .disclaimer { font-size: 11px; color: #666; margin-top: 40px; padding-top: 15px; border-top: 1px solid #eee; font-style: italic; }
                          @media print { body { padding: 0; } }
                        </style>
                      </head>
                      <body>
                        <div style="margin-bottom: 20px;">
                          <img src="img/logo.jpg" alt="Logo" style="height: 60px; width: auto;">
                        </div>
                        <h1>Rumb – Estratègia Professional Global</h1>
                        <p>Aquest informe recull l'anàlisi agregada del teu perfil respecte a les oportunitats de mercat identificades.</p>
                        
                        <h3>1. Ocupacions Potencials Identificades</h3>
                        <ul class="occ-list">
                          ${occItems}
                        </ul>

                        <h3>2. Recomanacions Estratègiques de l'IA</h3>
                        <div class="markdown-body">
                          ${marked.parse(markdownText)}
                        </div>

                        <div class="disclaimer">
                          ${disclaimerText}
                        </div>
                      </body>
                    </html>
                `);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => { printWindow.print(); }, 500);
            });

        } catch (err) {
            globalResponseBox.innerHTML = `<p style="color:#d11124; font-weight:bold;">Error analitzant amb l'IA: ${err.message}</p>`;
        } finally {
            btnGlobalImprovements.innerHTML = 'Millores globals del teu CV';
            btnGlobalImprovements.disabled = false;
        }
    });

    // 4. Render Ocupacions Individuals
    ocupacionsAmbSkills.forEach(ocObj => {
      // Calcular coincidències per al resum de la capçalera
      const matchedData = (ocObj.skills || []).map(sk => {
          const skName = (sk.title || '').toLowerCase();
          const match = userSkillsDictionary.find(usrSk => skName.includes(usrSk) || usrSk.includes(skName));
          return match ? { title: sk.title, userSkill: match } : null;
      }).filter(Boolean);

      const matchCount = matchedData.length;
      const matchNames = matchedData.slice(0, 3).map(m => m.title).join(', ');
      const matchSummary = ocObj.hasError 
          ? `⚠️ ${ocObj.errorMsg}`
          : (matchCount > 0 
              ? `${matchCount} coincidències (${matchNames}${matchCount > 3 ? '...' : ''})` 
              : 'Sense coincidències directes');

      const card = document.createElement('div');
      card.style.cssText = 'padding: 16px; background: var(--bg-body); border-radius: var(--radius-md); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 0; margin-bottom: 12px;';
      
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; cursor: pointer; user-select: none; transition: all 0.2s ease; gap: 16px;';
      header.className = 'card-header-toggle';
      
      const titleArea = document.createElement('div');
      titleArea.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 1;';

      const titleLine = document.createElement('div');
      titleLine.style.cssText = 'display: flex; align-items: center; gap: 12px;';

      const essentialTotal = (ocObj.skills || []).filter(sk => sk.isEssential).length;
      const essentialMatch = (ocObj.skills || []).filter(sk => sk.isEssential && userSkillsDictionary.some(usrSk => (sk.title || '').toLowerCase().includes(usrSk) || usrSk.includes((sk.title || '').toLowerCase()))).length;
      const optionalTotal = (ocObj.skills || []).filter(sk => !sk.isEssential).length;
      const optionalMatch = (ocObj.skills || []).filter(sk => !sk.isEssential && userSkillsDictionary.some(usrSk => (sk.title || '').toLowerCase().includes(usrSk) || usrSk.includes((sk.title || '').toLowerCase()))).length;

      const essConf = getPctColor(essentialMatch, essentialTotal);
      const optConf = getPctColor(optionalMatch, optionalTotal);

      const badgesColumn = document.createElement('div');
      badgesColumn.style.cssText = 'display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;';

      // Només afegim els badges si no és un error de l'API completa
      if (!ocObj.hasError) {
          badgesColumn.innerHTML = `
            <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: ${essConf.bg}; color: ${essConf.text}; font-weight: bold; text-align: center;" title="Match Skills Essencials">ESN: ${essConf.pct}</span>
            <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: ${optConf.bg}; color: ${optConf.text}; font-weight: bold; text-align: center;" title="Match Skills Opcionals">OPC: ${optConf.pct}</span>
          `;
      }
      
      titleLine.appendChild(badgesColumn);

      const title = document.createElement('span');
      title.style.cssText = 'font-weight: 600; font-size: 1.1rem; color: var(--text-primary); text-transform: capitalize; line-height: 1.2;';
      title.textContent = ocObj.titol;

      titleLine.appendChild(title);
      
      const infoSub = document.createElement('span');
      infoSub.style.cssText = 'font-size: 0.8rem; color: var(--li-blue); font-weight: 500; margin-top: 2px;';
      infoSub.textContent = matchSummary;

      titleArea.appendChild(titleLine);
      titleArea.appendChild(infoSub);

      const chevronContainer = document.createElement('div');
      chevronContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; color: var(--text-secondary); padding-top: 4px;';
      
      const chevron = document.createElement('span');
      chevron.style.cssText = 'transition: transform 0.3s ease; display: flex; align-items: center;';
      chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

      chevronContainer.appendChild(chevron);
      header.appendChild(titleArea);
      header.appendChild(chevronContainer);
      card.appendChild(header);

      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = 'display: none; flex-direction: column; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); overflow: hidden;';

      if (ocObj.skills && ocObj.skills.length > 0) {
          // Ordenar els skills perquè les coincidències apareguin sempre primer
          ocObj.skills.sort((a, b) => {
              const aName = (a.title || '').toLowerCase();
              const bName = (b.title || '').toLowerCase();
              const aMatch = userSkillsDictionary.some(usrSk => aName.includes(usrSk) || usrSk.includes(aName));
              const bMatch = userSkillsDictionary.some(usrSk => bName.includes(usrSk) || usrSk.includes(bName));
              
              if (aMatch && !bMatch) return -1;
              if (!aMatch && bMatch) return 1;
              
              // A igualtat de match, preferim els essencials primers
              if (a.isEssential && !b.isEssential) return -1;
              if (!a.isEssential && b.isEssential) return 1;
              
              return 0;
          });

          // --- Inici Millora el teu CV ---
          const improvementContainer = document.createElement('div');
          improvementContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;';
          
          const headerImp = document.createElement('div');
          headerImp.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';
          
          const btnPrint = document.createElement('button');
          btnPrint.className = 'secondary-btn compact';
          btnPrint.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Imprimir`;
          btnPrint.style.display = 'none'; // ocult inicialment
          headerImp.appendChild(btnPrint);

          const btnMillora = document.createElement('button');
          btnMillora.className = 'secondary-btn compact';
          btnMillora.innerHTML = `Millora el teu CV ✨`;
          headerImp.appendChild(btnMillora);

          const responseBox = document.createElement('div');
          responseBox.style.cssText = 'display: none; flex-direction: column; gap: 8px; padding: 16px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; line-height: 1.5; color: var(--text-primary);';

          const disclaimerText = 'ℹ️ Dues consultes consecutives de millora del teu CV poden generar resultats lleugerament diferents. Contrasta els consells de la IA amb la teva propia experiència i criteri professionals.';

          btnPrint.addEventListener('click', (e) => {
              e.stopPropagation();
              const printContent = responseBox.querySelector('.ia-response-content');
              if (!printContent) return;

              const skillsHTML = (ocObj.skills || []).map(sk => {
                  const skName = sk.title || '';
                  const match = userSkillsDictionary.some(usrSk => skName.toLowerCase().includes(usrSk) || usrSk.includes(skName.toLowerCase()));
                  const icon = match ? '✅' : '❌';
                  const type = sk.isEssential ? 'Ess' : 'Opc';
                  return `<div style="margin-bottom: 1px; border-bottom: 1px solid #f1f3f4; padding-bottom: 1px; display: flex; align-items: center; gap: 6px; line-height: 1.1;">
                            <span>${icon}</span>
                            <span style="font-weight: 500;">${skName}</span>
                            <span style="color:#666; font-size:0.8em; margin-left: auto;">(${type})</span>
                          </div>`;
              }).join('');

              const printWindow = window.open('', '_blank');
              printWindow.document.write(`
                <!DOCTYPE html>
                <html lang="ca">
                  <head>
                    <meta charset="UTF-8">
                    <title>Anàlisi Ocupació: ${ocObj.titol}</title>
                    <style>
                      @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
                      body { font-family: 'Roboto', sans-serif; padding: 40px; line-height: 1.6; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
                      h1, h2, h3, h4 { color: #0a66c2; margin-bottom: 0.5rem; margin-top: 1.5rem; }
                      p { margin-bottom: 12px; }
                      ul, ol { margin-bottom: 16px; padding-left: 20px; }
                      .markdown-body { font-size: 14px; }
                      .disclaimer { font-size: 11px; color: #666; margin-top: 20px; padding-top: 10px; border-top: 1px solid #eee; font-style: italic; }
                      @media print { body { padding: 0; } }
                    </style>
                  </head>
                  <body>
                    <div style="margin-bottom: 20px;">
                      <img src="img/logo.jpg" alt="Logo" style="height: 60px; width: auto;">
                    </div>
                    <h2>Anàlisi de l'Ocupació: ${ocObj.titol}</h2>
                    
                    <div style="margin-bottom: 20px; padding: 16px; background: #f0f4f8; border-radius: 6px; font-size: 1.1rem;">
                      <div style="margin-bottom: 8px;"><strong>Assoliment Essencials:</strong> <span style="color: ${essConf.text};">${essConf.pct}</span></div>
                      <div><strong>Assoliment Opcionals:</strong> <span style="color: ${optConf.text};">${optConf.pct}</span></div>
                    </div>
                    
                    <h3>1. Diccionari d'Habilitats ESCO per l'ocupació</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin-bottom: 15px; font-size: 0.82rem;">
                      ${skillsHTML}
                    </div>

                    <h3>2. Suggeriments de millora del CV (IA)</h3>
                    <div class="markdown-body" style="padding: 20px; background: #fff; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      ${printContent.innerHTML}
                    </div>
                    <div class="disclaimer">
                      ${disclaimerText}
                    </div>
                  </body>
                </html>
              `);
              printWindow.document.close();
              printWindow.focus();
              setTimeout(() => { printWindow.print(); }, 500);
          });

          btnMillora.addEventListener('click', async (e) => {
              e.stopPropagation();
              btnPrint.style.display = 'none';
              btnMillora.disabled = true;
              btnMillora.innerHTML = '<span class="status-loader" style="width: 14px; height: 14px; border-width: 2px;"></span> Analitzant...';
              
              responseBox.style.display = 'flex';
              responseBox.innerHTML = '<p style="color: var(--text-secondary); text-align: center; font-style: italic;">Consultant Gemini sobre com justificar aquestes competències...</p>';
              
              try {
                  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
                  let conf = {};
                  try {
                      const par = JSON.parse(profile.cvJson || '{}');
                      conf = par.configuracio_usuari || par;
                  } catch (e) {}

                  const userHistorial = JSON.stringify(conf.historial_laboral || []);
                  const userResum = conf.perfil_tecnic?.resum_professional || conf.resum_professional || "No especificat";

                  // Determinar skills essencials que falten
                  const missingEss = ocObj.skills.filter(sk => sk.isEssential && !userSkillsDictionary.some(usrSk => (sk.title || '').toLowerCase().includes(usrSk) || usrSk.includes((sk.title || '').toLowerCase())));

                  if (missingEss.length === 0) {
                      responseBox.innerHTML = '<p style="color: var(--li-green); font-weight: bold;">🎉 Felicitats! El teu perfil ja reuneix de manera explícita totes les competències essencials avaluables per a aquesta ocupació.</p>';
                      return; // No fa falta consulta IA
                  }

                  const missingArr = missingEss.slice(0, 10).map(sk => sk.title).join(', ');

                  const apiKey = inputGeminiKey.value.trim();
                  if (!apiKey) {
                      responseBox.innerHTML = '<p style="color: red;">⚠️ Error: Cal configurar la clau (API Key) a l\'apartat "El meu CV".</p>';
                      return;
                  }

                  const prompt = `Ets un expert en recruiting i orientador de recerca de feina directe i objectiu. Absten-te d'afalacs innecessaris. El candidat s'està preparant per l'ocupació de "${ocObj.titol}".
Segons la normativa ESCO, li falten de forma explícita aquestes habilitats ESSENCIALS al currículum:
${missingArr}

Aquest és el Resum Professional general de l'usuari:
${userResum}

I aquest és l'historial laboral de l'usuari (empreses, responsabilitats i descripcions de tasques en format previ):
${userHistorial}

LA TEVA MISSIÓ: 
Analitza CADA UNA d'aquestes habilitats (màxim 10). Per a cada habilitat, segueix estrictament aquesta lògica de resposta:
- Si directament NO hi ha cap indici ni fonament a la seva trajectòria, respon: "No es detecta experiència demostrable al CV per aquesta habilitat."
- Si es detecta que l'usuari la posseeix de forma implícita o indirecta per la seva trajectòria, la resposta HA D'ESTAR OBLIGATÒRIAMNET estructurada amb aquestes dues seccions:
   1. "Anàlisi de l'experiència al CV": Justificació raonada de quines experiències professionals concretes del seu historial fan entreveure que sí que disposa d'aquest skill.
   2. "Proposta de millora": Quin redactat alternatiu o quin afegit exacte podem fer al currículum per incloure d'una forma explícita aquest skill.

IMPORTANT: No utilitzis els termes "Opció A" o "Opció B" en el text de la resposta; utilitza directament la bicefàlia de les seccions descrites si s'escau. Respon utilitzant format Markdown. Sigues extremadament concís i directe tant en l'anàlisi global com en cada proposta individual. L'extensió total del text ha de ser curta i NO pot excedir les 1000 paraules.`;

                  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
                  
                  const response = await fetchGeminiWithRetry(endpoint, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                  });
                  const respObj = await response.json();
                  const markdownText = respObj.candidates[0].content.parts[0].text;
                  
                  responseBox.innerHTML = `
                    <div class="ia-response-content markdown-body" style="font-size: 0.9rem;">${marked.parse(markdownText)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: left; font-style: italic; margin-top: 12px; padding-top: 8px; border-top: 1px solid #e1e3e8; opacity: 0.9;">${disclaimerText}</div>
                  `;
                  btnPrint.style.display = 'inline-flex';
                  
                  
              } catch (err) {
                  responseBox.innerHTML = `<p style="color:#d11124; font-weight:bold;">Error analitzant amb l'IA: ${err.message}</p>`;
              } finally {
                  btnMillora.innerHTML = 'Millora el teu CV ✨';
                  btnMillora.disabled = false;
              }
          });

          improvementContainer.appendChild(headerImp);
          improvementContainer.appendChild(responseBox);
          contentWrapper.appendChild(improvementContainer);
          // --- Fi Millora el teu CV ---

          const skillsContainer = document.createElement('div');
          skillsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
          
          let shownSkills = ocObj.skills.slice(0, 10);
          shownSkills.forEach(sk => {
              skillsContainer.appendChild(processSkillElement(sk, userSkillsDictionary));
          });
          contentWrapper.appendChild(skillsContainer);

          if (ocObj.skills.length > 10) {
              const extContainer = document.createElement('div');
              extContainer.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 4px;';
              
              const btnMore = document.createElement('button');
              btnMore.className = 'secondary-btn';
              btnMore.style.cssText = 'align-self: flex-start; padding: 4px 12px; font-size: 0.85rem;';
              btnMore.textContent = `Mostra'n més (+${Math.min(ocObj.skills.length - 10, 20)} skills)`;

              btnMore.onclick = (e) => {
                  e.stopPropagation();
                  btnMore.style.display = 'none';
                  const nextSkills = ocObj.skills.slice(10, 30);
                  const moreContainer = document.createElement('div');
                  moreContainer.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
                  
                  nextSkills.forEach(sk => {
                      moreContainer.appendChild(processSkillElement(sk, userSkillsDictionary));
                  });
                  extContainer.appendChild(moreContainer);

                  if (ocObj.skills.length > 30) {
                      const note = document.createElement('p');
                      note.style.cssText = 'font-size: 0.8rem; color: var(--text-secondary); font-style: italic; margin-top: 8px; text-align: left; opacity: 0.8;';
                      note.textContent = `S'han mostrat els 30 primers de ${ocObj.skills.length} skills registrats a ESCO per facilitar la lectura.`;
                      extContainer.appendChild(note);
                  }
              };

              extContainer.appendChild(btnMore);
              contentWrapper.appendChild(extContainer);
          }
      } else {
         const noSkills = document.createElement('p');
         noSkills.style.cssText = 'font-size: 0.85rem; color: var(--text-secondary); font-style: italic;';
         noSkills.textContent = 'No s\'han pogut recuperar habilitats d\'ESCO per aquesta ocupació.';
         contentWrapper.appendChild(noSkills);
      }
      
      card.appendChild(contentWrapper);

      header.addEventListener('click', () => {
          const isOpen = contentWrapper.style.display === 'flex';
          contentWrapper.style.display = isOpen ? 'none' : 'flex';
          chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
      
      llistaOcupacions.appendChild(card);
    });
  }
  
  ventallResults.hidden = false;
}

// ── Helpers ──────────────────────────────────────────
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
    const response = await fetchGeminiWithRetry(`${API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    // (Eliminem el bloc if (!response.ok) ja que fetchGeminiWithRetry ja el gestiona)

    const data = await response.json();
    let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    console.log("---------------- GEMINI RESULT RAW ----------------");
    console.log(resultText);
    console.log("---------------------------------------------------");

    // Netejar possible markdown del JSON (elimina ```json i ```)
    resultText = resultText.replace(/```json/gi, "").replace(/```/g, "").trim();

    // Extreure l'objecte JSON (per si hi ha text text abans/després)
    const startIndex = resultText.indexOf('{');
    const endIndex = resultText.lastIndexOf('}');

    let analysis = {};
    if (startIndex !== -1 && endIndex !== -1) {
      const cleanJson = resultText.substring(startIndex, endIndex + 1);
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

    renderAnalysisDashboard(analysis);

    // Mostrem el text de l'oferta ja processat a la columna esquerra
    contentOferta.innerHTML = marked.parse(jobText);

    statusLoader.style.display = 'none';
    statusMessageMain.innerHTML = `✔ **Anàlisi de compatibilitat completada**`;
    statusMessageSub.textContent = `Dashboard generat basat en el teu perfil.`;
    
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
    updateHeaderStatus("amber", "Error anàlisi compatibilitat", err.message);
    
    // Netejar la UI del loader i mostrar l'error de forma visual al panell central
    statusLoader.style.display = 'none';
    statusMessageMain.innerHTML = `<span style="color:red">🔴 Error en l'anàlisi</span>`;
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

    const response = await fetchGeminiWithRetry(`${API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    // (Eliminem el bloc de verificació manual de !response.ok ja que el helper ja ho gestiona)

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No s'ha pogut generar el text.";

    // Renderitzar i netejar
    contentCarta.innerHTML = marked.parse(resultText);
    btnCopiarCarta.disabled = false;
    btnImprimirCarta.disabled = false;

  } catch (err) {
    console.error('Error generant carta:', err);
    contentCarta.innerHTML = `<p style="color:red; padding: 20px;">🔴 Error al generar la carta: ${err.message}</p>`;
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
