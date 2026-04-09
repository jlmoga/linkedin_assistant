/**
 * API Communication (Gemini & ESCO)
 */

import { AI_TIMEOUT_MS } from './config.js';
import { state } from './state.js';
import { updateAiStatus } from './ui-utils.js';
import { timeToMinutes } from './utils.js';

/**
 * Descobreix el millor model disponible per a la clau d'IA facilitada.
 */
export async function discoverBestAvailableModel(apiKey, excludeModel = null) {
  try {
    updateAiStatus("Buscant alternatives de models IA...", true);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const availableModels = data.models || [];
    
    let candidates = availableModels
      .filter(m => m.supportedMethods && m.supportedMethods.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    
    if (excludeModel) {
        candidates = candidates.filter(c => c !== excludeModel);
    }
    
    if (candidates.length === 0) return null;

    const sorted = candidates.sort((a, b) => {
      const getVersion = (name) => {
          const match = name.match(/(\d+\.\d+|\d+)/);
          return match ? parseFloat(match[0]) : 0;
      };
      
      const vA = getVersion(a);
      const vB = getVersion(b);
      
      if (vA !== vB) return vB - vA;
      
      const getModelTypePriority = (name) => {
        const n = name.toLowerCase();
        if (n.includes('pro')) return 0;
        if (n.includes('flash')) return 1;
        return 2;
      };
      
      const pA = getModelTypePriority(a);
      const pB = getModelTypePriority(b);
      
      if (pA !== pB) return pA - pB;
      return b.localeCompare(a);
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
 * Helper per fer crides a Gemini amb suport de reintents.
 */
export async function fetchGeminiWithRetry(url, options, maxRetries = 3, initialDelay = 1000, onRetry = null, signal = null, currentModelName = 'gemini-2.5-flash') {
  let lastError;
  let currentUrl = url;
  let localActiveModel = currentModelName;
  let fallbackAttempted = false;

  for (let i = 0; i < maxRetries; i++) {
    if (signal && signal.aborted) throw new Error('AbortError');

    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), AI_TIMEOUT_MS);
      
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
      
      const fetchOptions = { ...options, signal: combinedSignal };
      const response = await fetch(currentUrl, fetchOptions);
      
      clearTimeout(timeoutId);
      
      if (response.ok) return response;

      const responseStatus = response.status;
      let triggerFallback = false;
      
      if (responseStatus === 404) {
        triggerFallback = true;
      } else if (!fallbackAttempted) {
        if (responseStatus === 500 && i >= 0) {
          triggerFallback = true;
        } else if ((responseStatus === 503 || responseStatus === 429) && i === maxRetries - 1) {
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
          
          state.activeModel = fallbackModel;
          localActiveModel = fallbackModel;
          fallbackAttempted = true;
          
          const urlObj = new URL(currentUrl);
          urlObj.pathname = urlObj.pathname.replace(currentModelName || state.activeModel, fallbackModel);
          currentUrl = urlObj.toString();
          
          i = -1; 
          continue;
        } else if (responseStatus === 404) {
          throw new Error("El model seleccionat no existeix i no s'han trobat alternatives.");
        }
      }

      if (responseStatus === 503 || responseStatus === 429 || responseStatus === 500) {
        lastError = new Error(`IA ocupada/Error (${responseStatus}). S'han esgotat els reintents.`);
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

      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody.error?.message || `Error ${responseStatus}`;
      lastError = new Error(message);
      throw lastError;

    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'AbortError') {
        if (signal && signal.aborted) throw err;
        
        lastError = new Error(`Temps d'espera esgotat (${AI_TIMEOUT_MS/1000}s).`);
        updateAiStatus(`Temps d'espera esgotat. Reintentant...`, true);
        
        const delay = initialDelay * Math.pow(2, Math.max(0, i));
        await new Promise(res => setTimeout(res, delay));
        continue;
      }

      lastError = err;
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
 * Funció mestra per a totes les crides a la IA.
 */
export async function callGemini(prompt, onRetry = null, signal = null, isJson = false) {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const apiKey = profile.geminiKey || '';
  
  if (!apiKey) {
    throw new Error("Falta la clau d'IA (API Key).");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.activeModel}:generateContent?key=${apiKey}`;

  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(isJson && { generationConfig: { responseMimeType: "application/json" } })
    })
  };

  const response = await fetchGeminiWithRetry(endpoint, fetchOptions, 3, 1000, onRetry, signal, state.activeModel);
  const data = await response.json();
  
  let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  if (isJson) {
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

/**
 * Crida específica per al processament inicial del CV.
 */
export async function callGeminiAPI(key, text, onRetry = null, signal = null) {
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
        "perfil_tecnic": {
          "resum_professional": "Resumeix el perfil en 2-3 frases potents",
          "stack_core": ["Llista de 5-8 tecnologies/skills troncals"],
          "stack_secundari": ["Llista d'altres tecnologies/skills"],
          "tecnologies_vetades": ["Si al CV indica que no vol treballar amb X"],
          "idiomes": [
            {"idioma": "...", "nivell": "Natiu/C2/C1/B2/B1..."}
          ]
        },
        "historial_laboral": [
          {
            "empresa": "...",
            "carrec": "...",
            "periode": "...",
            "sector": "...",
            "responsabilitats": ["..."],
            "fites_clau": "Breu descripció d'un èxit",
            "stack_utilitzat": ["..."]
          }
        ],
        "educacio_i_certificacions": [
          {
            "titol": "...",
            "institucio": "...",
            "any_finalitzacio": "..."
          }
        ]
      }
    }

    RESUM DEL CV A PROCESSAR:
    ${text}
  `;

  return callGemini(prompt, onRetry, signal, true);
}

/**
 * Recupera dades d'ESCO per a una descripció d'ocupació.
 */
export async function fetchEscoData(ocDesc, signal) {
  if (state.escoCache.resource.has(ocDesc)) return state.escoCache.resource.get(ocDesc);

  let uri = ocDesc;
  let titleEsco = "";
  
  if (!ocDesc.startsWith('http')) {
    if (state.escoCache.search.has(ocDesc)) {
      uri = state.escoCache.search.get(ocDesc);
    } else {
      const sRes = await fetch(`https://ec.europa.eu/esco/api/search?language=en&type=occupation&text=${encodeURIComponent(ocDesc)}`, { signal });
      const sData = await sRes.json();
      
      // ESCO Search API results are in _embedded.results
      const bestMatch = sData._embedded?.results?.[0] || sData._links?.items?.[0];
      uri = bestMatch?.uri || "";
      titleEsco = bestMatch?.title || "";
      
      if (uri) state.escoCache.search.set(ocDesc, uri);
    }
  }

  if (!uri) return { titol: ocDesc, skills: [], uri: "" };
  if (state.escoCache.resource.has(uri)) return state.escoCache.resource.get(uri);

  const rRes = await fetch(`https://ec.europa.eu/esco/api/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`, { signal });
  const resData = await rRes.json();
  
  let skills = [];
  const processSkillLinks = (links, isEssential) => {
    if (!links) return;
    links.forEach(s => {
      // Per al matching amb el diccionari de la IA, els skills han d'estar en anglès
      const skillTitle = s.title || (s.preferredLabel ? (s.preferredLabel.en || s.preferredLabel.ca || s.preferredLabel.es) : "Untitled Skill");
      skills.push({ ...s, title: skillTitle, isEssential });
    });
  };

  processSkillLinks(resData._links?.hasEssentialSkill, true);
  processSkillLinks(resData._links?.hasOptionalSkill, false);

  const result = { titol: resData.title || titleEsco || ocDesc, skills, uri };
  state.escoCache.resource.set(ocDesc, result);
  state.escoCache.resource.set(uri, result);
  return result;
}
