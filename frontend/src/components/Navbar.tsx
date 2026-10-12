import React, { useState } from 'react';
import { Logo } from './Logo';
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
import { AuthUser } from '../types';
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
    <header className="h-16 bg-white border-b border-[#E2E8F0] px-6 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {/* Left: Brand Logo */}
      <div className="flex items-center gap-6">
        <Logo size="md" showWordmark={true} />
      </div>

      {/* Center: Search & Tenant Filter */}
      <div className="hidden md:flex items-center gap-3 max-w-md w-full mx-4">
        {currentView === 'console' && (
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar tickets por ID, usuario o motivo..."
              className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#1E1B4B] placeholder:text-[#64748B] focus:outline-none focus:border-[#4F46E5] focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#64748B] hover:text-[#1E1B4B]"
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
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-xs font-medium text-[#1E1B4B] hover:border-[#4F46E5] transition-colors whitespace-nowrap shadow-xs"
          >
            <span className="text-[#64748B]">Filtro:</span>
            <span className="font-semibold text-[#4F46E5]">{selectedCompanyName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />
          </button>

          {showTenantMenu && (
            <div className="absolute left-0 mt-1 w-52 bg-white rounded-lg border border-[#E2E8F0] shadow-lg py-1 z-40">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider border-b border-[#E2E8F0]">
                Empresas SaaS
              </div>
              <button
                onClick={() => {
                  onSelectTenantFilter('all');
                  setShowTenantMenu(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#F8FAFC] transition-colors ${
                  selectedTenantFilter === 'all' ? 'text-[#4F46E5] font-semibold bg-[#EEF2FF]' : 'text-[#1E1B4B]'
                }`}
              >
                <span>Todas las empresas</span>
                {selectedTenantFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5 text-[#4F46E5]" />}
              </button>
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelectTenantFilter(c.id);
                    setShowTenantMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#F8FAFC] transition-colors ${
                    selectedTenantFilter === c.id ? 'text-[#4F46E5] font-semibold bg-[#EEF2FF]' : 'text-[#1E1B4B]'
                  }`}
                >
                  <span>{c.name}</span>
                  {selectedTenantFilter === c.id && <CheckCircle2 className="w-3.5 h-3.5 text-[#4F46E5]" />}
                </button>
              ))}
            </div>
          )}
        </div>}
      </div>

      {/* Right: Notifications & User profile */}
      <div className="flex items-center gap-4">
        {/* User profile with status dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu);
              setShowTenantMenu(false);
            }}
            className="flex items-center gap-2.5 p-1 rounded-lg hover:bg-[#F8FAFC] border border-transparent hover:border-[#E2E8F0] transition-colors text-left"
          >
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-[#EEF2FF] text-[#4F46E5] border border-[#E2E8F0] flex items-center justify-center text-xs font-bold">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                  statusConfig[userStatus].color
                }`}
              ></span>
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-xs font-semibold text-[#1E1B4B]" data-testid="user-name">{user.name}</span>
              <span className="text-[11px] text-[#64748B]" data-testid="user-role">{ROLE_LABELS[user.role]}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-[#64748B] hidden sm:block" />
          </button>

          {showStatusMenu && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-[#E2E8F0] shadow-xl py-2 z-40">
              <div className="px-4 py-2 border-b border-[#E2E8F0]">
                <p className="text-xs font-semibold text-[#1E1B4B]">{user.name}</p>
                <p className="text-[11px] text-[#64748B]">{user.email}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium text-[#14B8A6]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{ROLE_LABELS[user.role]}</span>
                </div>
              </div>

              <div className="px-3 py-2 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                Estado del agente
              </div>

              {(['available', 'busy', 'break'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setUserStatus(st);
                    setShowStatusMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs flex items-center justify-between hover:bg-[#F8FAFC] transition-colors ${
                    userStatus === st ? 'font-semibold bg-[#F8FAFC]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${statusConfig[st].color}`}></span>
                    <span className="text-[#1E1B4B]">{statusConfig[st].label}</span>
                  </div>
                  {userStatus === st && <CheckCircle2 className="w-3.5 h-3.5 text-[#4F46E5]" />}
                </button>
              ))}

              <div className="mt-2 pt-2 border-t border-[#E2E8F0] px-2">
                <button
                  onClick={onLogout}
                  data-testid="logout"
                  className="w-full text-left px-2 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg"
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
