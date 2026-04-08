/**
 * MANI BET PRO — ui.router.js
 *
 * Router SPA vanilla JS.
 * Gère la navigation entre les vues principales.
 * Injecte le rendu dans #view-container.
 * Synchronise l'état actif de la nav bar.
 */

import { store } from '../state/store.js';
import { Logger } from '../utils/utils.logger.js';

// ── VUES DISPONIBLES ────────────────────────────────────────────────────────
// Importées dynamiquement pour réduire le chargement initial.
// Chaque vue est un module qui exporte une fonction render(container, store).

const ROUTES = {
  dashboard: {
    label: 'Dashboard',
    loader: () => import('./ui.dashboard.js'),
  },
  match: {
    label: 'Analyse Match',
    loader: () => import('./ui.match-detail.js'),
  },
  history: {
    label: 'Historique',
    loader: () => import('./ui.history.js'),
  },
  lab: {
    label: 'Laboratoire',
    loader: () => import('./ui.lab.js'),
  },
  settings: {
    label: 'Configuration',
    loader: () => import('./ui.settings.js'),
  },
};

// Routes accessibles depuis la nav bar (ordre affiché)
const NAV_ROUTES = ['dashboard', 'history', 'lab', 'settings'];

class Router {

  constructor() {
    this._container   = null;
    this._navLinks    = null;
    this._currentView = null;
    this._store       = null;
    // v1.1 : cache DOM — navigation dashboard + history instantanée
    this._viewCache     = {};
    this._CACHED_ROUTES = new Set(['dashboard', 'history']);
  }

  /**
   * Initialise le router.
   * @param {Store} storeInstance
   */
  init(storeInstance) {
    this._store     = storeInstance;
    this._container = document.getElementById('view-container');
    this._navLinks  = document.getElementById('nav-links');

    if (!this._container) {
      Logger.error('ROUTER_INIT', { message: '#view-container introuvable' });
      return;
    }

    this._bindNavEvents();
    this._bindPopState();

    // Écouter les changements de route dans le store
    this._store.subscribe('currentRoute', (route) => {
      this._renderRoute(route);
      this._updateNavActive(route);
    });

    // Route initiale — toujours dashboard au démarrage
    this.navigate('dashboard', { replace: true });

    Logger.info('ROUTER_INIT', { initialRoute: 'dashboard' });
  }

  /**
   * Naviguer vers une route.
   * @param {string} route
   * @param {object} [params] — paramètres optionnels (ex: { matchId })
   * @param {object} [options]
   * @param {boolean} [options.replace] — remplace l'entrée history
   */
  navigate(route, params = {}, options = {}) {
    if (!ROUTES[route]) {
      Logger.warn('ROUTER_NAVIGATE', { message: `Route inconnue : ${route}` });
      return;
    }

    // Stocker les params dans le store si fournis
    if (params.matchId) {
      this._store.set({ activeMatchId: params.matchId });
    }
    if (params.analysisId) {
      this._store.set({ activeAnalysisId: params.analysisId });
    }

    // Mettre à jour le hash pour permettre le back/forward
    const hash = `#${route}`;
    if (options.replace) {
      window.history.replaceState({ route, params }, '', hash);
    } else {
      window.history.pushState({ route, params }, '', hash);
    }

    this._store.setRoute(route);
  }

  // ── RENDU ─────────────────────────────────────────────────────────────

  async _renderRoute(route) {
    const routeConfig = ROUTES[route];
    if (!routeConfig) {
      this._renderNotFound(route);
      return;
    }

    this._showLoader();

    try {
      const module = await routeConfig.loader();

      if (typeof module.render !== 'function') {
        throw new Error(`La vue "${route}" n'exporte pas de fonction render()`);
      }

      // v1.1 : si la vue précédente est cacheable, on cache son DOM au lieu de le détruire
      const prevRoute = this._store.get('previousRoute');
      if (prevRoute && this._CACHED_ROUTES.has(prevRoute) && this._viewCache[prevRoute]) {
        this._viewCache[prevRoute].el.style.display = 'none';
      } else if (this._currentView?.destroy) {
        this._currentView.destroy();
      }

      // v1.1 : si la route cible est en cache DOM → afficher instantanément
      if (this._CACHED_ROUTES.has(route) && this._viewCache[route]) {
        this._viewCache[route].el.style.display = '';
        this._currentView = this._viewCache[route].view;
        this._hideLoader();
        return;
      }

      // Sinon : créer la vue normalement
      this._container.innerHTML = '';
      const viewEl = document.createElement('div');
      viewEl.style.cssText = 'width:100%;height:100%';
      this._container.appendChild(viewEl);

      const view = await module.render(viewEl, this._store);
      this._currentView = view;

      // Mettre en cache si la route est cacheable
      if (this._CACHED_ROUTES.has(route)) {
        this._viewCache[route] = { el: viewEl, view };
      }

    } catch (err) {
      // Vue non encore créée — afficher un placeholder
      if (err.message?.includes("Failed to fetch") || err.message?.includes("Cannot find module")) {
        this._renderPlaceholder(route, routeConfig.label);
      } else {
        Logger.error('ROUTER_RENDER', { route, message: err.message });
        this._renderError(route, err);
      }
    } finally {
      this._hideLoader();
    }
  }

  // ── PLACEHOLDERS (vues non encore développées) ─────────────────────────

  _renderPlaceholder(route, label) {
    const icons = {
      dashboard: '◉',
      match:     '▦',
      history:   '◎',
      lab:       '⬡',
      settings:  '⚙',
    };

    this._container.innerHTML = `
      <div class="view-placeholder">
        <div class="view-placeholder__icon">${icons[route] ?? '◌'}</div>
        <div class="view-placeholder__title">${label}</div>
        <div class="view-placeholder__sub">
          Cette vue sera disponible dans la prochaine phase de développement.
        </div>
      </div>
    `;
  }

  _renderNotFound(route) {
    this._container.innerHTML = `
      <div class="view-placeholder">
        <div class="view-placeholder__icon">✕</div>
        <div class="view-placeholder__title">Route introuvable</div>
        <div class="view-placeholder__sub">
          La route "<code>${route}</code>" n'existe pas.
        </div>
      </div>
    `;
  }

  _renderError(route, err) {
    this._container.innerHTML = `
      <div class="view-placeholder">
        <div class="view-placeholder__icon">⚠</div>
        <div class="view-placeholder__title">Erreur de chargement</div>
        <div class="view-placeholder__sub">
          ${err.message ?? 'Erreur inattendue lors du chargement de la vue.'}
        </div>
      </div>
    `;
  }

  // ── NAVIGATION BAR ────────────────────────────────────────────────────

  _bindNavEvents() {
    if (!this._navLinks) return;

    this._navLinks.querySelectorAll('.nav__item[data-route]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const route = btn.dataset.route;
        if (route) this.navigate(route);
      });
    });
  }

  _updateNavActive(route) {
    if (!this._navLinks) return;

    this._navLinks.querySelectorAll('.nav__item').forEach(btn => {
      const btnRoute = btn.dataset.route;
      btn.classList.toggle('active', btnRoute === route);
    });
  }

  // ── HISTORIQUE NAVIGATEUR ─────────────────────────────────────────────

  _bindPopState() {
    window.addEventListener('popstate', (e) => {
      const route = e.state?.route ?? this._getRouteFromHash() ?? 'dashboard';
      this._store.setRoute(route);
    });
  }

  _getRouteFromHash() {
    const hash = window.location.hash?.slice(1);
    return ROUTES[hash] ? hash : null;
  }

  // ── LOADER GLOBAL ────────────────────────────────────────────────────

  _showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('hidden');
  }

  _hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('hidden');
  }

}

export const router = new Router();
