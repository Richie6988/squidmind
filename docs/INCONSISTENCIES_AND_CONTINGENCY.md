# IAQUA — Audit des Inconsistances & Plan de Contingence

> **STATUS : TOUTES LES INCONSISTANCES RÉSOLUES** — commits `137f938` → `a3326b6`  
> Audit initial : 2026-06-22 · Résolution : 2026-06-22

**Audit effectué le :** 2026-06-22  
**Méthode :** Cross-check ligne par ligne entre README, code serveur et code client.  
**Criticité :** 🔴 Critique (fonctionnalité cassée) · 🟠 Significatif (comportement incorrect) · 🟡 Mineur (cosmétique ou dette technique)

---

## RÉSUMÉ EXÉCUTIF

L'audit révèle **4 bugs critiques structurels** qui rendent des fonctionnalités centrales non opérationnelles, **6 bugs significatifs** qui dégradent silencieusement le système, et **5 points mineurs**. Le plus grave : **les agents n'exécutent jamais de tâches en tant qu'agents** — tout passe par Poseidon en mode BG, et les résultats ne s'écrivent jamais dans `results_log.json` depuis le chemin TaskRunner.

---

## BLOC 1 — CRITIQUES 🔴

### ✅ IC-01 : TaskRunner ne calle jamais `closeTask()` → results_log vide

**Impact :** Les tâches terminées par TaskRunner disparaissent du registry (`_writeTaskDetails` les purge) mais ne sont **jamais** écrites dans `results_log.json`. La pane Results dans le Control Tower reste vide. `closeTask()` dans RegistryManager est la **seule** méthode qui écrit dans results_log — elle n'est jamais appelée par TaskRunner.

**Preuve :**
```
TaskRunner._setStatus('completed')
  → rm._writeTaskDetails(taskId, task)        ← purge du registry OK
  → AUCUN appel à rm.closeTask() ni results_log écriture
```
`grep -r "closeTask" server/services/TaskRunner.js` → aucun résultat.

**Fix :** Dans `TaskRunner._setStatus()`, après `_writeTaskDetails`, écrire directement à `results_log.json` :

```javascript
// In TaskRunner._setStatus, add after _writeTaskDetails for terminal statuses:
if (status === 'completed' || status === 'failed') {
  try {
    const AQUARIUM = require('../aquarium');
    const fsp = require('fs').promises;
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
    rlog.results[taskId] = {
      task_id:        taskId,
      title:          task.title,
      task_type:      task.task_type || 'text',
      status,
      result_summary: task.result_summary || null,
      result_file:    task.result_file || null,
      completed_at:   task.completed_at || new Date().toISOString(),
      assigned_name:  task.assigned_to || null,
      project_name:   task.project_name || null,
    };
    await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
  } catch (e) { console.warn('[TaskRunner] results_log write failed:', e.message); }
}
```

---

### ✅ IC-02 : TaskRunner lit `task.assignment?.assigned_to` mais les tâches ont `task.assigned_to`

**Impact :** `agentId` est **toujours `null`** dans TaskRunner. Conséquences en cascade :
- Toutes les tâches s'exécutent via Poseidon BG mode même si assignées à un agent
- La contrainte "un task par agent" ne fonctionne jamais (agentId null → jamais dans agentsRunning)
- Les agents ne passent jamais `active` pendant une tâche
- `_updateProjectMemoryForTask` utilise `task.assignment?.assigned_name` → toujours `undefined` → les messages "agent sync" dans la mémoire projet disent toujours "poseidon"

**Preuve :**
```javascript
// TaskRunner.js ligne 274:
const agentId = task.assignment?.assigned_to || null;  // ← toujours null
// Mais _createTask et createTask créent :
{ assigned_to: agent_id }                              // ← pas de .assignment wrapper
```
`grep -r "assignment:" server/ | grep -v "?\|//"` → aucun résultat. Le champ `assignment` n'est **jamais écrit**.

**Fix :** Remplacer toutes les lectures `task.assignment?.assigned_to` par `task.assigned_to` dans TaskRunner, et `task.assignment?.assigned_name` par le display_name résolu depuis le registry :

```javascript
// TaskRunner.js — remplacer systématiquement :
const agentId = task.assignment?.assigned_to || null;
// →
const agentId = task.assigned_to || null;

// Et pour le nom affiché, résoudre via registry :
const agentEntry = agentRegistry.agents?.[agentId];
const agentName  = agentEntry?.display_name || agentId;
```

---

### ✅ IC-03 : `cascadeTaskClosure()` utilise `task.assignment.assigned_to` et `task.context.project_id` — jamais définis

**Impact :** `cascadeTaskClosure()` dans RegistryManager (appelé uniquement depuis `closeTask()`) ne met jamais à jour :
- `agent.performance_summary.tasks_completed` → les squids ne montent **jamais de niveau**
- `project.metrics.tasks_completed` → les métriques projet ne s'incrémentent jamais

La formule de level-up est `floor(sqrt(tasks_completed)) + 1`. Puisque `tasks_completed` reste à 0, tous les agents restent niveau 1 à vie.

**Preuve :**
```javascript
// RegistryManager.cascadeTaskClosure() ligne 1232 :
if (task.assignment.assigned_to) { ... }      // ← undefined → jamais exécuté
if (task.context.project_id) { ... }           // ← undefined → jamais exécuté
```

**Fix (double) :**
1. Corriger `cascadeTaskClosure()` pour lire les bons champs :
```javascript
const agentId   = task.assignment?.assigned_to || task.assigned_to || null;
const projectId = task.context?.project_id     || task.project_id  || null;
```
2. Appeler `cascadeTaskClosure()` depuis TaskRunner `_setStatus('completed')` (puisque `closeTask` n'est pas appelé).

---

### ✅ IC-04 : `buildSystemPrompt()` injecte temp.md même si elle contient uniquement le marqueur `<!-- cleared -->`

**Impact :** Après un dream, temp.md est effacée avec `<!-- cleared after dream on 2025-... -->` (~56 chars). `buildSystemPrompt` vérifie seulement `raw.length > 50` — le marqueur PASSE ce seuil. Poseidon reçoit donc le marqueur HTML comme "log d'interactions récentes", ce qui pollue le contexte et peut perturber le comportement.

**Preuve :**
```javascript
// PoseidonOrchestrator.js ligne 134 :
if (raw.length > 50) {   // ← "<!-- cleared after dream on 2025-06-17T22:00:00.000Z -->" = 56 chars → PASSE
  const excerpt = ...    // ← injecte le marqueur
}
```

**Fix :** Ajouter le guard `startsWith('<!--')` :
```javascript
if (raw.length > 50 && !raw.startsWith('<!--')) {
```

---

## BLOC 2 — SIGNIFICATIFS 🟠

### ✅ IC-05 : AgentWorker / AgentWorkerPool est du code mort pour l'exécution automatique

**Impact :** Le README décrit AgentWorker comme le moteur d'exécution des tâches agent. En réalité, TaskRunner stocke `this.agentPool` mais **ne l'appelle jamais** (`this.agentPool.` n'apparaît qu'à la ligne de déclaration). PoseidonOrchestrator stocke `this.agentWorkerPool` mais ne l'utilise pas non plus. AgentWorker n'est utilisé que via la route manuelle `/api/v2/agents/:id/run`.

**Conséquence architecturale :** Toute l'exécution de tâches passe par `chatWithPoseidon(..., { _bgMode: true })`. Les agents n'ont pas de session LLM distincte, ne chargent pas leurs skills automatiquement, et ne peuvent pas utiliser des modèles différents de Poseidon.

**Fix court terme :** Documenter clairement que l'AgentWorkerPool est réservé à l'exécution manuelle (route `/run`). Ajouter un commentaire dans TaskRunner.

**Fix long terme :** Si l'exécution multi-modèle par agent est souhaitée, brancher `this.agentPool.dispatch(agentId, taskMsg)` dans TaskRunner quand `agentId !== null && agentId !== 'poseidon_main'`.

---

### ✅ IC-06 : `failed` non inclus dans `terminalStatuses` → accumulation indéfinie dans le registry

**Impact :** Les tâches `failed` restent dans `tasks_registry.json` indéfiniment. `_writeTaskDetails` avec status `failed` ne les purge pas (terminalStatuses = `['completed', 'cancelled', 'archived']`, pas `'failed'`). Sur un système long-terme, le registry gonfle.

**Preuve :** `RegistryManager.js ligne 1083` : `const terminalStatuses = new Set(['completed', 'cancelled', 'archived']);`

**Fix :** Ajouter `'failed'` aux terminal statuses dans `_writeTaskDetails`, ET écrire à results_log (via IC-01 fix) avant purge.

---

### ✅ IC-07 : ReasoningBus — Temple n'affiche que les tâches Poseidon BG, pas les tâches agent ni le chat utilisateur

**Impact :** Le stream de raisonnement dans le Temple (panneau live) est alimenté uniquement par `TaskRunner.chatWithPoseidon` (les tâches BG). Ni le chat utilisateur avec Poseidon (`buildPoseidonChatRoute`), ni les tâches exécutées via AgentWorker (`/agents/:id/run`) ne poussent vers `ReasoningBus`. Le stream paraît vide en utilisation normale.

**Preuve :** `grep -r "ReasoningBus" server/` → un seul résultat dans TaskRunner, ligne 512.

**Fix :** Dans `buildPoseidonChatRoute` (modelRoutes.js), pousser les chunks vers ReasoningBus en parallèle :
```javascript
if (global.ReasoningBus) global.ReasoningBus.push({ type: 'text', task_id: 'chat', chunk: ev.chunk });
```
Dans AgentWorkerPool.dispatch, également pousser les events au bus.

---

### ✅ IC-08 : `_idMutex` dans RegistryManager — fuite mémoire sur longue durée

**Impact :** La chaîne de promesses `_idMutex` n'est jamais nettoyée. Pour des serveurs long-lived avec beaucoup de génération d'IDs, la Map grandit indéfiniment. Pas un crash risk immédiat mais une fuite réelle.

**Fix :** Dans le `finally` de `generateNextId`, nettoyer après résolution uniquement si la promesse actuelle est toujours la dernière (le suivant n'a pas encore remplacé) :
```javascript
} finally {
  resolveMutex();
  // Clean up resolved promise to prevent unbounded chain growth
  if (this._idMutex.get(rp) === current) this._idMutex.delete(rp);
}
```

---

### ✅ IC-09 : `_defaultIdFormat` retourne `'task_NNN'` (3 chiffres) mais `padStart(4, '0')` génère 4 chiffres

**Impact :** Format incohérent. Les métadonnées stockent `id_format: 'task_NNN'` mais les IDs produits sont `task_0120` (4 chiffres). Pas fonctionnellement cassé mais le format stocké est trompeur. Les anciens IDs `task_119` coexistent avec les nouveaux `task_0120`.

**Fix :** Changer `_defaultIdFormat` pour retourner `'task_NNNN'` et `padStart(4, '0')`, et mettre à jour le seed `tasks_registry.json` metadata :
```javascript
if (registryPath.includes('task')) return 'task_NNNN';
```

---

### ✅ IC-10 : `git_workflow.json` existe dans `server/skills/` mais absent du README catalog

**Impact :** Une skill entière (workflow git automatisé) n'est pas documentée. Les utilisateurs et Poseidon ne savent pas qu'elle existe. Le README liste 14 skills mais il y en a 15.

**Fix :** Ajouter `git_workflow` au tableau §9 du README avec sa description.

---

## BLOC 3 — MINEURS 🟡

### ✅ IC-11 : `api.js` (legacy) est chargé dans index.html mais n'est pas utilisé

**Impact :** 43 lignes de code mort chargées inutilement. Pas de conflit (il définit `window.api` que rien n'utilise), mais pollution de l'espace global.

**Fix :** Retirer `<script src="scripts/api.js"></script>` de index.html et supprimer le fichier.

---

### ✅ IC-12 : `PanelResizer._persistWidth` utilise `'main/poseidon_brain.json'` (ancien chemin legacy)

**Impact :** La persistance de la largeur du panneau Control Tower via l'API `/field` utilise le chemin `main/poseidon_brain.json` qui correspond à l'ancien layout `data/`. En layout `aquarium/`, le bon chemin est `BRAIN/poseidon_brain.json`. La largeur du panneau ne se sauvegarde jamais côté serveur (localStorage fonctionne en fallback).

**Fix :**
```javascript
filePath: 'BRAIN/poseidon_brain.json',
```

---

### ✅ IC-13 : `SKILL_UPDATE` du dream — le format pipe-séparé est ambigu si les steps contiennent des pipes

**Impact :** Le regex `^SKILL_UPDATE: skill_id|name|summary|steps...` capture tout après le 4e pipe comme steps à splitter sur pipe. Si un step contient ` | ` naturellement (ex: "Use web_fetch | save to file"), il sera splitté incorrectement.

**Fix :** Utiliser un délimiteur moins commun (ex: `;;` ou `→`) pour les steps, ou switcher vers un bloc JSON pour les mises à jour de skills.

---

### ✅ IC-14 : Squids "RUN" vs "IDLE" dans TempleInterior basé sur une heuristique de nom

**Impact :** Temple détermine si un agent "tourne" en comparant des chaînes de noms (`isRun`). Sans branchement vers l'état réel des tâches, un agent peut afficher "RUN" incorrectement si le nom coïncide avec un critère heuristique.

**Fix :** Lire l'état `status` depuis le registry (déjà chargé) plutôt qu'inférer depuis le nom.

---

### ✅ IC-15 : Skill seeds re-seedent si le fichier aquarium est supprimé manuellement

**Comportement :** Si un utilisateur supprime manuellement `aquarium/SKILLS/research_flow.json` (sans passer par DELETE route), la skill sera re-créée au prochain démarrage car `!existsSync(dst) = true`. DELETE route supprime aussi le fichier seed source, mais la suppression manuelle ne touche pas le seed.

**C'est le comportement documenté et acceptable**, mais mérite d'être noté. Ajouter un `.skills_deleted` blocklist si l'isolation est requise.

---

## PLAN DE CONTINGENCE — SPRINTS PRIORITAIRES

### Sprint 1 — Critique (IC-01 à IC-04) : Tâches qui fonctionnent vraiment

**Durée estimée :** 2–3 sessions  
**Objectif :** Les tâches s'exécutent avec le bon agent, apparaissent dans Results, mettent à jour les niveaux.

| # | Action | Fichier | Ligne approx |
|---|---|---|---|
| 1 | Ajouter écriture `results_log` dans `TaskRunner._setStatus` | `TaskRunner.js` | ~635 |
| 2 | Remplacer `task.assignment?.assigned_to` → `task.assigned_to` partout dans TaskRunner | `TaskRunner.js` | 213, 221, 274, 721, 729 |
| 3 | Ajouter appel `cascadeTaskClosure()` depuis TaskRunner après `_setStatus('completed')` | `TaskRunner.js` | ~605 |
| 4 | Corriger `cascadeTaskClosure()` : lire `task.assigned_to` et `task.project_id` | `RegistryManager.js` | ~1232 |
| 5 | Ajouter guard `!raw.startsWith('<!--')` dans `buildSystemPrompt` | `PoseidonOrchestrator.js` | ~134 |

### Sprint 2 — Significatif (IC-05 à IC-10) : Qualité et intégrité

**Durée estimée :** 1–2 sessions  
**Objectif :** ReasoningBus utile, registry propre, IDs cohérents.

| # | Action | Fichier | Ligne approx |
|---|---|---|---|
| 6 | Pousser Poseidon chat chunks → ReasoningBus dans `buildPoseidonChatRoute` | `modelRoutes.js` | ~525 |
| 7 | Ajouter `'failed'` aux terminal statuses dans `_writeTaskDetails` | `RegistryManager.js` | ~1083 |
| 8 | Nettoyer `_idMutex` dans finally block | `RegistryManager.js` | ~162 |
| 9 | `_defaultIdFormat` → `'task_NNNN'` + update seed metadata | `RegistryManager.js` + seed | ~171 |
| 10 | Documenter `git_workflow` skill dans README §9 | `README.md` | §9 |

### Sprint 3 — Mineur (IC-11 à IC-15) : Nettoyage

**Durée estimée :** 1 session

| # | Action | Fichier |
|---|---|---|
| 11 | Retirer `api.js` de index.html et supprimer le fichier | `index.html` + `client/scripts/api.js` |
| 12 | Corriger chemin `PanelResizer._persistWidth` | `PanelResizer.js` |
| 13 | Améliorer format `SKILL_UPDATE` dans dream protocol | `V2ModelService.js` |

---

## MATRICE IMPACT/EFFORT

```
         Impact
    HIGH │ IC-01 ★  IC-04 ★
         │ IC-02 ★  IC-03 ★
         │ IC-07    IC-05
    MED  │ IC-06    IC-08
         │ IC-10    IC-09
    LOW  │ IC-11    IC-12   IC-13
         └──────────────────────
           LOW     MED     HIGH
                  Effort
★ = Sprint 1 priorité absolue
```

---

## ÉTAT DES PROCESSUS APRÈS FIX

Une fois les 5 fixes du Sprint 1 appliqués, les processus principaux fonctionneront comme documenté dans le README :

```
Tâche créée par Poseidon
  → TaskRunner.tick() → agentId = task.assigned_to  ✓ (fix IC-02)
  → Agent correct sélectionné, status → active       ✓ (fix IC-02)
  → Exécution en BG avec contexte Poseidon ou AgentWorker
  → _saveOutput() écrit result_file
  → _setStatus('completed') :
      - _writeTaskDetails → purge du registry         ✓ (existant)
      - ÉCRITURE results_log                          ✓ (fix IC-01)
      - cascadeTaskClosure → perf agent + projet      ✓ (fix IC-03)
  → Control Tower Results pane affiche la tâche      ✓ (fix IC-01)
  → Squid level-up si seuil atteint                  ✓ (fix IC-03)
  → temp.md clear ne pollue plus le système prompt    ✓ (fix IC-04)
```

---

*Audit réalisé par cross-check ligne par ligne. Tous les numéros de ligne cités sont approximatifs (±10 lignes selon la version exacte du fichier au moment de la lecture).*
