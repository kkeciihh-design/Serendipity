import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  Compass,
  ExternalLink,
  Leaf,
  Settings,
} from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
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

export default async function HomePage() {
  await requirePageAppAccess();

  return (
    <main className="editorial-home">
      <section className="home-cover">
        <Image
          priority
          fill
          src="/images/jiuzhaigou-home.jpg"
          alt="九寨沟五花海：蓝色湖水与远处山林构成的旅行场景。"
          sizes="100vw"
          className="home-cover-image"
        />
        <div aria-hidden="true" className="home-cover-shade" />
        <div className="home-cover-content">
          <header className="home-navigation">
            <div className="home-brand">
              <Compass aria-hidden="true" className="home-brand-symbol" strokeWidth={1.2} />
              <div>
                <p className="home-wordmark">Serendipity</p>
                <p className="home-brand-caption">AI 旅行规划助手</p>
              </div>
            </div>
            <div className="home-navigation-actions">
              <p className="home-local-note">
                <span className="home-local-dot" aria-hidden="true" />
                <span>本地优先</span>
                <span className="home-personal-note">个人旅行助手</span>
              </p>
              <Link
                href="/trips"
                className="home-navigation-link home-navigation-trips"
              >
                我的旅行
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
              <Link href="/runtime" className="home-navigation-link">运行状态</Link>
              <Link
                href="/settings"
                title="个人设置"
                aria-label="个人设置"
                className="home-settings-link"
              >
                <Settings aria-hidden="true" className="size-4" strokeWidth={1.5} />
              </Link>
            </div>
          </header>
          <div className="home-cover-story home-container">
            <div className="home-cover-kicker" aria-hidden="true">
              <span className="home-fine-rule" />
              THE ART OF A WELL-PLANNED JOURNEY
            </div>
            <h1 className="home-cover-title" aria-label="把旅行想法整理成能执行的计划">
              <span>把旅行想法</span><span>整理成能执行的计划</span>
            </h1>
            <p className="home-cover-description">
              <span>Serendipity 面向个人旅行：先理解你的想法，</span><span>再让时间、地点、预算和待确认事实保持一致。</span>
            </p>
            <div className="home-cover-actions">
              <a
                href="#trip-input"
                className="home-cover-button home-cover-button-primary"
              >
                开始创建旅行
                <ArrowDown aria-hidden="true" className="size-4" />
              </a>
              <a
                href="#sample-trips"
                className="home-cover-button home-cover-button-secondary"
              >
                查看展示样例
              </a>
              <p className="home-cover-aside">
                现在可以用一句话保存原话草稿，再让 AI 核对需求和关键问题。
              </p>
            </div>
          </div>
          <div className="home-cover-colophon home-container" aria-hidden="true">
            <span><span className="home-coordinate-cross">+</span> JIUZHAIGOU, CHINA <span className="home-coordinate">33°15′ N · 103°55′ E</span></span>
            <span>VOL. 01 <span className="home-colophon-divider">/</span> 山水之间，自有方向</span>
          </div>
        </div>
      </section>

      <div className="home-issue-strip home-container" aria-hidden="true">
        <span className="home-issue-number">ISSUE NO.01 <span>—</span> LOCAL-FIRST TRAVEL ATELIER</span>
        <span className="home-issue-caption">一册山水，一段自己的旅程。</span>
        <span className="home-issue-index">灵感 / 目的地 / 出发 <ArrowDown size={13} strokeWidth={1.2} /></span>
      </div>

      <section
        id="sample-trips"
        className="home-showcase home-section"
      >
        <div className="home-container">
          <div className="home-section-heading">
            <div>
              <div className="home-section-kicker"><span aria-hidden="true">SHOWCASE ·</span><p>展示样例</p></div>
              <h2 className="home-section-title">先看它要整理什么样的信息</h2>
              <p className="home-section-note">
                以下是人工编写的展示样例，用来说明信息层级；它们不是 AI 实时生成，也不是你的个人旅行。
              </p>
            </div>
            <span className="home-section-folio" aria-hidden="true">01 — 03<span>DESTINATION STUDIES</span></span>
          </div>
          <div className="home-sample-grid">
            {sampleTrips.map((trip, index) => (
              <SampleTripCard key={trip.title} trip={trip} issue={String(index + 1).padStart(2, "0")} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="trip-input"
        className="home-studio home-section"
      >
        <div className="home-container">
          <div className="home-studio-heading">
            <div>
              <div className="home-section-kicker"><span aria-hidden="true">YOUR TRAVEL STUDIO ·</span><p>我的旅行</p></div>
              <h2 className="home-section-title">用一句话开始一趟旅行</h2>
            </div>
            <span className="home-studio-edition" aria-hidden="true">每一次出发，始于一个念头。<ArrowDown className="size-4" /></span>
          </div>
          <p className="home-studio-description">
            先写下你的想法，应用会完整保留原话并保存到本机数据库。AI 只生成待确认的需求摘要，不会直接生成行程。
          </p>
          <div className="home-studio-grid">
            <TripDraftForm />
            <aside className="home-manifesto" aria-hidden="true">
              <div className="home-manifesto-topline"><span>FROM THOUGHT TO ITINERARY</span><Compass size={21} strokeWidth={1} /></div>
              <div className="home-manifesto-intro">
                <p className="home-manifesto-title">让灵感有迹可循。</p>
                <p>留一份随性，也留一份笃定。</p>
              </div>
              <ol className="home-workflow">
                <li><span>01</span><div><p>原话留存</p><small>珍藏出发时的念头</small></div><span className="home-workflow-mark">↗</span></li>
                <li><span>02</span><div><p>要素拆解</p><small>把时间、地点与偏好慢慢理清</small></div><span className="home-workflow-mark">↗</span></li>
                <li><span>03</span><div><p>预算与红线校验</p><small>为每一份期待留出余地</small></div><span className="home-workflow-mark">↗</span></li>
                <li><span>04</span><div><p>离线随身导出</p><small>将确认好的安排带在身边</small></div><span className="home-workflow-mark">↗</span></li>
              </ol>
              <div className="home-manifesto-footer">
                <div><Leaf size={15} strokeWidth={1.4} /><p>灵感归你，原话留在本机。<br /><span>LOCAL FIRST. ALWAYS YOURS.</span></p></div>
                <span className="home-local-seal">本机<br />留存</span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-container">
          <div className="home-footer-signature" aria-hidden="true"><span>Serendipity</span><span>A LITTLE WONDER. A WELL-MADE PLAN.</span></div>
          <div className="home-footer-colophon">
          <p>
            首页图片：Chensiyuan，CC BY-SA 4.0，via Wikimedia Commons，2026-10-08 获取。
          </p>
          <a
            href="https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg"
            className="home-license-link"
          >
            查看图片许可
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
