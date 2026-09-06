import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { tierColor } from "./tiers.js";
import { damageColor } from "./damageTypes.js";
import { slugify } from "./slug.js";
import TierStars from "./TierStars.jsx";
import WeaponTypeIcon from "./weaponTypeIcons.jsx";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function GridCard({ w }) {
  return (
    <Link className="weapon-card" to={`/weapon/${w.hash}/${slugify(w.name)}`}>
      <div className="card-icon-wrap">
        {w.icon && <img src={w.icon} alt={w.name} loading="lazy" />}
        {w.tierStars && <TierStars count={w.tierStars} size={9} />}
      </div>
      <div className="weapon-info">
        <h3>{w.name}</h3>
        <p className="weapon-type">{w.weaponCategory}</p>
        <div className="weapon-tags">
          <span className="tag tier-tag" style={{ borderColor: tierColor(w.tierType), color: tierColor(w.tierType) }}>
            {w.tierType}
          </span>
          {w.damageType && (
            <span className="tag" style={{ borderColor: damageColor(w.damageType), color: damageColor(w.damageType) }}>
              {w.damageType}
            </span>
          )}
          <span className="tag">{w.ammoType}</span>
          {w.season != null && <span className="tag">S{w.season}</span>}
        </div>
      </div>
    </Link>
  );
}

function ListRow({ w }) {
  return (
    <Link className="weapon-row" to={`/weapon/${w.hash}/${slugify(w.name)}`}>
      <span className="row-damage-dot" style={{ backgroundColor: damageColor(w.damageType) }} title={w.damageType ?? ""} />
      <span className="row-season">{w.season != null ? `S${w.season}` : ""}</span>
      <span className="row-icon-box">
        {w.icon ? <img className="row-icon" src={w.icon} alt={w.name} loading="lazy" /> : null}
      </span>
      <span className="row-name">{w.name}</span>
      <span className="row-type">
        <WeaponTypeIcon type={w.itemTypeDisplayName} className="row-type-icon" />
        {w.itemTypeDisplayName}
      </span>
      <span className="row-champion">
        {w.championIcon && <img className="row-champion-icon" src={w.championIcon} alt={w.championName ?? ""} title={w.championName ?? ""} />}
      </span>
      <span className="row-frame">
        {w.frameIcon ? <img className="row-frame-icon" src={w.frameIcon} alt="" /> : null}
        {w.frameName}
      </span>
    </Link>
  );
}

export default function WeaponList() {
  const [weapons, setWeapons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameFilter, setNameFilter] = useState("");
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("dwr-view-mode") ?? "grid");

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/api/weapons`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setWeapons(data.results))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function changeView(mode) {
    setViewMode(mode);
    try {
      localStorage.setItem("dwr-view-mode", mode);
    } catch {
      /* private browsing or storage disabled — view choice just won't persist */
    }
  }

  const filtered = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    if (!needle) return weapons;
    return weapons.filter((w) => w.name.toLowerCase().includes(needle));
  }, [weapons, nameFilter]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Destiny Weapon Report</h1>
        <p>Search Destiny 2 weapons by name.</p>
      </header>

      <div className="filters">
        <input
          type="text"
          placeholder="Search weapon name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <div className="view-toggle">
          <button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => changeView("grid")}>Grid</button>
          <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => changeView("list")}>List</button>
        </div>
      </div>

      {loading && <p className="status">Loading weapons...</p>}
      {error && <p className="status error">Error: {error}</p>}
      {!loading && !error && (
        <>
          <p className="result-count">{filtered.length} weapons</p>
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
