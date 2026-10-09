import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  isLoopbackHost,
} from "./request-security";
import { verifySessionToken } from "./security";

export async function requirePageAppAccess() {
  const [cookieStore, headerStore] = await Promise.all([
    cookies(),
    headers(),
  ]);

  if (isLoopbackHost(headerStore.get("host"))) {
    return;
  }

  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    redirect("/settings");
  }
}
