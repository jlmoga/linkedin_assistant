# RUMB - DOCUMENTACIÓ TÈCNICA

Aquest document detalla el funcionament, configuració i arquitectura de dades de l'aplicació Rumb.

---

## 1. COM OBRIR L'APLICACIÓ AL NAVEGADOR

### Tecnologies necessàries:
- Navegador web modern (Chrome, Edge o Firefox recomanats).
- NodeJS instal·lat (per utilitzar el servidor estàtic).
- L'aplicació és "Frontend Only" (HTML/CSS/JS), sense necessitat de base de dades externa (utilitza IndexedDB i LocalStorage).

### Ordres de terminal:
Per evitar problemes de CORS i carregar correctament tots els mòduls, s'ha d'executar un servidor local des de la carpeta arrel del projecte:

```powershell
npx serve . --listen 3500
```

### URL d'accés:
Un cop el servidor estigui actiu, obre el navegador a:
http://localhost:3500

---

## 2. INSTRUCCIONS SOBRE L'API KEY (GEMINI IA)

### Entorn tecnològic:
L'aplicació utilitza la Intel·ligència Artificial de Google per a l'anàlisi de dades.
- **Model**: gemini-2.5-flash
- **Versió API**: v1
- **Endpoint**: https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent

### Configuració de l'API Key:
1. **Accés a Google Cloud Console**: 
   - Entra a [Google Cloud Console](https://console.cloud.google.com/).
   - Si no tens un projecte, crea'n un de nou des del selector de projectes a la part superior.
2. **Administració de les API Keys**:
   - Al menú lateral esquerre, ves a **"APIs i Serveis"** > **"Credencials"**.
   - Fes clic a **"Crea credencials"** i selecciona **"Clau d'API"**.
   - Alternativament, si prefereixes un entorn més simplificat per a Gemini, pots utilitzar [Google AI Studio](https://aistudio.google.com/app/apikey).
3. **Configuració a l'App**:
   - Ves a la pestanya **"El meu CV"** (anteriorment "El meu perfil") de l'aplicació.
   - Al camp **"Gemini API Key"**, enganxa la teva clau.
   - Recorda prémer el botó **"Guardar"** al final del formulari per desar la configuració.
4. **Seguretat**: La clau es guarda de forma local al teu navegador (`localStorage`) i s'utilitza exclusivament per a les crides a l'API de Google des del teu propi dispositiu.

---

## 3. ALGORITME DE CREACIÓ DEL JSON

L'aplicació segueix un procés estructurat per transformar un document PDF en dades intel·ligents:

### Passos del procés:
1. **Extracció**: Es llegeix el text brut del PDF carregat.
2. **Merge de Configuració**: Es recuperen les preferències manuals (Salari mínim, Modalitat, Tags No-Go) des del `localStorage`.
3. **Prompting**: S'envia a Gemini el text del CV + les preferències de configuració amb una instrucció de "Recruiting Expert".
4. **Generació JSON**: L'IA retorna un objecte JSON estructurat amb el format definit al codi.
5. **Renderització**: L'aplicació transforma aquest JSON en **Markdown** (funció `renderJsonToMarkdown`) per mostrar la previsualització de "El teu perfil" de forma llegible.

### Estructura i origen de les dades:
- **Dades del CV**: Experiència laboral, educació, responsabilitats i stack tècnic històric.
- **Dades de Configuració (Override)**: Salari mínim anual, salari desitjat, modalitat de treball preferida, ràdio de desplaçament i tecnologies vetades (No-Go). Aquestes dades tenen prioritat sobre el que pugui dir el text del CV per garantir que l'anàlisi es basa en la teva situació actual.

---

## 4. PLANTILLA DEL JSON (CV)

L'esquelet del currículum que el sistema espera i manipula és el següent:

```json
{
  "configuracio_usuari": {
    "identitat_i_logistica": {
      "nom_complet": "Nom Cognom",
      "rol_actual": "Títol Professional",
      "adreça_base": {
        "carrer_i_numero": "C/...",
        "codi_postal": "08...",
        "poblacio": "Ciutat"
      }
    },
    "preferencies_i_filtres_infranquejables": {
      "salari_minim_anual": (int),
      "salari_desitjat": (int),
      "modalitat_treball": {
        "preferida": "Híbrid, Remot...",
        "dies_presencials_maxims_setmana": (int),
        "accepta_100_presencial": (bool),
        "accepta_100_remot": (bool)
      },
      "limits_desplaçament": {
        "distancia_maxima_km": (int),
        "temps_maxim_minuts": (int)
      }
    },
    "resum_professional": "Breu resum executiu...",
    "perfil_tecnic": {
      "stack_core": ["Tag1", "Tag2"],
      "stack_secundari": ["Tag3"],
      "skills": ["Skill1", "Skill2"],
      "tecnologies_vetades": ["Filtre1"],
      "idiomes": [{"idioma": "Català", "nivell": "Natiu"}]
    },
    "educacio_i_certificacions": [
      {
        "titol": "Grau en...",
        "institucio": "Universitat...",
        "any_finalitzacio": (int)
      }
    ],
    "historial_laboral": [
      {
        "empresa": "Nom Empresa",
        "sector": "Sector",
        "carrec": "Rol",
        "periode": "Anys",
        "stack_utilitzat": ["Tech1"],
        "skills_experiencia": ["Skill A", "Skill B"],
        "responsabilitats": ["Tasca 1", "Tasca 2"],
        "fites_clau": "Descripció d'un èxit..."
      }
    ]
  }
}
```

---

## 5. LLISTA DE KPIs D'AVALUACIÓ I REGLES DE MESURA

L'assistent desglossa l'anàlisi de compatibilitat en 8 Indicadors Clau de Rendiment (KPI). Cadascun s'avalua de forma autònoma i genera un indicador semafòric basat en les regles internes de la IA. Tot i que l'aplicació no utilitza un sistema de puntuació numèrica absoluta, l'impacte qualitatiu (pes) de cada KPI determina la viabilitat real de la candidatura.

### 1. Filtres Infranquejables (No-Go)
* **Descripció:** Analitza si l'oferta conté tecnologies, condicions o requisits que has marcat explícitament com a vetats.
* **Pes / Impacte:** Crític (Bloquejant). Un vermell aquí descarta virtualment la idoneïtat de la posició.
* **Colors:** 🟢 0 exclusions detectades | 🟡 1 requisit vetat | 🔴 2+ requisits vetats.

### 2. Avaluació Salarial Oferta
* **Descripció:** Compara el rang salarial de l'oferta amb el teu Salari Mínim i el teu Salari Desitjat.
* **Pes / Impacte:** Crític. Component decisiu per a la motivació del canvi.
* **Colors:** 🟢 Arriba o supera el Desitjat | 🟡 No informat o entre Mínim i Desitjat | 🔴 Inferior al Mínim.

### 3. Ubicació Territorial i Modalitat
* **Descripció:** Avalua si el règim de presencialitat exigit (Remot, Híbrid, Presencial) i la ubicació geogràfica casen amb les teves limitacions de mobilitat.
* **Pes / Impacte:** Alt. Indispensable per al dia a dia de la logística personal.
* **Colors:** 🟢 Encaixa perfectament | 🟡 Discrepància parcial o condicions ambigües.

### 4. Coincidències Stack Core
* **Descripció:** Grau d'alineament semàntic i exacte entre les teves eines clau de domini (Core) i els requisits fonamentals que exigeix la posició.
* **Pes / Impacte:** Alt. Defineix la capacitat operativa immediata per assumir el rol.
* **Colors:** 🟢 Més de 2 coincidències Core | 🟡 1 o 2 coincidències | 🔴 0 coincidències.

### 5. Idiomes Requerits
* **Descripció:** Verificació creuada entre els teus idiomes/nivells i la fluïdesa que exigeix expressament l'oferta (ex. Anglès C1).
* **Pes / Impacte:** Mitjà/Alt. Segons el sector, l'empresa pot flexibilitzar-ho o ser un requisit de cribratge rígid.
* **Colors:** 🟢 Compleix 100% o no demana idiomes explícitament | 🟡 Coincidència parcial | 🔴 Es reclamen idiomes desconeguts.

### 6. Encaix Stack Secundari
* **Descripció:** Match sobre tecnologies perifèriques o complementàries (Nice-to-have).
* **Pes / Impacte:** Mitjà. Suma punts per diferenciar la candidatura, però no és estrictament bloquejant.
* **Colors:** 🟢 Més de 2 coincidències | 🟡 1 o 2 coincidències | 🔴 0 coincidències.

### 7. Compatibilitat de Sector
* **Descripció:** Valora si la indústria a la qual pertany l'empresa de l'oferta es solapa amb àmbits on ja tens historial (Banca, IT, Indústria, etc.).
* **Pes / Impacte:** Baix. Facilita l'onboarding però normalment les habilitats tècniques són transversals.
* **Colors:** 🟢 Has treballat al sector abans | 🟡 És un canvi cap a un sector nou (valor neutre en realitat).

### 8. Educació i Certificats (Requerits)
* **Descripció:** Creuament auditat sobre titulacions universitàries, certificacions oficials (Scrum, PMP) segons exigència de l'oferta.
* **Pes / Impacte:** Baix/Molt Baix. Les posicions IT de perfil sènior valoren exponencialment més l'experiència pràctica. Només és rellevant en ofertes molt corporatives.
* **Colors:** 🟢 Més de 2 coincidències (o no demana res) | 🟡 1-2 coincidències | 🔴 Títols exigits on no se'n compleix cap.

### 8. Distribució de pesos per al càlcul d'un indicador global de compatibilitat

KPI,Pes Relatiu,Lògica d'Execució (Punts base sobre 100)
1. No-Go (El Comptador de Gripaus),25%,🟢 (0 exclusions detectades: 100 pts)🟡 (1 requisit vetat: 50 pts)🔴 (2 o + requisits vetats: 0 pts
2. Salari,20%,🟢 (>Desitjat: 100 pts)🟡 (Entre Mínim i Desitjat: 60 pts)🔴 (<Mínim: 0 pts
3. Ubicació Territorial i Modalitat,15%,🟢 (Encaixa perfectament: 100 pts)🟡 (Discrepància parcial o ambigüitat: 40 pts)🔴 (Presencial/Lluny de Mataró: 0 pts)
4. Stack Core,15%,🟢 (>2 coincidències Core: 100 pts)🟡 (1 o 2 coincidències: 50 pts)🔴 (0 coincidències: 0 pts)
5. Idiomes,10%,🟢 (Compleix 100% o no demana: 100 pts)🟡 (Coincidència parcial: 50 pts *)🔴 (Idiomes desconeguts / nivell inassolible: 0 pts)
6. Stack Secundari (Nice-to-have),5%,🟢 (>2 coincidències: 100 pts)🟡 (1 o 2 coincidències: 50 pts)🔴 (0 coincidències: 0 pts)
7. Compatibilitat de Sector,5%,"🟢 (sectors coincidents: 100 pts)🟡 (Nou sector: 60 pts)🔴 (Sector vetat, si n'hi ha: 0 pts)"
8. Educació i Certificats (Requerits),5%,🟢 (>2 coincidències: 100 pts)🟡 (1-2 coincidències: 50 pts)🔴 (Títols exigits on no se'n compleix cap: 0 pts)

---

## 6. INTEGRACIÓ AMB L'API ESCO (EUROPEAN SKILLS, COMPETENCES, QUALIFICATIONS AND OCCUPATIONS)

La pestanya **"Ventall professional"** permet consultar la base de dades europea d'ocupacions i competències (ESCO) per trobar encaixos basats en el CV de l'usuari.

### 6.1 Accés a l'API
L'API REST d'ESCO és d'accés obert (no requereix API Key) i permet cercar per text i recuperar ocupacions i skills associades. L'URL base és:
`https://ec.europa.eu/esco/api`

#### Endpoints principals:
1. **Cerca per text (Search):**
   Utilitzat per buscar ocupacions partint de termes normalitzats (que proporciona Gemini a partir del CV).
   - Accés: `GET /search?text={terme}&type=occupation&language={idioma}&limit={limit}`
   - Exemple: `https://ec.europa.eu/esco/api/search?text=project%20manager&type=occupation&language=en&limit=5`
2. **Recurs específic (Resource):**
   Utilitzat per consultar els detalls exactes d'una ocupació o skill un cop se'n coneix la URI (inclou les skills associades a una ocupació).
   - Accés: `GET /resource/occupation?uri={uri_ocupacio}&language={idioma}`

### 6.2 Llistat de camps dels repositoris (Model de Dades)

**Objecte Ocupació (Occupation):**
Aquests són els camps rellevants quan es fa una cerca o es recupera una ocupació:
- `uri`: Identificador únic universal (URL format) per a fer les crides de detall de l'ocupació.
- `title`: Títol oficial principal de l'ocupació (ex. "software developer").
- `preferredLabel`: Diccionari de codis d'idioma i les corresponents traduccions del títol recomanat.
- `code`: Codi estandarditzat de l'ocupació.
- `_links`: Objectes amb URLs útils de ruteig semàntic.

Al demanar el detall d'una ocupació (`resource/occupation`), aquesta conté els arrays de referència a les eines o habilitats esperades d'aquell perfil professional:
- `_links.hasEssentialSkill`: Llistat d'apuntadors a skills que són **obligatòries** per a l'ocupació.
- `_links.hasOptionalSkill`: Llistat d'apuntadors a skills que són **opcionals o recomanades**.

**Objecte Skill/Competència:**
Dins dels nodes d'informació d'skills (ex. `hasEssentialSkill`), o al consultar la seva pròpia URI de recurs, trobarem:
- `uri`: Identificador únic universal de la competència.
- `title`: Nom de la competència o habilitat (ex. "Python (computer programming)", "sales argumentation").
- `skillType`: Categoria que discrimina si és una habilitat/destresa teòrica o pràctica:
  - `http://data.europa.eu/esco/skill-type/knowledge`: Denota coneixements teòrics i aprenentatges ("characteristics of products").
  - `http://data.europa.eu/esco/skill-type/skill`: Denota habilitats i destreses pràctiques ("operate cash register").

---
Creat per Antigravity AI - 2026
