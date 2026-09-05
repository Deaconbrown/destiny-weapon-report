// Destiny 2's own rarity tier colors — the game's standard convention, not a custom palette.
export const TIER_COLORS = {
  Common: "#c3bcb4",
  Uncommon: "#366f42",
  Rare: "#5076a3",
  Legendary: "#522f65",
  Exotic: "#ceae33",
};

export function tierColor(tierType) {
  return TIER_COLORS[tierType] ?? "#5a5f6b";
}
