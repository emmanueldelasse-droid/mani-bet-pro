/**
 * MANI BET PRO — paper.settler.js v3
 *
 * CORRECTIONS v3 :
 *   - SPREAD sans spread_line : récupère la ligne depuis les cotes ESPN
 *     du résultat (odds.spread) au lieu d'ignorer le pari.
 *     Fallback : si la ligne ESPN est aussi absente, le pari reste PENDING
 *     avec un warning.
 *
 * CORRECTION v2 :
 *   - SPREAD : utilisait odds_line (cote américaine) comme ligne de points.
 *     Désormais lit spread_line stockée au moment du placement.
 */

import { PaperEngine } from './paper.engine.js';
import { API_CONFIG }  from '../config/api.config.js';
import { Logger }      from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export class PaperSettler {

  static async settle(store) {
    const state       = await PaperEngine.loadAsync();
    const pendingBets = state.bets.filter(b => b.result === 'PENDING');

    if (pendingBets.length === 0) return;

    // Grouper par date
    const byDate = {};
    pendingBets.forEach(bet => {
      const date = _normalizeDate(bet.date);
      if (!date) return;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(bet);
    });

    let settled = 0;

    for (const [date, bets] of Object.entries(byDate)) {
      // Pour le polling temps réel, on inclut aussi les paris du jour
      // Le filtre is_final dans ESPN garantit que seuls les matchs terminés sont clôturés
      // if (date >= _getTodayDate()) continue; // SUPPRIMÉ v3.1

      try {
        const results = await _fetchResults(date);
        if (!results?.results?.length) continue;

        for (const bet of bets) {
          const result = _matchBetToResult(bet, results.results);
          if (!result) continue;

          const outcome = _determineOutcome(bet, result);
          if (!outcome) continue;

          await PaperEngine.settleBet(bet.bet_id, outcome, null);
          settled++;

          Logger.info('PAPER_AUTO_SETTLED', {
            bet_id:  bet.bet_id,
            outcome,
            market:  bet.market,
            match:   `${bet.home} vs ${bet.away}`,
          });
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

// ── FONCTIONS PRIVÉES ─────────────────────────────────────────────────────

async function _fetchResults(date) {
  try {
    const dateESPN = date.replace(/-/g, '');
    const response = await fetch(`${WORKER}/nba/results?date=${dateESPN}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function _matchBetToResult(bet, results) {
  return results.find(r =>
    (r.home_team?.name === bet.home && r.away_team?.name === bet.away) ||
    (r.home_team?.name === bet.away && r.away_team?.name === bet.home)
  ) ?? null;
}

/**
 * Détermine le résultat d'un pari depuis le score final ESPN.
 *
 * CORRECTION v3 SPREAD :
 *   Si bet.spread_line est null (paris placés avant le fix),
 *   on tente de récupérer la ligne depuis result.odds.spread (ESPN DraftKings).
 *   Si toujours absent, on retourne null (pari reste PENDING).
 */
function _determineOutcome(bet, result) {
  const homeScore = result.home_team?.score ?? 0;
  const awayScore = result.away_team?.score ?? 0;
  const total     = homeScore + awayScore;

  const betHomeIsResultHome = result.home_team?.name === bet.home;

  switch (bet.market) {

    case 'MONEYLINE': {
      const betOnHome = bet.side === 'HOME';
      const homeWon   = homeScore > awayScore;

      if (betHomeIsResultHome) {
        return betOnHome ? (homeWon ? 'WIN' : 'LOSS') : (homeWon ? 'LOSS' : 'WIN');
      } else {
        return betOnHome ? (homeWon ? 'LOSS' : 'WIN') : (homeWon ? 'WIN' : 'LOSS');
      }
    }

    case 'SPREAD': {
      // Lire spread_line depuis le pari, ou fallback ESPN DraftKings
      let spreadLine = bet.spread_line !== null && bet.spread_line !== undefined
        ? Number(bet.spread_line)
        : null;

      // FALLBACK v3 : récupérer depuis ESPN si absent
      if (spreadLine === null && result.odds?.spread != null) {
        const espnSpread = Number(result.odds.spread);
        // ESPN stocke la ligne du point de vue de la home team
        // Si bet.side === 'HOME', on utilise espnSpread tel quel
        // Si bet.side === 'AWAY', on inverse
        spreadLine = betHomeIsResultHome
          ? (bet.side === 'HOME' ? espnSpread : -espnSpread)
          : (bet.side === 'HOME' ? -espnSpread : espnSpread);

        Logger.info('PAPER_SETTLER_SPREAD_FALLBACK', {
          bet_id: bet.bet_id,
          match:  `${bet.home} vs ${bet.away}`,
          espn_spread: espnSpread,
          spread_line_used: spreadLine,
        });
      }

      if (spreadLine === null) {
        Logger.warn('PAPER_SETTLER_SPREAD_NO_LINE', {
          bet_id: bet.bet_id,
          match:  `${bet.home} vs ${bet.away}`,
          note:   'spread_line absent même dans ESPN — clôture manuelle requise',
        });
        return null;
      }

      const betOnHome = bet.side === 'HOME';

      let scoreDiff;
      if (betHomeIsResultHome) {
        scoreDiff = betOnHome ? homeScore - awayScore : awayScore - homeScore;
      } else {
        scoreDiff = betOnHome ? awayScore - homeScore : homeScore - awayScore;
      }

      const covered = scoreDiff + spreadLine;
      if (covered > 0) return 'WIN';
      if (covered < 0) return 'LOSS';
      return 'PUSH';
    }

    case 'OVER_UNDER': {
      // Priorité : ou_line stocké au placement → fallback ESPN result.odds.over_under
      // odds_line = cote américaine (-110) — NE PAS utiliser comme ligne de total
      let line = bet.ou_line !== null && bet.ou_line !== undefined
        ? Number(bet.ou_line)
        : null;

      // FALLBACK : récupérer depuis ESPN si ou_line absent
      if (line === null && result.odds?.over_under != null) {
        line = Number(result.odds.over_under);
        Logger.info('PAPER_SETTLER_OU_FALLBACK', {
          bet_id: bet.bet_id,
          match:  `${bet.home} vs ${bet.away}`,
          ou_line_used: line,
        });
      }

      if (line === null) {
        Logger.warn('PAPER_SETTLER_OU_NO_LINE', {
          bet_id: bet.bet_id,
          match:  `${bet.home} vs ${bet.away}`,
          note:   'ou_line absent — clôture manuelle requise',
        });
        return null;
      }

      if (total > line) return bet.side === 'OVER'  ? 'WIN' : 'LOSS';
      if (total < line) return bet.side === 'UNDER' ? 'WIN' : 'LOSS';
      return 'PUSH';
    }

    default:
      return null;
  }
}

function _normalizeDate(date) {
  if (!date) return null;
  if (date.length === 8) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}

function _getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}
