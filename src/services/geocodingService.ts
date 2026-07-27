export type GeocodingLocation = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  address: string | null;
};

const DEFAULT_GEOCODING_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_GEOCODING_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const PUBLIC_NOMINATIM_HOST = "nominatim.openstreetmap.org";
const GEOCODING_CACHE_STORAGE_KEY = "nahversorgt-geocoding-cache-v1";
const GEOCODING_CACHE_MAX_ENTRIES = 150;
const NOMINATIM_MIN_INTERVAL_MS = 1000;

const geocodingSearchUrl =
  import.meta.env.VITE_GEOCODING_API_URL?.trim() || DEFAULT_GEOCODING_SEARCH_URL;
const geocodingReverseUrl =
  import.meta.env.VITE_GEOCODING_REVERSE_API_URL?.trim() || DEFAULT_GEOCODING_REVERSE_URL;
const geocodingApiKey = import.meta.env.VITE_GEOCODING_API_KEY?.trim() || "";

type CacheEntry<TValue> = {
  value: TValue;
  updatedAt: number;
};

const inMemoryCache = new Map<string, CacheEntry<unknown>>();
let cacheHydrated = false;
let lastNominatimRequestAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

const toGeocodingLocation = (entry: {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
  name?: string;
}) => {
  const latitude = Number(entry.lat);
  const longitude = Number(entry.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const label = entry.display_name?.trim() || entry.name?.trim() || "Unbekannter Ort";

  return {
    id: String(entry.place_id ?? `${latitude},${longitude}`),
    label,
    latitude,
    longitude,
    address: entry.display_name?.trim() || null,
  } satisfies GeocodingLocation;
};

const withOptionalApiKey = (url: URL) => {
  if (geocodingApiKey) {
    url.searchParams.set("api_key", geocodingApiKey);
  }

  return url;
};

const hasWindowStorage = () => typeof window !== "undefined" && Boolean(window.localStorage);

const normalizeQuery = (query: string) => query.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeCoordinate = (value: number) => Number(value.toFixed(6));

const isPublicNominatimUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase() === PUBLIC_NOMINATIM_HOST;
  } catch {
    return false;
  }
};

const isPublicNominatimRequest = (requestUrl: URL) =>
  requestUrl.hostname.toLowerCase() === PUBLIC_NOMINATIM_HOST;

const hydrateCacheFromStorage = () => {
  if (cacheHydrated || !hasWindowStorage()) {
    return;
  }

  cacheHydrated = true;

  try {
    const raw = window.localStorage.getItem(GEOCODING_CACHE_STORAGE_KEY);

    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;

    for (const [key, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry === "object" &&
        "updatedAt" in entry &&
        Number.isFinite(Number(entry.updatedAt))
      ) {
        inMemoryCache.set(key, entry);
      }
    }
  } catch {
    window.localStorage.removeItem(GEOCODING_CACHE_STORAGE_KEY);
  }
};

const persistCache = () => {
  if (!hasWindowStorage()) {
    return;
  }

  try {
    const entries = [...inMemoryCache.entries()].sort(
      (first, second) => second[1].updatedAt - first[1].updatedAt,
    );

    const trimmedEntries = entries.slice(0, GEOCODING_CACHE_MAX_ENTRIES);
    const asRecord = Object.fromEntries(trimmedEntries);

    window.localStorage.setItem(GEOCODING_CACHE_STORAGE_KEY, JSON.stringify(asRecord));
  } catch {
    // Ignorieren: Caching bleibt optional und darf Requests nicht blockieren.
  }
};

const getCachedValue = <TValue>(cacheKey: string): TValue | undefined => {
  hydrateCacheFromStorage();

  const entry = inMemoryCache.get(cacheKey);

  if (!entry) {
    return undefined;
  }

  return entry.value as TValue;
};

const setCachedValue = <TValue>(cacheKey: string, value: TValue) => {
  inMemoryCache.set(cacheKey, {
    value,
    updatedAt: Date.now(),
  });

  persistCache();
};

const queueNominatimRequest = async <TValue>(request: () => Promise<TValue>): Promise<TValue> => {
  const executeRequest = async () => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - elapsed);

    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), waitMs);
      });
    }

    const result = await request();
    lastNominatimRequestAt = Date.now();

    return result;
  };

  const queuedResult = nominatimQueue.then(executeRequest, executeRequest);

  nominatimQueue = queuedResult.then(
    () => undefined,
    () => undefined,
  );

  return queuedResult;
};

const runGeocodingRequest = async <TValue>(
  requestUrl: URL,
  request: () => Promise<TValue>,
): Promise<TValue> => {
  if (!isPublicNominatimRequest(requestUrl)) {
    return request();
  }

  return queueNominatimRequest(request);
};

export const getGeocodingProviderConfiguration = () => ({
  usesPublicNominatim:
    isPublicNominatimUrl(geocodingSearchUrl) || isPublicNominatimUrl(geocodingReverseUrl),
  searchUrl: geocodingSearchUrl,
  reverseUrl: geocodingReverseUrl,
});

export const searchGeocodingLocations = async (
  query: string,
  limit = 6,
): Promise<GeocodingLocation[]> => {
  const normalizedQuery = normalizeQuery(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  const cacheKey = `search:${normalizedQuery}:${limit}`;
  const cached = getCachedValue<GeocodingLocation[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const requestUrl = withOptionalApiKey(new URL(geocodingSearchUrl));
  requestUrl.searchParams.set("q", normalizedQuery);
  requestUrl.searchParams.set("format", "jsonv2");
  requestUrl.searchParams.set("addressdetails", "1");
  requestUrl.searchParams.set("limit", String(limit));

  const response = await runGeocodingRequest(requestUrl, () => fetch(requestUrl.toString()));

  if (!response.ok) {
    throw new Error("GEOCODING_SEARCH_FAILED");
  }

  const payload = (await response.json()) as Array<{
    place_id?: number | string;
    display_name?: string;
    lat?: string;
    lon?: string;
    name?: string;
  }>;

  const locations = payload
    .map(toGeocodingLocation)
    .filter((entry): entry is GeocodingLocation => Boolean(entry));

  setCachedValue(cacheKey, locations);

  return locations;
};

export const geocodeSingleLocation = async (
  query: string,
): Promise<GeocodingLocation | null> => {
  const locations = await searchGeocodingLocations(query, 1);

  return locations[0] ?? null;
};

export const reverseGeocodeLocation = async (
  latitude: number,
  longitude: number,
): Promise<GeocodingLocation | null> => {
  const normalizedLatitude = normalizeCoordinate(latitude);
  const normalizedLongitude = normalizeCoordinate(longitude);
  const cacheKey = `reverse:${normalizedLatitude},${normalizedLongitude}`;
  const cached = getCachedValue<GeocodingLocation | null>(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const requestUrl = withOptionalApiKey(new URL(geocodingReverseUrl));
  requestUrl.searchParams.set("lat", String(normalizedLatitude));
  requestUrl.searchParams.set("lon", String(normalizedLongitude));
  requestUrl.searchParams.set("format", "jsonv2");

  const response = await runGeocodingRequest(requestUrl, () => fetch(requestUrl.toString()));

  if (!response.ok) {
    throw new Error("GEOCODING_REVERSE_FAILED");
  }

  const payload = (await response.json()) as {
    place_id?: number | string;
    display_name?: string;
    lat?: string;
    lon?: string;
    name?: string;
  };

  const location = toGeocodingLocation(payload);

  setCachedValue(cacheKey, location);

  return location;
};
