/**
 * MANI BET PRO — engine.nba.js v5.13
 *
 * REFACTOR v5.13 :
 *   Découpe en 3 sous-modules pour améliorer la maintenabilité :
 *     engine.nba.variables.js — extraction, normalisation, absences, EMA
 *     engine.nba.score.js     — score pondéré, poids effectifs, signaux
 *     engine.nba.betting.js   — Moneyline, Spread, O/U, Kelly, divergence marché
 *   Ce fichier (engine.nba.js) est désormais l'orchestrateur mince.
 *   Interface publique inchangée : compute() et computeFromVariables().
 *   Compatible engine.core.js, engine.robustness.js — aucun changement externe.
 *
 * Historique des versions antérieures → voir git log ou engine.nba.variables.js.
 */

import { SPORTS_CONFIG }                  from '../config/sports.config.js';
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
   * @param {object} matchData — données normalisées par le provider/orchestrateur
   * @param {object|null} customWeights — pondérations personnalisées (laboratoire)
   * @returns {EngineResult}
   */
  static compute(matchData, customWeights = null) {
    const weights = customWeights ?? CONFIG.default_weights;

    const variables = extractVariables(matchData);
    const { missing, missingCritical } = assessMissing(variables);

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

    let starAbsenceModifier = null;
    if (score !== null) {
      starAbsenceModifier = computeStarAbsenceModifier(
        matchData?.home_injuries ?? null,
        matchData?.away_injuries ?? null,
        matchData?.home_season_stats?.avg_pts ?? null,
        matchData?.away_season_stats?.avg_pts ?? null,
      );
      if (starAbsenceModifier !== null && starAbsenceModifier !== 1.0) {
        score = Math.max(0, Math.min(1, Math.round(score * starAbsenceModifier * 1000) / 1000));
        scoreMethod = 'WEIGHTED_SUM+STAR_MODIFIER';
      }
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
      score, method: scoreMethod,
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
      },
      betting_recommendations: bettingRecs,
      computed_at: new Date().toISOString(),
    };
  }

  /**
   * Calcul depuis variables déjà extraites — utilisé par engine.robustness.js.
   * NE PAS appeler compute() depuis la robustesse — ça re-extrairait depuis rawData.
   */
  static computeFromVariables(variables, weights) {
    if (!variables || !weights) return null;
    return computeScore(variables, weights).score;
  }
}
