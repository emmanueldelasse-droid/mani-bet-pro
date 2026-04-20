# SESSION.md — Mani Bet Pro

## 1. Projet
Mani Bet Pro est une application d’analyse sportive / paris avec :
- frontend GitHub Pages en JavaScript modulaire
- backend Cloudflare Worker
- stockage KV pour paper trading, logs bot, cache et quotas
- couverture NBA active, MLB déjà branché, Tennis présent côté routes utilitaires / odds / stats

Le worker actuel expose notamment :
- NBA : matchs, standings, injuries, odds, team-detail, bot, paper trading
- MLB : matchs, odds, pitchers, standings, bot
- Tennis : sports-list, csv-test, odds, stats  [oai_citation:0‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)  [oai_citation:1‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

---

## 2. État réel du projet à la fin de cette session

### 2.1 Backend bot
Le bot NBA existe vraiment et il est déjà structuré sérieusement :
- cron `scheduled()`
- run manuel `POST /bot/run`
- logs `GET /bot/logs`
- settlement `POST /bot/settle-logs`
- Telegram
- moteur NBA inline côté worker avec score, variables, edge, confidence, Brier score, hit rate  [oai_citation:2‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

Le bot MLB existe aussi dans le worker :
- run
- logs
- settlement
- matchs
- odds
- pitchers
- standings
- moteur MLB inline  [oai_citation:3‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

### 2.2 Diagnostic global
Le projet est plus avancé qu’un prototype.  
La base backend est réelle et large.  
Mais l’état actuel n’est pas proprement “fiable en production” tant que les routes critiques cassées ne sont pas stabilisées.

---

## 3. Problème principal identifié dans cette session

### 3.1 Route cassée
La route suivante casse en 500 :
- `GET /nba/team-detail?home=XXX&away=YYY`

Cause exacte identifiée :
- `handleNBATeamDetail()` appelle `getTeamDetailBundle(...)`
- cette fonction n’est pas définie dans le `worker.js` actuellement partagé
- résultat : erreur runtime `getTeamDetailBundle is not defined`
- conséquence : toute la couche détail équipe tombe  [oai_citation:4‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

### 3.2 Impact direct
Quand `/nba/team-detail` plante, le front perd toute la couche détail :
- last10
- h2h
- splits home/away
- restDays
- avgTotal
- last5ScoringAvg
- momentum
- top10scorers
- latestGame
- latestMediaSummary

Le problème vu côté écran comme “les stats équipes ne remontent plus” vient en réalité surtout de cette route backend cassée.  [oai_citation:5‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

---

## 4. Incohérences confirmées

### 4.1 Incohérence de version
Le fichier commence comme un worker **v6.44** mais la route `/health` renvoie encore :
- `version: 6.31.0`  [oai_citation:6‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

Donc l’endpoint santé ne reflète pas l’état réel du fichier.

### 4.2 Endpoint santé obsolète
`/health` ne représente pas correctement toutes les routes actuelles du worker :
- il manque notamment la réalité complète du bot et de MLB dans la vision de santé retournée
- ce n’est donc pas une source fiable pour diagnostiquer le backend  [oai_citation:7‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

### 4.3 Team stats partiellement alignées
La route `/nba/teams/stats` existe, mais le vrai bloc cassant aujourd’hui n’est pas elle en premier.
Le problème bloquant observé vient surtout de `/nba/team-detail`.
En revanche, l’alignement global entre données backend, moteur et front reste à vérifier proprement.  [oai_citation:8‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

---

## 5. Ce qui a été vérifié pendant cette session

### Vérifié comme vrai
- le repo Mani-Bet-Pro est bien public
- le worker expose bien les routes bot NBA
- le worker expose bien les routes bot MLB
- le paper trading est bien présent
- la route `/nba/team-detail` existe dans le router
- `handleNBATeamDetail()` appelle bien `getTeamDetailBundle(...)`
- cette fonction manque dans le fichier actuel
- `/health` annonce encore `6.31.0`
- le bot NBA a une vraie logique de logs + settle + stats calibration
- la logique Claude / injuries / Tank01 / ESPN est bien présente dans le worker  [oai_citation:9‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)  [oai_citation:10‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)  [oai_citation:11‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

### Non prouvé dans cette session
- performance réelle du bot dans le temps
- rentabilité réelle
- qualité réelle des logs en production sur plusieurs jours
- stabilité exacte des endpoints live hors ce qui a été testé visuellement
- qualité réelle du bot MLB par rapport au NBA

---

## 6. Audit franc du bot à ce stade

### 6.1 Ce qui est bon
- architecture backend riche
- cron bot NBA
- logs bot
- settlement bot
- métriques de calibration déjà prévues
- bot MLB déjà branché
- paper trading présent
- travail réel de correction déjà visible dans l’historique du fichier :
  - bug `emaLambda`
  - run bot qui répondait trop tôt
  - appels internes worker vers lui-même
  - race condition sur Claude
  - normalisation des noms joueurs ESPN ↔ Tank01  [oai_citation:12‡worker.js](sediment://file_00000000c07071f4b90c6c920d106c45)

### 6.2 Ce qui est mauvais
- route critique `team-detail` cassée
- endpoint santé faux / en retard
- incohérence de version
- confiance runtime partielle
- calibration réelle du bot non prouvée
- maturité produit correcte, mais maturité prédictive encore non démontrée

### 6.3 Conclusion honnête
Le bot existe.  
Ce n’est pas un faux backend.  
Mais il n’est pas encore dans un état “propre, cohérent et validé”.

---

## 7. Correction effectuée pendant cette session
Un zip de réparation a été généré avec un `worker.js` corrigé pour réinjecter la logique manquante autour de `team-detail`, notamment :
- `getNBAData(...)`
- `getTeamDetailBundle(...)`
- `buildTop10ScorersFromRoster(...)`
- correction de la version `/health` annoncée dans ce patch de livraison

Nom du zip livré :
- `mani_bet_pro_worker_fix_v1.zip`

Important :
- ce patch a été produit pour corriger la route cassée
- il doit être considéré comme un correctif de reprise, à revalider après déploiement

---

## 8. Priorité absolue au prochain échange

### P0 — Bloquant
1. Redéployer le worker corrigé
2. Tester directement :
   - `/nba/team-detail?home=CLE&away=TOR`
   - `/nba/team-detail?home=NY&away=ATL`
   - `/nba/team-detail?home=DEN&away=MIN`
3. Vérifier que la route ne renvoie plus 500
4. Vérifier que le front recharge bien les détails équipes

### P1 — Cohérence backend
5. Corriger `/health` pour qu’il reflète la vraie version et les vraies routes
6. Vérifier que les réponses `/nba/teams/stats` et `/nba/team-detail` ont bien le format attendu par le front
7. Vérifier les dépendances manquantes autour de `team-detail` pour éviter un second helper orphelin

### P2 — Validation bot
8. Auditer les logs réels du bot NBA
9. mesurer :
   - hit rate
   - total settled
   - Brier score
   - avg edge
10. séparer clairement :
   - bot techniquement fonctionnel
   - bot réellement performant

---

## 9. Risques encore présents
- autre helper manquant dans le bloc `team-detail`
- mismatch possible entre version locale du worker et version réellement déployée
- cache KV pouvant masquer une ancienne réponse vide ou incomplète
- `/health` actuellement trompeur si non corrigé
- bot MLB encore moins vérifié que le bot NBA

---

## 10. Prochaine étape recommandée
Prochaine étape utile :
- déployer le worker corrigé
- retester `/nba/team-detail`
- puis faire un audit complet du worker corrigé et des vrais endpoints live

---

## 11. Résumé ultra court
- Le bot existe et le backend est sérieux, mais pas encore validé proprement.
- Le bug principal de cette session est un 500 sur `/nba/team-detail` causé par `getTeamDetailBundle` manquant.
- Un zip correctif a été généré ; la prochaine étape est le redéploiement puis la revalidation live.