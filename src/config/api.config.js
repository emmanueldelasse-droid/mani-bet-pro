/**
 * MANI BET PRO — api.config.js v2
 *
 * Toutes les clés API transitent par le Cloudflare Worker.
 * Jamais de clé côté front.
 *
 * Sources :
 *   ESPN   → matchs + stats avancées + cotes (gratuit, sans clé)
 *   NBA PDF → injury reports officiels (via Worker + Claude Haiku)
 *   BDL    → forme récente W/L (via Worker + clé BallDontLie)
 */

export const API_CONFIG = {

  WORKER_BASE_URL: 'https://manibetpro.emmanueldelasse.workers.dev',

  ROUTES: {
    NBA: {
      MATCHES:         '/nba/matches',           // ?date=YYYYMMDD
      TEAM_STATS:      '/nba/team/:id/stats',    // ESPN — stats saison
      TEAM_RECENT:     '/nba/team/:id/recent',   // BDL  — forme récente W/L
      INJURIES:        '/nba/injuries',           // ?date=YYYY-MM-DD — PDF NBA officiel
      STANDINGS:       '/nba/standings',
    },
  },

  TIMEOUTS: {
    DEFAULT:  8000,
    AI:      30000,
    INJURIES: 45000,   // Plus long — extraction PDF via Claude
  },

  // TTL cache par type de donnée (en secondes)
  CACHE_TTL: {
    MATCHES:        1800,   // 30 min
    SEASON_STATS:  21600,   // 6h
    RECENT_FORM:    1800,   // 30 min
    INJURIES:       1800,   // 30 min
    STANDINGS:     86400,   // 24h
    AI_EXPLANATION: 86400,  // 24h — réponse IA mise en cache
  },

  // Seuils de quota (ratio utilisé/limite)
  QUOTA_ALERT_THRESHOLD:  0.80,   // Alerte à 80%
  QUOTA_CUTOFF_THRESHOLD: 0.95,   // Mode dégradé à 95%

};
