# Admin Approval Review

## Atomarer Freigabeablauf

Der Freigabeprozess für einen bestehenden Hof läuft ausschließlich über `public.approve_existing_farm_claim(p_request_id, p_admin_note)`.

Die Funktion sperrt den Antrag mit `FOR UPDATE`, prüft Rolle und Status, legt die Zuordnung in `public.farm_owners` an oder aktualisiert sie, setzt die Profilrolle auf `farmer_verified` und markiert den Antrag anschließend als `approved`.

Adminprofile behalten ihre Rolle: Wenn das Zielprofil bereits `admin` ist, bleibt es bei einer Hof-Freigabe `admin`.

Zusätzlich müssen `profile_id` und `requested_by_profile_id` identisch sein, damit ein Antrag freigegeben werden kann.

Die zugehörige Hofzeile wird während der Freigabe ebenfalls gesperrt, damit parallele Freigaben für denselben Hof geordnet verarbeitet werden.

## Sicherheitsmodell

- Kein `service_role`-Key im Browser.
- RLS bleibt aktiv.
- Nur `authenticated` darf die RPC-Funktionen ausführen.
- Die Funktionen selbst prüfen zusätzlich `private.current_user_is_admin()`.
- Die Funktionen laufen als `SECURITY DEFINER` mit festem `search_path`.
- Unsichere direkte Rollenänderungen aus dem Frontend sind nicht vorgesehen.

## Funktionsrechte

- `public.approve_existing_farm_claim(uuid, text)`
  - EXECUTE nur für `authenticated`
  - PUBLIC und anon haben kein EXECUTE
- `public.reject_verification_request(uuid, text)`
  - EXECUTE nur für `authenticated`
  - PUBLIC und anon haben kein EXECUTE

## Warum kein `service_role`-Key benötigt wird

Die Freigaben werden serverseitig in der Datenbank ausgeführt. Der Browser braucht nur den normalen Supabase Publishable Key. Die Autorisierung erfolgt über Auth-Session, RLS und die RPC-Checks auf Adminrolle.

## Tests nach der Migration

Die Migration ist für einen kontrollierten SQL-Editor-Test vorbereitet. Empfohlene Prüfungen:

1. Einen offenen `claim_existing_farm`-Antrag mit einem Admin freigeben.
2. Prüfen, dass `public.farm_owners` genau einen aktiven Eintrag für Hof und Profil enthält.
3. Prüfen, dass die Profilrolle auf `farmer_verified` gesetzt wurde.
4. Einen `register_farm`-Antrag ablehnen.
5. Prüfen, dass nur `status`, `reviewed_by_profile_id`, `reviewed_at` und `admin_note` geändert wurden.
6. Versuchen, die RPCs als normaler Benutzer aufzurufen und den Fehler zu erwarten.

## Primary-Owner-Prüfung

Ein Hof kann nur einen aktiven Hauptinhaber haben. Weitere Hofinhaber bleiben grundsätzlich möglich, solange sie nicht gleichzeitig `is_primary_owner = true` und `status = 'active'` sind.

Die Migration prüft bestehende Daten vorab. Falls bereits doppelte aktive Hauptinhaber existieren, schlägt die Migration kontrolliert mit `Existing farms have multiple active primary owners` fehl.

Zusätzlich erzwingt ein Partial-Unique-Index die Eindeutigkeit eines aktiven Hauptinhabers pro Hof.

Ein bestehender Hauptinhaber wird bei einer neuen Freigabe niemals automatisch ersetzt, entfernt oder herabgestuft. In diesem Fall bricht die Freigabe mit `Farm already has another active primary owner` ab.
