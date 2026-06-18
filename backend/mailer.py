import os
import requests
from dotenv import load_dotenv

load_dotenv()
BREVO_API_KEY = os.getenv("BREVO_API_KEY")

def enviar_email_convite(email_destino: str, link_convite: str, nome_convidante: str):
    if not BREVO_API_KEY:
        print(f"AVISO: BREVO_API_KEY não configurada. Simulação de envio para {email_destino} - Link: {link_convite}")
        return True

    url = "https://api.brevo.com/v3/smtp/email"
    # O Brevo bloqueia o envio (drop silencioso) se o remetente não for o e-mail verificado da conta.
    # Usaremos a variável de ambiente BREVO_SENDER_EMAIL, e caso não exista, usaremos o e-mail do convidante.
    sender_email = os.getenv("BREVO_SENDER_EMAIL") or nome_convidante

    payload = {
        "sender": {"name": "Financial App", "email": sender_email},
        "to": [{"email": email_destino}],
        "subject": "Convite para acessar a Base de Dados Financeira",
        "htmlContent": f"""
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&display=swap" rel="stylesheet">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #020617; color: #f8fafc; -webkit-font-smoothing: antialiased;">
            <div style="width: 100%; max-width: 600px; margin: 0 auto; padding: 40px 20px; box-sizing: border-box;">
                <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 24px; padding: 40px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                    
                    <div style="width: 64px; height: 64px; background-color: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 16px; margin: 0 auto 24px auto; line-height: 64px; text-align: center;">
                        <img src="https://img.icons8.com/ios-filled/50/6366f1/link--v1.png" alt="Link" style="vertical-align: middle; width: 32px; height: 32px;"/>
                    </div>
                    
                    <h1 style="font-size: 28px; font-weight: 900; color: #ffffff; margin: 0 0 16px 0;">Convite Exclusivo</h1>
                    
                    <p style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin: 0 0 32px 0;">
                        O usuário <strong style="color: #e2e8f0; font-weight: 600;">{nome_convidante}</strong> convidou você para acessar a base de dados financeira da organização.
                    </p>
                    
                    <div style="margin: 32px 0;">
                        <a href="{link_convite}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-weight: 600; font-size: 16px; text-decoration: none; padding: 16px 32px; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.2), 0 4px 6px -4px rgba(99, 102, 241, 0.2);">
                            Acessar Sistema e Aceitar Convite
                        </a>
                    </div>
                    
                    <p style="font-size: 14px; line-height: 1.6; color: #64748b; margin: 32px 0 0 0;">
                        Ao clicar no botão, seu e-mail já estará trancado e vinculado ao convite para criar sua conta.<br>
                        Se você já possui uma conta com este e-mail, será automaticamente transferido.
                    </p>
                    
                    <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #1e293b; font-size: 12px; color: #475569;">
                        Este link foi enviado exclusivamente para <strong style="color: #64748b;">{email_destino}</strong>. Se você não sabe do que se trata, pode ignorar este e-mail de forma segura.<br>
                        &copy; 2026 Financial App.
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
    }
    
    headers = {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"Erro ao enviar email via Brevo: {e}")
        return False

def enviar_email_confirmacao(email_destino: str, link_confirmacao: str, sender_email_fallback: str = "no-reply@financial-app.com"):
    if not BREVO_API_KEY:
        print(f"AVISO: BREVO_API_KEY não configurada. Simulação de envio para {email_destino} - Link: {link_confirmacao}")
        return True

    url = "https://api.brevo.com/v3/smtp/email"
    sender_email = os.getenv("BREVO_SENDER_EMAIL") or sender_email_fallback

    payload = {
        "sender": {"name": "Financial App", "email": sender_email},
        "to": [{"email": email_destino}],
        "subject": "Confirme seu e-mail para acessar o Financial App",
        "htmlContent": f"""
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&display=swap" rel="stylesheet">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #020617; color: #f8fafc; -webkit-font-smoothing: antialiased;">
            <div style="width: 100%; max-width: 600px; margin: 0 auto; padding: 40px 20px; box-sizing: border-box;">
                <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 24px; padding: 40px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                    
                    <div style="width: 64px; height: 64px; background-color: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; margin: 0 auto 24px auto; line-height: 64px; text-align: center;">
                        <img src="https://img.icons8.com/ios-filled/50/10b981/checked-checkbox.png" alt="Check" style="vertical-align: middle; width: 32px; height: 32px;"/>
                    </div>
                    
                    <h1 style="font-size: 28px; font-weight: 900; color: #ffffff; margin: 0 0 16px 0;">Confirme sua Conta</h1>
                    
                    <p style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin: 0 0 32px 0;">
                        Bem-vindo ao Financial App! Para concluir a criação da sua conta e validar seu e-mail, clique no botão abaixo.
                    </p>
                    
                    <div style="margin: 32px 0;">
                        <a href="{link_confirmacao}" style="display: inline-block; background-color: #10b981; color: #ffffff; font-weight: 600; font-size: 16px; text-decoration: none; padding: 16px 32px; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(16, 185, 129, 0.2), 0 4px 6px -4px rgba(16, 185, 129, 0.2);">
                            Ativar Minha Conta
                        </a>
                    </div>
                    
                    <p style="font-size: 14px; line-height: 1.6; color: #64748b; margin: 32px 0 0 0;">
                        Este link expirará em 24 horas. Se você não solicitou a criação desta conta, ignore este e-mail.
                    </p>
                    
                    <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #1e293b; font-size: 12px; color: #475569;">
                        Enviado para <strong style="color: #64748b;">{email_destino}</strong>.<br>
                        &copy; 2026 Financial App.
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
    }
    
    headers = {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"Erro ao enviar email via Brevo: {e}")
        return False
