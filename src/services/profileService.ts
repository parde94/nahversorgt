import { supabase } from "../lib/supabase";

export type FarmerRole = "visitor" | "farmer_pending" | "farmer_verified" | "admin";

export type UserProfile = {
  id: string;
  display_name: string | null;
  phone: string | null;
  role: FarmerRole;
};

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

export const getCurrentProfile = async (profileId: string): Promise<UserProfile | null> => {
  const client = requireSupabase();

  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, phone, role")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as UserProfile | null) ?? null;
};