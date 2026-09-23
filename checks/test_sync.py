"""校验脚本：排除规则 + 孤儿清理 + 自然排序（在临时目录构造源树后跑真实 sync.py）"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix='synctest-'))
root = tmp / 'proj'
(root / 'reader' / 'docs').mkdir(parents=True)
(root / 'txt' / '07-架构设计').mkdir(parents=True)
(root / 'txt' / '08-开发规范').mkdir(parents=True)

(root / 'reader' / 'config.json').write_text(json.dumps({
    'source_dir': 'txt',
    'exclude_patterns': ['07-*'],
    'exclude_files': ['06-常见问题.txt'],
}, ensure_ascii=False), encoding='utf-8')

for rel in ['01-a.txt', '06-常见问题.txt', '07-架构设计/01-b.txt',
            '08-开发规范/01-c.txt', 'skip.png']:
    (root / 'txt' / rel).write_text('x', encoding='utf-8')

# 制造陈旧产物：excluded 文件的旧副本 + 已删除源文件的产物 + 一个 .md 产物
for rel in ['06-常见问题.txt', '07-架构设计/01-b.txt', 'gone.txt', 'old.md']:
    stale = root / 'reader' / 'docs' / rel
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text('stale', encoding='utf-8')

os.environ['SYNC_ROOT_DIR'] = str(root)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import sync  # noqa: E402

sync.main()

idx = json.loads((root / 'reader' / 'index.json').read_text(encoding='utf-8'))
names = [c['name'] for c in idx]
docs = sorted(p.relative_to(root / 'reader' / 'docs').as_posix()
              for p in (root / 'reader' / 'docs').rglob('*') if p.is_file())

print('\n--- 结果 ---')
print('索引顶层:', names)
print('docs 产物:', docs)
# 顺序纯按名称：文件 01-a.txt 排在目录 08-开发规范 之前（不做目录优先），
# 若改回 (is_file(), name) 断言会变成 ['08-开发规范', '01-a.txt']
assert names == ['01-a.txt', '08-开发规范'], names
assert '06-常见问题.txt' not in docs, '被 exclude_files 排除的文件不应保留产物'
assert '07-架构设计/01-b.txt' not in docs, '被 exclude_patterns 排除的文件不应保留产物'
assert 'gone.txt' not in docs and 'old.md' not in docs, '孤儿产物应被清理'
assert '01-a.txt' in docs and '08-开发规范/01-c.txt' in docs

# 自然排序：数字段按数值比较，9 < 10 < 100
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'scripts'))
import sync as sync_mod  # noqa: E402
ordered = sorted(['100-d.txt', '10-c.txt', '9-b.txt', '11-e.txt'], key=sync_mod.natural_key)
assert ordered == ['9-b.txt', '10-c.txt', '11-e.txt', '100-d.txt'], ordered
print('自然排序:', ordered)

print('PASS')
shutil.rmtree(tmp, ignore_errors=True)
