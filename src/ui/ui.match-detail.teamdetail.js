/**
 * MANI BET PRO — ui.match-detail.teamdetail.js v1.0
 *
 * Extrait depuis ui.match-detail.js v3.8 (refactor v3.9).
 * Responsabilité : rendu du bloc Team Detail (5 sections).
 *   1. Stats équipes côte à côte
 *   2. Top 10 scoreurs avec onglets
 *   3. 10 derniers matchs avec scores
 *   4. H2H + tendance O/U
 *   5. Joueurs absents triés par PPG
 *
 * Note : ESPN_TO_TANK01_ABV supprimé — centralisé dans sports.config.js (NBA_TEAMS v6.4).
 * L'import getNBAAbvFromEspn n'est pas nécessaire ici car les abréviations viennent
 * directement des données match (match.home_team.abbreviation) fournies par l'orchestrateur.
 */

import { Logger } from '../utils/utils.logger.js';
import {
  resolveLatestAnalysisForMatch,
} from './ui.match-detail.helpers.js';

// ── LOADER ASYNCHRONE ─────────────────────────────────────────────────────────

export async function loadAndRenderTeamDetail(container, match, storeInstance) {
  const detailEl = container.querySelector('#team-detail-container');
  if (!detailEl) return;

  try {
    const teamDetails = storeInstance?.get('teamDetails') ?? {};
    const teamDetail  = teamDetails[match.id] ?? null;
    const injReport   = storeInstance?.get('injuryReport') ?? null;

    if (!teamDetail) {
      detailEl.innerHTML = `
        <div class="card match-detail__bloc" style="text-align:center;padding:22px 16px">
          <div style="font-size:13px;color:var(--color-muted);line-height:1.7">
            Les stats avancées d'équipe sont chargées pendant la synchronisation de 12h, 23h ou via le refresh manuel du dashboard.
          </div>
        </div>`;
      return;
    }

    detailEl.innerHTML = renderBlocTeamDetail(match, teamDetail, injReport);

  } catch (err) {
    Logger.warn('TEAM_DETAIL_RENDER_FAILED', { message: err.message });
    // Fallback : message simple pour éviter la dépendance circulaire avec ui.match-detail.js
    detailEl.innerHTML = `
      <div class="card match-detail__bloc">
        <div style="font-size:12px;color:var(--color-muted);padding:8px 0">
          Stats avancées temporairement indisponibles — actualise le dashboard pour recharger.
        </div>
      </div>`;
  }
}

export function renderBlocTeamDetailSkeleton() {
  return `
    <div class="card match-detail__bloc" style="text-align:center;padding:24px 0">
      <div style="display:inline-flex;align-items:center;gap:8px;color:var(--color-muted);font-size:13px">
        <div style="width:14px;height:14px;border:2px solid var(--color-muted);border-top-color:var(--color-signal);border-radius:50%;animation:spin 0.8s linear infinite"></div>
        Chargement stats avancées…
      </div>
    </div>`;
}

export function renderBlocTeamDetail(match, teamDetail, injReport) {
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

// ── HELPERS COMMUNS ───────────────────────────────────────────────────────────

function _resultBadge(result) {
  const color  = result === 'W' ? '#22c55e' : result === 'L' ? '#ef4444' : '#6b7280';
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
  const { last3W } = momentum;
  if (last3W >= 2) return `<span style="color:#22c55e;font-size:11px">🔥 ${last3W}/3 derniers</span>`;
  if (last3W === 0) return `<span style="color:#ef4444;font-size:11px">❄️ ${last3W}/3 derniers</span>`;
  return `<span style="color:var(--color-muted);font-size:11px">→ ${last3W}/3 derniers</span>`;
}

// ── SECTION 1 : STATS ÉQUIPES ─────────────────────────────────────────────────

function _renderTDStats(match, teamDetail) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';
  const hStats  = match?.home_season_stats ?? {};
  const aStats  = match?.away_season_stats ?? {};
  const hDetail = teamDetail?.home ?? {};
  const aDetail = teamDetail?.away ?? {};

  const rows = [
    { label: 'Pts/match',     hVal: hStats.avg_pts?.toFixed(1),          aVal: aStats.avg_pts?.toFixed(1),          better: 'high' },
    { label: 'Pts encaissés', hVal: hDetail.avgTotal != null ? (hDetail.avgTotal - (hStats.avg_pts ?? 0)).toFixed(1) : null,
                               aVal: aDetail.avgTotal != null ? (aDetail.avgTotal - (aStats.avg_pts ?? 0)).toFixed(1) : null, better: 'low' },
    { label: 'Net Rating',    hVal: hStats.net_rating != null ? (hStats.net_rating > 0 ? '+' : '') + hStats.net_rating?.toFixed(1) : null,
                               aVal: aStats.net_rating != null ? (aStats.net_rating > 0 ? '+' : '') + aStats.net_rating?.toFixed(1) : null, better: 'high', raw: true },
    { label: 'Win %',         hVal: hStats.win_pct != null ? Math.round(hStats.win_pct * 100) + '%' : null,
                               aVal: aStats.win_pct != null ? Math.round(aStats.win_pct * 100) + '%' : null, better: 'high', raw: true },
    { label: 'Moy. total',    hVal: hDetail.avgTotal?.toFixed(1),        aVal: aDetail.avgTotal?.toFixed(1),        better: null },
    { label: 'Pts/m last5',   hVal: hDetail.last5ScoringAvg?.toFixed(1), aVal: aDetail.last5ScoringAvg?.toFixed(1), better: 'high' },
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
          <div style="font-size:11px">🏠 ${hDetail.homeSplit ? `${hDetail.homeSplit.wins}-${hDetail.homeSplit.losses}` : '—'} · ✈️ ${hDetail.awaySplit ? `${hDetail.awaySplit.wins}-${hDetail.awaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(hDetail.momentum)}</div>
        </div>
        <div style="background:var(--color-bg);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:3px">${awayAbv} — Dom/Ext</div>
          <div style="font-size:11px">🏠 ${aDetail.homeSplit ? `${aDetail.homeSplit.wins}-${aDetail.homeSplit.losses}` : '—'} · ✈️ ${aDetail.awaySplit ? `${aDetail.awaySplit.wins}-${aDetail.awaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(aDetail.momentum)}</div>
        </div>
      </div>
    </div>`;
}

// ── SECTION 2 : TOP 10 SCOREURS ───────────────────────────────────────────────

function _renderTDTop10(match, teamDetail, injReport) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const homeName = match?.home_team?.name ?? '';
  const awayName = match?.away_team?.name ?? '';
  const uid      = 'top10_' + (match?.id ?? Date.now());

  // Construire une Map nom→statut PAR ÉQUIPE — affiche le bon badge (OUT/DTD/etc.)
  // au lieu d'un générique OUT pour tous les joueurs listés dans les absences.
  const buildAbsentMap = (teamName) => {
    const map = new Map();
    const players = injReport?.by_team?.[teamName] ?? [];
    players.forEach(p => { if (p?.name) map.set(p.name.toLowerCase(), p.status ?? 'Out'); });
    return map;
  };
  const homeAbsentMap = buildAbsentMap(homeName);
  const awayAbsentMap = buildAbsentMap(awayName);

  const STATUS_BADGE = {
    'Out':          { label: 'OUT',  color: '#ef4444' },
    'Doubtful':     { label: 'DOUT', color: '#f97316' },
    'Day-To-Day':   { label: 'DTD',  color: '#eab308' },
    'Questionable': { label: '?',    color: '#eab308' },
    'Limited':      { label: 'LIM',  color: '#a78bfa' },
  };

  const renderTable = (players, absentMap) => {
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
            const status  = absentMap.get((p.name ?? '').toLowerCase()) ?? null;
            const absent  = status !== null;
            const badge   = absent ? (STATUS_BADGE[status] ?? { label: status, color: '#ef4444' }) : null;
            const star    = p.pts >= 20;
            const bg      = absent ? 'rgba(239,68,68,0.06)' : i % 2 === 0 ? '' : 'var(--color-bg)';
            return `
              <tr style="background:${bg};border-bottom:1px solid var(--color-border);${absent ? 'opacity:0.65' : ''}">
                <td style="padding:6px 6px;color:${absent ? badge.color : 'var(--color-text)'};white-space:nowrap;overflow:hidden;max-width:110px;text-overflow:ellipsis">
                  ${star ? '⭐ ' : ''}${p.name ?? '—'}${absent ? ` <span style="font-size:9px;color:${badge.color};font-weight:700">${badge.label}</span>` : ''}
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
      <div id="${uid}_H" style="display:block;overflow-x:auto">${renderTable(teamDetail?.home?.top10scorers, homeAbsentMap)}</div>
      <div id="${uid}_A" style="display:none;overflow-x:auto">${renderTable(teamDetail?.away?.top10scorers, awayAbsentMap)}</div>
    </div>`;
}

// ── SECTION 3 : 10 DERNIERS MATCHS ───────────────────────────────────────────

function _renderTDLast10(match, teamDetail) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';

  const renderTimeline = (games) => {
    if (!games?.length) return `<div style="font-size:11px;color:var(--color-muted)">Données indisponibles</div>`;
    return games.map(g => {
      const dateStr = g.date ? `${g.date.slice(4,6)}/${g.date.slice(6,8)}` : '';
      const locIcon = g.homeAway === 'home' ? '🏠' : '✈️';
      return `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;background:var(--color-bg);margin-bottom:4px">
          ${_resultBadge(g.result)}
          <span style="font-size:10px;color:var(--color-muted);width:30px">${dateStr}</span>
          <span style="font-size:11px;font-weight:600;min-width:28px">${g.opponent ?? '?'}</span>
          <span style="font-size:10px">${locIcon}</span>
          <span style="font-size:11px;color:var(--color-muted);margin-left:auto;font-variant-numeric:tabular-nums">${g.score ?? '—'}</span>
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

// ── SECTION 4 : H2H + O/U TREND ──────────────────────────────────────────────

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
        const dateStr  = g.date ? `${g.date.slice(4,6)}/${g.date.slice(6,8)}` : '';
        const won      = g.result === 'W';
        const color    = won ? '#22c55e' : '#ef4444';
        const isHome   = g.homeAway === 'home';
        const venue    = isHome ? '🏠' : '✈️';
        // Score affiché comme : DOM XXX - YYY EXT
        // L'équipe "home" dans ce contexte = l'équipe qu'on analyse (home_team du match affiché)
        const teamPts  = g.teamPts ?? '—';
        const oppPts   = g.oppPts  ?? '—';
        // En H2H, g.result = résultat pour homeAbv (l'équipe domicile du match affiché)
        const winnerAbv = won ? homeAbv : (g.opponent ?? awayAbv);

        return `
          <div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;padding:6px 8px;border-radius:6px;background:var(--color-bg);margin-bottom:4px;border-left:3px solid ${color}">
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:9px;font-weight:700;color:${color};width:14px">${won ? 'V' : 'D'}</span>
              <span style="font-size:10px;color:var(--color-muted)">${dateStr}</span>
              <span style="font-size:10px">${venue}</span>
            </div>
            <div style="font-size:11px;font-weight:600;text-align:center">
              <span style="color:${won ? 'var(--color-success)' : 'var(--color-muted)'}">${homeAbv}</span>
              <span style="color:var(--color-muted);margin:0 4px">·</span>
              <span style="font-weight:700">${teamPts} – ${oppPts}</span>
              <span style="color:var(--color-muted);margin:0 4px">·</span>
              <span style="color:${won ? 'var(--color-muted)' : 'var(--color-danger)'}">${g.opponent ?? awayAbv}</span>
            </div>
            <div style="font-size:9px;color:${color};font-weight:700;text-align:right;min-width:28px">
              ${won ? `+${teamPts - oppPts}` : `${teamPts - oppPts}`}
            </div>
          </div>`;
      }).join('')
    : `<div style="font-size:11px;color:var(--color-muted)">Pas de confrontation cette saison</div>`;

  // Bilan H2H rapide
  const h2hWins   = h2h.filter(g => g.result === 'W').length;
  const h2hTotal  = Math.min(h2h.length, 5);
  const h2hBilan  = h2hTotal > 0
    ? `<div style="font-size:11px;color:var(--color-muted);margin-bottom:8px">${homeAbv} : <strong style="color:var(--color-text)">${h2hWins}V / ${h2hTotal - h2hWins}D</strong> cette saison</div>`
    : '';

  return `
    <div class="card match-detail__bloc">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div class="bloc-header" style="margin-bottom:var(--space-2)">
            <span class="bloc-header__title">🔁 H2H saison</span>
          </div>
          ${h2hBilan}
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

// ── SECTION 5 : JOUEURS ABSENTS ───────────────────────────────────────────────

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

  const renderList = (players) => {
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
          ${renderList(homeList)}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-muted);margin-bottom:6px;text-transform:uppercase">${awayAbv}</div>
          ${renderList(awayList)}
        </div>
      </div>
    </div>`;
}
