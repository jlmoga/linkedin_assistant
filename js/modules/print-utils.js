/**
 * Print Utilities
 */

import * as uiUtils from './ui-utils.js';

export function imprimirInforme() {
  const ofertaDocs = document.getElementById('content-oferta');
  const analisiDocs = document.getElementById('content-analisi');

  if (!ofertaDocs || !analisiDocs || !analisiDocs.innerHTML.trim()) {
    uiUtils.updateHeaderStatus("amber", "Sense anàlisi", "Primer has de completar l'anàlisi d'una oferta per poder-la imprimir.");
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

  setTimeout(() => {
    printWindow.print();
  }, 500);
}

export function imprimirCV() {
  const cvDocs = document.getElementById('content-cv');

  if (!cvDocs || !cvDocs.innerHTML.trim()) {
    uiUtils.updateHeaderStatus("amber", "Sense perfil", "No hi ha dades generades per imprimir el CV.");
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
