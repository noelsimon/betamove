-- BETAMOVE — Fragen zu Quiz/Prüfungen aus der Datenbank statt fest im Code
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-pruefungen-zertifikate.sql,
-- schema-sicherheitsfixes.sql und schema-qualifikationen.sql auf (müssen
-- vorher gelaufen sein).
--
-- Bisher standen die Fragen zu jedem Quiz/jeder Prüfung fest im HTML-Code der
-- jeweiligen Seite. Ab jetzt liegen sie in `lerninhalt_fragen` und lassen
-- sich im Adminbereich (admin-fragen) bearbeiten — neue Fragen, geänderte
-- Antworten, eine neue Bestehensgrenze, alles ohne Code-Änderung.
--
-- Die Prüfungs-Auswertung (submit_pruefung) liest die richtigen Antworten ab
-- jetzt aus dieser Tabelle statt aus fest hinterlegten Listen im Funktions-
-- code. Das Sicherheitsmodell bleibt gleich: die Auswertung läuft weiterhin
-- serverseitig, das Ergebnis kommt nicht vom Browser.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) lerninhalte.bestehensgrenze — ab wie vielen richtigen Antworten bestanden
-- ============================================================================

alter table public.lerninhalte add column if not exists bestehensgrenze int;

comment on column public.lerninhalte.bestehensgrenze is 'Ab wie vielen richtigen Antworten gilt Quiz/Prüfung als bestanden. Leer = die Hälfte der Fragen aufgerundet.';


-- ============================================================================
-- 2) lerninhalt_fragen — Fragen zu einem Quiz/einer Prüfung
-- ============================================================================

create table if not exists public.lerninhalt_fragen (
  id               uuid primary key default gen_random_uuid(),
  lerninhalt_id    text not null references public.lerninhalte(id) on delete cascade,
  sort_order       int not null default 0,
  frage            text not null,
  optionen         jsonb not null,
  richtige_antwort int not null,
  erklaerung       text not null default '',

  constraint lerninhalt_fragen_frage_len check (char_length(trim(frage)) between 1 and 2000),
  constraint lerninhalt_fragen_erklaerung_len check (char_length(erklaerung) <= 2000),
  constraint lerninhalt_fragen_optionen_art check (jsonb_typeof(optionen) = 'array'),
  constraint lerninhalt_fragen_optionen_anzahl check (jsonb_array_length(optionen) between 2 and 6),
  constraint lerninhalt_fragen_antwort_bereich check (richtige_antwort >= 0 and richtige_antwort < jsonb_array_length(optionen))
);

comment on table public.lerninhalt_fragen is 'Fragen zu einem Quiz/einer Prüfung aus lerninhalte (kind=quiz/pruefung)';
comment on column public.lerninhalt_fragen.optionen is 'Array der Antwortoptionen als Text, z.B. ["Option A", "Option B"]';
comment on column public.lerninhalt_fragen.richtige_antwort is '0-basierter Index der richtigen Antwort in optionen';

create index if not exists lerninhalt_fragen_lerninhalt_id_idx on public.lerninhalt_fragen (lerninhalt_id, sort_order);

alter table public.lerninhalt_fragen enable row level security;

drop policy if exists "lerninhalt_fragen_select_all" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_select_all"
  on public.lerninhalt_fragen for select
  to anon, authenticated
  using (true);

drop policy if exists "lerninhalt_fragen_admin_insert" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_insert"
  on public.lerninhalt_fragen for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "lerninhalt_fragen_admin_update" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_update"
  on public.lerninhalt_fragen for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "lerninhalt_fragen_admin_delete" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_delete"
  on public.lerninhalt_fragen for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- 3) Seed — bisherige Fragen aus den HTML-Seiten übernehmen (einmalig)
-- ============================================================================

update public.lerninhalte set bestehensgrenze = 4 where id in ('quiz-fels', 'quiz-sichern');
update public.lerninhalte set bestehensgrenze = 6 where id in ('pruefung-sicherungsschein', 'pruefung-sturztraining', 'pruefung-naturfels', 'pruefung-mehrseillaengen');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'quiz-fels', * from (values
  (1, 'Wie hängst du eine Expresse am Bohrhaken korrekt ein?', '["Loses Karabiner-Ende an den Haken, Schnapper gegen die Kletterrichtung", "Festes Ende an den Haken, Schnapper in Kletterrichtung", "Beliebig, solange das Seil drin ist"]'::jsonb, 0, 'Das lose Ende an den Haken, damit sich die Exe bewegen kann. Der Schnapper zeigt gegen die Kletterrichtung, sonst kann das Seil im Sturz ausclippen.'),
  (2, 'Warum ist ein Clipstick am Fels sinnvoll?', '["Er ersetzt den Helm", "Er entschärft den bodennahen Sturzraum an den ersten Haken", "Er verkürzt die Route"]'::jsonb, 1, 'Die ersten zwei bis drei Haken sind der gefährlichste Bereich. Vorclippen nimmt genau dort das Grundfallrisiko heraus.'),
  (3, 'Der Fels sieht trocken aus, es hat aber vorgestern geregnet. Im Elbsandstein bedeutet das …', '["freie Fahrt", "Kletterverbot bzw. Wartezeit, weil das Gestein nass an Festigkeit verliert", "nur die Reibung ist schlechter"]'::jsonb, 1, 'Sandstein verliert nass massiv an Festigkeit. Griffe und Haken können ausbrechen – hier gilt die Wartezeit des Gebiets, nicht das Gefühl.'),
  (4, 'Wie richtest du am Umlenker ein Toprope ein?', '["Seil direkt durch den Ring laufen lassen", "Zwei gegenläufig eingehängte Exen, zusätzlich die Sicherung darunter als Redundanz", "Eine Exe reicht"]'::jsonb, 1, 'Direkt durch den Ring verschleißt fremdes Material. Zwei gegenläufige Exen plus die Zwischensicherung darunter sind Standard.'),
  (5, 'Beim Umbauen am Stand gilt …', '["zügig arbeiten, der Partnercheck fängt Fehler auf", "volle Konzentration, denn es gibt keinen Partnercheck", "egal, der Umlenker hält alles"]'::jsonb, 1, 'Umbauen passiert allein und ohne Kontrolle von unten. Deshalb: langsam, bedacht, keine Ablenkung, immer redundant gesichert.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'quiz-fels');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'quiz-sichern', * from (values
  (1, 'Wo liegt die Bremshand beim Sichern mit einem Autotuber?', '["Sie darf das Seil kurz loslassen, wenn das Gerät blockiert", "Sie umschließt das Bremsseil ununterbrochen", "Sie liegt am Gerät, damit du schneller Seil geben kannst"]'::jsonb, 1, 'Die Bremshand verlässt das Bremsseil nie – auch nicht bei Halbautomaten. Alles andere ist eine Gewohnheit, die im Sturz zum Problem wird.'),
  (2, 'Was bedeutet „weich sichern“?', '["Möglichst viel Schlappseil im System lassen", "Den Sturz durch kontrolliertes Mitgehen und minimales Seildurchlaufen verlängern", "Das Gerät kurz öffnen, damit Seil rutscht"]'::jsonb, 1, 'Weich sichern heißt: den Fangstoß über Körperbewegung und einen kontrollierten Seilausgleich verlängern – nicht über Schlappseil oder ein geöffnetes Gerät.'),
  (3, 'Der Partnercheck prüft unter anderem …', '["nur den Knoten", "Gurt, Knoten, Sicherungsgerät und Seilende", "ob genug Chalk im Beutel ist"]'::jsonb, 1, 'Gurt geschlossen, Anseilknoten korrekt und zugezogen, Gerät richtig eingelegt, Seilende gesichert – vier Punkte, jedes Mal.'),
  (4, 'Ein deutlicher Gewichtsunterschied zwischen Kletternder und Sichernder bedeutet …', '["nichts, das Gerät regelt das", "die leichtere Person kann angehoben werden – Ausgleich einplanen", "die schwerere Person muss vorsteigen"]'::jsonb, 1, 'Wird die sichernde Person angehoben, verliert sie Kontrolle über das Bremsseil. Ausgleichssysteme oder eine Bodenverankerung sind dann Pflichtthema.'),
  (5, 'Wann ist ein Rückzug aus einer Route die richtige Entscheidung?', '["Nie, Rückzug ist Versagen", "Wenn Material, Absicherung oder Kopf nicht passen", "Nur wenn es regnet"]'::jsonb, 1, 'Zweifel an Haken, Wetter, Kondition oder Kopf sind ausreichende Gründe. Die Route bleibt stehen, du kommst wieder.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'quiz-sichern');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'pruefung-sicherungsschein', * from (values
  (1, 'Das Bremsseil wird beim Sichern …', '["bei blockierendem Gerät kurz freigegeben", "ununterbrochen von der Bremshand umschlossen"]'::jsonb, 1, 'Es gibt keine Situation, in der die Bremshand das Bremsseil verlässt.'),
  (2, 'Ein Anseilknoten ist korrekt, wenn …', '["er zugezogen ist und ein ausreichender Restfaden bleibt", "er locker sitzt, damit er sich im Sturz setzen kann"]'::jsonb, 0, 'Achterknoten zugezogen, parallel gelegt, Restfaden mindestens eine Handbreit.'),
  (3, 'Beim Vorstiegssichern stehst du …', '["direkt an der Wand, seitlich zur ersten Exe versetzt", "zwei Meter hinter der Wand mittig unter der Route"]'::jsonb, 0, 'Nah an der Wand und leicht versetzt: kurzer Seilweg, freie Sicht, kein Zug in die Wand.'),
  (4, 'Schlappseil im Vorstieg ist …', '["grundsätzlich gut, damit der Sturz weich wird", "so knapp wie möglich zu halten, ohne den Kletternden zu behindern"]'::jsonb, 1, 'Schlappseil verlängert die Sturzstrecke. Weichheit kommt aus dem Sicherungsverhalten, nicht aus Schlappseil.'),
  (5, 'Vor dem Klettern prüfst du im Partnercheck …', '["Gurt, Knoten, Gerät, Seilende", "nur Knoten und Gerät"]'::jsonb, 0, 'Alle vier Punkte, in fester Reihenfolge, laut und gegenseitig.'),
  (6, 'Ein Sturz kurz über der ersten Zwischensicherung ist …', '["harmlos, das Seil fängt weich", "kritisch, weil Bodennähe und Seildehnung zusammenfallen"]'::jsonb, 1, 'Grundfallrisiko: wenig Seil im System, kurze Bremsstrecke, Boden nah. Vorclippen entschärft das.'),
  (7, 'Wird die sichernde Person deutlich angehoben, …', '["ist das normal und unkritisch", "droht Kontrollverlust über das Bremsseil – Ausgleich nötig"]'::jsonb, 1, 'Beim Anheben geht die Bremshandposition verloren. Gewichtsunterschiede brauchen eine Lösung.'),
  (8, 'Ein Helm gehört am Naturfels …', '["nur beim Vorsteigen getragen", "beim Klettern und beim Sichern getragen"]'::jsonb, 1, 'Steinschlag trifft auch die sichernde Person. Helm auf, sobald du am Wandfuß stehst.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'pruefung-sicherungsschein');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'pruefung-sturztraining', * from (values
  (1, 'Das Bremsseil wird beim Sichern mit einem Autotuber …', '["bei blockierendem Gerät kurz freigegeben", "ununterbrochen von der Bremshand umschlossen"]'::jsonb, 1, 'Die Bremshand verlässt das Bremsseil nie – auch nicht bei Halbautomaten.'),
  (2, '„Weich sichern“ bedeutet …', '["möglichst viel Schlappseil im System lassen", "den Fangstoß durch kontrolliertes Mitgehen und Seilausgleich verlängern"]'::jsonb, 1, 'Weichheit kommt aus dem Sicherungsverhalten (Mitgehen, dosiertes Seilausgleichen) – nicht aus Schlappseil oder geöffnetem Gerät.'),
  (3, 'Der Partnercheck vor dem Klettern prüft …', '["nur Knoten und Gerät", "Gurt, Knoten, Sicherungsgerät und Seilende"]'::jsonb, 1, 'Alle vier Punkte, in fester Reihenfolge, laut und gegenseitig – jedes Mal.'),
  (4, 'Bei einem deutlichen Gewichtsunterschied zwischen kletternder und sichernder Person …', '["kann die leichtere Person angehoben werden – Ausgleich vorher einplanen", "regelt das Sicherungsgerät automatisch alles"]'::jsonb, 0, 'Wird die sichernde Person angehoben, verliert sie Kontrolle über das Bremsseil. Ausgleichssysteme oder Bodenverankerung sind dann Pflicht.'),
  (5, 'Kontrolliertes Sturztraining übt man am besten …', '["unangekündigt, damit die Reaktion echt ist", "im Toprope mit erfahrener sichernder Person und vorheriger Absprache"]'::jsonb, 1, 'Absprache vor dem Sturz (Höhe, Zeitpunkt) macht das Training sicher und baut gezielt Vertrauen auf – Überraschung ist kein Lernziel.'),
  (6, 'Reagiert die Bremshand auf einen plötzlichen Sturz richtig, …', '["schließt sie sich reflexartig um das Bremsseil", "öffnet sie sich kurz, um den Ruck abzufedern"]'::jsonb, 0, 'Die Bremshand-Reaktion muss zum unbewussten Reflex trainiert werden: Sturz = Hand schließt sich, nie öffnen.'),
  (7, 'Im Toprope ist die Sturzstrecke bei straff gehaltenem Seil in der Regel …', '["größer als im Vorstieg, weil das Seil von oben kommt", "minimal, solange kaum Schlappseil im System ist"]'::jsonb, 1, 'Im Toprope läuft das Seil von oben nach unten durch den Umlenker – bei strafferem Seil ist die Sturzstrecke entsprechend kurz.'),
  (8, 'Direkt nach dem Einstieg (erste Meter über dem Boden) gilt beim Sichern …', '["besonders enge, aufmerksame Führung, da ein Sturz hier bodennah ist", "man kann sich etwas zurücklehnen, der Boden ist ja noch nah"]'::jsonb, 0, 'Die ersten Meter sind kritisch: wenig Seil im System, kurze Bremsstrecke, Boden nah. Hier ist die Aufmerksamkeit am höchsten gefragt.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'pruefung-sturztraining');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'pruefung-naturfels', * from (values
  (1, 'Eine Expresse am Bohrhaken hängst du korrekt ein, indem …', '["das lose Karabiner-Ende an den Haken kommt, Schnapper gegen die Kletterrichtung", "das feste Ende an den Haken kommt, Schnapper in Kletterrichtung"]'::jsonb, 0, 'Das lose Ende an den Haken, damit sich die Exe frei bewegen kann. Der Schnapper zeigt gegen die Kletterrichtung, sonst kann das Seil im Sturz ausclippen.'),
  (2, 'Ein Clipstick ist am Naturfels sinnvoll, weil …', '["er den Helm ersetzt", "er das bodennahe Grundfallrisiko an den ersten Haken entschärft"]'::jsonb, 1, 'Die ersten zwei bis drei Haken sind der gefährlichste Bereich. Vorclippen nimmt dort das Grundfallrisiko heraus.'),
  (3, 'Der Fels sieht trocken aus, es hat aber vor Kurzem geregnet. Im Elbsandstein bedeutet das …', '["freie Fahrt, Optik entscheidet", "Kletterverbot bzw. Wartezeit, weil nasser Sandstein an Festigkeit verliert"]'::jsonb, 1, 'Sandstein verliert nass massiv an Festigkeit, Griffe und Haken können ausbrechen – hier gilt die Wartezeit des Gebiets, nicht das Gefühl.'),
  (4, 'Ein Toprope am Umlenker richtest du ein mit …', '["zwei gegenläufig eingehängten Exen plus der Zwischensicherung darunter als Redundanz", "einer Exe, das reicht für den Umlenker"]'::jsonb, 0, 'Direkt durch den Ring verschleißt fremdes Material. Zwei gegenläufige Exen plus die Sicherung darunter sind Standard.'),
  (5, 'Beim Umbauen am Stand gilt …', '["volle Konzentration, denn es gibt keinen Partnercheck von unten", "zügig arbeiten, der Partnercheck fängt Fehler trotzdem auf"]'::jsonb, 0, 'Umbauen passiert allein und ohne Kontrolle von unten. Deshalb: langsam, bedacht, keine Ablenkung, immer redundant gesichert.'),
  (6, 'Im Vergleich zur Halle sind Tritte und Griffe am Naturfels …', '["genauso standardisiert, nur in Stein statt Kunststoff", "unregelmäßig und wechselhaft – du musst Felsgefühl entwickeln"]'::jsonb, 1, 'Die Halle bietet vorhersehbare, farblich markierte Griffe. Am Fels variiert die Struktur stark, das Gelände ist teils schwer einsehbar.'),
  (7, 'Der Abstand zwischen Zwischensicherungen (Haken) am Naturfels ist …', '["genormt wie in der Halle", "nicht genormt und kann 2–4 Meter oder mehr betragen"]'::jsonb, 1, 'Felsrouten haben keine Standardabstände – Haken sitzen dort, wo sie gut zu clippen sind. Das verändert dein Risikobewusstsein beim Vorstieg deutlich.'),
  (8, 'Du entdeckst während des Zustiegs ein Vogelnest in einer gesperrten Zone. Richtig ist …', '["das Gebiet verlassen bzw. auf andere Routen ausweichen und Bescheid geben", "weiterklettern, solange ihr leise seid"]'::jsonb, 0, 'Saisonale Sperrzeiten und Vogelschutz sind einzuhalten. Bei einem entdeckten Nest: Gebiet verlassen oder ausweichen und die Klettergebietsbetreuung informieren.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'pruefung-naturfels');

insert into public.lerninhalt_fragen (lerninhalt_id, sort_order, frage, optionen, richtige_antwort, erklaerung)
select 'pruefung-mehrseillaengen', * from (values
  (1, 'In einer Seilschaft übernimmt die vorsteigende Person …', '["nur das Klettern, der Rest liegt bei der nachsteigenden Person", "das Klettern, Absichern der Route und den Aufbau des Standplatzes"]'::jsonb, 1, 'Die vorsteigende Person klettert voraus, sichert mit Zwischensicherungen ab und baut den Standplatz auf. Die nachsteigende Person folgt und nimmt das Material wieder ab.'),
  (2, 'Bei der Wechselführung …', '["steigt eine Person über mehrere Seillängen am Stück vor", "wechseln sich die Partner nach jeder Seillänge ab, ohne Umbau am Stand"]'::jsonb, 1, 'Wechselführung bringt Tempo und Flexibilität – hat aber den Nachteil, dass schwächere Kletternde nicht vorsteigen können, wenn die nächste Seillänge zu schwer ist.'),
  (3, 'Das Raupenprinzip eignet sich besonders, wenn …', '["eine Person deutlich schwächer oder unsicherer ist als die andere", "beide Personen gleich stark klettern und schnell vorankommen wollen"]'::jsonb, 0, 'Beim Raupenprinzip behält eine Person die Vorstiegsrolle über mehrere Seillängen bei – vorteilhaft bei Stärkeunterschied, aber zeitaufwändiger durch den Rollenwechsel am Stand.'),
  (4, 'Im Vergleich zum Sportklettern braucht Mehrseillängen-Klettern …', '["meist nur eine Handvoll Expressen, mehr nicht", "typischerweise Tube/HMS, umfangreicheres Knotenkönnen und meist mehr Sicherungsmaterial"]'::jsonb, 1, 'Sportklettern kommt meist mit Expressen und einem Sicherungsknoten aus. Mehrseillängen verlangt mehr Technik, mehr Material und oft weniger gut sanierte Routen.'),
  (5, 'Die Kommunikation in einer Mehrseillängen-Seilschaft sollte …', '["symmetrisch sein – jede Meinung und jedes Signal gleichwertig gehört", "asymmetrisch sein, die vorsteigende Person entscheidet und sagt an"]'::jsonb, 0, 'Anders als die eher knappen Kommandos beim Sportklettern braucht Mehrseillängen eine symmetrische Kommunikation auf Augenhöhe – inklusive offener Worte zu Ängsten und Bedenken.'),
  (6, 'Bei der Routenwahl empfiehlt sich eine Schwierigkeit …', '["auf dem persönlichen Sportkletter-Limit, um die Zeit zu nutzen", "etwa zwei Grade unter dem persönlichen Sportkletter-Niveau"]'::jsonb, 1, 'Mehrseillängen verlangt mehr als reine Kraft: Ausdauer, Kopf, Taktik. Ein Sicherheitsabstand zum eigenen Limit lässt Reserven für diese Faktoren.'),
  (7, 'Die Checkpunkt-Methode während der Tour bedeutet …', '["sich regelmäßig zu Zeitplan, Kraftreserven und Rückzugsmöglichkeiten abzustimmen", "nur am Einstieg einmal den Plan zu besprechen und dann durchzuziehen"]'::jsonb, 0, 'Regelmäßige Selbst-Checks (Zeitplan, Kräfte, Wetter, Rückzugsoptionen) helfen, rechtzeitig umzusteuern statt erst in der Krise zu reagieren.'),
  (8, 'Das „Risiko-Schub-Phänomen“ beschreibt, dass …', '["Gruppen tendenziell mehr Risiko eingehen, weil sich die Verantwortung diffus verteilt", "größere Gruppen automatisch sicherer unterwegs sind"]'::jsonb, 0, 'In Gruppen wird Verantwortung geteilt – dadurch steigt paradoxerweise die Bereitschaft, Risiken einzugehen. Bewusstsein dafür ist gerade in der kleinen Seilschaft wichtig.')
) as v(sort_order, frage, optionen, richtige_antwort, erklaerung)
where not exists (select 1 from public.lerninhalt_fragen where lerninhalt_id = 'pruefung-mehrseillaengen');


-- ============================================================================
-- 4) submit_pruefung — liest richtige Antworten + Bestehensgrenze jetzt aus
--    lerninhalt_fragen / lerninhalte statt aus fest hinterlegten Listen
-- ============================================================================

create or replace function public.submit_pruefung(p_pruefung_id text, p_answers int[])
returns table (score int, total int, passed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correct int[];
  v_total int;
  v_score int := 0;
  v_pass_threshold int;
  v_user_id uuid := auth.uid();
  i int;
begin
  if v_user_id is null then
    raise exception 'Nicht angemeldet';
  end if;

  if not exists (
    select 1 from public.pruefungsfreigaben
    where user_id = v_user_id and pruefung_id = p_pruefung_id
  ) then
    raise exception 'Prüfung nicht freigeschaltet';
  end if;

  select array_agg(richtige_antwort order by sort_order)
    into v_correct
    from public.lerninhalt_fragen
    where lerninhalt_id = p_pruefung_id;

  if v_correct is null or array_length(v_correct, 1) is null then
    raise exception 'Unbekannte Prüfung';
  end if;

  v_total := array_length(v_correct, 1);

  if p_answers is null or array_length(p_answers, 1) is distinct from v_total then
    raise exception 'Antwortanzahl stimmt nicht mit der Fragenanzahl überein';
  end if;

  select coalesce(bestehensgrenze, ceil(v_total / 2.0)::int)
    into v_pass_threshold
    from public.lerninhalte
    where id = p_pruefung_id;

  for i in 1..v_total loop
    if p_answers[i] is not null and p_answers[i] = v_correct[i] then
      v_score := v_score + 1;
    end if;
  end loop;

  insert into public.lernfortschritt (user_id, item_id, kind, score, total, passed)
  values (v_user_id, p_pruefung_id, 'pruefung', v_score, v_total, v_score >= v_pass_threshold)
  on conflict (user_id, item_id) do update
    set score = excluded.score, total = excluded.total, passed = excluded.passed, created_at = now();

  return query select v_score, v_total, (v_score >= v_pass_threshold);
end;
$$;

grant execute on function public.submit_pruefung(text, int[]) to authenticated;


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> lerninhalt_fragen: 38 Zeilen (5+5+8+8+8+8).
-- lerninhalte -> bestehensgrenze bei den 6 Quiz/Prüfungen gesetzt.
-- ============================================================================
