import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '@/lib/env';

type Params = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
};

/** Serve a produced media asset, e.g. ?p=ref-candidates/0.jpg */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('bad id', { status: 400 });

  const rel = req.nextUrl.searchParams.get('p') ?? '';
  // Confine to the project's media dir — no traversal, no absolute paths.
  if (!/^[\w./-]+$/.test(rel) || rel.includes('..') || rel.startsWith('/')) {
    return new Response('bad path', { status: 400 });
  }
  const mediaRoot = path.resolve(env.storagePath, 'projects', id, 'media');
  const file = path.resolve(mediaRoot, rel);
  if (!file.startsWith(mediaRoot + path.sep)) return new Response('bad path', { status: 400 });

  try {
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
