/**
 * A card must never say "目的地待补充" when the traveller already wrote where
 * they are going. This reads the destination back out of the original words.
 *
 * Rules: prefer an explicit destination, then a province + city pair written
 * together ("福建泉州"), then a known city or landmark. Nothing is invented --
 * when no signal is found the caller keeps its existing fallback.
 */

export type DestinationInference = {
  /** A display label such as "福建泉州" or "泉州". */
  label: string;
  /** How the label was found, for debugging and tests. */
  source: "province-city" | "city" | "landmark";
};

// Provinces that are commonly written whole, with their short display form.
const PROVINCES: { pattern: RegExp; short: string }[] = [
  { pattern: /(?:福建)/, short: "福建" },
  { pattern: /(?:广东)/, short: "广东" },
  { pattern: /(?:浙江)/, short: "浙江" },
  { pattern: /(?:江苏)/, short: "江苏" },
  { pattern: /(?:四川)/, short: "四川" },
  { pattern: /(?:云南)/, short: "云南" },
  { pattern: /(?:广西)/, short: "广西" },
  { pattern: /(?:安徽)/, short: "安徽" },
  { pattern: /(?:山东)/, short: "山东" },
  { pattern: /(?:甘肃)/, short: "甘肃" },
  { pattern: /(?:新疆)/, short: "新疆" },
  { pattern: /(?:陕西)/, short: "陕西" },
  { pattern: /(?:湖南)/, short: "湖南" },
  { pattern: /(?:湖北)/, short: "湖北" },
  { pattern: /(?:河南)/, short: "河南" },
  { pattern: /(?:北京)/, short: "北京" },
  { pattern: /(?:上海)/, short: "上海" },
  { pattern: /(?:重庆)/, short: "重庆" },
];

// Cities and the landmarks that imply them. Ordered longest-first at match time
// so "泉州" wins over a shorter fragment of the same string.
const PLACES: { city: string; pattern: RegExp }[] = [
  { city: "泉州", pattern: /泉州|西街|开元寺|洛伽寺|蟳埔|钟楼|清源山|洛阳桥/ },
  { city: "厦门", pattern: /厦门|鼓浪屿|曾厝垵/ },
  { city: "福州", pattern: /福州|三坊七巷/ },
  { city: "杭州", pattern: /杭州|西湖|灵隐|千岛湖|乌镇|西塘/ },
  { city: "苏州", pattern: /苏州|拙政园|平江路|周庄|同里/ },
  { city: "南京", pattern: /南京|夫子庙|中山陵|秦淮/ },
  { city: "上海", pattern: /上海|外滩|迪士尼|武康路/ },
  { city: "成都", pattern: /成都|宽窄巷子|太古里|春熙路|大熊猫|都江堰/ },
  { city: "九寨沟", pattern: /九寨沟|九寨|五花海|诺日朗|黄龙/ },
  { city: "桂林", pattern: /桂林|阳朔|漓江|西街|遇龙河|龙脊/ },
  { city: "青岛", pattern: /青岛|栈桥|八大关|崂山/ },
  { city: "北京", pattern: /北京|故宫|长城|颐和园|天安门/ },
  { city: "西安", pattern: /西安|兵马俑|大雁塔|回民街/ },
  { city: "敦煌", pattern: /敦煌|莫高窟|月牙泉|鸣沙山/ },
  { city: "大理", pattern: /大理|洱海|沙溪|苍山|双廊/ },
  { city: "丽江", pattern: /丽江|玉龙雪山|束河/ },
  { city: "霞浦", pattern: /霞浦|东壁村|三沙镇|北岐/ },
  { city: "武汉", pattern: /武汉|黄鹤楼|东湖/ },
  { city: "长沙", pattern: /长沙|岳麓|橘子洲/ },
  { city: "重庆", pattern: /重庆|洪崖洞|解放碑/ },
  { city: "三亚", pattern: /三亚|亚龙湾|蜈支洲/ },
  { city: "黄山", pattern: /黄山|宏村|西递|屯溪/ },
  { city: "新疆", pattern: /赛里木湖|伊犁|喀纳斯|乌鲁木齐|吐鲁番/ },
  { city: "深圳", pattern: /深圳/ },
  { city: "广州", pattern: /广州/ },
];

/**
 * Read a display destination out of the traveller's own words.
 * Returns null when the text carries no usable place signal.
 */
export function inferDestination(text: string | null | undefined): DestinationInference | null {
  const source = (text ?? "").replace(/\s+/g, " ").trim();
  if (source.length < 2) return null;

  const province = PROVINCES.find((item) => item.pattern.test(source));
  const place = PLACES.find((item) => item.pattern.test(source));

  // "福建泉州": an explicit province next to a recognised city reads best whole.
  if (province && place && place.city !== province.short) {
    return { label: `${province.short}${place.city}`, source: "province-city" };
  }
  if (place) return { label: place.city, source: "city" };
  if (province) return { label: province.short, source: "province-city" };
  return null;
}

/** True when a stored destination is missing or a placeholder we must replace. */
export function isPlaceholderDestination(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return true;
  return /^(目的地待补充|待补充|未知|未定|待定|暂无|-+|—+)$/.test(text);
}

/**
 * The label to show on a card: the stored destination when it is real, otherwise
 * a destination read from the original words, otherwise the caller's fallback.
 */
export function resolveDestination(
  stored: string | null | undefined,
  originalRequest: string | null | undefined,
  fallback = "目的地待补充",
) {
  const value = (stored ?? "").trim();
  if (!isPlaceholderDestination(value)) return value;
  return inferDestination(originalRequest)?.label ?? fallback;
}
