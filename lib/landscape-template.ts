import { z } from "zod";

export const landscapeScenes = ["peaks", "cliff", "tianchi", "karst", "jiangnan", "huizhou", "desert", "coast", "gorge"] as const;
export type LandscapeScene = (typeof landscapeScenes)[number];

export const landscapePaletteIds = ["jade", "ink", "ochre", "ice", "gold", "rose"] as const;
export type LandscapePaletteId = (typeof landscapePaletteIds)[number];

export const landscapeTerrains = ["alpine", "karst", "village", "desert", "coast", "garden"] as const;
export const landscapeMotifs = ["pine", "bridge", "pagoda", "boat", "snowpeak", "pavilion", "village", "lighthouse"] as const;
export const landscapeTextures = ["water", "cloud", "dunes"] as const;
export const landscapeCelestials = ["sun", "moon", "cloud"] as const;

export type LandscapeTerrain = (typeof landscapeTerrains)[number];
export type LandscapeMotif = (typeof landscapeMotifs)[number];
export type LandscapeTexture = (typeof landscapeTextures)[number];
export type LandscapeCelestial = (typeof landscapeCelestials)[number];

export type LandscapePalette = {
  ink: string;
  wash: string;
  paper: string;
  pine: string;
  accent: string;
  water: string;
  sun: string;
  mist: string;
};

export const landscapePalettes: Record<LandscapePaletteId, LandscapePalette> = {
  jade: { ink: "#4f6b60", wash: "#a9c1aa", paper: "#f6f0e2", pine: "#7f987b", accent: "#b18f62", water: "#aec8b6", sun: "#c8aa78", mist: "#f7f1e4" },
  ink: { ink: "#3f4743", wash: "#98a49e", paper: "#f1eee5", pine: "#69766f", accent: "#8e7b61", water: "#a5b1aa", sun: "#b8ad98", mist: "#f3f0e8" },
  ochre: { ink: "#6b5036", wash: "#c49f6a", paper: "#f7edda", pine: "#8e835c", accent: "#a86f3f", water: "#b79563", sun: "#d9a44f", mist: "#f8edd8" },
  ice: { ink: "#48626d", wash: "#aec6ce", paper: "#f1f6f6", pine: "#7e9da2", accent: "#7396a1", water: "#b9d2d8", sun: "#c5d5d9", mist: "#f4f9f8" },
  gold: { ink: "#66502f", wash: "#cfad69", paper: "#f8efdb", pine: "#8f865d", accent: "#b68637", water: "#c3a15f", sun: "#d8a33d", mist: "#f9f0da" },
  rose: { ink: "#65505a", wash: "#c8afb2", paper: "#f7efeb", pine: "#8c8d77", accent: "#ad7c83", water: "#c7b1ae", sun: "#d7a196", mist: "#f8f0ec" },
};

export const landscapeSceneLabels: Record<LandscapeScene, string> = {
  peaks: "奇峰云海",
  cliff: "绝壁栈道",
  tianchi: "高山天池",
  karst: "喀斯特峰林",
  jiangnan: "江南烟柳",
  huizhou: "徽派古村",
  desert: "大漠月牙",
  coast: "山海灯塔",
  gorge: "峡谷飞瀑",
};

export const landscapePaletteLabels: Record<LandscapePaletteId, string> = {
  jade: "青绿山水",
  ink: "苍岩墨韵",
  ochre: "暖秋赭石",
  ice: "寒江雪霁",
  gold: "敦煌泥金",
  rose: "桃花春水",
};

export const landscapeParametersSchema = z.object({
  terrain: z.enum(landscapeTerrains),
  palette: z.enum(landscapePaletteIds),
  motif: z.enum(landscapeMotifs),
  texture: z.enum(landscapeTextures),
  celestial: z.enum(landscapeCelestials),
  sunX: z.number().min(100).max(1500),
  ridge: z.number().min(0).max(100),
  scene: z.enum(landscapeScenes).optional(),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
});

export type LandscapeParameters = z.infer<typeof landscapeParametersSchema>;

export const fieldnoteSchema = z.object({
  region: z.string().trim().min(1).max(80),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  season: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(400),
  prompt: z.string().trim().min(1).max(800),
  visual: landscapeParametersSchema,
  englishName: z.string().trim().max(120).optional(),
  province: z.string().trim().max(80).optional(),
});

export type Fieldnote = z.infer<typeof fieldnoteSchema>;
export type LocalFieldnote = Fieldnote & { name: string };

type Fact = {
  region: string;
  latitude: number;
  longitude: number;
  season: string;
  feature: string;
  englishName: string;
  note?: string;
  scene?: LandscapeScene;
  palette?: LandscapePaletteId;
  motif?: LandscapeMotif;
  texture?: LandscapeTexture;
  celestial?: LandscapeCelestial;
  sunX?: number;
  ridge?: number;
};

const facts: Record<string, Fact> = {
  长白山天池: { region: "吉林 · 延边", latitude: 42.006, longitude: 128.057, season: "夏秋 · 火山湖与雪峰", feature: "火山口盛着一整片深蓝，雪线沿着群峰围拢过来", englishName: "Heaven Lake Changbai", note: "火山口把天空收成一枚深蓝的镜子，雪峰围着它沉默站立。等云影掠过水面，长白山便把北方的辽阔递到眼前。", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water", celestial: "sun", sunX: 1240, ridge: 34 },
  长白山: { region: "吉林 · 延边", latitude: 42.006, longitude: 128.057, season: "夏秋 · 林海雪峰", feature: "林海从山脚一直铺到云上，天池在火山口安静发亮", englishName: "Changbai Mountains", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water" },
  华山: { region: "陕西 · 渭南", latitude: 34.483, longitude: 110.083, season: "春秋 · 绝壁云梯", feature: "西岳的花岗岩绝壁直上云端，苍龙岭像一条细线悬在山脊", englishName: "Mount Hua", note: "华山的绝壁把天光削成一束，苍龙岭上每一步都听见风的回声。等云从谷底升起，才懂得西岳为何让人仰望。", scene: "cliff", palette: "ink", motif: "pavilion", texture: "cloud", celestial: "sun", sunX: 310, ridge: 86 },
  黄山: { region: "安徽 · 黄山", latitude: 30.132, longitude: 118.167, season: "春秋 · 奇松云海", feature: "奇松从崖缝里探身，云海把七十二峰反复藏起又摊开", englishName: "Huangshan", note: "迎客松把手臂伸向云海，七十二峰在雾里时隐时现。等一场晚照落在花岗岩上，黄山便有了自己的呼吸。", scene: "peaks", palette: "ink", motif: "pine", texture: "cloud", celestial: "sun", sunX: 1190, ridge: 68 },
  三清山: { region: "江西 · 上饶", latitude: 28.919, longitude: 118.061, season: "春夏 · 花岗岩峰林", feature: "花岗岩峰柱从云海里拔起，巨蟒出山与东方女神隔着深谷相望", englishName: "Mount Sanqing", note: "巨蟒出山从云海里探出，东方女神在另一侧静静守望。沿高空栈道慢走，让花岗岩峰林在雾里一层层显影。", scene: "peaks", palette: "jade", motif: "pine", texture: "cloud", celestial: "sun", sunX: 470, ridge: 88 },
  泰山: { region: "山东 · 泰安", latitude: 36.256, longitude: 117.101, season: "春秋 · 日出岱顶", feature: "石阶沿着齐鲁的脊背一路向上，南天门把日出举在头顶", englishName: "Mount Tai", note: "石阶把晨光一级级抬向南天门，齐鲁大地在脚下慢慢铺开。等日出越过山脊，才明白登泰山为何要留一整夜。", scene: "cliff", palette: "jade", motif: "pavilion", texture: "cloud", celestial: "sun", sunX: 1390, ridge: 57 },
  恒山: { region: "山西 · 大同", latitude: 39.704, longitude: 113.733, season: "夏秋 · 悬空古寺", feature: "古寺贴着绝壁悬在半空，恒山的风从木廊下穿过", englishName: "Mount Heng Shanxi", scene: "cliff", palette: "ochre", motif: "pavilion", texture: "cloud" },
  梵净山: { region: "贵州 · 铜仁", latitude: 27.918, longitude: 108.691, season: "春夏 · 云上金顶", feature: "红云金顶从雾海中孤峰突起，石阶像一线天梯挂在崖壁", englishName: "Fanjingshan", scene: "cliff", palette: "jade", motif: "pavilion", texture: "cloud" },
  峨眉山: { region: "四川 · 乐山", latitude: 29.520, longitude: 103.332, season: "春秋 · 金顶云海", feature: "金顶在云层之上发亮，冷杉沿着山脊一层层隐入雾里", englishName: "Mount Emei", scene: "peaks", palette: "jade", motif: "pagoda", texture: "cloud" },
  庐山: { region: "江西 · 九江", latitude: 29.556, longitude: 115.983, season: "夏秋 · 飞瀑云烟", feature: "瀑布从青崖间跌落，云雾把山寺与松林反复遮住", englishName: "Mount Lu", scene: "gorge", palette: "jade", motif: "pavilion", texture: "cloud" },
  嵩山: { region: "河南 · 郑州", latitude: 34.484, longitude: 112.960, season: "春秋 · 嵩岳古刹", feature: "少室山的岩壁一层层抬起，古刹的钟声落在松风里", englishName: "Mount Song", scene: "peaks", palette: "ochre", motif: "pagoda", texture: "cloud" },
  衡山: { region: "湖南 · 衡阳", latitude: 27.254, longitude: 112.733, season: "夏秋 · 祝融云海", feature: "祝融峰把湘南的云收在脚下，松涛沿着石阶起落", englishName: "Mount Heng Hunan", scene: "peaks", palette: "jade", motif: "pine", texture: "cloud" },
  张家界: { region: "湖南 · 张家界", latitude: 29.325, longitude: 110.434, season: "春秋 · 石英峰林", feature: "石英砂岩峰柱密密立起，云在深谷里来回穿行", englishName: "Zhangjiajie", scene: "peaks", palette: "jade", motif: "pine", texture: "cloud", ridge: 92 },
  天山天池: { region: "新疆 · 昌吉", latitude: 43.887, longitude: 88.128, season: "夏秋 · 雪峰松海", feature: "博格达峰把雪光投进湖心，云杉沿着天池岸边站成深绿", englishName: "Tianchi Lake Tianshan", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water" },
  赛里木湖: { region: "新疆 · 博尔塔拉", latitude: 44.600, longitude: 81.170, season: "冬春 · 蓝冰与雪山", feature: "雪山把最后一抹蓝留在湖心，冰面收藏着冬日的呼吸", englishName: "Sayram Lake", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water", ridge: 26 },
  喀纳斯: { region: "新疆 · 阿勒泰", latitude: 48.700, longitude: 87.000, season: "秋日 · 彩林碧水", feature: "白桦与落叶松把山谷染成金色，湖水在雾里换着颜色", englishName: "Kanas Lake", scene: "tianchi", palette: "gold", motif: "snowpeak", texture: "water" },
  青海湖: { region: "青海 · 海南州", latitude: 36.890, longitude: 100.180, season: "夏秋 · 高原蓝湖", feature: "油菜花一直铺到湖岸，远处的雪线把天空压得很低", englishName: "Qinghai Lake", scene: "tianchi", palette: "gold", motif: "snowpeak", texture: "water" },
  纳木错: { region: "西藏 · 拉萨", latitude: 30.700, longitude: 90.600, season: "夏秋 · 圣湖雪山", feature: "念青唐古拉山的雪光落进湖面，经幡在高原风里翻动", englishName: "Namtso", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water" },
  稻城亚丁: { region: "四川 · 甘孜", latitude: 28.450, longitude: 100.330, season: "秋日 · 雪山海子", feature: "仙乃日的雪峰守着牛奶海，草甸在海拔四千米的风里发亮", englishName: "Yading", scene: "tianchi", palette: "gold", motif: "snowpeak", texture: "water" },
  四姑娘山: { region: "四川 · 阿坝", latitude: 31.100, longitude: 102.900, season: "秋日 · 雪岭长坪", feature: "四座雪峰并肩站在长坪沟尽头，杉林把光线收得很深", englishName: "Siguniang Mountain", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water" },
  玉龙雪山: { region: "云南 · 丽江", latitude: 27.100, longitude: 100.180, season: "冬春 · 雪照蓝月", feature: "玉龙十三峰把雪影投进蓝月谷，云从山腰缓慢散开", englishName: "Jade Dragon Snow Mountain", scene: "tianchi", palette: "ice", motif: "snowpeak", texture: "water" },
  梅里雪山: { region: "云南 · 迪庆", latitude: 28.440, longitude: 98.680, season: "冬春 · 日照金山", feature: "卡瓦格博的雪脊被晨光点亮，峡谷里的雾还停在半山", englishName: "Meili Snow Mountain", scene: "peaks", palette: "gold", motif: "snowpeak", texture: "cloud" },
  九寨沟: { region: "四川 · 阿坝", latitude: 33.220, longitude: 103.900, season: "秋日 · 层林映海", feature: "五花海把彩林和雪峰一起收进水里，木栈道沿着蓝绿湖面转弯", englishName: "Jiuzhaigou", scene: "gorge", palette: "jade", motif: "boat", texture: "water" },
  黄龙: { region: "四川 · 阿坝", latitude: 32.750, longitude: 103.820, season: "夏秋 · 钙华彩池", feature: "钙华彩池沿着山谷一层层铺开，雪宝顶在远处泛着白光", englishName: "Huanglong", scene: "gorge", palette: "gold", motif: "pine", texture: "water" },
  桂林: { region: "广西 · 桂林", latitude: 25.270, longitude: 110.290, season: "春夏 · 烟雨峰林", feature: "喀斯特青峰从平地拔起，漓江在群峰之间拐了一个弯", englishName: "Guilin", scene: "karst", palette: "jade", motif: "boat", texture: "water" },
  漓江: { region: "广西 · 桂林", latitude: 24.930, longitude: 110.530, season: "春夏 · 烟雨青山", feature: "一江清水绕过青峰，山的轮廓像未干的墨", englishName: "Li River", scene: "karst", palette: "jade", motif: "boat", texture: "water" },
  阳朔: { region: "广西 · 桂林", latitude: 24.780, longitude: 110.490, season: "春秋 · 遇龙河畔", feature: "遇龙河从稻田和青峰间穿过，竹筏把水面的倒影划开", englishName: "Yangshuo", scene: "karst", palette: "jade", motif: "boat", texture: "water" },
  西湖: { region: "浙江 · 杭州", latitude: 30.240, longitude: 120.150, season: "春秋 · 湖山入画", feature: "湖光接住远山，苏堤与断桥把水面分成一层层留白", englishName: "West Lake Hangzhou", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  拙政园: { region: "江苏 · 苏州", latitude: 31.324, longitude: 120.629, season: "春夏 · 花窗借景", feature: "花窗借来一片竹影，池水把亭台与回廊轻轻折起", englishName: "Humble Administrator's Garden", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  苏州园林: { region: "江苏 · 苏州", latitude: 31.310, longitude: 120.620, season: "春夏 · 移步换景", feature: "回廊在粉墙之间转折，一池水把亭台和竹影收在一起", englishName: "Classical Gardens of Suzhou", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  瘦西湖: { region: "江苏 · 扬州", latitude: 32.410, longitude: 119.420, season: "春暮 · 长堤烟柳", feature: "长堤把湖水拉成一条细线，五亭桥在柳烟里露出檐角", englishName: "Slender West Lake", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  太湖: { region: "江苏 · 无锡", latitude: 31.240, longitude: 120.140, season: "春秋 · 湖上烟波", feature: "太湖的水面一直铺到天边，帆影和远山都淡成一层墨", englishName: "Lake Tai", scene: "jiangnan", palette: "ink", motif: "boat", texture: "water" },
  千岛湖: { region: "浙江 · 杭州", latitude: 29.600, longitude: 119.040, season: "春秋 · 群岛浮碧", feature: "岛屿从碧水里一层层浮起，薄雾把湖湾收进留白", englishName: "Qiandao Lake", scene: "jiangnan", palette: "jade", motif: "boat", texture: "water" },
  乌镇: { region: "浙江 · 嘉兴", latitude: 30.750, longitude: 120.490, season: "春秋 · 水巷灯影", feature: "水巷从石桥下穿过，木窗和灯笼把倒影染成暖色", englishName: "Wuzhen", scene: "jiangnan", palette: "ochre", motif: "bridge", texture: "water" },
  周庄: { region: "江苏 · 苏州", latitude: 31.110, longitude: 120.850, season: "春秋 · 双桥水巷", feature: "双桥把水巷分成几折，乌篷船从白墙下慢慢划过", englishName: "Zhouzhuang", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  西塘: { region: "浙江 · 嘉兴", latitude: 30.950, longitude: 120.890, season: "春秋 · 廊棚烟雨", feature: "廊棚沿着河岸伸得很长，雨把青石板和灯笼洗得发亮", englishName: "Xitang", scene: "jiangnan", palette: "ink", motif: "bridge", texture: "water" },
  宏村: { region: "安徽 · 黄山", latitude: 30.000, longitude: 117.990, season: "春秋 · 徽州清梦", feature: "粉墙黛瓦倒映在月沼，一条巷子就能走过半日", englishName: "Hongcun", scene: "huizhou", palette: "ink", motif: "bridge", texture: "water" },
  西递: { region: "安徽 · 黄山", latitude: 29.900, longitude: 117.990, season: "春秋 · 徽派古巷", feature: "马头墙在晨雾里层层抬起，青石巷把天光收成一条细线", englishName: "Xidi", scene: "huizhou", palette: "ink", motif: "village", texture: "cloud" },
  婺源: { region: "江西 · 上饶", latitude: 29.250, longitude: 117.860, season: "春暮 · 油菜花海", feature: "油菜花从徽派村落铺到山脚，白墙黑瓦像落在金色海里的帆", englishName: "Wuyuan", scene: "huizhou", palette: "gold", motif: "village", texture: "cloud" },
  沙溪古镇: { region: "云南 · 大理", latitude: 26.320, longitude: 99.850, season: "春秋 · 玉津桥晨雾", feature: "玉津桥横过薄雾，马蹄声已在旧时光里远去", englishName: "Shaxi Yunnan", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "cloud" },
  丽江古城: { region: "云南 · 丽江", latitude: 26.870, longitude: 100.230, season: "四季 · 雪山古城", feature: "水渠从古城街巷穿过，木楼和石桥在雪山下挨得很近", englishName: "Lijiang Old Town", scene: "jiangnan", palette: "ochre", motif: "bridge", texture: "water" },
  大理古城: { region: "云南 · 大理", latitude: 25.690, longitude: 100.160, season: "四季 · 苍山洱海", feature: "苍山把云停在半腰，洱海把古城的屋檐收进水里", englishName: "Dali Old Town", scene: "jiangnan", palette: "jade", motif: "bridge", texture: "water" },
  凤凰古城: { region: "湖南 · 湘西", latitude: 27.950, longitude: 109.600, season: "春秋 · 沱江吊脚楼", feature: "吊脚楼沿着沱江站成一排，石墩和虹桥把水声分成几段", englishName: "Fenghuang Ancient Town", scene: "jiangnan", palette: "ochre", motif: "bridge", texture: "water" },
  平遥古城: { region: "山西 · 晋中", latitude: 37.200, longitude: 112.180, season: "春秋 · 城垣旧梦", feature: "古城墙把街巷围成一方旧时光，镖局与票号的木门半掩", englishName: "Pingyao Ancient City", scene: "huizhou", palette: "ochre", motif: "village", texture: "cloud" },
  敦煌月牙泉: { region: "甘肃 · 敦煌", latitude: 40.090, longitude: 94.670, season: "春秋 · 鸣沙流金", feature: "沙山把风叠成金色的褶皱，一弯清泉安静地盛着月光", englishName: "Crescent Lake Dunhuang", note: "沙山把风叠成金色的褶皱，一弯清泉安静地盛着月光。等日落将驼铃拉长，再沿沙脊读一页大漠。", scene: "desert", palette: "ochre", motif: "pavilion", texture: "dunes", celestial: "moon", sunX: 1320, ridge: 78 },
  敦煌沙山: { region: "甘肃 · 敦煌", latitude: 40.090, longitude: 94.670, season: "春秋 · 鸣沙流金", feature: "鸣沙山的沙脊在夕阳里起伏，风把脚印慢慢抹平", englishName: "Mingsha Sand Dunes", scene: "desert", palette: "ochre", motif: "pavilion", texture: "dunes", celestial: "moon" },
  鸣沙山: { region: "甘肃 · 敦煌", latitude: 40.090, longitude: 94.670, season: "春秋 · 沙海月泉", feature: "沙脊一层层压向天边，月牙泉在低处安静发亮", englishName: "Mingsha Mountain", scene: "desert", palette: "ochre", motif: "pavilion", texture: "dunes", celestial: "moon" },
  额济纳: { region: "内蒙古 · 阿拉善", latitude: 41.950, longitude: 101.070, season: "秋日 · 胡杨金海", feature: "胡杨把戈壁染成金色，弱水从沙地边缘缓慢流过", englishName: "Ejina", scene: "desert", palette: "gold", motif: "pavilion", texture: "dunes" },
  霞浦: { region: "福建 · 宁德", latitude: 26.880, longitude: 120.060, season: "春秋 · 潮汐拾光", feature: "潮水退去，滩涂便铺开细密的纹理，竹竿与渔舟把晨光切成丝", englishName: "Xiapu", note: "潮水退去，滩涂便铺开细密的纹理。等一束晨光掠过竹竿与渔舟，看海写下自己的诗。", scene: "coast", palette: "gold", motif: "boat", texture: "water" },
  青岛: { region: "山东 · 青岛", latitude: 36.060, longitude: 120.380, season: "夏秋 · 红瓦碧海", feature: "红瓦屋顶沿着海湾起伏，灯塔和栈桥把海面分成远近", englishName: "Qingdao", scene: "coast", palette: "jade", motif: "lighthouse", texture: "water" },
  鼓浪屿: { region: "福建 · 厦门", latitude: 24.450, longitude: 118.070, season: "春秋 · 海上花园", feature: "老别墅的屋顶藏在榕树里，海浪在礁石和琴声之间起落", englishName: "Gulangyu", scene: "coast", palette: "rose", motif: "lighthouse", texture: "water" },
  厦门: { region: "福建 · 厦门", latitude: 24.480, longitude: 118.090, season: "春秋 · 海风骑楼", feature: "海岸线绕过骑楼与礁石，海风把棕榈叶吹成一片轻声", englishName: "Xiamen", scene: "coast", palette: "jade", motif: "lighthouse", texture: "water" },
  三亚: { region: "海南 · 三亚", latitude: 18.250, longitude: 109.510, season: "冬春 · 椰风海韵", feature: "椰林把影子铺在沙滩上，海水从浅绿一直蓝到天际", englishName: "Sanya", scene: "coast", palette: "gold", motif: "lighthouse", texture: "water" },
  涠洲岛: { region: "广西 · 北海", latitude: 21.050, longitude: 109.120, season: "春秋 · 火山海岸", feature: "火山岩把海岸切成层层皱褶，灯塔在香蕉林尽头亮起", englishName: "Weizhou Island", scene: "coast", palette: "ochre", motif: "lighthouse", texture: "water" },
  黄果树瀑布: { region: "贵州 · 安顺", latitude: 25.990, longitude: 105.670, season: "夏秋 · 飞瀑深潭", feature: "瀑布从断崖整幅落下，水雾把峡谷和石桥一起罩住", englishName: "Huangguoshu Waterfall", scene: "gorge", palette: "jade", motif: "bridge", texture: "water" },
  壶口瀑布: { region: "山西 · 临汾", latitude: 36.150, longitude: 110.440, season: "夏秋 · 黄河奔涌", feature: "黄河在壶口收窄成一股，浑黄的水声从谷底一直推上来", englishName: "Hukou Waterfall", scene: "gorge", palette: "ochre", motif: "pine", texture: "water" },
  德天瀑布: { region: "广西 · 崇左", latitude: 22.850, longitude: 106.720, season: "夏秋 · 边关叠瀑", feature: "归春河从层叠的岩台跌落，水雾里能看见对岸的青山", englishName: "Detian Waterfall", scene: "gorge", palette: "jade", motif: "boat", texture: "water" },
  虎跳峡: { region: "云南 · 迪庆", latitude: 27.180, longitude: 100.110, season: "春秋 · 峡谷怒水", feature: "金沙江在玉龙与哈巴之间收成一线，岩壁把水声撞得粉碎", englishName: "Tiger Leaping Gorge", scene: "gorge", palette: "ochre", motif: "pine", texture: "water" },
  普达措: { region: "云南 · 迪庆", latitude: 27.900, longitude: 99.940, season: "夏秋 · 高原湖泊", feature: "属都湖把云杉和草甸收进水里，牦牛在雾里缓慢移动", englishName: "Potatso National Park", scene: "tianchi", palette: "jade", motif: "snowpeak", texture: "water" },
  泸沽湖: { region: "云南 · 丽江", latitude: 27.700, longitude: 100.780, season: "春秋 · 高原明镜", feature: "格姆女神山把影子投进湖心，猪槽船从芦苇边轻轻划开", englishName: "Lugu Lake", scene: "tianchi", palette: "ice", motif: "boat", texture: "water" },
  洱海: { region: "云南 · 大理", latitude: 25.780, longitude: 100.180, season: "四季 · 苍山洱海", feature: "苍山十九峰把云留在半山，洱海把白族村落收进波光", englishName: "Erhai Lake", scene: "tianchi", palette: "jade", motif: "boat", texture: "water" },
  武夷山: { region: "福建 · 南平", latitude: 27.720, longitude: 117.680, season: "春秋 · 九曲溪山", feature: "丹霞岩壁沿着九曲溪排开，竹筏从茶山和云雾之间穿过", englishName: "Wuyishan", scene: "karst", palette: "ochre", motif: "boat", texture: "water" },
  雁荡山: { region: "浙江 · 温州", latitude: 28.370, longitude: 121.060, season: "春夏 · 奇峰飞瀑", feature: "灵峰在夜色里换出不同轮廓，瀑布从雁荡的岩壁间落下", englishName: "Yandang Mountain", scene: "gorge", palette: "ink", motif: "pine", texture: "cloud" },
  丹霞山: { region: "广东 · 韶关", latitude: 25.030, longitude: 113.750, season: "春秋 · 赤壁丹崖", feature: "赤壁丹崖在绿林上层层抬起，锦江把山影拉成长长一条", englishName: "Danxia Mountain", scene: "karst", palette: "ochre", motif: "boat", texture: "water" },
  龙脊梯田: { region: "广西 · 桂林", latitude: 25.750, longitude: 110.130, season: "春秋 · 梯田云海", feature: "梯田从山脚盘到云端，水光把每一层田埂都照成细线", englishName: "Longji Rice Terraces", scene: "huizhou", palette: "gold", motif: "village", texture: "cloud" },
  元阳梯田: { region: "云南 · 红河", latitude: 23.100, longitude: 102.750, season: "冬春 · 哈尼梯田", feature: "梯田盛着天光一层层落向谷底，蘑菇房在云海里露出屋顶", englishName: "Yuanyang Rice Terraces", scene: "huizhou", palette: "gold", motif: "village", texture: "cloud" },
  可可托海: { region: "新疆 · 阿勒泰", latitude: 47.200, longitude: 89.800, season: "秋日 · 峡谷金林", feature: "额尔齐斯河从花岗岩峡谷穿过，白桦林把秋色铺满河岸", englishName: "Koktokay", scene: "gorge", palette: "gold", motif: "boat", texture: "water" },
  呼伦贝尔: { region: "内蒙古 · 呼伦贝尔", latitude: 49.210, longitude: 119.770, season: "夏秋 · 草原长河", feature: "草原一直铺到天边，莫日格勒河在绿色里绕出许多弯", englishName: "Hulunbuir", scene: "tianchi", palette: "jade", motif: "boat", texture: "water" },
  阿尔山: { region: "内蒙古 · 兴安盟", latitude: 47.180, longitude: 119.940, season: "秋日 · 林海天池", feature: "火山天池藏在落叶松林里，温泉的雾气从山谷慢慢升起", englishName: "Arxan", scene: "tianchi", palette: "gold", motif: "snowpeak", texture: "water" },
};

const sceneDefaults: Record<LandscapeScene, Omit<LandscapeParameters, "seed">> = {
  peaks: { terrain: "alpine", palette: "jade", motif: "pine", texture: "cloud", celestial: "sun", sunX: 1180, ridge: 72, scene: "peaks" },
  cliff: { terrain: "alpine", palette: "ink", motif: "pavilion", texture: "cloud", celestial: "sun", sunX: 320, ridge: 84, scene: "cliff" },
  tianchi: { terrain: "alpine", palette: "ice", motif: "snowpeak", texture: "water", celestial: "sun", sunX: 1240, ridge: 34, scene: "tianchi" },
  karst: { terrain: "karst", palette: "jade", motif: "boat", texture: "water", celestial: "sun", sunX: 1320, ridge: 42, scene: "karst" },
  jiangnan: { terrain: "garden", palette: "jade", motif: "bridge", texture: "water", celestial: "sun", sunX: 1160, ridge: 24, scene: "jiangnan" },
  huizhou: { terrain: "village", palette: "ink", motif: "village", texture: "water", celestial: "sun", sunX: 1080, ridge: 38, scene: "huizhou" },
  desert: { terrain: "desert", palette: "ochre", motif: "pavilion", texture: "dunes", celestial: "moon", sunX: 1320, ridge: 78, scene: "desert" },
  coast: { terrain: "coast", palette: "jade", motif: "lighthouse", texture: "water", celestial: "sun", sunX: 1360, ridge: 26, scene: "coast" },
  gorge: { terrain: "alpine", palette: "jade", motif: "pine", texture: "water", celestial: "sun", sunX: 340, ridge: 66, scene: "gorge" },
};

export function landscapeSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const normalizeName = (value: string) => value.replace(/\s+/g, "").replace(/[·・,，。]/g, "");

function factFor(name: string) {
  const normalized = normalizeName(name);
  const exact = facts[normalized];
  if (exact) return { key: normalized, fact: exact };
  const key = Object.keys(facts).sort((left, right) => right.length - left.length).find((entry) => normalized.includes(entry));
  return key ? { key, fact: facts[key] } : null;
}

export function inferSceneArchetype(name: string, parameters?: Partial<LandscapeParameters>): LandscapeScene {
  if (parameters?.scene) return parameters.scene;
  const text = normalizeName(name);
  if (/长白山|天池|火山湖|赛里木|喀纳斯|纳木错|青海湖|泸沽湖|洱海|普达措|呼伦贝尔/.test(text)) return "tianchi";
  if (/华山|泰山|恒山|梵净山|悬空寺|绝壁|栈道|南天门/.test(text)) return "cliff";
  if (/桂林|漓江|阳朔|武夷山|丹霞|喀斯特|石林|峰林/.test(text)) return "karst";
  if (/西湖|拙政园|苏州园林|瘦西湖|太湖|千岛湖|乌镇|周庄|西塘|沙溪|丽江|大理|凤凰|江南|水乡/.test(text)) return "jiangnan";
  if (/宏村|西递|婺源|平遥|古村|古镇|梯田|徽州/.test(text)) return "huizhou";
  if (/敦煌|鸣沙|月牙泉|沙漠|沙山|戈壁|额济纳|胡杨/.test(text)) return "desert";
  if (/霞浦|青岛|鼓浪屿|厦门|三亚|涠洲|海岸|灯塔|海岛|沙滩/.test(text)) return "coast";
  if (/九寨|黄龙|黄果树|壶口|德天|虎跳峡|峡|瀑|可可托海|雁荡|江|河|溪/.test(text)) return "gorge";
  if (/湖|池|潭/.test(text)) return "tianchi";
  if (/海|湾|岛/.test(text)) return "coast";
  if (/村|镇|古城|古街/.test(text)) return "huizhou";
  if (/寺|园|塔/.test(text)) return "jiangnan";
  if (/黄山|三清山|张家界|峨眉山|嵩山|衡山|庐山|雪山|山|峰|岭|岳/.test(text)) return "peaks";
  if (parameters?.terrain === "karst") return "karst";
  if (parameters?.terrain === "village") return "huizhou";
  if (parameters?.terrain === "desert") return "desert";
  if (parameters?.terrain === "coast") return "coast";
  if (parameters?.terrain === "garden") return "jiangnan";
  return "peaks";
}

export function inferLandscape(name: string): LandscapeParameters {
  const seed = landscapeSeed(name);
  const matched = factFor(name);
  const scene = matched?.fact.scene ?? inferSceneArchetype(name);
  const base = sceneDefaults[scene];
  const ridge = matched?.fact.ridge ?? base.ridge;
  const sunX = matched?.fact.sunX ?? Math.round(160 + (seed % 1180));
  return {
    ...base,
    ridge: Math.min(100, Math.max(0, ridge + ((seed % 9) - 4))),
    sunX: Math.min(1500, Math.max(100, sunX + ((seed % 41) - 20))),
    palette: matched?.fact.palette ?? base.palette,
    motif: matched?.fact.motif ?? base.motif,
    texture: matched?.fact.texture ?? base.texture,
    celestial: matched?.fact.celestial ?? base.celestial,
    scene,
    seed,
  };
}

const noteOpenings = [
  "把天光收进一重又一重山色",
  "像一幅尚未干透的长卷",
  "在风里慢慢显出自己的轮廓",
  "把远方的安静一直铺到脚下",
  "让云影在水面和石壁之间来回",
  "把四季的消息藏进深浅不一的墨色",
];
const noteEndings = [
  "等一场晚照越过山脊，再把剩下的时间交给风",
  "沿着水声慢走，让脚步和云影一起停下来",
  "找一个无人的清晨，看薄雾把远山一层层打开",
  "等灯火落在水面，才发觉一天已经走得很远",
  "把匆忙留在来路，只带一盏茶去看山",
  "等鸟群掠过水面，再把未说完的话留给山谷",
];
// These are literary impressions of a name, never invented geographic facts.
const offlineImpressions: Record<LandscapeScene, readonly [string, string]> = {
  peaks: ["峰石在云隙间立起，松针把风声梳成细细的线", "待晨雾散开，沿石径寻一处能听见松涛的留白"],
  cliff: ["崖壁像被岁月劈开的书页，一线山脊通向天际", "把脚步放慢，等深谷的云追上山亭的檐角"],
  tianchi: ["一泓静水收住天色，岸边的树影把远山叠进湖心", "等涟漪平息，再读水面上那封未曾寄出的长信"],
  karst: ["青峰一座座浮出烟水，石的棱角被薄雾轻轻藏起", "随一叶小舟转过山弯，看倒影将长卷徐徐展开"],
  jiangnan: ["桥影接住半池春色，柳丝把午后的光剪成细雨", "循着廊下水声慢走，把一盏茶的时间留给花窗"],
  huizhou: ["旧巷在屋檐下转弯，炊烟让斑驳的门扉有了温度", "等暮色漫过石阶，再向街角借一盏灯回望来路"],
  desert: ["沙脊在斜阳下叠成金色褶皱，远处的月色渐渐清晰", "顺着风留下的纹路走，让脚印停在下一阵风到来以前"],
  coast: ["潮水把礁石写成断句，海鸟从天与水的交界处掠过", "等晚风吹亮岸边的灯，听浪声一遍遍重读远方"],
  gorge: ["水声从深涧里折返，湿润的石纹藏着一线青苔", "循溪流走到林荫尽头，让飞溅的凉意洗去赶路的尘埃"],
};

export function localFieldnote(name: string, preference = ""): LocalFieldnote {
  const seed = landscapeSeed(`${name}|${preference}`);
  const matched = factFor(name);
  const visual = inferLandscape(name);
  if (!matched) {
    const scene = inferSceneArchetype(name);
    const [opening, ending] = offlineImpressions[scene];
    return {
      name,
      region: "地区待核实",
      latitude: null,
      longitude: null,
      season: `时节待核实 · ${landscapeSceneLabels[scene]}`,
      note: `循着「${name}」的名字入画：${opening}。${ending}。`,
      prompt: `想去${name}旅行 3 天，喜欢自然风光、在地文化与舒缓节奏。请先核实它所在的省市与交通方式，再规划每日路线、住宿和留白时间。${preference ? `偏好：${preference}。` : ""}`,
      visual,
      englishName: undefined,
      province: undefined,
    };
  }
  const fact = matched.fact;
  const note = fact.note ?? `${fact.feature}，${noteOpenings[seed % noteOpenings.length]}。${noteEndings[(seed >>> 4) % noteEndings.length]}。`;
  return {
    name,
    region: fact.region,
    latitude: fact.latitude,
    longitude: fact.longitude,
    season: fact.season,
    note,
    prompt: `想去${fact.region}的${name}旅行 3 天，喜欢自然风光、在地文化与舒缓节奏，愿意为一处晨昏多留半天。请规划交通、住宿与每日路线，留足休息时间，并提醒天气、预约和景区开放安排。${preference ? `偏好：${preference}。` : ""}`,
    visual,
    englishName: fact.englishName,
    province: fact.region.split(" · ")[0],
  };
}

const color = (palette: LandscapePalette, key: keyof LandscapePalette) => palette[key];
const hashUnit = (seed: number, salt: number) => {
  const value = Math.sin(seed * 0.0129898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/** Shared parameter resolution for the live SVG and exported atmosphere. */
export function landscapeComposition(parameters: LandscapeParameters, name = "") {
  const scene = inferSceneArchetype(name, parameters);
  return {
    scene,
    seed: parameters.seed ?? landscapeSeed(`${name}|${scene}|${parameters.ridge}|${parameters.sunX}`),
    palette: landscapePalettes[parameters.palette] ?? landscapePalettes.jade,
  };
}

function ridgePath(seed: number, baseY: number, height: number, salt: number) {
  const points: string[] = [`M0 ${baseY}`];
  for (let index = 1; index <= 10; index += 1) {
    const x = (index / 10) * 1920;
    const y = baseY - height * (0.28 + hashUnit(seed, salt + index) * 0.72);
    points.push(`L${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  points.push("L1920 1200 L0 1200 Z");
  return points.join(" ");
}

function tower(seed: number, index: number, palette: LandscapePalette, scene: LandscapeScene) {
  const x = 120 + index * 185 + (hashUnit(seed, index + 3) - 0.5) * 74;
  const width = scene === "peaks" ? 46 + hashUnit(seed, index + 11) * 90 : 90 + hashUnit(seed, index + 21) * 120;
  const base = 830 + hashUnit(seed, index + 31) * 35;
  const top = 250 - hashUnit(seed, index + 41) * 130;
  const lean = (hashUnit(seed, index + 51) - 0.5) * 35;
  const left = x - width / 2, right = x + width / 2;
  const points = [
    `M${left.toFixed(1)} ${base.toFixed(1)}`,
    `L${(left + 7).toFixed(1)} ${(base - 90).toFixed(1)}`,
    `L${(x - width * 0.23 + lean).toFixed(1)} ${(top + 85).toFixed(1)}`,
    `L${(x + lean).toFixed(1)} ${top.toFixed(1)}`,
    `L${(x + width * 0.2 + lean).toFixed(1)} ${(top + 70).toFixed(1)}`,
    `L${(right - 4).toFixed(1)} ${(base - 120).toFixed(1)}`,
    `L${right.toFixed(1)} ${base.toFixed(1)}Z`,
  ].join(" ");
  const hatch = Array.from({ length: 5 }, (_, line) => {
    const hx = x - width * 0.26 + line * width * 0.13;
    return `M${hx.toFixed(1)} ${(base - 30).toFixed(1)} Q${(hx + lean * 0.45).toFixed(1)} ${(base - 235).toFixed(1)} ${(hx + lean).toFixed(1)} ${(top + 95).toFixed(1)}`;
  }).join(" ");
  return `<g><path d="${points}" fill="${palette.wash}" fill-opacity="${(0.28 + hashUnit(seed, index + 61) * 0.34).toFixed(2)}" stroke="${palette.ink}" stroke-opacity=".72" stroke-width="2"/><path d="${hatch}" fill="none" stroke="${palette.ink}" stroke-opacity=".28" stroke-width="1.1"/></g>`;
}

function pineSilhouette(x: number, y: number, scale: number, palette: LandscapePalette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${palette.pine}" fill-opacity=".72" stroke="${palette.ink}" stroke-width="1.1"><path d="M0 0 C2-26-5-44 1-72 M1-28 C-8-35-18-37-28-43 C-11-42-3-48 1-54 C9-47 19-45 29-44 C15-37 8-34 1-28 M1-48 C-7-56-15-60-23-64 C-8-63 0-68 2-73 C8-66 16-64 23-63 C13-58 7-54 1-48 M-7 0-18 4 M5 0 15 5"/></g>`;
}

function pavilion(x: number, y: number, scale: number, palette: LandscapePalette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="1.5"><path d="M-54 0H54M-43-4V-55M43-4V-55M-12-4V-55M12-4V-55M-63-53Q-24-68 0-88Q25-68 63-53ZM-59-52Q0-43 59-52M-46 0V-10H46V0M0-88V-97" fill="${palette.paper}"/></g>`;
}

function boatSilhouette(x: number, y: number, scale: number, palette: LandscapePalette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${palette.ink}" stroke-width="1.5"><path d="M-52 0Q0 9 54-2L35 10Q-5 15-38 7Z" fill="${palette.accent}" fill-opacity=".5"/><path d="M-18 0Q-12-26 8-22Q28-18 29 0M-2-22 0 0"/><path d="M33-3 31-20M38-4 51 8" opacity=".6"/></g>`;
}

function houseSilhouette(x: number, y: number, scale: number, palette: LandscapePalette) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="1.4"><path d="M-60 0V-58L-39-58-39-76-20-76-20-91 7-101 33-91 33-76 51-76 51-58 64-58V0Z"/><path d="M-63-59H-41V-78H-22V-94L7-104 35-94V-78H53V-61H67" fill="none" stroke-width="2.4"/><path d="M-8 0V-28Q7-38 20-28V0" fill="${palette.ink}" fill-opacity=".35"/></g>`;
}

function drawMist(seed: number, palette: LandscapePalette, baseY: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const y = baseY + index * 34;
    const offset = hashUnit(seed, 200 + index) * 240;
    return `<path d="M${-120 + offset} ${y} Q300 ${y - 30} 720 ${y + 2} T1700 ${y - 4} T2050 ${y + 8} V${y + 38} Q1200 ${y + 66} ${-120 + offset} ${y + 38}Z" fill="${palette.paper}" fill-opacity=".38" stroke="${palette.ink}" stroke-opacity=".09"/>`;
  }).join("");
}

function drawSceneBody(scene: LandscapeScene, seed: number, palette: LandscapePalette, motif: LandscapeMotif) {
  const peaks = Array.from({ length: scene === "peaks" ? 9 : 6 }, (_, index) => tower(seed, index, palette, scene)).join("");
  if (scene === "peaks" || scene === "cliff") {
    const foreground = scene === "cliff"
      ? `<path d="M940 1200 L1030 430 Q1090 240 1240 160 L1510 250 Q1600 470 1660 1200Z" fill="${palette.wash}" fill-opacity=".72" stroke="${palette.ink}" stroke-opacity=".72" stroke-width="2.4"/><path d="M1080 470 Q1160 390 1235 255 M1135 550 Q1210 440 1265 315 M1200 670 Q1290 540 1360 390 M1270 800 Q1350 670 1420 520 M1320 950 Q1400 830 1480 700" fill="none" stroke="${palette.ink}" stroke-opacity=".3" stroke-width="1.2"/>`
      : `<g transform="translate(0 30)">${peaks}</g>`;
    return `${drawMist(seed, palette, 470, 3)}${foreground}${drawMist(seed + 9, palette, 720, 2)}${pineSilhouette(110, 1010, 1.75, palette)}${pineSilhouette(220, 1030, 1.1, palette)}${motif === "pavilion" ? pavilion(1420, 650, .9, palette) : ""}`;
  }
  if (scene === "tianchi") {
    const ring = Array.from({ length: 12 }, (_, index) => tower(seed + 33, index, palette, "peaks")).join("");
    return `<g opacity=".8">${ring}</g><path d="M0 590 Q420 548 820 578 T1600 570 L1920 574V1200H0Z" fill="${palette.water}" fill-opacity=".62"/><path d="M120 720 Q480 680 940 715 T1800 700" fill="none" stroke="${palette.ink}" stroke-opacity=".35" stroke-width="2"/>${drawMist(seed, palette, 610, 2)}${Array.from({ length: 9 }, (_, index) => pineSilhouette(100 + index * 205, 1020 - (index % 3) * 12, .9 + (index % 4) * .15, palette)).join("")}${motif === "boat" ? boatSilhouette(1220, 830, .9, palette) : ""}`;
  }
  if (scene === "karst") {
    return `<g fill="${palette.wash}" fill-opacity=".55" stroke="${palette.ink}" stroke-opacity=".6" stroke-width="1.8">${Array.from({ length: 8 }, (_, index) => { const x = 80 + index * 245; const top = 280 + hashUnit(seed, index) * 150; return `<path d="M${x} 760 C${x + 18} 610 ${x - 2} 580 ${x + 34} 470 C${x + 52} 410 ${x + 66} 318 ${x + 108} ${top} C${x + 144} 310 ${x + 154} 410 ${x + 174} 470 C${x + 206} 572 ${x + 178} 640 ${x + 214} 760Z"/>`; }).join("")}</g><path d="M0 700 Q480 654 960 692 T1920 684V1200H0Z" fill="${palette.water}" fill-opacity=".66"/>${drawMist(seed, palette, 560, 2)}${boatSilhouette(1180, 880, .9, palette)}${pineSilhouette(130, 1010, 1.2, palette)}`;
  }
  if (scene === "jiangnan" || scene === "huizhou") {
    const village = Array.from({ length: 5 }, (_, index) => houseSilhouette(170 + index * 300, 860, .85 + (index % 3) * .12, palette)).join("");
    return `<path d="M0 660 Q340 602 700 646 T1500 640T1920 650V1200H0Z" fill="${palette.water}" fill-opacity=".63"/><path d="M0 826 Q340 790 700 818 T1500 812T1920 820" fill="none" stroke="${palette.ink}" stroke-opacity=".38" stroke-width="2"/>${drawMist(seed, palette, 520, 2)}${village}${scene === "jiangnan" ? `<path d="M720 900 Q900 690 1100 890L1100 910Q900 760 720 918Z" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2"/>${pineSilhouette(1540, 930, 1.35, palette)}` : ""}${boatSilhouette(900, 960, .8, palette)}`;
  }
  if (scene === "desert") {
    return `<g fill="${palette.wash}" fill-opacity=".76">${[0, 1, 2, 3].map((index) => `<path d="M0 ${700 + index * 100} Q420 ${500 + index * 115} 820 ${720 + index * 80} T1920 ${680 + index * 105}V1200H0Z"/>`).join("")}</g><path d="M920 850 Q1040 760 1160 842 Q1080 814 1010 890 Q970 866 920 850Z" fill="${palette.water}" fill-opacity=".85"/>${pavilion(1240, 810, .8, palette)}${drawMist(seed, palette, 520, 1)}`;
  }
  if (scene === "coast") {
    return `<path d="M0 650 Q420 632 900 648 T1920 644V1200H0Z" fill="${palette.water}" fill-opacity=".67"/><path d="M0 800 Q240 720 420 780 Q560 742 640 840 L720 1200H0Z" fill="${palette.wash}" fill-opacity=".9"/><g transform="translate(1410 656)"><path d="M-26 0-18-198H20L30 0Z" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="2"/><path d="M-22-198V-224H24V-198ZM-28-224-3-246 28-224Z" fill="${palette.accent}" stroke="${palette.ink}" stroke-width="1.5"/><path d="M-15-160H17M-18-128H20M-20-94H22" stroke="${palette.ink}" stroke-width="1.2"/></g>${houseSilhouette(850, 900, .6, palette)}${boatSilhouette(620, 930, .75, palette)}${drawMist(seed, palette, 590, 1)}`;
  }
  return `<path d="M0 720 L0 360 Q160 300 260 430 L360 250 470 470 600 320 760 520 900 280 1040 500 1160 330 1330 520 1480 350 1640 540 1780 380 1920 500V1200H0Z" fill="${palette.wash}" fill-opacity=".7" stroke="${palette.ink}" stroke-opacity=".55" stroke-width="2"/><path d="M650 520 Q720 760 720 1200 M1240 430 Q1170 700 1180 1200" fill="none" stroke="${palette.water}" stroke-opacity=".75" stroke-width="22"/>${drawMist(seed, palette, 600, 2)}${pineSilhouette(180, 1040, 1.2, palette)}${boatSilhouette(930, 900, .8, palette)}`;
}

export function atmosphericSvg(parameters: LandscapeParameters): string {
  const { palette, scene, seed } = landscapeComposition(parameters);
  const sunX = parameters.sunX * 1.2;
  const sunY = scene === "desert" || scene === "coast" ? 330 : 280;
  const water = palette.water;
  const moon = parameters.celestial === "moon";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1200" viewBox="0 0 1920 1200">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.paper}"/><stop offset=".62" stop-color="${palette.mist}"/><stop offset="1" stop-color="${palette.wash}" stop-opacity=".65"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${color(palette, "sun")}" stop-opacity=".62"/><stop offset=".34" stop-color="${color(palette, "sun")}" stop-opacity=".18"/><stop offset="1" stop-color="${color(palette, "sun")}" stop-opacity="0"/></radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${water}" stop-opacity=".72"/><stop offset="1" stop-color="${palette.paper}" stop-opacity=".82"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="12"/></filter>
    <pattern id="grain" width="83" height="71" patternUnits="userSpaceOnUse"><circle cx="9" cy="13" r=".7" fill="${palette.ink}" opacity=".09"/><circle cx="49" cy="37" r=".55" fill="${palette.ink}" opacity=".08"/><path d="M22 54l13-1M66 18l9 1" stroke="${palette.ink}" stroke-width=".5" opacity=".08"/></pattern>
  </defs>
  <rect width="1920" height="1200" fill="url(#sky)"/>
  ${parameters.celestial === "cloud" ? drawMist(seed, palette, 260, 3) : `<circle cx="${sunX.toFixed(1)}" cy="${sunY}" r="210" fill="url(#glow)"/><circle cx="${sunX.toFixed(1)}" cy="${sunY}" r="${moon ? 58 : 46}" fill="${moon ? palette.paper : palette.sun}" fill-opacity="${moon ? .96 : .64}" stroke="${palette.sun}" stroke-opacity=".35"/>`}
  <g filter="url(#soft)" opacity=".55">${Array.from({ length: 4 }, (_, index) => `<path d="${ridgePath(seed + index * 17, 510 + index * 90, 140 + index * 65, index)}" fill="${index % 2 ? palette.paper : palette.wash}"/>`).join("")}</g>
  <g transform="translate(0 ${1200 * (1 - (.92 + parameters.ridge * .0016))}) scale(1 ${.92 + parameters.ridge * .0016})">${drawSceneBody(scene, seed, palette, parameters.motif)}</g>
  <g opacity=".45" filter="url(#soft)">${drawMist(seed + 5, palette, 560, 2)}</g>
  <rect width="1920" height="1200" fill="url(#grain)"/>
</svg>`;
}
