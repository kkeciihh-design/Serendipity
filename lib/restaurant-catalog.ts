import type { AttractionFact, AttractionImage, AttractionSource } from "./attraction-catalog";
import { placeCandidateSchema, type PlaceCandidate } from "./places";
import assets from "./restaurant-assets.json";

export type RestaurantFact = Omit<AttractionFact, "status"> & { status: "verified" | "pending" | "estimated" };
export type RestaurantCatalogEntry = {
  id: string; name: string; aliases: string[]; city: string; address: string; description: string;
  dishes: RestaurantFact;
  price: RestaurantFact & { minCents: number | null; maxCents: number | null };
  opening: RestaurantFact & { periods: { start: string; end: string }[]; applicableFrom: string | null; applicableUntil: string | null };
  service: "individual" | "small_plates" | "shared" | "unknown";
  diningMinutes: { min: number; max: number };
  availability: { state: "unknown" | "closed" | "relocated"; sourceIds: string[]; applicableFrom: string | null; applicableUntil: string | null };
  queue: { minMinutes: number; maxMinutes: number; observedAt: string; sourceIds: string[] } | null;
  images: AttractionImage[]; sources: AttractionSource[]; location: PlaceCandidate | null;
};

const stores: AttractionSource = { id: "hgd-stores", title: "火宫殿官网 · 门店信息", publisher: "长沙火宫殿有限公司", kind: "official",
  url: assets.sources.official[0].url, retrievedAt: assets.sources.official[0].retrievedAt,
  quote: "火宫殿坡子街总店；地址：长沙市天心区坡子街127号；电话：0731-85814228。" };
const menu: AttractionSource = { id: "hgd-menu", title: "火宫殿官网 · 美食文化", publisher: "长沙火宫殿有限公司", kind: "official",
  url: assets.sources.official[1].url, retrievedAt: assets.sources.official[1].retrievedAt,
  quote: "宫殿臭豆腐、姊妹团子、龙脂猪血、三角干子、肉丝馓子、红烧猪脚；传统湘菜包括毛氏红烧肉、剁椒鱼头王。" };
const noodles: AttractionSource = { id: "xiaoer-guide", title: "Wikivoyage · Changsha / 小二面店", publisher: "Wikivoyage 社区旅行指南", kind: "community",
  ...assets.sources.voyage, quote: "Xiao'er Noodles Restaurant 小二面店；244 Tongtai St；10:00–14:00, 17:00–21:00；¥18；lastedit=2026-04-22；Noodles with tomato, green pepper or mushroom, with or without egg." };
const unknownAvailability = { state: "unknown" as const, sourceIds: [], applicableFrom: null, applicableUntil: null };
const fact = (text: string, notes = "未取得适用于本次用餐的资料。", sourceIds: string[] = []): RestaurantFact => ({ text, notes, sourceIds, status: "pending" });
const location = assets.locations.find((item) => item.entryId === "xinyuloudong-wanjiali")!;
const osmSource: AttractionSource = { id: "xinyuloudong-osm", title: "新玉楼东 · OpenStreetMap 地点", publisher: "OpenStreetMap contributors / Nominatim", kind: "osm",
  url: "https://www.openstreetmap.org/way/273730025", retrievedAt: location.candidate.retrievedAt,
  quote: `${location.candidate.address}；amenity=restaurant，cuisine=chinese。© OpenStreetMap contributors，ODbL 1.0。地点标记不证明仍在营业。` };

// A finite, reviewed directory. Brand names alone never identify a branch.
// References have no plan-date verification and no live queue/table inventory.
export const restaurantCatalog: RestaurantCatalogEntry[] = [
  { id: "huogongdian-pozi", name: "火宫殿坡子街总店", aliases: ["火宫殿（坡子街总店）", "火宫殿(坡子街总店)"], city: "长沙", address: "天心区坡子街127号",
    description: "坡子街总店提供长沙风味小吃和传统湘菜。可按小份逐项选择，也可多人分享；照片为该门店院落实景。",
    dishes: fact("宫殿臭豆腐、姊妹团子、龙脂猪血；多人可比较毛氏红烧肉、剁椒鱼头等湘菜。", "官网品牌菜品资料，实际供应、份量及过敏原请向这家门店确认。", [menu.id]),
    price: { ...fact("人均价格未知，可填写本餐预计人均。", "官网未提供适用日期的人均套餐或菜单金额，不能把单道菜价当整餐价格。"), minCents: null, maxCents: null },
    opening: { ...fact("营业时段待确认；官网门店电话 0731-85814228。", "已读取官网门店目录，但未取得当天营业及停止点餐时间。", [stores.id]), periods: [], applicableFrom: null, applicableUntil: null },
    service: "small_plates", diningMinutes: { min: 45, max: 75 }, availability: unknownAvailability, queue: null,
    images: assets.images, sources: [stores, menu, ...assets.images.map((image) => ({ id: image.id, title: "坡子街总店实景照片与许可", url: image.sourceUrl,
      publisher: "Wikimedia Commons", kind: "commons" as const, retrievedAt: image.retrievedAt, quote: `${image.author}；${image.license}。${image.modification}` }))], location: null },
  { id: "xiaoer-tongtai", name: "小二面店（通泰街244号）", aliases: ["小二面店(通泰街244号)"], city: "长沙", address: "通泰街244号（社区指南记载，需复核）",
    description: "社区旅行指南记录的通泰街面店，可作为按碗点餐的备选。尚未取得官方营业确认或授权门店图片。",
    dishes: fact("指南列有番茄、青椒或蘑菇面，可选择是否加蛋。", "2026-04-22更新的社区记录，实际菜单、份量及配料待门店确认。", [noodles.id]),
    price: { ...fact("指南标价18元；以每人1碗作本餐参考，配菜饮料另计。", "不是已核验的人均账单或官方报价，人数乘以每人1碗；不能保证现价。", [noodles.id]), minCents: 1800, maxCents: 1800 },
    opening: { ...fact("指南参考 10:00–14:00、17:00–21:00；当天是否营业待确认。", "历史社区记录，不表示实时营业，未取得停止点餐时间。", [noodles.id]), periods: [{ start: "10:00", end: "14:00" }, { start: "17:00", end: "21:00" }], applicableFrom: null, applicableUntil: null },
    service: "individual", diningMinutes: { min: 30, max: 45 }, availability: unknownAvailability, queue: null,
    images: [], sources: [noodles], location: null },
  { id: "xinyuloudong-wanjiali", name: "新玉楼东（万家丽中路115号）", aliases: ["新玉楼东(万家丽中路115号)"], city: "长沙", address: "芙蓉区万家丽中路115号（OSM标记，需复核）",
    description: "地图记录的中餐馆候选。地址和具体分店与其他玉楼东门店分开；菜品、人数接待及经营状态尚待核对。",
    dishes: fact("具体菜品未知。", "地图仅标记中餐馆，未取得这家门店菜单。", [osmSource.id]),
    price: { ...fact("人均价格未知，可填写本餐预计人均。"), minCents: null, maxCents: null },
    opening: { ...fact("营业时间和门店是否搬迁待确认。", "地图地点存在不代表当前营业。", [osmSource.id]), periods: [], applicableFrom: null, applicableUntil: null },
    service: "unknown", diningMinutes: { min: 45, max: 75 }, availability: unknownAvailability, queue: null,
    images: [], sources: [osmSource], location: placeCandidateSchema.parse(location.candidate) },
];

export const normalizedRestaurantName = (value: string) => value.normalize("NFKC").replace(/\s/g, "");
export const restaurantCityMatches = (left: string, right: string) => normalizedRestaurantName(left).replace(/市$/, "") === normalizedRestaurantName(right).replace(/市$/, "");
export const getRestaurantCatalog = (city: string) => restaurantCatalog.filter((entry) => restaurantCityMatches(entry.city, city));
export const getRestaurantCatalogEntry = (id: string) => restaurantCatalog.find((entry) => entry.id === id) ?? null;
export function restaurantImages(entry: RestaurantCatalogEntry) {
  return entry.images.filter((image) => image.entryId === entry.id && image.entityName === entry.name && restaurantCityMatches(image.city, entry.city) && image.displayAllowed &&
    assets.images.some((known) => known.id === image.id && known.entryId === entry.id && known.url === image.url && known.sourceUrl === image.sourceUrl &&
      known.author === image.author && known.license === image.license && known.licenseUrl === image.licenseUrl) &&
    /^\/restaurants\/[a-z0-9-]+\.webp$/.test(image.url) && image.width > 0 && image.width <= 960 && image.height > 0 && image.height <= 960).slice(0, 2);
}
