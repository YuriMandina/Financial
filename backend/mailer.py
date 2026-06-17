import os
import requests

BREVO_API_KEY = os.getenv("BREVO_API_KEY")

def enviar_email_convite(email_destino: str, link_convite: str, nome_convidante: str):
    if not BREVO_API_KEY:
        print(f"AVISO: BREVO_API_KEY não configurada. Simulação de envio para {email_destino} - Link: {link_convite}")
        return True

    url = "https://api.brevo.com/v3/smtp/email"
    
    payload = {
        "sender": {"name": "Financial App", "email": "no-reply@financial-app.com"},
        "to": [{"email": email_destino}],
        "subject": "Convite para acessar a Base de Dados Financeira",
        "htmlContent": f"""
        <html>
            <body>
                <h2>Você foi convidado!</h2>
                <p>O usuário <strong>{nome_convidante}</strong> convidou você para acessar a base de dados financeira da organização.</p>
                <p>Para aceitar, clique no link abaixo (ou copie e cole no navegador):</p>
                <br>
                <a href="{link_convite}" style="padding: 10px 20px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Aceitar Convite</a>
                <br><br>
                <p>Se você já possui uma conta com este email, ao aceitar, você será automaticamente transferido para a organização deste convite.</p>
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
