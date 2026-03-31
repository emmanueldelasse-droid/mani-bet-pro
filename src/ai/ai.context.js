/**
 * MANI BET PRO — ai.context.js v2
 *
 * Construit le contexte structuré fourni à l'IA.
 * Contient uniquement des données calculées par le moteur déterministe.
 * Jamais de données inventées ou inférées.
 */

export class AIContextBuilder {

  /**
   * @param {AnalysisOutput} analysisOutput — sortie de EngineCore.compute()
   * @param {string} task — EXPLAIN | AUDIT | SUMMARIZE | DETECT_INCONSISTENCY | SCENARIO
   * @param {object} matchMeta — { home: string, away: string, date: string, sport: string }
   * @returns {AIContext}
   */
  static build(analysisOutput, task, matchMeta = {}) {
    if (!analysisOutput) {
      return {
        task,
        match_meta: matchMeta,
        engine_output: null,
        is_valid: false,
        reason: 'NO_ANALYSIS',
      };
    }

    // Filtrer les signaux à exposer (top 5 par contribution)
    const topSignals = (analysisOutput.key_signals ?? [])
      .slice(0, 5)
      .map(s => ({
        variable:    s.variable,
        label:       s.label,
        direction:   s.direction,
        contribution: s.contribution,
        raw_value:   s.raw_value,
        data_quality: s.data_quality,
        why:         s.why_signal,
      }));

    // Breakdown qualité données (champ par champ)
    const dataQualityBreakdown = Object.entries(
      analysisOutput.data_quality_breakdown?.breakdown ?? {}
    ).map(([id, d]) => ({
      id,
      label:    d.label,
      quality:  d.quality,
      source:   d.source,
      critical: d.critical,
    }));

    return {
      task,
      match_meta: matchMeta,
      is_valid: true,

      engine_output: {
        sport:                analysisOutput.sport,
        confidence_level:     analysisOutput.confidence_level,
        predictive_score:     analysisOutput.predictive_score,
        robustness_score:     analysisOutput.robustness_score,
        data_quality_score:   analysisOutput.data_quality_score,
        volatility:           analysisOutput.volatility_index,
        rejection_reason:     analysisOutput.rejection_reason,
        score_method:         analysisOutput.score_method ?? null,

        top_signals:          topSignals,
        missing_variables:    analysisOutput.missing_variables ?? [],
        missing_critical:     analysisOutput.missing_critical ?? [],

        critical_sensitivity: analysisOutput.robustness_breakdown?.critical_variables ?? [],
        reversal_threshold:   analysisOutput.robustness_breakdown?.reversal_threshold ?? null,
        max_sensitivity_delta: analysisOutput.robustness_breakdown?.max_delta ?? null,

        data_quality_breakdown: dataQualityBreakdown,

        model_version:  analysisOutput.model_version,
        computed_at:    analysisOutput.computed_at,
      },
    };
  }
}
