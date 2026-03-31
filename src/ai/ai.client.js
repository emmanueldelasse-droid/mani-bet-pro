/**
 * MANI BET PRO — ai.client.js v2
 *
 * Client IA — appelle le Worker Cloudflare qui relaie vers Anthropic API.
 * La clé API Anthropic est dans les secrets Worker — jamais dans le front.
 *
 * Respecte strictement les règles anti-hallucination.
 * Le contexte fourni est entièrement issu du moteur déterministe.
 */

import { AI_PROMPTS }     from './ai.prompts.js';
import { AIContextBuilder } from './ai.context.js';
import { AIGuard }         from './ai.guard.js';
import { ProviderCache }   from '../providers/provider.cache.js';
import { Logger }          from '../utils/utils.logger.js';

const WORKER_URL = 'https://manibetpro.emmanueldelasse.workers.dev';
const AI_ENDPOINT = `${WORKER_URL}/ai/messages`;
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 600;

// Map tâche → prompt système
const SYSTEM_PROMPTS = {
  EXPLAIN:              AI_PROMPTS.SYSTEM_EXPLAIN,
  AUDIT:                AI_PROMPTS.SYSTEM_AUDIT,
  DETECT_INCONSISTENCY: AI_PROMPTS.SYSTEM_DETECT_INCONSISTENCY,
  SCENARIO:             AI_PROMPTS.SYSTEM_SCENARIO,
  SUMMARIZE:            AI_PROMPTS.SYSTEM_EXPLAIN,
};

export class AIClient {

  /**
   * Demande une explication IA pour une analyse.
   * Cache la réponse en localStorage pour éviter les appels redondants.
   *
   * @param {AnalysisOutput} analysisOutput
   * @param {string} task — EXPLAIN | AUDIT | DETECT_INCONSISTENCY | SCENARIO
   * @param {object} matchMeta — { home, away, date, sport }
   * @returns {Promise<AIExplanation|null>}
   */
  static async explain(analysisOutput, task = 'EXPLAIN', matchMeta = {}) {
    // Vérifier le cache
    const cacheKey = `ai_expl_${analysisOutput.analysis_id}_${task}`;
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    // Construire le contexte
    const context = AIContextBuilder.build(analysisOutput, task, matchMeta);
    if (!context.is_valid) {
      Logger.warn('AI_CLIENT_INVALID_CONTEXT', { task, reason: context.reason });
      return null;
    }

    const systemPrompt = SYSTEM_PROMPTS[task] ?? AI_PROMPTS.SYSTEM_EXPLAIN;
    const userMessage  = AI_PROMPTS.buildUserMessage(task, context);

    try {
      const response = await fetch(AI_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(30000),
        body:    JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userMessage }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Worker HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawText = (data.content ?? [])
        .map(b => b.type === 'text' ? b.text : '')
        .join('\n')
        .trim();

      if (!rawText) throw new Error('Réponse IA vide');

      // Validation anti-hallucination
      const validated = AIGuard.validate(rawText, context);

      const explanation = {
        ai_explanation_id: crypto.randomUUID(),
        analysis_id:       analysisOutput.analysis_id,
        task,
        model_used:        MODEL,
        prompt_version:    AI_PROMPTS.VERSION,
        response_text:     validated.text,
        hallucination_flags: validated.flags,
        has_flags:         validated.hasFlags,
        generated_at:      new Date().toISOString(),
        tokens_used:       data.usage?.output_tokens ?? null,
      };

      // Cache permanent (une fois générée, l'explication ne change pas)
      ProviderCache.set(cacheKey, explanation, 'AI_EXPLANATION');

      Logger.info('AI_EXPLAIN_SUCCESS', {
        analysis_id: analysisOutput.analysis_id,
        task,
        tokens: explanation.tokens_used,
        has_flags: validated.hasFlags,
      });

      return explanation;

    } catch (err) {
      Logger.error('AI_EXPLAIN_FAILURE', { message: err.message, task });
      return null;
    }
  }
}
