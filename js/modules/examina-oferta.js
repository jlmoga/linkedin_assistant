/**
 * Offer Analysis (LinkedIn Job Postings)
 */

import * as dom from './dom.js';
import { state } from './state.js';
import { callGemini } from './api.js';
import * as uiUtils from './ui-utils.js';
import { isValidUrl, renderJsonToMarkdown } from './utils.js';
import { updateCoverLetterUI } from './carta-presentacio.js';

export async function startAnalysis(url) {
  if (dom.ofertaUrlInputArea) dom.ofertaUrlInputArea.hidden = true;

  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const renderedCv = renderJsonToMarkdown(profile.cvJson);

  if (dom.analysisControls) dom.analysisControls.hidden = false;

  dom.ofertaStatusContainer.hidden = false;
  dom.statusLoader.style.display = 'block';
  dom.statusMessageMain.innerHTML = `<strong>Analitzant l'oferta...</strong>`;
  dom.statusMessageSub.textContent = `Intentant llegir: ${url}`;

  dom.ofertaResults.hidden = false;
  dom.contentCv.innerHTML = marked.parse(renderedCv);

  dom.contentOferta.innerHTML = `
    <div class="text-center py-10">
      <p class="text-secondary italic">Explorant els detalls del lloc de treball...</p>
      <div class="status-loader mx-auto mt-4"></div>
    </div>
  `;

  if (dom.contentAnalisi) dom.contentAnalisi.innerHTML = '';

  try {
    const response = await fetch(url, { mode: 'no-cors' });
    throw new Error('CORS_RESTRICTION');
  } catch (err) {
    showManualPasteUI();
  }
}

export function showManualPasteUI() {
  if (dom.ofertaUrlInputArea) dom.ofertaUrlInputArea.hidden = true;

  dom.statusMessageMain.innerHTML = `<strong>Accés restringit per LinkedIn</strong>`;
  dom.statusMessageSub.textContent = `Si us plau, enganxa el text de l'oferta a la columna esquerra.`;
  dom.statusLoader.style.display = 'none';

  dom.contentOferta.innerHTML = `
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
      uiUtils.updateHeaderStatus("amber", "Falta oferta", "Has d'enganxar algun contingut per analitzar.");
    }
  });
}

export async function processJobAnalysis(jobText) {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const cvData = profile.cvJson ? (typeof profile.cvJson === 'string' ? JSON.parse(profile.cvJson) : profile.cvJson) : {};
  const config = cvData.configuracio_usuari || cvData || {};

  const geminiKey = profile.geminiKey;
  if (!geminiKey) {
    uiUtils.updateHeaderStatus("amber", "API key", "Has de configurar la teva API Key de Google Gemini a la secció de Perfil.");
    return;
  }

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

  dom.statusLoader.style.display = 'block';
  dom.statusMessageMain.innerHTML = `<strong>L'IA està avaluant el teu "fit" real...</strong>`;
  dom.statusMessageSub.textContent = `Analitzant semàfors de compatibilitat.`;

  dom.contentAnalisi.innerHTML = `
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
      uiUtils.updateAiStatus(`Avaluant el teu "fit"... (reintent ${retry}/${total})`);
    };

    const resultText = await callGemini(prompt, onRetry, null, true);

    let analysis = {};
    if (typeof resultText === 'object') {
        analysis = resultText;
    } else {
        const cleanText = resultText.replace(/```json/gi, "").replace(/```/g, "").trim();
        const startIndex = cleanText.indexOf('{');
        const endIndex = cleanText.lastIndexOf('}');

        if (startIndex !== -1 && endIndex !== -1) {
          const cleanJson = cleanText.substring(startIndex, endIndex + 1);
          analysis = JSON.parse(cleanJson);
        } else {
          analysis = {};
        }
    }

    renderAnalysisDashboard(analysis);
    dom.contentOferta.innerHTML = marked.parse(jobText);

    dom.statusLoader.style.display = 'none';
    dom.statusMessageMain.innerHTML = `✔ **Anàlisi de compatibilitat completada**`;
    dom.statusMessageSub.textContent = `Dashboard generat basat en el teu perfil.`;
    uiUtils.updateAiStatus("Anàlisi de compatibilitat completada");
    
    state.currentJobAnalysis = analysis;
    updateCoverLetterUI();
    
    if (dom.btnNavCarta) {
      dom.btnNavCarta.hidden = false;
      dom.btnNavCarta.disabled = false;
      dom.btnNavCarta.style.opacity = '1';
    }

  } catch (err) {
    console.error('Error de Gemini on Job Analysis:', err);
    uiUtils.updateHeaderStatus("amber", "IA No Disponible", err.message);
    
    dom.statusLoader.style.display = 'none';
    dom.statusMessageMain.innerHTML = `<span style="color:red">🔴 IA No Disponible</span>`;
    dom.statusMessageSub.textContent = "Detalls: " + err.message;
    
    showManualPasteUI();
  }
}

export function calcularIndicadorGlobal(data) {
  const pesCriteris = {
    no_go: 0.25, salari: 0.20, ubicacio_modalitat: 0.15, core_matches: 0.15,
    idiomes: 0.10, secondary_matches: 0.05, sector: 0.05, educacio: 0.05
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

export function renderAnalysisDashboard(data) {
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
  const pesCriteris = { no_go: 25, salari: 20, ubicacio_modalitat: 15, core_matches: 15, idiomes: 10, secondary_matches: 5, sector: 5, educacio: 5 };
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
  dom.contentAnalisi.innerHTML = html;

  const btnPrint = document.getElementById('btn-imprimir-analisi');
  if (btnPrint) btnPrint.hidden = false;

  setTimeout(() => {
    const marker = document.getElementById('global-score-marker');
    if (marker) marker.style.left = `${score}%`;
  }, 50);
}

export function stopAnalysis() {
  if (state.analysisAbortController) {
    state.analysisAbortController.abort();
    state.analysisAbortController = null;
  }
}
