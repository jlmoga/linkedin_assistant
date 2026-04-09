/**
 * DOM Elements
 */

export const tabButtons = document.querySelectorAll('.tab-btn');
export const tabPanels = document.querySelectorAll('.tab-panel');

// Profile Elements
export const inputLinkedinUrl = document.getElementById('input-linkedin-url');
export const inputDispoDies = document.getElementById('input-dispo-dies');
export const inputAddress = document.getElementById('input-address');
export const inputRadius = document.getElementById('input-radius');
export const modalityChips = document.querySelectorAll('#modalitat-selector .chip');
export const inputSbaMin = document.getElementById('input-sba-min');
export const inputSbaDesitjat = document.getElementById('input-sba-desitjat');
export const inputMaxDays = document.getElementById('input-max-days');
export const inputCommuteTime = document.getElementById('input-commute-time');
export const btnStopAnalysis = document.getElementById('btn-stop-analysis');

export const dropZoneCv = document.getElementById('drop-zone-cv');
export const inputCvPdf = document.getElementById('input-cv-pdf');
export const cvStatus = document.getElementById('cv-status');
export const cvFilename = document.getElementById('cv-filename');
export const btnDownloadCv = document.getElementById('btn-download-cv');
export const btnRemoveCv = document.getElementById('btn-remove-cv');

export const inputNoGo = document.getElementById('input-no-go');
export const inputCore = document.getElementById('input-core');
export const tagListNoGo = document.getElementById('tag-list-no-go');
export const tagListCore = document.getElementById('tag-list-core');

// Offer Elements
export const inputOfertaUrl = document.getElementById('input-oferta-url');
export const btnExaminar = document.getElementById('btn-examinar');
export const ofertaError = document.getElementById('oferta-error');
export const cvMissingMsg = document.getElementById('cv-missing-msg');
export const ofertaResults = document.getElementById('oferta-analysis-results');
export const ofertaUrlInputArea = document.getElementById('oferta-url-input-area');

// New Status & Comparison UI
export const ofertaStatusContainer = document.getElementById('oferta-status-container');
export const statusLoader = document.getElementById('status-loader');
export const statusMessageMain = document.getElementById('status-message-main');
export const statusMessageSub = document.getElementById('status-message-sub');
export const contentOferta = document.getElementById('content-oferta');
export const contentCv = document.getElementById('content-cv');
export const contentAnalisi = document.getElementById('content-analisi');

export const btnAnalitzarCv = document.getElementById('btn-analitzar-cv');
export const btnCopyJson = document.getElementById('btn-copy-json');
export const textareaCvJson = document.getElementById('textarea-cv-json');
export const inputGeminiKey = document.getElementById('input-gemini-key');
export const inputRolActual = document.getElementById('input-rol-actual');
export const textareaResumProf = document.getElementById('textarea-resum-prof');
export const readonlySkillsList = document.getElementById('readonly-skills-list');
export const btnNovaAnalisi = document.getElementById('btn-nova-analisi');
export const analysisControls = document.querySelector('.analysis-controls');

export const cvNextStepsContainer = document.getElementById('cv-next-steps-container');
export const btnGotoOfertes = document.getElementById('btn-goto-ofertes');
export const btnGotoVentall = document.getElementById('btn-goto-ventall');

export const progressContainer = document.getElementById('analysis-progress-container');
export const progressStatus = document.getElementById('analysis-status-text');
export const progressPercent = document.getElementById('analysis-percentage');
export const progressFiller = document.getElementById('analysis-progress-filler');

export const btnGuardarPerfil = document.getElementById('btn-guardar-perfil');
export const saveStatusMsg = document.getElementById('save-status-msg');

// Header Status elements
export const headerStatusBadge = document.getElementById('header-status-badge');
export const headerStatusDot = document.getElementById('header-status-dot');
export const headerStatusText = document.getElementById('header-status-text');

export const btnClearNoGo = document.getElementById('btn-clear-no-go');
export const btnClearCore = document.getElementById('btn-clear-core');
export const btnNavCarta = document.getElementById('btn-nav-carta');

// Letter elements
export const cartaEmpty = document.getElementById('carta-presentacio-empty');
export const cartaActive = document.getElementById('carta-presentacio-active');
export const contentCarta = document.getElementById('content-carta');
export const btnGenerarCarta = document.getElementById('btn-generar-carta');
export const btnCopiarCarta = document.getElementById('btn-copiar-carta');
export const btnImprimirCarta = document.getElementById('btn-imprimir-carta');

// Letter configuration selectors
export const btnCheckContacte = document.getElementById('btn-check-contacte');
export const btnCheckEmpresa = document.getElementById('btn-check-empresa');
export const btnCheckResaltar = document.getElementById('btn-check-resaltar');
export const selectToCarta = document.getElementById('select-to-carta');
export const selectEnfocament = document.getElementById('select-enfocament-carta');
export const selectLongitud = document.getElementById('select-longitud-carta');
export const selectIdioma = document.getElementById('select-idioma-carta');
export const textareaNotesCarta = document.getElementById('textarea-notes-carta');

// Ventall Professional Elements
export const ventallEmpty = document.getElementById('ventall-empty');
export const ventallActive = document.getElementById('ventall-active');
export const btnGenerarOcupacions = document.getElementById('btn-generar-ocupacions');
export const ocupacionsLoader = document.getElementById('ocupacions-loader');
export const ventallResults = document.getElementById('ventall-results');
export const llistaOcupacions = document.getElementById('llista-ocupacions');
export const diccionariOcupacionsText = document.getElementById('diccionari-ocupacions-text');
export const diccionariSkillsText = document.getElementById('diccionari-skills-text');
export const btnStopOcupacions = document.getElementById('btn-stop-ocupacions');

// Ventall Progress Bar Elements
export const ventallProgressFiller = document.getElementById('ventall-progress-filler');
export const ventallPercentage = document.getElementById('ventall-percentage');
export const ventallStatusText = document.getElementById('ventall-status-text');
