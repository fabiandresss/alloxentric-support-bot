import React from 'react';
import { 
  Inbox, 
  Building2, 
  Layers,
  MessageSquare,
  BarChart3,
  Sparkles,
  Users
} from 'lucide-react';
import { View } from '../auth/permissions';

interface SidebarProps {
  currentView: View;
  onSelectView: (view: View) => void;
  allowedViews: View[];
  pendingCount: number;
  activeCompaniesCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  allowedViews,
  pendingCount,
  activeCompaniesCount,
}) => {
  return (
    <aside className="w-64 bg-white border-r border-[#E2E8F0] flex flex-col justify-between shrink-0 select-none z-20">
      <div className="p-4 space-y-6">
        {/* Navigation Section */}
        <div>
          <div className="px-3 pb-2 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
            Navegación
          </div>
          <nav className="space-y-1">
            {/* Vista 1: Consola de soporte */}
            {allowedViews.includes('console') && (
            <button
              onClick={() => onSelectView('console')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                currentView === 'console'
                  ? 'bg-[#EEF2FF] text-[#4F46E5] font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F8FAFC]'
              }`}
            >
              <Inbox
                className={`w-4 h-4 shrink-0 ${
                  currentView === 'console' ? 'text-[#4F46E5]' : 'text-[#64748B]'
                }`}
              />
              <span>Consola de soporte</span>
            </button>
            )}

            {/* Vista 2: Empresas y agentes */}
            {allowedViews.includes('agents') && (
            <button
              onClick={() => onSelectView('agents')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                currentView === 'agents'
                  ? 'bg-[#EEF2FF] text-[#4F46E5] font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F8FAFC]'
              }`}
            >
              <Building2
                className={`w-4 h-4 shrink-0 ${
                  currentView === 'agents' ? 'text-[#4F46E5]' : 'text-[#64748B]'
                }`}
              />
              <span>Empresas y agentes</span>
            </button>
            )}

            {/* Vista 3: Vista previa del widget */}
            {allowedViews.includes('widget') && (
            <button
              onClick={() => onSelectView('widget')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                currentView === 'widget'
                  ? 'bg-[#EEF2FF] text-[#4F46E5] font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F8FAFC]'
              }`}
            >
              <MessageSquare
                className={`w-4 h-4 shrink-0 ${
                  currentView === 'widget' ? 'text-[#4F46E5]' : 'text-[#64748B]'
                }`}
              />
              <span>Vista previa del widget</span>
            </button>
            )}

            {/* Vista 4: Analítica */}
            {allowedViews.includes('analytics') && (
            <button
              onClick={() => onSelectView('analytics')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                currentView === 'analytics'
                  ? 'bg-[#EEF2FF] text-[#4F46E5] font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F8FAFC]'
              }`}
            >
              <BarChart3
                className={`w-4 h-4 shrink-0 ${
                  currentView === 'analytics' ? 'text-[#4F46E5]' : 'text-[#64748B]'
                }`}
              />
              <span>Analítica</span>
            </button>
            )}
            {allowedViews.includes('users') && (
              <button
                onClick={() => onSelectView('users')}
                data-testid="nav-users"
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  currentView === 'users'
                    ? 'bg-[#EEF2FF] text-[#4F46E5] font-semibold shadow-xs'
                    : 'text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F8FAFC]'
                }`}
              >
                <Users className={`w-4 h-4 shrink-0 ${currentView === 'users' ? 'text-[#4F46E5]' : 'text-[#64748B]'}`} />
                <span>Usuarios y roles</span>
              </button>
            )}
          </nav>
        </div>
      </div>

      {/* Footer Branding Info */}
      <div className="p-4 border-t border-[#E2E8F0] bg-white">
        <div className="flex items-center justify-between text-[11px] text-[#64748B]">
          <span className="flex items-center gap-1 font-medium">
            <Layers className="w-3.5 h-3.5 text-[#4F46E5]" />
            Corestream Desk
          </span>
          <span className="text-[10px] text-[#94A3B8]">v2.6.4</span>
        </div>
        <p className="text-[10px] text-[#94A3B8] mt-1">
          Alloxentric AI Conversational Suite
        </p>
      </div>
    </aside>
  );
};
