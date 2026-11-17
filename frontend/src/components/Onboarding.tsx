import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Bot, Building2, Check, Eye, EyeOff, Globe, Loader2, Lock, LogOut, Mail, Sparkles, User, UserRound } from 'lucide-react';
import { Logo } from './Logo';
import { Select } from './Select';
import { PlanPicker, PlanValue, planDe, planInicial } from './PlanPicker';
import * as api from '../api/client';
import { AuthUser, Company, ResponseTone } from '../types';

/** Correo al que se pide un segundo chatbot u otra condición. Configurable con VITE_CONTACT_EMAIL. */
export const CONTACT_EMAIL: string = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? 'contacto@alloxentric.com';

const PASOS = [
  { n: 1, label: 'Tu cuenta', icon: UserRound },
  { n: 2, label: 'Tu empresa', icon: Building2 },
  { n: 3, label: 'Tu chatbot', icon: Bot },
];
const field = 'w-full bg-white border border-[color:var(--c-line)] rounded-xl py-2.5 text-sm transition-shadow';
const label = 'block text-xs font-semibold text-[color:var(--c-ink)]';

const Stepper: React.FC<{ paso: number }> = ({ paso }) => (
  <ol className="flex items-center gap-2 mb-7" aria-label="Progreso del registro" data-testid="stepper">
    {PASOS.map((p, i) => {
      const hecho = paso > p.n, activo = paso === p.n;
      return (
        <React.Fragment key={p.n}>
          <li className="flex items-center gap-2" aria-current={activo ? 'step' : undefined}>
            <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-colors ${hecho ? 'bg-[#22C55E] text-white' : activo ? 'bg-[#D20A2E] text-white shadow-[0_0_0_4px_rgba(210,10,46,0.15)]' : 'bg-[color:var(--c-soft)] text-[color:var(--c-faint)]'}`}>
              {hecho ? <Check className="w-3.5 h-3.5" /> : p.n}
            </span>
            <span className={`text-xs font-semibold hidden sm:inline ${activo ? 'text-[color:var(--c-ink)]' : 'text-[color:var(--c-faint)]'}`}>{p.label}</span>
          </li>
          {i < PASOS.length - 1 && <span className={`flex-1 h-px ${paso > p.n ? 'bg-[#22C55E]' : 'bg-[color:var(--c-line)]'}`} />}
        </React.Fragment>
      );
    })}
  </ol>
);

const BENEFICIOS = [
  { icon: Sparkles, t: 'Un chatbot que responde con tu documentación', d: 'Sube tus PDF o FAQ y publícalo.' },
  { icon: Building2, t: 'Tu empresa, aislada del resto', d: 'Tus datos y los de tus clientes son solo tuyos.' },
  { icon: Lock, t: 'Tú decides el gasto', d: 'Ilimitado o con un tope mensual en USD.' },
];

/** Marco de las pantallas de registro: panel de marca a la izquierda, formulario con el progreso a la derecha. */
const Shell: React.FC<{ paso: number; titulo: string; texto: string; children: React.ReactNode; pie?: React.ReactNode; ancho?: string }> = ({ paso, titulo, texto, children, pie, ancho = 'max-w-md' }) => (
  <div className="min-h-screen grid lg:grid-cols-[0.9fr_1.1fr] font-['Inter',sans-serif]">
    <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#D20A2E] via-[#B00825] to-[#8F0720] text-white p-12">
      <div className="absolute top-24 right-16 w-40 h-40 rounded-full bg-white/10 blur-2xl animate-float" />
      <div className="absolute bottom-40 left-10 w-56 h-56 rounded-full bg-[#E8405F]/40 blur-3xl animate-float-slow" />
      <a href="/landing" className="relative text-[28px] font-medium tracking-[-0.04em] leading-none">allo<span className="text-[#FFB3C0]">x</span>entric<span className="text-[#FFB3C0]">.</span></a>
      <div className="relative max-w-md my-auto">
        <h2 className="text-4xl font-semibold tracking-tight leading-[1.1]">Crea tu chatbot de soporte en tres pasos.</h2>
        <ul className="mt-8 space-y-4">
          {BENEFICIOS.map(({ icon: Icon, t, d }, i) => (
            <motion.li key={t} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 + i * 0.12 }} className="flex items-start gap-3">
              <span className="mt-0.5 w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <span><span className="block text-sm font-semibold">{t}</span><span className="block text-xs text-white/70">{d}</span></span>
            </motion.li>
          ))}
        </ul>
      </div>
      <p className="relative text-[11px] text-white/60">Proyecto Capstone PTY4614 · Duoc UC</p>
    </aside>
    <main className="flex items-center justify-center p-6 py-10 overflow-y-auto">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className={`w-full ${ancho}`}>
        <div className="lg:hidden flex justify-center mb-6"><Logo size="lg" /></div>
        <Stepper paso={paso} />
        <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--c-ink)]">{titulo}</h1>
        <p className="text-sm text-[color:var(--c-muted)] mt-1 mb-6">{texto}</p>
        {children}
        {pie && <div className="mt-6 text-center text-xs text-[color:var(--c-muted)]">{pie}</div>}
      </motion.div>
    </main>
  </div>
);

const FormError: React.FC<{ msg: string | null }> = ({ msg }) => msg ? <p role="alert" data-testid="form-error" className="text-xs text-[color:var(--c-rtx)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] rounded-xl px-3 py-2">{msg}</p> : null;
const Submit: React.FC<{ busy: boolean; disabled?: boolean; texto: string; ocupado: string; testId: string }> = ({ busy, disabled, texto, ocupado, testId }) => (
  <button type="submit" disabled={busy || disabled} data-testid={testId} className="group w-full py-3 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {ocupado}</> : <>{texto} <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></>}
  </button>
);

// ------------------------------------------------------------------------------------------ paso 1: cuenta
const REGLAS = [
  { ok: (p: string) => p.length >= 10, t: 'Al menos 10 caracteres' },
  { ok: (p: string) => /[A-Za-z]/.test(p) && /\d/.test(p), t: 'Letras y números' },
];

const AccountForm: React.FC<{ onDone: (u: AuthUser) => void }> = ({ onDone }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [trap, setTrap] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reglasOk = REGLAS.every((r) => r.ok(password));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onDone(await api.register({ name: name.trim(), email: email.trim(), password, website: trap })); }
    catch (err) { setError(err instanceof api.ApiError || err instanceof Error ? err.message : 'No se pudo crear la cuenta'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={label}>Tu nombre
        <div className="relative mt-1.5"><User className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input required minLength={2} maxLength={120} autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="reg-name" placeholder="Ana Pérez" className={`${field} pl-10 pr-3`} /></div></label>
      <label className={label}>Correo
        <div className="relative mt-1.5"><Mail className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="reg-email" placeholder="tu@empresa.cl" className={`${field} pl-10 pr-3`} /></div></label>
      <label className={label}>Contraseña
        <div className="relative mt-1.5"><Lock className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input type={show ? 'text' : 'password'} required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="reg-password" placeholder="••••••••••" className={`${field} pl-10 pr-10`} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--c-faint)] hover:text-[#D20A2E]">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Requisitos de la contraseña">
          {REGLAS.map((r) => <li key={r.t} className={`text-[11px] font-medium flex items-center gap-1 ${r.ok(password) ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-faint)]'}`}><Check className="w-3 h-3" />{r.t}</li>)}
        </ul></label>
      {/* trampa para bots: una persona no ve ni llena este campo */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" className="absolute -left-[9999px] w-px h-px opacity-0" />
      <FormError msg={error} />
      <Submit busy={busy} disabled={!reglasOk || name.trim().length < 2} texto="Crear mi cuenta" ocupado="Creando cuenta…" testId="reg-submit" />
    </form>
  );
};

// ------------------------------------------------------------------------------------------ paso 2: empresa
const CompanyForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.registerCompany({ name: name.trim(), industry: industry.trim() || undefined, siteUrl: site.trim() || undefined }); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar la empresa'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={label}>Nombre de la empresa
        <div className="relative mt-1.5"><Building2 className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input required minLength={2} maxLength={120} autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="co-name" placeholder="Mi Empresa SpA" className={`${field} pl-10 pr-3`} /></div></label>
      <label className={label}>Rubro <span className="font-normal text-[color:var(--c-muted)]">· opcional</span>
        <input maxLength={160} value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="co-industry" placeholder="Salud, educación, retail…" className={`${field} mt-1.5 px-3.5`} /></label>
      <label className={label}>Sitio web <span className="font-normal text-[color:var(--c-muted)]">· opcional</span>
        <div className="relative mt-1.5"><Globe className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={site} onChange={(e) => setSite(e.target.value)} data-testid="co-site" placeholder="miempresa.cl" className={`${field} pl-10 pr-3`} /></div></label>
      <p className="text-[11px] text-[color:var(--c-muted)]">Quedarás como administrador de la empresa y podrás invitar a tu equipo desde el panel.</p>
      <FormError msg={error} />
      <Submit busy={busy} disabled={name.trim().length < 2} texto="Registrar mi empresa" ocupado="Registrando…" testId="co-submit" />
    </form>
  );
};

// ------------------------------------------------------------------------------------------ páginas
/** /registro: crea la cuenta y registra la empresa; el chatbot se crea al entrar al panel (paso 3). */
export const Signup: React.FC = () => {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [checking, setChecking] = useState(api.hasToken());

  // con sesión: «registrado» sigue con su empresa; el resto va al panel
  useEffect(() => {
    if (!api.hasToken()) return;
    api.getMe().then((u) => { if (u.role === 'registrado') setPaso(2); else window.location.replace('/'); }).catch(() => api.logout()).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="min-h-screen flex items-center justify-center text-xs text-[color:var(--c-muted)]">Cargando…</div>;

  return paso === 1 ? (
    <Shell paso={1} titulo="Crea tu cuenta" texto="Empieza gratis: registra tu cuenta, tu empresa y crea tu chatbot." pie={<>¿Ya tienes cuenta? <a href="/" className="font-semibold text-[#D20A2E] hover:underline">Inicia sesión</a></>}>
      <AccountForm onDone={() => setPaso(2)} />
    </Shell>
  ) : (
    <Shell paso={2} titulo="Registra tu empresa" texto="El chatbot será de esta empresa: cada empresa tiene uno." pie={<button onClick={() => { api.logout(); window.location.replace('/'); }} className="inline-flex items-center gap-1 hover:text-[color:var(--c-ink)]"><LogOut className="w-3 h-3" /> Salir</button>}>
      <CompanyForm onDone={() => window.location.replace('/')} />
    </Shell>
  );
};

/** Pantalla del panel para una cuenta `registrado` (se registró, pero cerró la ventana antes de registrar su empresa). */
export const CompanyStep: React.FC<{ onDone: () => void; onLogout: () => void }> = ({ onDone, onLogout }) => (
  <Shell paso={2} titulo="Registra tu empresa" texto="Falta un paso: cuéntanos de tu empresa para crear su chatbot." pie={<button onClick={onLogout} className="inline-flex items-center gap-1 hover:text-[color:var(--c-ink)]"><LogOut className="w-3 h-3" /> Salir</button>}>
    <CompanyForm onDone={onDone} />
  </Shell>
);

const TONOS: { value: ResponseTone; label: string; hint: string }[] = [
  { value: 'cercano', label: 'Cercano', hint: 'Tutea y es amable' },
  { value: 'formal', label: 'Formal', hint: 'Trata de usted' },
  { value: 'tecnico', label: 'Técnico', hint: 'Preciso y directo' },
];
const COLORES = ['#D20A2E', '#1D4ED8', '#0F766E', '#7C3AED', '#C2410C', '#1F1B1A'];

/** Paso 3: crea el chatbot de la empresa (uno solo) y elige si su gasto es ilimitado o con límite. Bloquea el panel hasta completarse. */
export const ChatbotStep: React.FC<{ company: Company; onCreated: (c: Company) => void; onLogout: () => void }> = ({ company, onCreated, onLogout }) => {
  const [agentName, setAgentName] = useState(`${company.name} Assistant`.slice(0, 80));
  const [tone, setTone] = useState<ResponseTone>('cercano');
  const [instructions, setInstructions] = useState('');
  const [color, setColor] = useState('#D20A2E');
  const [plan, setPlan] = useState<PlanValue>(planInicial());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { plan: planBody, valid } = planDe(plan);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onCreated(await api.createChatbot(company.id, { agentName: agentName.trim(), tone, customInstructions: instructions.trim() || undefined, brandColor: color, spendPlan: planBody })); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear el chatbot'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-[color:var(--c-canvas)] overflow-y-auto" data-testid="chatbot-step">
      <Shell paso={3} ancho="max-w-xl" titulo={`Crea el chatbot de ${company.name}`} texto="Será el asistente de tus clientes. Podrás cambiar todo esto después, y cargar tu documentación en el siguiente paso."
        pie={<><p>Cada empresa tiene un solo chatbot. ¿Necesitas otro? <a href={`mailto:${CONTACT_EMAIL}?subject=Segundo chatbot para ${encodeURIComponent(company.name)}`} className="font-semibold text-[#D20A2E] hover:underline" data-testid="contact-link">Contacta a Alloxentric</a>.</p>
          <button onClick={onLogout} className="mt-2 inline-flex items-center gap-1 hover:text-[color:var(--c-ink)]"><LogOut className="w-3 h-3" /> Salir</button></>}>
        <form onSubmit={submit} className="space-y-5">
          <label className={label}>Nombre del chatbot
            <input required minLength={2} maxLength={80} value={agentName} onChange={(e) => setAgentName(e.target.value)} data-testid="bot-name" className={`${field} mt-1.5 px-3.5`} /></label>
          <div className={label}>Tono de respuesta
            <div className="mt-1.5"><Select value={tone} onChange={(v) => setTone(v as ResponseTone)} ariaLabel="Tono" testId="bot-tone" options={TONOS.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))} /></div></div>
          <label className={label}>Instrucciones <span className="font-normal text-[color:var(--c-muted)]">· opcional</span>
            <textarea rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} data-testid="bot-instructions" placeholder="Ej.: Responde siempre con el nombre de la clínica. Si preguntan por precios, deriva a una persona."
              className={`${field} mt-1.5 px-3.5 resize-none`} /></label>
          <div className={label}>Color de marca
            <div className="mt-2 flex items-center gap-2 flex-wrap" role="radiogroup" aria-label="Color de marca">
              {COLORES.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} style={{ backgroundColor: c }}
                className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-[color:var(--c-ink)] scale-110' : 'hover:scale-110'}`} />)}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="Otro color" className="w-8 h-8 rounded-full border border-[color:var(--c-line)] bg-white p-0.5 cursor-pointer" />
            </div></div>
          <div className={label}>Gasto del chatbot
            <p className="font-normal text-[11px] text-[color:var(--c-muted)] mt-0.5 mb-2">Cada respuesta con IA tiene un costo. Elige si quieres que sea ilimitado o ponerle un tope.</p>
            <PlanPicker value={plan} onChange={setPlan} /></div>
          <FormError msg={error} />
          <Submit busy={busy} disabled={agentName.trim().length < 2 || !valid} texto="Crear mi chatbot" ocupado="Creando…" testId="bot-submit" />
        </form>
      </Shell>
    </div>
  );
};
