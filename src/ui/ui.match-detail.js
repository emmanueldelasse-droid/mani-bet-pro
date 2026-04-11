/**
 * MANI BET PRO — ui.match-detail.js v3.9
 *
 * AJOUTS v3.8 :
 *   - renderBlocTeamDetail : 5 nouvelles sections depuis /nba/team-detail (worker v6.31).
 *       1. Stats équipes côte à côte enrichies (PPG, OPPG, Net Rating, Win%, score last5,
 *          repos/back-to-back, forme dom/ext, momentum).
 *       2. Top 10 scoreurs par équipe (onglets) — PPG saison + PPG last5 avec tendance ↑↓.
 *          Badge ⭐ si PPG ≥ 20, badge OUT si joueur absent dans pipeline injuries.
 *       3. 10 derniers matchs avec score exact (ex: W 118-109 @ BOS).
 *       4. H2H cette saison + tendance O/U visuelle (barre over/under sur les 10 derniers).
 *       5. Joueurs absents triés par PPG décroissant avec badge couleur et source.
 *   - Skeleton loader pendant le fetch teamDetail (non bloquant).
 *   - renderBlocStats et renderBlocAbsences conservés pour fallback si teamDetail indisponible.
 *
 * AJOUTS v3.7 :
 *   - renderBlocTousLesParis : tableau complet de tous les marchés avec pastille
 *     de probabilité colorée (4 niveaux), cote, edge coloré, mise Kelly.
 *     Remplace renderBlocParis pour une vue exhaustive.
 *   - renderBlocStats : stats équipes côte à côte + 10 derniers matchs W/L
 *     + tendance Over/Under + forme domicile/extérieur récente.
 *   - renderBlocAbsences : liste consolidée des joueurs absents avec ppg et statut.
 *   - renderBlocPourquoi remplacé par analyse décision chiffrée.
 *
 * AJOUTS v3.6 :
 *
 * AJOUTS v3.5 :
 *   - renderBlocPourquoi : détails précis par signal en français simple.
 *     Noms des joueurs blessés, chiffres nets, pourcentages lisibles.
 *
 * AJOUTS v3.1 :
 *   - top_signal sauvegardé dans le payload PaperEngine.placeBet()
 *     → affiché dans ui.history.js sur chaque ligne de pari
 *   - match_time sauvegardé pour affichage heure dans ui.history.js
 *
 * REFONTE v3 :
 *   Nouvel ordre logique : Équipes → Paris → Pourquoi → Fiabilité → Sources
 *   Vocabulaire simplifié. Tableau perturbation supprimé.
 */

import { router }      from './ui.router.js';
import { EngineCore }  from '../engine/engine.core.js';
import { PaperEngine } from '../paper/paper.engine.js';
import { ProviderNBA } from '../providers/provider.nba.js';
import { Logger }      from '../utils/utils.logger.js';

function _americanToDecimal(american) {
  if (!american) return null;
  const n = Number(american);
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

function _decimalToAmerican(decimal) {
  if (!decimal || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

const WORKER_URL = 'https://manibetpro.emmanueldelasse.workers.dev';

const SIGNAL_LABELS = {
  'recent_form_ema':   'Forme récente',
  'home_away_split':   'Avantage domicile',
  'efg_diff':          'Efficacité au tir',
  'net_rating_diff':   'Niveau général (Net Rating)',
  'win_pct_diff':      'Bilan victoires/défaites',
  'absences_impact':   'Blessures',
  'ts_diff':           'Efficacité offensive',
  'avg_pts_diff':      'Points marqués',
  'defensive_diff':    'Défense adverse',
  'back_to_back':      'Matchs consécutifs',
  'rest_days_diff':    'Jours de repos',
};

function _simplifyLabel(label, variable) {
  return SIGNAL_LABELS[variable] ?? label ?? variable;
}

// ── RENDER ────────────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  const matchId = storeInstance.get('activeMatchId');
  if (!matchId) { renderNoMatch(container); return { destroy() {} }; }

  const match = storeInstance.get('matches')?.[matchId];
  if (!match) { renderNoMatch(container); return { destroy() {} }; }

  const analyses = storeInstance.get('analyses') ?? {};
  const analysis = Object.values(analyses).find(a => a.match_id === matchId) ?? null;

  container.innerHTML = renderShell(match, analysis, storeInstance);
  bindEvents(container, storeInstance, match, analysis);
  _loadAndRenderMultiBookOdds(container, match, analysis);

  // Charger teamDetail de façon asynchrone — non bloquant
  _loadAndRenderTeamDetail(container, match, storeInstance);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell(match, analysis, storeInstance) {
  return `
    <div class="match-detail">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>
        <button class="btn btn--ghost" id="share-btn" style="font-size:12px">📤 Partager</button>
      </div>

      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom:var(--space-3)">
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

      ${renderBlocProbas(analysis, match)}
      ${renderBlocTousLesParis(analysis, match)}
      <div id="team-detail-container">${renderBlocTeamDetailSkeleton()}</div>
      ${renderBlocFiabilite(analysis)}
      ${renderBlocSources(analysis)}
    </div>
  `;
}

// ── COTES ESPN ────────────────────────────────────────────────────────────

function renderOddsBar(odds) {
  const spread = odds.spread != null ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread)) : '—';
  const ou     = odds.over_under ?? '—';
  const homeML = odds.home_ml != null ? (odds.home_ml > 0 ? `+${odds.home_ml}` : String(odds.home_ml)) : '—';
  const awayML = odds.away_ml != null ? (odds.away_ml > 0 ? `+${odds.away_ml}` : String(odds.away_ml)) : '—';
  return `
    <div style="margin-top:var(--space-3);display:flex;gap:16px;flex-wrap:wrap">
      <span class="text-muted" style="font-size:11px">📊 DraftKings</span>
      <span class="mono" style="font-size:11px">Spread <strong>${spread}</strong></span>
      <span class="mono" style="font-size:11px">O/U <strong>${ou}</strong></span>
      <span class="mono" style="font-size:11px">DOM <strong>${homeML}</strong></span>
      <span class="mono" style="font-size:11px">EXT <strong>${awayML}</strong></span>
    </div>`;
}

// ── BLOC PROBAS ───────────────────────────────────────────────────────────

function renderBlocProbas(analysis, match) {
  if (!analysis || analysis.predictive_score === null) {
    return `<div class="card match-detail__bloc"><div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">${analysis?.rejection_reason ? formatRejection(analysis.rejection_reason) : 'Données insuffisantes pour une analyse.'}</div></div>`;
  }

  const homeProb = Math.round(analysis.predictive_score * 100);
  const awayProb = 100 - homeProb;
  const homeName = match?.home_team?.name ?? 'Domicile';
  const awayName = match?.away_team?.name ?? 'Extérieur';
  const fairHome = homeProb > 0 ? (100 / homeProb).toFixed(2) : '—';
  const fairAway = awayProb > 0 ? (100 / awayProb).toFixed(2) : '—';

  const best  = analysis.betting_recommendations?.best;
  const edge  = best?.edge ?? 0;
  const qual  = analysis.data_quality_score ?? 0;

  let decisionLabel, decisionColor;
  if (!best || edge < 5)                       { decisionLabel = 'Passer';           decisionColor = 'var(--color-muted)'; }
  else if (edge >= 10 && qual >= 0.80)         { decisionLabel = 'Parier';           decisionColor = 'var(--color-success)'; }
  else if (edge >= 7)                          { decisionLabel = 'Pari intéressant'; decisionColor = 'var(--color-warning)'; }
  else                                         { decisionLabel = 'Passer';           decisionColor = 'var(--color-muted)'; }

  return `
    <div class="card match-detail__bloc">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${homeName}</div>
          <div style="font-size:28px;font-weight:700;color:${homeProb >= awayProb ? 'var(--color-signal)' : 'var(--color-muted)'}">${homeProb}%</div>
          <div style="font-size:10px;color:var(--color-muted)">Cote juste : ${fairHome}</div>
        </div>
        <div style="text-align:center;color:var(--color-muted);font-size:13px">vs</div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">${awayName}</div>
          <div style="font-size:28px;font-weight:700;color:${awayProb > homeProb ? 'var(--color-signal)' : 'var(--color-muted)'}">${awayProb}%</div>
          <div style="font-size:10px;color:var(--color-muted)">Cote juste : ${fairAway}</div>
        </div>
      </div>
      <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:12px">
        <div style="height:100%;width:${homeProb}%;background:var(--color-signal);border-radius:3px"></div>
      </div>
      ${best && edge >= 5 ? `
        <div style="border-left:3px solid ${decisionColor};padding:8px 12px;border-radius:4px;background:var(--color-bg);font-size:12px">
          <span style="font-weight:700;color:${decisionColor}">${decisionLabel}</span>
          <span style="color:var(--color-muted);margin-left:8px">Avantage estimé +${edge}%</span>
        </div>
      ` : `<div style="font-size:12px;color:var(--color-muted)">Aucun avantage suffisant détecté sur ce match.</div>`}
    </div>`;
}

// ── BLOC PARIS ────────────────────────────────────────────────────────────

function renderBlocParis(analysis, match) {
  const betting = analysis?.betting_recommendations;
  const odds    = match?.odds;

  if (!odds) return `<div class="card match-detail__bloc" id="bloc-7"><div class="bloc-header"><span class="bloc-header__title">Paris recommandés</span></div><div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">Cotes non disponibles.</div></div>`;
  if (!betting?.recommendations?.length) return `<div class="card match-detail__bloc" id="bloc-7"><div class="bloc-header"><span class="bloc-header__title">Paris recommandés</span></div><div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">Aucune opportunité détectée.</div></div>`;

  const best       = betting.best;
  const paperState = PaperEngine.load();
  const bankroll   = paperState.current_bankroll ?? 1000;

  const SIDE_LABELS = {
    HOME:  match?.home_team?.name ?? 'Domicile',
    AWAY:  match?.away_team?.name ?? 'Extérieur',
    OVER:  'Over',
    UNDER: 'Under',
  };

  const rows = betting.recommendations.map(r => {
    const isBest      = best && r.type === best.type && r.side === best.side;
    const sideLabel   = SIDE_LABELS[r.side] ?? r.side;
    const oddsDecimal = r.odds_decimal ?? _americanToDecimal(r.odds_line);
    const gainPour100 = oddsDecimal ? Math.round((oddsDecimal - 1) * 100) : null;
    const kellyEuros  = r.kelly_stake > 0 ? Math.round(r.kelly_stake * bankroll * 100) / 100 : null;
    const edgeColor   = r.edge >= 12 ? 'var(--color-success)' : r.edge >= 7 ? 'var(--color-warning)' : 'var(--color-muted)';
    const marketLabel = r.type === 'MONEYLINE' ? 'Vainqueur du match' : r.type === 'SPREAD' ? 'Handicap' : 'Total de points';

    let sideDisplay = sideLabel;
    if (r.type === 'SPREAD')      sideDisplay = `${sideLabel} ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts`;
    else if (r.type === 'OVER_UNDER') sideDisplay = r.side === 'OVER' ? `Plus de ${r.ou_line ?? '—'} pts` : `Moins de ${r.ou_line ?? '—'} pts`;

    const motorProb = r.side === 'HOME' ? Math.round(analysis.predictive_score * 100)
                    : r.side === 'AWAY' ? Math.round((1 - analysis.predictive_score) * 100)
                    : r.motor_prob;

    let whyText = '';
    if (r.type === 'MONEYLINE') {
      if (r.is_contrarian) {
        // Pari sur l'outsider : le moteur favorise l'adversaire mais la cote est sous-évaluée
        whyText = `Bien que le moteur favorise l'adversaire, la cote ${oddsDecimal} sur ${sideLabel} est sous-évaluée par le marché. Le moteur estime ${motorProb}% de chances — la cote implicite du bookmaker est inférieure, d'où un avantage de +${r.edge}%.`;
      } else {
        whyText = `Le moteur estime ${motorProb}% de chances pour ${sideLabel}. La cote ${oddsDecimal} chez ${r.odds_source ?? 'le bookmaker'} offre un avantage de +${r.edge}%.`;
      }
    }
    else if (r.type === 'SPREAD')    whyText = `Le moteur pense que ${sideLabel} peut gagner avec ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts d'écart. La cote de ${oddsDecimal} sous-estime cette probabilité.`;
    else if (r.type === 'OVER_UNDER') whyText = r.side === 'OVER' ? `Le moteur projette un match à points élevés. La ligne de ${r.ou_line} pts semble trop basse.` : `Le moteur projette un match serré et défensif. La ligne de ${r.ou_line} pts semble trop haute.`;

    return `
      <div style="background:var(--color-bg);border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid ${isBest ? 'var(--color-success)' : 'var(--color-border)'}">
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);font-weight:700;margin-bottom:8px;letter-spacing:0.05em">★ MEILLEUR PARI</div>' : ''}
        <div style="margin-bottom:10px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">${marketLabel}</div>
          <div style="font-size:17px;font-weight:700">${sideDisplay}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Cote</div>
            <div style="font-size:22px;font-weight:700;color:var(--color-signal)">${oddsDecimal ?? '—'}</div>
            ${gainPour100 ? `<div style="font-size:10px;color:var(--color-muted)">+${gainPour100}€ pour 100€ misés</div>` : ''}
            ${r.odds_source ? `<div style="font-size:9px;color:var(--color-muted);text-transform:uppercase">${r.odds_source}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">Avantage estimé</div>
            <div style="font-size:22px;font-weight:700;color:${edgeColor}">+${r.edge}%</div>
            ${kellyEuros ? `<div style="font-size:10px;color:var(--color-muted)">Mise conseillée : ${kellyEuros}€</div>` : ''}
          </div>
        </div>
        <div style="font-size:12px;color:var(--color-muted);line-height:1.6;padding:8px 10px;background:var(--color-card);border-radius:6px;margin-bottom:10px">${whyText}</div>
        <button class="btn btn--primary paper-bet-btn" style="width:100%;padding:10px;font-size:13px;font-weight:600"
          data-market="${r.type}"
          data-side="${r.side}"
          data-side-label="${sideDisplay}"
          data-odds="${r.odds_line}"
          data-edge="${r.edge}"
          data-motor-prob="${r.motor_prob}"
          data-implied-prob="${r.implied_prob}"
          data-kelly="${r.kelly_stake ?? 0}"
          data-spread-line="${r.spread_line ?? ''}"
          data-ou-line="${r.ou_line ?? ''}"
        >📋 Enregistrer ce pari</button>
      </div>`;
  }).join('');

  return `
    <div class="card match-detail__bloc" id="bloc-7">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Paris recommandés</span>
        <span class="text-muted" style="font-size:11px">${betting.recommendations.length} marché${betting.recommendations.length > 1 ? 's' : ''}</span>
      </div>
      <div>${rows}</div>
    </div>`;
}

// ── BLOC POURQUOI ─────────────────────────────────────────────────────────

/**
 * v3.5 : Détails précis par signal en français simple.
 * Chaque signal affiche une explication concrète avec chiffres.
 */
function renderBlocPourquoi(analysis, match, storeInstance) {
  const signals     = (analysis?.key_signals ?? []).slice(0, 3);
  const homeName    = match?.home_team?.name ?? 'Domicile';
  const awayName    = match?.away_team?.name ?? 'Extérieur';
  const vars        = analysis?.variables_used ?? {};

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Pourquoi ce pari ?</span>
      </div>
      ${!signals.length ? `<div class="text-muted" style="font-size:12px">Aucun signal significatif.</div>` : `
        <div style="display:grid;gap:10px">
          ${signals.map(s => {
            const isHome   = s.direction === 'POSITIVE';
            const teamName = isHome ? homeName : awayName;
            const icon     = isHome ? '▲' : '▼';
            const color    = isHome ? 'var(--color-success)' : 'var(--color-danger)';
            const detail   = _getSignalDetail(s, vars, match, isHome, homeName, awayName);
            return `
              <div style="padding:10px 12px;background:var(--color-bg);border-radius:8px;border-left:3px solid ${color}">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:${detail ? '5px' : '0'}">
                  <span style="font-size:15px;color:${color};font-weight:700">${icon}</span>
                  <div style="font-size:13px;font-weight:600">${_simplifyLabel(s.label, s.variable)}</div>
                </div>
                ${detail ? `<div style="font-size:12px;color:var(--color-muted);line-height:1.5;padding-left:23px">${detail}</div>` : ''}
              </div>`;
          }).join('')}
        </div>`}
    </div>`;
}

/**
 * Génère un texte explicatif précis et en français simple pour chaque signal.
 */
function _getSignalDetail(signal, vars, match, isHome, homeName, awayName) {
  const favTeam = isHome ? homeName : awayName;
  const othTeam = isHome ? awayName : homeName;
  const v       = vars[signal.variable];
  const val     = v?.value ?? null;

  switch (signal.variable) {

    case 'net_rating_diff': {
      // Ex : "CLE marque en moyenne 4 pts de plus qu'elle n'en encaisse. ATL seulement 2 pts."
      if (val === null) return null;
      const favRating = Math.abs(val) > 0 ? (isHome ? val : -val) : val;
      const othRating = -favRating + val * 0;
      // Approximation : val = home - away, donc home = away + val
      // On affiche juste l'écart
      const ecart = Math.abs(val).toFixed(1);
      if (Math.abs(val) < 1) return `Les deux équipes sont au même niveau cette saison.`;
      return `${favTeam} est meilleure de <strong>${ecart} points</strong> par match en moyenne que ${othTeam} cette saison.`;
    }

    case 'efg_diff': {
      if (val === null) return null;
      const pct = Math.abs(val * 100).toFixed(1);
      return `${favTeam} tire plus efficacement que ${othTeam} — un écart de <strong>${pct}%</strong> d'efficacité au tir.`;
    }

    case 'recent_form_ema': {
      if (val === null) return null;
      const absVal = Math.abs(val);
      if (absVal > 0.5) return `${favTeam} est en très grande forme en ce moment — série de victoires récentes.`;
      if (absVal > 0.2) return `${favTeam} est en bonne forme sur ses derniers matchs.`;
      return `${favTeam} a un léger avantage de forme récente sur ${othTeam}.`;
    }

    case 'home_away_split': {
      const raw = v?.raw;
      if (!raw) return `${favTeam} performe mieux dans son contexte (dom./ext.) que ${othTeam}.`;
      const homeWin = raw.home_home_win_pct != null ? Math.round(raw.home_home_win_pct * 100) : null;
      const awayWin = raw.away_away_win_pct != null ? Math.round(raw.away_away_win_pct * 100) : null;
      if (homeWin !== null && awayWin !== null) {
        return `${homeName} gagne <strong>${homeWin}%</strong> de ses matchs à domicile. ${awayName} seulement <strong>${awayWin}%</strong> à l'extérieur.`;
      }
      return `${favTeam} performe mieux dans son contexte (dom./ext.) que ${othTeam}.`;
    }

    case 'absences_impact': {
      const raw = v?.raw;
      if (!raw) return null;
      // Récupérer les joueurs absents depuis les injuries du match
      const homeInj = match?.home_injuries ?? [];
      const awayInj = match?.away_injuries ?? [];
      const affectedInj = isHome ? awayInj : homeInj; // l'équipe défavorisée
      const stars = affectedInj
        .filter(p => p.status === 'Out' || p.status === 'Doubtful')
        .filter(p => p.ppg != null && p.ppg > 10 || p.source === 'espn_confirmed_by_ai' || p.source === 'ai_only' || p.source === 'tank01_via_ai')
        .slice(0, 3)
        .map(p => {
          const statut = p.status === 'Out' ? 'absent' : 'incertain';
          return p.ppg ? `${p.name} (${statut}, ${p.ppg} pts/match)` : `${p.name} (${statut})`;
        });
      if (stars.length > 0) {
        return `${othTeam} est affaibli — <strong>${stars.join(', ')}</strong>.`;
      }
      const homeOut = raw.home_out ?? 0;
      const awayOut = raw.away_out ?? 0;
      const moreOut = isHome ? awayOut : homeOut;
      if (moreOut > 0) return `${othTeam} a <strong>${moreOut} joueur${moreOut > 1 ? 's' : ''} absent${moreOut > 1 ? 's' : ''}</strong> ce soir.`;
      return `${favTeam} a moins de joueurs absents que ${othTeam}.`;
    }

    case 'win_pct_diff': {
      if (val === null) return null;
      const pct = Math.abs(val * 100).toFixed(0);
      return `${favTeam} a un meilleur bilan victoires/défaites que ${othTeam} — <strong>${pct}%</strong> d'écart.`;
    }

    case 'back_to_back': {
      return `${othTeam} joue son deuxième match en deux jours — fatigue accumulée.`;
    }

    case 'rest_days_diff': {
      if (val === null) return null;
      const jours = Math.abs(Math.round(val));
      return `${favTeam} a eu <strong>${jours} jour${jours > 1 ? 's' : ''} de repos</strong> de plus que ${othTeam}.`;
    }

    case 'defensive_diff': {
      if (val === null) return null;
      return `${favTeam} encaisse moins de points par match que ${othTeam} — meilleure défense.`;
    }

    default:
      return null;
  }
}


// ── BLOC TOUS LES PARIS ───────────────────────────────────────────────────

/**
 * v3.7 : Tableau exhaustif de tous les marchés disponibles.
 * Pastille ronde colorée par niveau de probabilité moteur :
 *   < 50% → rouge, 50-60% → orange, 60-75% → vert clair, > 75% → vert foncé
 * Edge coloré : > 8% vert, 4-8% orange, < 4% ou négatif rouge/gris.
 */
function renderBlocTousLesParis(analysis, match) {
  const homeProb   = analysis?.predictive_score != null ? Math.round(analysis.predictive_score * 100) : null;
  const awayProb   = homeProb != null ? 100 - homeProb : null;
  const homeName   = match?.home_team?.name ?? 'DOM';
  const awayName   = match?.away_team?.name ?? 'EXT';
  const homeAbbr   = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr   = match?.away_team?.abbreviation ?? 'EXT';
  const odds       = match?.odds;
  const marketOdds = match?.market_odds;
  const betting    = analysis?.betting_recommendations;
  const paperState = PaperEngine.load();
  const bankroll   = paperState.current_bankroll ?? 500;

  // Fonction pastille couleur
  function _probPill(prob) {
    if (prob === null) return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-border);flex-shrink:0"></span>';
    let bg;
    if (prob < 50)      bg = '#ef4444';
    else if (prob < 60) bg = '#f97316';
    else if (prob < 75) bg = '#22c55e';
    else                bg = '#16a34a';
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${bg};flex-shrink:0;box-shadow:0 0 4px ${bg}44"></span>`;
  }

  // Fonction couleur edge
  function _edgeColor(edge) {
    if (edge >= 8)  return '#22c55e';
    if (edge >= 4)  return '#f97316';
    if (edge > 0)   return 'var(--color-muted)';
    return '#ef4444';
  }

  // Construire les lignes du tableau
  const rows = [];

  // Récupérer les cotes depuis market_odds (Pinnacle/Betclic) ou ESPN
  const getOdds = (type, side) => {
    if (marketOdds) {
      if (type === 'ML')   return side === 'HOME' ? marketOdds.home_ml_decimal   : marketOdds.away_ml_decimal;
      if (type === 'SPRD') return side === 'HOME' ? marketOdds.home_spread_decimal : marketOdds.away_spread_decimal;
      if (type === 'OVER') return marketOdds.over_decimal;
      if (type === 'UNDR') return marketOdds.under_decimal;
    }
    if (odds) {
      if (type === 'ML')   return side === 'HOME' ? _americanToDecimal(odds.home_ml) : _americanToDecimal(odds.away_ml);
    }
    return null;
  };

  const getOddsSource = () => {
    if (marketOdds?.best_book) return marketOdds.best_book;
    if (marketOdds)            return 'Pinnacle';
    return 'DraftKings';
  };

  // Trouver les recommandations existantes pour les mises Kelly
  const findRec = (type, side) => betting?.recommendations?.find(r => r.type === type && r.side === side) ?? null;

  // Ligne helper
  const buildRow = (label, type, side, prob, oddsDec, rec, spreadLine, ouLine) => {
    if (!oddsDec) return null;
    const impliedProb = Math.round((1 / oddsDec) * 100);
    const edge = prob !== null ? prob - impliedProb : null;
    const kellyEuros = rec?.kelly_stake > 0 ? Math.round(rec.kelly_stake * bankroll * 100) / 100 : null;
    const isBest = betting?.best?.type === type && betting?.best?.side === side;

    let betData = `data-market="${type}" data-side="${side}" data-side-label="${label}" data-odds="${_decimalToAmerican(oddsDec) ?? 0}" data-edge="${edge ?? 0}" data-motor-prob="${prob ?? 0}" data-implied-prob="${impliedProb}" data-kelly="${rec?.kelly_stake ?? 0}" data-spread-line="${spreadLine ?? ''}" data-ou-line="${ouLine ?? ''}"`;

    return `
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:9px 10px;background:${isBest ? 'rgba(34,197,94,0.06)' : 'var(--color-bg)'};border-radius:8px;border:1px solid ${isBest ? 'rgba(34,197,94,0.3)' : 'transparent'};margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          ${_probPill(prob)}
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
            <div style="font-size:10px;color:var(--color-muted)">${prob !== null ? prob + '% moteur' : '—'} · impl. ${impliedProb}%</div>
          </div>
        </div>
        <div style="text-align:center;min-width:42px">
          <div style="font-size:14px;font-weight:700;color:var(--color-signal)">${oddsDec}</div>
          <div style="font-size:9px;color:var(--color-muted)">${getOddsSource()}</div>
        </div>
        <div style="text-align:center;min-width:40px">
          ${edge !== null ? `<div style="font-size:13px;font-weight:700;color:${_edgeColor(edge)}">${edge > 0 ? '+' : ''}${edge}%</div>` : '<div style="color:var(--color-muted);font-size:11px">—</div>'}
          ${kellyEuros ? `<div style="font-size:9px;color:var(--color-muted)">${kellyEuros}€</div>` : ''}
        </div>
        <div>
          <button class="paper-bet-btn" ${betData} style="font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid var(--color-border);background:var(--color-card);color:var(--color-text);cursor:pointer;white-space:nowrap">📋</button>
        </div>
      </div>`;
  };

  // ML
  const homeMLOdds = getOdds('ML', 'HOME');
  const awayMLOdds = getOdds('ML', 'AWAY');
  if (homeMLOdds) rows.push(buildRow(`${homeAbbr} vainqueur`, 'MONEYLINE', 'HOME', homeProb, homeMLOdds, findRec('MONEYLINE', 'HOME'), null, null));
  if (awayMLOdds) rows.push(buildRow(`${awayAbbr} vainqueur`, 'MONEYLINE', 'AWAY', awayProb, awayMLOdds, findRec('MONEYLINE', 'AWAY'), null, null));

  // Spread
  const spread = odds?.spread ?? marketOdds?.spread_line;
  if (spread != null) {
    const homeSpreadOdds = getOdds('SPRD', 'HOME');
    const awaySpreadOdds = getOdds('SPRD', 'AWAY');
    const spreadDisp = spread > 0 ? `+${spread}` : String(spread);
    if (homeSpreadOdds) rows.push(buildRow(`${homeAbbr} ${spreadDisp} pts`, 'SPREAD', 'HOME', homeProb, homeSpreadOdds, findRec('SPREAD', 'HOME'), spread, null));
    if (awaySpreadOdds) rows.push(buildRow(`${awayAbbr} ${spread > 0 ? '-' : '+'}${Math.abs(spread)} pts`, 'SPREAD', 'AWAY', awayProb, awaySpreadOdds, findRec('SPREAD', 'AWAY'), -spread, null));
  }

  // Over/Under
  const ou = odds?.over_under ?? marketOdds?.ou_line;
  if (ou != null) {
    const overOdds  = getOdds('OVER', 'OVER');
    const underOdds = getOdds('UNDR', 'UNDER');
    // Prob Over/Under approximée depuis le score prévu
    const projTotal = homeProb != null ? Math.round((analysis.predictive_score * 100 + (100 - analysis.predictive_score * 100)) / 100 * (ou * 1.05)) : null;
    const overProb  = overOdds  ? Math.round((1 / overOdds)  * 100) : null; // utiliser implied si pas de prob moteur
    const underProb = underOdds ? Math.round((1 / underOdds) * 100) : null;
    if (overOdds)  rows.push(buildRow(`Plus de ${ou} pts`,  'OVER_UNDER', 'OVER',  null, overOdds,  findRec('OVER_UNDER', 'OVER'),  null, ou));
    if (underOdds) rows.push(buildRow(`Moins de ${ou} pts`, 'OVER_UNDER', 'UNDER', null, underOdds, findRec('OVER_UNDER', 'UNDER'), null, ou));
  }

  const validRows = rows.filter(Boolean);
  if (!validRows.length) return '';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">Tous les marchés</span>
        <span class="text-muted" style="font-size:10px">● prob. moteur · impl. = prob. implicite book</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:4px;padding:6px 10px;margin-bottom:4px">
        <div style="font-size:10px;color:var(--color-muted)">Pari</div>
        <div style="font-size:10px;color:var(--color-muted);text-align:center">Cote</div>
        <div style="font-size:10px;color:var(--color-muted);text-align:center">Edge</div>
        <div></div>
      </div>
      ${validRows.join('')}
    </div>`;
}

// ── BLOC STATS & FORME ────────────────────────────────────────────────────

/**
 * v3.7 : Stats équipes côte à côte + 10 derniers matchs + tendances.
 * Données issues de variables_used (moteur) et recentForms (store).
 */
function renderBlocStats(analysis, match, storeInstance) {
  const homeName  = match?.home_team?.name ?? 'DOM';
  const awayName  = match?.away_team?.name ?? 'EXT';
  const homeAbbr  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr  = match?.away_team?.abbreviation ?? 'EXT';
  const vars      = analysis?.variables_used ?? {};

  // Stats saison depuis advanced_stats
  const advStats  = storeInstance?.get('advancedStats') ?? {};
  const homeStats = advStats?.[homeName] ?? {};
  const awayStats = advStats?.[awayName] ?? {};

  // Forme récente depuis le store
  const recentForms = storeInstance?.get('recentForms') ?? {};
  const homeFormKey = Object.keys(recentForms).find(k => recentForms[k]?.matches?.length > 0 && k === String(match?.home_team?.bdl_id ?? ''));
  const awayFormKey = Object.keys(recentForms).find(k => recentForms[k]?.matches?.length > 0 && k === String(match?.away_team?.bdl_id ?? ''));
  const homeForm  = homeFormKey ? recentForms[homeFormKey] : null;
  const awayForm  = awayFormKey ? recentForms[awayFormKey] : null;

  // Net rating depuis variables_used
  const netDiff   = vars.net_rating_diff?.value ?? null;
  const homeNet   = homeStats.net_rating ?? null;
  const awayNet   = awayStats.net_rating ?? null;

  // PPG depuis home/away season stats
  const homePPG   = match?.home_season_stats?.points_per_game ?? homeStats?.ppg ?? null;
  const awayPPG   = match?.away_season_stats?.points_per_game ?? awayStats?.ppg ?? null;
  const homeOPPG  = homeStats?.defensive_rating ?? null;
  const awayOPPG  = awayStats?.defensive_rating ?? null;

  // Win% depuis match record
  const parseRecord = (rec) => {
    if (!rec) return null;
    const parts = rec.split('-');
    if (parts.length < 2) return null;
    const w = parseInt(parts[0]), l = parseInt(parts[1]);
    return w + l > 0 ? Math.round(w / (w + l) * 100) : null;
  };
  const homeWinPct = parseRecord(match?.home_team?.record);
  const awayWinPct = parseRecord(match?.away_team?.record);

  // Stats des 10 derniers matchs
  const buildFormSummary = (form) => {
    if (!form?.matches?.length) return null;
    const matches = form.matches.slice(0, 10);
    const wins    = matches.filter(m => m.won).length;
    const margins = matches.map(m => m.margin).filter(m => m != null);
    const avgMargin = margins.length ? (margins.reduce((s,m) => s+m, 0) / margins.length).toFixed(1) : null;
    const ou_line   = match?.odds?.over_under ?? null;
    let overCount = 0;
    if (ou_line) {
      matches.forEach(m => {
        if (m.team_score != null && m.opp_score != null) {
          if (m.team_score + m.opp_score > ou_line) overCount++;
        }
      });
    }
    return { wins, total: matches.length, avgMargin, overCount, ouTotal: ou_line ? matches.filter(m => m.team_score != null).length : 0, matches };
  };

  const homeFormSum = buildFormSummary(homeForm);
  const awayFormSum = buildFormSummary(awayForm);

  // Affichage W/L des 10 derniers
  const renderWL = (form, abbr) => {
    if (!form?.matches?.length) return `<div style="font-size:11px;color:var(--color-muted)">Données indisponibles</div>`;
    return `<div style="display:flex;gap:3px;flex-wrap:wrap">
      ${form.matches.slice(0, 10).map(m => {
        const color = m.won ? '#22c55e' : '#ef4444';
        const score = m.team_score != null ? `${m.team_score}-${m.opp_score}` : '';
        return `<span style="width:22px;height:22px;border-radius:4px;background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${color}" title="${score}">${m.won ? 'V' : 'D'}</span>`;
      }).join('')}
    </div>`;
  };

  const statRow = (label, homeVal, awayVal, higherIsBetter = true) => {
    if (homeVal === null && awayVal === null) return '';
    const homeNum = parseFloat(homeVal);
    const awayNum = parseFloat(awayVal);
    const homeWins = !isNaN(homeNum) && !isNaN(awayNum) && (higherIsBetter ? homeNum > awayNum : homeNum < awayNum);
    const awayWins = !isNaN(homeNum) && !isNaN(awayNum) && (higherIsBetter ? awayNum > homeNum : awayNum < homeNum);
    return `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
        <div style="font-size:12px;font-weight:${homeWins ? '700' : '400'};color:${homeWins ? 'var(--color-text)' : 'var(--color-muted)'}">${homeVal ?? '—'}</div>
        <div style="font-size:10px;color:var(--color-muted);text-align:center;white-space:nowrap">${label}</div>
        <div style="font-size:12px;font-weight:${awayWins ? '700' : '400'};color:${awayWins ? 'var(--color-text)' : 'var(--color-muted)'};text-align:right">${awayVal ?? '—'}</div>
      </div>`;
  };

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Stats & Forme</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--color-signal)">${homeAbbr}</div>
        <div style="font-size:10px;color:var(--color-muted);text-align:center">Saison</div>
        <div style="font-size:12px;font-weight:700;color:var(--color-signal);text-align:right">${awayAbbr}</div>
      </div>

      ${statRow('Pts marqués/match', homePPG ? homePPG.toFixed(1) : null, awayPPG ? awayPPG.toFixed(1) : null)}
      ${statRow('Pts encaissés/match', homeOPPG ? homeOPPG.toFixed(1) : null, awayOPPG ? awayOPPG.toFixed(1) : null, false)}
      ${statRow('Net Rating', homeNet ? (homeNet > 0 ? '+'+homeNet.toFixed(1) : homeNet.toFixed(1)) : null, awayNet ? (awayNet > 0 ? '+'+awayNet.toFixed(1) : awayNet.toFixed(1)) : null)}
      ${statRow('Win %', homeWinPct ? homeWinPct+'%' : null, awayWinPct ? awayWinPct+'%' : null)}
      ${homeFormSum ? statRow('Moy. écart (10j)', homeFormSum.avgMargin ? (homeFormSum.avgMargin > 0 ? '+'+homeFormSum.avgMargin : homeFormSum.avgMargin)+'pts' : null, awayFormSum?.avgMargin ? (awayFormSum.avgMargin > 0 ? '+'+awayFormSum.avgMargin : awayFormSum.avgMargin)+'pts' : null) : ''}

      <div style="margin-top:12px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:6px">10 derniers matchs</div>
        <div style="margin-bottom:8px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:4px">${homeAbbr} — ${homeFormSum ? homeFormSum.wins+'V/'+( homeFormSum.total - homeFormSum.wins)+'D' : '—'}</div>
          ${renderWL(homeForm, homeAbbr)}
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:4px">${awayAbbr} — ${awayFormSum ? awayFormSum.wins+'V/'+(awayFormSum.total - awayFormSum.wins)+'D' : '—'}</div>
          ${renderWL(awayForm, awayAbbr)}
        </div>
      </div>

      ${match?.odds?.over_under && (homeFormSum?.ouTotal > 0 || awayFormSum?.ouTotal > 0) ? `
        <div style="margin-top:10px;padding:8px 10px;background:var(--color-bg);border-radius:8px">
          <div style="font-size:11px;color:var(--color-muted);margin-bottom:4px">Tendance Over/Under (ligne : ${match.odds.over_under} pts)</div>
          <div style="display:flex;gap:12px;font-size:12px">
            ${homeFormSum?.ouTotal > 0 ? `<span>${homeAbbr} : <strong>${homeFormSum.overCount}/${homeFormSum.ouTotal}</strong> Over</span>` : ''}
            ${awayFormSum?.ouTotal > 0 ? `<span>${awayAbbr} : <strong>${awayFormSum.overCount}/${awayFormSum.ouTotal}</strong> Over</span>` : ''}
          </div>
        </div>` : ''}
    </div>`;
}

// ── BLOC ABSENCES & CONTEXTE ──────────────────────────────────────────────

/**
 * v3.7 : Joueurs absents consolidés + contexte IA.
 */
function renderBlocAbsences(analysis, match, storeInstance) {
  const homeInj   = match?.home_injuries ?? [];
  const awayInj   = match?.away_injuries ?? [];
  const homeName  = match?.home_team?.name ?? 'DOM';
  const awayName  = match?.away_team?.name ?? 'EXT';

  const STATUS_LABELS = { 'Out': 'Absent', 'Doubtful': 'Incertain', 'Day-To-Day': 'DTD', 'Questionable': 'Douteux', 'Limited': 'Limité' };
  const STATUS_COLORS = { 'Out': '#ef4444', 'Doubtful': '#f97316', 'Day-To-Day': '#f59e0b', 'Questionable': '#f59e0b', 'Limited': '#3b82f6' };

  const renderPlayerList = (injuries, teamName) => {
    const relevant = injuries.filter(p => ['Out', 'Doubtful', 'Questionable', 'Day-To-Day', 'Limited'].includes(p.status));
    if (!relevant.length) return `<div style="font-size:11px;color:var(--color-muted)">Aucune absence signalée</div>`;
    return relevant.map(p => {
      const color  = STATUS_COLORS[p.status] ?? 'var(--color-muted)';
      const label  = STATUS_LABELS[p.status] ?? p.status;
      const isStar = p.ppg != null && p.ppg >= 20;
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--color-border)">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <span style="font-size:12px;font-weight:${isStar ? '700' : '500'}">${p.name}</span>
            ${p.ppg ? `<span style="font-size:10px;color:var(--color-muted);margin-left:4px">${p.ppg} pts/m</span>` : ''}
            ${isStar ? '<span style="font-size:9px;color:#f97316;margin-left:4px">★ STAR</span>' : ''}
          </div>
          <span style="font-size:10px;font-weight:600;color:${color};flex-shrink:0">${label}</span>
        </div>`;
    }).join('');
  };

  const hasInjuries = homeInj.length > 0 || awayInj.length > 0;

  if (!hasInjuries) return ''; 

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Absences & Contexte</span>
      </div>

      ${hasInjuries ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:${hasContext ? '12px' : '0'}">
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin-bottom:6px">${match?.home_team?.abbreviation ?? 'DOM'}</div>
            ${renderPlayerList(homeInj, homeName)}
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin-bottom:6px">${match?.away_team?.abbreviation ?? 'EXT'}</div>
            ${renderPlayerList(awayInj, awayName)}
          </div>
        </div>` : ''}
    </div>`;
}

// ── BLOC FIABILITÉ ────────────────────────────────────────────────────────

function renderBlocFiabilite(analysis) {
  const rob   = analysis?.robustness_score;
  const qual  = analysis?.data_quality_score;
  const score = rob !== null && qual !== null ? Math.round(((rob + qual) / 2) * 100) : null;

  let label, color;
  if (score === null)   { label = '—';       color = 'var(--color-muted)'; }
  else if (score >= 80) { label = 'Élevée';  color = 'var(--color-success)'; }
  else if (score >= 60) { label = 'Moyenne'; color = 'var(--color-warning)'; }
  else                  { label = 'Faible';  color = 'var(--color-danger)'; }

  const missing       = analysis?.missing_variables ?? [];
  const missingSimple = missing.map(v => SIGNAL_LABELS[v] ?? v).slice(0, 2);

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Fiabilité de l'analyse</span>
        ${score !== null ? `<span style="font-weight:700;color:${color}">${label}</span>` : ''}
      </div>
      ${score !== null ? `
        <div style="height:8px;border-radius:4px;overflow:hidden;background:var(--color-border);margin-bottom:8px">
          <div style="height:100%;width:${score}%;background:${color};border-radius:4px;transition:width 0.5s ease"></div>
        </div>
        <div style="font-size:12px;color:var(--color-muted);margin-bottom:${missingSimple.length ? '10px' : '0'}">
          ${score >= 80 && missingSimple.length === 0 ? 'Données complètes et cohérentes. L\'analyse est fiable.'
            : score >= 80 ? 'Analyse fiable malgré quelques données manquantes.'
            : score >= 60 ? 'Quelques données manquantes. L\'analyse reste valable.'
            : 'Données insuffisantes. À prendre avec précaution.'}
        </div>
        ${missingSimple.length ? `<div style="font-size:11px;color:var(--color-warning);padding:6px 10px;background:rgba(255,165,0,0.08);border-radius:6px;border-left:2px solid var(--color-warning)">⚠ Données manquantes : ${missingSimple.join(' · ')}</div>` : ''}
      ` : `<div class="text-muted" style="font-size:12px">Non calculée.</div>`}
    </div>`;
}

// ── BLOC SOURCES ──────────────────────────────────────────────────────────

function renderBlocSources(analysis) {
  const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
  const fields    = Object.entries(breakdown);

  const QUALITY_LABELS = { VERIFIED: 'Vérifié', WEIGHTED: 'Pondéré (Tank01)', PARTIAL: 'Partiel', ESTIMATED: 'Estimé', LOW_SAMPLE: 'Faible échantillon', UNCALIBRATED: 'Non calibré', INSUFFICIENT_SAMPLE: 'Insuffisant', MISSING: 'Absent' };
  const QUALITY_COLORS = { VERIFIED: 'var(--color-success)', WEIGHTED: 'var(--color-success)', PARTIAL: 'var(--color-warning)', ESTIMATED: 'var(--color-warning)', LOW_SAMPLE: 'var(--color-warning)', UNCALIBRATED: 'var(--color-muted)', INSUFFICIENT_SAMPLE: 'var(--color-danger)', MISSING: 'var(--color-danger)' };

  return `
    <div class="card match-detail__bloc">
      <div class="collapsible" id="sources-collapsible">
        <div class="collapsible__header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:2px 0">
          <span class="bloc-header__title">Sources des données</span>
          <span class="collapsible__arrow text-muted" style="font-size:12px">▾ Voir</span>
        </div>
        <div class="collapsible__body" style="display:none;margin-top:var(--space-3)">
          ${!fields.length ? `<div class="text-muted" style="font-size:12px">Non disponibles.</div>` : `
            <div style="display:grid;gap:6px">
              ${fields.map(([varId, d]) => {
                const label = _simplifyLabel(d.label, varId);
                const q     = QUALITY_LABELS[d.quality] ?? d.quality;
                const color = QUALITY_COLORS[d.quality] ?? 'var(--color-muted)';
                return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px"><span>${label}</span><span style="color:${color};font-size:11px">${q}</span></div>`;
              }).join('')}
            </div>`}
        </div>
      </div>
    </div>`;
}

// ── BLOC IA ───────────────────────────────────────────────────────────────


