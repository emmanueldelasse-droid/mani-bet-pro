# SESSION – Mani Bet Pro
> **Fichier de continuité de session — à lire en PREMIER à chaque nouvelle session IA**

---

## Métadonnées
| Champ | Valeur |
|-------|--------|
| **Dernière mise à jour** | 2026-04-20 |
| **IA utilisée** | Claude Code (Sonnet 4.6) |
| **Branche active** | claude/confident-ritchie-h9Ao5 |
| **Repo GitHub** | emmanueldelasse-droid / Mani-Bet-Pro |

---

## Stack technique
- **Frontend** : Vanilla JS ES modules, GitHub Pages
- **Backend** : Cloudflare Workers + KV
- **Fichiers clés** : `worker.js`, `src/ui/ui.match-detail.teamdetail.js`, `src/orchestration/data.orchestrator.js`
- **API externe** : Tank01, ESPN, The Odds API, Claude web search côté worker
- **Staking** : Kelly/4, cap 5% bankroll
- **Paper settler** : présent côté worker
- **Worker réel de référence vu en session** : `Cloudflare Worker v6.44`

## Abréviations Tank01 non-standard (CONFIRMÉES)
`GS` = Golden State | `NO` = New Orleans | `NY` = New York | `SA` = San Antonio

---

## État actuel du projet

### Ce qui fonctionne
- [x] La route `/nba/team-detail` répond correctement avec `last10`, `h2h`, `homeSplit`, `awaySplit`, `restDays`, `avgTotal`, `last5ScoringAvg`, `momentum`, `top10scorers`
- [x] Le worker renvoie maintenant `home.latestGame` et `away.latestGame`
- [x] Le front affiche bien le résumé du dernier match sous chaque équipe dans **Stats équipes**
- [x] Le branchement front ↔ worker est validé sur la fiche match NBA
- [x] Le chargement général dashboard / fiche match continue de fonctionner après l’ajout

### Ce qui est cassé / en cours
- [ ] `home.latestMediaSummary` et `away.latestMediaSummary` restent à `null`
- [ ] Donc aucun résumé / lien Basket USA ne s’affiche encore dans l’UI
- [ ] Petit bug front : doublon de libellé `Dernier match : Dernier match : ...`
- [ ] Il manque une vraie route debug worker pour inspecter le fetch / parsing / scoring Basket USA
- [ ] Le cache `team-detail` peut masquer certaines modifs worker pendant les tests

---

## Dernière session

**Date** : 2026-04-20
**IA** : Claude Code (Sonnet 4.6)
**Durée estimée** : session courte

### Tâches accomplies
- Réception et intégration du guide complet de continuité de session (système SESSION.md multi-IA)
- Exploration complète du codebase (structure, stack, git log, fichiers clés)
- Revue de la PR #4 (`claude/zen-tesla-AZKGq → main`) : mise à jour documentaire uniquement, propre et mergeable
- Mise à jour du SESSION.md sur la branche `claude/confident-ritchie-h9Ao5`
- Confirmation que le guide de continuité est opérationnel avec les règles de fin de session (mots-clés : "on approche de la fin", "tokens", etc.)

### Bugs résolus
- Aucun code modifié cette session — session de mise à jour documentaire et revue PR

### Bugs encore présents
- `latestMediaSummary = null` pour les équipes testées
- Affichage en double de `Dernier match :`

### Décisions techniques prises
- Système de continuité SESSION.md confirmé opérationnel pour tous les outils IA (Claude, ChatGPT)
- PR #4 est prête à merger (SessionMD update only, aucun risque)

### Fichiers modifiés
| Fichier | Changement |
|---------|------------|
| `SESSION.md` | Mise à jour branche active + session courante (claude/confident-ritchie-h9Ao5) |

---

## Prochaine étape prioritaire

> **TODO #1** : Ajouter une route debug Basket USA dans le worker pour comprendre pourquoi `latestMediaSummary` reste `null`

**Contexte nécessaire pour reprendre** :
- Le résumé du dernier match fonctionne déjà
- Le front est prêt à afficher un bloc média si `latestMediaSummary` existe
- Le vrai blocage restant est côté worker
- Il faut exposer en debug :
  - taille du HTML récupéré
  - liste des titres candidats extraits
  - scoring des candidats
  - meilleur candidat retenu ou `null`
- Il faudra probablement bypass le cache `team-detail` pendant les tests
- Il faudra aussi corriger le doublon visuel `Dernier match : Dernier match : ...`

---

## Historique des sessions

| Date | IA | Résumé |
|------|----|--------|
| 2026-04-19 | ChatGPT | Validation du résumé du dernier match dans `Stats équipes`, identification du blocage worker sur `latestMediaSummary`, besoin d’une route debug Basket USA |
| 2026-04-20 | Claude Code (Sonnet 4.6) | Mise en place du guide SESSION.md, exploration complète du codebase, mise à jour documentation (branche claude/zen-tesla-AZKGq, worker v6.44) |
| 2026-04-20 | Claude Code (Sonnet 4.6) | Intégration guide continuité multi-IA, revue PR #4 (mergeable), mise à jour SESSION.md sur claude/confident-ritchie-h9Ao5 |

---

## Notes permanentes

- Ne jamais afficher de prix fictifs ou périmés — toujours un état de chargement
- Les abréviations Tank01 non-standard (GS, NO, NY, SA) sont CORRECTES — ne pas les "corriger"
- Déploiement via GitHub web UI uniquement (pas de Git en local sur le PC du bureau)
- Réseau corporate bloque les API externes — tester hors réseau corp si besoin
- Pour cette feature, toujours distinguer :
  - **résumé du dernier match** = donnée structurée fiable du worker
  - **résumé média** = donnée complémentaire facultative
- Tant que `latestMediaSummary` vaut `null`, le front a raison de ne rien afficher pour la partie média
