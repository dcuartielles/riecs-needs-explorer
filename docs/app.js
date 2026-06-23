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
let labelNeeds = {}, needLabels = {};            // co-occurrence (all)
let labelNeedsM = {}, needLabelsM = {};          // member ("makes up")
let needTheme = {}, themeNeeds = {};
let themeColor = {}, activeNodes = new Set(), activeEdges = new Set();
let mode = "member", lastSel = null;             // member | cooc | both
let aud = "both";                                // both | 42 | 43
let NODES = [], EDGES = [], edgeData = {}, wMax = 1;

fetch("data/graph.json").then(r => r.json()).then(build);

// audience-aware accessors
const nodeCount = n => aud==="both" ? n.count : aud==="42" ? n.c42 : n.c43;
const nodeVisible = n => nodeCount(n) > 0;
const edgeW = e => aud==="both" ? e.w : aud==="42" ? e.w42 : e.w43;
function radius(col, c, mx){
  const f = Math.sqrt(c / (mx||1));
  return col===0 ? 3+6*f : col===1 ? 8+18*f : 16+22*f;
}
function edgeAvail(e){
  if(!e || !nodeVisible(byId[e.s]) || !nodeVisible(byId[e.t])) return false;
  if(e.kind==="theme" || e.member) return true;   // structural / definitional
  return edgeW(e) > 0;                              // co-occurrence needs a story here
}

function build(data){
  NODES = data.nodes; EDGES = data.edges;
  data.themes.forEach((t,i)=> themeColor[t] = PALETTE[i % PALETTE.length]);

  // ----- layout (positions baked from the full "both" data, kept stable) -----
  const cols = {0:[],1:[],2:[]};
  data.nodes.forEach(n => cols[n.col].push(n));
  const span = Math.max(cols[0].length * 13, 600);
  const H = TOP + span + BOT;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);

  const maxC = {0:0,1:0,2:0};
  data.nodes.forEach(n => maxC[n.col] = Math.max(maxC[n.col], n.count));
  const rOf = n => radius(n.col, n.count, maxC[n.col]);
  data.nodes.forEach(n => {
    const N = cols[n.col].length;
    n.x = CX[n.col];
    n.y = TOP + (n.order + 0.5) * (span / N);
    n.r = rOf(n);
    byId[n.id] = n;
  });

  // ----- adjacency -----
  data.edges.forEach(e=>{
    if (e.kind === "theme") {                 // need -> theme
      needTheme[e.s] = e.t;
      (themeNeeds[e.t] ??= []).push(e.s);
    } else {                                  // label -> need (kind "ln")
      (labelNeeds[e.s] ??= []).push(e.t);
      (needLabels[e.t] ??= []).push(e.s);
      if (e.member){ (labelNeedsM[e.s] ??= []).push(e.t);
                     (needLabelsM[e.t] ??= []).push(e.s); }
    }
  });

  // ----- edges (hidden paths) -----
  wMax = Math.max(...data.edges.map(e=>e.w));
  data.edges.forEach(e=>{
    const a = byId[e.s], b = byId[e.t]; if(!a||!b) return;
    const p = document.createElementNS(SVGNS,"path");
    p.setAttribute("d", bez(a,b));
    p.setAttribute("class", "edge" + (e.member ? " is-member" : "") + (e.kind==="theme" ? " is-theme" : ""));
    p.style.stroke = themeColor[b.theme] || "#cfd7e2";
    gEdges.appendChild(p);
    edgeEl[e.s+">"+e.t] = p;
    edgeData[e.s+">"+e.t] = e;
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
  document.querySelectorAll("#modes button").forEach(b=>
    b.addEventListener("click", ()=> setMode(b.dataset.mode)));
  document.querySelectorAll("#auds button").forEach(b=>
    b.addEventListener("click", ()=> setAudience(b.dataset.aud)));
  setAudience(aud);                        // size/visibility + active state (default "both")
  setMode(mode);                           // initialise (default "member")
}

// ---------- audience filter (Both / D4.2 citizens / D4.3 stakeholders) -------
function applyAudience(){
  const maxC = {0:1,1:1,2:1};
  NODES.forEach(n=>{ if(nodeVisible(n)) maxC[n.col] = Math.max(maxC[n.col], nodeCount(n)); });
  NODES.forEach(n=>{
    const g = gById[n.id], vis = nodeVisible(n);
    g.classList.toggle("hidden", !vis);
    if(vis){
      const r = radius(n.col, nodeCount(n), maxC[n.col]); n.r = r;
      g.querySelector("circle").setAttribute("r", r.toFixed(1));
      g.querySelector("text").setAttribute("x", n.col===0 ? -(r+6) : (r+6));
    }
  });
  EDGES.forEach(e=>{
    const p = edgeEl[e.s+">"+e.t]; if(!p) return;
    const w = edgeW(e) || (e.member ? 1 : 0);
    p.style.strokeWidth = ((e.member?1.1:0.5) + 2.6*Math.sqrt(w/wMax)).toFixed(2);
  });
}
function setAudience(a){
  aud = a;
  document.querySelectorAll("#auds button").forEach(b=>
    b.classList.toggle("active", b.dataset.aud===a));
  applyAudience();
  if(lastSel && nodeVisible(byId[lastSel])) select(lastSel); else clearSel();
}

// cubic bezier with horizontal control tangents (Sankey-style)
function bez(a,b){
  const dx = 0.42*(b.x-a.x);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}

// ---------- selection / tracing ----------
// "member" mode follows only the labels that make up a need; "cooc"/"both"
// follow all co-occurring labels (member ones are styled distinctly via CSS).
function select(id){
  const n = byId[id]; if(!n) return;
  if(!nodeVisible(n)){ clearSel(); return; }     // not present in current audience
  lastSel = id;
  const LN = (mode==="member") ? labelNeedsM : labelNeeds;
  const NL = (mode==="member") ? needLabelsM : needLabels;
  const nodes = new Set([id]), edges = new Set();
  const link = (a,b)=>{                          // add edge a>b if available, return ok
    const e = edgeData[a+">"+b];
    if(e && edgeAvail(e)){ edges.add(a+">"+b); return true; }
    return false;
  };
  if(n.type==="label"){
    (LN[id]||[]).forEach(nd=>{ if(!link(id,nd)) return; nodes.add(nd);
      const th=needTheme[nd]; if(th && link(nd,th)) nodes.add(th); });
  } else if(n.type==="theme"){
    (themeNeeds[id]||[]).forEach(nd=>{ if(!link(nd,id)) return; nodes.add(nd);
      (NL[nd]||[]).forEach(l=>{ if(link(l,nd)) nodes.add(l); }); });
  } else { // need
    (NL[id]||[]).forEach(l=>{ if(link(l,id)) nodes.add(l); });
    const th=needTheme[id]; if(th && link(id,th)) nodes.add(th);
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
  centerNode(id);
}

// scroll the canvas so the selected node sits vertically centred — but only if
// it is currently off-screen (e.g. a theme picked from the legend or search).
function centerNode(id){
  const g = gById[id], sc = $("#scroll");
  if(!g || !sc) return;
  const gr = g.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  if(gr.top >= sr.top && gr.bottom <= sr.bottom) return;   // already fully visible
  const delta = (gr.top + gr.height/2) - (sr.top + sr.height/2);
  sc.scrollTo({top: sc.scrollTop + delta, behavior: "smooth"});
}

function clearSel(keep){
  activeNodes.forEach(g=> g.classList.remove("on","sel"));
  activeEdges.forEach(p=>{ p.classList.remove("on"); undraw(p); });
  activeNodes.clear(); activeEdges.clear();
  svg.classList.remove("has-sel");
  if(!keep){ lastSel=null; $("#info").hidden = true; const s=$("#search"); if(s) s.value=""; }
}

// ---------- mode toggle (Makes up / Co-occurs / Both) ----------
function setMode(m){
  mode = m;
  svg.dataset.mode = m;
  document.querySelectorAll("#modes button").forEach(b=>
    b.classList.toggle("active", b.dataset.mode===m));
  if(lastSel) select(lastSel);            // re-trace the current selection
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
  const rel = mode==="member" ? "makes&nbsp;up" : mode==="cooc" ? "co-occurs" : "both";
  const audTxt = aud==="both" ? "all" : aud==="42" ? "D4.2 citizens" : "D4.3 stakeholders";
  const k = n.type==="label"? `${labels} label → ${needs} need(s) → ${themes} theme(s)`
          : n.type==="theme"? `${themes} theme → ${needs} needs → ${labels} labels`
          : `${labels} labels → 1 need → ${themes} theme`;
  box.innerHTML = `<b>${esc(n.full)}</b> &nbsp;<span class="chip">${n.type}</span>`
    + `<span class="chip">${nodeCount(n)} stories (${audTxt})</span><span class="chip">links: ${rel}</span>`
    + `<br><span class="chip">${k}</span>`;
  box.hidden = false;
}

// ---------- tooltip ----------
const tt = $("#tooltip");
function tip(ev,n){
  const deg = n.type==="label"
              ? ((labelNeedsM[n.id]? "makes up "+labelNeedsM[n.id].join(", ")+" · " : "")
                 + (labelNeeds[n.id]||[]).length+" needs co-occur")
            : n.type==="need"
              ? (needLabelsM[n.id]||[]).length+" member labels · "
                + (needLabels[n.id]||[]).length+" co-occur · 1 theme"
            : (themeNeeds[n.id]||[]).length+" needs";
  tt.innerHTML = `<b>${esc(n.full)}</b><br><span class="sub">${nodeCount(n)} stories · ${deg}</span>`;
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
