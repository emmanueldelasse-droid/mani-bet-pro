/**
 * MANI BET PRO — engine.tennis.js v1.0
 *
 * Moteur d'analyse tennis ATP.
 * Sources : Jeff Sackmann CSV (stats) + The Odds API (cotes)
 *
 * Signaux :
 *   ranking_elo_diff     — différentiel classement ATP (0.35)
 *   surface_winrate_diff — win rate sur la surface sur 12 mois (0.30)
 *   recent_form_ema      — EMA victoires/défaites 10 derniers matchs (0.15)
 *   h2h_surface          — bilan H2H sur même surface (0.10)
 *   service_dominance    — proxy service (1stWon%, aces) (0.05)
 *   fatigue_index        — jours depuis dernier match (0.05)
 *
 * Limites CSV Sackmann :
 *   - Pas temps réel : matchs du tournoi en cours absents (~2-3j délai)
 *   - recent_form et fatigue_index dégradés à PARTIAL après R1
 *   - Qualité données signalée dans l'UI
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { Logger }         from '../utils/utils.logger.js';

const MIN_SURFACE_MATCHES = 8;   // minimum matchs sur la surface sur 12 mois
const EMA_N               = 10;  // nombre de matchs pour le calcul EMA
const MIN_ELO_MATCHES     = 20;  // minimum matchs pour fiabilité Elo overall
const MIN_ELO_SURFACE     = 10;  // minimum matchs surface pour Elo surface fiable

// ── MOTEUR PRINCIPAL ──────────────────────────────────────────────────────

export class EngineTennis {

  /**
   * Point d'entrée principal.
   * @param {object} match     — données du match (joueurs, tournoi, surface, odds)
   * @param {object} csvStats  — stats préprocessées depuis le CSV Sackmann
   * @returns {object}         — résultat compatible avec engine.core.js
   */
  static analyze(match, csvStats) {
    const config   = SPORTS_CONFIG['TENNIS'];
    const weights  = config.default_weights;
    const surface  = match.surface ?? 'Hard';
    const p1Name   = match.home_player;   // conventionnellement le "home"
    const p2Name   = match.away_player;

    const p1Stats  = csvStats?.[p1Name] ?? null;
    const p2Stats  = csvStats?.[p2Name] ?? null;

    // ── EXTRACTION DES VARIABLES ──────────────────────────────────────────
    const variables = this._extractVariables(p1Stats, p2Stats, surface, match);

    // ── SCORE PONDÉRÉ ─────────────────────────────────────────────────────
    const { score, signals, missingVars, missingCritical } =
      this._computeScore(variables, weights, config);

    // ── RECOMMANDATIONS DE PARIS ──────────────────────────────────────────
    const bettingRecs = this._computeBettingRecommendations(
      score, match.odds, match, variables
    );

    return {
      score,
      signals,
      missing_variables: missingVars,
      missing_critical:  missingCritical,
      variables_used:    variables,
      betting_recommendations: bettingRecs,
      score_method: 'CALIBRATED',
      volatility:   null,
    };
  }

  // ── EXTRACTION DES VARIABLES ──────────────────────────────────────────

  static _extractVariables(p1, p2, surface, match) {
    return {
      ranking_elo_diff:     this._rankingDiff(p1, p2, surface),
      surface_winrate_diff: this._surfaceWinrateDiff(p1, p2, surface),
      recent_form_ema:      this._recentFormEma(p1, p2),
      h2h_surface:          this._h2hSurface(p1, p2, surface),
      service_dominance:    this._serviceDominance(p1, p2),
      fatigue_index:        this._fatigueIndex(p1, p2),
    };
  }

  // ── SIGNAL 1 : Elo / Classement ───────────────────────────────────────
  // Priorité : Elo surface (si assez de matchs) > Elo overall > rank ATP

  static _rankingDiff(p1, p2, surface) {
    // Tentative Elo surface
    const eSurf1 = p1?.elo_surface ?? null;
    const eSurf2 = p2?.elo_surface ?? null;
    const nSurf1 = p1?.elo_surface_matches ?? 0;
    const nSurf2 = p2?.elo_surface_matches ?? 0;
    if (eSurf1 !== null && eSurf2 !== null && nSurf1 >= MIN_ELO_SURFACE && nSurf2 >= MIN_ELO_SURFACE) {
      return this._eloDiffSignal(eSurf1, eSurf2, `elo_${String(surface ?? '').toLowerCase()}`, 'VERIFIED',
        { p1_elo: eSurf1, p2_elo: eSurf2, p1_n: nSurf1, p2_n: nSurf2 });
    }

    // Fallback Elo overall
    const eAll1 = p1?.elo_overall ?? null;
    const eAll2 = p2?.elo_overall ?? null;
    const nAll1 = p1?.elo_matches ?? 0;
    const nAll2 = p2?.elo_matches ?? 0;
    if (eAll1 !== null && eAll2 !== null && nAll1 >= MIN_ELO_MATCHES && nAll2 >= MIN_ELO_MATCHES) {
      return this._eloDiffSignal(eAll1, eAll2, 'elo_overall', 'PARTIAL',
        { p1_elo: eAll1, p2_elo: eAll2, p1_n: nAll1, p2_n: nAll2 });
    }

    // Fallback final : rank ATP/WTA
    const r1 = p1?.current_rank ?? null;
    const r2 = p2?.current_rank ?? null;

    if (r1 === null || r2 === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    // Différentiel inversé : ranking bas = meilleur joueur
    // r2 - r1 > 0 → p1 mieux classé → signal positif pour p1
    const diff = r2 - r1;

    // Normalisation : plage typique ±200 places → ±1
    const normalized = Math.max(-1, Math.min(1, diff / 200));

    return {
      value:      Math.round(normalized * 100) / 100,
      raw:        diff,
      p1_rank:    r1,
      p2_rank:    r2,
      source:    'sackmann_csv',
      quality:   (r1 && r2) ? 'VERIFIED' : 'PARTIAL',
    };
  }

  // Convertit un diff Elo en signal centré -1..+1 via proba attendue standard.
  static _eloDiffSignal(elo1, elo2, sourceId, quality, extras = {}) {
    const expectedP1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    const normalized = (expectedP1 - 0.5) * 2;
    return {
      value:           Math.round(normalized * 100) / 100,
      expected_p1_win: Math.round(expectedP1 * 100),
      raw_diff:        Math.round(elo1 - elo2),
      source:          sourceId,
      quality,
      ...extras,
    };
  }

  // ── SIGNAL 2 : Win rate sur la surface ───────────────────────────────

  static _surfaceWinrateDiff(p1, p2, surface) {
    const wr1 = p1?.surface_stats?.[surface]?.win_rate ?? null;
    const wr2 = p2?.surface_stats?.[surface]?.win_rate ?? null;
    const n1  = p1?.surface_stats?.[surface]?.matches ?? 0;
    const n2  = p2?.surface_stats?.[surface]?.matches ?? 0;

    if (wr1 === null || wr2 === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    const quality = (n1 >= MIN_SURFACE_MATCHES && n2 >= MIN_SURFACE_MATCHES)
      ? 'VERIFIED'
      : (n1 >= 4 && n2 >= 4) ? 'PARTIAL' : 'LOW_SAMPLE';

    const diff = wr1 - wr2;  // déjà entre -1 et +1

    return {
      value:   Math.round(diff * 100) / 100,
      p1_wr:   Math.round(wr1 * 100),
      p2_wr:   Math.round(wr2 * 100),
      p1_n:    n1,
      p2_n:    n2,
      surface,
      source:  'sackmann_csv',
      quality,
    };
  }

  // ── SIGNAL 3 : Forme récente EMA ─────────────────────────────────────

  static _recentFormEma(p1, p2) {
    const ema1 = p1?.recent_form_ema ?? null;
    const ema2 = p2?.recent_form_ema ?? null;

    if (ema1 === null || ema2 === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    // EMA entre 0 (défaites) et 1 (victoires)
    const diff = ema1 - ema2;

    // Qualité dégradée si données CSV récentes manquantes (tournoi en cours)
    const quality = (p1?.csv_lag_days ?? 0) > 3 || (p2?.csv_lag_days ?? 0) > 3
      ? 'PARTIAL'
      : 'VERIFIED';

    return {
      value:   Math.round(diff * 100) / 100,
      p1_ema:  Math.round(ema1 * 100),
      p2_ema:  Math.round(ema2 * 100),
      source:  'sackmann_csv',
      quality,
    };
  }

  // ── SIGNAL 4 : H2H sur même surface ──────────────────────────────────

  static _h2hSurface(p1, p2, surface) {
    const h2h = p1?.h2h?.[p2?.name]?.[surface] ?? null;

    if (h2h === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    const total = (h2h.p1_wins ?? 0) + (h2h.p2_wins ?? 0);

    if (total === 0) {
      return { value: 0, p1_wins: 0, p2_wins: 0, source: 'sackmann_csv', quality: 'LOW_SAMPLE' };
    }

    // Win rate p1 dans les H2H sur cette surface — centré sur 0.5
    const p1WinRate = h2h.p1_wins / total;
    const diff      = p1WinRate - 0.5;   // entre -0.5 et +0.5
    const normalized = diff * 2;          // entre -1 et +1

    return {
      value:   Math.round(normalized * 100) / 100,
      p1_wins: h2h.p1_wins,
      p2_wins: h2h.p2_wins,
      total,
      source:  'sackmann_csv',
      quality: total >= 3 ? 'VERIFIED' : 'LOW_SAMPLE',
    };
  }

  // ── SIGNAL 5 : Dominance au service ──────────────────────────────────

  static _serviceDominance(p1, p2) {
    const s1 = p1?.service_stats ?? null;
    const s2 = p2?.service_stats ?? null;

    if (!s1 || !s2) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    // Score service = 1stWon% × 0.6 + (aces - df) proxy × 0.4
    // Normalisé entre 0 et 1
    const score1 = this._serviceScore(s1);
    const score2 = this._serviceScore(s2);

    if (score1 === null || score2 === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    const diff = score1 - score2;  // entre -1 et +1

    return {
      value:      Math.round(diff * 100) / 100,
      p1_score:   Math.round(score1 * 100),
      p2_score:   Math.round(score2 * 100),
      source:    'sackmann_csv',
      quality:   'PARTIAL',  // stats de saison, pas du tournoi en cours
    };
  }

  static _serviceScore(stats) {
    if (!stats?.first_serve_won || !stats?.svpt) return null;
    const firstWonPct = stats.first_serve_won / stats.svpt;
    const aceNet      = ((stats.aces ?? 0) - (stats.double_faults ?? 0)) / Math.max(stats.svpt, 1);
    return Math.min(1, Math.max(0, firstWonPct * 0.7 + (aceNet + 0.1) * 0.3));
  }

  // ── SIGNAL 6 : Fatigue ───────────────────────────────────────────────

  static _fatigueIndex(p1, p2) {
    const days1 = p1?.days_since_last_match ?? null;
    const days2 = p2?.days_since_last_match ?? null;

    if (days1 === null || days2 === null) {
      return { value: null, source: 'sackmann_csv', quality: 'MISSING' };
    }

    // Différentiel de repos : p1 plus reposé = signal positif
    // Plage typique : 0-14 jours entre matchs en tournoi → ±1 normalisé sur 7j
    const diff      = days1 - days2;
    const normalized = Math.max(-1, Math.min(1, diff / 7));

    const quality   = (p1?.csv_lag_days ?? 0) > 3 || (p2?.csv_lag_days ?? 0) > 3
      ? 'PARTIAL'
      : 'VERIFIED';

    return {
      value:    Math.round(normalized * 100) / 100,
      p1_days:  days1,
      p2_days:  days2,
      source:  'sackmann_csv',
      quality,
    };
  }

  // ── SCORE PONDÉRÉ ─────────────────────────────────────────────────────

  static _computeScore(variables, weights, config) {
    let weightedSum    = 0;
    let totalWeight    = 0;
    const signals      = [];
    const missingVars  = [];
    const missingCritical = [];

    for (const [id, weight] of Object.entries(weights)) {
      if (!weight || weight === 0) continue;

      const varData = variables[id];
      const value   = varData?.value ?? null;

      if (value === null) {
        missingVars.push(id);
        const varConfig = config.variables.find(v => v.id === id);
        if (varConfig?.critical) missingCritical.push(id);
        continue;
      }

      // Normaliser entre 0 et 1 pour le score final (value est entre -1 et +1)
      const normalized = (value + 1) / 2;
      weightedSum     += normalized * weight;
      totalWeight     += weight;

      signals.push({
        id,
        value,
        weight,
        contribution: Math.round((normalized - 0.5) * weight * 100) / 100,
        quality:      varData.quality,
      });
    }

    const rawScore = totalWeight > 0
      ? Math.max(0.1, Math.min(0.9, weightedSum / totalWeight))
      : null;

    return { score: rawScore, signals, missingVars, missingCritical };
  }

  // ── RECOMMANDATIONS DE PARIS ──────────────────────────────────────────

  static _computeBettingRecommendations(score, odds, match, variables) {
    if (score === null || !odds) return null;

    const oddsH2H = odds.h2h ?? null;
    if (!oddsH2H) return null;

    const p1Odds   = oddsH2H.p1 ?? null;  // cote décimale joueur 1
    const p2Odds   = oddsH2H.p2 ?? null;

    if (!p1Odds || !p2Odds) return null;

    const pP1     = score;
    const pP2     = 1 - score;

    // Probabilités implicites (avec vig)
    const implP1  = 1 / p1Odds;
    const implP2  = 1 / p2Odds;

    const edgeP1  = pP1 - implP1;
    const edgeP2  = pP2 - implP2;

    const EDGE_MIN = 0.05;  // 5% minimum
    const recs     = [];

    if (Math.abs(edgeP1) >= EDGE_MIN) {
      const side = edgeP1 > 0 ? 'HOME' : 'AWAY';
      const motorProb = side === 'HOME' ? pP1 : pP2;
      const bestOdds  = side === 'HOME' ? p1Odds : p2Odds;
      const impliedProb = 1 / bestOdds;
      const realEdge  = motorProb - impliedProb;
      const kelly     = this._kelly(motorProb, bestOdds);
      const isContrarian = (side === 'HOME' && score <= 0.5) || (side === 'AWAY' && score > 0.5);

      recs.push({
        type:         'MONEYLINE',
        label:        'Vainqueur du match',
        side,
        odds_line:    bestOdds,
        odds_decimal: bestOdds,
        odds_source:  odds.source ?? 'The Odds API',
        motor_prob:   Math.round(motorProb * 100),
        implied_prob: Math.round(impliedProb * 100),
        edge:         Math.round(Math.abs(realEdge) * 100),
        kelly_stake:  kelly,
        has_value:    true,
        is_contrarian: isContrarian,
      });
    }

    if (recs.length === 0) return null;

    // Trier par edge décroissant
    recs.sort((a, b) => b.edge - a.edge);

    const marketProbP1 = 1 / p1Odds;
    const marketProbP2 = 1 / p2Odds;
    const vigSum       = marketProbP1 + marketProbP2;

    return {
      recommendations: recs,
      best:            recs[0],
      market_prob_home: Math.round((marketProbP1 / vigSum) * 100) / 100,
      market_prob_away: Math.round((marketProbP2 / vigSum) * 100) / 100,
    };
  }

  // ── KELLY ─────────────────────────────────────────────────────────────

  static _kelly(prob, decOdds, fraction = 0.25) {
    const b    = decOdds - 1;
    const q    = 1 - prob;
    const full = (b * prob - q) / b;
    return Math.max(0, Math.round(full * fraction * 1000) / 1000);
  }
}
