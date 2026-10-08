import Image from "next/image";
import {
  ArrowDown,
  ExternalLink,
} from "lucide-react";
import { SampleTripCard, type SampleTrip } from "./components/sample-trip-card";
import { TripDraftForm } from "./components/trip-draft-form";

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
                href="#trip-input"
                className="inline-flex min-h-12 items-center gap-2 rounded-md bg-cream px-5 py-3 text-base font-semibold text-charcoal transition-colors hover:bg-white focus-visible:outline-cream"
              >
                开始创建旅行
                <ArrowDown aria-hidden="true" className="size-5" />
              </a>
              <a
                href="#sample-trips"
                className="inline-flex min-h-12 items-center rounded-md border border-cream/70 px-5 py-3 text-base font-medium text-cream transition-colors hover:border-cream hover:bg-cream/10 focus-visible:outline-cream"
              >
                查看展示样例
              </a>
              <p className="text-base leading-7 text-cream/85">
                现在可以用一句话创建原话草稿，先完整保留你的想法。
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

      <section
        id="trip-input"
        className="scroll-mt-4 bg-shell px-5 py-12 sm:px-10 sm:py-16 lg:px-16"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-medium text-sage">我的旅行</p>
          <h2 className="mt-2 text-3xl font-bold leading-9 text-charcoal">
            用一句话开始一趟旅行
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-graphite">
            先写下你的想法，应用会完整保留原话并生成一个临时草稿标识。它不会假装已经理解需求，也不会显示“AI 已生成行程”。
          </p>
          <TripDraftForm />
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
