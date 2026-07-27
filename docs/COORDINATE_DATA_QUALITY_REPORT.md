# Coordinate Data Quality Report

## Ziel und Rahmen

Dieser Bericht bewertet die Koordinatenqualitaet aller kartierten Hoefe in der aktuellen Datenbasis. Es wurden keine Koordinaten automatisch geaendert.

Gepruefte Quellen:
- src/data/nahversorgt-data.json
- geocoding-report.json
- missing-geocodes.json
- supabase/seeds/001_existing_farms.sql
- src/services/farmService.ts

## Kurzfazit

- Die beiden kritischsten Faelle sind Kirchhof (rh-5) und Forst (abhof-136).
- Beide sind mit hoher Wahrscheinlichkeit falsch verortet (Ort passt nicht zur hinterlegten Lage).
- Brauerei Forst (abhof-107), huamet (abhof-108) und Kraeuterreich Wegleit (abhof-42) sind plausibel.
- Es gibt keine Koordinaten ausserhalb Suedtirol, keine 0/0-Werte und keine offensichtlichen Lat/Lon-Vertauschungen.
- Es gibt aber 15 Duplikat-Koordinatengruppen mit 43 betroffenen Hoefeintraegen und damit klare Hinweise auf unscharfe Geocoding-Treffer.

## Datensatz-Statistik

- Gesamtanzahl Hoefe: 313
- Hoefe mit Koordinaten: 173
- Hoefe ohne Koordinaten: 140
- Eindeutige Koordinatenpaare: 145
- Duplikat-Koordinatengruppen: 15
- Hoefe in Duplikatgruppen: 43
- Geocoding-Erfolge laut Report: 50
- Geocoding-Fehlschlaege laut Report: 140
- Treffer mit sehr generischer Suchvariante: 6
- Treffer mit Ortsangabe/Trefferadress-Mismatch (Heuristik): 23
- Eintraege mit eher grober Ortsangabe (keine Hausnummer, aber Koordinate vorhanden): 85

## Fokuspruefung der 5 benannten Hoefe

Hinweis zur ID-Auslegung:
- Frontend-ID entspricht dem stabilen Feld id.
- Bei Supabase-Daten ist id im Frontend in der Regel legacy_source_id, waehrend databaseId die echte Supabase-UUID ist.
- Im JSON-Fallback ist databaseId identisch mit id.

| Sichtbarer Name | Frontend-ID | Supabase-ID (databaseId) | legacy_source_id | Adresse/Ortstext | Lat/Lon | Koordinatenquelle | Naechste Lokalitaet laut Trefferadresse | Distanz zur erwarteten Ortslage | Plausibilitaet |
|---|---|---|---|---|---|---|---|---:|---|
| Kirchhof | rh-5 | d733934d-240b-6fe5-85ef-2d0c78c806df | rh-5 | Allitz Kirchhof 29 \| 39023 Laas | 46.5520155, 11.0077751 | geocode-farms.ts (Nominatim), Variante: Kirchhof, Suedtirol, Italien | St. Walburg, Ulten | 24.58 km (gegen Laas) | Kritisch (wahrscheinlich falsch) |
| Forst | abhof-136 | 8c2fd013-becb-d625-ac9f-d8754ca4cb0a | abhof-136 | Bozen Zentrum, Bozen, Bozen und Umgebung | 46.6784184, 11.1194732 | geocode-farms.ts (Nominatim), Variante: Forst, Suedtirol, Italien | Forst, Algund | 26.92 km (gegen Bozen Zentrum) | Kritisch (wahrscheinlich falsch) |
| Brauerei Forst | abhof-107 | d705a5b4-b9c3-5af5-b903-10f7c7c945da | abhof-107 | Mitterplars, Algund, Meran und Umgebung | 46.67672, 11.114829 | geocode-farms.ts (Nominatim), Variante: Brauerei Forst, Suedtirol, Italien | Forst, Algund | 0.92 km (gegen Mitterplars/Algund) | Plausibel |
| huamet | abhof-108 | 64b945e0-6fd3-f8e5-bc00-f03151f1c5f2 | abhof-108 | St. Walburg, Ulten, Meran und Umgebung | 46.5436061, 10.9949325 | geocode-farms.ts (Nominatim), Variante: huamet, St. Walburg, Suedtirol, Italien | St. Walburg, Ulten | 0.42 km (gegen St. Walburg) | Plausibel |
| Kraeuterreich Wegleit | abhof-42 | 6d32f888-35f2-e075-82d4-ca243c4c71a3 | abhof-42 | St. Walburg, Ulten, Meran und Umgebung | 46.5427035, 10.9889664 | geocode-farms.ts (Nominatim), Variante: Kraeuterreich Wegleit, St. Walburg, Suedtirol, Italien | St. Walburg, Ulten | 0.80 km (gegen St. Walburg) | Plausibel |

## Ergebnisse der globalen Checks

### 1) Doppelte Koordinaten bei verschiedenen Hoefen

Ergebnis: 15 Gruppen, 43 betroffene Hoefe.

Auffaellige Beispiele:
- 46.616614, 10.700159 (5 Hoefe): abhof-33, abhof-35, abhof-48, abhof-135, abhof-146
- 46.709058, 11.651965 (4 Hoefe): rh-68, rh-73, rh-74, rh-77
- 46.767796, 12.113280 (4 Hoefe): abhof-10, abhof-85, abhof-95, abhof-213
- 46.834692, 12.239088 (4 Hoefe): abhof-24, abhof-66, abhof-162, abhof-199
- 46.361099, 11.399704 (4 Hoefe): abhof-46, abhof-74, abhof-150, abhof-165

Bewertung: Mittel bis hoch. Ein Teil kann real naheliegend sein, die Gruppengroessen und Muster sprechen aber mehrfach fuer zu grobe Geocoding-Treffer.

### 2) Punkte ausserhalb Suedtirol

Ergebnis: 0 Treffer ausserhalb der verwendeten Suedtirol-Bounds.

Bewertung: Unauffaellig.

### 3) Grosse Orts-/Koordinaten-Mismatches

Ergebnis: 23 Faelle mit Mismatch-Heuristik aus locationText gegen geocoding-report Trefferadresse.

Klar kritisch:
- rh-5 Kirchhof: Laas im Quelltext, Trefferadresse in St. Walburg/Ulten.
- abhof-136 Forst: Bozen Zentrum im Quelltext, Trefferadresse in Forst/Algund.

Weitere auffaellige Beispiele:
- rh-68, rh-73, rh-74, rh-77 (alle auf derselben Dolomiten-Adresse in Brixen-Umfeld)
- abhof-103 Bruggerhof
- abhof-198 Lechnerhof - Hofladen
- abhof-223 Schmiede

Bewertung: Hoch fuer die klaren Fehlzuordnungen, sonst Mittel (Heuristik kann False Positives enthalten).

### 4) Risiko einer positionsbasierten ID-Zuordnung

Ergebnis: Kein Hinweis auf positionsbasierte Zuordnung im aktuellen Ladepfad.

Begruendung:
- In Supabase wird eine stabile ID verwendet (legacy_source_id falls vorhanden, sonst Supabase id).
- In JSON-Fallback bleibt die vorhandene id bestehen.

Bewertung: Niedrig.

### 5) Risiko Supabase-ID vs legacy_source_id Verwechslung

Ergebnis: Konzeptionell vorhanden.

Begruendung:
- Frontend-ID und Datenbank-ID sind bewusst unterschiedliche Felder.
- Ohne saubere Trennung in Logs, Debugging und Admin-Workflows besteht Verwechslungsgefahr.

Bewertung: Mittel.

### 6) Verdacht auf Ortszentrum statt Hofpunkt

Ergebnis: 85 von 173 Koordinaten-Eintraegen haben nur grobe Ortsangaben (ohne Hausnummer) und sind damit potentiell weniger praezise.

Bewertung: Mittel.

### 7) Lat/Lon vertauscht

Ergebnis: 0 offensichtliche Vertauschungen.

Bewertung: Unauffaellig.

### 8) Ungueltige 0/0 oder leere numerische Werte

Ergebnis: 0 mit 0/0; fehlende Koordinaten sind als null vorhanden und damit technisch sauber vom gueltigen Wertebereich getrennt.

Bewertung: Unauffaellig.

## Priorisierte Verdachtsfaelle (Top)

Prioritaet A (manuell sofort pruefen):
- rh-5 Kirchhof
- abhof-136 Forst

Prioritaet B (cluster-/fallback-getriebene Verdachtsfaelle):
- rh-68 Forerhof
- rh-73 Hintnerhof
- rh-74 Hochgruberhof
- rh-77 Luech da Pcei

Prioritaet C (weitere Orts-/Adress-Mismatches):
- abhof-103 Bruggerhof
- abhof-145 Aignerhof
- abhof-198 Lechnerhof - Hofladen
- abhof-223 Schmiede

## Korrekturempfehlungen (ohne automatische Aenderung)

1. Kritische Faelle rh-5 und abhof-136 mit Primarquellen gegenpruefen (offizielle Adresse, Webauftritt, Kontakt).
2. Fuer kuenftiges Geocoding nur praezise Queries priorisieren: Name plus Ort plus Postleitzahl; generische Regionsterms als letzter Fallback.
3. Bei Treffern ein Confidence/Source-Feld dauerhaft speichern (z. B. exakt, unscharf, manuell bestaetigt).
4. Duplikatgruppen >= 3 Hoefe als Pflicht-Pruefliste im Importprozess markieren.
5. Im Admin-Workflow beide IDs sichtbar fuehren (Frontend-ID und Supabase-UUID), um Verwechslungen zu vermeiden.

## Erklaerung der ID-Zuweisung

Aktuelles Verhalten im Code:
- Supabase-Pfad: stabile Frontend-ID = legacy_source_id, falls vorhanden; sonst Supabase-UUID. Zusaetzlich wird databaseId = Supabase-UUID geliefert.
- JSON-Fallback-Pfad: id bleibt unveraendert und databaseId wird auf denselben Wert gesetzt.

Auswirkung:
- Es gibt keine positionsabhaengige Zuordnung.
- Fuer Korrektur- und Supportprozesse ist die explizite Nennung beider IDs pro Datensatz wichtig.
