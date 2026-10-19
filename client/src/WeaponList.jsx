import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { tierColor } from "./tiers.js";
import { slugify } from "./slug.js";
import TierStars from "./TierStars.jsx";
import WeaponTypeIcon from "./weaponTypeIcons.jsx";
import SearchBar from "./SearchBar.jsx";
import { buildSuggestionContext, filterWeapons, formatQuery, parseQuery } from "./searchQuery.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function GridCard({ w }) {
  const tint = tierColor(w.tierType);
  return (
    <Link className="weapon-card" style={{ borderColor: tint }} to={`/weapon/${w.hash}/${slugify(w.name)}`}>
      <div className="card-icon-square" style={{ backgroundColor: `${tint}26` }}>
        {w.icon && <img src={w.icon} alt={w.name} loading="lazy" />}
        <div className="card-badges">
          {w.season != null && <span className="card-season-badge">S{w.season}</span>}
          {w.tierStars && <TierStars count={w.tierStars} size={8} />}
        </div>
      </div>
      <h3 className="card-name">{w.name}</h3>
      <div className="card-meta">
        {w.damageTypeIcon && (
          <img className="damage-icon" src={w.damageTypeIcon} alt={w.damageType ?? ""} title={w.damageType ?? ""} />
        )}
        <span className="card-meta-item">{w.ammoType}</span>
        {w.championIcon && <img className="card-champion-icon" src={w.championIcon} alt={w.championName ?? ""} title={w.championName ?? ""} />}
      </div>
      {w.frameName && (
        <div className="card-frame">
          {w.frameIcon && <img src={w.frameIcon} alt="" />}
          {w.frameName}
        </div>
      )}
    </Link>
  );
}

function ListRow({ w }) {
  return (
    <Link className="weapon-row" to={`/weapon/${w.hash}/${slugify(w.name)}`}>
      <span className="row-damage">
        {w.damageTypeIcon && <img className="damage-icon" src={w.damageTypeIcon} alt={w.damageType ?? ""} title={w.damageType ?? ""} />}
      </span>
      <span className="row-season">{w.season != null ? `S${w.season}` : ""}</span>
      <span className="row-icon-box">
        {w.icon ? <img className="row-icon" src={w.icon} alt={w.name} loading="lazy" /> : null}
        {w.tierStars && (
          <span className="row-stars">
            <TierStars count={w.tierStars} size={7} />
          </span>
        )}
      </span>
      <span className="row-name">{w.name}</span>
      <span className="row-type">
        <WeaponTypeIcon type={w.itemTypeDisplayName} className="row-type-icon" />
        {w.itemTypeDisplayName}
      </span>
      <span className="row-frame">
        {w.championIcon && <img className="row-champion-icon" src={w.championIcon} alt={w.championName ?? ""} title={w.championName ?? ""} />}
        {w.frameIcon ? <img className="row-frame-icon" src={w.frameIcon} alt="" /> : null}
        {w.frameName}
      </span>
    </Link>
  );
}

export default function WeaponList() {
  const [weapons, setWeapons] = useState([]);
  const [perks, setPerks] = useState([]);
  const [filters, setFilters] = useState({ sources: [], seasons: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("dwr-view-mode") ?? "grid";
    } catch {
      return "grid";
    }
  });

  // The search lives in the URL (?q=perk:discord is:strand) so it can be bookmarked or shared.
  const query = searchParams.get("q") ?? "";
  const tokens = useMemo(() => parseQuery(query), [query]);

  function changeTokens(next) {
    const q = formatQuery(next);
    setSearchParams(q ? { q } : {}, { replace: true });
  }

  useEffect(() => {
    setLoading(true);
    const getJson = (path) =>
      fetch(`${API_BASE_URL}${path}`).then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      });
    Promise.all([getJson("/api/weapons"), getJson("/api/perks"), getJson("/api/filters")])
      .then(([weaponData, perkData, filterData]) => {
        setWeapons(weaponData.results);
        setPerks(perkData.results);
        setFilters(filterData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const suggestionContext = useMemo(() => buildSuggestionContext(weapons, perks, filters), [weapons, perks, filters]);

  function changeView(mode) {
    setViewMode(mode);
    try {
      localStorage.setItem("dwr-view-mode", mode);
    } catch {
      /* private browsing or storage disabled — view choice just won't persist */
    }
  }

  const filtered = useMemo(() => filterWeapons(weapons, tokens, { perks, filters }), [weapons, tokens, perks, filters]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Destiny Weapon Report</h1>
        <p>Search Destiny 2 weapons by name, perk, damage type, weapon type, frame, source, season and more.</p>
      </header>

      <div className="filters">
        <SearchBar tokens={tokens} onChange={changeTokens} context={suggestionContext} />
        <div className="view-toggle">
          <button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => changeView("grid")}>Grid</button>
          <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => changeView("list")}>List</button>
        </div>
      </div>

      {loading && <p className="status">Loading weapons...</p>}
      {error && <p className="status error">Error: {error}</p>}
      {!loading && !error && (
        <>
          <p className="result-count">{tokens.length > 0 ? `${filtered.length} matches` : `${filtered.length} weapons`}</p>
          {viewMode === "grid" ? (
            <div className="weapon-grid">
              {filtered.map((w) => <GridCard w={w} key={w.hash} />)}
            </div>
          ) : (
            <div className="weapon-list">
              {filtered.map((w) => <ListRow w={w} key={w.hash} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
