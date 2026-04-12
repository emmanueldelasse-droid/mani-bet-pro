/**
 * MANI BET PRO — paper.settler.js v3.2
 */

import { PaperEngine } from './paper.engine.js';
import { API_CONFIG }  from '../config/api.config.js';
import { Logger }      from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export class PaperSettler {
  static async settle(store) {
    const state = await PaperEngine.loadAsync();
    const pendingBets = state.bets.filter(function(bet) { return bet.result === 'PENDING'; });
    if (pendingBets.length === 0) return;

    const byDate = {};
    pendingBets.forEach(function(bet) {
      const date = _normalizeDate(bet.date);
      if (!date) return;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(bet);
    });

    let settled = 0;

    for (const [date, bets] of Object.entries(byDate)) {
      try {
        const results = await _fetchResults(date);
        if (!results?.results?.length) continue;

        for (const bet of bets) {
          const result = _matchBetToResult(bet, results.results);
          if (!result) continue;

          const outcome = _determineOutcome(bet, result);
          if (!outcome) continue;

          const homeScore = result.home_team?.score ?? null;
          const awayScore = result.away_team?.score ?? null;
          const betHomeIsHome = result.home_team?.name === bet.home;

          await PaperEngine.settleBet(bet.bet_id, outcome, null, {
            home_score: betHomeIsHome ? homeScore : awayScore,
            away_score: betHomeIsHome ? awayScore : homeScore,
          });

          settled++;
          Logger.info('PAPER_AUTO_SETTLED', { bet_id: bet.bet_id, outcome, market: bet.market });
        }
      } catch (err) {
        Logger.warn('PAPER_SETTLER_ERROR', { date, message: err.message });
      }
    }

    if (settled > 0) {
      Logger.info('PAPER_SETTLER_DONE', { settled });
      store.set({ paperTradingVersion: (store.get('paperTradingVersion') ?? 0) + 1 });
    }
  }
}

async function _fetchResults(date) {
  try {
    const dateESPN = date.replace(/-/g, '');
    const response = await fetch(`${WORKER}/nba/results?date=${dateESPN}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function _matchBetToResult(bet, results) {
  return results.find(function(r) {
    return (r.home_team?.name === bet.home && r.away_team?.name === bet.away) ||
      (r.home_team?.name === bet.away && r.away_team?.name === bet.home);
  }) ?? null;
}

function _determineOutcome(bet, result) {
  const homeScore = result.home_team?.score ?? 0;
  const awayScore = result.away_team?.score ?? 0;
  const total = homeScore + awayScore;
  const betHomeIsResultHome = result.home_team?.name === bet.home;

  switch (bet.market) {
    case 'MONEYLINE': {
      const betOnHome = bet.side === 'HOME';
      const homeWon = homeScore > awayScore;
      if (betHomeIsResultHome) return betOnHome ? (homeWon ? 'WIN' : 'LOSS') : (homeWon ? 'LOSS' : 'WIN');
      return betOnHome ? (homeWon ? 'LOSS' : 'WIN') : (homeWon ? 'WIN' : 'LOSS');
    }

    case 'SPREAD': {
      const spreadLine = bet.spread_line != null ? Number(bet.spread_line) : null;
      if (spreadLine === null) {
        Logger.warn('PAPER_SETTLER_SPREAD_NO_LINE', { bet_id: bet.bet_id, note: 'clôture manuelle requise' });
        return null;
      }
      const betOnHome = bet.side === 'HOME';
      const scoreDiff = betHomeIsResultHome
        ? (betOnHome ? homeScore - awayScore : awayScore - homeScore)
        : (betOnHome ? awayScore - homeScore : homeScore - awayScore);
      const covered = scoreDiff + spreadLine;
      if (covered > 0) return 'WIN';
      if (covered < 0) return 'LOSS';
      return 'PUSH';
    }

    case 'OVER_UNDER': {
      const line = bet.ou_line != null ? Number(bet.ou_line) : null;
      if (line === null) {
        Logger.warn('PAPER_SETTLER_OU_NO_LINE', { bet_id: bet.bet_id, note: 'clôture manuelle requise' });
        return null;
      }
      if (total > line) return bet.side === 'OVER' ? 'WIN' : 'LOSS';
      if (total < line) return bet.side === 'UNDER' ? 'WIN' : 'LOSS';
      return 'PUSH';
    }

    default:
      return null;
  }
}

function _normalizeDate(date) {
  if (!date) return null;
  if (date.length === 8) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  return date;
}
