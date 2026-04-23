/**
 * MANI BET PRO — ui.match-detail.js v3.11
 *
 * REFACTOR v3.9 :
 *   Découpe en 3 sous-modules pour améliorer la maintenabilité :
 *     ui.match-detail.helpers.js    — utils partagés (conversions cotes, labels, timestamps)
 *     ui.match-detail.teamdetail.js — bloc Team Detail complet (5 sections)
 *   Ce fichier conserve : render(), shell, probas, paris, pourquoi, fiabilité,
 *   sources, IA, stats, absences, events, paper trading modal.
 *   Interface publique inchangée : export async function render().
 *   ESPN_TO_TANK01_ABV supprimé — remplacé par getNBAAbvFromEspn() (sports.config.js v6.4).
 *
 * Historique v3.8 et antérieur → voir git log.
 */

import { router }      from './ui.router.js';
import { EngineCore }  from '../engine/engine.core.js';
import { PaperEngine } from '../paper/paper.engine.js';
import { ProviderNBA } from '../providers/provider.nba.js';
import { Logger }      from '../utils/utils.logger.js';
import {
  americanToDecimal   as _americanToDecimal,
  decimalToAmerican   as _decimalToAmerican,
  simplifyLabel       as _simplifyLabel,
  escapeHtml,
  formatMatchTime,
  formatRejection,
  resolveLatestAnalysisForMatch as _resolveLatestAnalysisForMatch,
  SIGNAL_LABELS,
  WORKER_URL,
} from './ui.match-detail.helpers.js';
import {
  loadAndRenderTeamDetail    as _loadAndRenderTeamDetail,
  renderBlocTeamDetailSkeleton,
  bindLast10Clicks           as _bindLast10Clicks,
} from './ui.match-detail.teamdetail.js';

// ── POINT D'ENTRÉE PUBLIC ─────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  const matchId = storeInstance.get('activeMatchId');
  if (!matchId) { renderNoMatch(container); return { destroy() {} }; }

  const match = storeInstance.get('matches')?.[matchId];
  if (!match) { renderNoMatch(container); return { destroy() {} }; }

  const analyses           = storeInstance.get('analyses') ?? {};
  const preferredAnalysisId = storeInstance.get('activeAnalysisId');
  const analysis            = _resolveLatestAnalysisForMatch(analyses, matchId, preferredAnalysisId);

  container.innerHTML = renderShell(match, analysis, storeInstance);
  bindEvents(container, storeInstance, match, analysis);
  _loadAndRenderMultiBookOdds(container, match, analysis);

  const isMLB = String(match?.sport ?? '').toUpperCase() === 'MLB';
  if (isMLB) {
    _loadAndRenderMLBStats(container, match, storeInstance);
  } else {
    _loadAndRenderTeamDetail(container, match, storeInstance);
    _loadAndRenderPlayerPropsFromBot(container, match, analysis, storeInstance);
  }

  return { destroy() {} };
}

// Charge les données props joueur depuis /bot/logs et ré-injecte la section
// "Points joueur" dans le tableau Marchés. Le front calcule l'analyse localement
// mais le backend est seul à faire les projections player_points → fetch nécessaire.
async function _loadAndRenderPlayerPropsFromBot(container, match, analysis, storeInstance) {
  try {
    const dateStr = match.date ? String(match.date).replace(/-/g, '') : null;
    if (!dateStr || !match.id) return;

    const url  = `${WORKER_URL}/bot/logs?date=${dateStr}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return;
    const data = await resp.json();
    const log  = (data.logs ?? []).find(l => l.match_id === match.id || l.espn_id === match.id);
    if (!log?.player_props_prediction?.available) return;

    // Enrichir l'analyse locale avec les données bot
    const enrichedAnalysis = {
      ...analysis,
      player_props_prediction: log.player_props_prediction,
      betting_recommendations: {
        ...(analysis?.betting_recommendations ?? {}),
        recommendations: [
          ...(analysis?.betting_recommendations?.recommendations ?? []),
          ...((log.betting_recommendations?.recommendations ?? []).filter(r => r.type === 'PLAYER_POINTS')),
        ],
      },
    };

    // Re-render Marchés block
    const blocEl = container.querySelector('#bloc-tous-paris');
    if (blocEl) {
      blocEl.innerHTML = renderBlocTousLesParis(enrichedAnalysis, match);
      // Re-bind paper bet buttons sur les nouveaux éléments
      bindEvents(container, storeInstance, match, enrichedAnalysis);
    }
  } catch (err) {
    console.warn('[MatchDetail] player props fetch error:', err.message);
  }
}

// ── MLB : charge stats équipe + pitchers + standings et rend le bloc détail ───
async function _loadAndRenderMLBStats(container, match, storeInstance) {
  const el = container.querySelector('#mlb-stats-container');
  if (!el) return;

  try {
    const homeName = match.home_team?.name;
    const awayName = match.away_team?.name;
    const dateStr  = (match.date ?? '').length === 8
      ? `${match.date.slice(0,4)}-${match.date.slice(4,6)}-${match.date.slice(6,8)}`
      : null;

    // 3 fetches en parallèle (tous cachés côté worker)
    const [teamStatsResp, standingsResp, pitchersResp, botLogResp] = await Promise.allSettled([
      fetch(`${WORKER_URL}/mlb/team-stats`,        { headers: { Accept: 'application/json' } }),
      fetch(`${WORKER_URL}/mlb/standings`,         { headers: { Accept: 'application/json' } }),
      fetch(`${WORKER_URL}/mlb/pitchers${dateStr ? `?date=${dateStr}` : ''}`, { headers: { Accept: 'application/json' } }),
      fetch(`${WORKER_URL}/mlb/bot/logs${match.date ? `?date=${match.date}` : ''}`, { headers: { Accept: 'application/json' } }),
    ]);

    const teamStatsData = teamStatsResp.status === 'fulfilled' ? await teamStatsResp.value.json() : null;
    const standingsData = standingsResp.status === 'fulfilled' ? await standingsResp.value.json() : null;
    const pitchersData  = pitchersResp.status  === 'fulfilled' ? await pitchersResp.value.json()  : null;
    const botLogs       = botLogResp.status    === 'fulfilled' ? await botLogResp.value.json()    : null;

    const homeStats  = teamStatsData?.teams?.[homeName] ?? null;
    const awayStats  = teamStatsData?.teams?.[awayName] ?? null;
    const homeStand  = standingsData?.standings?.[homeName] ?? null;
    const awayStand  = standingsData?.standings?.[awayName] ?? null;
    const homePit    = pitchersData?.pitchers?.[homeName] ?? null;
    const awayPit    = pitchersData?.pitchers?.[awayName] ?? null;

    const matchingLog = (botLogs?.logs ?? []).find(l => l.match_id === match.id);
    const strikeoutsPrediction = matchingLog?.pitcher_strikeouts_prediction ?? null;

    el.innerHTML = _renderMLBMarches(matchingLog, match) + _renderMLBMatchDetail({
      homeName, awayName,
      homeStats, awayStats,
      homeStand, awayStand,
      homePit, awayPit,
      strikeoutsPrediction,
    });
  } catch (err) {
    console.warn('[MatchDetail MLB] load error:', err.message);
    el.innerHTML = `<div class="bot-error" style="padding:20px">Erreur chargement stats MLB: ${err.message}</div>`;
  }
}

// Render Marchés MLB — reproduit le tableau NBA avec adaptation structure log MLB
// Si log dispo : montre analyse + edge + fiabilité · sinon juste les cotes book
function _renderMLBMarches(log, match) {
  const homeAbbr = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr = match?.away_team?.abbreviation ?? 'EXT';
  const marketOdds = match?.market_odds ?? null;

  const recs = log?.betting_recommendations?.recommendations ?? log?.betting_recommendations?.all ?? [];
  const dq   = log?.data_quality ?? null;

  const homeProb = log?.home_prob ?? null;
  const awayProb = homeProb != null ? 100 - homeProb : null;

  // Reliability multiplier basé sur data_quality (1.00 par défaut si pas de log)
  const dqMult = dq === 'HIGH' ? 1.20 : dq === 'MEDIUM' ? 1.00 : dq === 'LOW' ? 0.70 : 1.00;
  const dqLabel = dq ?? 'N/A (analyse bot pas encore effectuée)';

  // Étoiles selon score fiabilité
  const starsFor = (edge) => {
    const score = edge * dqMult;
    if (score >= 12) return '⭐⭐⭐⭐⭐';
    if (score >= 9)  return '⭐⭐⭐⭐';
    if (score >= 7)  return '⭐⭐⭐';
    if (score >= 5)  return '⭐⭐';
    return '⭐';
  };

  const edgeColor = (e) => e >= 10 ? 'var(--color-success)'
                        : e >= 7  ? 'var(--color-warning)'
                        : e >= 5  ? 'var(--color-signal)'
                        : e >= 0  ? 'var(--color-text-secondary)'
                        : 'var(--color-danger)';

  const row = (label, prob, cote, edge, source, rec) => {
    if (cote == null) return '';
    const reliability = edge != null && edge > 0 ? Math.round(edge * dqMult * 10) / 10 : null;
    const stars = reliability != null && reliability >= 5 ? starsFor(edge) : '';

    return `
      <div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:8px;align-items:center;padding:9px 10px;background:${edge >= 7 ? 'rgba(34,197,94,0.06)' : 'var(--color-bg)'};border-radius:8px;border:1px solid ${edge >= 7 ? 'rgba(34,197,94,0.3)' : 'transparent'};margin-bottom:6px">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600">${label}</div>
          <div style="font-size:10px;color:var(--color-text-secondary)">${prob != null ? prob + '% analyse' : '—'}</div>
        </div>
        <div style="text-align:center;min-width:48px">
          <div style="font-size:14px;font-weight:700;color:var(--color-signal)">${typeof cote === 'number' ? cote.toFixed(2) : cote}</div>
          <div style="font-size:9px;color:var(--color-text-secondary)">${source ?? 'book'}</div>
        </div>
        <div style="text-align:center;min-width:50px">
          ${edge != null ? `<div style="font-size:14px;font-weight:800;color:${edgeColor(edge)}">${edge > 0 ? '+' : ''}${edge}%</div>` : '<div style="color:var(--color-muted)">—</div>'}
        </div>
        <div style="text-align:center;min-width:60px">
          ${stars ? `<div style="font-size:11px">${stars}</div><div style="font-size:9px;color:var(--color-muted)">${reliability}</div>` : '<div style="color:var(--color-muted);font-size:10px">—</div>'}
        </div>
        <div></div>
      </div>`;
  };

  // Extraction depuis market_odds (fallback si recos vides)
  const bkPriority = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
  const getBook = (field) => {
    if (!marketOdds?.bookmakers?.length) return null;
    for (const key of bkPriority) {
      const bk = marketOdds.bookmakers.find(b => b.key === key);
      if (bk?.[field] && bk[field] > 1) return { value: bk[field], title: bk.title ?? bk.key, line: bk.total_line };
    }
    const first = marketOdds.bookmakers[0];
    return first?.[field] ? { value: first[field], title: first.title ?? first.key, line: first.total_line } : null;
  };

  // Vainqueur (MONEYLINE)
  const mlHome  = recs.find(r => r.type === 'MONEYLINE' && r.side === 'HOME');
  const mlAway  = recs.find(r => r.type === 'MONEYLINE' && r.side === 'AWAY');
  const bkHome  = getBook('home_ml');
  const bkAway  = getBook('away_ml');
  const mlHomeOdds = mlHome?.odds_decimal ?? bkHome?.value ?? null;
  const mlAwayOdds = mlAway?.odds_decimal ?? bkAway?.value ?? null;
  const mlHomeEdge = mlHome?.edge ?? null;
  const mlAwayEdge = mlAway?.edge ?? null;
  const mlHomeSource = mlHome?.odds_source ?? bkHome?.title ?? 'book';
  const mlAwaySource = mlAway?.odds_source ?? bkAway?.title ?? 'book';

  // Total (runs)
  const ouOver  = recs.find(r => r.type === 'OVER_UNDER' && r.side === 'OVER');
  const ouUnder = recs.find(r => r.type === 'OVER_UNDER' && r.side === 'UNDER');
  const bkOver  = getBook('over_total');
  const bkUnder = getBook('under_total');
  const ouOverOdds  = ouOver?.odds_decimal  ?? bkOver?.value  ?? null;
  const ouUnderOdds = ouUnder?.odds_decimal ?? bkUnder?.value ?? null;
  const ouOverEdge  = ouOver?.edge  ?? null;
  const ouUnderEdge = ouUnder?.edge ?? null;
  const ouLine  = ouOver?.ou_line ?? ouUnder?.ou_line ?? bkOver?.line ?? bkUnder?.line ?? null;
  const ouOverSource  = ouOver?.odds_source  ?? bkOver?.title  ?? 'book';
  const ouUnderSource = ouUnder?.odds_source ?? bkUnder?.title ?? 'book';

  const mlSection = (mlHomeOdds || mlAwayOdds) ? `
    <div style="font-size:9px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 2px">Vainqueur</div>
    ${mlHomeOdds ? row(`${homeAbbr} vainqueur`, homeProb, mlHomeOdds, mlHomeEdge, mlHomeSource, mlHome) : ''}
    ${mlAwayOdds ? row(`${awayAbbr} vainqueur`, awayProb, mlAwayOdds, mlAwayEdge, mlAwaySource, mlAway) : ''}` : '';

  const ouSection = (ouOverOdds || ouUnderOdds) ? `
    <div style="font-size:9px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 2px">Total (runs)${ouLine ? ` · ${ouLine}` : ''}</div>
    ${ouOverOdds ? row(`Plus de ${ouLine ?? '—'} runs`, ouOver?.motor_prob ?? null, ouOverOdds, ouOverEdge, ouOverSource, ouOver) : ''}
    ${ouUnderOdds ? row(`Moins de ${ouLine ?? '—'} runs`, ouUnder?.motor_prob ?? null, ouUnderOdds, ouUnderEdge, ouUnderSource, ouUnder) : ''}` : '';

  // Strikeouts pitcher (projection seule — pas de ligne marché pour l'instant)
  const ksPred = log?.pitcher_strikeouts_prediction;
  const ksSection = ksPred?.available ? `
    <div style="font-size:9px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 2px">Strikeouts pitcher (projection)</div>
    ${[ksPred.home_pitcher, ksPred.away_pitcher].filter(Boolean).map(p => `
      <div style="padding:8px 10px;background:var(--color-bg);border-radius:8px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;font-weight:600">${p.name ?? '—'}</div>
            <div style="font-size:10px;color:var(--color-text-secondary)">K/9 ${p.k_per_9} · IP ${p.expected_ip}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:800;color:var(--color-signal)">${p.projected_ks} K</div>
            ${p.opponent_mult !== 1 ? `<div style="font-size:10px;color:var(--color-text-secondary)">matchup ×${p.opponent_mult}</div>` : ''}
          </div>
        </div>
      </div>`).join('')}` : '';

  if (!mlSection && !ouSection && !ksSection) {
    return `<div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">Marchés</span>
      </div>
      <div style="font-size:12px;color:var(--color-muted);text-align:center;padding:16px">
        Pas de cotes disponibles pour ce match. Vérifie que TheOddsAPI a bien chargé.
      </div>
    </div>`;
  }

  const dqColor = dq === 'HIGH' ? 'var(--color-success)' : dq === 'MEDIUM' ? 'var(--color-warning)' : dq === 'LOW' ? 'var(--color-danger)' : 'var(--color-muted)';

  return `<div class="card match-detail__bloc">
    <div class="bloc-header" style="margin-bottom:var(--space-2)">
      <span class="bloc-header__title">Marchés</span>
      <span style="font-size:10px;color:var(--color-text-secondary)">% analyse · book = prob. bookmaker</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:var(--color-bg);border-radius:6px;font-size:11px">
      <span style="color:var(--color-text-secondary)">Fiabilité data :</span>
      <span style="font-weight:700;color:${dqColor}">${dqLabel}</span>
      ${dq ? `<span style="color:var(--color-muted)">·</span>
      <span style="color:var(--color-text-secondary)">Multiplicateur fiabilité : ×${dqMult}</span>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:4px;padding:0 10px 4px">
      <div></div>
      <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Cote</div>
      <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Edge</div>
      <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Fiabilité</div>
      <div></div>
    </div>
    ${mlSection}
    ${ouSection}
    ${ksSection}
  </div>`;
}

function _renderMLBMatchDetail(data) {
  const { homeName, awayName, homeStats, awayStats, homeStand, awayStand, homePit, awayPit, strikeoutsPrediction } = data;

  const compareRow = (label, hVal, aVal, fmt = (v) => v, reverse = false) => {
    const h = hVal != null ? fmt(hVal) : '—';
    const a = aVal != null ? fmt(aVal) : '—';
    let hColor = 'var(--color-text-primary)';
    let aColor = 'var(--color-text-primary)';
    if (hVal != null && aVal != null) {
      const better = reverse ? hVal < aVal : hVal > aVal;
      if (hVal !== aVal) {
        hColor = better ? 'var(--color-success)' : 'var(--color-text-secondary)';
        aColor = better ? 'var(--color-text-secondary)' : 'var(--color-success)';
      }
    }
    return `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:13px">
        <div style="text-align:right;font-weight:700;color:${hColor}">${h}</div>
        <div style="color:var(--color-text-secondary);font-size:11px;min-width:110px;text-align:center">${label}</div>
        <div style="text-align:left;font-weight:700;color:${aColor}">${a}</div>
      </div>`;
  };

  const pitcherBlock = (pit, ks, label) => {
    if (!pit) return `<div style="padding:10px;font-size:12px;color:var(--color-muted)">${label} : pas de pitcher annoncé</div>`;
    const projKs = ks?.projected_ks != null ? `<span style="color:var(--color-signal);font-weight:700">${ks.projected_ks}K projetés</span>` : '';
    return `
      <div style="background:var(--color-bg);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;text-transform:uppercase;color:var(--color-muted);letter-spacing:0.06em;margin-bottom:4px">${label}</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">${pit.name ?? '—'}</div>
        <div style="font-size:11px;color:var(--color-text-secondary)">
          ERA ${pit.era?.toFixed(2) ?? '—'} · FIP ${pit.fip?.toFixed(2) ?? '—'} · WHIP ${pit.whip?.toFixed(2) ?? '—'}
        </div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">
          K/9 ${pit.k_per_9?.toFixed(1) ?? '—'} · BB/9 ${pit.bb_per_9?.toFixed(1) ?? '—'} · HR/9 ${pit.hr_per_9?.toFixed(2) ?? '—'}
          · ${pit.games ?? '?'} GS
        </div>
        ${projKs ? `<div style="margin-top:6px;font-size:12px">${projKs}</div>` : ''}
      </div>`;
  };

  return `
    <div style="padding:14px 16px">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">⚾ Starters du match</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${pitcherBlock(homePit, strikeoutsPrediction?.home_pitcher, '🏠 ' + (homeName ?? 'Home'))}
        ${pitcherBlock(awayPit, strikeoutsPrediction?.away_pitcher, '✈️ ' + (awayName ?? 'Away'))}
      </div>

      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">📊 Stats équipes saison</span>
      </div>
      <div style="background:var(--color-bg);border-radius:8px;padding:10px 14px;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;padding-bottom:6px;border-bottom:2px solid var(--color-border);font-size:11px;color:var(--color-muted);text-transform:uppercase;letter-spacing:0.06em">
          <div style="text-align:right">${homeName ?? 'Home'}</div>
          <div style="text-align:center"></div>
          <div style="text-align:left">${awayName ?? 'Away'}</div>
        </div>
        ${compareRow('Win %',         homeStand?.pct,          awayStand?.pct,         (v) => (parseFloat(v) * 100).toFixed(1) + '%')}
        ${compareRow('Record',        homeStand ? `${homeStand.wins}-${homeStand.losses}` : null, awayStand ? `${awayStand.wins}-${awayStand.losses}` : null, (v) => v)}
        ${compareRow('Run diff',      homeStand?.run_diff,     awayStand?.run_diff,    (v) => (v > 0 ? '+' : '') + v)}
        ${compareRow('OPS',           homeStats?.ops,          awayStats?.ops,         (v) => v.toFixed(3))}
        ${compareRow('Team ERA',      homeStats?.team_era,     awayStats?.team_era,    (v) => v.toFixed(2), true)}
        ${compareRow('Team WHIP',     homeStats?.team_whip,    awayStats?.team_whip,   (v) => v.toFixed(2), true)}
        ${compareRow('Team K/9',      homeStats?.team_k_per_9, awayStats?.team_k_per_9, (v) => v.toFixed(1))}
      </div>

      ${(homeStand && awayStand) ? `
        <div class="bloc-header" style="margin-bottom:var(--space-2)">
          <span class="bloc-header__title">📅 Splits & forme</span>
        </div>
        <div style="background:var(--color-bg);border-radius:8px;padding:10px 14px">
          ${compareRow('Dom.',         homeStand.home_wins != null ? homeStand.home_wins / Math.max(1, homeStand.home_wins + homeStand.home_losses) : null,
                                        awayStand.home_wins != null ? awayStand.home_wins / Math.max(1, awayStand.home_wins + awayStand.home_losses) : null,
                                        (v) => (v * 100).toFixed(0) + '%')}
          ${compareRow('Ext.',         homeStand.away_wins != null ? homeStand.away_wins / Math.max(1, homeStand.away_wins + homeStand.away_losses) : null,
                                        awayStand.away_wins != null ? awayStand.away_wins / Math.max(1, awayStand.away_wins + awayStand.away_losses) : null,
                                        (v) => (v * 100).toFixed(0) + '%')}
          ${compareRow('Last 10',      homeStand.last10_wins != null ? `${homeStand.last10_wins}-${homeStand.last10_losses}` : null,
                                        awayStand.last10_wins != null ? `${awayStand.last10_wins}-${awayStand.last10_losses}` : null,
                                        (v) => v)}
        </div>
      ` : ''}
    </div>
  `;
}

// ── SHELL ─────────────────────────────────────────────────────────────────────

function renderShell(match, analysis, storeInstance) {
  const sport     = String(match?.sport ?? 'NBA').toUpperCase();
  const isMLB     = sport === 'MLB';
  const sportTag  = isMLB
    ? '<span class="sport-tag sport-tag--mlb">⚾ MLB</span>'
    : '<span class="sport-tag sport-tag--nba">🏀 NBA</span>';

  // Bandeau Série playoff · scoreboard adapté sport (NBA orange · MLB rouge)
  const ps = match?.playoff_series;
  const seriesHeaderBadge = (ps && (ps.home_wins != null || ps.away_wins != null)) ? (() => {
    const hW = ps.home_wins ?? 0;
    const aW = ps.away_wins ?? 0;
    const homeAbv = match.home_team?.abbreviation ?? '—';
    const awayAbv = match.away_team?.abbreviation ?? '—';
    const total = ps.total_games ?? 7;
    const leadHome = hW > aW;
    const leadAway = aW > hW;
    const tied = hW === aW;
    const statusTxt = tied ? 'SÉRIE À ÉGALITÉ' : `${leadHome ? homeAbv : awayAbv} MÈNE LA SÉRIE`;
    const seriesLabel = isMLB
      ? (total === 3 ? 'WILD CARD · BO3' : total === 5 ? 'DIVISION SERIES · BO5' : `POSTSEASON · BO${total}`)
      : `PLAYOFFS · BO${total}`;
    const accentColor = isMLB ? 'var(--color-mlb-soft, #f87171)' : 'var(--color-basket-soft, #fb923c)';
    const accentRgb   = isMLB ? '220,38,38' : '249,115,22';
    const accentRgb2  = isMLB ? '30,58,138' : '168,85,247';
    return `
      <div style="
        margin: 0 calc(-1 * var(--space-5)) var(--space-3);
        padding: 12px var(--space-5);
        background: linear-gradient(90deg, rgba(${accentRgb},0.20) 0%, rgba(${accentRgb2},0.18) 50%, rgba(${accentRgb},0.20) 100%);
        border-top: 1px solid rgba(${accentRgb},0.40);
        border-bottom: 1px solid rgba(${accentRgb2},0.40);
        position: relative;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px">
          <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
            <div style="font-family:var(--font-display,'Bebas Neue',sans-serif);font-size:22px;font-weight:400;letter-spacing:0.03em;color:${leadHome ? accentColor : 'var(--color-text-secondary)'};line-height:1">${homeAbv}</div>
            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:${leadHome ? '#fff' : 'var(--color-text-secondary)'};line-height:1;margin-top:2px">${hW}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
            <span style="font-size:18px;filter:drop-shadow(0 0 6px rgba(${accentRgb},0.8))">${isMLB ? '⚾' : '🏆'}</span>
            <span style="font-family:var(--font-display,'Bebas Neue',sans-serif);font-size:11px;letter-spacing:0.12em;color:#fff;text-align:center;white-space:nowrap">${seriesLabel}</span>
            <span style="font-size:9px;font-weight:700;letter-spacing:0.10em;color:${accentColor};background:rgba(0,0,0,0.45);padding:2px 8px;border-radius:3px">${statusTxt}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0">
            <div style="font-family:var(--font-display,'Bebas Neue',sans-serif);font-size:22px;font-weight:400;letter-spacing:0.03em;color:${leadAway ? accentColor : 'var(--color-text-secondary)'};line-height:1">${awayAbv}</div>
            <div style="font-family:var(--font-mono);font-size:32px;font-weight:800;color:${leadAway ? '#fff' : 'var(--color-text-secondary)'};line-height:1;margin-top:2px">${aW}</div>
          </div>
        </div>
      </div>`;
  })() : '';

  return `
    <div class="match-detail">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>
        <button class="btn btn--ghost" id="share-btn" style="font-size:12px">📤 Partager</button>
      </div>

      <div class="match-detail__header card">
        <div class="row row--between" style="margin-bottom:var(--space-3)">
          ${sportTag}
          <span class="text-muted" style="font-size:12px">${formatMatchTime(match)}</span>
        </div>
        ${seriesHeaderBadge}
        ${(() => {
          // MLB : cotes dans match.market_odds.bookmakers (décimal direct via TheOddsAPI)
          // NBA : cotes dans match.odds.home_ml (format américain via ESPN) ou home_ml_decimal
          const pickMlbBook = () => {
            const books = match?.market_odds?.bookmakers ?? [];
            if (!books.length) return null;
            const priority = ['pinnacle', 'draftkings', 'fanduel', 'betmgm'];
            for (const key of priority) {
              const b = books.find(x => x.key === key);
              if (b?.home_ml && b?.away_ml) return b;
            }
            return books.find(b => b.home_ml && b.away_ml) ?? null;
          };
          const mlbBook   = isMLB ? pickMlbBook() : null;
          const homeMlDec = mlbBook?.home_ml
                         ?? match?.odds?.home_ml_decimal
                         ?? _americanToDecimal(match?.odds?.home_ml)
                         ?? null;
          const awayMlDec = mlbBook?.away_ml
                         ?? match?.odds?.away_ml_decimal
                         ?? _americanToDecimal(match?.odds?.away_ml)
                         ?? null;
          const fmt = (d) => d ? Number(d).toFixed(2) : null;
          const homeStr = fmt(homeMlDec);
          const awayStr = fmt(awayMlDec);
          const favHome = homeMlDec && awayMlDec && homeMlDec < awayMlDec;
          const favAway = homeMlDec && awayMlDec && awayMlDec < homeMlDec;
          const pill = (label, isFav) => `<div style="display:inline-flex;align-self:${label === 'home' ? 'flex-start' : 'flex-end'};align-items:center;gap:4px;font-size:10px;font-weight:700;color:${isFav ? 'var(--color-signal)' : 'var(--color-text-secondary)'};background:var(--color-bg);border:1px solid ${isFav ? 'var(--color-signal)' : 'var(--color-border)'};border-radius:4px;padding:2px 7px;margin-top:3px"><span style="font-size:9px;font-weight:600;color:var(--color-text-secondary);letter-spacing:0.04em">Cote</span><span>${label === 'home' ? homeStr : awayStr}</span></div>`;
          return `
        <div class="match-detail__teams">
          <div class="match-detail__team">
            <div class="match-detail__team-abbr">${match.home_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.home_team?.name ?? '—'}</div>
            ${homeStr ? pill('home', favHome) : ''}
            <div style="display:inline-flex;align-self:flex-start;align-items:center;font-size:10px;font-weight:600;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:1px 6px;margin-top:2px">🏠 Domicile</div>
            <div class="text-muted mono" style="font-size:11px;margin-top:2px">${match.home_team?.record ?? ''}</div>
          </div>
          <div class="match-detail__separator">
            <span class="match-detail__vs">VS</span>
          </div>
          <div class="match-detail__team match-detail__team--away">
            <div class="match-detail__team-abbr">${match.away_team?.abbreviation ?? '—'}</div>
            <div class="match-detail__team-name">${match.away_team?.name ?? '—'}</div>
            ${awayStr ? pill('away', favAway) : ''}
            <div style="display:inline-flex;align-self:flex-end;align-items:center;font-size:10px;font-weight:600;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:1px 6px;margin-top:2px">✈️ Extérieur</div>
            <div class="text-muted mono" style="font-size:11px;margin-top:2px">${match.away_team?.record ?? ''}</div>
          </div>
        </div>`;
        })()}
        ${match.odds ? renderOddsBar(match.odds) : ''}
      </div>

      ${renderBlocSyntheseSummary(analysis, match)}
      ${renderBlocProbas(analysis, match)}
      ${renderBlocSynthese(analysis, match)}
      ${isMLB
        ? `<div id="mlb-stats-container"><div class="bot-loading" style="padding:20px">Chargement marchés + stats MLB…</div></div>`
        : `<div id="bloc-tous-paris">${renderBlocTousLesParis(analysis, match)}</div>
           <div id="team-detail-container">${renderBlocTeamDetailSkeleton()}</div>`}
      ${renderBlocFiabilite(analysis, match)}
    </div>
  `;
}

// ── COTES ESPN ────────────────────────────────────────────────────────────────

function renderOddsBar(odds) {
  // Barre DraftKings supprimée — données ESPN américaines obsolètes depuis Pinnacle
  return '';
}

// ── BLOC PROBAS ───────────────────────────────────────────────────────────────

function renderBlocSyntheseSummary(analysis, match) {
  if (!analysis) return '';
  const best  = analysis.betting_recommendations?.best ?? null;
  const score = (() => {
    const rob  = analysis?.robustness_score;
    const qual = analysis?.data_quality_score;
    return (rob != null && qual != null) ? Math.round(((rob + qual) / 2) * 100) : null;
  })();
  let fiabLabel, fiabColor;
  if (score === null)   { fiabLabel = '—';       fiabColor = 'var(--color-muted)'; }
  else if (score >= 80) { fiabLabel = 'Élevée';  fiabColor = 'var(--color-success)'; }
  else if (score >= 60) { fiabLabel = 'Moyenne'; fiabColor = 'var(--color-warning)'; }
  else                  { fiabLabel = 'Faible';  fiabColor = 'var(--color-danger)'; }

  if (!best || best.edge < 5) return '';

  const typeLabel = best.type === 'MONEYLINE' ? 'Vainqueur'
                  : best.type === 'SPREAD' ? 'Handicap'
                  : best.type === 'PLAYER_POINTS' ? 'Props'
                  : 'O/U';
  let sideLabel;
  if (best.type === 'MONEYLINE') {
    sideLabel = best.side === 'HOME' ? (match?.home_team?.name ?? 'DOM') : (match?.away_team?.name ?? 'EXT');
  } else if (best.type === 'SPREAD') {
    const abbr = best.side === 'HOME' ? (match?.home_team?.abbreviation ?? 'DOM') : (match?.away_team?.abbreviation ?? 'EXT');
    const line = best.side === 'HOME' ? best.spread_line : -best.spread_line;
    sideLabel = abbr + ' ' + (line > 0 ? '+' : '') + line;
  } else if (best.type === 'PLAYER_POINTS') {
    sideLabel = `${best.player} ${best.side === 'OVER' ? '+' : '−'}${best.line}`;
  } else {
    sideLabel = best.side === 'OVER'
      ? 'Plus de ' + (best.ou_line ?? '—') + ' pts'
      : 'Moins de ' + (best.ou_line ?? '—') + ' pts';
  }

  const decOdds  = best.odds_decimal ?? _americanToDecimal(best.odds_line) ?? null;
  const fmtOdds  = decOdds ? Number(decOdds).toFixed(2) : '—';
  const edgeColor = best.edge >= 12 ? 'var(--color-success)' : best.edge >= 7 ? 'var(--color-warning)' : 'var(--color-muted)';
  const fiabHtml  = score !== null
    ? `<div style="text-align:center"><div style="font-size:14px;font-weight:700;color:${fiabColor}">${score}%</div><div style="font-size:9px;color:var(--color-text-secondary)">Fiabilité</div></div>`
    : '';

  return `
    <div class="card match-detail__bloc" style="border-left:3px solid ${edgeColor};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <span style="font-size:14px;font-weight:700;color:var(--color-success)">★</span>
        <div style="min-width:0">
          <div style="font-size:10px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">${typeLabel}</div>
          <div style="font-size:15px;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sideLabel}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
        <div style="text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--color-signal)">${fmtOdds}</div>
          <div style="font-size:9px;color:var(--color-text-secondary)">Cote</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:18px;font-weight:700;color:${edgeColor}">+${best.edge}%</div>
          <div style="font-size:9px;color:var(--color-text-secondary)">Edge</div>
        </div>
        ${fiabHtml}
      </div>
    </div>`;
}

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
  if (!best || edge < 5)               { decisionLabel = 'Passer';           decisionColor = 'var(--color-muted)'; }
  else if (edge >= 10 && qual >= 0.80) { decisionLabel = 'Parier';           decisionColor = 'var(--color-success)'; }
  else if (edge >= 7)                  { decisionLabel = 'Pari intéressant'; decisionColor = 'var(--color-warning)'; }
  else                                 { decisionLabel = 'Passer';           decisionColor = 'var(--color-muted)'; }

  const NBA_PHASE_BADGE = {
    playin:  { label: '🏆 Play-In',  color: '#f97316' },
    playoff: { label: '🏆 Play-Off', color: '#a855f7' },
    regular: null,
    offseason: null,
  };
  const phaseBadge = analysis.nba_phase ? (NBA_PHASE_BADGE[analysis.nba_phase] ?? null) : null;

  return `
    <div class="card match-detail__bloc">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px">${homeName}</div>
          <div style="font-size:28px;font-weight:700;color:${homeProb >= awayProb ? 'var(--color-signal)' : 'var(--color-muted)'}">${homeProb}%</div>
          <div style="font-size:10px;color:var(--color-text-secondary)">Cote juste : ${fairHome}</div>
        </div>
        <div style="text-align:center;color:var(--color-text-secondary);font-size:13px">vs</div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px">${awayName}</div>
          <div style="font-size:28px;font-weight:700;color:${awayProb > homeProb ? 'var(--color-signal)' : 'var(--color-muted)'}">${awayProb}%</div>
          <div style="font-size:10px;color:var(--color-text-secondary)">Cote juste : ${fairAway}</div>
        </div>
      </div>
      <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:12px">
        <div style="height:100%;width:${homeProb}%;background:var(--color-signal);border-radius:3px"></div>
      </div>
      ${best && edge >= 5 ? `
        <div style="border-left:3px solid ${decisionColor};padding:8px 12px;border-radius:4px;background:var(--color-bg);font-size:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <div>
            <span style="font-weight:700;color:${decisionColor}">${decisionLabel}</span>
            <span style="color:var(--color-text-secondary);margin-left:8px">Cote sous-évaluée de ${edge}%</span>
          </div>
          ${phaseBadge ? `<span style="font-size:10px;font-weight:700;color:${phaseBadge.color};border:1px solid ${phaseBadge.color};border-radius:4px;padding:2px 7px">${phaseBadge.label} · poids ajustés</span>` : ''}
        </div>
      ` : `<div style="font-size:12px;color:var(--color-text-secondary)">Aucun avantage suffisant détecté sur ce match.${phaseBadge ? ` <span style="color:${phaseBadge.color};font-weight:600">${phaseBadge.label}</span>` : ''}</div>`}
    </div>`;
}

// ── BLOC PARIS (résumé) ───────────────────────────────────────────────────────

export function renderBlocParis(analysis, match) {
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
    const marketLabel = r.type === 'MONEYLINE' ? 'Vainqueur du match'
                      : r.type === 'SPREAD' ? 'Handicap'
                      : r.type === 'PLAYER_POINTS' ? `Points joueur — ${r.player ?? '—'}`
                      : 'Total de points';

    let sideDisplay = sideLabel;
    if (r.type === 'SPREAD')             sideDisplay = `${sideLabel} ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts`;
    else if (r.type === 'OVER_UNDER')    sideDisplay = r.side === 'OVER' ? `Plus de ${r.ou_line ?? '—'} pts` : `Moins de ${r.ou_line ?? '—'} pts`;
    else if (r.type === 'PLAYER_POINTS') sideDisplay = r.side === 'OVER' ? `Plus de ${r.line} pts` : `Moins de ${r.line} pts`;

    const motorProb = r.side === 'HOME' ? Math.round(analysis.predictive_score * 100)
                    : r.side === 'AWAY' ? Math.round((1 - analysis.predictive_score) * 100)
                    : r.motor_prob;

    let whyText = '';
    if (r.type === 'MONEYLINE') {
      whyText = r.is_contrarian
        ? `Bien que l'analyse favorise l'adversaire, la cote ${oddsDecimal} sur ${sideLabel} est sous-évaluée par le marché. L'analyse estime ${motorProb}% de chances — la cote est sous-évaluée de ${r.edge}%.`
        : `L'analyse estime ${motorProb}% de chances pour ${sideLabel}. La cote ${oddsDecimal} chez ${r.odds_source ?? 'le bookmaker'} est sous-évaluée de ${r.edge}%.`;
    } else if (r.type === 'SPREAD') {
      whyText = `L'analyse estime que ${sideLabel} peut gagner avec ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts d'écart. La cote de ${oddsDecimal} sous-estime cette probabilité.`;
    } else if (r.type === 'OVER_UNDER') {
      whyText = r.side === 'OVER'
        ? `L'analyse projette un match à points élevés. La ligne de ${r.ou_line} pts semble trop basse.`
        : `L'analyse projette un match serré et défensif. La ligne de ${r.ou_line} pts semble trop haute.`;
    } else if (r.type === 'PLAYER_POINTS') {
      whyText = r.side === 'OVER'
        ? `Projection de ${r.projected_pts} pts pour ${r.player} vs ligne ${r.line}. La cote ${oddsDecimal} chez ${r.odds_source ?? 'le bookmaker'} sous-estime la probabilité de ${r.edge}%.`
        : `Projection de ${r.projected_pts} pts pour ${r.player} vs ligne ${r.line}. La cote ${oddsDecimal} chez ${r.odds_source ?? 'le bookmaker'} surestime la probabilité de ${r.edge}%.`;
    }

    // Explication de l'écart moteur/book
    const gapHtml = _buildGapExplanation(r, analysis, match);

    return `
      <div style="background:var(--color-bg);border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid ${isBest ? 'var(--color-success)' : 'var(--color-border)'}">
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);font-weight:700;margin-bottom:8px;letter-spacing:0.05em">★ MEILLEUR PARI</div>' : ''}
        <div style="margin-bottom:10px">
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">${marketLabel}</div>
          <div style="font-size:17px;font-weight:700">${sideDisplay}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">Cote</div>
            <div style="font-size:22px;font-weight:700;color:var(--color-signal)">${oddsDecimal ?? '—'}</div>
            ${gainPour100 ? `<div style="font-size:10px;color:var(--color-text-secondary)">+${gainPour100}€ pour 100€ misés</div>` : ''}
            ${r.odds_source ? `<div style="font-size:9px;color:var(--color-text-secondary);text-transform:uppercase">${r.odds_source}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:2px">Cote sous-évaluée</div>
            <div style="font-size:22px;font-weight:700;color:${edgeColor}">+${r.edge}%</div>
            ${kellyEuros ? `<div style="font-size:10px;color:var(--color-text-secondary)">Mise conseillée : ${kellyEuros}€</div>` : ''}
          </div>
        </div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;padding:8px 10px;background:var(--color-card);border-radius:6px;margin-bottom:${gapHtml ? '6px' : '10px'}">${whyText}</div>
        ${gapHtml}
        <button class="btn btn--primary paper-bet-btn" style="width:100%;padding:10px;font-size:13px;font-weight:600"
          data-market="${r.type}" data-side="${r.side}" data-side-label="${sideDisplay}"
          data-odds="${r.odds_line}" data-edge="${r.edge}" data-motor-prob="${r.motor_prob}"
          data-implied-prob="${r.implied_prob}" data-kelly="${r.kelly_stake ?? 0}"
          data-spread-line="${r.spread_line ?? ''}" data-ou-line="${r.ou_line ?? ''}"
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

// ── BLOC POURQUOI ─────────────────────────────────────────────────────────────

function renderBlocPourquoi(analysis, match, storeInstance) {
  const signals   = (analysis?.key_signals ?? []).slice(0, 3);
  const homeName  = match?.home_team?.name ?? 'Domicile';
  const awayName  = match?.away_team?.name ?? 'Extérieur';
  const homeAbbr  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr  = match?.away_team?.abbreviation ?? 'EXT';
  const vars      = analysis?.variables_used ?? {};
  const injReport = storeInstance?.get('injuryReport') ?? null;
  const teamCtx   = injReport?.team_context ?? null;
  const marketSig = injReport?.market_signal ?? null;
  const homeCtx   = teamCtx?.[homeName] ?? null;
  const awayCtx   = teamCtx?.[awayName] ?? null;

  // Trend O/U — affiché si la recommandation best est un Over/Under
  const best = analysis?.betting_recommendations?.best ?? null;
  const ouTrendHtml = (() => {
    if (best?.type !== 'OVER_UNDER') return '';
    const teamDetails = storeInstance?.get('teamDetails') ?? {};
    const matchId     = storeInstance?.get('activeMatchId');
    const td          = teamDetails[matchId] ?? null;
    if (!td) return '';

    const homeLast10 = td.home?.last10 ?? [];
    const awayLast10 = td.away?.last10 ?? [];
    const ouLine     = best.ou_line ?? match?.odds?.over_under;
    if (!ouLine) return '';

    const calcOver = (games) => {
      const valid = games.filter(g => g.total !== null && g.total !== undefined);
      if (!valid.length) return null;
      const over = valid.filter(g => g.total > ouLine).length;
      return { over, total: valid.length };
    };

    const homeOU = calcOver(homeLast10);
    const awayOU = calcOver(awayLast10);
    if (!homeOU && !awayOU) return '';

    const side      = best.side;
    const color     = side === 'OVER' ? '#22c55e' : '#3b82f6';
    const icon      = side === 'OVER' ? '📈' : '📉';
    const homeOverPct = homeOU ? Math.round(homeOU.over / homeOU.total * 100) : null;
    const awayOverPct = awayOU ? Math.round(awayOU.over / awayOU.total * 100) : null;

    const parts = [];
    if (homeOverPct !== null) parts.push(`${homeAbbr} Over ${homeOU.over}/${homeOU.total} (${homeOverPct}%)`);
    if (awayOverPct !== null) parts.push(`${awayAbbr} Over ${awayOU.over}/${awayOU.total} (${awayOverPct}%)`);

    return `
      <div style="margin-top:10px;font-size:12px;padding:8px 12px;background:rgba(34,197,94,0.06);border-left:3px solid ${color};border-radius:6px;color:var(--color-text-secondary)">
        ${icon} <strong style="color:${color}">Trend O/U ${ouLine}</strong> sur les 10 derniers matchs — ${parts.join(' · ')}
      </div>`;
  })();

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Pourquoi ce pari ?</span>
      </div>
      ${!signals.length ? `<div class="text-muted" style="font-size:12px">Aucun signal significatif.</div>` : `
        <div style="display:grid;gap:10px">
          ${signals.map(s => {
            const isHome   = s.direction === 'POSITIVE';
            const icon     = isHome ? '▲' : '▼';
            const color    = isHome ? 'var(--color-success)' : 'var(--color-danger)';
            const detail   = _getSignalDetail(s, vars, match, isHome, homeName, awayName);
            return `
              <div style="padding:10px 12px;background:var(--color-bg);border-radius:8px;border-left:3px solid ${color}">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:${detail ? '5px' : '0'}">
                  <span style="font-size:15px;color:${color};font-weight:700">${icon}</span>
                  <div style="font-size:13px;font-weight:600">${_simplifyLabel(s.label, s.variable)}</div>
                </div>
                ${detail ? `<div style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;padding-left:23px">${detail}</div>` : ''}
              </div>`;
          }).join('')}
        </div>`}
      ${ouTrendHtml}
      ${homeCtx || awayCtx ? `
        <div style="margin-top:10px;display:grid;gap:8px">
          ${homeCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;color:var(--color-text-secondary)">
            <strong style="color:var(--color-text)">${homeName}</strong> — ${homeCtx}
          </div>` : ''}
          ${awayCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;color:var(--color-text-secondary)">
            <strong style="color:var(--color-text)">${awayName}</strong> — ${awayCtx}
          </div>` : ''}
        </div>` : ''}
      ${marketSig?.movement ? `
        <div style="margin-top:8px;font-size:12px;padding:8px 12px;background:rgba(99,179,237,0.06);border-left:3px solid var(--color-signal);border-radius:6px;color:var(--color-text-secondary)">
          📈 <strong style="color:var(--color-signal)">Mouvement de ligne</strong> — ${marketSig.detail ?? ''}
        </div>` : ''}
    </div>`;
}

function _getSignalDetail(signal, vars, match, isHome, homeName, awayName) {
  const favTeam = isHome ? homeName : awayName;
  const othTeam = isHome ? awayName : homeName;
  const v       = vars[signal.variable];
  const val     = v?.value ?? null;

  switch (signal.variable) {
    case 'net_rating_diff': {
      if (val === null) return null;
      const ecart = Math.abs(val).toFixed(1);
      if (Math.abs(val) < 1) return `Les deux équipes sont au même niveau cette saison.`;
      return `${favTeam} est meilleure de <strong>${ecart} points</strong> par match en moyenne que ${othTeam} cette saison.`;
    }
    case 'efg_diff': {
      if (val === null) return null;
      return `${favTeam} tire plus efficacement que ${othTeam} — un écart de <strong>${Math.abs(val * 100).toFixed(1)}%</strong> d'efficacité au tir.`;
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
      const raw    = v?.raw;
      if (!raw) return null;
      const affectedInj = isHome ? (match?.away_injuries ?? []) : (match?.home_injuries ?? []);
      const stars = affectedInj
        .filter(p => (p.status === 'Out' || p.status === 'Doubtful') && (p.ppg != null && p.ppg > 10))
        .slice(0, 3)
        .map(p => {
          const statut = p.status === 'Out' ? 'absent' : 'incertain';
          return p.ppg ? `${p.name} (${statut}, ${p.ppg} pts/match)` : `${p.name} (${statut})`;
        });
      if (stars.length > 0) return `${othTeam} est affaibli — <strong>${stars.join(', ')}</strong>.`;
      const moreOut = isHome ? (raw.away_out ?? 0) : (raw.home_out ?? 0);
      if (moreOut > 0) return `${othTeam} a <strong>${moreOut} joueur${moreOut > 1 ? 's' : ''} absent${moreOut > 1 ? 's' : ''}</strong> ce soir.`;
      return `${favTeam} a moins de joueurs absents que ${othTeam}.`;
    }
    case 'win_pct_diff':   return val !== null ? `${favTeam} a un meilleur bilan victoires/défaites que ${othTeam} — <strong>${Math.abs(val * 100).toFixed(0)}%</strong> d'écart.` : null;
    case 'back_to_back':   return `${othTeam} joue son deuxième match en deux jours — fatigue accumulée.`;
    case 'rest_days_diff': { if (val === null) return null; const j = Math.abs(Math.round(val)); return `${favTeam} a eu <strong>${j} jour${j > 1 ? 's' : ''} de repos</strong> de plus que ${othTeam}.`; }
    case 'defensive_diff': return val !== null ? `${favTeam} encaisse moins de points par match que ${othTeam} — meilleure défense.` : null;
    default: return null;
  }
}

// ── EXPLICATION ÉCART MOTEUR / BOOK ──────────────────────────────────────────

/**
 * Construit un bloc HTML expliquant POURQUOI l'écart entre l'analyse et le book existe.
 * Ne réduit pas l'écart — l'explique pour aider à décider si la valeur est réelle.
 *
 * Priorité des explications :
 *   1. Star absente (signal le plus fort — book peut ne pas avoir intégré)
 *   2. Trend O/U last10 qui contredit la ligne (book en retard sur tendance)
 *   3. Divergence marché flaggée high/critical (argent sharp qui contredit)
 *   4. Écart > 10% sur ML sans raison claire (avertissement)
 */
function _buildGapExplanation(rec, analysis, match) {
  const divergence   = analysis?.market_divergence ?? null;
  const starModifier = analysis?.star_absence_modifier ?? null;
  const keySignals   = analysis?.key_signals ?? [];
  const homeName     = match?.home_team?.name ?? 'DOM';
  const awayName     = match?.away_team?.name ?? 'EXT';
  const homeAbsr     = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr     = match?.away_team?.abbreviation ?? 'EXT';

  const reasons = [];

  // 1. Star absente — modificateur actif
  if (starModifier !== null && Math.abs(starModifier) > 0.03) {
    const homeInj  = match?.home_injuries ?? [];
    const awayInj  = match?.away_injuries ?? [];
    const allInj   = [...homeInj, ...awayInj];
    const stars    = allInj
      .filter(p => (p.status === 'Out' || p.status === 'Doubtful') && (p.ppg ?? 0) >= 20)
      .slice(0, 2)
      .map(p => `${p.name} (${p.ppg} pts/m)`);
    if (stars.length > 0) {
      reasons.push({
        icon: '🏥',
        color: '#ef4444',
        label: 'Blessure star',
        detail: `${stars.join(', ')} — impact non encore intégré par le book.`,
      });
    }
  }

  // 2. Trend O/U fort (over ou under) — pertinent pour O/U recs
  if (rec.type === 'OVER_UNDER' && rec.home_last5_avg !== null && rec.away_last5_avg !== null) {
    const projTotal  = rec.predicted_total;
    const line       = rec.ou_line;
    const diffPts    = Math.abs(projTotal - line);
    if (diffPts >= 5) {
      const dir = rec.side === 'OVER' ? 'au-dessus' : 'en-dessous';
      reasons.push({
        icon: '📈',
        color: '#22c55e',
        label: 'Tendance récente',
        detail: `Les 5 derniers matchs projettent ${projTotal} pts — ${diffPts} pts ${dir} de la ligne ${line}.`,
      });
    }
  }

  // 3. Divergence marché flaggée — argent sharp qui contredit l'analyse
  if (divergence?.flag === 'high' || divergence?.flag === 'critical') {
    const mktHome = Math.round((divergence.market_implied_home ?? 0) * 100);
    const mktAway = Math.round((divergence.market_implied_away ?? 0) * 100);
    const isCritical = divergence.flag === 'critical';
    reasons.push({
      icon: isCritical ? '⚠️' : '📊',
      color: isCritical ? '#f97316' : '#eab308',
      label: isCritical ? 'Divergence forte' : 'Divergence marché',
      detail: `Le book donne ${mktHome}% ${homeAbsr} / ${mktAway}% ${awayAbbr} — écart de ${divergence.divergence_pts} pts avec l'analyse. ${isCritical ? 'Vérifier manuellement avant de miser.' : ''}`,
    });
  }

  // 4. Écart ML > 10% sans raison identifiée — avertissement simple
  if (rec.type === 'MONEYLINE' && Math.abs(rec.edge) >= 10 && reasons.length === 0) {
    const motorSide = rec.side === 'HOME' ? homeName : awayName;
    reasons.push({
      icon: '⚠️',
      color: '#f97316',
      label: 'Écart important',
      detail: `+${Math.abs(rec.edge)}% d'écart avec le book sur ${motorSide}. Le book a probablement des infos supplémentaires (rotations, market flow). À vérifier avant de miser.`,
    });
  }

  if (!reasons.length) return '';

  const items = reasons.map(r => `
    <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--color-border)">
      <span style="flex-shrink:0;font-size:13px">${r.icon}</span>
      <div style="min-width:0">
        <span style="font-size:11px;font-weight:700;color:${r.color}">${r.label}</span>
        <span style="font-size:11px;color:var(--color-text-secondary);margin-left:6px">${r.detail}</span>
      </div>
    </div>`).join('');

  return `
    <div style="padding:8px 10px;background:rgba(255,165,0,0.05);border:1px solid rgba(255,165,0,0.2);border-radius:6px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Pourquoi cet écart ?</div>
      ${items}
    </div>`;
}

// ── BLOC TOUS LES PARIS ───────────────────────────────────────────────────────

function renderBlocTousLesParis(analysis, match) {
  const homeProb   = analysis?.predictive_score != null ? Math.round(analysis.predictive_score * 100) : null;
  const awayProb   = homeProb != null ? 100 - homeProb : null;
  const homeAbbr   = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr   = match?.away_team?.abbreviation ?? 'EXT';
  const odds       = match?.odds;
  const marketOdds = match?.market_odds;
  const betting    = analysis?.betting_recommendations;
  const bankroll   = (PaperEngine.load().current_bankroll) ?? 500;

  const _probPill = (prob, rec) => {
    // Vert   = moteur conseille de parier (edge >= 7 + qualité >= 0.80 + pas contrarian)
    // Orange = edge positif mais conditions insuffisantes (risqué)
    // Gris   = pas de rec ou edge trop faible
    // Rouge  = edge négatif (book en désaccord fort — ne pas toucher)
    const quality  = analysis?.data_quality_score ?? 0;
    const divFlag  = analysis?.market_divergence?.flag ?? 'low';
    const edge     = rec?.edge ?? null;
    let bg;
    if (edge !== null && edge < 0)                                                bg = '#ef4444'; // rouge — négatif
    else if (rec && edge >= 7 && quality >= 0.80 && divFlag !== 'critical' && !rec.is_contrarian) bg = '#22c55e'; // vert — conseillé
    else if (rec && edge >= 3)                                                    bg = '#f97316'; // orange — risqué
    else                                                                          bg = 'var(--color-border)'; // gris — passer
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${bg};flex-shrink:0"></span>`;
  };

  const _edgeColor = (edge) => edge >= 8 ? '#22c55e' : edge >= 4 ? '#f97316' : edge > 0 ? 'var(--color-muted)' : '#ef4444';

  const getOdds = (type, side) => {
    if (marketOdds) {
      if (type === 'ML')   return side === 'HOME' ? marketOdds.home_ml_decimal   : marketOdds.away_ml_decimal;
      if (type === 'SPRD') return side === 'HOME' ? marketOdds.home_spread_decimal : marketOdds.away_spread_decimal;
      if (type === 'OVER') return marketOdds.over_decimal;
      if (type === 'UNDR') return marketOdds.under_decimal;
    }
    if (odds && type === 'ML') return side === 'HOME' ? _americanToDecimal(odds.home_ml) : _americanToDecimal(odds.away_ml);
    return null;
  };

  const getOddsSource = () => marketOdds?.best_book ?? (marketOdds ? 'Pinnacle' : 'DraftKings');
  const findRec = (type, side) => betting?.recommendations?.find(r => r.type === type && r.side === side) ?? null;

  const buildRow = (label, type, side, prob, oddsDec, rec, spreadLine, ouLine) => {
    if (!oddsDec) return null;
    const impliedProb = Math.round((1 / oddsDec) * 100);
    const edge        = prob !== null ? prob - impliedProb : null;
    const kellyEuros  = rec?.kelly_stake > 0 ? Math.round(rec.kelly_stake * bankroll * 100) / 100 : null;
    const isBest      = betting?.best?.type === type && betting?.best?.side === side;
    const betData     = `data-market="${type}" data-side="${side}" data-side-label="${label}" data-odds="${_decimalToAmerican(oddsDec) ?? 0}" data-edge="${edge ?? 0}" data-motor-prob="${prob ?? 0}" data-implied-prob="${impliedProb}" data-kelly="${rec?.kelly_stake ?? 0}" data-spread-line="${spreadLine ?? ''}" data-ou-line="${ouLine ?? ''}"`;

    return `
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:9px 10px;background:${isBest ? 'rgba(34,197,94,0.06)' : 'var(--color-bg)'};border-radius:8px;border:1px solid ${isBest ? 'rgba(34,197,94,0.3)' : 'transparent'};margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          ${_probPill(prob, rec)}
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
            <div style="font-size:10px;color:var(--color-text-secondary)">${prob !== null ? prob + '% analyse' : '—'} · book ${impliedProb}%</div>
          </div>
        </div>
        <div style="text-align:center;min-width:42px">
          <div style="font-size:14px;font-weight:700;color:var(--color-signal)">${oddsDec}</div>
          <div style="font-size:9px;color:var(--color-text-secondary)">${getOddsSource()}</div>
        </div>
        <div style="text-align:center;min-width:52px">
          ${edge !== null ? `<div style="font-size:15px;font-weight:800;color:${_edgeColor(edge)};letter-spacing:-0.01em">${edge > 0 ? '+' : ''}${edge}%</div>` : '<div style="color:var(--color-muted);font-size:11px">—</div>'}
          ${kellyEuros ? `<div style="font-size:9px;color:var(--color-text-secondary)">${kellyEuros}€</div>` : ''}
        </div>
        <div>
          <button class="paper-bet-btn" ${betData} style="font-size:12px;padding:8px 12px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-card);color:var(--color-text);cursor:pointer;white-space:nowrap;min-width:40px">📋</button>
        </div>
      </div>`;
  };

  const rows = [];
  const homeMLOdds = getOdds('ML', 'HOME'), awayMLOdds = getOdds('ML', 'AWAY');
  if (homeMLOdds) rows.push(buildRow(`${homeAbbr} vainqueur`, 'MONEYLINE', 'HOME', homeProb, homeMLOdds, findRec('MONEYLINE', 'HOME'), null, null));
  if (awayMLOdds) rows.push(buildRow(`${awayAbbr} vainqueur`, 'MONEYLINE', 'AWAY', awayProb, awayMLOdds, findRec('MONEYLINE', 'AWAY'), null, null));

  const spread = odds?.spread ?? marketOdds?.spread_line;
  if (spread != null) {
    const homeSprdOdds = getOdds('SPRD', 'HOME'), awaySprdOdds = getOdds('SPRD', 'AWAY');
    const spreadDisp   = spread > 0 ? `+${spread}` : String(spread);
    const recSprdHome  = findRec('SPREAD', 'HOME');
    const recSprdAway  = findRec('SPREAD', 'AWAY');
    // Utiliser motor_prob depuis les recs du moteur (toujours calculé maintenant)
    if (homeSprdOdds) rows.push(buildRow(`${homeAbbr} ${spreadDisp} pts`,               'SPREAD', 'HOME', recSprdHome?.motor_prob ?? homeProb, homeSprdOdds, recSprdHome, spread,  null));
    if (awaySprdOdds) rows.push(buildRow(`${awayAbbr} ${spread > 0 ? '-' : '+'}${Math.abs(spread)} pts`, 'SPREAD', 'AWAY', recSprdAway?.motor_prob ?? awayProb, awaySprdOdds, recSprdAway, -spread, null));
  }

  const ou = odds?.over_under ?? marketOdds?.ou_line;
  const altTotals = marketOdds?.alt_totals ?? [];
  if (ou != null) {
    const overOdds   = getOdds('OVER', 'OVER'), underOdds = getOdds('UNDR', 'UNDER');
    const recOver    = findRec('OVER_UNDER', 'OVER');
    const recUnder   = findRec('OVER_UNDER', 'UNDER');
    if (overOdds)  rows.push(buildRow(`Plus de ${ou} pts`,  'OVER_UNDER', 'OVER',  recOver?.motor_prob  ?? null, overOdds,  recOver,  null, ou));
    if (underOdds) rows.push(buildRow(`Moins de ${ou} pts`, 'OVER_UNDER', 'UNDER', recUnder?.motor_prob ?? null, underOdds, recUnder, null, ou));
  }

  // ── Props joueur (v6.56) · ligne marché via TheOddsAPI ou cache AI ─────
  const ppPred    = analysis?.player_props_prediction;
  const ppPlayers = ppPred?.available
    ? [...(ppPred.home_players ?? []), ...(ppPred.away_players ?? [])].filter(p => p.market)
    : [];
  // Trier par edge absolu décroissant (meilleurs edges en premier)
  ppPlayers.sort((a, b) => {
    const eA = Math.max(a.market?.over_edge ?? -99, a.market?.under_edge ?? -99);
    const eB = Math.max(b.market?.over_edge ?? -99, b.market?.under_edge ?? -99);
    return eB - eA;
  });

  const ppRows = [];
  for (const p of ppPlayers) {
    const mk        = p.market;
    const line      = mk.line;
    const overEdge  = mk.over_edge;
    const underEdge = mk.under_edge;
    const overProb  = mk.over_prob != null ? Math.round(mk.over_prob * 100) : null;
    const underProb = mk.under_prob != null ? Math.round(mk.under_prob * 100) : null;
    const overOdds  = mk.over_decimal;
    const underOdds = mk.under_decimal;

    // Chercher la reco correspondante (déjà push dans betting_recommendations)
    const recOver  = betting?.recommendations?.find(r => r.type === 'PLAYER_POINTS' && r.player === p.name && r.side === 'OVER');
    const recUnder = betting?.recommendations?.find(r => r.type === 'PLAYER_POINTS' && r.player === p.name && r.side === 'UNDER');

    if (overOdds)  ppRows.push(buildRow(`${p.name} plus de ${line}`,  'PLAYER_POINTS', 'OVER',  overProb,  overOdds,  recOver,  null, line));
    if (underOdds) ppRows.push(buildRow(`${p.name} moins de ${line}`, 'PLAYER_POINTS', 'UNDER', underProb, underOdds, recUnder, null, line));
  }

  const validRows = rows.filter(Boolean);
  const validPpRows = ppRows.filter(Boolean);
  if (!validRows.length && !validPpRows.length) return '';

  // Séparer par type de marché
  const mlRows     = validRows.filter(r => r.includes('data-market="MONEYLINE"'));
  const sprdRows   = validRows.filter(r => r.includes('data-market="SPREAD"'));
  const ouRows     = validRows.filter(r => r.includes('data-market="OVER_UNDER"'));

  const section = (title, rowsArr) => rowsArr.length ? `
    <div style="font-size:9px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.06em;padding:6px 10px 2px">${title}</div>
    ${rowsArr.join('')}` : '';

  // ── Sélecteur de lignes O/U alternatives (v6.34) ─────────────────────────
  const ouSelectorHtml = (() => {
    if (!altTotals || altTotals.length <= 1) return '';
    const mainLine = ou != null ? Number(ou) : null;
    // Générer les boutons — la ligne principale est active par défaut
    const buttons = altTotals.map(alt => {
      const isActive = mainLine !== null && Math.abs(alt.line - mainLine) < 0.1;
      return `<button
        class="ou-alt-btn${isActive ? ' ou-alt-btn--active' : ''}"
        data-line="${alt.line}"
        data-over="${alt.over}"
        data-under="${alt.under}"
        data-motor-over="${findRec('OVER_UNDER', 'OVER')?.motor_prob ?? ''}"
        data-motor-under="${findRec('OVER_UNDER', 'UNDER')?.motor_prob ?? ''}"
        style="font-size:10px;font-weight:${isActive ? '700' : '500'};
               padding:3px 8px;border-radius:12px;cursor:pointer;white-space:nowrap;
               border:1px solid ${isActive ? 'var(--color-signal)' : 'var(--color-border)'};
               background:${isActive ? 'rgba(59,130,246,0.1)' : 'var(--color-bg)'};
               color:${isActive ? 'var(--color-signal)' : 'var(--color-text-muted)'}"
      >${alt.line}</button>`;
    }).join('');

    return `
      <div style="padding:8px 10px 4px;border-top:1px solid var(--color-border);margin-top:4px">
        <div style="font-size:9px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">
          Lignes alternatives O/U
        </div>
        <div class="ou-alt-selector" style="display:flex;flex-wrap:wrap;gap:4px">
          ${buttons}
        </div>
        <div id="ou-alt-rows" style="margin-top:6px"></div>
      </div>`;
  })();

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">Marchés</span>
        <span style="font-size:10px;color:var(--color-text-secondary)">% analyse · book = prob. bookmaker</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:4px;padding:0 10px 4px">
        <div></div>
        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Cote</div>
        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Cote s/évaluée</div>
        <div></div>
      </div>
      ${section('Vainqueur', mlRows)}
      ${section('Handicap', sprdRows)}
      ${section('Total de points', ouRows)}
      ${ouSelectorHtml}
      ${section(`Points joueur${ppPred?.market_source ? ` · source ${ppPred.market_source}` : ''}`, validPpRows)}
    </div>`;
}

// ── BLOC STATS & FORME ────────────────────────────────────────────────────────

export function renderBlocStats(analysis, match, storeInstance) {
  const homeAbbr   = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbbr   = match?.away_team?.abbreviation ?? 'EXT';
  const homeName   = match?.home_team?.name ?? 'DOM';
  const awayName   = match?.away_team?.name ?? 'EXT';
  const vars       = analysis?.variables_used ?? {};
  const advStats   = storeInstance?.get('advancedStats') ?? {};
  const homeStats  = advStats?.[homeName] ?? {};
  const awayStats  = advStats?.[awayName] ?? {};
  const recentForms = storeInstance?.get('recentForms') ?? {};
  const homeFormKey = Object.keys(recentForms).find(k => recentForms[k]?.matches?.length > 0 && k === String(match?.home_team?.bdl_id ?? ''));
  const awayFormKey = Object.keys(recentForms).find(k => recentForms[k]?.matches?.length > 0 && k === String(match?.away_team?.bdl_id ?? ''));
  const homeForm   = homeFormKey ? recentForms[homeFormKey] : null;
  const awayForm   = awayFormKey ? recentForms[awayFormKey] : null;

  const homePPG    = match?.home_season_stats?.points_per_game ?? homeStats?.ppg ?? null;
  const awayPPG    = match?.away_season_stats?.points_per_game ?? awayStats?.ppg ?? null;
  const homeNet    = homeStats.net_rating ?? null;
  const awayNet    = awayStats.net_rating ?? null;
  const homeOPPG   = homeStats?.defensive_rating ?? null;
  const awayOPPG   = awayStats?.defensive_rating ?? null;

  const parseRecord = (rec) => {
    if (!rec) return null;
    const parts = rec.split('-');
    if (parts.length < 2) return null;
    const w = parseInt(parts[0]), l = parseInt(parts[1]);
    return w + l > 0 ? Math.round(w / (w + l) * 100) : null;
  };
  const homeWinPct = parseRecord(match?.home_team?.record);
  const awayWinPct = parseRecord(match?.away_team?.record);

  const buildFormSummary = (form) => {
    if (!form?.matches?.length) return null;
    const matches   = form.matches.slice(0, 10);
    const wins      = matches.filter(m => m.won).length;
    const margins   = matches.map(m => m.margin).filter(m => m != null);
    const avgMargin = margins.length ? (margins.reduce((s,m) => s+m, 0) / margins.length).toFixed(1) : null;
    return { wins, total: matches.length, avgMargin, matches };
  };

  const homeFormSum = buildFormSummary(homeForm);
  const awayFormSum = buildFormSummary(awayForm);

  const renderWL = (form) => {
    if (!form?.matches?.length) return `<div style="font-size:11px;color:var(--color-text-secondary)">Données indisponibles</div>`;
    return `<div style="display:flex;gap:3px;flex-wrap:wrap">
      ${form.matches.slice(0, 10).map(m => {
        const color = m.won ? '#22c55e' : '#ef4444';
        const score = m.team_score != null ? `${m.team_score}-${m.opp_score}` : '';
        return `<span style="width:22px;height:22px;border-radius:4px;background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${color}" title="${score}">${m.won ? 'V' : 'D'}</span>`;
      }).join('')}
    </div>`;
  };

  const statRow = (label, hVal, aVal, higherIsBetter = true) => {
    if (hVal === null && aVal === null) return '';
    const hN = parseFloat(hVal), aN = parseFloat(aVal);
    const hW = !isNaN(hN) && !isNaN(aN) && (higherIsBetter ? hN > aN : hN < aN);
    const aW = !isNaN(hN) && !isNaN(aN) && (higherIsBetter ? aN > hN : aN < hN);
    return `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
        <div style="font-size:12px;font-weight:${hW ? '700' : '400'};color:${hW ? 'var(--color-signal)' : 'var(--color-text)'}">${hVal ?? '—'}</div>
        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;white-space:nowrap">${label}</div>
        <div style="font-size:12px;font-weight:${aW ? '700' : '400'};color:${aW ? 'var(--color-signal)' : 'var(--color-text)'};text-align:right">${aVal ?? '—'}</div>
      </div>`;
  };

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Stats & Forme</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--color-signal)">${homeAbbr}</div>
        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center">Saison</div>
        <div style="font-size:12px;font-weight:700;color:var(--color-signal);text-align:right">${awayAbbr}</div>
      </div>
      ${statRow('Pts marqués/match', homePPG?.toFixed(1) ?? null, awayPPG?.toFixed(1) ?? null)}
      ${statRow('Pts encaissés/match', homeOPPG?.toFixed(1) ?? null, awayOPPG?.toFixed(1) ?? null, false)}
      ${statRow('Net Rating', homeNet != null ? (homeNet > 0 ? '+'+homeNet.toFixed(1) : homeNet.toFixed(1)) : null, awayNet != null ? (awayNet > 0 ? '+'+awayNet.toFixed(1) : awayNet.toFixed(1)) : null)}
      ${statRow('Win %', homeWinPct ? homeWinPct+'%' : null, awayWinPct ? awayWinPct+'%' : null)}
      ${homeFormSum ? statRow('Moy. écart (10j)', homeFormSum.avgMargin ? (homeFormSum.avgMargin > 0 ? '+'+homeFormSum.avgMargin : homeFormSum.avgMargin)+'pts' : null, awayFormSum?.avgMargin ? (awayFormSum.avgMargin > 0 ? '+'+awayFormSum.avgMargin : awayFormSum.avgMargin)+'pts' : null) : ''}
      <div style="margin-top:12px">
        <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">10 derniers matchs</div>
        <div style="margin-bottom:8px">
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:4px">${homeAbbr} — ${homeFormSum ? homeFormSum.wins+'V/'+(homeFormSum.total - homeFormSum.wins)+'D' : '—'}</div>
          ${renderWL(homeForm)}
        </div>
        <div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:4px">${awayAbbr} — ${awayFormSum ? awayFormSum.wins+'V/'+(awayFormSum.total - awayFormSum.wins)+'D' : '—'}</div>
          ${renderWL(awayForm)}
        </div>
      </div>
    </div>`;
}

// ── BLOC ABSENCES & CONTEXTE ──────────────────────────────────────────────────

export function renderBlocAbsences(analysis, match, storeInstance) {
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

  const renderPlayerList = (injuries) => {
    const relevant = injuries.filter(p => ['Out', 'Doubtful', 'Questionable', 'Day-To-Day', 'Limited'].includes(p.status));
    if (!relevant.length) return `<div style="font-size:11px;color:var(--color-text-secondary)">Aucune absence signalée</div>`;
    return relevant.map(p => {
      const color  = STATUS_COLORS[p.status] ?? 'var(--color-muted)';
      const label  = STATUS_LABELS[p.status] ?? p.status;
      const isStar = p.ppg != null && p.ppg >= 20;
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--color-border)">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <span style="font-size:12px;font-weight:${isStar ? '700' : '500'}">${p.name}</span>
            ${p.ppg ? `<span style="font-size:10px;color:var(--color-text-secondary);margin-left:4px">${p.ppg} pts/m</span>` : ''}
            ${isStar ? '<span style="font-size:9px;color:#f97316;margin-left:4px">★ STAR</span>' : ''}
          </div>
          <span style="font-size:10px;font-weight:600;color:${color};flex-shrink:0">${label}</span>
        </div>`;
    }).join('');
  };

  if (!homeInj.length && !awayInj.length && !homeCtx && !awayCtx && !marketSig) return '';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Absences & Contexte</span>
      </div>
      ${(homeInj.length || awayInj.length) ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:${(homeCtx || awayCtx || marketSig) ? '12px' : '0'}">
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--color-text-secondary);margin-bottom:6px">${match?.home_team?.abbreviation ?? 'DOM'}</div>
            ${renderPlayerList(homeInj)}
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--color-text-secondary);margin-bottom:6px">${match?.away_team?.abbreviation ?? 'EXT'}</div>
            ${renderPlayerList(awayInj)}
          </div>
        </div>` : ''}
      ${homeCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;margin-bottom:6px;color:var(--color-text-secondary)"><strong style="color:var(--color-text)">${homeName}</strong> — ${homeCtx}</div>` : ''}
      ${awayCtx ? `<div style="font-size:12px;padding:8px 12px;background:rgba(255,165,0,0.06);border-left:3px solid var(--color-warning);border-radius:6px;margin-bottom:6px;color:var(--color-text-secondary)"><strong style="color:var(--color-text)">${awayName}</strong> — ${awayCtx}</div>` : ''}
      ${marketSig?.movement ? `<div style="font-size:12px;padding:8px 12px;background:rgba(99,179,237,0.06);border-left:3px solid var(--color-signal);border-radius:6px;color:var(--color-text-secondary)">📈 <strong style="color:var(--color-signal)">Mouvement de ligne</strong> — ${marketSig.detail ?? ''}</div>` : ''}
    </div>`;
}

// ── BLOC SYNTHÈSE (placé haut) ───────────────────────────────────────────────

function renderBlocSynthese(analysis, match) {
  if (!analysis) return '';
  const lines = _buildSyntheseLines(analysis, match);
  if (!lines.length) return '';
  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">Synthèse</span>
        <span style="font-size:10px;color:var(--color-text-secondary)">Analyse locale</span>
      </div>
      <div style="font-size:13px;line-height:1.7;color:var(--color-text)">${lines.join('')}</div>
    </div>`;
}

// ── BLOC FIABILITÉ + SOURCES (placé bas) ─────────────────────────────────────

function renderBlocFiabilite(analysis, match) {
  const isMLB = String(match?.sport ?? '').toUpperCase() === 'MLB';

  let score = null;
  if (isMLB) {
    const dq = analysis?.data_quality;
    if      (dq === 'HIGH')   score = 85;
    else if (dq === 'MEDIUM') score = 60;
    else if (dq === 'LOW')    score = 35;
  } else {
    const rob   = analysis?.robustness_score;
    const qual  = analysis?.data_quality_score;
    if (rob != null && qual != null) score = Math.round(((rob + qual) / 2) * 100);
  }

  let fiabLabel, fiabColor;
  if (score === null)   { fiabLabel = '—';       fiabColor = 'var(--color-muted)'; }
  else if (score >= 80) { fiabLabel = 'Élevée';  fiabColor = 'var(--color-success)'; }
  else if (score >= 60) { fiabLabel = 'Moyenne'; fiabColor = 'var(--color-warning)'; }
  else                  { fiabLabel = 'Faible';  fiabColor = 'var(--color-danger)'; }

  const missingSimple = (analysis?.missing_variables ?? []).map(v => SIGNAL_LABELS[v] ?? v).slice(0, 2);
  const sourcesList = ['ESPN', 'BallDontLie', 'Tank01', 'Pinnacle'];

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-2)">
        <span class="bloc-header__title">Fiabilité & sources</span>
        ${score !== null ? `<span style="font-weight:700;color:${fiabColor}">${fiabLabel} · ${score}%</span>` : ''}
      </div>
      ${score !== null ? `
        <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:6px">
          <div style="height:100%;width:${score}%;background:${fiabColor};border-radius:3px"></div>
        </div>
        ${missingSimple.length ? `<div style="font-size:11px;color:var(--color-warning);padding:5px 8px;background:rgba(255,165,0,0.08);border-radius:5px;margin-bottom:10px">⚠ Données manquantes : ${missingSimple.join(' · ')}</div>` : ''}
      ` : ''}
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${sourcesList.map(s => `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--color-bg);border:1px solid var(--color-border);color:var(--color-text-secondary)">${s}</span>`).join('')}
      </div>
    </div>`;
}

function _buildSyntheseLines(analysis, match) {
  const home       = match?.home_team?.name ?? 'Domicile';
  const away       = match?.away_team?.name ?? 'Extérieur';
  const predictive = analysis.predictive_score != null ? Math.round(analysis.predictive_score * 100) : null;
  const keySignals = (analysis.key_signals ?? []).slice(0, 2).map(s => _simplifyLabel(s.label, s.variable)).filter(Boolean);
  const best       = analysis.betting_recommendations?.best ?? null;

  const lines = [];
  const line = (icon, text) => `<div style="display:flex;gap:8px;padding:4px 0"><span style="flex-shrink:0">${icon}</span><div>${text}</div></div>`;

  // Ligne 1 — qui est favori et à combien
  if (predictive != null) {
    const favName  = predictive > 50 ? home : away;
    const favProb  = predictive > 50 ? predictive : 100 - predictive;
    const othProb  = 100 - favProb;
    if (Math.abs(predictive - 50) < 5) {
      lines.push(line('⚖️', `Match équilibré selon notre analyse : <strong>${escapeHtml(home)}</strong> ${predictive}% contre <strong>${escapeHtml(away)}</strong> ${100 - predictive}%.`));
    } else {
      lines.push(line('🎯', `Favori : <strong>${escapeHtml(favName)}</strong> à <strong>${favProb}%</strong> de chances estimées (vs ${othProb}%).`));
    }
  } else {
    lines.push(line('⚠️', 'Données insuffisantes pour déterminer un favori.'));
  }

  // Ligne 2 — comparaison marché vs analyse
  if (best && best.implied_prob != null && best.edge != null) {
    const oddsDec = best.odds_decimal ? Number(best.odds_decimal).toFixed(2) : '—';
    lines.push(line('💰', `Cote bookmaker <strong>${oddsDec}</strong> = marché donne <strong>${best.implied_prob}%</strong> de chances. Notre analyse voit <strong>${best.edge}% de plus</strong> → valeur détectée.`));
  }

  // Ligne 3 — raisons (sans redondance)
  if (keySignals.length) {
    const listed = keySignals.map(s => `<strong>${escapeHtml(s.toLowerCase())}</strong>`).join(' et ');
    lines.push(line('📊', `Ce qui fait pencher l'analyse : ${listed}.`));
  }

  // Ligne 4 — action recommandée
  if (best) {
    const typeLabel = best.type === 'MONEYLINE' ? 'Victoire'
                    : best.type === 'SPREAD' ? 'Handicap'
                    : best.type === 'PLAYER_POINTS' ? `Points ${best.player ?? ''}`
                    : 'Total de points';
    let sideLabel;
    if (best.type === 'PLAYER_POINTS') sideLabel = `${best.side === 'OVER' ? '+' : '−'}${best.line}`;
    else if (best.side === 'HOME')     sideLabel = home;
    else if (best.side === 'AWAY')     sideLabel = away;
    else if (best.side === 'OVER')     sideLabel = `Plus de ${best.ou_line ?? '—'}`;
    else                               sideLabel = `Moins de ${best.ou_line ?? '—'}`;
    lines.push(line('👉', `Pari suggéré : <strong>${escapeHtml(typeLabel)} — ${escapeHtml(sideLabel)}</strong>.`));
  } else {
    lines.push(line('🚫', 'Aucune cote sous-évaluée — passer ce match.'));
  }

  return lines;
}

// ── COTES MULTI-BOOKS ─────────────────────────────────────────────────────────

async function _loadAndRenderMultiBookOdds(container, match, analysis) {
  try {
    const comparison = await ProviderNBA.getOddsComparison();
    if (!comparison) return;
    const matchOdds = ProviderNBA.findMatchOdds(comparison, match.home_team?.name, match.away_team?.name);
    if (!matchOdds?.bookmakers?.length) return;
    const bloc7 = container.querySelector('#bloc-7');
    if (!bloc7) return;
    bloc7.querySelector('.multibook-table')?.remove();

    const BOOK_LABELS = { winamax: 'Winamax', betclic: 'Betclic', unibet_eu: 'Unibet', betsson: 'Betsson', pinnacle: 'Pinnacle', bet365: 'Bet365' };
    const isFlipped   = matchOdds.home_team !== match.home_team?.name;

    const rows = matchOdds.bookmakers.map(bk => {
      const homeOdds = isFlipped ? bk.away_ml : bk.home_ml;
      const awayOdds = isFlipped ? bk.home_ml : bk.away_ml;
      const label    = BOOK_LABELS[bk.key] ?? bk.title;
      return `<tr style="border-bottom:1px solid var(--color-border)"><td style="padding:6px 8px;font-size:12px;color:var(--color-text-secondary)">${label}</td><td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${homeOdds === matchOdds.best_home_ml ? '700' : '400'};color:${homeOdds === matchOdds.best_home_ml ? 'var(--color-success)' : 'var(--color-text)'}">${homeOdds?.toFixed(2) ?? '—'}</td><td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${awayOdds === matchOdds.best_away_ml ? '700' : '400'};color:${awayOdds === matchOdds.best_away_ml ? 'var(--color-success)' : 'var(--color-text)'}">${awayOdds?.toFixed(2) ?? '—'}</td></tr>`;
    }).join('');

    const table = document.createElement('div');
    table.className = 'multibook-table';
    table.style.cssText = 'margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px';
    table.innerHTML = `
      <div class="collapsible" id="books-collapsible">
        <div class="collapsible__header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:0">
          <span style="font-size:11px;color:var(--color-text-secondary);font-weight:600">Comparer les cotes (${matchOdds.bookmakers.length} bookmakers)</span>
          <span class="collapsible__arrow text-muted" style="font-size:12px">▾</span>
        </div>
        <div class="collapsible__body" style="display:none;margin-top:10px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--color-border)"><th style="padding:4px 8px;font-size:10px;color:var(--color-text-secondary);text-align:left;font-weight:500">Bookmaker</th><th style="padding:4px 8px;font-size:10px;color:var(--color-text-secondary);text-align:center;font-weight:500">${match.home_team?.abbreviation ?? 'DOM'}</th><th style="padding:4px 8px;font-size:10px;color:var(--color-text-secondary);text-align:center;font-weight:500">${match.away_team?.abbreviation ?? 'EXT'}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-top:6px">★ Meilleure cote en vert · Source : The Odds API</div>
        </div>
      </div>`;

    bloc7.appendChild(table);
    _checkBetterOddsAlert(bloc7, matchOdds, match, analysis);
    table.querySelector('#books-collapsible .collapsible__header')?.addEventListener('click', () => {
      const body  = table.querySelector('.collapsible__body');
      const arrow = table.querySelector('.collapsible__arrow');
      const open  = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      arrow.textContent  = open ? '▾' : '▴';
    });
  } catch {}
}

function _checkBetterOddsAlert(bloc7, matchOdds, match, analysis) {
  if (!analysis?.betting_recommendations?.best) return;
  const best       = analysis.betting_recommendations.best;
  const isFlipped  = matchOdds.home_team !== match.home_team?.name;
  const draftKings = _americanToDecimal(best.odds_line);
  const sideIsHome = best.side === 'HOME';
  let bestExternal = null, bestBook = null;
  for (const bk of (matchOdds.bookmakers ?? [])) {
    const oddsVal = isFlipped ? (sideIsHome ? bk.away_ml : bk.home_ml) : (sideIsHome ? bk.home_ml : bk.away_ml);
    if (oddsVal && (!bestExternal || oddsVal > bestExternal)) { bestExternal = oddsVal; bestBook = bk.title; }
  }
  if (!bestExternal || !draftKings || bestExternal <= draftKings) return;
  bloc7.querySelector('.better-odds-alert')?.remove();
  const alert = document.createElement('div');
  alert.className   = 'better-odds-alert';
  alert.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(72,199,142,0.1);border-left:3px solid var(--color-success);border-radius:6px;font-size:12px;';
  alert.innerHTML   = `<div style="color:var(--color-success);font-weight:700;margin-bottom:2px">💡 Meilleure cote disponible</div><div style="color:var(--color-text-secondary)">${bestBook} propose <strong style="color:var(--color-text)">${bestExternal.toFixed(2)}</strong> au lieu de ${draftKings} — misez sur ${bestBook}.</div>`;
  bloc7.appendChild(alert);
}

// ── ÉVÉNEMENTS ────────────────────────────────────────────────────────────────

function bindEvents(container, storeInstance, match, analysis) {
  container.querySelector('#back-btn')?.addEventListener('click', () => router.navigate('dashboard'));

  container.querySelector('#share-btn')?.addEventListener('click', () => {
    if (!analysis?.betting_recommendations?.best) return;
    const best      = analysis.betting_recommendations.best;
    const SIDE_MAP  = { HOME: match.home_team?.name, AWAY: match.away_team?.name, OVER: 'Over', UNDER: 'Under' };
    const sideLabel = SIDE_MAP[best.side] ?? best.side;
    const odds      = _americanToDecimal(best.odds_line);
    const text = `🏀 ${match.home_team?.name} vs ${match.away_team?.name}\n✅ Pari : ${sideLabel} @ ${odds}\n📊 Cote sous-évaluée : +${best.edge}%\n🤖 Mani Bet Pro`;
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

  // ── Sélecteur lignes O/U alternatives (v6.34) ────────────────────────────
  container.querySelectorAll('.ou-alt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Désactiver tous les boutons
      container.querySelectorAll('.ou-alt-btn').forEach(b => {
        b.classList.remove('ou-alt-btn--active');
        b.style.fontWeight    = '500';
        b.style.borderColor   = 'var(--color-border)';
        b.style.background    = 'var(--color-bg)';
        b.style.color         = 'var(--color-text-muted)';
      });
      // Activer le bouton cliqué
      btn.classList.add('ou-alt-btn--active');
      btn.style.fontWeight  = '700';
      btn.style.borderColor = 'var(--color-signal)';
      btn.style.background  = 'rgba(59,130,246,0.1)';
      btn.style.color       = 'var(--color-signal)';

      const line       = parseFloat(btn.dataset.line);
      const overOdds   = parseFloat(btn.dataset.over);
      const underOdds  = parseFloat(btn.dataset.under);
      const motorOver  = btn.dataset.motorOver  ? parseFloat(btn.dataset.motorOver)  : null;
      const motorUnder = btn.dataset.motorUnder ? parseFloat(btn.dataset.motorUnder) : null;

      // Recalculer edge
      const impliedOver  = Math.round((1 / overOdds)  * 100);
      const impliedUnder = Math.round((1 / underOdds)  * 100);
      const edgeOver     = motorOver  !== null ? motorOver  - impliedOver  : null;
      const edgeUnder    = motorUnder !== null ? motorUnder - impliedUnder : null;

      const edgeColor = (e) => e >= 8 ? '#22c55e' : e >= 4 ? '#f97316' : e > 0 ? 'var(--color-muted)' : '#ef4444';

      const rowHtml = (label, odds, impliedProb, edge, motorProb) => `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;
                    padding:8px 10px;background:var(--color-bg);border-radius:8px;
                    border:1px solid transparent;margin-bottom:4px">
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600">${label}</div>
            <div style="font-size:10px;color:var(--color-text-secondary)">
              ${motorProb !== null ? motorProb + '% analyse' : '—'} · book ${impliedProb}%
            </div>
          </div>
          <div style="text-align:center;min-width:42px">
            <div style="font-size:14px;font-weight:700;color:var(--color-signal)">${odds.toFixed(2)}</div>
            <div style="font-size:9px;color:var(--color-text-secondary)">Pinnacle</div>
          </div>
          <div style="text-align:center;min-width:52px">
            ${edge !== null
              ? `<div style="font-size:15px;font-weight:800;color:${edgeColor(edge)}">${edge > 0 ? '+' : ''}${edge}%</div>`
              : '<div style="color:var(--color-muted);font-size:11px">—</div>'
            }
          </div>
        </div>`;

      const ouAltRows = container.querySelector('#ou-alt-rows');
      if (ouAltRows) {
        ouAltRows.innerHTML =
          rowHtml(`Plus de ${line} pts`,  overOdds,  impliedOver,  edgeOver,  motorOver) +
          rowHtml(`Moins de ${line} pts`, underOdds, impliedUnder, edgeUnder, motorUnder);
      }
    });
  });

  // Afficher la ligne principale par défaut dans #ou-alt-rows si alt présentes
  const activeAltBtn = container.querySelector('.ou-alt-btn--active');
  if (activeAltBtn) activeAltBtn.click();
}

// ── MODAL PAPER TRADING ───────────────────────────────────────────────────────

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
  const ouLine      = btn.dataset.ouLine     !== '' ? Number(btn.dataset.ouLine)     : null;

  const state       = PaperEngine.load();
  const bankroll    = state.current_bankroll;
  const kellySugg   = kelly > 0 ? Math.round(kelly * bankroll * 100) / 100 : null;
  const oddsDecimal = _americanToDecimal(odds);
  const marketLabels = { MONEYLINE: 'Vainqueur', SPREAD: 'Handicap', OVER_UNDER: 'Total pts', PLAYER_POINTS: 'Props joueur' };

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
          <span style="font-size:11px;color:var(--color-text-secondary)">${marketLabels[market] ?? market}</span>
          <span style="font-size:14px;font-weight:700">${sideLabel}</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-signal)">${oddsDecimal}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--color-text-secondary)">
          <span>Cote sous-évaluée <strong style="color:var(--color-text)">${edge}%</strong></span>
          <span>Moteur <strong style="color:var(--color-text)">${motorProb}%</strong></span>
          <span>Book <strong style="color:var(--color-text)">${impliedProb}%</strong></span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <span style="font-size:12px;color:var(--color-text-secondary)">Bankroll disponible</span>
        <span style="font-size:15px;font-weight:700">${bankroll.toFixed(2)} €</span>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">Cote réelle prise <span style="font-style:italic">(modifiez si vous misez sur un autre book)</span></label>
        <input type="number" id="odds-input" class="paper-modal__input" value="${oddsDecimal}" placeholder="Ex: 2.70" step="0.05" min="1.01" style="font-size:20px;font-weight:700;text-align:center;letter-spacing:0.05em"/>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">Mise (€)${kellySugg ? `<span style="color:var(--color-signal);font-weight:600"> · Conseillé : ${kellySugg.toFixed(2)} €</span>` : ''}</label>
        <input type="number" id="stake-input" class="paper-modal__input" value="${kellySugg ?? ''}" placeholder="Montant en €" min="0.5" max="${bankroll.toFixed(2)}" step="0.5" style="font-size:16px;font-weight:600;text-align:center"/>
      </div>
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">Note (optionnel)</label>
        <input type="text" id="note-input" class="paper-modal__input" placeholder="Ex: blessure clé…" maxlength="200"/>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="modal-cancel" style="flex:1;padding:12px">Annuler</button>
        <button class="btn btn--primary" id="modal-confirm" style="flex:2;padding:12px;font-size:14px;font-weight:600">✓ Confirmer</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#modal-close')?.addEventListener('click',  () => modal.remove());
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

    const topSignal = analysis?.key_signals?.[0]
      ? (_simplifyLabel(analysis.key_signals[0].label, analysis.key_signals[0].variable)
         + ' (' + (analysis.key_signals[0].direction === 'POSITIVE' ? '▲ dom.' : '▼ ext.') + ')')
      : null;
    const matchTime = match.datetime
      ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : null;

    await PaperEngine.placeBet({
      match_id: match.id, date: match.date, sport: 'NBA',
      home: match.home_team?.name ?? '—', away: match.away_team?.name ?? '—',
      market, side, side_label: sideLabel,
      odds_taken: oddsAm, odds_decimal: oddsReal, odds_source: null,
      spread_line: spreadLine, ou_line: ouLine,
      stake, kelly_stake: kelly, edge, motor_prob: motorProb, implied_prob: impliedProb,
      confidence_level: analysis?.confidence_level ?? null,
      data_quality: analysis?.data_quality_score ?? null,
      decision_note: note, top_signal: topSignal, match_time: matchTime,
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

// ── NO MATCH ──────────────────────────────────────────────────────────────────

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
