/**
 * MANI BET PRO — data.orchestrator.js v3.10.1
 *
 * AJOUTS v3.10.1 :
 *   - Suppression _enrichInjuriesWithAI() (zombie v3.6) — élimine risque N appels Claude/soir.
 *   - Cache mémoire session _aiContextMemCache — 0 appel worker si même date déjà chargée.
 *   - Commentaires "cache 12h" corrigés → "cache 6h KV".
 *
 * AJOUTS v3.10 :
 *   - _loadTeamDetail(homeAbv, awayAbv) : charge /nba/team-detail depuis le worker.
 *     Retourne last10 matchs avec scores, top10 scoreurs, H2H, O/U trend, splits, momentum.
 *     Cache KV 6h géré côté worker — 0 appel supplémentaire si cache chaud.
 *     Ajouté dans le Promise.all principal, teamDetail transmis au store et à l'UI.
 *   - buildRawData() : teamDetail exposé dans le rawData pour usage futur moteur.
 *   - store.set({ teamDetail }) après resolution du Promise.all.
 *
 * AJOUTS v3.9 :
 *   - _loadAIInjuries() : refactorisé pour le pipeline v6.27.
 *     Appelle /nba/roster-injuries (Tank01 roster complet, cache 3h) au lieu
 *     de N appels /nba/ai-injuries individuels par match.
 *     Appelle /nba/ai-context une seule fois pour tous les matchs du soir (cache 6h KV + cache memoire session).
 *     0 appel Claude par match — budget réduit de ~7 appels/soir à ~1 appel/soir.
 *   - _mergeInjuryReports() : adapté pour le format roster Tank01 v6.27.
 *     Source 'tank01_roster' reconnue et fusionnée correctement.
 *
 * AJOUTS v3.8 :
 *   - _mergeInjuryReports : intègre players_limited (status_weight 0.4)
 *     dans le calcul du modificateur star.
 *   - team_context et market_signal exposés dans le rapport mergé
 *     pour affichage UI dans renderBlocPourquoi..1
 *
 * CORRECTIONS v3.7.1 :
 *   - _mergeInjuryReports() : statut Day-To-Day mis à jour en Doubtful
 *     quand l'IA confirme DOUBTFUL. Permet au modificateur star de s'appliquer
 *     sur les joueurs comme Wembanyama listé DTD puis confirmé Doubtful par l'IA.
 *
 * AJOUTS v3.7 :
 *   - Refactor Promise.all : _loadAIInjuries() tourne en parallèle avec
 *     _loadInjuries() et les autres sources — plus de séquence bloquante.
 *     _mergeInjuryReports() fusionne les deux rapports après resolution.
 *     Résout le timeout qui empêchait l'enrichissement IA d'atteindre le moteur.
 *
 * AJOUTS v3.6 :
 *   [SUPPRIMÉ v3.10] _enrichInjuriesWithAI() — appelait Claude par match (zombie).
 *
 * AJOUTS v3.5 :
 *
 * AJOUTS v3.2 :
 *   - _loadInjuries() appelle /nba/injuries/impact (ESPN + Tank01 pondéré ppg)
 *     au lieu de ProviderInjuries.getReport() directement.
 *     Fallback automatique sur ESPN brut si la route impact échoue.
 *   - Le format retourné reste compatible avec ProviderInjuries.getForTeam().
 *   - impact_by_team exposé pour usage futur (pré-score par équipe).
 *
 * AJOUTS v3.1 :
 *   - data.orchestrator.js v3.1 — voir historique v3.
 *
 * AJOUTS v3 :
 *   - _loadAdvancedStats() appelle /nba/teams/stats (Tank01) au lieu de
 *     /nba/stats/advanced (NBA Stats API bloquée par Cloudflare).
 *   - net_rating_approx = ppg - oppg injecté dans le moteur via advanced_stats.
 *   - Mapping teamAbv → nom ESPN complet pour compatibilité moteur.
 *   - advancedStats n'est plus null — appel réel à Tank01.
 *
 * AJOUTS v2 :
 *   - _loadAdvancedStats() : charge Net Rating + Pace depuis NBA Stats API
 *     en parallèle avec BDL et injuries. Transmis au moteur via advanced_stats.
 *   - buildRawData() accepte advancedStats en paramètre.
 *   - BATCH_SIZE passe de 3 à 6, BATCH_DELAY de 500ms à 200ms.
 */

import { ProviderNBA }      from '../providers/provider.nba.js';
import { ProviderInjuries } from '../providers/provider.injuries.js';
import { EngineCore }       from '../engine/engine.core.js';
import { EngineTennis }    from '../engine/engine.tennis.js';
import { Logger }           from '../utils/utils.logger.js';
import { LoadingUI }        from '../ui/ui.loading.js';
import { API_CONFIG }       from '../config/api.config.js';

// Mapping nom équipe ESPN vers ID BallDontLie (officiel NBA 1-30)
const TEAM_NAME_TO_BDL_ID = {
  'Atlanta Hawks':           '1',
  'Boston Celtics':          '2',
  'Brooklyn Nets':           '3',
  'Charlotte Hornets':       '4',
  'Chicago Bulls':           '5',
  'Cleveland Cavaliers':     '6',
  'Dallas Mavericks':        '7',
  'Denver Nuggets':          '8',
  'Detroit Pistons':         '9',
  'Golden State Warriors':   '10',
  'Houston Rockets':         '11',
  'Indiana Pacers':          '12',
  'LA Clippers':             '13',
  'Los Angeles Lakers':      '14',
  'Memphis Grizzlies':       '15',
  'Miami Heat':              '16',
  'Milwaukee Bucks':         '17',
  'Minnesota Timberwolves':  '18',
  'New Orleans Pelicans':    '19',
  'New York Knicks':         '20',
  'Oklahoma City Thunder':   '21',
  'Orlando Magic':           '22',
  'Philadelphia 76ers':      '23',
  'Phoenix Suns':            '24',
  'Portland Trail Blazers':  '25',
  'Sacramento Kings':        '26',
  'San Antonio Spurs':       '27',
  'Toronto Raptors':         '28',
  'Utah Jazz':               '29',
  'Washington Wizards':      '30',
};

// Mapping Tank01 teamAbv → nom ESPN complet
const ABV_TO_ESPN_NAME = {
  'ATL': 'Atlanta Hawks',
  'BOS': 'Boston Celtics',
  'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls',
  'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks',
  'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons',
  'GS':  'Golden State Warriors',
  'HOU': 'Houston Rockets',
  'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers',
  'LAL': 'Los Angeles Lakers',
  'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks',
  'MIN': 'Minnesota Timberwolves',
  'NO':  'New Orleans Pelicans',
  'NY':  'New York Knicks',
  'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic',
  'PHI': 'Philadelphia 76ers',
  'PHO': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers',
  'SAC': 'Sacramento Kings',
  'SA':  'San Antonio Spurs',
  'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz',
  'WAS': 'Washington Wizards',
};

export class DataOrchestrator {

  /**
   * Point d'entrée unique. Charge toutes les données puis analyse.
   * @param {string} date - YYYY-MM-DD
   * @param {Store} store
   * @returns {Promise<{ matches: Array, analyses: object }|null>}
   */
  static async loadAndAnalyze(date, store, options = {}) {
    // Routing vers le bon orchestrateur selon le sport sélectionné
    const sport = store.get('selectedSport') ?? 'NBA';
    if (sport === 'TENNIS') {
      return DataOrchestrator._loadAndAnalyzeTennis(date, store);
    }
    try {
      // ÉTAPE 1 : ESPN matches (obligatoire)
      LoadingUI.update('ESPN matches...', 0);
      const espnData = await ProviderNBA.getMatchesToday(date);

      if (!espnData || !espnData.matches || !espnData.matches.length) {
        Logger.warn('ORCHESTRATOR_NO_MATCHES', { date });
        return null;
      }

      // Filtrer les matchs en cours ET terminés — ESPN retourne les stats du match live
      // au lieu des moyennes de saison, ce qui perturbe complètement le moteur.
      const LIVE_STATUSES = [
        'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
        'STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_FINAL_PENALTY',
      ];
      const matches = espnData.matches.filter(m => !LIVE_STATUSES.includes(m.status));

      if (!matches.length) {
        Logger.warn('ORCHESTRATOR_ALL_LIVE', { date });
        return null;
      }

      // Vider les analyses précédentes si on change de date
      const prevDate = store.get('dashboardFilters') && store.get('dashboardFilters').selectedDate;
      if (prevDate && prevDate !== date) {
        store.set({ matches: {}, analyses: {} });
      }

      // Stocker les matchs dans le store immédiatement
      matches.forEach(function(match) {
        store.upsert('matches', match.id, Object.assign({}, match, { sport: 'NBA' }));
      });

      // ÉTAPE 2 : Injuries + BDL + Odds + Stats avancées en parallèle
      LoadingUI.update('Blessures + forme récente + cotes + Net Rating...', 20);

      const season  = _getCurrentNBASeason();
      const teamIds = _extractTeamIds(matches);

      // Extraire les abréviations Tank01 pour team-detail (1 appel par match)
      // On ne charge que le premier match pour les splits/top10 — chaque match-detail
      // appelle _loadTeamDetail individuellement via le store
      // Étape 2a : ESPN + Tank01 + Odds + Stats — bloquant (données critiques moteur)
      // FIX 3 : _loadAIInjuries bloquant — moteur attend Claude avant de calculer
      // Claude retourne injuries+PPG+contexte en 8-12s (cache KV 6h après)
      // Fallback ESPN transparent si Claude timeout ou indisponible
      const [injuryReport, aiInjuries, recentForms, oddsComparison, advancedStats] = await Promise.all([
        _loadInjuries(date),              // ESPN fallback (statuts basiques)
        _loadAIInjuries(matches, date, store, options), // Claude injuries : 12h / 23h / manuel
        _loadRecentForms(teamIds, season),
        _loadOddsComparison(),
        _loadAdvancedStats(),
      ]);

      // Merger ESPN + Claude → injuryReport enrichi avec vrais PPG
      const mergedInjuryReport = _mergeInjuryReports(injuryReport, aiInjuries);
      store.set({ injuryReport: mergedInjuryReport });

      // Pré-charger teamDetail pour tous les matchs (non bloquant)
      _preloadTeamDetails(matches).then(function(teamDetails) {
        store.set({ teamDetails });
      }).catch(function() {});

      // ÉTAPE 3 : Analyser tous les matchs
      LoadingUI.update('Analyse en cours...', 70);

      const analyses = await _analyzeMatches(
        matches,
        recentForms,
        mergedInjuryReport,  // rapport fusionné ESPN + Claude (PPG inclus)
        oddsComparison,
        advancedStats,
        date,
        store
      );

      LoadingUI.update('Prêt', 100);
      LoadingUI.hide();

      return { matches, analyses };

    } catch (err) {
      Logger.error('ORCHESTRATOR_ERROR', { message: err.message });
      LoadingUI.hide();
      return null;
    }
  }

  /**
   * Construit les données brutes pour le moteur NBA.
   * @param {object} match
   * @param {object} recentForms - { [bdlId]: NBARecentForm }
   * @param {object|null} injuryReport
   * @param {object|null} advancedStats - { [teamName]: { net_rating, pace, ... } }
   * @returns {object} rawData
   */
  static buildRawData(match, recentForms, injuryReport, advancedStats) {
    const homeBDLId    = _getBDLId(match.home_team && match.home_team.name);
    const awayBDLId    = _getBDLId(match.away_team && match.away_team.name);
    const homeTeamName = match.home_team && match.home_team.name;
    const awayTeamName = match.away_team && match.away_team.name;

    const homeRecent = homeBDLId ? (recentForms[homeBDLId] || null) : null;
    const awayRecent = awayBDLId ? (recentForms[awayBDLId] || null) : null;

    const homeInjuries = injuryReport && homeTeamName
      ? ProviderInjuries.getForTeam(injuryReport, homeTeamName)
      : null;
    const awayInjuries = injuryReport && awayTeamName
      ? ProviderInjuries.getForTeam(injuryReport, awayTeamName)
      : null;

    return {
      match_id:           match.id,
      home_season_stats:  Object.assign({}, match.home_season_stats || {}, { name: homeTeamName }),
      away_season_stats:  Object.assign({}, match.away_season_stats || {}, { name: awayTeamName }),
      home_recent:        homeRecent,
      away_recent:        awayRecent,
      home_injuries:      homeInjuries && homeInjuries.length > 0 ? homeInjuries : null,
      away_injuries:      awayInjuries && awayInjuries.length > 0 ? awayInjuries : null,
      odds:               match.odds || null,
      absences_confirmed: injuryReport !== null,
      advanced_stats:     advancedStats || null,
      market_odds:        null,
      home_back_to_back:  _isBackToBack(homeRecent, match.date || match.datetime),
      away_back_to_back:  _isBackToBack(awayRecent, match.date || match.datetime),
      home_rest_days:     _computeRestDays(homeRecent, match.date || match.datetime),
      away_rest_days:     _computeRestDays(awayRecent, match.date || match.datetime),
    };
  }

  static getBDLId(teamName) {
    return _getBDLId(teamName);
  }
}

// ── FONCTIONS PRIVÉES ─────────────────────────────────────────────────────────

function _getBDLId(teamName) {
  return teamName ? (TEAM_NAME_TO_BDL_ID[teamName] || null) : null;
}

function _extractTeamIds(matches) {
  const ids = new Set();
  matches.forEach(function(m) {
    const homeId = _getBDLId(m.home_team && m.home_team.name);
    const awayId = _getBDLId(m.away_team && m.away_team.name);
    if (homeId) ids.add(homeId);
    if (awayId) ids.add(awayId);
  });
  return Array.from(ids);
}

/**
 * v3.2 : Charge les blessures depuis /nba/injuries/impact (ESPN + Tank01 pondéré ppg).
 * Le format retourné est compatible avec ProviderInjuries.getForTeam() :
 *   { by_team: { [teamName]: [{ name, status, impact_weight, ppg, source }] } }
 *
 * Fallback automatique sur ESPN brut (ProviderInjuries.getReport) si la route échoue.
 */
async function _loadInjuries(date) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, 10000);

    const response = await fetch(
      API_CONFIG.WORKER_BASE_URL + '/nba/injuries/impact',
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);

    if (response.ok) {
      const data = await response.json();

      if (data && data.available && data.by_team && Object.keys(data.by_team).length > 0) {
        Logger.info('INJURIES_IMPACT_LOADED', {
          teams:  Object.keys(data.by_team).length,
          source: 'espn+tank01',
        });

        // Adapter le format pour ProviderInjuries.getForTeam()
        // getForTeam() attend : { by_team: { [teamName]: [...players] } }
        // players_weighted contient déjà impact_weight pondéré par ppg (Tank01)
        const injuryReport = {
          source:  'espn_injuries_weighted',
          by_team: Object.fromEntries(
            Object.entries(data.by_team).map(function([teamName, teamData]) {
              return [
                teamName,
                teamData.players_weighted.map(function(p) {
                  return {
                    name:           p.name,
                    status:         p.status,
                    impact_weight:  p.player_impact,  // ← poids réel pondéré par ppg
                    ppg:            p.ppg,
                    importance_pct: p.importance_pct,
                    source:         p.source,         // 'tank01' | 'fallback'
                  };
                }),
              ];
            })
          ),
          // Pré-score par équipe exposé pour usage futur (calibration, debug)
          impact_by_team: Object.fromEntries(
            Object.entries(data.by_team).map(function([teamName, teamData]) {
              return [teamName, teamData.impact_score];
            })
          ),
        };

        return injuryReport;
      }
    }
  } catch (err) {
    Logger.warn('INJURIES_IMPACT_FAILED', { message: err.message });
  }

  // Fallback : ESPN injuries brut (comportement v3.1)
  try {
    Logger.warn('INJURIES_FALLBACK_ESPN', {});
    return await ProviderInjuries.getReport(date);
  } catch (err) {
    Logger.warn('ORCHESTRATOR_INJURIES_FAILED', { message: err.message });
    return null;
  }
}


// _enrichInjuriesWithAI() supprimée en v3.10 — fonction zombie v3.6.
// Appelait /nba/ai-injuries par match (N appels Claude/soir). Remplacée
// par _loadAIInjuries() + _fetchAIContext() (1 seul appel Claude/soir).

/**
 * Retourne l'abréviation Tank01 d'une équipe depuis son nom ESPN complet.
 * Inverse de ABV_TO_ESPN_NAME.
 */
function _getTeamAbv(espnName) {
  if (!espnName) return null;
  for (var abv in ABV_TO_ESPN_NAME) {
    if (ABV_TO_ESPN_NAME[abv] === espnName) return abv;
  }
  return null;
}


/**
 * v3.9 : Pipeline injuries v6.27 — Tank01 roster + Claude contexte global.
 *
 * Avant v3.9 : N appels /nba/ai-injuries par match (1 Claude/match).
 * Après v3.9 :
 *   1. /nba/roster-injuries → roster complet NBA avec ppg + designation (cache 3h).
 *   2. /nba/ai-context → contexte motivationnel global pour tous les matchs (cache 6h KV, 1 Claude/soir max).
 *   3. Fusionne en format { by_team, team_context, market_signal } identique à v3.8.
 *
 * Retourne null si aucune donnée disponible (fallback transparent).
 *
 * @param {Array}  matches - matchs du jour
 * @param {string} date    - YYYY-MM-DD
 * @returns {Promise<object|null>} { by_team, team_context, market_signal } ou null
 */

var _aiBatchMemCache = {};
var _aiBatchInFlight = null;

function _getParisDateHour() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', hour12: false
  }).format(now));
  return { date, hour };
}

function _buildAISyncPolicy(date, store, options = {}) {
  const manualRefresh = options.manualRefresh === true;
  const syncState = store?.get('refreshSync') || {};

  if (manualRefresh) {
    return {
      allowed: true,
      mode: 'manual',
      windowKey: 'manual|' + String(date || ''),
      reason: 'manual',
    };
  }

  const paris = _getParisDateHour();
  if (!date || date !== paris.date) {
    return { allowed: false, mode: 'cache_only', windowKey: null, reason: 'not_today_paris' };
  }

  let slot = null;
  if (paris.hour >= 23) slot = '23h';
  else if (paris.hour >= 12) slot = '12h';
  else return { allowed: false, mode: 'cache_only', windowKey: null, reason: 'before_first_window' };

  const windowKey = paris.date + '|' + slot;
  if (syncState.lastWindowKey === windowKey) {
    return { allowed: false, mode: 'cache_only', windowKey, reason: 'already_synced' };
  }
  if (syncState.inFlightKey === windowKey) {
    return { allowed: false, mode: 'cache_only', windowKey, reason: 'already_running' };
  }

  return { allowed: true, mode: 'auto', windowKey, reason: 'window_due' };
}

function _setRefreshSync(store, patch = {}) {
  if (!store) return;
  const current = store.get('refreshSync') || {};
  store.set({
    refreshSync: Object.assign({}, current, patch),
  });
}

function _gamesParamFromMatches(matches) {
  return matches.map(function(m) {
    const homeAbv = _getTeamAbv(m.home_team && m.home_team.name);
    const awayAbv = _getTeamAbv(m.away_team && m.away_team.name);
    return (homeAbv && awayAbv) ? awayAbv + '@' + homeAbv : null;
  }).filter(Boolean).join(',');
}

function _normalizeAIBatchPayload(payload) {
  const sourceData = payload?.data;
  if (!sourceData) return null;

  const rows = Array.isArray(sourceData)
    ? sourceData
    : Object.values(sourceData);

  const aiByTeam = {};
  rows.forEach(function(row) {
    if (!row || !row.game) return;
    const parts = String(row.game).split('@');
    const awayAbv = parts[0] && parts[0].toUpperCase();
    const homeAbv = parts[1] && parts[1].toUpperCase();
    const homeEspn = ABV_TO_ESPN_NAME[homeAbv] || null;
    const awayEspn = ABV_TO_ESPN_NAME[awayAbv] || null;

    const pushPlayers = function(list, espnName, abv) {
      if (!espnName || !Array.isArray(list)) return;
      if (!aiByTeam[espnName]) aiByTeam[espnName] = [];
      list.forEach(function(p) {
        if (!p || !p.name) return;
        aiByTeam[espnName].push({
          name: p.name,
          team: abv,
          status: p.status || 'Out',
          ppg: p.ppg ?? null,
          source: p.source || payload.source || 'claude_web_search',
          note: p.reason || p.note || null,
        });
      });
    };

    pushPlayers(row.injuries_home || row.home || [], homeEspn, homeAbv);
    pushPlayers(row.injuries_away || row.away || [], awayEspn, awayAbv);
  });

  const totalPlayers = Object.values(aiByTeam).reduce(function(sum, arr) { return sum + arr.length; }, 0);
  if (totalPlayers <= 0) return null;

  return {
    by_team: aiByTeam,
    team_context: {},
    market_signal: null,
    _meta: {
      teams: Object.keys(aiByTeam).length,
      players: totalPlayers,
      source: payload.source || 'claude_web_search',
    },
  };
}

async function _fetchAIInjuriesBatch(dateForWorker, gamesParam) {
  if (!gamesParam) return null;
  const cacheKey = dateForWorker + '|' + gamesParam;
  if (_aiBatchMemCache[cacheKey]) {
    Logger.info('AI_BATCH_MEM_HIT', { date: dateForWorker });
    return _aiBatchMemCache[cacheKey];
  }

  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, 35000);
  try {
    const response = await fetch(
      API_CONFIG.WORKER_BASE_URL + '/nba/ai-injuries-batch' +
      '?date=' + dateForWorker +
      '&games=' + encodeURIComponent(gamesParam),
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);

    if (response.status === 404) {
      Logger.warn('AI_BATCH_ROUTE_MISSING', { status: 404 });
      return null;
    }
    if (response.status === 429) {
      Logger.warn('AI_BATCH_HTTP_ERROR', { status: 429 });
      return null;
    }
    if (!response.ok) {
      Logger.warn('AI_BATCH_HTTP_ERROR', { status: response.status });
      return null;
    }

    const payload = await response.json();
    if (!payload?.available || !payload?.data) {
      Logger.info('AI_BATCH_UNAVAILABLE', { note: payload?.note || null, source: payload?.source || null });
      return null;
    }

    _aiBatchMemCache[cacheKey] = payload;
    return payload;
  } catch (err) {
    clearTimeout(timer);
    Logger.warn('AI_BATCH_FAILED', { message: err.message });
    return null;
  }
}

async function _loadAIInjuries(matches, date, store, options = {}) {
  if (!matches || !matches.length) return null;

  const dateForWorker = date ? date.replace(/-/g, '') : '';
  if (!dateForWorker || dateForWorker.length !== 8) return null;

  const policy = _buildAISyncPolicy(date, store, options);
  if (!policy.allowed) {
    Logger.info('AI_INJURIES_SKIP', { reason: policy.reason, window: policy.windowKey });
    _setRefreshSync(store, {
      status: 'cache_only',
      detail: policy.reason,
      mode: policy.mode,
    });
    return null;
  }

  const gamesParam = _gamesParamFromMatches(matches);
  if (!gamesParam) return null;

  if (_aiBatchInFlight && _aiBatchInFlight.key === policy.windowKey) {
    return await _aiBatchInFlight.promise;
  }

  _setRefreshSync(store, {
    status: 'syncing',
    detail: policy.mode === 'manual' ? 'actualisation manuelle injuries' : 'fenêtre ' + policy.windowKey,
    inFlightKey: policy.windowKey,
    mode: policy.mode,
  });

  const promise = (async function() {
    const payload = await _fetchAIInjuriesBatch(dateForWorker, gamesParam);
    const normalized = _normalizeAIBatchPayload(payload);

    if (!normalized) {
      _setRefreshSync(store, {
        status: 'cache_only',
        detail: 'aucune donnée Claude chargée',
        inFlightKey: null,
        lastWindowKey: policy.mode === 'auto' ? policy.windowKey : (store.get('refreshSync') || {}).lastWindowKey,
      });
      return null;
    }

    Logger.info('AI_INJURIES_LOADED', normalized._meta);
    _setRefreshSync(store, {
      status: 'success',
      detail: policy.mode === 'manual' ? 'injuries Claude mises à jour (manuel)' : 'injuries Claude synchronisées',
      lastSuccessAt: new Date().toISOString(),
      lastWindowKey: policy.windowKey,
      lastManualAt: policy.mode === 'manual' ? new Date().toISOString() : (store.get('refreshSync') || {}).lastManualAt,
      inFlightKey: null,
      mode: policy.mode,
    });
    return normalized;
  })().finally(function() {
    _aiBatchInFlight = null;
  });

  _aiBatchInFlight = { key: policy.windowKey, promise };
  return await promise;
}

/**
 * v3.7 : Fusionne le rapport ESPN+Tank01 avec les données IA.
 * Stratégie :
 *   - Joueur existant ESPN avec ppg=null → ppg mis à jour depuis IA
 *   - Joueur DTD/Doubtful ESPN confirmé OUT par IA → statut mis à jour
 *   - Nouveau joueur absent non listé ESPN → ajouté avec données IA
 *
 * @param {object|null} espnReport - rapport ESPN+Tank01
 * @param {object|null} aiByTeam   - données IA { [espnTeamName]: [players] }
 * @returns {object|null} rapport fusionné
 */
function _mergeInjuryReports(espnReport, aiData) {
  // aiData peut être null, un objet { by_team, team_context, market_signal }
  // ou (ancien format) directement un objet by_team
  var aiByTeam     = null;
  var aiTeamCtx    = {};
  var aiMarketSig  = null;

  if (!aiData) return espnReport;
  if (!espnReport || !espnReport.by_team) return espnReport;

  // Détecter le format : nouveau ({ by_team, team_context }) ou ancien (objet direct)
  if (aiData.by_team && typeof aiData.by_team === 'object') {
    aiByTeam    = aiData.by_team;
    aiTeamCtx   = aiData.team_context || {};
    aiMarketSig = aiData.market_signal || null;
  } else {
    // Ancien format — objet directement indexé par nom d'équipe
    aiByTeam = aiData;
  }

  if (!aiByTeam || Object.keys(aiByTeam).length === 0) {
    // Pas de joueurs mais peut avoir team_context
    if (Object.keys(aiTeamCtx).length > 0 || aiMarketSig) {
      return Object.assign({}, espnReport, {
        team_context:  aiTeamCtx,
        market_signal: aiMarketSig,
        source:        'espn_injuries_weighted+ai',
      });
    }
    return espnReport;
  }

  var STATUS_WEIGHTS = {
    'Out': 1.0, 'Doubtful': 0.75, 'Day-To-Day': 0.3, 'Questionable': 0.5, 'Limited': 0.4
  };
  var TEAM_PPG_FALLBACK = 108;

  var enrichedByTeam = Object.assign({}, espnReport.by_team);
  var mergedCount = 0;

  Object.entries(aiByTeam).forEach(function(entry) {
    var teamName  = entry[0];
    var aiPlayers = entry[1];
    if (!Array.isArray(aiPlayers) || !aiPlayers.length) return;

    if (!enrichedByTeam[teamName]) {
      enrichedByTeam[teamName] = [];
    }

    var existingPlayers = enrichedByTeam[teamName].slice(); // clone

    aiPlayers.forEach(function(aiPlayer) {
      if (!aiPlayer.name) return;

      var existingIdx = existingPlayers.findIndex(function(ep) {
        return ep.name && ep.name.toLowerCase() === aiPlayer.name.toLowerCase();
      });

      if (existingIdx >= 0) {
        var existing = Object.assign({}, existingPlayers[existingIdx]);

        // Mettre à jour ppg si manquant et IA l'a trouvé
        if ((existing.ppg === null || existing.ppg === undefined) &&
            aiPlayer.ppg !== null && aiPlayer.ppg !== undefined) {
          existing.ppg = aiPlayer.ppg;
          var sw = STATUS_WEIGHTS[existing.status] || 0.3;
          existing.impact_weight = Math.round((aiPlayer.ppg / TEAM_PPG_FALLBACK) * sw * 1000) / 1000;
          existing.source = 'tank01_via_ai';
          mergedCount++;
        }

        // Confirmer OUT si DTD/Doubtful ESPN et IA dit OUT
        var aiStatusUpper = (aiPlayer.status || '').toUpperCase();
        if (existing.status === 'Day-To-Day' && aiStatusUpper === 'OUT') {
          existing.status = 'Out';
          var ppg = existing.ppg || aiPlayer.ppg || null;
          existing.impact_weight = ppg
            ? Math.round((ppg / TEAM_PPG_FALLBACK) * 1.0 * 1000) / 1000
            : 0.125;
          existing.source = 'espn_confirmed_by_ai';
          mergedCount++;
        } else if (existing.status === 'Day-To-Day' && aiStatusUpper === 'DOUBTFUL') {
          // v3.7.1 : DTD confirmé Doubtful par IA → upgrade statut pour modificateur star
          existing.status = 'Doubtful';
          var ppgD = existing.ppg || aiPlayer.ppg || null;
          if (ppgD) existing.impact_weight = Math.round((ppgD / TEAM_PPG_FALLBACK) * 0.75 * 1000) / 1000;
          existing.source = 'espn_confirmed_by_ai';
          mergedCount++;
        } else if (existing.status === 'Doubtful' && aiStatusUpper === 'OUT') {
          existing.status = 'Out';
          var ppgO = existing.ppg || aiPlayer.ppg || null;
          existing.impact_weight = ppgO
            ? Math.round((ppgO / TEAM_PPG_FALLBACK) * 1.0 * 1000) / 1000
            : 0.125;
          existing.source = 'espn_confirmed_by_ai';
          mergedCount++;
        }

        existingPlayers[existingIdx] = existing;

      } else {
        // Nouveau joueur non listé ESPN
        var aiStatusUpper2 = (aiPlayer.status || 'OUT').toUpperCase();
        var sw2 = aiStatusUpper2 === 'OUT' ? 1.0
               : aiStatusUpper2 === 'DOUBTFUL' ? 0.75
               : aiStatusUpper2 === 'LIMITED' ? 0.4
               : 0.3;
        var ppg2    = aiPlayer.ppg || null;
        var impact2 = ppg2
          ? Math.round((ppg2 / TEAM_PPG_FALLBACK) * sw2 * 1000) / 1000
          : Math.round(0.125 * sw2 * 1000) / 1000;

        existingPlayers.push({
          name:           aiPlayer.name,
          status:         aiStatusUpper2 === 'OUT' ? 'Out'
                        : aiStatusUpper2 === 'DOUBTFUL' ? 'Doubtful'
                        : aiStatusUpper2 === 'LIMITED' ? 'Limited'
                        : 'Day-To-Day',
          impact_weight:  impact2,
          ppg:            ppg2,
          importance_pct: ppg2 ? Math.round((ppg2 / TEAM_PPG_FALLBACK) * 100) : 13,
          source:         'ai_only',
          detail:         aiPlayer.detail || null,
        });
        mergedCount++;
      }
    });

    enrichedByTeam[teamName] = existingPlayers;
  });

  if (mergedCount > 0) {
    Logger.info('AI_INJURIES_MERGED', { updates: mergedCount });
  }

  return Object.assign({}, espnReport, {
    by_team:       enrichedByTeam,
    source:        'espn_injuries_weighted+ai',
    team_context:  aiTeamCtx,
    market_signal: aiMarketSig,
  });
}

async function _loadRecentForms(teamIds, season) {
  const forms = {};
  const BATCH_SIZE  = 6;
  const BATCH_DELAY = 200;

  for (let i = 0; i < teamIds.length; i += BATCH_SIZE) {
    const batch = teamIds.slice(i, i + BATCH_SIZE);

    LoadingUI.update(
      'Forme récente (' + Math.min(i + BATCH_SIZE, teamIds.length) + '/' + teamIds.length + ')...',
      20 + Math.round((i / teamIds.length) * 40)
    );

    await Promise.allSettled(
      batch.map(async function(bdlId) {
        const form = await ProviderNBA.getRecentForm(bdlId, season, 10);
        if (form && form.matches && form.matches.length > 0) {
          forms[bdlId] = form;
        }
      })
    );

    if (i + BATCH_SIZE < teamIds.length) {
      await new Promise(function(r) { setTimeout(r, BATCH_DELAY); });
    }
  }

  return forms;
}

async function _loadOddsComparison() {
  try {
    return await ProviderNBA.getOddsComparison();
  } catch (err) {
    Logger.warn('ORCHESTRATOR_ODDS_FAILED', { message: err.message });
    return null;
  }
}

/**
 * Charge les stats avancées depuis Tank01 (/nba/teams/stats).
 * net_rating_approx = ppg - oppg (approximation sans possessions).
 * Retourne { [nomESPN]: { net_rating, pace } } ou null si indisponible.
 * Non bloquant — le moteur fonctionne sans (quality=MISSING).
 */
async function _loadAdvancedStats() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, 8000);
    const response = await fetch(
      API_CONFIG.WORKER_BASE_URL + '/nba/teams/stats',
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);

    if (!response.ok) {
      Logger.warn('ADVANCED_STATS_HTTP_ERROR', { status: response.status });
      return null;
    }

    const data = await response.json();

    if (!data || !data.available || !data.teams) {
      Logger.warn('ADVANCED_STATS_UNAVAILABLE', { note: data && data.note });
      return null;
    }

    // Convertir teamAbv → nom ESPN complet pour compatibilité moteur
    const byName = {};
    for (const [abv, stats] of Object.entries(data.teams)) {
      const name = ABV_TO_ESPN_NAME[abv];
      if (name) {
        byName[name] = {
          net_rating:       stats.net_rating_approx,
          defensive_rating: stats.oppg ?? null,  // oppg = points encaissés par match (proxy défense)
          pace:             null,
        };
      }
    }

    Logger.info('ADVANCED_STATS_LOADED', { teams: Object.keys(byName).length, source: 'tank01' });
    return byName;

  } catch (err) {
    Logger.warn('ADVANCED_STATS_FAILED', { message: err.message });
    return null;
  }
}

async function _analyzeMatches(matches, recentForms, injuryReport, oddsComparison, advancedStats, date, store) {
  const analyses = {};
  let conclusive = 0;
  let rejected   = 0;

  // Éviter les divergences dashboard / fiche : on retire les anciennes analyses
  // des matchs recalculés avant d'enregistrer la nouvelle vague.
  const currentMatchIds = new Set(matches.map(match => match.id));
  const existingAnalyses = store.get('analyses') ?? {};
  const cleanedAnalyses = {};
  for (const [analysisId, analysis] of Object.entries(existingAnalyses)) {
    if (!analysis || !currentMatchIds.has(analysis.match_id)) {
      cleanedAnalyses[analysisId] = analysis;
    }
  }
  store.set({ analyses: cleanedAnalyses });

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    try {
      const rawData = DataOrchestrator.buildRawData(match, recentForms, injuryReport, advancedStats);

      // Injecter les vraies cotes multi-books si disponibles
      if (oddsComparison && oddsComparison.matches) {
        const matchOdds = ProviderNBA.findMatchOdds(
          oddsComparison,
          match.home_team && match.home_team.name,
          match.away_team && match.away_team.name
        );
        if (matchOdds) rawData.market_odds = matchOdds;
      }

      const analysis = EngineCore.compute('NBA', rawData);
      const enriched = Object.assign({}, analysis, { match_id: match.id });

      store.upsert('analyses', analysis.analysis_id, enriched);
      analyses[match.id] = enriched;

      if (analysis.confidence_level !== 'INCONCLUSIVE') {
        store.push('history', {
          analysis_id:      analysis.analysis_id,
          match_id:         match.id,
          date,
          home:             (match.home_team && match.home_team.name) || '-',
          away:             (match.away_team && match.away_team.name) || '-',
          sport:            'NBA',
          confidence_level: analysis.confidence_level,
          predictive_score: analysis.predictive_score,
          robustness_score: analysis.robustness_score,
          saved_at:         new Date().toISOString(),
        }, 100);
        conclusive++;
      } else {
        rejected++;
      }

    } catch (err) {
      Logger.warn('ORCHESTRATOR_MATCH_ERROR', { matchId: match.id, message: err.message });
    }
  }

  Logger.info('ORCHESTRATOR_DONE', { total: matches.length, conclusive, rejected });
  return analyses;
}

function _isBackToBack(recentForm, matchDate) {
  if (!recentForm || !recentForm.matches || !recentForm.matches.length || !matchDate) return null;
  var lastDate = recentForm.matches[0].date;
  if (!lastDate) return null;
  var last = new Date(lastDate + 'T12:00:00');
  var curr = new Date(_normalizeDate(String(matchDate)) + 'T12:00:00');
  return Math.round((curr - last) / 86400000) === 1;
}

// ── TENNIS ORCHESTRATOR ──────────────────────────────────────────────────

DataOrchestrator._loadAndAnalyzeTennis = async function(date, store) {
  const WORKER = API_CONFIG.WORKER_BASE_URL;
  const TOURNAMENTS = [
    { key: 'monte_carlo', label: 'Monte-Carlo Masters', surface: 'Clay',  start: '2026-04-13', end: '2026-04-20' },
    { key: 'madrid',      label: 'Madrid Open',         surface: 'Clay',  start: '2026-04-28', end: '2026-05-10' },
    { key: 'rome',        label: 'Rome Masters',        surface: 'Clay',  start: '2026-05-11', end: '2026-05-18' },
    { key: 'french_open', label: 'Roland Garros',       surface: 'Clay',  start: '2026-05-25', end: '2026-06-08' },
    { key: 'wimbledon',   label: 'Wimbledon',           surface: 'Grass', start: '2026-06-29', end: '2026-07-12' },
    { key: 'us_open',     label: 'US Open',             surface: 'Hard',  start: '2026-08-31', end: '2026-09-13' },
  ];

  const d          = date ?? new Date().toISOString().slice(0, 10);
  const tournament = TOURNAMENTS.find(t => d >= t.start && d <= t.end) ?? null;

  if (!tournament) {
    Logger.info('TENNIS_NO_ACTIVE_TOURNAMENT', { date: d });
    return { matches: [], analyses: {} };
  }

  try {
    LoadingUI.update('Tennis odds...', 0);
    const oddsResp = await fetch(`${WORKER}/tennis/odds?tournament=${tournament.key}`, {
      headers: { Accept: 'application/json' },
    });
    if (!oddsResp.ok) return { matches: [], analyses: {} };
    const oddsData = await oddsResp.json();
    if (!oddsData.available || !oddsData.matches?.length) {
      return { matches: [], analyses: {} };
    }

    const matchesMap = {};
    const analyses   = {};

    for (const m of oddsData.matches) {
      const p1 = m.home_player;
      const p2 = m.away_player;
      if (!p1 || !p2) continue;

      const matchObj = {
        id:         m.id,
        sport:      'TENNIS',
        datetime:   m.commence_time,
        tournament: tournament.label,
        surface:    tournament.surface,
        status:     'STATUS_SCHEDULED',
        home_team:  { name: p1, abbreviation: p1.split(' ').pop() ?? p1, score: null },
        away_team:  { name: p2, abbreviation: p2.split(' ').pop() ?? p2, score: null },
        odds:       m.odds?.h2h ? { home_ml: m.odds.h2h.p1, away_ml: m.odds.h2h.p2 } : null,
      };
      matchesMap[m.id] = matchObj;

      try {
        LoadingUI.update(`Stats ${p1} vs ${p2}...`, 50);
        const statsResp = await fetch(
          `${WORKER}/tennis/stats?players=${encodeURIComponent(p1)},${encodeURIComponent(p2)}&surface=${tournament.surface}`,
          { headers: { Accept: 'application/json' } }
        );
        const statsData = statsResp.ok ? await statsResp.json() : null;
        const csvStats  = statsData?.available ? (statsData.stats ?? {}) : {};

        const engineResult = EngineTennis.analyze(
          { ...m, surface: tournament.surface },
          csvStats
        );

        const analysis      = EngineCore.analyze('TENNIS', engineResult, matchObj, matchObj);
        analysis.match_id   = m.id;
        analyses[m.id]      = analysis;

      } catch (err) {
        Logger.warn('TENNIS_MATCH_ERROR', { match: `${p1} vs ${p2}`, message: err.message });
      }
    }

    store.set({ matches: matchesMap, analyses });
    return { matches: Object.values(matchesMap), analyses };

  } catch (err) {
    Logger.error('TENNIS_ORCHESTRATOR_ERROR', { message: err.message });
    return { matches: [], analyses: {} };
  }
};

function _computeRestDays(recentForm, matchDate) {
  if (!recentForm || !recentForm.matches || !recentForm.matches.length || !matchDate) return null;
  var lastDate = recentForm.matches[0].date;
  if (!lastDate) return null;
  var last = new Date(lastDate + 'T12:00:00');
  var curr = new Date(_normalizeDate(String(matchDate)) + 'T12:00:00');
  var diff = Math.round((curr - last) / 86400000);
  return diff > 1 ? diff - 1 : 0;
}

function _normalizeDate(s) {
  if (!s) return '';
  if (s.length === 8 && !s.includes('-')) return s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8);
  return s.slice(0, 10);
}

function _getCurrentNBASeason() {
  const now = new Date();
  return String(now.getMonth() + 1 >= 10 ? now.getFullYear() : now.getFullYear() - 1);
}

// ── TEAM DETAIL — v3.10 ───────────────────────────────────────────────────────

/**
 * Charge /nba/team-detail pour un match spécifique.
 * Cache KV 6h géré côté worker — ~23 appels Tank01 sur cache miss, 0 sur cache hit.
 * @param {string} homeAbv - abv Tank01 (ex: 'TOR')
 * @param {string} awayAbv - abv Tank01 (ex: 'MIA')
 * @returns {Promise<object|null>}
 */
async function _loadTeamDetail(homeAbv, awayAbv) {
  if (!homeAbv || !awayAbv) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, 20000);
    const response = await fetch(
      API_CONFIG.WORKER_BASE_URL + '/nba/team-detail?home=' + encodeURIComponent(homeAbv) + '&away=' + encodeURIComponent(awayAbv),
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);
    if (!response.ok) {
      Logger.warn('TEAM_DETAIL_HTTP_ERROR', { status: response.status, home: homeAbv, away: awayAbv });
      return null;
    }
    const data = await response.json();
    return data && data.home ? data : null;
  } catch (err) {
    Logger.warn('TEAM_DETAIL_FAILED', { message: err.message, home: homeAbv, away: awayAbv });
    return null;
  }
}

/**
 * Pré-charge les teamDetails pour tous les matchs du soir en parallèle.
 * Retourne { [matchId]: teamDetail } — non bloquant pour le dashboard.
 * @param {Array} matches
 * @returns {Promise<object>}
 */
async function _preloadTeamDetails(matches) {
  const results = {};
  await Promise.allSettled(
    matches.map(async function(match) {
      const homeAbv = _getTeamAbv(match.home_team && match.home_team.name);
      const awayAbv = _getTeamAbv(match.away_team && match.away_team.name);
      if (!homeAbv || !awayAbv) return;
      const detail = await _loadTeamDetail(homeAbv, awayAbv);
      if (detail) results[match.id] = detail;
    })
  );
  Logger.info('TEAM_DETAILS_PRELOADED', { count: Object.keys(results).length });
  return results;
}
