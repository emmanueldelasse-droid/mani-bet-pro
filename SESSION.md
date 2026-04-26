# Mani Bet Pro

## Règles update
Début → "En cours" 1/N · Fin étape → +1 · Merge → vider · User future → TODO+prio

## En cours
néant

## TODO
- [x] P1 `recent_form_ema` 0.24→0.15 playin/playoff (PR #75 + sync front v6.79)
- [x] P1 bump `net_rating_diff` 0.06→0.16 (v6.79)
- [ ] P2 gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)
- [ ] P2 `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés
- [ ] P3 relancer Alon après 50+ logs post-v6.78

## État
Worker `manibetpro.emmanueldelasse.workers.dev` · Front GH Pages · KV `PAPER_TRADING` `17eb7ddc41a949dd99bd840142832cfd`
Stack: CF Worker + KV + Tank01 + ESPN + Claude + Telegram · Sackmann CSV + api-tennis.com (env `TENNIS_API_KEY`)

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
Sackmann CSV lag 2-3j · api-tennis comble 60j · fallback CSV qual_chall/qual_itf hors tour principal
9 vars: ranking_elo · surface_wr · recent_form · pressure_dom (BP) · h2h · service · physical_load_14d · market_steam · fatigue
Elo K=32 init 1500 · `tennis_bot_log_{matchId}` TTL 90j · `tennis_odds_snap_{matchId}` TTL 7j (steam)
Steam : opener fenêtre [4h, 48h] · bruit <3% → value=0 · settle via CSV retro
Garde-fous reco ML (worker.js:7964 + engine.tennis.js:365): edge>25% drop · cote≥5+edge>15% drop · total_matches<15 drop

## Pièges Timezone
`_botFormatDate` Intl · DST auto · nightly 10-11h UTC idempotent

## Sécu
Debug `_denyIfNoDebugAuth()` · params user regex avant KV key · innerHTML → `escapeHtml`

## Deploy
`git push origin main` → CF auto-deploy

## Hors SESSION
`.claude/onboarding.md` · `git log` · `.claude/agents/alon.md`
