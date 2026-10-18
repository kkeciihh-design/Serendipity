import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, ExternalLink, Settings } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { sampleTrips } from "@/lib/home-samples";
import { SampleTripCard } from "./components/sample-trip-card";
import { TripDraftForm } from "./components/trip-draft-form";

export default async function HomePage() {
  await requirePageAppAccess();

  return (
    <main className="editorial-home">
      <section className="home-cover" aria-labelledby="home-title">
        <Image
          priority
          fill
          src="/images/jiuzhaigou-home.jpg"
          alt="九寨沟五花海：碧水映着秋林，群山在远处徐徐展开。"
          sizes="100vw"
          className="home-cover-image"
        />
        <div aria-hidden="true" className="home-cover-shade" />
        <div className="home-cover-content">
          <header className="home-navigation home-container">
            <div className="home-brand">
              <p className="home-wordmark">Serendipity</p>
              <p className="home-brand-caption">个人旅行规划工作室</p>
            </div>
            <nav className="home-navigation-actions" aria-label="主导航">
              <Link href="/trips" className="home-navigation-link">
                我的旅行
                <ArrowUpRight aria-hidden="true" className="home-nav-arrow" />
              </Link>
              <Link href="/runtime" className="home-navigation-link">运行状态</Link>
              <Link href="/settings" title="个人设置" aria-label="个人设置" className="home-settings-link">
                <Settings aria-hidden="true" size={16} strokeWidth={1.5} />
              </Link>
            </nav>
          </header>

          <div className="home-cover-story home-container">
            <p className="home-cover-kicker" aria-hidden="true">
              <span /> A LITTLE WONDER, A JOURNEY OF YOUR OWN <span />
            </p>
            <h1 id="home-title" className="home-cover-title" aria-label="从一句向往出发，把心之所向写成笃定的旅程">
              <span>从一句向往出发</span>
              <span>把心之所向写成笃定的旅程</span>
            </h1>
            <p className="home-cover-description">
              写下你想去的地方、同行的人与偏爱的节奏——路线推演、预算精算与时刻接驳，皆在你的本机妥帖排布。
            </p>
            <TripDraftForm />
          </div>

          <div className="home-cover-colophon home-container">
            <span aria-hidden="true">JIUZHAIGOU <span className="home-colophon-divider">/</span> 九寨沟 · 秋</span>
            <a href="#sample-trips">翻阅旅程样本 <ArrowDown aria-hidden="true" size={13} strokeWidth={1.5} /></a>
            <span className="home-coordinate" aria-hidden="true">33°15′ N · 103°55′ E</span>
          </div>
        </div>
      </section>

      <section id="sample-trips" className="home-showcase" aria-labelledby="lookbook-title">
        <div className="home-container">
          <div className="home-section-heading">
            <div>
              <p className="home-section-kicker"><span aria-hidden="true">THE CURATED LOOKBOOK</span><span>精选旅程</span></p>
              <h2 id="lookbook-title" className="home-section-title">一趟好旅行，当有清晰的脉络</h2>
              <p className="home-section-note">
                从每日动线、交通接驳到待核实的门票细节，翻阅三份精选样本，感受旅途如何被井然梳理。
              </p>
            </div>
            <span className="home-section-folio" aria-hidden="true">01 — 03<span>三座城，三种出发的心情</span></span>
          </div>
          <div className="home-sample-grid">
            {sampleTrips.map((trip, index) => (
              <SampleTripCard key={trip.destination} trip={trip} issue={String(index + 1).padStart(2, "0")} />
            ))}
          </div>
          <p className="home-sample-footnote">* 以下为内置精选样本，展示行程结构与核验维度</p>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-container">
          <div className="home-footer-signature" aria-hidden="true">
            <span>Serendipity</span><span>山水之间，自有方向。</span>
          </div>
          <div className="home-footer-colophon">
            <p>首页图片：Chensiyuan，CC BY-SA 4.0，via Wikimedia Commons，2026-10-08 获取。</p>
            <a href="https://commons.wikimedia.org/wiki/File:1_jiuzhaigou_valley_wu_hua_hai_2011b.jpg" className="home-license-link">
              查看图片许可<ExternalLink aria-hidden="true" size={12} />
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
