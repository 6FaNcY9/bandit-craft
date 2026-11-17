'use strict';
// Bots, players and plans on the world view: markers with name tags, plan cells by build status.
// Page only; THREE, OV.blocks and the page's COLORS must be there before makeLayers runs. Declares no top-level name.
(function () {
  const EASE = 1000, NOT_A_PLAYER = /^(bot\d+|MisaBot|EM_Trader)$/;
  const OVER = {polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1}; // plan faces win against the terrain's

  function makeLayers(view, tagsEl) {
    const {scene} = view, canvas = tagsEl.parentElement.querySelector('canvas');
    const body = new THREE.BoxGeometry(0.6, 1.8, 0.6).translate(0, 0.9, 0), cube = new THREE.BoxGeometry(1, 1, 1), m4 = new THREE.Matrix4();
    const mats = new Map(), marks = new Map(), plans = new Map(); // colour -> material; name -> marker; key -> [InstancedMesh]
    const mat = (c) => mats.get(c) || mats.set(c, new THREE.MeshBasicMaterial({color: c})).get(c);

    // once per drawn frame: markers ease, tags follow; frames are asked for only while a marker moves
    scene.onBeforeRender = () => {
      const now = performance.now();
      let moving = false;
      for (const m of marks.values()) {
        const k = Math.min(1, (now - m.t0) / EASE), p = m.mesh.position.lerpVectors(m.from, m.to, k);
        m.mesh.updateMatrixWorld(); // the renderer updated the scene's matrices before this hook
        moving ||= k < 1;
        const s = view.project(p.x, p.y + 2.1, p.z);
        m.tag.hidden = !s.visible;
        if (s.visible) m.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      }
      if (moving) view.draw();
    };

    function bots(state) {
      const want = new Map(), now = performance.now();
      for (const p of state.world?.players || []) if (p.name && !NOT_A_PLAYER.test(p.name) && /overworld/.test(p.dim || '')) want.set(p.name, [p.x, p.y, p.z, '#ffffff']);
      state.bots.forEach((b, i) => { if (b.online && b.pos && /overworld/.test(b.dimension || '')) want.set(b.name, [...b.pos, COLORS[i % 6]]); });
      let changed = false;
      for (const [name, m] of marks) if (!want.has(name)) { scene.remove(m.mesh); m.tag.remove(); marks.delete(name); changed = true; }
      for (const [name, [x, y, z, c]] of want) {
        let m = marks.get(name);
        if (!m) {
          const tag = tagsEl.appendChild(document.createElement('div'));
          tag.textContent = name;
          m = {mesh: new THREE.Mesh(body, mat(c)), tag, from: new THREE.Vector3(x, y, z), to: new THREE.Vector3(x, y, z), t0: 0};
          m.mesh.position.copy(m.to); // a hidden tab draws no frame, and the next update eases from here
          scene.add(m.mesh);
          marks.set(name, m);
        } else if (m.to.x !== x || m.to.y !== y || m.to.z !== z) { m.from.copy(m.mesh.position); m.to.set(x, y, z); m.t0 = now; }
        else if (m.mesh.material === mat(c)) continue;
        m.mesh.material = mat(c);
        changed = true;
      }
      canvas.dataset.bots = marks.size;
      if (changed) view.draw();
    }

    function group({name, s, xyz}) {
      // s: 0 missing (a ghost in the block's colour), 1 built, 2 wrong (red, a bit bigger), 3 unknown (a grey ghost)
      const color = s === 2 ? 0xef4444 : s === 3 ? 0x9aa1aa : OV.blocks.rgb(name).reduce((a, v) => (a << 8) | v, 0), k = s === 2 ? 1.02 : 1;
      const mesh = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({...OVER, color, transparent: s !== 1, opacity: [0.35, 1, 0.6, 0.35][s], depthWrite: s === 1 || s === 2}), xyz.length / 3);
      for (let i = 0; i < xyz.length; i += 3) mesh.setMatrixAt(i / 3, m4.makeScale(k, k, k).setPosition(xyz[i] + 0.5, xyz[i + 1] + 0.5, xyz[i + 2] + 0.5));
      scene.add(mesh);
      return mesh;
    }
    function plan(msg) {
      for (const m of plans.get(msg.key) || []) { scene.remove(m); m.material.dispose(); m.dispose(); }
      plans.delete(msg.key);
      if (msg.groups) plans.set(msg.key, msg.groups.map(group));
      canvas.dataset.plans = plans.size;
      view.draw();
    }

    return {bots, plan};
  }

  (self.OV = self.OV || {}).makeLayers = makeLayers;
})();
