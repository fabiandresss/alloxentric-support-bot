import React, { useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import { Schedule, SecurityConfig } from '../types';
import { Select } from './Select';

const DIAS: [string, string][] = [['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'], ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const box = 'bg-[color:var(--c-canvas)] rounded-xl p-5 border border-[color:var(--c-line)] space-y-4';
const h3 = 'text-xs font-bold text-[color:var(--c-ink)] uppercase tracking-wider flex items-center gap-2';
const time = 'text-xs text-[color:var(--c-ink)] px-2 py-1.5 bg-white border border-[color:var(--c-line)] rounded-lg disabled:opacity-40';

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean; testId?: string }> = ({ on, onChange, label, hint, disabled, testId }) => (
  <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} data-testid={testId}
    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all disabled:opacity-60 ${on ? 'border-[#D20A2E] bg-[color:var(--c-ch50)]' : 'border-[color:var(--c-line)] bg-white'}`}>
    <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${on ? 'bg-[#D20A2E]' : 'bg-[color:var(--c-line2)]'}`}><span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} /></span>
    <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">{label}</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">{hint}</span></span>
  </button>
);

/** Horario de atención humana y seguridad de la IA de la empresa (se guardan con «Publicar agente»). */
export const SecurityScheduleSections: React.FC<{
  security: SecurityConfig; onSecurity: (s: SecurityConfig) => void;
  schedule: Schedule; onSchedule: (s: Schedule) => void;
  canEditSecurity: boolean;
}> = ({ security, onSecurity, schedule, onSchedule, canEditSecurity }) => {
  const [topic, setTopic] = useState('');
  const setDay = (d: string, v: string[] | null) => {
    const days = { ...schedule.days };
    if (v) days[d] = v; else delete days[d];
    onSchedule({ ...schedule, days });
  };
  const addTopic = () => {
    const v = topic.trim();
    if (v.length >= 3 && !security.forbiddenTopics.some((t) => t.toLowerCase() === v.toLowerCase())) onSecurity({ ...security, forbiddenTopics: [...security.forbiddenTopics, v] });
    setTopic('');
  };

  return (
    <>
      <div className={box} data-testid="schedule-box">
        <h3 className={h3}><Clock className="w-4 h-4 text-[#D20A2E]" /> 4. Horario de atención humana</h3>
        <Switch on={schedule.enabled} onChange={(v) => onSchedule({ ...schedule, enabled: v })} testId="schedule-enabled" label="Definir horario"
          hint="Fuera de horario el bot sigue respondiendo y, si deriva, el ticket se crea igual; el cliente ve cuándo lo atenderá una persona." />
        {schedule.enabled && (
          <>
            <ul className="space-y-1.5">
              {DIAS.map(([d, nombre]) => {
                const f = schedule.days[d];
                return (
                  <li key={d} className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-2 w-32 font-medium text-[color:var(--c-ink)]">
                      <input type="checkbox" checked={!!f} onChange={(e) => setDay(d, e.target.checked ? ['09:00', '18:00'] : null)} data-testid={`schedule-day-${d}`} /> {nombre}
                    </label>
                    <input type="time" value={f?.[0] ?? ''} disabled={!f} onChange={(e) => f && setDay(d, [e.target.value, f[1]])} aria-label={`${nombre}: desde`} className={time} />
                    <span className="text-[color:var(--c-muted)]">a</span>
                    <input type="time" value={f?.[1] ?? ''} disabled={!f} onChange={(e) => f && setDay(d, [f[0], e.target.value])} aria-label={`${nombre}: hasta`} className={time} />
                    {!f && <span className="text-[11px] text-[color:var(--c-faint)]">Sin atención</span>}
                  </li>
                );
              })}
            </ul>
            <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Mensaje fuera de horario <span className="font-normal text-[color:var(--c-muted)]">(opcional)</span>
              <textarea value={schedule.outOfHoursMessage} onChange={(e) => onSchedule({ ...schedule, outOfHoursMessage: e.target.value })} rows={2} maxLength={300}
                placeholder="Ahora estamos fuera del horario de atención humana. Tu consulta quedó registrada y te responderemos apenas volvamos."
                className="mt-1.5 w-full text-xs px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg resize-none" />
            </label>
          </>
        )}
      </div>

      <div className={box} data-testid="security-box">
        <h3 className={h3}><ShieldCheck className="w-4 h-4 text-[#D20A2E]" /> 5. Seguridad de la IA</h3>
        {!canEditSecurity && <p className="text-[11px] text-[color:var(--c-muted)] bg-white border border-[color:var(--c-line)] rounded-lg px-3 py-2">Solo el admin de la empresa puede cambiar estas defensas.</p>}
        <Switch on={security.pii} disabled={!canEditSecurity} onChange={(v) => onSecurity({ ...security, pii: v })} testId="security-pii" label="Proteger datos personales"
          hint="Enmascara RUT, tarjetas, correos, teléfonos y claves antes de enviarlos al modelo y de guardarlos en la conversación." />
        <Switch on={security.injection} disabled={!canEditSecurity} onChange={(v) => onSecurity({ ...security, injection: v })} testId="security-injection" label="Bloquear inyección de prompt"
          hint="Detecta intentos de hacer que el bot ignore sus reglas, revele sus instrucciones o cambie de rol; no llama al modelo y lo deja registrado." />
        <Switch on={security.moderation} disabled={!canEditSecurity} onChange={(v) => onSecurity({ ...security, moderation: v })} testId="security-moderation" label="Moderar contenido dañino"
          hint="Si la respuesta trae insultos, amenazas o instrucciones para dañar, no se muestra (salvo que el término esté en tu propia documentación)." />
        <Switch on={security.customerMemory} disabled={!canEditSecurity} onChange={(v) => onSecurity({ ...security, customerMemory: v })} testId="security-memory" label="Recordar a quien vuelve"
          hint="El chatbot recuerda el nombre de pila y las últimas consultas (enmascaradas) de cada navegador. El cliente puede pedir que lo olvide con «Olvidar mis datos»." />
        <div className="text-xs font-semibold text-[color:var(--c-ink)]">Qué ve el cliente de las fuentes
          <div className="mt-1.5"><Select value={security.publicSources} onChange={(v) => onSecurity({ ...security, publicSources: v as SecurityConfig['publicSources'] })} ariaLabel="Fuentes visibles para el cliente" disabled={!canEditSecurity}
            options={[{ value: 'extracto', label: 'Documento y extracto', hint: 'Más transparente' }, { value: 'nombre', label: 'Solo el nombre del documento' }, { value: 'ninguna', label: 'Nada', hint: 'Más reservado' }]} /></div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">Temas prohibidos</label>
          <div className="flex items-center gap-2">
            <input value={topic} disabled={!canEditSecurity} onChange={(e) => setTopic(e.target.value)} data-testid="topic-input" placeholder="p. ej. criptomonedas, política"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
              className="flex-1 text-xs px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg disabled:opacity-50" />
            <button type="button" onClick={addTopic} disabled={!canEditSecurity || topic.trim().length < 3} data-testid="topic-add"
              className="px-3.5 py-2 bg-white border border-[color:var(--c-line)] hover:border-[#D20A2E] rounded-lg text-xs font-semibold disabled:opacity-40">Agregar</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="topic-list">
            {security.forbiddenTopics.length === 0 && <span className="text-[11px] text-[color:var(--c-muted)]">Sin temas prohibidos: el bot atiende cualquier consulta cubierta por la documentación.</span>}
            {security.forbiddenTopics.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] text-[11px] font-semibold pl-2.5 pr-1 py-0.5">
                {t}{canEditSecurity && <button type="button" aria-label={`Quitar ${t}`} onClick={() => onSecurity({ ...security, forbiddenTopics: security.forbiddenTopics.filter((x) => x !== t) })} className="w-4 h-4 rounded-full hover:bg-[#D20A2E]/15 text-[11px] leading-none">×</button>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
