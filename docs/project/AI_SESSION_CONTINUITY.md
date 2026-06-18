# Guide · Continuité de session IA

## 1. Prompt système ChatGPT (Custom Instructions)

À coller dans **Settings → Personalization → Custom Instructions → "What would you like ChatGPT to know about you?"** :

```
Au début de chaque conversation concernant un de mes projets, lis automatiquement le fichier SESSION.md du projet sur GitHub avant de répondre.

Mes projets et leurs SESSION.md :
- Mani Bet Pro : https://raw.githubusercontent.com/emmanueldelasse-droid/[REPO]/main/SESSION.md
- BOBtheBAGEL : https://raw.githubusercontent.com/emmanueldelasse-droid/BobTheBagel/main/SESSION.md
- ManiTradePro : https://raw.githubusercontent.com/emmanueldelasse-droid/[REPO]/main/SESSION.md

Règles :
1. Si je mentionne un projet, charge son SESSION.md immédiatement via l'outil de navigation.
2. Résume en 3 lignes ce que tu as lu (projet, état, prochaine étape).
3. En fin de session, génère un SESSION.md mis à jour complet que je peux copier-coller sur GitHub.
4. Ne jamais inventer ou supposer l'état du projet — tout vient du SESSION.md.
5. RÈGLE FIN DE SESSION : Dès que je dis "on approche de la fin", "bientôt fini", "dernière chose", "tokens", ou toute formulation similaire → génère IMMÉDIATEMENT et SANS attendre le SESSION.md complet mis à jour, avant de répondre à autre chose.
```

---

## 2. Prompt de démarrage de session Claude

À coller au tout début de chaque conversation :

```
Lis ce SESSION.md avant de commencer :
[colle ici le contenu brut du SESSION.md]

Résume en 3 lignes : projet, état actuel, prochaine étape prioritaire.
Puis demande-moi ce que je veux faire aujourd'hui.

RÈGLE IMPORTANTE : Dès que je dis "on approche de la fin", "bientôt fini", "tokens", "sauvegarde la session" ou formulation similaire → génère IMMÉDIATEMENT le SESSION.md complet mis à jour avant toute autre réponse.
```

---

## 3. Emplacement des fichiers SESSION.md

Chaque repo contient un `SESSION.md` à la racine :

```
mon-repo/
├── SESSION.md          ← fichier de continuité IA
├── src/
├── worker.js
└── ...
```

URL raw pour lecture automatique :
```
https://raw.githubusercontent.com/emmanueldelasse-droid/NOM-DU-REPO/main/SESSION.md
```

---

## 4. Workflow de session

### Début de session
1. GitHub → repo → `SESSION.md` → copie le contenu brut
2. Colle dans le prompt de démarrage (section 2)
3. L'IA résume et propose de continuer

### Fin de session
Écris :
```
Génère le SESSION.md mis à jour pour cette session.
Inclus : tâches accomplies, décisions prises, fichiers modifiés, et la prochaine étape prioritaire.
```

Pour commiter sur GitHub :
1. GitHub → repo → `SESSION.md` → icône ✏️
2. Sélectionne tout → colle le nouveau contenu
3. "Commit changes" → message : `session: [date] [IA utilisée]`

---

## 5. Prompt de fin de session universel

```
On termine la session. Génère le SESSION.md complet mis à jour.

Inclus obligatoirement :
- Date et IA utilisée aujourd'hui
- Liste des tâches accomplies
- Liste des bugs résolus
- Décisions techniques importantes
- Fichiers modifiés avec description courte
- Prochaine étape prioritaire (1 seule, la plus importante)
- Contexte nécessaire pour reprendre

Format : markdown prêt à copier-coller sur GitHub.
```

---

## 6. Commandes rapides

| Situation | Ce que tu dis à l'IA |
|-----------|---------------------|
| Démarrer | "Lis ce SESSION.md : [colle contenu]" |
| Reprendre après pause | "Où en étions-nous ?" (si même session) |
| Changer d'IA | Donne le SESSION.md à la nouvelle IA |
| **Bientôt à court de tokens** | **"on approche de la fin"** → SESSION.md généré immédiatement |
| Fin de session normale | "Génère le SESSION.md mis à jour" |
| Bug mystérieux | "Relis le SESSION.md — est-ce qu'on a déjà rencontré ça ?" |

---

## 7. Mots-clés universels de fin de session

Avec n'importe quelle IA (Claude, ChatGPT) :

> **"on approche de la fin"**

Équivalents reconnus :
- "bientôt fini"
- "tokens"
- "dernière chose avant de terminer"
- "sauvegarde la session"
