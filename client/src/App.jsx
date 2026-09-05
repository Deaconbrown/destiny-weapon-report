import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export default function App() {
  const [weapons, setWeapons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [nameFilter, setNameFilter] = useState("");
  const [damageTypeFilter, setDamageTypeFilter] = useState("");
  const [ammoTypeFilter, setAmmoTypeFilter] = useState("");

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

  const damageTypes = useMemo(
    () => [...new Set(weapons.map((w) => w.damageType).filter(Boolean))].sort(),
    [weapons]
  );
  const ammoTypes = useMemo(
    () => [...new Set(weapons.map((w) => w.ammoType).filter(Boolean))].sort(),
    [weapons]
  );

  const filtered = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    return weapons.filter((w) => {
      if (needle && !w.name.toLowerCase().includes(needle)) return false;
      if (damageTypeFilter && w.damageType !== damageTypeFilter) return false;
      if (ammoTypeFilter && w.ammoType !== ammoTypeFilter) return false;
      return true;
    });
  }, [weapons, nameFilter, damageTypeFilter, ammoTypeFilter]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Destiny Weapon Report</h1>
        <p>Search and filter Destiny 2 weapons by name, damage type, and ammo type.</p>
      </header>

      <div className="filters">
        <input
          type="text"
          placeholder="Search weapon name..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <select value={damageTypeFilter} onChange={(e) => setDamageTypeFilter(e.target.value)}>
          <option value="">All damage types</option>
          {damageTypes.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={ammoTypeFilter} onChange={(e) => setAmmoTypeFilter(e.target.value)}>
          <option value="">All ammo types</option>
          {ammoTypes.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading && <p className="status">Loading weapons...</p>}
      {error && <p className="status error">Error: {error}</p>}
      {!loading && !error && (
        <>
          <p className="result-count">{filtered.length} weapons</p>
          <div className="weapon-grid">
            {filtered.map((w) => (
              <div className="weapon-card" key={w.hash}>
                {w.icon && <img src={w.icon} alt={w.name} loading="lazy" />}
                <div className="weapon-info">
                  <h3>{w.name}</h3>
                  <p className="weapon-type">{w.weaponCategory}</p>
                  <div className="weapon-tags">
                    {w.damageType && <span className="tag">{w.damageType}</span>}
                    <span className="tag">{w.ammoType}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
