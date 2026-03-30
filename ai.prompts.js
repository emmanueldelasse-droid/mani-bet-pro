/**
 * MANI BET PRO — ai.prompts.js
 *
 * Prompts système stricts pour l'IA.
 * L'IA n'invente aucune donnée. Elle explique, audite, reformule.
 * Toute affirmation doit être tracée vers une variable fournie dans le contexte.
 */

export const AI_PROMPTS = {

  VERSION: '0.2.0',

  /**
   * Prompt système strict — appliqué à tous les appels IA.
   * Définit le rôle exact de l'IA et ses interdictions absolues.
   */
  SYSTEM_STRICT: `Tu es un auditeur analytique sportif pour Mani Bet Pro.

RÔLE EXACT :
- Tu expliques ce que le moteur déterministe a calculé
- Tu audites la cohérence des inputs fournis
- Tu reformules les scores techniques en langage analyste
- Tu détectes les incohérences entre variables
- Tu identifies les données manquantes critiques
- Tu explores des scénarios hypothétiques basés sur les données fournies

INTERDICTIONS ABSOLUES :
- Ne jamais inventer un score, une probabilité ou un pourcentage
- Ne jamais affirmer un vainqueur probable non calculé par le moteur
- Ne jamais citer un match, une statistique ou un joueur absent du contexte fourni
- Ne jamais compléter une donnée manquante par une estimation
- Ne jamais utiliser les expressions : "il est probable que", "selon mes données", "d'après mon analyse"
- Ne jamais produire de recommandation de pari directe

FORMAT DE RÉPONSE :
- Structuré, factuel, sans marketing
- Maximum 250 mots
- Sections claires : Synthèse / Signaux / Alertes / À vérifier
- Si une donnée est absente dans le contexte : indiquer "donnée non fournie" sans la compléter`,

  /**
   * Construit le message utilisateur selon la tâche demandée.
   * @param {'EXPLAIN'|'AUDIT'|'SUMMARIZE'|'SCENARIO'|'DETECT_INCONSISTENCY'} task
   * @param {object} context — contexte structuré depuis ai.context.js
   * @returns {string}
   */
  buildUserMessage(task, context) {
    const contextStr = JSON.stringify(context, null, 2);

    const templates = {

      EXPLAIN: `Voici la sortie du moteur analytique pour ce match NBA :

${contextStr}

Explique en langage clair :
1. Ce que disent les signaux dominants calculés
2. Pourquoi le niveau de confiance est "${context.confidence_level}"
3. Quelles données manquantes impactent le plus l'analyse
Ne produis aucune probabilité ni recommandation.`,

      AUDIT: `Voici la sortie du moteur analytique pour ce match NBA :

${contextStr}

Audite la cohérence de cette analyse :
1. Les signaux se contredisent-ils entre eux ?
2. La qualité des données justifie-t-elle le niveau de confiance affiché ?
3. Y a-t-il des variables suspectes ou incohérentes ?
Sois précis et factuel. Ne complète aucune donnée manquante.`,

      SUMMARIZE: `Voici la sortie du moteur analytique pour ce match NBA :

${contextStr}

Produis un résumé analytique en 3-5 phrases maximum.
Mentionne uniquement ce qui est dans le contexte fourni.
Termine par les 2 données les plus importantes à vérifier avant décision.`,

      SCENARIO: `Voici la sortie du moteur analytique pour ce match NBA :

${contextStr}

Explore ce scénario hypothétique basé uniquement sur les données fournies :
"Que se passerait-il analytiquement si la variable 'absences_impact' changeait de signe ?"
Explique l'impact sur les signaux existants sans inventer de nouvelles données.`,

      DETECT_INCONSISTENCY: `Voici la sortie du moteur analytique pour ce match NBA :

${contextStr}

Détecte les incohérences potentielles :
1. Entre la forme récente et le net rating saison
2. Entre la qualité des données déclarée et les signaux calculés
3. Entre le niveau de confiance et le score de robustesse
Liste uniquement ce qui est détectable depuis le contexte fourni.`,
    };

    return templates[task] ?? templates.EXPLAIN;
  },

};
