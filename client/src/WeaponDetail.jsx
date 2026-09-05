import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { tierColor } from "./tiers.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function WeaponDetail() {
  const { hash } = useParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/weapons/${hash}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Weapon not found" : `Request failed: ${res.status}`);
        return res.json();
      })
      .then(setWeapon)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [hash]);

  if (loading) return <div className="page"><p className="status">Loading weapon...</p></div>;
  if (error) return <div className="page"><p className="status error">Error: {error}</p><Link to="/">&larr; Back to search</Link></div>;
  if (!weapon) return null;

  return (
    <div className="page">
      <Link to="/" className="back-link">&larr; Back to search</Link>

      <div className="detail-header">
        {weapon.icon && <img className="detail-icon" src={weapon.icon} alt={weapon.name} />}
        <div>
          <h1>{weapon.name}</h1>
          <p className="weapon-type">{weapon.weaponCategory}</p>
          <div className="weapon-tags">
            <span className="tag tier-tag" style={{ borderColor: tierColor(weapon.tierType), color: tierColor(weapon.tierType) }}>
              {weapon.tierType}
            </span>
            {weapon.damageType && <span className="tag">{weapon.damageType}</span>}
            <span className="tag">{weapon.ammoType}</span>
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
                {col.options.map((perk) => (
                  <div className="perk" key={perk.hash} title={perk.description}>
                    {perk.icon && <img src={perk.icon} alt={perk.name} />}
                    <span>{perk.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
