import React, { useCallback, useEffect, useState } from 'react';
import { Select } from './Select';
import * as api from '../api/client';
import { AuthUser, Company, Role } from '../types';
import { ROLE_LABELS, assignableRoles } from '../auth/permissions';

interface Props {
  me: AuthUser;
  companies: Company[];
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
}

export const UsersView: React.FC<Props> = ({ me, companies, onToast }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const roles = assignableRoles(me.role);
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'encargado_tickets' as Role,
    companyId: me.companyId ?? companies[0]?.id ?? '',
  });
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const load = useCallback(async () => {
    try {
      setUsers(await api.getUsers());
    } catch (e) {
      onToast('warning', 'No se pudieron cargar los usuarios', err(e));
    } finally {
      setLoading(false);
    }
  }, [onToast]);
  useEffect(() => {
    load();
  }, [load]);

  const companyName = (slug: string | null) =>
    slug ? companies.find((c) => c.id === slug)?.name ?? slug : 'Plataforma';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser({
        email: form.email,
        name: form.name,
        password: form.password,
        role: form.role,
        companyId: form.role === 'superadmin' ? undefined : form.companyId,
      });
      onToast('success', 'Usuario creado', `${form.email} · ${ROLE_LABELS[form.role]}`);
      setForm({ ...form, email: '', name: '', password: '' });
      load();
    } catch (e2) {
      onToast('warning', 'No se pudo crear el usuario', err(e2));
    }
  };

  const patch = async (u: AuthUser, p: { role?: Role; active?: boolean }) => {
    try {
      const upd = await api.updateUser(u.id, p);
      setUsers((prev) => prev.map((x) => (x.id === upd.id ? upd : x)));
    } catch (e) {
      onToast('warning', 'No se pudo actualizar', err(e));
    }
  };

  const remove = async (u: AuthUser) => {
    if (!window.confirm(`¿Eliminar a ${u.email}?`)) return;
    try {
      await api.deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      onToast('info', 'Usuario eliminado', u.email);
    } catch (e) {
      onToast('warning', 'No se pudo eliminar', err(e));
    }
  };

  const input = 'w-full min-w-0 bg-white border border-[color:var(--c-line)] rounded-xl px-3.5 py-2.5 text-xs placeholder:text-[color:var(--c-faint)] transition-shadow disabled:bg-[color:var(--c-canvas)] disabled:text-[color:var(--c-faint)]';

  return (
    <div className="space-y-6" data-testid="users-view">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Usuarios y roles</h1>
        <p className="text-xs text-[color:var(--c-muted)] mt-1">
          {me.role === 'superadmin'
            ? 'Gestiona los usuarios de todas las empresas y de la plataforma.'
            : 'Gestiona los usuarios de tu empresa y qué puede hacer cada uno.'}
        </p>
      </div>

      <form onSubmit={create} className="bg-white border border-[color:var(--c-line)] rounded-2xl card-glow p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1.3fr_0.9fr_1fr_1.5fr_0.9fr_auto] gap-3 items-center">
        <input className={input} placeholder="Correo" type="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="new-user-email" />
        <input className={input} placeholder="Nombre" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={input} placeholder="Contraseña (mín. 8)" type="password" required minLength={8}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="new-user-password" />
        <Select<Role> value={form.role} onChange={(role) => setForm({ ...form, role })} ariaLabel="Rol" testId="new-user-role"
          options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        {me.role === 'superadmin' ? (
          <Select value={form.companyId} onChange={(companyId) => setForm({ ...form, companyId })} ariaLabel="Empresa"
            disabled={form.role === 'superadmin'} placeholder="Sin empresa"
            options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        ) : (
          <span className="w-full min-w-0 truncate rounded-xl bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] px-3.5 py-2.5 text-xs font-medium text-[color:var(--c-muted)]">{companyName(me.companyId)}</span>
        )}
        <button className="px-5 py-2.5 bg-[#D20A2E] hover:bg-[#B00825] text-white rounded-xl text-xs font-semibold whitespace-nowrap" data-testid="new-user-submit">
          + Crear usuario
        </button>
      </form>

      <div className="bg-white border border-[color:var(--c-line)] rounded-2xl card-glow overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
            <tr>
              <th className="px-5 py-3">Usuario</th>
              <th className="px-5 py-3">Empresa</th>
              <th className="px-5 py-3">Rol</th>
              <th className="px-5 py-3">Estado</th>
              <th className="px-5 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-[color:var(--c-muted)]">Cargando…</td></tr>}
            {users.map((u) => {
              const self = u.id === me.id;
              const locked = u.role === 'superadmin' && me.role !== 'superadmin';
              return (
                <tr key={u.id} className="border-t border-[color:var(--c-line)]" data-testid={`user-row-${u.email}`}>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-[color:var(--c-ink)]">{u.name}{self && ' (tú)'}</div>
                    <div className="text-[color:var(--c-muted)]">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">{companyName(u.companyId)}</td>
                  <td className="px-5 py-3">
                    {self || locked || u.role === 'superadmin' ? (
                      ROLE_LABELS[u.role]
                    ) : (
                      <Select<Role> size="sm" value={u.role} onChange={(role) => patch(u, { role })} ariaLabel={`Rol de ${u.name}`} className="w-56"
                        options={roles.filter((r) => r !== 'superadmin').map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-md font-semibold ${u.active ? 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]' : 'bg-[color:var(--c-soft)] text-[color:var(--c-muted)]'}`}>
                      {u.active ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right space-x-2">
                    {!self && !locked && (
                      <>
                        <button className="text-[#D20A2E] font-semibold hover:underline" onClick={() => patch(u, { active: !u.active })}>
                          {u.active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button className="text-[color:var(--c-rtx)] font-semibold hover:underline" onClick={() => remove(u)}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
