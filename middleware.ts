import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PAGES = ["/dashboard", "/projects", "/admin", "/billing", "/account"];
const SUPPORTED_API = ["/api/projects", "/api/builds", "/api/admin", "/api/billing", "/api/account/invitations", "/api/github"];
// Authenticated by their own mechanism (provider signature, generic recovery and waitlist responses).
const PUBLIC_API = ["/api/webhooks/razorpay", "/api/account/password-reset", "/api/waitlist"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_API.some((prefix) => path === prefix)) return NextResponse.next();
  if (path.startsWith("/api/") && !SUPPORTED_API.some((prefix) => path.startsWith(prefix))) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
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
  const protectedPage = PROTECTED_PAGES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (path.startsWith("/api/") && !user) return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  if (!user && protectedPage) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, request.url));
  if (user && protectedPage) {
    const { data: state } = await supabase.rpc("my_account_state");
    if (state?.status === "suspended") return NextResponse.redirect(new URL("/suspended", request.url));
  }
  if (user && path === "/login") return NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.set("Cache-Control", "private, no-store");
  if (protectedPage || path.startsWith("/api/")) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
