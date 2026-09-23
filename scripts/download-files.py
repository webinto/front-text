#!/usr/bin/env python3
"""
使用 GitHub API 只下载 txt/md/docx 文件
避免下载整个仓库
"""

import os
import json
import subprocess
import urllib.request
from pathlib import Path

REPO = os.environ.get('GITHUB_REPOSITORY', 'webinto/front-text')
TOKEN = os.environ.get('GITHUB_TOKEN', '')
BRANCH = os.environ.get('GITHUB_REF', 'refs/heads/main').replace('refs/heads/', '')
WORKSPACE = Path(os.environ.get('GITHUB_WORKSPACE', '.'))

ALLOWED_EXTENSIONS = {'.txt', '.md', '.docx'}
SKIP_DIRS = {'.git', '.github', 'node_modules', '__pycache__', 'reader', 'scripts'}

HEADERS_JSON = {'Authorization': f'token {TOKEN}', 'Accept': 'application/vnd.github.v3+json'}
HEADERS_RAW = {'Authorization': f'token {TOKEN}', 'Accept': 'application/vnd.github.v3.raw'}


def fetch(url, headers):
    """发起一次 GitHub API 请求"""
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def get_latest_commit():
    """获取远端分支最新 commit"""
    result = subprocess.run(
        f'git ls-remote https://github.com/{REPO}.git {BRANCH}',
        shell=True, capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f'[Error] 无法获取仓库信息: {result.stderr}')
        return None
    return result.stdout.split()[0]


def get_tree_files(sha):
    """获取指定 commit 下所有文件"""
    url = f'https://api.github.com/repos/{REPO}/git/trees/{sha}?recursive=1'
    return json.loads(fetch(url, HEADERS_JSON)).get('tree', [])


def download_file(path, sha):
    """下载单个文件到工作区"""
    content = fetch(f'https://api.github.com/repos/{REPO}/git/blobs/{sha}', HEADERS_RAW)
    dest = WORKSPACE / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(content)
    print(f'[Download] {path}')


def main():
    print(f'[Download] 仓库: {REPO}, 分支: {BRANCH}')

    commit_sha = get_latest_commit()
    if not commit_sha:
        return
    print(f'[Download] Commit: {commit_sha}')

    downloaded = 0
    skipped = 0

    for item in get_tree_files(commit_sha):
        if item['type'] != 'blob':
            continue

        path = item['path']
        if any(skip in path.split('/') for skip in SKIP_DIRS):
            continue

        if Path(path).suffix.lower() in ALLOWED_EXTENSIONS:
            download_file(path, item['sha'])
            downloaded += 1
        else:
            skipped += 1

    print(f'[Download] 完成: {downloaded} 文件, 跳过 {skipped} 个不支持的类型')


if __name__ == '__main__':
    main()
