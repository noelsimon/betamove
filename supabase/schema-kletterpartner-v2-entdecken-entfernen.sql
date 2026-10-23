-- ============================================================================
-- Kletterpartner v2 — "Entdecken" (Swipe/Match) entfernen
-- ============================================================================
-- Die Match-/Swipe-Funktion ("Entdecken") wird komplett entfernt — es gibt
-- nur noch die Anzeigen-Plattform + Chat. Dieses Skript räumt die dafür
-- angelegten Tabellen/Funktionen/Policies auf. Chat und Anzeigen bleiben
-- unverändert nutzbar (eine Unterhaltung konnte schon immer auch ohne
-- Match entstehen, über "Direkt schreiben" unter einer Anzeige).
--
-- Vor dem Ausführen: in Supabase SQL-Editor einfügen und ausführen.
-- ============================================================================

-- 1) Trigger + Funktion, die Matches aus Likes erzeugt hat
drop trigger if exists trg_kletterpartner_match_pruefen on public.kletterpartner_likes;
drop function if exists public.fn_kletterpartner_match_pruefen();

-- 2) RPC für die "Entdecken"-Kandidat*innen-Liste
drop function if exists public.kletterpartner_entdecken_liste();

-- 3) match_id-Spalten lösen, bevor kletterpartner_matches gelöscht wird
alter table public.kletterpartner_unterhaltungen drop column if exists match_id;
alter table public.kletterpartner_bewertungen drop column if exists match_id;

-- 4) Tabellen von Likes/Matches/Opt-in-Profil entfernen
drop table if exists public.kletterpartner_likes;
drop table if exists public.kletterpartner_matches;
drop table if exists public.kletterpartner_profile;

-- 5) profiles-Policy neu fassen: Klausel fürs (jetzt gelöschte)
--    kletterpartner_profile entfernen, Rest unverändert lassen
drop policy if exists "profiles_select_kletterpartner" on public.profiles;
create policy "profiles_select_kletterpartner"
  on public.profiles for select
  to authenticated
  using (
    exists (select 1 from public.kletterpartner_anzeigen a where a.user_id = profiles.id and a.aktiv = true)
    or exists (select 1 from public.kletterpartner_anzeigen_antworten r where r.user_id = profiles.id)
    or exists (
      select 1 from public.kletterpartner_unterhaltungen u
      where (u.user_a = profiles.id or u.user_b = profiles.id)
        and (u.user_a = auth.uid() or u.user_b = auth.uid())
    )
  );
