import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f8fafc] px-6 py-10">
      <section className="w-full max-w-md text-center">
        <h1 className="text-3xl font-bold tracking-normal text-slate-950">
          没有找到这个页面
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          当前地址不存在，可以返回首页。
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
