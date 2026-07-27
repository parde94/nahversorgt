# Farm Image Management Review

## Storage-Aufbau

- Bucket: `farm-images`
- Der Bucket bleibt öffentlich, weil Hofbilder öffentliche Inhalte sind.
- Eine bekannte direkte Objekt-URL ist damit öffentlich abrufbar.
- Direkte öffentliche Bild-URLs sind ohne Anmeldung erreichbar, solange das Objekt existiert.
- Sichtbarer Pfad pro Datei: `<farm_id>/<zufalls-id>.<endung>`
- Zulässige Endungen: `jpg`, `jpeg`, `png`, `webp`
- Maximalgröße: 5 MB pro Datei
- MIME-Typen und Größenlimit werden serverseitig durch den Bucket erzwungen.
- Datei-Namen werden intern zufällig erzeugt, der lokale Originalname wird nicht als Storage-Pfad verwendet

## Verwendete Tabellenfelder

Die vorhandene Tabelle `public.farm_images` wird ohne neue Pflichtspalten genutzt:

- `id` als Primärschlüssel
- `farm_id` zur Zuordnung zum Hof
- `storage_path` für den Storage-Pfad
- `caption` für optionale Bildbeschreibung oder Alt-Text
- `is_primary` für das Hauptbild
- `sort_order` für die Reihenfolge
- `created_at` und `updated_at` für Zeitstempel

Ein zusätzliches Datenbankfeld war nicht notwendig.

## RLS- und Zugriffsmodell

### Lesen

- Öffentliche Besucher dürfen Bilder veröffentlichter und freigegebener Höfe sehen.
- Die App nutzt dafür den öffentlichen Storage-Zugriff und die Lesepolicy auf `public.farm_images`.
- Die Storage-Policies steuern auch das Auflisten und Verwalten für Hofinhaber und Admins.
- Eine bereits bekannte öffentliche URL wird durch RLS nicht privat.

### Schreiben

- Schreiben auf `public.farm_images` und `storage.objects` ist nur für:
  - aktive `farm_owners` mit Rolle `farmer_verified`
  - Admins
- `farm_pending` kann keine Bilder verwalten.
- Fremde Höfe sind durch die Zuordnungsprüfung geschützt.
- Der Zugriff hängt nicht allein vom Dateipfad ab, sondern von der aktiven Hofzuordnung bzw. Adminrolle.

### Storage-Sicherheit

- `anon` und `public` erhalten keine Schreibrechte.
- Kein `service_role`-Key wird im Browser benötigt.
- Die Berechtigung für Storage-Objekte wird über Bucket-spezifische RLS-Policies geprüft.
- Es werden keine globalen Rechte auf `storage.objects` verändert.

## Hauptbildlogik

- Pro Hof ist höchstens ein Hauptbild erlaubt.
- Mehrere normale Bilder sind erlaubt.
- Beim Upload wird das erste Bild eines Hofes automatisch als Hauptbild gesetzt.
- Wenn das Hauptbild gelöscht wird, wird automatisch das erste verbleibende Bild als Hauptbild nachgezogen.
- Die öffentliche Ansicht verwendet das Hauptbild als Cover.

## Löschablauf

- Die App löscht zuerst die Datei über die Supabase Storage API.
- Danach wird der Datensatz aus `public.farm_images` gelöscht.
- Wenn ein Bild nicht mehr öffentlich erreichbar sein soll, muss das Storage-Objekt über die Storage API entfernt werden.
- Beim Upload wird umgekehrt zuerst die Datei hochgeladen und danach die Datenbankzeile angelegt; bei einem Fehler wird die eben hochgeladene Datei sofort wieder entfernt.
- Dadurch entstehen im normalen App-Ablauf keine verwaisten Dateien.

## Pfadprüfung

- Zulässig ist nur exakt `<farm_uuid>/<zufalls_uuid>.<jpg|jpeg|png|webp>`.
- Keine Unterordner.
- Der farm_id-Teil muss mit der aktiven Hofzuordnung übereinstimmen.

## Parallelitätsschutz

- Vor dem Zählen neuer Bilder wird die zugehörige Hofzeile gesperrt.
- Damit bleibt das Limit von 10 Bildern auch bei konkurrierenden Uploads stabil.

## Empfohlene Tests nach dem SQL-Editor-Lauf

- `npm run build`
- Freigegebener Bauer lädt ein eigenes Bild hoch
- Fremder Nutzer kann das Bild nicht ändern
- Admin kann ein Bild entfernen
- Hauptbild wird öffentlich angezeigt
- Mehr als 10 Bilder pro Hof werden abgewiesen
- Ungültige Dateitypen werden abgewiesen
- Zu große Dateien werden abgewiesen
- Löschen entfernt sowohl Storage-Datei als auch Datenbankeintrag
- Besucherbereich funktioniert weiterhin ohne Authentifizierung

## Kontrollierter SQL-Editor-Test

Die Migration `005_farm_image_management.sql` ist für einen kontrollierten manuellen Test im Supabase SQL Editor vorbereitet, wurde aber nicht ausgeführt.
