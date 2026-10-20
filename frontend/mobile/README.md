# App de Contagem (Android)

App Android (Capacitor) usado pela equipe para lançar as contagens dos inventários no celular.
Funciona offline: os lançamentos ficam no aparelho e são enviados quando a conexão volta.

## Preparar o servidor (uma vez)

1. **IP fixo do PC**: reserve no roteador o IP atual do servidor (ex: `192.168.0.11`) para ele não mudar.
2. **Backend acessível na rede**: inicie o backend escutando em todas as interfaces:
   ```
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
3. **Firewall do Windows** (PowerShell como administrador):
   ```
   New-NetFirewallRule -DisplayName "Financial API 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
   ```
   A rede Wi-Fi da loja precisa estar marcada como **Privada** no Windows.

## Gerar e publicar o APK

Requisitos: JDK 21 (`winget install EclipseAdoptium.Temurin.21.JDK`) e Android SDK.

```
cd frontend
npm run apk
```

O comando gera o APK assinado e o publica em `backend/static/mobile/`. Os celulares baixam pelo endereço
`http://<IP-do-servidor>:8000/api/estoque/app/apk`.

**Nova versão**: aumente `versionCode` (e `versionName`) em `frontend/mobile-version.json` antes do
`npm run apk`. Os aparelhos com versão antiga mostram o aviso "Nova versão disponível".

## Chave de assinatura (IMPORTANTE)

`frontend/android-signing/` (fora do git) contém a chave que assina o app.
**Guarde uma cópia em local seguro.** Sem ela não é possível atualizar o app instalado: seria
preciso desinstalar, e lançamentos ainda não sincronizados no aparelho seriam perdidos.

## Instalar no celular

1. No celular, conectado ao Wi-Fi da loja, abra no navegador:
   `http://<IP-do-servidor>:8000/api/estoque/app/apk`
2. Permita "instalar apps desta fonte" quando o Android pedir.
3. Abra o app, confira o endereço do servidor (botão de teste ao lado) e entre com o usuário do sistema.
   Usuários com papel **CONTADOR** veem apenas a contagem (sem saldos do sistema).

O leitor de código de barras usa o Google Play Services e é baixado automaticamente no primeiro uso
(precisa de internet nesse momento). Leitores Bluetooth também funcionam: eles "digitam" o código no
campo de busca.

## Desenvolvimento

- `npm run dev:mobile` abre o app no navegador do PC (porta 5174), sem leitor de câmera.
- `npm test` executa os testes da lógica de contagem e da fila offline.
