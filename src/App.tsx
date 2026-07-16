import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import heroImage from "./assets/hero.png";
import farmData from "./data/nahversorgt-data.json";
import "leaflet/dist/leaflet.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css";
import "./App.css";

type Category = {
  id: string;
  label: string;
  icon: string;
};

type GeoCoordinates = {
  latitude: number;
  longitude: number;
};

type FarmSourceEntry = {
  id: string;
  name: string;
  region?: string;
  locationText?: string;
  address?: string;
  products: string[];
  productCategories: string[];
  delivery: boolean;
  deliveryRadiusKm?: number | null;
  whatsapp?: string | null;
  openingHoursText?: string;
  phone?: string | null;
  website?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  coordinates?: unknown;
};

type Farm = {
  id: string;
  name: string;
  location: string;
  distance: number | null;
  products: string[];
  categories: string[];
  open: boolean;
  delivery: boolean;
  deliveryRadius?: number;
  whatsapp?: string;
  phone?: string;
  website?: string;
  openingHoursText?: string;
  image: string;
  coordinates: GeoCoordinates | null;
};

type View = "start" | "discover" | "favorites" | "profile" | "details";

const SOUTH_TYROL_CENTER: GeoCoordinates = {
  latitude: 46.55,
  longitude: 11.35,
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineDistanceKm = (
  from: GeoCoordinates,
  to: GeoCoordinates,
): number => {
  const earthRadiusKm = 6371;
  const dLatitude = toRadians(to.latitude - from.latitude);
  const dLongitude = toRadians(to.longitude - from.longitude);

  const latitude1 = toRadians(from.latitude);
  const latitude2 = toRadians(to.latitude);

  const a =
    Math.sin(dLatitude / 2) * Math.sin(dLatitude / 2) +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(dLongitude / 2) *
      Math.sin(dLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
};

const parseCoordinates = (
  latitudeValue?: number | string | null,
  longitudeValue?: number | string | null,
): GeoCoordinates | null => {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  return null;
};

const categories: Category[] = [
  { id: "obst", label: "Obst", icon: "🍎" },
  { id: "gemuese", label: "Gemüse", icon: "🥕" },
  { id: "eier", label: "Eier", icon: "🥚" },
  { id: "milch", label: "Milch & Käse", icon: "🧀" },
  { id: "fleisch", label: "Fleisch", icon: "🥩" },
  { id: "honig", label: "Honig", icon: "🍯" },
];

const farmMarkerIcon = L.divIcon({
  className: "farm-map-marker",
  html: '<span class="map-pin map-pin-farm"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const userMarkerIcon = L.divIcon({
  className: "user-map-marker",
  html: '<span class="map-pin map-pin-user"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const getFarmCategories = (productCategories: string[]) => {
  const categorySet = new Set<string>();
  const normalized = productCategories.map((item) => item.toLowerCase());

  if (
    normalized.some((item) =>
      /obst|apfel|birne|marille|quitten|kirsch|frucht|fruchtsaft|sirup|trockenobst/.test(item),
    )
  ) {
    categorySet.add("obst");
  }

  if (
    normalized.some((item) =>
      /gemüse|salat|gurke|zucchini|radicchio|nudeln|brot|getreide|essig/.test(item),
    )
  ) {
    categorySet.add("gemuese");
  }

  if (normalized.some((item) => /ei|eier/.test(item))) {
    categorySet.add("eier");
  }

  if (normalized.some((item) => /milch|käse|kaese|milchprodukte/.test(item))) {
    categorySet.add("milch");
  }

  if (normalized.some((item) => /fleisch|speck|wurst|lamm|rind|ochs|kalb/.test(item))) {
    categorySet.add("fleisch");
  }

  if (normalized.some((item) => /honig/.test(item))) {
    categorySet.add("honig");
  }

  return Array.from(categorySet);
};

const getFarmLocation = (farm: FarmSourceEntry) => {
  const locationCandidates = [farm.address, farm.locationText]
    .map((value) => value?.split("|").map((part) => part.trim()).filter(Boolean))
    .filter((parts): parts is string[] => Boolean(parts?.length));

  for (const parts of locationCandidates) {
    const zipLocation = parts.find((part) => /\d{5}\s+.+/.test(part));

    if (zipLocation) {
      const normalized = zipLocation.replace(/^\d{5}\s*/, "").trim();

      if (normalized) {
        return normalized;
      }
    }

    const fallback = parts.find((part) => part && !/^\d{5}$/.test(part));

    if (fallback) {
      return fallback;
    }
  }

  return farm.region || "Ort nicht angegeben";
};

const farms: Farm[] = (farmData as { farms: FarmSourceEntry[] }).farms.map(
  (farm) => ({
    id: farm.id,
    name: farm.name,
    location: getFarmLocation(farm),
    distance: null,
    products: farm.products,
    categories: getFarmCategories(farm.productCategories),
    open: Boolean(farm.openingHoursText),
    delivery: farm.delivery,
    deliveryRadius: farm.deliveryRadiusKm ?? undefined,
    whatsapp: farm.whatsapp ?? undefined,
    phone: farm.phone ?? undefined,
    website: farm.website ?? undefined,
    openingHoursText: farm.openingHoursText ?? undefined,
    image: heroImage,
    coordinates: parseCoordinates(farm.latitude, farm.longitude),
  }),
);

function App() {
  const [search, setSearch] = useState("");
  const [radius, setRadius] = useState(15);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyDelivery, setOnlyDelivery] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoCoordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "active" | "denied" | "unsupported" | "unavailable"
  >("idle");
  const [distanceByFarmId, setDistanceByFarmId] = useState<
    Record<string, number | null>
  >({});
  const [activeView, setActiveView] = useState<View>("start");
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);

  const getMapZoom = (candidateRadius: number) => {
    if (candidateRadius <= 5) {
      return 13;
    }

    if (candidateRadius <= 10) {
      return 12;
    }

    if (candidateRadius <= 15) {
      return 11;
    }

    if (candidateRadius <= 25) {
      return 10;
    }

    return 9;
  };

  const mapZoom = userLocation ? getMapZoom(radius) : 9;

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }

    const savedLocation = window.localStorage.getItem("nahversorgt-user-location");

    if (savedLocation) {
      try {
        const parsed = JSON.parse(savedLocation) as GeoCoordinates;
        const latitude = Number(parsed.latitude);
        const longitude = Number(parsed.longitude);

        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setUserLocation({ latitude, longitude });
          setLocationStatus("active");
          return;
        }
      } catch {
        window.localStorage.removeItem("nahversorgt-user-location");
      }
    }

    setLocationStatus("idle");
  }, []);

  useEffect(() => {
    const storedFavorites = window.localStorage.getItem("nahversorgt-favorites");

    if (!storedFavorites) {
      return;
    }

    try {
      const parsed = JSON.parse(storedFavorites) as string[];
      setFavorites(parsed);
    } catch {
      window.localStorage.removeItem("nahversorgt-favorites");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nahversorgt-favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!userLocation) {
      return;
    }

    const nextDistances = farms.map((farm) => {
      if (!farm.coordinates) {
        return [farm.id, null] as const;
      }

      return [
        farm.id,
        haversineDistanceKm(userLocation, farm.coordinates),
      ] as const;
    });

    setDistanceByFarmId(
      Object.fromEntries(nextDistances) as Record<string, number | null>,
    );
  }, [userLocation]);

  const displayedFarms = useMemo(() => {
    return farms
      .map((farm) => ({
        ...farm,
        distance: distanceByFarmId[farm.id] ?? null,
      }))
      .sort((a, b) => {
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
  }, [distanceByFarmId]);

  const filteredFarms = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return displayedFarms
      .filter((farm) => {
        if (!userLocation || farm.distance === null) {
          return true;
        }

        return farm.distance <= radius;
      })
      .filter((farm) => {
        if (selectedCategories.length === 0) return true;

        return selectedCategories.some((category) =>
          farm.categories.includes(category),
        );
      })
      .filter((farm) => !onlyOpen || farm.open)
      .filter((farm) => !onlyDelivery || farm.delivery)
      .filter((farm) => {
        if (!searchTerm) return true;

        const searchableText = [farm.name, farm.location, ...farm.products]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(searchTerm);
      });
  }, [displayedFarms, search, radius, selectedCategories, onlyOpen, onlyDelivery, userLocation]);

  const discoveredFarms = useMemo(() => {
    return [...filteredFarms].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredFarms]);

  const favoriteFarms = useMemo(() => {
    return displayedFarms.filter((farm) => favorites.includes(farm.id));
  }, [displayedFarms, favorites]);

  const mapFarms = useMemo(() => {
    return filteredFarms.filter((farm) => {
      const hasLatitude = Number.isFinite(Number(farm.coordinates?.latitude));
      const hasLongitude = Number.isFinite(Number(farm.coordinates?.longitude));

      return hasLatitude && hasLongitude;
    });
  }, [filteredFarms]);

  const mapCenter = userLocation ?? SOUTH_TYROL_CENTER;
  const selectedFarm = displayedFarms.find((farm) => farm.id === selectedFarmId) ?? null;

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const toggleFavorite = (farmId: string) => {
    setFavorites((current) =>
      current.includes(farmId)
        ? current.filter((id) => id !== farmId)
        : [...current, farmId],
    );
  };

  const getDistanceLabel = (distance: number | null) => {
    if (distance === null) {
      return "Entfernung unbekannt";
    }

    return `${distance.toFixed(1).replace(".", ",")} km`;
  };

  const MapViewController = () => {
    const map = useMap();

    useEffect(() => {
      map.setView([mapCenter.latitude, mapCenter.longitude], mapZoom, {
        animate: true,
        duration: 0.6,
      });
    }, [map, mapCenter, mapZoom]);

    return null;
  };

  const requestUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }

    setLocationStatus("loading");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
        };

        window.localStorage.setItem(
          "nahversorgt-user-location",
          JSON.stringify(nextLocation),
        );

        setUserLocation(nextLocation);
        setLocationStatus("active");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationStatus("denied");
        } else {
          setLocationStatus("unavailable");
        }

        console.error("Geolocation error", {
          code: error.code,
          message: error.message,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  const showFarmDetail = (farmId: string) => {
    setSelectedFarmId(farmId);
    setActiveView("details");
  };

  const openWhatsApp = (farm: Farm) => {
    if (!farm.whatsapp) return;

    const message = encodeURIComponent(
      `Hallo, ich möchte gerne beim ${farm.name} Produkte vorbestellen.`,
    );

    window.open(
      `https://wa.me/${farm.whatsapp}?text=${message}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">N</div>

          <div>
            <strong>NahVersorgt</strong>
            <span>Direkt vom Bauern.</span>
          </div>
        </div>

        <button className="notification-button" aria-label="Benachrichtigungen">
          🔔
        </button>
      </header>

      <main>
        {activeView === "details" && selectedFarm && (
          <section className="content-section detail-view">
            <button className="text-button" onClick={() => setActiveView("start")}>
              ← Zurück
            </button>

            <div className="detail-card">
              <h2>{selectedFarm.name}</h2>
              <p>{selectedFarm.location}</p>
              <p>
                <strong>Produkte:</strong> {selectedFarm.products.join(" · ")}
              </p>
              <p>
                <strong>Telefon:</strong> {selectedFarm.phone ?? "Keine Angabe"}
              </p>
              <p>
                <strong>WhatsApp:</strong> {selectedFarm.whatsapp ?? "Keine Angabe"}
              </p>
              <p>
                <strong>Webseite:</strong> {selectedFarm.website ?? "Keine Angabe"}
              </p>
              <p>
                <strong>Öffnungszeiten:</strong>{" "}
                {selectedFarm.openingHoursText ?? "Keine Angabe"}
              </p>
              <p>
                <strong>Lieferung:</strong>{" "}
                {selectedFarm.delivery
                  ? `Ja, bis ${selectedFarm.deliveryRadius ?? "unbekannt"} km`
                  : "Nein"}
              </p>
              <p>
                <strong>Entfernung:</strong> {getDistanceLabel(selectedFarm.distance)}
              </p>
            </div>
          </section>
        )}

        {activeView === "profile" && (
          <section className="content-section profile-view">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Mein Bereich</span>
                <h2>Dein Profil</h2>
              </div>
            </div>

            <div className="profile-list">
              <div className="profile-card">Als Hof registrieren</div>
              <div className="profile-card">Benachrichtigungen</div>
              <div className="profile-card">Meine Einstellungen</div>
            </div>
          </section>
        )}

        {activeView === "favorites" && (
          <section className="content-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Favoriten</span>
                <h2>Gespeicherte Höfe</h2>
              </div>
            </div>

            {favoriteFarms.length === 0 ? (
              <div className="empty-state">Noch keine Favoriten gespeichert.</div>
            ) : (
              <div className="farm-list">
                {favoriteFarms.map((farm) => (
                  <article className="farm-card" key={farm.id} id={`farm-${farm.id}`}>
                    <img src={farm.image} alt={farm.name} />
                    <div className="farm-card-content">
                      <div className="farm-card-header">
                        <div>
                          <h3>{farm.name}</h3>
                          <p>{farm.location} · {getDistanceLabel(farm.distance)}</p>
                        </div>
                        <button
                          className="favorite-button active"
                          onClick={() => toggleFavorite(farm.id)}
                          aria-label="Favorit speichern"
                        >
                          ♥
                        </button>
                      </div>
                      <p className="products">{farm.products.join(" · ")}</p>
                      <div className="farm-actions">
                        <button
                          className="secondary-button"
                          onClick={() => showFarmDetail(farm.id)}
                        >
                          Hof ansehen
                        </button>
                        {farm.whatsapp && (
                          <button
                            className="primary-button"
                            onClick={() => openWhatsApp(farm)}
                          >
                            Per WhatsApp vorbestellen
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeView === "discover" && (
          <section className="content-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Entdecken</span>
                <h2>Alle Höfe</h2>
              </div>
            </div>

            <div className="farm-list">
              {discoveredFarms.map((farm) => {
                const isFavorite = favorites.includes(farm.id);
                return (
                  <article className="farm-card" key={farm.id} id={`farm-${farm.id}`}>
                    <img src={farm.image} alt={farm.name} />
                    <div className="farm-card-content">
                      <div className="farm-card-header">
                        <div>
                          <h3>{farm.name}</h3>
                          <p>{farm.location} · {getDistanceLabel(farm.distance)}</p>
                        </div>
                        <button
                          className={
                            isFavorite
                              ? "favorite-button active"
                              : "favorite-button"
                          }
                          onClick={() => toggleFavorite(farm.id)}
                          aria-label="Favorit speichern"
                        >
                          {isFavorite ? "♥" : "♡"}
                        </button>
                      </div>
                      <p className="products">{farm.products.join(" · ")}</p>
                      <div className="farm-actions">
                        <button
                          className="secondary-button"
                          onClick={() => showFarmDetail(farm.id)}
                        >
                          Hof ansehen
                        </button>
                        {farm.whatsapp && (
                          <button
                            className="primary-button"
                            onClick={() => openWhatsApp(farm)}
                          >
                            Per WhatsApp vorbestellen
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {activeView === "start" && (
          <>
            <section className="hero">
              <span className="eyebrow">Versorgung in deiner Nähe</span>
              <h1>Was gibt es heute direkt vom Hof?</h1>
              <p>
                Finde regionale Produkte, Bauernhöfe und Hofläden in deiner
                Umgebung.
              </p>

              <div className="search-box">
                <span>🔍</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Produkte, Höfe oder Orte suchen"
                />
              </div>

              <div className="primary-controls">
                <label className="control">
                  <span>📍 Umkreis</span>
                  <select
                    value={radius}
                    onChange={(event) => setRadius(Number(event.target.value))}
                  >
                    <option value={5}>5 km</option>
                    <option value={10}>10 km</option>
                    <option value={15}>15 km</option>
                    <option value={25}>25 km</option>
                    <option value={50}>50 km</option>
                  </select>
                </label>

                <button
                  className={onlyOpen ? "filter-button active" : "filter-button"}
                  onClick={() => setOnlyOpen((value) => !value)}
                >
                  🕒 Jetzt geöffnet
                </button>

                <button
                  className={
                    onlyDelivery ? "filter-button active" : "filter-button"
                  }
                  onClick={() => setOnlyDelivery((value) => !value)}
                >
                  🚚 Lieferung
                </button>

                <button className="filter-button" onClick={requestUserLocation}>
                  📍 Standort verwenden
                </button>
              </div>

              <div className="location-status-list">
                {locationStatus === "loading" && (
                  <p className="location-hint">Standort wird ermittelt…</p>
                )}
                {locationStatus === "active" && (
                  <p className="location-hint">Standort aktiv</p>
                )}
                {locationStatus === "denied" && (
                  <p className="location-hint">Standortzugriff verweigert</p>
                )}
                {locationStatus === "unsupported" && (
                  <p className="location-hint">Standort nicht verfügbar</p>
                )}
                {locationStatus === "unavailable" && (
                  <p className="location-hint">Standort nicht verfügbar</p>
                )}
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Produkte auswählen</span>
                  <h2>Wonach suchst du?</h2>
                </div>

                {selectedCategories.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => setSelectedCategories([])}
                  >
                    Auswahl löschen
                  </button>
                )}
              </div>

              <div className="category-list">
                {categories.map((category) => {
                  const selected = selectedCategories.includes(category.id);
                  return (
                    <button
                      key={category.id}
                      className={selected ? "category active" : "category"}
                      onClick={() => toggleCategory(category.id)}
                    >
                      <span>{category.icon}</span>
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">In deiner Nähe</span>
                  <h2>{filteredFarms.length} Höfe gefunden</h2>
                </div>

                <button
                  className="map-button"
                  onClick={() => setShowMap((value) => !value)}
                >
                  {showMap ? "🗺️ Listenansicht" : "🗺️ Karte"}
                </button>
              </div>

              {showMap ? (
                <div className="map-view">
                  <div className="map-shell">
                    <MapContainer
                      key={userLocation ? "user-location" : "south-tyrol"}
                      className="leaflet-map"
                      center={[mapCenter.latitude, mapCenter.longitude]}
                      zoom={mapZoom}
                      scrollWheelZoom={false}
                    >
                      <MapViewController />

                      <TileLayer
                        attribution="&copy; OpenStreetMap contributors"
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />

                      {userLocation && (
                        <Marker
                          position={[userLocation.latitude, userLocation.longitude]}
                          icon={userMarkerIcon}
                        >
                          <Popup>Dein Standort</Popup>
                        </Marker>
                      )}

                      <MarkerClusterGroup
                        chunkedLoading
                        maxClusterRadius={60}
                        iconCreateFunction={(
                          cluster: { getChildCount: () => number },
                        ) =>
                          L.divIcon({
                            className: "cluster-marker",
                            html: `<span>${cluster.getChildCount()}</span>`,
                            iconSize: [40, 40],
                            iconAnchor: [20, 20],
                          })
                        }
                      >
                        {mapFarms.map((farm) => (
                          <Marker
                            key={farm.id}
                            position={[
                              Number(farm.coordinates?.latitude),
                              Number(farm.coordinates?.longitude),
                            ]}
                            icon={farmMarkerIcon}
                          >
                            <Popup>
                              <div className="map-popup">
                                <strong>{farm.name}</strong>
                                <p>{farm.location}</p>
                                <p>{farm.products.join(" · ")}</p>
                                <p>{getDistanceLabel(distanceByFarmId[farm.id] ?? null)}</p>
                                <button
                                  className="primary-button popup-button"
                                  onClick={() => showFarmDetail(farm.id)}
                                >
                                  Hof ansehen
                                </button>
                              </div>
                            </Popup>
                          </Marker>
                        ))}
                      </MarkerClusterGroup>
                    </MapContainer>
                  </div>
                </div>
              ) : (
                <div className="farm-list">
                  {filteredFarms.map((farm) => {
                    const isFavorite = favorites.includes(farm.id);
                    return (
                      <article
                        className="farm-card"
                        key={farm.id}
                        id={`farm-${farm.id}`}
                      >
                        <img src={farm.image} alt={farm.name} />
                        <div className="farm-card-content">
                          <div className="farm-card-header">
                            <div>
                              <h3>{farm.name}</h3>
                              <p>{farm.location} · {getDistanceLabel(farm.distance)}</p>
                            </div>
                            <button
                              className={
                                isFavorite
                                  ? "favorite-button active"
                                  : "favorite-button"
                              }
                              onClick={() => toggleFavorite(farm.id)}
                              aria-label="Favorit speichern"
                            >
                              {isFavorite ? "♥" : "♡"}
                            </button>
                          </div>

                          <p className="products">{farm.products.join(" · ")}</p>

                          <div className="badges">
                            <span
                              className={
                                farm.open ? "badge open" : "badge closed"
                              }
                            >
                              {farm.open ? "Heute geöffnet" : "Heute geschlossen"}
                            </span>

                            {farm.delivery && (
                              <span className="badge delivery">
                                Lieferung bis {farm.deliveryRadius} km
                              </span>
                            )}
                          </div>

                          {!farm.coordinates && (
                            <p className="location-note">
                              Standort noch nicht kartiert
                            </p>
                          )}

                          <div className="farm-actions">
                            <button
                              className="secondary-button"
                              onClick={() => showFarmDetail(farm.id)}
                            >
                              Hof ansehen
                            </button>

                            {farm.whatsapp && (
                              <button
                                className="primary-button"
                                onClick={() => openWhatsApp(farm)}
                              >
                                Per WhatsApp vorbestellen
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <nav className="bottom-navigation">
        <button
          className={activeView === "start" ? "active" : ""}
          onClick={() => setActiveView("start")}
        >
          <span>⌂</span>
          Start
        </button>

        <button
          className={activeView === "discover" ? "active" : ""}
          onClick={() => setActiveView("discover")}
        >
          <span>⌕</span>
          Entdecken
        </button>

        <button
          className={activeView === "favorites" ? "active" : ""}
          onClick={() => setActiveView("favorites")}
        >
          <span>♡</span>
          Favoriten
        </button>

        <button
          className={activeView === "profile" ? "active" : ""}
          onClick={() => setActiveView("profile")}
        >
          <span>♙</span>
          Mein Bereich
        </button>
      </nav>
    </div>
  );
}

export default App;