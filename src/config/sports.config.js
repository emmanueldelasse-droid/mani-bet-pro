/**
 * MANI BET PRO — sports.config.js v6.5
 *
 * AJOUTS v6.4 :
 *   - NBA_TEAMS : table centrale des 30 équipes NBA (abv, espn, bdl_id).
 *     Source de vérité unique — remplace les objets TEAM_NAME_TO_BDL_ID et
 *     ABV_TO_ESPN_NAME qui étaient dupliqués dans data.orchestrator.js.
 *     Helpers exportés : getNBAAbvFromEspn, getNBAEspnFromAbv, getNBABdlIdFromEspn.
 *     data.orchestrator.js dérive ses lookups depuis NBA_TEAMS au lieu de les
 *     redéfinir — une seule mise à jour nécessaire en cas de relocalisation d'équipe.
 *
 * CHANGEMENTS v6 — défense adverse :
 *   - defensive_diff : 0 → 0.05 (NOUVEAU — oppg Tank01, 0 appel supplémentaire)
 *   - net_rating_diff : 0.30 → 0.28, efg_diff : 0.22 → 0.20, recent_form : 0.20 → 0.18
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
      { id: 'defensive_diff',  label: 'Défense adverse (Tank01)',            critical: false },
      { id: 'back_to_back',    label: 'Back-to-back',                       critical: false },
      { id: 'rest_days_diff',  label: 'Jours de repos',                     critical: false },
      { id: 'b2b_cumul_diff',  label: 'B2B cumulé (5 derniers)',            critical: false },
      { id: 'travel_load_diff',label: 'Charge voyage (5 derniers)',         critical: false },
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
      net_rating_diff:   0.22,
      efg_diff:          0.18,
      recent_form_ema:   0.16,
      home_away_split:   0.10,
      absences_impact:   0.20,
      defensive_diff:    0.02,
      win_pct_diff:      0.04,
      back_to_back:      0.02,
      rest_days_diff:    0.02,
      b2b_cumul_diff:    0.02,
      travel_load_diff:  0.02,
      // Somme = 0.22+0.18+0.16+0.10+0.20+0.02+0.04+0.02+0.02+0.02+0.02 = 1.00
    },

    /**
     * Ponderations Play-In / Play-Off — v6.0
     * Actives automatiquement mi-avril → mi-juin via getNBAPhase().
     *
     * Logique playoff vs saison régulière :
     *   absences_impact  ↑ 0.20 → 0.30  rotations courtes (~8 joueurs), star = irremplaçable
     *                                    STAR_FACTOR 1.55→2.0, STAR_MAX_REDUCTION 0.45→0.55
     *   recent_form_ema  ↑ 0.16 → 0.24  EMA resserrée λ=0.92 (vs 0.85), fenêtre efficace ~5 matchs
     *   defensive_diff   ↑ 0.02 → 0.12  défense prime en playoffs (adaptation tactique match/match)
     *   home_away_split  = 0.10 → 0.14  ~65% victoires domicile en playoff (vs ~59% saison)
     *   net_rating_diff  ↓ 0.24 → 0.08  stats saison régulière = peu prédictives en série
     *   efg_diff         ↓ 0.18 → 0.04  défenses s'adaptent spécifiquement au tir adverse
     *   rest_days_diff   ↑ 0.02 → 0.06  repos entre séries = avantage réel
     *   win_pct_diff     ↓ 0.05 → 0.02  bilan saison quasi inutile en série
     *   back_to_back     → 0.00         inexistant en playoffs (1 match / 2j minimum)
     * Somme = 0.30+0.24+0.14+0.12+0.08+0.06+0.04+0.02+0.00 = 1.00
     *
     * Vérifications effectuées :
     *   series_lead_factor : NON calculable (h2h = saison régulière, pas série en cours)
     *   coaching_adjustment : NON calculable (variance indisponible en temps réel)
     *   seuil star : maintenu 20ppg (18-20ppg = 2nd option, impact marginal)
     *   score_cap : 0.90 → 0.80 (séries serrées, pas de mismatch >80%)
     *   ema_lambda playoff : 0.85 → 0.92 (matchs récents >> anciens)
     *   require_absences_confirmed : true en playoffs
     * STATUT : hypothèses d'expert raisonnées — calibration après 50+ paris playoff.
     */
    playoff_weights: {
      absences_impact:   0.30,
      recent_form_ema:   0.24,
      home_away_split:   0.14,
      defensive_diff:    0.12,
      net_rating_diff:   0.06,
      rest_days_diff:    0.06,
      efg_diff:          0.04,
      travel_load_diff:  0.02,
      win_pct_diff:      0.02,
      back_to_back:      0.00,
      b2b_cumul_diff:    0.00,
      // Somme = 0.30+0.24+0.14+0.12+0.06+0.06+0.04+0.02+0.02+0.00+0.00 = 1.00
    },

    // EMA lambda par phase — 0.85 saison régulière, 0.92 playoffs
    ema_lambda:         0.85,
    ema_lambda_playoff: 0.92,

    /**
     * Plafond score moteur par phase.
     * Saison : 0.90 — Playoffs : 0.80 (séries toujours serrées).
     * Appliqué APRÈS calcul brut pour ne pas biaiser robustesse et Kelly.
     */
    score_cap:         0.90,
    score_cap_playoff: 0.80,

    rejection_thresholds: {
      min_robustness:             null,
      min_data_quality:           null,
      min_games_sample:           10,
      require_absences_confirmed: false,
      require_absences_confirmed_playoff: true,
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

  // TENNIS ATP
  // Sources : The Odds API (cotes h2h) + Jeff Sackmann CSV (stats joueurs)
  // Activé v6.2 — Monte-Carlo 13-20 avril 2026
  // Poids provisoires — à calibrer après 30+ paris (Brier Score)
  TENNIS: {
    label:           'Tennis ATP',
    enabled:         true,
    sport_tag_class: 'sport-tag--tennis',

    variables: [
      { id: 'ranking_elo_diff',     label: 'Différentiel classement ATP', critical: true  },
      { id: 'surface_winrate_diff', label: 'Win rate sur la surface',     critical: true  },
      { id: 'recent_form_ema',      label: 'Forme récente (EMA 10)',      critical: false },
      { id: 'pressure_dominance',   label: 'Dominance break points',      critical: false },
      { id: 'h2h_surface',          label: 'H2H même surface',            critical: false },
      { id: 'service_dominance',    label: 'Dominance au service',        critical: false },
      { id: 'physical_load_diff',   label: 'Charge physique 14j',         critical: false },
      { id: 'fatigue_index',        label: 'Indice de fatigue',           critical: false },
    ],

    // Poids provisoires basés sur littérature tennis betting
    // ranking_diff + pressure_dominance = prédicteurs les plus stables
    // surface_winrate = essentiel sur terre battue
    // Somme = 0.30+0.25+0.13+0.12+0.07+0.05+0.05+0.03 = 1.00
    default_weights: {
      ranking_elo_diff:     0.30,
      surface_winrate_diff: 0.25,
      recent_form_ema:      0.13,
      pressure_dominance:   0.12,
      h2h_surface:          0.07,
      service_dominance:    0.05,
      physical_load_diff:   0.05,
      fatigue_index:        0.03,
    },

    ema_lambda:  0.3,   // EMA plus réactive que NBA (matchs moins fréquents)
    score_cap:   0.85,  // Plus conservateur que NBA — tennis plus aléatoire

    rejection_thresholds: {
      min_robustness:       0.40,   // seuil bas — données partielles acceptées
      min_data_quality:     0.50,   // idem
      min_games_sample:     8,      // minimum 8 matchs sur la surface sur 12 mois
      min_h2h_same_surface: 0,      // H2H pas critique — souvent 0 ou 1
    },

    sensitivity_steps: [-0.20, -0.10, 0.10, 0.20],
    intrinsic_noise:   'MEDIUM',
    modelisability:    'HIGH',

    // Tournois couverts — sport_key The Odds API
    tournaments: {
      monte_carlo:  { key: 'tennis_atp_monte_carlo_masters', surface: 'Clay',  label: 'Monte-Carlo Masters' },
      madrid:       { key: 'tennis_atp_madrid_open',          surface: 'Clay',  label: 'Madrid Open' },
      rome:         { key: 'tennis_atp_italian_open',          surface: 'Clay',  label: 'Rome Masters' },
      french_open:  { key: 'tennis_atp_french_open',           surface: 'Clay',  label: 'Roland Garros' },
      wimbledon:    { key: 'tennis_atp_wimbledon',             surface: 'Grass', label: 'Wimbledon' },
      us_open:      { key: 'tennis_atp_us_open',               surface: 'Hard',  label: 'US Open' },
    },

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

/**
 * NBA_TEAMS — source de vérité unique pour les mappings d'équipes NBA.
 *
 * Chaque entrée contient :
 *   abv     : abréviation Tank01 (clé primaire — conforme aux abbréviations confirmées :
 *             GS, NO, NY, SA pour les cas non-standard)
 *   espn    : nom complet ESPN (utilisé comme clé dans les données ESPN/BDL)
 *   bdl_id  : ID BallDontLie (1–30, API BDL v1)
 *
 * Usage : importer NBA_TEAMS et dériver les lookups nécessaires via les helpers
 * exportés ci-dessous (getNBATeamByAbv, getNBATeamByEspn, etc.).
 * NE PAS dupliquer ces données dans d'autres fichiers.
 *
 * Mis à jour : sports.config.js v6.5
 */
export const NBA_TEAMS = [
  { abv: 'ATL', espn: 'Atlanta Hawks',           bdl_id: '1'  },
  { abv: 'BOS', espn: 'Boston Celtics',           bdl_id: '2'  },
  { abv: 'BKN', espn: 'Brooklyn Nets',            bdl_id: '3'  },
  { abv: 'CHA', espn: 'Charlotte Hornets',        bdl_id: '4'  },
  { abv: 'CHI', espn: 'Chicago Bulls',            bdl_id: '5'  },
  { abv: 'CLE', espn: 'Cleveland Cavaliers',      bdl_id: '6'  },
  { abv: 'DAL', espn: 'Dallas Mavericks',         bdl_id: '7'  },
  { abv: 'DEN', espn: 'Denver Nuggets',           bdl_id: '8'  },
  { abv: 'DET', espn: 'Detroit Pistons',          bdl_id: '9'  },
  { abv: 'GS',  espn: 'Golden State Warriors',    bdl_id: '10' },
  { abv: 'HOU', espn: 'Houston Rockets',          bdl_id: '11' },
  { abv: 'IND', espn: 'Indiana Pacers',           bdl_id: '12' },
  { abv: 'LAC', espn: 'LA Clippers',              bdl_id: '13' },
  { abv: 'LAL', espn: 'Los Angeles Lakers',       bdl_id: '14' },
  { abv: 'MEM', espn: 'Memphis Grizzlies',        bdl_id: '15' },
  { abv: 'MIA', espn: 'Miami Heat',               bdl_id: '16' },
  { abv: 'MIL', espn: 'Milwaukee Bucks',          bdl_id: '17' },
  { abv: 'MIN', espn: 'Minnesota Timberwolves',   bdl_id: '18' },
  { abv: 'NO',  espn: 'New Orleans Pelicans',     bdl_id: '19' },
  { abv: 'NY',  espn: 'New York Knicks',          bdl_id: '20' },
  { abv: 'OKC', espn: 'Oklahoma City Thunder',    bdl_id: '21' },
  { abv: 'ORL', espn: 'Orlando Magic',            bdl_id: '22' },
  { abv: 'PHI', espn: 'Philadelphia 76ers',       bdl_id: '23' },
  { abv: 'PHO', espn: 'Phoenix Suns',             bdl_id: '24' },
  { abv: 'POR', espn: 'Portland Trail Blazers',   bdl_id: '25' },
  { abv: 'SAC', espn: 'Sacramento Kings',         bdl_id: '26' },
  { abv: 'SA',  espn: 'San Antonio Spurs',        bdl_id: '27' },
  { abv: 'TOR', espn: 'Toronto Raptors',          bdl_id: '28' },
  { abv: 'UTA', espn: 'Utah Jazz',                bdl_id: '29' },
  { abv: 'WAS', espn: 'Washington Wizards',       bdl_id: '30' },
];

// ── Helpers dérivés — O(1) après construction ─────────────────────────────────

// abv → { abv, espn, bdl_id }
export const NBA_TEAM_BY_ABV  = Object.fromEntries(NBA_TEAMS.map(t => [t.abv,  t]));
// espnName → { abv, espn, bdl_id }
export const NBA_TEAM_BY_ESPN = Object.fromEntries(NBA_TEAMS.map(t => [t.espn, t]));

/** espnName → abv Tank01  (ex: 'Golden State Warriors' → 'GS') */
export function getNBAAbvFromEspn(espnName) {
  return NBA_TEAM_BY_ESPN[espnName]?.abv ?? null;
}

/** abv Tank01 → espnName  (ex: 'GS' → 'Golden State Warriors') */
export function getNBAEspnFromAbv(abv) {
  return NBA_TEAM_BY_ABV[abv]?.espn ?? null;
}

/** espnName → bdl_id BallDontLie  (ex: 'Golden State Warriors' → '10') */
export function getNBABdlIdFromEspn(espnName) {
  return NBA_TEAM_BY_ESPN[espnName]?.bdl_id ?? null;
}

/**
 * Détecte automatiquement la phase NBA selon le mois et le jour.
 *
 * Calendrier NBA approximatif (stable d'une saison à l'autre) :
 *   Saison régulière : octobre → mi-avril
 *   Play-In          : 3ème semaine d'avril (vers le 15-20 avril)
 *   Play-Off         : fin avril → mi-juin
 *   Intersaison      : mi-juin → fin septembre
 *
 * @returns {'regular' | 'playin' | 'playoff' | 'offseason'}
 */
export function getNBAPhase(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const day   = date.getDate();

  if (month >= 10) return 'regular';                          // oct-déc
  if (month <= 3)  return 'regular';                          // jan-mars
  if (month === 4 && day < 15) return 'regular';              // début avril
  if (month === 4 && day < 22) return 'playin';               // ~15-21 avril
  if (month === 4 || month === 5) return 'playoff';            // fin avril + mai
  if (month === 6 && day <= 20) return 'playoff';             // début juin
  return 'offseason';                                          // fin juin-sept
}

/**
 * Retourne les poids à utiliser selon la phase NBA actuelle.
 * Sélection automatique : playoff_weights en Play-In/Play-Off,
 * default_weights le reste de l'année.
 *
 * @param {Date} [date] - date de référence (défaut : maintenant)
 * @returns {object} weights
 */
export function getNBAWeights(date = new Date()) {
  const phase     = getNBAPhase(date);
  const config    = SPORTS_CONFIG.NBA;
  const isPlayoff = phase === 'playin' || phase === 'playoff';

  const weights    = isPlayoff ? config.playoff_weights    : config.default_weights;
  const scoreCap   = isPlayoff ? config.score_cap_playoff  : config.score_cap;
  const emaLambda  = isPlayoff ? config.ema_lambda_playoff : config.ema_lambda;
  const requireAbs = isPlayoff
    ? (config.rejection_thresholds.require_absences_confirmed_playoff ?? false)
    : (config.rejection_thresholds.require_absences_confirmed ?? false);

  return { weights, phase, score_cap: scoreCap, ema_lambda: emaLambda, require_absences_confirmed: requireAbs };
}
