# 配置说明

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

## 排除配置详解

### exclude_patterns - 目录排除模式

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

### exclude_files - 文件名排除列表

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

### 组合使用示例

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
