import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "cache");
const META_PATH = path.join(CACHE_DIR, "meta.json");

const TABLES = {
  items: "DestinyInventoryItemDefinition",
  damageTypes: "DestinyDamageTypeDefinition",
  statDefs: "DestinyStatDefinition",
  statGroupDefs: "DestinyStatGroupDefinition",
  plugSets: "DestinyPlugSetDefinition",
  socketCategories: "DestinySocketCategoryDefinition",
  breakerTypes: "DestinyBreakerTypeDefinition",
  sandboxPerks: "DestinySandboxPerkDefinition",
  collectibles: "DestinyCollectibleDefinition",
  seasons: "DestinySeasonDefinition",
};

// As of the 2026 champion-mod overhaul, anti-Champion capability is intrinsic to every
// weapon's frame (no Artifact mod needed) — encoded as a hidden sandbox perk on the frame
// plug item, named like "[Disruption] Overload". Maps the bracketed tag to the matching
// DestinyBreakerTypeDefinition enumValue for its icon.
const CHAMPION_TAG_TO_ENUM = { "Shield-Piercing": 1, "Disruption": 2, "Stagger": 3 };
const CHAMPION_PERK_PATTERN = /^\[(Shield-Piercing|Disruption|Stagger)\]\s*(.+)$/;

const AMMO_TYPE_LABELS = { 0: "None", 1: "Primary", 2: "Special", 3: "Heavy" };
const WEAPON_ITEM_TYPE = 3;
// Weapons from the tier system (Edge of Fate, release v900, onwards) carry a gear-tier
// upgrade socket; older copies of the same weapon don't. Only those get tier stars.
const GEAR_TIER_SOCKET_NAME = "Empty Gear Tier Upgrade";

function isTieredWeapon(item, itemDefs) {
  return (item.sockets?.socketEntries ?? []).some(
    (e) => itemDefs[e.singleInitialItemHash]?.displayProperties?.name === GEAR_TIER_SOCKET_NAME
  );
}
const EXCLUDED_SOCKET_CATEGORIES = new Set(["weapon cosmetics"]);
const EMPTY_SOCKET_NAMES = new Set(["Empty Mod Socket", "None", "Random Masterwork", "Tier 1 Weapon"]);
// Socket category holding the rollable columns (barrel, magazine, traits, origin) used for perk search.
const PERK_SEARCH_CATEGORY = "WEAPON PERKS";

// Community-maintained (MIT license, DIM project) season data. Bungie's live API has no
// field linking an item back to its release season — watermark icon -> season has far
// better coverage (shared badge per season) than the direct item-hash table, so it's tried first.
const WATERMARK_SEASONS_URL = "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/watermark-to-season.json";
const HASH_SEASONS_URL = "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/seasons.json";

// Season numbering after The Final Shape follows the wiki (d2.destinygamewiki.com/wiki/Seasons),
// which counts Ash and Iron as its own season. Bungie and DIM fold it into S27, so from
// Dec 2025 they run one number behind. These are manual labels per Bungie release tag,
// not Bungie data — review when a new release or season lands.
const RELEASE_SEASON_OVERRIDES = [
  { traitPrefix: "releases.v900", season: 27 },
  { traitPrefix: "releases.v910", season: 28 },
  { traitPrefix: "releases.v950", season: 29 },
  { traitPrefix: "releases.v960", season: 29 },
  { traitPrefix: "releases.v970", season: 29 },
];

// DIM's season tags (redwar, osiris, ... heresy) match this numbering up to S27 only;
// later seasons, and Bungie's unnamed S1, are named here.
const LAST_DIM_TAGGED_SEASON = 27;
const SEASON_OVERRIDES = {
  1: { name: "Red War", tags: [] },
  27: { name: "Season: Reclamation", tags: ["reclamation"] },
  28: { name: "Season: Ash and Iron", tags: ["ashandiron"] },
  29: { name: "Monument of Triumph", tags: ["monumentoftriumph", "mot", "lawless", "renegades"] },
  30: { name: "Season: Shadow & Order", tags: ["shadowandorder"] },
};

// Community-maintained (MIT license, DIM project) short source names (ironbanner, trials,
// vaultofglass, ...) mapped onto Bungie collectible source hashes, plus DIM's season tags.
// The source list is a TypeScript file: it is parsed as text, never executed.
const SEASON_TAGS_URL = "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/season-tags.json";
const SOURCE_INFO_URL = "https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/source-info-v2.ts";

// Community-sourced (Clarity project, d2clarity.com — free use under 150 users with
// attribution per their partnerships terms) detailed perk descriptions, since Bungie's
// own perk text is often vague ("improves handling" with no numbers).
const CLARITY_URL = "https://raw.githubusercontent.com/Database-Clarity/Live-Clarity-Database/master/descriptions/clarity.json";

let weaponsCache = null;
let tableCache = null;
let watermarkSeasonsCache = null;
let hashSeasonsCache = null;
let clarityCache = null;
let perkTableCache = null;
let dimSourcesCache = null;
let seasonTagsCache = null;

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function fetchManifest(apiKey) {
  const res = await fetch("https://www.bungie.net/Platform/Destiny2/Manifest/", {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const body = await res.json();
  return body.Response;
}

async function fetchDefinitionTable(apiKey, relativePath) {
  const res = await fetch(`https://www.bungie.net${relativePath}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) throw new Error(`Definition table fetch failed: ${res.status}`);
  return res.json();
}

export async function ensureManifestCache(apiKey) {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const manifest = await fetchManifest(apiKey);
  const liveVersion = manifest.version;
  const cachedMeta = await readJsonIfExists(META_PATH);

  const remotePaths = {};
  for (const [key, tableName] of Object.entries(TABLES)) {
    const remotePath = manifest.jsonWorldComponentContentPaths?.en?.[tableName];
    if (!remotePath) throw new Error(`Manifest response missing table: ${tableName}`);
    remotePaths[key] = remotePath;
  }

  const upToDate = cachedMeta?.version === liveVersion;
  const allCached = upToDate
    ? (await Promise.all(Object.keys(TABLES).map((key) => readJsonIfExists(cachePath(key))))).every(Boolean)
    : false;

  if (allCached) {
    console.log(`Manifest cache up to date (version ${liveVersion})`);
    return;
  }

  console.log(`Downloading manifest definitions (version ${liveVersion})...`);
  const entries = Object.entries(remotePaths);
  const downloaded = await Promise.all(entries.map(([, remotePath]) => fetchDefinitionTable(apiKey, remotePath)));

  await Promise.all(
    entries.map(([key], i) => fs.writeFile(cachePath(key), JSON.stringify(downloaded[i])))
  );
  await fs.writeFile(META_PATH, JSON.stringify({ version: liveVersion, updatedAt: new Date().toISOString() }));

  weaponsCache = null;
  tableCache = null;
  perkTableCache = null;
  console.log("Manifest definitions cached.");
}

export async function ensureSeasonData() {
  await ensureSeasonsCache();
}

// Each source block in DIM's file looks like:  ironbanner: { sourceHashes: [ 123, // comment ], aliases: ['ib'] },
function parseDimSources(text) {
  const start = text.indexOf("} = {");
  if (start === -1) throw new Error("Unexpected source-info format");
  const body = text.slice(start + 5);
  const numbersIn = (block, field) => {
    const list = new RegExp(`${field}: \\[([\\s\\S]*?)\\]`).exec(block)?.[1] ?? "";
    return [...list.matchAll(/^\s*(\d+),/gm)].map((m) => Number(m[1]));
  };

  const sources = {};
  for (const m of body.matchAll(/^ {2}'?([a-z0-9]+)'?: \{([\s\S]*?)^ {2}\},/gm)) {
    const block = m[2];
    const aliasList = /aliases: \[([\s\S]*?)\]/.exec(block)?.[1] ?? "";
    sources[m[1]] = {
      sourceHashes: numbersIn(block, "sourceHashes"),
      itemHashes: numbersIn(block, "itemHashes"),
      aliases: [...aliasList.matchAll(/'([^']+)'/g)].map((a) => a[1]),
    };
  }
  if (Object.keys(sources).length === 0) throw new Error("No sources parsed");
  return sources;
}

async function fetchAndCacheParsed(url, cacheKey, parse) {
  const filePath = cachePath(cacheKey);
  const cached = await readJsonIfExists(filePath);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${cacheKey}: ${res.status}`);
  const data = parse(await res.text());
  await fs.writeFile(filePath, JSON.stringify(data));
  return data;
}

export async function ensureSourceData() {
  try {
    [dimSourcesCache, seasonTagsCache] = await Promise.all([
      fetchAndCacheParsed(SOURCE_INFO_URL, "dim_sources_external", parseDimSources),
      fetchAndCacheJson(SEASON_TAGS_URL, "season_tags_external"),
    ]);
    console.log(`Source data cached from d2-additional-info (${Object.keys(dimSourcesCache).length} sources).`);
  } catch (err) {
    console.warn("Could not fetch source data (non-fatal, source: search will be empty):", err.message);
    dimSourcesCache = dimSourcesCache ?? {};
    seasonTagsCache = seasonTagsCache ?? {};
  }
  weaponsCache = null;
}

function buildSourceIndex() {
  const bySourceHash = new Map();
  const byItemHash = new Map();
  const add = (map, hash, key) => {
    if (!map.has(hash)) map.set(hash, []);
    map.get(hash).push(key);
  };
  for (const [key, info] of Object.entries(dimSourcesCache ?? {})) {
    for (const h of info.sourceHashes) add(bySourceHash, h, key);
    for (const h of info.itemHashes) add(byItemHash, h, key);
  }
  return { bySourceHash, byItemHash };
}

function sourcesForItem(item, collectibleDefs, sourceIndex) {
  const sourceHash = collectibleDefs[item.collectibleHash]?.sourceHash;
  const keys = [...(sourceIndex.bySourceHash.get(sourceHash) ?? []), ...(sourceIndex.byItemHash.get(item.hash) ?? [])];
  return [...new Set(keys)];
}

export async function ensureClarityData() {
  try {
    clarityCache = await fetchAndCacheJson(CLARITY_URL, "clarity_external");
    console.log("Clarity perk descriptions cached.");
  } catch (err) {
    console.warn("Could not fetch Clarity data (non-fatal, tooltips fall back to Bungie text):", err.message);
    clarityCache = clarityCache ?? {};
  }
}

// Clarity's rich text format is paragraphs of {linesContent:[{text,classNames}]} with
// occasional {classNames:["spacer"]} blank-line markers. Flattened here to plain
// paragraphs + spacers; inline pve/pvp/link styling is dropped for a simple tooltip.
function simplifyClarityText(entry) {
  const paragraphs = entry?.descriptions?.en;
  if (!Array.isArray(paragraphs)) return null;

  const lines = paragraphs
    .map((p) => (p.classNames?.includes("spacer") ? "" : (p.linesContent ?? []).map((l) => l.text).join("")))
    .filter((line, i, arr) => !(line === "" && (i === 0 || arr[i - 1] === "")));

  return lines.length > 0 ? lines : null;
}

function clarityTextForHash(hash) {
  return simplifyClarityText(clarityCache?.[String(hash)]);
}

function seasonForItem(item) {
  const override = RELEASE_SEASON_OVERRIDES.find((o) => item.traitIds?.some((t) => t.startsWith(o.traitPrefix)));
  if (override) return override.season;

  const byWatermark =
    watermarkSeasonsCache?.[item.iconWatermark] ?? watermarkSeasonsCache?.[item.iconWatermarkShelved];
  if (byWatermark != null) return byWatermark;
  return hashSeasonsCache?.[String(item.hash)] ?? null;
}

async function fetchAndCacheJson(url, cacheKey) {
  const filePath = cachePath(cacheKey);
  const cached = await readJsonIfExists(filePath);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${cacheKey}: ${res.status}`);
  const data = await res.json();
  await fs.writeFile(filePath, JSON.stringify(data));
  return data;
}

async function ensureSeasonsCache() {
  try {
    [watermarkSeasonsCache, hashSeasonsCache] = await Promise.all([
      fetchAndCacheJson(WATERMARK_SEASONS_URL, "watermark_seasons_external"),
      fetchAndCacheJson(HASH_SEASONS_URL, "hash_seasons_external"),
    ]);
    console.log("Season data cached from d2-additional-info.");
  } catch (err) {
    console.warn("Could not fetch season data (non-fatal, seasons will show as unknown):", err.message);
    watermarkSeasonsCache = watermarkSeasonsCache ?? {};
    hashSeasonsCache = hashSeasonsCache ?? {};
  }
}

async function loadTables() {
  if (tableCache) return tableCache;

  const loaded = {};
  for (const key of Object.keys(TABLES)) {
    const data = await readJsonIfExists(cachePath(key));
    if (!data) throw new Error(`Manifest cache not ready for ${key} — call ensureManifestCache first`);
    loaded[key] = data;
  }
  tableCache = loaded;
  return loaded;
}

function iconUrl(icon) {
  return icon ? `https://www.bungie.net${icon}` : null;
}

function findIntrinsicFrame(item, itemDefs, socketCategoryDefs) {
  const categories = item.sockets?.socketCategories ?? [];
  const entries = item.sockets?.socketEntries ?? [];

  for (const category of categories) {
    const categoryName = socketCategoryDefs[category.socketCategoryHash]?.displayProperties?.name;
    if (categoryName !== "INTRINSIC TRAITS") continue;

    const entry = entries[category.socketIndexes[0]];
    return entry?.singleInitialItemHash ? itemDefs[entry.singleInitialItemHash] : null;
  }
  return null;
}

function championInfoFromFrame(frameItem, sandboxPerkDefs, breakerTypeDefs) {
  for (const p of frameItem?.perks ?? []) {
    const perkDef = sandboxPerkDefs[p.perkHash];
    const match = CHAMPION_PERK_PATTERN.exec(perkDef?.displayProperties?.name ?? "");
    if (!match) continue;

    const enumValue = CHAMPION_TAG_TO_ENUM[match[1]];
    const breakerDef = Object.values(breakerTypeDefs).find((b) => b.enumValue === enumValue);
    return { championName: match[2], championIcon: iconUrl(breakerDef?.displayProperties?.icon) };
  }
  return { championName: null, championIcon: null };
}

function mapItemDefinition(item, itemDefs, damageTypeDefs, socketCategoryDefs, breakerTypeDefs, sandboxPerkDefs) {
  const damageTypeHash = item.defaultDamageTypeHash ?? item.damageTypeHashes?.[0];
  const damageType = damageTypeHash ? damageTypeDefs[damageTypeHash] : null;
  const ammoTypeValue = item.equippingBlock?.ammoType ?? 0;
  const frameItem = findIntrinsicFrame(item, itemDefs, socketCategoryDefs);

  return {
    hash: item.hash,
    name: item.displayProperties?.name ?? "",
    icon: iconUrl(item.displayProperties?.icon),
    screenshot: item.screenshot ? `https://www.bungie.net${item.screenshot}` : null,
    flavorText: item.flavorText ?? "",
    itemTypeDisplayName: item.itemTypeDisplayName ?? "",
    weaponCategory: item.itemTypeAndTierDisplayName ?? item.itemTypeDisplayName ?? "",
    frameName: frameItem?.displayProperties?.name ?? null,
    frameIcon: iconUrl(frameItem?.displayProperties?.icon),
    ...championInfoFromFrame(frameItem, sandboxPerkDefs, breakerTypeDefs),
    damageType: damageType?.displayProperties?.name ?? null,
    damageTypeIcon: iconUrl(damageType?.displayProperties?.icon),
    ammoType: AMMO_TYPE_LABELS[ammoTypeValue] ?? "Unknown",
    tierType: item.inventory?.tierTypeName ?? "",
    isWeapon: item.itemType === WEAPON_ITEM_TYPE,
    season: seasonForItem(item),
    seasonIcon: iconUrl(item.iconWatermark ?? item.iconWatermarkShelved),
    // Exotics always count as tier 5; Legendaries only from the tier system onwards.
    tierStars: isTieredWeapon(item, itemDefs) || item.inventory?.tierTypeName === "Exotic" ? 5 : null,
  };
}

function plugHashesForEntry(entry, plugSets) {
  const plugSetHash = entry?.randomizedPlugSetHash || entry?.reusablePlugSetHash;
  if (plugSetHash && plugSets[plugSetHash]) return plugSets[plugSetHash].reusablePlugItems.map((p) => p.plugItemHash);
  return entry?.singleInitialItemHash ? [entry.singleInitialItemHash] : [];
}

// Perk search keys on the perk's name, so an enhanced perk (same name, different hash)
// counts as its base perk. Plugs with no item type are trackers/catalyst sockets, not perks.
function collectWeaponPerkIds(item, itemDefs, plugSets, socketCategoryDefs, perkIdByName, perkTable) {
  const ids = new Set();
  const entries = item.sockets?.socketEntries ?? [];

  for (const category of item.sockets?.socketCategories ?? []) {
    if (socketCategoryDefs[category.socketCategoryHash]?.displayProperties?.name !== PERK_SEARCH_CATEGORY) continue;

    for (const index of category.socketIndexes) {
      for (const plugHash of plugHashesForEntry(entries[index], plugSets)) {
        const plug = itemDefs[plugHash];
        const name = plug?.displayProperties?.name;
        if (!name || !plug.itemTypeDisplayName || EMPTY_SOCKET_NAMES.has(name)) continue;

        const isEnhanced = plug.itemTypeDisplayName.startsWith("Enhanced");
        let id = perkIdByName.get(name);
        if (id === undefined) {
          id = perkTable.length;
          perkIdByName.set(name, id);
          perkTable.push({
            id,
            name,
            icon: iconUrl(plug.displayProperties.icon),
            kind: plug.itemTypeDisplayName.replace(/^Enhanced\s+/, ""),
            iconFromEnhanced: isEnhanced,
          });
        } else if (perkTable[id].iconFromEnhanced && !isEnhanced) {
          // Prefer the base perk's icon over the enhanced variant's art.
          perkTable[id].icon = iconUrl(plug.displayProperties.icon);
          perkTable[id].iconFromEnhanced = false;
        }
        ids.add(id);
      }
    }
  }
  return [...ids];
}

// The manifest carries hidden copies of some weapons (same name and season; usually no
// collectible, sometimes an event watermark). Keep one per group, preferring the collectible
// copy, but let it search on every copy's perks so no rollable perk drops out of perk search.
function dedupeWeapons(weapons, itemDefs) {
  const groups = new Map();
  for (const w of weapons) {
    const key = `${w.name}|${w.season ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const [kept] = [...group].sort(
      (a, b) =>
        Number(Boolean(itemDefs[b.hash]?.collectibleHash)) - Number(Boolean(itemDefs[a.hash]?.collectibleHash)) ||
        b.perkIds.length - a.perkIds.length ||
        a.hash - b.hash
    );
    return {
      ...kept,
      perkIds: [...new Set(group.flatMap((w) => w.perkIds))],
      sources: [...new Set(group.flatMap((w) => w.sources))],
    };
  });
}

// Fixed list order: newest season first; within a season, brand-new weapons first, then
// reissues grouped by the season the weapon first came out (newest first); then Exotics
// before the rest; then A-Z. Unknown seasons last.
function sortBySeason(weapons) {
  const originalSeason = new Map();
  for (const w of weapons) {
    if (w.season == null) continue;
    const seen = originalSeason.get(w.name);
    if (seen == null || w.season < seen) originalSeason.set(w.name, w.season);
  }

  return [...weapons].sort((a, b) => {
    if (a.season == null || b.season == null) {
      if (a.season !== b.season) return a.season == null ? 1 : -1;
    } else if (a.season !== b.season) {
      return b.season - a.season;
    } else {
      const byOriginal = (originalSeason.get(b.name) ?? 0) - (originalSeason.get(a.name) ?? 0);
      if (byOriginal !== 0) return byOriginal;
      const byExotic = Number(b.tierType === "Exotic") - Number(a.tierType === "Exotic");
      if (byExotic !== 0) return byExotic;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function getWeapons() {
  if (weaponsCache) return weaponsCache;

  const { items: itemDefs, damageTypes: damageTypeDefs, plugSets, socketCategories, breakerTypes, sandboxPerks, collectibles } = await loadTables();

  const perkIdByName = new Map();
  const perkTable = [];
  const sourceIndex = buildSourceIndex();

  const weapons = Object.values(itemDefs)
    .filter((item) => item.itemType === WEAPON_ITEM_TYPE && !item.redacted && !item.blacklisted && item.displayProperties?.name)
    .map((item) => ({
      ...mapItemDefinition(item, itemDefs, damageTypeDefs, socketCategories, breakerTypes, sandboxPerks),
      perkIds: collectWeaponPerkIds(item, itemDefs, plugSets, socketCategories, perkIdByName, perkTable),
      sources: sourcesForItem(item, collectibles, sourceIndex),
    }));

  perkTableCache = perkTable.map(({ iconFromEnhanced, ...perk }) => perk);
  weaponsCache = sortBySeason(dedupeWeapons(weapons, itemDefs));
  return weaponsCache;
}

export async function getPerks() {
  if (!perkTableCache) await getWeapons();
  return perkTableCache;
}

// Search vocabulary for source: and season:, with how many listed weapons each one covers.
export async function getFilters() {
  const weapons = await getWeapons();
  const { seasons: seasonDefs } = await loadTables();

  const sourceCounts = new Map();
  const seasonCounts = new Map();
  for (const w of weapons) {
    for (const s of w.sources) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
    if (w.season != null) seasonCounts.set(w.season, (seasonCounts.get(w.season) ?? 0) + 1);
  }

  const sources = Object.entries(dimSourcesCache ?? {})
    .map(([key, info]) => ({ key, aliases: info.aliases, count: sourceCounts.get(key) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  const bungieNames = new Map(
    Object.values(seasonDefs).filter((s) => s.seasonNumber != null).map((s) => [s.seasonNumber, s.displayProperties?.name?.trim()])
  );
  const dimTags = new Map();
  for (const [tag, number] of Object.entries(seasonTagsCache ?? {})) {
    if (number > LAST_DIM_TAGGED_SEASON) continue;
    if (!dimTags.has(number)) dimTags.set(number, []);
    dimTags.get(number).push(tag);
  }

  const numbers = new Set([...bungieNames.keys(), ...Object.keys(SEASON_OVERRIDES).map(Number)]);
  const seasons = [...numbers]
    .filter((n) => n <= LAST_DIM_TAGGED_SEASON || SEASON_OVERRIDES[n])
    .map((n) => {
      const override = SEASON_OVERRIDES[n];
      const name = override?.name ?? bungieNames.get(n) ?? `Season ${n}`;
      const tags = [...new Set([...(dimTags.get(n) ?? []), ...(override?.tags ?? [])])];
      return { number: n, name, tags, count: seasonCounts.get(n) ?? 0 };
    })
    .sort((a, b) => b.number - a.number);

  return { sources, seasons };
}

// Piecewise-linear interpolation per Bungie's DestinyStatGroupDefinition contract:
// investment (raw) stat value -> display value, via a sorted list of {value, weight} points.
function interpolateStat(rawValue, points) {
  if (!points || points.length === 0) return rawValue;
  const sorted = [...points].sort((a, b) => a.weight - b.weight);
  if (rawValue <= sorted[0].weight) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (rawValue >= last.weight) return last.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (rawValue >= a.weight && rawValue <= b.weight) {
      const t = (rawValue - a.weight) / (b.weight - a.weight);
      return Math.round(a.value + t * (b.value - a.value));
    }
  }
  return rawValue;
}

function buildStats(item, statDefs, statGroupDefs, statDeltas = new Map()) {
  const rawStats = item.stats?.stats ?? {};
  const statGroup = item.stats?.statGroupHash ? statGroupDefs[item.stats.statGroupHash] : null;
  const scaledStats = statGroup?.scaledStats ?? [];
  const scaledHashes = new Set(scaledStats.map((s) => String(s.statHash)));

  const bars = [];
  const info = [];

  // displayAsNumeric stats (Charge Time, Magazine, RPM, etc.) are meant to be shown as
  // their raw value, not scaled 0-100 — their displayInterpolation tables are often
  // degenerate (e.g. two points at the same weight) and aren't meant for bar scaling.
  for (const s of scaledStats) {
    const def = statDefs[s.statHash];
    const name = def?.displayProperties?.name;
    if (!name) continue;
    const baseRaw = rawStats[s.statHash]?.value ?? 0;
    const raw = baseRaw + (statDeltas.get(s.statHash) ?? 0);

    if (s.displayAsNumeric) {
      if (raw > 0) info.push({ statHash: s.statHash, name, value: raw });
    } else {
      bars.push({
        statHash: s.statHash,
        name,
        value: Math.max(0, interpolateStat(raw, s.displayInterpolation)),
        maximumValue: s.maximumValue ?? 100,
      });
    }
  }

  for (const [hash, stat] of Object.entries(rawStats)) {
    if (scaledHashes.has(hash)) continue;
    const name = statDefs[hash]?.displayProperties?.name;
    const value = stat.value + (statDeltas.get(Number(hash)) ?? 0);
    if (name && value > 0) info.push({ statHash: Number(hash), name, value });
  }

  return { bars, info };
}

function statDeltaMap(plugItem) {
  const map = new Map();
  for (const s of plugItem?.investmentStats ?? []) {
    map.set(s.statTypeHash, (map.get(s.statTypeHash) ?? 0) + s.value);
  }
  return map;
}

// Masterwork sockets expose the full global catalog (every stat x tiers 1-9, ~150+ options).
// Since this report shows each weapon's complete/max state, collapse to just the maxed
// "Masterworked: X" entry per stat rather than every intermediate tier.
function collapseMasterworkTiers(options) {
  const hasTiers = options.some((o) => /^Tier \d+:/.test(o.name));
  if (!hasTiers) return options;

  const seen = new Set();
  return options.filter((o) => {
    if (!o.name.startsWith("Masterworked:")) return false;
    if (seen.has(o.name)) return false;
    seen.add(o.name);
    return true;
  });
}

// Bungie's plug sets frequently contain duplicate entries for the same perk (distinct
// hashes for a base unlock vs. an artifact/vendor-unlocked copy) — same name, same effect.
function dedupeByName(options) {
  const seen = new Set();
  return options.filter((o) => {
    if (seen.has(o.name)) return false;
    seen.add(o.name);
    return true;
  });
}

function resolvePerkOptions(entry, itemDefs, plugSets) {
  const options = plugHashesForEntry(entry, plugSets)
    .map((hash) => itemDefs[hash])
    .filter((p) => p?.displayProperties?.name)
    .map((p) => {
      const isEnhanced = p.itemTypeDisplayName?.startsWith("Enhanced") ?? false;
      return {
        hash: p.hash,
        name: isEnhanced ? `${p.displayProperties.name} (Enhanced)` : p.displayProperties.name,
        icon: iconUrl(p.displayProperties.icon),
        description: p.displayProperties.description ?? "",
        clarityText: clarityTextForHash(p.hash),
        isDefault: p.hash === entry.singleInitialItemHash,
        isEnhanced,
        investmentStats: p.investmentStats ?? [],
      };
    });

  const deduped = dedupeByName(collapseMasterworkTiers(options));
  const meaningful = deduped.filter((o) => !EMPTY_SOCKET_NAMES.has(o.name));
  return meaningful.length > 0 ? meaningful : deduped;
}

function buildSockets(item, itemDefs, plugSets, socketCategoryDefs) {
  const categories = item.sockets?.socketCategories ?? [];
  const entries = item.sockets?.socketEntries ?? [];

  return categories
    .map((category) => {
      const categoryDef = socketCategoryDefs[category.socketCategoryHash];
      const categoryName = categoryDef?.displayProperties?.name ?? "Other";
      if (EXCLUDED_SOCKET_CATEGORIES.has(categoryName.toLowerCase())) return null;

      const columns = category.socketIndexes
        .map((index) => ({ index, options: resolvePerkOptions(entries[index], itemDefs, plugSets) }))
        .filter((col) => col.options.length > 0);
      if (columns.length === 0) return null;

      return { categoryName, columns };
    })
    .filter(Boolean);
}

// For each column, pick the active perk: the one in selectedHashes if it belongs to that
// column, otherwise the column's default. Returns { activePerkHash per column, statDeltas }.
function resolveSelections(sockets, selectedHashes) {
  const selectedSet = new Set(selectedHashes);
  const statDeltas = new Map();
  const resolvedColumns = [];

  for (const category of sockets) {
    for (const column of category.columns) {
      const defaultOption = column.options.find((o) => o.isDefault) ?? column.options[0];
      const chosenOption = column.options.find((o) => selectedSet.has(o.hash)) ?? defaultOption;

      resolvedColumns.push({ index: column.index, activeHash: chosenOption.hash });

      if (chosenOption.hash !== defaultOption.hash) {
        const defaultDeltas = statDeltaMap(defaultOption);
        const chosenDeltas = statDeltaMap(chosenOption);
        const allStatHashes = new Set([...defaultDeltas.keys(), ...chosenDeltas.keys()]);
        for (const statHash of allStatHashes) {
          const diff = (chosenDeltas.get(statHash) ?? 0) - (defaultDeltas.get(statHash) ?? 0);
          if (diff !== 0) statDeltas.set(statHash, (statDeltas.get(statHash) ?? 0) + diff);
        }
      }
    }
  }

  return { resolvedColumns, statDeltas };
}

// The masterwork socket offers every stat in the game; keep only the stats this weapon has.
function limitMasterworksToWeaponStats(sockets, stats) {
  const statNames = new Set([...stats.bars, ...stats.info].map((s) => s.name));
  return sockets.map((category) => ({
    ...category,
    columns: category.columns.map((col) => {
      if (!col.options.every((o) => o.name.startsWith("Masterworked:"))) return col;
      const kept = col.options.filter((o) => statNames.has(o.name.replace("Masterworked:", "").trim()));
      return kept.length > 0 ? { ...col, options: kept } : col;
    }),
  }));
}

export async function getWeaponDetail(hash, selectedHashes = []) {
  const { items: itemDefs, damageTypes, statDefs, statGroupDefs, plugSets, socketCategories, breakerTypes, sandboxPerks } = await loadTables();

  const item = itemDefs[hash];
  if (!item || item.itemType !== WEAPON_ITEM_TYPE) return null;

  const sockets = buildSockets(item, itemDefs, plugSets, socketCategories);
  const { resolvedColumns, statDeltas } = resolveSelections(sockets, selectedHashes);

  const activeHashByIndex = new Map(resolvedColumns.map((c) => [c.index, c.activeHash]));
  const socketsWithSelection = sockets.map((category) => ({
    ...category,
    columns: category.columns.map((col) => ({ ...col, activeHash: activeHashByIndex.get(col.index) })),
  }));

  const stats = buildStats(item, statDefs, statGroupDefs, statDeltas);
  return {
    ...mapItemDefinition(item, itemDefs, damageTypes, socketCategories, breakerTypes, sandboxPerks),
    stats,
    sockets: limitMasterworksToWeaponStats(socketsWithSelection, stats),
  };
}
