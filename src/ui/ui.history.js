/**
 * MANI BET PRO - ui.history.js v4
 *
 * CORRECTIONS v4 :
 *   1. Bankroll actuelle = capital reel (disponible + engage) — corrige l'affichage 500€
 *      alors que 89€ sont engages.
 *   2. Performance globale : paris PENDING comptes separement (En attente : N).
 *   3. Mise totale : inclut les mises PENDING dans le total engage affiche.
 *   4. Boutons Gagne/Perdu/Push masques sur les paris PENDING — le settler
 *      cloture automatiquement, les boutons sont conserves uniquement pour
 *      correction manuelle d'urgence (accessibles via le modal detail).
 *   5. Heure de match affichee sur chaque pari PENDING.
 *   6. Paris du meme match groupes visuellement.
 *   7. Signal dominant affiche sur chaque pari (net_rating_diff en priorite).
 */

import { PaperEngine, STRATEGIES } from '../paper/paper.engine.js';
import { API_CONFIG } from '../config/api.config.js';

export async function render(container, storeInstance) {
  await _renderPage(container, storeInstance);

  storeInstance.subscribe('paperTradingVersion', function() {
    _renderPage(container, storeInstance);
  });
}

// -- RENDU PRINCIPAL -------------------------------------------------------

async function _renderPage(container, storeInstance) {
  const state   = await PaperEngine.loadAsync();
  const metrics = PaperEngine.computeMetrics(state.bets);

  const pendingBets  = state.bets.filter(function(b) { return b.result === 'PENDING'; });
  const pendingStake = pendingBets.reduce(function(s, b) { return s + b.stake; }, 0);
  const trueCapital  = state.current_bankroll + pendingStake;

  container.innerHTML = [
    '<div class="view-history">',
    '<div class="view-header">',
    '<div class="view-header__meta">MANI BET PRO</div>',
    '<h1 class="view-header__title">Journal de paris</h1>',
    '<div class="view-header__sub">Paper Trading \u00b7 Mode simulation</div>',
    '</div>',
    _renderBankrollCard(state, pendingStake, trueCapital),
    _renderBankrollChart(state),
    _renderMetricsCard(metrics, state.bets.length, pendingBets.length),
    _renderStrategyCard(metrics),
    _renderBiasCard(metrics),
    _renderBetsList(state.bets, storeInstance),
    _renderBacktestExport(),
    _renderDangerZone(state),
    _renderBetModal(),
    '</div>',
  ].join('');

  _bindEvents(container, storeInstance, state);
}

// -- BANKROLL --------------------------------------------------------------

function _renderBankrollCard(state, pendingStake, trueCapital) {
  const pnl      = state.total_pnl;
  const pnlColor = pnl > 0 ? 'var(--color-success)' : pnl < 0 ? 'var(--color-danger)' : 'var(--color-muted)';
  const pnlSign  = pnl > 0 ? '+' : '';
  const roiRaw   = state.total_staked > 0
    ? Math.round(pnl / state.total_staked * 10000) / 100
    : null;

  const stopLoss = trueCapital < state.initial_bankroll * 0.8;

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">',
    '<span style="font-weight:600;font-size:14px">Bankroll</span>',
    '<span class="badge badge--inconclusive" style="font-size:10px">' + state.mode + '</span>',
    '</div>',
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3)">',

    // Initiale
    '<div>',
    '<div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">Initiale</div>',
    '<div style="font-size:16px;font-weight:600">' + state.initial_bankroll.toFixed(0) + ' \u20ac</div>',
    '</div>',

    // Disponible (current_bankroll = déjà déduit des mises PENDING au placement)
    '<div>',
    '<div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">Disponible</div>',
    '<div style="font-size:16px;font-weight:600">' + state.current_bankroll.toFixed(2) + ' \u20ac</div>',
    pendingStake > 0
      ? '<div style="font-size:10px;color:var(--color-warning)">' + pendingStake.toFixed(2) + ' \u20ac engag\u00e9s</div>'
      : '<div style="font-size:10px;color:var(--color-text-secondary)">Aucun pari en attente</div>',
    '</div>',

    // P&L
    '<div>',
    '<div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">P&L total</div>',
    '<div style="font-size:16px;font-weight:600;color:' + pnlColor + '">',
    pnlSign + pnl.toFixed(2) + ' \u20ac',
    roiRaw !== null ? '<span style="font-size:11px;opacity:0.7"> (' + (roiRaw > 0 ? '+' : '') + roiRaw + '%)</span>' : '',
    '</div>',
    '</div>',

    '</div>',
    stopLoss ? '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,99,99,0.1);border-left:2px solid var(--color-danger);border-radius:4px;font-size:11px;color:var(--color-danger)">\u26a0 Stop loss \u2014 bankroll sous 80% du capital initial. R\u00e9duisez les mises.</div>' : '',
    '<div style="margin-top:var(--space-3);display:flex;gap:8px">',
    '<button class="btn btn--ghost btn--sm" id="configure-bankroll">\u2699 Configurer bankroll</button>',
    '</div>',
    '</div>',
  ].join('');
}

// -- COURBE BANKROLL -------------------------------------------------------

function _renderBankrollChart(state) {
  const bets = state.bets.filter(function(b) { return b.result !== 'PENDING'; })
    .slice().sort(function(a, b) {
      return new Date(a.settled_at || a.placed_at) - new Date(b.settled_at || b.placed_at);
    });
  if (bets.length < 2) return '';

  let bankroll = state.initial_bankroll;
  const points = [{ x: 0, y: bankroll, bet: null }];

  bets.forEach(function(bet, i) {
    bankroll += (bet.pnl || 0);
    points.push({
      x:   i + 1,
      y:   Math.round(bankroll * 100) / 100,
      bet: bet,
    });
  });

  // Max drawdown : distance max entre un peak précédent et un creux suivant
  let peak = points[0].y;
  let maxDD = 0;
  points.forEach(function(p) {
    if (p.y > peak) peak = p.y;
    const dd = peak - p.y;
    if (dd > maxDD) maxDD = dd;
  });
  const maxDDPct = peak > 0 ? Math.round(maxDD / peak * 1000) / 10 : 0;

  const minY   = Math.min.apply(null, points.map(function(p) { return p.y; })) * 0.98;
  const maxY   = Math.max.apply(null, points.map(function(p) { return p.y; })) * 1.02;
  const rangeY = maxY - minY || 1;
  const W = 300, H = 100;

  function toX(i) { return (i / (points.length - 1)) * W; }
  function toY(y) { return H - ((y - minY) / rangeY) * H; }

  const pathData = points.map(function(p, i) {
    return (i === 0 ? 'M' : 'L') + ' ' + toX(i).toFixed(1) + ' ' + toY(p.y).toFixed(1);
  }).join(' ');
  const areaData = pathData + ' L ' + toX(points.length - 1).toFixed(1) + ' ' + H + ' L 0 ' + H + ' Z';

  const lastY    = points[points.length - 1].y;
  const isProfit = lastY >= state.initial_bankroll;
  const color    = isProfit ? '#48c78e' : '#f14668';
  const refY     = toY(state.initial_bankroll).toFixed(1);

  // Points hover invisibles pour tooltip
  const hoverCircles = points.map(function(p, i) {
    if (!p.bet) return '';
    const title = (p.bet.match_label || (p.bet.home + ' vs ' + p.bet.away) || 'Pari ' + i)
      + ' · ' + (p.bet.result || '') + ' · ' + (p.bet.pnl >= 0 ? '+' : '') + (p.bet.pnl || 0).toFixed(2) + ' € · solde ' + p.y.toFixed(2) + ' €';
    return '<circle cx="' + toX(i).toFixed(1) + '" cy="' + toY(p.y).toFixed(1) + '" r="4" fill="transparent" style="cursor:help"><title>' + title.replace(/[<>&"]/g, '') + '</title></circle>';
  }).join('');

  const ddColor = maxDDPct > 15 ? 'var(--color-danger)' : maxDDPct > 8 ? 'var(--color-warning)' : 'var(--color-text-secondary)';

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">',
    '<div style="font-weight:600;font-size:13px">Courbe de bankroll</div>',
    '<div style="font-size:10px;color:' + ddColor + '">Drawdown max : ' + maxDD.toFixed(2) + ' \u20ac (' + maxDDPct + '%)</div>',
    '</div>',
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:100px;overflow:visible">',
    '<defs><linearGradient id="bankroll-grad" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.35"/>',
    '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>',
    '</linearGradient></defs>',
    '<path d="' + areaData + '" fill="url(#bankroll-grad)" />',
    '<path d="' + pathData + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>',
    '<line x1="0" y1="' + refY + '" x2="' + W + '" y2="' + refY + '" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,4"/>',
    '<circle cx="' + toX(points.length - 1).toFixed(1) + '" cy="' + toY(lastY).toFixed(1) + '" r="3" fill="' + color + '"/>',
    hoverCircles,
    '</svg>',
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-secondary);margin-top:4px">',
    '<span>D\u00e9part : ' + state.initial_bankroll + ' \u20ac</span>',
    '<span>' + bets.length + ' paris cl\u00f4tur\u00e9s</span>',
    '<span>Actuel : ' + lastY.toFixed(2) + ' \u20ac</span>',
    '</div>',
    '</div>',
  ].join('');
}

// -- METRIQUES -------------------------------------------------------------

function _renderMetricsCard(metrics, totalBets, pendingCount) {
  if (metrics.total_bets === 0 && totalBets === 0) {
    return '<div class="card" style="margin-bottom:var(--space-4);text-align:center;padding:var(--space-6)"><div style="font-size:24px;margin-bottom:var(--space-2)">&#128203;</div><div style="color:var(--color-text-secondary);font-size:13px">Aucun pari enregistr\u00e9.<br>Ouvre une fiche match et clique sur <strong>"Enregistrer ce pari"</strong>.</div></div>';
  }

  const hitColor   = metrics.hit_rate !== null ? (metrics.hit_rate >= 55 ? 'var(--color-success)' : metrics.hit_rate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--color-muted)';
  const roiColor   = metrics.roi !== null ? (metrics.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)') : 'var(--color-muted)';
  const brierLabel = metrics.brier_score !== null ? (metrics.brier_score < 0.20 ? '\u2713 Bien calibr\u00e9' : metrics.brier_score < 0.25 ? 'Acceptable' : '\u26a0 Mal calibr\u00e9') : '\u2014';
  const streakLabel = metrics.streak.current > 0 ? metrics.streak.current + ' ' + (metrics.streak.type === 'WIN' ? 'victoires' : 'defaites') + ' cons\u00e9cutives' : '\u2014';
  const streakColor = metrics.streak.type === 'WIN' ? 'var(--color-success)' : metrics.streak.type === 'LOSS' ? 'var(--color-danger)' : 'var(--color-muted)';

  // Mises totales incluant PENDING
  const totalStakedDisplay = metrics.total_staked;

  const edgeBuckets = Object.entries(metrics.hit_by_edge || {}).map(function(entry) {
    const bucket = entry[0], data = entry[1];
    return '<div style="background:var(--color-bg);border-radius:6px;padding:var(--space-2);text-align:center"><div style="font-size:10px;color:var(--color-text-secondary)">' + bucket + '</div><div style="font-size:14px;font-weight:600;color:var(--color-text)">' + (data && data.hit_rate !== null ? data.hit_rate + '%' : '\u2014') + '</div><div style="font-size:10px;color:var(--color-text-secondary)">' + (data ? data.total : 0) + ' paris</div></div>';
  }).join('');

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Performance globale</div>',
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-3)">',

    // Paris clotures + en attente
    _metricCell(
      'Paris',
      metrics.won + 'W / ' + metrics.lost + 'L / ' + metrics.push + 'P',
      'var(--color-text)',
      pendingCount > 0 ? pendingCount + ' en attente' : null
    ),
    _metricCell('Hit rate', metrics.hit_rate !== null ? metrics.hit_rate + '%' : '\u2014', hitColor),
    _metricCell('ROI', metrics.roi !== null ? (metrics.roi > 0 ? '+' : '') + metrics.roi + '%' : '\u2014', roiColor),

    // Mise totale = clôturés seulement (les PENDING sont dans "engagés" de la bankroll)
    _metricCell('Mis\u00e9 (cl\u00f4tur\u00e9s)', totalStakedDisplay.toFixed(2) + ' \u20ac', 'var(--color-text)'),
    _metricCell('CLV moyen', metrics.avg_clv !== null ? (metrics.avg_clv > 0 ? '+' : '') + metrics.avg_clv + '%' : '\u2014', metrics.avg_clv > 0 ? 'var(--color-success)' : 'var(--color-muted)'),
    _metricCell('Brier Score', metrics.brier_score !== null ? metrics.brier_score.toFixed(4) : '\u2014', 'var(--color-muted)', brierLabel),

    '</div>',
    '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:var(--space-2)">Hit rate par niveau d\'edge</div>',
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2)">',
    edgeBuckets,
    '</div>',
    metrics.streak.current >= 3 ? '<div style="margin-top:var(--space-3);padding:var(--space-2) var(--space-3);background:rgba(255,165,0,0.08);border-left:2px solid ' + streakColor + ';border-radius:4px;font-size:11px;color:' + streakColor + '">\u26a0 S\u00e9rie en cours : ' + streakLabel + (metrics.streak.type === 'LOSS' && metrics.streak.current >= 5 ? ' \u2014 R\u00e9duction des mises recommand\u00e9e' : '') + '</div>' : '',
    '</div>',
  ].join('');
}

// -- STRATEGIES ------------------------------------------------------------

function _renderStrategyCard(metrics) {
  const strategies = metrics.by_strategy;
  const hasData = Object.values(strategies).some(function(s) { return s !== null; });
  if (!hasData) return '';

  const rows = Object.entries(STRATEGIES).map(function(entry) {
    const key = entry[0], strat = entry[1];
    const data = strategies[key];
    if (!data) return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)"><div><div style="font-size:12px;font-weight:600">' + strat.label + '</div><div style="font-size:10px;color:var(--color-text-secondary)">Strat\u00e9gie ' + key + '</div></div><span style="font-size:11px;color:var(--color-text-secondary)">Pas de donn\u00e9es</span></div>';
    const roiColor = data.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)"><div><div style="font-size:12px;font-weight:600">' + strat.label + '</div><div style="font-size:10px;color:var(--color-text-secondary)">Strat\u00e9gie ' + key + ' \u00b7 ' + data.total + ' paris</div></div><div style="text-align:right"><div style="font-size:13px;font-weight:600;color:' + roiColor + '">ROI ' + (data.roi !== null ? (data.roi > 0 ? '+' : '') + data.roi + '%' : '\u2014') + '</div><div style="font-size:10px;color:var(--color-text-secondary)">' + data.hit_rate + '% hit rate</div></div></div>';
  }).join('');

  return '<div class="card" style="margin-bottom:var(--space-4)"><div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Comparaison strat\u00e9gies</div><div style="display:flex;flex-direction:column;gap:var(--space-2)">' + rows + '</div></div>';
}

// -- BIAIS -----------------------------------------------------------------

function _renderBiasCard(metrics) {
  const bias = metrics.bias;
  if (!bias || bias.insufficient_data) {
    return '<div class="card" style="margin-bottom:var(--space-4)"><div style="font-weight:600;font-size:14px;margin-bottom:var(--space-2)">D\u00e9tection de biais</div><div style="font-size:12px;color:var(--color-text-secondary)">' + (bias ? bias.min_required : 10) + ' paris minimum requis pour d\u00e9tecter les biais. Actuellement : ' + metrics.total_bets + ' paris cl\u00f4tur\u00e9s.</div></div>';
  }

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">D\u00e9tection de biais</div>',
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-2)">',
    _biasRow('Domicile', bias.home_hit_rate, bias.home_bets),
    _biasRow('Ext\u00e9rieur', bias.away_hit_rate, bias.away_bets),
    _biasRow('Over', bias.over_hit_rate),
    _biasRow('Under', bias.under_hit_rate),
    '</div>',
    '</div>',
  ].join('');
}

function _biasRow(label, hitRate, count) {
  const color = hitRate !== null ? (hitRate >= 55 ? 'var(--color-success)' : hitRate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--color-muted)';
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px"><span style="font-size:12px">' + label + (count != null ? ' (' + count + ')' : '') + '</span><span style="font-size:12px;font-weight:600;color:' + color + '">' + (hitRate !== null ? hitRate + '%' : '\u2014') + '</span></div>';
}

// -- LISTE DES PARIS -------------------------------------------------------

function _renderBetsList(bets, storeInstance) {
  if (!bets.length) return '';

  const sorted = bets.slice().reverse();

  // Grouper visuellement les paris du meme match
  const groups = {};
  sorted.forEach(function(bet) {
    const key = (bet.home || '') + '_' + (bet.away || '') + '_' + (bet.date || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(bet);
  });

  const rows = sorted.map(function(bet, i) {
    const key = (bet.home || '') + '_' + (bet.away || '') + '_' + (bet.date || '');
    const isFirstInGroup = groups[key][0].bet_id === bet.bet_id;
    const groupSize = groups[key].length;
    return _renderBetRow(bet, isFirstInGroup, groupSize);
  }).join('');

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">',
    '<span style="font-weight:600;font-size:14px">Paris enregistr\u00e9s (' + bets.length + ')</span>',
    '</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-2)">',
    rows,
    '</div>',
    '</div>',
  ].join('');
}

function _renderBetRow(bet, isFirstInGroup, groupSize) {
  const isPending   = bet.result === 'PENDING';
  const resultColor = bet.result === 'WIN' ? 'var(--color-success)' : bet.result === 'LOSS' ? 'var(--color-danger)' : bet.result === 'PUSH' ? 'var(--color-muted)' : 'var(--color-warning)';
  const resultLabel = { WIN: '\u2713 Gagn\u00e9', LOSS: '\u2717 Perdu', PUSH: '\u2014 Push', PENDING: '\u23f3 En attente' };
  const oddsDecimal = _americanToDecimal(bet.odds_taken);
  const marketLabel = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  // Score du match si disponible
  const scoreStr = (!isPending && bet.home_score != null && bet.away_score != null)
    ? '<span style="font-family:var(--font-mono);font-size:11px;color:var(--color-text);margin-left:8px">' + bet.home_score + '\u2013' + bet.away_score + '</span>'
    : '';

  // Heure du match si disponible (PENDING uniquement)
  const timeStr = (isPending && bet.match_time)
    ? '<span style="font-size:10px;color:var(--color-text-secondary);margin-left:6px">\u23f0 ' + bet.match_time + '</span>'
    : '';

  // Signal dominant
  const signalStr = bet.top_signal
    ? '<span style="font-size:10px;color:var(--color-text-secondary);margin-left:6px">\u2022 ' + bet.top_signal + '</span>'
    : '';

  // Bordure top si premier du groupe multi-paris
  const groupStyle = (groupSize > 1 && isFirstInGroup)
    ? 'border-top:2px solid var(--color-border);'
    : '';

  return [
    '<div class="bet-row" data-bet-id="' + bet.bet_id + '" style="padding:var(--space-3);background:var(--color-bg);border-radius:8px;border-left:3px solid ' + resultColor + ';' + groupStyle + 'cursor:pointer" title="Cliquer pour les d\u00e9tails">',

    // En-tete
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">',
    '<div>',
    '<div style="font-size:12px;font-weight:600">' + (bet.home || '') + ' vs ' + (bet.away || '') + scoreStr + '</div>',
    '<div style="font-size:10px;color:var(--color-text-secondary)">' + _formatDate(bet.date) + ' \u00b7 ' + (marketLabel[bet.market] || bet.market) + timeStr + signalStr + '</div>',
    '</div>',
    '<span style="font-size:11px;font-weight:600;color:' + resultColor + '">' + (resultLabel[bet.result] || bet.result) + '</span>',
    '</div>',

    // Details
    '<div style="display:flex;gap:12px;font-size:11px;margin-bottom:4px;flex-wrap:wrap">',
    '<span><strong>' + (bet.side_label || '') + '</strong> ' + (oddsDecimal ? oddsDecimal.toFixed(2) : '') + '</span>',
    '<span style="color:var(--color-text-secondary)">Mise : ' + bet.stake.toFixed(2) + ' \u20ac</span>',
    '<span style="color:var(--color-text-secondary)">Edge : ' + bet.edge + '%</span>',
    bet.pnl !== null ? '<span style="color:' + (bet.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)') + '">P&L : ' + (bet.pnl >= 0 ? '+' : '') + bet.pnl.toFixed(2) + ' \u20ac</span>' : '',
    bet.clv !== null ? '<span style="color:var(--color-text-secondary)">CLV : ' + (bet.clv > 0 ? '+' : '') + bet.clv + '%</span>' : '',
    '</div>',

    // Settler automatique actif — pas de boutons manuels sauf via modal
    isPending
      ? '<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">\u21bb Cl\u00f4ture automatique en cours \u00b7 <span style="text-decoration:underline;cursor:pointer" class="manual-settle-hint" data-bet-id="' + bet.bet_id + '">Forcer manuellement</span></div>'
      : '',

    '</div>',
  ].join('');
}

// -- MODAL DETAIL PARI -----------------------------------------------------

function _renderBetModal() {
  return [
    '<div id="bet-detail-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;padding:16px">',
    '<div style="background:var(--color-card);border-radius:12px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;padding:var(--space-5)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">',
    '<span style="font-weight:700;font-size:15px">D\u00e9tail du pari</span>',
    '<button id="close-bet-modal" style="background:none;border:none;color:var(--color-text-secondary);font-size:20px;cursor:pointer;padding:0">&times;</button>',
    '</div>',
    '<div id="bet-detail-content"></div>',
    '</div>',
    '</div>',
  ].join('');
}

function _renderBetDetail(bet) {
  const oddsDecimal = _americanToDecimal(bet.odds_taken);
  const marketLabel = { MONEYLINE: 'Vainqueur du match', SPREAD: 'Handicap (spread)', OVER_UNDER: 'Total de points' };
  const resultLabel = { WIN: '\u2713 Gagn\u00e9', LOSS: '\u2717 Perdu', PUSH: '\u2014 Push', PENDING: '\u23f3 En attente' };
  const resultColor = bet.result === 'WIN' ? 'var(--color-success)' : bet.result === 'LOSS' ? 'var(--color-danger)' : bet.result === 'PUSH' ? 'var(--color-muted)' : 'var(--color-warning)';

  const rows = [];

  rows.push(_detailRow('Match', (bet.home || '') + ' vs ' + (bet.away || '')));
  rows.push(_detailRow('Date', _formatDate(bet.date)));

  if (bet.home_score != null && bet.away_score != null) {
    rows.push(_detailRow('Score final', bet.home_score + ' \u2013 ' + bet.away_score, bet.result === 'WIN' ? 'var(--color-success)' : null));
  }

  rows.push(_detailRow('March\u00e9', marketLabel[bet.market] || bet.market));
  rows.push(_detailRow('C\u00f4te prise', oddsDecimal ? oddsDecimal.toFixed(2) + ' (' + (bet.odds_taken > 0 ? '+' : '') + bet.odds_taken + ')' : String(bet.odds_taken)));

  if (bet.odds_source)    rows.push(_detailRow('Bookmaker', bet.odds_source));
  if (bet.spread_line != null) rows.push(_detailRow('Ligne spread', (bet.spread_line > 0 ? '+' : '') + bet.spread_line + ' pts'));
  if (bet.ou_line != null)     rows.push(_detailRow('Ligne O/U', bet.ou_line + ' pts'));

  rows.push(_detailRow('Mise', bet.stake.toFixed(2) + ' \u20ac'));
  rows.push(_detailRow('Edge moteur', '+' + bet.edge + '%'));

  if (bet.motor_prob   != null) rows.push(_detailRow('Prob. moteur', bet.motor_prob + '%'));
  if (bet.implied_prob != null) rows.push(_detailRow('Prob. march\u00e9', bet.implied_prob + '%'));
  if (bet.kelly_stake  != null) rows.push(_detailRow('Kelly recommand\u00e9', (bet.kelly_stake * 100).toFixed(1) + '% de bankroll'));
  if (bet.top_signal)           rows.push(_detailRow('Signal dominant', bet.top_signal));

  rows.push(_detailRow('R\u00e9sultat', resultLabel[bet.result] || bet.result, resultColor));

  if (bet.pnl !== null) rows.push(_detailRow('P&L', (bet.pnl >= 0 ? '+' : '') + bet.pnl.toFixed(2) + ' \u20ac', bet.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'));
  if (bet.clv !== null) rows.push(_detailRow('CLV', (bet.clv > 0 ? '+' : '') + bet.clv + '%'));
  if (bet.decision_note) rows.push(_detailRow('Signal moteur', bet.decision_note));
  if (bet.placed_at)    rows.push(_detailRow('Plac\u00e9 le', new Date(bet.placed_at).toLocaleString('fr-FR')));
  if (bet.settled_at)   rows.push(_detailRow('Cl\u00f4tur\u00e9 le', new Date(bet.settled_at).toLocaleString('fr-FR')));

  // Boutons settle manuels accessibles uniquement depuis le modal
  const manualSettle = bet.result === 'PENDING' ? [
    '<div style="margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--color-border)">',
    '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:var(--space-2)">Forcer le r\u00e9sultat manuellement :</div>',
    '<div style="display:flex;gap:8px">',
    '<button class="btn btn--sm modal-settle-btn" style="background:var(--color-success);color:#000;font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="WIN">\u2713 Gagn\u00e9</button>',
    '<button class="btn btn--sm modal-settle-btn" style="background:var(--color-danger);color:#fff;font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="LOSS">\u2717 Perdu</button>',
    '<button class="btn btn--ghost btn--sm modal-settle-btn" style="font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="PUSH">\u2014 Push</button>',
    '</div>',
    '</div>',
  ].join('') : '';

  return '<div style="display:flex;flex-direction:column;gap:8px">' + rows.join('') + '</div>' + manualSettle;
}

function _detailRow(label, value, color) {
  return [
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--color-border)">',
    '<span style="font-size:12px;color:var(--color-text-secondary)">' + label + '</span>',
    '<span style="font-size:12px;font-weight:600' + (color ? ';color:' + color : '') + '">' + value + '</span>',
    '</div>',
  ].join('');
}

// -- EXPORT BACKTEST -------------------------------------------------------
// Télécharge les logs bot enrichis (variables utilisées + résultats + prob_delta)
// sous forme CSV pour analyse offline (Excel, pandas, calibration modèle).

function _renderBacktestExport() {
  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:13px;margin-bottom:var(--space-2)">Backtest (logs bot)</div>',
    '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:var(--space-3)">',
    'Variables moteur, pr\u00e9dictions et r\u00e9sultats r\u00e9els. Idem pour calibrer le mod\u00e8le offline.',
    '</div>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<button class="btn btn--ghost btn--sm" data-export-logs="nba" data-days="30">NBA 30j</button>',
    '<button class="btn btn--ghost btn--sm" data-export-logs="nba" data-days="90">NBA 90j</button>',
    '<button class="btn btn--ghost btn--sm" data-export-logs="mlb" data-days="30">MLB 30j</button>',
    '<button class="btn btn--ghost btn--sm" data-export-logs="mlb" data-days="90">MLB 90j</button>',
    '</div>',
    '</div>',
  ].join('');
}

// -- DANGER ZONE -----------------------------------------------------------

function _renderDangerZone(state) {
  return [
    '<div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-border)">',
    '<div style="font-weight:600;font-size:13px;margin-bottom:var(--space-3);color:var(--color-text-secondary)">Gestion</div>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<button class="btn btn--ghost btn--sm" id="export-bets">&#128205; Exporter CSV</button>',
    '<button class="btn btn--ghost btn--sm" id="reset-paper" style="color:var(--color-danger)">\u26a0 R\u00e9initialiser</button>',
    '</div>',
    '</div>',
  ].join('');
}

// -- BIND EVENTS -----------------------------------------------------------

function _bindEvents(container, storeInstance, state) {
  // Configurer bankroll
  const configBtn = container.querySelector('#configure-bankroll');
  if (configBtn) {
    configBtn.addEventListener('click', async function() {
      const input = prompt('Nouvelle bankroll initiale (\u20ac) :', state.initial_bankroll);
      const val   = parseFloat(input);
      if (!val || val <= 0) return;
      await PaperEngine.reset(val);
      storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
    });
  }

  // Clic sur une ligne de pari -> ouvrir modal detail
  container.querySelectorAll('.bet-row').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.classList.contains('manual-settle-hint') || e.target.closest('.manual-settle-hint')) {
        // Ouvrir le modal directement sur la section settle
        const betId = e.target.dataset.betId || e.target.closest('.manual-settle-hint').dataset.betId;
        const bet   = state.bets.find(function(b) { return b.bet_id === betId; });
        if (!bet) return;
        _openModal(container, bet);
        return;
      }

      const betId = row.dataset.betId;
      const bet   = state.bets.find(function(b) { return b.bet_id === betId; });
      if (!bet) return;
      _openModal(container, bet);
    });
  });

  // Boutons settle dans le modal
  container.addEventListener('click', async function(e) {
    const btn = e.target.closest('.modal-settle-btn');
    if (!btn) return;
    const betId  = btn.dataset.betId;
    const result = btn.dataset.result;
    btn.disabled = true;
    btn.textContent = '...';
    await PaperEngine.settleBet(betId, result);
    const modal = container.querySelector('#bet-detail-modal');
    if (modal) modal.style.display = 'none';
    storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
  });

  // Fermer modal
  const closeBtn = container.querySelector('#close-bet-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      const modal = container.querySelector('#bet-detail-modal');
      if (modal) modal.style.display = 'none';
    });
  }

  // Fermer modal en cliquant dehors
  const modal = container.querySelector('#bet-detail-modal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Export CSV
  const exportBtn = container.querySelector('#export-bets');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() { _exportCSV(state.bets); });
  }

  // Reset
  const resetBtn = container.querySelector('#reset-paper');
  if (resetBtn) {
    resetBtn.addEventListener('click', async function() {
      if (confirm('R\u00e9initialiser tout le paper trading ? Cette action est irr\u00e9versible.')) {
        await PaperEngine.reset(state.initial_bankroll);
        storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
      }
    });
  }

  // Export backtest logs (NBA/MLB) — appel Worker CSV, déclenche téléchargement
  container.querySelectorAll('[data-export-logs]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const sport = btn.dataset.exportLogs;
      const days  = btn.dataset.days || '30';
      const url   = API_CONFIG.WORKER_BASE_URL + '/bot/logs/export.csv?sport=' + sport + '&days=' + days;
      const a     = document.createElement('a');
      a.href      = url;
      a.download  = 'manibetpro-' + sport + '-logs-' + days + 'd.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}

function _openModal(container, bet) {
  const modal   = container.querySelector('#bet-detail-modal');
  const content = container.querySelector('#bet-detail-content');
  if (!modal || !content) return;
  content.innerHTML = _renderBetDetail(bet);
  modal.style.display = 'flex';
}

// -- EXPORT CSV ------------------------------------------------------------

function _exportCSV(bets) {
  if (!bets.length) return;

  const headers = ['Date', 'Match', 'Score', 'March\u00e9', 'C\u00f4te', 'C\u00f4te decimale', 'Mise', 'Edge', 'Moteur%', 'March\u00e9%', 'R\u00e9sultat', 'P&L', 'CLV', 'Strat\u00e9gie', 'Signal dominant'];
  const rows = bets.map(function(b) {
    const dec = _americanToDecimal(b.odds_taken);
    return [
      b.date,
      (b.home || '') + ' vs ' + (b.away || ''),
      b.home_score != null ? b.home_score + '-' + b.away_score : '',
      b.market,
      b.odds_taken,
      dec ? dec.toFixed(2) : '',
      b.stake.toFixed(2),
      b.edge,
      b.motor_prob || '',
      b.implied_prob || '',
      b.result,
      b.pnl != null ? b.pnl.toFixed(2) : '',
      b.clv != null ? b.clv : '',
      b.strategy || '',
      b.top_signal || '',
    ];
  });

  const csv  = [headers].concat(rows).map(function(r) { return r.map(function(v) { return '"' + v + '"'; }).join(','); }).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'mani-bet-pro-paris-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// -- HELPERS ---------------------------------------------------------------

function _metricCell(label, value, color, subtitle) {
  return [
    '<div style="text-align:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px">',
    '<div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">' + label + '</div>',
    '<div style="font-size:15px;font-weight:600;color:' + color + '">' + value + '</div>',
    subtitle ? '<div style="font-size:9px;color:var(--color-text-secondary);margin-top:1px">' + subtitle + '</div>' : '',
    '</div>',
  ].join('');
}

function _americanToDecimal(american) {
  if (!american) return null;
  const n = Number(american);
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

function _formatDate(iso) {
  if (!iso) return '\u2014';
  const normalized = iso.length === 8
    ? iso.slice(0, 4) + '-' + iso.slice(4, 6) + '-' + iso.slice(6, 8)
    : iso;
  return new Date(normalized + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
