/**
 * MANI BET PRO — ai.context.js
 *
 * Construction du contexte structuré fourni à l'IA.
 * Contient UNIQUEMENT des données calculées par le moteur déterministe.
 * Jamais de données inventées ou inférées.
 * Si une valeur est null → déclarée explicitement comme absente.
 */

export class AIContextBuilder {

  /**
   * Construit le contexte complet à fournir à l'IA.
   * @param {AnalysisOutput} analysis — sortie complète du moteur
   * @param {object|null} match — métadonnées du match
   * @param {'EXPLAIN'|'AUDIT'|'SUMMARIZE'|'SCENARIO'|'DETECT_INCONSISTENCY'} task
   * @returns {object}
   */
  static build(analysis, match = null, task = 'EXPLAIN') {
    return {
      task,
      match_metadata:    this._buildMatchMetadata(match),
      engine_output:     this._buildEngineOutput(analysis),
      top_signals:       this._buildTopSignals(analysis),
      data_quality:      this._buildDataQuality(analysis),
      robustness:        this._buildRobustness(analysis),
      missing_data:      this._buildMissingData(analysis),
      computed_at:       analysis?.computed_at ?? null,
      model_version:     analysis?.model_version ?? null,
    };
  }

  // ── SECTIONS ────────────────────────────────────────────────────────────

  static _buildMatchMetadata(match) {
    if (!match) {
      return {
        sport:      'NBA',
        home_team:  'donnée non fournie',
        away_team:  'donnée non fournie',
        datetime:   'donnée non fournie',
      };
    }

    return {
      sport:      match.sport ?? 'NBA',
      home_team:  match.home_team?.name ?? 'donnée non fournie',
      away_team:  match.away_team?.name ?? 'donnée non fournie',
      datetime:   match.datetime ?? match.date ?? 'donnée non fournie',
      status:     match.status ?? 'donnée non fournie',
    };
  }

  static _buildEngineOutput(analysis) {
    return {
      predictive_score:   analysis?.predictive_score   ?? 'donnée non fournie',
      robustness_score:   analysis?.robustness_score   ?? 'donnée non fournie',
      data_quality_score: analysis?.data_quality_score ?? 'donnée non fournie',
      volatility_index:   analysis?.volatility_index   ?? 'donnée non fournie',
      confidence_level:   analysis?.confidence_level   ?? 'INCONCLUSIVE',
      rejection_reason:   analysis?.rejection_reason   ?? null,
      score_method:       analysis?.score_method       ?? 'donnée non fournie',
    };
  }

  static _buildTopSignals(analysis) {
    const signals = analysis?.key_signals ?? [];

    if (signals.length === 0) {
      return { count: 0, signals: [], note: 'Aucun signal calculé' };
    }

    return {
      count: signals.length,
      signals: signals.slice(0, 5).map(s => ({
        variable:     s.variable,
        label:        s.label,
        direction:    s.direction,
        contribution: s.contribution !== null
          ? Math.round(s.contribution * 100) + '%'
          : 'donnée non fournie',
        why:          s.why_signal ?? 'donnée non fournie',
        data_quality: s.data_quality ?? 'donnée non fournie',
      })),
    };
  }

  static _buildDataQuality(analysis) {
    const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
    const fields    = Object.entries(breakdown).map(([id, d]) => ({
      variable: id,
      label:    d.label,
      quality:  d.quality,
      source:   d.source ?? 'donnée non fournie',
      critical: d.critical,
    }));

    return {
      global_score:    analysis?.data_quality_score ?? 'donnée non fournie',
      missing_count:   analysis?.data_quality_breakdown?.missing_count ?? 0,
      critical_missing: analysis?.data_quality_breakdown?.critical_missing_count ?? 0,
      fields,
    };
  }

  static _buildRobustness(analysis) {
    const rob = analysis?.robustness_breakdown;

    if (!rob) {
      return { score: 'donnée non fournie', note: 'Robustesse non calculée' };
    }

    return {
      score:              rob.score ?? 'donnée non fournie',
      max_delta:          rob.max_delta ?? 'donnée non fournie',
      critical_variables: rob.critical_variables ?? [],
      reversal_threshold: rob.reversal_threshold
        ? `Variable "${rob.reversal_threshold.variable}" renverse la conclusion à ±${rob.reversal_threshold.step_pct}%`
        : 'Aucun seuil de renversement détecté',
    };
  }

  static _buildMissingData(analysis) {
    return {
      missing_variables: analysis?.missing_variables ?? [],
      missing_critical:  analysis?.missing_critical  ?? [],
      note: analysis?.missing_critical?.length > 0
        ? `${analysis.missing_critical.length} donnée(s) critique(s) manquante(s) — analyse dégradée`
        : 'Aucune donnée critique manquante',
    };
  }
}
