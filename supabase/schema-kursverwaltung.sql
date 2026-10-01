-- BETAMOVE — Schema-Erweiterung: Kurse aus der Datenbank statt aus
-- js/courses-data.js verwalten
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-admin-kommentare.sql,
-- schema-pruefungen-zertifikate.sql und schema-buchungsverwaltung.sql auf
-- (müssen vorher gelaufen sein).
--
-- Ab jetzt ist diese Tabelle (`kurse`) die einzige Quelle für Kursdaten —
-- die Website liest sie live aus, du kannst Kurse direkt im Adminbereich
-- (admin-kurse-verwaltung) anlegen, bearbeiten und offline nehmen, ohne dass
-- dafür noch Code geändert werden muss.
--
-- WICHTIG: Wie bei den vorherigen Dateien — ersetze 'noel.uhlrich@gmail.com'
-- durch die tatsächliche Login-Adresse der Kursleitung, falls nötig.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar — die Seed-Daten
-- unten werden nur beim ersten Mal eingefügt (ON CONFLICT DO NOTHING),
-- spätere Bearbeitungen im Adminbereich werden also nie überschrieben.
-- ============================================================================


-- ============================================================================
-- 1) Tabelle
-- ============================================================================

create table if not exists public.kurse (
  id              text primary key,
  title           text not null,
  level           text not null,
  level_badge     text,
  dauer           text not null,
  price           integer not null,
  img             text,
  img_position    text,
  termin_text     text not null,
  sort_date       date,
  ort             text not null,
  teaser          text,
  beschreibung    text,
  lernziel        text,
  inhalte         text[],
  voraussetzungen text[],
  equipment       text[],
  hinweis         text,
  keywords        text[],
  ist_paket       boolean not null default false,
  max_teilnehmer  integer,
  aktiv           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint kurse_id_len check (char_length(id) between 1 and 60),
  constraint kurse_price_nonneg check (price >= 0),
  constraint kurse_max_teilnehmer_pos check (max_teilnehmer is null or max_teilnehmer > 0)
);

comment on table public.kurse is 'Kurskatalog — einzige Quelle für Kursdaten, von der Website live gelesen';
comment on column public.kurse.id is 'Stabile ID, u.a. referenziert von kursanmeldungen.kurs_id — nie ändern, nur neu anlegen';
comment on column public.kurse.termin_text is 'Frei formatierter Termin-Text für die Anzeige (z.B. "06.06. – 07.06.2026" oder "Termin auf Anfrage")';
comment on column public.kurse.sort_date is 'Datum des ersten Termins für die Sortierung, leer = "Termin auf Anfrage" (steht immer hinten)';
comment on column public.kurse.aktiv is 'Nur aktive Kurse erscheinen auf der Website — zum "Offline nehmen" einfach auf false setzen';
comment on column public.kurse.max_teilnehmer is 'Optional. Leer = keine Kapazitätsgrenze/-anzeige';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists kurse_set_updated_at on public.kurse;
create trigger kurse_set_updated_at
  before update on public.kurse
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 2) RLS — öffentlich lesbar (nur aktive Kurse), volle Kontrolle für die
--    Kursleitung
-- ============================================================================

alter table public.kurse enable row level security;

drop policy if exists "kurse_select_active" on public.kurse;
create policy "kurse_select_active"
  on public.kurse for select
  to anon, authenticated
  using (aktiv = true);

drop policy if exists "kurse_admin_select" on public.kurse;
create policy "kurse_admin_select"
  on public.kurse for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "kurse_admin_insert" on public.kurse;
create policy "kurse_admin_insert"
  on public.kurse for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "kurse_admin_update" on public.kurse;
create policy "kurse_admin_update"
  on public.kurse for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "kurse_admin_delete" on public.kurse;
create policy "kurse_admin_delete"
  on public.kurse for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- 3) Seed — die 9 bisherigen Kurse aus js/courses-data.js, einmalig
-- ============================================================================

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'halle', 'Von der Halle an den Fels', 'Einstieg Fels', null, '2 Tage', 75, 'kurs-halle.jpg', null,
  '06.06. – 07.06.2026', '2026-06-06', 'Klettergarten um Leipzig',
  'Der Klassiker für alle, die aus der Halle raus wollen: Vorsteigen und Sichern am Naturfels, Routenauswahl, Abbauen und Abseilen.',
  'Du hast bereits Klettererfahrungen in der Kletterhalle gesammelt und hast Lust, endlich draußen am Fels zu klettern? Dann solltest du auf jeden Fall diesen Kurs besuchen.',
  'Nach dem Kurs kannst du selbstständig in einem Klettergarten klettern und kennst alle wichtigen Techniken, um sicher nach oben sowie nach unten zu kommen.',
  ARRAY['Vorsteigen und Sichern am Naturfels','Einhängen der Zwischensicherungen','Sinnvolle Fels- und Routenauswahl','Abbauen des Materials und Abseilen','Gefahrensituationen Outdoor'],
  ARRAY['Vorstieg klettern im 5. Grad in der Kletterhalle','Erfahrungen im Vorstieg sichern (auch bereits Stürze gesichert)'],
  ARRAY['Gurt','Seil','Sicherungsgerät (Halbautomat o. Autotuber)','Helm','Exen'],
  'Der Ort wird vor dem Kurs mitgeteilt. Vergünstigter Preis für Studierende und Azubis.',
  ARRAY['halle an den fels','halle-fels','von der halle','zum fels','naturfels','erster felskurs'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'msl', 'Mehrseillängen für Fortgeschrittene', 'Fortgeschritten', null, '2 Tage', 169, 'kurs-msl.jpg', null,
  'Termin auf Anfrage', null, 'Wird vor dem Kurs mitgeteilt',
  'Standplatzbau, behelfsmäßige Bergrettung und individuelles Feedback zu deinen Gewohnheiten in der Mehrseillänge.',
  'Du besitzt bereits Erfahrung im Klettern von Mehrseillängen, hast ein gutes Handling mit dem Alpin-Tuber und kannst selbstständig einen Standplatz bauen? In diesem Kurs erweitern wir diese Fähigkeiten und schauen deine Gewohnheiten oder eventuelle Fehler genau an. Du lernst die Grundlagen der behelfsmäßigen Bergrettung, sodass du auch im Notfall reagieren kannst.',
  'Durch individuelles Feedback und die Einschätzung des Kletterlehrers kannst du deinen derzeitigen Wissensstand prüfen. Außerdem weißt du, woran du noch arbeiten kannst. Dazu erhältst du Grundkenntnisse in der behelfsmäßigen Bergrettung und erweiterte Fähigkeiten im Standplatzbau.',
  ARRAY['Behelfsmäßige Bergrettung','Individuelles Feedback und aktuelle Lehrmeinung Mehrseillängen','Möglichst viel Praxis'],
  ARRAY['Erfahrungen beim Mehrseillängen klettern','Umgang mit Alpin-Tuber','Erfahrungen im Abseilen'],
  ARRAY['Gurt','Halbseile','Sicherungsgerät (Alpin-Tuber)','5–10 Karabiner','Helm','Alpinexen','5 m 6 mm Reepschnur und Prusikschnur','Bandschlinge (120 cm, 240 cm)','Adjust (Selbstsicherung)'],
  'BETAMOVE passt sich an die Gruppe an – die Lehrinhalte können sich dadurch etwas verschieben.',
  ARRAY['mehrseillänge','mehrseillaenge','msl','alpin','standplatz'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'mobil', 'Keile, Friends und Co. – Mobile Sicherung', 'Fortgeschritten', null, '1 Tag', 149, 'kurs-mobil.jpg', null,
  'Termin auf Anfrage', null, 'Klettergebiet nach Absprache',
  'Cams und Keile legen, testen und vertrauen lernen – inklusive Trainingsaufbau für dein eigenes Üben.',
  'Du hast erste Erfahrungen mit mobilen Sicherungen gesammelt oder möchtest in das Thema einsteigen? In diesem Kurs lernst du den sicheren Umgang mit mobilen Sicherungsmitteln – mit besonderem Fokus auf Cams. Ziel ist es, ein fundiertes Verständnis zu entwickeln und Sicherheit beim Legen zu gewinnen. Zusätzlich bekommst du einen sinnvollen Trainingsaufbau an die Hand, mit dem du deine Fähigkeiten eigenständig weiterentwickeln kannst.',
  'Der Kurs vermittelt dir ein solides Gefühl für mobile Sicherungen – durch Wissen, Ausprobieren und Wiederholen. In einer sicheren Umgebung hast du die Möglichkeit, verschiedene Sicherungen zu testen und ein Gespür für ihre Zuverlässigkeit zu entwickeln. Nach dem Kurs bist du in der Lage, selbstständig am Fels mit mobilen Sicherungen zu klettern und Vertrauen in dein Material aufzubauen – auch im Falle eines Sturzes.',
  ARRAY['Theoretische Grundlagen zu mobilen Sicherungen','Intensives Praxistraining im Legen von Cams und Keilen','Konkrete Übungen für dein eigenes Training','Optional: Einführung in die Rissklettertechnik (je nach Zeit)'],
  ARRAY['Sicheres Vorstiegsklettern im 5. Grad am Naturfels','Gute Sicherungspraxis beim Sichern von Kletternden'],
  ARRAY['Klettergurt','Helm','Mobile Sicherungen (Cams, Keile etc.)','Einfachseil','Sicherungsgerät (Autotuber oder Halbautomat)','Optional: Reibungsassistent (bei großem Gewichtsunterschied)'],
  'Leihmaterial kann bei Bedarf gestellt werden – bitte vorher anfragen.',
  ARRAY['mobile sicherung','cam','friend','keil','trad klettern','clean klettern'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'technik', 'Besser Klettern – Bewegungstechnik', 'Alle Level', 'Offen für alle', '1 Tag', 99, 'kurs-technik.jpg', null,
  '02.12. / 09.12. / 16.12.2026', '2026-12-02', 'Kletterhalle No Limit',
  'Bewegungsanalyse mit individuellem Feedback statt Schema F – wir finden heraus, was dich bremst.',
  'Du hast das Gefühl, beim Klettern auf der Stelle zu treten? Deine Technik fühlt sich nicht stimmig an, die Motivation lässt nach und eine klare Lösung ist nicht in Sicht? In diesem Kurs nehmen wir deine Bewegungen gezielt unter die Lupe. Dabei erhältst du individuelles, praxisnahes Feedback und keine starren Standardlösungen. Statt vorgegebener Schemata erhältst du persönliches Feedback, das genau auf dich und dein Klettern zugeschnitten ist. Gemeinsam finden wir heraus, was dich aktuell bremst und wie du effizienter vorankommst.',
  'Du erhältst individuelles Feedback zu deinen Bewegungen. Du verstehst nach dem Kurs, welche kleinen Gewohnheiten sich eingeschlichen haben, was dir fehlt, um dein Ziel zu erreichen und erhältst konkrete Aufgaben, die dir helfen werden, die Bewegungen zu verbessern.',
  ARRAY['Bewegungsanalyse mit individuellem Feedback','Konkrete individuelle Aufgaben zur Verbesserung deiner Bewegungstechnik','Verständnis-Aufbau der Kletter-Phasen'],
  ARRAY['Bewegungserfahrung im 6. Grad (idealerweise Vorstieg)','Vorstieg sichern von Vorteil'],
  ARRAY['Gurt','Einfachseil','Sicherungsgerät (Autotuber, Halbautomat)','Eventuell Reibungsassistent (bei großem Gewichtsunterschied)'],
  'Hast du noch keine langjährige Erfahrung, schreibe das bitte bei der Anmeldung dazu, damit wir vorher nochmal telefonieren können – anmelden kannst du dich trotzdem. Drei Termine (02.12., 09.12., 16.12.2026), Equipment kann ausgeliehen werden, bitte anfragen.',
  ARRAY['bewegungstechnik','besser klettern','technik verbessern','bewegungsanalyse'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'update', 'Sicherungs-Update', 'Auffrischung', null, '3 Stunden', 75, 'kurs-update.jpg', 'center 22%',
  '16.01.2027', '2027-01-16', 'Kletterhalle No Limit',
  'Aktuelle Lehrmeinung, Gewohnheiten-Check und Sicherungsmythen aufgedeckt – mit Zertifikat.',
  'Du bist dir unsicher, ob du alles richtig machst? In diesem Kurs werden wir dich auf den aktuellen Stand der Lehrmeinung bringen. Wir betrachten deine Gewohnheiten und werden eventuelle Sicherungs-Mythen aufdecken und besprechen.',
  'Nach dem Kurs kennst du die aktuelle Lehrmeinung und hast deine Sicherungspraxis nachhaltig verbessert.',
  ARRAY['Übung der Sicherungspraxis','Vermittlung der aktuellen Lehrmeinung','Gewohnheiten-Check mit individueller Rückmeldung eines Kletterlehrers','Zertifikat Sicherungsupdate'],
  ARRAY['Vorstieg klettern im 5. Grad in der Kletterhalle','Erfahrungen im Vorstieg sichern (auch bereits Stürze gesichert)'],
  ARRAY['Seil','Sicherungsgerät','Gurt'],
  'Es kann Equipment ausgeliehen werden. Bitte anfragen.',
  ARRAY['sicherungs-update','sicherungsupdate','auffrischung','lange nicht mehr geklettert','aktueller stand'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, teaser, beschreibung, lernziel, inhalte, voraussetzungen, equipment, hinweis, keywords, ist_paket)
values (
  'sturz', 'Sturz- und Sicherungstraining', 'Alle Level', 'Offen für alle', '3 Stunden', 75, 'kurs-sturz.jpg', 'center 20%',
  '17.01.2027', '2027-01-17', 'Kletterhalle No Limit',
  'Weich sichern, Gewichtsunterschiede verstehen und Stürze ohne Verletzung erlernen.',
  'Angst ist ein wichtiger Teil des Kletterns, jedoch ist der Umgang mit diesem Gefühl manchmal schwer. Wir schauen uns diese Ängste an und behandeln sie mit praxisnahen Übungen.',
  'Nach dem Kurs verstehst du, wie du weich sichern kannst, wie sich ein Gewichtsunterschied auf Stürze auswirkt und was NoGos sind. Du verstehst viele Zusammenhänge zwischen Sturz, Sichern und externen sowie internen Faktoren.',
  ARRAY['Umgang mit dem Sicherungsgerät','Sturztraining (mit Aufbau für das Üben privat)','Umgang mit Gewichtsunterschieden','Gefahrenanalyse (interne und externe Faktoren)','Individuelles Coaching und Empfehlungen','Kommunikation in einer Seilschaft','Erlernen von Fallen ohne Verletzung','Erlernen weiches Sichern'],
  ARRAY['Vorstieg sichern (idealerweise bereits ein paar Stürze gehalten – kein Muss, jedoch sinnvoll)','Routinierter Umgang mit deinem Sicherungsgerät (Halbautomat o. Autotuber)'],
  ARRAY['Gurt','Seil','Sicherungsgerät (Halbautomat o. Autotuber)'],
  null,
  ARRAY['sturztraining','sturz','angst vorm stürzen','angst vorm sturz','weich sichern'],
  false
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, ist_paket)
values (
  'paket-basis', 'Jahresausbildung Basis', 'Stufe 1–3', null, '1 Jahr', 799, null, null,
  'Einstieg jederzeit · nächster Zyklus ab März', null, 'Leipzig, Elbsandstein und Umgebung', true
) on conflict (id) do nothing;

insert into public.kurse (id, title, level, level_badge, dauer, price, img, img_position, termin_text, sort_date, ort, ist_paket)
values (
  'paket-komplett', 'Jahresausbildung Komplett', 'Stufe 1–3 + Woche', null, '1 Jahr', 1490, null, null,
  'Einstieg jederzeit · nächster Zyklus ab März', null, 'Leipzig, Elbsandstein, Ausbildungswoche outdoor', true
) on conflict (id) do nothing;


-- ============================================================================
-- 4) Öffentliche Buchungszahlen pro Kurs (für "X Plätze frei"/"Ausgebucht")
-- ============================================================================
-- kursanmeldungen selbst ist für anonyme Besucher*innen nicht lesbar (nur
-- Name, E-Mail etc. der Kursleitung vorbehalten) — diese Funktion gibt
-- bewusst NUR aggregierte Zahlen zurück, keine Buchungsdetails, und ist
-- deshalb auch für anon freigegeben. kurs_id kann bei Mehrfachbuchungen
-- mehrere, kommagetrennte IDs enthalten (siehe anmeldung.html) — die werden
-- hier einzeln gezählt.

create or replace function public.kurs_buchungszahlen()
returns table (kurs_id text, anzahl bigint)
language sql
security definer
set search_path = public
stable
as $$
  select trim(einzel_id) as kurs_id, count(*) as anzahl
  from public.kursanmeldungen, unnest(string_to_array(kursanmeldungen.kurs_id, ',')) as einzel_id
  where kursanmeldungen.storniert = false
  group by trim(einzel_id);
$$;

grant execute on function public.kurs_buchungszahlen() to anon, authenticated;


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> kurse: 9 Zeilen, RLS enabled, 5 Policies.
-- Database -> Functions: kurs_buchungszahlen sollte gelistet sein.
-- ============================================================================
