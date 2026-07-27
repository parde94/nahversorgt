# Coordinate Correction Proposal

## Zweck und Grenzen

Diese Datei ist eine sichere Korrekturvorbereitung auf Basis der bisherigen Analyse in [docs/COORDINATE_DATA_QUALITY_REPORT.md](docs/COORDINATE_DATA_QUALITY_REPORT.md).

Es wurden keine Daten geaendert, keine Migration ausgefuehrt und kein SQL vorbereitet.

Betrachtete Hoefe:
- Kirchhof, Laas
- Forst, Bozen Zentrum

## Methodik

Pro Hof wurden geprueft:
- aktueller Datensatz in [src/data/nahversorgt-data.json](src/data/nahversorgt-data.json)
- Zuordnung in [supabase/seeds/001_existing_farms.sql](supabase/seeds/001_existing_farms.sql)
- Geocoding-Treffer in [geocoding-report.json](geocoding-report.json)
- externe Referenzpunkte ueber Nominatim
- Kontext aus der Quellseite von suedtirol.info (HTML-Snapshot lokal ausgewertet)

## Hof 1: Kirchhof, Laas

### Aktueller Datensatz

- ID: rh-5
- legacy_source_id: rh-5
- Supabase-ID: d733934d-240b-6fe5-85ef-2d0c78c806df
- Adresse: Allitz Kirchhof 29 | 39023 Laas
- Ort: Laas (Region im Datensatz: Vinschgau)
- Latitude: 46.5520155
- Longitude: 11.0077751

### Welcher reale Standort ist gemeint?

Sehr wahrscheinlich der Betrieb Kirchhof in/bei Allitz (Gemeinde Laas, PLZ 39023), nicht St. Walburg/Ulten.

### Unabhaengige Hinweise (mindestens 2)

1. Strukturierter Datensatzhinweis:
   - Adresse enthaelt Allitz und PLZ 39023 Laas.
   - Region ist Vinschgau.

2. Geocoding-Mismatch-Hinweis:
   - Geocoding-Variante war unscharf (Kirchhof, Suedtirol, Italien) und lieferte einen Treffer in St. Walburg/Ulten.
   - Das widerspricht der expliziten Adressangabe im Datensatz.

3. Externer Referenzpunkt:
   - Nominatim liefert fuer Allitz, Laas einen Punkt bei 46.6323659, 10.7201931.
   - Die aktuelle Koordinate liegt davon rund 23.72 km entfernt.

### Vorschlag fuer neue Koordinaten

- Vorschlag Latitude: 46.6323659
- Vorschlag Longitude: 10.7201931
- Typ: konservativer Orts-/Weiler-Referenzpunkt (Allitz), noch kein garantierter Hauspunkt.

### Unsicherheit

Mittel.

Grund:
- Die Volladresse Allitz Kirchhof 29, 39023 Laas lieferte in der direkten Nominatim-Abfrage keinen eindeutigen Hausnummer-Treffer.
- Die Betriebshomepage war im Lauf der Pruefung technisch nicht erreichbar (Timeout), daher kein zweiter externer Hausnummerbeleg aus der Primarwebseite.

### Pruefung: falscher Ortsname statt falscher Koordinaten?

Unwahrscheinlich.

Begruendung:
- Ort und PLZ im Datensatz sind konsistent (Laas, 39023).
- Wahrscheinlicher Fehler ist die Koordinate durch unscharfen Namens-Treffer auf einen anderen Kirchhof in Ulten.

## Hof 2: Forst, Bozen Zentrum

### Aktueller Datensatz

- ID: abhof-136
- legacy_source_id: abhof-136
- Supabase-ID: 8c2fd013-becb-d625-ac9f-d8754ca4cb0a
- Adresse: keine separate Strassenadresse
- Ort: Bozen Zentrum, Bozen, Bozen und Umgebung
- Latitude: 46.6784184
- Longitude: 11.1194732

### Welcher reale Standort ist gemeint?

Der aktuelle Koordinatenpunkt entspricht exakt Schloss Forst in Forst/Algund (nicht Bozen Zentrum).

### Unabhaengige Hinweise (mindestens 2)

1. Geocoding-Hinweis:
   - Geocoding-Variante Forst, Suedtirol, Italien.
   - Trefferadresse: Schloss Forst, Forst, Algund, 39022.

2. Externer Referenzpunkt:
   - Nominatim fuer Schloss Forst, Algund liefert ebenfalls 46.6784184, 11.1194732.
   - Damit stimmt der aktuelle Datensatz punktgenau mit Schloss Forst ueberein.

3. Quellkontext-Hinweis:
   - Auf der ausgewerteten suedtirol.info-Seite ist ein Betrieb Brauerei Forst in Mitterplars/Algund sichtbar.
   - Der Datensatz Forst liegt nur ca. 0.40 km vom Datensatz Brauerei Forst entfernt.

### Vorschlag fuer neue Koordinaten

Fuer eine sichere Vorbereitung sind zwei fachlich moegliche Varianten zu unterscheiden:

- Variante A (wenn Name Forst fachlich korrekt ist):
  - Latitude: 46.6784184
  - Longitude: 11.1194732
  - Ergebnis: keine Koordinatenaenderung notwendig.

- Variante B (wenn Ort Bozen Zentrum fachlich korrekt ist und Name/Zuordnung fehlerhaft ist):
  - Latitude: 46.4976659
  - Longitude: 11.3530714
  - Ergebnis: deutliche Koordinatenverschiebung nach Bozen Zentrum.

Empfehlung fuer den naechsten Schritt vor jeder Datenaenderung:
- Zuerst Datensatzidentitaet klaeren (welcher reale Betrieb ist mit abhof-136 wirklich gemeint), dann erst Koordinaten aendern.

### Unsicherheit

Hoch.

Grund:
- Name und aktuelle Koordinate sprechen fuer Forst/Algund.
- Ortstext spricht fuer Bozen Zentrum.
- Das ist eher ein Identitaets-/Zuordnungskonflikt als ein reiner Koordinatenfehler.

### Pruefung: falscher Ortsname statt falscher Koordinaten?

Sehr wahrscheinlich ja.

Begruendung:
- Die Koordinate ist intern und extern konsistent mit Schloss Forst.
- Der Ortstext Bozen Zentrum ist dazu nicht konsistent.

## Entscheidungsvorlage vor spaeterer manueller Korrektur

1. Kirchhof (rh-5):
   - mit hoher Sicherheit Koordinate korrigieren (Richtung Allitz/Laas).
   - falls verfuegbar, final mit zusaetzlicher Primarquelle (z. B. Homepage/Telefonabgleich) auf Hauspunkt verfeinern.

2. Forst (abhof-136):
   - zuerst inhaltliche Identitaet pruefen, dann entscheiden:
   - entweder Ortstext korrigieren (bei Beibehaltung Forst-Koordinate),
   - oder falls Bozen-Zentrum-Eintrag gemeint ist, Name/Datensatzzuordnung und danach Koordinaten korrigieren.
