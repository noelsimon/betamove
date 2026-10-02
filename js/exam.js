// BETAMOVE — gemeinsame Prüfungs-Engine für alle pruefung-*.html-Seiten.
// Jede Prüfungsseite setzt vorher window.EXAM / EXAM_PASS / EXAM_ID /
// EXAM_CONGRATS und bindet dieses Skript danach ein. Freischaltung,
// Fragen-Rendering, Auswertung und Wiederholen laufen hier zentral statt
// pro Seite dupliziert (vorher: identischer Code in vier Dateien).

(async function(){
  const loadingBox = document.getElementById('examGateLoading');
  const gateBox = document.getElementById('examGateMessage');
  const runningBox = document.getElementById('examRunning');

  function showGate(title, text, actionLabel, actionHref) {
    loadingBox.hidden = true;
    gateBox.hidden = false;
    document.getElementById('examGateTitle').textContent = title;
    document.getElementById('examGateText').textContent = text;
    const action = document.getElementById('examGateAction');
    action.textContent = actionLabel;
    action.href = actionHref;
  }

  if (typeof window.bmCheckExamGate !== 'function') { showGate('Prüfung gerade nicht erreichbar', 'Bitte lade die Seite später erneut.', 'Neu laden', location.href); return; }
  const state = await window.bmCheckExamGate(window.EXAM_ID);
  if (state === 'no-session') {
    showGate('Bitte melde dich an', 'Diese Prüfung ist nur mit einem BETAMOVE-Konto nutzbar, damit sie deinen Schein mit aufbaut.', 'Anmelden', 'login?next=' + encodeURIComponent(window.EXAM_ID));
    return;
  }
  if (state === 'locked') {
    showGate('Noch nicht freigeschaltet', 'Deine Kursleitung schaltet diese Prüfung frei, sobald du bereit dafür bist.', 'Zu meinem Konto', 'konto');
    return;
  }
  if (state !== 'unlocked') {
    showGate('Gerade nicht erreichbar', 'Bitte lade die Seite später erneut.', 'Neu laden', location.href);
    return;
  }
  loadingBox.hidden = true;
  runningBox.hidden = false;
})();

(function(){
  const EXAM = window.EXAM;
  const EXAM_PASS = window.EXAM_PASS;
  const EXAM_ID = window.EXAM_ID;
  const EXAM_CONGRATS = window.EXAM_CONGRATS;

  const picks = {};
  const list = document.getElementById('examQuestions');
  EXAM.forEach((q, i) => {
    const div = document.createElement('div');
    div.style.cssText = 'background:#ffffff;border:1px solid var(--color-divider);border-radius:calc(var(--radius-lg) * 1.15);padding:26px 30px';
    let optsHtml = '';
    q.options.forEach((label, j) => {
      optsHtml += '<button type="button" data-q="'+i+'" data-o="'+j+'" style="cursor:pointer;font:inherit;text-align:left;display:flex;gap:13px;align-items:flex-start;padding:14px 18px;border-radius:var(--radius-md);border:2px solid var(--color-divider);background:#fff;color:inherit;width:100%"><span style="width:21px;height:21px;flex:none;border-radius:50%;border:2px solid var(--color-accent);display:grid;place-items:center;font-size:11px;color:#fff;margin-top:2px"></span><span style="font-size:16px;line-height:1.5">'+label+'</span></button>';
    });
    div.innerHTML = '<div style="display:flex;gap:12px;align-items:baseline;margin-bottom:16px"><span style="font-family:var(--font-heading);font-size:17px;color:var(--color-accent-600);flex:none">'+(i+1)+'</span><h3 style="margin:0;font-size:20px;line-height:1.4">'+q.q+'</h3></div><div style="display:flex;flex-direction:column;gap:10px">'+optsHtml+'</div>';
    list.appendChild(div);
  });

  function updateProgress() {
    const answered = Object.keys(picks).length;
    document.getElementById('examProgressBar').style.width = Math.round((answered/EXAM.length)*100) + '%';
    document.getElementById('examProgressLabel').textContent = answered + ' / ' + EXAM.length;
    document.getElementById('examHint').textContent = answered === EXAM.length ? '' : (EXAM.length - answered) + ' Fragen offen';
    document.getElementById('examSubmit').disabled = answered !== EXAM.length;
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-q]');
    if (!btn) return;
    const qi = Number(btn.dataset.q), oi = Number(btn.dataset.o);
    picks[qi] = oi;
    const group = btn.parentElement.children;
    for (let k = 0; k < group.length; k++) {
      group[k].style.borderColor = (k === oi) ? 'var(--color-accent)' : 'var(--color-divider)';
      group[k].style.background = (k === oi) ? 'var(--color-accent-100)' : '#fff';
      const dot = group[k].querySelector('span');
      dot.style.background = (k === oi) ? 'var(--color-accent)' : 'transparent';
      dot.textContent = (k === oi) ? '✓' : '';
    }
    updateProgress();
  });

  document.getElementById('examSubmit').addEventListener('click', () => {
    let score = 0;
    EXAM.forEach((q, i) => { if (picks[i] === q.a) score++; });
    document.getElementById('examRunning').hidden = true;
    document.getElementById('examDone').hidden = false;
    const passed = score >= EXAM_PASS;
    const box = document.getElementById('examVerdictBox');
    box.style.background = passed ? 'var(--color-accent-2-500)' : 'var(--color-accent-600)';
    document.getElementById('examVerdictLabel').textContent = passed ? 'Bestanden' : 'Nicht bestanden';
    document.getElementById('examScoreLine').textContent = score + ' richtig · ' + Math.round((score/EXAM.length)*100) + ' %';
    document.getElementById('examVerdictText').textContent = passed
      ? EXAM_CONGRATS
      : 'Ab sechs richtigen Antworten ist die Prüfung bestanden. Lies die Erklärungen unten, dann probier es erneut.';
    const review = document.getElementById('examReview');
    review.innerHTML = '';
    EXAM.forEach((q, i) => {
      const ok = picks[i] === q.a;
      const div = document.createElement('div');
      div.style.cssText = 'background:#ffffff;border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:22px 26px;display:flex;gap:14px;align-items:flex-start';
      div.innerHTML = '<span style="width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;background:'+(ok?'var(--color-accent-2-500)':'var(--color-accent-600)')+';color:#fff">'+(ok?'✓':'✕')+'</span><div style="min-width:0"><div style="font-size:16.5px;font-weight:600;margin-bottom:8px">'+q.q+'</div><div style="font-size:15px;opacity:0.75;margin-bottom:3px">Deine Antwort: '+(q.options[picks[i]]||'—')+'</div><div style="font-size:15px;opacity:0.75;margin-bottom:8px">Richtig: '+q.options[q.a]+'</div><p style="margin:0;font-size:15.5px;opacity:0.85">'+q.why+'</p></div>';
      review.appendChild(div);
    });
    try { bmProgress.markDone(EXAM_ID, 'pruefung', { score, total: EXAM.length, passed }); } catch (e) {}
    window.scrollTo(0,0);
  });

  document.getElementById('examRetryBtn').addEventListener('click', () => {
    Object.keys(picks).forEach(k => delete picks[k]);
    document.querySelectorAll('#examQuestions button[data-q]').forEach(b => {
      b.style.borderColor = 'var(--color-divider)'; b.style.background = '#fff';
      const dot = b.querySelector('span'); dot.style.background = 'transparent'; dot.textContent = '';
    });
    document.getElementById('examDone').hidden = true;
    document.getElementById('examRunning').hidden = false;
    updateProgress();
    window.scrollTo(0,0);
  });

  updateProgress();
})();
