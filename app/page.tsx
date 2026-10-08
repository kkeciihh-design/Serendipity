import Image from "next/image";
import {
  ArrowDown,
  CircleCheck,
  ExternalLink,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { SampleTripCard, type SampleTrip } from "./components/sample-trip-card";

const sampleTrips: SampleTrip[] = [
  {
    title: "杭州两日轻松漫步",
    destination: "杭州",
    duration: "2 天 1 晚",
    style: "适合第一次去杭州、想少折返的人。",
    highlights: [
      "第一天：西湖清晨环线、湖滨午餐、河坊街傍晚。",
      "第二天：灵隐寺、龙井村茶舍、返程前晚餐。",
    ],
  },
  {
    title: "成都五日美食与周边",
    destination: "成都",
    duration: "5 天 4 晚",
    style: "适合想同时安排市区和一日周边的人。",
    highlights: [
      "市区：人民公园、宽窄巷子、玉林社区晚餐。",
      "周边：都江堰半日、青城山半日，预留返程缓冲。",
    ],
  },
  {
    title: "青岛三日海岸线",
    destination: "青岛",
    duration: "3 天 2 晚",
    style: "适合喜欢步行看海、也愿意安排一处老城的人。",
    highlights: [
      "第一天：栈桥、小青岛、八大关步行路线。",
      "第二天：啤酒博物馆、台东步行街、灯光海岸。",
      "第三天：老城早餐、信号山、出发前整理清单。",
    ],
  },
];

const planningPrinciples = [
  {
    icon: CircleCheck,
    title: "需求先确认",
    description: "AI 提取和追问只形成待确认摘要，重要理解不被静默写入计划。",
  },
  {
    icon: ReceiptText,
    title: "时间和预算程序算",
    description: "衔接、合计和红线由应用计算，不直接相信模型口算结果。",
  },
  {
    icon: ShieldCheck,
    title: "事实与估算分开",
    description: "票价、开放时间和路线会保留来源；无法核验的内容明确标为待确认。",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-cream">
      <section className="relative flex min-h-[70svh] max-h-[820px] flex-col overflow-hidden">
        <Image
          priority
          fill
          src="/images/jiuzhaigou-home.jpg"
          alt="九寨沟五花海：蓝色湖水与远处山林构成的旅行场景。"
          sizes="100vw"
          className="object-cover"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-charcoal/55" />
        <div className="relative z-10 flex flex-1 flex-col">
          <header className="flex items-center justify-between px-5 py-6 sm:px-10 lg:px-16">
            <div>
              <p className="text-sm font-medium text-cream/85">AI 旅行规划助手</p>
              <p className="text-xl font-semibold text-white">Serendipity</p>
            </div>
            <p className="max-w-[45%] text-right text-sm leading-6 text-cream/85">
              本地优先
              <br className="hidden sm:block" />
              个人旅行助手
            </p>
          </header>
          <div className="mt-auto max-w-3xl px-5 pb-10 sm:px-10 lg:px-16 lg:pb-14">
            <h1 className="max-w-2xl text-4xl font-bold leading-10 text-white sm:text-5xl sm:leading-12">
              把旅行想法整理成能执行的计划
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-cream/90">
              Serendipity 面向个人旅行：先理解你的想法，再让时间、地点、预算和待确认事实保持一致。
            </p>
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <a
                href="#sample-trips"
                className="inline-flex min-h-12 items-center gap-2 rounded-md bg-cream px-5 py-3 text-base font-semibold text-charcoal transition-colors hover:bg-white focus-visible:outline-cream"
              >
                查看展示样例
                <ArrowDown aria-hidden="true" className="size-5" />
              </a>
              <p className="text-base leading-7 text-cream/85">
                创建旅行输入将在阶段 02 开放，本页不放置无结果的创建按钮。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="sample-trips"
        className="scroll-mt-4 bg-cream px-5 py-12 sm:px-10 sm:py-16 lg:px-16"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-medium text-clay">展示样例</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-bold leading-9 text-charcoal">
            先看它要整理什么样的信息
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-graphite">
            以下是人工编写的展示样例，用来说明信息层级；它们不是 AI 实时生成，也不是你的个人旅行。
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {sampleTrips.map((trip) => (
              <SampleTripCard key={trip.title} trip={trip} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-shell px-5 py-12 sm:px-10 sm:py-16 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-medium text-sage">我的旅行</p>
          <h2 className="mt-2 text-3xl font-bold leading-9 text-charcoal">
            当前还没有个人旅行
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-graphite">
            下一阶段会在这里开放一句话创建输入。现在保留空状态，避免让你误以为已经发生保存或生成。
          </p>
          <div className="mt-8 grid gap-6 border-t border-sand pt-8 md:grid-cols-3">
            {planningPrinciples.map((principle) => (
              <div key={principle.title}>
                <principle.icon
                  aria-hidden="true"
                  className="size-6 text-sage"
                />
                <h3 className="mt-3 text-lg font-semibold text-charcoal">
                  {principle.title}
                </h3>
                <p className="mt-2 text-base leading-7 text-graphite">
                  {principle.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-cream px-5 py-8 sm:px-10 lg:px-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-sand pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-graphite">
            首页图片：Chensiyuan，CC BY-SA 4.0，via Wikimedia Commons，2026-10-08 获取。
          </p>
          <a
            href="https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-sage hover:text-charcoal"
          >
            查看图片许可
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </footer>
    </main>
  );
}
