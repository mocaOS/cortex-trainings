#!/usr/bin/env node
/**
 * Browser QA for a produced training (the skill's Phase 10, automated).
 *
 * Drives every interaction's success path using the correct answers from plan.json,
 * verifies embedded videos decode, walks to the summary screen, and fails loudly on
 * console errors or a dead end.
 *
 *   node scripts/qa-training.mjs <project-id> [--storage <path>] [--keep-shots <dir>]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const projectId = args.find((a) => !a.startsWith('--'));
const storage = argValue('--storage') ?? 'apps/web/data';
const shotsDir = argValue('--keep-shots');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!projectId) {
  console.error('usage: node scripts/qa-training.mjs <project-id> [--storage <path>] [--keep-shots <dir>]');
  process.exit(2);
}

const projectDir = path.resolve(storage, 'projects', projectId);
const plan = JSON.parse(await readFile(path.join(projectDir, 'plan.json'), 'utf8'));
const trainingFile = path.join(projectDir, 'training.html');
await readFile(trainingFile); // fail early with a clear ENOENT if not produced

// Levels may legitimately have no interaction of their own (the final check is its own screen).
const interactiveLevels = plan.levels.filter((l) => l.interaction);

// Correct answers, so the walkthrough exercises success paths rather than failure paths.
const correct = new Map();
for (const level of interactiveLevels) {
  for (const q of level.interaction.questions) correct.set(q.text.trim(), q.options[q.correctIndex]);
}
for (const q of plan.finalCheck.questions) correct.set(q.text.trim(), q.options[q.correctIndex]);
// Matching tasks: item text -> its correct category, so the walk can assign correctly.
const matchAnswers = new Map();
for (const l of interactiveLevels) {
  if (l.interaction.kind !== 'match_pairs') continue;
  for (const q of l.interaction.questions) matchAnswers.set(q.text.trim(), q.options[q.correctIndex]);
}

// A training can contain several sorting tasks, each with its own items.
const sortOrders = interactiveLevels
  .filter((l) => l.interaction.kind === 'sort_order' && l.interaction.questions[0]?.options?.length)
  .map((l) => l.interaction.questions[0].options);

const errors = [];

// Structural checks on the plan itself. A training that asks the same questions twice used to
// pass QA cleanly: every counter looked healthy because nothing compared the screens.
const fingerprint = (i) => i.questions.map((q) => q.text.trim()).join(' | ');
const seen = new Map([[fingerprint(plan.finalCheck), 'final check']]);
for (const l of interactiveLevels) {
  if (l.interaction.kind === 'final_check')
    errors.push(`level ${l.index}: interaction has kind "final_check" — the final check is its own screen`);
  if (!l.interaction.questions.length) continue;
  const print = fingerprint(l.interaction);
  const owner = seen.get(print);
  if (owner) errors.push(`level ${l.index}: asks the identical question set as the ${owner}`);
  else seen.set(print, `level ${l.index}`);
}
const visited = [];
let videoResults = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const heading = async () =>
  (await page.locator('h1,h2').first().textContent()).trim().slice(0, 70);
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true });
};

await page.goto(`file://${trainingFile}`);
await page.waitForTimeout(1200);
await shot('00-start');

await page.click('#btn-start');
await page.waitForTimeout(600);

let reachedSummary = false;
for (let step = 0; step < 80; step++) {
  const head = await heading();
  if (head !== visited[visited.length - 1]) visited.push(head);

  // Summary screen ends the walk.
  if (await page.locator('.result-big').count()) {
    reachedSummary = true;
    break;
  }

  // Media screen: probe the video, then skip ahead.
  const video = page.locator('video');
  if (await video.count()) {
    const meta = await video.first().evaluate(
      (v) =>
        new Promise((res) => {
          const done = () => res({ ok: true, dur: +v.duration.toFixed(1), w: v.videoWidth, h: v.videoHeight });
          if (v.readyState >= 1) return done();
          v.onloadedmetadata = done;
          v.onerror = () => res({ ok: false });
          setTimeout(() => res({ ok: false, timeout: true }), 20000);
        }),
    );
    videoResults.push({ screen: head, ...meta });
    const skip = page.locator('main button', { hasText: /überspringen|Skip/i });
    if (await skip.count()) {
      await skip.first().click();
      await page.waitForTimeout(450);
      continue;
    }
  }

  // Matching task: tap each item, then tap its correct category.
  if (matchAnswers.size && (await page.locator('.chip-item').count())) {
    for (let guard = 0; guard < 20; guard++) {
      const chips = page.locator('.match-items .chip-item');
      const n = await chips.count();
      if (!n) break;
      const itemText = (await chips.first().textContent()).trim();
      const wantCat = matchAnswers.get(itemText);
      await chips.first().click();
      await page.waitForTimeout(120);
      if (wantCat) {
        const box = page.locator('.cat', { hasText: wantCat.slice(0, 30) }).first();
        if (await box.count()) await box.click({ position: { x: 5, y: 5 } });
      } else {
        await page.locator('.cat').first().click({ position: { x: 5, y: 5 } });
      }
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(400);
    const cont = page.locator('.continue-btn').first();
    if (!(await cont.count())) {
      errors.push('match_pairs resolved but no continue button appeared');
      break;
    }
    await cont.click();
    await page.waitForTimeout(400);
    continue;
  }

  // Sorting task: identify which one is on screen, then click its items in order.
  if (sortOrders.length && (await page.locator('.opt:not([disabled])').count())) {
    let order = null;
    for (const candidate of sortOrders) {
      if (await page.locator('.card', { hasText: candidate[0].slice(0, 30) }).count()) {
        order = candidate;
        break;
      }
    }
    if (order) {
      for (const item of order) {
        const opt = page.locator('.opt:not([disabled])', { hasText: item.slice(0, 34) }).first();
        if (await opt.count()) await opt.click();
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(400);
      const cont = page.locator('.continue-btn').first();
      if (!(await cont.count())) {
        errors.push('sort_order resolved but no continue button appeared');
        break;
      }
      await cont.click();
      await page.waitForTimeout(400);
      continue;
    }
  }

  // Question-based interactions: answer each correctly, then advance.
  if (await page.locator('.opt:not([disabled])').count()) {
    for (let q = 0; q < 15; q++) {
      if (!(await page.locator('.opt:not([disabled])').count())) break;
      const qText = (await page.locator('.card p strong').first().textContent().catch(() => '')) ?? '';
      const want = correct.get(qText.trim());
      const target = want
        ? page.locator('.opt:not([disabled])', { hasText: want.slice(0, 30) }).first()
        : page.locator('.opt:not([disabled])').first();
      if (await target.count()) await target.click();
      else await page.locator('.opt:not([disabled])').first().click();
      await page.waitForTimeout(170);
      const next = page.locator('.card > button.primary:visible, .continue-btn:visible').first();
      if (await next.count()) {
        await next.click();
        await page.waitForTimeout(300);
      }
    }
    continue;
  }

  // Plain continue (image-only level, slider, etc.).
  const primary = page.locator('main .btn.primary:visible').first();
  if (await primary.count()) {
    const label = (await primary.textContent()).trim();
    if (/Merkblatt|Von vorn|Print|Start over/i.test(label)) break;
    await primary.click();
    await page.waitForTimeout(450);
    continue;
  }
  errors.push(`stuck on screen "${head}" — no actionable control found`);
  break;
}

const xp = await page.locator('#xp').textContent();
const result = (await page.locator('.result-big').count())
  ? await page.locator('.result-big').textContent()
  : null;
const takeaways = await page.locator('ol.summary li').count();
await shot('99-summary');

// Resume path: reload and confirm progress was restored from localStorage. A finished
// run restores the summary screen; a partial one offers a resume button.
await page.reload();
await page.waitForTimeout(900);
const resume = (await page.locator('.result-big').count())
  ? 'restored the summary screen'
  : (await page.locator('#btn-start').count())
    ? `offers "${(await page.locator('#btn-start').textContent()).trim()}"`
    : 'NOT RESTORED';

await browser.close();

const expectedVideos = plan.levels.filter((l) => l.medium !== 'image').length;
const badVideos = videoResults.filter((v) => !v.ok);

console.log(`training:      ${trainingFile}`);
console.log(`screens:       ${visited.join(' → ')}`);
console.log(`videos:        ${videoResults.length}/${expectedVideos} probed` +
  (badVideos.length ? ` — ${badVideos.length} FAILED` : ' — all decode'));
for (const v of videoResults) {
  console.log(`               ${v.ok ? `${v.dur}s ${v.w}x${v.h}` : 'FAILED'}  (${v.screen})`);
}
console.log(`xp:            ${xp}`);
console.log(`summary:       ${result ?? 'NOT REACHED'}`);
console.log(`cheat sheet:   ${takeaways} items`);
console.log(`resume:        ${resume}`);
console.log(`console:       ${errors.length ? `${errors.length} error(s)` : 'clean'}`);
for (const e of errors) console.log(`               ${e}`);

console.log('\nnot covered:   failure paths (wrong answers, timers), audio playback,');
console.log('               print stylesheet, mobile layout');

const failed =
  errors.length > 0 ||
  !reachedSummary ||
  badVideos.length > 0 ||
  videoResults.length < expectedVideos ||
  takeaways === 0 ||
  resume === 'NOT RESTORED';
console.log(`\nverdict:       ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
