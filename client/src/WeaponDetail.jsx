import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { tierColor } from "./tiers.js";
import { damageColor } from "./damageTypes.js";
import TierStars from "./TierStars.jsx";
import { slugify } from "./slug.js";
import { filterWeapons, parseQuery } from "./searchQuery.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const isTrackerColumn = (col) => col.options.every((o) => /Tracker$/.test(o.name));
const isMasterworkColumn = (col) => col.options.every((o) => o.name.startsWith("Masterworked:"));
const isGearTierColumn = (col) => col.options.some((o) => /Gear Tier Upgrade|^Tier \d Upgrade$/.test(o.name));
// Not mods: memento slot and the old crafting enhancement levels.
const isMementoColumn = (col) => col.options.every((o) => /Memento/.test(o.name));
const isEnhancementLevelColumn = (col) => col.options.every((o) => /^Enhancement \d+$|^Empty Enhancement Socket$/.test(o.name));
const baseName = (name) => name.replace(/ \(Enhanced\)$/, "");

// One icon per perk: enhanced versions fold into their base perk (the base is shown and
// selected; if only the enhanced copy exists it stands in for the base).
function mergeEnhanced(options) {
  const byName = new Map();
  for (const o of options) {
    const key = baseName(o.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...o, name: key, hashes: [o.hash], hasEnhanced: o.isEnhanced });
    } else {
      const hashes = [...existing.hashes, o.hash];
      const base = existing.isEnhanced && !o.isEnhanced ? o : existing;
      byName.set(key, { ...base, name: key, hashes, hasEnhanced: true });
    }
  }
  return [...byName.values()];
}

// Splits the API's socket categories into the page's perk columns, frame and mods.
const ADEPT_WEAPON = /\((Adept|Timelost|Harrowed)\)/;
const isAdeptMod = (mod) => /^Adept /.test(mod.name);

function layoutSockets(sockets, weaponName) {
  const frame = sockets.find((c) => c.categoryName === "INTRINSIC TRAITS")?.columns[0]?.options[0] ?? null;
  const perkColumns = (sockets.find((c) => c.categoryName === "WEAPON PERKS")?.columns ?? [])
    .filter((col) => !isTrackerColumn(col))
    .map((col) => ({ ...col, options: mergeEnhanced(col.options) }));
  const modColumns = sockets.find((c) => c.categoryName === "WEAPON MODS")?.columns ?? [];
  const masterwork = modColumns.find(isMasterworkColumn) ?? null;
  // Show the Enhanced mods when the gun has them (names without the suffix); older guns
  // only have normal mods, so show those instead.
  const allMods = modColumns
    .filter((col) => !isMasterworkColumn(col) && !isGearTierColumn(col) && !isMementoColumn(col) && !isEnhancementLevelColumn(col))
    .flatMap((col) => col.options);
  const enhancedMods = allMods.filter((m) => m.isEnhanced).map((m) => ({ ...m, name: baseName(m.name) }));
  // Adept mods only fit Adept weapons; there they're listed first.
  const normalMods = ADEPT_WEAPON.test(weaponName)
    ? [...allMods.filter(isAdeptMod), ...allMods.filter((m) => !isAdeptMod(m))]
    : allMods.filter((m) => !isAdeptMod(m));
  const mods = enhancedMods.length > 0 ? enhancedMods : normalMods;
  return { frame, masterwork, perkColumns, mods };
}

function PerkButton({ perk, selected, square, onSelect, onHover }) {
  return (
    <button
      type="button"
      className={`perk-btn${square ? " perk-btn-square" : ""}${selected ? " perk-btn-selected" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => onHover(perk)}
      onFocus={() => onHover(perk)}
      aria-pressed={selected}
      aria-label={perk.name}
    >
      {perk.icon ? <img src={perk.icon} alt="" /> : <span className="perk-btn-fallback">{perk.name[0]}</span>}
    </button>
  );
}

function PerkDescription({ perk }) {
  if (!perk) return null;
  return (
    <div className="perk-desc">
      {perk.icon && <img src={perk.icon} alt="" />}
      <div>
        <div className="perk-desc-name">{perk.name}</div>
        {perk.description && <div className="perk-desc-text">{perk.description}</div>}
        {perk.clarityText && (
          <div className="perk-desc-clarity">
            <div className="perk-desc-credit">Community research by Clarity</div>
            {perk.clarityText.map((line, i) => (line === "" ? <div key={i} className="perk-desc-spacer" /> : <div key={i}>{line}</div>))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WeaponDetail() {
  const { hash } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [cutoutFailed, setCutoutFailed] = useState(null);
  const [listData, setListData] = useState(null);
  const currentRowRef = useRef(null);

  const perksParam = searchParams.get("perks") ?? "";
  const query = searchParams.get("q") ?? "";
  const queryString = query ? `?q=${encodeURIComponent(query)}` : "";

  // Weapons, perks and filters for the results list on the left (loaded once).
  useEffect(() => {
    const getJson = (path) => fetch(`${API_BASE_URL}${path}`).then((res) => (res.ok ? res.json() : Promise.reject(res.status)));
    Promise.all([getJson("/api/weapons"), getJson("/api/perks"), getJson("/api/filters")])
      .then(([w, p, f]) => setListData({ weapons: w.results, perks: p.results, filters: f }))
      .catch(() => setListData({ weapons: [], perks: [], filters: { sources: [], seasons: [] } }));
  }, []);

  const results = useMemo(
    () => (listData ? filterWeapons(listData.weapons, parseQuery(query), { perks: listData.perks, filters: listData.filters }) : []),
    [listData, query]
  );

  // Braces matter: scrollIntoView can return a Promise, and an effect must return nothing.
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [hash, results]);
  const chosenHashes = useMemo(() => new Set(perksParam.split(",").filter(Boolean).map(Number)), [perksParam]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = new URL(`${API_BASE_URL}/api/weapons/${hash}`);
    if (perksParam) url.searchParams.set("perks", perksParam);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Weapon not found" : `Request failed: ${res.status}`);
        return res.json();
      })
      .then(setWeapon)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hash, perksParam]);

  useEffect(() => {
    setHovered(null);
  }, [hash]);

  const layout = useMemo(() => (weapon ? layoutSockets(weapon.sockets, weapon.name) : null), [weapon]);

  // A perk shows as selected when it was picked (in ?perks=) or is its column's fixed default.
  function isSelected(column, perk) {
    const hashesOf = (o) => o.hashes ?? [o.hash];
    if (hashesOf(perk).some((h) => chosenHashes.has(h))) return true;
    const pickedInColumn = column.options.some((o) => hashesOf(o).some((h) => chosenHashes.has(h)));
    return !pickedInColumn && Boolean(perk.isDefault);
  }

  // Pick a perk in its column; clicking the picked one again clears that column.
  function selectPerk(column, perk) {
    const columnHashes = new Set(column.options.flatMap((o) => o.hashes ?? [o.hash]));
    const next = [...chosenHashes].filter((h) => !columnHashes.has(h));
    if (!isSelected(column, perk) || perk.isDefault) next.push(perk.hash);
    const params = {};
    if (query) params.q = query;
    if (next.length) params.perks = next.join(",");
    setSearchParams(params, { replace: true });
  }

  if (loading && !weapon) return <div className="page"><p className="status">Loading weapon...</p></div>;
  if (error) return <div className="page"><p className="status error">Error: {error}</p><Link to="/">&larr; Back to search</Link></div>;
  if (!weapon || !layout) return null;

  const allStatRows = [
    ...weapon.stats.bars.map((s) => ({ ...s, isBar: true })),
    ...weapon.stats.info.map((s) => ({ ...s, isBar: false })),
  ];

  return (
    <div className="page page-wide">
      <div className="detail-layout">
        <aside className="detail-results">
          <Link to={`/${queryString}`} className="back-link">&larr; All weapons</Link>
          <p className="results-count">RESULTS {listData ? results.length : "…"}</p>
          <div className="results-list">
            {results.map((w) => {
              const current = String(w.hash) === String(weapon.hash);
              return (
                <Link
                  key={w.hash}
                  ref={current ? currentRowRef : null}
                  to={`/weapon/${w.hash}/${slugify(w.name)}${queryString}`}
                  className={`result-item${current ? " result-item-current" : ""}`}
                >
                  {w.icon && <img src={w.icon} alt="" loading="lazy" />}
                  <span>{w.name}</span>
                </Link>
              );
            })}
          </div>
        </aside>

        <div className="detail-center">
          <div className="detail-hero">
            <div className="hero-content">
              <div className="hero-badges">
                {weapon.damageTypeIcon && (
                  <img className="hero-damage-icon" src={weapon.damageTypeIcon} alt={weapon.damageType} title={weapon.damageType} />
                )}
                {weapon.season != null && <span className="hero-season">S{weapon.season}</span>}
                {weapon.tierStars && <TierStars count={weapon.tierStars} size={10} />}
              </div>

              <div className="detail-perks">
                <div className="perk-grid">
                  {layout.masterwork && (
                    <div className="perk-col">
                      {layout.masterwork.options.map((o) => (
                        <PerkButton
                          key={o.hash}
                          perk={o}
                          square
                          selected={isSelected(layout.masterwork, o)}
                          onSelect={() => selectPerk(layout.masterwork, o)}
                          onHover={setHovered}
                        />
                      ))}
                    </div>
                  )}
                  {layout.perkColumns.map((col) => (
                    <div className="perk-col" key={col.index}>
                      {col.options.map((o) => (
                        <PerkButton key={o.hash} perk={o} selected={isSelected(col, o)} onSelect={() => selectPerk(col, o)} onHover={setHovered} />
                      ))}
                    </div>
                  ))}
                </div>

                <PerkDescription perk={hovered ?? layout.frame} />
              </div>
            </div>

            {/* The gun cut out of Bungie's backdrop; glowing guns (or a failed cut-out) fall back
                to the original picture, darkened and faded into the page. */}
            <div className="hero-gun">
              {cutoutFailed !== weapon.hash ? (
                <img
                  key={weapon.hash}
                  className="hero-cutout"
                  src={`${API_BASE_URL}/api/picture/${weapon.hash}`}
                  alt={weapon.name}
                  onError={() => setCutoutFailed(weapon.hash)}
                />
              ) : (
                weapon.screenshot && <img className="hero-fallback" src={weapon.screenshot} alt={weapon.name} />
              )}
            </div>
          </div>

          {layout.mods.length > 0 && (
            <div className="mods-strip">
              <div className="mod-grid">
                {layout.mods.map((m) => (
                  <button type="button" key={m.hash} className="mod-btn" onMouseEnter={() => setHovered(m)} onFocus={() => setHovered(m)} aria-label={m.name}>
                    {m.icon ? <img src={m.icon} alt="" /> : <span className="perk-btn-fallback">{m.name[0]}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="detail-sidebar">
          <h1>{weapon.name}</h1>
          <p className="weapon-type">{weapon.weaponCategory}</p>

          <div className="weapon-tags">
            {weapon.damageType && (
              <span className="tag" style={{ borderColor: damageColor(weapon.damageType), color: damageColor(weapon.damageType) }}>
                {weapon.damageType}
              </span>
            )}
            {weapon.championName && (
              <span className="tag tag-with-icon">
                {weapon.championIcon && <img src={weapon.championIcon} alt="" />}
                {weapon.championName}
              </span>
            )}
            <span className="tag">{weapon.ammoType}</span>
            {weapon.frameName && <span className="tag">{weapon.frameName}</span>}
            <span className="tag tier-tag" style={{ borderColor: tierColor(weapon.tierType), color: tierColor(weapon.tierType) }}>
              {weapon.tierType}
            </span>
            {weapon.season != null && <span className="tag">Season {weapon.season}</span>}
          </div>

          {weapon.flavorText && <p className="flavor-text">{weapon.flavorText}</p>}

          <div className="sidebar-stat-list">
            {allStatRows.map((s) => (
              <div className="stat-row" key={s.statHash}>
                <span className="stat-name">{s.name}</span>
                {s.isBar ? (
                  <div className="stat-track">
                    <div className="stat-fill" style={{ width: `${Math.min(100, (s.value / s.maximumValue) * 100)}%` }} />
                  </div>
                ) : (
                  <div className="stat-track stat-track-empty" />
                )}
                <span className="stat-value">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="clarity-credit">
        Perk insights by <a href="https://www.d2clarity.com/" target="_blank" rel="noreferrer">Clarity</a>
      </p>
    </div>
  );
}
