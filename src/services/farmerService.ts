import { supabase } from "../lib/supabase";

const FARM_IMAGE_BUCKET = "farm-images";
const MAX_FARM_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FARM_IMAGES = 10;

const ALLOWED_FARM_IMAGE_TYPES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

export type FarmerFarmImageRecord = {
  id: string;
  farm_id: string;
  storage_path: string;
  caption: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  publicUrl: string;
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
  imagesByFarmId: Record<string, FarmerFarmImageRecord[]>;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

const normalizeFarmImageRow = (
  row: {
    id: string;
    farm_id: string;
    storage_path: string;
    caption: string | null;
    is_primary: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
  },
  client = requireSupabase(),
): FarmerFarmImageRecord => ({
  ...row,
  publicUrl: client.storage.from(FARM_IMAGE_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
});

const requireAllowedFarmImageType = (file: File) => {
  const type = file.type.trim().toLowerCase();

  if (type && ALLOWED_FARM_IMAGE_TYPES[type]) {
    return ALLOWED_FARM_IMAGE_TYPES[type];
  }

  const extension = file.name.split(".").pop()?.trim().toLowerCase();

  if (extension === "jpg" || extension === "jpeg") {
    return "jpg";
  }

  if (extension === "png") {
    return "png";
  }

  if (extension === "webp") {
    return "webp";
  }

  throw new Error("Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt.");
};

const buildFarmImageStoragePath = (farmId: string, file: File) => {
  const extension = requireAllowedFarmImageType(file);

  return `${farmId}/${crypto.randomUUID()}.${extension}`;
};

const getFarmImageCount = async (farmId: string) => {
  const client = requireSupabase();

  const { count, error } = await client
    .from("farm_images")
    .select("id", { count: "exact", head: true })
    .eq("farm_id", farmId);

  if (error) {
    throw error;
  }

  return count ?? 0;
};

export const loadFarmImages = async (farmId: string): Promise<FarmerFarmImageRecord[]> => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("farm_images")
    .select("id, farm_id, storage_path, caption, is_primary, sort_order, created_at, updated_at")
    .eq("farm_id", farmId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => normalizeFarmImageRow(row));
};

export const uploadFarmImage = async (
  farmId: string,
  file: File,
  input: {
    caption?: string | null;
  } = {},
) => {
  const client = requireSupabase();

  if (file.size > MAX_FARM_IMAGE_BYTES) {
    throw new Error("Ein Bild darf maximal 5 MB groß sein.");
  }

  const currentImageCount = await getFarmImageCount(farmId);

  if (currentImageCount >= MAX_FARM_IMAGES) {
    throw new Error("Ein Hof kann maximal 10 Bilder haben.");
  }

  const storagePath = buildFarmImageStoragePath(farmId, file);
  const caption = input.caption?.trim() || null;
  const isPrimary = currentImageCount === 0;

  const { error: uploadError } = await client.storage.from(FARM_IMAGE_BUCKET).upload(storagePath, file, {
    contentType: file.type || undefined,
    upsert: false,
    cacheControl: "3600",
  });

  if (uploadError) {
    throw uploadError;
  }

  const { data, error } = await client
    .from("farm_images")
    .insert({
      farm_id: farmId,
      storage_path: storagePath,
      caption,
      is_primary: isPrimary,
      sort_order: currentImageCount,
    })
    .select("id, farm_id, storage_path, caption, is_primary, sort_order, created_at, updated_at")
    .single();

  if (error) {
    await client.storage.from(FARM_IMAGE_BUCKET).remove([storagePath]);
    throw error;
  }

  return normalizeFarmImageRow(data);
};

export const deleteFarmImage = async (imageId: string) => {
  const client = requireSupabase();

  const { data: image, error: loadError } = await client
    .from("farm_images")
    .select("storage_path")
    .eq("id", imageId)
    .maybeSingle();

  if (loadError) {
    throw new Error("Das Bild konnte nicht vorbereitet werden.");
  }

  if (!image?.storage_path) {
    throw new Error("Der Speicherpfad des Bildes fehlt.");
  }

  const { error: storageError } = await client.storage.from(FARM_IMAGE_BUCKET).remove([image.storage_path]);

  if (storageError) {
    throw new Error("Das Bild konnte nicht aus dem Speicher gelöscht werden.");
  }

  const { error } = await client.from("farm_images").delete().eq("id", imageId);

  if (error) {
    throw new Error("Der Datenbankeintrag des Bildes konnte nicht gelöscht werden.");
  }
};

export const setFarmImageAsPrimary = async (imageId: string) => {
  const client = requireSupabase();

  const { error } = await client.rpc("set_farm_image_primary", {
    p_image_id: imageId,
  });

  if (error) {
    throw error;
  }
};

export const updateFarmImageOrder = async (imageId: string, sortOrder: number) => {
  const client = requireSupabase();

  const { error } = await client
    .from("farm_images")
    .update({ sort_order: sortOrder })
    .eq("id", imageId);

  if (error) {
    throw error;
  }
};

export const updateFarmImageDescription = async (imageId: string, caption: string | null) => {
  const client = requireSupabase();

  const { error } = await client
    .from("farm_images")
    .update({ caption: caption?.trim() || null })
    .eq("id", imageId);

  if (error) {
    throw error;
  }
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
      imagesByFarmId: {},
    };
  }

  const [productResult, openingHoursResult, imageResult] = await Promise.all([
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
    client
      .from("farm_images")
      .select("id, farm_id, storage_path, caption, is_primary, sort_order, created_at, updated_at")
      .in("farm_id", farmIds)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (productResult.error) {
    throw productResult.error;
  }

  if (openingHoursResult.error) {
    throw openingHoursResult.error;
  }

  if (imageResult.error) {
    throw imageResult.error;
  }

  const products = (productResult.data ?? []) as FarmerProductRecord[];
  const openingHours = (openingHoursResult.data ?? []) as FarmerOpeningHourRecord[];
  const images = (imageResult.data ?? []).map((row) => normalizeFarmImageRow(row));

  const productsByFarmId: Record<string, FarmerProductRecord[]> = {};
  const openingHoursByFarmId: Record<string, FarmerOpeningHourRecord[]> = {};
  const imagesByFarmId: Record<string, FarmerFarmImageRecord[]> = {};

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

  for (const image of images) {
    const current = imagesByFarmId[image.farm_id] ?? [];
    current.push(image);
    imagesByFarmId[image.farm_id] = current;
  }

  return {
    ownedFarms,
    productsByFarmId,
    openingHoursByFarmId,
    imagesByFarmId,
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