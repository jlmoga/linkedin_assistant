/**
 * Ventall Professional (Occupation Discovery)
 */

import * as dom from './dom.js';
import { state } from './state.js';
import { callGemini, fetchEscoData } from './api.js';
import * as uiUtils from './ui-utils.js';

export async function handleGenerarOcupacions() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const apiKey = profile.geminiKey || '';
  if (!apiKey) {
    alert("Si us plau, afegeix la teva Gemini API Key a 'El meu CV' abans d'explorar les ocupacions.");
    return;
  }

  state.analysisAbortController = new AbortController();
  const signal = state.analysisAbortController.signal;

  try {
    dom.btnGenerarOcupacions.disabled = true;
    dom.ocupacionsLoader.style.display = 'flex';
    uiUtils.updateVentallProgress(0, "Connectant amb l'eina intel·ligent i perfilant l'historial...");

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

    const [dataOcc, userSkills] = await Promise.all([
      (async () => {
        uiUtils.updateVentallProgress(5, "Consultant la IA sobre les ocupacions més adients per a tu...");
        return callGemini(promptOcupacions, (retry, total) => {
          uiUtils.updateVentallProgress(5 + (retry * 2), `Explorant ventall... (reintent ${retry}/${total})`);
        }, signal, true);
      })(),
      (async () => {
        return callGemini(promptSkills, null, signal, true);
      })()
    ]);
    
    uiUtils.updateVentallProgress(45, "✓ IA: Perfil i ocupacions identificades. Iniciant processament ESCO...");

    const ocupacionsArray = Array.isArray(dataOcc) ? dataOcc : (dataOcc.ocupacions || []);
    const userSkillsDictionary = (Array.isArray(userSkills) ? userSkills : (userSkills.skills || userSkills.userSkills || [])).map(s => s.toLowerCase());

    if (dom.diccionariOcupacionsText) {
      dom.diccionariOcupacionsText.textContent = JSON.stringify(ocupacionsArray, null, 2);
    }
    if (dom.diccionariSkillsText) {
      dom.diccionariSkillsText.textContent = JSON.stringify(userSkillsDictionary, null, 2);
    }

    dom.ventallResults.hidden = false;
    dom.llistaOcupacions.innerHTML = '';
    
    const globalContainer = renderGlobalSummaryPlaceholder();
    
    let escoCallsCompleted = 0;
    let resultsForGlobal = [];
    const totalOcc = ocupacionsArray.length;

    const fetchAndRender = async (ocDesc) => {
        try {
            const ocObj = await fetchEscoData(ocDesc, signal);
            resultsForGlobal.push(ocObj);
            
            const card = renderOccupationCard(ocObj, userSkillsDictionary);
            dom.llistaOcupacions.appendChild(card);
            
            escoCallsCompleted++;
            const currentPct = Math.round(45 + ((escoCallsCompleted / totalOcc) * 50));
            uiUtils.updateVentallProgress(currentPct, `Processant ocupacions ESCO (${escoCallsCompleted} de ${totalOcc})...`);
            
            updateGlobalSummary(globalContainer, resultsForGlobal, userSkillsDictionary);
        } catch (e) {
            console.error('Error processant ocupació:', ocDesc, e);
            escoCallsCompleted++;
        }
    };

    await Promise.all(ocupacionsArray.map(ocDesc => fetchAndRender(ocDesc)));

    uiUtils.updateVentallProgress(100, "✓ Procés completat correctament.");
    
    if (globalContainer) {
      const countLabel = globalContainer.querySelector('#global-count-val');
      if (countLabel) countLabel.textContent = `✓ Basat en ${ocupacionsArray.length} ocupacions analitzades.`;
    }
    dom.ventallResults.hidden = false;

  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'AbortError') return;
    console.error('Error Ventall:', err);
    dom.ventallResults.hidden = false;
    dom.llistaOcupacions.innerHTML = `
      <div class="info-alert" style="background-color: #fce8e6; border-color: #ea4335; color: #b21414;">
        <span><strong>IA No Disponible:</strong> ${err.message || 'No s\'ha pogut processar la informació.'}</span>
      </div>
    `;
  } finally {
    dom.btnGenerarOcupacions.disabled = false;
    dom.ocupacionsLoader.style.display = 'none';
    state.analysisAbortController = null;
  }
}

export function renderGlobalSummaryPlaceholder() {
  const container = document.createElement('div');
  container.className = 'global-summary-card';
  container.style.cssText = 'padding: 24px; background: var(--li-blue-faint); border-radius: var(--radius-lg); border: 1px solid var(--li-blue-light); margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;';
  dom.llistaOcupacions.appendChild(container);
  return container;
}

export function updateGlobalSummary(container, results, userSkillsDict) {
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

  if (!container.innerHTML || container.innerHTML.includes('Esperant dades')) {
    container.innerHTML = `
      <div style="flex: 1; min-width: 300px;">
        <h4 style="margin: 0 0 16px 0; font-size: 1.1rem; color: var(--li-blue); font-weight: 700;">Assoliment global del teu perfil professional (ESCO)</h4>
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <div style="background: #fff; border: 1px solid #cce8d5; border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 120px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <div id="global-ess-val" style="font-size: 2.2rem; font-weight: 800; color: #137333; line-height: 1;">${essConf}</div>
            <div style="font-size: 0.75rem; color: #137333; font-weight: 600; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px;">Essencials</div>
          </div>
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
    container.querySelector('#global-ess-val').textContent = essConf;
    container.querySelector('#global-opt-val').textContent = optConf;
    
    const countLabel = container.querySelector('#global-count-val');
    if (countLabel) {
       countLabel.textContent = `Processant ocupacions... (${results.length})`;
    }
  }
}

export function renderOccupationCard(ocObj, userSkillsDictionary) {
  const card = document.createElement('div');
  card.style.cssText = 'padding: 16px; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 12px; display: flex; flex-direction: column; gap: 0;';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer; gap: 16px; padding-bottom: 8px;';
  
  const titleArea = document.createElement('div');
  titleArea.style.cssText = 'display: flex; align-items: center; gap: 12px; flex: 1;';

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
  content.style.cssText = 'display: none; flex-direction: column; gap: 12px; border-top: 1px solid var(--border);';
  content.style.paddingTop = '12px';
  card.appendChild(content);

  const skills = ocObj.skills || [];
  const matched = [];
  const unmatched = [];
  
  skills.forEach(sk => {
     const skLower = (sk.title || '').toLowerCase();
     if (userSkillsDictionary.some(u => skLower.includes(u) || u.includes(skLower))) matched.push(sk);
     else unmatched.push(sk);
  });

  matched.sort((a,b) => (b.isEssential ? 1 : 0) - (a.isEssential ? 1 : 0));
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

export function processSkillElement(sk, userSkillsDictionary, isCompact = false) {
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
