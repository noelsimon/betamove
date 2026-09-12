// BETAMOVE — gemeinsames JS für alle Seiten (Nav, Footer-Jahr, Chat-Widget-Optik,
// Accordion-Helfer). Kein Framework, keine Build-Schritte.

document.addEventListener('DOMContentLoaded', () => {
  // Mobiles Menü
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const isOpen = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  // Aktuelle Seite in der Navigation hervorheben
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('[data-r="navlinks"] a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === here || (here === '' && href === 'index.html')) {
      a.setAttribute('aria-current', 'page');
    }
  });

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Generische Accordion-Buttons: <button class="disclosure-btn" data-accordion-target="#id">
  document.querySelectorAll('[data-accordion-target]').forEach(btn => {
    const panel = document.querySelector(btn.getAttribute('data-accordion-target'));
    if (!panel) return;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      const mark = btn.querySelector('.disclosure-mark');
      if (mark) mark.textContent = open ? '+' : '–';
    });
  });

  // Chat-Widget (rein optisch — noch nicht an einen echten Assistenten angebunden)
  const chatFab = document.getElementById('chatFab');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatList = document.getElementById('chatList');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  function chatSetOpen(open) {
    if (!chatPanel) return;
    chatPanel.hidden = !open;
    if (chatFab) chatFab.setAttribute('aria-expanded', String(open));
    if (open && chatInput) chatInput.focus();
  }
  if (chatFab) chatFab.addEventListener('click', () => chatSetOpen(chatPanel.hidden));
  if (chatClose) chatClose.addEventListener('click', () => chatSetOpen(false));

  function addChatMsg(text, role) {
    if (!chatList) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function chatSend(text) {
    const value = (text !== undefined ? text : chatInput.value).trim();
    if (!value) return;
    addChatMsg(value, 'user');
    if (chatInput) chatInput.value = '';
    setTimeout(() => {
      addChatMsg('Diese Vorschau ist noch nicht an einen echten Assistenten angebunden. Schreib uns gerne direkt über das Kontaktformular oder per E-Mail an info@betamove.de.', 'bot');
    }, 350);
  }

  if (chatForm) {
    chatForm.addEventListener('submit', e => {
      e.preventDefault(); // Chat-Backend folgt später — Formular sendet bewusst nirgends hin
      chatSend();
    });
  }
  document.querySelectorAll('.chat-suggestions button').forEach(btn => {
    btn.addEventListener('click', () => chatSend(btn.textContent));
  });
});

// Kleine gemeinsame Hilfsfunktion für Lernfortschritt (Wissensplattform),
// bewusst nur im Browser gespeichert — ohne Konto/Backend.
const bmProgress = {
  key: 'betamove-progress',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { return {}; }
  },
  markDone(id) {
    try {
      const data = this.read();
      data[id] = true;
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) { /* localStorage kann in Privat-Modus fehlschlagen — dann bleibt es unmarkiert */ }
  },
  isDone(id) {
    return !!this.read()[id];
  }
};
