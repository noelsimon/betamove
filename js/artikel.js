// BETAMOVE — gemeinsame Artikel-Engine für alle artikel-*.html-Seiten.
// Jede Artikelseite setzt vorher window.ARTIKEL_ID und bindet dieses Skript
// danach ein. Titel, Bild und Text kommen aus der Datenbank (artikel_inhalte),
// damit sie im Adminbereich (admin-fragen) bearbeitet werden können, statt
// pro Seite fest im Code zu stehen. Kopfzeile, Fußzeile, Kommentare und die
// <head>-Metadaten bleiben wie bisher Teil der einzelnen Seite.

(async function(){
  const loadingBox = document.getElementById('artikelLoading');
  const area = document.getElementById('artikelArea');

  function showError(text) {
    loadingBox.innerHTML = '<p style="margin:0;font-size:15.5px;color:var(--color-accent-700)">' + text + '</p>';
  }

  if (typeof window.bmGetSupabaseClient !== 'function' || typeof window.bmRenderMarkdownLite !== 'function') {
    showError('Gerade nicht erreichbar. Bitte lade die Seite später erneut.');
    return;
  }
  const { client } = window.bmGetSupabaseClient();
  if (!client) { showError('Gerade nicht erreichbar. Bitte lade die Seite später erneut.'); return; }

  let inhalt = null;
  try {
    const { data, error } = await client.from('artikel_inhalte').select('*').eq('lerninhalt_id', window.ARTIKEL_ID).maybeSingle();
    if (error) throw error;
    inhalt = data;
  } catch (e) {
    showError('Artikel konnte nicht geladen werden. Bitte lade die Seite später erneut.');
    return;
  }

  if (!inhalt) {
    showError('Für diesen Artikel ist noch kein Inhalt hinterlegt.');
    return;
  }

  const tagsEl = document.getElementById('artikelTags');
  const tags = (inhalt.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tags.length) {
    tagsEl.innerHTML = tags.map((t, i) => '<span class="tag ' + (i === 0 ? 'tag-accent' : 'tag-neutral') + '" style="font-size:11.5px">' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>').join('')
      + (inhalt.lesezeit ? '<span style="font-size:14px;opacity:0.6">' + inhalt.lesezeit.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>' : '');
  } else {
    tagsEl.hidden = true;
  }

  document.getElementById('artikelTitel').textContent = inhalt.titel || '';
  const untertitelEl = document.getElementById('artikelUntertitel');
  if (inhalt.untertitel) { untertitelEl.textContent = inhalt.untertitel; } else { untertitelEl.hidden = true; }
  const introEl = document.getElementById('artikelIntro');
  if (inhalt.intro) { introEl.textContent = inhalt.intro; } else { introEl.hidden = true; }
  const heroEl = document.getElementById('artikelHero');
  if (inhalt.hero_bild) { heroEl.src = inhalt.hero_bild; heroEl.alt = inhalt.hero_alt || ''; } else { heroEl.hidden = true; }
  document.getElementById('artikelBody').innerHTML = window.bmRenderMarkdownLite(inhalt.inhalt_markdown || '');

  loadingBox.hidden = true;
  area.hidden = false;

  const id = window.ARTIKEL_ID;
  const btn = document.getElementById('markReadBtn');
  const done = document.getElementById('markReadDone');
  function sync() { try { if (bmProgress.isDone(id)) { btn.hidden = true; done.hidden = false; } } catch (e) {} }
  btn.addEventListener('click', () => { try { bmProgress.markDone(id); } catch (e) {} btn.hidden = true; done.hidden = false; });
  sync();
})();
