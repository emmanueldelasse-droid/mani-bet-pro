/**
 * Update checker — détecte qu'une nouvelle version de l'app est en ligne.
 *
 * Principe :
 *   1. Au boot, fetch index.html avec cache-busting (URL + timestamp)
 *      → calcule SHA-256 puis re-vérifie toutes les 5 minutes.
 *   2. Si le hash diffère du hash initial → callback (toast "Recharger").
 *
 * Notes :
 *   - cache: 'no-store' seul ne suffit pas (Safari iOS l'ignore parfois).
 *     Cache-busting via ?_t=timestamp force un vrai re-fetch réseau.
 *   - 1er check immédiat (1s après boot) puis interval 5 min.
 *   - Le workflow .github/workflows/bump-build.yml met à jour le meta
 *     name="build" d'index.html à chaque push main, donc le hash change
 *     à chaque déploiement même quand seul worker.js est modifié.
 */

const CHECK_INTERVAL_MS    = 5 * 60 * 1000; // 5 minutes
const FIRST_CHECK_DELAY_MS = 5 * 1000;      // 5s après boot (au lieu de 60s)

let _initialHash    = null;
let _intervalId     = null;
let _onUpdateCalled = false;

async function _hashIndexHtml() {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash   = '';
    // Cache-busting agressif : timestamp en query param force un vrai
    // round-trip réseau, contourne les caches navigateur agressifs (Safari iOS).
    url.searchParams.set('_t', Date.now().toString());
    const resp = await fetch(url.toString(), {
      cache:       'no-store',
      credentials: 'omit',
      headers:     { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
    if (!resp.ok) {
      console.warn('[update-checker] fetch failed:', resp.status);
      return null;
    }
    const text = await resp.text();
    const buf  = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.warn('[update-checker] error:', err.message);
    return null;
  }
}

export async function startUpdateChecker(onUpdate) {
  if (_intervalId) return;

  _initialHash = await _hashIndexHtml();
  if (!_initialHash) {
    console.warn('[update-checker] no initial hash, disabled');
    return;
  }
  console.log('[update-checker] initial hash:', _initialHash.slice(0, 12));

  setTimeout(function tick() {
    if (_onUpdateCalled) return;
    _hashIndexHtml().then(current => {
      if (!current) {
        _intervalId = setTimeout(tick, CHECK_INTERVAL_MS);
        return;
      }
      if (current !== _initialHash) {
        console.log('[update-checker] new version detected', {
          old: _initialHash.slice(0, 12),
          new: current.slice(0, 12),
        });
        _onUpdateCalled = true;
        try { onUpdate(); } catch { /* noop */ }
        return;
      }
      _intervalId = setTimeout(tick, CHECK_INTERVAL_MS);
    });
  }, FIRST_CHECK_DELAY_MS);
}

export function stopUpdateChecker() {
  if (_intervalId) {
    clearTimeout(_intervalId);
    _intervalId = null;
  }
}
