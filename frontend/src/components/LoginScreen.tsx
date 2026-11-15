import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, Sparkles, Ticket } from 'lucide-react';
import { Logo } from './Logo';
import * as api from '../api/client';
import { AuthUser } from '../types';

const FEATURES = [
  { icon: Sparkles, title: 'Responde con tu documentación', text: 'RAG sobre los documentos de cada empresa.' },
  { icon: Ticket, title: 'Deriva cuando hace falta', text: 'Si no sabe, crea el ticket para un humano.' },
  { icon: ShieldCheck, title: 'Cada empresa, aislada', text: 'Multi-tenant: tus datos son solo tuyos.' },
];

export const LoginScreen: React.FC<{ onLogin: (u: AuthUser) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
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
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] font-['Inter',sans-serif]">
      {/* Panel de marca */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#D20A2E] via-[#B00825] to-[#8F0720] text-white p-12">
        <svg aria-hidden className="absolute -right-20 -bottom-16 w-[34rem] h-[34rem] opacity-[0.1] animate-float-slow" viewBox="0 0 32 32" fill="none">
          <path d="M8 2h16a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H14l-7 5v-5.3A6 6 0 0 1 2 19V8a6 6 0 0 1 6-6Z" fill="#fff" />
          <path d="M16 6Q17.300 12.200 23.500 13.500Q17.300 14.800 16 21Q14.700 14.800 8.500 13.500Q14.700 12.200 16 6Z" fill="#B00825" />
        </svg>
        <div className="absolute top-24 right-16 w-40 h-40 rounded-full bg-white/10 blur-2xl animate-float" />
        <div className="absolute bottom-40 left-10 w-56 h-56 rounded-full bg-[#E8405F]/40 blur-3xl animate-float-slow" />

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative">
          <span className="text-[28px] font-medium tracking-[-0.04em] leading-none">allo<span className="text-[#FFB3C0]">x</span>entric<span className="text-[#FFB3C0]">.</span></span>
        </motion.div>

        <div className="relative max-w-md my-auto">
          <motion.h2
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl font-semibold tracking-tight leading-[1.1]"
          >
            Soporte con IA que resuelve y sabe cuándo pasar el caso.
          </motion.h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <motion.li
                key={title}
                initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.3 + i * 0.12 }}
                className="flex items-start gap-3"
              >
                <span className="mt-0.5 w-8 h-8 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-white/70">{text}</span></span>
              </motion.li>
            ))}
          </ul>
        </div>

      </aside>

      {/* Formulario */}
      <main className="flex items-center justify-center p-6">
        <motion.form
          onSubmit={submit}
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          className="w-full max-w-sm space-y-5"
        >
          <div className="lg:hidden flex justify-center mb-8"><Logo size="lg" /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--c-ink)]">Bienvenido de vuelta</h1>
            <p className="text-sm text-[color:var(--c-muted)] mt-1">Ingresa al panel de soporte y agentes de IA.</p>
          </div>

          <label className="block text-xs font-semibold text-[color:var(--c-ink)]">
            Correo
            <div className="relative mt-1.5">
              <Mail className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email" required autoFocus autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email"
                placeholder="tu@empresa.cl"
                className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-10 pr-3 py-2.5 text-sm transition-shadow"
              />
            </div>
          </label>

          <label className="block text-xs font-semibold text-[color:var(--c-ink)]">
            Contraseña
            <div className="relative mt-1.5">
              <Lock className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPass ? 'text' : 'password'} required autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password"
                placeholder="••••••••"
                className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-10 pr-10 py-2.5 text-sm transition-shadow"
              />
              <button type="button" onClick={() => setShowPass((s) => !s)} aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--c-faint)] hover:text-[#D20A2E] transition-colors">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              role="alert" data-testid="login-error"
              className="text-xs text-[color:var(--c-rtx)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] rounded-xl px-3 py-2"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit" disabled={busy} data-testid="login-submit"
            className="group w-full py-3 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] disabled:opacity-70 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Ingresando…</>) : (<>Ingresar <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></>)}
          </button>
          <p className="text-center text-[11px] text-[color:var(--c-faint)]">Acceso solo para equipos de las empresas del ecosistema Alloxentric.</p>
        </motion.form>
      </main>
    </div>
  );
};
