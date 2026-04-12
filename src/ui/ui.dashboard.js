/**
 * MANI BET PRO — ui.dashboard.js v4.7
 *
 * AJOUTS v4.7 :
 *   - Auto-refresh à 12h00 et 23h00 heure de Paris.
 *     12h00 : synchro de mi-journée.
 *     23h00 : synchro du soir.
 *     Le refresh invalide le cache dashboard (dashboardCacheAt = 0) puis relance _loadAndDisplay.
 *   - Bouton "Actualiser" dans le header pour forcer un refresh manuel.
 *
 * AJOUTS v4.6 :
 *   - TTL cache dashboard : 5 minutes. Si les données ont moins de 5 min,
 *     la navigation retour/dashboard est instantanée — zéro appel API.
 *     Le timestamp est stocké dans le store via 'dashboardCacheAt'.
 *
 * AJOUTS v4.5 :
 *   - Badge warning "Données partielles" quand weight_coverage < 0.75.
 *     Indique que des signaux importants manquent dans le calcul du score.
 *     Ex : forme récente absente = 20% des poids non couverts.
 *
 * AMÉLIORATIONS v3 :
 *   - Labels recommandations plus clairs : 'Vainqueur du match', 'Handicap (points)', 'Total de points'
 *   - Cotes décimales avec source intégrée et tooltip explicatif
 *   - Edge coloré en 3 niveaux : vert ≥12%, orange ≥7%, gris <7%
 *   - Meilleure opportunité : "Parier sur X · cote Y"
 *   - Net Rating affiché sur les cartes si disponible
 *
 * CORRECTIONS v2 :
 *   - Cartes affichent probabilité moteur en % (P_moteur vs P_marché)
 *   - Filtre O(1) : index par match_id
 *   - Badges alignés sur decision
 *   - Bordure carte selon décision
 *   - spread_line transmis au modal paper betting
 */

import { router }           from './ui.router.js';
import { DataOrchestrator } from '../orchestration/data.orchestrator.js';
import { EngineCore }       from '../engine/engine.core.js';
import { LoadingUI }        from './ui.loading.js';
import { Logger }           from '../utils/utils.logger.js';
import { americanToDecimal, formatEdge } from '../utils/utils.odds.js';

// Injecter les styles dynamiques v4 (pulse, barre proba, countdown)
function _injectStyles() {
  if (document.querySelector('#mbp-dash-v4-styles')) return;
  const s = document.createElement('style');
  s.id = 'mbp-dash-v4-styles';
  s.textContent = `
    @keyframes mbp-pulse {
      0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
      50%       { opacity: 0.4; transform: translateY(-50%) scale(0.7); }
    }
    .mbp-proba-bar {
      height: 5px;
      border-radius: 3px;
      overflow: hidden;
      background: var(--color-border);
      margin: 6px 0 2px;
      position: relative;
    }
    .mbp-proba-bar__fill {
      height: 100%;
      border-radius: 3px;
      background: var(--color-signal);
      transition: width 0.6s ease;
    }
    .mbp-countdown {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-warning);
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255,165,0,0.08);
    }
    .mbp-countdown--soon { color: var(--color-danger); background: rgba(241,70,104,0.08); }
    .mbp-countdown--live { color: var(--color-success); background: rgba(72,199,142,0.08); }
    .mbp-bet-dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--color-signal);
      margin-right: 4px;
      vertical-align: middle;
    }
    .match-card__net-rating-v4 {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      margin-top: 4px;
    }
    .mbp-weight-warning {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 600;
      color: var(--color-warning);
      background: rgba(255,165,0,0.08);
      border: 1px solid rgba(255,165,0,0.20);
      padding: 2px 7px;
      border-radius: 4px;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(s);
}

// ── AUTO-REFRESH ──────────────────────────────────────────────────────────

/**
 * v4.7 : Planifie un refresh automatique à 12h00 et 23h00 heure de Paris.
 * Compare l'heure actuelle à la prochaine fenêtre de refresh.
 * Utilise un setTimeout unique — pas de setInterval qui accumulerait les appels.
 *
 * @returns {number} timeoutId — pour nettoyage via clearTimeout
 */
function _scheduleNextRefresh(container, storeInstance) {
  const REFRESH_HOURS_PARIS = [23 * 60 + 30, 7 * 60]; // 12h00 et 23h00 en minutes

  const now       = new Date();
  // Convertir en heure de Paris (UTC+2 en été, UTC+1 en hiver)
  const utcOffset = now.getTimezoneOffset(); // en minutes, négatif pour Paris
  const parisOffset = -120; // UTC+2 (CEST) — à ajuster si UTC+1 en hiver
  const parisMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes()) + (-parisOffset);
  const currentMinutes = parisMinutes % (24 * 60);

  // Trouver le prochain créneau
  let minDelay = Infinity;
  for (const targetMinutes of REFRESH_HOURS_PARIS) {
    let delay = targetMinutes - currentMinutes;
    if (delay <= 0) delay += 24 * 60; // demain
    if (delay < minDelay) minDelay = delay;
  }

  const delayMs = minDelay * 60 * 1000;
  Logger.info('AUTO_REFRESH_SCHEDULED', {
    next_in_min: minDelay,
    next_at_paris: (() => {
      const d = new Date(Date.now() + delayMs);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    })(),
  });

  return setTimeout(async function() {
    Logger.info('AUTO_REFRESH_TRIGGERED', {});
    // Invalider le cache pour forcer un rechargement complet
    storeInstance.set({ dashboardCacheAt: 0 });
    const date = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();
    await _loadAndDisplay(container, storeInstance, date, { forceHeavySync: false });
    // Planifier le prochain refresh
    _scheduleNextRefresh(container, storeInstance);
  }, delayMs);
}

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  _injectStyles();
  let selectedDate = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();

  container.innerHTML = _renderShell(selectedDate);
  _bindFilterEvents(container, storeInstance);
  _bindDateSelector(container, storeInstance, selectedDate, async (newDate) => {
    selectedDate = newDate;
    storeInstance.set({ 'dashboardFilters.selectedDate': newDate });
    await _loadAndDisplay(container, storeInstance, newDate);
  });

  // v4.7 : Bouton actualiser manuel
  const refreshBtn = container.querySelector('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function() {
      refreshBtn.textContent = '⟳ Actualisation...';
      refreshBtn.disabled = true;
      storeInstance.set({ dashboardCacheAt: 0 });
      await _loadAndDisplay(container, storeInstance, selectedDate, { forceHeavySync: true });
      refreshBtn.textContent = '⟳ Actualiser';
      refreshBtn.disabled = false;
    });
  }

  await _loadAndDisplay(container, storeInstance, selectedDate);

  // v4.7 : Planifier l'auto-refresh
  _scheduleNextRefresh(container, storeInstance);

  return { destroy() {} };
}

// ── CHARGEMENT ────────────────────────────────────────────────────────────

async function _loadAndDisplay(container, storeInstance, date, options = {}) {
  const list = container.querySelector('#matches-list');
  date = date ?? _getTodayDate();

  try {
    LoadingUI.show();

    // ── Cache : si analyses déjà chargées pour cette date, réutiliser ──
    const cachedAnalyses = storeInstance.get('analyses') ?? {};
    const cachedMatches  = storeInstance.get('matches')  ?? {};
    const cachedDate     = storeInstance.get('dashboardFilters')?.selectedDate;

    const cachedAt  = storeInstance.get('dashboardCacheAt') ?? 0;
    const cacheAge  = Date.now() - cachedAt;
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    if (
      cachedDate === date &&
      Object.keys(cachedAnalyses).length > 0 &&
      Object.keys(cachedMatches).length > 0 &&
      cacheAge < CACHE_TTL
    ) {
      const matchList     = Object.values(cachedMatches).filter(m => m.sport === 'NBA');
      const analysisIndex = _buildAnalysisIndex(cachedAnalyses);

      // Charger l'état paper trading une seule fois pour tout le rendu
      const ptState = _loadPaperState();
      _renderMatchCards(list, matchList, storeInstance);

      let analyser = 0, explorer = 0, insuffisant = 0, rejete = 0;
      matchList.forEach(match => {
        const analysis = analysisIndex[match.id];
        if (!analysis) return;
        _updateMatchCard(list, match.id, analysis, match, ptState);
        switch (analysis.decision ?? _legacyDecision(analysis)) {
          case 'ANALYSER':    analyser++;    break;
          case 'EXPLORER':    explorer++;    break;
          case 'INSUFFISANT': insuffisant++; break;
          case 'REJETÉ':      rejete++;      break;
        }
      });

      const conclusive = analyser + explorer;
      const rejected   = insuffisant + rejete;
      _updateSummary(container, matchList.length, conclusive, rejected);
      _renderBestOpportunity(container, matchList, analysisIndex);
      LoadingUI.hide();
      return;
    }

    // ── Pas de cache — charger depuis l'API ──
    const result = await DataOrchestrator.loadAndAnalyze(date, storeInstance);

    if (!result?.matches?.length) {
      _renderEmptyState(list);
      _updateSummary(container, 0, 0, 0);
      return;
    }

    // Stocker le timestamp de chargement pour le TTL cache
    storeInstance.set({ dashboardCacheAt: Date.now() });

    const analysisIndex = _buildAnalysisIndex(result.analyses);

    const ptState = _loadPaperState();
    _renderMatchCards(list, result.matches, storeInstance);

    let analyser = 0, explorer = 0, insuffisant = 0, rejete = 0;

    result.matches.forEach(match => {
      const analysis = analysisIndex[match.id];
      if (!analysis) return;
      _updateMatchCard(list, match.id, analysis, match, ptState);

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

function _buildAnalysisIndex(analyses) {
  if (!analyses) return {};
  const index = {};
  const matchIds = new Set();
  for (const analysis of Object.values(analyses)) {
    if (analysis?.match_id) matchIds.add(analysis.match_id);
  }
  for (const matchId of matchIds) {
    const latest = _resolveLatestAnalysisForMatch(analyses, matchId);
    if (latest) index[matchId] = latest;
  }
  return index;
}

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
  const today    = _getTodayDate();
  const tomorrow = _offsetDate(today, 1);

  return `
    <div class="dashboard">

      <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="page-header__eyebrow">Mani Bet Pro</div>
          <div class="page-header__title">Dashboard</div>
          <div class="page-header__sub">${displayDate}</div>
        </div>
        <button id="refresh-btn" style="font-size:11px;padding:5px 10px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-muted);cursor:pointer;margin-top:4px;flex-shrink:0">⟳ Actualiser</button>
      </div>

      <div class="date-selector filter-chips" id="date-selector">
        <button class="chip ${selectedDate === today    ? 'chip--active' : ''}" data-date="${today}">Aujourd'hui</button>
        <button class="chip ${selectedDate === tomorrow ? 'chip--active' : ''}" data-date="${tomorrow}">Demain</button>
        <input type="date" id="date-picker" value="${selectedDate}"
          style="background:var(--color-card);border:1px solid var(--color-border);color:var(--color-text);border-radius:20px;padding:4px 12px;font-size:12px;cursor:pointer;"
        />
      </div>

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

      <div class="dashboard__filters">
        <div class="filter-row">
          <span class="filter-label">Sport</span>
          <div class="filter-chips" id="filter-sports">
            <button class="chip chip--active" data-sport="ALL">Tous</button>
            <button class="chip" data-sport="NBA">NBA</button>
            <button class="chip" data-sport="TENNIS">Tennis</button>
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
        <div class="filter-row">
          <span class="filter-label">Paris</span>
          <div class="filter-chips" id="filter-bets">
            <button class="chip chip--active" data-bets="ALL">Tous</button>
            <button class="chip" data-bets="OPEN"><span class="mbp-bet-dot"></span>En cours</button>
          </div>
        </div>
      </div>

      <div id="best-opportunity" style="display:none"></div>

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
  const countdownHtml = match.datetime ? _renderCountdown(match.datetime) : '';

  const isTennis   = match.sport === 'TENNIS';
  const homeRecord = isTennis ? (match.surface ?? '') : (match.home_team?.record ?? '—');
  const awayRecord = isTennis ? (match.tournament ?? '') : (match.away_team?.record ?? '—');
  const isFinal    = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FINAL_OT';
  const homeScore  = match.home_team?.score;
  const awayScore  = match.away_team?.score;
  const showScore  = isFinal && homeScore != null && awayScore != null;
  const odds       = match.odds;
  const spread     = odds?.spread != null ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread)) : '—';
  const ou         = odds?.over_under ?? '—';

  card.innerHTML = `
    <div class="match-card__header">
      <span class="sport-tag ${match.sport === 'TENNIS' ? 'sport-tag--tennis' : 'sport-tag--nba'}">${match.sport === 'TENNIS' ? 'Tennis' : 'NBA'}</span>
      <span class="match-card__time text-muted">${isFinal ? 'Terminé' : time + ' (heure locale)'}</span>
      ${!isFinal ? countdownHtml : ''}
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

    <!-- Probabilités -->
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

    <!-- Edge + qualité -->
    <div id="edge-${match.id}" style="display:none" class="match-card__edge">
      <span style="font-size:10px;font-weight:600;color:var(--color-muted)">Avantage</span>
      <span class="match-card__edge-value" id="edge-val-${match.id}">—</span>
      <span style="font-size:10px;font-weight:600;color:var(--color-muted);margin-left:12px">Qualité données</span>
      <span class="mono" style="font-size:11px" id="quality-val-${match.id}">—</span>
    </div>

    ${odds ? `
    <div class="match-card__stats-inline text-muted" style="font-size:11px;display:flex;gap:12px">
      <span class="mono">Spread ${spread} · O/U ${ou}</span>
    </div>` : ''}

    <!-- Paris recommandés -->
    <div id="recs-${match.id}" class="match-card__recs" style="display:none"></div>

    <button class="btn btn--ghost match-card__cta" data-match-id="${match.id}" data-analysis-id="">
      → Analyser
    </button>
  `;

  card.querySelector('.match-card__cta').addEventListener('click', (e) => {
    e.stopPropagation();
    router.navigate('match', { matchId: e.currentTarget.dataset.matchId, analysisId: e.currentTarget.dataset.analysisId || null });
  });

  return card;
}

function _updateMatchCard(list, matchId, analysis, match, ptState) {
  const decision = analysis.decision ?? _legacyDecision(analysis);

  // Badge décision
  const badge = list.querySelector(`#badge-${matchId}`);
  if (badge) {
    const cfg = _decisionConfig(decision);
    badge.className = `match-card__status-badge badge ${cfg.cssClass}`;
    if (decision === 'ANALYSER') {
      badge.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:5px;vertical-align:middle;animation:mbp-pulse 1.5s ease-in-out infinite"></span>${cfg.label}`;
    } else {
      badge.textContent = cfg.label;
    }
  }

  // Bordure carte
  const card = list.querySelector(`[data-match-id="${matchId}"]`);
  if (card) {
    card.dataset.analysisId = analysis.analysis_id ?? '';
    const cta = card.querySelector('.match-card__cta');
    if (cta) cta.dataset.analysisId = analysis.analysis_id ?? '';
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

  // Probabilités moteur
  const probaBlock = list.querySelector(`#proba-${matchId}`);
  if (probaBlock && analysis.predictive_score !== null) {
    const homeProb = Math.round(analysis.predictive_score * 100);
    const awayProb = 100 - homeProb;

    const motorHome  = list.querySelector(`#motor-home-${matchId}`);
    const motorAway  = list.querySelector(`#motor-away-${matchId}`);
    const marketHome = list.querySelector(`#market-home-${matchId}`);
    const marketAway = list.querySelector(`#market-away-${matchId}`);

    if (motorHome) {
      motorHome.textContent = `${homeProb}%`;
      motorHome.className   = `match-card__proba-motor${homeProb > awayProb ? ' match-card__proba-motor--fav' : ''}`;
    }
    if (motorAway) {
      motorAway.textContent = `${awayProb}%`;
      motorAway.className   = `match-card__proba-motor${awayProb > homeProb ? ' match-card__proba-motor--fav' : ''}`;
    }

    const marketProbHome = analysis.betting_recommendations?.market_prob_home;
    const marketProbAway = analysis.betting_recommendations?.market_prob_away;
    if (marketHome && marketProbHome != null) marketHome.textContent = `Marché ${Math.round(marketProbHome * 100)}%`;
    if (marketAway && marketProbAway != null) marketAway.textContent = `Marché ${Math.round(marketProbAway * 100)}%`;

    probaBlock.style.display = '';

    // Barre de probabilité horizontale
    const existingBar = card?.querySelector('.mbp-proba-bar');
    if (!existingBar && card) {
      const bar = document.createElement('div');
      bar.className = 'mbp-proba-bar';
      bar.innerHTML = `<div class="mbp-proba-bar__fill" style="width:${homeProb}%"></div>`;
      probaBlock.after(bar);
    }
  }

  // Edge + qualité — 3 niveaux de couleur
  const edgeBlock = list.querySelector(`#edge-${matchId}`);
  const edgeVal   = list.querySelector(`#edge-val-${matchId}`);
  const qualVal   = list.querySelector(`#quality-val-${matchId}`);
  const best      = analysis.betting_recommendations?.best;

  if (edgeBlock && best?.edge != null) {
    edgeBlock.style.display = '';

    if (edgeVal) {
      edgeVal.textContent = `+${best.edge}%`;
      edgeVal.style.color = best.edge >= 12
        ? 'var(--color-success)'
        : best.edge >= 7
        ? 'var(--color-warning)'
        : 'var(--color-muted)';
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

  // Badge warning weight_coverage — v4.5
  // Affiché quand < 75% des poids sont couverts par des données disponibles.
  // Ex : forme récente manquante = signal à 0.20 de poids non calculé.
  if (card && !card.querySelector('.mbp-weight-warning')) {
    const coverage = analysis.weight_coverage;
    if (coverage !== null && coverage !== undefined && coverage < 0.75) {
      const missing = analysis.missing_variables ?? [];
      const LABELS = {
        recent_form_ema:  'forme récente',
        net_rating_diff:  'net rating',
        absences_impact:  'blessures',
        home_away_split:  'split dom/ext',
        efg_diff:         'efficacité tir',
        back_to_back:     'back-to-back',
        rest_days_diff:   'repos',
        win_pct_diff:     'bilan saison',
        defensive_diff:   'défense',
      };
      const missingLabels = missing
        .map(id => LABELS[id] ?? id)
        .slice(0, 3)
        .join(', ');
      const pct = Math.round(coverage * 100);
      const warn = document.createElement('div');
      warn.className = 'mbp-weight-warning';
      warn.title = `Données manquantes : ${missingLabels || 'inconnues'}`;
      warn.innerHTML = `⚠ Données partielles (${pct}%) — ${missingLabels || 'signaux manquants'}`;
      const edgeEl = list.querySelector(`#edge-${matchId}`);
      if (edgeEl) edgeEl.after(warn);
    }
  }

  // Net Rating — lecture directe v4 (signal dominant du moteur)
  const netRating = analysis.variables_used?.net_rating_diff?.value;
  if (card && netRating != null) {
    const existing = card.querySelector('.match-card__net-rating-v4');
    if (!existing) {
      // Déterminer quelle équipe domine et à quel niveau
      const absVal   = Math.abs(netRating);
      const domTeam  = netRating > 0
        ? (match?.home_team?.abbreviation ?? 'DOM')
        : (match?.away_team?.abbreviation ?? 'EXT');

      let domLabel, color, bg;
      if (absVal < 2) {
        domLabel = 'Niveau équivalent';
        color    = 'var(--color-muted)';
        bg       = 'rgba(255,255,255,0.04)';
      } else if (absVal < 4) {
        domLabel = `Léger avantage ${domTeam}`;
        color    = 'var(--color-warning)';
        bg       = 'rgba(255,165,0,0.08)';
      } else if (absVal < 7) {
        domLabel = `Avantage ${domTeam}`;
        color    = 'var(--color-warning)';
        bg       = 'rgba(255,165,0,0.08)';
      } else if (absVal < 10) {
        domLabel = `Domination forte — ${domTeam}`;
        color    = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)';
        bg       = netRating > 0 ? 'rgba(72,199,142,0.10)' : 'rgba(241,70,104,0.10)';
      } else {
        domLabel = `Mismatch total — ${domTeam}`;
        color    = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)';
        bg       = netRating > 0 ? 'rgba(72,199,142,0.10)' : 'rgba(241,70,104,0.10)';
      }

      const nr = document.createElement('div');
      nr.className = 'match-card__net-rating-v4';
      nr.style.cssText = `color:${color};background:${bg}`;
      nr.innerHTML = `<span style="font-size:9px;opacity:0.7;font-weight:400">Niveau</span><span>${domLabel}</span>`;
      const edgeBlock = list.querySelector(`#edge-${matchId}`);
      if (edgeBlock) edgeBlock.before(nr);
    }
  }

  // Paris recommandés — vocabulaire simplifié + cotes lisibles
  const recsContainer = list.querySelector(`#recs-${matchId}`);
  const recs = analysis.betting_recommendations?.recommendations ?? [];

  if (recsContainer && recs.length > 0) {
    recsContainer.innerHTML = recs.slice(0, 3).map(rec => {

      // Label du type de pari — vocabulaire simple
      const typeLabel = rec.type === 'MONEYLINE' ? 'Vainqueur'
                      : rec.type === 'SPREAD'    ? 'Handicap'
                      : 'O/U';

      // Équipe ou côté
      const sideLabel = rec.type === 'MONEYLINE'
        ? (rec.side === 'HOME' ? match.home_team?.abbreviation : match.away_team?.abbreviation)
        : rec.type === 'SPREAD'
        ? (rec.side === 'HOME'
            ? `${match.home_team?.abbreviation} ${rec.spread_line > 0 ? '+' : ''}${rec.spread_line}`
            : `${match.away_team?.abbreviation} ${-rec.spread_line > 0 ? '+' : ''}${-rec.spread_line}`)
        : rec.side === 'OVER'
          ? `Plus de ${rec.ou_line ?? rec.market_total ?? '—'} pts`
          : `Moins de ${rec.ou_line ?? rec.market_total ?? '—'} pts`;

      // Cote décimale
      const oddsDecimal = rec.odds_decimal ?? (rec.odds_line > 0
        ? (rec.odds_line / 100 + 1)
        : (1 - 100 / rec.odds_line));
      const oddsFormatted = Number(oddsDecimal).toFixed(2);

      // Gain pour 100€
      const gainPour100 = Math.round((oddsDecimal - 1) * 100);
      const oddsTooltip = `Cote ${oddsFormatted} = gain de ${gainPour100}€ pour 100€ misés`;

      // Couleur edge
      const edgeColor = rec.edge >= 12 ? 'var(--color-success)'
                      : rec.edge >= 7  ? 'var(--color-warning)'
                      : 'var(--color-muted)';

      // is_contrarian vient directement du moteur (engine.nba.js v5.6)
      // Plus fiable que de recalculer côté UI
      const underdogNote = rec.is_contrarian
        ? `<span style="font-size:9px;color:var(--color-warning);margin-left:4px" title="Le moteur favorise l'adversaire mais la cote est sous-évaluée">cote sous-évaluée</span>`
        : '';

      return `<div class="match-card__rec" title="${oddsTooltip}">
        <span class="match-card__rec-type text-muted">${typeLabel}</span>
        <span class="match-card__rec-side">${sideLabel}${underdogNote}</span>
        <span class="match-card__rec-odds mono">${oddsFormatted}
          <span style="font-size:9px;color:var(--color-muted);margin-left:2px">${rec.odds_source ?? ''}</span>
        </span>
        <span class="match-card__rec-edge" style="color:${edgeColor}">+${rec.edge}%</span>
      </div>`;
    }).join('');
    recsContainer.style.display = '';
  }

  // Indicateur paris en cours — enrichi v4.3
  if (card && ptState && !card.querySelector('.mbp-open-bet-indicator')) {
    const pendingIndex = _buildPendingIndex(ptState);
    const pendingBets  = pendingIndex[matchId] ?? [];
    if (pendingBets.length > 0) {
      const totalStake = pendingBets.reduce(function(s, b) { return s + (b.stake || 0); }, 0);
      const markets    = pendingBets.map(function(b) {
        const mLabel = b.market === 'MONEYLINE' ? 'ML'
                     : b.market === 'SPREAD'    ? 'Hcap'
                     : 'O/U';
        return mLabel;
      }).join(' · ');

      const dot = document.createElement('div');
      dot.className = 'mbp-open-bet-indicator';
      dot.style.cssText = [
        'display:flex;align-items:center;gap:6px',
        'font-size:10px;font-weight:600',
        'color:var(--color-signal)',
        'margin-top:4px',
        'padding:3px 6px',
        'background:rgba(var(--color-signal-rgb,99,179,237),0.08)',
        'border-radius:4px',
        'border:1px solid rgba(var(--color-signal-rgb,99,179,237),0.20)',
      ].join(';');
      dot.innerHTML = [
        '<span class="mbp-bet-dot"></span>',
        pendingBets.length + ' pari' + (pendingBets.length > 1 ? 's' : '') + ' en cours',
        '<span style="opacity:0.6;font-weight:400">(' + markets + ' · ' + totalStake.toFixed(0) + '€)</span>',
      ].join('');

      const cta = card.querySelector('.match-card__cta');
      if (cta) cta.before(dot);
    }
  }

  // Motif de rejet, insuffisance ou absence de cotes
  const hasReason = analysis.rejection_reason || analysis.insuffisant_reason;
  if (hasReason) {
    const el     = document.createElement('div');
    el.className = 'match-card__rejection text-muted';
    if (analysis.rejection_reason) {
      el.textContent = `↳ ${_formatRejection(analysis.rejection_reason)}`;
    } else {
      el.textContent = `↳ ${analysis.insuffisant_reason}`;
    }
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

  const best = bestAnalysis.betting_recommendations.best;
  const SIDE_MAP = {
    OVER:  `Plus de ${best.ou_line ?? best.market_total ?? '—'} pts`,
    AWAY:  bestMatch.away_team?.name,
    HOME:  bestMatch.home_team?.name,
    UNDER: `Moins de ${best.ou_line ?? best.market_total ?? '—'} pts`,
  };
  const sideLabel   = SIDE_MAP[best.side] ?? best.side;
  const oddsDecimal = americanToDecimal(best.odds_line) ?? '—';
  const gainPour100 = oddsDecimal !== '—' ? Math.round((oddsDecimal - 1) * 100) : null;

  el.style.display = 'block';
  const bestCountdown = bestMatch.datetime ? _renderCountdown(bestMatch.datetime) : '';
  el.innerHTML = `
    <div style="
      background:linear-gradient(135deg,rgba(34,197,94,0.12),rgba(34,197,94,0.03));
      border:1px solid rgba(34,197,94,0.35);
      border-radius:var(--radius-md);
      padding:14px 16px;
      margin-bottom:var(--space-4);
      cursor:pointer;
    " id="best-opp-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:11px;color:var(--color-success);font-weight:700;letter-spacing:0.05em">★ MEILLEURE OPPORTUNITÉ DU JOUR</span>
        ${bestCountdown}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:700">
            ${bestMatch.home_team?.abbreviation} vs ${bestMatch.away_team?.abbreviation}
          </div>
          <div style="font-size:12px;color:var(--color-muted);margin-top:3px">
            Parier sur <strong style="color:var(--color-text)">${sideLabel}</strong> · cote <strong style="color:var(--color-signal)">${oddsDecimal}</strong>${gainPour100 ? ` <span style="color:var(--color-muted)">(+${gainPour100}€ / 100€)</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px">
          <div style="font-size:26px;font-weight:700;color:var(--color-success);line-height:1">+${bestEdge}%</div>
          <div style="font-size:10px;color:var(--color-muted)">avantage estimé</div>
        </div>
      </div>
    </div>
  `;

  el.querySelector('#best-opp-card')?.addEventListener('click', () => {
    router.navigate('match', { matchId: bestMatch.id, analysisId: analysisIndex[bestMatch.id]?.analysis_id ?? null });
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
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const parent = chip.closest('.filter-chips');
    if (!parent || parent.id === 'date-selector') return;

    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');

    const analyses = storeInstance.get('analyses') ?? {};
    const analysisIndex = _buildAnalysisIndex(analyses);

    if (chip.dataset.sport !== undefined) {
      _applyFilter(container, storeInstance, 'sport', chip.dataset.sport, analysisIndex);
      // Changer le sport actif dans le store pour router vers le bon orchestrateur
      if (chip.dataset.sport !== 'ALL') {
        storeInstance.set({ selectedSport: chip.dataset.sport });
      }
    }
    if (chip.dataset.decision !== undefined) _applyFilter(container, storeInstance, 'decision', chip.dataset.decision, analysisIndex);
    if (chip.dataset.edge !== undefined)     _applyFilter(container, storeInstance, 'edge',     chip.dataset.edge,     analysisIndex);
    if (chip.dataset.bets !== undefined)     _applyFilter(container, storeInstance, 'bets',     chip.dataset.bets,     analysisIndex);
  });
}

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
      const minEdge  = parseInt(value);
      const bestEdge = analysis?.betting_recommendations?.best?.edge ?? 0;
      visible = bestEdge >= minEdge;
    }

    if (filterType === 'bets' && value === 'OPEN') {
      try {
        const pts = _loadPaperState();
        const pendingMatchIds = new Set(
          (pts.bets ?? [])
            .filter(function(b) { return b.result === 'PENDING'; })
            .map(function(b) { return b.match_id; })
        );
        visible = pendingMatchIds.has(matchId);
      } catch { visible = false; }
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

// Charger l'état paper trading depuis localStorage (cache local du KV)
function _loadPaperState() {
  try {
    return JSON.parse(localStorage.getItem('mbp_paper_trading') ?? '{}');
  } catch { return {}; }
}

// Indexer les paris PENDING par match_id pour accès O(1)
function _buildPendingIndex(ptState) {
  const index = {}; // { matchId: [{ market, side, side_label, stake, edge }] }
  (ptState.bets ?? []).forEach(function(b) {
    if (b.result !== 'PENDING' || !b.match_id) return;
    if (!index[b.match_id]) index[b.match_id] = [];
    index[b.match_id].push({
      market:     b.market,
      side:       b.side,
      side_label: b.side_label,
      stake:      b.stake,
      edge:       b.edge,
    });
  });
  return index;
}

// Countdown jusqu'au tip-off
function _renderCountdown(datetime) {
  if (!datetime) return '';
  const now      = Date.now();
  const kickoff  = new Date(datetime).getTime();
  const diffMs   = kickoff - now;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMs < 0) {
    // Match en cours
    return '<span class="mbp-countdown mbp-countdown--live">● En cours</span>';
  }
  if (diffMins < 60) {
    return `<span class="mbp-countdown mbp-countdown--soon">Dans ${diffMins} min</span>`;
  }
  if (diffMins < 120) {
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    return `<span class="mbp-countdown mbp-countdown--soon">Dans ${h}h${m > 0 ? m + 'min' : ''}</span>`;
  }
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return `<span class="mbp-countdown">Dans ${h}h${m > 0 ? m + 'min' : ''}</span>`;
}

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
