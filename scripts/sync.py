#!/usr/bin/env python3
"""
TXT/MD/DOCX 文件同步脚本

流程：清理陈旧产物 -> 复制源文件 -> 生成索引
- TXT / MD：原样复制到 reader/docs，Markdown 解析统一交给前端 markdown-it
  （构建期不再保留第二套 Markdown 渲染器，避免同一份内容出现两套排版结果）
- DOCX：构建期用 mammoth 转为 HTML
"""

import os
import re
import json
import shutil
from html import unescape as unescape_html
from pathlib import Path
from datetime import datetime
from fnmatch import fnmatch

LOG_MODULE = 'Sync'

# 需要跳过的目录名（前缀匹配）
SKIP_NAMES = ('.git', '__pycache__', 'node_modules', '.github', 'reader', 'scripts')

# 原样复制、由前端渲染的扩展名
COPY_EXTENSIONS = ('.txt', '.md')
# 构建期必须转换的扩展名
CONVERT_EXTENSIONS = ('.docx',)
# docs 目录中允许被清理的产物扩展名
OUTPUT_EXTENSIONS = ('.txt', '.md', '.html')

# 行首的 HTML 标签
HTML_TAG_RE = re.compile(r'^</?[A-Za-z][A-Za-z0-9-]*[\s/>]')
# 代码围栏（``` 或 ~~~）
FENCE_RE = re.compile(r'^\s*(```|~~~)')

# 单一根目录来源：CI 可用 SYNC_ROOT_DIR 覆盖，其余情况取脚本所在仓库根
ROOT = Path(os.environ.get('SYNC_ROOT_DIR') or Path(__file__).resolve().parent.parent)
CONFIG_FILE = ROOT / 'reader' / 'config.json'
DOCS_DIR = ROOT / 'reader' / 'docs'
INDEX_FILE = ROOT / 'reader' / 'index.json'
SEARCH_INDEX_FILE = ROOT / 'reader' / 'search-index.json'


def log_info(msg, module=LOG_MODULE):
    print(f'[{module}][{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] {msg}')


def log_error(msg, module=LOG_MODULE):
    print(f'[{module}][{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] [ERROR] {msg}')


def log_warn(msg, module=LOG_MODULE):
    print(f'[{module}][{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}] [WARN] {msg}')


# --------------------------------------------------------------------- 配置

_config = None


def load_config():
    """读取并缓存 config.json"""
    global _config
    if _config is not None:
        return _config

    if not CONFIG_FILE.exists():
        log_error(f'配置文件不存在: {CONFIG_FILE}')
        _config = {}
        return _config

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            _config = json.load(f)
        log_info(f'配置文件加载成功: {CONFIG_FILE}')
    except (json.JSONDecodeError, IOError) as e:
        log_error(f'配置文件加载错误: {e}')
        _config = {}
    return _config


# --------------------------------------------------------------- 路径与过滤

def output_rel_path(rel_path):
    """源文件相对路径 -> 产物相对路径（DOCX 转 HTML，其余原样），索引与清理共用"""
    if rel_path.suffix.lower() in CONVERT_EXTENSIONS:
        return rel_path.with_suffix('.html')
    return rel_path


def file_title(path):
    """文件名 -> 侧边栏/搜索结果显示的标题"""
    return path.stem.replace('-', ' ').replace('_', ' ')


def is_source(path):
    """是否为可处理的源文件（缺少 mammoth 时 DOCX 视为不支持，避免索引里出现死链）"""
    ext = path.suffix.lower()
    if ext in COPY_EXTENSIONS:
        return True
    return ext in CONVERT_EXTENSIONS and docx_supported()


def match_patterns(rel_path, patterns):
    """排除模式匹配：可匹配目录名，也可匹配完整相对路径"""
    dirs = rel_path.parts[:-1]
    rel_str = rel_path.as_posix()
    for pattern in patterns:
        if fnmatch(rel_str, pattern) or any(fnmatch(d, pattern) for d in dirs):
            return True
    return False


def should_exclude(path, source_dir, patterns, exclude_files):
    rel_path = path.relative_to(source_dir)
    if not is_source(path):
        return True
    if rel_path.name in exclude_files:
        return True
    return match_patterns(rel_path, patterns)


def natural_key(text):
    """把名称切成「数字段 / 文本段」序列，供排序使用

    数字段按数值比较（01 < 02 < 10），文本段不区分大小写。
    每段都包成 (是否文本, 数值, 文本) 三元组，避免比较时把 int 和 str 放在一起。
    """
    return [(1, 0, t.lower()) if not t.isdigit() else (0, int(t), '')
            for t in re.split(r'(\d+)', text)]


def source_files(source_dir):
    """源目录下所有可处理文件；跳过 SKIP_NAMES 目录（与扫描保持一致）"""
    files = []
    for path in source_dir.rglob('*'):
        if not path.is_file():
            continue
        if any(part.startswith(SKIP_NAMES) for part in path.relative_to(source_dir).parts[:-1]):
            continue
        files.append(path)
    return sorted(files, key=lambda p: natural_key(p.relative_to(source_dir).as_posix()))


# --------------------------------------------------------------------- 转换

_mammoth = None  # None=未探测, False=不可用, 否则为 mammoth 模块


def _mammoth_module():
    global _mammoth
    if _mammoth is None:
        try:
            import mammoth
            _mammoth = mammoth
        except ImportError:
            _mammoth = False
    return _mammoth


def docx_supported():
    return _mammoth_module() is not False


# DOCX 样式映射：mammoth 默认表只覆盖标题/列表/表格，代码与引用需要自己补。
# 每类各给「样式名」与「样式 ID」两套规则：真实 Word 文档按名字匹配，
# 而 styles.xml 里没有风格定义的精简文档（例如 officecli 生成的）只能靠 ID 匹配。
DOCX_STYLE_MAP = '\n'.join([
    "p[style-name='Source Code'] => pre:separator('\\n')",
    "p[style-name='Code'] => pre:separator('\\n')",
    "p[style-name='Preformatted Text'] => pre:separator('\\n')",
    "p.Code => pre:separator('\\n')",
    "p.SourceCode => pre:separator('\\n')",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote:fresh",
    "p.Quote => blockquote:fresh",
    "p.IntenseQuote => blockquote:fresh",
    "r[style-name='Code Char'] => code",
    "r[style-name='Source Code Char'] => code",
    "r.CodeChar => code",
])


def convert_docx(docx_path):
    """DOCX -> HTML（mammoth），补样式类并追加 mammoth 的提示"""
    mammoth = _mammoth_module()
    if mammoth is False:
        raise ImportError('请安装 mammoth 库: pip install mammoth')
    try:
        with open(docx_path, 'rb') as f:
            result = mammoth.convert_to_html(f, style_map=DOCX_STYLE_MAP)
    except Exception as e:
        log_error(f'Word 文档转换失败: {docx_path} - {e}', 'Sync-DOCX')
        raise

    for message in result.messages[:LINT_LIMIT]:
        log_warn(f'{docx_path.name} [{message.type}] {message.message}', 'Sync-DOCX')
    if len(result.messages) > LINT_LIMIT:
        log_warn(f'{docx_path.name} 另有 {len(result.messages) - LINT_LIMIT} 条提示未列出', 'Sync-DOCX')

    return result.value.replace('<table>', '<table class="docx-table">').replace('<img', '<img class="docx-image"')


# --------------------------------------------------------------------- 扫描

def scan_directory(directory, source_dir, patterns, exclude_files):
    """递归扫描生成目录树（folder/file）

    排序：只按名称（数字段按数值），目录与文件同级混排。
    刻意不做「目录优先」—— 文件名里的序号前缀已经表达了顺序。
    """
    items = []
    for path in sorted(directory.iterdir(), key=lambda p: natural_key(p.name)):
        if any(path.name.startswith(s) for s in SKIP_NAMES):
            continue

        if path.is_dir():
            children = scan_directory(path, source_dir, patterns, exclude_files)
            if children:
                items.append({'type': 'folder', 'name': path.name, 'children': children})
            continue

        rel_path = path.relative_to(source_dir)
        if should_exclude(path, source_dir, patterns, exclude_files):
            if path.suffix.lower() in COPY_EXTENSIONS + CONVERT_EXTENSIONS:
                log_info(f'排除: {rel_path}', 'Sync-Scan')
            continue

        items.append({
            'type': 'file',
            'name': path.name,
            'path': output_rel_path(rel_path).as_posix(),
            'title': file_title(path),
        })
    return items


# ----------------------------------------------------------------- 复制/清理

def sync_files(source_dir, dest_dir, patterns, exclude_files):
    """按扩展名选择复制或转换，单个循环覆盖全部类型"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    stats = {'复制': 0, '转换': 0, '跳过': 0, '失败': 0}

    for path in source_files(source_dir):
        if should_exclude(path, source_dir, patterns, exclude_files):
            continue

        rel_path = path.relative_to(source_dir)
        dest_path = dest_dir / output_rel_path(rel_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        if dest_path.exists() and dest_path.stat().st_mtime >= path.stat().st_mtime:
            stats['跳过'] += 1
            continue

        try:
            if rel_path.suffix.lower() in CONVERT_EXTENSIONS:
                dest_path.write_text(convert_docx(path), encoding='utf-8')
                action = '转换'
            else:
                shutil.copy2(path, dest_path)
                action = '复制'
            log_info(f'{action}: {rel_path} -> {dest_path.relative_to(dest_dir)}', 'Sync-File')
            stats[action] += 1
        except Exception as e:
            if dest_path.exists():
                dest_path.unlink()
            log_error(f'{rel_path} 处理失败: {e}', 'Sync-File')
            stats['失败'] += 1

    log_info('文件处理完成: ' + ', '.join(f'{k}={v}' for k, v in stats.items()), 'Sync-Core')


def cleanup_orphaned_files(source_dir, dest_dir, patterns, exclude_files):
    """删除源目录已不存在的产物，再清掉空目录"""
    if not dest_dir.exists():
        return

    expected = {
        output_rel_path(path.relative_to(source_dir)).as_posix()
        for path in source_files(source_dir)
        if not should_exclude(path, source_dir, patterns, exclude_files)
    }

    deleted = 0
    for path in dest_dir.rglob('*'):
        rel_str = path.relative_to(dest_dir).as_posix()
        if not path.is_file() or path.suffix.lower() not in OUTPUT_EXTENSIONS:
            continue
        if rel_str in expected:
            continue
        try:
            path.unlink()
            log_info(f'删除: {rel_str}', 'Sync-Cleanup')
            deleted += 1
        except OSError as e:
            log_error(f'删除文件失败: {rel_str} - {e}', 'Sync-Cleanup')

    for path in sorted(dest_dir.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            try:
                path.rmdir()
                log_info(f'删除空目录: {path.relative_to(dest_dir)}', 'Sync-Cleanup')
            except OSError:
                pass

    if deleted:
        log_info(f'清理完成，共删除 {deleted} 个文件', 'Sync-Cleanup')


# ------------------------------------------------------------------ 搜索索引

def strip_tags(markup):
    """从 DOCX 转出的 HTML 里取出纯文本"""
    text = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', ' ', markup, flags=re.S | re.I)
    return unescape_html(re.sub(r'<[^>]+>', ' ', text))


def normalize_text(text):
    """压掉 Markdown 记号与多余空白，得到适合做摘要的纯文本

    只用于搜索索引，不产出 HTML —— 与「渲染」是两件事。
    """
    kept = []
    for line in text.splitlines():
        stripped = line.strip()
        if FENCE_RE.match(stripped):
            continue
        kept.append(re.sub(r'^#{1,6}\s*', '', stripped))

    text = ' '.join(kept)
    text = re.sub(r'!\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'`([^`]*)`', r'\1', text)
    return re.sub(r'\s+', ' ', text).strip()


def build_search_index(source_dir, dest_dir, patterns, exclude_files):
    """生成 search-index.json：[{path, title, text}]，正文纯文本供前端全文检索"""
    entries = []
    for path in source_files(source_dir):
        if should_exclude(path, source_dir, patterns, exclude_files):
            continue

        rel_path = path.relative_to(source_dir)
        out_rel = output_rel_path(rel_path)

        if rel_path.suffix.lower() in CONVERT_EXTENSIONS:
            out_file = dest_dir / out_rel
            if not out_file.exists():
                continue
            text = strip_tags(out_file.read_text(encoding='utf-8', errors='replace'))
        else:
            try:
                text = path.read_text(encoding='utf-8', errors='replace')
            except OSError as e:
                log_error(f'读取失败，搜索索引跳过该文件: {rel_path} - {e}', 'Sync-Search')
                continue

        entries.append({
            'path': out_rel.as_posix(),
            'title': file_title(path),
            'text': normalize_text(text),
        })

    try:
        with open(SEARCH_INDEX_FILE, 'w', encoding='utf-8') as f:
            json.dump(entries, f, ensure_ascii=False, separators=(',', ':'))
        size_kb = SEARCH_INDEX_FILE.stat().st_size / 1024
        log_info(f'生成搜索索引: {SEARCH_INDEX_FILE.name}（{len(entries)} 篇，{size_kb:.1f} KB）', 'Sync-Search')
    except Exception as e:
        log_error(f'生成搜索索引失败: {e}', 'Sync-Search')


def generate_index(items, output_file):
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        log_info(f'生成索引: {output_file}', 'Sync-Index')
    except Exception as e:
        log_error(f'生成索引失败: {e}', 'Sync-Index')


# ------------------------------------------------------------------ 内容检查

# 只有交给前端 markdown-it 渲染的正文才需要检查（DOCX 走 mammoth，不经过 html:true）
LINT_EXTENSIONS = COPY_EXTENSIONS
LINT_LIMIT = 10


def find_raw_html(path):
    """找出围栏之外、行首的裸 HTML 标签，返回 [(行号, 行内容)]

    前端以 html: true 解析，围栏外的裸标签会被原样插入 DOM，与页面自身结构撞车
    （例如正文里出现 <aside class="sidebar"> 会夺走整页布局）。
    """
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError as e:
        log_error(f'读取失败，跳过检查: {path} - {e}', 'Sync-Lint')
        return []

    findings = []
    in_fence = False
    for lineno, line in enumerate(text.splitlines(), 1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence and HTML_TAG_RE.match(line.strip()):
            findings.append((lineno, line.strip()))
    return findings


def lint_sources(source_dir, patterns, exclude_files):
    """构建期内容检查：正文裸 HTML 会让页面结构被正文劫持"""
    findings = []
    for path in source_files(source_dir):
        if path.suffix.lower() not in LINT_EXTENSIONS:
            continue
        if should_exclude(path, source_dir, patterns, exclude_files):
            continue
        findings.extend((path, lineno, line) for lineno, line in find_raw_html(path))

    if not findings:
        log_info('正文 HTML 检查通过', 'Sync-Lint')
        return

    log_warn(f'发现 {len(findings)} 处正文裸 HTML（前端会原样插入，可能破坏页面结构）', 'Sync-Lint')
    for path, lineno, line in findings[:LINT_LIMIT]:
        log_warn(f'  {path.relative_to(source_dir)}:{lineno}: {line[:60]}', 'Sync-Lint')
    if len(findings) > LINT_LIMIT:
        log_warn(f'  ...另有 {len(findings) - LINT_LIMIT} 处未列出', 'Sync-Lint')


def main():
    config = load_config()
    source_dir_name = config.get('source_dir', '')
    patterns = config.get('exclude_patterns') or []
    exclude_files = config.get('exclude_files') or []
    source_dir = ROOT / source_dir_name

    log_info('=' * 60)
    log_info('开始同步')
    log_info(f'源目录: /{source_dir_name}/')
    log_info(f'目标目录: {DOCS_DIR}')
    log_info(f'索引文件: {INDEX_FILE}')
    log_info(f'GitHub 仓库: {config.get("github_repo", "")}')
    log_info(f'排除规则: 目录模式={patterns or "无"}, 文件={exclude_files or "无"}')

    if not source_dir.is_dir():
        log_error(f'源目录不存在: /{source_dir_name}/')
        return

    # 缺少 mammoth 时才提示，且只在确实存在 DOCX 时提示，避免无谓报错
    docx_count = sum(1 for p in source_dir.rglob('*')
                     if p.is_file() and p.suffix.lower() in CONVERT_EXTENSIONS)
    if docx_count and not docx_supported():
        log_error(f'发现 {docx_count} 个 DOCX 但缺少 mammoth 库，本次将跳过（pip install mammoth）', 'Sync-DOCX')

    log_info('检查正文 HTML 用法...')
    lint_sources(source_dir, patterns, exclude_files)

    log_info('清理已删除的文件...')
    cleanup_orphaned_files(source_dir, DOCS_DIR, patterns, exclude_files)

    log_info('扫描目录结构...')
    # 索引就是源目录下的条目列表，不再外裹一层与 source_dir 同名的目录：
    # 侧边栏本来就只展示该目录的内容，包一层会把整棵树折叠进一个多余节点
    items = scan_directory(source_dir, source_dir, patterns, exclude_files)
    log_info(f'扫描完成，共 {len(items)} 个项目')

    log_info('复制和转换文件...')
    sync_files(source_dir, DOCS_DIR, patterns, exclude_files)

    log_info('生成索引文件...')
    generate_index(items, INDEX_FILE)

    log_info('生成搜索索引...')
    build_search_index(source_dir, DOCS_DIR, patterns, exclude_files)

    log_info('同步完成！')
    log_info('=' * 60)


if __name__ == '__main__':
    main()
