# 轻量级文档阅读器 front-text

一个简洁高效的文档展示工具，为多种场景设计。可以是数字图书馆，也可以是个人博客……

## 功能特性

- **多格式支持**：支持 TXT 纯文本， Word 文档和 Markdown 文档自动渲染
- **智能目录**：树形结构展示，支持无限层级嵌套
- **全文搜索**：正文/标题/路径一起匹配，侧栏给出命中片段，点击定位到正文命中处并高亮
- **暗色模式**：主题偏好自动保存
- **Mermaid 图表**：支持流程图、甘特图、关系图等
- **自动同步**：GitHub Actions 自动部署，保持文档同步
- **性能优化**：懒加载代码块、优化渲染性能、提升滚动流畅度
- **智能格式化**：自动阅读进度条，优化段落间距、行高、列表样式，提升阅读体验
- **阅读进度缓存**： 回到上一篇文章，依然处于之前阅读所在位置

## 渲染管线

| 源格式 | 构建期（`scripts/sync.py`） | 运行期（`reader/app.js`） |
|--------|------------------------------|----------------------------|
| `.txt` | 原样复制到 `reader/docs/` | markdown-it 解析并渲染 |
| `.md` | 原样复制到 `reader/docs/` | markdown-it 解析并渲染 |
| `.docx` | mammoth 转为 HTML 写入 `reader/docs/` | 直接插入，不再二次解析 |

- **调试日志默认关闭**：访问时加 `?debug` 打开。

## 快速开始

### 本地运行

```bash
# 1. 同步文档：生成 reader/docs/、reader/index.json 与 reader/search-index.json
python scripts/sync.py

# 2. 本地预览（站点根 reader/，脚本已内置禁用缓存）
python scripts/serve.py            # http://127.0.0.1:8080/
```



### 添加文档

将文档放入根目录中的 txt 文件夹即可：

```
txt/
├── 01-项目简介.txt
├── 02-安装部署.txt
├── 03-配置指南.txt
└── 04-使用说明.txt
```

## 配置说明

`reader/config.json` 各参数及排除规则（exclude_patterns / exclude_files）详见 [config.md](config.md)。

## 部署

推送到 `main` 后由 `.github/workflows/sync-api.yml` 自动发布到 GitHub Pages，详见 [deploy.md](deploy.md)。

## 文档规范

- 文件名使用 UTF-8 编码
- Markdown 支持标题、列表、代码块、表格
- Mermaid 图表使用 mermaid 代码块
- 文件名建议使用序号前缀排序：`01-xxx.txt`、`02-xxx.txt`

## 校验脚本

`checks/` 下是可重复执行的本地校验：

```bash
python checks/test_sync.py       # 构建侧：排除规则、产物复制、索引、自然排序
node checks/domcheck.mjs         # 前端：DOM 桩加载真实 app.js 的断言
python checks/browser-check.py   # 真浏览器自检（Edge headless）
```



## 开源协议

MIT License
