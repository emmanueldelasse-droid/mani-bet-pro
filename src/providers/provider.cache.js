/**
 * MANI BET PRO — provider.cache.js
 *
 * Couche cache unifiée.
 * Stockage : localStorage avec TTL explicite par type.
 * Gestion quotas : compteur par provider, alertes seuils.
 * Aucune donnée fictive.
 */

import { API_CONFIG } from '../config/api.config.js';
import { Logger } from '../utils/utils.logger.js';

const CACHE_PREFIX  = 'mbp_cache_';
const QUOTA_PREFIX  = 'mbp_quota_';

export class ProviderCache {

  // ── CACHE ──────────────────────────────────────────────────────────────

  /**
   * Lire une entrée du cache.
   * Retourne null si absente ou expirée.
   * @param {string} key
   * @returns {*|null}
   */
  static get(key) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;

      const entry = JSON.parse(raw);

      if (Date.now() > entry.expires_at) {
        localStorage.removeItem(`${CACHE_PREFIX}${key}`);
        Logger.debug('CACHE_EXPIRED', { key });
        return null;
      }

      Logger.debug('CACHE_HIT', {
        key,
        ttl_remaining: Math.round((entry.expires_at - Date.now()) / 1000),
      });

      return entry.data;

    } catch (err) {
      Logger.warn('CACHE_READ_ERROR', { key, message: err.message });
      return null;
    }
  }

  /**
   * Écrire une entrée dans le cache.
   * @param {string} key
   * @param {*} data
   * @param {string} ttlType — clé de API_CONFIG.CACHE_TTL
   * @returns {boolean}
   */
  static set(key, data, ttlType) {
    try {
      const ttl = API_CONFIG.CACHE_TTL[ttlType] ?? 3600;

      // TTL = 0 → permanent (pas d'expiration)
      const expires_at = ttl === 0
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + ttl * 1000;

      const entry = {
        data,
        expires_at,
        cached_at: new Date().toISOString(),
        ttl_type: ttlType,
        ttl_seconds: ttl,
      };

      localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));

      Logger.debug('CACHE_SET', { key, ttlType, ttl_seconds: ttl });
      return true;

    } catch (err) {
      // localStorage peut être plein (quota exceeded)
      Logger.warn('CACHE_WRITE_ERROR', { key, message: err.message });
      return false;
    }
  }

  /**
   * Invalider une entrée du cache.
   * @param {string} key
   */
  static invalidate(key) {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
    Logger.debug('CACHE_INVALIDATED', { key });
  }

  /**
   * Invalider toutes les entrées d'un préfixe.
   * @param {string} prefix — ex: 'nba_matches_'
   */
  static invalidateByPrefix(prefix) {
    const fullPrefix = `${CACHE_PREFIX}${prefix}`;
    const toRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(fullPrefix)) toRemove.push(k);
    }

    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.debug('CACHE_INVALIDATED_PREFIX', { prefix, count: toRemove.length });
  }

  /**
   * Vérifier si une clé est en cache (sans lire la valeur).
   * @param {string} key
   * @returns {boolean}
   */
  static has(key) {
    return this.get(key) !== null;
  }

  /**
   * Retourne le TTL restant en secondes pour une clé.
   * @param {string} key
   * @returns {number|null}
   */
  static getTTLRemaining(key) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() > entry.expires_at) return null;
      return Math.round((entry.expires_at - Date.now()) / 1000);
    } catch {
      return null;
    }
  }

  /**
   * Nettoyer toutes les entrées expirées du cache.
   * À appeler au démarrage de l'app.
   */
  static cleanup() {
    const toRemove = [];
    let cleaned = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;

      try {
        const entry = JSON.parse(localStorage.getItem(k));
        if (Date.now() > entry.expires_at) {
          toRemove.push(k);
          cleaned++;
        }
      } catch {
        toRemove.push(k);
      }
    }

    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.info('CACHE_CLEANUP', { cleaned });
  }

  // ── QUOTAS ────────────────────────────────────────────────────────────

  /**
   * Lire le statut quota d'un provider.
   * @param {string} provider
   * @returns {{ used: number, limit: number|null, reset_at: string|null, degraded: boolean }}
   */
  static getQuota(provider) {
    try {
      const raw = localStorage.getItem(`${QUOTA_PREFIX}${provider}`);
      if (!raw) return { used: 0, limit: null, reset_at: null, degraded: false };
      return JSON.parse(raw);
    } catch {
      return { used: 0, limit: null, reset_at: null, degraded: false };
    }
  }

  /**
   * Incrémenter le compteur de quota d'un provider.
   * Déclenche des alertes si les seuils sont atteints.
   * @param {string} provider
   * @returns {{ allowed: boolean, degraded: boolean }}
   */
  static incrementQuota(provider) {
    const quota = this.getQuota(provider);
    quota.used += 1;

    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));

    if (quota.limit === null) {
      return { allowed: true, degraded: false };
    }

    const ratio = quota.used / quota.limit;

    // Alerte à 80%
    if (ratio >= API_CONFIG.QUOTA_ALERT_THRESHOLD && ratio < API_CONFIG.QUOTA_CUTOFF_THRESHOLD) {
      Logger.warn('QUOTA_ALERT', {
        provider,
        used: quota.used,
        limit: quota.limit,
        ratio: Math.round(ratio * 100),
      });
    }

    // Mode dégradé à 90%
    if (ratio >= API_CONFIG.QUOTA_CUTOFF_THRESHOLD) {
      quota.degraded = true;
      localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
      Logger.warn('QUOTA_DEGRADED_MODE', { provider, ratio: Math.round(ratio * 100) });
      return { allowed: false, degraded: true };
    }

    return { allowed: true, degraded: false };
  }

  /**
   * Définir les limites d'un provider (appelé depuis api.config ou le Worker).
   * @param {string} provider
   * @param {number} limit
   * @param {string|null} reset_at — ISO8601
   */
  static setQuotaLimit(provider, limit, reset_at = null) {
    const quota = this.getQuota(provider);
    quota.limit    = limit;
    quota.reset_at = reset_at;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
  }

  /**
   * Réinitialiser le compteur quota d'un provider (après reset périodique).
   * @param {string} provider
   */
  static resetQuota(provider) {
    const quota = this.getQuota(provider);
    quota.used     = 0;
    quota.degraded = false;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
    Logger.info('QUOTA_RESET', { provider });
  }

  /**
   * Retourne le statut de tous les providers.
   * @returns {object}
   */
  static getAllQuotas() {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(QUOTA_PREFIX)) continue;
      const provider = k.slice(QUOTA_PREFIX.length);
      result[provider] = this.getQuota(provider);
    }
    return result;
  }

  // ── CLÉS UTILITAIRES ──────────────────────────────────────────────────

  /**
   * Génère une clé de cache normalisée.
   * @param {string} provider
   * @param {string} resource
   * @param {object} [params]
   * @returns {string}
   */
  static buildKey(provider, resource, params = {}) {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return `${provider}_${resource}${paramStr ? `_${paramStr}` : ''}`;
  }
}
