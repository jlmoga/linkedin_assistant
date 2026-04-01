/* ===================================================
   LinkedIn Assistant – App Logic
   =================================================== */

'use strict';

// ── Configuration & State ───────────────────────────
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DB_NAME = 'LinkedInAssistantDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

let db;

// ── DOM Elements ────────────────────────────────────
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Profile Elements
const inputLinkedinUrl = document.getElementById('input-linkedin-url');
const inputAddress = document.getElementById('input-address');
const inputRadius = document.getElementById('input-radius');
const modalityChips = document.querySelectorAll('#modalitat-selector .chip');
const inputSbaMin = document.getElementById('input-sba-min');
const inputSbaDesitjat = document.getElementById('input-sba-desitjat');
const inputMaxDays = document.getElementById('input-max-days');
const inputCommuteTime = document.getElementById('input-commute-time');

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
const btnNovaAnalisi = document.getElementById('btn-nova-analisi');
const analysisControls = document.querySelector('.analysis-controls');

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

// ── State Management ────────────────────────────────
let originalProfileData = {};
let stagedCvFile = null;
let isAnalysingCv = false; // To track if we're in the middle of IA analysis

// ── Initialization ──────────────────────────────────
init();

async function init() {
  await initDB();
  loadProfileData();
  setupEventListeners();
  restoreActiveTab();
  checkProfileStatus(); // Check if CV is ready

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
}

function restoreActiveTab() {
  const savedTab = sessionStorage.getItem('activeTab');
  if (savedTab && document.querySelector(`[data-tab="${savedTab}"]`)) {
    activateTab(savedTab);
  } else {
    activateTab('examina-oferta');
  }
}

// ── Profile Data Handling ───────────────────────────
function loadProfileData() {
  const data = JSON.parse(localStorage.getItem('userProfile') || '{}');

  // Ensure we have current values even if loading empty
  if (data.linkedinUrl) inputLinkedinUrl.value = data.linkedinUrl;
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

  // Load CV status from DB
  getFileFromDB('cv_pdf').then(file => {
    if (file) {
      updateCvUI(file.name);
    }
  });

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

    const newJson = JSON.stringify(parsed, null, 2);
    currentData.cvJson = newJson;
    textareaCvJson.value = newJson;
  } catch (e) {
    console.warn("No s'ha pogut sincronitzar la UI amb el JSON:", e);
  }
}

async function saveAllProfileData() {
  const currentData = collectFormData();

  // Sincronitza la UI cap al JSON abans de guardar
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
    checkProfileStatus();
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
    resetProgress();
    updateProgress(10, 'Llegint PDF de la base de dades...');

    const arrayBuffer = await file.arrayBuffer();
    updateProgress(30, 'Extraient text del document...');

    const rawText = await extractTextFromPDF(arrayBuffer);
    if (!rawText.trim()) throw new Error('No s\'ha pogut extreure text del PDF.');

    updateProgress(60, 'Generant anàlisi experta amb Gemini IA...');

    const jsonResult = await callGeminiAPI(apiKey, rawText);

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

    textareaCvJson.value = JSON.stringify(jsonResult, null, 2);
    
    // Sincronitzar els tags de la UI per assegurar que es veu la llista final unificada
    renderTags(tagListCore, conf.perfil_tecnic.stack_core, 'coreTags');
    renderTags(tagListNoGo, conf.perfil_tecnic.tecnologies_vetades, 'noGoTags');

    checkFormChanges();
    checkProfileStatus();

    updateProgress(100, 'Anàlisi completada amb èxit!');
    setTimeout(() => progressContainer.hidden = true, 3000);

  } catch (error) {
    console.error('Error en l\'anàlisi:', error);
    updateProgress(0, 'Error: ' + error.message);
    updateHeaderStatus("amber", "Error JSON", error.message);
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

async function callGeminiAPI(key, text) {
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
    acceptaHibrid: modalities.includes('Híbrid')
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`;

  const prompt = `
    Actua com un expert senior en recruiting i recursos humans.
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
          }
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
            "stack_utilitzat": ["Llista de tecnologies/eines concretes d'aquesta experiència"],
            "responsabilitats": ["...", "..."],
            "fites_clau": "..."
          }
        ]
      },
      "NOTES_LOGICA": {
        "stack_core_generacio": "El camp 'stack_core' de 'perfil_tecnic' NO ha d'estar buit; ha de ser la UNIO ÚNICA (com un Set) de tots els 'stack_utilitzat' de l'historial laboral."
      }
    }

    Aquí tens el text del format CV:
    ---
    ${text}
    ---

    Respon NOMÉS amb el JSON. No incloguis markdown code blocks.
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

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
    const response = await fetch(`${API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error details:", errorText);
      throw new Error(`Gemini API Error: ${response.status}`);
    }

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
  
  // Verificació de dades de configuració informades (camps base)
  const hasConfig = !!(profile.address && profile.address.trim() && 
                       profile.sbaMin && 
                       profile.modalities && profile.modalities.length > 0);

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
        <title>Visualització Curricular - LinkedIn Assistant</title>
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
