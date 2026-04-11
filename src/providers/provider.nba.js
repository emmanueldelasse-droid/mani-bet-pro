/**
 * MANI BET PRO — provider.nba.js v3
 *
 * Responsabilité unique :
 * - fournir les données ESPN / BallDontLie
 * - normaliser les marchés odds dans une structure cohérente
 *
 * Patch odds/edge :
 * - findMatchOdds() renvoie désormais un objet structuré par marché
 *   via odds_markets, en conservant un legacy_flat pour compatibilité.
 * - un seul bookmaker est sélectionné par marché
 * - spread et total sont rejetés si ligne/cotes incohérentes
 * - les bookmakers bruts restent disponibles uniquement pour debug
 */

import { API_CONFIG } from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger } from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;
const TIMEOUT = API_CONFIG.TIMEOUTS.DEFAULT;
const BOOK_PRIORITY = ['pinnacle', 'betclic', 'bet365', 'unibet_eu', 'betsson', 'winamax'];

export class ProviderNBA {
  // ── MATCHS DU JOUR (ESPN) ─────────────────────────────────────────────
  static async getMatchesToday(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'espn_matches', { date });
    const cached = ProviderCache.get(cacheKey);
    if (cached) {
      Logger.apiCall({ provider: 'ESPN', endpoint: '/nba/matches', statusCode: 200, cached: true });
      return cached;
    }

    const dateESPN = date.replace(/-/g, '');
    const data = await this._fetch(
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
    const cached = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}${API_CONFIG.ROUTES.NBA.TEAM_RECENT.replace(':id', bdlTeamId)}?season=${season}&n=${n}`,
      'BallDontLie',
      `/nba/team/${bdlTeamId}/recent`
    );
    if (!data) return null;

    const result = {
      team_id: bdlTeamId,
      season,
      source: 'balldontlie_v1',
      fetched_at: data.fetched_at ?? new Date().toISOString(),
      matches: (data.matches ?? []).map((m) => ({
        game_id: m.game_id,
        date: m.date,
        won: m.won,
        margin: m.margin,
        is_home: m.is_home,
        team_score: m.team_score,
        opp_score: m.opp_score,
      })),
    };

    if (result.matches.length > 0) {
      ProviderCache.set(cacheKey, result, 'RECENT_FORM');
    }
    return result;
  }

  // ── COTES MULTI-BOOKS (The Odds API) ──────────────────────────────────
  static async getOddsComparison() {
    const cacheKey = ProviderCache.buildKey('nba', 'odds_comparison', {});
    const cached = ProviderCache.get(cacheKey);
    if (cached) return cached;

    const data = await this._fetch(
      `${WORKER}/nba/odds/comparison`,
      'ODDS_API',
      '/nba/odds/comparison'
    );
    if (!data?.available) return null;

    const ttl = data.ttl_seconds ?? API_CONFIG.CACHE_TTL.ODDS_COMPARISON;
    ProviderCache.setWithTTL(cacheKey, data, ttl);
    return data;
  }

  /**
   * Trouve les cotes d'un match et retourne :
   * - odds_markets : structure propre par marché
   * - legacy_flat : compatibilité UI / ancien moteur
   */
  static findMatchOdds(comparison, homeTeam, awayTeam) {
    if (!comparison?.matches) return null;

    const game =
      comparison.matches.find(
        (m) =>
          (m.home_team === homeTeam && m.away_team === awayTeam) ||
          (m.home_team === awayTeam && m.away_team === homeTeam)
      ) ?? null;

    if (!game || !Array.isArray(game.bookmakers) || game.bookmakers.length === 0) {
      return null;
    }

    const isSwapped = game.home_team !== homeTeam;
    const sortedBooks = game.bookmakers
      .slice()
      .sort((a, b) => this._priorityIndex(a?.key) - this._priorityIndex(b?.key));

    const moneylineBook = this._selectPreferredBook(sortedBooks, 'moneyline');
    const spreadBook = this._selectPreferredBook(sortedBooks, 'spread');
    const totalBook = this._selectPreferredBook(sortedBooks, 'total');

    const moneyline = this._extractMoneylineFromBook(moneylineBook, isSwapped);
    const spread = this._extractSpreadFromBook(spreadBook, isSwapped);
    const total = this._extractTotalFromBook(totalBook);

    const odds_markets = {
      moneyline,
      spread,
      total,
      audit: this._buildOddsAudit(game, sortedBooks, isSwapped),
    };

    const legacy_flat = {
      home_ml_decimal: moneyline.home_decimal,
      away_ml_decimal: moneyline.away_decimal,
      home_spread_decimal: spread.home_decimal,
      away_spread_decimal: spread.away_decimal,
      spread_line: spread.line,
      over_decimal: total.over_decimal,
      under_decimal: total.under_decimal,
      total_line: total.line,
      best_book: moneyline.book_title ?? spread.book_title ?? total.book_title ?? null,
      bookmakers: game.bookmakers,
      odds_api_id: game.odds_api_id,
      odds_markets,
    };

    return {
      ...legacy_flat,
      odds_markets,
      legacy_flat,
    };
  }

  static _priorityIndex(key) {
    const idx = BOOK_PRIORITY.indexOf(key);
    return idx === -1 ? 999 : idx;
  }

  static _selectPreferredBook(bookmakers, marketType) {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

    const isValid = (book) => {
      if (!book) return false;
      if (marketType === 'moneyline') {
        return this._isValidOdd(book.home_ml) && this._isValidOdd(book.away_ml);
      }
      if (marketType === 'spread') {
        return (
          this._isValidLine(book.spread_line) &&
          this._isValidOdd(book.home_spread) &&
          this._isValidOdd(book.away_spread)
        );
      }
      if (marketType === 'total') {
        return (
          this._isValidLine(book.total_line) &&
          this._isValidOdd(book.over_total) &&
          this._isValidOdd(book.under_total)
        );
      }
      return false;
    };

    return bookmakers.find(isValid) ?? null;
  }

  static _extractMoneylineFromBook(book, isSwapped) {
    if (!book) return this._emptyMarket();

    const homeDecimal = isSwapped ? this._toNumber(book.away_ml) : this._toNumber(book.home_ml);
    const awayDecimal = isSwapped ? this._toNumber(book.home_ml) : this._toNumber(book.away_ml);

    if (!this._isValidOdd(homeDecimal) || !this._isValidOdd(awayDecimal)) {
      return this._emptyMarket(book);
    }

    return {
      available: true,
      book_key: book.key ?? null,
      book_title: book.title ?? null,
      line: null,
      home_decimal: homeDecimal,
      away_decimal: awayDecimal,
      home_american: this._decimalToAmerican(homeDecimal),
      away_american: this._decimalToAmerican(awayDecimal),
      selected_from_priority: true,
      raw_market: {
        home_ml: book.home_ml ?? null,
        away_ml: book.away_ml ?? null,
      },
    };
  }

  static _extractSpreadFromBook(book, isSwapped) {
    if (!book) return this._emptyMarket();

    const sourceLine = this._toNumber(book.spread_line);
    const sourceHome = this._toNumber(book.home_spread);
    const sourceAway = this._toNumber(book.away_spread);

    if (!this._isValidLine(sourceLine) || !this._isValidOdd(sourceHome) || !this._isValidOdd(sourceAway)) {
      return this._emptyMarket(book);
    }

    const line = isSwapped ? -sourceLine : sourceLine;
    const homeDecimal = isSwapped ? sourceAway : sourceHome;
    const awayDecimal = isSwapped ? sourceHome : sourceAway;

    return {
      available: true,
      book_key: book.key ?? null,
      book_title: book.title ?? null,
      line,
      home_decimal: homeDecimal,
      away_decimal: awayDecimal,
      home_american: this._decimalToAmerican(homeDecimal),
      away_american: this._decimalToAmerican(awayDecimal),
      selected_from_priority: true,
      raw_market: {
        spread_line: book.spread_line ?? null,
        home_spread: book.home_spread ?? null,
        away_spread: book.away_spread ?? null,
      },
    };
  }

  static _extractTotalFromBook(book) {
    if (!book) return this._emptyMarket();

    const line = this._toNumber(book.total_line);
    const overDecimal = this._toNumber(book.over_total);
    const underDecimal = this._toNumber(book.under_total);

    if (!this._isValidLine(line) || !this._isValidOdd(overDecimal) || !this._isValidOdd(underDecimal)) {
      return this._emptyMarket(book);
    }

    return {
      available: true,
      book_key: book.key ?? null,
      book_title: book.title ?? null,
      line,
      over_decimal: overDecimal,
      under_decimal: underDecimal,
      over_american: this._decimalToAmerican(overDecimal),
      under_american: this._decimalToAmerican(underDecimal),
      selected_from_priority: true,
      raw_market: {
        total_line: book.total_line ?? null,
        over_total: book.over_total ?? null,
        under_total: book.under_total ?? null,
      },
    };
  }

  static _buildOddsAudit(game, sortedBooks, isSwapped) {
    return {
      odds_api_id: game?.odds_api_id ?? null,
      home_team: game?.home_team ?? null,
      away_team: game?.away_team ?? null,
      is_swapped: Boolean(isSwapped),
      books_seen: sortedBooks.map((b) => ({
        key: b?.key ?? null,
        title: b?.title ?? null,
        home_ml: b?.home_ml ?? null,
        away_ml: b?.away_ml ?? null,
        spread_line: b?.spread_line ?? null,
        total_line: b?.total_line ?? null,
      })),
      provider_priority_used: [...BOOK_PRIORITY],
    };
  }

  static _emptyMarket(book = null) {
    return {
      available: false,
      book_key: book?.key ?? null,
      book_title: book?.title ?? null,
      line: null,
      home_decimal: null,
      away_decimal: null,
      over_decimal: null,
      under_decimal: null,
      home_american: null,
      away_american: null,
      over_american: null,
      under_american: null,
      selected_from_priority: false,
      raw_market: null,
    };
  }

  static _toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  static _isValidOdd(value) {
    const n = this._toNumber(value);
    return n !== null && n > 1;
  }

  static _isValidLine(value) {
    return this._toNumber(value) !== null;
  }

  static _decimalToAmerican(decimal) {
    const n = this._toNumber(decimal);
    if (n === null || n <= 1) return null;
    if (n >= 2) return Math.round((n - 1) * 100);
    return Math.round(-100 / (n - 1));
  }

  // ── NORMALISATION ─────────────────────────────────────────────────────
  static _normalizeMatches(data, date) {
    if (!data?.matches) return null;

    return {
      date,
      source: 'espn',
      fetched_at: new Date().toISOString(),
      matches: data.matches.map((m) => ({
        id: m.id ?? m.espn_id,
        espn_id: m.espn_id,
        date: m.date ?? date,
        datetime: m.datetime,
        name: m.name,
        status: m.status,
        status_detail: m.status_detail,
        venue: m.venue ?? null,
        source: 'espn',
        fetched_at: m.fetched_at ?? new Date().toISOString(),
        home_team: {
          espn_id: m.home_team?.espn_id ?? null,
          name: m.home_team?.name ?? null,
          abbreviation: m.home_team?.abbreviation ?? null,
          score: m.home_team?.score ?? null,
          record: m.home_team?.record ?? null,
          home_record: m.home_team?.home_record ?? null,
          away_record: m.home_team?.away_record ?? null,
          logo: m.home_team?.logo ?? null,
        },
        away_team: {
          espn_id: m.away_team?.espn_id ?? null,
          name: m.away_team?.name ?? null,
          abbreviation: m.away_team?.abbreviation ?? null,
          score: m.away_team?.score ?? null,
          record: m.away_team?.record ?? null,
          home_record: m.away_team?.home_record ?? null,
          away_record: m.away_team?.away_record ?? null,
          logo: m.away_team?.logo ?? null,
        },
        home_season_stats: m.home_season_stats ?? null,
        away_season_stats: m.away_season_stats ?? null,
        odds: m.odds
          ? {
              source: m.odds.source,
              spread: m.odds.spread ?? null,
              over_under: m.odds.over_under ?? null,
              home_ml: m.odds.home_ml ?? null,
              away_ml: m.odds.away_ml ?? null,
              home_favorite: m.odds.home_favorite ?? null,
              away_favorite: m.odds.away_favorite ?? null,
              fetched_at: m.odds.fetched_at ?? new Date().toISOString(),
            }
          : null,
      })),
    };
  }

  // ── FETCH UTILITAIRE ──────────────────────────────────────────────────
  static async _fetch(url, provider, endpoint, timeout = TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timer);

      Logger.apiCall({
        provider,
        endpoint,
        statusCode: response.status,
        cached: false,
        error: response.ok ? null : `HTTP ${response.status}`,
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      clearTimeout(timer);

      Logger.apiCall({
        provider,
        endpoint,
        statusCode: 0,
        cached: false,
        error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      });

      return null;
    }
  }
}
