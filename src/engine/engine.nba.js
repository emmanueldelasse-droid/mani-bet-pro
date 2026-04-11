/**
 * MANI BET PRO — engine.nba.js v5.11
 *
 * AJOUTS v5.11 :
 *   - MONEYLINE edge minimum : 7% → 5% (aligné SPREAD/O/U).
 *     En NBA les books sont efficients — 7% bloquait quasi tous les Moneylines.
 *   - pace_diff : approximation depuis avg_pts si Tank01 ne fournit pas pace.
 *     proxy = (homeAvgPts + awayAvgPts) / 2 centré sur 225 (moyenne NBA).
 *     Améliore la projection O/U même sans Tank01 pace réel.
 *   - _computeAbsencesImpact : source 'tank01_roster' reconnue comme pondérée.
 *     Pipeline v6.27 — impact_weight calculé depuis roster Tank01 côté worker.
 *
 * AJOUTS v5.10 :
 *   - _computeStarAbsenceModifier : statut Limited ajouté (status_weight 0.4).
 *     Capture les joueurs qui jouent avec une restriction physique (retour blessure, minutes limitées).
 *
 * AJOUTS v5.9 :
 *   - _computeStarAbsenceModifier() : modificateur multiplicatif sur le score
 *     si une star (ppg > 20) est Out ou Doubtful pour l'une des deux équipes.
 *     Appliqué après _computeScore() avant le return — indépendant des poids.
 *     Formule : coefficient = 1 - (ppg/team_ppg) × status_weight × STAR_FACTOR
 *     Plafond : -20% max sur le score (modifier >= 0.80).
 *     STAR_PPG_THRESHOLD = 20, STAR_FACTOR = 1.2, MAX_REDUCTION = 0.20.
 *     Exposé dans star_absence_modifier pour traçabilité UI.
 *
 * AJOUTS v5.4 :
 *   - _computeAbsencesImpact() exploite le champ impact_weight pondéré par ppg
 *     issu de la route /nba/injuries/impact (ESPN + Tank01).
 *     Si source='tank01' → impact_weight = (ppg/team_ppg) × status_weight.
 *     Si source='fallback' → comportement ESPN brut (status_weight plat).
 *     Normalisation adaptée : seuil 1.0 (pondéré) vs 5.0 (brut ESPN).
 *     quality passe à 'WEIGHTED' quand Tank01 disponible.
 *
 * AJOUTS v5 :
 *   1. net_rating_diff — signal dominant depuis NBA Stats API
 *      Remplace win_pct_diff comme indicateur de qualité globale.
 *      Source : /nba/stats/advanced (stats.nba.com via Worker).
 *
 *   2. min_games_sample guard dans _safeDiff et _safeEMADiff.
 *      En v4, efg_pct sur 2 matchs (début de saison) était traité
 *      comme une stat fiable. Désormais : quality='LOW_SAMPLE' si
 *      games_played < MIN_GAMES (10 par défaut dans sports.config.js).
 *
 *   3. pace_diff — différentiel de pace entre les deux équipes.
 *      Utilisé pour améliorer le calcul O/U (avg_pts biaisé pace supprimé
 *      du calcul O/U, remplacé par projection pace × possessions).
 *
 * CORRECTIONS v5.1 :
 *   - O/U : motor_prob et implied_prob étaient des points (229, 219)
 *     au lieu de probabilités (55, 52). Corrigé.
 *   - O/U : ajout predicted_total et market_total dans la reco
 *     pour affichage correct dans l'UI et en console.
 */

import { SPORTS_CONFIG }                 from '../config/sports.config.js';
import { americanToProb, decimalToProb } from '../utils/utils.odds.js';
import { Logger }                         from '../utils/utils.logger.js';

const CONFIG   = SPORTS_CONFIG.NBA;
const MIN_GAMES = CONFIG.rejection_thresholds.min_games_sample ?? 10;

// Seuils edge minimum — v5.11 : MONEYLINE 7% → 5%
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.05,  // v5.11 : était 0.07, trop restrictif en NBA
  SPREAD:     0.03,
  OVER_UNDER: 0.03,
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION = 0.25;
const KELLY_MAX_PCT  = 0.05;

// Modificateur star absente — v5.9
const STAR_PPG_THRESHOLD = 20;   // seuil star (ppg saison)
const STAR_FACTOR        = 1.2;  // amplificateur impact star (à calibrer post-50 paris)
const STAR_MAX_REDUCTION = 0.20; // plafond réduction score (-20% max)
const STAR_TEAM_PPG_FALLBACK = 115; // ppg équipe si non disponible

export class EngineNBA {

  static compute(matchData, customWeights = null) {
    const weights = customWeights ?? CONFIG.default_weights;

    const variables = this._extractVariables(matchData);
    const { missing, missingCritical } = this._assessMissing(variables);

    const uncalibrated = Object.entries(weights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    let score = null, signals = [], volatility = null, scoreMethod = null;

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

    // v5.9 : Modificateur star absente — appliqué après _computeScore
    // Indépendant des poids — agit directement sur le score brut.
    // Exposé dans star_absence_modifier pour traçabilité.
    let starAbsenceModifier = null;
    if (score !== null) {
      starAbsenceModifier = this._computeStarAbsenceModifier(
        matchData?.home_injuries ?? null,
        matchData?.away_injuries ?? null
      );
      if (starAbsenceModifier !== null && starAbsenceModifier < 1.0) {
        score = Math.max(0, Math.min(1, Math.round(score * starAbsenceModifier * 1000) / 1000));
        scoreMethod = 'WEIGHTED_SUM+STAR_MODIFIER';
      }
    }

    // Recommandations paris — priorité aux marchés normalisés provider
    const hasOdds = matchData?.odds != null || matchData?.market_odds != null || matchData?.odds_markets != null;
    const bettingRecs = (score !== null && hasOdds)
      ? this._computeBettingRecommendations(score, matchData?.odds ?? {}, matchData, variables, signals)
      : null;

    Logger.debug('ENGINE_NBA_RESULT', {
      score, method: scoreMethod,
      missing_count: missing.length, critical_missing: missingCritical.length,
      star_modifier: starAbsenceModifier,
    });

    return {
      sport:                'NBA',
      score,
      score_method:         scoreMethod,
      signals,
      volatility,
      missing_variables:    missing,
      missing_critical:     missingCritical,
      uncalibrated_weights: uncalibrated,
      variables_used:       variables,
      star_absence_modifier: starAbsenceModifier,
      betting_recommendations: bettingRecs,
      computed_at:          new Date().toISOString(),
    };
  }

  /**
   * Calcul depuis variables déjà extraites — utilisé par engine.robustness.js.
   * NE PAS appeler compute() depuis la robustesse — ça re-extrairait depuis rawData.
   */
  static computeFromVariables(variables, weights) {
    if (!variables || !weights) return null;
    return this._computeScore(variables, weights).score;
  }

  // ── EXTRACTION ────────────────────────────────────────────────────────────

  static _extractVariables(data) {
    const homeStats    = data?.home_season_stats;
    const awayStats    = data?.away_season_stats;
    const homeRecent   = data?.home_recent;
    const awayRecent   = data?.away_recent;
    const homeInj      = data?.home_injuries;
    const awayInj      = data?.away_injuries;
    const advancedStats = data?.advanced_stats ?? null;  // depuis /nba/stats/advanced

    const homeGames = homeStats?.games_played ?? null;
    const awayGames = awayStats?.games_played ?? null;

    return {

      // ── Net Rating différentiel (NBA Stats API) ────────────────────────
      // Signal dominant — non biaisé par le calendrier contrairement à win%.
      // Positif = domicile a un meilleur Net Rating.
      net_rating_diff: this._safeAdvancedDiff(
        advancedStats,
        homeStats,
        awayStats,
        'net_rating'
      ),

      // ── eFG% différentiel ─────────────────────────────────────────────
      // CORRECTION v5 : garde min_games pour éviter les stats de 2-3 matchs
      efg_diff: this._safeDiff(
        this._guardStat(homeStats?.efg_pct, 0.40, 0.65),
        this._guardStat(awayStats?.efg_pct, 0.40, 0.65),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── TS% différentiel ──────────────────────────────────────────────
      ts_diff: this._safeDiff(
        homeStats?.ts_pct,
        awayStats?.ts_pct,
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Win% différentiel ─────────────────────────────────────────────
      // Rôle réduit depuis v3 (win% biaisé calendrier).
      // Toujours utile en début de saison quand net_rating absent.
      win_pct_diff: this._safeDiff(
        this._guardStat(homeStats?.win_pct, 0.01, 0.99),
        this._guardStat(awayStats?.win_pct, 0.01, 0.99),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Split domicile/extérieur ──────────────────────────────────────
      home_away_split: this._computeHomeSplit(homeStats, awayStats),

      // ── Forme récente EMA ─────────────────────────────────────────────
      // Ordre attendu : du plus récent au plus ancien (Worker BDL sort décroissant)
      recent_form_ema: this._safeEMADiff(
        homeRecent, awayRecent, CONFIG.ema_lambda
      ),

      // ── Impact absences ───────────────────────────────────────────────
      absences_impact: this._computeAbsencesImpact(homeInj, awayInj),

      // ── Points marqués différentiel ───────────────────────────────────
      // Gardé pour compatibilité mais poids faible (biaisé pace)
      avg_pts_diff: this._safeDiff(
        this._guardStat(homeStats?.avg_pts, 85, 135),
        this._guardStat(awayStats?.avg_pts, 85, 135),
        'espn_scoreboard',
        homeGames,
        awayGames
      ),

      // ── Défense adverse différentiel ─────────────────────────────────
      // defensive_rating = oppg (points encaissés par match) depuis Tank01.
      // Positif = domicile a une meilleure défense (encaisse moins).
      // Note : inversé par rapport aux autres signaux (moins = mieux pour la défense)
      // On inverse le signe : home_oppg - away_oppg → positif = home défend mieux
      defensive_diff: this._safeAdvancedDiff(
        advancedStats, homeStats, awayStats, 'defensive_rating', true  // invertSign=true
      ),

      // ── Pace différentiel ─────────────────────────────────────────────
      // Utilisé pour l'O/U. Non inclus dans les pondérations du score
      // principal — contextuel uniquement.
      // v5.11 : si Tank01 ne fournit pas pace (null), approximation depuis avg_pts.
      // proxy pace = (homeAvgPts + awayAvgPts) / 2 centré sur 225 (moyenne NBA).
      // Positif = matchs à rythme élevé → tendance OVER.
      pace_diff: (() => {
        const fromTank01 = this._safeAdvancedDiff(advancedStats, homeStats, awayStats, 'pace');
        if (fromTank01.value !== null) return fromTank01;
        // Approximation avg_pts comme proxy pace
        const hPts = homeStats?.avg_pts ?? null;
        const aPts = awayStats?.avg_pts ?? null;
        if (hPts === null || aPts === null) return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
        const avgTotal = hPts + aPts;
        const NBA_AVG_TOTAL = 225;
        return {
          value:   Math.round((avgTotal - NBA_AVG_TOTAL) * 10) / 10,
          source:  'espn_scoreboard_proxy',
          quality: 'ESTIMATED',
        };
      })(),

      // ── Back-to-back ──────────────────────────────────────────────────
      back_to_back: this._computeBackToBack(data),

      // ── Jours de repos ────────────────────────────────────────────────
      rest_days_diff: this._computeRestDiff(data),
    };
  }

  // ── SCORE ─────────────────────────────────────────────────────────────────

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
        why_signal:   this._explainSignal(varId, normValue, contribution),
      });
    }

    const raw   = totalWeight > 0 ? (weightedSum / totalWeight + 1) / 2 : null;
    const score = raw !== null
      ? Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000))
      : null;

    // v5.8 : weight_coverage = fraction des poids effectivement utilisés.
    // Ex: 0.80 = 80% des poids disponibles ont une variable non-null.
    // Transmis à engine.core.js → UI peut afficher un warning si < seuil.
    const totalDefinedWeight = Object.entries(weights)
      .filter(([, w]) => w !== null && w !== undefined && w > 0)
      .reduce((s, [, w]) => s + w, 0);
    const weightCoverage = totalDefinedWeight > 0
      ? Math.round((totalWeight / totalDefinedWeight) * 1000) / 1000
      : null;

    signals.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score,
      signals,
      volatility:      this._estimateVolatility(variables),
      weight_coverage: weightCoverage,
    };
  }

  // ── NORMALISATION ─────────────────────────────────────────────────────────

  static _normalizeVariables(variables) {
    return {
      // Net Rating : plage typique NBA ±10 → ±1
      net_rating_diff: this._clampNormalize(variables.net_rating_diff?.value, -10, 10),

      efg_diff:        this._clampNormalize(variables.efg_diff?.value,        -0.07, 0.07),
      ts_diff:         this._clampNormalize(variables.ts_diff?.value,         -0.07, 0.07),
      win_pct_diff:    variables.win_pct_diff?.value    ?? null,
      home_away_split: variables.home_away_split?.value ?? null,
      recent_form_ema: variables.recent_form_ema?.value ?? null,
      absences_impact: variables.absences_impact?.value ?? null,
      avg_pts_diff:    this._clampNormalize(variables.avg_pts_diff?.value,    -15,   15),
      back_to_back:    variables.back_to_back?.value    ?? null,
      rest_days_diff:  this._clampNormalize(variables.rest_days_diff?.value,  -3,    3),
      // defensive_diff : plage typique NBA ±5 pts encaissés → ±1
      defensive_diff:  this._clampNormalize(variables.defensive_diff?.value,  -5,    5),
      // pace_diff non inclus dans le score principal (contextuel O/U uniquement)
    };
  }

  static _clampNormalize(value, min, max) {
    if (value === null || value === undefined) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return (clamped - (min + max) / 2) / ((max - min) / 2);
  }

  // ── CALCULS SPÉCIFIQUES ───────────────────────────────────────────────────

  static _guardStat(value, min, max) {
    if (value === null || value === undefined) return null;
    if (value < min || value > max) return null;
    return value;
  }

  /**
   * Différentiel avec garde min_games_sample.
   * CORRECTION v5 : si games_played < MIN_GAMES → quality='LOW_SAMPLE'
   * Les stats de début de saison (2-5 matchs) ne doivent pas être traitées
   * comme des stats saison fiables.
   */
  static _safeDiff(homeVal, awayVal, source, homeGames = null, awayGames = null) {
    if (homeVal === null || homeVal === undefined ||
        awayVal === null || awayVal === undefined) {
      return { value: null, source, quality: 'MISSING' };
    }

    // Garde sample minimum
    if ((homeGames !== null && homeGames < MIN_GAMES) ||
        (awayGames !== null && awayGames < MIN_GAMES)) {
      return {
        value:  homeVal - awayVal,
        source,
        quality: 'LOW_SAMPLE',
        note:   `games_played insuffisant (home=${homeGames}, away=${awayGames}, min=${MIN_GAMES})`,
      };
    }

    return { value: homeVal - awayVal, source, quality: 'VERIFIED' };
  }

  /**
   * Différentiel depuis les stats avancées NBA Stats API.
   * advancedStats est indexé par nom d'équipe ESPN.
   * Si non disponible, fallback sur les stats ESPN directes (pour net_rating/pace).
   */
  /**
   * Différentiel depuis les stats avancées (Tank01/NBA Stats API).
   * @param {boolean} invertSign — si true, inverse le signe du diff (pour oppg : moins = mieux)
   */
  static _safeAdvancedDiff(advancedStats, homeStats, awayStats, field, invertSign = false) {
    if (advancedStats && homeStats?.name && awayStats?.name) {
      const homeAdv = advancedStats[homeStats.name] ?? advancedStats[homeStats.team_name];
      const awayAdv = advancedStats[awayStats.name] ?? advancedStats[awayStats.team_name];

      if (homeAdv?.[field] != null && awayAdv?.[field] != null) {
        const homeGames = homeAdv.games_played ?? homeStats?.games_played ?? null;
        const awayGames = awayAdv.games_played ?? awayStats?.games_played ?? null;

        const quality = (homeGames !== null && homeGames < MIN_GAMES) ||
                        (awayGames !== null && awayGames < MIN_GAMES)
          ? 'LOW_SAMPLE'
          : 'VERIFIED';

        const rawDiff = homeAdv[field] - awayAdv[field];
        return {
          value:   Math.round((invertSign ? -rawDiff : rawDiff) * 100) / 100,
          source:  'tank01',
          quality,
        };
      }
    }

    const homeVal = homeStats?.[field] ?? null;
    const awayVal = awayStats?.[field] ?? null;

    if (homeVal === null || awayVal === null) {
      return { value: null, source: 'tank01', quality: 'MISSING' };
    }

    const rawDiff = homeVal - awayVal;
    return { value: invertSign ? -rawDiff : rawDiff, source: 'espn_scoreboard', quality: 'PARTIAL' };
  }

  static _computeHomeSplit(homeStats, awayStats) {
    const h = homeStats?.home_win_pct;
    const a = awayStats?.away_win_pct;
    if (h == null || a == null) return { value: null, source: 'espn_scoreboard', quality: 'MISSING' };
    return {
      value:   Math.max(-1, Math.min(1, (h - a) * 2)),
      source:  'espn_scoreboard',
      quality: 'VERIFIED',
      raw:     { home_home_win_pct: h, away_away_win_pct: a },
    };
  }

  static _safeEMADiff(homeRecent, awayRecent, lambda) {
    if (!homeRecent?.matches || !awayRecent?.matches) {
      return { value: null, source: 'balldontlie_v1', quality: 'MISSING' };
    }
    if (lambda === null) {
      return { value: null, source: 'balldontlie_v1', quality: 'UNCALIBRATED' };
    }

    // CORRECTION v5 : garde min_games pour la forme récente également
    if (homeRecent.matches.length < 3 || awayRecent.matches.length < 3) {
      return { value: null, source: 'balldontlie_v1', quality: 'INSUFFICIENT_SAMPLE' };
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

  /**
   * EMA standard : λ · valeur_récente + (1-λ) · ema_précédente.
   * matches trié du plus récent au plus ancien (Worker BDL sort décroissant).
   * On inverse pour traiter du plus ancien au plus récent,
   * puis l'EMA finale est pondérée vers le plus récent.
   */
  static _computeEMA(matches, lambda) {
    if (!matches?.length) return null;
    const ordered = [...matches].reverse();
    let ema = null;
    for (const match of ordered) {
      if (match.won === null || match.won === undefined) continue;
      const result = match.won ? 1 : 0;
      ema = ema === null ? result : lambda * result + (1 - lambda) * ema;
    }
    return ema !== null ? ema * 2 - 1 : null;
  }

  /**
   * v5.4 : Impact absences pondéré par importance du joueur (ppg).
   *
   * Deux modes selon la source des données :
   *   - source='tank01'   → impact_weight = (ppg/team_ppg) × status_weight (calculé Worker)
   *                         normFactor = 1.0 (déjà normalisé par importance)
   *   - source='fallback' → impact_weight = status_weight brut ESPN (ancien comportement)
   *                         normFactor = 5.0 (seuil ESPN classique)
   *
   * La valeur finale (as - hs) / normFactor est clampée [-1, 1] :
   *   - Positive  = équipe domicile affaiblie par ses blessures
   *   - Négative  = équipe visiteuse affaiblie par ses blessures
   */
  static _computeAbsencesImpact(homeInj, awayInj) {
    if (!homeInj || !awayInj) return { value: null, source: 'espn_injuries', quality: 'MISSING' };

    const SW = { 'Out': 1.0, 'Doubtful': 0.75, 'Questionable': 0.5, 'Probable': 0.1, 'Available': 0.0 };

    const score = players => {
      if (!Array.isArray(players)) return 0;
      return players.reduce((acc, p) => {
        const isGL    = p.reason?.toLowerCase().includes('g league') || p.reason?.toLowerCase().includes('two-way');
        const glFactor = isGL ? 0.3 : 1.0;

        // Si impact_weight vient du calcul pondéré Tank01 (source='tank01') :
        // il représente déjà (ppg/team_ppg) × status_weight — on l'utilise directement.
        // Sinon : fallback sur status_weight brut ESPN.
        const impact = (p.source === 'tank01' && p.impact_weight != null)
          ? p.impact_weight * glFactor
          : (SW[p.status] ?? p.impact_weight ?? 0) * glFactor;

        return acc + impact;
      }, 0);
    };

    // Détecter si au moins un joueur provient de Tank01 (roster v6.27 ou player v6.26)
    const isWeighted = homeInj.some(p => p.source === 'tank01' || p.source === 'tank01_roster')
                    || awayInj.some(p => p.source === 'tank01' || p.source === 'tank01_roster');

    const hs = score(homeInj);
    const as = score(awayInj);

    // Normalisation :
    // - Pondéré ppg (Tank01) : impacts déjà relatifs à l'équipe → seuil 1.0
    // - Brut ESPN             : impacts absolus par statut        → seuil 5.0
    const normFactor = isWeighted ? 1.0 : 5.0;

    return {
      value:   Math.max(-1, Math.min(1, (as - hs) / normFactor)),
      source:  isWeighted ? 'espn_injuries+tank01' : 'nba_official_pdf',
      quality: isWeighted ? 'WEIGHTED' : 'ESTIMATED',
      raw: {
        home_score:  Math.round(hs * 1000) / 1000,
        away_score:  Math.round(as * 1000) / 1000,
        home_out:    homeInj.filter(p => p.status === 'Out').length,
        away_out:    awayInj.filter(p => p.status === 'Out').length,
        is_weighted: isWeighted,
      },
    };
  }


  /**
   * v5.9 : Calcule le modificateur multiplicatif si une star est absente.
   *
   * Une star = joueur avec ppg > STAR_PPG_THRESHOLD (20 pts/j).
   * Statuts concernés : Out (weight 1.0) et Doubtful (weight 0.75).
   * Day-To-Day non inclus — statut trop incertain pour un modificateur fort.
   *
   * Formule par joueur star absent :
   *   impact = (ppg / team_ppg) × status_weight × STAR_FACTOR
   *   modifier_equipe = 1 - clamp(impact, 0, STAR_MAX_REDUCTION)
   *
   * Modificateur final :
   *   - Si star DOM absente : modifier < 1 → score baisse (faveur visiteur)
   *   - Si star EXT absente : modifier > 1 → score monte (faveur domicile)
   *   - Si les deux : effets combinés
   *
   * Retourne null si aucune star absente détectée (pas de modification).
   *
   * @param {Array|null} homeInjuries
   * @param {Array|null} awayInjuries
   * @returns {number|null} modificateur [0.80, 1.20] ou null
   */
  static _computeStarAbsenceModifier(homeInjuries, awayInjuries) {
    // v5.9 : Out + Doubtful. v5.10 : Limited ajouté (retour blessure, minutes restreintes)
    const STAR_STATUSES = new Set(['Out', 'Doubtful', 'Limited']);
    const STATUS_WEIGHT = { 'Out': 1.0, 'Doubtful': 0.75, 'Limited': 0.4 };

    /**
     * Calcule la réduction de score due aux stars absentes d'une équipe.
     * Retourne un delta positif = réduction (ex: 0.12 = -12% sur le score).
     */
    const computeTeamReduction = (injuries) => {
      if (!Array.isArray(injuries) || injuries.length === 0) return 0;

      let totalReduction = 0;

      for (const player of injuries) {
        if (!STAR_STATUSES.has(player.status)) continue;

        const ppg = player.ppg ?? null;
        if (ppg === null || ppg <= STAR_PPG_THRESHOLD) continue;

        // ppg disponible via IA ou Tank01
        const sw     = STATUS_WEIGHT[player.status] ?? 0.75;
        const impact = (ppg / STAR_TEAM_PPG_FALLBACK) * sw * STAR_FACTOR;
        totalReduction += impact;
      }

      // Plafonner la réduction totale à STAR_MAX_REDUCTION
      return Math.min(totalReduction, STAR_MAX_REDUCTION);
    };

    const homeReduction = computeTeamReduction(homeInjuries);
    const awayReduction = computeTeamReduction(awayInjuries);

    // Aucune star absente — pas de modification
    if (homeReduction === 0 && awayReduction === 0) return null;

    // Score = probabilité domicile
    // Si dom affaibli → score baisse → modifier < 1
    // Si ext affaibli → score monte → modifier > 1
    // Formule : modifier = (1 - homeReduction) / (1 - awayReduction)
    // Exemple SA vs POR avec Wemby Doubtful :
    //   homeReduction = (24.8/115) × 0.75 × 1.2 = 0.194 → min(0.194, 0.20) = 0.194
    //   awayReduction = 0
    //   modifier = (1 - 0.194) / (1 - 0) = 0.806 → score SA : 0.89 × 0.806 = 0.717

    const modifier = (1 - homeReduction) / (1 - awayReduction);

    // Clamp final entre 0.75 et 1.25 (sécurité)
    return Math.round(Math.max(0.75, Math.min(1.25, modifier)) * 1000) / 1000;
  }

  static _computeBackToBack(data) {
    const h = data?.home_back_to_back ?? null, a = data?.away_back_to_back ?? null;
    if (h === null && a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    let value = 0;
    if (h && !a) value = -1;
    else if (!h && a) value = 1;
    return { value, source: 'espn_schedule', quality: 'VERIFIED', raw: { home_b2b: h, away_b2b: a } };
  }

  static _computeRestDiff(data) {
    const h = data?.home_rest_days ?? null, a = data?.away_rest_days ?? null;
    if (h === null || a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    return { value: Math.max(-3, Math.min(3, h - a)), source: 'espn_schedule', quality: 'VERIFIED', raw: { home_rest: h, away_rest: a } };
  }

  // ── VOLATILITÉ ────────────────────────────────────────────────────────────

  static _estimateVolatility(variables) {
    let vol = 0.20;
    const abs = variables.absences_impact?.value;
    if (abs !== null && Math.abs(abs) > 0.5) vol += 0.15;
    const hasLow = Object.values(variables).some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLow) vol += 0.10;
    return Math.min(1, Math.round(vol * 100) / 100);
  }

  // ── DONNÉES MANQUANTES ────────────────────────────────────────────────────

  static _assessMissing(variables) {
    const missing = [], missingCritical = [];
    for (const varConfig of CONFIG.variables) {
      const v = variables[varConfig.id];
      if (!v || v.value === null || v.quality === 'MISSING') {
        missing.push(varConfig.id);
        if (varConfig.critical) missingCritical.push(varConfig.id);
      }
    }
    return { missing, missingCritical };
  }

  // ── RECOMMANDATIONS PARIS ─────────────────────────────────────────────────

  static _computeBettingRecommendations(score, odds, matchData, variables, signals = []) {
    const recs = [];
    const marketOdds = matchData?.market_odds ?? null;
    const markets = matchData?.odds_markets ?? marketOdds?.odds_markets ?? {
      moneyline: marketOdds?.moneyline ?? null,
      spread: marketOdds?.spread ?? null,
      total: marketOdds?.total ?? null,
    };

    const moneylineMarket = (markets?.moneyline?.available)
      ? markets.moneyline
      : this._buildMoneylineMarketFromESPN(odds);
    const spreadMarket = markets?.spread?.available ? markets.spread : null;
    const totalMarket  = markets?.total?.available  ? markets.total  : null;

    const pHome = score;
    const pAway = 1 - score;

    // ── MONEYLINE ────────────────────────────────────────────────────────
    if (moneylineMarket?.available && moneylineMarket.home_american !== null && moneylineMarket.away_american !== null) {
      const impliedHome = americanToProb(moneylineMarket.home_american);
      const impliedAway = americanToProb(moneylineMarket.away_american);
      const edgeHome    = pHome - impliedHome;
      const absEdge     = Math.abs(edgeHome);

      const homeOdds = moneylineMarket.home_american;
      const awayOdds = moneylineMarket.away_american;
      const isExtreme = (edgeHome > 0 && homeOdds > 400) || (edgeHome < 0 && awayOdds > 400);

      if (absEdge >= EDGE_THRESHOLDS.MONEYLINE && !isExtreme) {
        const side        = edgeHome > 0 ? 'HOME' : 'AWAY';
        const motorProb   = side === 'HOME' ? pHome : pAway;
        const impliedProb = side === 'HOME' ? impliedHome : impliedAway;
        const american    = side === 'HOME' ? homeOdds : awayOdds;
        const decimal     = side === 'HOME' ? moneylineMarket.home_decimal : moneylineMarket.away_decimal;
        const realEdge    = motorProb - impliedProb;
        const isContrarian = (side === 'HOME' && score <= 0.5) || (side === 'AWAY' && score > 0.5);

        recs.push(this._buildBetRecommendation({
          type: 'MONEYLINE',
          label: 'Vainqueur du match',
          side,
          book_key: moneylineMarket.book_key,
          book_title: moneylineMarket.book_title,
          american_odds: american,
          decimal_odds: decimal,
          model_prob: motorProb,
          implied_prob: impliedProb,
          edge: realEdge,
          confidence: this._edgeToConfidence(Math.abs(realEdge)),
          kelly_stake: this._computeKelly(motorProb, american),
          is_contrarian: isContrarian,
          line: null,
        }));
      }
    }

    // ── SPREAD ───────────────────────────────────────────────────────────
    if (spreadMarket?.available && spreadMarket.line !== null) {
      const spreadLine = Number(spreadMarket.line);
      const NBA_SIGMA  = 12;
      const marketMargin = -spreadLine;
      const _sig = (id) => (signals.find(s => s.variable === id)?.normalized ?? 0);
      const adjustment = _sig('net_rating_diff') * 3.0
                       + _sig('efg_diff') * 1.5
                       + _sig('recent_form_ema') * 1.0
                       + _sig('absences_impact') * 2.5;
      const expectedMargin = marketMargin + Math.max(-8, Math.min(8, adjustment));
      const zHome = ((-spreadLine) - expectedMargin) / NBA_SIGMA;
      const pSpreadHome = 1 - this._normalCDF(zHome);
      const pSpreadAway = 1 - pSpreadHome;

      const impliedHome = decimalToProb(spreadMarket.home_decimal);
      const impliedAway = decimalToProb(spreadMarket.away_decimal);

      if (impliedHome !== null) {
        const edgeHome = pSpreadHome - impliedHome;
        if (edgeHome >= EDGE_THRESHOLDS.SPREAD) {
          recs.push(this._buildBetRecommendation({
            type: 'SPREAD',
            label: 'Handicap (spread)',
            side: 'HOME',
            book_key: spreadMarket.book_key,
            book_title: spreadMarket.book_title,
            american_odds: spreadMarket.home_american,
            decimal_odds: spreadMarket.home_decimal,
            model_prob: pSpreadHome,
            implied_prob: impliedHome,
            edge: edgeHome,
            confidence: this._edgeToConfidence(edgeHome),
            kelly_stake: this._computeKelly(pSpreadHome, spreadMarket.home_american),
            is_contrarian: false,
            line: spreadLine,
          }));
        }
      }

      if (impliedAway !== null) {
        const edgeAway = pSpreadAway - impliedAway;
        if (edgeAway >= EDGE_THRESHOLDS.SPREAD) {
          recs.push(this._buildBetRecommendation({
            type: 'SPREAD',
            label: 'Handicap (spread)',
            side: 'AWAY',
            book_key: spreadMarket.book_key,
            book_title: spreadMarket.book_title,
            american_odds: spreadMarket.away_american,
            decimal_odds: spreadMarket.away_decimal,
            model_prob: pSpreadAway,
            implied_prob: impliedAway,
            edge: edgeAway,
            confidence: this._edgeToConfidence(edgeAway),
            kelly_stake: this._computeKelly(pSpreadAway, spreadMarket.away_american),
            is_contrarian: false,
            line: -spreadLine,
            spread_line_display: spreadLine,
          }));
        }
      }
    }

    // ── OVER/UNDER ───────────────────────────────────────────────────────
    if (totalMarket?.available && totalMarket.line !== null) {
      const homeAvgPtsRaw = matchData?.home_season_stats?.avg_pts;
      const awayAvgPtsRaw = matchData?.away_season_stats?.avg_pts;
      const isLiveData = (homeAvgPtsRaw != null && (homeAvgPtsRaw < 60 || homeAvgPtsRaw > 140))
                      || (awayAvgPtsRaw != null && (awayAvgPtsRaw < 60 || awayAvgPtsRaw > 140));
      const homeAvgPts = isLiveData ? null : homeAvgPtsRaw;
      const awayAvgPts = isLiveData ? null : awayAvgPtsRaw;

      if (homeAvgPts != null && awayAvgPts != null) {
        const ouLine = Number(totalMarket.line);
        const absImpact  = variables?.absences_impact?.value ?? 0;
        const homeInjAdj = absImpact > 0 ? -homeAvgPts * absImpact * 0.12 : 0;
        const awayInjAdj = absImpact < 0 ? -awayAvgPts * Math.abs(absImpact) * 0.12 : 0;
        const paceDiff = variables?.pace_diff?.value ?? null;
        const paceAdj  = paceDiff !== null ? paceDiff * 0.5 : 0;

        const projectedTotal = homeAvgPts + homeInjAdj + awayAvgPts + awayInjAdj + paceAdj;
        const diff           = projectedTotal - ouLine;
        const side           = diff > 0 ? 'OVER' : 'UNDER';
        const motorProb      = 0.50 + 0.15 * (1 - Math.exp(-Math.abs(diff) / 12));
        const decimalOdds    = side === 'OVER' ? totalMarket.over_decimal : totalMarket.under_decimal;
        const impliedProb    = decimalToProb(decimalOdds);
        const americanOdds   = side === 'OVER' ? totalMarket.over_american : totalMarket.under_american;

        if (impliedProb !== null) {
          const edge = motorProb - impliedProb;
          if (edge >= EDGE_THRESHOLDS.OVER_UNDER) {
            const adjParts = [];
            if (paceDiff !== null) adjParts.push(`pace ${paceAdj > 0 ? '+' : ''}${paceAdj.toFixed(1)}`);
            if (homeInjAdj !== 0) adjParts.push(`inj.dom ${homeInjAdj.toFixed(1)}`);
            if (awayInjAdj !== 0) adjParts.push(`inj.ext ${awayInjAdj.toFixed(1)}`);
            const adjNote = adjParts.length > 0 ? ` (${adjParts.join(', ')})` : '';

            recs.push(this._buildBetRecommendation({
              type: 'OVER_UNDER',
              label: 'Total de points',
              side,
              book_key: totalMarket.book_key,
              book_title: totalMarket.book_title,
              american_odds: americanOdds,
              decimal_odds: decimalOdds,
              model_prob: motorProb,
              implied_prob: impliedProb,
              edge,
              confidence: this._edgeToConfidence(edge),
              kelly_stake: this._computeKelly(motorProb, americanOdds),
              line: ouLine,
              note: `Projection ${Math.round(projectedTotal)} pts${adjNote} · ligne ${ouLine}`,
              predicted_total: Math.round(projectedTotal),
              market_total: ouLine,
            }));
          }
        }
      }
    }

    recs.sort((a, b) => b.edge - a.edge);
    const validRecs = recs.filter(r => r.has_value);
    return { recommendations: validRecs, best: validRecs[0] ?? null, computed_at: new Date().toISOString() };
  }

  static _buildMoneylineMarketFromESPN(odds = {}) {
    const homeAmerican = odds?.home_ml != null ? Number(odds.home_ml) : null;
    const awayAmerican = odds?.away_ml != null ? Number(odds.away_ml) : null;
    if (homeAmerican === null || awayAmerican === null) return null;
    return {
      available: true,
      market_type: 'moneyline',
      book_key: 'espn',
      book_title: odds?.source ?? 'ESPN',
      home_american: homeAmerican,
      away_american: awayAmerican,
      home_decimal: this._americanToDecimal(homeAmerican),
      away_decimal: this._americanToDecimal(awayAmerican),
    };
  }

  static _americanToDecimal(americanOdds) {
    const a = Number(americanOdds);
    if (!Number.isFinite(a) || a === 0) return null;
    return a > 0 ? Math.round((1 + a / 100) * 1000) / 1000 : Math.round((1 + 100 / Math.abs(a)) * 1000) / 1000;
  }

  static _buildBetRecommendation({
    type, label, side, book_key = null, book_title = null, american_odds = null, decimal_odds = null,
    model_prob, implied_prob, edge, confidence, kelly_stake = null, is_contrarian = false,
    line = null, note = null, predicted_total = null, market_total = null, spread_line_display = null,
  }) {
    const recommendation = {
      type,
      label,
      side,
      odds_line: american_odds,
      odds_decimal: decimal_odds,
      odds_source: book_title ?? book_key ?? 'Unknown',
      odds_book_key: book_key,
      motor_prob: Math.round(model_prob * 100),
      implied_prob: Math.round(implied_prob * 100),
      edge: Math.round(edge * 100),
      confidence,
      has_value: true,
      kelly_stake,
      is_contrarian,
      market_line: line,
      note: note ?? null,
    };

    if (type === 'SPREAD') {
      recommendation.spread_line = spread_line_display ?? line;
    }
    if (type === 'OVER_UNDER') {
      recommendation.ou_line = line;
      recommendation.predicted_total = predicted_total;
      recommendation.market_total = market_total;
    }
    return recommendation;
  }

  static _computeKelly(p, americanOdds) {
    if (p === null || americanOdds === null) return null;
    const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
    const kelly = (b * p - (1 - p)) / b;
    if (kelly <= 0) return 0;
    return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
  }

  static _getBestBookOdds(marketOdds, side, market) {
    if (!marketOdds?.bookmakers?.length) return null;

    // Priorité bookmaker : Winamax > Pinnacle > meilleure cote disponible
    // Winamax = bookmaker principal pour le pari réel
    // Pinnacle = fallback marché efficient si Winamax absent
    const PRIORITY = ['winamax', 'pinnacle', 'betclic', 'unibet_eu', 'betsson', 'bet365'];

    const _getOdds = (bk) => {
      if (market === 'h2h')      return side === 'HOME' ? bk.home_ml : bk.away_ml;
      if (market === 'spreads')  return side === 'HOME' ? bk.home_spread : bk.away_spread;
      if (market === 'totals')   return side === 'OVER' ? bk.over_total : bk.under_total;
      return null;
    };

    // Chercher d'abord dans l'ordre de priorité
    for (const key of PRIORITY) {
      const bk = marketOdds.bookmakers.find(b => b.key === key);
      if (!bk) continue;
      const oddsDecimal = _getOdds(bk);
      if (!oddsDecimal || oddsDecimal <= 1) continue;
      const american = oddsDecimal >= 2
        ? Math.round((oddsDecimal - 1) * 100)
        : Math.round(-100 / (oddsDecimal - 1));
      return { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
    }

    // Fallback : meilleure cote disponible tous bookmakers
    let best = null;
    for (const bk of marketOdds.bookmakers) {
      const oddsDecimal = _getOdds(bk);
      if (!oddsDecimal || oddsDecimal <= 1) continue;
      const american = oddsDecimal >= 2 ? Math.round((oddsDecimal - 1) * 100) : Math.round(-100 / (oddsDecimal - 1));
      if (!best || oddsDecimal > best.decimalOdds) {
        best = { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
      }
    }
    return best;
  }

  static _explainSignal(varId, normalized, contribution) {
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

  static _edgeToConfidence(edge) {
    if (edge >= 0.10) return 'FORTE';
    if (edge >= 0.06) return 'MOYENNE';
    return 'FAIBLE';
  }

  static _normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z >= 0 ? 1 - p : p;
  }
}
