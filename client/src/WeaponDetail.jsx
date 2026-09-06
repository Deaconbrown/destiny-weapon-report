import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { tierColor } from "./tiers.js";
import TierStars from "./TierStars.jsx";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function WeaponDetail() {
  const { hash } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  function selectPerk(clickedColumnIndex, clickedHash) {
    const allColumns = weapon.sockets.flatMap((c) => c.columns);
    const nextHashes = allColumns
      .filter((col) => col.options.length > 1)
      .map((col) => (col.index === clickedColumnIndex ? clickedHash : col.activeHash));

    setSearchParams(nextHashes.length ? { perks: nextHashes.join(",") } : {});
  }

  if (loading) return <div className="page"><p className="status">Loading weapon...</p></div>;
  if (error) return <div className="page"><p className="status error">Error: {error}</p><Link to="/">&larr; Back to search</Link></div>;
  if (!weapon) return null;

  return (
    <div className="page">
      <Link to="/" className="back-link">&larr; Back to search</Link>

      <div className="detail-header">
        <div className="detail-icon-wrap">
          {weapon.icon && <img className="detail-icon" src={weapon.icon} alt={weapon.name} />}
          {weapon.tierStars && <TierStars count={weapon.tierStars} />}
        </div>
        <div>
          <h1>{weapon.name}</h1>
          <p className="weapon-type">{weapon.weaponCategory}</p>
          <div className="weapon-tags">
            <span className="tag tier-tag" style={{ borderColor: tierColor(weapon.tierType), color: tierColor(weapon.tierType) }}>
              {weapon.tierType}
            </span>
            {weapon.damageType && <span className="tag">{weapon.damageType}</span>}
            <span className="tag">{weapon.ammoType}</span>
            {weapon.season != null && <span className="tag">Season {weapon.season}</span>}
          </div>
        </div>
      </div>

      {weapon.flavorText && <p className="flavor-text">{weapon.flavorText}</p>}

      {weapon.screenshot && <img className="detail-screenshot" src={weapon.screenshot} alt="" />}

      {weapon.stats.bars.length > 0 && (
        <section className="detail-section">
          <h2>Stats</h2>
          <div className="stat-list">
            {weapon.stats.bars.map((s) => (
              <div className="stat-row" key={s.statHash}>
                <span className="stat-name">{s.name}</span>
                <div className="stat-track">
                  <div className="stat-fill" style={{ width: `${Math.min(100, (s.value / s.maximumValue) * 100)}%` }} />
                </div>
                <span className="stat-value">{s.value}</span>
              </div>
            ))}
          </div>
          {weapon.stats.info.length > 0 && (
            <div className="stat-info-row">
              {weapon.stats.info.map((s) => (
                <span className="stat-info-chip" key={s.statHash}>
                  {s.name}: <strong>{s.value}</strong>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {weapon.sockets.map((category) => (
        <section className="detail-section" key={category.categoryName}>
          <h2>{category.categoryName}</h2>
          <div className="perk-columns">
            {category.columns.map((col) => (
              <div className="perk-column" key={col.index}>
                {col.options.map((perk) => {
                  const selectable = col.options.length > 1;
                  const isActive = perk.hash === col.activeHash;
                  return (
                    <button
                      type="button"
                      key={perk.hash}
                      className={`perk${isActive ? " perk-active" : ""}${selectable ? " perk-selectable" : ""}`}
                      title={perk.description}
                      disabled={!selectable}
                      onClick={() => selectable && selectPerk(col.index, perk.hash)}
                    >
                      {perk.icon && <img src={perk.icon} alt={perk.name} />}
                      <span>{perk.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
