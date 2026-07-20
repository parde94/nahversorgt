import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import heroImage from "./assets/hero.png";
import farmData from "./data/nahversorgt-data.json";
import FarmerArea from "./components/FarmerArea";
import { loadFarms } from "./services/farmService";
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
  lat?: number | string | null;
  lng?: number | string | null;
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
  openingHoursStatus?: string;
  openingHoursNote?: string;
  openingHoursOverview?: OpeningHoursOverviewEntry[];
  image: string;
  coordinates: GeoCoordinates | null;
};

type View = "start" | "discover" | "favorites" | "profile" | "details";

type OpeningHoursOverviewEntry = {
  day: string;
  hours: string;
};

type OpeningHoursInfo = {
  statusText: string;
  openNow: boolean | null;
  specialNote: string | null;
  weeklyOverview: OpeningHoursOverviewEntry[];
};

type DistanceUnavailableReason =
  | "missing-user-location"
  | "invalid-user-location"
  | "missing-farm-coordinates";

type FarmDistanceInfo = {
  distanceKm: number | null;
  reason: DistanceUnavailableReason | null;
};

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
  const toCoordinateNumber = (value?: number | string | null) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  };

  const latitude = toCoordinateNumber(latitudeValue);
  const longitude = toCoordinateNumber(longitudeValue);

  if (latitude === null || longitude === null) {
    return null;
  }

  const isLatitudeValid = latitude >= -90 && latitude <= 90;
  const isLongitudeValid = longitude >= -180 && longitude <= 180;

  if (isLatitudeValid && isLongitudeValid && !(latitude === 0 && longitude === 0)) {
    return { latitude, longitude };
  }

  return null;
};

const extractFarmCoordinates = (farm: FarmSourceEntry): GeoCoordinates | null => {
  const primaryCoordinates = parseCoordinates(
    farm.latitude ?? farm.lat,
    farm.longitude ?? farm.lng,
  );

  if (primaryCoordinates) {
    return primaryCoordinates;
  }

  if (!farm.coordinates || typeof farm.coordinates !== "object") {
    return null;
  }

  const candidateCoordinates = farm.coordinates as {
    latitude?: number | string | null;
    longitude?: number | string | null;
    lat?: number | string | null;
    lng?: number | string | null;
  };

  return parseCoordinates(
    candidateCoordinates.latitude ?? candidateCoordinates.lat,
    candidateCoordinates.longitude ?? candidateCoordinates.lng,
  );
};

const calculateFarmDistance = (
  farmCoordinates: GeoCoordinates | null,
  currentUserLocation: GeoCoordinates | null,
): FarmDistanceInfo => {
  if (!currentUserLocation) {
    return {
      distanceKm: null,
      reason: "missing-user-location",
    };
  }

  const validatedUserLocation = parseCoordinates(
    currentUserLocation.latitude,
    currentUserLocation.longitude,
  );

  if (!validatedUserLocation) {
    return {
      distanceKm: null,
      reason: "invalid-user-location",
    };
  }

  if (!farmCoordinates) {
    return {
      distanceKm: null,
      reason: "missing-farm-coordinates",
    };
  }

  return {
    distanceKm: haversineDistanceKm(validatedUserLocation, farmCoordinates),
    reason: null,
  };
};

const DAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_ORDER = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const getWeekdayIndex = (label: string): number | null => {
  const normalized = label.trim().toLowerCase();

  switch (normalized) {
    case "mo":
      return 0;
    case "di":
      return 1;
    case "mi":
      return 2;
    case "do":
      return 3;
    case "fr":
      return 4;
    case "sa":
      return 5;
    case "so":
      return 6;
    default:
      return null;
  }
};

const normalizeHoursText = (value?: string | null) => value?.trim() ?? null;

const deduplicateDisplayHours = (hours: string[]) => {
  const unique = new Set<string>();

  hours.forEach((entry) => {
    const normalized = entry.trim();

    if (normalized) {
      unique.add(normalized);
    }
  });

  return Array.from(unique);
};

const parseOpeningHoursInfo = (
  openingHoursText?: string | null,
): OpeningHoursInfo => {
  const normalizedText = normalizeHoursText(openingHoursText);

  if (!normalizedText) {
    return {
      statusText: "Öffnungszeiten nicht hinterlegt",
      openNow: null,
      specialNote: null,
      weeklyOverview: [],
    };
  }

  const lowered = normalizedText.toLowerCase();

  if (
    /nach telefonischer vereinbarung|auf anfrage|auf vorbestellung/.test(lowered)
  ) {
    return {
      statusText: "Nach telefonischer Vereinbarung",
      openNow: null,
      specialNote: "Nach telefonischer Vereinbarung",
      weeklyOverview: [],
    };
  }

  if (/selbstbedienung|24h|24 stunden|automat/.test(lowered)) {
    return {
      statusText: "Jetzt geöffnet",
      openNow: true,
      specialNote: "Selbstbedienung / 24 Stunden",
      weeklyOverview: [],
    };
  }

  const scheduleSource = normalizedText
    .replace(/.*?Hofladen:\s*/i, "")
    .replace(/.*?Ab Hof:\s*/i, "")
    .split(";")[0]
    .trim();

  const structuredDayMatches = Array.from(
    scheduleSource.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/g),
  );

  const timeMatches = Array.from(
    scheduleSource.matchAll(/\d{1,2}(?:[.:]\d{2})?\s*(?:-\s*\d{1,2}(?:[.:]\d{2})?)?\s*Uhr/g),
  );

  if (structuredDayMatches.length === 0 || timeMatches.length === 0) {
    return {
      statusText: "Bitte Öffnungszeiten beim Hof prüfen",
      openNow: null,
      specialNote: null,
      weeklyOverview: [],
    };
  }

  const overview = DAY_ORDER.map((day) => ({
    day,
    hours: "",
  }));

  const currentDate = new Date();
  const currentDayIndex = currentDate.getDay();
  const currentDayLabel = DAY_LABELS[currentDayIndex];

  const dayRanges = new Map<string, string[]>();
  const clauses = scheduleSource
    .split(/(?=\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\b)/)
    .map((part) => part.trim())
    .filter(Boolean);

  clauses.forEach((clause) => {
    const dayTokens = Array.from(clause.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/g));

    if (dayTokens.length === 0) {
      return;
    }

    const primaryDay = dayTokens[0][1];
    const secondaryDay = dayTokens[1]?.[1] ?? primaryDay;
    const rangeStart = getWeekdayIndex(primaryDay);
    const rangeEnd = getWeekdayIndex(secondaryDay);

    if (rangeStart === null || rangeEnd === null) {
      return;
    }

    const daySet =
      rangeStart === rangeEnd
        ? [primaryDay]
        : DAY_ORDER.slice(rangeStart, rangeEnd + 1);

    const hoursFromClause = Array.from(
      clause.matchAll(/\d{1,2}(?:[.:]\d{2})?\s*(?:-\s*\d{1,2}(?:[.:]\d{2})?)?\s*Uhr/g),
      (match) => match[0].trim(),
    );

    const uniqueHours = deduplicateDisplayHours(hoursFromClause);

    if (uniqueHours.length === 0) {
      return;
    }

    daySet.forEach((day) => {
      const existing = dayRanges.get(day) ?? [];

      uniqueHours.forEach((hourEntry) => {
        existing.push(hourEntry);
      });

      dayRanges.set(day, existing);
    });
  });

  overview.forEach((entry) => {
    const hours = deduplicateDisplayHours(dayRanges.get(entry.day) ?? [])
      .join(" · ")
      .trim();

    if (hours) {
      entry.hours = hours;
    }
  });

  const currentDayHours = dayRanges.get(currentDayLabel)?.join(" · ") ?? null;
  const isCurrentlyOpen = currentDayHours
    ? /\d{1,2}(?:[.:]\d{2})?\s*-\s*\d{1,2}(?:[.:]\d{2})?\s*Uhr/.test(currentDayHours)
    : false;

  let statusText = "Geschlossen";

  if (isCurrentlyOpen) {
    statusText = "Jetzt geöffnet";
  } else {
    const nextDayIndex = currentDayIndex === 6 ? 0 : currentDayIndex + 1;
    const nextDayLabel = DAY_LABELS[nextDayIndex];
    const nextDayHours = dayRanges.get(nextDayLabel)?.join(" · ") ?? null;

    if (nextDayHours) {
      statusText = `Öffnet morgen um ${nextDayHours}`;
    } else if (currentDayHours) {
      statusText = `Öffnet heute um ${currentDayHours}`;
    }
  }

  return {
    statusText,
    openNow: isCurrentlyOpen,
    specialNote: null,
    weeklyOverview: overview.filter((entry) => entry.hours),
  };
};

const normalizePhoneNumber = (value?: string | null): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  let normalized = digits;

  if (normalized.startsWith("00")) {
    normalized = normalized.slice(2);
  }

  if (normalized.startsWith("39") && normalized.length >= 11) {
    return `+${normalized}`;
  }

  if (normalized.startsWith("0")) {
    normalized = normalized.slice(1);
  }

  if (normalized.length >= 9 && normalized.length <= 10) {
    return `+39${normalized}`;
  }

  return null;
};

const formatPhoneNumber = (value?: string | null): string | null => {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return null;
  }

  const digits = normalized.replace(/\D/g, "");
  const numberWithoutCountryCode = digits.startsWith("39")
    ? digits.slice(2)
    : digits;

  return `+39 ${numberWithoutCountryCode.replace(/(\d{3})(?=\d)/g, "$1 ")}`;
};

const normalizeWebsiteUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);

    if (!/^(https:|http:)$/.test(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const isPlausibleMobileNumber = (value?: string | null): boolean => {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return false;
  }

  const digits = normalized.replace(/\D/g, "");

  return /^39\d{9}$/.test(digits) || /^3\d{9}$/.test(digits);
};

const getWhatsAppTarget = (farm: Farm): string | null => {
  const whatsappValue = farm.whatsapp ?? farm.phone;
  const normalized = normalizePhoneNumber(whatsappValue);

  if (!normalized || !isPlausibleMobileNumber(normalized)) {
    return null;
  }

  return normalized.replace(/\D/g, "").replace(/^39/, "");
};

const WHATSAPP_MESSAGE =
  "Hallo, ich habe Ihren Hof über NahVersorgt gefunden und interessiere mich für Ihre Produkte.";

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

const fallbackFarmEntries = (farmData as { farms: FarmSourceEntry[] }).farms;

const mapFarmSourceEntriesToFarms = (entries: FarmSourceEntry[]): Farm[] => {
  return entries.map((farm) => {
    const openingHoursInfo = parseOpeningHoursInfo(farm.openingHoursText);

    return {
      id: farm.id,
      name: farm.name,
      location: getFarmLocation(farm),
      distance: null,
      products: farm.products,
      categories: getFarmCategories(farm.productCategories),
      open: openingHoursInfo.openNow === true,
      delivery: farm.delivery,
      deliveryRadius: farm.deliveryRadiusKm ?? undefined,
      whatsapp: farm.whatsapp ?? undefined,
      phone: farm.phone ?? undefined,
      website: farm.website ?? undefined,
      openingHoursText: farm.openingHoursText ?? undefined,
      openingHoursStatus: openingHoursInfo.statusText,
      openingHoursNote: openingHoursInfo.specialNote ?? undefined,
      openingHoursOverview: openingHoursInfo.weeklyOverview,
      image: heroImage,
      coordinates: extractFarmCoordinates(farm),
    };
  });
};

const fallbackFarms = mapFarmSourceEntriesToFarms(fallbackFarmEntries);

function App() {
  const [farms, setFarms] = useState<Farm[]>(fallbackFarms);
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
  const [activeView, setActiveView] = useState<View>("start");
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const hydrateFarms = async () => {
      const loadedFarms = await loadFarms();

      if (!isCancelled) {
        setFarms(mapFarmSourceEntriesToFarms(loadedFarms));
      }
    };

    void hydrateFarms();

    return () => {
      isCancelled = true;
    };
  }, []);

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

  const distanceInfoByFarmId = useMemo(() => {
    return Object.fromEntries(
      farms.map((farm) => [farm.id, calculateFarmDistance(farm.coordinates, userLocation)]),
    ) as Record<string, FarmDistanceInfo>;
  }, [farms, userLocation]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const validFarmCoordinates = farms.filter((farm) => farm.coordinates).length;
    const reasons = Object.values(distanceInfoByFarmId).reduce(
      (accumulator, entry) => {
        if (entry.reason) {
          accumulator[entry.reason] = (accumulator[entry.reason] ?? 0) + 1;
        }

        return accumulator;
      },
      {} as Record<DistanceUnavailableReason, number>,
    );

    console.info("Distanz-Diagnostik", {
      hasUserLocation: Boolean(userLocation),
      farmsTotal: farms.length,
      farmsWithValidCoordinates: validFarmCoordinates,
      unavailableReasons: reasons,
    });
  }, [distanceInfoByFarmId, farms, userLocation]);

  const displayedFarms = useMemo(() => {
    return farms
      .map((farm) => ({
        ...farm,
        distance: distanceInfoByFarmId[farm.id]?.distanceKm ?? null,
      }))
      .sort((a, b) => {
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
  }, [farms, distanceInfoByFarmId]);

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

  const getDistanceLabel = (
    distance: number | null,
    reason: DistanceUnavailableReason | null = null,
  ) => {
    if (distance === null) {
      if (reason === "missing-user-location" || reason === "invalid-user-location") {
        return "Standort erforderlich";
      }

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

        if (import.meta.env.DEV) {
          console.error("Geolocation error", {
            code: error.code,
            message: error.message,
          });
        }
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
    const whatsappTarget = getWhatsAppTarget(farm);

    if (!whatsappTarget) {
      return;
    }

    const message = encodeURIComponent(WHATSAPP_MESSAGE);

    window.open(
      `https://wa.me/${whatsappTarget}?text=${message}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const openRouteToFarm = (farm: Farm) => {
    if (!farm.coordinates) {
      return;
    }

    const latitude = farm.coordinates.latitude;
    const longitude = farm.coordinates.longitude;
    const destination = `${latitude},${longitude}`;
    const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const mapsUrl = isAppleDevice
      ? `https://maps.apple.com/?daddr=${destination}&q=${encodeURIComponent(farm.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    window.open(mapsUrl, "_blank", "noopener,noreferrer");
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
                <strong>Telefon:</strong> {formatPhoneNumber(selectedFarm.phone) ?? "Keine Angabe"}
              </p>
              <p>
                <strong>WhatsApp:</strong>{" "}
                {formatPhoneNumber(selectedFarm.whatsapp) ?? "Keine Angabe"}
              </p>
              <p>
                <strong>Webseite:</strong>{" "}
                {selectedFarm.website ?? "Keine Angabe"}
              </p>
              <p>
                <strong>Öffnungszeiten:</strong>{" "}
                {selectedFarm.openingHoursStatus ?? "Öffnungszeiten nicht hinterlegt"}
              </p>

              {selectedFarm.openingHoursNote && (
                <p>
                  <strong>Hinweis:</strong> {selectedFarm.openingHoursNote}
                </p>
              )}

              {selectedFarm.openingHoursOverview?.length ? (
                <div className="opening-hours-overview">
                  <strong>Wochenübersicht</strong>
                  <div className="opening-hours-grid">
                    {selectedFarm.openingHoursOverview.map((entry) => (
                      <div
                        key={`${selectedFarm.id}-${entry.day}`}
                        className={
                          entry.day === DAY_LABELS[new Date().getDay()]
                            ? "opening-hours-row today"
                            : "opening-hours-row"
                        }
                      >
                        <span>{entry.day}</span>
                        <span>{entry.hours || "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <p>
                <strong>Lieferung:</strong>{" "}
                {selectedFarm.delivery
                  ? `Ja, bis ${selectedFarm.deliveryRadius ?? "unbekannt"} km`
                  : "Nein"}
              </p>
              <p>
                <strong>Entfernung:</strong>{" "}
                {getDistanceLabel(
                  selectedFarm.distance,
                  distanceInfoByFarmId[selectedFarm.id]?.reason ?? null,
                )}
              </p>

              <div className="detail-actions">
                {normalizePhoneNumber(selectedFarm.phone) && (
                  <a
                    className="primary-button action-button"
                    href={`tel:${normalizePhoneNumber(selectedFarm.phone)}`}
                  >
                    Anrufen
                  </a>
                )}

                {getWhatsAppTarget(selectedFarm) && (
                  <button
                    className="primary-button action-button"
                    onClick={() => openWhatsApp(selectedFarm)}
                  >
                    Per WhatsApp kontaktieren
                  </button>
                )}

                {normalizeWebsiteUrl(selectedFarm.website) && (
                  <a
                    className="secondary-button action-button"
                    href={normalizeWebsiteUrl(selectedFarm.website) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Webseite besuchen
                  </a>
                )}

                {selectedFarm.coordinates && (
                  <button
                    className="secondary-button action-button"
                    onClick={() => openRouteToFarm(selectedFarm)}
                  >
                    Route zum Hof
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {activeView === "profile" && (
          <section className="content-section profile-view">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Mein Bereich</span>
                <h2>Dein Hof bei NahVersorgt</h2>
              </div>
            </div>

            <FarmerArea />
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
                          <p>
                            {farm.location} ·{" "}
                            {getDistanceLabel(
                              farm.distance,
                              distanceInfoByFarmId[farm.id]?.reason ?? null,
                            )}
                          </p>
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
                        {normalizePhoneNumber(farm.phone) && (
                          <a
                            className="primary-button action-button"
                            href={`tel:${normalizePhoneNumber(farm.phone)}`}
                          >
                            Anrufen
                          </a>
                        )}
                        {getWhatsAppTarget(farm) && (
                          <button
                            className="primary-button"
                            onClick={() => openWhatsApp(farm)}
                          >
                            Per WhatsApp kontaktieren
                          </button>
                        )}
                        {normalizeWebsiteUrl(farm.website) && (
                          <a
                            className="secondary-button action-button"
                            href={normalizeWebsiteUrl(farm.website) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Webseite besuchen
                          </a>
                        )}
                        {farm.coordinates && (
                          <button
                            className="secondary-button"
                            onClick={() => openRouteToFarm(farm)}
                          >
                            Route zum Hof
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
                          <p>
                            {farm.location} ·{" "}
                            {getDistanceLabel(
                              farm.distance,
                              distanceInfoByFarmId[farm.id]?.reason ?? null,
                            )}
                          </p>
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
                        {normalizePhoneNumber(farm.phone) && (
                          <a
                            className="primary-button action-button"
                            href={`tel:${normalizePhoneNumber(farm.phone)}`}
                          >
                            Anrufen
                          </a>
                        )}
                        {getWhatsAppTarget(farm) && (
                          <button
                            className="primary-button"
                            onClick={() => openWhatsApp(farm)}
                          >
                            Per WhatsApp kontaktieren
                          </button>
                        )}
                        {normalizeWebsiteUrl(farm.website) && (
                          <a
                            className="secondary-button action-button"
                            href={normalizeWebsiteUrl(farm.website) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Webseite besuchen
                          </a>
                        )}
                        {farm.coordinates && (
                          <button
                            className="secondary-button"
                            onClick={() => openRouteToFarm(farm)}
                          >
                            Route zum Hof
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
                                <p>
                                  {getDistanceLabel(
                                    farm.distance,
                                    distanceInfoByFarmId[farm.id]?.reason ?? null,
                                  )}
                                </p>
                                <button
                                  className="primary-button popup-button"
                                  onClick={() => showFarmDetail(farm.id)}
                                >
                                  Hof ansehen
                                </button>
                                <div className="map-popup-actions">
                                  {normalizePhoneNumber(farm.phone) && (
                                    <a
                                      className="primary-button popup-button"
                                      href={`tel:${normalizePhoneNumber(farm.phone)}`}
                                    >
                                      Anrufen
                                    </a>
                                  )}
                                  {getWhatsAppTarget(farm) && (
                                    <button
                                      className="primary-button popup-button"
                                      onClick={() => openWhatsApp(farm)}
                                    >
                                      Per WhatsApp kontaktieren
                                    </button>
                                  )}
                                  {normalizeWebsiteUrl(farm.website) && (
                                    <a
                                      className="secondary-button popup-button"
                                      href={normalizeWebsiteUrl(farm.website) ?? undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Webseite besuchen
                                    </a>
                                  )}
                                  {farm.coordinates && (
                                    <button
                                      className="secondary-button popup-button"
                                      onClick={() => openRouteToFarm(farm)}
                                    >
                                      Route zum Hof
                                    </button>
                                  )}
                                </div>
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
                              <p>
                                {farm.location} ·{" "}
                                {getDistanceLabel(
                                  farm.distance,
                                  distanceInfoByFarmId[farm.id]?.reason ?? null,
                                )}
                              </p>
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
                              {farm.openingHoursStatus ?? "Öffnungszeiten nicht hinterlegt"}
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