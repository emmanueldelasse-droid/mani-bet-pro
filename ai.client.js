/**
 * MANI BET PRO — ai.client.js
 *
 * Client IA — proxy vers Anthropic via Cloudflare Worker.
 * Respecte strictement les règles d'anti-hallucination.
 * Cache les explications dans localStorage par (analysis_id + task).
 */

import { API_CONFIG }      from '../config/api.config.js';
import { AI_PROMPTS }      from './ai.prompts.js';
import { AIContextBuilder } from './ai.context.js';
import { AIGuard }         from './ai.guard.js';
import { Logger }          from '../utils/utils.logger.js';

const WORKER     = API_CONFIG.WORKER_BASE_URL;
const CACHE_KEY  = (analysisId, task) => `mbp_ai_${analysisId}_${task}`;

export class AIClient {

  /**
   * Génère une explication IA pour une analyse.
   * Retourne le cache si disponible.
   *
   * @param {AnalysisOutput} analysis
   * @param {object|null} match — métadonnées du match
   * @param {'EXPLAIN'|'AUDIT'|'SUMMARIZE'|'SCENARIO'|'DETECT_INCONSISTENCY'} task
   * @returns {Promise<AIExplanation|null>}
   */
  static async explain(analysis, match = null, task = 'EXPLAIN') {
    if (!analysis?.analysis_id) {
      Logger.warn('AI_EXPLAIN_NO_ID', {});
      return null;
    }

    // Vérifier le cache localStorage
    const cached = this._getCached(analysis.analysis_id, task);
    if (cached) {
      Logger.debug('AI_EXPLAIN_CACHE_HIT', { task, analysis_id: analysis.analysis_id });
      return cached;
    }

    // Construire le contexte
    const context     = AIContextBuilder.build(analysis, match, task);
    const userMessage = AI_PROMPTS.buildUserMessage(task, context);

    try {
      const response = await fetch(`${WORKER}/ai/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system:     AI_PROMPTS.SYSTEM_STRICT,
          messages:   [{ role: 'user', content: userMessage }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        Logger.error('AI_EXPLAIN_HTTP_ERROR', {
          status:  response.status,
          message: err?.error?.message ?? 'Unknown error',
        });
        return null;
      }

      const data = await response.json();

      // Extraire le texte de la réponse
      const rawText = (data.content ?? [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();

      if (!rawText) {
        Logger.warn('AI_EXPLAIN_EMPTY_RESPONSE', { task });
        return null;
      }

      // Validation anti-hallucination
      const validated   = AIGuard.validate(rawText, context);
      const crossChecks = AIGuard.crossCheck(rawText, context);

      const explanation = {
        ai_explanation_id: crypto.randomUUID(),
        analysis_id:       analysis.analysis_id,
        task,
        model_used:        'claude-sonnet-4-20250514',
        prompt_version:    AI_PROMPTS.VERSION,
        context_provided:  context,
        response_text:     validated.text,
        hallucination_flags: validated.flags,
        cross_check_warnings: crossChecks,
        clean:             validated.clean,
        generated_at:      new Date().toISOString(),
        tokens_used:       data.usage?.output_tokens ?? null,
      };

      // Mettre en cache (permanent)
      this._setCached(analysis.analysis_id, task, explanation);

      Logger.aiCall({
        analysisId: analysis.analysis_id,
        task,
        tokensUsed: explanation.tokens_used,
        flags:      validated.flags,
      });

      return explanation;

    } catch (err) {
      Logger.error('AI_EXPLAIN_FETCH_ERROR', { message: err.message });
      return null;
    }
  }

  /**
   * Raccourcis pour les tâches courantes.
   */
  static summarize(analysis, match)          { return this.explain(analysis, match, 'SUMMARIZE'); }
  static audit(analysis, match)              { return this.explain(analysis, match, 'AUDIT'); }
  static detectInconsistency(analysis, match){ return this.explain(analysis, match, 'DETECT_INCONSISTENCY'); }

  // ── CACHE ────────────────────────────────────────────────────────────────

  static _getCached(analysisId, task) {
    try {
      const raw = localStorage.getItem(CACHE_KEY(analysisId, task));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static _setCached(analysisId, task, explanation) {
    try {
      localStorage.setItem(
        CACHE_KEY(analysisId, task),
        JSON.stringify(explanation)
      );
    } catch (err) {
      Logger.warn('AI_CACHE_WRITE_ERROR', { message: err.message });
    }
  }

  /**
   * Invalider le cache IA pour une analyse.
   * @param {string} analysisId
   */
  static invalidateCache(analysisId) {
    const tasks = ['EXPLAIN', 'AUDIT', 'SUMMARIZE', 'SCENARIO', 'DETECT_INCONSISTENCY'];
    tasks.forEach(task => {
      localStorage.removeItem(CACHE_KEY(analysisId, task));
    });
  }
}
