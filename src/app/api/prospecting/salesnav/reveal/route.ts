import { NextRequest } from 'next/server';
import { POST as safeReveal } from '@/app/api/prospecting/salesnav/reveal-fast/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Older queue clients share the same claim and company gate; no second paid path.
export async function POST(request: NextRequest) { return safeReveal(request); }
