-- BETAMOVE — Trainerscheine (DAV-Lizenzen): Fortbildungspflicht im Blick
-- ============================================================================
-- Baut auf schema.sql und schema-konten.sql auf (müssen vorher gelaufen sein).
--
-- Jedes Konto kann hier seine eigenen Trainerscheine (z.B. DAV Trainer*in C/B/A
-- Sportklettern, Kletterbetreuer*in) erfassen: wann erhalten, in welchem
-- Rhythmus eine Fortbildung fällig ist, und eine Historie der bereits
-- gemachten Fortbildungen. Rein persönliche Daten je Nutzer*in — nicht
-- BETAMOVE-spezifisch, keine Verbindung zu Kunden/Sachkundige-Rolle.
--
-- WICHTIG zum Fortbildungsrhythmus: die tatsächliche Frist variiert je nach
-- Lizenz, Jahrgang und Landesverband und wird vom DAV auch nicht einheitlich
-- angegeben (siehe eigene Recherche: teils 3, teils 4, teils 5, teils 6 Jahre
-- für augenscheinlich dieselbe Lizenzart, je nach Quelle/Jahr). Deshalb wird
-- der Rhythmus hier bewusst NICHT fest hinterlegt, sondern von der Person
-- selbst eingetragen (wie beim PSA-Prüfrhythmus) — die Seite weist darauf
-- hin, den Wert bei der eigenen DAV-Sektion/Landesverband zu prüfen.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainerscheine — ein Trainerschein/eine Lizenz, je Nutzer*in
-- ============================================================================

create table if not exists public.trainerscheine (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  bezeichnung               text not null,
  absolvierungsdatum        date not null,
  rhythmus_jahre            int not null,
  aktiv                     boolean not null default true,
  erinnerung_6_monate       boolean not null default false,
  erinnerung_3_monate       boolean not null default false,
  erinnerung_1_monat        boolean not null default false,
  erinnerung_6_monate_am    date,
  erinnerung_3_monate_am    date,
  erinnerung_1_monat_am     date,
  notiz                     text,
  created_at                timestamptz not null default now(),

  constraint trainerscheine_bezeichnung_len check (char_length(trim(bezeichnung)) between 1 and 160),
  constraint trainerscheine_rhythmus_val check (rhythmus_jahre between 1 and 10),
  constraint trainerscheine_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainerscheine is 'Trainerscheine/DAV-Lizenzen je Nutzer*in, mit Fortbildungsrhythmus und optionalen E-Mail-Erinnerungen';
comment on column public.trainerscheine.rhythmus_jahre is 'Fortbildungsrhythmus in Jahren — von der Person selbst eingetragen, da der DAV je Lizenz/Jahrgang/Landesverband unterschiedliche Fristen angibt';
comment on column public.trainerscheine.erinnerung_6_monate_am is 'Datum, an dem die 6-Monats-Erinnerung für den aktuellen Zyklus verschickt wurde (null = noch nicht) — wird bei einer neuen Fortbildung zurückgesetzt';

create index if not exists trainerscheine_user_id_idx on public.trainerscheine (user_id, created_at desc);

alter table public.trainerscheine enable row level security;

drop policy if exists "trainerscheine_select_own" on public.trainerscheine;
create policy "trainerscheine_select_own"
  on public.trainerscheine for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainerscheine_insert_own" on public.trainerscheine;
create policy "trainerscheine_insert_own"
  on public.trainerscheine for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainerscheine_update_own" on public.trainerscheine;
create policy "trainerscheine_update_own"
  on public.trainerscheine for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainerscheine_delete_own" on public.trainerscheine;
create policy "trainerscheine_delete_own"
  on public.trainerscheine for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) trainerschein_fortbildungen — Fortbildungs-Historie je Trainerschein
-- ============================================================================

create table if not exists public.trainerschein_fortbildungen (
  id                 uuid primary key default gen_random_uuid(),
  trainerschein_id   uuid not null references public.trainerscheine(id) on delete cascade,
  datum              date not null default current_date,
  spezifikation      text,
  created_at         timestamptz not null default now(),

  constraint trainerschein_fortbildungen_spez_len check (spezifikation is null or char_length(spezifikation) <= 500)
);

comment on table public.trainerschein_fortbildungen is 'Historie der absolvierten Fortbildungen zu einem Trainerschein — jeder neue Eintrag startet den Fristenzyklus neu';

create index if not exists trainerschein_fortbildungen_schein_idx on public.trainerschein_fortbildungen (trainerschein_id, datum desc);

alter table public.trainerschein_fortbildungen enable row level security;

drop policy if exists "trainerschein_fortbildungen_select_own" on public.trainerschein_fortbildungen;
create policy "trainerschein_fortbildungen_select_own"
  on public.trainerschein_fortbildungen for select
  to authenticated
  using (exists (select 1 from public.trainerscheine t where t.id = trainerschein_id and t.user_id = auth.uid()));

drop policy if exists "trainerschein_fortbildungen_insert_own" on public.trainerschein_fortbildungen;
create policy "trainerschein_fortbildungen_insert_own"
  on public.trainerschein_fortbildungen for insert
  to authenticated
  with check (exists (select 1 from public.trainerscheine t where t.id = trainerschein_id and t.user_id = auth.uid()));

drop policy if exists "trainerschein_fortbildungen_delete_own" on public.trainerschein_fortbildungen;
create policy "trainerschein_fortbildungen_delete_own"
  on public.trainerschein_fortbildungen for delete
  to authenticated
  using (exists (select 1 from public.trainerscheine t where t.id = trainerschein_id and t.user_id = auth.uid()));


-- ============================================================================
-- 3) Täglicher Cron-Job: E-Mail-Erinnerungen auslösen
-- ============================================================================
-- Anders als die Benachrichtigungen in manual-triggers.sql (die bei einem
-- konkreten INSERT/UPDATE feuern) braucht eine "X Monate vorher"-Erinnerung
-- einen täglichen Zeit-Trigger statt eines Datenbank-Ereignisses — dafür
-- `pg_cron`. Der Cron-Job ruft (wie die anderen drei Functions) die Edge
-- Function per `net.http_post` auf; welche Erinnerungen tatsächlich fällig
-- sind, rechnet die Function selbst aus (sie liest dafür alle aktiven
-- Trainerscheine mit dem Service-Role-Key, nicht nur die des aufrufenden
-- Kontos — es gibt hier kein einzelnes "NEW"-Row wie bei einem Trigger).
--
-- Voraussetzung: Edge Function `notify-trainerschein-erinnerung` ist bereits
-- deployt (siehe EMAIL-SETUP.md) und `webhook_secret` liegt bereits im Vault
-- (siehe manual-triggers.sql, falls noch nicht geschehen).

create extension if not exists pg_cron;

create or replace function public.fn_trigger_trainerschein_erinnerungen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'webhook_secret' limit 1;
  begin
    perform net.http_post(
      url := 'https://nzmszupobienfwjaqcmw.supabase.co/functions/v1/notify-trainerschein-erinnerung',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_X6iX2mVHFCD6wczKEAPnpA_gaWXFZuA',
        'X-Webhook-Secret', coalesce(v_secret, '')
      ),
      body := '{}'::jsonb
    );
  exception when others then
    raise warning 'fn_trigger_trainerschein_erinnerungen: net.http_post fehlgeschlagen: %', sqlerrm;
  end;
end;
$$;

-- cron.schedule() aktualisiert einen bestehenden Job automatisch, wenn der
-- Jobname (2. Parameter unten) schon existiert — mehrfach ausführbar.
select cron.schedule(
  'trainerschein_erinnerungen_taeglich',
  '0 6 * * *',
  $$select public.fn_trigger_trainerschein_erinnerungen();$$
);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> trainerscheine, trainerschein_fortbildungen: vorhanden,
-- leer, RLS enabled.
-- Database -> Cron Jobs (oder: select * from cron.job;) -> Job
-- "trainerschein_erinnerungen_taeglich" vorhanden, läuft täglich um 6 Uhr UTC.
-- ============================================================================
