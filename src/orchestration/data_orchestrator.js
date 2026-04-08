/**
 * MANI BET PRO — data.orchestrator.js v3.6
 *
 * AJOUTS v3.6 :
 *   - _enrichInjuriesWithAI() : après chargement ESPN injuries, appel Claude
 *     web_search pour enrichir les données manquantes (ppg=null, DTD non confirmés).
 *     Sources : nba.com + espn.com uniquement. Fallback transparent si IA échoue.
 *     Format retourné compatible avec _computeAbsencesImpact() engine.nba.js.
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
  static async loadAndAnalyze(date, store) {
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

      const [injuryReport, recentForms, oddsComparison, advancedStats] = await Promise.all([
        _loadInjuries(date, matches),
        _loadRecentForms(teamIds, season),
        _loadOddsComparison(),
        _loadAdvancedStats(),
      ]);

      // ÉTAPE 3 : Analyser tous les matchs
      LoadingUI.update('Analyse en cours...', 70);

      const analyses = await _analyzeMatches(
        matches,
        recentForms,
        injuryReport,
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
async function _loadInjuries(date, matches) {
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

        // v3.6 : enrichissement IA — comble les données manquantes (ppg=null, DTD non confirmés)
        // Appel non bloquant — fallback transparent si IA indisponible
        const enriched = await _enrichInjuriesWithAI(injuryReport, matches, date);
        return enriched;
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


/**
 * v3.6 : Enrichit le rapport de blessures ESPN avec Claude web_search.
 *
 * Stratégie :
 *   1. Pour chaque match du jour, appelle /nba/ai-injuries
 *   2. Merge les données IA sur les données ESPN existantes :
 *      - Joueur avec ppg=null → ppg mis à jour depuis IA
 *      - Joueur DTD confirmé OUT par IA → statut mis à jour
 *      - Nouveaux joueurs absents non listés ESPN → ajoutés
 *   3. Fallback transparent — si IA échoue, retourne le rapport ESPN intact
 *
 * @param {object} injuryReport - rapport ESPN existant
 * @param {Array}  matches      - matchs du jour
 * @param {string} date         - YYYYMMDD
 * @returns {object} rapport enrichi
 */
async function _enrichInjuriesWithAI(injuryReport, matches, date) {
  if (!injuryReport || !matches || !matches.length) return injuryReport;

  // Normaliser la date en YYYYMMDD (le worker l'attend sans tirets)
  const dateForWorker = date ? date.replace(/-/g, '') : '';
  if (!dateForWorker || dateForWorker.length !== 8) return injuryReport;

  try {
    // Lancer les appels IA en parallèle pour tous les matchs
    const aiResults = await Promise.allSettled(
      matches.map(async function(match) {
        const homeAbv = _getTeamAbv(match.home_team && match.home_team.name);
        const awayAbv = _getTeamAbv(match.away_team && match.away_team.name);
        if (!homeAbv || !awayAbv) return null;

        try {
          const controller = new AbortController();
          const timer = setTimeout(function() { controller.abort(); }, 20000);
          const response = await fetch(
            API_CONFIG.WORKER_BASE_URL + '/nba/ai-injuries' +
            '?home=' + encodeURIComponent(homeAbv) +
            '&away=' + encodeURIComponent(awayAbv) +
            '&date=' + dateForWorker,
            { signal: controller.signal, headers: { 'Accept': 'application/json' } }
          );
          clearTimeout(timer);
          if (!response.ok) return null;
          const data = await response.json();
          if (!data.available || !data.data) return null;
          return {
            home: match.home_team && match.home_team.name,
            away: match.away_team && match.away_team.name,
            homeAbv,
            awayAbv,
            aiData: data.data,
          };
        } catch (err) {
          Logger.warn('AI_INJURIES_MATCH_FAILED', { message: err.message });
          return null;
        }
      })
    );

    // Construire un index de toutes les données IA par équipe ESPN name
    // abv → espn team name via ABV_TO_ESPN_NAME
    const aiByTeam = {}; // { [espnTeamName]: [players...] }

    aiResults.forEach(function(result) {
      if (result.status !== 'fulfilled' || !result.value) return;
      const { home, away, homeAbv, awayAbv, aiData } = result.value;

      // Fusionner players_out + players_doubtful + players_dtd_confirmed_out
      const allAIPlayers = [
        ...(aiData.players_out || []),
        ...(aiData.players_doubtful || []),
        ...(aiData.players_dtd_confirmed_out || []),
      ];

      allAIPlayers.forEach(function(p) {
        // Résoudre le nom ESPN depuis l'abv retourné par l'IA
        const teamAbv    = (p.team || '').toUpperCase();
        const espnName   = ABV_TO_ESPN_NAME[teamAbv] || null;
        if (!espnName) return;
        if (!aiByTeam[espnName]) aiByTeam[espnName] = [];
        aiByTeam[espnName].push(p);
      });
    });

    if (Object.keys(aiByTeam).length === 0) {
      Logger.info('AI_INJURIES_NO_DATA', {});
      return injuryReport;
    }

    // Merger les données IA sur le rapport ESPN
    const enrichedByTeam = Object.assign({}, injuryReport.by_team);

    Object.entries(aiByTeam).forEach(function([teamName, aiPlayers]) {
      if (!enrichedByTeam[teamName]) {
        enrichedByTeam[teamName] = [];
      }

      const existingPlayers = enrichedByTeam[teamName];

      aiPlayers.forEach(function(aiPlayer) {
        // Chercher si le joueur existe déjà dans ESPN
        const existingIdx = existingPlayers.findIndex(function(ep) {
          return ep.name && ep.name.toLowerCase() === aiPlayer.name.toLowerCase();
        });

        if (existingIdx >= 0) {
          // Joueur existant — enrichir avec données IA
          const existing = existingPlayers[existingIdx];

          // Mettre à jour ppg si manquant
          if ((existing.ppg === null || existing.ppg === undefined) && aiPlayer.ppg !== null) {
            existing.ppg = aiPlayer.ppg;
            // Recalculer impact_weight avec le vrai ppg
            // team_ppg estimé depuis impact existant ou fallback 108
            const teamPpg = 108;
            const sw = { 'Out': 1.0, 'Doubtful': 0.75, 'Day-To-Day': 0.3, 'Questionable': 0.5 };
            const statusWeight = sw[existing.status] || 0.3;
            existing.impact_weight = (aiPlayer.ppg / teamPpg) * statusWeight;
            existing.source = 'tank01_via_ai';
          }

          // Confirmer OUT si DTD et IA dit OUT
          if (
            (existing.status === 'Day-To-Day' || existing.status === 'Doubtful') &&
            (aiPlayer.status === 'OUT' || aiPlayer.status === 'Out')
          ) {
            existing.status = 'Out';
            const sw = { 'Out': 1.0 };
            if (existing.ppg || aiPlayer.ppg) {
              const ppg = existing.ppg || aiPlayer.ppg;
              existing.impact_weight = (ppg / 108) * 1.0;
            } else {
              existing.impact_weight = 0.125; // fallback
            }
            existing.source = 'espn_confirmed_by_ai';
          }

          existingPlayers[existingIdx] = existing;

        } else {
          // Nouveau joueur non listé ESPN — ajouter
          const sw = { 'OUT': 1.0, 'Out': 1.0, 'DOUBTFUL': 0.75, 'Doubtful': 0.75, 'DTD': 0.3 };
          const statusKey = aiPlayer.status || 'OUT';
          const statusWeight = sw[statusKey] || 0.3;
          const ppg = aiPlayer.ppg || null;
          const impact = ppg ? (ppg / 108) * statusWeight : 0.125 * statusWeight;

          existingPlayers.push({
            name:          aiPlayer.name,
            status:        aiPlayer.status === 'OUT' ? 'Out' : aiPlayer.status,
            impact_weight: Math.round(impact * 1000) / 1000,
            ppg:           ppg,
            importance_pct: ppg ? Math.round((ppg / 108) * 100) : 13,
            source:        'ai_only',
          });
        }
      });

      enrichedByTeam[teamName] = existingPlayers;
    });

    const enrichedCount = Object.values(aiByTeam).reduce(function(s, p) { return s + p.length; }, 0);
    Logger.info('AI_INJURIES_ENRICHED', {
      teams:   Object.keys(aiByTeam).length,
      players: enrichedCount,
    });

    return Object.assign({}, injuryReport, { by_team: enrichedByTeam, source: 'espn_injuries_weighted+ai' });

  } catch (err) {
    Logger.warn('AI_INJURIES_ENRICH_FAILED', { message: err.message });
    return injuryReport; // fallback transparent
  }
}

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
