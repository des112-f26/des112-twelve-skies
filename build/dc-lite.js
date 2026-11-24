/*
 * dc-lite — a tiny standalone runtime for one Design Component (.dc.html) file.
 *
 * It renders the same template + `class Component extends DCLogic` code the design
 * canvas runs, so the app can be hosted anywhere as static files (e.g. GitHub Pages).
 * Supports: {{holes}} (dotted lookups and literals), <sc-if>, <sc-for>, <helmet>,
 * camelCase event attributes (onClick, onChange, onPointerDown, …), controlled
 * inputs, and React-style batched setState / lifecycle (componentDidMount, …).
 */
(function () {
  'use strict';

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var EVENT_MAP = { click: 'click', focus: 'focus', blur: 'blur', pointerdown: 'pointerdown', pointermove: 'pointermove',
    pointerup: 'pointerup', pointercancel: 'pointercancel', input: 'input', keydown: 'keydown', keyup: 'keyup' };
  var BOOL_PROPS = { disabled: 1, checked: 1, readonly: 1, multiple: 1, selected: 1, hidden: 1 };
  var IGNORE_ATTRS = { 'hint-placeholder-val': 1, 'hint-placeholder-count': 1, 'hint-size': 1 };

  // ---------- values ----------
  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    var segs = path.split('.'), v = scope;
    for (var i = 0; i < segs.length; i++) { if (v == null) return undefined; v = v[segs[i]]; }
    return v;
  }
  function parseParts(str) {           // "a {{x}} b" → ['a ', {p:'x'}, ' b']; null when there are no holes
    if (str.indexOf('{{') < 0) return null;
    var parts = [], last = 0, m;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(str))) { if (m.index > last) parts.push(str.slice(last, m.index)); parts.push({ p: m[1] }); last = HOLE.lastIndex; }
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  }
  function evalParts(parts, scope) {   // a single whole hole keeps its raw value (number, function, boolean …)
    if (parts.length === 1 && typeof parts[0] === 'object') return lookup(parts[0].p, scope);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var x = parts[i];
      if (typeof x === 'string') out += x; else { var v = lookup(x.p, scope); out += v == null || v === false ? '' : String(v); }
    }
    return out;
  }
  // JSX-style whitespace: lines are trimmed and whitespace-only lines dropped, so template indentation adds no stray spaces
  function jsxText(s) {
    if (s.indexOf('\n') < 0) return s;
    var lines = s.split(/\r?\n/), out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (i > 0) l = l.replace(/^[ \t]+/, '');
      if (i < lines.length - 1) l = l.replace(/[ \t]+$/, '');
      if (l) out.push(l);
    }
    return out.join(' ');
  }

  // ---------- compile the template once ----------
  function compile(node, out) {
    if (node.nodeType === 3) {
      var t = jsxText(node.nodeValue);
      if (!t) return;
      var parts = parseParts(t);
      out.push(parts ? { k: 'text', parts: parts } : { k: 'stext', text: t });
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-if') { out.push({ k: 'if', parts: parseParts(node.getAttribute('value') || '') || [''], kids: compileKids(node) }); return; }
    if (tag === 'sc-for') { out.push({ k: 'for', parts: parseParts(node.getAttribute('list') || '') || [''], as: node.getAttribute('as') || 'item', kids: compileKids(node) }); return; }
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name;
      if (IGNORE_ATTRS[name]) continue;
      attrs.push({ name: name, parts: parseParts(a.value), value: a.value });
    }
    out.push({ k: 'el', ns: node.namespaceURI, tag: node.tagName.toLowerCase() === tag ? tag : node.tagName, local: tag, attrs: attrs, kids: compileKids(node) });
  }
  function compileKids(node) { var out = []; for (var c = node.firstChild; c; c = c.nextSibling) compile(c, out); return out; }

  // ---------- mount + update ----------
  function setAttr(el, name, v, isSvg) {
    var lname = name.toLowerCase();
    if (lname === 'value' && (el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select')) {
      var s = v == null ? '' : String(v);
      if (el.value !== s) el.value = s;
      return;
    }
    if (BOOL_PROPS[lname] && !isSvg) { el[lname === 'readonly' ? 'readOnly' : lname] = !!v && v !== 'false'; return; }
    if (v == null || (v === false && lname.indexOf('aria-') !== 0 && lname.indexOf('data-') !== 0)) { el.removeAttribute(name); return; }
    el.setAttribute(name, v === true ? 'true' : String(v));
  }

  function mountAll(bps, parent, before, scope) {
    var list = [];
    for (var i = 0; i < bps.length; i++) list.push(mount(bps[i], parent, before, scope));
    return list;
  }
  function updateAll(list, scope) { for (var i = 0; i < list.length; i++) list[i].update(scope); }
  function removeAll(list) { for (var i = 0; i < list.length; i++) list[i].remove(); }

  function mount(bp, parent, before, scope) {
    if (bp.k === 'stext') {
      var sn = document.createTextNode(bp.text); parent.insertBefore(sn, before);
      return { update: function () {}, remove: function () { sn.remove(); } };
    }
    if (bp.k === 'text') {
      var tn = document.createTextNode(''); parent.insertBefore(tn, before);
      var inst = { update: function (s) { var v = evalParts(bp.parts, s); v = v == null || v === false ? '' : String(v); if (tn.nodeValue !== v) tn.nodeValue = v; }, remove: function () { tn.remove(); } };
      inst.update(scope); return inst;
    }
    if (bp.k === 'if') {
      var anchor = document.createComment('if'); parent.insertBefore(anchor, before);
      var kids = null;
      var ifInst = {
        update: function (s) {
          var on = !!evalParts(bp.parts, s);
          if (on && !kids) kids = mountAll(bp.kids, anchor.parentNode, anchor, s);
          else if (on) updateAll(kids, s);
          else if (!on && kids) { removeAll(kids); kids = null; }
        },
        remove: function () { if (kids) removeAll(kids); kids = null; anchor.remove(); }
      };
      ifInst.update(scope); return ifInst;
    }
    if (bp.k === 'for') {
      var fAnchor = document.createComment('for'); parent.insertBefore(fAnchor, before);
      var rows = [];
      var forInst = {
        update: function (s) {
          var arr = evalParts(bp.parts, s);
          if (!Array.isArray(arr)) arr = [];
          for (var i = 0; i < arr.length; i++) {
            var sc = Object.create(s); sc[bp.as] = arr[i]; sc.$index = i;
            if (i < rows.length) updateAll(rows[i], sc); else rows.push(mountAll(bp.kids, fAnchor.parentNode, fAnchor, sc));
          }
          while (rows.length > arr.length) removeAll(rows.pop());
        },
        remove: function () { while (rows.length) removeAll(rows.pop()); fAnchor.remove(); }
      };
      forInst.update(scope); return forInst;
    }
    // element
    var isSvg = bp.ns === 'http://www.w3.org/2000/svg';
    var el = isSvg ? document.createElementNS(bp.ns, bp.tag) : document.createElement(bp.local);
    var dyn = [], handlers = {};
    for (var a = 0; a < bp.attrs.length; a++) {
      var at = bp.attrs[a], lname = at.name.toLowerCase();
      if (lname.length > 2 && lname.slice(0, 2) === 'on' && at.parts) {      // event attribute: onClick="{{fn}}"
        var ev = lname.slice(2);
        if (ev === 'change' && (bp.local === 'input' || bp.local === 'textarea')) ev = 'input';   // React's onChange fires on every edit
        ev = EVENT_MAP[ev] || ev;
        (function (ev, at) {
          handlers[ev] = null;
          el.addEventListener(ev, function (e) { var fn = handlers[ev]; if (typeof fn === 'function') fn(e); });
          dyn.push({ ev: ev, parts: at.parts });
        })(ev, at);
        continue;
      }
      if (at.parts) dyn.push({ name: at.name, parts: at.parts, last: undefined });
      else setAttr(el, at.name, at.value, isSvg);
    }
    var kidsEl = mountAll(bp.kids, el, null, scope);
    var elInst = {
      update: function (s) {
        for (var i = 0; i < dyn.length; i++) {
          var d = dyn[i], v = evalParts(d.parts, s);
          if (d.ev) { handlers[d.ev] = v; continue; }
          if (v !== d.last || d.name === 'value') { d.last = v; setAttr(el, d.name, v, isSvg); }
        }
        updateAll(kidsEl, s);
      },
      remove: function () { el.remove(); }
    };
    elInst.update(scope);
    parent.insertBefore(el, before);
    return elInst;
  }

  // ---------- the component base class ----------
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch, cb) {
    var host = this.__host;
    if (!host) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state, this.props) : patch); return; }
    host.queue.push(patch); if (cb) host.cbs.push(cb);
    host.schedule();
  };
  DCLogic.prototype.forceUpdate = function (cb) { if (this.__host) { if (cb) this.__host.cbs.push(cb); this.__host.schedule(); } };
  window.DCLogic = DCLogic;

  // ---------- boot ----------
  function start(opts) {
    var tpl = opts.template.content || opts.template;
    var xdc = tpl.querySelector('x-dc') || tpl;
    var helmet = xdc.querySelector('helmet');
    if (helmet) {                                    // <helmet> content (styles, font links) goes to <head> once
      for (var c = helmet.firstElementChild; c; c = c.nextElementSibling) document.head.appendChild(document.importNode(c, true));
      helmet.remove();
    }
    var bps = compileKids(xdc);
    var Comp = opts.component;
    var props = opts.props();
    var comp = new Comp(props);
    if (!comp.state) comp.state = {};
    var root = null, scheduled = false;
    var host = {
      queue: [], cbs: [],
      schedule: function () { if (!scheduled) { scheduled = true; Promise.resolve().then(flush); } }
    };
    function flush() {
      scheduled = false;
      var q = host.queue; host.queue = [];
      for (var i = 0; i < q.length; i++) {
        var p = q[i];
        Object.assign(comp.state, typeof p === 'function' ? p(comp.state, comp.props) : p);
      }
      render();
      var cbs = host.cbs; host.cbs = [];
      for (var j = 0; j < cbs.length; j++) { try { cbs[j](); } catch (e) { console.error(e); } }
      if (comp.componentDidUpdate) { try { comp.componentDidUpdate(); } catch (e) { console.error(e); } }
    }
    function render() {
      var vals;
      try { vals = comp.renderVals(); } catch (e) { console.error('renderVals failed', e); return; }
      if (!root) root = mountAll(bps, opts.mount, null, vals);
      else updateAll(root, vals);
    }
    comp.__host = host;
    render();
    if (comp.componentDidMount) comp.componentDidMount();
    window.addEventListener('pagehide', function () { if (comp.componentWillUnmount) try { comp.componentWillUnmount(); } catch (e) {} });
    return {
      component: comp,
      setProps: function (p) { comp.props = Object.assign({}, comp.props, p); host.schedule(); }
    };
  }
  window.DCLite = { start: start };
})();
