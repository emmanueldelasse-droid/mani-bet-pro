# Mani Bet Pro

## Règles update
Début → "En cours" 1/N · Fin étape → +1 · Merge → vider · User future → TODO+prio

## En cours
néant

## Conventions
3 sports même vocabulaire confiance : `Conf. HIGH/MEDIUM/LOW/INCONCLUSIVE` · jamais `Data quality` (MLB) · file:`ui.bot.js:264`

## TODO
- [x] P1 v6.79 `recent_form_ema` 0.24→0.15 + `net_rating_diff` 0.06→0.16 (PR #75 #91)
- [x] P1 label confiance harmonisé 3 sports `Conf.` + MLB `confidence_level` alias `data_quality`
- [ ] P2 gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)
- [ ] P2 `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés
- [ ] P3 relancer Alon après 50+ logs post-v6.78

## État
Worker `manibetpro.emmanueldelasse.workers.dev` · Front GH Pages · KV `PAPER_TRADING` `17eb7ddc41a949dd99bd840142832cfd`

## Routes
- `/nba/{matches,odds,injuries,standings,results,team-detail,teams/stats,roster-injuries,ai-injuries[-batch],ai-player-props,player-points}` · debug `/nba/{roster,boxscore}-debug`
- `/mlb/{matches,odds,pitchers,standings,team-stats,bullpen-stats,weather,bot/{run,logs,settle-logs}}`
- `/tennis/{sports-list,tournaments,odds,stats,bot/{run POST,logs,settle-logs POST}}` · ATP+WTA
- `/bot/{run,logs,settle-logs,logs/export.csv?sport=,odds-history,calibration/analyze?sport=nba|mlb|tennis}`
- Cron `0 * * * *` · bots NBA+MLB+tennis · 10-11h UTC nightly-settle · 22h UTC AI props

## Fichiers
- `worker.js` ~8000L monolithe · `wrangler.jsonc`
- `src/ui/match-detail.{js,teamdetail,tennis,helpers}` · dashboard · bot · history
- `src/engine/engine.tennis.js` front · bot tennis backend worker.js (phases: grand_slam/masters_1000/tour_500/regular/challenger)
- `src/utils/utils.odds.js` source conversions cotes

## Pièges Tank01
`team.Roster` R maj · `statsToGet=averages` · `teamAbv.trim().toUpperCase()` · cache rosters 6h · `?bust=1`

## Pièges TheOddsAPI
`player_points` sans `bookmakers=` → books dispo · filtre → 422 si absent (worker.js:2450)

## Pièges MLB
`_mlbSeason()` dynamique · IP `X.Y` = X innings + Y outs (`parseFloat` faux) · ESPN `YYYYMMDD` aligné logs

## Pièges Tennis
Sackmann CSV lag 2-3j · api-tennis 60j fallback · CSV qual_chall/qual_itf hors tour principal
9 vars : ranking_elo · surface_wr · recent_form · pressure_dom · h2h · service · physical_load_14d · market_steam · fatigue
Elo K=32 init 1500 · log TTL 90j · odds_snap 7j · steam opener [4h, 48h] bruit <3% → 0
Garde-fous (worker.js:7964 + engine.tennis.js:365) : edge>25% / cote≥5+edge>15% / matchs<15 drop

## Pièges Timezone
`_botFormatDate` Intl · DST auto · nightly 10-11h UTC idempotent

## Sécu
Debug `_denyIfNoDebugAuth()` · params user regex avant KV key · innerHTML → `escapeHtml`

## Deploy
`git push origin main` → CF auto-deploy

## Hors SESSION
`.claude/onboarding.md` · `git log` · `.claude/agents/alon.md`
