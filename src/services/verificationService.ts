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

type VerificationRequestInsertPayload = {
  profile_id: string;
  requested_by_profile_id: string;
  farm_id: string | null;
  request_type: VerificationRequestType;
  requested_changes: Record<string, unknown>;
  current_snapshot: Record<string, unknown>;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

const requestSelect =
  "id, profile_id, farm_id, request_type, requested_changes, current_snapshot, status, admin_note, requested_by_profile_id, reviewed_by_profile_id, created_at, farm:farm_id(name, region, location_text, phone, whatsapp, email, website)";

const compactRecord = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

const getSupabaseErrorDetails = (error: unknown) => {
  if (error && typeof error === "object") {
    const typedError = error as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };

    return {
      code: typeof typedError.code === "string" ? typedError.code : null,
      message: typeof typedError.message === "string" ? typedError.message : String(error),
      details: typeof typedError.details === "string" ? typedError.details : null,
      hint: typeof typedError.hint === "string" ? typedError.hint : null,
    };
  }

  return {
    code: null,
    message: String(error),
    details: null,
    hint: null,
  };
};

const logVerificationRequestError = (
  operation: string,
  error: unknown,
  payload: VerificationRequestInsertPayload,
) => {
  if (!import.meta.env.DEV) {
    return;
  }

  const { code, message, details, hint } = getSupabaseErrorDetails(error);

  console.warn(`Supabase-Fehler bei verification_requests.${operation}`, {
    table: "verification_requests",
    operation,
    code,
    message,
    details,
    hint,
    fieldNames: Object.keys(payload),
    requestedChangesFieldNames: Object.keys(payload.requested_changes),
    currentSnapshotFieldNames: Object.keys(payload.current_snapshot),
  });
};

const insertVerificationRequest = async (payload: VerificationRequestInsertPayload, operation: string) => {
  const client = requireSupabase();

  const { error } = await client.from("verification_requests").insert({
    ...payload,
    requested_changes: compactRecord(payload.requested_changes),
    current_snapshot: compactRecord(payload.current_snapshot),
  });

  if (error) {
    logVerificationRequestError(operation, error, payload);
    throw error;
  }
};

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
  await insertVerificationRequest(
    {
      profile_id: input.profileId,
      requested_by_profile_id: input.profileId,
      farm_id: input.farmId,
      request_type: "claim_existing_farm",
      requested_changes: input.requestedChanges,
      current_snapshot: input.currentSnapshot,
    },
    "createClaimExistingFarmRequest",
  );
};

export const createRegisterFarmRequest = async (input: {
  profileId: string;
  requestedChanges: Record<string, unknown>;
}) => {
  await insertVerificationRequest(
    {
      profile_id: input.profileId,
      requested_by_profile_id: input.profileId,
      farm_id: null,
      request_type: "register_farm",
      requested_changes: input.requestedChanges,
      current_snapshot: {},
    },
    "createRegisterFarmRequest",
  );
};