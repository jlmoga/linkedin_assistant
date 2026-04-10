/**
 * Offer Analysis (LinkedIn Job Postings)
 */

import * as dom from './dom.js';
import { state } from './state.js';
import { callGemini } from './api.js';
import * as uiUtils from './ui-utils.js';
import { isValidUrl, renderJsonToMarkdown, cleanHtml } from './utils.js';
import { updateCoverLetterUI } from './carta-presentacio.js';
import { renderOfferRouteMap } from './map-manager.js';

/**
 * Fase 1: Extracció i Formatat de l'oferta.
 * @param {Object} input - { type: 'url' | 'manual', value: string }
 */
export async function handleOfferExtraction(input) {
  if (dom.ofertaInputArea) dom.ofertaInputArea.hidden = true;
  if (dom.ofertaResults) dom.ofertaResults.hidden = false;
  if (dom.analysisControls) dom.analysisControls.hidden = false;

  // Carregar el CV immediatament (demana l'usuari)
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  if (profile.cvJson) {
    dom.contentCv.innerHTML = marked.parse(renderJsonToMarkdown(profile.cvJson));
    const btnPrintCv = document.getElementById('btn-imprimir-cv');
    if (btnPrintCv) btnPrintCv.hidden = false;
  }

  // Placeholder de càrrega per a l'oferta
  dom.contentOferta.innerHTML = `
    <div class="contextual-loader-container">
      <div class="loader-spinner"></div>
      <p class="text-secondary"><strong>Llegint l'oferta...</strong></p>
      <p class="text-xs text-muted mt-2">Extraient dades i aplicant format professional.</p>
    </div>
  `;

  // Placeholder de benvinguda/espera per a l'anàlisi
  dom.contentAnalisi.innerHTML = `
    <div class="text-center py-12 px-6">
      <p class="text-secondary italic mb-4">L'anàlisi de compatibilitat s'activarà quan l'oferta estigui processada.</p>
    </div>
  `;

  let jobToProcess = "";

  try {
    if (input.type === 'url') {
      const isLinkedIn = input.value.includes('linkedin.com/jobs') || input.value.includes('linkedin.com/mwlite/jobs');
      if (isLinkedIn) {
        throw new Error('LINKEDIN_RESTRICTED');
      }

      const html = await scrapOffer(input.value);
      if (!html) throw new Error('EMPTY_HTML');
      
      jobToProcess = await extractJobFromHtml(html);
    } else {
      // Entrada manual directa a formatat estructural
      jobToProcess = await formatManualJob(input.value);
    }

    if (!jobToProcess) throw new Error('EXTRACTION_FAILED');

    // Renderitzem l'oferta estructurada a la Columna 1
    dom.contentOferta.innerHTML = marked.parse(jobToProcess);
    
    // Mostrem el botó de continuar a la Columna 3
    renderContinueButton(jobToProcess);

  } catch (err) {
    console.error("Error en Fase 1:", err);
    let errorMsg = "No hem pogut llegir l'oferta automàticament";
    let subMsg = "Això pot passar per bloquejos del portal o format incompatible.";
    
    if (err.message === 'LINKEDIN_RESTRICTED') {
      errorMsg = "Accés restringit per LinkedIn";
      subMsg = "LinkedIn no permet la lectura directa des del navegador per privacitat.";
    }

    dom.contentOferta.innerHTML = `
      <div class="text-center py-10 px-4">
        <div class="mb-4 text-amber-500">
           <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        </div>
        <p class="text-li-blue font-bold">${errorMsg}</p>
        <p class="text-sm text-secondary mt-2 mb-6">${subMsg}</p>
        <button id="btn-fallback-manual" class="primary-btn w-full">Enganxa el text manualment</button>
      </div>
    `;

    document.getElementById('btn-fallback-manual').addEventListener('click', () => {
       dom.ofertaInputArea.hidden = false;
       dom.ofertaResults.hidden = true;
       // Enfocar el textarea manual
       dom.textareaOfertaManual.focus();
    });
  }
}

/**
 * Utilitza Gemini per estructurar un text que ja ha estat enganxat manualment.
 */
async function formatManualJob(text) {
  const prompt = `
    Ets un expert en recruiting. T'enviaré un text que és una oferta de feina.
    La teva tasca és organitzar-lo en Markdown seguiment aquesta estructura de 7 punts:
    - **Títol de la posició**
    - **Descripció de la posició**
    - **Localització del lloc de feina**
    - **Principals funcions**
    - **Requeriments crítics**
    - **Requeriments secundaris**
    - **Beneficis**
    
    Text:
    ${text.substring(0, 10000)}
  `;
  return await callGemini(prompt);
}

function renderContinueButton(jobText) {
  dom.contentAnalisi.innerHTML = `
    <div class="prominent-action-container">
      <h3 class="text-lg font-bold text-li-blue mb-2">Tot a punt!</h3>
      <p class="text-secondary mb-8 max-w-md mx-auto">Hem processat els detalls de l'oferta. Ara pots analitzar com d'aprop estàs de complir amb el perfil sol·licitat.</p>
      <button id="btn-trigger-full-analysis" class="btn-continue-prominent">
        <span>Continua amb l'anàlisi de compatibilitat</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
    </div>
  `;

  document.getElementById('btn-trigger-full-analysis').addEventListener('click', () => {
    processJobAnalysis(jobText);
  });
}


async function scrapOffer(url) {
  const proxies = [
    { 
      name: 'AllOrigins', 
      url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      transform: (data) => data.contents 
    },
    { 
      name: 'CorsProxy.io', 
      url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      transform: (data) => data // Normalment retorna el text directament si no és JSON
    }
  ];

  for (const proxy of proxies) {
    try {
      console.log(`Intentant scrap amb ${proxy.name}...`);
      const proxyUrl = proxy.url(url);
      const response = await fetch(proxyUrl);
      
      if (!response.ok) {
        console.warn(`${proxy.name} ha retornat error: ${response.status}`);
        continue;
      }
      
      // AllOrigins sempre retorna JSON. CorsProxy.io retorna el contingut directament.
      if (proxy.name === 'AllOrigins') {
        const data = await response.json();
        const html = proxy.transform(data);
        if (html) return html;
      } else {
        const html = await response.text();
        if (html) return html;
      }
    } catch (err) {
      console.error(`Error amb ${proxy.name}:`, err);
    }
  }
  return null;
}


/**
 * Utilitza Gemini per extreure la informació professional rellevant d'un codi HTML brut.
 */
async function extractJobFromHtml(html) {
  const cleanedText = cleanHtml(html);
  
  const prompt = `
    Ets un assistent expert en recruiting i RRHH. T'enviaré el contingut d'una pàgina web que conté una oferta de feina.
    La teva tasca és extreure la informació rellevant i presentar-la de forma neta i estructurada.
    
    EXTREU I REESTRUCTURA EN MARKDOWN SEGUINT AQUESTA ESTRUCTURA EXACTA:
    - **Títol de la posició**
    - **Descripció de la posició**
    - **Localització del lloc de feina**
    - **Principals funcions**
    - **Requeriments crítics**
    - **Requeriments secundaris**
    - **Beneficis**
    
    REGLES IMPORTANTS:
    - Si no trobes informació per a alguna d'aquestes seccions, escriu literalment: "No s'ha trobat informació rellevant per aquesta secció."
    - No inventis dades, sigues fidel al contingut original.
    - El to ha de ser professional i analític.
    
    CONTINGUT DE LA WEB:
    ---
    ${cleanedText.substring(0, 15000)} 
    ---
    
    Respon amb el Markdown estructurat.

  `;

  try {
    const result = await callGemini(prompt);
    return result;
  } catch (err) {
    console.error("Error extraient dades amb Gemini:", err);
    return null;
  }
}

export function showManualPasteUI(title = "Accés restringit", subtext = "Actualment no podem llegir aquesta web automàticament.") {
  if (dom.ofertaInputArea) dom.ofertaInputArea.hidden = true;

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

  dom.contentAnalisi.innerHTML = `
    <div class="contextual-loader-container">
      <div class="loader-spinner"></div>
      <p class="text-secondary"><strong>Comparant perfils...</strong></p>
      <p class="text-xs text-muted mt-2">Avaluant matching semàntic i semàfors de compatibilitat.</p>
    </div>
  `;


  const prompt = `
    Ets un expert en recruiting i RRHH. Compara aquest perfil amb l'oferta de feina proporcionada.
    
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
    
    OFERTA DE FEINA (TEXT BRUT O PARCIAL):
    ${jobText}
    
    TASQUES:
    1. Realitzar l'anàlisi de compatibilitat (KPIs) comparant els requeriments de l'oferta amb el perfil de l'usuari.
    
    2. Generar un resum d'encaix professional (camp 'encaix_professional_md'):

       - Actua com un expert en Recruiting i RRHH.
       - Focus: Acompliment de funcions i requeriments crítics.
       - Estil: CONCÍS i molt enfocat a CARÀCTER PRÀCTIC.
       - Evita introduccions genèriques; ves directament als punts forts o febles del candidat per a aquesta posició concreta.

    Respon EXCLUSIVAMENT amb un objecte JSON amb aquesta estructura EXACTA.
    {
      "encaix_professional_md": "### Conclusions de l'Expert\\n... (Anàlisi pràctica i concisa)",

      "no_go": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "core_matches": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "secondary_matches": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "ubicacio_modalitat": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "salari": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "sector": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "educacio": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "idiomes": { "status": "...", "resum": "...", "user_data": "...", "offer_data": "..." },
      "ubicacio_oferta": "..."
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
    
    showManualPasteUI();
  }

}

export function calcularIndicadorGlobal(data, locationMetrics = null) {
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
    let rawVal = 0;
    
    if (k === 'ubicacio_modalitat') {
      // Nova lògica 40/30/30
      const item = data[k] || {};
      const status = item.status || 'red';
      const modalitatScore = ptsMap[k][status]; // el valor base de la IA (40, 100, 0)
      
      let kpiScore = modalitatScore * 0.4; // 40% modalitat
      
      if (locationMetrics) {
        const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
        const maxDist = parseFloat(profile.radius) || 50;
        const maxTimeStr = profile.commuteTime || "00:45";
        const [h, m] = maxTimeStr.split(':').map(Number);
        const maxTimeSeconds = (h * 3600) + (m * 60);

        const distScore = (locationMetrics.distance / 1000 <= maxDist) ? 100 : 0;
        const timeScore = (locationMetrics.duration <= maxTimeSeconds) ? 100 : 0;
        
        kpiScore += (distScore * 0.3) + (timeScore * 0.3);
      } else {
        // Mentre no tenim mètriques, es manté pendent (només contem modalitat o assumim èxit?)
        // Assumirem èxit temporal per no espantar l'usuari o neutralitat? 
        // L'usuari diu que "el valor serà 0" si se supera, així que si no ho sabem encara, no sumem.
      }
      rawVal = kpiScore;
    } else {
      const item = data[k] || {};
      const status = item.status || 'red';
      rawVal = ptsMap[k][status] !== undefined ? ptsMap[k][status] : 0;
    }
    
    scoreFinal += rawVal * pesCriteris[k];
  });
  return Math.round(scoreFinal);
}

export function renderAnalysisDashboard(data) {
  const score = calcularIndicadorGlobal(data);
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const userRadius = profile.radius || 50;
  const userTime = profile.commuteTime || "00:45";

  let html = `

    <div class="global-indicator-card">
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
        <h3 style="margin: 0; color: #333;">Índex de Compatibilitat Global</h3>
        <span id="global-score-text" style="font-weight: 700; font-size: 1.4rem; color: #1a1a1a;">${score}%</span>
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
    ubicacio_modalitat: "🟢 Score > 60% (Modalitat 40% + Distància 30% + Temps 30%) | 🟡 Score 30-60% | 🔴 Score < 30%",
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

    const weightBadgeId = `weight-badge-${k}`;
    const weightBadge = `<span id="${weightBadgeId}" style="display:inline-block; background:#eef3f8; color:#0a66c2; padding: 2px 6px; border-radius: 4px; font-size:0.75rem; font-weight:bold; margin-right: 8px;">${earnedText}% / ${maxPes}%</span>`;

    let extraHtml = '';
    if (k === 'ubicacio_modalitat' && data.ubicacio_oferta && data.ubicacio_oferta !== 'Desconeguda') {
      extraHtml = `
        <div id="offer-route-map-container" style="margin: 16px 0; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #f9f9f9;">
          <div id="offer-route-map" style="width: 100%; aspect-ratio: 1 / 1;"></div>
          <div id="offer-route-info" style="padding: 10px 12px; font-size: 0.8rem; color: #333; border-top: 1px solid #eee; background: #fff; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 6px; color: #666;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Ruta a <strong>${data.ubicacio_oferta}</strong></span>
            </div>
            <div id="route-metrics" style="font-weight: 600; color: var(--li-blue);">Calculant ruta...</div>
          </div>
          <div style="padding: 6px 12px; font-size: 0.75rem; color: #777; background: #fcfcfc; border-top: 1px dashed #eee; display: flex; align-items: center; gap: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span>Límits configurats: <strong>${userRadius} km</strong> de ràdio i <strong>${userTime}</strong> de desplaçament.</span>
          </div>
        </div>

      `;
    }

    html += `
      <details class="analysis-item" ${k === 'ubicacio_modalitat' ? 'open' : ''}>
        <summary class="analysis-summary">
          <div class="analysis-info">
            <p class="analysis-label" style="display:flex; align-items:center;">${weightBadge}${titleMap[k]}</p>
            <p class="analysis-value" style="font-size: 0.9rem; margin-top: 4px;">${resum}</p>
          </div>
          <div class="status-indicator">
            <div id="status-circle-${k}" class="status-circle ${status}"></div>
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
          ${extraHtml}
          <div class="kpi-disclaimer">
            <strong>ℹ️ Regles de mesura d'aquest KPI:</strong> ${disclaimers[k]}
          </div>
        </div>
      </details>
    `;
  });

  html += `</div>`;

  // Afegim el bloc de conclusions expertes si existeix
  if (data.encaix_professional_md) {
    html += `
      <div class="expert-conclusions-card">
        <div class="expert-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <h4>Conclusions de l'Expert RRHH</h4>
        </div>
        <div class="expert-content markdown-preview">
          ${marked.parse(data.encaix_professional_md)}
        </div>
      </div>
    `;
  }

  dom.contentAnalisi.innerHTML = html;


  const btnPrint = document.getElementById('btn-imprimir-analisi');
  if (btnPrint) btnPrint.hidden = false;

  setTimeout(() => {
    const marker = document.getElementById('global-score-marker');
    if (marker) marker.style.left = `${score}%`;

    // Render offer route map if possible
    if (data.ubicacio_oferta && data.ubicacio_oferta !== 'Desconeguda') {
      const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
      const address = profile.address || '';
      const radius = profile.radius || 50;
      if (address) {
        renderOfferRouteMap('offer-route-map', address, data.ubicacio_oferta, radius).then(metrics => {
          if (metrics) {
            const kmValue = metrics.distance / 1000;
            const km = kmValue.toFixed(1);
            const mins = Math.round(metrics.duration / 60);
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            
            let timeText = hours > 0 ? `${hours}h ${remainingMins}min` : `${mins} min`;
            const metricsEl = document.getElementById('route-metrics');
            if (metricsEl) {
              metricsEl.innerHTML = `${km} km | ${timeText}`;
            }

            // Recalcular KPI Score i Global Index
            const maxTimeStr = profile.commuteTime || "00:45";
            const [h, m] = maxTimeStr.split(':').map(Number);
            const maxTimeSeconds = (h * 3600) + (m * 60);

            const item = data['ubicacio_modalitat'] || {};
            const baseStatus = item.status || 'red';
            const modalitatScore = (baseStatus === 'green' ? 100 : baseStatus === 'amber' ? 40 : 0);
            const distScore = (kmValue <= radius) ? 100 : 0;
            const timeScore = (metrics.duration <= maxTimeSeconds) ? 100 : 0;
            
            const finalKpiScore = (modalitatScore * 0.4) + (distScore * 0.3) + (timeScore * 0.3);
            const finalStatus = finalKpiScore > 60 ? 'green' : finalKpiScore >= 30 ? 'amber' : 'red';
            
            // Actualitzar badge de pes
            const badge = document.getElementById('weight-badge-ubicacio_modalitat');
            if (badge) {
              const maxPes = 15; // El pes del KPI
              const earnedPes = (finalKpiScore * maxPes) / 100;
              const earnedText = Number.isInteger(earnedPes) ? earnedPes : earnedPes.toFixed(1);
              badge.textContent = `${earnedText}% / ${maxPes}%`;
            }

            // Actualitzar cercle de status
            const circle = document.getElementById('status-circle-ubicacio_modalitat');
            if (circle) {
              circle.className = `status-circle ${finalStatus}`;
            }

            // Actualitzar marcador global
            const newGlobalScore = calcularIndicadorGlobal(data, metrics);
            const globalText = document.getElementById('global-score-text');
            const globalMarker = document.getElementById('global-score-marker');
            if (globalText) globalText.textContent = `${newGlobalScore}%`;
            if (globalMarker) globalMarker.style.left = `${newGlobalScore}%`;

          } else {
            const metricsEl = document.getElementById('route-metrics');
            if (metricsEl) {
              metricsEl.textContent = "Ruta no disponible";
            }
          }
        });
      }
    }
  }, 50);
}

export function stopAnalysis() {
  if (state.analysisAbortController) {
    state.analysisAbortController.abort();
    state.analysisAbortController = null;
  }
}
