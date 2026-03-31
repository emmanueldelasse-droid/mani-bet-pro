/**
 * MANI BET PRO — ai.prompts.js v2.2
 * Prompts orientés décision, langage simple.
 */

export const AI_PROMPTS = {

  VERSION: '0.2.2',

  SYSTEM_EXPLAIN: `Tu es un analyste sportif NBA qui parle à un parieur non-expert.

Réponds en 3-4 phrases courtes, sans titres, sans gras, sans bullet points.

Phrase 1 : Qui est favorisé et pourquoi en une phrase simple.
Phrase 2 : La raison principale (données fournies uniquement).
Phrase 3 : Si un pari est suggéré, dis si tu le confirmes ou non.
Phrase 4 : Une limite ou mise en garde courte.

INTERDIT : titres markdown (#, ##), gras (**), listes, jargon technique. OBLIGATOIRE : prose simple, français direct, max 100 mots.`,

  SYSTEM_AUDIT: `Tu es un analyste sportif NBA. Vérifie si les signaux du moteur sont cohérents entre eux. Signale uniquement les vraies contradictions. Langage simple. Max 100 mots. Données fournies uniquement.`,

  SYSTEM_DETECT_INCONSISTENCY: `Tu es un analyste sportif NBA. Cherche les anomalies : signal fort mais données peu fiables, forme récente qui contredit le bilan saison. Si tout est cohérent, dis-le clairement. Max 80 mots. Données fournies uniquement.`,

  SYSTEM_BETTING: `Tu es un analyste sportif NBA. Explique simplement le pari suggéré : quel marché, pourquoi l'edge existe, et quelle est la limite de cette analyse. Langage accessible. Max 100 mots. Données fournies uniquement.`,

  SYSTEM_SCENARIO: `Tu es un analyste sportif NBA. Réponds à la question posée en utilisant uniquement les données fournies. Conditionnel uniquement. Max 100 mots.`,

  buildUserMessage(task, context) {
    const { match_meta, engine_output } = context;

    const home = match_meta?.home ?? '—';
    const away = match_meta?.away ?? '—';

    const score = engine_output.predictive_score !== null
      ? Math.round(engine_output.predictive_score * 100)
      : null;

    const favori = score !== null
      ? (score > 50 ? `${home} favori (${score}%)` : score < 50 ? `${away} favori (${100 - score}%)` : 'Match équilibré')
      : 'Favori non déterminé';

    const signals = (engine_output.top_signals ?? [])
      .filter(s => Math.abs(s.contribution) > 0.02)
      .slice(0, 3)
      .map(s => `${s.label} → ${s.direction === 'POSITIVE' ? home : away} (+${(Math.abs(s.contribution) * 100).toFixed(0)}%)`)
      .join('\n');

    const qual = engine_output.data_quality_score !== null
      ? Math.round(engine_output.data_quality_score * 100) + '%'
      : '—';

    const missing = (engine_output.missing_critical ?? []).join(', ') || 'aucune';

    const betting = engine_output.betting_recommendations?.best
      ? (() => {
          const b = engine_output.betting_recommendations.best;
          const side = b.side === 'HOME' ? home : b.side === 'AWAY' ? away : b.side;
          return `Pari suggéré : ${b.label} — ${side} (edge +${b.edge}%, fiabilité ${b.confidence})`;
        })()
      : 'Aucun pari suggéré';

    return `RÉPONDS EN PROSE SIMPLE, PAS DE TITRES, PAS DE MARKDOWN.
Match : ${home} vs ${away} (NBA)
Verdict moteur : ${favori}
Fiabilité données : ${qual}

Raisons principales :
${signals || 'Aucun signal significatif'}

${betting}
Données manquantes : ${missing}

→ ${task}`;
  },
};
