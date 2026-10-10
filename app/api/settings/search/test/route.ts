import { NextResponse } from "next/server";
import {
  hasSettingsSession,
  hasValidCsrf,
  unauthorizedResponse,
} from "@/lib/access";
import { testSearchConnection } from "@/lib/evidence-source";
import {
  SettingsValidationError,
  createSearchTestToken,
  effectiveSearchConfiguration,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  try {
    const configuration = await effectiveSearchConfiguration(
      await request.json(),
    );
    const result = await testSearchConnection({
      language: configuration.language,
    });
    return NextResponse.json({
      ok: true,
      testToken: createSearchTestToken(configuration),
      resultCount: result.resultCount,
      firstResult: result.firstResult,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确。" },
        { status: 400 },
      );
    }
    if (error instanceof SettingsValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }
    console.error("Search connection test failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "搜索服务连接失败，请稍后再试。",
      },
      { status: 502 },
    );
  }
}
