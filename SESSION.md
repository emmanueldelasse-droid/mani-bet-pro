# Mani Bet Pro — reprise projet

## 1. État
- Worker `manibetpro` v6.44 · prod: `manibetpro.workers.dev`
- Front: GitHub Pages (racine repo, `index.html` + `src/ui/`)
- KV binding: `PAPER_TRADING` (id `17eb7ddc41a949dd99bd840142832cfd`)
- Stack: Cloudflare Worker + KV + Tank01 (RapidAPI) + ESPN + Claude API + Telegram

## 2. Archi
```
index.html + src/ui/*.js  (GitHub Pages)
         │
         ▼
manibetpro.workers.dev  (worker.js, ~4900 lignes, monolithe)
         │
    ┌────┼────┬──────────┬──────────┐
    ▼    ▼    ▼          ▼          ▼
  Tank01 ESPN Claude  Telegram  KV PAPER_TRADING
  (odds/ (matchs) (analyses) (notifs)  (cache + paper + bot logs)
  stats)
```

## 3. Routes worker (principales)
- `/health` → version + routes
- `/nba/matches?date=YYYYMMDD` · `/nba/odds` · `/nba/injuries` · `/nba/standings`
- `/nba/team-detail?home=X&away=Y[&bust=1]` → last10/splits/H2H/top10/média
- `/nba/teams/stats` · `/nba/roster-injuries` · `/nba/ai-injuries`
- `/mlb/matches` · `/mlb/odds` · `/mlb/pitchers` · `/mlb/standings`
- `/bot/run` POST · `/bot/logs` · `/bot/settle-logs` POST
- `/tennis/sports-list` · `/tennis/odds` · `/tennis/stats`
- Cron: hourly `0 * * * *` (bot NBA + MLB)

## 4. Fichiers clés
- `worker.js` — tout le backend (handlers NBA/MLB/Tennis + bot + AI + paper trading)
- `src/ui/ui.match-detail.teamdetail.js` — rendering détail match (team-detail)
- `src/ui/ui.dashboard.js` — dashboard principal
- `src/ui/ui.bot.js` — UI bot
- `src/ui/ui.settings.js` — settings
- `assets/css/ui.primitives.css` — tokens design
- `wrangler.jsonc` — config CF (name, main, KV, cron)

## 5. Secrets (Cloudflare Dashboard → Worker → Settings → Variables)
- `TANK01_API_KEY` (RapidAPI tank01-fantasy-stats)
- `ANTHROPIC_API_KEY` (Claude)
- `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID`
- `DEBUG_SECRET` (guard routes `/nba/*-debug`)

## 6. Workflow dev
1. Branch `claude/<topic>` depuis `origin/main`
2. Edit + commit + push + PR
3. Squash merge sur main (via GitHub MCP ou UI)
4. Deploy: `npx wrangler deploy` (manuel depuis poste user)
5. Test: curl endpoint + ouvrir UI
6. **Update SESSION.md** (historique + TODO)

## 7. Pièges Tank01 / savoirs tacites
- `team.Roster` = **R majuscule** (pas `roster`)
- `getNBATeams` nécessite `statsToGet=averages` pour ppg/reb/ast joueurs (sinon stats null)
- `teamAbv` peut contenir espaces → `.trim().toUpperCase()` systématique
- Quota Tank01 limité → cache 24h KV obligatoire sur rosters
- `/nba/team-detail?bust=1` vide cache team-detail ET roster
- Cache team-detail KV 6h read / 8h write · Cache roster KV 24h
- Pas de fetch box scores (retiré pour éviter rate-limit) → `last5_ppg` toujours null
- Bundle calls sequential (pas parallel) anti-rate-limit

## 8. Bugs connus
- P1 `/health` annonce v6.31 alors que worker est v6.44
- P1 `last5_ppg` top10 toujours null (box scores retirés v6.41)
- P2 Bot MLB moins validé que NBA (logs prod à auditer)
- P2 Calibration bot NBA non prouvée (hit rate / Brier score)

## 9. Reprise nouveau compte (5 min)
1. `git clone https://github.com/emmanueldelasse-droid/Mani-Bet-Pro && cd Mani-Bet-Pro`
2. Lire ce fichier
3. `npm i -g wrangler` puis `wrangler login` (OAuth CF)
4. Renseigner secrets : `wrangler secret put TANK01_API_KEY` (etc)
5. Si KV absent : `wrangler kv namespace create PAPER_TRADING` + update `wrangler.jsonc`
6. `npx wrangler deploy`
7. Test : `curl https://manibetpro.workers.dev/health`
8. Front GitHub Pages auto-déployé depuis main

## 10. Historique merges (plus récent → plus ancien)
- 2026-04-20 main `cleanup _debug_roster` (20f2c5c)
- 2026-04-20 main `fix statsToGet=averages + cache v3` (de631e3) — top10 stats OK
- 2026-04-20 main `fix Tank01 team.Roster majuscule` (3a6e2ea) — root cause top10
- 2026-04-20 #18 `cache v2 + remove statsToGet` (7439c65)
- 2026-04-20 #14 `rosters fetch first + KV 24h` (4b10d85)
- 2026-04-20 (direct) `trim, splits nullables, O/U, top10` (bc3c9db)
- 2026-04-19 #11 `élimine box scores (rate limit TOR)` (39def83)

## 11. Ce qu'il reste à faire
### P0 — Immédiat
- Corriger `/health` pour refléter v6.44 + routes réelles
- Décider : réactiver fetch box scores (coût quota) pour avoir `last5_ppg`, ou accepter null

### P1 — Qualité bot
- Audit logs prod bot NBA : hit rate, total settled, Brier, avg edge
- Auditer bot MLB avec mêmes métriques
- Clarifier : bot techniquement fonctionnel vs réellement performant

### P2 — Produit
- Couverture Tennis encore partielle (routes odds/stats présentes, pas de détail match)
- Pas de monitoring/alerting sur les erreurs worker en prod
- Pas de tests automatisés (aucun test unitaire sur worker.js)
- `/health` pourrait exposer : version, uptime, KV ok, Tank01 quota restant

### P3 — Dette technique
- `worker.js` monolithe 4900 lignes → découper en modules (routes, services, bot)
- Normalisation des noms joueurs ESPN ↔ Tank01 centralisée nécessaire
- Documenter le format exact des réponses Tank01 (pas de schéma officiel)

## 12. Règle de mise à jour
Après chaque merge main : ajouter 1 ligne section 10 (date, PR#, titre, sha7). Si impact critique (bug, breaking, env, piège Tank01/ESPN) : update section concernée (1, 3, 5, 7, 8 ou 11).
