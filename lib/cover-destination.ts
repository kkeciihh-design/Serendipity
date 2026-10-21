/**
 * The shared cover-header data layer.
 *
 * Four surfaces (/trips, /trips/[id], /runtime, /settings) each open with the
 * same 220-260px photographic cover. This module decides *which* photograph
 * that cover shows, from the traveller's own words, and it is deliberately a
 * pure module: no IO, no "use client", no React, no randomness, no clocks.
 * The same call therefore produces the same bytes on the server and on the
 * client, which is what keeps hydration quiet.
 *
 * It reads `lib/destination-gallery.ts` (read-only) and mirrors the keyword
 * tables of `lib/destination-inference.ts` instead of importing them: that
 * module owns the *card* destination label and changing its table must never
 * silently repaint every cover. Both files stay untouched.
 */
import { destinationGallery, type GalleryDestination, type GalleryPhoto } from "./destination-gallery";

export type { GalleryPhoto };

/** Text accepted by every helper here: anything callers happen to hold. */
export type CoverText = string | null | undefined;

// Longest-first is not needed for these tables because the rules below are
// ordered and the first hit wins; the order *is* the priority.
type CoverRule = { id: string; pattern: RegExp };

/**
 * Ordered cover rules. Rule order matches the brief:
 * 1 Hangzhou -> West Lake, 2 Guilin -> Li River, 3 Fujian -> Xiapu,
 * 4 coastal Shandong -> Xiapu, 5 Huangshan/Hongcun -> Hongcun,
 * 6 Jiuzhaigou -> Jiuzhaigou, 7 fallback -> West Lake.
 */
const COVER_RULES: readonly CoverRule[] = [
  { id: "west-lake", pattern: /杭州|西湖|灵隐|千岛湖|乌镇|西塘/ },
  { id: "li-river", pattern: /桂林|阳朔|漓江|兴坪|遇龙河|龙脊/ },
  { id: "xiapu", pattern: /福建|泉州|西街|开元寺|洛伽寺|蟳埔|清源山|洛阳桥|厦门|鼓浪屿|福州|三坊七巷/ },
  { id: "xiapu", pattern: /青岛|栈桥|八大关|崂山/ },
  { id: "hongcun", pattern: /宏村|黄山|西递|屯溪/ },
  { id: "jiuzhaigou", pattern: /九寨沟|九寨|五花海|黄龙/ },
];

/** The last resort landscape. Always a real gallery entry. */
const FALLBACK_COVER_ID = "west-lake";

/** Compact scenic descriptor appended to a cover title. */
const SCENIC_SUFFIX: Record<string, string> = {
  "west-lake": "西湖湖山",
  "li-river": "漓江山水",
  xiapu: "霞浦滩涂",
  hongcun: "徽州月沼",
  jiuzhaigou: "九寨秋色",
};

/** The default heading when no destination can be named. */
export const DEFAULT_COVER_TITLE = "山河风物志";

/**
 * The gallery index, keyed by id. `destinationGallery` is frozen as a readonly
 * array at module load but a few entries are pushed onto it once on import
 * (`lib/gallery-additions.json`), so the index is built after that happens.
 */
const GALLERY_BY_ID = new Map<string, GalleryDestination>(
  destinationGallery.map((destination) => [destination.id, destination]),
);

/** Resolve a gallery id to a real entry, walking back to [0] if it is absent. */
function destinationById(id: string | null | undefined): GalleryDestination {
  return GALLERY_BY_ID.get(id ?? "") ?? GALLERY_BY_ID.get(FALLBACK_COVER_ID) ?? destinationGallery[0];
}

/**
 * The "current" landscape for a page that has no trip context.
 *
 * Deliberate trade-off: the home gallery lets the visitor pin a landscape in
 * localStorage, and a server component cannot read that key. These pages are
 * rendered on the server, so they show the home page's *default* first entry
 * (`destinationGallery[0]`, Jiuzhaigou) instead of guessing at browser state.
 * That keeps server and first client render identical -- no hydration mismatch,
 * no flash of a different photograph -- at the cost of ignoring a client-side
 * preference until a later page load. Pure and argument-free on purpose.
 */
export function activeCoverPhoto(): GalleryPhoto {
  return destinationGallery[0].photo;
}

/** Same trade-off as `activeCoverPhoto`, as the destination itself. */
export function activeCoverDestination(): GalleryDestination {
  return destinationGallery[0];
}

function normalize(destination: CoverText, originalRequest: CoverText): string {
  const parts: string[] = [];
  if (typeof destination === "string" && destination) parts.push(destination);
  if (typeof originalRequest === "string" && originalRequest) parts.push(originalRequest);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

/** The gallery landscape a destination's words point at. Never null, never throws. */
export function coverDestination(destination: CoverText, originalRequest: CoverText): GalleryDestination {
  const text = normalize(destination, originalRequest);
  if (text.length >= 2) {
    const rule = COVER_RULES.find((item) => item.pattern.test(text));
    if (rule) return destinationById(rule.id);
  }
  return destinationById(FALLBACK_COVER_ID);
}

/**
 * The photograph for the cover of `destination`'s page. Any input is safe:
 * null, undefined, an empty string, a number, a very long string and a frozen
 * object all resolve to a real `GalleryPhoto` that exists in the gallery.
 */
export function coverPhotoForDestination(destination: CoverText, originalRequest: CoverText): GalleryPhoto {
  return coverDestination(destination, originalRequest).photo;
}

/**
 * The wording under/above the cover title: "西湖湖山" for West Lake,
 * "山河风物志" when nothing can be named. Never empty, never throws.
 */
export function coverDestinationName(destination: CoverText, originalRequest: CoverText): string {
  const text = normalize(destination, originalRequest);
  if (text.length < 2) return DEFAULT_COVER_TITLE;
  const rule = COVER_RULES.find((item) => item.pattern.test(text));
  if (!rule) return DEFAULT_COVER_TITLE;
  return SCENIC_SUFFIX[rule.id] ?? DEFAULT_COVER_TITLE;
}
