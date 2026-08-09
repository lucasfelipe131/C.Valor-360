"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccessSessionUser } from "./AccessPortal";

type ManagedUser = AccessSessionUser & {
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  eventCount: number;
  loginCount30d: number;
  activityCount30d: number;
  activeDays30d: number;
  lastActivityAt: string | null;
  lastLocation: string | null;
};

type UsageData = {
  summary: {
    totalUsers?: number;
    activeUsers?: number;
    activeUsers24h?: number;
    activeUsers7d?: number;
    activeUsers30d?: number;
    newUsers30d?: number;
    blockedUsers?: number;
    pendingUsers?: number;
    expiring7d?: number;
    logins?: number;
    logins7d?: number;
    events7d?: number;
    eventsToday?: number;
  };
  pages: Array<{ page: string; visits: number }>;
  recent: Array<{ eventType: string; page: string; createdAt: string; displayName: string; username: string }>;
  daily: Array<{ day: string; events: number; users: number; logins: number; newUsers: number }>;
  locations: Array<{ location: string; users: number }>;
  devices: Array<{ device: string; users: number; sessions: number }>;
  topUsers: Array<{ id: string; displayName: string; email: string | null; events: number; logins: number; activeDays: number; lastActivityAt: string | null }>;
  adminActions: Array<{ eventType: string; createdAt: string; displayName: string; detail: Record<string, unknown> }>;
};

type AdminFeedback = {
  id: string;
  category: "suggestion" | "problem";
  module: string;
  title: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  adminNote: string;
  createdAt: string;
  displayName: string;
  email: string | null;
};

type EditUser = {
  id: string;
  displayName: string;
  email: string;
  username: string;
  role: "tester" | "admin";
  status: "active" | "blocked";
  expiresAt: string;
};

function formatDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Ainda não acessou";
}

function dateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function eventLabel(value: string) {
  const labels: Record<string, string> = {
    admin_invitation_sent: "Convite criado",
    admin_invitation_resent: "Convite reenviado",
    admin_temp_password_created: "Senha temporária criada",
    admin_user_updated: "Login editado",
    admin_user_deleted: "Login excluído",
    admin_user_status_changed: "Status do login alterado",
    login: "Login",
    page_view: "Página acessada",
    password_changed: "Senha alterada",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function AdminFeedbackCard({
  item,
  onUpdate,
}: {
  item: AdminFeedback;
  onUpdate: (id: string, status: AdminFeedback["status"], note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.adminNote || "");
  const [saving, setSaving] = useState(false);
  const statusLabels = { open: "Recebido", in_progress: "Em análise", resolved: "Resolvido" };
  return (
    <article className={`admin-feedback-card ${item.category}`}>
      <header>
        <div>
          <span className={`feedback-status ${item.status}`}>{statusLabels[item.status]}</span>
          <small>{item.category === "problem" ? "PROBLEMA" : "SUGESTÃO"} · {item.module || "Geral"}</small>
        </div>
        <time>{formatDate(item.createdAt)}</time>
      </header>
      <h3>{item.title}</h3>
      <p>{item.message}</p>
      <div className="admin-feedback-author"><b>{item.displayName}</b><span>{item.email || "Sem e-mail"}</span></div>
      <div className="admin-feedback-controls">
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as AdminFeedback["status"])}><option value="open">Recebido</option><option value="in_progress">Em análise</option><option value="resolved">Resolvido</option></select></label>
        <label><span>Retorno ao assinante</span><textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Escreva uma resposta ou observação sobre a solução." /></label>
      </div>
      <button className="button small secondary" disabled={saving} onClick={() => { setSaving(true); void onUpdate(item.id, status, note).finally(() => setSaving(false)); }}>{saving ? "Salvando…" : "Salvar andamento"}</button>
    </article>
  );
}

export default function AdminAccessPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [currentAdminId, setCurrentAdminId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [role, setRole] = useState<"tester" | "admin">("tester");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<EditUser | null>(null);
  const [busyId, setBusyId] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [sent, setSent] = useState<{ email: string; resent?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [usersResponse, usageResponse, feedbackResponse] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/usage", { cache: "no-store" }),
        fetch("/api/feedback", { cache: "no-store" }),
      ]);
      const usersData = (await usersResponse.json()) as { users?: ManagedUser[]; currentAdminId?: string; emailConfigured?: boolean; error?: string };
      const usageData = (await usageResponse.json()) as UsageData & { error?: string };
      const feedbackData = (await feedbackResponse.json()) as { feedback?: AdminFeedback[]; error?: string };
      if (!usersResponse.ok) throw new Error(usersData.error || "Falha ao consultar usuários.");
      setUsers(usersData.users ?? []);
      setCurrentAdminId(usersData.currentAdminId ?? "");
      setEmailConfigured(usersData.emailConfigured !== false);
      if (usageResponse.ok) setUsage(usageData);
      if (feedbackResponse.ok) setFeedback(feedbackData.feedback ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar o painel.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createUser() {
    setMessage("");
    setSent(null);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email, expiresAt: expiresAt || null, role }),
    });
    const data = (await response.json()) as { user?: ManagedUser; emailSent?: boolean; error?: string };
    if (!response.ok || !data.user || !data.emailSent) {
      setMessage(data.error || "Não foi possível criar o acesso.");
      return;
    }
    setSent({ email: data.user.email || email });
    setDisplayName("");
    setEmail("");
    setExpiresAt("");
    setRole("tester");
    await load();
  }

  async function updateUser(id: string, patch: Record<string, unknown>) {
    setMessage("");
    setSent(null);
    setBusyId(id);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = (await response.json()) as { user?: ManagedUser; emailSent?: boolean; error?: string };
      if (!response.ok) {
        setMessage(data.error || "Não foi possível atualizar o usuário.");
        return false;
      }
      if (data.emailSent && data.user?.email) setSent({ email: data.user.email, resent: true });
      await load();
      return true;
    } finally {
      setBusyId("");
    }
  }

  function beginEdit(user: ManagedUser) {
    setEditing({
      id: user.id,
      displayName: user.displayName,
      email: user.email ?? "",
      username: user.username,
      role: user.role,
      status: user.status,
      expiresAt: dateInput(user.expiresAt),
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const ok = await updateUser(editing.id, {
      displayName: editing.displayName,
      email: editing.email,
      username: editing.username,
      role: editing.role,
      status: editing.status,
      expiresAt: editing.expiresAt || null,
    });
    if (ok) setEditing(null);
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Excluir definitivamente o login de ${user.displayName}? O histórico vinculado a esta conta também será removido.`)) return;
    setBusyId(user.id);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error || "Não foi possível excluir o login.");
        return;
      }
      if (editing?.id === user.id) setEditing(null);
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function updateFeedback(id: string, status: AdminFeedback["status"], adminNote: string) {
    setMessage("");
    const response = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, adminNote }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(data.error || "Não foi possível atualizar o feedback.");
      return;
    }
    await load();
  }

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pt-BR");
    return users.filter((user) => {
      const pending = Boolean(user.email && !user.emailVerifiedAt);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "pending" && pending)
        || (statusFilter === "active" && !pending && user.status === "active")
        || (statusFilter === "blocked" && !pending && user.status === "blocked")
        || (statusFilter === "admin" && user.role === "admin");
      const haystack = `${user.displayName} ${user.email ?? ""} ${user.username}`.toLocaleLowerCase("pt-BR");
      return matchesStatus && (!search || haystack.includes(search));
    });
  }, [query, statusFilter, users]);

  const maxVisits = Math.max(1, ...(usage?.pages.map((item) => Number(item.visits)) ?? [1]));
  const daily14 = (usage?.daily ?? []).slice(-14);
  const maxDaily = Math.max(1, ...daily14.map((item) => Number(item.events)));
  const maxLocations = Math.max(1, ...(usage?.locations.map((item) => Number(item.users)) ?? [1]));
  const maxDevices = Math.max(1, ...(usage?.devices.map((item) => Number(item.users)) ?? [1]));
  const openFeedback = feedback.filter((item) => item.status !== "resolved").length;

  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">GESTÃO DE ACESSOS</span>
        <h1>Painel administrativo</h1>
        <p>Gerencie assinantes, proteja os acessos e acompanhe o uso real do núcleo técnico.</p>
      </div>

      <section className="admin-metrics">
        <article><span>Assinantes</span><strong>{usage?.summary.totalUsers ?? users.length}</strong><small>logins cadastrados</small></article>
        <article><span>Ativos hoje</span><strong>{usage?.summary.activeUsers24h ?? 0}</strong><small>últimas 24 horas</small></article>
        <article><span>Ativos em 7 dias</span><strong>{usage?.summary.activeUsers7d ?? 0}</strong><small>{usage?.summary.logins7d ?? 0} logins</small></article>
        <article><span>Ativos em 30 dias</span><strong>{usage?.summary.activeUsers30d ?? 0}</strong><small>{usage?.summary.newUsers30d ?? 0} novos</small></article>
        <article><span>Pendentes</span><strong>{usage?.summary.pendingUsers ?? 0}</strong><small>aguardando confirmação</small></article>
        <article><span>Bloqueados</span><strong>{usage?.summary.blockedUsers ?? 0}</strong><small>{usage?.summary.expiring7d ?? 0} vencem em 7 dias</small></article>
        <article><span>Feedbacks</span><strong>{openFeedback}</strong><small>em acompanhamento</small></article>
      </section>

      <section className="admin-analytics-grid">
        <article className="content-panel admin-daily-panel">
          <div className="panel-title"><div><span className="eyebrow">ATIVIDADE · 14 DIAS</span><h2>Evolução de uso</h2></div><small>{usage?.summary.eventsToday ?? 0} eventos hoje</small></div>
          <div className="admin-daily-chart" aria-label="Gráfico de atividade diária">
            {daily14.map((item) => (
              <div key={item.day} title={`${item.events} eventos · ${item.users} usuários · ${item.logins} logins · ${item.newUsers} novos`}>
                <span>{item.events}</span>
                <i style={{ height: `${Math.max(4, (Number(item.events) / maxDaily) * 100)}%` }}><em>{item.users}</em></i>
                <small>{new Date(`${item.day}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small>
              </div>
            ))}
          </div>
          <div className="chart-legend"><span><i /> Eventos registrados</span><small>O número sobre a barra indica usuários únicos no dia.</small></div>
        </article>
        <article className="content-panel admin-location-panel">
          <div className="panel-title"><div><span className="eyebrow">LOCALIZAÇÃO APROXIMADA</span><h2>De onde acessam</h2></div></div>
          <div className="location-bars">
            {(usage?.locations ?? []).map((item) => (
              <div key={item.location}><span><b>{item.location}</b><small>{item.users} {item.users === 1 ? "usuário" : "usuários"}</small></span><i><em style={{ width: `${(Number(item.users) / maxLocations) * 100}%` }} /></i></div>
            ))}
            {!usage?.locations.length && <p>A cidade aparecerá quando o assinante autorizar a localização no painel de clima.</p>}
          </div>
          <small className="privacy-note">Somente cidade, estado e país aproximados. Coordenadas e IP bruto não são exibidos nem armazenados nesta métrica.</small>
        </article>
      </section>

      <section className="content-panel admin-create">
        <div className="panel-title"><div><span className="eyebrow">NOVO LOGIN</span><h2>Incluir assinante ou administrador</h2></div><span className="verified-chip">Senha temporária + confirmação</span></div>
        <div className="form-grid">
          <label className="field"><span>Nome completo *</span><div className="input-wrap"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nome completo" /></div></label>
          <label className="field"><span>E-mail de acesso *</span><div className="input-wrap"><input type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="assinante@email.com" /></div></label>
          <label className="field"><span>Perfil</span><div className="input-wrap"><select value={role} onChange={(event) => setRole(event.target.value as "tester" | "admin")}><option value="tester">Assinante</option><option value="admin">Administrador</option></select></div></label>
          <label className="field"><span>Validade</span><div className="input-wrap"><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div></label>
        </div>
        {!emailConfigured && <p className="admin-message">Configure o remetente de e-mail na Railway antes de criar os primeiros acessos.</p>}
        <button className="button primary" disabled={!displayName.trim() || !email.trim() || !emailConfigured} onClick={() => void createUser()}>Criar login e enviar acesso</button>
        {sent && <div className="temporary-access invitation-sent"><div><span>{sent.resent ? "Credencial enviada" : "Convite enviado"}</span><strong>{sent.email}</strong></div><small>A senha temporária de 8 caracteres foi enviada por e-mail e deverá ser trocada no primeiro login.</small></div>}
        {message && <p className="admin-message">{message}</p>}
      </section>

      <section className="content-panel admin-feedback-section">
        <div className="panel-title"><div><span className="eyebrow">VOZ DOS ASSINANTES</span><h2>Sugestões e problemas recebidos</h2></div><span className="verified-chip">{openFeedback} em acompanhamento</span></div>
        <div className="admin-feedback-grid">
          {feedback.map((item) => <AdminFeedbackCard key={item.id} item={item} onUpdate={updateFeedback} />)}
          {!feedback.length && <div className="feedback-empty"><strong>Nenhum feedback recebido</strong><p>Os envios feitos pelos assinantes aparecerão aqui.</p></div>}
        </div>
      </section>

      <section className="admin-layout">
        <div className="content-panel">
          <div className="panel-title"><div><span className="eyebrow">LOGINS</span><h2>Usuários e permissões</h2></div>{loading && <small>Atualizando…</small>}</div>
          <div className="form-grid">
            <label className="field"><span>Buscar login</span><div className="input-wrap"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, e-mail ou usuário" /></div></label>
            <label className="field"><span>Filtrar</span><div className="input-wrap"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="active">Ativos</option><option value="pending">Pendentes</option><option value="blocked">Bloqueados</option><option value="admin">Administradores</option></select></div></label>
          </div>
          <div className="admin-user-list">
            {filteredUsers.map((user) => {
              const pending = Boolean(user.email && !user.emailVerifiedAt);
              const isSelf = user.id === currentAdminId;
              const isEditing = editing?.id === user.id;
              return (
                <article key={user.id} className={user.status === "blocked" && !pending ? "blocked" : ""}>
                  <div className="admin-user-main">
                    <span className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{user.displayName}</strong><small>{user.email || `@${user.username}`} · @{user.username} · {user.role === "admin" ? "Administrador" : "Assinante"}</small></div>
                    <b className={`access-status ${pending ? "pending" : user.status}`}>{pending ? "AGUARDANDO CONFIRMAÇÃO" : user.status === "active" ? "ATIVO" : "BLOQUEADO"}</b>
                  </div>
                  <div className="admin-user-facts">
                    <span><b>{formatDate(user.lastLoginAt)}</b>Último login</span>
                    <span><b>{formatDate(user.lastActivityAt)}</b>Última atividade</span>
                    <span><b>{user.loginCount30d ?? 0}</b>Logins em 30 dias</span>
                    <span><b>{user.activeDays30d ?? 0}</b>Dias ativos em 30 dias</span>
                    <span><b>{user.expiresAt ? new Date(user.expiresAt).toLocaleDateString("pt-BR") : "Sem prazo"}</b>Validade</span>
                    <span><b>{user.lastLocation || "Não informada"}</b>Localização aproximada</span>
                  </div>
                  {isEditing && editing && (
                    <div className="form-grid">
                      <label className="field"><span>Nome</span><div className="input-wrap"><input value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} /></div></label>
                      <label className="field"><span>E-mail</span><div className="input-wrap"><input type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} /></div></label>
                      <label className="field"><span>Usuário</span><div className="input-wrap"><input value={editing.username} onChange={(event) => setEditing({ ...editing, username: event.target.value })} /></div></label>
                      <label className="field"><span>Perfil</span><div className="input-wrap"><select value={editing.role} disabled={isSelf} onChange={(event) => setEditing({ ...editing, role: event.target.value as "tester" | "admin" })}><option value="tester">Assinante</option><option value="admin">Administrador</option></select></div></label>
                      <label className="field"><span>Status</span><div className="input-wrap"><select value={editing.status} disabled={isSelf || pending} onChange={(event) => setEditing({ ...editing, status: event.target.value as "active" | "blocked" })}><option value="active">Ativo</option><option value="blocked">Bloqueado</option></select></div></label>
                      <label className="field"><span>Validade</span><div className="input-wrap"><input type="date" value={editing.expiresAt} onChange={(event) => setEditing({ ...editing, expiresAt: event.target.value })} /></div></label>
                    </div>
                  )}
                  <div className="card-actions">
                    {isEditing ? <><button disabled={busyId === user.id} onClick={() => void saveEdit()}>Salvar alterações</button><button onClick={() => setEditing(null)}>Cancelar</button></> : <button onClick={() => beginEdit(user)}>Editar login</button>}
                    {pending ? <button disabled={busyId === user.id} onClick={() => void updateUser(user.id, { resendInvitation: true })}>Reenviar convite</button> : <button disabled={busyId === user.id || !user.email} onClick={() => void updateUser(user.id, { resetPassword: true })}>Criar senha temporária</button>}
                    {!pending && !isSelf && <button disabled={busyId === user.id} onClick={() => void updateUser(user.id, { status: user.status === "active" ? "blocked" : "active" })}>{user.status === "active" ? "Bloquear" : "Reativar"}</button>}
                    {!isSelf && <button className="danger" disabled={busyId === user.id} onClick={() => void deleteUser(user)}>Excluir login</button>}
                  </div>
                </article>
              );
            })}
            {!filteredUsers.length && <p>Nenhum login encontrado com estes filtros.</p>}
          </div>
        </div>

        <aside className="content-panel admin-usage">
          <div className="panel-title"><div><span className="eyebrow">USO POR ÁREA</span><h2>Páginas mais usadas</h2></div></div>
          <div className="usage-bars">
            {(usage?.pages ?? []).map((item) => <div key={item.page}><span><b>{item.page}</b><small>{item.visits} visitas em 30 dias</small></span><i><em style={{ width: `${(Number(item.visits) / maxVisits) * 100}%` }} /></i></div>)}
            {!usage?.pages.length && <p>A atividade aparecerá após os primeiros acessos.</p>}
          </div>
          <div className="recent-activity"><h3>Dispositivos</h3>{(usage?.devices ?? []).map((item) => <div key={item.device}><span><b>{item.device}</b><small>{item.sessions} sessões</small></span><i style={{ width: `${(Number(item.users) / maxDevices) * 100}%` }} /></div>)}</div>
          <div className="recent-activity"><h3>Usuários mais ativos · 30 dias</h3>{(usage?.topUsers ?? []).slice(0, 8).map((item) => <div key={item.id}><span><b>{item.displayName}</b><small>{item.events} eventos · {item.logins} logins · {item.activeDays} dias</small></span><time>{formatDate(item.lastActivityAt)}</time></div>)}</div>
        </aside>
      </section>

      <section className="admin-analytics-grid">
        <article className="content-panel">
          <div className="panel-title"><div><span className="eyebrow">AUDITORIA</span><h2>Ações administrativas</h2></div></div>
          <div className="recent-activity">
            {(usage?.adminActions ?? []).map((item, index) => <div key={`${item.createdAt}-${index}`}><span><b>{item.displayName}</b><small>{eventLabel(item.eventType)}</small></span><time>{formatDate(item.createdAt)}</time></div>)}
            {!usage?.adminActions.length && <p>As alterações de acesso aparecerão aqui.</p>}
          </div>
        </article>
        <article className="content-panel">
          <div className="panel-title"><div><span className="eyebrow">ATIVIDADE RECENTE</span><h2>Últimos eventos</h2></div></div>
          <div className="recent-activity">{(usage?.recent ?? []).slice(0, 16).map((item, index) => <div key={`${item.createdAt}-${index}`}><span><b>{item.displayName}</b><small>{eventLabel(item.eventType)}{item.page ? ` · ${item.page}` : ""}</small></span><time>{formatDate(item.createdAt)}</time></div>)}</div>
        </article>
      </section>
    </>
  );
}
