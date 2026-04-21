/**
 * MANI BET PRO — Cloudflare Worker v6.49
 *
 * CORRECTIONS v6.39 :
 *   1. Fix critique bot — emaLambda non défini dans _botEngineCompute.
 *      _botGetWeights() retournait bien ema_lambda mais il n'était pas destructuré.
 *      ReferenceError silencieuse → _botExtractVariables utilisait la valeur par défaut 0.85
 *      mais en mode strict Cloudflare Workers → exception → _botAnalyzeMatch retournait null
 *      → logs_written: 0.
 *      Fix : const { weights, phase, score_cap, ema_lambda: emaLambda } = phaseConfig;
 *
 * CORRECTIONS v6.40 :
 *   MLB complet — handlers + bot + moteur + cotes (clé 2)
 *
 * CORRECTIONS v6.38 :
 *   1. Fix bot/run — handleBotRun attendait _runBotCron en fire-and-forget.
 *      Cloudflare tuait le Worker dès la réponse HTTP → _runBotCron jamais terminé → logs vides.
 *      Fix : await _runBotCron(env, true) avant de répondre. La réponse inclut logs_written.
 *
 * CORRECTIONS v6.37 :
 *   1. Fix critique bot — appels HTTP internes remplacés par appels directs aux fonctions.
 *      Un Worker Cloudflare ne peut pas se faire fetch() vers sa propre URL (bloqué CF).
 *      _runBotCron() appelait handleNBAInjuriesImpact, handleOddsComparison, handleNBATeamsStats,
 *      handleNBARecentForm et handleNBAAIInjuriesBatch via fetch() → tous échouaient silencieusement
 *      → injuryData/oddsData/advancedData/recentForms tous null → logs vides.
 *      Fix : appels directs aux fonctions avec fakeOrigin et fakeUrl/fakeRequest.
 *
 * AJOUTS v6.36 :
 *   1. recent_form_ema ajouté dans le bot — appels BDL en parallèle pour home + away.
 *      Même calcul EMA que le moteur front (lambda 0.85 saison / 0.92 playoffs).
 *      Le bot analyse maintenant avec les 8 variables disponibles (vs 7 avant).
 *
 * AJOUTS v6.35 — Bot d'analyse automatique :
 *   1. Cron Handler scheduled() — déclenché automatiquement 1h avant le premier match du soir.
 *      Analyse tous les matchs NBA du jour (sans filtre), logue chaque analyse dans KV.
 *      Post-match : enrichit les logs avec résultat réel + motor_was_right.
 *   2. Moteur NBA porté côté Worker (fonctions _bot* inline) — même logique que front :
 *      extraction variables, normalisation, score pondéré, recommandations betting.
 *      Poids saison/playoff auto-détectés via _botGetNBAPhase().
 *   3. Logs KV : clé bot_log_{matchId} — structure complète pour calibration post-match.
 *      Route GET /bot/logs — retourne tous les logs + stats globales.
 *      Route POST /bot/settle-logs — enrichit les logs avec résultats réels.
 *   4. Notifications Telegram — résumé envoyé après chaque cron (matchs, edges, blessures).
 *
 * CORRECTIONS v6.34 :
 *   1. Normalisation des noms joueurs ESPN ↔ Tank01 (accents, points, apostrophes).
 *      27 joueurs sur 44 testés rataient le matching → ppg=null → signal absences_impact biaisé.
 *      Fonction _normalizeName() + table NAME_ALIASES pour les cas irréductibles.
 *   2. Index KV paper_bets_index { [bet_id]: { date, result, placed_at } }.
 *      Évite un scan complet de state.bets pour les lookups simples.
 *      Mis à jour à chaque placeBet, settleBet et reset.
 *
 * CORRECTIONS v6.33 :
 *   1. ALLOWED_AI_MODEL utilisé dans _callClaudeWithWebSearch (était hardcodé).
 *      MAX_AI_TOKENS supprimé (jamais utilisé). AI_SINGLE_MAX_TOKENS=1200 ajouté.
 *      AI_BATCH_MAX_TOKENS : 700 → 1500 (700 trop serré pour 7+ matchs → troncature
 *      JSON → JSON.parse fail → available:false silencieux).
 *
 *   2. Routes debug protégées par env.DEBUG_SECRET (?secret=xxx dans l'URL).
 *      handleNBAPlayerTest, handleNBARosterDebug, handleNBABoxscoreDebug,
 *      handleNBAScheduleDebug — étaient accessibles publiquement, consommaient
 *      des quotas Tank01 si crawlées. Guard optionnel (si DEBUG_SECRET non défini,
 *      routes accessibles — rétrocompatible).
 *
 *   3. handleNBATeamDetail — timer de démarrage ajouté.
 *      Log warn si elapsed > 22s (risque dépassement CPU Workers standard ~30s).
 *      Header X-Elapsed-Ms ajouté sur les réponses MISS pour monitoring.
 *      Bug last5Games = last10Games.slice(0,10) corrigé → slice(0,5).
 *      Réduit les appels Tank01 box scores de ~20 à ~10 sur cache miss.
 *
 * CORRECTIONS v6.32 :
 *   - Race condition rate limit Claude corrigée dans handleNBAAIInjuriesBatch
 *     et handleNBAAIInjuries.
 *     Ancienne logique : check(count) → appel Claude (~30s) → incrément.
 *     Deux requêtes simultanées passaient toutes les deux le check à count=0,
 *     appelaient Claude deux fois, et incrémentaient chacune à 1 (compteur = 1
 *     au lieu de 2). Coût : 2× tokens Claude sur chaque collision.
 *     Nouvelle logique : check(count) → incrément → appel Claude.
 *     La fenêtre de collision passe de ~30s à ~1ms (lecture KV).
 *     Note : KV Cloudflare n'est pas transactionnel. Pour une protection absolue,
 *     utiliser Durable Objects. Pour un usage solo, ce fix est suffisant.
 *
 * AJOUTS v6.31 :
 *   1. Route GET /nba/team-detail?home=TOR&away=MIA
 *      Retourne pour chaque équipe :
 *        - last10 : 10 derniers matchs avec score exact (via getNBABoxScore)
 *        - top10scorers : top 10 scoreurs avec PPG saison + PPG last5 + REB/AST/STL/BLK
 *        - h2h : confrontations directes cette saison
 *        - homeSplit/awaySplit : bilan dom/ext
 *        - restDays : jours de repos depuis dernier match
 *        - avgTotal : moyenne total de points sur les 10 derniers
 *        - last5ScoringAvg : moyenne points marqués sur les 5 derniers
 *        - momentum : { last3W, last10W }
 *      Cache KV 6h read / 8h write. Clé : team_detail_{away}_{home}.
 *      Rosters Tank01 mis en cache 24h (clé : tank01_rosters_stats_v1).
 *      Appels Tank01 : ~23 max sur cache miss (2 schedules + 20 box scores + 1 roster).
 *
 * AJOUTS v6.30 :
 *   1. Prompt Claude ultra-précis — injuries + contexte fusionnés en 1 appel/soir.
 *      Format JSON strict : injuries { home: [...], away: [...] } + context { ... }
 *      Champs : name, team, status, ppg (obligatoire si ppg>15), reason, source.
 *      Sources autorisées : nba.com/injuries + espn.com/nba uniquement.
 *   2. handleNBAAIInjuries : lit injuries depuis cache ai_context_global.
 *      Plus de dépendance au roster Tank01 (plan Basic insuffisant).
 *      1 seul appel Claude/soir couvre blessures + contexte pour tous les matchs.
 *   3. max_tokens : 1000 → 2000 pour couvrir 7+ matchs avec blessures complètes.
 *
 * AJOUTS v6.27 :
 *   1. Route GET /nba/roster-injuries
 *   2. Route GET /nba/ai-injuries : unique route Claude conservée pour les blessures.
 *   4. handleNBAInjuriesImpact : ppg lu depuis roster Tank01 (cache partagé).
 *   5. Secret Anthropic : ANTHROPIC_API_KEY → CLAUDE_API_KEY.
 */

const ESPN_SCOREBOARD  = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ESPN_INJURIES    = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
const NBA_INJURY_BASE  = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_';
const TANK01_TEAMS_URL = 'https://tank01-fantasy-stats.p.rapidapi.com/getNBATeams?schedules=false&rosters=false&statsToGet=averages&topPerformers=false&teamStats=true';

// Clés KV
const PAPER_KV_KEY        = 'paper_trading_state';
const QUOTA_KV_KEY        = 'odds_quota_state';
const TANK01_KV_KEY       = 'tank01_teams_stats';
const TANK01_INJURIES_KEY = 'tank01_injuries_impact';
const TANK01_QUOTA_KEY    = 'tank01_quota_state';
const TANK01_ROSTER_KEY   = 'tank01_roster_injuries_v1';
const TENNIS_CSV_KEY      = 'tennis_csv_stats';
const AI_INJURIES_KEY     = 'ai_injuries_cache';
const TENNIS_ODDS_KEY     = 'tennis_odds_cache';

const PAPER_BETS_INDEX_KEY = 'paper_bets_index';
const BOT_LOG_PREFIX       = 'bot_log_';
const BOT_RUN_KEY          = 'bot_last_run';
const TELEGRAM_API         = 'https://api.telegram.org';

// ── NORMALISATION NOMS JOUEURS ────────────────────────────────────────────────
// Résout le mismatch ESPN ↔ Tank01 : accents (Jokić→Jokic), points (P.J.→PJ),
// apostrophes (Cam'Ron→Camron), suffixes (Jr.→Jr), espaces multiples.
const NAME_ALIASES = {
  'alexandre sarr': 'alex sarr',
  'nahshon hyland': 'bones hyland',
};

function _normalizeName(name) {
  if (!name) return '';
  let n = String(name).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents → base
    .replace(/\./g, '')                                // P.J. → PJ, Jr. → Jr
    .replace(/'/g, '')                                 // Cam'Ron → Camron
    .replace(/\s+/g, ' ').trim();                      // espaces multiples
  return NAME_ALIASES[n] ?? n;
}

const TANK01_BASE         = 'https://tank01-fantasy-stats.p.rapidapi.com';
const TANK01_ROSTER_URL   = `${TANK01_BASE}/getNBATeams?rosters=true&schedules=false&statsToGet=averages&topPerformers=false&teamStats=false`;

const ALLOWED_AI_MODEL    = 'claude-sonnet-4-20250514';
// MAX_AI_TOKENS supprimé (v6.33) — jamais utilisé directement, remplacé par les constantes ci-dessous.
const AI_SINGLE_MAX_TOKENS = 1200;  // handleNBAAIInjuries — 1 match
const AI_BATCH_MAX_TOKENS  = 1500;  // handleNBAAIInjuriesBatch — N matchs (était 700, trop serré pour 7+ matchs → troncature JSON)
const AI_BATCH_MAX_GAMES   = 12;

const ALLOWED_ORIGINS = [
  'https://emmanueldelasse-droid.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

// ── CORS ──────────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o))
    ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResponse(data, status = 200, origin = '', extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function errorResponse(message, status = 500, origin = '') {
  return jsonResponse({ error: message }, status, origin);
}

// ── ROUTER PRINCIPAL ──────────────────────────────────────────────────────────

export default {
  // Cron Trigger — Cloudflare appelle scheduled() selon wrangler.toml
  // Cron défini : "0 * * * *" (toutes les heures) — le handler filtre lui-même
  // pour ne tourner que ~1h avant le premier match du soir.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(_runBotCron(env));
    ctx.waitUntil(_runMLBBotCron(env));
    ctx.waitUntil(_runNightlySettle(env));
    ctx.waitUntil(_runOddsSnapshot(env));
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const url    = new URL(request.url);
    const path   = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // ── NBA ──────────────────────────────────────────────────────────────
      if (path === '/nba/matches' && request.method === 'GET')
        return await handleNBAMatches(url, origin);

      if (path.match(/^\/nba\/team\/[^/]+\/stats$/) && request.method === 'GET')
        return await handleNBATeamStats(path.split('/')[3], origin);

      if (path.match(/^\/nba\/team\/[^/]+\/recent$/) && request.method === 'GET')
        return await handleNBARecentForm(env, url, path.split('/')[3], origin);

      if (path === '/nba/injuries/espn' && request.method === 'GET')
        return await handleNBAInjuriesESPN(origin);

      if (path === '/nba/injuries/impact' && request.method === 'GET')
        return await handleNBAInjuriesImpact(env, origin);

      if (path === '/nba/injuries' && request.method === 'GET')
        return await handleNBAInjuries(url, origin);

      if (path === '/nba/standings' && request.method === 'GET')
        return await handleNBAStandings(origin);

      if (path === '/nba/results' && request.method === 'GET')
        return await handleNBAResults(url, origin);

      if (path === '/nba/teams/stats' && request.method === 'GET')
        return await handleNBATeamsStats(env, origin);

      if (path === '/nba/player/test' && request.method === 'GET')
        return await handleNBAPlayerTest(url, env, origin);

      if (path === '/nba/roster-injuries' && request.method === 'GET')
        return await handleNBARosterInjuries(env, origin);

      if (path === '/nba/ai-injuries' && request.method === 'GET')
        return await handleNBAAIInjuries(url, env, origin);

      if (path === '/nba/ai-injuries-batch' && request.method === 'POST')
        return await handleNBAAIInjuriesBatch(request, env, origin);

      if (path === '/nba/roster-debug' && request.method === 'GET')
        return await handleNBARosterDebug(url, env, origin);

      if (path === '/nba/boxscore-debug' && request.method === 'GET')
        return await handleNBABoxscoreDebug(url, env, origin);

      if (path === '/nba/schedule-debug' && request.method === 'GET')
        return await handleNBAScheduleDebug(url, env, origin);

      if (path === '/debug/basketusa' && request.method === 'GET')
        return await handleDebugBasketUSA(url, env, origin);

      if (path === '/nba/odds/comparison' && request.method === 'GET')
        return await handleOddsComparison(url, env, origin);

      if (path === '/nba/player-points' && request.method === 'GET')
        return await handleNBAPlayerPointsOdds(url, env, origin);

      // ── v6.31 : Team Detail ───────────────────────────────────────────────
      if (path === '/nba/team-detail' && request.method === 'GET')
        return await handleNBATeamDetail(url, env, origin);

      // ── Routes Tennis ──────────────────────────────────────────────────
      // ── MLB ROUTES ──────────────────────────────────────────────────────────
      if (path === '/mlb/matches' && request.method === 'GET')
        return await handleMLBMatches(url, origin);

      if (path === '/mlb/odds/comparison' && request.method === 'GET')
        return await handleMLBOdds(url, env, origin);

      if (path === '/mlb/pitchers' && request.method === 'GET')
        return await handleMLBPitchers(url, env, origin);

      if (path === '/mlb/standings' && request.method === 'GET')
        return await handleMLBStandings(origin);

      if (path === '/mlb/bot/run' && request.method === 'POST')
        return await handleMLBBotRun(request, env, origin);

      if (path === '/mlb/bot/logs' && request.method === 'GET')
        return await handleMLBBotLogs(url, env, origin);

      if (path === '/mlb/bot/settle-logs' && request.method === 'POST')
        return await handleMLBBotSettleLogs(request, env, origin);

      if (path === '/tennis/sports-list' && request.method === 'GET')
        return await handleTennisSportsList(url, env, origin);
      if (path === '/tennis/csv-test' && request.method === 'GET')
        return await handleTennisCSVTest(url, env, origin);
      if (path === '/tennis/odds' && request.method === 'GET')
        return await handleTennisOdds(url, env, origin);
      if (path === '/tennis/stats' && request.method === 'GET')
        return await handleTennisStats(url, env, origin);

      // ── BOT ───────────────────────────────────────────────────────────────
      if (path === '/bot/logs' && request.method === 'GET')
        return await handleBotLogs(url, env, origin);

      if (path === '/bot/logs/export.csv' && request.method === 'GET')
        return await handleBotLogsExportCSV(url, env, origin);

      if (path === '/bot/odds-history' && request.method === 'GET')
        return await handleOddsHistory(url, env, origin);

      if (path === '/bot/settle-logs' && request.method === 'POST')
        return await handleBotSettleLogs(request, env, origin);

      if (path === '/bot/run' && request.method === 'POST')
        return await handleBotRun(request, env, origin);

      // ── PAPER TRADING ─────────────────────────────────────────────────────
      if (path === '/paper/state' && request.method === 'GET')
        return await handlePaperGet(env, origin);

      if (path === '/paper/bet' && request.method === 'POST')
        return await handlePaperPlaceBet(request, env, origin);

      if (path.match(/^\/paper\/bet\/[^/]+$/) && request.method === 'PUT')
        return await handlePaperSettleBet(request, path.split('/')[3], env, origin);

      if (path === '/paper/reset' && request.method === 'POST')
        return await handlePaperReset(request, env, origin);

      // ── IA ────────────────────────────────────────────────────────────────
      // ── SANTÉ ─────────────────────────────────────────────────────────────
      if (path === '/health') {
        return jsonResponse({
          status:    'ok',
          worker:    'mani-bet-pro',
          version:   '6.49.0',
          timestamp: new Date().toISOString(),
          routes: [
            'GET /nba/matches', 'GET /nba/team/:id/stats', 'GET /nba/team/:id/recent',
            'GET /nba/injuries/espn', 'GET /nba/injuries/impact', 'GET /nba/injuries',
            'GET /nba/standings', 'GET /nba/results', 'GET /nba/teams/stats',
            'GET /nba/player/test', 'GET /nba/roster-injuries',
            'GET /nba/ai-injuries', 'POST /nba/ai-injuries-batch', 'GET /nba/odds/comparison', 'GET /nba/team-detail',
            'GET /nba/player-points',
            'GET /paper/state', 'POST /paper/bet', 'PUT /paper/bet/:id', 'POST /paper/reset',
          ],
        }, 200, origin);
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return errorResponse('Route not found', 404, origin);

    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse(`Internal error: ${err.message}`, 500, origin);
    }
  },
};

// ── HANDLER : TEAM DETAIL — v6.31 ────────────────────────────────────────────
/**
 * GET /nba/team-detail?home=TOR&away=MIA
 * Retourne last10 matchs avec scores, top10 scoreurs, H2H, splits, momentum.
 * Cache KV 6h read / 8h write. ~23 appels Tank01 max sur cache miss.
 */
async function handleNBATeamDetail(url, env, origin) {
  const homeRaw = String(url.searchParams.get('home') || '').toUpperCase();
  const awayRaw = String(url.searchParams.get('away') || '').toUpperCase();

  if (!homeRaw || !awayRaw) {
    return jsonResponse({ error: 'missing_home_or_away' }, 400, origin);
  }

  const home = normalizeTank01TeamAbv(homeRaw);
  const away = normalizeTank01TeamAbv(awayRaw);

  const cacheKey    = `team_detail_v7_${awayRaw}_${homeRaw}`;
  const kv          = env.PAPER_TRADING;
  const now         = Date.now();
  const READ_TTL_MS = 6 * 60 * 60 * 1000;
  const WRITE_TTL_S = 8 * 60 * 60;

  const bustCache = url.searchParams.get('bust') === '1';
  try {
    const cached = kv ? await kv.get(cacheKey, { type: 'json' }) : null;
    const cachedHasData = cached?.home?.last10?.length > 0 && cached?.away?.last10?.length > 0;
    if (!bustCache && cached && cached._ts && (now - cached._ts) < READ_TTL_MS && cachedHasData) {
      return jsonResponse(cached, 200, origin);
    }
  } catch (e) {
    console.log('[TEAM-DETAIL] cache read fail', e?.message || e);
  }

  // Rosters: cached 24h in KV — fetched FIRST before bundle calls to avoid rate-limiting
  // v3 key : v2 avait rosters mais sans stats joueurs (statsToGet=averages manquait)
  const ROSTER_CACHE_KEY = 'nba_rosters_teams_v3';
  const ROSTER_TTL_MS    = 24 * 60 * 60 * 1000;
  const ROSTER_TTL_S     = 24 * 60 * 60;
  let rostersData = null;
  if (!bustCache) {
    try {
      const cached = kv ? await kv.get(ROSTER_CACHE_KEY, { type: 'json' }) : null;
      if (cached?.data && cached._ts && (Date.now() - cached._ts) < ROSTER_TTL_MS) {
        rostersData = cached.data;
      }
    } catch (_) {}
  }
  if (!rostersData) {
    // statsToGet=averages nécessaire pour obtenir ppg/reb/ast par joueur (sinon stats vides)
    rostersData = await getNBAData('getNBATeams', { rosters: 'true', schedules: 'false', statsToGet: 'averages', topPerformers: 'false', teamStats: 'false' }, env).catch(() => null);
    if (rostersData && kv) {
      try { await kv.put(ROSTER_CACHE_KEY, JSON.stringify({ _ts: Date.now(), data: rostersData }), { expirationTtl: ROSTER_TTL_S }); } catch (_) {}
    }
  }

  // Sequential to avoid Tank01 rate limits
  const homeData = await getTeamDetailBundle(home, away, env);
  const awayData = await getTeamDetailBundle(away, home, env);

  const homeTop10 = _extractTop10ForTeam(rostersData, home, homeData?.boxScores);
  const awayTop10 = _extractTop10ForTeam(rostersData, away, awayData?.boxScores);

  const [homeMedia, awayMedia] = await Promise.all([
    _findBestBasketUSAArticle(homeRaw, awayRaw, env),
    _findBestBasketUSAArticle(awayRaw, homeRaw, env),
  ]);

  const payload = {
    _ts: Date.now(),
    _bundleError_home: homeData?._bundleError ?? null,
    _bundleError_away: awayData?._bundleError ?? null,
    home: {
      teamAbv:           homeRaw,
      last10:            homeData?.last10 ?? [],
      h2h:               homeData?.h2h ?? [],
      homeSplit:         homeData?.homeSplit ?? null,
      awaySplit:         homeData?.awaySplit ?? null,
      restDays:          homeData?.restDays ?? null,
      avgTotal:          homeData?.avgTotal ?? null,
      last5ScoringAvg:   homeData?.last5ScoringAvg ?? null,
      momentum:          homeData?.momentum ?? { last3W: 0, last10W: 0 },
      top10scorers:      homeTop10 ?? [],
      latestGame:        homeData?.last10?.[0] ? _buildLatestGameSummary(homeRaw, homeData.last10[0]) : null,
      latestMediaSummary: homeMedia,
    },
    away: {
      teamAbv:           awayRaw,
      last10:            awayData?.last10 ?? [],
      h2h:               awayData?.h2h ?? [],
      homeSplit:         awayData?.homeSplit ?? null,
      awaySplit:         awayData?.awaySplit ?? null,
      restDays:          awayData?.restDays ?? null,
      avgTotal:          awayData?.avgTotal ?? null,
      last5ScoringAvg:   awayData?.last5ScoringAvg ?? null,
      momentum:          awayData?.momentum ?? { last3W: 0, last10W: 0 },
      top10scorers:      awayTop10 ?? [],
      latestGame:        awayData?.last10?.[0] ? _buildLatestGameSummary(awayRaw, awayData.last10[0]) : null,
      latestMediaSummary: awayMedia,
    },
  };

  const hasData = homeData?.last10?.length > 0 && awayData?.last10?.length > 0;
  try {
    if (kv && hasData) {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: WRITE_TTL_S });
    }
  } catch (e) {
    console.log('[TEAM-DETAIL] cache write fail', e?.message || e);
  }

  return jsonResponse(payload, 200, origin);
}

// ── HELPERS TEAM DETAIL (réparation v6.44) ─────────────────────────────────────
// Ces helpers étaient appelés par handleNBATeamDetail() mais absents du fichier
// déployé. Résultat : ReferenceError getTeamDetailBundle is not defined → 500.

async function getNBAData(endpoint, params = {}, env) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }

  const url = `${TANK01_BASE}/${endpoint}${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await _tank01FetchWithFallback(url, env, 15000);
  if (!res || !res.ok) throw new Error(`Tank01 ${endpoint} ${res?.status ?? 'no_response'}`);
  const json = await res.json();
  return json?.body ?? json ?? null;
}

function _teamDetailSafeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _teamDetailScheduleArray(payload) {
  const raw = payload?.schedule ?? payload?.body?.schedule ?? payload ?? [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

function _teamDetailIsCompletedGame(game) {
  const code = String(game?.gameStatusCode ?? game?.statusCode ?? game?.gameStatus ?? game?.status ?? '').trim();
  if (['2', '3', 'Final', 'FINAL', 'completed', 'Completed', 'Complete', 'STATUS_FINAL', 'post'].includes(code)) return true;
  if (/final|complet/i.test(code)) return true;
  // Fallback: game has valid scores → must be finished
  const ts = Number(game?.teamScore ?? game?.homeTeamScore ?? game?.homePts);
  const os = Number(game?.oppScore  ?? game?.awayTeamScore ?? game?.awayPts);
  return Number.isFinite(ts) && Number.isFinite(os) && ts > 0 && os > 0;
}

function _teamDetailExtractGameDate(game) {
  const raw = String(game?.gameDate ?? game?.date ?? game?.gameTime ?? '').trim();
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _teamDetailExtractScoreFromBoxScore(body, teamAbv, oppAbv) {
  const candidates = [
    { home: body?.homePts, away: body?.awayPts, homeAbv: body?.home, awayAbv: body?.away },
    { home: body?.homeScore, away: body?.awayScore, homeAbv: body?.home, awayAbv: body?.away },
    { home: body?.homeTeamScore, away: body?.awayTeamScore, homeAbv: body?.home, awayAbv: body?.away },
    { home: body?.homeTeam?.score, away: body?.awayTeam?.score, homeAbv: body?.home, awayAbv: body?.away },
  ];

  for (const c of candidates) {
    const home = _teamDetailSafeNum(c.home);
    const away = _teamDetailSafeNum(c.away);
    if (home === null || away === null) continue;
    const homeAbv = String(c.homeAbv ?? '').toUpperCase();
    const awayAbv = String(c.awayAbv ?? '').toUpperCase();
    if (homeAbv && awayAbv) {
      if (homeAbv === teamAbv && awayAbv === oppAbv) return { teamPts: home, oppPts: away, homeAway: 'home' };
      if (awayAbv === teamAbv && homeAbv === oppAbv) return { teamPts: away, oppPts: home, homeAway: 'away' };
    }
  }
  return null;
}

function _teamDetailExtractPlayerBoxScores(body) {
  const out = [];
  const pushLine = (line) => {
    if (!line || typeof line !== 'object') return;
    const name = line.longName || line.name || line.playerName || line.espnName || line.displayName || null;
    if (!name) return;
    out.push({
      name,
      team: String(line.team || line.teamAbv || line.teamID || '').toUpperCase() || null,
      pts:  _teamDetailSafeNum(line.pts  ?? line.PTS ?? line.points),
      reb:  _teamDetailSafeNum(line.reb  ?? line.REB ?? line.rebounds),
      ast:  _teamDetailSafeNum(line.ast  ?? line.AST ?? line.assists),
      stl:  _teamDetailSafeNum(line.stl  ?? line.STL ?? line.steals),
      blk:  _teamDetailSafeNum(line.blk  ?? line.BLK ?? line.blocks),
      mins: _teamDetailSafeNum(line.mins ?? line.MIN ?? line.min ?? line.minutes),
    });
  };

  const containers = [body?.playerStats, body?.homePlayers, body?.awayPlayers, body?.players, body?.home?.players, body?.away?.players];
  for (const container of containers) {
    if (!container) continue;
    if (Array.isArray(container)) {
      container.forEach(pushLine);
    } else if (typeof container === 'object') {
      Object.values(container).forEach(pushLine);
    }
  }
  return out;
}

function _teamDetailComputeSplit(games, side, teamAbv) {
  const filtered = games.filter(g => {
    const home = String(g?.home ?? '').trim().toUpperCase();
    const away = String(g?.away ?? '').trim().toUpperCase();
    return side === 'home' ? home === teamAbv : away === teamAbv;
  });
  if (!filtered.length) return null;
  const wins = filtered.filter(g => {
    // Try absolute scores first
    const homeScore = _teamDetailSafeNum(g?.homeTeamScore ?? g?.homePts ?? g?.homeScore);
    const awayScore = _teamDetailSafeNum(g?.awayTeamScore ?? g?.awayPts ?? g?.awayScore);
    if (homeScore !== null && awayScore !== null) {
      return side === 'home' ? homeScore > awayScore : awayScore > homeScore;
    }
    // Fallback: team-relative scores (teamScore > oppScore means the team won)
    const teamScore = _teamDetailSafeNum(g?.teamScore);
    const oppScore  = _teamDetailSafeNum(g?.oppScore);
    if (teamScore !== null && oppScore !== null) return teamScore > oppScore;
    // Last resort: gameResult field
    const r = String(g?.gameResult ?? g?.result ?? '');
    return r.startsWith('W');
  }).length;
  return { wins, losses: Math.max(0, filtered.length - wins), games: filtered.length };
}

async function getTeamDetailBundle(teamAbv, oppAbv, env) {
  const hasKeys = !!(env.TANK01_API_KEY1 || env.TANK01_API_KEY2 || env.TANK01_API_KEY3 || env.TANK01_API_KEY);
  if (!hasKeys) {
    return {
      _bundleError: 'TANK01_API_KEY not configured — set secret in Cloudflare dashboard',
      last10: [], h2h: [],
      homeSplit: null,
      awaySplit: null,
      restDays: null, avgTotal: null, last5ScoringAvg: null,
      momentum: { last3W: 0, last10W: 0 }, boxScores: {},
    };
  }
  try {
    const schedulePayload = await getNBAData('getNBATeamSchedule', { teamAbv }, env);
    const scheduleGames = _teamDetailScheduleArray(schedulePayload)
      .filter(_teamDetailIsCompletedGame)
      .sort((a, b) => Number(String(b?.gameDate ?? 0)) - Number(String(a?.gameDate ?? 0)));

    const last10Raw = scheduleGames.slice(0, 10);
    // Box scores : 5 derniers matchs, cache KV 7j par gameID (finals never change).
    // Worst case ~5 Tank01 calls/équipe au premier hit, quasi 0 ensuite.
    const boxScores = {};
    const kvBox = env.PAPER_TRADING;
    const BOX_TTL_S = 7 * 24 * 60 * 60;
    const gameIDsForBox = last10Raw.slice(0, 5).map(g => g?.gameID).filter(Boolean);
    for (const gameID of gameIDsForBox) {
      try {
        const cacheKey = `box_score_v1_${gameID}`;
        let body = null;
        if (kvBox) {
          const cached = await kvBox.get(cacheKey, { type: 'json' });
          if (cached) body = cached;
        }
        if (!body) {
          const res = await _tank01FetchWithFallback(
            `${TANK01_BASE}/getNBABoxScore?gameID=${encodeURIComponent(gameID)}`,
            env, 10000
          );
          if (res && res.ok) {
            const json = await res.json();
            body = json?.body ?? json ?? null;
            if (body && kvBox) {
              try { await kvBox.put(cacheKey, JSON.stringify(body), { expirationTtl: BOX_TTL_S }); } catch (_) {}
            }
          }
        }
        if (body) boxScores[gameID] = body;
      } catch (_) {}
    }

    const last10 = last10Raw.map((game) => {
      const gameID = game?.gameID;
      const home = String(game?.home ?? '').trim().toUpperCase();
      const away = String(game?.away ?? '').trim().toUpperCase();
      const opponent = home === teamAbv ? away : home;
      const homeAway = home === teamAbv ? 'home' : 'away';
      // Use schedule-level scores: teamScore/oppScore are team-relative,
      // homeTeamScore/awayTeamScore / homePts/awayPts are absolute.
      const teamPtsRaw = _teamDetailSafeNum(game?.teamScore);
      const oppPtsRaw  = _teamDetailSafeNum(game?.oppScore);
      const homeScore  = _teamDetailSafeNum(game?.homeTeamScore ?? game?.homePts ?? game?.homeScore);
      const awayScore  = _teamDetailSafeNum(game?.awayTeamScore ?? game?.awayPts ?? game?.awayScore);
      const teamPts = teamPtsRaw ?? (homeAway === 'home' ? homeScore : awayScore);
      const oppPts  = oppPtsRaw  ?? (homeAway === 'home' ? awayScore : homeScore);
      // Derive result from scores; fall back to gameResult/result field ("W"/"L")
      const resultRaw = game?.gameResult ?? game?.result ?? null;
      const result = teamPts !== null && oppPts !== null
        ? (teamPts > oppPts ? 'W' : 'L')
        : (typeof resultRaw === 'string' ? (resultRaw.startsWith('W') ? 'W' : resultRaw.startsWith('L') ? 'L' : null) : null);
      return {
        gameID,
        date: _teamDetailExtractGameDate(game),
        opponent,
        homeAway,
        result,
        teamPts,
        oppPts,
        total: (teamPts !== null && oppPts !== null) ? teamPts + oppPts : null,
      };
    });

    const h2h = last10.filter(g => g.opponent === oppAbv).slice(0, 5);
    const homeSplit = _teamDetailComputeSplit(scheduleGames, 'home', teamAbv);
    const awaySplit = _teamDetailComputeSplit(scheduleGames, 'away', teamAbv);

    let restDays = null;
    if (last10[0]?.date) {
      const d = new Date(`${last10[0].date}T00:00:00Z`);
      const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
      restDays = Number.isFinite(diff) ? Math.max(0, diff) : null;
    }

    const totals = last10.map(g => (g.teamPts !== null && g.oppPts !== null) ? g.teamPts + g.oppPts : null).filter(v => v !== null);
    const teamLast5 = last10.slice(0, 5).map(g => g.teamPts).filter(v => v !== null);
    const avgTotal = totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10 : null;
    const last5ScoringAvg = teamLast5.length ? Math.round((teamLast5.reduce((a, b) => a + b, 0) / teamLast5.length) * 10) / 10 : null;
    const momentum = {
      last3W: last10.slice(0, 3).filter(g => g.result === 'W').length,
      last10W: last10.filter(g => g.result === 'W').length,
    };

    return {
      last10,
      h2h,
      homeSplit,
      awaySplit,
      restDays,
      avgTotal,
      last5ScoringAvg,
      momentum,
      boxScores,
    };
  } catch (err) {
    console.warn('[TEAM-DETAIL] getTeamDetailBundle error', teamAbv, oppAbv, err?.message || err);
    return {
      _bundleError: err?.message ?? String(err),
      last10: [],
      h2h: [],
      homeSplit: null,
      awaySplit: null,
      restDays: null,
      avgTotal: null,
      last5ScoringAvg: null,
      momentum: { last3W: 0, last10W: 0 },
      boxScores: {},
    };
  }
}

function _extractTop10ForTeam(rostersPayload, teamAbv, boxScores = {}) {
  try {
    let teamsArr = [];
    if (Array.isArray(rostersPayload))              teamsArr = rostersPayload;
    else if (Array.isArray(rostersPayload?.body))   teamsArr = rostersPayload.body;
    else if (Array.isArray(rostersPayload?.teams))  teamsArr = rostersPayload.teams;
    else if (rostersPayload && typeof rostersPayload === 'object') teamsArr = Object.values(rostersPayload);
    const abv  = String(teamAbv || '').toUpperCase();
    const team = teamsArr.find(t => String(t?.teamAbv ?? t?.abbr ?? '').toUpperCase() === abv);
    const rr = team?.Roster ?? team?.roster ?? null;
    const roster = Array.isArray(rr) ? rr : (rr && typeof rr === 'object' ? Object.values(rr) : []);
    return buildTop10ScorersFromRoster(roster, teamAbv, boxScores);
  } catch (_) {
    return [];
  }
}

function buildTop10ScorersFromRoster(roster, teamAbv, boxScores = {}) {
  const players = (Array.isArray(roster) ? roster : Object.values(roster || {})).map((p) => {
    const seasonPpg = _teamDetailSafeNum(p?.ppg ?? p?.pts ?? p?.stats?.pts ?? p?.stats?.PTS);
    const reb = _teamDetailSafeNum(p?.stats?.reb ?? p?.stats?.REB ?? p?.reb);
    const ast = _teamDetailSafeNum(p?.stats?.ast ?? p?.stats?.AST ?? p?.ast);
    const stl = _teamDetailSafeNum(p?.stats?.stl ?? p?.stats?.STL ?? p?.stl);
    const blk = _teamDetailSafeNum(p?.stats?.blk ?? p?.stats?.BLK ?? p?.blk);
    const mpg = _teamDetailSafeNum(p?.stats?.mins ?? p?.stats?.MIN ?? p?.stats?.min ?? p?.mpg ?? p?.mins);
    const name = p?.longName ?? p?.espnName ?? p?.displayName ?? p?.name ?? 'Unknown';

    const last5Lines = Object.values(boxScores || {})
      .flatMap((body) => _teamDetailExtractPlayerBoxScores(body || {}))
      .filter((line) => (!line.team || line.team === String(teamAbv || '').toUpperCase()) && _normalizeName(line.name) === _normalizeName(name))
      .slice(0, 5);

    const last5Ppg = last5Lines.length
      ? Math.round((last5Lines.reduce((sum, line) => sum + (line.pts ?? 0), 0) / last5Lines.length) * 10) / 10
      : null;

    const last5MpgLines = last5Lines.filter(line => line.mins != null);
    const last5Mpg = last5MpgLines.length
      ? Math.round((last5MpgLines.reduce((sum, line) => sum + line.mins, 0) / last5MpgLines.length) * 10) / 10
      : null;

    return {
      playerID: p?.playerID ?? null,
      name,
      team: teamAbv,
      ppg: seasonPpg,
      last5_ppg: last5Ppg,
      mpg,
      last5_mpg: last5Mpg,
      reb,
      ast,
      stl,
      blk,
    };
  });

  return players
    .sort((a, b) => (b.ppg ?? -999) - (a.ppg ?? -999))
    .slice(0, 10);
}

// ── HANDLER : MATCHS (ESPN) ───────────────────────────────────────────────────

async function handleNBAMatches(url, origin) {
  const dateParam = url.searchParams.get('date');
  const dateStr   = dateParam
    ? dateParam.replace(/-/g, '')
    : formatDateESPN(new Date());

  const data = await espnFetch(`${ESPN_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!data) return errorResponse('ESPN fetch failed', 502, origin);

  return jsonResponse({
    date:    dateStr,
    source:  'espn',
    matches: parseESPNMatches(data, dateStr),
  }, 200, origin);
}

// ── HELPER : Rotation clés Tank01 ────────────────────────────────────────────

function _getTank01Key(env) {
  if (env.TANK01_API_KEY1) return env.TANK01_API_KEY1;
  if (env.TANK01_API_KEY2) return env.TANK01_API_KEY2;
  if (env.TANK01_API_KEY3) return env.TANK01_API_KEY3;
  return env.TANK01_API_KEY ?? null;
}

async function _tank01FetchWithFallback(url, env, timeout = 10000) {
  const keys = [
    env.TANK01_API_KEY1,
    env.TANK01_API_KEY2,
    env.TANK01_API_KEY3,
    env.TANK01_API_KEY,
  ].filter(Boolean);

  const uniqueKeys = [...new Set(keys)];

  for (const key of uniqueKeys) {
    try {
      const res = await fetchTimeout(url, {
        headers: {
          'x-rapidapi-host': 'tank01-fantasy-stats.p.rapidapi.com',
          'x-rapidapi-key':  key,
          'Accept':          'application/json',
        },
      }, timeout);

      if (res.status === 429) {
        console.warn(`Tank01 key ***${key.slice(-4)} → 429, essai clé suivante`);
        continue;
      }

      return res;
    } catch (err) {
      console.warn(`Tank01 key ***${key.slice(-4)} → erreur: ${err.message}`);
      continue;
    }
  }

  console.error('Tank01 : toutes les clés épuisées ou en erreur');
  return null;
}

// ── HANDLER : INJURIES IMPACT PONDÉRÉ ────────────────────────────────────────

async function handleNBAInjuriesImpact(env, origin) {
  const STATUS_WEIGHTS = {
    'Out':          1.0,
    'Doubtful':     0.75,
    'Questionable': 0.5,
    'Probable':     0.1,
    'Day-To-Day':   0.3,
  };

  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(TANK01_INJURIES_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 3 * 3600 * 1000) {
          return jsonResponse({ available: true, source: 'cache',
            fetched_at: new Date(parsed.fetched_at).toISOString(),
            by_team: parsed.by_team }, 200, origin);
        }
      }
    } catch (err) { console.warn('InjuriesImpact cache read:', err.message); }
  }

  const espnData = await espnFetch(ESPN_INJURIES);
  if (!espnData) {
    return jsonResponse({
      available:  false,
      note:       'ESPN injuries unavailable',
      by_team:    {},
      fetched_at: new Date().toISOString(),
    }, 200, origin);
  }

  let playerMap = {};
  try {
    const rosterResp = await handleNBARosterInjuries(env, origin);
    const rosterJson = await rosterResp.json();
    const rosterData = rosterJson.data ?? {};
    for (const [pid, p] of Object.entries(rosterData)) {
      if (pid === '_cached_at') continue;
      const key = _normalizeName(p.longName);
      if (key) playerMap[key] = { ppg: p.ppg ?? 0, team_abv: p.team ?? null };
    }
  } catch (err) {
    console.warn('InjuriesImpact — roster Tank01 fetch error:', err.message);
  }

  let teamPpg = {};
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(TANK01_KV_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 86400000) {
          for (const [abv, stats] of Object.entries(parsed.teams ?? {})) {
            if (stats.ppg) teamPpg[abv] = parseFloat(stats.ppg);
          }
        }
      }
    } catch (err) { console.warn('InjuriesImpact KV teamPpg read error:', err.message); }
  }

  const RELEVANT_STATUSES = new Set(['Out', 'Doubtful', 'Questionable', 'Probable', 'Day-To-Day']);
  const playersByTeam = {};

  for (const team of (espnData.injuries ?? [])) {
    const teamName = team.displayName ?? null;
    if (!teamName) continue;
    for (const inj of (team.injuries ?? [])) {
      const playerName = inj.athlete?.displayName ?? null;
      const status     = inj.status ?? null;
      if (!playerName || !RELEVANT_STATUSES.has(status)) continue;
      if (!playersByTeam[teamName]) playersByTeam[teamName] = [];
      playersByTeam[teamName].push({ name: playerName, status });
    }
  }

  const byTeam = {};

  for (const [teamName, players] of Object.entries(playersByTeam)) {
    let teamAbv = null;

    for (const p of players) {
      const rp = playerMap[_normalizeName(p.name)];
      if (rp?.team_abv) { teamAbv = rp.team_abv; break; }
    }

    const team_ppg = (teamAbv && teamPpg[teamAbv]) ? teamPpg[teamAbv] : 108;

    let impact_score = 0;
    const players_weighted = [];

    for (const p of players) {
      const sw  = STATUS_WEIGHTS[p.status] ?? 0.2;
      const rp  = playerMap[_normalizeName(p.name)];
      const ppg = rp?.ppg ?? null;

      const importance    = ppg !== null && team_ppg > 0 ? ppg / team_ppg : 0.125;
      const player_impact = importance * sw;
      impact_score       += player_impact;

      players_weighted.push({
        name:           p.name,
        status:         p.status,
        ppg,
        importance_pct: Math.round(importance * 100),
        status_weight:  sw,
        player_impact:  Math.round(player_impact * 1000) / 1000,
        source:         ppg !== null ? 'tank01_roster' : 'fallback',
      });
    }

    byTeam[teamName] = {
      impact_score:     Math.min(1, Math.round((impact_score / 1.5) * 1000) / 1000),
      team_ppg,
      team_abv:         teamAbv,
      players_weighted: players_weighted.sort((a, b) => b.player_impact - a.player_impact),
    };
  }

  if (env.PAPER_TRADING) {
    try {
      await env.PAPER_TRADING.put(TANK01_INJURIES_KEY,
        JSON.stringify({ fetched_at: Date.now(), by_team: byTeam }),
        { expirationTtl: 3 * 3600 });
    } catch (err) { console.warn('InjuriesImpact cache write:', err.message); }
  }

  return jsonResponse({
    available: true, source: 'espn_injuries+tank01_roster',
    fetched_at: new Date().toISOString(), by_team: byTeam,
  }, 200, origin);
}

// ── HANDLER : ROSTER INJURIES TANK01 ─────────────────────────────────────────

async function handleNBARosterInjuries(env, origin) {
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(TANK01_ROSTER_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 3 * 3600 * 1000) {
          return jsonResponse({
            available:  true,
            source:     'cache',
            fetched_at: new Date(parsed.fetched_at).toISOString(),
            data:       parsed.data,
          }, 200, origin);
        }
      }
    } catch (err) { console.warn('RosterInjuries cache read:', err.message); }
  }

  const tank01Key = _getTank01Key(env);
  if (!tank01Key) {
    return jsonResponse({ available: false, note: 'TANK01_API_KEY not configured', data: {} }, 200, origin);
  }

  try {
    const res = await _tank01FetchWithFallback(TANK01_ROSTER_URL, env, 15000);

    if (!res || !res.ok) {
      const status = res ? res.status : 'no_response';
      return jsonResponse({ available: false, note: `Tank01 error ${status}`, data: {} }, 200, origin);
    }

    const json  = await res.json();
    const teams = json.body ?? [];

    const playerMap = {};

    for (const team of teams) {
      const roster  = team.roster ?? {};
      const players = Array.isArray(roster) ? roster : Object.values(roster);

      for (const player of players) {
        const pid = player.playerID;
        if (!pid) continue;

        const injury      = player.injury ?? {};
        const designation = (injury.designation && injury.designation.trim()) ? injury.designation.trim() : null;

        const ptsRaw = player.stats?.pts ?? player.stats?.PTS ?? player.ppg ?? player.pts ?? '0';
        const ppg    = parseFloat(ptsRaw) || 0;

        const INJURY_STATUSES = new Set(['Out', 'Doubtful', 'Day-To-Day', 'Questionable', 'Probable']);
        const isBlessé = designation !== null && INJURY_STATUSES.has(designation);
        const isStar   = ppg >= 15;

        if (!isBlessé && !isStar) continue;

        playerMap[pid] = {
          playerID:  pid,
          longName:  player.longName ?? player.espnName ?? '',
          team:      player.team ?? team.teamAbv ?? '',
          pos:       player.pos ?? '',
          ppg,
          stats: {
            pts: ppg,
            ast: parseFloat(player.stats?.ast ?? player.stats?.AST ?? '0') || 0,
            reb: parseFloat(player.stats?.reb ?? player.stats?.REB ?? '0') || 0,
          },
          injury: {
            designation,
            description:   injury.description ?? injury.injDesc ?? '',
            injDate:       injury.injDate       ?? '',
            injReturnDate: injury.injReturnDate ?? '',
          },
        };
      }
    }

    console.log(`RosterInjuries: ${Object.keys(playerMap).length} joueurs indexés sur ${teams.length} équipes`);

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(TANK01_ROSTER_KEY,
          JSON.stringify({ fetched_at: Date.now(), data: playerMap }),
          { expirationTtl: 3 * 3600 });
      } catch (err) { console.warn('RosterInjuries cache write:', err.message); }
    }

    return jsonResponse({
      available:       true,
      source:          'tank01_roster',
      fetched_at:      new Date().toISOString(),
      teams_count:     teams.length,
      players_indexed: Object.keys(playerMap).length,
      data:            playerMap,
    }, 200, origin);

  } catch (err) {
    console.error('RosterInjuries fetch error:', err.message);
    return jsonResponse({ available: false, note: err.message, data: {} }, 200, origin);
  }
}


function _normalizeAIStatus(status) {
  const s = String(status ?? '').trim();
  return ['Out','Doubtful','Day-To-Day','Questionable','Limited','Probable'].includes(s) ? s : 'Questionable';
}

function _cleanAIInjuriesList(list, teamAbv) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(p => p && p.name)
    .map(p => ({
      name: String(p.name).trim(),
      team: teamAbv,
      status: _normalizeAIStatus(p.status),
      ppg: (p.ppg !== null && p.ppg !== undefined && !isNaN(parseFloat(p.ppg)))
        ? Math.round(parseFloat(p.ppg) * 10) / 10
        : null,
      note: typeof p.reason === 'string' ? p.reason.slice(0, 60) : null,
      source: (typeof p.source === 'string' && /nba\.com|espn\.com/i.test(p.source)) ? p.source : 'claude_web_search',
    }));
}

function _buildAIPlayersPayload(allPlayers) {
  const players_out = [];
  const players_doubtful = [];
  const players_dtd_confirmed_out = [];
  const players_limited = [];

  for (const p of allPlayers) {
    const entry = {
      name: p.name,
      team: p.team,
      status: p.status,
      ppg: p.ppg ?? null,
      source: p.source,
      note: p.note ?? null,
    };
    const s = (p.status ?? '').toLowerCase();
    if (s === 'out') players_out.push({ ...entry, status: 'OUT' });
    else if (s === 'doubtful') players_doubtful.push({ ...entry, status: 'DOUBTFUL' });
    else if (s === 'day-to-day') {
      if ((p.ppg ?? 0) >= 15) players_dtd_confirmed_out.push({ ...entry, status: 'OUT', note: (p.note ?? '') + ' — DTD star ≥15ppg' });
      else players_limited.push({ ...entry, status: 'LIMITED' });
    } else {
      players_limited.push({ ...entry, status: 'LIMITED' });
    }
  }

  return {
    players_out,
    players_doubtful,
    players_dtd_confirmed_out,
    players_limited,
  };
}

function _todayParisKey() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const y = paris.getFullYear();
  const m = String(paris.getMonth() + 1).padStart(2, '0');
  const d = String(paris.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _getParisClaudeWindowKey() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const y = paris.getFullYear();
  const m = String(paris.getMonth() + 1).padStart(2, '0');
  const d = String(paris.getDate()).padStart(2, '0');
  const hh = paris.getHours();
  if (hh >= 23) return `${y}${m}${d}_23`;
  if (hh >= 12 && hh < 13) return `${y}${m}${d}_12`;
  return null;
}

async function handleNBAAIInjuriesBatch(request, env, origin) {
  let body = null;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ available: false, note: 'invalid json body' }, 400, origin);
  }

  const date = String(body?.date ?? '').replace(/-/g, '');
  const gamesRaw = Array.isArray(body?.games) ? body.games : [];
  const mode = body?.mode === 'manual' ? 'manual' : 'auto';
  const force = body?.force === true;

  if (!date || date.length !== 8) {
    return jsonResponse({ available: false, note: 'date required in YYYYMMDD' }, 400, origin);
  }

  const games = gamesRaw
    .map(g => ({
      home: String(g?.home ?? '').trim().toUpperCase(),
      away: String(g?.away ?? '').trim().toUpperCase(),
    }))
    .filter(g => g.home && g.away)
    .slice(0, AI_BATCH_MAX_GAMES);

  if (!games.length) {
    return jsonResponse({ available: false, note: 'games required' }, 400, origin);
  }

  const windowKey = _getParisClaudeWindowKey();
  if (mode !== 'manual' && !windowKey && !force) {
    return jsonResponse({ available: false, note: 'outside auto window', reason: 'outside_window_cache_only' }, 200, origin);
  }

  const gamesKey = games.map(g => `${g.away}@${g.home}`).sort().join('|');
  const cacheKey = `ai_injuries_batch_v2_${date}_${gamesKey}`;
  const READ_TTL_MS = 6 * 3600 * 1000;
  const WRITE_TTL_S = 8 * 3600;
  const dailyLimit = 4;

  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey, { type: 'json' });
      if (cached && cached.fetched_at && (Date.now() - cached.fetched_at) < READ_TTL_MS) {
        return jsonResponse({
          available: true,
          source: 'cache',
          fetched_at: new Date(cached.fetched_at).toISOString(),
          games: cached.games,
          by_game: cached.by_game,
        }, 200, origin);
      }
    } catch (err) {
      console.warn('AIInjuriesBatch cache read error:', err.message);
    }
  }

  if (!env.CLAUDE_API_KEY) {
    return jsonResponse({ available: false, note: 'CLAUDE_API_KEY not configured' }, 200, origin);
  }

  // CORRECTION v6.32 : incrémenter le compteur AVANT l'appel Claude.
  // Ancienne logique : check avant → appel Claude → incrément après.
  // Race condition : deux requêtes simultanées passent toutes les deux le check
  // à count=0, appellent Claude deux fois, et incrémentent chacune à 1.
  // Nouveau pattern : lire + incrémenter avant l'appel → une requête bloque l'autre.
  // Note : KV Cloudflare n'est pas transactionnel, mais la fenêtre de collision
  // est réduite de ~30s (durée appel Claude) à ~1ms (durée lecture KV).
  const _batchRateKey = `ai_injuries_batch_rate_${_todayParisKey()}`;
  if (env.PAPER_TRADING) {
    try {
      const rateRaw = await env.PAPER_TRADING.get(_batchRateKey);
      const count = rateRaw ? parseInt(rateRaw, 10) : 0;
      if (count >= dailyLimit) {
        return jsonResponse({ available: false, note: `AI injuries batch daily limit reached (${dailyLimit}/day)` }, 429, origin);
      }
      // Incrémenter immédiatement — avant l'appel Claude
      await env.PAPER_TRADING.put(_batchRateKey, String(count + 1), { expirationTtl: 25 * 3600 });
    } catch (err) {
      console.warn('AIInjuriesBatch rate read/increment error:', err.message);
      // Ne pas bloquer si KV indisponible — continuer sans rate limit
    }
  }

  const compactGames = games.map(g => `${g.away}@${g.home}`).join(', ');
  const systemPrompt = `Tu extrais uniquement des blessures NBA utiles depuis nba.com/injuries et espn.com/nba. Réponds uniquement en JSON valide. Pas de texte libre. Pas de contexte match. Pas d'explication. Garde seulement name, team, status, ppg, source, reason.`;
  const userPrompt = `Date:${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}\nMatchs:${compactGames}\nRetourne exactement {"games":[{"game":"AWY@HOME","injuries":{"home":[{"name":"","team":"HOME","status":"Out|Doubtful|Day-To-Day|Questionable|Limited|Probable","ppg":null,"source":"nba.com|espn.com","reason":null}],"away":[{"name":"","team":"AWY","status":"Out|Doubtful|Day-To-Day|Questionable|Limited|Probable","ppg":null,"source":"nba.com|espn.com","reason":null}]}}]}. Mets des tableaux vides si aucune blessure trouvée.`;

  try {
    const textContent = await _callClaudeWithWebSearch(env.CLAUDE_API_KEY, systemPrompt, userPrompt, AI_BATCH_MAX_TOKENS);
    if (!textContent) {
      return jsonResponse({ available: false, note: 'Claude returned no content' }, 200, origin);
    }

    const cleaned = textContent.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const byGame = {};

    for (const item of (parsed?.games ?? [])) {
      const game = String(item?.game ?? '').trim().toUpperCase();
      if (!game || !game.includes('@')) continue;
      const away = game.split('@')[0];
      const home = game.split('@')[1];
      byGame[game] = _buildAIPlayersPayload([
        ..._cleanAIInjuriesList(item?.injuries?.home, home),
        ..._cleanAIInjuriesList(item?.injuries?.away, away),
      ]);
    }

    const payload = { fetched_at: Date.now(), games: games.map(g => `${g.away}@${g.home}`), by_game: byGame };
    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(cacheKey, JSON.stringify(payload), { expirationTtl: WRITE_TTL_S });
        // Note : l'incrément du rate limit est effectué AVANT l'appel Claude (v6.32).
        // Ne pas ré-incrémenter ici.
      } catch (err) {
        console.warn('AIInjuriesBatch cache write error:', err.message);
      }
    }

    return jsonResponse({
      available: true,
      source: 'claude_web_search',
      fetched_at: new Date().toISOString(),
      games: payload.games,
      by_game: byGame,
    }, 200, origin);
  } catch (err) {
    console.error('AIInjuriesBatch error:', err.message);
    return jsonResponse({ available: false, note: err.message }, 200, origin);
  }
}

// ── HANDLER : AI CONTEXT GLOBAL ───────────────────────────────────────────────

// ── HANDLER : AI INJURIES ONLY ──────────────────────────────────────────────

async function handleNBAAIInjuries(url, env, origin) {
  const home = (url.searchParams.get('home') ?? '').trim().toUpperCase();
  const away = (url.searchParams.get('away') ?? '').trim().toUpperCase();
  const date = url.searchParams.get('date') ?? formatDateESPN(new Date());

  if (!home || !away) {
    return jsonResponse({ available: false, note: 'home and away params required' }, 400, origin);
  }

  const cacheKey = `ai_injuries_only_${date}_${away}_${home}`;
  const READ_TTL_MS = 6 * 3600 * 1000;
  const WRITE_TTL_S = 8 * 3600;

  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey, { type: 'json' });
      if (cached && cached.fetched_at && (Date.now() - cached.fetched_at) < READ_TTL_MS) {
        return jsonResponse({
          available: true,
          source: 'cache',
          fetched_at: new Date(cached.fetched_at).toISOString(),
          home,
          away,
          data: cached.data,
        }, 200, origin);
      }
    } catch (err) {
      console.warn('AIInjuries cache read error:', err.message);
    }
  }

  if (!env.CLAUDE_API_KEY) {
    return jsonResponse({ available: false, note: 'CLAUDE_API_KEY not configured', home, away }, 200, origin);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `ai_injuries_rate_${today}`;
  const dailyLimit = 4;

  // CORRECTION v6.32 : incrémenter avant l'appel Claude (même fix que handleNBAAIInjuriesBatch).
  if (env.PAPER_TRADING) {
    try {
      const rateRaw = await env.PAPER_TRADING.get(rateKey);
      const count = rateRaw ? parseInt(rateRaw, 10) : 0;
      if (count >= dailyLimit) {
        return jsonResponse({ available: false, note: `AI injuries daily limit reached (${dailyLimit}/day)`, home, away }, 429, origin);
      }
      // Incrémenter immédiatement — avant l'appel Claude
      await env.PAPER_TRADING.put(rateKey, String(count + 1), { expirationTtl: 25 * 3600 });
    } catch (err) {
      console.warn('AIInjuries rate read/increment error:', err.message);
    }
  }

  const systemPrompt = `Tu es un extracteur strict de blessures NBA.
RÈGLES ABSOLUES :
1. Recherche uniquement sur nba.com/injuries et espn.com/nba.
2. Retourne uniquement les blessures des deux équipes demandées.
3. N'invente jamais un joueur, un statut ou un ppg. Si inconnu -> null.
4. Réponds uniquement avec du JSON valide, sans texte autour.
5. N'inclus aucun contexte de match, aucune motivation, aucun enjeu, aucun mouvement de ligne.`;

  const userPrompt = `Date : ${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}
Match : ${away}@${home}
Retourne exactement cet objet JSON :
{
  "game": "${away}@${home}",
  "injuries": {
    "home": [{"name":"Prénom Nom","team":"${home}","status":"Out|Doubtful|Day-To-Day|Questionable|Limited","ppg":null,"reason":null,"source":"nba.com|espn.com"}],
    "away": [{"name":"Prénom Nom","team":"${away}","status":"Out|Doubtful|Day-To-Day|Questionable|Limited","ppg":null,"reason":null,"source":"nba.com|espn.com"}]
  }
}`;

  try {
    const textContent = await _callClaudeWithWebSearch(env.CLAUDE_API_KEY, systemPrompt, userPrompt, AI_SINGLE_MAX_TOKENS);
    if (!textContent) {
      return jsonResponse({ available: false, note: 'Claude returned no content', home, away }, 200, origin);
    }

    const cleaned = textContent.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const cleanInjuries = (list, teamAbv) => {
      if (!Array.isArray(list)) return [];
      return list.filter(p => p && p.name).map(p => ({
        name: String(p.name).trim(),
        team: teamAbv,
        status: ['Out','Doubtful','Day-To-Day','Questionable','Limited','Probable'].includes(p.status) ? p.status : 'Questionable',
        ppg: (p.ppg !== null && p.ppg !== undefined && !isNaN(parseFloat(p.ppg))) ? Math.round(parseFloat(p.ppg) * 10) / 10 : null,
        note: typeof p.reason === 'string' ? p.reason.slice(0, 100) : null,
        source: (typeof p.source === 'string' && /nba\.com|espn\.com/i.test(p.source)) ? p.source : 'claude_web_search',
      }));
    };

    const injHome = cleanInjuries(parsed?.injuries?.home, home);
    const injAway = cleanInjuries(parsed?.injuries?.away, away);
    const allPlayers = [...injHome, ...injAway];

    const players_out = [];
    const players_doubtful = [];
    const players_dtd_confirmed_out = [];
    const players_limited = [];

    for (const p of allPlayers) {
      const entry = {
        name: p.name,
        team: p.team,
        status: p.status,
        ppg: p.ppg ?? null,
        source: p.source,
        note: p.note ?? null,
      };
      const s = (p.status ?? '').toLowerCase();
      if (s === 'out') players_out.push({ ...entry, status: 'OUT' });
      else if (s === 'doubtful') players_doubtful.push({ ...entry, status: 'DOUBTFUL' });
      else if (s === 'day-to-day') {
        if ((p.ppg ?? 0) >= 15) players_dtd_confirmed_out.push({ ...entry, status: 'OUT', note: (p.note ?? '') + ' — DTD star ≥15ppg' });
        else players_limited.push({ ...entry, status: 'LIMITED' });
      } else {
        players_limited.push({ ...entry, status: 'LIMITED' });
      }
    }

    const payload = {
      players_out,
      players_doubtful,
      players_dtd_confirmed_out,
      players_limited,
    };

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(cacheKey, JSON.stringify({ fetched_at: Date.now(), data: payload }), { expirationTtl: WRITE_TTL_S });
        // Note : l'incrément du rate limit est effectué AVANT l'appel Claude (v6.32).
        // Ne pas ré-incrémenter ici.
      } catch (err) {
        console.warn('AIInjuries cache write error:', err.message);
      }
    }

    return jsonResponse({ available: true, source: 'claude_web_search', fetched_at: new Date().toISOString(), home, away, data: payload }, 200, origin);
  } catch (err) {
    console.error('AIInjuries error:', err.message);
    return jsonResponse({ available: false, note: err.message, home, away }, 200, origin);
  }
}

// ── CLAUDE WEB SEARCH ─────────────────────────────────────────────────────────

async function _callClaudeWithWebSearch(apiKey, systemPrompt, userPrompt, maxTokens = 1200) {
  // MAX_TURNS = 3 : 1 appel initial + max 1 tour de recherche web + 1 reponse finale.
  // web_search_20250305 est gere cote ANTHROPIC — le worker renvoie des tool_result
  // vides (is_error: false, content: []). Claude recupere les resultats directement
  // depuis Anthropic, pas depuis le worker. tool_result mal forme = boucle infinie.
  const MAX_TURNS     = 3;
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const messages      = [{ role: 'user', content: userPrompt }];
  let finalText       = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    try {
      response = await fetchTimeout(ANTHROPIC_URL, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      ALLOWED_AI_MODEL,
          max_tokens: maxTokens,
          system:     systemPrompt,
          tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
          messages,
        }),
      }, 45000);  // 45s — Claude web_search peut prendre 15-20s sur matchs nombreux
    } catch (err) {
      console.warn(`Claude web_search turn ${turn} fetch error:`, err.message);
      return null;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`Claude API error ${response.status} on turn ${turn}:`, errText.slice(0, 200));
      return null;
    }

    const data       = await response.json();
    const content    = data.content ?? [];
    const stopReason = data.stop_reason;

    // Log tokens pour monitoring consommation
    if (data.usage) {
      console.log(`Claude turn ${turn} — in:${data.usage.input_tokens} out:${data.usage.output_tokens} stop:${stopReason}`);
    }

    messages.push({ role: 'assistant', content });

    // Reponse finale
    if (stopReason === 'end_turn') {
      finalText = content.filter(b => b.type === 'text').map(b => b.text).join('');
      break;
    }

    // tool_use : renvoyer tool_result VIDES — Anthropic gere les resultats cote serveur
    if (stopReason === 'tool_use') {
      const toolUseBlocks = content.filter(b => b.type === 'tool_use');

      if (!toolUseBlocks.length) {
        finalText = content.filter(b => b.type === 'text').map(b => b.text).join('');
        break;
      }

      // CORRECTION CRITIQUE : content:[] et is_error:false (pas b.input stringify)
      // Renvoyer b.input comme content provoquait une boucle de 5 appels inutiles
      const toolResults = toolUseBlocks.map(b => ({
        type:        'tool_result',
        tool_use_id: b.id,
        is_error:    false,
        content:     [],
      }));

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // max_tokens ou autre stop_reason — extraire ce qu'on a
    finalText = content.filter(b => b.type === 'text').map(b => b.text).join('');
    break;
  }

  return finalText || null;
}

function _validateAIInjuryList(list, teamsAbv) {
  if (!Array.isArray(list)) return [];
  return list.filter(p => {
    if (!p || typeof p !== 'object') return false;
    if (!p.name || typeof p.name !== 'string' || p.name.trim() === '') return false;
    if (!p.team || typeof p.team !== 'string') return false;
    if (p.ppg !== null && p.ppg !== undefined) {
      const ppg = parseFloat(p.ppg);
      if (isNaN(ppg) || ppg < 0 || ppg > 60) { p.ppg = null; }
      else { p.ppg = Math.round(ppg * 10) / 10; }
    }
    return true;
  }).map(p => ({
    name:   p.name.trim(),
    team:   p.team.trim().toUpperCase(),
    status: p.status ?? 'OUT',
    ppg:    p.ppg ?? null,
    source: p.source ?? 'claude_web_search',
    note:   p.note ?? null,
  }));
}

// ── HANDLER : PLAYER TEST ─────────────────────────────────────────────────────

async function handleNBAPlayerTest(url, env, origin) {
  // Guard debug — CORRECTION v6.33
  if (env.DEBUG_SECRET && url.searchParams.get('secret') !== env.DEBUG_SECRET)
    return errorResponse('Unauthorized', 401, origin);
  const tank01Key  = _getTank01Key(env);
  if (!tank01Key) {
    return jsonResponse({ available: false, note: 'TANK01_API_KEY not configured' }, 200, origin);
  }
  const playerName = url.searchParams.get('name') ?? 'Victor Wembanyama';
  try {
    const res = await fetchTimeout(
      `${TANK01_BASE}/getNBAPlayerInfo?playerName=${encodeURIComponent(playerName)}&statsToGet=averages`,
      {
        headers: {
          'x-rapidapi-host': 'tank01-fantasy-stats.p.rapidapi.com',
          'x-rapidapi-key':  tank01Key,
          'Accept':          'application/json',
        },
      }, 10000
    );
    if (!res.ok) {
      return jsonResponse({ available: false, note: `Tank01 error ${res.status}`, player: playerName }, 200, origin);
    }
    const data = await res.json();
    return jsonResponse({
      available:    true,
      player_query: playerName,
      raw_body:     data.body ?? null,
      count:        (data.body ?? []).length,
    }, 200, origin);
  } catch (err) {
    return jsonResponse({ available: false, note: err.message, player: playerName }, 200, origin);
  }
}

// ── HANDLER : ROSTER DEBUG ────────────────────────────────────────────────────

async function handleNBARosterDebug(url, env, origin) {
  // Guard debug — CORRECTION v6.33
  if (env.DEBUG_SECRET && url.searchParams.get('secret') !== env.DEBUG_SECRET)
    return errorResponse('Unauthorized', 401, origin);
  const teamAbv  = url.searchParams.get('team') ?? 'LAL';
  const debugUrl = `${TANK01_BASE}/getNBATeams?rosters=true&schedules=false&statsToGet=averages&topPerformers=false&teamStats=false`;

  const res = await _tank01FetchWithFallback(debugUrl, env, 15000);
  if (!res || !res.ok) {
    return jsonResponse({ available: false, note: `Tank01 ${res?.status ?? 'no_response'}` }, 200, origin);
  }

  const json  = await res.json();
  const teams = json.body ?? [];
  const team  = teams.find(t => (t.teamAbv ?? '').toUpperCase() === teamAbv.toUpperCase());

  if (!team) {
    return jsonResponse({
      available: false,
      note:      `Team ${teamAbv} not found`,
      teams_available: teams.map(t => t.teamAbv),
    }, 200, origin);
  }

  const roster  = team.roster ?? {};
  const players = Array.isArray(roster) ? roster : Object.values(roster);
  const sample  = players.slice(0, 3).map(p => ({
    playerID:   p.playerID,
    longName:   p.longName,
    team:       p.team,
    stats_raw:  p.stats ?? null,
    ppg_direct: p.ppg ?? null,
    pts_direct: p.pts ?? null,
    injury_raw: p.injury ?? null,
  }));

  return jsonResponse({
    available:    true,
    team:         teamAbv,
    roster_type:  Array.isArray(roster) ? 'array' : 'object',
    roster_count: players.length,
    sample,
  }, 200, origin);
}


// ── BASKET USA HELPERS + TEAM DETAIL MEDIA ───────────────────────────────────

const BU_DEBUG_TEAMS = {
  ATL: ['atlanta hawks', 'atlanta', 'hawks'],
  BOS: ['boston celtics', 'boston', 'celtics'],
  BKN: ['brooklyn nets', 'brooklyn', 'nets'],
  CHA: ['charlotte hornets', 'charlotte', 'hornets'],
  CHI: ['chicago bulls', 'chicago', 'bulls'],
  CLE: ['cleveland cavaliers', 'cleveland', 'cavaliers', 'cavs'],
  DAL: ['dallas mavericks', 'dallas', 'mavericks', 'mavs'],
  DEN: ['denver nuggets', 'denver', 'nuggets'],
  DET: ['detroit pistons', 'detroit', 'pistons'],
  GSW: ['golden state warriors', 'golden state', 'warriors', 'gsw'],
  HOU: ['houston rockets', 'houston', 'rockets'],
  IND: ['indiana pacers', 'indiana', 'pacers'],
  LAC: ['los angeles clippers', 'la clippers', 'clippers', 'lac'],
  LAL: ['los angeles lakers', 'la lakers', 'lakers', 'lal'],
  MEM: ['memphis grizzlies', 'memphis', 'grizzlies', 'grizz'],
  MIA: ['miami heat', 'miami', 'heat'],
  MIL: ['milwaukee bucks', 'milwaukee', 'bucks'],
  MIN: ['minnesota timberwolves', 'minnesota', 'timberwolves', 'wolves'],
  NOP: ['new orleans pelicans', 'new orleans', 'pelicans', 'pels'],
  NYK: ['new york knicks', 'new york', 'knicks', 'ny knicks'],
  OKC: ['oklahoma city thunder', 'oklahoma city', 'thunder', 'okc'],
  ORL: ['orlando magic', 'orlando', 'magic'],
  PHI: ['philadelphia 76ers', 'philadelphia', '76ers', 'sixers', 'philly', 'philadelphie sixers'],
  PHX: ['phoenix suns', 'phoenix', 'suns'],
  POR: ['portland trail blazers', 'portland', 'trail blazers', 'blazers'],
  SAC: ['sacramento kings', 'sacramento', 'kings'],
  SAS: ['san antonio spurs', 'san antonio', 'spurs'],
  TOR: ['toronto raptors', 'toronto', 'raptors'],
  UTA: ['utah jazz', 'utah', 'jazz'],
  WAS: ['washington wizards', 'washington', 'wizards'],
};

function _buNormalizeText(input = '') {
  return String(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _buExtractCandidatesFromHtml(html, baseUrl) {
  const candidates = [];
  if (!html) return candidates;

  const articleRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const href = match[1] || '';
    const inner = match[2] || '';
    const title = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#8217;/g, "'")
      .replace(/&#8211;/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    if (!title || title.length < 12) continue;
    if (!href.includes('/news/') && !href.includes('/category/')) continue;

    let absUrl = href;
    if (href.startsWith('/')) absUrl = baseUrl + href;
    if (href.startsWith('//')) absUrl = 'https:' + href;

    candidates.push({ title, url: absUrl });
  }

  const dedup = new Map();
  for (const c of candidates) {
    const key = `${c.title}__${c.url}`;
    if (!dedup.has(key)) dedup.set(key, c);
  }
  return [...dedup.values()].slice(0, 120);
}

function _buScoreCandidate(article, home, away) {
  const text = _buNormalizeText(`${article.title}`);
  const homeAliases = BU_DEBUG_TEAMS[home] ?? [];
  const awayAliases = BU_DEBUG_TEAMS[away] ?? [];
  let score = 0;

  let homeHit = false;
  let awayHit = false;

  for (const alias of homeAliases) {
    if (text.includes(_buNormalizeText(alias))) {
      score += 3;
      homeHit = true;
      break;
    }
  }

  for (const alias of awayAliases) {
    if (text.includes(_buNormalizeText(alias))) {
      score += 3;
      awayHit = true;
      break;
    }
  }

  if (homeHit && awayHit) score += 2;

  const goodWords = [
    'remport',
    'bat',
    'domine',
    's impose',
    'victoire',
    'defaite',
    'face aux',
    'contre',
    'playoffs',
    'play off',
    'resume',
    'fait plier',
    'repoussent',
    'premier round',
    'game 1'
  ];

  for (const w of goodWords) {
    if (text.includes(w)) {
      score += 1;
      break;
    }
  }

  const previewWords = [
    'preview playoffs',
    'preview',
    'programme du soir',
    'pronostics'
  ];

  for (const w of previewWords) {
    if (text.includes(w)) {
      score -= 4;
      break;
    }
  }

  const badWords = [
    'blessure',
    'transfert',
    'trade',
    'rumeur',
    'draft',
    'free agency',
    'contrat'
  ];

  for (const w of badWords) {
    if (text.includes(w)) {
      score -= 3;
      break;
    }
  }

  return score;
}

async function _findBestBasketUSAArticle(home, away, env) {
  const pages = [
    'https://www.basketusa.com/',
    'https://www.basketusa.com/category/news/',
  ];

  const cacheKey = `basketusa_best_v3_${home}_${away}`;
  const READ_TTL_MS = 30 * 60 * 1000;
  const WRITE_TTL_S = 45 * 60;

  if (env?.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey, { type: 'json' });
      if (cached && cached._ts && (Date.now() - cached._ts) < READ_TTL_MS) {
        return cached.data ?? null;
      }
    } catch (_) {}
  }

  const allCandidates = [];

  for (const pageUrl of pages) {
    try {
      const res = await fetchTimeout(pageUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; ManiBetPro/1.0)',
        },
      }, 12000);

      const html = res.ok ? await res.text() : '';
      const candidates = _buExtractCandidatesFromHtml(html, 'https://www.basketusa.com');
      allCandidates.push(...candidates);
    } catch (err) {
      console.log('[BU] page error', pageUrl, err.message);
    }
  }

  const dedup = new Map();
  for (const c of allCandidates) {
    const key = `${c.title}__${c.url}`;
    if (!dedup.has(key)) dedup.set(key, c);
  }

  const scored = [...dedup.values()]
    .map(article => ({
      ...article,
      normalizedTitle: _buNormalizeText(article.title),
      score: _buScoreCandidate(article, home, away),
    }))
    .sort((a, b) => b.score - a.score);

  const isPreviewLike = (text) => {
    return text.includes('preview playoffs')
      || text.includes('preview')
      || text.includes('programme du soir')
      || text.includes('pronostics');
  };

  const isRecapLike = (text) => {
    return text.includes('remport')
      || text.includes('fait plier')
      || text.includes('repoussent')
      || text.includes('premier round')
      || text.includes('game 1')
      || text.includes('s impose')
      || text.includes('s imposent')
      || text.includes('a trouve la cle')
      || text.includes('a trouve son second souffle');
  };

  const recapCandidates = scored.filter(x => !isPreviewLike(x.normalizedTitle));
  const previewCandidates = scored.filter(x => isPreviewLike(x.normalizedTitle));

  const strongRecapCandidates = recapCandidates
    .map(x => ({
      ...x,
      finalScore: x.score + (isRecapLike(x.normalizedTitle) ? 4 : 0),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const strongPreviewCandidates = previewCandidates
    .map(x => ({
      ...x,
      finalScore: x.score,
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const bestRecap = strongRecapCandidates[0] ?? null;
  const bestPreview = strongPreviewCandidates[0] ?? null;

  let accepted = null;

  if (bestRecap && bestRecap.finalScore >= 5) {
    accepted = {
      source: 'Basket USA',
      title: bestRecap.title,
      url: bestRecap.url,
      score: bestRecap.finalScore,
      article_type: 'recap',
    };
  } else if (bestPreview && bestPreview.finalScore >= 7) {
    accepted = {
      source: 'Basket USA',
      title: bestPreview.title,
      url: bestPreview.url,
      score: bestPreview.finalScore,
      article_type: 'preview_fallback',
    };
  }

  if (env?.PAPER_TRADING) {
    try {
      await env.PAPER_TRADING.put(cacheKey, JSON.stringify({
        _ts: Date.now(),
        data: accepted,
      }), { expirationTtl: WRITE_TTL_S });
    } catch (_) {}
  }

  return accepted;
}

function _buildLatestGameSummary(teamAbv, game) {
  if (!game) return null;
  const won = game.result === 'W';
  const loc = game.homeAway === 'home' ? 'à domicile' : 'à l’extérieur';
  return {
    teamAbv,
    date: game.date ?? null,
    opponent: game.opponent ?? null,
    homeAway: game.homeAway ?? null,
    result: game.result ?? null,
    teamPts: game.teamPts ?? null,
    oppPts: game.oppPts ?? null,
    summary_short: `${won ? 'Victoire' : 'Défaite'} ${game.homeAway === 'home' ? 'vs' : '@'} ${game.opponent ?? '—'} ${game.teamPts ?? '—'}-${game.oppPts ?? '—'}`,
    summary_long: `${won ? 'victoire' : 'défaite'} ${game.homeAway === 'home' ? 'contre' : 'chez'} ${game.opponent ?? '—'} ${game.teamPts ?? '—'}-${game.oppPts ?? '—'} ${loc}`,
  };
}

async function handleDebugBasketUSA(url, env, origin) {
  const home = String(url.searchParams.get('home') ?? '').toUpperCase();
  const away = String(url.searchParams.get('away') ?? '').toUpperCase();

  if (!home || !away) {
    return jsonResponse({ error: 'home and away params required' }, 400, origin);
  }

  const pages = [
    'https://www.basketusa.com/',
    'https://www.basketusa.com/category/news/',
  ];

  const fetched = [];
  const allCandidates = [];

  for (const pageUrl of pages) {
    try {
      const res = await fetchTimeout(pageUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; ManiBetPro/1.0)',
        },
      }, 12000);

      const html = res.ok ? await res.text() : '';
      const candidates = _buExtractCandidatesFromHtml(html, 'https://www.basketusa.com');

      console.log('[BU] page', pageUrl);
      console.log('[BU] status', res.status);
      console.log('[BU] html length', html?.length ?? 0);
      console.log('[BU] candidates', candidates.map(x => x.title));

      fetched.push({
        url: pageUrl,
        status: res.status,
        html_length: html?.length ?? 0,
        candidates_count: candidates.length,
        preview: html ? html.slice(0, 800) : '',
      });

      allCandidates.push(...candidates);
    } catch (err) {
      console.log('[BU] page error', pageUrl, err.message);
      fetched.push({
        url: pageUrl,
        status: 'ERROR',
        html_length: 0,
        candidates_count: 0,
        error: err.message,
      });
    }
  }

  const dedup = new Map();
  for (const c of allCandidates) {
    const key = `${c.title}__${c.url}`;
    if (!dedup.has(key)) dedup.set(key, c);
  }

  const scored = [...dedup.values()]
    .map(article => ({
      ...article,
      normalizedTitle: _buNormalizeText(article.title),
      score: _buScoreCandidate(article, home, away),
    }))
    .sort((a, b) => b.score - a.score);

  const isPreviewLike = (text) => {
    return text.includes('preview playoffs')
      || text.includes('preview')
      || text.includes('programme du soir')
      || text.includes('pronostics');
  };

  const isRecapLike = (text) => {
    return text.includes('remport')
      || text.includes('fait plier')
      || text.includes('repoussent')
      || text.includes('premier round')
      || text.includes('game 1')
      || text.includes('s impose')
      || text.includes('s imposent')
      || text.includes('a trouve la cle')
      || text.includes('a trouve son second souffle');
  };

  const recap_candidates = scored
    .filter(x => !isPreviewLike(x.normalizedTitle))
    .map(x => ({ ...x, finalScore: x.score + (isRecapLike(x.normalizedTitle) ? 4 : 0) }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const preview_candidates = scored
    .filter(x => isPreviewLike(x.normalizedTitle))
    .map(x => ({ ...x, finalScore: x.score }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const best_recap = recap_candidates[0] ?? null;
  const best_preview = preview_candidates[0] ?? null;
  const accepted = best_recap && best_recap.finalScore >= 5
    ? best_recap
    : best_preview && best_preview.finalScore >= 7
      ? best_preview
      : null;

  console.log('[BU] scored', scored.slice(0, 20).map(x => ({ title: x.title, score: x.score })));
  console.log('[BU] best recap', best_recap ? { title: best_recap.title, finalScore: best_recap.finalScore, url: best_recap.url } : null);
  console.log('[BU] best preview', best_preview ? { title: best_preview.title, finalScore: best_preview.finalScore, url: best_preview.url } : null);

  return jsonResponse({
    home,
    away,
    fetched,
    total_candidates: scored.length,
    top_candidates: scored.slice(0, 20),
    recap_candidates: recap_candidates.slice(0, 20),
    preview_candidates: preview_candidates.slice(0, 20),
    best_recap,
    best_preview,
    accepted,
  }, 200, origin);
}


function normalizeTank01TeamAbv(abv = '') {
  const map = {
    NYK: 'NY',
    GSW: 'GS',
    NOP: 'NO',
    SAS: 'SA',
  };
  return map[String(abv || '').toUpperCase()] || String(abv || '').toUpperCase();
}

// ── HANDLER : TEAMS STATS ─────────────────────────────────────────────────────

// ── HANDLER : BOXSCORE DEBUG — structure brute Tank01 ────────────────────────
// GET /nba/boxscore-debug?gameID=CHA@DET_20260408
// Retourne la structure brute du body Tank01 getNBABoxScore pour diagnostiquer
// les champs playerStats, homePts, awayPts, etc.
async function handleNBABoxscoreDebug(url, env, origin) {
  // Guard debug — CORRECTION v6.33
  if (env.DEBUG_SECRET && url.searchParams.get('secret') !== env.DEBUG_SECRET)
    return errorResponse('Unauthorized', 401, origin);
  const gameID = url.searchParams.get('gameID');
  if (!gameID) {
    return jsonResponse({ error: 'gameID param required (ex: CHA@DET_20260408)' }, 400, origin);
  }

  const res = await _tank01FetchWithFallback(
    `${TANK01_BASE}/getNBABoxScore?gameID=${encodeURIComponent(gameID)}`,
    env, 12000
  );

  if (!res || !res.ok) {
    return jsonResponse({ error: `Tank01 ${res?.status ?? 'no_response'}`, gameID }, 200, origin);
  }

  const json = await res.json();
  const body = json?.body ?? {};

  // Retourner la structure complète + un résumé des clés disponibles
  const topKeys = Object.keys(body);
  
  // Echantillon playerStats si présent
  let playerStatsSample = null;
  for (const key of ['playerStats', 'homePlayers', 'awayPlayers', 'home', 'away', 'players']) {
    if (body[key]) {
      const val = body[key];
      if (Array.isArray(val)) {
        playerStatsSample = { key, type: 'array', length: val.length, sample: val.slice(0, 2) };
      } else if (typeof val === 'object') {
        const entries = Object.entries(val).slice(0, 2);
        playerStatsSample = { key, type: 'object', keys_count: Object.keys(val).length, sample: Object.fromEntries(entries) };
      }
      break;
    }
  }

  return jsonResponse({
    gameID,
    top_level_keys: topKeys,
    score_fields: {
      homePts:        body.homePts        ?? null,
      awayPts:        body.awayPts        ?? null,
      homeScore:      body.homeScore      ?? null,
      awayScore:      body.awayScore      ?? null,
      homeTeamScore:  body.homeTeam?.score ?? body.homeTeamScore ?? null,
      awayTeamScore:  body.awayTeam?.score ?? body.awayTeamScore ?? null,
    },
    player_stats_sample: playerStatsSample,
    raw_body: body,
  }, 200, origin);
}

// ── HANDLER : SCHEDULE DEBUG — structure brute Tank01 ────────────────────────
// GET /nba/schedule-debug?team=CHA
// Retourne les 3 premiers matchs du schedule pour voir les champs disponibles
// (homeTeamScore, awayTeamScore, gameResult, etc.)
async function handleNBAScheduleDebug(url, env, origin) {
  // Guard debug — CORRECTION v6.33
  if (env.DEBUG_SECRET && url.searchParams.get('secret') !== env.DEBUG_SECRET)
    return errorResponse('Unauthorized', 401, origin);
  const teamAbv = url.searchParams.get('team') ?? 'CHA';

  const res = await _tank01FetchWithFallback(
    `${TANK01_BASE}/getNBATeamSchedule?teamAbv=${teamAbv}`,
    env, 12000
  );

  if (!res || !res.ok) {
    return jsonResponse({ error: `Tank01 ${res?.status ?? 'no_response'}`, team: teamAbv }, 200, origin);
  }

  const json = await res.json();
  const body = json?.body ?? {};
  const schedule = body?.schedule ?? body ?? {};

  // Prendre les 3 premiers matchs terminés
  const completed = Object.values(schedule)
    .filter(g => String(g.gameStatusCode) === '2')
    .sort((a, b) => parseInt(b.gameDate) - parseInt(a.gameDate))
    .slice(0, 3);

  // Lister TOUTES les clés disponibles sur un match terminé
  const sampleKeys = completed[0] ? Object.keys(completed[0]) : [];

  // Champs pertinents pour les scores
  const scoreFields = completed.map(g => ({
    gameID:         g.gameID,
    gameDate:       g.gameDate,
    home:           g.home,
    away:           g.away,
    gameStatusCode: g.gameStatusCode,
    // Tous les champs potentiellement liés aux scores
    homePts:        g.homePts        ?? null,
    awayPts:        g.awayPts        ?? null,
    homeScore:      g.homeScore      ?? null,
    awayScore:      g.awayScore      ?? null,
    homeTeamScore:  g.homeTeamScore  ?? null,
    awayTeamScore:  g.awayTeamScore  ?? null,
    teamScore:      g.teamScore      ?? null,
    oppScore:       g.oppScore       ?? null,
    gameResult:     g.gameResult     ?? null,
    result:         g.result         ?? null,
    home_score:     g.home_score     ?? null,
    away_score:     g.away_score     ?? null,
  }));

  return jsonResponse({
    team:        teamAbv,
    total_games: Object.keys(schedule).length,
    sample_keys: sampleKeys,
    completed_sample: scoreFields,
  }, 200, origin);
}


async function handleNBATeamsStats(env, origin) {
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(TANK01_KV_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 86400000) {
          return jsonResponse({
            available:  true,
            source:     'cache',
            fetched_at: new Date(parsed.fetched_at).toISOString(),
            teams:      parsed.teams,
          }, 200, origin);
        }
      }
    } catch (err) { console.warn('Tank01 KV read error:', err.message); }
  }

  try {
    const response = await _tank01FetchWithFallback(TANK01_TEAMS_URL, env, 10000);

    if (!response || !response.ok) {
      const status = response ? response.status : 'no_response';
      return jsonResponse({ available: false, note: `Tank01 error ${status}`, teams: {} }, 200, origin);
    }

    const data  = await response.json();
    const teams = {};

    for (const team of (data.body ?? [])) {
      const ppg  = parseFloat(team.ppg)  ?? null;
      const oppg = parseFloat(team.oppg) ?? null;
      teams[team.teamAbv] = {
        teamID:            team.teamID,
        teamAbv:           team.teamAbv,
        ppg,
        oppg,
        net_rating_approx: ppg !== null && oppg !== null
          ? Math.round((ppg - oppg) * 10) / 10
          : null,
      };
    }

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(TANK01_KV_KEY,
          JSON.stringify({ fetched_at: Date.now(), teams }),
          { expirationTtl: 86400 });
      } catch (err) { console.warn('Tank01 KV write error:', err.message); }
    }

    return jsonResponse({
      available:  true,
      source:     'tank01',
      fetched_at: new Date().toISOString(),
      teams,
    }, 200, origin);

  } catch (err) {
    console.error('Tank01 fetch error:', err.message);
    return jsonResponse({ available: false, note: err.message, teams: {} }, 200, origin);
  }
}

// ── HANDLER : COTES MULTI-BOOKS ───────────────────────────────────────────────

async function handleOddsComparison(url, env, origin) {
  const key1 = env.ODDS_API_KEY_1;
  const key2 = env.ODDS_API_KEY_2;

  if (!key1 && !key2) {
    return jsonResponse({
      available:  false,
      note:       'ODDS_API_KEY not configured',
      bookmakers: [],
      fetched_at: new Date().toISOString(),
    }, 200, origin);
  }

  const now     = new Date();
  const month   = now.getUTCMonth() + 1;
  const isDST   = month >= 3 && month <= 11;
  const offsetH = isDST ? 4 : 5;
  const hourET  = (now.getUTCHours() - offsetH + 24) % 24;

  let ttl;
  if      (hourET >= 18 && hourET <= 23) ttl = 7200;
  else if (hourET >= 12 && hourET < 18)  ttl = 21600;
  else                                    ttl = 86400;

  let quota = { key1_remaining: 500, key2_remaining: 500 };

  if (env.PAPER_TRADING) {
    try {
      const raw = await env.PAPER_TRADING.get(QUOTA_KV_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored.month !== month) {
          quota = { key1_remaining: 500, key2_remaining: 500, month };
        } else {
          quota = stored;
        }
      } else {
        quota.month = month;
      }
    } catch (err) { console.warn('Quota KV read error:', err.message); }
  }

  const QUOTA_THRESHOLD = 100;
  let keysToTry = [];
  if (key1 && quota.key1_remaining > QUOTA_THRESHOLD) keysToTry.push({ key: key1, n: 1 });
  if (key2 && quota.key2_remaining > QUOTA_THRESHOLD) keysToTry.push({ key: key2, n: 2 });
  if (keysToTry.length === 0) {
    if (key1) keysToTry.push({ key: key1, n: 1 });
    if (key2) keysToTry.push({ key: key2, n: 2 });
  }

  const ODDS_API_URL = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds/' +
    '?regions=eu&markets=h2h,spreads,totals&oddsFormat=decimal&bookmakers=' +
    'unibet_eu,betsson,winamax,betclic,pinnacle,bet365';

  let data = null, usedKey = null, quotaInfo = null;

  for (const { key, n } of keysToTry) {
    try {
      const response = await fetchTimeout(
        `${ODDS_API_URL}&apiKey=${key}`,
        { headers: { 'Accept': 'application/json' } }, 10000
      );
      if (response.status === 401 || response.status === 422) {
        quota[`key${n}_remaining`] = 0;
        continue;
      }
      if (!response.ok) continue;

      const remaining = parseInt(response.headers.get('x-requests-remaining') ?? String(quota[`key${n}_remaining`]));
      const used      = parseInt(response.headers.get('x-requests-used') ?? '0');
      quota[`key${n}_remaining`] = remaining;
      quota.month = month;
      quotaInfo   = { key_used: n, remaining, used };
      data        = await response.json();
      usedKey     = n;
      break;
    } catch (err) {
      console.error(`Odds API key${n} error: ${err.message}`);
    }
  }

  if (env.PAPER_TRADING && (data !== null || quota.key1_remaining === 0 || quota.key2_remaining === 0)) {
    try {
      await env.PAPER_TRADING.put(QUOTA_KV_KEY, JSON.stringify(quota), { expirationTtl: 35 * 24 * 3600 });
    } catch (err) { console.warn('Quota KV write error:', err.message); }
  }

  if (!data) {
    return jsonResponse({
      available:  false,
      note:       'The Odds API unavailable or quota exhausted',
      quota:      { key1: quota.key1_remaining, key2: quota.key2_remaining },
      fetched_at: new Date().toISOString(),
    }, 200, origin);
  }

  return jsonResponse({
    available:   true,
    source:      'the_odds_api',
    key_used:    usedKey,
    ttl_seconds: ttl,
    quota:       quotaInfo,
    fetched_at:  new Date().toISOString(),
    matches:     _parseOddsAPIResponse(data),
  }, 200, origin, { 'Cache-Control': `max-age=${ttl}` });
}

function _parseOddsAPIResponse(data) {
  return (data ?? []).map(game => {
    const bookmakers = (game.bookmakers ?? []).map(bk => {
      const h2h     = bk.markets?.find(m => m.key === 'h2h');
      const spreads = bk.markets?.find(m => m.key === 'spreads');
      const totals  = bk.markets?.find(m => m.key === 'totals');

      const homeOutcome = h2h?.outcomes?.find(o => o.name === game.home_team);
      const awayOutcome = h2h?.outcomes?.find(o => o.name === game.away_team);
      const homeSpread  = spreads?.outcomes?.find(o => o.name === game.home_team);
      const awaySpread  = spreads?.outcomes?.find(o => o.name === game.away_team);
      const overTotal   = totals?.outcomes?.find(o => o.name === 'Over');
      const underTotal  = totals?.outcomes?.find(o => o.name === 'Under');

      return {
        key:         bk.key,
        title:       bk.title,
        home_ml:     homeOutcome?.price ?? null,
        away_ml:     awayOutcome?.price ?? null,
        home_spread: homeSpread?.price  ?? null,
        away_spread: awaySpread?.price  ?? null,
        spread_line: homeSpread?.point  ?? null,
        over_total:  overTotal?.price   ?? null,
        under_total: underTotal?.price  ?? null,
        total_line:  overTotal?.point   ?? null,
      };
    }).filter(bk => bk.home_ml !== null);

    return {
      odds_api_id:   game.id,
      home_team:     game.home_team,
      away_team:     game.away_team,
      commence_time: game.commence_time,
      bookmakers,
      best_home_ml:  bookmakers.length > 0 ? Math.max(...bookmakers.map(b => b.home_ml).filter(Boolean)) : null,
      best_away_ml:  bookmakers.length > 0 ? Math.max(...bookmakers.map(b => b.away_ml).filter(Boolean)) : null,
    };
  });
}

// ── MARCHÉ PLAYER_POINTS (Phase 3) ────────────────────────────────────────────
// Fetch ponctuel par event (TheOddsAPI) · KV cache 4h · gate env PLAYER_PROPS_ENABLED
// Coût : 1 credit par event+market+region. On utilise us uniquement (max couverture).

async function _fetchPlayerPointsForEvent(eventId, env) {
  if (!eventId) return { available: false, note: 'no_event_id', lines: {} };
  if (env.PLAYER_PROPS_ENABLED !== 'true' && env.PLAYER_PROPS_ENABLED !== '1') {
    return { available: false, note: 'disabled', lines: {} };
  }

  const cacheKey = `player_points_${eventId}`;
  const TTL_MS   = 4 * 3600 * 1000;
  const TTL_S    = 4 * 3600;

  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey, { type: 'json' });
      if (cached?._ts && (Date.now() - cached._ts) < TTL_MS) {
        return { ...cached.data, source: 'cache' };
      }
    } catch (_) {}
  }

  const key = env.ODDS_API_KEY_1 ?? env.ODDS_API_KEY_2;
  if (!key) return { available: false, note: 'no_api_key', lines: {} };

  // Pas de filtre bookmakers — laisser l'API renvoyer tous les books offrant player_points
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds` +
    `?apiKey=${key}&regions=us&markets=player_points&oddsFormat=decimal`;

  try {
    const resp = await fetchTimeout(url, { headers: { Accept: 'application/json' } }, 10000);
    if (!resp.ok) {
      let body = null;
      try { body = await resp.text(); } catch (_) {}
      return {
        available: false,
        note:      `odds_api_${resp.status}`,
        error_body: body ? body.slice(0, 500) : null,
        lines:     {},
      };
    }
    const json = await resp.json();

    // Agrégation : par joueur normalisé, meilleures cotes over/under
    const BOOK_PRIORITY = ['pinnacle', 'betmgm', 'draftkings', 'fanduel', 'betonlineag'];
    const linesByPlayer = {};

    for (const bk of (json.bookmakers ?? [])) {
      const market = bk.markets?.find(m => m.key === 'player_points');
      if (!market) continue;

      for (const o of (market.outcomes ?? [])) {
        const playerName = o.description;
        const side       = o.name; // 'Over' ou 'Under'
        const line       = parseFloat(o.point);
        const price      = parseFloat(o.price);
        if (!playerName || !side || !Number.isFinite(line) || !Number.isFinite(price)) continue;

        const norm = _normalizeName(playerName);
        if (!linesByPlayer[norm]) {
          linesByPlayer[norm] = {
            player_name: playerName,
            line,
            over: { decimal: null, book: null },
            under: { decimal: null, book: null },
          };
        }

        const slot = side === 'Over' ? 'over' : side === 'Under' ? 'under' : null;
        if (!slot) continue;

        const current     = linesByPlayer[norm][slot];
        const newBookRank = BOOK_PRIORITY.indexOf(bk.key);
        const curBookRank = current.book ? BOOK_PRIORITY.indexOf(current.book) : 999;

        // Priorité : ligne identique → prix max · sinon livre prioritaire
        if (linesByPlayer[norm].line === line) {
          if (current.decimal == null || price > current.decimal) {
            linesByPlayer[norm][slot] = { decimal: price, book: bk.key };
          }
        } else if (newBookRank < curBookRank) {
          linesByPlayer[norm].line = line;
          linesByPlayer[norm][slot] = { decimal: price, book: bk.key };
        }
      }
    }

    const result = {
      available:   true,
      event_id:    eventId,
      fetched_at:  new Date().toISOString(),
      players_count: Object.keys(linesByPlayer).length,
      lines:       linesByPlayer,
    };

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(cacheKey, JSON.stringify({ _ts: Date.now(), data: result }), { expirationTtl: TTL_S });
      } catch (_) {}
    }
    return result;
  } catch (err) {
    return { available: false, note: err.message, lines: {} };
  }
}

async function handleNBAPlayerPointsOdds(url, env, origin) {
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return jsonResponse({ available: false, note: 'event_id required' }, 400, origin);
  const result = await _fetchPlayerPointsForEvent(eventId, env);
  return jsonResponse(result, 200, origin);
}

// ── HANDLER : RÉSULTATS ───────────────────────────────────────────────────────

async function handleNBAResults(url, origin) {
  const dateParam = url.searchParams.get('date');
  const dateStr   = dateParam ? dateParam.replace(/-/g, '') : formatDateESPN(new Date());
  const data      = await espnFetch(`${ESPN_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!data) return errorResponse('ESPN fetch failed', 502, origin);

  const FINAL_STATUSES = ['STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_FINAL_PENALTY'];

  const results = (data.events ?? [])
    .filter(event => FINAL_STATUSES.includes(event.status?.type?.name))
    .map(event => {
      const competition = event.competitions?.[0] ?? {};
      const competitors = competition.competitors ?? [];
      const home        = competitors.find(c => c.homeAway === 'home');
      const away        = competitors.find(c => c.homeAway === 'away');
      const homeScore   = parseInt(home?.score ?? '0');
      const awayScore   = parseInt(away?.score ?? '0');

      return {
        espn_id:   event.id,
        date:      dateStr,
        name:      event.name,
        status:    event.status?.type?.name,
        home_team: {
          espn_id:      home?.team?.id          ?? null,
          name:         home?.team?.displayName  ?? null,
          abbreviation: home?.team?.abbreviation ?? null,
          score:        homeScore,
          won:          homeScore > awayScore,
        },
        away_team: {
          espn_id:      away?.team?.id          ?? null,
          name:         away?.team?.displayName  ?? null,
          abbreviation: away?.team?.abbreviation ?? null,
          score:        awayScore,
          won:          awayScore > homeScore,
        },
        total_points: homeScore + awayScore,
        is_final:     true,
      };
    });

  return jsonResponse({
    date:       dateStr,
    source:     'espn',
    fetched_at: new Date().toISOString(),
    total:      results.length,
    results,
  }, 200, origin);
}

// ── HANDLER : STATS ÉQUIPE ESPN ───────────────────────────────────────────────

async function handleNBATeamStats(espnTeamId, origin) {
  const data = await espnFetch(`${ESPN_SCOREBOARD}?dates=${formatDateESPN(new Date())}&limit=25`);
  if (data) {
    const teamStats = findTeamInScoreboard(data, espnTeamId);
    if (teamStats) return jsonResponse({ espn_team_id: espnTeamId, ...teamStats }, 200, origin);
  }
  return jsonResponse(emptyAdvanced(espnTeamId, 'Team not playing today'), 200, origin);
}

// ── HANDLER : FORME RÉCENTE BDL ───────────────────────────────────────────────

async function handleNBARecentForm(env, url, teamId, origin) {
  const season = url.searchParams.get('season') ?? currentSeason();
  const n      = Math.min(parseInt(url.searchParams.get('n') ?? '10'), 20);

  if (!env.BALLDONTLIE_API_KEY) {
    return jsonResponse({
      team_id: teamId, season, source: 'balldontlie_v1',
      available: false, note: 'BALLDONTLIE_API_KEY not configured', matches: [],
    }, 200, origin);
  }

  const bdlUrl = `https://api.balldontlie.io/v1/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`;
  const data   = await bdlFetchWithRetry(bdlUrl, env.BALLDONTLIE_API_KEY);

  if (!data) {
    return jsonResponse({
      team_id: teamId, season, source: 'balldontlie_v1',
      available: false, note: 'BallDontLie temporarily unavailable', matches: [],
    }, 200, origin);
  }

  const matches = (data.data ?? [])
    .filter(g => g.home_team_score > 0 || g.visitor_team_score > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, n)
    .map(game => {
      const isHome    = String(game.home_team?.id) === String(teamId);
      const teamScore = isHome ? game.home_team_score    : game.visitor_team_score;
      const oppScore  = isHome ? game.visitor_team_score : game.home_team_score;
      return {
        game_id:    game.id,
        date:       game.date,
        won:        teamScore > oppScore,
        margin:     teamScore - oppScore,
        is_home:    isHome,
        team_score: teamScore,
        opp_score:  oppScore,
      };
    });

  return jsonResponse({
    team_id:    teamId, season, source: 'balldontlie_v1',
    available:  true, fetched_at: new Date().toISOString(), matches,
  }, 200, origin, { 'Cache-Control': 'no-store' });
}

// ── HANDLER : INJURIES ESPN ───────────────────────────────────────────────────

async function handleNBAInjuriesESPN(origin) {
  const data = await espnFetch(ESPN_INJURIES);
  if (!data) {
    return jsonResponse({
      source: 'espn_injuries', available: false, note: 'ESPN injuries unavailable',
      players: [], by_team: {}, fetched_at: new Date().toISOString(),
    }, 200, origin);
  }

  const players = [];
  const byTeam  = {};
  const STATUS_WEIGHTS = {
    'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.25, 'Day-To-Day': 0.3,
  };

  for (const team of (data.injuries ?? [])) {
    const teamName = team.displayName ?? null;
    if (!teamName) continue;
    for (const inj of (team.injuries ?? [])) {
      const playerName = inj.athlete?.displayName ?? null;
      const status     = inj.status ?? null;
      const detail     = inj.shortComment ?? inj.longComment ?? null;
      if (!playerName) continue;
      const entry = {
        name: playerName, team: teamName, status, reason: detail,
        impact_weight: STATUS_WEIGHTS[status] ?? 0.2,
      };
      players.push(entry);
      if (!byTeam[teamName]) byTeam[teamName] = [];
      byTeam[teamName].push(entry);
    }
  }

  return jsonResponse({
    source: 'espn_injuries', available: true, fetched_at: new Date().toISOString(),
    total_players: players.length, players, by_team: byTeam,
  }, 200, origin);
}

// ── HANDLER : INJURIES PDF ────────────────────────────────────────────────────

async function handleNBAInjuries(url, origin) {
  const date       = url.searchParams.get('date') ?? getTodayET();
  const timestamps = buildTimestamps(date);
  let rawText = null, usedTimestamp = null;

  for (const ts of timestamps) {
    try {
      const response = await fetchTimeout(
        `${NBA_INJURY_BASE}${ts}.pdf`, { headers: { 'Accept': '*/*' } }, 8000
      );
      if (response.ok) {
        rawText       = await response.text();
        usedTimestamp = ts;
        break;
      }
    } catch { continue; }
  }

  if (!rawText) {
    return jsonResponse({
      date, source: 'nba_official_pdf', available: false,
      note: 'No injury report found.', players: [], by_team: {}, fetched_at: new Date().toISOString(),
    }, 200, origin);
  }

  const parsed = parseInjuryPDF(rawText, date);
  return jsonResponse({
    date, source: 'nba_official_pdf', available: true,
    report_timestamp: usedTimestamp, fetched_at: new Date().toISOString(),
    total_players: parsed.players.length, players: parsed.players,
    by_team: parsed.byTeam, games: parsed.games,
  }, 200, origin);
}

// ── HANDLER : STANDINGS ───────────────────────────────────────────────────────

async function handleNBAStandings(origin) {
  const data = await espnFetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/standings');
  if (!data) return errorResponse('ESPN standings failed', 502, origin);
  return jsonResponse({ source: 'espn', data }, 200, origin);
}

// ── HANDLER : IA MESSAGES ─────────────────────────────────────────────────────

// ── BOT D'ANALYSE AUTOMATIQUE ────────────────────────────────────────────────
//
// Architecture :
//   _runBotCron()        — point d'entrée cron, orchestre tout
//   _botAnalyzeMatch()   — analyse un match avec le moteur porté côté Worker
//   _botSaveLog()        — persiste le log dans KV
//   _botSendTelegram()   — notif Telegram
//   handleBotLogs()      — route GET /bot/logs
//   handleBotSettleLogs()— route POST /bot/settle-logs (enrichit avec résultats)
//   handleBotRun()       — route POST /bot/run (déclenchement manuel)
//
// Structure log KV (clé : bot_log_{matchId}) :
//   { logged_at, match_id, home, away, date, nba_phase,
//     motor_prob, confidence_level, data_quality, score_method, score_raw,
//     signals, variables_used, missing_variables,
//     star_absence_modifier, market_divergence, absences_snapshot,
//     odds_at_analysis, betting_recommendations,
//     result_home_score, result_away_score, result_winner,
//     motor_was_right, clv_post_match, settled_at }

async function _runBotCron(env, forceRun = false) {
  const nowParis = _botNowParis();
  const dateStr  = _botFormatDate(nowParis);

  console.log(`[BOT] Cron démarré — ${nowParis.toISOString()} Paris, date NBA: ${dateStr}`);

  // Charger les matchs du jour
  const espnData = await espnFetch(`${ESPN_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!espnData) {
    console.warn('[BOT] ESPN indisponible — cron annulé');
    return;
  }

  const matches = parseESPNMatches(espnData, dateStr).filter(m =>
    m.status !== 'STATUS_FINAL' && m.home_team && m.away_team
  );

  if (!matches.length) {
    console.log('[BOT] Aucun match à venir aujourd\'hui');
    return;
  }

  // Vérifier qu'on est ~1h avant le premier match
  const firstMatchTime = matches
    .map(m => m.datetime ? new Date(m.datetime).getTime() : Infinity)
    .sort((a, b) => a - b)[0];

  const msUntilFirst = firstMatchTime - Date.now();
  const isInWindow   = msUntilFirst > 0 && msUntilFirst < 2 * 3600 * 1000;

  if (!forceRun && !isInWindow) {
    console.log(`[BOT] Hors fenêtre — premier match dans ${Math.round(msUntilFirst / 60000)}min`);
    return;
  }

  // Vérifier qu'on n'a pas déjà tourné dans cette fenêtre (sauf run manuel)
  if (!forceRun && env.PAPER_TRADING) {
    try {
      const lastRun = await env.PAPER_TRADING.get(BOT_RUN_KEY);
      if (lastRun) {
        const lastRunDate = JSON.parse(lastRun);
        if (lastRunDate.date === dateStr) {
          console.log('[BOT] Déjà tourné aujourd\'hui — skip');
          return;
        }
      }
    } catch (err) { console.warn('[BOT] lastRun read error:', err.message); }
  }

  // Charger toutes les données partagées en parallèle
  // Charger toutes les données en parallèle — appels directs aux fonctions (pas HTTP interne)
  const fakeOrigin = 'https://manibetpro.emmanueldelasse.workers.dev';
  const fakeUrl    = new URL('https://manibetpro.emmanueldelasse.workers.dev/');

  const [injuryResp, oddsResp, advancedResp] = await Promise.allSettled([
    handleNBAInjuriesImpact(env, fakeOrigin),
    handleOddsComparison(fakeUrl, env, fakeOrigin),
    handleNBATeamsStats(env, fakeOrigin),
  ]);

  const injuryData   = injuryResp.status  === 'fulfilled' ? await injuryResp.value.json()  : null;
  const oddsData     = oddsResp.status    === 'fulfilled' ? await oddsResp.value.json()    : null;
  const advancedData = advancedResp.status === 'fulfilled' ? await advancedResp.value.json() : null;

  // Rosters Tank01 depuis KV cache 24h (populé par /nba/team-detail)
  // Aucun call Tank01 ajouté ici — si miss, player props skippés ce run
  let rostersData = null;
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get('nba_rosters_teams_v3', { type: 'json' });
      if (cached?.data && cached._ts && (Date.now() - cached._ts) < 24 * 3600 * 1000) {
        rostersData = cached.data;
      }
    } catch (err) { console.warn('[BOT] rosters KV read:', err.message); }
  }

  // Charger recent forms BDL pour toutes les équipes du soir en parallèle
  const season = currentSeason();
  const recentForms = {};
  const bdlTeamIds  = [];
  for (const m of matches) {
    const homeBdl = _botGetBDLId(m.home_team?.name);
    const awayBdl = _botGetBDLId(m.away_team?.name);
    if (homeBdl && !bdlTeamIds.includes(homeBdl)) bdlTeamIds.push(homeBdl);
    if (awayBdl && !bdlTeamIds.includes(awayBdl)) bdlTeamIds.push(awayBdl);
  }
  await Promise.allSettled(bdlTeamIds.map(async teamId => {
    try {
      const bdlUrl = new URL(`https://manibetpro.emmanueldelasse.workers.dev/nba/team/${teamId}/recent?season=${season}`);
      const resp   = await handleNBARecentForm(env, bdlUrl, teamId, fakeOrigin);
      if (resp) {
        const data = await resp.json();
        if (data.available) recentForms[teamId] = data;
      }
    } catch { /* skip */ }
  }));

  // Charger AI injuries batch — appel direct
  let aiInjuriesData = null;
  try {
    const aiGames = matches.map(m => ({
      home: _botGetTeamAbv(m.home_team?.name),
      away: _botGetTeamAbv(m.away_team?.name),
    })).filter(g => g.home && g.away);

    const fakeAiRequest = new Request('https://manibetpro.emmanueldelasse.workers.dev/nba/ai-injuries-batch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ date: dateStr, games: aiGames }),
    });
    const aiResp = await handleNBAAIInjuriesBatch(fakeAiRequest, env, fakeOrigin);
    if (aiResp) aiInjuriesData = await aiResp.json();
  } catch (err) { console.warn('[BOT] AI injuries batch error:', err.message); }

  // Analyser chaque match et sauvegarder
  const logs       = [];
  const edgesFound = [];

  for (const match of matches) {
    try {
      const log = await _botAnalyzeMatch(match, dateStr, injuryData, oddsData, advancedData, aiInjuriesData, recentForms, env, rostersData);
      if (!log) continue;
      await _botSaveLog(env, log);
      logs.push(log);
      if (log.best_edge && log.best_edge >= 5) edgesFound.push(log);
    } catch (err) {
      console.error(`[BOT] Erreur analyse ${match.id}:`, err.message);
    }
  }

  // Marquer le run
  if (env.PAPER_TRADING) {
    try {
      await env.PAPER_TRADING.put(BOT_RUN_KEY,
        JSON.stringify({ date: dateStr, ran_at: new Date().toISOString(), matches_analyzed: logs.length }),
        { expirationTtl: 30 * 3600 }
      );
    } catch (err) { console.warn('[BOT] lastRun write error:', err.message); }
  }

  // Telegram
  await _botSendTelegram(env, logs, edgesFound, dateStr);

  console.log(`[BOT] Terminé — ${logs.length} matchs analysés, ${edgesFound.length} edges détectés`);
}

async function _botAnalyzeMatch(match, dateStr, injuryData, oddsData, advancedData, aiInjuriesData, recentForms = {}, env = null, rostersData = null) {
  const homeName = match.home_team?.name;
  const awayName = match.away_team?.name;
  if (!homeName || !awayName) return null;

  // Récupérer injuries pour ce match
  const homeInjuries = _botGetInjuriesForTeam(injuryData, homeName);
  const awayInjuries = _botGetInjuriesForTeam(injuryData, awayName);

  // Merger avec AI injuries si disponible
  const homeAbv    = _botGetTeamAbv(homeName);
  const awayAbv    = _botGetTeamAbv(awayName);
  const gameKey    = `${awayAbv}@${homeAbv}`;
  const aiGame     = aiInjuriesData?.by_game?.[gameKey] ?? null;
  const mergedHome = _botMergeInjuries(homeInjuries, aiGame, homeName, true);
  const mergedAway = _botMergeInjuries(awayInjuries, aiGame, awayName, false);

  // Stats avancées
  const advanced = advancedData?.teams ?? {};

  // Cotes marché
  const marketOdds = _botGetMarketOdds(oddsData, homeName, awayName);

  // Recent forms BDL
  const homeBdlId   = _botGetBDLId(homeName);
  const awayBdlId   = _botGetBDLId(awayName);
  const homeRecent  = homeBdlId ? (recentForms[homeBdlId] ?? null) : null;
  const awayRecent  = awayBdlId ? (recentForms[awayBdlId] ?? null) : null;

  // Construire matchData pour le moteur
  const matchData = {
    match_id:            match.id,
    home_season_stats:   Object.assign({}, match.home_season_stats ?? {}, {
      name: homeName,
      net_rating:        advanced[homeName]?.net_rating        ?? advanced[homeAbv]?.net_rating        ?? null,
      defensive_rating:  advanced[homeName]?.defensive_rating  ?? advanced[homeAbv]?.defensive_rating  ?? null,
      pace:              advanced[homeName]?.pace               ?? advanced[homeAbv]?.pace               ?? null,
      ppg:               advanced[homeName]?.ppg                ?? advanced[homeAbv]?.ppg                ?? null,
      oppg:              advanced[homeName]?.oppg               ?? advanced[homeAbv]?.oppg               ?? null,
    }),
    away_season_stats:   Object.assign({}, match.away_season_stats ?? {}, {
      name: awayName,
      net_rating:        advanced[awayName]?.net_rating        ?? advanced[awayAbv]?.net_rating        ?? null,
      defensive_rating:  advanced[awayName]?.defensive_rating  ?? advanced[awayAbv]?.defensive_rating  ?? null,
      pace:              advanced[awayName]?.pace               ?? advanced[awayAbv]?.pace               ?? null,
      ppg:               advanced[awayName]?.ppg                ?? advanced[awayAbv]?.ppg                ?? null,
      oppg:              advanced[awayName]?.oppg               ?? advanced[awayAbv]?.oppg               ?? null,
    }),
    home_injuries:       mergedHome.length > 0 ? mergedHome : null,
    away_injuries:       mergedAway.length > 0 ? mergedAway : null,
    absences_confirmed:  homeInjuries !== null || awayInjuries !== null,
    odds:                match.odds ?? null,
    market_odds:         marketOdds,
    home_recent:         homeRecent,
    away_recent:         awayRecent,
    home_back_to_back:   false,
    away_back_to_back:   false,
    home_rest_days:      null,
    away_rest_days:      null,
    home_last5_avg_pts:  null,
    away_last5_avg_pts:  null,
    home_top10scorers:   rostersData ? _extractTop10ForTeam(rostersData, homeAbv, {}) : [],
    away_top10scorers:   rostersData ? _extractTop10ForTeam(rostersData, awayAbv, {}) : [],
  };

  // Lancer le moteur
  const analysis = _botEngineCompute(matchData);
  if (!analysis) return null;

  // Phase 3 : matching projections joueurs ↔ lignes marché TheOddsAPI
  // Gate env PLAYER_PROPS_ENABLED · fetch par event · KV cache 4h
  if (env && analysis.player_props_prediction?.available && marketOdds?.odds_api_id) {
    try {
      const ppResult = await _fetchPlayerPointsForEvent(marketOdds.odds_api_id, env);
      if (ppResult?.available && ppResult.lines) {
        const matched = _botMatchPlayerPropsToLines(
          analysis.player_props_prediction,
          ppResult.lines,
          homeName, awayName
        );
        analysis.player_props_prediction = matched.enriched;
        analysis.player_props_prediction.market_fetched_at = ppResult.fetched_at ?? null;
        analysis.player_props_prediction.market_source     = ppResult.source ?? 'the_odds_api';

        if (matched.recommendations.length > 0 && analysis.betting_recommendations) {
          analysis.betting_recommendations.recommendations.push(...matched.recommendations);
          analysis.betting_recommendations.recommendations.sort((a, b) => b.edge - a.edge);
          // Mettre à jour best uniquement si pas en critical divergence
          const curBest = analysis.betting_recommendations.best;
          const newBest = analysis.betting_recommendations.recommendations[0];
          if (newBest && (!curBest || newBest.edge > curBest.edge) &&
              analysis.market_divergence?.flag !== 'critical') {
            analysis.betting_recommendations.best = newBest;
          }
        }
      }
    } catch (err) {
      console.warn(`[BOT] player_points fetch error for ${match.id}:`, err.message);
    }
  }

  // Snapshot absences
  const absVar = analysis.variables_used?.absences_impact ?? null;
  const absencesSnapshot = absVar ? {
    value:       absVar.value   ?? null,
    quality:     absVar.quality ?? null,
    source:      absVar.source  ?? null,
    home_out:    absVar.raw?.home_out  ?? null,
    away_out:    absVar.raw?.away_out  ?? null,
    is_weighted: absVar.raw?.is_weighted ?? false,
  } : null;

  // Meilleur edge
  const recs      = analysis.betting_recommendations?.recommendations ?? [];
  const bestRec   = analysis.betting_recommendations?.best ?? null;
  const bestEdge  = bestRec?.edge ?? null;

  // Data quality
  const totalVars    = Object.keys(analysis.variables_used ?? {}).length;
  const missingCount = (analysis.missing_variables ?? []).length;
  const dataQuality  = totalVars > 0 ? Math.round((1 - missingCount / totalVars) * 100) / 100 : null;

  // Line movement snapshot (si historique dispo dans KV)
  let lineMovement = null;
  if (env?.PAPER_TRADING) {
    try {
      const raw = await env.PAPER_TRADING.get(`${ODDS_SNAP_PREFIX}${match.id}`);
      if (raw) lineMovement = _computeLineMovement(JSON.parse(raw));
    } catch { /* skip */ }
  }

  return {
    // Identité
    logged_at:   new Date().toISOString(),
    match_id:    match.id,
    home:        homeName,
    away:        awayName,
    date:        dateStr,
    datetime:    match.datetime ?? null,
    nba_phase:   analysis.nba_phase ?? null,

    // Analyse moteur complète
    motor_prob:            analysis.score !== null ? Math.round(analysis.score * 100) : null,
    score_raw:             analysis.score,
    score_method:          analysis.score_method,
    confidence_level:      _botComputeConfidence(analysis, dataQuality),
    data_quality:          dataQuality,
    missing_variables:     analysis.missing_variables ?? [],
    signals:               analysis.signals ?? [],
    variables_used:        analysis.variables_used ?? {},
    star_absence_modifier: analysis.star_absence_modifier ?? null,
    market_divergence:     analysis.market_divergence ?? null,
    confidence_penalty:    analysis.confidence_penalty ?? null,
    absences_snapshot:     absencesSnapshot,
    odds_at_analysis:      match.odds ?? null,
    line_movement:         lineMovement,
    betting_recommendations: analysis.betting_recommendations ?? null,
    best_edge:             bestEdge,
    best_market:           bestRec?.type ?? null,
    best_side:             bestRec?.side ?? null,

    // Prédiction O/U NBA — pipeline indépendant
    est_total_nba:       analysis.total_prediction?.est_total        ?? null,
    ou_line_nba:         analysis.total_prediction?.line             ?? null,
    ou_diff_nba:         analysis.total_prediction?.diff             ?? null,
    ou_prediction_side:  analysis.total_prediction?.recommendation?.side ?? null,
    ou_prediction_edge:  analysis.total_prediction?.recommendation?.edge ?? null,
    ou_adjustments:      analysis.total_prediction?.adjustments      ?? [],

    // Prédiction props joueur NBA (Phase 1) — projections pures sans marché
    player_props_prediction: analysis.player_props_prediction ?? null,

    // Post-match (rempli par handleBotSettleLogs)
    result_home_score: null,
    result_away_score: null,
    result_winner:     null,
    result_margin:     null,  // home - away (positif = home gagne)
    result_total:      null,  // total points (pour check O/U)
    motor_was_right:   null,
    prob_delta_pts:    null,  // motor_prob - 100*actual ∈ [-100, 100] — écart calibration
    upset:             null,  // true si underdog a gagné (|motor_prob-50|>5)
    ou_was_right:      null,  // null si pas de reco OU, sinon true/false
    ou_model_was_right: null, // true/false — est_total_nba vs result_total (indép. de la reco)
    spread_was_right:  null,  // null si pas de reco spread, sinon true/false
    clv_post_match:    null,
    settled_at:        null,
  };
}

async function _botSaveLog(env, log) {
  if (!env.PAPER_TRADING) return;
  try {
    const key = `${BOT_LOG_PREFIX}${log.match_id}`;
    await env.PAPER_TRADING.put(key, JSON.stringify(log), { expirationTtl: 90 * 24 * 3600 }); // 90 jours
  } catch (err) { console.warn('[BOT] saveLog error:', err.message); }
}

async function _botSendTelegram(env, logs, edgesFound, dateStr) {
  const token  = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[BOT] Telegram non configuré — skip notification');
    return;
  }

  const dateFmt = `${dateStr.slice(6,8)}/${dateStr.slice(4,6)}/${dateStr.slice(0,4)}`;
  let msg = `🏀 *Mani Bet Pro — Analyse du ${dateFmt}*\n`;
  msg += `📊 ${logs.length} matchs analysés\n`;

  if (edgesFound.length > 0) {
    msg += `\n🎯 *Edges détectés (≥5%) :*\n`;
    for (const log of edgesFound) {
      const conf  = log.confidence_level ?? '—';
      const edge  = log.best_edge ?? '—';
      const side  = log.best_side ?? '—';
      const mkt   = log.best_market ?? '—';
      const prob  = log.motor_prob ?? '—';
      msg += `• ${log.away} @ ${log.home}\n`;
      msg += `  Edge: *${edge}%* · ${mkt} ${side} · Prob: ${prob}%\n`;
      msg += `  Conf: ${conf} · Qualité: ${log.data_quality !== null ? Math.round(log.data_quality * 100) + '%' : '—'}\n`;

      // Blessures majeures
      const homeOut = log.absences_snapshot?.home_out ?? 0;
      const awayOut = log.absences_snapshot?.away_out ?? 0;
      if (homeOut > 0 || awayOut > 0) {
        msg += `  🏥 Absences: dom=${homeOut} ext=${awayOut}\n`;
      }
    }
  } else {
    msg += `\n✅ Aucun edge significatif ce soir\n`;
  }

  msg += `\n_Logs disponibles dans l'onglet Bot de l'app_`;

  try {
    await fetchTimeout(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
    }, 8000);
  } catch (err) { console.warn('[BOT] Telegram send error:', err.message); }
}

// ── HANDLERS BOT ─────────────────────────────────────────────────────────────

async function handleBotLogs(url, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const dateFilter = url.searchParams.get('date') ?? null; // YYYYMMDD optionnel
    const list       = await env.PAPER_TRADING.list({ prefix: BOT_LOG_PREFIX });
    const keys       = (list.keys ?? []).map(k => k.name);

    const logs = [];
    await Promise.all(keys.map(async key => {
      try {
        const raw = await env.PAPER_TRADING.get(key);
        if (!raw) return;
        const log = JSON.parse(raw);
        if (dateFilter && log.date !== dateFilter) return;
        logs.push(log);
      } catch { /* skip */ }
    }));

    logs.sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));

    // Stats globales de calibration
    const settled   = logs.filter(l => l.motor_was_right !== null);
    const correct   = settled.filter(l => l.motor_was_right === true);
    const hitRate   = settled.length > 0 ? Math.round(correct.length / settled.length * 1000) / 10 : null;
    const avgEdge   = logs.filter(l => l.best_edge).length > 0
      ? Math.round(logs.filter(l => l.best_edge).reduce((s, l) => s + l.best_edge, 0) / logs.filter(l => l.best_edge).length * 10) / 10
      : null;

    // Brier score sur les logs settled
    const brierValid = settled.filter(l => l.motor_prob !== null && l.result_winner !== null);
    let brierScore = null;
    if (brierValid.length > 0) {
      const sum = brierValid.reduce((s, l) => {
        const p      = l.motor_prob / 100;
        const actual = l.result_winner === 'HOME' ? 1 : 0;
        return s + Math.pow(p - actual, 2);
      }, 0);
      brierScore = Math.round(sum / brierValid.length * 10000) / 10000;
    }

    return jsonResponse({
      available: true,
      logs,
      stats: {
        total_analyzed:  logs.length,
        total_settled:   settled.length,
        hit_rate:        hitRate,
        avg_edge:        avgEdge,
        brier_score:     brierScore,
      },
    }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

async function _botSettleDate(env, dateStr) {
  const espnData = await espnFetch(`${ESPN_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!espnData) return { settled: 0, error: 'ESPN unavailable' };

  const results = parseESPNMatches(espnData, dateStr).filter(m => m.status === 'STATUS_FINAL');
  let settled = 0;

  for (const result of results) {
    const key = `${BOT_LOG_PREFIX}${result.id}`;
    try {
      const raw = await env.PAPER_TRADING.get(key);
      if (!raw) continue;
      const log = JSON.parse(raw);
      if (log.motor_was_right !== null) continue;

      const homeScore = parseInt(result.home_team?.score ?? 0);
      const awayScore = parseInt(result.away_team?.score ?? 0);
      const winner    = homeScore > awayScore ? 'HOME' : 'AWAY';
      const margin    = homeScore - awayScore;
      const totalPts  = homeScore + awayScore;

      const motorPredictedHome = (log.motor_prob ?? 50) > 50;
      const motorWasRight      = (motorPredictedHome && winner === 'HOME') ||
                                 (!motorPredictedHome && winner === 'AWAY');

      const probDelta = log.motor_prob !== null
        ? Math.round((log.motor_prob - (winner === 'HOME' ? 100 : 0)) * 10) / 10
        : null;

      const upset = log.motor_prob !== null && Math.abs(log.motor_prob - 50) > 5 && !motorWasRight;

      let spreadWasRight = null;
      let ouWasRight     = null;
      const recs = log.betting_recommendations;
      if (recs?.spread?.side && recs?.spread?.line !== undefined) {
        const line = recs.spread.line;
        const coverHome = (margin + line) > 0;
        spreadWasRight = recs.spread.side === 'HOME' ? coverHome : !coverHome;
      }
      if (recs?.total?.side && recs?.total?.line !== undefined) {
        const over = totalPts > recs.total.line;
        ouWasRight = recs.total.side === 'OVER' ? over : !over;
      }

      let clvPostMatch = null;
      if (log.motor_prob !== null && log.odds_at_analysis?.home_ml) {
        const impliedHome = 100 / (Math.abs(log.odds_at_analysis.home_ml) + 100);
        clvPostMatch = Math.round((log.motor_prob / 100 - impliedHome) * 10000) / 100;
      }

      log.result_home_score = homeScore;
      log.result_away_score = awayScore;
      log.result_winner     = winner;
      log.result_margin     = margin;
      log.result_total      = totalPts;
      log.motor_was_right   = motorWasRight;
      log.prob_delta_pts    = probDelta;
      log.upset             = upset;
      log.ou_was_right      = ouWasRight;
      log.spread_was_right  = spreadWasRight;
      log.clv_post_match    = clvPostMatch;
      // Calibration modèle O/U : est_total_nba vs résultat réel (indépendant de la reco)
      if (log.est_total_nba != null && totalPts != null) {
        const modelOver = log.est_total_nba > (log.ou_line_nba ?? log.est_total_nba);
        const actualOver = totalPts > (log.ou_line_nba ?? log.est_total_nba);
        log.ou_model_was_right = modelOver === actualOver;
      }
      log.settled_at        = new Date().toISOString();

      await env.PAPER_TRADING.put(key, JSON.stringify(log), { expirationTtl: 90 * 24 * 3600 });
      settled++;
    } catch (err) { console.warn(`[BOT] settle log ${result.id}:`, err.message); }
  }

  return { settled, date: dateStr };
}

async function handleBotSettleLogs(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const body    = await request.json().catch(() => ({}));
    const dateStr = body.date ?? formatDateESPN(new Date());
    const res     = await _botSettleDate(env, dateStr);
    if (res.error) return jsonResponse({ error: res.error }, 502, origin);
    return jsonResponse({ success: true, ...res }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

async function handleBotRun(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    await env.PAPER_TRADING.delete(BOT_RUN_KEY);
    await _runBotCron(env, true);
    // Récupérer le nombre de logs écrits pour la réponse
    const list = await env.PAPER_TRADING.list({ prefix: BOT_LOG_PREFIX });
    return jsonResponse({ success: true, note: 'Bot run terminé', logs_written: list.keys?.length ?? 0 }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ── CRON NIGHTLY AUTO-SETTLE ──────────────────────────────────────────────────
// Tourne une fois par jour à 10h UTC (12h Paris), après fin des matchs US.
// Settle J-1 et J-2 (sécurité matchs prolongés / data ESPN retardée).
// Key NIGHTLY_SETTLE_RUN_KEY évite double run dans la journée.
const NIGHTLY_SETTLE_RUN_KEY = 'bot_nightly_settle_last_run';

async function _runNightlySettle(env) {
  if (!env.PAPER_TRADING) return;
  try {
    const now = new Date();
    if (now.getUTCHours() !== 10) return; // cron horaire, on ne tourne que 1x/j

    const todayStr = formatDateESPN(now);
    const lastRun = await env.PAPER_TRADING.get(NIGHTLY_SETTLE_RUN_KEY);
    if (lastRun === todayStr) {
      console.log('[NIGHTLY SETTLE] Déjà tourné aujourd\'hui');
      return;
    }

    // Settler J-1 et J-2
    const dates = [];
    for (let d = 1; d <= 2; d++) {
      const dt = new Date(now);
      dt.setUTCDate(dt.getUTCDate() - d);
      dates.push(formatDateESPN(dt));
    }

    const results = { nba: [], mlb: [] };
    for (const ds of dates) {
      try {
        const nba = await _botSettleDate(env, ds);
        results.nba.push({ date: ds, settled: nba.settled, error: nba.error });
      } catch (err) { console.warn(`[NIGHTLY SETTLE] NBA ${ds}:`, err.message); }
      try {
        const mlb = await _mlbBotSettleDate(env, ds);
        results.mlb.push({ date: ds, settled: mlb.settled, error: mlb.error });
      } catch (err) { console.warn(`[NIGHTLY SETTLE] MLB ${ds}:`, err.message); }
    }

    await env.PAPER_TRADING.put(NIGHTLY_SETTLE_RUN_KEY, todayStr, { expirationTtl: 48 * 3600 });
    console.log('[NIGHTLY SETTLE]', JSON.stringify(results));
  } catch (err) { console.warn('[NIGHTLY SETTLE] error:', err.message); }
}

// ── LINE MOVEMENT TRACKING ────────────────────────────────────────────────────
// Snapshot horaire des cotes ESPN (NBA + MLB) pour détecter les mouvements.
// Sharp money = ligne qui bouge vite & contre l'argent public. Signal prédictif.
// Clé KV : odds_snap_{matchId} → array [{ t, home_ml, away_ml, spread, total }]
// Tronqué à 48 points (2 jours × 24 h) + TTL 72h.
const ODDS_SNAP_PREFIX  = 'odds_snap_';
const ODDS_SNAP_MAX_PTS = 48;

async function _runOddsSnapshot(env) {
  if (!env.PAPER_TRADING) return;
  try {
    const now = new Date();
    const today = formatDateESPN(now);
    const tomorrow = formatDateESPN(new Date(now.getTime() + 24 * 3600 * 1000));

    const snapshot = async (url, prefix) => {
      try {
        const data = await espnFetch(url);
        if (!data?.events) return 0;
        let count = 0;
        for (const event of data.events) {
          const comp  = event.competitions?.[0];
          const odds  = comp?.odds?.[0];
          if (!odds || event.status?.type?.name === 'STATUS_FINAL') continue;

          const homeML = odds?.moneyline?.home?.close?.odds != null ? Number(odds.moneyline.home.close.odds) : null;
          const awayML = odds?.moneyline?.away?.close?.odds != null ? Number(odds.moneyline.away.close.odds) : null;
          if (homeML === null && awayML === null && odds.spread == null) continue;

          const key  = `${prefix}${event.id}`;
          const raw  = await env.PAPER_TRADING.get(key);
          const arr  = raw ? JSON.parse(raw) : [];
          arr.push({
            t:        now.toISOString(),
            home_ml:  homeML,
            away_ml:  awayML,
            spread:   odds.spread ?? null,
            total:    odds.overUnder ?? null,
          });
          if (arr.length > ODDS_SNAP_MAX_PTS) arr.splice(0, arr.length - ODDS_SNAP_MAX_PTS);
          await env.PAPER_TRADING.put(key, JSON.stringify(arr), { expirationTtl: 72 * 3600 });
          count++;
        }
        return count;
      } catch (err) {
        console.warn('[ODDS SNAP]', err.message);
        return 0;
      }
    };

    const nba1 = await snapshot(`${ESPN_SCOREBOARD}?dates=${today}&limit=25`, ODDS_SNAP_PREFIX);
    const nba2 = await snapshot(`${ESPN_SCOREBOARD}?dates=${tomorrow}&limit=25`, ODDS_SNAP_PREFIX);
    const mlb1 = await snapshot(`${ESPN_MLB_SCOREBOARD}?dates=${today}&limit=25`, ODDS_SNAP_PREFIX);
    const mlb2 = await snapshot(`${ESPN_MLB_SCOREBOARD}?dates=${tomorrow}&limit=25`, ODDS_SNAP_PREFIX);
    console.log(`[ODDS SNAP] NBA=${nba1 + nba2} MLB=${mlb1 + mlb2}`);
  } catch (err) { console.warn('[ODDS SNAP] error:', err.message); }
}

/**
 * Récupère l'historique des cotes pour un match + calcule le mouvement agrégé.
 * GET /bot/odds-history?matchId=X
 */
async function handleOddsHistory(url, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  const matchId = url.searchParams.get('matchId');
  if (!matchId) return jsonResponse({ error: 'matchId required' }, 400, origin);
  try {
    const raw = await env.PAPER_TRADING.get(`${ODDS_SNAP_PREFIX}${matchId}`);
    if (!raw) return jsonResponse({ available: false, snapshots: [], movement: null }, 200, origin);
    const arr = JSON.parse(raw);
    return jsonResponse({
      available:  true,
      snapshots:  arr,
      movement:   _computeLineMovement(arr),
    }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

/**
 * Analyse mouvement : delta entre 1ère et dernière snapshot.
 * Retourne { home_ml_delta, spread_delta, total_delta, direction }.
 * direction: SHARP_HOME (ligne home tightens), SHARP_AWAY, NEUTRAL.
 */
function _computeLineMovement(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const first = arr[0];
  const last  = arr[arr.length - 1];

  const homeMLDelta = (first.home_ml != null && last.home_ml != null) ? last.home_ml - first.home_ml : null;
  const spreadDelta = (first.spread != null && last.spread != null) ? last.spread - first.spread : null;
  const totalDelta  = (first.total != null && last.total != null) ? last.total - first.total : null;

  let direction = 'NEUTRAL';
  // Home ML baisse (cote plus courte) = sharp sur home
  if (homeMLDelta !== null && Math.abs(homeMLDelta) >= 10) {
    direction = homeMLDelta < 0 ? 'SHARP_HOME' : 'SHARP_AWAY';
  } else if (spreadDelta !== null && Math.abs(spreadDelta) >= 1.0) {
    direction = spreadDelta < 0 ? 'SHARP_HOME' : 'SHARP_AWAY';
  }

  return {
    first_at:      first.t,
    last_at:       last.t,
    snapshots:     arr.length,
    home_ml_delta: homeMLDelta,
    spread_delta:  spreadDelta,
    total_delta:   totalDelta,
    direction,
  };
}

// ── EXPORT CSV LOGS (backtest offline) ────────────────────────────────────────
// GET /bot/logs/export.csv?sport=nba|mlb&days=N
// Colonnes : toutes les variables explicatives + outcome + deltas → feed Excel / pandas.
async function handleBotLogsExportCSV(url, env, origin) {
  if (!env.PAPER_TRADING) return new Response('KV not configured', { status: 500, headers: corsHeaders(origin) });
  try {
    const sport  = (url.searchParams.get('sport') ?? 'nba').toLowerCase();
    const days   = Math.min(parseInt(url.searchParams.get('days') ?? '90'), 90);
    const prefix = sport === 'mlb' ? MLB_BOT_LOG_PREFIX : BOT_LOG_PREFIX;

    const list = await env.PAPER_TRADING.list({ prefix });
    const keys = (list.keys ?? []).map(k => k.name);

    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const logs = [];
    await Promise.all(keys.map(async key => {
      try {
        const raw = await env.PAPER_TRADING.get(key);
        if (!raw) return;
        const log = JSON.parse(raw);
        if (log.logged_at && new Date(log.logged_at).getTime() >= cutoff) logs.push(log);
      } catch { /* skip */ }
    }));

    logs.sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at));

    const colsCommon = [
      'logged_at', 'settled_at', 'match_id', 'date', 'home', 'away',
      'motor_prob', 'confidence_level', 'data_quality', 'best_edge', 'best_market', 'best_side',
      'result_home_score', 'result_away_score', 'result_winner', 'result_margin', 'result_total',
      'motor_was_right', 'prob_delta_pts', 'upset', 'ou_was_right', 'ou_model_was_right', 'spread_was_right', 'clv_post_match',
      'est_total_nba', 'ou_line_nba', 'ou_diff_nba', 'ou_prediction_side', 'ou_prediction_edge',
    ];
    const colsNbaExtra = [
      'var_net_rating_diff', 'var_efg_diff', 'var_ts_pct', 'var_win_pct_diff',
      'var_home_away_split', 'var_recent_form_ema', 'var_absences_impact',
      'var_pace_diff', 'var_rest_days_diff', 'home_out', 'away_out',
    ];
    const colsMlbExtra = [
      'home_prob', 'away_prob', 'home_pitcher', 'away_pitcher',
      'home_pitcher_fip', 'away_pitcher_fip', 'est_total_runs',
    ];
    const cols = sport === 'mlb' ? [...colsCommon.filter(c => c !== 'motor_prob'), ...colsMlbExtra]
                                 : [...colsCommon, ...colsNbaExtra];

    const esc = v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = cols.join(',');
    const rows = logs.map(log => cols.map(col => {
      if (col.startsWith('var_')) {
        const varName = col.slice(4);
        return esc(log.variables_used?.[varName] ?? log.variables?.[varName] ?? '');
      }
      if (col === 'home_out')  return esc(log.absences_snapshot?.home_out ?? '');
      if (col === 'away_out')  return esc(log.absences_snapshot?.away_out ?? '');
      return esc(log[col]);
    }).join(','));

    const csv = [header, ...rows].join('\n');
    const filename = `manibetpro-${sport}-logs-${days}d.csv`;

    return new Response(csv, {
      status:  200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...corsHeaders(origin),
      },
    });
  } catch (err) {
    return new Response(`error: ${err.message}`, { status: 500, headers: corsHeaders(origin) });
  }
}

// ── MOTEUR NBA PORTÉ CÔTÉ WORKER ──────────────────────────────────────────────
// Même logique que engine.nba.js + sous-modules front.
// Fonctions préfixées _bot* pour éviter les collisions.

const _BOT_NBA_TEAMS = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GS', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NO', 'New York Knicks': 'NY', 'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SA',
  'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
};

function _botGetTeamAbv(espnName) { return _BOT_NBA_TEAMS[espnName] ?? null; }

// BDL IDs — identiques à NBA_TEAMS dans sports.config.js
const _BOT_BDL_IDS = {
  'Atlanta Hawks': '1', 'Boston Celtics': '2', 'Brooklyn Nets': '3',
  'Charlotte Hornets': '4', 'Chicago Bulls': '5', 'Cleveland Cavaliers': '6',
  'Dallas Mavericks': '7', 'Denver Nuggets': '8', 'Detroit Pistons': '9',
  'Golden State Warriors': '10', 'Houston Rockets': '11', 'Indiana Pacers': '12',
  'LA Clippers': '13', 'Los Angeles Lakers': '14', 'Memphis Grizzlies': '15',
  'Miami Heat': '16', 'Milwaukee Bucks': '17', 'Minnesota Timberwolves': '18',
  'New Orleans Pelicans': '19', 'New York Knicks': '20', 'Oklahoma City Thunder': '21',
  'Orlando Magic': '22', 'Philadelphia 76ers': '23', 'Phoenix Suns': '24',
  'Portland Trail Blazers': '25', 'Sacramento Kings': '26', 'San Antonio Spurs': '27',
  'Toronto Raptors': '28', 'Utah Jazz': '29', 'Washington Wizards': '30',
};

function _botGetBDLId(espnName) { return _BOT_BDL_IDS[espnName] ?? null; }

function _botComputeEMADiff(homeRecent, awayRecent, lambda = 0.85) {
  if (!homeRecent?.matches || !awayRecent?.matches)
    return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
  if (homeRecent.matches.length < 3 || awayRecent.matches.length < 3)
    return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };

  const computeEMA = (matches, lam) => {
    if (!matches?.length) return null;
    const ordered = [...matches].reverse();
    let ema = null;
    for (const match of ordered) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;
      ema = ema === null ? result : lam * result + (1 - lam) * ema;
    }
    return ema !== null ? ema * 2 - 1 : null;
  };

  const homeEMA = computeEMA(homeRecent.matches, lambda);
  const awayEMA = computeEMA(awayRecent.matches, lambda);
  if (homeEMA === null || awayEMA === null)
    return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };

  return {
    value:   Math.round((homeEMA - awayEMA) * 1000) / 1000,
    source:  'balldontlie_v1',
    quality: (homeRecent.matches.length >= 5 && awayRecent.matches.length >= 5) ? 'VERIFIED' : 'LOW_SAMPLE',
  };
}

function _botGetNBAPhase() {
  const now   = new Date();
  const m     = now.getMonth() + 1;
  const d     = now.getDate();
  if (m >= 10 || m <= 3) return 'regular';
  if (m === 4 && d < 15)  return 'regular';
  if (m === 4 && d < 22)  return 'playin';
  if (m === 4 || m === 5) return 'playoff';
  if (m === 6 && d <= 20) return 'playoff';
  return 'offseason';
}

function _botGetWeights() {
  const phase      = _botGetNBAPhase();
  const isPlayoff  = phase === 'playin' || phase === 'playoff';
  const weights    = isPlayoff ? {
    absences_impact: 0.30, recent_form_ema: 0.24, home_away_split: 0.14,
    defensive_diff: 0.12, net_rating_diff: 0.06, rest_days_diff: 0.06,
    efg_diff: 0.04, travel_load_diff: 0.02, win_pct_diff: 0.02,
    back_to_back: 0.00, b2b_cumul_diff: 0.00,
  } : {
    net_rating_diff: 0.22, efg_diff: 0.18, recent_form_ema: 0.16,
    home_away_split: 0.10, absences_impact: 0.20, defensive_diff: 0.02,
    win_pct_diff: 0.04, back_to_back: 0.02, rest_days_diff: 0.02,
    b2b_cumul_diff: 0.02, travel_load_diff: 0.02,
  };
  return {
    weights, phase,
    score_cap:   isPlayoff ? 0.80 : 0.90,
    ema_lambda:  isPlayoff ? 0.92 : 0.85,
    require_absences_confirmed: isPlayoff,
  };
}

function _botExtractVariables(data, emaLambda = 0.85) {
  const hs = data?.home_season_stats;
  const as = data?.away_season_stats;

  const _safeDiff = (a, b) => (a != null && b != null) ? a - b : null;
  const _guard    = (v, lo, hi) => (v != null && v >= lo && v <= hi) ? v : null;
  const _clamp    = (v, lo, hi) => v != null ? Math.max(lo, Math.min(hi, v)) : null;

  // eFG%
  const efgDiffRaw = _safeDiff(
    _guard(hs?.efg_pct, 0.40, 0.65),
    _guard(as?.efg_pct, 0.40, 0.65)
  );

  // Net rating (Tank01)
  const netDiffRaw = _safeDiff(hs?.net_rating, as?.net_rating);

  // Win%
  const winDiffRaw = _safeDiff(
    _guard(hs?.win_pct, 0.01, 0.99),
    _guard(as?.win_pct, 0.01, 0.99)
  );

  // Home/Away split
  let homeSplitVal = null;
  if (hs?.home_win_pct != null && hs?.away_win_pct != null &&
      as?.home_win_pct != null && as?.away_win_pct != null) {
    homeSplitVal = (hs.home_win_pct - hs.away_win_pct) - (as.away_win_pct - as.home_win_pct);
    homeSplitVal = Math.max(-0.50, Math.min(0.50, homeSplitVal));
  }

  // Defensive diff (Tank01)
  const defDiffRaw = _safeDiff(as?.defensive_rating, hs?.defensive_rating); // inversé : moins = meilleur

  // Absences impact
  const absences = _botComputeAbsencesImpact(data?.home_injuries, data?.away_injuries);

  // Back to back
  const b2bVal = data?.home_back_to_back && !data?.away_back_to_back ? -0.6
    : !data?.home_back_to_back && data?.away_back_to_back ? 0.6 : 0;

  // Rest diff
  const restDiffRaw = _safeDiff(data?.home_rest_days, data?.away_rest_days);

  // Recent form EMA (BDL)
  const recentFormEma = _botComputeEMADiff(data?.home_recent, data?.away_recent, emaLambda);

  // v6.45 — B2B cumulé & charge voyage (BDL last 5)
  const homeB2B5     = _botCountB2BInLast5(data?.home_recent);
  const awayB2B5     = _botCountB2BInLast5(data?.away_recent);
  const homeAway5    = _botCountAwayGamesInLast5(data?.home_recent);
  const awayAway5    = _botCountAwayGamesInLast5(data?.away_recent);
  const b2bCumulDiff  = (homeB2B5 !== null && awayB2B5 !== null) ? awayB2B5 - homeB2B5 : null;
  const travelDiff    = (homeAway5 !== null && awayAway5 !== null) ? awayAway5 - homeAway5 : null;

  return {
    net_rating_diff: { value: netDiffRaw,   source: 'tank01',           quality: netDiffRaw  != null ? 'OK' : 'MISSING' },
    efg_diff:        { value: efgDiffRaw,   source: 'espn_scoreboard',  quality: efgDiffRaw  != null ? 'OK' : 'MISSING' },
    recent_form_ema: recentFormEma,
    home_away_split: { value: homeSplitVal, source: 'espn_scoreboard',  quality: homeSplitVal != null ? 'OK' : 'MISSING' },
    absences_impact: absences,
    win_pct_diff:    { value: winDiffRaw,   source: 'espn_scoreboard',  quality: winDiffRaw  != null ? 'OK' : 'MISSING' },
    defensive_diff:  { value: defDiffRaw,   source: 'tank01',           quality: defDiffRaw  != null ? 'OK' : 'MISSING' },
    back_to_back:    { value: b2bVal,       source: 'espn_scoreboard',  quality: 'OK' },
    rest_days_diff:  { value: restDiffRaw,  source: 'espn_scoreboard',  quality: restDiffRaw != null ? 'OK' : 'MISSING' },
    b2b_cumul_diff:  { value: b2bCumulDiff, source: 'balldontlie_v1',   quality: b2bCumulDiff !== null ? 'OK' : 'MISSING', raw: { home_b2b_last5: homeB2B5, away_b2b_last5: awayB2B5 } },
    travel_load_diff:{ value: travelDiff,   source: 'balldontlie_v1',   quality: travelDiff   !== null ? 'OK' : 'MISSING', raw: { home_away_last5: homeAway5, away_away_last5: awayAway5 } },
  };
}

function _botCountB2BInLast5(recentForm) {
  if (!recentForm?.matches?.length) return null;
  const m = recentForm.matches.slice(0, 5).filter(x => x.date);
  if (m.length < 2) return null;
  let count = 0;
  for (let i = 0; i < m.length - 1; i++) {
    const d1 = new Date(m[i].date + 'T12:00:00');
    const d2 = new Date(m[i + 1].date + 'T12:00:00');
    if (Math.round((d1 - d2) / 86400000) === 1) count++;
  }
  return count;
}

function _botCountAwayGamesInLast5(recentForm) {
  if (!recentForm?.matches?.length) return null;
  const m = recentForm.matches.slice(0, 5).filter(x => x.is_home !== undefined);
  if (m.length === 0) return null;
  return m.filter(x => x.is_home === false).length;
}

function _botComputeAbsencesImpact(homeInj, awayInj) {
  if (!homeInj || !awayInj) return { value: null, source: 'espn_injuries', quality: 'MISSING', raw: null };

  const SW = { 'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.1, 'Available': 0.0 };

  const isWeighted = [...(homeInj ?? []), ...(awayInj ?? [])].some(p => p.source === 'tank01' || p.source === 'tank01_roster');

  const score = players => {
    if (!Array.isArray(players)) return 0;
    return players.reduce((acc, p) => {
      const isGL     = p.reason?.toLowerCase().includes('g league') || p.reason?.toLowerCase().includes('two-way');
      const glFactor = isGL ? 0.3 : 1.0;
      const impact   = (p.source === 'tank01' || p.source === 'tank01_roster') && p.impact_weight != null
        ? p.impact_weight * glFactor
        : (SW[p.status] ?? p.impact_weight ?? 0) * glFactor;
      return acc + impact;
    }, 0);
  };

  const hs          = score(homeInj);
  const as          = score(awayInj);
  const normFactor  = isWeighted ? 1.0 : 5.0;

  return {
    value:   Math.max(-1, Math.min(1, (as - hs) / normFactor)),
    source:  isWeighted ? 'espn_injuries+tank01' : 'espn_injuries',
    quality: isWeighted ? 'WEIGHTED' : 'ESTIMATED',
    raw: {
      home_score:  Math.round(hs * 1000) / 1000,
      away_score:  Math.round(as * 1000) / 1000,
      home_out:    (homeInj ?? []).filter(p => p.status === 'Out').length,
      away_out:    (awayInj ?? []).filter(p => p.status === 'Out').length,
      is_weighted: isWeighted,
    },
  };
}

function _botNormalizeVariables(variables) {
  const _clampNorm = (v, lo, hi) => {
    if (v == null) return null;
    const c = Math.max(lo, Math.min(hi, v));
    return (c - (lo + hi) / 2) / ((hi - lo) / 2);
  };
  return {
    net_rating_diff: _clampNorm(variables.net_rating_diff?.value, -10,   10),
    efg_diff:        _clampNorm(variables.efg_diff?.value,        -0.07, 0.07),
    recent_form_ema: variables.recent_form_ema?.value ?? null,
    home_away_split: variables.home_away_split?.value ?? null,
    absences_impact: variables.absences_impact?.value ?? null,
    win_pct_diff:    variables.win_pct_diff?.value    ?? null,
    defensive_diff:  _clampNorm(variables.defensive_diff?.value,  -5,    5),
    back_to_back:    variables.back_to_back?.value    ?? null,
    rest_days_diff:  _clampNorm(variables.rest_days_diff?.value,  -3,    3),
    b2b_cumul_diff:  _clampNorm(variables.b2b_cumul_diff?.value,  -3,    3),
    travel_load_diff: _clampNorm(variables.travel_load_diff?.value, -5, 5),
  };
}

function _botComputeScore(variables, weights) {
  const normalized  = _botNormalizeVariables(variables);
  const absImpact   = Math.abs(variables.absences_impact?.value ?? 0);
  const effective   = { ...weights };

  // Ajustement poids si absences majeures
  if (absImpact >= 0.18) {
    effective.net_rating_diff = Math.round((effective.net_rating_diff ?? 0) * 0.82 * 1000) / 1000;
    effective.efg_diff        = Math.round((effective.efg_diff ?? 0) * 0.85 * 1000) / 1000;
    effective.home_away_split = Math.round((effective.home_away_split ?? 0) * 0.85 * 1000) / 1000;
  }
  if (absImpact >= 0.28) {
    effective.net_rating_diff = Math.round((effective.net_rating_diff ?? 0) * 0.75 * 1000) / 1000;
    effective.efg_diff        = Math.round((effective.efg_diff ?? 0) * 0.80 * 1000) / 1000;
    effective.home_away_split = Math.round((effective.home_away_split ?? 0) * 0.80 * 1000) / 1000;
  }

  let weightedSum = 0, totalWeight = 0;
  const signals = [];

  for (const [varId, normValue] of Object.entries(normalized)) {
    if (normValue == null) continue;
    const weight = effective[varId];
    if (!weight) continue;
    const contribution = normValue * weight;
    weightedSum += contribution;
    totalWeight += weight;
    signals.push({
      variable:     varId,
      raw_value:    variables[varId]?.value ?? null,
      normalized:   normValue,
      weight,
      contribution,
      direction:    contribution >  0.001 ? 'POSITIVE' : contribution < -0.001 ? 'NEGATIVE' : 'NEUTRAL',
      data_source:  variables[varId]?.source  ?? null,
      data_quality: variables[varId]?.quality ?? null,
    });
  }

  const raw   = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 : null;
  const score = raw != null ? Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000)) : null;
  signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { score, signals, weights_used: effective };
}

function _botEngineCompute(matchData) {
  const phaseConfig  = _botGetWeights();
  const { weights, phase, score_cap, ema_lambda: emaLambda } = phaseConfig;

  const variables    = _botExtractVariables(matchData, emaLambda);
  const missing      = Object.entries(variables).filter(([, v]) => v.quality === 'MISSING').map(([k]) => k);

  const computed     = _botComputeScore(variables, weights);
  let { score }      = computed;

  // Star absence modifier
  let starAbsenceModifier = null;
  if (score !== null) {
    const isPlayoff    = phase === 'playin' || phase === 'playoff';
    const starFactor   = isPlayoff ? 2.0 : 1.55;
    const maxReduction = isPlayoff ? 0.55 : 0.45;
    const STAR_PPG     = 18;
    const FALLBACK_PPG = 110;
    const STATUS_W     = { 'Out': 1.0, 'Doubtful': 0.75, 'Day-To-Day': 0.50, 'Limited': 0.45 };

    const computeSide = (injuries, teamPpg) => {
      if (!Array.isArray(injuries)) return 0;
      let totalRed = 0, outCount = 0, majorCount = 0;
      const denom = teamPpg && teamPpg > 0 ? teamPpg : FALLBACK_PPG;
      for (const p of injuries) {
        if (!STATUS_W[p.status]) continue;
        const ppg = p.ppg ?? null;
        if (ppg == null || ppg <= STAR_PPG) continue;
        majorCount++;
        if (p.status === 'Out') outCount++;
        else if (p.status === 'Day-To-Day') outCount += 0.5;
        totalRed += (ppg / denom) * (STATUS_W[p.status] ?? 0.75) * starFactor;
      }
      let mul = 1;
      if      (outCount >= 3)   mul = 3.00;
      else if (outCount >= 2)   mul = 2.10;
      else if (outCount >= 1)   mul = 1.35;
      else if (majorCount >= 3) mul = 1.40;
      else if (majorCount >= 2) mul = 1.20;
      return Math.min(totalRed * mul, maxReduction);
    };

    const hRed = computeSide(matchData?.home_injuries, matchData?.home_season_stats?.avg_pts);
    const aRed = computeSide(matchData?.away_injuries, matchData?.away_season_stats?.avg_pts);

    if (hRed > 0 || aRed > 0) {
      starAbsenceModifier = Math.round(Math.max(0.70, Math.min(1.30, (1 - hRed) / (1 - aRed))) * 1000) / 1000;
      if (starAbsenceModifier !== 1.0) {
        score = Math.max(0, Math.min(1, Math.round(score * starAbsenceModifier * 1000) / 1000));
      }
    }
  }

  if (score !== null && score > score_cap) score = score_cap;

  // Market divergence
  const marketDivergence = _botComputeMarketDivergence(score, matchData);

  // Betting recommendations ML (Moneyline)
  let bettingRecs = null;
  if (score !== null && (matchData.odds || matchData.market_odds)) {
    bettingRecs = _botComputeBettingRecs(score, matchData, computed.signals, marketDivergence);
  }

  // Prédiction O/U — pipeline indépendant du moteur ML
  const totalPrediction = _botPredictNBATotal(matchData);
  if (totalPrediction?.recommendation && bettingRecs) {
    bettingRecs.recommendations.push(totalPrediction.recommendation);
    bettingRecs.recommendations.sort((a, b) => b.edge - a.edge);
  }

  // Prédiction props joueur (Phase 1) — projection pure, pas encore de marché
  const playerPropsPrediction = _botPredictPlayerPoints(matchData);

  return {
    score, score_method: score !== null ? 'WEIGHTED_SUM' : 'MISSING',
    signals:               computed.signals,
    variables_used:        variables,
    missing_variables:     missing,
    weights_used:          computed.weights_used,
    star_absence_modifier: starAbsenceModifier,
    market_divergence:     marketDivergence,
    confidence_penalty:    null,
    nba_phase:             phase,
    betting_recommendations: bettingRecs,
    total_prediction:      totalPrediction,
    player_props_prediction: playerPropsPrediction,
  };
}

function _botComputeMarketDivergence(score, matchData) {
  if (score == null) return null;
  const odds    = matchData?.odds ?? null;
  const mktOdds = matchData?.market_odds ?? null;
  const _amProb = n => n != null ? (n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)) : null;
  const _decProb = d => d && d > 1 ? 1 / d : null;
  const homeProb = mktOdds?.home_ml_decimal ? _decProb(mktOdds.home_ml_decimal) : _amProb(odds?.home_ml);
  const awayProb = mktOdds?.away_ml_decimal ? _decProb(mktOdds.away_ml_decimal) : _amProb(odds?.away_ml);
  if (homeProb == null || awayProb == null) return null;
  const div  = Math.round(Math.max(Math.abs(score - homeProb), Math.abs((1 - score) - awayProb)) * 100);
  const flag = div >= 28 ? 'critical' : div >= 20 ? 'high' : div >= 12 ? 'medium' : 'low';
  return { market_implied_home: Math.round(homeProb * 1000) / 1000, market_implied_away: Math.round(awayProb * 1000) / 1000, divergence_pts: div, flag };
}

function _botComputeBettingRecs(score, matchData, signals, marketDivergence) {
  const odds    = matchData?.odds ?? {};
  const mktOdds = matchData?.market_odds ?? null;
  const _decAm  = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  const _amProb = n => n != null ? (n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)) : null;

  const PRIORITY   = ['pinnacle', 'winamax', 'betclic', 'unibet_eu', 'bet365'];
  const getBook    = (side) => {
    if (!mktOdds?.bookmakers?.length) return null;
    for (const key of PRIORITY) {
      const bk    = mktOdds.bookmakers.find(b => b.key === key);
      const odDec = bk ? (side === 'HOME' ? bk.home_ml : bk.away_ml) : null;
      if (odDec && odDec > 1) return { odds: _decAm(odDec), decimalOdds: odDec, bookmaker: bk.title ?? bk.key };
    }
    return null;
  };

  const homeML = odds.home_ml ?? (mktOdds?.home_ml_decimal ? _decAm(mktOdds.home_ml_decimal) : null);
  const awayML = odds.away_ml ?? (mktOdds?.away_ml_decimal ? _decAm(mktOdds.away_ml_decimal) : null);

  const recs = [];

  if (homeML != null && awayML != null) {
    const impliedHome = _amProb(homeML);
    const impliedAway = _amProb(awayML);
    const edgeHome    = score - impliedHome;
    const side        = edgeHome > 0 ? 'HOME' : 'AWAY';
    const absEdge     = Math.abs(edgeHome);
    if (absEdge >= 0.05) {
      const bestBook  = getBook(side) ?? { odds: side === 'HOME' ? homeML : awayML, decimalOdds: null, bookmaker: 'ESPN' };
      const motorProb = side === 'HOME' ? score : 1 - score;
      const implied   = side === 'HOME' ? impliedHome : impliedAway;
      const kelly     = (() => {
        const b = bestBook.odds > 0 ? bestBook.odds / 100 : 100 / Math.abs(bestBook.odds);
        const k = (b * motorProb - (1 - motorProb)) / b;
        return k <= 0 ? 0 : Math.min(k * 0.25, 0.05);
      })();
      recs.push({
        type: 'MONEYLINE', side,
        odds_line: bestBook.odds, odds_source: bestBook.bookmaker,
        motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(implied * 100),
        edge: Math.round(absEdge * 100),
        has_value: true, kelly_stake: kelly,
      });
    }
  }

  const isCritDiv = marketDivergence?.flag === 'critical';
  return {
    recommendations: recs,
    best: isCritDiv ? null : (recs[0] ?? null),
    market_divergence_flag: marketDivergence?.flag ?? 'low',
  };
}

// ── MOTEUR O/U NBA ────────────────────────────────────────────────────────────
// Prédit le total (pts combinés) à partir des données ppg/oppg Tank01,
// de la forme récente BDL et des absences de stars.
// Entièrement indépendant du moteur ML — ne modifie aucun calcul 1X2.

function _botPredictNBATotal(matchData) {
  const hs = matchData?.home_season_stats ?? {};
  const as = matchData?.away_season_stats ?? {};

  const hPpg  = hs.ppg  != null ? parseFloat(hs.ppg)  : (hs.avg_pts ?? null);
  const hOppg = hs.oppg != null ? parseFloat(hs.oppg) : null;
  const aPpg  = as.ppg  != null ? parseFloat(as.ppg)  : (as.avg_pts ?? null);
  const aOppg = as.oppg != null ? parseFloat(as.oppg) : null;

  if (hPpg == null || hOppg == null || aPpg == null || aOppg == null) {
    return { est_total: null, line: null, recommendation: null, adjustments: [], missing: 'ppg/oppg' };
  }

  // Modèle de matchup offensif/défensif :
  // Pts attendus domicile = moy. offensive dom. vs défensive visiteur
  // Pts attendus visiteur = moy. offensive vis. vs défensive domicile
  const homeExpected = (hPpg + aOppg) / 2;
  const awayExpected = (aPpg + hOppg) / 2;
  let estTotal = homeExpected + awayExpected;
  const adjustments = [];

  // Playoffs / play-in : défense +, rythme -, arbitrage différent → -4.5 pts
  const phase = _botGetNBAPhase();
  const isPlayoff = phase === 'playin' || phase === 'playoff';
  if (isPlayoff) {
    estTotal -= 4.5;
    adjustments.push({ name: 'playoff_defense', delta: -4.5 });
  }

  // Forme récente BDL : moyenne des 5 derniers scores vs ppg saison
  const recentAdj = (recent, seasonPpg) => {
    const matches = recent?.matches;
    if (!Array.isArray(matches) || matches.length < 3) return null;
    const last5 = matches.slice(0, 5);
    const avg = last5.reduce((s, m) => s + (m.team_score ?? 0), 0) / last5.length;
    return (avg - seasonPpg) * 0.35;
  };
  const hAdj = recentAdj(matchData?.home_recent, hPpg);
  const aAdj = recentAdj(matchData?.away_recent, aPpg);
  if (hAdj != null) { estTotal += hAdj; adjustments.push({ name: 'home_recent_form', delta: Math.round(hAdj * 10) / 10 }); }
  if (aAdj != null) { estTotal += aAdj; adjustments.push({ name: 'away_recent_form', delta: Math.round(aAdj * 10) / 10 }); }

  // Absences de stars : net pts perdus (star absent → ~60% du ppg non remplacé)
  const absImpact = (injuries) => {
    if (!Array.isArray(injuries)) return 0;
    let lost = 0;
    for (const p of injuries) {
      const ppg = p.ppg ?? null;
      if (ppg == null || ppg < 12) continue;
      const w = p.status === 'Out' ? 1.0 : p.status === 'Doubtful' ? 0.6 : 0.3;
      lost += ppg * 0.60 * w;
    }
    return lost;
  };
  const hLost = absImpact(matchData?.home_injuries);
  const aLost = absImpact(matchData?.away_injuries);
  if (hLost > 0) { estTotal -= hLost; adjustments.push({ name: 'home_absences', delta: -Math.round(hLost * 10) / 10 }); }
  if (aLost > 0) { estTotal -= aLost; adjustments.push({ name: 'away_absences', delta: -Math.round(aLost * 10) / 10 }); }

  estTotal = Math.round(estTotal * 10) / 10;

  // Chercher la ligne O/U dans les bookmakers
  const PRIORITY = ['pinnacle', 'winamax', 'betclic', 'unibet_eu', 'bet365'];
  const bks = matchData?.market_odds?.bookmakers ?? [];
  let book = null;
  for (const key of PRIORITY) {
    const b = bks.find(b => b.key === key);
    if (b?.total_line && b?.over_total && b?.under_total) { book = b; break; }
  }
  if (!book) book = bks.find(b => b.total_line && b.over_total && b.under_total) ?? null;

  if (!book) return { est_total: estTotal, line: null, recommendation: null, adjustments };

  const line = parseFloat(book.total_line);
  const diff = estTotal - line;

  // Conversion diff → prob : NBA total std ~12 pts → 1 pt ≈ 4% swing, cap ±18%
  const overProb  = Math.min(0.80, Math.max(0.20, 0.50 + Math.tanh(diff / 6) * 0.18));
  const underProb = 1 - overProb;

  const _decToAm = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

  const overImplied  = book.over_total  > 1 ? 1 / book.over_total  : null;
  const underImplied = book.under_total > 1 ? 1 / book.under_total : null;
  if (!overImplied || !underImplied) return { est_total: estTotal, line, recommendation: null, adjustments };

  const overEdge  = Math.round((overProb  - overImplied)  * 100);
  const underEdge = Math.round((underProb - underImplied) * 100);
  const best = overEdge >= underEdge
    ? { side: 'OVER',  edge: overEdge,  prob: overProb,  implied: overImplied,  odds: book.over_total }
    : { side: 'UNDER', edge: underEdge, prob: underProb, implied: underImplied, odds: book.under_total };

  const recommendation = best.edge >= 5 ? {
    type:         'OVER_UNDER',
    side:         best.side,
    line,
    est_total:    estTotal,
    motor_prob:   Math.round(best.prob * 100),
    implied_prob: Math.round(best.implied * 100),
    odds_decimal: best.odds,
    odds_line:    _decToAm(best.odds),
    odds_source:  book.title ?? book.key,
    edge:         best.edge,
    has_value:    true,
  } : null;

  return {
    est_total: estTotal,
    line,
    diff: Math.round(diff * 10) / 10,
    recommendation,
    adjustments,
    all_edges: { over: overEdge, under: underEdge },
  };
}

// ── MOTEUR PROPS JOUEUR NBA (Phase 2) ────────────────────────────────────────
// Modèle pts/min : sépare volume (minutes) et efficacité (pts/min)
// · base_pts = last5_ppg ?? ppg · base_mins = last5_mpg ?? mpg
// · pts_per_min = base_pts / base_mins (capé 0.3–1.5)
// · projected_mins = base_mins + mins_boost_absence (cap 40)
// · matchup défensif = oppg adverse vs ligue ligue · absences coéquipiers → +mins
// Fallback Phase 1 (matchup × ppg) si mpg indisponible.
// Pas de comparaison marché ici (Phase 3 activera market player_points).

function _botPredictPlayerPoints(matchData) {
  const LEAGUE_AVG_OPPG = 113;
  const MIN_PPG         = 8;
  const MAX_SCORERS     = 5;
  const MATCHUP_MIN     = 0.90;
  const MATCHUP_MAX     = 1.12;
  const PPM_MIN         = 0.30;
  const PPM_MAX         = 1.50;
  const MINS_CAP        = 40;
  const MINS_BOOST_COEF = 0.18;  // part mpg d'un coéq absent redistribuée sur top scorers

  const hOppg = matchData?.home_season_stats?.oppg != null ? parseFloat(matchData.home_season_stats.oppg) : null;
  const aOppg = matchData?.away_season_stats?.oppg != null ? parseFloat(matchData.away_season_stats.oppg) : null;

  const buildSide = (scorers, opposingOppg, ownInjuries) => {
    if (!Array.isArray(scorers) || scorers.length === 0) return [];

    // Coéquipiers absents notables (ppg≥14 Out/Doubtful)
    const absentTeammates = (Array.isArray(ownInjuries) ? ownInjuries : []).filter(p => {
      const ppg = parseFloat(p?.ppg);
      if (!Number.isFinite(ppg) || ppg < 14) return false;
      return p.status === 'Out' || p.status === 'Doubtful';
    });
    const lostPpg  = absentTeammates.reduce((s, p) => s + (parseFloat(p.ppg) || 0) * (p.status === 'Out' ? 1.0 : 0.5), 0);
    const lostMpg  = absentTeammates.reduce((s, p) => s + (parseFloat(p.mpg ?? p.mins) || 28) * (p.status === 'Out' ? 1.0 : 0.5), 0);

    const matchupFactor = opposingOppg != null
      ? Math.max(MATCHUP_MIN, Math.min(MATCHUP_MAX, 1 + (opposingOppg - LEAGUE_AVG_OPPG) / (LEAGUE_AVG_OPPG * 2)))
      : 1.0;

    const topN = scorers.slice(0, MAX_SCORERS).filter(p => (p.ppg ?? 0) >= MIN_PPG);
    if (topN.length === 0) return [];

    const totalTopPpg = topN.reduce((s, p) => s + (p.ppg || 0), 0) || 1;
    const absentNames = new Set(absentTeammates.map(p => (p.name || '').toLowerCase()));

    return topN
      .filter(p => !absentNames.has((p.name || '').toLowerCase()))
      .map(p => {
        const basePts  = p.last5_ppg != null ? p.last5_ppg : p.ppg;
        const baseMins = p.last5_mpg != null ? p.last5_mpg : p.mpg;
        if (basePts == null) return null;

        const weight   = p.ppg / totalTopPpg;
        const phase    = (baseMins != null && baseMins >= 8) ? 2 : 1;

        if (phase === 2) {
          // Modèle pts/min
          const ppm         = Math.max(PPM_MIN, Math.min(PPM_MAX, basePts / baseMins));
          const minsBoost   = lostMpg > 0 ? weight * lostMpg * MINS_BOOST_COEF : 0;
          const projMins    = Math.min(MINS_CAP, baseMins + minsBoost);
          const projected   = ppm * projMins * matchupFactor;

          return {
            name:             p.name,
            team:             p.team,
            player_id:        p.playerID ?? null,
            model:            'pts_per_min',
            ppg:              p.ppg,
            last5_ppg:        p.last5_ppg,
            mpg:              p.mpg,
            last5_mpg:        p.last5_mpg,
            base_pts:         basePts,
            base_mins:        baseMins,
            pts_per_min:      Math.round(ppm * 1000) / 1000,
            mins_boost:       Math.round(minsBoost * 10) / 10,
            projected_mins:   Math.round(projMins * 10) / 10,
            matchup_factor:   Math.round(matchupFactor * 1000) / 1000,
            projected_pts:    Math.round(projected * 10) / 10,
            opposing_oppg:    opposingOppg,
            absent_teammates: absentTeammates.map(t => ({ name: t.name, status: t.status, ppg: t.ppg })),
          };
        }

        // Fallback Phase 1 si mpg manquant
        const shareBonus = lostPpg > 0 ? weight * lostPpg * 0.55 : 0;
        const projected  = basePts * matchupFactor + shareBonus;

        return {
          name:             p.name,
          team:             p.team,
          player_id:        p.playerID ?? null,
          model:            'ppg_only',
          ppg:              p.ppg,
          last5_ppg:        p.last5_ppg,
          mpg:              p.mpg ?? null,
          last5_mpg:        p.last5_mpg ?? null,
          base_pts:         basePts,
          matchup_factor:   Math.round(matchupFactor * 1000) / 1000,
          absence_bonus:    Math.round(shareBonus * 10) / 10,
          projected_pts:    Math.round(projected * 10) / 10,
          opposing_oppg:    opposingOppg,
          absent_teammates: absentTeammates.map(t => ({ name: t.name, status: t.status, ppg: t.ppg })),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.projected_pts - a.projected_pts);
  };

  const homePlayers = buildSide(matchData?.home_top10scorers, aOppg, matchData?.home_injuries);
  const awayPlayers = buildSide(matchData?.away_top10scorers, hOppg, matchData?.away_injuries);

  if (homePlayers.length === 0 && awayPlayers.length === 0) {
    return { available: false, phase: 2, missing: 'top10scorers_or_ppg' };
  }

  return {
    available:       true,
    phase:           2,
    home_players:    homePlayers,
    away_players:    awayPlayers,
    league_avg_oppg: LEAGUE_AVG_OPPG,
  };
}

// ── MATCHING PROJECTIONS ↔ LIGNES MARCHÉ (Phase 3) ───────────────────────────
// Enrichit chaque projection avec {line, over_decimal, under_decimal, edge}
// Retourne recos triées par edge (≥5%)

function _botMatchPlayerPropsToLines(propsPrediction, linesMap, homeTeam, awayTeam) {
  if (!propsPrediction?.available || !linesMap || Object.keys(linesMap).length === 0) {
    return { enriched: propsPrediction, recommendations: [] };
  }

  const _decToAm = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

  const enrichSide = (players, teamName) => {
    return players.map(p => {
      const norm = _normalizeName(p.name);
      const line = linesMap[norm];
      if (!line || !Number.isFinite(line.line)) return p;

      const diff    = p.projected_pts - line.line;
      // stdev joueur ~ 5 pts · tanh(diff/5) * 0.20 → cap ±20% swing
      const overProb  = Math.min(0.85, Math.max(0.15, 0.50 + Math.tanh(diff / 5) * 0.20));
      const underProb = 1 - overProb;

      const overImplied  = line.over?.decimal  ? 1 / line.over.decimal  : null;
      const underImplied = line.under?.decimal ? 1 / line.under.decimal : null;
      const overEdge  = overImplied  != null ? Math.round((overProb  - overImplied)  * 100) : null;
      const underEdge = underImplied != null ? Math.round((underProb - underImplied) * 100) : null;

      return {
        ...p,
        team_full:      teamName,
        market: {
          line:          line.line,
          over_decimal:  line.over?.decimal  ?? null,
          under_decimal: line.under?.decimal ?? null,
          over_book:     line.over?.book     ?? null,
          under_book:    line.under?.book    ?? null,
          diff:          Math.round(diff * 10) / 10,
          over_prob:     Math.round(overProb  * 1000) / 1000,
          under_prob:    Math.round(underProb * 1000) / 1000,
          over_edge:     overEdge,
          under_edge:    underEdge,
        },
      };
    });
  };

  const homeEnriched = enrichSide(propsPrediction.home_players ?? [], homeTeam);
  const awayEnriched = enrichSide(propsPrediction.away_players ?? [], awayTeam);

  const recommendations = [];
  for (const p of [...homeEnriched, ...awayEnriched]) {
    if (!p.market) continue;
    const { over_edge: oe, under_edge: ue, line } = p.market;
    const best = (oe ?? -99) >= (ue ?? -99)
      ? { side: 'OVER',  edge: oe, prob: p.market.over_prob,  decimal: p.market.over_decimal,  book: p.market.over_book }
      : { side: 'UNDER', edge: ue, prob: p.market.under_prob, decimal: p.market.under_decimal, book: p.market.under_book };
    if (best.edge == null || best.edge < 5 || !best.decimal) continue;

    recommendations.push({
      type:          'PLAYER_POINTS',
      player:        p.name,
      team:          p.team,
      side:          best.side,
      line,
      projected_pts: p.projected_pts,
      motor_prob:    Math.round(best.prob * 100),
      implied_prob:  Math.round((1 / best.decimal) * 100),
      odds_decimal:  best.decimal,
      odds_line:     _decToAm(best.decimal),
      odds_source:   best.book,
      edge:          best.edge,
      has_value:     true,
    });
  }

  recommendations.sort((a, b) => b.edge - a.edge);

  return {
    enriched: {
      ...propsPrediction,
      home_players: homeEnriched,
      away_players: awayEnriched,
    },
    recommendations,
  };
}

function _botComputeConfidence(analysis, dataQuality) {
  if (!analysis.score) return 'INCONCLUSIVE';
  const score = analysis.score;
  const dist  = Math.abs(score - 0.5);
  const pen   = analysis.confidence_penalty?.score ?? 0;
  if (dist >= 0.20 && dataQuality >= 0.7 && pen < 0.08) return 'HIGH';
  if (dist >= 0.12 && dataQuality >= 0.5 && pen < 0.15) return 'MEDIUM';
  if (dist >= 0.06) return 'LOW';
  return 'INCONCLUSIVE';
}

function _botGetInjuriesForTeam(injuryData, teamName) {
  if (!injuryData?.by_team) return null;
  const players = injuryData.by_team[teamName]?.players_weighted ?? null;
  if (!players) return null;
  return players.map(p => ({
    name:          p.name,
    status:        p.status,
    ppg:           p.ppg ?? null,
    impact_weight: p.player_impact ?? null,
    source:        p.source ?? 'tank01_roster',
  }));
}

function _botMergeInjuries(baseList, aiGame, teamName, isHome) {
  const base    = baseList ?? [];
  const aiList  = isHome
    ? (aiGame?.players_out ?? []).filter(p => p.team === _botGetTeamAbv(teamName))
      .concat((aiGame?.players_doubtful ?? []).filter(p => p.team === _botGetTeamAbv(teamName)))
    : (aiGame?.players_out ?? []).filter(p => p.team !== _botGetTeamAbv(teamName))
      .concat((aiGame?.players_doubtful ?? []).filter(p => p.team !== _botGetTeamAbv(teamName)));

  const merged = [...base];
  for (const aiP of aiList) {
    if (!aiP.name) continue;
    const exists = merged.some(p => _normalizeName(p.name) === _normalizeName(aiP.name));
    if (!exists) merged.push({ name: aiP.name, status: aiP.status ?? 'Out', ppg: aiP.ppg ?? null, impact_weight: null, source: 'claude_ai' });
  }
  return merged;
}

function _botGetMarketOdds(oddsData, homeName, awayName) {
  if (!oddsData?.matches?.length) return null;
  return oddsData.matches.find(m =>
    (m.home_team === homeName && m.away_team === awayName) ||
    (m.home_team === awayName && m.away_team === homeName)
  ) ?? null;
}

function _botNowParis() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function _botFormatDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── PAPER TRADING ─────────────────────────────────────────────────────────────

async function handlePaperGet(env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const raw   = await env.PAPER_TRADING.get(PAPER_KV_KEY);
    const state = raw ? JSON.parse(raw) : _defaultPaperState();
    return jsonResponse(state, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

async function handlePaperPlaceBet(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const bet   = await request.json();

    // CORRECTION v6.32 : validation des champs critiques avant insertion.
    // Sans ces guards, un bet malformé (stake:undefined, odds_taken:0) corrompt
    // silencieusement current_bankroll en NaN et casse tous les calculs downstream.
    const stake = Number(bet.stake);
    const odds  = Number(bet.odds_taken);
    const VALID_MARKETS = ['MONEYLINE', 'SPREAD', 'OVER_UNDER', 'PLAYER_POINTS'];

    if (!isFinite(stake) || stake <= 0)
      return jsonResponse({ error: 'stake invalide — doit être un nombre > 0' }, 400, origin);
    if (!isFinite(odds) || odds === 0)
      return jsonResponse({ error: 'odds_taken invalide — doit être un nombre américain ≠ 0' }, 400, origin);
    if (!VALID_MARKETS.includes(bet.market))
      return jsonResponse({ error: `market invalide — valeurs acceptées : ${VALID_MARKETS.join(', ')}` }, 400, origin);

    // Normaliser les valeurs numériques
    bet.stake      = Math.round(stake * 100) / 100;
    bet.odds_taken = odds;

    const raw   = await env.PAPER_TRADING.get(PAPER_KV_KEY);
    const state = raw ? JSON.parse(raw) : _defaultPaperState();

    bet.bet_id    = crypto.randomUUID();
    bet.placed_at = new Date().toISOString();
    bet.result    = 'PENDING';
    bet.pnl       = null;
    bet.clv       = null;

    state.bets.push(bet);
    state.current_bankroll -= bet.stake;
    state.total_staked     += bet.stake;

    await env.PAPER_TRADING.put(PAPER_KV_KEY, JSON.stringify(state));

    // Mettre à jour l'index léger
    try {
      const rawIndex = await env.PAPER_TRADING.get(PAPER_BETS_INDEX_KEY);
      const index = rawIndex ? JSON.parse(rawIndex) : {};
      index[bet.bet_id] = { date: bet.date ?? null, result: 'PENDING', placed_at: bet.placed_at };
      await env.PAPER_TRADING.put(PAPER_BETS_INDEX_KEY, JSON.stringify(index));
    } catch (err) { console.warn('PlaceBet index write error:', err.message); }

    return jsonResponse({ success: true, bet_id: bet.bet_id, state }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

async function handlePaperSettleBet(request, betId, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const body  = await request.json();
    const raw   = await env.PAPER_TRADING.get(PAPER_KV_KEY);
    const state = raw ? JSON.parse(raw) : _defaultPaperState();

    const bet = state.bets.find(b => b.bet_id === betId);
    if (!bet) return jsonResponse({ error: 'Bet not found' }, 404, origin);

    const force  = body.force === true;
    const oldPnl = bet.pnl ?? 0;
    if (bet.result !== 'PENDING' && !force) {
      return jsonResponse({ error: 'Bet already settled — use force:true to override' }, 404, origin);
    }
    if (force && bet.result !== 'PENDING') {
      state.current_bankroll -= (bet.stake + oldPnl);
      state.total_pnl         = Math.round((state.total_pnl - oldPnl) * 100) / 100;
    }

    bet.result       = body.result;
    bet.settled_at   = new Date().toISOString();
    const closingOdds = body.closing_odds ?? null;
    bet.closing_odds  = closingOdds;
    if (body.home_score != null) bet.home_score = body.home_score;
    if (body.away_score != null) bet.away_score = body.away_score;

    if (bet.result === 'WIN') {
      const decOdds = bet.odds_taken > 0
        ? bet.odds_taken / 100 + 1
        : 100 / Math.abs(bet.odds_taken) + 1;
      bet.pnl = Math.round((bet.stake * decOdds - bet.stake) * 100) / 100;
    } else if (bet.result === 'LOSS') {
      bet.pnl = -bet.stake;
    } else {
      bet.pnl = 0;
    }

    if (closingOdds !== null && bet.motor_prob !== null) {
      const decClosing     = closingOdds > 0 ? closingOdds / 100 + 1 : 100 / Math.abs(closingOdds) + 1;
      const impliedClosing = 1 / decClosing;
      bet.clv = Math.round((bet.motor_prob / 100 - impliedClosing) * 10000) / 100;
    }

    state.current_bankroll += bet.stake + bet.pnl;
    state.total_pnl         = Math.round((state.total_pnl + bet.pnl) * 100) / 100;

    await env.PAPER_TRADING.put(PAPER_KV_KEY, JSON.stringify(state));

    // Mettre à jour l'index léger
    try {
      const rawIndex = await env.PAPER_TRADING.get(PAPER_BETS_INDEX_KEY);
      const index = rawIndex ? JSON.parse(rawIndex) : {};
      if (index[betId]) index[betId].result = bet.result;
      await env.PAPER_TRADING.put(PAPER_BETS_INDEX_KEY, JSON.stringify(index));
    } catch (err) { console.warn('SettleBet index write error:', err.message); }

    return jsonResponse({ success: true, bet, state }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

async function handlePaperReset(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const body     = await request.json().catch(() => ({}));
    const bankroll = body.initial_bankroll ?? 1000;
    const state    = _defaultPaperState(bankroll);
    await env.PAPER_TRADING.put(PAPER_KV_KEY, JSON.stringify(state));
    // Réinitialiser l'index au reset
    try {
      await env.PAPER_TRADING.put(PAPER_BETS_INDEX_KEY, JSON.stringify({}));
    } catch (err) { console.warn('Reset index write error:', err.message); }
    return jsonResponse({ success: true, state }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

function _defaultPaperState(initialBankroll = 1000) {
  return {
    initial_bankroll: initialBankroll,
    current_bankroll: initialBankroll,
    total_staked:     0,
    total_pnl:        0,
    bets:             [],
    created_at:       new Date().toISOString(),
    mode:             'PAPER',
  };
}

// ── BDL FETCH AVEC RETRY ──────────────────────────────────────────────────────

async function bdlFetchWithRetry(url, apiKey, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const response = await fetchTimeout(url, {
        headers: { 'Authorization': apiKey, 'Accept': 'application/json' },
      }, 10000);
      if (response.status === 429) { if (attempt === maxRetries - 1) return null; continue; }
      if (!response.ok) return null;
      return await response.json();
    } catch { if (attempt === maxRetries - 1) return null; }
  }
  return null;
}

// ── PARSERS ESPN ──────────────────────────────────────────────────────────────

function parseESPNMatches(data, dateStr) {
  return (data.events ?? []).map(event => {
    const competition = event.competitions?.[0] ?? {};
    const competitors = competition.competitors ?? [];
    const home        = competitors.find(c => c.homeAway === 'home');
    const away        = competitors.find(c => c.homeAway === 'away');
    const odds        = competition.odds?.[0] ?? null;

    const homeML = odds?.moneyline?.home?.close?.odds != null ? Number(odds.moneyline.home.close.odds) : null;
    const awayML = odds?.moneyline?.away?.close?.odds != null ? Number(odds.moneyline.away.close.odds) : null;

    if (odds !== null && homeML === null && awayML === null) {
      console.warn(`[ESPN] moneyline null pour ${event.name}`);
    }

    return {
      id:            event.id,
      espn_id:       event.id,
      date:          dateStr,
      datetime:      event.date,
      name:          event.name,
      status:        event.status?.type?.name   ?? null,
      status_detail: event.status?.type?.detail ?? null,
      home_team:     parseESPNTeam(home),
      away_team:     parseESPNTeam(away),
      home_season_stats: parseESPNTeamStats(home),
      away_season_stats: parseESPNTeamStats(away),
      odds: odds ? {
        source:        'DraftKings via ESPN',
        spread:        odds.spread     ?? null,
        over_under:    odds.overUnder  ?? null,
        home_ml:       homeML,
        away_ml:       awayML,
        home_favorite: odds.homeTeamOdds?.favorite ?? null,
        away_favorite: odds.awayTeamOdds?.favorite ?? null,
        fetched_at:    new Date().toISOString(),
      } : null,
      venue:      competition.venue?.fullName ?? null,
      source:     'espn',
      fetched_at: new Date().toISOString(),
    };
  });
}

function parseESPNTeam(competitor) {
  if (!competitor) return null;
  const team    = competitor.team ?? {};
  const records = competitor.records ?? [];
  return {
    espn_id:      team.id,
    name:         team.displayName,
    abbreviation: team.abbreviation,
    score:        competitor.score ?? null,
    record:       records.find(r => r.type === 'total')?.summary ?? null,
    home_record:  records.find(r => r.type === 'home')?.summary  ?? null,
    away_record:  records.find(r => r.type === 'road')?.summary  ?? null,
    logo:         team.logo ?? null,
  };
}

function parseESPNTeamStats(competitor) {
  if (!competitor) return null;

  const stats   = competitor.statistics ?? [];
  const records = competitor.records    ?? [];

  const getStat = (name) => {
    const s = stats.find(s => s.name === name);
    return s ? parseFloat(s.displayValue) : null;
  };

  const fgm    = getStat('fieldGoalsMade');
  const fga    = getStat('fieldGoalsAttempted');
  const fg3m   = getStat('threePointFieldGoalsMade');
  const fg3a   = getStat('threePointFieldGoalsAttempted');
  const ftm    = getStat('freeThrowsMade');
  const fta    = getStat('freeThrowsAttempted');
  const pts    = getStat('points');
  const avgPts = getStat('avgPoints');
  const reb    = getStat('rebounds');
  const ast    = getStat('assists');

  const parseRecord = (summary) => {
    if (!summary) return { wins: null, losses: null, pct: null };
    const [w, l] = summary.split('-').map(Number);
    const total  = w + l;
    return { wins: w, losses: l, pct: total > 0 ? Math.round(w / total * 1000) / 1000 : null };
  };

  const rec   = parseRecord(records.find(r => r.type === 'total')?.summary);
  const homeR = parseRecord(records.find(r => r.type === 'home')?.summary);
  const roadR = parseRecord(records.find(r => r.type === 'road')?.summary);
  const games_played = rec.wins !== null && rec.losses !== null ? rec.wins + rec.losses : null;
  const efg_pct = fga > 0 ? Math.round(((fgm + 0.5 * fg3m) / fga) * 1000) / 1000 : null;
  const ts_denom = fga !== null && fta !== null ? 2 * (fga + 0.44 * fta) : null;
  const ts_pct   = ts_denom > 0 && pts ? Math.round((pts / ts_denom) * 1000) / 1000 : null;

  return {
    source: 'espn_scoreboard', fetched_at: new Date().toISOString(), available: true,
    games_played, wins: rec.wins, losses: rec.losses, win_pct: rec.pct,
    home_wins: homeR.wins, home_losses: homeR.losses, home_win_pct: homeR.pct,
    away_wins: roadR.wins, away_losses: roadR.losses, away_win_pct: roadR.pct,
    fgm, fga, fg_pct:  fga  > 0 ? Math.round(fgm  / fga  * 1000) / 1000 : null,
    fg3m, fg3a, fg3_pct: fg3a > 0 ? Math.round(fg3m / fg3a * 1000) / 1000 : null,
    ftm, fta, ft_pct:  fta  > 0 ? Math.round(ftm  / fta  * 1000) / 1000 : null,
    efg_pct, ts_pct, pts_total: pts, avg_pts: avgPts,
    avg_reb: reb !== null && games_played > 0 ? Math.round(reb / games_played * 10) / 10 : null,
    avg_ast: ast !== null && games_played > 0 ? Math.round(ast / games_played * 10) / 10 : null,
    net_rating: null, offensive_rating: null, defensive_rating: null, pace: null, tov_pct: null, orb_pct: null,
  };
}

function findTeamInScoreboard(data, espnTeamId) {
  for (const event of (data.events ?? [])) {
    const competitor = event.competitions?.[0]?.competitors
      ?.find(c => c.team?.id === String(espnTeamId));
    if (competitor) return parseESPNTeamStats(competitor);
  }
  return null;
}

function emptyAdvanced(teamId, reason = '') {
  return {
    espn_team_id: teamId, source: 'espn', fetched_at: new Date().toISOString(),
    available: false, note: reason, games_played: null, wins: null, losses: null,
    win_pct: null, efg_pct: null, ts_pct: null, net_rating: null, avg_pts: null,
  };
}

// ── PARSER PDF INJURIES ───────────────────────────────────────────────────────

function parseInjuryPDF(text, date) {
  const players = [], byTeam = {}, games = {};
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentGame = null, currentTeam = null, currentGameDate = null,
      currentGameTime = null, currentMatchup = null;

  const STATUSES      = ['Out', 'Questionable', 'Doubtful', 'Probable', 'Available', 'NOT YET SUBMITTED'];
  const STATUS_WEIGHTS = { 'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.25, 'Available': 0.0 };

  for (const line of lines) {
    if (line.startsWith('Injury Report:') || line.startsWith('Page ') || line.startsWith('Game Date')) continue;

    const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*\(ET\)\s+([A-Z]+@[A-Z]+)\s+(.*)/);
    if (dateMatch) {
      currentGameDate = dateMatch[1]; currentGameTime = dateMatch[2];
      currentMatchup  = dateMatch[3]; currentGame = `${currentGameDate}_${currentMatchup}`;
      if (!games[currentGame]) games[currentGame] = { date: currentGameDate, time: currentGameTime, matchup: currentMatchup, teams: {} };
      const teamOnLine = dateMatch[4].trim();
      if (teamOnLine && !STATUSES.some(s => teamOnLine.includes(s)) && teamOnLine !== 'NOT YET SUBMITTED') {
        currentTeam = teamOnLine;
        if (!byTeam[currentTeam]) byTeam[currentTeam] = [];
        if (!games[currentGame].teams[currentTeam]) games[currentGame].teams[currentTeam] = [];
      }
      continue;
    }

    const matchupOnly = line.match(/^(\d{2}:\d{2})\s*\(ET\)\s+([A-Z]+@[A-Z]+)\s*(.*)/);
    if (matchupOnly) {
      currentGameTime = matchupOnly[1]; currentMatchup = matchupOnly[2];
      currentGame = `${currentGameDate}_${currentMatchup}`;
      if (!games[currentGame]) games[currentGame] = { date: currentGameDate, time: currentGameTime, matchup: currentMatchup, teams: {} };
      const teamOnLine = matchupOnly[3].trim();
      if (teamOnLine && !STATUSES.some(s => teamOnLine.includes(s))) {
        currentTeam = teamOnLine;
        if (!byTeam[currentTeam]) byTeam[currentTeam] = [];
        if (!games[currentGame].teams[currentTeam]) games[currentGame].teams[currentTeam] = [];
      }
      continue;
    }

    if (line === 'NOT YET SUBMITTED') {
      if (currentGame && currentTeam && games[currentGame]) games[currentGame].teams[currentTeam] = 'NOT_YET_SUBMITTED';
      continue;
    }

    const isTeamName = (!line.includes(',') && !STATUSES.some(s => line.startsWith(s)) &&
      line.length > 5 && line.length < 40 && /^[A-Z]/.test(line) && !line.match(/^\d/));
    if (isTeamName && currentGame) {
      currentTeam = line;
      if (!byTeam[currentTeam]) byTeam[currentTeam] = [];
      if (games[currentGame] && !games[currentGame].teams[currentTeam]) games[currentGame].teams[currentTeam] = [];
      continue;
    }

    const playerMatch = line.match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]*)*),\s+([A-Za-z'\s.-]+?)\s+(Out|Questionable|Doubtful|Probable|Available)\s*(.*)/);
    if (playerMatch && currentTeam) {
      const entry = {
        name:       `${playerMatch[2].trim()} ${playerMatch[1].trim()}`,
        last_name:  playerMatch[1].trim(), first_name: playerMatch[2].trim(),
        team:       currentTeam, status: playerMatch[3].trim(),
        reason:     playerMatch[4].trim() || null,
        impact_weight: STATUS_WEIGHTS[playerMatch[3].trim()] ?? 0,
        matchup: currentMatchup ?? null, game_date: currentGameDate ?? null,
      };
      players.push(entry);
      byTeam[currentTeam].push(entry);
      if (currentGame && games[currentGame] && Array.isArray(games[currentGame].teams[currentTeam])) {
        games[currentGame].teams[currentTeam].push(entry);
      }
    }
  }

  return { players, byTeam, games };
}

function buildTimestamps(date) {
  const now    = new Date();
  const hourET = (now.getUTCHours() - 5 + 24) % 24;
  const hours  = [];
  for (let h = Math.min(hourET, 11); h >= 1; h--) {
    const hh = String(h).padStart(2, '0');
    hours.push(`${date}_${hh}_00PM`, `${date}_${hh}_30PM`, `${date}_${hh}_15PM`, `${date}_${hh}_45PM`);
  }
  hours.push(`${date}_12_00PM`);
  for (let h = 11; h >= 1; h--) {
    const hh = String(h).padStart(2, '0');
    hours.push(`${date}_${hh}_00AM`, `${date}_${hh}_30AM`);
  }
  hours.push(`${date}_12_00AM`);
  return hours;
}

// ── TENNIS ────────────────────────────────────────────────────────────────────

async function handleTennisCSVTest(url, env, origin) {
  const results = {};
  const urls = {
    csv_2026: 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2026.csv',
    csv_2025: 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2025.csv',
  };
  for (const [key, csvUrl] of Object.entries(urls)) {
    try {
      const resp = await fetchTimeout(csvUrl, {}, 10000);
      const text = resp.ok ? (await resp.text()).slice(0, 500) : null;
      results[key] = {
        status: resp.status, ok: resp.ok,
        preview: text ? text.split('\n').slice(0, 3).join(' | ') : null,
        error: resp.ok ? null : `HTTP ${resp.status}`,
      };
    } catch (err) { results[key] = { ok: false, error: err.message }; }
  }
  return jsonResponse({ results }, 200, origin);
}

async function handleTennisSportsList(url, env, origin) {
  const oddsKey = env.ODDS_API_KEY_1 ?? env.ODDS_API_KEY_2;
  if (!oddsKey) return jsonResponse({ error: 'ODDS_API_KEY not configured' }, 200, origin);
  try {
    const resp = await fetchTimeout(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${oddsKey}&all=true`,
      { headers: { Accept: 'application/json' } }, 10000
    );
    if (!resp.ok) return jsonResponse({ error: `Odds API ${resp.status}` }, 200, origin);
    const data   = await resp.json();
    const tennis = (Array.isArray(data) ? data : [])
      .filter(s => s.key && s.key.includes('tennis'))
      .map(s => ({ key: s.key, title: s.title, active: s.active }));
    return jsonResponse({ available: true, tennis_sports: tennis }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 200, origin); }
}

async function handleTennisOdds(url, env, origin) {
  const tournamentParam = url.searchParams.get('tournament') ?? 'monte_carlo';
  const TOURNAMENT_KEYS = {
    monte_carlo: 'tennis_atp_monte_carlo_masters', madrid: 'tennis_atp_madrid_open',
    rome: 'tennis_atp_italian_open', french_open: 'tennis_atp_french_open',
    wimbledon: 'tennis_atp_wimbledon', us_open: 'tennis_atp_us_open',
  };
  const sportKey = TOURNAMENT_KEYS[tournamentParam];
  if (!sportKey) return jsonResponse({ available: false, note: `Tournoi inconnu: ${tournamentParam}` }, 200, origin);

  const cacheKey = `${TENNIS_ODDS_KEY}_${tournamentParam}`;
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 3 * 3600 * 1000) {
          return jsonResponse({ available: true, source: 'cache', tournament: tournamentParam,
            matches: parsed.matches, fetched_at: new Date(parsed.fetched_at).toISOString() }, 200, origin);
        }
      }
    } catch (err) { console.warn('Tennis odds cache read:', err.message); }
  }

  const oddsKey = env.ODDS_API_KEY_1 ?? env.ODDS_API_KEY_2;
  if (!oddsKey) return jsonResponse({ available: false, note: 'ODDS_API_KEY not configured' }, 200, origin);

  try {
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${oddsKey}&regions=eu&markets=h2h&oddsFormat=decimal`;
    const resp    = await fetchTimeout(oddsUrl, { headers: { Accept: 'application/json' } }, 12000);
    if (!resp.ok) return jsonResponse({ available: false, note: `Odds API error ${resp.status}` }, 200, origin);
    const data    = await resp.json();
    const matches = (Array.isArray(data) ? data : []).map(event => {
      let bestP1 = null, bestP2 = null, bestBook = null;
      for (const bk of (event.bookmakers ?? [])) {
        const h2h = bk.markets?.find(m => m.key === 'h2h');
        if (!h2h) continue;
        const o1 = h2h.outcomes?.find(o => o.name === event.home_team)?.price;
        const o2 = h2h.outcomes?.find(o => o.name === event.away_team)?.price;
        if (!o1 || !o2) continue;
        if (!bestP1 || o1 > bestP1) { bestP1 = o1; bestP2 = o2; bestBook = bk.title; }
      }
      return {
        id: event.id, home_player: event.home_team, away_player: event.away_team,
        commence_time: event.commence_time, tournament: tournamentParam, sport_key: sportKey,
        surface: 'Clay', sport: 'TENNIS',
        odds: bestP1 ? { h2h: { p1: bestP1, p2: bestP2 }, source: bestBook } : null,
      };
    });
    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(cacheKey, JSON.stringify({ fetched_at: Date.now(), matches }),
          { expirationTtl: 3 * 3600 });
      } catch (err) { console.warn('Tennis odds cache write:', err.message); }
    }
    return jsonResponse({ available: true, source: 'the_odds_api', tournament: tournamentParam,
      matches, fetched_at: new Date().toISOString() }, 200, origin);
  } catch (err) { return jsonResponse({ available: false, note: err.message }, 200, origin); }
}

async function handleTennisStats(url, env, origin) {
  const playersParam = url.searchParams.get('players') ?? '';
  const surface      = url.searchParams.get('surface') ?? 'Clay';
  const players      = playersParam.split(',').map(p => p.trim()).filter(Boolean);
  if (!players.length) return jsonResponse({ available: false, note: 'players parameter required' }, 400, origin);

  const cacheKey = `${TENNIS_CSV_KEY}_${surface}_${[...players].sort().join('_')}`.slice(0, 512);
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 12 * 3600 * 1000) {
          return jsonResponse({ available: true, source: 'cache',
            stats: parsed.stats, fetched_at: new Date(parsed.fetched_at).toISOString() }, 200, origin);
        }
      }
    } catch (err) { console.warn('Tennis CSV cache read:', err.message); }
  }

  try {
    const CSV_2026 = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2026.csv';
    const CSV_2025 = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2025.csv';
    const [r2026, r2025] = await Promise.allSettled([
      fetchTimeout(CSV_2026, {}, 15000),
      fetchTimeout(CSV_2025, {}, 15000),
    ]);
    let allRows = [];
    if (r2026.status === 'fulfilled' && r2026.value.ok) allRows = allRows.concat(_parseTennisCSV(await r2026.value.text()));
    if (r2025.status === 'fulfilled' && r2025.value.ok) {
      const rows2025 = _parseTennisCSV(await r2025.value.text()).filter(r => parseInt(r.tourney_date || '0') >= 20250601);
      allRows = allRows.concat(rows2025);
    }
    if (!allRows.length) return jsonResponse({ available: false, note: 'CSV Sackmann indisponible' }, 200, origin);

    const today = new Date();
    const stats = {};
    for (const pName of players) stats[pName] = _computeTennisPlayerStats(allRows, pName, surface, today);
    if (players.length === 2 && stats[players[0]] && stats[players[1]]) {
      const h2h = _computeTennisH2H(allRows, players[0], players[1], surface);
      stats[players[0]].h2h = { [players[1]]: { p1_wins: h2h.p1_wins, p2_wins: h2h.p2_wins } };
      stats[players[1]].h2h = { [players[0]]: { p1_wins: h2h.p2_wins, p2_wins: h2h.p1_wins } };
    }
    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(cacheKey, JSON.stringify({ fetched_at: Date.now(), stats }),
          { expirationTtl: 12 * 3600 });
      } catch (err) { console.warn('Tennis CSV cache write:', err.message); }
    }
    return jsonResponse({ available: true, source: 'sackmann_csv_github', surface, players, stats,
      fetched_at: new Date().toISOString(), rows_analyzed: allRows.length }, 200, origin);
  } catch (err) { return jsonResponse({ available: false, note: err.message }, 200, origin); }
}

function _parseTennisCSV(text) {
  const lines   = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row  = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim().replace(/"/g, ''); });
    return row;
  }).filter(r => r.winner_name || r.loser_name);
}

function _computeTennisPlayerStats(rows, playerName, surface, today) {
  const matches = rows.filter(r => r.winner_name === playerName || r.loser_name === playerName)
    .sort((a, b) => parseInt(b.tourney_date || '0') - parseInt(a.tourney_date || '0'));
  if (!matches.length) return null;

  const lastM    = matches[0];
  const isWinner = lastM.winner_name === playerName;
  const rank     = parseInt(isWinner ? lastM.winner_rank : lastM.loser_rank) || null;
  const cutoff   = new Date(today); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, '');

  const surfM    = rows.filter(r =>
    (r.winner_name === playerName || r.loser_name === playerName) &&
    r.surface === surface && (r.tourney_date || '0') >= cutoffStr
  );
  const surfWins = surfM.filter(r => r.winner_name === playerName).length;

  let ema = 0.5;
  const last10 = matches.slice(0, 10);
  for (let i = last10.length - 1; i >= 0; i--) {
    ema = 0.3 * (last10[i].winner_name === playerName ? 1 : 0) + 0.7 * ema;
  }

  const svcRows  = matches.filter(r => r.winner_name === playerName).slice(0, 20);
  const svcStats = svcRows.length > 0 ? {
    aces:            svcRows.reduce((s, r) => s + (parseInt(r.w_ace) || 0), 0) / svcRows.length,
    double_faults:   svcRows.reduce((s, r) => s + (parseInt(r.w_df)  || 0), 0) / svcRows.length,
    svpt:            svcRows.reduce((s, r) => s + (parseInt(r.w_svpt)|| 0), 0) / svcRows.length,
    first_serve_won: svcRows.reduce((s, r) => s + (parseInt(r.w_1stWon)|| 0), 0) / svcRows.length,
  } : null;

  let daysSince = null;
  const ld = lastM.tourney_date;
  if (ld && ld.length === 8) {
    const d = new Date(`${ld.slice(0,4)}-${ld.slice(4,6)}-${ld.slice(6,8)}`);
    daysSince = Math.floor((today - d) / 86400000);
  }

  return {
    name: playerName, current_rank: rank,
    surface_stats: { [surface]: { win_rate: surfM.length > 0 ? surfWins / surfM.length : null, matches: surfM.length } },
    recent_form_ema:    Math.round(ema * 100) / 100,
    service_stats:      svcStats,
    days_since_last_match: daysSince,
    csv_lag_days:       daysSince ?? 999,
    total_matches:      matches.length,
  };
}

function _computeTennisH2H(rows, p1, p2, surface) {
  const h2h = rows.filter(r =>
    ((r.winner_name === p1 && r.loser_name === p2) || (r.winner_name === p2 && r.loser_name === p1)) &&
    r.surface === surface
  );
  return { p1_wins: h2h.filter(r => r.winner_name === p1).length, p2_wins: h2h.filter(r => r.winner_name === p2).length };
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────────

async function espnFetch(url, timeout = 8000) {
  try {
    const response = await fetchTimeout(url, {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; ManiBetPro/1.0)',
        'Referer':    'https://www.espn.com/',
        'Origin':     'https://www.espn.com',
      },
    }, timeout);
    if (!response.ok) { console.error(`ESPN ${response.status}: ${url}`); return null; }
    return await response.json();
  } catch (err) { console.error(`ESPN error: ${err.message}`); return null; }
}

async function fetchTimeout(url, options = {}, timeout = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function formatDateESPN(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function getTodayET() {
  const now = new Date();
  return new Date(now.getTime() + (-5) * 3600000).toISOString().slice(0, 10);
}

function currentSeason() {
  const now = new Date();
  return String(now.getMonth() + 1 >= 10 ? now.getFullYear() : now.getFullYear() - 1);
}
 // ══════════════════════════════════════════════════════════════════════════════
// MLB HANDLERS — à insérer dans worker.js
// ══════════════════════════════════════════════════════════════════════════════

const ESPN_MLB_SCOREBOARD  = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const MLB_STATS_API        = 'https://statsapi.mlb.com/api/v1';
const MLB_ODDS_KV_KEY      = 'mlb_odds_cache';
const MLB_PITCHER_KV_KEY   = 'mlb_pitchers_cache';

// ── ROUTES (à ajouter dans le router) ────────────────────────────────────────
// GET  /mlb/matches
// GET  /mlb/odds/comparison
// GET  /mlb/pitchers         → pitchers titulaires du jour via MLB Stats API
// GET  /mlb/standings
// POST /mlb/bot/run
// GET  /mlb/bot/logs
// POST /mlb/bot/settle-logs

// ── HANDLER : MATCHS MLB ──────────────────────────────────────────────────────
async function handleMLBMatches(url, origin) {
  const dateParam = url.searchParams.get('date');
  const dateStr   = dateParam ? dateParam.replace(/-/g, '') : formatDateESPN(new Date());

  const data = await espnFetch(`${ESPN_MLB_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!data) return errorResponse('ESPN MLB fetch failed', 502, origin);

  return jsonResponse({
    date:    dateStr,
    source:  'espn',
    matches: parseESPNMLBMatches(data, dateStr),
  }, 200, origin);
}

// ── PARSER ESPN MLB ───────────────────────────────────────────────────────────
function parseESPNMLBMatches(data, dateStr) {
  return (data.events ?? []).map(event => {
    const competition = event.competitions?.[0] ?? {};
    const competitors = competition.competitors  ?? [];
    const home        = competitors.find(c => c.homeAway === 'home');
    const away        = competitors.find(c => c.homeAway === 'away');
    const situation   = competition.situation ?? {};

    // Pitchers depuis ESPN (présents dans les notes de situation)
    const homePitcher = _extractESPNPitcher(competition, 'home');
    const awayPitcher = _extractESPNPitcher(competition, 'away');

    return {
      id:            event.id,
      espn_id:       event.id,
      date:          dateStr,
      datetime:      event.date,
      name:          event.name,
      status:        event.status?.type?.name   ?? null,
      status_detail: event.status?.type?.detail ?? null,
      home_team:     parseMLBTeam(home),
      away_team:     parseMLBTeam(away),
      home_season_stats: parseMLBTeamStats(home),
      away_season_stats: parseMLBTeamStats(away),
      home_pitcher:  homePitcher,
      away_pitcher:  awayPitcher,
      venue:         competition.venue?.fullName ?? null,
      venue_city:    competition.venue?.address?.city ?? null,
      source:        'espn',
      fetched_at:    new Date().toISOString(),
    };
  });
}

function parseMLBTeam(competitor) {
  if (!competitor) return null;
  const team    = competitor.team ?? {};
  const records = competitor.records ?? [];
  return {
    espn_id:      team.id,
    name:         team.displayName,
    abbreviation: team.abbreviation,
    score:        competitor.score ?? null,
    record:       records.find(r => r.type === 'total')?.summary ?? null,
    home_record:  records.find(r => r.type === 'home')?.summary  ?? null,
    away_record:  records.find(r => r.type === 'road')?.summary  ?? null,
    logo:         team.logo ?? null,
  };
}

function parseMLBTeamStats(competitor) {
  if (!competitor) return null;
  const stats = competitor.statistics ?? [];
  const get   = (n) => {
    const s = stats.find(x => x.name === n);
    return s ? parseFloat(s.displayValue) : null;
  };
  return {
    runs_per_game:   get('batting.avg') ?? null,
    batting_avg:     get('batting.avg') ?? null,
    era:             get('pitching.era') ?? null,
    win_pct:         competitor.records?.find(r => r.type === 'total')?.pct ?? null,
  };
}

function _extractESPNPitcher(competition, side) {
  // ESPN inclut parfois le pitcher dans les headlines ou probables
  const probables = competition.probables ?? [];
  const pitcher   = probables.find(p => p.homeAway === side);
  if (!pitcher) return null;
  return {
    name:   pitcher.athlete?.displayName ?? null,
    espn_id: pitcher.athlete?.id ?? null,
  };
}

// ── HANDLER : PITCHERS TITULAIRES (MLB Stats API) ────────────────────────────
async function handleMLBPitchers(url, env, origin) {
  const dateParam = url.searchParams.get('date');
  const date      = dateParam ?? new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Cache KV 6h
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(`${MLB_PITCHER_KV_KEY}_${date}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 6 * 3600 * 1000) {
          return jsonResponse({ ...parsed, source: 'cache' }, 200, origin);
        }
      }
    } catch (e) { /* skip */ }
  }

  try {
    // 1. Récupérer le schedule du jour
    const schedResp = await fetchTimeout(
      `${MLB_STATS_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher(stats)`,
      {}, 10000
    );
    if (!schedResp?.ok) return jsonResponse({ available: false, note: 'MLB Stats API unavailable', pitchers: {} }, 200, origin);

    const schedData = await schedResp.json();
    const games     = schedData.dates?.[0]?.games ?? [];

    const pitchers = {};

    // Collecter tous les pitchers à enrichir
    const pitcherTasks = [];
    for (const game of games) {
      const homeName    = game.teams?.home?.team?.name;
      const awayName    = game.teams?.away?.team?.name;
      const homePitcher = game.teams?.home?.probablePitcher;
      const awayPitcher = game.teams?.away?.probablePitcher;
      if (homePitcher && homeName) pitcherTasks.push({ name: homeName, pitcher: homePitcher });
      if (awayPitcher && awayName) pitcherTasks.push({ name: awayName, pitcher: awayPitcher });
    }

    // Appels parallèles (max 10 simultanés pour éviter le rate limit)
    const BATCH = 10;
    for (let i = 0; i < pitcherTasks.length; i += BATCH) {
      const batch = pitcherTasks.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(t => _enrichMLBPitcher(t.pitcher, env))
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) {
          pitchers[batch[idx].name] = r.value;
        }
      });
    }

    const result = { available: true, date, pitchers, fetched_at: Date.now() };

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(
          `${MLB_PITCHER_KV_KEY}_${date}`,
          JSON.stringify(result),
          { expirationTtl: 6 * 3600 }
        );
      } catch (e) { /* skip */ }
    }

    return jsonResponse({ ...result, source: 'mlb_stats_api' }, 200, origin);

  } catch (err) {
    return jsonResponse({ available: false, note: err.message, pitchers: {} }, 200, origin);
  }
}

async function _enrichMLBPitcher(pitcher, env) {
  if (!pitcher?.id) return null;

  try {
    // Appel séparé pour les stats saison — le hydrate(stats) du schedule ne les retourne pas
    const resp = await fetchTimeout(
      `${MLB_STATS_API}/people/${pitcher.id}/stats?stats=season&group=pitching&season=2026`,
      {}, 8000
    );
    if (!resp?.ok) return { id: pitcher.id, name: pitcher.fullName, era: null, fip: null, whip: null, source: 'mlb_stats_api' };

    const data   = await resp.json();
    const season = data.stats?.[0]?.splits?.[0]?.stat ?? {};

    const era  = parseFloat(season.era)          || null;
    const whip = parseFloat(season.whip)         || null;
    const ip   = parseFloat(season.inningsPitched) || null;
    const hr   = parseInt(season.homeRuns)        || 0;
    const bb   = parseInt(season.baseOnBalls)     || 0;
    const k    = parseInt(season.strikeOuts)      || 0;

    // Calculer FIP = (13*HR + 3*BB - 2*K) / IP + 3.10
    const fip = ip && ip > 0
      ? Math.round(((13 * hr + 3 * bb - 2 * k) / ip + 3.10) * 100) / 100
      : null;

    return {
      id:           pitcher.id,
      name:         pitcher.fullName,
      era,
      fip,
      whip,
      innings:      ip,
      strikeouts:   k,
      walks:        bb,
      home_runs:    hr,
      wins:         parseInt(season.wins)         || null,
      losses:       parseInt(season.losses)       || null,
      games:        parseInt(season.gamesStarted) || null,
      k_per_9:      parseFloat(season.strikeoutsPer9Inn) || null,
      bb_per_9:     parseFloat(season.walksPer9Inn)      || null,
      hr_per_9:     parseFloat(season.homeRunsPer9)      || null,
      rest_days:    null,
      source:       'mlb_stats_api',
    };
  } catch (err) {
    return { id: pitcher.id, name: pitcher.fullName, era: null, fip: null, whip: null, source: 'mlb_stats_api_error' };
  }
}


// ── HANDLER : COTES MLB (The Odds API — clé 2) ───────────────────────────────
async function handleMLBOdds(url, env, origin) {
  const key = env.ODDS_API_KEY_2 ?? env.ODDS_API_KEY_1;
  if (!key) return jsonResponse({ available: false, note: 'ODDS_API_KEY not configured', matches: [] }, 200, origin);

  // Cache KV 2h
  if (env.PAPER_TRADING) {
    try {
      const cached = await env.PAPER_TRADING.get(MLB_ODDS_KV_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.fetched_at < 2 * 3600 * 1000) {
          return jsonResponse({ ...parsed, source: 'cache' }, 200, origin);
        }
      }
    } catch (e) { /* skip */ }
  }

  try {
    const resp = await fetchTimeout(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us&markets=h2h,totals&oddsFormat=decimal&bookmakers=pinnacle,draftkings,fanduel,betmgm&apiKey=${key}`,
      { headers: { Accept: 'application/json' } },
      12000
    );

    if (!resp?.ok) return jsonResponse({ available: false, note: `Odds API ${resp?.status}`, matches: [] }, 200, origin);

    const data    = await resp.json();
    const matches = _parseMLBOddsResponse(data);

    const result = { available: true, matches, fetched_at: Date.now() };

    if (env.PAPER_TRADING) {
      try {
        await env.PAPER_TRADING.put(MLB_ODDS_KV_KEY, JSON.stringify(result), { expirationTtl: 7200 });
      } catch (e) { /* skip */ }
    }

    return jsonResponse({ ...result, source: 'the_odds_api' }, 200, origin);

  } catch (err) {
    return jsonResponse({ available: false, note: err.message, matches: [] }, 200, origin);
  }
}

function _parseMLBOddsResponse(data) {
  return (data ?? []).map(game => {
    const bookmakers = (game.bookmakers ?? []).map(bk => {
      const h2h    = bk.markets?.find(m => m.key === 'h2h');
      const totals = bk.markets?.find(m => m.key === 'totals');

      const homeOutcome = h2h?.outcomes?.find(o => o.name === game.home_team);
      const awayOutcome = h2h?.outcomes?.find(o => o.name === game.away_team);
      const overTotal   = totals?.outcomes?.find(o => o.name === 'Over');
      const underTotal  = totals?.outcomes?.find(o => o.name === 'Under');

      return {
        key:         bk.key,
        title:       bk.title,
        home_ml:     homeOutcome?.price ?? null,
        away_ml:     awayOutcome?.price ?? null,
        over_total:  overTotal?.price   ?? null,
        under_total: underTotal?.price  ?? null,
        total_line:  overTotal?.point   ?? null,
      };
    }).filter(bk => bk.home_ml !== null);

    return {
      odds_api_id:   game.id,
      home_team:     game.home_team,
      away_team:     game.away_team,
      commence_time: game.commence_time,
      bookmakers,
    };
  });
}

// ── HANDLER : STANDINGS MLB ───────────────────────────────────────────────────
async function handleMLBStandings(origin) {
  try {
    const resp = await fetchTimeout(
      `${MLB_STATS_API}/standings?leagueId=103,104&season=2026&standingsTypes=regularSeason&hydrate=team`,
      {}, 10000
    );
    if (!resp?.ok) return jsonResponse({ available: false }, 200, origin);
    const data = await resp.json();

    const standings = {};
    for (const record of data.records ?? []) {
      for (const teamRecord of record.teamRecords ?? []) {
        const name = teamRecord.team?.name;
        if (!name) continue;
        standings[name] = {
          wins:        teamRecord.wins,
          losses:      teamRecord.losses,
          pct:         teamRecord.winningPercentage,
          run_diff:    teamRecord.runDifferential,
          runs_scored: teamRecord.runsScored,
          runs_allowed: teamRecord.runsAllowed,
          division:    record.division?.name ?? null,
          league:      record.league?.name ?? null,
        };
      }
    }
    return jsonResponse({ available: true, standings, source: 'mlb_stats_api' }, 200, origin);
  } catch (err) {
    return jsonResponse({ available: false, note: err.message }, 200, origin);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MLB BOT — Cron + analyse automatique
// ══════════════════════════════════════════════════════════════════════════════

const MLB_BOT_LOG_PREFIX = 'mlb_bot_log_';
const MLB_BOT_RUN_KEY    = 'mlb_bot_last_run';

// Park factors inline (copie du moteur pour le worker)
const MLB_PARK_FACTORS_W = {
  'Coors Field':115,'Great American Ball Park':108,'Fenway Park':106,
  'Globe Life Field':105,'Yankee Stadium':104,'Wrigley Field':103,
  'Oracle Park':97,'T-Mobile Park':96,'Petco Park':95,'Dodger Stadium':97,
  'Tropicana Field':95,'Oakland Coliseum':96,'loanDepot Park':95,
  'Truist Park':99,'American Family Field':100,'Target Field':99,
  'Busch Stadium':97,'Minute Maid Park':100,'Angel Stadium':99,
  'Chase Field':104,'Kauffman Stadium':99,'Progressive Field':98,
  'PNC Park':97,'Citizens Bank Park':103,'Citi Field':97,
  'Camden Yards':101,'Guaranteed Rate Field':98,'Comerica Park':96,
  'Rogers Centre':102,'Nationals Park':99,
};

// ── CRON MLB BOT ──────────────────────────────────────────────────────────────
async function _runMLBBotCron(env, forceRun = false) {
  const now     = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const dateESPN = dateStr.replace(/-/g, '');       // YYYYMMDD

  console.log(`[MLB BOT] Démarré — ${now.toISOString()}, date: ${dateStr}`);

  // 1. Matchs du jour
  const espnData = await espnFetch(`${ESPN_MLB_SCOREBOARD}?dates=${dateESPN}&limit=25`);
  if (!espnData) { console.warn('[MLB BOT] ESPN indisponible'); return; }

  const matches = parseESPNMLBMatches(espnData, dateESPN).filter(m =>
    m.status !== 'STATUS_FINAL' && m.home_team && m.away_team
  );

  if (!matches.length) { console.log('[MLB BOT] Aucun match MLB aujourd\'hui'); return; }

  // 2. Vérifier fenêtre : premier match dans les 2h (sauf forceRun)
  const firstMatchTime = matches
    .map(m => m.datetime ? new Date(m.datetime).getTime() : Infinity)
    .sort((a, b) => a - b)[0];

  const msUntilFirst = firstMatchTime - Date.now();
  const isInWindow   = msUntilFirst > 0 && msUntilFirst < 2 * 3600 * 1000;

  if (!forceRun && !isInWindow) {
    console.log(`[MLB BOT] Hors fenêtre — premier match dans ${Math.round(msUntilFirst / 60000)}min`);
    return;
  }

  // 3. Anti-doublon
  if (!forceRun && env.PAPER_TRADING) {
    try {
      const last = await env.PAPER_TRADING.get(MLB_BOT_RUN_KEY);
      if (last && JSON.parse(last).date === dateStr) {
        console.log('[MLB BOT] Déjà tourné aujourd\'hui');
        return;
      }
    } catch (e) { /* skip */ }
  }

  // 4. Charger données en parallèle — appels directs aux fonctions
  const fakeOrigin = 'https://manibetpro.emmanueldelasse.workers.dev';
  const fakeUrl    = new URL(`https://manibetpro.emmanueldelasse.workers.dev/mlb/pitchers?date=${dateStr}`);
  const fakeOddsUrl = new URL('https://manibetpro.emmanueldelasse.workers.dev/mlb/odds/comparison');
  const fakeStandUrl = new URL('https://manibetpro.emmanueldelasse.workers.dev/mlb/standings');

  const [pitchersResp, oddsResp, standingsResp] = await Promise.allSettled([
    handleMLBPitchers(fakeUrl, env, fakeOrigin),
    handleMLBOdds(fakeOddsUrl, env, fakeOrigin),
    handleMLBStandings(fakeOrigin),
  ]);

  const pitchersData  = pitchersResp.status  === 'fulfilled' ? await pitchersResp.value.json()  : null;
  const oddsData      = oddsResp.status      === 'fulfilled' ? await oddsResp.value.json()      : null;
  const standingsData = standingsResp.status === 'fulfilled' ? await standingsResp.value.json() : null;

  console.log(`[MLB BOT] Pitchers: ${Object.keys(pitchersData?.pitchers ?? {}).length}, Odds: ${oddsData?.matches?.length ?? 0}`);

  // 5. Analyser chaque match
  const logs       = [];
  const edgesFound = [];

  for (const match of matches) {
    try {
      const log = _mlbAnalyzeMatch(match, dateStr, pitchersData, oddsData, standingsData);
      if (!log) continue;
      if (env.PAPER_TRADING) {
        await env.PAPER_TRADING.put(
          `${MLB_BOT_LOG_PREFIX}${match.id}`,
          JSON.stringify(log),
          { expirationTtl: 90 * 24 * 3600 }
        );
      }
      logs.push(log);
      if (log.best_edge && log.best_edge >= 5) edgesFound.push(log);
    } catch (err) {
      console.error(`[MLB BOT] Erreur ${match.id}:`, err.message);
    }
  }

  // 6. Marquer le run
  if (env.PAPER_TRADING) {
    try {
      await env.PAPER_TRADING.put(
        MLB_BOT_RUN_KEY,
        JSON.stringify({ date: dateStr, ran_at: now.toISOString(), matches_analyzed: logs.length }),
        { expirationTtl: 30 * 3600 }
      );
    } catch (e) { /* skip */ }
  }

  console.log(`[MLB BOT] Terminé — ${logs.length} matchs, ${edgesFound.length} edges`);
}

// ── ANALYSER UN MATCH MLB ─────────────────────────────────────────────────────
function _mlbAnalyzeMatch(match, dateStr, pitchersData, oddsData, standingsData) {
  const homeName = match.home_team?.name;
  const awayName = match.away_team?.name;
  if (!homeName || !awayName) return null;

  const pitchers   = pitchersData?.pitchers ?? {};
  const standings  = standingsData?.standings ?? {};
  const homePit    = pitchers[homeName]  ?? match.home_pitcher ?? null;
  const awayPit    = pitchers[awayName]  ?? match.away_pitcher ?? null;
  const homeStand  = standings[homeName] ?? null;
  const awayStand  = standings[awayName] ?? null;

  // Trouver les cotes pour ce match
  const marketOdds = _mlbGetMarketOdds(oddsData, homeName, awayName);

  const matchData = {
    match_id:     match.id,
    home_team:    homeName,
    away_team:    awayName,
    venue:        match.venue,
    home_pitcher: homePit,
    away_pitcher: awayPit,
    home_lineup:  null, // lineups non dispo sans API payante
    away_lineup:  null,
    home_bullpen: null, // bullpen non dispo gratuitement
    away_bullpen: null,
    home_season: homeStand ? {
      run_diff:      homeStand.run_diff,
      win_pct:       parseFloat(homeStand.pct ?? 0),
      runs_per_game: homeStand.runs_scored ? homeStand.runs_scored / Math.max(1, homeStand.wins + homeStand.losses) : null,
      runs_allowed:  homeStand.runs_allowed,
    } : null,
    away_season: awayStand ? {
      run_diff:      awayStand.run_diff,
      win_pct:       parseFloat(awayStand.pct ?? 0),
      runs_per_game: awayStand.runs_scored ? awayStand.runs_scored / Math.max(1, awayStand.wins + awayStand.losses) : null,
      runs_allowed:  awayStand.runs_allowed,
    } : null,
    market_odds: marketOdds,
  };

  // Appeler le moteur inline (version simplifiée portée dans le worker)
  const analysis = _mlbEngineCompute(matchData);
  if (!analysis) return null;

  return {
    logged_at:       new Date().toISOString(),
    match_id:        match.id,
    home:            homeName,
    away:            awayName,
    date:            dateStr,
    datetime:        match.datetime,
    venue:           match.venue,
    home_pitcher:    homePit?.name ?? null,
    away_pitcher:    awayPit?.name ?? null,
    home_pitcher_era: homePit?.era ?? null,
    home_pitcher_fip: homePit?.fip ?? null,
    away_pitcher_era: awayPit?.era ?? null,
    away_pitcher_fip: awayPit?.fip ?? null,
    home_prob:       analysis.home_prob,
    away_prob:       analysis.away_prob,
    data_quality:    analysis.data_quality,
    missing_vars:    analysis.missing_vars,
    variables:       analysis.variables,
    est_total_runs:  analysis.est_total_runs,
    betting_recommendations: {
      all:  analysis.recommendations,
      best: analysis.best,
    },
    best_edge: analysis.best?.edge ?? null,
    // Pour le settler
    result_home_score: null,
    result_away_score: null,
    result_winner:     null,
    result_margin:     null,
    result_total:      null,
    motor_was_right:   null,
    prob_delta_pts:    null,
    upset:             null,
    ou_was_right:      null,
    settled_at:        null,
  };
}

function _mlbGetMarketOdds(oddsData, homeName, awayName) {
  if (!oddsData?.matches?.length) return null;
  return oddsData.matches.find(m =>
    (m.home_team === homeName && m.away_team === awayName) ||
    (m.home_team === awayName && m.away_team === homeName)
  ) ?? null;
}

// ── MOTEUR MLB INLINE (porté dans le worker sans import) ─────────────────────
function _mlbEngineCompute(matchData) {
  const { home_pitcher, away_pitcher, home_season, away_season, venue, market_odds } = matchData;

  const hFIP = home_pitcher?.fip ?? home_pitcher?.era ?? 4.20;
  const aFIP = away_pitcher?.fip ?? away_pitcher?.era ?? 4.20;
  const fipDiff    = aFIP - hFIP;
  const pitcherAdv = Math.tanh(fipDiff / 2) * 0.20;

  const hRest  = home_pitcher?.rest_days ?? 4;
  const aRest  = away_pitcher?.rest_days ?? 4;
  const rScore = (r) => r < 3 ? -0.03 : r < 4 ? -0.01 : r <= 6 ? 0 : -0.01;
  const restAdv = rScore(hRest) - rScore(aRest);

  const hRunDiff   = home_season?.run_diff ?? 0;
  const aRunDiff   = away_season?.run_diff ?? 0;
  const runDiffAdv = Math.tanh((hRunDiff - aRunDiff) / 50) * 0.07;

  let homeProb = 0.536 + pitcherAdv + restAdv + runDiffAdv;
  homeProb     = Math.max(0.20, Math.min(0.80, homeProb));

  const missing = [];
  let dataQuality = 'MEDIUM';
  if (!home_pitcher?.fip && !home_pitcher?.era) { missing.push('home_pitcher'); dataQuality = 'LOW'; }
  if (!away_pitcher?.fip && !away_pitcher?.era) { missing.push('away_pitcher'); dataQuality = 'LOW'; }
  if (home_pitcher?.fip) dataQuality = 'HIGH';

  const recommendations = [];
  const BOOK_PRIORITY_W = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];

  const _getBest = (side) => {
    if (!market_odds?.bookmakers?.length) return null;
    for (const key of BOOK_PRIORITY_W) {
      const bk = market_odds.bookmakers.find(b => b.key === key);
      if (!bk) continue;
      const odds = side === 'HOME' ? bk.home_ml : bk.away_ml;
      if (odds && odds > 1) {
        const am = odds >= 2 ? Math.round((odds-1)*100) : Math.round(-100/(odds-1));
        return { odds: am, decimalOdds: odds, bookmaker: bk.title ?? bk.key };
      }
    }
    return null;
  };

  const _decToAm = (d) => d >= 2 ? Math.round((d-1)*100) : Math.round(-100/(d-1));
  const _amToProb = (a) => a > 0 ? 100/(a+100) : Math.abs(a)/(Math.abs(a)+100);

  for (const [side, prob] of [['HOME', homeProb], ['AWAY', 1 - homeProb]]) {
    const best = _getBest(side);
    if (!best) continue;
    const impliedProb = _amToProb(best.odds);
    const edge = Math.round((prob - impliedProb) * 100);
    if (edge >= 5) {
      recommendations.push({
        type: 'MONEYLINE', label: 'Vainqueur', side,
        odds_line: best.odds, odds_decimal: best.decimalOdds, odds_source: best.bookmaker,
        motor_prob: Math.round(prob * 100), implied_prob: Math.round(impliedProb * 100),
        edge, kelly_stake: null, has_value: true,
      });
    }
  }

  // Over/Under
  const parkFact = (MLB_PARK_FACTORS_W[venue] ?? 100) / 100;
  const hRPG  = home_season?.runs_per_game ?? 4.5;
  const aRPG  = away_season?.runs_per_game ?? 4.5;
  const pitcherRed = 1 - Math.min(0.30, Math.max(0, (8 - (hFIP + aFIP) / 2) / 20));
  const estTotal   = (hRPG + aRPG) * parkFact * pitcherRed;

  const ouBk = market_odds?.bookmakers?.[0];
  const ouLine = ouBk?.total_line ?? null;
  if (ouLine) {
    const diff     = estTotal - ouLine;
    const overProb = 0.50 + Math.tanh(diff / 2) * 0.15;
    for (const [side, prob] of [['OVER', overProb], ['UNDER', 1 - overProb]]) {
      const bk = market_odds?.bookmakers?.find(b => b.key === 'pinnacle') ?? ouBk;
      const oddsVal = side === 'OVER' ? bk?.over_total : bk?.under_total;
      if (!oddsVal) continue;
      const impliedProb = 1 / oddsVal;
      const edge = Math.round((prob - impliedProb) * 100);
      if (edge >= 5) {
        recommendations.push({
          type: 'OVER_UNDER', label: `Total (${ouLine} runs)`, side, ou_line: ouLine,
          odds_line: _decToAm(oddsVal), odds_decimal: oddsVal, odds_source: 'Pinnacle',
          motor_prob: Math.round(prob * 100), implied_prob: Math.round(impliedProb * 100),
          edge, kelly_stake: null, has_value: true,
        });
      }
    }
  }

  recommendations.sort((a, b) => b.edge - a.edge);

  return {
    home_prob:    Math.round(homeProb * 100),
    away_prob:    Math.round((1 - homeProb) * 100),
    data_quality: dataQuality,
    missing_vars: missing,
    variables:    { pitcher_fip_diff: Math.round(fipDiff * 100) / 100, run_diff_adv: Math.round(runDiffAdv * 100), park_factor: MLB_PARK_FACTORS_W[venue] ?? 100, home_pitcher: home_pitcher?.name ?? null, away_pitcher: away_pitcher?.name ?? null },
    recommendations,
    best:          recommendations[0] ?? null,
    est_total_runs: Math.round(estTotal * 10) / 10,
  };
}

// ── HANDLER BOT RUN MLB ───────────────────────────────────────────────────────
async function handleMLBBotRun(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    await env.PAPER_TRADING.delete(MLB_BOT_RUN_KEY);
    await _runMLBBotCron(env, true);
    const list = await env.PAPER_TRADING.list({ prefix: MLB_BOT_LOG_PREFIX });
    return jsonResponse({ success: true, note: 'MLB Bot run terminé', logs_written: list.keys?.length ?? 0 }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ── HANDLER LOGS MLB ──────────────────────────────────────────────────────────
async function handleMLBBotLogs(url, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const dateFilter = url.searchParams.get('date') ?? null;
    const list       = await env.PAPER_TRADING.list({ prefix: MLB_BOT_LOG_PREFIX });
    const keys       = (list.keys ?? []).map(k => k.name);

    const logs = [];
    await Promise.all(keys.map(async key => {
      try {
        const raw = await env.PAPER_TRADING.get(key);
        if (!raw) return;
        const log = JSON.parse(raw);
        if (dateFilter && !log.date?.startsWith(dateFilter)) return;
        logs.push(log);
      } catch { /* skip */ }
    }));

    logs.sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));

    const settled  = logs.filter(l => l.motor_was_right !== null);
    const correct  = settled.filter(l => l.motor_was_right === true);
    const hitRate  = settled.length > 0 ? Math.round(correct.length / settled.length * 1000) / 10 : null;
    const avgEdge  = logs.filter(l => l.best_edge).length > 0
      ? Math.round(logs.filter(l => l.best_edge).reduce((s, l) => s + l.best_edge, 0) / logs.filter(l => l.best_edge).length * 10) / 10
      : null;

    return jsonResponse({
      logs,
      stats: { total_analyzed: logs.length, total_settled: settled.length, hit_rate: hitRate, avg_edge: avgEdge },
    }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}

// ── HANDLER SETTLER MLB ───────────────────────────────────────────────────────
async function _mlbBotSettleDate(env, dateStr) {
  const espnData = await espnFetch(`${ESPN_MLB_SCOREBOARD}?dates=${dateStr}&limit=25`);
  if (!espnData) return { settled: 0, error: 'ESPN unavailable' };

  const results = parseESPNMLBMatches(espnData, dateStr).filter(m => m.status === 'STATUS_FINAL');
  let settled = 0;

  for (const result of results) {
    const key = `${MLB_BOT_LOG_PREFIX}${result.id}`;
    try {
      const raw = await env.PAPER_TRADING.get(key);
      if (!raw) continue;
      const log = JSON.parse(raw);
      if (log.motor_was_right !== null) continue;

      const homeScore = parseInt(result.home_team?.score ?? 0);
      const awayScore = parseInt(result.away_team?.score ?? 0);
      const winner    = homeScore > awayScore ? 'HOME' : 'AWAY';
      const margin    = homeScore - awayScore;
      const totalRuns = homeScore + awayScore;

      const motorPredictedHome = (log.home_prob ?? 50) > 50;
      const motorWasRight      = (motorPredictedHome && winner === 'HOME') ||
                                 (!motorPredictedHome && winner === 'AWAY');

      const probDelta = log.home_prob !== null
        ? Math.round((log.home_prob - (winner === 'HOME' ? 100 : 0)) * 10) / 10
        : null;
      const upset = log.home_prob !== null && Math.abs(log.home_prob - 50) > 5 && !motorWasRight;

      let ouWasRight = null;
      const recBest = log.betting_recommendations?.best;
      if (recBest?.market === 'total' && recBest?.line !== undefined && recBest?.side) {
        const over = totalRuns > recBest.line;
        ouWasRight = recBest.side === 'OVER' ? over : !over;
      }

      log.result_home_score = homeScore;
      log.result_away_score = awayScore;
      log.result_winner     = winner;
      log.result_margin     = margin;
      log.result_total      = totalRuns;
      log.motor_was_right   = motorWasRight;
      log.prob_delta_pts    = probDelta;
      log.upset             = upset;
      log.ou_was_right      = ouWasRight;
      log.settled_at        = new Date().toISOString();

      await env.PAPER_TRADING.put(key, JSON.stringify(log), { expirationTtl: 90 * 24 * 3600 });
      settled++;
    } catch (err) { console.warn(`[MLB BOT] settle ${result.id}:`, err.message); }
  }

  return { settled, date: dateStr };
}

async function handleMLBBotSettleLogs(request, env, origin) {
  if (!env.PAPER_TRADING) return jsonResponse({ error: 'KV not configured' }, 500, origin);
  try {
    const body    = await request.json().catch(() => ({}));
    const dateStr = body.date ?? new Date().toISOString().split('T')[0].replace(/-/g, '');
    const res     = await _mlbBotSettleDate(env, dateStr);
    if (res.error) return jsonResponse({ error: res.error }, 502, origin);
    return jsonResponse({ success: true, ...res }, 200, origin);
  } catch (err) { return jsonResponse({ error: err.message }, 500, origin); }
}
