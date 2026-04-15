/**
 * MANI BET PRO — engine.nba.js v5.14
 *
 * AJOUTS v5.14 — Calibration playoffs :
 *   - getNBAWeights() branché : poids, score_cap, ema_lambda et require_absences_confirmed
 *     sont maintenant déterminés automatiquement par la phase NBA (saison/playin/playoff).
 *   - ema_lambda playoff 0.92 passé à extractVariables() via matchData.__ema_lambda.
 *   - STAR_FACTOR playoff 2.0 et STAR_MAX_REDUCTION 0.55 passés à computeStarAbsenceModifier()
 *     via matchData.__playoff (flag phase).
 *   - score_cap playoff 0.80 appliqué après calcul (vs 0.90 saison régulière).
 *   - require_absences_confirmed playoff : INSUFFISANT si absences non confirmées.
 *   - nba_phase exposé dans le résultat pour l'UI (badge Play-In/Playoff).
 *
 * REFACTOR v5.13 :
 *   Découpe en 3 sous-modules pour améliorer la maintenabilité.
 *   Interface publique inchangée : compute() et computeFromVariables().
 */

import { SPORTS_CONFIG, getNBAWeights }   from '../config/sports.config.js';
import { Logger }                          from '../utils/utils.logger.js';
import {
  extractVariables,
  assessMissing,
  computeStarAbsenceModifier,
} from './engine.nba.variables.js';
import {
  computeScore,
} from './engine.nba.score.js';
import {
  computeBettingRecommendations,
  computeMarketDivergence,
  computeConfidencePenalty,
} from './engine.nba.betting.js';

const CONFIG = SPORTS_CONFIG.NBA;

export class EngineNBA {

  /**
   * Point d'entrée principal.
   * @param {object} matchData     — données normalisées par le provider/orchestrateur
   * @param {object|null} customWeights — pondérations personnalisées (laboratoire)
   * @returns {EngineResult}
   */
  static compute(matchData, customWeights = null) {
    // ── Phase NBA → poids + config adaptés ──────────────────────────────────
    const phaseConfig = getNBAWeights();
    const weights     = customWeights ?? phaseConfig.weights;
    const phase       = phaseConfig.phase;
    const isPlayoff   = phase === 'playin' || phase === 'playoff';
    const scoreCap    = phaseConfig.score_cap;
    const emaLambda   = phaseConfig.ema_lambda;

    // Injecter la config de phase dans matchData pour les sous-modules
    const enrichedData = Object.assign({}, matchData, {
      __ema_lambda: emaLambda,   // → extractVariables → safeEMADiff
      __playoff:    isPlayoff,   // → computeStarAbsenceModifier (STAR_FACTOR/MAX)
    });

    const variables = extractVariables(enrichedData);
    const { missing, missingCritical } = assessMissing(variables);

    // ── require_absences_confirmed en playoffs ───────────────────────────────
    if (isPlayoff && phaseConfig.require_absences_confirmed && !matchData?.absences_confirmed) {
      return {
        sport: 'NBA', score: null, score_method: 'MISSING_ABSENCES_PLAYOFF',
        signals: [], volatility: null, missing_variables: missing,
        missing_critical: missingCritical, uncalibrated_weights: [],
        variables_used: variables, weights_used: weights,
        star_absence_modifier: null, market_divergence: null,
        confidence_penalty: null, betting_recommendations: null,
        nba_phase: phase, computed_at: new Date().toISOString(),
        debug: { playoff_gate: 'absences_not_confirmed' },
      };
    }

    const uncalibrated = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    let score = null, signals = [], volatility = null, scoreMethod = null;
    let weightsUsed = { ...weights };
    let scoreDebug  = null;

    if (uncalibrated.length === Object.keys(weights).length) {
      scoreMethod = 'UNCALIBRATED';
    } else if (missingCritical.length > 0) {
      scoreMethod = 'MISSING_CRITICAL';
    } else {
      const computed = computeScore(variables, weights);
      score       = computed.score;
      signals     = computed.signals;
      volatility  = computed.volatility;
      weightsUsed = computed.weights_used ?? { ...weights };
      scoreDebug  = computed.debug ?? null;
      scoreMethod = computed.score_method ?? 'WEIGHTED_SUM';
    }

    // ── Modificateur star absence — facteurs renforcés en playoffs ───────────
    let starAbsenceModifier = null;
    if (score !== null) {
      starAbsenceModifier = computeStarAbsenceModifier(
        matchData?.home_injuries ?? null,
        matchData?.away_injuries ?? null,
        matchData?.home_season_stats?.avg_pts ?? null,
        matchData?.away_season_stats?.avg_pts ?? null,
        isPlayoff,   // ← STAR_FACTOR 2.0 + STAR_MAX_REDUCTION 0.55 si playoff
      );
      if (starAbsenceModifier !== null && starAbsenceModifier !== 1.0) {
        score = Math.max(0, Math.min(1, Math.round(score * starAbsenceModifier * 1000) / 1000));
        scoreMethod = isPlayoff ? 'WEIGHTED_SUM+STAR_MODIFIER_PLAYOFF' : 'WEIGHTED_SUM+STAR_MODIFIER';
      }
    }

    // ── Score cap par phase ──────────────────────────────────────────────────
    if (score !== null && score > scoreCap) {
      score = scoreCap;
    }

    const marketDivergence  = computeMarketDivergence(score, matchData);
    const confidencePenalty = computeConfidencePenalty(
      matchData?.home_injuries ?? null,
      matchData?.away_injuries ?? null,
      marketDivergence,
    );

    const hasOdds    = matchData?.odds != null || matchData?.market_odds != null;
    const bettingRecs = (score !== null && hasOdds)
      ? computeBettingRecommendations(score, matchData?.odds ?? {}, matchData, variables, signals, marketDivergence)
      : null;

    Logger.debug('ENGINE_NBA_RESULT', {
      score, method: scoreMethod, phase,
      score_cap: scoreCap, ema_lambda: emaLambda,
      missing_count: missing.length, critical_missing: missingCritical.length,
      star_modifier: starAbsenceModifier,
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
      weights_used:         weightsUsed,
      star_absence_modifier: starAbsenceModifier,
      market_divergence:    marketDivergence,
      confidence_penalty:   confidencePenalty,
      nba_phase:            phase,
      debug: {
        ...(scoreDebug ?? {}),
        absences_impact_value:  variables.absences_impact?.value ?? null,
        star_absence_modifier:  starAbsenceModifier,
        market_implied_home:    marketDivergence?.market_implied_home ?? null,
        market_implied_away:    marketDivergence?.market_implied_away ?? null,
        market_divergence_pts:  marketDivergence?.divergence_pts ?? null,
        market_divergence_flag: marketDivergence?.flag ?? null,
        weights_used:           weightsUsed,
        confidence_penalty:     confidencePenalty,
        phase,
        score_cap:              scoreCap,
        ema_lambda:             emaLambda,
      },
      betting_recommendations: bettingRecs,
      computed_at: new Date().toISOString(),
    };
  }

  /**
   * Calcul depuis variables déjà extraites — utilisé par engine.robustness.js.
   * NE PAS appeler compute() depuis la robustesse.
   */
  static computeFromVariables(variables, weights) {
    if (!variables || !weights) return null;
    return computeScore(variables, weights).score;
  }
}
