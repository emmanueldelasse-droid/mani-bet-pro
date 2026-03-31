/**
 * MANI BET PRO — utils.logger.js
 *
 * Logger centralisé.
 * Niveaux : DEBUG | INFO | WARN | ERROR
 * Persiste les logs API dans le store pour affichage UI.
 */

import { store } from '../state/store.js';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
};

// Niveau minimum affiché en console (DEBUG en dev, INFO en prod)
const MIN_LEVEL = window.location.hostname === 'localhost' ? 'DEBUG' : 'INFO';

const STYLES = {
  DEBUG: 'color: #6b7280; font-size: 11px;',
  INFO:  'color: #3b82f6;',
  WARN:  'color: #f59e0b; font-weight: bold;',
  ERROR: 'color: #ef4444; font-weight: bold;',
};

export class Logger {

  /**
   * Log de niveau INFO — événements normaux de l'application.
   * @param {string} event — identifiant de l'événement (ex: 'APP_INIT')
   * @param {object} [data] — données associées (sans données sensibles)
   */
  static info(event, data = {}) {
    this._log('INFO', event, data);
  }

  /**
   * Log de niveau DEBUG — détail de calcul ou de requête.
   */
  static debug(event, data = {}) {
    this._log('DEBUG', event, data);
  }

  /**
   * Log de niveau WARN — situation dégradée non bloquante.
   */
  static warn(event, data = {}) {
    this._log('WARN', event, data);
  }

  /**
   * Log de niveau ERROR — erreur bloquante ou inattendue.
   */
  static error(event, errorOrData = {}) {
    const data = errorOrData instanceof Error
      ? { message: errorOrData.message, stack: errorOrData.stack }
      : errorOrData;
    this._log('ERROR', event, data);
  }

  /**
   * Log spécifique aux appels API.
   * Persiste dans le store pour affichage dans l'UI (onglet Config / Audit).
   *
   * @param {object} params
   * @param {string} params.provider
   * @param {string} params.endpoint
   * @param {number} params.statusCode
   * @param {boolean} params.cached
   * @param {number|null} params.ttlRemaining
   * @param {string|null} params.error
   */
  static apiCall({ provider, endpoint, statusCode, cached, ttlRemaining = null, error = null }) {
    const logEntry = {
      log_id:        crypto.randomUUID(),
      provider,
      endpoint,
      requested_at:  new Date().toISOString(),
      status_code:   statusCode,
      cached,
      ttl_remaining: ttlRemaining,
      error,
    };

    // Persiste dans le store (limité à 100 entrées)
    store.push('apiLogs', logEntry, 100);

    const level = error ? 'WARN' : (cached ? 'DEBUG' : 'INFO');
    this._log(level, 'API_CALL', {
      provider,
      endpoint,
      status: statusCode,
      cached,
      error: error ?? undefined,
    });
  }

  /**
   * Log d'une analyse calculée par le moteur.
   */
  static engineResult({ sport, analysisId, confidenceLevel, rejectionReason }) {
    const level = confidenceLevel === 'INCONCLUSIVE' ? 'WARN' : 'INFO';
    this._log(level, 'ENGINE_RESULT', {
      sport,
      analysis_id:      analysisId,
      confidence_level: confidenceLevel,
      rejection_reason: rejectionReason ?? null,
    });
  }

  /**
   * Log d'un appel IA.
   */
  static aiCall({ analysisId, task, tokensUsed, flags = [] }) {
    this._log('INFO', 'AI_CALL', {
      analysis_id:  analysisId,
      task,
      tokens_used:  tokensUsed,
      flags_count:  flags.length,
      has_flags:    flags.length > 0,
    });
  }

  // ── PRIVÉ ──────────────────────────────────────────────────────────────

  static _log(level, event, data = {}) {
    if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

    const entry = {
      level,
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    const prefix = `[MBP/${level}] ${event}`;

    if (level === 'ERROR') {
      console.error(`%c${prefix}`, STYLES[level], data);
    } else if (level === 'WARN') {
      console.warn(`%c${prefix}`, STYLES[level], data);
    } else {
      console.log(`%c${prefix}`, STYLES[level], data);
    }

    // Stocker les erreurs dans le store
    if (level === 'ERROR') {
      store.addError({ message: `${event}: ${data.message ?? JSON.stringify(data)}` });
    }
  }

}

// Alias pour usage direct sans classe
export const log   = (event, data) => Logger.info(event, data);
export const warn  = (event, data) => Logger.warn(event, data);
export const error = (event, data) => Logger.error(event, data);
