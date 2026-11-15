import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'alloxentric-theme';

/** Tema guardado, o el del sistema si nunca se eligió. El chat público (/chat/...) siempre arranca en claro. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* sin almacenamiento */ }
  if (location.pathname.startsWith('/chat/')) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-fade');
    window.setTimeout(() => root.classList.remove('theme-fade'), 350);
  }
  root.classList.toggle('dark', t === 'dark');
  root.dataset.theme = t;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
    try { localStorage.setItem(KEY, next); } catch { /* sin almacenamiento */ }
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}
