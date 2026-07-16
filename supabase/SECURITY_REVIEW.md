# Supabase Security Review

## Gefundene Probleme

1. Die ursprüngliche Migration hatte eine kritische Syntaxschwäche bei Triggern:
   - `CREATE OR REPLACE TRIGGER` ist in der hier verwendeten Form nicht die passende Syntax für eine wiederholbare Migration.
2. Die kritischen Farm-Felder wurden nicht vollständig durch einen Trigger abgesichert.
   - `slug` und `legacy_source_id` fehlten in der kritischen Feld-Liste.
3. Die Migration war insgesamt nicht ausreichend wiederholbar, weil Trigger und Policies nicht gezielt vorab entfernt wurden.
4. Einige Rechte waren breiter als nötig, obwohl RLS bereits die eigentliche Zugriffskontrolle bildet.
5. In Supabase kann die Data API im SQL Editor oder Projektsetup zunächst als „API Disabled“ erscheinen, wenn der Zugriff auf die betroffenen Tabellen oder Schemas noch nicht durch die passenden GRANTs freigegeben ist. Das ist ein Konfigurations-/Berechtigungsproblem, kein RLS-Problem.

## Vorgenommene Korrekturen

1. Die Migration wurde in eine Transaktion mit `BEGIN` / `COMMIT` eingebettet.
2. Trigger werden vor der Neuanlage mit `drop trigger if exists ...` entfernt, damit die Migration nach einem Teil-Fehler kontrolliert erneut ausgeführt werden kann.
3. Die kritische Feld-Blockade für Farmer wurde erweitert auf:
   - `name`
   - `slug`
   - `address`
   - `postal_code`
   - `city`
   - `latitude`
   - `longitude`
   - `published`
   - `approval_state`
   - `legacy_source_id`
4. Die Rolle `visitor` wurde im Profil-Check ausdrücklich aufgenommen, obwohl Besucher ohne Auth-Login keinen Profil-Eintrag benötigen.
5. Die Rechte auf `authenticated` wurden auf den notwendigen Minimalumfang reduziert.
6. `profiles`-Updates bleiben auf das eigene Profil begrenzt; eine Selbständerung der Rolle wird durch den Trigger blockiert.
7. Admin-Entscheidungen bleiben als separate, geschützte Prozesslogik gedacht; die Migration selbst setzt keine Admin-Rolle automatisch.
8. Zusätzlich wurde eine minimale zweite Migration angelegt, um die Data API gezielt nur für die tatsächlich benötigten Tabellen und Zugriffsmuster freizugeben.

## GRANTs vs. RLS

GRANTs und RLS sind zwei verschiedene Schichten:

- `GRANT` entscheidet, welche SQL-Operationen im allgemeinen für eine Rolle erlaubt sind.
- `RLS` entscheidet im Lauf einer Operation zusätzlich, welche Datensätze eine Rolle wirklich sehen oder verändern darf.

Die zweite Migration aktiviert daher nicht die RLS-Logik neu, sondern stellt nur die notwendigen Data-API-Berechtigungen bereit. Die vorhandenen Policies bleiben unverändert und weiterhin maßgeblich.

## Migration 002: gezielt aktivierte Data-API-Rechte

Die Migration `002_data_api_permissions.sql` aktiviert gezielt:

- `anon`
  - `USAGE` auf `public`
  - `SELECT` auf `farms`, `products`, `opening_hours`, `farm_images`

- `authenticated`
  - `USAGE` auf `public`
  - `SELECT`, `UPDATE` auf `profiles`
  - `SELECT`, `INSERT`, `UPDATE` auf `farms`
  - `SELECT` auf `farm_owners`
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` auf `products`
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` auf `opening_hours`
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` auf `farm_images`
  - `SELECT`, `INSERT` auf `verification_requests`

Wichtig: `authenticated` erhält weder `UPDATE` noch `DELETE` auf `farm_owners` noch auf `verification_requests`. Damit bleiben diese Objekte weiterhin Admin-gesteuert.

## Warum `anon` nur Leserechte erhält

Besucher müssen laut Zielmodell nur veröffentlichte und freigegebene Hofdaten lesen. Sie sollen keine neuen Höfe, Produkte, Öffnungszeiten oder Bilder erstellen oder ändern. Deshalb erhält `anon` in der zweiten Migration nur `SELECT` auf die öffentlichen Read-Tabellen.

## Verbleibende manuelle Tests

Vor dem Ausführen im Supabase SQL Editor sind die folgenden manuellen Prüfungen weiterhin erforderlich:

1. Trigger `trg_handle_new_user` wird nach `auth.users`-Neuanlage korrekt ausgelöst.
2. Ein neues Profil wird mit `role = 'farmer_pending'` angelegt.
3. Ein normaler Nutzer kann `display_name` und `phone` ändern.
4. Ein normaler Nutzer kann `role` oder `id` nicht selbst ändern.
5. Ein `farmer_pending`-Benutzer kann keine veröffentlichten Hofdaten schreiben.
6. Ein `farmer_verified`-Benutzer kann nur auf aktiv zugeordnete Höfe Schreibzugriff haben.
7. Kritische Hoffelder werden über `BEFORE UPDATE`-Trigger nur für Admins freigegeben.
8. `verification_requests` können von normalen Benutzern angelegt und gelesen werden, aber nicht selbst genehmigt oder verwaltet werden.
9. Besucher sehen nur veröffentlichte und freigegebene Höfe.
10. Die zugehörigen Produkte, Öffnungszeiten und Bilder sind nur sichtbar, wenn der Hof freigegeben ist.

## Empfohlene Testreihenfolge

### 1. anon
- Lesen von veröffentlichten Höfen
- Lesen der zugehörigen Produkte, Öffnungszeiten und Bilder
- Versuch, Schreibzugriffe auszuführen

### 2. farmer_pending
- Profil lesen und eigene Daten ändern
- Versuch, Hofdaten zu erstellen oder zu ändern
- Versuch, Produkte, Öffnungszeiten oder Bilder zu bearbeiten

### 3. farmer_verified
- Aktiv zugeordneten Hof lesen
- Produkt-, Öffnungszeiten- und Bild-Updates auf dem eigenen Hof testen
- Verifikation, dass fremde Höfe nicht erreichbar sind
- Verifikation, dass kritische Feldänderungen nicht direkt funktionieren

### 4. admin
- Alle Tabellen lesen
- Admin-Freigaben für `verification_requests` testen
- Kritische Hofänderungen und Owner-Zuordnungen testen
