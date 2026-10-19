// Chip-style search: each token is { key, value }. key "name" is plain text against the
// weapon name; the others are filters written as key:value (e.g. perk:discord, is:strand).
// A weapon must match every token.

export const FILTER_KEYS = ["perk", "is", "type", "frame", "season", "champion"];

const DAMAGE_VALUES = ["kinetic", "arc", "solar", "void", "stasis", "strand"];
const AMMO_VALUES = ["primary", "special", "heavy"];
const RARITY_VALUES = ["exotic", "legendary", "rare", "uncommon", "common"];
const ADEPT_PATTERN = /\((adept|timelost|harrowed)\)/i;

export const KEY_HINTS = {
  perk: "any perk the weapon can roll",
  is: "damage, ammo or rarity",
  type: "weapon type",
  frame: "intrinsic frame",
  season: "release season, e.g. 29 or >=24",
  champion: "anti-champion type",
};

// Lowercase, strip accents and punctuation so "handcannon" matches "Hand Cannon"
// and "hakke" matches "Häkke".
export function norm(text) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const TOKEN_PATTERN = /(\w+):"([^"]*)"?|(\w+):(\S+)|"([^"]*)"?|(\S+)/g;

export function parseQuery(query) {
  const tokens = [];
  for (const m of (query ?? "").matchAll(TOKEN_PATTERN)) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const value = m[2] ?? m[4];
    if (key && FILTER_KEYS.includes(key)) {
      if (value.trim()) tokens.push({ key, value: value.trim().toLowerCase() });
    } else {
      const text = m[5] ?? m[0];
      if (text.trim()) tokens.push({ key: "name", value: text.trim().toLowerCase() });
    }
  }
  return tokens;
}

function quoteIfNeeded(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function formatToken(token) {
  return token.key === "name" ? quoteIfNeeded(token.value) : `${token.key}:${quoteIfNeeded(token.value)}`;
}

export function formatQuery(tokens) {
  return tokens.map(formatToken).join(" ");
}

export function chipLabel(token) {
  return token.key === "name" ? token.value : `${token.key}:${token.value}`;
}

function seasonMatcher(value) {
  const range = /^(\d+)-(\d+)$/.exec(value);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    return (s) => s >= lo && s <= hi;
  }
  const cmp = /^(>=|<=|>|<|=)?(\d+)$/.exec(value);
  if (!cmp) return () => false;
  const n = Number(cmp[2]);
  switch (cmp[1]) {
    case ">=": return (s) => s >= n;
    case "<=": return (s) => s <= n;
    case ">": return (s) => s > n;
    case "<": return (s) => s < n;
    default: return (s) => s === n;
  }
}

// A typed perk value picks the exact perk if one has that name, otherwise every perk
// whose name contains it (so perk:kill finds Kill Clip, Killing Wind, ...).
function perkIdsFor(value, perks) {
  const needle = norm(value);
  const exact = perks.filter((p) => norm(p.name) === needle);
  const hits = exact.length > 0 ? exact : perks.filter((p) => norm(p.name).includes(needle));
  return new Set(hits.map((p) => p.id));
}

function tokenPredicate(token, perks) {
  const v = norm(token.value);
  switch (token.key) {
    case "name":
      return (w) => norm(w.name).includes(v);
    case "perk": {
      const ids = perkIdsFor(token.value, perks);
      return (w) => w.perkIds.some((id) => ids.has(id));
    }
    case "is":
      if (DAMAGE_VALUES.includes(v)) return (w) => norm(w.damageType) === v;
      if (AMMO_VALUES.includes(v)) return (w) => norm(w.ammoType) === v;
      if (RARITY_VALUES.includes(v)) return (w) => norm(w.tierType) === v;
      if (v === "adept") return (w) => ADEPT_PATTERN.test(w.name);
      return (w) => norm(w.itemTypeDisplayName) === v;
    case "type":
      return (w) => norm(w.itemTypeDisplayName).includes(v);
    case "frame":
      return (w) => norm(w.frameName).includes(v);
    case "season": {
      const test = seasonMatcher(token.value.replace(/\s/g, ""));
      return (w) => w.season != null && test(w.season);
    }
    case "champion":
      return (w) => norm(w.championName).includes(v);
    default:
      return () => true;
  }
}

export function filterWeapons(weapons, tokens, perks) {
  if (tokens.length === 0) return weapons;
  const predicates = tokens.map((t) => tokenPredicate(t, perks));
  return weapons.filter((w) => predicates.every((p) => p(w)));
}

// Values offered for each key, built once from the loaded data.
export function buildSuggestionContext(weapons, perks) {
  const unique = (pick) => [...new Set(weapons.map(pick).filter(Boolean))].sort();
  return {
    perks: [...perks].sort((a, b) => a.name.localeCompare(b.name)),
    types: unique((w) => w.itemTypeDisplayName),
    frames: unique((w) => w.frameName),
    champions: unique((w) => w.championName),
    seasons: unique((w) => w.season).sort((a, b) => b - a),
  };
}

const MAX_SUGGESTIONS = 10;

function rankByMatch(items, needle, getName) {
  const starts = [];
  const contains = [];
  for (const item of items) {
    const n = norm(getName(item));
    if (n.startsWith(needle)) starts.push(item);
    else if (n.includes(needle)) contains.push(item);
  }
  return [...starts, ...contains];
}

function valueSuggestions(key, partial, ctx) {
  const needle = norm(partial);
  const tok = (value, label, extra = {}) => ({ token: { key, value: value.toLowerCase() }, label, ...extra });

  switch (key) {
    case "perk":
      return rankByMatch(ctx.perks, needle, (p) => p.name).map((p) => tok(p.name, `perk:${p.name}`, { hint: p.kind, icon: p.icon }));
    case "is": {
      const groups = [
        ...DAMAGE_VALUES.map((v) => [v, "damage"]),
        ...AMMO_VALUES.map((v) => [v, "ammo"]),
        ...RARITY_VALUES.map((v) => [v, "rarity"]),
        ["adept", "adept / timelost / harrowed"],
      ];
      return groups.filter(([v]) => v.includes(needle)).map(([v, hint]) => tok(v, `is:${v}`, { hint }));
    }
    case "type":
      return rankByMatch(ctx.types, needle, (t) => t).map((t) => tok(t, `type:${t.toLowerCase()}`, { hint: "weapon type" }));
    case "frame":
      return rankByMatch(ctx.frames, needle, (f) => f).map((f) => tok(f, `frame:${f.toLowerCase()}`, { hint: "frame" }));
    case "champion":
      return rankByMatch(ctx.champions, needle, (c) => c).map((c) => tok(c, `champion:${c.toLowerCase()}`, { hint: "champion" }));
    case "season":
      return ctx.seasons.filter((s) => String(s).startsWith(partial.replace(/[^\d]/g, ""))).map((s) => tok(String(s), `season:${s}`, { hint: "season" }));
    default:
      return [];
  }
}

export function getSuggestions(text, ctx) {
  const trimmed = text.trimStart();
  if (!trimmed || !ctx) return [];

  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const key = trimmed.slice(0, colon).toLowerCase();
    if (!FILTER_KEYS.includes(key)) return [];
    const partial = trimmed.slice(colon + 1).replace(/^"/, "");
    if (key === "season" && /[<>=-]/.test(partial)) {
      return [{ token: { key, value: partial.trim() }, label: `season:${partial.trim()}`, hint: "season range" }];
    }
    return valueSuggestions(key, partial, ctx).slice(0, MAX_SUGGESTIONS);
  }

  const needle = norm(trimmed);
  const keyHits = FILTER_KEYS.filter((k) => k.startsWith(needle)).map((k) => ({
    complete: `${k}:`,
    label: `${k}:`,
    hint: KEY_HINTS[k],
  }));
  const valueHits = [
    ...valueSuggestions("is", trimmed, ctx),
    ...valueSuggestions("type", trimmed, ctx),
    ...valueSuggestions("perk", trimmed, ctx),
    ...valueSuggestions("frame", trimmed, ctx),
  ];

  return [
    { token: { key: "name", value: trimmed.trim().toLowerCase() }, label: `name contains "${trimmed.trim()}"`, hint: "weapon name" },
    ...keyHits,
    ...valueHits,
  ].slice(0, MAX_SUGGESTIONS);
}
