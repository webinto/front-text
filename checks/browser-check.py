#!/usr/bin/env python3
"""浏览器自检（Edge headless）

把 browser-selftest.html 临时放进 reader/ 供同源访问，用 Edge 无头模式驱动真实页面，
验证「侧栏全量检索命中片段 → 点击定位到正文命中处并高亮 → 清空后复原」。

期望值从 reader/index.json 与 reader/search-index.json 现算，不写死数字。

用法：python checks/browser-check.py [关键词] [图表关键词]
"""

import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
READER = ROOT / 'reader'
CHECKS = Path(__file__).resolve().parent
TEMP_PAGE = READER / '_selftest.html'

EDGE_CANDIDATES = [
    Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
    Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'),
    Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe'),
]

KW = sys.argv[1] if len(sys.argv) > 1 else '回滚'
KW3 = sys.argv[2] if len(sys.argv) > 2 else '索引生成器'


def find_browser():
    for path in EDGE_CANDIDATES:
        if path.exists():
            return path
    return None


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def serve(directory, port):
    handler = lambda *a, **kw: SimpleHTTPRequestHandler(*a, directory=str(directory), **kw)
    httpd = ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def hits_for(kw):
    """按与 app.js fullTextHits 相同的规则算出命中，返回 [(doc, 次数, 是否标题命中)]"""
    search_index = json.loads((READER / 'search-index.json').read_text(encoding='utf-8'))
    lower = kw.lower()
    hits = []
    for doc in search_index:
        text = doc.get('text', '')
        occurrences = text.lower().count(lower)
        in_title = lower in doc['title'].lower() or lower in doc['path'].lower()
        if occurrences or in_title:
            hits.append((doc, occurrences, in_title))
    hits.sort(key=lambda h: (-int(h[2]), -h[1], h[0]['path']))
    return hits


def expected():
    """从生成的索引里算出期望值"""
    index = json.loads((READER / 'index.json').read_text(encoding='utf-8'))

    def count_files(items):
        return sum(count_files(i['children']) if i['type'] == 'folder' else 1 for i in items)

    hits = hits_for(KW)
    hits3 = hits_for(KW3)
    top = hits[0] if hits else None
    return {
        'tree_count': count_files(index),
        'hits': len(hits),
        'top_occurrences': top[1] if top else 0,
        'top_path': top[0]['path'] if top else '',
        # 与 encodeURIComponent 对齐：路径里的 / 也要编码
        'top_hash': '#' + quote(top[0]['path'], safe='') if top else '',
        'hits3': len(hits3),
    }


def parse_notes(dom):
    match = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not match:
        return {}
    notes = {}
    for line in match.group(1).splitlines():
        if ' = ' in line:
            key, value = line.split(' = ', 1)
            notes[key.strip()] = value.strip()
    return notes


def drive(browser, port, url, window_size, dump_path):
    """跑一轮无头浏览器，返回自检页写出的 notes"""
    profile = Path(tempfile.mkdtemp(prefix='edge-selftest-'))
    cmd = [
        str(browser), '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        f'--user-data-dir={profile}', '--virtual-time-budget=30000',
        f'--window-size={window_size}', '--dump-dom', url,
    ]
    try:
        with open(dump_path, 'w', encoding='utf-8') as out:
            subprocess.run(cmd, stdout=out, stderr=subprocess.DEVNULL, timeout=180)
        return parse_notes(dump_path.read_text(encoding='utf-8', errors='replace'))
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def report(checks):
    failed = 0
    for label, got, want in checks:
        ok = got == want
        if not ok:
            failed += 1
        print(f'{"PASS" if ok else "FAIL"}  {label}: {got!r}' + ('' if ok else f'（期望 {want!r}）'))
    return failed


def main():
    browser = find_browser()
    if not browser:
        print('跳过：未找到 Edge/Chrome 可执行文件')
        return 2

    exp = expected()
    print(f'浏览器: {browser.name}')
    print(f'关键词: {KW!r}（期望 {exp["hits"]} 篇命中，首条 {exp["top_path"]!r}）、图表词 {KW3!r}\n')

    shutil.copyfile(CHECKS / 'browser-selftest.html', TEMP_PAGE)
    port = free_port()
    httpd = serve(READER, port)
    dump_dir = ROOT / '.workbuddy' / 'tmp'
    dump_dir.mkdir(parents=True, exist_ok=True)
    base_url = f'http://127.0.0.1:{port}/_selftest.html?kw={quote(KW)}&kw3={quote(KW3)}'

    try:
        time.sleep(0.5)
        notes = drive(browser, port, base_url, '1440,900', dump_dir / 'dump.html')
        notes_m = drive(browser, port, base_url + '&mode=mobile', '375,700', dump_dir / 'dump-mobile.html')
    finally:
        httpd.shutdown()
        TEMP_PAGE.unlink(missing_ok=True)

    if not notes:
        print('FAIL  没能从页面拿到自检结果（dump 为空）')
        return 1

    checks = [
        ('侧栏文档条目', notes.get('tree_count'), str(exp['tree_count'])),
        ('打开文档', notes.get('doc_opened'), '是'),
        ('markdown-it 已加载', notes.get('md_ok'), 'function'),
        ('全文命中篇数', notes.get('hits'), str(exp['hits'])),
        ('结果标题行', notes.get('header'), f'搜索结果（{exp["hits"]}）'),
        ('片段内高亮', notes.get('snippet_marked'), '是'),
        ('命中次数标记', notes.get('count_badge'),
         f'命中 {exp["top_occurrences"]} 次' if exp['top_occurrences'] > 1 else '(无)'),
        ('搜索时正文未被替换', notes.get('viewer_kept'), '是'),
        ('正文高亮数量 > 0', str(int(notes.get('marks', 0)) > 0), 'True'),
        ('首个高亮文本', (notes.get('first_mark_text') or '').lower(), KW.lower()),
        ('首个带 doc-hit-first', notes.get('first_has_flag'), '是'),
        ('定位到首条命中文档', notes.get('hash'), exp['top_hash']),
        ('滚动到命中处 (scrollY > 0)', str(int(notes.get('scrollY', 0)) > 0), 'True'),
        ('SVG 内无标记', notes.get('svg_intact', '').split('/')[-1].strip(), '0 个标记落在 svg 内'),
        ('切到另一篇后仍高亮', str(int(notes.get('marks_second_doc', 0)) > 0), 'True'),
        ('清空后目录树复原', notes.get('tree_after_clear'), str(exp['tree_count'])),
        ('清空后正文标记撤掉', notes.get('marks_after_clear'), '0'),
        ('清空后文档不变', notes.get('doc_unchanged'), '是'),
        ('图表词命中篇数', notes.get('hits3'), str(exp['hits3'])),
        ('Mermaid 图已渲染成 SVG', str(int(notes.get('svg3_count', 0)) > 0), 'True'),
        ('图表文字未被破坏', notes.get('svg3_text_kept'), '是'),
        ('SVG 内不插标记（词只在图里）', notes.get('marks3'), '0'),
        ('切走前已滚到 900', str(int(notes.get('pos_before', 0)) >= 800), 'True'),
        ('换到没记录的文档回到顶部', str(int(notes.get('pos_other_doc', 99999)) <= 60), 'True'),
        ('切回来恢复阅读位置', str(int(notes.get('pos_restored', 0)) >= 800), 'True'),
        ('位置已落进 localStorage', str(int(notes.get('pos_stored', 0)) >= 1), 'True'),
        ('DOMPurify 剥掉脚本与事件属性', notes.get('san_stripped'), '是'),
        ('DOMPurify 保留正常标签', notes.get('san_keeps_p'), '是'),
        ('流程图执行完毕', notes.get('ALLDONE'), 'yes'),
    ]

    failed = report(checks)

    print('\n--- 移动端（375x700 视口）---')
    if not notes_m:
        print('FAIL  没能拿到移动端自检结果')
        failed += 1
    else:
        mobile_checks = [
            ('记忆态 sidebarCollapsed 未被写入 collapsed', notes_m.get('m_seeded_guard'), '是'),
            ('点汉堡打开抽屉（类名正确）', notes_m.get('m_open_classes'), '是'),
            ('抽屉打开时贴左边缘 (left=0)', notes_m.get('m_open_left'), '0'),
            ('遮罩状态置位', notes_m.get('m_body_open'), '是'),
            ('footer「收起」= 关抽屉', notes_m.get('m_closed'), '是'),
            ('关闭时遮罩状态清掉', notes_m.get('m_body_closed'), '是'),
            ('遮罩无残留 (display)', notes_m.get('m_overlay_display'), 'none'),
            ('汉堡按钮恢复可见', notes_m.get('m_menu_btn_display'), 'flex'),
            ('点击文档自动收抽屉', notes_m.get('m_doc_click_closes'), '是'),
            ('移动端流程执行完毕', notes_m.get('MOBILEDONE'), 'yes'),
        ]
        failed += report(mobile_checks)

    print('\n--- 关键输出 ---')
    for key in ('header', 'snippet_text', 'count_badge', 'excerpt', 'hash', 'svg_intact'):
        print(f'  {key} = {notes.get(key)}')
    if 'ERROR' in notes:
        print(f'  页面内报错: {notes["ERROR"]}')

    print('\n' + (f'FAILED: {failed} 项' if failed else 'ALL PASS'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
