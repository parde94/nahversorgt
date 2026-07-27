export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  coordinates: RoutePoint[];
  distanceKm: number;
  durationMin: number;
  start: RoutePoint;
  end: RoutePoint;
};

const routingApiUrl = import.meta.env.VITE_ROUTING_API_URL?.trim() || "";
const routingApiKey = import.meta.env.VITE_ROUTING_API_KEY?.trim() || "";

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
    start,
    end,
  };
};
