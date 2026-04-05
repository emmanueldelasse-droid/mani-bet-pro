/**
 * MANI BET PRO — ui.match-detail.js v3
 *
 * REFONTE v3 :
 *   Nouvel ordre logique :
 *     - Équipes + probas
 *     - Paris recommandés (priorité absolue)
 *     - Pourquoi ce pari (signaux simplifiés, max 3)
 *     - Fiabilité (un chiffre + couleur, sans tableau technique)
 *     - Sources (collapse par défaut)
 *
 *   Vocabulaire simplifié :
 *     - "Forme récente (EMA W/L)" → "Forme récente"
 *     - "Split Domicile/Extérieur" → "Avantage domicile"
 *     - "eFG% différentiel" → "Efficacité au tir"
 *     - "Stabilité de l'analyse 95%" → "Fiabilité : Élevée"
 *     - "△ À CONSIDÉRER" → "Pari intéressant"
 *
 *   Supprimé :
 *     - Tableau perturbation ±10% ±20%
 *     - Sources techniques (espn_scoreboard, balldontlie_v1)
 *     - "v0.3.0"
 *     - Pourcentages contribution signaux
 *     - Badges VERIFIED
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

// Mapping labels techniques → vocabulaire simple
const SIGNAL_LABELS = {
  'recent_form_ema':   'Forme récente',
  'home_away_split':   'Avantage domicile',
  'efg_diff':          'Efficacité au tir',
  'net_rating_diff':   'Niveau général (Net Rating)',
  'win_pct_diff':      'Bilan victoires/défaites',
  'absences_impact':   'Blessures',
  'ts_diff':           'Efficacité offensive',
  'avg_pts_diff':      'Points marqués',
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

  container.innerHTML = renderShell(match, analysis);
  bindEvents(container, storeInstance, match, analysis);
  _loadAndRenderMultiBookOdds(container, match, analysis);

  return { destroy() {} };
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell(match, analysis) {
  return `
    <div class="match-detail">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
        <button class="btn btn--ghost back-btn" id="back-btn">← Retour</button>
        <button class="btn btn--ghost" id="share-btn" style="font-size:12px">📤 Partager</button>
      </div>

      <!-- En-tête match -->
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

      <!-- ORDRE LOGIQUE v3 -->
      ${renderBlocProbas(analysis, match)}
      ${renderBlocParis(analysis, match)}
      ${renderBlocPourquoi(analysis, match)}
      ${renderBlocFiabilite(analysis)}
      ${renderBlocSources(analysis)}
      ${renderBlocIA(analysis, match)}

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
    </div>
  `;
}

// ── BLOC PROBAS ───────────────────────────────────────────────────────────

function renderBlocProbas(analysis, match) {
  if (!analysis || analysis.predictive_score === null) {
    return `
      <div class="card match-detail__bloc">
        <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">
          ${analysis?.rejection_reason ? formatRejection(analysis.rejection_reason) : 'Données insuffisantes pour une analyse.'}
        </div>
      </div>`;
  }

  const homeProb   = Math.round(analysis.predictive_score * 100);
  const awayProb   = 100 - homeProb;
  const homeName   = match?.home_team?.name ?? 'Domicile';
  const awayName   = match?.away_team?.name ?? 'Extérieur';
  const fairHome   = homeProb > 0 ? (100 / homeProb).toFixed(2) : '—';
  const fairAway   = awayProb > 0 ? (100 / awayProb).toFixed(2) : '—';

  // Décision simplifiée
  const best  = analysis.betting_recommendations?.best;
  const edge  = best?.edge ?? 0;
  const qual  = analysis.data_quality_score ?? 0;

  let decisionLabel, decisionColor;
  if (!best || edge < 5) {
    decisionLabel = 'Passer'; decisionColor = 'var(--color-muted)';
  } else if (edge >= 10 && qual >= 0.80) {
    decisionLabel = 'Parier'; decisionColor = 'var(--color-success)';
  } else if (edge >= 7) {
    decisionLabel = 'Pari intéressant'; decisionColor = 'var(--color-warning)';
  } else {
    decisionLabel = 'Passer'; decisionColor = 'var(--color-muted)';
  }

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

      <!-- Barre -->
      <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--color-border);margin-bottom:12px">
        <div style="height:100%;width:${homeProb}%;background:var(--color-signal);border-radius:3px"></div>
      </div>

      <!-- Verdict simple -->
      ${best && edge >= 5 ? `
        <div style="
          border-left:3px solid ${decisionColor};
          padding:8px 12px;
          border-radius:4px;
          background:var(--color-bg);
          font-size:12px;
        ">
          <span style="font-weight:700;color:${decisionColor}">${decisionLabel}</span>
          <span style="color:var(--color-muted);margin-left:8px">Avantage estimé +${edge}%</span>
        </div>
      ` : `
        <div style="font-size:12px;color:var(--color-muted)">Aucun avantage suffisant détecté sur ce match.</div>
      `}
    </div>
  `;
}

// ── BLOC PARIS ────────────────────────────────────────────────────────────

function renderBlocParis(analysis, match) {
  const betting = analysis?.betting_recommendations;
  const odds    = match?.odds;

  if (!odds) return `
    <div class="card match-detail__bloc" id="bloc-7">
      <div class="bloc-header">
        <span class="bloc-header__title">Paris recommandés</span>
      </div>
      <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">Cotes non disponibles.</div>
    </div>`;

  if (!betting?.recommendations?.length) return `
    <div class="card match-detail__bloc" id="bloc-7">
      <div class="bloc-header">
        <span class="bloc-header__title">Paris recommandés</span>
      </div>
      <div class="text-muted" style="font-size:13px;padding:var(--space-3) 0">Aucune opportunité détectée.</div>
    </div>`;

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

    // Label marché simplifié
    const marketLabel = r.type === 'MONEYLINE' ? 'Vainqueur du match'
                      : r.type === 'SPREAD'    ? 'Handicap'
                      : 'Total de points';

    // Côté lisible
    let sideDisplay = sideLabel;
    if (r.type === 'SPREAD') {
      sideDisplay = `${sideLabel} ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts`;
    } else if (r.type === 'OVER_UNDER') {
      sideDisplay = r.side === 'OVER'
        ? `Plus de ${r.ou_line ?? '—'} pts`
        : `Moins de ${r.ou_line ?? '—'} pts`;
    }

    // Explication simple
    const motorProb = r.side === 'HOME'
      ? Math.round(analysis.predictive_score * 100)
      : r.side === 'AWAY'
      ? Math.round((1 - analysis.predictive_score) * 100)
      : r.motor_prob;

    let whyText = '';
    if (r.type === 'MONEYLINE') {
      whyText = `Le moteur estime ${motorProb}% de chances pour ${sideLabel}. La cote ${oddsDecimal} chez ${r.odds_source ?? 'le bookmaker'} offre un avantage de +${r.edge}%.`;
    } else if (r.type === 'SPREAD') {
      whyText = `Le moteur pense que ${sideLabel} peut gagner avec ${r.spread_line > 0 ? '+' : ''}${r.spread_line} pts d'écart. La cote de ${oddsDecimal} sous-estime cette probabilité.`;
    } else if (r.type === 'OVER_UNDER') {
      whyText = r.side === 'OVER'
        ? `Le moteur projette un match à points élevés. La ligne de ${r.ou_line} pts semble trop basse.`
        : `Le moteur projette un match serré et défensif. La ligne de ${r.ou_line} pts semble trop haute.`;
    }

    return `
      <div style="
        background:var(--color-bg);
        border-radius:10px;
        padding:14px;
        margin-bottom:10px;
        border:1px solid ${isBest ? 'var(--color-success)' : 'var(--color-border)'};
      ">
        ${isBest ? '<div style="font-size:10px;color:var(--color-success);font-weight:700;margin-bottom:8px;letter-spacing:0.05em">★ MEILLEUR PARI</div>' : ''}

        <!-- Marché + côté -->
        <div style="margin-bottom:10px">
          <div style="font-size:10px;color:var(--color-muted);margin-bottom:2px">${marketLabel}</div>
          <div style="font-size:17px;font-weight:700">${sideDisplay}</div>
        </div>

        <!-- Cote + edge -->
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

        <!-- Pourquoi -->
        <div style="
          font-size:12px;
          color:var(--color-muted);
          line-height:1.6;
          padding:8px 10px;
          background:var(--color-card);
          border-radius:6px;
          margin-bottom:10px;
        ">${whyText}</div>

        <button class="btn btn--primary paper-bet-btn" style="width:100%;padding:10px;font-size:13px;font-weight:600"
          data-market="${r.type}"
          data-side="${r.side}"
          data-side-label="${sideDisplay}"
          data-odds="${r.odds_line}"
          data-edge="${r.edge}"
          data-motor-prob="${r.motor_prob}"
          data-implied-prob="${r.implied_prob}"
          data-kelly="${r.kelly_stake ?? 0}"
        >
          📋 Enregistrer ce pari
        </button>
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

function renderBlocPourquoi(analysis, match) {
  const signals = (analysis?.key_signals ?? []).slice(0, 3);
  const homeName = match?.home_team?.name ?? 'Domicile';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Pourquoi ce pari ?</span>
      </div>

      ${!signals.length ? `
        <div class="text-muted" style="font-size:12px">Aucun signal significatif.</div>
      ` : `
        <div style="display:grid;gap:10px">
          ${signals.map(s => {
            const label    = _simplifyLabel(s.label, s.variable);
            const isHome   = s.direction === 'POSITIVE';
            const teamName = isHome ? homeName : (match?.away_team?.name ?? 'Extérieur');
            const icon     = isHome ? '▲' : '▼';
            const color    = isHome ? 'var(--color-success)' : 'var(--color-danger)';

            return `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--color-bg);border-radius:8px">
                <span style="font-size:16px;color:${color};font-weight:700;width:16px">${icon}</span>
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600">${label}</div>
                  <div style="font-size:11px;color:var(--color-muted)">Avantage pour ${teamName}</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// ── BLOC FIABILITÉ ────────────────────────────────────────────────────────

function renderBlocFiabilite(analysis) {
  const rob  = analysis?.robustness_score;
  const qual = analysis?.data_quality_score;

  // Score global simplifié
  const score = rob !== null && qual !== null ? Math.round(((rob + qual) / 2) * 100) : null;

  let label, color;
  if (score === null)   { label = '—';       color = 'var(--color-muted)'; }
  else if (score >= 80) { label = 'Élevée';  color = 'var(--color-success)'; }
  else if (score >= 60) { label = 'Moyenne'; color = 'var(--color-warning)'; }
  else                  { label = 'Faible';  color = 'var(--color-danger)'; }

  // Variables critiques manquantes
  const missing = analysis?.missing_variables ?? [];
  const missingSimple = missing.map(v => SIGNAL_LABELS[v] ?? v).slice(0, 2);

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Fiabilité de l'analyse</span>
        ${score !== null ? `<span style="font-weight:700;color:${color}">${label}</span>` : ''}
      </div>

      ${score !== null ? `
        <!-- Barre fiabilité -->
        <div style="height:8px;border-radius:4px;overflow:hidden;background:var(--color-border);margin-bottom:8px">
          <div style="height:100%;width:${score}%;background:${color};border-radius:4px;transition:width 0.5s ease"></div>
        </div>
        <div style="font-size:12px;color:var(--color-muted);margin-bottom:${missingSimple.length ? '10px' : '0'}">
          ${score >= 80
            ? 'Données complètes et cohérentes. L\'analyse est fiable.'
            : score >= 60
            ? 'Quelques données manquantes. L\'analyse reste valable.'
            : 'Données insuffisantes. À prendre avec précaution.'}
        </div>

        ${missingSimple.length ? `
          <div style="font-size:11px;color:var(--color-warning);padding:6px 10px;background:rgba(255,165,0,0.08);border-radius:6px;border-left:2px solid var(--color-warning)">
            ⚠ Données manquantes : ${missingSimple.join(' · ')}
          </div>
        ` : ''}
      ` : `
        <div class="text-muted" style="font-size:12px">Non calculée.</div>
      `}
    </div>
  `;
}

// ── BLOC SOURCES (collapse) ───────────────────────────────────────────────

function renderBlocSources(analysis) {
  const breakdown = analysis?.data_quality_breakdown?.breakdown ?? {};
  const fields    = Object.entries(breakdown);

  const QUALITY_LABELS = {
    VERIFIED:            'Vérifié',
    PARTIAL:             'Partiel',
    ESTIMATED:           'Estimé',
    LOW_SAMPLE:          'Faible échantillon',
    UNCALIBRATED:        'Non calibré',
    INSUFFICIENT_SAMPLE: 'Insuffisant',
    MISSING:             'Absent',
  };

  const QUALITY_COLORS = {
    VERIFIED:            'var(--color-success)',
    PARTIAL:             'var(--color-warning)',
    ESTIMATED:           'var(--color-warning)',
    LOW_SAMPLE:          'var(--color-warning)',
    UNCALIBRATED:        'var(--color-muted)',
    INSUFFICIENT_SAMPLE: 'var(--color-danger)',
    MISSING:             'var(--color-danger)',
  };

  return `
    <div class="card match-detail__bloc">
      <div class="collapsible" id="sources-collapsible">
        <div class="collapsible__header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:2px 0">
          <span class="bloc-header__title">Sources des données</span>
          <span class="collapsible__arrow text-muted" style="font-size:12px">▾ Voir</span>
        </div>
        <div class="collapsible__body" style="display:none;margin-top:var(--space-3)">
          ${!fields.length ? `
            <div class="text-muted" style="font-size:12px">Non disponibles.</div>
          ` : `
            <div style="display:grid;gap:6px">
              ${fields.map(([varId, d]) => {
                const label = _simplifyLabel(d.label, varId);
                const q     = QUALITY_LABELS[d.quality] ?? d.quality;
                const color = QUALITY_COLORS[d.quality] ?? 'var(--color-muted)';
                return `
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
                    <span>${label}</span>
                    <span style="color:${color};font-size:11px">${q}</span>
                  </div>`;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ── BLOC IA ───────────────────────────────────────────────────────────────

function renderBlocIA(analysis, match) {
  const canCallAI = analysis && analysis.confidence_level !== null && analysis.explanation_context;
  const best      = analysis?.betting_recommendations?.best;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">Analyse IA</span>
      </div>

      <div id="ai-content">
        ${!canCallAI ? `
          <div class="text-muted" style="font-size:12px">Analyse non disponible.</div>
        ` : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--space-3)">
            <button class="btn btn--primary" data-ai-task="EXPLAIN" id="btn-ai-explain">💬 Expliquer ce match</button>
            <button class="btn btn--ghost btn--sm" data-ai-task="AUDIT">🔍 Vérifier la cohérence</button>
            <button class="btn btn--ghost btn--sm" data-ai-task="DETECT_INCONSISTENCY">⚡ Anomalies</button>
          </div>
          <div id="ai-response" class="text-muted" style="font-size:13px;line-height:1.8;min-height:40px">
            Clique sur "Expliquer ce match" pour une analyse en langage simple.
          </div>
        `}
      </div>
    </div>
  `;
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

    const BOOK_LABELS = {
      winamax: 'Winamax', betclic: 'Betclic', unibet_eu: 'Unibet',
      betsson: 'Betsson', pinnacle: 'Pinnacle', bet365: 'Bet365',
    };

    const isFlipped = matchOdds.home_team !== match.home_team?.name;

    const rows = matchOdds.bookmakers.map(bk => {
      const homeOdds = isFlipped ? bk.away_ml : bk.home_ml;
      const awayOdds = isFlipped ? bk.home_ml : bk.away_ml;
      const label    = BOOK_LABELS[bk.key] ?? bk.title;
      const bestHome = matchOdds.best_home_ml;
      const bestAway = matchOdds.best_away_ml;

      return `
        <tr style="border-bottom:1px solid var(--color-border)">
          <td style="padding:6px 8px;font-size:12px;color:var(--color-muted)">${label}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${homeOdds === bestHome ? '700' : '400'};color:${homeOdds === bestHome ? 'var(--color-success)' : 'var(--color-text)'}">
            ${homeOdds?.toFixed(2) ?? '—'}
          </td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:${awayOdds === bestAway ? '700' : '400'};color:${awayOdds === bestAway ? 'var(--color-success)' : 'var(--color-text)'}">
            ${awayOdds?.toFixed(2) ?? '—'}
          </td>
        </tr>`;
    }).join('');

    const table = document.createElement('div');
    table.className = 'multibook-table';
    table.style.cssText = 'margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px';
    table.innerHTML = `
      <div class="collapsible" id="books-collapsible">
        <div class="collapsible__header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:0">
          <span style="font-size:11px;color:var(--color-muted);font-weight:600">Comparer les cotes (${matchOdds.bookmakers.length} bookmakers)</span>
          <span class="collapsible__arrow text-muted" style="font-size:12px">▾</span>
        </div>
        <div class="collapsible__body" style="display:none;margin-top:10px">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:1px solid var(--color-border)">
                <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:left;font-weight:500">Bookmaker</th>
                <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.home_team?.abbreviation ?? 'DOM'}</th>
                <th style="padding:4px 8px;font-size:10px;color:var(--color-muted);text-align:center;font-weight:500">${match.away_team?.abbreviation ?? 'EXT'}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="font-size:10px;color:var(--color-muted);margin-top:6px">★ Meilleure cote en vert · Source : The Odds API</div>
        </div>
      </div>
    `;

    bloc7.appendChild(table);
    _checkBetterOddsAlert(bloc7, matchOdds, match, analysis);

    // Bind collapsible
    const coll = table.querySelector('#books-collapsible');
    coll?.querySelector('.collapsible__header')?.addEventListener('click', () => {
      const body  = coll.querySelector('.collapsible__body');
      const arrow = coll.querySelector('.collapsible__arrow');
      const open  = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      arrow.textContent   = open ? '▾' : '▴';
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
    const odds = isFlipped
      ? (sideIsHome ? bk.away_ml : bk.home_ml)
      : (sideIsHome ? bk.home_ml : bk.away_ml);
    if (odds && (!bestExternal || odds > bestExternal)) { bestExternal = odds; bestBook = bk.title; }
  }

  if (!bestExternal || !draftKings || bestExternal <= draftKings) return;

  const existing = bloc7.querySelector('.better-odds-alert');
  if (existing) existing.remove();

  const alert = document.createElement('div');
  alert.className = 'better-odds-alert';
  alert.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(72,199,142,0.1);border-left:3px solid var(--color-success);border-radius:6px;font-size:12px;';
  alert.innerHTML = `
    <div style="color:var(--color-success);font-weight:700;margin-bottom:2px">💡 Meilleure cote disponible</div>
    <div style="color:var(--color-muted)">${bestBook} propose <strong style="color:var(--color-text)">${bestExternal.toFixed(2)}</strong> au lieu de ${draftKings} — misez sur ${bestBook}.</div>
  `;
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

  // Collapsibles
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

  // Paper trading
  container.querySelectorAll('.paper-bet-btn').forEach(btn => {
    btn.addEventListener('click', () => _openBetModal(btn, match, analysis, storeInstance));
  });

  // IA
  if (analysis?.explanation_context) {
    container.querySelectorAll('[data-ai-task]').forEach(btn => {
      btn.addEventListener('click', () => triggerAIExplanation(container, analysis, match, btn.dataset.aiTask));
    });
  }
}

// ── APPEL IA ─────────────────────────────────────────────────────────────

async function triggerAIExplanation(container, analysis, match, task) {
  const responseEl = container.querySelector('#ai-response');
  if (!responseEl) return;

  responseEl.innerHTML = '<span class="text-muted">Analyse en cours…</span>';

  const TASK_PROMPTS = {
    EXPLAIN: `Tu es un analyste sportif NBA. Réponds en 3-4 phrases courtes, sans titres, sans gras, sans listes. N'invente aucun chiffre. Utilise uniquement les valeurs du contexte. Phrase 1 : quelle équipe est favorisée et pourquoi. Phrase 2 : le signal principal en termes simples. Phrase 3 : confirmer ou non le pari suggéré. Phrase 4 : une limite courte. Max 80 mots.`,
    AUDIT: `Tu es un analyste sportif NBA. En 2-3 phrases simples sans titres ni listes : dis si les signaux sont cohérents entre eux. Si contradiction, explique laquelle. Uniquement les données fournies. Max 60 mots.`,
    DETECT_INCONSISTENCY: `Tu es un analyste sportif NBA. En 2 phrases simples sans titres ni listes : dis s'il y a une anomalie dans les données. Si aucune anomalie, dis-le clairement. Max 50 mots.`,
  };

  const home  = match.home_team?.name ?? '—';
  const away  = match.away_team?.name ?? '—';
  const score = analysis.predictive_score !== null ? Math.round(analysis.predictive_score * 100) : null;
  const favori = score !== null
    ? (score > 50 ? `${home} (${score}%)` : score < 50 ? `${away} (${100 - score}%)` : 'Équilibré (50%)')
    : 'Non déterminé';

  const userMessage = `
N'INVENTE AUCUN CHIFFRE. Utilise uniquement les valeurs ci-dessous.
Match : ${home} vs ${away}
Favori : ${favori}
Score prédictif : ${score ?? 'non calculé'}%
Robustesse : ${analysis.robustness_score !== null ? Math.round(analysis.robustness_score * 100) + '%' : 'non calculée'}
Qualité données : ${analysis.data_quality_score !== null ? Math.round(analysis.data_quality_score * 100) + '%' : 'non calculée'}
Signaux :
${(analysis.key_signals ?? []).slice(0, 3).map(s =>
  `- ${_simplifyLabel(s.label, s.variable)} : ${s.direction === 'POSITIVE' ? 'avantage domicile' : 'avantage extérieur'}`
).join('\n')}
Variables manquantes : ${(analysis.missing_critical ?? []).join(', ') || 'aucune'}
  `.trim();

  try {
    const response = await fetch(`${WORKER_URL}/ai/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 600,
        system: TASK_PROMPTS[task] ?? TASK_PROMPTS.EXPLAIN,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);

    const data = await response.json();
    const text = data.content?.map(b => b.type === 'text' ? b.text : '').join('\n').trim();
    if (!text) throw new Error('Réponse vide');

    const clean = text.replace(/^#{1,4}\s.+$/gm, '').replace(/\*\*(.+?)\*\*/gs, '$1').replace(/\*(.+?)\*/gs, '$1').replace(/^[-•]\s/gm, '').trim();

    responseEl.innerHTML = `
      <div style="line-height:1.8;font-size:13px">${escapeHtml(clean)}</div>
      <div class="text-muted" style="font-size:10px;margin-top:var(--space-2)">Source : Claude Sonnet · Basé uniquement sur les données du moteur</div>
    `;
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

  const state        = PaperEngine.load();
  const bankroll     = state.current_bankroll;
  const kellySugg    = kelly > 0 ? Math.round(kelly * bankroll * 100) / 100 : null;
  const oddsDecimal  = _americanToDecimal(odds);
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
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Cote réelle prise <span style="font-style:italic">(modifiez si vous misez sur un autre book)</span>
        </label>
        <input type="number" id="odds-input" class="paper-modal__input"
          value="${oddsDecimal}" placeholder="Ex: 2.70" step="0.05" min="1.01"
          style="font-size:20px;font-weight:700;text-align:center;letter-spacing:0.05em"
        />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">
          Mise (€)${kellySugg ? `<span style="color:var(--color-signal);font-weight:600"> · Conseillé : ${kellySugg.toFixed(2)} €</span>` : ''}
        </label>
        <input type="number" id="stake-input" class="paper-modal__input"
          value="${kellySugg ?? ''}" placeholder="Montant en €"
          min="0.5" max="${bankroll.toFixed(2)}" step="0.5"
          style="font-size:16px;font-weight:600;text-align:center"
        />
      </div>

      <div style="margin-bottom:18px">
        <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:6px">Note (optionnel)</label>
        <input type="text" id="note-input" class="paper-modal__input" placeholder="Ex: blessure clé…" maxlength="200"/>
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="modal-cancel" style="flex:1;padding:12px">Annuler</button>
        <button class="btn btn--primary" id="modal-confirm" style="flex:2;padding:12px;font-size:14px;font-weight:600">✓ Confirmer</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('#modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#modal-confirm')?.addEventListener('click', async () => {
    const stake       = parseFloat(modal.querySelector('#stake-input')?.value);
    const oddsReal    = parseFloat(modal.querySelector('#odds-input')?.value) || oddsDecimal;
    const oddsAm      = _decimalToAmerican(oddsReal) ?? odds;
    const note        = modal.querySelector('#note-input')?.value?.trim() ?? null;

    if (!stake || stake <= 0 || stake > bankroll) {
      modal.querySelector('#stake-input')?.classList.add('input--error');
      return;
    }

    const result = await PaperEngine.placeBet({
      match_id: match.id, date: match.date, sport: 'NBA',
      home: match.home_team?.name ?? '—', away: match.away_team?.name ?? '—',
      market, side, side_label: sideLabel,
      odds_taken: oddsAm, odds_decimal: oddsReal, odds_source: null, spread_line: null,
      stake, kelly_stake: kelly, edge, motor_prob: motorProb, implied_prob: impliedProb,
      confidence_level: analysis?.confidence_level ?? null,
      data_quality: analysis?.data_quality_score ?? null,
      decision_note: note,
    });

    if (result?.error === 'DAILY_LIMIT_EXCEEDED') {
      const errEl = modal.querySelector('#stake-error') ?? (() => {
        const el = document.createElement('div');
        el.id = 'stake-error';
        el.style.cssText = 'font-size:11px;color:var(--color-danger);margin-top:6px;padding:6px 8px;background:rgba(241,70,104,0.1);border-radius:4px;';
        modal.querySelector('#stake-input')?.after(el);
        return el;
      })();
      errEl.textContent = result.message;
      return;
    }

    storeInstance.set({ paperTradingVersion: (storeInstance.get('paperTradingVersion') ?? 0) + 1 });
    modal.remove();
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
    </div>
  `;
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
  const labels = {
    WEIGHTS_NOT_CALIBRATED:       'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:        'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD: 'Qualité des données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:   'Analyse trop instable',
    ABSENCES_NOT_CONFIRMED:       'Absences non confirmées',
  };
  return labels[reason] ?? reason;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
