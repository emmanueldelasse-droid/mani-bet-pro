/**
 * MANI BET PRO — engine.nba.js v4
 *
 * Moteur analytique NBA.
 * Variables calculées depuis ESPN (eFG%, TS%, win%, splits) + BallDontLie + injuries PDF NBA.
 *
 * Convention : valeur positive = avantage équipe domicile.
 *
 * Sources :
 *   ESPN scoreboard → eFG%, TS%, win_pct, home_win_pct, away_win_pct, avg_pts
 *   BallDontLie v1  → forme récente W/L (EMA)
 *   PDF NBA officiel → absences (Out, Questionable, Doubtful, Probable)
 *
 * CORRECTIONS v4 :
 *   - Score clampé sur [0,1] (dépassement possible en v3)
 *   - Bug O/U : return → structure if/else (toutes les recs perdues si pas de cote totals)
 *   - EMA : algorithme standard λ · ema + (1-λ) · result, ordre matchs documenté
 *   - Pondérations lues depuis sports.config.js uniquement (WEIGHTS_V2 supprimé)
 *   - computeFromVariables() exposé pour engine.robustness.js
 */

import { SPORTS_CONFIG }                   from '../config/sports.config.js';
import { americanToProb, decimalToProb }   from '../utils/utils.odds.js';
import { Logger }                          from '../utils/utils.logger.js';

const CONFIG = SPORTS_CONFIG.NBA;

// Seuils edge minimum (en fraction, pas en %)
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.05,
  SPREAD:     0.03,
  OVER_UNDER: 0.03,
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION = 0.25;
const KELLY_MAX_PCT  = 0.05;

export class EngineNBA {

  /**
   * Point d'entrée principal.
   * Les pondérations viennent exclusivement de sports.config.js
   * (ou d'un customWeights passé par le laboratoire).
   *
   * @param {NBAMatchData} matchData
   * @param {object|null} customWeights — pondérations personnalisées (simulateur labo)
   * @returns {NBAEngineResult}
   */
  static compute(matchData, customWeights = null) {
    // Source unique de vérité pour les pondérations
    const weights = customWeights ?? CONFIG.default_weights;

    // 1. Extraire les variables depuis les données ESPN + BDL + injuries
    const variables = this._extractVariables(matchData);

    // 2. Identifier les données manquantes
    const { missing, missingCritical } = this._assessMissing(variables);

    // 3. Vérifier si les poids sont calibrés (tous null = non calibré)
    const uncalibrated = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    // 4. Calculer le score
    let score       = null;
    let signals     = [];
    let volatility  = null;
    let scoreMethod = null;

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

    // 5. Recommandations paris (value betting)
    const bettingRecs = (score !== null && matchData?.odds)
      ? this._computeBettingRecommendations(score, matchData.odds, matchData)
      : null;

    const result = {
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

    Logger.debug('ENGINE_NBA_RESULT', {
      score,
      method:           scoreMethod,
      missing_count:    missing.length,
      critical_missing: missingCritical.length,
    });

    return result;
  }

  /**
   * Calcule uniquement le score depuis des variables déjà extraites.
   * Utilisé par engine.robustness.js pour les perturbations — évite
   * de ré-extraire depuis les données brutes à chaque perturbation.
   *
   * @param {object} variables — variables_used d'un résultat précédent
   * @param {object} weights
   * @returns {number|null}
   */
  static computeFromVariables(variables, weights) {
    if (!variables || !weights) return null;
    const result = this._computeScore(variables, weights);
    return result.score;
  }

  // ── EXTRACTION DES VARIABLES ───────────────────────────────────────────

  static _extractVariables(data) {
    const homeStats  = data?.home_season_stats;
    const awayStats  = data?.away_season_stats;
    const homeRecent = data?.home_recent;
    const awayRecent = data?.away_recent;
    const homeInj    = data?.home_injuries;
    const awayInj    = data?.away_injuries;

    return {

      // eFG% différentiel — garde-fou plage réaliste ESPN
      efg_diff: this._safeDiff(
        this._guardStat(homeStats?.efg_pct, 0.40, 0.65),
        this._guardStat(awayStats?.efg_pct, 0.40, 0.65),
        'espn_scoreboard'
      ),

      // TS% différentiel
      ts_diff: this._safeDiff(
        homeStats?.ts_pct,
        awayStats?.ts_pct,
        'espn_scoreboard'
      ),

      // Win% différentiel (saison complète)
      // Garde-fou : win% = 0 ou 1 ignoré (trop peu de matchs)
      win_pct_diff: this._safeDiff(
        this._guardStat(homeStats?.win_pct, 0.01, 0.99),
        this._guardStat(awayStats?.win_pct, 0.01, 0.99),
        'espn_scoreboard'
      ),

      // Split domicile/extérieur contextualisé
      home_away_split: this._computeHomeSplit(homeStats, awayStats),

      // Forme récente EMA — ordre attendu : du plus récent au plus ancien
      recent_form_ema: this._safeEMADiff(
        homeRecent,
        awayRecent,
        CONFIG.ema_lambda
      ),

      // Impact absences (PDF NBA officiel)
      absences_impact: this._computeAbsencesImpact(homeInj, awayInj),

      // Points marqués différentiel — garde-fou plage réaliste
      avg_pts_diff: this._safeDiff(
        this._guardStat(homeStats?.avg_pts, 85, 135),
        this._guardStat(awayStats?.avg_pts, 85, 135),
        'espn_scoreboard'
      ),

      // Back-to-back detection (ESPN schedule si disponible)
      back_to_back: this._computeBackToBack(data),

      // Différentiel jours de repos
      rest_days_diff: this._computeRestDiff(data),
    };
  }

  // ── CALCUL DU SCORE ────────────────────────────────────────────────────

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
      weightedSum  += contribution;
      totalWeight  += weight;

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

    // CORRECTION : clamp sur [0,1] — le score peut théoriquement dépasser
    // [0,1] si plusieurs variables sont proches de ±1 simultanément
    const raw = totalWeight > 0
      ? (weightedSum / totalWeight + 1) / 2
      : null;

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

  // ── NORMALISATION SUR [-1, +1] ─────────────────────────────────────────

  static _normalizeVariables(variables) {
    return {
      efg_diff:        this._clampNormalize(variables.efg_diff?.value, -0.07, 0.07),
      ts_diff:         this._clampNormalize(variables.ts_diff?.value, -0.07, 0.07),
      win_pct_diff:    variables.win_pct_diff?.value ?? null,
      home_away_split: variables.home_away_split?.value ?? null,
      recent_form_ema: variables.recent_form_ema?.value ?? null,
      absences_impact: variables.absences_impact?.value ?? null,
      avg_pts_diff:    this._clampNormalize(variables.avg_pts_diff?.value, -15, 15),
      back_to_back:    variables.back_to_back?.value ?? null,
      rest_days_diff:  this._clampNormalize(variables.rest_days_diff?.value, -3, 3),
    };
  }

  static _clampNormalize(value, min, max) {
    if (value === null || value === undefined) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return (clamped - (min + max) / 2) / ((max - min) / 2);
  }

  // ── CALCULS SPÉCIFIQUES ────────────────────────────────────────────────

  static _guardStat(value, min, max) {
    if (value === null || value === undefined) return null;
    if (value < min || value > max) return null;
    return value;
  }

  static _safeDiff(homeVal, awayVal, source) {
    if (homeVal === null || homeVal === undefined ||
        awayVal === null || awayVal === undefined) {
      return { value: null, source, quality: 'MISSING' };
    }
    return { value: homeVal - awayVal, source, quality: 'VERIFIED' };
  }

  static _computeHomeSplit(homeStats, awayStats) {
    const homeWinPct = homeStats?.home_win_pct;
    const awayWinPct = awayStats?.away_win_pct;

    if (homeWinPct == null || awayWinPct == null) {
      return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
    }

    return {
      value:   Math.max(-1, Math.min(1, (homeWinPct - awayWinPct) * 2)),
      source:  'espn_scoreboard',
      quality: 'VERIFIED',
      raw:     { home_home_win_pct: homeWinPct, away_away_win_pct: awayWinPct },
    };
  }

  static _safeEMADiff(homeRecent, awayRecent, lambda) {
    if (!homeRecent?.matches || !awayRecent?.matches) {
      return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
    }
    if (lambda === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'UNCALIBRATED' };
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
   * EMA standard : λ · valeur_récente + (1-λ) · ema_précédente
   *
   * IMPORTANT : matches doit être trié du plus récent au plus ancien.
   * BallDontLie retourne les matchs dans cet ordre par défaut.
   * Le premier match du tableau reçoit le poids le plus élevé.
   *
   * @param {Array} matches — triés du plus récent au plus ancien
   * @param {number} lambda — [0,1], proche de 1 = mémoire courte
   * @returns {number|null} — dans [-1, +1]
   */
  static _computeEMA(matches, lambda) {
    if (!matches?.length) return null;

    // Inverser pour traiter du plus ancien au plus récent,
    // puis l'EMA finale sera pondérée vers le plus récent
    const ordered = [...matches].reverse();
    let ema = null;

    for (const match of ordered) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;
      ema = ema === null
        ? result
        : lambda * result + (1 - lambda) * ema;
    }

    // Convertir [0,1] → [-1, +1]
    return ema !== null ? ema * 2 - 1 : null;
  }

  /**
   * Impact des absences depuis le PDF NBA officiel.
   * Pondération par statut sans USG% (qualité = ESTIMATED).
   * Positif = équipe visiteuse plus touchée = avantage domicile.
   */
  static _computeAbsencesImpact(homeInjuries, awayInjuries) {
    if (!homeInjuries || !awayInjuries) {
      return { value: null, source: 'nba_official_pdf', quality: 'MISSING' };
    }

    const STATUS_WEIGHTS = {
      'Out':          1.0,
      'Doubtful':     0.75,
      'Questionable': 0.5,
      'Probable':     0.1,
      'Available':    0.0,
    };

    const scoreTeam = (players) => {
      if (!Array.isArray(players)) return 0;
      return players.reduce((acc, p) => {
        const isGLeague = p.reason?.toLowerCase().includes('g league') ||
                          p.reason?.toLowerCase().includes('two-way');
        const base = STATUS_WEIGHTS[p.status] ?? p.impact_weight ?? 0;
        return acc + (isGLeague ? base * 0.3 : base);
      }, 0);
    };

    const homeScore  = scoreTeam(homeInjuries);
    const awayScore  = scoreTeam(awayInjuries);
    const normalized = Math.max(-1, Math.min(1, (awayScore - homeScore) / 5));

    return {
      value:   normalized,
      source:  'nba_official_pdf',
      quality: 'ESTIMATED',   // Sans USG%, estimation uniquement
      raw: {
        home_score: homeScore,
        away_score: awayScore,
        home_out:   homeInjuries.filter(p => p.status === 'Out').length,
        away_out:   awayInjuries.filter(p => p.status === 'Out').length,
      },
    };
  }

  static _computeBackToBack(data) {
    const homeB2B = data?.home_back_to_back ?? null;
    const awayB2B = data?.away_back_to_back ?? null;

    if (homeB2B === null && awayB2B === null) {
      return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    }

    let value = 0;
    if (homeB2B && !awayB2B) value = -1;
    else if (!homeB2B && awayB2B) value = 1;

    return {
      value,
      source:  'espn_schedule',
      quality: 'VERIFIED',
      raw:     { home_b2b: homeB2B, away_b2b: awayB2B },
    };
  }

  static _computeRestDiff(data) {
    const homeRest = data?.home_rest_days ?? null;
    const awayRest = data?.away_rest_days ?? null;

    if (homeRest === null || awayRest === null) {
      return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    }

    return {
      value:   Math.max(-3, Math.min(3, homeRest - awayRest)),
      source:  'espn_schedule',
      quality: 'VERIFIED',
      raw:     { home_rest: homeRest, away_rest: awayRest },
    };
  }

  // ── VOLATILITÉ ─────────────────────────────────────────────────────────

  static _estimateVolatility(variables) {
    let vol = 0.20;  // Base NBA = faible bruit intrinsèque

    const abs = variables.absences_impact?.value;
    if (abs !== null && Math.abs(abs) > 0.5) vol += 0.15;

    const hasLowQuality = Object.values(variables)
      .some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLowQuality) vol += 0.10;

    return Math.min(1, Math.round(vol * 100) / 100);
  }

  // ── DONNÉES MANQUANTES ─────────────────────────────────────────────────

  static _assessMissing(variables) {
    const missing         = [];
    const missingCritical = [];

    for (const varConfig of CONFIG.variables) {
      const v         = variables[varConfig.id];
      const isMissing = !v || v.value === null || v.quality === 'MISSING';

      if (isMissing) {
        missing.push(varConfig.id);
        if (varConfig.critical) missingCritical.push(varConfig.id);
      }
    }

    return { missing, missingCritical };
  }

  // ── RECOMMANDATIONS PARIS ──────────────────────────────────────────────

  static _computeBettingRecommendations(score, odds, matchData) {
    const recs = [];

    // Normaliser les cotes (peuvent être des strings depuis ESPN)
    const normalizedOdds = {
      ...odds,
      home_ml:    odds.home_ml    !== null ? Number(odds.home_ml)    : null,
      away_ml:    odds.away_ml    !== null ? Number(odds.away_ml)    : null,
      spread:     odds.spread     !== null ? Number(odds.spread)     : null,
      over_under: odds.over_under !== null ? Number(odds.over_under) : null,
    };

    const pHome      = score;
    const pAway      = 1 - score;
    const marketOdds = matchData?.market_odds ?? null;

    // ── MONEYLINE ─────────────────────────────────────────────────────────
    if (normalizedOdds.home_ml !== null && normalizedOdds.away_ml !== null) {
      const impliedHome = americanToProb(normalizedOdds.home_ml);
      const impliedAway = americanToProb(normalizedOdds.away_ml);
      const edgeHome    = pHome - impliedHome;
      const edgeAway    = pAway - impliedAway;
      const absEdge     = Math.abs(edgeHome);

      const isExtremeOutsider =
        (edgeHome > 0 && normalizedOdds.home_ml > 400) ||
        (edgeHome < 0 && normalizedOdds.away_ml > 400);

      if (absEdge >= EDGE_THRESHOLDS.MONEYLINE && !isExtremeOutsider) {
        const side       = edgeHome > 0 ? 'HOME' : 'AWAY';
        const dkOdds     = side === 'HOME' ? normalizedOdds.home_ml : normalizedOdds.away_ml;
        const motorProb  = side === 'HOME' ? pHome : pAway;
        const bestBook   = this._getBestBookOdds(marketOdds, side, 'h2h');
        const bestOdds   = bestBook?.odds   ?? dkOdds;
        const bestSource = bestBook?.bookmaker ?? 'DraftKings';
        const bestImplied = americanToProb(bestOdds);
        const realEdge   = motorProb - bestImplied;
        const kelly      = this._computeKelly(motorProb, bestOdds);

        recs.push({
          type:         'MONEYLINE',
          label:        'Vainqueur du match',
          side,
          odds_line:    bestOdds,
          odds_source:  bestSource,
          odds_dk:      dkOdds,
          motor_prob:   Math.round(motorProb * 100),
          implied_prob: Math.round(bestImplied * 100),
          edge:         Math.round(Math.abs(realEdge) * 100),
          confidence:   this._edgeToConfidence(Math.abs(realEdge)),
          has_value:    true,
          kelly_stake:  kelly,
        });
      }
    }

    // ── SPREAD ────────────────────────────────────────────────────────────
    // Uniquement si vraie cote disponible depuis The Odds API.
    if (normalizedOdds.spread !== null) {
      const spread = normalizedOdds.spread;

      for (const side of ['HOME', 'AWAY']) {
        const bestBook = this._getBestBookOdds(marketOdds, side, 'spreads');
        if (!bestBook) continue;

        const motorProb   = side === 'HOME' ? pHome : pAway;
        const impliedProb = decimalToProb(bestBook.decimalOdds);
        if (impliedProb === null) continue;
        const edge = motorProb - impliedProb;

        if (edge >= EDGE_THRESHOLDS.SPREAD) {
          const spreadLine = side === 'HOME' ? spread : -spread;
          const kelly      = this._computeKelly(motorProb, bestBook.odds);

          recs.push({
            type:         'SPREAD',
            label:        'Handicap (spread)',
            side,
            odds_line:    bestBook.odds,
            odds_decimal: bestBook.decimalOdds,
            odds_source:  bestBook.bookmaker,
            spread_line:  spreadLine,   // Ligne de points — utilisée par paper.settler.js
            motor_prob:   Math.round(motorProb * 100),
            implied_prob: Math.round(impliedProb * 100),
            edge:         Math.round(edge * 100),
            confidence:   this._edgeToConfidence(edge),
            has_value:    true,
            kelly_stake:  kelly,
          });
          break; // Meilleur côté uniquement
        }
      }
    }

    // ── OVER/UNDER ────────────────────────────────────────────────────────
    // CORRECTION : if/else au lieu de return prématuré qui abandonnait
    // toutes les recommandations déjà calculées (Moneyline + Spread).
    // L'O/U est optionnel — son absence ne doit pas annuler les autres.
    if (normalizedOdds.over_under !== null) {
      const homeAvgPts = matchData?.home_season_stats?.avg_pts;
      const awayAvgPts = matchData?.away_season_stats?.avg_pts;

      if (homeAvgPts != null && awayAvgPts != null) {
        const projectedTotal = homeAvgPts + awayAvgPts;
        const ouLine         = normalizedOdds.over_under;
        const diff           = projectedTotal - ouLine;
        const side           = diff > 0 ? 'OVER' : 'UNDER';
        const bestOUBook     = this._getBestBookOdds(marketOdds, side, 'totals');

        // Pas de cote réelle → pas de recommandation O/U, mais on continue
        if (bestOUBook) {
          // NOTE : motorProb O/U est une approximation non calibrée.
          // avg_pts est biaisé par le pace — à remplacer par pace × possessions
          // quand NBA Stats API sera intégrée (Sprint 3).
          const motorProb = Math.min(0.75,
            0.50 + Math.min(Math.abs(diff), 10) / 40
          );
          const impliedProb = decimalToProb(bestOUBook.decimalOdds);
          if (impliedProb !== null) {
            const edge = motorProb - impliedProb;

            if (edge >= EDGE_THRESHOLDS.OVER_UNDER) {
              const kelly = this._computeKelly(motorProb, bestOUBook.odds);

              recs.push({
                type:         'OVER_UNDER',
                label:        'Total de points',
                side,
                odds_line:    bestOUBook.odds,
                odds_decimal: bestOUBook.decimalOdds,
                odds_source:  bestOUBook.bookmaker,
                ou_line:      ouLine,
                motor_prob:   Math.round(projectedTotal),
                implied_prob: Math.round(ouLine),
                edge:         Math.round(edge * 100),
                confidence:   this._edgeToConfidence(edge),
                has_value:    true,
                note:         `Approximation pace non intégrée — indicatif uniquement`,
                kelly_stake:  kelly,
              });
            }
          }
        }
      }
    }

    recs.sort((a, b) => b.edge - a.edge);
    const validRecs = recs.filter(r => r.has_value);

    return {
      recommendations: validRecs,
      best:            validRecs[0] ?? null,
      computed_at:     new Date().toISOString(),
    };
  }

  // ── KELLY CRITERION ────────────────────────────────────────────────────

  static _computeKelly(p, americanOdds) {
    if (p === null || americanOdds === null) return null;
    const b = americanOdds > 0
      ? americanOdds / 100
      : 100 / Math.abs(americanOdds);
    const q      = 1 - p;
    const kelly  = (b * p - q) / b;
    if (kelly <= 0) return 0;
    return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
  }

  // ── MEILLEURE COTE MULTI-BOOKS ─────────────────────────────────────────

  static _getBestBookOdds(marketOdds, side, market) {
    if (!marketOdds?.bookmakers?.length) return null;

    let best = null;

    for (const bk of marketOdds.bookmakers) {
      let oddsDecimal = null;

      if (market === 'h2h') {
        oddsDecimal = side === 'HOME' ? bk.home_ml : bk.away_ml;
      } else if (market === 'spreads') {
        oddsDecimal = bk.home_spread ?? null;
      } else if (market === 'totals') {
        oddsDecimal = side === 'OVER' ? bk.over_total : null;
      }

      if (!oddsDecimal || oddsDecimal <= 1) continue;

      const american = oddsDecimal >= 2
        ? Math.round((oddsDecimal - 1) * 100)
        : Math.round(-100 / (oddsDecimal - 1));

      if (!best || oddsDecimal > best.decimalOdds) {
        best = {
          odds:        american,
          decimalOdds: oddsDecimal,
          bookmaker:   bk.title ?? bk.key,
        };
      }
    }

    return best;
  }

  // ── EXPLICATIONS SIGNAUX ───────────────────────────────────────────────

  static _explainSignal(varId, normalized, contribution) {
    const direction = contribution >  0.001 ? "en faveur de l'équipe domicile"
                    : contribution < -0.001 ? "en faveur de l'équipe visiteuse"
                    : 'neutre';

    const intensity = Math.abs(normalized) > 0.6 ? 'fort'
                    : Math.abs(normalized) > 0.3 ? 'modéré'
                    : 'faible';

    const labels = {
      efg_diff:        `Efficacité de tir (eFG%) ${intensity} ${direction} — ESPN`,
      ts_diff:         `Efficacité globale (TS%) ${intensity} ${direction} — ESPN`,
      win_pct_diff:    `Bilan saison ${intensity} ${direction} — ESPN`,
      home_away_split: `Contexte dom/ext ${intensity} ${direction} — ESPN`,
      recent_form_ema: `Forme récente (EMA) ${intensity} ${direction} — BallDontLie`,
      absences_impact: `Impact absences ${intensity} ${direction} — NBA PDF officiel`,
      avg_pts_diff:    `Différentiel scoring ${intensity} ${direction} — ESPN`,
      back_to_back:    `Back-to-back ${intensity} ${direction} — ESPN`,
      rest_days_diff:  `Jours de repos ${intensity} ${direction} — ESPN`,
    };

    return labels[varId] ?? `Variable ${varId} — signal ${intensity} ${direction}`;
  }

  // ── EDGE → CONFIANCE ───────────────────────────────────────────────────

  static _edgeToConfidence(edge) {
    if (edge >= 0.10) return 'FORTE';
    if (edge >= 0.06) return 'MOYENNE';
    return 'FAIBLE';
  }

  // ── CDF NORMALE (pour usage futur spread calibré) ──────────────────────

  static _normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z >= 0 ? 1 - p : p;
  }
}
