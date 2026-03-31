/**
 * MANI BET PRO — ui.dashboard.js v2
 *
 * Vue Dashboard.
 * Source données : ESPN (matchs + stats) + PDF NBA (injuries) + BallDontLie (forme récente).
 * Aucune donnée fictive — état vide si aucune donnée disponible.
 */

import { router }      from './ui.router.js';
import { ProviderNBA } from '../providers/provider.nba.js';
import { EngineCore }  from '../engine/engine.core.js';
import { Logger }      from '../utils/utils.logger.js';

// ── HELPERS ───────────────────────────────────────────────────────────────

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentNBASeason() {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();
  return month >= 10 ? String(year) : String(year - 1);
}

// ESPN Team ID → BallDontLie Team ID mapping
// Nécessaire car les deux APIs utilisent des IDs différents
const ESPN_TO_BDL_ID = {
  '1':  '1',   // Atlanta Hawks
  '2':  '2',   // Boston Celtics
  '3':  '3',   // Brooklyn Nets
  '4':  '5',   // Charlotte Hornets
  '5':  '6',   // Chicago Bulls
  '6':  '7',   // Cleveland Cavaliers
  '7':  '8',   // Dallas Mavericks
  '8':  '9',   // Denver Nuggets
  '9':  '10',  // Detroit Pistons
  '10': '11',  // Golden State Warriors
  '11': '12',  // Houston Rockets
  '12': '13',  // Indiana Pacers
  '13': '14',  // LA Clippers
  '14': '16',  // Los Angeles Lakers
  '15': '17',  // Memphis Grizzlies
  '16': '18',  // Miami Heat — ESPN ID=14, BDL ID=16
  '17': '19',  // Milwaukee Bucks
  '18': '20',  // Minnesota Timberwolves
  '19': '21',  // New Orleans Pelicans
  '20': '22',  // New York Knicks
  '21': '23',  // Oklahoma City Thunder
  '22': '24',  // Orlando Magic
  '23': '25',  // Philadelphia 76ers
  '24': '26',  // Phoenix Suns
  '25': '27',  // Portland Trail Blazers
  '26': '28',  // Sacramento Kings
  '27': '29',  // San Antonio Spurs
  '28': '30',  // Toronto Raptors
  '29': '31',  // Utah Jazz
  '30': '32',  // Washington Wizards
};

// Mapping ESPN ID → BDL ID — correction pour le vrai mapping
// ESPN utilise des IDs non standards, BDL utilise les IDs officiels
const ESPN_ID_TO_BDL = {
  // Format : ESPN_ID: BDL_ID
  '1':  '1',   // ATL Hawks
  '2':  '2',   // BOS Celtics
  '3':  '17',  // BKN Nets (ESPN=3, BDL=17)
  '4':  '4',   // CHA Hornets (ESPN=4, BDL=4 — à vérifier)
  '5':  '5',   // CHI Bulls
  '6':  '6',   // CLE Cavaliers
  '7':  '7',   // DAL Mavericks
  '8':  '8',   // DEN Nuggets (ESPN=8, BDL=8)
  '9':  '9',   // DET Pistons
  '10': '10',  // GSW Warriors
  '11': '11',  // HOU Rockets
  '12': '12',  // IND Pacers
  '13': '13',  // LAC Clippers
  '14': '14',  // LAL Lakers
  '15': '15',  // MEM Grizzlies
  '16': '16',  // MIA Heat
  '17': '17',  // MIL Bucks — à vérifier
  '18': '18',  // MIN Timberwolves
  '19': '19',  // NOP Pelicans
  '20': '20',  // NYK Knicks
  '21': '21',  // OKC Thunder
  '22': '22',  // ORL Magic
  '23': '23',  // PHI 76ers
  '24': '24',  // PHX Suns
  '25': '25',  // POR Trail Blazers
  '26': '26',  // SAC Kings
  '24': '27',  // SAS Spurs (ESPN=24, BDL=27)
  '28': '28',  // TOR Raptors
  '26': '29',  // UTA Jazz (ESPN=26, BDL=29)
  '27': '30',  // WAS Wizards
};

// ── RENDER ────────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  container.innerHTML = renderShell();
  bindFilterEvents(container, storeInstance);
  await loadMatches(container, storeInstance);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell() {
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return `
    <div class="dashboard">

      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Dashboard</div>
        <div class="page-header__sub">${today}</div>
      </div>

      <!-- Résumé du jour -->
      <div class="dashboard__summary" id="day-summary">
        <div class="summary-card" id="summary-total">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Matchs chargés</div>
        </div>
        <div class="summary-card summary-card--success" id="summary-conclusive">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Concluants</div>
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
          <span class="filter-label">Statut</span>
          <div class="filter-chips" id="filter-status">
            <button class="chip chip--active" data-status="ALL">Tous</button>
            <button class="chip" data-status="CONCLUSIVE">Concluants</button>
            <button class="chip" data-status="INCONCLUSIVE">Inconclus</button>
          </div>
        </div>
      </div>

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

// ── CHARGEMENT DES MATCHS ─────────────────────────────────────────────────

async function loadMatches(container, storeInstance) {
  const list = container.querySelector('#matches-list');

  try {
    const date = getTodayDate();

    // 1. Charger les matchs ESPN (avec stats et cotes intégrées)
    const espnData = await ProviderNBA.getMatchesToday(date);

    if (!espnData?.matches?.length) {
      renderEmptyState(list);
      updateSummary(container, 0, 0, 0);
      return;
    }

    // 2. Charger l'injury report du jour (PDF NBA officiel, async)
    const injuryPromise = ProviderNBA.getInjuryReport(date);

    // 3. Stocker dans le store et afficher les cartes
    espnData.matches.forEach(match => {
      storeInstance.upsert('matches', match.id, { ...match, sport: 'NBA' });
    });

    renderMatchCards(list, espnData.matches, storeInstance);

    // 4. Attendre les injuries et analyser
    const injuryReport = await injuryPromise;
    await analyzeMatchesBatch(list, espnData.matches, storeInstance, container, date, injuryReport);

  } catch (err) {
    Logger.error('DASHBOARD_LOAD_ERROR', { message: err.message });
    renderError(list);
  }
}

// ── ANALYSE EN LOT ────────────────────────────────────────────────────────

async function analyzeMatchesBatch(list, matches, storeInstance, container, date, injuryReport) {
  let conclusive = 0;
  let rejected   = 0;
  const season   = getCurrentNBASeason();

  // Charger la forme récente pour toutes les équipes en parallèle
  // BallDontLie utilise ses propres IDs — on map depuis ESPN
  const teamIds = new Set();
  matches.forEach(m => {
    const homeId = getBDLId(m.home_team?.espn_id);
    const awayId = getBDLId(m.away_team?.espn_id);
    if (homeId) teamIds.add(homeId);
    if (awayId) teamIds.add(awayId);
  });

  // Charger forme récente en parallèle (max 10 équipes)
  const recentForms = {};
  await Promise.allSettled(
    [...teamIds].slice(0, 20).map(async (bdlId) => {
      const form = await ProviderNBA.getRecentForm(bdlId, season, 10);
      if (form) recentForms[bdlId] = form;
    })
  );

  // Analyser chaque match
  for (const match of matches) {
    try {
      const rawData = buildRawData(match, recentForms, injuryReport);
      const analysis = EngineCore.compute('NBA', rawData);

      storeInstance.upsert('analyses', analysis.analysis_id, {
        ...analysis,
        match_id: match.id,
      });

      // Sauvegarder dans l'historique (max 100 entrées)
      if (analysis.confidence_level !== 'INCONCLUSIVE') {
        storeInstance.push('history', {
          analysis_id:       analysis.analysis_id,
          match_id:          match.id,
          date:              date,
          home:              match.home_team?.name ?? '—',
          away:              match.away_team?.name ?? '—',
          sport:             'NBA',
          confidence_level:  analysis.confidence_level,
          predictive_score:  analysis.predictive_score,
          robustness_score:  analysis.robustness_score,
          saved_at:          new Date().toISOString(),
        }, 100);
      }

      updateMatchCard(list, match.id, analysis);

      if (analysis.confidence_level === 'INCONCLUSIVE') rejected++;
      else conclusive++;

      updateSummary(container, matches.length, conclusive, rejected);

    } catch (err) {
      Logger.warn('MATCH_ANALYSIS_ERROR', { matchId: match.id, message: err.message });
    }
  }
}

// ── CONSTRUCTION DES DONNÉES BRUTES ──────────────────────────────────────

/**
 * Construit le rawData pour le moteur NBA depuis les données ESPN + BDL + injuries.
 * Les stats ESPN sont directement dans le match.
 */
function buildRawData(match, recentForms, injuryReport) {
  const homeESPNId = match.home_team?.espn_id;
  const awayESPNId = match.away_team?.espn_id;
  const homeBDLId  = getBDLId(homeESPNId);
  const awayBDLId  = getBDLId(awayESPNId);
  const homeTeamName = match.home_team?.name;
  const awayTeamName = match.away_team?.name;

  // Stats ESPN directement dans le match
  const homeStats = match.home_season_stats ?? null;
  const awayStats = match.away_season_stats ?? null;

  // Forme récente BallDontLie
  const homeRecent = homeBDLId ? recentForms[homeBDLId] ?? null : null;
  const awayRecent = awayBDLId ? recentForms[awayBDLId] ?? null : null;

  // Injuries depuis le PDF NBA officiel
  const homeInjuries = injuryReport && homeTeamName
    ? ProviderNBA.getInjuriesForTeam(injuryReport, homeTeamName)
    : null;
  const awayInjuries = injuryReport && awayTeamName
    ? ProviderNBA.getInjuriesForTeam(injuryReport, awayTeamName)
    : null;

  return {
    match_id:         match.id,
    home_season_stats: homeStats,
    away_season_stats: awayStats,
    home_recent:      homeRecent,
    away_recent:      awayRecent,
    home_injuries:    homeInjuries?.length > 0 ? homeInjuries : null,
    away_injuries:    awayInjuries?.length > 0 ? awayInjuries : null,
    odds:             match.odds ?? null,
    absences_confirmed: injuryReport !== null,
  };
}

/**
 * Convertit ESPN Team ID → BallDontLie Team ID.
 * Mapping approximatif — à affiner si des erreurs apparaissent.
 */
function getBDLId(espnId) {
  if (!espnId) return null;
  const id = String(espnId);
  return ESPN_ID_TO_BDL[id] ?? id;
}

// ── RENDU DES CARTES ─────────────────────────────────────────────────────

function renderMatchCards(list, matches, storeInstance) {
  list.innerHTML = '';
  if (!matches.length) { renderEmptyState(list); return; }

  const frag = document.createDocumentFragment();
  matches.forEach(match => frag.appendChild(createMatchCard(match)));
  list.appendChild(frag);
}

function createMatchCard(match) {
  const card = document.createElement('div');
  card.className      = 'match-card';
  card.dataset.matchId = match.id;

  // Heure locale depuis le datetime ESPN
  const time = match.datetime
    ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  // eFG% et win% depuis les stats ESPN
  const homeEfg   = match.home_season_stats?.efg_pct;
  const awayEfg   = match.away_season_stats?.efg_pct;
  const homeWin   = match.home_season_stats?.win_pct;
  const awayWin   = match.away_season_stats?.win_pct;
  const homeRecord = match.home_team?.record ?? '—';
  const awayRecord = match.away_team?.record ?? '—';

  // Cotes
  const odds = match.odds;
  const spread = odds?.spread !== null && odds?.spread !== undefined
    ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread))
    : '—';
  const ou = odds?.over_under ?? '—';

  card.innerHTML = `
    <div class="match-card__header">
      <span class="sport-tag sport-tag--nba">NBA</span>
      <span class="match-card__time text-muted">${time}</span>
      <span class="match-card__status-badge badge badge--inconclusive" id="status-${match.id}">
        Analyse…
      </span>
    </div>

    <div class="match-card__teams">
      <div class="match-card__team">
        <span class="match-card__team-abbr">${match.home_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.home_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${homeRecord}</span>
      </div>
      <div class="match-card__vs">VS</div>
      <div class="match-card__team match-card__team--away">
        <span class="match-card__team-abbr">${match.away_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.away_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${awayRecord}</span>
      </div>
    </div>

    <!-- Stats ESPN inline -->
    <div class="match-card__stats-inline text-muted" style="font-size:11px; display:flex; gap:12px; margin-bottom:8px;">
      ${homeEfg !== null ? `<span>eFG% ${toP(homeEfg)} / ${toP(awayEfg)}</span>` : ''}
      ${homeWin !== null ? `<span>Win% ${toP(homeWin)} / ${toP(awayWin)}</span>` : ''}
      ${odds ? `<span class="mono">Spread ${spread} · O/U ${ou}</span>` : ''}
    </div>

    <!-- Barres de scores — remplies après analyse -->
    <div class="match-card__scores" id="scores-${match.id}">
      <div class="score-bar score-bar--signal">
        <div class="score-bar__header">
          <span class="score-bar__label">Signal</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
      <div class="score-bar score-bar--robust">
        <div class="score-bar__header">
          <span class="score-bar__label">Robustesse</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
    </div>

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

function toP(v) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function updateMatchCard(list, matchId, analysis) {
  const badge  = list.querySelector(`#status-${matchId}`);
  const scores = list.querySelector(`#scores-${matchId}`);
  if (!badge || !scores) return;

  const interp  = EngineCore.interpretConfidence(analysis.confidence_level);
  badge.textContent = interp.label;
  badge.className   = `match-card__status-badge badge ${interp.cssClass}`;

  const bars = scores.querySelectorAll('.score-bar');

  if (bars[0] && analysis.predictive_score !== null) {
    const pct = Math.round(analysis.predictive_score * 100);
    bars[0].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[0].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[0].querySelector('.score-bar__value').className   = 'score-bar__value mono text-signal';
  }

  if (bars[1] && analysis.robustness_score !== null) {
    const pct = Math.round(analysis.robustness_score * 100);
    const cls = pct >= 75 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-danger';
    bars[1].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[1].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[1].querySelector('.score-bar__value').className   = `score-bar__value mono ${cls}`;
    bars[1].querySelector('.score-bar__fill').style.background =
      pct >= 75 ? 'var(--color-robust-high)'
      : pct >= 50 ? 'var(--color-robust-mid)'
      : 'var(--color-robust-low)';
  }

  if (analysis.rejection_reason) {
    const el = document.createElement('div');
    el.className   = 'match-card__rejection text-muted';
    el.textContent = `↳ ${formatRejectionReason(analysis.rejection_reason)}`;
    scores.after(el);
  }
}

// ── RÉSUMÉ ────────────────────────────────────────────────────────────────

function updateSummary(container, total, conclusive, rejected) {
  const t = container.querySelector('#summary-total .summary-card__value');
  const c = container.querySelector('#summary-conclusive .summary-card__value');
  const r = container.querySelector('#summary-rejected .summary-card__value');
  if (t) t.textContent = total;
  if (c) c.textContent = conclusive;
  if (r) r.textContent = rejected;
}

// ── FILTRES ───────────────────────────────────────────────────────────────

function bindFilterEvents(container, storeInstance) {
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const parent = chip.closest('.filter-chips');
    if (!parent) return;
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    const sport  = chip.dataset.sport;
    const status = chip.dataset.status;
    if (sport)  applyFilter(container, storeInstance, 'sport', sport);
    if (status) applyFilter(container, storeInstance, 'status', status);
  });
}

function applyFilter(container, storeInstance, filterType, value) {
  container.querySelectorAll('.match-card').forEach(card => {
    const matchId  = card.dataset.matchId;
    const match    = storeInstance.get('matches')?.[matchId];
    const analyses = storeInstance.get('analyses') ?? {};
    const analysis = Object.values(analyses).find(a => a.match_id === matchId);

    let visible = true;
    if (filterType === 'sport' && value !== 'ALL') visible = match?.sport === value;
    if (filterType === 'status' && value !== 'ALL') {
      if (!analysis) visible = false;
      else if (value === 'CONCLUSIVE')   visible = analysis.confidence_level !== 'INCONCLUSIVE';
      else if (value === 'INCONCLUSIVE') visible = analysis.confidence_level === 'INCONCLUSIVE';
    }
    card.style.display = visible ? '' : 'none';
  });
}

// ── ÉTATS VIDES ───────────────────────────────────────────────────────────

function renderEmptyState(container) {
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

function renderError(container) {
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

function formatRejectionReason(reason) {
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
