# BETAMOVE — Backlog (spätere Umsetzung)

Sammelstelle für Feature-Ideen, die besprochen, aber noch nicht beauftragt sind.
Reihenfolge = Reihenfolge der Erwähnung, keine Priorisierung.

---

## Online-Bezahlung bei der Kursanmeldung

**Besprochen am:** 2026-10-20

**Status:** Idee, noch nicht beauftragt.

**Worum es geht:** Aktuell bucht man einen Kurs ohne Zahlung (`anmeldung.html` legt
nur eine Zeile in `kursanmeldungen` an), die Kursleitung bestätigt Teilnahme später
manuell. Künftig soll die Bezahlung direkt beim Buchen online erfolgen.

**Geplanter technischer Weg (Stripe Checkout):**
1. Neue Supabase Edge Function erzeugt beim Absenden der Anmeldung eine
   Stripe-Checkout-Session (Stripe Secret Key bleibt server-seitig, nie im
   Frontend).
2. Zweite Edge Function als Stripe-Webhook: empfängt die Zahlungsbestätigung und
   markiert die Buchung in `kursanmeldungen` als bezahlt.
3. Schema-Erweiterung: neue Spalten auf `kursanmeldungen` (z.B.
   `zahlung_status`, `betrag_eur`, `stripe_session_id`, `bezahlt_am`).
4. `admin-kurse.html` zeigt den Zahlungsstatus pro Buchung an.
5. Offene Entscheidung: Zahlung *vor* Platzreservierung verpflichtend machen,
   oder weiterhin optional/nachträglich?

**Was von Noel/der Kundin vorher gebraucht wird:**
- [ ] Stripe-Business-Konto verifiziert (Gebühren ca. 1,5–2,9 % + Fixbetrag pro
      Transaktion)
- [ ] Entscheidung: Zahlung Pflicht oder optional (siehe Punkt 5 oben)
- [ ] Ggf. rechtliche Prüfung (Rechnungsstellung, Widerrufsrecht bei bezahlten
      Kursen — aktuell regelt `widerruf.html` das nur für unbezahlte Buchungen)

**Geschätzter Aufwand:** ca. 1–2 Tage.
