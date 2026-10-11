import { NextRequest } from 'next/server';
import { POST as safePush } from '@/app/api/prospecting/salesnav/push-ready-v2/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Retired queue URL uses the same net-new policy and durable journal.
export async function POST(request: NextRequest) { return safePush(request); }
