/**
 * MANI BET PRO - ui.history.js v3
 *
 * AJOUTS v3 :
 *   1. Fiche detail pari - clic sur un pari ouvre un modal avec :
 *      - Score final du match (si disponible)
 *      - Cote prise + cote decimale
 *      - Probabilite moteur vs marche
 *      - Edge, Kelly, CLV
 *      - Motif de la recommandation
 *   2. Bankroll corrigee - separe capital disponible vs capital engage (PENDING)
 *   3. Exposition journaliere affichee dans les metriques
 */

import { PaperEngine, STRATEGIES } from '../paper/paper.engine.js';

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

  // Capital engage dans les paris PENDING
  const pendingStake = state.bets
    .filter(function(b) { return b.result === 'PENDING'; })
    .reduce(function(s, b) { return s + b.stake; }, 0);

  // Capital reel = disponible + engage
  const trueCapital = state.current_bankroll + pendingStake;

  container.innerHTML = [
    '<div class="view-history">',
    '<div class="view-header">',
    '<div class="view-header__meta">MANI BET PRO</div>',
    '<h1 class="view-header__title">Journal de paris</h1>',
    '<div class="view-header__sub">Paper Trading · Mode simulation</div>',
    '</div>',
    _renderBankrollCard(state, pendingStake, trueCapital),
    _renderBankrollChart(state),
    _renderMetricsCard(metrics, state.bets.length),
    _renderStrategyCard(metrics),
    _renderBiasCard(metrics),
    _renderBetsList(state.bets, storeInstance),
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
    '<div>',
    '<div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Initiale</div>',
    '<div style="font-size:16px;font-weight:600">' + state.initial_bankroll.toFixed(0) + ' \u20ac</div>',
    '</div>',
    '<div>',
    '<div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Actuelle</div>',
    '<div style="font-size:16px;font-weight:600">' + trueCapital.toFixed(2) + ' \u20ac</div>',
    pendingStake > 0 ? '<div style="font-size:10px;color:var(--color-warning)">' + pendingStake.toFixed(2) + ' \u20ac engages</div>' : '',
    '</div>',
    '<div>',
    '<div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">P&L total</div>',
    '<div style="font-size:16px;font-weight:600;color:' + pnlColor + '">',
    pnlSign + pnl.toFixed(2) + ' \u20ac',
    roiRaw !== null ? '<span style="font-size:11px;opacity:0.7"> (' + (roiRaw > 0 ? '+' : '') + roiRaw + '%)</span>' : '',
    '</div>',
    '</div>',
    '</div>',
    stopLoss ? '<div style="margin-top:10px;padding:8px 10px;background:rgba(255,99,99,0.1);border-left:2px solid var(--color-danger);border-radius:4px;font-size:11px;color:var(--color-danger)">\u26a0 Stop loss \u2014 bankroll sous 80% du capital initial. Reduisez les mises.</div>' : '',
    '<div style="margin-top:var(--space-3);display:flex;gap:8px">',
    '<button class="btn btn--ghost btn--sm" id="configure-bankroll">\u2699 Configurer bankroll</button>',
    '</div>',
    '</div>',
  ].join('');
}

// -- COURBE BANKROLL -------------------------------------------------------

function _renderBankrollChart(state) {
  var bets = state.bets.filter(function(b) { return b.result !== 'PENDING'; });
  if (bets.length < 2) return '';

  var bankroll = state.initial_bankroll;
  var points = [{ x: 0, y: bankroll }];

  bets.forEach(function(bet, i) {
    bankroll += (bet.pnl || 0);
    points.push({ x: i + 1, y: Math.round(bankroll * 100) / 100 });
  });

  var minY   = Math.min.apply(null, points.map(function(p) { return p.y; })) * 0.98;
  var maxY   = Math.max.apply(null, points.map(function(p) { return p.y; })) * 1.02;
  var rangeY = maxY - minY || 1;
  var W = 300, H = 80;

  function toX(i) { return (i / (points.length - 1)) * W; }
  function toY(y) { return H - ((y - minY) / rangeY) * H; }

  var pathData = points.map(function(p, i) {
    return (i === 0 ? 'M' : 'L') + ' ' + toX(i).toFixed(1) + ' ' + toY(p.y).toFixed(1);
  }).join(' ');
  var areaData = pathData + ' L ' + toX(points.length - 1).toFixed(1) + ' ' + H + ' L 0 ' + H + ' Z';

  var lastY    = points[points.length - 1].y;
  var isProfit = lastY >= state.initial_bankroll;
  var color    = isProfit ? '#48c78e' : '#f14668';
  var refY     = toY(state.initial_bankroll).toFixed(1);

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:13px;margin-bottom:var(--space-3)">Courbe de bankroll</div>',
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:80px;overflow:visible">',
    '<defs><linearGradient id="bankroll-grad" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.3"/>',
    '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>',
    '</linearGradient></defs>',
    '<path d="' + areaData + '" fill="url(#bankroll-grad)" />',
    '<path d="' + pathData + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>',
    '<line x1="0" y1="' + refY + '" x2="' + W + '" y2="' + refY + '" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,4"/>',
    '<circle cx="' + toX(points.length - 1).toFixed(1) + '" cy="' + toY(lastY).toFixed(1) + '" r="3" fill="' + color + '"/>',
    '</svg>',
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-muted);margin-top:4px">',
    '<span>Depart : ' + state.initial_bankroll + ' \u20ac</span>',
    '<span>Actuel : ' + lastY.toFixed(2) + ' \u20ac</span>',
    '</div>',
    '</div>',
  ].join('');
}

// -- METRIQUES -------------------------------------------------------------

function _renderMetricsCard(metrics, totalBets) {
  if (metrics.total_bets === 0 && totalBets === 0) {
    return '<div class="card" style="margin-bottom:var(--space-4);text-align:center;padding:var(--space-6)"><div style="font-size:24px;margin-bottom:var(--space-2)">&#128203;</div><div style="color:var(--color-muted);font-size:13px">Aucun pari enregistre.<br>Ouvre une fiche match et clique sur <strong>"Enregistrer ce pari"</strong>.</div></div>';
  }

  var hitColor  = metrics.hit_rate !== null ? (metrics.hit_rate >= 55 ? 'var(--color-success)' : metrics.hit_rate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--color-muted)';
  var roiColor  = metrics.roi !== null ? (metrics.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)') : 'var(--color-muted)';
  var brierLabel = metrics.brier_score !== null ? (metrics.brier_score < 0.20 ? '\u2713 Bien calibre' : metrics.brier_score < 0.25 ? 'Acceptable' : '\u26a0 Mal calibre') : '\u2014';
  var streakLabel = metrics.streak.current > 0 ? metrics.streak.current + ' ' + (metrics.streak.type === 'WIN' ? 'victoires' : 'defaites') + ' consecutives' : '\u2014';
  var streakColor = metrics.streak.type === 'WIN' ? 'var(--color-success)' : metrics.streak.type === 'LOSS' ? 'var(--color-danger)' : 'var(--color-muted)';

  var edgeBuckets = Object.entries(metrics.hit_by_edge || {}).map(function(entry) {
    var bucket = entry[0], data = entry[1];
    return '<div style="background:var(--color-bg);border-radius:6px;padding:var(--space-2);text-align:center"><div style="font-size:10px;color:var(--color-muted)">' + bucket + '</div><div style="font-size:14px;font-weight:600;color:var(--color-text)">' + (data && data.hit_rate !== null ? data.hit_rate + '%' : '\u2014') + '</div><div style="font-size:10px;color:var(--color-muted)">' + (data ? data.total : 0) + ' paris</div></div>';
  }).join('');

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Performance globale</div>',
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-3)">',
    _metricCell('Paris', metrics.won + 'W / ' + metrics.lost + 'L / ' + metrics.push + 'P', 'var(--color-text)'),
    _metricCell('Hit rate', metrics.hit_rate !== null ? metrics.hit_rate + '%' : '\u2014', hitColor),
    _metricCell('ROI', metrics.roi !== null ? (metrics.roi > 0 ? '+' : '') + metrics.roi + '%' : '\u2014', roiColor),
    _metricCell('Mise total', metrics.total_staked.toFixed(2) + ' \u20ac', 'var(--color-text)'),
    _metricCell('CLV moyen', metrics.avg_clv !== null ? (metrics.avg_clv > 0 ? '+' : '') + metrics.avg_clv + '%' : '\u2014', metrics.avg_clv > 0 ? 'var(--color-success)' : 'var(--color-muted)'),
    _metricCell('Brier Score', metrics.brier_score !== null ? metrics.brier_score.toFixed(4) : '\u2014', 'var(--color-muted)', brierLabel),
    '</div>',
    '<div style="font-size:11px;color:var(--color-muted);margin-bottom:var(--space-2)">Hit rate par niveau d\'edge</div>',
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2)">',
    edgeBuckets,
    '</div>',
    metrics.streak.current >= 3 ? '<div style="margin-top:var(--space-3);padding:var(--space-2) var(--space-3);background:rgba(255,165,0,0.08);border-left:2px solid ' + streakColor + ';border-radius:4px;font-size:11px;color:' + streakColor + '">\u26a0 Serie en cours : ' + streakLabel + (metrics.streak.type === 'LOSS' && metrics.streak.current >= 5 ? ' \u2014 Reduction des mises recommandee' : '') + '</div>' : '',
    '</div>',
  ].join('');
}

// -- STRATEGIES ------------------------------------------------------------

function _renderStrategyCard(metrics) {
  var strategies = metrics.by_strategy;
  var hasData = Object.values(strategies).some(function(s) { return s !== null; });
  if (!hasData) return '';

  var rows = Object.entries(STRATEGIES).map(function(entry) {
    var key = entry[0], strat = entry[1];
    var data = strategies[key];
    if (!data) return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)"><div><div style="font-size:12px;font-weight:600">' + strat.label + '</div><div style="font-size:10px;color:var(--color-muted)">Strategie ' + key + '</div></div><span style="font-size:11px;color:var(--color-muted)">Pas de donnees</span></div>';
    var roiColor = data.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)"><div><div style="font-size:12px;font-weight:600">' + strat.label + '</div><div style="font-size:10px;color:var(--color-muted)">Strategie ' + key + ' · ' + data.total + ' paris</div></div><div style="text-align:right"><div style="font-size:13px;font-weight:600;color:' + roiColor + '">ROI ' + (data.roi !== null ? (data.roi > 0 ? '+' : '') + data.roi + '%' : '\u2014') + '</div><div style="font-size:10px;color:var(--color-muted)">' + data.hit_rate + '% hit rate</div></div></div>';
  }).join('');

  return '<div class="card" style="margin-bottom:var(--space-4)"><div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Comparaison strategies</div><div style="display:flex;flex-direction:column;gap:var(--space-2)">' + rows + '</div></div>';
}

// -- BIAIS -----------------------------------------------------------------

function _renderBiasCard(metrics) {
  var bias = metrics.bias;
  if (!bias || bias.insufficient_data) {
    return '<div class="card" style="margin-bottom:var(--space-4)"><div style="font-weight:600;font-size:14px;margin-bottom:var(--space-2)">Detection de biais</div><div style="font-size:12px;color:var(--color-muted)">' + (bias ? bias.min_required : 10) + ' paris minimum requis pour detecter les biais. Actuellement : ' + metrics.total_bets + ' paris.</div></div>';
  }

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Detection de biais</div>',
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-2)">',
    _biasRow('Domicile', bias.home_hit_rate, bias.home_bets),
    _biasRow('Exterieur', bias.away_hit_rate, bias.away_bets),
    _biasRow('Over', bias.over_hit_rate),
    _biasRow('Under', bias.under_hit_rate),
    '</div>',
    '</div>',
  ].join('');
}

function _biasRow(label, hitRate, count) {
  var color = hitRate !== null ? (hitRate >= 55 ? 'var(--color-success)' : hitRate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--color-muted)';
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px"><span style="font-size:12px">' + label + (count != null ? ' (' + count + ')' : '') + '</span><span style="font-size:12px;font-weight:600;color:' + color + '">' + (hitRate !== null ? hitRate + '%' : '\u2014') + '</span></div>';
}

// -- LISTE DES PARIS -------------------------------------------------------

function _renderBetsList(bets, storeInstance) {
  if (!bets.length) return '';

  var sorted = bets.slice().reverse();

  return [
    '<div class="card" style="margin-bottom:var(--space-4)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">',
    '<span style="font-weight:600;font-size:14px">Paris enregistres (' + bets.length + ')</span>',
    '</div>',
    '<div style="display:flex;flex-direction:column;gap:var(--space-3)">',
    sorted.map(function(bet) { return _renderBetRow(bet); }).join(''),
    '</div>',
    '</div>',
  ].join('');
}

function _renderBetRow(bet) {
  var isPending    = bet.result === 'PENDING';
  var resultColor  = bet.result === 'WIN' ? 'var(--color-success)' : bet.result === 'LOSS' ? 'var(--color-danger)' : bet.result === 'PUSH' ? 'var(--color-muted)' : 'var(--color-warning)';
  var resultLabel  = { WIN: '\u2713 Gagne', LOSS: '\u2717 Perdu', PUSH: '\u2014 Push', PENDING: '\u23f3 En attente' };
  var oddsDecimal  = _americanToDecimal(bet.odds_taken);
  var marketLabel  = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  // Score du match si disponible
  var scoreStr = '';
  if (!isPending && bet.home_score != null && bet.away_score != null) {
    scoreStr = '<span style="font-family:var(--font-mono);font-size:11px;color:var(--color-text);margin-left:8px">' + bet.home_score + '\u2013' + bet.away_score + '</span>';
  }

  return [
    '<div class="bet-row" data-bet-id="' + bet.bet_id + '" style="padding:var(--space-3);background:var(--color-bg);border-radius:8px;border-left:3px solid ' + resultColor + ';cursor:pointer" title="Cliquer pour les details">',

    // En-tete
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">',
    '<div>',
    '<div style="font-size:12px;font-weight:600">' + (bet.home || '') + ' vs ' + (bet.away || '') + scoreStr + '</div>',
    '<div style="font-size:10px;color:var(--color-muted)">' + _formatDate(bet.date) + ' \u00b7 ' + (marketLabel[bet.market] || bet.market) + '</div>',
    '</div>',
    '<span style="font-size:11px;font-weight:600;color:' + resultColor + '">' + (resultLabel[bet.result] || bet.result) + '</span>',
    '</div>',

    // Details
    '<div style="display:flex;gap:12px;font-size:11px;margin-bottom:6px;flex-wrap:wrap">',
    '<span><strong>' + (bet.side_label || '') + '</strong> ' + (oddsDecimal ? oddsDecimal.toFixed(2) : '') + '</span>',
    '<span style="color:var(--color-muted)">Mise : ' + bet.stake.toFixed(2) + ' \u20ac</span>',
    '<span style="color:var(--color-muted)">Edge : ' + bet.edge + '%</span>',
    bet.pnl !== null ? '<span style="color:' + (bet.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)') + '">P&L : ' + (bet.pnl >= 0 ? '+' : '') + bet.pnl.toFixed(2) + ' \u20ac</span>' : '',
    bet.clv !== null ? '<span style="color:var(--color-muted)">CLV : ' + (bet.clv > 0 ? '+' : '') + bet.clv + '%</span>' : '',
    '</div>',

    // Boutons settle si PENDING
    isPending ? [
      '<div class="bet-settle-row" style="display:flex;gap:8px;margin-top:6px">',
      '<span style="font-size:10px;color:var(--color-muted);align-self:center;flex:1">Resultat :</span>',
      '<button class="btn btn--sm settle-btn" style="background:var(--color-success);color:#000;font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="WIN">\u2713 Gagne</button>',
      '<button class="btn btn--sm settle-btn" style="background:var(--color-danger);color:#fff;font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="LOSS">\u2717 Perdu</button>',
      '<button class="btn btn--ghost btn--sm settle-btn" style="font-size:11px" data-bet-id="' + bet.bet_id + '" data-result="PUSH">\u2014 Push</button>',
      '</div>',
    ].join('') : '',

    '</div>',
  ].join('');
}

// -- MODAL DETAIL PARI -----------------------------------------------------

function _renderBetModal() {
  return [
    '<div id="bet-detail-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;padding:16px">',
    '<div style="background:var(--color-card);border-radius:12px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;padding:var(--space-5)">',
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">',
    '<span style="font-weight:700;font-size:15px">Detail du pari</span>',
    '<button id="close-bet-modal" style="background:none;border:none;color:var(--color-muted);font-size:20px;cursor:pointer;padding:0">&times;</button>',
    '</div>',
    '<div id="bet-detail-content"></div>',
    '</div>',
    '</div>',
  ].join('');
}

function _renderBetDetail(bet) {
  var oddsDecimal = _americanToDecimal(bet.odds_taken);
  var marketLabel = { MONEYLINE: 'Vainqueur du match', SPREAD: 'Handicap (spread)', OVER_UNDER: 'Total de points' };
  var resultLabel = { WIN: '\u2713 Gagne', LOSS: '\u2717 Perdu', PUSH: '\u2014 Push', PENDING: '\u23f3 En attente' };
  var resultColor = bet.result === 'WIN' ? 'var(--color-success)' : bet.result === 'LOSS' ? 'var(--color-danger)' : bet.result === 'PUSH' ? 'var(--color-muted)' : 'var(--color-warning)';

  var rows = [];

  // Match
  rows.push(_detailRow('Match', (bet.home || '') + ' vs ' + (bet.away || '')));
  rows.push(_detailRow('Date', _formatDate(bet.date)));

  // Score final
  if (bet.home_score != null && bet.away_score != null) {
    rows.push(_detailRow('Score final', bet.home_score + ' \u2013 ' + bet.away_score, bet.result === 'WIN' ? 'var(--color-success)' : null));
  }

  rows.push(_detailRow('Marche', marketLabel[bet.market] || bet.market));
  rows.push(_detailRow('Cote prise', oddsDecimal ? oddsDecimal.toFixed(2) + ' (' + (bet.odds_taken > 0 ? '+' : '') + bet.odds_taken + ')' : String(bet.odds_taken)));

  if (bet.odds_source) rows.push(_detailRow('Bookmaker', bet.odds_source));
  if (bet.spread_line != null) rows.push(_detailRow('Ligne spread', (bet.spread_line > 0 ? '+' : '') + bet.spread_line + ' pts'));

  rows.push(_detailRow('Mise', bet.stake.toFixed(2) + ' \u20ac'));
  rows.push(_detailRow('Edge moteur', '+' + bet.edge + '%'));

  if (bet.motor_prob != null) rows.push(_detailRow('Prob. moteur', bet.motor_prob + '%'));
  if (bet.implied_prob != null) rows.push(_detailRow('Prob. marche', bet.implied_prob + '%'));
  if (bet.kelly_stake != null) rows.push(_detailRow('Kelly recommande', (bet.kelly_stake * 100).toFixed(1) + '% de bankroll'));

  rows.push(_detailRow('Resultat', resultLabel[bet.result] || bet.result, resultColor));

  if (bet.pnl !== null) rows.push(_detailRow('P&L', (bet.pnl >= 0 ? '+' : '') + bet.pnl.toFixed(2) + ' \u20ac', bet.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'));
  if (bet.clv !== null) rows.push(_detailRow('CLV', (bet.clv > 0 ? '+' : '') + bet.clv + '%'));
  if (bet.decision_note) rows.push(_detailRow('Signal moteur', bet.decision_note));
  if (bet.placed_at) rows.push(_detailRow('Place le', new Date(bet.placed_at).toLocaleString('fr-FR')));
  if (bet.settled_at) rows.push(_detailRow('Cloture le', new Date(bet.settled_at).toLocaleString('fr-FR')));

  return '<div style="display:flex;flex-direction:column;gap:8px">' + rows.join('') + '</div>';
}

function _detailRow(label, value, color) {
  return [
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--color-border)">',
    '<span style="font-size:12px;color:var(--color-muted)">' + label + '</span>',
    '<span style="font-size:12px;font-weight:600' + (color ? ';color:' + color : '') + '">' + value + '</span>',
    '</div>',
  ].join('');
}

// -- DANGER ZONE -----------------------------------------------------------

function _renderDangerZone(state) {
  return [
    '<div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-border)">',
    '<div style="font-weight:600;font-size:13px;margin-bottom:var(--space-3);color:var(--color-muted)">Gestion</div>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<button class="btn btn--ghost btn--sm" id="export-bets">&#128205; Exporter CSV</button>',
    '<button class="btn btn--ghost btn--sm" id="reset-paper" style="color:var(--color-danger)">\u26a0 Reinitialiser</button>',
    '</div>',
    '</div>',
  ].join('');
}

// -- BIND EVENTS -----------------------------------------------------------

function _bindEvents(container, storeInstance, state) {
  // Configurer bankroll
  var configBtn = container.querySelector('#configure-bankroll');
  if (configBtn) {
    configBtn.addEventListener('click', async function() {
      var input = prompt('Nouvelle bankroll initiale (\u20ac) :', state.initial_bankroll);
      var val   = parseFloat(input);
      if (!val || val <= 0) return;
      await PaperEngine.reset(val);
      storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
    });
  }

  // Settle buttons
  container.querySelectorAll('.settle-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation(); // ne pas ouvrir le modal
      var betId  = btn.dataset.betId;
      var result = btn.dataset.result;
      btn.disabled = true;
      btn.textContent = '...';
      await PaperEngine.settleBet(betId, result);
      storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
    });
  });

  // Clic sur une ligne de pari -> ouvrir modal detail
  container.querySelectorAll('.bet-row').forEach(function(row) {
    row.addEventListener('click', function(e) {
      // Ne pas ouvrir si on clique sur un bouton settle
      if (e.target.classList.contains('settle-btn') || e.target.closest('.settle-btn')) return;

      var betId = row.dataset.betId;
      var bet   = state.bets.find(function(b) { return b.bet_id === betId; });
      if (!bet) return;

      var modal   = container.querySelector('#bet-detail-modal');
      var content = container.querySelector('#bet-detail-content');
      if (!modal || !content) return;

      content.innerHTML = _renderBetDetail(bet);
      modal.style.display = 'flex';
    });
  });

  // Fermer modal
  var closeBtn = container.querySelector('#close-bet-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      var modal = container.querySelector('#bet-detail-modal');
      if (modal) modal.style.display = 'none';
    });
  }

  // Fermer modal en cliquant dehors
  var modal = container.querySelector('#bet-detail-modal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Export CSV
  var exportBtn = container.querySelector('#export-bets');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() { _exportCSV(state.bets); });
  }

  // Reset
  var resetBtn = container.querySelector('#reset-paper');
  if (resetBtn) {
    resetBtn.addEventListener('click', async function() {
      if (confirm('Reinitialiser tout le paper trading ? Cette action est irreversible.')) {
        await PaperEngine.reset(state.initial_bankroll);
        storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') || 0) + 1 });
      }
    });
  }
}

// -- EXPORT CSV ------------------------------------------------------------

function _exportCSV(bets) {
  if (!bets.length) return;

  var headers = ['Date', 'Match', 'Score', 'Marche', 'Cote', 'Cote decimale', 'Mise', 'Edge', 'Moteur%', 'Marche%', 'Resultat', 'P&L', 'CLV', 'Strategie'];
  var rows = bets.map(function(b) {
    var dec = _americanToDecimal(b.odds_taken);
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
    ];
  });

  var csv  = [headers].concat(rows).map(function(r) { return r.map(function(v) { return '"' + v + '"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'mani-bet-pro-paris-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// -- HELPERS ---------------------------------------------------------------

function _metricCell(label, value, color, subtitle) {
  return [
    '<div style="text-align:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px">',
    '<div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">' + label + '</div>',
    '<div style="font-size:15px;font-weight:600;color:' + color + '">' + value + '</div>',
    subtitle ? '<div style="font-size:9px;color:var(--color-muted);margin-top:1px">' + subtitle + '</div>' : '',
    '</div>',
  ].join('');
}

function _americanToDecimal(american) {
  if (!american) return null;
  var n = Number(american);
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

function _formatDate(iso) {
  if (!iso) return '\u2014';
  var normalized = iso.length === 8
    ? iso.slice(0, 4) + '-' + iso.slice(4, 6) + '-' + iso.slice(6, 8)
    : iso;
  return new Date(normalized + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
