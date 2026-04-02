/**
 * MANI BET PRO — paper.settler.js
 *
 * Responsabilité unique : clôturer automatiquement les paris en attente
 * en récupérant les scores finaux ESPN après chaque match.
 *
 * Appelé au démarrage de l'app (app.js).
 * Ne fait rien si aucun pari en attente.
 */

import { PaperEngine } from './paper.engine.js';
import { API_CONFIG }  from '../config/api.config.js';
import { Logger }      from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export class PaperSettler {

  /**
   * Point d'entrée — à appeler au démarrage.
   * Vérifie les paris en attente et tente de les clôturer.
   * @param {Store} store — pour notifier l'UI
   */
  static async settle(store) {
    const state        = PaperEngine.load();
    const pendingBets  = state.bets.filter(b => b.result === 'PENDING');

    if (pendingBets.length === 0) return;

    // Grouper les paris par date
    const byDate = {};
    pendingBets.forEach(bet => {
      const date = _normalizeDate(bet.date);
      if (!date) return;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(bet);
    });

    let settled = 0;

    for (const [date, bets] of Object.entries(byDate)) {
      // Ne pas chercher les résultats pour aujourd'hui (matchs pas encore joués)
      const today = _getTodayDate();
      if (date >= today) continue;

      try {
        const results = await _fetchResults(date);
        if (!results?.results?.length) continue;

        for (const bet of bets) {
          const result = _matchBetToResult(bet, results.results);
          if (!result) continue;

          const outcome = _determineOutcome(bet, result);
          if (!outcome) continue;

          PaperEngine.settleBet(bet.bet_id, outcome, null);
          settled++;
          Logger.info('PAPER_AUTO_SETTLED', {
            bet_id: bet.bet_id,
            outcome,
            match: `${bet.home} vs ${bet.away}`,
          });
        }
      } catch (err) {
        Logger.warn('PAPER_SETTLER_ERROR', { date, message: err.message });
      }
    }

    if (settled > 0) {
      Logger.info('PAPER_SETTLER_DONE', { settled });
      // Notifier l'UI
      store.set({ paperTradingVersion: (store.get('paperTradingVersion') ?? 0) + 1 });
    }
  }

  // ── PRIVÉ ─────────────────────────────────────────────────────────────

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

/**
 * Trouve le résultat ESPN correspondant à un pari.
 * Matching par nom d'équipe (home/away).
 */
function _matchBetToResult(bet, results) {
  return results.find(r =>
    (r.home_team?.name === bet.home && r.away_team?.name === bet.away) ||
    (r.home_team?.name === bet.away && r.away_team?.name === bet.home)
  ) ?? null;
}

/**
 * Détermine le résultat d'un pari depuis le score final.
 * @returns {'WIN'|'LOSS'|'PUSH'|null}
 */
function _determineOutcome(bet, result) {
  const homeScore = result.home_team?.score ?? 0;
  const awayScore = result.away_team?.score ?? 0;
  const total     = homeScore + awayScore;

  // Identifier quelle équipe est HOME dans le résultat ESPN
  // (peut différer de l'ordre dans le pari)
  const betHomeIsResultHome = result.home_team?.name === bet.home;

  switch (bet.market) {
    case 'MONEYLINE': {
      // side = HOME | AWAY (par rapport à bet.home / bet.away)
      const betOnHome = bet.side === 'HOME';
      const homeWon   = homeScore > awayScore;

      if (betHomeIsResultHome) {
        return betOnHome
          ? (homeWon ? 'WIN' : 'LOSS')
          : (homeWon ? 'LOSS' : 'WIN');
      } else {
        // bet.home est en fait AWAY dans ESPN
        return betOnHome
          ? (homeWon ? 'LOSS' : 'WIN')
          : (homeWon ? 'WIN' : 'LOSS');
      }
    }

    case 'SPREAD': {
      // odds_line = spread du côté parié
      const spread    = Number(bet.odds_line);
      const betOnHome = bet.side === 'HOME';

      let scoreDiff; // diff du côté parié
      if (betHomeIsResultHome) {
        scoreDiff = betOnHome ? homeScore - awayScore : awayScore - homeScore;
      } else {
        scoreDiff = betOnHome ? awayScore - homeScore : homeScore - awayScore;
      }

      const covered = scoreDiff + spread;
      if (covered > 0)  return 'WIN';
      if (covered < 0)  return 'LOSS';
      return 'PUSH';
    }

    case 'OVER_UNDER': {
      const line = Number(bet.odds_line);
      if (total > line)  return bet.side === 'OVER' ? 'WIN' : 'LOSS';
      if (total < line)  return bet.side === 'UNDER' ? 'WIN' : 'LOSS';
      return 'PUSH';
    }

    default:
      return null;
  }
}

function _normalizeDate(date) {
  if (!date) return null;
  if (date.length === 8) return `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  return date;
}

function _getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}
