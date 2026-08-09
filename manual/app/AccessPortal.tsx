"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";

const embeddedInValor360 = process.env.NEXT_PUBLIC_VALOR360_EMBEDDED === "1";

export type AccessSessionUser = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: "admin" | "tester";
  status: "active" | "blocked";
  expiresAt: string | null;
  emailVerifiedAt: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

function AccessBrand() {
  if (embeddedInValor360) {
    return <div className="access-valor-brand"><strong>VALOR 360</strong><span>INTELIGÊNCIA AGRONÔMICA</span></div>;
  }
  return (
    <img
      className="access-product-logo"
      src="/manual-do-agronomo-branco.svg"
      alt="Manual do Agrônomo"
    />
  );
}

function GateOneCredit() {
  if (embeddedInValor360) return null;
  return (
    <div className="access-developer">
      <img src="/gate-one-pro-server.png" alt="" />
      <div>
        <span>Desenvolvido por</span>
        <strong>Gate One Soluções Digitais</strong>
        <small>CNPJ 37.192.976/0001-13</small>
      </div>
    </div>
  );
}

export default function AccessPortal({
  children,
  onUser,
}: {
  children: ReactNode;
  onUser: (user: AccessSessionUser | null) => void;
}) {
  const [user, setUser] = useState<AccessSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const confirmation = new URLSearchParams(window.location.search).get("acesso");
    if (confirmation === "confirmado") {
      setMessageKind("success");
      setMessage("Identidade confirmada. Seu acesso de avaliação está liberado.");
    } else if (confirmation === "convite-invalido") {
      setMessageKind("error");
      setMessage("Este link de confirmação é inválido ou expirou. Solicite um novo envio ao administrador.");
    } else if (confirmation === "erro-confirmacao") {
      setMessageKind("error");
      setMessage("Não foi possível confirmar o acesso agora. Tente novamente ou solicite um novo convite.");
    }
    void fetch("/api/access/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { user?: AccessSessionUser };
      })
      .then((data) => {
        const next = data?.user ?? null;
        setUser(next);
        onUser(next);
      })
      .catch(() => {
        setUser(null);
        onUser(null);
      })
      .finally(() => setLoading(false));
  }, [onUser]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setMessageKind("error");
    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json()) as {
        user?: AccessSessionUser;
        error?: string;
      };
      if (!response.ok || !data.user) {
        throw new Error(data.error || "Não foi possível entrar.");
      }
      setUser(data.user);
      onUser(data.user);
      setCurrentPassword(password);
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9]{8}$/.test(newPassword)) {
      setMessage("Use exatamente 8 caracteres, com ao menos uma letra maiúscula, uma minúscula e um número.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("A confirmação da nova senha não confere.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    setMessageKind("error");
    try {
      const response = await fetch("/api/access/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar a senha.");
      const next = user ? { ...user, mustChangePassword: false } : null;
      setUser(next);
      onUser(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível alterar a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="access-screen">
        <section className="access-card access-loading">
          <AccessBrand />
          <p>Validando acesso…</p>
          <GateOneCredit />
        </section>
      </main>
    );
  }

  if (!user) {
    if (embeddedInValor360) {
      return (
        <main className="access-screen">
          <section className="access-card">
            <AccessBrand />
            <span className="eyebrow">SESSÃO NÃO SINCRONIZADA</span>
            <h1>Entre novamente no VALOR 360</h1>
            <p>O núcleo técnico usa o mesmo acesso da plataforma. Recarregue a página depois de renovar sua sessão.</p>
          </section>
        </main>
      );
    }
    return (
      <main className="access-screen">
        <section className="access-card">
          <AccessBrand />
          <span className="eyebrow">ACESSO DE AVALIAÇÃO</span>
          <h1>Entre no seu ambiente técnico</h1>
          <p>Avaliadores entram com o e-mail confirmado. O administrador também pode usar o nome de usuário.</p>
          <form onSubmit={login}>
            <label>
              <span>E-mail ou usuário</span>
              <input
                inputMode="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="seu@email.com ou usuário"
              />
            </label>
            <label>
              <span>Senha</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Sua senha"
              />
            </label>
            <button className="button primary full-button" disabled={submitting}>
              {submitting ? "Validando…" : "Entrar"}
            </button>
          </form>
          {message && <p className={messageKind === "success" ? "access-success" : "access-error"}>{message}</p>}
          <small>Ambiente restrito para avaliação técnica.</small>
          <GateOneCredit />
        </section>
      </main>
    );
  }

  if (user.mustChangePassword) {
    return (
      <main className="access-screen">
        <section className="access-card">
          <AccessBrand />
          <span className="eyebrow">PRIMEIRO ACESSO</span>
          <h1>Crie sua senha pessoal</h1>
          <p>{user.displayName}, troque a senha temporária antes de continuar.</p>
          <form onSubmit={changePassword}>
            <label>
              <span>Senha temporária</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>Nova senha</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                maxLength={8}
                pattern="(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9]{8}"
                title="Use exatamente 8 caracteres, com ao menos uma letra maiúscula, uma minúscula e um número."
                placeholder="8 caracteres: maiúscula, minúscula e número"
              />
            </label>
            <label>
              <span>Confirmar nova senha</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={8}
              />
            </label>
            <button className="button primary full-button" disabled={submitting}>
              {submitting ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
          {message && <p className="access-error">{message}</p>}
          <GateOneCredit />
        </section>
      </main>
    );
  }

  return children;
}
