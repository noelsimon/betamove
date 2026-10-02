// BETAMOVE — sehr kleiner, bewusst eingeschränkter Markdown-Dialekt für
// Artikeltexte aus der Datenbank (artikel_inhalte.inhalt_markdown).
// Unterstützt: ## / ### / #### Überschriften, Absätze, - Aufzählungen,
// > Hinweisbox, ![Alt](Bild-URL) Bilder, **fett**, *kursiv*, [Text](URL) Links.
// Bewusst kein voller CommonMark-Funktionsumfang — reicht für Artikeltexte,
// bleibt aber klein und ohne externe Abhängigkeit.

window.bmRenderMarkdownLite = function (source) {
  if (!source) return '';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderInline(text) {
    let safe = escapeHtml(text);
    // Links zuerst, damit **/* innerhalb von Linktexten nicht kollidiert.
    safe = safe.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      if (!/^(https?:\/\/|\/|[a-z0-9_-]+(\.[a-z0-9_-]+)*\/?$)/i.test(href)) return escapeHtml(m);
      return '<a href="' + escapeHtml(href) + '">' + label + '</a>';
    });
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Kursiv bewusst mit _Unterstrich_ statt *Stern*, weil Gender-Sternchen
    // (z.B. "Kletter*innen") in Artikeltexten vorkommen und mit einzelnen
    // Sternen kollidieren würden.
    safe = safe.replace(/_([^_]+)_/g, '<em>$1</em>');
    return safe;
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listBuffer = null;
  let listOrdered = false;
  let calloutBuffer = null;

  function flushList() {
    if (listBuffer) {
      const tag = listOrdered ? 'ol' : 'ul';
      html.push('<' + tag + ' style="margin:0 0 20px;padding-left:22px;display:flex;flex-direction:column;gap:6px">' + listBuffer.join('') + '</' + tag + '>');
      listBuffer = null;
    }
  }
  function flushCallout() {
    if (calloutBuffer) {
      html.push('<p style="background:var(--color-accent-100);border:2px solid var(--color-accent-300);border-radius:var(--radius-md);padding:18px 22px;font-size:16.5px;color:var(--color-accent-900);margin:0 0 24px">' + calloutBuffer.join('<br>') + '</p>');
      calloutBuffer = null;
    }
  }

  lines.forEach(raw => {
    const line = raw.trim();

    if (!line) { flushList(); flushCallout(); return; }

    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      flushList(); flushCallout();
      html.push('<img src="' + escapeHtml(img[2]) + '" alt="' + escapeHtml(img[1]) + '" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius-lg);margin:12px 0 28px;background:var(--color-surface)">');
      return;
    }

    const h4 = line.match(/^####\s+(.*)$/);
    if (h4) { flushList(); flushCallout(); html.push('<h4 style="margin:28px 0 10px;font-size:19px">' + renderInline(h4[1]) + '</h4>'); return; }
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) { flushList(); flushCallout(); html.push('<h3 style="margin:32px 0 8px;font-size:22px">' + renderInline(h3[1]) + '</h3>'); return; }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) { flushList(); flushCallout(); html.push('<h2 style="margin:44px 0 14px;font-size:31px">' + renderInline(h2[1]) + '</h2>'); return; }

    const li = line.match(/^-\s+(.*)$/);
    if (li) {
      flushCallout();
      if (listBuffer && listOrdered) flushList();
      if (!listBuffer) { listBuffer = []; listOrdered = false; }
      listBuffer.push('<li>' + renderInline(li[1]) + '</li>');
      return;
    }

    const oli = line.match(/^\d+\.\s+(.*)$/);
    if (oli) {
      flushCallout();
      if (listBuffer && !listOrdered) flushList();
      if (!listBuffer) { listBuffer = []; listOrdered = true; }
      listBuffer.push('<li>' + renderInline(oli[1]) + '</li>');
      return;
    }

    const quote = line.match(/^>\s+(.*)$/);
    if (quote) {
      flushList();
      if (!calloutBuffer) calloutBuffer = [];
      calloutBuffer.push(renderInline(quote[1]));
      return;
    }

    flushList(); flushCallout();
    html.push('<p style="margin:0 0 20px">' + renderInline(line) + '</p>');
  });

  flushList();
  flushCallout();
  return html.join('\n');
};
