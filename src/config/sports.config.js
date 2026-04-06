/**
 * MANI BET PRO — sports.config.js v5
 *
 * CHANGEMENTS v5 — audit complet pondérations :
 *   - net_rating_diff : 0 -> 0.30  (ACTIVE — etait extrait mais ignore depuis v3 !)
 *     Signal dominant Tank01, non biaise calendrier. Correction majeure.
 *   - efg_diff : 0.30 -> 0.22      (reduit — net_rating prend le relais)
 *   - recent_form_ema : 0.25 -> 0.20 (legerement reduit)
 *   - home_away_split : 0.15 -> 0.12 (formule agressive -> poids reduit)
 *   - win_pct_diff : 0.15 -> 0.04  (fortement reduit — biaise calendrier fin saison)
 *   - absences_impact : 0.10       (maintenu — pondere ppg Tank01 depuis v5.4)
 *   - back_to_back : 0 -> 0.01     (ACTIVE — etait extrait mais ignore)
 *   - rest_days_diff : 0 -> 0.01   (ACTIVE — etait extrait mais ignore)
 *   - ts_diff : 0.03 -> 0.00       (SUPPRIME — redondant efg_diff, correlation ~0.85)
 *   - avg_pts_diff : 0.02 -> 0.00  (SUPPRIME — doublon bruité avec net_rating_diff)
 *   Somme = 0.30+0.22+0.20+0.12+0.10+0.04+0.01+0.01 = 1.00
 *
 * CHANGEMENTS v4 :
 *   - score_cap : 0.90 ajoute dans la config NBA.
 *
 * Note : ces ponderations sont des hypotheses d'expert non calibrees empiriquement.
 * Elles seront ajustees par optimisation Brier Score apres 50+ paris (Sprint 6).
 */

export const APP_CONFIG = {
  VERSION: '0.3.0',
  NAME:    'Mani Bet Pro',
  GITHUB_PAGES_URL: 'https://emmanueldelasse-droid.github.io/mani-bet-pro',
};

export const SPORTS_CONFIG = {

  // NBA
  NBA: {
    label:           'NBA',
    enabled:         true,
    sport_tag_class: 'sport-tag--nba',

    variables: [
      { id: 'net_rating_diff', label: 'Net Rating differentiel (Tank01)',  critical: false },
      { id: 'efg_diff',        label: 'eFG% differentiel',                 critical: false },
      { id: 'recent_form_ema', label: 'Forme recente (EMA W/L)',            critical: false },
      { id: 'home_away_split', label: 'Split Domicile/Exterieur',           critical: false },
      { id: 'absences_impact', label: 'Impact absences (ESPN + Tank01)',    critical: false },
      { id: 'win_pct_diff',    label: 'Win% differentiel (saison)',         critical: false },
      { id: 'back_to_back',    label: 'Back-to-back',                       critical: false },
      { id: 'rest_days_diff',  label: 'Jours de repos',                     critical: false },
    ],

    /**
     * Ponderations v5 — audit complet 06/04/2026.
     * Somme = 1.00.
     * STATUT : hypotheses d'expert — calibration empirique prevue Sprint 6 (50+ paris).
     *
     * Signaux retires du score principal (conserves pour O/U et debug) :
     *   ts_diff     : redondant avec efg_diff (correlation ~0.85)
     *   avg_pts_diff: doublon bruité avec net_rating_diff
     *   pace_diff   : contextuel O/U uniquement
     */
    default_weights: {
      net_rating_diff:  0.30,
      efg_diff:         0.22,
      recent_form_ema:  0.20,
      home_away_split:  0.12,
      absences_impact:  0.10,
      win_pct_diff:     0.04,
      back_to_back:     0.01,
      rest_days_diff:   0.01,
    },

    ema_lambda: 0.85,

    /**
     * Plafond score moteur — v4.
     * 90% = maximum empirique raisonnable en NBA.
     * Applique APRES calcul brut pour ne pas biaiser robustesse et Kelly.
     */
    score_cap: 0.90,

    rejection_thresholds: {
      min_robustness:             null,
      min_data_quality:           null,
      min_games_sample:           10,
      require_absences_confirmed: false,
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'LOW',
    modelisability:    'HIGH',

    simulator_defaults: {
      use_h2h:      false,
      use_absences: true,
      use_rest:     true,
    },
  },

  // TENNIS
  TENNIS: {
    label:           'Tennis ATP/WTA',
    enabled:         false,
    sport_tag_class: 'sport-tag--tennis',

    variables: [
      { id: 'surface_winrate_diff', label: 'Win rate surface',          critical: true  },
      { id: 'recent_form_ema',      label: 'Forme recente (EMA)',        critical: true  },
      { id: 'h2h_surface',          label: 'H2H sur meme surface',       critical: false },
      { id: 'service_dominance',    label: 'Dominance au service',       critical: false },
      { id: 'fatigue_index',        label: 'Indice de fatigue',          critical: false },
      { id: 'ranking_elo_diff',     label: 'Differentiel Elo / Ranking', critical: false },
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

  // MLB
  MLB: {
    label:           'MLB',
    enabled:         false,
    sport_tag_class: 'sport-tag--mlb',

    variables: [
      { id: 'pitcher_fip_diff', label: 'FIP differentiel pitchers',    critical: true  },
      { id: 'lineup_wrc_diff',  label: 'wRC+ differentiel lineups',    critical: true  },
      { id: 'bullpen_era_7d',   label: 'ERA Bullpen 7 derniers jours', critical: false },
      { id: 'park_factor',      label: 'Park factor stade',             critical: false },
      { id: 'home_away_split',  label: 'Domicile / Exterieur',          critical: false },
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

  // FOOTBALL (desactive)
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
