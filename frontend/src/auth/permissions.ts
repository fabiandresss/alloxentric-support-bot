import { Role } from '../types';

export type View = 'console' | 'agents' | 'widget' | 'analytics' | 'finops' | 'conversations' | 'kb' | 'testing' | 'users';

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin_empresa: 'Admin de empresa',
  encargado_tickets: 'Encargado de tickets',
  encargado_agente: 'Encargado del agente IA',
};

/** Vistas visibles por rol. Espejo de la matriz de permisos del backend (que es la que manda). */
const VIEWS: Record<Role, View[]> = {
  superadmin: ['console', 'conversations', 'agents', 'kb', 'testing', 'widget', 'analytics', 'finops', 'users'],
  admin_empresa: ['console', 'conversations', 'agents', 'kb', 'testing', 'widget', 'analytics', 'finops', 'users'],
  encargado_tickets: ['console', 'analytics'],
  encargado_agente: ['conversations', 'agents', 'kb', 'testing', 'widget', 'analytics'],
};

export const allowedViews = (role: Role): View[] => VIEWS[role];
export const canViewTickets = (role: Role) => VIEWS[role].includes('console');
export const canCreateCompanies = (role: Role) => role === 'superadmin';
export const canManageUsers = (role: Role) => VIEWS[role].includes('users');
/** Roles que cada actor puede asignar al crear/editar usuarios. */
export const assignableRoles = (role: Role): Role[] =>
  role === 'superadmin'
    ? ['superadmin', 'admin_empresa', 'encargado_tickets', 'encargado_agente']
    : ['admin_empresa', 'encargado_tickets', 'encargado_agente'];
