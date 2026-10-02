-- BETAMOVE — Sicherheits-Härtung: Buchungsstatus und Prüfungsergebnisse
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-admin-kommentare.sql,
-- schema-pruefungen-zertifikate.sql und schema-buchungsverwaltung.sql auf
-- (müssen vorher gelaufen sein).
--
-- Dieses Skript schränkt ein, was eingeloggte Personen selbst in
-- `kursanmeldungen` und `lernfortschritt` schreiben dürfen — bisher ließen
-- die INSERT/UPDATE-Policies Felder zu, die ausschließlich der Kursleitung
-- bzw. einer serverseitigen Prüfung vorbehalten sein sollen. Dazu kommt eine
-- neue Funktion `submit_pruefung`, die Online-Prüfungen serverseitig
-- auswertet und das Ergebnis selbst einträgt (statt es vom Browser
-- entgegenzunehmen).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) kursanmeldungen — Buchungsstatus-Felder bleiben bei der Kursleitung
-- ============================================================================
-- Eine neue Buchung darf nur mit den Standardwerten angelegt werden (nicht
-- schon als bestätigt/storniert, ohne Admin-Notiz) — diese Felder ändert
-- danach ausschließlich die Kursleitung (admin-kurse) oder die bestehenden
-- security-definer-Funktionen (claim_kursanmeldungen_by_email,
-- cancel_kursanmeldung).

drop policy if exists "kursanmeldungen_insert_only" on public.kursanmeldungen;
create policy "kursanmeldungen_insert_only"
  on public.kursanmeldungen
  for insert
  to anon, authenticated
  with check (
    char_length(trim(vorname)) between 1 and 100
    and char_length(trim(nachname)) between 1 and 100
    and email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length(level) <= 60
    and rabatt_typ in ('none', 'student')
    and (anmerkungen is null or char_length(anmerkungen) <= 2000)
    and agb_akzeptiert = true
    and (user_id is null or user_id = auth.uid())
    and teilnahme_bestaetigt = false
    and teilnahme_bestaetigt_at is null
    and storniert = false
    and storniert_at is null
    and admin_notiz is null
  );


-- ============================================================================
-- 2) lernfortschritt — Prüfungs- und Kursergebnisse nicht direkt beschreibbar
-- ============================================================================
-- Artikel "gelesen" und Quiz-Ergebnisse bleiben wie bisher direkt vom Browser
-- schreibbar (niedriger Einsatz, keine Zertifikatsrelevanz). Prüfungen
-- ('pruefung') laufen ab jetzt ausschließlich über die Funktion
-- submit_pruefung() unten (serverseitig ausgewertet). 'kurs' wird seit der
-- admin-bestätigten Kursteilnahme ohnehin nicht mehr direkt geschrieben.

drop policy if exists "lernfortschritt_insert_own" on public.lernfortschritt;
create policy "lernfortschritt_insert_own"
  on public.lernfortschritt for insert
  to authenticated
  with check (auth.uid() = user_id and kind in ('artikel', 'quiz'));

drop policy if exists "lernfortschritt_update_own" on public.lernfortschritt;
create policy "lernfortschritt_update_own"
  on public.lernfortschritt for update
  to authenticated
  using (auth.uid() = user_id and kind in ('artikel', 'quiz'))
  with check (auth.uid() = user_id and kind in ('artikel', 'quiz'));


-- ============================================================================
-- 3) submit_pruefung — serverseitige Auswertung der Online-Prüfungen
-- ============================================================================
-- Nimmt die abgegebenen Antworten entgegen, vergleicht sie mit den (nur hier
-- hinterlegten) richtigen Antworten und trägt das Ergebnis selbst ein.
-- Voraussetzung: Freischaltung durch die Kursleitung muss vorliegen
-- (pruefungsfreigaben) — ohne Freischaltung wird kein Ergebnis gespeichert.

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
  v_pass_threshold int := 6;
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

  v_correct := case p_pruefung_id
    when 'pruefung-sicherungsschein' then array[1,0,0,1,0,1,1,1]
    when 'pruefung-sturztraining'    then array[1,1,1,0,1,0,1,0]
    when 'pruefung-naturfels'        then array[0,1,1,0,0,1,1,0]
    when 'pruefung-mehrseillaengen'  then array[1,1,0,1,0,1,0,0]
    else null
  end;

  if v_correct is null then
    raise exception 'Unbekannte Prüfung';
  end if;

  v_total := array_length(v_correct, 1);

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
-- Table Editor -> kursanmeldungen / lernfortschritt: Reiter "Policies" zeigt
-- die aktualisierten Insert/Update-Regeln.
-- Database -> Functions: submit_pruefung sollte gelistet sein.
-- ============================================================================
