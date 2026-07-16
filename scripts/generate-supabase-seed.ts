import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve('src/data/nahversorgt-data.json');
const OUTPUT_PATH = resolve('supabase/seeds/001_existing_farms.sql');
const REVIEW_PATH = resolve('supabase/IMPORT_REVIEW.md');

const normalizeText = (value: unknown) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const escapeSql = (value: string) => value.replace(/'/g, "''");

const makeSlug = (value: string) => {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 120);

  return base || 'hof';
};

const stableUuid = (seed: string) => {
  const hash = createHash('sha1').update(`nahversorgt:${seed}`).digest('hex');
  const raw = hash.slice(0, 32);
  const versionNibble = '5';
  const variantNibble = ((parseInt(raw.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');

  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `${raw.slice(12, 16).slice(0, 3)}${versionNibble}`,
    `${variantNibble}${raw.slice(18, 20)}`,
    raw.slice(20, 32),
  ].join('-');
};

const stableLegacySourceId = (index: number, name: string) => {
  const normalizedName = makeSlug(name || `hof-${index}`);
  return `index-${index}-${normalizedName}`;
};

const splitPostalAndCity = (input: string) => {
  const raw = normalizeText(input);
  if (!raw) {
    return { postalCode: null as string | null, city: null as string | null };
  }

  const pipeSplit = raw.replace(/\s*\|\s*/g, ' | ').split('|').map((chunk) => chunk.trim()).filter(Boolean);
  if (pipeSplit.length >= 2) {
    const second = pipeSplit[1];
    const match = second.match(/^(\d{4,5})\s+(.+)$/);
    if (match) {
      return { postalCode: match[1], city: match[2].trim() };
    }
  }

  const fallback = raw.match(/(\d{4,5})\s+([A-Za-zÄÖÜäöüß\-\s]+)$/);
  if (fallback) {
    return { postalCode: fallback[1], city: fallback[2].trim() };
  }

  return { postalCode: null, city: null };
};

const normalizeProductName = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/\/$/, '');

const dedupeValues = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const parseStructuredOpeningHours = (text: string) => {
  const raw = normalizeText(text);
  if (!raw) {
    return { windows: [] as Array<{ dayOfWeek: number; opensAt: string; closesAt: string; }>, note: null as string | null };
  }

  const lower = raw.toLowerCase();
  const noteKeywords = [
    'nach telefonischer vereinbarung',
    'auf anfrage',
    'auf vorbestellung',
    'selbstbedienung',
    '24h',
    '24 stunden',
    'automat',
  ];

  if (noteKeywords.some((keyword) => lower.includes(keyword))) {
    return { windows: [], note: raw };
  }

  const dayOrder = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
  const dayIndexMap: Record<string, number> = { Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6, So: 0 };
  const clauses = raw.split(';').map((part) => part.trim()).filter(Boolean);
  const windows: Array<{ dayOfWeek: number; opensAt: string; closesAt: string; }> = [];

  for (const clause of clauses) {
    const dayMatches = Array.from(clause.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/g));
    const timeMatches = Array.from(clause.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(?:-|bis)\s*(\d{1,2})(?::(\d{2}))?\s*Uhr/gi));

    if (dayMatches.length === 0 || timeMatches.length === 0) {
      continue;
    }

    const firstDay = dayMatches[0][1];
    const secondDay = dayMatches[1]?.[1] ?? firstDay;
    const startIndex = dayIndexMap[firstDay];
    const endIndex = dayIndexMap[secondDay];

    const dayRange = startIndex <= endIndex
      ? dayOrder.slice(startIndex - 1, endIndex)
      : dayOrder.slice(startIndex - 1).concat(dayOrder.slice(0, endIndex));

    for (const timeMatch of timeMatches) {
      const opensHour = Number(timeMatch[1]);
      const opensMinute = Number(timeMatch[2] ?? '0');
      const closesHour = Number(timeMatch[3]);
      const closesMinute = Number(timeMatch[4] ?? '0');

      if (!Number.isFinite(opensHour) || !Number.isFinite(closesHour)) {
        continue;
      }

      const opensAt = `${String(opensHour).padStart(2, '0')}:${String(opensMinute).padStart(2, '0')}`;
      const closesAt = `${String(closesHour).padStart(2, '0')}:${String(closesMinute).padStart(2, '0')}`;

      for (const day of dayRange) {
        windows.push({ dayOfWeek: dayIndexMap[day], opensAt, closesAt });
      }
    }
  }

  const dedupedRaw = dedupeValues(windows.map((window) => `${window.dayOfWeek}|${window.opensAt}|${window.closesAt}`));
  return {
    windows: dedupedRaw.map((item) => {
      const [dayOfWeek, opensAt, closesAt] = item.split('|');
      return { dayOfWeek: Number(dayOfWeek), opensAt, closesAt };
    }),
    note: null,
  };
};

const data = JSON.parse(readFileSync(SOURCE_PATH, 'utf8')) as { farms?: Array<Record<string, unknown>> };
const farms = Array.isArray(data.farms) ? data.farms : [];

const farmLines: string[] = [];
const productLines: string[] = [];
const openingHourLines: string[] = [];

let productCount = 0;
let structuredOpeningHoursCount = 0;
let unclearOpeningHoursCount = 0;
let farmsWithCoordinates = 0;
let farmsWithoutCoordinates = 0;
const problematicEntries: string[] = [];

const sqlHeader = [
  '-- Seed generated from src/data/nahversorgt-data.json',
  '-- Reproducible, idempotent seed for existing farms only.',
  'begin;',
];

for (const [index, farm] of farms.entries()) {
  const name = normalizeText(farm.name) || 'Unbenannter Hof';
  const legacySourceId = normalizeText(farm.id) || stableLegacySourceId(index, name);
  const farmId = stableUuid(legacySourceId);
  const slug = makeSlug(`${name}-${legacySourceId}`);
  const description = normalizeText(farm.salesChannels) || normalizeText(farm.sourceType) || null;
  const region = normalizeText(farm.region);
  const locationText = normalizeText(farm.locationText);
  const address = normalizeText(farm.address) || locationText;
  const { postalCode, city } = splitPostalAndCity(address || locationText);
  const latitude = Number(farm.latitude);
  const longitude = Number(farm.longitude);
  const phone = normalizeText(farm.phone);
  const whatsapp = normalizeText(farm.whatsapp);
  const email = normalizeText(farm.email);
  const website = normalizeText(farm.website);
  const delivery = Boolean(farm.delivery);
  const deliveryRadiusKm = typeof farm.deliveryRadiusKm === 'number' ? farm.deliveryRadiusKm : null;
  const selfService = /selbstbedienung|24h|24 stunden|automat/.test(((farm.openingHoursText as string | undefined) ?? '').toLowerCase());

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    farmsWithCoordinates += 1;
  } else {
    farmsWithoutCoordinates += 1;
  }

  farmLines.push(
    `insert into public.farms (id, name, slug, description, region, location_text, address, postal_code, city, latitude, longitude, phone, whatsapp, email, website, delivery, delivery_radius_km, self_service, published, approval_state, legacy_source_id) values ('${farmId}'::uuid, '${escapeSql(name)}', '${escapeSql(slug)}', ${description ? `'${escapeSql(description)}'` : 'null'}, ${region ? `'${escapeSql(region)}'` : 'null'}, ${locationText ? `'${escapeSql(locationText)}'` : 'null'}, ${address ? `'${escapeSql(address)}'` : 'null'}, ${postalCode ? `'${escapeSql(postalCode)}'` : 'null'}, ${city ? `'${escapeSql(city)}'` : 'null'}, ${Number.isFinite(latitude) ? latitude : 'null'}, ${Number.isFinite(longitude) ? longitude : 'null'}, ${phone ? `'${escapeSql(phone)}'` : 'null'}, ${whatsapp ? `'${escapeSql(whatsapp)}'` : 'null'}, ${email ? `'${escapeSql(email)}'` : 'null'}, ${website ? `'${escapeSql(website)}'` : 'null'}, ${delivery}, ${deliveryRadiusKm !== null ? deliveryRadiusKm : 'null'}, ${selfService}, true, 'approved', '${escapeSql(legacySourceId)}') on conflict (id) do nothing;`
  );

  const productList = Array.isArray(farm.products) ? farm.products : [];
  const uniqueProducts = dedupeValues((productList as string[]).map((entry) => normalizeProductName(String(entry))));

  for (const productName of uniqueProducts) {
    productCount += 1;
    const productId = stableUuid(`${legacySourceId}:${productName}`);
    productLines.push(
      `insert into public.products (id, farm_id, name, published, sort_order) values ('${productId}'::uuid, '${farmId}'::uuid, '${escapeSql(productName)}', true, 0) on conflict (id) do nothing;`
    );
  }

  const openingText = normalizeText(farm.openingHoursText);
  if (openingText) {
    const { windows, note } = parseStructuredOpeningHours(openingText);

    if (windows.length > 0) {
      structuredOpeningHoursCount += windows.length;
    } else if (note) {
      unclearOpeningHoursCount += 1;
    } else {
      unclearOpeningHoursCount += 1;
    }

    windows.forEach((window, windowIndex) => {
      const hourId = stableUuid(`${legacySourceId}:opening:${windowIndex}:${window.dayOfWeek}:${window.opensAt}:${window.closesAt}`);
      openingHourLines.push(
        `insert into public.opening_hours (id, farm_id, day_of_week, opens_at, closes_at, note, sort_order) values ('${hourId}'::uuid, '${farmId}'::uuid, ${window.dayOfWeek}, '${window.opensAt}', '${window.closesAt}', null, ${windowIndex}) on conflict (id) do nothing;`
      );
    });
  }

  const hasAddress = Boolean(address || locationText);
  if (!hasAddress) {
    problematicEntries.push(`${name}: missing address or location text`);
  }
}

const allLines = [...sqlHeader, ...farmLines, ...productLines, ...openingHourLines, 'commit;'];
mkdirSync(resolve('supabase/seeds'), { recursive: true });
writeFileSync(OUTPUT_PATH, `${allLines.join('\n')}\n`, 'utf8');

const reviewLines = [
  '# Supabase Import Review',
  '',
  '## Wie der Seed erzeugt wurde',
  '',
  'Der SQL-Seed wird aus [src/data/nahversorgt-data.json](src/data/nahversorgt-data.json) erzeugt und als reproduzierbarer Import in [supabase/seeds/001_existing_farms.sql](supabase/seeds/001_existing_farms.sql) abgelegt. Der Generator arbeitet deterministisch auf Basis stabiler SHA-1-UUIDs und ist deshalb bei erneutem Lauf idempotent.',
  '',
  '## Übernommene Daten',
  '',
  '- Hofbasisdaten in `public.farms`',
  '- Produkte in `public.products`',
  '- nur zuverlässig strukturierte Öffnungszeiten in `public.opening_hours`',
  '- keine `auth.users`-, `profiles`-, `farm_owners`- oder Admin-Daten',
  '',
  '## Bewusst nicht übernommen',
  '',
  '- unklare Freitexte wie „nach Vereinbarung“ oder „Selbstbedienung“ wurden nicht als künstliche Uhrzeiten rekonstruiert',
  '- keine späteren Farmer- oder Admin-Änderungen werden überschrieben',
  '- die bestehende JSON-App bleibt bis zur Supabase-Leseintegration unverändert aktiv',
  '',
  '## Kennzahlen',
  '',
  `- Anzahl Höfe in JSON: ${farms.length}`,
  `- Anzahl erzeugter Hofdatensätze: ${farms.length}`,
  `- Anzahl Produkte: ${productCount}`,
  `- Anzahl Höfe mit Koordinaten: ${farmsWithCoordinates}`,
  `- Anzahl Höfe ohne Koordinaten: ${farmsWithoutCoordinates}`,
  `- Anzahl strukturierter Öffnungszeiten: ${structuredOpeningHoursCount}`,
  `- Anzahl unklarer Öffnungszeiten: ${unclearOpeningHoursCount}`,
  `- problematische oder übersprungene Datensätze: ${problematicEntries.length}`,
  '',
  '## Teststrategie',
  '',
  '1. Die SQL-Datei im Supabase SQL Editor in einer separaten Sandbox ausführen.',
  '2. Vor dem echten Import eine Sicherung der betroffenen Tabellen anlegen.',
  '3. Danach prüfen, ob nur die erwarteten Hof-, Produkt- und Öffnungsdaten importiert wurden.',
  '4. Wiederholungsversuch ausführen und verifizieren, dass keine Duplikate entstehen.',
  '',
  '## Rollback-Vorschlag',
  '',
  '- Die Sandbox-Umgebung als isoliertes Testprojekt verwenden.',
  '- Vor dem Import die betroffenen Tabellen sichern.',
  '- Bei Bedarf in der Sandbox die importierten Datensätze gezielt zurücksetzen oder mit einem anderen importierten Seed erneut bereitstellen.',
  '',
  '## Problematische Datensätze',
  '',
  problematicEntries.length > 0
    ? problematicEntries.map((entry) => `- ${entry}`).join('\n')
    : '- keine erkennbar problematischen Datensätze im automatischen Scan',
];

writeFileSync(REVIEW_PATH, `${reviewLines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  farms: farms.length,
  products: productCount,
  structuredOpeningHours: structuredOpeningHoursCount,
  unclearOpeningHours: unclearOpeningHoursCount,
  farmsWithCoordinates,
  farmsWithoutCoordinates,
  output: OUTPUT_PATH,
}, null, 2));
