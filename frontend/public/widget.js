(function() {
  'use strict';

  const config = window.ElisaIA || {};
  const API_KEY = config.apiKey;
  const API_URL = config.apiUrl || 'https://elisa-iaagentes-production.up.railway.app';
  const POSITION = config.position || 'right';
  const PRIMARY_COLOR = config.primaryColor || '#6366f1';

  if (!API_KEY) {
    console.error('ElisaIA: API Key requerida');
    return;
  }

  let conversationId = null;
  let isOpen = false;

  // Estilos
  const styles = `
    #elisa-widget-container * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #elisa-widget-btn { position: fixed; bottom: 20px; ${POSITION}: 20px; width: 60px; height: 60px; border-radius: 50%; background: ${PRIMARY_COLOR}; border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 9998; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
    #elisa-widget-btn:hover { transform: scale(1.1); }
    #elisa-widget-btn svg { width: 28px; height: 28px; fill: white; }
    #elisa-chat-window { position: fixed; bottom: 90px; ${POSITION}: 20px; width: 380px; height: 520px; background: white; border-radius: 16px; box-shadow: 0 5px 40px rgba(0,0,0,0.16); z-index: 9999; display: none; flex-direction: column; overflow: hidden; }
    #elisa-chat-window.open { display: flex; }
    #elisa-chat-header { background: ${PRIMARY_COLOR}; color: white; padding: 16px; display: flex; align-items: center; }
    #elisa-chat-header-avatar { width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; }
    #elisa-chat-header-info h3 { margin: 0; font-size: 16px; font-weight: 600; }
    #elisa-chat-header-info p { margin: 0; font-size: 12px; opacity: 0.9; }
    #elisa-chat-close { margin-left: auto; background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; line-height: 1; }
    #elisa-chat-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f9fafb; }
    .elisa-message { max-width: 80%; margin-bottom: 12px; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.4; }
    .elisa-message.user { background: ${PRIMARY_COLOR}; color: white; margin-left: auto; border-bottom-right-radius: 4px; }
    .elisa-message.assistant { background: white; color: #1f2937; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .elisa-typing { display: flex; align-items: center; padding: 12px 16px; background: white; border-radius: 16px; width: fit-content; }
    .elisa-typing span { width: 8px; height: 8px; background: #9ca3af; border-radius: 50%; margin: 0 2px; animation: elisa-bounce 1.4s infinite; }
    .elisa-typing span:nth-child(2) { animation-delay: 0.2s; }
    .elisa-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes elisa-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }
    #elisa-chat-input-container { padding: 16px; background: white; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; }
    #elisa-chat-input { flex: 1; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 24px; font-size: 14px; outline: none; }
    #elisa-chat-input:focus { border-color: ${PRIMARY_COLOR}; }
    #elisa-chat-send { width: 44px; height: 44px; background: ${PRIMARY_COLOR}; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    #elisa-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #elisa-chat-send svg { width: 20px; height: 20px; fill: white; }
    @media (max-width: 480px) { #elisa-chat-window { width: calc(100% - 20px); height: calc(100% - 100px); bottom: 80px; ${POSITION}: 10px; border-radius: 12px; } }
  `;

  // Crear elementos
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const container = document.createElement('div');
  container.id = 'elisa-widget-container';
  container.innerHTML = `
    <button id="elisa-widget-btn" aria-label="Abrir chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
    </button>
    <div id="elisa-chat-window">
      <div id="elisa-chat-header">
        <div id="elisa-chat-header-avatar">🤖</div>
        <div id="elisa-chat-header-info">
          <h3>Asistente Virtual</h3>
          <p>En línea</p>
        </div>
        <button id="elisa-chat-close">&times;</button>
      </div>
      <div id="elisa-chat-messages"></div>
      <div id="elisa-chat-input-container">
        <input type="text" id="elisa-chat-input" placeholder="Escribe un mensaje..." />
        <button id="elisa-chat-send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // Referencias
  const btn = document.getElementById('elisa-widget-btn');
  const chatWindow = document.getElementById('elisa-chat-window');
  const closeBtn = document.getElementById('elisa-chat-close');
  const messagesContainer = document.getElementById('elisa-chat-messages');
  const input = document.getElementById('elisa-chat-input');
  const sendBtn = document.getElementById('elisa-chat-send');

  // Funciones
  function toggleChat() {
    isOpen = !isOpen;
    chatWindow.classList.toggle('open', isOpen);
    if (isOpen && messagesContainer.children.length === 0) {
      addMessage('¡Hola! 👋 ¿En qué puedo ayudarte?', 'assistant');
    }
  }

  function addMessage(text, role) {
    const msg = document.createElement('div');
    msg.className = `elisa-message ${role}`;
    msg.textContent = text;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'elisa-typing';
    typing.id = 'elisa-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function hideTyping() {
    const typing = document.getElementById('elisa-typing');
    if (typing) typing.remove();
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';
    sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ message: text, conversationId })
      });

      const data = await res.json();
      hideTyping();

      if (data.reply) {
        addMessage(data.reply, 'assistant');
        conversationId = data.conversationId;
      } else {
        addMessage(data.error || 'Error al procesar mensaje', 'assistant');
      }
    } catch (error) {
      hideTyping();
      addMessage('Error de conexión. Intenta de nuevo.', 'assistant');
    }

    sendBtn.disabled = false;
  }

  // Event listeners
  btn.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
})();
