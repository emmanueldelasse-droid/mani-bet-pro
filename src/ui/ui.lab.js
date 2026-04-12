export async function render(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Laboratoire</div>
      <div class="text-muted" style="font-size:13px;line-height:1.7">Espace réservé. Rien d'essentiel n'est chargé ici.</div>
    </div>`;
  return { destroy() {} };
}
