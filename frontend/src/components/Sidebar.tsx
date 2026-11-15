import React from 'react';
import { motion } from 'motion/react';
import { Inbox, Building2, MessageSquare, MessagesSquare, BarChart3, Wallet, Users, LibraryBig, FlaskConical, type LucideIcon } from 'lucide-react';
import { View } from '../auth/permissions';

interface SidebarProps {
  currentView: View;
  onSelectView: (view: View) => void;
  allowedViews: View[];
  pendingCount: number;
  activeCompaniesCount: number;
  badges?: Partial<Record<View, number>>;   // avisos sin ver por pantalla (pruebas, consumo)
}

const ITEMS: { view: View; label: string; icon: LucideIcon; testId?: string }[] = [
  { view: 'console', label: 'Consola de soporte', icon: Inbox },
  { view: 'conversations', label: 'Conversaciones', icon: MessagesSquare, testId: 'nav-conversations' },
  { view: 'agents', label: 'Empresas y agentes', icon: Building2 },
  { view: 'kb', label: 'Base de conocimiento', icon: LibraryBig, testId: 'nav-kb' },
  { view: 'testing', label: 'Pruebas del agente', icon: FlaskConical, testId: 'nav-testing' },
  { view: 'widget', label: 'Vista previa del widget', icon: MessageSquare },
  { view: 'analytics', label: 'Analítica', icon: BarChart3 },
  { view: 'finops', label: 'Consumo y costos', icon: Wallet, testId: 'nav-finops' },
  { view: 'users', label: 'Usuarios y roles', icon: Users, testId: 'nav-users' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  allowedViews,
  pendingCount,
  activeCompaniesCount,
  badges = {},
}) => {
  return (
    <aside className="w-[68px] lg:w-64 bg-white/70 backdrop-blur-sm border-r border-[color:var(--c-line)] flex flex-col justify-between shrink-0 select-none z-20">
      <div className="p-3 lg:p-4 space-y-6">
        <div>
          <div className="hidden lg:block px-3 pb-2 text-[11px] font-semibold text-[color:var(--c-faint)] uppercase tracking-[0.14em]">Navegación</div>
          <nav className="space-y-1">
            {ITEMS.filter((i) => allowedViews.includes(i.view)).map(({ view, label, icon: Icon, testId }) => {
              const active = currentView === view;
              return (
                <button
                  key={view}
                  onClick={() => onSelectView(view)}
                  data-testid={testId}
                  title={label}
                  className={`group relative w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                    active ? 'text-[#D20A2E] font-semibold' : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-canvas)]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl bg-[color:var(--c-ch100)] ring-1 ring-[color:var(--c-ch350)]/70"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  {active && (
                    <motion.span
                      layoutId="nav-bar"
                      className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-[#D20A2E]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon className={`relative w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${active ? 'text-[#D20A2E]' : 'text-[color:var(--c-muted)] group-hover:text-[#D20A2E]'}`} />
                  <span className="relative flex-1 text-left hidden lg:inline">{label}</span>
                  {view === 'console' && pendingCount > 0 && (
                    <span className="absolute top-1 right-1 lg:static lg:top-auto lg:right-auto min-w-5 h-5 px-1.5 rounded-full bg-[#D20A2E] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {pendingCount}
                    </span>
                  )}
                  {(view === 'testing' || view === 'finops') && (badges[view] ?? 0) > 0 && (
                    <span data-testid={`badge-${view}`} className="absolute top-1 right-1 lg:static lg:top-auto lg:right-auto min-w-5 h-5 px-1.5 rounded-full bg-[#D20A2E] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {badges[view]}
                    </span>
                  )}
                  {view === 'agents' && activeCompaniesCount > 0 && (
                    <span className="relative hidden lg:inline text-[10px] font-semibold text-[color:var(--c-faint)] tabular-nums">{activeCompaniesCount}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

    </aside>
  );
};
