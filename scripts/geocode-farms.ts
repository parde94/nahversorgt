/// <reference types="node" />

/**
 * Verwendung:
 *   node --experimental-strip-types scripts/geocode-farms.ts
 *
 * Dieses Skript liest alle Höfe aus src/data/nahversorgt-data.json,
 * geocodiert jede Adresse per OpenStreetMap Nominatim und ergänzt dabei
 * nur die Felder latitude und longitude. Fehlgeschlagene Treffer werden
 * in missing-geocodes.json und geocoding-report.json gespeichert.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type FarmRecord = {
  id?: string;
  name?: string;
  address?: string;
  locationText?: string;
  region?: string;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
};

type FarmPayload = {
  farms: FarmRecord[];
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

type MissingFarm = {
  id?: string;
  name?: string;
  address?: string;
  locationText?: string;
  reason: string;
};

type GeocodingResultEntry = {
  id?: string;
  name?: string;
  success: boolean;
  usedVariant: string;
  searchQuery: string;
  foundAddress?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  reason?: string;
};

type GeocodingReport = {
  successful: GeocodingResultEntry[];
  failed: GeocodingResultEntry[];
};

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const dataPath = path.join(workspaceRoot, "src", "data", "nahversorgt-data.json");
const missingPath = path.join(workspaceRoot, "missing-geocodes.json");
const reportPath = path.join(workspaceRoot, "geocoding-report.json");

const REQUEST_INTERVAL_MS = 1100;
const USER_AGENT = "NahVersorgt-Suedtirol/1.0 (contact: parde94@hotmail.de)";
const SOUTH_TYROL_BOUNDS = {
  minLatitude: 46.2,
  maxLatitude: 47.15,
  minLongitude: 10.35,
  maxLongitude: 12.55,
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const persistProgress = (
  payload: FarmPayload,
  missing: MissingFarm[],
  report: GeocodingReport,
) => {
  fs.writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(missingPath, `${JSON.stringify(missing, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

const normalizeWhitespace = (value?: string | null) =>
  value?.replace(/\s+/g, " ").trim() ?? "";

const sanitizeForSearch = (value?: string | null) => {
  if (!value) {
    return "";
  }

  return normalizeWhitespace(
    value
      .replace(/\|/g, ",")
      .replace(/\bTel\.?\s*[:\-]?\s*[^,\n]+/gi, "")
      .replace(/\bTelefon\s*[:\-]?\s*[^,\n]+/gi, "")
      .replace(/\b(?:Fax|Mobil|Handy|Email|Mail|Web|Website|www\.)[^,\n]*/gi, "")
      .replace(/\b(?:Ab Hof|Bauernmarkt|Hofladen|Geschäfte|Gastronomie|Online Geschäfte|Geschäft|Landwirtschaft)\b[^,\n]*/gi, "")
      .replace(/\s*,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
};

const extractZip = (value: string) => {
  const zipMatch = value.match(/\b39\d{2}\b/);
  return zipMatch?.[0] ?? "";
};

const extractCity = (value: string) => {
  const segments = value
    .split(/[\n,|]+/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);

  const zip = extractZip(value);
  const withZip = zip ? segments.find((segment) => segment.includes(zip)) : "";
  const index = withZip ? segments.indexOf(withZip) : -1;

  if (index >= 0 && segments[index + 1]) {
    return normalizeWhitespace(segments[index + 1]);
  }

  const fallback = segments.find((segment) => !/\b39\d{2}\b/.test(segment));
  return fallback ?? "";
};

const buildSearchVariants = (farm: FarmRecord) => {
  const candidateAddress = sanitizeForSearch(
    farm.address ?? farm.locationText ?? farm.name ?? farm.region,
  );
  const candidateName = sanitizeForSearch(farm.name);
  const region = sanitizeForSearch(farm.region);
  const streetAndPlace = sanitizeForSearch(
    farm.address ?? farm.locationText ?? farm.name,
  );
  const zip = extractZip(streetAndPlace);
  const city = extractCity(streetAndPlace);

  const variants = new Set<string>();

  if (candidateAddress && candidateAddress !== "") {
    variants.add(candidateAddress);
  }

  if (streetAndPlace && city && zip) {
    variants.add(`${streetAndPlace}, Südtirol, Italien`);
    variants.add(`${streetAndPlace}, ${zip} ${city}, Südtirol, Italien`);
  }

  if (streetAndPlace && city) {
    variants.add(`${streetAndPlace}, ${city}, Südtirol, Italien`);
  }

  if (streetAndPlace) {
    variants.add(`${streetAndPlace}, Südtirol, Italien`);
  }

  if (candidateName && city) {
    variants.add(`${candidateName}, ${city}, Südtirol, Italien`);
  }

  if (candidateName) {
    variants.add(`${candidateName}, Südtirol, Italien`);
  }

  if (region) {
    variants.add(`${region}, Südtirol, Italien`);
  }

  return Array.from(variants);
};

const isWithinSouthTyrol = (latitude: number, longitude: number) =>
  latitude >= SOUTH_TYROL_BOUNDS.minLatitude &&
  latitude <= SOUTH_TYROL_BOUNDS.maxLatitude &&
  longitude >= SOUTH_TYROL_BOUNDS.minLongitude &&
  longitude <= SOUTH_TYROL_BOUNDS.maxLongitude;

const fetchCoordinates = async (query: string) => {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "de",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as NominatimResult[];
  const firstHit = data[0];

  if (!firstHit?.lat || !firstHit?.lon) {
    return null;
  }

  const latitude = Number(firstHit.lat);
  const longitude = Number(firstHit.lon);

  if (!isWithinSouthTyrol(latitude, longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    foundAddress: firstHit.display_name,
  };
};

const main = async () => {
  const rawData = fs.readFileSync(dataPath, "utf8");
  const payload = JSON.parse(rawData) as FarmPayload;
  const farms = Array.isArray(payload?.farms) ? payload.farms : [];
  const missing: MissingFarm[] = [];
  const report: GeocodingReport = {
    successful: [],
    failed: [],
  };
  let lastRequestAt = 0;

  const waitForRateLimit = async () => {
    const elapsed = Date.now() - lastRequestAt;
    const delay = REQUEST_INTERVAL_MS - elapsed;

    if (delay > 0) {
      await sleep(delay);
    }

    lastRequestAt = Date.now();
  };

  for (const farm of farms) {
    const hasLatitude = typeof farm.latitude === "number";
    const hasLongitude = typeof farm.longitude === "number";

    if (hasLatitude && hasLongitude) {
      continue;
    }

    const variants = buildSearchVariants(farm);

    if (variants.length === 0) {
      missing.push({
        id: farm.id,
        name: farm.name,
        address: farm.address,
        locationText: farm.locationText,
        reason: "No usable address fields available",
      });
      report.failed.push({
        id: farm.id,
        name: farm.name,
        success: false,
        usedVariant: "none",
        searchQuery: "",
        reason: "No usable address fields available",
      });
      persistProgress(payload, missing, report);
      continue;
    }

    let matchedResult: {
      latitude: number;
      longitude: number;
      foundAddress?: string;
    } | null = null;
    let matchedVariant = "";
    let matchedQuery = "";

    for (const variant of variants) {
      try {
        await waitForRateLimit();
        const result = await fetchCoordinates(variant);

        if (!result) {
          continue;
        }

        matchedResult = result;
        matchedVariant = variant;
        matchedQuery = variant;
        break;
      } catch (error) {
        continue;
      }
    }

    if (!matchedResult) {
      missing.push({
        id: farm.id,
        name: farm.name,
        address: farm.address,
        locationText: farm.locationText,
        reason: "No geocode hit found within South Tyrol bounds",
      });
      report.failed.push({
        id: farm.id,
        name: farm.name,
        success: false,
        usedVariant: matchedVariant || "none",
        searchQuery: matchedQuery || variants[0],
        reason: "No geocode hit found within South Tyrol bounds",
      });
      persistProgress(payload, missing, report);
      continue;
    }

    if (!hasLatitude) {
      farm.latitude = matchedResult.latitude;
    }

    if (!hasLongitude) {
      farm.longitude = matchedResult.longitude;
    }

    report.successful.push({
      id: farm.id,
      name: farm.name,
      success: true,
      usedVariant: matchedVariant,
      searchQuery: matchedQuery,
      foundAddress: matchedResult.foundAddress,
      coordinates: {
        latitude: matchedResult.latitude,
        longitude: matchedResult.longitude,
      },
    });

    persistProgress(payload, missing, report);
  }

  console.log(`Updated ${dataPath}`);
  console.log(`Wrote ${missing.length} missing geocode entries to ${missingPath}`);
  console.log(`Report written to ${reportPath}`);
};

await main();
