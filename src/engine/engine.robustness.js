/**
 * MANI BET PRO — engine.robustness.js v2
 *
 * Calcul de robustesse par perturbation systématique des variables.
 * Mesure la stabilité du score prédictif face aux variations d'input.
 *
 * CORRECTION v2 :
 *   - recomputeFn reçoit désormais SportEngine.computeFromVariables()
 *     (passé par engine.core.js) au lieu de SportEngine.compute().
 *     Les variables perturbées sont appliquées directement sur le score
 *     sans repasser par _extractVariables — la perturbation est effective.
 *
 * Méthode : pour chaque variable numérique disponible, perturbation ±%
 * et observation du delta sur le score [0,1].
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { Logger }        from '../utils/utils.logger.js';

export class EngineRobustness {

  /**
   * @param {string} sport
   * @param {object} variables — variables_used du résultat moteur
   * @param {object} weights
   * @param {number|null} baseScore
   * @param {function} recomputeFn — (perturbedVars, weights) → number|null
   *                                  Doit être SportEngine.computeFromVariables
   * @returns {RobustnessResult}
   */
  static compute(sport, variables, weights, baseScore, recomputeFn) {
    if (baseScore === null) {
      return this._buildEmptyResult('BASE_SCORE_NULL');
    }

    const config = SPORTS_CONFIG[sport];
    if (!config) {
      return this._buildEmptyResult('SPORT_NOT_CONFIGURED');
    }

    const steps = config.sensitivity_steps ?? [-0.20, -0.10, 0.10, 0.20];

    const sensitivities   = [];
    let maxDelta          = 0;
    const criticalVars    = [];
    let reversalThreshold = null;

    for (const varConfig of config.variables) {
      const varId   = varConfig.id;
      const varData = variables[varId];

      if (!varData || varData.value === null || typeof varData.value !== 'number') {
        sensitivities.push({
          variable:  varId,
          label:     varConfig.label,
          critical:  varConfig.critical,
          available: false,
          max_delta: null,
          deltas:    [],
          rank:      null,
        });
        continue;
      }

      const baseValue = varData.value;
      const deltas    = [];

      for (const step of steps) {
        const perturbedValue = baseValue * (1 + step);
        const perturbedVars  = {
          ...variables,
          [varId]: { ...varData, value: perturbedValue },
        };

        // recomputeFn = SportEngine.computeFromVariables — perturbation effective
        const perturbedScore = recomputeFn(perturbedVars, weights);
        const delta = perturbedScore !== null
          ? Math.abs(perturbedScore - baseScore)
          : null;

        deltas.push({
          step:            Math.round(step * 100),
          perturbed_value: Math.round(perturbedValue * 1000) / 1000,
          perturbed_score: perturbedScore !== null
            ? Math.round(perturbedScore * 1000) / 1000
            : null,
          delta: delta !== null ? Math.round(delta * 1000) / 1000 : null,
        });
      }

      const validDeltas = deltas.map(d => d.delta).filter(d => d !== null);
      const maxVarDelta = validDeltas.length > 0 ? Math.max(...validDeltas) : 0;

      // Seuil de criticité : delta > 0.10 = variable critique
      const CRITICALITY_THRESHOLD = 0.10;
      const isCritical = maxVarDelta > CRITICALITY_THRESHOLD;

      if (maxVarDelta > maxDelta) maxDelta = maxVarDelta;
      if (isCritical) criticalVars.push(varId);

      // Recherche du seuil de renversement (score croise 0.5)
      if (reversalThreshold === null && Math.abs(baseScore - 0.5) > 0.05) {
        for (const delta of deltas) {
          if (delta.perturbed_score !== null) {
            const baseSide      = baseScore > 0.5 ? 1 : -1;
            const perturbedSide = delta.perturbed_score > 0.5 ? 1 : -1;
            if (baseSide !== perturbedSide) {
              reversalThreshold = {
                variable: varId,
                step_pct: delta.step,
                at_value: delta.perturbed_value,
              };
            }
          }
        }
      }

      sensitivities.push({
        variable:                varId,
        label:                   varConfig.label,
        critical:                varConfig.critical,
        available:               true,
        max_delta:               Math.round(maxVarDelta * 1000) / 1000,
        deltas,
        is_critical_sensitivity: isCritical,
      });
    }

    // Trier par sensibilité décroissante
    sensitivities
      .filter(s => s.available)
      .sort((a, b) => (b.max_delta ?? 0) - (a.max_delta ?? 0))
      .forEach((s, i) => { s.rank = i + 1; });

    // Score robustesse = 1 − maxDelta, clampé [0,1]
    const robustnessScore = Math.max(0, Math.min(1,
      Math.round((1 - maxDelta) * 1000) / 1000
    ));

    Logger.debug('ENGINE_ROBUSTNESS_RESULT', {
      score:          robustnessScore,
      max_delta:      maxDelta,
      critical_count: criticalVars.length,
      reversal:       reversalThreshold !== null,
    });

    return {
      score:              robustnessScore,
      max_delta:          Math.round(maxDelta * 1000) / 1000,
      critical_variables: criticalVars,
      reversal_threshold: reversalThreshold,
      sensitivities,
      computed_at:        new Date().toISOString(),
      method:             'SYSTEMATIC_PERTURBATION',
      steps_used:         steps,
    };
  }

  static _buildEmptyResult(reason) {
    return {
      score:              null,
      max_delta:          null,
      critical_variables: [],
      reversal_threshold: null,
      sensitivities:      [],
      computed_at:        new Date().toISOString(),
      method:             null,
      steps_used:         [],
      rejection_reason:   reason,
    };
  }

  static interpretScore(score) {
    if (score === null) return 'INCONCLUSIVE';
    if (score >= 0.75)  return 'HIGH';
    if (score >= 0.50)  return 'MEDIUM';
    return 'LOW';
  }
}
