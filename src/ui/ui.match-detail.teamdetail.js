/**
 * MANI BET PRO — ui.match-detail.teamdetail.js v2.1
 *
 * AJOUTS v2.1 :
 *   - Affichage du résumé du dernier match sous chaque équipe dans "📈 Stats équipes"
 *   - Affichage d’un lien / titre média Basket USA si le worker renvoie latestMediaSummary
 *   - Compatible avec /nba/team-detail enrichi : home.latestGame, away.latestGame,
 *     home.latestMediaSummary, away.latestMediaSummary
 *
 * AMÉLIORATIONS v2.0 :
 *   - Nouvelle disposition : Absences remonte avant Top 10 scoreurs
 *   - Stats équipes : griser valeurs identiques (< 3% écart), "Moy. 5 derniers" au lieu de "Pts/m last5"
 *   - Absences : PPG affiché à côté de chaque joueur
 *   - Last10 : scores avec deux équipes nommées (PHI 126 – MIL 106)
 *   - H2H : dates en format français (9 jan.)
 *   - O/U : légende repositionnée pour mobile
 *   - Top 10 scoreurs : L5 simplifiée sans flèche (23.0 · -5.3)
 *   - Modal équipe : stats saison + playoffs + forme (panneau bas)
 *   - Titre : 📈 Stats équipes (au lieu de 📊)
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
          <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.7">
            Les stats avancées d'équipe sont chargées pendant la synchronisation de 12h, 23h ou via le refresh manuel du dashboard.
          </div>
        </div>`;
      return;
    }

    detailEl.innerHTML = renderBlocTeamDetail(match, teamDetail, injReport);
    bindLast10Clicks(detailEl, teamDetail);
    _bindTeamNameClicks(detailEl, match, teamDetail, injReport);

  } catch (err) {
    Logger.warn('TEAM_DETAIL_RENDER_FAILED', { message: err.message });
    detailEl.innerHTML = `
      <div class="card match-detail__bloc">
        <div style="font-size:12px;color:var(--color-text-secondary);padding:8px 0">
          Stats avancées temporairement indisponibles — actualise le dashboard pour recharger.
        </div>
      </div>`;
  }
}

export function renderBlocTeamDetailSkeleton() {
  return `
    <div class="card match-detail__bloc" id="team-detail-skeleton" style="padding:20px;text-align:center">
      <div style="font-size:12px;color:var(--color-text-secondary)">Chargement des stats équipes…</div>
    </div>`;
}

export function renderBlocTeamDetail(match, teamDetail, injReport) {
  if (!teamDetail) {
    return `<div class="card match-detail__bloc"><div class="text-muted" style="font-size:12px;padding:8px 0">Stats avancées indisponibles pour ce match.</div></div>`;
  }
  // Nouvelle disposition : Absences remonte avant Top 10
  return [
    _renderTDStats(match, teamDetail),
    _renderTDAbsents(match, injReport),        // ← remonté
    _renderTDTop10(match, teamDetail, injReport),
    _renderTDLast10(match, teamDetail),
    _renderTDH2H_OU(match, teamDetail),
  ].join('');
}

// ── HELPERS COMMUNS ───────────────────────────────────────────────────────────

function _resultBadge(result) {
  const color  = result === 'W' ? '#22c55e' : result === 'L' ? '#ef4444' : '#6b7280';
  const letter = result === 'W' ? 'V' : result === 'L' ? 'D' : '?';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${color};color:#fff;font-size:10px;font-weight:700;flex-shrink:0">${letter}</span>`;
}

// L5 simplifiée sans flèche — ex: 23.0 (-5.3)
function _l5Display(season, last5) {
  if (last5 === null || last5 === undefined) return '—';
  const diff = last5 - (season ?? 0);
  const sign = diff >= 0 ? '+' : '';
  const color = diff > 1.5 ? '#22c55e' : diff < -1.5 ? '#ef4444' : 'var(--color-muted)';
  return `${last5.toFixed(1)} <span style="color:${color};font-size:10px">(${sign}${diff.toFixed(1)})</span>`;
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
  return `<span style="color:var(--color-text-secondary);font-size:11px">→ ${last3W}/3 derniers</span>`;
}

// Format date français : YYYYMMDD → "9 jan."
function _fmtDateFR(dateStr) {
  if (!dateStr) return '';
  const MOIS = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  const m = parseInt(dateStr.slice(4,6)) - 1;
  const d = parseInt(dateStr.slice(6,8));
  return `${d} ${MOIS[m] ?? ''}`;
}

function _escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _renderLatestInfoBlock(teamData, teamAbv) {
  const latestGame  = teamData?.latestGame ?? null;
  const latestMedia = teamData?.latestMediaSummary ?? null;

  if (!latestGame && !latestMedia) return '';

  const gameHtml = latestGame
    ? `
      <div style="font-size:11px;line-height:1.45;color:var(--color-text);margin-top:5px">
        <span style="font-weight:700;color:var(--color-text-secondary)">Dernier match :</span>
        <span>${_escapeHtml(latestGame.summary_long ?? latestGame.summary_short ?? 'Résumé indisponible')}</span>
      </div>`
    : '';

  const mediaTitle = latestMedia?.title ? _escapeHtml(latestMedia.title) : 'Article lié disponible';
  const mediaUrl   = latestMedia?.url ? String(latestMedia.url) : null;
  const mediaHtml = latestMedia
    ? `
      <div style="font-size:11px;line-height:1.45;color:var(--color-text);margin-top:4px">
        <span style="font-weight:700;color:var(--color-text-secondary)">Basket USA :</span>
        ${
          mediaUrl
            ? `<a href="${mediaUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--color-signal);text-decoration:underline">${mediaTitle}</a>`
            : `<span>${mediaTitle}</span>`
        }
      </div>`
    : '';

  return `
    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--color-border)">
      ${gameHtml}
      ${mediaHtml}
    </div>`;
}

// ── SECTION 1 : STATS ÉQUIPES ─────────────────────────────────────────────────

function _renderTDStats(match, teamDetail) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const homeName = match?.home_team?.name ?? homeAbv;
  const awayName = match?.away_team?.name ?? awayAbv;
  const hStats   = match?.home_season_stats ?? {};
  const aStats   = match?.away_season_stats ?? {};
  const hDetail  = teamDetail?.home ?? {};
  const aDetail  = teamDetail?.away ?? {};

  const rows = [
    { label: 'Pts/match',      hVal: hStats.avg_pts?.toFixed(1),      aVal: aStats.avg_pts?.toFixed(1),      better: 'high' },
    { label: 'Pts encaissés',  hVal: hDetail.avgTotal != null ? (hDetail.avgTotal - (hStats.avg_pts ?? 0)).toFixed(1) : null,
                                aVal: aDetail.avgTotal != null ? (aDetail.avgTotal - (aStats.avg_pts ?? 0)).toFixed(1) : null, better: 'low' },
    { label: 'Win %',          hVal: hStats.win_pct != null ? Math.round(hStats.win_pct * 100) + '%' : null,
                                aVal: aStats.win_pct != null ? Math.round(aStats.win_pct * 100) + '%' : null, better: 'high',
                                hRaw: hStats.win_pct, aRaw: aStats.win_pct },
    { label: 'Moy. total',     hVal: hDetail.avgTotal?.toFixed(1),    aVal: aDetail.avgTotal?.toFixed(1),    better: null,
                                hRaw: hDetail.avgTotal, aRaw: aDetail.avgTotal },
    { label: 'Moy. 5 derniers',hVal: hDetail.last5ScoringAvg?.toFixed(1), aVal: aDetail.last5ScoringAvg?.toFixed(1), better: 'high' },
  ];

  const rowsHtml = rows.map(r => {
    if (!r.hVal && !r.aVal) return '';
    const hNum = parseFloat(r.hVal);
    const aNum = parseFloat(r.aVal);

    // Griser si écart < 3% (ou < 3 points pour totaux)
    const hRaw   = r.hRaw ?? hNum;
    const aRaw   = r.aRaw ?? aNum;
    const avg    = (Math.abs(hRaw) + Math.abs(aRaw)) / 2;
    const ecart  = avg > 0 ? Math.abs(hRaw - aRaw) / avg : 0;
    const tooClose = ecart < 0.03;

    const hBetter = !tooClose && (r.better === 'high' ? hNum > aNum : r.better === 'low' ? hNum < aNum : false);
    const aBetter = !tooClose && (r.better === 'high' ? aNum > hNum : r.better === 'low' ? aNum < hNum : false);

    const hColor = hBetter ? 'var(--color-signal)' : 'var(--color-text)';
    const aColor = aBetter ? 'var(--color-signal)' : 'var(--color-text)';

    return `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
        <div style="font-size:12px;font-weight:${hBetter ? '700' : '400'};color:${hColor}">${r.hVal ?? '—'}</div>
        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;white-space:nowrap">${r.label}</div>
        <div style="font-size:12px;font-weight:${aBetter ? '700' : '400'};color:${aColor};text-align:right">${r.aVal ?? '—'}</div>
      </div>`;
  }).join('');

  // Noms cliquables → modal équipe
  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">📈 Stats équipes</span>
        <div style="display:flex;gap:6px;align-items:center;font-size:11px">
          <strong>${homeAbv}</strong>${_restBadge(hDetail.restDays)}
          <span style="color:var(--color-text-secondary)">vs</span>
          <strong>${awayAbv}</strong>${_restBadge(aDetail.restDays)}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:8px">
        <button class="team-name-btn" data-team-side="home"
          style="font-size:12px;font-weight:700;color:var(--color-signal);background:none;border:none;cursor:pointer;text-align:left;padding:0;text-decoration:underline dotted">${homeName}</button>
        <div style="font-size:9px;color:var(--color-text-secondary);text-align:center">Saison</div>
        <button class="team-name-btn" data-team-side="away"
          style="font-size:12px;font-weight:700;color:var(--color-signal);background:none;border:none;cursor:pointer;text-align:right;padding:0;text-decoration:underline dotted">${awayName}</button>
      </div>
      ${rowsHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <div style="background:var(--color-bg);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:3px">${homeAbv} — Dom/Ext</div>
          <div style="font-size:11px">🏠 ${hDetail.homeSplit ? `${hDetail.homeSplit.wins}-${hDetail.homeSplit.losses}` : '—'} · ✈️ ${hDetail.awaySplit ? `${hDetail.awaySplit.wins}-${hDetail.awaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(hDetail.momentum)}</div>
          ${_renderLatestInfoBlock(hDetail, homeAbv)}
        </div>
        <div style="background:var(--color-bg);border-radius:8px;padding:8px 10px">
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:3px">${awayAbv} — Dom/Ext</div>
          <div style="font-size:11px">🏠 ${aDetail.homeSplit ? `${aDetail.homeSplit.wins}-${aDetail.homeSplit.losses}` : '—'} · ✈️ ${aDetail.awaySplit ? `${aDetail.awaySplit.wins}-${aDetail.awaySplit.losses}` : '—'}</div>
          <div style="margin-top:3px">${_momentumBadge(aDetail.momentum)}</div>
          ${_renderLatestInfoBlock(aDetail, awayAbv)}
        </div>
      </div>
    </div>`;
}

// ── SECTION 2 : ABSENCES (remontée) ──────────────────────────────────────────

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
      const ppg   = parseFloat(p.ppg);
      const star  = ppg >= 20;
      return `
        <div style="display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;border-left:3px solid ${color};background:var(--color-bg);margin-bottom:4px">
          <div style="flex:1;min-width:0">
            <span style="font-size:12px;font-weight:600">${star ? '⭐ ' : ''}${p.name}</span>
            ${ppg > 0 ? `<span style="font-size:11px;font-weight:700;color:${star ? '#f97316' : 'var(--color-muted)'};margin-left:5px">${ppg.toFixed(1)} pts/m</span>` : ''}
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
        <div class="bloc-header" style="margin-bottom:var(--space-2)"><span class="bloc-header__title">🏥 Absences</span></div>
        <div style="font-size:12px;color:#22c55e">✅ Aucune absence signalée pour ce match</div>
      </div>`;
  }

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🏥 Absences</span>
        <span style="font-size:10px;color:var(--color-text-secondary)">triées par PPG</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);margin-bottom:6px;text-transform:uppercase">${homeAbv}</div>
          ${renderList(homeList)}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);margin-bottom:6px;text-transform:uppercase">${awayAbv}</div>
          ${renderList(awayList)}
        </div>
      </div>
    </div>`;
}

// ── SECTION 3 : TOP 10 SCOREURS ───────────────────────────────────────────────

function _renderTDTop10(match, teamDetail, injReport) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const homeName = match?.home_team?.name ?? '';
  const awayName = match?.away_team?.name ?? '';
  const uid      = 'top10_' + (match?.id ?? Date.now());

  const buildAbsentMap = (teamName) => {
    const map = new Map();
    const players = injReport?.by_team?.[teamName] ?? [];

    const _norm = name => String(name ?? '').toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, '').replace(/'/g, '')
      .replace(/\s+/g, ' ').trim();

    // Indexer les joueurs blessés par nom normalisé
    const injured = players
      .filter(p => p?.name)
      .map(p => ({ normName: _norm(p.name), status: p.status ?? 'Out' }));

    // Pour chaque joueur du top10, chercher un match exact ou par préfixe
    return {
      get: (rawName) => {
        const n = _norm(rawName);
        for (const inj of injured) {
          if (inj.normName === n) return inj.status;
          // Préfixe : "jimmy butler" match "jimmy butler iii" (min 8 chars)
          if (n.length >= 8 && inj.normName.startsWith(n + ' ')) return inj.status;
          if (inj.normName.length >= 8 && n.startsWith(inj.normName + ' ')) return inj.status;
        }
        return null;
      },
    };
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
    if (!players?.length) return `<div style="font-size:12px;color:var(--color-text-secondary);padding:8px">Données indisponibles</div>`;
    return `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="border-bottom:1px solid var(--color-border)">
            <th style="padding:5px 6px;text-align:left;color:var(--color-text-secondary);font-weight:600">Joueur</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">PPG</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">L5</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">REB</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">AST</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">STL</th>
            <th style="padding:5px 4px;text-align:center;color:var(--color-text-secondary);font-weight:600">BLK</th>
          </tr>
        </thead>
        <tbody>
          ${players.map((p, i) => {
            const status  = absentMap.get((p.name ?? '').toLowerCase()) ?? null;
            const absent  = status !== null;
            const badge   = absent ? (STATUS_BADGE[status] ?? { label: status, color: '#ef4444' }) : null;
            const star    = p.ppg >= 20;
            const bg      = absent ? 'rgba(239,68,68,0.06)' : i % 2 === 0 ? '' : 'var(--color-bg)';
            return `
              <tr style="background:${bg};border-bottom:1px solid var(--color-border);${absent ? 'opacity:0.65' : ''}">
                <td style="padding:6px 6px;color:var(--color-text);white-space:nowrap;overflow:hidden;max-width:110px;text-overflow:ellipsis">
                  ${star ? '⭐ ' : ''}${p.name ?? '—'}${absent ? ` <span style="font-size:9px;color:${badge.color};font-weight:700;margin-left:3px">${badge.label}</span>` : ''}
                </td>
                <td style="padding:6px 4px;text-align:center;font-weight:600">${p.ppg?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;font-size:10px">${_l5Display(p.ppg, p.last5_ppg)}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-text-secondary)">${p.reb?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-text-secondary)">${p.ast?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-text-secondary)">${p.stl?.toFixed(1) ?? '—'}</td>
                <td style="padding:6px 4px;text-align:center;color:var(--color-text-secondary)">${p.blk?.toFixed(1) ?? '—'}</td>
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
          document.getElementById('${uid}_btnA').style.background='var(--color-bg)';document.getElementById('${uid}_btnA').style.color='var(--color-text-secondary)';
        " style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:rgba(99,102,241,0.2);color:var(--color-signal)">${homeAbv}</button>
        <button id="${uid}_btnA" onclick="
          document.getElementById('${uid}_A').style.display='block';
          document.getElementById('${uid}_H').style.display='none';
          this.style.background='rgba(99,102,241,0.2)';this.style.color='var(--color-signal)';
          document.getElementById('${uid}_btnH').style.background='var(--color-bg)';document.getElementById('${uid}_btnH').style.color='var(--color-text-secondary)';
        " style="padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:var(--color-bg);color:var(--color-text-secondary)">${awayAbv}</button>
      </div>
      <div id="${uid}_H" style="display:block;overflow-x:auto">${renderTable(teamDetail?.home?.top10scorers, homeAbsentMap)}</div>
      <div id="${uid}_A" style="display:none;overflow-x:auto">${renderTable(teamDetail?.away?.top10scorers, awayAbsentMap)}</div>
    </div>`;
}

// ── SECTION 4 : 10 DERNIERS MATCHS ───────────────────────────────────────────

function _renderTDLast10(match, teamDetail) {
  const homeAbv  = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv  = match?.away_team?.abbreviation ?? 'EXT';
  const homeName = match?.home_team?.name ?? homeAbv;
  const awayName = match?.away_team?.name ?? awayAbv;

  const renderTimeline = (games, teamAbv, teamName, boxScores) => {
    if (!games?.length) return `<div style="font-size:11px;color:var(--color-text-secondary)">Données indisponibles</div>`;
    return games.map(g => {
      const dateStr     = _fmtDateFR(g.date);
      const locIcon     = g.homeAway === 'home' ? '🏠' : '✈️';
      const won         = g.result === 'W';
      const color       = won ? '#22c55e' : '#ef4444';
      const hasBoxscore = (boxScores ?? []).some(b => b.gameID === g.gameID);
      // Score avec deux équipes nommées
      const scoreStr = (g.teamPts != null && g.oppPts != null)
        ? (g.homeAway === 'home'
            ? `${teamAbv} <strong>${g.teamPts}</strong> – <strong>${g.oppPts}</strong> ${g.opponent}`
            : `${g.opponent} <strong>${g.oppPts}</strong> – <strong>${g.teamPts}</strong> ${teamAbv}`)
        : '—';

      return `
        <div class="game-row${hasBoxscore ? ' game-row--clickable' : ''}"
          style="display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:6px;background:var(--color-bg);margin-bottom:4px;border-left:3px solid ${color};${hasBoxscore ? 'cursor:pointer' : ''}"
          ${hasBoxscore ? `data-game-id="${g.gameID}" data-team-abv="${teamAbv}" data-team-name="${_escapeAttr(teamName)}"` : ''}>
          <span style="font-size:9px;font-weight:700;color:${color};width:12px">${won ? 'V' : 'D'}</span>
          <span style="font-size:10px;color:var(--color-text-secondary);width:38px;flex-shrink:0">${dateStr}</span>
          <span style="font-size:10px">${locIcon}</span>
          <span style="font-size:11px;color:var(--color-text-secondary);margin-left:auto;font-variant-numeric:tabular-nums">${scoreStr}</span>
          ${hasBoxscore ? `<span style="font-size:9px;color:var(--color-signal);margin-left:4px">▸</span>` : ''}
        </div>`;
    }).join('');
  };

  return `
    <div class="card match-detail__bloc" id="last10-bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">📅 Forme récente</span>
        <span style="font-size:10px;color:var(--color-text-secondary)">▸ = boxscore disponible</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);margin-bottom:6px;text-transform:uppercase">${homeAbv}</div>
          ${renderTimeline(teamDetail?.home?.last10, homeAbv, homeName, teamDetail?.home?.boxScores)}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);margin-bottom:6px;text-transform:uppercase">${awayAbv}</div>
          ${renderTimeline(teamDetail?.away?.last10, awayAbv, awayName, teamDetail?.away?.boxScores)}
        </div>
      </div>
    </div>`;
}

// ── SECTION 5 : H2H + O/U ────────────────────────────────────────────────────

function _renderTDH2H_OU(match, teamDetail) {
  const homeAbv = match?.home_team?.abbreviation ?? 'DOM';
  const awayAbv = match?.away_team?.abbreviation ?? 'EXT';
  const h2h     = teamDetail?.home?.h2h ?? [];
  const ouLine  = parseFloat(match?.odds?.over_under ?? match?.market_odds?.total_line ?? 0);

  const calcOU = (games) => {
    if (!ouLine || !games?.length) return null;
    const withTotal = games
      .map(g => {
        const t = g.total ?? (g.teamPts != null && g.oppPts != null ? g.teamPts + g.oppPts : null);
        return { ...g, total: t };
      })
      .filter(g => g.total !== null && g.total !== undefined);
    if (!withTotal.length) return null;
    const over  = withTotal.filter(g => g.total > ouLine).length;
    const under = withTotal.filter(g => g.total < ouLine).length;
    const avg   = (withTotal.reduce((s, g) => s + g.total, 0) / withTotal.length).toFixed(1);
    return { over, under, total: withTotal.length, avg };
  };

  const ouBar = (ou, label) => {
    if (!ou) return `<div style="font-size:11px;color:var(--color-text-secondary)">${label} : ligne O/U indisponible</div>`;
    const overPct  = Math.round((ou.over  / ou.total) * 100);
    const underPct = Math.round((ou.under / ou.total) * 100);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:10px;font-weight:700;color:var(--color-text-secondary)">${label}</span>
          <span style="font-size:10px;color:var(--color-text-secondary)">${ou.total} matchs · moy. ${ou.avg} pts</span>
        </div>
        <div style="height:8px;border-radius:4px;overflow:hidden;background:var(--color-border)">
          <div style="width:${overPct}%;height:100%;background:#22c55e;float:left"></div>
          <div style="width:${underPct}%;height:100%;background:#ef4444;float:left;margin-left:1px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:3px;clear:both">
          <span style="color:#22c55e;font-weight:600">Over ${ou.over}/${ou.total} (${overPct}%)</span>
          <span style="color:#ef4444;font-weight:600">Under ${ou.under}/${ou.total} (${underPct}%)</span>
        </div>
      </div>`;
  };

  const h2hHtml = h2h.length
    ? h2h.slice(0, 5).map(g => {
        const dateStr = _fmtDateFR(g.date);
        const won     = g.result === 'W';
        const color   = won ? '#22c55e' : '#ef4444';
        const venue   = g.homeAway === 'home' ? '🏠' : '✈️';
        const teamPts = g.teamPts ?? '—';
        const oppPts  = g.oppPts  ?? '—';
        const ecart   = (typeof teamPts === 'number' && typeof oppPts === 'number')
          ? (won ? `+${teamPts - oppPts}` : `${teamPts - oppPts}`) : '';

        return `
          <div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;padding:6px 8px;border-radius:6px;background:var(--color-bg);margin-bottom:4px;border-left:3px solid ${color}">
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:9px;font-weight:700;color:${color};width:12px">${won ? 'V' : 'D'}</span>
              <span style="font-size:10px;color:var(--color-text-secondary)">${dateStr}</span>
              <span style="font-size:10px">${venue}</span>
            </div>
            <div style="font-size:11px;font-weight:600;text-align:center">
              <span style="color:${won ? 'var(--color-success)' : 'var(--color-muted)'}">${homeAbv}</span>
              <span style="color:var(--color-text-secondary);margin:0 4px">·</span>
              <span style="font-weight:700">${teamPts} – ${oppPts}</span>
              <span style="color:var(--color-text-secondary);margin:0 4px">·</span>
              <span style="color:${won ? 'var(--color-muted)' : 'var(--color-danger)'}">${g.opponent ?? awayAbv}</span>
            </div>
            <div style="font-size:9px;color:${color};font-weight:700;text-align:right;min-width:28px">${ecart}</div>
          </div>`;
      }).join('')
    : `<div style="font-size:11px;color:var(--color-text-secondary)">Pas de confrontation cette saison</div>`;

  const h2hWins  = h2h.filter(g => g.result === 'W').length;
  const h2hTotal = Math.min(h2h.length, 5);
  const h2hBilan = h2hTotal > 0
    ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">${homeAbv} : <strong style="color:var(--color-text)">${h2hWins}V / ${h2hTotal - h2hWins}D</strong> cette saison</div>`
    : '';

  // Score série playoff (si match en playoffs)
  const series = match?.playoff_series;
  const seriesHtml = (series && (series.home_wins != null || series.away_wins != null)) ? (() => {
    const hW = series.home_wins ?? 0;
    const aW = series.away_wins ?? 0;
    const leader = hW > aW ? homeAbv : aW > hW ? awayAbv : null;
    const bigScore = Math.max(hW, aW);
    const smallScore = Math.min(hW, aW);
    const leaderTxt = leader
      ? `<strong style="color:var(--color-signal)">${leader} mène ${bigScore}-${smallScore}</strong>`
      : `<strong>Série à égalité ${hW}-${aW}</strong>`;
    const summary = series.summary ?? series.title ?? '';
    return `
      <div style="padding:8px 10px;border-radius:8px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.25);margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;color:#a855f7;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px">🏆 Série playoff</div>
        <div style="font-size:13px">${leaderTxt}</div>
        ${summary ? `<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">${summary}</div>` : ''}
      </div>`;
  })() : '';

  return `
    <div class="card match-detail__bloc">
      ${seriesHtml}
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

// ── BOXSCORE MODAL ────────────────────────────────────────────────────────────

function _escapeAttr(str) {
  return String(str ?? '').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

export function bindLast10Clicks(container, teamDetail) {
  const bloc = container.querySelector('#last10-bloc');
  if (!bloc) return;

  bloc.addEventListener('click', (e) => {
    const row = e.target.closest('.game-row--clickable');
    if (!row) return;
    const gameID   = row.dataset.gameId;
    const teamAbv  = row.dataset.teamAbv;
    const teamName = row.dataset.teamName;
    if (!gameID || !teamAbv) return;

    const boxScores = [
      ...(teamDetail?.home?.boxScores ?? []),
      ...(teamDetail?.away?.boxScores ?? []),
    ];
    const box  = boxScores.find(b => b.gameID === gameID);
    if (!box) return;
    const game = [...(teamDetail?.home?.last10 ?? []), ...(teamDetail?.away?.last10 ?? [])]
      .find(g => g.gameID === gameID);

    _openGameModal(gameID, teamAbv, teamName, box, game);
  });
}

function _openGameModal(gameID, teamAbv, teamName, box, game) {
  const allPlayers = Object.values(box?.playerStats ?? {});
  const teamPlayers = allPlayers
    .filter(p => String(p?.teamAbv ?? '').toUpperCase() === teamAbv.toUpperCase())
    .map(p => ({
      name: p.longName ?? p.name ?? '—',
      min:  p.mins ?? p.min ?? '—',
      pts:  parseInt(p.pts ?? 0) || 0,
      reb:  parseInt(p.reb ?? p.treb ?? 0) || 0,
      ast:  parseInt(p.ast ?? 0) || 0,
      stl:  parseInt(p.stl ?? 0) || 0,
      blk:  parseInt(p.blk ?? 0) || 0,
      tov:  parseInt(p.TOV ?? p.tov ?? 0) || 0,
      fgm:  parseInt(p.fgm ?? 0) || 0,
      fga:  parseInt(p.fga ?? 0) || 0,
      tpm:  parseInt(p.tpm ?? p['3pm'] ?? 0) || 0,
    }))
    .filter(p => (p.min && p.min !== '0' && p.min !== '—') || p.pts > 0)
    .sort((a, b) => b.pts - a.pts);

  const dateStr  = game?.date ? _fmtDateFR(game.date) : '';
  const won      = game?.result === 'W';
  const score    = game ? `${game.teamPts ?? '—'} – ${game.oppPts ?? '—'}` : '—';
  const venue    = game?.homeAway === 'home' ? '🏠 Domicile' : '✈️ Extérieur';
  const resColor = won ? '#22c55e' : '#ef4444';

  const rows = teamPlayers.map(p => {
    const fgStr = p.fga > 0 ? `${p.fgm}/${p.fga}` : '—';
    const isTop = p.pts >= 20;
    return `
      <tr style="border-bottom:1px solid var(--color-border)${isTop ? ';background:rgba(34,197,94,0.04)' : ''}">
        <td style="padding:5px 6px;font-size:11px;font-weight:${isTop ? '700' : '400'};white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis">${_escapeHtml(p.name)}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${p.min}</td>
        <td style="padding:5px 4px;text-align:center;font-size:12px;font-weight:${isTop ? '700' : '600'};color:${isTop ? '#22c55e' : 'var(--color-text)'}">${p.pts}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px">${p.reb}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px">${p.ast}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${p.stl}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${p.blk}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${p.tov}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${fgStr}</td>
        <td style="padding:5px 4px;text-align:center;font-size:11px;color:var(--color-text-secondary)">${p.tpm > 0 ? p.tpm : '—'}</td>
      </tr>`;
  }).join('');

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;padding:0';
  modal.innerHTML = `
    <div style="background:var(--color-card);border-radius:16px 16px 0 0;width:100%;max-width:600px;max-height:85vh;overflow-y:auto;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:14px;font-weight:700">${_escapeHtml(teamName)} · ${_escapeHtml(dateStr)}</div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <span style="font-size:12px;font-weight:700;color:${resColor}">${won ? '✓ Victoire' : '✗ Défaite'}</span>
            <span style="font-size:12px;color:var(--color-text-secondary)">${_escapeHtml(score)}</span>
            <span style="font-size:11px;color:var(--color-text-secondary)">${venue}</span>
          </div>
        </div>
        <button id="close-game-modal" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--color-text-secondary);padding:0 4px">✕</button>
      </div>
      ${teamPlayers.length ? `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead>
              <tr style="border-bottom:2px solid var(--color-border)">
                <th style="padding:4px 6px;text-align:left;color:var(--color-text-secondary);font-size:10px">Joueur</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">MIN</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">PTS</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">REB</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">AST</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">STL</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">BLK</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">TOV</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">TIR</th>
                <th style="padding:4px 4px;text-align:center;color:var(--color-text-secondary);font-size:10px">3PT</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="font-size:10px;color:var(--color-text-secondary);margin-top:8px">Source : Tank01 · 5 derniers matchs uniquement</div>
      ` : `<div style="font-size:12px;color:var(--color-text-secondary);padding:16px 0">Boxscore non disponible.</div>`}
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#close-game-modal')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── MODAL ÉQUIPE (clic sur nom d'équipe) ──────────────────────────────────────

function _bindTeamNameClicks(container, match, teamDetail, injReport) {
  container.querySelectorAll('.team-name-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side     = btn.dataset.teamSide;
      const isHome   = side === 'home';
      const teamAbv  = isHome ? (match?.home_team?.abbreviation ?? '') : (match?.away_team?.abbreviation ?? '');
      const teamName = isHome ? (match?.home_team?.name ?? teamAbv) : (match?.away_team?.name ?? teamAbv);
      const record   = isHome ? (match?.home_team?.record ?? '') : (match?.away_team?.record ?? '');
      const stats    = isHome ? (match?.home_season_stats ?? {}) : (match?.away_season_stats ?? {});
      const detail   = isHome ? (teamDetail?.home ?? {}) : (teamDetail?.away ?? {});
      const top10    = isHome ? (teamDetail?.home?.top10scorers ?? []) : (teamDetail?.away?.top10scorers ?? []);
      const last10   = isHome ? (teamDetail?.home?.last10 ?? []) : (teamDetail?.away?.last10 ?? []);
      const injList  = isHome
        ? (injReport?.by_team?.[match?.home_team?.name ?? ''] ?? [])
        : (injReport?.by_team?.[match?.away_team?.name ?? ''] ?? []);

      _openTeamModal(teamAbv, teamName, record, stats, detail, top10, last10, injList);
    });
  });
}

function _openTeamModal(teamAbv, teamName, record, stats, detail, top10, last10, injList) {
  const winPct   = stats.win_pct != null ? Math.round(stats.win_pct * 100) + '%' : '—';
  const avgPts   = stats.avg_pts?.toFixed(1) ?? '—';
  const netRating = stats.net_rating != null ? (stats.net_rating > 0 ? '+' : '') + stats.net_rating.toFixed(1) : '—';
  const efg      = stats.efg_pct != null ? (stats.efg_pct * 100).toFixed(1) + '%' : '—';
  const avgTotal = detail.avgTotal?.toFixed(1) ?? '—';
  const encaisse = detail.avgTotal != null && stats.avg_pts != null
    ? (detail.avgTotal - stats.avg_pts).toFixed(1) : '—';

  // Forme récente — 10 pastilles V/D
  const formeHtml = last10.slice(0, 10).map(g => {
    const won   = g.result === 'W';
    const color = won ? '#22c55e' : '#ef4444';
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:${color}${won ? '20' : '18'};border:1px solid ${color}50;font-size:10px;font-weight:700;color:${color}">${won ? 'V' : 'D'}</span>`;
  }).join('');

  // Top 5 scoreurs
  const top5Html = top10.slice(0, 5).map(p => {
    const inj = injList.find(i => i.name?.toLowerCase() === p.name?.toLowerCase());
    const injBadge = inj
      ? `<span style="font-size:9px;color:#ef4444;font-weight:700;margin-left:4px">${inj.status === 'Out' ? 'OUT' : 'DTD'}</span>`
      : '';
    const ppgVal = p.ppg ?? p.pts ?? null;
    const l5Val  = p.last5_ppg ?? null;
    const l5Str  = l5Val != null ? ` <span style="font-size:10px;color:var(--color-text-secondary)">(L5: ${l5Val.toFixed(1)})</span>` : '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
        <span style="font-size:12px">${(ppgVal ?? 0) >= 20 ? '⭐ ' : ''}${p.name}${injBadge}</span>
        <span style="font-size:12px;font-weight:700;color:var(--color-signal)">${ppgVal != null ? ppgVal.toFixed(1) : '—'} pts${l5Str}</span>
      </div>`;
  }).join('');

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--color-card);border-radius:20px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.35);display:flex;flex-direction:column">

      <!-- Header -->
      <div style="padding:20px 20px 16px;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-card);border-radius:20px 20px 0 0;z-index:1">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:48px;height:48px;border-radius:12px;background:var(--color-bg);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;font-family:var(--font-mono);color:var(--color-signal);flex-shrink:0">${teamAbv}</div>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--color-text);line-height:1.2">${teamName}</div>
              <div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">${record} · <span style="color:var(--color-signal);font-weight:600">${winPct} win</span></div>
            </div>
          </div>
          <button id="close-team-modal" style="background:var(--color-bg);border:none;width:30px;height:30px;border-radius:50%;cursor:pointer;color:var(--color-text-secondary);font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
        </div>
      </div>

      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:16px">

        <!-- Stats saison -->
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--color-text-secondary);text-transform:uppercase;margin-bottom:10px">Saison régulière 2025-26</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            ${_statPill('Pts marqués', avgPts)}
            ${_statPill('Pts encaissés', encaisse)}
            ${_statPill('Net Rating', netRating)}
            ${_statPill('eFG%', efg)}
            ${_statPill('Moy. total', avgTotal)}
            ${_statPill('Win %', winPct)}
          </div>
        </div>

        <!-- Scoring récent -->
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--color-text-secondary);text-transform:uppercase;margin-bottom:10px">Scoring récent</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:var(--color-bg);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;color:var(--color-text-secondary)">Moy. 5 dern.</span>
              <span style="font-size:14px;font-weight:700;color:var(--color-text)">${detail.last5ScoringAvg != null ? detail.last5ScoringAvg.toFixed(1) : '—'}</span>
            </div>
            <div style="background:var(--color-bg);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;color:var(--color-text-secondary)">Repos</span>
              <span style="font-size:14px;font-weight:700;color:var(--color-text)">${detail.restDays != null ? detail.restDays + 'j' : '—'}</span>
            </div>
            <div style="background:var(--color-bg);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;color:var(--color-text-secondary)">V / 3 dern.</span>
              <span style="font-size:14px;font-weight:700;color:${(detail.momentum?.last3W ?? 0) >= 2 ? '#22c55e' : (detail.momentum?.last3W ?? 0) === 0 ? '#ef4444' : 'var(--color-text)'}">${detail.momentum?.last3W != null ? detail.momentum.last3W + '/3' : '—'}</span>
            </div>
            <div style="background:var(--color-bg);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;color:var(--color-text-secondary)">V / 10 dern.</span>
              <span style="font-size:14px;font-weight:700;color:${(detail.momentum?.last10W ?? 0) >= 7 ? '#22c55e' : (detail.momentum?.last10W ?? 0) <= 3 ? '#ef4444' : 'var(--color-text)'}">${detail.momentum?.last10W != null ? detail.momentum.last10W + '/10' : '—'}</span>
            </div>
          </div>
        </div>

        <!-- Forme récente -->
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--color-text-secondary);text-transform:uppercase;margin-bottom:10px">Forme (10 derniers)</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${formeHtml || '<span style="font-size:11px;color:var(--color-text-secondary)">Données indisponibles</span>'}
          </div>
        </div>

        <!-- Top scoreurs -->
        <div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--color-text-secondary);text-transform:uppercase;margin-bottom:10px">Top scoreurs</div>
          <div style="display:flex;flex-direction:column;gap:2px">
            ${top5Html || '<div style="font-size:11px;color:var(--color-text-secondary)">Données indisponibles</div>'}
          </div>
        </div>

        <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;padding-top:4px;border-top:1px solid var(--color-border)">Tank01 · ESPN · saison en cours</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#close-team-modal')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _statPill(label, value) {
  return `
    <div style="text-align:center;padding:10px 6px;background:var(--color-bg);border-radius:10px">
      <div style="font-size:17px;font-weight:700;color:var(--color-text);line-height:1">${value}</div>
      <div style="font-size:9px;font-weight:500;color:var(--color-text-secondary);margin-top:4px;line-height:1.2">${label}</div>
    </div>`;
}
