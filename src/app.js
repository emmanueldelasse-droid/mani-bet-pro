/**
 * MANI BET PRO — app.js v3.1
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

// ── THEME ─────────────────────────────────────────────────────────────────

function initThemeToggle() {
  const saved = localStorage.getItem('mbp_theme') ?? 'dark';
  _applyTheme(saved);

  const btn = document.createElement('button');
  btn.id          = 'theme-toggle';
  btn.title       = 'Changer le thème';
  btn.textContent = saved === 'light' ? '🌙' : '☀️';
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next    = current === 'light' ? 'dark' : 'light';
    _applyTheme(next);
    localStorage.setItem('mbp_theme', next);
    btn.textContent = next === 'light' ? '🌙' : '☀️';
  });
}

function _applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.classList.remove('theme-light');
    document.body.removeAttribute('data-theme');
  }
}

// ── SETTLER POLLING ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lance un polling toutes les 5 minutes pour clôturer les paris en attente.
 * S'arrête automatiquement si plus aucun pari en attente.
 * Actif uniquement pendant les heures de matchs NBA (13h-6h UTC).
 */
function _startSettlerPolling(store) {
  let intervalId = null;

  const poll = async () => {
    // Matchs NBA entre 13h et 6h UTC (9h ET - 2h ET)
    const hourUTC    = new Date().getUTCHours();
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
        clearInterval(intervalId);
        return;
      }

      Logger.debug('SETTLER_POLL_RUN', { pending: pending.length });
      await PaperSettler.settle(store);

    } catch (err) {
      Logger.warn('SETTLER_POLL_ERROR', { message: err.message });
    }
  };

  intervalId = setInterval(poll, POLL_INTERVAL_MS);
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

  // 1. Cache
  ProviderCache.init();

  // 2. État persisté
  const persisted = _loadPersistedState();
  if (persisted) {
    store.load(persisted);
    Logger.debug('APP_STATE_LOADED', {});
  }

  // 3. Persister à chaque changement de route
  store.subscribe('currentRoute', () => _persistState());

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

  // 8. Clôture immédiate au démarrage (paris des jours passés + jour actuel)
  PaperSettler.settle(store).catch(() => {});

  // 9. Polling toutes les 5 minutes pour clôture en temps réel
  _startSettlerPolling(store);

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
