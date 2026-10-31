import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const protectedPath = request.nextUrl.pathname.startsWith("/dashboard") || request.nextUrl.pathname.startsWith("/projects") || request.nextUrl.pathname.startsWith("/admin");
  if (request.nextUrl.pathname.startsWith("/api/") && !user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const supportedApi = request.nextUrl.pathname.startsWith("/api/projects") || request.nextUrl.pathname.startsWith("/api/builds") || request.nextUrl.pathname.startsWith("/api/admin");
  if (request.nextUrl.pathname.startsWith("/api/") && !supportedApi) return NextResponse.json({ error: "Legacy endpoint disabled" }, { status: 410 });
  if (!user && protectedPath) return NextResponse.redirect(new URL("/login", request.url));
  if (user && request.nextUrl.pathname === "/login") return NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
