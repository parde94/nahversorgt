import fallbackFarmData from "../data/nahversorgt-data.json";
import { supabase } from "../lib/supabase";

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

type FarmDataFile = {
  farms: FarmSourceEntry[];
};

type DbFarmRow = {
  id: string;
  legacy_source_id: string | null;
  name: string;
  region: string | null;
  location_text: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  delivery: boolean;
  delivery_radius_km: number | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
};

type DbProductRow = {
  farm_id: string;
  name: string;
  category: string | null;
  sort_order: number;
};

type DbOpeningHoursRow = {
  farm_id: string;
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  note: string | null;
  sort_order: number;
};

const SUPABASE_TIMEOUT_MS = 7000;

const fallbackFarms = (fallbackFarmData as FarmDataFile).farms;

const devWarn = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.warn(...args);
  }
};

const devLogSource = (source: "Supabase" | "JSON-Fallback") => {
  if (import.meta.env.DEV) {
    console.info(`Datenquelle: ${source}`);
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Supabase timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const formatSupabaseTime = (value: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = value.slice(0, 5);

  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return null;
};

const dayLabelByNumber: Record<number, string> = {
  0: "So",
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
  6: "Sa",
};

const buildOpeningHoursText = (
  openingRows: DbOpeningHoursRow[],
  fallbackText: string | null,
) => {
  if (openingRows.length === 0) {
    return fallbackText ?? undefined;
  }

  const sorted = [...openingRows].sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) {
      return a.day_of_week - b.day_of_week;
    }

    return a.sort_order - b.sort_order;
  });

  const lines = sorted
    .map((row) => {
      const dayLabel = dayLabelByNumber[row.day_of_week];

      if (!dayLabel) {
        return null;
      }

      const opensAt = formatSupabaseTime(row.opens_at);
      const closesAt = formatSupabaseTime(row.closes_at);

      if (opensAt && closesAt) {
        return `${dayLabel}: ${opensAt} - ${closesAt} Uhr`;
      }

      const note = row.note?.trim();

      if (note) {
        return `${dayLabel}: ${note}`;
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (lines.length === 0) {
    return fallbackText ?? undefined;
  }

  return lines.join("; ");
};

const getJsonFallbackFarms = () => fallbackFarms;

const fetchSupabaseFarms = async (): Promise<FarmSourceEntry[]> => {
  if (!supabase) {
    throw new Error("Supabase client not configured");
  }

  const { data: farmsData, error: farmsError } = await supabase
    .from("farms")
    .select(
      "id, legacy_source_id, name, region, location_text, address, phone, whatsapp, website, delivery, delivery_radius_km, latitude, longitude, description",
    )
    .eq("published", true)
    .eq("approval_state", "approved")
    .order("name", { ascending: true });

  if (farmsError) {
    throw farmsError;
  }

  const farmRows = (farmsData ?? []) as DbFarmRow[];

  if (farmRows.length === 0) {
    return [];
  }

  const farmIds = farmRows.map((farm) => farm.id);

  const [productsResult, openingHoursResult, farmImagesResult] = await Promise.all([
    supabase
      .from("products")
      .select("farm_id, name, category, sort_order")
      .in("farm_id", farmIds)
      .eq("published", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("opening_hours")
      .select("farm_id, day_of_week, opens_at, closes_at, note, sort_order")
      .in("farm_id", farmIds)
      .order("day_of_week", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("farm_images")
      .select("farm_id, storage_path, is_primary, sort_order")
      .in("farm_id", farmIds)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true }),
  ]);

  if (productsResult.error) {
    throw productsResult.error;
  }

  if (openingHoursResult.error) {
    throw openingHoursResult.error;
  }

  if (farmImagesResult.error) {
    throw farmImagesResult.error;
  }

  const products = (productsResult.data ?? []) as DbProductRow[];
  const openingHours = (openingHoursResult.data ?? []) as DbOpeningHoursRow[];

  const productsByFarm = new Map<string, DbProductRow[]>();
  const openingByFarm = new Map<string, DbOpeningHoursRow[]>();

  for (const product of products) {
    const current = productsByFarm.get(product.farm_id) ?? [];
    current.push(product);
    productsByFarm.set(product.farm_id, current);
  }

  for (const openingHour of openingHours) {
    const current = openingByFarm.get(openingHour.farm_id) ?? [];
    current.push(openingHour);
    openingByFarm.set(openingHour.farm_id, current);
  }

  return farmRows.map((farm) => {
    const farmProducts = productsByFarm.get(farm.id) ?? [];
    const farmOpeningHours = openingByFarm.get(farm.id) ?? [];

    const categories = Array.from(
      new Set(
        farmProducts
          .map((product) => product.category?.trim())
          .filter((category): category is string => Boolean(category)),
      ),
    );

    const productNames = farmProducts
      .map((product) => product.name.trim())
      .filter(Boolean);

    const stableId = farm.legacy_source_id?.trim() || farm.id;

    return {
      id: stableId,
      name: farm.name,
      region: farm.region ?? undefined,
      locationText: farm.location_text ?? undefined,
      address: farm.address ?? undefined,
      products: productNames,
      productCategories: categories,
      delivery: farm.delivery,
      deliveryRadiusKm: farm.delivery_radius_km,
      whatsapp: farm.whatsapp,
      openingHoursText: buildOpeningHoursText(farmOpeningHours, farm.description),
      phone: farm.phone,
      website: farm.website,
      latitude: farm.latitude,
      longitude: farm.longitude,
      coordinates: null,
    };
  });
};

export const loadFarms = async (): Promise<FarmSourceEntry[]> => {
  if (!supabase) {
    devLogSource("JSON-Fallback");
    return getJsonFallbackFarms();
  }

  try {
    const farms = await withTimeout(fetchSupabaseFarms(), SUPABASE_TIMEOUT_MS);

    if (farms.length === 0) {
      devWarn("Supabase returned 0 farms. Falling back to JSON data.");
      devLogSource("JSON-Fallback");
      return getJsonFallbackFarms();
    }

    devLogSource("Supabase");
    return farms;
  } catch (error) {
    devWarn("Supabase request failed. Falling back to JSON data.", error);
    devLogSource("JSON-Fallback");
    return getJsonFallbackFarms();
  }
};
