import React, { useState } from 'react';
import { Logo } from './Logo';
import * as api from '../api/client';
import { AuthUser } from '../types';

export const LoginScreen: React.FC<{ onLogin: (u: AuthUser) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-['Plus_Jakarta_Sans',sans-serif]">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-8 space-y-5"
      >
        <div className="flex justify-center">
          <Logo size="md" showWordmark={true} />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-[#1E1B4B]">Iniciar sesión</h1>
          <p className="text-xs text-[#64748B] mt-1">Panel de soporte y agentes de IA</p>
        </div>
        <label className="block text-xs font-semibold text-[#1E1B4B]">
          Correo
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
            className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F46E5]"
          />
        </label>
        <label className="block text-xs font-semibold text-[#1E1B4B]">
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
            className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F46E5]"
          />
        </label>
        {error && (
          <p role="alert" data-testid="login-error" className="text-xs text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          data-testid="login-submit"
          className="w-full py-2.5 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-60 text-white text-sm font-bold transition-colors"
        >
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
};
