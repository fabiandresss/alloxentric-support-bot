import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { CorestreamConsole } from './components/CorestreamConsole';
import { AgentDeploymentPanel } from './components/AgentDeploymentPanel';
import { WidgetPreview } from './components/WidgetPreview';
import { AnalyticsView } from './components/AnalyticsView';
import { ToastContainer, ToastMessage } from './components/Toast';
import { Logo } from './components/Logo';
import * as api from './api/client';
import { LoginScreen } from './components/LoginScreen';
import { UsersView } from './components/UsersView';
import { allowedViews, canViewTickets, canCreateCompanies, View } from './auth/permissions';
import { AuthUser, AssignableAgent, Company, Ticket, SystemMetrics } from './types';

const EMPTY_METRICS: SystemMetrics = {
  openTickets: 0,
  urgentTickets: 0,
  avgResolutionTime: '—',
  botResolvedToday: 0,
  botResolutionRate: 0,
  escalationRate: 0,
  totalConversationsToday: 0,
};

export default function App() {
  // ---- sesión: si hay token guardado se valida con /auth/me; si no, se muestra el login ----
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(!api.hasToken());

  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null)); // token vencido o usuario desactivado
    if (api.hasToken()) {
      api.getMe().then(setUser).catch(() => api.logout()).finally(() => setAuthChecked(true));
    }
  }, []);

  if (!authChecked) return <div className="min-h-screen flex items-center justify-center text-xs text-[#64748B]">Cargando…</div>;
  if (!user) return <LoginScreen onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => { api.logout(); setUser(null); }} />;
}

function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const views = allowedViews(user.role);
  const [currentView, setCurrentView] = useState<View>(views[0]);
  const [previewCompanyId, setPreviewCompanyId] = useState<string>('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics>(EMPTY_METRICS);
  const [agents, setAgents] = useState<AssignableAgent[]>([]);
  const [selectedTenantFilter, setSelectedTenantFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const addToast = useCallback((type: ToastMessage['type'], title: string, description?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Carga inicial + refresco periódico (tickets nuevos creados desde el widget, etc.)
  const refreshAll = useCallback(async (silent = false) => {
    try {
      // cada rol pide solo lo que puede ver (el backend igual lo valida)
      const puedeTickets = canViewTickets(user.role);
      const [c, t, m, a] = await Promise.all([
        api.getCompanies(),
        puedeTickets ? api.getTickets() : Promise.resolve([] as Ticket[]),
        api.getMetrics(),
        puedeTickets ? api.getAssignableAgents() : Promise.resolve([] as AssignableAgent[]),
      ]);
      setCompanies(c);
      setTickets(t);
      setAgents(a);
      setMetrics(m);
      setPreviewCompanyId((prev) => prev || c[0]?.id || '');
      setBackendError(null);
    } catch (e) {
      if (!silent) setBackendError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [user.role]);

  useEffect(() => {
    refreshAll();
    const timer = setInterval(() => refreshAll(true), 15000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  const refreshMetrics = () => api.getMetrics().then(setMetrics).catch(() => undefined);

  const replaceTicket = (updated: Ticket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  // Ticket status update handler
  const handleUpdateTicketStatus = async (ticketId: string, newStatus: Ticket['status']) => {
    try {
      const updated = await api.updateTicket(ticketId, { status: newStatus });
      replaceTicket(updated);
      const ticketNum = updated.ticketNumber;

      if (newStatus === 'resuelto') {
        addToast(
          'success',
          `Ticket ${ticketNum} marcado como Resuelto`,
          'El caso fue cerrado en Corestream y se notificó al usuario.'
        );
      } else if (newStatus === 'urgente') {
        addToast(
          'warning',
          `Ticket ${ticketNum} escalado a Nivel Crítico`,
          'Prioridad aumentada. Guardias de Corestream notificadas.'
        );
      } else {
        addToast('info', `Estado de ${ticketNum} actualizado a Pendiente`);
      }
      refreshMetrics();
    } catch (e) {
      addToast('warning', 'No se pudo actualizar el ticket', errMsg(e));
    }
  };

  // Agent reply sender
  const handleSendAgentReply = async (ticketId: string, text: string) => {
    try {
      const updated = await api.replyTicket(ticketId, text);
      replaceTicket(updated);
      addToast(
        'success',
        `Respuesta enviada a ${updated.customerName || 'cliente'}`,
        `Mensaje despachado vía ${updated.customerChannel || 'chat'}. Caso resuelto.`
      );
      refreshMetrics();
    } catch (e) {
      addToast('warning', 'No se pudo enviar la respuesta', errMsg(e));
    }
  };

  // Reassign agent
  const handleReassignAgent = async (ticketId: string, agentId: string | null, agentName: string) => {
    try {
      replaceTicket(await api.updateTicket(ticketId, { assignedAgentId: agentId }));
      addToast('info', agentId ? `Ticket reasignado a ${agentName}` : 'Ticket sin asignar');
    } catch (e) {
      addToast('warning', 'No se pudo reasignar el ticket', errMsg(e));
    }
  };

  // Company management
  const handleUpdateCompany = async (updatedCompany: Company) => {
    try {
      // nombre e industria de la empresa solo los cambia su admin o el superadmin (el backend responde 403 al resto)
      const editaEmpresa = user.role === 'superadmin' || user.role === 'admin_empresa';
      const saved = await api.updateCompany(updatedCompany.id, {
        ...(editaEmpresa ? { name: updatedCompany.name, industry: updatedCompany.industry } : {}),
        agentName: updatedCompany.agentName,
        agentStatus: updatedCompany.agentStatus,
        tone: updatedCompany.tone,
        customInstructions: updatedCompany.customInstructions,
        ragThreshold: updatedCompany.ragThreshold,
      });
      setCompanies((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      addToast(
        'success',
        `Agente de ${saved.name} actualizado`,
        'La configuración del agente fue guardada en el backend.'
      );
    } catch (e) {
      addToast('warning', 'No se pudo guardar la empresa', errMsg(e));
    }
  };

  const handleAddCompany = async (newCompany: Company) => {
    try {
      const created = await api.createCompany({
        name: newCompany.name,
        industry: newCompany.industry,
        agentName: newCompany.agentName,
        tone: newCompany.tone,
        customInstructions: newCompany.customInstructions,
        brandColor: newCompany.brandColor,
        brandBg: newCompany.brandBg,
        logoInitials: newCompany.logoInitials,
      });
      setCompanies((prev) => [created, ...prev]);
      addToast(
        'success',
        `Empresa "${created.name}" incorporada`,
        'Tenant creado. Genera su API key desde "Widget embebible" en la configuración del agente.'
      );
    } catch (e) {
      addToast('warning', 'No se pudo crear la empresa', errMsg(e));
    }
  };

  const pendingTicketsCount = tickets.filter(
    (t) => t.status === 'pendiente' || t.status === 'urgente'
  ).length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E1B4B] flex flex-col font-['Plus_Jakarta_Sans',sans-serif] relative overflow-x-hidden">
      {/* Subtle background watermark logo in bottom right */}
      <div className="fixed -bottom-16 -right-16 z-0 pointer-events-none opacity-[0.035]">
        <Logo size="watermark" />
      </div>

      {/* Top Navbar */}
      <Navbar
        pendingTicketsCount={pendingTicketsCount}
        selectedTenantFilter={selectedTenantFilter}
        onSelectTenantFilter={setSelectedTenantFilter}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        currentView={currentView}
        user={user}
        onLogout={onLogout}
      />

      {/* Main Content Layout with Fixed Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          currentView={currentView}
          onSelectView={setCurrentView}
          allowedViews={views}
          pendingCount={pendingTicketsCount}
          activeCompaniesCount={companies.length}
        />

        {/* Viewport Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-[1500px] w-full mx-auto relative z-10">
          {backendError && (
            <div className="mb-4 p-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] text-xs text-[#991B1B] flex items-start justify-between gap-4">
              <div>
                <p className="font-bold">No se pudo cargar la información del backend</p>
                <p className="mt-1">{backendError}</p>
                <p className="mt-1 text-[#B91C1C]">
                  ¿Está corriendo? Desde <code>backend/</code>: <code>uvicorn app.main:app --reload</code>
                </p>
              </div>
              <button
                onClick={() => refreshAll()}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-[#FCA5A5] font-semibold hover:bg-[#FEE2E2]"
              >
                Reintentar
              </button>
            </div>
          )}
          {loading && !backendError && (
            <div className="py-24 text-center text-xs text-[#64748B]">Conectando con el backend…</div>
          )}
          {!loading && currentView === 'console' && (
            <CorestreamConsole
              tickets={tickets}
              agents={agents}
              currentUserName={user.name}
              metrics={metrics}
              onUpdateTicketStatus={handleUpdateTicketStatus}
              onSendAgentReply={handleSendAgentReply}
              onReassignAgent={handleReassignAgent}
              selectedTenantFilter={selectedTenantFilter}
              searchQuery={searchQuery}
              onResetFilters={() => {
                setSelectedTenantFilter('all');
                setSearchQuery('');
              }}
            />
          )}

          {!loading && currentView === 'agents' && (
            <AgentDeploymentPanel
              companies={companies}
              onUpdateCompany={handleUpdateCompany}
              onAddCompany={handleAddCompany}
              canCreateCompany={canCreateCompanies(user.role)}
              onOpenWidgetPreview={(companyId) => {
                setPreviewCompanyId(companyId);
                setCurrentView('widget');
                addToast(
                  'info',
                  'Simulador de Widget Activado',
                  'Previsualizando el asistente virtual con el corpus RAG de la empresa.'
                );
              }}
            />
          )}

          {!loading && currentView === 'widget' && companies.length > 0 && (
            <WidgetPreview
              companies={companies}
              selectedCompanyId={previewCompanyId}
              onTicketCreated={() => refreshAll(true)}
              onNavigateToConsole={(ticketId) => {
                setCurrentView('console');
                if (ticketId) {
                  setSearchQuery(ticketId);
                }
                addToast(
                  'info',
                  `Navegando a Consola Corestream`,
                  ticketId ? `Filtrando por el ticket ${ticketId}` : 'Mostrando cola de casos derivados'
                );
              }}
            />
          )}

          {!loading && currentView === 'users' && (
            <UsersView me={user} companies={companies} onToast={addToast} />
          )}

          {!loading && currentView === 'analytics' && (
            <AnalyticsView />
          )}
        </main>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
