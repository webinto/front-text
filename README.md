# 轻量级文档阅读器

一个简洁高效的文档展示工具，为多种场景设计。

## 功能特性

- **多格式支持**：支持 TXT 纯文本， Word 文档和 Markdown 文档自动渲染
- **智能目录**：树形结构展示，支持无限层级嵌套
- **全文搜索**：正文/标题/路径一起匹配，侧栏给出命中片段，点击定位到正文命中处并高亮
- **暗色模式**：主题偏好自动保存
- **Mermaid 图表**：支持流程图、甘特图、关系图等
- **自动同步**：GitHub Actions 自动部署，保持文档同步
- **性能优化**：懒加载代码块、优化渲染性能、提升滚动流畅度
- **智能格式化**：自动阅读进度条，优化段落间距、行高、列表样式，提升阅读体验

## 渲染管线

| 源格式 | 构建期（`scripts/sync.py`） | 运行期（`reader/app.js`） |
|--------|------------------------------|----------------------------|
| `.txt` | 原样复制到 `reader/docs/` | markdown-it 解析并渲染 |
| `.md` | 原样复制到 `reader/docs/` | markdown-it 解析并渲染 |
| `.docx` | mammoth 转为 HTML 写入 `reader/docs/` | 直接插入，不再二次解析 |

- **Markdown 只在运行期解析一次**：构建期不再保留第二套 Markdown 渲染器，因此同一份内容不会出现两种排版结果，`.txt` 与 `.md` 的表现完全一致。
- **全量检索索引**：构建期另生成 `reader/search-index.json`（每篇的正文纯文本，已压掉 Markdown 记号），前端启动后后台加载，搜索时在本地做全文匹配，不额外发请求。
- **DOCX 才需要 mammoth**：仅当源目录存在 `.docx` 时才会用到；构建环境缺少该库时会跳过 DOCX 并明确报错，其余文档照常同步，不会影响构建。
- **DOCX 走 mammoth，并补了样式映射**：Word 的「代码 / Source Code」「引用 / Quote」会被映射成 `<pre>` / `<blockquote>`，表头行映射成 `<th>`；其余交给 mammoth 默认表（标题、列表、表格、加粗/斜体/删除线）。mammoth 的提示（例如引用了未定义的样式）会打进构建日志。
- **调试日志默认关闭**：访问时加 `?debug` 打开（如 `http://localhost:8080/?debug`）。

## 快速开始

### 本地运行

```bash
# 1. 同步文档：生成 reader/docs/、reader/index.json 与 reader/search-index.json
python scripts/sync.py

# 2. 本地预览（站点根是 reader/，脚本已内置禁用缓存）
python scripts/serve.py            # http://127.0.0.1:8080/
```

> 不要直接用 `python -m http.server`：它不发送 `Cache-Control`，浏览器会按 `Last-Modified`
> 做启发式缓存（新鲜期约为文件年龄的 10%），改完 `style.css` / `app.js` 刷新后看到的仍是旧样式，
> 很容易误判成"改动没生效"。`scripts/serve.py` 给所有响应加了 `no-store`。

访问 http://localhost:8080

### 添加文档

将文档放入根目录中的任意文件夹即可：

```
txt/
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
└── 04-使用说明.txt
```

## 配置说明

编辑 `reader/config.json` 自定义网站：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `site_title` | string | `文档阅读器` | 网站标题 |
| `sidebar_title` | string | `文档目录` | 侧边栏标题 |
| `theme` | string | `light` | 主题：`light` 或 `dark` |
| `max_content_width` | number | `900` | 内容区域最大宽度(px) |
| `enable_search` | boolean | `true` | 是否启用搜索功能 |
| `enable_back_to_top` | boolean | `true` | 是否启用返回顶部按钮 |
| `exclude_patterns` | array | `[]` | 排除的目录模式 |
| `exclude_files` | array | `[]` | 排除的文件名列表 |
| `home_page` | string | `""` | 首页文件名(需存在于 txt 目录) |

```json
{
  "source_dir": "txt",
  "site_title": "我的文档",
  "sidebar_title": "文档目录",
  "theme": "light",
  "max_content_width": 900,
  "enable_search": true,
  "enable_back_to_top": true,
  "exclude_patterns": [],
  "exclude_files": [],
  "home_page": "01-项目简介.txt"
}
```

### 排除配置详解

#### exclude_patterns - 目录排除模式

使用通配符排除整个目录及其子目录：

```json
{
  "exclude_patterns": [
    "07-*",        // 排除所有以 "07-" 开头的目录
    "08-*",        // 排除所有以 "08-" 开头的目录
    "测试-*",      // 排除所有以 "测试-" 开头的目录
    "*.bak"        // 排除所有以 ".bak" 结尾的目录
  ]
}
```

**匹配规则：**
- `*` 匹配任意字符（不包括目录分隔符）
- 模式只匹配目录名称，不匹配完整路径
- 支持中文目录名排除

**示例结构：**
```
txt/
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
├── 04-使用说明.txt
├── 05-目录结构.txt
├── 06-常见问题.txt
├── 07-架构设计/     ← 被 "07-*" 排除
│   ├── 01-整体架构.txt
│   ├── 02-模块划分.txt
│   └── 03-技术选型.txt
├── 08-开发规范/     ← 被 "08-*" 排除
│   ├── 01-代码规范.txt
│   ├── 02-命名规范.txt
│   └── 03-注释规范.txt
├── 09-运维手册/
│   ├── 01-部署流程.txt
│   ├── 02-监控告警.txt
│   └── 03-故障排查.txt
└── 10-测试用例/     ← 未被排除，正常显示
    └── 01-单元测试.txt
```

排除后索引结果：
```
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
├── 04-使用说明.txt
├── 05-目录结构.txt
├── 06-常见问题.txt
└── 09-运维手册/
    ├── 01-部署流程.txt
    ├── 02-监控告警.txt
    └── 03-故障排查.txt
```

#### exclude_files - 文件名排除列表

直接指定要排除的文件名（精确匹配）：

```json
{
  "exclude_files": [
    "06-常见问题.txt",    // 排除指定文件
    "临时笔记.txt",       // 排除指定文件
    ".DS_Store",          // 排除系统文件
    "Thumbs.db"           // 排除缩略图文件
  ]
}
```

**匹配规则：**
- 精确匹配文件名（包括扩展名）
- 区分大小写（在 Windows 系统下不区分）
- 无论文件在哪个目录都会被排除

**排除 README.md 示例：**
```
txt/
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
├── README.md              ← 被 exclude_files 排除
├── 07-架构设计/
│   ├── 01-整体架构.txt
│   └── README.md          ← 也会被排除
└── 08-开发规范/
    ├── 01-代码规范.txt
    └── README.md          ← 也会被排除
```

```json
{
  "exclude_files": [
    "README.md",           // 排除所有目录中的 README.md
    "README.en.md"         // 排除所有目录中的英文版 README
  ]
}
```

**示例结构：**
```
txt/
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
├── 04-使用说明.txt
├── 05-目录结构.txt
├── 06-常见问题.txt     ← 被 exclude_files 排除
├── 07-架构设计/
│   └── 01-整体架构.txt
└── 08-开发规范/
    └── 01-代码规范.txt
```

排除后索引结果：
```
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
├── 04-使用说明.txt
├── 05-目录结构.txt
└── 07-架构设计/
    └── 01-整体架构.txt
```

#### 组合使用示例

```json
{
  "exclude_patterns": [
    "07-架构设计",      // 排除整个架构设计目录
    "08-开发规范"       // 排除整个开发规范目录
  ],
  "exclude_files": [
    "06-常见问题.txt",  // 排除常见问题文件
    "草稿.txt"          // 排除草稿文件
  ]
}
```

**注意事项：**
- 排除操作在同步时执行，被排除的文件不会生成 HTML
- 已存在的 HTML 文件会被自动清理
- 修改排除配置后需重新运行 `python scripts/sync.py`

## 部署

### Vercel 部署（推荐）

1. **准备项目**

   确保项目结构如下：

   ```
   ├── scripts/
   │   └── sync.py          # 同步脚本
   ├── txt/                  # 文档源目录
   │   ├── 01-项目简介.txt
   │   └── ...
   ├── reader/
   │   ├── index.html        # 主页面
   │   ├── app.js            # 前端逻辑
   │   ├── css/
   │   │   └── style.css     # 样式文件
   │   ├── index.json        # 文档索引(自动生成)
   │   ├── search-index.json # 全文检索索引(自动生成)
   │   └── config.json       # 配置文件
   ├── README.md
   └── vercel.json           # Vercel 配置文件
   ```

2. **创建 Vercel 配置文件**

   在项目根目录创建 `vercel.json`：

   ```json
   {
     "buildCommand": "python scripts/sync.py",
     "outputDirectory": "reader",
     "routes": [
       { "handle": "filesystem" },
       { "src": "/(.*)", "dest": "/index.html" }
     ]
   }
   ```

   > 若文档中含 `.docx`，构建环境需先安装 mammoth：
   > `"buildCommand": "pip install mammoth && python scripts/sync.py"`

3. **部署到 Vercel**

   ```bash
   # 安装 Vercel CLI
   npm i -g vercel

   # 进入项目目录
   cd your-project

   # 登录并部署
   vercel login
   vercel --prod
   ```

   或通过 Vercel 网站导入 GitHub 仓库自动部署。

4. **自动同步文档**

   创建 GitHub Actions 工作流 `.github/workflows/deploy.yml`：

   ```yaml
   name: Deploy to Vercel

   on:
     push:
       branches: [main]
     workflow_dispatch:

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Setup Python
           uses: actions/setup-python@v5
           with:
             python-version: '3.11'

         - name: Install dependencies
           run: |
             pip install mammoth

         - name: Sync documents
           run: python scripts/sync.py

         - name: Deploy to Vercel
           uses: amondnet/vercel-action@v25
           with:
             vercel-token: ${{ secrets.VERCEL_TOKEN }}
             vercel-org-id: ${{ secrets.ORG_ID }}
             vercel-project-id: ${{ secrets.PROJECT_ID }}
             vercel-args: '--prod'
   ```

   在 Vercel 设置中获取 `VERCEL_TOKEN`、`ORG_ID` 和 `PROJECT_ID`，添加到 GitHub 仓库的 Secrets 中。

   > 本仓库已内置 `.github/workflows/sync-api.yml`（按需下载文档 → 同步 → 发布 GitHub Pages），可直接使用。
   > `reader/docs/` 与 `reader/index.json` 是纯派生产物，已在 `.gitignore` 中忽略、不随仓库分发（部署走 Pages artifact，不依赖仓库副本）。

### GitHub Pages 部署

1. 推送代码到 GitHub 仓库
2. 启用 GitHub Pages（选择 `gh-pages` 分支）
3. 仓库 Settings → Pages → Source 选择 `GitHub Actions`
4. 创建 `.github/workflows/deploy.yml`：

   ```yaml
   name: Deploy to GitHub Pages

   on:
     push:
       branches: [main]

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Setup Python
           uses: actions/setup-python@v5
           with:
             python-version: '3.11'

         - name: Install python-docx
           run: pip install python-docx

         - name: Generate HTML
           run: python scripts/sync.py

         - name: Deploy
           uses: peaceiris/actions-gh-pages@v4
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./reader
   ```

## 文档规范

- 文件名使用 UTF-8 编码
- Markdown 支持标题、列表、代码块、表格
- Mermaid 图表使用 mermaid 代码块
- 文件名建议使用序号前缀排序：`01-xxx.txt`、`02-xxx.txt`



## 开源协议

MIT License
