import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Minimal middleware - ensures middleware-manifest is generated
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}
