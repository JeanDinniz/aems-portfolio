"""
Templates de e-mail transacional (HTML + texto puro de fallback).

Cada função retorna a tupla ``(subject, html, text)`` pronta para
``app.core.email.send_email``. HTML inline (sem dependência de engine de
template) com a identidade do AEMS (fundo escuro, âmbar #F5A800).
"""

_BRAND = "#F5A800"
_BG = "#1A1A1A"
_CARD = "#252525"
_BORDER = "#333333"


def _layout(title: str, intro: str, button_label: str, url: str, footer: str) -> str:
    """Monta o corpo HTML padrão com um botão de ação e link de fallback."""
    return f"""\
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:{_BG};font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:64px;height:3px;background:{_BRAND};"></div>
    </div>
    <div style="background:{_CARD};border:1px solid {_BORDER};border-radius:16px;padding:32px;">
      <h1 style="color:#ffffff;font-size:20px;margin:0 0 12px;">{title}</h1>
      <p style="color:#c8c8c8;font-size:14px;line-height:1.5;margin:0 0 24px;">{intro}</p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="{url}"
           style="display:inline-block;background:{_BRAND};color:{_BG};text-decoration:none;
                  font-weight:bold;font-size:14px;padding:12px 28px;border-radius:8px;">
          {button_label}
        </a>
      </div>
      <p style="color:#8a8a8a;font-size:12px;line-height:1.5;margin:0 0 8px;">
        Se o botão não funcionar, copie e cole este endereço no navegador:
      </p>
      <p style="color:{_BRAND};font-size:12px;word-break:break-all;margin:0 0 24px;">{url}</p>
      <p style="color:#6b6b6b;font-size:12px;line-height:1.5;margin:0;border-top:1px solid {_BORDER};padding-top:16px;">
        {footer}
      </p>
    </div>
    <p style="color:#5a5a5a;font-size:11px;text-align:center;margin:16px 0 0;">
      AEMS · Auto Estética
    </p>
  </div>
</body>
</html>"""


def password_reset_email(full_name: str, reset_url: str) -> tuple[str, str, str]:
    """E-mail de redefinição de senha (link com validade de 1 hora)."""
    subject = "Redefinição de senha — AEMS"
    greeting = f"Olá, {full_name}," if full_name else "Olá,"
    intro = (
        f"{greeting} recebemos um pedido para redefinir a senha da sua conta. "
        "Clique no botão abaixo para escolher uma nova senha. O link é válido por 1 hora."
    )
    footer = (
        "Se você não solicitou a redefinição, ignore este e-mail — sua senha atual continua válida."
    )
    html = _layout("Redefinir senha", intro, "Redefinir minha senha", reset_url, footer)
    text = (
        f"{greeting}\n\n"
        "Recebemos um pedido para redefinir a senha da sua conta.\n"
        f"Acesse o link para escolher uma nova senha (válido por 1 hora):\n{reset_url}\n\n"
        "Se você não solicitou, ignore este e-mail."
    )
    return subject, html, text


def welcome_email(full_name: str, set_password_url: str) -> tuple[str, str, str]:
    """E-mail de boas-vindas com link para o novo usuário definir a senha (72h)."""
    subject = "Bem-vindo(a) ao AEMS — defina sua senha"
    greeting = f"Olá, {full_name}," if full_name else "Olá,"
    intro = (
        f"{greeting} sua conta no sistema AEMS foi criada. "
        "Para começar, defina sua senha de acesso clicando no botão abaixo. "
        "O link é válido por 72 horas."
    )
    footer = "Em caso de dúvidas, fale com o responsável que criou seu acesso."
    html = _layout("Defina sua senha", intro, "Definir minha senha", set_password_url, footer)
    text = (
        f"{greeting}\n\n"
        "Sua conta no sistema AEMS foi criada.\n"
        f"Defina sua senha de acesso pelo link (válido por 72 horas):\n{set_password_url}\n"
    )
    return subject, html, text
