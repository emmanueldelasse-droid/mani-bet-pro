/**
 * MANI BET PRO — engine.core.js v2
 *
 * Orchestrateur du moteur déterministe.
 * Coordonne : extraction → qualité données → calcul → robustesse → rejet.
 *
 * CORRECTION v2 :
 *   - _recomputeScore utilise SportEngine.computeFromVariables() au lieu de compute().
 *     En v1, la perturbation était injectée dans _perturbed_variables (ignoré par
 *     _extractVariables) → le score de robustesse était calculé sans perturbation effective.
 *     Désormais, les variables perturbées sont passées directement à _computeScore.
 */

import { SPORTS_CONFIG, getSportConfig } from '../config/sports.config.js';
import { EngineNBA }        from './engine.nba.js';
import { EngineRobustness } from './engine.robustness.js';
import { Logger }           from '../utils/utils.logger.js';

const ENGINE_MAP = {
  NBA: EngineNBA,
  // TENNIS: EngineTennis,   // Sprint 5
  // MLB:    EngineMLB,      // Sprint 4
};

export class EngineCore {

  /**
   * Point d'entrée principal.
   * @param {string} sport
   * @param {object} rawData — données normalisées par le provider
   * @param {object|null} customWeights — pondérations personnalisées (laboratoire)
   * @returns {AnalysisOutput}
   */
  static compute(sport, rawData, customWeights = null) {
    const startTime = Date.now();

    const sportConfig = getSportConfig(sport);
    if (!sportConfig) {
      return this._buildRejected(sport, 'SPORT_NOT_SUPPORTED_OR_DISABLED', null, null);
    }

    const SportEngine = ENGINE_MAP[sport];
    if (!SportEngine) {
      return this._buildRejected(sport, 'ENGINE_NOT_IMPLEMENTED', null, null);
    }

    const weights      = customWeights ?? sportConfig.default_weights;
    const engineResult = SportEngine.compute(rawData, weights);

    const immediateRejection = this._checkImmediateRejection(
      engineResult, sportConfig, rawData
    );
    if (immediateRejection) {
      return this._buildRejected(sport, immediateRejection, engineResult, null);
    }

    const dataQuality = this._assessDataQuality(engineResult, sportConfig);

    if (sportConfig.rejection_thresholds.min_data_quality !== null &&
        dataQuality.score < sportConfig.rejection_thresholds.min_data_quality) {
      return this._buildRejected(
        sport, 'DATA_QUALITY_BELOW_THRESHOLD', engineResult, dataQuality
      );
    }

    // CORRECTION : passer SportEngine.computeFromVariables à EngineRobustness
    // pour que la perturbation soit appliquée directement sur les variables extraites,
    // sans repasser par _extractVariables (qui lirait les données brutes non perturbées).
    const robustness = EngineRobustness.compute(
      sport,
      engineResult.variables_used,
      weights,
      engineResult.score,
      (perturbedVars, w) => SportEngine.computeFromVariables(perturbedVars, w)
    );

    if (sportConfig.rejection_thresholds.min_robustness !== null &&
        robustness.score !== null &&
        robustness.score < sportConfig.rejection_thresholds.min_robustness) {
      return this._buildRejected(
        sport, 'ROBUSTNESS_BELOW_THRESHOLD', engineResult, dataQuality, robustness
      );
    }

    const confidenceLevel = this._computeConfidenceLevel(
      engineResult.score,
      robustness.score,
      dataQuality.score
    );

    const analysis = {
      analysis_id:          crypto.randomUUID(),
      sport,
      model_version:        '0.3.0',
      computed_at:          new Date().toISOString(),
      computation_ms:       Date.now() - startTime,

      predictive_score:     engineResult.score,
      robustness_score:     robustness.score,
      data_quality_score:   dataQuality.score,
      volatility_index:     engineResult.volatility,

      confidence_level:     confidenceLevel,
      rejection_reason:     null,

      key_signals:  engineResult.signals.filter(s => Math.abs(s.contribution) > 0.02),
      weak_signals: engineResult.signals.filter(s => Math.abs(s.contribution) <= 0.02),

      missing_variables: engineResult.missing_variables,
      missing_critical:  engineResult.missing_critical,

      robustness_breakdown:    robustness,
      data_quality_breakdown:  dataQuality,

      model_disagreement: null,  // V2 — Sprint 6

      betting_recommendations: engineResult.betting_recommendations ?? null,

      explanation_context: this._buildExplanationContext(
        sport, engineResult, robustness, dataQuality, confidenceLevel
      ),
    };

    Logger.engineResult({
      sport,
      analysisId:      analysis.analysis_id,
      confidenceLevel: analysis.confidence_level,
      rejectionReason: null,
    });

    return analysis;
  }

  // ── VÉRIFICATIONS DE REJET ────────────────────────────────────────────

  static _checkImmediateRejection(engineResult, sportConfig, rawData) {
    if (engineResult.score_method === 'UNCALIBRATED') {
      return 'WEIGHTS_NOT_CALIBRATED';
    }
    if (engineResult.missing_critical.length > 0) {
      return 'MISSING_CRITICAL_DATA';
    }
    if (sportConfig.rejection_thresholds.require_pitcher_confirmed &&
        rawData.pitcher_confirmed === false) {
      return 'PITCHER_NOT_CONFIRMED';
    }
    if (sportConfig.rejection_thresholds.require_absences_confirmed &&
        rawData.absences_confirmed === false) {
      return 'ABSENCES_NOT_CONFIRMED';
    }
    return null;
  }

  // ── QUALITÉ DES DONNÉES ───────────────────────────────────────────────

  static _assessDataQuality(engineResult, sportConfig) {
    const QUALITY_SCORES = {
      'VERIFIED':             1.0,
      'PARTIAL':              0.6,
      'ESTIMATED':            0.5,
      'LOW_SAMPLE':           0.4,
      'UNCALIBRATED':         0.2,
      'INSUFFICIENT_SAMPLE':  0.1,
      'MISSING':              0.0,
    };

    const breakdown = {};
    let totalScore  = 0;
    let count       = 0;

    for (const varConfig of sportConfig.variables) {
      const varData = engineResult.variables_used?.[varConfig.id];
      const quality = varData?.quality ?? 'MISSING';
      const score   = QUALITY_SCORES[quality] ?? 0;

      breakdown[varConfig.id] = {
        label:    varConfig.label,
        quality,
        score,
        critical: varConfig.critical,
        source:   varData?.source ?? 'non fournie ou non vérifiée',
      };

      totalScore += score;
      count++;
    }

    const globalScore = count > 0
      ? Math.round((totalScore / count) * 1000) / 1000
      : 0;

    return {
      score:                    globalScore,
      breakdown,
      missing_count:            engineResult.missing_variables?.length ?? 0,
      critical_missing_count:   engineResult.missing_critical?.length ?? 0,
    };
  }

  // ── NIVEAU DE CONFIANCE ───────────────────────────────────────────────

  /**
   * Seuils non calibrés — placeholders à ajuster après 50+ paris.
   */
  static _computeConfidenceLevel(predictive, robustness, dataQuality) {
    if (predictive === null || robustness === null || dataQuality === null) {
      return 'INCONCLUSIVE';
    }

    const HIGH_THRESHOLD   = 0.75;  // Non calibré
    const MEDIUM_THRESHOLD = 0.50;  // Non calibré

    const minScore = Math.min(robustness, dataQuality);

    if (minScore >= HIGH_THRESHOLD)   return 'HIGH';
    if (minScore >= MEDIUM_THRESHOLD) return 'MEDIUM';
    return 'LOW';
  }

  // ── CONTEXTE POUR L'IA ────────────────────────────────────────────────

  static _buildExplanationContext(sport, engineResult, robustness, dataQuality, confidenceLevel) {
    return {
      sport,
      confidence_level:       confidenceLevel,
      predictive_score:       engineResult.score,
      robustness_score:       robustness.score,
      data_quality_score:     dataQuality.score,
      volatility:             engineResult.volatility,
      score_method:           engineResult.score_method,
      top_signals: (engineResult.signals ?? []).slice(0, 5).map(s => ({
        variable:     s.variable,
        label:        s.label,
        direction:    s.direction,
        contribution: s.contribution,
        why:          s.why_signal,
      })),
      missing_variables:    engineResult.missing_variables,
      missing_critical:     engineResult.missing_critical,
      critical_sensitivity: robustness.critical_variables,
      reversal_threshold:   robustness.reversal_threshold,
      data_quality_breakdown: Object.entries(dataQuality.breakdown ?? {}).map(
        ([id, d]) => ({ id, quality: d.quality, source: d.source })
      ),
    };
  }

  // ── SORTIES REJETÉES ─────────────────────────────────────────────────

  static _buildRejected(sport, reason, engineResult = null, dataQuality = null, robustness = null) {
    Logger.engineResult({
      sport,
      analysisId:      null,
      confidenceLevel: 'INCONCLUSIVE',
      rejectionReason: reason,
    });

    return {
      analysis_id:          crypto.randomUUID(),
      sport,
      model_version:        '0.3.0',
      computed_at:          new Date().toISOString(),
      computation_ms:       null,

      predictive_score:     null,
      robustness_score:     robustness?.score ?? null,
      data_quality_score:   dataQuality?.score ?? null,
      volatility_index:     null,

      confidence_level:     'INCONCLUSIVE',
      rejection_reason:     reason,

      key_signals:          [],
      weak_signals:         [],

      missing_variables:    engineResult?.missing_variables ?? [],
      missing_critical:     engineResult?.missing_critical ?? [],

      robustness_breakdown:    robustness ?? null,
      data_quality_breakdown:  dataQuality ?? null,
      model_disagreement:      null,
      betting_recommendations: null,
      explanation_context:     null,
    };
  }

  // ── UTILITAIRES PUBLICS ───────────────────────────────────────────────

  static getSupportedSports() {
    return Object.keys(ENGINE_MAP);
  }

  static interpretConfidence(level) {
    const map = {
      HIGH: {
        label:       'Concluant',
        cssClass:    'badge--robust-high',
        description: 'Données suffisantes, robustesse élevée.',
      },
      MEDIUM: {
        label:       'Partiel',
        cssClass:    'badge--robust-mid',
        description: 'Analyse possible mais avec réserves.',
      },
      LOW: {
        label:       'Fragile',
        cssClass:    'badge--robust-low',
        description: 'Robustesse ou qualité de données insuffisante.',
      },
      INCONCLUSIVE: {
        label:       'Inconclus',
        cssClass:    'badge--inconclusive',
        description: 'Analyse non concluante — données insuffisantes ou rejet automatique.',
      },
    };
    return map[level] ?? map['INCONCLUSIVE'];
  }
}
