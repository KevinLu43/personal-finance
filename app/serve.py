# Local static server for start.bat. Same as `python -m http.server`, but tells
# the browser to revalidate every file so an edited index.html/config.js is
# never served from a stale cache.
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
