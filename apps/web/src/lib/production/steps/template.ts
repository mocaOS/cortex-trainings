import type { PlanInteraction } from '@cortex-trainings/shared';

/** Payload embedded into the offline training file. */
export interface TrainingLevel {
  title: string;
  keyTakeaway: string;
  video: string | null; // data URL
  image: string | null; // data URL
  /** null when the level has no interaction of its own — see PlanLevel.interaction. */
  interaction: PlanInteraction | null;
}

export interface TrainingData {
  title: string;
  language: string;
  accent: string;
  hero: string | null;
  levels: TrainingLevel[];
  finalCheck: PlanInteraction;
  cheatSheet: string[];
}

const STRINGS: Record<string, Record<string, string>> = {
  de: {
    start: 'Training starten',
    resume: 'Fortsetzen',
    restart: 'Von vorn beginnen',
    level: 'Level',
    continue: 'Weiter',
    check: 'Prüfen',
    correct: 'Richtig!',
    wrong: 'Leider falsch.',
    retry: 'Noch ein Versuch',
    soundOn: 'Ton an!',
    skipVideo: 'Video überspringen',
    finalCheck: 'Abschlusstest',
    summary: 'Zusammenfassung',
    takeaways: 'Das Wichtigste in Kürze',
    xp: 'XP',
    print: 'Merkblatt drucken',
    yourResult: 'Dein Ergebnis',
    of: 'von',
    questionsCorrect: 'Fragen richtig',
    sortHint: 'Tippe die Punkte in der richtigen Reihenfolge an.',
    sliderHint: 'Schätze dich selbst ein — es gibt kein richtig oder falsch.',
    done: 'Training abgeschlossen!',
    matchHint: 'Tippe einen Eintrag an, dann die passende Kategorie.',
    backToStart: 'Zum Start',
    matchCheck: 'Auswertung',
    matchRemaining: 'noch offen',
    matchYourAnswer: 'deine Zuordnung',
  },
  en: {
    start: 'Start training',
    resume: 'Resume',
    restart: 'Start over',
    level: 'Level',
    continue: 'Continue',
    check: 'Check',
    correct: 'Correct!',
    wrong: 'Not quite.',
    retry: 'Try again',
    soundOn: 'Sound on!',
    skipVideo: 'Skip video',
    finalCheck: 'Final check',
    summary: 'Summary',
    takeaways: 'Key takeaways',
    xp: 'XP',
    print: 'Print cheat sheet',
    yourResult: 'Your result',
    of: 'of',
    questionsCorrect: 'questions correct',
    sortHint: 'Tap the items in the correct order.',
    sliderHint: 'Rate yourself — there is no right or wrong.',
    done: 'Training complete!',
    matchHint: 'Tap an item, then the category it belongs to.',
    backToStart: 'Back to start',
    matchCheck: 'Results',
    matchRemaining: 'still open',
    matchYourAnswer: 'your answer',
  },
};

export function trainingHtml(data: TrainingData): string {
  const lang = data.language.toLowerCase().slice(0, 2);
  const T = STRINGS[lang] ?? STRINGS.en;
  const payload = JSON.stringify(data).replace(/<\/script/gi, '<\\/script');
  const t = JSON.stringify(T);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>
  :root { --accent: ${data.accent}; --bg:#101014; --card:#1a1b21; --border:#2a2c36;
    --text:#f2f3f7; --dim:#9aa0af; --ok:#4ade80; --bad:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif; line-height:1.5; }
  header { display:flex; justify-content:space-between; align-items:center; padding:14px 22px;
    border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:5; }
  header .hdr-left { display:flex; align-items:center; gap:14px; min-width:0; }
  #btn-home { padding:5px 11px; border-radius:8px; border:1px solid var(--border);
    background:var(--card); color:var(--dim); font:inherit; font-size:13px; cursor:pointer;
    white-space:nowrap; }
  #btn-home:hover { color:var(--text); border-color:var(--accent); }
  header .badges { display:flex; gap:6px; }
  header .badge { width:26px; height:26px; border-radius:50%; border:2px solid var(--border);
    display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--dim); }
  header .badge.done { background:var(--accent); border-color:var(--accent); color:#0b0c10; font-weight:700; }
  header .xp { font-weight:700; color:var(--accent); }
  .progress { height:4px; background:var(--border); }
  .progress > div { height:100%; background:var(--accent); transition:width .4s; }
  main { max-width:960px; margin:0 auto; padding:28px 20px 80px; }
  .screen { display:none; }
  .screen.active { display:block; animation: fade .4s ease-out; }
  @keyframes fade { from { opacity:0; transform:translateY(12px) } to { opacity:1 } }
  h1 { letter-spacing:-0.02em; }
  .hero { width:100%; border-radius:14px; border:1px solid var(--border); }
  .btn { display:inline-block; padding:12px 26px; border-radius:10px; border:1px solid var(--border);
    background:var(--card); color:var(--text); font:inherit; font-size:17px; cursor:pointer; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#0b0c10; font-weight:700; }
  .btn:disabled { opacity:.4; cursor:not-allowed; }
  .btn.pulse { animation:pulse 1.3s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { box-shadow:0 0 0 0 transparent } 50% { box-shadow:0 0 0 8px rgba(128,128,128,.15) } }
  video { width:100%; border-radius:14px; border:1px solid var(--border); background:#000; }
  .hint { color:var(--dim); font-size:14px; margin-top:8px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:22px; margin-top:18px; }
  .options { display:flex; flex-direction:column; gap:10px; margin-top:14px; }
  .opt { text-align:left; padding:14px 16px; border-radius:10px; border:1px solid var(--border);
    background:var(--bg); color:var(--text); font:inherit; font-size:16px; cursor:pointer; }
  .opt:hover:not(:disabled) { border-color:var(--accent); }
  .opt.sel { border-color:var(--accent); }
  .opt.ok { border-color:var(--ok); background:rgba(74,222,128,.08); }
  .opt.bad { border-color:var(--bad); background:rgba(248,113,113,.08); }
  .feedback { margin-top:14px; padding:14px 16px; border-radius:10px; border:1px solid var(--border); display:none; }
  .feedback.show { display:block; }
  .feedback.good { border-color:var(--ok); }
  .feedback.poor { border-color:var(--bad); }
  .keytake { border-left:3px solid var(--accent); padding:10px 16px; margin-top:20px; color:var(--dim); }
  .qcount { color:var(--dim); font-size:14px; }
  .match { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:16px; }
  @media (max-width:720px) { .match { grid-template-columns:1fr; } }
  .match-items { display:flex; flex-direction:column; gap:10px; align-content:start; }
  .match-cats { display:flex; flex-direction:column; gap:10px; }
  .chip-item { text-align:left; padding:11px 14px; border-radius:10px; border:1px solid var(--border);
    background:var(--bg); color:var(--text); font:inherit; font-size:15px; cursor:pointer; }
  .chip-item.sel { border-color:var(--accent); box-shadow:0 0 0 2px rgba(128,128,128,.15); }
  .chip-item.placed { font-size:14px; padding:8px 12px; }
  .chip-item.ok { border-color:var(--ok); background:rgba(74,222,128,.08); }
  .chip-item.bad { border-color:var(--bad); background:rgba(248,113,113,.08); }
  .cat { border:1px dashed var(--border); border-radius:10px; padding:12px;
    display:flex; flex-direction:column; gap:8px; min-height:64px; }
  .cat.active { border-color:var(--accent); cursor:pointer; }
  .cat-title { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); }
  img.ctx { width:100%; border-radius:14px; border:1px solid var(--border); margin-bottom:14px; }
  input[type=range] { width:100%; accent-color:var(--accent); }
  ol.summary { padding-left:22px; } ol.summary li { margin-bottom:10px; }
  .result-big { font-size:44px; font-weight:800; color:var(--accent); }
  @media print {
    body { background:#fff; color:#000; }
    header, .no-print { display:none !important; }
    .screen { display:none; } #screen-summary { display:block !important; }
    .card { border-color:#bbb; }
  }
</style>
</head>
<body>
<header>
  <div class="hdr-left">
    <strong id="hdr-title"></strong>
    <button id="btn-home" type="button" hidden></button>
  </div>
  <div class="badges" id="badges"></div>
  <span class="xp"><span id="xp">0</span></span>
</header>
<div class="progress"><div id="bar" style="width:0%"></div></div>
<main id="main"></main>
<script>
const DATA = ${payload};
const T = ${t};
document.getElementById('hdr-title').textContent = DATA.title;
document.title = DATA.title;
const homeBtn = document.getElementById('btn-home');
homeBtn.textContent = '← ' + T.backToStart;
/* Navigates only — progress stays saved, and the start screen offers Resume / Start over. */
homeBtn.onclick = () => go(0);
document.querySelector('.xp').innerHTML = '<span id="xp">0</span> ' + T.xp;

const KEY = 'cortex-training-' + DATA.title.slice(0,40);
let state = { screen: 0, xp: 0, unlocked: 0, answers: {} };
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && typeof saved.screen === 'number') state = saved; } catch {}

/* Screen list: 0=start, per level: media(l), interaction(l), then finalCheck, summary */
const screens = [{kind:'start'}];
/* A level whose interaction was the final check has none of its own — it leads straight on. */
DATA.levels.forEach((lv,i)=>{ screens.push({kind:'media',level:i}); if (lv.interaction) screens.push({kind:'interact',level:i}); });
screens.push({kind:'final'});
screens.push({kind:'summary'});

function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
function addXp(n){ state.xp += n; document.getElementById('xp').textContent = state.xp; save(); }
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function shuffle(arr){ const a=arr.map((v,i)=>[v,i]); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function renderBadges(){
  const el = document.getElementById('badges'); el.innerHTML='';
  DATA.levels.forEach((_,i)=>{
    const b=document.createElement('span'); b.className='badge'+(i<state.unlocked?' done':'');
    b.textContent=i+1; el.appendChild(b);
  });
}

function go(n){
  state.screen = n; save();
  homeBtn.hidden = n === 0;
  document.getElementById('bar').style.width = (n/(screens.length-1)*100)+'%';
  render();
  window.scrollTo({top:0});
}

function render(){
  renderBadges();
  document.getElementById('xp').textContent = state.xp;
  const main = document.getElementById('main'); main.innerHTML='';
  const s = screens[state.screen];
  const div = document.createElement('div'); div.className='screen active'; div.id='screen-'+s.kind;
  if (s.kind==='start') renderStart(div);
  else if (s.kind==='media') renderMedia(div, s.level);
  else if (s.kind==='interact') renderInteraction(div, DATA.levels[s.level].interaction, s.level);
  else if (s.kind==='final') renderInteraction(div, DATA.finalCheck, -1);
  else renderSummary(div);
  main.appendChild(div);
}

function renderStart(el){
  el.innerHTML = '<h1>'+esc(DATA.title)+'</h1>'
    + (DATA.hero ? '<img class="hero" src="'+DATA.hero+'" alt="">' : '')
    + '<div style="margin-top:22px; display:flex; gap:12px;">'
    + '<button class="btn primary" id="btn-start"></button>'
    + (state.screen>0||state.unlocked>0 ? '<button class="btn" id="btn-reset">'+T.restart+'</button>' : '')
    + '</div>';
  const started = state.unlocked>0 || Object.keys(state.answers).length>0;
  el.querySelector('#btn-start').textContent = started ? T.resume : T.start;
  el.querySelector('#btn-start').onclick = ()=> go(started && state.lastScreen ? state.lastScreen : 1);
  const rs = el.querySelector('#btn-reset');
  if (rs) rs.onclick = ()=>{ state={screen:0,xp:0,unlocked:0,answers:{}}; save(); render(); };
}

function renderMedia(el, li){
  const lv = DATA.levels[li];
  el.innerHTML = '<h2>'+T.level+' '+(li+1)+' — '+esc(lv.title)+'</h2>';
  if (lv.video) {
    const v=document.createElement('video'); v.src=lv.video; v.controls=true; v.autoplay=true; v.playsInline=true;
    el.appendChild(v);
    const hint=document.createElement('p'); hint.className='hint'; hint.textContent='🔊 '+T.soundOn; el.appendChild(hint);
    const row=document.createElement('div'); row.style.marginTop='16px';
    const btn=document.createElement('button'); btn.className='btn primary'; btn.textContent=T.continue;
    v.onended=()=>btn.classList.add('pulse');
    const skip=document.createElement('button'); skip.className='btn'; skip.style.marginLeft='10px'; skip.textContent=T.skipVideo;
    skip.onclick=()=>{ v.pause(); nextFromMedia(li); };
    btn.onclick=()=>{ v.pause(); nextFromMedia(li); };
    row.appendChild(btn); row.appendChild(skip); el.appendChild(row);
  } else {
    if (lv.image) { const img=document.createElement('img'); img.className='ctx'; img.src=lv.image; el.appendChild(img); }
    const btn=document.createElement('button'); btn.className='btn primary'; btn.textContent=T.continue;
    btn.onclick=()=>nextFromMedia(li); el.appendChild(btn);
  }
  el.insertAdjacentHTML('beforeend','<p class="keytake">'+esc(lv.keyTakeaway)+'</p>');
}

/* With no interaction screen to follow, the media screen is what completes the level — otherwise
   the badge, the unlock and the level XP would never be awarded. */
function nextFromMedia(li){
  if (li>=0 && !DATA.levels[li].interaction) return completeLevel(li);
  state.lastScreen=state.screen+1; go(state.screen+1);
}

function completeLevel(li, earned){
  if (li>=0 && li+1>state.unlocked){ state.unlocked=li+1; addXp(25); }
  state.lastScreen = state.screen+1;
  save();
  go(state.screen+1);
}

/* Appends the button that leaves an interaction once it is resolved.
   Pass the CARD, never the .feedback box: the box's text is written with innerHTML, so a button
   appended into it becomes an inline sibling of that text and wraps into the paragraph. Sitting
   after the block-level .feedback it starts on its own line, which is what renderQuestions
   already does with its "next" button. */
function addContinue(container, li){
  if (container.querySelector('.continue-btn')) return;
  const c=document.createElement('button');
  c.className='btn primary continue-btn';
  c.style.marginTop='12px';
  c.textContent=T.continue;
  c.onclick=()=>completeLevel(li);
  container.appendChild(c);
}

function renderInteraction(el, inter, li){
  const isFinal = li<0;
  el.innerHTML = '<h2>'+(isFinal?T.finalCheck:T.level+' '+(li+1))+' — '+esc(inter.title)+'</h2>'
    + '<p class="hint">'+esc(inter.instruction)+'</p>';
  const lv = li>=0 ? DATA.levels[li] : null;
  if (lv && lv.image && !lv.video) { /* image already shown on media screen */ }
  else if (lv && lv.image && lv.video) { const img=document.createElement('img'); img.className='ctx'; img.src=lv.image; el.appendChild(img); }

  if (inter.kind==='slider') return renderSlider(el, inter, li);
  if (inter.kind==='sort_order') return renderSort(el, inter, li);
  if (inter.kind==='match_pairs') return renderMatch(el, inter, li);
  return renderQuestions(el, inter, li);
}

/* Every statement gets its own slider, on one screen. Rendering only questions[0] silently threw
   away the rest — a three-statement self-assessment shipped as one question. They stay on a
   single screen deliberately: the point is seeing your own answers side by side. */
function renderSlider(el, inter, li){
  const qs = inter.questions.length ? inter.questions : [{text:''}];
  const hint=document.createElement('p'); hint.className='hint'; hint.textContent=T.sliderHint;
  el.appendChild(hint);
  qs.forEach(q=>{
    const card=document.createElement('div'); card.className='card';
    card.innerHTML = '<p><strong>'+esc(q.text)+'</strong></p>'
      + '<input type="range" min="0" max="10" value="5">';
    el.appendChild(card);
  });
  const row=document.createElement('div'); row.style.marginTop='16px';
  const btn=document.createElement('button'); btn.className='btn primary'; btn.textContent=T.continue;
  btn.onclick=()=>{ addXp(inter.xp||10); completeLevel(li); };
  row.appendChild(btn); el.appendChild(row);
}

function renderSort(el, inter, li){
  const q = inter.questions[0];
  const correct = q.options;
  const card=document.createElement('div'); card.className='card';
  card.innerHTML='<p><strong>'+esc(q.text||inter.title)+'</strong></p><p class="hint">'+T.sortHint+'</p>';
  const wrap=document.createElement('div'); wrap.className='options';
  let picked=[]; let attempt=0;
  const shuffled = shuffle(correct);
  shuffled.forEach(([text, origIdx])=>{
    const b=document.createElement('button'); b.className='opt'; b.textContent=text; b.dataset.orig=origIdx;
    b.onclick=()=>{
      if (b.disabled) return;
      picked.push(Number(b.dataset.orig)); b.disabled=true; b.classList.add('sel');
      b.textContent = picked.length+'. '+text;
      if (picked.length===correct.length) checkSort();
    };
    wrap.appendChild(b);
  });
  const fb=document.createElement('div'); fb.className='feedback';
  card.appendChild(wrap); card.appendChild(fb); el.appendChild(card);
  function checkSort(){
    const ok = picked.every((v,i)=>v===i);
    fb.classList.add('show', ok?'good':'poor');
    if (ok){
      fb.innerHTML='<strong>'+T.correct+'</strong> '+esc(q.explanation||'');
      addXp(attempt===0?(inter.xp||20):Math.ceil((inter.xp||20)/2));
      addContinue(card, li);
    } else {
      attempt++;
      fb.innerHTML='<strong>'+T.wrong+'</strong> '+esc(q.explanation||'');
      if (attempt>=2){ addContinue(card, li); }
      else {
        const r=document.createElement('button'); r.className='btn retry-btn'; r.style.marginTop='12px'; r.textContent=T.retry;
        r.onclick=()=>{ picked=[]; fb.className='feedback'; fb.innerHTML=''; r.remove();
          wrap.querySelectorAll('.opt').forEach((b,i)=>{ b.disabled=false; b.classList.remove('sel'); b.textContent=b.textContent.replace(/^\\d+\\. /,''); });
        };
        card.appendChild(r);
      }
    }
  }
}

/* Matching: assign every item to a category, then evaluate as a whole.
   Kept as tap-to-assign rather than HTML5 drag so it works on touch. */
function renderMatch(el, inter, li){
  const items = inter.questions.map((q,i)=>({ i, text:q.text, correct:q.correctIndex }));
  const cats = (inter.questions[0] && inter.questions[0].options) || [];
  const assigned = new Map();       // item index -> category index
  let selected = null, attempt = 0;

  const card=document.createElement('div'); card.className='card';
  card.innerHTML='<p class="hint">'+T.matchHint+'</p>';
  const wrap=document.createElement('div'); wrap.className='match';
  const itemCol=document.createElement('div'); itemCol.className='match-items';
  const catCol=document.createElement('div'); catCol.className='match-cats';
  wrap.appendChild(itemCol); wrap.appendChild(catCol);
  const fb=document.createElement('div'); fb.className='feedback';
  card.appendChild(wrap); card.appendChild(fb); el.appendChild(card);

  function draw(){
    itemCol.innerHTML=''; catCol.innerHTML='';
    const open = items.filter(it=>!assigned.has(it.i));
    const counter=document.createElement('p'); counter.className='qcount';
    counter.textContent=open.length+' '+T.matchRemaining;
    itemCol.appendChild(counter);
    open.forEach(it=>{
      const b=document.createElement('button'); b.className='chip-item'+(selected===it.i?' sel':'');
      b.textContent=it.text;
      b.onclick=()=>{ selected = selected===it.i ? null : it.i; draw(); };
      itemCol.appendChild(b);
    });
    cats.forEach((cat,ci)=>{
      const box=document.createElement('div'); box.className='cat'+(selected!==null?' active':'');
      const h=document.createElement('div'); h.className='cat-title'; h.textContent=cat;
      box.appendChild(h);
      items.filter(it=>assigned.get(it.i)===ci).forEach(it=>{
        const chip=document.createElement('button'); chip.className='chip-item placed';
        chip.textContent=it.text;
        chip.onclick=()=>{ assigned.delete(it.i); selected=null; draw(); };
        box.appendChild(chip);
      });
      box.onclick=(e)=>{
        if (e.target.classList.contains('chip-item')) return;
        if (selected===null) return;
        assigned.set(selected, ci); selected=null; draw();
        if (assigned.size===items.length) evaluate();
      };
      catCol.appendChild(box);
    });
  }

  function evaluate(){
    const right = items.filter(it=>assigned.get(it.i)===it.correct);
    const ok = right.length===items.length;
    // Mark each placed chip, so a learner sees WHICH pairing was wrong.
    catCol.querySelectorAll('.cat').forEach((box,ci)=>{
      box.querySelectorAll('.chip-item.placed').forEach(chip=>{
        const it = items.find(x=>x.text===chip.textContent);
        if (it) chip.classList.add(it.correct===ci ? 'ok' : 'bad');
      });
    });
    fb.className='feedback show '+(ok?'good':'poor');
    // One resolution for the whole exercise — per-item copies are duplicates.
    const resolution = (inter.questions.find(q=>q.explanation && q.explanation.trim())||{}).explanation || '';
    fb.innerHTML='<strong>'+(ok?T.correct:T.wrong)+'</strong> '+right.length+'/'+items.length+'. '+esc(resolution);
    if (ok){
      addXp(attempt===0?(inter.xp||20):Math.ceil((inter.xp||20)/2));
      addContinue(card, li);
    } else if (attempt>=1){
      addContinue(card, li);
    } else {
      attempt++;
      const r=document.createElement('button'); r.className='btn retry-btn'; r.style.marginTop='12px';
      r.textContent=T.retry;
      r.onclick=()=>{
        // Keep the pairings that were right; the learner only redoes the rest.
        items.forEach(it=>{ if (assigned.get(it.i)!==it.correct) assigned.delete(it.i); });
        fb.className='feedback'; fb.innerHTML=''; r.remove(); draw();
      };
      card.appendChild(r);
    }
  }

  draw();
}

function renderQuestions(el, inter, li){
  const isFinal = li<0;
  const qs = isFinal ? shuffle(inter.questions).map(([q])=>q) : inter.questions;
  /* inter.xp is the budget for the whole interaction, not per question. */
  const perQ = Math.max(1, Math.round((inter.xp||10)/Math.max(1,qs.length)));
  let idx=0, correctCount=0;
  const card=document.createElement('div'); card.className='card';
  el.appendChild(card);
  function show(){
    const q=qs[idx];
    card.innerHTML='<p class="qcount">'+(idx+1)+' / '+qs.length+'</p><p><strong>'+esc(q.text)+'</strong></p>';
    const wrap=document.createElement('div'); wrap.className='options';
    const opts = isFinal ? shuffle(q.options) : q.options.map((v,i)=>[v,i]);
    let attempt=0;
    opts.forEach(([text, orig])=>{
      const b=document.createElement('button'); b.className='opt'; b.textContent=text;
      b.onclick=()=>{
        if (orig===q.correctIndex){
          b.classList.add('ok');
          wrap.querySelectorAll('.opt').forEach(o=>o.disabled=true);
          correctCount++;
          addXp(attempt===0?perQ:Math.ceil(perQ/2));
          fb.className='feedback show good';
          fb.innerHTML='<strong>'+T.correct+'</strong> '+esc(q.explanation||'');
          next.style.display='inline-block';
        } else {
          b.classList.add('bad'); b.disabled=true; attempt++;
          fb.className='feedback show poor';
          fb.innerHTML='<strong>'+T.wrong+'</strong>';
          if (attempt>=2){
            wrap.querySelectorAll('.opt').forEach(o=>{ o.disabled=true; if(Number(o.dataset.orig)===q.correctIndex) o.classList.add('ok'); });
            fb.innerHTML='<strong>'+T.wrong+'</strong> '+esc(q.explanation||'');
            next.style.display='inline-block';
          }
        }
      };
      b.dataset.orig=orig;
      wrap.appendChild(b);
    });
    const fb=document.createElement('div'); fb.className='feedback';
    const next=document.createElement('button'); next.className='btn primary'; next.style.display='none'; next.style.marginTop='14px';
    next.textContent=T.continue;
    next.onclick=()=>{ idx++; if(idx<qs.length) show(); else finish(); };
    card.appendChild(wrap); card.appendChild(fb); card.appendChild(next);
  }
  function finish(){
    if (isFinal){
      state.finalResult=[correctCount,qs.length]; save();
      go(state.screen+1);
    } else completeLevel(li);
  }
  show();
}

function renderSummary(el){
  const res = state.finalResult||[0,DATA.finalCheck.questions.length];
  el.innerHTML = '<h1>'+T.done+'</h1>'
    + '<p class="result-big">'+state.xp+' '+T.xp+'</p>'
    + '<p>'+T.yourResult+': <strong>'+res[0]+' '+T.of+' '+res[1]+' '+T.questionsCorrect+'</strong></p>'
    + '<div class="card"><h3>'+T.takeaways+'</h3><ol class="summary">'
    + DATA.cheatSheet.map(x=>'<li>'+esc(x)+'</li>').join('')
    + '</ol></div>'
    + '<div class="no-print" style="margin-top:18px; display:flex; gap:12px;">'
    + '<button class="btn" onclick="window.print()">'+T.print+'</button>'
    + '<button class="btn" id="btn-again">'+T.restart+'</button></div>';
  el.querySelector('#btn-again').onclick=()=>{ state={screen:0,xp:0,unlocked:0,answers:{}}; save(); go(0); };
}

go(Math.min(state.screen, screens.length-1));
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
