# Uberduck Text-to-Speech Setup

Este guia explica como configurar a API do Uberduck para text-to-speech no site Akai Inu.

## Pré-requisitos

1. Conta no Uberduck.ai
2. API Key do Uberduck (300 créditos grátis disponíveis)

## Configuração

### 1. Obter API Key

1. Acesse [uberduck.ai](https://uberduck.ai/)
2. Crie uma conta ou faça login
3. Navegue até a seção de API
4. Copie sua API Key

### 2. Configurar o site

1. Copie o arquivo de exemplo:
   ```bash
   cp config.example.js config.js
   ```

2. Abra `config.js` e substitua `YOUR_UBERDUCK_API_KEY_HERE` pela sua API key real:
   ```javascript
   const API_CONFIG = {
       UBERDUCK: {
           API_KEY: 'sua-api-key-aqui',
           VOICE_MODEL: 'en-us-casual-k',
           MAX_CHARS: 1500,
           API_URL: 'https://api.uberduck.ai/speak'
       }
   };
   ```

3. Salve o arquivo

### 3. Testar

1. Abra o site no navegador
2. Ative o som clicando no botão de voz
3. Quando Akai Inu falar, você deve ouvir a voz do Uberduck
4. Verifique o console do navegador para confirmar:
   ```
   📢 speakText() called
      Using Uberduck API...
   🎙️ speakWithUberduck() starting...
      Calling Uberduck API...
      ✅ Audio URL received: ...
   ```

## Voz Escolhida

**Voice Model**: `en-us-casual-k`
- Voz masculina americana amigável e casual
- Ideal para conversação natural
- Tom amigável e acessível

## Limites e Créditos

- **Limite por request**: 1500 caracteres
- **Créditos grátis**: 300 créditos iniciais
- Textos maiores que 1500 caracteres serão automaticamente truncados

## Fallback

Se a API do Uberduck falhar por qualquer motivo, o sistema automaticamente usará o Web Speech API do navegador como backup.

## Sincronização com Animação 3D

A animação da boca do modelo 3D está sincronizada com o áudio:
- Quando o áudio começa, a boca começa a se mover
- A boca alterna entre aberta/fechada com variação aleatória para simular fala natural
- Quando o áudio termina, a boca para de se mover

## Troubleshooting

### API não está sendo usada
- Verifique se `config.js` existe e contém sua API key
- Verifique o console do navegador para erros
- Confirme que a API key é válida

### Sem áudio
- Verifique se o botão de som está ativo (verde)
- Verifique o volume do navegador
- Abra o console e procure por erros de CORS ou rede

### Fallback para Web Speech
- Se você ver "Using Web Speech API (Uberduck not configured)", significa que o config.js não foi encontrado ou está incorreto
- Verifique se o arquivo está no local correto e contém a API key

## Segurança

⚠️ **IMPORTANTE**:
- Nunca commite `config.js` com API keys reais
- O arquivo está em `.gitignore` para evitar commits acidentais
- Use apenas `config.example.js` para commits
- Para deploy em produção, use variáveis de ambiente
