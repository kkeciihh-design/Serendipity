import { NextResponse } from "next/server";
import {
  hasSettingsSession,
  hasValidCsrf,
  unauthorizedResponse,
} from "@/lib/access";
import { testTextConnection } from "@/lib/ai-adapter";
import {
  SettingsValidationError,
  createTestToken,
  effectiveConfiguration,
  getSafeSettings,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const configuration = await effectiveConfiguration(body);
    const settings = await getSafeSettings();
    const result = await testTextConnection({
      provider: configuration.provider,
      baseUrl: configuration.baseUrl,
      apiKey: configuration.apiKey,
      model: configuration.model,
      systemPrompt: settings.prompts.systemPrompt,
      basePrompt: settings.prompts.basePrompt,
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        category: result.category,
        error: result.message,
      });
    }

    return NextResponse.json({
      ok: true,
      testToken: createTestToken(configuration),
      responsePreview: result.responsePreview,
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

    console.error("AI connection test failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "连接测试失败，请稍后再试。" },
      { status: 503 },
    );
  }
}
