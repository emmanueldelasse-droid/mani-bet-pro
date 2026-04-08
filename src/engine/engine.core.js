/**
 * MANI BET PRO — engine.core.js v2.5
 *
 * AJOUTS v2.5 :
 *   - score_method et star_absence_modifier exposés depuis engineResult.
 *     Nécessaire pour que l'UI et les tests puissent vérifier le modificateur star.
 *
 * AJOUTS v2.4 :
 *   - weight_coverage exposé dans l'analyse depuis engineResult.
 *     Fraction des poids effectivement couverts par des données disponibles.
 *
 *
 * AJOUTS v2.2 :
 *   - Plafonnement du predictive_score via sportConfig.score_cap.
 *     Le score brut (non plafonné) est conservé dans raw_predictive_score
 *     pour debug et traçabilité.
 *     Le plafonnement est appliqué APRÈS le calcul de robustesse et Kelly
 *     pour ne pas biaiser ces calculs intermédiaires.
 *     Concrètement : OKC vs équipe décimée ne peut plus afficher 97%.
 *
 * CORRECTION v2.1 :
 *   - variables_used exposé dans l'analyse (utilisé par ui.dashboard.js
 *     pour afficher NET RTG en console).
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

    // Robustesse calculée sur le score BRUT (non plafonné) — intentionnel.
    // Le plafond ne doit pas masquer la sensibilité réelle du modèle.
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

    // ── PLAFONNEMENT DU SCORE ──────────────────────────────────────────────
    // Appliqué ici, après robustesse et Kelly, pour ne pas biaiser ces calculs.
    // score_cap défini dans sports.config.js (0.90 pour NBA).
    // Score symétrique : le plancher = 1 - score_cap (ex: 0.10 pour NBA).
    const rawScore  = engineResult.score;
    const scoreCap  = sportConfig.score_cap ?? 1.0;
    const scoreFloor = 1 - scoreCap;
    const cappedScore = rawScore !== null
      ? Math.max(scoreFloor, Math.min(scoreCap, rawScore))
      : null;

    const confidenceLevel = this._computeConfidenceLevel(
      cappedScore,
      robustness.score,
      dataQuality.score
    );

    const noOdds  = !rawData?.odds && !rawData?.market_odds;
    const decision = this._computeDecision(
      confidenceLevel,
      engineResult.betting_recommendations,
      dataQuality.score
    );
    const insuffisantReason = decision === 'INSUFFISANT'
      ? this._computeInsuffisantReason(engineResult.betting_recommendations, noOdds)
      : null;

    const analysis = {
      analysis_id:          crypto.randomUUID(),
      sport,
      model_version:        '0.3.0',
      computed_at:          new Date().toISOString(),
      computation_ms:       Date.now() - startTime,

      // Score plafonné — affiché dans l'UI
      predictive_score:     cappedScore,
      // Score brut conservé pour debug/traçabilité
      raw_predictive_score: rawScore !== cappedScore ? rawScore : undefined,

      robustness_score:     robustness.score,
      data_quality_score:   dataQuality.score,
      volatility_index:     engineResult.volatility,

      confidence_level:     confidenceLevel,
      decision,
      rejection_reason:     null,
      insuffisant_reason:   insuffisantReason,

      key_signals:  engineResult.signals.filter(s => Math.abs(s.contribution) > 0.02),
      weak_signals: engineResult.signals.filter(s => Math.abs(s.contribution) <= 0.02),

      missing_variables: engineResult.missing_variables,
      missing_critical:  engineResult.missing_critical,

      robustness_breakdown:    robustness,
      data_quality_breakdown:  dataQuality,

      model_disagreement: null,  // V2 — Sprint 6

      variables_used:          engineResult.variables_used ?? {},
      weight_coverage:         engineResult.weight_coverage ?? null,
      score_method:            engineResult.score_method ?? null,
      star_absence_modifier:   engineResult.star_absence_modifier ?? null,
      betting_recommendations: engineResult.betting_recommendations ?? null,
      // v2.3 : distingue "pas d'edge" de "pas de cotes disponibles"
      no_odds_available: !rawData?.odds && !rawData?.market_odds,

      explanation_context: this._buildExplanationContext(
        sport, engineResult, robustness, dataQuality, confidenceLevel, cappedScore
      ),
    };

    Logger.engineResult({
      sport,
      analysisId:      analysis.analysis_id,
      decision:        analysis.decision,
      rejectionReason: null,
    });

    return analysis;
  }

  // ── DÉCISION ORIENTÉE UI ──────────────────────────────────────────────

  /**
   * Calcule le champ decision lisible par l'UI.
   * 'ANALYSER'    — edge ≥ 7%, qualité ≥ 75%, confiance HIGH
   * 'EXPLORER'    — edge présent mais qualité ou confiance insuffisante
   * 'INSUFFISANT' — pas d'edge détecté
   * 'REJETÉ'      — rejet moteur (géré dans _buildRejected)
   */
  static _computeDecision(confidenceLevel, bettingRecs, dataQualityScore) {
    const best    = bettingRecs?.best;
    const edge    = best?.edge ?? 0;
    const quality = dataQualityScore ?? 0;

    if (confidenceLevel === 'INCONCLUSIVE') return 'INSUFFISANT';
    if (!best || edge < 5)                  return 'INSUFFISANT';
    if (edge >= 7 && quality >= 0.75 && confidenceLevel === 'HIGH') return 'ANALYSER';
    return 'EXPLORER';
  }

  // Raison lisible pour le statut INSUFFISANT — utilisée par l'UI
  static _computeInsuffisantReason(bettingRecs, noOdds) {
    if (noOdds) return 'Cotes non disponibles pour ce match';
    const best = bettingRecs?.best;
    if (!best)       return 'Aucune recommandation de pari détectée';
    if (best.edge < 5) return `Edge insuffisant (${best.edge}% < 5% minimum)`;
    return 'Conditions non remplies';
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
      'WEIGHTED':             0.9,  // v2.2 : données Tank01 pondérées ppg
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

  static _buildExplanationContext(sport, engineResult, robustness, dataQuality, confidenceLevel, cappedScore) {
    return {
      sport,
      confidence_level:       confidenceLevel,
      predictive_score:       cappedScore,
      raw_predictive_score:   engineResult.score,
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
      decision:        'INSUFFISANT',
      rejectionReason: reason,
    });

    return {
      analysis_id:          crypto.randomUUID(),
      sport,
      model_version:        '0.3.0',
      computed_at:          new Date().toISOString(),
      computation_ms:       null,

      predictive_score:     null,
      raw_predictive_score: null,
      robustness_score:     robustness?.score ?? null,
      data_quality_score:   dataQuality?.score ?? null,
      volatility_index:     null,

      confidence_level:     'INCONCLUSIVE',
      decision:             'INSUFFISANT',
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
