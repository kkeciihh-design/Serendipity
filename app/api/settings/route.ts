import { NextResponse } from "next/server";
import {
  hasSettingsSession,
  hasValidCsrf,
  unauthorizedResponse,
} from "@/lib/access";
import {
  SettingsValidationError,
  getSafeSettings,
  saveAIConfiguration,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSettingsSession(request)) {
    return unauthorizedResponse();
  }

  try {
    return NextResponse.json(await getSafeSettings());
  } catch (error) {
    console.error("Settings read failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "读取设置失败，请稍后再试。" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const testToken =
      typeof body.testToken === "string" ? body.testToken : undefined;
    return NextResponse.json(await saveAIConfiguration(body, testToken));
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

    console.error("AI settings save failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "保存 AI 设置失败，原配置保持不变。" },
      { status: 503 },
    );
  }
}
