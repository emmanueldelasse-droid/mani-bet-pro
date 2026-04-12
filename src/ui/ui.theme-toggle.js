/**
 * MANI BET PRO — ui.theme-toggle.js
 */

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.classList.remove('theme-light');
    document.body.removeAttribute('data-theme');
  }
}

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

  const syncIcon = function(theme) {
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
  };

  syncIcon(saved);

  btn.onclick = function() {
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('mbp_theme', next);
    syncIcon(next);
  };
}
