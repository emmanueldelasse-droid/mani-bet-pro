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
import { EngineCore }   from '../engine/engine.core.js';
import { PaperEngine } from '../paper/paper.engine.js';
import { ProviderNBA } from '../providers/provider.nba.js';

// Cotes américaines → décimales (format français)
function _americanToDecimal(american) {
  if (!american) return null;
  const n = Number(american);
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

// Décimales → américaines (pour le calcul Kelly interne)
function _decimalToAmerican(decimal) {
  if (!decimal || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}
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

  // Charger cotes multi-books en arrière-plan (non bloquant)
  _loadAndRenderMultiBookOdds(container, match, analysis);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell(match, analysis) {
  return `
    <div class="match-detail">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>
        <button class="btn btn--ghost" id="share-btn" style="font-size:12px">📤 Partager</button>
      </div>

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

      ${renderBloc7(analysis, match)}
      ${renderBloc1(analysis, match)}
      ${renderBloc2(analysis)}
      ${renderBloc3(analysis, match)}
      ${renderBloc4(analysis)}
      ${renderBloc5(analysis, match)}
      ${renderBloc6(analysis)}

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

// ── BLOC 1 : VERDICT ORIENTÉ DÉCISION ────────────────────────────────────

function renderBloc1(analysis, match) {
  if (!analysis || analysis.confidence_level === 'INCONCLUSIVE') {
    return `
      <div class="card match-detail__bloc" id="bloc-1">
        <div class="bloc-header">
          <span class="bloc-header__number mono text-muted">01</span>
          <span class="bloc-header__title">Verdict</span>
          <span class="badge badge--inconclusive">Inconclus</span>
        </div>
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          ${analysis?.rejection_reason ? formatRejection(analysis.rejection_reason) : 'Données insuffisantes pour une analyse fiable.'}
        </div>
      </div>`;
  }

  // Probabilité moteur
  const score     = analysis.predictive_score;
  const homeProb  = Math.round(score * 100);
  const awayProb  = 100 - homeProb;
  const homeName  = match?.home_team?.name ?? 'Domicile';
  const awayName  = match?.away_team?.name ?? 'Extérieur';

  // Favori selon le moteur
  const motorFav     = score >= 0.5 ? homeName : awayName;
  const motorFavProb = score >= 0.5 ? homeProb : awayProb;
  const motorUndProb = 100 - motorFavProb;
  const motorUndName = score >= 0.5 ? awayName : homeName;

  // Cote équitable (sans marge bookmaker)
  const fairOddsFav = motorFavProb > 0 ? (100 / motorFavProb).toFixed(2) : '—';
  const fairOddsUnd = motorUndProb > 0 ? (100 / motorUndProb).toFixed(2) : '—';

  // Meilleur pari détecté
  const best = analysis.betting_recommendations?.best;
  const hasBet = best && best.edge >= 5;

  // Décision nette
  let decision, decisionColor, decisionIcon;
  const dataQuality = analysis.data_quality_score ?? 0;
  const edge = best?.edge ?? 0;

  if (!hasBet) {
    decision = 'PASSER';
    decisionColor = 'var(--color-muted)';
    decisionIcon = '—';
  } else if (edge >= 10 && dataQuality >= 0.80) {
    decision = 'PARIER';
    decisionColor = 'var(--color-success)';
    decisionIcon = '✓';
  } else if (edge >= 7) {
    decision = 'À CONSIDÉRER';
    decisionColor = 'var(--color-warning)';
    decisionIcon = '△';
  } else {
    decision = 'PASSER';
    decisionColor = 'var(--color-muted)';
    decisionIcon = '—';
  }

  return `
    <div class="card match-detail__bloc" id="bloc-1">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">01</span>
        <span class="bloc-header__title">Verdict</span>
        <span style="font-size:13px;font-weight:700;color:${decisionColor}">${decisionIcon} ${decision}</span>
      </div>

      ${renderDataIncompleteWarning(analysis)}

      <!-- Probabilités moteur -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:16px">
        <div style="text-align:left">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${homeName}</div>
          <div style="font-size:24px;font-weight:700;color:${score >= 0.5 ? 'var(--color-signal)' : 'var(--color-muted)'}">${homeProb}%</div>
          <div style="font-size:10px;color:var(--color-muted)">Cote équitable : ${fairOddsFav}</div>
        </div>
        <div style="text-align:center;color:var(--color-muted);font-size:13px">vs</div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${awayName}</div>
          <div style="font-size:24px;font-weight:700;color:${score < 0.5 ? 'var(--color-signal)' : 'var(--color-muted)'}">${awayProb}%</div>
          <div style="font-size:10px;color:var(--color-muted)">Cote équitable : ${fairOddsUnd}</div>
        </div>
      </div>

      <!-- Barre de probabilité -->
      <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:12px">
        <div style="height:100%;width:${homeProb}%;background:var(--color-signal);border-radius:3px"></div>
      </div>

      <!-- Résumé décision -->
      ${hasBet ? `
        <div style="
          background:rgba(${decisionColor === 'var(--color-success)' ? '72,199,142' : '255,193,7'},0.1);
          border-left:3px solid ${decisionColor};
          border-radius:6px;
          padding:10px 12px;
          font-size:12px;
          margin-bottom:12px;
        ">
          <div style="font-weight:600;color:${decisionColor};margin-bottom:4px">
            ${decisionIcon} ${decision}
          </div>
          <div style="color:var(--color-muted)">
            Edge détecté : <strong style="color:var(--color-text)">+${edge}%</strong>
            · Qualité données : <strong style="color:var(--color-text)">${Math.round(dataQuality * 100)}%</strong>
            ${dataQuality < 0.80 ? ' · <span style="color:var(--color-warning)">⚠ Données incomplètes</span>' : ''}
          </div>
        </div>
      ` : `
        <div style="font-size:12px;color:var(--color-muted);margin-bottom:12px">
          Aucun edge suffisant détecté sur ce match.
        </div>
      `}

      <div class="bloc-meta text-muted">
        <span class="mono" style="font-size:10px">
          ${analysis.computed_at
            ? `Calculé ${new Date(analysis.computed_at).toLocaleTimeString('fr-FR')}`
            : ''}
          ${analysis.model_version ? ` · v${analysis.model_version}` : ''}
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
        const oddsStr = _americanToDecimal(best.odds_line) ?? best.odds_line;
        if (best.type === 'OVER_UNDER') {
          const ouLabel = best.side === 'OVER' ? 'Over' : 'Under';
          return `Pari suggéré : ${ouLabel} ${oddsStr} — cote sous-estimée de ${best.edge}%`;
        }
        return `Pari suggéré : ${side} ${oddsStr} — cote sous-estimée de ${best.edge}%`;
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

// ── COTES MULTI-BOOKS ────────────────────────────────────────────────────

async function _loadAndRenderMultiBookOdds(container, match, analysis) {
  try {
    const comparison = await ProviderNBA.getOddsComparison();
    if (!comparison) return;

    const matchOdds = ProviderNBA.findMatchOdds(
      comparison,
      match.home_team?.name,
      match.away_team?.name
    );
    if (!matchOdds?.bookmakers?.length) return;

    // Injecter le tableau multi-books dans le bloc 07
    const bloc7 = container.querySelector('#bloc-7');
    if (!bloc7) return;

    const existing = bloc7.querySelector('.multibook-table');
    if (existing) existing.remove();

    const BOOK_LABELS = {
      winamax:    'Winamax',
      betclic:    'Betclic',
      unibet_eu:  'Unibet',
      betsson:    'Betsson',
      pinnacle:   'Pinnacle',
      bet365:     'Bet365',
    };

    const isFlipped = matchOdds.home_team !== match.home_team?.name;

    const rows = matchOdds.bookmakers.map(bk => {
      const homeOdds = isFlipped ? bk.away_ml : bk.home_ml;
      const awayOdds = isFlipped ? bk.home_ml : bk.away_ml;
      const label    = BOOK_LABELS[bk.key] ?? bk.title;

      // Meilleure cote = plus haute
      const bestHome = matchOdds.best_home_ml;
      const bestAway = matchOdds.best_away_ml;

      return `
        <tr style="border-bottom:1px solid var(--color-border)">
          <td style="padding:6px 8px;font-size:12px;color:var(--color-muted)">${label}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${homeOdds === bestHome ? '700' : '400'};color:${homeOdds === bestHome ? 'var(--color-success)' : 'var(--color-text)'}">
            ${homeOdds?.toFixed(2) ?? '—'}
          </td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${awayOdds === bestAway ? '700' : '400'};color:${awayOdds === bestAway ? 'var(--color-success)' : 'var(--color-text)'}">
            ${awayOdds?.toFixed(2) ?? '—'}
          </td>
        </tr>`;
    }).join('');

    const table = document.createElement('div');
    table.className = 'multibook-table';
    table.style.cssText = 'margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px';
    table.innerHTML = `
      <div style="font-size:11px;color:var(--color-muted);margin-bottom:8px;font-weight:600">
        Comparaison cotes — ${matchOdds.bookmakers.length} bookmakers
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--color-border)">
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:left;font-weight:500">Book</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.home_team?.abbreviation ?? 'DOM'}</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.away_team?.abbreviation ?? 'EXT'}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="font-size:10px;color:var(--color-muted);margin-top:6px">
        ★ Meilleure cote disponible · Source : The Odds API
      </div>
    `;

    bloc7.appendChild(table);

    // Alerte si meilleure cote différente de DraftKings
    _checkBetterOddsAlert(bloc7, matchOdds, match, analysis);

  } catch (err) {
    // Silencieux — les cotes multi-books sont optionnelles
  }
}

function _checkBetterOddsAlert(bloc7, matchOdds, match, analysis) {
  if (!analysis?.betting_recommendations?.best) return;
  const best = analysis.betting_recommendations.best;

  const isFlipped    = matchOdds.home_team !== match.home_team?.name;
  const draftKings   = _americanToDecimal(best.odds_line);
  const sideIsHome   = best.side === 'HOME';

  // Meilleure cote disponible sur les autres books
  let bestExternal = null, bestBook = null;
  for (const bk of (matchOdds.bookmakers ?? [])) {
    const odds = isFlipped
      ? (sideIsHome ? bk.away_ml : bk.home_ml)
      : (sideIsHome ? bk.home_ml : bk.away_ml);
    if (odds && (!bestExternal || odds > bestExternal)) {
      bestExternal = odds;
      bestBook     = bk.title;
    }
  }

  if (!bestExternal || !draftKings || bestExternal <= draftKings) return;

  // Afficher l'alerte
  const existing = bloc7.querySelector('.better-odds-alert');
  if (existing) existing.remove();

  const alert = document.createElement('div');
  alert.className = 'better-odds-alert';
  alert.style.cssText = `
    margin-top:10px;
    padding:10px 12px;
    background:rgba(72,199,142,0.1);
    border-left:3px solid var(--color-success);
    border-radius:6px;
    font-size:12px;
  `;
  alert.innerHTML = `
    <div style="color:var(--color-success);font-weight:700;margin-bottom:2px">
      💡 Meilleure cote disponible ailleurs
    </div>
    <div style="color:var(--color-muted)">
      ${bestBook} offre <strong style="color:var(--color-text)">${bestExternal.toFixed(2)}</strong>
      vs DraftKings <strong style="color:var(--color-text)">${draftKings}</strong>
      — misez sur ${bestBook} pour maximiser le gain.
    </div>
  `;
  bloc7.appendChild(alert);

  // Pré-remplir la cote dans les boutons paper-bet-btn
  bloc7.querySelectorAll('.paper-bet-btn').forEach(btn => {
    if (btn.dataset.side === best.side && btn.dataset.market === best.type) {
      btn.dataset.odds = _decimalToAmerican(bestExternal) ?? btn.dataset.odds;
    }
  });
}

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

  // Équipe favorite selon le moteur
  const motorFavorite = analysis?.predictive_score != null
    ? (analysis.predictive_score > 0.5
        ? (match?.home_team?.name ?? 'Domicile')
        : (match?.away_team?.name ?? 'Extérieur'))
    : null;

  const rows = betting.recommendations.map(r => {
    const sideLabel  = SIDE_LABELS[r.side] ?? r.side;
    const isBest     = best && r.type === best.type && r.side === best.side;
    const confColor  = CONF_COLORS[r.confidence] ?? 'var(--color-muted)';

    // Cote décimale DraftKings
    const oddsDecimal = _americanToDecimal(r.odds_line);

    // Kelly en euros depuis bankroll actuelle
    const paperState  = PaperEngine.load();
    const bankroll    = paperState.current_bankroll ?? 1000;
    const kellyEuros  = (r.kelly_stake != null && r.kelly_stake > 0)
      ? Math.round(r.kelly_stake * bankroll * 100) / 100
      : null;

    // Marché label
    const marketLabel = { MONEYLINE: 'Vainqueur du match', SPREAD: 'Handicap (spread)', OVER_UNDER: 'Total de points' };

    // Explication "Pourquoi" style option 2
    const isFavoriteMotor   = r.type === 'MONEYLINE' && motorFavorite === sideLabel;
    const isValueOnUnderdog = r.type === 'MONEYLINE' && motorFavorite && !isFavoriteMotor;
    const motorFavProb      = analysis?.predictive_score != null
      ? Math.round((r.side === 'HOME' ? analysis.predictive_score : 1 - analysis.predictive_score) * 100)
      : null;

    let whyText = null;
    if (r.type === 'MONEYLINE' && motorFavProb !== null) {
      if (isValueOnUnderdog) {
        whyText = `${motorFavorite} devrait gagner ce match, mais sa cote est tellement basse qu'elle ne vaut pas la mise. ${sideLabel} à ${oddsDecimal} est la vraie opportunité ici — tu paies moins cher pour une chance réelle que ce que le marché reconnaît.`;
      } else {
        whyText = `${sideLabel} est favori et sa cote le reflète bien. Le moteur détecte que le marché sous-estime légèrement ses chances réelles (${motorFavProb}% vs ${r.implied_prob}% selon le bookmaker).`;
      }
    } else if (r.type === 'SPREAD') {
      const spreadDecimal = r.odds_decimal ?? oddsDecimal;
      whyText = `Le moteur estime ${motorFavProb}% de chances pour ${sideLabel} de couvrir le spread de ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts. La cote de ${spreadDecimal} chez ${r.odds_source ?? 'le bookmaker'} sous-estime cette probabilité.`;
    } else if (r.type === 'OVER_UNDER') {
      const ouDecimal = r.odds_decimal ?? oddsDecimal;
      whyText = `Le moteur projette ${r.motor_prob} pts au total. La ligne est à ${r.ou_line} pts — le ${r.side === 'OVER' ? 'dépassement' : 'sous-total'} semble probable à la cote ${ouDecimal} chez ${r.odds_source ?? 'le bookmaker'}.`;
    }

    return `
      <div class="betting-row${isBest ? ' betting-row--best' : ''}" style="
        background:var(--color-bg);
        border-radius:10px;
        padding:14px;
        margin-bottom:10px;
        border:1px solid ${isBest ? 'var(--color-success)' : 'var(--color-border)'};
      ">
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);font-weight:600;margin-bottom:8px">★ MEILLEUR PARI DU MATCH</div>' : ''}

        <!-- Fiche style Option 3 -->
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-bottom:10px">
          <span style="font-size:10px;color:var(--color-muted);align-self:center">PARIER SUR</span>
          <span style="font-size:15px;font-weight:700">${sideLabel}</span>

          <span style="font-size:10px;color:var(--color-muted);align-self:center">MARCHÉ</span>
          <span style="font-size:12px">${marketLabel[r.type] ?? r.type}</span>

          <span style="font-size:10px;color:var(--color-muted);align-self:center">COTE</span>
          <div>
            <span style="font-size:18px;font-weight:700;color:var(--color-signal)">
              ${r.type === 'SPREAD'
                ? `${r.spread_line > 0 ? '+' : ''}${r.spread_line} · ${r.odds_decimal ?? oddsDecimal ?? '—'}`
                : r.type === 'OVER_UNDER'
                ? `${r.side === 'OVER' ? 'Over' : 'Under'} ${r.ou_line} · ${r.odds_decimal ?? oddsDecimal ?? '—'}`
                : oddsDecimal ?? '—'}
            </span>
            ${r.odds_source ? `<span style="font-size:10px;color:var(--color-muted);margin-left:6px">${r.odds_source}</span>` : ''}
          </div>

          ${kellyEuros ? `
          <span style="font-size:10px;color:var(--color-muted);align-self:center">MISE KELLY</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-text)">${kellyEuros} €</span>
          ` : ''}

          <span style="font-size:10px;color:var(--color-muted);align-self:center">EDGE</span>
          <span style="font-size:13px;font-weight:600;color:${confColor}">+${r.edge}%</span>

          ${whyText ? `
          <span style="font-size:10px;color:var(--color-muted);align-self:flex-start;padding-top:2px">POURQUOI</span>
          <span style="font-size:12px;color:var(--color-muted);line-height:1.5">${whyText}</span>
          ` : ''}
        </div>

        <button class="btn btn--primary paper-bet-btn" style="width:100%;padding:10px;font-size:13px;font-weight:600"
          data-market="${r.type}"
          data-side="${r.side}"
          data-side-label="${sideLabel}"
          data-odds="${r.odds_line}"
          data-edge="${r.edge}"
          data-motor-prob="${r.motor_prob}"
          data-implied-prob="${r.implied_prob}"
          data-kelly="${r.kelly_stake ?? 0}"
        >
          📋 Enregistrer ce pari
        </button>
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
        Un pari de valeur n'est pas forcément sur le favori — c'est le pari dont la cote du bookmaker sous-estime les vraies chances de gagner. La mise recommandée est calculée selon le Kelly Criterion (Kelly/4, max 5% du bankroll).
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

// ── AVERTISSEMENT DONNÉES INCOMPLÈTES ────────────────────────────────────

/**
 * Badge orange si qualité données < 80%.
 * Liste les sources manquantes.
 */
function renderDataIncompleteWarning(analysis) {
  const quality = analysis?.data_quality_score;
  if (quality === null || quality === undefined || quality >= 0.80) return '';

  const missing = analysis?.missing_variables ?? [];
  const missingLabels = {
    recent_form_ema:  'Forme récente (BallDontLie)',
    absences_impact:  'Blessures (ESPN Injuries)',
    back_to_back:     'Back-to-back (ESPN Schedule)',
    rest_days_diff:   'Jours de repos (ESPN Schedule)',
  };

  const missingList = missing
    .map(v => missingLabels[v] ?? v)
    .filter(Boolean)
    .slice(0, 3);

  return `
    <div class="data-incomplete-warning" style="
      display:flex; align-items:flex-start; gap:8px;
      padding:var(--space-2) var(--space-3);
      background:rgba(255,165,0,0.08);
      border-left:2px solid var(--color-warning);
      border-radius:4px;
      margin-bottom:var(--space-3);
      font-size:11px;
    ">
      <span style="color:var(--color-warning);font-size:13px">⚠</span>
      <div>
        <div style="color:var(--color-warning);font-weight:600;margin-bottom:2px">
          Données incomplètes — qualité ${Math.round(quality * 100)}%
        </div>
        ${missingList.length > 0 ? `
          <div class="text-muted">
            Manquant : ${missingList.join(' · ')}
          </div>
        ` : ''}
      </div>
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

  // Bouton partage
  container.querySelector('#share-btn')?.addEventListener('click', () => {
    if (!analysis?.betting_recommendations?.best) return;
    const best      = analysis.betting_recommendations.best;
    const SIDE_MAP  = { HOME: match.home_team?.name, AWAY: match.away_team?.name, OVER: 'Over', UNDER: 'Under' };
    const sideLabel = SIDE_MAP[best.side] ?? best.side;
    const odds      = _americanToDecimal(best.odds_line);
    const text = `🏀 ${match.home_team?.name} vs ${match.away_team?.name}\n` +
                 `✅ Pari : ${sideLabel} @ ${odds}\n` +
                 `📊 Edge : +${best.edge}% · Moteur : ${best.motor_prob}%\n` +
                 `🤖 Mani Bet Pro`;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = container.querySelector('#share-btn');
      if (btn) { btn.textContent = '✓ Copié !'; setTimeout(() => btn.textContent = '📤 Partager', 2000); }
    });
  });

  // Collapsibles
  container.querySelectorAll('.collapsible').forEach(el => {
    el.querySelector('.collapsible__header')?.addEventListener('click', () => {
      el.classList.toggle('open');
    });
  });

  // Boutons paper trading
  container.querySelectorAll('.paper-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _openBetModal(btn, match, analysis, storeInstance);
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

// ── MODAL PAPER TRADING ──────────────────────────────────────────────────

function _openBetModal(btn, match, analysis, storeInstance) {
  const market     = btn.dataset.market;
  const side       = btn.dataset.side;
  const sideLabel  = btn.dataset.sideLabel;
  const odds       = Number(btn.dataset.odds);
  const edge       = Number(btn.dataset.edge);
  const motorProb  = Number(btn.dataset.motorProb);
  const impliedProb = Number(btn.dataset.impliedProb);
  const kelly      = Number(btn.dataset.kelly);

  const state         = PaperEngine.load();
  const bankroll      = state.current_bankroll;
  const kellySuggested = kelly > 0
    ? Math.round(kelly * bankroll * 100) / 100
    : null;

  const oddsStr = odds > 0 ? `+${odds}` : String(odds);
  const marketLabels = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  const modal = document.createElement('div');
  modal.className = 'paper-modal-overlay';
  modal.innerHTML = `
    <div class="paper-modal">

      <!-- En-tête -->
      <div class="paper-modal__header">
        <span style="font-weight:700;font-size:15px">Enregistrer un pari</span>
        <button class="paper-modal__close" id="modal-close" style="font-size:18px;line-height:1">✕</button>
      </div>

      <!-- Résumé du pari -->
      <div style="background:var(--color-bg);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">
          ${match.home_team?.name ?? '—'} vs ${match.away_team?.name ?? '—'}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--color-muted)">${marketLabels[market] ?? market}</span>
          <span style="font-size:14px;font-weight:700;color:var(--color-text)">${sideLabel}</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-signal)">${_americanToDecimal(odds)}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--color-muted)">
          <span>Edge <strong style="color:var(--color-text)">${edge}%</strong></span>
          <span>Moteur <strong style="color:var(--color-text)">${motorProb}%</strong></span>
          <span>Book <strong style="color:var(--color-text)">${impliedProb}%</strong></span>
        </div>
      </div>

      <!-- Bankroll -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <span style="font-size:12px;color:var(--color-muted)">Bankroll disponible</span>
        <span style="font-size:15px;font-weight:700">${bankroll.toFixed(2)} €</span>
      </div>

      <!-- Cote réelle -->
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Cote réelle prise
          <span style="color:var(--color-muted);font-style:italic"> — modifiez si vous misez sur Winamax, Unibet…</span>
        </label>
        <input type="number" id="odds-input" class="paper-modal__input"
          value="${_americanToDecimal(odds)}"
          placeholder="Ex: 2.70"
          step="0.05"
          min="1.01"
          style="font-size:20px;font-weight:700;text-align:center;letter-spacing:0.05em"
        />
      </div>

      <!-- Mise -->
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Mise (€)
          ${kellySuggested ? `<span style="color:var(--color-signal);font-weight:600"> · Kelly : ${kellySuggested.toFixed(2)} €</span>` : ''}
        </label>
        <input type="number" id="stake-input" class="paper-modal__input"
          value="${kellySuggested ?? ''}"
          placeholder="Montant en €"
          min="0.5" max="${bankroll.toFixed(2)}" step="0.5"
          style="font-size:16px;font-weight:600;text-align:center"
        />
      </div>

      <!-- Note -->
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Note (optionnel)
        </label>
        <input type="text" id="note-input" class="paper-modal__input"
          placeholder="Ex: blessure clé non prise en compte…"
          maxlength="200"
        />
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="modal-cancel" style="flex:1;padding:12px">Annuler</button>
        <button class="btn btn--primary" id="modal-confirm" style="flex:2;padding:12px;font-size:14px;font-weight:600">
          ✓ Confirmer
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#modal-confirm')?.addEventListener('click', async () => {
    const stake        = parseFloat(modal.querySelector('#stake-input')?.value);
    const oddsDecimal  = parseFloat(modal.querySelector('#odds-input')?.value) || _americanToDecimal(odds);
    const oddsReal     = _decimalToAmerican(oddsDecimal) ?? odds; // stockage interne en américain
    const note         = modal.querySelector('#note-input')?.value?.trim() ?? null;

    if (!stake || stake <= 0 || stake > bankroll) {
      modal.querySelector('#stake-input')?.classList.add('input--error');
      return;
    }

    const result = await PaperEngine.placeBet({
      match_id:         match.id,
      date:             match.date,
      sport:            'NBA',
      home:             match.home_team?.name ?? '—',
      away:             match.away_team?.name ?? '—',
      market,
      side,
      side_label:       sideLabel,
      odds_taken:       oddsReal,
      odds_decimal:     oddsDecimal,
      odds_source:      rec?.odds_source ?? null,
      spread_line:      rec?.spread_line ?? null,
      stake,
      kelly_stake:      kelly,
      edge,
      motor_prob:       motorProb,
      implied_prob:     impliedProb,
      confidence_level: analysis?.confidence_level ?? null,
      data_quality:     analysis?.data_quality_score ?? null,
      decision_note:    note,
    });

    // Verifier si le plafond journalier a bloque le pari
    if (result && result.error === 'DAILY_LIMIT_EXCEEDED') {
      const errEl = modal.querySelector('#stake-error') ?? (() => {
        const el = document.createElement('div');
        el.id = 'stake-error';
        el.style.cssText = 'font-size:11px;color:var(--color-danger);margin-top:6px;padding:6px 8px;background:rgba(241,70,104,0.1);border-radius:4px;';
        modal.querySelector('#stake-input')?.after(el);
        return el;
      })();
      errEl.textContent = result.message;
      return;
    }

    // Notifier le store pour rafraichir l'UI historique
    storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });

    modal.remove();
    _showBetConfirmation(sideLabel, oddsStr, stake);
  });
}

function _showBetConfirmation(sideLabel, oddsStr, stake) {
  const toast = document.createElement('div');
  toast.className   = 'toast toast--success';
  toast.textContent = `✓ Pari enregistré : ${sideLabel} ${oddsStr} — ${stake.toFixed(2)} €`;
  document.getElementById('toast-container')?.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

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
