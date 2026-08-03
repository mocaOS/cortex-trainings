import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PlanLevel, ProductionPlan } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import type { VoiceoverInfo } from './voiceovers';

const execFileP = promisify(execFile);

/**
 * HyperFrames renderer for the animation levels (`ANIMATION_RENDERER=hyperframes`).
 *
 * Same idea as the legacy renderer — an HTML scene timed off the voiceover — but rendered by
 * seeking every frame instead of recording in real time. That is not a cosmetic difference:
 *
 * - **Deterministic.** The engine positions a paused GSAP timeline at `floor(frame)/fps` and
 *   captures atomically, so the same input yields the same video. Playwright's `recordVideo`
 *   captures wall-clock playback, so frame timing depends on machine load.
 * - **Faster than realtime.** A 35s scene renders in ~13s; recording takes ≥35s by definition,
 *   plus a webm→mp4 conversion and a separate voiceover mux. Here audio is mixed in-render.
 *
 * Everything the composition needs is written into a throwaway project dir under
 * `media/anim/hf/level<N>/` (assemble reads only `anim/level<N>_final.mp4`, so these are never
 * embedded). GSAP is vendored from `apps/web/anim-assets/` — a render must not touch the network.
 *
 * ## Layout variants
 *
 * A training's animation levels sit next to each other, and one layout repeated three times
 * reads as a template, not a design. So levels get one of three archetypes — same background,
 * title treatment, orb, kicker and progress system, different staging:
 *
 * - `focal-rail`     — beat text stages large right-of-centre, then docks into an accumulating
 *                      checklist rail on the left. The generalist.
 * - `kinetic-center` — beat text slams full-centre, then shrinks into an accumulating pill row
 *                      under the title. Punchier; suits short beats.
 * - `step-flow`      — a node path across the lower third; each beat lights the next node and
 *                      stages its text above it. The progression metaphor — `sort_order` levels
 *                      always get this one.
 *
 * Assignment is deterministic (interaction kind first, then rotation by position among the
 * animation levels), never random: a re-render must produce the same video, and two adjacent
 * levels must not share a layout by accident.
 *
 * Two GSAP-under-seek rules this template obeys, both found the hard way:
 * - Selectors bind when a tween is CREATED, not when it plays — content injected mid-timeline
 *   never animates. Hence all beat blocks are pre-built before the timeline is constructed.
 * - A `tl.set(...)` at position 0 does not render while the playhead sits exactly on 0, so
 *   initial hidden states must be `gsap.set(...)` outside the timeline or frame 0 flashes.
 */

export type AnimVariant = 'focal-rail' | 'kinetic-center' | 'step-flow';

const VARIANT_ROTATION: AnimVariant[] = ['focal-rail', 'kinetic-center', 'step-flow'];

/** Deterministic layout pick: kind first, then rotation by position among animation levels. */
export function pickVariant(plan: ProductionPlan, level: PlanLevel): AnimVariant {
  if (level.interaction?.kind === 'sort_order') return 'step-flow';
  const anims = plan.levels.filter((l) => l.medium === 'animation' && l.animationBeats.length > 0);
  const pos = Math.max(0, anims.findIndex((l) => l.index === level.index));
  return VARIANT_ROTATION[pos % VARIANT_ROTATION.length];
}

interface Beat {
  text: string;
  t: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KICKER: Record<string, (n: number, total: number) => string> = {
  de: (n, total) => `Schritt ${n} von ${total}`,
  en: (n, total) => `Step ${n} of ${total}`,
};

/** Shared page chrome: background, title, orb, progress bar. Variants add their own sections. */
const CHROME_CSS = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 1920px; height: 1080px; overflow: hidden;
        background: #101014;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #f2f3f7;
      }
      .blob { position: absolute; border-radius: 50%; filter: blur(120px); opacity: 0.16; }
      #blob-a { width: 900px; height: 900px; left: -220px; top: 340px; background: var(--accent); }
      #blob-b { width: 700px; height: 700px; right: -180px; top: -260px; background: color-mix(in srgb, var(--accent) 55%, #101014); }
      #vignette { position: absolute; inset: 0;
        background: radial-gradient(ellipse at 50% 42%, transparent 55%, rgba(0,0,0,0.55) 100%); }
      #grain { position: absolute; inset: 0; opacity: 0.04; pointer-events: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E"); }

      #title-wrap { position: absolute; left: 110px; top: 88px; max-width: 1250px; }
      #title { font-size: 58px; font-weight: 700; letter-spacing: -0.5px; }
      #title-rule { margin-top: 18px; height: 5px; width: 300px;
        background: var(--accent); border-radius: 3px; transform-origin: left center; }

      #kicker { position: absolute; font-size: 26px; font-weight: 600; letter-spacing: 4px;
        text-transform: uppercase; color: var(--accent); }

      .w { display: inline-block; white-space: pre; }

      #orb-wrap { position: absolute; right: 128px; top: 96px; width: 84px; height: 84px; }
      #orb { width: 84px; height: 84px; border-radius: 50%;
        background: radial-gradient(circle at 38% 34%, #ffffff 0%, var(--accent) 34%,
          color-mix(in srgb, var(--accent) 35%, #000) 82%, color-mix(in srgb, var(--accent) 18%, #000) 100%);
        box-shadow: 0 0 34px color-mix(in srgb, var(--accent) 55%, transparent),
          0 0 90px color-mix(in srgb, var(--accent) 25%, transparent); }
      #orb-halo { position: absolute; inset: -26px; border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--accent) 35%, transparent) 0%, transparent 68%); }

      #progress-track { position: absolute; left: 0; bottom: 0; width: 1920px; height: 5px;
        background: rgba(255,255,255,0.07); }
      #progress { position: absolute; left: 0; bottom: 0; height: 5px; width: 1920px;
        background: var(--accent); transform-origin: left center;
        box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 60%, transparent); }
`;

const CHROME_BODY = `
        <div id="blob-a" class="blob"></div>
        <div id="blob-b" class="blob"></div>
        <div id="grain"></div>
        <div id="vignette"></div>
        <div id="title-wrap"><div id="title">__TITLE__</div><div id="title-rule"></div></div>
        <div id="kicker"></div>
        <div id="orb-wrap"><div id="orb-halo"></div><div id="orb"></div></div>
        <div id="progress-track"></div>
        <div id="progress"></div>
`;

/** Shared runtime prologue: beat data, helpers, timeline, chrome intro + ambient motion. */
const SHARED_JS_PROLOGUE = `
      const BEATS = __BEATS__;      // [{text, t, dockAt, kicker}]
      const DUR = __DUR__;
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const words = (text) => "<div>" + text.split(/\\s+/).map((w) => '<span class="w">' + esc(w) + ' </span>').join("") + "</div>";
      const kicker = document.getElementById("kicker");

      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      function orbPulse(at) {
        tl.fromTo("#orb", { scale: 1 }, { scale: 1.22, duration: 0.22, ease: "power2.out", overwrite: "auto" }, at);
        tl.to("#orb", { scale: 1, duration: 0.6, ease: "power2.inOut", overwrite: "auto" }, at + 0.22);
        tl.fromTo("#orb-halo", { opacity: 1 }, { opacity: 1.8, duration: 0.22, overwrite: "auto" }, at);
        tl.to("#orb-halo", { opacity: 1, duration: 0.6, overwrite: "auto" }, at + 0.22);
      }
      function showKicker(at, text) {
        tl.set(kicker, { textContent: text }, at);
        tl.fromTo(kicker, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.4, overwrite: "auto" }, at);
      }

      gsap.set(kicker, { autoAlpha: 0 });

      tl.from("#title-wrap", { autoAlpha: 0, y: -26, duration: 0.7, ease: "power2.out" }, 0.15);
      tl.fromTo("#title-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, 0.5);
      tl.from("#orb-wrap", { autoAlpha: 0, scale: 0.4, duration: 0.9, ease: "back.out(1.6)" }, 0.3);
      tl.fromTo("#progress", { scaleX: 0 }, { scaleX: 1, duration: DUR, ease: "none" }, 0);
      tl.to("#orb-wrap", { y: 14, duration: 3.2, ease: "sine.inOut", repeat: Math.ceil(DUR / 3.2), yoyo: true }, 0);
      tl.to("#blob-a", { x: 140, y: -70, duration: DUR, ease: "sine.inOut" }, 0);
      tl.to("#blob-b", { x: -110, y: 90, duration: DUR, ease: "sine.inOut" }, 0);
`;

const SHARED_JS_EPILOGUE = `
      tl.set({}, {}, DUR); // pin timeline length to the composition duration
      window.__timelines["main"] = tl;
`;

interface VariantSpec {
  css: string;
  body: string;
  js: string; // runs between prologue and epilogue
}

/** Beat text stages large right-of-centre, docks into an accumulating checklist rail. */
const FOCAL_RAIL: VariantSpec = {
  css: `
      #kicker { left: 624px; top: 282px; }
      #numeral { position: absolute; right: 90px; bottom: 40px;
        font-size: 560px; font-weight: 800; line-height: 1;
        color: rgba(255,255,255,0.05); font-variant-numeric: tabular-nums; }
      #stage { position: absolute; left: 620px; top: 330px; width: 1120px; height: 460px; }
      .stage-block { position: absolute; inset: 0; display: flex; align-items: center;
        font-size: 86px; font-weight: 750; line-height: 1.14; letter-spacing: -1px;
        visibility: hidden; }
      #rail { position: absolute; left: 110px; top: 310px; width: 430px; }
      .row { position: relative; display: flex; align-items: flex-start; gap: 16px; margin-bottom: 46px; }
      .row .dot { flex: 0 0 auto; width: 13px; height: 13px; margin-top: 9px; border-radius: 50%;
        background: var(--accent); box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 80%, transparent); }
      .row .txt { font-size: 27px; font-weight: 550; line-height: 1.3; color: #e7e9f0; }
      .row .sweep { position: absolute; left: 29px; bottom: -10px; height: 2px; width: 0;
        background: linear-gradient(90deg, var(--accent), transparent); border-radius: 1px; }
  `,
  body: `
        <div id="numeral">1</div>
        <div id="stage"></div>
        <div id="rail"></div>
  `,
  js: `
      const numeral = document.getElementById("numeral");
      const rail = document.getElementById("rail");
      const rows = BEATS.map((b) => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = '<div class="dot"></div><div class="txt">' + esc(b.text) + '</div><div class="sweep"></div>';
        rail.appendChild(row);
        return row;
      });
      const stage = document.getElementById("stage");
      const blocks = BEATS.map((b) => {
        const el = document.createElement("div");
        el.className = "stage-block";
        el.innerHTML = words(b.text);
        stage.appendChild(el);
        return el;
      });
      gsap.set(rows, { autoAlpha: 0, x: -26 });
      tl.from("#numeral", { autoAlpha: 0, duration: 1.2 }, 0.4);

      BEATS.forEach((b, i) => {
        const at = b.t, dock = b.dockAt;
        const ws = blocks[i].querySelectorAll(".w");
        tl.set(numeral, { textContent: String(i + 1) }, at);
        tl.set(blocks[i], { visibility: "visible" }, at);
        showKicker(at, b.kicker);
        tl.fromTo(ws, { autoAlpha: 0, y: 34, rotationX: -35 },
          { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.55, stagger: 0.07, ease: "power3.out" }, at + 0.05);
        orbPulse(at);
        tl.fromTo("#numeral", { scale: 1.06 }, { scale: 1, duration: 0.8, ease: "power2.out", overwrite: "auto" }, at);
        tl.to(ws, { autoAlpha: 0, y: -22, duration: 0.4, stagger: 0.02, ease: "power2.in" }, dock);
        tl.set(blocks[i], { visibility: "hidden" }, dock + 0.7);
        tl.to(kicker, { autoAlpha: 0, duration: 0.3, overwrite: "auto" }, dock);
        tl.to(rows[i], { autoAlpha: 1, x: 0, duration: 0.5, ease: "power2.out" }, dock + 0.25);
        tl.fromTo(rows[i].querySelector(".sweep"), { width: 0 }, { width: 330, duration: 0.6, ease: "power2.out" }, dock + 0.4);
      });

      const outroAt = Math.min(BEATS[BEATS.length - 1].dockAt + 1.9, DUR - 1.6);
      tl.to("#rail .dot", { scale: 1.35, duration: 0.3, stagger: 0.08, ease: "power2.out" }, outroAt);
      tl.to("#rail .dot", { scale: 1, duration: 0.4, stagger: 0.08, overwrite: "auto" }, outroAt + 0.4);
  `,
};

/** Beat text slams full-centre, then shrinks into an accumulating pill row under the title. */
const KINETIC_CENTER: VariantSpec = {
  css: `
      #kicker { left: 50%; top: 300px; transform: translateX(-50%); }
      #numeral { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 700px; font-weight: 800; color: rgba(255,255,255,0.04);
        font-variant-numeric: tabular-nums; }
      #stage { position: absolute; left: 210px; right: 210px; top: 340px; height: 440px; }
      .stage-block { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        text-align: center; font-size: 106px; font-weight: 800; line-height: 1.08; letter-spacing: -2px;
        visibility: hidden; }
      #pills { position: absolute; left: 110px; top: 245px; width: 1450px;
        display: flex; flex-wrap: wrap; gap: 12px; }
      .pill { display: flex; align-items: center; gap: 10px; padding: 9px 18px;
        border: 1px solid rgba(255,255,255,0.14); border-radius: 999px;
        background: rgba(255,255,255,0.05); font-size: 20px; font-weight: 550; color: #dfe2ea; }
      .pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
        box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 80%, transparent); }
  `,
  body: `
        <div id="numeral">1</div>
        <div id="pills"></div>
        <div id="stage"></div>
  `,
  js: `
      const numeral = document.getElementById("numeral");
      const pillsWrap = document.getElementById("pills");
      const pills = BEATS.map((b) => {
        const el = document.createElement("div");
        el.className = "pill";
        el.innerHTML = '<div class="dot"></div><span>' + esc(b.text) + '</span>';
        pillsWrap.appendChild(el);
        return el;
      });
      const stage = document.getElementById("stage");
      const blocks = BEATS.map((b) => {
        const el = document.createElement("div");
        el.className = "stage-block";
        el.innerHTML = words(b.text);
        stage.appendChild(el);
        return el;
      });
      gsap.set(pills, { autoAlpha: 0, y: -10, scale: 0.92 });
      tl.from("#numeral", { autoAlpha: 0, duration: 1.2 }, 0.4);

      BEATS.forEach((b, i) => {
        const at = b.t, dock = b.dockAt;
        const ws = blocks[i].querySelectorAll(".w");
        tl.set(numeral, { textContent: String(i + 1) }, at);
        tl.set(blocks[i], { visibility: "visible" }, at);
        showKicker(at, b.kicker);
        tl.fromTo(ws, { autoAlpha: 0, scale: 0.82, y: 44 },
          { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, stagger: 0.06, ease: "back.out(1.5)" }, at + 0.05);
        orbPulse(at);
        tl.fromTo("#numeral", { scale: 1.05 }, { scale: 1, duration: 0.8, ease: "power2.out", overwrite: "auto" }, at);
        tl.to(ws, { autoAlpha: 0, scale: 0.9, y: -34, duration: 0.35, stagger: 0.015, ease: "power2.in" }, dock);
        tl.set(blocks[i], { visibility: "hidden" }, dock + 0.6);
        tl.to(kicker, { autoAlpha: 0, duration: 0.3, overwrite: "auto" }, dock);
        tl.to(pills[i], { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.7)" }, dock + 0.2);
      });

      const outroAt = Math.min(BEATS[BEATS.length - 1].dockAt + 1.9, DUR - 1.6);
      tl.to(".pill .dot", { scale: 1.6, duration: 0.3, stagger: 0.07, ease: "power2.out" }, outroAt);
      tl.to(".pill .dot", { scale: 1, duration: 0.4, stagger: 0.07, overwrite: "auto" }, outroAt + 0.4);
  `,
};

/** A node path across the lower third; each beat lights the next node. For processes. */
const STEP_FLOW: VariantSpec = {
  css: `
      #kicker { left: 50%; top: 330px; transform: translateX(-50%); }
      #stage { position: absolute; left: 260px; right: 260px; top: 380px; height: 320px; }
      .stage-block { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        text-align: center; font-size: 76px; font-weight: 750; line-height: 1.12; letter-spacing: -1px;
        visibility: hidden; }
      #flow { position: absolute; left: 0; top: 800px; width: 1920px; height: 220px; }
      .node { position: absolute; top: 0; width: 30px; height: 30px; margin-left: -15px;
        border-radius: 50%; border: 3px solid rgba(255,255,255,0.25); background: #101014; }
      .node.core { position: absolute; inset: 5px; border: none; border-radius: 50%;
        background: var(--accent); }
      .nlabel { position: absolute; top: 52px; width: 260px; margin-left: -130px;
        text-align: center; font-size: 20px; font-weight: 550; line-height: 1.25;
        color: #dfe2ea; }
      .seg { position: absolute; top: 14px; height: 2px; background: rgba(255,255,255,0.12); }
      .seg .fill { position: absolute; inset: 0; background: var(--accent);
        transform-origin: left center; transform: scaleX(0);
        box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 60%, transparent); }
  `,
  body: `
        <div id="stage"></div>
        <div id="flow"></div>
  `,
  js: `
      const flow = document.getElementById("flow");
      const N = BEATS.length;
      const X0 = 260, X1 = 1660;
      const xAt = (i) => (N === 1 ? 960 : X0 + ((X1 - X0) / (N - 1)) * i);
      const nodes = [], cores = [], labels = [], fills = [];
      BEATS.forEach((b, i) => {
        if (i > 0) {
          const seg = document.createElement("div");
          seg.className = "seg";
          seg.style.left = xAt(i - 1) + 15 + "px";
          seg.style.width = xAt(i) - xAt(i - 1) - 30 + "px";
          seg.innerHTML = '<div class="fill"></div>';
          flow.appendChild(seg);
          fills.push(seg.querySelector(".fill"));
        }
        const node = document.createElement("div");
        node.className = "node";
        node.style.left = xAt(i) + "px";
        node.innerHTML = '<div class="core"></div>';
        flow.appendChild(node);
        nodes.push(node);
        cores.push(node.querySelector(".core"));
        const label = document.createElement("div");
        label.className = "nlabel";
        label.style.left = xAt(i) + "px";
        label.textContent = b.text;
        flow.appendChild(label);
        labels.push(label);
      });
      const stage = document.getElementById("stage");
      const blocks = BEATS.map((b) => {
        const el = document.createElement("div");
        el.className = "stage-block";
        el.innerHTML = words(b.text);
        stage.appendChild(el);
        return el;
      });
      gsap.set(cores, { scale: 0 });
      gsap.set(labels, { autoAlpha: 0, y: 8 });
      tl.from(nodes, { autoAlpha: 0, y: 10, duration: 0.5, stagger: 0.08, ease: "power2.out" }, 0.5);

      BEATS.forEach((b, i) => {
        const at = b.t, dock = b.dockAt;
        const ws = blocks[i].querySelectorAll(".w");
        if (i > 0) tl.fromTo(fills[i - 1], { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: "power2.inOut" }, at - 0.35);
        tl.set(blocks[i], { visibility: "visible" }, at);
        showKicker(at, b.kicker);
        tl.fromTo(ws, { autoAlpha: 0, y: 30 },
          { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.06, ease: "power3.out" }, at + 0.05);
        tl.fromTo(cores[i], { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(2.2)" }, at);
        tl.fromTo(nodes[i], { borderColor: "rgba(255,255,255,0.25)" },
          { borderColor: "var(--accent)", duration: 0.3 }, at);
        tl.to(labels[i], { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out" }, at + 0.15);
        orbPulse(at);
        tl.to(ws, { autoAlpha: 0, y: -22, duration: 0.4, stagger: 0.02, ease: "power2.in" }, dock);
        tl.set(blocks[i], { visibility: "hidden" }, dock + 0.7);
        tl.to(kicker, { autoAlpha: 0, duration: 0.3, overwrite: "auto" }, dock);
      });

      const outroAt = Math.min(BEATS[BEATS.length - 1].dockAt + 1.9, DUR - 1.6);
      tl.to(cores, { scale: 1.35, duration: 0.3, stagger: 0.07, ease: "power2.out" }, outroAt);
      tl.to(cores, { scale: 1, duration: 0.4, stagger: 0.07, overwrite: "auto" }, outroAt + 0.4);
  `,
};

const VARIANTS: Record<AnimVariant, VariantSpec> = {
  'focal-rail': FOCAL_RAIL,
  'kinetic-center': KINETIC_CENTER,
  'step-flow': STEP_FLOW,
};

function composition(opts: {
  title: string;
  beats: Beat[];
  durationSec: number; // integer; covers voiceover + hold
  voDurationSec: number;
  accentColor: string;
  language: string;
  variant: AnimVariant;
}): string {
  const { title, beats, durationSec: DUR, voDurationSec, accentColor, language, variant } = opts;
  const kickerFor = KICKER[language.toLowerCase().slice(0, 2)] ?? KICKER.en;
  const spec = VARIANTS[variant];

  // Per-beat schedule: hold the focal text ~2.6s, but always clear the stage before the next
  // beat arrives, and never later than the outro.
  const sched = beats.map((b, i) => {
    const next = beats[i + 1]?.t ?? DUR - 3;
    return {
      text: b.text,
      t: Number(b.t.toFixed(2)),
      dockAt: Number(Math.max(b.t + 0.7, Math.min(b.t + 2.6, next - 0.35)).toFixed(2)),
      kicker: kickerFor(i + 1, beats.length),
    };
  });

  return `<!doctype html>
<html lang="${esc(language.slice(0, 2))}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/gsap.min.js"></script>
    <style>
      :root { --accent: ${accentColor}; }
${CHROME_CSS}
${spec.css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}"
         data-width="1920" data-height="1080">
      <div id="scene" class="clip" data-start="0" data-duration="${DUR}" data-track-index="1"
           style="position:absolute; inset:0;">
${CHROME_BODY.replace('__TITLE__', esc(title))}
${spec.body}
      </div>
      <audio id="vo" data-start="0" data-duration="${voDurationSec.toFixed(2)}" data-track-index="2"
             data-volume="1" src="assets/vo.mp3"></audio>
    </div>

    <script>
${SHARED_JS_PROLOGUE.replace('__BEATS__', JSON.stringify(sched)).replace('__DUR__', String(DUR))}
${spec.js}
${SHARED_JS_EPILOGUE}
    </script>
  </body>
</html>
`;
}

/** Where the vendored render-time assets live (apps/web is the server cwd). */
function vendoredAsset(name: string): string {
  return path.join(process.cwd(), 'anim-assets', name);
}

/**
 * Renders one animation level with HyperFrames straight to `outFile` (audio already mixed —
 * no separate mux step). The generated project stays on disk next to the media for inspection.
 */
export async function renderHyperframesAnimation(
  ctx: RunContext,
  level: PlanLevel,
  times: number[],
  vo: VoiceoverInfo,
  outFile: string,
): Promise<void> {
  const plan = ctx.plan!;
  const beats: Beat[] = level.animationBeats.map((b, i) => ({ text: b.text, t: times[i] }));
  const durationSec = Math.ceil(vo.duration + 1);
  const variant = pickVariant(plan, level);

  const proj = path.join(ctx.mediaDir, 'anim', 'hf', `level${level.index}`);
  await fs.mkdir(path.join(proj, 'assets'), { recursive: true });

  const gsap = vendoredAsset('gsap.min.js');
  try {
    await fs.access(gsap);
  } catch {
    throw new Error(`vendored GSAP missing at ${gsap} — renders must not depend on the network`);
  }
  await fs.copyFile(gsap, path.join(proj, 'assets', 'gsap.min.js'));
  await fs.copyFile(vo.file, path.join(proj, 'assets', 'vo.mp3'));

  await fs.writeFile(
    path.join(proj, 'index.html'),
    composition({
      title: level.title,
      beats,
      durationSec,
      voDurationSec: vo.duration,
      accentColor: plan.accentColor,
      language: plan.language,
      variant,
    }),
  );
  await fs.writeFile(
    path.join(proj, 'hyperframes.json'),
    JSON.stringify(
      {
        $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
        paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
        media: { autoProxy: false },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(proj, 'meta.json'),
    JSON.stringify({ id: `anim-level${level.index}`, name: level.title.slice(0, 60) }, null, 2),
  );
  // The CLI anchors its project root at the nearest package.json. Without one here it walks up
  // to apps/web and reports "no composition found" — this file is the anchor, nothing more.
  await fs.writeFile(
    path.join(proj, 'package.json'),
    JSON.stringify({ name: `anim-level${level.index}`, private: true }, null, 2),
  );

  ctx.log(
    'animations',
    `level ${level.index}: rendering ${durationSec}s composition (hyperframes, ${beats.length} beats, ${variant})`,
  );
  const t0 = Date.now();
  try {
    // --no-install: resolve the pinned workspace dependency only; a render must never reach for
    // the npm registry mid-pipeline. --crf 29: the default preset encodes these flat-gradient
    // scenes at ~5 MB per level, 5× the legacy renderer, and every megabyte lands base64-inflated
    // in the training file. At 29 the text is indistinguishable and a level is ~1.5 MB.
    await execFileP(
      'npx',
      ['--no-install', 'hyperframes', 'render', '--output', outFile, '--workers', '4', '--crf', '29'],
      { cwd: proj, timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    // The CLI writes its actual error to stdout and only warnings to stderr — take both.
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim().slice(-800) || e.message;
    throw new Error(`hyperframes render failed for level ${level.index}: ${detail}`);
  }
  await fs.access(outFile); // loud if the CLI exited 0 without producing the file
  ctx.log(
    'animations',
    `level ${level.index}: hyperframes render done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${variant})`,
  );
}

/** The renderer switch. Legacy Playwright recording stays the default until HF has soaked. */
export function useHyperframes(): boolean {
  return (process.env.ANIMATION_RENDERER ?? '').toLowerCase() === 'hyperframes';
}
