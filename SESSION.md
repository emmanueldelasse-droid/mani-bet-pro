# Mani Bet Pro

## État
Worker `manibetpro` v6.59 · `manibetpro.workers.dev`
Front: GitHub Pages · KV `PAPER_TRADING` id=`17eb7ddc41a949dd99bd840142832cfd`
Stack: CF Worker + KV + Tank01 (RapidAPI) + ESPN + Claude API + Telegram

## Routes
- `/health`
- `/nba/matches?date=YYYYMMDD` · `/odds` · `/injuries` · `/standings`
- `/nba/team-detail?home=X&away=Y[&bust=1]` → last10/splits/H2H/top10
- `/nba/teams/stats` · `/roster-injuries` · `/ai-injuries` · `/nba/player-points?event_id=X`
- `/mlb/matches` · `/odds` · `/pitchers` · `/standings`
- `/bot/run` POST · `/logs` · `/settle-logs` POST · `/logs/export.csv` · `/odds-history?matchId=X`
- `/tennis/sports-list|odds|stats`
- Cron `0 * * * *` · bot NBA+MLB · 10h UTC nightly-settle J-1/J-2 · snapshot cotes ESPN→KV `odds_snap_{matchId}`

## Fichiers
- `worker.js` backend monolithe (~4900L) · `wrangler.jsonc` config CF
- `src/ui/` → ui.match-detail.teamdetail.js · ui.dashboard.js · ui.bot.js

## Pièges Tank01
- `team.Roster` **R majuscule** (pas `roster`)
- `getNBATeams` requiert `statsToGet=averages` pour ppg/reb/ast
- `teamAbv` avec espaces → `.trim().toUpperCase()` systématique
- Quota limité → cache 24h KV obligatoire rosters
- `?bust=1` vide cache team-detail + roster
- Cache team-detail 6h/8h · roster 24h
- Box scores: 5 derniers/équipe cachés KV 7j par `gameID` → `last5_ppg` actif, ~5 calls max premier hit, ~0 ensuite
- Bundle calls séquentiels (anti rate-limit)

## Pièges TheOddsAPI
- `player_points` sans `bookmakers=` → API renvoie books dispo · avec filtre spécifique → 422 si book absent (worker.js:2463)

## Bugs actifs
- néant

## Deploy
`git push origin main` → CF auto-deploy · pas de `wrangler deploy`.

## Hors SESSION (charger à la demande)
- Secrets/reprise nouveau compte → `.claude/onboarding.md`
- Historique → `git log --oneline`
- TODO → GitHub issues

## Règle
Merge main → update SI impact critique. Format: voir CLAUDE.md.

## Règle OBLIGATOIRE réponses user
Vocabulaire simple · exemples concrets · détails CLI explicités. Voir CLAUDE.md.
