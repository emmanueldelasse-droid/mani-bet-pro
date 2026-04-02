/**
 * MANI BET PRO — engine.nba.js v3 — Bloc A
 *
 * Moteur analytique NBA.
 * Variables calculées depuis ESPN (eFG%, TS%, win%, splits) + injuries PDF NBA.
 *
 * Convention : valeur positive = avantage équipe domicile.
 *
 * Sources :
 *   ESPN scoreboard → eFG%, TS%, win_pct, home_win_pct, away_win_pct, avg_pts
 *   BallDontLie v1  → forme récente W/L (EMA)
 *   PDF NBA officiel → absences (Out, Questionable, Doubtful, Probable)
 */

import { SPORTS_CONFIG } from '../config/sports.config.js';
import { Logger }        from '../utils/utils.logger.js';

const CONFIG = SPORTS_CONFIG.NBA;

// ── CONSTANTES BLOC A ─────────────────────────────────────────────────────

// Seuils edge minimum (en fraction, pas en %)
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.05,  // 5%
  SPREAD:     0.03,  // 3%
  OVER_UNDER: 0.03,  // 3%
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION  = 0.25;
const KELLY_MAX_PCT   = 0.05;

// Home court bonus calibré par équipe (altitude/facteur terrain documenté)
const HOME_COURT_BONUS = {
  'Denver Nuggets': 0.03,
  'Utah Jazz':      0.03,
};

// Distance approximative entre arènes NBA (km) — paires connues
// Clé : 'TeamA|TeamB' (ordre alphabétique)
const TRAVEL_DISTANCES = {
  'Boston Celtics|Los Angeles Lakers':      4350,
  'Golden State Warriors|Miami Heat':       4680,
  'Los Angeles Lakers|Miami Heat':          4380,
  'Boston Celtics|Phoenix Suns':            4290,
  'Golden State Warriors|New York Knicks':  4130,
  'Los Angeles Lakers|New York Knicks':     4500,
  'Miami Heat|Portland Trail Blazers':      4660,
  'Boston Celtics|Portland Trail Blazers':  4810,
};

export class EngineNBA {

  /**
   * Point d'entrée principal.
   * @param {NBAMatchData} matchData
   * @param {object|null} customWeights
   * @returns {NBAEngineResult}
   */
  static compute(matchData, customWeights = null) {
    const weights = customWeights ?? CONFIG.default_weights;

    // 1. Extraire les variables depuis les données ESPN + injuries
    const variables = this._extractVariables(matchData);

    // 2. Identifier les données manquantes
    const { missing, missingCritical } = this._assessMissing(variables);

    // 3. Vérifier si les poids sont calibrés
    const uncalibrated = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    // 4. Calculer le score
    let score      = null;
    let signals    = [];
    let volatility = null;
    let scoreMethod = null;

    if (uncalibrated.length === Object.keys(weights).length) {
      scoreMethod = 'UNCALIBRATED';
    } else if (missingCritical.length > 0) {
      scoreMethod = 'MISSING_CRITICAL';
    } else {
      const computed = this._computeScore(variables, weights);
      score       = computed.score;
      signals     = computed.signals;
      volatility  = computed.volatility;
      scoreMethod = 'WEIGHTED_SUM';
    }

    // Calcul des recommandations paris (value betting)
    const bettingRecs = (score !== null && matchData?.odds)
      ? this._computeBettingRecommendations(score, matchData.odds, matchData)
      : null;

    const result = {
      sport:               'NBA',
      score,
      score_method:        scoreMethod,
      signals,
      volatility,
      missing_variables:   missing,
      missing_critical:    missingCritical,
      uncalibrated_weights: uncalibrated,
      variables_used:      variables,
      betting_recommendations: bettingRecs,
      computed_at:         new Date().toISOString(),
    };

    Logger.debug('ENGINE_NBA_RESULT', {
      score,
      method:           scoreMethod,
      missing_count:    missing.length,
      critical_missing: missingCritical.length,
    });

    return result;
  }

  // ── EXTRACTION DES VARIABLES ──────────────────────────────────────────────

  static _extractVariables(data) {
    const homeStats  = data?.home_season_stats;  // ESPN stats saison
    const awayStats  = data?.away_season_stats;
    const homeRecent = data?.home_recent;         // BallDontLie forme récente
    const awayRecent = data?.away_recent;
    const homeInj    = data?.home_injuries;       // PDF NBA officiel
    const awayInj    = data?.away_injuries;

    return {

      // ── eFG% différentiel ──────────────────────────────────────────────────
      // Source ESPN. eFG% = (FGM + 0.5×FG3M) / FGA
      // Positif = équipe domicile tire plus efficacement.
      efg_diff: this._safeDiff(
        homeStats?.efg_pct,
        awayStats?.efg_pct,
        'efg_diff',
        'espn_scoreboard'
      ),

      // ── TS% différentiel ──────────────────────────────────────────────────
      // Source ESPN. TS% = PTS / (2 × (FGA + 0.44×FTA))
      ts_diff: this._safeDiff(
        homeStats?.ts_pct,
        awayStats?.ts_pct,
        'ts_diff',
        'espn_scoreboard'
      ),

      // ── Win% différentiel (saison complète) ───────────────────────────────
      win_pct_diff: this._safeDiff(
        homeStats?.win_pct,
        awayStats?.win_pct,
        'win_pct_diff',
        'espn_scoreboard'
      ),

      // ── Split domicile/extérieur ───────────────────────────────────────────
      // Domicile : win_pct de l'équipe à domicile quand elle joue à domicile
      // Extérieur : win_pct de l'équipe visiteuse quand elle joue à l'extérieur
      // Positif = avantage domicile selon les splits contextuels
      home_away_split: this._computeHomeSplit(homeStats, awayStats),

      // ── Forme récente EMA (BallDontLie W/L) ───────────────────────────────
      recent_form_ema: this._safeEMADiff(
        homeRecent,
        awayRecent,
        CONFIG.ema_lambda
      ),

      // ── Impact absences (PDF NBA officiel) ────────────────────────────────
      absences_impact: this._computeAbsencesImpact(homeInj, awayInj),

      // ── Points marqués différentiel ────────────────────────────────────────
      avg_pts_diff: this._safeDiff(
        homeStats?.avg_pts,
        awayStats?.avg_pts,
        'avg_pts_diff',
        'espn_scoreboard'
      ),

      // ── Back-to-back detection ─────────────────────────────────────────────
      // Source : champ schedule dans rawData (si disponible)
      back_to_back: this._computeBackToBack(data),

      // ── Rest days differential ─────────────────────────────────────────────
      // Positif = équipe domicile plus reposée
      rest_days_diff: this._computeRestDiff(data),

    };
  }

  // ── CALCUL DU SCORE ───────────────────────────────────────────────────────

  static _computeScore(variables, weights) {
    let weightedSum = 0;
    let totalWeight = 0;
    const signals   = [];

    const normalized = this._normalizeVariables(variables);

    for (const [varId, normValue] of Object.entries(normalized)) {
      if (normValue === null) continue;

      const weight = weights[varId];
      if (weight === null || weight === undefined || weight === 0) continue;

      const contribution = normValue * weight;
      weightedSum  += contribution;
      totalWeight  += weight;

      const varConfig = CONFIG.variables.find(v => v.id === varId);

      signals.push({
        variable:     varId,
        label:        varConfig?.label ?? varId,
        raw_value:    variables[varId]?.value ?? null,
        normalized:   normValue,
        weight,
        contribution,
        direction:    contribution > 0.001 ? 'POSITIVE'
                    : contribution < -0.001 ? 'NEGATIVE'
                    : 'NEUTRAL',
        data_source:  variables[varId]?.source ?? null,
        data_quality: variables[varId]?.quality ?? null,
        why_signal:   this._explainSignal(varId, normValue, contribution),
      });
    }

    let score = totalWeight > 0
      ? (weightedSum / totalWeight + 1) / 2
      : null;

    signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score:     score !== null ? Math.round(score * 1000) / 1000 : null,
      signals,
      volatility: this._estimateVolatility(variables),
    };
  }

  // ── NORMALISATION SUR [-1, +1] ────────────────────────────────────────────

  static _normalizeVariables(variables) {
    return {
      // eFG% diff : plage typique NBA ±0.05 → ±1
      efg_diff: this._clampNormalize(variables.efg_diff?.value, -0.07, 0.07),

      // TS% diff : plage similaire
      ts_diff: this._clampNormalize(variables.ts_diff?.value, -0.07, 0.07),

      // Win% diff : sur [-1, +1] naturellement
      win_pct_diff: variables.win_pct_diff?.value ?? null,

      // Home/away split : déjà sur [-1, +1]
      home_away_split: variables.home_away_split?.value ?? null,

      // Forme récente EMA : déjà sur [-1, +1]
      recent_form_ema: variables.recent_form_ema?.value ?? null,

      // Absences impact : déjà sur [-1, +1]
      absences_impact: variables.absences_impact?.value ?? null,

      // Avg pts diff : plage ±15 pts
      avg_pts_diff: this._clampNormalize(variables.avg_pts_diff?.value, -15, 15),

      // Back-to-back : -1 si domicile en B2B, +1 si extérieur en B2B
      back_to_back: variables.back_to_back?.value ?? null,

      // Rest days diff : normalisé ±1 sur plage ±3 jours
      rest_days_diff: this._clampNormalize(variables.rest_days_diff?.value, -3, 3),
    };
  }

  static _clampNormalize(value, min, max) {
    if (value === null || value === undefined) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return (clamped - (min + max) / 2) / ((max - min) / 2);
  }

  // ── CALCULS SPÉCIFIQUES ───────────────────────────────────────────────────

  static _safeDiff(homeVal, awayVal, varId, source) {
    if (homeVal === null || homeVal === undefined ||
        awayVal === null || awayVal === undefined) {
      return { value: null, source, quality: 'MISSING' };
    }
    return {
      value:   homeVal - awayVal,
      source,
      quality: 'VERIFIED',
    };
  }

  /**
   * Split domicile/extérieur contextualisé.
   * Utilise home_win_pct pour l'équipe à domicile
   * et away_win_pct pour l'équipe visiteuse.
   * Positif = la dynamique favorise l'équipe domicile.
   */
  static _computeHomeSplit(homeStats, awayStats) {
    const homeWinPct = homeStats?.home_win_pct;
    const awayWinPct = awayStats?.away_win_pct;

    if (homeWinPct === null || homeWinPct === undefined ||
        awayWinPct === null || awayWinPct === undefined) {
      return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
    }

    // Différentiel entre le win% à domicile de l'équipe locale
    // et le win% à l'extérieur de l'équipe visiteuse
    // Positif = avantage contextuel domicile
    const diff = homeWinPct - awayWinPct;

    return {
      value:   Math.max(-1, Math.min(1, diff * 2)),  // Normalisé ±1
      source:  'espn_scoreboard',
      quality: 'VERIFIED',
      raw:     { home_home_win_pct: homeWinPct, away_away_win_pct: awayWinPct },
    };
  }

  static _safeEMADiff(homeRecent, awayRecent, lambda) {
    if (!homeRecent?.matches || !awayRecent?.matches) {
      return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
    }

    if (lambda === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'UNCALIBRATED' };
    }

    const homeEMA = this._computeEMA(homeRecent.matches, lambda);
    const awayEMA = this._computeEMA(awayRecent.matches, lambda);

    if (homeEMA === null || awayEMA === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };
    }

    return {
      value:   homeEMA - awayEMA,
      source:  'balldontlie_v1',
      quality: (homeRecent.matches.length >= 5 && awayRecent.matches.length >= 5)
        ? 'VERIFIED' : 'LOW_SAMPLE',
    };
  }

  static _computeEMA(matches, lambda) {
    if (!matches || matches.length === 0) return null;

    let ema         = null;
    let weight      = 1;
    let totalWeight = 0;

    for (const match of matches) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;

      if (ema === null) {
        ema = result;
        totalWeight = weight;
      } else {
        ema = ema + weight * (result - ema) / (totalWeight + weight);
        totalWeight += weight;
      }

      weight *= (1 - lambda);
      if (weight < 0.001) break;
    }

    // Convertir [0,1] → [-1, +1]
    return ema !== null ? ema * 2 - 1 : null;
  }

  /**
   * Calcule l'impact des absences depuis le PDF NBA officiel.
   *
   * Pondération par statut :
   *   Out = 1.0, Doubtful = 0.75, Questionable = 0.5, Probable = 0.1
   * Les joueurs G League Two-Way sont inclus mais avec poids réduit (0.3).
   * Note : sans USG% le calcul est approximatif (qualité = ESTIMATED).
   *
   * Positif = équipe visiteuse plus touchée = avantage domicile.
   */
  static _computeAbsencesImpact(homeInjuries, awayInjuries) {
    if (!homeInjuries || !awayInjuries) {
      return { value: null, source: 'nba_official_pdf', quality: 'MISSING' };
    }

    const WEIGHTS = {
      'Out':          1.0,
      'Doubtful':     0.75,
      'Questionable': 0.5,
      'Probable':     0.1,
      'Available':    0.0,
    };

    const scoreTeam = (players) => {
      if (!Array.isArray(players)) return 0;
      return players.reduce((acc, p) => {
        // Réduire le poids des joueurs G League Two-Way (moins d'impact)
        const isGLeague = p.reason?.toLowerCase().includes('g league') ||
                          p.reason?.toLowerCase().includes('two-way');
        const baseWeight = WEIGHTS[p.status] ?? p.impact_weight ?? 0;
        return acc + (isGLeague ? baseWeight * 0.3 : baseWeight);
      }, 0);
    };

    const homeScore = scoreTeam(homeInjuries);
    const awayScore = scoreTeam(awayInjuries);

    const diff       = awayScore - homeScore;
    const normalized = Math.max(-1, Math.min(1, diff / 5));

    return {
      value:   normalized,
      source:  'nba_official_pdf',
      quality: 'ESTIMATED',
      raw:     {
        home_score:    homeScore,
        away_score:    awayScore,
        home_out:      homeInjuries.filter(p => p.status === 'Out').length,
        away_out:      awayInjuries.filter(p => p.status === 'Out').length,
        home_quest:    homeInjuries.filter(p => p.status === 'Questionable').length,
        away_quest:    awayInjuries.filter(p => p.status === 'Questionable').length,
      },
    };
  }

  // ── VOLATILITÉ ────────────────────────────────────────────────────────────

  static _estimateVolatility(variables) {
    let volatility = 0.20;   // Base NBA = faible

    // Absences significatives
    const abs = variables.absences_impact?.value;
    if (abs !== null && Math.abs(abs) > 0.5) volatility += 0.15;

    // Faible qualité données
    const hasLowQuality = Object.values(variables)
      .some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLowQuality) volatility += 0.10;

    return Math.min(1, Math.round(volatility * 100) / 100);
  }

  // ── ÉVALUATION DONNÉES MANQUANTES ─────────────────────────────────────────

  static _assessMissing(variables) {
    const missing         = [];
    const missingCritical = [];

    for (const varConfig of CONFIG.variables) {
      const v         = variables[varConfig.id];
      const isMissing = !v || v.value === null || v.quality === 'MISSING';

      if (isMissing) {
        missing.push(varConfig.id);
        if (varConfig.critical) missingCritical.push(varConfig.id);
      }
    }

    return { missing, missingCritical };
  }

  // ── EXPLICATIONS SIGNAUX ──────────────────────────────────────────────────

  static _explainSignal(varId, normalized, contribution) {
    const direction = contribution > 0.001 ? 'en faveur de l\'équipe domicile'
                    : contribution < -0.001 ? 'en faveur de l\'équipe visiteuse'
                    : 'neutre';

    const intensity = Math.abs(normalized) > 0.6 ? 'fort'
                    : Math.abs(normalized) > 0.3 ? 'modéré'
                    : 'faible';

    const labels = {
      efg_diff:        `Efficacité de tir (eFG%) ${intensity} ${direction} — source ESPN`,
      ts_diff:         `Efficacité globale (TS%) ${intensity} ${direction} — source ESPN`,
      win_pct_diff:    `Bilan saison ${intensity} ${direction} — source ESPN`,
      home_away_split: `Contexte dom/ext ${intensity} ${direction} — source ESPN`,
      recent_form_ema: `Forme récente (EMA) ${intensity} ${direction} — source BallDontLie`,
      absences_impact: `Impact absences ${intensity} ${direction} — source NBA PDF officiel`,
      avg_pts_diff:    `Différentiel scoring ${intensity} ${direction} — source ESPN`,
    };

    return labels[varId] ?? `Variable ${varId} — signal ${intensity} ${direction}`;
  }
  // ── RECOMMANDATIONS PARIS (VALUE BETTING) ────────────────────────────────
  //
  // Convertit les cotes américaines en probabilité implicite.
  // Compare avec la probabilité calculée par le moteur.
  // Recommande uniquement les paris où le moteur détecte un edge positif.
  //
  // Score moteur [0,1] → probabilité victoire domicile.
  // Score > 0.5 = favori domicile. Score < 0.5 = favori extérieur.

  static _computeBettingRecommendations(score, odds, matchData) {
    const recs = [];

    // Normaliser les cotes (peuvent être des strings)
    odds = {
      ...odds,
      home_ml:    odds.home_ml !== null ? Number(odds.home_ml) : null,
      away_ml:    odds.away_ml !== null ? Number(odds.away_ml) : null,
      spread:     odds.spread !== null ? Number(odds.spread) : null,
      over_under: odds.over_under !== null ? Number(odds.over_under) : null,
    };

    const pHome = score;
    const pAway = 1 - score;

    // ── MONEYLINE ─────────────────────────────────────────────────────────
    if (odds.home_ml !== null && odds.away_ml !== null) {
      const impliedHome = this._americanToProb(odds.home_ml);
      const impliedAway = this._americanToProb(odds.away_ml);
      const edgeHome    = pHome - impliedHome;
      const edgeAway    = pAway - impliedAway;

      // Seuil Bloc A : 5% minimum, bloquer outsiders > +400
      const isExtremeOutsider = (edgeHome > 0 && odds.home_ml > 400) ||
                                 (edgeHome < 0 && odds.away_ml > 400);
      const absEdge = Math.abs(edgeHome);

      if (absEdge >= EDGE_THRESHOLDS.MONEYLINE && !isExtremeOutsider) {
        const side      = edgeHome > 0 ? 'HOME' : 'AWAY';
        const oddsLine  = side === 'HOME' ? odds.home_ml : odds.away_ml;
        const motorProb = side === 'HOME' ? pHome : pAway;
        const kelly     = this._computeKelly(motorProb, oddsLine);

        recs.push({
          type:         'MONEYLINE',
          label:        'Vainqueur du match',
          side,
          odds_line:    oddsLine,
          motor_prob:   Math.round(motorProb * 100),
          implied_prob: Math.round((side === 'HOME' ? impliedHome : impliedAway) * 100),
          edge:         Math.round(absEdge * 100),
          confidence:   this._edgeToConfidence(absEdge),
          has_value:    true,
          kelly_stake:  kelly,
        });
      }
    }

    // ── SPREAD ────────────────────────────────────────────────────────────
    if (odds.spread !== null) {
      const spread       = odds.spread;
      const motorMargin  = (score - 0.5) * 30;
      const spreadValue  = motorMargin - (-spread);
      const spreadEdgePct = Math.abs(spreadValue) / 30;

      if (spreadEdgePct >= EDGE_THRESHOLDS.SPREAD) {
        const side     = spreadValue > 0 ? 'HOME' : 'AWAY';
        const oddsLine = side === 'HOME' ? spread : -spread;
        const kelly    = this._computeKelly(0.52, -110); // prob approx spread ~52%

        recs.push({
          type:         'SPREAD',
          label:        'Handicap (spread)',
          side,
          odds_line:    oddsLine,
          motor_prob:   Math.round(Math.abs(motorMargin)),
          implied_prob: Math.round(Math.abs(spread)),
          edge:         Math.round(Math.abs(spreadValue)),
          confidence:   this._edgeToConfidence(spreadEdgePct),
          has_value:    spreadEdgePct >= EDGE_THRESHOLDS.SPREAD,
          note:         `Moteur estime ${Math.round(Math.abs(motorMargin))} pts d'écart vs spread ${spread > 0 ? '+' : ''}${spread}`,
          kelly_stake:  kelly,
        });
      }
    }

    // ── OVER/UNDER ────────────────────────────────────────────────────────
    if (odds.over_under !== null) {
      const homeAvgPts = matchData?.home_season_stats?.avg_pts;
      const awayAvgPts = matchData?.away_season_stats?.avg_pts;

      if (homeAvgPts != null && awayAvgPts != null) {
        const projectedTotal = homeAvgPts + awayAvgPts;
        const ouLine         = odds.over_under;
        const diff           = projectedTotal - ouLine;
        const ouEdgePct      = Math.abs(diff) / ouLine;

        if (ouEdgePct >= EDGE_THRESHOLDS.OVER_UNDER) {
          const side   = diff > 0 ? 'OVER' : 'UNDER';
          const kelly  = this._computeKelly(0.52, -110); // prob approx O/U ~52%

          recs.push({
            type:         'OVER_UNDER',
            label:        'Total de points',
            side,
            odds_line:    ouLine,
            motor_prob:   Math.round(projectedTotal),
            implied_prob: Math.round(ouLine),
            edge:         Math.round(Math.abs(diff)),
            confidence:   this._edgeToConfidence(ouEdgePct),
            has_value:    ouEdgePct >= EDGE_THRESHOLDS.OVER_UNDER,
            note:         `Moteur projette ${Math.round(projectedTotal)} pts total vs ligne ${ouLine}`,
            kelly_stake:  kelly,
          });
        }
      }
    }

    recs.sort((a, b) => b.edge - a.edge);
    const validRecs = recs.filter(r => r.has_value);

    return {
      recommendations: validRecs,
      best:            validRecs[0] ?? null,
      computed_at:     new Date().toISOString(),
    };
  }

  /**
   * Kelly Criterion Fractional (Kelly/4).
   * Retourne la mise recommandée en % du bankroll.
   * Plafond à 5%.
   * @param {number} p — probabilité estimée [0,1]
   * @param {number} americanOdds
   * @returns {number} — % du bankroll (ex: 0.03 = 3%)
   */
  static _computeKelly(p, americanOdds) {
    if (p === null || americanOdds === null) return null;
    const b = americanOdds > 0
      ? americanOdds / 100
      : 100 / Math.abs(americanOdds);
    const q     = 1 - p;
    const kelly = (b * p - q) / b;
    if (kelly <= 0) return 0;
    const fractional = kelly * KELLY_FRACTION;
    return Math.min(fractional, KELLY_MAX_PCT);
  }

  // Cotes américaines → probabilité implicite (avec marge bookmaker)
  static _americanToProb(american) {
    if (american === null || american === undefined) return null;
    if (american > 0) return 100 / (american + 100);
    return Math.abs(american) / (Math.abs(american) + 100);
  }

  // ── BACK-TO-BACK DETECTION ────────────────────────────────────────────────

  /**
   * Détecte si une équipe joue un back-to-back.
   * Source : champ back_to_back dans rawData (fourni par ESPN schedule si disponible).
   * Positif = extérieur en B2B (avantage domicile).
   * Négatif = domicile en B2B (désavantage domicile).
   */
  static _computeBackToBack(data) {
    const homeB2B = data?.home_back_to_back ?? null;
    const awayB2B = data?.away_back_to_back ?? null;

    if (homeB2B === null && awayB2B === null) {
      return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    }

    // +1 si extérieur en B2B, -1 si domicile en B2B, 0 si aucun ou les deux
    let value = 0;
    if (homeB2B && !awayB2B) value = -1;
    else if (!homeB2B && awayB2B) value = 1;

    return {
      value,
      source:  'espn_schedule',
      quality: 'VERIFIED',
      raw:     { home_b2b: homeB2B, away_b2b: awayB2B },
    };
  }

  /**
   * Différentiel de jours de repos.
   * Source : champ rest_days dans rawData.
   * Positif = domicile plus reposé.
   */
  static _computeRestDiff(data) {
    const homeRest = data?.home_rest_days ?? null;
    const awayRest = data?.away_rest_days ?? null;

    if (homeRest === null || awayRest === null) {
      return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    }

    return {
      value:   Math.max(-3, Math.min(3, homeRest - awayRest)),
      source:  'espn_schedule',
      quality: 'VERIFIED',
      raw:     { home_rest: homeRest, away_rest: awayRest },
    };
  }

  // Edge → niveau de confiance
  static _edgeToConfidence(edge) {
    if (edge >= 0.10) return 'FORTE';
    if (edge >= 0.06) return 'MOYENNE';
    return 'FAIBLE';
  }


}
