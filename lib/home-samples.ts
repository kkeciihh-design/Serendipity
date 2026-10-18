export type SampleTrip = {
  title: string;
  destination: string;
  destinationLatin: string;
  duration: string;
  style: string;
  preview: { day: string; title: string }[];
  days: { day: string; title: string; route: string; rhythm: string }[];
  transport: string;
  tickets: string;
};

export const sampleTrips: SampleTrip[] = [
  {
    title: "杭州两日轻松漫步",
    destination: "杭州",
    destinationLatin: "HANGZHOU",
    duration: "2 天 1 晚",
    style: "西湖晨雾与南山茶事 · 适合初次造访、偏爱少折返慢节奏的你",
    preview: [
      { day: "Day 1", title: "湖滨漫步" },
      { day: "午后", title: "法喜寺寻幽" },
      { day: "Day 2", title: "龙井问茶" },
    ],
    days: [
      {
        day: "Day 1",
        title: "循着湖光，走进山林",
        route: "湖滨晨间散步 → 湖畔午餐 → 午后法喜寺 → 返回湖滨休息",
        rhythm: "上午留给西湖，午后再往上天竺。山路慢走，寺院停留留足余裕。",
      },
      {
        day: "Day 2",
        title: "在茶香里多坐一会儿",
        route: "龙井村早茶 → 茶田轻徒步 → 南山路午餐 → 取行李返程",
        rhythm: "只安排一段轻松茶田步道；午后回到市区，为取行李和返程留出时间。",
      },
    ],
    transport: "上天竺与龙井村间以公交或打车衔接；山间路况、末班车与返程时刻待核实。",
    tickets: "法喜寺开放时段、入寺安排及茶田可进入范围，出发前逐一核实。",
  },
  {
    title: "成都五日美食与周边",
    destination: "成都",
    destinationLatin: "CHENGDU",
    duration: "5 天 4 晚",
    style: "街巷烟火与川西林盘 · 兼顾老城慢逛与一日近郊的松弛排布",
    preview: [
      { day: "Day 1", title: "少城茶叙" },
      { day: "入夜", title: "锦江夜游" },
      { day: "Day 3", title: "都江堰寻古" },
    ],
    days: [
      {
        day: "Day 1",
        title: "一盏盖碗茶，慢慢入城",
        route: "人民公园喝茶 → 少城街巷 → 老城晚餐 → 锦江岸边夜游",
        rhythm: "抵达后以步行为主，让第一天松一些。夜游沿江散步，随时可以回去休息。",
      },
      {
        day: "Day 2",
        title: "把胃口留给街巷",
        route: "宽窄巷子晨逛 → 市井小馆 → 下午回住处小憩 → 玉林街区晚餐",
        rhythm: "错开热门街区的人流，午后留白；两餐之间不塞满景点。",
      },
      {
        day: "Day 3",
        title: "去都江堰，看水与岁月",
        route: "城际列车前往都江堰 → 水利景区 → 灌县古城 → 傍晚返回成都",
        rhythm: "近郊只走都江堰一线，不与青城山赶在同一天，返程前留出机动时间。",
      },
      {
        day: "Day 4",
        title: "在林盘与茶舍间停留",
        route: "浣花溪散步 → 杜甫草堂 → 下午前往三圣乡 → 林盘茶舍与晚餐",
        rhythm: "上午看老城绿意，午后在近郊坐一坐；若遇雨，把茶舍时光留在市区。",
      },
      {
        day: "Day 5",
        title: "吃一碗热面，再从容告别",
        route: "住处附近早餐 → 买一点伴手礼 → 取行李 → 前往车站或机场",
        rhythm: "最后半天不安排远处景点，按实际出发时间收好行程。",
      },
    ],
    transport: "都江堰往返列车、车站至景区接驳与三圣乡回城安排待核实，预留候车余裕。",
    tickets: "都江堰与杜甫草堂的预约方式、开放时段及门票价格，出发前核实。",
  },
  {
    title: "青岛三日海岸线",
    destination: "青岛",
    destinationLatin: "QINGDAO",
    duration: "3 天 2 晚",
    style: "红瓦老城与礁石海风 · 在山海栈道与百年街区之间从容漫游",
    preview: [
      { day: "Day 1", title: "信号山俯瞰" },
      { day: "傍晚", title: "琴屿路日落" },
      { day: "Day 2", title: "八大关漫游" },
    ],
    days: [
      {
        day: "Day 1",
        title: "从红瓦屋顶走向海边",
        route: "信号山俯瞰老城 → 龙江路街区 → 大学路午餐 → 琴屿路等日落",
        rhythm: "顺着老城坡路慢慢下行，留一段傍晚给海边；日落时刻随季节调整。",
      },
      {
        day: "Day 2",
        title: "沿着海风，走过八大关",
        route: "八大关晨间漫游 → 第二海水浴场 → 海鲜午餐 → 太平角海岸散步",
        rhythm: "把沿海步行拆成两段，中途休息；风大或降雨时，改在街区咖啡馆停留。",
      },
      {
        day: "Day 3",
        title: "以一顿老城早餐作别",
        route: "老城早餐 → 栈桥短途散步 → 取行李 → 前往车站或机场",
        rhythm: "最后一程靠近住处与交通节点，海边停留长短随返程时刻安排。",
      },
    ],
    transport: "老城坡路与海岸线以步行为主，远段接地铁或打车；末班车与返程时刻待核实。",
    tickets: "信号山及八大关内建筑的开放与购票安排、海岸步道通行情况，出发前核实。",
  },
];
