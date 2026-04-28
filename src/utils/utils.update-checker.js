/**
 * Update checker — détecte qu'une nouvelle version de l'app est en ligne.
 *
 * Principe :
 *   1. Au boot, fetch index.html avec cache: 'no-store' → calcule hash SHA-256.
 *   2. Toutes les 5 minutes, refait le fetch et recalcule le hash.
 *   3. Si le hash diffère du hash initial → callback (ex: toast "Recharger").
 *
 * Le workflow .github/workflows/bump-build.yml met à jour le meta name="build"
 * d'index.html à chaque push main, donc le hash change à chaque déploiement
 * même quand seul worker.js ou un module .js est modifié.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FIRST_CHECK_DELAY_MS = 60 * 1000;  // attendre 1 min après boot avant 1er check

let _initialHash    = null;
let _intervalId     = null;
let _onUpdateCalled = false;

async function _hashIndexHtml() {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash   = '';
    const resp = await fetch(url.toString(), { cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) return null;
    const text = await resp.text();
    const buf  = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export async function startUpdateChecker(onUpdate) {
  if (_intervalId) return;

  _initialHash = await _hashIndexHtml();
  if (!_initialHash) return; // Pas de signature dispo (hors-ligne, CSP, etc.)

  setTimeout(function tick() {
    if (_onUpdateCalled) return;
    _hashIndexHtml().then(current => {
      if (current && current !== _initialHash) {
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
