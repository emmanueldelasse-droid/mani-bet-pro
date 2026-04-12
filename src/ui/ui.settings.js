export async function render(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">⚙</div>
      <div class="view-placeholder__title">Configuration</div>
      <div class="view-placeholder__sub">Vue de configuration en attente. Le reste de l'application reste utilisable.</div>
    </div>
  `;
  return { destroy() {} };
}
