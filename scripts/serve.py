#!/usr/bin/env python3
"""本地预览服务：以 reader/ 为站点根，并禁用缓存

不要直接用 `python -m http.server`：它不发 Cache-Control，浏览器会按 Last-Modified
做启发式缓存（新鲜期约为文件年龄的 10%），于是改完 style.css / app.js 刷新后仍是旧样式，
很容易误判"改动没生效"。

用法：
    python scripts/serve.py            # http://127.0.0.1:8080/
    python scripts/serve.py --port 8081
"""

import argparse
import functools
import http.server
import socketserver
from pathlib import Path

READER_DIR = Path(__file__).resolve().parent.parent / 'reader'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """静态文件服务，所有响应都禁止缓存"""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 保持终端干净


def main():
    parser = argparse.ArgumentParser(description='本地预览 reader/（禁用缓存）')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()

    if not READER_DIR.is_dir():
        raise SystemExit(f'找不到 {READER_DIR}')

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(NoCacheHandler, directory=str(READER_DIR))
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        print(f'本地预览: http://{args.host}:{args.port}/   站点根: {READER_DIR}（已禁用缓存）')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')


if __name__ == '__main__':
    main()
