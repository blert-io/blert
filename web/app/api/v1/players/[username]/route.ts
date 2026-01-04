import { NextResponse } from 'next/server';

import { loadPlayerWithStats } from '@/actions/challenge';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  try {
    const player = await loadPlayerWithStats(username);

    if (player === null) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    return NextResponse.json(player);
  } catch (error) {
    console.error('Error fetching player:', error);
    return new Response(null, { status: 500 });
  }
}
