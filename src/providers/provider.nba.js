/**
 * MANI BET PRO — provider.nba.js v2
 *
 * Responsabilité unique : fournir les données ESPN et BallDontLie.
 *
 * CORRECTION v2 :
 *   - getOddsComparison() utilise ProviderCache.setWithTTL() avec le TTL
 *     dynamique retourné par le Worker (adaptatif selon l'heure ET).
 *     En v1, data.ttl_seconds était lu mais jamais utilisé — le cache
 *     utilisait toujours ODDS_COMPARISON (7200s statique) quel que soit
 *     le TTL retourné par le Worker.
 */

import { API_CONFIG }    from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger }        from '../utils/utils.logger.js';

const WORKER  = API_CONFIG.WORKER_BASE_URL;
const TIMEOUT = API_CONFIG.TIMEOUTS.DEFAULT;

export class ProviderNBA {

  // ── MATCHS DU JOUR (ESPN) ─────────────────────────────────────────────

  static async getMatchesToday(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'espn_matches', { date });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) {
      Logger.apiCall({ provider: 'ESPN', endpoint: '/nba/matches', statusCode: 200, cached: true });
      return cached;
    }

    const dateESPN = date.replace(/-/g, '');
    const data     = await this._fetch(
      `${WORKER}${API_CONFIG.ROUTES.NBA.MATCHES}?date=${dateESPN}`,
      'ESPN',
      '/nba/matches'
    );
    if (!data) return null;

    const result = this._normalizeMatches(data, date);
    if (result) ProviderCache.set(cacheKey, result, 'MATCHES');
    return result;
  }

  // ── FORME RÉCENTE (BallDontLie) ───────────────────────────────────────

  static async getRecentForm(bdlTeamId, season, n = 10) {
    const cacheKey = ProviderCache.buildKey('nba', 'bdl_recent', { bdlTeamId, season, n });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}${API_CONFIG.ROUTES.NBA.TEAM_RECENT.replace(':id', bdlTeamId)}?season=${season}&n=${n}`,
      'BallDontLie',
      `/nba/team/${bdlTeamId}/recent`
    );
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

    if (result.matches.length > 0) {
      ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    }

    return result;
  }

  // ── COTES MULTI-BOOKS (The Odds API) ──────────────────────────────────

  /**
   * CORRECTION : utilise setWithTTL() avec le TTL dynamique du Worker.
   *
   * Le Worker retourne data.ttl_seconds selon l'heure ET :
   *   00h-12h → 86400s (24h)
   *   12h-18h → 21600s (6h)
   *   18h-23h → 7200s  (2h)
   *
   * En v1, ce TTL était lu dans data.ttl_seconds mais ignoré —
   * ProviderCache.set(key, data, 'ODDS_COMPARISON') utilisait
   * toujours 7200s statique depuis api.config.js.
   */
  static async getOddsComparison() {
    const cacheKey = ProviderCache.buildKey('nba', 'odds_comparison', {});
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/odds/comparison`,
      'ODDS_API',
      '/nba/odds/comparison'
    );

    if (!data?.available) return null;

    // TTL adaptatif retourné par le Worker — utilisé effectivement
    const ttl = data.ttl_seconds ?? API_CONFIG.CACHE_TTL.ODDS_COMPARISON;
    ProviderCache.setWithTTL(cacheKey, data, ttl);

    return data;
  }

  /**
   * Trouve les cotes pour un match par nom d'équipe.
   */
  static findMatchOdds(comparison, homeTeam, awayTeam) {
    if (!comparison?.matches) return null;
    return comparison.matches.find(m =>
      (m.home_team === homeTeam && m.away_team === awayTeam) ||
      (m.home_team === awayTeam && m.away_team === homeTeam)
    ) ?? null;
  }

  // ── NORMALISATION ─────────────────────────────────────────────────────

  static _normalizeMatches(data, date) {
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
          espn_id:      m.home_team?.espn_id      ?? null,
          name:         m.home_team?.name          ?? null,
          abbreviation: m.home_team?.abbreviation  ?? null,
          score:        m.home_team?.score          ?? null,
          record:       m.home_team?.record         ?? null,
          home_record:  m.home_team?.home_record    ?? null,
          away_record:  m.home_team?.away_record    ?? null,
          logo:         m.home_team?.logo           ?? null,
        },
        away_team: {
          espn_id:      m.away_team?.espn_id      ?? null,
          name:         m.away_team?.name          ?? null,
          abbreviation: m.away_team?.abbreviation  ?? null,
          score:        m.away_team?.score          ?? null,
          record:       m.away_team?.record         ?? null,
          home_record:  m.away_team?.home_record    ?? null,
          away_record:  m.away_team?.away_record    ?? null,
          logo:         m.away_team?.logo           ?? null,
        },
        home_season_stats: m.home_season_stats ?? null,
        away_season_stats: m.away_season_stats ?? null,
        odds: m.odds ? {
          source:        m.odds.source,
          spread:        m.odds.spread        ?? null,
          over_under:    m.odds.over_under     ?? null,
          home_ml:       m.odds.home_ml        ?? null,
          away_ml:       m.odds.away_ml        ?? null,
          home_favorite: m.odds.home_favorite  ?? null,
          away_favorite: m.odds.away_favorite  ?? null,
          fetched_at:    m.odds.fetched_at     ?? new Date().toISOString(),
        } : null,
      })),
    };
  }

  // ── FETCH UTILITAIRE ──────────────────────────────────────────────────

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
        provider,
        endpoint,
        statusCode: response.status,
        cached:     false,
        error:      response.ok ? null : `HTTP ${response.status}`,
      });

      if (!response.ok) return null;
      return await response.json();

    } catch (err) {
      clearTimeout(timer);
      Logger.apiCall({
        provider,
        endpoint,
        statusCode: 0,
        cached:     false,
        error:      err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      });
      return null;
    }
  }
}
