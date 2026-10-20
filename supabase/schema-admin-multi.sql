-- BETAMOVE — Mehrere Admin/Kursleitungs-Konten statt einer fest einprogram-
-- mierten E-Mail-Adresse
-- ============================================================================
-- Baut auf allen vorherigen schema-*.sql-Dateien auf (müssen vorher gelaufen
-- sein). Ersetzt KEINE bestehenden Tabellen — legt nur eine neue Tabelle
-- `admin_emails` + Hilfsfunktion `is_betamove_admin()` an und zeigt alle
-- bisherigen "auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'"-Policies
-- (verstreut über ca. 10 schema-*.sql-Dateien) auf diese Funktion um.
--
-- Admin-Liste künftig ändern: einfach in admin_emails einfügen/löschen,
-- OHNE dass irgendeine Policy nochmal angefasst werden muss, z.B.:
--   insert into public.admin_emails (email) values ('neue-adresse@example.com');
--   delete from public.admin_emails where email = 'alte-adresse@example.com';
-- WICHTIG: Jede neue Admin-Adresse muss zusätzlich in js/account.js im Array
-- ADMIN_EMAILS eingetragen werden (clientseitige Anzeige des Admin-Links) —
-- diese Datei hier regelt nur die Datenbank-Rechte.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) admin_emails + is_betamove_admin()
-- ============================================================================

create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);

comment on table public.admin_emails is 'Login-Adressen mit Admin-/Kursleitungs-Rechten. Kein direkter Lesezugriff für anon/authenticated — nur über is_betamove_admin() geprüft.';

-- RLS an, aber bewusst OHNE jede Policy: damit ist die Tabelle für anon/
-- authenticated komplett gesperrt (auch ohne diese Zeile schon der Fall, da
-- keine GRANTs vergeben werden — RLS zusätzlich als zweite Absicherung).
-- is_betamove_admin() liest trotzdem weiter: die Funktion läuft "security
-- definer" mit den Rechten ihres Besitzers, und Tabellen-Besitzer umgehen
-- RLS auf ihre eigenen Tabellen grundsätzlich.
alter table public.admin_emails enable row level security;

insert into public.admin_emails (email) values
  ('noel.uhlrich@gmail.com'),
  ('annalenafritz@outlook.com')
on conflict (email) do nothing;

-- security definer: läuft mit den Rechten der Funktion (nicht der
-- aufrufenden Person), damit auch ohne direkte SELECT-Policy auf
-- admin_emails geprüft werden kann, ob die eingeloggte Person Admin ist —
-- die Admin-Liste selbst bleibt damit nicht pauschal für alle eingeloggten
-- Personen lesbar.
create or replace function public.is_betamove_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_emails
    where email = (auth.jwt() ->> 'email')
  );
$$;

grant execute on function public.is_betamove_admin() to authenticated;


-- ============================================================================
-- 2) Bestehende Admin-Policies auf is_betamove_admin() umstellen
-- ============================================================================
-- Jede Policy unten entspricht 1:1 der Version aus der jeweiligen
-- schema-*.sql-Datei (gleicher Name, gleiches Kommando, gleiche
-- Zusatzbedingungen) — nur die hartkodierte E-Mail ist ersetzt.

-- --- schema-admin-kommentare.sql: kursanmeldungen -------------------------
drop policy if exists "kursanmeldungen_admin_select" on public.kursanmeldungen;
create policy "kursanmeldungen_admin_select"
  on public.kursanmeldungen for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "kursanmeldungen_admin_update" on public.kursanmeldungen;
create policy "kursanmeldungen_admin_update"
  on public.kursanmeldungen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

-- --- schema-kursanmeldung-teilnehmer.sql ----------------------------------
drop policy if exists "kursanmeldung_teilnehmer_admin_select" on public.kursanmeldung_teilnehmer;
create policy "kursanmeldung_teilnehmer_admin_select"
  on public.kursanmeldung_teilnehmer for select
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-kursverwaltung.sql: kurse --------------------------------------
drop policy if exists "kurse_admin_select" on public.kurse;
create policy "kurse_admin_select"
  on public.kurse for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "kurse_admin_insert" on public.kurse;
create policy "kurse_admin_insert"
  on public.kurse for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "kurse_admin_update" on public.kurse;
create policy "kurse_admin_update"
  on public.kurse for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "kurse_admin_delete" on public.kurse;
create policy "kurse_admin_delete"
  on public.kurse for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-gutscheine-rabatte.sql: gutscheine -----------------------------
drop policy if exists "gutscheine_admin_select" on public.gutscheine;
create policy "gutscheine_admin_select"
  on public.gutscheine for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "gutscheine_admin_insert" on public.gutscheine;
create policy "gutscheine_admin_insert"
  on public.gutscheine for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "gutscheine_admin_update" on public.gutscheine;
create policy "gutscheine_admin_update"
  on public.gutscheine for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "gutscheine_admin_delete" on public.gutscheine;
create policy "gutscheine_admin_delete"
  on public.gutscheine for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-gutscheine-rabatte.sql: rabatt_einstellungen -------------------
drop policy if exists "rabatt_einstellungen_admin_select" on public.rabatt_einstellungen;
create policy "rabatt_einstellungen_admin_select"
  on public.rabatt_einstellungen for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "rabatt_einstellungen_admin_update" on public.rabatt_einstellungen;
create policy "rabatt_einstellungen_admin_update"
  on public.rabatt_einstellungen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

-- --- schema-pruefungen-zertifikate.sql: profiles + pruefungsfreigaben -----
drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select"
  on public.profiles for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "pruefungsfreigaben_admin_select" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_select"
  on public.pruefungsfreigaben for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "pruefungsfreigaben_admin_insert" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_insert"
  on public.pruefungsfreigaben for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "pruefungsfreigaben_admin_delete" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_delete"
  on public.pruefungsfreigaben for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-qualifikationen.sql: lerninhalte -------------------------------
drop policy if exists "lerninhalte_admin_insert" on public.lerninhalte;
create policy "lerninhalte_admin_insert"
  on public.lerninhalte for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "lerninhalte_admin_update" on public.lerninhalte;
create policy "lerninhalte_admin_update"
  on public.lerninhalte for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "lerninhalte_admin_delete" on public.lerninhalte;
create policy "lerninhalte_admin_delete"
  on public.lerninhalte for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-qualifikationen.sql: qualifikationen ---------------------------
drop policy if exists "qualifikationen_admin_select" on public.qualifikationen;
create policy "qualifikationen_admin_select"
  on public.qualifikationen for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "qualifikationen_admin_insert" on public.qualifikationen;
create policy "qualifikationen_admin_insert"
  on public.qualifikationen for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "qualifikationen_admin_update" on public.qualifikationen;
create policy "qualifikationen_admin_update"
  on public.qualifikationen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "qualifikationen_admin_delete" on public.qualifikationen;
create policy "qualifikationen_admin_delete"
  on public.qualifikationen for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-qualifikationen.sql: qualifikation_anforderungen ---------------
drop policy if exists "qualifikation_anforderungen_admin_insert" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_insert"
  on public.qualifikation_anforderungen for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "qualifikation_anforderungen_admin_update" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_update"
  on public.qualifikation_anforderungen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "qualifikation_anforderungen_admin_delete" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_delete"
  on public.qualifikation_anforderungen for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-artikel-inhalte.sql: artikel_inhalte ---------------------------
drop policy if exists "artikel_inhalte_admin_insert" on public.artikel_inhalte;
create policy "artikel_inhalte_admin_insert"
  on public.artikel_inhalte for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "artikel_inhalte_admin_update" on public.artikel_inhalte;
create policy "artikel_inhalte_admin_update"
  on public.artikel_inhalte for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "artikel_inhalte_admin_delete" on public.artikel_inhalte;
create policy "artikel_inhalte_admin_delete"
  on public.artikel_inhalte for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-lerninhalt-fragen.sql: lerninhalt_fragen -----------------------
drop policy if exists "lerninhalt_fragen_admin_insert" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_insert"
  on public.lerninhalt_fragen for insert
  to authenticated
  with check (public.is_betamove_admin());

drop policy if exists "lerninhalt_fragen_admin_update" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_update"
  on public.lerninhalt_fragen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());

drop policy if exists "lerninhalt_fragen_admin_delete" on public.lerninhalt_fragen;
create policy "lerninhalt_fragen_admin_delete"
  on public.lerninhalt_fragen for delete
  to authenticated
  using (public.is_betamove_admin());

-- --- schema-trainingsplan-v7.sql: trainingsplaene/-eintraege (nur lesen,
--     zusätzlich nur wenn training_coach_freigabe true ist) ----------------
drop policy if exists "trainingsplaene_admin_select" on public.trainingsplaene;
create policy "trainingsplaene_admin_select"
  on public.trainingsplaene for select
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_freigabe = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_select" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_select"
  on public.trainingsplan_eintraege for select
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_freigabe = true
    )
  );

-- --- schema-coach-bearbeiten.sql: trainingsplaene/-eintraege/-workouts
--     (schreiben, zusätzlich nur wenn training_coach_bearbeiten true ist) --
drop policy if exists "trainingsplaene_admin_insert" on public.trainingsplaene;
create policy "trainingsplaene_admin_insert"
  on public.trainingsplaene for insert
  to authenticated
  with check (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplaene_admin_update" on public.trainingsplaene;
create policy "trainingsplaene_admin_update"
  on public.trainingsplaene for update
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  )
  with check (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplaene_admin_delete" on public.trainingsplaene;
create policy "trainingsplaene_admin_delete"
  on public.trainingsplaene for delete
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_insert" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_insert"
  on public.trainingsplan_eintraege for insert
  to authenticated
  with check (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_update" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_update"
  on public.trainingsplan_eintraege for update
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  )
  with check (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_delete" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_delete"
  on public.trainingsplan_eintraege for delete
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsworkouts_admin_select" on public.trainingsworkouts;
create policy "trainingsworkouts_admin_select"
  on public.trainingsworkouts for select
  to authenticated
  using (
    public.is_betamove_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsworkouts.user_id
        and p.training_coach_bearbeiten = true
    )
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> admin_emails: zwei Zeilen (noel.uhlrich@gmail.com,
-- annalenafritz@outlook.com). Beide Adressen können sich jetzt einloggen und
-- sehen in "Mein Konto" den Link "Kursverwaltung (Admin)" sowie Zugriff auf
-- alle admin-*.html-Seiten (Kurse, Konten, Rabatte, Trainingspläne, Fragen).
-- ============================================================================
