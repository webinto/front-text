(function () {
  'use strict';

  /* ---------------------------------------------------------------- 基础 */

  // 调试日志：默认关闭，需要时用 index.html?debug 打开
  const DEBUG = /[?&]debug\b/.test(location.search);
  function log() {
    if (DEBUG) console.log.apply(console, arguments);
  }

  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const sidebarList = $('sidebar-list');
  const sidebarTitle = $('sidebar-title');
  const backToTop = $('back-to-top');
  const searchContainer = $('search-container');
  const searchInput = $('search-input');
  const sidebar = $('sidebar');
  const sidebarToggle = $('sidebar-toggle');
  const themeToggle = $('theme-toggle');
  const sidebarToggleCollapsed = $('sidebar-toggle-collapsed');
  const themeToggleCollapsed = $('theme-toggle-collapsed');
  const searchToggleCollapsed = $('search-toggle-collapsed');
  const mobileMenuBtn = $('mobile-menu-btn');
  const sidebarOverlay = $('sidebar-overlay');
  const readingProgress = $('reading-progress');
  const hljsLightTheme = $('hljs-light-theme');
  const hljsDarkTheme = $('hljs-dark-theme');

  const ICON_SUN = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const ARROW_COLLAPSED = 'M9 18l6-6-6-6';
  const ARROW_EXPANDED = 'M15 18l-6-6 6-6';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 在原始文本上按关键字切分，只对纯文本片段做转义，命中片段用 <mark> 包住
  function highlightMatch(text, keyword) {
    if (!keyword) return escapeHtml(text);
    const re = new RegExp(escapeRegExp(keyword), 'gi');
    let out = '';
    let last = 0;
    text.replace(re, (match, offset) => {
      out += escapeHtml(text.slice(last, offset)) +
        '<mark class="search-hit">' + escapeHtml(match) + '</mark>';
      last = offset + match.length;
      return match;
    });
    return out + escapeHtml(text.slice(last));
  }

  /* ------------------------------------------------------ 文档获取与渲染 */

  // 单一缓存：path(原始、未编码) -> 已渲染 HTML；prefetch 与点击共用同一条链路
  const rendered = new Map();
  const inflight = new Map();

  const md = window.markdownit ? window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    // 注意：markdown-it 在 highlight 返回以 <pre 开头的字符串时会原样采用，
    // 因此这里必须自己带上 language-* 类名，否则 enhanceCodeBlocks 认不出 mermaid 等围栏
    highlight: function (str, lang) {
      const cls = lang ? ' class="language-' + escapeAttr(lang) + '"' : '';
      if (window.hljs && lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code' + cls + '>' +
            hljs.highlight(str, { language: lang }).value +
            '</code></pre>';
        } catch (e) { /* 语法高亮失败则回退为纯文本 */ }
      }
      return '<pre class="hljs"><code' + cls + '>' + escapeHtml(str) + '</code></pre>';
    }
  }) : null;

  function renderMarkdown(text) {
    if (!md) {
      return '<pre class="hljs"><code>' + escapeHtml(text) + '</code></pre>';
    }
    try {
      return md.render(text).replace(/<\/p>\s*<p>/g, '<br>');
    } catch (error) {
      console.error('[Render] Markdown 解析失败:', error);
      return '<p>Markdown 解析失败: ' + escapeHtml(error.message) + '</p>';
    }
  }

  // DOCX 走 mammoth 生成的 HTML 会按原文插入（.html 路径），插入前统一过 DOMPurify：
  // 脚本、事件属性、javascript: URL 一律剥掉。CDN 不可用时退回原样，行为与旧版一致。
  // md/txt 由 markdown-it 渲染，不在此过滤范围
  function sanitizeDocHtml(html, path) {
    if (!/\.html$/i.test(path)) return html;
    if (!window.DOMPurify || !DOMPurify.isSupported) {
      log('[Sanitize] DOMPurify 不可用，DOCX HTML 未经净化直接插入');
      return html;
    }
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  // 取回并渲染文档；同一路径的并发请求共享同一个 Promise
  function resolveDoc(path) {
    if (rendered.has(path)) return Promise.resolve(rendered.get(path));
    if (inflight.has(path)) return inflight.get(path);

    const task = fetch('docs/' + encodeURIComponent(path))
      .then((res) => {
        if (!res.ok) throw new Error('文件不存在: ' + path);
        return res.text();
      })
      .then((text) => {
        const html = /\.html$/i.test(path)
          ? sanitizeDocHtml(text, path)
          : renderMarkdown(text);
        rendered.set(path, html);
        inflight.delete(path);
        return html;
      })
      .catch((err) => {
        inflight.delete(path);
        throw err;
      });

    inflight.set(path, task);
    return task;
  }

  let prefetchTimer = null;
  const prefetchQueue = new Set();

  function prefetchDoc(path) {
    if (!path || rendered.has(path) || inflight.has(path)) return;
    prefetchQueue.add(path);
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      prefetchQueue.forEach((p) => resolveDoc(p).catch(() => { /* 预取失败忽略 */ }));
      prefetchQueue.clear();
    }, 120);
  }

  /* ------------------------------------------------------- 阅读位置记忆 */

  const POS_KEY = 'readPos';
  const POS_MIN = 200;          // 距顶部不到这个距离视为"还在开头"，不留记录
  const POS_MAX_ENTRIES = 60;   // 只保留最近若干篇，避免无限增长
  const POS_FLUSH_MS = 600;

  let posMemory = loadPosMemory();
  let posFlushTimer = null;
  let posDirty = false;

  function loadPosMemory() {
    try {
      const data = JSON.parse(localStorage.getItem(POS_KEY) || '{}');
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (e) {
      log('[Pos] 读取历史位置失败，忽略:', e.message);
      return {};
    }
  }

  function flushPosMemory() {
    if (!posDirty) return;
    posDirty = false;
    try {
      const recent = Object.keys(posMemory)
        .map((path) => [path, posMemory[path]])
        .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
        .slice(0, POS_MAX_ENTRIES);
      posMemory = {};
      recent.forEach(([path, pos]) => { posMemory[path] = pos; });
      localStorage.setItem(POS_KEY, JSON.stringify(posMemory));
    } catch (e) {
      log('[Pos] 保存历史位置失败:', e.message);
    }
  }

  function rememberPosition(path, y) {
    if (!path) return;
    if (y < POS_MIN) {
      if (!posMemory[path]) return;
      delete posMemory[path];          // 回到开头就把记录清掉
    } else {
      posMemory[path] = { y: Math.round(y), t: Date.now() };
    }
    posDirty = true;
    clearTimeout(posFlushTimer);
    posFlushTimer = setTimeout(flushPosMemory, POS_FLUSH_MS);
  }

  // 回到上次读到的位置；位置被内容变短挤掉时按当前最大可滚距离收口
  function restorePosition(path) {
    const pos = path ? posMemory[path] : null;
    if (!pos || !pos.y) return false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= POS_MIN) return false;
    window.scrollTo({ top: Math.min(pos.y, max), behavior: 'instant' });
    return true;
  }

  // 页面被隐藏/卸载时把节流中的记录落盘
  window.addEventListener('beforeunload', flushPosMemory);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPosMemory();
  });

  /* ------------------------------------------------------------- Mermaid */

  let mermaidSeq = 0;

  function initMermaid() {
    if (!window.mermaid) return;
    mermaid.initialize({
      startOnLoad: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'default',
    });
  }

  // 每次都用新的 id 渲染，避免 mermaid 按 id 命中缓存、换主题后拿到旧图
  function renderMermaidInto(container, code) {
    if (!window.mermaid || !code) return;
    const id = 'mermaid-svg-' + (mermaidSeq++);
    try {
      Promise.resolve(mermaid.render(id, code))
        .then((result) => {
          container.innerHTML = result.svg;
          if (result.bindFunctions) result.bindFunctions(container);
        })
        .catch((err) => console.error('[Mermaid] Render failed:', err));
    } catch (err) {
      console.error('[Mermaid] Render failed:', err);
    }
  }

  // 主题切换后按新主题重渲染当前页面的图表（源码存在 data-mermaid-source 上）
  function rerenderMermaid() {
    if (!window.mermaid) return;
    const containers = document.querySelectorAll('.mermaid-container[data-mermaid-source]');
    if (!containers.length) return;
    initMermaid();
    containers.forEach((container) => renderMermaidInto(container, container.dataset.mermaidSource));
  }

  /* ---------------------------------------------------------- 配置与索引 */

  let config = {};
  let indexTree = null;
  let allDocs = [];

  function loadConfig() {
    return fetch('config.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('config.json ' + r.status);
        return r.json();
      })
      .then((cfg) => {
        config = cfg || {};
        log('[Config] 加载配置:', config);
        if (config.site_title) document.title = config.site_title;
        if (config.sidebar_title) sidebarTitle.textContent = config.sidebar_title;
        if (config.max_content_width) {
          document.querySelector('.content').style.maxWidth = config.max_content_width + 'px';
        }
        if (config.enable_back_to_top === false) backToTop.style.display = 'none';
        if (config.enable_search !== false) {
          searchContainer.style.display = 'block';
        } else if (searchToggleCollapsed) {
          searchToggleCollapsed.style.display = 'none';   // 搜索关闭时收起态的搜索按钮一并隐藏
        }
      })
      .catch((err) => {
        log('[App] 配置加载失败，使用默认值:', err.message);
        searchContainer.style.display = 'block';
      });
  }

  // 一次遍历同时得到扁平文档列表与每个目录的文件数，避免渲染时反复递归
  function collectDocs(items, flat) {
    let count = 0;
    for (const item of items) {
      if (item.type === 'file') {
        count += 1;
        flat.push(item);
      } else if (item.type === 'folder' && item.children) {
        item.fileCount = collectDocs(item.children, flat);
        count += item.fileCount;
      }
    }
    return count;
  }

  function loadIndex() {
    return fetch('index.json', { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error('索引文件不存在');
        return r.json();
      })
      .then((data) => {
        indexTree = data;
        allDocs = [];
        collectDocs(data, allDocs);
        renderSidebar(data);
      })
      .catch((err) => {
        log('[App] ' + err.message);
        sidebarList.innerHTML = '<li>请在 config.json 中配置 source_dir</li>';
      });
  }

  /* -------------------------------------------------------------- 侧边栏 */

  let folderSeq = 0;

  function renderSidebar(data) {
    folderSeq = 0;
    sidebarList.innerHTML = data.map((item) => renderSidebarItem(item, 0)).join('') || '<li>暂无文档</li>';
    attachFolderListeners();
  }

  function renderSidebarItem(item, depth) {
    if (item.type === 'folder') {
      const collapsed = (item.fileCount || 0) >= 4;
      const folderId = 'folder-' + (folderSeq++);
      let html = '<li class="folder" data-folder-id="' + folderId + '">' +
        '<span class="folder-name">' + escapeHtml(item.name) +
        '<span class="folder-arrow">' + (collapsed ? '▶' : '▼') + '</span></span></li>';
      if (item.children && item.children.length > 0) {
        html += '<ul class="folder-children" data-parent="' + folderId + '" style="display:' +
          (collapsed ? 'none' : 'block') + '">' +
          item.children.map((child) => renderSidebarItem(child, depth + 1)).join('') +
          '</ul>';
      }
      return html;
    }

    // 用真实锚点承载路由：点击只改 hash，文档加载统一由 hashchange 触发
    const indent = depth > 0 ? ' style="padding-left:' + (depth * 20) + 'px"' : '';
    return '<li class="sub-item"' + indent + '>' + docLink(item) + '</li>';
  }

  // 目录树里的文档链接（不做高亮；搜索结果用 hitLink）
  function docLink(item) {
    return '<a href="#' + escapeAttr(encodeURIComponent(item.path)) +
      '" data-path="' + escapeAttr(item.path) + '">' + escapeHtml(item.title) + '</a>';
  }

  function attachFolderListeners() {
    sidebarList.querySelectorAll('.folder').forEach((folder) => {
      folder.addEventListener('click', () => {
        const children = sidebarList.querySelector('.folder-children[data-parent="' + folder.dataset.folderId + '"]');
        if (!children) return;
        const isCollapsed = children.style.display === 'none';
        children.style.display = isCollapsed ? 'block' : 'none';
        folder.querySelector('.folder-arrow').textContent = isCollapsed ? '▼' : '▶';
      });
    });
  }

  // 悬停预取：事件委托，避免为每个条目绑定监听
  sidebarList.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a[data-path]');
    if (link) prefetchDoc(link.dataset.path);
  });

  // 点击委托：记住搜索结果携带的关键词；另外 hash 相同的链接不会派发 hashchange，这里补一次
  document.addEventListener('click', (e) => {
    const link = e.target && e.target.closest ? e.target.closest('a[data-path]') : null;
    if (!link) return;

    if (link.dataset.searchHit) pendingKeyword = link.dataset.searchHit;

    if (location.hash.slice(1) !== encodeURIComponent(link.dataset.path)) return;
    e.preventDefault();
    window.loadDoc(link.dataset.path);
  });

  /* ---------------------------------------------------------------- 搜索 */

  const SNIPPET_BEFORE = 40;
  const SNIPPET_AFTER = 90;
  const JUMP_OFFSET = 120;
  const SEARCH_SLICE_MS = 12;    // 每个扫描时间片的预算
  const OCCUR_CAP = 200;         // 单篇命中计数上限

  let searchTimeout = null;
  let searchPrep = null;         // 预处理后的扫描结构 [{path,title,titleLower,pathLower,lower,text}]
  let searchPrepTask = null;
  let searchSeq = 0;
  let pendingKeyword = '';       // 点搜索结果时记下关键词，文档打开后定位用
  let currentPath = null;        // 当前展示的文档，阅读位置记忆按它记账

  // 正文纯文本索引：构建期由 sync.py 生成。真懒加载——首屏不发请求，第一次搜索才拉取
  function ensureSearchIndex() {
    if (searchPrep) return Promise.resolve();
    if (!searchPrepTask) {
      searchPrepTask = fetch('search-index.json', { cache: 'no-cache' })
        .then((r) => {
          if (!r.ok) throw new Error('search-index.json ' + r.status);
          return r.json();
        })
        .then((data) => {
          searchPrep = [];
          // 预处理一次：小写副本存下来，之后所有查询都不再为每篇分配整篇副本。
          // 大库时分片进行，不阻塞输入
          return runSliced(data, (doc) => {
            const text = doc.text || '';
            searchPrep.push({
              path: doc.path,
              title: doc.title,
              titleLower: doc.title.toLowerCase(),
              pathLower: doc.path.toLowerCase(),
              lower: text.toLowerCase(),
              text,
            });
          }, SEARCH_SLICE_MS);
        })
        .catch((err) => {
          searchPrepTask = null;   // 失败不缓存，下次可重试
          throw err;
        });
    }
    return searchPrepTask;
  }

  // 时间分片执行：每个时间片预算 SEARCH_SLICE_MS 毫秒，片间让出主线程。
  // shouldAbort 返回 true 时提前终止（用于取消过期查询）
  function runSliced(items, step, budgetMs, shouldAbort) {
    return new Promise((resolve) => {
      let i = 0;
      (function chunk() {
        if (shouldAbort && shouldAbort()) return resolve();
        const deadline = performance.now() + budgetMs;
        while (i < items.length && performance.now() < deadline) {
          step(items[i], i);
          i += 1;
        }
        if (i < items.length) setTimeout(chunk, 0);
        else resolve();
      })();
    });
  }

  // 命中计数：indexOf 循环（不产生中间数组），单篇封顶 OCCUR_CAP 次截断极端长文
  function countOccurrences(lowerText, lower) {
    let count = 0;
    let at = lowerText.indexOf(lower);
    while (at !== -1) {
      count += 1;
      if (count >= OCCUR_CAP) break;
      at = lowerText.indexOf(lower, at + lower.length);
    }
    return count;
  }

  function makeSnippet(text, index, length) {
    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + length + SNIPPET_AFTER);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  // 全文索引未就绪时的即时命中：只按标题与路径
  function quickHits(keyword) {
    const lower = keyword.toLowerCase();
    return allDocs
      .filter((doc) => doc.title.toLowerCase().includes(lower) || doc.path.toLowerCase().includes(lower))
      .map((doc) => ({ path: doc.path, title: doc.title, occurrences: 0, hitInTitle: true, snippet: '' }));
  }

  // 侧栏结果条目：标题 + 命中片段 + 路径/命中次数
  function hitLink(hit, keyword) {
    const meta = hit.snippet
      ? ''
      : '<span class="search-path">' + highlightMatch(hit.path, keyword) + '</span>';
    const count = hit.occurrences > 1
      ? '<span class="search-count">命中 ' + hit.occurrences + ' 次</span>'
      : '';

    return '<a href="#' + escapeAttr(encodeURIComponent(hit.path)) +
      '" data-path="' + escapeAttr(hit.path) +
      '" data-search-hit="' + escapeAttr(keyword) + '">' +
      '<span class="search-title">' + highlightMatch(hit.title, keyword) + '</span>' +
      (hit.snippet ? '<span class="search-snippet">' + highlightMatch(hit.snippet, keyword) + '</span>' : '') +
      (meta || count ? '<span class="search-meta">' + meta + count + '</span>' : '') +
      '</a>';
  }

  function renderSearchResults(hits, keyword) {
    if (hits.length === 0) {
      sidebarList.innerHTML = '<li>未找到匹配的文档</li>';
      return;
    }
    sidebarList.innerHTML = '<li class="folder">搜索结果（' + hits.length + '）</li>' +
      hits.map((hit) => '<li class="sub-item">' + hitLink(hit, keyword) + '</li>').join('');
  }

  // 首篇文档渲染完成后在空闲时机预取全文索引：不抢首屏带宽，又基本保证
  // 用户搜索时索引已就绪。若用户在此之前就开始搜索，handleSearch 会按需拉取（同一任务）
  let indexPrefetchScheduled = false;

  function scheduleSearchIndexPrefetch() {
    if (indexPrefetchScheduled) return;
    indexPrefetchScheduled = true;
    const kick = () => ensureSearchIndex().catch((err) => log('[Search] 全文索引预取失败:', err.message));
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(kick, { timeout: 3000 });
    } else {
      setTimeout(kick, 1500);
    }
  }

  function handleSearch(query) {
    const keyword = query.trim();
    clearDocHighlight();   // 关键词变了，正文里上一次的标记先撤掉

    if (!keyword) {
      // 直接复用已加载的索引，不再重新请求 index.json
      if (indexTree) renderSidebar(indexTree);
      return;
    }

    // 立刻给出标题/路径的即时命中；全文索引加载与扫描都在后台分片进行
    renderSearchResults(quickHits(keyword), keyword);
    const seq = ++searchSeq;
    ensureSearchIndex()
      .then(() => scanFullText(keyword, seq))
      .catch((err) => log('[Search] 全文索引不可用:', err.message));
  }

  // 分片全文扫描：标题/路径命中优先，其次按出现次数；scanFullText 结束后统一渲染
  function scanFullText(keyword, seq) {
    const lower = keyword.toLowerCase();
    const hits = [];

    return runSliced(searchPrep, (doc) => {
      const occurrences = countOccurrences(doc.lower, lower);
      const hitInTitle = doc.titleLower.includes(lower) || doc.pathLower.includes(lower);
      if (!occurrences && !hitInTitle) return;

      let snippet = '';
      if (occurrences) {
        const at = doc.lower.indexOf(lower);
        snippet = makeSnippet(doc.text, at, keyword.length);
      }
      hits.push({ path: doc.path, title: doc.title, occurrences, hitInTitle, snippet });
    }, SEARCH_SLICE_MS, () => seq !== searchSeq).then(() => {
      if (seq !== searchSeq) return;
      hits.sort((a, b) =>
        (Number(b.hitInTitle) - Number(a.hitInTitle)) ||
        (b.occurrences - a.occurrences) ||
        a.path.localeCompare(b.path));
      renderSearchResults(hits, keyword);
    });
  }

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(e.target.value), 200);
  });

  // Enter 打开第一条命中；Esc 清空
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.value = '';
      clearTimeout(searchTimeout);
      handleSearch('');
      return;
    }
    if (e.key !== 'Enter') return;
    const first = sidebarList.querySelector('a[data-search-hit]');
    if (!first) return;
    e.preventDefault();
    clearTimeout(searchTimeout);
    pendingKeyword = first.dataset.searchHit;
    window.loadDoc(first.dataset.path);
  });

  /* ------------------------------------------------- 正文内命中定位与高亮 */

  const XHTML_NS = 'http://www.w3.org/1999/xhtml';

  function collectTextNodes(keyword) {
    const lower = keyword.toLowerCase();
    const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // 只处理 HTML 文本节点：包进 SVG 的 <mark> 不会被渲染，会把图表文字吃掉
        if (parent.namespaceURI && parent.namespaceURI !== XHTML_NS) return NodeFilter.FILTER_REJECT;
        const tag = parent.nodeName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'mark') return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLowerCase().includes(lower)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  // 把正文里的命中片段包进 <mark>，并滚到第一处；返回是否命中
  function jumpToKeyword(keyword) {
    if (!keyword) return false;
    const lower = keyword.toLowerCase();
    let first = null;

    collectTextNodes(keyword).forEach((textNode) => {
      const text = textNode.nodeValue;
      const lowerText = text.toLowerCase();
      const fragment = document.createDocumentFragment();
      let last = 0;
      let at = lowerText.indexOf(lower);

      while (at !== -1) {
        if (at > last) fragment.appendChild(document.createTextNode(text.slice(last, at)));
        const mark = document.createElement('mark');
        mark.className = first ? 'doc-hit' : 'doc-hit doc-hit-first';
        mark.textContent = text.slice(at, at + keyword.length);
        if (!first) first = mark;
        fragment.appendChild(mark);
        last = at + keyword.length;
        at = lowerText.indexOf(lower, last);
      }

      if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(fragment, textNode);
    });

    if (!first) return false;

    const top = first.getBoundingClientRect().top + window.scrollY - JUMP_OFFSET;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return true;
  }

  // 撤掉正文里的命中标记，恢复到高亮之前（不动滚动位置、不重新渲染）
  function clearDocHighlight() {
    const marks = viewer.querySelectorAll('mark.doc-hit');
    if (!marks.length) return;
    marks.forEach((mark) => {
      mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark);
    });
    viewer.normalize();
  }

  /* ---------------------------------------------------------------- 主题 */

  function setTheme(dark, persist) {
    document.body.classList.toggle('dark', dark);
    if (persist !== false) localStorage.setItem('theme', dark ? 'dark' : 'light');

    const icon = dark ? ICON_MOON : ICON_SUN;
    [themeToggle, themeToggleCollapsed].forEach((btn) => {
      const svg = btn && btn.querySelector('svg');
      if (svg) svg.innerHTML = icon;
    });

    if (hljsLightTheme && hljsDarkTheme) {
      hljsLightTheme.disabled = dark;
      hljsDarkTheme.disabled = !dark;
    }

    rerenderMermaid();
  }

  function toggleTheme() {
    setTheme(!document.body.classList.contains('dark'));
  }

  themeToggle.addEventListener('click', toggleTheme);
  themeToggleCollapsed.addEventListener('click', toggleTheme);

  /* ------------------------------------------------------------ 侧边栏开合 */

  function setSidebarCollapsed(collapsed, persist) {
    if (isMobile()) return;   // 移动端开合走 mobile-open，collapsed 只属于桌面，两态不得混写
    sidebar.classList.toggle('collapsed', collapsed);
    const arrow = sidebarToggle.querySelector('svg path');
    if (arrow) arrow.setAttribute('d', collapsed ? ARROW_COLLAPSED : ARROW_EXPANDED);
    sidebarToggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
    if (persist !== false) localStorage.setItem('sidebarCollapsed', collapsed);
  }

  sidebarToggle.addEventListener('click', () => {
    if (isMobile()) { closeMobileSidebar(); return; }   // 移动端 footer 的「收起」就是关抽屉，避免遮罩残留
    setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
  });

  sidebarToggleCollapsed.addEventListener('click', () => {
    setSidebarCollapsed(false);
  });

  // 收起态的搜索按钮：展开侧边栏并聚焦输入框，一步到位
  searchToggleCollapsed.addEventListener('click', () => {
    setSidebarCollapsed(false);
    searchInput.focus();
  });

  /* ------------------------------------------------------------ 移动端适配 */

  // 断点唯一真相：与 CSS 的 @media (max-width: 768px) 保持同一表达式。
  // 不用 window.screen：折叠屏展开态 / 分屏 / 旋转场景下它与视口宽度不一致
  const mobileQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 768px)')
    : { matches: false };

  function isMobile() {
    return mobileQuery.matches;
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-open');
  }

  function toggleMobileSidebar() {
    if (!isMobile()) return;
    if (sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
      return;
    }
    sidebar.classList.add('mobile-open');
    sidebar.classList.remove('collapsed');   // 桌面遗留的记忆态会压过 mobile-open 的 transform，打开前必须清掉
    document.body.classList.add('sidebar-open');
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileSidebar();
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  window.addEventListener('resize', () => {
    if (!isMobile()) closeMobileSidebar();
  });

  /* ------------------------------------------- 滚动相关（合并为单个监听） */

  let lastScrollY = window.scrollY;
  let ticking = false;
  let menuTimer = null;

  function updateScrollUI() {
    const y = window.scrollY;

    backToTop.classList.toggle('visible', y > 200);

    const max = document.documentElement.scrollHeight - window.innerHeight;
    readingProgress.style.transform = 'scaleX(' + (max > 0 ? Math.min(y / max, 1) : 0) + ')';

    if (isMobile() && mobileMenuBtn) {
      mobileMenuBtn.classList.toggle('hidden', y > lastScrollY && y > 100);
    }

    rememberPosition(currentPath, y);   // 顺手记录阅读位置（内部有节流写入）
    lastScrollY = y;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(() => {
        updateScrollUI();
        ticking = false;
      });
    }

    // 停止滚动 1s 后恢复菜单按钮
    if (isMobile() && mobileMenuBtn) {
      clearTimeout(menuTimer);
      menuTimer = setTimeout(() => mobileMenuBtn.classList.remove('hidden'), 1000);
    }
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* -------------------------------------------------------- 内容渲染与增强 */

  const copyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      copyObserver.unobserve(entry.target);
      addCopyButton(entry.target);
    });
  }, { rootMargin: '200px', threshold: 0 });

  function addCopyButton(block) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => {
      const code = block.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText || code.textContent).then(() => {
        copyBtn.textContent = '已复制';
        setTimeout(() => {
          copyBtn.textContent = '复制';
        }, 2000);
      });
    });
    block.appendChild(copyBtn);
  }

  function enhanceCodeBlocks() {
    // 1. Mermaid：把代码块替换为图表容器，源码留在 data-mermaid-source 上供换主题时重渲染
    document.querySelectorAll('.content pre code.language-mermaid').forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      const container = document.createElement('div');
      container.className = 'mermaid-container';
      container.dataset.mermaidSource = codeBlock.textContent;
      pre.parentNode.replaceChild(container, pre);
      renderMermaidInto(container, container.dataset.mermaidSource);
    });

    // 2. 代码高亮（预渲染的 HTML 可能已带 hljs 样式，跳过）
    document.querySelectorAll('.content pre code').forEach((block) => {
      const pre = block.parentElement;
      if (pre.classList.contains('hljs')) return;
      pre.classList.add('hljs');
      if (window.hljs) hljs.highlightElement(block);
    });

    // 3. 复制按钮沿用单个观察器，切换文档时先断开再观察，避免旧观察器累积
    copyObserver.disconnect();
    document.querySelectorAll('.content pre').forEach((block) => copyObserver.observe(block));
  }

  function applyContent(html, path) {
    // 换文档之前，先把上一篇读到哪儿记下来
    rememberPosition(currentPath, window.scrollY);

    viewer.innerHTML = html;

    // 已编码的 hash 与目标一致时不再回写，避免触发多余的 hashchange / 重复渲染
    const target = encodeURIComponent(path);
    const current = location.hash.slice(1);
    let same = current === target;
    if (!same) {
      try {
        same = decodeURIComponent(current) === path;
      } catch (e) {
        same = false;
      }
    }
    if (!same) location.hash = target;

    if (isMobile()) {
      setTimeout(closeMobileSidebar, 50);
    }

    enhanceCodeBlocks();
    currentPath = path;
    scheduleSearchIndexPrefetch();   // 第一篇文章出来后再开始下载全文索引

    // 命中跳转优先；其次回到这篇上次读到的位置；都没有才回到顶部
    const keyword = pendingKeyword;
    pendingKeyword = '';
    if (keyword && jumpToKeyword(keyword)) return;
    if (restorePosition(path)) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.loadDoc = function (path) {
    if (!path) return;
    resolveDoc(path)
      .then((html) => applyContent(html, path))
      .catch((err) => {
        // 直接透出真实原因：取文档失败是「文件不存在」，渲染/增强失败则是别的错，
        // 一律写成「文件不存在」会把问题指向错误的方向
        log('[App] ' + err.message);
        viewer.innerHTML = '<p>' + escapeHtml(err.message) + '</p>';
      });
  };

  window.prefetchDoc = prefetchDoc;
  window.__sanitizeDocHtml = sanitizeDocHtml;   // 供真浏览器自检验证过滤行为

  /* ---------------------------------------------------------------- 路由 */

  function handleHash() {
    let path = location.hash.slice(1);
    if (path) {
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        log('[Hash] 无法解码:', path);
      }
      window.loadDoc(path);
      return;
    }
    if (config && config.home_page) {
      window.loadDoc(config.home_page);
    }
  }

  window.addEventListener('hashchange', handleHash);

  /* ---------------------------------------------------------------- 启动 */

  function initTheme() {
    // 立刻应用，先于任何渲染，避免主题闪烁（head 中的引导脚本作为兜底）
    setTheme(localStorage.getItem('theme') === 'dark', false);
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      setSidebarCollapsed(true, false);
    }
  }

  initTheme();
  initMermaid();
  updateScrollUI();

  // 配置与索引是两个独立请求，并行发出，去掉串行等待
  Promise.all([loadConfig(), loadIndex()]).then(handleHash);

  // 全文索引不在启动时加载：首篇文档加载完成后空闲预取（见 scheduleSearchIndexPrefetch），
  // 用户更早搜索则按需拉取，首屏零额外请求
})();
