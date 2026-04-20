/**
 * MANI BET PRO — engine.nba.variables.js v1.0
 *
 * Extrait depuis engine.nba.js v5.12 (refactor v5.13).
 * Responsabilité : extraction des variables brutes depuis rawData,
 * normalisation, calculs d'absences et de forme récente.
 *
 * Exporté vers engine.nba.js (orchestrateur) uniquement.
 * NE PAS importer directement depuis l'UI ou l'orchestrateur de données.
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';

const CONFIG    = SPORTS_CONFIG.NBA;
const MIN_GAMES = CONFIG.rejection_thresholds.min_games_sample ?? 10;

// Modificateur star absente — constantes partagées avec engine.nba.js
export const STAR_PPG_THRESHOLD    = 18;  // v1.1 : 20 → 18 pour capturer plus de stars impactants
export const STAR_FACTOR           = 1.55;
export const STAR_MAX_REDUCTION    = 0.45;
export const STAR_TEAM_PPG_FALLBACK = 110;

// ── EXTRACTION ────────────────────────────────────────────────────────────────

export function extractVariables(data) {
  const homeStats    = data?.home_season_stats;
  const awayStats    = data?.away_season_stats;
  const homeRecent   = data?.home_recent;
  const awayRecent   = data?.away_recent;
  const homeInj      = data?.home_injuries;
  const awayInj      = data?.away_injuries;
  const advancedStats = data?.advanced_stats ?? null;

  const homeGames = homeStats?.games_played ?? null;
  const awayGames = awayStats?.games_played ?? null;

  return {
    net_rating_diff: safeAdvancedDiff(advancedStats, homeStats, awayStats, 'net_rating'),

    efg_diff: safeDiff(
      guardStat(homeStats?.efg_pct, 0.40, 0.65),
      guardStat(awayStats?.efg_pct, 0.40, 0.65),
      'espn_scoreboard', homeGames, awayGames
    ),

    ts_diff: safeDiff(homeStats?.ts_pct, awayStats?.ts_pct, 'espn_scoreboard', homeGames, awayGames),

    win_pct_diff: safeDiff(
      guardStat(homeStats?.win_pct, 0.01, 0.99),
      guardStat(awayStats?.win_pct, 0.01, 0.99),
      'espn_scoreboard', homeGames, awayGames
    ),

    home_away_split: computeHomeSplit(homeStats, awayStats),

    recent_form_ema: safeEMADiff(homeRecent, awayRecent, data?.__ema_lambda ?? CONFIG.ema_lambda),

    absences_impact: computeAbsencesImpact(homeInj, awayInj),

    avg_pts_diff: safeDiff(
      guardStat(homeStats?.avg_pts, 85, 135),
      guardStat(awayStats?.avg_pts, 85, 135),
      'espn_scoreboard', homeGames, awayGames
    ),

    defensive_diff: safeAdvancedDiff(advancedStats, homeStats, awayStats, 'defensive_rating', true),

    pace_diff: (() => {
      const fromTank01 = safeAdvancedDiff(advancedStats, homeStats, awayStats, 'pace');
      if (fromTank01.value !== null) return fromTank01;
      const hPts = homeStats?.avg_pts ?? null;
      const aPts = awayStats?.avg_pts ?? null;
      if (hPts === null || aPts === null) return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
      const avgTotal = hPts + aPts;
      const NBA_AVG_TOTAL = 225;
      return { value: Math.round((avgTotal - NBA_AVG_TOTAL) * 10) / 10, source: 'espn_scoreboard_proxy', quality: 'ESTIMATED' };
    })(),

    back_to_back:   computeBackToBack(data),
    rest_days_diff: computeRestDiff(data),
    b2b_cumul_diff: computeB2BCumulDiff(data),
    travel_load_diff: computeTravelLoadDiff(data),
  };
}

// ── NORMALISATION ─────────────────────────────────────────────────────────────

export function normalizeVariables(variables) {
  return {
    net_rating_diff: clampNormalize(variables.net_rating_diff?.value, -10,   10),
    efg_diff:        clampNormalize(variables.efg_diff?.value,        -0.07, 0.07),
    ts_diff:         clampNormalize(variables.ts_diff?.value,         -0.07, 0.07),
    win_pct_diff:    variables.win_pct_diff?.value    ?? null,
    home_away_split: variables.home_away_split?.value ?? null,
    recent_form_ema: variables.recent_form_ema?.value ?? null,
    absences_impact: variables.absences_impact?.value ?? null,
    avg_pts_diff:    clampNormalize(variables.avg_pts_diff?.value,    -15,   15),
    back_to_back:    variables.back_to_back?.value    ?? null,
    rest_days_diff:  clampNormalize(variables.rest_days_diff?.value,  -3,    3),
    defensive_diff:  clampNormalize(variables.defensive_diff?.value,  -5,    5),
    // b2b_cumul_diff : écart max ±3 (0 vs 3 B2B sur 5 derniers matchs)
    b2b_cumul_diff:  clampNormalize(variables.b2b_cumul_diff?.value,  -3,    3),
    // travel_load_diff : écart max ±5 (0 vs 5 away sur 5 derniers matchs)
    travel_load_diff: clampNormalize(variables.travel_load_diff?.value, -5, 5),
  };
}

export function clampNormalize(value, min, max) {
  if (value === null || value === undefined) return null;
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - (min + max) / 2) / ((max - min) / 2);
}

// ── ABSENCES ──────────────────────────────────────────────────────────────────

export function computeAbsencesImpact(homeInj, awayInj) {
  if (!homeInj || !awayInj) return { value: null, source: 'espn_injuries', quality: 'MISSING' };

  const SW = { 'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.1, 'Available': 0.0 };

  const score = players => {
    if (!Array.isArray(players)) return 0;
    return players.reduce((acc, p) => {
      const isGL    = p.reason?.toLowerCase().includes('g league') || p.reason?.toLowerCase().includes('two-way');
      const glFactor = isGL ? 0.3 : 1.0;
      const impact = (p.source === 'tank01' && p.impact_weight != null)
        ? p.impact_weight * glFactor
        : (SW[p.status] ?? p.impact_weight ?? 0) * glFactor;
      return acc + impact;
    }, 0);
  };

  const isWeighted = homeInj.some(p => p.source === 'tank01' || p.source === 'tank01_roster')
                  || awayInj.some(p => p.source === 'tank01' || p.source === 'tank01_roster');

  const hs = score(homeInj);
  const as = score(awayInj);
  const normFactor = isWeighted ? 1.0 : 5.0;

  return {
    value:   Math.max(-1, Math.min(1, (as - hs) / normFactor)),
    source:  isWeighted ? 'espn_injuries+tank01' : 'nba_official_pdf',
    quality: isWeighted ? 'WEIGHTED' : 'ESTIMATED',
    raw: {
      home_score:  Math.round(hs * 1000) / 1000,
      away_score:  Math.round(as * 1000) / 1000,
      home_out:    homeInj.filter(p => p.status === 'Out').length,
      away_out:    awayInj.filter(p => p.status === 'Out').length,
      is_weighted: isWeighted,
    },
  };
}

export function computeStarAbsenceModifier(homeInjuries, awayInjuries, homeTeamPpg = null, awayTeamPpg = null, isPlayoff = false) {
  const STAR_STATUSES = new Set(['Out', 'Doubtful', 'Day-To-Day', 'Limited']);
  const STATUS_WEIGHT = { 'Out': 1.0, 'Doubtful': 0.75, 'Day-To-Day': 0.50, 'Limited': 0.45 };

  // Facteurs renforcés en playoffs — rotations courtes (~8 joueurs), star irremplaçable
  const starFactor    = isPlayoff ? 2.0  : STAR_FACTOR;        // 1.55 → 2.0
  const maxReduction  = isPlayoff ? 0.55 : STAR_MAX_REDUCTION; // 0.45 → 0.55

  const computeTeamReduction = (injuries, teamPpg) => {
    if (!Array.isArray(injuries) || injuries.length === 0) return { reduction: 0, majorCount: 0, outCount: 0 };

    let totalReduction = 0, majorCount = 0, outCount = 0;
    const denom = teamPpg && teamPpg > 0 ? teamPpg : STAR_TEAM_PPG_FALLBACK;

    for (const player of injuries) {
      if (!STAR_STATUSES.has(player.status)) continue;
      const ppg = player.ppg ?? null;
      if (ppg === null || ppg <= STAR_PPG_THRESHOLD) continue;
      majorCount += 1;
      if (player.status === 'Out') outCount += 1;
      else if (player.status === 'Day-To-Day') outCount += 0.5; // DTD = demi-absence pour le multiplier
      const sw = STATUS_WEIGHT[player.status] ?? 0.75;
      totalReduction += (ppg / denom) * sw * starFactor;
    }

    let multiplier = 1;
    if      (outCount >= 3)   multiplier = 3.00;
    else if (outCount >= 2)   multiplier = 2.10;
    else if (outCount >= 1)   multiplier = 1.35;  // couvre 1 OUT ou 2 DTD (0.5+0.5=1)
    else if (majorCount >= 3) multiplier = 1.40;
    else if (majorCount >= 2) multiplier = 1.20;

    return { reduction: Math.min(totalReduction * multiplier, maxReduction), majorCount, outCount };
  };

  const home = computeTeamReduction(homeInjuries, homeTeamPpg);
  const away = computeTeamReduction(awayInjuries, awayTeamPpg);

  if (home.reduction === 0 && away.reduction === 0) return null;

  const modifier = (1 - home.reduction) / (1 - away.reduction);
  return Math.round(Math.max(0.70, Math.min(1.30, modifier)) * 1000) / 1000;
}

// ── HELPERS INTERNES ──────────────────────────────────────────────────────────

export function assessMissing(variables) {
  const missing = [], missingCritical = [];
  for (const varConfig of CONFIG.variables) {
    const v = variables[varConfig.id];
    if (!v || v.value === null || v.quality === 'MISSING') {
      missing.push(varConfig.id);
      if (varConfig.critical) missingCritical.push(varConfig.id);
    }
  }
  return { missing, missingCritical };
}

export function estimateVolatility(variables) {
  let vol = 0.20;
  const abs = variables.absences_impact?.value;
  if (abs !== null && Math.abs(abs) > 0.5) vol += 0.15;
  const hasLow = Object.values(variables).some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
  if (hasLow) vol += 0.10;
  return Math.min(1, Math.round(vol * 100) / 100);
}

function guardStat(value, min, max) {
  if (value === null || value === undefined) return null;
  if (value < min || value > max) return null;
  return value;
}

function safeDiff(homeVal, awayVal, source, homeGames = null, awayGames = null) {
  if (homeVal === null || homeVal === undefined || awayVal === null || awayVal === undefined) {
    return { value: null, source, quality: 'MISSING' };
  }
  if ((homeGames !== null && homeGames < MIN_GAMES) || (awayGames !== null && awayGames < MIN_GAMES)) {
    return {
      value:   homeVal - awayVal, source, quality: 'LOW_SAMPLE',
      note:    `games_played insuffisant (home=${homeGames}, away=${awayGames}, min=${MIN_GAMES})`,
    };
  }
  return { value: homeVal - awayVal, source, quality: 'VERIFIED' };
}

function safeAdvancedDiff(advancedStats, homeStats, awayStats, field, invertSign = false) {
  if (advancedStats && homeStats?.name && awayStats?.name) {
    const homeAdv = advancedStats[homeStats.name] ?? advancedStats[homeStats.team_name];
    const awayAdv = advancedStats[awayStats.name] ?? advancedStats[awayStats.team_name];

    if (homeAdv?.[field] != null && awayAdv?.[field] != null) {
      const homeGames = homeAdv.games_played ?? homeStats?.games_played ?? null;
      const awayGames = awayAdv.games_played ?? awayStats?.games_played ?? null;
      const quality   = (homeGames !== null && homeGames < MIN_GAMES) || (awayGames !== null && awayGames < MIN_GAMES)
        ? 'LOW_SAMPLE' : 'VERIFIED';
      const rawDiff = homeAdv[field] - awayAdv[field];
      return { value: Math.round((invertSign ? -rawDiff : rawDiff) * 100) / 100, source: 'tank01', quality };
    }
  }

  const homeVal = homeStats?.[field] ?? null;
  const awayVal = awayStats?.[field] ?? null;
  if (homeVal === null || awayVal === null) return { value: null, source: 'tank01', quality: 'MISSING' };
  const rawDiff = homeVal - awayVal;
  return { value: invertSign ? -rawDiff : rawDiff, source: 'espn_scoreboard', quality: 'PARTIAL' };
}

function computeHomeSplit(homeStats, awayStats) {
  const h = homeStats?.home_win_pct;
  const a = awayStats?.away_win_pct;
  if (h == null || a == null) return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
  return {
    value:   Math.max(-1, Math.min(1, (h - a) * 2)),
    source:  'espn_scoreboard', quality: 'VERIFIED',
    raw:     { home_home_win_pct: h, away_away_win_pct: a },
  };
}

function safeEMADiff(homeRecent, awayRecent, lambda) {
  if (!homeRecent?.matches || !awayRecent?.matches)
    return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
  if (lambda === null)
    return { value: null, source: 'balldontlie_v1', quality: 'UNCALIBRATED' };
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
    value:   homeEMA - awayEMA,
    source:  'balldontlie_v1',
    quality: (homeRecent.matches.length >= 5 && awayRecent.matches.length >= 5) ? 'VERIFIED' : 'LOW_SAMPLE',
  };
}

function computeBackToBack(data) {
  const h = data?.home_back_to_back ?? null, a = data?.away_back_to_back ?? null;
  if (h === null && a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
  let value = 0;
  if (h && !a) value = -1;
  else if (!h && a) value = 1;
  return { value, source: 'espn_schedule', quality: 'VERIFIED', raw: { home_b2b: h, away_b2b: a } };
}

function computeRestDiff(data) {
  const h = data?.home_rest_days ?? null, a = data?.away_rest_days ?? null;
  if (h === null || a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
  return { value: Math.max(-3, Math.min(3, h - a)), source: 'espn_schedule', quality: 'VERIFIED', raw: { home_rest: h, away_rest: a } };
}

/**
 * B2B cumulé — diff entre nb B2B home et away sur les 5 derniers matchs.
 * Positif = away a plus de B2B récents → avantage home.
 * Inversion du signe car b2b = fatigue (néfaste pour l'équipe concernée).
 */
function computeB2BCumulDiff(data) {
  const h = data?.home_b2b_last5 ?? null, a = data?.away_b2b_last5 ?? null;
  if (h === null || a === null) return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
  // Positif = avantage home (home a moins de B2B que away)
  return {
    value:   a - h,
    source:  'balldontlie_v1',
    quality: 'VERIFIED',
    raw:     { home_b2b_last5: h, away_b2b_last5: a },
  };
}

/**
 * Charge de voyage — diff entre nb away games home et away sur les 5 derniers matchs.
 * Positif = away a plus voyagé récemment → avantage home (fatigue voyage, décalage).
 */
function computeTravelLoadDiff(data) {
  const h = data?.home_away_games_last5 ?? null, a = data?.away_away_games_last5 ?? null;
  if (h === null || a === null) return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
  return {
    value:   a - h,
    source:  'balldontlie_v1',
    quality: 'VERIFIED',
    raw:     { home_away_last5: h, away_away_last5: a },
  };
}
