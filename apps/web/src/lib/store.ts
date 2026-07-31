import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Briefing, ChatMessage, CurriculumVersion, Project } from '@cortex-trainings/shared';
import { shortTitle } from '@cortex-trainings/shared';
import { env } from './env';

/**
 * File-based project store under STORAGE_PATH:
 *   projects/<id>/project.json      — metadata + briefing
 *   projects/<id>/curriculum.md     — latest curriculum
 *   projects/<id>/versions/v<n>.md  — version history
 *   projects/<id>/chat.json         — conversation with the agent
 */
function projectsRoot(): string {
  return path.resolve(env.storagePath, 'projects');
}

function projectDir(id: string): string {
  // Guard against path traversal via crafted ids.
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error(`Invalid project id: ${id}`);
  return path.join(projectsRoot(), id);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<Project[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectsRoot());
  } catch {
    return [];
  }
  const projects: Project[] = [];
  for (const id of entries) {
    const p = await readJson<Project>(path.join(projectsRoot(), id, 'project.json'));
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project | null> {
  return readJson<Project>(path.join(projectDir(id), 'project.json'));
}

export async function createProject(briefing: Briefing): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    title: shortTitle(briefing.topic),
    status: 'briefing',
    createdAt: now,
    updatedAt: now,
    briefing,
    curriculumVersion: 0,
  };
  const dir = projectDir(project.id);
  await fs.mkdir(path.join(dir, 'versions'), { recursive: true });
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  await fs.writeFile(path.join(dir, 'chat.json'), '[]');
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'status' | 'title' | 'approvedAt'>>,
): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  if (patch.status === 'approved' && project.curriculumVersion === 0) {
    throw new Error('Cannot approve a project without a curriculum');
  }
  const updated: Project = {
    ...project,
    ...patch,
    updatedAt: new Date().toISOString(),
    ...(patch.status === 'approved' ? { approvedAt: new Date().toISOString() } : {}),
  };
  await fs.writeFile(path.join(projectDir(id), 'project.json'), JSON.stringify(updated, null, 2));
  return updated;
}

export async function saveCurriculum(id: string, markdown: string): Promise<CurriculumVersion> {
  const project = await getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  const version = project.curriculumVersion + 1;
  const dir = projectDir(id);
  const entry: CurriculumVersion = { version, createdAt: new Date().toISOString(), markdown };
  await fs.writeFile(path.join(dir, 'versions', `v${version}.md`), markdown);
  await fs.writeFile(path.join(dir, 'curriculum.md'), markdown);
  const updated: Project = {
    ...project,
    curriculumVersion: version,
    status: 'draft',
    updatedAt: entry.createdAt,
  };
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(updated, null, 2));
  return entry;
}

export async function getCurriculum(id: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(projectDir(id), 'curriculum.md'), 'utf8');
  } catch {
    return null;
  }
}

export async function getChat(id: string): Promise<ChatMessage[]> {
  return (await readJson<ChatMessage[]>(path.join(projectDir(id), 'chat.json'))) ?? [];
}

export async function appendChat(id: string, message: ChatMessage): Promise<void> {
  const chat = await getChat(id);
  chat.push(message);
  await fs.writeFile(path.join(projectDir(id), 'chat.json'), JSON.stringify(chat, null, 2));
}
