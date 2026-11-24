#!/usr/bin/env python3
"""Build the Twelve Skies web app from the design file.

    python3 build/build.py            # reads src/Main.dc.html, writes index.html

The result is one static index.html (plus the icon and manifest beside it) that runs
on GitHub Pages or any static host. No server, build tools or API keys are needed.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'Main.dc.html'
OUT = ROOT / 'index.html'

src = SRC.read_text(encoding='utf-8')
a = src.index('<x-dc>'); b = src.index('</x-dc>') + len('</x-dc>')
template = src[a:b]
m = re.search(r'<script type="text/x-dc" data-dc-script[^>]*>', src)
if not m:
    sys.exit('No data-dc-script block found in ' + str(SRC))
code_start = m.end(); code_end = src.index('</script>', code_start)
logic = src[code_start:code_end]
for chunk, name in ((template, 'template'), (logic, 'component script')):
    if '</script' in chunk.lower() or '</template' in chunk.lower():
        sys.exit('The ' + name + ' contains a closing script/template tag and cannot be inlined safely.')
runtime = (ROOT / 'build' / 'dc-lite.js').read_text(encoding='utf-8')

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Twelve Skies</title>
<meta name="description" content="Twelve Skies: a calm clock whose sky changes color through the day, with a constellation of personal memories, family traditions and the twelve Chinese zodiac hours.">
<meta name="theme-color" content="#1D1850">
<!-- Home Screen: opens full screen, with its own name and icon -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Twelve Skies">
<meta name="application-name" content="Twelve Skies">
<meta name="format-detection" content="telephone=no">
<link rel="apple-touch-icon" href="apple-touch-icon.png" sizes="180x180">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="icon" href="app-icon.png" type="image/png" sizes="1024x1024">
<link rel="manifest" href="manifest.webmanifest">
<style>
  /* ---- The page around the app: a plain white page, ready for your own design ---- */
  html, body {{ margin: 0; }}
  body {{ background: #FFFFFF; min-height: 100vh; display: flex; flex-direction: column; -webkit-tap-highlight-color: transparent; }}
  .page {{ margin: auto; padding: 24px; display: flex; flex-direction: column; align-items: center; }}   /* centered; scrolls if the window is smaller than the app */
  #brand {{ display: none; height: 44px; margin: 0 0 20px; }}          /* wordmark above the app when the window is tall enough */
  #brand img {{ height: 100%; width: auto; display: block; }}
  body.show-brand #brand {{ display: block; }}
  /* ---- The app: fixed at iPhone size (390 x 844) on desktop ---- */
  #app {{ position: relative; overflow: hidden; flex-shrink: 0; width: 390px; height: 844px; }}
  /* ---- On a phone the app fills the screen ---- */
  html.phone, html.phone body {{ overflow: hidden; overscroll-behavior: none; }}   /* no page scrolling or bounce on a phone */
  html.phone {{ background: var(--ground, #1D1850); }}   /* matches the bottom of the sky, so the edge of the screen blends in */
  body.phone {{ min-height: 0; background: transparent; }}
  body.phone .page {{ margin: 0; padding: 0; }}
  body.phone #brand {{ display: none; }}
  #safe-probe {{ position: fixed; top: 0; left: 0; width: 0; height: 100vh; height: 100lvh; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); visibility: hidden; pointer-events: none; }}   /* measures the notch, home bar and screen height */
  .noscript {{ color: #2B1D45; font: 16px/1.5 system-ui, sans-serif; padding: 24px; max-width: 420px; text-align: center; }}
</style>
</head>
<body>
<div class="page">
<header id="brand"><img src="brand/twelve-skies-wordmark-light.svg" alt="Twelve Skies" width="233" height="44"></header>
<main id="app" aria-label="Twelve Skies app"></main>
</div>
<div id="safe-probe" aria-hidden="true"></div>
<noscript><p class="noscript">Twelve Skies needs JavaScript turned on.</p></noscript>
<template id="dc-template">
{template}
</template>
<script>
{runtime}
</script>
<script>
{logic}
</script>
<script>
(function () {{
  // Phones (and the Home Screen app) fill the screen. Everything else shows the app at exactly 390 x 844.
  var APP_W = 390, APP_H = 844;
  var app = document.getElementById('app');
  var probe = document.getElementById('safe-probe');
  function isStandalone() {{
    return window.navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
  }}
  function isPhone() {{
    var standalone = isStandalone();
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    var shortSide = Math.min(screen.width, screen.height);
    return standalone || (coarse && shortSide < 600);
  }}
  function frame() {{
    var phone = isPhone();
    document.body.classList.toggle('phone', phone);
    document.documentElement.classList.toggle('phone', phone);
    document.body.classList.toggle('show-brand', !phone && window.innerHeight >= APP_H + 48 + 64);
    if (phone) {{
      // The sky fills the whole screen, including behind Safari's toolbar. The content stays in the part iOS reports as
      // visible (innerHeight), clear of the notch / Dynamic Island at the top and the home bar or toolbar at the bottom.
      var cs = getComputedStyle(probe);
      var seen = window.innerHeight, full = Math.max(seen, parseFloat(cs.height) || 0);
      var standalone = isStandalone();
      if (standalone) {{
        // A Home Screen app always covers the whole screen, but iOS can report the height short by the status bar
        // (which left a dark strip at the bottom). Use the real screen height instead.
        var portrait = window.innerHeight >= window.innerWidth;
        var screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
        if (screenH > full) full = screenH;
      }}
      var safeT = parseFloat(cs.paddingTop) || 0, safeB = Math.max(parseFloat(cs.paddingBottom) || 0, full - seen);
      return {{ frameW: Math.round(window.innerWidth), frameH: Math.round(full), safeTop: Math.round(safeT), safeBottom: Math.round(safeB) }};
    }}
    return {{ frameW: APP_W, frameH: APP_H, safeTop: 0, safeBottom: 0 }};
  }}
  function size(f) {{ app.style.width = f.frameW + 'px'; app.style.height = f.frameH + 'px'; }}
  var params = new URLSearchParams(location.search);
  var f = frame(); size(f);
  var props = Object.assign({{}}, f);
  if (params.get('screen')) props.startScreen = params.get('screen');   // e.g. ?screen=zodiac opens a page directly
  var appHandle = DCLite.start({{ template: document.getElementById('dc-template'), component: Component, mount: app, props: function () {{ return props; }} }});
  var t = null;
  function onResize() {{ clearTimeout(t); t = setTimeout(function () {{ var nf = frame(); size(nf); Object.assign(props, nf); appHandle.setProps(nf); }}, 80); }}
  function syncGround() {{
    var stop = app.querySelector('#hillNear stop:last-child');
    if (stop) document.documentElement.style.setProperty('--ground', stop.getAttribute('stop-color'));
  }}
  syncGround();
  if (window.MutationObserver) new MutationObserver(syncGround).observe(app, {{ subtree: true, attributes: true, attributeFilter: ['stop-color'] }});
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}})();
</script>
</body>
</html>
"""
OUT.write_text(page, encoding='utf-8')
print('Wrote', OUT.relative_to(ROOT), f'({len(page) // 1024} KB)')
