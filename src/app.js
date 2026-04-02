/**
 * MANI BET PRO — app.js v2
 *
 * Point d'entrée principal.
 * Initialise le store, le router, le cache, le paper settler.
 *
 * CORRECTIONS v2 :
 *   - persistState() merge l'état existant au lieu de l'écraser.
 *     En v1, une navigation déclenchait un écrasement de mbp_state
 *     qui effaçait le champ 'history' persisté par la subscription
 *     store.subscribe('history') de store.js → race condition.
 *   - window.MBP commenté comme debug uniquement.
 */

import { store }         from './state/store.js';
import { router }        from './ui/ui.router.js';
import { ProviderCache } from './providers/provider.cache.js';
import { PaperSettler }  from './paper/paper.settler.js';
import { Logger }        from './utils/utils.logger.js';
import { APP_CONFIG }    from './config/sports.config.js';

// ── PERSISTENCE ───────────────────────────────────────────────────────────

function _loadPersistedState() {
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
 * Persiste les clés autorisées dans localStorage.
 *
 * CORRECTION : merge avec l'état existant au lieu d'écraser.
 * Sans merge, une navigation effaçait le champ 'history' que
 * store.subscribe('history') venait de persister.
 */
function _persistState() {
  try {
    const state   = store.getState();
    const current = JSON.parse(localStorage.getItem('mbp_state') ?? '{}');

    localStorage.setItem('mbp_state', JSON.stringify({
      ...current,                              // préserve history + autres champs persistés
      dashboardFilters: state.dashboardFilters,
      ui: {
        ...(current.ui ?? {}),
        displayMode: state.ui?.displayMode,
      },
    }));
  } catch (err) {
    Logger.warn('STORAGE_PERSIST_FAIL', { message: err.message });
  }
}

// ── TOAST ─────────────────────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ── LOADER GLOBAL ─────────────────────────────────────────────────────────

export function setGlobalLoader(visible, text = '') {
  const loader    = document.getElementById('global-loader');
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
    version:   APP_CONFIG.VERSION,
    name:      APP_CONFIG.NAME,
    timestamp: new Date().toISOString(),
  });

  // 1. Cache — purge si nouvelle version, nettoyage des expirés
  ProviderCache.init();

  // 2. Charger l'état persisté (dashboardFilters, displayMode, history)
  const persisted = _loadPersistedState();
  if (persisted) {
    store.load(persisted);
    Logger.debug('APP_STATE_LOADED', {});
  }

  // 3. Persister à chaque changement de route (merge, pas écrasement)
  store.subscribe('currentRoute', () => _persistState());

  // 4. Persister avant fermeture de page
  window.addEventListener('beforeunload', () => _persistState());

  // 5. Erreurs globales non capturées
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

  // 6. Router
  router.init(store);

  // 7. Clôture automatique des paris en attente (async, non bloquant)
  PaperSettler.settle(store).catch(() => {});

  Logger.info('APP_INIT_DONE', { version: APP_CONFIG.VERSION });
}

// ── LANCEMENT ────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── DEBUG — à retirer en production multi-utilisateur ────────────────────
// Exposé sur window pour inspection dans la console DevTools uniquement.
window.MBP = {
  store,
  router,
  showToast,
  setGlobalLoader,
  version: APP_CONFIG.VERSION,
};
