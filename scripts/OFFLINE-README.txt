OFFLINE TOOLBOX — BUILT SITE
============================

This folder is a complete, self-contained static website. It needs no Internet
connection, no Node.js/npm and no backend. Every tool runs in the browser and
processes your data locally.

Serve it with any static web server, then open the printed address:

    python3 -m http.server 8080          # Python 3 (most Linux systems)
    node serve.mjs --port 8080            # Node.js 18+ (bundled zero-dependency server)
    busybox httpd -f -p 8080              # BusyBox

  → http://localhost:8080/

The site works at any URL path, so it can also be dropped into an existing web
server (nginx, Apache, IIS …) as a sub-directory, e.g. https://intranet/tools/.

Why a web server and not just double-clicking index.html?
Browsers apply stricter rules to file:// pages: module scripts, web workers
(used for PDF rendering) and IndexedDB storage do not work reliably there.

Contents
  index.html        Launcher listing every tool
  <tool>/           One folder per tool (see tools.json)
  tools.json        Machine-readable list of tools
  serve.mjs         Optional tiny Node.js static server

Source code, documentation and updates: see the repository README.
