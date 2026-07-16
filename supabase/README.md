# Supabase Migration Notes

Diese Datei beschreibt die erste sichere Migrationsvorbereitung für die bestehende NahVersorgt-App.

## Was die Migration anlegt

Die Migration in `supabase/migrations/001_initial_schema.sql` legt die folgenden Tabellen an:

- `profiles`
- `farms`
- `farm_owners`
- `products`
- `opening_hours`
- `farm_images`
- `verification_requests`

Zusätzlich werden:

- Rollen- und RLS-Policies eingerichtet
- Trigger für automatische Profil-Erstellung und `updated_at`-Aktualisierung definiert
- Sicherheitsfunktionen mit festem `search_path` angelegt

## Hinweis zum Status

Diese Migration ist noch nicht automatisch gegen Supabase ausgeführt worden. Sie liegt nur als Repository-Datei vor und muss später manuell im Supabase SQL Editor eingefügt bzw. ausgeführt werden.

## So wird sie später eingefügt

1. In das Supabase-Projekt gehen
2. Zum SQL Editor wechseln
3. Die Datei `supabase/migrations/001_initial_schema.sql` öffnen oder den Inhalt kopieren
4. Ausführen
5. Danach die RLS- und Trigger-Resultate prüfen

## Nach der Ausführung notwendige Tests

- Prüfung, dass nach einer neuen Benutzer-Registrierung automatisch ein Profil angelegt wird
- Prüfung, dass `farmer_pending` nach Registrierung die Standardrolle erhält
- Prüfung, dass `farmer_verified` nur seine eigenen Höfe verwalten kann
- Prüfung, dass kritische Felder wie Hofname, Adresse, PLZ, Ort, Koordinaten, `approval_state`, `published` und Eigentümerzuordnung nicht direkt geändert werden können
- Prüfung, dass Besucher nur freigegebene Hoftypen lesen können
- Prüfung, dass Admin alle Tabellen verwalten kann
- Prüfung, dass der Frontend-Client keinen `service_role`-Key verwendet

## Hinweis zur bestehenden App

Die bestehende JSON-App soll während der Migration unverändert weiterlaufen. Die Supabase-Integration wird als separate, sichere Schicht ergänzt, ohne die bestehende Live-Funktionalität zu brechen.
