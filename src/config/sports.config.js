/**
 * MANI BET PRO — sports.config.js v4
 *
 * CHANGEMENTS v4 :
 *   - score_cap : 0.90 ajouté dans la config NBA.
 *     Le moteur ne peut pas dépasser 90% de probabilité — les scores 92-97%
 *     sont mathématiquement possibles mais empiriquement irréalistes en NBA.
 *     Appliqué dans engine.core.js après calcul, avant écriture de l'analyse.
 *     Le calcul brut (robustesse, Kelly) utilise le score non plafonné.
 *
 * CHANGEMENTS v3 :
 *   - win_pct_diff : 0.30 → 0.15 (trop influencé par le calendrier)
 *   - recent_form_ema : 0.15 → 0.25 (meilleur prédicteur court terme)
 *   - home_away_split : 0.12 → 0.15 (avantage domicile NBA documenté ~60%)
 *   - absences_impact : 0.01 → 0.10 (un star Out change fondamentalement le match)
 *   - efg_diff : 0.35 → 0.30 (toujours dominant, légèrement réduit)
 *   - ts_diff : 0.05 → 0.03 (redondant avec eFG%)
 *   - avg_pts_diff : 0.02 → 0.02 (maintenu — biaisé pace, mais marginal)
 *   Somme = 1.00 ✓
 *
 * Note : ces pondérations sont des hypothèses d'expert non calibrées empiriquement.
 * Elles seront ajustées par optimisation Brier Score après 100+ paris (Sprint 6).
 */

export const APP_CONFIG = {
  VERSION: '0.3.0',
  NAME:    'Mani Bet Pro',
  GITHUB_PAGES_URL: 'https://emmanueldelasse-droid.github.io/mani-bet-pro',
};

export const SPORTS_CONFIG = {

  // ── NBA ───────────────────────────────────────────────────────────────────
  NBA: {
    label:           'NBA',
    enabled:         true,
    sport_tag_class: 'sport-tag--nba',

    variables: [
      { id: 'efg_diff',        label: 'eFG% différentiel',             critical: false },
      { id: 'ts_diff',         label: 'TS% différentiel',              critical: false },
      { id: 'win_pct_diff',    label: 'Win% différentiel (saison)',    critical: false },
      { id: 'home_away_split', label: 'Split Domicile/Extérieur',      critical: false },
      { id: 'recent_form_ema', label: 'Forme récente (EMA W/L)',       critical: false },
      { id: 'absences_impact', label: 'Impact absences (PDF NBA)',     critical: false },
      { id: 'avg_pts_diff',    label: 'Points marqués (différentiel)', critical: false },
    ],

    /**
     * Pondérations v3 — recommandées dans prompt de référence v3.
     * Somme = 1.00.
     * STATUT : hypothèses d'expert — calibration empirique prévue Sprint 6.
     */
    default_weights: {
      efg_diff:        0.30,
      recent_form_ema: 0.25,
      home_away_split: 0.15,
      win_pct_diff:    0.15,
      absences_impact: 0.10,
      ts_diff:         0.03,
      avg_pts_diff:    0.02,
    },

    ema_lambda: 0.85,  // Décroissance exponentielle — proche de 1 = mémoire courte

    /**
     * Plafond score moteur — v4.
     * 90% = maximum empirique raisonnable en NBA.
     * Au-delà, le score reflète une accumulation de signaux extrêmes
     * (OKC vs équipe décimée) qui ne se traduit pas en edge réel.
     * Appliqué APRÈS le calcul brut pour ne pas biaiser la robustesse et Kelly.
     */
    score_cap: 0.90,

    rejection_thresholds: {
      min_robustness:             null,   // Non activé — à calibrer empiriquement
      min_data_quality:           null,   // Non activé — à calibrer empiriquement
      min_games_sample:           10,
      require_absences_confirmed: false,
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'LOW',
    modelisability:    'HIGH',

    simulator_defaults: {
      use_h2h:      false,   // Non disponible — prévu Sprint 3
      use_absences: true,
      use_rest:     false,   // Non disponible sans schedule complet
    },
  },

  // ── TENNIS ────────────────────────────────────────────────────────────────
  TENNIS: {
    label:           'Tennis ATP/WTA',
    enabled:         false,
    sport_tag_class: 'sport-tag--tennis',

    variables: [
      { id: 'surface_winrate_diff', label: 'Win rate surface',          critical: true  },
      { id: 'recent_form_ema',      label: 'Forme récente (EMA)',        critical: true  },
      { id: 'h2h_surface',          label: 'H2H sur même surface',       critical: false },
      { id: 'service_dominance',    label: 'Dominance au service',       critical: false },
      { id: 'fatigue_index',        label: 'Indice de fatigue',          critical: false },
      { id: 'ranking_elo_diff',     label: 'Différentiel Elo / Ranking', critical: false },
    ],

    default_weights: {
      surface_winrate_diff: null,
      recent_form_ema:      null,
      h2h_surface:          null,
      service_dominance:    null,
      fatigue_index:        null,
      ranking_elo_diff:     null,
    },

    ema_lambda: null,

    rejection_thresholds: {
      min_robustness:       null,
      min_data_quality:     null,
      min_games_sample:     8,
      min_h2h_same_surface: 2,
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'MEDIUM',
    modelisability:    'HIGH',

    simulator_defaults: {
      use_h2h:           true,
      use_fatigue:       true,
      use_service_stats: true,
    },
  },

  // ── MLB ───────────────────────────────────────────────────────────────────
  MLB: {
    label:           'MLB',
    enabled:         false,
    sport_tag_class: 'sport-tag--mlb',

    variables: [
      { id: 'pitcher_fip_diff', label: 'FIP différentiel pitchers',    critical: true  },
      { id: 'lineup_wrc_diff',  label: 'wRC+ différentiel lineups',    critical: true  },
      { id: 'bullpen_era_7d',   label: 'ERA Bullpen 7 derniers jours', critical: false },
      { id: 'park_factor',      label: 'Park factor stade',             critical: false },
      { id: 'home_away_split',  label: 'Domicile / Extérieur',          critical: false },
      { id: 'rest_pitcher',     label: 'Repos pitcher titulaire',       critical: false },
    ],

    default_weights: {
      pitcher_fip_diff: null,
      lineup_wrc_diff:  null,
      bullpen_era_7d:   null,
      park_factor:      null,
      home_away_split:  null,
      rest_pitcher:     null,
    },

    ema_lambda: null,

    rejection_thresholds: {
      min_robustness:            null,
      min_data_quality:          null,
      min_games_sample:          10,
      require_pitcher_confirmed: true,
      max_bullpen_data_age_days: 7,
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'MEDIUM',
    modelisability:    'HIGH',

    simulator_defaults: {
      use_park_factor: true,
      use_bullpen:     true,
      use_rest:        true,
    },
  },

  // ── FOOTBALL (désactivé — bruit intrinsèque trop élevé en V1) ────────────
  FOOTBALL: {
    label:                 'Football (EPL / La Liga)',
    enabled:               false,
    sport_tag_class:       'sport-tag--football',
    high_noise_disclaimer: true,
    intrinsic_noise:       'HIGH',
    modelisability:        'MEDIUM',
    variables:             [],
    default_weights:       {},
    ema_lambda:            null,
    rejection_thresholds:  { min_games_sample: 4 },
    sensitivity_steps:     [-0.25, -0.10, 0.10, 0.25],
    simulator_defaults:    { use_h2h: false },
  },
};

export function getSportConfig(sport) {
  const config = SPORTS_CONFIG[sport];
  if (!config)         return null;
  if (!config.enabled) return null;
  return config;
}

export function getEnabledSports() {
  return Object.entries(SPORTS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .map(([key]) => key);
}
