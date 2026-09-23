// 校验脚本：用最小 DOM 桩在 Node 里跑通 reader/app.js 的启动、路由、搜索、主题、移动端开合
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const READER = fileURLToPath(new URL('../reader/', import.meta.url));
const html = fs.readFileSync(path.join(READER, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const fail = [];
const ok = (cond, label) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fail.push(label);
};

/* ------------------------------------------------------------------ 桩 */
function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    _set: set,
  };
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class El {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.classList = makeClassList();
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.attrs = {};
    this._innerHTML = '';
    this._textContent = '';
    this.title = '';
    this.disabled = false;
  }
  set innerHTML(v) { this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML; }
  // 真实 DOM 中 textContent 写入会反映到 innerHTML（转义后），escapeHtml 依赖该行为
  set textContent(v) { this._textContent = String(v); this._innerHTML = escapeText(v); }
  get textContent() { return this._textContent; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, ev = {}) {
    (this.listeners[type] || []).forEach((fn) => fn({
      target: this,
      stopPropagation() { },
      preventDefault() { },
      ...ev,
    }));
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(c) { return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  closest() { return null; }
  replaceChild() { }
  normalize() { }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { top: 0 }; }
  get offsetWidth() { return 1; }
}

const elements = new Map();
const missingIds = [];
for (const id of htmlIds) elements.set(id, new El(id));
elements.set('content-stub', new El('content-stub'));

// 桩一个已渲染的 Mermaid 容器，用于验证「切主题后按新主题重渲染」
// 启动阶段页面还没有内容，因此默认不可见，进入主题用例前再打开
let showMermaidContainer = false;
const mermaidContainer = new El('mermaid-container-stub');
mermaidContainer.dataset.mermaidSource = 'graph TD;A-->B';

const documentListeners = {};
const createdMarks = [];
const fakeTextNode = { nodeValue: '这里出现 常见 两个字，还有第二个 常见。', parentNode: new El('p') };
let walkerYielded = false;
const document = {
  getElementById(id) {
    if (!elements.has(id)) { missingIds.push(id); return null; }
    return elements.get(id);
  },
  querySelector(sel) { return sel === '.content' ? elements.get('content-stub') : null; },
  querySelectorAll(sel) {
    return (sel.includes('mermaid-container') && showMermaidContainer) ? [mermaidContainer] : [];
  },
  createElement: (tag) => {
    const el = new El('', tag);
    if (String(tag).toLowerCase() === 'mark') createdMarks.push(el);
    return el;
  },
  createTextNode: (text) => ({ nodeValue: String(text), parentNode: null }),
  createDocumentFragment: () => ({ children: [], appendChild(c) { this.children.push(c); } }),
  // 只吐一个假文本节点：验证「切分 + 逐段转义 + 包 mark」的字符串逻辑；
  // 真实 DOM 的遍历器/SVG 过滤行为由 browser-check.py 用真浏览器覆盖
  createTreeWalker: () => ({ nextNode: () => (walkerYielded ? null : (walkerYielded = true, fakeTextNode)) }),
  addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); },
  body: new El('body'),
  documentElement: Object.assign(new El('html'), { scrollHeight: 5000 }),
  title: '',
};
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const location = { search: '', hash: '' };

const indexJson = fs.readFileSync(path.join(READER, 'index.json'), 'utf8');
const configJson = fs.readFileSync(path.join(READER, 'config.json'), 'utf8');
const searchJson = fs.readFileSync(path.join(READER, 'search-index.json'), 'utf8');

// 合成条目：
//   1) 标题含 HTML 的文档 —— 验证搜索高亮不会把标题当 HTML 解析
//   2) 文件数达到阈值的目录 —— 真实数据的目录都只有 3 个文件，需要它来覆盖「默认收起」分支
// 真实条目数从 index.json 现数，避免加文档后这里的常量失配
const indexData = JSON.parse(indexJson);
const countFiles = (items) => items.reduce(
  (n, c) => n + (c.type === 'folder' ? countFiles(c.children || []) : 1), 0);
const REAL_DOCS = countFiles(indexData);
const REAL_FOLDERS = indexData.filter((c) => c.type === 'folder').length;

indexData.push({
  type: 'file',
  name: 'xss-probe.txt',
  path: 'xss-probe.txt',
  title: '<img src=x onerror=alert(1)> 注入测试',
});
indexData.push({
  type: 'folder',
  name: 'big-folder',
  children: ['f1', 'f2', 'f3', 'f4'].map((n) => ({
    type: 'file', name: n + '.txt', path: 'big-folder/' + n + '.txt', title: n,
  })),
});
const indexJsonWithProbe = JSON.stringify(indexData);
const DOC_COUNT = REAL_DOCS + 1 + 4;

// 全文索引也插一条标题含 HTML 的合成文档，用来验证命中片段/标题的转义
const searchData = JSON.parse(searchJson);
searchData.push({
  path: 'xss-probe.txt',
  title: '<img src=x onerror=alert(1)> 注入测试',
  text: '正文里也写了 img 这个关键字，用来验证片段转义',
});
const searchJsonWithProbe = JSON.stringify(searchData);

const fetchCalls = [];
globalThis.fetch = (url) => {
  const clean = String(url);
  fetchCalls.push(clean);
  if (clean.startsWith('config.json')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(configJson)) });
  if (clean.startsWith('index.json')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(indexJsonWithProbe)) });
  if (clean.startsWith('search-index.json')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(searchJsonWithProbe)) });
  if (clean.startsWith('docs/')) {
    const file = path.join(READER, 'docs', decodeURIComponent(clean.slice('docs/'.length)));
    if (fs.existsSync(file)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fs.readFileSync(file, 'utf8')) });
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  }
  return Promise.reject(new Error('unexpected url ' + url));
};

globalThis.document = document;
globalThis.location = location;
globalThis.localStorage = localStorage;
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: () => Promise.resolve() } },
  configurable: true,
  writable: true,
});
globalThis.IntersectionObserver = class { observe() { } unobserve() { } disconnect() { } };
globalThis.requestAnimationFrame = (fn) => fn();

const windowListeners = {};
const scrollCalls = [];
// 移动端断点桩：app.js 通过 matchMedia('(max-width: 768px)') 判定，用例里拨动 matches 模拟换端
const mobileMq = { matches: false, media: '(max-width: 768px)' };
const lastScrollTo = () => scrollCalls[scrollCalls.length - 1];
let mermaidConfig = null;
const mermaidRenderCalls = [];
const windowStub = {
  innerWidth: 1440,
  innerHeight: 900,
  screen: { width: 1920 },
  matchMedia: (q) => mobileMq,
  scrollY: 0,
  scrollTo(a, b) {
    scrollCalls.push((typeof a === 'object' && a !== null) ? a : { top: a, left: b });
  },
  addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
  location,
  localStorage,
  document,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  // markdown-it / hljs / mermaid 是 CDN 依赖，这里只桩接口以验证接线
  markdownit: () => ({ render: (t) => '<h1>' + escapeText(t.split('\n')[0]) + '</h1><pre class="hljs"><code>x</code></pre>' }),
  hljs: { getLanguage: () => false, highlightElement() { } },
  mermaid: {
    initialize: (opts) => { mermaidConfig = opts; },
    render: (id, code) => {
      mermaidRenderCalls.push({ id, code, theme: mermaidConfig && mermaidConfig.theme });
      return Promise.resolve({ svg: '<svg data-theme="' + (mermaidConfig && mermaidConfig.theme) + '"></svg>' });
    },
  },
};
globalThis.window = windowStub;
// 浏览器里 mermaid / hljs 同时也是全局变量，补上以免误判
globalThis.mermaid = windowStub.mermaid;
globalThis.hljs = windowStub.hljs;

const fire = async (type, ev = {}) => {
  for (const fn of windowListeners[type] || []) fn(ev);
  await new Promise((r) => setTimeout(r, 20));
};

/* --------------------------------------------------------------- 运行 app */
const appSrc = fs.readFileSync(path.join(READER, 'app.js'), 'utf8');
new Function('window', 'document', 'location', 'localStorage', 'navigator', 'fetch',
  'IntersectionObserver', 'requestAnimationFrame', appSrc)(
  windowStub, document, location, localStorage, globalThis.navigator, globalThis.fetch,
  globalThis.IntersectionObserver, globalThis.requestAnimationFrame);

await new Promise((r) => setTimeout(r, 60));

console.log('--- 启动与侧边栏 ---');
ok(missingIds.length === 0, 'app.js 引用的元素 id 全部存在于 index.html' + (missingIds.length ? ' 缺失: ' + missingIds.join(',') : ''));

const sidebar = elements.get('sidebar-list');
ok((sidebar.innerHTML.match(/data-path=/g) || []).length === DOC_COUNT, `侧边栏渲染 ${DOC_COUNT} 个文档条目（实际 ` + (sidebar.innerHTML.match(/data-path=/g) || []).length + '）');
// 根目录 txt 本身也作为一个可折叠节点，加上 07/08/09 三个子目录
ok((sidebar.innerHTML.match(/class="folder"/g) || []).length === REAL_FOLDERS + 1, `侧边栏 ${REAL_FOLDERS} 个真实目录 + 1 个合成目录（索引不再外裹 source_dir）`);
ok(!sidebar.innerHTML.includes('>txt<'), '侧边栏不再出现名为 txt 的包装节点');
ok(sidebar.innerHTML.includes('data-parent="folder-0" style="display:block"'), '小目录（3 个文件）默认展开');
ok(sidebar.innerHTML.includes('data-parent="folder-3" style="display:none"'), '大目录（4 个文件）默认收起');
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sidebar.innerHTML), '侧边栏不含 emoji 图标（目录/文件前缀）');
ok(!sidebar.innerHTML.includes('folder-icon') && !sidebar.innerHTML.includes('file-icon'), '侧边栏不再输出图标占位元素');
ok(sidebar.innerHTML.includes('href="#01-%E9%A1%B9%E7%9B%AE%E7%AE%80%E4%BB%8B.txt"'), '锚点 href 用百分号编码的 hash 作为唯一路由');
ok(sidebar.innerHTML.includes('data-path="07-架构设计/01-整体架构.txt"'), '嵌套目录内路径正确');
// 排序：纯按名称（数字段按数值），目录与文件同级混排
const seq = ['01-项目简介.txt', '07-架构设计', '08-开发规范', '99-测试文档.txt'].map((s) => sidebar.innerHTML.indexOf(s));
ok(seq.every((pos, i) => pos !== -1 && (i === 0 || seq[i - 1] < pos)), '顶层按名称顺序渲染：07 目录夹在 06 文件与 99 文件之间，无目录优先（位置 ' + seq.join(' < ') + '）');
ok(elements.get('search-container').style.display === 'block', '搜索框按配置显示');
ok(document.title === '文档前端展示引擎', '站点标题来自 config.json');
ok(fetchCalls.filter((u) => u.startsWith('config.json')).length === 1, 'config.json 只请求一次');
ok(fetchCalls.filter((u) => u.startsWith('index.json')).length === 1, 'index.json 只请求一次（清空搜索时不再重复请求）');
ok(fetchCalls.filter((u) => u.startsWith('search-index.json')).length === 0, '首篇文档加载前不请求全文索引（首屏零额外请求）');

console.log('--- 路由（hashchange 是唯一入口）---');
location.hash = '#' + encodeURIComponent('01-项目简介.txt');
await fire('hashchange');
const viewer = elements.get('viewer');
ok(viewer.innerHTML.startsWith('<h1># 轻量级文档阅读器'), '点击/改 hash 后渲染出正文');
ok(fetchCalls.filter((u) => u.includes('01-')).length === 1, '首次加载只发起一次文档请求');

// 同一路径重复触发：命中缓存，不应重复请求，也不应回写 hash
const before = fetchCalls.length;
await fire('hashchange');
await fire('hashchange');
ok(fetchCalls.length === before, '重复加载同一文档命中缓存，无重复请求');

// 换一篇
location.hash = '#' + encodeURIComponent('09-运维手册/03-故障排查.txt');
await fire('hashchange');
ok(viewer.innerHTML.includes('故障排查') || viewer.innerHTML.startsWith('<h1>'), '切换文档正常渲染');

console.log('--- 阅读位置记忆 ---');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在「安装部署」里滚到 1234
location.hash = '#' + encodeURIComponent('02-安装部署.txt');
await fire('hashchange');
await sleep(60);
windowStub.scrollY = 1234;
await fire('scroll');
await sleep(20);

// 切到没记录的「配置指南」：应回到顶部
location.hash = '#' + encodeURIComponent('03-配置指南.txt');
await fire('hashchange');
await sleep(60);
ok(lastScrollTo() && lastScrollTo().top === 0, '切到没记录的文档时回到顶部（实际 ' + JSON.stringify(lastScrollTo()) + '）');

// 回到「安装部署」：应回到 1234
location.hash = '#' + encodeURIComponent('02-安装部署.txt');
await fire('hashchange');
await sleep(60);
ok(lastScrollTo() && lastScrollTo().top === 1234, '回到读过的文档时恢复阅读位置（实际 ' + JSON.stringify(lastScrollTo()) + '）');
ok(lastScrollTo() && lastScrollTo().behavior === 'instant', '恢复位置用即时滚动，不走平滑动画');

await sleep(800);   // 等节流写入
const posSaved = store.get('readPos') || '';
ok(posSaved.indexOf('02-安装部署.txt') !== -1, '阅读位置写入 localStorage（' + posSaved.slice(0, 60) + '）');

// 滚回到开头附近应清掉记录
windowStub.scrollY = 50;
await fire('scroll');
await sleep(800);
ok((store.get('readPos') || '').indexOf('02-安装部署.txt') === -1, '回到开头后清掉该文档的记录');

console.log('--- 搜索（侧栏全量检索 + 命中片段）---');
const items = () => elements.get('sidebar-list').innerHTML
  .split('<li class="sub-item">').slice(1).map((s) => s.split('</li>')[0]);

elements.get('search-input').dispatch('input', { target: { value: '常见' } });
await new Promise((r) => setTimeout(r, 300));
const searchHtml = elements.get('sidebar-list').innerHTML;
ok(searchHtml.includes('搜索结果（'), '结果列表带命中数量');
ok(searchHtml.includes('<mark class="search-hit">常见</mark>'), '命中片段被 <mark class="search-hit"> 包住');
ok(items()[0].includes('class="search-snippet"'), '命中文档带正文片段（命中区域）');
ok(!items()[0].includes('search-path'), '片段已说明命中位置时不再显示路径');
ok(searchHtml.includes('class="search-count"'), '多次命中时标出命中次数');

elements.get('search-input').dispatch('input', { target: { value: '运维手册' } });
await new Promise((r) => setTimeout(r, 300));
const pathHtml = elements.get('sidebar-list').innerHTML;
ok(pathHtml.includes('search-path') && pathHtml.includes('<mark class="search-hit">运维手册</mark>'), '命中只在路径上时补一行高亮路径');

elements.get('search-input').dispatch('input', { target: { value: 'img' } });
await new Promise((r) => setTimeout(r, 300));
const probeHtml = elements.get('sidebar-list').innerHTML;
ok(probeHtml.includes('<mark class="search-hit">img</mark>'), '合成文档命中：关键字被高亮');
ok(!probeHtml.includes('<img '), '标题里的 HTML 未被原样注入');
ok(probeHtml.includes('&lt;'), '标题里的尖括号被转义为 &lt;');
ok(items().every((it) => it.includes('data-search-hit=')), '结果条目都带上关键词（点击时用于正文定位）');

// 模拟点击结果：委托监听应记住关键词并让文档加载（正文内的定位由真浏览器自检覆盖）
const fakeLink = { dataset: { path: '01-项目简介.txt', searchHit: '常见' } };
const linkClick = () => (documentListeners.click || []).forEach((fn) =>
  fn({ target: { closest: () => fakeLink }, preventDefault() { } }));

ok(documentListeners.click && documentListeners.click.length === 1, '注册了唯一的链接点击委托');

// ① hash 与目标不同：交给浏览器改 hash，再由 hashchange 加载
walkerYielded = false;
createdMarks.length = 0;
linkClick();
location.hash = '#' + encodeURIComponent(fakeLink.dataset.path);
await fire('hashchange');
await new Promise((r) => setTimeout(r, 80));
ok(elements.get('viewer').innerHTML.includes('轻量级文档阅读器'), '点击搜索结果会加载对应文档');
ok(!elements.get('viewer').innerHTML.includes('搜索结果（'), '结果不会占用主区域');

// 正文定位：假文本节点里有两处命中，应包成两个 mark，首个带 doc-hit-first
ok(createdMarks.length === 2, '正文命中被逐个包成 <mark>（实际 ' + createdMarks.length + ' 个）');
ok(createdMarks[0].className === 'doc-hit doc-hit-first', '首个标记带 doc-hit-first：' + createdMarks[0].className);
ok(createdMarks[1].className === 'doc-hit', '其余标记只带 doc-hit：' + createdMarks[1].className);
ok(createdMarks[0].textContent === '常见', '标记内容就是命中的关键词：' + createdMarks[0].textContent);

// ② hash 与目标相同：浏览器不派发 hashchange，委托监听要自己补一次加载
let loadDocCalls = 0;
const realLoadDoc = windowStub.loadDoc;
windowStub.loadDoc = function (path) { loadDocCalls += 1; return realLoadDoc.call(windowStub, path); };
walkerYielded = false;
linkClick();
await new Promise((r) => setTimeout(r, 80));
ok(loadDocCalls === 1, 'hash 相同时点击仍会重新加载（实际调用 ' + loadDocCalls + ' 次）');

elements.get('search-input').dispatch('input', { target: { value: 'zzz-不存在' } });
await new Promise((r) => setTimeout(r, 300));
ok(elements.get('sidebar-list').innerHTML.includes('未找到匹配的文档'), '无匹配时给出提示');

elements.get('search-input').dispatch('input', { target: { value: '' } });
await new Promise((r) => setTimeout(r, 300));
ok(fetchCalls.filter((u) => u.startsWith('index.json')).length === 1, '清空搜索复用已缓存的目录索引');
ok(fetchCalls.filter((u) => u.startsWith('search-index.json')).length === 1, '全文索引只取一次');
ok((elements.get('sidebar-list').innerHTML.match(/data-path=/g) || []).length === DOC_COUNT, '清空搜索后恢复完整目录树');

console.log('--- 主题与侧边栏状态 ---');
ok(mermaidConfig && mermaidConfig.theme === 'default' && mermaidConfig.startOnLoad === false, '启动时按当前主题初始化 Mermaid');
ok(mermaidRenderCalls.length === 0, '启动阶段页面无图表，不触发渲染');
showMermaidContainer = true;
elements.get('theme-toggle').dispatch('click');
ok(document.body.classList.contains('dark'), '切换按钮打开暗色模式');
ok(store.get('theme') === 'dark', '主题写入 localStorage');
ok(elements.get('hljs-dark-theme').disabled === false && elements.get('hljs-light-theme').disabled === true, 'highlight.js 主题联动切换');
await new Promise((r) => setTimeout(r, 20));
ok(mermaidRenderCalls.length === 1 && mermaidRenderCalls[0].theme === 'dark', '切到暗色后 Mermaid 以 dark 主题重渲染（调用 ' + mermaidRenderCalls.length + ' 次）');
ok(mermaidContainer.innerHTML.includes('data-theme="dark"'), '重渲染结果写回图表容器');
elements.get('theme-toggle-collapsed').dispatch('click');
ok(!document.body.classList.contains('dark'), '再次切换回亮色');
ok(elements.get('hljs-light-theme').disabled === false, 'highlight.js 亮色样式恢复');
await new Promise((r) => setTimeout(r, 20));
ok(mermaidRenderCalls.length === 2 && mermaidRenderCalls[1].theme === 'default', '切回亮色后 Mermaid 再次以 default 主题重渲染');
ok(mermaidRenderCalls[0].id !== mermaidRenderCalls[1].id, '两次渲染 id 不同：mermaid-svg-0 / mermaid-svg-1（实际 ' + mermaidRenderCalls.map((c) => c.id).join(' / ') + '）');

elements.get('sidebar-toggle').dispatch('click');
ok(elements.get('sidebar').classList.contains('collapsed'), '侧边栏可收起');
ok(store.get('sidebarCollapsed') === 'true', '收起状态写入 localStorage');
ok(elements.get('search-toggle-collapsed').style.display !== 'none', '搜索开启时收起态保留搜索按钮');
elements.get('search-toggle-collapsed').dispatch('click');
ok(!elements.get('sidebar').classList.contains('collapsed'), '收起态点搜索按钮即展开侧边栏');
ok(elements.get('search-input').focused === true, '展开后焦点直接落在搜索框');
elements.get('sidebar-toggle').dispatch('click');
ok(elements.get('sidebar').classList.contains('collapsed'), '侧边栏可再次收起（底部按钮是开关，收起态的小按钮只负责展开）');

console.log('--- 移动端开合（与桌面 collapsed 记忆态解耦）---');
mobileMq.matches = true;

// 模拟「桌面收起后换到移动端」：collapsed 残留时汉堡必须仍能打开（死角 A）
elements.get('sidebar').classList.add('collapsed');
elements.get('mobile-menu-btn').dispatch('click');
ok(elements.get('sidebar').classList.contains('mobile-open'), '移动端点汉堡打开抽屉');
ok(!elements.get('sidebar').classList.contains('collapsed'), '打开时清掉桌面遗留的 collapsed，避免 CSS 覆盖导致打不开');
ok(document.body.classList.contains('sidebar-open'), '遮罩状态随抽屉一起置位');

// footer 的「收起」在移动端 = 关抽屉：三个类全部清干净（死角 B）
elements.get('sidebar-toggle').dispatch('click');
ok(!elements.get('sidebar').classList.contains('mobile-open'), 'footer 收起按钮关闭抽屉');
ok(!document.body.classList.contains('sidebar-open'), '关闭时遮罩状态一并清掉，不再卡中间态');
ok(!elements.get('sidebar').classList.contains('collapsed'), '移动端不写入 collapsed 记忆态');

mobileMq.matches = false;

console.log('--- 滚动 ---');
windowStub.scrollY = 500;
await fire('scroll');
ok(elements.get('back-to-top').classList.contains('visible'), '滚动超过阈值显示返回顶部');
const transform = elements.get('reading-progress').style.transform;
ok(/^scaleX\(0\.1\d+\)$/.test(transform), '进度条用 transform 表示进度（实际 ' + transform + '）');

console.log('\n' + (fail.length ? 'FAILED: ' + fail.length + ' 项' : 'ALL PASS'));
process.exit(fail.length ? 1 : 0);
