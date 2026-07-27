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

## Benötigte Umgebungsvariablen

In `.env` müssen je nach Provider gesetzt werden:

- `VITE_ROUTING_API_URL` (Pflicht für Route)
- `VITE_ROUTING_API_KEY` (optional)
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
