#!/usr/bin/env python3
"""Serve the independent built Segments website with Python's standard library."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.bin': 'application/octet-stream'}
    base_path = '/'

    def translate_path(self, path):
        if self.base_path != '/' and path.startswith(self.base_path):
            path = '/' + path[len(self.base_path):]
        return super().translate_path(path)

    def list_directory(self, path):
        self.send_error(404, 'File not found')

    def send_head(self):
        if not urlsplit(self.path).path.startswith(self.base_path):
            self.send_error(404, 'File not found')
            return None
        target = Path(self.translate_path(self.path)).resolve()
        if not target.is_relative_to(DIST):
            self.send_error(404, 'File not found')
            return None
        return super().send_head()

    def end_headers(self):
        route = self.path.split('?', 1)[0]
        self.send_header('Cache-Control', 'no-cache' if route.endswith(('/', '.html', '.json')) else 'public, max-age=3600')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4175)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--base-path', default='/', help='URL prefix used when building the website')
    args = parser.parse_args()
    Handler.base_path = '/' + args.base_path.strip('/') + '/' if args.base_path.strip('/') else '/'
    if not (DIST / 'index.html').is_file():
        parser.error('Built website missing. Run npm ci and npm run build first.')
    try:
        server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(DIST)))
    except OSError as error:
        parser.exit(1, f'Could not open port {args.port}: {error}\nIf this GUI is already running, open http://localhost:{args.port}\n')
    print(f'Physical AI Lab: http://localhost:{args.port}{Handler.base_path}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
