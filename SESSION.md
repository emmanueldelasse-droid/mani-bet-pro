# SESSION – Mani Bet Pro
> **Fichier de continuité de session — à lire en PREMIER à chaque nouvelle session IA**

---

## Métadonnées
| Champ | Valeur |
|-------|--------|
| **Dernière mise à jour** | À REMPLIR |
| **IA utilisée** | À REMPLIR (Claude / ChatGPT / Codex) |
| **Branche active** | main |
| **Repo GitHub** | emmanueldelasse-droid / [nom du repo Mani Bet Pro] |

---

## Stack technique
- **Frontend** : Vanilla JS ES modules, GitHub Pages
- **Backend** : Cloudflare Workers + KV
- **Fichiers clés** : `worker.js`, `engine.nba.js`, `paper-settler.js`
- **API externe** : Tank01 (net ratings), ESPN (scores live), API interne KV
- **Staking** : Kelly/4, cap 5% bankroll
- **Paper settler** : v3 avec fallback ESPN

## Abréviations Tank01 non-standard (CONFIRMÉES)
`GS` = Golden State | `NO` = New Orleans | `NY` = New York | `SA` = San Antonio

---

## État actuel du projet
<!-- ✏️ À mettre à jour à chaque fin de session -->

### Ce qui fonctionne
- [ ] À compléter

### Ce qui est cassé / en cours
- [ ] À compléter

---

## Dernière session
<!-- ✏️ Écraser à chaque nouvelle fin de session -->

**Date** : À REMPLIR
**IA** : À REMPLIR
**Durée estimée** : À REMPLIR

### Tâches accomplies
- 

### Bugs résolus
- 

### Décisions techniques prises
- 

### Fichiers modifiés
| Fichier | Changement |
|---------|------------|
| `worker.js` | |
| `engine.nba.js` | |

---

## Prochaine étape prioritaire
<!-- ✏️ La chose la plus importante à faire au prochain démarrage -->

> **TODO #1** : À définir en fin de session

**Contexte nécessaire pour reprendre** :
- 

---

## Historique des sessions
<!-- Ajouter une ligne par session terminée -->

| Date | IA | Résumé |
|------|----|--------|
| | | |

---

## Notes permanentes
<!-- Règles, contraintes, décisions qui ne changent pas -->

- Ne jamais afficher de prix fictifs ou périmés — toujours un état de chargement
- Les abréviations Tank01 non-standard (GS, NO, NY, SA) sont CORRECTES — ne pas les "corriger"
- Déploiement via GitHub web UI uniquement (pas de Git en local sur le PC du bureau)
- Réseau corporate bloque les API externes — tester hors réseau corp si besoin

