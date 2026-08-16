import { NextResponse } from "next/server";

// The SDR dashboard is intentionally open without Basic Auth.
// Route-specific protections (for example signed callbacks or ingest secrets)
// remain implemented inside their own API handlers.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
