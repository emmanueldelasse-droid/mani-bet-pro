export async function render(container) {
  container.innerHTML = `
    <div class="view-placeholder">
      <div class="view-placeholder__icon">⬡</div>
      <div class="view-placeholder__title">Laboratoire</div>
      <div class="view-placeholder__sub">Vue de laboratoire en attente. Rien d'important ne casse ici.</div>
    </div>
  `;
  return { destroy() {} };
}
