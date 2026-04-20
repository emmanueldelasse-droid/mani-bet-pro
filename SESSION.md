# SESSION.md — Mani Bet Pro

## 1. Projet
Mani Bet Pro est une application d'analyse sportive / paris avec :
- frontend GitHub Pages en JavaScript modulaire
- backend Cloudflare Worker
- stockage KV pour paper trading, logs bot, cache et quotas
- couverture NBA active, MLB déjà branché, Tennis présent côté routes utilitaires / odds / stats

Le worker actuel expose notamment :
- NBA : matchs, standings, injuries, odds, team-detail, bot, paper trading
- MLB : matchs, odds, pitchers, standings, bot
- Tennis : sports-list, csv-test, odds, stats

---

## 2. État à la fin de cette session (20 avril 2026)

### 2.1 Ce qui fonctionne maintenant
- Route `/nba/team-detail` opérationnelle (était cassée en 500 dans les sessions précédentes)
- Stats équipes : Pts/match, Pts encaissés, Win %, Moy. total, Moy. 5 derniers → affichées pour **CLE et TOR**
- Dom/Ext splits (ex: 28-14 · 25-16) → affichés correctement
- Momentum badge → fonctionnel
- Forme récente last10 → affichée pour les deux équipes
- H2H saison → fonctionnel
- O/U bars (over/under) → fonctionnels
- Cache KV team-detail : invalide si données partielles (AND au lieu de OR)

### 2.2 Ce qui ne fonctionne pas encore
- **Top 10 scoreurs** : toujours "Données indisponibles" pour CLE et TOR
  - L'appel `getNBATeams` (rosters) semble retourner null ou un format inattendu
  - Diagnostic non encore conclu — voir section 5

---

## 3. Bugs identifiés et corrigés cette session

### 3.1 `.trim()` manquant sur les abréviations Tank01 (BUG PRINCIPAL)
Tank01 retourne parfois `' TOR'` ou `'TOR '` avec des espaces.  
Sans `.trim()`, `' TOR' === 'TOR'` → false → tous les matchs TOR marqués "extérieur" → last10 vide en cascade.

**Fichiers corrigés :**
- `worker.js` : `_teamDetailIsCompletedGame` — `.trim()` sur le statusCode
- `worker.js` : `_teamDetailComputeSplit` — `.trim()` sur `g.home` / `g.away`
- `worker.js` : `getTeamDetailBundle` last10 mapping — `.trim()` sur `game.home` / `game.away`

### 3.2 `_teamDetailComputeSplit` ne calculait jamais de victoires
La fonction cherchait `homeTeamScore`/`awayTeamScore` — champs absents dans `getNBATeamSchedule`.  
Résultat : 0 victoires même quand le schedule était chargé.

**Fix :** fallback → `teamScore`/`oppScore` (team-relative) → `gameResult` field.  
**Fix :** retourne `null` si 0 matchs trouvés (au lieu de `{wins:0, losses:0}` qui affichait "0-0").

### 3.3 `_teamDetailIsCompletedGame` manquait des statuts
'Completed' (avec d) absent de la liste → matchs TOR non reconnus comme terminés.

**Fix :** ajout de `'Completed'`, `'STATUS_FINAL'`, `'post'`, regex `/complet/i`, et fallback via scores > 0.

### 3.4 Cache KV team-detail servait des données partielles
Condition de lecture `||` → si CLE avait des données, le cache était servi même avec TOR vide.

**Fix :** `||` → `&&` : les deux équipes doivent avoir `last10` pour servir le cache.

### 3.5 Champ `total` absent des objets `last10`
Les barres O/U cherchaient `g.total` jamais défini → toujours "ligne O/U indisponible".

**Fix worker :** ajout de `total: teamPts + oppPts` dans chaque objet last10.  
**Fix UI :** fallback `g.total ?? g.teamPts + g.oppPts` pour rétrocompatibilité avec le cache existant.

### 3.6 Mismatch de champs dans le top10 scoreurs (UI)
Worker retourne `ppg` et `last5_ppg`, l'UI lisait `pts` et `last5pts`.

**Fix :** `ui.match-detail.teamdetail.js` — `p.pts` → `p.ppg`, `p.last5pts` → `p.last5_ppg`.

### 3.7 `extractTop10` : format de réponse Tank01 non normalisé
La fonction supposait un array alors que Tank01 peut retourner object / `.body` / `.teams`.

**Fix :** normalisation de tous les formats dans `extractTop10`.

### 3.8 `getNBATeams` (rosters) rate-limitée après les 2 bundles
L'appel rosters était le 3e appel Tank01 consécutif — souvent 429.

**Fix :** roster fetché EN PREMIER, avant les bundles schedule. Cache KV 24h (`nba_rosters_teams_v1`).

### 3.9 Paramètres `getNBATeams` incorrects
`teamStats: 'true'` au lieu de `statsToGet: 'averages'` + `teamStats: 'false'` (URL éprouvée `TANK01_ROSTER_URL`).

**Fix :** paramètres alignés sur `TANK01_ROSTER_URL`.

---

## 4. PRs mergées cette session

| PR | Titre | SHA |
|----|-------|-----|
| #12 | fix: données manquantes TOR — trim, splits, cache, O/U, top10 | `bc3c9db` |
| #14 | fix: top10 scoreurs — rosters en premier + statsToGet=averages | `4b10d85` |

---

## 5. Problème en cours : top10 scoreurs toujours vide

### Diagnostic à compléter
Appeler cet URL après déploiement pour voir la réponse brute Tank01 :
```
https://manibetpro.emmanueldelasse.workers.dev/nba/roster-debug?team=CLE
```

La réponse montrera :
- Si Tank01 retourne bien les données (`available: true`)
- Le format du roster (array ou objet)
- Les champs disponibles sur les joueurs (`ppg`, `stats.pts`, etc.)

### Causes possibles restantes
1. `getNBATeams` retourne toujours null (rate-limit ou erreur silencieuse)
2. `team.roster` est vide ou undefined pour CLE / TOR
3. Champs stats joueur dans un sous-objet non couvert par l'extraction

### Pour invalider le cache KV
Après chaque déploiement, appeler :
```
https://manibetpro.emmanueldelasse.workers.dev/nba/team-detail?home=CLE&away=TOR&bust=1
```

---

## 6. Priorités pour la prochaine session

### P0 — Top 10 scoreurs
1. Appeler `/nba/roster-debug?team=CLE` et analyser la réponse
2. Corriger `buildTop10ScorersFromRoster` selon la vraie structure des données
3. Vérifier que la cache KV roster est bien écrite après le premier fetch

### P1 — Validation complète match detail
4. Vérifier que tous les matchs NBA affichent les données (pas seulement CLE/TOR)
5. Tester un match en cours de saison régulière + un match Play-In
6. Vérifier le déclenchement correct du cache bust automatique

### P2 — Stabilité
7. Corriger `/health` pour refléter la vraie version du worker
8. Vérifier les autres endpoints live (bot, paper trading, MLB)

---

## 7. Architecture du pipeline team-detail

```
UI ouvre match detail
  → data.orchestrator.js : _preloadTeamDetails()
    → fetch /nba/team-detail?home=CLE&away=TOR
      → worker.js : handleNBATeamDetail()
        1. Lit KV cache team_detail_v7_TOR_CLE (6h TTL)
        2. Fetch rosters KV nba_rosters_teams_v1 (24h TTL)
           → si miss : getNBATeams (statsToGet=averages)
        3. getTeamDetailBundle(CLE, TOR) → getNBATeamSchedule?teamAbv=CLE
        4. getTeamDetailBundle(TOR, CLE) → getNBATeamSchedule?teamAbv=TOR
        5. buildTop10ScorersFromRoster() × 2
        6. _findBestBasketUSAArticle() × 2
        7. Écrit KV si les deux équipes ont last10
        → payload { home: {...}, away: {...} }
  → store.set({ teamDetails: { [matchId]: payload } })
  → ui.match-detail.teamdetail.js : render()
```

---

## 8. Résumé ultra court
- Stats équipes : corrigées et fonctionnelles (CLE + TOR)
- O/U bars : corrigées
- Dom/Ext splits : corrigés
- Forme récente : corrigée
- **Top 10 scoreurs : pas encore résolu — diagnostic en attente du `/nba/roster-debug`**
