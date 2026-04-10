/**
 * Rumb - Main Entry Point
 */

import * as dom from './modules/dom.js';
import { state } from './modules/state.js';
import * as db from './modules/db.js';
import * as uiUtils from './modules/ui-utils.js';
import * as cvManager from './modules/cv-manager.js';
import * as offerAnalysis from './modules/examina-oferta.js';
import * as ventall from './modules/ventall-professional.js';
import * as coverLetter from './modules/carta-presentacio.js';
import * as mapManager from './modules/map-manager.js';
import * as printUtils from './modules/print-utils.js';
import { isValidUrl } from './modules/utils.js';

// --- Global Exposure (for backward compatibility with HTML inline events) ---
window.activateTab = uiUtils.activateTab;
window.imprimirCV = printUtils.imprimirCV;
window.imprimirInforme = printUtils.imprimirInforme;
window.imprimirCarta = coverLetter.imprimirCarta;

async function init() {
  await db.initDB();
  cvManager.loadProfileData();
  mapManager.initMap();
  
  // Initial map render if address exists
  const initialData = cvManager.collectFormData();
  if (initialData.address) {
    mapManager.updateMap(initialData.address, initialData.radius);
  }

  setupEventListeners();
  uiUtils.restoreActiveTab();
  cvManager.checkProfileStatus(); 
  coverLetter.updateCoverLetterUI();
  cvManager.checkFormChanges();
}

function setupEventListeners() {
  // Tabs
  dom.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => uiUtils.activateTab(btn.dataset.tab));
  });

  // El meu CV Inputs
  dom.inputLinkedinUrl.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    const isValid = !url || isValidUrl(url);
    dom.inputLinkedinUrl.style.borderColor = isValid ? '' : '#d93025';
    if (isValid) cvManager.saveProfileField('linkedinUrl', url);
  });

  dom.inputDispoDies.addEventListener('input', (e) => {
    cvManager.saveProfileField('dispoDies', e.target.value);
    cvManager.checkProfileStatus();
  });

  dom.inputAddress.addEventListener('input', (e) => {
    cvManager.saveProfileField('address', e.target.value);
    cvManager.checkProfileStatus();
    mapManager.updateMapDebounced(e.target.value, dom.inputRadius.value);
  });
  
  dom.inputRadius.addEventListener('input', (e) => {
    cvManager.saveProfileField('radius', e.target.value);
    cvManager.checkProfileStatus();
    mapManager.updateMapDebounced(dom.inputAddress.value, e.target.value);
  });
  
  dom.inputSbaMin.addEventListener('input', (e) => {
    cvManager.saveProfileField('sbaMin', e.target.value);
    cvManager.checkProfileStatus();
  });
  
  dom.inputSbaDesitjat.addEventListener('input', (e) => {
    cvManager.saveProfileField('sbaDesitjat', e.target.value);
    cvManager.checkProfileStatus();
  });
  
  dom.inputMaxDays.addEventListener('input', (e) => {
    cvManager.saveProfileField('maxDays', e.target.value);
    cvManager.checkProfileStatus();
  });
  
  dom.inputCommuteTime.addEventListener('input', (e) => {
    cvManager.saveProfileField('commuteTime', e.target.value);
    cvManager.checkProfileStatus();
  });

  dom.inputExperience.addEventListener('input', (e) => {
    cvManager.saveProfileField('experience', e.target.value);
  });

  dom.inputBirthDate.addEventListener('input', (e) => {
    cvManager.saveProfileField('birthDate', e.target.value);
  });

  dom.selectEducationLevel.addEventListener('change', (e) => {
    cvManager.saveProfileField('educationLevel', e.target.value);
  });

  dom.selectNaceSector.addEventListener('change', (e) => {
    cvManager.saveProfileField('naceSector', e.target.value);
  });

  // CV PDF Handling
  dom.dropZoneCv.addEventListener('click', () => dom.inputCvPdf.click());

  dom.dropZoneCv.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropZoneCv.classList.add('drag-over');
  });

  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    dom.dropZoneCv.addEventListener(evt, () => dom.dropZoneCv.classList.remove('drag-over'));
  });

  dom.dropZoneCv.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length) cvManager.handleCvUpload(files[0]);
  });

  dom.inputCvPdf.addEventListener('change', (e) => {
    if (e.target.files.length) cvManager.handleCvUpload(e.target.files[0]);
  });

  dom.btnRemoveCv.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm('Estàs segur que vols eliminar el CV?')) {
      db.removeFileFromDB('cv_pdf').then(() => {
        dom.cvStatus.setAttribute('hidden', '');
        dom.dropZoneCv.querySelector('.drop-zone-info').removeAttribute('hidden');
        dom.inputCvPdf.value = '';
        dom.btnAnalitzarCv.disabled = true;
      });
    }
  });

  dom.btnDownloadCv.addEventListener('click', async (e) => {
    e.stopPropagation();
    const file = await db.getFileFromDB('cv_pdf');
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'el-meu-cv.pdf';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
  });

  // El meu CV - Analysis & Save
  dom.btnAnalitzarCv.addEventListener('click', () => cvManager.handleCvAnalysis());
  
  if (dom.btnGuardarPerfil) {
    dom.btnGuardarPerfil.addEventListener('click', () => cvManager.saveAllProfileData());
  }

  // Tags
  cvManager.setupTagInput(dom.inputNoGo, dom.tagListNoGo, 'noGoTags');
  cvManager.setupTagInput(dom.inputCore, dom.tagListCore, 'coreTags');

  if (dom.btnClearNoGo) {
    dom.btnClearNoGo.addEventListener('click', () => {
      cvManager.renderTags(dom.tagListNoGo, [], 'noGoTags');
      cvManager.checkFormChanges();
    });
  }

  if (dom.btnClearCore) {
    dom.btnClearCore.addEventListener('click', () => {
      cvManager.renderTags(dom.tagListCore, [], 'coreTags');
      cvManager.checkFormChanges();
    });
  }

  // Offer Tab
  dom.inputOfertaUrl.addEventListener('input', (e) => {
    cvManager.checkProfileStatus();
  });

  dom.textareaOfertaManual.addEventListener('input', (e) => {
    cvManager.checkProfileStatus();
  });

  dom.btnExaminarUrl.addEventListener('click', () => {
    const url = dom.inputOfertaUrl.value.trim();
    if (url) {
      offerAnalysis.handleOfferExtraction({ type: 'url', value: url });
    }
  });

  dom.btnExaminarManual.addEventListener('click', () => {
    const text = dom.textareaOfertaManual.value.trim();
    if (text) {
      offerAnalysis.handleOfferExtraction({ type: 'manual', value: text });
    }
  });


  if (dom.btnNovaAnalisi) {
    dom.btnNovaAnalisi.addEventListener('click', () => {
      dom.ofertaInputArea.hidden = false;
      dom.ofertaResults.hidden = true;
      if (dom.analysisControls) dom.analysisControls.hidden = true;
      if (dom.contentOferta) dom.contentOferta.innerHTML = '';
      if (dom.contentAnalisi) dom.contentAnalisi.innerHTML = '';
      dom.inputOfertaUrl.value = '';
      dom.textareaOfertaManual.value = '';
      cvManager.checkProfileStatus();
      if (dom.btnNavCarta) dom.btnNavCarta.hidden = true;
      state.currentJobAnalysis = null;
      coverLetter.updateCoverLetterUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }


  // Modality Chips
  dom.modalityChips.forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const activeModalities = Array.from(document.querySelectorAll('#modalitat-selector .chip.active'))
        .map(c => c.dataset.value);
      cvManager.saveProfileField('modalities', activeModalities);
      cvManager.checkProfileStatus();
    });
  });

  // Cover Letter
  if (dom.btnGenerarCarta) {
    dom.btnGenerarCarta.addEventListener('click', () => coverLetter.handleGenerateCoverLetter());
  }
  if (dom.btnCopiarCarta) {
    dom.btnCopiarCarta.addEventListener('click', () => coverLetter.copyCoverLetterToClipboard());
  }
  if (dom.btnImprimirCarta) {
    dom.btnImprimirCarta.addEventListener('click', () => coverLetter.imprimirCarta());
  }

  [dom.btnCheckContacte, dom.btnCheckEmpresa, dom.btnCheckResaltar].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    }
  });

  // Ventall Professional
  if (dom.btnGenerarOcupacions) {
    dom.btnGenerarOcupacions.addEventListener('click', () => ventall.handleGenerarOcupacions());
  }

  // Abort Handling
  if (dom.btnStopAnalysis) {
    dom.btnStopAnalysis.addEventListener('click', () => {
       if (state.analysisAbortController) state.analysisAbortController.abort();
    });
  }
  if (dom.btnStopOcupacions) {
    dom.btnStopOcupacions.addEventListener('click', () => {
       if (state.analysisAbortController) state.analysisAbortController.abort();
    });
  }

  // Profile JSON Sync
  dom.textareaCvJson.addEventListener('input', (e) => {
    cvManager.saveProfileField('cvJson', e.target.value);
    cvManager.syncJsonToReadonlyFields();
    cvManager.checkProfileStatus();
  });

  dom.textareaCvJson.addEventListener('blur', () => {
    cvManager.syncJsonToTagsUI();
  });

  dom.btnCopyJson.addEventListener('click', () => {
    const json = dom.textareaCvJson.value.trim();
    if (!json) return;
    navigator.clipboard.writeText(json).then(() => {
      const originalText = dom.btnCopyJson.innerHTML;
      dom.btnCopyJson.innerHTML = `<span>Copiat!</span>`;
      setTimeout(() => { dom.btnCopyJson.innerHTML = originalText; }, 2000);
    });
  });

  dom.inputGeminiKey.addEventListener('input', (e) => cvManager.saveProfileField('geminiKey', e.target.value));

  // NAVIGATION FROM CV NEXT STEPS
  if (dom.btnGotoOfertes) {
    dom.btnGotoOfertes.addEventListener('click', () => uiUtils.activateTab('examina-oferta'));
  }
  if (dom.btnGotoVentall) {
    dom.btnGotoVentall.addEventListener('click', () => uiUtils.activateTab('ventall-professional'));
  }
}

// Global Start
window.addEventListener('DOMContentLoaded', init);
