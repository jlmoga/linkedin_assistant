/**
 * CV and Profile Management
 */

import * as dom from './dom.js';
import { state } from './state.js';
import { STORE_NAME } from './config.js';
import { callGeminiAPI } from './api.js';
import { getFileFromDB, saveFileToDB } from './db.js';
import * as uiUtils from './ui-utils.js';
import { timeToMinutes, isValidUrl, renderJsonToMarkdown } from './utils.js';

export function loadProfileData() {
  const data = JSON.parse(localStorage.getItem('userProfile') || '{}');

  if (data.linkedinUrl) dom.inputLinkedinUrl.value = data.linkedinUrl;
  if (data.dispoDies) dom.inputDispoDies.value = data.dispoDies;
  if (data.address) dom.inputAddress.value = data.address;
  if (data.radius) dom.inputRadius.value = data.radius;
  if (data.sbaMin) dom.inputSbaMin.value = data.sbaMin;
  if (data.sbaDesitjat) dom.inputSbaDesitjat.value = data.sbaDesitjat;
  if (data.maxDays) dom.inputMaxDays.value = data.maxDays;
  if (data.commuteTime) dom.inputCommuteTime.value = data.commuteTime;
  if (data.cvJson) dom.textareaCvJson.value = data.cvJson;
  if (data.geminiKey) dom.inputGeminiKey.value = data.geminiKey;

  dom.modalityChips.forEach(chip => {
    chip.classList.remove('active');
    if (data.modalities && data.modalities.includes(chip.dataset.value)) {
      chip.classList.add('active');
    }
  });

  if (data.noGoTags) uiUtils.renderTags(dom.tagListNoGo, data.noGoTags, 'noGoTags');
  if (data.coreTags) uiUtils.renderTags(dom.tagListCore, data.coreTags, 'coreTags');

  state.originalProfileData = collectFormData();
  syncJsonToReadonlyFields();

  getFileFromDB('cv_pdf').then(file => {
    if (file) {
      updateCvUI(file.name);
    }
  });

  checkProfileStatus();
}

export function saveProfileField(field, value) {
  checkFormChanges();
}

export function checkFormChanges() {
  const currentData = collectFormData();
  const hasProfileChanges = JSON.stringify(currentData) !== JSON.stringify(state.originalProfileData);
  const hasFileChanges = state.stagedCvFile !== null;
  const hasChanges = hasProfileChanges || hasFileChanges;

  if (dom.btnGuardarPerfil) {
    dom.btnGuardarPerfil.disabled = !hasChanges;
  }
}

export function collectFormData() {
  const modalities = Array.from(document.querySelectorAll('#modalitat-selector .chip.active'))
    .map(c => c.dataset.value);

  return {
    linkedinUrl: dom.inputLinkedinUrl.value.trim(),
    dispoDies: dom.inputDispoDies.value,
    address: dom.inputAddress.value.trim(),
    radius: dom.inputRadius.value,
    sbaMin: dom.inputSbaMin.value,
    sbaDesitjat: dom.inputSbaDesitjat.value,
    maxDays: dom.inputMaxDays.value,
    commuteTime: dom.inputCommuteTime.value,
    cvJson: dom.textareaCvJson.value,
    geminiKey: dom.inputGeminiKey.value.trim(),
    modalities: modalities.sort(),
    noGoTags: Array.from(dom.tagListNoGo.querySelectorAll('.tag span:first-child')).map(s => s.textContent.replace('#', '')).sort(),
    coreTags: Array.from(dom.tagListCore.querySelectorAll('.tag span:first-child')).map(s => s.textContent.replace('#', '')).sort()
  };
}

export function syncUiToJson(currentData) {
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
    conf.perfil_tecnic.stack_core = currentData.coreTags || [];
    conf.perfil_tecnic.tecnologies_vetades = currentData.noGoTags || [];
    
    uiUtils.renderTags(dom.tagListCore, conf.perfil_tecnic.stack_core, 'coreTags');
    uiUtils.renderTags(dom.tagListNoGo, conf.perfil_tecnic.tecnologies_vetades, 'noGoTags');

    if (!conf.identitat_i_logistica) conf.identitat_i_logistica = {};
    if (!conf.identitat_i_logistica.adreça_base) conf.identitat_i_logistica.adreça_base = {};
    if (currentData.address) conf.identitat_i_logistica.adreça_base.poblacio = currentData.address;
    if (currentData.dispoDies) conf.identitat_i_logistica.disponibilitat_incorporacio_dies = parseInt(currentData.dispoDies, 10);

    const newJson = JSON.stringify(parsed, null, 2);
    currentData.cvJson = newJson;
    dom.textareaCvJson.value = newJson;
  } catch (e) {
    console.warn("No s'ha pogut sincronitzar la UI amb el JSON:", e);
  }
}

export function syncJsonToTagsUI() {
  const jsonText = dom.textareaCvJson.value.trim();
  if (!jsonText) return;

  try {
    const parsed = JSON.parse(jsonText);
    const conf = parsed.configuracio_usuari || parsed;
    if (!conf || !conf.perfil_tecnic) return;

    const coreTags = conf.perfil_tecnic.stack_core || [];
    const noGoTags = conf.perfil_tecnic.tecnologies_vetades || [];

    uiUtils.renderTags(dom.tagListCore, coreTags, 'coreTags');
    uiUtils.renderTags(dom.tagListNoGo, noGoTags, 'noGoTags');
  } catch (e) {
    console.warn("JSON invàlid al textarea, no es poden sincronitzar els tags.");
  }
}

export function syncJsonToReadonlyFields() {
  if (!dom.textareaCvJson.value.trim()) {
    if (dom.inputRolActual) dom.inputRolActual.value = '';
    if (dom.textareaResumProf) dom.textareaResumProf.value = '';
    renderReadonlySkills([]);
    return;
  }
  try {
    let parsed = JSON.parse(dom.textareaCvJson.value);
    let conf = parsed.configuracio_usuari || parsed;
    
    if (conf.identitat_i_logistica && conf.identitat_i_logistica.rol_actual) {
      if (dom.inputRolActual) dom.inputRolActual.value = conf.identitat_i_logistica.rol_actual;
    } else {
      if (dom.inputRolActual) dom.inputRolActual.value = '';
    }
    const tech = conf.perfil_tecnic || {};
    const resum = tech.resum_professional || conf.resum_professional; // Fallback for safety

    if (resum) {
      if (dom.textareaResumProf) {
        dom.textareaResumProf.value = resum;
        autoExpandResum();
      }
    } else {
      if (dom.textareaResumProf) {
        dom.textareaResumProf.value = '';
        dom.textareaResumProf.style.height = 'auto';
      }
    }

    if (tech.skills && Array.isArray(tech.skills)) {
      renderReadonlySkills(tech.skills);
    } else {
      renderReadonlySkills([]);
    }
  } catch(e) {
    console.warn("Error en sincronitzar camps readonly:", e);
  }
}

export function autoExpandResum() {
  if (dom.textareaResumProf) {
    dom.textareaResumProf.style.height = 'auto';
    // Use an extra pixels for safety and handle cases where it might be hidden initially
    const newHeight = dom.textareaResumProf.scrollHeight;
    if (newHeight > 0) {
      dom.textareaResumProf.style.height = (newHeight + 5) + 'px';
    }
  }
}

export function renderReadonlySkills(skills) {
  if (!dom.readonlySkillsList) return;
  
  if (!skills || skills.length === 0) {
    dom.readonlySkillsList.innerHTML = '<span style="color: #9aa0a6; font-size: 0.75rem;">S\'obtindrà de l\'anàlisi...</span>';
    return;
  }

  dom.readonlySkillsList.innerHTML = '';
  skills.forEach(skill => {
    const tagEl = document.createElement('div');
    tagEl.className = 'tag readonly';
    tagEl.innerHTML = `<span>#${skill}</span>`;
    dom.readonlySkillsList.appendChild(tagEl);
  });
}

export async function saveAllProfileData() {
  syncJsonToTagsUI();
  const currentData = collectFormData();
  syncUiToJson(currentData);

  localStorage.setItem('userProfile', JSON.stringify(currentData));
  state.originalProfileData = JSON.parse(JSON.stringify(currentData));

  if (state.stagedCvFile) {
    await saveFileToDB('cv_pdf', state.stagedCvFile);
    state.stagedCvFile = null;
  }

  dom.btnGuardarPerfil.disabled = true;
  uiUtils.showSaveSuccess();
  checkProfileStatus();
}

export async function handleCvUpload(file) {
  if (file.type !== 'application/pdf') {
    uiUtils.updateHeaderStatus("amber", "Error fitxer", "Només s'admeten fitxers PDF.");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    uiUtils.updateHeaderStatus("amber", "Error mida", "El fitxer és massa gran (màxim 2MB).");
    return;
  }

  state.stagedCvFile = file;
  updateCvUI(file.name);
  checkFormChanges();
}

export function updateCvUI(name) {
  if (dom.cvFilename) dom.cvFilename.textContent = name;
  if (dom.cvStatus) dom.cvStatus.removeAttribute('hidden');
  if (dom.dropZoneCv) dom.dropZoneCv.querySelector('.drop-zone-info').setAttribute('hidden', '');
  if (dom.btnAnalitzarCv) dom.btnAnalitzarCv.disabled = false;
}

export function setupTagInput(input, list, storageKey) {
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

export function addTag(input, list, storageKey) {
  const tagValue = input.value.trim().replace(/^#/, '');
  if (!tagValue) return;

  const currentTags = Array.from(list.querySelectorAll('.tag span:first-child'))
    .map(s => s.textContent.replace('#', ''));

  if (!currentTags.includes(tagValue)) {
    currentTags.push(tagValue);
    uiUtils.renderTags(list, currentTags, storageKey);
    checkFormChanges();
  }
  input.value = '';
}

export function removeTag(tagValue, storageKey, list) {
  let tags = Array.from(list.querySelectorAll('.tag span:first-child'))
    .map(s => s.textContent.replace('#', ''));
  tags = tags.filter(t => t !== tagValue);
  uiUtils.renderTags(list, tags, storageKey);
  checkFormChanges();
}

export async function handleCvAnalysis() {
  const apiKey = dom.inputGeminiKey.value.trim();
  if (!apiKey) {
    uiUtils.updateHeaderStatus("amber", "API key", "Si us plau, afegeix la teva Gemini API Key primer.");
    return;
  }

  const file = await getFileFromDB('cv_pdf');
  if (!file) {
    uiUtils.updateHeaderStatus("amber", "Falta CV", "No s'ha trobat cap fitxer CV a la base de dades local.");
    return;
  }

  try {
    state.analysisAbortController = new AbortController();
    uiUtils.resetProgress();
    uiUtils.updateProgress(10, 'Llegint PDF de la base de dades...');

    const arrayBuffer = await file.arrayBuffer();
    uiUtils.updateProgress(30, 'Extraient text del document...');

    const rawText = await extractTextFromPDF(arrayBuffer);
    if (!rawText.trim()) throw new Error('No s\'ha pogut extreure text del PDF.');

    uiUtils.updateAiStatus('Generant anàlisi experta amb Gemini IA...');

    const jsonResult = await callGeminiAPI(apiKey, rawText, (retryCount, total) => {
      uiUtils.updateAiStatus(`Generant anàlisi experta amb Gemini IA... (reintent de connexió IA ${retryCount}/${total})`);
    }, state.analysisAbortController.signal);

    uiUtils.updateProgress(90, 'Estructurant dades finals...');
    const currentUi = collectFormData();
    
    let conf = jsonResult.configuracio_usuari || jsonResult;
    if (!conf.perfil_tecnic) conf.perfil_tecnic = {};
    
    conf.perfil_tecnic.tecnologies_vetades = currentUi.noGoTags || [];
    const aiCore = conf.perfil_tecnic.stack_core || [];
    conf.perfil_tecnic.stack_core = [...new Set([...aiCore, ...currentUi.coreTags])].sort();

    let allSkills = new Set();
    if (Array.isArray(conf.historial_laboral)) {
      conf.historial_laboral.forEach(exp => {
        // En el prompt s'anomena 'stack_utilitzat'
        const expSkills = exp.stack_utilitzat || exp.skills_experiencia || [];
        if (Array.isArray(expSkills)) {
          expSkills.forEach(s => {
            if (s && typeof s === 'string') allSkills.add(s.trim());
          });
        }
      });
    }
    conf.perfil_tecnic.skills = [...allSkills].sort();

    dom.textareaCvJson.value = JSON.stringify(jsonResult, null, 2);
    
    uiUtils.renderTags(dom.tagListCore, conf.perfil_tecnic.stack_core, 'coreTags');
    uiUtils.renderTags(dom.tagListNoGo, conf.perfil_tecnic.tecnologies_vetades, 'noGoTags');

    syncJsonToReadonlyFields();
    checkFormChanges();
    checkProfileStatus();

    uiUtils.updateAiStatus('Anàlisi completada amb èxit!');
    uiUtils.updateProgress(100, 'Anàlisi completada amb èxit!');
    setTimeout(() => dom.progressContainer.hidden = true, 3000);

  } catch (err) {
    if (err.message === 'AbortError' || err.name === 'AbortError') return;
    console.error('Error en l\'anàlisi:', err);
    uiUtils.updateProgress(0, 'IA No Disponible');
    uiUtils.updateHeaderStatus("amber", "IA No Disponible", err.message);
  } finally {
    state.analysisAbortController = null;
    dom.btnAnalitzarCv.disabled = false;
  }
}

export async function extractTextFromPDF(data) {
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

export function checkProfileStatus() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const hasCv = !!(profile.cvJson && profile.cvJson.trim());
  const hasApiKey = !!(profile.geminiKey && profile.geminiKey.trim());
  
  if (dom.ventallEmpty && dom.ventallActive) {
    if (hasCv) {
      dom.ventallEmpty.hidden = true;
      dom.ventallActive.hidden = false;
    } else {
      dom.ventallEmpty.hidden = false;
      dom.ventallActive.hidden = true;
      if (dom.ventallResults) dom.ventallResults.hidden = true;
    }
  }
  
  const hasConfig = !!(profile.address && profile.address.trim() && 
                       profile.sbaMin && 
                       profile.modalities && profile.modalities.length > 0);

  if (dom.cvNextStepsContainer) {
    dom.cvNextStepsContainer.hidden = !hasCv;
  }

  if (!hasCv) {
    uiUtils.updateHeaderStatus("amber", "Revisa JSON");
  } else if (!hasConfig) {
    uiUtils.updateHeaderStatus("amber", "Revisa 'El meu CV'");
  } else if (!hasApiKey) {
    uiUtils.updateHeaderStatus("amber", "API key");
  } else {
    uiUtils.updateHeaderStatus("green", "Actiu");
  }

  dom.btnExaminar.disabled = !hasCv || !isValidUrl(dom.inputOfertaUrl.value.trim());
  dom.btnExaminar.title = hasCv ? "" : "Has de generar el teu CV al Perfil primer";
  dom.cvMissingMsg.hidden = hasCv;

  if (hasCv && dom.contentCv) {
    dom.contentCv.innerHTML = marked.parse(renderJsonToMarkdown(profile.cvJson));
    const btnPrintCv = document.getElementById('btn-imprimir-cv');
    if (btnPrintCv) btnPrintCv.hidden = false;
  } else {
    const btnPrintCv = document.getElementById('btn-imprimir-cv');
    if (btnPrintCv) btnPrintCv.hidden = true;
  }

  if (dom.ofertaResults.hidden && dom.ofertaUrlInputArea) {
    dom.ofertaUrlInputArea.hidden = false;
  }

  if (hasCv && dom.ofertaResults.hidden) {
    dom.ofertaStatusContainer.hidden = false;
    if (dom.analysisControls) dom.analysisControls.hidden = true;
    dom.statusLoader.style.display = 'none';
    dom.statusMessageMain.innerHTML = `<strong>Prepara't per l'anàlisi</strong>`;
    dom.statusMessageSub.textContent = `Introdueix una URL i clica "Examinar" per començar.`;
  } else if (!hasCv) {
    dom.ofertaStatusContainer.hidden = true;
    if (dom.analysisControls) dom.analysisControls.hidden = true;
  }
}
