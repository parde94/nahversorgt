# Supabase Import Review

## Wie der Seed erzeugt wurde

Der SQL-Seed wird aus [src/data/nahversorgt-data.json](src/data/nahversorgt-data.json) erzeugt und als reproduzierbarer Import in [supabase/seeds/001_existing_farms.sql](supabase/seeds/001_existing_farms.sql) abgelegt. Der Generator arbeitet deterministisch auf Basis stabiler SHA-1-UUIDs und ist deshalb bei erneutem Lauf idempotent.

## Übernommene Daten

- Hofbasisdaten in `public.farms`
- Produkte in `public.products`
- nur zuverlässig strukturierte Öffnungszeiten in `public.opening_hours`
- keine `auth.users`-, `profiles`-, `farm_owners`- oder Admin-Daten

## Bewusst nicht übernommen

- unklare Freitexte wie „nach Vereinbarung“ oder „Selbstbedienung“ wurden nicht als künstliche Uhrzeiten rekonstruiert
- keine späteren Farmer- oder Admin-Änderungen werden überschrieben
- die bestehende JSON-App bleibt bis zur Supabase-Leseintegration unverändert aktiv

## Kennzahlen

- Anzahl Höfe in JSON: 313
- Anzahl erzeugter Hofdatensätze: 313
- Anzahl Produkte: 442
- Anzahl Höfe mit Koordinaten: 173
- Anzahl Höfe ohne Koordinaten: 140
- Anzahl strukturierter Öffnungszeiten: 54
- Anzahl unklarer Öffnungszeiten: 80
- problematische oder übersprungene Datensätze: 0

## Teststrategie

1. Die SQL-Datei im Supabase SQL Editor in einer separaten Sandbox ausführen.
2. Vor dem echten Import eine Sicherung der betroffenen Tabellen anlegen.
3. Danach prüfen, ob nur die erwarteten Hof-, Produkt- und Öffnungsdaten importiert wurden.
4. Wiederholungsversuch ausführen und verifizieren, dass keine Duplikate entstehen.

## Rollback-Vorschlag

- Die Sandbox-Umgebung als isoliertes Testprojekt verwenden.
- Vor dem Import die betroffenen Tabellen sichern.
- Bei Bedarf in der Sandbox die importierten Datensätze gezielt zurücksetzen oder mit einem anderen importierten Seed erneut bereitstellen.

## Problematische Datensätze

- keine erkennbar problematischen Datensätze im automatischen Scan
