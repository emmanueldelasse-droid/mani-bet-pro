# Mani Bet Pro

## État
Worker `manibetpro` v6.45 · `manibetpro.workers.dev`
Front: GitHub Pages · KV `PAPER_TRADING` id=`17eb7ddc41a949dd99bd840142832cfd`
Stack: CF Worker + KV + Tank01 (RapidAPI) + ESPN + Claude API + Telegram

## Routes
- `/health`
- `/nba/matches?date=YYYYMMDD` · `/odds` · `/injuries` · `/standings`
- `/nba/team-detail?home=X&away=Y[&bust=1]` → last10/splits/H2H/top10
- `/nba/teams/stats` · `/roster-injuries` · `/ai-injuries`
- `/mlb/matches` · `/odds` · `/pitchers` · `/standings`
- `/bot/run` POST · `/logs` · `/settle-logs` POST · `/logs/export.csv` · `/odds-history?matchId=X`
- `/tennis/sports-list|odds|stats`
- Cron `0 * * * *` · bot NBA+MLB · 10h UTC nightly-settle J-1/J-2 · snapshot cotes ESPN→KV `odds_snap_{matchId}`

## Fichiers
- `worker.js` backend monolithe (~4900L)
- `src/ui/ui.match-detail.teamdetail.js` rendering détail match
- `src/ui/ui.dashboard.js` dashboard
- `src/ui/ui.bot.js` UI bot
- `wrangler.jsonc` config CF

## Pièges Tank01
- `team.Roster` **R majuscule** (pas `roster`)
- `getNBATeams` requiert `statsToGet=averages` pour ppg/reb/ast
- `teamAbv` avec espaces → `.trim().toUpperCase()` systématique
- Quota limité → cache 24h KV obligatoire rosters
- `?bust=1` vide cache team-detail + roster
- Cache team-detail 6h/8h · roster 24h
- Box scores: 5 derniers/équipe cachés KV 7j par `gameID` → `last5_ppg` actif, ~5 calls max premier hit, ~0 ensuite
- Bundle calls séquentiels (anti rate-limit)

## v6.45
- Logs settlement → +`prob_delta_pts` `upset` `ou_was_right` `spread_was_right` `result_margin/total`
- NBA vars +`b2b_cumul_diff` `travel_load_diff` poids 0.02 chacun (BDL last5) · net_rating 0.24→0.22
- `line_movement` dans logs · snapshot horaire KV → sharp detect

## Bugs actifs
- P1 `/health` annonce v6.31, worker v6.45

## Deploy
Auto via intégration Git CF : `git push origin main` → déploiement immédiat.
Aucun `wrangler deploy` manuel requis.

## Hors SESSION (charger à la demande)
- Secrets/reprise nouveau compte → `.claude/onboarding.md`
- Historique → `git log --oneline`
- TODO → GitHub issues

## Règle (OBLIGATOIRE pour toute IA)
Chaque merge main → update ce fichier SI impact (breaking, piège Tank01/ESPN, bug critique). Sinon ne rien toucher.

**Format obligatoire** lors de tout ajout/modif ici :
- Télégraphique français, pas de prose, pas d'articles superflus
- Listes à puces courtes, pas de paragraphes
- Symboles denses : `·` séparateur, `→` cause/résultat, `file:line` pour refs code
- Jamais d'emoji, jamais de table décorative, jamais de "we/nous/on"
- Dupliquer aucune info stockée ailleurs (git log, GitHub issues, .claude/onboarding.md)
- Si section > 15 lignes → extraire dans `.claude/<nom>.md`
- Vérifier wc -c SESSION.md après edit : cible < 2000 octets

Toute IA qui modifie ce fichier DOIT respecter ces contraintes. Non-respect = revert.
