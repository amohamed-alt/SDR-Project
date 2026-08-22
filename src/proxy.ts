import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  // The SDR Dashboard is intentionally open. Authentication is not enforced here.
  // Sensitive server-side credentials remain private environment variables and are
  // never exposed to the browser by this proxy.
  //
  // Traefik/Hostinger can expose the public Origin header while Next.js resolves
  // request.nextUrl against the internal container host. For acquisition POSTs,
  // normalize Origin only when the browser itself has already classified the
  // request as same-origin/same-site. Cross-site requests keep their original
  // Origin and continue to be rejected by the acquisition route.
  if (request.method === "POST" && request.nextUrl.pathname === "/api/acquisition") {
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
