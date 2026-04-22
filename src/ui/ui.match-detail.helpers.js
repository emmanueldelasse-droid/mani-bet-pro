/**
 * MANI BET PRO — ui.match-detail.helpers.js v1.0
 *
 * Extrait depuis ui.match-detail.js v3.8 (refactor v3.9).
 * Utilitaires partagés entre tous les sous-modules de la fiche match :
 *   - Conversions cotes (américain ↔ décimal)
 *   - Labels de signaux
 *   - Résolution de l'analyse active
 *   - Formatage (date, rejet, HTML)
 */

import { americanToDecimal, decimalToAmerican } from '../utils/utils.odds.js';
export { americanToDecimal, decimalToAmerican };

export const WORKER_URL = 'https://manibetpro.emmanueldelasse.workers.dev';

export const SIGNAL_LABELS = {
  'recent_form_ema':   'Forme récente',
  'home_away_split':   'Avantage terrain',
  'efg_diff':          'Efficacité au tir',
  'net_rating_diff':   'Niveau général',
  'win_pct_diff':      'Bilan victoires/défaites',
  'absences_impact':   'Blessures',
  'ts_diff':           'Efficacité offensive',
  'avg_pts_diff':      'Points marqués',
  'defensive_diff':    'Défense',
  'back_to_back':      'Fatigue (match consécutif)',
  'rest_days_diff':    'Repos',
};

export function simplifyLabel(label, variable) {
  return SIGNAL_LABELS[variable] ?? label ?? variable;
}

export function analysisTimestamp(analysis) {
  if (!analysis) return 0;
  const raw = analysis.updated_at ?? analysis.computed_at ?? analysis.saved_at ?? null;
  const ts = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

export function resolveLatestAnalysisForMatch(analyses, matchId, preferredAnalysisId = null) {
  if (!analyses || !matchId) return null;

  if (preferredAnalysisId && analyses[preferredAnalysisId]?.match_id === matchId) {
    return analyses[preferredAnalysisId];
  }

  let best = null, bestTs = -1;
  for (const analysis of Object.values(analyses)) {
    if (!analysis || analysis.match_id !== matchId) continue;
    const ts = analysisTimestamp(analysis);
    if (!best || ts > bestTs || (ts === bestTs && String(analysis.analysis_id ?? '') > String(best.analysis_id ?? ''))) {
      best = analysis;
      bestTs = ts;
    }
  }
  return best;
}

export function formatMatchTime(match) {
  try {
    if (match.datetime) {
      return new Date(match.datetime).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
        + ' · ' + new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    if (match.date) return new Date(match.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {}
  return '—';
}

export function formatRejection(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Analyse trop instable',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    MISSING_PITCHER_DATA:            'Données pitchers manquantes',
  };
  return labels[reason] ?? reason;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
