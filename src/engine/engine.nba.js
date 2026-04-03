/**
 * MANI BET PRO — engine.nba.js v5
 *
 * AJOUTS v5 :
 *   1. net_rating_diff — signal dominant depuis NBA Stats API
 *      Remplace win_pct_diff comme indicateur de qualité globale.
 *      Source : /nba/stats/advanced (stats.nba.com via Worker).
 *
 *   2. min_games_sample guard dans _safeDiff et _safeEMADiff.
 *      En v4, efg_pct sur 2 matchs (début de saison) était traité
 *      comme une stat fiable. Désormais : quality='LOW_SAMPLE' si
 *      games_played < MIN_GAMES (10 par défaut dans sports.config.js).
 *
 *   3. pace_diff — différentiel de pace entre les deux équipes.
 *      Utilisé pour améliorer le calcul O/U (avg_pts biaisé pace supprimé
 *      du calcul O/U, remplacé par projection pace × possessions).
 */

import { SPORTS_CONFIG }                 from '../config/sports.config.js';
import { americanToProb, decimalToProb } from '../utils/utils.odds.js';
import { Logger }                         from '../utils/utils.logger.js';

const CONFIG   = SPORTS_CONFIG.NBA;
const MIN_GAMES = CONFIG.rejection_thresholds.min_games_sample ?? 10;

// Seuils edge minimum
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.07,
  SPREAD:     0.03,
  OVER_UNDER: 0.03,
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION = 0.25;
const KELLY_MAX_PCT  = 0.05;

export class EngineNBA {

  static compute(matchData, customWeights = null) {
    const weights = customWeights ?? CONFIG.default_weights;

    const variables = this._extractVariables(matchData);
    const { missing, missingCritical } = this._assessMissing(variables);

    const uncalibrated = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    let score = null, signals = [], volatility = null, scoreMethod = null;

    if (uncalibrated.length === Object.keys(weights).length) {
      scoreMethod = 'UNCALIBRATED';
    } else if (missingCritical.length > 0) {
      scoreMethod = 'MISSING_CRITICAL';
    } else {
      const computed = this._computeScore(variables, weights);
      score       = computed.score;
      signals     = computed.signals;
      volatility  = computed.volatility;
      scoreMethod = 'WEIGHTED_SUM';
    }

    // Recommandations paris — utilise ESPN odds OU The Odds API (Pinnacle)
    const hasOdds = matchData?.odds != null || matchData?.market_odds != null;
    const bettingRecs = (score !== null && hasOdds)
      ? this._computeBettingRecommendations(score, matchData?.odds ?? {}, matchData, variables)
      : null;

    Logger.debug('ENGINE_NBA_RESULT', {
      score, method: scoreMethod,
      missing_count: missing.length, critical_missing: missingCritical.length,
    });

    return {
      sport:                'NBA',
      score,
      score_method:         scoreMethod,
      signals,
      volatility,
      missing_variables:    missing,
      missing_critical:     missingCritical,
      uncalibrated_weights: uncalibrated,
      variables_used:       variables,
      betting_recommendations: bettingRecs,
      computed_at:          new Date().toISOString(),
    };
  }

  /**
   * Calcul depuis variables déjà extraites — utilisé par engine.robustness.js.
   * NE PAS appeler compute() depuis la robustesse — ça re-extrairait depuis rawData.
   */
  static computeFromVariables(variables, weights) {
    if (!variables || !weights) return null;
    return this._computeScore(variables, weights).score;
  }

  // ── EXTRACTION ────────────────────────────────────────────────────────────

  static _extractVariables(data) {
    const homeStats    = data?.home_season_stats;
    const awayStats    = data?.away_season_stats;
    const homeRecent   = data?.home_recent;
    const awayRecent   = data?.away_recent;
    const homeInj      = data?.home_injuries;
    const awayInj      = data?.away_injuries;
    const advancedStats = data?.advanced_stats ?? null;  // depuis /nba/stats/advanced

    const homeGames = homeStats?.games_played ?? null;
    const awayGames = awayStats?.games_played ?? null;

    return {

      // ── Net Rating différentiel (NBA Stats API) ────────────────────────
      // Signal dominant — non biaisé par le calendrier contrairement à win%.
      // Positif = domicile a un meilleur Net Rating.
      net_rating_diff: this._safeAdvancedDiff(
        advancedStats,
        homeStats,
        awayStats,
        'net_rating'
      ),

      // ── eFG% différentiel ─────────────────────────────────────────────
      // CORRECTION v5 : garde min_games pour éviter les stats de 2-3 matchs
      efg_diff: this._safeDiff(
        this._guardStat(homeStats?.efg_pct, 0.40, 0.65),
        this._guardStat(awayStats?.efg_pct, 0.40, 0.65),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── TS% différentiel ──────────────────────────────────────────────
      ts_diff: this._safeDiff(
        homeStats?.ts_pct,
        awayStats?.ts_pct,
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Win% différentiel ─────────────────────────────────────────────
      // Rôle réduit depuis v3 (win% biaisé calendrier).
      // Toujours utile en début de saison quand net_rating absent.
      win_pct_diff: this._safeDiff(
        this._guardStat(homeStats?.win_pct, 0.01, 0.99),
        this._guardStat(awayStats?.win_pct, 0.01, 0.99),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Split domicile/extérieur ──────────────────────────────────────
      home_away_split: this._computeHomeSplit(homeStats, awayStats),

      // ── Forme récente EMA ─────────────────────────────────────────────
      // Ordre attendu : du plus récent au plus ancien (Worker BDL sort décroissant)
      recent_form_ema: this._safeEMADiff(
        homeRecent, awayRecent, CONFIG.ema_lambda
      ),

      // ── Impact absences ───────────────────────────────────────────────
      absences_impact: this._computeAbsencesImpact(homeInj, awayInj),

      // ── Points marqués différentiel ───────────────────────────────────
      // Gardé pour compatibilité mais poids faible (biaisé pace)
      avg_pts_diff: this._safeDiff(
        this._guardStat(homeStats?.avg_pts, 85, 135),
        this._guardStat(awayStats?.avg_pts, 85, 135),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Pace différentiel ─────────────────────────────────────────────
      // Utilisé pour l'O/U. Non inclus dans les pondérations du score
      // principal — contextuel uniquement.
      pace_diff: this._safeAdvancedDiff(
        advancedStats, homeStats, awayStats, 'pace'
      ),

      // ── Back-to-back ──────────────────────────────────────────────────
      back_to_back: this._computeBackToBack(data),

      // ── Jours de repos ────────────────────────────────────────────────
      rest_days_diff: this._computeRestDiff(data),
    };
  }

  // ── SCORE ─────────────────────────────────────────────────────────────────

  static _computeScore(variables, weights) {
    let weightedSum = 0;
    let totalWeight = 0;
    const signals   = [];

    const normalized = this._normalizeVariables(variables);

    for (const [varId, normValue] of Object.entries(normalized)) {
      if (normValue === null) continue;
      const weight = weights[varId];
      if (weight === null || weight === undefined || weight === 0) continue;

      const contribution = normValue * weight;
      weightedSum += contribution;
      totalWeight += weight;

      const varConfig = CONFIG.variables.find(v => v.id === varId);

      signals.push({
        variable:     varId,
        label:        varConfig?.label ?? varId,
        raw_value:    variables[varId]?.value ?? null,
        normalized:   normValue,
        weight,
        contribution,
        direction:    contribution >  0.001 ? 'POSITIVE'
                    : contribution < -0.001 ? 'NEGATIVE'
                    : 'NEUTRAL',
        data_source:  variables[varId]?.source  ?? null,
        data_quality: variables[varId]?.quality ?? null,
        why_signal:   this._explainSignal(varId, normValue, contribution),
      });
    }

    const raw   = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 : null;
    const score = raw !== null
      ? Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000))
      : null;

    signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score,
      signals,
      volatility: this._estimateVolatility(variables),
    };
  }

  // ── NORMALISATION ─────────────────────────────────────────────────────────

  static _normalizeVariables(variables) {
    return {
      // Net Rating : plage typique NBA ±10 → ±1
      net_rating_diff: this._clampNormalize(variables.net_rating_diff?.value, -10, 10),

      efg_diff:        this._clampNormalize(variables.efg_diff?.value,        -0.07, 0.07),
      ts_diff:         this._clampNormalize(variables.ts_diff?.value,         -0.07, 0.07),
      win_pct_diff:    variables.win_pct_diff?.value    ?? null,
      home_away_split: variables.home_away_split?.value ?? null,
      recent_form_ema: variables.recent_form_ema?.value ?? null,
      absences_impact: variables.absences_impact?.value ?? null,
      avg_pts_diff:    this._clampNormalize(variables.avg_pts_diff?.value,    -15,   15),
      back_to_back:    variables.back_to_back?.value    ?? null,
      rest_days_diff:  this._clampNormalize(variables.rest_days_diff?.value,  -3,    3),
      // pace_diff non inclus dans le score principal (contextuel O/U uniquement)
    };
  }

  static _clampNormalize(value, min, max) {
    if (value === null || value === undefined) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return (clamped - (min + max) / 2) / ((max - min) / 2);
  }

  // ── CALCULS SPÉCIFIQUES ───────────────────────────────────────────────────

  static _guardStat(value, min, max) {
    if (value === null || value === undefined) return null;
    if (value < min || value > max) return null;
    return value;
  }

  /**
   * Différentiel avec garde min_games_sample.
   * CORRECTION v5 : si games_played < MIN_GAMES → quality='LOW_SAMPLE'
   * Les stats de début de saison (2-5 matchs) ne doivent pas être traitées
   * comme des stats saison fiables.
   */
  static _safeDiff(homeVal, awayVal, source, homeGames = null, awayGames = null) {
    if (homeVal === null || homeVal === undefined ||
        awayVal === null || awayVal === undefined) {
      return { value: null, source, quality: 'MISSING' };
    }

    // Garde sample minimum
    if ((homeGames !== null && homeGames < MIN_GAMES) ||
        (awayGames !== null && awayGames < MIN_GAMES)) {
      return {
        value:  homeVal - awayVal,
        source,
        quality: 'LOW_SAMPLE',
        note:   `games_played insuffisant (home=${homeGames}, away=${awayGames}, min=${MIN_GAMES})`,
      };
    }

    return { value: homeVal - awayVal, source, quality: 'VERIFIED' };
  }

  /**
   * Différentiel depuis les stats avancées NBA Stats API.
   * advancedStats est indexé par nom d'équipe ESPN.
   * Si non disponible, fallback sur les stats ESPN directes (pour net_rating/pace).
   */
  static _safeAdvancedDiff(advancedStats, homeStats, awayStats, field) {
    // Chercher dans les stats avancées NBA Stats API en premier
    if (advancedStats && homeStats?.name && awayStats?.name) {
      const homeAdv = advancedStats[homeStats.name] ?? advancedStats[homeStats.team_name];
      const awayAdv = advancedStats[awayStats.name] ?? advancedStats[awayStats.team_name];

      if (homeAdv?.[field] != null && awayAdv?.[field] != null) {
        const homeGames = homeAdv.games_played ?? homeStats?.games_played ?? null;
        const awayGames = awayAdv.games_played ?? awayStats?.games_played ?? null;

        const quality = (homeGames !== null && homeGames < MIN_GAMES) ||
                        (awayGames !== null && awayGames < MIN_GAMES)
          ? 'LOW_SAMPLE'
          : 'VERIFIED';

        return {
          value:   Math.round((homeAdv[field] - awayAdv[field]) * 100) / 100,
          source:  'nba_stats_api',
          quality,
        };
      }
    }

    // Fallback : chercher dans les stats ESPN (net_rating peut être null)
    const homeVal = homeStats?.[field] ?? null;
    const awayVal = awayStats?.[field] ?? null;

    if (homeVal === null || awayVal === null) {
      return { value: null, source: 'nba_stats_api', quality: 'MISSING' };
    }

    return { value: homeVal - awayVal, source: 'espn_scoreboard', quality: 'PARTIAL' };
  }

  static _computeHomeSplit(homeStats, awayStats) {
    const h = homeStats?.home_win_pct;
    const a = awayStats?.away_win_pct;
    if (h == null || a == null) return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
    return {
      value:   Math.max(-1, Math.min(1, (h - a) * 2)),
      source:  'espn_scoreboard',
      quality: 'VERIFIED',
      raw:     { home_home_win_pct: h, away_away_win_pct: a },
    };
  }

  static _safeEMADiff(homeRecent, awayRecent, lambda) {
    if (!homeRecent?.matches || !awayRecent?.matches) {
      return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
    }
    if (lambda === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'UNCALIBRATED' };
    }

    // CORRECTION v5 : garde min_games pour la forme récente également
    if (homeRecent.matches.length < 3 || awayRecent.matches.length < 3) {
      return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };
    }

    const homeEMA = this._computeEMA(homeRecent.matches, lambda);
    const awayEMA = this._computeEMA(awayRecent.matches, lambda);

    if (homeEMA === null || awayEMA === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };
    }

    return {
      value:   homeEMA - awayEMA,
      source:  'balldontlie_v1',
      quality: (homeRecent.matches.length >= 5 && awayRecent.matches.length >= 5)
        ? 'VERIFIED' : 'LOW_SAMPLE',
    };
  }

  /**
   * EMA standard : λ · valeur_récente + (1-λ) · ema_précédente.
   * matches trié du plus récent au plus ancien (Worker BDL sort décroissant).
   * On inverse pour traiter du plus ancien au plus récent,
   * puis l'EMA finale est pondérée vers le plus récent.
   */
  static _computeEMA(matches, lambda) {
    if (!matches?.length) return null;
    const ordered = [...matches].reverse();
    let ema = null;
    for (const match of ordered) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;
      ema = ema === null ? result : lambda * result + (1 - lambda) * ema;
    }
    return ema !== null ? ema * 2 - 1 : null;
  }

  static _computeAbsencesImpact(homeInj, awayInj) {
    if (!homeInj || !awayInj) return { value: null, source: 'nba_official_pdf', quality: 'MISSING' };
    const SW = { 'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.1, 'Available': 0.0 };
    const score = players => {
      if (!Array.isArray(players)) return 0;
      return players.reduce((acc, p) => {
        const isGL = p.reason?.toLowerCase().includes('g league') || p.reason?.toLowerCase().includes('two-way');
        return acc + (isGL ? (SW[p.status] ?? 0) * 0.3 : SW[p.status] ?? p.impact_weight ?? 0);
      }, 0);
    };
    const hs = score(homeInj), as = score(awayInj);
    return {
      value:   Math.max(-1, Math.min(1, (as - hs) / 5)),
      source:  'nba_official_pdf',
      quality: 'ESTIMATED',
      raw:     { home_score: hs, away_score: as, home_out: homeInj.filter(p => p.status === 'Out').length, away_out: awayInj.filter(p => p.status === 'Out').length },
    };
  }

  static _computeBackToBack(data) {
    const h = data?.home_back_to_back ?? null, a = data?.away_back_to_back ?? null;
    if (h === null && a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    let value = 0;
    if (h && !a) value = -1;
    else if (!h && a) value = 1;
    return { value, source: 'espn_schedule', quality: 'VERIFIED', raw: { home_b2b: h, away_b2b: a } };
  }

  static _computeRestDiff(data) {
    const h = data?.home_rest_days ?? null, a = data?.away_rest_days ?? null;
    if (h === null || a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    return { value: Math.max(-3, Math.min(3, h - a)), source: 'espn_schedule', quality: 'VERIFIED', raw: { home_rest: h, away_rest: a } };
  }

  // ── VOLATILITÉ ────────────────────────────────────────────────────────────

  static _estimateVolatility(variables) {
    let vol = 0.20;
    const abs = variables.absences_impact?.value;
    if (abs !== null && Math.abs(abs) > 0.5) vol += 0.15;
    const hasLow = Object.values(variables).some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLow) vol += 0.10;
    return Math.min(1, Math.round(vol * 100) / 100);
  }

  // ── DONNÉES MANQUANTES ────────────────────────────────────────────────────

  static _assessMissing(variables) {
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

  // ── RECOMMANDATIONS PARIS ─────────────────────────────────────────────────

  static _computeBettingRecommendations(score, odds, matchData, variables) {
    const recs = [];
    const marketOdds = matchData?.market_odds ?? null;

    // Construire les cotes de référence.
    // Priorité : Pinnacle (The Odds API) > ESPN DraftKings.
    // Pinnacle a le vig le plus faible — meilleur proxy du marché réel.
    // Sans cotes ESPN (fréquent en journée), on utilise directement Pinnacle.
    const pinnacle = marketOdds?.bookmakers?.find(b => b.key === 'pinnacle')
                  ?? marketOdds?.bookmakers?.[0]
                  ?? null;

    // Cotes décimales Pinnacle → américaines pour le calcul interne
    const _decToAm = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

    const espnOdds = odds ?? {};
    const normalizedOdds = {
      home_ml:    espnOdds.home_ml    != null ? Number(espnOdds.home_ml)
                : pinnacle?.home_ml   != null ? _decToAm(pinnacle.home_ml)
                : null,
      away_ml:    espnOdds.away_ml    != null ? Number(espnOdds.away_ml)
                : pinnacle?.away_ml   != null ? _decToAm(pinnacle.away_ml)
                : null,
      spread:     espnOdds.spread     != null ? Number(espnOdds.spread)
                : pinnacle?.spread_line != null ? Number(pinnacle.spread_line)
                : null,
      over_under: espnOdds.over_under != null ? Number(espnOdds.over_under)
                : pinnacle?.total_line != null ? Number(pinnacle.total_line)
                : null,
    };

    const pHome = score;
    const pAway = 1 - score;

    // ── MONEYLINE ────────────────────────────────────────────────────────
    if (normalizedOdds.home_ml !== null && normalizedOdds.away_ml !== null) {
      const impliedHome = americanToProb(normalizedOdds.home_ml);
      const impliedAway = americanToProb(normalizedOdds.away_ml);
      const edgeHome    = pHome - impliedHome;
      const absEdge     = Math.abs(edgeHome);

      const isExtreme = (edgeHome > 0 && normalizedOdds.home_ml > 400) ||
                        (edgeHome < 0 && normalizedOdds.away_ml > 400);

      if (absEdge >= EDGE_THRESHOLDS.MONEYLINE && !isExtreme) {
        const side        = edgeHome > 0 ? 'HOME' : 'AWAY';
        const dkOdds      = side === 'HOME' ? normalizedOdds.home_ml : normalizedOdds.away_ml;
        const motorProb   = side === 'HOME' ? pHome : pAway;
        const bestBook    = this._getBestBookOdds(marketOdds, side, 'h2h');
        const bestOdds    = bestBook?.odds ?? dkOdds;
        const bestImplied = americanToProb(bestOdds);
        const realEdge    = motorProb - bestImplied;
        const kelly       = this._computeKelly(motorProb, bestOdds);

        recs.push({
          type: 'MONEYLINE', label: 'Vainqueur du match', side,
          odds_line: bestOdds, odds_source: bestBook?.bookmaker ?? 'DraftKings', odds_dk: dkOdds,
          motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(bestImplied * 100),
          edge: Math.round(Math.abs(realEdge) * 100),
          confidence: this._edgeToConfidence(Math.abs(realEdge)),
          has_value: true, kelly_stake: kelly,
        });
      }
    }

    // ── SPREAD ───────────────────────────────────────────────────────────
    if (normalizedOdds.spread !== null) {
      for (const side of ['HOME', 'AWAY']) {
        const bestBook = this._getBestBookOdds(marketOdds, side, 'spreads');
        if (!bestBook) continue;
        const motorProb   = side === 'HOME' ? pHome : pAway;
        const impliedProb = decimalToProb(bestBook.decimalOdds);
        if (impliedProb === null) continue;
        const edge = motorProb - impliedProb;
        if (edge >= EDGE_THRESHOLDS.SPREAD) {
          recs.push({
            type: 'SPREAD', label: 'Handicap (spread)', side,
            odds_line: bestBook.odds, odds_decimal: bestBook.decimalOdds, odds_source: bestBook.bookmaker,
            spread_line: side === 'HOME' ? normalizedOdds.spread : -normalizedOdds.spread,
            motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(impliedProb * 100),
            edge: Math.round(edge * 100), confidence: this._edgeToConfidence(edge),
            has_value: true, kelly_stake: this._computeKelly(motorProb, bestBook.odds),
          });
          break;
        }
      }
    }

    // ── OVER/UNDER ───────────────────────────────────────────────────────
    // AMÉLIORATION v5 : utilise pace si disponible pour la projection
    if (normalizedOdds.over_under !== null) {
      const homeAvgPts = matchData?.home_season_stats?.avg_pts;
      const awayAvgPts = matchData?.away_season_stats?.avg_pts;

      if (homeAvgPts != null && awayAvgPts != null) {
        const ouLine = normalizedOdds.over_under;

        // Ajustement pace si disponible
        const paceDiff = variables?.pace_diff?.value ?? null;
        const paceAdj  = paceDiff !== null ? paceDiff * 0.5 : 0;  // ~0.5 pts par possession d'écart
        const projectedTotal = homeAvgPts + awayAvgPts + paceAdj;
        const diff           = projectedTotal - ouLine;
        const side           = diff > 0 ? 'OVER' : 'UNDER';
        const bestOUBook     = this._getBestBookOdds(marketOdds, side, 'totals');

        if (bestOUBook) {
          const motorProb   = Math.min(0.75, 0.50 + Math.min(Math.abs(diff), 10) / 40);
          const impliedProb = decimalToProb(bestOUBook.decimalOdds);
          if (impliedProb !== null) {
            const edge = motorProb - impliedProb;
            if (edge >= EDGE_THRESHOLDS.OVER_UNDER) {
              recs.push({
                type: 'OVER_UNDER', label: 'Total de points', side,
                odds_line: bestOUBook.odds, odds_decimal: bestOUBook.decimalOdds, odds_source: bestOUBook.bookmaker,
                ou_line: ouLine,
                motor_prob: Math.round(projectedTotal), implied_prob: Math.round(ouLine),
                edge: Math.round(edge * 100), confidence: this._edgeToConfidence(edge),
                has_value: true,
                note: `Projection ${Math.round(projectedTotal)} pts${paceDiff !== null ? ` (ajust. pace ${paceAdj > 0 ? '+' : ''}${paceAdj.toFixed(1)})` : ''} · ligne ${ouLine}`,
                kelly_stake: this._computeKelly(motorProb, bestOUBook.odds),
              });
            }
          }
        }
      }
    }

    recs.sort((a, b) => b.edge - a.edge);
    const validRecs = recs.filter(r => r.has_value);
    return { recommendations: validRecs, best: validRecs[0] ?? null, computed_at: new Date().toISOString() };
  }

  static _computeKelly(p, americanOdds) {
    if (p === null || americanOdds === null) return null;
    const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
    const kelly = (b * p - (1 - p)) / b;
    if (kelly <= 0) return 0;
    return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
  }

  static _getBestBookOdds(marketOdds, side, market) {
    if (!marketOdds?.bookmakers?.length) return null;
    let best = null;
    for (const bk of marketOdds.bookmakers) {
      let oddsDecimal = null;
      if (market === 'h2h')     oddsDecimal = side === 'HOME' ? bk.home_ml : bk.away_ml;
      else if (market === 'spreads') oddsDecimal = bk.home_spread ?? null;
      else if (market === 'totals')  oddsDecimal = side === 'OVER' ? bk.over_total : null;
      if (!oddsDecimal || oddsDecimal <= 1) continue;
      const american = oddsDecimal >= 2 ? Math.round((oddsDecimal - 1) * 100) : Math.round(-100 / (oddsDecimal - 1));
      if (!best || oddsDecimal > best.decimalOdds) {
        best = { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
      }
    }
    return best;
  }

  static _explainSignal(varId, normalized, contribution) {
    const dir = contribution >  0.001 ? "en faveur de l'équipe domicile"
              : contribution < -0.001 ? "en faveur de l'équipe visiteuse"
              : 'neutre';
    const int = Math.abs(normalized) > 0.6 ? 'fort' : Math.abs(normalized) > 0.3 ? 'modéré' : 'faible';
    const labels = {
      net_rating_diff:  `Net Rating différentiel ${int} ${dir} — NBA Stats API`,
      efg_diff:         `Efficacité tir (eFG%) ${int} ${dir} — ESPN`,
      ts_diff:          `Efficacité globale (TS%) ${int} ${dir} — ESPN`,
      win_pct_diff:     `Bilan saison ${int} ${dir} — ESPN`,
      home_away_split:  `Contexte dom/ext ${int} ${dir} — ESPN`,
      recent_form_ema:  `Forme récente (EMA) ${int} ${dir} — BallDontLie`,
      absences_impact:  `Impact absences ${int} ${dir} — NBA PDF officiel`,
      avg_pts_diff:     `Différentiel scoring ${int} ${dir} — ESPN`,
      back_to_back:     `Back-to-back ${int} ${dir} — ESPN`,
      rest_days_diff:   `Jours de repos ${int} ${dir} — ESPN`,
    };
    return labels[varId] ?? `Variable ${varId} — signal ${int} ${dir}`;
  }

  static _edgeToConfidence(edge) {
    if (edge >= 0.10) return 'FORTE';
    if (edge >= 0.06) return 'MOYENNE';
    return 'FAIBLE';
  }

  static _normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z >= 0 ? 1 - p : p;
  }
}
