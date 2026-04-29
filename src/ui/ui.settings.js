export async function render(container) {
  const buildMeta = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? 'dev';

  container.innerHTML = `
    <div class="page-shell">
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Réglages</div>
        <div class="page-header__sub">Base visuelle unifiée pour éviter une route vide et préparer la suite du chantier UI.</div>
      </div>

      <div class="alert alert--info">
        <div class="alert__title">État actuel</div>
        <div class="alert__text">Les réglages avancés ne sont pas encore branchés. Cette vue sert de point d'ancrage propre pendant la refonte visuelle.</div>
      </div>

      <div class="settings-grid">
        <div class="card card--elevated">
          <div class="card__section">
            <div class="card__title">Mise à jour de l'app</div>
            <div class="card__sub">Si l'app n'affiche pas les derniers changements, force un rechargement complet (vide le cache navigateur).</div>
            <div style="margin-top:var(--space-3);font-size:11px;color:var(--color-text-secondary);font-family:var(--font-mono)">Build actuel : ${buildMeta}</div>
            <button id="force-update-btn" type="button" style="margin-top:var(--space-3);padding:8px 16px;background:var(--color-info);color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px">Forcer la mise à jour</button>
          </div>
        </div>

        <div class="card">
          <div class="card__section">
            <div class="card__title">Chantier prioritaire</div>
            <div class="settings-stat-list">
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">NBA</span>
                <span class="settings-stat-row__value">Priorité 1</span>
              </div>
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">MLB</span>
                <span class="settings-stat-row__value">Priorité 2</span>
              </div>
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">Objectif</span>
                <span class="settings-stat-row__value">Même langage visuel</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Bouton force-update : hard reload avec cache busting (Safari iOS-safe)
  container.querySelector('#force-update-btn')?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.href = url.toString();
  });

  return { destroy() {} };
}
