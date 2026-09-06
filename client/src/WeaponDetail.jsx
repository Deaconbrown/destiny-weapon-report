import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { tierColor } from "./tiers.js";
import { damageColor } from "./damageTypes.js";
import TierStars from "./TierStars.jsx";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function PerkTooltip({ perk }) {
  return (
    <div className="perk-tooltip">
      <div className="perk-tooltip-name">{perk.name}</div>
      {perk.description && <div className="perk-tooltip-desc">{perk.description}</div>}
      {perk.clarityText && (
        <>
          <div className="perk-tooltip-credit">Community research by Clarity</div>
          {perk.clarityText.map((line, i) =>
            line === "" ? <div key={i} className="perk-tooltip-spacer" /> : <div key={i}>{line}</div>
          )}
        </>
      )}
    </div>
  );
}

function PerkSlot({ column, isOpen, onToggle, onSelect }) {
  const active = column.options.find((o) => o.hash === column.activeHash) ?? column.options[0];
  const selectable = column.options.length > 1;

  return (
    <div className="perk-slot">
      <div className="perk-icon-wrap">
        <button
          type="button"
          className={`perk-icon${isOpen ? " perk-icon-open" : ""}`}
          disabled={!selectable}
          onClick={() => selectable && onToggle()}
        >
          {active.icon ? <img src={active.icon} alt={active.name} /> : <span className="perk-icon-fallback">{active.name[0]}</span>}
        </button>
        <PerkTooltip perk={active} />
      </div>

      {isOpen && (
        <div className="perk-dropdown">
          {column.options.map((opt) => (
            <div className="perk-dropdown-item-wrap" key={opt.hash}>
              <button
                type="button"
                className={`perk-dropdown-item${opt.hash === column.activeHash ? " perk-dropdown-item-active" : ""}`}
                onClick={() => onSelect(opt.hash)}
              >
                {opt.icon ? <img src={opt.icon} alt="" /> : <span className="perk-icon-fallback">{opt.name[0]}</span>}
                <span>{opt.name}</span>
              </button>
              <PerkTooltip perk={opt} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WeaponDetail() {
  const { hash } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openColumn, setOpenColumn] = useState(null);

  const perksParam = searchParams.get("perks") ?? "";

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

  useEffect(() => setOpenColumn(null), [hash]);

  function selectPerk(clickedColumnIndex, clickedHash) {
    const allColumns = weapon.sockets.flatMap((c) => c.columns);
    const nextHashes = allColumns
      .filter((col) => col.options.length > 1)
      .map((col) => (col.index === clickedColumnIndex ? clickedHash : col.activeHash));

    setSearchParams(nextHashes.length ? { perks: nextHashes.join(",") } : {});
    setOpenColumn(null);
  }

  if (loading) return <div className="page"><p className="status">Loading weapon...</p></div>;
  if (error) return <div className="page"><p className="status error">Error: {error}</p><Link to="/">&larr; Back to search</Link></div>;
  if (!weapon) return null;

  const allStatRows = [
    ...weapon.stats.bars.map((s) => ({ ...s, isBar: true })),
    ...weapon.stats.info.map((s) => ({ ...s, isBar: false })),
  ];

  return (
    <div className="page page-wide">
      <Link to="/" className="back-link">&larr; Back to search</Link>

      <div className="detail-layout">
        <div className="detail-hero">
          {weapon.screenshot ? (
            <img className="detail-screenshot" src={weapon.screenshot} alt="" />
          ) : (
            <div className="detail-screenshot detail-screenshot-fallback" />
          )}

          <div className="hero-overlay">
            <div className="hero-badges">
              {weapon.damageTypeIcon && (
                <img className="hero-damage-icon" src={weapon.damageTypeIcon} alt={weapon.damageType} style={{ backgroundColor: damageColor(weapon.damageType) }} />
              )}
              {weapon.season != null && <span className="hero-season">S{weapon.season}</span>}
              {weapon.tierStars && <TierStars count={weapon.tierStars} size={10} />}
            </div>

            <div className="hero-perks-grid">
              {weapon.sockets.flatMap((category) =>
                category.columns.map((col) => (
                  <PerkSlot
                    key={col.index}
                    column={col}
                    isOpen={openColumn === col.index}
                    onToggle={() => setOpenColumn(openColumn === col.index ? null : col.index)}
                    onSelect={(h) => selectPerk(col.index, h)}
                  />
                ))
              )}
            </div>
          </div>
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
