/**
 * MANI BET PRO — ui.history.js
 *
 * Responsabilité unique : afficher le journal de paper trading.
 * Lit les données depuis PaperEngine (localStorage).
 * Permet de saisir les résultats et voir les métriques.
 */

import { PaperEngine, STRATEGIES } from '../paper/paper.engine.js';

export async function render(container, storeInstance) {
  _renderPage(container, storeInstance);

  // Re-render si paper trading mis à jour depuis la fiche match
  storeInstance.subscribe('paperTradingVersion', () => {
    _renderPage(container, storeInstance);
  });
}

// ── RENDU PRINCIPAL ───────────────────────────────────────────────────────

function _renderPage(container, storeInstance) {
  const state   = PaperEngine.load();
  const metrics = PaperEngine.computeMetrics(state.bets);

  container.innerHTML = `
    <div class="view-history">

      <div class="view-header">
        <div class="view-header__meta">MANI BET PRO</div>
        <h1 class="view-header__title">Journal de paris</h1>
        <div class="view-header__sub">Paper Trading · Mode simulation</div>
      </div>

      ${_renderBankrollCard(state)}
      ${_renderBankrollChart(state)}
      ${_renderMetricsCard(metrics, state.bets.length)}
      ${_renderStrategyCard(metrics)}
      ${_renderBiasCard(metrics)}
      ${_renderBetsList(state.bets, storeInstance)}
      ${_renderDangerZone(state)}

    </div>
  `;

  _bindEvents(container, storeInstance, state);
}

// ── BANKROLL ──────────────────────────────────────────────────────────────

function _renderBankrollCard(state) {
  const pnl      = state.total_pnl;
  const pnlColor = pnl > 0 ? 'var(--color-success)' : pnl < 0 ? 'var(--color-danger)' : 'var(--color-muted)';
  const pnlSign  = pnl > 0 ? '+' : '';
  const roiRaw   = state.total_staked > 0
    ? Math.round(pnl / state.total_staked * 10000) / 100
    : null;

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <span style="font-weight:600;font-size:14px">Bankroll</span>
        <span class="badge badge--inconclusive" style="font-size:10px">${state.mode}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3)">
        <div>
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Initiale</div>
          <div style="font-size:16px;font-weight:600">${state.initial_bankroll.toFixed(0)} €</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Actuelle</div>
          <div style="font-size:16px;font-weight:600">${state.current_bankroll.toFixed(2)} €</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">P&L total</div>
          <div style="font-size:16px;font-weight:600;color:${pnlColor}">
            ${pnlSign}${pnl.toFixed(2)} €
            ${roiRaw !== null ? `<span style="font-size:11px;opacity:0.7">(${roiRaw > 0 ? '+' : ''}${roiRaw}%)</span>` : ''}
          </div>
        </div>
      </div>

      ${state.current_bankroll < state.initial_bankroll * 0.8 ? `
        <div style="margin-top:10px;padding:8px 10px;background:rgba(255,99,99,0.1);border-left:2px solid var(--color-danger);border-radius:4px;font-size:11px;color:var(--color-danger)">
          ⚠ Stop loss — bankroll sous 80% du capital initial. Réduisez les mises.
        </div>
      ` : ''}
      <div style="margin-top:var(--space-3);display:flex;gap:8px">
        <button class="btn btn--ghost btn--sm" id="configure-bankroll">⚙ Configurer bankroll</button>
      </div>
    </div>
  `;
}

// ── COURBE BANKROLL ──────────────────────────────────────────────────────

function _renderBankrollChart(state) {
  const bets = state.bets.filter(b => b.result !== 'PENDING');
  if (bets.length < 2) return '';

  // Construire les points de la courbe
  let bankroll = state.initial_bankroll;
  const points = [{ x: 0, y: bankroll, label: 'Départ' }];

  bets.forEach((bet, i) => {
    bankroll += (bet.pnl ?? 0);
    points.push({ x: i + 1, y: Math.round(bankroll * 100) / 100, label: `${bet.home?.split(' ').pop()} vs ${bet.away?.split(' ').pop()}` });
  });

  const minY   = Math.min(...points.map(p => p.y)) * 0.98;
  const maxY   = Math.max(...points.map(p => p.y)) * 1.02;
  const rangeY = maxY - minY || 1;
  const W = 300, H = 80;

  const toX = (i) => (i / (points.length - 1)) * W;
  const toY = (y) => H - ((y - minY) / rangeY) * H;

  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(' ');
  const areaData = `${pathData} L ${toX(points.length-1).toFixed(1)} ${H} L 0 ${H} Z`;

  const lastY    = points[points.length - 1].y;
  const isProfit = lastY >= state.initial_bankroll;
  const color    = isProfit ? '#48c78e' : '#f14668';

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="font-weight:600;font-size:13px;margin-bottom:var(--space-3)">Courbe de bankroll</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:80px;overflow:visible">
        <defs>
          <linearGradient id="bankroll-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <!-- Zone remplie -->
        <path d="${areaData}" fill="url(#bankroll-grad)" />
        <!-- Ligne -->
        <path d="${pathData}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <!-- Ligne de référence (capital initial) -->
        <line x1="0" y1="${toY(state.initial_bankroll).toFixed(1)}" x2="${W}" y2="${toY(state.initial_bankroll).toFixed(1)}"
          stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="4,4"/>
        <!-- Point final -->
        <circle cx="${toX(points.length-1).toFixed(1)}" cy="${toY(lastY).toFixed(1)}" r="3" fill="${color}"/>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-muted);margin-top:4px">
        <span>Départ : ${state.initial_bankroll} €</span>
        <span>Actuel : ${lastY.toFixed(2)} €</span>
      </div>
    </div>
  `;
}

// ── MÉTRIQUES ─────────────────────────────────────────────────────────────

function _renderMetricsCard(metrics, totalBets = 0) {
  if (metrics.total_bets === 0 && totalBets === 0) {
    return `
      <div class="card" style="margin-bottom:var(--space-4);text-align:center;padding:var(--space-6)">
        <div style="font-size:24px;margin-bottom:var(--space-2)">📋</div>
        <div style="color:var(--color-muted);font-size:13px">
          Aucun pari enregistré.<br>
          Ouvre une fiche match et clique sur <strong>"Enregistrer ce pari"</strong>.
        </div>
      </div>
    `;
  }

  const hitColor = metrics.hit_rate !== null
    ? (metrics.hit_rate >= 55 ? 'var(--color-success)' : metrics.hit_rate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)')
    : 'var(--color-muted)';

  const roiColor = metrics.roi !== null
    ? (metrics.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)')
    : 'var(--color-muted)';

  const brierLabel = metrics.brier_score !== null
    ? (metrics.brier_score < 0.20 ? '✓ Bien calibré' : metrics.brier_score < 0.25 ? 'Acceptable' : '⚠ Mal calibré')
    : '—';

  const streakLabel = metrics.streak.current > 0
    ? `${metrics.streak.current} ${metrics.streak.type === 'WIN' ? 'victoires' : 'défaites'} consécutives`
    : '—';
  const streakColor = metrics.streak.type === 'WIN' ? 'var(--color-success)'
    : metrics.streak.type === 'LOSS' ? 'var(--color-danger)' : 'var(--color-muted)';

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Performance globale</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-3)">
        ${_metricCell('Paris', `${metrics.won}W / ${metrics.lost}L / ${metrics.push}P`, 'var(--color-text)')}
        ${_metricCell('Hit rate', metrics.hit_rate !== null ? `${metrics.hit_rate}%` : '—', hitColor)}
        ${_metricCell('ROI', metrics.roi !== null ? `${metrics.roi > 0 ? '+' : ''}${metrics.roi}%` : '—', roiColor)}
        ${_metricCell('Misé total', `${metrics.total_staked.toFixed(2)} €`, 'var(--color-text)')}
        ${_metricCell('CLV moyen', metrics.avg_clv !== null ? `${metrics.avg_clv > 0 ? '+' : ''}${metrics.avg_clv}%` : '—', metrics.avg_clv > 0 ? 'var(--color-success)' : 'var(--color-muted)')}
        ${_metricCell('Brier Score', metrics.brier_score !== null ? metrics.brier_score.toFixed(4) : '—', 'var(--color-muted)', brierLabel)}
      </div>

      <div style="font-size:11px;color:var(--color-muted);margin-bottom:var(--space-2)">Hit rate par niveau d'edge</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2)">
        ${Object.entries(metrics.hit_by_edge ?? {}).map(([bucket, data]) => `
          <div style="background:var(--color-bg);border-radius:6px;padding:var(--space-2);text-align:center">
            <div style="font-size:10px;color:var(--color-muted)">${bucket}</div>
            <div style="font-size:14px;font-weight:600;color:var(--color-text)">
              ${data && data.hit_rate !== null ? `${data.hit_rate}%` : '—'}
            </div>
            <div style="font-size:10px;color:var(--color-muted)">${data?.total ?? 0} paris</div>
          </div>
        `).join('')}
      </div>

      ${metrics.streak.current >= 3 ? `
        <div style="margin-top:var(--space-3);padding:var(--space-2) var(--space-3);background:rgba(255,165,0,0.08);border-left:2px solid ${streakColor};border-radius:4px;font-size:11px;color:${streakColor}">
          ⚠ Série en cours : ${streakLabel}
          ${metrics.streak.type === 'LOSS' && metrics.streak.current >= 5 ? ' — Réduction des mises recommandée' : ''}
        </div>
      ` : ''}
    </div>
  `;
}

// ── STRATÉGIES ────────────────────────────────────────────────────────────

function _renderStrategyCard(metrics) {
  const strategies = metrics.by_strategy;
  const hasData    = Object.values(strategies).some(s => s !== null);
  if (!hasData) return '';

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Comparaison stratégies</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2)">
        ${Object.entries(STRATEGIES).map(([key, strat]) => {
          const data = strategies[key];
          if (!data) return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">
              <div>
                <div style="font-size:12px;font-weight:600">${strat.label}</div>
                <div style="font-size:10px;color:var(--color-muted)">Stratégie ${key}</div>
              </div>
              <span style="font-size:11px;color:var(--color-muted)">Pas de données</span>
            </div>`;

          const roiColor = data.roi > 0 ? 'var(--color-success)' : 'var(--color-danger)';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">
              <div>
                <div style="font-size:12px;font-weight:600">${strat.label}</div>
                <div style="font-size:10px;color:var(--color-muted)">Stratégie ${key} · ${data.total} paris</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:13px;font-weight:600;color:${roiColor}">
                  ROI ${data.roi !== null ? `${data.roi > 0 ? '+' : ''}${data.roi}%` : '—'}
                </div>
                <div style="font-size:10px;color:var(--color-muted)">${data.hit_rate}% hit rate</div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── BIAIS ─────────────────────────────────────────────────────────────────

function _renderBiasCard(metrics) {
  const bias = metrics.bias;
  if (!bias || bias.insufficient_data) return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="font-weight:600;font-size:14px;margin-bottom:var(--space-2)">Détection de biais</div>
      <div style="font-size:12px;color:var(--color-muted)">
        ${bias?.min_required ?? 10} paris minimum requis pour détecter les biais.
        Actuellement : ${metrics.total_bets} paris.
      </div>
    </div>
  `;

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="font-weight:600;font-size:14px;margin-bottom:var(--space-3)">Détection de biais</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-2)">
        ${_biasRow('Domicile', bias.home_hit_rate, bias.home_bets)}
        ${_biasRow('Extérieur', bias.away_hit_rate, bias.away_bets)}
        ${_biasRow('Over', bias.over_hit_rate)}
        ${_biasRow('Under', bias.under_hit_rate)}
      </div>
    </div>
  `;
}

function _biasRow(label, hitRate, count = null) {
  const color = hitRate !== null
    ? (hitRate >= 55 ? 'var(--color-success)' : hitRate >= 45 ? 'var(--color-warning)' : 'var(--color-danger)')
    : 'var(--color-muted)';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px">
      <span style="font-size:12px">${label}${count !== null ? ` (${count})` : ''}</span>
      <span style="font-size:12px;font-weight:600;color:${color}">
        ${hitRate !== null ? `${hitRate}%` : '—'}
      </span>
    </div>
  `;
}

// ── LISTE DES PARIS ───────────────────────────────────────────────────────

function _renderBetsList(bets, storeInstance) {
  if (!bets.length) return '';

  const sorted = [...bets].reverse();

  return `
    <div class="card" style="margin-bottom:var(--space-4)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <span style="font-weight:600;font-size:14px">Paris enregistrés (${bets.length})</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        ${sorted.map(bet => _renderBetRow(bet)).join('')}
      </div>
    </div>
  `;
}

function _renderBetRow(bet) {
  const isPending  = bet.result === 'PENDING';
  const resultColor = bet.result === 'WIN' ? 'var(--color-success)'
    : bet.result === 'LOSS' ? 'var(--color-danger)'
    : bet.result === 'PUSH' ? 'var(--color-muted)'
    : 'var(--color-warning)';

  const resultLabel = { WIN: '✓ Gagné', LOSS: '✗ Perdu', PUSH: '— Push', PENDING: '⏳ En attente' };
  const oddsStr     = bet.odds_taken > 0 ? `+${bet.odds_taken}` : String(bet.odds_taken);
  const marketLabel = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  return `
    <div class="bet-row" data-bet-id="${bet.bet_id}" style="
      padding:var(--space-3);
      background:var(--color-bg);
      border-radius:8px;
      border-left:3px solid ${resultColor};
    ">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div>
          <div style="font-size:12px;font-weight:600">${bet.home} vs ${bet.away}</div>
          <div style="font-size:10px;color:var(--color-muted)">${_formatDate(bet.date)} · ${marketLabel[bet.market] ?? bet.market}</div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${resultColor}">${resultLabel[bet.result] ?? bet.result}</span>
      </div>

      <div style="display:flex;gap:12px;font-size:11px;margin-bottom:6px">
        <span><strong>${bet.side_label}</strong> ${oddsStr}</span>
        <span style="color:var(--color-muted)">Mise : ${bet.stake.toFixed(2)} €</span>
        <span style="color:var(--color-muted)">Edge : ${bet.edge}%</span>
        ${bet.pnl !== null ? `<span style="color:${bet.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">
          P&L : ${bet.pnl >= 0 ? '+' : ''}${bet.pnl.toFixed(2)} €
        </span>` : ''}
        ${bet.clv !== null ? `<span style="color:var(--color-muted)">CLV : ${bet.clv > 0 ? '+' : ''}${bet.clv}%</span>` : ''}
      </div>

      ${bet.decision_note ? `<div style="font-size:10px;color:var(--color-muted);font-style:italic;margin-bottom:6px">"${bet.decision_note}"</div>` : ''}

      ${isPending ? `
        <div class="bet-settle-row" style="display:flex;gap:8px;margin-top:6px">
          <span style="font-size:10px;color:var(--color-muted);align-self:center;flex:1">Résultat :</span>
          <button class="btn btn--sm settle-btn" style="background:var(--color-success);color:#000;font-size:11px"
            data-bet-id="${bet.bet_id}" data-result="WIN">✓ Gagné</button>
          <button class="btn btn--sm settle-btn" style="background:var(--color-danger);color:#fff;font-size:11px"
            data-bet-id="${bet.bet_id}" data-result="LOSS">✗ Perdu</button>
          <button class="btn btn--ghost btn--sm settle-btn" style="font-size:11px"
            data-bet-id="${bet.bet_id}" data-result="PUSH">— Push</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ── ZONE DANGER ───────────────────────────────────────────────────────────

function _renderDangerZone(state) {
  return `
    <div class="card" style="margin-bottom:var(--space-4);border-color:var(--color-border)">
      <div style="font-weight:600;font-size:13px;margin-bottom:var(--space-3);color:var(--color-muted)">Gestion</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--ghost btn--sm" id="export-bets">📥 Exporter CSV</button>
        <button class="btn btn--ghost btn--sm" id="reset-paper" style="color:var(--color-danger)">⚠ Réinitialiser</button>
      </div>
    </div>
  `;
}

// ── BIND EVENTS ───────────────────────────────────────────────────────────

function _bindEvents(container, storeInstance, state) {
  // Configurer bankroll
  container.querySelector('#configure-bankroll')?.addEventListener('click', () => {
    const input = prompt('Nouvelle bankroll initiale (€) :', state.initial_bankroll);
    const val   = parseFloat(input);
    if (!val || val <= 0) return;
    PaperEngine.reset(val);
    storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });
  });

  // Settle buttons
  container.querySelectorAll('.settle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const betId  = btn.dataset.betId;
      const result = btn.dataset.result;
      PaperEngine.settleBet(betId, result);
      storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });
    });
  });

  // Export CSV
  container.querySelector('#export-bets')?.addEventListener('click', () => {
    _exportCSV(state.bets);
  });

  // Reset
  container.querySelector('#reset-paper')?.addEventListener('click', () => {
    if (confirm('Réinitialiser tout le paper trading ? Cette action est irréversible.')) {
      PaperEngine.reset(state.initial_bankroll);
      storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });
    }
  });
}

// ── EXPORT CSV ────────────────────────────────────────────────────────────

function _exportCSV(bets) {
  if (!bets.length) return;

  const headers = ['Date', 'Match', 'Marché', 'Côté', 'Cote', 'Mise', 'Edge', 'Moteur%', 'Résultat', 'P&L', 'CLV', 'Stratégie', 'Note'];
  const rows    = bets.map(b => [
    b.date, `${b.home} vs ${b.away}`,
    b.market, b.side_label,
    b.odds_taken, b.stake.toFixed(2),
    b.edge, b.motor_prob,
    b.result, b.pnl?.toFixed(2) ?? '',
    b.clv ?? '', b.strategy ?? '',
    b.decision_note ?? '',
  ]);

  const csv  = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mani-bet-pro-paris-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _metricCell(label, value, color, subtitle = null) {
  return `
    <div style="text-align:center;padding:var(--space-2);background:var(--color-bg);border-radius:6px">
      <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">${label}</div>
      <div style="font-size:15px;font-weight:600;color:${color}">${value}</div>
      ${subtitle ? `<div style="font-size:9px;color:var(--color-muted);margin-top:1px">${subtitle}</div>` : ''}
    </div>
  `;
}

function _americanToDecimal(american) {
  if (!american) return null;
  const n = Number(american);
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

function _formatDate(iso) {
  if (!iso) return '—';
  // Normaliser YYYYMMDD → YYYY-MM-DD
  const normalized = iso.length === 8
    ? `${iso.slice(0,4)}-${iso.slice(4,6)}-${iso.slice(6,8)}`
    : iso;
  return new Date(normalized + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
