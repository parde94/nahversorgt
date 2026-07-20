import { supabase } from "../lib/supabase";

export type FarmOwnerFarmRecord = {
  id: string;
  name: string;
  description: string | null;
  region: string | null;
  location_text: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  delivery: boolean;
  delivery_radius_km: number | null;
  self_service: boolean;
  published: boolean;
  approval_state: string;
  latitude: number | null;
  longitude: number | null;
  legacy_source_id: string | null;
};

export type FarmerOwnedFarmRecord = {
  id: string;
  status: string;
  is_primary_owner: boolean;
  farm: FarmOwnerFarmRecord | null;
};

export type FarmerProductRecord = {
  id: string;
  farm_id: string;
  name: string;
  category: string | null;
  price: number | null;
  unit: string | null;
  description: string | null;
  availability: string | null;
  published: boolean;
  sort_order: number;
};

export type FarmerOpeningHourRecord = {
  id: string;
  farm_id: string;
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  note: string | null;
  sort_order: number;
};

export type FarmerDashboardData = {
  ownedFarms: FarmerOwnedFarmRecord[];
  productsByFarmId: Record<string, FarmerProductRecord[]>;
  openingHoursByFarmId: Record<string, FarmerOpeningHourRecord[]>;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

export const getFarmerDashboardData = async (
  profileId: string,
): Promise<FarmerDashboardData> => {
  const client = requireSupabase();

  const { data: ownerData, error: ownerError } = await client
    .from("farm_owners")
    .select(
      "id, status, is_primary_owner, farm:farm_id(id, name, description, region, location_text, address, postal_code, city, phone, whatsapp, email, website, delivery, delivery_radius_km, self_service, published, approval_state, latitude, longitude, legacy_source_id)",
    )
    .eq("profile_id", profileId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (ownerError) {
    throw ownerError;
  }

  const ownedFarms = (ownerData ?? []) as unknown as FarmerOwnedFarmRecord[];
  const farmIds = ownedFarms.map((entry) => entry.farm?.id).filter((id): id is string => Boolean(id));

  if (farmIds.length === 0) {
    return {
      ownedFarms,
      productsByFarmId: {},
      openingHoursByFarmId: {},
    };
  }

  const [productResult, openingHoursResult] = await Promise.all([
    client
      .from("products")
      .select("id, farm_id, name, category, price, unit, description, availability, published, sort_order")
      .in("farm_id", farmIds)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    client
      .from("opening_hours")
      .select("id, farm_id, day_of_week, opens_at, closes_at, note, sort_order")
      .in("farm_id", farmIds)
      .order("day_of_week", { ascending: true })
      .order("sort_order", { ascending: true }),
  ]);

  if (productResult.error) {
    throw productResult.error;
  }

  if (openingHoursResult.error) {
    throw openingHoursResult.error;
  }

  const products = (productResult.data ?? []) as FarmerProductRecord[];
  const openingHours = (openingHoursResult.data ?? []) as FarmerOpeningHourRecord[];

  const productsByFarmId: Record<string, FarmerProductRecord[]> = {};
  const openingHoursByFarmId: Record<string, FarmerOpeningHourRecord[]> = {};

  for (const product of products) {
    const current = productsByFarmId[product.farm_id] ?? [];
    current.push(product);
    productsByFarmId[product.farm_id] = current;
  }

  for (const openingHour of openingHours) {
    const current = openingHoursByFarmId[openingHour.farm_id] ?? [];
    current.push(openingHour);
    openingHoursByFarmId[openingHour.farm_id] = current;
  }

  return {
    ownedFarms,
    productsByFarmId,
    openingHoursByFarmId,
  };
};

export const updateFarmBasics = async (
  farmId: string,
  input: {
    description: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    website: string | null;
    delivery: boolean;
    deliveryRadiusKm: number | null;
    selfService: boolean;
  },
) => {
  const client = requireSupabase();

  const { error } = await client
    .from("farms")
    .update({
      description: input.description,
      phone: input.phone,
      whatsapp: input.whatsapp,
      email: input.email,
      website: input.website,
      delivery: input.delivery,
      delivery_radius_km: input.deliveryRadiusKm,
      self_service: input.selfService,
    })
    .eq("id", farmId);

  if (error) {
    throw error;
  }
};

export const createProduct = async (input: Omit<FarmerProductRecord, "id">) => {
  const client = requireSupabase();

  const { error } = await client.from("products").insert(input);

  if (error) {
    throw error;
  }
};

export const updateProduct = async (
  productId: string,
  input: Partial<Omit<FarmerProductRecord, "id" | "farm_id">>,
) => {
  const client = requireSupabase();

  const { error } = await client.from("products").update(input).eq("id", productId);

  if (error) {
    throw error;
  }
};

export const deleteProduct = async (productId: string) => {
  const client = requireSupabase();

  const { error } = await client.from("products").delete().eq("id", productId);

  if (error) {
    throw error;
  }
};

export const createOpeningHour = async (input: Omit<FarmerOpeningHourRecord, "id">) => {
  const client = requireSupabase();

  const { error } = await client.from("opening_hours").insert(input);

  if (error) {
    throw error;
  }
};

export const updateOpeningHour = async (
  openingHourId: string,
  input: Partial<Omit<FarmerOpeningHourRecord, "id" | "farm_id">>,
) => {
  const client = requireSupabase();

  const { error } = await client
    .from("opening_hours")
    .update(input)
    .eq("id", openingHourId);

  if (error) {
    throw error;
  }
};

export const deleteOpeningHour = async (openingHourId: string) => {
  const client = requireSupabase();

  const { error } = await client.from("opening_hours").delete().eq("id", openingHourId);

  if (error) {
    throw error;
  }
};