/**
 * Each trip card carries a differently toned header so the collection reads as
 * an atlas rather than a stack of identical tickets. The tone is chosen from the
 * destination and the card index, so a given trip always looks the same.
 *
 * The header is a clean soft gradient in deep pine green / deep indigo blue.
 * There is deliberately no crosshatch, slanted grid or checker pattern: the
 * only ornament is the large pale folio number in the corner.
 */

export type CardTexture = {
  id: "mountain" | "coast" | "ancient" | "river";
  /** CSS custom-property values applied to the header. */
  from: string;
  to: string;
  /** Ink colour for text sitting on this header. */
  ink: string;
  /** A short label for the tone. */
  label: string;
};

const TEXTURES: CardTexture[] = [
  { id: "mountain", from: "#1e4034", to: "#14302a", ink: "#eef3ea", label: "深松绿" },
  { id: "coast", from: "#1b3346", to: "#14273a", ink: "#eaf1f6", label: "深黛蓝" },
  { id: "ancient", from: "#23453a", to: "#1a2c3d", ink: "#eef3ec", label: "松黛青" },
  { id: "river", from: "#1d3d3a", to: "#152c3c", ink: "#e9f2ef", label: "江黛蓝" },
];

// A destination that obviously belongs to a landscape gets that texture first.
const AFFINITY: { pattern: RegExp; id: CardTexture["id"] }[] = [
  { pattern: /海|岛|湾|港|澳|霞浦|青岛|三亚|厦门|舟山|北海|深圳/, id: "coast" },
  { pattern: /古城|古镇|泉州|西安|敦煌|大理|丽江|平遥|宏村|西塘|乌镇|洛阳|开封|南京/, id: "ancient" },
  { pattern: /江|湖|河|溪|桂林|漓江|阳朔|西湖|洱海|千岛湖|九寨|三峡|武汉|苏州/, id: "river" },
  { pattern: /山|岭|峰|森林|九寨|黄山|长白|张家界|峨眉|泰山|霞浦|高原/, id: "mountain" },
];

/** Deterministically pick a header texture for one card. */
export function cardTexture(destination: string | null | undefined, index = 0): CardTexture {
  const text = (destination ?? "").trim();
  if (text) {
    const match = AFFINITY.find((item) => item.pattern.test(text));
    if (match) return TEXTURES.find((texture) => texture.id === match.id) as CardTexture;
  }
  // No affinity: rotate by position so neighbouring cards still differ.
  return TEXTURES[((index % TEXTURES.length) + TEXTURES.length) % TEXTURES.length];
}

/** The inline style carrying a texture onto the header element. */
export function cardTextureStyle(texture: CardTexture) {
  return {
    backgroundImage: `linear-gradient(142deg, ${texture.from}, ${texture.to})`,
    color: texture.ink,
  } as const;
}
