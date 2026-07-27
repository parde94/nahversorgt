# Auf meinem Weg

## Umfang des Bausteins

"Auf meinem Weg" erweitert die Entdecken-Ansicht um einen zweiten Modus neben "In meiner Nähe".

- Start- und Zielort per Geocoding auswählen
- Route berechnen lassen
- Höfe entlang eines konfigurierbaren Korridors (5-50 km) anzeigen
- Ergebnisse nach Öffnungsstatus und Produktkategorien filtern
- Navigation direkt starten oder Hof als Zwischenstopp öffnen

## Architektur und Services

Die Logik ist bewusst aus der UI ausgelagert, damit `App.tsx` steuernd bleibt und Provider später austauschbar sind.

- `src/services/geocodingService.ts`
  - `searchGeocodingLocations(query, limit)` für Vorschläge
  - `geocodeSingleLocation(query)` für eindeutige Suche
  - `reverseGeocodeLocation(lat, lon)` für "aktuellen Standort als Start"
  - Standardmäßig Nominatim, optional mit API-Key
- `src/services/routingService.ts`
  - `getRoutingConfiguration()` prüft, ob Routing konfiguriert ist
  - `getRouteBetweenPoints(start, end)` lädt Routen-Geometrie und Distanz/Zeit
  - `getDistanceToRouteKm(point, route)` berechnet Abstand Hof -> Route
  - `getViaFarmDurationsByFarmId({ start, end, farms })` berechnet Fahrzeiten über den OSRM-Table-Service in zwei gebündelten Anfragen

## Benötigte Umgebungsvariablen

In `.env` müssen je nach Provider gesetzt werden:

- `VITE_ROUTING_API_URL` (Pflicht für Route)
- `VITE_ROUTING_API_KEY` (optional)
- `VITE_ROUTING_TABLE_API_URL` (optional, wird sonst aus `VITE_ROUTING_API_URL` über `/route/v1/` -> `/table/v1/` abgeleitet)
- `VITE_GEOCODING_API_URL` (optional, Standard: Nominatim Search)
- `VITE_GEOCODING_REVERSE_API_URL` (optional, Standard: Nominatim Reverse)
- `VITE_GEOCODING_API_KEY` (optional)

Hinweis: Keine Secrets im Repository speichern.

## Erster OSRM-Entwicklungstest

Für einen begrenzten ersten Entwicklungstest kann ein öffentlicher OSRM-Demoserver verwendet werden:

- `VITE_ROUTING_API_URL=https://router.project-osrm.org/route/v1/driving`
- `VITE_ROUTING_API_KEY=` (leer lassen)

Wichtig:

- Der öffentliche OSRM-Demoserver bietet keine garantierte Verfügbarkeit.
- Er ist nicht als dauerhafte Produktionslösung vorgesehen.
- Für den produktiven Betrieb ist später ein eigener oder professioneller Routingdienst erforderlich.

## Korridorberechnung

Die Routen-Geometrie wird als Liste von Segmenten verarbeitet. Für jeden Hof wird der minimale Abstand zu allen Segmenten bestimmt.

- Projektion über lokale km-Faktoren:
  - Breite: ca. `110.57 km/deg`
  - Länge: ca. `111.32 * cos(Breite) km/deg`
- Danach Punkt-zu-Segment-Abstand mit orthogonaler Projektion
- Der kleinste Segmentabstand ist die Kennzahl `distanceToRouteKm`
- Ein Hof gilt als Treffer, wenn `distanceToRouteKm <= routeCorridorKm`

Das ist eine robuste Näherung für regionale Distanzen und performant für viele Höfe.

## Zusätzliche Umwegzeit je Hof

Zusätzlich zur Luftliniennähe zur Route wird pro Hof die echte zusätzliche Fahrzeit berechnet.

- Koordinatenreihenfolge für OSRM immer `longitude,latitude`
- Reihenfolge je Batch:
  - `0 = Start`
  - `1..N = Höfe`
  - `N+1 = Ziel`
- Anfrage A (gebündelt): `sources=0`, `destinations=1..N` für `Start -> Hof`
- Anfrage B (gebündelt): `sources=1..N`, `destinations=N+1` für `Hof -> Ziel`
- Für beide Anfragen:
  - `annotations=duration`
  - `skip_waypoints=true`

Formel:

- `viaFarmDurationSeconds = startToFarmSeconds + farmToTargetSeconds`
- `detourDurationSeconds = max(0, viaFarmDurationSeconds - baseRouteDurationSeconds)`

`null` oder nicht erreichbare Werte aus der Table-Antwort werden nicht als `0` interpretiert, sondern als `unavailable` angezeigt.

## Schrittweise Berechnung und Priorisierung

- Die Hauptroute und die Hofliste werden zuerst angezeigt.
- Umwegzeiten werden danach asynchron nachgeladen.
- Priorisierung: Höfe mit geringster `distanceToRouteKm` zuerst.
- Batchgröße: maximal `40` Höfe pro Schritt.
- Pro Batch werden genau zwei Table-Anfragen ausgeführt.
- Weitere Höfe werden nicht automatisch vollständig geladen; dafür gibt es die Aktion `Weitere Umwegzeiten berechnen`.

## Cache für Umwegzeiten

- Speicherung lokal im Browser (nicht in Supabase).
- Cache-Dauer: `24 Stunden`.
- Cache-Schlüssel enthält:
  - gerundeten Startpunkt
  - gerundeten Zielpunkt
  - Hof-ID
  - gerundete Hofkoordinaten
  - Routingprofil

Fehlerzustände werden nicht dauerhaft gecacht.

## Verhalten bei Table-Fehlern

- Hauptroute und Hofliste bleiben sichtbar.
- Die Distanz zur Route bleibt sichtbar.
- Kompakter Hinweis bei Ausfall:
  - `Die Umwegzeiten konnten derzeit nicht berechnet werden. Die Höfe entlang der Route werden weiterhin angezeigt.`
- Ein erneuter Versuch ist möglich über:
  - `Umwegzeiten erneut berechnen`

## Umgang mit fehlenden Koordinaten

Höfe ohne `coordinates` können nicht in den Korridorvergleich einbezogen werden.

- Sie werden nicht in den Routen-Ergebnissen gezeigt
- Die UI zeigt einen Hinweis, dass einige Höfe keine genauen Standortdaten haben

## Öffnungslogik im Routenmodus

Der Routenmodus nutzt die bestehende Öffnungslogik aus der App:

- `all`: alle gefundenen Höfe
- `open_now`: nur aktuell geöffnete Höfe
- `self_service`: Höfe mit Selbstbedienungs-Hinweis

Die Anzeige verwendet denselben Status (`open`, `closed`, `unknown`) für Marker und Ergebnisliste.

## Datenschutz und Privatsphäre

- Standortfreigabe ist optional und nur für bessere Startpunkt-Auswahl gedacht
- Keine geheimen API-Schlüssel im Quellcode
- Externe Geocoding/Routing-Aufrufe hängen vom gewählten Anbieter ab; deren Datenschutzbedingungen sind zu beachten
- `VITE_`-Variablen sind im Browser sichtbar und dürfen keine echten geheimen Schlüssel enthalten
- Anbieter mit geheimem API-Schlüssel benötigen später einen Server-/Edge-Function-Proxy

## Nächste sinnvolle Schritte

- Debounce + Caching für Geocoding-Vorschläge ergänzen
- Provider-spezifische Adapter (OSRM, GraphHopper, Mapbox) als austauschbare Strategien einführen
- Optional: Autobahn-Vermeidung / Fahrradprofil als zusätzliche Routing-Optionen
- Optional: Serverseitige Vorberechnung für sehr große Datenmengen
