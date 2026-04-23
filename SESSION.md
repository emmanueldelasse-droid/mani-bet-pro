# Mani Bet Pro

## Règles update SESSION (IA OBLIGATOIRE)
Début tâche → "En cours" étape 1/N · Fin étape → +1 · Merge → vider "En cours" + bump version + cocher TODO · User mentionne future → ajouter TODO + demander P · Commit SESSION si step >5min ou >3 tool calls.

## En cours
néant

## TODO
néant (demander P quand user ajoute)

## État
Worker `manibetpro` v6.78 · `manibetpro.emmanueldelasse.workers.dev` · Front GH Pages
KV `PAPER_TRADING` id=`17eb7ddc41a949dd99bd840142832cfd`
Stack: CF Worker + KV + Tank01 + ESPN + Claude API + Telegram

## Routes
- `/health` · `/nba/{matches,odds,injuries,standings,results,team-detail,teams/stats,roster-injuries,ai-injuries[-batch],ai-player-props,player-points}`
- `/nba/{roster,boxscore,schedule}-debug` · `/debug/basketusa` (`?secret=X` obligatoire)
- `/mlb/{matches,odds,pitchers,standings,team-stats,bullpen-stats,weather}`
- `/bot/{run POST,logs,settle-logs POST,logs/export.csv,odds-history?matchId=X,calibration}`
- `/tennis/{sports-list,tournaments,odds,stats}` · ATP+WTA · `tour=atp|wta` param stats
- Cron `0 * * * *` · bot NBA+MLB · 10-11h UTC nightly-settle J-1/J-2 · 22h UTC AI props · snapshot ESPN→KV `odds_snap_{id}`

## Fichiers
- `worker.js` ~7263L monolithe · `wrangler.jsonc`
- `src/ui/` → match-detail.teamdetail · dashboard · bot · history · match-detail.helpers
- `src/utils/utils.odds.js` → source canonique conversions cotes

## Pièges Tank01
- `team.Roster` R maj (fallback `.roster`) · `statsToGet=averages` obligatoire
- `teamAbv.trim().toUpperCase()` systématique · cache KV rosters 6h · team-detail 6/8h · box 7j
- `?bust=1` force refetch, overwrite si data>0 · bundle calls séquentiels anti rate-limit
- `parseFloat(ppg)` → `Number.isFinite` (sinon NaN cascade)

## Pièges TheOddsAPI
- `player_points` sans `bookmakers=` → books dispo · filtre spécifique → 422 si absent (worker.js:2450)

## Pièges MLB
- `_mlbSeason()` dynamique · jamais hardcoder (nov-fév = saison précédente)
- Double-header : pitcher keyé teamName → warn + garde 1er (refacto futur)
- IP baseball `X.Y` = X innings + Y outs · `parseFloat` faux
- MLB Stats API `date=YYYY-MM-DD` · ESPN `YYYYMMDD` · logs MLB stockent YYYYMMDD (aligné NBA)

## Pièges Timezone
- `getTodayET` + `_botFormatDate` via `Intl.DateTimeFormat` · DST auto
- Nightly-settle fenêtre 10-11h UTC · idempotent KV

## Sécu
- Debug routes → `_denyIfNoDebugAuth()` · refuse si DEBUG_SECRET unset/wrong
- Params user → regex avant KV key (`matchId [a-zA-Z0-9_-]+` · `date \d{8}`)
- UI innerHTML → `escapeHtml` (helpers.js) pour data tierce

## Bugs actifs
néant

## Deploy
`git push origin main` → CF auto-deploy · pas de `wrangler deploy`.

## Hors SESSION (charger à la demande)
- Secrets/nouveau compte → `.claude/onboarding.md`
- Historique → `git log --oneline`
- Agent `alon` (analyse calibration bot) → `.claude/agents/alon.md`

## Règle format
CLAUDE.md · télégraphique · `·` sep · `→` cause · refs `file:line` · < 3000 octets
