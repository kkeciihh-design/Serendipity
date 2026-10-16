import { placeCandidateSchema, type PlaceCandidate } from "./places";
import assets from "./attraction-assets.json";

export type AttractionFactStatus = "verified" | "pending";

export type AttractionSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  retrievedAt: string;
  quote: string;
  kind: "official" | "commons" | "osm" | "community";
};

export type AttractionFact = {
  status: AttractionFactStatus;
  text: string;
  sourceIds: string[];
  notes: string;
};

export type AttractionImage = {
  id: string;
  url: string;
  sourceUrl: string;
  originalUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  entityName: string;
  city: string;
  entryId: string;
  width: number;
  height: number;
  displayAllowed: boolean;
  exportAllowed: boolean;
  retrievedAt: string;
  modification: string;
};

export type AttractionCatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  city: string;
  description: string;
  interestTags: string[];
  visitMinutes: { min: number; max: number; status: "estimated"; notes: string };
  suggestedTime: string;
  opening: AttractionFact & {
    closedWeekdays: number[];
    closedDates: string[];
    confirmedClosedDates?: { date: string; sourceId: string; retrievedAt: string }[];
    applicableFrom: string | null;
    applicableUntil: string | null;
  };
  ticket: AttractionFact & {
    minCents: number | null;
    maxCents: number | null;
    priceBasis: "per_person";
  };
  reservation: AttractionFact & { required: boolean | null };
  sources: AttractionSource[];
  images: AttractionImage[];
  location: PlaceCandidate | null;
};

const museumVisitSource: AttractionSource = {
  id: "hunan-museum-visit", title: "湖南省博物馆：参观", publisher: "湖南博物院官方网站", kind: "official",
  url: "https://www.hnmuseum.com/zh-hans/content/%E5%8F%82%E8%A7%82", retrievedAt: "2026-10-15T05:03:21.943Z",
  quote: "每周二至周日9:00—17:00（16:00停止入馆），每周一为闭馆日（逢法定节假日顺延、延长开放服务均以馆方通告为准）。免费开放范围：基本陈列：‘长沙马王堆汉墓陈列’、‘湖南人——三湘历史文化陈列’、专题陈列。您可提前五天（不含当天）进行个人网络实名制分时段预约。",
};
const museumCalendarSource: AttractionSource = {
  id: "hunan-museum-calendar", title: "湖南省博物馆：首页开放与票务信息", publisher: "湖南博物院官方网站", kind: "official",
  url: "https://www.hnmuseum.com/zh-hans/", retrievedAt: "2026-10-15T05:03:21.884Z",
  quote: "2026年法定节假日期间开放及闭馆安排：春节，闭馆日：2月16日、2月17日、2月24日；清明节，闭馆日：4月7日；劳动节，闭馆日：5月6日；国庆节，闭馆日：10月8日。最新一日门票的初始放票时间为每天20:00。",
};
const academySource: AttractionSource = {
  id: "yuelu-academy-about", title: "岳麓书院：书院简介", publisher: "湖南大学岳麓书院", kind: "official",
  url: "https://ylsy.hnu.edu.cn/sygk.htm", retrievedAt: "2026-10-15T05:03:21.734Z",
  quote: "岳麓书院是中国古代‘四大书院’之一，创建于北宋，历元明清各代兴学不辍。",
};
const academyTicketSource: AttractionSource = {
  id: "yuelu-academy-ticket", title: "岳麓书院：在线订票 / 游客购票须知", publisher: "湖南大学岳麓书院", kind: "official",
  url: "https://ylsy.hnu.edu.cn/wbly/cgdn/zxdp.htm", retrievedAt: "2026-10-15T05:03:21.742Z",
  quote: "全价票：40元/人次；半价票：20元/人次。我院实行实名制预约制度，请您提前在线上预约购票。散客可提前4天（含当天）预约门票，未预约谢绝入院参观。具体时间以书院最新公告为准。",
};
const academyOpeningSource: AttractionSource = {
  id: "yuelu-academy-opening", title: "岳麓书院：开放时间", publisher: "湖南大学岳麓书院", kind: "official",
  url: "https://ylsy.hnu.edu.cn/wbly/cgdn/kfsj.htm", retrievedAt: "2026-10-15T05:03:21.742Z",
  quote: "岳麓书院的开放时间根据淡、旺季会有所调整，如果遇到重大活动或特殊情况，开放时间也会有所改变。建议您在计划参观书院时，先查看岳麓书院微信公众号及官方网站发布的相关公告。",
};
const academyVisitSource: AttractionSource = {
  id: "yuelu-academy-visit", title: "岳麓书院：游览须知", publisher: "湖南大学岳麓书院", kind: "official",
  url: "https://ylsy.hnu.edu.cn/wbly/cgdn/ylxz.htm", retrievedAt: "2026-10-15T05:03:21.741Z",
  quote: "除65岁以上老人直接刷实体身份证入园（免预约）外，其他人员均需预约门票。院内古砖地面非常湿滑，请您注意行走在道路中间。",
};

function catalogAssets(entryId: string) {
  const location = assets.locations.find((item) => item.entryId === entryId);
  const images: AttractionImage[] = assets.images.filter((image) => image.entryId === entryId);
  const sources: AttractionSource[] = images.map((image) => ({
    id: image.id, title: `${image.entityName}实景照片与许可`, url: image.sourceUrl,
    publisher: "Wikimedia Commons", retrievedAt: image.retrievedAt, kind: "commons",
    quote: `${image.author}；${image.license}。${image.modification}`,
  }));
  if (location) sources.push({
    id: `${entryId}-osm`, title: `${location.candidate.name}地点资料`, publisher: "OpenStreetMap contributors / Nominatim", kind: "osm",
    url: `https://www.openstreetmap.org/${location.candidate.poiId.replace(":", "/")}`,
    retrievedAt: location.candidate.retrievedAt,
    quote: `${location.candidate.address}；${location.candidate.category}；WGS84 ${location.candidate.longitude}, ${location.candidate.latitude}。© OpenStreetMap contributors，ODbL 1.0。`,
  });
  return { images, location: location ? placeCandidateSchema.parse(location.candidate) : null, sources };
}

const museumAssets = catalogAssets("hunan-museum");
const academyAssets = catalogAssets("yuelu-academy");
const orangeAssets = catalogAssets("orange-isle");
const dateReviewNote = "这是2026-10-15实际读取的资料快照；尚未核对本次出行日期与临时公告，出发前24小时内请复核。";

// This finite directory is a source snapshot, not a live booking or opening
// guarantee. Plan-date evidence is evaluated separately by the existing source
// system. Never promote all fields merely because a POI or photo is verified.
export const attractionCatalog: AttractionCatalogEntry[] = [
  {
    id: "hunan-museum", name: "湖南博物院", aliases: ["湖南省博物馆", "湖南博物馆"], city: "长沙",
    description: "以马王堆汉墓和湖南历史文化陈列为主要参观内容的博物馆，适合安排室内展览时间。",
    interestTags: ["历史", "博物馆", "文化", "展览", "室内"],
    visitMinutes: { min: 90, max: 210, status: "estimated", notes: "规则建议：官网列有一小时半快速游览和三小时半深度游览；实际时长依展览选择调整，不含进馆排队。" },
    suggestedTime: "按预约时段入馆，预留安检与看展时间；具体时段须核对当日开放。",
    opening: {
      status: "pending", text: "官网常规周二至周日 09:00–17:00，16:00停止入馆；周一通常闭馆，法定节假日及临时通知例外。",
      sourceIds: [museumVisitSource.id, museumCalendarSource.id], notes: dateReviewNote,
      closedWeekdays: [1], closedDates: ["2026-02-16", "2026-02-17", "2026-02-24", "2026-04-07", "2026-05-06", "2026-10-08"],
      confirmedClosedDates: ["2026-02-16", "2026-02-17", "2026-02-24", "2026-04-07", "2026-05-06", "2026-10-08"].map((date) => ({
        date, sourceId: museumCalendarSource.id, retrievedAt: museumCalendarSource.retrievedAt,
      })),
      applicableFrom: null, applicableUntil: null,
    },
    ticket: {
      status: "pending", text: "基本陈列和专题陈列免费；临时特展、讲解或其他收费项目另查。",
      minCents: 0, maxCents: 0, priceBasis: "per_person", sourceIds: [museumVisitSource.id],
      notes: `${dateReviewNote} 金额仅对应基本陈列，不代表所有项目总费用或已有可用门票。`,
    },
    reservation: {
      status: "pending", required: true, text: "普通观众须实名分时预约，可提前5天（不含当天）；特殊人群绿色通道依官方规定。",
      sourceIds: [museumVisitSource.id, museumCalendarSource.id], notes: "尚未确认你已预约，也未查询余票。预约须使用官方渠道，进馆携带预约证件原件。",
    },
    ...museumAssets, sources: [museumVisitSource, museumCalendarSource, ...museumAssets.sources],
  },
  {
    id: "yuelu-academy", name: "岳麓书院", aliases: [], city: "长沙",
    description: "始建于北宋的古代书院，现属湖南大学。可沿院落、讲堂了解书院教育与湖湘文化。",
    interestTags: ["历史", "文化", "古建筑", "建筑", "书院"],
    visitMinutes: { min: 60, max: 120, status: "estimated", notes: "规则建议：为院落、讲堂参观留出1至2小时；不是官方承诺，不含排队或岳麓山登山。" },
    suggestedTime: "建议白天按预约时段参观，具体开放与最晚入院时间需核对公告。",
    opening: {
      status: "pending", text: "官网购票须知分淡旺季列开放时段，5–10月通常07:50开放、17:40停止入院；重大活动可调整。",
      sourceIds: [academyTicketSource.id, academyOpeningSource.id], notes: dateReviewNote,
      closedWeekdays: [], closedDates: [], applicableFrom: null, applicableUntil: null,
    },
    ticket: {
      status: "pending", text: "官网全价票参考40元/人次；符合规定的半价票20元，免票资格另核对。",
      minCents: 4000, maxCents: 4000, priceBasis: "per_person", sourceIds: [academyTicketSource.id],
      notes: `${dateReviewNote} 按普通全价票估算，未自动套用优惠，价格不表示有票。`,
    },
    reservation: {
      status: "pending", required: true, text: "普通观众须实名预约，可提前4天（含当天）；免预约例外按官方游览须知。",
      sourceIds: [academyTicketSource.id, academyVisitSource.id], notes: "尚未确认你已预约，也未查询余票。预约成功后携带相应证件原件。",
    },
    ...academyAssets, sources: [academySource, academyTicketSource, academyOpeningSource, academyVisitSource, ...academyAssets.sources],
  },
  {
    id: "orange-isle", name: "橘子洲", aliases: ["橘子洲景区", "橘子洲公园"], city: "长沙",
    description: "长沙岳麓区的洲岛景点，可结合园内步行与雕塑观景安排户外游览。地点坐标为整洲区域参考位置。",
    interestTags: ["自然", "风景", "户外", "散步", "摄影"],
    visitMinutes: { min: 90, max: 150, status: "estimated", notes: "规则建议：预留1.5至2.5小时；步行范围、入口和园内交通待确认，不把未知步行距离当零。" },
    suggestedTime: "建议在白天和天气适宜时游览；开放、封洲通知及园内交通需另行核对。",
    opening: {
      status: "pending", text: "本目录未取得适用出行日期的开放或封洲公告，开放状态待确认。",
      sourceIds: [], notes: "OSM地点和授权照片只证明地点及图片来源，不能确认当日开放。",
      closedWeekdays: [], closedDates: [], applicableFrom: null, applicableUntil: null,
    },
    ticket: {
      status: "pending", text: "门票及园内交通费用待确认。", minCents: null, maxCents: null, priceBasis: "per_person", sourceIds: [],
      notes: "未读取适用日期的官方票价资料，不默认免费，也不把园内交通计为零。",
    },
    reservation: {
      status: "pending", required: null, text: "预约要求及本人预约状态待确认。", sourceIds: [],
      notes: "未取得适用日期的官方预约资料；选入行程后仍须核对，不能当作已可入园。",
    },
    ...orangeAssets,
  },
];

function normalizedName(value: string) {
  return value.normalize("NFKC").replace(/\s/g, "");
}

function normalizedCity(value: string) {
  return normalizedName(value).replace(/市$/, "");
}

export function getAttractionCatalog(city: string) {
  return attractionCatalog.filter((entry) => normalizedCity(entry.city) === normalizedCity(city));
}

export function findAttractionCatalogEntry(name: string, city: string) {
  const target = normalizedName(name);
  return getAttractionCatalog(city).find((entry) => [entry.name, ...entry.aliases].some((alias) => normalizedName(alias) === target)) ?? null;
}

export function getAttractionCatalogEntry(id: string) {
  return attractionCatalog.find((entry) => entry.id === id) ?? null;
}

export function getAttractionImages(entry: AttractionCatalogEntry) {
  return entry.images.filter((image) => image.entryId === entry.id && image.entityName === entry.name &&
    normalizedCity(image.city) === normalizedCity(entry.city) && image.displayAllowed &&
    assets.images.some((known) => known.id === image.id && known.entryId === entry.id && known.url === image.url &&
      known.sourceUrl === image.sourceUrl && known.author === image.author && known.license === image.license && known.licenseUrl === image.licenseUrl) &&
    /^\/attractions\/[a-z0-9-]+\.webp$/.test(image.url) && Number.isInteger(image.width) && image.width > 0 && image.width <= 960 &&
    Number.isInteger(image.height) && image.height > 0 && image.height <= 960 && Boolean(image.author && image.license) &&
    /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(image.sourceUrl) &&
    /^https:\/\/creativecommons\.org\/licenses\/(?:by|by-sa)\/(?:2\.0|3\.0|4\.0)\/?$/.test(image.licenseUrl)).slice(0, 2);
}
