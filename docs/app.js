// RIECS labels–needs–themes explorer. Vanilla JS + SVG, no dependencies.
const SVGNS = "http://www.w3.org/2000/svg";
const W = 1360, TOP = 30, BOT = 30;
const CX = { 0: 250, 1: 670, 2: 1010 };         // column centres: labels / needs / themes
const PALETTE = ["#4f9cff","#27c5a5","#f4a23b","#e15b97","#9b7bff",
                 "#56c271","#e7d14b","#ff7a59","#5ec8e6"];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = s => document.querySelector(s);
const gEdges = $("#edges"), gNodes = $("#nodes"), svg = $("#graph");

let byId = {}, gById = {}, edgeEl = {};
let labelNeeds = {}, needLabels = {}, needTheme = {}, themeNeeds = {};
let themeColor = {}, activeNodes = new Set(), activeEdges = new Set();

fetch("data/graph.json").then(r => r.json()).then(build);

function build(data){
  data.themes.forEach((t,i)=> themeColor[t] = PALETTE[i % PALETTE.length]);

  // ----- layout -----
  const cols = {0:[],1:[],2:[]};
  data.nodes.forEach(n => cols[n.col].push(n));
  const span = Math.max(cols[0].length * 13, 600);
  const H = TOP + span + BOT;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);

  const maxC = {0:0,1:0,2:0};
  data.nodes.forEach(n => maxC[n.col] = Math.max(maxC[n.col], n.count));
  const rOf = n => {
    const f = Math.sqrt(n.count / (maxC[n.col]||1));
    return n.col===0 ? 3+6*f : n.col===1 ? 8+18*f : 16+22*f;
  };
  data.nodes.forEach(n => {
    const N = cols[n.col].length;
    n.x = CX[n.col];
    n.y = TOP + (n.order + 0.5) * (span / N);
    n.r = rOf(n);
    byId[n.id] = n;
  });

  // ----- adjacency -----
  const needIds = new Set(data.nodes.filter(n=>n.type==="need").map(n=>n.id));
  data.edges.forEach(e=>{
    if (needIds.has(e.t)) {                 // label -> need
      (labelNeeds[e.s] ??= []).push(e.t);
      (needLabels[e.t] ??= []).push(e.s);
    } else {                                // need -> theme
      needTheme[e.s] = e.t;
      (themeNeeds[e.t] ??= []).push(e.s);
    }
  });

  // ----- edges (hidden paths) -----
  const wMax = Math.max(...data.edges.map(e=>e.w));
  data.edges.forEach(e=>{
    const a = byId[e.s], b = byId[e.t]; if(!a||!b) return;
    const p = document.createElementNS(SVGNS,"path");
    p.setAttribute("d", bez(a,b));
    p.setAttribute("class","edge");
    p.style.stroke = themeColor[b.type==="theme"? b.theme : b.theme] || "#cfd7e2";
    p.style.strokeWidth = (0.5 + 2.6*Math.sqrt(e.w/wMax)).toFixed(2);
    gEdges.appendChild(p);
    edgeEl[e.s+">"+e.t] = p;
  });

  // ----- nodes -----
  data.nodes.forEach(n=>{
    const g = document.createElementNS(SVGNS,"g");
    g.setAttribute("class", `node node--${n.type}`);
    g.setAttribute("transform", `translate(${n.x},${n.y})`);
    g.dataset.id = n.id;
    const c = document.createElementNS(SVGNS,"circle");
    c.setAttribute("r", n.r.toFixed(1));
    c.setAttribute("fill", themeColor[n.theme] || "#7d8aa0");
    if(n.type==="label") c.setAttribute("fill-opacity","0.8");
    g.appendChild(c);
    const t = document.createElementNS(SVGNS,"text");
    t.textContent = n.name;
    t.setAttribute("dy","0.32em");
    if(n.col===0){ t.setAttribute("x", -(n.r+6)); t.setAttribute("text-anchor","end"); }
    else { t.setAttribute("x", n.r+6); t.setAttribute("text-anchor","start"); }
    g.appendChild(t);
    g.addEventListener("click", ev=>{ ev.stopPropagation(); select(n.id); });
    g.addEventListener("mouseenter", ev=> tip(ev, n));
    g.addEventListener("mousemove", moveTip);
    g.addEventListener("mouseleave", hideTip);
    gNodes.appendChild(g);
    gById[n.id] = g;
  });

  buildLegend(data.themes);
  buildSearch(data.nodes);
  $("#h-labels").textContent = `Labels (${cols[0].length})`;
  $("#h-needs").textContent  = `Needs (${cols[1].length})`;
  $("#h-themes").textContent = `Themes (${cols[2].length})`;
  svg.addEventListener("click", clearSel);
  $("#reset").addEventListener("click", clearSel);
}

// cubic bezier with horizontal control tangents (Sankey-style)
function bez(a,b){
  const dx = 0.42*(b.x-a.x);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}

// ---------- selection / tracing ----------
function select(id){
  const n = byId[id]; if(!n) return;
  const nodes = new Set([id]), edges = new Set();
  const addE = k => { if(edgeEl[k]) edges.add(k); };
  if(n.type==="label"){
    (labelNeeds[id]||[]).forEach(nd=>{ nodes.add(nd); addE(id+">"+nd);
      const th=needTheme[nd]; if(th){ nodes.add(th); addE(nd+">"+th); } });
  } else if(n.type==="theme"){
    (themeNeeds[id]||[]).forEach(nd=>{ nodes.add(nd); addE(nd+">"+id);
      (needLabels[nd]||[]).forEach(l=>{ nodes.add(l); addE(l+">"+nd); }); });
  } else { // need
    (needLabels[id]||[]).forEach(l=>{ nodes.add(l); addE(l+">"+id); });
    const th=needTheme[id]; if(th){ nodes.add(th); addE(id+">"+th); }
  }
  apply(nodes, edges, id);
}

function apply(nodes, edges, id){
  clearSel(true);
  svg.classList.add("has-sel");
  nodes.forEach(nid=>{ const g=gById[nid]; if(g){ g.classList.add("on"); activeNodes.add(g); }});
  edges.forEach(k=>{ const p=edgeEl[k]; p.classList.add("on"); activeEdges.add(p); draw(p); });
  gById[id].classList.add("sel"); activeNodes.add(gById[id]);
  showInfo(id, nodes);
}

function clearSel(keep){
  activeNodes.forEach(g=> g.classList.remove("on","sel"));
  activeEdges.forEach(p=>{ p.classList.remove("on"); undraw(p); });
  activeNodes.clear(); activeEdges.clear();
  svg.classList.remove("has-sel");
  if(!keep){ $("#info").hidden = true; const s=$("#search"); if(s) s.value=""; }
}

// draw-in animation via stroke-dasharray
function draw(p){
  if(REDUCED) return;
  if(!p._len){ p._len = p.getTotalLength(); }
  p.style.transition = "none";
  p.style.strokeDasharray = p._len;
  p.style.strokeDashoffset = p._len;
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>{
    p.style.transition = "stroke-dashoffset .5s ease, stroke-opacity .25s";
    p.style.strokeDashoffset = 0; }); });
}
function undraw(p){ p.style.transition=""; p.style.strokeDasharray=""; p.style.strokeDashoffset=""; }

// ---------- info panel ----------
function showInfo(id, nodes){
  const n=byId[id], box=$("#info");
  let needs=0, labels=0, themes=0;
  nodes.forEach(x=>{ const t=byId[x].type; if(t==="need")needs++; else if(t==="label")labels++; else if(t==="theme")themes++; });
  const k = n.type==="label"? `${labels} label → ${needs} needs → ${themes} theme(s)`
          : n.type==="theme"? `${themes} theme → ${needs} needs → ${labels} labels`
          : `${labels} labels → 1 need → ${themes} theme`;
  box.innerHTML = `<b>${esc(n.full)}</b> &nbsp;<span class="chip">${n.type}</span>`
    + `<span class="chip">${n.count} stories</span><br><span class="chip">${k}</span>`;
  box.hidden = false;
}

// ---------- tooltip ----------
const tt = $("#tooltip");
function tip(ev,n){
  const deg = n.type==="label" ? (labelNeeds[n.id]||[]).length+" needs"
            : n.type==="need" ? (needLabels[n.id]||[]).length+" labels · 1 theme"
            : (themeNeeds[n.id]||[]).length+" needs";
  tt.innerHTML = `<b>${esc(n.full)}</b><br><span class="sub">${n.count} stories · ${deg}</span>`;
  tt.hidden=false; moveTip(ev);
}
function moveTip(ev){ tt.style.left=(ev.clientX+14)+"px"; tt.style.top=(ev.clientY+14)+"px"; }
function hideTip(){ tt.hidden=true; }

// ---------- legend & search ----------
function buildLegend(themes){
  const L=$("#legend"); const idByName={};
  Object.keys(byId).forEach(id=>{ const n=byId[id]; if(n.type==="theme") idByName[n.name]=id; });
  themes.forEach(t=>{
    const b=document.createElement("button"); b.className="sw"; b.type="button";
    b.innerHTML=`<span class="dot" style="background:${themeColor[t]}"></span>${esc(t)}`;
    b.addEventListener("click",()=> idByName[t] && select(idByName[t]));
    L.appendChild(b);
  });
}
function buildSearch(nodes){
  const dl=document.createElement("datalist"); dl.id="names";
  const map={};
  nodes.forEach(n=>{ const o=document.createElement("option"); o.value=n.full; dl.appendChild(o); map[n.full.toLowerCase()]=n.id; });
  document.body.appendChild(dl);
  const inp=$("#search"); inp.setAttribute("list","names");
  const go=()=>{ const v=inp.value.trim().toLowerCase(); if(!v) return;
    let id=map[v]; if(!id){ const hit=nodes.find(n=>n.full.toLowerCase().includes(v)); id=hit&&hit.id; }
    if(id) select(id); };
  inp.addEventListener("change",go);
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
}

const esc = s => String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
