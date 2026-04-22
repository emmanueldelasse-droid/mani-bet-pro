/**
 * MANI BET PRO — ui.bot.js v1.1
 *
 * Onglet Bot — tableau de bord de calibration du moteur NBA.
 * Affiche les analyses automatiques du bot, les résultats post-match,
 * et les stats de calibration (hit rate, Brier score, avg edge).
 *
 * Données : GET /bot/logs (Cloudflare KV)
 * Settlement : POST /bot/settle-logs
 * Run manuel : POST /bot/run
 *
 * v1.1 : Migré vers les primitives ui.primitives.css
 *   - page-shell, page-header, toolbar, stat-card, btn
 */

import { API_CONFIG } from '../config/api.config.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  await _renderPage(container, storeInstance);
}

// ── RENDU PRINCIPAL ───────────────────────────────────────────────────────────

async function _renderPage(container, storeInstance) {
  container.innerHTML = _renderShell();
  _bindEvents(container, storeInstance);
  await _loadAndRender(container);
}

function _renderShell() {
  return `
    <div class="page-shell" style="padding:var(--space-4)">
      <div class="page-header">
        <div class="page-header__eyebrow">MANI BET PRO</div>
        <div class="page-header__title">Bot — Calibration</div>
        <div class="page-header__sub" id="bot-sub-label">Analyses automatiques · NBA</div>
      </div>

      <div class="toolbar" style="margin-bottom:8px">
        <div class="bot-sport-toggle">
          <button class="bot-sport-btn active" data-sport="nba">🏀 NBA</button>
          <button class="bot-sport-btn" data-sport="mlb">⚾ MLB</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="toolbar__filters">
          <button class="bot-filter-btn active" data-filter="all">Tous</button>
          <button class="bot-filter-btn" data-filter="pending">En attente</button>
          <button class="bot-filter-btn" data-filter="settled">Settlé</button>
          <button class="bot-filter-btn" data-filter="edge">Edge ≥5%</button>
        </div>
        <div class="toolbar__actions">
          <button class="btn btn--ghost btn--sm" id="bot-settle-btn" title="Enrichir avec résultats ESPN">
            ⟳ Settler
          </button>
          <button class="btn btn--primary btn--sm" id="bot-run-btn" title="Lancer une analyse manuelle">
            ▶ Run
          </button>
        </div>
      </div>

      <div id="bot-stats-container"></div>
      <div id="bot-analysis-container"></div>
      <div id="bot-logs-container">
        <div class="bot-loading">Chargement des analyses…</div>
      </div>
    </div>

    <style>
      /* Sport toggle — NBA / MLB */
      .bot-sport-toggle {
        display: flex; gap: 6px;
      }
      .bot-sport-btn {
        background: var(--color-card); color: var(--color-text-secondary);
        border: 1px solid var(--color-border-default);
        font-size: 13px; font-weight: 600;
        padding: 6px 14px; border-radius: 8px; cursor: pointer;
        transition: all 0.15s;
      }
      .bot-sport-btn:hover { background: var(--color-bg-elevated); }
      .bot-sport-btn.active {
        background: var(--color-signal); color: #fff;
        border-color: var(--color-signal);
      }

      /* Filtres pill — spécifiques bot */
      .bot-filter-btn {
        font-size: 12px; padding: 5px 12px; border-radius: 20px;
        border: 1px solid var(--color-border-default);
        background: var(--color-card); color: var(--color-text-secondary);
        cursor: pointer; transition: all 0.15s;
      }
      .bot-filter-btn.active { background: var(--color-signal); color: #fff; border-color: var(--color-signal); }

      /* État désactivé — boutons toolbar */
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }

      /* Stats grid — utilise .stat-card de ui.primitives.css */
      .bot-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--space-3); }

      /* Logs */
      .bot-logs { display: flex; flex-direction: column; gap: var(--space-3); }
      .bot-log-card {
        background: var(--color-card); border: 1px solid var(--color-border);
        border-radius: 10px; overflow: hidden; cursor: pointer;
        transition: border-color 0.15s;
      }
      .bot-log-card:hover { border-color: var(--color-border-strong); }
      .bot-log-card--edge { border-left: 3px solid var(--color-signal); }
      .bot-log-card--right { border-left: 3px solid var(--color-success); }
      .bot-log-card--wrong { border-left: 3px solid var(--color-danger); }

      .bot-log-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; gap: var(--space-3);
      }
      .bot-log-matchup { font-size: 14px; font-weight: 700; color: var(--color-text-primary); }
      .bot-log-date { font-size: 11px; color: var(--color-muted); }
      .bot-log-badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

      .bot-badge {
        font-size: 10px; font-weight: 700; padding: 2px 8px;
        border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em;
      }
      .bot-badge--high     { background: rgba(34,197,94,0.15);  color: var(--color-success); }
      .bot-badge--medium   { background: rgba(249,115,22,0.15); color: var(--color-robust-mid); }
      .bot-badge--low      { background: rgba(239,68,68,0.15);  color: var(--color-danger); }
      .bot-badge--inconc   { background: rgba(107,114,128,0.15);color: var(--color-inconclusive); }
      .bot-badge--edge     { background: rgba(59,130,246,0.15); color: var(--color-signal); }
      .bot-badge--right    { background: rgba(34,197,94,0.15);  color: var(--color-success); }
      .bot-badge--wrong    { background: rgba(239,68,68,0.15);  color: var(--color-danger); }
      .bot-badge--pending  { background: rgba(107,114,128,0.15);color: var(--color-muted); }
      .bot-badge--phase    { background: rgba(168,85,247,0.15); color: var(--color-volatility); }

      .bot-log-body { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 10px; }

      /* Probas */
      .bot-probas { display: flex; align-items: center; gap: var(--space-3); }
      .bot-proba-bar { flex: 1; height: 6px; background: var(--color-border-default); border-radius: 3px; overflow: hidden; }
      .bot-proba-fill { height: 100%; border-radius: 3px; background: var(--color-signal); transition: width 0.3s; }
      .bot-proba-label { font-size: 12px; color: var(--color-text-secondary); min-width: 36px; text-align: right; }

      /* Signaux */
      .bot-signals { display: flex; flex-wrap: wrap; gap: 6px; }
      .bot-signal {
        font-size: 11px; padding: 3px 8px; border-radius: 4px;
        background: var(--color-bg-elevated); color: var(--color-text-secondary);
        display: flex; align-items: center; gap: 4px;
      }
      .bot-signal--pos { color: var(--color-success); }
      .bot-signal--neg { color: var(--color-danger); }

      /* Résultat */
      .bot-result {
        display: flex; align-items: center; justify-content: space-between;
        background: var(--color-bg-elevated); border-radius: 6px; padding: 8px 12px;
        font-size: 12px; color: var(--color-text-secondary);
      }
      .bot-result__score { font-weight: 700; color: var(--color-text-primary); font-size: 14px; }
      .bot-result__clv   { font-size: 11px; color: var(--color-muted); }

      /* Absences */
      .bot-absences {
        font-size: 11px; color: var(--color-text-secondary);
        background: var(--color-bg-elevated); border-radius: 6px; padding: 6px 10px;
      }

      /* Détail dépliable */
      .bot-log-detail { display: none; padding: 0 16px 14px; }
      .bot-log-detail.open { display: block; }
      .bot-detail-section { margin-bottom: 12px; }
      .bot-detail-title { font-size: 11px; font-weight: 700; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
      .bot-detail-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); }
      .bot-detail-row:last-child { border-bottom: none; }
      .bot-detail-row__val { color: var(--color-text-primary); font-weight: 600; }

      /* Empty / loading */
      .bot-loading { text-align: center; padding: 48px; color: var(--color-muted); font-size: 14px; }
      .bot-empty   { text-align: center; padding: 48px; color: var(--color-muted); font-size: 14px; }
      .bot-error   { text-align: center; padding: 32px; color: var(--color-danger); font-size: 13px; }
    </style>
  `;
}

// ── CHARGEMENT ────────────────────────────────────────────────────────────────

async function _loadAndRender(container, filter = 'all') {
  const logsEl = container.querySelector('#bot-logs-container');
  const statsEl = container.querySelector('#bot-stats-container');
  const subEl   = container.querySelector('#bot-sub-label');
  if (!logsEl) return;

  // Sport courant stocké sur le container (default: nba)
  const sport   = container.dataset.sport || 'nba';
  const logsUrl = sport === 'mlb' ? `${WORKER}/mlb/bot/logs` : `${WORKER}/bot/logs`;

  if (subEl) subEl.textContent = `Analyses automatiques · ${sport.toUpperCase()}`;

  try {
    const resp = await fetch(logsUrl, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const allLogs = data.logs ?? [];
    const stats   = data.stats ?? {};

    // Stats globales
    statsEl.innerHTML = _renderStats(stats, allLogs, sport);

    // Panneau analyse approfondie — filtre phase stocké sur le container
    const analysisEl = container.querySelector('#bot-analysis-container');
    if (analysisEl) {
      const phaseFilter = analysisEl.dataset.phaseFilter || 'all';
      analysisEl.innerHTML = _renderDeepAnalysis(allLogs, phaseFilter, sport);
      _bindAnalysisPhaseToggle(analysisEl, allLogs, sport);
    }

    // Filtrer
    const filtered = _filterLogs(allLogs, filter);

    if (!filtered.length) {
      logsEl.innerHTML = `<div class="bot-empty">
        ${filter === 'all' ? 'Aucune analyse enregistrée pour le moment.<br>Le bot tourne automatiquement 1h avant les matchs.' : 'Aucun résultat pour ce filtre.'}
      </div>`;
      return;
    }

    logsEl.innerHTML = `<div class="bot-logs">${filtered.map(_renderLogCard).join('')}</div>`;
    _bindLogCards(logsEl);

  } catch (err) {
    const safe = String(err?.message ?? err ?? 'erreur inconnue')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    logsEl.innerHTML = `<div class="bot-error">Impossible de charger les logs : ${safe}</div>`;
  }
}

function _filterLogs(logs, filter) {
  switch (filter) {
    case 'pending':  return logs.filter(l => l.motor_was_right === null);
    case 'settled':  return logs.filter(l => l.motor_was_right !== null);
    case 'edge':     return logs.filter(l => l.best_edge && l.best_edge >= 5);
    default:         return logs;
  }
}

// ── STATS GLOBALES ────────────────────────────────────────────────────────────

function _renderStats(stats, logs, sport = 'nba') {
  const edgeCount = logs.filter(l => l.best_edge && l.best_edge >= 5).length;
  // NBA : confidence_level · MLB : data_quality
  const highConf  = sport === 'mlb'
    ? logs.filter(l => l.data_quality === 'HIGH').length
    : logs.filter(l => l.confidence_level === 'HIGH').length;
  const highLabel = sport === 'mlb' ? 'Data quality HIGH' : 'Conf. HIGH';

  return `<div class="bot-stats">
    <div class="stat-card">
      <div class="stat-card__value">${stats.total_analyzed ?? 0}</div>
      <div class="stat-card__label">Matchs analysés</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value" style="color:var(--color-signal)">${edgeCount}</div>
      <div class="stat-card__label">Edges ≥5%</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value" style="color:var(--color-success)">${stats.hit_rate != null ? stats.hit_rate + '%' : '—'}</div>
      <div class="stat-card__label">Hit rate</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value">${stats.avg_edge != null ? '+' + stats.avg_edge + '%' : '—'}</div>
      <div class="stat-card__label">Edge moyen</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value" style="color:var(--color-data-quality)">${stats.brier_score ?? '—'}</div>
      <div class="stat-card__label">Brier Score</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value" style="color:var(--color-volatility)">${highConf}</div>
      <div class="stat-card__label">${highLabel}</div>
    </div>
  </div>`;
}

// ── ANALYSE APPROFONDIE ───────────────────────────────────────────────────────

function _renderDeepAnalysis(logs, phaseFilter = 'all', sport = 'nba') {
  if (!logs?.length) return '';

  // MLB n'a pas la même notion de phase que NBA (pas de "playin" dans logs actuels)
  // Pour MLB, on garde le toggle mais phases = "all" seulement pertinent
  const isNBA = sport !== 'mlb';

  // Filtrer par phase choisie (NBA only)
  const matchPhase = (log) => {
    if (!isNBA) return true;  // MLB : pas de filtre
    const p = log.nba_phase;
    if (phaseFilter === 'regular')  return p === 'regular';
    if (phaseFilter === 'playoffs') return p === 'playin' || p === 'playoff';
    return true;
  };
  const logsForPhase = logs.filter(matchPhase);

  // Compteurs pour le toggle (NBA seulement)
  const counts = isNBA ? {
    all:      logs.length,
    regular:  logs.filter(l => l.nba_phase === 'regular').length,
    playoffs: logs.filter(l => l.nba_phase === 'playin' || l.nba_phase === 'playoff').length,
  } : null;

  const toggleHtml = isNBA ? `<div class="bot-phase-toggle">
    <button class="bot-phase-btn ${phaseFilter === 'all' ? 'active' : ''}" data-phase="all">Tous (${counts.all})</button>
    <button class="bot-phase-btn ${phaseFilter === 'regular' ? 'active' : ''}" data-phase="regular">Saison régulière (${counts.regular})</button>
    <button class="bot-phase-btn ${phaseFilter === 'playoffs' ? 'active' : ''}" data-phase="playoffs">Playoffs & Play-in (${counts.playoffs})</button>
  </div>` : '';

  const settled = logsForPhase.filter(l => l.motor_was_right !== null);
  if (settled.length === 0) {
    const phaseLabel = phaseFilter === 'regular' ? 'saison régulière' : phaseFilter === 'playoffs' ? 'playoffs' : '';
    return `<div class="bot-analysis-panel">
      <div class="bot-analysis-title">📊 Analyse performance</div>
      ${toggleHtml}
      <div style="font-size:12px;color:var(--color-muted);text-align:center;padding:16px">
        Pas encore de matchs réglés${phaseLabel ? ` en ${phaseLabel}` : ''}. Les résultats arrivent à 12h Paris via le cron nightly-settle.
      </div>
    </div>`;
  }

  const correct = settled.filter(l => l.motor_was_right === true).length;
  const total   = settled.length;
  const pct     = Math.round(correct / total * 1000) / 10;
  const color   = pct >= 60 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

  // Verdict simple
  let verdict = '', verdictColor = '';
  if (total < 20) {
    verdict = `Échantillon trop petit (${total} matchs) pour tirer des conclusions fiables. Attendre 30+ matchs.`;
    verdictColor = 'var(--color-muted)';
  } else if (pct >= 58) {
    verdict = `Le bot performe bien (${pct}% vs 50% hasard · +${Math.round((pct-50)*10)/10} pts au-dessus).`;
    verdictColor = 'var(--color-success)';
  } else if (pct >= 52) {
    verdict = `Le bot est légèrement positif (${pct}% · très proche du hasard, marge faible).`;
    verdictColor = 'var(--color-warning)';
  } else {
    verdict = `Le bot est SOUS le hasard (${pct}% vs 50%). Calibration nécessaire.`;
    verdictColor = 'var(--color-danger)';
  }

  // 1. Edge buckets — toujours afficher les 4 pour voir la progression
  const edgeBuckets = [
    { label: 'Edge ≥ 10%', min: 10, max: 999 },
    { label: 'Edge 7-10%', min: 7,  max: 10  },
    { label: 'Edge 5-7%',  min: 5,  max: 7   },
    { label: 'Edge 0-5%',  min: 0,  max: 5   },
  ];
  const bucketRows = edgeBuckets.map(b => {
    const grp = settled.filter(l => (l.best_edge ?? 0) >= b.min && (l.best_edge ?? 0) < b.max);
    if (grp.length === 0) {
      return `<div class="bot-analysis-row">
        <span>${b.label}</span>
        <span style="color:var(--color-muted);font-weight:500">—</span>
      </div>`;
    }
    const c   = grp.filter(l => l.motor_was_right === true).length;
    const p   = Math.round(c / grp.length * 1000) / 10;
    const col = p >= 60 ? 'var(--color-success)' : p >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
    return `<div class="bot-analysis-row">
      <span>${b.label}</span>
      <span style="color:${col};font-weight:700">${c}/${grp.length} · ${p}%</span>
    </div>`;
  }).join('');

  // 2. Par type de marché — ignorer null, trier par count desc
  const byMarket = {};
  for (const l of settled) {
    if (!l.best_market) continue;  // Skip matchs sans reco
    const m = l.best_market;
    if (!byMarket[m]) byMarket[m] = { total: 0, correct: 0 };
    byMarket[m].total++;
    if (l.motor_was_right === true) byMarket[m].correct++;
  }
  const marketEntries = Object.entries(byMarket).sort((a, b) => b[1].total - a[1].total);
  const marketRows = marketEntries.length > 0
    ? marketEntries.map(([m, v]) => {
        const p = Math.round(v.correct / v.total * 1000) / 10;
        const col = p >= 60 ? 'var(--color-success)' : p >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
        const label = { MONEYLINE: 'Vainqueur (ML)', SPREAD: 'Handicap', OVER_UNDER: 'Total pts', PLAYER_POINTS: 'Props joueur' }[m] ?? m;
        return `<div class="bot-analysis-row">
          <span>${label}</span>
          <span style="color:${col};font-weight:700">${v.correct}/${v.total} · ${p}%</span>
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:var(--color-muted);padding:4px 0">Aucun marché avec reco (edge < 5% partout)</div>';

  // 3. O/U spécifique
  const ouModel = settled.filter(l => l.ou_model_was_right !== null && l.ou_model_was_right !== undefined);
  const ouReco  = settled.filter(l => l.ou_was_right       !== null && l.ou_was_right       !== undefined);
  const ouRows = [];
  if (ouModel.length) {
    const c = ouModel.filter(l => l.ou_model_was_right === true).length;
    const p = Math.round(c / ouModel.length * 1000) / 10;
    const col = p >= 60 ? 'var(--color-success)' : p >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
    ouRows.push(`<div class="bot-analysis-row"><span>Modèle O/U (tous matchs)</span><span style="color:${col};font-weight:700">${c}/${ouModel.length} · ${p}%</span></div>`);
  }
  if (ouReco.length) {
    const c = ouReco.filter(l => l.ou_was_right === true).length;
    const p = Math.round(c / ouReco.length * 1000) / 10;
    const col = p >= 60 ? 'var(--color-success)' : p >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
    ouRows.push(`<div class="bot-analysis-row"><span>Reco O/U quand edge ≥ 5%</span><span style="color:${col};font-weight:700">${c}/${ouReco.length} · ${p}%</span></div>`);
  }

  // 4. Upsets
  const upsets = settled.filter(l => l.upset === true).length;
  const favs   = total - upsets;
  const upsetPct = Math.round(upsets / total * 1000) / 10;

  // 5. Player Points — sur logs filtrés par phase
  const withPP    = logsForPhase.filter(l => l.player_props_prediction?.available === true).length;
  const withPPRec = logsForPhase.filter(l => (l.betting_recommendations?.recommendations ?? []).some(r => r.type === 'PLAYER_POINTS')).length;
  const totalPPRecs = logsForPhase.reduce((s, l) => s + ((l.betting_recommendations?.recommendations ?? []).filter(r => r.type === 'PLAYER_POINTS').length), 0);

  // Settlement PLAYER_POINTS — agrège toutes les recs settled sur les logs phase-filtrés
  const allPPRecs = logsForPhase.flatMap(l => (l.betting_recommendations?.recommendations ?? []).filter(r => r.type === 'PLAYER_POINTS'));
  const ppSettled = allPPRecs.filter(r => r.was_right !== null && r.was_right !== undefined);
  const ppCorrect = ppSettled.filter(r => r.was_right === true).length;
  const ppPct     = ppSettled.length > 0 ? Math.round(ppCorrect / ppSettled.length * 1000) / 10 : null;
  const ppColor   = ppPct != null ? (ppPct >= 60 ? 'var(--color-success)' : ppPct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)') : 'var(--color-muted)';

  // Ventilation props par confidence label
  const ppByConf = { high: { t: 0, c: 0 }, medium: { t: 0, c: 0 }, low: { t: 0, c: 0 } };
  for (const r of ppSettled) {
    const lbl = r.confidence_label ?? 'medium';
    if (ppByConf[lbl]) {
      ppByConf[lbl].t++;
      if (r.was_right === true) ppByConf[lbl].c++;
    }
  }

  // MLB : Strikeouts pitcher prédictions vs actual
  let mlbStrikeoutStats = null;
  if (sport === 'mlb') {
    const allPitchers = logsForPhase.flatMap(l => {
      const p = l.pitcher_strikeouts_prediction;
      if (!p?.available) return [];
      return [p.home_pitcher, p.away_pitcher].filter(Boolean);
    });
    const ptchSettled = allPitchers.filter(p => p.actual_ks != null);
    if (ptchSettled.length > 0) {
      const avgErr   = ptchSettled.reduce((s, p) => s + Math.abs(p.actual_ks - p.projected_ks), 0) / ptchSettled.length;
      const within1  = ptchSettled.filter(p => Math.abs(p.actual_ks - p.projected_ks) <= 1.5).length;
      const within2  = ptchSettled.filter(p => Math.abs(p.actual_ks - p.projected_ks) <= 2.5).length;
      mlbStrikeoutStats = {
        total:        ptchSettled.length,
        total_tracked: allPitchers.length,
        avg_err:      Math.round(avgErr * 10) / 10,
        within1_pct:  Math.round(within1 / ptchSettled.length * 1000) / 10,
        within2_pct:  Math.round(within2 / ptchSettled.length * 1000) / 10,
      };
    } else if (allPitchers.length > 0) {
      mlbStrikeoutStats = { total: 0, total_tracked: allPitchers.length };
    }
  }

  const phaseLabel = phaseFilter === 'regular' ? ' · Saison régulière' : phaseFilter === 'playoffs' ? ' · Playoffs & Play-in' : '';

  return `<div class="bot-analysis-panel">
    <div class="bot-analysis-header">
      <div class="bot-analysis-title">📊 Analyse performance${phaseLabel} · ${total} matchs réglés</div>
      ${toggleHtml}
      <div class="bot-analysis-headline">
        <span class="bot-analysis-big-number" style="color:${color}">${correct}/${total}</span>
        <span class="bot-analysis-big-pct" style="color:${color}">${pct}%</span>
        <span class="bot-analysis-ref">vs hasard 50%</span>
      </div>
      <div class="bot-analysis-verdict" style="color:${verdictColor}">${verdict}</div>
    </div>

    <div class="bot-analysis-grid">
      <div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Par niveau d'edge</div>
        <div class="bot-analysis-help">Plus l'edge est gros, plus le bot devrait gagner. Si les gros edges ratent, ça indique une mauvaise calibration.</div>
        ${bucketRows}
      </div>

      <div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Par type de pari</div>
        <div class="bot-analysis-help">Quel marché performe le mieux ? Si un type échoue systématiquement, on peut désactiver les recos sur celui-ci.</div>
        ${marketRows}
      </div>

      ${ouRows.length ? `<div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Over / Under (total pts)</div>
        <div class="bot-analysis-help">"Modèle" = prédit correctement le sens sur TOUS les matchs. "Reco" = seulement ceux avec edge ≥5%.</div>
        ${ouRows.join('')}
      </div>` : ''}

      <div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Upsets</div>
        <div class="bot-analysis-help">Upset = l'outsider gagne. Trop d'upsets = bot trop confiant en ses favoris.</div>
        <div class="bot-analysis-row">
          <span>Favori respecté</span>
          <span style="color:var(--color-success);font-weight:700">${favs}/${total}</span>
        </div>
        <div class="bot-analysis-row">
          <span>Upset (surprise)</span>
          <span style="color:var(--color-warning);font-weight:700">${upsets}/${total} · ${upsetPct}%</span>
        </div>
      </div>

      ${sport === 'mlb' ? `<div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Strikeouts pitcher (projections)</div>
        <div class="bot-analysis-help">Précision de nos projections Ks par starting pitcher. Plus l'écart moyen est faible, plus le modèle est utile pour des paris props.</div>
        ${mlbStrikeoutStats && mlbStrikeoutStats.total > 0 ? `
          <div class="bot-analysis-row" style="font-weight:600;background:var(--color-bg-elevated);padding-left:6px;padding-right:6px;border-radius:4px;margin-bottom:4px">
            <span>Écart moyen</span>
            <span style="color:${mlbStrikeoutStats.avg_err <= 1.5 ? 'var(--color-success)' : mlbStrikeoutStats.avg_err <= 2.5 ? 'var(--color-warning)' : 'var(--color-danger)'};font-weight:800">± ${mlbStrikeoutStats.avg_err} K</span>
          </div>
          <div class="bot-analysis-row"><span>Écart ≤ 1.5 K (bon)</span><span style="font-weight:700">${mlbStrikeoutStats.within1_pct}%</span></div>
          <div class="bot-analysis-row"><span>Écart ≤ 2.5 K (correct)</span><span style="font-weight:700">${mlbStrikeoutStats.within2_pct}%</span></div>
          <div class="bot-analysis-row"><span>Pitchers analysés / trackés</span><span style="font-weight:700">${mlbStrikeoutStats.total} / ${mlbStrikeoutStats.total_tracked}</span></div>
        ` : mlbStrikeoutStats ? `
          <div class="bot-analysis-row"><span style="color:var(--color-muted);font-size:11px">${mlbStrikeoutStats.total_tracked} pitchers trackés, pas encore settlés</span></div>
        ` : `
          <div class="bot-analysis-row"><span style="color:var(--color-muted);font-size:11px">Aucune projection strikeout pour le moment</span></div>
        `}
      </div>` : `<div class="bot-analysis-section">
        <div class="bot-analysis-subtitle">Props joueur</div>
        <div class="bot-analysis-help">Un joueur a-t-il dépassé (ou pas) sa ligne de points ? Settlement automatique via box scores ESPN après chaque match.</div>
        ${ppPct != null ? `
        <div class="bot-analysis-row" style="font-weight:600;background:var(--color-bg-elevated);padding-left:6px;padding-right:6px;border-radius:4px;margin-bottom:4px">
          <span>Hit rate (recos edge ≥ 5%)</span>
          <span style="color:${ppColor};font-weight:800">${ppCorrect}/${ppSettled.length} · ${ppPct}%</span>
        </div>
        ${ppByConf.high.t > 0 ? `<div class="bot-analysis-row"><span>Confidence HIGH</span><span style="font-weight:700">${ppByConf.high.c}/${ppByConf.high.t}</span></div>` : ''}
        ${ppByConf.medium.t > 0 ? `<div class="bot-analysis-row"><span>Confidence MEDIUM</span><span style="font-weight:700">${ppByConf.medium.c}/${ppByConf.medium.t}</span></div>` : ''}
        ${ppByConf.low.t > 0 ? `<div class="bot-analysis-row"><span>Confidence LOW</span><span style="font-weight:700">${ppByConf.low.c}/${ppByConf.low.t}</span></div>` : ''}
        ` : `<div class="bot-analysis-row"><span style="color:var(--color-muted);font-size:11px">Aucune reco PLAYER_POINTS settlée pour le moment</span></div>`}
        <div class="bot-analysis-row"><span>Matchs avec projections</span><span style="font-weight:700">${withPP}</span></div>
        <div class="bot-analysis-row"><span>Recos PLAYER_POINTS total</span><span style="font-weight:700">${totalPPRecs}</span></div>
      </div>`}
    </div>
  </div>
  <style>
    .bot-analysis-panel {
      background: var(--color-card); border-radius: 10px; padding: 16px 18px;
      margin-bottom: 16px; border: 1px solid var(--color-border);
    }
    .bot-analysis-header { margin-bottom: 16px; }
    .bot-analysis-title {
      font-size: 13px; font-weight: 700; margin-bottom: 8px;
      color: var(--color-text-primary);
    }
    .bot-analysis-headline {
      display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px;
    }
    .bot-analysis-big-number { font-size: 24px; font-weight: 800; }
    .bot-analysis-big-pct    { font-size: 18px; font-weight: 700; }
    .bot-analysis-ref {
      font-size: 11px; color: var(--color-muted);
    }
    .bot-analysis-verdict {
      font-size: 12px; font-weight: 500; font-style: italic;
    }
    .bot-analysis-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .bot-analysis-section {
      background: var(--color-bg); border-radius: 8px; padding: 12px 14px;
    }
    .bot-analysis-subtitle {
      font-size: 10px; font-weight: 700; color: var(--color-text-primary);
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;
    }
    .bot-analysis-help {
      font-size: 10px; color: var(--color-muted); line-height: 1.35;
      margin-bottom: 8px;
    }
    .bot-analysis-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: var(--color-text-secondary);
      padding: 5px 0; border-bottom: 1px solid var(--color-border);
    }
    .bot-analysis-row:last-child { border-bottom: none; }
    .bot-phase-toggle {
      display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;
    }
    .bot-phase-btn {
      background: var(--color-bg); border: 1px solid var(--color-border);
      color: var(--color-text-secondary); font-size: 11px; font-weight: 600;
      padding: 5px 11px; border-radius: 6px; cursor: pointer;
      transition: all 0.15s;
    }
    .bot-phase-btn:hover { background: var(--color-bg-elevated); }
    .bot-phase-btn.active {
      background: var(--color-signal); color: white;
      border-color: var(--color-signal);
    }
  </style>`;
}

function _bindAnalysisPhaseToggle(analysisEl, allLogs, sport = 'nba') {
  const buttons = analysisEl.querySelectorAll('.bot-phase-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const newPhase = btn.dataset.phase;
      analysisEl.dataset.phaseFilter = newPhase;
      analysisEl.innerHTML = _renderDeepAnalysis(allLogs, newPhase, sport);
      _bindAnalysisPhaseToggle(analysisEl, allLogs, sport);  // re-bind après re-render
    });
  });
}

// ── CARTE LOG ─────────────────────────────────────────────────────────────────

function _renderLogCard(log) {
  const motorProb  = log.motor_prob ?? null;
  const conf       = log.confidence_level ?? 'INCONCLUSIVE';
  const phase      = log.nba_phase ?? null;
  const isSettled  = log.motor_was_right !== null;
  const hasEdge    = log.best_edge && log.best_edge >= 5;

  // Classe carte
  let cardClass = 'bot-log-card';
  if (hasEdge && !isSettled) cardClass += ' bot-log-card--edge';
  if (isSettled && log.motor_was_right)  cardClass += ' bot-log-card--right';
  if (isSettled && !log.motor_was_right) cardClass += ' bot-log-card--wrong';

  // Date formatée
  const d = log.date ?? '';
  const dateFmt = d.length === 8 ? `${d.slice(6,8)}/${d.slice(4,6)}` : d;
  const timeFmt = log.datetime ? new Date(log.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;

  return `
    <div class="${cardClass}" data-match-id="${log.match_id}">
      <div class="bot-log-header">
        <div>
          <div class="bot-log-matchup">${log.away ?? '?'} @ ${log.home ?? '?'}</div>
          <div class="bot-log-date">${dateFmt}${timeFmt ? ' · ' + timeFmt : ''}</div>
        </div>
        <div class="bot-log-badges">
          ${phase ? `<span class="bot-badge bot-badge--phase">${phase}</span>` : ''}
          ${_renderConfBadge(conf)}
          ${hasEdge ? `<span class="bot-badge bot-badge--edge">Edge +${log.best_edge}%</span>` : ''}
          ${isSettled
            ? log.motor_was_right
              ? `<span class="bot-badge bot-badge--right">✓ Correct</span>`
              : `<span class="bot-badge bot-badge--wrong">✗ Raté</span>`
            : `<span class="bot-badge bot-badge--pending">En attente</span>`}
        </div>
      </div>

      <div class="bot-log-body">
        ${motorProb != null ? _renderProbaBar(log) : ''}
        ${_renderTopSignals(log)}
        ${_renderAbsencesLine(log)}
        ${isSettled ? _renderResultLine(log) : ''}
      </div>

      <div class="bot-log-detail" id="detail-${log.match_id}">
        ${_renderDetailPanel(log)}
      </div>
    </div>
  `;
}

function _renderConfBadge(conf) {
  const map = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INCONCLUSIVE: 'inconc' };
  const cls = map[conf] ?? 'inconc';
  return `<span class="bot-badge bot-badge--${cls}">${conf}</span>`;
}

function _renderProbaBar(log) {
  const prob     = log.motor_prob ?? 50;
  const homeName = (log.home ?? '').split(' ').pop();
  const awayName = (log.away ?? '').split(' ').pop();
  return `
    <div class="bot-probas">
      <span class="bot-proba-label" style="text-align:left;min-width:50px;font-size:11px">${awayName}</span>
      <div class="bot-proba-bar">
        <div class="bot-proba-fill" style="width:${prob}%;background:${prob >= 60 ? 'var(--color-success)' : prob <= 40 ? 'var(--color-danger)' : 'var(--color-signal)'}"></div>
      </div>
      <span class="bot-proba-label">${homeName} ${prob}%</span>
    </div>
  `;
}

function _renderTopSignals(log) {
  const signals = (log.signals ?? []).slice(0, 4);
  if (!signals.length) return '';
  return `<div class="bot-signals">
    ${signals.map(s => {
      const cls = s.direction === 'POSITIVE' ? 'bot-signal--pos' : s.direction === 'NEGATIVE' ? 'bot-signal--neg' : '';
      const arrow = s.direction === 'POSITIVE' ? '▲' : s.direction === 'NEGATIVE' ? '▼' : '·';
      const label = _shortSignalLabel(s.variable);
      return `<span class="bot-signal ${cls}">${arrow} ${label} ${s.raw_value != null ? '(' + _fmtVal(s.variable, s.raw_value) + ')' : ''}</span>`;
    }).join('')}
  </div>`;
}

function _renderAbsencesLine(log) {
  const snap = log.absences_snapshot;
  if (!snap || (snap.home_out === 0 && snap.away_out === 0 && snap.value === null)) return '';
  const quality = snap.is_weighted ? '🏀 weighted' : '⚠️ estimé';
  const val     = snap.value != null ? `impact: ${snap.value > 0 ? '+' : ''}${Math.round(snap.value * 100)}%` : '';
  return `<div class="bot-absences">
    🏥 Absences — dom: ${snap.home_out ?? '?'} out · ext: ${snap.away_out ?? '?'} out
    ${val ? '· ' + val : ''} · ${quality}
  </div>`;
}

function _renderResultLine(log) {
  const score = `${log.result_away_score ?? '?'} – ${log.result_home_score ?? '?'}`;
  const winner = log.result_winner === 'HOME' ? log.home : log.away;
  const clv    = log.clv_post_match != null ? `CLV: ${log.clv_post_match > 0 ? '+' : ''}${log.clv_post_match}%` : '';
  return `<div class="bot-result">
    <div>Résultat : <span class="bot-result__score">${score}</span> · ${winner} gagne</div>
    <div class="bot-result__clv">${clv}</div>
  </div>`;
}

function _renderDetailPanel(log) {
  const vars    = log.variables_used ?? {};
  const missing = log.missing_variables ?? [];
  const recs    = log.betting_recommendations?.recommendations ?? [];

  return `
    <div class="bot-detail-section">
      <div class="bot-detail-title">Toutes les variables</div>
      ${Object.entries(vars).map(([k, v]) => `
        <div class="bot-detail-row">
          <span>${_shortSignalLabel(k)}</span>
          <span class="bot-detail-row__val">
            ${v.value != null ? _fmtVal(k, v.value) : '—'}
            <span style="font-size:10px;color:var(--color-muted);font-weight:400"> ${v.quality ?? ''}</span>
          </span>
        </div>`).join('')}
    </div>

    ${missing.length ? `<div class="bot-detail-section">
      <div class="bot-detail-title">Variables manquantes</div>
      <div style="font-size:12px;color:var(--color-danger)">${missing.map(_shortSignalLabel).join(', ')}</div>
    </div>` : ''}

    ${log.market_divergence ? `<div class="bot-detail-section">
      <div class="bot-detail-title">Divergence marché</div>
      <div class="bot-detail-row"><span>Divergence</span><span class="bot-detail-row__val">${log.market_divergence.divergence_pts ?? '—'} pts · ${log.market_divergence.flag}</span></div>
      <div class="bot-detail-row"><span>Implied home</span><span class="bot-detail-row__val">${log.market_divergence.market_implied_home != null ? Math.round(log.market_divergence.market_implied_home * 100) + '%' : '—'}</span></div>
    </div>` : ''}

    ${recs.length ? `<div class="bot-detail-section">
      <div class="bot-detail-title">Recommandations</div>
      ${recs.map(r => {
        const label = r.type === 'PLAYER_POINTS'
          ? `${r.player} ${r.side} ${r.line}`
          : `${r.type} ${r.side}`;
        const extra = r.type === 'PLAYER_POINTS'
          ? ` · proj ${r.projected_pts} · conf ${r.confidence_label ?? '—'}${r.edge_raw && r.edge_raw !== r.edge ? ` (raw ${r.edge_raw}%→${r.edge}%)` : ''} · ${r.odds_source ?? ''}`
          : '';
        return `<div class="bot-detail-row">
        <span>${label}</span>
        <span class="bot-detail-row__val">Edge +${r.edge}% · ${r.motor_prob}% prob · cote ${r.odds_line > 0 ? '+' : ''}${r.odds_line}${extra}</span>
      </div>`;
      }).join('')}
    </div>` : ''}

    ${_renderPlayerPropsSection(log)}
    ${_renderMLBPitcherStrikeoutsSection(log)}

    ${log.star_absence_modifier != null && log.star_absence_modifier !== 1 ? `<div class="bot-detail-section">
      <div class="bot-detail-title">Modificateur star absence</div>
      <div style="font-size:12px;color:var(--color-warning)">× ${log.star_absence_modifier} appliqué au score</div>
    </div>` : ''}

    <div style="font-size:10px;color:var(--color-muted);padding-top:8px">
      Analysé le ${log.logged_at ? new Date(log.logged_at).toLocaleString('fr-FR') : '—'}
      · Score méthode : ${log.score_method ?? '—'}
      · Phase : ${log.nba_phase ?? '—'}
    </div>
  `;
}

function _renderPlayerPropsSection(log) {
  const pp = log.player_props_prediction;
  if (!pp || !pp.available) return '';
  const all = [...(pp.home_players ?? []), ...(pp.away_players ?? [])];
  if (all.length === 0) return '';

  const hasMarket = all.some(p => p.market);
  const title = hasMarket
    ? `Props joueur (Phase ${pp.phase} · marché connecté)`
    : `Props joueur (Phase ${pp.phase} · projection seule)`;

  const rows = all.slice(0, 10).map(p => {
    const mk   = p.market;
    const line = mk ? ` vs ${mk.line}` : '';
    const edge = mk && (mk.over_edge != null || mk.under_edge != null)
      ? ` · edge O:${mk.over_edge ?? '—'}% U:${mk.under_edge ?? '—'}%`
      : '';
    const model = p.model === 'pts_per_min' ? 'pts/min' : 'ppg';
    const conf  = p.confidence?.label
      ? ` · <span style="color:${p.confidence.label === 'high' ? 'var(--color-success)' : p.confidence.label === 'low' ? 'var(--color-danger)' : 'var(--color-warning)'}">conf ${p.confidence.label}</span>`
      : '';
    return `<div class="bot-detail-row">
      <span>${p.name} (${p.team})</span>
      <span class="bot-detail-row__val">${p.projected_pts} pts [${model}]${line}${edge}${conf}</span>
    </div>`;
  }).join('');

  return `<div class="bot-detail-section">
    <div class="bot-detail-title">${title}</div>
    ${rows}
  </div>`;
}

// Render strikeouts projections pour match MLB · section détail panel
function _renderMLBPitcherStrikeoutsSection(log) {
  const pp = log.pitcher_strikeouts_prediction;
  if (!pp?.available) return '';

  const pitchers = [pp.home_pitcher, pp.away_pitcher].filter(Boolean);
  if (pitchers.length === 0) return '';

  const rows = pitchers.map(p => {
    const actualHtml = p.actual_ks != null
      ? ` · <strong style="color:${Math.abs(p.actual_ks - p.projected_ks) <= 1.5 ? 'var(--color-success)' : 'var(--color-warning)'}">réel ${p.actual_ks}K en ${p.actual_ip ?? '—'}IP</strong>`
      : '';
    return `<div class="bot-detail-row">
      <span>${p.name ?? '—'}</span>
      <span class="bot-detail-row__val">
        proj ${p.projected_ks}K · base ${p.base_ks}K (K/9=${p.k_per_9} · IP=${p.expected_ip})
        ${p.opponent_mult !== 1 ? ` · matchup ×${p.opponent_mult}` : ''}
        ${actualHtml}
      </span>
    </div>`;
  }).join('');

  return `<div class="bot-detail-section">
    <div class="bot-detail-title">Strikeouts pitcher (Phase ${pp.phase} · projection)</div>
    ${rows}
  </div>`;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function _shortSignalLabel(variable) {
  const map = {
    net_rating_diff: 'Net Rating',
    efg_diff:        'eFG%',
    recent_form_ema: 'Forme EMA',
    home_away_split: 'Split dom/ext',
    absences_impact: 'Absences',
    win_pct_diff:    'Win%',
    defensive_diff:  'Défense',
    back_to_back:    'B2B',
    rest_days_diff:  'Repos',
    ts_diff:         'TS%',
    avg_pts_diff:    'Pts/match',
    pace_diff:       'Pace',
  };
  return map[variable] ?? variable;
}

function _fmtVal(variable, value) {
  if (value == null) return '—';
  const pct = ['efg_diff', 'ts_diff', 'win_pct_diff', 'home_away_split', 'absences_impact'];
  if (pct.includes(variable)) return (value > 0 ? '+' : '') + Math.round(value * 1000) / 10 + '%';
  return (value > 0 ? '+' : '') + (Math.round(value * 100) / 100);
}

// ── EVENTS ────────────────────────────────────────────────────────────────────

function _bindEvents(container, storeInstance) {
  const getSport  = () => container.dataset.sport || 'nba';
  const settleUrl = () => getSport() === 'mlb' ? `${WORKER}/mlb/bot/settle-logs` : `${WORKER}/bot/settle-logs`;
  const runUrl    = () => getSport() === 'mlb' ? `${WORKER}/mlb/bot/run` : `${WORKER}/bot/run`;

  // Sport toggle
  container.addEventListener('click', async (e) => {
    const sportBtn = e.target.closest('.bot-sport-btn');
    if (sportBtn) {
      container.querySelectorAll('.bot-sport-btn').forEach(b => b.classList.remove('active'));
      sportBtn.classList.add('active');
      container.dataset.sport = sportBtn.dataset.sport;
      // Reset phase filter et filter
      const analysisEl = container.querySelector('#bot-analysis-container');
      if (analysisEl) analysisEl.dataset.phaseFilter = 'all';
      await _loadAndRender(container, 'all');
      return;
    }

    // Filtres
    const filterBtn = e.target.closest('.bot-filter-btn');
    if (filterBtn) {
      container.querySelectorAll('.bot-filter-btn').forEach(b => b.classList.remove('active'));
      filterBtn.classList.add('active');
      await _loadAndRender(container, filterBtn.dataset.filter);
      return;
    }

    // Settle
    const settleBtn = e.target.closest('#bot-settle-btn');
    if (settleBtn) {
      settleBtn.disabled = true;
      settleBtn.textContent = '⟳ Settlement…';
      try {
        const resp = await fetch(settleUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await resp.json();
        settleBtn.textContent = `✓ ${data.settled ?? 0} settlés`;
        setTimeout(() => {
          settleBtn.textContent = '⟳ Settler';
          settleBtn.disabled = false;
        }, 2000);
        const activeFilter = container.querySelector('.bot-filter-btn.active')?.dataset?.filter ?? 'all';
        await _loadAndRender(container, activeFilter);
      } catch (err) {
        settleBtn.textContent = '✗ Erreur';
        setTimeout(() => { settleBtn.textContent = '⟳ Settler'; settleBtn.disabled = false; }, 2000);
      }
      return;
    }

    // Run manuel
    const runBtn = e.target.closest('#bot-run-btn');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = '▶ Lancement…';
      try {
        await fetch(runUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        runBtn.textContent = '✓ Lancé';
        setTimeout(() => {
          runBtn.textContent = '▶ Run';
          runBtn.disabled = false;
        }, 3000);
        // Recharger après 5s pour voir les résultats
        setTimeout(async () => {
          const activeFilter = container.querySelector('.bot-filter-btn.active')?.dataset?.filter ?? 'all';
          await _loadAndRender(container, activeFilter);
        }, 5000);
      } catch (err) {
        runBtn.textContent = '✗ Erreur';
        setTimeout(() => { runBtn.textContent = '▶ Run'; runBtn.disabled = false; }, 2000);
      }
      return;
    }
  });
}

function _bindLogCards(logsEl) {
  logsEl.querySelectorAll('.bot-log-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Ne pas toggler si clic sur un bouton
      if (e.target.closest('button')) return;
      const matchId  = card.dataset.matchId;
      const detailEl = logsEl.querySelector(`#detail-${matchId}`);
      if (detailEl) detailEl.classList.toggle('open');
    });
  });
}
