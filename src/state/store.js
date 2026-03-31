/**
 * MANI BET PRO — store.js
 *
 * État applicatif global — vanilla JS, sans framework.
 * Pattern : store observable avec abonnements par clé.
 * Aucune donnée fictive. État initial entièrement vide / null.
 */

const INITIAL_STATE = {

  // ── Navigation ──────────────────────────────────────────────────────────
  currentRoute: 'dashboard',
  previousRoute: null,

  // ── Matches chargés ─────────────────────────────────────────────────────
  // Structure : { [matchId]: MatchObject }
  matches: {},

  // ── Analyses calculées ──────────────────────────────────────────────────
  // Structure : { [analysisId]: AnalysisOutput }
  analyses: {},

  // ── Match actuellement affiché en fiche détail ──────────────────────────
  activeMatchId: null,

  // ── Analyse active (fiche match) ────────────────────────────────────────
  activeAnalysisId: null,

  // ── Simulations en cours ────────────────────────────────────────────────
  // Structure : { [simulationId]: SimulationSnapshot }
  simulations: {},

  // ── Explications IA en cache mémoire ────────────────────────────────────
  // Structure : { [analysisId_task]: AIExplanation }
  aiExplanations: {},

  // ── Filtres dashboard ───────────────────────────────────────────────────
  dashboardFilters: {
    sports:          [],      // [] = tous les sports activés
    minRobustness:   null,    // Seuil minimum robustesse (null = pas de filtre)
    status:          null,    // 'CONCLUANT' | 'INCONCLUS' | 'REJETE' | null
    dateOffset:      0,       // 0 = aujourd'hui, 1 = demain, -1 = hier
  },

  // ── État des providers API ───────────────────────────────────────────────
  // Structure : { [providerName]: ProviderStatus }
  providerStatus: {},

  // ── Quotas API ──────────────────────────────────────────────────────────
  // Structure : { [providerName]: { used, limit, reset_at } }
  quotas: {},

  // ── Logs API ────────────────────────────────────────────────────────────
  apiLogs: [],   // Tableau des derniers logs (limité à 100 entrées en mémoire)

  // ── UI State ─────────────────────────────────────────────────────────────
  ui: {
    isLoading:       false,
    loaderText:      '',
    toasts:          [],
    modalOpen:       false,
    modalContent:    null,
    displayMode:     'analyst',   // 'synthesis' | 'analyst' | 'lab'
    sidebarOpen:     false,
  },

  // ── Erreurs globales ─────────────────────────────────────────────────────
  errors: [],

};

class Store {

  constructor() {
    this._state = this._deepClone(INITIAL_STATE);
    this._subscribers = {};   // { [key]: Set<callback> }
    this._globalSubs = new Set();
  }

  // ── LECTURE ────────────────────────────────────────────────────────────

  /**
   * Lire une valeur de l'état.
   * Supporte la notation pointée : get('ui.isLoading')
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    if (!key) return this._deepClone(this._state);
    return key.split('.').reduce((obj, k) => obj?.[k], this._state);
  }

  /**
   * Retourne une copie complète de l'état (lecture seule).
   * @returns {object}
   */
  getState() {
    return this._deepClone(this._state);
  }

  // ── ÉCRITURE ───────────────────────────────────────────────────────────

  /**
   * Mettre à jour une ou plusieurs clés de l'état.
   * Déclenche les abonnements correspondants.
   * @param {object} updates — { key: value } ou notation pointée
   */
  set(updates) {
    const changedKeys = new Set();

    for (const [path, value] of Object.entries(updates)) {
      const keys = path.split('.');
      let obj = this._state;

      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined || obj[keys[i]] === null) {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
      }

      const lastKey = keys[keys.length - 1];
      obj[lastKey] = value;
      changedKeys.add(keys[0]);
      changedKeys.add(path);
    }

    this._notify(changedKeys);
  }

  /**
   * Merger un objet dans une clé existante.
   * @param {string} key
   * @param {object} partial
   */
  merge(key, partial) {
    const current = this.get(key);
    if (typeof current !== 'object' || current === null) {
      this.set({ [key]: partial });
    } else {
      this.set({ [key]: { ...current, ...partial } });
    }
  }

  /**
   * Ajouter un item dans un tableau d'état.
   * @param {string} key
   * @param {*} item
   * @param {number} [maxLength] — limite optionnelle
   */
  push(key, item, maxLength = null) {
    const current = this.get(key) ?? [];
    const updated = [...current, item];
    this.set({ [key]: maxLength ? updated.slice(-maxLength) : updated });
  }

  /**
   * Ajouter ou mettre à jour un item dans un objet indexé par id.
   * @param {string} key — clé de l'objet (ex: 'matches')
   * @param {string} id  — clé de l'item
   * @param {object} item
   */
  upsert(key, id, item) {
    const current = this.get(key) ?? {};
    this.set({ [key]: { ...current, [id]: item } });
  }

  /**
   * Supprimer un item d'un objet indexé.
   * @param {string} key
   * @param {string} id
   */
  remove(key, id) {
    const current = this.get(key) ?? {};
    const updated = { ...current };
    delete updated[id];
    this.set({ [key]: updated });
  }

  // ── ABONNEMENTS ────────────────────────────────────────────────────────

  /**
   * S'abonner aux changements d'une clé spécifique.
   * @param {string} key
   * @param {function} callback — appelé avec (newValue, key)
   * @returns {function} unsubscribe
   */
  subscribe(key, callback) {
    if (!this._subscribers[key]) {
      this._subscribers[key] = new Set();
    }
    this._subscribers[key].add(callback);

    return () => this._subscribers[key]?.delete(callback);
  }

  /**
   * S'abonner à tous les changements de l'état.
   * @param {function} callback — appelé avec (changedKeys, state)
   * @returns {function} unsubscribe
   */
  subscribeAll(callback) {
    this._globalSubs.add(callback);
    return () => this._globalSubs.delete(callback);
  }

  // ── PERSISTENCE ────────────────────────────────────────────────────────

  /**
   * Charger l'état persisté depuis le storage.
   * Fusionne uniquement les clés persistables.
   * @param {object} persisted
   */
  load(persisted) {
    if (!persisted || typeof persisted !== 'object') return;

    const PERSISTABLE_KEYS = [
      'dashboardFilters',
      'ui.displayMode',
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
      currentRoute: route,
    });
  }

  addError(error) {
    this.push('errors', {
      id: crypto.randomUUID(),
      message: error.message ?? String(error),
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
