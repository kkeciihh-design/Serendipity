import { NextResponse } from "next/server";
import {
  hasSettingsSession,
  hasValidCsrf,
  unauthorizedResponse,
} from "@/lib/access";
import { fetchModelList } from "@/lib/ai-adapter";
import {
  SettingsValidationError,
  effectiveModelConfiguration,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const configuration = await effectiveModelConfiguration(body);
    const result = await fetchModelList({
      provider: configuration.provider,
      baseUrl: configuration.baseUrl,
      apiKey: configuration.apiKey,
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: result.message,
      });
    }

    return NextResponse.json({
      ok: true,
      models: result.models,
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

    console.error("AI model list request failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "获取模型列表失败，请稍后再试。" },
      { status: 503 },
    );
  }
}
