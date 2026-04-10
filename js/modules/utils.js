/**
 * General Utilities
 */

export function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function renderJsonToMarkdown(jsonStr) {
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

    md += `## 📝 Resum Professional\n${tecnic.resum_professional || config.resum_professional || "Sense resum"}\n\n`;

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

/**
 * Neteja l'HTML de tags no rellevants (scripts, styles, etc.) per reduir el pes enviat a la IA.
 */
export function cleanHtml(html) {
  if (!html) return "";
  
  // Creem un element temporal per parsejar l'HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Eliminem tags brossa
  const tagsToRemove = ['script', 'style', 'noscript', 'iframe', 'svg', 'path', 'meta', 'link', 'nav', 'footer', 'header'];
  tagsToRemove.forEach(tag => {
    const elements = doc.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });

  // Retornem el text netejat (o el body simplificat)
  // Per a Gemini, el innerText acostuma a ser suficient i estalvia molts tokens
  return doc.body ? doc.body.innerText.replace(/\s+/g, ' ').trim() : "";
}

