// BETAMOVE — gemeinsame Quiz-Engine für alle quiz-*.html-Seiten.
// Jede Quiz-Seite setzt vorher window.QUIZ_ID und bindet dieses Skript
// danach ein. Die Fragen kommen aus der Datenbank (lerninhalt_fragen),
// damit sie im Adminbereich (admin-fragen) bearbeitet werden können, statt
// pro Seite fest im Code zu stehen.

(async function(){
  const loadingBox = document.getElementById('quizLoading');
  const runningEl = document.getElementById('quizRunning');
  const doneEl = document.getElementById('quizDone');

  function showError(text) {
    loadingBox.innerHTML = '<p style="margin:0;font-size:15.5px;color:var(--color-accent-700)">' + text + '</p>';
  }

  if (typeof window.bmGetSupabaseClient !== 'function') { showError('Gerade nicht erreichbar. Bitte lade die Seite später erneut.'); return; }
  const { client } = window.bmGetSupabaseClient();
  if (!client) { showError('Gerade nicht erreichbar. Bitte lade die Seite später erneut.'); return; }

  let QUIZ = [];
  let QUIZ_PASS = 1;
  try {
    const [fragenRes, liRes] = await Promise.all([
      client.from('lerninhalt_fragen').select('*').eq('lerninhalt_id', window.QUIZ_ID).order('sort_order', { ascending: true }),
      client.from('lerninhalte').select('bestehensgrenze').eq('id', window.QUIZ_ID).maybeSingle()
    ]);
    if (fragenRes.error) throw fragenRes.error;
    QUIZ = (fragenRes.data || []).map(f => ({ q: f.frage, options: f.optionen, a: f.richtige_antwort, why: f.erklaerung }));
    const grenze = liRes.data && liRes.data.bestehensgrenze;
    QUIZ_PASS = grenze != null ? grenze : Math.ceil(QUIZ.length / 2);
  } catch (e) {
    showError('Fragen konnten nicht geladen werden. Bitte lade die Seite später erneut.');
    return;
  }

  if (!QUIZ.length) {
    showError('Zu diesem Quiz sind noch keine Fragen hinterlegt.');
    return;
  }

  loadingBox.hidden = true;
  runningEl.hidden = false;

  const QUIZ_ID = window.QUIZ_ID;
  let idx = 0;
  const picks = {};

  function renderQuestion() {
    const q = QUIZ[idx];
    document.getElementById('quizProgressBar').style.width = Math.round((idx / QUIZ.length) * 100) + '%';
    document.getElementById('quizProgressLabel').textContent = 'Frage ' + (idx+1) + ' / ' + QUIZ.length;
    document.getElementById('quizQuestion').textContent = q.q;
    const opts = document.getElementById('quizOptions');
    opts.innerHTML = '';
    q.options.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'cursor:pointer;font:inherit;text-align:left;display:flex;gap:14px;align-items:flex-start;padding:16px 20px;border-radius:var(--radius-md);border:2px solid var(--color-divider);background:#fff;color:inherit;width:100%';
      btn.innerHTML = '<span style="width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;background:var(--color-neutral-300);color:var(--color-neutral-700)">' + String.fromCharCode(65+i) + '</span><span style="font-size:16.5px;line-height:1.5;padding-top:2px">' + label + '</span>';
      btn.addEventListener('click', () => pick(i));
      opts.appendChild(btn);
    });
    document.getElementById('quizFeedback').hidden = true;
    document.getElementById('quizNextRow').hidden = true;
    document.getElementById('quizHint').hidden = false;
  }

  function pick(i) {
    if (picks[idx] !== undefined) return;
    picks[idx] = i;
    const q = QUIZ[idx];
    const opts = document.getElementById('quizOptions').children;
    for (let j = 0; j < opts.length; j++) {
      const btn = opts[j];
      btn.disabled = true;
      if (j === q.a) { btn.style.borderColor = 'var(--color-accent-2-500)'; btn.style.background = 'var(--color-accent-2-100)'; }
      else if (j === i) { btn.style.borderColor = 'var(--color-accent-600)'; btn.style.background = 'var(--color-accent-100)'; }
    }
    const correct = i === q.a;
    const fb = document.getElementById('quizFeedback');
    fb.hidden = false;
    fb.style.background = correct ? 'var(--color-accent-2-100)' : 'var(--color-accent-100)';
    fb.style.color = correct ? 'var(--color-accent-2-900)' : 'var(--color-accent-900)';
    document.getElementById('quizFeedbackTitle').textContent = correct ? 'Richtig.' : 'Nicht ganz.';
    document.getElementById('quizWhy').textContent = q.why;
    document.getElementById('quizHint').hidden = true;
    const nextRow = document.getElementById('quizNextRow');
    nextRow.hidden = false;
    const btn = document.getElementById('quizNextBtn');
    btn.textContent = idx < QUIZ.length - 1 ? 'Nächste Frage' : 'Ergebnis ansehen';
    btn.onclick = () => { if (idx < QUIZ.length - 1) { idx++; renderQuestion(); } else { finish(); } };
  }

  function finish() {
    let score = 0;
    QUIZ.forEach((q, i) => { if (picks[i] === q.a) score++; });
    runningEl.hidden = true;
    doneEl.hidden = false;
    document.getElementById('quizScoreLabel').textContent = score + ' von ' + QUIZ.length;
    const passed = score >= QUIZ_PASS;
    document.getElementById('quizVerdict').textContent = passed ? 'Sitzt.' : 'Da ist noch Luft.';
    document.getElementById('quizVerdictText').textContent = passed
      ? 'Du hast die wichtigsten Punkte drauf. Schau dir die Erklärungen zu den falschen Antworten trotzdem noch einmal an.'
      : 'Kein Problem – lies den passenden Artikel dazu und wiederhole das Quiz. Genau dafür ist es da.';
    const review = document.getElementById('quizReview');
    review.innerHTML = '';
    QUIZ.forEach((q, i) => {
      const ok = picks[i] === q.a;
      const div = document.createElement('div');
      div.style.cssText = 'background:#ffffff;border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:20px 24px;display:flex;gap:14px;align-items:flex-start';
      div.innerHTML = '<span style="width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;background:' + (ok?'var(--color-accent-2-500)':'var(--color-accent-600)') + ';color:#fff">' + (ok?'✓':'✕') + '</span><div><div style="font-size:16.5px;font-weight:600;margin-bottom:5px">' + q.q + '</div><p style="margin:0;font-size:15.5px;opacity:0.8">' + q.why + '</p></div>';
      review.appendChild(div);
    });
    try { bmProgress.markDone(QUIZ_ID, 'quiz', { score, total: QUIZ.length, passed }); } catch (e) {}
    window.scrollTo(0,0);
  }

  document.getElementById('quizRetryBtn').addEventListener('click', () => {
    idx = 0; Object.keys(picks).forEach(k => delete picks[k]);
    doneEl.hidden = true; runningEl.hidden = false;
    renderQuestion();
    window.scrollTo(0,0);
  });

  renderQuestion();
})();
