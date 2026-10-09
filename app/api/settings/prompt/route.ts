import { NextResponse } from "next/server";
import {
  hasSettingsSession,
  hasValidCsrf,
  unauthorizedResponse,
} from "@/lib/access";
import { SettingsValidationError, savePrompts } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!hasSettingsSession(request) || !hasValidCsrf(request)) {
    return unauthorizedResponse();
  }

  try {
    return NextResponse.json(await savePrompts(await request.json()));
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

    console.error("Prompt settings save failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "保存 Prompt 失败，当前内容保持不变。" },
      { status: 503 },
    );
  }
}
