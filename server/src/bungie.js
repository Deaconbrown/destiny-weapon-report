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
};

const AMMO_TYPE_LABELS = { 0: "None", 1: "Primary", 2: "Special", 3: "Heavy" };
const WEAPON_ITEM_TYPE = 3;

let weaponsCache = null;
let tableCache = null;

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
  console.log("Manifest definitions cached.");
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

function mapItemDefinition(item, damageTypeDefs) {
  const damageTypeHash = item.defaultDamageTypeHash ?? item.damageTypeHashes?.[0];
  const damageType = damageTypeHash ? damageTypeDefs[damageTypeHash] : null;
  const ammoTypeValue = item.equippingBlock?.ammoType ?? 0;

  return {
    hash: item.hash,
    name: item.displayProperties?.name ?? "",
    icon: iconUrl(item.displayProperties?.icon),
    screenshot: item.screenshot ? `https://www.bungie.net${item.screenshot}` : null,
    flavorText: item.flavorText ?? "",
    itemTypeDisplayName: item.itemTypeDisplayName ?? "",
    weaponCategory: item.itemTypeAndTierDisplayName ?? item.itemTypeDisplayName ?? "",
    damageType: damageType?.displayProperties?.name ?? null,
    damageTypeIcon: iconUrl(damageType?.displayProperties?.icon),
    ammoType: AMMO_TYPE_LABELS[ammoTypeValue] ?? "Unknown",
    tierType: item.inventory?.tierTypeName ?? "",
    isWeapon: item.itemType === WEAPON_ITEM_TYPE,
  };
}

export async function getWeapons() {
  if (weaponsCache) return weaponsCache;

  const { items: itemDefs, damageTypes: damageTypeDefs } = await loadTables();

  const weapons = Object.values(itemDefs)
    .filter((item) => item.itemType === WEAPON_ITEM_TYPE && !item.redacted && !item.blacklisted && item.displayProperties?.name)
    .map((item) => mapItemDefinition(item, damageTypeDefs));

  weaponsCache = weapons;
  return weapons;
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

function buildStats(item, statDefs, statGroupDefs) {
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
    const raw = rawStats[s.statHash]?.value ?? 0;

    if (s.displayAsNumeric) {
      if (raw > 0) info.push({ statHash: s.statHash, name, value: raw });
    } else {
      bars.push({
        statHash: s.statHash,
        name,
        value: interpolateStat(raw, s.displayInterpolation),
        maximumValue: s.maximumValue ?? 100,
      });
    }
  }

  for (const [hash, stat] of Object.entries(rawStats)) {
    if (scaledHashes.has(hash)) continue;
    const name = statDefs[hash]?.displayProperties?.name;
    if (name && stat.value > 0) info.push({ statHash: Number(hash), name, value: stat.value });
  }

  return { bars, info };
}

function resolvePerkOptions(entry, itemDefs, plugSets) {
  const plugSetHash = entry.randomizedPlugSetHash || entry.reusablePlugSetHash;
  let plugItemHashes = [];

  if (plugSetHash && plugSets[plugSetHash]) {
    plugItemHashes = plugSets[plugSetHash].reusablePlugItems.map((p) => p.plugItemHash);
  } else if (entry.singleInitialItemHash) {
    plugItemHashes = [entry.singleInitialItemHash];
  }

  return plugItemHashes
    .map((hash) => itemDefs[hash])
    .filter((p) => p?.displayProperties?.name)
    .map((p) => ({
      hash: p.hash,
      name: p.displayProperties.name,
      icon: iconUrl(p.displayProperties.icon),
      description: p.displayProperties.description ?? "",
    }));
}

function buildSockets(item, itemDefs, plugSets, socketCategoryDefs) {
  const categories = item.sockets?.socketCategories ?? [];
  const entries = item.sockets?.socketEntries ?? [];

  return categories
    .map((category) => {
      const categoryDef = socketCategoryDefs[category.socketCategoryHash];
      const columns = category.socketIndexes
        .map((index) => ({ index, options: resolvePerkOptions(entries[index], itemDefs, plugSets) }))
        .filter((col) => col.options.length > 0);

      return {
        categoryName: categoryDef?.displayProperties?.name ?? "Other",
        columns,
      };
    })
    .filter((cat) => cat.columns.length > 0);
}

export async function getWeaponDetail(hash) {
  const { items: itemDefs, damageTypes, statDefs, statGroupDefs, plugSets, socketCategories } = await loadTables();

  const item = itemDefs[hash];
  if (!item || item.itemType !== WEAPON_ITEM_TYPE) return null;

  return {
    ...mapItemDefinition(item, damageTypes),
    stats: buildStats(item, statDefs, statGroupDefs),
    sockets: buildSockets(item, itemDefs, plugSets, socketCategories),
  };
}
