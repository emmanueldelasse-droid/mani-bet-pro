export async function render(container, storeInstance) {
  const selectedSport = storeInstance?.get('selectedSport') ?? 'NBA';
  container.innerHTML = `
    <div class="card" style="padding:20px">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Configuration</div>
      <div class="text-muted" style="font-size:13px;line-height:1.7;margin-bottom:14px">Choisis le sport actif.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${selectedSport === 'NBA' ? 'btn--primary' : 'btn--ghost'}" data-sport="NBA">NBA</button>
        <button class="btn ${selectedSport === 'TENNIS' ? 'btn--primary' : 'btn--ghost'}" data-sport="TENNIS">Tennis</button>
      </div>
    </div>`;
  container.querySelectorAll('[data-sport]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      storeInstance?.set({ selectedSport: btn.dataset.sport });
      render(container, storeInstance);
    });
  });
  return { destroy() {} };
}
