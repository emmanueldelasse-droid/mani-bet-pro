/**
 * MANI BET PRO — provider.cache.js v2
 *
 * Cache localStorage avec TTL et version tag.
 *
 * CORRECTIONS v2 :
 *   - set() : rejette aussi les tableaux vides [] et objets vides {}
 *     (la règle "jamais de donnée vide en cache" n'était appliquée
 *     que pour null/undefined — les structures vides passaient)
 *   - setWithTTL() : nouvelle méthode acceptant un TTL en secondes
 *     directement. Permet à provider.nba.js d'utiliser le TTL adaptatif
 *     retourné par le Worker (The Odds API) au lieu du TTL statique.
 */

import { API_CONFIG } from '../config/api.config.js';
import { Logger }     from '../utils/utils.logger.js';

const CACHE_PREFIX  = 'mbp_cache_';
const QUOTA_PREFIX  = 'mbp_quota_';
const CACHE_VERSION = 'v5';
const VERSION_KEY   = 'mbp_cache_version';

export class ProviderCache {

  /**
   * À appeler au démarrage.
   * Purge si version changée, nettoie les expirés.
   */
  static init() {
    this._purgeIfVersionChanged();
    this._cleanupExpired();
  }

  // ── LECTURE ────────────────────────────────────────────────────────────

  /**
   * @param {string} key
   * @returns {*|null} — null si absent, expiré ou vide
   */
  static get(key) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;

      const entry = JSON.parse(raw);

      if (Date.now() > entry.expires_at) {
        localStorage.removeItem(`${CACHE_PREFIX}${key}`);
        return null;
      }

      return entry.data;

    } catch {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
  }

  // ── ÉCRITURE ───────────────────────────────────────────────────────────

  /**
   * Écriture avec TTL depuis api.config.js (clé ttlType).
   *
   * CORRECTION : rejette null, undefined, [], {} — aucune structure
   * vide ne doit être mise en cache.
   *
   * @param {string} key
   * @param {*} data
   * @param {string} ttlType — clé de API_CONFIG.CACHE_TTL
   * @returns {boolean}
   */
  static set(key, data, ttlType) {
    if (!this._isValidData(data)) return false;

    try {
      const ttl = API_CONFIG.CACHE_TTL[ttlType] ?? 3600;
      return this._write(key, data, ttl, ttlType);
    } catch (err) {
      Logger.warn('CACHE_WRITE_ERROR', { key, message: err.message });
      return false;
    }
  }

  /**
   * Écriture avec TTL dynamique en secondes.
   * Utilisé par provider.nba.js pour les cotes The Odds API dont
   * le TTL est retourné par le Worker (adaptatif selon l'heure).
   *
   * @param {string} key
   * @param {*} data
   * @param {number} ttlSeconds
   * @returns {boolean}
   */
  static setWithTTL(key, data, ttlSeconds) {
    if (!this._isValidData(data)) return false;
    if (!ttlSeconds || ttlSeconds <= 0) return false;

    try {
      return this._write(key, data, ttlSeconds, 'DYNAMIC');
    } catch (err) {
      Logger.warn('CACHE_WRITE_ERROR', { key, message: err.message });
      return false;
    }
  }

  // ── INVALIDATION ───────────────────────────────────────────────────────

  static invalidate(key) {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  }

  static invalidateByPrefix(prefix) {
    const fullPrefix = `${CACHE_PREFIX}${prefix}`;
    const toRemove   = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(fullPrefix)) toRemove.push(k);
    }

    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.debug('CACHE_INVALIDATED_PREFIX', { prefix, count: toRemove.length });
  }

  static invalidateAll() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    Logger.info('CACHE_INVALIDATED_ALL', { count: toRemove.length });
  }

  // ── UTILITAIRES ────────────────────────────────────────────────────────

  static has(key) {
    return this.get(key) !== null;
  }

  static buildKey(provider, resource, params = {}) {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return `${provider}_${resource}${paramStr ? `_${paramStr}` : ''}`;
  }

  // ── QUOTAS ────────────────────────────────────────────────────────────

  static getQuota(provider) {
    try {
      const raw = localStorage.getItem(`${QUOTA_PREFIX}${provider}`);
      if (!raw) return { used: 0, limit: null, reset_at: null, degraded: false };
      return JSON.parse(raw);
    } catch {
      return { used: 0, limit: null, reset_at: null, degraded: false };
    }
  }

  static incrementQuota(provider) {
    const quota = this.getQuota(provider);
    quota.used += 1;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));

    if (quota.limit === null) return { allowed: true, degraded: false };

    const ratio = quota.used / quota.limit;

    if (ratio >= API_CONFIG.QUOTA_CUTOFF_THRESHOLD) {
      quota.degraded = true;
      localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
      Logger.warn('QUOTA_DEGRADED_MODE', { provider, ratio: Math.round(ratio * 100) });
      return { allowed: false, degraded: true };
    }

    if (ratio >= API_CONFIG.QUOTA_ALERT_THRESHOLD) {
      Logger.warn('QUOTA_ALERT', { provider, used: quota.used, limit: quota.limit });
    }

    return { allowed: true, degraded: false };
  }

  static resetQuota(provider) {
    const quota    = this.getQuota(provider);
    quota.used     = 0;
    quota.degraded = false;
    localStorage.setItem(`${QUOTA_PREFIX}${provider}`, JSON.stringify(quota));
  }

  // ── PRIVÉ ─────────────────────────────────────────────────────────────

  /**
   * Vérifie qu'une donnée est non vide avant mise en cache.
   * Rejette : null, undefined, [] (tableau vide), {} (objet vide).
   */
  static _isValidData(data) {
    if (data === null || data === undefined) return false;
    if (Array.isArray(data) && data.length === 0) return false;
    if (
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Object.keys(data).length === 0
    ) return false;
    return true;
  }

  /** Écrit une entrée dans localStorage. */
  static _write(key, data, ttlSeconds, ttlType) {
    const expires_at = ttlSeconds === 0
      ? Number.MAX_SAFE_INTEGER
      : Date.now() + ttlSeconds * 1000;

    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
      data,
      expires_at,
      cached_at: new Date().toISOString(),
      ttl_type:  ttlType,
      version:   CACHE_VERSION,
    }));

    return true;
  }

  static _purgeIfVersionChanged() {
    const stored = localStorage.getItem(VERSION_KEY);
    if (stored !== CACHE_VERSION) {
      this.invalidateAll();
      localStorage.setItem(VERSION_KEY, CACHE_VERSION);
      Logger.info('CACHE_VERSION_PURGE', { from: stored, to: CACHE_VERSION });
    }
  }

  static _cleanupExpired() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(k));
        if (Date.now() > entry.expires_at) toRemove.push(k);
      } catch {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    if (toRemove.length > 0) {
      Logger.debug('CACHE_CLEANUP', { cleaned: toRemove.length });
    }
  }
}
