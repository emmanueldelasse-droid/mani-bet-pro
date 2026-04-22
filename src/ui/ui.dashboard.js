/**
 * MANI BET PRO — ui.dashboard.js v5.1
 *
 * FIX v5.1 :
 *   - Le sport devient un vrai sélecteur de chargement, plus un faux filtre local.
 *   - Suppression du bouton "Tous" côté sport : le dashboard est mono-sport assumé.
 *   - Le cache devient cohérent par date + sport.
 *   - Le changement de date recharge le sport actif.
 *   - _renderEmptyState() ne dépend plus d'un store hors scope.
 */

import { router }           from './ui.router.js';
import { DataOrchestrator } from '../orchestration/data.orchestrator.js';
import { LoadingUI }        from './ui.loading.js';
import { Logger }           from '../utils/utils.logger.js';
import { americanToDecimal } from '../utils/utils.odds.js';
import { formatRejection as _formatRejection } from './ui.match-detail.helpers.js';

function _injectStyles() {
  if (document.querySelector('#mbp-dash-v5-styles')) return;
  const s = document.createElement('style');
  s.id = 'mbp-dash-v5-styles';
  s.textContent = `
    @keyframes mbp-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.35; transform: scale(0.65); }
    }
    @keyframes mbp-bar-in {
      from { width: 50%; }
    }

    .mbp-countdown {
      font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
      color: var(--color-warning);
      padding: 2px 6px; border-radius: 3px;
      background: rgba(245,158,11,0.10);
    }
    .mbp-countdown--soon { color: var(--color-danger); background: rgba(239,68,68,0.10); }
    .mbp-countdown--live { color: var(--color-success); background: rgba(34,197,94,0.10); animation: mbp-live-pulse 2s ease-in-out infinite; }
    @keyframes mbp-live-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

    .mc-teams {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 0;
      padding: 2px 0 0;
    }
    .mc-team { display: flex; flex-direction: column; gap: 3px; }
    .mc-team--away { align-items: flex-end; text-align: right; }

    .mc-team__abbr {
      font-family: var(--font-mono);
      font-size: 22px; font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--color-text-primary);
    }
    .mc-team__name {
      font-size: 11px; font-weight: 400;
      color: var(--color-text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 110px;
    }
    .mc-team__record {
      font-family: var(--font-mono);
      font-size: 10px; color: var(--color-text-muted);
    }
    .mc-team__odds {
      font-family: var(--font-mono);
      font-size: 15px; font-weight: 700;
      margin-top: 5px; line-height: 1;
    }
    .mc-team__prob {
      font-size: 11px; font-weight: 700;
      color: var(--color-text-muted);
      margin-top: 2px;
    }
    .mc-team__prob--fav { color: var(--color-signal); }

    .mc-vs {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 4px; padding: 0 10px;
      min-width: 44px;
    }
    .mc-vs__label {
      font-family: var(--font-mono);
      font-size: 10px; font-weight: 700;
      color: var(--color-text-muted);
      letter-spacing: 0.12em;
    }
    .mc-vs__score {
      font-family: var(--font-mono);
      font-size: 13px; font-weight: 700;
      color: var(--color-text-primary);
      text-align: center; line-height: 1.3;
    }

    .mc-proba-bar {
      height: 3px; border-radius: 2px; overflow: hidden;
      background: var(--color-border-default);
      margin: 8px 0 4px;
    }
    .mc-proba-bar__fill {
      height: 100%; border-radius: 2px;
      background: linear-gradient(90deg, var(--color-signal) 0%, var(--color-signal-light) 100%);
      transition: width 0.7s cubic-bezier(0.4,0,0.2,1);
      animation: mbp-bar-in 0.7s cubic-bezier(0.4,0,0.2,1);
    }

    .mc-level {
      display: flex; align-items: center; gap: 5px;
      padding: 4px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 600;
    }
    .mc-level__dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: currentColor; flex-shrink: 0;
    }

    .mc-best-rec {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 10px; border-radius: 6px;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border-default);
    }
    .mc-best-rec--value {
      border-color: rgba(34,197,94,0.25);
      background: rgba(34,197,94,0.05);
    }
    .mc-best-rec--warn {
      border-color: rgba(245,158,11,0.20);
      background: rgba(245,158,11,0.04);
    }
    .mc-best-rec__star {
      font-size: 10px; flex-shrink: 0;
      color: var(--color-success);
    }
    .mc-best-rec__label {
      font-size: 10px; color: var(--color-text-muted);
      flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .mc-best-rec__side {
      font-size: 12px; font-weight: 700;
      color: var(--color-text-primary);
      flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mc-best-rec__odds {
      font-family: var(--font-mono);
      font-size: 13px; font-weight: 700;
      color: var(--color-text-primary);
      flex-shrink: 0;
    }
    .mc-best-rec__edge {
      font-family: var(--font-mono);
      font-size: 11px; font-weight: 700;
      flex-shrink: 0; min-width: 36px; text-align: right;
    }

    .mbp-weight-warning {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; font-weight: 600;
      color: var(--color-warning);
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.20);
      padding: 2px 7px; border-radius: 4px;
    }

    .mbp-open-bet-indicator {
      display: flex; align-items: center; gap: 5px;
      font-size: 10px; font-weight: 600;
      color: var(--color-signal);
      padding: 3px 7px; border-radius: 4px;
      background: rgba(59,130,246,0.07);
      border: 1px solid rgba(59,130,246,0.18);
    }
    .mbp-bet-dot {
      display: inline-block;
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--color-signal);
    }

    .mc-markets {
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 0 2px;
      border-top: 1px solid var(--color-border-default);
      margin-top: 8px;
    }
    .mc-market-row {
      display: flex; align-items: center; gap: 6px;
    }
    .mc-market-row__label {
      font-family: var(--font-mono);
      font-size: 10px; font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase; letter-spacing: 0.05em;
      min-width: 42px; flex-shrink: 0;
    }
    .mc-market-pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .mc-pill {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 7px; border-radius: 20px;
      font-size: 10px; font-weight: 600;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border-default);
      color: var(--color-text-secondary);
      white-space: nowrap;
    }
    .mc-pill__side { color: var(--color-text-muted); font-weight: 400; }
    .mc-pill__val  { font-family: var(--font-mono); font-weight: 700; color: var(--color-text-primary); }
    .mc-pill--line {
      background: transparent; border-color: transparent; padding-left: 0;
      font-size: 11px; font-weight: 700; color: var(--color-text-primary);
    }
    .mc-source {
      display: inline-flex; align-items: center;
      font-size: 9px; font-weight: 600;
      color: var(--color-text-muted);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border-default);
      border-radius: 3px; padding: 1px 5px;
      letter-spacing: 0.03em; margin-left: auto; flex-shrink: 0;
    }
    .mc-header-date {
      font-size: 11px; color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .mc-series {
      font-size: 10px; font-weight: 700;
      color: #a855f7; letter-spacing: 0.03em;
      margin-top: 4px;
      padding: 2px 7px; border-radius: 4px;
      background: rgba(168,85,247,0.08);
      border: 1px solid rgba(168,85,247,0.22);
      display: inline-block;
    }
    .mc-footer__cta {
      display: block; width: 100%;
      margin-top: 10px;
      padding: 10px 0;
      font-size: 12px; font-weight: 600;
      color: var(--color-signal);
      background: rgba(59,130,246,0.07);
      border: 1px solid rgba(59,130,246,0.18);
      border-radius: 8px;
      cursor: pointer; transition: background 0.15s;
      text-align: center; letter-spacing: 0.02em;
    }
    .mc-footer__cta:hover { background: rgba(59,130,246,0.14); }
    .mc-pill__sep { color: var(--color-border); font-weight: 400; font-size: 9px; }

    #proba-placeholder { display: none !important; }
  `;
  document.head.appendChild(s);
}

function _scheduleNextRefresh(container, storeInstance) {
  const REFRESH_HOURS_PARIS = [23 * 60 + 30, 7 * 60];
  const now = new Date();
  const parisOffset = -120;
  const parisMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes()) + (-parisOffset);
  const currentMinutes = parisMinutes % (24 * 60);

  let minDelay = Infinity;
  for (const targetMinutes of REFRESH_HOURS_PARIS) {
    let delay = targetMinutes - currentMinutes;
    if (delay <= 0) delay += 24 * 60;
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
    const date = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();
    const sport = _getSelectedSport(storeInstance);
    storeInstance.set({ dashboardCacheAt: 0, dashboardCacheDate: null, dashboardCacheSport: null });
    await _loadAndDisplay(container, storeInstance, date, { manualRefresh: false, sport });
    _scheduleNextRefresh(container, storeInstance);
  }, delayMs);
}

export async function render(container, storeInstance) {
  _injectStyles();

  let selectedDate  = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();
  let selectedSport = _getSelectedSport(storeInstance);

  _syncDashboardSelection(storeInstance, selectedSport);

  container.innerHTML = _renderShell(selectedDate, selectedSport);

  _bindFilterEvents(container, storeInstance, async (newSport) => {
    selectedSport = newSport;
    _syncDashboardSelection(storeInstance, selectedSport);
    storeInstance.set({
      dashboardCacheAt: 0,
      dashboardCacheDate: null,
      dashboardCacheSport: null,
    });
    await _loadAndDisplay(container, storeInstance, selectedDate, { manualRefresh: false, sport: selectedSport });
  });

  _bindDateSelector(container, storeInstance, selectedDate, async (newDate) => {
    selectedDate = newDate;
    storeInstance.set({
      'dashboardFilters.selectedDate': newDate,
      'dashboardFilters.selectedSport': selectedSport,
      dashboardCacheDate: null,
      dashboardCacheSport: null,
      dashboardCacheAt: 0,
    });
    await _loadAndDisplay(container, storeInstance, newDate, { manualRefresh: false, sport: selectedSport });
  });

  const refreshBtn = container.querySelector('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function() {
      refreshBtn.textContent = '⟳ Actualisation...';
      refreshBtn.disabled = true;
      storeInstance.set({ dashboardCacheAt: 0, dashboardCacheDate: null, dashboardCacheSport: null });
      await _loadAndDisplay(container, storeInstance, selectedDate, { manualRefresh: true, sport: selectedSport });
      refreshBtn.textContent = '⟳ Actualiser';
      refreshBtn.disabled = false;
    });
  }

  await _loadAndDisplay(container, storeInstance, selectedDate, { manualRefresh: false, sport: selectedSport });
  _scheduleNextRefresh(container, storeInstance);

  return { destroy() {} };
}

async function _loadAndDisplay(container, storeInstance, date, options = {}) {
  const list = container.querySelector('#matches-list');
  date = date ?? _getTodayDate();
  const selectedSport = options.sport ?? _getSelectedSport(storeInstance);

  _syncDashboardSelection(storeInstance, selectedSport);

  try {
    LoadingUI.show();

    const cachedAnalyses = storeInstance.get('analyses') ?? {};
    const cachedMatches  = storeInstance.get('matches') ?? {};
    const cachedDate     = storeInstance.get('dashboardCacheDate');
    const cachedSport    = storeInstance.get('dashboardCacheSport') ?? null;
    const cachedAt       = storeInstance.get('dashboardCacheAt') ?? 0;
    const cacheAge       = Date.now() - cachedAt;
    const CACHE_TTL      = 5 * 60 * 1000;

    if (
      cachedDate === date &&
      cachedSport === selectedSport &&
      Object.keys(cachedAnalyses).length > 0 &&
      Object.keys(cachedMatches).length > 0 &&
      cacheAge < CACHE_TTL
    ) {
      const matchList = Object.values(cachedMatches).filter(m => (m?.sport ?? 'NBA') === selectedSport);
      const analysisIndex = _buildAnalysisIndex(cachedAnalyses);
      const ptState = _loadPaperState();

      if (!matchList.length) {
        _renderEmptyState(list, selectedSport);
        _updateSummary(container, 0, 0, 0);
        LoadingUI.hide();
        return;
      }

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

      _updateSummary(container, matchList.length, analyser + explorer, insuffisant + rejete);
      _renderBestOpportunity(container, matchList, analysisIndex);
      LoadingUI.hide();
      return;
    }

    const result = await DataOrchestrator.loadAndAnalyze(date, storeInstance, { ...options, sport: selectedSport });

    if (!result?.matches?.length) {
      _renderEmptyState(list, selectedSport);
      _updateSummary(container, 0, 0, 0);
      storeInstance.set({
        dashboardCacheAt: null,
        dashboardCacheDate: null,
        dashboardCacheSport: null,
      });
      return;
    }

    storeInstance.set({
      dashboardCacheAt: Date.now(),
      dashboardCacheDate: date,
      dashboardCacheSport: selectedSport,
    });

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

    _updateSummary(container, result.matches.length, analyser + explorer, insuffisant + rejete);
    _renderBestOpportunity(container, result.matches, analysisIndex);
  } catch (err) {
    Logger.error('DASHBOARD_RENDER_ERROR', { message: err.message });
    _renderError(list);
  } finally {
    LoadingUI.hide();
  }
}

function _resolveLatestAnalysisForMatch(analyses, matchId) {
  if (!analyses || !matchId) return null;
  let latest = null;
  for (const analysis of Object.values(analyses)) {
    if (!analysis || analysis.match_id !== matchId) continue;
    if (!latest) {
      latest = analysis;
      continue;
    }
    const currentTs = new Date(analysis.generated_at ?? analysis.created_at ?? 0).getTime() || 0;
    const latestTs  = new Date(latest.generated_at ?? latest.created_at ?? 0).getTime() || 0;
    if (currentTs >= latestTs) latest = analysis;
  }
  return latest;
}

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

function _renderShell(selectedDate, selectedSport) {
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
        <button class="chip ${selectedDate === today ? 'chip--active' : ''}" data-date="${today}">Aujourd'hui</button>
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
            <button class="chip ${selectedSport === 'NBA' ? 'chip--active' : ''}" data-sport="NBA">NBA</button>
            <button class="chip ${selectedSport === 'MLB' ? 'chip--active' : ''}" data-sport="MLB">MLB</button>
            <button class="chip ${selectedSport === 'TENNIS' ? 'chip--active' : ''}" data-sport="TENNIS">Tennis</button>
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
      </div>

      <div id="best-opportunity" style="display:none"></div>

      <div class="dashboard__matches" id="matches-list">
        <div class="loading-state">
          <div class="loader__spinner"></div>
          <span class="text-muted" style="font-size:13px">Chargement ${selectedSport}…</span>
        </div>
      </div>
    </div>
  `;
}

function _renderMatchCards(list, matches) {
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

  const time          = match.datetime
    ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const countdownHtml = match.datetime ? _renderCountdown(match.datetime) : '';
  const isTennis      = match.sport === 'TENNIS';
  const isMLB         = match.sport === 'MLB';
  const homeRecord    = isTennis ? (match.surface ?? '') : (match.home_team?.record ?? '—');
  const awayRecord    = isTennis ? (match.tournament ?? '') : (match.away_team?.record ?? '—');
  const isFinal       = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FINAL_OT';
  const homeScore     = match.home_team?.score;
  const awayScore     = match.away_team?.score;
  const showScore     = isFinal && homeScore != null && awayScore != null;

  // Série playoff compacte · ex: "🏆 OKC mène 1-0"
  const ps = match.playoff_series;
  const seriesBadge = (ps && (ps.home_wins != null || ps.away_wins != null)) ? (() => {
    const hW = ps.home_wins ?? 0;
    const aW = ps.away_wins ?? 0;
    const homeAbv = match.home_team?.abbreviation ?? '—';
    const awayAbv = match.away_team?.abbreviation ?? '—';
    const big = Math.max(hW, aW);
    const small = Math.min(hW, aW);
    const leader = hW > aW ? homeAbv : aW > hW ? awayAbv : null;
    const txt = leader ? `${leader} mène ${big}-${small}` : `Série ${hW}-${aW}`;
    return `<div class="mc-series">🏆 ${txt}</div>`;
  })() : '';

  const marketOdds = match.market_odds ?? null;
  const espnOdds   = match.odds ?? {};

  const _amToDec = (am) => {
    if (am == null) return null;
    const n = Number(am);
    return n > 0 ? Number((n / 100 + 1).toFixed(2)) : Number((1 - 100 / n).toFixed(2));
  };

  const pinnacleBook = marketOdds?.bookmakers?.find(b => b.key === 'pinnacle')
                    ?? marketOdds?.bookmakers?.find(b => b.key === 'winamax')
                    ?? marketOdds?.bookmakers?.[0]
                    ?? null;

  const homeDecRaw = marketOdds?.home_ml_decimal ?? pinnacleBook?.home_ml ?? _amToDec(espnOdds.home_ml);
  const awayDecRaw = marketOdds?.away_ml_decimal ?? pinnacleBook?.away_ml ?? _amToDec(espnOdds.away_ml);
  const homeDec    = homeDecRaw != null ? Number(homeDecRaw).toFixed(2) : null;
  const awayDec    = awayDecRaw != null ? Number(awayDecRaw).toFixed(2) : null;
  const oddsSource = pinnacleBook
    ? (pinnacleBook.key === 'winamax' ? 'Winamax' : 'Pinnacle')
    : (espnOdds.home_ml != null ? 'ESPN' : null);

  const ou         = espnOdds.over_under ?? marketOdds?.ou_line ?? null;
  const overDec    = marketOdds?.over_decimal  ?? null;
  const underDec   = marketOdds?.under_decimal ?? null;
  const ouOverFmt  = overDec  != null ? Number(overDec).toFixed(2)  : null;
  const ouUnderFmt = underDec != null ? Number(underDec).toFixed(2) : null;

  card.innerHTML = `
    <div class="match-card__header" style="display:flex;align-items:center;gap:6px">
      <span class="sport-tag ${isTennis ? 'sport-tag--tennis' : isMLB ? 'sport-tag--mlb' : 'sport-tag--nba'}">${isTennis ? 'Tennis' : isMLB ? 'MLB' : 'NBA'}</span>
      ${!isFinal ? countdownHtml : ''}
      <span class="mc-header-date" style="margin-left:auto">${isFinal ? 'Terminé' : time}</span>
      <span class="match-card__status-badge badge badge--inconclusive" id="badge-${match.id}" style="font-size:10px;padding:2px 7px">
        ${isFinal ? 'Final' : '…'}
      </span>
    </div>
    ${seriesBadge}

    <div class="mc-teams">
      <div class="mc-team">
        <span class="mc-team__abbr">${match.home_team?.abbreviation ?? '—'}</span>
        <span class="mc-team__name">${match.home_team?.name ?? '—'}</span>
        <span class="mc-team__record">${homeRecord}</span>
        <span class="mc-team__odds" id="odds-home-${match.id}">${homeDec ? `<strong>${homeDec}</strong>` : '—'}</span>
        <span class="mc-team__prob" id="motor-home-${match.id}" style="display:none"></span>
      </div>

      <div class="mc-vs">
        ${showScore
          ? `<div class="mc-vs__score">${homeScore}<br><span style="font-size:10px;color:var(--color-text-muted)">–</span><br>${awayScore}</div>`
          : `<span class="mc-vs__label">VS</span>`
        }
        ${oddsSource ? `<span class="mc-source">${oddsSource}</span>` : ''}
      </div>

      <div class="mc-team mc-team--away">
        <span class="mc-team__abbr">${match.away_team?.abbreviation ?? '—'}</span>
        <span class="mc-team__name">${match.away_team?.name ?? '—'}</span>
        <span class="mc-team__record">${awayRecord}</span>
        <span class="mc-team__odds" id="odds-away-${match.id}">${awayDec ? `<strong>${awayDec}</strong>` : '—'}</span>
        <span class="mc-team__prob" id="motor-away-${match.id}" style="display:none"></span>
      </div>
    </div>

    <div id="proba-bar-${match.id}" style="display:none">
      <div class="mc-proba-bar"><div class="mc-proba-bar__fill" id="proba-fill-${match.id}" style="width:50%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <span id="prob-label-home-${match.id}" style="font-size:9px;color:var(--color-text-muted)"></span>
        <span id="prob-label-away-${match.id}" style="font-size:9px;color:var(--color-text-muted)"></span>
      </div>
    </div>

    ${ou != null ? `
    <div class="mc-markets" id="ou-${match.id}">
      <div class="mc-market-row">
        <span class="mc-market-row__label">O/U</span>
        <div class="mc-market-pills">
          <span class="mc-pill mc-pill--line">${ou}</span>
          ${ouOverFmt  ? `<span class="mc-pill"><span class="mc-pill__side">Over</span><span class="mc-pill__sep"> · </span><span class="mc-pill__val">${ouOverFmt}</span></span>`  : ''}
          ${ouUnderFmt ? `<span class="mc-pill"><span class="mc-pill__side">Under</span><span class="mc-pill__sep"> · </span><span class="mc-pill__val">${ouUnderFmt}</span></span>` : ''}
        </div>
      </div>
      <div id="spread-row-${match.id}" style="display:none" class="mc-market-row mc-market-row--spread"></div>
    </div>` : ''}

    <div id="proba-${match.id}" style="display:none"></div>
    <div id="edge-${match.id}" style="display:none">
      <span id="edge-val-${match.id}"></span>
      <span id="quality-val-${match.id}"></span>
    </div>

    <div id="level-${match.id}" style="display:none"></div>
    <div id="best-rec-${match.id}" style="display:none"></div>
    <div id="recs-${match.id}" class="match-card__recs" style="display:none"></div>
    <div id="bet-indicator-${match.id}" style="margin-top:6px"></div>
  `;

  card.style.cursor = 'pointer';
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    router.navigate('match', { matchId: card.dataset.matchId, analysisId: card.dataset.analysisId || null });
  });

  return card;
}

function _updateMatchCard(list, matchId, analysis, match, ptState) {
  const decision = analysis.decision ?? _legacyDecision(analysis);
  const card = list.querySelector(`[data-match-id="${matchId}"]`);
  if (!card) return;

  const badge = card.querySelector(`#badge-${matchId}`);
  if (badge) {
    const cfg = _decisionConfig(decision);
    badge.className = `match-card__status-badge badge ${cfg.cssClass}`;
    if (decision === 'ANALYSER') {
      badge.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:4px;vertical-align:middle;animation:mbp-pulse 1.5s ease-in-out infinite"></span>${cfg.label}`;
    } else {
      badge.textContent = cfg.label;
    }
  }

  card.dataset.analysisId = analysis.analysis_id ?? '';

  const borderColors = { ANALYSER: 'var(--color-success)', EXPLORER: 'var(--color-warning)' };
  const borderColor = borderColors[decision];
  if (borderColor) card.style.borderLeft = `3px solid ${borderColor}`;

  if (analysis.predictive_score !== null && analysis.predictive_score !== undefined) {
    const homeProb = Math.round(analysis.predictive_score * 100);
    const awayProb = 100 - homeProb;
    const isFavHome = homeProb > awayProb;

    const oddsHomeEl = card.querySelector(`#odds-home-${matchId}`);
    const oddsAwayEl = card.querySelector(`#odds-away-${matchId}`);
    if (oddsHomeEl) {
      oddsHomeEl.style.color = isFavHome ? 'var(--color-text-primary)' : 'var(--color-text-muted)';
      if (isFavHome) oddsHomeEl.style.fontWeight = '800';
    }
    if (oddsAwayEl) {
      oddsAwayEl.style.color = !isFavHome ? 'var(--color-text-primary)' : 'var(--color-text-muted)';
      if (!isFavHome) oddsAwayEl.style.fontWeight = '800';
    }

    const motorHomeEl = card.querySelector(`#motor-home-${matchId}`);
    const motorAwayEl = card.querySelector(`#motor-away-${matchId}`);
    if (motorHomeEl) {
      motorHomeEl.textContent = `${homeProb}% analyse`;
      motorHomeEl.className = `mc-team__prob${isFavHome ? ' mc-team__prob--fav' : ''}`;
      motorHomeEl.style.display = '';
    }
    if (motorAwayEl) {
      motorAwayEl.textContent = `${awayProb}% analyse`;
      motorAwayEl.className = `mc-team__prob${!isFavHome ? ' mc-team__prob--fav' : ''}`;
      motorAwayEl.style.display = '';
    }

    const probaBarEl = card.querySelector(`#proba-bar-${matchId}`);
    const probaFillEl = card.querySelector(`#proba-fill-${matchId}`);
    if (probaBarEl && probaFillEl) {
      probaFillEl.style.width = `${homeProb}%`;
      probaBarEl.style.display = '';
    }
  }

  const netRating = analysis.variables_used?.net_rating_diff?.value;
  const levelEl = card.querySelector(`#level-${matchId}`);
  if (levelEl && netRating != null) {
    const absVal = Math.abs(netRating);
    const domTeam = netRating > 0 ? (match?.home_team?.abbreviation ?? 'DOM') : (match?.away_team?.abbreviation ?? 'EXT');

    let label, color, bg;
    if (absVal < 2)       { label = 'Niveau équivalent'; color = 'var(--color-text-muted)'; bg = 'rgba(255,255,255,0.04)'; }
    else if (absVal < 4)  { label = `Léger avantage ${domTeam}`; color = 'var(--color-warning)'; bg = 'rgba(245,158,11,0.08)'; }
    else if (absVal < 7)  { label = `Avantage ${domTeam}`; color = 'var(--color-warning)'; bg = 'rgba(245,158,11,0.08)'; }
    else if (absVal < 10) { label = `Domination ${domTeam}`; color = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)'; bg = netRating > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'; }
    else                  { label = `Mismatch total — ${domTeam}`; color = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)'; bg = netRating > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'; }

    const quality = analysis.data_quality_score != null ? Math.round(analysis.data_quality_score * 100) : null;
    const qColor  = quality == null ? 'var(--color-text-muted)' : quality >= 80 ? '#22c55e' : quality >= 60 ? '#f97316' : '#ef4444';
    const qBadge  = quality != null ? `<span style="margin-left:auto;font-size:10px;font-weight:600;color:${qColor}">● ${quality}%</span>` : '';

    levelEl.className = 'mc-level';
    levelEl.style.cssText = `color:${color};background:${bg}`;
    levelEl.innerHTML = `<span class="mc-level__dot"></span><span>${label}</span>${qBadge}`;
    levelEl.style.display = '';
  }

  const spreadRowEl = card.querySelector(`#spread-row-${matchId}`);
  if (spreadRowEl) {
    const marketOdds   = match?.market_odds ?? null;
    const espnOdds     = match?.odds ?? {};
    const spreadLine   = espnOdds.spread ?? marketOdds?.spread_line ?? null;
    const homeSprdDec  = marketOdds?.home_spread_decimal ?? null;
    const awaySprdDec  = marketOdds?.away_spread_decimal ?? null;

    if (spreadLine != null) {
      const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
      const awayAbv = match?.away_team?.abbreviation ?? 'EXT';
      const homeSprdFmt = spreadLine <= 0 ? `${homeAbv} ${spreadLine}` : `${homeAbv} +${spreadLine}`;
      const awaySprdFmt = spreadLine <= 0 ? `${awayAbv} +${Math.abs(spreadLine)}` : `${awayAbv} -${spreadLine}`;

      spreadRowEl.innerHTML = `
        <span class="mc-market-row__label">Hcap</span>
        <div class="mc-market-pills">
          <span class="mc-pill"><span class="mc-pill__side">${homeSprdFmt}</span>${homeSprdDec ? `<span class="mc-pill__sep"> · </span><span class="mc-pill__val">${Number(homeSprdDec).toFixed(2)}</span>` : ''}</span>
          <span class="mc-pill"><span class="mc-pill__side">${awaySprdFmt}</span>${awaySprdDec ? `<span class="mc-pill__sep"> · </span><span class="mc-pill__val">${Number(awaySprdDec).toFixed(2)}</span>` : ''}</span>
        </div>`;
      spreadRowEl.style.display = '';
    }
  }

  if (!card.querySelector('.mbp-weight-warning')) {
    const coverage = analysis.weight_coverage;
    if (coverage !== null && coverage !== undefined && coverage < 0.75) {
      const LABELS = {
        recent_form_ema: 'forme récente', net_rating_diff: 'net rating',
        absences_impact: 'blessures',     home_away_split: 'split dom/ext',
        efg_diff: 'efficacité tir',       back_to_back: 'back-to-back',
        rest_days_diff: 'repos',          win_pct_diff: 'bilan saison',
        defensive_diff: 'défense',
      };
      const missing = analysis.missing_variables ?? [];
      const missingLabels = missing.map(id => LABELS[id] ?? id).slice(0, 3).join(', ');
      const warn = document.createElement('div');
      warn.className = 'mbp-weight-warning';
      warn.title = `Données manquantes : ${missingLabels || 'inconnues'}`;
      warn.textContent = `⚠ Données partielles (${Math.round(coverage * 100)}%)`;
      const levelEl2 = card.querySelector(`#level-${matchId}`);
      if (levelEl2) levelEl2.after(warn);
    }
  }

  const bestRecEl = card.querySelector(`#best-rec-${matchId}`);
  const best = analysis.betting_recommendations?.best;
  if (bestRecEl && best?.edge != null) {
    const typeLabel = best.type === 'MONEYLINE' ? 'Vainqueur'
                    : best.type === 'SPREAD' ? 'Handicap'
                    : best.type === 'PLAYER_POINTS' ? 'Props'
                    : 'O/U';
    const sideLabel = best.type === 'MONEYLINE'
      ? (best.side === 'HOME' ? match?.home_team?.abbreviation : match?.away_team?.abbreviation)
      : best.type === 'SPREAD'
      ? (best.side === 'HOME'
          ? `${match?.home_team?.abbreviation ?? ''} ${best.spread_line > 0 ? '+' : ''}${best.spread_line}`
          : `${match?.away_team?.abbreviation ?? ''} ${-best.spread_line > 0 ? '+' : ''}${-best.spread_line}`)
      : best.type === 'PLAYER_POINTS'
      ? `${best.player} ${best.side === 'OVER' ? '+' : '−'}${best.line}`
      : best.side === 'OVER'
        ? `Plus de ${best.ou_line ?? best.market_total ?? '—'} pts`
        : `Moins de ${best.ou_line ?? best.market_total ?? '—'} pts`;

    const decOdds = best.odds_decimal ?? (best.odds_line > 0 ? (best.odds_line / 100 + 1) : (1 - 100 / best.odds_line));
    const fmtOdds = Number(decOdds).toFixed(2);
    const edgeColor = best.edge >= 12 ? 'var(--color-success)' : best.edge >= 7 ? 'var(--color-warning)' : 'var(--color-text-muted)';
    const dataQ = analysis.data_quality_score ?? 0;
    const divFlag = analysis.market_divergence?.flag ?? 'low';
    const isGoodRec = best.edge >= 7 && dataQ >= 0.80 && divFlag !== 'critical' && !best.is_contrarian;
    const recClass = isGoodRec ? 'mc-best-rec--value' : best.edge >= 5 ? 'mc-best-rec--warn' : '';

    bestRecEl.className = `mc-best-rec ${recClass}`;
    bestRecEl.innerHTML = `
      <span class="mc-best-rec__star">${isGoodRec ? '★' : '·'}</span>
      <span class="mc-best-rec__label">${typeLabel}</span>
      <span class="mc-best-rec__side">${sideLabel}${best.is_contrarian ? ' <span style="font-size:9px;color:var(--color-warning)">(contrarian)</span>' : ''}</span>
      <span class="mc-best-rec__odds">${fmtOdds}</span>
      <span class="mc-best-rec__edge" style="color:${edgeColor}">+${best.edge}%</span>
    `;
    bestRecEl.style.display = '';
  }

  const betIndicatorEl = card.querySelector(`#bet-indicator-${matchId}`);
  if (betIndicatorEl && ptState && !betIndicatorEl.querySelector('.mbp-open-bet-indicator')) {
    const pendingIndex = _buildPendingIndex(ptState);
    const pendingBets = pendingIndex[matchId] ?? [];
    if (pendingBets.length > 0) {
      const totalStake = pendingBets.reduce((s, b) => s + (b.stake || 0), 0);
      const markets = pendingBets.map(b => b.market === 'MONEYLINE' ? 'ML' : b.market === 'SPREAD' ? 'Hcap' : b.market === 'PLAYER_POINTS' ? 'Props' : 'O/U').join(' · ');
      const dot = document.createElement('div');
      dot.className = 'mbp-open-bet-indicator';
      dot.innerHTML = `<span class="mbp-bet-dot"></span>${pendingBets.length} pari${pendingBets.length > 1 ? 's' : ''} en cours <span style="opacity:0.6;font-weight:400">(${markets} · ${totalStake.toFixed(0)}€)</span>`;
      betIndicatorEl.appendChild(dot);
    }
  }

  if (!card.querySelector('.match-card__rejection')) {
    const hasReason = analysis.rejection_reason || analysis.insuffisant_reason;
    if (hasReason) {
      const el = document.createElement('div');
      el.className = 'match-card__rejection text-muted';
      el.textContent = `↳ ${analysis.rejection_reason ? _formatRejection(analysis.rejection_reason) : analysis.insuffisant_reason}`;
      bestRecEl?.after(el);
    }
  }
}

function _updateSummary(container, total, conclusive, rejected) {
  const t = container.querySelector('#summary-total .summary-card__value');
  const c = container.querySelector('#summary-conclusive .summary-card__value');
  const r = container.querySelector('#summary-rejected .summary-card__value');
  if (t) t.textContent = total;
  if (c) c.textContent = conclusive;
  if (r) r.textContent = rejected;
}

function _renderBestOpportunity(container, matches, analysisIndex) {
  const el = container.querySelector('#best-opportunity');
  if (!el) return;

  let bestMatch = null, bestAnalysis = null, bestEdge = 0, bestScore = 0;
  matches.forEach(m => {
    const a = analysisIndex[m.id];
    if (!a?.betting_recommendations?.best) return;
    const best = a.betting_recommendations.best;
    const edge = best.edge ?? 0;
    if (edge < 5) return;

    const quality = a.data_quality_score ?? 0.5;
    const divergence = a.market_divergence?.flag ?? 'low';
    const divPenalty = divergence === 'critical' ? 0.5 : divergence === 'high' ? 0.3 : 0;
    const mlPenalty = best.type === 'MONEYLINE' && Math.abs(edge) > 10 ? 0.2 : 0;
    const score = edge * quality * (1 - divPenalty) * (1 - mlPenalty);

    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
      bestMatch = m;
      bestAnalysis = a;
    }
  });

  if (!bestMatch || bestEdge < 5) {
    el.style.display = 'none';
    return;
  }

  const best = bestAnalysis.betting_recommendations.best;
  const SIDE_MAP = {
    OVER:  `Plus de ${best.ou_line ?? best.market_total ?? '—'} pts`,
    AWAY:  bestMatch.away_team?.name,
    HOME:  bestMatch.home_team?.name,
    UNDER: `Moins de ${best.ou_line ?? best.market_total ?? '—'} pts`,
  };
  const sideLabel = SIDE_MAP[best.side] ?? best.side;
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
          <div style="font-size:15px;font-weight:700">${bestMatch.home_team?.abbreviation} vs ${bestMatch.away_team?.abbreviation}</div>
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

function _bindDateSelector(container, storeInstance, initialDate, onDateChange) {
  const selector = container.querySelector('#date-selector');
  const picker   = container.querySelector('#date-picker');
  if (!selector) return;

  selector.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-date]');
    if (!chip) return;
    const newDate = chip.dataset.date;
    selector.querySelectorAll('.chip[data-date]').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    if (picker) picker.value = newDate;
    onDateChange(newDate);
  });

  if (picker) {
    picker.addEventListener('change', (e) => {
      selector.querySelectorAll('.chip[data-date]').forEach(c => c.classList.remove('chip--active'));
      onDateChange(e.target.value);
    });
  }
}

function _bindFilterEvents(container, storeInstance, onSportChange) {
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
      const currentSport = _getSelectedSport(storeInstance);
      const nextSport = chip.dataset.sport;
      if (nextSport !== currentSport && typeof onSportChange === 'function') {
        void onSportChange(nextSport);
      }
      return;
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

    if (filterType === 'decision' && value !== 'ALL') {
      const dec = analysis?.decision ?? _legacyDecision(analysis);
      visible = dec === value;
    }

    if (filterType === 'edge' && value !== '0') {
      const minEdge = parseInt(value, 10);
      const bestEdge = analysis?.betting_recommendations?.best?.edge ?? 0;
      visible = bestEdge >= minEdge;
    }

    if (filterType === 'bets' && value === 'OPEN') {
      try {
        const pts = _loadPaperState();
        const pendingMatchIds = new Set((pts.bets ?? []).filter(b => b.result === 'PENDING').map(b => b.match_id));
        visible = pendingMatchIds.has(matchId);
      } catch {
        visible = false;
      }
    }

    card.style.display = visible ? '' : 'none';
  });
}

function _renderEmptyState(container, selectedSport = 'NBA') {
  const sportLabel = selectedSport === 'MLB' ? 'MLB' : selectedSport === 'TENNIS' ? 'Tennis' : 'NBA';
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">◎</div>
      <div class="empty-state__text">
        Aucun match ${sportLabel} pour cette date.<br>
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

function _loadPaperState() {
  try {
    return JSON.parse(localStorage.getItem('mbp_paper_trading') ?? '{}');
  } catch {
    return {};
  }
}

function _buildPendingIndex(ptState) {
  const index = {};
  (ptState.bets ?? []).forEach(function(b) {
    if (b.result !== 'PENDING' || !b.match_id) return;
    if (!index[b.match_id]) index[b.match_id] = [];
    index[b.match_id].push({
      market: b.market,
      side: b.side,
      side_label: b.side_label,
      stake: b.stake,
      edge: b.edge,
    });
  });
  return index;
}

function _renderCountdown(datetime) {
  if (!datetime) return '';
  const now = Date.now();
  const kickoff = new Date(datetime).getTime();
  const diffMs = kickoff - now;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMs < 0) return '<span class="mbp-countdown mbp-countdown--live">● En cours</span>';
  if (diffMins < 60) return `<span class="mbp-countdown mbp-countdown--soon">Dans ${diffMins} min</span>`;
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

function _getTodayDate() {
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

function _offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function _getSelectedSport(storeInstance) {
  return storeInstance.get('dashboardFilters')?.selectedSport
    ?? storeInstance.get('selectedSport')
    ?? 'NBA';
}

function _syncDashboardSelection(storeInstance, selectedSport) {
  storeInstance.set({
    selectedSport,
    'dashboardFilters.selectedSport': selectedSport,
  });
}
