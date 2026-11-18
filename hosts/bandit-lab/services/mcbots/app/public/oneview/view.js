'use strict';
// The world on the page's canvas: the worker's section meshes, grey tiles where the world is not known, a camera for fingers and mouse.
// Page only; THREE must be loaded before makeView runs. Declares no top-level name (the page's inline script shares the scope).
(function () {
  const DEF = {x: -270, y: 70, z: -20, az: 0.7, el: 0.9, r: 90};
  const BG = 0x0b0d10, FOV = 50;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function makeView(canvas, {worker, onPick}) {
    THREE.ColorManagement.enabled = false; // colours are raw bytes end to end
    const box = canvas.parentElement, viewR = matchMedia('(max-width: 899px)').matches ? 5 : 9;
    const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2000), terrain = new THREE.Group();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 1, 2);
    scene.add(terrain);
    const mat = new THREE.MeshBasicMaterial({vertexColors: true});
    const tileGeo = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(8, 0, 8);
    const tileMat = [null, 0x555b66, 0x9aa1aa].map((color) => color && new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.25})); // by chunk state: 1 ungenerated, 2 unknown
    const secs = new Map(), tiles = new Map(), known = new Set(); // "cx,sy,cz" -> mesh, "cx,cz" -> tile, "cx,cz" of state 0
    let tris = 0, loose = 0; // loose: loose dirt cells in the drawn sections

    // ---- terrain ----
    function dropMesh(k) {
      const m = secs.get(k);
      if (!m) return;
      terrain.remove(m);
      tris -= m.geometry.index.count / 3;
      loose -= m.userData.loose;
      m.geometry.dispose();
      secs.delete(k);
    }
    function setMesh({cx, sy, cz, pos, col, idx, loose: n = 0}) {
      const k = `${cx},${sy},${cz}`;
      dropMesh(k);
      if (!pos) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.position.set(cx * 16, sy * 16, cz * 16);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.userData.loose = n;
      terrain.add(m);
      secs.set(k, m);
      tris += idx.length / 3;
      loose += n;
    }
    function setChunk(cx, cz, state) {
      const k = `${cx},${cz}`, t = tiles.get(k);
      if (state !== 0) for (let sy = -4; sy < 20; sy++) dropMesh(`${cx},${sy},${cz}`);
      if (state === 0) known.add(k); else known.delete(k);
      if (tileMat[state]) {
        if (t) { t.material = tileMat[state]; return; }
        const m = new THREE.Mesh(tileGeo, tileMat[state]);
        m.position.set(cx * 16, 63, cz * 16);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        scene.add(m);
        tiles.set(k, m);
      } else if (t) { scene.remove(t); tiles.delete(k); }
    }
    const stats = () => ({chunks: known.size, meshes: secs.size, tris, loose});
    let statT = 0;
    function counted() { // the check reads these, at most once a second
      statT ||= setTimeout(() => { statT = 0; const s = stats(); canvas.dataset.chunks = s.chunks; canvas.dataset.meshes = s.meshes; canvas.dataset.tris = s.tris; canvas.dataset.loose = s.loose; canvas.dataset.cut = lvl; }, 1000);
    }
    function onWorker(m) {
      if (m.t === 'mesh') setMesh(m);
      else if (m.t === 'chunk') setChunk(m.cx, m.cz, m.state);
      else if (m.t === 'reset') { for (const k of secs.keys()) dropMesh(k); for (const t of tiles.values()) scene.remove(t); tiles.clear(); known.clear(); }
      else return;
      counted();
      draw();
    }

    // ---- camera: a target on the ground, seen from r blocks at azimuth az and elevation el ----
    const cam = {...DEF};
    try { const s = JSON.parse(localStorage.getItem('cam')); for (const k in DEF) if (Number.isFinite(s?.[k])) cam[k] = s[k]; } catch {}
    let base = cam.y = Math.max(cam.y, 70), lvl = 319; // base: the height of the last flyTo; lvl: the cut the target follows (not kept, so a saved target starts above ground)
    let atCx = NaN, atCz = NaN, saveT = 0, queued = false;
    function moved() {
      cam.r = clamp(cam.r, 8, 400); cam.el = clamp(cam.el, 0.15, 1.55);
      const flat = cam.r * Math.cos(cam.el);
      camera.position.set(cam.x + flat * Math.sin(cam.az), cam.y + cam.r * Math.sin(cam.el), cam.z + flat * Math.cos(cam.az));
      camera.lookAt(cam.x, cam.y, cam.z);
      camera.updateMatrixWorld();
      const cx = Math.floor(cam.x / 16), cz = Math.floor(cam.z / 16);
      if (cx !== atCx || cz !== atCz) { atCx = cx; atCz = cz; worker.postMessage({t: 'view', cx, cz, viewR}); }
      saveT ||= setTimeout(() => { saveT = 0; try { localStorage.setItem('cam', JSON.stringify(cam)); } catch {} }, 500);
      draw();
    }
    function frame() {
      queued = false;
      scene.fog.near = cam.r + viewR * 9; // hides the loading edge at every zoom
      scene.fog.far = cam.r + viewR * 17;
      renderer.render(scene, camera);
    }
    function draw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(frame);
    }

    // ---- fingers and mouse: one finger or left drag pans, pinch or wheel zooms, a twist or right/shift drag turns ----
    const ptr = new Map(); // pointerId -> last {x, y}
    let tap = null, turn = false, pd = 0, pa = 0; // pd, pa: the last two-finger distance and angle, pd 0 = none yet
    function pan(dx, dy) {
      const k = (2 * cam.r * Math.tan((FOV * Math.PI) / 360)) / (canvas.clientHeight || 1), f = (dy * k) / Math.sin(cam.el);
      const s = Math.sin(cam.az), c = Math.cos(cam.az); // right = (c, 0, -s), forward on the ground = (-s, 0, -c)
      cam.x += -c * dx * k - s * f;
      cam.z += s * dx * k - c * f;
    }
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3();
    function pick(px, py) {
      const b = canvas.getBoundingClientRect();
      ndc.set(((px - b.left) / b.width) * 2 - 1, 1 - ((py - b.top) / b.height) * 2);
      ray.setFromCamera(ndc, camera);
      ray.far = scene.fog.far; // nothing behind the fog
      const hit = ray.intersectObject(terrain, true)[0];
      if (hit) { const p = hit.point, n = hit.face.normal; onPick(Math.floor(p.x - n.x * 0.5), Math.floor(p.y - n.y * 0.5), Math.floor(p.z - n.z * 0.5)); }
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      ptr.set(e.pointerId, {x: e.clientX, y: e.clientY});
      tap = ptr.size === 1 && e.button === 0 ? {x: e.clientX, y: e.clientY, t: e.timeStamp} : null;
      turn = e.button === 2 || e.shiftKey;
      pd = 0;
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptr.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 6) tap = null;
      if (ptr.size > 1) {
        const [a, b] = ptr.values(), d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (pd && d) { cam.r *= pd / d; cam.az += Math.atan2(Math.sin(ang - pa), Math.cos(ang - pa)); }
        pd = d; pa = ang;
      } else if (turn) { cam.az -= dx * 0.008; cam.el += dy * 0.008; }
      else pan(dx, dy);
      moved();
    });
    const up = (e) => {
      if (!ptr.delete(e.pointerId)) return;
      pd = 0;
      if (tap && !ptr.size && e.type === 'pointerup' && e.timeStamp - tap.t < 500) pick(e.clientX, e.clientY);
      tap = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.r *= Math.exp(clamp(e.deltaY, -100, 100) * 0.0015); moved(); }, {passive: false});
    canvas.addEventListener('webglcontextrestored', draw);
    new ResizeObserver(() => {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw();
    }).observe(box);

    function project(x, y, z) { // CSS pixels inside the canvas' box
      v.set(x, y, z).project(camera);
      return {x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
    }
    function level(y) { lvl = y; cam.y = y >= 319 ? base : Math.min(base, y + 1); moved(); counted(); } // the target goes underground only together with a cut
    function flyTo(x, y, z, r = 30) { base = y; Object.assign(cam, {x, z, r}); level(lvl); }
    function topDown(on) { cam.el = on ? 1.55 : 0.9; moved(); }

    moved();
    return {flyTo, level, topDown, draw, project, onWorker, stats, scene, camera};
  }

  (self.OV = self.OV || {}).makeView = makeView;
})();
