export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  coordinates: RoutePoint[];
  distanceKm: number;
  durationMin: number;
  durationSeconds: number;
  start: RoutePoint;
  end: RoutePoint;
};

export type TableFarmInput = {
  id: string;
  point: RoutePoint;
};

export type RoutingTableConfiguration = {
  isConfigured: boolean;
  tableApiUrl: string | null;
  routingProfile: string | null;
  derivedFromRouteApiUrl: boolean;
};

const routingApiUrl = import.meta.env.VITE_ROUTING_API_URL?.trim() || "";
const routingApiKey = import.meta.env.VITE_ROUTING_API_KEY?.trim() || "";
const routingTableApiUrl = import.meta.env.VITE_ROUTING_TABLE_API_URL?.trim() || "";

export const getRoutingConfiguration = () => ({
  isConfigured: Boolean(routingApiUrl),
  missingVariables: routingApiUrl ? [] : ["VITE_ROUTING_API_URL"],
});

const toUrlWithApiKey = (url: URL) => {
  if (routingApiKey) {
    url.searchParams.set("api_key", routingApiKey);
  }

  return url;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const deriveTableApiUrlFromRouteApiUrl = (routeApiUrl: string) => {
  try {
    const parsed = new URL(routeApiUrl);
    const normalizedPathname = trimTrailingSlash(parsed.pathname);

    if (!normalizedPathname.includes("/route/v1/")) {
      throw new Error("ROUTING_TABLE_URL_DERIVATION_FAILED");
    }

    const tablePathname = normalizedPathname.replace("/route/v1/", "/table/v1/");
    parsed.pathname = tablePathname;
    parsed.search = "";
    parsed.hash = "";

    return trimTrailingSlash(parsed.toString());
  } catch (error) {
    if (error instanceof Error && error.message.includes("ROUTING_TABLE_URL_DERIVATION_FAILED")) {
      throw error;
    }

    throw new Error("ROUTING_TABLE_URL_INVALID");
  }
};

const extractRoutingProfile = (apiUrl: string) => {
  try {
    const parsed = new URL(apiUrl);
    const segments = trimTrailingSlash(parsed.pathname).split("/").filter(Boolean);

    if (segments.length < 4) {
      return null;
    }

    return segments[3] ?? null;
  } catch {
    return null;
  }
};

const resolveRoutingTableApiUrl = () => {
  if (routingTableApiUrl) {
    return {
      tableApiUrl: trimTrailingSlash(routingTableApiUrl),
      derivedFromRouteApiUrl: false,
    };
  }

  if (!routingApiUrl) {
    throw new Error("ROUTING_NOT_CONFIGURED");
  }

  return {
    tableApiUrl: deriveTableApiUrlFromRouteApiUrl(routingApiUrl),
    derivedFromRouteApiUrl: true,
  };
};

const parseDurationsMatrix = (payload: { durations?: Array<Array<number | null>> }) => {
  if (!Array.isArray(payload.durations) || payload.durations.length === 0) {
    throw new Error("ROUTING_TABLE_RESPONSE_INVALID");
  }

  return payload.durations;
};

export const getRoutingTableConfiguration = (): RoutingTableConfiguration => {
  if (!routingApiUrl && !routingTableApiUrl) {
    return {
      isConfigured: false,
      tableApiUrl: null,
      routingProfile: null,
      derivedFromRouteApiUrl: false,
    };
  }

  try {
    const resolved = resolveRoutingTableApiUrl();

    return {
      isConfigured: true,
      tableApiUrl: resolved.tableApiUrl,
      routingProfile: extractRoutingProfile(resolved.tableApiUrl),
      derivedFromRouteApiUrl: resolved.derivedFromRouteApiUrl,
    };
  } catch {
    return {
      isConfigured: false,
      tableApiUrl: null,
      routingProfile: null,
      derivedFromRouteApiUrl: false,
    };
  }
};

const toRad = (value: number) => (value * Math.PI) / 180;

const pointToSegmentDistanceKm = (
  point: RoutePoint,
  from: RoutePoint,
  to: RoutePoint,
): number => {
  const referenceLatitude = toRad(point.latitude);
  const kmPerLon = 111.32 * Math.cos(referenceLatitude);
  const kmPerLat = 110.57;

  const px = point.longitude * kmPerLon;
  const py = point.latitude * kmPerLat;
  const ax = from.longitude * kmPerLon;
  const ay = from.latitude * kmPerLat;
  const bx = to.longitude * kmPerLon;
  const by = to.latitude * kmPerLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lengthSq = abx * abx + aby * aby;

  if (lengthSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq));
  const projectedX = ax + t * abx;
  const projectedY = ay + t * aby;

  return Math.hypot(px - projectedX, py - projectedY);
};

export const getDistanceToRouteKm = (
  point: RoutePoint,
  route: RoutePoint[],
): number => {
  if (route.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (route.length === 1) {
    return pointToSegmentDistanceKm(point, route[0], route[0]);
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < route.length - 1; index += 1) {
    const currentDistance = pointToSegmentDistanceKm(point, route[index], route[index + 1]);

    if (currentDistance < shortestDistance) {
      shortestDistance = currentDistance;
    }
  }

  return shortestDistance;
};

export const getRouteBetweenPoints = async (
  start: RoutePoint,
  end: RoutePoint,
): Promise<RouteResult> => {
  const configuration = getRoutingConfiguration();

  if (!configuration.isConfigured) {
    throw new Error("ROUTING_NOT_CONFIGURED");
  }

  const baseUrl = routingApiUrl.endsWith("/")
    ? routingApiUrl.slice(0, -1)
    : routingApiUrl;

  const path = `${start.longitude},${start.latitude};${end.longitude},${end.latitude}`;
  const requestUrl = toUrlWithApiKey(new URL(`${baseUrl}/${path}`));
  requestUrl.searchParams.set("overview", "full");
  requestUrl.searchParams.set("geometries", "geojson");

  const response = await fetch(requestUrl.toString());

  if (!response.ok) {
    throw new Error("ROUTING_REQUEST_FAILED");
  }

  const payload = (await response.json()) as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: {
        coordinates?: [number, number][];
      };
    }>;
  };

  const route = payload.routes?.[0];
  const coordinates = route?.geometry?.coordinates ?? [];

  if (!route || coordinates.length < 2) {
    throw new Error("ROUTING_NO_ROUTE");
  }

  return {
    coordinates: coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
    distanceKm: Number(route.distance ?? 0) / 1000,
    durationMin: Number(route.duration ?? 0) / 60,
    durationSeconds: Number(route.duration ?? 0),
    start,
    end,
  };
};

export const getViaFarmDurationsByFarmId = async ({
  start,
  end,
  farms,
  signal,
}: {
  start: RoutePoint;
  end: RoutePoint;
  farms: TableFarmInput[];
  signal?: AbortSignal;
}): Promise<Record<string, number | null>> => {
  if (farms.length === 0) {
    return {};
  }

  const { tableApiUrl } = resolveRoutingTableApiUrl();

  if (!tableApiUrl) {
    throw new Error("ROUTING_TABLE_NOT_CONFIGURED");
  }

  const coordinatePath = [start, ...farms.map((farm) => farm.point), end]
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(";");

  const buildTableRequestUrl = (sources: string, destinations: string) => {
    const requestUrl = toUrlWithApiKey(new URL(`${tableApiUrl}/${coordinatePath}`));

    requestUrl.searchParams.set("sources", sources);
    requestUrl.searchParams.set("destinations", destinations);
    requestUrl.searchParams.set("annotations", "duration");
    requestUrl.searchParams.set("skip_waypoints", "true");

    return requestUrl;
  };

  const farmCount = farms.length;
  const sourceStartIndex = "0";
  const destinationEndIndex = String(farmCount + 1);
  const farmIndexes = Array.from({ length: farmCount }, (_, index) => String(index + 1)).join(";");

  const startToFarmUrl = buildTableRequestUrl(sourceStartIndex, farmIndexes);
  const farmToEndUrl = buildTableRequestUrl(farmIndexes, destinationEndIndex);

  const [startToFarmResponse, farmToEndResponse] = await Promise.all([
    fetch(startToFarmUrl.toString(), { signal }),
    fetch(farmToEndUrl.toString(), { signal }),
  ]);

  if (!startToFarmResponse.ok || !farmToEndResponse.ok) {
    throw new Error("ROUTING_TABLE_REQUEST_FAILED");
  }

  const startToFarmPayload = (await startToFarmResponse.json()) as {
    durations?: Array<Array<number | null>>;
  };
  const farmToEndPayload = (await farmToEndResponse.json()) as {
    durations?: Array<Array<number | null>>;
  };

  const startToFarmDurations = parseDurationsMatrix(startToFarmPayload);
  const farmToEndDurations = parseDurationsMatrix(farmToEndPayload);

  const rowFromStart = startToFarmDurations[0];

  if (!Array.isArray(rowFromStart) || rowFromStart.length !== farmCount) {
    throw new Error("ROUTING_TABLE_RESPONSE_INVALID");
  }

  if (farmToEndDurations.length !== farmCount) {
    throw new Error("ROUTING_TABLE_RESPONSE_INVALID");
  }

  return Object.fromEntries(
    farms.map((farm, index) => {
      const startToFarmSeconds = rowFromStart[index];
      const farmToEndSeconds = farmToEndDurations[index]?.[0] ?? null;

      if (
        typeof startToFarmSeconds !== "number" ||
        !Number.isFinite(startToFarmSeconds) ||
        typeof farmToEndSeconds !== "number" ||
        !Number.isFinite(farmToEndSeconds)
      ) {
        return [farm.id, null];
      }

      return [farm.id, startToFarmSeconds + farmToEndSeconds];
    }),
  );
};
