/**
 * MANI BET PRO — ui.match-detail.js v3.8
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
 *   - renderBlocAbsences : liste consolidée des joueurs absents avec ppg,
 *     statut et contexte IA (team_context, market_signal).
 *   - renderBlocPourquoi remplacé par analyse décision chiffrée.
 *
 * AJOUTS v3.6 :
 *   - renderBlocPourquoi : affiche team_context (forme récente, enjeu) et market_signal (mouvement ligne) depuis données IA.
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
      ${renderBlocContexteMatch(match, storeInstance)}
      ${renderBlocTousLesParis(analysis, match)}
      ${renderBlocMarketAudit(analysis, match)}
      ${renderBlocPourquoi(analysis, match, storeInstance)}
      <div id="team-detail-container">${renderBlocTeamDetailSkeleton()}</div>
      ${renderBlocFiabilite(analysis)}
      ${renderBlocSources(analysis)}
      ${renderBlocIA(analysis, match, storeInstance)}
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

  const homeOddsDec = match?.market_odds?.home_ml_decimal ?? _americanToDecimal(match?.odds?.home_ml);
  const awayOddsDec = match?.market_odds?.away_ml_decimal ?? _americanToDecimal(match?.odds?.away_ml);
  const marketHomeProb = homeOddsDec ? Math.round((1 / homeOddsDec) * 100) : null;
  const marketAwayProb = awayOddsDec ? Math.round((1 / awayOddsDec) * 100) : null;
  const engineFav = homeProb === awayProb ? null : (homeProb > awayProb ? 'HOME' : 'AWAY');
  const marketFav = marketHomeProb !== null && marketAwayProb !== null && marketHomeProb !== marketAwayProb
    ? (marketHomeProb > marketAwayProb ? 'HOME' : 'AWAY')
    : null;
  const divergence = engineFav && marketFav && engineFav !== marketFav;
  const divergenceGap = divergence
    ? Math.abs((engineFav === 'HOME' ? homeProb : awayProb) - (engineFav === 'HOME' ? marketHomeProb : marketAwayProb))
    : 0;

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
      ${divergence ? `
        <div style="margin-top:10px;padding:8px 12px;border-left:3px solid var(--color-warning);border-radius:6px;background:rgba(249,115,22,0.08);font-size:12px;color:var(--color-muted)">
          <strong style="color:var(--color-warning)">Divergence moteur / marché</strong> — Le moteur favorise ${engineFav === 'HOME' ? homeName : awayName}, alors que le marché favorise ${marketFav === 'HOME' ? homeName : awayName}${divergenceGap ? ` · écart ~${divergenceGap} pts de probabilité` : ''}.
        </div>
      ` : ''}
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


// ── BLOC CONTEXTE MATCH ──────────────────────────────────────────────────

function renderBlocContexteMatch(match, storeInstance) {
  const injReport = storeInstance?.get('injuryReport') ?? null;
  const teamCtx   = injReport?.team_context ?? {};
  const marketSig = injReport?.market_signal ?? null;
  const homeName  = match?.home_team?.name ?? 'Domicile';
  const awayName  = match?.away_team?.name ?? 'Extérieur';
  const homeAbv   = match?.home_team?.abbreviation ?? null;
  const awayAbv   = match?.away_team?.abbreviation ?? null;

  const homeCtx = teamCtx?.[homeName] ?? teamCtx?.[homeAbv] ?? teamCtx?.home_note ?? null;
  const awayCtx = teamCtx?.[awayName] ?? teamCtx?.[awayAbv] ?? teamCtx?.away_note ?? null;
  const urgency = teamCtx?.urgency ?? null;
  const keyInfo = teamCtx?.key_info ?? null;
  const marketDetail = marketSig?.detail ?? null;

  if (!homeCtx && !awayCtx && !urgency && !keyInfo && !marketDetail) return '';

  const urgencyLabel = urgency === 'high'
    ? 'Enjeu élevé'
    : urgency === 'medium'
      ? 'Enjeu modéré'
      : urgency === 'low'
        ? 'Enjeu faible'
        : null;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Contexte du match</span>
      </div>
      <div style="display:grid;gap:10px;font-size:13px;line-height:1.65">
        ${homeCtx ? `
          <div style="padding:10px 12px;background:var(--color-bg);border-radius:8px;border-left:3px solid var(--color-signal)">
            <div style="font-weight:600;margin-bottom:4px">${homeName} — contexte</div>
            <div style="color:var(--color-muted)">${homeCtx}</div>
          </div>` : ''}
        ${awayCtx ? `
          <div style="padding:10px 12px;background:var(--color-bg);border-radius:8px;border-left:3px solid var(--color-signal)">
            <div style="font-weight:600;margin-bottom:4px">${awayName} — contexte</div>
            <div style="color:var(--color-muted)">${awayCtx}</div>
          </div>` : ''}
        ${marketDetail ? `
          <div style="padding:10px 12px;background:var(--color-bg);border-radius:8px;border-left:3px solid var(--color-warning)">
            <div style="font-weight:600;margin-bottom:4px">Marché</div>
            <div style="color:var(--color-muted)">${marketDetail}</div>
          </div>` : ''}
      </div>
      ${(urgencyLabel || keyInfo) ? `
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${urgencyLabel ? `<span class="badge badge--inconclusive">${urgencyLabel}</span>` : ''}
          ${keyInfo ? `<span style="font-size:12px;color:var(--color-muted)">• ${keyInfo}</span>` : ''}
        </div>` : ''}
      <div style="margin-top:10px;font-size:11px;color:var(--color-muted)">Données enrichies du contexte · sans impact sur le score moteur</div>
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
  // team_context et market_signal depuis le rapport injuries enrichi IA (stocké dans le store)
  const injReport   = storeInstance?.get('injuryReport') ?? null;
  const teamCtx     = injReport?.team_context ?? null;
  const marketSig   = injReport?.market_signal ?? null;
  const homeCtx     = teamCtx?.[homeName] ?? null;
  const awayCtx     = teamCtx?.[awayName] ?? null;

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
      ${homeCtx || awayCtx ? `
        <div style="margin-top:10px;display:grid;gap:8px">
          ${homeCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;color:var(--color-muted)">
            <strong style="color:var(--color-text)">${homeName}</strong> — ${homeCtx}
          </div>` : ''}
          ${awayCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;color:var(--color-muted)">
            <strong style="color:var(--color-text)">${awayName}</strong> — ${awayCtx}
          </div>` : ''}
        </div>` : ''}
      ${marketSig?.movement ? `
        <div style="margin-top:8px;font-size:12px;padding:8px 12px;background:rgba(99,179,237,0.06);border-left:3px solid var(--color-signal);border-radius:6px;color:var(--color-muted)">
          📈 <strong style="color:var(--color-signal)">Mouvement de ligne</strong> — ${marketSig.detail ?? ''}
        </div>` : ''}
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
        <span class="bloc-header__title">Stats équipes</span>
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
  const injReport = storeInstance?.get('injuryReport') ?? null;
  const teamCtx   = injReport?.team_context ?? {};
  const marketSig = injReport?.market_signal ?? null;
  const homeCtx   = teamCtx?.[homeName] ?? null;
  const awayCtx   = teamCtx?.[awayName] ?? null;

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
  const hasContext  = homeCtx || awayCtx || marketSig;

  if (!hasInjuries && !hasContext) return '';

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

      ${homeCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;margin-bottom:6px;color:var(--color-muted)"><strong style="color:var(--color-text)">${homeName}</strong> — ${homeCtx}</div>` : ''}
      ${awayCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;margin-bottom:6px;color:var(--color-muted)"><strong style="color:var(--color-text)">${awayName}</strong> — ${awayCtx}</div>` : ''}
      ${marketSig?.movement ? `<div style="font-size:12px;padding:8px 12px;background:rgba(99,179,237,0.06);border-left:3px solid var(--color-signal);border-radius:6px;color:var(--color-muted)">📈 <strong style="color:var(--color-signal)">Mouvement de ligne</strong> — ${marketSig.detail ?? ''}</div>` : ''}
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

function renderBlocIA(analysis, match, storeInstance) {
  const homeName = match?.home_team?.name ?? 'Domicile';
  const awayName = match?.away_team?.name ?? 'Extérieur';
  const score = analysis?.predictive_score;
  const best = analysis?.betting_recommendations?.best ?? null;
  const signals = (analysis?.key_signals ?? []).slice(0, 3);
  const topSignal = signals[0] ?? null;
  const dataScore = analysis?.data_quality_score ?? 0;
  const missing = Array.isArray(analysis?.missing_variables) ? analysis.missing_variables : [];
  const injReport = storeInstance?.get('injuryReport') ?? null;
  const homeCtx = injReport?.team_context?.[homeName] ?? null;
  const awayCtx = injReport?.team_context?.[awayName] ?? null;
  const marketSig = injReport?.market_signal ?? null;

  const homeProb = score != null ? Math.round(score * 100) : null;
  const awayProb = homeProb != null ? 100 - homeProb : null;
  const favName = homeProb == null ? null : (homeProb >= awayProb ? homeName : awayName);
  const riskText = missing.length ? `Points de vigilance : ${missing.slice(0, 2).join(' · ')}.` : 'Pas de manque critique détecté dans les données affichées.';

  let signalText = 'Lecture neutre : aucun signal moteur dominant clairement exploitable.';
  if (topSignal) {
    const dirHome = topSignal.direction === 'POSITIVE';
    const leanTeam = dirHome ? homeName : awayName;
    signalText = `Signal principal : ${_simplifyLabel(topSignal.label, topSignal.variable)} en faveur de ${leanTeam}.`;
  } else if (favName) {
    signalText = `Signal principal : avantage global du moteur pour ${favName}.`;
  }

  let prudenceText = 'Prudence standard.';
  if (!best) prudenceText = 'Prudence élevée : aucun marché ne présente un avantage suffisant.';
  else if ((best.edge ?? 0) >= 10 && dataScore >= 0.8) prudenceText = 'Confiance correcte : avantage chiffré détecté avec données solides.';
  else if ((best.edge ?? 0) >= 5) prudenceText = 'Avantage théorique présent, mais marge de sécurité limitée.';

  const contextBits = [homeCtx, awayCtx, marketSig?.detail].filter(Boolean).slice(0, 2);
  const contextHtml = contextBits.length
    ? `<div style="margin-top:10px;font-size:12px;color:var(--color-muted)">${contextBits.map(c => `<div style="margin-top:4px">• ${c}</div>`).join('')}</div>`
    : '';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Lecture rapide</span>
      </div>
      <div style="display:grid;gap:8px;font-size:13px;line-height:1.7">
        <div><strong>À retenir</strong> — ${signalText}</div>
        <div><strong>Risque principal</strong> — ${riskText}</div>
        <div><strong>Niveau de prudence</strong> — ${prudenceText}</div>
      </div>
      ${contextHtml}
      <div style="margin-top:10px;font-size:11px;color:var(--color-muted)">Bloc déterministe · sans appel IA</div>
    </div>`;
}

function renderBlocMarketAudit(analysis, match) {
  const best = analysis?.betting_recommendations?.best ?? null;
  if (!best) return '';

  const typeLabel = best.type === 'MONEYLINE' ? 'Vainqueur' : best.type === 'SPREAD' ? 'Handicap' : 'Total points';
  const selection = best.side === 'HOME'
    ? (match?.home_team?.abbreviation ?? 'DOM')
    : best.side === 'AWAY'
      ? (match?.away_team?.abbreviation ?? 'EXT')
      : best.side === 'OVER' ? 'Over' : 'Under';
  const lineText = best.type === 'SPREAD'
    ? (best.spread_line != null ? `${selection} ${best.spread_line > 0 ? '+' : ''}${best.spread_line}` : '—')
    : best.type === 'OVER_UNDER'
      ? (best.ou_line != null ? `${selection} ${best.ou_line}` : '—')
      : '—';
  const oddsDec = best.odds_decimal ?? _americanToDecimal(best.odds_line);
  const implied = best.implied_prob != null ? `${best.implied_prob}%` : '—';
  const motor = best.motor_prob != null ? `${best.motor_prob}%` : '—';
  const edge = best.edge != null ? `${best.edge > 0 ? '+' : ''}${best.edge}%` : '—';
  const source = best.odds_source ?? match?.market_odds?.best_book ?? match?.odds?.source ?? 'Book';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Audit marché</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;font-size:12px;line-height:1.6">
        <div><span style="color:var(--color-muted)">Marché</span><br><strong>${typeLabel}</strong></div>
        <div><span style="color:var(--color-muted)">Sélection</span><br><strong>${selection}</strong></div>
        <div><span style="color:var(--color-muted)">Book utilisé</span><br><strong>${source}</strong></div>
        <div><span style="color:var(--color-muted)">Ligne utilisée</span><br><strong>${lineText}</strong></div>
        <div><span style="color:var(--color-muted)">Cote utilisée</span><br><strong>${oddsDec ?? '—'}</strong></div>
        <div><span style="color:var(--color-muted)">Edge final</span><br><strong style="color:${best.edge >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${edge}</strong></div>
        <div><span style="color:var(--color-muted)">Prob. marché</span><br><strong>${implied}</strong></div>
        <div><span style="color:var(--color-muted)">Prob. moteur</span><br><strong>${motor}</strong></div>
      </div>
    </div>`;
}

// ── COTES MULTI-BOOKS ────────────────────────────────────────────────────

async function _loadAndRenderMultiBookOdds(container, match, analysis) {
  try {
    const comparison = await ProviderNBA.getOddsComparison();
    if (!comparison) return;
    const matchOdds = ProviderNBA.findMatchOdds(comparison, match.home_team?.name, match.away_team?.name);
    if (!matchOdds?.bookmakers?.length) return;
    const bloc7 = container.querySelector('#bloc-7');
    if (!bloc7) return;
    const existing = bloc7.querySelector('.multibook-table');
    if (existing) existing.remove();

    const BOOK_LABELS = { winamax: 'Winamax', betclic: 'Betclic', unibet_eu: 'Unibet', betsson: 'Betsson', pinnacle: 'Pinnacle', bet365: 'Bet365' };
    const isFlipped  = matchOdds.home_team !== match.home_team?.name;

    const rows = matchOdds.bookmakers.map(bk => {
      const homeOdds = isFlipped ? bk.away_ml : bk.home_ml;
      const awayOdds = isFlipped ? bk.home_ml : bk.away_ml;
      const label    = BOOK_LABELS[bk.key] ?? bk.title;
      return `<tr style="border-bottom:1px solid var(--color-border)"><td style="padding:6px 8px;font-size:12px;color:var(--color-muted)">${label}</td><td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${homeOdds === matchOdds.best_home_ml ? '700' : '400'};color:${homeOdds === matchOdds.best_home_ml ? 'var(--color-success)' : 'var(--color-text)'}">${homeOdds?.toFixed(2) ?? '—'}</td><td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${awayOdds === matchOdds.best_away_ml ? '700' : '400'};color:${awayOdds === matchOdds.best_away_ml ? 'var(--color-success)' : 'var(--color-text)'}">${awayOdds?.toFixed(2) ?? '—'}</td></tr>`;
    }).join('');

    const table = document.createElement('div');
    table.className  = 'multibook-table';
    table.style.cssText = 'margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px';
    table.innerHTML = `
      <div class="collapsible" id="books-collapsible">
        <div class="collapsible__header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:0">
          <span style="font-size:11px;color:var(--color-muted);font-weight:600">Comparer les cotes (${matchOdds.bookmakers.length} bookmakers)</span>
          <span class="collapsible__arrow text-muted" style="font-size:12px">▾</span>
        </div>
        <div class="collapsible__body" style="display:none;margin-top:10px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--color-border)"><th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:left;font-weight:500">Bookmaker</th><th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.home_team?.abbreviation ?? 'DOM'}</th><th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.away_team?.abbreviation ?? 'EXT'}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="font-size:10px;color:var(--color-muted);margin-top:6px">★ Meilleure cote en vert · Source : The Odds API</div>
        </div>
      </div>`;

    bloc7.appendChild(table);
    _checkBetterOddsAlert(bloc7, matchOdds, match, analysis);

    table.querySelector('#books-collapsible')?.querySelector('.collapsible__header')?.addEventListener('click', () => {
      const body = table.querySelector('.collapsible__body');
      const arrow = table.querySelector('.collapsible__arrow');
      const open  = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      arrow.textContent  = open ? '▾' : '▴';
    });
  } catch {}
}

function _checkBetterOddsAlert(bloc7, matchOdds, match, analysis) {
  if (!analysis?.betting_recommendations?.best) return;
  const best      = analysis.betting_recommendations.best;
  const isFlipped = matchOdds.home_team !== match.home_team?.name;
  const draftKings = _americanToDecimal(best.odds_line);
  const sideIsHome = best.side === 'HOME';
  let bestExternal = null, bestBook = null;
  for (const bk of (matchOdds.bookmakers ?? [])) {
    const odds = isFlipped ? (sideIsHome ? bk.away_ml : bk.home_ml) : (sideIsHome ? bk.home_ml : bk.away_ml);
    if (odds && (!bestExternal || odds > bestExternal)) { bestExternal = odds; bestBook = bk.title; }
  }
  if (!bestExternal || !draftKings || bestExternal <= draftKings) return;
  const existing = bloc7.querySelector('.better-odds-alert');
  if (existing) existing.remove();
  const alert = document.createElement('div');
  alert.className = 'better-odds-alert';
  alert.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(72,199,142,0.1);border-left:3px solid var(--color-success);border-radius:6px;font-size:12px;';
  alert.innerHTML = `<div style="color:var(--color-success);font-weight:700;margin-bottom:2px">💡 Meilleure cote disponible</div><div style="color:var(--color-muted)">${bestBook} propose <strong style="color:var(--color-text)">${bestExternal.toFixed(2)}</strong> au lieu de ${draftKings} — misez sur ${bestBook}.</div>`;
  bloc7.appendChild(alert);
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────

function bindEvents(container, storeInstance, match, analysis) {
  container.querySelector('#back-btn')?.addEventListener('click', () => router.navigate('dashboard'));

  container.querySelector('#share-btn')?.addEventListener('click', () => {
    if (!analysis?.betting_recommendations?.best) return;
    const best      = analysis.betting_recommendations.best;
    const SIDE_MAP  = { HOME: match.home_team?.name, AWAY: match.away_team?.name, OVER: 'Over', UNDER: 'Under' };
    const sideLabel = SIDE_MAP[best.side] ?? best.side;
    const odds      = _americanToDecimal(best.odds_line);
    const text = `🏀 ${match.home_team?.name} vs ${match.away_team?.name}\n✅ Pari : ${sideLabel} @ ${odds}\n📊 Avantage : +${best.edge}%\n🤖 Mani Bet Pro`;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = container.querySelector('#share-btn');
      if (btn) { btn.textContent = '✓ Copié !'; setTimeout(() => btn.textContent = '📤 Partager', 2000); }
    });
  });

  container.querySelectorAll('.collapsible').forEach(el => {
    el.querySelector('.collapsible__header')?.addEventListener('click', () => {
      const body  = el.querySelector('.collapsible__body');
      const arrow = el.querySelector('.collapsible__arrow');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▾ Voir' : '▴ Masquer';
    });
  });

  container.querySelectorAll('.paper-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => _openBetModal(btn, match, analysis, storeInstance));
  });

  if (analysis?.explanation_context) {
    container.querySelectorAll('[data-ai-task]').forEach(btn => {
      btn.addEventListener('click', () => triggerAIExplanation(container, analysis, match, btn.dataset.aiTask));
    });
  }
}

// ── APPEL IA ─────────────────────────────────────────────────────────────

// Cache mémoire session pour éviter les appels Claude répétés sur le même match
// Clé : match.id + task — stable entre clics dans la même session
const _aiSessionCache = new Map();

async function triggerAIExplanation(container, analysis, match, task) {
  const responseEl = container.querySelector('#ai-response');
  if (!responseEl) return;

  // Vérifier le cache session — évite appel Claude si déjà demandé ce soir
  const _cacheKey = `${match?.id ?? 'unknown'}_${task}`;
  if (_aiSessionCache.has(_cacheKey)) {
    responseEl.innerHTML = _aiSessionCache.get(_cacheKey);
    return;
  }

  responseEl.innerHTML = '<span class="text-muted">Analyse en cours…</span>';

  const TASK_PROMPTS = {
    EXPLAIN: `Tu es un analyste sportif NBA. Réponds en 3-4 phrases courtes, sans titres, sans gras, sans listes. N'invente aucun chiffre. Utilise uniquement les valeurs du contexte. Phrase 1 : quelle équipe est favorisée et pourquoi. Phrase 2 : le signal principal en termes simples. Phrase 3 : si un pari recommandé est fourni, confirme ou nuance-le — sinon dis explicitement qu'aucune valeur n'a été détectée et qu'il vaut mieux passer. Phrase 4 : une limite courte. Max 80 mots.`,
    AUDIT: `Tu es un analyste sportif NBA. En 2-3 phrases simples sans titres ni listes : dis si les signaux sont cohérents entre eux. Si contradiction, explique laquelle. Uniquement les données fournies. Max 60 mots.`,
    DETECT_INCONSISTENCY: `Tu es un analyste sportif NBA. En 2 phrases simples sans titres ni listes : dis s'il y a une anomalie dans les données. Si aucune anomalie, dis-le clairement. Max 50 mots.`,
  };

  const home   = match.home_team?.name ?? '—';
  const away   = match.away_team?.name ?? '—';
  const score  = analysis.predictive_score !== null ? Math.round(analysis.predictive_score * 100) : null;
  const favori = score !== null ? (score > 50 ? `${home} (${score}%)` : score < 50 ? `${away} (${100 - score}%)` : 'Équilibré (50%)') : 'Non déterminé';
  const best   = analysis.betting_recommendations?.best;
  const parisInfo = best ? `Pari recommandé : ${best.side} à cote ${best.odds_decimal ?? '—'}, edge +${best.edge}%` : 'Aucun pari recommandé — aucune valeur détectée sur ce match.';

  const userMessage = `N'INVENTE AUCUN CHIFFRE. Utilise uniquement les valeurs ci-dessous.\nMatch : ${home} vs ${away}\nFavori : ${favori}\nScore prédictif : ${score ?? 'non calculé'}%\nRobustesse : ${analysis.robustness_score !== null ? Math.round(analysis.robustness_score * 100) + '%' : 'non calculée'}\nQualité données : ${analysis.data_quality_score !== null ? Math.round(analysis.data_quality_score * 100) + '%' : 'non calculée'}\n${parisInfo}\nSignaux :\n${(analysis.key_signals ?? []).slice(0, 3).map(s => `- ${_simplifyLabel(s.label, s.variable)} : ${s.direction === 'POSITIVE' ? 'avantage domicile' : 'avantage extérieur'}`).join('\n')}\nVariables manquantes : ${(analysis.missing_critical ?? []).join(', ') || 'aucune'}`.trim();

  try {
    const response = await fetch(`${WORKER_URL}/ai/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system: TASK_PROMPTS[task] ?? TASK_PROMPTS.EXPLAIN, messages: [{ role: 'user', content: userMessage }] }),
    });
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    const data = await response.json();
    const text = data.content?.map(b => b.type === 'text' ? b.text : '').join('\n').trim();
    if (!text) throw new Error('Réponse vide');
    const clean = text.replace(/^#{1,4}\s.+$/gm, '').replace(/\*\*(.+?)\*\*/gs, '$1').replace(/\*(.+?)\*/gs, '$1').replace(/^[-•]\s/gm, '').trim();
    const htmlResult = `<div style="line-height:1.8;font-size:13px">${escapeHtml(clean)}</div><div class="text-muted" style="font-size:10px;margin-top:var(--space-2)">Source : Claude Sonnet · Basé uniquement sur les données du moteur</div>`;
    responseEl.innerHTML = htmlResult;
    // Stocker en cache session — même clic = 0 appel Claude
    _aiSessionCache.set(_cacheKey, htmlResult);
  } catch (err) {
    Logger.error('AI_EXPLANATION_ERROR', { message: err.message });
    responseEl.innerHTML = `<div class="text-muted" style="font-size:12px">Erreur : ${escapeHtml(err.message)}</div>`;
  }
}

// ── MODAL PAPER TRADING ──────────────────────────────────────────────────

function _openBetModal(btn, match, analysis, storeInstance) {
  const market      = btn.dataset.market;
  const side        = btn.dataset.side;
  const sideLabel   = btn.dataset.sideLabel;
  const odds        = Number(btn.dataset.odds);
  const edge        = Number(btn.dataset.edge);
  const motorProb   = Number(btn.dataset.motorProb);
  const impliedProb = Number(btn.dataset.impliedProb);
  const kelly       = Number(btn.dataset.kelly);
  const spreadLine  = btn.dataset.spreadLine !== '' ? Number(btn.dataset.spreadLine) : null;
  const ouLine      = btn.dataset.ouLine !== '' ? Number(btn.dataset.ouLine) : null;

  const state       = PaperEngine.load();
  const bankroll    = state.current_bankroll;
  const kellySugg   = kelly > 0 ? Math.round(kelly * bankroll * 100) / 100 : null;
  const oddsDecimal = _americanToDecimal(odds);
  const marketLabels = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts' };

  const modal = document.createElement('div');
  modal.className = 'paper-modal-overlay';
  modal.innerHTML = `
    <div class="paper-modal">
      <div class="paper-modal__header">
        <span style="font-weight:700;font-size:15px">Enregistrer un pari</span>
        <button class="paper-modal__close" id="modal-close" style="font-size:18px;line-height:1">✕</button>
      </div>
      <div style="background:var(--color-bg);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${match.home_team?.name ?? '—'} vs ${match.away_team?.name ?? '—'}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--color-muted)">${marketLabels[market] ?? market}</span>
          <span style="font-size:14px;font-weight:700">${sideLabel}</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-signal)">${oddsDecimal}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--color-muted)">
          <span>Avantage <strong style="color:var(--color-text)">${edge}%</strong></span>
          <span>Moteur <strong style="color:var(--color-text)">${motorProb}%</strong></span>
          <span>Book <strong style="color:var(--color-text)">${impliedProb}%</strong></span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <span style="font-size:12px;color:var(--color-muted)">Bankroll disponible</span>
        <span style="font-size:15px;font-weight:700">${bankroll.toFixed(2)} €</span>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">Cote réelle prise <span style="font-style:italic">(modifiez si vous misez sur un autre book)</span></label>
        <input type="number" id="odds-input" class="paper-modal__input" value="${oddsDecimal}" placeholder="Ex: 2.70" step="0.05" min="1.01" style="font-size:20px;font-weight:700;text-align:center;letter-spacing:0.05em"/>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">Mise (€)${kellySugg ? `<span style="color:var(--color-signal);font-weight:600"> · Conseillé : ${kellySugg.toFixed(2)} €</span>` : ''}</label>
        <input type="number" id="stake-input" class="paper-modal__input" value="${kellySugg ?? ''}" placeholder="Montant en €" min="0.5" max="${bankroll.toFixed(2)}" step="0.5" style="font-size:16px;font-weight:600;text-align:center"/>
      </div>
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">Note (optionnel)</label>
        <input type="text" id="note-input" class="paper-modal__input" placeholder="Ex: blessure clé…" maxlength="200"/>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="modal-cancel" style="flex:1;padding:12px">Annuler</button>
        <button class="btn btn--primary" id="modal-confirm" style="flex:2;padding:12px;font-size:14px;font-weight:600">✓ Confirmer</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#modal-confirm')?.addEventListener('click', async () => {
    const stake    = parseFloat(modal.querySelector('#stake-input')?.value);
    const oddsReal = parseFloat(modal.querySelector('#odds-input')?.value) || oddsDecimal;
    const oddsAm   = _decimalToAmerican(oddsReal) ?? odds;
    const note     = modal.querySelector('#note-input')?.value?.trim() ?? null;

    if (!stake || stake <= 0 || stake > bankroll) {
      modal.querySelector('#stake-input')?.classList.add('input--error');
      return;
    }

    // v3.1 : top_signal + match_time sauvegardés dans le pari
    const topSignal = analysis?.key_signals?.[0]
      ? (_simplifyLabel(analysis.key_signals[0].label, analysis.key_signals[0].variable)
         + ' (' + (analysis.key_signals[0].direction === 'POSITIVE' ? '▲ dom.' : '▼ ext.') + ')')
      : null;
    const matchTime = match.datetime
      ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : null;

    const result = await PaperEngine.placeBet({
      match_id: match.id, date: match.date, sport: 'NBA',
      home: match.home_team?.name ?? '—', away: match.away_team?.name ?? '—',
      market, side, side_label: sideLabel,
      odds_taken: oddsAm, odds_decimal: oddsReal, odds_source: null,
      spread_line: spreadLine, ou_line: ouLine,
      stake, kelly_stake: kelly, edge, motor_prob: motorProb, implied_prob: impliedProb,
      confidence_level: analysis?.confidence_level ?? null,
      data_quality: analysis?.data_quality_score ?? null,
      decision_note: note,
      top_signal: topSignal,
      match_time: matchTime,
    });

    modal.remove();
    setTimeout(() => storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 }), 150);
    _showBetConfirmation(sideLabel, odds > 0 ? `+${odds}` : String(odds), stake);
  });
}

function _showBetConfirmation(sideLabel, oddsStr, stake) {
  const toast = document.createElement('div');
  toast.className   = 'toast toast--success';
  toast.textContent = `✓ Pari enregistré : ${sideLabel} ${oddsStr} — ${stake.toFixed(2)} €`;
  document.getElementById('toast-container')?.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function renderNoMatch(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">◪</div>
      <div class="view-placeholder__title">Aucun match sélectionné</div>
      <div class="view-placeholder__sub">Reviens au dashboard et sélectionne un match.</div>
      <button class="btn btn--ghost" id="back-from-empty">← Dashboard</button>
    </div>`;
  container.querySelector('#back-from-empty')?.addEventListener('click', () => router.navigate('dashboard'));
}

function formatMatchTime(match) {
  try {
    if (match.datetime) {
      return new Date(match.datetime).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
        + ' · ' + new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    if (match.date) return new Date(match.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {}
  return '—';
}

function formatRejection(reason) {
  const labels = { WEIGHTS_NOT_CALIBRATED: 'Pondérations non calibrées', MISSING_CRITICAL_DATA: 'Données critiques manquantes', DATA_QUALITY_BELOW_THRESHOLD: 'Qualité des données insuffisante', ROBUSTNESS_BELOW_THRESHOLD: 'Analyse trop instable', ABSENCES_NOT_CONFIRMED: 'Absences non confirmées' };
  return labels[reason] ?? reason;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── TEAM DETAIL — v3.8 ────────────────────────────────────────────────────────

/**
 * Loader asynchrone : fetch /nba/team-detail depuis le store ou le worker,
 * puis injecte le HTML dans #team-detail-container.
 */
async function _loadAndRenderTeamDetail(container, match, storeInstance) {
  const detailEl = container.querySelector('#team-detail-container');
  if (!detailEl) return;

  try {
    // Chercher dans le store en premier (pré-chargé par l'orchestrateur)
    const teamDetails = storeInstance?.get('teamDetails') ?? {};
    let teamDetail = teamDetails[match.id] ?? null;

    // Sinon fetch direct
    if (!teamDetail) {
      const homeAbv = _getTeamAbvFromName(match.home_team?.name);
      const awayAbv = _getTeamAbvFromName(match.away_team?.name);
      if (homeAbv && awayAbv) {
        const resp = await fetch(
          WORKER_URL + '/nba/team-detail?home=' + encodeURIComponent(homeAbv) + '&away=' + encodeURIComponent(awayAbv),
          { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data?.home) teamDetail = data;
        }
      }
    }

    const injReport = storeInstance?.get('injuryReport') ?? null;
    detailEl.innerHTML = renderBlocTeamDetail(match, teamDetail, injReport);

  } catch (err) {
    Logger.warn('TEAM_DETAIL_RENDER_FAILED', { message: err.message });
    // Fallback sur les blocs v3.7 existants
    const injReport = storeInstance?.get('injuryReport') ?? null;
    const analysis  = Object.values(storeInstance?.get('analyses') ?? {}).find(a => a.match_id === match.id) ?? null;
    detailEl.innerHTML =
      renderBlocStats(analysis, match, storeInstance) +
      renderBlocAbsences(analysis, match, storeInstance);
  }
}

function renderBlocTeamDetailSkeleton() {
  return `
    <div class="card match-detail__bloc" style="text-align:center;padding:24px 0">
      <div style="display:inline-flex;align-items:center;gap:8px;color:var(--color-muted);font-size:13px">
        <div style="width:14px;height:14px;border:2px solid var(--color-muted);border-top-color:var(--color-signal);border-radius:50%;animation:spin 0.8s linear infinite"></div>
        Chargement stats avancées…
      </div>
    </div>`;
}

/**
 * Fonction principale : orchestre les 5 blocs teamDetail.
 */
function renderBlocTeamDetail(match, teamDetail, injReport) {
  if (!teamDetail) {
    return `<div class="card match-detail__bloc"><div class="text-muted" style="font-size:12px;padding:8px 0">Stats avancées indisponibles pour ce match.</div></div>`;
  }
  return [
    _renderTDStats(match, teamDetail),
    _renderTDTop10(match, teamDetail, injReport),
    _renderTDLast10(match, teamDetail),
    _renderTDH2H_OU(match, teamDetail),
    _renderTDAbsents(match, injReport),
  ].join('');
}

// ── Helper communs ────────────────────────────────────────────────────────────

function _resultBadge(result) {
  const color = result === 'W' ? '#22c55e' : result === 'L' ? '#ef4444' : '#6b7280';
  const letter = result === 'W' ? 'V' : result === 'L' ? 'D' : '?';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${color};color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${letter}</span>`;
}

function _trendArrow(season, last5) {
  if (!season || !last5) return '';
  const diff = last5 - season;
  if (diff > 1.5)  return `<span style="color:#22c55e;font-size:11px;font-weight:700">↑+${diff.toFixed(1)}</span>`;
  if (diff < -1.5) return `<span style="color:#ef4444;font-size:11px;font-weight:700">↓${diff.toFixed(1)}</span>`;
  return `<span style="color:var(--color-muted);font-size:11px">→${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</span>`;
}

function _restBadge(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return `<span style="background:#ef4444;color:#fff;border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px">B2B</span>`;
  if (days === 1) return `<span style="background:#f97316;color:#fff;border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px">1j</span>`;
  return `<span style="background:rgba(34,197,94,0.15);color:#22c55e;border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px">${days}j</span>`;
}

function _momentumBadge(momentum) {
  if (!momentum) return '';
  const { last3W, last10W } = momentum;
  if (last3W >= 2) return `<span style="color:#22c55e;font-size:11px">🔥 ${last3W}/3 derniers</span>`;
  if (last3W === 0) return `<span style="color:#ef4444;font-size:11px">❄️ ${last3W}/3 derniers</span>`;
  return `<span style="color:var(--color-muted);font-size:11px">→ ${last3W}/3 derniers</span>`;
}

// ── Section 1 : Stats équipes ─────────────────────────────────────────────────

function _renderTDStats(match, teamDetail) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const hStats   = match?.home_season_stats ?? {};
  const aStats   = match?.away_season_stats ?? {};
  const hDetail  = teamDetail?.home ?? {};
  const aDetail  = teamDetail?.away ?? {};

  const rows = [
    { label: 'Pts/match',    hVal: hStats.avg_pts?.toFixed(1),          aVal: aStats.avg_pts?.toFixed(1),          better: 'high' },
    { label: 'Pts encaissés',hVal: hDetail.avgTotal != null ? (hDetail.avgTotal - (hStats.avg_pts ?? 0)).toFixed(1) : null,
                              aVal: aDetail.avgTotal != null ? (aDetail.avgTotal - (aStats.avg_pts ?? 0)).toFixed(1) : null, better: 'low' },
    { label: 'Net Rating',   hVal: hStats.net_rating != null ? (hStats.net_rating > 0 ? '+' : '') + hStats.net_rating?.toFixed(1) : null,
                              aVal: aStats.net_rating != null ? (aStats.net_rating > 0 ? '+' : '') + aStats.net_rating?.toFixed(1) : null, better: 'high', raw: true },
    { label: 'Win %',        hVal: hStats.win_pct != null ? Math.round(hStats.win_pct * 100) + '%' : null,
                              aVal: aStats.win_pct != null ? Math.round(aStats.win_pct * 100) + '%' : null, better: 'high', raw: true },
    { label: 'Moy. total',   hVal: hDetail.avgTotal?.toFixed(1),        aVal: aDetail.avgTotal?.toFixed(1),        better: null },
    { label: 'Pts/m last5',  hVal: hDetail.last5ScoringAvg?.toFixed(1), aVal: aDetail.last5ScoringAvg?.toFixed(1), better: 'high' },
  ];

  const rowsHtml = rows.map(r => {
    if (!r.hVal && !r.aVal) return '';
    const hNum = parseFloat(r.hVal);
    const aNum = parseFloat(r.aVal);
    const hBetter = r.better === 'high' ? hNum > aNum : r.better === 'low' ? hNum < aNum : false;
    const aBetter = r.better === 'high' ? aNum > hNum : r.better === 'low' ? aNum < hNum : false;
    return `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
        <div style="font-size:12px;font-weight:${hBetter ? '700' : '400'};color:${hBetter ? 'var(--color-text)' : 'var(--color-muted)'}">${r.hVal ?? '—'}</div>
        <div style="font-size:10px;color:var(--color-muted);text-align:center;white-space:nowrap">${r.label}</div>
        <div style="font-size:12px;font-weight:${aBetter ? '700' : '400'};color:${aBetter ? 'var(--color-text)' : 'var(--color-muted)'};text-align:right">${r.aVal ?? '—'}</div>
      </div>`;
  }).join('');

  const hHomeSplit = hDetail.homeSplit;
  const hAwaySplit = hDetail.awaySplit;
  const aHomeSplit = aDetail.homeSplit;
  const aAwaySplit = aDetail.awaySplit;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">📊 Stats équipes</span>
        <div style="display:flex;gap:6px;align-items:center;font-size:11px">
          <strong>${homeAbv}</strong>${_restBadge(hDetail.restDays)}
          <span style="color:var(--color-muted)">vs</span>
          <strong>${awayAbv}</strong>${_restBadge(aDetail.restDays)}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:var(--color-signal)">${homeAbv}</div>
        <div style="font-size:9px;color:var(--color-muted);text-align:center">Saison</div>
        <div style="font-size:11px;font-weight:700;color:var(--color-signal);text-align:right">${awayAbv}</div>
      </div>
      ${rowsHtml}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <div style="background:var(--color-bg);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:3px">${homeAbv} — Dom/Ext</div>
          <div style="font-size:11px">🏠 ${hHomeSplit ? `${hHomeSplit.wins}-${hHomeSplit.losses}` : '—'} · ✈️ ${hAwaySplit ? `${hAwaySplit.wins}-${hAwaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(hDetail.momentum)}</div>
        </div>
        <div style="background:var(--color-bg);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:3px">${awayAbv} — Dom/Ext</div>
          <div style="font-size:11px">🏠 ${aHomeSplit ? `${aHomeSplit.wins}-${aHomeSplit.losses}` : '—'} · ✈️ ${aAwaySplit ? `${aAwaySplit.wins}-${aAwaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(aDetail.momentum)}</div>
        </div>
      </div>
    </div>`;
}

// ── Section 2 : Top 10 scoreurs ───────────────────────────────────────────────

function _renderTDTop10(match, teamDetail, injReport) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';
  const uid = 'top10_' + (match?.id ?? Date.now());

  const absentNames = new Set();
  if (injReport?.by_team) {
    Object.values(injReport.by_team).forEach(players =>
      players.forEach(p => { if (p?.name) absentNames.add(p.name.toLowerCase()); })
    );
  }

  const renderTable = (players) => {
    if (!players?.length) return `<div style="font-size:12px;color:var(--color-muted);padding:8px">Données indisponibles</div>`;
    return `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="border-bottom:1px solid var(--color-border)">
            <th style="padding:5px 6px;text-align:left;color:var(--color-muted);font-weight:600">Joueur</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">PPG</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">L5</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">REB</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">AST</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">STL</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-muted);font-weight:600">BLK</th>
          </tr>
        </thead>
        <tbody>
          ${players.map((p, i) => {
            const absent = absentNames.has((p.name ?? '').toLowerCase());
            const star   = p.pts >= 20;
            const bg     = absent ? 'rgba(239,68,68,0.06)' : i % 2 === 0 ? '' : 'var(--color-bg)';
            return `
              <tr style="background:${bg};border-bottom:1px solid var(--color-border);${absent ? 'opacity:0.65' : ''}">
                <td style="padding:6px 6px;color:${absent ? '#ef4444' : 'var(--color-text)'};white-space:nowrap;overflow:hidden;max-width:110px;text-overflow:ellipsis">
                  ${star ? '⭐ ' : ''}${p.name ?? '—'}${absent ? ' <span style="font-size:9px;color:#ef4444;font-weight:700">OUT</span>' : ''}
                </td>
                <td style="padding:6px 4px;text-align:center;font-weight:600">${p.pts?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center">${p.last5pts !== null && p.last5pts !== undefined ? p.last5pts.toFixed(1) + ' ' + _trendArrow(p.pts, p.last5pts) : '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-muted)">${p.reb?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-muted)">${p.ast?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-muted)">${p.stl?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-muted)">${p.blk?.toFixed(1) ?? '—'}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  };

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🏀 Top 10 scoreurs</span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button id="${uid}_btnH" onclick="
          document.getElementById('${uid}_H').style.display='block';
          document.getElementById('${uid}_A').style.display='none';
          this.style.background='rgba(99,102,241,0.2)';this.style.color='var(--color-signal)';
          document.getElementById('${uid}_btnA').style.background='var(--color-bg)';document.getElementById('${uid}_btnA').style.color='var(--color-muted)';
        " style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:rgba(99,102,241,0.2);color:var(--color-signal)">${homeAbv}</button>
        <button id="${uid}_btnA" onclick="
          document.getElementById('${uid}_A').style.display='block';
          document.getElementById('${uid}_H').style.display='none';
          this.style.background='rgba(99,102,241,0.2)';this.style.color='var(--color-signal)';
          document.getElementById('${uid}_btnH').style.background='var(--color-bg)';document.getElementById('${uid}_btnH').style.color='var(--color-muted)';
        " style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:var(--color-bg);color:var(--color-muted)">${awayAbv}</button>
      </div>
      <div id="${uid}_H" style="display:block;overflow-x:auto">${renderTable(teamDetail?.home?.top10scorers)}</div>
      <div id="${uid}_A" style="display:none;overflow-x:auto">${renderTable(teamDetail?.away?.top10scorers)}</div>
    </div>`;
}

// ── Section 3 : 10 derniers matchs ───────────────────────────────────────────

function _renderTDLast10(match, teamDetail) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';

  const renderTimeline = (games) => {
    if (!games?.length) return `<div style="font-size:11px;color:var(--color-muted)">Données indisponibles</div>`;
    return games.map(g => {
      const dateStr  = g.date ? `${g.date.slice(4,6)}/${g.date.slice(6,8)}` : '';
      const locIcon  = g.homeAway === 'home' ? '🏠' : '✈️';
      const scoreStr = g.score ?? '—';
      return `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;background:var(--color-bg);margin-bottom:4px">
          ${_resultBadge(g.result)}
          <span style="font-size:10px;color:var(--color-muted);width:30px">${dateStr}</span>
          <span style="font-size:11px;font-weight:600;min-width:28px">${g.opponent ?? '?'}</span>
          <span style="font-size:10px">${locIcon}</span>
          <span style="font-size:11px;color:var(--color-muted);margin-left:auto;font-variant-numeric:tabular-nums">${scoreStr}</span>
        </div>`;
    }).join('');
  };

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">📅 10 derniers matchs</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-muted);margin-bottom:6px;text-transform:uppercase">${homeAbv}</div>
          ${renderTimeline(teamDetail?.home?.last10)}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-muted);margin-bottom:6px;text-transform:uppercase">${awayAbv}</div>
          ${renderTimeline(teamDetail?.away?.last10)}
        </div>
      </div>
    </div>`;
}

// ── Section 4 : H2H + O/U trend ──────────────────────────────────────────────

function _renderTDH2H_OU(match, teamDetail) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';
  const h2h     = teamDetail?.home?.h2h ?? [];
  const ouLine  = parseFloat(match?.odds?.over_under ?? match?.market_odds?.total_line ?? 0);

  const calcOU = (games) => {
    if (!ouLine || !games?.length) return null;
    const withTotal = games.filter(g => g.total !== null && g.total !== undefined);
    if (!withTotal.length) return null;
    const over  = withTotal.filter(g => g.total > ouLine).length;
    const under = withTotal.filter(g => g.total < ouLine).length;
    const avg   = (withTotal.reduce((s, g) => s + g.total, 0) / withTotal.length).toFixed(1);
    return { over, under, total: withTotal.length, avg };
  };

  const ouBar = (ou, label) => {
    if (!ou) return `<div style="font-size:11px;color:var(--color-muted)">${label} : ligne O/U indisponible</div>`;
    const overPct  = Math.round((ou.over  / ou.total) * 100);
    const underPct = Math.round((ou.under / ou.total) * 100);
    return `
      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:var(--color-muted);margin-bottom:3px">${label} · ${ou.total} matchs · moy. ${ou.avg} pts</div>
        <div style="display:flex;height:7px;border-radius:4px;overflow:hidden;background:var(--color-border)">
          <div style="width:${overPct}%;background:#22c55e"></div>
          <div style="width:${underPct}%;background:#ef4444;margin-left:1px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:2px">
          <span style="color:#22c55e">Over ${ou.over}/${ou.total} (${overPct}%)</span>
          <span style="color:#ef4444">Under ${ou.under}/${ou.total} (${underPct}%)</span>
        </div>
      </div>`;
  };

  const h2hHtml = h2h.length
    ? h2h.slice(0, 5).map(g => {
        const dateStr = g.date ? `${g.date.slice(4,6)}/${g.date.slice(6,8)}` : '';
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;background:var(--color-bg);margin-bottom:4px">
            ${_resultBadge(g.result)}
            <span style="font-size:10px;color:var(--color-muted);width:30px">${dateStr}</span>
            <span style="font-size:10px">${g.homeAway === 'home' ? '🏠' : '✈️'}</span>
            <span style="font-size:11px;color:var(--color-muted);margin-left:auto">${g.score ?? '—'}</span>
          </div>`;
      }).join('')
    : `<div style="font-size:11px;color:var(--color-muted)">Pas de confrontation cette saison</div>`;

  return `
    <div class="card match-detail__bloc">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div class="bloc-header" style="margin-bottom:var(--space-3)">
            <span class="bloc-header__title">🔁 H2H saison</span>
          </div>
          ${h2hHtml}
        </div>
        <div>
          <div class="bloc-header" style="margin-bottom:var(--space-3)">
            <span class="bloc-header__title">📈 O/U${ouLine ? ` · ${ouLine}` : ''}</span>
          </div>
          ${ouBar(calcOU(teamDetail?.home?.last10), homeAbv)}
          ${ouBar(calcOU(teamDetail?.away?.last10), awayAbv)}
        </div>
      </div>
    </div>`;
}

// ── Section 5 : Joueurs absents triés PPG ─────────────────────────────────────

function _renderTDAbsents(match, injReport) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const homeName = match?.home_team?.name ?? '';
  const awayName = match?.away_team?.name ?? '';

  const STATUS_COLORS = { 'Out': '#ef4444', 'Doubtful': '#f97316', 'Day-To-Day': '#eab308', 'Questionable': '#eab308', 'Limited': '#a78bfa' };
  const STATUS_LABELS = { 'Out': 'Absent', 'Doubtful': 'Incertain', 'Day-To-Day': 'DTD', 'Questionable': 'Douteux', 'Limited': 'Limité' };

  const buildList = (teamName) => {
    if (!injReport?.by_team?.[teamName]) return [];
    return (injReport.by_team[teamName] ?? [])
      .filter(p => ['Out', 'Doubtful', 'Day-To-Day', 'Questionable', 'Limited'].includes(p.status))
      .sort((a, b) => (parseFloat(b.ppg) || 0) - (parseFloat(a.ppg) || 0));
  };

  const renderList = (players, abbr) => {
    if (!players.length) return `<div style="font-size:11px;color:#22c55e">✅ Effectif au complet</div>`;
    return players.map(p => {
      const color = STATUS_COLORS[p.status] ?? 'var(--color-muted)';
      const label = STATUS_LABELS[p.status] ?? p.status;
      const star  = parseFloat(p.ppg) >= 20;
      return `
        <div style="display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;border-left:3px solid ${color};background:var(--color-bg);margin-bottom:4px">
          <div style="flex:1;min-width:0">
            <span style="font-size:12px;font-weight:600">${star ? '⭐ ' : ''}${p.name}</span>
            ${p.ppg ? `<span style="font-size:10px;color:var(--color-muted);margin-left:4px">${p.ppg} pts/m</span>` : ''}
          </div>
          <span style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};border-radius:4px;padding:1px 5px;flex-shrink:0">${label}</span>
        </div>`;
    }).join('');
  };

  const homeList = buildList(homeName);
  const awayList = buildList(awayName);

  if (!homeList.length && !awayList.length) {
    return `
      <div class="card match-detail__bloc">
        <div class="bloc-header" style="margin-bottom:var(--space-3)"><span class="bloc-header__title">🏥 Absences</span></div>
        <div style="font-size:12px;color:#22c55e">✅ Aucune absence signalée pour ce match</div>
      </div>`;
  }

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🏥 Absences</span>
        <span style="font-size:10px;color:var(--color-muted)">triées par PPG</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-muted);margin-bottom:6px;text-transform:uppercase">${homeAbv}</div>
          ${renderList(homeList, homeAbv)}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-muted);margin-bottom:6px;text-transform:uppercase">${awayAbv}</div>
          ${renderList(awayList, awayAbv)}
        </div>
      </div>
    </div>`;
}

// ── Helper mapping ESPN name → Tank01 abv ─────────────────────────────────────

const ESPN_TO_TANK01_ABV = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GS', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NO', 'New York Knicks': 'NY', 'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SA',
  'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
};

function _getTeamAbvFromName(name) {
  return ESPN_TO_TANK01_ABV[name] ?? null;
}
