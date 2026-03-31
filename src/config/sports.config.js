/**
 * MANI BET PRO — sports.config.js v2
 *
 * Sources de données :
 *   ESPN API (gratuite, sans clé) → matchs + stats avancées + cotes DraftKings
 *   PDF NBA officiel (gratuit)     → injury reports (via Worker + Claude Haiku)
 *   BallDontLie v1 (avec clé)      → forme récente W/L
 *
 * Pondérations NBA activées — calibrables empiriquement.
 * La somme des poids actifs doit être égale à 1.0.
 */

export const APP_CONFIG = {
  VERSION: '0.2.0',
  NAME: 'Mani Bet Pro',
  GITHUB_PAGES_URL: 'https://emmanueldelasse-droid.github.io/mani-bet-pro',
};

export const SPORTS_CONFIG = {

  // ── NBA ──────────────────────────────────────────────────────────────────
  NBA: {
    label: 'NBA',
    enabled: true,
    sport_tag_class: 'sport-tag--nba',

    variables: [
      { id: 'efg_diff',          label: 'eFG% différentiel',            critical: true  },
      { id: 'ts_diff',           label: 'TS% différentiel',             critical: false },
      { id: 'win_pct_diff',      label: 'Win% différentiel (saison)',   critical: true  },
      { id: 'home_away_split',   label: 'Split Domicile/Extérieur',     critical: false },
      { id: 'recent_form_ema',   label: 'Forme récente (EMA W/L)',      critical: true  },
      { id: 'absences_impact',   label: 'Impact absences (PDF NBA)',    critical: false },
      { id: 'avg_pts_diff',      label: 'Points marqués (différentiel)',critical: false },
    ],

    /**
     * Pondérations activées.
     * Somme = 1.0. Ajuster empiriquement selon backtesting.
     * Note : absences_impact pondéré à 0 tant que données non confirmées.
     */
    default_weights: {
      efg_diff:        0.30,   // eFG% = meilleur proxy efficacité offensive ESPN
      win_pct_diff:    0.25,   // Win% saison = indicateur de niveau général
      recent_form_ema: 0.20,   // Forme récente (BallDontLie W/L)
      home_away_split: 0.15,   // Split dom/ext ESPN
      ts_diff:         0.05,   // TS% = complémentaire eFG%
      avg_pts_diff:    0.03,   // Points/match = indicateur scoring
      absences_impact: 0.02,   // Impact absences (PDF NBA) — faible tant que non calibré
    },

    ema_lambda: 0.85,   // Décroissance exponentielle forme récente

    rejection_thresholds: {
      min_robustness:             null,    // Non activé — à calibrer
      min_data_quality:           null,    // Non activé — à calibrer
      min_games_sample:           10,      // Minimum 10 matchs pour les stats
      require_absences_confirmed: false,   // Ne pas rejeter si absences non confirmées
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'LOW',
    modelisability:    'HIGH',

    simulator_defaults: {
      use_h2h:        false,   // H2H non disponible en V2
      use_absences:   true,
      use_rest:       false,   // Repos non disponible sans schedule complet
    },
  },

  // ── TENNIS ───────────────────────────────────────────────────────────────
  TENNIS: {
    label: 'Tennis ATP/WTA',
    enabled: false,
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
      min_robustness:        null,
      min_data_quality:      null,
      min_games_sample:      8,
      min_h2h_same_surface:  2,
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise: 'MEDIUM',
    modelisability: 'HIGH',

    simulator_defaults: {
      use_h2h:           true,
      use_fatigue:       true,
      use_service_stats: true,
    },
  },

  // ── MLB ───────────────────────────────────────────────────────────────────
  MLB: {
    label: 'MLB',
    enabled: false,
    sport_tag_class: 'sport-tag--mlb',

    variables: [
      { id: 'pitcher_fip_diff',  label: 'FIP différentiel pitchers',   critical: true  },
      { id: 'lineup_wrc_diff',   label: 'wRC+ différentiel lineups',   critical: true  },
      { id: 'bullpen_era_7d',    label: 'ERA Bullpen 7 derniers jours', critical: false },
      { id: 'park_factor',       label: 'Park factor stade',            critical: false },
      { id: 'home_away_split',   label: 'Domicile / Extérieur',         critical: false },
      { id: 'rest_pitcher',      label: 'Repos pitcher titulaire',      critical: false },
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
    intrinsic_noise: 'MEDIUM',
    modelisability: 'HIGH',

    simulator_defaults: {
      use_park_factor: true,
      use_bullpen:     true,
      use_rest:        true,
    },
  },

  // ── FOOTBALL (désactivé V1) ───────────────────────────────────────────────
  FOOTBALL: {
    label: 'Football (EPL / La Liga)',
    enabled: false,
    sport_tag_class: 'sport-tag--football',
    high_noise_disclaimer: true,
    intrinsic_noise: 'HIGH',
    modelisability: 'MEDIUM',
    variables: [],
    default_weights: {},
    ema_lambda: null,
    rejection_thresholds: { min_games_sample: 4 },
    sensitivity_steps: [-0.25, -0.10, 0.10, 0.25],
    simulator_defaults: { use_h2h: false },
  },
};

export function getSportConfig(sport) {
  const config = SPORTS_CONFIG[sport];
  if (!config) return null;
  if (!config.enabled) return null;
  return config;
}

export function getEnabledSports() {
  return Object.entries(SPORTS_CONFIG)
    .filter(([, cfg]) => cfg.enabled)
    .map(([key]) => key);
}
