import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "cache");
const META_PATH = path.join(CACHE_DIR, "meta.json");
const ITEMS_PATH = path.join(CACHE_DIR, "items.json");
const DAMAGE_TYPES_PATH = path.join(CACHE_DIR, "damage_types.json");

const AMMO_TYPE_LABELS = { 0: "None", 1: "Primary", 2: "Special", 3: "Heavy" };
const WEAPON_ITEM_TYPE = 3;

let weaponsCache = null;

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

function mapItemDefinition(item, damageTypeDefs) {
  const damageTypeHash = item.defaultDamageTypeHash ?? item.damageTypeHashes?.[0];
  const damageType = damageTypeHash ? damageTypeDefs[damageTypeHash] : null;
  const ammoTypeValue = item.equippingBlock?.ammoType ?? 0;

  return {
    hash: item.hash,
    name: item.displayProperties?.name ?? "",
    icon: item.displayProperties?.icon ? `https://www.bungie.net${item.displayProperties.icon}` : null,
    screenshot: item.screenshot ? `https://www.bungie.net${item.screenshot}` : null,
    flavorText: item.flavorText ?? "",
    itemTypeDisplayName: item.itemTypeDisplayName ?? "",
    weaponCategory: item.itemTypeAndTierDisplayName ?? item.itemTypeDisplayName ?? "",
    damageType: damageType?.displayProperties?.name ?? null,
    damageTypeIcon: damageType?.displayProperties?.icon
      ? `https://www.bungie.net${damageType.displayProperties.icon}`
      : null,
    ammoType: AMMO_TYPE_LABELS[ammoTypeValue] ?? "Unknown",
    tierType: item.inventory?.tierTypeName ?? "",
    isWeapon: item.itemType === WEAPON_ITEM_TYPE,
  };
}

export async function ensureManifestCache(apiKey) {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const manifest = await fetchManifest(apiKey);
  const liveVersion = manifest.version;
  const cachedMeta = await readJsonIfExists(META_PATH);

  const itemsPathRemote = manifest.jsonWorldComponentContentPaths?.en?.DestinyInventoryItemDefinition;
  const damageTypesPathRemote = manifest.jsonWorldComponentContentPaths?.en?.DestinyDamageTypeDefinition;

  if (!itemsPathRemote || !damageTypesPathRemote) {
    throw new Error("Manifest response missing expected definition table paths");
  }

  const upToDate = cachedMeta?.version === liveVersion;
  const itemsExist = await readJsonIfExists(ITEMS_PATH);
  const damageTypesExist = await readJsonIfExists(DAMAGE_TYPES_PATH);

  if (upToDate && itemsExist && damageTypesExist) {
    console.log(`Manifest cache up to date (version ${liveVersion})`);
    return;
  }

  console.log(`Downloading manifest definitions (version ${liveVersion})...`);
  const [itemDefs, damageTypeDefs] = await Promise.all([
    fetchDefinitionTable(apiKey, itemsPathRemote),
    fetchDefinitionTable(apiKey, damageTypesPathRemote),
  ]);

  await fs.writeFile(ITEMS_PATH, JSON.stringify(itemDefs));
  await fs.writeFile(DAMAGE_TYPES_PATH, JSON.stringify(damageTypeDefs));
  await fs.writeFile(META_PATH, JSON.stringify({ version: liveVersion, updatedAt: new Date().toISOString() }));

  weaponsCache = null;
  console.log("Manifest definitions cached.");
}

export async function getWeapons() {
  if (weaponsCache) return weaponsCache;

  const itemDefs = await readJsonIfExists(ITEMS_PATH);
  const damageTypeDefs = await readJsonIfExists(DAMAGE_TYPES_PATH);
  if (!itemDefs || !damageTypeDefs) {
    throw new Error("Manifest cache not ready — call ensureManifestCache first");
  }

  const weapons = Object.values(itemDefs)
    .filter((item) => item.itemType === WEAPON_ITEM_TYPE && !item.redacted && !item.blacklisted && item.displayProperties?.name)
    .map((item) => mapItemDefinition(item, damageTypeDefs));

  weaponsCache = weapons;
  return weapons;
}
