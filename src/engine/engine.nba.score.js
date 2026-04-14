/**
 * MANI BET PRO — engine.nba.score.js v1.0
 *
 * Extrait depuis engine.nba.js v5.12 (refactor v5.13).
 * Responsabilité : calcul du score pondéré, ajustement des poids,
 * explication des signaux.
 *
 * Exporté vers engine.nba.js (orchestrateur) uniquement.
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { normalizeVariables, estimateVolatility } from './engine.nba.variables.js';

const CONFIG = SPORTS_CONFIG.NBA;

// ── SCORE ─────────────────────────────────────────────────────────────────────

export function computeScore(variables, weights) {
  let weightedSum = 0;
  let totalWeight = 0;
  const signals   = [];

  const normalized  = normalizeVariables(variables);
  const weightsUsed = buildEffectiveWeights(weights, variables.absences_impact?.value ?? null);

  for (const [varId, normValue] of Object.entries(normalized)) {
    if (normValue === null) continue;
    const weight = weightsUsed[varId];
    if (weight === null || weight === undefined || weight === 0) continue;

    const contribution = normValue * weight;
    weightedSum += contribution;
    totalWeight += weight;

    const varConfig = CONFIG.variables.find(v => v.id === varId);

    signals.push({
      variable:     varId,
      label:        varConfig?.label ?? varId,
      raw_value:    variables[varId]?.value ?? null,
      normalized:   normValue,
      weight,
      contribution,
      direction:    contribution >  0.001 ? 'POSITIVE'
                  : contribution < -0.001 ? 'NEGATIVE'
                  : 'NEUTRAL',
      data_source:  variables[varId]?.source  ?? null,
      data_quality: variables[varId]?.quality ?? null,
      why_signal:   explainSignal(varId, normValue, contribution),
    });
  }

  const raw   = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 : null;
  const score = raw !== null
    ? Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000))
    : null;

  const totalDefinedWeight = Object.entries(weightsUsed)
    .filter(([, w]) => w !== null && w !== undefined && w > 0)
    .reduce((s, [, w]) => s + w, 0);
  const weightCoverage = totalDefinedWeight > 0
    ? Math.round((totalWeight / totalDefinedWeight) * 1000) / 1000
    : null;

  signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    score,
    signals,
    volatility:      estimateVolatility(variables),
    weight_coverage: weightCoverage,
    weights_used:    weightsUsed,
    score_method:    'WEIGHTED_SUM',
    debug: {
      predictive_score_raw:   raw,
      predictive_score_final: score,
    },
  };
}

// ── PONDÉRATIONS ──────────────────────────────────────────────────────────────

export function buildEffectiveWeights(weights, absencesImpact = null) {
  const effective = { ...weights };
  const abs = Math.abs(absencesImpact ?? 0);

  if (abs >= 0.18) {
    effective.net_rating_diff = Math.round((effective.net_rating_diff ?? 0) * 0.82 * 1000) / 1000;
    effective.efg_diff        = Math.round((effective.efg_diff ?? 0) * 0.85 * 1000) / 1000;
    effective.home_away_split = Math.round((effective.home_away_split ?? 0) * 0.85 * 1000) / 1000;
  }
  if (abs >= 0.28) {
    effective.net_rating_diff = Math.round((effective.net_rating_diff ?? 0) * 0.75 * 1000) / 1000;
    effective.efg_diff        = Math.round((effective.efg_diff ?? 0) * 0.80 * 1000) / 1000;
    effective.home_away_split = Math.round((effective.home_away_split ?? 0) * 0.80 * 1000) / 1000;
  }

  return effective;
}

// ── EXPLICATION SIGNAUX ───────────────────────────────────────────────────────

export function explainSignal(varId, normalized, contribution) {
  const dir = contribution >  0.001 ? "en faveur de l'équipe domicile"
            : contribution < -0.001 ? "en faveur de l'équipe visiteuse"
            : 'neutre';
  const int = Math.abs(normalized) > 0.6 ? 'fort' : Math.abs(normalized) > 0.3 ? 'modéré' : 'faible';
  const labels = {
    net_rating_diff:  `Net Rating différentiel ${int} ${dir} — NBA Stats API`,
    efg_diff:         `Efficacité tir (eFG%) ${int} ${dir} — ESPN`,
    ts_diff:          `Efficacité globale (TS%) ${int} ${dir} — ESPN`,
    win_pct_diff:     `Bilan saison ${int} ${dir} — ESPN`,
    home_away_split:  `Contexte dom/ext ${int} ${dir} — ESPN`,
    recent_form_ema:  `Forme récente (EMA) ${int} ${dir} — BallDontLie`,
    absences_impact:  `Impact absences ${int} ${dir} — NBA PDF officiel`,
    avg_pts_diff:     `Différentiel scoring ${int} ${dir} — ESPN`,
    defensive_diff:   `Défense adverse ${int} ${dir} — Tank01`,
    back_to_back:     `Back-to-back ${int} ${dir} — ESPN`,
    rest_days_diff:   `Jours de repos ${int} ${dir} — ESPN`,
  };
  return labels[varId] ?? `Variable ${varId} — signal ${int} ${dir}`;
}

export function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}
