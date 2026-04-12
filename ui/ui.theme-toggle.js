/**
 * MANI BET PRO — ui.theme-toggle.js v2
 *
 * Bouton de thème unique pour toute l'application.
 */

export function initThemeToggle() {
  const saved = localStorage.getItem('mbp_theme') ?? 'dark';
  applyTheme(saved);

  let btn = document.getElementById('theme-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Changer le thème';
    document.body.appendChild(btn);
  }

  btn.textContent = saved === 'light' ? '🌙' : '☀️';
  btn.onclick = function() {
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('mbp_theme', next);
    btn.textContent = next === 'light' ? '🌙' : '☀️';
  };
}

export function applyTheme(theme) {
  const html = document.documentElement;

  if (theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.setAttribute('data-theme', 'light');
    html.setAttribute('data-theme', 'light');
    return;
  }

  document.body.classList.remove('theme-light');
  document.body.setAttribute('data-theme', 'dark');
  html.setAttribute('data-theme', 'dark');
}
