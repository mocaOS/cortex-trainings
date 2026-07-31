import { NextRequest, NextResponse } from 'next/server';
import type { RefKind } from '@cortex-trainings/shared';
import { MAX_REF_IMAGES } from '@cortex-trainings/shared';
import {
  deleteRefImages,
  getProject,
  getRefs,
  refMimeToExt,
  saveRefAnalysis,
  saveRefImages,
} from '@/lib/store';
import { analyzeRefImages } from '@/lib/refs';

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function parseKind(value: unknown): RefKind | null {
  return value === 'character' || value === 'style' ? value : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ refs: await getRefs(id) });
}

/**
 * POST multipart/form-data: kind=character|style, images=<1–3 files>.
 * Saves the images and runs the vision analysis; both must succeed or neither is kept.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // The plan is extracted from the refs at production start — changing them mid-run or after
  // the fact would silently disagree with media that already exists.
  if (project.status === 'producing' || project.status === 'done') {
    return NextResponse.json(
      { error: 'reference images are locked once production has started' },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const kind = parseKind(form.get('kind'));
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "character" or "style"' }, { status: 400 });
  }
  const files = form.getAll('images').filter((f): f is File => f instanceof File);
  if (files.length === 0 || files.length > MAX_REF_IMAGES) {
    return NextResponse.json(
      { error: `provide 1–${MAX_REF_IMAGES} images` },
      { status: 400 },
    );
  }
  const images: Array<{ bytes: Buffer; mime: string }> = [];
  for (const file of files) {
    if (!refMimeToExt(file.type)) {
      return NextResponse.json(
        { error: `unsupported image type ${file.type || '(unknown)'} — use JPEG, PNG or WebP` },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${file.name} exceeds 10 MB` }, { status: 400 });
    }
    images.push({ bytes: Buffer.from(await file.arrayBuffer()), mime: file.type });
  }

  const savedFiles = await saveRefImages(id, kind, images);
  try {
    // Data URLs come from the uploaded bytes directly — refImageDataUrls() reads the
    // refs.json entry, which does not exist until the analysis below is saved.
    const dataUrls = images.map((i) => `data:${i.mime};base64,${i.bytes.toString('base64')}`);
    const description = await analyzeRefImages(kind, dataUrls);
    await saveRefAnalysis(id, kind, {
      files: savedFiles,
      description,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    // No analysis means the pipeline could not use the images — keep the state consistent
    // and tell the user loudly rather than store half a feature.
    await deleteRefImages(id, kind);
    return NextResponse.json(
      { error: `image analysis failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ refs: await getRefs(id) }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (project.status === 'producing' || project.status === 'done') {
    return NextResponse.json(
      { error: 'reference images are locked once production has started' },
      { status: 409 },
    );
  }
  const kind = parseKind(req.nextUrl.searchParams.get('kind'));
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "character" or "style"' }, { status: 400 });
  }
  await deleteRefImages(id, kind);
  return NextResponse.json({ refs: await getRefs(id) });
}
