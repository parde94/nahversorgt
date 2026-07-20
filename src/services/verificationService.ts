import { supabase } from "../lib/supabase";

export type VerificationRequestType =
  | "register_farm"
  | "claim_existing_farm"
  | "owner_change"
  | "critical_field_change";

export type VerificationRequestStatus = "pending" | "approved" | "rejected";

export type VerificationFarmSnapshot = {
  name?: string | null;
  location?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  region?: string | null;
};

export type VerificationRequestRecord = {
  id: string;
  profile_id: string;
  farm_id: string | null;
  request_type: VerificationRequestType;
  requested_changes: Record<string, unknown>;
  current_snapshot: Record<string, unknown>;
  status: VerificationRequestStatus;
  admin_note: string | null;
  requested_by_profile_id: string;
  reviewed_by_profile_id: string | null;
  created_at: string;
  farm: VerificationFarmSnapshot | null;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

const requestSelect =
  "id, profile_id, farm_id, request_type, requested_changes, current_snapshot, status, admin_note, requested_by_profile_id, reviewed_by_profile_id, created_at, farm:farm_id(name, region, location_text, phone, whatsapp, email, website)";

export const listMyVerificationRequests = async (
  profileId: string,
): Promise<VerificationRequestRecord[]> => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("verification_requests")
    .select(requestSelect)
    .eq("requested_by_profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as VerificationRequestRecord[];
};

export const createClaimExistingFarmRequest = async (input: {
  profileId: string;
  farmId: string;
  requestedChanges: Record<string, unknown>;
  currentSnapshot: Record<string, unknown>;
}) => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("verification_requests")
    .insert({
      profile_id: input.profileId,
      requested_by_profile_id: input.profileId,
      farm_id: input.farmId,
      request_type: "claim_existing_farm",
      requested_changes: input.requestedChanges,
      current_snapshot: input.currentSnapshot,
      status: "pending",
    })
    .select(requestSelect)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as VerificationRequestRecord | null;
};

export const createRegisterFarmRequest = async (input: {
  profileId: string;
  requestedChanges: Record<string, unknown>;
}) => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("verification_requests")
    .insert({
      profile_id: input.profileId,
      requested_by_profile_id: input.profileId,
      farm_id: null,
      request_type: "register_farm",
      requested_changes: input.requestedChanges,
      current_snapshot: {},
      status: "pending",
    })
    .select(requestSelect)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as VerificationRequestRecord | null;
};