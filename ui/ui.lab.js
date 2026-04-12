export async function render(container) {
  container.innerHTML = `
    <section class="card" style="padding:16px">
      <div class="section-title">Laboratoire</div>
      <div class="text-muted" style="margin-top:8px">Cette vue n'est pas encore branchée. Le reste de l'application continue de fonctionner normalement.</div>
    </section>
  `;
  return { destroy() {} };
}
