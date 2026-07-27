import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import heroImage from "./assets/hero.png";
import farmData from "./data/nahversorgt-data.json";
import FarmerArea from "./components/FarmerArea";
import { loadFarms } from "./services/farmService";
import {
  geocodeSingleLocation,
  getGeocodingProviderConfiguration,
  reverseGeocodeLocation,
  searchGeocodingLocations,
  type GeocodingLocation,
} from "./services/geocodingService";
import {
  getDistanceToRouteKm,
  getRouteBetweenPoints,
  getRoutingConfiguration,
  type RoutePoint,
} from "./services/routingService";
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
  image?: string | null;
  selfService?: boolean;
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
  openingState: "open" | "closed" | "unknown";
  image: string;
  selfService: boolean;
  coordinates: GeoCoordinates | null;
};

type DiscoveryMode = "nearby" | "route";

type RouteOpeningFilter = "all" | "open_now" | "self_service";

type RouteField = "start" | "target";

type RouteFarmResult = Farm & {
  distanceToRouteKm: number;
};

type SavedRouteSearch = {
  corridorKm: number;
  selectedCategories: string[];
  openingFilter: RouteOpeningFilter;
  start: GeocodingLocation | null;
  target: GeocodingLocation | null;
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

const routeStartMarkerIcon = L.divIcon({
  className: "route-start-marker",
  html: '<span class="map-pin map-pin-route-start"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const routeEndMarkerIcon = L.divIcon({
  className: "route-end-marker",
  html: '<span class="map-pin map-pin-route-end"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const routeFarmOpenMarkerIcon = L.divIcon({
  className: "route-farm-open-marker",
  html: '<span class="map-pin map-pin-route-open"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const routeFarmClosedMarkerIcon = L.divIcon({
  className: "route-farm-closed-marker",
  html: '<span class="map-pin map-pin-route-closed"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

const routeFarmUnknownMarkerIcon = L.divIcon({
  className: "route-farm-unknown-marker",
  html: '<span class="map-pin map-pin-route-unknown"></span>',
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
    const openingState =
      openingHoursInfo.openNow === true
        ? "open"
        : openingHoursInfo.openNow === false
          ? "closed"
          : "unknown";

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
      openingState,
      image: farm.image ?? heroImage,
      selfService: farm.selfService === true,
      coordinates: extractFarmCoordinates(farm),
    };
  });
};

const fallbackFarms = mapFarmSourceEntriesToFarms(fallbackFarmEntries);

const ROUTE_SEARCH_STORAGE_KEY = "nahversorgt-route-search-v1";
const ROUTE_CORRIDOR_OPTIONS_KM = [5, 10, 15, 20, 30, 40, 50] as const;

const FarmImage = ({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) => {
  const [useFallbackImage, setUseFallbackImage] = useState(false);
  const normalizedSource = src?.trim() ?? "";
  const imageSource = useFallbackImage || !normalizedSource ? heroImage : normalizedSource;

  return (
    <img
      className={className}
      src={imageSource}
      alt={alt}
      onError={() => setUseFallbackImage(true)}
    />
  );
};

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
  const [discoverMode, setDiscoverMode] = useState<DiscoveryMode>("nearby");
  const [routeStartQuery, setRouteStartQuery] = useState("");
  const [routeTargetQuery, setRouteTargetQuery] = useState("");
  const [routeStartLocation, setRouteStartLocation] = useState<GeocodingLocation | null>(null);
  const [routeTargetLocation, setRouteTargetLocation] = useState<GeocodingLocation | null>(null);
  const [routeStartSuggestions, setRouteStartSuggestions] = useState<GeocodingLocation[]>([]);
  const [routeTargetSuggestions, setRouteTargetSuggestions] = useState<GeocodingLocation[]>([]);
  const [routeSuggestionsLoadingField, setRouteSuggestionsLoadingField] =
    useState<RouteField | null>(null);
  const [routeCorridorKm, setRouteCorridorKm] = useState<number>(10);
  const [routeOpeningFilter, setRouteOpeningFilter] = useState<RouteOpeningFilter>("all");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<RoutePoint[]>([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const [routeFarms, setRouteFarms] = useState<RouteFarmResult[]>([]);
  const [routeIgnoredFarmCount, setRouteIgnoredFarmCount] = useState(0);
  const [routeSearchInitialized, setRouteSearchInitialized] = useState(false);
  const [routeSearchPerformed, setRouteSearchPerformed] = useState(false);

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

  useEffect(() => {
    const savedRouteSearchRaw = window.localStorage.getItem(ROUTE_SEARCH_STORAGE_KEY);

    if (!savedRouteSearchRaw) {
      setRouteSearchInitialized(true);
      return;
    }

    try {
      const parsed = JSON.parse(savedRouteSearchRaw) as SavedRouteSearch;

      if (parsed.start) {
        setRouteStartLocation(parsed.start);
        setRouteStartQuery(parsed.start.label);
      }

      if (parsed.target) {
        setRouteTargetLocation(parsed.target);
        setRouteTargetQuery(parsed.target.label);
      }

      if (Number.isFinite(parsed.corridorKm)) {
        setRouteCorridorKm(parsed.corridorKm);
      }

      if (Array.isArray(parsed.selectedCategories)) {
        setSelectedCategories(parsed.selectedCategories);
      }

      if (parsed.openingFilter) {
        setRouteOpeningFilter(parsed.openingFilter);
      }

      setRouteMessage("Letzte Routen-Suche wurde übernommen.");
    } catch {
      window.localStorage.removeItem(ROUTE_SEARCH_STORAGE_KEY);
    } finally {
      setRouteSearchInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (!routeSearchInitialized) {
      return;
    }

    const valueToPersist: SavedRouteSearch = {
      corridorKm: routeCorridorKm,
      selectedCategories,
      openingFilter: routeOpeningFilter,
      start: routeStartLocation,
      target: routeTargetLocation,
    };

    window.localStorage.setItem(ROUTE_SEARCH_STORAGE_KEY, JSON.stringify(valueToPersist));
  }, [
    routeSearchInitialized,
    routeCorridorKm,
    selectedCategories,
    routeOpeningFilter,
    routeStartLocation,
    routeTargetLocation,
  ]);

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

  const routeFarmsFiltered = useMemo(() => {
    const categoryFiltered = routeFarms.filter((farm) => {
      if (selectedCategories.length === 0) {
        return true;
      }

      return selectedCategories.some((category) => farm.categories.includes(category));
    });

    const openingFiltered = categoryFiltered.filter((farm) => {
      if (routeOpeningFilter === "all") {
        return true;
      }

      if (routeOpeningFilter === "open_now") {
        return farm.openingState === "open";
      }

      return farm.selfService || /selbstbedienung/i.test(farm.openingHoursText ?? "");
    });

    return openingFiltered.sort((a, b) => {
      if (a.openingState === "open" && b.openingState !== "open") {
        return -1;
      }

      if (a.openingState !== "open" && b.openingState === "open") {
        return 1;
      }

      return a.distanceToRouteKm - b.distanceToRouteKm;
    });
  }, [routeFarms, routeOpeningFilter, selectedCategories]);

  const mapCenter = userLocation ?? SOUTH_TYROL_CENTER;
  const selectedFarm = displayedFarms.find((farm) => farm.id === selectedFarmId) ?? null;
  const routingConfiguration = getRoutingConfiguration();
  const geocodingProviderConfiguration = getGeocodingProviderConfiguration();

  const refreshPublicFarms = async () => {
    const loadedFarms = await loadFarms();

    setFarms(mapFarmSourceEntriesToFarms(loadedFarms));
  };

  const logServiceError = (scope: string, error: unknown) => {
    if (!import.meta.env.DEV) {
      return;
    }

    if (error && typeof error === "object") {
      const typedError = error as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
        hint?: unknown;
      };

      console.warn(scope, {
        code: typedError.code,
        message: typedError.message,
        details: typedError.details,
        hint: typedError.hint,
      });
      return;
    }

    console.warn(scope, error);
  };

  const routePolylinePositions = useMemo(
    () => routeCoordinates.map((point) => [point.latitude, point.longitude] as [number, number]),
    [routeCoordinates],
  );

  const routeMapCenter = useMemo(() => {
    if (routeCoordinates.length === 0) {
      return mapCenter;
    }

    const middleIndex = Math.floor(routeCoordinates.length / 2);

    return routeCoordinates[middleIndex];
  }, [mapCenter, routeCoordinates]);

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

  const MapViewController = ({
    center,
    zoom,
  }: {
    center: GeoCoordinates;
    zoom: number;
  }) => {
    const map = useMap();

    useEffect(() => {
      map.setView([center.latitude, center.longitude], zoom, {
        animate: true,
        duration: 0.6,
      });
    }, [map, center, zoom]);

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

  const selectRouteLocation = (field: RouteField, location: GeocodingLocation) => {
    setRouteError(null);

    if (field === "start") {
      setRouteStartLocation(location);
      setRouteStartQuery(location.label);
      setRouteStartSuggestions([]);
      return;
    }

    setRouteTargetLocation(location);
    setRouteTargetQuery(location.label);
    setRouteTargetSuggestions([]);
  };

  const swapRouteLocations = () => {
    setRouteStartLocation(routeTargetLocation);
    setRouteTargetLocation(routeStartLocation);
    setRouteStartQuery(routeTargetLocation?.label ?? "");
    setRouteTargetQuery(routeStartLocation?.label ?? "");
    setRouteStartSuggestions([]);
    setRouteTargetSuggestions([]);
  };

  const getRouteQueryByField = (field: RouteField) =>
    field === "start" ? routeStartQuery : routeTargetQuery;

  const setRouteSuggestionsByField = (field: RouteField, suggestions: GeocodingLocation[]) => {
    if (field === "start") {
      setRouteStartSuggestions(suggestions);
      return;
    }

    setRouteTargetSuggestions(suggestions);
  };

  const runRouteLocationSearch = async (field: RouteField) => {
    const query = getRouteQueryByField(field).trim();

    if (query.length < 2) {
      return;
    }

    setRouteError(null);
    setRouteMessage(null);
    setRouteSuggestionsLoadingField(field);

    try {
      const suggestions = await searchGeocodingLocations(query);

      setRouteSuggestionsByField(field, suggestions);

      if (field === "start") {
        setRouteStartLocation(null);
      } else {
        setRouteTargetLocation(null);
      }

      if (suggestions.length === 0) {
        setRouteError("Ort konnte nicht gefunden werden.");
      }
    } catch (error) {
      logServiceError("Ortsuche fehlgeschlagen", error);
      setRouteSuggestionsByField(field, []);
      setRouteError("Die Ortssuche ist gerade nicht erreichbar.");
    } finally {
      setRouteSuggestionsLoadingField(null);
    }
  };

  const useCurrentLocationAsRouteStart = () => {
    if (!navigator.geolocation) {
      setRouteError("Standort ist auf diesem Gerät nicht verfügbar.");
      return;
    }

    setRouteError(null);
    setRouteMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const nextLocation = {
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
        };

        setUserLocation(nextLocation);
        setLocationStatus("active");

        try {
          const reverseLocation = await reverseGeocodeLocation(
            nextLocation.latitude,
            nextLocation.longitude,
          );

          if (reverseLocation) {
            setRouteStartLocation(reverseLocation);
            setRouteStartQuery(reverseLocation.label);
            return;
          }
        } catch (error) {
          logServiceError("Reverse-Geocoding fehlgeschlagen", error);
        }

        const fallbackLocation: GeocodingLocation = {
          id: `current-${nextLocation.latitude}-${nextLocation.longitude}`,
          label: "Aktueller Standort",
          latitude: nextLocation.latitude,
          longitude: nextLocation.longitude,
          address: null,
        };

        setRouteStartLocation(fallbackLocation);
        setRouteStartQuery(fallbackLocation.label);
      },
      () => {
        setRouteError("Standortfreigabe wurde verweigert oder ist gerade nicht verfügbar.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  const resolveRouteLocation = async (
    query: string,
    selectedLocation: GeocodingLocation | null,
  ): Promise<GeocodingLocation | null> => {
    if (selectedLocation && selectedLocation.label === query.trim()) {
      return selectedLocation;
    }

    return geocodeSingleLocation(query);
  };

  const formatRouteOpenStatus = (farm: Farm) => {
    if (farm.openingState === "unknown") {
      return "Öffnungszeiten bitte beim Hof prüfen";
    }

    return farm.openingHoursStatus ?? "Öffnungszeiten bitte beim Hof prüfen";
  };

  const formatRouteDistanceLabel = (distanceToRouteKm: number) => {
    if (distanceToRouteKm < 0.1) {
      return "Direkt an der Route";
    }

    return `${distanceToRouteKm.toFixed(1).replace(".", ",")} km von der Route`;
  };

  const runRouteSearch = async () => {
    setRouteError(null);
    setRouteMessage(null);

    if (!routingConfiguration.isConfigured) {
      setRouteError("Routing ist noch nicht konfiguriert. Bitte VITE_ROUTING_API_URL setzen.");
      return;
    }

    if (!routeStartQuery.trim() || !routeTargetQuery.trim()) {
      setRouteError("Bitte Start und Ziel eingeben.");
      return;
    }

    setRouteLoading(true);
    setRouteSearchPerformed(true);

    try {
      const resolvedStart = await resolveRouteLocation(routeStartQuery, routeStartLocation);
      const resolvedTarget = await resolveRouteLocation(routeTargetQuery, routeTargetLocation);

      if (!resolvedStart || !resolvedTarget) {
        setRouteError("Start oder Ziel konnte nicht gefunden werden.");
        setRouteCoordinates([]);
        setRouteFarms([]);
        return;
      }

      setRouteStartLocation(resolvedStart);
      setRouteTargetLocation(resolvedTarget);
      setRouteStartQuery(resolvedStart.label);
      setRouteTargetQuery(resolvedTarget.label);

      const route = await getRouteBetweenPoints(
        { latitude: resolvedStart.latitude, longitude: resolvedStart.longitude },
        { latitude: resolvedTarget.latitude, longitude: resolvedTarget.longitude },
      );

      const farmsWithCoordinates = farms.filter((farm) => Boolean(farm.coordinates));
      const missingCoordinatesCount = farms.length - farmsWithCoordinates.length;

      const alongRoute = farmsWithCoordinates
        .map((farm) => {
          const point = farm.coordinates as RoutePoint;
          const distanceToRouteKm = getDistanceToRouteKm(point, route.coordinates);

          return {
            ...farm,
            distanceToRouteKm,
          } satisfies RouteFarmResult;
        })
        .filter((farm) => farm.distanceToRouteKm <= routeCorridorKm);

      setRouteCoordinates(route.coordinates);
      setRouteDistanceKm(route.distanceKm);
      setRouteDurationMin(route.durationMin);
      setRouteFarms(alongRoute);
      setRouteIgnoredFarmCount(missingCoordinatesCount);

      if (alongRoute.length === 0) {
        setRouteMessage("Keine Höfe entlang dieser Route gefunden.");
      } else if (missingCoordinatesCount > 0) {
        setRouteMessage("Einige Höfe konnten wegen fehlender Standortdaten nicht berücksichtigt werden.");
      }
    } catch (error) {
      logServiceError("Routing fehlgeschlagen", error);

      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("GEOCODING_SEARCH_FAILED") || message.includes("GEOCODING_REVERSE_FAILED")) {
        setRouteError("Die Ortssuche ist gerade nicht erreichbar.");
      } else if (message.includes("ROUTING_NOT_CONFIGURED")) {
        setRouteError("Routing ist noch nicht konfiguriert. Bitte VITE_ROUTING_API_URL setzen.");
      } else if (message.includes("ROUTING_NO_ROUTE")) {
        setRouteError("Routing konnte gerade nicht geladen werden.");
      } else {
        setRouteError("Routing konnte gerade nicht geladen werden.");
      }

      setRouteCoordinates([]);
      setRouteFarms([]);
    } finally {
      setRouteLoading(false);
    }
  };

  const openNavigationToFarm = (farm: Farm) => {
    if (!farm.coordinates) {
      return;
    }

    const destination = `${farm.coordinates.latitude},${farm.coordinates.longitude}`;
    const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const mapsUrl = isAppleDevice
      ? `https://maps.apple.com/?daddr=${destination}&q=${encodeURIComponent(farm.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    window.open(mapsUrl, "_blank", "noopener,noreferrer");
  };

  const openFarmAsStopover = (farm: Farm) => {
    if (!farm.coordinates) {
      return;
    }

    const destination = `${farm.coordinates.latitude},${farm.coordinates.longitude}`;
    const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const mapsUrl = isAppleDevice
      ? `https://maps.apple.com/?q=${encodeURIComponent(farm.name)}&ll=${destination}`
      : `https://www.google.com/maps/search/?api=1&query=${destination}`;

    window.open(mapsUrl, "_blank", "noopener,noreferrer");
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
              <FarmImage
                className="detail-hero-image"
                src={selectedFarm.image}
                alt={selectedFarm.name}
              />
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

            <FarmerArea onPublicFarmsChanged={refreshPublicFarms} />
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
                    <FarmImage src={farm.image} alt={farm.name} />
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
                <h2>{discoverMode === "nearby" ? "Alle Höfe" : "Auf meinem Weg"}</h2>
              </div>
            </div>

            <div className="discover-mode-toggle" role="tablist" aria-label="Entdecken Modus">
              <button
                className={discoverMode === "nearby" ? "chip active" : "chip"}
                onClick={() => setDiscoverMode("nearby")}
                role="tab"
                aria-selected={discoverMode === "nearby"}
              >
                In meiner Nähe
              </button>
              <button
                className={discoverMode === "route" ? "chip active" : "chip"}
                onClick={() => setDiscoverMode("route")}
                role="tab"
                aria-selected={discoverMode === "route"}
              >
                Auf meinem Weg
              </button>
            </div>

            {discoverMode === "nearby" ? (
              <div className="farm-list">
                {discoveredFarms.map((farm) => {
                  const isFavorite = favorites.includes(farm.id);
                  return (
                    <article className="farm-card" key={farm.id} id={`farm-${farm.id}`}>
                      <FarmImage src={farm.image} alt={farm.name} />
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
            ) : (
              <div className="route-mode-shell">
                <div className="detail-card route-intro-card">
                  <h3>Auf meinem Weg</h3>
                  <p>Entdecke Hofläden entlang deiner Route und plane einen regionalen Zwischenstopp.</p>
                  {geocodingProviderConfiguration.usesPublicNominatim && (
                    <p className="route-attribution">
                      Geocoding ©{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                      >
                        OpenStreetMap-Mitwirkende
                      </a>
                    </p>
                  )}
                </div>

                {!routingConfiguration.isConfigured && (
                  <div className="empty-state">
                    Routing ist noch nicht konfiguriert. Bitte VITE_ROUTING_API_URL setzen.
                  </div>
                )}

                <div className="form-card route-search-card">
                  <div className="auth-grid">
                    <label className="field field-wide route-field">
                      <span>Start</span>
                      <div className="route-field-input-row">
                        <input
                          type="text"
                          value={routeStartQuery}
                          onChange={(event) => {
                            setRouteStartQuery(event.target.value);
                            setRouteStartLocation(null);
                            setRouteStartSuggestions([]);
                          }}
                          placeholder="Startort oder Adresse"
                        />
                        <button
                          type="button"
                          className="secondary-button route-search-trigger"
                          onClick={() => runRouteLocationSearch("start")}
                          disabled={routeStartQuery.trim().length < 2 || routeSuggestionsLoadingField !== null}
                        >
                          {routeSuggestionsLoadingField === "start" ? "Suche läuft …" : "Ort suchen"}
                        </button>
                      </div>

                      {routeStartLocation && (
                        <p className="route-selected-location">Ausgewählt: {routeStartLocation.label}</p>
                      )}

                      {routeStartSuggestions.length > 0 && (
                        <div className="route-suggestion-list">
                          {routeStartSuggestions.map((suggestion) => (
                            <button
                              key={suggestion.id}
                              className="route-suggestion-item"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                selectRouteLocation("start", suggestion);
                              }}
                            >
                              {suggestion.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </label>

                    <label className="field field-wide route-field">
                      <span>Ziel</span>
                      <div className="route-field-input-row">
                        <input
                          type="text"
                          value={routeTargetQuery}
                          onChange={(event) => {
                            setRouteTargetQuery(event.target.value);
                            setRouteTargetLocation(null);
                            setRouteTargetSuggestions([]);
                          }}
                          placeholder="Zielort oder Adresse"
                        />
                        <button
                          type="button"
                          className="secondary-button route-search-trigger"
                          onClick={() => runRouteLocationSearch("target")}
                          disabled={routeTargetQuery.trim().length < 2 || routeSuggestionsLoadingField !== null}
                        >
                          {routeSuggestionsLoadingField === "target" ? "Suche läuft …" : "Ort suchen"}
                        </button>
                      </div>

                      {routeTargetLocation && (
                        <p className="route-selected-location">Ausgewählt: {routeTargetLocation.label}</p>
                      )}

                      {routeTargetSuggestions.length > 0 && (
                        <div className="route-suggestion-list">
                          {routeTargetSuggestions.map((suggestion) => (
                            <button
                              key={suggestion.id}
                              className="route-suggestion-item"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                selectRouteLocation("target", suggestion);
                              }}
                            >
                              {suggestion.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="action-row">
                    <button className="secondary-button" onClick={useCurrentLocationAsRouteStart}>
                      Aktuellen Standort als Start verwenden
                    </button>
                    <button className="secondary-button" onClick={swapRouteLocations}>
                      Start und Ziel vertauschen
                    </button>
                  </div>

                  <div className="subsection">
                    <div className="section-heading compact-heading">
                      <div>
                        <span className="eyebrow">Routenkorridor</span>
                        <h3>{routeCorridorKm} km</h3>
                      </div>
                    </div>

                    <div className="category-list">
                      {ROUTE_CORRIDOR_OPTIONS_KM.map((corridor) => (
                        <button
                          key={corridor}
                          className={routeCorridorKm === corridor ? "category active" : "category"}
                          onClick={() => setRouteCorridorKm(corridor)}
                        >
                          {corridor} km
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="action-row">
                    <button
                      className="primary-button"
                      onClick={runRouteSearch}
                      disabled={routeLoading || routeSuggestionsLoadingField !== null}
                    >
                      {routeLoading ? "Route wird berechnet …" : "Route suchen"}
                    </button>
                  </div>

                  {routeLoading && <p className="route-inline-status">Route wird berechnet …</p>}

                  {routeError && <p className="form-error">{routeError}</p>}
                  {routeMessage && <p className="form-success">{routeMessage}</p>}
                  {routeIgnoredFarmCount > 0 && (
                    <p className="location-note">
                      {routeIgnoredFarmCount} Höfe konnten wegen fehlender Standortdaten nicht berücksichtigt werden.
                    </p>
                  )}
                </div>

                <div className="form-card">
                  <div className="section-heading compact-heading">
                    <div>
                      <span className="eyebrow">Filter</span>
                      <h3>Öffnung und Produkte</h3>
                    </div>
                  </div>

                  <div className="admin-filter-row">
                    <button
                      className={routeOpeningFilter === "all" ? "chip active" : "chip"}
                      onClick={() => setRouteOpeningFilter("all")}
                    >
                      Alle Höfe
                    </button>
                    <button
                      className={routeOpeningFilter === "open_now" ? "chip active" : "chip"}
                      onClick={() => setRouteOpeningFilter("open_now")}
                    >
                      Jetzt geöffnet
                    </button>
                    <button
                      className={routeOpeningFilter === "self_service" ? "chip active" : "chip"}
                      onClick={() => setRouteOpeningFilter("self_service")}
                    >
                      Selbstbedienung
                    </button>
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
                </div>

                {routeCoordinates.length > 1 && (
                  <div className="map-view">
                    <div className="map-shell">
                      <MapContainer
                        className="leaflet-map"
                        center={[routeMapCenter.latitude, routeMapCenter.longitude]}
                        zoom={10}
                        scrollWheelZoom={false}
                      >
                        <MapViewController center={mapCenter} zoom={mapZoom} />
                        <TileLayer
                          attribution="&copy; OpenStreetMap contributors"
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        <Polyline positions={routePolylinePositions} pathOptions={{ color: "#355f35", weight: 5 }} />

                        {routeStartLocation && (
                          <Marker
                            position={[routeStartLocation.latitude, routeStartLocation.longitude]}
                            icon={routeStartMarkerIcon}
                          >
                            <Popup>Start: {routeStartLocation.label}</Popup>
                          </Marker>
                        )}

                        {routeTargetLocation && (
                          <Marker
                            position={[routeTargetLocation.latitude, routeTargetLocation.longitude]}
                            icon={routeEndMarkerIcon}
                          >
                            <Popup>Ziel: {routeTargetLocation.label}</Popup>
                          </Marker>
                        )}

                        {routeFarmsFiltered.map((farm) => (
                          <Marker
                            key={`route-farm-${farm.id}`}
                            position={[farm.coordinates!.latitude, farm.coordinates!.longitude]}
                            icon={
                              farm.openingState === "open"
                                ? routeFarmOpenMarkerIcon
                                : farm.openingState === "closed"
                                  ? routeFarmClosedMarkerIcon
                                  : routeFarmUnknownMarkerIcon
                            }
                          >
                            <Popup>
                              <div className="map-popup">
                                <strong>{farm.name}</strong>
                                <p>{farm.location}</p>
                                <p>{formatRouteOpenStatus(farm)}</p>
                                <p>{formatRouteDistanceLabel(farm.distanceToRouteKm)}</p>
                                <button className="primary-button popup-button" onClick={() => showFarmDetail(farm.id)}>
                                  Hof ansehen
                                </button>
                              </div>
                            </Popup>
                          </Marker>
                        ))}
                      </MapContainer>
                    </div>
                  </div>
                )}

                {routeCoordinates.length > 1 && (
                  <div className="detail-card route-summary-card">
                    <p>
                      {routeFarmsFiltered.length} Höfe entlang deiner Route ·{" "}
                      {routeDistanceKm?.toFixed(1).replace(".", ",") ?? "0,0"} km · ca. {Math.round(routeDurationMin ?? 0)} Min. · Korridor {routeCorridorKm} km
                    </p>
                  </div>
                )}

                {routeSearchPerformed && routeFarmsFiltered.length === 0 ? (
                  <div className="empty-state">Keine Höfe entlang dieser Route gefunden. Prüfe Korridor oder Filter.</div>
                ) : (
                  <div className="farm-list route-result-list">
                    {routeFarmsFiltered.map((farm) => (
                      <article className="farm-card" key={`route-result-${farm.id}`}>
                        <FarmImage src={farm.image} alt={farm.name} />
                        <div className="farm-card-content">
                          <div className="farm-card-header">
                            <div>
                              <h3>{farm.name}</h3>
                              <p>{farm.location}</p>
                            </div>
                          </div>

                          <p className="products">{farm.products.join(" · ")}</p>

                          <div className="badges">
                            <span
                              className={
                                farm.openingState === "open"
                                  ? "badge open"
                                  : farm.openingState === "closed"
                                    ? "badge closed"
                                    : "badge unknown"
                              }
                            >
                              {formatRouteOpenStatus(farm)}
                            </span>
                            <span className="badge delivery">
                              {formatRouteDistanceLabel(farm.distanceToRouteKm)}
                            </span>
                          </div>

                          <div className="farm-actions">
                            <button className="secondary-button" onClick={() => showFarmDetail(farm.id)}>
                              Hof ansehen
                            </button>
                            <button className="primary-button" onClick={() => openNavigationToFarm(farm)}>
                              Navigation starten
                            </button>
                            <button className="secondary-button" onClick={() => openFarmAsStopover(farm)}>
                              Als Zwischenstopp öffnen
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                      <MapViewController center={mapCenter} zoom={mapZoom} />

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
                        <FarmImage src={farm.image} alt={farm.name} />
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