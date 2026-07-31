import { NextResponse } from 'next/server';
import { getCortex } from '@/lib/clients';

/** Briefing-form helper: Cortex collections + community-based topic suggestions. */
export async function GET() {
  try {
    const cortex = getCortex();
    const [collections, communities] = await Promise.all([
      cortex.collections(),
      cortex.communities(undefined, 12),
    ]);
    return NextResponse.json({
      collections,
      topics: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? c.summary ?? '',
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { collections: [], topics: [], error: err instanceof Error ? err.message : 'cortex unreachable' },
      { status: 200 },
    );
  }
}
