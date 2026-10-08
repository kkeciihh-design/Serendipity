"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f8fafc] px-6 py-10">
      <section className="w-full max-w-md text-center">
        <h1 className="text-3xl font-bold tracking-normal text-slate-950">
          页面出现了问题
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          服务仍在运行。你可以重试；如果问题持续出现，请查看项目验收记录中的恢复方式。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          重试
        </button>
      </section>
    </main>
  );
}
