import { useEffect, useMemo, useState } from "react";
import { loadFarms } from "../services/farmService";
import {
  createClaimExistingFarmRequest,
  createRegisterFarmRequest,
  listMyVerificationRequests,
  type VerificationRequestRecord,
} from "../services/verificationService";
import {
  approveExistingFarmClaim,
  listOpenVerificationRequests,
  rejectVerificationRequest,
  type AdminVerificationRequest,
} from "../services/adminService";
import {
  getCurrentSession,
  isSupabaseConfigured,
  onAuthStateChange,
  sendPasswordReset,
  signInWithEmailPassword,
  signOut,
  signUpWithEmailPassword,
} from "../services/authService";
import {
  getCurrentProfile,
  type FarmerRole,
  type UserProfile,
} from "../services/profileService";
import {
  createOpeningHour,
  createProduct,
  deleteOpeningHour,
  deleteProduct,
  getFarmerDashboardData,
  updateFarmBasics,
  updateOpeningHour,
  updateProduct,
  type FarmerDashboardData,
  type FarmerOpeningHourRecord,
  type FarmerProductRecord,
  type FarmOwnerFarmRecord,
} from "../services/farmerService";

type SessionUser = {
  id: string;
  email: string | null;
};

type SessionState = {
  user: SessionUser | null;
};

type PublicFarmEntry = {
  id: string;
  databaseId: string;
  name: string;
  region?: string;
  locationText?: string;
  address?: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  products: string[];
  delivery: boolean;
  deliveryRadiusKm?: number | null;
};

type AuthMode = "signin" | "signup" | "reset";

type NewFarmRequestForm = {
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  region: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  description: string;
  products: string;
  openingHours: string;
  delivery: boolean;
  message: string;
  confirmed: boolean;
};

type ClaimFarmForm = {
  message: string;
  phone: string;
  email: string;
};

type ProductDraft = {
  name: string;
  category: string;
  price: string;
  unit: string;
  description: string;
  availability: string;
  published: boolean;
};

type OpeningHourDraft = {
  dayOfWeek: string;
  opensAt: string;
  closesAt: string;
  note: string;
  sortOrder: string;
};

const CLAIM_FARM_RESULTS_LIMIT = 15;

const emptyClaimForm = (): ClaimFarmForm => ({
  message: "",
  phone: "",
  email: "",
});

const emptyNewFarmForm = (): NewFarmRequestForm => ({
  name: "",
  contactPerson: "",
  street: "",
  postalCode: "",
  city: "",
  region: "",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  description: "",
  products: "",
  openingHours: "",
  delivery: false,
  message: "",
  confirmed: false,
});

const emptyProductDraft = (): ProductDraft => ({
  name: "",
  category: "",
  price: "",
  unit: "",
  description: "",
  availability: "",
  published: true,
});

const emptyOpeningHourDraft = (): OpeningHourDraft => ({
  dayOfWeek: "1",
  opensAt: "08:00",
  closesAt: "12:00",
  note: "",
  sortOrder: "0",
});

type LoadState = "idle" | "loading" | "ready";

type AdminRequestFilter = "all" | "claim_existing_farm" | "register_farm";

type AdminAction = {
  requestId: string;
  type: "approve" | "reject";
} | null;

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

const logSupabaseError = (tableName: string, error: unknown, fieldNames?: string[]) => {
  if (!import.meta.env.DEV) {
    return;
  }

  const { code, message, details, hint } = getSupabaseErrorDetails(error);

  console.warn(`Supabase-Fehler bei ${tableName}`, {
    table: tableName,
    code,
    message,
    details,
    hint,
    fieldNames,
    error,
  });
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const normalizeText = (value: string) => value.trim().toLowerCase();

const requestTypeLabel = (value: VerificationRequestRecord["request_type"]) => {
  switch (value) {
    case "claim_existing_farm":
      return "Bestehenden Hof beanspruchen";
    case "register_farm":
      return "Neuen Hof melden";
    case "owner_change":
      return "Eigentümerzuordnung";
    case "critical_field_change":
      return "Kritische Änderung";
    default:
      return value;
  }
};

const requestStatusLabel = (value: VerificationRequestRecord["status"]) => {
  switch (value) {
    case "pending":
      return "In Prüfung";
    case "approved":
      return "Freigegeben";
    case "rejected":
      return "Abgelehnt";
    default:
      return value;
  }
};

const roleLabel = (role?: FarmerRole | null) => {
  switch (role) {
    case "farmer_pending":
      return "Bestätigung ausstehend";
    case "farmer_verified":
      return "Verifiziert";
    case "admin":
      return "Admin";
    default:
      return "Unbekannt";
  }
};

const friendlyErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (/invalid login credentials|wrong credentials/i.test(message)) {
    return "E-Mail oder Passwort ist ungültig.";
  }

  if (/email.*confirmed|confirmation/i.test(message)) {
    return "Bitte bestätige deine E-Mail-Adresse.";
  }

  if (/already registered|user already exists/i.test(message)) {
    return "Für diese E-Mail existiert bereits ein Konto.";
  }

  if (/password/i.test(message) && /length|min/i.test(message)) {
    return "Das Passwort ist zu kurz.";
  }

  if (/row-level security|permission denied|not allowed/i.test(message)) {
    return "Dieser Vorgang ist momentan nicht erlaubt.";
  }

  return "Der Vorgang ist fehlgeschlagen. Bitte versuche es erneut.";
};

const readString = (value: unknown, fallback = "") => {
  if (typeof value === "string") {
    return value;
  }

  return fallback;
};

const readBoolean = (value: unknown) => value === true;

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const readRecordValue = (record: Record<string, unknown>, key: string) => record[key];

const getRequestFarmName = (request: VerificationRequestRecord) => {
  if (request.request_type === "register_farm") {
    return readString(readRecordValue(request.requested_changes, "name"), "Neuer Hof");
  }

  return request.farm?.name ?? readString(readRecordValue(request.current_snapshot, "name"), "Hof");
};

const getAdminRequestFarmName = (request: AdminVerificationRequest) => {
  if (request.request_type === "register_farm") {
    return readString(readRecordValue(request.requested_changes, "name"), "Neuer Hof");
  }

  return request.relatedFarm?.name ?? readString(readRecordValue(request.current_snapshot, "name"), "Hof");
};

const getAdminRequestContactValue = (request: AdminVerificationRequest, key: string) =>
  (typeof readRecordValue(request.requested_changes, key) === "string"
    ? readString(readRecordValue(request.requested_changes, key))
    : typeof readRecordValue(request.current_snapshot, key) === "string"
      ? readString(readRecordValue(request.current_snapshot, key))
      : null);

const getAdminApplicantName = (request: AdminVerificationRequest) =>
  request.requesterProfile?.display_name?.trim() || request.requesterProfile?.id || "Unbekannt";

const getClaimFarmSnapshot = (farm: PublicFarmEntry) => ({
  name: farm.name,
  location: farm.locationText ?? farm.address ?? farm.region ?? null,
  phone: farm.phone ?? null,
  whatsapp: farm.whatsapp ?? null,
  email: farm.email ?? null,
  website: farm.website ?? null,
  region: farm.region ?? null,
});

const updateOwnedFarmDraft = (
  dashboard: FarmerDashboardData | null,
  farmId: string,
  patch: Partial<FarmOwnerFarmRecord>,
): FarmerDashboardData | null => {
  if (!dashboard) {
    return dashboard;
  }

  return {
    ...dashboard,
    ownedFarms: dashboard.ownedFarms.map((ownership) => {
      if (ownership.farm?.id !== farmId || !ownership.farm) {
        return ownership;
      }

      return {
        ...ownership,
        farm: {
          ...ownership.farm,
          ...patch,
        },
      };
    }),
  };
};

const updateProductDraft = (
  dashboard: FarmerDashboardData | null,
  productId: string,
  patch: Partial<FarmerProductRecord>,
): FarmerDashboardData | null => {
  if (!dashboard) {
    return dashboard;
  }

  return {
    ...dashboard,
    productsByFarmId: Object.fromEntries(
      Object.entries(dashboard.productsByFarmId).map(([farmId, products]) => [
        farmId,
        products.map((product) =>
          product.id === productId ? { ...product, ...patch } : product,
        ),
      ]),
    ),
  };
};

const updateOpeningHourDraft = (
  dashboard: FarmerDashboardData | null,
  openingHourId: string,
  patch: Partial<FarmerOpeningHourRecord>,
): FarmerDashboardData | null => {
  if (!dashboard) {
    return dashboard;
  }

  return {
    ...dashboard,
    openingHoursByFarmId: Object.fromEntries(
      Object.entries(dashboard.openingHoursByFarmId).map(([farmId, openingHours]) => [
        farmId,
        openingHours.map((openingHour) =>
          openingHour.id === openingHourId ? { ...openingHour, ...patch } : openingHour,
        ),
      ]),
    ),
  };
};

export function FarmerArea() {
  const [session, setSession] = useState<SessionState>({ user: null });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoadState, setProfileLoadState] = useState<LoadState>("idle");
  const [requests, setRequests] = useState<VerificationRequestRecord[]>([]);
  const [requestsLoadState, setRequestsLoadState] = useState<LoadState>("idle");
  const [adminRequests, setAdminRequests] = useState<AdminVerificationRequest[]>([]);
  const [adminRequestsLoadState, setAdminRequestsLoadState] = useState<LoadState>("idle");
  const [dashboard, setDashboard] = useState<FarmerDashboardData | null>(null);
  const [dashboardLoadState, setDashboardLoadState] = useState<LoadState>("idle");
  const [publicFarms, setPublicFarms] = useState<PublicFarmEntry[]>([]);
  const [publicFarmsError, setPublicFarmsError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [claimSearch, setClaimSearch] = useState("");
  const [selectedClaimFarmId, setSelectedClaimFarmId] = useState<string | null>(null);
  const [claimForm, setClaimForm] = useState<ClaimFarmForm>(emptyClaimForm());
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [newFarmForm, setNewFarmForm] = useState<NewFarmRequestForm>(emptyNewFarmForm());
  const [newFarmMessage, setNewFarmMessage] = useState<string | null>(null);
  const [newFarmError, setNewFarmError] = useState<string | null>(null);
  const [newFarmLoading, setNewFarmLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [adminRequestsError, setAdminRequestsError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [adminFilter, setAdminFilter] = useState<AdminRequestFilter>("all");
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction>(null);
  const [adminActionLoadingId, setAdminActionLoadingId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [farmSaveState, setFarmSaveState] = useState<Record<string, boolean>>({});
  const [productSaveState, setProductSaveState] = useState<Record<string, boolean>>({});
  const [openingSaveState, setOpeningSaveState] = useState<Record<string, boolean>>({});
  const [newProductForms, setNewProductForms] = useState<Record<string, ProductDraft>>({});
  const [newOpeningForms, setNewOpeningForms] = useState<Record<string, OpeningHourDraft>>({});

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let cancelled = false;

    const hydrate = async () => {
      try {
        const { data } = await getCurrentSession();

        if (!cancelled) {
          setSession({
            user: data.session?.user
              ? { id: data.session.user.id, email: data.session.user.email ?? null }
              : null,
          });
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("Session konnte nicht geladen werden", error);
        }
      }
    };

    void hydrate();

    const unsubscribe = onAuthStateChange((nextSession) => {
      if (cancelled) {
        return;
      }

      setSession({
        user: nextSession?.user
          ? { id: nextSession.user.id, email: nextSession.user.email ?? null }
          : null,
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPublicFarms = async () => {
      try {
        setPublicFarmsError(null);
        const farms = await loadFarms();

        if (!cancelled) {
          setPublicFarms(
            farms.map((farm) => ({
              id: farm.id,
              databaseId: farm.databaseId,
              name: farm.name,
              region: farm.region,
              locationText: farm.locationText,
              address: farm.address,
              email: farm.email,
              phone: farm.phone,
              whatsapp: farm.whatsapp,
              website: farm.website,
              products: farm.products,
              delivery: farm.delivery,
              deliveryRadiusKm: farm.deliveryRadiusKm,
            })),
          );
        }
      } catch (error) {
        logSupabaseError("farms", error);

        if (!cancelled) {
          setPublicFarmsError("Die Hofsuche konnte gerade nicht geladen werden.");
        }
      }
    };

    void loadPublicFarms();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session.user) {
      setProfile(null);
      setProfileLoadState("idle");
      setRequests([]);
      setRequestsLoadState("idle");
      setAdminRequests([]);
      setAdminRequestsLoadState("idle");
      setDashboard(null);
      setDashboardLoadState("idle");
      setProfileLoadError(null);
      setRequestsError(null);
      setAdminRequestsError(null);
      setDashboardError(null);
      setAdminMessage(null);
      setAdminAction(null);
      setAdminActionLoadingId(null);
      setPublicFarmsError(null);
      return;
    }

    let cancelled = false;

    const fallbackProfile = {
      id: session.user.id,
      display_name: session.user.email,
      phone: null,
      role: "farmer_pending",
    } satisfies UserProfile;

    const hydrateProfile = async () => {
      setProfileLoadState("loading");

      try {
        const currentProfile = await getCurrentProfile(session.user!.id);

        if (cancelled) {
          return;
        }

        setProfile(currentProfile ?? fallbackProfile);
      } catch (error) {
        logSupabaseError("profiles", error);

        if (!cancelled) {
          setProfile(fallbackProfile);
          setProfileLoadError("Das Profil konnte gerade nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setProfileLoadState("ready");
        }
      }
    };

    const hydrateRequests = async () => {
      setRequestsLoadState("loading");

      try {
        const myRequests = await listMyVerificationRequests(session.user!.id);

        if (!cancelled) {
          setRequests(myRequests);
        }
      } catch (error) {
        logSupabaseError("verification_requests", error);

        if (!cancelled) {
          setRequests([]);
          setRequestsError("Deine Anträge konnten gerade nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setRequestsLoadState("ready");
        }
      }
    };

    const hydrateAdminRequests = async () => {
      if (profile?.role !== "admin") {
        setAdminRequests([]);
        setAdminRequestsLoadState("idle");
        return;
      }

      setAdminRequestsLoadState("loading");

      try {
        const openRequests = await listOpenVerificationRequests();

        if (!cancelled) {
          setAdminRequests(openRequests);
        }
      } catch (error) {
        logSupabaseError("admin verification_requests", error);

        if (!cancelled) {
          setAdminRequests([]);
          setAdminRequestsError("Die offenen Anträge konnten gerade nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setAdminRequestsLoadState("ready");
        }
      }
    };

    const hydrateDashboard = async () => {
      setDashboardLoadState("loading");

      try {
        const dashboardData = await getFarmerDashboardData(session.user!.id);

        if (!cancelled) {
          setDashboard(dashboardData);
        }
      } catch (error) {
        logSupabaseError("farm_owners / products / opening_hours", error);

        if (!cancelled) {
          setDashboard(null);
          setDashboardError("Dein Hofbereich konnte gerade nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setDashboardLoadState("ready");
        }
      }
    };

    setProfileMessage(null);
    setProfileError(null);
    setProfileLoadError(null);
    setRequestsError(null);
    setAdminRequestsError(null);
    setAdminMessage(null);
    setDashboardError(null);
    void hydrateProfile();
    void hydrateRequests();
    void hydrateAdminRequests();
    void hydrateDashboard();

    return () => {
      cancelled = true;
    };
  }, [session.user]);

  useEffect(() => {
    if (!session.user) {
      return;
    }

    let cancelled = false;

    const hydrateAdminRequests = async () => {
      if (profile?.role !== "admin") {
        setAdminRequests([]);
        setAdminRequestsLoadState("idle");
        return;
      }

      setAdminRequestsLoadState("loading");

      try {
        const openRequests = await listOpenVerificationRequests();

        if (!cancelled) {
          setAdminRequests(openRequests);
        }
      } catch (error) {
        logSupabaseError("admin verification_requests", error);

        if (!cancelled) {
          setAdminRequests([]);
          setAdminRequestsError("Die offenen Anträge konnten gerade nicht geladen werden.");
        }
      } finally {
        if (!cancelled) {
          setAdminRequestsLoadState("ready");
        }
      }
    };

    setAdminRequestsError(null);
    void hydrateAdminRequests();

    return () => {
      cancelled = true;
    };
  }, [session.user, profile?.role]);

  useEffect(() => {
    if (session.user?.email) {
      setAuthEmail((current) => current || session.user!.email || "");
      setClaimForm((current) => ({
        ...current,
        email: current.email || session.user!.email || "",
      }));
    }
  }, [session.user?.email]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }

    setNewProductForms((current) => {
      const next = { ...current };

      for (const ownership of dashboard.ownedFarms) {
        if (ownership.farm && !next[ownership.farm.id]) {
          next[ownership.farm.id] = emptyProductDraft();
        }
      }

      return next;
    });

    setNewOpeningForms((current) => {
      const next = { ...current };

      for (const ownership of dashboard.ownedFarms) {
        if (ownership.farm && !next[ownership.farm.id]) {
          next[ownership.farm.id] = emptyOpeningHourDraft();
        }
      }

      return next;
    });
  }, [dashboard]);

  const visibleClaimFarms = useMemo(() => {
    const searchTerm = normalizeText(claimSearch);

    const farms = publicFarms.filter((farm) => {
      if (!searchTerm) {
        return true;
      }

      const searchableText = [
        farm.name,
        farm.region,
        farm.locationText,
        farm.address,
        farm.products.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });

    return farms.slice(0, CLAIM_FARM_RESULTS_LIMIT);
  }, [claimSearch, publicFarms]);

  const selectedClaimFarm = useMemo(
    () => publicFarms.find((farm) => farm.id === selectedClaimFarmId) ?? null,
    [publicFarms, selectedClaimFarmId],
  );

  const hasPendingClaimRequest = useMemo(() => {
    if (!selectedClaimFarm) {
      return false;
    }

    return requests.some(
      (request) =>
        request.request_type === "claim_existing_farm" &&
        request.farm_id === selectedClaimFarm.databaseId &&
        request.status === "pending",
    );
  }, [requests, selectedClaimFarm]);

  const hasPendingRegisterRequest = useMemo(
    () => requests.some((request) => request.request_type === "register_farm" && request.status === "pending"),
    [requests],
  );

  const verifiedOwnedFarms = dashboard?.ownedFarms.filter((ownership) => ownership.farm) ?? [];

  const refreshRequests = async (profileId: string) => {
    const myRequests = await listMyVerificationRequests(profileId);
    setRequests(myRequests);
  };

  const refreshDashboard = async (profileId: string) => {
    const dashboardData = await getFarmerDashboardData(profileId);
    setDashboard(dashboardData);
  };

  const refreshAdminRequests = async () => {
    const openRequests = await listOpenVerificationRequests();
    setAdminRequests(openRequests);
  };

  const visibleAdminRequests = useMemo(() => {
    if (adminFilter === "all") {
      return adminRequests;
    }

    return adminRequests.filter((request) => request.request_type === adminFilter);
  }, [adminFilter, adminRequests]);

  const pendingAdminRequest = useMemo(
    () => adminRequests.find((request) => request.id === adminAction?.requestId) ?? null,
    [adminAction?.requestId, adminRequests],
  );

  const openAdminActionDialog = (requestId: string, type: "approve" | "reject") => {
    setAdminAction({ requestId, type });
  };

  const closeAdminActionDialog = () => {
    if (adminActionLoadingId) {
      return;
    }

    setAdminAction(null);
  };

  const executeAdminAction = async () => {
    if (!pendingAdminRequest || !adminAction) {
      return;
    }

    const adminNote = (adminNotes[pendingAdminRequest.id] ?? pendingAdminRequest.admin_note ?? "").trim() || null;

    if (adminAction.type === "approve" && pendingAdminRequest.request_type !== "claim_existing_farm") {
      setAdminMessage("Freigabe neuer Höfe folgt im nächsten Schritt.");
      setAdminAction(null);
      return;
    }

    setAdminActionLoadingId(pendingAdminRequest.id);
    setAdminRequestsError(null);
    setAdminMessage(null);

    try {
      if (adminAction.type === "approve") {
        await approveExistingFarmClaim(pendingAdminRequest.id, adminNote);
        setAdminMessage(
          `Antrag für ${getAdminApplicantName(pendingAdminRequest)} zu ${getAdminRequestFarmName(pendingAdminRequest)} wurde freigegeben.`,
        );
      } else {
        await rejectVerificationRequest(pendingAdminRequest.id, adminNote);
        setAdminMessage(`Antrag für ${getAdminApplicantName(pendingAdminRequest)} wurde abgelehnt.`);
      }

      await refreshAdminRequests();
    } catch (error) {
      logSupabaseError("admin verification_requests", error, ["p_request_id", "p_admin_note"]);
      setAdminRequestsError(friendlyErrorMessage(error));
    } finally {
      setAdminActionLoadingId(null);
      setAdminAction(null);
    }
  };

  const handleAuthAction = async () => {
    if (!authEmail.trim()) {
      setAuthError("Bitte gib eine E-Mail-Adresse an.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      if (authMode === "signin") {
        const { error } = await signInWithEmailPassword(authEmail.trim(), authPassword);

        if (error) {
          throw error;
        }

        setAuthMessage("Anmeldung erfolgreich.");
      } else if (authMode === "signup") {
        const { error } = await signUpWithEmailPassword(authEmail.trim(), authPassword);

        if (error) {
          throw error;
        }

        setAuthMessage(
          "Registrierung erfolgreich. Bitte prüfe jetzt deine E-Mails und bestätige dein Konto.",
        );
      } else {
        const { error } = await sendPasswordReset(authEmail.trim());

        if (error) {
          throw error;
        }

        setAuthMessage("Falls die Adresse existiert, wurde ein Link zum Zurücksetzen versendet.");
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Auth-Action fehlgeschlagen", error);
      }

      setAuthError(friendlyErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthMessage(null);

    try {
      const { error } = await signOut();

      if (error) {
        throw error;
      }

      setSession({ user: null });
      setProfile(null);
      setRequests([]);
      setDashboard(null);
      setDashboardLoadState("idle");
      setClaimForm(emptyClaimForm());
      setNewFarmForm(emptyNewFarmForm());
      setAdminRequests([]);
      setAdminRequestsLoadState("idle");
      setAdminRequestsError(null);
      setAdminMessage(null);
      setAdminAction(null);
      setAdminActionLoadingId(null);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Abmelden fehlgeschlagen", error);
      }

      setAuthError("Abmeldung war gerade nicht möglich.");
    } finally {
      setAuthLoading(false);
    }
  };

  const submitClaimRequest = async () => {
    if (!session.user || !selectedClaimFarm) {
      setClaimError("Bitte wähle zuerst einen Hof aus.");
      return;
    }

    if (!selectedClaimFarm.databaseId) {
      setClaimError("Der ausgewählte Hof konnte nicht mit der Datenbank verknüpft werden.");
      return;
    }

    if (claimLoading) {
      return;
    }

    if (hasPendingClaimRequest) {
      setClaimError("Für diesen Hof ist bereits ein Antrag in Prüfung.");
      return;
    }

    if (!claimForm.message.trim()) {
      setClaimError("Bitte gib eine kurze Nachricht an.");
      return;
    }

    setClaimLoading(true);
    setClaimError(null);
    setClaimMessage(null);

    try {
      await createClaimExistingFarmRequest({
        profileId: session.user.id,
        farmId: selectedClaimFarm.databaseId,
        requestedChanges: {
          message: claimForm.message.trim(),
          phone: claimForm.phone.trim() || null,
          email: claimForm.email.trim() || session.user.email,
        },
        currentSnapshot: getClaimFarmSnapshot(selectedClaimFarm),
      });

      try {
        await refreshRequests(session.user.id);
      } catch (refreshError) {
        logSupabaseError("verification_requests", refreshError);
      }

      setClaimMessage("Dein Antrag wurde an die Prüfung übergeben. Status: In Prüfung.");
      setClaimForm({
        message: "",
        phone: "",
        email: session.user.email ?? "",
      });
    } catch (error) {
      logSupabaseError("verification_requests", error, [
        "profile_id",
        "requested_by_profile_id",
        "farm_id",
        "request_type",
        "requested_changes",
        "current_snapshot",
      ]);

      setClaimError(friendlyErrorMessage(error));
    } finally {
      setClaimLoading(false);
    }
  };

  const submitNewFarmRequest = async () => {
    if (!session.user) {
      setNewFarmError("Bitte melde dich zuerst an.");
      return;
    }

    if (newFarmLoading) {
      return;
    }

    if (hasPendingRegisterRequest) {
      setNewFarmError("Für die Meldung eines neuen Hofes ist bereits ein Antrag in Prüfung.");
      return;
    }

    if (!newFarmForm.name.trim() || !newFarmForm.city.trim()) {
      setNewFarmError("Bitte fülle mindestens Hofname und Ort aus.");
      return;
    }

    if (!newFarmForm.confirmed) {
      setNewFarmError("Bitte bestätige die Berechtigung zur Verwaltung des Hofes.");
      return;
    }

    setNewFarmLoading(true);
    setNewFarmError(null);
    setNewFarmMessage(null);

    try {
      await createRegisterFarmRequest({
        profileId: session.user.id,
        requestedChanges: {
          name: newFarmForm.name.trim(),
          contact_person: newFarmForm.contactPerson.trim(),
          street: newFarmForm.street.trim(),
          postal_code: newFarmForm.postalCode.trim(),
          city: newFarmForm.city.trim(),
          region: newFarmForm.region.trim(),
          phone: newFarmForm.phone.trim(),
          whatsapp: newFarmForm.whatsapp.trim(),
          email: newFarmForm.email.trim(),
          website: newFarmForm.website.trim(),
          description: newFarmForm.description.trim(),
          products: newFarmForm.products.trim(),
          opening_hours: newFarmForm.openingHours.trim(),
          delivery: newFarmForm.delivery,
          message: newFarmForm.message.trim(),
          confirmed: newFarmForm.confirmed,
        },
      });

      try {
        await refreshRequests(session.user.id);
      } catch (refreshError) {
        logSupabaseError("verification_requests", refreshError);
      }

      setNewFarmMessage("Deine Meldung wurde zur Prüfung eingereicht.");
      setNewFarmForm(emptyNewFarmForm());
    } catch (error) {
      logSupabaseError("verification_requests", error, [
        "profile_id",
        "requested_by_profile_id",
        "farm_id",
        "request_type",
        "requested_changes",
        "current_snapshot",
      ]);

      setNewFarmError(friendlyErrorMessage(error));
    } finally {
      setNewFarmLoading(false);
    }
  };

  const saveFarmBasics = async (farmId: string) => {
    if (!dashboard) {
      return;
    }

    const farm = dashboard.ownedFarms.find((ownership) => ownership.farm?.id === farmId)?.farm;

    if (!farm) {
      return;
    }

    setFarmSaveState((current) => ({ ...current, [farmId]: true }));
    setProfileMessage(null);
    setProfileError(null);

    try {
      await updateFarmBasics(farmId, {
        description: farm.description,
        phone: farm.phone,
        whatsapp: farm.whatsapp,
        email: farm.email,
        website: farm.website,
        delivery: farm.delivery,
        deliveryRadiusKm: readNumber(farm.delivery_radius_km) ?? null,
        selfService: readBoolean(farm.self_service),
      });

      await refreshDashboard(session.user!.id);
      setProfileMessage("Grunddaten wurden gespeichert.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Grunddaten konnten nicht gespeichert werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setFarmSaveState((current) => ({ ...current, [farmId]: false }));
    }
  };

  const saveProduct = async (product: FarmerProductRecord) => {
    setProductSaveState((current) => ({ ...current, [product.id]: true }));
    setProfileMessage(null);
    setProfileError(null);

    try {
      await updateProduct(product.id, {
        name: product.name.trim(),
        category: product.category?.trim() || null,
        price: readNumber(product.price) ?? null,
        unit: product.unit?.trim() || null,
        description: product.description?.trim() || null,
        availability: product.availability?.trim() || null,
        published: product.published,
        sort_order: product.sort_order,
      });

      await refreshDashboard(session.user!.id);
      setProfileMessage("Produkt gespeichert.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Produkt konnte nicht gespeichert werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setProductSaveState((current) => ({ ...current, [product.id]: false }));
    }
  };

  const addProduct = async (farmId: string) => {
    const draft = newProductForms[farmId] ?? emptyProductDraft();

    if (!draft.name.trim()) {
      setProfileError("Bitte gib einen Produktnamen an.");
      return;
    }

    const existing = dashboard?.productsByFarmId[farmId] ?? [];
    const nextSortOrder = existing.length > 0 ? Math.max(...existing.map((product) => product.sort_order)) + 1 : 0;

    setProductSaveState((current) => ({ ...current, [`new-${farmId}`]: true }));
    setProfileError(null);
    setProfileMessage(null);

    try {
      await createProduct({
        farm_id: farmId,
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        price: readNumber(draft.price),
        unit: draft.unit.trim() || null,
        description: draft.description.trim() || null,
        availability: draft.availability.trim() || null,
        published: draft.published,
        sort_order: nextSortOrder,
      });

      await refreshDashboard(session.user!.id);
      setNewProductForms((current) => ({ ...current, [farmId]: emptyProductDraft() }));
      setProfileMessage("Produkt hinzugefügt.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Produkt konnte nicht hinzugefügt werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setProductSaveState((current) => ({ ...current, [`new-${farmId}`]: false }));
    }
  };

  const removeProduct = async (productId: string) => {
    setProductSaveState((current) => ({ ...current, [productId]: true }));
    setProfileError(null);
    setProfileMessage(null);

    try {
      await deleteProduct(productId);

      await refreshDashboard(session.user!.id);
      setProfileMessage("Produkt gelöscht.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Produkt konnte nicht gelöscht werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setProductSaveState((current) => ({ ...current, [productId]: false }));
    }
  };

  const saveOpeningHour = async (openingHour: FarmerOpeningHourRecord) => {
    setOpeningSaveState((current) => ({ ...current, [openingHour.id]: true }));
    setProfileError(null);
    setProfileMessage(null);

    try {
      await updateOpeningHour(openingHour.id, {
        day_of_week: Number(openingHour.day_of_week),
        opens_at: openingHour.opens_at,
        closes_at: openingHour.closes_at,
        note: openingHour.note?.trim() || null,
        sort_order: openingHour.sort_order,
      });

      await refreshDashboard(session.user!.id);
      setProfileMessage("Öffnungszeit gespeichert.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Öffnungszeit konnte nicht gespeichert werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setOpeningSaveState((current) => ({ ...current, [openingHour.id]: false }));
    }
  };

  const addOpeningHour = async (farmId: string) => {
    const draft = newOpeningForms[farmId] ?? emptyOpeningHourDraft();
    const dayOfWeek = Number(draft.dayOfWeek);

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      setProfileError("Bitte wähle einen gültigen Wochentag.");
      return;
    }

    const existing = dashboard?.openingHoursByFarmId[farmId] ?? [];
    const nextSortOrder = existing.length > 0 ? Math.max(...existing.map((entry) => entry.sort_order)) + 1 : 0;

    setOpeningSaveState((current) => ({ ...current, [`new-${farmId}`]: true }));
    setProfileError(null);
    setProfileMessage(null);

    try {
      await createOpeningHour({
        farm_id: farmId,
        day_of_week: dayOfWeek,
        opens_at: draft.opensAt || null,
        closes_at: draft.closesAt || null,
        note: draft.note.trim() || null,
        sort_order: Number.isFinite(Number(draft.sortOrder)) ? Number(draft.sortOrder) : nextSortOrder,
      });

      await refreshDashboard(session.user!.id);
      setNewOpeningForms((current) => ({ ...current, [farmId]: emptyOpeningHourDraft() }));
      setProfileMessage("Öffnungszeit hinzugefügt.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Öffnungszeit konnte nicht hinzugefügt werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setOpeningSaveState((current) => ({ ...current, [`new-${farmId}`]: false }));
    }
  };

  const removeOpeningHour = async (openingHourId: string) => {
    setOpeningSaveState((current) => ({ ...current, [openingHourId]: true }));
    setProfileError(null);
    setProfileMessage(null);

    try {
      await deleteOpeningHour(openingHourId);

      await refreshDashboard(session.user!.id);
      setProfileMessage("Öffnungszeit gelöscht.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Öffnungszeit konnte nicht gelöscht werden", error);
      }

      setProfileError(friendlyErrorMessage(error));
    } finally {
      setOpeningSaveState((current) => ({ ...current, [openingHourId]: false }));
    }
  };

  const renderRequests = () => (
    <section className="profile-block">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Anträge</span>
          <h3>Meine Anträge</h3>
        </div>
      </div>

      {requestsLoadState === "loading" ? (
        <div className="empty-state">Anträge werden geladen…</div>
      ) : requests.length === 0 ? (
        <div className="empty-state">Noch keine Anträge vorhanden.</div>
      ) : (
        <div className="request-list">
          {requests.map((request) => (
            <article className="request-card" key={request.id}>
              <div className="request-card-header">
                <div>
                  <strong>{requestTypeLabel(request.request_type)}</strong>
                  <p>{getRequestFarmName(request)}</p>
                </div>

                <span className={`badge request-status ${request.status}`}>
                  {requestStatusLabel(request.status)}
                </span>
              </div>

              <p className="request-date">{formatDate(request.created_at)}</p>

              {request.admin_note && (
                <p className="request-note">
                  <strong>Adminnotiz:</strong> {request.admin_note}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {requestsLoadState === "ready" && requestsError && <p className="form-error">{requestsError}</p>}
    </section>
  );

  const renderAuthForm = () => (
    <section className="profile-block auth-block">
      <div className="auth-switcher">
        <button className={authMode === "signin" ? "chip active" : "chip"} onClick={() => setAuthMode("signin")}>
          Anmelden
        </button>
        <button className={authMode === "signup" ? "chip active" : "chip"} onClick={() => setAuthMode("signup")}>
          Registrieren
        </button>
        <button className={authMode === "reset" ? "chip active" : "chip"} onClick={() => setAuthMode("reset")}>
          Passwort vergessen
        </button>
      </div>

      <div className="auth-grid">
        <label className="field">
          <span>E-Mail</span>
          <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
        </label>

        {authMode !== "reset" && (
          <label className="field">
            <span>Passwort</span>
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            />
          </label>
        )}
      </div>

      {authError && <p className="form-error">{authError}</p>}
      {authMessage && <p className="form-success">{authMessage}</p>}

      <button className="primary-button" onClick={handleAuthAction} disabled={authLoading}>
        {authLoading
          ? "Bitte warten…"
          : authMode === "signin"
            ? "Anmelden"
            : authMode === "signup"
              ? "Registrieren"
              : "Link senden"}
      </button>
    </section>
  );

  const renderClaimExistingFarm = () => (
    <section className="profile-block">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Bestehenden Hof beanspruchen</span>
          <h3>Hof suchen und Antrag senden</h3>
        </div>
      </div>

      <label className="field">
        <span>Hof suchen</span>
        <input
          type="search"
          value={claimSearch}
          onChange={(event) => setClaimSearch(event.target.value)}
          placeholder="Hofname, Ort oder Produkt"
        />
      </label>

      <div className="claim-results">
        {visibleClaimFarms.map((farm) => (
          <button
            key={farm.id}
            className={selectedClaimFarmId === farm.id ? "claim-result active" : "claim-result"}
            onClick={() => setSelectedClaimFarmId(farm.id)}
          >
            <strong>{farm.name}</strong>
            <span>{farm.locationText ?? farm.address ?? farm.region ?? "Ort nicht angegeben"}</span>
          </button>
        ))}
      </div>

      {publicFarmsError && <p className="form-error">{publicFarmsError}</p>}

      {selectedClaimFarm && (
        <div className="detail-card claim-preview">
          <h4>{selectedClaimFarm.name}</h4>
          <p>{selectedClaimFarm.locationText ?? selectedClaimFarm.address ?? selectedClaimFarm.region}</p>
          <p>
            <strong>Kontakt:</strong>{" "}
            {[selectedClaimFarm.phone, selectedClaimFarm.whatsapp, selectedClaimFarm.email]
              .filter(Boolean)
              .join(" · ") || "Keine Angabe"}
          </p>
        </div>
      )}

      <div className="auth-grid">
        <label className="field field-wide">
          <span>Nachricht</span>
          <textarea
            rows={4}
            value={claimForm.message}
            onChange={(event) => setClaimForm((current) => ({ ...current, message: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Telefon optional</span>
          <input
            type="tel"
            value={claimForm.phone}
            onChange={(event) => setClaimForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            value={claimForm.email}
            onChange={(event) => setClaimForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>
      </div>

      {claimError && <p className="form-error">{claimError}</p>}
      {claimMessage && <p className="form-success">{claimMessage}</p>}

      <button
        className="primary-button"
        onClick={submitClaimRequest}
        disabled={claimLoading || !selectedClaimFarm || hasPendingClaimRequest}
      >
        {claimLoading ? "Bitte warten…" : "Antrag absenden"}
      </button>
    </section>
  );

  const renderNewFarmForm = () => (
    <section className="profile-block">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Neuen Hof melden</span>
          <h3>Verifizierungsantrag anlegen</h3>
        </div>
      </div>

      <div className="auth-grid">
        <label className="field">
          <span>Hofname</span>
          <input
            value={newFarmForm.name}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Ansprechpartner</span>
          <input
            value={newFarmForm.contactPerson}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, contactPerson: event.target.value }))}
          />
        </label>

        <label className="field field-wide">
          <span>Straße</span>
          <input
            value={newFarmForm.street}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, street: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>PLZ</span>
          <input
            value={newFarmForm.postalCode}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, postalCode: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Ort</span>
          <input
            value={newFarmForm.city}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, city: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Region</span>
          <input
            value={newFarmForm.region}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, region: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Telefon</span>
          <input
            value={newFarmForm.phone}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>WhatsApp</span>
          <input
            value={newFarmForm.whatsapp}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, whatsapp: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            value={newFarmForm.email}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Webseite</span>
          <input
            value={newFarmForm.website}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, website: event.target.value }))}
          />
        </label>

        <label className="field field-wide">
          <span>Beschreibung</span>
          <textarea
            rows={4}
            value={newFarmForm.description}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, description: event.target.value }))}
          />
        </label>

        <label className="field field-wide">
          <span>Produkte als Freitext</span>
          <textarea
            rows={3}
            value={newFarmForm.products}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, products: event.target.value }))}
          />
        </label>

        <label className="field field-wide">
          <span>Öffnungszeiten als Freitext</span>
          <textarea
            rows={3}
            value={newFarmForm.openingHours}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, openingHours: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Lieferung</span>
          <select
            value={newFarmForm.delivery ? "yes" : "no"}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, delivery: event.target.value === "yes" }))}
          >
            <option value="no">Nein</option>
            <option value="yes">Ja</option>
          </select>
        </label>

        <label className="field field-wide">
          <span>Nachricht</span>
          <textarea
            rows={4}
            value={newFarmForm.message}
            onChange={(event) => setNewFarmForm((current) => ({ ...current, message: event.target.value }))}
          />
        </label>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={newFarmForm.confirmed}
          onChange={(event) => setNewFarmForm((current) => ({ ...current, confirmed: event.target.checked }))}
        />
        <span>Ich bestätige, dass ich zur Verwaltung dieses Hofes berechtigt bin.</span>
      </label>

      {newFarmError && <p className="form-error">{newFarmError}</p>}
      {newFarmMessage && <p className="form-success">{newFarmMessage}</p>}

      <button className="primary-button" onClick={submitNewFarmRequest} disabled={newFarmLoading || hasPendingRegisterRequest}>
        {newFarmLoading ? "Bitte warten…" : "Antrag senden"}
      </button>
    </section>
  );

  const renderVerifiedDashboard = () => {
    if (dashboardLoadState === "loading") {
      return <div className="empty-state">Farmer-Dashboard wird geladen…</div>;
    }

    if (dashboardLoadState === "ready" && !dashboard) {
      return (
        <section className="profile-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Dein Hof</span>
              <h3>Hofbereich nicht verfügbar</h3>
            </div>
          </div>

          <p>Deine Hofdaten konnten gerade nicht geladen werden. Die restlichen Bereiche bleiben verfügbar.</p>
          {dashboardError && <p className="form-error">{dashboardError}</p>}
        </section>
      );
    }

    if (!dashboard || verifiedOwnedFarms.length === 0) {
      return (
        <section className="profile-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Dein Hof</span>
              <h3>Keine aktive Zuordnung</h3>
            </div>
          </div>

          <p>Dein Konto ist verifiziert, aber noch keinem aktiven Hof zugeordnet.</p>
        </section>
      );
    }

    return (
      <div className="dashboard-list">
        {verifiedOwnedFarms.map((ownership) => {
          const farm = ownership.farm;

          if (!farm) {
            return null;
          }

          const products = dashboard.productsByFarmId[farm.id] ?? [];
          const openingHours = dashboard.openingHoursByFarmId[farm.id] ?? [];

          return (
            <section className="profile-block dashboard-card" key={farm.id}>
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">Dein Hof</span>
                  <h3>{farm.name}</h3>
                </div>

              </div>

              <div className="critical-note">
                <strong>Änderung beantragen</strong>
                <p>
                  Hofname, Adresse, PLZ, Ort, Koordinaten, Eigentümerzuordnung, published und
                  approval_state sind hier nicht direkt änderbar.
                </p>
              </div>

              <div className="read-only-grid">
                <div>
                  <span>Hofname</span>
                  <strong>{farm.name}</strong>
                </div>
                <div>
                  <span>Adresse</span>
                  <strong>{farm.address ?? "Nicht angegeben"}</strong>
                </div>
                <div>
                  <span>PLZ</span>
                  <strong>{farm.postal_code ?? "Nicht angegeben"}</strong>
                </div>
                <div>
                  <span>Ort</span>
                  <strong>{farm.city ?? "Nicht angegeben"}</strong>
                </div>
                <div>
                  <span>Koordinaten</span>
                  <strong>
                    {farm.latitude && farm.longitude
                      ? `${farm.latitude}, ${farm.longitude}`
                      : "Nicht angegeben"}
                  </strong>
                </div>
                <div>
                  <span>Eigentümerzuordnung</span>
                  <strong>{ownership.status}</strong>
                </div>
                <div>
                  <span>published</span>
                  <strong>{farm.published ? "Ja" : "Nein"}</strong>
                </div>
                <div>
                  <span>approval_state</span>
                  <strong>{farm.approval_state}</strong>
                </div>
              </div>

              <div className="auth-grid">
                <label className="field field-wide">
                  <span>Beschreibung</span>
                  <textarea
                    rows={4}
                    value={farm.description ?? ""}
                    onChange={(event) =>
                      setDashboard((current) => updateOwnedFarmDraft(current, farm.id, { description: event.target.value }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Telefon</span>
                  <input
                    value={farm.phone ?? ""}
                    onChange={(event) =>
                      setDashboard((current) => updateOwnedFarmDraft(current, farm.id, { phone: event.target.value }))
                    }
                  />
                </label>

                <label className="field">
                  <span>WhatsApp</span>
                  <input
                    value={farm.whatsapp ?? ""}
                    onChange={(event) =>
                      setDashboard((current) => updateOwnedFarmDraft(current, farm.id, { whatsapp: event.target.value }))
                    }
                  />
                </label>

                <label className="field">
                  <span>E-Mail</span>
                  <input
                    type="email"
                    value={farm.email ?? ""}
                    onChange={(event) =>
                      setDashboard((current) => updateOwnedFarmDraft(current, farm.id, { email: event.target.value }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Webseite</span>
                  <input
                    value={farm.website ?? ""}
                    onChange={(event) =>
                      setDashboard((current) => updateOwnedFarmDraft(current, farm.id, { website: event.target.value }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Lieferung</span>
                  <select
                    value={farm.delivery ? "yes" : "no"}
                    onChange={(event) =>
                      setDashboard((current) =>
                        updateOwnedFarmDraft(current, farm.id, { delivery: event.target.value === "yes" }),
                      )
                    }
                  >
                    <option value="no">Nein</option>
                    <option value="yes">Ja</option>
                  </select>
                </label>

                <label className="field">
                  <span>Liefer-Radius</span>
                  <input
                    type="number"
                    value={farm.delivery_radius_km ?? ""}
                    onChange={(event) =>
                      setDashboard((current) =>
                        updateOwnedFarmDraft(current, farm.id, {
                          delivery_radius_km: event.target.value ? Number(event.target.value) : null,
                        }),
                      )
                    }
                  />
                </label>

                <label className="checkbox-row inline-checkbox">
                  <input
                    type="checkbox"
                    checked={farm.self_service}
                    onChange={(event) =>
                      setDashboard((current) =>
                        updateOwnedFarmDraft(current, farm.id, { self_service: event.target.checked }),
                      )
                    }
                  />
                  <span>Selbstbedienung</span>
                </label>
              </div>

              <button className="primary-button" onClick={() => saveFarmBasics(farm.id)} disabled={farmSaveState[farm.id]}>
                {farmSaveState[farm.id] ? "Bitte warten…" : "Grunddaten speichern"}
              </button>

              <div className="subsection">
                <div className="section-heading compact-heading">
                  <div>
                    <span className="eyebrow">Produkte</span>
                    <h4>Liste und Bearbeitung</h4>
                  </div>
                </div>

                <div className="editable-list">
                  {products.length === 0 ? (
                    <div className="empty-state">Noch keine Produkte angelegt.</div>
                  ) : (
                    products.map((product) => (
                      <article className="editable-item" key={product.id}>
                        <div className="auth-grid">
                          <label className="field">
                            <span>Name</span>
                            <input
                              value={product.name}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { name: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="field">
                            <span>Kategorie</span>
                            <input
                              value={product.category ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { category: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="field">
                            <span>Preis</span>
                            <input
                              type="number"
                              value={product.price ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, {
                                    price: event.target.value ? Number(event.target.value) : null,
                                  }),
                                )
                              }
                            />
                          </label>

                          <label className="field">
                            <span>Einheit</span>
                            <input
                              value={product.unit ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { unit: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="field field-wide">
                            <span>Beschreibung</span>
                            <textarea
                              rows={3}
                              value={product.description ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { description: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="field field-wide">
                            <span>Verfügbarkeit</span>
                            <input
                              value={product.availability ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { availability: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="checkbox-row inline-checkbox">
                            <input
                              type="checkbox"
                              checked={product.published}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateProductDraft(current, product.id, { published: event.target.checked }),
                                )
                              }
                            />
                            <span>Veröffentlicht</span>
                          </label>
                        </div>

                        <div className="action-row">
                          <button className="secondary-button" onClick={() => saveProduct(product)} disabled={productSaveState[product.id]}>
                            {productSaveState[product.id] ? "Bitte warten…" : "Speichern"}
                          </button>
                          <button className="text-button" onClick={() => removeProduct(product.id)} disabled={productSaveState[product.id]}>
                            Löschen
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <div className="subsection form-card">
                  <h4>Produkt hinzufügen</h4>
                  <div className="auth-grid">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={newProductForms[farm.id]?.name ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              name: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Kategorie</span>
                      <input
                        value={newProductForms[farm.id]?.category ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              category: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Preis</span>
                      <input
                        type="number"
                        value={newProductForms[farm.id]?.price ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              price: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Einheit</span>
                      <input
                        value={newProductForms[farm.id]?.unit ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              unit: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field field-wide">
                      <span>Beschreibung</span>
                      <textarea
                        rows={3}
                        value={newProductForms[farm.id]?.description ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              description: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field field-wide">
                      <span>Verfügbarkeit</span>
                      <input
                        value={newProductForms[farm.id]?.availability ?? ""}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              availability: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="checkbox-row inline-checkbox">
                      <input
                        type="checkbox"
                        checked={newProductForms[farm.id]?.published ?? true}
                        onChange={(event) =>
                          setNewProductForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyProductDraft()),
                              published: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>Veröffentlicht</span>
                    </label>
                  </div>

                  <button className="secondary-button" onClick={() => addProduct(farm.id)} disabled={productSaveState[`new-${farm.id}`]}>
                    {productSaveState[`new-${farm.id}`] ? "Bitte warten…" : "Produkt hinzufügen"}
                  </button>
                </div>
              </div>

              <div className="subsection">
                <div className="section-heading compact-heading">
                  <div>
                    <span className="eyebrow">Öffnungszeiten</span>
                    <h4>Mehrere Zeitfenster pro Tag</h4>
                  </div>
                </div>

                <div className="editable-list">
                  {openingHours.length === 0 ? (
                    <div className="empty-state">Noch keine Öffnungszeiten angelegt.</div>
                  ) : (
                    openingHours.map((openingHour) => (
                      <article className="editable-item" key={openingHour.id}>
                        <div className="auth-grid">
                          <label className="field">
                            <span>Tag</span>
                            <select
                              value={openingHour.day_of_week}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateOpeningHourDraft(current, openingHour.id, {
                                    day_of_week: Number(event.target.value),
                                  }),
                                )
                              }
                            >
                              <option value="0">So</option>
                              <option value="1">Mo</option>
                              <option value="2">Di</option>
                              <option value="3">Mi</option>
                              <option value="4">Do</option>
                              <option value="5">Fr</option>
                              <option value="6">Sa</option>
                            </select>
                          </label>

                          <label className="field">
                            <span>Von</span>
                            <input
                              type="time"
                              value={openingHour.opens_at ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateOpeningHourDraft(current, openingHour.id, {
                                    opens_at: event.target.value || null,
                                  }),
                                )
                              }
                            />
                          </label>

                          <label className="field">
                            <span>Bis</span>
                            <input
                              type="time"
                              value={openingHour.closes_at ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateOpeningHourDraft(current, openingHour.id, {
                                    closes_at: event.target.value || null,
                                  }),
                                )
                              }
                            />
                          </label>

                          <label className="field field-wide">
                            <span>Hinweis</span>
                            <input
                              value={openingHour.note ?? ""}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateOpeningHourDraft(current, openingHour.id, { note: event.target.value }),
                                )
                              }
                            />
                          </label>

                          <label className="field">
                            <span>Reihenfolge</span>
                            <input
                              type="number"
                              value={openingHour.sort_order}
                              onChange={(event) =>
                                setDashboard((current) =>
                                  updateOpeningHourDraft(current, openingHour.id, {
                                    sort_order: Number(event.target.value),
                                  }),
                                )
                              }
                            />
                          </label>
                        </div>

                        <div className="action-row">
                          <button className="secondary-button" onClick={() => saveOpeningHour(openingHour)} disabled={openingSaveState[openingHour.id]}>
                            {openingSaveState[openingHour.id] ? "Bitte warten…" : "Speichern"}
                          </button>
                          <button className="text-button" onClick={() => removeOpeningHour(openingHour.id)} disabled={openingSaveState[openingHour.id]}>
                            Löschen
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <div className="subsection form-card">
                  <h4>Zeitraum hinzufügen</h4>
                  <div className="auth-grid">
                    <label className="field">
                      <span>Tag</span>
                      <select
                        value={newOpeningForms[farm.id]?.dayOfWeek ?? "1"}
                        onChange={(event) =>
                          setNewOpeningForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyOpeningHourDraft()),
                              dayOfWeek: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="0">So</option>
                        <option value="1">Mo</option>
                        <option value="2">Di</option>
                        <option value="3">Mi</option>
                        <option value="4">Do</option>
                        <option value="5">Fr</option>
                        <option value="6">Sa</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Von</span>
                      <input
                        type="time"
                        value={newOpeningForms[farm.id]?.opensAt ?? "08:00"}
                        onChange={(event) =>
                          setNewOpeningForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyOpeningHourDraft()),
                              opensAt: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Bis</span>
                      <input
                        type="time"
                        value={newOpeningForms[farm.id]?.closesAt ?? "12:00"}
                        onChange={(event) =>
                          setNewOpeningForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyOpeningHourDraft()),
                              closesAt: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field field-wide">
                      <span>Hinweis</span>
                      <input
                        value={newOpeningForms[farm.id]?.note ?? ""}
                        onChange={(event) =>
                          setNewOpeningForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyOpeningHourDraft()),
                              note: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Reihenfolge</span>
                      <input
                        type="number"
                        value={newOpeningForms[farm.id]?.sortOrder ?? "0"}
                        onChange={(event) =>
                          setNewOpeningForms((current) => ({
                            ...current,
                            [farm.id]: {
                              ...(current[farm.id] ?? emptyOpeningHourDraft()),
                              sortOrder: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>

                  <button className="secondary-button" onClick={() => addOpeningHour(farm.id)} disabled={openingSaveState[`new-${farm.id}`]}>
                    {openingSaveState[`new-${farm.id}`] ? "Bitte warten…" : "Zeitraum hinzufügen"}
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const renderAdminRequests = () => (
    <section className="profile-block admin-panel">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Adminbereich</span>
          <h3>Offene Anträge</h3>
        </div>

        <span className="badge open">{adminRequests.length}</span>
      </div>

      <div className="admin-toolbar">
        <div className="admin-filter-row">
          <button className={adminFilter === "all" ? "chip active" : "chip"} onClick={() => setAdminFilter("all")}>Alle</button>
          <button
            className={adminFilter === "claim_existing_farm" ? "chip active" : "chip"}
            onClick={() => setAdminFilter("claim_existing_farm")}
          >
            Bestehender Hof
          </button>
          <button
            className={adminFilter === "register_farm" ? "chip active" : "chip"}
            onClick={() => setAdminFilter("register_farm")}
          >
            Neuer Hof
          </button>
        </div>

        <div className="admin-hint">
          <strong>Hinweis</strong>
          <p>Freigabe neuer Höfe folgt im nächsten Schritt.</p>
        </div>
      </div>

      {adminMessage && <p className="form-success">{adminMessage}</p>}
      {adminRequestsError && <p className="form-error">{adminRequestsError}</p>}

      {adminRequestsLoadState === "loading" ? (
        <div className="empty-state">Offene Anträge werden geladen…</div>
      ) : visibleAdminRequests.length === 0 ? (
        <div className="empty-state">Keine offenen Anträge vorhanden.</div>
      ) : (
        <div className="admin-request-list">
          {visibleAdminRequests.map((request) => {
            const farmName = getAdminRequestFarmName(request);
            const applicantEmail = request.applicantEmail ?? getAdminRequestContactValue(request, "email") ?? "Nicht angegeben";
            const applicantPhone = getAdminRequestContactValue(request, "phone") ?? request.requesterProfile?.phone ?? "Nicht angegeben";
            const message = getAdminRequestContactValue(request, "message") ?? "Keine Nachricht angegeben";
            const farmAddress = request.request_type === "claim_existing_farm"
              ? [request.relatedFarm?.address, request.relatedFarm?.postal_code, request.relatedFarm?.city].filter(Boolean).join(", ") || "Nicht angegeben"
              : [
                  getAdminRequestContactValue(request, "street"),
                  getAdminRequestContactValue(request, "postal_code"),
                  getAdminRequestContactValue(request, "city"),
                ].filter(Boolean).join(", ") || "Nicht angegeben";
            const farmContact = request.request_type === "claim_existing_farm"
              ? [request.relatedFarm?.phone, request.relatedFarm?.whatsapp, request.relatedFarm?.email].filter(Boolean).join(" · ") || "Keine Angabe"
              : [getAdminRequestContactValue(request, "phone"), getAdminRequestContactValue(request, "whatsapp"), getAdminRequestContactValue(request, "email")]
                  .filter(Boolean)
                  .join(" · ") || "Keine Angabe";
            const adminNoteValue = adminNotes[request.id] ?? request.admin_note ?? "";
            const isProcessing = adminActionLoadingId === request.id;
            const isRegisterFarm = request.request_type === "register_farm";

            return (
              <article className="request-card admin-request-card" key={request.id}>
                <div className="request-card-header">
                  <div>
                    <strong>{requestTypeLabel(request.request_type)}</strong>
                    <p>{farmName}</p>
                  </div>

                  <span className={`badge request-status ${request.status}`}>{requestStatusLabel(request.status)}</span>
                </div>

                <div className="admin-request-grid">
                  <div>
                    <span>Antragsteller</span>
                    <strong>{getAdminApplicantName(request)}</strong>
                  </div>
                  <div>
                    <span>E-Mail</span>
                    <strong>{applicantEmail}</strong>
                  </div>
                  <div>
                    <span>Telefon</span>
                    <strong>{applicantPhone}</strong>
                  </div>
                  <div>
                    <span>Eingangsdatum</span>
                    <strong>{formatDate(request.created_at)}</strong>
                  </div>
                </div>

                <div className="detail-card admin-detail-card">
                  <h4>{isRegisterFarm ? "Vorgeschlagene Hofdaten" : "Bestehender Hof"}</h4>
                  <div className="admin-request-grid">
                    <div>
                      <span>Adresse</span>
                      <strong>{farmAddress}</strong>
                    </div>
                    <div>
                      <span>Kontakt</span>
                      <strong>{farmContact}</strong>
                    </div>
                    <div className="admin-grid-wide">
                      <span>Nachricht</span>
                      <strong>{message}</strong>
                    </div>
                  </div>

                  {isRegisterFarm && <p className="location-note">Freigabe neuer Höfe folgt im nächsten Schritt.</p>}
                </div>

                <label className="field field-wide">
                  <span>Adminnotiz</span>
                  <textarea
                    rows={3}
                    value={adminNoteValue}
                    onChange={(event) =>
                      setAdminNotes((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))
                    }
                    placeholder="Optionaler Vermerk zur Entscheidung"
                  />
                </label>

                {request.admin_note && (
                  <p className="request-note">
                    <strong>Vorhandene Notiz:</strong> {request.admin_note}
                  </p>
                )}

                <div className="action-row">
                  <button
                    className="primary-button"
                    onClick={() => openAdminActionDialog(request.id, "approve")}
                    disabled={isProcessing || isRegisterFarm}
                    title={isRegisterFarm ? "Freigabe neuer Höfe folgt im nächsten Schritt" : undefined}
                  >
                    {isProcessing ? "Bitte warten…" : "Freigeben"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => openAdminActionDialog(request.id, "reject")}
                    disabled={isProcessing}
                  >
                    {isProcessing ? "Bitte warten…" : "Ablehnen"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderAdminActionDialog = () => {
    if (!adminAction || !pendingAdminRequest) {
      return null;
    }

    const isApprove = adminAction.type === "approve";
    const applicantName = getAdminApplicantName(pendingAdminRequest);
    const farmName = getAdminRequestFarmName(pendingAdminRequest);

    return (
      <div className="admin-dialog-backdrop" onClick={closeAdminActionDialog}>
        <div className="admin-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <span className="eyebrow">{isApprove ? "Freigabe bestätigen" : "Ablehnung bestätigen"}</span>
          <h3>{isApprove ? "Bestehenden Hof freigeben" : "Antrag ablehnen"}</h3>
          <p>
            {isApprove
              ? `${applicantName} wird dem Hof ${farmName} zugeordnet.`
              : `${applicantName} erhält eine Ablehnung für den Antrag auf ${farmName}.`}
          </p>
          <p className="muted-text">Die Aktion wird erst nach deiner Bestätigung ausgeführt.</p>

          <div className="action-row">
            <button className="primary-button" onClick={executeAdminAction} disabled={Boolean(adminActionLoadingId)}>
              {isApprove ? "Freigeben" : "Ablehnen"}
            </button>
            <button className="secondary-button" onClick={closeAdminActionDialog} disabled={Boolean(adminActionLoadingId)}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="farmer-area">
      {!isSupabaseConfigured && (
        <section className="profile-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="eyebrow">Mein Bereich</span>
              <h3>Supabase nicht konfiguriert</h3>
            </div>
          </div>

          <p>Die Besucheransicht läuft weiter im JSON-Fallback, aber Login und Hofverwaltung brauchen eine Supabase-Konfiguration.</p>
        </section>
      )}

      {session.user ? (
        <>
          <section className="profile-block">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">{profile?.role === "admin" ? "Adminbereich" : "Mein Bereich"}</span>
                <h3>{profile?.display_name?.trim() || session.user.email || ""}</h3>
              </div>

              <span className={`badge request-status ${profile?.role ?? "farmer_pending"}`}>
                {roleLabel(profile?.role ?? "farmer_pending")}
              </span>
            </div>

            <p className="muted-text">{session.user.email}</p>

            {profile?.role === "admin" ? (
              <div className="detail-card">
                <h4>Freigaben und Prüfungen</h4>
                <p>Bestehende Hofanträge werden hier über sichere Serverfunktionen geprüft und freigegeben.</p>
              </div>
            ) : profile?.role === "farmer_verified" ? (
              <div className="detail-card">
                <h4>Freigeschalteter Hofbereich</h4>
                <p>Du kannst deinen zugeordneten Hof, Produkte und Öffnungszeiten verwalten.</p>
              </div>
            ) : (
              <>
                <div className="detail-card">
                  <h4>Bestätigung ausstehend</h4>
                  <p>Nach einmaliger Prüfung kannst du deinen Hof und deine Produkte selbst verwalten.</p>
                </div>
                {renderClaimExistingFarm()}
                {renderNewFarmForm()}
              </>
            )}

            {profileLoadError && <p className="form-error">{profileLoadError}</p>}
            {profileError && <p className="form-error">{profileError}</p>}
            {profileMessage && <p className="form-success">{profileMessage}</p>}
            {profileLoadState === "loading" && <p className="muted-text">Profil wird geladen…</p>}

            <button className="secondary-button" onClick={handleSignOut} disabled={authLoading}>
              {authLoading ? "Bitte warten…" : "Abmelden"}
            </button>
          </section>

          {profile?.role === "admin" ? renderAdminRequests() : renderRequests()}

          {profile?.role === "farmer_verified" && renderVerifiedDashboard()}
        </>
      ) : (
        <>
          <section className="profile-block">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">NahVersorgt</span>
                <h3>Registrierung und Login</h3>
              </div>
            </div>

            <div className="detail-card">
              <p>Nach einmaliger Prüfung kannst du deinen Hof und deine Produkte selbst verwalten.</p>
            </div>

            <div className="auth-cta-row">
              <button className="primary-button" onClick={() => setAuthMode("signin")}>
                Anmelden
              </button>
              <button className="secondary-button" onClick={() => setAuthMode("signup")}>
                Registrieren
              </button>
            </div>
          </section>

          {renderAuthForm()}
        </>
      )}

      {dashboardLoadState !== "idle" && !session.user && (
        <section className="profile-block">
          <div className="detail-card">
            <p>Mit einem Konto kannst du Anträge verfolgen und nach Freigabe deinen Hof verwalten.</p>
          </div>
        </section>
      )}

      {renderAdminActionDialog()}
    </div>
  );
}

export default FarmerArea;