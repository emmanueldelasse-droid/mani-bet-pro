/**
 * MANI BET PRO — ui.dashboard.js v2
 *
 * CORRECTIONS v2 :
 *   - Cartes affichent probabilité moteur en % (P_moteur vs P_marché)
 *     au lieu des barres "Signal / Robustesse" non parlantes
 *   - Filtre O(1) : index par match_id au lieu de Object.values().find() O(n)
 *   - Badges alignés sur decision ('ANALYSER'|'EXPLORER'|'INSUFFISANT'|'REJETÉ')
 *     au lieu de confidence_level ('INCONCLUSIVE')
 *   - Bordure carte selon décision, pas uniquement selon edge
 *   - spread_line transmis au modal paper betting (correctif paper.settler.js)
 */

import { router }           from './ui.router.js';
import { DataOrchestrator } from '../orchestration/data.orchestrator.js';
import { EngineCore }       from '../engine/engine.core.js';
import { LoadingUI }        from './ui.loading.js';
import { Logger }           from '../utils/utils.logger.js';
import { americanToDecimal, formatEdge } from '../utils/utils.odds.js';

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  // Démarrage sur aujourd'hui — les matchs ESPN du jour sont les matchs du soir
  // (calendrier NBA en heure ET = nuit heure française)
  let selectedDate = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();


  container.innerHTML = _renderShell(selectedDate);
  _bindFilterEvents(container, storeInstance);
  _bindDateSelector(container, storeInstance, selectedDate, async (newDate) => {
    selectedDate = newDate;
    storeInstance.set({ 'dashboardFilters.selectedDate': newDate });
    await _loadAndDisplay(container, storeInstance, newDate);
  });

  await _loadAndDisplay(container, storeInstance, selectedDate);
  return { destroy() {} };
}

// ── CHARGEMENT ────────────────────────────────────────────────────────────

async function _loadAndDisplay(container, storeInstance, date) {
  const list = container.querySelector('#matches-list');
  date = date ?? _getTodayDate();

  try {
    LoadingUI.show();

    const result = await DataOrchestrator.loadAndAnalyze(date, storeInstance);

    if (!result?.matches?.length) {
      _renderEmptyState(list);
      _updateSummary(container, 0, 0, 0);
      return;
    }

    // Index analyses par match_id — O(1) pour les filtres
    const analysisIndex = _buildAnalysisIndex(result.analyses);

    _renderMatchCards(list, result.matches, storeInstance);

    let analyser = 0, explorer = 0, insuffisant = 0, rejete = 0;

    result.matches.forEach(match => {
      const analysis = analysisIndex[match.id];
      if (!analysis) return;
      _updateMatchCard(list, match.id, analysis, match);

      switch (analysis.decision ?? _legacyDecision(analysis)) {
        case 'ANALYSER':    analyser++;    break;
        case 'EXPLORER':    explorer++;    break;
        case 'INSUFFISANT': insuffisant++; break;
        case 'REJETÉ':      rejete++;      break;
      }
    });

    const conclusive = analyser + explorer;
    const rejected   = insuffisant + rejete;
    _updateSummary(container, result.matches.length, conclusive, rejected);
    _renderBestOpportunity(container, result.matches, analysisIndex);

  } catch (err) {
    Logger.error('DASHBOARD_RENDER_ERROR', { message: err.message });
    _renderError(list);
  } finally {
    LoadingUI.hide();
  }
}

// ── INDEX DES ANALYSES ────────────────────────────────────────────────────

/**
 * Construit un index { [match_id]: analysis } depuis l'objet analyses.
 * Évite le Object.values().find() O(n) à chaque filtre.
 */
function _buildAnalysisIndex(analyses) {
  if (!analyses) return {};
  const index = {};
  for (const analysis of Object.values(analyses)) {
    if (analysis?.match_id) {
      index[analysis.match_id] = analysis;
    }
  }
  return index;
}

/**
 * Compatibilité : calcule decision depuis confidence_level pour les
 * analyses produites avant la v4 du moteur.
 */
function _legacyDecision(analysis) {
  if (!analysis) return 'INSUFFISANT';
  if (analysis.confidence_level === 'INCONCLUSIVE' || analysis.confidence_level === null) {
    return 'INSUFFISANT';
  }
  const edge = analysis.betting_recommendations?.best?.edge ?? 0;
  if (edge >= 7 && analysis.confidence_level === 'HIGH') return 'ANALYSER';
  if (edge >= 5) return 'EXPLORER';
  return 'INSUFFISANT';
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function _renderShell(selectedDate) {
  const displayDate = new Date(selectedDate + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const today     = _getTodayDate();
  const tomorrow  = _offsetDate(today, 1);

  return `
    <div class="dashboard">

      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Dashboard</div>
        <div class="page-header__sub">${displayDate}</div>
      </div>

      <!-- Sélecteur de date -->
      <div class="date-selector filter-chips" id="date-selector">
        <button class="chip ${selectedDate === today     ? 'chip--active' : ''}" data-date="${today}">Aujourd'hui</button>
        <button class="chip ${selectedDate === tomorrow  ? 'chip--active' : ''}" data-date="${tomorrow}">Demain</button>
        <input type="date" id="date-picker" value="${selectedDate}"
          style="background:var(--color-card);border:1px solid var(--color-border);color:var(--color-text);border-radius:20px;padding:4px 12px;font-size:12px;cursor:pointer;"
        />
      </div>

      <!-- Résumé -->
      <div class="dashboard__summary" id="day-summary">
        <div class="summary-card" id="summary-total">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Matchs</div>
        </div>
        <div class="summary-card summary-card--success" id="summary-conclusive">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Analysables</div>
        </div>
        <div class="summary-card summary-card--muted" id="summary-rejected">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Rejetés</div>
        </div>
      </div>

      <!-- Filtres -->
      <div class="dashboard__filters">
        <div class="filter-row">
          <span class="filter-label">Sport</span>
          <div class="filter-chips" id="filter-sports">
            <button class="chip chip--active" data-sport="ALL">Tous</button>
            <button class="chip" data-sport="NBA">NBA</button>
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Décision</span>
          <div class="filter-chips" id="filter-decision">
            <button class="chip chip--active" data-decision="ALL">Tous</button>
            <button class="chip" data-decision="ANALYSER">Analyser</button>
            <button class="chip" data-decision="EXPLORER">Explorer</button>
            <button class="chip" data-decision="INSUFFISANT">Insuffisant</button>
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Edge min.</span>
          <div class="filter-chips" id="filter-edge">
            <button class="chip chip--active" data-edge="0">Tous</button>
            <button class="chip" data-edge="5">5%+</button>
            <button class="chip" data-edge="8">8%+</button>
            <button class="chip" data-edge="12">12%+</button>
          </div>
        </div>
      </div>

      <!-- Meilleure opportunité -->
      <div id="best-opportunity" style="display:none"></div>

      <!-- Liste matchs -->
      <div class="dashboard__matches" id="matches-list">
        <div class="loading-state">
          <div class="loader__spinner"></div>
          <span class="text-muted" style="font-size:13px">Chargement ESPN…</span>
        </div>
      </div>

    </div>
  `;
}

// ── CARTES MATCH ──────────────────────────────────────────────────────────

function _renderMatchCards(list, matches, storeInstance) {
  list.innerHTML = '';
  if (!matches.length) { _renderEmptyState(list); return; }

  const frag = document.createDocumentFragment();
  matches.forEach(match => frag.appendChild(_createMatchCard(match)));
  list.appendChild(frag);
}

function _createMatchCard(match) {
  const card           = document.createElement('div');
  card.className       = 'match-card';
  card.dataset.matchId = match.id;

  const time = match.datetime
    ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const homeRecord = match.home_team?.record ?? '—';
  const awayRecord = match.away_team?.record ?? '—';
  const isFinal    = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FINAL_OT';
  const homeScore  = match.home_team?.score;
  const awayScore  = match.away_team?.score;
  const showScore  = isFinal && homeScore != null && awayScore != null;
  const odds       = match.odds;
  const spread     = odds?.spread != null ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread)) : '—';
  const ou         = odds?.over_under ?? '—';

  card.innerHTML = `
    <div class="match-card__header">
      <span class="sport-tag sport-tag--nba">NBA</span>
      <span class="match-card__time text-muted">${isFinal ? "Terminé" : time}</span>
      <span class="match-card__status-badge badge badge--inconclusive" id="badge-${match.id}">
        ${isFinal ? 'Final' : 'Analyse…'}
      </span>
    </div>

    <div class="match-card__teams">
      <div class="match-card__team">
        <span class="match-card__team-abbr">${match.home_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.home_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${homeRecord}</span>
      </div>
      <div class="match-card__vs" style="text-align:center">
        ${showScore
          ? `<div style="font-family:var(--font-mono);font-size:20px;font-weight:700;line-height:1.2">${homeScore}<br><span style="font-size:11px;color:var(--color-muted)">–</span><br>${awayScore}</div>`
          : 'VS'
        }
      </div>
      <div class="match-card__team match-card__team--away">
        <span class="match-card__team-abbr">${match.away_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.away_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${awayRecord}</span>
      </div>
    </div>

    <!-- Probabilités — remplies par updateMatchCard après analyse -->
    <div id="proba-${match.id}" class="match-card__proba" style="display:none">
      <div class="match-card__proba-side" id="proba-home-${match.id}">
        <span class="match-card__proba-motor" id="motor-home-${match.id}">—%</span>
        <span class="match-card__proba-market text-muted" id="market-home-${match.id}"></span>
        <span class="text-muted" style="font-size:10px">${match.home_team?.abbreviation ?? 'DOM'}</span>
      </div>
      <div class="match-card__proba-sep text-muted" style="font-size:11px">vs</div>
      <div class="match-card__proba-side match-card__proba-side--away" id="proba-away-${match.id}">
        <span class="match-card__proba-motor" id="motor-away-${match.id}">—%</span>
        <span class="match-card__proba-market text-muted" id="market-away-${match.id}"></span>
        <span class="text-muted" style="font-size:10px">${match.away_team?.abbreviation ?? 'EXT'}</span>
      </div>
    </div>

    <!-- Edge -->
    <div id="edge-${match.id}" style="display:none" class="match-card__edge">
      <span class="text-muted" style="font-size:10px">EDGE</span>
      <span class="match-card__edge-value" id="edge-val-${match.id}">—</span>
      <span class="text-muted" style="font-size:10px">QUALITÉ</span>
      <span class="mono" style="font-size:11px" id="quality-val-${match.id}">—</span>
    </div>

    ${odds ? `
    <div class="match-card__stats-inline text-muted" style="font-size:11px;display:flex;gap:12px">
      <span class="mono">Spread ${spread} · O/U ${ou}</span>
    </div>` : ''}

    <!-- Paris recommandés — remplis par _updateMatchCard -->
    <div id="recs-${match.id}" class="match-card__recs" style="display:none"></div>

    <button class="btn btn--ghost match-card__cta" data-match-id="${match.id}">
      → Analyser
    </button>
  `;

  card.querySelector('.match-card__cta').addEventListener('click', (e) => {
    e.stopPropagation();
    router.navigate('match', { matchId: e.currentTarget.dataset.matchId });
  });

  return card;
}

function _updateMatchCard(list, matchId, analysis, match) {
  const decision = analysis.decision ?? _legacyDecision(analysis);

  // Badge décision
  const badge = list.querySelector(`#badge-${matchId}`);
  if (badge) {
    const cfg = _decisionConfig(decision);
    badge.textContent = cfg.label;
    badge.className   = `match-card__status-badge badge ${cfg.cssClass}`;
  }

  // Bordure carte selon décision
  const card = list.querySelector(`[data-match-id="${matchId}"]`);
  if (card) {
    const borderColors = {
      ANALYSER:    'var(--color-success)',
      EXPLORER:    'var(--color-warning)',
      INSUFFISANT: 'transparent',
      'REJETÉ':    'transparent',
    };
    const color = borderColors[decision];
    if (color && color !== 'transparent') {
      card.style.borderLeft = `3px solid ${color}`;
    }
  }

  // Probabilités moteur vs marché
  const probaBlock = list.querySelector(`#proba-${matchId}`);
  if (probaBlock && analysis.predictive_score !== null) {
    const homeProb = Math.round(analysis.predictive_score * 100);
    const awayProb = 100 - homeProb;

    const motorHome   = list.querySelector(`#motor-home-${matchId}`);
    const motorAway   = list.querySelector(`#motor-away-${matchId}`);
    const marketHome  = list.querySelector(`#market-home-${matchId}`);
    const marketAway  = list.querySelector(`#market-away-${matchId}`);

    if (motorHome) {
      motorHome.textContent = `${homeProb}%`;
      motorHome.className   = `match-card__proba-motor${homeProb > awayProb ? ' match-card__proba-motor--fav' : ''}`;
    }
    if (motorAway) {
      motorAway.textContent = `${awayProb}%`;
      motorAway.className   = `match-card__proba-motor${awayProb > homeProb ? ' match-card__proba-motor--fav' : ''}`;
    }

    // Probabilité marché (vig-free depuis Pinnacle si disponible)
    const marketProbHome = analysis.betting_recommendations?.market_prob_home;
    const marketProbAway = analysis.betting_recommendations?.market_prob_away;

    if (marketHome && marketProbHome != null) {
      marketHome.textContent = `Marché ${Math.round(marketProbHome * 100)}%`;
    }
    if (marketAway && marketProbAway != null) {
      marketAway.textContent = `Marché ${Math.round(marketProbAway * 100)}%`;
    }

    probaBlock.style.display = '';
  }

  // Edge + qualité données
  const edgeBlock = list.querySelector(`#edge-${matchId}`);
  const edgeVal   = list.querySelector(`#edge-val-${matchId}`);
  const qualVal   = list.querySelector(`#quality-val-${matchId}`);
  const best      = analysis.betting_recommendations?.best;

  if (edgeBlock && best?.edge != null) {
    edgeBlock.style.display = '';

    if (edgeVal) {
      edgeVal.textContent = `+${best.edge}%`;
      edgeVal.style.color = best.edge >= 10
        ? 'var(--color-success)'
        : best.edge >= 7
        ? 'var(--color-warning)'
        : 'var(--color-text-secondary)';
    }

    if (qualVal && analysis.data_quality_score != null) {
      const q = Math.round(analysis.data_quality_score * 100);
      qualVal.textContent = `${q}%`;
      qualVal.style.color = q >= 80
        ? 'var(--color-success)'
        : q >= 60
        ? 'var(--color-warning)'
        : 'var(--color-danger)';
    }
  }

  // Paris recommandés — affiché directement sur la carte
  const recsContainer = list.querySelector(`#recs-${matchId}`);
  const recs = analysis.betting_recommendations?.recommendations ?? [];

  if (recsContainer && recs.length > 0) {
    recsContainer.innerHTML = recs.slice(0, 3).map(rec => {
      const typeLabel = rec.type === 'MONEYLINE' ? 'Vainqueur'
                      : rec.type === 'SPREAD'    ? 'Handicap'
                      : 'Total pts';
      const sideLabel = rec.type === 'MONEYLINE'
        ? (rec.side === 'HOME' ? match.home_team?.abbreviation : match.away_team?.abbreviation)
        : rec.type === 'SPREAD'
        ? (rec.side === 'HOME'
            ? `${match.home_team?.abbreviation} ${rec.spread_line > 0 ? '+' : ''}${rec.spread_line}`
            : `${match.away_team?.abbreviation} ${rec.spread_line > 0 ? '+' : ''}${rec.spread_line}`)
        : rec.side;
      const oddsDecimal = rec.odds_decimal ?? (rec.odds_line > 0
        ? (rec.odds_line / 100 + 1).toFixed(2)
        : (1 - 100 / rec.odds_line).toFixed(2));
      const edgeColor = rec.edge >= 10 ? 'var(--color-success)'
                      : rec.edge >= 7  ? 'var(--color-warning)'
                      : 'var(--color-text-secondary)';
      return `<div class="match-card__rec">
        <span class="match-card__rec-type text-muted">${typeLabel}</span>
        <span class="match-card__rec-side">${sideLabel}</span>
        <span class="match-card__rec-odds mono">${Number(oddsDecimal).toFixed(2)}</span>
        <span class="match-card__rec-source text-muted">${rec.odds_source ?? ''}</span>
        <span class="match-card__rec-edge" style="color:${edgeColor}">+${rec.edge}%</span>
      </div>`;
    }).join('');
    recsContainer.style.display = '';
  }

  // Motif de rejet
  if (analysis.rejection_reason) {
    const el       = document.createElement('div');
    el.className   = 'match-card__rejection text-muted';
    el.textContent = `↳ ${_formatRejection(analysis.rejection_reason)}`;
    const edgeEl   = list.querySelector(`#edge-${matchId}`);
    if (edgeEl) edgeEl.after(el);
  }
}

// ── RÉSUMÉ ────────────────────────────────────────────────────────────────

function _updateSummary(container, total, conclusive, rejected) {
  const t = container.querySelector('#summary-total .summary-card__value');
  const c = container.querySelector('#summary-conclusive .summary-card__value');
  const r = container.querySelector('#summary-rejected .summary-card__value');
  if (t) t.textContent = total;
  if (c) c.textContent = conclusive;
  if (r) r.textContent = rejected;
}

// ── MEILLEURE OPPORTUNITÉ ─────────────────────────────────────────────────

function _renderBestOpportunity(container, matches, analysisIndex) {
  const el = container.querySelector('#best-opportunity');
  if (!el) return;

  let bestMatch = null, bestAnalysis = null, bestEdge = 0;

  matches.forEach(m => {
    const a = analysisIndex[m.id];
    if (!a?.betting_recommendations?.best) return;
    const edge = a.betting_recommendations.best.edge ?? 0;
    if (edge > bestEdge) { bestEdge = edge; bestMatch = m; bestAnalysis = a; }
  });

  if (!bestMatch || bestEdge < 5) { el.style.display = 'none'; return; }

  const best       = bestAnalysis.betting_recommendations.best;
  const SIDE_MAP   = {
    HOME:  bestMatch.home_team?.name,
    AWAY:  bestMatch.away_team?.name,
    OVER:  'Over',
    UNDER: 'Under',
  };
  const sideLabel  = SIDE_MAP[best.side] ?? best.side;
  const oddsDecimal = americanToDecimal(best.odds_line) ?? '—';

  el.style.display = 'block';
  el.innerHTML = `
    <div style="
      background:linear-gradient(135deg,rgba(34,197,94,0.10),rgba(34,197,94,0.03));
      border:1px solid rgba(34,197,94,0.25);
      border-radius:var(--radius-md);
      padding:12px 14px;
      margin-bottom:var(--space-4);
      cursor:pointer;
    " id="best-opp-card">
      <div style="font-size:10px;color:var(--color-success);font-weight:700;margin-bottom:4px;letter-spacing:0.05em">
        ★ MEILLEURE OPPORTUNITÉ DU JOUR
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;font-weight:600">
            ${bestMatch.home_team?.abbreviation} vs ${bestMatch.away_team?.abbreviation}
          </div>
          <div style="font-size:12px;color:var(--color-muted);margin-top:2px">
            ${sideLabel} · ${oddsDecimal}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:var(--color-success)">+${bestEdge}%</div>
          <div style="font-size:10px;color:var(--color-muted)">edge</div>
        </div>
      </div>
    </div>
  `;

  el.querySelector('#best-opp-card')?.addEventListener('click', () => {
    router.navigate('match', { matchId: bestMatch.id });
  });
}

// ── FILTRES ───────────────────────────────────────────────────────────────

function _bindDateSelector(container, storeInstance, initialDate, onDateChange) {
  const selector = container.querySelector('#date-selector');
  const picker   = container.querySelector('#date-picker');
  if (!selector) return;

  selector.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-date]');
    if (!chip) return;
    const newDate = chip.dataset.date;
    selector.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    if (picker) picker.value = newDate;
    onDateChange(newDate);
  });

  if (picker) {
    picker.addEventListener('change', (e) => {
      selector.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
      onDateChange(e.target.value);
    });
  }
}

function _bindFilterEvents(container, storeInstance) {
  // Délégation unique sur le container — O(1) par clic
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const parent = chip.closest('.filter-chips');
    if (!parent || parent.id === 'date-selector') return;

    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');

    // Récupérer l'index courant depuis le store
    const analyses = storeInstance.get('analyses') ?? {};
    const analysisIndex = _buildAnalysisIndex(analyses);

    if (chip.dataset.sport !== undefined)    _applyFilter(container, storeInstance, 'sport',    chip.dataset.sport,    analysisIndex);
    if (chip.dataset.decision !== undefined) _applyFilter(container, storeInstance, 'decision', chip.dataset.decision, analysisIndex);
    if (chip.dataset.edge !== undefined)     _applyFilter(container, storeInstance, 'edge',     chip.dataset.edge,     analysisIndex);
  });
}

/**
 * Applique un filtre en O(n) sur les cartes visibles.
 * L'index analysisIndex évite le O(n²) de l'ancienne version.
 */
function _applyFilter(container, storeInstance, filterType, value, analysisIndex) {
  const matches = storeInstance.get('matches') ?? {};

  container.querySelectorAll('.match-card').forEach(card => {
    const matchId  = card.dataset.matchId;
    const match    = matches[matchId];
    const analysis = analysisIndex[matchId];

    let visible = true;

    if (filterType === 'sport' && value !== 'ALL') {
      visible = match?.sport === value;
    }

    if (filterType === 'decision' && value !== 'ALL') {
      const dec = analysis?.decision ?? _legacyDecision(analysis);
      visible = dec === value;
    }

    if (filterType === 'edge' && value !== '0') {
      const minEdge = parseInt(value);
      const bestEdge = analysis?.betting_recommendations?.best?.edge ?? 0;
      visible = bestEdge >= minEdge;
    }

    card.style.display = visible ? '' : 'none';
  });
}

// ── ÉTATS VIDES ───────────────────────────────────────────────────────────

function _renderEmptyState(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">◎</div>
      <div class="empty-state__text">
        Aucun match NBA aujourd'hui.<br>
        <span style="font-size:11px">Vérifie la connexion au Worker Cloudflare.</span>
      </div>
    </div>
  `;
}

function _renderError(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">⚠</div>
      <div class="empty-state__text">
        Erreur lors du chargement.<br>
        <span style="font-size:11px">Consulte la console (F12) pour plus de détails.</span>
      </div>
    </div>
  `;
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _decisionConfig(decision) {
  const map = {
    'ANALYSER':    { label: 'Analyser',    cssClass: 'badge--analyser' },
    'EXPLORER':    { label: 'Explorer',    cssClass: 'badge--explorer' },
    'INSUFFISANT': { label: 'Insuffisant', cssClass: 'badge--insuffisant' },
    'REJETÉ':      { label: 'Rejeté',      cssClass: 'badge--rejete' },
  };
  return map[decision] ?? { label: 'Inconclus', cssClass: 'badge--inconclusive' };
}

function _formatRejection(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Robustesse insuffisante',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
  };
  return labels[reason] ?? reason;
}

function _getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function _offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}