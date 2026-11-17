import React, { useEffect, useState } from 'react';
import { AlertTriangle, EyeOff, FileWarning, Loader2, MessageSquareOff, ShieldAlert, ShieldCheck, ShieldX, Link2Off, Gauge, type LucideIcon } from 'lucide-react';
import * as api from '../api/client';
import { AuthUser, Company, SecurityOverview } from '../types';
import { fmtDateTime, fmtInt } from '../lib/format';
import { Select } from './Select';

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';

const TIPOS: Record<string, { label: string; hint: string; icon: LucideIcon }> = {
  inyeccion: { label: 'Intento de inyección', hint: 'Alguien intentó que el bot ignorara sus reglas o revelara sus instrucciones. Se bloqueó sin llamar al modelo.', icon: ShieldX },
  fuga_salida: { label: 'Fuga evitada', hint: 'La respuesta del modelo reproducía las instrucciones internas y se descartó.', icon: ShieldAlert },
  fragmento_sospechoso: { label: 'Documento con órdenes ocultas', hint: 'Un fragmento de la documentación traía instrucciones dirigidas al modelo; no se usó. Revisa ese documento.', icon: FileWarning },
  pii: { label: 'Datos personales enmascarados', hint: 'Un cliente escribió RUT, tarjeta, correo, teléfono o clave; se enmascararon antes del modelo y del registro.', icon: EyeOff },
  tema_prohibido: { label: 'Tema prohibido', hint: 'La consulta tocaba un tema que la empresa no atiende por este canal.', icon: MessageSquareOff },
  inyeccion_multiturno: { label: 'Ataque repartido en varios mensajes', hint: 'Un ataque partido en fragmentos que juntos intentan manipular al bot. Se bloqueó sin llamar al modelo.', icon: ShieldX },
  conversacion_bloqueada: { label: 'Conversación cerrada', hint: 'Tras varios intentos de ataque, la conversación dejó de responder. Una nueva consulta funciona normal.', icon: ShieldAlert },
  salida_danina: { label: 'Respuesta dañina descartada', hint: 'La respuesta del modelo traía insultos, amenazas o instrucciones para dañar y no se mostró.', icon: ShieldAlert },
  documento_sospechoso: { label: 'Documento con órdenes ocultas', hint: 'Al subir un documento se detectaron órdenes dirigidas al modelo. Revísalo en la base de conocimiento.', icon: FileWarning },
  salida_saneada: { label: 'Respuesta saneada', hint: 'Se quitaron imágenes, HTML o enlaces que no estaban en la documentación.', icon: Link2Off },
  limite_conversacion: { label: 'Conversación al tope', hint: 'Una conversación llegó al máximo de mensajes (protege el gasto).', icon: Gauge },
};
const SEV = { alta: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]', media: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]', baja: 'bg-[color:var(--c-soft)] text-[color:var(--c-muted)]' } as const;

/** Registro de lo que frenaron los guardarraíles de la IA de la empresa. La configuración se cambia en Empresas y agentes → Configurar agente. */
export const SecurityView: React.FC<{ me: AuthUser; companies: Company[] }> = ({ me, companies }) => {
  const isSuper = me.role === 'superadmin';
  const [slug, setSlug] = useState<string>(isSuper ? companies[0]?.id ?? '' : me.companyId ?? '');
  const [days, setDays] = useState('30');
  const [type, setType] = useState('');
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const company = companies.find((c) => c.id === slug);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setError(null);
    api.getSecurityEvents(slug, Number(days), type || undefined).then((x) => alive && setData(x)).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar'));
    return () => { alive = false; };
  }, [slug, days, type]);

  const sec = company?.security;
  return (
    <div className="space-y-6" data-testid="security-view">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Seguridad de la IA</h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1 max-w-2xl">
            Lo que frenaron las defensas del asistente{company ? ` de ${company.name}` : ''}: intentos de manipularlo, datos personales protegidos y respuestas que no debían salir.
            Ninguna defensa es infalible: por eso todo queda registrado para auditar.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuper && <Select value={slug} onChange={setSlug} ariaLabel="Empresa" size="sm" className="w-52" options={companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <Select value={days} onChange={setDays} ariaLabel="Periodo" size="sm" className="w-40" options={[{ value: '7', label: 'Últimos 7 días' }, { value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]} />
        </div>
      </div>

      {sec && (
        <div className={`${card} p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs`} data-testid="security-config-summary">
          <span className="font-bold text-[color:var(--c-ink)] flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[#D20A2E]" /> Defensas activas</span>
          <span className={sec.pii ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx2)]'}>{sec.pii ? '✓' : '✗'} Datos personales</span>
          <span className={sec.injection ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx2)]'}>{sec.injection ? '✓' : '✗'} Inyección de prompt</span>
          <span className="text-[color:var(--c-muted)]">{sec.forbiddenTopics.length} tema(s) prohibido(s)</span>
          <span className="text-[color:var(--c-muted)]">Fuentes al cliente: {sec.publicSources}</span>
          <span className="text-[11px] text-[color:var(--c-faint)] ml-auto">Se cambian en Empresas y agentes → Configurar agente</span>
        </div>
      )}

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {!data && !error && <div className="py-16 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className={`${card} p-4`} data-testid="sec-total"><p className="text-xs font-medium text-[color:var(--c-muted)]">Eventos</p><p className="mt-2 text-2xl font-bold tabular-nums text-[color:var(--c-ink)]">{fmtInt(data.total)}</p><p className="text-[11px] text-[color:var(--c-muted)] mt-1">en {data.days} días</p></div>
            <div className={`${card} p-4`} data-testid="sec-high"><p className="text-xs font-medium text-[color:var(--c-muted)]">Severidad alta</p><p className={`mt-2 text-2xl font-bold tabular-nums ${data.high ? 'text-[color:var(--c-rtx2)]' : 'text-[color:var(--c-ink)]'}`}>{fmtInt(data.high)}</p><p className="text-[11px] text-[color:var(--c-muted)] mt-1">ataques o fugas</p></div>
            {data.byType.slice(0, 2).map((t) => (
              <div key={t.type} className={`${card} p-4`}><p className="text-xs font-medium text-[color:var(--c-muted)] truncate">{TIPOS[t.type]?.label ?? t.type}</p><p className="mt-2 text-2xl font-bold tabular-nums text-[color:var(--c-ink)]">{fmtInt(t.count)}</p></div>
            ))}
          </div>

          <section className={`${card} overflow-hidden`} aria-label="Eventos de seguridad">
            <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[#D20A2E]" /> Registro de eventos</h2>
              <Select value={type} onChange={setType} ariaLabel="Tipo de evento" size="sm" className="w-64"
                options={[{ value: '', label: 'Todos los tipos' }, ...Object.entries(TIPOS).map(([v, t]) => ({ value: v, label: t.label }))]} />
            </div>
            {data.events.length === 0 ? (
              <p className="py-14 text-center text-xs text-[color:var(--c-muted)]" data-testid="sec-empty">Sin eventos en este periodo. Las defensas siguen activas.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--c-line)]" data-testid="sec-events">
                {data.events.map((e) => {
                  const t = TIPOS[e.type] ?? { label: e.type, hint: '', icon: AlertTriangle };
                  const Icon = t.icon;
                  return (
                    <li key={e.id} className="px-5 py-3.5 flex items-start gap-3">
                      <span className="w-8 h-8 rounded-lg bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[color:var(--c-ink)]">{t.label}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${SEV[e.severity]}`}>{e.severity}</span>
                          <span className="text-[11px] text-[color:var(--c-muted)]">{fmtDateTime(e.createdAt)}</span>
                        </div>
                        {t.hint && <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">{t.hint}</p>}
                        {e.detail && <p className="mt-1 text-[11px] font-mono text-[color:var(--c-ink)] bg-[color:var(--c-canvas)] rounded-md px-2 py-1 break-words">{e.detail}</p>}
                        {e.signals.length > 0 && <p className="mt-1 text-[10px] text-[color:var(--c-faint)]">Señales: {e.signals.join(', ')}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
