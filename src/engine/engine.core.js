/**
 * MANI BET PRO — engine.core.js
 *
 * Orchestrateur du moteur déterministe.
 * Coordonne : extraction → qualité données → calcul → robustesse → rejet.
 *
 * Règles absolues :
 * - Aucune donnée inventée à aucune étape
 * - Un match rejeté est un résultat valide, jamais une erreur
 * - La robustesse prime sur le score brut
 * - Chaque décision est tracée et explicable
 */

import { SPORTS_CONFIG, getSportConfig } from '../config/sports.config.js';
import { EngineNBA }        from './engine.nba.js';
import { EngineRobustness } from './engine.robustness.js';
import { Logger }           from '../utils/utils.logger.js';

// Map sport → moteur
const ENGINE_MAP = {
  NBA: EngineNBA,
  // TENNIS: EngineTennis,   // Phase 2
  // MLB:    EngineMLB,      // Phase 2
};

export class EngineCore {

  /**
   * Point d'entrée principal.
   * Prend des données brutes normalisées et retourne une analyse complète.
   *
   * @param {string} sport — 'NBA' | 'TENNIS' | 'MLB'
   * @param {object} rawData — données normalisées par le provider
   * @param {object|null} customWeights — pondérations personnalisées (simulateur)
   * @returns {AnalysisOutput}
   */
  static compute(sport, rawData, customWeights = null) {
    const startTime = Date.now();

    // 1. Vérifier que le sport est supporté et activé
    const sportConfig = getSportConfig(sport);
    if (!sportConfig) {
      return this._buildRejected(sport, 'SPORT_NOT_SUPPORTED_OR_DISABLED', null, null);
    }

    const SportEngine = ENGINE_MAP[sport];
    if (!SportEngine) {
      return this._buildRejected(sport, 'ENGINE_NOT_IMPLEMENTED', null, null);
    }

    // 2. Appliquer les pondérations
    const weights = customWeights ?? sportConfig.default_weights;

    // 3. Calculer via le moteur sport
    const engineResult = SportEngine.compute(rawData, weights);

    // 4. Vérifier les motifs de rejet immédiats
    const immediateRejection = this._checkImmediateRejection(
      engineResult, sportConfig, rawData
    );
    if (immediateRejection) {
      return this._buildRejected(
        sport,
        immediateRejection,
        engineResult,
        null
      );
    }

    // 5. Calculer la qualité des données
    const dataQuality = this._assessDataQuality(engineResult, sportConfig);

    // 6. Vérifier le seuil de qualité des données
    if (sportConfig.rejection_thresholds.min_data_quality !== null &&
        dataQuality.score < sportConfig.rejection_thresholds.min_data_quality) {
      return this._buildRejected(
        sport,
        'DATA_QUALITY_BELOW_THRESHOLD',
        engineResult,
        dataQuality
      );
    }

    // 7. Calculer la robustesse
    const robustness = EngineRobustness.compute(
      sport,
      engineResult.variables_used,
      weights,
      engineResult.score,
      (perturbedVars, w) => this._recomputeScore(sport, perturbedVars, w, rawData)
    );

    // 8. Vérifier le seuil de robustesse
    if (sportConfig.rejection_thresholds.min_robustness !== null &&
        robustness.score !== null &&
        robustness.score < sportConfig.rejection_thresholds.min_robustness) {
      return this._buildRejected(
        sport,
        'ROBUSTNESS_BELOW_THRESHOLD',
        engineResult,
        dataQuality,
        robustness
      );
    }

    // 9. Calculer le niveau de confiance
    const confidenceLevel = this._computeConfidenceLevel(
      engineResult.score,
      robustness.score,
      dataQuality.score
    );

    // 10. Construire la sortie finale
    const analysis = {
      analysis_id:          crypto.randomUUID(),
      sport,
      model_version:        '0.1.0',
      computed_at:          new Date().toISOString(),
      computation_ms:       Date.now() - startTime,

      // Scores principaux
      predictive_score:     engineResult.score,
      robustness_score:     robustness.score,
      data_quality_score:   dataQuality.score,
      volatility_index:     engineResult.volatility,

      // Niveau de confiance global
      confidence_level:     confidenceLevel,
      rejection_reason:     null,

      // Signaux
      key_signals:          engineResult.signals.filter(s => Math.abs(s.contribution) > 0.02),
      weak_signals:         engineResult.signals.filter(s => Math.abs(s.contribution) <= 0.02),

      // Données manquantes
      missing_variables:    engineResult.missing_variables,
      missing_critical:     engineResult.missing_critical,

      // Détails
      robustness_breakdown: robustness,
      data_quality_breakdown: dataQuality,

      // Désaccord inter-modèles (V2)
      model_disagreement:   null,

      // Contexte pour l'IA
      explanation_context:  this._buildExplanationContext(
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
    // Score non calculable (poids non calibrés)
    if (engineResult.score_method === 'UNCALIBRATED') {
      return 'WEIGHTS_NOT_CALIBRATED';
    }

    // Données critiques manquantes
    if (engineResult.missing_critical.length > 0) {
      return 'MISSING_CRITICAL_DATA';
    }

    // Pitcher non confirmé (MLB)
    if (sportConfig.rejection_thresholds.require_pitcher_confirmed &&
        rawData.pitcher_confirmed === false) {
      return 'PITCHER_NOT_CONFIRMED';
    }

    // Absences non confirmées (NBA) si flag actif
    if (sportConfig.rejection_thresholds.require_absences_confirmed &&
        rawData.absences_confirmed === false) {
      return 'ABSENCES_NOT_CONFIRMED';
    }

    return null;
  }

  // ── QUALITÉ DES DONNÉES ───────────────────────────────────────────────

  /**
   * Évalue la qualité des données champ par champ.
   * Score global = moyenne des qualités individuelles.
   *
   * @param {object} engineResult
   * @param {object} sportConfig
   * @returns {DataQualityResult}
   */
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
      score:     globalScore,
      breakdown,
      missing_count:  engineResult.missing_variables?.length ?? 0,
      critical_missing_count: engineResult.missing_critical?.length ?? 0,
    };
  }

  // ── NIVEAU DE CONFIANCE ───────────────────────────────────────────────

  /**
   * Calcule le niveau de confiance global.
   * Seuils à calibrer — null = non défini → retourne 'UNSET'.
   *
   * @param {number|null} predictive
   * @param {number|null} robustness
   * @param {number|null} dataQuality
   * @returns {'HIGH'|'MEDIUM'|'LOW'|'INCONCLUSIVE'|'UNSET'}
   */
  static _computeConfidenceLevel(predictive, robustness, dataQuality) {
    if (predictive === null || robustness === null || dataQuality === null) {
      return 'INCONCLUSIVE';
    }

    // Seuils non calibrés → affichage dégradé mais pas de rejet
    // Ces valeurs sont des placeholders à ajuster empiriquement
    const HIGH_THRESHOLD   = 0.75;   // Non garanti — à calibrer
    const MEDIUM_THRESHOLD = 0.50;   // Non garanti — à calibrer

    const minScore = Math.min(robustness, dataQuality);

    if (minScore >= HIGH_THRESHOLD)   return 'HIGH';
    if (minScore >= MEDIUM_THRESHOLD) return 'MEDIUM';
    return 'LOW';
  }

  // ── RECALCUL POUR ROBUSTESSE ─────────────────────────────────────────

  /**
   * Recalcule uniquement le score (sans robustesse) pour la perturbation.
   * Utilisé par engine.robustness.js.
   */
  static _recomputeScore(sport, perturbedVars, weights, originalRawData) {
    const SportEngine = ENGINE_MAP[sport];
    if (!SportEngine) return null;

    // Reconstruire rawData avec les variables perturbées
    const perturbedRawData = { ...originalRawData, _perturbed_variables: perturbedVars };
    const result = SportEngine.compute(perturbedRawData, weights);
    return result.score;
  }

  // ── CONTEXTE POUR L'IA ────────────────────────────────────────────────

  /**
   * Construit le contexte structuré fourni à l'IA.
   * Contient uniquement des données calculées par le moteur.
   * Jamais de données inventées ou inférées.
   */
  static _buildExplanationContext(sport, engineResult, robustness, dataQuality, confidenceLevel) {
    return {
      sport,
      confidence_level:       confidenceLevel,
      predictive_score:       engineResult.score,
      robustness_score:       robustness.score,
      data_quality_score:     dataQuality.score,
      volatility:             engineResult.volatility,
      score_method:           engineResult.score_method,
      top_signals:            (engineResult.signals ?? []).slice(0, 5).map(s => ({
        variable:    s.variable,
        label:       s.label,
        direction:   s.direction,
        contribution: s.contribution,
        why:         s.why_signal,
      })),
      missing_variables:      engineResult.missing_variables,
      missing_critical:       engineResult.missing_critical,
      critical_sensitivity:   robustness.critical_variables,
      reversal_threshold:     robustness.reversal_threshold,
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
      model_version:        '0.1.0',
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

      robustness_breakdown: robustness ?? null,
      data_quality_breakdown: dataQuality ?? null,
      model_disagreement:   null,
      explanation_context:  null,
    };
  }

  // ── UTILITAIRES PUBLICS ───────────────────────────────────────────────

  /**
   * Retourne la liste des sports actuellement supportés par le moteur.
   * @returns {string[]}
   */
  static getSupportedSports() {
    return Object.keys(ENGINE_MAP);
  }

  /**
   * Interprétation textuelle d'un niveau de confiance pour l'UI.
   * @param {'HIGH'|'MEDIUM'|'LOW'|'INCONCLUSIVE'} level
   * @returns {{ label: string, cssClass: string, description: string }}
   */
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
