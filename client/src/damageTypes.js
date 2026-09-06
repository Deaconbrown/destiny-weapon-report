// Destiny 2's own element colors — the game's standard convention.
export const DAMAGE_TYPE_COLORS = {
  Kinetic: "#e8e6e0",
  Arc: "#79daf2",
  Solar: "#f27a1b",
  Void: "#b483d1",
  Stasis: "#4d88ff",
  Strand: "#2fbf83",
};

export function damageColor(damageType) {
  return DAMAGE_TYPE_COLORS[damageType] ?? "#9aa1ac";
}
