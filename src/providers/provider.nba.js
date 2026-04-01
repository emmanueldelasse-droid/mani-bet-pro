/**
 * MANI BET PRO — provider.nba.js v2
 *
 * Sources :
 *   ESPN API (gratuite, sans clé)     → matchs + stats avancées (eFG%, TS%, splits)
 *   BallDontLie v1 (avec clé)          → forme récente W/L
 *   PDF NBA officiel (via Worker)      → injury reports officiels
 *
 * Format ESPN retourné par le Worker :
 *   matches[].home_season_stats  → { efg_pct, ts_pct, win_pct, home_win_pct, avg_pts, ... }
 *   matches[].away_season_stats  → idem
 *   matches[].odds               → { spread, over_under, home_ml, away_ml }
 *
 * Aucune clé API côté front.
 * Si une donnée est indisponible → null (jamais inventée).
 */

import { API_CONFIG }    from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger }        from '../utils/utils.logger.js';

const WORKER  = API_CONFIG.WORKER_BASE_URL;
const TIMEOUT = API_CONFIG.TIMEOUTS.DEFAULT;

export class ProviderNBA {

  // ── MATCHS DU JOUR (ESPN) ─────────────────────────────────────────────────

  /**
   * Récupère les matchs ESPN du jour avec stats et cotes intégrées.
   * @param {string} date — YYYY-MM-DD
   * @returns {Promise<ESPNMatchList|null>}
   */
  static async getMatchesToday(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'espn_matches', { date });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) {
      Logger.apiCall({ provider: 'ESPN', endpoint: '/nba/matches', statusCode: 200, cached: true });
      return cached;
    }

    const dateESPN = date.replace(/-/g, '');
    const url      = `${WORKER}${API_CONFIG.ROUTES.NBA.MATCHES}?date=${dateESPN}`;
    const data     = await this._fetch(url, 'ESPN', '/nba/matches');
    if (!data) return null;

    const result = this._normalizeESPNMatches(data, date);
    if (result) ProviderCache.set(cacheKey, result, 'MATCHES');
    return result;
  }

  // ── STATS ÉQUIPE (ESPN — incluses dans les matchs) ────────────────────────

  /**
   * Récupère les stats saison ESPN d'une équipe depuis le scoreboard.
   * Si l'équipe ne joue pas aujourd'hui, retourne null.
   * @param {string} espnTeamId
   * @returns {Promise<NBATeamStats|null>}
   */
  static async getTeamStats(espnTeamId) {
    const cacheKey = ProviderCache.buildKey('nba', 'espn_team_stats', { espnTeamId });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const url  = `${WORKER}${API_CONFIG.ROUTES.NBA.TEAM_STATS.replace(':id', espnTeamId)}`;
    const data = await this._fetch(url, 'ESPN', `/nba/team/${espnTeamId}/stats`);
    if (!data) return null;

    const result = this._normalizeESPNTeamStats(data, espnTeamId);
    if (result) ProviderCache.set(cacheKey, result, 'SEASON_STATS');
    return result;
  }

  // ── FORME RÉCENTE (BallDontLie) ───────────────────────────────────────────

  /**
   * Récupère les W/L des N derniers matchs via BallDontLie.
   * @param {string} bdlTeamId — ID BallDontLie (différent de l'ESPN ID)
   * @param {string} season    — ex: '2025'
   * @param {number} n         — nombre de matchs
   * @returns {Promise<NBARecentForm|null>}
   */
  static async getRecentForm(bdlTeamId, season, n = 10) {
    const cacheKey = ProviderCache.buildKey('nba', 'bdl_recent', { bdlTeamId, season, n });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    // Timestamp pour éviter le cache navigateur sur les appels BDL
    const ts   = Math.floor(Date.now() / 300000); // invalide toutes les 5 min
    const url  = `${WORKER}${API_CONFIG.ROUTES.NBA.TEAM_RECENT.replace(':id', bdlTeamId)}?season=${season}&n=${n}&_t=${ts}`;
    const data = await this._fetch(url, 'BallDontLie', `/nba/team/${bdlTeamId}/recent`, API_CONFIG.TIMEOUTS.DEFAULT);
    if (!data) return null;

    const result = {
      team_id:    bdlTeamId,
      season,
      source:     'balldontlie_v1',
      fetched_at: data.fetched_at ?? new Date().toISOString(),
      matches:    (data.matches ?? []).map(m => ({
        game_id:    m.game_id,
        date:       m.date,
        won:        m.won,
        margin:     m.margin,
        is_home:    m.is_home,
        team_score: m.team_score,
        opp_score:  m.opp_score,
      })),
    };

    // Ne mettre en cache que si on a des matchs récents (évite de cacher des données vides)
    if (result.matches.length > 0) {
      ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    } else {
      // Invalider le cache si vide pour forcer un rechargement au prochain appel
      ProviderCache.invalidate(cacheKey);
    }
    return result;
  }

  // ── INJURY REPORT (PDF NBA officiel via Worker) ───────────────────────────

  /**
   * Récupère les injury reports officiels NBA du jour.
   * Source : ak-static.cms.nba.com/referee/injury/Injury-Report_*.pdf
   * Parsing via Claude Haiku côté Worker.
   *
   * @param {string} date — YYYY-MM-DD
   * @returns {Promise<NBAInjuryReport|null>}
   */
  static async getInjuryReport(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'injuries', { date });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    // Priorité 1 : ESPN injuries (temps réel)
    const espnData = await this._fetch(`${WORKER}/nba/injuries/espn`, 'ESPN_INJURIES', '/nba/injuries/espn');
    if (espnData?.available && (espnData.players?.length ?? 0) > 0) {
      ProviderCache.set(cacheKey, espnData, 'INJURIES');
      return espnData;
    }

    // Fallback : PDF NBA officiel
    const pdfData = await this._fetch(`${WORKER}${API_CONFIG.ROUTES.NBA.INJURIES}?date=${date}`, 'NBA_PDF', '/nba/injuries', API_CONFIG.TIMEOUTS.INJURIES);
    if (!pdfData || !pdfData.available) return null;

    ProviderCache.set(cacheKey, pdfData, 'INJURIES');
    return pdfData;
  }

  /**
   * Filtre l'injury report pour une équipe donnée.
   * @param {NBAInjuryReport} report
   * @param {string} teamName — nom complet de l'équipe (ex: "Miami Heat")
   * @returns {Array<InjuryPlayer>}
   */
  static getInjuriesForTeam(report, teamName) {
    if (!report?.by_team) return [];
    return report.by_team[teamName] ?? [];
  }

  // ── NORMALISATEURS ────────────────────────────────────────────────────────

  static _normalizeESPNMatches(data, date) {
    if (!data?.matches) return null;

    return {
      date,
      source:     'espn',
      fetched_at: new Date().toISOString(),
      matches:    data.matches.map(m => ({
        id:            m.id ?? m.espn_id,
        espn_id:       m.espn_id,
        date:          m.date ?? date,
        datetime:      m.datetime,
        name:          m.name,
        status:        m.status,
        status_detail: m.status_detail,
        venue:         m.venue ?? null,
        source:        'espn',
        fetched_at:    m.fetched_at ?? new Date().toISOString(),

        home_team: {
          espn_id:      m.home_team?.espn_id ?? null,
          name:         m.home_team?.name ?? null,
          abbreviation: m.home_team?.abbreviation ?? null,
          score:        m.home_team?.score ?? null,
          record:       m.home_team?.record ?? null,
          home_record:  m.home_team?.home_record ?? null,
          away_record:  m.home_team?.away_record ?? null,
          logo:         m.home_team?.logo ?? null,
        },
        away_team: {
          espn_id:      m.away_team?.espn_id ?? null,
          name:         m.away_team?.name ?? null,
          abbreviation: m.away_team?.abbreviation ?? null,
          score:        m.away_team?.score ?? null,
          record:       m.away_team?.record ?? null,
          home_record:  m.away_team?.home_record ?? null,
          away_record:  m.away_team?.away_record ?? null,
          logo:         m.away_team?.logo ?? null,
        },

        // Stats de saison ESPN (eFG%, TS%, splits, etc.)
        home_season_stats: m.home_season_stats ?? null,
        away_season_stats: m.away_season_stats ?? null,

        // Cotes DraftKings temps réel
        odds: m.odds ? {
          source:        m.odds.source,
          spread:        m.odds.spread ?? null,
          over_under:    m.odds.over_under ?? null,
          home_ml:       m.odds.home_ml ?? null,
          away_ml:       m.odds.away_ml ?? null,
          home_favorite: m.odds.home_favorite ?? null,
          away_favorite: m.odds.away_favorite ?? null,
          fetched_at:    m.odds.fetched_at ?? new Date().toISOString(),
        } : null,
      })),
    };
  }

  static _normalizeESPNTeamStats(data, espnTeamId) {
    if (!data) return null;

    return {
      espn_team_id: espnTeamId,
      source:       data.source ?? 'espn',
      fetched_at:   data.fetched_at ?? new Date().toISOString(),
      available:    data.available ?? false,
      stats: {
        games_played:  data.games_played  ?? null,
        wins:          data.wins          ?? null,
        losses:        data.losses        ?? null,
        win_pct:       data.win_pct       ?? null,
        home_wins:     data.home_wins     ?? null,
        home_losses:   data.home_losses   ?? null,
        home_win_pct:  data.home_win_pct  ?? null,
        away_wins:     data.away_wins     ?? null,
        away_losses:   data.away_losses   ?? null,
        away_win_pct:  data.away_win_pct  ?? null,
        efg_pct:       data.efg_pct       ?? null,
        ts_pct:        data.ts_pct        ?? null,
        fg_pct:        data.fg_pct        ?? null,
        fg3_pct:       data.fg3_pct       ?? null,
        ft_pct:        data.ft_pct        ?? null,
        avg_pts:       data.avg_pts       ?? null,
        avg_reb:       data.avg_reb       ?? null,
        avg_ast:       data.avg_ast       ?? null,
      },
    };
  }

  // ── FETCH UTILITAIRE ──────────────────────────────────────────────────────

  static async _fetch(url, provider, endpoint, timeout = TIMEOUT) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal:  controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      Logger.apiCall({
        provider, endpoint,
        statusCode: response.status,
        cached: false,
        error: response.ok ? null : `HTTP ${response.status}`,
      });

      if (!response.ok) return null;
      return await response.json();

    } catch (err) {
      clearTimeout(timer);
      Logger.apiCall({
        provider, endpoint,
        statusCode: 0, cached: false,
        error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      });
      return null;
    }
  }
}
