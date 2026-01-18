/**
 * ELISA IA - Widget de Chat Embebible
 * 
 * USO:
 * <script>
 *   window.ElisaIA = { apiKey: 'elisa_tu_api_key' };
 * </script>
 * <script src="https://agentes-elisa-ia.vercel.app/widget.js" async></script>
 */

(function() {
  'use strict';

  const config = window.ElisaIA || {};
  const API_KEY = config.apiKey || '';
  const API_URL = config.apiUrl || 'https://elisa-iaagentes-production.up.railway.app';
  const POSITION = config.position || 'right';
  const PRIMARY_COLOR = config.primaryColor || '#6366f1';

  if (!API_KEY) {
    console.error('Elisa IA: API Key no configurada');
    return;
  }

  // Estilos
  const styles = `
    #elisa-widget-container * { box-sizing: border-box; margin: 0; padding: 0; }
    #elisa-widget-container {
      position: fixed;
      bottom: 20px;
      ${POSITION}: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #elisa-widget-btn {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${PRIMARY_COLOR};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }
    #elisa-widget-btn:hover { transform: scale(1.05); }
    #elisa-widget-btn svg { width: 28px; height: 28px; fill: white; }
    #elisa-chat-box {
      display: none;
      position: absolute;
      bottom: 70px;
      ${POSITION}: 0;
      width: 360px;
      height: 500px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      overflow: hidden;
      flex-direction: column;
    }
    #elisa-chat-box.open { display: flex; }
    #elisa-chat-header {
      background: ${PRIMARY_COLOR};
      color: white;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #elisa-chat-header h4 { font-size: 16px; font-weight: 600; }
    #elisa-chat-header button {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 20px;
    }
    #elisa-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      background: #f9fafb;
    }
    .elisa-msg {
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
    }
    .elisa-msg.user { align-items: flex-end; }
    .elisa-msg.bot { align-items: flex-start; }
    .elisa-msg-content {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .elisa-msg.user .elisa-msg-content {
      background: ${PRIMARY_COLOR};
      color: white;
      border-bottom-right-radius: 4px;
    }
    .elisa-msg.bot .elisa-msg-content {
      background: white;
      color: #1f2937;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    #elisa-input-area {
      padding: 12px;
      background: white;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
    }
    #elisa-input {
      flex: 1;
      border: 1px solid #e5e7eb;
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 14px;
      outline: none;
    }
    #elisa-input:focus { border-color: ${PRIMARY_COLOR}; }
    #elisa-send {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: ${PRIMARY_COLOR};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #elisa-send:disabled { background: #ccc; }
    #elisa-send svg { width: 18px; height: 18px; fill: white; }
    .elisa-typing span {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #999;
      border-radius: 50%;
      margin: 0 2px;
      animation: elisaBounce 1.4s infinite ease-in-out both;
    }
    .elisa-typing span:nth-child(1) { animation-delay: -0.32s; }
    .elisa-typing span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes elisaBounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    @media (max-width: 480px) {
      #elisa-chat-box { width: calc(100vw - 32px); height: 70vh; }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // HTML
  const html = `
    <div id="elisa-widget-container">
      <div id="elisa-chat-box">
        <div id="elisa-chat-header">
          <h4>💬 Chat en vivo</h4>
          <button id="elisa-close">✕</button>
        </div>
        <div id="elisa-messages"></div>
        <div id="elisa-input-area">
          <input type="text" id="elisa-input" placeholder="Escribe tu mensaje...">
          <button id="elisa-send">
            <svg viewBox="0 0 24 24"><path d="M2 21L23 12 2 3 2 10 17 12 2 14z"/></svg>
          </button>
        </div>
      </div>
      <button id="elisa-widget-btn">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      </button>
    </div>
  `;

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container.firstElementChild);

  // Referencias
  const widgetBtn = document.getElementById('elisa-widget-btn');
  const chatBox = document.getElementById('elisa-chat-box');
  const closeBtn = document.getElementById('elisa-close');
  const messages = document.getElementById('elisa-messages');
  const input = document.getElementById('elisa-input');
  const sendBtn = document.getElementById('elisa-send');

  let conversationId = null;
  let isLoading = false;

  function toggle() {
    chatBox.classList.toggle('open');
    if (chatBox.classList.contains('open') && messages.children.length === 0) {
      addMsg('bot', '¡Hola! 👋 ¿En qué puedo ayudarte hoy?');
    }
  }

  function addMsg(type, text) {
    const div = document.createElement('div');
    div.className = 'elisa-msg ' + type;
    div.innerHTML = '<div class="elisa-msg-content">' + escapeHtml(text) + '</div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.id = 'elisa-typing';
    div.className = 'elisa-msg bot';
    div.innerHTML = '<div class="elisa-msg-content elisa-typing"><span></span><span></span><span></span></div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function hideTyping() {
    const t = document.getElementById('elisa-typing');
    if (t) t.remove();
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || isLoading) return;

    addMsg('user', text);
    input.value = '';
    sendBtn.disabled = true;
    isLoading = true;
    showTyping();

    try {
      const res = await fetch(API_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ message: text, conversationId })
      });
      const data = await res.json();
      hideTyping();
      addMsg('bot', data.reply || 'Lo siento, hubo un error.');
      conversationId = data.conversationId;
    } catch (e) {
      hideTyping();
      addMsg('bot', 'Error de conexión. Intenta más tarde.');
    }
    isLoading = false;
    sendBtn.disabled = false;
  }

  widgetBtn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);
  sendBtn.addEventListener('click', send);
  input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });

  window.ElisaIA.open = () => chatBox.classList.add('open');
  window.ElisaIA.close = () => chatBox.classList.remove('open');
  
  console.log('✅ Elisa IA Widget loaded');
})();
