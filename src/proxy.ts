import { NextRequest, NextResponse } from "next/server";
import { dashboardAuthResponse } from "@/lib/dashboard-auth";

export function proxy(request: NextRequest) {
  const authResponse = dashboardAuthResponse(request);
  if (authResponse) return authResponse;

  //
  // Traefik/Hostinger can expose the public Origin header while Next.js resolves
  // request.nextUrl against the internal container host. For acquisition POSTs,
  // normalize Origin only when the browser itself has already classified the
  // request as same-origin/same-site. Cross-site requests keep their original
  // Origin and continue to be rejected by the protected route.
  const proxySafePost = request.method === "POST"
    && ["/api/acquisition", "/api/target-account-pool"].includes(request.nextUrl.pathname);

  if (proxySafePost) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && ["same-origin", "same-site", "none"].includes(fetchSite)) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("origin", request.nextUrl.origin);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
