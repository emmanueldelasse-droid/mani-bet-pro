/**
 * MANI BET PRO — app.js v3.4
 *
 * CORRECTIONS v3.4 :
 *   - _startSettlerPolling() appelle poll() immédiatement avant de lancer l'interval.
 *     En v3.3, PaperSettler.settle() était appelé séparément (ligne ~224) puis
 *     _startSettlerPolling() lançait un 2ème appel via setInterval — deux fetches
 *     simultanés au boot. L'appel séparé est supprimé.
 *   - store.js v2.2 : subscriber 'history' dédié supprimé (race condition avec
 *     _persistState()). app.js reste seul responsable du cycle persist/restore.
 *
 * CORRECTIONS v3.2 :
 *   - _pollerActive flag : évite les intervals multiples
 *   - Redémarrage automatique du polling si nouveaux paris après arrêt
 *
 * AJOUTS v3.1 :
 *   - _startSettlerPolling() : clôture automatique des paris toutes les 5 minutes
 *     pendant les heures de matchs NBA (13h-6h UTC = 9h-2h ET).
 *     S'arrête automatiquement quand plus aucun pari en attente.
 *
 * AJOUTS v3 :
 *   - initThemeToggle() : bouton ☀️/🌙 thème clair/sombre.
 *
 * CORRECTIONS v2 :
 *   - persistState() merge au lieu d'écraser.
 */

import { store }         from './state/store.js';
import { router }        from './ui/ui.router.js';
import { ProviderCache } from './providers/provider.cache.js';
import { PaperSettler }  from './paper/paper.settler.js';
import { PaperEngine }   from './paper/paper.engine.js';
import { Logger }        from './utils/utils.logger.js';
import { APP_CONFIG }    from './config/sports.config.js';
import { initThemeToggle } from './ui/ui.theme-toggle.js';

// ── SETTLER POLLING ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Flag global — évite de lancer plusieurs intervals en parallèle
let _pollerActive = false;
let _pollerIntervalId = null;

/**
 * Lance un polling toutes les 5 minutes pour clôturer les paris en attente.
 * S'arrête automatiquement si plus aucun pari en attente.
 * Redémarre automatiquement si de nouveaux paris sont placés.
 * Actif uniquement pendant les heures de matchs NBA (13h-6h UTC).
 */
function _startSettlerPolling(store) {
  if (_pollerActive) return; // déjà actif
  _pollerActive = true;

  const poll = async () => {
    // Matchs NBA entre 13h et 6h UTC (9h ET - 2h ET)
    const hourUTC     = new Date().getUTCHours();
    const isMatchTime = hourUTC >= 13 || hourUTC < 6;

    if (!isMatchTime) {
      Logger.debug('SETTLER_POLL_SKIP', { reason: 'hors heures matchs', hourUTC });
      return;
    }

    try {
      const state   = await PaperEngine.loadAsync();
      const pending = state.bets.filter(b => b.result === 'PENDING');

      if (pending.length === 0) {
        Logger.info('SETTLER_POLL_STOP', { reason: 'aucun pari en attente' });
        clearInterval(_pollerIntervalId);
        _pollerActive = false;
        return;
      }

      Logger.debug('SETTLER_POLL_RUN', { pending: pending.length });
      await PaperSettler.settle(store);

    } catch (err) {
      Logger.warn('SETTLER_POLL_ERROR', { message: err.message });
    }
  };

  // Déclencher immédiatement au démarrage (couvre paris des jours passés + jour actuel),
  // puis toutes les 5 minutes. Évite le double appel settler qui existait en v3.3
  // (PaperSettler.settle() séparé + premier cycle polling = 2 fetches simultanés au boot).
  poll();
  _pollerIntervalId = setInterval(poll, POLL_INTERVAL_MS);
  Logger.info('SETTLER_POLL_START', { interval_min: 5 });
}

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

function _persistState() {
  try {
    const state   = store.getState();
    const current = JSON.parse(localStorage.getItem('mbp_state') ?? '{}');

    localStorage.setItem('mbp_state', JSON.stringify({
      ...current,
      selectedSport: state.selectedSport,
      dashboardFilters: state.dashboardFilters,
      matches: state.matches,
      analyses: state.analyses,
      teamDetails: state.teamDetails,
      injuryReport: state.injuryReport,
      recentForms: state.recentForms,
      dashboardCacheAt: state.dashboardCacheAt,
      refreshSync: state.refreshSync,
      ui: {
        ...(current.ui ?? {}),
        displayMode: state.ui?.displayMode,
      },
      history: state.history,
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

  // 1. Cache
  ProviderCache.init();

  // 2. État persisté
  const persisted = _loadPersistedState();
  if (persisted) {
    store.load(persisted);
    Logger.debug('APP_STATE_LOADED', {});
  }

  // 3. Persistance ciblée + debounce léger
  let persistTimer = null;
  const schedulePersist = function() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function() { _persistState(); }, 120);
  };

  [
    'currentRoute',
    'selectedSport',
    'dashboardFilters',
    'matches',
    'analyses',
    'teamDetails',
    'injuryReport',
    'recentForms',
    'dashboardCacheAt',
    'refreshSync',
    'history',
    'ui.displayMode',
  ].forEach(function(key) {
    store.subscribe(key, schedulePersist);
  });

  // 4. Persister avant fermeture
  window.addEventListener('beforeunload', () => _persistState());

  // 5. Erreurs globales
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

  // 7. Thème
  initThemeToggle();

  // 8. Settler + polling — premier cycle immédiat au boot, puis toutes les 5 min.
  //    (Le settle() immédiat séparé de v3.3 est supprimé — _startSettlerPolling
  //     appelle poll() directement avant de lancer l'interval.)
  _startSettlerPolling(store);

  // 9. Redémarrer le polling si de nouveaux paris sont placés après arrêt
  store.subscribe('paperTradingVersion', () => _startSettlerPolling(store));

  Logger.info('APP_INIT_DONE', { version: APP_CONFIG.VERSION });
}

// ── LANCEMENT ────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── DEBUG ─────────────────────────────────────────────────────────────────
window.MBP = {
  store,
  router,
  showToast,
  setGlobalLoader,
  version: APP_CONFIG.VERSION,
};
