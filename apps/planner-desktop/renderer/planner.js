const DATA_URL = "poe2://data/tree-pre.json";
const SKILLS_URL = "poe2://data/atlas-skills.webp";
const FRAMES_URL = "poe2://data/atlas-frame.webp";
const TREE_JUMP_URL = "poe2://data/tree-jump.json";
const CN_TRANSLATION_URL = "poe2://data/ChineseTranslation.lua";
const WEGAME_LOCALIZATION_URL = "poe2://localization/wegame-passive-tree-zh-cn.js";
const MASTERY_EFFECT_ATLAS_JSON_URL = "poe2://data/mastery-effect-active.json";
const MASTERY_EFFECT_ATLAS_IMG_URL = "poe2://data/mastery-effect-active.webp";
const OFFICIAL_TREE_URL = "poe2://data/official-data.json";

const plannerStatUtils = typeof module === "object" && module.exports
  ? require("./stat-utils.js")
  : window.plannerStatUtils;
const { cleanStatDisplay, normalizeStatKey, compileStatTemplate } = plannerStatUtils;
const localizationEngine = typeof module === "object" && module.exports
  ? require("./localization-engine.js")
  : window.plannerLocalizationEngine;
const buildCodec = typeof module === "object" && module.exports
  ? require("./build-codec.js")
  : window.plannerBuildCodec;
const buildStateAdapter = typeof module === "object" && module.exports
  ? require("./build-state-adapter.js")
  : window.plannerBuildStateAdapter;
const weGameImportUI = typeof module === "object" && module.exports
  ? require("./wegame-import-ui.js")
  : window.plannerWeGameImportUI;
const passiveGraphCore = typeof module === "object" && module.exports
  ? require("./passive-graph.js")
  : window.plannerPassiveGraph;
const {
  buildShortestPathIndex,
  createPassiveGraph,
  pathFromIndex,
  reachableEligibleIds,
  shortestEligiblePath,
} = passiveGraphCore;

const $ = (s) => document.querySelector(s);
const canvas = $("#treeCanvas");
const wrap = $("#stage");
const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

let tree = null;
let jump = null;
let nodes = [];
let edges = [];
let renderEdges = [];
let byId = new Map();
let passiveGraph = null;
let rawGraph = null;
let spatial = new Map();

let skillsImg = null;
let framesImg = null;
let spritesReady = false;

let masteryEffectImg = null;
let masteryEffectAtlas = null;
let masteryEffectsReady = false;

let classOptions = [];
let baseClassName = null;
let classStartId = null;
let ascendancyOptions = [];
let selectedAscendancyId = null;
let ascDisplayDelta = { dx: 0, dy: 0, cx: 0, cy: 0 };
const classPortraitCache = new Map();
let classPortraitImg = null;
let classPortraitKey = null;
let classPortraitRenderedClass = null;
let classPortraitRequestSerial = 0;
let allocated = new Set();              // shared/general passive nodes
let weaponSet1Allocated = new Set();     // active only with Weapon Set I
let weaponSet2Allocated = new Set();     // active only with Weapon Set II
let weaponMode = "general";              // general | ws1 | ws2
let maxWeaponPoints = 24;                // campaign default; adjustable for special cases
let ascAllocated = new Set();           // current ascendancy nodes
let ascStartId = null;
let buildPreservation = null;
let plannerDataReady = false;
let buildStateUnsafe = false;
let weGamePreviewValue = null;
const weGameRequestGate=weGameImportUI.createLatestRequestGate();

let previewPath = [];                    // ordinary hover path
let previewIds = new Set();
let previewEdgeKeys = new Set();

let ascPreviewPath = [];                 // ascendancy hover path
let ascPreviewIds = new Set();
let ascPreviewEdgeKeys = new Set();
let ascPathParent = new Map();

let showLockedConditional = false;       // planner preview for tree-internal conditional reveal nodes

let instillAllocated = new Set();         // separate from graph nodes and passive points
let instillSearchQuery = "";
let showInstillOnGraph = false;
let instillOverlayHits = [];
let hoveredInstill = null;

const INSTILL_NAME_ZH_FALLBACK = {
  "Augmented Flesh": "血肉增幅",
  "Zarokh's Gift": "扎洛卡的馈赠",
  "Paragon": "典范"
};

const INSTILL_EXCLUSIVE_PASSIVES = [
  {
    name: "Zarokh's Gift",
    stats: ["Sinister Jewel Socket"]
  },
  {
    name: "Augmented Flesh",
    stats: ["Grants 2 additional Skill Slots"]
  },
  {
    name: "Bastion of Light",
    stats: [
      "Blind Enemies 3 metres in front of you every 0.25 seconds while your Shield is raised",
      "Raise Shield inflicts Parried for 2 seconds on Hit"
    ]
  },
  {
    name: "Dark Entropy",
    stats: ["Withered also causes enemies to deal 1% reduced Damage"]
  },
  {
    name: "Desert's Scorn",
    stats: [
      "Enemies standing on Ignited Ground take 25% increased Cold Damage",
      "Enemies standing on Chilled Ground take 25% increased Fire Damage"
    ]
  },
  {
    name: "Dominion",
    stats: [
      "Archon Buffs have no recovery period after you lose one",
      "50% reduced effect of Archon Buffs on you"
    ]
  },
  {
    name: "Grace of the Ancestors",
    stats: [
      "10% increased Attack Speed",
      "Every Rage also grants 1% increased Evasion Rating"
    ]
  },
  {
    name: "Growing Peril",
    stats: ["1% increased Chaos Damage over Time per Volatility"]
  },
  {
    name: "Kaom's Blessing",
    stats: ["The next Fire Spell you cast yourself after using a Warcry is Ancestrally Boosted"]
  },
  {
    name: "Lord of the Squall",
    stats: ["Grant Elemental Archon to your Minions for 5 seconds when they Revive"]
  },
  {
    name: "Magnum Opus",
    stats: ["Charms applied to you have 100% increased Effect per empty Charm slot"]
  },
  {
    name: "Mystic Avalanche",
    stats: ["Final Echo of Cascadable Spells also Cascades to either side of the targeted Area along a random axis"]
  },
  {
    name: "Paragon",
    stats: [
      "+5% to Quality of all Skills",
      "+5 to all Attributes"
    ]
  },
  {
    name: "Replenishing Horde",
    stats: [
      "25% Chance to revive a random Permanent Minion whenever you use a Command Skill",
      "25% Surpassing Chance to gain a Puppet Master stack whenever you use a Command Skill"
    ]
  },
  {
    name: "Storm's Rebuke",
    stats: ["Fully Broken Armour you inflict also increases Cold and Lightning Damage Taken from Hits"]
  },
  {
    name: "Thaumaturgic Generator",
    stats: ["Grants Thaumaturgical Dynamism"]
  },
  {
    name: "Unfettered",
    stats: [
      "10% increased Movement Speed while Sprinting",
      "50% increased Armour while Bleeding"
    ]
  }
];

const INSTILL_EXCLUSIVE_NAME_SET = new Set(
  INSTILL_EXCLUSIVE_PASSIVES.map(x=>x.name)
);
let instillNativeNodeMap = new Map();
let officialHiddenSidecarReady = false;
let officialHiddenSidecarError = null;
let officialToCurrentTransform = {sx:1,sy:1,tx:0,ty:0,samples:0};

// Known conditional nodes where unlock prerequisites and the visible/path
// connector are not the same concept.
const CONDITIONAL_NODE_OVERRIDES = {
  "The Hollowkeeper": {
    requires: ["First Teachings of the Keeper", "First Principle of the Hollow"],
    // Per in-game layout: only this is the visible/passable tree connector.
    visibleConnections: ["First Teachings of the Keeper"]
  },
  "Path of the Renegade": {
    requires: ["Redblade Discipline", "Brinerot Ferocity", "Mutewind Agility"]
  }
};

function isInstillExclusiveNode(n) {
  return Boolean(n && INSTILL_EXCLUSIVE_NAME_SET.has(String(n.name||"")));
}


const OFFICIAL_ORBIT_RADII = [0,82,162,335,493,662,846,251,1080,1322];

function calcOrbitAngles(count) {
  if(count===16) {
    return [0,30,45,60,90,120,135,150,180,210,225,240,270,300,315,330]
      .map(x=>x*Math.PI/180);
  }
  if(count===40) {
    return [0,10,20,30,40,45,50,60,70,80,90,100,110,120,130,135,140,150,160,170,180,190,200,210,220,225,230,240,250,260,270,280,290,300,310,315,320,330,340,350]
      .map(x=>x*Math.PI/180);
  }
  const n=Math.max(1,count||1);
  return Array.from({length:n},(_,i)=>Math.PI*2*i/n);
}

function officialOrbitCounts(data) {
  const counts=new Map();
  for(const raw of Object.values(data?.nodes||{})) {
    if(!raw || !Number.isFinite(Number(raw.orbit)) || !Number.isFinite(Number(raw.orbitIndex))) continue;
    const o=Number(raw.orbit);
    const idx=Number(raw.orbitIndex);
    counts.set(o,Math.max(counts.get(o)||0,idx+1));
  }
  return counts;
}

function officialNodePosition(data,raw,orbitCounts) {
  // Current GGG export carries x/y on raw nodes; prefer those.
  if(Number.isFinite(Number(raw?.x)) && Number.isFinite(Number(raw?.y))) {
    return {x:Number(raw.x),y:Number(raw.y)};
  }

  const group=data?.groups?.[String(raw?.group)] ?? data?.groups?.[raw?.group];
  if(!group || !Number.isFinite(Number(group.x)) || !Number.isFinite(Number(group.y))) return null;

  const orbit=Number(raw.orbit);
  const idx=Number(raw.orbitIndex);
  const radius=OFFICIAL_ORBIT_RADII[orbit] ?? 0;
  const count=orbitCounts.get(orbit)||Math.max(1,idx+1);
  const angles=calcOrbitAngles(count);
  const angle=angles[idx] ?? (Math.PI*2*idx/count);

  // Same derivation used by PoB PassiveTree:
  // x = group.x + sin(angle) * radius
  // y = group.y - cos(angle) * radius
  return {
    x:Number(group.x)+Math.sin(angle)*radius,
    y:Number(group.y)-Math.cos(angle)*radius
  };
}

function fitLinear1D(pairs,pKey,qKey) {
  if(pairs.length<3) return {s:1,t:0};
  let mp=0,mq=0;
  for(const r of pairs){mp+=r[pKey];mq+=r[qKey];}
  mp/=pairs.length; mq/=pairs.length;

  let cov=0,variance=0;
  for(const r of pairs) {
    const dp=r[pKey]-mp;
    cov+=dp*(r[qKey]-mq);
    variance+=dp*dp;
  }
  const s=variance>1e-9 ? cov/variance : 1;
  const t=mq-s*mp;
  return {s,t};
}

function deriveOfficialToCurrentTransform(data,orbitCounts) {
  const pairs=[];

  for(const [id,raw] of Object.entries(data?.nodes||{})) {
    if(pairs.length>=1400) break;
    const current=byId.get(String(id));
    if(!current || isAsc(current) || isMasteryVisual(current)) continue;
    if(!Number.isFinite(current.x)||!Number.isFinite(current.y)) continue;

    const p=officialNodePosition(data,raw,orbitCounts);
    if(!p) continue;
    pairs.push({px:p.x,py:p.y,qx:current.x,qy:current.y});
  }

  const fx=fitLinear1D(pairs,"px","qx");
  const fy=fitLinear1D(pairs,"py","qy");

  const safe=(v,fallback)=>Number.isFinite(v)?v:fallback;
  officialToCurrentTransform={
    sx:safe(fx.s,1),
    sy:safe(fy.s,1),
    tx:safe(fx.t,0),
    ty:safe(fy.t,0),
    samples:pairs.length
  };
  return officialToCurrentTransform;
}

function transformOfficialPoint(p) {
  const t=officialToCurrentTransform;
  return {
    x:p.x*t.sx+t.tx,
    y:p.y*t.sy+t.ty
  };
}

function makeOfficialHiddenNode(id,raw,p,rec) {
  const isJewel=Boolean(raw.isJewelSocket);
  const k=isJewel ? "jewel" : raw.isKeystone ? "keystone" : raw.isNotable ? "notable" : "small";

  return {
    ...raw,
    _id:String(id),
    skill:Number(id),
    x:p.x,
    y:p.y,
    name:String(raw.name||rec.name),
    stats:Array.isArray(raw.stats)&&raw.stats.length ? raw.stats : rec.stats,
    icon:raw.icon||null,
    kind:k,
    isBlighted:true,
    isJewelSocket:isJewel,
    _officialHiddenSidecar:true
  };
}

async function loadOfficialHiddenSidecar() {
  officialHiddenSidecarReady=false;
  officialHiddenSidecarError=null;
  renderInstillCatalog();

  const res=await fetch(OFFICIAL_TREE_URL);
  if(!res.ok) throw new Error(`GGG data.json HTTP ${res.status}`);
  const data=await res.json();

  const orbitCounts=officialOrbitCounts(data);
  deriveOfficialToCurrentTransform(data,orbitCounts);

  // Merge missing official unlock constraints onto existing tree nodes too.
  for(const [id,raw] of Object.entries(data.nodes||{})) {
    const current=byId.get(String(id));
    if(!current) continue;
    if(raw.unlockConstraint && !current.unlockConstraint) current.unlockConstraint=raw.unlockConstraint;
    if(raw.isBlighted) current.isBlighted=true;
  }

  let injected=0;

  for(const rec of INSTILL_EXCLUSIVE_PASSIVES) {
    let node=nodes.find(n=>String(n.name||"")===rec.name);

    if(!node) {
      let rawId=null;
      let rawNode=null;

      for(const [id,raw] of Object.entries(data.nodes||{})) {
        if(String(raw?.name||"")===rec.name) {
          rawId=id;
          rawNode=raw;
          break;
        }
      }

      if(rawNode) {
        const officialPos=officialNodePosition(data,rawNode,orbitCounts);
        if(officialPos) {
          const displayPos=transformOfficialPoint(officialPos);
          node=makeOfficialHiddenNode(rawId,rawNode,displayPos,rec);

          nodes.push(node);
          byId.set(String(rawId),node);
          addSpatial(node);
          injected++;

          // Use official current descriptions where available.
          if(Array.isArray(rawNode.stats)&&rawNode.stats.length) {
            rec.stats=[...rawNode.stats];
          }
        }
      }
    }

    if(node) instillNativeNodeMap.set(rec.name,node);
  }

  officialHiddenSidecarReady=true;
  officialHiddenSidecarError=null;

  // Sidecar may have restored unlockConstraint on ordinary nodes.
  rebuildPathIndex();
  updateConditionalUI();
  renderInstillCatalog();
  scheduleDraw();

  console.info("[official-hidden]",{
    matched:instillNativeNodeMap.size,
    injected,
    transform:officialToCurrentTransform
  });
}

function buildInstillNativeNodeMap() {
  instillNativeNodeMap=new Map();
  for(const rec of INSTILL_EXCLUSIVE_PASSIVES) {
    const n=nodes.find(x=>String(x.name||"")===rec.name);
    if(n) instillNativeNodeMap.set(rec.name,n);
  }
  return instillNativeNodeMap;
}

function instillNodeVisible(n) {
  if(!isInstillExclusiveNode(n)) return true;
  return showInstillOnGraph || instillAllocated.has(String(n.name||""));
}

function conditionalOverrideFor(n) {
  return n ? (CONDITIONAL_NODE_OVERRIDES[String(n.name||"")] || null) : null;
}

function overrideRequirementIds(n) {
  const ov=conditionalOverrideFor(n);
  if(!ov?.requires) return [];
  return ov.requires
    .map(name=>nodes.find(x=>String(x.name||"")===name))
    .filter(Boolean)
    .map(idOf);
}

function conditionalVisibleConnectionAllowedNodes(a,b) {
  for(const [conditional,other] of [[a,b],[b,a]]) {
    const ov=conditionalOverrideFor(conditional);
    if(!ov?.visibleConnections) continue;
    return ov.visibleConnections.includes(String(other?.name||""));
  }
  return true;
}

function allocatableEdgeAllowedNodes(a,b) {
  if(!a||!b) return false;
  if(isMasteryVisual(a)||isMasteryVisual(b)) return false;
  if(isInstillExclusiveNode(a)||isInstillExclusiveNode(b)) return false;
  if(!conditionalVisibleConnectionAllowedNodes(a,b)) return false;
  return true;
}



let pathParent = new Map();
let hovered = null;
let selected = null;

let searchMatches = [];
let searchMatchIds = new Set();
let searchMatchIndex = -1;
let searchTypeFilter = "all";
let searchHighlightActive = false;
let lastCoverage = {names:0,totalNames:0,stats:0,totalStats:0,weGameNames:0,weGameStats:0,englishNames:0,englishStats:0};

let undoStack = [];
let redoStack = [];

let showIcons = true;
let showFrames = true;
let showSmall = true;
let showAsc = false;
let showLabels = true;
let styleMode = "game";
let edgeOpacity = 0.48;
let nodeScale = 1.0;
let maxPoints = 123;
let maxAscPoints = 8;


let languageMode = "zh";
let i18nLoading = false;
const i18n = {
  ready: false,
  passiveZh: new Map(),   // English passive name -> Simplified Chinese
  classZh: new Map(),     // English class name -> Simplified Chinese
  statExactZh: new Map(), // Exact English stat line -> Simplified Chinese
  statIndex: new Map(),   // normalized English template -> compiled candidates
  statCache: new Map(),
  nodeNames: new Map(),
  nodeStats: new Map(),
  diagnostics: null,
  passiveCount: 0,
  statTemplateCount: 0
};

let W = 1, H = 1, DPR = 1;
let dragging = false, moved = false, lastX = 0, lastY = 0;
let rafPending = false;

const camera = { x: 0, y: 0, scale: 0.04 };
const CELL = 650;

function idOf(n) { return String(n.skill ?? n._id); }
function kind(n) { return n.kind || "small"; }
function isAsc(n) { return Boolean(n?.asc); }
function edgeKey(a,b) { a=String(a); b=String(b); return a<b ? `${a}|${b}` : `${b}|${a}`; }
const POE2_CLASS_INDICES = new Set([6,7,8,2,9,10,11]);

function isClassStart(n) {
  return kind(n)==="classstart" || Array.isArray(n.classesStart) || Array.isArray(n.classStartIndex);
}

function classStartIndices(n) {
  if(Array.isArray(n?.classStartIndex)) return n.classStartIndex.map(Number).filter(Number.isFinite);
  if(Array.isArray(n?.classesStart)) {
    return n.classesStart.map(Number).filter(Number.isFinite);
  }
  return [];
}

function isRelevantPoe2ClassStart(n) {
  if(!isClassStart(n)) return false;
  const indices=classStartIndices(n);

  // If the preprocessor did not preserve indices, keep the node only when it
  // is the currently selected class start. This prevents legacy PoE1 anchors
  // from being rendered as real PoE2 starts.
  if(!indices.length) return Boolean(classStartId && idOf(n)===String(classStartId));

  return indices.some(i=>POE2_CLASS_INDICES.has(i));
}

const LEGACY_START_ARTIFACT_NAMES = new Set([
  "Six",
  "Marauder",
  "Witch",
  "Ranger",
  "Duelist",
  "Shadow",
  "Templar"
]);

function isLegacyStartArtifact(n) {
  if(!n) return false;

  const rawName=String(n.name||"").trim();

  // "Six" is a legacy start anchor that survives the slim preprocessing but
  // does not consistently retain classstart metadata.
  if(LEGACY_START_ARTIFACT_NAMES.has(rawName)) return true;

  // A pure integer label on/near a start anchor is presentation metadata,
  // never a real passive skill.
  if(/^\d+$/.test(rawName) && (n.group==null || kind(n)==="classstart")) return true;

  // Ordinary classstart nodes that are not relevant PoE2 starts are artifacts.
  if(isClassStart(n) && !isRelevantPoe2ClassStart(n)) return true;

  return false;
}


const BASE_CLASS_ORDER = ["Warrior","Ranger","Witch","Sorceress","Monk","Mercenary","Huntress","Druid"];
const CLASS_ZH_FALLBACK = {
  Warrior:"战士", Ranger:"游侠", Witch:"女巫", Sorceress:"魔巫",
  Monk:"武僧", Mercenary:"佣兵", Huntress:"女猎手", Druid:"德鲁伊"
};
const ASC_ZH_FALLBACK = {
  "Deadeye":"锐眼", "Pathfinder":"追猎者",
  "Titan":"泰坦", "Warbringer":"战争使者", "Smith of Kitava":"奇塔弗工匠",
  "Infernalist":"狱火师", "Blood Mage":"血法师", "Lich":"巫妖",
  "Stormweaver":"风暴编织者", "Chronomancer":"时空幻术师", "Disciple of Varashta":"门徒",
  "Tactician":"战术家", "Witchhunter":"女巫猎人", "Gemling Legionnaire":"古灵军团",
  "Martial Artist":"武圣", "Invoker":"四象尊", "Acolyte of Chayula":"夏乌拉侍僧",
  "Amazon":"亚马逊", "Spirit Walker":"灵魂行者", "Ritualist":"仪式行者",
  "Oracle":"神谕", "Shaman":"萨满"
};

function ascPrefix(id) {
  const m=String(id||"").match(/^[A-Za-z]+/);
  return m?m[0]:"";
}
function ascendancyAllowed(n) {
  if(!isAsc(n)) return true;
  return Boolean(showAsc && selectedAscendancyId && n.asc===selectedAscendancyId);
}

function selectedAscNodes() {
  if(!selectedAscendancyId) return [];
  return nodes.filter(n =>
    n.asc===selectedAscendancyId &&
    Number.isFinite(n.x) &&
    Number.isFinite(n.y)
  );
}

function recomputeAscDisplayDelta() {
  if(!selectedAscendancyId) {
    ascDisplayDelta={dx:0,dy:0,cx:0,cy:0};
    return ascDisplayDelta;
  }

  const list=selectedAscNodes();
  if(!list.length) {
    ascDisplayDelta={dx:0,dy:0,cx:0,cy:0};
    return ascDisplayDelta;
  }

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of list) {
    minX=Math.min(minX,n.x);
    minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x);
    maxY=Math.max(maxY,n.y);
  }

  const cx=(minX+maxX)/2;
  const cy=(minY+maxY)/2;
  // Mirrors poe2drydream:
  // <g transform={`translate(${-ascCenter.cx} ${-ascCenter.cy})`}>
  ascDisplayDelta={dx:-cx,dy:-cy,cx,cy};
  return ascDisplayDelta;
}

function isSelectedAscNode(n) {
  return Boolean(
    showAsc &&
    selectedAscendancyId &&
    n &&
    n.asc===selectedAscendancyId
  );
}

function displayPosition(n) {
  if(isSelectedAscNode(n)) {
    return {x:n.x+ascDisplayDelta.dx,y:n.y+ascDisplayDelta.dy};
  }
  return {x:n.x,y:n.y};
}

function selectedAscEdges() {
  if(!showAsc || !selectedAscendancyId) return [];
  return renderEdges.filter(e =>
    e.a?.asc===selectedAscendancyId &&
    e.b?.asc===selectedAscendancyId
  );
}

function mainDisplayEdge(e) {
  if(!allocatableEdgeAllowedNodes(e.a,e.b)) return false;

  if(isLegacyStartArtifact(e.a) || isLegacyStartArtifact(e.b)) return false;

  return !isAsc(e.a) && !isAsc(e.b) && visibleNode(e.a) && visibleNode(e.b);
}

function hiddenDisplayEdge(e) {
  return mainDisplayEdge(e) && (isConditionalReveal(e.a) || isConditionalReveal(e.b));
}



function classPortraitUrl(className) {
  if(!className) return null;
  const slug=String(className).trim().toLowerCase().replace(/\s+/g,"-");
  return `poe2://portrait/background-${slug}.webp`;
}

function expectedPortraitClass() {
  // Ascendancy id is the strongest source of truth. This prevents a stale
  // baseClassName from ever pairing Mercenary1 with the Warrior sheet, etc.
  if(selectedAscendancyId) {
    const cls=ascPrefix(selectedAscendancyId);
    if(cls) return cls;
  }
  return baseClassName || null;
}

async function ensureClassPortrait() {
  const key=expectedPortraitClass();
  const requestId=++classPortraitRequestSerial;

  // IMPORTANT: invalidate the currently displayed sheet synchronously when
  // switching classes. Otherwise the old class remains visible while the new
  // 3000x3000 portrait sheet is still loading.
  if(classPortraitRenderedClass!==key) {
    classPortraitImg=null;
    classPortraitRenderedClass=null;
    scheduleDraw();
  }

  classPortraitKey=key;
  if(!key) return;

  if(classPortraitCache.has(key)) {
    // Ignore a cached failure by allowing a future explicit page reload to retry,
    // but never render a different class as a fallback.
    const cached=classPortraitCache.get(key);
    if(requestId!==classPortraitRequestSerial || classPortraitKey!==key) return;
    classPortraitImg=cached || null;
    classPortraitRenderedClass=cached ? key : null;
    scheduleDraw();
    return;
  }

  const url=classPortraitUrl(key);
  try {
    const img=await loadImage(url);
    classPortraitCache.set(key,img);

    // Async race protection: a Warrior request finishing after the user has
    // switched to Mercenary must not overwrite the Mercenary sheet.
    if(requestId===classPortraitRequestSerial && classPortraitKey===key && expectedPortraitClass()===key) {
      classPortraitImg=img;
      classPortraitRenderedClass=key;
      scheduleDraw();
    }
  } catch(err) {
    console.warn("[portrait]",key,err);
    classPortraitCache.set(key,null);
    if(requestId===classPortraitRequestSerial && classPortraitKey===key) {
      classPortraitImg=null;
      classPortraitRenderedClass=null;
      scheduleDraw();
    }
  }
}

function portraitSlot() {
  if(!selectedAscendancyId) return 0;
  const expected=expectedPortraitClass();
  if(!expected || ascPrefix(selectedAscendancyId)!==expected) return 0;
  const m=String(selectedAscendancyId).match(/(\d+)$/);
  if(!m) return 0;
  const n=Number(m[1]);
  return n>=1 && n<=3 ? n : 0;
}

function drawClassPortrait() {
  const expected=expectedPortraitClass();
  // Never draw a sheet unless it is confirmed to belong to the currently
  // selected base/ascendancy class. This is the final guard against stale UI.
  if(!classPortraitImg || !expected || classPortraitRenderedClass!==expected) return;

  const slot=portraitSlot();
  const sx=(slot%2)*1500;
  const sy=Math.floor(slot/2)*1500;

  ctx.save();
  ctx.globalAlpha=.85;
  ctx.drawImage(
    classPortraitImg,
    sx,sy,1500,1500,
    -1500,-1500,3000,3000
  );
  ctx.restore();
}

function zhClassName(en) {
  if(!en) return "";
  if(i18n.ready) {
    const z=i18n.classZh.get(en)||i18n.passiveZh.get(en);
    if(z && z!==en) return z;
  }
  return CLASS_ZH_FALLBACK[en]||"";
}
function zhAscendancyName(en) {
  if(!en) return "";
  if(i18n.ready) {
    const z=i18n.passiveZh.get(en)||i18n.classZh.get(en);
    if(z && z!==en) return z;
  }
  return ASC_ZH_FALLBACK[en]||"";
}
function displayAscendancyName(en) {
  const zh=zhAscendancyName(en);
  if(languageMode==="en") return en;
  if(languageMode==="bi") return zh&&zh!==en?`${zh} / ${en}`:en;
  return zh||en;
}



function nodeAllocated(n) {
  if(!n) return false;
  if(isMasteryVisual(n) || isInstillExclusiveNode(n)) return false;
  return isAsc(n) ? ascAllocated.has(idOf(n)) : allocated.has(idOf(n));
}

function allAllocatedIds() {
  return new Set([...allocated, ...ascAllocated]);
}

function isMasteryVisual(n) {
  if(!n) return false;
  return kind(n)==="mastery" || n.isOnlyImage===true;
}

function unlockConstraintOf(n) {
  const uc=n?.unlockConstraint;
  if(uc && typeof uc==="object") return uc;

  // tree-pre may omit a field preserved by the official/raw export.
  // Restore only known, explicit conditions by canonical passive names.
  const ids=overrideRequirementIds(n);
  return ids.length ? {nodes:ids} : null;
}

function isConditionalReveal(n) {
  return Boolean(
    n &&
    !isAsc(n) &&
    !isMasteryVisual(n) &&
    !isInstillExclusiveNode(n) &&
    unlockConstraintOf(n)
  );
}

// Backward-compatible name used by a few render helpers.
function isHiddenConditional(n) {
  return isConditionalReveal(n);
}

function constraintNodeIds(n) {
  const uc=unlockConstraintOf(n);
  if(!uc || !Array.isArray(uc.nodes)) return [];
  return uc.nodes.map(String);
}

function selectedAscEntry() {
  return ascendancyOptions.find(a=>a.id===selectedAscendancyId) || null;
}

function ascendancyEntryByRequirement(required) {
  const key=String(required||"");
  if(!key) return null;
  return ascendancyOptions.find(a=>
    String(a.id||"")===key ||
    String(a.name||"")===key ||
    String(ascPrefix(a.id)||"")===key
  ) || null;
}

function displayRequiredAscendancy(required) {
  const entry=ascendancyEntryByRequirement(required);
  if(entry) return displayAscendancyName(entry.name);

  // Last-resort translations for raw official IDs/names that may arrive
  // before tree-jump ascendancy metadata is populated.
  const raw=String(required||"");
  const zh=i18n.ready ? (i18n.classZh.get(raw)||i18n.passiveZh.get(raw)||"") : "";
  return zh || raw;
}

function constraintAscendancyMatches(n) {
  const uc=unlockConstraintOf(n);
  if(!uc || !uc.ascendancy) return true;
  if(!selectedAscendancyId) return false;

  const required=String(uc.ascendancy);
  const selected=selectedAscEntry();
  const requiredEntry=ascendancyEntryByRequirement(required);

  if(requiredEntry) return requiredEntry.id===selectedAscendancyId;

  const candidates=new Set([
    String(selectedAscendancyId),
    String(selected?.name||""),
    String(ascPrefix(selectedAscendancyId)||"")
  ].filter(Boolean));
  return candidates.has(required);
}

function constraintSatisfied(n) {
  const uc=unlockConstraintOf(n);
  if(!uc) return true;
  if(!constraintAscendancyMatches(n)) return false;

  const active=allAllocatedIds();
  for(const req of constraintNodeIds(n)) {
    if(!active.has(req)) return false;
  }
  return true;
}

function conditionalNodeVisible(n) {
  if(!isConditionalReveal(n)) return true;

  const uc=unlockConstraintOf(n);
  // "Preview locked" only previews nodes that belong to the currently
  // selected ascendancy. Oracle Paths Not Taken must never appear while
  // e.g. Invoker/Warrior ascendancy is selected.
  if(uc?.ascendancy && !constraintAscendancyMatches(n)) return false;

  return constraintSatisfied(n) || showLockedConditional || allocated.has(idOf(n));
}

function conditionalNodeLocked(n) {
  return Boolean(isConditionalReveal(n) && !constraintSatisfied(n));
}

// Backward-compatible wrappers.
function hiddenNodeVisible(n) {
  return conditionalNodeVisible(n);
}
function hiddenNodeLocked(n) {
  return conditionalNodeLocked(n);
}

function hiddenRequirementNames(n) {
  const out=[];
  for(const id of constraintNodeIds(n)) {
    const req=byId.get(String(id));
    out.push(req ? displayNodeName(req) : `ID ${id}`);
  }
  const uc=unlockConstraintOf(n);
  if(uc?.ascendancy) {
    const displayed=displayRequiredAscendancy(uc.ascendancy);
    if(displayed && !out.includes(displayed)) out.unshift(displayed);
  }
  return out;
}

function hiddenDependentsOf(ids) {
  const idSet=ids instanceof Set ? ids : new Set([String(ids)]);
  const out=[];
  for(const n of nodes) {
    if(!isConditionalReveal(n) || !allocated.has(idOf(n))) continue;
    const reqs=constraintNodeIds(n);
    if(reqs.some(id=>idSet.has(String(id)))) out.push(n);
  }
  return out;
}

function canTraverse(n) {
  if (!n || isAsc(n) || isMasteryVisual(n) || isInstillExclusiveNode(n) || isLegacyStartArtifact(n)) return false;
  if (isClassStart(n) && classStartId && idOf(n)!==classStartId) return false;
  if (isConditionalReveal(n) && !constraintSatisfied(n)) return false;
  return true;
}

function canTraverseAsc(n) {
  return Boolean(
    n &&
    !isMasteryVisual(n) &&
    selectedAscendancyId &&
    n.asc===selectedAscendancyId
  );
}

let masteryTriggerIndex=new Map();
function masteryTriggerCandidates(mastery) {
  return (masteryTriggerIndex.get(idOf(mastery))||[]).map(id=>byId.get(id)).filter(Boolean);
}

function masteryTriggered(mastery) {
  return window.plannerMasteryVisualState.isTriggered(
    masteryTriggerIndex.get(idOf(mastery)),allocated,weaponSet1Allocated,weaponSet2Allocated);
}

function masteryAtlasFrame(n) {
  if(!masteryEffectAtlas?.frames) return null;

  if(n.activeEffectImage) {
    const exact=`masteryEffectActive:${n.activeEffectImage}`;
    const rec=masteryEffectAtlas.frames[exact];
    if(rec?.frame) return rec.frame;
  }

  const token=String(n.name||"")
    .replace(/\s+Mastery$/i,"")
    .replace(/[^A-Za-z]/g,"")
    .toLowerCase();

  if(!token) return null;
  for(const [key,rec] of Object.entries(masteryEffectAtlas.frames)) {
    const norm=key.replace(/[^A-Za-z]/g,"").toLowerCase();
    if(norm.includes(`mastery${token}pattern`) && rec?.frame) return rec.frame;
  }
  return null;
}



function luaUnescape(s) {
  return String(s).replace(/\\(\d{1,3}|["\\nrt])/g, (_, token) => {
    if (/^\d+$/.test(token)) return String.fromCharCode(Number(token));
    if (token === "n") return "\n";
    if (token === "r") return "\r";
    if (token === "t") return "\t";
    if (token === "\\") return "\\";
    if (token === '"') return '"';
    return token;
  });
}

function parseChineseTranslationLua(text) {
  const passiveZh = new Map();
  const classZh = new Map();
  const statExactZh = new Map();
  const statIndex = new Map();

  let section = null;
  let statTemplateCount = 0;

  const mapRe = /^\s*\["((?:\\.|[^"\\])*)"\]="((?:\\.|[^"\\])*)",?\s*$/;
  const pairRe = /^\s*\{"((?:\\.|[^"\\])*)","((?:\\.|[^"\\])*)"\},?\s*$/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === "d.passives = {") { section = "passives"; continue; }
    if (line === "d.classes = {") { section = "classes"; continue; }
    if (line === "d.statLines = {") { section = "statLines"; continue; }
    if (section && line === "}") { section = null; continue; }
    if (!section) continue;

    if (section === "passives" || section === "classes") {
      const m = mapRe.exec(rawLine);
      if (!m) continue;
      const zh = luaUnescape(m[1]);
      const en = luaUnescape(m[2]);
      if (!zh || !en) continue;
      const target = section === "passives" ? passiveZh : classZh;
      if (!target.has(en)) target.set(en, zh); // invert the emitted zh -> en map
      continue;
    }

    if (section === "statLines") {
      const m = pairRe.exec(rawLine);
      if (!m) continue;
      const zh = cleanStatDisplay(luaUnescape(m[1]));
      const en = cleanStatDisplay(luaUnescape(m[2]));
      if (!zh || !en) continue;

      if (!/\{\d+\}/.test(en)) {
        if (!statExactZh.has(en)) statExactZh.set(en, zh);
      }

      const rec = compileStatTemplate(en, zh);
      if (!rec) continue;
      const key = normalizeStatKey(en);
      if (!statIndex.has(key)) statIndex.set(key, []);
      statIndex.get(key).push(rec);
      statTemplateCount++;
    }
  }

  return { passiveZh, classZh, statExactZh, statIndex, statTemplateCount };
}


function translateStatResult(rawStat, node = null) {
  const english=cleanStatDisplay(rawStat);
  if(!english || !i18n.ready) return localizationEngine.englishResult(english,"not-ready");
  const nodeResult=node ? i18n.nodeStats.get(idOf(node))?.get(english) : null;
  if(nodeResult) return nodeResult;
  const parts=String(rawStat ?? "").split(/\n/).map(line=>localizationEngine.translatePobStat(line,i18n));
  if(parts.length && parts.every(result=>result.translated)) {
    return Object.freeze({value:parts.map(result=>result.value).join("\n"),source:"pob2",quality:parts.every(result=>result.quality==="pob-exact")?"pob-exact":"pob-template",translated:true});
  }
  return localizationEngine.englishResult(english);
}

function translateStatRaw(stat, node = null) {
  return translateStatResult(stat,node).value;
}



function zhNameOf(n) {
  const en = String(n?.name || "");
  if(!i18n.ready) return "";
  const result=globalThis.plannerLocalizationEngine.resolveNodeName({id:idOf(n),name:en},i18n.nodeNames,i18n.passiveZh);
  return result.translated ? result.value : "";
}

function displayNodeName(n, mode = languageMode) {
  const en = String(n?.name || idOf(n));
  const zh = zhNameOf(n);
  if (mode === "en") return en;
  if (mode === "bi") return zh && zh !== en ? `${zh} / ${en}` : en;
  return zh || `${en}（暂无可靠中文）`;
}

function canvasNodeName(n) {
  if (languageMode === "en") return String(n?.name || idOf(n));
  return zhNameOf(n) || String(n?.name || idOf(n));
}

function displayStat(stat, mode = languageMode, node = null) {
  const en = cleanStatDisplay(stat);
  const result = translateStatResult(stat,node);
  const zh = result.value;
  if (mode === "en") return en;
  if (mode === "bi") return result.translated ? `${zh}\n${en}` : en;
  return result.translated ? zh : `${en}（暂无可靠中文）`;
}

function displayClassName(en) {
  const zh = zhClassName(en);
  if (languageMode === "en") return en;
  if (languageMode === "bi") return zh && zh !== en ? `${zh} / ${en}` : en;
  return zh || en;
}

function nodeTypeLabel(n) {
  if(isInstillExclusiveNode(n)) return "树外隐藏天赋";
  if(isHiddenConditional(n)) return "条件显现天赋";
  if(isAsc(n)) return "升华天赋";
  return {keystone:"关键天赋",notable:"核心天赋",jewel:"珠宝插槽",classstart:"职业起点",ascstart:"升华起点",small:"普通天赋"}[kind(n)] || "被动天赋";
}


function searchTypeMatches(n) {
  if(searchTypeFilter==="all") return true;
  if(searchTypeFilter==="notable") return kind(n)==="notable";
  if(searchTypeFilter==="keystone") return kind(n)==="keystone";
  if(searchTypeFilter==="jewel") return kind(n)==="jewel" || n.isJewelSocket===true;
  if(searchTypeFilter==="hidden") return isHiddenConditional(n) || isInstillExclusiveNode(n);
  if(searchTypeFilter==="asc") return isAsc(n);
  return true;
}

let exactSearchStatus="";
function recomputeSearchMatches() {
  const q=String($("#search")?.value||"").trim().toLowerCase();
  const exact=$("#searchMode")?.value==="id";
  exactSearchStatus="";
  searchMatches=[]; searchMatchIds.clear(); searchMatchIndex=-1;
  if(!q) { searchHighlightActive=false; updateSearchUI(); scheduleDraw(); return; }

  const candidate=exact ? byId.get(q) : null;
  if(exact) exactSearchStatus=candidate ? "节点当前不可见" : "找不到该节点 ID";
  for(const n of exact ? (candidate ? [candidate] : []) : nodes) {
    if(exact && (isAsc(n) ? (!showAsc || (!showSmall && kind(n)==="small")) : !visibleNode(n))) continue;
    if(isMasteryVisual(n) || isLegacyStartArtifact(n)) continue;
    if(isInstillExclusiveNode(n) && !instillNodeVisible(n)) continue;
    if(isAsc(n) && n.asc!==selectedAscendancyId) continue;
    if(isConditionalReveal(n) && !conditionalNodeVisible(n)) continue;
    if(!exact && !searchTypeMatches(n)) continue;
    if(exact || nodeSearchText(n).includes(q)) {
      searchMatches.push(n); searchMatchIds.add(idOf(n));
      exactSearchStatus="";
    }
  }
  searchHighlightActive=searchMatches.length>0;
  if(searchMatches.length) searchMatchIndex=0;
  updateSearchUI(); scheduleDraw();
}

function updateSearchUI() {
  if($("#searchCount")) $("#searchCount").textContent=searchMatches.length?`${searchMatches.length} 个命中`:(exactSearchStatus||"无命中");
  if($("#searchPos")) $("#searchPos").textContent=searchMatches.length?`${searchMatchIndex+1}/${searchMatches.length}`:"0/0";
}

function stepSearch(delta) {
  if(!searchMatches.length) return;
  searchMatchIndex=(searchMatchIndex+delta+searchMatches.length)%searchMatches.length;
  focusNode(searchMatches[searchMatchIndex],.17); updateSearchUI();
}

function nodeSearchText(n) {
  const enName = String(n.name || "");
  const zhName = zhNameOf(n);
  const enStats = n.stats || [];
  const zhStats = i18n.ready ? enStats.map(stat=>translateStatRaw(stat,n)) : [];
  return [idOf(n), enName, zhName, ...enStats, ...zhStats]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}



function parseNumericStatLine(raw){
  const en=cleanStatDisplay(raw), nums=[...en.matchAll(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g)];
  if(nums.length!==1)return null; const m=nums[0],v=Number(m[0]); if(!Number.isFinite(v))return null;
  return {template:en.slice(0,m.index)+"#"+en.slice(m.index+m[0].length),value:v};
}
function aggregateStatsFromIds(ids){
  const numeric=new Map(),exact=new Map();
  for(const id of ids){const n=byId.get(String(id)); if(!n)continue; for(const stat of n.stats||[]){
    const p=parseNumericStatLine(stat); if(p){const r=numeric.get(p.template)||{sum:0,rows:[]};r.sum+=p.value;r.rows.push({node:n,stat});numeric.set(p.template,r);}
    else {const k=cleanStatDisplay(stat),r=exact.get(k)||{count:0,node:n};r.count+=1;exact.set(k,r);}
  }}
  const rows=[];
  for(const [tpl,r] of numeric){const num=Number.isInteger(r.sum)?String(r.sum):String(Math.round(r.sum*100)/100),single=r.rows.length===1?r.rows[0]:null;rows.push({text:single?displayStat(single.stat,languageMode,single.node):displayStat(tpl.replace("#",num)),sort:Math.abs(r.sum)});}
  for(const [k,r] of exact) rows.push({text:displayStat(k,languageMode,r.node)+(r.count>1?` ×${r.count}`:""),sort:0});
  return rows.sort((a,b)=>b.sort-a.sort||a.text.localeCompare(b.text));
}
function idsForBuildView(mode){const out=new Set(allocated);if(mode==="ws1")for(const id of weaponSet1Allocated)out.add(id);if(mode==="ws2")for(const id of weaponSet2Allocated)out.add(id);return out;}
function renderStatSummary(){
  const box=$("#statSummary"); if(!box)return; box.innerHTML="";
  const groups=[["通用",new Set(allocated)],["武器组 I",idsForBuildView("ws1")],["武器组 II",idsForBuildView("ws2")],["升华",new Set(ascAllocated)]];
  for(const [name,ids] of groups){const sec=document.createElement("div");sec.className="summary-group";const h=document.createElement("div");h.className="summary-title";h.textContent=name;sec.append(h);const rows=aggregateStatsFromIds(ids).slice(0,16);if(!rows.length){const e=document.createElement("div");e.className="note";e.textContent="暂无可汇总属性";sec.append(e);}else for(const r of rows){const d=document.createElement("div");d.className="summary-stat";d.textContent=r.text;sec.append(d);}box.append(sec);}
}
function previewGainRows(){return aggregateStatsFromIds(isAsc(hovered)?ascPreviewIds:previewIds).slice(0,6);}
function renderPathGainText(){const rows=previewGainRows();return rows.length?" · 路径收益："+rows.map(r=>r.text).join("；"):"";}
function treeAffectingAscendancyInfo(){
  const out=[];for(const id of ascAllocated){const n=byId.get(id);if(!n)continue;const t=[n.name,...(n.stats||[])].join(" ").toLowerCase();if(/passive|jewel|radius|allocate|tree|path/.test(t))out.push(n);}return out;
}
function updateAscTreeEffectsPanel(){const el=$("#ascTreeEffects");if(!el)return;const items=treeAffectingAscendancyInfo();if(!selectedAscendancyId){el.textContent="选择升华后检查其是否改变被动树规则。";return;}if(!items.length){el.textContent="当前已点升华中未检测到直接改变被动树、节点分配或珠宝半径的描述。";return;}el.innerHTML=items.map(n=>`<div class="asc-tree-effect"><b>${escapeHtml(displayNodeName(n))}</b><br>${(n.stats||[]).map(s=>escapeHtml(displayStat(s))).join("<br>")}</div>`).join("");}
function updateCoveragePanel(){const el=$("#coveragePanel");if(!el)return;const np=lastCoverage.totalNames?Math.round(lastCoverage.names/lastCoverage.totalNames*100):0,sp=lastCoverage.totalStats?Math.round(lastCoverage.stats/lastCoverage.totalStats*100):0;el.innerHTML=`<div>节点名称实例：<b>${lastCoverage.names}/${lastCoverage.totalNames}</b> (${np}%)</div><div>属性实例：<b>${lastCoverage.stats}/${lastCoverage.totalStats}</b> (${sp}%)</div><div>WeGame + PoB2 共识/显式复核：名称 <b>${lastCoverage.weGameNames}</b>，整条属性 <b>${lastCoverage.weGameStats}</b></div><div>英文保留：名称 <b>${lastCoverage.englishNames}</b>，属性 <b>${lastCoverage.englishStats}</b></div>`;}

function zhInstillName(en) {
  if(i18n.ready) {
    const z=i18n.passiveZh.get(en);
    if(z && z!==en) return z;
  }
  return INSTILL_NAME_ZH_FALLBACK[en]||"";
}

function displayInstillName(en, mode=languageMode) {
  const zh=zhInstillName(en);
  if(mode==="en") return en;
  if(mode==="bi") return zh&&zh!==en ? `${zh} / ${en}` : en;
  return zh||en;
}

function instillSearchText(rec) {
  const zhName=zhInstillName(rec.name);
  const zhStats=i18n.ready ? rec.stats.map(translateStatRaw) : [];
  return [
    rec.name, zhName,
    ...rec.stats.map(cleanStatDisplay),
    ...zhStats
  ].filter(Boolean).join(" ").toLowerCase();
}


function instillOverlayLayout() {
  if(!showInstillOnGraph) return null;

  const margin=18;
  const panelW=Math.min(500,Math.max(360,W*0.34));
  const panelH=Math.min(H-100,Math.max(430,Math.min(640,H*0.72)));
  const x=W-panelW-margin;
  const y=58;
  const cols=4;
  const rows=Math.ceil(INSTILL_EXCLUSIVE_PASSIVES.length/cols);
  const cellW=(panelW-36)/cols;
  const cellH=(panelH-82)/rows;

  const items=INSTILL_EXCLUSIVE_PASSIVES.map((rec,i)=>{
    const col=i%cols;
    const row=Math.floor(i/cols);
    return {
      rec,
      x:x+18+cellW*(col+.5),
      y:y+68+cellH*(row+.42),
      r:Math.max(18,Math.min(27,cellW*.24))
    };
  });

  return {x,y,w:panelW,h:panelH,items};
}

function drawInstillOverlay() {
  // v10: no fabricated overlay. Hidden/tree-external passives use their
  // canonical x/y positions from the tree data.
  instillOverlayHits=[];
}

function roundRect(ctx,x,y,w,h,r) {
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}

function nearestInstillOverlay(sx,sy) {
  return null;
}

function showInstillOverlayTip(ev,rec) {
  const r=wrap.getBoundingClientRect(), tip=$("#tip");
  delete tip.dataset.nodeId;
  tip.innerHTML="";

  const b=document.createElement("b");
  b.textContent=displayInstillName(rec.name);
  tip.append(b);

  if(languageMode==="bi") {
    const zh=zhInstillName(rec.name);
    if(zh && zh!==rec.name) {
      const en=document.createElement("div");
      en.className="bi-en";
      en.textContent=rec.name;
      tip.append(en);
    }
  }

  const meta=document.createElement("div");
  meta.textContent=`树外隐藏天赋 · ${instillAllocated.has(rec.name)?"已选择":"未选择"}`;
  tip.append(meta);

  for(const stat of rec.stats) {
    const line=document.createElement("div");
    line.style.marginTop="4px";
    line.style.whiteSpace="pre-line";

    const result=translateStatResult(stat);
    const zh=result.value;
    if(languageMode==="en") {
      line.textContent=cleanStatDisplay(stat);
    } else if(languageMode==="bi" && result.translated) {
      const z=document.createElement("div");
      z.textContent=zh;
      line.append(z);
      const e=document.createElement("div");
      e.className="bi-en";
      e.textContent=cleanStatDisplay(stat);
      line.append(e);
    } else {
      line.textContent=result.translated?zh:`${cleanStatDisplay(stat)}\n〔暂无可靠中文〕`;
    }
    tip.append(line);
  }

  const p=document.createElement("div");
  p.className="tip-plan";
  p.textContent=instillAllocated.has(rec.name)
    ? "点击：取消选择"
    : "点击：选择该隐藏天赋";
  tip.append(p);

  positionNodeTip(ev,tip,r);
}

function toggleInstillOverlaySelection(rec) {
  if(!rec) return;
  pushUndo();
  if(instillAllocated.has(rec.name)) instillAllocated.delete(rec.name);
  else instillAllocated.add(rec.name);
  renderInstillCatalog();
  updatePlannerUI(
    instillAllocated.has(rec.name)
      ? `已选择树外隐藏天赋：${displayInstillName(rec.name)}。`
      : `已取消树外隐藏天赋：${displayInstillName(rec.name)}。`
  );
  scheduleDraw();
}

function renderInstillCatalog() {
  const listEl=$("#instillList");
  const countEl=$("#instillCount");
  if(!listEl) return;

  const q=String(instillSearchQuery||"").trim().toLowerCase();
  const rows=INSTILL_EXCLUSIVE_PASSIVES.filter(rec=>!q || instillSearchText(rec).includes(q));

  listEl.innerHTML="";
  for(const rec of rows) {
    const selected=instillAllocated.has(rec.name);

    const card=document.createElement("button");
    card.type="button";
    card.className="instill-item"+(selected?" selected":"");
    card.dataset.instill=rec.name;

    const head=document.createElement("div");
    head.className="instill-head";

    const name=document.createElement("div");
    name.className="instill-name";
    name.textContent=displayInstillName(rec.name);
    head.append(name);

    const badge=document.createElement("span");
    badge.className="instill-badge";
    badge.textContent=selected?"已选择":"灌注专属";
    head.append(badge);
    card.append(head);

    if(languageMode==="bi") {
      const zh=zhInstillName(rec.name);
      if(zh && zh!==rec.name) {
        const en=document.createElement("div");
        en.className="bi-en";
        en.textContent=rec.name;
        card.append(en);
      }
    }

    for(const stat of rec.stats) {
      const line=document.createElement("div");
      line.className="instill-stat";

      const result=translateStatResult(stat);
      const zh=result.value;
      if(languageMode==="en") {
        line.textContent=cleanStatDisplay(stat);
      } else if(languageMode==="bi" && result.translated) {
        const z=document.createElement("div");
        z.textContent=zh;
        line.append(z);
        const e=document.createElement("div");
        e.className="bi-en";
        e.textContent=cleanStatDisplay(stat);
        line.append(e);
      } else {
        line.textContent=result.translated?zh:`${cleanStatDisplay(stat)}\n〔暂无可靠中文〕`;
      }
      card.append(line);
    }

    card.addEventListener("click",()=>{
      pushUndo();
      if(instillAllocated.has(rec.name)) instillAllocated.delete(rec.name);
      else instillAllocated.add(rec.name);
      renderInstillCatalog();
      updatePlannerUI(
        instillAllocated.has(rec.name)
          ? `已选择灌注专属天赋：${displayInstillName(rec.name)}。不消耗普通/升华点。`
          : `已取消灌注专属天赋：${displayInstillName(rec.name)}。`
      );
    });

    listEl.append(card);
  }

  if(!rows.length) {
    const empty=document.createElement("div");
    empty.className="note";
    empty.textContent="没有匹配的灌注专属天赋。";
    listEl.append(empty);
  }

  if(countEl) {
    const sourceText=officialHiddenSidecarReady
      ? `官方坐标 ${instillNativeNodeMap.size}/${INSTILL_EXCLUSIVE_PASSIVES.length}`
      : officialHiddenSidecarError
        ? `官方坐标加载失败`
        : `官方坐标加载中…`;
    countEl.textContent=`${instillAllocated.size} 已选择 · ${sourceText} · 列表 ${rows.length}`;
  }
}

function refreshLocalizedUI() {
  const prevClass=baseClassName || $("#classSelect")?.value || "";
  const prevAsc=selectedAscendancyId || $("#ascendancySelect")?.value || "";
  populateClassSelect();
  if(prevClass) $("#classSelect").value=prevClass;
  populateAscendancySelect(prevClass, prevAsc);
  if (selected) showNodeInfo(selected);
  if (hovered) updateHoverMessage(hovered);
  renderInstillCatalog();
  scheduleDraw();
}

async function loadChineseI18n(force = false) {
  if (i18nLoading) return;
  if (i18n.ready && !force) return;

  i18nLoading = true;
  const status = $("#i18nStatus");
  if (status) {
    status.className = "note i18n-loading";
    status.textContent = "正在加载并核验 WeGame 天赋整句与 PoB2 备用词典…";
  }

  try {
    const cacheMode=force ? "reload" : "default";
    const [pobResponse,officialOutcome,weGameOutcome] = await Promise.all([
      fetch(CN_TRANSLATION_URL,{cache:cacheMode}),
      fetch(OFFICIAL_TREE_URL,{cache:cacheMode})
        .then(async response=>{
          if(!response.ok) throw new Error(`official-data.json HTTP ${response.status}`);
          return {ok:true,value:await response.json()};
        })
        .catch(error=>({ok:false,error})),
      fetch(WEGAME_LOCALIZATION_URL,{cache:cacheMode})
        .then(async response=>{
          if(!response.ok) throw new Error(`WeGame localization HTTP ${response.status}`);
          return {ok:true,text:await response.text()};
        })
        .catch(error=>({ok:false,error}))
    ]);
    if (!pobResponse.ok) throw new Error(`ChineseTranslation.lua HTTP ${pobResponse.status}`);
    const parsed = localizationEngine.parsePobTranslation(await pobResponse.text());
    const officialTree=officialOutcome.ok ? officialOutcome.value : {nodes:{}};
    let weGame={nodes:{},classes:[],skillOverrides:{}};
    if(officialOutcome.ok && weGameOutcome.ok) {
      try { weGame=localizationEngine.parseWeGameModule(weGameOutcome.text); }
      catch(error) { console.warn("[i18n] WeGame candidate parse rejected; using PoB2 only",error); }
    }
    const overlay=localizationEngine.buildLocalization({officialTree,weGame,pob:parsed});

    i18n.passiveZh = parsed.passiveZh;
    i18n.classZh = parsed.classZh;
    i18n.statExactZh = parsed.statExactZh;
    i18n.statIndex = parsed.statIndex;
    i18n.nodeNames = overlay.names;
    i18n.nodeStats = overlay.stats;
    i18n.diagnostics = overlay.diagnostics;
    i18n.statTemplateCount = parsed.statTemplateCount;
    i18n.statCache = new Map();
    i18n.passiveCount = parsed.passiveZh.size;
    i18n.ready = true;

    const namedNodes=nodes.filter(n=>n.name);
    const nameResults=namedNodes.map(n=>localizationEngine.resolveNodeName({id:idOf(n),name:n.name},i18n.nodeNames,i18n.passiveZh));
    const statRows=nodes.flatMap(n=>(n.stats||[]).map(stat=>translateStatResult(stat,n)));
    const named=nameResults.filter(result=>result.translated).length;
    const statCovered=statRows.filter(result=>result.translated).length;
    lastCoverage={
      names:named,totalNames:namedNodes.length,stats:statCovered,totalStats:statRows.length,
      weGameNames:nameResults.filter(result=>result.source==="wegame").length,
      weGameStats:statRows.filter(result=>result.source==="wegame").length,
      englishNames:nameResults.filter(result=>!result.translated).length,
      englishStats:statRows.filter(result=>!result.translated).length
    };
    const allAsc=jump?.ascendancies||[];
    const ascTranslated=allAsc.filter(a=>Boolean(zhAscendancyName(a.name))).length;
    if(status){
      status.className="note i18n-ok";
      const candidateStatus=officialOutcome.ok && weGameOutcome.ok && overlay.diagnostics.acceptedWeGameNames
        ? "WeGame 固定快照已核验"
        : "WeGame 身份证据不可用，已安全回退 PoB2/英文";
      status.textContent=`${candidateStatus}；节点名称 ${named}/${lastCoverage.totalNames}，属性实例 ${statCovered}/${lastCoverage.totalStats}，升华 ${ascTranslated}/${allAsc.length}。`;
    }
    updateCoveragePanel();
    refreshLocalizedUI();
  } catch (err) {
    console.error("[i18n]", err);
    i18n.ready = false;
    if (status) {
      status.className = "note i18n-warn";
      status.textContent = `国服词典加载失败，已自动回退英文：${err?.message || String(err)}`;
    }
    scheduleDraw();
  } finally {
    i18nLoading = false;
  }
}


function instillFrameName(n) {
  if(!isInstillExclusiveNode(n)) return null;

  // Zarokh's Gift is an actual Sinister Jewel Socket display node.
  if(n.isJewelSocket) {
    if(tree?.atlas?.frames?.frames?.["JewelFrameUnallocated"]) return "JewelFrameUnallocated";
    return null;
  }

  const selected=instillAllocated.has(String(n.name||""));
  if(selected && tree?.atlas?.frames?.frames?.["BlightedNotableFrameAllocated"]) {
    return "BlightedNotableFrameAllocated";
  }
  if(tree?.atlas?.frames?.frames?.["BlightedNotableFrameUnallocated"]) {
    return "BlightedNotableFrameUnallocated";
  }

  return "NotableFrameUnallocated";
}


function firstExistingFrame(names) {
  const frames=tree?.atlas?.frames?.frames||{};
  for(const name of names) if(name && frames[name]) return name;
  return null;
}

function nodeVisualState(n) {
  const id=idOf(n);
  if(isAsc(n)) return ascAllocated.has(id) ? "allocated" : ascPreviewIds.has(id) ? "can" : "unallocated";
  if(allocated.has(id) || weaponSet1Allocated.has(id) || weaponSet2Allocated.has(id)) return "allocated";
  if(previewIds.has(id)) return "can";
  if(isHiddenConditional(n) && hiddenNodeLocked(n)) return "locked";
  return "unallocated";
}

function frameName(n) {
  const hiddenFrame=instillFrameName(n);
  if(hiddenFrame) return hiddenFrame;

  const state=nodeVisualState(n);
  const suffix=state==="allocated"?"Allocated":state==="can"?"CanAllocate":"Unallocated";

  if(isHiddenConditional(n)) {
    return firstExistingFrame([
      `OracleFrame${suffix}`,
      "OracleFrameUnallocated",
      kind(n)==="notable"?`NotableFrame${suffix}`:"PSSkillFrame"
    ]);
  }

  switch (kind(n)) {
    case "keystone":
      return firstExistingFrame([`KeystoneFrame${suffix}`,"KeystoneFrameUnallocated"]);
    case "notable":
      return n.asc
        ? firstExistingFrame([`AscendancyFrameNotable${suffix}`,"AscendancyFrameNotableUnallocated"])
        : firstExistingFrame([`NotableFrame${suffix}`,"NotableFrameUnallocated"]);
    case "jewel":
      return firstExistingFrame([`JewelFrame${suffix}`,"JewelFrameUnallocated"]);
    case "ascstart":
      return firstExistingFrame(["AscendancyStartNode"]);
    case "asc":
      return firstExistingFrame([`AscendancyFrameNormal${suffix}`,"AscendancyFrameNormalUnallocated"]);
    case "small":
      return firstExistingFrame([
        state==="allocated"?"PSSkillFrameActive":null,
        state==="can"?"PSSkillFrameHighlighted":null,
        "PSSkillFrame"
      ]);
    case "classstart":
      return null;
    default:
      return null;
  }
}

function frameSize(n) {
  const name = frameName(n);
  const f = name && tree?.atlas?.frames?.frames?.[name];
  if (f) return [f[2]*2, f[3]*2];
  if (kind(n)==="mastery") return [180,180];
  if (kind(n)==="classstart") return [320,320];
  return [100,100];
}

function iconSize(n, fw, fh) {
  if (kind(n)==="keystone" || kind(n)==="notable") return [fw*.62, fh*.62];
  if (kind(n)==="ascstart") return [fw*.85, fh*.85];
  if (kind(n)==="small") return [fw*.65, fh*.65];
  if (kind(n)==="asc") return [fw*.55, fh*.55];
  if (kind(n)==="jewel") return [fw*.5, fh*.5];
  return [fw*.6, fh*.6];
}

function visibleNode(n) {
  if (isAsc(n)) return false;
  if (isMasteryVisual(n)) return false;

  // Legacy / presentation-only class-start artifacts are not passive nodes.
  if (isLegacyStartArtifact(n)) return false;

  // These passives have canonical display coordinates, but are not part of
  // the normal allocatable path graph.
  if (isInstillExclusiveNode(n) && !instillNodeVisible(n)) return false;

  if (!showSmall && kind(n)==="small") return false;
  if (!conditionalNodeVisible(n)) return false;
  return true;
}



function addSpatial(n) {
  const cx = Math.floor(n.x/CELL), cy=Math.floor(n.y/CELL);
  const k = `${cx},${cy}`;
  if (!spatial.has(k)) spatial.set(k,[]);
  spatial.get(k).push(idOf(n));
}

function querySpatial(minX,minY,maxX,maxY) {
  const set = new Set();
  const x0=Math.floor(minX/CELL), x1=Math.floor(maxX/CELL);
  const y0=Math.floor(minY/CELL), y1=Math.floor(maxY/CELL);
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) {
    const arr=spatial.get(`${x},${y}`);
    if(arr) for(const id of arr) set.add(id);
  }
  return set;
}

function worldBounds(padPx=120) {
  return {
    minX: camera.x - (W/2+padPx)/camera.scale,
    maxX: camera.x + (W/2+padPx)/camera.scale,
    minY: camera.y - (H/2+padPx)/camera.scale,
    maxY: camera.y + (H/2+padPx)/camera.scale
  };
}

function intersects(e,b) {
  return !(e.maxX<b.minX || e.minX>b.maxX || e.maxY<b.minY || e.minY>b.maxY);
}

function prepareEdges() {
  renderEdges = [];
  for(const e of edges) {
    if(e.f==="root") continue;
    const a=byId.get(String(e.f)), b=byId.get(String(e.t));
    if(!a||!b) continue;
    if(Math.hypot(a.x-b.x,a.y-b.y)>3000) continue;
    const rec={...e,a,b};
    if(Number.isFinite(e.ox)&&Number.isFinite(e.oy)) {
      const r=Math.hypot(a.x-e.ox,a.y-e.oy);
      rec.radius=r;
      rec.minX=e.ox-r; rec.maxX=e.ox+r;
      rec.minY=e.oy-r; rec.maxY=e.oy+r;
    } else {
      rec.minX=Math.min(a.x,b.x); rec.maxX=Math.max(a.x,b.x);
      rec.minY=Math.min(a.y,b.y); rec.maxY=Math.max(a.y,b.y);
    }
    renderEdges.push(rec);
  }
}

function resize() {
  const r=wrap.getBoundingClientRect();
  W=Math.max(1,Math.floor(r.width));
  H=Math.max(1,Math.floor(r.height));
  DPR=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(W*DPR);
  canvas.height=Math.round(H*DPR);
  canvas.style.width=W+"px";
  canvas.style.height=H+"px";
  scheduleDraw();
}

function fit() {
  if(!nodes.length) return;
  const list=nodes.filter(n=>!isAsc(n)&&visibleNode(n)&&Number.isFinite(n.x)&&Number.isFinite(n.y));
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of list) {
    minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x); maxY=Math.max(maxY,n.y);
  }
  camera.x=(minX+maxX)/2;
  camera.y=(minY+maxY)/2;
  camera.scale=Math.max(.008,Math.min((W-50)/(maxX-minX),(H-50)/(maxY-minY)));
  scheduleDraw();
}

function focusNode(n, scale=.19) {
  // If search lands on an ascendancy node, activate that exact ascendancy first.
  if(isAsc(n) && n.asc && n.asc!==selectedAscendancyId) {
    const cls=ascPrefix(n.asc);
    if(cls && classOptions.some(c=>c.name===cls)) {
      baseClassName=cls;
      $("#classSelect").value=cls;
      populateAscendancySelect(cls,n.asc);
    }
    selectedAscendancyId=n.asc;
    showAsc=true;
    $("#asc").checked=true;
    $("#asc").disabled=false;
    recomputeAscDisplayDelta();
    ensureClassPortrait();
  }

  const p=displayPosition(n);
  camera.x=p.x;
  camera.y=p.y;
  camera.scale=Math.max(camera.scale,scale);
  selected=n;
  showNodeInfo(n);
  scheduleDraw();
}

function setWorldTransform() {
  ctx.setTransform(
    DPR*camera.scale,0,0,DPR*camera.scale,
    DPR*(W/2-camera.x*camera.scale),
    DPR*(H/2-camera.y*camera.scale)
  );
}

function resetTransform() {
  ctx.setTransform(DPR,0,0,DPR,0,0);
}

function drawEdgeGeometry(e) {
  ctx.moveTo(e.a.x,e.a.y);
  if(Number.isFinite(e.ox)&&Number.isFinite(e.oy)) {
    const r=e.radius ?? Math.hypot(e.a.x-e.ox,e.a.y-e.oy);
    const aa=Math.atan2(e.a.y-e.oy,e.a.x-e.ox);
    const ab=Math.atan2(e.b.y-e.oy,e.b.x-e.ox);
    let delta=ab-aa;
    while(delta>Math.PI) delta-=Math.PI*2;
    while(delta<=-Math.PI) delta+=Math.PI*2;
    ctx.arc(e.ox,e.oy,r,aa,aa+delta,delta<0);
  } else {
    ctx.lineTo(e.b.x,e.b.y);
  }
}

function drawEdges(visibleEdgeList) {
  const pxToWorld = 1/camera.scale;
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.setLineDash([]);

  // Dark underlay for visible normal tree.
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!mainDisplayEdge(e)) continue;
    drawEdgeGeometry(e);
  }
  ctx.strokeStyle = searchHighlightActive ? "rgba(12,12,12,.12)" : (styleMode==="graph" ? "rgba(10,12,14,.22)" : "rgba(14,11,7,.88)");
  ctx.lineWidth = 3.2*pxToWorld;
  ctx.stroke();

  // Ordinary unallocated connections (conditional/hidden paths are drawn blue below).
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!mainDisplayEdge(e) || hiddenDisplayEdge(e)) continue;
    const k=edgeKey(e.f,e.t);
    const aId=idOf(e.a), bId=idOf(e.b);
    if(previewEdgeKeys.has(k) || (allocated.has(aId)&&allocated.has(bId))) continue;
    drawEdgeGeometry(e);
  }
  ctx.strokeStyle = styleMode==="graph"
    ? `rgba(144,151,160,${Math.min(1,edgeOpacity*.85)})`
    : `rgba(132,105,61,${edgeOpacity})`;
  ctx.lineWidth = (styleMode==="graph" ? 1.05 : 1.3)*pxToWorld;
  ctx.stroke();

  // Revealed conditional / Oracle "Paths Not Taken" connections.
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!hiddenDisplayEdge(e)) continue;
    const k=edgeKey(e.f,e.t);
    const aId=idOf(e.a), bId=idOf(e.b);
    if(previewEdgeKeys.has(k) || (allocated.has(aId)&&allocated.has(bId))) continue;
    drawEdgeGeometry(e);
  }
  const anyLockedHidden=visibleEdgeList.some(e=>hiddenDisplayEdge(e) && (hiddenNodeLocked(e.a)||hiddenNodeLocked(e.b)));
  ctx.save();
  ctx.strokeStyle=anyLockedHidden ? "rgba(83,139,180,.42)" : "rgba(91,186,234,.88)";
  ctx.lineWidth=1.65*pxToWorld;
  ctx.setLineDash([5*pxToWorld,3*pxToWorld]);
  ctx.stroke();
  ctx.restore();

  // Shared/general allocated tree.
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!mainDisplayEdge(e)) continue;
    const aId=idOf(e.a), bId=idOf(e.b);
    if(allocated.has(aId)&&allocated.has(bId)) drawEdgeGeometry(e);
  }
  ctx.strokeStyle="rgba(215,164,73,.97)";
  ctx.lineWidth=2.35*pxToWorld;
  ctx.stroke();

  // Weapon Set I connections: active graph = general + WS-I.
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!mainDisplayEdge(e)) continue;
    const a=idOf(e.a), b=idOf(e.b);
    const activeA=allocated.has(a)||weaponSet1Allocated.has(a);
    const activeB=allocated.has(b)||weaponSet1Allocated.has(b);
    if(activeA&&activeB&&(weaponSet1Allocated.has(a)||weaponSet1Allocated.has(b))) drawEdgeGeometry(e);
  }
  ctx.strokeStyle="rgba(219,79,66,.96)";
  ctx.lineWidth=2.05*pxToWorld;
  ctx.stroke();

  // Weapon Set II connections.
  ctx.beginPath();
  for(const e of visibleEdgeList) {
    if(!mainDisplayEdge(e)) continue;
    const a=idOf(e.a), b=idOf(e.b);
    const activeA=allocated.has(a)||weaponSet2Allocated.has(a);
    const activeB=allocated.has(b)||weaponSet2Allocated.has(b);
    if(activeA&&activeB&&(weaponSet2Allocated.has(a)||weaponSet2Allocated.has(b))) drawEdgeGeometry(e);
  }
  ctx.strokeStyle="rgba(71,190,119,.96)";
  ctx.lineWidth=2.05*pxToWorld;
  ctx.stroke();

  // Hover path preview, colored by current allocation mode.
  if(previewEdgeKeys.size) {
    ctx.save();
    ctx.beginPath();
    for(const e of visibleEdgeList) {
      if(!mainDisplayEdge(e)) continue;
      if(previewEdgeKeys.has(edgeKey(e.f,e.t))) drawEdgeGeometry(e);
    }
    ctx.strokeStyle=weaponMode==="ws1"
      ? "rgba(255,132,116,.98)"
      : weaponMode==="ws2"
        ? "rgba(117,232,160,.98)"
        : "rgba(113,211,235,.98)";
    ctx.lineWidth=2.8*pxToWorld;
    ctx.setLineDash([8*pxToWorld,6*pxToWorld]);
    ctx.stroke();
    ctx.restore();
  }
}




function drawMasteryVisuals(b) {
  const list=nodes.filter(n=>
    isMasteryVisual(n) &&
    !isAsc(n) &&
    Number.isFinite(n.x) &&
    Number.isFinite(n.y) &&
    n.x>=b.minX && n.x<=b.maxX &&
    n.y>=b.minY && n.y<=b.maxY &&
    masteryTriggered(n)
  );
  if(!list.length) return;

  for(const n of list) {
    const activeFrame=masteryAtlasFrame(n);

    if(masteryEffectsReady && masteryEffectImg && activeFrame) {
      const f=activeFrame;

      // Keep the effect in WORLD coordinates so it scales with the tree,
      // but use a larger world footprint than v9.1. At zoom ~= 0.05 this
      // remains clearly visible instead of collapsing to a tiny 20-30px spot.
      const worldSize=244*5.2;

      ctx.save();

      // IMPORTANT: brightness is intentionally independent of zoom.
      // The user's issue was excessive SIZE, not excessive luminance.
      // v9.1 incorrectly faded the effect with zoomAlpha, making it look dead.
      ctx.globalAlpha=.82;

      ctx.drawImage(
        masteryEffectImg,
        f.x,f.y,f.w,f.h,
        n.x-worldSize/2,
        n.y-worldSize/2,
        worldSize,
        worldSize*(f.h/f.w)
      );
      ctx.restore();
      continue;
    }

    // Asset-safe fallback, also expressed entirely in WORLD units.
    // Larger footprint, unchanged brightness behaviour.
    const r=240;
    const glow=ctx.createRadialGradient(n.x,n.y,18,n.x,n.y,r);
    glow.addColorStop(0,"rgba(226,195,121,.30)");
    glow.addColorStop(.34,"rgba(177,137,74,.18)");
    glow.addColorStop(1,"rgba(124,91,39,0)");
    ctx.fillStyle=glow;
    ctx.beginPath();
    ctx.arc(n.x,n.y,r,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle="rgba(224,190,116,.38)";
    ctx.lineWidth=1.2/camera.scale;
    ctx.beginPath();
    ctx.arc(n.x,n.y,86,0,Math.PI*2);
    ctx.stroke();
  }
}

function drawAscendancyEdges(ascEdges) {
  if(!ascEdges.length) return;

  const pxToWorld=1/camera.scale;
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.setLineDash([]);

  ctx.beginPath();
  for(const e of ascEdges) drawEdgeGeometry(e);
  ctx.strokeStyle=styleMode==="graph"
    ? "rgba(10,12,14,.42)"
    : "rgba(13,8,15,.94)";
  ctx.lineWidth=3.2*pxToWorld;
  ctx.stroke();

  // Unallocated ascendancy connections.
  ctx.beginPath();
  for(const e of ascEdges) {
    const a=idOf(e.a), b=idOf(e.b), k=edgeKey(a,b);
    if(ascPreviewEdgeKeys.has(k) || (ascAllocated.has(a)&&ascAllocated.has(b))) continue;
    drawEdgeGeometry(e);
  }
  ctx.strokeStyle=styleMode==="graph"
    ? `rgba(159,148,167,${Math.min(1,edgeOpacity*.90)})`
    : `rgba(126,80,140,${Math.min(1,edgeOpacity*1.22)})`;
  ctx.lineWidth=(styleMode==="graph"?1.05:1.45)*pxToWorld;
  ctx.stroke();

  // Allocated ascendancy path.
  ctx.beginPath();
  for(const e of ascEdges) {
    const a=idOf(e.a), b=idOf(e.b);
    if(ascAllocated.has(a)&&ascAllocated.has(b)) drawEdgeGeometry(e);
  }
  ctx.strokeStyle="rgba(214,145,229,.98)";
  ctx.lineWidth=2.35*pxToWorld;
  ctx.stroke();

  // Hover preview for ascendancy.
  if(ascPreviewEdgeKeys.size) {
    ctx.save();
    ctx.beginPath();
    for(const e of ascEdges) {
      if(ascPreviewEdgeKeys.has(edgeKey(e.f,e.t))) drawEdgeGeometry(e);
    }
    ctx.strokeStyle="rgba(115,220,241,.98)";
    ctx.lineWidth=2.75*pxToWorld;
    ctx.setLineDash([8*pxToWorld,6*pxToWorld]);
    ctx.stroke();
    ctx.restore();
  }
}



function drawTranslatedAscendancy(lod) {
  if(!showAsc || !selectedAscendancyId) return;

  const ascNodes=selectedAscNodes();
  if(!ascNodes.length) return;

  const ascEdges=selectedAscEdges();

  ctx.save();
  // Critical: one translation in WORLD coordinates. No independent scaling.
  ctx.translate(ascDisplayDelta.dx,ascDisplayDelta.dy);

  drawAscendancyEdges(ascEdges);

  for(const n of ascNodes) {
    if(!showSmall && kind(n)==="small") continue;
    if(spritesReady) drawSpriteNode(n,lod);
    else drawFallbackNode(n,lod);
  }

  ctx.restore();
}

function nodeRingStyle(n,id) {
  if(isInstillExclusiveNode(n)) {
    if(instillAllocated.has(String(n.name||""))) {
      return {color:"rgba(91,195,235,.99)",width:3.0};
    }
    if(showInstillOnGraph) {
      return {color:"rgba(69,154,190,.88)",width:1.6};
    }
  }
  if(isAsc(n)) {
    if (ascAllocated.has(id)) return {color:"rgba(218,149,233,.99)",width:3.0};
    if (ascPreviewIds.has(id)) return {color:"rgba(113,211,235,.98)",width:2.7};
  } else {
    if (allocated.has(id)) return {color:"rgba(238,183,75,.98)",width:3.0};
    if (weaponSet1Allocated.has(id)&&weaponSet2Allocated.has(id)) return {color:"rgba(207,150,92,.98)",width:2.2};
    if (weaponSet1Allocated.has(id)) return {color:"rgba(225,91,75,.98)",width:2.2};
    if (weaponSet2Allocated.has(id)) return {color:"rgba(86,201,132,.98)",width:2.2};
    if (previewIds.has(id)) return {color:"rgba(113,211,235,.98)",width:2.7};
    if (isHiddenConditional(n) && constraintSatisfied(n)) return {color:"rgba(79,181,224,.90)",width:1.55};
  }
  if (selected===n) return {color:"rgba(245,225,177,.98)",width:2.2};
  return null;
}



function drawFallbackNode(n, lod) {
  if(isLegacyStartArtifact(n)) return;
  const k=kind(n);
  const locked=hiddenNodeLocked(n);
  ctx.save();
  if(searchHighlightActive && !searchMatchIds.has(idOf(n))) ctx.globalAlpha*=.18;
  if(locked) ctx.globalAlpha=.30;
  if(isInstillExclusiveNode(n) && !instillAllocated.has(String(n.name||""))) {
    ctx.globalAlpha=Math.min(ctx.globalAlpha,.60);
  }

  let r = k==="keystone"?7:k==="notable"?5:k==="jewel"?5:k==="classstart"?8:2.2;
  if(lod==="far" && k==="small") r=1.4;
  r*=nodeScale/camera.scale;

  ctx.beginPath();
  if(k==="keystone") {
    ctx.save(); ctx.translate(n.x,n.y); ctx.rotate(Math.PI/4); ctx.rect(-r,-r,r*2,r*2); ctx.restore();
  } else {
    ctx.arc(n.x,n.y,r,0,Math.PI*2);
  }

  const id=idOf(n);
  const alloc=nodeAllocated(n);
  const preview=isAsc(n)?ascPreviewIds.has(id):previewIds.has(id);
  ctx.fillStyle = alloc
    ? (isAsc(n) ? "rgba(73,35,83,.98)" : "rgba(92,62,19,.98)")
    : preview
      ? "rgba(22,71,83,.96)"
      : isHiddenConditional(n)
        ? "rgba(16,45,61,.96)"
        : styleMode==="graph" ? "rgba(30,33,38,.92)" : "rgba(25,22,17,.96)";
  ctx.fill();

  ctx.strokeStyle = isHiddenConditional(n)
    ? "rgba(79,181,224,.88)"
    : k==="keystone" ? "rgba(221,178,91,.95)"
    : k==="notable" ? "rgba(189,167,116,.95)"
    : "rgba(150,143,128,.72)";
  ctx.lineWidth = (k==="small"?0.8:1.4)/camera.scale;
  ctx.stroke();

  const ring=nodeRingStyle(n,id);
  if(ring) {
    ctx.beginPath();
    ctx.arc(n.x,n.y,r*1.55,0,Math.PI*2);
    ctx.strokeStyle=ring.color;
    ctx.lineWidth=ring.width/camera.scale;
    ctx.stroke();
  }
  ctx.restore();
}



function drawSpriteNode(n,lod) {
  if(isLegacyStartArtifact(n)) return;
  const locked=hiddenNodeLocked(n);
  ctx.save();
  if(searchHighlightActive && !searchMatchIds.has(idOf(n))) ctx.globalAlpha*=.18;
  if(locked) ctx.globalAlpha=.30;
  if(isInstillExclusiveNode(n) && !instillAllocated.has(String(n.name||""))) {
    ctx.globalAlpha=Math.min(ctx.globalAlpha,.60);
  }
  const [fw0,fh0]=frameSize(n);
  const fw=fw0*nodeScale, fh=fh0*nodeScale;

  // Keep real assets at every zoom. Only apply a mild alpha floor for tiny
  // screen sizes so icons remain legible instead of disappearing entirely.
  const screenSize=Math.max(fw,fh)*camera.scale;
  const tinyAlpha=Math.max(.72,Math.min(1,screenSize/18));
  ctx.globalAlpha*=tinyAlpha;
  const name=frameName(n);
  const fr=name && tree.atlas.frames.frames[name];

  if(isClassStart(n)) {
    // Class start is a graph anchor, not a passive skill icon.
    // Render a clean start marker instead of the raw placeholder sprite.
    const r=20;
    ctx.beginPath();
    ctx.arc(n.x,n.y,r,0,Math.PI*2);
    ctx.fillStyle="rgba(20,17,12,.84)";
    ctx.fill();
    ctx.strokeStyle="rgba(202,163,84,.72)";
    ctx.lineWidth=2.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(n.x,n.y,5.5,0,Math.PI*2);
    ctx.fillStyle="rgba(213,174,90,.78)";
    ctx.fill();
  } else if(showFrames && fr && framesImg) {
    ctx.drawImage(framesImg,fr[0],fr[1],fr[2],fr[3],n.x-fw/2,n.y-fh/2,fw,fh);
  } else {
    drawFallbackNode(n,lod);
  }

  const iconRec=n.icon && tree.atlas.skills.icons[n.icon];
  // Continuous icon scaling: never swap to a generic slot at low zoom.
  // The world transform already scales the sprite naturally with camera.scale.
  const allowIcon=showIcons && iconRec && skillsImg && !isClassStart(n);

  if(allowIcon) {
    const [iw,ih]=iconSize(n,fw,fh);
    ctx.drawImage(skillsImg,iconRec[1],iconRec[2],iconRec[3],iconRec[4],n.x-iw/2,n.y-ih/2,iw,ih);
  }

  const id=idOf(n);
  const ring=nodeRingStyle(n,id);
  if(ring) {
    const radius=Math.max(fw,fh)*.57;
    ctx.beginPath();
    ctx.arc(n.x,n.y,radius,0,Math.PI*2);
    ctx.strokeStyle=ring.color;
    ctx.lineWidth=ring.width/camera.scale;
    ctx.stroke();
  }

  if(!isClassStart(n)) {
    drawWeaponSetRings(n,Math.max(fw,fh)*.57);
  }

  if(searchHighlightActive && searchMatchIds.has(idOf(n))) {
    const rr=Math.max(fw,fh)*.70;
    ctx.beginPath();ctx.arc(n.x,n.y,rr,0,Math.PI*2);
    ctx.strokeStyle="rgba(94,221,255,.98)";ctx.lineWidth=2.6/camera.scale;ctx.stroke();
  }

  if(shouldDrawNodeLabel(n,lod)) {
    const fontSize=12/camera.scale;
    ctx.font=`600 ${fontSize}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Segoe UI",sans-serif`;
    ctx.textAlign="center";
    ctx.textBaseline="bottom";
    ctx.lineWidth=3/camera.scale;
    ctx.strokeStyle="rgba(0,0,0,.88)";
    ctx.fillStyle="rgba(225,207,167,.95)";
    const label=String(canvasNodeName(n)||id).slice(0,40);
    ctx.strokeText(label,n.x,n.y-fh*.58);
    ctx.fillText(label,n.x,n.y-fh*.58);
  }
  ctx.restore();
}

function lodLevel() {
  // LOD is now used only for optional labels / minor detail decisions.
  // Node icon+frame rendering remains continuous at every zoom level.
  if(camera.scale<.045) return "far";
  if(camera.scale<.13) return "mid";
  return "near";
}

function shouldDrawNodeLabel(n,lod) {
  return showLabels && lod==="near" && kind(n)!=="notable"
    && (kind(n)==="keystone"||isInstillExclusiveNode(n)||(selected===n && !isClassStart(n)));
}

function draw() {
  rafPending=false;
  resetTransform();
  ctx.clearRect(0,0,W,H);

  const grad=ctx.createRadialGradient(W*.5,H*.5,30,W*.5,H*.5,Math.max(W,H)*.65);
  grad.addColorStop(0,styleMode==="graph"?"#11161c":"#201a10");
  grad.addColorStop(.55,"#08090b");
  grad.addColorStop(1,"#010102");
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  if(!tree) return;

  const lod=lodLevel();
  const b=worldBounds(160);
  const visibleSet=querySpatial(b.minX,b.minY,b.maxX,b.maxY);
  const visibleNodes=[];
  for(const id of visibleSet) {
    const n=byId.get(id);
    if(n && visibleNode(n)) visibleNodes.push(n);
  }
  const visibleEdgeList=renderEdges.filter(e=>mainDisplayEdge(e) && intersects(e,b));

  setWorldTransform();

  // Original renderer puts the selected class/ascendancy portrait at world origin.
  drawClassPortrait();

  drawEdges(visibleEdgeList);

  // Mastery graphics are cluster effects only; never clickable/passable.
  drawMasteryVisuals(b);

  for(const n of visibleNodes) {
    if(spritesReady) drawSpriteNode(n,lod);
    else drawFallbackNode(n,lod);
  }

  // Selected ascendancy uses the SAME world transform and SAME scale;
  // only its group gets translated so its own bbox center becomes (0, 0).
  drawTranslatedAscendancy(lod);

  resetTransform();

  drawInstillOverlay();

  const used=usedPoints();
  const ascUsed=usedAscPoints();
  const preview=isAsc(hovered)?ascPreviewCost():previewCost();
  const ascCount=(showAsc&&selectedAscendancyId)?selectedAscNodes().length:0;
  const masteryCount=nodes.filter(isMasteryVisual).length;
  const masteryActive=nodes.filter(n=>isMasteryVisual(n)&&masteryTriggered(n)).length;
  $("#count").textContent =
    `${nodes.length.toLocaleString()} raw · 总点 ${effectivePassivePointsUsed()}/${maxPoints} · I ${usedWeapon1Points()}/${maxWeaponPoints} · II ${usedWeapon2Points()}/${maxWeaponPoints} · 升华 ${ascUsed}/${maxAscPoints} · Mastery ${masteryActive}/${masteryCount}`;
  $("#zoom").textContent =
    `zoom ${camera.scale.toFixed(3)}× · ${lod.toUpperCase()} · sprite ${spritesReady?"OK":"fallback"}${preview>0?` · preview +${preview}`:""}`;
}

function scheduleDraw() {
  if(rafPending) return;
  rafPending=true;
  requestAnimationFrame(draw);
}

function screenToWorld(sx,sy) {
  return {x:camera.x+(sx-W/2)/camera.scale,y:camera.y+(sy-H/2)/camera.scale};
}

function nearestNode(sx,sy,maxPx=22) {
  const w=screenToWorld(sx,sy);
  const rr=maxPx/camera.scale;

  // Ascendancy is only tens of nodes; test translated display coordinates directly.
  if(showAsc && selectedAscendancyId) {
    let ascBest=null, ascD=rr;
    for(const n of selectedAscNodes()) {
      if(!showSmall && kind(n)==="small") continue;
      const p=displayPosition(n);
      const d=Math.hypot(p.x-w.x,p.y-w.y);
      if(d<ascD) {
        ascD=d;
        ascBest=n;
      }
    }
    if(ascBest) return ascBest;
  }

  const ids=querySpatial(w.x-rr,w.y-rr,w.x+rr,w.y+rr);
  let best=null,bd=rr;
  for(const id of ids) {
    const n=byId.get(id);
    if(!n || isAsc(n) || isMasteryVisual(n) || isClassStart(n) || isLegacyStartArtifact(n) || !visibleNode(n)) continue;
    const d=Math.hypot(n.x-w.x,n.y-w.y);
    if(d<bd){bd=d;best=n;}
  }
  return best;
}


function weaponSetForMode(mode=weaponMode) {
  if(mode==="ws1") return weaponSet1Allocated;
  if(mode==="ws2") return weaponSet2Allocated;
  return null;
}

function weaponSetLabel(mode=weaponMode) {
  return mode==="ws1" ? "武器组 I" : mode==="ws2" ? "武器组 II" : "通用";
}

function nodeWeaponState(id) {
  id=String(id);
  const g=allocated.has(id);
  const a=weaponSet1Allocated.has(id);
  const b=weaponSet2Allocated.has(id);
  if(g) return "general";
  if(a&&b) return "both";
  if(a) return "ws1";
  if(b) return "ws2";
  return "none";
}

function weaponSetEligible(n) {
  if(!n || isAsc(n) || isMasteryVisual(n) || isInstillExclusiveNode(n) || isLegacyStartArtifact(n)) return false;
  if(isClassStart(n)) return false;
  if(kind(n)==="keystone" || kind(n)==="jewel" || n.isJewelSocket===true) return false;
  return true;
}

function activeIdsForMode(mode=weaponMode) {
  if(mode==="general") return new Set(allocated);
  const out=new Set(allocated);
  for(const id of weaponSetForMode(mode)||[]) out.add(id);
  return out;
}

function usedWeapon1Points() { return weaponSet1Allocated.size; }
function usedWeapon2Points() { return weaponSet2Allocated.size; }

function effectivePassivePointsUsed() {
  // One passive point may be split into one WS-I and one WS-II allocation.
  return usedPoints() + Math.max(usedWeapon1Points(),usedWeapon2Points());
}

function remainingEffectivePoints() {
  return Math.max(0,maxPoints-effectivePassivePointsUsed());
}

function remainingWeaponCapacity(mode=weaponMode) {
  if(mode==="general") return 0;
  return Math.max(0,maxWeaponPoints-(weaponSetForMode(mode)?.size||0));
}

function pathFromActiveSet(targetId, mode=weaponMode) {
  return shortestEligiblePath(passiveGraph, {
    starts: activeIdsForMode(mode),
    targetId,
    isEligible: canTraverse,
  });
}

function weaponPathCost(path,mode=weaponMode) {
  const active=activeIdsForMode(mode);
  return path.filter(id=>!active.has(id) && id!==classStartId).length;
}

function pruneWeaponSet(mode) {
  const set=weaponSetForMode(mode);
  if(!set || !classStartId) return 0;

  const active=new Set(allocated);
  for(const id of set) active.add(id);

  const reachable=reachableEligibleIds(passiveGraph, {
    starts:[classStartId],
    isEligible:(n,id)=>active.has(id)&&canTraverse(n),
  });

  let removed=0;
  for(const id of [...set]) {
    if(!reachable.has(id)) {
      set.delete(id);
      removed++;
    }
  }
  return removed;
}

function drawWeaponSetRings(n,baseRadius) {
  if(isAsc(n) || isMasteryVisual(n) || isInstillExclusiveNode(n)) return;
  const id=idOf(n);
  const has1=weaponSet1Allocated.has(id);
  const has2=weaponSet2Allocated.has(id);
  if(!has1 && !has2) return;

  const px=1/camera.scale;
  if(has1) {
    ctx.beginPath();
    ctx.arc(n.x,n.y,baseRadius+4*px,0,Math.PI*2);
    ctx.strokeStyle="rgba(225,91,75,.98)";
    ctx.lineWidth=2.0*px;
    ctx.stroke();
  }
  if(has2) {
    ctx.beginPath();
    ctx.arc(n.x,n.y,baseRadius+(has1?8:4)*px,0,Math.PI*2);
    ctx.strokeStyle="rgba(86,201,132,.98)";
    ctx.lineWidth=2.0*px;
    ctx.stroke();
  }
}

function setWeaponMode(mode) {
  if(!["general","ws1","ws2"].includes(mode)) return;
  weaponMode=mode;
  clearPreviews();
  document.querySelectorAll("[data-weapon-mode]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.weaponMode===mode);
  });
  updatePlannerUI(`分配模式：${weaponSetLabel(mode)}`);
  scheduleDraw();
}

function usedPoints() {
  let used=0;
  for(const id of allocated) {
    if(id===classStartId) continue;
    const n=byId.get(id);
    if(!n || isAsc(n)) continue;
    used++;
  }
  return used;
}

function usedAscPoints() {
  let used=0;
  for(const id of ascAllocated) {
    if(id===ascStartId) continue;
    used++;
  }
  return used;
}

function remainingPoints() {
  return remainingEffectivePoints();
}

function remainingAscPoints() {
  return Math.max(0,maxAscPoints-usedAscPoints());
}

function conditionalStats() {
  const all=nodes.filter(isConditionalReveal);
  const list=all.filter(n=>{
    const uc=unlockConstraintOf(n);
    return !uc?.ascendancy || constraintAscendancyMatches(n);
  });
  const unlocked=list.filter(constraintSatisfied);
  const allocatedConditional=list.filter(n=>allocated.has(idOf(n)));
  return {
    total:list.length,
    unlocked:unlocked.length,
    allocated:allocatedConditional.length,
    allTotal:all.length
  };
}

function updateConditionalUI() {
  const el=$("#conditionalStatus");
  if(!el) return;
  const s=conditionalStats();
  el.textContent=s.total
    ? `当前升华条件显现：已解锁 ${s.unlocked} / ${s.total} · 已分配 ${s.allocated}`
    : (selectedAscendancyId
        ? `当前升华没有可预览的条件显现节点（全树共 ${s.allTotal} 个）`
        : `请先选择升华；全树共检测到 ${s.allTotal} 个条件显现节点`);
}



function updatePlannerUI(message="") {
  const generalUsed=usedPoints();
  const effectiveUsed=effectivePassivePointsUsed();
  const ascUsed=usedAscPoints();
  const ws1=usedWeapon1Points();
  const ws2=usedWeapon2Points();

  $("#pointsUsed").textContent=String(effectiveUsed);
  $("#pointsMax").textContent=String(maxPoints);
  $("#pointsRemain").textContent=String(Math.max(0,maxPoints-effectiveUsed));
  const split=document.querySelector("#pointSplit");
  if(split) split.textContent=`通用 ${generalUsed} · I ${ws1}/${maxWeaponPoints} · II ${ws2}/${maxWeaponPoints}`;

  $("#ascPointsUsed").textContent=String(ascUsed);
  $("#ascPointsMax").textContent=String(maxAscPoints);
  $("#ascPointsRemain").textContent=String(Math.max(0,maxAscPoints-ascUsed));

  $("#ws1Used").textContent=String(ws1);
  $("#ws2Used").textContent=String(ws2);
  $("#wsCap").textContent=String(maxWeaponPoints);
  $("#ws2Cap").textContent=String(maxWeaponPoints);
  $("#wsRemain").textContent=String(remainingWeaponCapacity());

  $("#undo").disabled=undoStack.length===0;
  $("#redo").disabled=redoStack.length===0;
  $("#resetBuild").disabled=!classStartId || (
    allocated.size<=1 &&
    ws1===0 &&
    ws2===0 &&
    ascUsed===0 &&
    instillAllocated.size===0 &&
    !buildPreservation
  );

  renderInstillCatalog();
  updateConditionalUI();
  renderStatSummary();
  updateAscTreeEffectsPanel();
  updateCoveragePanel();

  if(message) {
    $("#plannerMsg").textContent=message;
    $("#plannerMsg").classList.add("flash");
    setTimeout(()=>$("#plannerMsg").classList.remove("flash"),400);
  }
  scheduleDraw();
}

function rebuildPathIndex() {
  pathParent=(!classStartId||!allocated.size)
    ? new Map()
    : buildShortestPathIndex(passiveGraph,{starts:allocated,isEligible:canTraverse});
}

function pathToAllocated(targetId) {
  if(!classStartId) return [];
  return pathFromIndex(pathParent,targetId,nodes.length+1);
}

function findAscStartNode() {
  if(!selectedAscendancyId) return null;
  const list=selectedAscNodes();
  let start=list.find(n=>kind(n)==="ascstart" || n.isAscendancyStart===true);
  if(start) return start;

  // Fallback: pick the node nearest the cluster centre after translation.
  let best=null, bd=Infinity;
  for(const n of list) {
    const p=displayPosition(n);
    const d=Math.hypot(p.x,p.y);
    if(d<bd){bd=d;best=n;}
  }
  return best;
}

function resetAscAllocation() {
  ascAllocated=new Set();
  ascStartId=null;
  if(!selectedAscendancyId) {
    rebuildAscPathIndex();
    return;
  }
  const start=findAscStartNode();
  if(start) {
    ascStartId=idOf(start);
    ascAllocated.add(ascStartId);
  }
  rebuildAscPathIndex();
}

function rebuildAscPathIndex() {
  ascPathParent=(!selectedAscendancyId||!ascAllocated.size)
    ? new Map()
    : buildShortestPathIndex(passiveGraph,{starts:ascAllocated,isEligible:canTraverseAsc});
}

function ascPathToAllocated(targetId) {
  if(!selectedAscendancyId) return [];
  return pathFromIndex(ascPathParent,targetId,nodes.length+1);
}

function clearPreviews() {
  previewPath=[]; previewIds.clear(); previewEdgeKeys.clear();
  ascPreviewPath=[]; ascPreviewIds.clear(); ascPreviewEdgeKeys.clear();
}

function setNormalPreview(n) {
  const id=idOf(n);

  if(!classStartId) {
    updateHoverMessage(n,"请先选择职业。");
    return;
  }

  if(hiddenNodeLocked(n)) {
    updateHoverMessage(n);
    return;
  }

  if(weaponMode!=="general" && !weaponSetEligible(n) && !allocated.has(id)) {
    updateHoverMessage(n,"Keystone、珠宝插槽和职业起点不能分配为武器组专精。");
    return;
  }

  const active=activeIdsForMode(weaponMode);
  if(active.has(id)) {
    updateHoverMessage(n);
    return;
  }

  const path=pathFromActiveSet(id,weaponMode);
  if(!path.length) {
    updateHoverMessage(n,"不可从当前分配区域到达");
    return;
  }

  previewPath=path;
  for(const p of path) if(!active.has(p)) previewIds.add(p);
  for(let i=1;i<path.length;i++) previewEdgeKeys.add(edgeKey(path[i-1],path[i]));
  updateHoverMessage(n);
}

function setAscPreview(n) {
  const id=idOf(n);
  if(!selectedAscendancyId || n.asc!==selectedAscendancyId) {
    updateHoverMessage(n,"请先选择该升华职业。");
    return;
  }
  if(ascAllocated.has(id)) {
    updateHoverMessage(n);
    return;
  }

  const path=ascPathToAllocated(id);
  if(!path.length) {
    updateHoverMessage(n,"该升华节点无法从当前升华路径到达。");
    return;
  }

  ascPreviewPath=path;
  for(const p of path) if(!ascAllocated.has(p)) ascPreviewIds.add(p);
  for(let i=1;i<path.length;i++) ascPreviewEdgeKeys.add(edgeKey(path[i-1],path[i]));
  updateHoverMessage(n);
}

function setPreview(n) {
  clearPreviews();
  if(!n) {
    updateHoverMessage(null);
    scheduleDraw();
    return;
  }

  if(isAsc(n)) setAscPreview(n);
  else if(hiddenNodeLocked(n)) {
    updateHoverMessage(n);
  } else setNormalPreview(n);

  scheduleDraw();
}

function previewCost() {
  return weaponPathCost(previewPath,weaponMode);
}

function ascPreviewCost() {
  let cost=0;
  for(const id of ascPreviewIds) if(id!==ascStartId) cost++;
  return cost;
}

function updateHoverMessage(n,override="") {
  const el=$("#hoverPlan");
  if(!n) {
    el.textContent=classStartId
      ? "悬停普通或升华节点可预览最低成本路径。"
      : "请先选择职业。";
    return;
  }
  if(override) { el.textContent=override; return; }

  const id=idOf(n);

  if(isAsc(n)) {
    if(!selectedAscendancyId || n.asc!==selectedAscendancyId) {
      el.textContent="请先选择该升华职业。";
      return;
    }
    if(ascAllocated.has(id)) {
      if(id===ascStartId) el.textContent="升华起点不消耗升华点，也不能取消。";
      else el.textContent="已分配升华节点：点击取消，并检查升华连通性。";
      return;
    }
    const cost=ascPreviewCost();
    if(!ascPreviewPath.length) el.textContent="该升华节点当前不可到达。";
    else el.textContent=`升华最低新增 ${cost} 点 · 剩余 ${remainingAscPoints()} 点${cost>remainingAscPoints()?" · 点数不足":""}${renderPathGainText()}`;
    return;
  }

  if(isHiddenConditional(n) && hiddenNodeLocked(n)) {
    const req=hiddenRequirementNames(n);
    el.textContent=`条件显现天赋尚未解锁${req.length?` · 需要：${req.join(" + ")}`:""}`;
    return;
  }

  const state=nodeWeaponState(id);
  if(state!=="none") {
    if(id===classStartId) el.textContent="职业起点不可取消。";
    else if(state==="general") el.textContent="通用分配：两个武器组都生效。";
    else if(state==="both") el.textContent="该节点分别分配给武器组 I 与 II。";
    else el.textContent=`该节点已分配给${weaponSetLabel(state)}。`;
    return;
  }

  const cost=previewCost();
  if(!classStartId) el.textContent="请先选择职业。";
  else if(!previewPath.length) el.textContent="当前节点不可到达。";
  else if(weaponMode==="general") {
    el.textContent=`通用最低新增 ${cost} 点 · 总点池剩余 ${remainingEffectivePoints()}${cost>remainingEffectivePoints()?" · 点数不足":""}${renderPathGainText()}`;
  } else {
    const after=(weaponSetForMode(weaponMode)?.size||0)+cost;
    const effectiveAfter=usedPoints()+Math.max(
      weaponMode==="ws1"?after:usedWeapon1Points(),
      weaponMode==="ws2"?after:usedWeapon2Points()
    );
    const capOK=after<=maxWeaponPoints;
    const poolOK=effectiveAfter<=maxPoints;
    el.textContent=`${weaponSetLabel()}最低新增 ${cost} 点 · 专精剩余 ${remainingWeaponCapacity()} · 总点池剩余 ${remainingEffectivePoints()}${(!capOK||!poolOK)?" · 点数不足":""}${renderPathGainText()}`;
  }
}

function snapshot() {
  return {
    allocated:[...allocated],
    weaponSet1Allocated:[...weaponSet1Allocated],
    weaponSet2Allocated:[...weaponSet2Allocated],
    ascAllocated:[...ascAllocated],
    ascStartId,
    instillAllocated:[...instillAllocated]
  };
}

function restoreSnapshot(s) {
  allocated=new Set(s.allocated||[]);
  weaponSet1Allocated=new Set(s.weaponSet1Allocated||[]);
  weaponSet2Allocated=new Set(s.weaponSet2Allocated||[]);
  ascAllocated=new Set(s.ascAllocated||[]);
  ascStartId=s.ascStartId||null;
  instillAllocated=new Set(s.instillAllocated||[]);
  selected=null;
  hovered=null;
  clearPreviews();
  rebuildAscPathIndex();
  rebuildPathIndex();
  renderInstillCatalog();
  updatePlannerUI();
}

function pushUndo() {
  undoStack.push(snapshot());
  if(undoStack.length>100) undoStack.shift();
  redoStack=[];
}

function undo() {
  if(!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
}

function redo() {
  if(!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
}

function revalidateOrdinaryAllocated() {
  if(!classStartId) {
    allocated.clear();
    return;
  }

  // Remove conditional nodes whose prerequisites are no longer satisfied.
  let changed=true;
  while(changed) {
    changed=false;
    for(const id of [...allocated]) {
      if(id===classStartId) continue;
      const n=byId.get(id);
      if(n && isHiddenConditional(n) && !constraintSatisfied(n)) {
        allocated.delete(id);
        changed=true;
      }
    }
  }

  // Keep only the allocated component connected to class start.
  const reachable=reachableEligibleIds(passiveGraph,{
    starts:[classStartId],
    isEligible:(n,id)=>allocated.has(id)&&!isAsc(n),
  });
  allocated=reachable;
}

function allocateNormalTarget(n) {
  if(!classStartId) { updatePlannerUI("请先选择职业。"); return; }
  const id=idOf(n);

  if(hiddenNodeLocked(n)) {
    const req=hiddenRequirementNames(n);
    updatePlannerUI(`条件显现天赋尚未解锁${req.length?`：需要 ${req.join(" + ")}`:""}`);
    return;
  }

  if(weaponMode==="general") {
    if(allocated.has(id)) { refundNormalTarget(n); return; }

    const path=pathFromActiveSet(id,"general");
    if(!path.length) { updatePlannerUI("该节点无法从当前通用天赋树连通。"); return; }

    const active=activeIdsForMode("general");
    const newIds=path.filter(x=>!active.has(x));
    const cost=newIds.filter(x=>x!==classStartId).length;
    if(effectivePassivePointsUsed()+cost>maxPoints) {
      updatePlannerUI(`总天赋点不足：需要 ${cost}，剩余 ${remainingEffectivePoints()}。`);
      return;
    }

    pushUndo();
    for(const x of newIds) {
      allocated.add(x);
      // General allocation supersedes set-specific tags at the same node.
      weaponSet1Allocated.delete(x);
      weaponSet2Allocated.delete(x);
    }
    clearPreviews();
    rebuildPathIndex();
    updatePlannerUI(`通用天赋已分配 ${cost} 点。`);
    return;
  }

  allocateWeaponTarget(n,weaponMode);
}


function allocateWeaponTarget(n,mode) {
  const id=idOf(n);
  const set=weaponSetForMode(mode);
  if(!set) return;

  if(allocated.has(id)) {
    updatePlannerUI("该节点已经通用分配，无需再标记武器组。");
    return;
  }
  if(!weaponSetEligible(n)) {
    updatePlannerUI("Keystone、珠宝插槽和职业起点不能使用武器组专精点。");
    return;
  }
  if(set.has(id)) {
    refundWeaponTarget(n,mode);
    return;
  }

  const path=pathFromActiveSet(id,mode);
  if(!path.length) {
    updatePlannerUI(`该节点无法从${weaponSetLabel(mode)}当前树连通。`);
    return;
  }

  const active=activeIdsForMode(mode);
  const newIds=path.filter(x=>!active.has(x) && x!==classStartId);
  if(newIds.some(x=>!weaponSetEligible(byId.get(x)))) {
    updatePlannerUI("这条路径经过不能武器组专精的 Keystone / 珠宝插槽，请改用通用分配。");
    return;
  }

  const newCount=set.size+newIds.length;
  if(newCount>maxWeaponPoints) {
    updatePlannerUI(`${weaponSetLabel(mode)}专精容量不足：${newCount}/${maxWeaponPoints}。`);
    return;
  }

  const effectiveAfter=usedPoints()+Math.max(
    mode==="ws1"?newCount:weaponSet1Allocated.size,
    mode==="ws2"?newCount:weaponSet2Allocated.size
  );
  if(effectiveAfter>maxPoints) {
    updatePlannerUI(`总天赋点不足：分配后需要 ${effectiveAfter}/${maxPoints}。`);
    return;
  }

  pushUndo();
  for(const x of newIds) set.add(x);
  clearPreviews();
  updatePlannerUI(`${weaponSetLabel(mode)}已分配 ${newIds.length} 个专精节点。`);
}

function refundWeaponTarget(n,mode) {
  const id=idOf(n);
  const set=weaponSetForMode(mode);
  if(!set?.has(id)) return;

  pushUndo();
  set.delete(id);
  const removed=1+pruneWeaponSet(mode);
  clearPreviews();
  updatePlannerUI(`${weaponSetLabel(mode)}已退掉 ${removed} 个节点（含断连节点）。`);
}

function refundNormalTarget(n) {
  const id=idOf(n);
  if(id===classStartId) { updatePlannerUI("职业起点不能取消。"); return; }
  if(!allocated.has(id)) return;

  const dependents=hiddenDependentsOf(new Set([id]));
  if(dependents.length) {
    updatePlannerUI(`不能取消：条件显现天赋「${displayNodeName(dependents[0])}」仍依赖此节点。`);
    return;
  }

  const candidate=new Set(allocated);
  candidate.delete(id);

  const reachable=candidate.has(classStartId)
    ? reachableEligibleIds(passiveGraph,{starts:[classStartId],isEligible:(_n,x)=>candidate.has(x)})
    : new Set();

  const removedIds=new Set([...allocated].filter(x=>!reachable.has(x)));
  const blocked=hiddenDependentsOf(removedIds);
  if(blocked.length) {
    updatePlannerUI(`不能退点：会破坏已分配条件显现天赋「${displayNodeName(blocked[0])}」的前置条件。`);
    return;
  }

  pushUndo();
  const removed=allocated.size-reachable.size;
  allocated=reachable;
  const wsRemoved=pruneWeaponSet("ws1")+pruneWeaponSet("ws2");
  clearPreviews();
  rebuildPathIndex();
  updatePlannerUI(`通用天赋已取消 ${removed} 个节点${wsRemoved?`；另有 ${wsRemoved} 个武器组节点因断连被移除`:""}。`);
}

function allocateAscTarget(n) {
  if(!selectedAscendancyId || n.asc!==selectedAscendancyId) {
    updatePlannerUI("请先选择对应升华职业。");
    return;
  }

  const id=idOf(n);
  if(ascAllocated.has(id)) { refundAscTarget(n); return; }

  const path=ascPathToAllocated(id);
  if(!path.length) {
    updatePlannerUI("该节点无法从当前升华起点连通。");
    return;
  }

  const newIds=path.filter(x=>!ascAllocated.has(x));
  const cost=newIds.filter(x=>x!==ascStartId).length;
  if(cost>remainingAscPoints()) {
    updatePlannerUI(`升华点不足：需要 ${cost}，剩余 ${remainingAscPoints()}。`);
    return;
  }

  pushUndo();
  for(const x of newIds) ascAllocated.add(x);
  clearPreviews();
  rebuildAscPathIndex();

  // Allocating ascendancy passives can reveal conditional main-tree paths.
  rebuildPathIndex();
  updatePlannerUI(`升华已分配 ${cost} 点。`);
}

function refundAscTarget(n) {
  const id=idOf(n);
  if(id===ascStartId) {
    updatePlannerUI("升华起点不消耗点数，不能取消。");
    return;
  }
  if(!ascAllocated.has(id)) return;

  const candidate=new Set(ascAllocated);
  candidate.delete(id);

  const reachable=ascStartId&&candidate.has(ascStartId)
    ? reachableEligibleIds(passiveGraph,{starts:[ascStartId],isEligible:(n,x)=>candidate.has(x)&&canTraverseAsc(n)})
    : new Set();

  const removedIds=new Set([...ascAllocated].filter(x=>!reachable.has(x)));
  const blocked=hiddenDependentsOf(removedIds);
  if(blocked.length) {
    const names=blocked.slice(0,3).map(displayNodeName).join("、");
    updatePlannerUI(`不能取消该升华节点：普通树中的条件显现天赋「${names}」仍依赖它，请先退掉这些隐藏天赋。`);
    return;
  }

  pushUndo();
  const removed=ascAllocated.size-reachable.size;
  ascAllocated=reachable;
  clearPreviews();
  rebuildAscPathIndex();
  revalidateOrdinaryAllocated();
  rebuildPathIndex();
  updatePlannerUI(`升华已取消 ${removed} 个节点（含级联）。`);
}

function allocateTarget(n) {
  if(!n || isMasteryVisual(n)) return;

  if(isInstillExclusiveNode(n)) {
    const rec=INSTILL_EXCLUSIVE_PASSIVES.find(x=>x.name===n.name);
    if(rec) toggleInstillOverlaySelection(rec);
    return;
  }

  if(isAsc(n)) allocateAscTarget(n);
  else allocateNormalTarget(n);
}

function resetBuild() {
  if(!classStartId) return;
  pushUndo();
  allocated=new Set([classStartId]);
  weaponSet1Allocated=new Set();
  weaponSet2Allocated=new Set();
  resetAscAllocation();
  instillAllocated=new Set();
  buildPreservation=null;
  clearPreviews();
  rebuildPathIndex();
  updatePlannerUI("已重置普通天赋与当前升华加点。");
}



function nearestClassStart(x,y) {
  let best=null, bd=Infinity;
  for(const n of nodes) {
    if(kind(n)!=="classstart" || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const d=Math.hypot(n.x-x,n.y-y);
    if(d<bd){bd=d;best=n;}
  }
  return best;
}

function detectClasses() {
  if(!jump?.classes || !jump?.ascendancies) return [];
  const actualAsc=new Set(nodes.filter(n=>n.asc).map(n=>String(n.asc)));
  const prefixes=new Set(jump.ascendancies.filter(a=>actualAsc.has(a.id)).map(a=>ascPrefix(a.id)));
  const out=[];
  for(const name of BASE_CLASS_ORDER) {
    if(!prefixes.has(name)) continue;
    const j=jump.classes.find(c=>c.name===name);
    if(!j) continue;
    const start=nearestClassStart(j.x,j.y);
    if(!start) continue;
    out.push({name,id:idOf(start),x:j.x,y:j.y});
  }
  return out;
}

function populateClassSelect() {
  classOptions=detectClasses();
  const sel=$("#classSelect");
  const previous=baseClassName || sel.value || "";
  sel.innerHTML='<option value="">选择基础职业…</option>';
  classOptions.forEach(c=>{
    const o=document.createElement("option");
    o.value=c.name;
    o.textContent=displayClassName(c.name);
    sel.append(o);
  });
  if(previous && [...sel.options].some(o=>o.value===previous)) sel.value=previous;
  $("#classHint").textContent=classOptions.length
    ? `按 tree-jump + 实际升华节点识别到 ${classOptions.length} 个当前职业。共享起点职业会保留各自升华分支。`
    : "未识别到可用职业配置。";
}

function ascendanciesForClassName(className) {
  if(!className || !jump?.ascendancies) return [];
  const actualAsc=new Set(nodes.filter(n=>n.asc).map(n=>String(n.asc)));
  return jump.ascendancies
    .filter(a=>ascPrefix(a.id)===className && actualAsc.has(a.id))
    .slice()
    .sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
}

function populateAscendancySelect(className=baseClassName, preserveId=selectedAscendancyId) {
  const sel=$("#ascendancySelect");
  if(!sel) return;
  ascendancyOptions=ascendanciesForClassName(className);
  sel.innerHTML='<option value="">— 不选择升华 —</option>';
  for(const a of ascendancyOptions) {
    const o=document.createElement("option");
    o.value=a.id;
    o.textContent=displayAscendancyName(a.name);
    sel.append(o);
  }
  sel.disabled=!className || ascendancyOptions.length===0;
  const focusBtn=$("#focusAsc"); if(focusBtn) focusBtn.disabled=!preserveId;
  if(preserveId && ascendancyOptions.some(a=>a.id===preserveId)) sel.value=preserveId;
  else sel.value="";
  const hint=$("#ascHint");
  if(hint) hint.textContent=className
    ? `${displayClassName(className)}：${ascendancyOptions.length} 个当前数据中可用的升华分支。`
    : "先选择基础职业，再选择其对应升华。";
}

function focusAscendancy() {
  if(!selectedAscendancyId) return;
  recomputeAscDisplayDelta();

  const list=selectedAscNodes();
  if(!list.length) return;

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of list) {
    const p=displayPosition(n);
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  }

  camera.x=(minX+maxX)/2;
  camera.y=(minY+maxY)/2;
  camera.scale=Math.max(
    .05,
    Math.min(
      .45,
      Math.min(
        (W-120)/Math.max(1,maxX-minX),
        (H-120)/Math.max(1,maxY-minY)
      )
    )
  );
  scheduleDraw();
}

function selectAscendancy(id, doFocus=true) {
  const nextId=id||null;
  const changed=nextId!==selectedAscendancyId;

  selectedAscendancyId=nextId;
  showAsc=Boolean(selectedAscendancyId);
  $("#focusAsc").disabled=!selectedAscendancyId;

  const ascToggle=$("#asc");
  ascToggle.checked=showAsc;
  ascToggle.disabled=!selectedAscendancyId;

  recomputeAscDisplayDelta();
  ensureClassPortrait();

  if(changed) {
    ascAllocated=new Set();
    ascStartId=null;
    undoStack=[];
    redoStack=[];
    resetAscAllocation();
    revalidateOrdinaryAllocated();
    rebuildPathIndex();
    clearPreviews();
  } else {
    rebuildAscPathIndex();
  }

  if(selectedAscendancyId && doFocus) {
    camera.x=0;
    camera.y=0;
    scheduleDraw();
  }

  const entry=ascendancyOptions.find(a=>a.id===selectedAscendancyId);
  updatePlannerUI(entry
    ? `升华：${displayAscendancyName(entry.name)} · 升华起点已启用，可直接在中央升华树加点。`
    : "已取消升华选择。"
  );
}



function selectClass(name) {
  buildPreservation=null;
  baseClassName=name||null;
  // Invalidate the previous class portrait before any async load starts.
  if(classPortraitRenderedClass!==baseClassName) {
    classPortraitImg=null;
    classPortraitRenderedClass=null;
  }
  const opt=classOptions.find(c=>c.name===baseClassName);
  selectedAscendancyId=null;
  showAsc=false;
  ascAllocated=new Set();
  ascStartId=null;
  ascDisplayDelta={dx:0,dy:0,cx:0,cy:0};
  $("#asc").checked=false;
  $("#asc").disabled=true;
  populateAscendancySelect(baseClassName,null);
  ensureClassPortrait();

  if(!opt || !byId.has(opt.id)) {
    classStartId=null; allocated.clear(); rebuildPathIndex(); updatePlannerUI("未选择职业。"); return;
  }
  classStartId=opt.id;
  allocated=new Set([classStartId]);
  weaponSet1Allocated=new Set();
  weaponSet2Allocated=new Set();
  weaponMode="general";
  document.querySelectorAll("[data-weapon-mode]").forEach(btn=>btn.classList.toggle("active",btn.dataset.weaponMode==="general"));
  undoStack=[]; redoStack=[];
  clearPreviews();
  rebuildAscPathIndex();
  rebuildPathIndex();
  const n=byId.get(classStartId);
  focusNode(n,.13);
  updatePlannerUI(`职业：${displayClassName(baseClassName)}`);
}

function showNodeInfo(n) {
  selected=n;
  const id=idOf(n);
  const box=$("#nodeInfo");
  box.innerHTML="";

  const card=document.createElement("div");
  card.className="node-game-card";

  const enName=String(n.name||"(unnamed)");
  const zhName=zhNameOf(n);

  const head=document.createElement("div");
  head.className="node-game-head";

  const title=document.createElement("div");
  title.className="node-game-title";
  title.textContent=languageMode==="en" ? enName : (zhName||`${enName}（暂无可靠中文）`);
  head.append(title);

  const badge=document.createElement("span");
  badge.className="node-type-badge";
  badge.textContent=nodeTypeLabel(n);
  head.append(badge);
  card.append(head);

  if(languageMode==="bi" && zhName && zhName!==enName) {
    const sub=document.createElement("div");
    sub.className="bi-en";
    sub.textContent=enName;
    card.append(sub);
  }

  const status=document.createElement("div");
  status.className="node-status-line";

  if(isInstillExclusiveNode(n)) {
    status.textContent=instillAllocated.has(n.name)
      ? "已获得 · 固定展示位置 · 不消耗天赋点"
      : "未获得 · 树外来源 · 不消耗天赋点";
  } else if(isAsc(n)) {
    status.textContent=ascAllocated.has(id)
      ? "已分配 · 消耗升华点"
      : "未分配 · 使用升华点";
  } else {
    const ws=nodeWeaponState(id);
    status.textContent=ws==="general"
      ? "通用分配 · 两个武器组均生效"
      : ws==="ws1"
        ? "武器组 I 专精"
        : ws==="ws2"
          ? "武器组 II 专精"
          : ws==="both"
            ? "武器组 I + II 分别专精"
            : isHiddenConditional(n)&&hiddenNodeLocked(n)
              ? "尚未显现"
              : "未分配";
  }
  card.append(status);

  if(isHiddenConditional(n)) {
    const req=hiddenRequirementNames(n);
    const h=document.createElement("div");
    h.className="node-source-box";
    h.innerHTML=`<b>显现条件</b><br>${constraintSatisfied(n)?"✓ 已满足":"○ 尚未满足"}${req.length?`<br>${req.map(x=>"• "+escapeHtml(x)).join("<br>")}`:""}`;
    card.append(h);
  } else if(isInstillExclusiveNode(n)) {
    const source=document.createElement("div");
    source.className="node-source-box";
    source.innerHTML="<b>来源</b><br>树外隐藏 / 灌注专属；官方数据提供固定展示坐标，不进入普通天赋路径。";
    card.append(source);
  }

  const stats=document.createElement("div");
  stats.className="node-game-stats";
  for(const stat of (n.stats||[]).slice(0,12)) {
    const result=translateStatResult(stat,n);
    const zh=result.value;
    const line=document.createElement("div");
    line.className="node-stat-line";
    if(languageMode==="en") {
      line.textContent=cleanStatDisplay(stat);
    } else if(languageMode==="bi" && result.translated) {
      const z=document.createElement("div"); z.textContent=zh; line.append(z);
      const e=document.createElement("div"); e.className="bi-en"; e.textContent=cleanStatDisplay(stat); line.append(e);
    } else {
      line.textContent=result.translated ? zh : `${cleanStatDisplay(stat)}\n〔暂无可靠中文〕`;
    }
    stats.append(line);
  }
  if(!stats.children.length) {
    const empty=document.createElement("div");
    empty.className="muted";
    empty.textContent="无属性文本";
    stats.append(empty);
  }
  card.append(stats);

  const dev=document.createElement("details");
  dev.className="node-dev-details";
  const summary=document.createElement("summary");
  summary.textContent="开发信息";
  dev.append(summary);

  const devBody=document.createElement("div");
  devBody.className="node-dev-body";
  const devLines=[
    `ID: ${id}`,
    `kind: ${kind(n)}`,
    `group: ${n.group??"—"}`,
    `orbit: ${n.orbit??"—"}`,
    `degree: ${passiveGraph.neighbors(id).length}`,
    `x/y: ${Number.isFinite(n.x)?Math.round(n.x):"—"}, ${Number.isFinite(n.y)?Math.round(n.y):"—"}`,
    `weapon eligible: ${weaponSetEligible(n)?"yes":"no"}`
  ];
  devBody.textContent=devLines.join("\n");
  dev.append(devBody);
  card.append(dev);

  box.append(card);
}

function showTip(ev,n) {
  const r=wrap.getBoundingClientRect(), tip=$("#tip");
  const sameNode=tip.style.display==="block" && tip.dataset.nodeId===idOf(n);
  const scrollTop=sameNode ? tip.scrollTop : 0;
  tip.dataset.nodeId=idOf(n);
  if(!sameNode) {
    tip.dataset.anchorX=String(ev.clientX);
    tip.dataset.anchorY=String(ev.clientY);
  }
  tip.innerHTML="";

  const enName=String(n.name||"(unnamed)");
  const zhName=zhNameOf(n);
  const b=document.createElement("b");
  b.textContent=languageMode==="en" ? enName : (zhName||`${enName}（暂无可靠中文）`);
  tip.append(b);

  if(languageMode==="bi" && zhName && zhName!==enName) {
    const en=document.createElement("div");
    en.className="bi-en";
    en.textContent=enName;
    tip.append(en);
  }

  const d=document.createElement("div");
  const id=idOf(n);
  d.textContent=isInstillExclusiveNode(n)
    ? `树外隐藏天赋 · ID ${id} · ${instillAllocated.has(n.name)?"已获得":"未获得"}`
    : `${nodeTypeLabel(n)} · ID ${id} · ${nodeWeaponState(id)==="general"?"通用":nodeWeaponState(id)==="ws1"?"武器I":nodeWeaponState(id)==="ws2"?"武器II":nodeWeaponState(id)==="both"?"武器I+II":nodeAllocated(n)?"已分配":"未分配"}${isHiddenConditional(n)?(constraintSatisfied(n)?" · 条件已显现":" · 条件隐藏"):""}`;
  tip.append(d);

  for(const stat of n.stats||[]) {
    const result=translateStatResult(stat,n);
    const zh=result.value;
    const s=document.createElement("div");
    s.className="tip-stat";
    if(languageMode==="en") {
      s.textContent=cleanStatDisplay(stat);
    } else if(languageMode==="bi" && result.translated) {
      const z=document.createElement("div"); z.textContent=zh; s.append(z);
      const e=document.createElement("div"); e.className="bi-en"; e.textContent=cleanStatDisplay(stat); s.append(e);
    } else {
      s.textContent=result.translated ? zh : `${cleanStatDisplay(stat)}\n〔暂无可靠中文〕`;
    }
    tip.append(s);
  }

  const p=document.createElement("div");
  p.className="tip-plan";
  if(isInstillExclusiveNode(n)) {
    p.textContent=instillAllocated.has(n.name)
      ? "点击：取消该隐藏天赋"
      : "点击：模拟获得该隐藏天赋";
  } else if(isAsc(n)) {
    if(ascAllocated.has(id)) {
      p.textContent=id===ascStartId ? "升华起点（0 点）" : "点击：取消升华节点";
    } else {
      const path=ascPathToAllocated(id);
      const cost=path.filter(x=>!ascAllocated.has(x)&&x!==ascStartId).length;
      p.textContent=path.length ? `升华最低路径 +${cost} 点` : "升华路径不可到达";
    }
  } else if(isHiddenConditional(n) && hiddenNodeLocked(n)) {
    const req=hiddenRequirementNames(n);
    p.textContent=`条件显现 · 需要：${req.length?req.join(" + "):"前置条件"}`;
  } else if(allocated.has(id)) {
    p.textContent=id===classStartId ? "职业起点（0 点）" : "点击：级联取消普通天赋";
  } else if(classStartId) {
    const path=pathToAllocated(id);
    const cost=path.filter(x=>!allocated.has(x)&&x!==classStartId&&!isAsc(byId.get(x))).length;
    p.textContent=path.length ? `普通最低路径 +${cost} 点` : "普通路径不可到达";
  }
  if(p.textContent) tip.append(p);

  positionNodeTip({clientX:Number(tip.dataset.anchorX),clientY:Number(tip.dataset.anchorY)},tip,r);
  tip.scrollTop=scrollTop;
}

function positionNodeTip(ev,tip,r) {
  const width=Math.min(r.width,window.innerWidth-r.left);
  const height=Math.min(r.height,window.innerHeight-r.top);
  tip.style.maxWidth=Math.max(1,Math.min(330,width-16))+"px";
  tip.style.maxHeight=Math.max(1,height-16)+"px";
  tip.style.display="block";
  tip.style.left=Math.max(8,Math.min(width-tip.offsetWidth-8,ev.clientX-r.left+12))+"px";
  tip.style.top=Math.max(8,Math.min(height-tip.offsetHeight-8,ev.clientY-r.top+10))+"px";
}

function searchNode() {
  recomputeSearchMatches();
  if(searchMatches.length) focusNode(searchMatches[0]);
  else $("#nodeInfo").textContent=exactSearchStatus||"没有找到匹配节点。";
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

function loadImage(url) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("image load failed: "+url));
    img.src=url;
  });
}

function currentBuildRuntimeState() {
  return {
    baseClassName,
    classStartId,
    selectedAscendancyId,
    ascStartId,
    maxPoints,
    maxWeaponPoints,
    maxAscPoints,
    allocated:new Set(allocated),
    weaponSet1Allocated:new Set(weaponSet1Allocated),
    weaponSet2Allocated:new Set(weaponSet2Allocated),
    ascAllocated:new Set(ascAllocated),
    instillAllocated:new Set(instillAllocated),
    camera:{...camera},
    weaponMode,
    showAsc,
    showLockedConditional,
    showInstillOnGraph,
    preservation:buildPreservation
  };
}

function captureBuildTransactionState() {
  return {
    build:currentBuildRuntimeState(),
    transient:{
      selected,
      hovered,
      hoveredInstill,
      previewPath:[...previewPath],
      previewIds:new Set(previewIds),
      previewEdgeKeys:new Set(previewEdgeKeys),
      ascPreviewPath:[...ascPreviewPath],
      ascPreviewIds:new Set(ascPreviewIds),
      ascPreviewEdgeKeys:new Set(ascPreviewEdgeKeys),
      undoStack:[...undoStack],
      redoStack:[...redoStack]
    }
  };
}

function applyPlannerBuildState(next, clearTransient=true) {
  baseClassName=next.baseClassName;
  classStartId=next.classStartId;
  selectedAscendancyId=next.selectedAscendancyId;
  ascStartId=next.ascStartId;
  maxPoints=next.maxPoints;
  maxWeaponPoints=next.maxWeaponPoints;
  maxAscPoints=next.maxAscPoints;
  allocated=new Set(next.allocated);
  weaponSet1Allocated=new Set(next.weaponSet1Allocated);
  weaponSet2Allocated=new Set(next.weaponSet2Allocated);
  ascAllocated=new Set(next.ascAllocated);
  instillAllocated=new Set(next.instillAllocated);
  buildPreservation=next.preservation;

  if(Number.isFinite(next.camera.x)) camera.x=next.camera.x;
  if(Number.isFinite(next.camera.y)) camera.y=next.camera.y;
  if(Number.isFinite(next.camera.scale)) camera.scale=next.camera.scale;
  if(["general","ws1","ws2"].includes(next.weaponMode)) weaponMode=next.weaponMode;
  if(typeof next.showLockedConditional==="boolean") showLockedConditional=next.showLockedConditional;
  if(typeof next.showInstillOnGraph==="boolean") showInstillOnGraph=next.showInstillOnGraph;
  if(typeof next.showAsc==="boolean") showAsc=Boolean(selectedAscendancyId)&&next.showAsc;
  else showAsc=Boolean(selectedAscendancyId)&&showAsc;

  if(clearTransient) {
    selected=null;
    hovered=null;
    hoveredInstill=null;
    clearPreviews();
    undoStack=[];
    redoStack=[];
  }
}

function refreshBuildDependentState(message="") {
  populateClassSelect();
  $("#classSelect").value=baseClassName||"";
  populateAscendancySelect(baseClassName,selectedAscendancyId);
  recomputeAscDisplayDelta();
  rebuildAscPathIndex();
  rebuildPathIndex();
  $("#budget").value=String(maxPoints);
  $("#weaponBudget").value=String(maxWeaponPoints);
  $("#asc").checked=showAsc;
  $("#asc").disabled=!selectedAscendancyId;
  $("#showLockedConditional").checked=showLockedConditional;
  $("#showInstillOnGraph").checked=showInstillOnGraph;
  document.querySelectorAll("[data-weapon-mode]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.weaponMode===weaponMode);
  });
  $("#nodeInfo").textContent="点击节点后显示真实节点数据。";
  ensureClassPortrait();
  updatePlannerUI(message);
}

function restoreBuildTransactionState(previous) {
  applyPlannerBuildState(previous.build,false);
  const t=previous.transient;
  selected=t.selected;
  hovered=t.hovered;
  hoveredInstill=t.hoveredInstill;
  previewPath=t.previewPath;
  previewIds=t.previewIds;
  previewEdgeKeys=t.previewEdgeKeys;
  ascPreviewPath=t.ascPreviewPath;
  ascPreviewIds=t.ascPreviewIds;
  ascPreviewEdgeKeys=t.ascPreviewEdgeKeys;
  undoStack=t.undoStack;
  redoStack=t.redoStack;
  refreshBuildDependentState();
}

function ascendancyStartFor(ascendancyId) {
  if(!ascendancyId) return null;
  const list=nodes.filter(n=>n.asc===ascendancyId && Number.isFinite(n.x) && Number.isFinite(n.y));
  let start=list.find(n=>kind(n)==="ascstart" || n.isAscendancyStart===true);
  if(start) return idOf(start);
  if(!list.length) return null;
  const minX=Math.min(...list.map(n=>n.x));
  const maxX=Math.max(...list.map(n=>n.x));
  const minY=Math.min(...list.map(n=>n.y));
  const maxY=Math.max(...list.map(n=>n.y));
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  start=list.slice().sort((a,b)=>Math.hypot(a.x-cx,a.y-cy)-Math.hypot(b.x-cx,b.y-cy))[0];
  return start ? idOf(start) : null;
}

function buildCatalogs() {
  const classStartIds=new Map(classOptions.map(option=>[option.name,String(option.id)]));
  const ascendancyStartIds=new Map();
  for(const n of nodes) {
    if(!n.asc || ascendancyStartIds.has(n.asc)) continue;
    const start=ascendancyStartFor(n.asc);
    if(start) ascendancyStartIds.set(n.asc,start);
  }
  return {classStartIds,ascendancyStartIds};
}

function knownAscendancy(id,base) {
  return ascendanciesForClassName(base).some(entry=>entry.id===id);
}

function nodeAllowedForBuild(id,category,selectedAscendancyIdForFile,classStartForFile,ascStartForFile) {
  const node=byId.get(String(id));
  if(!node) return false;
  if(String(id)===classStartForFile || String(id)===ascStartForFile) return false;
  if(category==="ascendancy") return Boolean(selectedAscendancyIdForFile && node.asc===selectedAscendancyIdForFile);
  if(category==="weaponSet1" || category==="weaponSet2") return weaponSetEligible(node);
  return !isAsc(node) && !isMasteryVisual(node) && !isInstillExclusiveNode(node)
    && !isClassStart(node) && !isLegacyStartArtifact(node);
}

function decodeBuildForCurrentCatalogs(text) {
  const first=buildCodec.decodeBuildDocument(text,{
    knownBaseClasses:new Set(classOptions.map(option=>option.name)),
    knownAscendancies:knownAscendancy,
    knownInstilledPassives:INSTILL_EXCLUSIVE_NAME_SET
  });
  if(!first.ok) return first;
  const catalogs=buildCatalogs();
  const selectedAsc=first.value.build.class.ascendancyId;
  const classStart=catalogs.classStartIds.get(first.value.build.class.base)||null;
  const ascStart=catalogs.ascendancyStartIds.get(selectedAsc)||null;
  return buildCodec.decodeBuildDocument(text,{
    knownBaseClasses:new Set(classOptions.map(option=>option.name)),
    knownAscendancies:knownAscendancy,
    knownInstilledPassives:INSTILL_EXCLUSIVE_NAME_SET,
    knownNodeIds:(id,category)=>nodeAllowedForBuild(id,category,selectedAsc,classStart,ascStart)
  });
}

function showBuildFeedback(summary,diagnostics=null,isError=false) {
  const box=$("#buildFeedback");
  const list=$("#buildFeedbackDetails");
  box.hidden=false;
  box.open=Boolean(diagnostics && (diagnostics.fatalCount||diagnostics.warningCount));
  box.classList.toggle("error-state",isError);
  $("#buildFeedbackSummary").textContent=summary;
  list.replaceChildren();
  if(!diagnostics) return;
  for(const detail of [...diagnostics.fatals,...diagnostics.warnings].slice(0,100)) {
    const item=document.createElement("li");
    item.textContent=`${detail.path}: ${detail.message}`;
    list.append(item);
  }
}

function ipcErrorMessage(result,fallback) {
  return result?.error?.message || fallback;
}

function setWeGameStatus(message,isError=false) {
  const status=$("#weGameStatus");
  status.textContent=message;
  status.classList.toggle("wegame-error",isError);
}

function resetWeGameDialog() {
  weGamePreviewValue=null;
  $("#weGamePreview").hidden=true;
  $("#weGameApply").hidden=true;
  $("#weGameRead").hidden=false;
  $("#weGameRead").disabled=false;
  $("#weGameRead").textContent="读取预览";
  $("#weGamePartialAck").checked=false;
  $("#weGameOmissionAck").checked=false;
  $("#weGameReplaceAck").checked=false;
  setWeGameStatus("输入链接后读取预览；读取和取消都不会修改当前 Build。");
}

function openWeGameDialog() {
  if(!plannerDataReady || !window.desktopAPI?.importWeGamePassives) return;
  resetWeGameDialog();
  $("#weGameDialog").showModal();
  $("#weGameUrl").focus();
}

function closeWeGameDialog() {
  weGameRequestGate.invalidate();
  weGamePreviewValue=null;
  $("#weGameDialog").close();
}

function populateWeGameConfirmation(value) {
  const classSelect=$("#weGameClass");
  classSelect.replaceChildren();
  for(const entry of classOptions) {
    const option=document.createElement("option");
    option.value=entry.name;
    option.textContent=displayClassName(entry.name);
    classSelect.append(option);
  }
  const importedAsc=value.candidate.class.ascendancyId||"";
  const compatible=classOptions.find(entry=>ascendanciesForClassName(entry.name).some(a=>a.id===importedAsc));
  classSelect.value=compatible?.name||classOptions[0]?.name||"";
  const updateAsc=()=>{
    const ascSelect=$("#weGameAscendancy");
    ascSelect.replaceChildren();
    if(!importedAsc) {
      const option=document.createElement("option"); option.value=""; option.textContent="— 无升华证据 —"; ascSelect.append(option);
      return;
    }
    for(const entry of ascendanciesForClassName(classSelect.value)) {
      const option=document.createElement("option");
      option.value=entry.id; option.textContent=displayAscendancyName(entry.name);
      ascSelect.append(option);
    }
    ascSelect.value=importedAsc;
  };
  classSelect.onchange=()=>{ updateAsc(); $("#weGameOmissionAck").checked=false; renderWeGameApplicationAnalysis(value); };
  updateAsc();
}

function renderWeGameApplicationAnalysis(value) {
  const omissionBox=$("#weGameOmissions"), omissionList=$("#weGameOmissionList"), omissionAckRow=$("#weGameOmissionAckRow");
  omissionList.replaceChildren();
  let candidate;
  try {
    candidate=weGameImportUI.createPlannerCandidate(value,{
      baseClassName:$("#weGameClass").value,
      ascendancyId:$("#weGameAscendancy").value||null,
      partialImportAcknowledged:true
    },currentBuildRuntimeState(),weGamePlannerCatalog());
  } catch(error) {
    omissionBox.hidden=true; omissionAckRow.hidden=true;
    setWeGameStatus(`预览不能应用：${error.message}`,true);
    return;
  }
  for(const omission of candidate.weaponSetOmissions.slice(0,100)) {
    const item=document.createElement("li");
    const reason=omission.reason==="missing-from-planner" ? "当前 Planner 目录缺失" : "不符合武器专精资格";
    item.textContent=`${omission.sourceLabel} · 节点 ${omission.numericId} · ${reason}`;
    omissionList.append(item);
  }
  const omitted=candidate.weaponSetOmissions.length;
  omissionBox.hidden=omitted===0; omissionAckRow.hidden=omitted===0;
  $("#weGameOmissionSummary").textContent=`将省略 ${omitted} 个节点（明细最多 100 条）；实际应用：武器组 I ${candidate.counts.weaponSet1Applied}/${candidate.counts.weaponSet1}，武器组 II ${candidate.counts.weaponSet2Applied}/${candidate.counts.weaponSet2}`;
  const usage=weGameImportUI.summarizeApplicationBudget(candidate);
  const overTotal=Math.max(0,usage.effectivePassive-maxPoints);
  const overWeapon1=Math.max(0,usage.weaponSet1-maxWeaponPoints);
  const overWeapon2=Math.max(0,usage.weaponSet2-maxWeaponPoints);
  const overAsc=Math.max(0,usage.ascendancy-maxAscPoints);
  const budget=$("#weGameBudgetWarning");
  budget.hidden=false;
  budget.textContent=`保留当前预算。导入计费：通用 ${usage.general} + max(I ${usage.weaponSet1}, II ${usage.weaponSet2}) = 总天赋 ${usage.effectivePassive}/${maxPoints}；武器组容量 I ${usage.weaponSet1}/${maxWeaponPoints}、II ${usage.weaponSet2}/${maxWeaponPoints}；升华 ${usage.ascendancy}/${maxAscPoints}（免费起点不计）。${overTotal||overWeapon1||overWeapon2||overAsc ? `超限：总天赋 +${overTotal}、I +${overWeapon1}、II +${overWeapon2}、升华 +${overAsc}。` : "没有超限。"}`;
}

function renderWeGamePreview(value) {
  const counts=weGameImportUI.summarize(value);
  const countBox=$("#weGameCounts"); countBox.replaceChildren();
  for(const text of [`普通 ${counts.normal}`,`升华 ${counts.ascendancy}`,`普通插槽 ${counts.ordinarySockets}`]) {
    const item=document.createElement("span"); item.textContent=text; countBox.append(item);
  }
  $("#weGameSourceClass").textContent=`来源显示职业：${value.candidate.class.sourceDisplayName||"未提供"}；必须在下方确认实际基础职业和升华。`;
  populateWeGameConfirmation(value);
  $("#weGameInactiveWarning").textContent=`实验映射（请验证）：尝试将 set1 → 武器组 I（来源 ${counts.weaponSet1}），set2 → 武器组 II（来源 ${counts.weaponSet2}）。当前 Planner 缺失或不允许武器专精的节点会明确计数后省略。仍不会激活或保存：属性选择覆盖 ${counts.skillOverrides} 项、珠宝内容 ${counts.jewelData?"有":"无"}、未解析项 ${counts.unresolved}。`;
  renderWeGameApplicationAnalysis(value);
  const replace=weGameImportUI.isNonEmptyBuild(currentBuildRuntimeState());
  $("#weGameReplaceRow").hidden=!replace;
  const list=$("#weGameDiagnosticList"); list.replaceChildren();
  for(const detail of (value.diagnostics?.details||[]).slice(0,100)) {
    const item=document.createElement("li"); item.textContent=`${detail.code}: ${detail.message}`; list.append(item);
  }
  $("#weGameDiagnostics").hidden=list.childElementCount===0;
  $("#weGamePreview").hidden=false;
  $("#weGameApply").hidden=false;
  $("#weGameRead").hidden=true;
}

async function readWeGamePreview(event) {
  event.preventDefault();
  if(!window.desktopAPI?.importWeGamePassives) return;
  const request=weGameRequestGate.begin();
  const read=$("#weGameRead"); read.disabled=true; read.textContent="读取中…";
  setWeGameStatus("正在读取公开分享并校验官方天赋目录…");
  let result;
  try { result=await window.desktopAPI.importWeGamePassives($("#weGameUrl").value.trim()); }
  catch(error) { result={ok:false,error:{message:error?.message||"导入调用失败。"}}; }
  if(!weGameRequestGate.isCurrent(request) || !$("#weGameDialog").open) return;
  read.disabled=false; read.textContent="重试读取";
  if(!result?.ok) {
    setWeGameStatus(`读取失败：${ipcErrorMessage(result,"无法读取 WeGame 分享。")} 当前 Build 未改变。`,true);
    return;
  }
  try {
    weGamePreviewValue=result.value;
    renderWeGamePreview(result.value);
    setWeGameStatus("预览已读取。确认职业、局限和覆盖后才会替换当前 Build。");
  } catch(error) {
    weGamePreviewValue=null;
    setWeGameStatus(`预览无效：${error.message} 当前 Build 未改变。`,true);
  }
}

function weGamePlannerCatalog() {
  const normalIds=new Set(), ordinarySocketIds=new Set(), ascendancyIds=new Map();
  for(const node of nodes) {
    const id=idOf(node);
    if(node.asc) ascendancyIds.set(id,String(node.asc));
    else if(node.isJewelSocket===true || kind(node)==="jewel") ordinarySocketIds.add(id);
    else if(!isMasteryVisual(node) && !isInstillExclusiveNode(node) && !isClassStart(node) && !isLegacyStartArtifact(node)) normalIds.add(id);
  }
  const catalogs=buildCatalogs();
  return {
    ...catalogs,
    ascendanciesByClass:new Map(classOptions.map(entry=>[entry.name,new Set(ascendanciesForClassName(entry.name).map(a=>a.id))])),
    nodeIds:new Set(byId.keys()), normalIds, ordinarySocketIds, ascendancyIds,
    weaponEligibleIds:new Set(nodes.filter(weaponSetEligible).map(idOf))
  };
}

function applyWeGamePreview() {
  if(!weGamePreviewValue) return;
  const previous=currentBuildRuntimeState();
  if(weGameImportUI.isNonEmptyBuild(previous) && !$("#weGameReplaceAck").checked) {
    setWeGameStatus("当前 Build 非空，请明确确认覆盖。",true); return;
  }
  let candidate;
  try {
    candidate=weGameImportUI.createPlannerCandidate(weGamePreviewValue,{
      baseClassName:$("#weGameClass").value,
      ascendancyId:$("#weGameAscendancy").value||null,
      partialImportAcknowledged:$("#weGamePartialAck").checked
    },previous,weGamePlannerCatalog());
  } catch(error) { setWeGameStatus(`不能应用：${error.message}`,true); return; }
  if(candidate.weaponSetOmissions.length && !$("#weGameOmissionAck").checked) {
    setWeGameStatus("存在将被省略的武器组节点，请展开查看明细并明确确认。",true); return;
  }
  const applied=weGameImportUI.applyImportTransaction(candidate,{
    snapshot:captureBuildTransactionState,
    commit:next=>applyPlannerBuildState(next,true),
    finalize:()=>refreshBuildDependentState("WeGame 支持的天赋已导入，旧历史已清空。"),
    rollback:restoreBuildTransactionState
  },buildStateAdapter);
  if(!applied.ok) {
    if(applied.unsafe) {
      buildStateUnsafe=true; setBuildControlsReady(plannerDataReady);
      setWeGameStatus(`应用和回滚均失败，保存已禁用：${applied.rollbackError?.message||"未知错误"}`,true);
    } else setWeGameStatus(`应用失败，已恢复原 Build：${applied.error?.message||"未知错误"}`,true);
    return;
  }
  buildStateUnsafe=false; setBuildControlsReady(plannerDataReady);
  const counts=candidate.counts;
  closeWeGameDialog();
  const omissionDiagnostics=candidate.weaponSetOmissions.length ? {
    fatalCount:0,warningCount:candidate.weaponSetOmissions.length,fatals:[],
    warnings:candidate.weaponSetOmissions.slice(0,100).map(item=>({path:`${item.sourceLabel}.${item.numericId}`,message:item.reason}))
  } : null;
  showBuildFeedback(`WeGame 天赋已导入：普通 ${counts.normal}、升华 ${counts.ascendancy}、普通插槽 ${counts.ordinarySockets}、武器组 I ${counts.weaponSet1Applied}/${counts.weaponSet1}、武器组 II ${counts.weaponSet2Applied}/${counts.weaponSet2}；明确省略 ${counts.weaponSetOmitted} 个当前 Planner 缺失或不符合武器专精资格的来源节点。未支持内容未写入 Build。`,omissionDiagnostics,false);
}

async function saveCurrentBuild() {
  if(!plannerDataReady || !window.desktopAPI?.saveBuildJson) return;
  if(!weGameImportUI.canSaveBuild({ready:plannerDataReady,supported:Boolean(window.desktopAPI?.saveBuildJson),unsafe:buildStateUnsafe})) {
    showBuildFeedback("当前 Build 状态可能不一致，保存已禁用。请重启应用或重新打开 Build。",null,true);
    setBuildControlsReady(plannerDataReady);
    return;
  }
  try {
    const value=buildStateAdapter.extractBuildValue(currentBuildRuntimeState());
    const text=buildCodec.serializeBuildDocument(value,buildPreservation);
    const suggestedName=`${baseClassName||"PoE2"}-Build.json`;
    const result=await window.desktopAPI.saveBuildJson({text,suggestedName});
    if(result?.canceled) {
      showBuildFeedback("已取消保存。",null,false);
      return;
    }
    if(!result?.ok) {
      showBuildFeedback(`保存失败：${ipcErrorMessage(result,"无法写入 Build 文件。")}`,null,true);
      return;
    }
    showBuildFeedback(`Build 已保存：${result.filePath}`,null,false);
  } catch(error) {
    showBuildFeedback(`保存失败：${error?.message||"Build 序列化失败。"}`,null,true);
  }
}

async function openBuild() {
  if(!plannerDataReady || !window.desktopAPI?.openBuildJson) return;
  let result;
  try {
    result=await window.desktopAPI.openBuildJson();
  } catch(error) {
    showBuildFeedback(`打开失败：${error?.message||"Build IPC 调用失败。"}`,null,true);
    return;
  }
  if(result?.canceled) {
    showBuildFeedback("已取消打开。",null,false);
    return;
  }
  if(!result?.ok) {
    showBuildFeedback(`打开失败：${ipcErrorMessage(result,"无法读取 Build 文件。")}`,null,true);
    return;
  }

  const decodeAttempt=buildStateAdapter.attemptBuildDecode(decodeBuildForCurrentCatalogs,result.text);
  if(!decodeAttempt.ok) {
    console.error("[build-open-decode]",decodeAttempt.error);
    showBuildFeedback("Build 未打开：目录验证发生意外错误，当前 Build 未改变。",null,true);
    return;
  }
  const decoded=decodeAttempt.decoded;
  if(!decoded.ok) {
    showBuildFeedback(`Build 未打开：发现 ${decoded.diagnostics.fatalCount} 个致命错误。`,decoded.diagnostics,true);
    return;
  }

  let candidate;
  try {
    candidate=buildStateAdapter.createBuildCandidate(decoded.value,decoded.preservation,buildCatalogs());
  } catch(error) {
    showBuildFeedback(`Build 未打开：${error.message}`,null,true);
    return;
  }

  const applied=weGameImportUI.applyImportTransaction(candidate,{
    snapshot:captureBuildTransactionState,
    commit:next=>applyPlannerBuildState(next,true),
    finalize:()=>refreshBuildDependentState("Build 已打开，旧的撤销/重做历史已清空。"),
    rollback:restoreBuildTransactionState
  },buildStateAdapter);
  if(!applied.ok) {
    if(applied.unsafe) {
      buildStateUnsafe=true;
      setBuildControlsReady(plannerDataReady);
      showBuildFeedback(
        `Build 应用及回滚均失败，当前状态可能不一致，保存已禁用。请重启应用或重新打开 Build：${applied.rollbackError?.message||"未知回滚错误"}`,
        null,
        true
      );
      return;
    }
    showBuildFeedback(`Build 应用失败，已回滚到打开前状态：${applied.error?.message||"未知错误"}`,null,true);
    return;
  }

  buildStateUnsafe=false;
  setBuildControlsReady(plannerDataReady);

  const warningCount=decoded.diagnostics.warningCount;
  showBuildFeedback(
    warningCount
      ? `Build 已打开，共 ${warningCount} 条兼容性警告（详情最多显示 100 条）。`
      : "Build 已成功打开，没有兼容性警告。",
    warningCount ? decoded.diagnostics : null,
    false
  );
}

function setBuildControlsReady(ready) {
  plannerDataReady=ready;
  const supported=Boolean(window.desktopAPI?.saveBuildJson && window.desktopAPI?.openBuildJson);
  $("#saveBuild").disabled=!weGameImportUI.canSaveBuild({ready,supported,unsafe:buildStateUnsafe});
  $("#openBuild").disabled=!(ready&&supported);
  $("#importWeGame").disabled=!(ready&&window.desktopAPI?.importWeGamePassives);
}

function bindUI() {
  $("#importWeGame").addEventListener("click",openWeGameDialog);
  $("#weGameForm").addEventListener("submit",readWeGamePreview);
  $("#weGameCancel").addEventListener("click",closeWeGameDialog);
  $("#weGameApply").addEventListener("click",applyWeGamePreview);
  $("#weGameDialog").addEventListener("cancel",event=>{ event.preventDefault(); closeWeGameDialog(); });
  $("#saveBuild").addEventListener("click",saveCurrentBuild);
  $("#openBuild").addEventListener("click",openBuild);
  document.querySelectorAll("[data-style]").forEach(btn=>btn.addEventListener("click",()=>{
    styleMode=btn.dataset.style;
    document.querySelectorAll("[data-style]").forEach(b=>b.classList.toggle("active",b===btn));
    scheduleDraw();
  }));
  $("#icons").addEventListener("change",e=>{showIcons=e.target.checked;scheduleDraw();});
  $("#frames").addEventListener("change",e=>{showFrames=e.target.checked;scheduleDraw();});
  $("#small").addEventListener("change",e=>{showSmall=e.target.checked;scheduleDraw();});
  $("#asc").addEventListener("change",e=>{
    showAsc=Boolean(selectedAscendancyId)&&e.target.checked;
    recomputeAscDisplayDelta();
    scheduleDraw();
  });
  $("#labels").addEventListener("change",e=>{showLabels=e.target.checked;scheduleDraw();});
  $("#showLockedConditional").addEventListener("change",e=>{
    showLockedConditional=e.target.checked;
    rebuildPathIndex();
    updateConditionalUI();
    scheduleDraw();
  });

  $("#showInstillOnGraph").addEventListener("change",e=>{
    showInstillOnGraph=e.target.checked;
    hoveredInstill=null;
    $("#tip").style.display="none";
    updatePlannerUI(
      showInstillOnGraph
        ? `显示隐藏天赋：在原版固定坐标展示 ${instillNativeNodeMap.size} 个已匹配节点。`
        : "隐藏未获得的树外隐藏天赋；已获得的节点仍保留在原版位置。"
    );
    scheduleDraw();
  });

  $("#instillSearch").addEventListener("input",e=>{
    instillSearchQuery=e.target.value||"";
    renderInstillCatalog();
  });
  $("#clearInstill").addEventListener("click",()=>{
    if(!instillAllocated.size) return;
    pushUndo();
    instillAllocated.clear();
    renderInstillCatalog();
    updatePlannerUI("已清空灌注专属天赋选择。");
  });

  $("#edgeOpacity").addEventListener("input",e=>{
    edgeOpacity=Number(e.target.value);
    $("#edgeV").textContent=edgeOpacity.toFixed(2);
    scheduleDraw();
  });
  $("#nodeScale").addEventListener("input",e=>{
    nodeScale=Number(e.target.value);
    $("#nodeV").textContent=nodeScale.toFixed(2)+"×";
    scheduleDraw();
  });

  $("#fit").addEventListener("click",fit);
  $("#zin").addEventListener("click",()=>{camera.scale=Math.min(2.5,camera.scale*1.25);scheduleDraw();});
  $("#zout").addEventListener("click",()=>{camera.scale=Math.max(.008,camera.scale/1.25);scheduleDraw();});

  $("#find").addEventListener("click",searchNode);
  $("#search").addEventListener("input",recomputeSearchMatches);
  $("#searchMode").addEventListener("change",e=>{
    const exact=e.target.value==="id";
    $("#search").placeholder=exact ? "输入完整节点 ID，例如 54814" : "暴击 / Projectile / 护甲";
    $("#searchType").disabled=exact;
    recomputeSearchMatches();
  });
  $("#search").addEventListener("keydown",e=>{if(e.key==="Enter"){if(e.shiftKey)stepSearch(-1);else if(searchMatches.length)stepSearch(1);else searchNode();}});
  $("#searchPrev").addEventListener("click",()=>stepSearch(-1));
  $("#searchNext").addEventListener("click",()=>stepSearch(1));
  $("#searchType").addEventListener("change",e=>{searchTypeFilter=e.target.value;recomputeSearchMatches();});
  $("#clearSearch").addEventListener("click",()=>{$("#search").value="";recomputeSearchMatches();});

  $("#classSelect").addEventListener("change",e=>selectClass(e.target.value));
  $("#ascendancySelect").addEventListener("change",e=>selectAscendancy(e.target.value,true));
  $("#focusAsc").addEventListener("click",focusAscendancy);
  $("#langSelect").addEventListener("change",e=>{
    languageMode=e.target.value;
    refreshLocalizedUI();
  });
  $("#reloadI18n").addEventListener("click",()=>loadChineseI18n(true));
  $("#budget").addEventListener("change",e=>{
    const v=Math.max(1,Math.min(300,Math.floor(Number(e.target.value)||123)));
    maxPoints=v; e.target.value=String(v); updatePlannerUI();
  });
  document.querySelectorAll("[data-weapon-mode]").forEach(btn=>{
    btn.addEventListener("click",()=>setWeaponMode(btn.dataset.weaponMode));
  });
  $("#weaponBudget").addEventListener("change",e=>{
    const v=Math.max(0,Math.min(100,Math.floor(Number(e.target.value)||24)));
    maxWeaponPoints=v;
    e.target.value=String(v);
    // Do not silently delete existing allocations; report over-cap if present.
    updatePlannerUI(
      (weaponSet1Allocated.size>v||weaponSet2Allocated.size>v)
        ? "当前武器组分配已超过新容量，请手动退点。"
        : `武器组专精容量：${v}`
    );
  });

  $("#undo").addEventListener("click",undo);
  $("#redo").addEventListener("click",redo);
  $("#resetBuild").addEventListener("click",resetBuild);
  $("#clearSelection").addEventListener("click",()=>{
    selected=null; hovered=null; setPreview(null);
    $("#nodeInfo").textContent="点击节点后显示真实节点数据。";
    scheduleDraw();
  });

  window.addEventListener("keydown",e=>{
    if(e.target && ["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z") { e.preventDefault(); e.shiftKey?redo():undo(); }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y") { e.preventDefault(); redo(); }
  });
}

function bindCanvas() {
  let tipHideTimer=null;
  const cancelTipHide=()=>{clearTimeout(tipHideTimer);tipHideTimer=null;};
  $("#tip").addEventListener("pointerenter",cancelTipHide);
  canvas.addEventListener("wheel",e=>{
    if(!tree)return;
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    const sx=e.clientX-r.left, sy=e.clientY-r.top;
    const before=screenToWorld(sx,sy);
    camera.scale=Math.max(.008,Math.min(2.5,camera.scale*(e.deltaY<0?1.17:1/1.17)));
    camera.x=before.x-(sx-W/2)/camera.scale;
    camera.y=before.y-(sy-H/2)/camera.scale;
    scheduleDraw();
  },{passive:false});

  canvas.addEventListener("pointerdown",e=>{
    canvas.setPointerCapture(e.pointerId);
    dragging=true;moved=false;lastX=e.clientX;lastY=e.clientY;
    $("#tip").style.display="none";
  });

  canvas.addEventListener("pointermove",e=>{
    cancelTipHide();
    const r=canvas.getBoundingClientRect();
    const sx=e.clientX-r.left,sy=e.clientY-r.top;
    if(dragging) {
      const dx=e.clientX-lastX,dy=e.clientY-lastY;
      if(Math.abs(dx)+Math.abs(dy)>2)moved=true;
      camera.x-=dx/camera.scale;
      camera.y-=dy/camera.scale;
      lastX=e.clientX;lastY=e.clientY;
      scheduleDraw();
      return;
    }

    const instillHit=nearestInstillOverlay(sx,sy);
    if(instillHit) {
      hoveredInstill=instillHit;
      hovered=null;
      clearPreviews();
      canvas.style.cursor="pointer";
      showInstillOverlayTip(e,instillHit);
      scheduleDraw();
      return;
    } else if(hoveredInstill) {
      hoveredInstill=null;
      scheduleDraw();
    }

    const n=nearestNode(sx,sy,20);
    const newId=n?idOf(n):null;
    const oldId=hovered?idOf(hovered):null;
    if(newId!==oldId) {
      hovered=n;
      setPreview(n);
    }
    if(n){canvas.style.cursor=hiddenNodeLocked(n)?"help":nodeAllocated(n)?"pointer":"crosshair";showTip(e,n);}
    else{
      canvas.style.cursor="grab";
      tipHideTimer=setTimeout(()=>{$("#tip").style.display="none";},200);
    }
  });

  canvas.addEventListener("pointerup",e=>{
    dragging=false;
    if(moved)return;
    const r=canvas.getBoundingClientRect();
    const sx=e.clientX-r.left, sy=e.clientY-r.top;

    const instillHit=nearestInstillOverlay(sx,sy);
    if(instillHit) {
      toggleInstillOverlaySelection(instillHit);
      return;
    }

    const n=nearestNode(sx,sy,22);
    if(!n)return;
    showNodeInfo(n);
    allocateTarget(n);
  });

  canvas.addEventListener("pointerleave",e=>{
    dragging=false;
    if($("#tip").contains(e.relatedTarget)) return;
    hovered=null;
    hoveredInstill=null;
    setPreview(null);
    $("#tip").style.display="none";
  });
  $("#tip").addEventListener("pointerleave",()=>{$("#tip").style.display="none";});
}

async function load() {
  try {
    $("#status").textContent="加载完整 PoE2 Graph…";
    const [res,jumpRes]=await Promise.all([fetch(DATA_URL),fetch(TREE_JUMP_URL)]);
    if(!res.ok) throw new Error("tree-pre.json HTTP "+res.status);
    if(!jumpRes.ok) throw new Error("tree-jump.json HTTP "+jumpRes.status);
    tree=await res.json();
    jump=await jumpRes.json();

    nodes=Object.entries(tree.nodes)
      .filter(([id])=>id!=="root")
      .map(([id,n])=>({...n,_id:String(id)}));
    edges=tree.edges||[];

    byId=new Map(nodes.map(n=>[idOf(n),n]));
    spatial=new Map();

    for(const n of nodes) if(Number.isFinite(n.x)&&Number.isFinite(n.y)) addSpatial(n);

    rawGraph=createPassiveGraph(nodes,edges,{getNodeId:idOf});
    masteryTriggerIndex=window.plannerMasteryVisualState.buildTriggerIndex(nodes,{
      getId:idOf,isMastery:isMasteryVisual,
      isEligible:n=>!isAsc(n)&&!isInstillExclusiveNode(n)&&!isLegacyStartArtifact(n)&&!isClassStart(n),
      neighbors:id=>rawGraph.neighbors(id),
    });
    // Planner/path adjacency excludes visual-only mastery, canonical
    // display-only hidden nodes, and non-visible conditional dependency edges.
    passiveGraph=createPassiveGraph(nodes,edges,{
      getNodeId:idOf,
      allowEdge:allocatableEdgeAllowedNodes,
    });

    prepareEdges();
    buildInstillNativeNodeMap();

    // Prefer the exporter's point budget when present; retain safe defaults otherwise.
    if(Number.isFinite(Number(tree.maxBasicPoints))) {
      maxPoints=Number(tree.maxBasicPoints);
      $("#budget").value=String(maxPoints);
    }

    populateClassSelect();
    populateAscendancySelect(null,null);

    document.querySelectorAll("button,input,select").forEach(x=>x.disabled=false);
    setBuildControlsReady(true);
    $("#undo").disabled=true; $("#redo").disabled=true; $("#resetBuild").disabled=true;
    $("#asc").disabled=true; $("#ascendancySelect").disabled=true; $("#focusAsc").disabled=true;

    $("#status").textContent="Graph 已加载，正在加载官方 sprite…";
    $("#meta").textContent=`${nodes.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} raw edges · Planner logic ready`;
    fit();
    updatePlannerUI();
    renderInstillCatalog();

    // The slim renderer dataset intentionally omits some isBlighted-only nodes.
    // Load GGG's official full export as a non-blocking sidecar and inject only
    // the known tree-external display passives at their canonical positions.
    loadOfficialHiddenSidecar().catch(err=>{
      console.error("[official-hidden]",err);
      officialHiddenSidecarError=err;
      officialHiddenSidecarReady=false;
      renderInstillCatalog();
      scheduleDraw();
    });

    loadChineseI18n().catch(()=>{}); // display-only layer; graph remains usable if it fails

    const results=await Promise.allSettled([
      loadImage(SKILLS_URL),
      loadImage(FRAMES_URL),
      fetch(MASTERY_EFFECT_ATLAS_JSON_URL).then(r=>{
        if(!r.ok) throw new Error(`mastery atlas json HTTP ${r.status}`);
        return r.json();
      }),
      loadImage(MASTERY_EFFECT_ATLAS_IMG_URL)
    ]);
    if(results[0].status==="fulfilled") skillsImg=results[0].value;
    if(results[1].status==="fulfilled") framesImg=results[1].value;
    if(results[2].status==="fulfilled") masteryEffectAtlas=results[2].value;
    if(results[3].status==="fulfilled") masteryEffectImg=results[3].value;

    spritesReady=Boolean(skillsImg&&framesImg);
    masteryEffectsReady=Boolean(masteryEffectAtlas&&masteryEffectImg);

    $("#status").textContent=spritesReady
      ? "PoE2 Passive Tree Planner v13 · 搜索分析与属性汇总"
      : "PoE2 Planner 已加载（sprite 失败，使用基础节点回退）";
    $("#meta").textContent=
      `${nodes.length.toLocaleString()} nodes · ${renderEdges.length.toLocaleString()} drawable edges · `+
      `Canvas2D + allocatable graph + conditional reveal + mastery visual layer + GGG official hidden-node sidecar + normalized CN stat i18n`;
    scheduleDraw();

  } catch(err) {
    console.error(err);
    setBuildControlsReady(false);
    $("#status").textContent="加载失败";
    const box=$("#error");
    box.style.display="block";
    box.textContent="无法加载天赋树数据："+(err?.message||String(err));
  }
}

// Narrow, opt-in probe used only by the committed Electron layout evidence runner.
// It exposes coordinates, not mutable Planner collections, and is absent in normal use.
if(new URLSearchParams(location.search).has("layout-evidence")) {
  window.plannerLayoutEvidence={
    firstClassName:()=>classOptions[0]?.name||null,
    allocationCount:()=>effectivePassivePointsUsed(),
    nextAllocatablePoint:()=>{
      for(const n of nodes) {
        if(isAsc(n)||isMasteryVisual(n)||isClassStart(n)||!visibleNode(n)||nodeAllocated(n)) continue;
        const path=pathFromActiveSet(idOf(n));
        const cost=path.filter(id=>!allocated.has(id)&&id!==classStartId).length;
        if(!path.length||cost<1||cost>3) continue;
        const x=(n.x-camera.x)*camera.scale+W/2;
        const y=(n.y-camera.y)*camera.scale+H/2;
        if(x<24||y<24||x>W-24||y>H-24) continue;
        const rect=canvas.getBoundingClientRect();
        return {clientX:rect.left+x,clientY:rect.top+y,id:idOf(n),cost};
      }
      return null;
    }
  };
}

bindUI();
bindCanvas();
new ResizeObserver(resize).observe(wrap);
window.addEventListener("resize",resize);
resize();
load();

// --- Narrow Build state capture for external read-only tools ---
// Accessed by agent-panel.js before sending; only the listed keys leave the renderer.
window.captureBuildState = function() {
  var state = {};
  if (typeof baseClassName === "string") state.baseClassName = baseClassName;
  state.selectedAscendancyId = selectedAscendancyId || null;
  state.classStartId = classStartId || null;
  state.ascStartId = ascStartId || null;
  state.maxPoints = Number.isFinite(maxPoints) ? maxPoints : 0;
  state.maxWeaponPoints = Number.isFinite(maxWeaponPoints) ? maxWeaponPoints : 0;
  state.maxAscPoints = Number.isFinite(maxAscPoints) ? maxAscPoints : 0;
  if (typeof effectivePassivePointsUsed === "function") state.passivePointsUsed = effectivePassivePointsUsed();
  state.ascPointsUsed = ascAllocated ? (ascStartId ? Math.max(0, ascAllocated.size - 1) : ascAllocated.size) : 0;
  state.allocated = _plannerSortedIds(allocated);
  state.weaponSet1Allocated = _plannerSortedIds(weaponSet1Allocated);
  state.weaponSet2Allocated = _plannerSortedIds(weaponSet2Allocated);
  state.ascAllocated = _plannerSortedIds(ascAllocated);
  state.instillAllocated = Array.from(instillAllocated || []).sort();
  state.ascendancyOptions = (ascendancyOptions || []).map(function(a) { return { id: a.id, name: a.name }; });
  state.showAscendancy = Boolean(showAsc);
  state.showLockedConditional = Boolean(showLockedConditional);
  state.showInstillOnGraph = Boolean(showInstillOnGraph);
  state.showSmall = Boolean(showSmall);
  state.weaponMode = weaponMode || null;
  if (!i18n.ready) {
    state._projectionError = "Chinese passive-tree localization is not ready";
    return state;
  }
  var pn = [], node;
  for (var i = 0; i < nodes.length; i++) {
    node = nodes[i]; if (!node) continue;
    if (typeof isMasteryVisual === "function" && isMasteryVisual(node)) continue;
    if (typeof isLegacyStartArtifact === "function" && isLegacyStartArtifact(node)) continue;
    var nid = typeof idOf === "function" ? idOf(node) : String(node.skill);
    if (!nid || nid === "undefined") continue;
    pn.push({id:nid,name:String(node.name||""),localizedName:displayNodeName(node,"zh"),localizedStats:Array.isArray(node.stats)?node.stats.map(function(stat){return displayStat(stat,"zh",node)}):[],stats:Array.isArray(node.stats)?node.stats:[],kind:node.kind||"small",x:Number.isFinite(node.x)?node.x:null,y:Number.isFinite(node.y)?node.y:null,asc:node.asc||null,isJewelSocket:Boolean(node.isJewelSocket),isBlighted:Boolean(node.isBlighted),isNotable:(node.kind||"small")==="notable",isKeystone:(node.kind||"small")==="keystone",unlockConstraint:node.unlockConstraint||null});
  }
  state.nodes = pn;
  var pe = [], re = edges || [];
  for (var j = 0; j < re.length; j++) {
    var e = re[j]; if (!e || typeof e.f === "undefined") continue;
    pe.push({f:String(e.f),t:String(e.t)});
  }
  state.edges = pe;
  if (JSON.stringify(state).length > 8000000) { state.nodes = []; state.edges = []; state._projectionError = "snapshot exceeds 8 MiB safety bound"; }
  return state;
};
function _plannerSortedIds(coll) {
  if (!coll) return [];
  var a = coll instanceof Set ? Array.from(coll) : Array.isArray(coll) ? coll : [];
  return a.map(String).sort(function(x,y){return String(x)<String(y)?-1:String(x)>String(y)?1:0});
}
;
