type AccessEmailInput = {
  to: string;
  displayName: string;
  login: string;
  temporaryPassword: string;
  preparedBy?: string;
  confirmationUrl?: string;
  trialExpiresAt?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function accessEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
      process.env.ACCESS_EMAIL_FROM?.trim(),
  );
}

export async function sendAccessEmail(input: AccessEmailInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ACCESS_EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("ACCESS_EMAIL_NOT_CONFIGURED");
  }

  const requiresConfirmation = Boolean(input.confirmationUrl);
  const expiry = input.trialExpiresAt
    ? new Date(input.trialExpiresAt).toLocaleDateString("pt-BR")
    : "definida pelo administrador";
  const name = escapeHtml(input.displayName);
  const login = escapeHtml(input.login);
  const password = escapeHtml(input.temporaryPassword);
  const confirmationUrl = input.confirmationUrl
    ? escapeHtml(input.confirmationUrl)
    : "";
  const preparedBy = escapeHtml(input.preparedBy?.trim() || "Gate One Soluções Digitais");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      reply_to: process.env.ACCESS_EMAIL_REPLY_TO?.trim() || undefined,
      subject: requiresConfirmation
        ? "Confirme seu acesso ao Manual do Agrônomo"
        : "Novo acesso ao Manual do Agrônomo",
      html: `
        <!doctype html>
        <html lang="pt-BR">
          <body style="margin:0;background:#10140f;color:#ecf3e8;font-family:Arial,sans-serif">
            <div style="max-width:620px;margin:0 auto;padding:36px 20px">
              <div style="border:1px solid #33402e;border-radius:18px;background:#171d15;padding:30px">
                <div style="display:inline-block;border-radius:10px;background:#d5f45c;color:#17200f;padding:9px 12px;font-weight:800">MA</div>
                <h1 style="margin:22px 0 8px;font-size:25px">Manual do Agrônomo</h1>
                <p style="margin:0 0 22px;color:#abb8a4;line-height:1.6">Olá, ${name}. Seu acesso de avaliação foi preparado por ${preparedBy}.</p>
                <div style="border:1px solid #33402e;border-radius:13px;background:#10140f;padding:18px">
                  <p style="margin:0 0 10px;color:#abb8a4;font-size:12px">E-mail de acesso</p>
                  <strong style="display:block;margin-bottom:18px;font-size:17px">${login}</strong>
                  <p style="margin:0 0 10px;color:#abb8a4;font-size:12px">Senha temporária</p>
                  <strong style="display:block;font-family:monospace;font-size:20px;letter-spacing:2px">${password}</strong>
                </div>
                ${
                  requiresConfirmation
                    ? `<p style="margin:22px 0 14px;color:#abb8a4;line-height:1.6">Para confirmar que este e-mail pertence a você e liberar o login, use o botão abaixo. O link é individual e válido por 72 horas.</p>
                       <a href="${confirmationUrl}" style="display:inline-block;border-radius:10px;background:#d5f45c;color:#17200f;padding:13px 18px;text-decoration:none;font-weight:800">Confirmar identidade e liberar acesso</a>`
                    : `<p style="margin:22px 0 0;color:#abb8a4;line-height:1.6">Sua senha foi redefinida. Entre novamente e crie uma senha pessoal.</p>`
                }
                <p style="margin:24px 0 0;color:#788473;font-size:12px;line-height:1.6">Validade da avaliação: ${escapeHtml(expiry)}. No primeiro acesso, será obrigatório criar uma senha pessoal com exatamente 8 caracteres, incluindo maiúscula, minúscula e número.</p>
                <p style="margin:14px 0 0;color:#788473;font-size:11px">Se você não esperava este convite, ignore esta mensagem.</p>
                <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #33402e;color:#788473;font-size:11px">Desenvolvido por Gate One Soluções Digitais · CNPJ 37.192.976/0001-13</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: [
        `Olá, ${input.displayName}.`,
        "Seu acesso de avaliação ao Manual do Agrônomo foi preparado.",
        `E-mail de acesso: ${input.login}`,
        `Senha temporária: ${input.temporaryPassword}`,
        input.confirmationUrl
          ? `Confirme sua identidade e libere o acesso: ${input.confirmationUrl}`
          : "Sua senha foi redefinida. Entre novamente e crie uma senha pessoal.",
        `Validade da avaliação: ${expiry}.`,
      ].join("\n\n"),
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`ACCESS_EMAIL_SEND_FAILED:${response.status}:${detail}`);
  }

  return (await response.json()) as { id?: string };
}
