// Chip-style search: each token is { key, value }. key "name" is plain text against the
// weapon name; the others are filters written as key:value (e.g. perk:discord, is:strand).
// A weapon must match every token.

export const FILTER_KEYS = ["perk", "is", "type", "frame", "source", "season", "champion"];

const DAMAGE_VALUES = ["kinetic", "arc", "solar", "void", "stasis", "strand"];
const AMMO_VALUES = ["primary", "special", "heavy"];
const RARITY_VALUES = ["exotic", "legendary", "rare", "uncommon", "common"];
const ADEPT_PATTERN = /\((adept|timelost|harrowed)\)/i;
const SEASON_NUMBER_PATTERN = /^((>=|<=|>|<|=)?\d+|\d+-\d+)$/;

export const KEY_HINTS = {
  perk: "any perk the weapon can roll",
  is: "damage, ammo or rarity",
  type: "weapon type",
  frame: "intrinsic frame",
  source: "where it drops, e.g. ironbanner, trials, raid",
  season: "season number or name, e.g. 29, >=24, heresy",
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

function seasonNumberMatcher(value) {
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

// Exact tag/name first ("heresy", "monumentoftriumph"), otherwise any season whose name or
// tag contains the text.
function seasonsForName(value, seasons) {
  const v = norm(value);
  const exact = seasons.filter((s) => norm(s.name) === v || s.tags.some((t) => norm(t) === v));
  return exact.length > 0 ? exact : seasons.filter((s) => norm(s.name).includes(v) || s.tags.some((t) => norm(t).includes(v)));
}

function sourcesForName(value, sources) {
  const v = norm(value);
  const exact = sources.filter((s) => s.key === v || s.aliases.some((a) => norm(a) === v));
  return exact.length > 0 ? exact : sources.filter((s) => s.key.includes(v) || s.aliases.some((a) => norm(a).includes(v)));
}

// A typed perk value picks the exact perk if one has that name, otherwise every perk
// whose name contains it (so perk:kill finds Kill Clip, Killing Wind, ...).
function perkIdsFor(value, perks) {
  const needle = norm(value);
  const exact = perks.filter((p) => norm(p.name) === needle);
  const hits = exact.length > 0 ? exact : perks.filter((p) => norm(p.name).includes(needle));
  return new Set(hits.map((p) => p.id));
}

function tokenPredicate(token, data) {
  const v = norm(token.value);
  switch (token.key) {
    case "name":
      return (w) => norm(w.name).includes(v);
    case "perk": {
      const ids = perkIdsFor(token.value, data.perks);
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
    case "source": {
      const keys = new Set(sourcesForName(token.value, data.filters.sources).map((s) => s.key));
      return (w) => w.sources.some((s) => keys.has(s));
    }
    case "season": {
      // "s27" and "s24-s27" are read as plain season numbers.
      const value = token.value.replace(/\s/g, "").replace(/s(?=\d)/g, "");
      if (SEASON_NUMBER_PATTERN.test(value)) {
        const test = seasonNumberMatcher(value);
        return (w) => w.season != null && test(w.season);
      }
      const numbers = new Set(seasonsForName(token.value, data.filters.seasons).map((s) => s.number));
      return (w) => numbers.has(w.season);
    }
    case "champion":
      return (w) => norm(w.championName).includes(v);
    default:
      return () => true;
  }
}

// data = { perks, filters: { sources, seasons } }
export function filterWeapons(weapons, tokens, data) {
  if (tokens.length === 0) return weapons;
  const predicates = tokens.map((t) => tokenPredicate(t, data));
  return weapons.filter((w) => predicates.every((p) => p(w)));
}

// Values offered for each key, built once from the loaded data.
export function buildSuggestionContext(weapons, perks, filters) {
  const unique = (pick) => [...new Set(weapons.map(pick).filter(Boolean))].sort();
  return {
    perks: [...perks].sort((a, b) => a.name.localeCompare(b.name)),
    types: unique((w) => w.itemTypeDisplayName),
    frames: unique((w) => w.frameName),
    champions: unique((w) => w.championName),
    sources: filters.sources,
    seasons: filters.seasons.filter((s) => s.count > 0),
  };
}

const MAX_SUGGESTIONS = 10;

function rankByMatch(items, needle, getNames) {
  const starts = [];
  const contains = [];
  for (const item of items) {
    const names = [].concat(getNames(item)).map(norm);
    if (names.some((n) => n.startsWith(needle))) starts.push(item);
    else if (names.some((n) => n.includes(needle))) contains.push(item);
  }
  return [...starts, ...contains];
}

const seasonTag = (s) => s.tags[0] ?? norm(s.name);
const plural = (n) => `${n} weapon${n === 1 ? "" : "s"}`;

function seasonSuggestion(s) {
  return { token: { key: "season", value: seasonTag(s) }, label: `season:${seasonTag(s)}`, hint: `S${s.number} ${s.name} · ${plural(s.count)}` };
}

function sourceSuggestion(s) {
  const alias = s.aliases.length > 0 ? ` (${s.aliases.join(", ")})` : "";
  return { token: { key: "source", value: s.key }, label: `source:${s.key}`, hint: `${plural(s.count)}${alias}` };
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
    case "source":
      return rankByMatch(ctx.sources, needle, (s) => [s.key, ...s.aliases]).map(sourceSuggestion);
    case "season": {
      const digits = partial.trim().replace(/^s(?=\d)/i, "");
      if (/^\d*$/.test(digits)) {
        return ctx.seasons
          .filter((s) => String(s.number).startsWith(digits))
          .map((s) => tok(String(s.number), `season:${s.number}`, { hint: `${s.name} · ${plural(s.count)}` }));
      }
      return rankByMatch(ctx.seasons, needle, (s) => [s.name, ...s.tags]).map(seasonSuggestion);
    }
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

  // "S27" / "S24-27" is shorthand for a season number or range.
  const seasonShort = /^s(\d+)(?:-s?(\d+))?$/i.exec(trimmed.trim());
  if (seasonShort) {
    const [lo, hi] = [Number(seasonShort[1]), Number(seasonShort[2] ?? seasonShort[1])];
    const inRange = ctx.seasons.filter((s) => s.number >= Math.min(lo, hi) && s.number <= Math.max(lo, hi));
    const count = inRange.reduce((sum, s) => sum + s.count, 0);
    const value = seasonShort[2] ? `${lo}-${hi}` : String(lo);
    const hint = !seasonShort[2] && inRange[0] ? `S${lo} ${inRange[0].name} · ${plural(count)}` : `seasons ${value} · ${plural(count)}`;
    return [
      { token: { key: "season", value }, label: `season:${value}`, hint },
      { token: { key: "name", value: trimmed.trim().toLowerCase() }, label: `name contains "${trimmed.trim()}"`, hint: "weapon name" },
    ];
  }

  const needle = norm(trimmed);
  // A bare word that IS a season or source goes first, so Enter makes that chip
  // ("heresy" -> season:heresy, "ironbanner" -> source:ironbanner). Season wins a tie.
  const exactSeasons = ctx.seasons.filter((s) => norm(s.name) === needle || s.tags.some((t) => norm(t) === needle));
  const exactSources = ctx.sources.filter((s) => s.key === needle || s.aliases.some((a) => norm(a) === needle));
  const exactHits = [...exactSeasons.map(seasonSuggestion), ...exactSources.map(sourceSuggestion)];
  const exactLabels = new Set(exactHits.map((s) => s.label));

  const keyHits = FILTER_KEYS.filter((k) => k.startsWith(needle)).map((k) => ({
    complete: `${k}:`,
    label: `${k}:`,
    hint: KEY_HINTS[k],
  }));
  const valueHits = [
    ...valueSuggestions("is", trimmed, ctx),
    ...valueSuggestions("type", trimmed, ctx),
    ...valueSuggestions("source", trimmed, ctx).slice(0, 3),
    ...valueSuggestions("season", trimmed, ctx).slice(0, 3),
    ...valueSuggestions("perk", trimmed, ctx),
    ...valueSuggestions("frame", trimmed, ctx),
  ].filter((s) => !exactLabels.has(s.label));

  return [
    ...exactHits,
    { token: { key: "name", value: trimmed.trim().toLowerCase() }, label: `name contains "${trimmed.trim()}"`, hint: "weapon name" },
    ...keyHits,
    ...valueHits,
  ].slice(0, MAX_SUGGESTIONS);
}
