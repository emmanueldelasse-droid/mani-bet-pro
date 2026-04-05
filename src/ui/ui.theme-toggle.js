/**
 * MANI BET PRO — Theme Toggle
 * Ajouter dans app.js dans la fonction init(), après le render.
 *
 * Usage :
 *   import { initThemeToggle } from './ui/ui.theme-toggle.js';
 *   initThemeToggle();
 */

export function initThemeToggle() {
  // Lire la préférence sauvegardée
  const saved = localStorage.getItem('mbp_theme') ?? 'dark';
  _applyTheme(saved);

  // Créer le bouton toggle
  const btn = document.createElement('button');
  btn.id          = 'theme-toggle';
  btn.title       = 'Changer le thème';
  btn.textContent = saved === 'light' ? '🌙' : '☀️';
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next    = current === 'light' ? 'dark' : 'light';
    _applyTheme(next);
    localStorage.setItem('mbp_theme', next);
    btn.textContent = next === 'light' ? '🌙' : '☀️';
  });
}

function _applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.removeAttribute('data-theme');
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.classList.remove('theme-light');
    document.body.removeAttribute('data-theme');
  }
}
