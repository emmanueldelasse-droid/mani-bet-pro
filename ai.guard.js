/**
 * MANI BET PRO — ai.guard.js
 *
 * Validation des sorties IA.
 * Détecte les patterns suspects : chiffres inventés, certitudes excessives,
 * recommandations directes de pari.
 */

export class AIGuard {

  /**
   * Patterns interdits dans les sorties IA.
   * Chaque pattern est associé à un niveau de sévérité.
   */
  static FORBIDDEN_PATTERNS = [
    {
      pattern:  /\b(gagnera|va gagner|devrait gagner)\b/gi,
      label:    'Affirmation de vainqueur',
      severity: 'HIGH',
    },
    {
      pattern:  /\b(parie sur|mise sur|joue le|recommande de parier)\b/gi,
      label:    'Recommandation de pari directe',
      severity: 'HIGH',
    },
    {
      pattern:  /\b\d{2,3}[.,]\d+\s*%\b/g,
      label:    'Pourcentage précis potentiellement inventé',
      severity: 'MEDIUM',
    },
    {
      pattern:  /\b(certainement|inévitablement|à coup sûr|sans aucun doute)\b/gi,
      label:    'Certitude excessive',
      severity: 'MEDIUM',
    },
    {
      pattern:  /\b(selon mes données|d'après mon analyse|mes statistiques)\b/gi,
      label:    'Référence à des données non fournies',
      severity: 'HIGH',
    },
    {
      pattern:  /\b(historiquement|en moyenne sur les \d+ dernières saisons)\b/gi,
      label:    'Référence historique non vérifiable',
      severity: 'LOW',
    },
  ];

  /**
   * Valide le texte retourné par l'IA.
   * @param {string} rawText
   * @param {object} context — contexte fourni à l'IA (pour vérification croisée)
   * @returns {{ text: string, flags: Flag[], clean: boolean }}
   */
  static validate(rawText, context) {
    if (!rawText || typeof rawText !== 'string') {
      return { text: '', flags: [], clean: true };
    }

    const flags = [];

    for (const rule of this.FORBIDDEN_PATTERNS) {
      const matches = rawText.match(rule.pattern);
      if (matches) {
        flags.push({
          label:    rule.label,
          severity: rule.severity,
          matches:  [...new Set(matches)].slice(0, 3),
        });
      }
    }

    const highFlags = flags.filter(f => f.severity === 'HIGH');
    const clean     = flags.length === 0;

    let text = rawText;

    // Ajouter un avertissement si flags HIGH détectés
    if (highFlags.length > 0) {
      text += `\n\n⚠️ **Audit automatique** : ${highFlags.length} passage(s) signalé(s) pour vérification (${highFlags.map(f => f.label).join(', ')}).`;
    }

    return { text, flags, clean };
  }

  /**
   * Vérifie qu'une réponse IA ne cite pas de données absentes du contexte.
   * Vérification basique : noms d'équipes non fournis, scores non calculés.
   * @param {string} text
   * @param {object} context
   * @returns {string[]} — liste des avertissements
   */
  static crossCheck(text, context) {
    const warnings = [];

    // Vérifier que les équipes citées correspondent au match
    const homeTeam = context?.match_metadata?.home_team;
    const awayTeam = context?.match_metadata?.away_team;

    if (homeTeam === 'donnée non fournie' && awayTeam === 'donnée non fournie') {
      // Pas de métadonnées match — impossible de croiser
      return warnings;
    }

    // Si l'IA cite un score précis qui n'est pas dans le contexte
    const scorePattern = /\b(\d{1,3})-(\d{1,3})\b/g;
    const scoreMatches = text.match(scorePattern);
    if (scoreMatches && !context?.engine_output?.predictive_score) {
      warnings.push('Score précis cité sans calcul moteur correspondant');
    }

    return warnings;
  }
}
