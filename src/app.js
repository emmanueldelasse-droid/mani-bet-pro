/**
 * MANI BET PRO — app.js
 *
 * Point d'entrée principal.
 * Initialise le store, le router, le storage.
 * Aucune donnée fictive. Aucune valeur inventée.
 *
 * Version  : 0.1.0
 * Phase    : 0 — Fondations
 */

import { store }  from './state/store.js';
import { router } from './ui/ui.router.js';
import { ProviderCache }  from './providers/provider.cache.js';
import { PaperSettler }  from './paper/paper.settler.js';
import { Logger }         from './utils/utils.logger.js';
import { APP_CONFIG }     from './config/sports.config.js';

// ── STORAGE LOCAL ─────────────────────────────────────────────────────────

/**
 * Charge l'état persisté depuis localStorage.
 * Ne charge que les clés autorisées (voir store.load).
 * @returns {object|null}
 */
function loadPersistedState() {
  try {
    const raw = localStorage.getItem('mbp_state');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    Logger.warn('STORAGE_LOAD_FAIL', { message: err.message });
    return null;
  }
}

/**
 * Persiste les clés autorisées de l'état dans localStorage.
 * Appelé sur changement de route et avant fermeture de page.
 */
function persistState() {
  try {
    const state = store.getState();
    const toPersist = {
      dashboardFilters: state.dashboardFilters,
      ui: {
        displayMode: state.ui?.displayMode,
      },
    };
    localStorage.setItem('mbp_state', JSON.stringify(toPersist));
  } catch (err) {
    Logger.warn('STORAGE_PERSIST_FAIL', { message: err.message });
  }
}

// ── TOAST MANAGER ────────────────────────────────────────────────────────

/**
 * Affiche un toast de notification.
 * @param {string} message
 * @param {'success'|'warning'|'error'|'info'} type
 * @param {number} duration — ms
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ── LOADER GLOBAL ────────────────────────────────────────────────────────

export function setGlobalLoader(visible, text = '') {
  const loader   = document.getElementById('global-loader');
  const loaderTxt = document.getElementById('loader-text');

  if (!loader) return;

  if (visible) {
    loader.classList.remove('hidden');
    if (loaderTxt) loaderTxt.textContent = text || 'Chargement…';
  } else {
    loader.classList.add('hidden');
  }

  store.setLoading(visible, text);
}

// ── INITIALISATION ────────────────────────────────────────────────────────

async function init() {
  Logger.info('APP_INIT_START', {
    version:    APP_CONFIG.VERSION,
    name:       APP_CONFIG.NAME,
    userAgent:  navigator.userAgent,
    timestamp:  new Date().toISOString(),
  });

  // 1. Initialiser le cache (purge si nouvelle version, nettoyage expirés)
  ProviderCache.init();

  // 2. Charger l'état persisté
  const persisted = loadPersistedState();
  if (persisted) {
    store.load(persisted);
    Logger.debug('APP_STATE_LOADED', {});
  }

  // 2. Persister l'état sur changement de route
  store.subscribe('currentRoute', () => persistState());

  // 3. Persister avant fermeture de page
  window.addEventListener('beforeunload', () => persistState());

  // 4. Écouter les erreurs globales non capturées
  window.addEventListener('error', (e) => {
    Logger.error('UNCAUGHT_ERROR', {
      message:  e.message,
      filename: e.filename,
      lineno:   e.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    Logger.error('UNHANDLED_REJECTION', {
      reason: e.reason?.message ?? String(e.reason),
    });
  });

  // 5. Initialiser le router
  router.init(store);

  // 6. Clôturer automatiquement les paris en attente (async, non bloquant)
  PaperSettler.settle(store).catch(() => {});

  Logger.info('APP_INIT_DONE', {
    version: APP_CONFIG.VERSION,
  });
}

// ── LANCEMENT ────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── EXPORTS GLOBAUX ───────────────────────────────────────────────────────
// Exposé sur window pour usage depuis les vues si nécessaire
window.MBP = {
  store,
  router,
  showToast,
  setGlobalLoader,
  version: APP_CONFIG.VERSION,
};
