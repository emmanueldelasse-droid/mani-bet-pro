/**
 * MANI BET PRO — ui.match-detail.js v2
 *
 * Fiche match complète — Blocs 1 à 6.
 *   01 — Verdict (scores + statut)
 *   02 — Signaux dominants
 *   03 — Qualité des données (source + timestamp + statut)
 *   04 — Robustesse (sensibilité, variables critiques, seuil renversement)
 *   05 — Explication IA (audit Anthropic — données moteur uniquement)
 *   06 — Volatilité & contexte
 *
 * Aucune donnée fictive.
 * Les blocs IA n'appellent l'API que sur demande explicite.
 */

import { router }     from './ui.router.js';
import { EngineCore } from '../engine/engine.core.js';
import { Logger }     from '../utils/utils.logger.js';

const WORKER_URL = 'https://manibetpro.emmanueldelasse.workers.dev';

// ── RENDER ────────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  const matchId = storeInstance.get('activeMatchId');

  if (!matchId) { renderNoMatch(container); return { destroy() {} }; }

  const match = storeInstance.get('matches')?.[matchId];
  if (!match) { renderNoMatch(container); return { destroy() {} }; }

  const analyses = storeInstance.get('analyses') ?? {};
  const analysis = Object.values(analyses).find(a => a.match_id === matchId) ?? null;

  container.innerHTML = renderShell(match, analysis);
  bindEvents(container, storeInstance, match, analysis);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell(match, analysis) {
  return `
    <div class="match-detail">

      <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>

      <!-- En-tête match -->
      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom: var(--space-3)">
          <span class="sport-tag sport-tag--nba">NBA</span>
          <span class="text-muted" style="font-size:12px">${formatMatchTime(match)}</span>
        </div>

        <div class="match-detail__teams">
          <div class="match-detail__team">
            <div class="match-detail__team-abbr">${match.home_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.home_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Domicile</div>
            <div class="text-muted mono" style="font-size:11px">${match.home_team?.record ?? ''}</div>
          </div>
          <div class="match-detail__separator">
            <span class="match-detail__vs">VS</span>
          </div>
          <div class="match-detail__team match-detail__team--away">
            <div class="match-detail__team-abbr">${match.away_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.away_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Extérieur</div>
            <div class="text-muted mono" style="font-size:11px">${match.away_team?.record ?? ''}</div>
          </div>
        </div>

        ${match.odds ? renderOddsBar(match.odds) : ''}
      </div>

      ${renderBloc1(analysis)}
      ${renderBloc2(analysis)}
      ${renderBloc3(analysis, match)}
      ${renderBloc4(analysis)}
      ${renderBloc5(analysis, match)}
      ${renderBloc6(analysis)}
      ${renderBloc7(analysis, match)}

    </div>
  `;
}

// ── COTES ─────────────────────────────────────────────────────────────────

function renderOddsBar(odds) {
  const spread = odds.spread !== null
    ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread))
    : '—';
  const ou     = odds.over_under ?? '—';
  const homeML = odds.home_ml !== null
    ? (odds.home_ml > 0 ? `+${odds.home_ml}` : String(odds.home_ml))
    : '—';
  const awayML = odds.away_ml !== null
    ? (odds.away_ml > 0 ? `+${odds.away_ml}` : String(odds.away_ml))
    : '—';

  return `
    <div class="odds-bar" style="margin-top:var(--space-3); display:flex; gap:16px; flex-wrap:wrap">
      <span class="text-muted" style="font-size:11px">📊 DraftKings</span>
      <span class="mono" style="font-size:11px">Spread <strong>${spread}</strong></span>
      <span class="mono" style="font-size:11px">O/U <strong>${ou}</strong></span>
      <span class="mono" style="font-size:11px">DOM <strong>${homeML}</strong></span>
      <span class="mono" style="font-size:11px">EXT <strong>${awayML}</strong></span>
    </div>
  `;
}

// ── BLOC 1 : RÉSUMÉ EXÉCUTIF ──────────────────────────────────────────────

function renderBloc1(analysis) {
  const interp  = EngineCore.interpretConfidence(analysis?.confidence_level ?? 'INCONCLUSIVE');

  const pPct    = pct(analysis?.predictive_score);
  const rPct    = pct(analysis?.robustness_score);
  const dPct    = pct(analysis?.data_quality_score);
  const vPct    = pct(analysis?.volatility_index);

  const rClass  = rPct !== null
    ? (rPct >= 75 ? 'text-success' : rPct >= 50 ? 'text-warning' : 'text-danger')
    : 'text-muted';

  return `
    <div class="card match-detail__bloc" id="bloc-1">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">01</span>
        <span class="bloc-header__title">Verdict</span>
        <span class="badge ${interp.cssClass}">${interp.label}</span>
      </div>

      ${analysis?.rejection_reason ? `
        <div class="rejection-banner">
          <span class="rejection-banner__icon">⚠</span>
          <div>
            <div class="rejection-banner__title">Analyse non concluante</div>
            <div class="rejection-banner__reason text-muted">${formatRejection(analysis.rejection_reason)}</div>
          </div>
        </div>
      ` : ''}

      <div class="scores-grid">
        ${renderScoreBlock('Force du signal', pPct, 'signal', 'var(--color-signal)')}
        ${renderScoreBlock('Fiabilité', rPct, 'robust', null, rClass)}
        ${renderScoreBlock('Qualité données', dPct, 'data', 'var(--color-data-quality)')}
        ${renderScoreBlock('Incertitude', vPct, 'volatility', 'var(--color-volatility)')}
      </div>

      ${renderMissingCritical(analysis)}

      <div class="bloc-meta text-muted">
        <span class="mono" style="font-size:10px">
          ${analysis?.computed_at
            ? `Calculé ${new Date(analysis.computed_at).toLocaleTimeString('fr-FR')}`
            : 'Non calculé'}
          ${analysis?.model_version ? ` · v${analysis.model_version}` : ''}
        </span>
      </div>
    </div>
  `;
}

function renderScoreBlock(label, value, type, color, extraClass = '') {
  const colStyle = color ? `color: ${color}` : '';
  const bgStyle  = type === 'robust' && value !== null
    ? `background: ${value >= 75 ? 'var(--color-robust-high)' : value >= 50 ? 'var(--color-robust-mid)' : 'var(--color-robust-low)'}`
    : color ? `background: ${color}` : '';

  return `
    <div class="score-block score-block--${type}">
      <div class="score-block__label">${label}</div>
      <div class="score-block__value ${extraClass}" style="${colStyle}">
        ${value !== null ? `${value}%` : '—'}
      </div>
      ${value !== null ? `
        <div class="score-bar" style="margin-top: var(--space-2)">
          <div class="score-bar__track">
            <div class="score-bar__fill" style="width: ${value}%; ${bgStyle}"></div>
          </div>
        </div>
      ` : `<div class="score-block__na text-muted" style="font-size:10px">donnée non fournie</div>`}
    </div>
  `;
}

// ── BLOC 2 : SIGNAUX DOMINANTS ────────────────────────────────────────────

function renderBloc2(analysis) {
  const signals = analysis?.key_signals ?? [];

  return `
    <div class="card match-detail__bloc" id="bloc-2">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">02</span>
        <span class="bloc-header__title">Pourquoi ce favori ?</span>
        <span class="text-muted" style="font-size:11px">${signals.length} signal${signals.length !== 1 ? 's' : ''}</span>
      </div>

      ${signals.length === 0 ? `
        <div class="empty-state" style="padding: var(--space-5) 0">
          <div class="empty-state__text text-muted">
            ${!analysis ? 'Analyse non disponible'
              : analysis.rejection_reason ? 'Aucun signal calculable — analyse rejetée'
              : 'Aucun signal significatif'}
          </div>
        </div>
      ` : `
        <div class="signals-list stack stack--sm">
          ${signals.map(s => renderSignalRow(s)).join('')}
        </div>

        ${(analysis?.weak_signals?.length > 0) ? `
          <div class="collapsible" id="weak-signals">
            <div class="collapsible__header">
              <span class="text-muted" style="font-size:12px">${analysis.weak_signals.length} signal${analysis.weak_signals.length !== 1 ? 's' : ''} faible${analysis.weak_signals.length !== 1 ? 's' : ''}</span>
              <span class="collapsible__arrow">▾</span>
            </div>
            <div class="collapsible__body">
              <div class="signals-list stack stack--sm" style="margin-top:var(--space-2)">
                ${analysis.weak_signals.map(s => renderSignalRow(s, true)).join('')}
              </div>
            </div>
          </div>
        ` : ''}
      `}
    </div>
  `;
}

function renderSignalRow(signal, weak = false) {
  const icon  = signal.direction === 'POSITIVE' ? '▲' : signal.direction === 'NEGATIVE' ? '▼' : '■';
  const cls   = signal.direction === 'POSITIVE' ? 'text-success' : signal.direction === 'NEGATIVE' ? 'text-danger' : 'text-muted';
  const cPct  = signal.contribution !== null ? Math.round(Math.abs(signal.contribution) * 100) : null;

  return `
    <div class="signal-row ${weak ? 'signal-row--weak' : ''}">
      <div class="signal-row__direction ${cls}">${icon}</div>
      <div class="signal-row__content">
        <div class="signal-row__label">
          ${signal.label ?? signal.variable}
          ${signal.data_quality ? `<span class="badge badge--data" style="font-size:9px">${signal.data_quality}</span>` : ''}
        </div>
        <div class="signal-row__why text-muted" style="font-size:11px">${signal.why_signal ?? '—'}</div>
      </div>
      <div class="signal-row__contribution mono">${cPct !== null ? `${cPct}%` : '—'}</div>
      ${cPct !== null ? `
        <div class="signal-row__bar">
          <div class="signal-row__bar-fill" style="width:${Math.min(100, cPct * 4)}%; background: var(--color-${signal.direction === 'POSITIVE' ? 'success' : signal.direction === 'NEGATIVE' ? 'danger' : 'muted'})"></div>
        </div>
      ` : ''}
    </div>
  `;
}

// ── BLOC 3 : QUALITÉ DES DONNÉES ──────────────────────────────────────────

function renderBloc3(analysis, match) {
  const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
  const fields    = Object.entries(breakdown);

  const QUALITY_LABELS = {
    VERIFIED:            { label: 'Vérifié',     cls: 'text-success' },
    PARTIAL:             { label: 'Partiel',      cls: 'text-warning' },
    ESTIMATED:           { label: 'Estimé',       cls: 'text-warning' },
    LOW_SAMPLE:          { label: 'Faible N',     cls: 'text-warning' },
    UNCALIBRATED:        { label: 'Non calibré',  cls: 'text-muted'   },
    INSUFFICIENT_SAMPLE: { label: 'Insuff.',      cls: 'text-danger'  },
    MISSING:             { label: 'Absent',       cls: 'text-danger'  },
  };

  return `
    <div class="card match-detail__bloc" id="bloc-3">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">03</span>
        <span class="bloc-header__title">Sources utilisées</span>
        ${analysis?.data_quality_score !== null && analysis?.data_quality_score !== undefined
          ? `<span class="mono" style="color:var(--color-data-quality); font-size:13px">${Math.round(analysis.data_quality_score * 100)}%</span>`
          : ''}
      </div>

      ${!fields.length ? `
        <div class="text-muted" style="font-size:12px">Qualité non calculée — analyse non disponible.</div>
      ` : `
        <div class="data-quality-table" style="display:grid; gap:8px">
          ${fields.map(([varId, d]) => {
            const q = QUALITY_LABELS[d.quality] ?? { label: d.quality, cls: 'text-muted' };
            return `
              <div class="dq-row" style="display:flex; align-items:baseline; gap:8px; justify-content:space-between">
                <div style="flex:1">
                  <span style="font-size:12px">${d.label}</span>
                  ${d.critical ? '<span class="badge" style="font-size:9px; background:rgba(239,68,68,0.15); color:#f87171">CRITIQUE</span>' : ''}
                </div>
                <span class="${q.cls} mono" style="font-size:11px; min-width:80px; text-align:right">${q.label}</span>
                <span class="text-muted mono" style="font-size:10px; min-width:90px; text-align:right">${d.source ?? '—'}</span>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Sources utilisées -->
        <div class="text-muted" style="font-size:10px; margin-top:var(--space-4); line-height:1.6">
          Sources : ESPN Scoreboard (stats saison) · BallDontLie v1 (forme récente) · PDF NBA officiel (blessures)
        </div>
      `}
    </div>
  `;
}

// ── BLOC 4 : ROBUSTESSE ───────────────────────────────────────────────────

function renderBloc4(analysis) {
  const rb = analysis?.robustness_breakdown;

  return `
    <div class="card match-detail__bloc" id="bloc-4">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">04</span>
        <span class="bloc-header__title">Stabilité de l'analyse</span>
        ${rb?.score !== null && rb?.score !== undefined
          ? `<span class="mono ${rb.score >= 0.75 ? 'text-success' : rb.score >= 0.50 ? 'text-warning' : 'text-danger'}" style="font-size:13px">${Math.round(rb.score * 100)}%</span>`
          : ''}
      </div>

      ${!rb || rb.score === null ? `
        <div class="text-muted" style="font-size:12px">
          Robustesse non calculable — score prédictif absent.
        </div>
      ` : `

        ${rb.critical_variables?.length > 0 ? `
          <div class="alert alert--warning" style="margin-bottom:var(--space-3); padding:var(--space-3); background:rgba(249,115,22,0.1); border-radius:6px; font-size:12px">
            ⚠ Variables à sensibilité critique : ${rb.critical_variables.join(', ')}
          </div>
        ` : ''}

        ${rb.reversal_threshold ? `
          <div class="alert alert--danger" style="margin-bottom:var(--space-3); padding:var(--space-3); background:rgba(239,68,68,0.1); border-radius:6px; font-size:12px">
            ↻ Seuil de renversement : si <strong>${rb.reversal_threshold.variable}</strong> varie de <strong>${rb.reversal_threshold.step_pct > 0 ? '+' : ''}${rb.reversal_threshold.step_pct}%</strong>, la conclusion change.
          </div>
        ` : `
          <div class="text-muted" style="font-size:11px; margin-bottom:var(--space-3)">
            ✓ Aucun renversement détecté dans les plages testées (±10%, ±20%).
          </div>
        `}

        <!-- Tableau de sensibilité -->
        <div class="sensitivity-table" style="display:grid; gap:6px">
          <div class="text-muted" style="font-size:10px; display:flex; justify-content:space-between; padding:0 4px">
            <span>Variable</span>
            <span>Δmax score</span>
          </div>
          ${(rb.sensitivities ?? [])
            .filter(s => s.available)
            .sort((a, b) => (b.max_delta ?? 0) - (a.max_delta ?? 0))
            .map(s => {
              const d = s.max_delta ?? 0;
              const barPct = Math.min(100, d * 600);
              const cls = d > 0.15 ? 'text-danger' : d > 0.08 ? 'text-warning' : 'text-success';
              return `
                <div style="display:flex; align-items:center; gap:8px">
                  <span style="flex:1; font-size:11px">${s.label}</span>
                  <div style="width:80px; height:4px; background:var(--color-border); border-radius:2px; overflow:hidden">
                    <div style="height:100%; width:${barPct}%; background:var(--color-${d > 0.15 ? 'danger' : d > 0.08 ? 'warning' : 'success'})"></div>
                  </div>
                  <span class="mono ${cls}" style="font-size:11px; min-width:40px; text-align:right">
                    ${(d * 100).toFixed(1)}%
                  </span>
                </div>
              `;
            }).join('')}
        </div>

        <div class="text-muted" style="font-size:10px; margin-top:var(--space-3)">
          Méthode : perturbation systématique ±10% ±20% par variable.
          Score robustesse = 1 − Δmax.
        </div>
      `}
    </div>
  `;
}

// ── BLOC 5 : EXPLICATION IA ───────────────────────────────────────────────

function renderBloc5(analysis, match) {
  const canCallAI = analysis && analysis.confidence_level !== null && analysis.explanation_context;
  const best = analysis?.betting_recommendations?.best;

  const bestStr = best
    ? (() => {
        const home = match?.home_team?.name ?? 'Domicile';
        const away = match?.away_team?.name ?? 'Extérieur';
        const side = best.side === 'HOME' ? home : best.side === 'AWAY' ? away : best.side;
        const oddsStr = best.odds_line > 0 ? `+${best.odds_line}` : String(best.odds_line);
        const ouLabel = best.type === 'OVER_UNDER' ? (best.side === 'OVER' ? 'Over' : 'Under') + ' ' : ''; return `Pari suggéré : ${ouLabel}${best.type === 'OVER_UNDER' ? '' : side + ' '}${oddsStr} — cote sous-estimée de ${best.edge}%`;
      })()
    : null;

  return `
    <div class="card match-detail__bloc" id="bloc-5">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">05</span>
        <span class="bloc-header__title">Analyse IA</span>
      </div>

      <div id="ai-content">
        ${!canCallAI ? `
          <div class="text-muted" style="font-size:12px">
            Analyse non disponible pour ce match.
          </div>
        ` : `
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:var(--space-3)">
            <button class="btn btn--primary" data-ai-task="EXPLAIN" id="btn-ai-explain">
              💬 Expliquer ce match
            </button>
            <button class="btn btn--ghost btn--sm" data-ai-task="AUDIT" id="btn-ai-audit">
              🔍 Vérifier la cohérence
            </button>
            <button class="btn btn--ghost btn--sm" data-ai-task="DETECT_INCONSISTENCY" id="btn-ai-detect">
              ⚡ Détecter les anomalies
            </button>
          </div>
          ${bestStr ? `<div style="font-size:12px;color:var(--color-success);margin-bottom:var(--space-3);padding:var(--space-2);border-left:2px solid var(--color-success)">${bestStr}</div>` : ''}
          <div id="ai-response" class="ai-response text-muted" style="font-size:13px; line-height:1.8; min-height:60px">
            Clique sur "Expliquer ce match" pour obtenir une analyse claire.
          </div>
        `}
      </div>
    </div>
  `;
}

// ── BLOC 6 : VOLATILITÉ & CONTEXTE ────────────────────────────────────────

function renderBloc6(analysis) {
  const vi = analysis?.volatility_index;

  const volLevel = vi === null ? null
    : vi >= 0.6 ? { label: 'Élevée', cls: 'text-danger',  desc: 'Match potentiellement imprévisible.' }
    : vi >= 0.4 ? { label: 'Modérée', cls: 'text-warning', desc: 'Facteurs d\'incertitude présents.' }
    :             { label: 'Faible',  cls: 'text-success', desc: 'Contexte relativement stable.' };

  return `
    <div class="card match-detail__bloc" id="bloc-6">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">06</span>
        <span class="bloc-header__title">Niveau d'incertitude</span>
        ${volLevel ? `<span class="${volLevel.cls} mono" style="font-size:13px">${Math.round(vi * 100)}%</span>` : ''}
      </div>

      ${vi === null ? `
        <div class="text-muted" style="font-size:12px">Volatilité non calculée.</div>
      ` : `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:var(--space-3)">
          <div>
            <div style="font-size:28px; font-weight:700; ${volLevel.cls === 'text-success' ? 'color:var(--color-success)' : volLevel.cls === 'text-warning' ? 'color:var(--color-warning)' : 'color:var(--color-danger)'}">${Math.round(vi * 100)}%</div>
            <div class="${volLevel.cls}" style="font-size:13px; font-weight:500">${volLevel.label}</div>
          </div>
          <div style="flex:1">
            <div class="score-bar">
              <div class="score-bar__track">
                <div class="score-bar__fill" style="width:${Math.round(vi * 100)}%; background:${vi >= 0.6 ? 'var(--color-danger)' : vi >= 0.4 ? 'var(--color-warning)' : 'var(--color-success)'}"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="text-muted" style="font-size:12px; margin-bottom:var(--space-3)">${volLevel.desc}</div>

        <!-- Facteurs contextuels -->
        <div class="context-factors" style="display:grid; gap:6px; font-size:12px">
          ${renderContextFactor('Bruit intrinsèque NBA', 'Faible — signal relativement stable sur 82 matchs', 'LOW')}
          ${renderContextFactor('Modélisabilité', 'Élevée — statistiques avancées disponibles (ESPN)', 'HIGH')}
          ${renderContextFactor('Sources données', '3 sources actives : ESPN · BallDontLie · PDF NBA', 'INFO')}
        </div>

        <div class="text-muted" style="font-size:10px; margin-top:var(--space-3)">
          Volatilité estimée à partir des absences et de la qualité des données.<br>
          Non calibrée sur données historiques — indicatif uniquement.
        </div>
      `}
    </div>
  `;
}

// ── BLOC 7 : RECOMMANDATIONS PARIS ────────────────────────────────────────

function renderBloc7(analysis, match) {
  const betting = analysis?.betting_recommendations;
  const odds    = match?.odds;

  if (!odds) {
    return `
      <div class="card match-detail__bloc" id="bloc-7">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">07</span>
          <span class="bloc-header__title">Recommandations paris</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          Cotes non disponibles pour ce match.
        </div>
      </div>`;
  }

  if (!betting?.recommendations?.length) {
    return `
      <div class="card match-detail__bloc" id="bloc-7">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">07</span>
          <span class="bloc-header__title">Recommandations paris</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          Aucune opportunité détectée sur ce match.
        </div>
      </div>`;
  }

  const CONF_COLORS = { FORTE: 'var(--color-success)', MOYENNE: 'var(--color-warning)', FAIBLE: 'var(--color-muted)' };
  const SIDE_LABELS = {
    HOME:  match?.home_team?.name ?? 'Domicile',
    AWAY:  match?.away_team?.name ?? 'Extérieur',
    OVER:  'Over',
    UNDER: 'Under',
  };

  const best = betting.best;

  const rows = betting.recommendations.map(r => {
    const sideLabel = SIDE_LABELS[r.side] ?? r.side;
    const oddsStr   = r.odds_line > 0 ? `+${r.odds_line}` : String(r.odds_line);
    const confColor = CONF_COLORS[r.confidence] ?? 'var(--color-muted)';
    const isBest    = best && r.type === best.type && r.side === best.side;

    return `
      <div class="betting-row${isBest ? ' betting-row--best' : ''}">
        <div class="betting-row__type text-muted" style="font-size:11px">${r.label}</div>
        <div class="betting-row__main">
          <span class="betting-row__side">${sideLabel}</span>
          <span class="mono betting-row__odds">${oddsStr}</span>
        </div>
        <div class="betting-row__stats">
          <span class="text-muted" style="font-size:11px">Moteur ${r.motor_prob}% · Bookmaker ${r.implied_prob}%</span>
          <span class="betting-row__edge" style="color:${confColor};font-size:11px;font-weight:600">
            Cote sous-estimée de ${r.edge}%
          </span>
        </div>
        ${r.note ? `<div class="text-muted" style="font-size:10px;margin-top:4px">${r.note}</div>` : ''}
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);margin-top:4px">★ Meilleur pari du match</div>' : ''}
      </div>`;
  }).join('');

  return `
    <div class="card match-detail__bloc" id="bloc-7">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">07</span>
        <span class="bloc-header__title">Recommandations paris</span>
        <span class="text-muted" style="font-size:11px">${betting.recommendations.length} marché${betting.recommendations.length > 1 ? 's' : ''} analysé${betting.recommendations.length > 1 ? 's' : ''}</span>
      </div>

      <div class="betting-disclaimer text-muted" style="font-size:11px;margin-bottom:var(--space-3);padding:var(--space-2);border-left:2px solid var(--color-border)">
        Le moteur compare ses calculs aux cotes du bookmaker. Une cote sous-estimée ne garantit pas le résultat, mais indique une opportunité statistique.
      </div>

      <div class="betting-list">
        ${rows}
      </div>
    </div>`;
}


function renderContextFactor(label, value, level) {
  const cls = level === 'HIGH' ? 'text-success' : level === 'LOW' ? 'text-success' : level === 'MEDIUM' ? 'text-warning' : 'text-muted';
  return `
    <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px">
      <span>${label}</span>
      <span class="${cls}" style="font-size:11px; text-align:right; max-width:200px">${value}</span>
    </div>
  `;
}

// ── DONNÉES MANQUANTES CRITIQUES ──────────────────────────────────────────

function renderMissingCritical(analysis) {
  const missing = analysis?.missing_critical ?? [];
  if (!missing.length) return '';

  return `
    <div class="missing-critical-alert" style="margin-top:var(--space-3); padding:var(--space-3); background:rgba(239,68,68,0.1); border-radius:6px">
      <div style="font-size:12px; font-weight:600; color:#f87171; margin-bottom:var(--space-2)">
        ⚠ Données critiques manquantes (${missing.length})
      </div>
      <div class="text-muted" style="font-size:11px">
        ${missing.map(m => `· ${m} — donnée non fournie ou non vérifiée`).join('<br>')}
      </div>
    </div>
  `;
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────

function bindEvents(container, storeInstance, match, analysis) {
  container.querySelector('#back-btn')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });

  // Collapsibles
  container.querySelectorAll('.collapsible').forEach(el => {
    el.querySelector('.collapsible__header')?.addEventListener('click', () => {
      el.classList.toggle('open');
    });
  });

  // Boutons IA
  if (analysis?.explanation_context) {
    container.querySelectorAll('[data-ai-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = btn.dataset.aiTask;
        triggerAIExplanation(container, analysis, match, task);
      });
    });
  }
}

// ── APPEL IA ─────────────────────────────────────────────────────────────

async function triggerAIExplanation(container, analysis, match, task) {
  const responseEl = container.querySelector('#ai-response');
  if (!responseEl) return;

  responseEl.innerHTML = '<span class="text-muted">Analyse en cours…</span>';

  const TASK_PROMPTS = {
    EXPLAIN: `Tu es un analyste sportif NBA. Réponds en 3-4 phrases courtes, sans titres, sans gras, sans listes. INTERDIT ABSOLU : inventer un chiffre, un pourcentage, un joueur, un résultat non présent dans les données fournies. Utilise UNIQUEMENT les valeurs exactes du contexte. Phrase 1 : quelle équipe est favorisée selon le score moteur fourni et pourquoi. Phrase 2 : le signal principal en termes simples. Phrase 3 : confirmer ou non le pari suggéré si présent. Phrase 4 : une limite courte. Max 80 mots.`,

    AUDIT: `Tu es un analyste sportif NBA. En 2-3 phrases simples sans titres ni listes : dis si les signaux sont cohérents entre eux. Si contradiction, explique laquelle. Uniquement les données fournies. Max 60 mots.`,

    DETECT_INCONSISTENCY: `Tu es un analyste sportif NBA. En 2 phrases simples sans titres ni listes : dis s'il y a une anomalie dans les données. Si aucune anomalie, dis-le clairement. Uniquement les données fournies. Max 50 mots.`,
  };

  const systemPrompt = TASK_PROMPTS[task] ?? TASK_PROMPTS.EXPLAIN;

  const home = match.home_team?.name ?? '—';
  const away = match.away_team?.name ?? '—';
  const score = analysis.predictive_score !== null ? Math.round(analysis.predictive_score * 100) : null;
  const favori = score !== null ? (score > 50 ? `${home} (score moteur: ${score}%)` : score < 50 ? `${away} (score moteur: ${100 - score}%)` : 'Match équilibré (50%)') : 'Non déterminé';

  const userMessage = `
N'INVENTE AUCUN CHIFFRE. Utilise uniquement les valeurs ci-dessous.
Match : ${home} vs ${away}
Favori selon le moteur : ${favori}

Contexte moteur :
- Score prédictif : ${analysis.predictive_score !== null ? Math.round(analysis.predictive_score * 100) + '%' : 'non calculé'}
- Robustesse : ${analysis.robustness_score !== null ? Math.round(analysis.robustness_score * 100) + '%' : 'non calculée'}
- Qualité données : ${analysis.data_quality_score !== null ? Math.round(analysis.data_quality_score * 100) + '%' : 'non calculée'}
- Niveau de confiance : ${analysis.confidence_level}
- Raison de rejet : ${analysis.rejection_reason ?? 'aucune'}

Signaux clés :
${(analysis.key_signals ?? []).map(s =>
  `- ${s.label} : direction=${s.direction}, contribution=${(s.contribution * 100).toFixed(1)}%, qualité=${s.data_quality ?? '?'}`
).join('\n')}

Variables manquantes critiques : ${(analysis.missing_critical ?? []).join(', ') || 'aucune'}

Variables à sensibilité critique : ${(analysis.robustness_breakdown?.critical_variables ?? []).join(', ') || 'aucune'}

Seuil de renversement : ${analysis.robustness_breakdown?.reversal_threshold
  ? `${analysis.robustness_breakdown.reversal_threshold.variable} à ${analysis.robustness_breakdown.reversal_threshold.step_pct}%`
  : 'aucun détecté'}

Paris suggérés par le moteur : ${(() => {
  const recs = analysis.betting_recommendations?.recommendations ?? [];
  if (!recs.length) return 'aucun';
  const home = match?.home_team?.name ?? 'Domicile';
  const away = match?.away_team?.name ?? 'Extérieur';
  return recs.map(r => {
    const side = r.side === 'HOME' ? home : r.side === 'AWAY' ? away : r.side;
    const oddsStr = r.odds_line > 0 ? '+' + r.odds_line : String(r.odds_line);
    return r.type === 'OVER_UNDER'
      ? `${r.label} : ${r.side} ${oddsStr} (moteur ${r.motor_prob}pts vs ligne ${r.implied_prob}pts, edge ${r.edge}%)`
      : `${r.label} : ${side} ${oddsStr} (moteur ${r.motor_prob}% vs bookmaker ${r.implied_prob}%, edge ${r.edge}%)`;
  }).join(' | ');
})()}
  `.trim();

  try {
    const response = await fetch(`${WORKER_URL}/ai/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Worker HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.content
      ?.map(b => b.type === 'text' ? b.text : '')
      .join('\n')
      .trim();

    if (!text) throw new Error('Réponse IA vide');

    const cleanText = text
      .replace(/^#{1,4}\s.+$/gm, '')
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      .replace(/^[-•]\s/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    responseEl.innerHTML = `
      <div style="line-height:1.8; font-size:13px">${escapeHtml(cleanText)}</div>
      <div class="text-muted" style="font-size:10px; margin-top:var(--space-2)">
        Source : Claude Sonnet · Basé uniquement sur les données du moteur
      </div>
    `;

  } catch (err) {
    Logger.error('AI_EXPLANATION_ERROR', { message: err.message });
    responseEl.innerHTML = `
      <div class="text-muted" style="font-size:12px">
        Erreur lors de l'appel IA : ${escapeHtml(err.message)}<br>
        Vérifie la connexion au Worker Cloudflare.
      </div>
    `;
  }
}

// ── ÉTAT VIDE ─────────────────────────────────────────────────────────────

function renderNoMatch(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">◪</div>
      <div class="view-placeholder__title">Aucun match sélectionné</div>
      <div class="view-placeholder__sub">Reviens au dashboard et sélectionne un match.</div>
      <button class="btn btn--ghost" id="back-from-empty">← Dashboard</button>
    </div>
  `;
  container.querySelector('#back-from-empty')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────

function pct(v) {
  if (v === null || v === undefined) return null;
  return Math.round(v * 100);
}

function formatMatchTime(match) {
  try {
    if (match.datetime) {
      return new Date(match.datetime).toLocaleDateString('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short',
      }) + ' · ' + new Date(match.datetime).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit',
      });
    }
    if (match.date) return new Date(match.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {}
  return '—';
}

function formatRejection(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées — configurez les poids',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes — score impossible',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Score trop sensible aux hypothèses',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé en V2',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
  };
  return labels[reason] ?? reason;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
