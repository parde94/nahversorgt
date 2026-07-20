import { supabase } from "../lib/supabase";
import {
  type VerificationRequestRecord,
} from "./verificationService";

export type AdminRequesterProfile = {
  id: string;
  display_name: string | null;
  phone: string | null;
  role: string;
};

export type AdminFarmRecord = {
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
  legacy_source_id: string | null;
};

export type AdminVerificationRequest = VerificationRequestRecord & {
  requesterProfile: AdminRequesterProfile | null;
  relatedFarm: AdminFarmRecord | null;
  applicantEmail: string | null;
  reviewed_at: string | null;
};

type VerificationRequestRow = Omit<VerificationRequestRecord, "farm"> & {
  reviewed_at: string | null;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

const requestSelect =
  "id, profile_id, farm_id, request_type, requested_changes, current_snapshot, status, admin_note, requested_by_profile_id, reviewed_by_profile_id, created_at, reviewed_at";

const profileSelect = "id, display_name, phone, role";

const farmSelect =
  "id, name, description, region, location_text, address, postal_code, city, phone, whatsapp, email, website, legacy_source_id";

const readString = (value: unknown, fallback: string | null = null) =>
  typeof value === "string" ? value : fallback;

const getApplicantEmail = (request: { requested_changes: Record<string, unknown> }) =>
  readString(request.requested_changes.email ?? null, null);

const loadProfilesByIds = async (profileIds: string[]) => {
  if (profileIds.length === 0) {
    return new Map<string, AdminRequesterProfile>();
  }

  const client = requireSupabase();
  const { data, error } = await client.from("profiles").select(profileSelect).in("id", profileIds);

  if (error) {
    throw error;
  }

  return new Map<string, AdminRequesterProfile>(
    (data ?? []).map((profile) => [profile.id, profile as AdminRequesterProfile]),
  );
};

const loadFarmsByIds = async (farmIds: string[]) => {
  if (farmIds.length === 0) {
    return new Map<string, AdminFarmRecord>();
  }

  const client = requireSupabase();
  const { data, error } = await client.from("farms").select(farmSelect).in("id", farmIds);

  if (error) {
    throw error;
  }

  return new Map<string, AdminFarmRecord>((data ?? []).map((farm) => [farm.id, farm as AdminFarmRecord]));
};

export const listOpenVerificationRequests = async (): Promise<AdminVerificationRequest[]> => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("verification_requests")
    .select(requestSelect)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const requests = (data ?? []) as VerificationRequestRow[];
  const requesterIds = Array.from(
    new Set(requests.flatMap((request) => [request.requested_by_profile_id, request.profile_id]).filter(Boolean)),
  );
  const farmIds = Array.from(new Set(requests.map((request) => request.farm_id).filter((id): id is string => Boolean(id))));

  const [profilesById, farmsById] = await Promise.all([loadProfilesByIds(requesterIds), loadFarmsByIds(farmIds)]);

  return requests.map((request) => {
    const requesterProfile = profilesById.get(request.requested_by_profile_id) ?? profilesById.get(request.profile_id) ?? null;

    return {
      ...request,
      farm: null,
      requesterProfile,
      relatedFarm: request.farm_id ? farmsById.get(request.farm_id) ?? null : null,
      applicantEmail: getApplicantEmail(request),
    };
  });
};

export const listRecentProcessedVerificationRequests = async (): Promise<AdminVerificationRequest[]> => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("verification_requests")
    .select(requestSelect)
    .in("status", ["approved", "rejected"])
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) {
    throw error;
  }

  const requests = (data ?? []) as VerificationRequestRow[];
  const requesterIds = Array.from(
    new Set(requests.flatMap((request) => [request.requested_by_profile_id, request.profile_id]).filter(Boolean)),
  );
  const farmIds = Array.from(new Set(requests.map((request) => request.farm_id).filter((id): id is string => Boolean(id))));

  const [profilesById, farmsById] = await Promise.all([loadProfilesByIds(requesterIds), loadFarmsByIds(farmIds)]);

  return requests.map((request) => {
    const requesterProfile = profilesById.get(request.requested_by_profile_id) ?? profilesById.get(request.profile_id) ?? null;

    return {
      ...request,
      farm: null,
      requesterProfile,
      relatedFarm: request.farm_id ? farmsById.get(request.farm_id) ?? null : null,
      applicantEmail: getApplicantEmail(request),
    };
  });
};

export const getApplicantProfileById = async (profileId: string) => {
  const client = requireSupabase();
  const { data, error } = await client.from("profiles").select(profileSelect).eq("id", profileId).maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AdminRequesterProfile | null) ?? null;
};

export const getRelatedFarmById = async (farmId: string) => {
  const client = requireSupabase();
  const { data, error } = await client.from("farms").select(farmSelect).eq("id", farmId).maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AdminFarmRecord | null) ?? null;
};

export const approveExistingFarmClaim = async (requestId: string, adminNote: string | null) => {
  const client = requireSupabase();
  const { error } = await client.rpc("approve_existing_farm_claim", {
    p_request_id: requestId,
    p_admin_note: adminNote,
  });

  if (error) {
    throw error;
  }
};

export const rejectVerificationRequest = async (requestId: string, adminNote: string | null) => {
  const client = requireSupabase();
  const { error } = await client.rpc("reject_verification_request", {
    p_request_id: requestId,
    p_admin_note: adminNote,
  });

  if (error) {
    throw error;
  }
};
