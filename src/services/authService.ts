import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const requireSupabase = () => {
  if (!supabase) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }

  return supabase;
};

export const isSupabaseConfigured = Boolean(supabase);

export const getCurrentSession = async () => {
  return requireSupabase().auth.getSession();
};

export const onAuthStateChange = (callback: (session: Session | null) => void) => {
  const client = requireSupabase();

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    data.subscription.unsubscribe();
  };
};

export const signUpWithEmailPassword = async (email: string, password: string) => {
  const client = requireSupabase();

  return client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
};

export const signInWithEmailPassword = async (email: string, password: string) => {
  const client = requireSupabase();

  return client.auth.signInWithPassword({
    email,
    password,
  });
};

export const signOut = async () => {
  return requireSupabase().auth.signOut();
};

export const sendPasswordReset = async (email: string) => {
  const client = requireSupabase();

  return client.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
};