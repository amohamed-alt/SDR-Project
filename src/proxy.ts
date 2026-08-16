import { NextRequest, NextResponse } from "next/server";

export function proxy(_request: NextRequest) {
  // The SDR Dashboard is intentionally open. Authentication is not enforced here.
  // Sensitive server-side credentials remain private environment variables and are
  // never exposed to the browser by this proxy.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
