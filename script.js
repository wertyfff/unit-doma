import * as THREE from 'three';

// ---------- данные макета (условные, заменить реальными) ----------
const AREA_PER_MODULE = 24; // м²
const TERRACE_PRICE = 350000;
const KITS = {
  base: { price: 55000, note: 'Тёплый контур, инженерия, черновая отделка. Фасад из светлой планки.' },
  comfort: { price: 68000, note: 'Чистовая отделка, сантехника, освещение. Комбинированный фасад.' },
  premium: { price: 84000, note: 'Панорамное остекление, климат, мебель на заказ. Фасад из обожжённой планки.' },
};
const LAYOUTS = {
  1: ['living'],
  2: ['bed', 'living'],
  3: ['bed', 'living', 'kitchen'],
  4: ['bed', 'living', 'kitchen', 'bed2'],
};
const ROOMS = { living: 'Гостиная', bed: 'Спальня', kitchen: 'Кухня и санузел', bed2: 'Две спальни' };
const LAYERS = [
  'Фасад защищает дом от дождя и ветра и задаёт его внешний вид. Материал и цвет выбираете вы.',
  'Утеплитель держит тепло зимой и прохладу летом. Его закладывают в цехе, в сухих условиях.',
  'Каркас несёт нагрузку. Модуль рассчитан так, чтобы выдержать перевозку и подъём краном.',
  'Электрика, вода и вентиляция проложены внутри стен ещё на производстве.',
  'Внутренняя отделка готова к приезду модуля. На участке остаётся закрыть стыки.',
];

const state = { n: 3, kit: 'comfort', terrace: false };
const TELEGRAM_USER = 'kiwnt1'; // куда приходят заявки
const rub = (v) => Math.round(v).toLocaleString('ru-RU');
const plural = (n, forms) => forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = matchMedia('(max-width: 820px)').matches; // правки только для телефонов
const breathe = () => new Promise((r) => setTimeout(r, 0)); // отдаём поток браузеру между тяжёлыми шагами

// =====================================================================
// 3D: процедурные текстуры
// =====================================================================
const W = 6, H = 3, D = 4.4, FLOOR = 0.55; // размеры модуля, м

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Доски: цвет + карта рельефа. horizontal — для террасной доски.
function woodTextures({ hue, sat, light, seed, planks = 8 }) {
  const size = 1024, pw = size / planks, r = seeded(seed);
  const [cc, c] = makeCanvas(size), [bc, b] = makeCanvas(size);
  b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, size, size);
  for (let p = 0; p < planks; p++) {
    const l = light + (r() - 0.5) * 9, h = hue + (r() - 0.5) * 7;
    c.fillStyle = `hsl(${h} ${sat}% ${l}%)`;
    c.fillRect(p * pw, 0, pw, size);
    for (let g = 0; g < 90; g++) {
      const x = p * pw + r() * pw, amp = r() * 3, ph = r() * 9, up = r() < 0.5;
      c.strokeStyle = `hsla(${h} ${sat}% ${l + (up ? 9 : -12)}% / ${0.06 + r() * 0.2})`;
      b.strokeStyle = `rgba(${up ? 255 : 0},${up ? 255 : 0},${up ? 255 : 0},${0.05 + r() * 0.12})`;
      c.lineWidth = b.lineWidth = 0.6 + r() * 1.8;
      c.beginPath(); b.beginPath();
      for (let y = 0; y <= size; y += 32) {
        const xx = x + Math.sin(y * 0.012 + ph) * amp;
        c.lineTo(xx, y); b.lineTo(xx, y);
      }
      c.stroke(); b.stroke();
    }
    if (r() < 0.6) { // сучок
      const kx = p * pw + pw * (0.25 + r() * 0.5), ky = r() * size, kr = 5 + r() * 9;
      const grd = c.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
      grd.addColorStop(0, `hsla(${h - 6} ${sat}% ${l * 0.45}% / .9)`);
      grd.addColorStop(1, `hsla(${h} ${sat}% ${l}% / 0)`);
      c.fillStyle = grd; c.beginPath(); c.ellipse(kx, ky, kr, kr * 2.2, 0, 0, 7); c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(p * pw, 0, 3, size);
    b.fillStyle = '#000'; b.fillRect(p * pw - 1, 0, 6, size);
  }
  return { map: toTexture(cc), bump: toTexture(bc, false) };
}

function grassTexture() {
  const size = 512, r = seeded(7);
  const [cc, c] = makeCanvas(size);
  c.fillStyle = '#3f5f1f'; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 22000; i++) {
    const x = r() * size, y = r() * size, len = 3 + r() * 8, a = (r() - 0.5) * 0.9;
    c.strokeStyle = `hsla(${70 + r() * 36} ${35 + r() * 30}% ${14 + r() * 26}% / ${0.25 + r() * 0.5})`;
    c.lineWidth = 0.7 + r();
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len); c.stroke();
  }
  const t = toTexture(cc);
  t.repeat.set(90, 90);
  return t;
}

// Тёплый интерьер за стеклом: светится в сумерках.
function interiorTexture() {
  const [cc, c] = makeCanvas(512);
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#ffe2a6'); g.addColorStop(0.55, '#ffb65c'); g.addColorStop(1, '#c9692a');
  c.fillStyle = g; c.fillRect(0, 0, 512, 512);
  c.fillStyle = 'rgba(70,30,10,.35)'; c.fillRect(0, 400, 512, 112); // пол
  c.fillStyle = 'rgba(60,25,8,.45)'; c.fillRect(120, 330, 270, 80); // диван
  c.fillRect(140, 300, 230, 40);
  const lamp = c.createRadialGradient(256, 120, 0, 256, 120, 190);
  lamp.addColorStop(0, 'rgba(255,255,235,1)'); lamp.addColorStop(0.25, 'rgba(255,235,170,.7)'); lamp.addColorStop(1, 'rgba(255,220,150,0)');
  c.fillStyle = lamp; c.fillRect(0, 0, 512, 512);
  c.fillStyle = 'rgba(40,18,6,.8)'; c.fillRect(254, 0, 4, 100); // подвес
  for (const x of [0, 462]) { // шторы
    const cg = c.createLinearGradient(x, 0, x + 50, 0);
    cg.addColorStop(0, 'rgba(255,240,215,.75)'); cg.addColorStop(0.5, 'rgba(210,170,120,.55)'); cg.addColorStop(1, 'rgba(255,240,215,.75)');
    c.fillStyle = cg; c.fillRect(x, 0, 50, 512);
  }
  const t = toTexture(cc);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function cloudTexture() {
  const [cc, c] = makeCanvas(1024, 384), r = seeded(5);
  for (let i = 0; i < 90; i++) {
    const t = r(), x = 140 + t * 744, spread = Math.sin(t * Math.PI);
    const y = 250 - r() * 150 * spread, rad = 50 + r() * 90 * (0.4 + spread);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(cc);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function wordmarkTexture() {
  // ждём шрифт, но не дольше полутора секунд
  await Promise.race([document.fonts.load('700 100px Unbounded').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  const [cc, c] = makeCanvas(3072, 768);
  c.font = '700 600px Unbounded, Arial Black, sans-serif';
  const k = 3000 / c.measureText('UNIT').width;
  c.font = `700 ${600 * k}px Unbounded, Arial Black, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#fff';
  c.fillText('UNIT', 1536, 750);
  const t = new THREE.CanvasTexture(cc);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function pixelTexture(r, g, b, srgb) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Текстуры рисуются по одной с паузами, чтобы страница не замирала; обе сцены делят один набор.
let texturesReady;
const textures = () => texturesReady ??= (async () => {
  const light = woodTextures({ hue: 30, sat: 52, light: 52, seed: 11 });
  await breathe();
  const dark = woodTextures({ hue: 28, sat: 10, light: 18, seed: 23 });
  await breathe();
  const deck = woodTextures({ hue: 32, sat: 38, light: 44, seed: 31, planks: 10 });
  await breathe();
  return {
    light, dark, deck, grass: grassTexture(), interior: interiorTexture(), cloud: cloudTexture(),
    white: pixelTexture(255, 255, 255, true), flat: pixelTexture(128, 128, 128, false), // заглушки: у всех материалов дома один набор карт
  };
})();

// Высота участка: ровная площадка под домом, дальше холм плавно уходит вниз.
function groundY(x, z) {
  const d = Math.max(0, Math.hypot(x, z) - 18);
  return -(d * d) / 260 + Math.sin(x * 0.07) * Math.cos(z * 0.09) * 0.5 * Math.min(1, d / 14);
}

// =====================================================================
// 3D: качество. Уровень сам снижается, если кадры идут медленно.
// =====================================================================
const QUALITY = [
  { pr: 0.7, grass: 0.2 },
  { pr: 0.85, grass: 0.32 },
  { pr: 1, grass: 0.45 },
  { pr: 1, grass: 0.65 },
  { pr: 1.25, grass: 0.85 },
  { pr: 1.5, grass: 1 },
];
const MAX_PIXELS = 3.2e6; // больше не рендерим даже на 4K
const qParam = new URLSearchParams(location.search).get('q'); // ?q=0…5 фиксирует уровень
const weakDevice = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 4) <= 4;
// Подобранный уровень запоминаем: при следующей загрузке сцена сразу стартует с него
const QUALITY_KEY = 'unit-quality';
function savedQuality() {
  try { const v = localStorage.getItem(QUALITY_KEY); return v === null ? null : clamp(Math.round(+v) || 0, 0, QUALITY.length - 1); } catch { return null; }
}
function saveQuality(level) { try { localStorage.setItem(QUALITY_KEY, level); } catch { /* приватный режим */ } }
const FRAME_BUDGET = 9; // мс на кадр в самом тяжёлом ракурсе: запас до 16,7 мс при 60 кадрах в секунду
const START_QUALITY = qParam !== null ? clamp(Math.round(+qParam) || 0, 0, QUALITY.length - 1)
  : Math.min(QUALITY.length - 1, savedQuality() !== null ? savedQuality() + 1 : weakDevice ? 3 : 5);

// =====================================================================
// 3D: трава. Всё освещение считается в вершинах, поэтому она дешёвая.
// =====================================================================
const BOXES = 7; // до 5 модулей, терраса у входа и ступени: дают тень и приминают траву
const GRASS_CELL = 14; // трава разбита на квадраты: те, что вне кадра, не рисуются
const GRASS_LOD = 36; // дальше этого расстояния травинка — один треугольник вместо пяти
const GRASS_VERT = /* glsl */ `
  uniform float uTime, uPx, uWidth;
  uniform vec3 uSunDir, uSunCol, uHemi, uEnv;
  uniform vec3 uBoxC[${BOXES}];
  uniform vec3 uBoxH[${BOXES}];
  uniform vec4 uLampPos[2];
  uniform vec3 uLampCol[2];
  attribute vec3 aRoot;
  attribute vec4 aData; // высота, угол наклона, сила наклона, случайное число
  varying vec3 vCol;
  varying float vSide;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float t = position.y, rnd = aData.w;
    vec3 root = aRoot;
    float tint = noise(root.xz * 0.11), clump = noise(root.xz * 0.055 + 31.0);
    float h = aData.x * (0.7 + 0.65 * clump);

    // тень дома и трава под ним: луч к солнцу против коробок модулей
    vec3 sp = root + vec3((fract(rnd * 13.7) - 0.5) * 0.6, 0.12, (fract(rnd * 5.3) - 0.5) * 0.6);
    vec3 inv = 1.0 / (uSunDir + vec3(1e-4));
    float lit = 1.0;
    for (int i = 0; i < ${BOXES}; i++) {
      vec3 o = uBoxC[i] - sp;
      vec3 a = (o - uBoxH[i]) * inv, b = (o + uBoxH[i]) * inv;
      vec3 lo = min(a, b), hi = max(a, b);
      float tn = max(max(lo.x, lo.y), lo.z), tf = min(min(hi.x, hi.y), hi.z);
      if (tf > max(tn, 0.0)) lit = 0.0;
      vec2 q = abs(root.xz - uBoxC[i].xz) - uBoxH[i].xz;
      if (max(q.x, q.y) < 0.0) h = min(h, uBoxC[i].y - uBoxH[i].y - root.y - 0.02);
    }
    h = max(h, 0.0);

    // ветер: бегущие порывы и мелкая дрожь
    float gust = noise(root.xz * 0.045 + vec2(uTime * 0.22, uTime * 0.1));
    float sway = sin(uTime * 1.4 + root.x * 0.23 + root.z * 0.19 + rnd * 2.0);
    vec2 wind = vec2(0.9, 0.42) * (gust * 0.42 + sway * 0.07) + vec2(sin(uTime * 3.7 + rnd * 40.0), cos(uTime * 3.1 + rnd * 23.0)) * 0.022;
    vec2 lean = vec2(cos(aData.y), sin(aData.y)) * aData.z + wind;
    vec3 p = root;
    p.xz += lean * h * t * t;
    p.y += h * t * (1.0 - 0.28 * min(dot(lean, lean), 1.5) * t);

    // травинка повёрнута к камере; вдали не тоньше ~1.3 px, чтобы не рябила
    vec3 toCam = cameraPosition - p;
    float dist = length(toCam);
    float w = max(0.013 * (0.7 + 0.7 * fract(rnd * 7.31)) * uWidth, uPx * dist * 1.3) * (1.0 - pow(t, 1.6));
    p += normalize(vec3(toCam.z, 0.0, -toCam.x)) * position.x * w;

    vec3 light = (uSunCol * lit * (0.5 + 0.3 * uSunDir.y) + uHemi) * 0.3183 + uEnv;
    for (int i = 0; i < 2; i++) {
      float d = distance(uLampPos[i].xyz, root + vec3(0.0, h * 0.5, 0.0));
      float c = clamp(1.0 - pow(d / uLampPos[i].w, 4.0), 0.0, 1.0);
      light += uLampCol[i] * (c * c / max(pow(d, 1.7), 0.01)) * 0.25;
    }

    vec3 cRoot = vec3(0.010, 0.030, 0.006);
    vec3 cMid = mix(vec3(0.040, 0.125, 0.018), vec3(0.085, 0.175, 0.028), tint);
    vec3 cTip = mix(vec3(0.150, 0.290, 0.045), vec3(0.330, 0.340, 0.090), smoothstep(0.6, 1.0, fract(rnd * 3.1)));
    cTip = mix(cTip, cTip * vec3(1.2, 1.08, 0.75), clump * 0.7);
    vec3 alb = mix(cRoot, cMid, smoothstep(0.0, 0.5, t));
    alb = mix(alb, cTip, smoothstep(0.35, 1.0, t));
    float back = pow(max(dot(-toCam / dist, uSunDir), 0.0), 2.0) * t; // просвет против солнца
    vCol = alb * light + uSunCol * lit * back * vec3(0.060, 0.085, 0.012);
    vSide = position.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const GRASS_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vSide;
  void main() {
    gl_FragColor = vec4(vCol * (0.86 + 0.14 * vSide), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Раскидывает травинки: половина равномерно по участку, половина — туда, куда смотрит камера.
// Возвращает массивы, уже разложенные по квадратам сетки.
function scatterGrass(N, R, focus) {
  const side = Math.ceil((2 * R) / GRASS_CELL), cellOf = new Uint16Array(N), counts = new Uint32Array(side * side);
  const tr = new Float32Array(N * 3), td = new Float32Array(N * 4);
  let seed = 99;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N;) {
    let x, z;
    if (focus && i % 2) {
      x = (rnd() * 2 - 1) * 34; z = (rnd() * 2 - 1) * 34;
      const d = Math.hypot(x, z);
      if (d > 34 || rnd() > smooth(34, 10, d)) continue;
      x += focus[0]; z += focus[1];
    } else { x = (rnd() * 2 - 1) * R; z = (rnd() * 2 - 1) * R; }
    const rr = Math.hypot(x, z);
    if (rr >= R || rnd() > 0.16 + 0.84 * smooth(R, R * 0.42, rr)) continue;
    tr[i * 3] = x; tr[i * 3 + 1] = groundY(x, z); tr[i * 3 + 2] = z;
    td[i * 4] = (0.2 + rnd() * 0.28) * smooth(R, R * 0.72, rr);
    td[i * 4 + 1] = rnd() * 6.2832; td[i * 4 + 2] = 0.12 + rnd() * 0.5; td[i * 4 + 3] = rnd();
    const cell = Math.floor((x + R) / GRASS_CELL) + Math.floor((z + R) / GRASS_CELL) * side;
    cellOf[i] = cell; counts[cell]++;
    i++;
  }
  const start = new Uint32Array(side * side + 1);
  for (let c = 0; c < side * side; c++) start[c + 1] = start[c] + counts[c];
  const fill = start.slice(), roots = new Float32Array(N * 3), data = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const j = fill[cellOf[i]]++;
    roots[j * 3] = tr[i * 3]; roots[j * 3 + 1] = tr[i * 3 + 1]; roots[j * 3 + 2] = tr[i * 3 + 2];
    data[j * 4] = td[i * 4]; data[j * 4 + 1] = td[i * 4 + 1]; data[j * 4 + 2] = td[i * 4 + 2]; data[j * 4 + 3] = td[i * 4 + 3];
  }
  return { roots, data, start, side };
}

// =====================================================================
// 3D: геометрия дома. Детали одного материала склеиваются в один меш.
// =====================================================================
function mergeGeometries(parts) {
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += g.attributes.position.count; io += src.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// Коробка с UV в метрах: одна текстура досок ложится на детали любого размера.
function boxGeometry(w, h, d, su = 0, sv = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (su) {
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * dims[i >> 2][0] * su, uv.getY(i) * dims[i >> 2][1] * sv);
  }
  return g;
}

// =====================================================================
// 3D: сцена. Собирается по шагам, чтобы страница не замирала при загрузке.
// =====================================================================
async function createView(canvas, { hero = false, labelsEl = null, types, kit }) {
  const T = await textures();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // тени пересчитываем, только когда что-то сдвинулось

  const scene = new THREE.Scene();
  // на телефоне диапазон глубины уже: мобильным видеочипам так проще не путать ближнее с дальним
  const camera = new THREE.PerspectiveCamera(30, 1, phone ? 2 : 0.5, phone ? 4000 : 30000);
  const narrowStart = hero && canvas.clientWidth < canvas.clientHeight;

  // --- небо и свет
  const U = {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, glow: { value: 0.2 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(phone ? 3000 : 9000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: !phone, uniforms: U,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top, mid, bot, sunDir, sunCol; uniform float glow; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(bot, mid, smoothstep(0.0, 0.13, h));
        col = mix(col, top, smoothstep(0.1, 0.6, h));
        col = mix(bot * 0.55, col, smoothstep(-0.25, 0.0, d.y));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.5 + pow(s, 6.0) * glow);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  // На компьютере небо рисуем последним: закрытые домом и землёй пиксели не считаются.
  // На телефоне — первым и без проверки глубины, чтобы оно никогда не могло перекрыть сцену.
  sky.renderOrder = phone ? -10 : 3;
  scene.add(sky);
  const SKY = {
    day: { top: new THREE.Color(0x1466e0), mid: new THREE.Color(0x58b0ff), bot: new THREE.Color(0xd6efff), sun: new THREE.Color(0xfff3d6) },
    gold: { top: new THREE.Color(0x2f6fd6), mid: new THREE.Color(0xffc27a), bot: new THREE.Color(0xffe6b8), sun: new THREE.Color(0xffc46b) },
    dusk: { top: new THREE.Color(0x24206e), mid: new THREE.Color(0xff3f7a), bot: new THREE.Color(0xffa23a), sun: new THREE.Color(0xff8a2a) },
  };

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 220 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x4a5a2a, 1);
  scene.add(hemi);
  // Тёплый свет от окон и бра. Обе лампы всегда в сцене: если число источников меняется,
  // three.js пересобирает все шейдеры, и анимация замирает.
  const spill = new THREE.PointLight(0xffa85c, 0, 14, 1.6), sconce = new THREE.PointLight(0xffb070, 0, 9, 1.8);
  const warm = [{ light: spill, host: null, at: [0, 1.6, D / 2 + 1.2] }, { light: sconce, host: null, at: [-0.95, 2.1, D / 2 + 0.5] }];
  scene.add(spill, sconce);

  // --- облака
  const clouds = [];
  [[-560, 150, -900, 380], [230, 215, -1000, 460], [700, 120, -700, 340], [-900, 130, -300, 400], [60, 330, -1300, 560], [1100, 200, -200, 420], [-150, 95, -1100, 300], [420, 80, -1200, 260]].forEach(([x, y, z, w], i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.cloud, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92 }));
    sp.position.set(x, y, z); sp.scale.set(w * (i % 2 ? 1 : -1), w * 0.36, 1);
    scene.add(sp); clouds.push(sp);
  });

  // --- участок
  const GRASS_R = narrowStart ? 82 : 62, GRASS_N = hero ? 240000 : 70000;
  const gGeo = new THREE.PlaneGeometry(700, 700, 96, 96);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gc = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, groundY(x, z));
    gc.fill(lerp(0.45, 1, smooth(GRASS_R * 0.7, GRASS_R, Math.hypot(x, z))), i * 3, i * 3 + 3); // под травинками земля темнее
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({ map: T.grass, vertexColors: true }));
  ground.receiveShadow = true;
  ground.renderOrder = 2;
  scene.add(ground);
  await breathe();

  // --- трава
  const GU = {
    uTime: { value: 0 }, uPx: { value: 0.001 }, uWidth: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uHemi: { value: new THREE.Color() }, uEnv: { value: new THREE.Color() },
    uBoxC: { value: Array.from({ length: BOXES }, () => new THREE.Vector3(0, -100, 0)) },
    uBoxH: { value: Array.from({ length: BOXES }, () => new THREE.Vector3(0.01, 0.01, 0.01)) },
    uLampPos: { value: [new THREE.Vector4(0, -100, 0, 1), new THREE.Vector4(0, -100, 0, 1)] },
    uLampCol: { value: [new THREE.Color(0), new THREE.Color(0)] },
  };
  const field = scatterGrass(GRASS_N, GRASS_R, hero ? (narrowStart ? [-25, 42] : [-3, 24]) : null);
  const blade = (pos, idx) => [new THREE.Float32BufferAttribute(pos, 3), new THREE.Uint16BufferAttribute(idx, 1)];
  const bladeNear = blade([-1, 0, 0, 1, 0, 0, -1, 0.36, 0, 1, 0.36, 0, -1, 0.7, 0, 1, 0.7, 0, 0, 1, 0], [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
  const bladeFar = blade([-1, 0.1, 0, 1, 0.1, 0, 0, 1, 0], [0, 1, 2]);
  const grassMat = new THREE.ShaderMaterial({ uniforms: GU, vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide });
  const grassCells = [];
  for (let c = 0; c < field.side * field.side; c++) {
    const a = field.start[c], n = field.start[c + 1] - a;
    if (!n) continue;
    const aRoot = new THREE.InstancedBufferAttribute(field.roots.subarray(a * 3, (a + n) * 3), 3);
    const aData = new THREE.InstancedBufferAttribute(field.data.subarray(a * 4, (a + n) * 4), 4);
    const cx = (c % field.side + 0.5) * GRASS_CELL - GRASS_R, cz = (Math.floor(c / field.side) + 0.5) * GRASS_CELL - GRASS_R;
    const center = new THREE.Vector3(cx, groundY(cx, cz), cz);
    const [near, far] = [bladeNear, bladeFar].map(([pos, idx]) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', pos);
      geo.setIndex(idx);
      geo.setAttribute('aRoot', aRoot);
      geo.setAttribute('aData', aData);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), GRASS_CELL * 0.71 + 4);
      const mesh = new THREE.Mesh(geo, grassMat);
      mesh.position.copy(center); // только для отсечения и сортировки: шейдер берёт координаты из aRoot
      mesh.renderOrder = 1; // после дома, до земли: земля под травой отсекается по глубине
      scene.add(mesh);
      return mesh;
    });
    grassCells.push({ near, far, n, center });
  }
  await breathe();

  // --- материалы дома: у всех одинаковый набор карт, поэтому шейдер один на весь дом
  const std = (o) => new THREE.MeshStandardMaterial({ map: T.white, bumpMap: T.flat, emissiveMap: T.white, emissive: 0x000000, ...o });
  const metal = std({ color: 0x2a2e31, roughness: 0.5, metalness: 0.6 });
  const frameMat = std({ color: 0x0c0e0f, roughness: 0.35, metalness: 0.8 });
  const brass = std({ color: 0xc9a25a, metalness: 1, roughness: 0.3 });
  const glassMat = std({ color: 0x070b10, roughness: 0.03, envMapIntensity: 2.6, emissive: 0xffffff, emissiveMap: T.interior, emissiveIntensity: 0.2 });
  const lampMat = std({ color: 0x222222, emissive: 0xffc98a, emissiveIntensity: 0 });
  const WOOD = {
    light: std({ map: T.light.map, bumpMap: T.light.bump, bumpScale: 2.5, roughness: 0.82 }),
    dark: std({ map: T.dark.map, bumpMap: T.dark.bump, bumpScale: 2.5, roughness: 0.7 }),
    deck: std({ map: T.deck.map, bumpMap: T.deck.bump, bumpScale: 2.5, roughness: 0.82 }),
  };
  const put = (parts, mat, geo, x = 0, y = 0, z = 0) => {
    geo.translate(x, y, z);
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(geo);
  };
  const box = (parts, mat, w, h, d, x, y, z) => put(parts, mat, boxGeometry(w, h, d), x, y, z);
  const plank = (parts, kind, w, h, d, x, y, z) => put(parts, WOOD[kind], kind === 'deck' ? boxGeometry(w, h, d, 0.5, 0.5) : boxGeometry(w, h, d, 1 / 1.12, 1 / 3), x, y, z);
  function addWindow(parts, { x, y, w, h, side = 'front', mullions = 0 }) {
    const local = [[frameMat, boxGeometry(w + 0.14, h + 0.14, 0.12)], [glassMat, new THREE.PlaneGeometry(w, h).translate(0, 0, 0.065)]];
    for (let i = 1; i <= mullions; i++) local.push([frameMat, boxGeometry(0.06, h, 0.15).translate(-w / 2 + (w * i) / (mullions + 1), 0, 0)]);
    const [px, py, pz, ry] = side === 'front' ? [x, y, D / 2 - 0.02, 0] : side === 'back' ? [x, y, -D / 2 + 0.02, Math.PI]
      : side === 'left' ? [-W / 2 + 0.02, y, x, -Math.PI / 2] : [W / 2 - 0.02, y, x, Math.PI / 2];
    for (const [mat, geo] of local) put(parts, mat, geo.rotateY(ry), px, py, pz);
  }
  function addPiles(parts, w) {
    for (const x of [-w / 2 + 0.5, 0, w / 2 - 0.5]) for (const z of [-D / 2 + 0.5, D / 2 - 0.5]) put(parts, metal, new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), x, -1.0, z);
  }

  function buildModule(type, i, n, kit) {
    const parts = new Map(), g = new THREE.Group();
    g.userData = { width: W, type };
    if (type === 'terrace') {
      const w = g.userData.width = 3.6;
      plank(parts, 'deck', w, 0.14, D, 0, -0.07, 0);
      box(parts, metal, w, 0.2, D, 0, -0.24, 0);
      for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) box(parts, metal, 0.12, H, 0.12, x, H / 2, z);
      box(parts, metal, w + 0.02, 0.16, D + 0.9, 0, H + 0.08, 0.25);
      for (const x of [-0.75, 0.75]) { // пара кресел
        plank(parts, 'light', 0.7, 0.12, 0.7, x, 0.4, -0.3);
        plank(parts, 'light', 0.7, 0.6, 0.1, x, 0.7, -0.62);
        box(parts, metal, 0.6, 0.4, 0.6, x, 0.2, -0.3);
      }
      box(parts, metal, 0.5, 0.45, 0.5, 0, 0.225, 0.5); // столик
      addPiles(parts, w);
    } else {
      const kind = kit === 'base' ? 'light' : kit === 'premium' ? 'dark' : (type === 'bed' || type === 'bed2') ? 'dark' : 'light';
      plank(parts, kind, W, H, D, 0, H / 2, 0);
      box(parts, metal, W + 0.02, 0.16, D + 0.9, 0, H + 0.08, 0.25); // кровля с козырьком
      box(parts, frameMat, W + 0.04, 0.05, D + 0.96, 0, H + 0.185, 0.25);
      box(parts, metal, W, 0.22, D, 0, -0.11, 0); // обвязка
      addPiles(parts, W);
      if (type === 'living') {
        addWindow(parts, { x: 0, y: 1.3, w: 4.6, h: 2.3, mullions: 2 });
        plank(parts, 'deck', W - 0.3, 0.12, 2.6, 0, -0.06, D / 2 + 1.3); // терраса у входа
        box(parts, metal, W - 0.3, 0.16, 2.6, 0, -0.2, D / 2 + 1.3);
        plank(parts, 'deck', 2.4, 0.14, 0.45, 0, -0.24, D / 2 + 2.85);
        plank(parts, 'deck', 2.4, 0.14, 0.45, 0, -0.42, D / 2 + 3.3);
      }
      if (type === 'bed') addWindow(parts, { x: 1.2, y: 1.45, w: 1.2, h: 2.0 });
      if (type === 'bed2') { addWindow(parts, { x: -1.5, y: 1.6, w: 1.3, h: 1.5 }); addWindow(parts, { x: 1.5, y: 1.6, w: 1.3, h: 1.5 }); }
      if (type === 'kitchen') {
        box(parts, frameMat, 1.05, 2.25, 0.1, -1.8, 1.125, D / 2 + 0.01); // дверь
        box(parts, brass, 0.04, 0.5, 0.06, -1.42, 1.1, D / 2 + 0.09);
        box(parts, lampMat, 0.12, 0.3, 0.1, -0.95, 2.2, D / 2 + 0.06);
        addWindow(parts, { x: 1.1, y: 1.95, w: 2.6, h: 0.85, mullions: 1 });
      }
      addWindow(parts, { x: 0.8, y: 1.7, w: 1.8, h: 1.1, side: 'back' });
      if (i === 0) addWindow(parts, { x: 0, y: 1.5, w: 1.6, h: 1.7, side: 'left' });
      if (i === n - 1) addWindow(parts, { x: 0, y: 1.5, w: 1.6, h: 1.7, side: 'right' });
    }
    for (const [mat, list] of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }

  // --- сборка дома
  const house = new THREE.Group();
  scene.add(house);
  let modules = [], labels = [], living = null, startAt = null, warmup = 0, dropTime = 0;
  function setConfig(nextTypes, nextKit) {
    house.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    house.clear();
    if (labelsEl) labelsEl.innerHTML = '';
    const rooms = nextTypes.filter((t) => t !== 'terrace').length;
    const total = nextTypes.reduce((sum, t) => sum + (t === 'terrace' ? 3.6 : W), 0);
    let x = -total / 2;
    modules = nextTypes.map((t, i) => {
      const g = buildModule(t, i, rooms, nextKit);
      const w = g.userData.width;
      Object.assign(g.userData, { x0: x + w / 2, k: i - (nextTypes.length - 1) / 2, delay: 0.15 + i * 0.32 });
      g.visible = false;
      x += w;
      house.add(g);
      return g;
    });
    living = modules.find((g) => g.userData.type === 'living') || null;
    warm[0].host = living;
    warm[1].host = modules.find((g) => g.userData.type === 'kitchen') || null;
    labels = labelsEl ? modules.map((g, i) => {
      if (g.userData.type === 'terrace') return null;
      const el = document.createElement('div');
      el.className = 'tag';
      el.style.opacity = 0;
      el.innerHTML = `<span>${ROOMS[g.userData.type]}<i>, ${AREA_PER_MODULE} м²</i></span><b>Unit ${pad2(i + 1)}</b>`;
      labelsEl.append(el);
      return el;
    }) : [];
    houseW = total;
    startAt = null; warmup = 0; // спуск модулей начнётся, когда сцена реально нарисуется
    dropTime = 0.15 + modules.length * 0.32 + 1.8;
    applyDusk(dusk);
    layout();
  }

  // --- время суток: 0 — день, 1 — сумерки
  let dusk = hero ? 0 : 0.55, envMaps = null;
  const ENV_STOPS = hero ? [0, 0.25, 0.5, 0.75, 1] : [dusk];
  const sunDir = new THREE.Vector3(), cDay = new THREE.Color(0xfff0dc), cDusk = new THREE.Color(0xff7a3c);
  const cCloudDay = new THREE.Color(0xffffff), cCloudDusk = new THREE.Color(0xff8a5c);
  function applyDusk(t) {
    dusk = t;
    const elev = lerp(26, -2.5, t), az = lerp(-68, -158, t);
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    const st = smooth(0.1, 0.95, t);
    U.sunDir.value.copy(sunDir);
    const [ka, kb, kt] = st < 0.5 ? [SKY.day, SKY.gold, st * 2] : [SKY.gold, SKY.dusk, st * 2 - 1];
    U.top.value.lerpColors(ka.top, kb.top, kt);
    U.mid.value.lerpColors(ka.mid, kb.mid, kt);
    U.bot.value.lerpColors(ka.bot, kb.bot, kt);
    U.sunCol.value.lerpColors(ka.sun, kb.sun, kt);
    U.glow.value = lerp(0.12, 0.7, st);
    hemi.color.copy(U.top.value).lerp(cDay, lerp(0.55, 0.25, st));
    sun.position.copy(sunDir).setY(Math.max(sunDir.y, 0.05)).multiplyScalar(90);
    sun.color.lerpColors(cDay, cDusk, smooth(0.2, 0.9, t));
    sun.intensity = lerp(9.5, 0.4, Math.pow(t, 1.3));
    hemi.intensity = lerp(2.4, 2.0, t);
    renderer.toneMappingExposure = lerp(0.62, 0.95, t);
    glassMat.emissiveIntensity = lerp(0.07, 3.4, smooth(0.2, 1, t));
    lampMat.emissiveIntensity = lerp(0, 6, smooth(0.3, 1, t));
    for (const w of warm) w.light.intensity = w.host ? lerp(0, 60, smooth(0.35, 1, t)) : 0;
    for (const c of clouds) c.material.color.lerpColors(cCloudDay, cCloudDusk, smooth(0.15, 0.95, t));
    GU.uSunDir.value.copy(sun.position).normalize();
    GU.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
    GU.uHemi.value.copy(hemi.groundColor).lerp(hemi.color, 0.72).multiplyScalar(hemi.intensity);
    GU.uEnv.value.copy(U.mid.value).lerp(U.bot.value, 0.3).multiplyScalar(0.28);
    if (envMaps) { // отражения: ближайшая из заранее посчитанных карт
      let best = 0;
      ENV_STOPS.forEach((stop, i) => { if (Math.abs(stop - t) < Math.abs(ENV_STOPS[best] - t)) best = i; });
      scene.environment = envMaps[best];
    }
    renderer.shadowMap.needsUpdate = true;
  }

  // --- камера и размер
  const poseA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, poseB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  let aspect = 1, gap = 3.2, houseW = 18, level = START_QUALITY, word = null;
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const q = QUALITY[level], pr = Math.min(devicePixelRatio, q.pr, Math.sqrt(MAX_PIXELS / (w * h)));
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    const narrow = aspect < 1;
    camera.fov = narrow ? 38 : 30;
    camera.updateProjectionMatrix();
    GU.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (h * pr);
    GU.uWidth.value = 1 / Math.sqrt(q.grass); // меньше травинок — они шире, газон не редеет
    for (const cell of grassCells) cell.near.geometry.instanceCount = cell.far.geometry.instanceCount = Math.ceil(cell.n * q.grass);
    if (!hero) {
      poseA.pos.set(-17, 7.5, 27).multiplyScalar(Math.max(1, houseW / 20) * Math.max(1, 1.3 / aspect)); poseA.tgt.set(0, 2.4, 0);
      poseB.pos.copy(poseA.pos); poseB.tgt.copy(poseA.tgt);
    } else if (narrow) {
      poseA.pos.set(-38, 5, 62); poseA.tgt.set(0, -9, 0);
      poseB.pos.set(-36, 17, 60); poseB.tgt.set(0, 5, 0);
      gap = 1.2;
    } else {
      poseA.pos.set(-6, 2.3, 38); poseA.tgt.set(-5.4, 0.6, 0);
      poseB.pos.set(-23, 13, 36); poseB.tgt.set(0, 4.6, 0);
      gap = 3.2;
    }
    if (word) { // ставим надпись за гребнем холма, лицом к камере первого экрана
      const dir = new THREE.Vector3().subVectors(poseA.tgt, poseA.pos).setY(0).normalize();
      word.scale.setScalar(narrow ? 0.4 : Math.min(1, aspect / 1.7));
      word.position.copy(poseA.pos).addScaledVector(dir, 118).setY(narrow ? 6.5 : 5.6);
      word.lookAt(poseA.pos.x, word.position.y, poseA.pos.z);
    }
  }
  new ResizeObserver(layout).observe(canvas);

  // замер скорости: два медленных окна подряд — снижаем уровень
  let seen = 0, mAcc = 0, mN = 0, slow = 0;
  function measure(dt) {
    if (qParam !== null || level === 0 || dt > 0.3 || ++seen < 45) return;
    mAcc += dt;
    if (++mN < 40) return;
    slow = mAcc / mN > 1 / 45 ? slow + 1 : 0;
    mAcc = mN = 0;
    if (slow >= 2) { level--; slow = 0; layout(); saveQuality(level); }
  }

  let sTarget = 0, s = 0, mx = 0, my = 0, pmx = 0, pmy = 0, last = 0, shadowS = -1, tick = 0;
  if (hero) addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

  const v = new THREE.Vector3(), tgt = new THREE.Vector3();
  // settled — показать дом уже собранным (нужно для прогрева шейдеров до показа сцены)
  function frame(time, settled = false) {
    const now = time / 1000, raw = last ? now - last : 1 / 60, dt = Math.min(raw, 0.1);
    last = now;
    if (!settled) measure(raw);
    const ease = 1 - Math.exp(-dt * 7); // сглаживание не зависит от частоты кадров
    s = reduceMotion || Math.abs(sTarget - s) < 0.0003 ? sTarget : lerp(s, sTarget, ease);
    const cam = smooth(0.04, 0.78, s), explode = hero ? smooth(0.45, 0.82, s) : 0;
    if (hero) {
      const d = smooth(0.08, 0.86, s);
      if (Math.abs(d - dusk) > 0.0004) applyDusk(d);
    }

    pmx = lerp(pmx, mx, ease * 0.5); pmy = lerp(pmy, my, ease * 0.5);
    camera.position.lerpVectors(poseA.pos, poseB.pos, cam);
    tgt.lerpVectors(poseA.tgt, poseB.tgt, cam);
    if (hero) { camera.position.x += pmx * 2.4; camera.position.y -= pmy * 0.9; }
    else if (!reduceMotion) camera.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(now * 0.25) * 0.35); // в конструкторе дом медленно поворачивается
    camera.lookAt(tgt);
    for (const cell of grassCells) { // вблизи подробные травинки, вдали простые
      const close = cell.center.distanceToSquared(camera.position) < GRASS_LOD * GRASS_LOD;
      cell.near.visible = close; cell.far.visible = !close;
    }

    if (!settled && startAt === null && ++warmup > 2) startAt = now;
    const mid = Math.round((modules.length - 1) / 2), boxC = GU.uBoxC.value, boxH = GU.uBoxH.value;
    for (let i = 0; i < BOXES; i++) boxC[i].set(0, -100, 0);
    modules.forEach((g, i) => {
      const u = g.userData;
      const k = settled || reduceMotion ? 1 : startAt === null ? 0 : clamp((now - startAt - u.delay) / 1.5);
      g.visible = k > 0;
      g.position.set(u.x0 + u.k * explode * gap, FLOOR + Math.pow(1 - k, 4) * 22, i === mid ? explode * 2.6 : 0); // модуль опускается, как с крана
      if (g.visible && i < 5) {
        const roofOnly = u.type === 'terrace';
        boxC[i].set(g.position.x, g.position.y + (roofOnly ? H + 0.1 : H / 2), g.position.z + 0.1);
        boxH[i].set(u.width / 2, roofOnly ? 0.12 : H / 2 + 0.22, D / 2 + (roofOnly ? 0.45 : 0.25));
      }
      const el = labels[i];
      if (el) {
        v.set(g.position.x, g.position.y + H + 0.5, g.position.z).project(camera);
        const x = (v.x * 0.5 + 0.5) * canvas.clientWidth, y = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        el.style.opacity = k < 1 || settled ? 0 : 1;
        el.firstChild.style.opacity = explode;
      }
    });
    if (living?.visible) { // терраса у входа и ступени
      const p = living.position;
      boxC[5].set(p.x, p.y - 0.14, p.z + D / 2 + 1.3); boxH[5].set((W - 0.3) / 2, 0.14, 1.3);
      boxC[6].set(p.x, p.y - 0.33, p.z + D / 2 + 3.08); boxH[6].set(1.2, 0.16, 0.48);
    }
    warm.forEach((w, i) => {
      if (w.host) w.light.position.set(w.host.position.x + w.at[0], w.host.position.y + w.at[1], w.host.position.z + w.at[2]);
      GU.uLampPos.value[i].set(w.light.position.x, w.light.position.y, w.light.position.z, w.light.distance);
      GU.uLampCol.value[i].copy(w.light.color).multiplyScalar(w.host?.visible ? w.light.intensity : 0);
    });
    GU.uTime.value = reduceMotion ? 0 : now;
    if (word) {
      word.material.opacity = 1 - smooth(0.25, 0.5, s);
      word.material.color.setScalar(1).lerp(cDusk, dusk * 0.18);
    }
    // пока меняется только время суток, тень от солнца достаточно пересчитывать через кадр
    if (settled || startAt === null || now - startAt < dropTime || (s !== shadowS && (explode > 0 || ++tick % 2 === 0))) { renderer.shadowMap.needsUpdate = true; shadowS = s; }
    renderer.render(scene, camera);
  }

  // --- отражения неба: считаем один раз для нескольких моментов дня, а не во время скролла
  layout();
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), maps = [];
  for (const stop of ENV_STOPS) {
    applyDusk(stop);
    envScene.add(sky);
    maps.push(pmrem.fromScene(envScene).texture);
    await breathe();
  }
  scene.add(sky);
  envMaps = maps;
  applyDusk(hero ? 0 : dusk);

  // --- надпись UNIT за холмом
  if (hero) {
    word = new THREE.Mesh(new THREE.PlaneGeometry(88, 22), new THREE.MeshBasicMaterial({ map: await wordmarkTexture(), transparent: true, toneMapped: false, depthWrite: false }));
    scene.add(word);
  }

  // --- прогрев: шейдеры компилируются и текстуры уходят в видеопамять до того, как сцену покажут
  setConfig(types, kit);
  for (const g of modules) g.visible = true;
  for (const t of [T.light, T.dark, T.deck]) { renderer.initTexture(t.map); renderer.initTexture(t.bump); }
  await renderer.compileAsync(scene, camera);
  frame(performance.now(), true);
  await breathe();

  // --- подбор качества до показа: меряем самый тяжёлый ракурс (вид сверху, закат, дом разобран)
  // и заодно прогреваем все состояния, через которые пройдёт скролл
  const gl = renderer.getContext(), pixel = new Uint8Array(4);
  const heavy = (at) => { s = sTarget = hero ? at : 0; frame(performance.now(), true); };
  const flush = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // ждём, пока видеокарта дорисует
  for (const at of [0.3, 0.55, 0.75, 1]) heavy(at);
  flush();
  if (qParam === null) {
    while (level > 0) {
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) heavy(0.9);
      flush();
      const ms = (performance.now() - t0) / 4;
      if (ms <= FRAME_BUDGET) break;
      level -= ms > FRAME_BUDGET * 2 && level > 1 ? 2 : 1;
      layout();
      heavy(0.9); flush(); // первый кадр после смены размера не в счёт
      await breathe();
    }
    saveQuality(level);
  }
  s = sTarget = 0;
  applyDusk(hero ? 0 : dusk);
  last = 0;
  for (const g of modules) g.visible = false;
  canvas.classList.add('is-ready');

  let raf = 0;
  const loop = (t) => { frame(t); raf = requestAnimationFrame(loop); };
  return {
    setConfig,
    setScroll(p) { sTarget = p; },
    run(on) {
      if (on && !raf) { last = 0; raf = requestAnimationFrame(loop); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}

// =====================================================================
// Страница
// =====================================================================
const houseTypes = () => LAYOUTS[state.n].concat(state.terrace ? ['terrace'] : []);
const configKey = () => `${state.n}|${state.kit}|${state.terrace}`;

let heroView = null, buildView = null;
{
  const key = configKey();
  createView(document.getElementById('scene'), { hero: true, labelsEl: document.getElementById('labels'), types: houseTypes(), kit: state.kit })
    .then((view) => {
      heroView = view;
      if (key !== configKey()) view.setConfig(houseTypes(), state.kit); // пока сцена грузилась, дом успели поменять
      measureScroll();
    })
    .catch((err) => {
      console.warn('WebGL недоступен, 3D-сцена отключена', err);
      document.documentElement.classList.add('no-webgl');
    });
}

function update() {
  const { n, kit, terrace } = state;
  const area = n * AREA_PER_MODULE;
  const beds = n - 1;
  const price = area * KITS[kit].price + (terrace ? TERRACE_PRICE : 0);
  const rooms = beds ? `${beds} ${plural(beds, ['спальня', 'спальни', 'спален'])}` : 'студия';

  const out = {
    area, n, rooms, bedrooms: beds || 'студия', price: rub(price), kitNote: KITS[kit].note,
    summary: `Ваша конфигурация: ${n} ${plural(n, ['модуль', 'модуля', 'модулей'])}, ${area} м², ${kit[0].toUpperCase() + kit.slice(1)}${terrace ? ', с террасой' : ''}.`,
  };
  document.querySelectorAll('[data-out]').forEach((el) => { el.textContent = out[el.dataset.out]; });
  // заявка: кнопка открывает наш чат в Telegram с уже набранным сообщением о выбранном доме
  const text = `Здравствуйте! Хочу рассчитать дом UNIT: ${n} ${plural(n, ['модуль', 'модуля', 'модулей'])}, ${area} м², комплектация ${kit[0].toUpperCase() + kit.slice(1)}, ${terrace ? 'с террасой' : 'без террасы'}. На сайте вышло от ${rub(price)} ₽.`;
  document.getElementById('leadLink').href = `https://t.me/${TELEGRAM_USER}?text=${encodeURIComponent(text)}`;

  const press = (sel, test) => document.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', test(b)));
  press('[data-count] button', (b) => +b.dataset.n === n);
  press('[data-kit] button', (b) => b.dataset.kitId === kit);
  press('[data-terrace] button', (b) => !!+b.dataset.t === terrace);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  if (b.dataset.n) state.n = +b.dataset.n;
  if (b.dataset.kitId) state.kit = b.dataset.kitId;
  if (b.dataset.t) state.terrace = !!+b.dataset.t;
  update();
  heroView?.setConfig(houseTypes(), state.kit);
  buildView?.setConfig(houseTypes(), state.kit);
});

// ---------- скролл управляет сценой и шапкой ----------
const split = document.getElementById('split'), topBar = document.querySelector('.top');
let scrollEnd = 1, solid = false;
function onScroll() {
  heroView?.setScroll(clamp(scrollY / scrollEnd));
  heroView?.run(scrollY < scrollEnd + innerHeight); // дальше сцена закрыта секциями
  if (phone) split.style.setProperty('--in', smooth(split.offsetTop - innerHeight * 0.1, split.offsetTop + innerHeight * 0.15, scrollY).toFixed(3)); // заголовок проявляется, когда первый экран уехал
  const next = scrollY > scrollEnd + innerHeight - 72; // над светлыми секциями шапке нужна подложка
  if (next !== solid) topBar.classList.toggle('is-solid', solid = next);
}
function measureScroll() {
  scrollEnd = split.offsetTop + split.offsetHeight - innerHeight;
  onScroll();
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', measureScroll);

// сцену конструктора создаём, только когда к ней подошли, и крутим, только пока она рядом с экраном
let buildNear = false, buildLoading = false;
new IntersectionObserver(([entry]) => {
  buildNear = entry.isIntersecting;
  if (buildNear && !buildView && !buildLoading && !document.documentElement.classList.contains('no-webgl')) {
    buildLoading = true;
    const key = configKey();
    createView(entry.target, { types: houseTypes(), kit: state.kit })
      .then((view) => {
        buildView = view;
        if (key !== configKey()) view.setConfig(houseTypes(), state.kit);
        view.run(buildNear);
      })
      .catch((err) => console.warn('3D-сцена конструктора не запустилась', err));
  }
  buildView?.run(buildNear);
}, { rootMargin: '60% 0px' }).observe(document.getElementById('buildScene'));

// ---------- меню на телефоне ----------
const menuButton = document.querySelector('.top__menu');
function setMenu(open) {
  topBar.classList.toggle('is-open', open);
  menuButton.setAttribute('aria-expanded', open);
}
menuButton.addEventListener('click', () => setMenu(!topBar.classList.contains('is-open')));
topBar.querySelector('.top__nav').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

// ---------- вопросы: открыт только один ответ, высота меняется плавно ----------
const faq = [...document.querySelectorAll('.faq__item')];
function setFaq(item, open) {
  item.classList.toggle('is-open', open);
  item.querySelector('button').setAttribute('aria-expanded', open);
  item.querySelector('.faq__body').inert = !open;
}
faq.forEach((item) => {
  setFaq(item, item.classList.contains('is-open'));
  item.querySelector('button').addEventListener('click', () => {
    const open = !item.classList.contains('is-open');
    faq.forEach((other) => setFaq(other, other === item && open));
  });
});

// ---------- слои стены ----------
function setLayer(i) {
  document.querySelectorAll('#wall span').forEach((s) => s.classList.toggle('is-on', +s.dataset.l === i));
  document.querySelectorAll('.layers__list button').forEach((b) => b.setAttribute('aria-selected', +b.dataset.l === i));
  document.getElementById('layerText').textContent = LAYERS[i];
}
document.querySelector('.layers__list').addEventListener('click', (e) => {
  if (e.target.dataset.l) setLayer(+e.target.dataset.l);
});

// ---------- ипотека ----------
const calc = document.getElementById('calc');
function updateCalc() {
  const v = Object.fromEntries(new FormData(calc));
  const cost = +v.cost, down = Math.min(+v.down, cost), years = +v.years, rate = +v.rate;
  const m = rate / 100 / 12, k = years * 12;
  const pay = (cost - down) * m / (1 - Math.pow(1 + m, -k));
  const fmt = {
    cost: `${rub(cost)} ₽`, down: `${rub(down)} ₽`,
    years: `${years} ${plural(years, ['год', 'года', 'лет'])}`, rate: `${String(rate).replace('.', ',')} %`,
  };
  calc.querySelectorAll('output').forEach((o) => { o.textContent = fmt[o.dataset.for]; });
  document.getElementById('pay').textContent = `${rub(pay)} ₽`;
}
calc.addEventListener('input', updateCalc);

// ---------- видео: YouTube подгружается только по клику и играет прямо в блоке ----------
document.querySelectorAll('.video').forEach((box) => {
  box.querySelector('.video__open').addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${box.dataset.youtube}?autoplay=1&rel=0&playsinline=1`;
    frame.title = 'Видео о строительстве дома';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    box.replaceChildren(frame);
  });
});

update();
setLayer(0);
updateCalc();
measureScroll();
