import React, { useCallback, useEffect, useState } from 'react';
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

  const input = 'border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#4F46E5]';

  return (
    <div className="space-y-6" data-testid="users-view">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1E1B4B]">Usuarios y roles</h1>
        <p className="text-xs text-[#64748B] mt-1">
          {me.role === 'superadmin'
            ? 'Gestiona los usuarios de todas las empresas y de la plataforma.'
            : 'Gestiona los usuarios de tu empresa y qué puede hacer cada uno.'}
        </p>
      </div>

      <form onSubmit={create} className="bg-white border border-[#E2E8F0] rounded-xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <input className={input} placeholder="Correo" type="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="new-user-email" />
        <input className={input} placeholder="Nombre" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={input} placeholder="Contraseña (mín. 8)" type="password" required minLength={8}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="new-user-password" />
        <select className={input} value={form.role} data-testid="new-user-role"
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        {me.role === 'superadmin' ? (
          <select className={input} value={form.companyId} disabled={form.role === 'superadmin'}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <span className="text-xs text-[#64748B] px-1">{companyName(me.companyId)}</span>
        )}
        <button className="px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-bold" data-testid="new-user-submit">
          + Crear usuario
        </button>
      </form>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B] text-left">
            <tr>
              <th className="px-4 py-2.5">Usuario</th>
              <th className="px-4 py-2.5">Empresa</th>
              <th className="px-4 py-2.5">Rol</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-[#64748B]">Cargando…</td></tr>}
            {users.map((u) => {
              const self = u.id === me.id;
              const locked = u.role === 'superadmin' && me.role !== 'superadmin';
              return (
                <tr key={u.id} className="border-t border-[#E2E8F0]" data-testid={`user-row-${u.email}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[#1E1B4B]">{u.name}{self && ' (tú)'}</div>
                    <div className="text-[#64748B]">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">{companyName(u.companyId)}</td>
                  <td className="px-4 py-2.5">
                    {self || locked || u.role === 'superadmin' ? (
                      ROLE_LABELS[u.role]
                    ) : (
                      <select className={input} value={u.role} onChange={(e) => patch(u, { role: e.target.value as Role })}>
                        {roles.filter((r) => r !== 'superadmin').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-md font-semibold ${u.active ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                      {u.active ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right space-x-2">
                    {!self && !locked && (
                      <>
                        <button className="text-[#4F46E5] font-semibold hover:underline" onClick={() => patch(u, { active: !u.active })}>
                          {u.active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button className="text-[#B91C1C] font-semibold hover:underline" onClick={() => remove(u)}>Eliminar</button>
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
