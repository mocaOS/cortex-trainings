import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type {
  ProductionPlan,
  ProductionState,
  StepId,
  StepState,
} from '@cortex-trainings/shared';
import { STEP_ORDER } from '@cortex-trainings/shared';
import { getCurriculum, getProject, updateProject } from '../store';
import { env } from '../env';
import { extractPlan } from './plan';
import { stepRefImage, applyRefChoice } from './steps/refimage';
import { stepVoiceovers } from './steps/voiceovers';
import { stepFilms, quoteFilms } from './steps/films';
import { stepAnimations } from './steps/animations';
import { stepImages } from './steps/images';
import { stepAssemble } from './steps/assemble';
import { stepQa } from './steps/qa';

export type ProductionEvent =
  | { type: 'state'; state: ProductionState }
  | { type: 'log'; step: StepId; message: string };

type Listener = (event: ProductionEvent) => void;

export interface RunContext {
  projectId: string;
  dir: string; // project dir
  mediaDir: string;
  plan: ProductionPlan | null;
  log: (step: StepId, message: string) => void;
  setDetail: (step: StepId, detail: string) => void;
  /** Blocks until the UI provides the awaited input. */
  waitForInput: <T>(key: 'ref' | 'video') => Promise<T>;
}

class ProductionRun {
  state: ProductionState;
  plan: ProductionPlan | null = null;
  private listeners = new Set<Listener>();
  private waiters = new Map<string, (value: unknown) => void>();
  private dir: string;

  constructor(
    public projectId: string,
    dir: string,
    initial?: ProductionState,
  ) {
    this.dir = dir;
    this.state =
      initial ?? {
        projectId,
        status: 'idle',
        steps: STEP_ORDER.map((id): StepState => ({ id, status: 'pending' })),
        updatedAt: new Date().toISOString(),
      };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: ProductionEvent) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        /* listener gone */
      }
    }
  }

  log(step: StepId, message: string) {
    // Server console too — the SSE stream only reaches a connected browser.
    console.log(`[prod ${this.projectId.slice(0, 8)} ${step}] ${message}`);
    this.emit({ type: 'log', step, message });
  }

  private async persist() {
    this.state.updatedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(this.dir, 'production.json'),
      JSON.stringify(this.state, null, 2),
    );
    this.emit({ type: 'state', state: this.state });
  }

  async patchStep(id: StepId, patch: Partial<StepState>) {
    const step = this.state.steps.find((s) => s.id === id);
    if (step) Object.assign(step, patch);
    await this.persist();
  }

  async patchState(patch: Partial<ProductionState>) {
    Object.assign(this.state, patch);
    await this.persist();
  }

  waitForInput<T>(key: string): Promise<T> {
    return new Promise<T>((resolve) => {
      this.waiters.set(key, resolve as (value: unknown) => void);
    });
  }

  provideInput(key: string, value: unknown): boolean {
    const waiter = this.waiters.get(key);
    if (!waiter) return false;
    this.waiters.delete(key);
    waiter(value);
    return true;
  }

  async run() {
    const project = await getProject(this.projectId);
    const curriculum = await getCurriculum(this.projectId);
    if (!project || !curriculum) throw new Error('project or curriculum missing');

    const mediaDir = path.join(this.dir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });

    const ctx: RunContext = {
      projectId: this.projectId,
      dir: this.dir,
      mediaDir,
      plan: null,
      log: (step, message) => this.log(step, message),
      setDetail: (step, detail) => void this.patchStep(step, { detail }),
      waitForInput: <T>(key: 'ref' | 'video') => this.waitForInput<T>(key),
    };

    await this.patchState({ status: 'running' });
    await updateProject(this.projectId, { status: 'producing' });

    const stepFns: Record<StepId, () => Promise<void>> = {
      plan: async () => {
        this.plan = await extractPlan(curriculum, project.briefing, (note) =>
          this.log('plan', note),
        );
        ctx.plan = this.plan;
        await fs.writeFile(path.join(this.dir, 'plan.json'), JSON.stringify(this.plan, null, 2));
        ctx.setDetail(
          'plan',
          `${this.plan.levels.length} levels — ` +
            this.plan.levels.map((l) => l.medium).join(', '),
        );
      },
      refimage: async () => {
        const candidates = await stepRefImage(ctx);
        await this.patchState({ refCandidates: candidates, refCandidateCount: candidates.length });
        await this.patchStep('refimage', { status: 'waiting_input', detail: 'pick a candidate' });
        await this.patchState({ status: 'waiting_input' });
        const choice = await ctx.waitForInput<number>('ref');
        await this.patchState({ status: 'running', chosenRef: choice, refCandidates: undefined });
        await applyRefChoice(ctx, candidates, choice);
      },
      voiceovers: () => stepVoiceovers(ctx),
      films: async () => {
        const quote = await quoteFilms(ctx);
        // Don't re-ask when the same total was already approved — a resume would otherwise
        // park at a gate the user has already cleared, and the quote is free to recompute.
        const alreadyApproved =
          this.state.videoConfirmed === true &&
          typeof this.state.videoQuoteUsd === 'number' &&
          Math.abs(this.state.videoQuoteUsd - quote.totalUsd) < 0.01;
        if (alreadyApproved) {
          this.log('films', `quote unchanged at $${quote.totalUsd.toFixed(2)} — already approved`);
        }
        if (quote.totalUsd > 0 && !alreadyApproved) {
          await this.patchState({ videoQuoteUsd: quote.totalUsd, status: 'waiting_input' });
          await this.patchStep('films', {
            status: 'waiting_input',
            detail: `${quote.shots} shots ≈ $${quote.totalUsd.toFixed(2)} — confirm to generate`,
          });
          await ctx.waitForInput<boolean>('video');
          await this.patchState({ status: 'running', videoConfirmed: true });
          await this.patchStep('films', { status: 'running' });
        }
        await stepFilms(ctx);
      },
      animations: () => stepAnimations(ctx),
      images: () => stepImages(ctx),
      assemble: async () => {
        const file = await stepAssemble(ctx);
        await this.patchState({ outputFile: file });
      },
      qa: async () => {
        const result = await stepQa(ctx);
        await this.patchState({ qa: result });
      },
    };

    for (const id of STEP_ORDER) {
      // State persisted before a step existed won't contain it — adopt it as pending
      // rather than crashing on an older project.
      let step = this.state.steps.find((s) => s.id === id);
      if (!step) {
        step = { id, status: 'pending' };
        this.state.steps.splice(STEP_ORDER.indexOf(id), 0, step);
        await this.persist();
      }
      if (step.status === 'completed') {
        // Resume support: reload plan for downstream steps.
        if (id === 'plan' && !this.plan) {
          this.plan = JSON.parse(
            await fs.readFile(path.join(this.dir, 'plan.json'), 'utf8'),
          ) as ProductionPlan;
          ctx.plan = this.plan;
        }
        continue;
      }
      const t0 = Date.now();
      this.log(id, 'started');
      await this.patchStep(id, {
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      });
      try {
        await stepFns[id]();
        await this.patchStep(id, { status: 'completed', finishedAt: new Date().toISOString() });
        this.log(id, `completed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.patchStep(id, { status: 'failed', error: message });
        await this.patchState({ status: 'failed' });
        this.log(id, `FAILED: ${message}`);
        return;
      }
    }

    await this.patchState({ status: 'done' });
    await updateProject(this.projectId, { status: 'done' });
  }
}

/* HMR-safe registry — next dev reloads modules but keeps globalThis. */
const registry: Map<string, ProductionRun> = ((globalThis as any).__prodRuns ??= new Map());

function projectDir(projectId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error(`Invalid project id: ${projectId}`);
  return path.resolve(env.storagePath, 'projects', projectId);
}

export async function getProductionState(projectId: string): Promise<ProductionState | null> {
  const live = registry.get(projectId);
  // An in-flight run is the authority; a finished or failed one is not — its state may have
  // been edited on disk since (resetting steps to re-run them), and stale memory would
  // silently discard that, restarting the whole pipeline from scratch.
  if (live && (live.state.status === 'running' || live.state.status === 'waiting_input')) {
    return live.state;
  }
  try {
    return JSON.parse(
      await fs.readFile(path.join(projectDir(projectId), 'production.json'), 'utf8'),
    ) as ProductionState;
  } catch {
    return null;
  }
}

export async function startProduction(projectId: string): Promise<ProductionState> {
  const existing = registry.get(projectId);
  if (existing && (existing.state.status === 'running' || existing.state.status === 'waiting_input')) {
    return existing.state;
  }
  // Resume from disk state if present (completed steps are skipped).
  const persisted = await getProductionState(projectId);
  const initial =
    persisted && persisted.status !== 'done'
      ? {
          ...persisted,
          status: 'running' as const,
          steps: persisted.steps.map((s) =>
            s.status === 'completed' ? s : { ...s, status: 'pending' as const, error: undefined },
          ),
          refCandidates: undefined,
        }
      : undefined;
  const run = new ProductionRun(projectId, projectDir(projectId), initial);
  registry.set(projectId, run);
  run.run().catch((err) => {
    run.patchState({ status: 'failed' });
    run.log('plan', `fatal: ${err instanceof Error ? err.message : String(err)}`);
  });
  return run.state;
}

export function subscribeProduction(
  projectId: string,
  listener: (event: ProductionEvent) => void,
): (() => void) | null {
  const run = registry.get(projectId);
  if (!run) return null;
  return run.subscribe(listener);
}

export function provideProductionInput(projectId: string, key: 'ref' | 'video', value: unknown): boolean {
  const run = registry.get(projectId);
  if (!run) return false;
  return run.provideInput(key, value);
}
