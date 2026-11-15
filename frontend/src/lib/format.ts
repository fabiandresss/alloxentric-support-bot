/** Formatos compartidos por las vistas de FinOps y conversaciones. */

/** USD: con centavos normales, y con más decimales si el monto es muy pequeño (los tokens cuestan fracciones de centavo). */
export const fmtUsd = (v: number): string => {
  const abs = Math.abs(v);
  const dec = abs === 0 ? 2 : abs < 0.01 ? 5 : abs < 1 ? 4 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: dec }).format(v);
};

/** 1.234 · 12,5 mil · 3,2 M */
export const fmtTokens = (n: number): string =>
  n < 10_000 ? new Intl.NumberFormat('es-CL').format(n) : new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const fmtInt = (n: number): string => new Intl.NumberFormat('es-CL').format(n);

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });

/** "2026-11" -> "noviembre de 2026" */
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const currentMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Fecha local como AAAA-MM-DD (sin pasar por UTC, que cambiaría el día de noche). */
export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const dayOf = (iso: string) => new Date(iso + 'T12:00:00');

/** "1 nov" o "1 nov 2025" si es de otro año */
export const fmtDay = (iso: string, withYear = false): string =>
  dayOf(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).replace('.', '');

/** "1 nov – 14 nov" · "3 nov" si es un solo día */
export const fmtRange = (from: string, to: string): string => {
  const y = new Date().getFullYear();
  const multiYear = dayOf(from).getFullYear() !== y || dayOf(to).getFullYear() !== y;
  return from === to ? fmtDay(from, multiYear) : `${fmtDay(from, multiYear)} – ${fmtDay(to, multiYear)}`;
};
