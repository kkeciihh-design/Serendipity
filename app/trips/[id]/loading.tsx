export default function TripDetailLoading() {
  return (
    <main className="min-h-dvh bg-cream px-5 py-8 sm:px-10 sm:py-12 lg:px-16">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-medium text-sage">旅行详情</p>
        <h1 className="mt-2 text-3xl font-bold leading-9 text-charcoal">
          正在打开旅行...
        </h1>
        <p className="mt-4 rounded-md bg-shell px-4 py-3 text-base leading-7 text-graphite">
          正在读取旅行、需求确认和当前计划版本；内容加载前不会替换已有数据。
        </p>
      </div>
    </main>
  );
}
