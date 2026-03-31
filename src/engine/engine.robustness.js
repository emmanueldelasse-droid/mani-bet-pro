/**
 * MANI BET PRO — engine.robustness.js
 *
 * Calcul de robustesse par perturbation systématique des variables.
 * Mesure la stabilité du score prédictif face aux variations d'input.
 *
 * Méthode : pour chaque variable numérique disponible,
 * on applique des perturbations ±% et on observe le delta sur le score.
 *
 * Un score robuste = delta faible sur toutes les variables.
 * Un score fragile = delta fort sur au moins une variable critique.
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { Logger } from '../utils/utils.logger.js';

export class EngineRobustness {

  /**
   * Calcule le score de robustesse d'une analyse.
   *
   * @param {string} sport — 'NBA' | 'TENNIS' | 'MLB'
   * @param {NBAVariables} variables — variables extraites par le moteur sport
   * @param {object} weights — pondérations actives
   * @param {number|null} baseScore — score de référence à perturber
   * @param {function} recomputeFn — fonction de recalcul (sport engine)
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

    // ── Perturbation variable par variable ───────────────────────────
    for (const varConfig of config.variables) {
      const varId   = varConfig.id;
      const varData = variables[varId];

      // Ne perturber que les variables numériques disponibles
      if (!varData || varData.value === null || typeof varData.value !== 'number') {
        sensitivities.push({
          variable:     varId,
          label:        varConfig.label,
          critical:     varConfig.critical,
          available:    false,
          max_delta:    null,
          deltas:       [],
          rank:         null,
        });
        continue;
      }

      const baseValue = varData.value;
      const deltas    = [];

      for (const step of steps) {
        const perturbedValue  = baseValue * (1 + step);
        const perturbedVars   = {
          ...variables,
          [varId]: { ...varData, value: perturbedValue },
        };

        const perturbedScore = recomputeFn(perturbedVars, weights);
        const delta = perturbedScore !== null
          ? Math.abs(perturbedScore - baseScore)
          : null;

        deltas.push({
          step:             Math.round(step * 100),   // En %
          perturbed_value:  Math.round(perturbedValue * 1000) / 1000,
          perturbed_score:  perturbedScore !== null
            ? Math.round(perturbedScore * 1000) / 1000
            : null,
          delta:            delta !== null ? Math.round(delta * 1000) / 1000 : null,
        });
      }

      const validDeltas = deltas.map(d => d.delta).filter(d => d !== null);
      const maxVarDelta = validDeltas.length > 0 ? Math.max(...validDeltas) : 0;

      // Seuil de criticité : delta > 0.10 sur le score [0,1] = critique
      // Ce seuil est indicatif — à ajuster selon calibration
      const CRITICALITY_THRESHOLD = 0.10;
      const isCritical = maxVarDelta > CRITICALITY_THRESHOLD;

      if (maxVarDelta > maxDelta) maxDelta = maxVarDelta;
      if (isCritical) criticalVars.push(varId);

      // Recherche du seuil de renversement (score croise 0.5)
      // Valable uniquement si le score de base n'est pas à 0.5
      if (reversalThreshold === null && Math.abs(baseScore - 0.5) > 0.05) {
        for (const delta of deltas) {
          if (delta.perturbed_score !== null) {
            const baseSide     = baseScore > 0.5 ? 1 : -1;
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
        variable:   varId,
        label:      varConfig.label,
        critical:   varConfig.critical,
        available:  true,
        max_delta:  Math.round(maxVarDelta * 1000) / 1000,
        deltas,
        is_critical_sensitivity: isCritical,
      });
    }

    // ── Trier par sensibilité décroissante ───────────────────────────
    sensitivities
      .filter(s => s.available)
      .sort((a, b) => (b.max_delta ?? 0) - (a.max_delta ?? 0))
      .forEach((s, i) => { s.rank = i + 1; });

    // ── Score de robustesse ──────────────────────────────────────────
    // Score = 1 - maxDelta (clampé sur [0, 1])
    // Un delta max de 0.30 → robustesse de 0.70
    const robustnessScore = Math.max(0, Math.min(1,
      Math.round((1 - maxDelta) * 1000) / 1000
    ));

    const result = {
      score:              robustnessScore,
      max_delta:          Math.round(maxDelta * 1000) / 1000,
      critical_variables: criticalVars,
      reversal_threshold: reversalThreshold,
      sensitivities,
      computed_at:        new Date().toISOString(),
      method:             'SYSTEMATIC_PERTURBATION',
      steps_used:         steps,
    };

    Logger.debug('ENGINE_ROBUSTNESS_RESULT', {
      score: robustnessScore,
      max_delta: maxDelta,
      critical_count: criticalVars.length,
      reversal: reversalThreshold !== null,
    });

    return result;
  }

  // ── HELPERS ───────────────────────────────────────────────────────────

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

  /**
   * Interprétation textuelle du score de robustesse.
   * Utilisée pour les badges UI.
   * @param {number|null} score
   * @returns {'HIGH'|'MEDIUM'|'LOW'|'INCONCLUSIVE'}
   */
  static interpretScore(score) {
    if (score === null) return 'INCONCLUSIVE';
    if (score >= 0.75)  return 'HIGH';
    if (score >= 0.50)  return 'MEDIUM';
    return 'LOW';
  }
}
