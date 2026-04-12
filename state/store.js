/**
 * MANI BET PRO — store.js v2.1
 *
 * État applicatif global — vanilla JS, sans framework.
 * Pattern : store observable avec abonnements par clé.
 *
 * CORRECTIONS v2 :
 *   - set() notation pointée : vérification typeof avant de créer
 *     l'objet intermédiaire. En v1, si une clé intermédiaire était
 *     une primitive (string, number), l'assignation échouait silencieusement.
 *   - dashboardFilters.selectedDate ajouté dans INITIAL_STATE.
 *     Était lu par ui.dashboard.js mais absent de l'état initial →
 *     première lecture retournait undefined au lieu de null.
 */

const INITIAL_STATE = {

  // ── Navigation ──────────────────────────────────────────────────────────
  currentRoute:  'dashboard',
  previousRoute: null,
  selectedSport: 'NBA',

  // ── Matches ─────────────────────────────────────────────────────────────
  // { [matchId]: MatchObject }
  matches: {},

  // ── Analyses ────────────────────────────────────────────────────────────
  // { [analysisId]: AnalysisOutput }
  analyses: {},

  // ── Fiche match ─────────────────────────────────────────────────────────
  activeMatchId:    null,
  activeAnalysisId: null,

  // ── Simulations ─────────────────────────────────────────────────────────
  simulations: {},

  // ── Cache IA en mémoire ─────────────────────────────────────────────────
  // { [analysisId_task]: AIExplanation }
  aiExplanations: {},

  // ── Filtres dashboard ───────────────────────────────────────────────────
  dashboardFilters: {
    selectedDate:  null,   // CORRECTION : était absent → undefined au lieu de null
    sports:        [],
    minRobustness: null,
    status:        null,
    dateOffset:    0,
  },


  // ── Dashboard snapshot / synchronisation ───────────────────────────────
  teamDetails: {},
  injuryReport: null,
  dashboardCacheAt: null,
  refreshSync: {
    status: 'muted',
    detail: '',
    lastSuccessAt: null,
    lastWindowKey: null,
  },

  // ── Providers ───────────────────────────────────────────────────────────
  providerStatus: {},
  quotas:         {},

  // ── Logs API ────────────────────────────────────────────────────────────
  apiLogs: [],
  appLogs: [],
  aiLogs: [],

  // ── UI ───────────────────────────────────────────────────────────────────
  ui: {
    isLoading:   false,
    loaderText:  '',
    toasts:      [],
    modalOpen:   false,
    modalContent: null,
    displayMode: 'analyst',   // 'synthesis' | 'analyst' | 'lab'
    sidebarOpen: false,
  },

  // ── Historique des analyses ──────────────────────────────────────────────
  history: [],

  // ── Paper Trading ────────────────────────────────────────────────────────
  paperTradingVersion: 0,

  // ── Erreurs globales ─────────────────────────────────────────────────────
  errors: [],
};

class Store {

  constructor() {
    this._state       = this._deepClone(INITIAL_STATE);
    this._subscribers = {};
    this._globalSubs  = new Set();
  }

  // ── LECTURE ────────────────────────────────────────────────────────────

  /**
   * Lire une valeur. Supporte la notation pointée : get('ui.isLoading')
   */
  get(key) {
    if (!key) return this._deepClone(this._state);
    return key.split('.').reduce((obj, k) => obj?.[k], this._state);
  }

  getState() {
    return this._deepClone(this._state);
  }

  // ── ÉCRITURE ───────────────────────────────────────────────────────────

  /**
   * Mettre à jour une ou plusieurs clés.
   *
   * CORRECTION : vérification typeof avant création objet intermédiaire.
   * En v1, si obj[keys[i]] était une string ou un number, l'opération
   * obj = obj[keys[i]] retournait une primitive et l'assignation
   * suivante échouait silencieusement (JS non-strict) ou levait une
   * TypeError (strict mode).
   */
  set(updates) {
    const changedKeys = new Set();

    for (const [path, value] of Object.entries(updates)) {
      const keys = path.split('.');
      let obj    = this._state;

      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        // CORRECTION : s'assurer que la clé intermédiaire est bien un objet
        if (typeof obj[k] !== 'object' || obj[k] === null) {
          obj[k] = {};
        }
        obj = obj[k];
      }

      const lastKey = keys[keys.length - 1];
      obj[lastKey]  = value;
      changedKeys.add(keys[0]);
      changedKeys.add(path);
    }

    this._notify(changedKeys);
  }

  merge(key, partial) {
    const current = this.get(key);
    if (typeof current !== 'object' || current === null) {
      this.set({ [key]: partial });
    } else {
      this.set({ [key]: { ...current, ...partial } });
    }
  }

  push(key, item, maxLength = null) {
    const current = this.get(key) ?? [];
    const updated = [...current, item];
    this.set({ [key]: maxLength ? updated.slice(-maxLength) : updated });
  }

  upsert(key, id, item) {
    const current = this.get(key) ?? {};
    this.set({ [key]: { ...current, [id]: item } });
  }

  remove(key, id) {
    const current = this.get(key) ?? {};
    const updated = { ...current };
    delete updated[id];
    this.set({ [key]: updated });
  }

  // ── ABONNEMENTS ────────────────────────────────────────────────────────

  subscribe(key, callback) {
    if (!this._subscribers[key]) {
      this._subscribers[key] = new Set();
    }
    this._subscribers[key].add(callback);
    return () => this._subscribers[key]?.delete(callback);
  }

  subscribeAll(callback) {
    this._globalSubs.add(callback);
    return () => this._globalSubs.delete(callback);
  }

  // ── PERSISTENCE ────────────────────────────────────────────────────────

  /**
   * Charge l'état persisté depuis localStorage.
   * Ne charge que les clés autorisées.
   */
  load(persisted) {
    if (!persisted || typeof persisted !== 'object') return;

    const PERSISTABLE_KEYS = [
      'ui.displayMode',
      'selectedSport',
      'history',
      'dashboardFilters',
      'matches',
      'analyses',
      'teamDetails',
      'injuryReport',
      'dashboardCacheAt',
      'refreshSync',
    ];

    for (const key of PERSISTABLE_KEYS) {
      const value = key.split('.').reduce((obj, k) => obj?.[k], persisted);
      if (value !== undefined) {
        this.set({ [key]: value });
      }
    }
  }

  // ── HELPERS UI ─────────────────────────────────────────────────────────

  setLoading(isLoading, text = '') {
    this.set({
      'ui.isLoading': isLoading,
      'ui.loaderText': text,
    });
  }

  setRoute(route) {
    this.set({
      previousRoute: this.get('currentRoute'),
      currentRoute:  route,
    });
  }

  addError(error) {
    this.push('errors', {
      id:        crypto.randomUUID(),
      message:   error.message ?? String(error),
      timestamp: new Date().toISOString(),
    }, 50);
  }

  // ── PRIVÉ ──────────────────────────────────────────────────────────────

  _notify(changedKeys) {
    for (const key of changedKeys) {
      const subs = this._subscribers[key];
      if (subs) {
        const value = this.get(key);
        subs.forEach(cb => {
          try { cb(value, key); }
          catch (err) { console.error('[Store] Subscriber error:', err); }
        });
      }
    }

    if (this._globalSubs.size > 0) {
      const state = this.getState();
      this._globalSubs.forEach(cb => {
        try { cb(changedKeys, state); }
        catch (err) { console.error('[Store] Global subscriber error:', err); }
      });
    }
  }

  _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try { return JSON.parse(JSON.stringify(obj)); }
    catch { return obj; }
  }
}

// Export singleton
export const store = new Store();

// Charger l'état persisté au démarrage
try {
  const saved = localStorage.getItem('mbp_state');
  if (saved) store.load(JSON.parse(saved));
} catch {}

// Persister history à chaque changement
// Note : app.js._persistState() merge l'état existant — pas de conflit.
store.subscribe('history', (history) => {
  try {
    const saved = JSON.parse(localStorage.getItem('mbp_state') ?? '{}');
    localStorage.setItem('mbp_state', JSON.stringify({ ...saved, history }));
  } catch {}
});
