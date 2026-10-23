-- BETAMOVE — Kletterpartner-Matching: Profile, Swipe/Match, Chat, Anzeigen, Melden, Bewertungen
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql und schema-admin-multi.sql auf
-- (müssen vorher gelaufen sein — nutzt public.is_betamove_admin()).
--
-- Rein freiwillige, Opt-in-Funktion: Kletterpartner*innen finden, Anzeigen
-- schreiben ("Suche Sicherungspartner*in für Samstagmittag") — sportlich,
-- nicht beziehungstechnisch. Niemand erscheint ungefragt bei "Entdecken":
-- erst ein eigener Eintrag in kletterpartner_profile mit aktiv=true macht
-- ein Konto für andere sichtbar.
--
-- WICHTIG (Datenschutz): Anzeigen und die Entdecken-Liste sind für ALLE
-- eingeloggten Konten sichtbar (keine Matching-Pflicht nötig, damit man auf
-- Anzeigen antworten kann — das ist Kern des Features), aber NICHT öffentlich
-- im Netz. Melde-Einträge sieht ausschließlich das BETAMOVE-Team (Admin),
-- Treffen-Bewertungen ausschließlich die Person, die sie abgegeben hat.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) kletterpartner_profile — Opt-in-Profil für "Entdecken"
-- ============================================================================

create table if not exists public.kletterpartner_profile (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  aktiv           boolean not null default true,
  level           text not null,
  disziplinen     text[] not null default '{}',
  verfuegbarkeit  text[] not null default '{}',
  ort_typ         text not null default 'halle',
  bio             text,
  created_at      timestamptz not null default now(),

  constraint kletterpartner_profile_level_val check (level in ('Einsteiger', 'Fortgeschritten', 'Erfahren')),
  constraint kletterpartner_profile_ort_val check (ort_typ in ('halle', 'draussen', 'beides')),
  constraint kletterpartner_profile_bio_len check (bio is null or char_length(bio) <= 500)
);

comment on table public.kletterpartner_profile is 'Opt-in: nur Konten mit aktiv=true erscheinen bei anderen in "Entdecken"';

create index if not exists kletterpartner_profile_aktiv_idx on public.kletterpartner_profile (aktiv);

alter table public.kletterpartner_profile enable row level security;

drop policy if exists "kletterpartner_profile_select" on public.kletterpartner_profile;
create policy "kletterpartner_profile_select"
  on public.kletterpartner_profile for select
  to authenticated
  using (aktiv = true or auth.uid() = user_id);

drop policy if exists "kletterpartner_profile_insert_own" on public.kletterpartner_profile;
create policy "kletterpartner_profile_insert_own"
  on public.kletterpartner_profile for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "kletterpartner_profile_update_own" on public.kletterpartner_profile;
create policy "kletterpartner_profile_update_own"
  on public.kletterpartner_profile for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "kletterpartner_profile_delete_own" on public.kletterpartner_profile;
create policy "kletterpartner_profile_delete_own"
  on public.kletterpartner_profile for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) kletterpartner_anzeigen + kletterpartner_anzeigen_antworten — Anzeigenboard
-- ============================================================================

create table if not exists public.kletterpartner_anzeigen (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  titel          text not null,
  beschreibung   text,
  wann           text,
  disziplinen    text[] not null default '{}',
  ort_typ        text not null default 'halle',
  typ            text not null default 'einzel',
  plaetze        int,
  bild_pfad      text,
  aktiv          boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint kletterpartner_anzeigen_titel_len check (char_length(trim(titel)) between 1 and 160),
  constraint kletterpartner_anzeigen_beschreibung_len check (beschreibung is null or char_length(beschreibung) <= 1000),
  constraint kletterpartner_anzeigen_wann_len check (wann is null or char_length(wann) <= 160),
  constraint kletterpartner_anzeigen_ort_val check (ort_typ in ('halle', 'draussen')),
  constraint kletterpartner_anzeigen_typ_val check (typ in ('einzel', 'gruppe')),
  constraint kletterpartner_anzeigen_plaetze_val check (plaetze is null or plaetze between 1 and 30)
);

comment on column public.kletterpartner_anzeigen.bild_pfad is 'Pfad im Storage-Bucket kletterpartner-bilder, Format <user_id>/<dateiname> — null = kein Bild';

create index if not exists kletterpartner_anzeigen_aktiv_idx on public.kletterpartner_anzeigen (aktiv, created_at desc);

alter table public.kletterpartner_anzeigen enable row level security;

drop policy if exists "kletterpartner_anzeigen_select" on public.kletterpartner_anzeigen;
create policy "kletterpartner_anzeigen_select"
  on public.kletterpartner_anzeigen for select
  to authenticated
  using (aktiv = true or auth.uid() = user_id);

drop policy if exists "kletterpartner_anzeigen_insert_own" on public.kletterpartner_anzeigen;
create policy "kletterpartner_anzeigen_insert_own"
  on public.kletterpartner_anzeigen for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "kletterpartner_anzeigen_update_own" on public.kletterpartner_anzeigen;
create policy "kletterpartner_anzeigen_update_own"
  on public.kletterpartner_anzeigen for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "kletterpartner_anzeigen_delete_own" on public.kletterpartner_anzeigen;
create policy "kletterpartner_anzeigen_delete_own"
  on public.kletterpartner_anzeigen for delete
  to authenticated
  using (auth.uid() = user_id);


create table if not exists public.kletterpartner_anzeigen_antworten (
  id            uuid primary key default gen_random_uuid(),
  anzeige_id    uuid not null references public.kletterpartner_anzeigen(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  text          text not null,
  created_at    timestamptz not null default now(),

  constraint kletterpartner_anzeigen_antworten_text_len check (char_length(trim(text)) between 1 and 1000)
);

comment on table public.kletterpartner_anzeigen_antworten is 'Öffentliche Antworten unter einer Anzeige — sichtbar für alle, die die Anzeige sehen (Unterschied zu "Direkt schreiben", das privat über kletterpartner_nachrichten läuft)';

create index if not exists kletterpartner_anzeigen_antworten_anzeige_idx on public.kletterpartner_anzeigen_antworten (anzeige_id, created_at);

alter table public.kletterpartner_anzeigen_antworten enable row level security;

drop policy if exists "kletterpartner_anzeigen_antworten_select" on public.kletterpartner_anzeigen_antworten;
create policy "kletterpartner_anzeigen_antworten_select"
  on public.kletterpartner_anzeigen_antworten for select
  to authenticated
  using (true);

drop policy if exists "kletterpartner_anzeigen_antworten_insert_own" on public.kletterpartner_anzeigen_antworten;
create policy "kletterpartner_anzeigen_antworten_insert_own"
  on public.kletterpartner_anzeigen_antworten for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "kletterpartner_anzeigen_antworten_delete_own" on public.kletterpartner_anzeigen_antworten;
create policy "kletterpartner_anzeigen_antworten_delete_own"
  on public.kletterpartner_anzeigen_antworten for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 3) kletterpartner_likes + kletterpartner_matches — Swipe/Match wie beim Vorbild
-- ============================================================================
-- "pass" wird mitgespeichert, damit dieselbe Person nicht erneut im Stapel
-- auftaucht — löst aber nie ein Match aus, nur zwei "like"-Einträge in beide
-- Richtungen tun das (Trigger unten).

create table if not exists public.kletterpartner_likes (
  id          uuid primary key default gen_random_uuid(),
  liker_id    uuid not null references auth.users(id) on delete cascade,
  liked_id    uuid not null references auth.users(id) on delete cascade,
  richtung    text not null default 'like',
  created_at  timestamptz not null default now(),

  constraint kletterpartner_likes_unique unique (liker_id, liked_id),
  constraint kletterpartner_likes_not_self check (liker_id <> liked_id),
  constraint kletterpartner_likes_richtung_val check (richtung in ('like', 'pass'))
);

create index if not exists kletterpartner_likes_liker_idx on public.kletterpartner_likes (liker_id);

alter table public.kletterpartner_likes enable row level security;

drop policy if exists "kletterpartner_likes_select_own" on public.kletterpartner_likes;
create policy "kletterpartner_likes_select_own"
  on public.kletterpartner_likes for select
  to authenticated
  using (auth.uid() = liker_id);

drop policy if exists "kletterpartner_likes_insert_own" on public.kletterpartner_likes;
create policy "kletterpartner_likes_insert_own"
  on public.kletterpartner_likes for insert
  to authenticated
  with check (auth.uid() = liker_id);


create table if not exists public.kletterpartner_matches (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references auth.users(id) on delete cascade,
  user_b      uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint kletterpartner_matches_order check (user_a < user_b),
  constraint kletterpartner_matches_unique unique (user_a, user_b)
);

comment on table public.kletterpartner_matches is 'Wird ausschließlich vom Trigger fn_kletterpartner_match_pruefen() befüllt, nie direkt vom Client — deshalb keine Insert-Policy nötig';

alter table public.kletterpartner_matches enable row level security;

drop policy if exists "kletterpartner_matches_select_own" on public.kletterpartner_matches;
create policy "kletterpartner_matches_select_own"
  on public.kletterpartner_matches for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);


create or replace function public.fn_kletterpartner_match_pruefen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reverse boolean;
  v_a uuid;
  v_b uuid;
begin
  if NEW.richtung <> 'like' then
    return NEW;
  end if;
  select exists(
    select 1 from public.kletterpartner_likes
    where liker_id = NEW.liked_id and liked_id = NEW.liker_id and richtung = 'like'
  ) into v_reverse;
  if v_reverse then
    v_a := least(NEW.liker_id, NEW.liked_id);
    v_b := greatest(NEW.liker_id, NEW.liked_id);
    insert into public.kletterpartner_matches (user_a, user_b)
    values (v_a, v_b)
    on conflict (user_a, user_b) do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_kletterpartner_match_pruefen on public.kletterpartner_likes;
create trigger trg_kletterpartner_match_pruefen
  after insert on public.kletterpartner_likes
  for each row execute function public.fn_kletterpartner_match_pruefen();


-- ============================================================================
-- 4) kletterpartner_unterhaltungen + kletterpartner_nachrichten — Chat
-- ============================================================================
-- Eine Unterhaltung kann aus einem Match ODER aus "Direkt schreiben" unter
-- einer Anzeige entstehen (anzeige_id gesetzt, kein Match nötig — das ist
-- bewusst so: auf eine Anzeige soll man antworten können, ohne vorher
-- matchen zu müssen). Pro Personenpaar gibt es nur eine Unterhaltung,
-- unabhängig vom Entstehungsweg.

create table if not exists public.kletterpartner_unterhaltungen (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references auth.users(id) on delete cascade,
  user_b      uuid not null references auth.users(id) on delete cascade,
  match_id    uuid references public.kletterpartner_matches(id) on delete set null,
  anzeige_id  uuid references public.kletterpartner_anzeigen(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint kletterpartner_unterhaltungen_order check (user_a < user_b),
  constraint kletterpartner_unterhaltungen_unique unique (user_a, user_b)
);

comment on table public.kletterpartner_unterhaltungen is 'Wird nur über die RPC kletterpartner_unterhaltung_oeffnen() angelegt, nie direkt vom Client';

alter table public.kletterpartner_unterhaltungen enable row level security;

drop policy if exists "kletterpartner_unterhaltungen_select_own" on public.kletterpartner_unterhaltungen;
create policy "kletterpartner_unterhaltungen_select_own"
  on public.kletterpartner_unterhaltungen for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);


create table if not exists public.kletterpartner_nachrichten (
  id                uuid primary key default gen_random_uuid(),
  unterhaltung_id   uuid not null references public.kletterpartner_unterhaltungen(id) on delete cascade,
  sender_id         uuid not null references auth.users(id) on delete cascade,
  text              text not null,
  gelesen           boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint kletterpartner_nachrichten_text_len check (char_length(trim(text)) between 1 and 2000)
);

create index if not exists kletterpartner_nachrichten_unterhaltung_idx on public.kletterpartner_nachrichten (unterhaltung_id, created_at);

alter table public.kletterpartner_nachrichten enable row level security;

drop policy if exists "kletterpartner_nachrichten_select_own" on public.kletterpartner_nachrichten;
create policy "kletterpartner_nachrichten_select_own"
  on public.kletterpartner_nachrichten for select
  to authenticated
  using (exists (
    select 1 from public.kletterpartner_unterhaltungen u
    where u.id = unterhaltung_id and (auth.uid() = u.user_a or auth.uid() = u.user_b)
  ));

drop policy if exists "kletterpartner_nachrichten_insert_own" on public.kletterpartner_nachrichten;
create policy "kletterpartner_nachrichten_insert_own"
  on public.kletterpartner_nachrichten for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.kletterpartner_unterhaltungen u
      where u.id = unterhaltung_id and (auth.uid() = u.user_a or auth.uid() = u.user_b)
    )
  );

drop policy if exists "kletterpartner_nachrichten_update_gelesen" on public.kletterpartner_nachrichten;
create policy "kletterpartner_nachrichten_update_gelesen"
  on public.kletterpartner_nachrichten for update
  to authenticated
  using (exists (
    select 1 from public.kletterpartner_unterhaltungen u
    where u.id = unterhaltung_id and (auth.uid() = u.user_a or auth.uid() = u.user_b)
  ))
  with check (exists (
    select 1 from public.kletterpartner_unterhaltungen u
    where u.id = unterhaltung_id and (auth.uid() = u.user_a or auth.uid() = u.user_b)
  ));


create or replace function public.kletterpartner_unterhaltung_oeffnen(p_other_user_id uuid, p_anzeige_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if p_other_user_id = auth.uid() then
    raise exception 'Du kannst nicht mit dir selbst schreiben';
  end if;
  v_a := least(auth.uid(), p_other_user_id);
  v_b := greatest(auth.uid(), p_other_user_id);

  select id into v_id from public.kletterpartner_unterhaltungen where user_a = v_a and user_b = v_b;
  if v_id is null then
    insert into public.kletterpartner_unterhaltungen (user_a, user_b, anzeige_id)
    values (v_a, v_b, p_anzeige_id)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function public.kletterpartner_unterhaltung_oeffnen(uuid, uuid) to authenticated;


-- ============================================================================
-- 4b) profiles — Vorname/Nachname für Kletterpartner-Beteiligte sichtbar machen
-- ============================================================================
-- public.profiles erlaubt sonst nur den eigenen Datensatz (profiles_select_own
-- in schema-konten.sql). Diese Funktion braucht aber Namen anzeigen zu können
-- für: wer eine aktive Anzeige/ein aktives Entdecken-Profil hat, wer unter
-- einer Anzeige geantwortet hat, oder wer mit dir in einer Unterhaltung steht
-- — bewusst eng begrenzt auf genau diese sichtbar Beteiligten, keine
-- generelle Freigabe aller Profile.

drop policy if exists "profiles_select_kletterpartner" on public.profiles;
create policy "profiles_select_kletterpartner"
  on public.profiles for select
  to authenticated
  using (
    exists (select 1 from public.kletterpartner_profile kp where kp.user_id = profiles.id and kp.aktiv = true)
    or exists (select 1 from public.kletterpartner_anzeigen a where a.user_id = profiles.id and a.aktiv = true)
    or exists (select 1 from public.kletterpartner_anzeigen_antworten r where r.user_id = profiles.id)
    or exists (
      select 1 from public.kletterpartner_unterhaltungen u
      where (u.user_a = profiles.id or u.user_b = profiles.id)
        and (u.user_a = auth.uid() or u.user_b = auth.uid())
    )
  );


-- ============================================================================
-- 5) kletterpartner_meldungen — Melden (nur für das BETAMOVE-Team einsehbar)
-- ============================================================================

create table if not exists public.kletterpartner_meldungen (
  id                 uuid primary key default gen_random_uuid(),
  melder_id          uuid not null references auth.users(id) on delete cascade,
  gemeldete_user_id  uuid not null references auth.users(id) on delete cascade,
  grund              text not null,
  kontext_typ        text,
  kontext_id         uuid,
  status             text not null default 'offen',
  created_at         timestamptz not null default now(),

  constraint kletterpartner_meldungen_grund_val check (grund in ('Unangemessenes Verhalten', 'Fake-Profil', 'Belästigung', 'Nicht erschienen', 'Sonstiges')),
  constraint kletterpartner_meldungen_status_val check (status in ('offen', 'geprüft', 'erledigt')),
  constraint kletterpartner_meldungen_kontext_typ_val check (kontext_typ is null or kontext_typ in ('anzeige', 'chat', 'profil')),
  constraint kletterpartner_meldungen_nicht_selbst check (melder_id <> gemeldete_user_id)
);

comment on table public.kletterpartner_meldungen is 'Weder die meldende noch die gemeldete Person kann die eigene Meldung je wieder lesen — nur public.is_betamove_admin()';

alter table public.kletterpartner_meldungen enable row level security;

drop policy if exists "kletterpartner_meldungen_insert_own" on public.kletterpartner_meldungen;
create policy "kletterpartner_meldungen_insert_own"
  on public.kletterpartner_meldungen for insert
  to authenticated
  with check (melder_id = auth.uid());

drop policy if exists "kletterpartner_meldungen_select_admin" on public.kletterpartner_meldungen;
create policy "kletterpartner_meldungen_select_admin"
  on public.kletterpartner_meldungen for select
  to authenticated
  using (public.is_betamove_admin());

drop policy if exists "kletterpartner_meldungen_update_admin" on public.kletterpartner_meldungen;
create policy "kletterpartner_meldungen_update_admin"
  on public.kletterpartner_meldungen for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());


-- ============================================================================
-- 6) kletterpartner_bewertungen — Treffen bewerten (privat, nur für dich selbst)
-- ============================================================================

create table if not exists public.kletterpartner_bewertungen (
  id             uuid primary key default gen_random_uuid(),
  bewerter_id    uuid not null references auth.users(id) on delete cascade,
  bewerteter_id  uuid not null references auth.users(id) on delete cascade,
  match_id       uuid references public.kletterpartner_matches(id) on delete set null,
  merkmale       text[] not null default '{}',
  kommentar      text,
  created_at     timestamptz not null default now(),

  constraint kletterpartner_bewertungen_kommentar_len check (kommentar is null or char_length(kommentar) <= 1000),
  constraint kletterpartner_bewertungen_nicht_selbst check (bewerter_id <> bewerteter_id)
);

comment on table public.kletterpartner_bewertungen is 'Rein privat: nur bewerter_id selbst darf die eigene Bewertung lesen, auch die bewertete Person nicht — keine öffentliche Pranger-Funktion';

alter table public.kletterpartner_bewertungen enable row level security;

drop policy if exists "kletterpartner_bewertungen_insert_own" on public.kletterpartner_bewertungen;
create policy "kletterpartner_bewertungen_insert_own"
  on public.kletterpartner_bewertungen for insert
  to authenticated
  with check (bewerter_id = auth.uid());

drop policy if exists "kletterpartner_bewertungen_select_own" on public.kletterpartner_bewertungen;
create policy "kletterpartner_bewertungen_select_own"
  on public.kletterpartner_bewertungen for select
  to authenticated
  using (bewerter_id = auth.uid());


-- ============================================================================
-- 7) kletterpartner_entdecken_liste() — Kandidat*innen-Liste für "Entdecken"
-- ============================================================================
-- Security-definer-Funktion, damit der "Sicherungsschein verifiziert"-Badge
-- und der "Gemeinsamer Kurs"-Hinweis berechnet werden können, OHNE dass der
-- Client direkt auf fremde lernfortschritt/kursanmeldungen-Zeilen zugreifen
-- könnte (deren RLS erlaubt normalerweise nur den eigenen Datensatz) — hier
-- kommt nur das Ergebnis (Badge ja/nein, ein Kursname) heraus, nie die
-- Rohdaten einer anderen Person.

create or replace function public.kletterpartner_entdecken_liste()
returns table (
  user_id                       uuid,
  vorname                       text,
  nachname                      text,
  level                         text,
  disziplinen                   text[],
  verfuegbarkeit                text[],
  ort_typ                       text,
  bio                           text,
  sicherungsschein_verifiziert  boolean,
  gemeinsamer_kurs              text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    p.user_id,
    pr.vorname,
    pr.nachname,
    p.level,
    p.disziplinen,
    p.verfuegbarkeit,
    p.ort_typ,
    p.bio,
    (
      exists(select 1 from public.lernfortschritt lf where lf.user_id = p.user_id and lf.item_id = 'quiz-sichern' and lf.passed = true)
      and exists(select 1 from public.lernfortschritt lf2 where lf2.user_id = p.user_id and lf2.item_id = 'pruefung-sturztraining' and lf2.passed = true)
      and exists(select 1 from public.kursanmeldungen k where k.user_id = p.user_id and k.kurs_id = 'sturz' and k.teilnahme_bestaetigt = true and coalesce(k.storniert, false) = false)
    ) as sicherungsschein_verifiziert,
    (
      select kv.title
      from public.kursanmeldungen k2
      join public.kurse kv on kv.id = k2.kurs_id
      where k2.user_id = p.user_id and k2.teilnahme_bestaetigt = true and coalesce(k2.storniert, false) = false
        and k2.kurs_id in (
          select k3.kurs_id from public.kursanmeldungen k3
          where k3.user_id = auth.uid() and k3.teilnahme_bestaetigt = true and coalesce(k3.storniert, false) = false
        )
      limit 1
    ) as gemeinsamer_kurs
  from public.kletterpartner_profile p
  join public.profiles pr on pr.id = p.user_id
  where p.aktiv = true
    and p.user_id <> auth.uid()
    and p.user_id not in (select liked_id from public.kletterpartner_likes where liker_id = auth.uid())
  order by p.created_at desc;
end;
$$;

grant execute on function public.kletterpartner_entdecken_liste() to authenticated;


-- ============================================================================
-- 8) Storage-Bucket für Anzeigen-Fotos
-- ============================================================================
-- Anders als psa-zertifikate (rein privat) hier bewusst für ALLE
-- eingeloggten Konten lesbar, nicht nur den/die Eigentümer*in — eine
-- Anzeige inkl. Foto soll ja im ganzen Anzeigenboard sichtbar sein.

insert into storage.buckets (id, name, public)
values ('kletterpartner-bilder', 'kletterpartner-bilder', false)
on conflict (id) do nothing;

drop policy if exists "kletterpartner_bilder_insert_own" on storage.objects;
create policy "kletterpartner_bilder_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'kletterpartner-bilder' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kletterpartner_bilder_select_authenticated" on storage.objects;
create policy "kletterpartner_bilder_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'kletterpartner-bilder');

drop policy if exists "kletterpartner_bilder_delete_own" on storage.objects;
create policy "kletterpartner_bilder_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'kletterpartner-bilder' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> alle acht kletterpartner_*-Tabellen vorhanden, leer, RLS
-- enabled. Storage -> Bucket "kletterpartner-bilder" vorhanden, "Public" aus.
-- ============================================================================
