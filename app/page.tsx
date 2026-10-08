export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f8fafc] px-6 py-10">
      <section className="w-full max-w-2xl text-center">
        <p className="text-sm font-semibold tracking-normal text-teal-700">
          AI 旅行规划助手
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-normal text-slate-950 sm:text-5xl">
          Serendipity
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
          欢迎回来。项目骨架已经启动，后续阶段会在这里逐步构建你的旅行规划工作台。
        </p>
      </section>
    </main>
  );
}
