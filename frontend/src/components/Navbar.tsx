import React, { useState } from 'react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { 
  Bell, 
  ChevronDown, 
  CheckCircle2, 
  Clock, 
  UserCheck, 
  ExternalLink,
  ShieldCheck,
  Search
} from 'lucide-react';
import { AppNotification, AuthUser } from '../types';
import { ROLE_LABELS, View } from '../auth/permissions';

interface NavbarProps {
  pendingTicketsCount: number;
  selectedTenantFilter: string;
  onSelectTenantFilter: (tenantId: string) => void;
  companies: { id: string; name: string }[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentView: View;
  user: AuthUser;
  onLogout: () => void;
  notifications?: AppNotification[];
  onOpenNotification?: (n: AppNotification) => void;
  onMarkAllNotifications?: () => void;
  showBell?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  pendingTicketsCount,
  selectedTenantFilter,
  onSelectTenantFilter,
  companies,
  searchQuery,
  onSearchChange,
  currentView,
  user,
  onLogout,
  notifications = [],
  onOpenNotification,
  onMarkAllNotifications,
  showBell = false,
}) => {
  const [userStatus, setUserStatus] = useState<'available' | 'busy' | 'break'>('available');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showTenantMenu, setShowTenantMenu] = useState(false);

  const statusConfig = {
    available: { label: 'Disponible para tickets', color: 'bg-[#22C55E]', text: 'text-[#22C55E]' },
    busy: { label: 'En llamada / Atención', color: 'bg-[#EF4444]', text: 'text-[#EF4444]' },
    break: { label: 'En pausa', color: 'bg-[#F59E0B]', text: 'text-[#F59E0B]' },
  };

  const selectedCompanyName =
    selectedTenantFilter === 'all'
      ? 'Todas las empresas'
      : companies.find((c) => c.id === selectedTenantFilter)?.name || 'Empresa';

  return (
    <header className="h-16 bg-white/80 backdrop-blur-md border-b border-[color:var(--c-line)] border-t-[3px] border-t-[#D20A2E] px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Left: Brand Logo */}
      <div className="flex items-center gap-6">
        <Logo size="md" showWordmark={true} />
      </div>

      {/* Center: Search & Tenant Filter */}
      <div className="hidden md:flex items-center gap-3 max-w-md w-full mx-4">
        {currentView === 'console' && (
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[color:var(--c-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar tickets por ID, usuario o motivo..."
              className="w-full bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[color:var(--c-ink)] placeholder:text-[color:var(--c-muted)] focus:outline-none focus:border-[#D20A2E] focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Quick Tenant Switcher (solo el superadmin ve varias empresas) */}
        {user.role === 'superadmin' && <div className="relative">
          <button
            onClick={() => {
              setShowTenantMenu(!showTenantMenu);
              setShowStatusMenu(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[color:var(--c-line)] bg-white text-xs font-medium text-[color:var(--c-ink)] hover:border-[#D20A2E] transition-colors whitespace-nowrap shadow-xs"
          >
            <span className="text-[color:var(--c-muted)]">Filtro:</span>
            <span className="font-semibold text-[#D20A2E]">{selectedCompanyName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[color:var(--c-muted)]" />
          </button>

          {showTenantMenu && (
            <div className="absolute left-0 mt-1 w-52 bg-white rounded-lg border border-[color:var(--c-line)] shadow-lg py-1 z-40">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-[color:var(--c-muted)] uppercase tracking-wider border-b border-[color:var(--c-line)]">
                Empresas SaaS
              </div>
              <button
                onClick={() => {
                  onSelectTenantFilter('all');
                  setShowTenantMenu(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[color:var(--c-canvas)] transition-colors ${
                  selectedTenantFilter === 'all' ? 'text-[#D20A2E] font-semibold bg-[color:var(--c-ch100)]' : 'text-[color:var(--c-ink)]'
                }`}
              >
                <span>Todas las empresas</span>
                {selectedTenantFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5 text-[#D20A2E]" />}
              </button>
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelectTenantFilter(c.id);
                    setShowTenantMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[color:var(--c-canvas)] transition-colors ${
                    selectedTenantFilter === c.id ? 'text-[#D20A2E] font-semibold bg-[color:var(--c-ch100)]' : 'text-[color:var(--c-ink)]'
                  }`}
                >
                  <span>{c.name}</span>
                  {selectedTenantFilter === c.id && <CheckCircle2 className="w-3.5 h-3.5 text-[#D20A2E]" />}
                </button>
              ))}
            </div>
          )}
        </div>}
      </div>

      {/* Right: Notifications & User profile */}
      <div className="flex items-center gap-3">
        {showBell && onOpenNotification && onMarkAllNotifications && <NotificationBell items={notifications} onOpen={onOpenNotification} onMarkAll={onMarkAllNotifications} />}
        <ThemeToggle />
        {/* User profile with status dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu);
              setShowTenantMenu(false);
            }}
            className="flex items-center gap-2.5 p-1 rounded-lg hover:bg-[color:var(--c-canvas)] border border-transparent hover:border-[color:var(--c-line)] transition-colors text-left"
          >
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] border border-[color:var(--c-line)] flex items-center justify-center text-xs font-bold">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                  statusConfig[userStatus].color
                }`}
              ></span>
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-xs font-semibold text-[color:var(--c-ink)]" data-testid="user-name">{user.name}</span>
              <span className="text-[11px] text-[color:var(--c-muted)]" data-testid="user-role">{ROLE_LABELS[user.role]}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[color:var(--c-muted)] hidden sm:block" />
          </button>

          {showStatusMenu && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-[color:var(--c-line)] shadow-xl py-2 z-40">
              <div className="px-4 py-2 border-b border-[color:var(--c-line)]">
                <p className="text-xs font-semibold text-[color:var(--c-ink)]">{user.name}</p>
                <p className="text-[11px] text-[color:var(--c-muted)]">{user.email}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium text-[#E8405F]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{ROLE_LABELS[user.role]}</span>
                </div>
              </div>

              <div className="px-3 py-2 text-[11px] font-semibold text-[color:var(--c-muted)] uppercase tracking-wider">
                Estado del agente
              </div>

              {(['available', 'busy', 'break'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setUserStatus(st);
                    setShowStatusMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs flex items-center justify-between hover:bg-[color:var(--c-canvas)] transition-colors ${
                    userStatus === st ? 'font-semibold bg-[color:var(--c-canvas)]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${statusConfig[st].color}`}></span>
                    <span className="text-[color:var(--c-ink)]">{statusConfig[st].label}</span>
                  </div>
                  {userStatus === st && <CheckCircle2 className="w-3.5 h-3.5 text-[#D20A2E]" />}
                </button>
              ))}

              <div className="mt-2 pt-2 border-t border-[color:var(--c-line)] px-2">
                <button
                  onClick={onLogout}
                  data-testid="logout"
                  className="w-full text-left px-2 py-2 text-xs font-semibold text-[color:var(--c-rtx)] hover:bg-[color:var(--c-rbg)] rounded-lg"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
