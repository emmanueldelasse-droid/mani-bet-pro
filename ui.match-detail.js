/**
 * MANI BET PRO — ui.match-detail.js
 *
 * Fiche match détaillée — Phase 2.
 * Blocs 1 à 6 : Résumé, Signaux, Qualité données, Robustesse, IA, Volatilité.
 * Aucune donnée fictive.
 */

import { store }      from '../state/store.js';
import { router }     from './ui.router.js';
import { EngineCore } from '../engine/engine.core.js';
import { AIClient }   from '../ai/ai.client.js';
import { Logger }     from '../utils/utils.logger.js';

// ── RENDER ───────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  const matchId  = storeInstance.get('activeMatchId');
  if (!matchId) { renderNoMatch(container); return { destroy() {} }; }

  const match    = storeInstance.get('matches')?.[matchId];
  if (!match)    { renderNoMatch(container); return { destroy() {} }; }

  const analyses = storeInstance.get('analyses') ?? {};
  const analysis = Object.values(analyses).find(a => a.match_id === matchId) ?? null;

  container.innerHTML = renderShell(match, analysis);
  bindEvents(container, storeInstance, match, analysis);

  // Charger l'explication IA en arrière-plan
  if (analysis && analysis.confidence_level !== 'INCONCLUSIVE') {
    loadAIExplanation(container, analysis, match, storeInstance);
  }

  return { destroy() {} };
}

// ── SHELL ────────────────────────────────────────────────────────────────

function renderShell(match, analysis) {
  return `
    <div class="match-detail">
      <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>

      <!-- En-tête match -->
      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom:var(--space-3)">
          <span class="sport-tag sport-tag--${(match.sport ?? 'nba').toLowerCase()}">${match.sport ?? 'NBA'}</span>
          <span class="text-muted" style="font-size:12px">${formatMatchTime(match)}</span>
        </div>
        <div class="match-detail__teams">
          <div class="match-detail__team">
            <div class="match-detail__team-abbr">${match.home_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.home_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Domicile</div>
          </div>
          <div class="match-detail__separator"><span class="match-detail__vs">VS</span></div>
          <div class="match-detail__team match-detail__team--away">
            <div class="match-detail__team-abbr">${match.away_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.away_team?.name ?? '—'}</div>
            <div class="match-detail__team-role text-muted">Extérieur</div>
          </div>
        </div>
      </div>

      ${renderBloc1(analysis)}
      ${renderBloc2(analysis)}
      ${renderBloc3(analysis)}
      ${renderBloc4(analysis)}
      ${renderBloc5(analysis)}
      ${renderBloc6(analysis)}
    </div>
  `;
}

// ── BLOC 1 : RÉSUMÉ EXÉCUTIF ──────────────────────────────────────────────

function renderBloc1(analysis) {
  const interp = EngineCore.interpretConfidence(analysis?.confidence_level ?? 'INCONCLUSIVE');
  const pPct   = pct(analysis?.predictive_score);
  const rPct   = pct(analysis?.robustness_score);
  const dPct   = pct(analysis?.data_quality_score);
  const vPct   = pct(analysis?.volatility_index);

  const robClass = rPct !== null
    ? rPct >= 75 ? 'text-success' : rPct >= 50 ? 'text-warning' : 'text-danger'
    : 'text-muted';

  return `
    <div class="card match-detail__bloc" id="bloc-1">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">01</span>
        <span class="bloc-header__title">Résumé exécutif</span>
        <span class="badge ${interp.cssClass}">${interp.label}</span>
      </div>

      ${analysis?.rejection_reason ? `
        <div class="rejection-banner">
          <span class="rejection-banner__icon">⚠</span>
          <div>
            <div class="rejection-banner__title">Analyse non concluante</div>
            <div class="rejection-banner__reason text-muted">${formatRejectionReason(analysis.rejection_reason)}</div>
          </div>
        </div>` : ''}

      <div class="scores-grid">
        ${renderScoreBlock('Signal prédictif', pPct, 'signal', 'var(--color-signal)')}
        ${renderScoreBlock('Robustesse',       rPct, 'robust',  rPct !== null ? (rPct >= 75 ? 'var(--color-robust-high)' : rPct >= 50 ? 'var(--color-robust-mid)' : 'var(--color-robust-low)') : null, robClass)}
        ${renderScoreBlock('Qualité données',  dPct, 'data',    'var(--color-data-quality)')}
        ${renderScoreBlock('Volatilité',       vPct, 'volatility','var(--color-volatility)')}
      </div>

      ${renderMissingCritical(analysis)}

      <div class="bloc-meta text-muted">
        <span class="mono" style="font-size:10px">
          ${analysis?.computed_at ? `Calculé ${new Date(analysis.computed_at).toLocaleTimeString('fr-FR')}` : 'Non calculé'}
          ${analysis?.model_version ? ` · v${analysis.model_version}` : ''}
        </span>
      </div>
    </div>`;
}

function renderScoreBlock(label, value, type, color, textClass = '') {
  return `
    <div class="score-block score-block--${type}">
      <div class="score-block__label">${label}</div>
      <div class="score-block__value ${textClass || (value !== null ? `text-${type === 'signal' ? 'signal' : type === 'data' ? 'signal' : ''}` : 'text-muted')}"
           style="${color && value !== null ? `color:${color}` : ''}">
        ${value !== null ? `${value}%` : '—'}
      </div>
      ${value !== null ? `
        <div class="score-bar" style="margin-top:var(--space-2)">
          <div class="score-bar__track">
            <div class="score-bar__fill" style="width:${value}%; background:${color ?? 'var(--color-signal)'}"></div>
          </div>
        </div>` : `<div class="score-block__na">donnée non fournie ou non vérifiée</div>`}
    </div>`;
}

// ── BLOC 2 : SIGNAUX DOMINANTS ────────────────────────────────────────────

function renderBloc2(analysis) {
  const signals = analysis?.key_signals ?? [];
  return `
    <div class="card match-detail__bloc" id="bloc-2">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">02</span>
        <span class="bloc-header__title">Signaux dominants</span>
        <span class="text-muted" style="font-size:11px">${signals.length} signal${signals.length !== 1 ? 's' : ''}</span>
      </div>
      ${signals.length === 0 ? `
        <div class="empty-state" style="padding:var(--space-4) 0">
          <div class="empty-state__icon" style="font-size:20px">—</div>
          <div class="empty-state__text">${analysis?.rejection_reason ? 'Aucun signal calculable — analyse rejetée' : 'Aucun signal significatif détecté'}</div>
        </div>` : `
        <div class="signals-list stack stack--sm">
          ${signals.map(s => renderSignalRow(s)).join('')}
        </div>
        ${(analysis?.weak_signals?.length ?? 0) > 0 ? `
          <div class="collapsible" id="weak-signals">
            <div class="collapsible__header">
              <span class="text-muted" style="font-size:12px">${analysis.weak_signals.length} signal${analysis.weak_signals.length !== 1 ? 's' : ''} faible${analysis.weak_signals.length !== 1 ? 's' : ''}</span>
              <span class="collapsible__arrow">▼</span>
            </div>
            <div class="collapsible__body">
              <div class="signals-list stack stack--sm" style="margin-top:var(--space-2)">
                ${analysis.weak_signals.map(s => renderSignalRow(s, true)).join('')}
              </div>
            </div>
          </div>` : ''}
      `}
    </div>`;
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
        <div class="signal-row__why text-muted">${signal.why_signal ?? '—'}</div>
      </div>
      <div class="signal-row__contribution mono">${cPct !== null ? `${cPct}%` : '—'}</div>
    </div>`;
}

// ── BLOC 3 : QUALITÉ DES DONNÉES ──────────────────────────────────────────

function renderBloc3(analysis) {
  const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
  const fields    = Object.entries(breakdown);

  return `
    <div class="card match-detail__bloc" id="bloc-3">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">03</span>
        <span class="bloc-header__title">Qualité des données</span>
        ${analysis?.data_quality_score !== null && analysis?.data_quality_score !== undefined
          ? `<span class="badge badge--data">${pct(analysis.data_quality_score)}%</span>`
          : '<span class="badge badge--inconclusive">—</span>'}
      </div>

      ${fields.length === 0 ? `
        <div class="empty-state" style="padding:var(--space-3) 0">
          <div class="empty-state__text">Qualité des données non évaluée</div>
        </div>` : `
        <div class="data-quality-list">
          ${fields.map(([id, d]) => `
            <div class="dq-row">
              <div class="dq-row__info">
                <span class="dq-row__label ${d.critical ? 'dq-row__label--critical' : ''}">${d.label}${d.critical ? ' *' : ''}</span>
                <span class="dq-row__source text-muted">${d.source}</span>
              </div>
              <span class="badge ${qualityBadgeClass(d.quality)}">${d.quality}</span>
            </div>`).join('')}
        </div>
        <div class="text-muted" style="font-size:10px;margin-top:var(--space-3)">* Variable critique — son absence entraîne un rejet</div>
      `}
    </div>`;
}

function qualityBadgeClass(quality) {
  const map = {
    VERIFIED:             'badge--robust-high',
    PARTIAL:              'badge--warning',
    ESTIMATED:            'badge--warning',
    LOW_SAMPLE:           'badge--robust-mid',
    UNCALIBRATED:         'badge--inconclusive',
    INSUFFICIENT_SAMPLE:  'badge--robust-low',
    MISSING:              'badge--robust-low',
  };
  return map[quality] ?? 'badge--inconclusive';
}

// ── BLOC 4 : ROBUSTESSE ───────────────────────────────────────────────────

function renderBloc4(analysis) {
  const rob = analysis?.robustness_breakdown;

  return `
    <div class="card match-detail__bloc" id="bloc-4">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">04</span>
        <span class="bloc-header__title">Robustesse</span>
        ${rob?.score !== null && rob?.score !== undefined
          ? `<span class="badge ${rob.score >= 0.75 ? 'badge--robust-high' : rob.score >= 0.50 ? 'badge--warning' : 'badge--robust-low'}">${pct(rob.score)}%</span>`
          : '<span class="badge badge--inconclusive">—</span>'}
      </div>

      ${!rob ? `
        <div class="empty-state" style="padding:var(--space-3) 0">
          <div class="empty-state__text">Robustesse non calculée</div>
        </div>` : `

        <!-- Variables critiques -->
        ${rob.critical_variables?.length > 0 ? `
          <div class="robustness-alert">
            <span style="color:var(--color-danger)">⚠</span>
            <span class="text-muted" style="font-size:12px">
              ${rob.critical_variables.length} variable${rob.critical_variables.length !== 1 ? 's' : ''} critique${rob.critical_variables.length !== 1 ? 's' : ''} :
              <strong>${rob.critical_variables.join(', ')}</strong>
            </span>
          </div>` : ''}

        <!-- Seuil de renversement -->
        ${rob.reversal_threshold ? `
          <div class="robustness-reversal">
            <span style="color:var(--color-disagreement)">↻</span>
            <span class="text-muted" style="font-size:12px">
              Conclusion renversée si <strong>${rob.reversal_threshold.variable}</strong>
              varie de ±${rob.reversal_threshold.step_pct}%
            </span>
          </div>` : `
          <div class="text-muted" style="font-size:12px;margin-bottom:var(--space-3)">
            ✓ Aucun seuil de renversement détecté dans les perturbations testées
          </div>`}

        <!-- Tableau de sensibilité -->
        <div class="collapsible" id="sensitivity-collapsible">
          <div class="collapsible__header">
            <span class="text-muted" style="font-size:12px">Détail sensibilité par variable</span>
            <span class="collapsible__arrow">▼</span>
          </div>
          <div class="collapsible__body">
            <div class="sensitivity-table">
              <div class="sensitivity-table__header">
                <span>Variable</span>
                <span>Δ max</span>
                <span>Criticité</span>
              </div>
              ${(rob.sensitivities ?? []).filter(s => s.available).map(s => `
                <div class="sensitivity-table__row">
                  <span class="text-muted" style="font-size:12px">${s.label}</span>
                  <span class="mono" style="font-size:12px;color:${s.max_delta > 0.10 ? 'var(--color-danger)' : s.max_delta > 0.05 ? 'var(--color-warning)' : 'var(--color-success)'}">
                    ${s.max_delta !== null ? (s.max_delta * 100).toFixed(1) + '%' : '—'}
                  </span>
                  <span class="badge ${s.is_critical_sensitivity ? 'badge--robust-low' : 'badge--robust-high'}" style="font-size:9px">
                    ${s.is_critical_sensitivity ? 'CRITIQUE' : 'STABLE'}
                  </span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      `}
    </div>`;
}

// ── BLOC 5 : EXPLICATION IA ───────────────────────────────────────────────

function renderBloc5(analysis) {
  const isInconclusive = !analysis || analysis.confidence_level === 'INCONCLUSIVE';

  return `
    <div class="card match-detail__bloc" id="bloc-5">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">05</span>
        <span class="bloc-header__title">Explication IA</span>
        <span class="badge badge--signal">Claude</span>
      </div>

      ${isInconclusive ? `
        <div class="empty-state" style="padding:var(--space-3) 0">
          <div class="empty-state__text">Explication IA non disponible — analyse non concluante</div>
        </div>` : `

        <!-- Sélecteur de tâche IA -->
        <div class="ai-task-selector" id="ai-task-selector">
          ${['SUMMARIZE', 'EXPLAIN', 'AUDIT', 'DETECT_INCONSISTENCY'].map((task, i) => `
            <button class="chip ${i === 0 ? 'chip--active' : ''}" data-ai-task="${task}">
              ${formatTaskLabel(task)}
            </button>`).join('')}
        </div>

        <!-- Contenu IA -->
        <div class="ai-content" id="ai-content">
          <div class="ai-loading" id="ai-loading">
            <div class="loader__spinner" style="width:20px;height:20px"></div>
            <span class="text-muted" style="font-size:12px">Analyse en cours…</span>
          </div>
          <div class="ai-text hidden" id="ai-text"></div>
          <div class="ai-flags hidden" id="ai-flags"></div>
        </div>

        <div class="bloc-meta text-muted" id="ai-meta" style="display:none">
          <span class="mono" style="font-size:10px" id="ai-meta-text"></span>
        </div>
      `}
    </div>`;
}

// ── BLOC 6 : VOLATILITÉ & CONTEXTE ───────────────────────────────────────

function renderBloc6(analysis) {
  const vol = analysis?.volatility_index;
  const volPct = pct(vol);
  const volLabel = vol === null ? '—'
    : vol >= 0.6 ? 'Élevée'
    : vol >= 0.4 ? 'Modérée'
    : 'Faible';
  const volColor = vol === null ? 'var(--color-text-muted)'
    : vol >= 0.6 ? 'var(--color-robust-low)'
    : vol >= 0.4 ? 'var(--color-robust-mid)'
    : 'var(--color-robust-high)';

  return `
    <div class="card match-detail__bloc" id="bloc-6">
      <div class="bloc-header">
        <span class="bloc-header__number mono text-muted">06</span>
        <span class="bloc-header__title">Volatilité & Contexte</span>
      </div>

      <div class="volatility-display">
        <div class="volatility-display__value" style="color:var(--color-volatility)">
          ${volPct !== null ? `${volPct}%` : '—'}
        </div>
        <div class="volatility-display__label" style="color:${volColor}">${volLabel}</div>
      </div>

      ${volPct !== null ? `
        <div class="score-bar score-bar--volatility" style="margin-bottom:var(--space-4)">
          <div class="score-bar__track">
            <div class="score-bar__fill" style="width:${volPct}%"></div>
          </div>
        </div>` : ''}

      <div class="context-factors">
        <div class="context-factor">
          <span class="context-factor__label text-muted">Bruit intrinsèque sport</span>
          <span class="badge badge--signal" style="font-size:10px">FAIBLE (NBA)</span>
        </div>
        <div class="context-factor">
          <span class="context-factor__label text-muted">Modélisabilité</span>
          <span class="badge badge--robust-high" style="font-size:10px">HAUTE</span>
        </div>
        <div class="context-factor">
          <span class="context-factor__label text-muted">Données absences</span>
          <span class="badge badge--inconclusive" style="font-size:10px">NON DISPONIBLES</span>
        </div>
      </div>
    </div>`;
}

// ── CHARGEMENT IA ────────────────────────────────────────────────────────

async function loadAIExplanation(container, analysis, match, storeInstance, task = 'SUMMARIZE') {
  const loadingEl = container.querySelector('#ai-loading');
  const textEl    = container.querySelector('#ai-text');
  const flagsEl   = container.querySelector('#ai-flags');
  const metaEl    = container.querySelector('#ai-meta');
  const metaTxtEl = container.querySelector('#ai-meta-text');

  if (!loadingEl || !textEl) return;

  loadingEl.classList.remove('hidden');
  textEl.classList.add('hidden');

  try {
    const explanation = await AIClient.explain(analysis, match, task);

    loadingEl.classList.add('hidden');

    if (!explanation) {
      textEl.textContent = 'Explication IA indisponible — vérifier la connexion au Worker.';
      textEl.classList.remove('hidden');
      return;
    }

    // Afficher le texte
    textEl.innerHTML = formatAIText(explanation.response_text);
    textEl.classList.remove('hidden');

    // Afficher les flags si présents
    if (explanation.hallucination_flags?.length > 0) {
      flagsEl.innerHTML = `
        <div class="ai-flags-list">
          ${explanation.hallucination_flags.map(f => `
            <div class="ai-flag">
              <span class="badge badge--warning" style="font-size:9px">${f.severity}</span>
              <span class="text-muted" style="font-size:11px">${f.label}</span>
            </div>`).join('')}
        </div>`;
      flagsEl.classList.remove('hidden');
    }

    // Métadonnées
    if (metaEl && metaTxtEl) {
      metaTxtEl.textContent = `${explanation.model_used} · ${explanation.tokens_used ?? '?'} tokens · ${new Date(explanation.generated_at).toLocaleTimeString('fr-FR')}${explanation.clean ? '' : ' · ⚠ Flags détectés'}`;
      metaEl.style.display = '';
    }

  } catch (err) {
    Logger.error('AI_UI_LOAD_ERROR', { message: err.message });
    loadingEl.classList.add('hidden');
    textEl.textContent = 'Erreur lors du chargement de l\'explication IA.';
    textEl.classList.remove('hidden');
  }
}

function formatAIText(text) {
  // Convertir les retours à la ligne en paragraphes
  return text
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p style="margin-bottom:var(--space-3);font-size:13px;line-height:1.6;color:var(--color-text-secondary)">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────

function bindEvents(container, storeInstance, match, analysis) {
  // Retour
  container.querySelector('#back-btn')?.addEventListener('click', () => {
    router.navigate('dashboard');
  });

  // Collapsibles
  container.querySelectorAll('.collapsible').forEach(el => {
    el.querySelector('.collapsible__header')?.addEventListener('click', () => {
      el.classList.toggle('open');
    });
  });

  // Sélecteur tâche IA
  const taskSelector = container.querySelector('#ai-task-selector');
  if (taskSelector && analysis && analysis.confidence_level !== 'INCONCLUSIVE') {
    taskSelector.addEventListener('click', async (e) => {
      const chip = e.target.closest('.chip[data-ai-task]');
      if (!chip) return;

      taskSelector.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
      chip.classList.add('chip--active');

      const task = chip.dataset.aiTask;

      // Reset UI
      const textEl = container.querySelector('#ai-text');
      const flagsEl = container.querySelector('#ai-flags');
      if (textEl)  { textEl.innerHTML = ''; textEl.classList.add('hidden'); }
      if (flagsEl) { flagsEl.innerHTML = ''; flagsEl.classList.add('hidden'); }

      await loadAIExplanation(container, analysis, match, storeInstance, task);
    });
  }
}

// ── ÉTATS VIDES ───────────────────────────────────────────────────────────

function renderNoMatch(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">▦</div>
      <div class="view-placeholder__title">Aucun match sélectionné</div>
      <div class="view-placeholder__sub">Reviens au dashboard et sélectionne un match.</div>
      <button class="btn btn--ghost" id="back-empty">← Dashboard</button>
    </div>`;
  container.querySelector('#back-empty')?.addEventListener('click', () => router.navigate('dashboard'));
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────

function pct(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value * 100);
}

function formatMatchTime(match) {
  if (!match.date) return '—';
  try {
    return new Date(match.date).toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    }) + (match.time ? ` · ${match.time}` : '');
  } catch { return match.date; }
}

function formatRejectionReason(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Robustesse insuffisante',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
    PITCHER_NOT_CONFIRMED:           'Pitcher non confirmé',
  };
  return labels[reason] ?? reason;
}

function formatTaskLabel(task) {
  const labels = {
    SUMMARIZE:            'Synthèse',
    EXPLAIN:              'Explication',
    AUDIT:                'Audit',
    DETECT_INCONSISTENCY: 'Incohérences',
  };
  return labels[task] ?? task;
}

function renderMissingCritical(analysis) {
  const missing = analysis?.missing_critical ?? [];
  if (missing.length === 0) return '';
  return `
    <div class="missing-critical-alert">
      <div class="missing-critical-alert__title">⚠ Données critiques manquantes (${missing.length})</div>
      <div class="missing-critical-alert__list">
        ${missing.map(m => `<div class="missing-item text-muted">· ${m} — donnée non fournie ou non vérifiée</div>`).join('')}
      </div>
    </div>`;
}
