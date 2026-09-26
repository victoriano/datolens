#!/usr/bin/env python3
"""Local fixture server for native remote-import QA; serves only one supplied folder."""
import argparse
import hashlib
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("--port", type=int, default=18764)
args = parser.parse_args()
root = args.directory.resolve()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_HEAD(self):
        self.respond(False)

    def do_GET(self):
        self.respond(True)

    def respond(self, body):
        path = unquote(urlsplit(self.path).path)
        no_range = path.startswith('/download/')
        relative = path.removeprefix('/download/') if no_range else path.lstrip('/')
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        etag = '"' + hashlib.sha256(data).hexdigest() + '"'
        if self.headers.get('If-Match') not in (None, etag):
            self.send_error(412)
            return
        start, end, status = 0, len(data) - 1, 200
        requested_range = self.headers.get('Range')
        if requested_range and not no_range:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested_range)
            if not match or not any(match.groups()):
                self.send_error(416)
                return
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), end) if last else end
            else:
                start = max(0, len(data) - int(last))
            if start > end or start >= len(data):
                self.send_error(416)
                return
            status = 206
        payload = data[start:end + 1]
        self.send_response(status)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Content-Type', {'csv': 'text/csv', 'parquet': 'application/vnd.apache.parquet', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}.get(file.suffix[1:], 'application/octet-stream'))
        self.send_header('ETag', etag)
        self.send_header('Accept-Ranges', 'none' if no_range else 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{len(data)}')
        self.end_headers()
        if body:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass
        print(json.dumps({'file': file.name, 'method': self.command, 'status': status, 'range': requested_range, 'responseBytes': len(payload) if body else 0, 'sourceBytes': len(data)}), flush=True)

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(f'Fixture server on 127.0.0.1:{server.server_port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
