/**
 * MANI BET PRO — ui.dashboard.js v5.0
 *
 * AJOUTS v4.7 :
 *   - Auto-refresh à 23h30 et 07h00 heure de Paris.
 *     23h30 : rapports blessures définitifs publiés, statuts Questionable confirmés.
 *     07h00 : blessures post-match captées pour les paris du lendemain.
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

// Injecter les styles dynamiques v5 (nouvelle carte)
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

    /* ── COUNTDOWN ── */
    .mbp-countdown {
      font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
      color: var(--color-warning);
      padding: 2px 6px; border-radius: 3px;
      background: rgba(245,158,11,0.10);
    }
    .mbp-countdown--soon { color: var(--color-danger); background: rgba(239,68,68,0.10); }
    .mbp-countdown--live { color: var(--color-success); background: rgba(34,197,94,0.10); animation: mbp-live-pulse 2s ease-in-out infinite; }
    @keyframes mbp-live-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

    /* ── ZONE ÉQUIPES v5 ── */
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
    .mc-team__odds--home { color: var(--color-text-primary); }
    .mc-team__odds--away { color: var(--color-text-primary); }
    .mc-team__odds-src {
      font-size: 9px; font-weight: 400;
      color: var(--color-text-muted);
      display: block; margin-top: 1px;
    }
    .mc-team__prob {
      font-size: 11px; font-weight: 700;
      color: var(--color-text-muted);
      margin-top: 2px;
    }
    .mc-team__prob--fav { color: var(--color-signal); }

    /* Séparateur central */
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

    /* Barre de probabilité v5 */
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

    /* ── NIVEAU / NET RATING ── */
    .mc-level {
      display: flex; align-items: center; gap: 5px;
      padding: 4px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 600;
    }
    .mc-level__dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: currentColor; flex-shrink: 0;
    }

    /* ── MEILLEURE REC ── */
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

    /* ── DONNÉES PARTIELLES ── */
    .mbp-weight-warning {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; font-weight: 600;
      color: var(--color-warning);
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.20);
      padding: 2px 7px; border-radius: 4px;
    }

    /* ── PARIS EN COURS ── */
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

    /* IDs cachés hérités — maintenus pour _updateMatchCard */
    #proba-placeholder { display: none !important; }
  `;
  document.head.appendChild(s);
}

// ── AUTO-REFRESH ──────────────────────────────────────────────────────────

/**
 * v4.7 : Planifie un refresh automatique à 23h30 et 07h00 heure de Paris.
 * Compare l'heure actuelle à la prochaine fenêtre de refresh.
 * Utilise un setTimeout unique — pas de setInterval qui accumulerait les appels.
 *
 * @returns {number} timeoutId — pour nettoyage via clearTimeout
 */
function _scheduleNextRefresh(container, storeInstance) {
  const REFRESH_HOURS_PARIS = [23 * 60 + 30, 7 * 60]; // 23h30 et 07h00 en minutes

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
    await _loadAndDisplay(container, storeInstance, date, { manualRefresh: false });
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
    storeInstance.set({
      'dashboardFilters.selectedDate': newDate,
      dashboardCacheDate: null,   // invalide le cache pour forcer le rechargement
      dashboardCacheAt:   0,
    });
    await _loadAndDisplay(container, storeInstance, newDate);
  });

  // v4.7 : Bouton actualiser manuel
  const refreshBtn = container.querySelector('#refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function() {
      refreshBtn.textContent = '⟳ Actualisation...';
      refreshBtn.disabled = true;
      storeInstance.set({ dashboardCacheAt: 0 });
      await _loadAndDisplay(container, storeInstance, selectedDate, { manualRefresh: true });
      refreshBtn.textContent = '⟳ Actualiser';
      refreshBtn.disabled = false;
    });
  }

  await _loadAndDisplay(container, storeInstance, selectedDate, { manualRefresh: false });

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
    // Lire la date depuis le paramètre `date` — pas depuis le store qui peut ne pas
    // encore être mis à jour quand onDateChange est appelé (ex: bouton Demain).
    const cachedDate     = storeInstance.get('dashboardCacheDate');

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
    const result = await DataOrchestrator.loadAndAnalyze(date, storeInstance, options);

    if (!result?.matches?.length) {
      _renderEmptyState(list);
      _updateSummary(container, 0, 0, 0);
      return;
    }

    // Stocker le timestamp et la date de chargement pour le TTL cache
    storeInstance.set({ dashboardCacheAt: Date.now(), dashboardCacheDate: date });

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
  const time         = match.datetime
    ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const countdownHtml = match.datetime ? _renderCountdown(match.datetime) : '';
  const isTennis      = match.sport === 'TENNIS';
  const homeRecord    = isTennis ? (match.surface ?? '') : (match.home_team?.record ?? '—');
  const awayRecord    = isTennis ? (match.tournament ?? '') : (match.away_team?.record ?? '—');
  const isFinal       = match.status === 'STATUS_FINAL' || match.status === 'STATUS_FINAL_OT';
  const homeScore     = match.home_team?.score;
  const awayScore     = match.away_team?.score;
  const showScore     = isFinal && homeScore != null && awayScore != null;

  // Cotes ML depuis market_odds (Pinnacle) ou odds ESPN
  const marketOdds  = match.market_odds ?? null;
  const pinnacle    = marketOdds?.bookmakers?.find(b => b.key === 'winamax')
                   ?? marketOdds?.bookmakers?.find(b => b.key === 'pinnacle')
                   ?? marketOdds?.bookmakers?.[0]
                   ?? null;
  const espnOdds    = match.odds ?? {};

  function _decToAm(d) { return d >= 2 ? Math.round((d-1)*100) : Math.round(-100/(d-1)); }
  function _fmtML(am) {
    if (am == null) return null;
    return am > 0 ? `+${am}` : String(am);
  }
  function _amToDec(am) {
    if (am == null) return null;
    return am > 0 ? Number((am/100+1).toFixed(2)) : Number((1-100/am).toFixed(2));
  }

  const homeAmRaw = espnOdds.home_ml ?? (pinnacle?.home_ml != null ? _decToAm(pinnacle.home_ml) : null);
  const awayAmRaw = espnOdds.away_ml ?? (pinnacle?.away_ml != null ? _decToAm(pinnacle.away_ml) : null);
  const homeML    = _fmtML(homeAmRaw);
  const awayML    = _fmtML(awayAmRaw);
  const oddsSource = pinnacle ? (pinnacle.key === 'winamax' ? 'Winamax' : 'Pinnacle') : (espnOdds.home_ml != null ? 'ESPN' : null);

  // Spread + O/U pour la ligne d'infos
  const spread = espnOdds.spread != null ? (espnOdds.spread > 0 ? `+${espnOdds.spread}` : String(espnOdds.spread))
               : pinnacle?.spread_line != null ? (pinnacle.spread_line > 0 ? `+${pinnacle.spread_line}` : String(pinnacle.spread_line))
               : null;
  const ou     = espnOdds.over_under ?? pinnacle?.total_line ?? null;

  card.innerHTML = `
    <!-- ── HEADER ── -->
    <div class="match-card__header" style="display:flex;align-items:center;gap:6px">
      <span class="sport-tag ${isTennis ? 'sport-tag--tennis' : 'sport-tag--nba'}">${isTennis ? 'Tennis' : 'NBA'}</span>
      <span style="font-size:11px;color:var(--color-text-muted)">${isFinal ? 'Terminé' : time}</span>
      ${!isFinal ? countdownHtml : ''}
      <span style="margin-left:auto" class="match-card__status-badge badge badge--inconclusive" id="badge-${match.id}">
        ${isFinal ? 'Final' : 'Analyse…'}
      </span>
    </div>

    <!-- ── ÉQUIPES + COTES ── -->
    <div class="mc-teams">

      <!-- Équipe domicile -->
      <div class="mc-team">
        <span class="mc-team__abbr">${match.home_team?.abbreviation ?? '—'}</span>
        <span class="mc-team__name">${match.home_team?.name ?? '—'}</span>
        <span class="mc-team__record">${homeRecord}</span>
        ${homeML ? `
        <span class="mc-team__odds mc-team__odds--home" id="odds-home-${match.id}">${homeML}</span>
        ${oddsSource ? `<span class="mc-team__odds-src">${oddsSource}</span>` : ''}
        ` : `<span class="mc-team__odds" id="odds-home-${match.id}" style="color:var(--color-text-muted)">—</span>`}
        <!-- prob moteur (cachée — mise à jour par _updateMatchCard) -->
        <span class="mc-team__prob" id="motor-home-${match.id}" style="display:none"></span>
        <span style="display:none" id="market-home-${match.id}"></span>
      </div>

      <!-- Séparateur central -->
      <div class="mc-vs">
        ${showScore
          ? `<div class="mc-vs__score">${homeScore}<br><span style="font-size:10px;color:var(--color-text-muted)">–</span><br>${awayScore}</div>`
          : `<span class="mc-vs__label">VS</span>`
        }
        ${ou ? `<span style="font-size:9px;color:var(--color-text-muted);margin-top:2px">O/U ${ou}</span>` : ''}
        ${spread ? `<span style="font-size:9px;color:var(--color-text-muted)">±${spread.replace(/[+-]/g,'')}</span>` : ''}
      </div>

      <!-- Équipe extérieure -->
      <div class="mc-team mc-team--away">
        <span class="mc-team__abbr">${match.away_team?.abbreviation ?? '—'}</span>
        <span class="mc-team__name">${match.away_team?.name ?? '—'}</span>
        <span class="mc-team__record">${awayRecord}</span>
        ${awayML ? `
        <span class="mc-team__odds mc-team__odds--away" id="odds-away-${match.id}">${awayML}</span>
        ${oddsSource ? `<span class="mc-team__odds-src">${oddsSource}</span>` : ''}
        ` : `<span class="mc-team__odds" id="odds-away-${match.id}" style="color:var(--color-text-muted)">—</span>`}
        <span class="mc-team__prob" id="motor-away-${match.id}" style="display:none"></span>
        <span style="display:none" id="market-away-${match.id}"></span>
      </div>
    </div>

    <!-- Barre de probabilité (rendue par _updateMatchCard) -->
    <div id="proba-bar-${match.id}" style="display:none">
      <div class="mc-proba-bar"><div class="mc-proba-bar__fill" id="proba-fill-${match.id}" style="width:50%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <span id="prob-label-home-${match.id}" style="font-size:9px;color:var(--color-text-muted)"></span>
        <span id="prob-label-away-${match.id}" style="font-size:9px;color:var(--color-text-muted)"></span>
      </div>
    </div>

    <!-- Nœuds hérités — conservés pour compatibilité _updateMatchCard -->
    <div id="proba-${match.id}" style="display:none"></div>
    <div id="edge-${match.id}" style="display:none">
      <span id="edge-val-${match.id}"></span>
      <span id="quality-val-${match.id}"></span>
    </div>

    <!-- Niveau / signal principal (injecté par _updateMatchCard) -->
    <div id="level-${match.id}" style="display:none"></div>

    <!-- Meilleure recommandation (rendue par _updateMatchCard) -->
    <div id="best-rec-${match.id}" style="display:none"></div>

    <!-- Paris recommandés supplémentaires -->
    <div id="recs-${match.id}" class="match-card__recs" style="display:none"></div>

    <!-- Footer : paris en cours + CTA -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;gap:8px">
      <div id="bet-indicator-${match.id}"></div>
      <button class="btn btn--ghost match-card__cta" data-match-id="${match.id}" data-analysis-id=""
        style="margin-top:0;width:auto;padding:5px 12px;font-size:11px;flex-shrink:0">
        → Voir analyse
      </button>
    </div>
  `;

  card.querySelector('.match-card__cta').addEventListener('click', (e) => {
    e.stopPropagation();
    router.navigate('match', { matchId: e.currentTarget.dataset.matchId, analysisId: e.currentTarget.dataset.analysisId || null });
  });

  return card;
}

function _updateMatchCard(list, matchId, analysis, match, ptState) {
  const decision = analysis.decision ?? _legacyDecision(analysis);
  const card     = list.querySelector(`[data-match-id="${matchId}"]`);
  if (!card) return;

  // ── 1. Badge décision ────────────────────────────────────────────────────
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

  // ── 2. Bordure gauche selon décision ─────────────────────────────────────
  card.dataset.analysisId = analysis.analysis_id ?? '';
  const cta = card.querySelector('.match-card__cta');
  if (cta) cta.dataset.analysisId = analysis.analysis_id ?? '';

  const borderColors = { ANALYSER: 'var(--color-success)', EXPLORER: 'var(--color-warning)' };
  const borderColor  = borderColors[decision];
  if (borderColor) card.style.borderLeft = `3px solid ${borderColor}`;

  // ── 3. Probabilités + barre + cotes colorées ─────────────────────────────
  if (analysis.predictive_score !== null) {
    const homeProb = Math.round(analysis.predictive_score * 100);
    const awayProb = 100 - homeProb;
    const isFavHome = homeProb > awayProb;

    // Colorier les cotes ML selon le favori moteur
    const oddsHomeEl = card.querySelector(`#odds-home-${matchId}`);
    const oddsAwayEl = card.querySelector(`#odds-away-${matchId}`);
    if (oddsHomeEl) {
      oddsHomeEl.style.color = isFavHome
        ? 'var(--color-text-primary)'
        : 'var(--color-text-muted)';
      if (isFavHome) oddsHomeEl.style.fontWeight = '800';
    }
    if (oddsAwayEl) {
      oddsAwayEl.style.color = !isFavHome
        ? 'var(--color-text-primary)'
        : 'var(--color-text-muted)';
      if (!isFavHome) oddsAwayEl.style.fontWeight = '800';
    }

    // Probabilités sous les équipes
    const motorHomeEl = card.querySelector(`#motor-home-${matchId}`);
    const motorAwayEl = card.querySelector(`#motor-away-${matchId}`);
    if (motorHomeEl) {
      motorHomeEl.textContent = `${homeProb}% analyse`;
      motorHomeEl.className   = `mc-team__prob${isFavHome ? ' mc-team__prob--fav' : ''}`;
      motorHomeEl.style.display = '';
    }
    if (motorAwayEl) {
      motorAwayEl.textContent = `${awayProb}% analyse`;
      motorAwayEl.className   = `mc-team__prob${!isFavHome ? ' mc-team__prob--fav' : ''}`;
      motorAwayEl.style.display = '';
    }

    // Barre de probabilité
    const probaBarEl   = card.querySelector(`#proba-bar-${matchId}`);
    const probaFillEl  = card.querySelector(`#proba-fill-${matchId}`);
    const labelHomeEl  = card.querySelector(`#prob-label-home-${matchId}`);
    const labelAwayEl  = card.querySelector(`#prob-label-away-${matchId}`);
    if (probaBarEl && probaFillEl) {
      probaFillEl.style.width = `${homeProb}%`;
      if (labelHomeEl) labelHomeEl.textContent = `${match?.home_team?.abbreviation ?? 'DOM'} ${homeProb}%`;
      if (labelAwayEl) labelAwayEl.textContent = `${awayProb}% ${match?.away_team?.abbreviation ?? 'EXT'}`;
      probaBarEl.style.display = '';
    }
  }

  // ── 4. Niveau / Net Rating ────────────────────────────────────────────────
  const netRating = analysis.variables_used?.net_rating_diff?.value;
  const levelEl   = card.querySelector(`#level-${matchId}`);
  if (levelEl && netRating != null) {
    const absVal  = Math.abs(netRating);
    const domTeam = netRating > 0
      ? (match?.home_team?.abbreviation ?? 'DOM')
      : (match?.away_team?.abbreviation ?? 'EXT');

    let label, color, bg;
    if (absVal < 2)       { label = 'Niveau équivalent';          color = 'var(--color-text-muted)'; bg = 'rgba(255,255,255,0.04)'; }
    else if (absVal < 4)  { label = `Léger avantage ${domTeam}`;  color = 'var(--color-warning)';    bg = 'rgba(245,158,11,0.08)'; }
    else if (absVal < 7)  { label = `Avantage ${domTeam}`;        color = 'var(--color-warning)';    bg = 'rgba(245,158,11,0.08)'; }
    else if (absVal < 10) { label = `Domination ${domTeam}`;      color = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)'; bg = netRating > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'; }
    else                  { label = `Mismatch total — ${domTeam}`; color = netRating > 0 ? 'var(--color-success)' : 'var(--color-danger)'; bg = netRating > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'; }

    levelEl.className = 'mc-level';
    levelEl.style.cssText = `color:${color};background:${bg}`;
    levelEl.innerHTML = `<span class="mc-level__dot"></span><span>${label}</span>`;
    levelEl.style.display = '';
  }

  // ── 5. Badge warning données partielles ──────────────────────────────────
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
      const missing       = analysis.missing_variables ?? [];
      const missingLabels = missing.map(id => LABELS[id] ?? id).slice(0, 3).join(', ');
      const warn          = document.createElement('div');
      warn.className      = 'mbp-weight-warning';
      warn.title          = `Données manquantes : ${missingLabels || 'inconnues'}`;
      warn.textContent    = `⚠ Données partielles (${Math.round(coverage * 100)}%)`;
      const levelEl2 = card.querySelector(`#level-${matchId}`);
      if (levelEl2) levelEl2.after(warn);
    }
  }

  // ── 6. Meilleure recommandation ───────────────────────────────────────────
  const bestRecEl = card.querySelector(`#best-rec-${matchId}`);
  const best      = analysis.betting_recommendations?.best;

  if (bestRecEl && best?.edge != null) {
    const typeLabel = best.type === 'MONEYLINE' ? 'Vainqueur'
                    : best.type === 'SPREAD'    ? 'Handicap'
                    : 'O/U';

    const sideLabel = best.type === 'MONEYLINE'
      ? (best.side === 'HOME' ? match?.home_team?.abbreviation : match?.away_team?.abbreviation)
      : best.type === 'SPREAD'
      ? (best.side === 'HOME'
          ? `${match?.home_team?.abbreviation ?? ''} ${best.spread_line > 0 ? '+' : ''}${best.spread_line}`
          : `${match?.away_team?.abbreviation ?? ''} ${-best.spread_line > 0 ? '+' : ''}${-best.spread_line}`)
      : best.side === 'OVER'
        ? `Plus de ${best.ou_line ?? best.market_total ?? '—'} pts`
        : `Moins de ${best.ou_line ?? best.market_total ?? '—'} pts`;

    const decOdds = best.odds_decimal ?? (best.odds_line > 0 ? (best.odds_line/100+1) : (1-100/best.odds_line));
    const fmtOdds = Number(decOdds).toFixed(2);

    const edgeColor = best.edge >= 12 ? 'var(--color-success)'
                    : best.edge >= 7  ? 'var(--color-warning)'
                    : 'var(--color-text-muted)';

    // Classe visuelle selon qualité de l'opportunité
    const dataQ     = analysis.data_quality_score ?? 0;
    const divFlag   = analysis.market_divergence?.flag ?? 'low';
    const isGoodRec = best.edge >= 7 && dataQ >= 0.80 && divFlag !== 'critical' && !best.is_contrarian;
    const recClass  = isGoodRec ? 'mc-best-rec--value' : best.edge >= 5 ? 'mc-best-rec--warn' : '';

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

  // ── 7. Paris en cours ─────────────────────────────────────────────────────
  const betIndicatorEl = card.querySelector(`#bet-indicator-${matchId}`);
  if (betIndicatorEl && ptState && !betIndicatorEl.querySelector('.mbp-open-bet-indicator')) {
    const pendingIndex = _buildPendingIndex(ptState);
    const pendingBets  = pendingIndex[matchId] ?? [];
    if (pendingBets.length > 0) {
      const totalStake = pendingBets.reduce((s, b) => s + (b.stake || 0), 0);
      const markets    = pendingBets.map(b => b.market === 'MONEYLINE' ? 'ML' : b.market === 'SPREAD' ? 'Hcap' : 'O/U').join(' · ');
      const dot        = document.createElement('div');
      dot.className    = 'mbp-open-bet-indicator';
      dot.innerHTML    = `<span class="mbp-bet-dot"></span>${pendingBets.length} pari${pendingBets.length > 1 ? 's' : ''} en cours <span style="opacity:0.6;font-weight:400">(${markets} · ${totalStake.toFixed(0)}€)</span>`;
      betIndicatorEl.appendChild(dot);
    }
  }

  // ── 8. Motif de rejet ─────────────────────────────────────────────────────
  if (!card.querySelector('.match-card__rejection')) {
    const hasReason = analysis.rejection_reason || analysis.insuffisant_reason;
    if (hasReason) {
      const el     = document.createElement('div');
      el.className = 'match-card__rejection text-muted';
      el.textContent = `↳ ${analysis.rejection_reason ? _formatRejection(analysis.rejection_reason) : analysis.insuffisant_reason}`;
      bestRecEl?.after(el);
    }
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

  let bestMatch = null, bestAnalysis = null, bestEdge = 0, bestScore = 0;

  matches.forEach(m => {
    const a = analysisIndex[m.id];
    if (!a?.betting_recommendations?.best) return;
    const best = a.betting_recommendations.best;
    const edge = best.edge ?? 0;
    if (edge < 5) return;

    // Score composite : edge pondéré par qualité données + pénalité divergence forte
    const quality    = a.data_quality_score ?? 0.5;
    const divergence = a.market_divergence?.flag ?? 'low';
    const divPenalty = divergence === 'critical' ? 0.5
                     : divergence === 'high'     ? 0.3
                     : 0;
    // Favoriser les marchés O/U et Spread plutôt que ML avec grand écart
    const mlPenalty  = best.type === 'MONEYLINE' && Math.abs(edge) > 10 ? 0.2 : 0;
    const score = edge * quality * (1 - divPenalty) * (1 - mlPenalty);

    if (score > bestScore) {
      bestScore = score; bestEdge = edge; bestMatch = m; bestAnalysis = a;
    }
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
  // Utilise l'heure locale Paris (Europe/Paris) pour éviter le décalage UTC.
  // Sans ça, après minuit heure de Paris mais avant 2h UTC, la date retournée
  // est celle d'hier → les matchs NBA de la nuit restent affichés au lieu de ceux du lendemain.
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  // fr-CA retourne le format YYYY-MM-DD nativement
}

function _offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
