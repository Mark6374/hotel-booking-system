/* Light / dark theme. The choice is saved in this browser; with no choice saved
   the site follows the system setting. index.html applies it before React starts,
   so the page never flashes in the wrong colours. */

const KEY = 'juniper-court-theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

function saved() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}

export function currentTheme() {
  const s = saved();
  if (s === 'light' || s === 'dark') return s;
  return media && media.matches ? 'dark' : 'light';
}

function apply() {
  document.documentElement.dataset.theme = currentTheme();
  listeners.forEach((fn) => fn());
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode: works until reload */ }
  apply();
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function subscribeTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// System setting changed and the user has not picked a theme: follow it.
if (media && media.addEventListener) media.addEventListener('change', () => { if (!saved()) apply(); });
apply();
