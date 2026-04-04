/**
 * MANI BET PRO — data.orchestrator.js
 *
 * Pipeline de chargement garantie.
 * Responsabilité unique : coordonner ESPN + BDL + Injuries
 * avant de déclencher l'analyse du moteur.
 *
 * Flux garanti :
 *   1. ESPN matches        (obligatoire — bloque si échoue)
 *   2. ESPN injuries       (parallèle avec BDL)
 *      BDL toutes équipes  (séquentiel par lots de 3, retry sur 429)
 *   3. await les deux
 *   4. Analyser tous les matchs
 *   5. Stocker dans le store
 */

import { ProviderNBA }      from '../providers/provider.nba.js';
import { ProviderInjuries } from '../providers/provider.injuries.js';
import { EngineCore }       from '../engine/engine.core.js';
import { Logger }           from '../utils/utils.logger.js';
import { LoadingUI }        from '../ui/ui.loading.js';

// Mapping nom équipe ESPN → ID BallDontLie (officiel NBA 1-30)
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

export class DataOrchestrator {

  /**
   * Point d'entrée unique. Charge toutes les données puis analyse.
   * @param {string} date — YYYY-MM-DD
   * @param {Store} store
   * @returns {Promise<{ matches: Array, analyses: object }|null>}
   */
  static async loadAndAnalyze(date, store) {
    try {
      // ── ÉTAPE 1 : ESPN matches (obligatoire) ──────────────────────────
      LoadingUI.update('ESPN matches…', 0);
      const espnData = await ProviderNBA.getMatchesToday(date);

      if (!espnData?.matches?.length) {
        Logger.warn('ORCHESTRATOR_NO_MATCHES', { date });
        return null;
      }

      const matches = espnData.matches;

      // Vider les analyses précédentes si on change de date
      const prevDate = store.get('dashboardFilters')?.selectedDate;
      if (prevDate && prevDate !== date) {
        store.set({ matches: {}, analyses: {} });
      }

      // Stocker les matchs dans le store immédiatement
      matches.forEach(match => {
        store.upsert('matches', match.id, { ...match, sport: 'NBA' });
      });

      // ── ÉTAPE 2 : Injuries + BDL + Odds en parallèle ────────────────
      LoadingUI.update('Blessures + forme récente + cotes…', 20);

      const season = _getCurrentNBASeason();
      const teamIds = _extractTeamIds(matches);

      // Lancer les 3 sources en parallèle
      const [injuryReport, recentForms, oddsComparison, advancedStats] = await Promise.all([
        _loadInjuries(date),
        _loadRecentForms(teamIds, season),
        _loadOddsComparison(),
        _loadAdvancedStats(),
      ]);

      // ── ÉTAPE 3 : Analyser tous les matchs ────────────────────────────
      LoadingUI.update('Analyse en cours…', 70);

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
   * Accessible depuis la fiche match pour re-analyse ciblée.
   * @param {object} match
   * @param {object} recentForms — { [bdlId]: NBARecentForm }
   * @param {object|null} injuryReport
   * @returns {object} rawData
   */
  static buildRawData(match, recentForms, injuryReport) {
    const homeBDLId    = _getBDLId(match.home_team?.name);
    const awayBDLId    = _getBDLId(match.away_team?.name);
    const homeTeamName = match.home_team?.name;
    const awayTeamName = match.away_team?.name;

    const homeRecent = homeBDLId ? recentForms[homeBDLId] ?? null : null;
    const awayRecent = awayBDLId ? recentForms[awayBDLId] ?? null : null;

    const homeInjuries = injuryReport && homeTeamName
      ? ProviderInjuries.getForTeam(injuryReport, homeTeamName)
      : null;
    const awayInjuries = injuryReport && awayTeamName
      ? ProviderInjuries.getForTeam(injuryReport, awayTeamName)
      : null;

    return {
      match_id:           match.id,
      home_season_stats:  match.home_season_stats ?? null,
      away_season_stats:  match.away_season_stats ?? null,
      home_recent:        homeRecent,
      away_recent:        awayRecent,
      home_injuries:      homeInjuries?.length > 0 ? homeInjuries : null,
      away_injuries:      awayInjuries?.length > 0 ? awayInjuries : null,
      odds:               match.odds ?? null,
      absences_confirmed: injuryReport !== null,
      advanced_stats:     advancedStats ?? null,
      market_odds:        null,
    };
  }

  /** Expose le mapping BDL pour usage externe */
  static getBDLId(teamName) {
    return _getBDLId(teamName);
  }
}

// ── FONCTIONS PRIVÉES ─────────────────────────────────────────────────────

/** Résout le BDL ID depuis le nom d'équipe ESPN */
function _getBDLId(teamName) {
  return teamName ? (TEAM_NAME_TO_BDL_ID[teamName] ?? null) : null;
}

/** Extrait les BDL IDs uniques de tous les matchs */
function _extractTeamIds(matches) {
  const ids = new Set();
  matches.forEach(m => {
    const homeId = _getBDLId(m.home_team?.name);
    const awayId = _getBDLId(m.away_team?.name);
    if (homeId) ids.add(homeId);
    if (awayId) ids.add(awayId);
  });
  return [...ids];
}

/** Charge les injuries ESPN (priorité) avec fallback PDF */
async function _loadInjuries(date) {
  try {
    return await ProviderInjuries.getReport(date);
  } catch (err) {
    Logger.warn('ORCHESTRATOR_INJURIES_FAILED', { message: err.message });
    return null;
  }
}

/**
 * Charge la forme récente BDL pour toutes les équipes.
 * Séquentiel par lots de 3 pour respecter le rate limit (60 req/min).
 * Retry automatique sur 429 géré côté Worker.
 */
async function _loadRecentForms(teamIds, season) {
  const forms = {};
  const BATCH_SIZE  = 6;    // augmenté — BDL supporte 60 req/min
  const BATCH_DELAY = 200;  // réduit — inutile d'attendre 500ms

  for (let i = 0; i < teamIds.length; i += BATCH_SIZE) {
    const batch = teamIds.slice(i, i + BATCH_SIZE);

    LoadingUI.update(
      `Forme récente (${Math.min(i + BATCH_SIZE, teamIds.length)}/${teamIds.length})…`,
      20 + Math.round((i / teamIds.length) * 40)
    );

    await Promise.allSettled(
      batch.map(async (bdlId) => {
        const form = await ProviderNBA.getRecentForm(bdlId, season, 10);
        if (form?.matches?.length > 0) {
          forms[bdlId] = form;
        }
      })
    );

    // Pause entre les lots sauf pour le dernier
    if (i + BATCH_SIZE < teamIds.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return forms;
}

/**
 * Analyse tous les matchs avec les données complètes.
 * Stocke les analyses dans le store.
 */
async function _analyzeMatches(matches, recentForms, injuryReport, oddsComparison, advancedStats, date, store) {
  const analyses  = {};
  let conclusive  = 0;
  let rejected    = 0;

  for (const match of matches) {
    try {
      const rawData  = DataOrchestrator.buildRawData(match, recentForms, injuryReport, advancedStats);

      // Injecter les vraies cotes multi-books si disponibles
      if (oddsComparison?.matches) {
        const matchOdds = ProviderNBA.findMatchOdds(
          oddsComparison,
          match.home_team?.name,
          match.away_team?.name
        );
        if (matchOdds) rawData.market_odds = matchOdds;
      }
      const analysis = EngineCore.compute('NBA', rawData);

      const enriched = { ...analysis, match_id: match.id };
      store.upsert('analyses', analysis.analysis_id, enriched);
      analyses[match.id] = enriched;

      // Historique (max 100 entrées, confidence non INCONCLUSIVE)
      if (analysis.confidence_level !== 'INCONCLUSIVE') {
        store.push('history', {
          analysis_id:      analysis.analysis_id,
          match_id:         match.id,
          date,
          home:             match.home_team?.name ?? '—',
          away:             match.away_team?.name ?? '—',
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

/** Charge les cotes multi-books depuis The Odds API */
async function _loadOddsComparison() {
  try {
    return await ProviderNBA.getOddsComparison();
  } catch (err) {
    Logger.warn('ORCHESTRATOR_ODDS_FAILED', { message: err.message });
    return null;
  }
}

/** Calcule la saison NBA courante */
function _getCurrentNBASeason() {
  const now = new Date();
  return String(now.getMonth() + 1 >= 10 ? now.getFullYear() : now.getFullYear() - 1);
}
