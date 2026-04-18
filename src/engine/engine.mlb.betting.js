/**
 * MANI BET PRO — MLB Betting Engine v1.0
 *
 * Variables clés :
 *   - pitcher_fip        : FIP pitcher titulaire (≈40% du résultat)
 *   - pitcher_era        : ERA pitcher titulaire
 *   - pitcher_rest       : jours de repos depuis dernier départ
 *   - lineup_ops         : OPS moyen des 9 premiers (puissance offensive)
 *   - bullpen_era        : ERA bullpen 7 derniers jours
 *   - team_run_diff      : différentiel de runs sur la saison
 *   - park_factor        : facteur stade (runs)
 *   - home_advantage     : avantage domicile MLB (~54%)
 */

// ── PARK FACTORS (runs, base 100 = neutre) ───────────────────────────────────
// Source : Fangraphs multi-year park factors 2023-2025
export const MLB_PARK_FACTORS = {
  'Coors Field':              115, // Rockies — le plus favorable aux offenses
  'Great American Ball Park': 108, // Reds
  'Fenway Park':              106, // Red Sox
  'Globe Life Field':         105, // Rangers
  'Yankee Stadium':           104, // Yankees
  'Wrigley Field':            103, // Cubs
  'Oracle Park':               97, // Giants
  'T-Mobile Park':             96, // Mariners
  'Petco Park':                95, // Padres
  'Dodger Stadium':            97, // Dodgers
  'Tropicana Field':           95, // Rays
  'Oakland Coliseum':          96, // Athletics
  'loanDepot Park':            95, // Marlins
  'Truist Park':               99, // Braves
  'American Family Field':    100, // Brewers
  'Target Field':              99, // Twins
  'Busch Stadium':             97, // Cardinals
  'Minute Maid Park':         100, // Astros
  'Angel Stadium':             99, // Angels
  'Chase Field':              104, // Diamondbacks (roof ouvert = chaud)
  'Kauffman Stadium':          99, // Royals
  'Progressive Field':         98, // Guardians
  'PNC Park':                  97, // Pirates
  'Citizens Bank Park':       103, // Phillies
  'Citi Field':                97, // Mets
  'Camden Yards':             101, // Orioles
  'Guaranteed Rate Field':     98, // White Sox
  'Comerica Park':             96, // Tigers
  'Rogers Centre':            102, // Blue Jays (turf)
  'Nationals Park':            99, // Nationals
};

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const HOME_WIN_PCT_BASE  = 0.536; // avantage domicile MLB historique
const EDGE_THRESHOLD_MIN = 5;     // edge minimum pour recommander
const KELLY_FRACTION     = 0.25;  // Kelly/4
const KELLY_MAX_PCT      = 0.05;  // 5% bankroll max

// ── HELPERS MATH ──────────────────────────────────────────────────────────────
export function americanToProb(american) {
  if (american == null) return null;
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

export function americanToDecimal(american) {
  if (american == null) return null;
  return american > 0
    ? (american / 100) + 1
    : (100 / Math.abs(american)) + 1;
}

export function decimalToAmerican(decimal) {
  if (decimal == null || decimal <= 1) return null;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

export function decimalToProb(decimal) {
  if (!decimal || decimal <= 1) return null;
  return 1 / decimal;
}

export function removeVig(homeOdds, awayOdds) {
  if (!homeOdds || !awayOdds) return { home: null, away: null };
  const homeProb = decimalToProb(homeOdds);
  const awayProb = decimalToProb(awayOdds);
  const total    = homeProb + awayProb;
  return { home: homeProb / total, away: awayProb / total };
}

// ── SÉLECTION MEILLEURE COTE ──────────────────────────────────────────────────
const BOOK_PRIORITY = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'bet365', 'unibet_eu', 'betsson'];

export function getBestMLBOdds(marketOdds, side, market = 'h2h') {
  if (!marketOdds?.bookmakers?.length) return null;

  const _getOdds = (bk) => {
    if (market === 'h2h')     return side === 'HOME' ? bk.home_ml  : bk.away_ml;
    if (market === 'totals')  return side === 'OVER' ? bk.over_total : bk.under_total;
    if (market === 'spreads') return side === 'HOME' ? bk.home_spread : bk.away_spread;
    return null;
  };

  for (const key of BOOK_PRIORITY) {
    const bk = marketOdds.bookmakers.find(b => b.key === key);
    if (!bk) continue;
    const odds = _getOdds(bk);
    if (odds && odds > 1) return { odds: decimalToAmerican(odds), decimalOdds: odds, bookmaker: bk.title ?? bk.key };
  }

  // Fallback : meilleure cote dispo
  let best = null;
  for (const bk of marketOdds.bookmakers) {
    const odds = _getOdds(bk);
    if (!odds || odds <= 1) continue;
    if (!best || odds > best.decimalOdds) {
      best = { odds: decimalToAmerican(odds), decimalOdds: odds, bookmaker: bk.title ?? bk.key };
    }
  }
  return best;
}

// ── KELLY ────────────────────────────────────────────────────────────────────
function computeKelly(p, americanOdds) {
  if (!p || !americanOdds) return null;
  const b    = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  const kelly = (b * p - (1 - p)) / b;
  if (kelly <= 0) return 0;
  return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
}

// ── MOTEUR PRINCIPAL ──────────────────────────────────────────────────────────
/**
 * matchData = {
 *   match_id, home_team, away_team, venue,
 *   home_pitcher: { name, era, fip, whip, ip_per_start, rest_days },
 *   away_pitcher: { name, era, fip, whip, ip_per_start, rest_days },
 *   home_lineup:  { ops, wrc_plus, k_pct },
 *   away_lineup:  { ops, wrc_plus, k_pct },
 *   home_bullpen: { era_7d, whip_7d },
 *   away_bullpen: { era_7d, whip_7d },
 *   home_season:  { run_diff, win_pct, runs_per_game, runs_allowed },
 *   away_season:  { run_diff, win_pct, runs_per_game, runs_allowed },
 *   market_odds:  { bookmakers: [...] },
 * }
 */
export function computeMLB(matchData) {
  const { home_pitcher, away_pitcher, home_lineup, away_lineup,
          home_bullpen, away_bullpen, home_season, away_season,
          venue, market_odds } = matchData;

  // ── 1. Score pitcher (FIP-based, normalisé 0-1) ──────────────────────────
  // FIP moyen MLB ≈ 4.00. Plus bas = meilleur.
  // On convertit en probabilité de victoire relative
  const hFIP = home_pitcher?.fip ?? home_pitcher?.era ?? 4.20;
  const aFIP = away_pitcher?.fip ?? away_pitcher?.era ?? 4.20;

  // Différence FIP → avantage pitcher
  // Chaque 0.5 de FIP ≈ ~4% d'avantage
  const fipDiff      = aFIP - hFIP; // positif = avantage home pitcher
  const pitcherAdv   = Math.tanh(fipDiff / 2) * 0.20; // normalisé ±20%

  // ── 2. Repos pitcher ────────────────────────────────────────────────────
  const hRest     = home_pitcher?.rest_days ?? 4;
  const aRest     = away_pitcher?.rest_days ?? 4;
  // Optimal = 4-5 jours. <4 = fatigue, >6 = rouille légère
  const restScore = (r) => r < 3 ? -0.03 : r < 4 ? -0.01 : r <= 6 ? 0 : -0.01;
  const restAdv   = restScore(hRest) - restScore(aRest);

  // ── 3. Lineup (OPS) ──────────────────────────────────────────────────────
  const hOPS = home_lineup?.ops ?? 0.720;
  const aOPS = away_lineup?.ops ?? 0.720;
  // OPS moyen MLB ≈ 0.720. Chaque 0.050 ≈ ~3% d'avantage
  const lineupAdv = Math.tanh((hOPS - aOPS) / 0.10) * 0.08;

  // ── 4. Bullpen ───────────────────────────────────────────────────────────
  const hBullpenERA = home_bullpen?.era_7d ?? 4.00;
  const aBullpenERA = away_bullpen?.era_7d ?? 4.00;
  const bullpenAdv  = Math.tanh((aBullpenERA - hBullpenERA) / 2) * 0.08;

  // ── 5. Run differential saison ──────────────────────────────────────────
  const hRunDiff = home_season?.run_diff ?? 0;
  const aRunDiff = away_season?.run_diff ?? 0;
  const runDiffAdv = Math.tanh((hRunDiff - aRunDiff) / 50) * 0.07;

  // ── 6. Park factor ───────────────────────────────────────────────────────
  const parkFactor = MLB_PARK_FACTORS[venue] ?? 100;
  // Park factor affecte l'O/U plus que le ML — impact faible sur ML
  const parkAdv    = 0; // neutre pour le ML, utilisé pour O/U

  // ── 7. Avantage domicile ─────────────────────────────────────────────────
  const homeBase = HOME_WIN_PCT_BASE; // 53.6% historique

  // ── 8. Probabilité finale ────────────────────────────────────────────────
  let homeProb = homeBase + pitcherAdv + restAdv + lineupAdv + bullpenAdv + runDiffAdv;
  homeProb     = Math.max(0.20, Math.min(0.80, homeProb)); // cap 20-80%
  const awayProb = 1 - homeProb;

  // ── 9. Score de confiance ────────────────────────────────────────────────
  let dataQuality = 'HIGH';
  const missing   = [];
  if (!home_pitcher?.fip && !home_pitcher?.era) { missing.push('home_pitcher_fip'); dataQuality = 'MEDIUM'; }
  if (!away_pitcher?.fip && !away_pitcher?.era) { missing.push('away_pitcher_fip'); dataQuality = 'MEDIUM'; }
  if (!home_lineup?.ops)  { missing.push('home_lineup_ops');   dataQuality = 'LOW'; }
  if (!away_lineup?.ops)  { missing.push('away_lineup_ops');   dataQuality = 'LOW'; }
  if (!home_bullpen?.era_7d) missing.push('home_bullpen_era');
  if (!away_bullpen?.era_7d) missing.push('away_bullpen_era');

  // ── 10. Recommandations de paris ─────────────────────────────────────────
  const recommendations = [];

  if (market_odds?.bookmakers?.length) {
    // Moneyline
    for (const [side, prob] of [['HOME', homeProb], ['AWAY', awayProb]]) {
      const best = getBestMLBOdds(market_odds, side, 'h2h');
      if (!best) continue;
      const impliedProb = americanToProb(best.odds);
      const edge        = Math.round((prob - impliedProb) * 100);
      if (edge >= EDGE_THRESHOLD_MIN) {
        recommendations.push({
          type:        'MONEYLINE',
          label:       'Vainqueur',
          side,
          odds_line:   best.odds,
          odds_decimal: best.decimalOdds,
          odds_source: best.bookmaker,
          motor_prob:  Math.round(prob * 100),
          implied_prob: Math.round(impliedProb * 100),
          edge,
          kelly_stake: computeKelly(prob, best.odds),
          has_value:   true,
        });
      }
    }

    // Total (Over/Under)
    const parkFact = (MLB_PARK_FACTORS[venue] ?? 100) / 100;
    const homeRPG  = home_season?.runs_per_game ?? 4.5;
    const awayRPG  = away_season?.runs_per_game ?? 4.5;
    // Estimation runs = (homeRPG + awayRPG) * park_factor
    // Mais les pitchers réduisent ça significativement
    const pitcherReduction = (1 - Math.min(0.30, Math.max(0, (8 - (hFIP + aFIP) / 2) / 20)));
    const estTotal = (homeRPG + awayRPG) * parkFact * pitcherReduction;

    const overBest  = getBestMLBOdds(market_odds, 'OVER',  'totals');
    const underBest = getBestMLBOdds(market_odds, 'UNDER', 'totals');
    const ouLine    = market_odds.bookmakers?.[0]?.total_line ?? null;

    if (ouLine && overBest && underBest) {
      // Probabilité over = fonction de l'écart entre estTotal et la ligne
      const diff    = estTotal - ouLine;
      const overProb = 0.50 + Math.tanh(diff / 2) * 0.15;
      const underProb = 1 - overProb;

      for (const [side, prob, best] of [
        ['OVER', overProb, overBest],
        ['UNDER', underProb, underBest],
      ]) {
        const impliedProb = americanToProb(best.odds);
        const edge        = Math.round((prob - impliedProb) * 100);
        if (edge >= EDGE_THRESHOLD_MIN) {
          recommendations.push({
            type:        'OVER_UNDER',
            label:       `Total de runs`,
            side,
            ou_line:     ouLine,
            odds_line:   best.odds,
            odds_decimal: best.decimalOdds,
            odds_source: best.bookmaker,
            motor_prob:  Math.round(prob * 100),
            implied_prob: Math.round(impliedProb * 100),
            edge,
            kelly_stake: computeKelly(prob, best.odds),
            has_value:   true,
          });
        }
      }
    }
  }

  // Trier par edge décroissant
  recommendations.sort((a, b) => b.edge - a.edge);
  const best = recommendations[0] ?? null;

  return {
    home_prob:    Math.round(homeProb  * 100),
    away_prob:    Math.round(awayProb  * 100),
    data_quality: dataQuality,
    missing_vars: missing,
    variables: {
      pitcher_fip_diff:  Math.round(fipDiff * 100) / 100,
      pitcher_adv:       Math.round(pitcherAdv * 100),
      lineup_adv:        Math.round(lineupAdv * 100),
      bullpen_adv:       Math.round(bullpenAdv * 100),
      run_diff_adv:      Math.round(runDiffAdv * 100),
      park_factor:       parkFactor,
      home_pitcher:      home_pitcher?.name ?? null,
      away_pitcher:      away_pitcher?.name ?? null,
    },
    recommendations,
    best,
    est_total_runs: Math.round(estTotal * 10) / 10,
  };
}
