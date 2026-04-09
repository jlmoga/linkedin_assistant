/**
 * Cover Letter Generation
 */

import * as dom from './dom.js';
import { state } from './state.js';
import { callGemini } from './api.js';
import * as uiUtils from './ui-utils.js';

export function updateCoverLetterUI() {
  if (!dom.cartaEmpty || !dom.cartaActive) return;
  
  if (state.currentJobAnalysis) {
    dom.cartaEmpty.hidden = true;
    dom.cartaActive.hidden = false;
  } else {
    dom.cartaEmpty.hidden = false;
    dom.cartaActive.hidden = true;
  }
}

export async function handleGenerateCoverLetter() {
  const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');
  const geminiKey = profile.geminiKey;
  
  if (!geminiKey) {
    uiUtils.updateHeaderStatus("amber", "Falta API Key", "Configura la teva Gemini API Key a la pestanya 'Configuració'.");
    uiUtils.activateTab('configuracio');
    return;
  }

  if (!state.currentJobAnalysis) {
    uiUtils.updateHeaderStatus("amber", "Sense anàlisi", "Cal fer una anàlisi d'oferta abans de generar la carta.");
    uiUtils.activateTab('examina-oferta');
    return;
  }

  dom.btnGenerarCarta.disabled = true;
  dom.btnGenerarCarta.innerHTML = `<span class="spinner-small"></span> Generant...`;
  dom.contentCarta.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 40px;">
      <div class="spinner-medium" style="margin-bottom: 20px;"></div>
      <p style="color: var(--text-secondary); font-weight: 500;">La màgia està succeint... Redactant la teva carta personalitzada.</p>
    </div>
  `;

  try {
    const jobText = document.getElementById('content-oferta').innerText;
    
    const config = {
      contacte: dom.btnCheckContacte.classList.contains('active'),
      empresa: dom.btnCheckEmpresa.classList.contains('active'),
      resaltar: dom.btnCheckResaltar.classList.contains('active'),
      formalitat: dom.selectToCarta.options[dom.selectToCarta.selectedIndex].text,
      enfocament: dom.selectEnfocament.options[dom.selectEnfocament.selectedIndex].text,
      longitud: dom.selectLongitud.options[dom.selectLongitud.selectedIndex].text,
      idioma: dom.selectIdioma.options[dom.selectIdioma.selectedIndex].text,
      notes: dom.textareaNotesCarta.value.trim(),
      dataActual: new Date().toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    };

    const prompt = `
      Actua com un Career Coach Senior i Expert en Copywriting Persuasiu.
      LA TEVA TASCA ÉS REDACTAR UNA CARTA DE PRESENTACIÓ LLIMPIDA, PROFESSIONAL I LLESTA PER A SER ENVIADA.

      DADES D'ENTRADA:
      1. PERFIL CANDIDAT (El meu CV): ${JSON.stringify(profile)}
      2. DETALL DE L'OFERTA (Text): ${jobText}
      3. ANÀLISI DE COMPATIBILITAT: ${JSON.stringify(state.currentJobAnalysis)}
      
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
      uiUtils.updateAiStatus(`Redactant la carta... (reintent ${retry}/${total})`);
    };

    uiUtils.updateAiStatus("Redactant la teva carta personalitzada...");
    const resultText = await callGemini(prompt, onRetry);

    dom.contentCarta.innerHTML = marked.parse(resultText);
    dom.btnCopiarCarta.disabled = false;
    dom.btnImprimirCarta.disabled = false;
    uiUtils.updateAiStatus("Carta generada amb èxit!");

  } catch (err) {
    console.error('Error generant carta:', err);
    const errorMsg = err?.message || "S'ha produït un error inesperat a la IA.";
    uiUtils.updateHeaderStatus("amber", "IA No Disponible", errorMsg);
    dom.contentCarta.innerHTML = `<p style="color:red; padding: 20px;">🔴 Error al generar la carta: ${errorMsg}</p>`;
  } finally {
    dom.btnGenerarCarta.disabled = false;
    dom.btnGenerarCarta.innerHTML = `Generar Carta de Presentació ✨`;
  }
}

export async function copyCoverLetterToClipboard() {
  const text = dom.contentCarta.innerText;
  try {
    await navigator.clipboard.writeText(text);
    const originalText = dom.btnCopiarCarta.innerHTML;
    dom.btnCopiarCarta.innerHTML = `✅ Copiat!`;
    setTimeout(() => {
      dom.btnCopiarCarta.innerHTML = originalText;
    }, 2000);
  } catch (err) {
    console.error('Error al copiar:', err);
  }
}

export function imprimirCarta() {
  const content = dom.contentCarta;

  if (!content || !content.innerHTML.trim() || content.innerHTML.includes('Selecciona el to')) {
    uiUtils.updateHeaderStatus("amber", "Sense contingut", "Primer has de generar una carta per imprimir-la.");
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
