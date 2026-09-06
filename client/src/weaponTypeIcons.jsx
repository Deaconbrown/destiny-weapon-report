// Small original line-icon set distinguishing weapon types in the list view.
// Bungie's API has no generic "weapon type" glyph (DestinyItemCategoryDefinition has no
// icons), so these are simple abstract silhouettes drawn for this project — not the
// game's own icons, which aren't exposed via the public API.
const ICONS = {
  "Auto Rifle": "M2 11h14v3H2zM16 12h4v1h-4zM4 14v3h2v-3z",
  "Hand Cannon": "M3 12h8v2H3zM11 10h3v5h-3zM6 14v3h2v-3z",
  "Pulse Rifle": "M2 11h5v3H2zM8 11h4v3H8zM17 12h3v1h-3zM4 14v3h2v-3z",
  "Scout Rifle": "M2 12h17v1H2zM7 9h4v3H7zM5 13v3h2v-3z",
  "Sniper Rifle": "M1 12h19v1H1zM8 8h5v4H8zM6 13v4h2v-4z",
  "Shotgun": "M2 12h13v2H2zM15 11h4v4h-4zM4 14v3h2v-3z",
  "Submachine Gun": "M3 11h11v3H3zM14 12h3v1h-3zM5 14v3h2v-3z",
  "Sidearm": "M4 12h6v2H4zM10 11h2v4h-2zM6 14v2h2v-2z",
  "Fusion Rifle": "M2 12h10v1H2zM12 10h3l2 2-2 2h-3zM5 13v3h2v-3z",
  "Linear Fusion Rifle": "M1 12h14v1H1zM15 10h2l2 2-2 2h-2zM4 13v3h2v-3z",
  "Rocket Launcher": "M2 13h13v2H2zM15 12l4 1.5v1L15 16zM5 15v2h2v-2z",
  "Grenade Launcher": "M2 12h10v2H2zM12 11h5v4h-5zM4 14v3h2v-3z",
  "Sword": "M11 2l1 1-8 8-2-1zM4 11l2 2-3 3-2-1z",
  "Bow": "M4 2c6 2 6 18 0 20M8 12h11l-3-3M19 12l-3 3",
  "Trace Rifle": "M2 12h13v1H2zM15 11h3v3h-3zM5 13v3h2v-3zM19 12.5a1 1 0 100 0",
  "Machine Gun": "M2 11h14v2H2zM4 13v4h3v-4zM8 13v4h3v-4zM17 11h3v3h-3z",
  "Glaive": "M4 2v20M4 6l7 3-7 3z",
  "Combat Bow": "M4 2c6 2 6 18 0 20M8 12h11l-3-3M19 12l-3 3",
};

const FALLBACK = "M4 4h16v16H4zM8 8h8v8H8z";

export default function WeaponTypeIcon({ type, className }) {
  const d = ICONS[type] ?? FALLBACK;
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
