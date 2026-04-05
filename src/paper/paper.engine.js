/**
 * MANI BET PRO — paper.engine.js v2
 *
 * Responsabilité unique : logique du paper trading.
 * Stockage : Cloudflare KV via Worker (persistant cross-session).
 * Fallback : localStorage si Worker indisponible.
 */

import { API_CONFIG }  from '../config/api.config.js';
import { Logger }      from '../utils/utils.logger.js';

const WORKER       = API_CONFIG.WORKER_BASE_URL;
const LS_KEY       = 'mbp_paper_trading'; // fallback localStorage

// ── STRATÉGIES ────────────────────────────────────────────────────────────

export const STRATEGIES = {
  A: { id: 'A', label: "Tous les edges > 5%",        fn: (bet) => bet.edge >= 5 },
  B: { id: 'B', label: "Kelly + données complètes",  fn: (bet) => bet.edge >= 5 && bet.data_quality >= 0.80 },
  C: { id: 'C', label: "Confidence HIGH uniquement", fn: (bet) => bet.confidence_level === 'HIGH' && bet.edge >= 5 },
};

// ── PAPER ENGINE ──────────────────────────────────────────────────────────

export class PaperEngine {

  // ── CHARGEMENT ────────────────────────────────────────────────────────

  /**
   * Charge l'état depuis KV (via Worker) avec fallback localStorage.
   * @returns {Promise<PaperState>}
   */
  static async loadAsync() {
    try {
      const response = await fetch(`${WORKER}/paper/state`, {
        headers: { 'Accept': 'application/json' },
      });
      if (response.ok) {
        const state = await response.json();
        // Sync localStorage comme cache local
        _saveLocal(state);
        return state;
      }
    } catch {}
    // Fallback localStorage
    return _loadLocal();
  }

  /**
   * Charge depuis localStorage (synchrone — pour usage immédiat dans l'UI).
   * @returns {PaperState}
   */
  static load() {
    return _loadLocal();
  }

  // ── PARIS ─────────────────────────────────────────────────────────────

  /**
   * Enregistre un nouveau pari via KV.
   * @param {object} betData
   * @returns {Promise<PaperState>}
   */
  /**
   * Verifie l'exposition journaliere avant de placer un pari.
   * Plafond : 20% de la bankroll initiale par journee calendaire.
   * @returns {{ allowed: boolean, exposed: number, limit: number, remaining: number }}
   */
  static async checkDailyExposure(stake) {
    const state = await this.loadAsync();
    const today = new Date().toISOString().slice(0, 10);
    const limit = state.initial_bankroll * 0.20;

    const exposedToday = state.bets
      .filter(function(b) {
        const betDate = b.placed_at ? b.placed_at.slice(0, 10) : (b.date || '');
        return betDate === today;
      })
      .reduce(function(s, b) { return s + b.stake; }, 0);

    const remaining = Math.max(0, limit - exposedToday);
    const allowed   = stake <= remaining;

    return {
      allowed,
      exposed:   Math.round(exposedToday * 100) / 100,
      limit:     Math.round(limit * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
    };
  }

  static async placeBet(betData) {
    // Verifier le plafond d'exposition journaliere (20% bankroll)
    const exposure = await this.checkDailyExposure(betData.stake);
    if (!exposure.allowed) {
      Logger.warn('PAPER_DAILY_LIMIT', {
        stake:     betData.stake,
        exposed:   exposure.exposed,
        limit:     exposure.limit,
        remaining: exposure.remaining,
      });
      return {
        error:     'DAILY_LIMIT_EXCEEDED',
        message:   'Plafond journalier atteint (' + exposure.exposed.toFixed(0) + '/' + exposure.limit.toFixed(0) + ' \u20ac). Reste : ' + exposure.remaining.toFixed(0) + ' \u20ac.',
        exposure,
      };
    }

    try {
      const response = await fetch(WORKER + '/paper/bet', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(betData),
      });
      if (response.ok) {
        const data = await response.json();
        _saveLocal(data.state);
        Logger.info('PAPER_BET_PLACED', { stake: betData.stake, edge: betData.edge });
        return data.state;
      }
    } catch (err) {
      Logger.warn('PAPER_BET_FALLBACK', { message: err.message });
    }
    // Fallback localStorage
    return _placeBetLocal(betData);
  }

  /**
   * Clôture un pari via KV.
   * @param {string} betId
   * @param {'WIN'|'LOSS'|'PUSH'} result
   * @param {number|null} closingOdds
   * @returns {Promise<PaperState>}
   */
  static async settleBet(betId, result, closingOdds = null) {
    try {
      const response = await fetch(`${WORKER}/paper/bet/${betId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ result, closing_odds: closingOdds }),
      });
      if (response.ok) {
        const { state } = await response.json();
        _saveLocal(state);
        return state;
      }
    } catch {}
    return _settleBetLocal(betId, result, closingOdds);
  }

  /**
   * Réinitialise le paper trading.
   * @param {number} initialBankroll
   * @returns {Promise<PaperState>}
   */
  static async reset(initialBankroll = 1000) {
    try {
      const response = await fetch(`${WORKER}/paper/reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initial_bankroll: initialBankroll }),
      });
      if (response.ok) {
        const { state } = await response.json();
        _saveLocal(state);
        return state;
      }
    } catch {}
    const state = _defaultState(initialBankroll);
    _saveLocal(state);
    return state;
  }

  // ── MÉTRIQUES ─────────────────────────────────────────────────────────

  static computeMetrics(bets) {
    const settled = bets.filter(b => b.result !== 'PENDING');
    const won     = settled.filter(b => b.result === 'WIN');
    const total   = settled.length;

    if (total === 0) return _emptyMetrics();

    const totalStaked = settled.reduce((s, b) => s + b.stake, 0);
    const totalPnl    = settled.reduce((s, b) => s + (b.pnl ?? 0), 0);
    const roi         = totalStaked > 0 ? Math.round(totalPnl / totalStaked * 10000) / 100 : null;
    const hitRate     = Math.round(won.length / total * 1000) / 10;
    const hitByEdge   = _computeHitRateByEdge(settled);
    const clvBets     = settled.filter(b => b.clv !== null);
    const avgClv      = clvBets.length > 0
      ? Math.round(clvBets.reduce((s, b) => s + b.clv, 0) / clvBets.length * 100) / 100
      : null;
    const brierScore  = _computeBrierScore(settled);
    const biasDetection = _detectBias(settled);
    const byStrategy  = _computeByStrategy(settled);
    const streak      = _computeStreak(bets);

    return {
      total_bets: total, won: won.length,
      lost: settled.filter(b => b.result === 'LOSS').length,
      push: settled.filter(b => b.result === 'PUSH').length,
      hit_rate: hitRate, total_staked: Math.round(totalStaked * 100) / 100,
      total_pnl: Math.round(totalPnl * 100) / 100, roi,
      avg_clv: avgClv, brier_score: brierScore,
      hit_by_edge: hitByEdge, bias: biasDetection,
      by_strategy: byStrategy, streak,
    };
  }
}

// ── FONCTIONS LOCALES (fallback) ──────────────────────────────────────────

function _loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return _defaultState();
    return { ..._defaultState(), ...JSON.parse(raw) };
  } catch {
    return _defaultState();
  }
}

function _saveLocal(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

function _placeBetLocal(betData) {
  const state = _loadLocal();
  const bet = {
    ...betData,
    bet_id:    crypto.randomUUID(),
    placed_at: new Date().toISOString(),
    result:    'PENDING',
    pnl:       null,
    clv:       null,
    strategy:  _detectStrategy(betData),
  };
  state.bets.push(bet);
  state.current_bankroll -= bet.stake;
  state.total_staked     += bet.stake;
  _saveLocal(state);
  return state;
}

function _settleBetLocal(betId, result, closingOdds) {
  const state = _loadLocal();
  const bet   = state.bets.find(b => b.bet_id === betId);
  if (!bet || bet.result !== 'PENDING') return state;

  bet.result      = result;
  bet.settled_at  = new Date().toISOString();
  bet.closing_odds = closingOdds;
if (closingOdds !== null && bet.motor_prob !== null) {
  const decClosing = closingOdds > 0
    ? closingOdds / 100 + 1
    : 100 / Math.abs(closingOdds) + 1;
  const impliedClosing = 1 / decClosing;
  bet.clv = Math.round((bet.motor_prob / 100 - impliedClosing) * 10000) / 100;
}

  if (result === 'WIN') {
    const b = bet.odds_taken > 0 ? bet.odds_taken / 100 + 1 : 100 / Math.abs(bet.odds_taken) + 1;
    bet.pnl = Math.round((bet.stake * b - bet.stake) * 100) / 100;
  } else if (result === 'LOSS') {
    bet.pnl = -bet.stake;
  } else {
    bet.pnl = 0;
  }

  state.current_bankroll += bet.stake + bet.pnl;
  state.total_pnl         = Math.round((state.total_pnl + bet.pnl) * 100) / 100;
  _saveLocal(state);
  return state;
}

function _defaultState(initialBankroll = 1000) {
  return {
    initial_bankroll: initialBankroll,
    current_bankroll: initialBankroll,
    total_staked: 0, total_pnl: 0,
    bets: [], created_at: new Date().toISOString(), mode: 'PAPER',
  };
}

function _detectStrategy(betData) {
  for (const [key, strat] of Object.entries(STRATEGIES)) {
    if (strat.fn(betData)) return key;
  }
  return 'MANUAL';
}

function _emptyMetrics() {
  return {
    total_bets: 0, won: 0, lost: 0, push: 0,
    hit_rate: null, total_staked: 0, total_pnl: 0, roi: null,
    avg_clv: null, brier_score: null,
    hit_by_edge: { '5-8%': null, '8-12%': null, '>12%': null },
    bias: { insufficient_data: true, min_required: 10 },
    by_strategy: { A: null, B: null, C: null },
    streak: { current: 0, type: null, max_loss: 0 },
  };
}

function _computeHitRateByEdge(settled) {
  const buckets = { '5-8%': { won: 0, total: 0 }, '8-12%': { won: 0, total: 0 }, '>12%': { won: 0, total: 0 } };
  settled.forEach(b => {
    const e = b.edge;
    let key = e >= 5 && e < 8 ? '5-8%' : e >= 8 && e < 12 ? '8-12%' : e >= 12 ? '>12%' : null;
    if (!key) return;
    buckets[key].total++;
    if (b.result === 'WIN') buckets[key].won++;
  });
  return Object.entries(buckets).reduce((acc, [k, v]) => {
    acc[k] = v.total > 0
      ? { hit_rate: Math.round(v.won / v.total * 1000) / 10, total: v.total, won: v.won }
      : null;
    return acc;
  }, {});
}

function _computeBrierScore(settled) {
  const valid = settled.filter(b => b.motor_prob !== null && b.result !== 'PUSH');
  if (!valid.length) return null;
  const sum = valid.reduce((s, b) => s + Math.pow(b.motor_prob / 100 - (b.result === 'WIN' ? 1 : 0), 2), 0);
  return Math.round(sum / valid.length * 10000) / 10000;
}

function _detectBias(settled) {
  if (settled.length < 10) return { insufficient_data: true, min_required: 10 };
  const hr = (arr) => arr.length > 0 ? Math.round(arr.filter(b => b.result === 'WIN').length / arr.length * 1000) / 10 : null;
  return {
    insufficient_data: false,
    home_hit_rate:   hr(settled.filter(b => b.side === 'HOME')),
    away_hit_rate:   hr(settled.filter(b => b.side === 'AWAY')),
    over_hit_rate:   hr(settled.filter(b => b.side === 'OVER')),
    under_hit_rate:  hr(settled.filter(b => b.side === 'UNDER')),
    spread_hit_rate: hr(settled.filter(b => b.market === 'SPREAD')),
    home_bets: settled.filter(b => b.side === 'HOME').length,
    away_bets: settled.filter(b => b.side === 'AWAY').length,
  };
}

function _computeByStrategy(settled) {
  return Object.keys(STRATEGIES).reduce((acc, key) => {
    const s = settled.filter(b => b.strategy === key);
    if (!s.length) { acc[key] = null; return acc; }
    const won = s.filter(b => b.result === 'WIN').length;
    const staked = s.reduce((t, b) => t + b.stake, 0);
    const pnl    = s.reduce((t, b) => t + (b.pnl ?? 0), 0);
    acc[key] = { total: s.length, won, hit_rate: Math.round(won / s.length * 1000) / 10, roi: staked > 0 ? Math.round(pnl / staked * 10000) / 100 : null, pnl: Math.round(pnl * 100) / 100 };
    return acc;
  }, {});
}

function _computeStreak(bets) {
  const settled = [...bets].filter(b => b.result !== 'PENDING').reverse();
  if (!settled.length) return { current: 0, type: null, max_loss: 0 };
  let current = 0, type = settled[0]?.result === 'WIN' ? 'WIN' : 'LOSS';
  for (const b of settled) { if (b.result === type) current++; else break; }
  let maxLoss = 0, tmp = 0;
  for (const b of bets.filter(b => b.result !== 'PENDING')) {
    if (b.result === 'LOSS') { tmp++; maxLoss = Math.max(maxLoss, tmp); } else tmp = 0;
  }
  return { current, type, max_loss: maxLoss };
}
