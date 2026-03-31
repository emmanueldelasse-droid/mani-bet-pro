/**
 * MANI BET PRO — ai.guard.js v2
 *
 * Validation anti-hallucination des sorties IA.
 * Détecte les patterns suspects dans les réponses Claude.
 */

export class AIGuard {

  static FORBIDDEN_PATTERNS = [
    { pattern: /\b\d+[.,]\d+%\b/g,          reason: 'Pourcentage précis potentiellement inventé' },
    { pattern: /probabilité\s+de\s+\d+/gi,   reason: 'Probabilité inventée' },
    { pattern: /\bgagnera\b/gi,              reason: 'Certitude sur vainqueur' },
    { pattern: /\bà coup sûr\b/gi,           reason: 'Certitude excessive' },
    { pattern: /\binévitablement\b/gi,       reason: 'Certitude excessive' },
    { pattern: /\bcertainement\b/gi,         reason: 'Certitude excessive' },
    { pattern: /statistique[s]?\s+montre/gi, reason: 'Statistique potentiellement inventée' },
  ];

  /**
   * Valide la réponse IA et flag les patterns suspects.
   * @param {string} rawText
   * @param {object} context — contexte fourni à l'IA (pour vérification)
   * @returns {{ text: string, flags: Array, hasFlags: boolean }}
   */
  static validate(rawText, context) {
    if (!rawText) return { text: '', flags: [], hasFlags: false };

    const flags = [];

    for (const { pattern, reason } of this.FORBIDDEN_PATTERNS) {
      const regex   = new RegExp(pattern.source, pattern.flags);
      const matches = rawText.match(regex);
      if (matches) {
        flags.push({ pattern: pattern.toString(), matches, reason, severity: 'WARNING' });
      }
    }

    const annotated = flags.length > 0
      ? rawText + '\n\n⚠ [Audit automatique : certains passages ont été signalés pour vérification]'
      : rawText;

    return {
      text:     annotated,
      flags,
      hasFlags: flags.length > 0,
    };
  }
}
