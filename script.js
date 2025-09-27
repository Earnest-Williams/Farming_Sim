(function(){
  // ===================== Utility =====================
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  const clamp01 = x => Math.max(0, Math.min(1, x));
  function lerp(a,b,t){ return a + (b-a)*t; }
  const CAMERA_LERP = 0.2;
  function getSeedFromURL(){
    const m = new URLSearchParams(location.search).get('seed');
    const n = Number(m);
    if (!Number.isFinite(n)) return ((Date.now()&0xfffffff) ^ Math.floor(Math.random()*1e9));
    return n|0;
  }
  function makeRng(seed) {
    let s = seed >>> 0;
    const rng = function() {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.state = () => s;
    rng.set = (seed2) => { s = seed2 >>> 0; };
    return rng;
  }
  function shuffleInPlace(arr, rng){ for (let i=arr.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [arr[i],arr[j]] = [arr[j],arr[i]]; } return arr; }
  function log(world, msg){ world.logs.unshift(msg); if (world.logs.length > 200) world.logs.length = 200; }
  function J(base, rng){ return Math.max(1, Math.round(base * (1 + CONFIG.WORK_JITTER * (rng()*2 - 1)))); }
  function hash01(x,y,seed){
    let h = (x|0) * 374761393 ^ (y|0) * 668265263 ^ (seed|0);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function randomNormal(rng){ const u = 1 - rng(), v = 1 - rng(); return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v); }

  // Helper to compare stamps that may be objects or "Y-M-D" strings
  function isToday(stamp, world){
    if (!stamp) return false;
    if (typeof stamp === 'string') {
      const parts = stamp.split('-').map(Number);
      if (parts.length !== 3) return false;
      const [y, m, d] = parts;
      return y === world.calendar.year && m === world.calendar.month && d === world.calendar.day;
    }
    return stamp.d === world.calendar.day && stamp.m === world.calendar.month;
  }

  // ===================== Calendar & Constants =====================
  const DAYS_PER_MONTH = 20; const MONTHS_PER_YEAR = 8; const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
  const SEASONS = ["Spring","Spring","Summer","Summer","Autumn","Autumn","Winter","Winter"];
  const MONTH_NAMES = ["I","II","III","IV","V","VI","VII","VIII"];
  function seasonOfMonth(m){ return SEASONS[(m-1) % 8]; }
  function isGrowingMonth(m){ return (m >= 1 && m <= 4); }
  function isWinterMonth(m){ return (m === 7 || m === 8); }
  const MINUTES_PER_DAY = 24*60;
  const N_MAX = 1.15;
  const PARCEL_KIND = { ARABLE: 'arable', CLOSE: 'close', ORCHARD: 'orchard', GARDEN: 'garden', COPPICE: 'coppice', HOMESTEAD: 'homestead' };
  const ACRES_PER_ROW = 0.5;
  const ROWS_FOR_ACRES = ac => Math.max(1, Math.round(ac / ACRES_PER_ROW));
  const CREW_SLOTS = 4;
  const LABOUR_DAY_MIN = 8 * 60;
  const LABOUR_BUDGET_MIN = 80 * LABOUR_DAY_MIN;
  const TILTH_MAX = 1.0; const WEED_MAX  = 1.0; const HOE_WEED_DELTA   = -0.40;
  const PLOUGH_TILTH_DELTA = +0.35; const HARROW_TILTH_DELTA = +0.20; const THRESH_LOSS = 0.02;
  const STRAW_PER_BUSHEL = { WHEAT:1.2, BARLEY:1.0, OATS:1.1, PULSES:0.6 };
  const OPT_MOIST = 0.60;
  const RATION = { HORSE: { oats_bu: 0.375, hay_t: 0.006 }, OX: { oats_bu: 0.10,  hay_t: 0.008 }, COW: { oats_bu: 0.00, hay_t: 0.010 }, SHEEP: { oats_bu: 0.00, hay_t: 0.0015 }, GOOSE: { oats_bu: 0.005, hay_t: 0.000 }, HEN:   { oats_bu: 0.001, hay_t: 0.000 } };
  const MANURE = { HORSE: 1.0, OX: 1.2, COW: 1.1, SHEEP: 0.2, GOOSE: 0.05, HEN: 0.03 };
  const PASTURE = { SHEEP_CONS_T_PER_DAY: 0.0006, GOOSE_CONS_T_PER_DAY: 0.0002, REGROW_T_PER_ACRE_PER_DAY: 0.0025, MIN_BIOMASS_T: 0.0, MAX_BIOMASS_T_PER_ACRE: 0.6 };
  const WX_BASE = { 1:{ tMean:9, rainMean:2.0, etp:1.6 }, 2:{ tMean:12, rainMean:2.2, etp:2.2 }, 3:{ tMean:17, rainMean:2.0, etp:3.2 }, 4:{ tMean:20, rainMean:2.4, etp:4.0 }, 5:{ tMean:15, rainMean:3.2, etp:2.6 }, 6:{ tMean:10, rainMean:3.6, etp:1.6 }, 7:{ tMean:5, rainMean:2.4, etp:0.8 }, 8:{ tMean:6, rainMean:2.2, etp:0.8 } };
  const SOIL = { WILTING: 0.20, FIELD_CAP: 0.60, SAT: 1.00, INFIL_PER_MM: 0.003, DRAIN_RATE: 0.05 };
  const PRICES = { wheat_bu: 0.75, barley_bu: 0.55, oats_bu: 0.40, pulses_bu: 0.70, hay_t: 18, straw_t: 6, poles_bundle: 1.5, firewood_cord: 10, meat_lb: 0.02, bacon_side: 1.2, cider_l: 0.002, seed_wheat_bu: 0.9, seed_barley_bu: 0.7, seed_oats_bu: 0.5 };
  const DEMAND = { household_wheat_bu_per_day: 0.25, seed_bu_per_acre: { WHEAT:2.0, BARLEY:2.0, OATS:2.0, PULSES:1.5, FLAX:0.0, TURNIPS:0.2 } };
  function seedNeededForParcel(p, cropKey){ const ac = p.acres||0, sb = DEMAND.seed_bu_per_acre[cropKey]||0; return ac * sb; }

  const TASK_KINDS = {
    MOVE: 'move', WORK: 'work', HarvestRow: 'HarvestRow', PlantRow: 'PlantRow', IrrigateRow: 'IrrigateRow', TendRow: 'TendRow', DrawWater: 'DrawWater',
    PloughPlot: 'PloughPlot', HarrowPlot: 'HarrowPlot', DrillPlot: 'DrillPlot', Sow: 'Sow', HoeRow: 'HoeRow', CartSheaves: 'CartSheaves',
    StackRicks: 'StackRicks', Thresh: 'Thresh', Winnow: 'Winnow', SpreadManure: 'SpreadManure', FoldSheep: 'FoldSheep', MoveHerd: 'MoveHerd',
    Prune: 'Prune', Repair: 'Repair', Slaughter: 'Slaughter', ClampRoots: 'ClampRoots', GardenSow: 'GardenSow',
    HarvestParcel:'HarvestParcel', CutCloverHay: 'CutCloverHay', OrchardHarvest: 'OrchardHarvest', CartHay: 'CartHay', CartToMarket: 'CartToMarket',
  };

  // ===================== Config =====================
  const CONFIG = {
    SCREEN: { W: 100, H: 30 }, WORLD:  { W: 210, H: 100 },
    HOUSE: { x: 15, y: 10, w: 16, h: 8 }, WELL: { x: 35, y: 12 },
    FARMER_SPEED: 2, SPEED_LEVELS: [1000, 600, 300, 150, 75],
    IRRIGATION_THRESHOLD: 0.35, TEND_ROWS_PER_DAY: 4,
    WORK_JITTER: 0.10, DAYLIGHT: { baseHours: 12, amplitude: 3, snapDays: 5, bufferMin: 30 },
    IRRIGATION_AMOUNT: 0.18, FODDER_PER_LIVESTOCK: 1, MANURE_NITROGEN_CREDIT: 0.005,
    DAILY_ROOT_CONSUMPTION: 2, LIVESTOCK_BUY_COST: 150, LIVESTOCK_SELL_VALUE: 100,
  };
  const WORK_MINUTES = {
    PlantRow: 25, HarvestRow: 45, TendRow: 10, IrrigateRow: 12, DrawWater: 15,
    PloughPlot_perAcre: 160,   HarrowPlot_perAcre: 60,   DrillPlot_perAcre: 45,
    Sow_perRow: 6,             HoeRow_perRow: 12,
    CartSheaves_perAcre: 40,   StackRicks_perAcre: 25,
    Thresh_perBushel: 6,       Winnow_perBushel: 2,
    SpreadManure_perAcre: 90,  FoldSheep_setup: 60,      MoveHerd_flat: 30,
    Prune_perTree: 5,          Repair_perJob: 120,       Slaughter_perHead: 240,
    ClampRoots_perTon: 120,    GardenSow_perBed: 20,
    HarvestParcel_perAcre:120,
    CutCloverHay_perAcre: 180, OrchardHarvest_perAcre: 120, CartHay_perAcre: 60,
    CartToMarket: 240,
  };
  const ACRES = p => p.acres || 0;
  const ROWS  = p => (p.rows?.length || 0);

  // ===================== Style & Glyph Definitions =====================
  const SID = {
    GRASS_DRY: 0, GRASS_NORMAL: 1, GRASS_LUSH: 2, GRASS_VERY_LUSH: 3,
    SOIL_UNTILLED: 10, SOIL_TILLED: 11, SOIL_MOIST: 12,
    T_S1: 20, T_S2: 21, T_S3: 22, T_S4: 23, T_S5: 24, T_BULB: 25,
    B_S1: 30, B_S2: 31, B_S3: 32, B_S4: 33, B_S5: 34,
    C_S1: 40, C_S2: 41, C_S3: 42, C_S4: 43, C_S5: 44,
    W_S1: 50, W_S2: 51, W_S3: 52, W_S4: 53, W_S5: 54,
    O_S1: 60, O_S2: 61, O_S3: 62, O_S4: 63, O_S5: 64,
    P_S1: 70, P_S2: 71, P_S3: 72, P_S4: 73, P_S5: 74,
    F_S1: 80, F_S2: 81, F_S3: 82, F_S4: 83, F_S5: 84,
    FARMER: 90, HOUSE_WALL: 91, DOOR: 92, WELL_WATER: 93, BORDER: 94, WELL_TEXT: 95, WOOD_FLOOR: 96,
    HUD_TEXT: 100, W_RAIN: 101, W_STORM: 102, W_HOT: 103, W_SNOW: 104,
    BAR_LOW: 110, BAR_MID: 111, BAR_HIGH: 112, N_LOW: 113, N_MID: 114, N_HIGH: 115,
    MIXED_LABEL: 200,
  };
  const SID_BY_CROP = { T: [SID.SOIL_TILLED, SID.T_S1, SID.T_S2, SID.T_S3, SID.T_S4, SID.T_S5], B: [SID.SOIL_TILLED, SID.B_S1, SID.B_S2, SID.B_S3, SID.B_S4, SID.B_S5], C: [SID.SOIL_TILLED, SID.C_S1, SID.C_S2, SID.C_S3, SID.C_S4, SID.C_S5], W: [SID.SOIL_TILLED, SID.W_S1, SID.W_S2, SID.W_S3, SID.W_S4, SID.W_S5], O: [SID.SOIL_TILLED, SID.O_S1, SID.O_S2, SID.O_S3, SID.O_S4, SID.O_S5], P: [SID.SOIL_TILLED, SID.P_S1, SID.P_S2, SID.P_S3, SID.P_S4, SID.P_S5], F: [SID.SOIL_TILLED, SID.F_S1, SID.F_S2, SID.F_S3, SID.F_S4, SID.F_S5], };
  const CROP_GLYPHS = { T: ['.', '`', ',', 'v', 'w', 'W'], B: ['.', ',', ';', 't', 'Y', 'H'], C: ['.', ',', '"', '*', 'c', 'C'], W: ['.', ',', ';', 'i', 'I', 'W'], O: ['.', ',', ';', 't', 'T', 'Y'], P: ['.', 'o', 'd', 'b', '8', '&'], F: ['.', '|', 'i', 't', 'T', '#'], };
  const GRASS_GLYPHS = { [SID.GRASS_DRY]: '.', [SID.GRASS_NORMAL]: '`', [SID.GRASS_LUSH]: ',', [SID.GRASS_VERY_LUSH]: '"', };

  // ===================== World Layout & State =====================
  const SCREEN_W = CONFIG.SCREEN.W; const SCREEN_H = CONFIG.SCREEN.H;
  const HOUSE = CONFIG.HOUSE; const WELL  = CONFIG.WELL;
  const DOOR_XL = HOUSE.x + Math.floor(HOUSE.w/2) - 1; const DOOR_XR = DOOR_XL + 1;
  const PARCELS_LAYOUT = [ { key:'turnips',       name:'Turnips Field',       kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:5, w:60, h:25 }, { key:'barley_clover', name:'Barley+Clover Field', kind:PARCEL_KIND.ARABLE,  acres:8,  x:110, y:5, w:60, h:25 }, { key:'clover_hay',    name:'Clover/Hay Field',    kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:35, w:60, h:25 }, { key:'wheat',         name:'Winter Wheat Field',  kind:PARCEL_KIND.ARABLE,  acres:8,  x:110, y:35, w:60, h:25 }, { key:'pulses',        name:'Beans/Peas Field',    kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:65, w:60, h:25 }, { key:'flex',          name:'Flex Field',          kind:PARCEL_KIND.ARABLE,  acres:8,  x:110, y:65, w:60, h:25 }, { key:'close_a', name:'Close A (Oats)',      kind:PARCEL_KIND.CLOSE, acres:3, x:175, y:5, w:30, h:25 }, { key:'close_b', name:'Close B (Legumes)',   kind:PARCEL_KIND.CLOSE, acres:3, x:175, y:35, w:30, h:25 }, { key:'close_c', name:'Close C (Roots/Fod.)',kind:PARCEL_KIND.CLOSE, acres:3, x:175, y:65, w:30, h:25 }, { key:'homestead', name:'Homestead', kind:PARCEL_KIND.HOMESTEAD, acres:1, x:10, y:5, w:30, h:20 }, { key:'orchard',   name:'Orchard',   kind:PARCEL_KIND.ORCHARD,   acres:1, x:10, y:28, w:30, h:15 }, { key:'coppice',   name:'Coppice',   kind:PARCEL_KIND.COPPICE,   acres:2, x:10, y:46, w:30, h:20 }, ];

  function rowBand(parcel, rowIdx){ const y0 = parcel.y + 1; const y1 = parcel.y + parcel.h - 2; const iH = y1 - y0 + 1; const bH = Math.floor(iH / parcel.rows.length); const remainder = iH % parcel.rows.length; const getBandHeight = (idx) => bH + (idx < remainder ? 1 : 0); let cumulative = y0; for (let i = 0; i < rowIdx; i++) cumulative += getBandHeight(i); const sy = cumulative; const ey = sy + getBandHeight(rowIdx) - 1; return {sy, ey}; }
  function rowCenter(parcel, rowIdx){ const {sy, ey} = rowBand(parcel, rowIdx); return {x: Math.floor(parcel.x + Math.floor(parcel.w/2)), y: Math.floor((sy + ey)/2)}; }
  const FARMER_START = {x: HOUSE.x + Math.floor(HOUSE.w/2), y: HOUSE.y + HOUSE.h};
  const CROPS = { TURNIPS: { key:'T', name:'Turnips', type:'root', baseDays: 80, baseYield: 60, nUse: -0.10 }, BARLEY: { key:'B', name:'Barley', type:'grain', baseDays: 85, baseYield: 70, nUse: -0.12 }, CLOVER: { key:'C', name:'Clover', type:'legume',baseDays: 70, baseYield: 25, nUse: +0.18 }, WHEAT: { key:'W', name:'Wheat', type:'grain', baseDays: 95, baseYield: 80, nUse: -0.14 }, OATS:   { key:'O', name:'Oats',   type:'grain', baseDays:85, baseYield:65, nUse:-0.12 }, PULSES: { key:'P', name:'Beans/Peas/Vetch', type:'pulse', baseDays:90, baseYield:45, nUse:+0.06 }, FLAX:   { key:'F', name:'Flax/Hemp', type:'fiber', baseDays:100, baseYield:30, nUse:-0.10 }, };
  const ROTATION = [CROPS.TURNIPS, CROPS.BARLEY, CROPS.CLOVER, CROPS.WHEAT];
  const LIVESTOCK_START = { horses:2, oxen:3, cows:2, bull:1, sheep:36, geese:16, poultry:24 };

  function isBlocked(x,y){ if (x<0||x>=CONFIG.WORLD.W||y<0||y>=CONFIG.WORLD.H) return true; if (x>=HOUSE.x && x<HOUSE.x+HOUSE.w && y>=HOUSE.y && y<HOUSE.y+HOUSE.h){ const onBorder = (x===HOUSE.x||x===HOUSE.x+HOUSE.w-1||y===HOUSE.y||y===HOUSE.y+HOUSE.h-1); const isDoor = (y===HOUSE.y+HOUSE.h-1)&&(x===DOOR_XL||x===DOOR_XR); if (onBorder && !isDoor) return true; } return false; }
  function createPathfindingGrid(world) { const grid = Array.from({length: CONFIG.WORLD.H}, () => Array(CONFIG.WORLD.W).fill(0)); for (let y = 0; y < CONFIG.WORLD.H; y++) for (let x = 0; x < CONFIG.WORLD.W; x++) if (isBlocked(x,y)) grid[y][x] = 1; return grid; }
  function findPath(grid, start, end) { const q = [[start]]; const visited = new Set([`${start.x},${start.y}`]); const dirs = [[0,1], [0,-1], [1,0], [-1,0]]; while (q.length > 0) { const path = q.shift(); const pos = path[path.length - 1]; if (pos.x === end.x && pos.y === end.y) return path.slice(1); for (const [dx, dy] of dirs) { const nx = pos.x + dx, ny = pos.y + dy; const key = `${nx},${ny}`; if (nx >= 0 && nx < CONFIG.WORLD.W && ny >= 0 && ny < CONFIG.WORLD.H && !grid[ny][nx] && !visited.has(key)) { visited.add(key); const newPath = [...path, {x: nx, y: ny}]; q.push(newPath); } } } return null; }
  function stamp(world){ return { m: world.calendar.month, d: world.calendar.day }; }
  function makeParcel(entry, rng) { const soil = { moisture: 0.55 + rng()*0.2, nitrogen: 0.45 + rng()*0.2 }; const parcel = { id: null, key: entry.key, name: entry.name, kind: entry.kind, acres: entry.acres, x: entry.x, y: entry.y, w: entry.w, h: entry.h, soil, rows: [], rotationIndex: null, status: { stubble:false, tilth:0, lastPlantedOn:null, cropNote:'', lastPloughedOn: null, lastHarrowedOn: null, lateSow: 0, harvestPenalty: 0, lodgingPenalty: 0, mud: 0 }, fieldStore: { sheaves:0, cropKey:null }, }; const rowCount = (entry.kind===PARCEL_KIND.ARABLE || entry.kind===PARCEL_KIND.CLOSE) ? ROWS_FOR_ACRES(entry.acres) : 0; for (let i = 0; i < rowCount; i++) { parcel.rows.push({ crop: null, companion:null, growth: 0, moisture: soil.moisture, weed: 0, plantedOn: null, _tilledOn: null, _irrigatedOn: null, harvested: false }); } return parcel; }
  function buildParcels(rng) { const parcels = PARCELS_LAYOUT.map((e, i) => { const p = makeParcel(e, rng); p.id = i; return p; }); const byKey = {}; for (const p of parcels) byKey[p.key] = p.id; return { parcels, byKey }; }
  function initStores() { return { wheat:0, barley:0, oats:0, pulses:0, straw:0, hay:0, turnips:0, roots_misc:0, onions:0, cabbages:0, carrots:0, parsnips:0, beets:0, fruit_dried:0, cider_l:0, firewood_cords:0, poles:0, meat_salted:0, bacon_sides:0, eggs_dozen:0, manure_units:0, seed: { wheat:0, barley:0, oats:0, pulses:0 }, water: 0 }; }
  function initStock(){ return JSON.parse(JSON.stringify(LIVESTOCK_START)); }
  function initHerdLocations(world){ world.herdLoc = { horses: 'homestead', oxen: 'homestead', cows: 'homestead', sheep: 'clover_hay', geese: 'orchard', poultry:'homestead' }; }
  function initWeather(world){ world.weather = { tempC: WX_BASE[world.calendar.month].tMean, rain_mm: 0, wind_ms: 2, frostTonight: false, dryStreakDays: 0, forecast: [] }; }
  function initCash(world){ world.cash = 0; }
  function kpiInit(world){ world.kpi = { oats_days_cover: 0, hay_days_cover: 0, wheat_days_cover: 0, seed_gaps: [], deadline_risk: 0, labour_pressure: 0, month_workable_min_left: 0, month_required_min_left: 0, warnings: [], suggestions: [] }; }
  function ensureAdvisor(world){ world.advisor = world.advisor || { enabled:true, mode:'auto' }; }
  function attachPastureIfNeeded(parcel){ if (!parcel.pasture) parcel.pasture = { biomass_t: 0, grazedToday_t: 0 }; }
  function initPastureDay1(world){ const clover = world.parcels[world.parcelByKey.clover_hay]; attachPastureIfNeeded(clover); clover.pasture.biomass_t = Math.min(clover.acres * PASTURE.MAX_BIOMASS_T_PER_ACRE * 0.25, clover.acres * 0.2); }
  function markBareToBeSown(p, note){ p.status = { ...p.status, tilth:0, stubble:false, cropNote:`Bare → ${note}` }; }
  function markBare(p){ p.status = { ...p.status, tilth:0, stubble:false, cropNote:'Bare' }; }
  function markStubbledTurnips(p){ p.status = { ...p.status, tilth:0.2, stubble:true, cropNote:'Folded in winter; drill in Month II' }; }
  function markEstablishedClover(p){ for (const r of p.rows){ r.crop = CROPS.CLOVER; r.growth = 0.6; } p.status.cropNote='Clover standing (hay Month III)'; }
  function markYoungWheat(p){ for (const r of p.rows){ r.crop = CROPS.WHEAT; r.growth = 0.2; } p.status.cropNote='Young wheat overwintered'; }
  function initEstate(world) { const { parcels, byKey } = buildParcels(world.rng); world.parcels = parcels; world.parcelByKey = byKey; world.store = initStores(); world.livestock = initStock(); initHerdLocations(world); initPastureDay1(world); world.parcels[byKey.turnips].rotationIndex = 0; world.parcels[byKey.barley_clover].rotationIndex = 1; world.parcels[byKey.clover_hay].rotationIndex = 2; world.parcels[byKey.wheat].rotationIndex = 3; world.parcels[byKey.barley_clover].status.targetHarvestM = 4; world.parcels[byKey.close_a].status.targetHarvestM = 4; world.parcels[byKey.pulses].status.targetHarvestM = 4; world.parcels[byKey.wheat].status.targetHarvestM = 5; markYoungWheat(world.parcels[byKey.wheat]); markEstablishedClover(world.parcels[byKey.clover_hay]); markStubbledTurnips(world.parcels[byKey.turnips]); markBareToBeSown(world.parcels[byKey.barley_clover], 'barley+clover'); markBareToBeSown(world.parcels[byKey.pulses], 'beans/peas/vetch'); markBare(world.parcels[byKey.flex]); markBareToBeSown(world.parcels[byKey.close_a], 'oats'); markBare(world.parcels[byKey.close_b]); markBare(world.parcels[byKey.close_c]); world.parcels[byKey.homestead].status.cropNote = 'Byres + garden prepped'; world.parcels[byKey.orchard].status.cropNote   = 'Buds just breaking'; world.parcels[byKey.coppice].status.cropNote   = 'Poles seasoning; stools sprouting'; console.assert(world.parcels.reduce((s,p)=>s+p.acres,0) === 48+9+1+1+2, 'Acre total mismatch'); console.assert(world.parcels[byKey.turnips].rows.length === ROWS_FOR_ACRES(8), 'Arable row count mismatch'); console.assert(world.parcels[byKey.close_a].rows.length === ROWS_FOR_ACRES(3), 'Close row count mismatch'); }
  function makeWorld(seed){ 
    const effectiveSeed = seed ?? getSeedFromURL();
    const rng = makeRng(effectiveSeed);
    const world = { 
        rng, 
        seed: effectiveSeed, 
        paused: false, showPanel: true, speedIdx: 2, speeds: CONFIG.SPEED_LEVELS, 
        calendar: { minute: 0, day: 1, month: 1, year: 1}, 
        weather: {}, 
        daylight: computeDaylightByIndex(0), 
        farmer: { x: FARMER_START.x, y: FARMER_START.y, task: 'Idle', queue: [], moveTarget: null, path: [], activeWork: new Array(CREW_SLOTS).fill(null) }, 
        parcels: [], store: {}, storeSheaves: { WHEAT:0, BARLEY:0, OATS:0, PULSES:0 }, 
        stackReady: false, logs: [], alerts: [], camera: { x: 0, y: 0 }, livestock: {}, 
        labour: { monthBudgetMin: LABOUR_BUDGET_MIN, usedMin: 0, crewSlots: CREW_SLOTS }, 
        tasks: { month: { queued: [], active: [], done: [], overdue: [] } }, 
        nextTaskId: 0, flexChoice: null, cash: 0 
    }; 
    initEstate(world); 
    initWeather(world); 
    initCash(world); 
    kpiInit(world); 
    ensureAdvisor(world); 
    world.pathGrid = createPathfindingGrid(world); 
    Object.defineProperty(world, 'plots', { get(){ return world.parcels; }}); 
    onNewMonth(world); 
    return world; 
  }
  function computeDaylightByIndex(dayIndex){ const stepIdx = Math.floor(dayIndex / CONFIG.DAYLIGHT.snapDays); const stepped = stepIdx * CONFIG.DAYLIGHT.snapDays + Math.floor(CONFIG.DAYLIGHT.snapDays/2); const angle = 2*Math.PI * ((stepped - 60) / DAYS_PER_YEAR); const dayLen = clamp(CONFIG.DAYLIGHT.baseHours + CONFIG.DAYLIGHT.amplitude * Math.cos(angle), 8, 16); const sunrise = Math.round((12 - dayLen/2) * 60); const sunset  = Math.round((12 + dayLen/2) * 60); return { sunrise, sunset, workStart: Math.max(0, sunrise - CONFIG.DAYLIGHT.bufferMin), workEnd: Math.min(24*60, sunset + CONFIG.DAYLIGHT.bufferMin), dayLenHours: dayLen }; }

  // ===================== Labour & Task Management =====================
  function makeTask(world, spec){ return { id: world.nextTaskId++, kind: spec.kind, parcelId: spec.parcelId ?? null, payload: spec.payload || null, latestDay: spec.latestDay ?? 20, estMin: spec.estMin, doneMin: 0, priority: spec.priority ?? 0, status: 'queued' }; }
  function minutesFor(op, parcel, payload){ switch(op){ case TASK_KINDS.PloughPlot: return WORK_MINUTES.PloughPlot_perAcre * ACRES(parcel); case TASK_KINDS.HarrowPlot: return WORK_MINUTES.HarrowPlot_perAcre * ACRES(parcel); case TASK_KINDS.DrillPlot: return WORK_MINUTES.DrillPlot_perAcre * ACRES(parcel); case TASK_KINDS.Sow: return WORK_MINUTES.Sow_perRow * ROWS(parcel); case TASK_KINDS.HoeRow: return WORK_MINUTES.HoeRow_perRow * ROWS(parcel); case TASK_KINDS.CartSheaves: return WORK_MINUTES.CartSheaves_perAcre * ACRES(parcel); case TASK_KINDS.StackRicks: return WORK_MINUTES.StackRicks_perAcre * ACRES(parcel); case TASK_KINDS.HarvestParcel: return WORK_MINUTES.HarvestParcel_perAcre * ACRES(parcel); case TASK_KINDS.SpreadManure:  return WORK_MINUTES.SpreadManure_perAcre  * ACRES(parcel); case TASK_KINDS.FoldSheep: return WORK_MINUTES.FoldSheep_setup; case TASK_KINDS.CutCloverHay: return WORK_MINUTES.CutCloverHay_perAcre * ACRES(parcel); case TASK_KINDS.OrchardHarvest:return WORK_MINUTES.OrchardHarvest_perAcre* ACRES(parcel); case TASK_KINDS.CartHay: return WORK_MINUTES.CartHay_perAcre * (parcel?.acres||0); case TASK_KINDS.CartToMarket: return WORK_MINUTES.CartToMarket; default: return 0; } }
  function moistureToMud(m){ return Math.max(0, (m - SOIL.FIELD_CAP) / (SOIL.SAT - SOIL.FIELD_CAP)); }
  function mudTooHigh(p, threshold=0.35){ return (p.status.mud||0) >= threshold; }
  function canStartTask(world, task){ const p = task.parcelId!=null ? world.parcels[task.parcelId] : null; switch(task.kind){ case TASK_KINDS.PloughPlot: case TASK_KINDS.HarrowPlot: case TASK_KINDS.Sow: case TASK_KINDS.DrillPlot: case TASK_KINDS.CartSheaves: return !!p && !mudTooHigh(p); case TASK_KINDS.CutCloverHay: return !!p && world.weather.rain_mm <= 0.2; case TASK_KINDS.CartHay: const h = p?.hayCuring; return !!h && h.dryness >= 1 && world.weather.rain_mm <= 0.2; case TASK_KINDS.HarrowPlot: return !!p && (p.status.lastPloughedOn != null || (p.status.tilth||0) >= 0.2); case TASK_KINDS.Sow: if (!p || !p.rows?.length) return false; return p.rows.every(r => !r.crop) && (p.status.tilth||0) >= 0.2; case TASK_KINDS.DrillPlot: return !!p && p.rows?.length; case TASK_KINDS.HoeRow: return !!p && p.rows?.some(r => r.crop); case TASK_KINDS.HarvestParcel: if (!p || !p.rows?.length) return false; return p.rows.every(r => r.crop && r.growth >= 1.0); case TASK_KINDS.CartSheaves: return !!p && (p.fieldStore?.sheaves||0) > 0; case TASK_KINDS.StackRicks: return Object.values(world.storeSheaves||{}).some(v => v>0); case TASK_KINDS.Thresh: return !!world.stackReady && Object.values(world.storeSheaves||{}).some(v => v>0); default: return true; } }
  function planDayMonthly(world){ world.tasks.month.queued.sort((a,b)=> scoreTask(world,b) - scoreTask(world,a)); for (let i=0; i<CREW_SLOTS; i++){ if (world.farmer.activeWork[i]) continue; let task; let guard = world.tasks.month.queued.length; let foundTask = false; while(guard-- > 0) { task = world.tasks.month.queued.shift(); if (canStartTask(world, task)) { task.status='active'; world.tasks.month.active.push(task); world.farmer.activeWork[i]=task.id; foundTask = true; break; } else { world.tasks.month.queued.push(task); } } } }
  function scoreTask(world, t){ const day = world.calendar.day; const slack = Math.max(0, t.latestDay - day); return (t.priority * 1000) + (100 - Math.min(99, slack)); }
  function findTaskById(world, id){ return world.tasks.month.active.find(t => t.id === id); }
  function completeTask(world, task, slotIndex){ task.status = 'done'; applyTaskEffects(world, task); world.tasks.month.active = world.tasks.month.active.filter(t => t.id !== task.id); world.tasks.month.done.push(task); world.farmer.activeWork[slotIndex] = null; log(world, `Completed task: ${task.kind}`); }
  function maybeToolBreak(world, task){ const heavy = [TASK_KINDS.PloughPlot, TASK_KINDS.HarrowPlot, TASK_KINDS.CartSheaves, TASK_KINDS.CartHay]; if (!heavy.includes(task.kind)) return false; const perHour = 0.008; const perMin  = 1 - Math.pow(1 - perHour, 1/60); if (world.rng() < perMin){ world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.Repair, parcelId: null, payload:{ scope:'tool_break' }, latestDay: world.calendar.day+2, estMin: WORK_MINUTES.Repair_perJob, priority: 15 })); (world.alerts=world.alerts||[]).push('Tool breakdown → repair queued'); return true; } return false; }
  function tickWorkMinute(world){ let needsTopUp = false; for (let s = 0; s < CREW_SLOTS; s++) { const id = world.farmer.activeWork[s]; if (!id) continue; const t = findTaskById(world, id); if (!t) { world.farmer.activeWork[s] = null; needsTopUp = true; continue; } t.doneMin += 1; world.labour.usedMin += 1; if (maybeToolBreak(world, t)) {} if (t.doneMin >= t.estMin) { completeTask(world, t, s); needsTopUp = true; } } if (needsTopUp) { for (let s = 0; s < CREW_SLOTS; s++) { if (world.farmer.activeWork[s]) continue; let task; let foundAndAssigned = false; const pools = [world.tasks.month.overdue, world.tasks.month.queued]; for (const pool of pools) { pool.sort((a,b)=> scoreTask(world,b) - scoreTask(world,a)); let guard = pool.length; while (guard-- > 0) { task = pool.shift(); if (canStartTask(world, task)) { task.status = 'active'; world.tasks.month.active.push(task); world.farmer.activeWork[s] = task.id; foundAndAssigned = true; break; } else { pool.push(task); } } if (foundAndAssigned) break; } } } }
  function endOfDayMonth(world){ const day = world.calendar.day; for (const t of world.tasks.month.queued){ if (t.latestDay < day && t.status === 'queued'){ t.status = 'overdue'; world.tasks.month.overdue.push(t); } } for (const t of world.tasks.month.overdue) t.priority = Math.max(t.priority, 20); world.tasks.month.queued = world.tasks.month.queued.filter(t => t.status==='queued'); }

  // ===================== KPIs and Advisor Logic =====================
  function updateKPIs(world){ const S = world.store, L = world.livestock, H = world.herdLoc; const m = world.calendar.month, d = world.calendar.day; const oatsDaily = (L.horses * RATION.HORSE.oats_bu) + (L.oxen * RATION.OX.oats_bu) + (L.geese * RATION.GOOSE.oats_bu) + (L.poultry* RATION.HEN.oats_bu); const hayDaily  = (L.horses * RATION.HORSE.hay_t) + (L.oxen * RATION.OX.hay_t) + (L.cows * RATION.COW.hay_t) + (H.sheep === 'clover_hay' ? 0 : L.sheep * RATION.SHEEP.hay_t); const wheatDaily = DEMAND.household_wheat_bu_per_day; world.kpi.oats_days_cover  = oatsDaily > 0 ? (S.oats / oatsDaily) : Infinity; world.kpi.hay_days_cover = hayDaily > 0 ? (S.hay / hayDaily) : Infinity; world.kpi.wheat_days_cover = wheatDaily > 0 ? (S.wheat / wheatDaily) : Infinity; const seed_gaps = []; for (const p of world.parcels){ if (!p.rows?.length) continue; const sowQueued = world.tasks?.month?.queued?.some(t => t.kind===TASK_KINDS.Sow && t.parcelId===p.id); if (!sowQueued) continue; const cropKey = (p.status.cropNote?.includes('Wheat') || p.rotationKey==='WHEAT') ? 'WHEAT' : (p.status.cropNote?.includes('Barley')|| p.rotationKey==='BARLEY')? 'BARLEY' : null; const payloadCrop = world.tasks.month.queued.find(t => t.kind===TASK_KINDS.Sow && t.parcelId===p.id)?.payload?.crop; const key = payloadCrop || cropKey; if (!key) continue; const need = seedNeededForParcel(p, key); const have = (world.store.seed[key?.toLowerCase()] ?? world.store.seed[key]) || 0; if (have < need) seed_gaps.push({ parcelId:p.id, key, need, have, short: need - have }); } world.kpi.seed_gaps = seed_gaps; const daysLeft = Math.max(0, 20 - d + 1); const avgMudFactor = world.parcels.reduce((s,p)=> s + (p.status?.mud || 0), 0) / Math.max(1, world.parcels.length); const workability = Math.max(0.4, 1 - 0.6*avgMudFactor); const daylightFactor = 1.0; const slots = world.labour.crewSlots || 4; const workableMinPerDay = daylightFactor * LABOUR_DAY_MIN * slots * workability; const month_workable_min_left = workableMinPerDay * daysLeft; const reqLeft = (world.tasks?.month?.queued||[]).filter(t => t.latestDay >= d).reduce((s,t)=> s + Math.max(0, (t.estMin - t.doneMin)), 0); world.kpi.month_workable_min_left = Math.round(month_workable_min_left); world.kpi.month_required_min_left = Math.round(reqLeft); world.kpi.labour_pressure = reqLeft > 0 ? (reqLeft / Math.max(1, month_workable_min_left)) : 0; let risky=0, total=0; for (const t of world.tasks.month.queued){ total++; const slackMin = Math.max(0, (t.latestDay - d)) * LABOUR_DAY_MIN * slots * 0.5; if (t.estMin > slackMin) risky++; } world.kpi.deadline_risk = total ? risky/total : 0; const W = []; if (world.kpi.oats_days_cover < 30) W.push('Oats < 30 days'); if (world.kpi.hay_days_cover < 30) W.push('Hay < 30 days'); if (world.kpi.wheat_days_cover < 60) W.push('Wheat < 60 days'); if (world.kpi.labour_pressure > 1.1) W.push('Labour overcommitted'); if (seed_gaps.length) W.push('Seed shortfalls'); world.kpi.warnings = W; }
  function expectedBushelPrice(world, key){ switch(key){ case 'WHEAT': return priceFor('wheat_bu', world.calendar.month); case 'BARLEY': return priceFor('barley_bu', world.calendar.month); case 'OATS': return priceFor('oats_bu', world.calendar.month); case 'PULSES': return priceFor('pulses_bu', world.calendar.month); default: return 0.5; } }
  function latenessPenaltyPerDay(t){ if (t.kind===TASK_KINDS.Sow || t.kind===TASK_KINDS.HarvestParcel) return 0.01; return 0.002; }
  function taskMarginalValue(world, t){ const p = t.parcelId!=null ? world.parcels[t.parcelId] : null; const d = world.calendar.day; const daysLate = Math.max(0, d - t.latestDay); if (t.kind===TASK_KINDS.Sow && p){ const key = t.payload?.crop; const crop = CROPS[key]; if (!crop) return 0; const buPotential = (p.acres||0) * (crop.baseYield||0) * 0.6; const value = buPotential * expectedBushelPrice(world, key) * (latenessPenaltyPerDay(t) * (daysLate || 1)); return Math.max(1, value); } if (t.kind===TASK_KINDS.HarvestParcel && p){ const row0 = p.rows?.[0]; if (!row0 || !row0.crop) return 0; const key = row0.crop.key; const crop = row0.crop; const buEst = estimateParcelYieldBushels_withTiming(world, p, crop); const risk = 0.05 + (p.status.lodgingPenalty||0); return Math.max(1, buEst * expectedBushelPrice(world, key) * risk); } if (t.kind===TASK_KINDS.CartSheaves){ return 25; } if (t.kind===TASK_KINDS.CutCloverHay || t.kind===TASK_KINDS.CartHay){ const need = world.kpi.hay_days_cover < 45 ? 1.0 : 0.3; return 200 * need; } if (t.kind===TASK_KINDS.DrillPlot){ return 150; } if (t.kind===TASK_KINDS.SpreadManure){ return 60; } if (t.kind===TASK_KINDS.HoeRow){ return 20; } if (t.kind===TASK_KINDS.Thresh || t.kind===TASK_KINDS.Winnow){ const liquidity = world.cash < 5 ? 2.0 : 1.0; return 30 * liquidity; } if (t.kind===TASK_KINDS.GardenSow){ return 10; } if (t.kind===TASK_KINDS.Repair){ return 40; } return 10; }
  function reprioritiseByVPM(world){ if (!world.tasks?.month?.queued?.length) return; for (const t of world.tasks.month.queued){ const v = taskMarginalValue(world, t); const minutes = Math.max(1, t.estMin - t.doneMin); const vpm = v / minutes; t.priority = clamp(Math.max(t.priority||0, Math.round(vpm * 200)), 0, 30); if (world.calendar.day > t.latestDay) t.priority = Math.max(t.priority, 20); } world.tasks.month.queued.sort((a,b)=> (b.priority||0)-(a.priority||0)); }
  function advisorSuggestions(world){ const K = world.kpi, S = world.store; const sug = []; if (K.oats_days_cover < 25){ const daysToTarget = 45 - K.oats_days_cover; const dailyOats = (world.livestock.horses * RATION.HORSE.oats_bu) + (world.livestock.oxen * RATION.OX.oats_bu) + (world.livestock.geese * RATION.GOOSE.oats_bu) + (world.livestock.poultry* RATION.HEN.oats_bu); const buyQty = Math.ceil(Math.max(0, daysToTarget) * dailyOats); if (buyQty > 0) sug.push({ type:'buy', item:'oats_bu', qty: buyQty, reason:'Oats cover < 45 days' }); } if (K.seed_gaps.length){ for (const g of K.seed_gaps){ const item = `seed_${g.key.toLowerCase()}_bu`; sug.push({ type:'buy', item, qty: Math.ceil(g.short), reason:`Seed gap for ${g.key}` }); } } if (world.cash < 2 && (S.barley||0) > 40){ sug.push({ type:'sell', items:[{item:'barley_bu', qty:Math.floor(S.barley*0.1)}], reason:'Raise cash' }); } world.kpi.suggestions = sug; return sug; }
  function buy(world, item, qty){ const cost = qty * priceFor(item, world.calendar.month); if (world.cash < cost) return false; world.cash -= cost; switch(item){ case 'oats_bu': world.store.oats += qty; break; case 'seed_wheat_bu': world.store.seed.wheat += qty; break; case 'seed_barley_bu': world.store.seed.barley += qty; break; case 'seed_oats_bu': world.store.seed.oats += qty; break;} return true; }
  function advisorExecute(world, mode='auto'){ const sug = advisorSuggestions(world); for (const s of sug){ if (s.type==='buy'){ const ok = buy(world, s.item, s.qty); if (!ok){ world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.CartToMarket, parcelId: null, payload: [{ item:'barley_bu', qty: Math.min(world.store.barley||0, 40) }], latestDay: Math.min(20, world.calendar.day+3), estMin: WORK_MINUTES.CartToMarket, priority: 18 })); } } else if (s.type==='sell'){ world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.CartToMarket, parcelId: null, payload: s.items, latestDay: Math.min(20, world.calendar.day+2), estMin: WORK_MINUTES.CartToMarket, priority: 16 })); } } }

  // ===================== State Change Primitives =====================
  function applySowPenalty(world, p){ const d = world.calendar.day; const lateDays = Math.max(0, d - 16); if (lateDays > 0) p.status.lateSow = (p.status.lateSow||0) + lateDays; }
  function applyHarvestPenalty(world, p){ let penalty = 0; const m = world.calendar.month; if (p.status.targetHarvestM) { if (m < p.status.targetHarvestM) penalty = 0.05; if (m > p.status.targetHarvestM) penalty = 0.10; } p.status.harvestPenalty = Math.max(p.status.harvestPenalty||0, penalty); }
  function rowGrowthMultiplier(parcel, row, crop){ const m = row.moisture ?? parcel.soil.moisture; const fMoist = clamp01(1.2 - 2.0 * Math.abs(m - OPT_MOIST)); const n = parcel.soil.nitrogen; const fN = clamp01(0.6 + 1.6 * (n)); const fTilth = 1.0 + 0.30 * clamp01(parcel.status.tilth || 0); const fWeed = 1.0 - 0.50 * clamp01(row.weed || 0); const fComp = row.companion && row.companion.key === 'CLOVER' && crop.key === 'BARLEY' ? 1.05 : 1.0; return clamp01(fMoist) * fN * fTilth * fWeed * fComp; }
  function estimateParcelYieldBushels(parcel, crop){ const acres = parcel.acres || 0; const baseBuPerAcre = crop.baseYield; let avgWeed=0, avgMoist=parcel.soil.moisture, rows=parcel.rows||[]; if (rows.length){ for (const r of rows) avgWeed += (r.weed || 0); avgWeed /= rows.length; } const pseudoRow = { moisture: avgMoist, weed: avgWeed, companion: null }; const f = rowGrowthMultiplier(parcel, pseudoRow, crop); return Math.max(0, acres * baseBuPerAcre * f); }
  function estimateParcelYieldBushels_withTiming(world, parcel, crop){ let bu = estimateParcelYieldBushels(parcel, crop); if (parcel.status.lateSow) bu *= Math.max(0.8, 1 - 0.01*parcel.status.lateSow); if (parcel.status.harvestPenalty) bu *= (1 - parcel.status.harvestPenalty); if (parcel.status.lodgingPenalty) bu *= (1-parcel.status.lodgingPenalty); return bu; }
  function ploughParcel(world, p){ p.status.tilth = clamp01((p.status.tilth || 0) + PLOUGH_TILTH_DELTA); p.status.stubble = false; if (p.rows) for (const r of p.rows){ r.weed = clamp01((r.weed || 0) - 0.15); r._tilledOn = stamp(world); } p.status.lastPloughedOn = stamp(world); }
  function harrowParcel(world, p){ p.status.tilth = clamp01((p.status.tilth || 0) + HARROW_TILTH_DELTA); if (p.rows) for (const r of p.rows){ r.weed = clamp01((r.weed || 0) - 0.10); r._tilledOn = stamp(world); } p.status.lastHarrowedOn = stamp(world); }
  function sowParcelRows(world, p, payload){ const mainKey = payload?.crop; const compKey = payload?.companion; const main = CROPS[mainKey]; const comp  = compKey ? CROPS[compKey] : null; if (!main) return; for (const r of p.rows){ r.crop = main; r.growth = 0; r.weed = r.weed || 0; r.companion = comp || null; r.plantedOn = stamp(world); } p.status.cropNote = comp ? `${main.name} + ${comp.name}` : `${main.name}`; const nHit = (main.nUse < 0 ? 0.02 : 0.0); p.soil.nitrogen = clamp01(p.soil.nitrogen - nHit); applySowPenalty(world, p); p.status.lastPlantedOn = stamp(world); }
  function drillTurnips(world, p){ for (const r of p.rows){ r.crop = CROPS.TURNIPS; r.growth = 0; r.companion = null; r.plantedOn = stamp(world); r._tilledOn = stamp(world); } p.status.stubble = false; p.status.cropNote = 'Turnips (drilled)'; }
  function hoeParcelRows(world, p){ for (const r of p.rows){ r.weed = clamp01((r.weed || 0) + HOE_WEED_DELTA); p.status.tilth = clamp01((p.status.tilth || 0) + 0.05); } }
  function harvestParcelToSheaves(world, p){ if (p.fieldStore.sheaves > 0) return; applyHarvestPenalty(world, p); const row0 = p.rows?.[0]; if (!row0 || !row0.crop) return; const crop = row0.crop; const ready = p.rows.every(r => r.crop && r.growth >= 1.0); if (!ready) return; const bu = estimateParcelYieldBushels_withTiming(world, p, crop); p.fieldStore.sheaves += bu; p.fieldStore.cropKey = crop.key; for (const r of p.rows){ if (crop.key === 'BARLEY' && r.companion?.key === 'CLOVER'){ r.crop = null; r.growth = Math.max(r.growth, 0.2); } else { r.crop = null; r.companion = null; r.growth = 0; } } p.status.stubble = true; p.status.cropNote = `Stubble (${crop.name} sheaves on field)`; p.soil.nitrogen = clamp01(p.soil.nitrogen + (crop.nUse || 0)); }
  function cartSheaves(world, p){ const k = p.fieldStore.cropKey; const qty = p.fieldStore.sheaves || 0; if (!k || qty <= 0) return; world.storeSheaves[k] = (world.storeSheaves[k] || 0) + qty; p.fieldStore.sheaves = 0; p.fieldStore.cropKey = null; p.status.cropNote = 'Stubble (carted)'; }
  function stackRicks(world){ world.stackReady = true; }
  function threshSheaves(world, cropKey){ if (!world.stackReady) return; const klist = cropKey ? [cropKey] : Object.keys(world.storeSheaves); for (const k of klist){ const sheaves = world.storeSheaves[k] || 0; if (sheaves <= 0) continue; const grainBu = sheaves * (1 - THRESH_LOSS); world.storeSheaves[k] = 0; const cropName = Object.values(CROPS).find(c=>c.key === k)?.name.toLowerCase() || 'grain'; if(world.store[cropName] != undefined) world.store[cropName] += grainBu; world.store.straw += grainBu * (STRAW_PER_BUSHEL[k] || 1.0); } }
  function winnowGrain(world, cropKey){ const bump = 0.01; if (!cropKey || cropKey==='WHEAT')  world.store.wheat  *= (1 + bump); if (!cropKey || cropKey==='BARLEY') world.store.barley *= (1 + bump); if (!cropKey || cropKey==='OATS')   world.store.oats   *= (1 + bump); if (!cropKey || cropKey==='PULSES') world.store.pulses *= (1 + bump); }
  function spreadManure(world, p, nDelta){ p.soil.nitrogen = clamp01(p.soil.nitrogen + (nDelta ?? 0.08)); p.status.cropNote = (p.status.cropNote||'') + ' · manured'; }
  function foldSheepOn(world, p, days){ const credit = 0.02 * (days ?? 10); p.soil.nitrogen = clamp01(p.soil.nitrogen + credit); p.status.cropNote = 'Folded by sheep (winter)'; }
  function cutCloverHay(world, p){ const acres = p.acres||0; const mass_t = 1.5 * acres; p.hayCuring = { mass_t, dryness: 0, loss_t: 0 }; p.soil.nitrogen = Math.min(1, (p.soil.nitrogen||0) + 0.05); p.status.cropNote = 'Clover cut; curing'; }
  function cartHay(world, p){ const h = p.hayCuring; if (!h) return; const net = Math.max(0, h.mass_t - h.loss_t); world.store.hay += net; p.hayCuring = null; p.status.cropNote = 'Clover aftermath'; }
  function harvestOrchard(world) { const p = world.parcels[world.parcelByKey.orchard]; const tons = 2.0; world.store.fruit_dried += tons * 0.15 * 2204.6/200; world.store.cider_l += Math.round(tons * 500); p.status.cropNote = 'Orchard harvested'; }
  function priceFor(item, month){ const drift = (month>=6 && month<=8) ? +0.10 : 0; return (PRICES[item] || 0) * (1 + drift); }
  function cartToMarket(world, payload){ let revenue = 0; for (const line of payload||[]){ const { item, qty } = line; if (!qty) continue; switch(item){ case 'wheat_bu':   world.store.wheat  = Math.max(0, world.store.wheat  - qty); break; case 'barley_bu':  world.store.barley = Math.max(0, world.store.barley - qty); break; case 'oats_bu':    world.store.oats   = Math.max(0, world.store.oats   - qty); break; case 'pulses_bu':  world.store.pulses = Math.max(0, world.store.pulses - qty); break; case 'hay_t':      world.store.hay    = Math.max(0, world.store.hay    - qty); break; case 'straw_t':    world.store.straw  = Math.max(0, world.store.straw  - qty); break; case 'cider_l':    world.store.cider_l= Math.max(0, world.store.cider_l- qty); break; case 'meat_lb':    world.store.meat_salted = Math.max(0, world.store.meat_salted - qty); break; case 'bacon_side': world.store.bacon_sides = Math.max(0, world.store.bacon_sides - qty); break; default: continue; } revenue += qty * priceFor(item, world.calendar.month); } world.cash += revenue; }
  function clampRoots(world, p, payload){ log(world, 'Clamping roots...'); }
  function markGardenSown(world, p, payload){ p.status.cropNote = `Garden sown: ${payload.items.join(', ')}`; }
  function moveHerd(world, payload){ const herd = payload?.herd; const to = payload?.to; if (!herd || !to || !world.herdLoc[herd]) return; if (to === 'homestead'){ world.herdLoc[herd] = 'homestead'; } else if (world.parcelByKey[to] != null){ world.herdLoc[herd] = to; const p = world.parcels[world.parcelByKey[to]]; if (p) p.status.cropNote = (p.status.cropNote || '') + ` · ${herd} present`; attachPastureIfNeeded(p); } }
  function slaughter(world, payload){ const S = world.store, L = world.livestock; const sp = payload?.species, n = Math.max(0, payload?.count|0); if (!sp || n<=0 || !L[sp]) return; const take = Math.min(L[sp], n); L[sp] -= take; switch(sp){ case 'sheep':   S.meat_salted += take * 15; break; case 'geese':   S.meat_salted += take * 5;  break; case 'poultry': S.meat_salted += take * 2;  break; case 'cow':     S.meat_salted += take * 250; break; case 'pig':     S.bacon_sides += take * 2;   break; } }
  function doRepair(world, payload){} function doPrune(world, payload){}
  function applyTaskEffects(world, task){ const p = task.parcelId != null ? world.parcels[task.parcelId] : null; switch (task.kind){ case TASK_KINDS.PloughPlot: if (p) ploughParcel(world, p); break; case TASK_KINDS.HarrowPlot: if (p) harrowParcel(world, p); break; case TASK_KINDS.Sow: if (p) sowParcelRows(world, p, task.payload); break; case TASK_KINDS.DrillPlot: if (p) drillTurnips(world, p); break; case TASK_KINDS.HoeRow: if (p) hoeParcelRows(world, p); break; case TASK_KINDS.HarvestParcel: if (p) harvestParcelToSheaves(world, p); break; case TASK_KINDS.CartSheaves: if (p) cartSheaves(world, p); break; case TASK_KINDS.StackRicks: stackRicks(world); break; case TASK_KINDS.Thresh: threshSheaves(world, task.payload?.cropKey); break; case TASK_KINDS.Winnow: winnowGrain(world, task.payload?.cropKey); break; case TASK_KINDS.SpreadManure: if (p) spreadManure(world, p, task.payload?.nDelta || 0.08); break; case TASK_KINDS.FoldSheep: if (p) foldSheepOn(world, p, task.payload?.days || 10); break; case TASK_KINDS.ClampRoots: clampRoots(world, p, task.payload); break; case TASK_KINDS.GardenSow: if (p) markGardenSown(world, p, task.payload); break; case TASK_KINDS.MoveHerd: moveHerd(world, task.payload); break; case TASK_KINDS.Slaughter: slaughter(world, task.payload); break; case TASK_KINDS.CutCloverHay:  if (p) cutCloverHay(world, p); break; case TASK_KINDS.OrchardHarvest: harvestOrchard(world); break; case TASK_KINDS.Repair: doRepair(world, task.payload); break; case TASK_KINDS.Prune:  doPrune(world, task.payload);  break; case TASK_KINDS.CartHay: if (p) cartHay(world, p); break; case TASK_KINDS.CartToMarket: cartToMarket(world, task.payload); break; } }

  // ===================== Game Loop & Core Logic =====================
  function chooseFlex(world, option){ world.flexChoice = option; const key = 'flex', pid = world.parcelByKey[key]; const p = world.parcels[pid]; const payload = { crop: option }; const estMin = minutesFor(TASK_KINDS.Sow, p, payload); if (option === 'FLAX'){ world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.Sow, parcelId: pid, payload, latestDay: 10, estMin })); p.status.targetHarvestM = 4; } else { world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.Sow, parcelId: pid, payload, latestDay: 16, estMin })); p.status.targetHarvestM = 4; } }
  function chooseFlexAuto(world){ if ((world.store.oats||0) < 40) return chooseFlex(world, 'OATS'); return chooseFlex(world, 'FLAX'); }
  function generateMonthlyTasks(world, month){ const byKey = world.parcelByKey, P = world.parcels; const push = (kind, key, payload, latestDay, priority=5) => { const pid = key ? byKey[key] : null; const est = pid!=null ? minutesFor(kind, P[pid], payload) : WORK_MINUTES.Repair_perJob; world.tasks.month.queued.push(makeTask(world, { kind, parcelId: pid, payload, latestDay, estMin: est, priority })); }; switch(month){ case 1: push(TASK_KINDS.PloughPlot, 'barley_clover', {}, 10, 7); push(TASK_KINDS.HarrowPlot, 'barley_clover', {}, 12, 7); push(TASK_KINDS.Sow, 'barley_clover', { crop:'BARLEY', companion:'CLOVER' }, 16, 9); push(TASK_KINDS.Sow, 'pulses', { crop:'PULSES' }, 18, 8); push(TASK_KINDS.Sow, 'close_a', { crop:'OATS' }, 16, 8); push(TASK_KINDS.GardenSow, 'homestead', { items:['onions','cabbages','carrots'] }, 18, 4); push(TASK_KINDS.MoveHerd, null, { herd:'sheep', from:'turnips', to:'clover_hay' }, 4, 10); if (!world.flexChoice) chooseFlexAuto(world); break; case 2: push(TASK_KINDS.DrillPlot, 'turnips', {}, 10, 9); push(TASK_KINDS.HoeRow, 'pulses', {}, 18, 6); push(TASK_KINDS.HoeRow, 'close_a', {}, 18, 6); push(TASK_KINDS.GardenSow, 'homestead', { items:['succession'] }, 18, 3); push(TASK_KINDS.Repair, null, { scope:'hedge_ditch' }, 18, 2); if (!world.flexChoice) chooseFlexAuto(world); break; case 3: push(TASK_KINDS.CutCloverHay, 'clover_hay', {}, 16, 9); push(TASK_KINDS.HoeRow, 'turnips', {}, 18, 5); push(TASK_KINDS.GardenSow, 'homestead', { items:['maintenance'] }, 18, 3); push(TASK_KINDS.Prune, 'orchard', { light:true }, 18, 2); break; case 4: push(TASK_KINDS.HarvestParcel, 'barley_clover', {}, 16, 10); push(TASK_KINDS.CartSheaves,  'barley_clover', {}, 18, 9); push(TASK_KINDS.HarvestParcel, 'close_a', {}, 16, 9); push(TASK_KINDS.CartSheaves,  'close_a', {}, 18, 8); push(TASK_KINDS.HarvestParcel, 'pulses', {}, 18, 6); push(TASK_KINDS.CartSheaves,   'pulses', {}, 19, 5); if (world.flexChoice) { push(TASK_KINDS.HarvestParcel, 'flex', {}, 18, 7); push(TASK_KINDS.CartSheaves, 'flex', {}, 19, 6); } push(TASK_KINDS.StackRicks, null, {}, 20, 6); break; case 5: push(TASK_KINDS.HarvestParcel, 'wheat', {}, 12, 10); push(TASK_KINDS.CartSheaves,   'wheat', {}, 16, 9); push(TASK_KINDS.StackRicks,    null,    {}, 18, 8); push(TASK_KINDS.OrchardHarvest,'orchard', {}, 18, 5); push(TASK_KINDS.ClampRoots,    'close_c', { tons:2.5 }, 20, 4); break; case 6: push(TASK_KINDS.PloughPlot, 'wheat', {}, 8, 8); push(TASK_KINDS.SpreadManure, 'wheat', { nDelta:0.10 }, 10, 7); push(TASK_KINDS.Sow, 'wheat', { crop:'WHEAT' }, 14, 9); push(TASK_KINDS.ClampRoots, 'close_c', { tons:2.5 }, 18, 5); push(TASK_KINDS.Thresh, null, {}, 20, 4); break; case 7: push(TASK_KINDS.MoveHerd, null, { herd:'sheep', from:'clover_hay', to:'turnips' }, 4, 10); push(TASK_KINDS.FoldSheep, 'turnips', { days:10 }, 12, 8); push(TASK_KINDS.Slaughter, null, { species:'geese', count:6 }, 14, 4); push(TASK_KINDS.Repair, null, { scope:'tools_wagon_fences' }, 20, 3); break; case 8: push(TASK_KINDS.Thresh, null, {}, 16, 7); push(TASK_KINDS.Winnow, null, {}, 18, 6); push(TASK_KINDS.Prune, 'orchard', { winter:true }, 18, 4); push(TASK_KINDS.Repair, null, { scope:'general' }, 20, 3); break; } }
  function onNewMonth(world){ world.tasks.month = { queued: [], active: [], done: [], overdue: [] }; world.labour.usedMin = 0; world.nextTaskId = (world.calendar.month === 1 && world.calendar.day === 1) ? 0 : (world.nextTaskId || 0); generateMonthlyTasks(world, world.calendar.month); }
  function midMonthReprioritise(world){ if (world.calendar.day !== 10) return; const urgent = world.tasks.month.queued.filter(t => t.latestDay <= 14).length; const labourUsed = world.labour.usedMin / world.labour.monthBudgetMin; if (urgent > 0 && labourUsed < 0.35){ world.tasks.month.queued = world.tasks.month.queued.filter(t => { if (['Repair','Prune','GardenSow'].includes(t.kind)) { t.priority = 0; t.latestDay = 20; return true; } return true; }); } }

  function planDay(world){
      updateKPIs(world);
      reprioritiseByVPM(world);
      if (world.advisor?.enabled && world.advisor.mode === 'auto') {
        advisorExecute(world);
      }
      planDayMonthly(world);
      world.farmer.queue = [];
      const firstActiveTask = findTaskById(world, world.farmer.activeWork.find(id => id));
      if (firstActiveTask && firstActiveTask.parcelId != null) {
          const parcel = world.parcels[firstActiveTask.parcelId];
          if (parcel) {
              world.farmer.queue.push({type: TASK_KINDS.MOVE, x: parcel.x + 2, y: parcel.y + 2});
              world.farmer.task = `Overseeing: ${firstActiveTask.kind}`;
          }
      } else if (world.tasks.month.active.length > 0) {
          world.farmer.task = 'Overseeing non-field task';
      } else if (world.tasks.month.queued.length > 0) {
          world.farmer.task = 'Waiting for next task';
      } else {
          world.farmer.task = 'Idle';
      }
  }

  function processFarmerMinute(world){
    const f = world.farmer;
    if(f.moveTarget && (!f.path || f.path.length === 0)){ f.path = findPath(world.pathGrid, {x: f.x, y: f.y}, f.moveTarget); if (!f.path) { log(world, `Cannot find path to ${f.moveTarget.x},${f.moveTarget.y}. Aborting move.`); f.moveTarget = null; f.queue = []; } }
    if (f.path && f.path.length > 0) { for (let i = 0; i < CONFIG.FARMER_SPEED; i++) { if (f.path.length > 0) { const nextPos = f.path.shift(); f.x = nextPos.x; f.y = nextPos.y; } } if (f.path.length === 0) f.moveTarget = null; return; }
    const next=f.queue.shift(); if (next && next.type===TASK_KINDS.MOVE) f.moveTarget={x:next.x,y:next.y};
  }

  function pastureRegrow(world){ const m = world.calendar.month; for (const p of world.parcels){ if (!p.pasture) continue; const canRegrow = (p.key === 'clover_hay') || (p.status.cropNote?.includes('aftermath')); if (!canRegrow) continue; const add = isGrowingMonth(m) ? (PASTURE.REGROW_T_PER_ACRE_PER_DAY * p.acres) : 0; const cap = p.acres * PASTURE.MAX_BIOMASS_T_PER_ACRE; p.pasture.biomass_t = Math.min(cap, p.pasture.biomass_t + add); p.pasture.grazedToday_t = 0; } }
  function grazeIfPresent(world, parcelKey, heads, consPerHeadT){ const id = world.parcelByKey[parcelKey]; if (id == null) return 0; const p = world.parcels[id]; attachPastureIfNeeded(p); const want = heads * consPerHeadT; const take = Math.min(want, p.pasture.biomass_t); p.pasture.biomass_t -= take; p.pasture.grazedToday_t += take; return take; }
  function consumeLivestock(world){ const S = world.store; const L = world.livestock; const H = world.herdLoc; if (!S || !L || !H) return; world.alerts = []; let pastureT = 0; if (H.sheep === 'clover_hay'){ pastureT += grazeIfPresent(world, 'clover_hay', L.sheep, PASTURE.SHEEP_CONS_T_PER_DAY); } if (H.geese === 'orchard'){ pastureT += grazeIfPresent(world, 'orchard', L.geese, PASTURE.GOOSE_CONS_T_PER_DAY); } const oatsNeed_bu = (L.horses * RATION.HORSE.oats_bu) + (L.oxen * RATION.OX.oats_bu) + (L.geese * RATION.GOOSE.oats_bu) + (L.poultry* RATION.HEN.oats_bu); const oatsDraw_bu = Math.min(S.oats, oatsNeed_bu); S.oats = Math.max(0, S.oats - oatsDraw_bu); const hayNeed_t = (L.horses * RATION.HORSE.hay_t) + (L.oxen * RATION.OX.hay_t) + (L.cows * RATION.COW.hay_t) + (H.sheep === 'clover_hay' ? 0 : L.sheep * RATION.SHEEP.hay_t); const hayDraw_t = Math.min(S.hay, Math.max(0, hayNeed_t - pastureT)); S.hay = Math.max(0, S.hay - hayDraw_t); const eggsDoz = Math.max(0, Math.round((L.poultry * 0.5) / 12)); S.eggs_dozen += eggsDoz; const manureUnits = (L.horses * MANURE.HORSE) + (L.oxen * MANURE.OX) + (L.cows * MANURE.COW) + (L.sheep * MANURE.SHEEP) + (L.geese * MANURE.GOOSE) + (L.poultry* MANURE.HEN); S.manure_units = (S.manure_units || 0) + manureUnits; if (S.oats < 10) world.alerts.push('Oats low'); if (S.hay  < 1)  world.alerts.push('Hay low'); }
  function generateWeatherToday(world){ const m = world.calendar.month, rng = world.rng; const base = WX_BASE[m]; const temp = base.tMean + 3.0*randomNormal(rng); const wetChance = 0.45 + (base.rainMean-2.0)*0.06; const rain = (rng() < wetChance) ? Math.max(0, base.rainMean + 5*randomNormal(rng)) : 0; const wind = Math.max(0, 2 + 2*randomNormal(rng)); const frost = (m<=2) && (temp < 2) && (rng()<0.3); world.weather.tempC = temp; world.weather.rain_mm = Math.max(0, rain); world.weather.wind_ms = wind; world.weather.frostTonight = !!frost; world.weather.dryStreakDays = (rain<=0.2) ? (world.weather.dryStreakDays+1) : 0; }
  function updateSoilWaterDaily(world){ const W = world.weather; const rain = W.rain_mm; const etp = WX_BASE[world.calendar.month].etp; for (const p of world.parcels){ let m = p.soil.moisture; const hasCanopy = p.rows?.some(r => r.crop && (r.growth||0) > 0.15); const infil = rain * SOIL.INFIL_PER_MM * (hasCanopy ? 0.8 : 1.0); m += infil; const evap = etp * 0.02 * (hasCanopy ? 1.0 : 0.6); m -= evap; if (m > SOIL.FIELD_CAP) m -= SOIL.DRAIN_RATE * (m - SOIL.FIELD_CAP); m = Math.max(0, Math.min(SOIL.SAT, m)); p.soil.moisture = m; p.status.mud = moistureToMud(m); } }
  function updateHayCuring(world){ const w = world.weather; for (const p of world.parcels){ const h = p.hayCuring; if (!h) continue; if (w.rain_mm <= 0.2){ const base = 0.22; const windBonus = Math.min(0.10, 0.02 * Math.max(0, w.wind_ms - 2)); const tempBonus = Math.max(0, (w.tempC - 12) * 0.01); h.dryness = Math.min(1, h.dryness + base + windBonus + tempBonus); } else { h.dryness = Math.max(0, h.dryness - 0.15); h.loss_t += Math.min(h.mass_t * 0.03, 0.1); } } }
  function dailyWeatherEvents(world){ const w = world.weather, m = world.calendar.month; if (w.frostTonight){ const g = world.parcels[world.parcelByKey.homestead]; g.status.frost = (g.status.frost||0)+1; const o = world.parcels[world.parcelByKey.orchard]; o.status.frostBites = (o.status.frostBites||0)+1; } if (m>=3 && m<=5 && w.wind_ms >= 10){ const hit = []; for (const key of ['barley_clover','close_a','pulses','flex','wheat']){ const p = world.parcels[world.parcelByKey[key]]; if (!p || !p.rows?.length) continue; const matureish = p.rows.some(r => r.crop && r.growth > 0.6); if (matureish && (p.status.mud||0) > 0.2){ p.status.lodgingPenalty = Math.max(p.status.lodgingPenalty||0, 0.08 + 0.04*Math.random()); hit.push(p.name); } } if (hit.length) (world.alerts = world.alerts||[]).push(`Storm lodging: ${hit.join(', ')}`); } }

  function dailyTurn(world){
    generateWeatherToday(world);
    updateSoilWaterDaily(world);
    pastureRegrow(world);
    updateHayCuring(world);
    consumeLivestock(world);
    midMonthReprioritise(world);

    for (const p of world.parcels){ if (!p.rows.length) continue;
      const s = seasonOfMonth(world.calendar.month); let sf = 1.0; if (s === 'Winter') sf=0.15; else if (s === 'Autumn') sf=0.75; if (world.weather.label==='Hot') sf*=(0.85); if (world.weather.label==='Snow') sf*=0.85; if (world.weather.label==='Rain'||world.weather.label==='Storm') sf*=1.05;
      let sumNUse = 0; for (const row of p.rows){ row.moisture = lerp(row.moisture, p.soil.moisture, 0.5); row.weed = clamp01((row.weed || 0) + 0.002); const crop = row.crop; if (crop) { sumNUse += crop.nUse; const baseRate = 1 / (crop.baseDays * (world.daylight.dayLenHours * 60)); row.growth = clamp01(row.growth + baseRate * MINUTES_PER_DAY * sf * rowGrowthMultiplier(p, row, crop)); } }
      const baseRecover = 0.003 * Math.max(0, 1 - p.soil.nitrogen); const legumeCredit = p.rows.length > 0 ? 0.010 * Math.max(0, sumNUse)/p.rows.length : 0; const uptake = p.rows.length > 0 ? 0.006 * Math.max(0, -sumNUse)/p.rows.length : 0; p.soil.nitrogen = clamp01(p.soil.nitrogen + baseRecover + legumeCredit - uptake);
    }
    world.calendar.day++; if (world.calendar.day > DAYS_PER_MONTH){ world.calendar.day = 1; world.calendar.month++; if (world.calendar.month > MONTHS_PER_YEAR){ endOfYear(world); world.calendar.month = 1; world.calendar.year++; } onNewMonth(world); }
    world.daylight = computeDaylightByIndex((world.calendar.day - 1) + (world.calendar.month - 1) * DAYS_PER_YEAR);
    if (world.store.wheat > 0) world.store.wheat = Math.max(0, world.store.wheat - DEMAND.household_wheat_bu_per_day);
    
    dailyWeatherEvents(world);
    endOfDayMonth(world);
    updateKPIs(world);
    planDay(world);
    autosave(world);
  }
  function endOfYear(world){ log(world, `Year ${world.calendar.year} ended. Cleaning fields...`); for(const p of world.parcels) { if (!p.rows.length) continue; for (let rIdx = 0; rIdx < p.rows.length; rIdx++) { const row = p.rows[rIdx]; if (row.crop && row.growth >= 0.85) { const c = row.crop; const nNorm = clamp(p.soil.nitrogen / N_MAX, 0, 1); const nFactor = lerp(0.4, 1.1, nNorm); const moistFactor = clamp(lerp(0.6, 1.1, row.moisture), 0.5, 1.1); const yieldUnits = Math.round((c.baseYield * p.acres / p.rows.length) * moistFactor * nFactor * 0.5); if (c.type === 'grain') world.store[c.name.split('/')[0].toLowerCase()] += yieldUnits; else if (c.type === 'root') world.store.turnips += yieldUnits; else if (c.type === 'legume') world.store.hay += Math.round(yieldUnits * 0.8); log(world, `Salvaged ${p.name}, Row ${rIdx+1}: +${yieldUnits} ${c.type}.`); } row.crop = null; row.companion = null; row.growth = 0; row.plantedOn = null; row.harvested = false; row.moisture = p.soil.moisture; } if (p.kind === PARCEL_KIND.ARABLE && p.rotationIndex != null) p.rotationIndex=(p.rotationIndex+1)%ROTATION.length; p.soil.moisture=clamp01(p.soil.moisture+0.1); } log(world, `Rotation advanced for new year.`); }

  // ===================== Rendering =====================
  function blankBuffer(w,h){ const buf=new Array(h); const styleBuf=new Array(h); for(let y=0;y<h;y++){ buf[y]=new Array(w); styleBuf[y]=new Array(w); } return {buf, styleBuf}; }
  function putStyled(buf, styleBuf, x, y, ch, sid){ if (x>=0 && x<SCREEN_W && y>=0 && y<SCREEN_H){ buf[y][x] = ch; styleBuf[y][x] = sid; } }
  function label(buf, styleBuf, x, y, text, sid){ x=Math.max(0, x); const avail=SCREEN_W-x; if (text.length > avail) text = avail > 1 ? text.slice(0, avail - 1) + '…' : text.slice(0, avail); for (let i=0;i<text.length;i++) putStyled(buf, styleBuf, x+i, y, text[i], sid); }
  function cropStageIndex(g){ if (g <= 0.05) return 0; if (g < 0.20) return 1; if (g < 0.40) return 2; if (g < 0.70) return 3; if (g < 1.00) return 4; return 5; }
  function fmtHM(min){ const h=String(Math.floor(min/60)).padStart(2,'0'); const m=String(min%60).padStart(2,'0'); return `${h}:${m}`; }
  function drawBar(buf, styleBuf, x, y, pct, width, low=0.33, mid=0.66){ const filled = Math.round(clamp01(pct) * width); for (let i=0;i<width;i++){ const sid = (pct<low?SID.BAR_LOW:pct<mid?SID.BAR_MID:SID.BAR_HIGH); putStyled(buf, styleBuf, x+i, y, i<filled ? '#':' ', sid); } }
  function parcelAverages(p){ if (!p.rows.length) return { growth:0, moisture:p.soil.moisture, nitrogen:p.soil.nitrogen }; let g=0,m=0; for (const r of p.rows){ g+=r.growth; m+=r.moisture; } return { growth:g/p.rows.length, moisture:m/p.rows.length, nitrogen:p.soil.nitrogen }; }
  function monthHudInfo(world){ const u = world.labour.usedMin, b = world.labour.monthBudgetMin; const q = world.tasks.month.queued.length; const a = world.tasks.month.active.length; const o = world.tasks.month.overdue.length; const next = world.tasks.month.queued[0]; const nextTxt = next ? `${next.kind} d${next.latestDay}` : '—'; return { u,b,q,a,o,nextTxt }; }
  function advisorHud(world){ const K = world.kpi; return [ `Cover—Oats:${K.oats_days_cover|0}d Hay:${K.hay_days_cover|0}d Wheat:${K.wheat_days_cover|0}d`, `Month—Req:${K.month_required_min_left.toLocaleString()}m · Workable:${K.month_workable_min_left.toLocaleString()}m · Pressure:${(K.labour_pressure*100|0)}%`, `Risk:${(K.deadline_risk*100|0)}% · Warn:${K.warnings.join(';')||'—'}` ].join(' | '); }
  
  function flushLine(chars, styles){
    let html = '';
    let i = 0;
    while (i < chars.length){
      const sid = styles[i] ?? SID.HUD_TEXT;
      let j = i+1;
      while (j < chars.length && styles[j] === sid) j++;
      const chunk = chars.slice(i, j).join('');
      const text = chunk.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const isRipe = (sid >= SID.T_S5 && sid <= SID.F_S5) || sid === SID.T_BULB;
      const ripeClass = isRipe ? ' ripe-pulse' : '';
      html += `<span class="s${sid}${ripeClass}">${text}</span>`;
      i = j;
    }
    return html;
  }

  function renderColored(world){
    if (world.paused || world.snapCamera){ world.camera.x = clamp(world.farmer.x - SCREEN_W/2, 0, CONFIG.WORLD.W - SCREEN_W); world.camera.y = clamp(world.farmer.y - SCREEN_H/2, 0, CONFIG.WORLD.H - SCREEN_H); }
    else { world.camera.x = lerp(world.camera.x, clamp(world.farmer.x - SCREEN_W / 2,0,CONFIG.WORLD.W - SCREEN_W), CAMERA_LERP); world.camera.y = lerp(world.camera.y, clamp(world.farmer.y - SCREEN_H / 2,0,CONFIG.WORLD.H - SCREEN_H), CAMERA_LERP); }
    const camX = Math.round(world.camera.x), camY = Math.round(world.camera.y); const {buf, styleBuf} = blankBuffer(SCREEN_W, SCREEN_H);
    const avgMoisture = world.parcels.reduce((a,p)=>a+p.soil.moisture,0)/world.parcels.length;
    const s = seasonOfMonth(world.calendar.month); const bias = (s==='Summer'? +0.08 : s==='Winter'? -0.08 : 0);
    for(let y=0; y<SCREEN_H; y++) for(let x=0; x<SCREEN_W; x++) { const tileJitter = (hash01(x + camX, y + camY, world.seed) - 0.5) * 0.1; const v = clamp(avgMoisture + bias + tileJitter, 0, 1); const sid = v<0.30?SID.GRASS_DRY : v<0.55?SID.GRASS_NORMAL : v<0.80?SID.GRASS_LUSH : SID.GRASS_VERY_LUSH; putStyled(buf, styleBuf, x, y, GRASS_GLYPHS[sid] || '.', sid); }
    for (const p of world.parcels) { if (!p.rows.length) continue; let sSid = p.soil.moisture > 0.6 ? SID.SOIL_MOIST : SID.SOIL_UNTILLED; if (isToday(p.status.lastPlantedOn, world)) sSid = SID.SOIL_TILLED; for(let y = p.y+1; y < p.y+p.h-1; y++) for(let x = p.x+1; x < p.x+p.w-1; x++) putStyled(buf, styleBuf, x-camX, y-camY, '.', sSid); }
    const houseSX = HOUSE.x - camX, houseSY = HOUSE.y - camY; if (houseSX + HOUSE.w >= 0 && houseSX <= SCREEN_W && houseSY + HOUSE.h >= 0 && houseSY <= SCREEN_H){ for(let y = houseSY+1; y < houseSY+HOUSE.h-1; y++) for(let x = houseSX+1; x < houseSX+HOUSE.w-1; x++) putStyled(buf, styleBuf, x, y, '=', SID.WOOD_FLOOR); for (let i=1;i<HOUSE.w-1;i++){ putStyled(buf,styleBuf,houseSX+i,houseSY, '-', SID.BORDER); putStyled(buf,styleBuf,houseSX+i,houseSY+HOUSE.h-1, '-', SID.BORDER); } for (let i=1;i<HOUSE.h-1;i++){ putStyled(buf,styleBuf,houseSX,houseSY+i, '|', SID.BORDER); putStyled(buf,styleBuf,houseSX+HOUSE.w-1,houseSY+i, '|', SID.BORDER); } putStyled(buf,styleBuf,houseSX,houseSY,'+',SID.BORDER); putStyled(buf,styleBuf,houseSX+HOUSE.w-1,houseSY,'+',SID.BORDER); putStyled(buf,styleBuf,houseSX,houseSY+HOUSE.h-1,'+',SID.BORDER); putStyled(buf,styleBuf,houseSX+HOUSE.w-1,houseSY+HOUSE.h-1,'+',SID.BORDER); const midx = houseSX + Math.floor(HOUSE.w/2); for(let i=1; i < HOUSE.h-1; i++) putStyled(buf, styleBuf, houseSX+6, houseSY+i, '|', SID.HOUSE_WALL); putStyled(buf,styleBuf,midx, houseSY+HOUSE.h-1, ' ', SID.DOOR); putStyled(buf,styleBuf,midx-1, houseSY+HOUSE.h-1, ' ', SID.DOOR); putStyled(buf,styleBuf, houseSX + Math.floor(HOUSE.w/2) - 2, houseSY+HOUSE.h-1, '-', SID.DOOR); putStyled(buf,styleBuf, houseSX + Math.floor(HOUSE.w/2) + 1, houseSY+HOUSE.h-1, '-', SID.DOOR); label(buf,styleBuf, houseSX+1, houseSY+1, 'Bed', SID.HOUSE_WALL); label(buf,styleBuf, houseSX+8, houseSY+1, 'Living', SID.HOUSE_WALL); }
    const wellSX = WELL.x-camX, wellSY = WELL.y-camY; if (wellSX+4>=0&&wellSX-3<=SCREEN_W) { putStyled(buf, styleBuf, wellSX - 1, wellSY, 'O', SID.WELL_WATER); label(buf, styleBuf, wellSX - 3, wellSY + 1, 'WELL', SID.WELL_TEXT); }
    for (const p of world.parcels){ let pLabel = `[${p.name}]`; if (p.fieldStore.sheaves > 0) { pLabel += ` · Sheaves: ${Math.floor(p.fieldStore.sheaves)}`; } if (p.pasture && p.pasture.biomass_t > 0) { pLabel += ` · Pasture: ${p.pasture.biomass_t.toFixed(2)}t`; } if (p.status.mud > 0.35) pLabel += ' MUD'; if (p.hayCuring) pLabel += ` Hay cure ${(p.hayCuring.dryness*100)|0}% (loss ${p.hayCuring.loss_t.toFixed(2)} t)`; const pSX = p.x-camX, pSY = p.y-camY; if (pSX+p.w<0||pSX>SCREEN_W||pSY+p.h<0||pSY>SCREEN_H) continue; for (let i=1;i<p.w-1;i++){ putStyled(buf,styleBuf,pSX+i,pSY, '-', SID.BORDER); putStyled(buf,styleBuf,pSX+i,pSY+p.h-1, '-', SID.BORDER); } for (let i=1;i<p.h-1;i++){ putStyled(buf,styleBuf,pSX,pSY+i, '|', SID.BORDER); putStyled(buf,styleBuf,pSX+p.w-1,pSY+i, '|', SID.BORDER); } putStyled(buf,styleBuf,pSX,pSY,'+',SID.BORDER); putStyled(buf,styleBuf,pSX+p.w-1,pSY,'+',SID.BORDER); putStyled(buf,styleBuf,pSX,pSY+p.h-1,'+',SID.BORDER); putStyled(buf,styleBuf,pSX+p.w-1,pSY+p.h-1,'+',SID.BORDER); label(buf, styleBuf, pSX+2, pSY, pLabel, SID.MIXED_LABEL); if (p.rows.length > 0) { for (let r=0;r<p.rows.length;r++){ const row = p.rows[r]; const stage = cropStageIndex(row.growth); if (!row.crop) continue; let glyph, sid; if (stage === 0 && isToday(row._tilledOn, world)) { glyph = '.'; sid = SID.SOIL_TILLED; } else { glyph = CROP_GLYPHS[row.crop.key][stage]; sid = SID_BY_CROP[row.crop.key][stage]; } const {sy,ey}=rowBand(p, r); for(let yy=sy;yy<=ey;yy++) for(let xx=p.x+1;xx<p.x+p.w-1;xx++) { let finalSid = sid; let finalGlyph = glyph; if (row.crop.key === 'T' && stage === 5) { const u = hash01(xx, yy, world.seed); if (u < 0.15) { finalSid = SID.T_BULB; finalGlyph = 'O'; } } if (row._irrigatedOn && isToday(row._irrigatedOn, world)) { if (hash01(xx, yy, 0x9E3779B1 ^ world.seed ^ world.calendar.day) < 0.07) finalSid = SID.WELL_WATER; } putStyled(buf, styleBuf, xx-camX, yy-camY, finalGlyph, finalSid); } } const avg = parcelAverages(p); const barY = pSY + p.h - 2; label(buf, styleBuf, pSX+2, barY, 'M:', SID.HUD_TEXT); drawBar(buf, styleBuf, pSX+5, barY, avg.moisture, 10); label(buf, styleBuf, pSX+17, barY, 'N:', SID.HUD_TEXT); drawBar(buf, styleBuf, pSX+20, barY, clamp01(avg.nitrogen / N_MAX), 10); } else { label(buf, styleBuf, pSX+2, pSY+2, p.status.cropNote.slice(0, p.w-4), SID.HUD_TEXT); } }
    putStyled(buf, styleBuf, world.farmer.x - camX, world.farmer.y - camY, '@', SID.FARMER);
    const {day,month,year,minute} = world.calendar; const dateStr = `Y${year} M${MONTH_NAMES[month-1]} D${day}/${DAYS_PER_MONTH}`; const timeStr = `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`; const {tempC, rain_mm, wind_ms, dryStreakDays} = world.weather; const weatherStr = `T ${tempC.toFixed(0)}°C · Rain ${rain_mm.toFixed(1)}mm · Wind ${wind_ms.toFixed(1)}m/s · Dry ${dryStreakDays}d`; label(buf,styleBuf,2,0, `${dateStr} ${timeStr} | ${weatherStr}`, SID.HUD_TEXT);
    const dl = world.daylight; const sunStr = `Sun:${fmtHM(dl.sunrise)}–${fmtHM(dl.sunset)}`; const flexStr = `Flex: ${world.flexChoice || 'pending'}`; const cashStr = `Cash: £${world.cash.toFixed(2)}`; label(buf,styleBuf, 2, 1, `${sunStr} | ${flexStr} | ${cashStr}`, SID.HUD_TEXT);
    const store = world.store; const sh = world.storeSheaves; const sheafStr = `Sheaves: W:${Math.floor(sh.WHEAT)} B:${Math.floor(sh.BARLEY)} O:${Math.floor(sh.OATS)} P:${Math.floor(sh.PULSES)}`; label(buf,styleBuf, 2, 2, sheafStr, SID.HUD_TEXT);
    const storeStr = `Grain: W:${Math.floor(store.wheat)} B:${Math.floor(store.barley)} O:${Math.floor(store.oats)} | Hay:${store.hay.toFixed(2)}t Str:${Math.floor(store.straw)} Manure:${Math.floor(store.manure_units)}`; label(buf,styleBuf, 2, 3, storeStr.slice(0, SCREEN_W-4), SID.HUD_TEXT);
    label(buf,styleBuf, 2, 4, `Task: ${world.farmer.task}`, SID.HUD_TEXT);
    const hud = monthHudInfo(world); const pct = Math.floor(100*hud.u/hud.b); const laborStr = `M-${month} Labour (${pct}%):`; label(buf,styleBuf, 2, 5, laborStr, SID.HUD_TEXT); drawBar(buf, styleBuf, 2+laborStr.length+1, 5, hud.u/hud.b, 12); label(buf,styleBuf, 2+laborStr.length+1+12+1, 5, `A:${hud.a} Q:${hud.q} O:${hud.o} Next: ${hud.nextTxt}`, SID.HUD_TEXT);
    label(buf, styleBuf, 2, 6, advisorHud(world), SID.HUD_TEXT);
    if (world.showPanel){ let sy = SCREEN_H - 15; label(buf,styleBuf, 2, sy++, 'Parcels: [Name]          Acres  Status/Note', SID.HUD_TEXT); const maxLines = Math.max(0, SCREEN_H - sy - 2); for (const p of world.parcels.slice(0, maxLines)){ let status = p.status.cropNote || '(no status)'; if (p.rows.length) { const avgG=Math.round(parcelAverages(p).growth*100).toString().padStart(3)+'%'; const targetM = p.status.targetHarvestM ? `TH:M${p.status.targetHarvestM}` : ''; const lateS = p.status.lateSow > 0 ? `Late+${p.status.lateSow}`: ''; status = `Growth ${avgG} ${targetM} ${lateS}`; } label(buf,styleBuf, 2, sy++, `${p.name.padEnd(22)} ${String(p.acres).padStart(2)}ac   ${status.slice(0,30)}`, SID.HUD_TEXT); } }
    let timeModeStr = `Mode: ${TIMECTRL.mode}`; if(TIMECTRL.mode === 'scaled') timeModeStr += ` x${TIMECTRL.minutesPerFrame}`; if(TIMECTRL.mode === 'ff') timeModeStr += ` (${TIMECTRL.ff.daysRemaining}d)`; label(buf,styleBuf, SCREEN_W-timeModeStr.length-2, 0, timeModeStr, SID.HUD_TEXT);
    label(buf,styleBuf, SCREEN_W-26, SCREEN_H-2, '[H] help  [Space] pause', SID.HUD_TEXT);
    return {buf, styleBuf};
  }

  // ===================== Save & Load =====================
  const SAVE_VERSION = 1;
  function serializeTask(world, t){
    return {
      id: t.id,
      kind: t.kind,
      parcelKey: t.parcelId != null ? world.parcels[t.parcelId].key : null,
      payload: t.payload ?? null,
      latestDay: t.latestDay, estMin: t.estMin, doneMin: t.doneMin,
      priority: t.priority, status: t.status
    };
  }
  function toSnapshot(world){
    return {
      version: SAVE_VERSION,
      seed: world.seed,
      rngState: world.rng.state(),
      calendar: { month: world.calendar.month, day: world.calendar.day, year: world.calendar.year ?? 1, minute: world.calendar.minute },
      labour: { usedMin: world.labour.usedMin, monthBudgetMin: world.labour.monthBudgetMin, crewSlots: world.labour.crewSlots },
      parcels: world.parcels.map(p => ({
        key: p.key,
        soil: p.soil,
        status: p.status,
        rows: (p.rows||[]).map(r => ({
          crop: r.crop?.key ?? null,
          companion: r.companion?.key ?? null,
          growth: r.growth, moisture: r.moisture, weed: r.weed,
          plantedOn: r.plantedOn
        })),
        fieldStore: p.fieldStore,
        pasture: p.pasture ?? null,
        hayCuring: p.hayCuring ?? null
      })),
      store: world.store,
      storeSheaves: world.storeSheaves,
      stackReady: world.stackReady ?? false,
      livestock: world.livestock,
      herdLoc: world.herdLoc,
      weather: world.weather,
      tasks: {
        queued: world.tasks.month.queued.map(t => serializeTask(world, t)),
        active: world.tasks.month.active.map(t => serializeTask(world, t)),
        done:   world.tasks.month.done.map(t => serializeTask(world, t)),
        overdue: world.tasks.month.overdue.map(t => serializeTask(world, t)),
      },
      nextTaskId: world.nextTaskId ?? 1,
      flexChoice: world.flexChoice ?? null,
      cash: world.cash ?? 0,
      advisor: world.advisor ?? { enabled:true, mode:'auto' },
    };
  }
  function fromSnapshot(snap){
    if (snap.version !== SAVE_VERSION) { console.warn('Save version mismatch.'); return makeWorld(getSeedFromURL()); }
    const world = makeWorld(snap.seed);
    world.rng.set(snap.rngState);
    world.calendar = { ...snap.calendar };
    world.labour = { ...snap.labour };
    const parcelMap = {};
    world.parcels.forEach(p => parcelMap[p.key] = p);
    snap.parcels.forEach(sp => {
      const p = parcelMap[sp.key];
      if(p) {
        Object.assign(p.soil, sp.soil);
        Object.assign(p.status, sp.status);
        p.rows = (sp.rows||[]).map(r => ({
            crop: r.crop ? CROPS[r.crop] : null,
            companion: r.companion ? CROPS[r.companion] : null,
            growth: r.growth, moisture:r.moisture, weed:r.weed,
            plantedOn: r.plantedOn
        }));
        p.fieldStore = { ...(sp.fieldStore||{sheaves:0,cropKey:null}) };
        p.pasture = sp.pasture ? { ...sp.pasture } : null;
        p.hayCuring = sp.hayCuring ? { ...sp.hayCuring } : null;
      }
    });

    world.store = { ...snap.store };
    world.storeSheaves = { ...snap.storeSheaves };
    world.stackReady = !!snap.stackReady;
    world.livestock = { ...snap.livestock };
    world.herdLoc = { ...snap.herdLoc };
    world.weather = { ...snap.weather };

    world.nextTaskId = snap.nextTaskId ?? 1;
    const inflate = (st) => st.map(t => ({
      id: t.id, kind: t.kind,
      parcelId: t.parcelKey!=null ? world.parcelByKey[t.parcelKey] : null,
      payload: t.payload, latestDay: t.latestDay,
      estMin: t.estMin, doneMin: t.doneMin,
      priority: t.priority, status: t.status,
    }));
    world.tasks = { month: {
      queued: inflate(snap.tasks.queued),
      active: inflate(snap.tasks.active),
      done:   inflate(snap.tasks.done),
      overdue:inflate(snap.tasks.overdue)
    }};

    world.flexChoice = snap.flexChoice ?? null;
    world.cash = snap.cash ?? 0;
    world.advisor = snap.advisor ?? { enabled:true, mode:'auto' };

    kpiInit(world);
    return world;
  }
  function saveToLocalStorage(world, key='farmSave'){
    const json = JSON.stringify(toSnapshot(world));
    localStorage.setItem(key, json);
    log(world, "Game saved to browser storage.");
  }
  function loadFromLocalStorage(key='farmSave'){
    const json = localStorage.getItem(key);
    if (!json) return null;
    try {
      const snap = JSON.parse(json);
      return fromSnapshot(snap);
    } catch(e) {
      console.error("Failed to load save:", e);
      return null;
    }
  }
  function downloadSave(world, filename='farm_save.json'){
    const blob = new Blob([JSON.stringify(toSnapshot(world), null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }
  function makeAutosave(world){
    world.autosave = world.autosave || { ring: [], max: 10 };
  }
  function autosave(world){
    makeAutosave(world);
    const snap = toSnapshot(world);
    world.autosave.ring.push(snap);
    if (world.autosave.ring.length > world.autosave.max) world.autosave.ring.shift();
  }
  function rollback(world, steps=1){
    makeAutosave(world);
    const idx = Math.max(0, world.autosave.ring.length - 1 - steps);
    const snap = world.autosave.ring[idx];
    return snap ? fromSnapshot(snap) : world;
  }
  async function simulateMonths(seed=12345, months=8){
    let w = makeWorld(seed); 
    const results = [];
    for (let i=0;i<months;i++){
      for (let d=0; d<20; d++) dailyTurn(w);
      results.push({
        month: w.calendar.month, wheat:w.store.wheat|0, barley:w.store.barley|0,
        oats:w.store.oats|0, hay: +w.store.hay.toFixed(2), cash:+w.cash.toFixed(2)
      });
    }
    console.table(results);
    return { world:w, results };
  }
  window.simulateMonths = simulateMonths;
  window._save = () => downloadSave(world);

  // ===================== Main Loop & Init =====================
  let world;
  const TIMECTRL = { mode: 'normal', minutesPerFrame: 10, ff: { daysRemaining: 0, stopOnAlerts: true, report: [] } };
  const DEBUG = { showParcels: false, showRows: false, showSoilBars: true, showTaskQueue: false, showWorkability: true, showKPI: false };
  window.debugToggle = (k) => { DEBUG[k] = !DEBUG[k]; draw(); };
  
  let charSize = {width: 8, height: 17};
  let screenRef, overlayRef;

  function stepOneMinute(world){
    tickWorkMinute(world);
    processFarmerMinute(world);
    world.calendar.minute++;
    if (world.calendar.minute >= MINUTES_PER_DAY){
      world.calendar.minute = 0;
      dailyTurn(world);
    }
  }
  
  function onFrame(){
    if (!world) return;
    if (TIMECTRL.mode === 'normal'){
      if (!world.paused) stepOneMinute(world);
    } else if (TIMECTRL.mode === 'scaled'){
      if (!world.paused) for(let i=0; i<TIMECTRL.minutesPerFrame; i++) stepOneMinute(world);
    } else if (TIMECTRL.mode === 'ff'){
       runFastForwardFrame(world);
    }
    draw();
    requestAnimationFrame(onFrame);
  }

  function setTimeMode(mode, minutesPerFrame=10){ TIMECTRL.mode = mode; TIMECTRL.minutesPerFrame = minutesPerFrame; }
  function runFastForward(days, stopOnAlerts=true){ TIMECTRL.mode = 'ff'; TIMECTRL.ff.daysRemaining = days; TIMECTRL.ff.stopOnAlerts = stopOnAlerts; TIMECTRL.ff.report = []; }
  function runOneDay(world) {
      generateWeatherToday(world);
      updateSoilWaterDaily(world);
      pastureRegrow(world);
      updateHayCuring(world);
      consumeLivestock(world);
      ensureAdvisor(world);
      updateKPIs(world);
      reprioritiseByVPM(world);
      if (world.advisor.enabled && world.advisor.mode === 'auto') advisorExecute(world);
      planDayMonthly(world);

      const DAY_MIN = LABOUR_DAY_MIN;
      for (let m = 0; m < DAY_MIN; m++) {
          tickWorkMinute(world);
      }
      dailyWeatherEvents(world);
      endOfDayMonth(world);
      autosave(world);
      world.calendar.day += 1;
      if (world.calendar.day > 20) {
          world.calendar.day = 1;
          world.calendar.month += 1;
          if (world.calendar.month > 8) {
              world.calendar.month = 1;
              world.calendar.year = (world.calendar.year || 1) + 1;
          }
          onNewMonth(world);
      }
  }

  function runFastForwardFrame(world){
    if (TIMECTRL.ff.daysRemaining <= 0){ TIMECTRL.mode='normal'; return; }
    if (TIMECTRL.ff.stopOnAlerts && world.alerts.length > 0 && world.kpi.warnings.length > 0){ TIMECTRL.mode='normal'; return; }
    
    dailyTurn(world);
    for(let m = 0; m < MINUTES_PER_DAY; m++) {
        tickWorkMinute(world);
    }

    TIMECTRL.ff.report.push({ y: world.calendar.year, m: world.calendar.month, d: world.calendar.day, oats: world.store.oats, hay: world.store.hay, wheat: world.store.wheat, cash: world.cash });
    TIMECTRL.ff.daysRemaining -= 1;
  }
  
  function drawDebugOverlay(world, canvas){
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width, canvas.height);
      ctx.font = '12px ui-monospace';
      const lineH = 14;
      const padding = 12; // From the <pre> tag's style
      const camX = Math.round(world.camera.x);
      const camY = Math.round(world.camera.y);

      if (DEBUG.showParcels){
          for (const p of world.parcels){
              const pSX = (p.x - camX) * charSize.width + padding;
              const pSY = (p.y - camY) * charSize.height + padding;
              const pSW = p.w * charSize.width;
              const pSH = p.h * charSize.height;

              if (pSX + pSW < 0 || pSX > canvas.width || pSY + pSH < 0 || pSY > canvas.height) continue;

              const mud = p.status.mud || 0;
              ctx.strokeStyle = `rgba(200,${Math.floor(200*(1-mud))},0,0.8)`;
              ctx.lineWidth = 2;
              ctx.strokeRect(pSX, pSY, pSW, pSH);

              if (DEBUG.showSoilBars){
                  const mx = Math.min(1, p.soil.moisture), nx = Math.min(1, p.soil.nitrogen);
                  ctx.fillStyle = '#58a';
                  ctx.fillRect(pSX + 2, pSY + 2, Math.floor(pSW*0.3*mx), 3);
                  ctx.fillStyle = '#8a5';
                  ctx.fillRect(pSX + 2, pSY + 7, Math.floor(pSW*0.3*nx), 3);
              }

              if (DEBUG.showWorkability && mud >= 0.35){
                  ctx.fillStyle = 'rgba(200,0,0,0.7)';
                  ctx.fillText('MUD', pSX + 2, pSY + 20);
              }
          }
      }

      if (DEBUG.showTaskQueue){
          const q = world.tasks.month.queued.slice(0, 8).map(t => `${t.kind}(${t.latestDay}) p:${t.priority}`);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(8, 8, 360, 14 + lineH*q.length);
          ctx.fillStyle = '#ddd';
          ctx.fillText('Queue:', 14, 20);
          q.forEach((l,i)=> ctx.fillText(l, 14, 34+lineH*i));
      }

      if (DEBUG.showKPI){
          const line = advisorHud(world);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(8, 120, 880, 20);
          ctx.fillStyle = '#ddd';
          ctx.fillText(line, 14, 135);
      }
  }

  (function init(){
    world = loadFromLocalStorage() || makeWorld(getSeedFromURL());
    log(world, `Seed: ${world.seed}`);

    screenRef  = document.getElementById('screen');
    overlayRef = document.getElementById('debug-overlay');

    const resizeObserver = new ResizeObserver(() => {
        // Match canvas drawing buffer to the visible viewport of <pre>
        overlayRef.width  = screenRef.clientWidth;
        overlayRef.height = screenRef.clientHeight;
        // Also match CSS size so the bitmap maps 1:1
        overlayRef.style.width  = screenRef.clientWidth + 'px';
        overlayRef.style.height = screenRef.clientHeight + 'px';

        // Measure character cell
        const temp = document.createElement('span');
        temp.textContent = 'M';
        temp.style.font = getComputedStyle(screenRef).font;
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        document.body.appendChild(temp);
        charSize = { width: temp.offsetWidth, height: temp.offsetHeight };
        document.body.removeChild(temp);
        draw();
    });
    resizeObserver.observe(screenRef);

    // Keep overlay aligned with scrolled ASCII viewport
    screenRef.addEventListener('scroll', () => {
      overlayRef.style.transform =
        `translate(${-screenRef.scrollLeft}px, ${-screenRef.scrollTop}px)`;
    });

    if (new URLSearchParams(location.search).has('hc')) document.body.classList.add('hc');
    if (localStorage.getItem('farm_hc') === '1') document.body.classList.add('hc');
    
    planDay(world);
    requestAnimationFrame(onFrame);
  })();
  
  function draw(){ 
      const {buf, styleBuf} = renderColored(world); 
      const lines = []; 
      for (let y=0;y<SCREEN_H;y++) lines.push(flushLine(buf[y], styleBuf[y])); 
      // Write into the correct element (avoid window.screen)
      screenRef.innerHTML = lines.join('\n');
      drawDebugOverlay(world, overlayRef);
  }

  window.addEventListener('keydown', (e)=>{
    if (e.key === ' '){ e.preventDefault(); world.paused = !world.paused; draw(); }
    else if (e.key === ','){ e.preventDefault(); world.snapCamera = true; stepOneMinute(world); draw(); world.snapCamera = false; }
    else if (e.key==='.') { e.preventDefault(); for (let i=0;i<10;i++) stepOneMinute(world); draw(); }
    else if (e.key==='n' || e.key==='N'){ e.preventDefault(); const currentMinute = world.calendar.minute; for(let i=0; i < MINUTES_PER_DAY - currentMinute; i++) { stepOneMinute(world); } draw(); }
    else if (e.key === 'r' || e.key === 'R'){ e.preventDefault(); if (e.shiftKey){ const newSeed = (Math.random()*2**31)|0; log(world, `New random seed: ${newSeed}`); const url = new URL(location.href); url.searchParams.set('seed', newSeed); location.href = url.toString(); } else { world = makeWorld(getSeedFromURL()); log(world, `Seed: ${world.seed}`); planDay(world); draw(); } }
    else if (e.key === 'p' || e.key === 'P'){ e.preventDefault(); world.showPanel = !world.showPanel; draw(); }
    else if (e.key === 'c' || e.key === 'C'){ e.preventDefault(); world.camera.x = clamp(world.farmer.x - SCREEN_W/2, 0, CONFIG.WORLD.W - SCREEN_W); world.camera.y = clamp(world.farmer.y - SCREEN_H/2, 0, CONFIG.WORLD.H - SCREEN_H); draw(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); if (e.shiftKey) { if (world.store.barley >= CONFIG.LIVESTOCK_BUY_COST) { world.livestock.cows++; world.store.barley -= CONFIG.LIVESTOCK_BUY_COST; log(world, `Bought 1 cow for ${CONFIG.LIVESTOCK_BUY_COST} barley. Total cows: ${world.livestock.cows}`); } else { log(world, `Not enough barley to buy a cow (need ${CONFIG.LIVESTOCK_BUY_COST}, have ${world.store.barley}).`); } } else if (e.altKey) { if (world.livestock.cows > 0) { world.livestock.cows--; world.store.barley += CONFIG.LIVESTOCK_SELL_VALUE; log(world, `Sold 1 cow for ${CONFIG.LIVESTOCK_SELL_VALUE} barley. Total cows: ${world.livestock.cows}`); } else { log(world, `No cows to sell.`); } } draw(); }
    else if (e.key==='h'||e.key==='H'){ if (e.shiftKey) { document.body.classList.toggle('hc'); localStorage.setItem('farm_hc', document.body.classList.contains('hc') ? '1' : '0'); } else { e.preventDefault(); world.paused=true; log(world,'Help: ,(1m) .(10m) N(1d) Space(pause) +/- speed C(center) R(reset) Shift+R(new) Shift+H(contrast) Shift+L(buy) Alt+L(sell)'); draw(); } }
    else if (e.key === '1') setTimeMode('normal');
    else if (e.key === '2') setTimeMode('scaled', 10);
    else if (e.key === '3') setTimeMode('scaled', 60);
    else if (e.key === '4') runFastForward(5, true);
    else if (e.key === 'F5') { e.preventDefault(); saveToLocalStorage(world); }
    else if (e.key === 'F9') { e.preventDefault(); const loaded = loadFromLocalStorage(); if(loaded) world = loaded; draw(); }
    else if (e.key === 'F1') { e.preventDefault(); debugToggle('showParcels'); }
    else if (e.key === 'F2') { e.preventDefault(); debugToggle('showTaskQueue'); }
    else if (e.key === 'F3') { e.preventDefault(); debugToggle('showKPI'); }
  });
})();
