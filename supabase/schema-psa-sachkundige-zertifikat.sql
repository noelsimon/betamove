-- BETAMOVE — PSA-Prüftool: Zertifikat-Upload für die Sachkundige-Freischaltung
-- ============================================================================
-- Baut auf schema-psa-sachkundige.sql auf (muss vorher gelaufen sein).
--
-- Statt den Qualifikationsnachweis nur als Text anzugeben, lädt die Person
-- jetzt ihr Zertifikat (PDF/Bild) in einen privaten Storage-Bucket hoch.
-- Nur sie selbst und die Kursleitung (is_betamove_admin) können die Datei
-- lesen — via signierter URL, kein öffentlicher Zugriff.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.psa_sachkundige add column if not exists zertifikat_pfad text;
comment on column public.psa_sachkundige.zertifikat_pfad is 'Pfad im Storage-Bucket psa-zertifikate, Format <user_id>/<dateiname>';

insert into storage.buckets (id, name, public)
values ('psa-zertifikate', 'psa-zertifikate', false)
on conflict (id) do nothing;

drop policy if exists "psa_zertifikate_insert_own" on storage.objects;
create policy "psa_zertifikate_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'psa-zertifikate' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "psa_zertifikate_select_own_or_admin" on storage.objects;
create policy "psa_zertifikate_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'psa-zertifikate'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_betamove_admin())
  );

drop policy if exists "psa_zertifikate_delete_own" on storage.objects;
create policy "psa_zertifikate_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'psa-zertifikate' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Storage -> Bucket "psa-zertifikate" vorhanden, "Public" = aus.
-- Table Editor -> psa_sachkundige -> Spalte zertifikat_pfad vorhanden.
-- ============================================================================
