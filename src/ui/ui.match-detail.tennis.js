/**
 * MANI BET PRO — ui.match-detail.tennis.js v1.0
 *
 * Bloc détail match tennis (équivalent ui.match-detail.teamdetail.js pour NBA).
 * Lit `tennisStats[matchId]` depuis le store (pré-chargé par data.orchestrator).
 *
 * 6 sections :
 *   1. 🎾 Elo & classement       — Elo overall/surface, rank ATP/WTA, proba dérivée
 *   2. 🎯 Surface                 — win rate 12 mois sur surface courante
 *   3. 🔥 Forme récente           — EMA 10 derniers matchs
 *   4. ⚔️ H2H                     — bilan face-à-face sur la surface
 *   5. 💥 Service                 — aces/match, double fautes, 1st serve won %
 *   6. ⏱️ Contexte                — fatigue, fraîcheur data, tournoi
 */

import { Logger } from '../utils/utils.logger.js';
import { escapeHtml as _escapeHtml, WORKER_URL } from './ui.match-detail.helpers.js';

export async function loadAndRenderTennisDetail(container, match, storeInstance) {
  const detailEl = container.querySelector('#tennis-detail-container');
  if (!detailEl) return;

  try {
    const tennisStats = storeInstance?.get('tennisStats') ?? {};
    let data = tennisStats[match.id] ?? null;

    // Fallback : fetch direct si pas dans le store (deep-link ou orchestrator pas encore tourné)
    if (!data) {
      data = await _fetchTennisStatsForMatch(match);
      if (data && storeInstance) {
        const updated = { ...(storeInstance.get('tennisStats') ?? {}), [match.id]: data };
        try { storeInstance.set({ tennisStats: updated }); } catch (_) {}
      }
    }

    const hasP1Data = data?.p1 && Object.keys(data.p1).some(k => k !== 'name' && data.p1[k] != null);
    const hasP2Data = data?.p2 && Object.keys(data.p2).some(k => k !== 'name' && data.p2[k] != null);

    if (!data || (!hasP1Data && !hasP2Data)) {
      const p1n = match?.home_team?.name ?? '?';
      const p2n = match?.away_team?.name ?? '?';
      const r = data?.resolved ?? null;
      const diag1 = r ? (r[p1n] ? `✅ trouvé comme "${r[p1n]}"` : '❌ non trouvé dans CSV Sackmann') : '';
      const diag2 = r ? (r[p2n] ? `✅ trouvé comme "${r[p2n]}"` : '❌ non trouvé dans CSV Sackmann') : '';
      const diagHtml = r
        ? `<div style="font-size:11px;color:var(--color-text);margin-top:10px;text-align:left;padding:8px 10px;background:var(--color-bg);border-radius:6px;line-height:1.6">
             <div><strong>${_escapeHtml(p1n)}</strong> : ${diag1}</div>
             <div><strong>${_escapeHtml(p2n)}</strong> : ${diag2}</div>
           </div>`
        : '';
      detailEl.innerHTML = `
        <div class="card match-detail__bloc" style="padding:22px 16px">
          <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.7;text-align:center">
            Stats indisponibles pour ${_escapeHtml(p1n)} vs ${_escapeHtml(p2n)}.
            <br><span style="font-size:11px;color:var(--color-muted)">Source : Jeff Sackmann CSV (lag ~2-3 j). Challengers / juniors absents du tour principal.</span>
          </div>
          ${diagHtml}
        </div>`;
      return;
    }

    detailEl.innerHTML = renderBlocTennisDetail(match, data);
  } catch (err) {
    Logger.warn('TENNIS_DETAIL_RENDER_FAILED', { message: err.message });
    detailEl.innerHTML = `
      <div class="card match-detail__bloc">
        <div style="font-size:12px;color:var(--color-text-secondary);padding:8px 0">
          Stats tennis temporairement indisponibles (${_escapeHtml(err.message ?? 'erreur')}).
        </div>
      </div>`;
  }
}

// Fetch direct /tennis/stats — fallback quand l'orchestrator n'a pas pré-chargé.
// Sur un deep-link vers la fiche match, on n'a pas tournée _loadAndAnalyzeTennis.
// Si première réponse vide (cache obsolète possible), retente avec bust=1.
async function _fetchTennisStatsForMatch(match) {
  const p1 = match?.home_team?.name;
  const p2 = match?.away_team?.name;
  const surface = match?.surface ?? 'Hard';
  const tour    = String(match?.tour ?? 'atp').toLowerCase();
  if (!p1 || !p2) return null;

  const fetchOnce = async (bust = false) => {
    const base = `${WORKER_URL}/tennis/stats?players=${encodeURIComponent(p1)},${encodeURIComponent(p2)}&surface=${encodeURIComponent(surface)}&tour=${tour}`;
    const url  = bust ? `${base}&bust=1` : base;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.available || !json.stats) return null;
    const s1 = json.stats[p1], s2 = json.stats[p2];
    const has = (s) => s && Object.keys(s).length > 1; // plus que juste {name}
    return { json, hasAnyStats: has(s1) || has(s2) };
  };

  try {
    let result = await fetchOnce(false);
    if (result && !result.hasAnyStats) {
      // Cache possiblement obsolète (écrit avant fix normalisation noms) → retente bust
      result = await fetchOnce(true) ?? result;
    }
    if (!result?.json) return null;
    const { json } = result;
    return {
      p1:                { name: p1, ...(json.stats[p1] ?? {}) },
      p2:                { name: p2, ...(json.stats[p2] ?? {}) },
      surface,
      tour,
      tournament_label:  match?.tournament ?? null,
      fetched_at:        json.fetched_at ?? null,
      resolved:          json.resolved ?? null,
    };
  } catch (err) {
    Logger.warn('TENNIS_STATS_FETCH_FAILED', { message: err.message });
    return null;
  }
}

export function renderBlocTennisDetailSkeleton() {
  return `
    <div class="card match-detail__bloc" id="tennis-detail-skeleton" style="padding:20px;text-align:center">
      <div style="font-size:12px;color:var(--color-text-secondary)">Chargement des stats tennis…</div>
    </div>`;
}

export function renderBlocTennisDetail(match, data) {
  return [
    _renderEloRanking(match, data),
    _renderSurface(match, data),
    _renderRecentForm(match, data),
    _renderH2H(match, data),
    _renderService(match, data),
    _renderContext(match, data),
  ].join('');
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
function _num(x, d = 1) { return x == null || !Number.isFinite(x) ? '—' : Number(x).toFixed(d); }
function _int(x) { return x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)); }

// Convertit diff Elo en proba attendue P1 (formule Elo standard)
function _eloExpected(e1, e2) {
  if (e1 == null || e2 == null) return null;
  return 1 / (1 + Math.pow(10, (e2 - e1) / 400));
}

function _qualityBadge(quality) {
  if (!quality) return '';
  const map = {
    VERIFIED:     { color: '#22c55e', label: 'fiable' },
    PARTIAL:      { color: '#eab308', label: 'partiel' },
    LOW_SAMPLE:   { color: '#f97316', label: 'éch. faible' },
    MISSING:      { color: '#ef4444', label: 'manquant' },
  };
  const q = map[quality] ?? { color: 'var(--color-muted)', label: quality.toLowerCase() };
  return `<span style="font-size:9px;font-weight:700;color:${q.color};border:1px solid ${q.color};border-radius:3px;padding:1px 5px;letter-spacing:0.04em">${q.label}</span>`;
}

function _statRow(label, v1, v2, opts = {}) {
  const { better = null, fmt = (v) => v ?? '—', raw1 = v1, raw2 = v2 } = opts;
  const n1 = parseFloat(raw1);
  const n2 = parseFloat(raw2);
  const valid = Number.isFinite(n1) && Number.isFinite(n2);
  const avg   = valid ? (Math.abs(n1) + Math.abs(n2)) / 2 : 0;
  const ecart = avg > 0 ? Math.abs(n1 - n2) / avg : 0;
  const tooClose = ecart < 0.03;
  const p1Better = valid && !tooClose && (better === 'high' ? n1 > n2 : better === 'low' ? n1 < n2 : false);
  const p2Better = valid && !tooClose && (better === 'high' ? n2 > n1 : better === 'low' ? n2 < n1 : false);
  const c1 = p1Better ? 'var(--color-signal)' : 'var(--color-text)';
  const c2 = p2Better ? 'var(--color-signal)' : 'var(--color-text)';

  return `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
      <div style="font-size:12px;font-weight:${p1Better ? '700' : '400'};color:${c1}">${fmt(v1)}</div>
      <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;white-space:nowrap">${label}</div>
      <div style="font-size:12px;font-weight:${p2Better ? '700' : '400'};color:${c2};text-align:right">${fmt(v2)}</div>
    </div>`;
}

// ── SECTION 1 : ELO & RANKING ─────────────────────────────────────────────

function _renderEloRanking(match, data) {
  const p1Name = match?.home_team?.name ?? data.p1?.name ?? 'Joueur 1';
  const p2Name = match?.away_team?.name ?? data.p2?.name ?? 'Joueur 2';
  const surface = data.surface ?? 'Hard';

  const eSurf1 = data.p1?.elo_surface;
  const eSurf2 = data.p2?.elo_surface;
  const nSurf1 = data.p1?.elo_surface_matches ?? 0;
  const nSurf2 = data.p2?.elo_surface_matches ?? 0;

  const eAll1 = data.p1?.elo_overall;
  const eAll2 = data.p2?.elo_overall;

  const rank1 = data.p1?.current_rank;
  const rank2 = data.p2?.current_rank;

  // Proba surface (si assez de matchs), sinon overall
  const useSurf = eSurf1 != null && eSurf2 != null && nSurf1 >= 10 && nSurf2 >= 10;
  const expectedP1 = useSurf ? _eloExpected(eSurf1, eSurf2) : _eloExpected(eAll1, eAll2);
  const quality   = useSurf ? 'VERIFIED' : (eAll1 != null && eAll2 != null ? 'PARTIAL' : 'MISSING');
  const eloLabel  = useSurf ? `Elo ${surface}` : 'Elo overall';

  const diffDisplay = expectedP1 != null
    ? `<div style="font-size:20px;font-weight:800;color:var(--color-signal)">${Math.round(expectedP1 * 100)}% — ${Math.round((1 - expectedP1) * 100)}%</div>
       <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">proba victoire dérivée ${eloLabel}</div>`
    : `<div style="font-size:12px;color:var(--color-muted)">proba non dérivable (data insuffisante)</div>`;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🎾 Elo &amp; classement</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="text-align:center;padding:8px 0;border-bottom:1px solid var(--color-border);margin-bottom:10px">
        ${diffDisplay}
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:6px">
        <div style="font-size:12px;font-weight:700;color:var(--color-text)">${_escapeHtml(p1Name)}</div>
        <div style="font-size:9px;color:var(--color-text-secondary);text-align:center">—</div>
        <div style="font-size:12px;font-weight:700;color:var(--color-text);text-align:right">${_escapeHtml(p2Name)}</div>
      </div>
      ${_statRow('Rang ATP/WTA',
        rank1 != null ? `#${rank1}` : '—',
        rank2 != null ? `#${rank2}` : '—',
        { better: 'low', raw1: rank1, raw2: rank2 })}
      ${_statRow(`Elo ${surface}`,
        eSurf1 != null ? _int(eSurf1) : '—',
        eSurf2 != null ? _int(eSurf2) : '—',
        { better: 'high', raw1: eSurf1, raw2: eSurf2 })}
      ${_statRow(`matchs ${surface}`,
        _int(nSurf1), _int(nSurf2),
        { better: 'high', raw1: nSurf1, raw2: nSurf2 })}
      ${_statRow('Elo overall',
        eAll1 != null ? _int(eAll1) : '—',
        eAll2 != null ? _int(eAll2) : '—',
        { better: 'high', raw1: eAll1, raw2: eAll2 })}
    </div>`;
}

// ── SECTION 2 : SURFACE ───────────────────────────────────────────────────

function _renderSurface(match, data) {
  const surface = data.surface ?? 'Hard';
  const s1 = data.p1?.surface_stats?.[surface];
  const s2 = data.p2?.surface_stats?.[surface];
  const wr1 = s1?.win_rate;
  const wr2 = s2?.win_rate;
  const n1  = s1?.matches ?? 0;
  const n2  = s2?.matches ?? 0;

  const MIN_SAMPLE = 8;
  const quality = (n1 >= MIN_SAMPLE && n2 >= MIN_SAMPLE) ? 'VERIFIED'
                : (n1 >= 4 && n2 >= 4) ? 'PARTIAL' : 'LOW_SAMPLE';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🎯 Surface · ${_escapeHtml(surface)}</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">Win rate 12 derniers mois sur ${_escapeHtml(surface)}</div>
      ${_statRow('Win rate',
        _pct(wr1), _pct(wr2),
        { better: 'high', raw1: wr1, raw2: wr2 })}
      ${_statRow('Matchs (12m)',
        _int(n1), _int(n2),
        { raw1: n1, raw2: n2 })}
    </div>`;
}

// ── SECTION 3 : FORME RÉCENTE ─────────────────────────────────────────────

function _renderRecentForm(match, data) {
  const ema1 = data.p1?.recent_form_ema;
  const ema2 = data.p2?.recent_form_ema;
  const lag1 = data.p1?.csv_lag_days ?? 999;
  const lag2 = data.p2?.csv_lag_days ?? 999;
  const quality = (lag1 > 3 || lag2 > 3) ? 'PARTIAL'
                : (ema1 == null || ema2 == null) ? 'MISSING' : 'VERIFIED';

  // EMA ∈ [0,1] → interprétation humaine
  const _formLabel = (e) => {
    if (e == null) return '—';
    if (e >= 0.70) return `🔥 en feu`;
    if (e >= 0.55) return `📈 positive`;
    if (e >= 0.45) return `→ neutre`;
    if (e >= 0.30) return `📉 fragile`;
    return `❄️ en crise`;
  };

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🔥 Forme récente</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">EMA 10 derniers matchs · 1.00 = 10/10 victoires</div>
      ${_statRow('EMA forme',
        ema1 != null ? ema1.toFixed(2) : '—',
        ema2 != null ? ema2.toFixed(2) : '—',
        { better: 'high', raw1: ema1, raw2: ema2 })}
      ${_statRow('Tendance',
        _formLabel(ema1), _formLabel(ema2))}
    </div>`;
}

// ── SECTION 4 : H2H ───────────────────────────────────────────────────────

function _renderH2H(match, data) {
  const p1Name = match?.home_team?.name ?? data.p1?.name;
  const p2Name = match?.away_team?.name ?? data.p2?.name;
  const surface = data.surface ?? 'Hard';

  // h2h stocké côté p1 : data.p1.h2h[p2Name] = { p1_wins, p2_wins }
  const h2h = data.p1?.h2h?.[p2Name] ?? null;
  const w1  = h2h?.p1_wins ?? 0;
  const w2  = h2h?.p2_wins ?? 0;
  const total = w1 + w2;

  const quality = total >= 3 ? 'VERIFIED' : total >= 1 ? 'LOW_SAMPLE' : 'MISSING';

  const summary = total === 0
    ? `<div style="font-size:12px;color:var(--color-muted);text-align:center;padding:10px 0">Aucune confrontation recensée sur ${_escapeHtml(surface)}.</div>`
    : `<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:8px 0">
         <div style="font-size:26px;font-weight:800;color:${w1 > w2 ? 'var(--color-signal)' : 'var(--color-text)'}">${w1}</div>
         <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;white-space:nowrap">${total} match${total > 1 ? 's' : ''}</div>
         <div style="font-size:26px;font-weight:800;color:${w2 > w1 ? 'var(--color-signal)' : 'var(--color-text)'};text-align:right">${w2}</div>
       </div>`;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">⚔️ H2H direct</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:4px">Confrontations sur ${_escapeHtml(surface)}</div>
      ${summary}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
        <div style="font-size:11px;text-align:left;color:var(--color-text-secondary)">${_escapeHtml(p1Name ?? '—')}</div>
        <div style="font-size:11px;text-align:right;color:var(--color-text-secondary)">${_escapeHtml(p2Name ?? '—')}</div>
      </div>
    </div>`;
}

// ── SECTION 5 : SERVICE ───────────────────────────────────────────────────

function _renderService(match, data) {
  const s1 = data.p1?.service_stats;
  const s2 = data.p2?.service_stats;

  if (!s1 && !s2) {
    return `
      <div class="card match-detail__bloc">
        <div class="bloc-header"><span class="bloc-header__title">💥 Service</span>${_qualityBadge('MISSING')}</div>
        <div style="font-size:12px;color:var(--color-muted);padding:8px 0">Stats service indisponibles.</div>
      </div>`;
  }

  // 1st serve won % = first_serve_won / svpt
  const firstWon = (s) => (s?.svpt > 0 && s?.first_serve_won != null) ? s.first_serve_won / s.svpt : null;
  const fw1 = firstWon(s1);
  const fw2 = firstWon(s2);

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">💥 Service</span>
        ${_qualityBadge('PARTIAL')}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">Moyennes 20 derniers matchs gagnés</div>
      ${_statRow('Aces / match',
        _num(s1?.aces), _num(s2?.aces),
        { better: 'high', raw1: s1?.aces, raw2: s2?.aces })}
      ${_statRow('Double fautes',
        _num(s1?.double_faults), _num(s2?.double_faults),
        { better: 'low', raw1: s1?.double_faults, raw2: s2?.double_faults })}
      ${_statRow('1er service gagné',
        _pct(fw1), _pct(fw2),
        { better: 'high', raw1: fw1, raw2: fw2 })}
      ${_statRow('Pts service / match',
        _num(s1?.svpt), _num(s2?.svpt),
        { better: 'high', raw1: s1?.svpt, raw2: s2?.svpt })}
    </div>`;
}

// ── SECTION 6 : CONTEXTE ──────────────────────────────────────────────────

function _renderContext(match, data) {
  const days1 = data.p1?.days_since_last_match;
  const days2 = data.p2?.days_since_last_match;
  const lag1  = data.p1?.csv_lag_days;
  const lag2  = data.p2?.csv_lag_days;
  const tot1  = data.p1?.total_matches;
  const tot2  = data.p2?.total_matches;

  const fatigueLabel = (d) => {
    if (d == null) return '—';
    if (d <= 1) return `🥵 ${d}j (fatigue)`;
    if (d <= 3) return `⚡ ${d}j`;
    if (d <= 7) return `✅ ${d}j`;
    if (d <= 14) return `💤 ${d}j`;
    return `😴 ${d}j (rouille)`;
  };

  const tournamentLine = data.tournament_label
    ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">
         🏆 ${_escapeHtml(data.tournament_label)} · ${_escapeHtml(data.surface ?? '')} · ${String(data.tour ?? '').toUpperCase()}
       </div>`
    : '';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">⏱️ Contexte &amp; fatigue</span>
      </div>
      ${tournamentLine}
      ${_statRow('Jours depuis dernier match',
        fatigueLabel(days1), fatigueLabel(days2),
        { raw1: days1, raw2: days2 })}
      ${_statRow('Matchs recensés (2 ans)',
        _int(tot1), _int(tot2),
        { better: 'high', raw1: tot1, raw2: tot2 })}
      ${_statRow('Fraîcheur data (j)',
        _int(lag1), _int(lag2),
        { better: 'low', raw1: lag1, raw2: lag2 })}
      <div style="margin-top:10px;padding:8px 10px;background:var(--color-bg);border-radius:8px;font-size:10px;color:var(--color-text-secondary);line-height:1.5">
        Source : Jeff Sackmann CSV (GitHub, lag ~2-3j). Matchs du tournoi en cours pas encore recensés.
      </div>
    </div>`;
}
