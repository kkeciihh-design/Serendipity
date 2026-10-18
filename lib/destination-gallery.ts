/**
 * Local, deliberately ordered gallery. Keep Jiuzhaigou first so server rendering
 * and the client's first render always describe the same landscape.
 * Coordinates are approximate scenic-area references, not navigation waypoints.
 */
export type DestinationGalleryId = "jiuzhaigou" | "west-lake" | "li-river" | "hongcun" | "xiapu";

export type GalleryPhoto = {
  src: string;
  alt: string;
  position?: string;
  author: string;
  source: string;
  license: string;
  licenseUrl: string;
  modification: string;
};

export type GalleryDestination = {
  id: DestinationGalleryId;
  name: string;
  latin: string;
  region: string;
  coordinates: string;
  season: string;
  note: string;
  prompt: string;
  photo: GalleryPhoto;
};

const localPhotoModification = "原图等比缩小并转换为 WebP；页面以裁切和暗色渐变呈现。图像衍生物沿用原许可。";

export const destinationGallery: readonly GalleryDestination[] = [
  {
    id: "jiuzhaigou",
    name: "九寨沟",
    latin: "JIUZHAIGOU",
    region: "四川 · 阿坝",
    coordinates: "33.22° N · 103.90° E",
    season: "秋日 · 层林映海",
    note: "山色沉入五花海，风把秋天写得很轻。沿着木栈道慢走，把一整天交给澄澈的蓝。",
    prompt: "想在秋天去九寨沟旅行 3 天，和朋友一起看五花海与彩林，沿栈道轻松慢走，留足休息和拍照的时间。请帮我规划交通、住宿和每日路线。",
    photo: {
      src: "/images/jiuzhaigou-home.jpg",
      alt: "九寨沟五花海的碧蓝湖水、彩林与群山实景",
      position: "center 54%",
      author: "Chensiyuan",
      source: "https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      modification: "使用原有 1280px 缩略图；页面以裁切和暗色渐变呈现。图像衍生物沿用 CC BY-SA 4.0。",
    },
  },
  {
    id: "west-lake",
    name: "西湖",
    latin: "WEST LAKE",
    region: "浙江 · 杭州",
    coordinates: "30.24° N · 120.15° E",
    season: "春秋 · 湖山入画",
    note: "湖光接住了远山，也接住了一段不赶路的时光。等暮色落下，再循着茶香走进江南。",
    prompt: "想去杭州西湖过一个 3 天的慢周末，两个人同行，喜欢湖边散步、江南园林和龙井茶，不想把行程排得太满。请帮我规划适合春秋出行的路线。",
    photo: {
      src: "/images/gallery/west-lake.webp",
      alt: "杭州西湖夕照下的湖水与远山实景",
      position: "center 55%",
      author: "Morio",
      source: "https://commons.wikimedia.org/wiki/File:West_Lake_(Hangzhou)_sunset_2016_January.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      modification: localPhotoModification,
    },
  },
  {
    id: "li-river",
    name: "漓江",
    latin: "LI RIVER",
    region: "广西 · 桂林",
    coordinates: "24.93° N · 110.53° E",
    season: "春夏 · 烟雨青山",
    note: "一江清水绕过青峰，山的轮廓像未干的墨。去兴坪听一会儿水声，让日子顺流慢下来。",
    prompt: "想去桂林和阳朔旅行 4 天，重点看漓江与兴坪的山水，喜欢轻松步行、沿江观景和当地小吃。两个人同行，请安排舒缓的路线并提供雨天备选。",
    photo: {
      src: "/images/gallery/li-river.webp",
      alt: "广西兴坪漓江岸边的喀斯特青峰与江水实景",
      position: "center 55%",
      author: "ReeveJ",
      source: "https://commons.wikimedia.org/wiki/File:Xingping_114.JPG",
      license: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      modification: localPhotoModification,
    },
  },
  {
    id: "hongcun",
    name: "宏村",
    latin: "HONGCUN",
    region: "安徽 · 黄山",
    coordinates: "30.00° N · 117.99° E",
    season: "春秋 · 徽州清梦",
    note: "粉墙黛瓦倒映在月沼，一条巷子就能走过半日。留一个清晨，听徽州在水边醒来。",
    prompt: "想去安徽宏村住 2 晚，慢慢逛月沼、南湖和徽州老巷，喜欢建筑、写生和清晨摄影。请帮我安排 3 天行程、交通方式与不赶路的游览节奏。",
    photo: {
      src: "/images/gallery/hongcun.webp",
      alt: "安徽宏村月沼水面与徽派粉墙黛瓦民居实景",
      position: "center 55%",
      author: "EditQ",
      source: "https://commons.wikimedia.org/wiki/File:Moon_Pond,_Hongcun.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      modification: localPhotoModification,
    },
  },
  {
    id: "xiapu",
    name: "霞浦",
    latin: "XIAPU",
    region: "福建 · 宁德",
    coordinates: "26.88° N · 120.06° E",
    season: "春秋 · 潮汐拾光",
    note: "潮水退去，滩涂便铺开细密的纹理。等一束晨光掠过竹竿与渔舟，看海写下自己的诗。",
    prompt: "想去福建霞浦旅行 3 天，看北岐滩涂的日出和海边渔村，喜欢摄影与海鲜。请安排轻松路线，并提醒我如何根据天气和潮汐调整观景时间。",
    photo: {
      src: "/images/gallery/xiapu.webp",
      alt: "福建霞浦北岐滩涂日出与海上竹竿实景",
      position: "center 54%",
      author: "Jay Huang",
      source: "https://commons.wikimedia.org/wiki/File:Xiapu_Sunrise_-_Flickr_-_Jaykhuang.jpg",
      license: "CC BY 2.0",
      licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
      modification: localPhotoModification,
    },
  },
];

export const defaultDestination = destinationGallery[0];

/** City cards use photographs of their own destinations, never substitute scenery. */
export const samplePhotography: Record<"杭州" | "成都" | "青岛", GalleryPhoto> = {
  杭州: destinationGallery[1].photo,
  成都: {
    src: "/images/gallery/chengdu.webp",
    alt: "成都杜甫草堂的园林与传统建筑实景",
    position: "center 54%",
    author: "Tyg728",
    source: "https://commons.wikimedia.org/wiki/File:Du_Fu_Thatched_Cottage_-_Chengdu_20161121.jpg",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    modification: localPhotoModification,
  },
  青岛: {
    src: "/images/gallery/qingdao.webp",
    alt: "青岛栈桥、回澜阁与海湾实景",
    position: "center 52%",
    author: "Windmemories",
    source: "https://commons.wikimedia.org/wiki/File:20240729_Zhanqiao_01.jpg",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    modification: localPhotoModification,
  },
};
