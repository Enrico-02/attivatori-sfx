/* Italy Decoded – animated activators with a timeline each, for composing the SFX in sync.
   One WebGL renderer draws every visible card into its own 2D canvas. Time is driven by one clock (the audio clock
   once audio exists), so a test sound dropped on a card stays locked to the clip. */
(() => {
  "use strict";
  const A = window.ACTIVATORS, RULES = window.EVENT_RULES, SPINS = window.SPIN_RULES;
  const COLORS = ["#ffbf33", "#ff7ac6", "#7dffa8", "#b59cff", "#ff9a5c"];
  const STAGE = 0x070b0e;
  const $ = (s, el = document) => el.querySelector(s);
  const num = (v, d = 3) => v.toFixed(d).replace(".", ",");
  const ICON = {
    play: '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>',
    pause: '<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z"/></svg>',
    start: '<svg viewBox="0 0 12 12"><path d="M1 1h2v10H1zM11 1v10L4 6z"/></svg>',
    prev: '<svg viewBox="0 0 12 12"><path d="M3 1h2v10H3zM11 1v10L6 6z"/></svg>',
    next: '<svg viewBox="0 0 12 12"><path d="M7 1h2v10H7zM1 1v10l5-5z"/></svg>',
  };

  // ---------- clock and audio ----------
  let actx = null, master = null;
  const clock = () => (actx ? actx.currentTime : performance.now() / 1000);
  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.connect(actx.destination);
      last = clock();
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  // ---------- model loading (GLB wrapped in .js so the page also works opened as a file) ----------
  window.GLB = window.GLB || {};
  const scriptCache = {};
  function loadScript(key) {
    if (!scriptCache[key]) {
      scriptCache[key] = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = `models/${key}.js`;
        s.onload = () => (window.GLB[key] ? res(window.GLB[key]) : rej(new Error("vuoto")));
        s.onerror = () => rej(new Error(`models/${key}.js non trovato`));
        document.head.appendChild(s);
      });
    }
    return scriptCache[key];
  }
  function b64ToBuf(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const matCache = {};
  function holoMaterial(name, skinned) {
    const accent = name === "Holo_Accent", key = (accent ? "a" : "b") + (skinned ? "s" : "");
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshPhongMaterial({
        color: accent ? 0xffbf33 : 0x4fcff5, emissive: accent ? 0xff9800 : 0x07485e,
        emissiveIntensity: accent ? 0.45 : 0.32, specular: 0x9fefff, shininess: 70, skinning: skinned, side: THREE.DoubleSide,
      });
    }
    return matCache[key];
  }
  async function loadClip(key) {
    const b64 = await loadScript(key);
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(b64ToBuf(b64), "", res, rej));
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        const names = Array.isArray(o.material) ? o.material.map((m) => m.name) : [o.material && o.material.name];
        o.material = holoMaterial(names[0], !!o.isSkinnedMesh);
        o.frustumCulled = false;
      }
    });
    return { root, clip: gltf.animations[0] };
  }

  // ---------- analysis: motion curve and event markers from the clip itself ----------
  function analyse(a, root, clip, fps) {
    const mixer = new THREE.AnimationMixer(root), act = mixer.clipAction(clip);
    act.play();
    const dur = clip.duration, n = Math.round(dur * fps);
    const names = [...new Set(clip.tracks.map((t) => t.name.slice(0, t.name.lastIndexOf("."))))];
    const nodes = names.map((nm) => root.getObjectByName(nm)).filter(Boolean);
    const poses = nodes.map(() => []), ws = new THREE.Vector3();
    for (let f = 0; f < n; f++) {
      act.time = f / fps;
      mixer.update(0);
      root.updateMatrixWorld(true);
      nodes.forEach((o, k) => {
        ws.setFromMatrixScale(o.matrixWorld);
        poses[k].push([o.position.clone(), o.quaternion.clone(), o.scale.clone(), Math.max(ws.x, ws.y, ws.z)]);
      });
    }
    // movement per frame: translation + rotation (rad x 0.1) + scale change (x 0.1); frame 0 compares with the last.
    // Effects rest at scale ~0 when off: a hidden part that moves is not seen, only its appearing/vanishing counts.
    const curves = poses.map((p) => {
      const big = Math.max(...p.map((x) => x[3])) || 1, hidden = (x) => x[3] < 0.02 * big;
      return p.map((cur, f) => {
        const prev = p[(f - 1 + n) % n];
        const ds = (Math.abs(cur[2].x - prev[2].x) + Math.abs(cur[2].y - prev[2].y) + Math.abs(cur[2].z - prev[2].z)) / 3;
        if (hidden(cur) && hidden(prev)) return 0;
        if (hidden(cur) || hidden(prev)) return ds * 0.1;
        const ang = 2 * Math.acos(Math.min(1, Math.abs(cur[1].dot(prev[1]))));
        return cur[0].distanceTo(prev[0]) + ang * 0.1 + ds * 0.1;
      });
    });
    // steady spinners would flatten everything: left out of the curve (their rhythm has its own rule)
    const spinning = curves.map((c) => {
      let mn = Infinity, mx = 0;
      c.forEach((v) => { mn = Math.min(mn, v); mx = Math.max(mx, v); });
      return mx > 1e-6 && mn > 0.5 * mx;
    });
    // a part that jumps back to its start at the loop (a data packet, a wake pulse) moves a lot in one frame but is
    // not a visible motion: each part is capped at 3x its own 95th percentile
    const total = new Array(n).fill(0);
    curves.forEach((c, k) => {
      if (spinning[k] || (a.exclude && a.exclude.test(nodes[k].name))) return;
      const s = c.slice().sort((p, q) => p - q), p95 = s[Math.floor(s.length * 0.95)], cap = p95 > 0 ? p95 * 3 : Infinity;
      c.forEach((v, f) => (total[f] += Math.min(v, cap)));
    });
    const sorted = total.slice().sort((p, q) => p - q), top = sorted[Math.floor(sorted.length * 0.99)] || 1;
    const motion = total.map((v) => Math.min(1, Math.pow(v / top, 0.6)));

    let markers = [];
    if (a.id === "robotica") {
      const labels = [...new Set(window.ROBOT_MARKERS.map((m) => m[1]))];
      markers = window.ROBOT_MARKERS.map(([t, label]) => ({ t, label, kind: labels.indexOf(label) }));
    } else {
      (RULES[a.id] || []).forEach(([re, label, gap], kind) => {
        const ts = [];
        nodes.forEach((o, k) => { if (!spinning[k] && re.test(o.name)) ts.push(...partEvents(poses[k], curves[k], fps)); });
        ts.sort((p, q) => p - q);
        let lastT = -Infinity;
        ts.forEach((t) => {
          if (t >= dur - 0.05 || t - lastT < gap) return;
          markers.push({ t: +t.toFixed(3), label, kind });
          lastT = t;
        });
      });
      (SPINS[a.id] || []).forEach(([re, blades, label]) => {
        const k = nodes.findIndex((o) => re.test(o.name));
        if (k < 0) return;
        const speed = curves[k].reduce((s, v) => s + v, 0) / 0.1 / dur; // rad/s
        if (speed < 1e-3) return;
        const period = (2 * Math.PI) / blades / speed;
        for (let t = 0; t < dur - 1e-6; t += period) markers.push({ t: +t.toFixed(3), label, kind: (RULES[a.id] || []).length });
      });
    }
    markers.sort((p, q) => p.t - q.t);
    markers.forEach((m, i) => (m.n = i + 1));
    // framing over the whole clip
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    for (let i = 0; i < 12; i++) {
      act.time = (i / 12) * dur;
      mixer.update(0);
      root.updateMatrixWorld(true);
      const meshes = [];
      root.traverse((o) => { if (o.isMesh) { ws.setFromMatrixScale(o.matrixWorld); meshes.push([o, Math.max(ws.x, ws.y, ws.z)]); } });
      const sc = meshes.map((m) => m[1]).sort((p, q) => p - q), med = sc[Math.floor(sc.length / 2)] || 1;
      meshes.forEach(([o, s]) => { // effects switched off (scale ~0) are not framed; scale 0 gives NaN bounds
        if (!(s > 0.05 * med)) return;
        tmp.setFromObject(o);
        if (![tmp.min.x, tmp.min.y, tmp.min.z, tmp.max.x, tmp.max.y, tmp.max.z].some((v) => !Number.isFinite(v))) box.union(tmp);
      });
    }
    act.time = 0;
    mixer.update(0);
    return { mixer, act, dur, fps, frames: n, motion, markers, box };
  }

  // events of one part: it appears (scale up from ~0), it snaps back to restart its cycle, or it starts moving
  function partEvents(p, c, fps) {
    const n = p.length, big = Math.max(...p.map((x) => x[3])) || 1, hid = (f) => p[f][3] < 0.02 * big;
    const step = [];
    for (let f = 0; f < n; f++) { const q = (f - 1 + n) % n; if (!hid(f) && !hid(q)) step.push(p[f][0].distanceTo(p[q][0])); }
    const nz = step.filter((v) => v > 1e-6).sort((x, y) => x - y), med = nz.length ? nz[Math.floor(nz.length / 2)] : 0;
    const mx = Math.max(...c), out = [];
    let below = true;
    for (let f = 0; f < n; f++) {
      const q = (f - 1 + n) % n, v = c[f];
      let fire = (hid(q) && !hid(f)) || (!hid(q) && !hid(f) && med > 0 && p[f][0].distanceTo(p[q][0]) > 5 * med);
      if (hid(f) || v < 0.05 * mx) below = true;
      else if (v > 0.15 * mx && below) { below = false; fire = true; }
      else if (fire) below = false;
      if (fire) out.push(f / fps);
    }
    return out;
  }

  function onsets(fam, fps, seconds, gap) {
    if (!fam.length) return [];
    const n = fam[0].length, tot = new Array(n).fill(0);
    fam.forEach((c) => c.forEach((v, i) => (tot[i] += v || 0)));
    const top = Math.max(...tot) || 1, out = [];
    let below = true;
    for (let i = 0; i < n; i++) {
      const t = i / fps, v = tot[i];
      if (v < 0.05 * top) below = true;
      else if (v > 0.15 * top && below) {
        below = false;
        let j = i;
        while (j < n && tot[j] > 0.15 * top) j++;
        if (t < 0.05 && j - i < 3) continue; // a one-frame pop at frame 0 is the clip resetting its parts
        if (t < seconds - 0.1 && (!out.length || t - out[out.length - 1] >= gap)) out.push(+t.toFixed(3));
      }
    }
    return out;
  }

  // ---------- renderer shared by all cards ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  let RW = 1, RH = 1;
  renderer.setSize(RW, RH, false);

  // ---------- card ----------
  const cards = [];
  let active = null;

  class Card {
    constructor(a, idx) {
      this.a = a;
      this.clipName = "hover";
      this.clips = {};
      this.t = 0;
      this.playing = true;
      this.speed = 1;
      this.loop = true;
      this.audio = null;
      this.visible = false;
      this.dirty = true;
      this.build(idx);
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xcff4ff, 0x06141b, 0.62));
      const key = new THREE.DirectionalLight(0xffffff, 0.75);
      key.position.set(2, 4, 3);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x40d9ff, 0.35);
      rim.position.set(-3, 1.5, -2.5);
      this.scene.add(rim);
      this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, 1000);
      this.controls = new THREE.OrbitControls(this.camera, this.cv);
      this.controls.enableZoom = false;
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.12;
      this.controls.addEventListener("change", () => (this.dirty = true));
    }

    build(idx) {
      const a = this.a, el = document.createElement("article");
      el.className = "card";
      el.id = a.id;
      el.innerHTML = `
        <div class="c-head">
          <span class="c-num">${String(idx + 1).padStart(2, "0")}</span>
          <div class="c-title"><b>${a.sector}</b><span>${a.object}</span></div>
          <div class="seg clipseg" role="group" aria-label="Clip">
            <button type="button" data-clip="hover" class="on">Hover</button>
            <button type="button" data-clip="idle" ${a.single ? "disabled title=\"Stessa clip dell'Hover\"" : ""}>Idle</button>
          </div>
        </div>
        <div class="view"><canvas></canvas><div class="msg">Carico il modello…</div><span class="badge"></span>
          <span class="hint">trascina per ruotare · Alt + rotella per lo zoom · doppio clic ricentra</span></div>
        <div class="transport">
          <button class="tbtn" type="button" data-act="start" title="Torna a 0 (Home)">${ICON.start}</button>
          <button class="tbtn" type="button" data-act="prev" title="Fotogramma precedente (←)">${ICON.prev}</button>
          <button class="tbtn play" type="button" data-act="toggle" title="Play / pausa (Spazio)">${ICON.pause}</button>
          <button class="tbtn" type="button" data-act="next" title="Fotogramma successivo (→)">${ICON.next}</button>
          <span class="time"><b class="t-s">0,000 s</b> <span class="t-f">f 0</span></span>
          <span class="spacer"></span>
          <div class="seg speedseg" role="group" aria-label="Velocità">
            <button type="button" data-speed="0.25">0,25×</button><button type="button" data-speed="0.5">0,5×</button><button type="button" data-speed="1" class="on">1×</button>
          </div>
          <label class="loopchk"><input type="checkbox" checked> loop</label>
        </div>
        <div class="timeline"><canvas aria-label="Timeline: clic o trascina per spostarti"></canvas></div>
        <div class="markers"></div>
        ${a.note ? `<p class="note">${a.note}</p>` : ""}
        <div class="c-foot">
          <div class="audio-info">Trascina qui un file audio per sentirlo a tempo con l'animazione.</div>
          <button class="btn small" type="button" data-act="load-audio">Carica audio</button>
          <button class="btn small" type="button" data-act="mute" hidden>Muto</button>
          <button class="btn small" type="button" data-act="drop-audio" hidden>Togli audio</button>
          <button class="btn small" type="button" data-act="csv">Scarica marker (CSV)</button>
          <input type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg" hidden>
        </div>`;
      this.el = el;
      this.cv = $(".view canvas", el);
      this.ctx2d = this.cv.getContext("2d");
      this.msg = $(".view .msg", el);
      this.badge = $(".view .badge", el);
      this.tl = $(".timeline canvas", el);
      this.tctx = this.tl.getContext("2d");
      this.playBtn = $('[data-act="toggle"]', el);
      this.tS = $(".t-s", el);
      this.tF = $(".t-f", el);
      this.mkBox = $(".markers", el);
      this.audioInfo = $(".audio-info", el);
      this.fileIn = $('input[type="file"]', el);

      el.addEventListener("pointerdown", () => setActive(this));
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const act = b.dataset.act;
        if (act === "start") this.seek(0, true);
        else if (act === "prev") this.step(-1);
        else if (act === "next") this.step(1);
        else if (act === "toggle") this.toggle();
        else if (act === "load-audio") this.fileIn.click();
        else if (act === "mute") this.setMute(!this.audio.muted);
        else if (act === "drop-audio") this.removeAudio();
        else if (act === "csv") this.downloadCsv();
        else if (b.dataset.clip) this.setClip(b.dataset.clip);
        else if (b.dataset.speed) this.setSpeed(+b.dataset.speed);
      });
      $(".loopchk input", el).addEventListener("change", (e) => (this.loop = e.target.checked));
      this.fileIn.addEventListener("change", () => this.fileIn.files[0] && this.setAudio(this.fileIn.files[0]));
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag"); });
      el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("drag"); });
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drag");
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this.setAudio(f);
      });
      this.cv.addEventListener("dblclick", () => this.frame());
      this.cv.addEventListener("wheel", (e) => {
        if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const k = Math.exp(e.deltaY * 0.0015), c = this.controls;
        const off = this.camera.position.clone().sub(c.target).multiplyScalar(k);
        const d = off.length(), r = this.radius || 1;
        if (d < r * 0.6 || d > r * 12) return;
        this.camera.position.copy(c.target).add(off);
        this.dirty = true;
      }, { passive: false });

      // timeline scrubbing (snaps to frames)
      let wasPlaying = false, scrubbing = false;
      const at = (e) => {
        const c = this.cur();
        if (!c) return 0;
        const r = this.tl.getBoundingClientRect(), x = Math.min(1, Math.max(0, (e.clientX - r.left - PADX) / (r.width - 2 * PADX)));
        return Math.round(x * c.dur * c.fps) / c.fps;
      };
      this.tl.addEventListener("pointerdown", (e) => {
        if (!this.cur()) return;
        scrubbing = true;
        wasPlaying = this.playing;
        this.pause();
        this.tl.setPointerCapture(e.pointerId);
        this.seek(at(e));
      });
      this.tl.addEventListener("pointermove", (e) => scrubbing && this.seek(at(e)));
      const end = () => { if (scrubbing) { scrubbing = false; if (wasPlaying) this.play(); } };
      this.tl.addEventListener("pointerup", end);
      this.tl.addEventListener("pointercancel", end);
      new ResizeObserver(() => { this.sizeCanvases(); this.staticLayer = null; this.dirty = true; }).observe(el);
    }

    cur() { return this.clips[this.clipName] && this.clips[this.clipName].ready ? this.clips[this.clipName] : null; }

    async ensureClip(name) {
      if (this.clips[name]) return this.clips[name].promise;
      const key = this.a.single ? this.a.id : `${this.a.id}_${name}`;
      const slot = { ready: false };
      this.clips[name] = slot;
      slot.promise = loadClip(key).then(({ root, clip }) => {
        Object.assign(slot, analyse(this.a, root, clip, this.a.fps || 30), { root, ready: true });
        root.visible = false;
        this.scene.add(root);
        if (!this.box) this.box = slot.box.clone();
        else this.box.union(slot.box);
        if (name === this.clipName) this.show();
        return slot;
      }).catch((err) => {
        this.msg.textContent = "Modello non caricato: " + err.message;
        throw err;
      });
      return slot.promise;
    }

    show() {
      const c = this.cur();
      if (!c) return;
      Object.entries(this.clips).forEach(([k, s]) => s.root && (s.root.visible = k === this.clipName));
      if (!this.framed) this.frame();
      this.msg.hidden = true;
      this.badge.textContent = `${this.clipName === "hover" ? "Hover" : "Idle"} · ${num(c.dur, 3)} s · ${c.frames} fotogrammi a ${c.fps} fps`;
      this.t = Math.min(this.t, c.dur);
      this.staticLayer = null;
      this.renderMarkers();
      this.apply();
    }

    frame() {
      const b = this.box;
      if (!b) return;
      const ctr = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
      const r = Math.max(size.length() / 2, 1e-3);
      this.radius = r;
      // fit height and width of the whole clip's bounds in a 16:9 view, plus half the depth
      const tn = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), wide = Math.max(size.x, size.z) / 2;
      const dist = (Math.max(size.y / 2 / tn, wide / (tn * 16 / 9)) + wide * 0.6) * 1.05 * (this.a.zoom || 1);
      const dir = new THREE.Vector3(0.55, 0.32, 1).normalize();
      if (this.a.yaw) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(this.a.yaw));
      this.camera.position.copy(ctr).addScaledVector(dir, dist);
      this.camera.near = dist / 100;
      this.camera.far = dist * 20;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(ctr);
      this.controls.update();
      if (!this.grid) {
        this.grid = new THREE.PolarGridHelper(r * 0.9, 12, 4, 64, 0x1d3a46, 0x15262e);
        this.scene.add(this.grid);
      }
      this.grid.position.set(ctr.x, b.min.y, ctr.z);
      this.framed = true;
      this.dirty = true;
    }

    async setClip(name) {
      if (this.a.single && name === "idle") return;
      this.clipName = name;
      $(".clipseg", this.el).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.clip === name));
      if (!this.clips[name] || !this.clips[name].ready) {
        this.msg.hidden = false;
        this.msg.textContent = "Carico la clip…";
      }
      this.t = 0;
      await this.ensureClip(name).catch(() => null);
      if (this.clipName === name) { this.show(); this.restartAudio(); this.refreshAudioInfo(); }
    }

    apply() {
      const c = this.cur();
      if (!c) return;
      c.act.time = Math.min(this.t, c.dur - 1e-6);
      c.mixer.update(0);
      const f = Math.min(c.frames - 1, Math.floor(this.t * c.fps + 1e-4));
      this.tS.textContent = num(this.t) + " s";
      this.tF.textContent = `f ${f} / ${c.frames}`;
      this.dirty = true;
    }

    tick(dt) {
      const c = this.cur();
      if (!c || !this.playing) return;
      this.t += dt * this.speed;
      if (this.t >= c.dur) {
        if (this.loop) { this.t %= c.dur; this.restartAudio(); }
        else { this.t = c.dur; this.pause(); }
      }
      this.apply();
    }

    play() {
      const c = this.cur();
      if (c && !this.loop && this.t >= c.dur - 1e-6) this.t = 0;
      this.playing = true;
      this.playBtn.innerHTML = ICON.pause;
      this.restartAudio();
    }
    pause() { this.playing = false; this.playBtn.innerHTML = ICON.play; this.stopAudio(); }
    toggle() { if (this.playing) this.pause(); else { ensureAudio(); this.play(); } }
    seek(t, keep) {
      const c = this.cur();
      if (!c) return;
      this.t = Math.max(0, Math.min(t, c.dur - 1e-6));
      this.apply();
      if (this.playing) this.restartAudio();
      else if (!keep) this.stopAudio();
    }
    step(n) {
      const c = this.cur();
      if (!c) return;
      this.pause();
      let f = Math.round(this.t * c.fps) + n;
      f = ((f % c.frames) + c.frames) % c.frames;
      this.seek(f / c.fps);
    }
    setSpeed(s) {
      this.speed = s;
      $(".speedseg", this.el).querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.speed === s));
      this.restartAudio();
    }

    // ---- test audio ----
    async setAudio(file) {
      const ctx = ensureAudio();
      if (!ctx) { this.audioInfo.textContent = "Questo browser non riproduce audio Web Audio."; return; }
      this.audioInfo.textContent = "Leggo " + file.name + "…";
      try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        this.stopAudio();
        const gain = ctx.createGain();
        gain.connect(master);
        this.audio = { name: file.name, buffer: buf, gain, muted: false, src: null, peaks: peaksOf(buf) };
        $('[data-act="mute"]', this.el).hidden = false;
        $('[data-act="drop-audio"]', this.el).hidden = false;
        this.refreshAudioInfo();
        this.staticLayer = null;
        this.dirty = true;
        this.restartAudio();
      } catch (err) {
        this.audioInfo.textContent = "Non riesco a leggere " + file.name + " (" + err.message + ").";
      }
    }
    refreshAudioInfo() {
      const au = this.audio, c = this.cur();
      if (!au) return;
      let fit = "";
      if (c) {
        const d = au.buffer.duration - c.dur;
        fit = Math.abs(d) < 0.0015
          ? ' · <span class="ok">stessa durata della clip</span>'
          : ` · <span class="bad">${d > 0 ? "più lungo" : "più corto"} della clip di ${num(Math.abs(d))} s</span>`;
      }
      this.audioInfo.innerHTML = `<b>${escapeHtml(au.name)}</b> · ${num(au.buffer.duration)} s · ${au.buffer.sampleRate / 1000} kHz${fit}${au.muted ? " · muto" : ""}`;
    }
    setMute(m) {
      if (!this.audio) return;
      this.audio.muted = m;
      this.audio.gain.gain.value = m ? 0 : 1;
      $('[data-act="mute"]', this.el).textContent = m ? "Riattiva" : "Muto";
      this.refreshAudioInfo();
    }
    removeAudio() {
      this.stopAudio();
      if (this.audio) this.audio.gain.disconnect();
      this.audio = null;
      $('[data-act="mute"]', this.el).hidden = true;
      $('[data-act="drop-audio"]', this.el).hidden = true;
      this.audioInfo.textContent = "Trascina qui un file audio per sentirlo a tempo con l'animazione.";
      this.staticLayer = null;
      this.dirty = true;
    }
    stopAudio() {
      if (this.audio && this.audio.src) {
        try { this.audio.src.stop(); } catch (e) { /* already stopped */ }
        this.audio.src.disconnect();
        this.audio.src = null;
      }
    }
    restartAudio() {
      this.stopAudio();
      const au = this.audio;
      if (!au || !this.playing || !actx || this.t >= au.buffer.duration) return;
      const src = actx.createBufferSource();
      src.buffer = au.buffer;
      src.playbackRate.value = this.speed;
      src.connect(au.gain);
      src.start(0, this.t);
      au.src = src;
    }

    downloadCsv() {
      const c = this.cur();
      if (!c) return;
      const rows = ["n;secondi;fotogramma;evento"].concat(
        c.markers.map((m) => `${m.n};${num(m.t)};${Math.round(m.t * c.fps)};${m.label}`));
      rows.push(`;${num(c.dur)};${c.frames};fine clip (loop)`);
      const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${this.a.id}_${this.a.single ? "clip" : this.clipName}_marker.csv`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 500);
    }

    renderMarkers() {
      const c = this.cur();
      if (!c) return;
      // one row per event type: colour, name, then its times (click = jump there)
      const groups = new Map();
      c.markers.forEach((m) => {
        if (!groups.has(m.label)) groups.set(m.label, { kind: m.kind, ts: [] });
        groups.get(m.label).ts.push(m.t);
      });
      this.mkBox.innerHTML = groups.size
        ? [...groups].map(([label, g]) => `<div class="mkrow"><span class="mkname"><i style="background:${COLORS[g.kind % COLORS.length]}"></i>${label}</span>${
            g.ts.map((t) => `<button class="mt" type="button" data-t="${t}" title="Vai a ${num(t)} s, fotogramma ${Math.round(t * c.fps)}">${num(t, 2)}</button>`).join("")}</div>`).join("")
        : '<span class="nomk">Nessun evento puntuale: il movimento è continuo (vedi la curva).</span>';
      this.mkBox.querySelectorAll(".mt").forEach((b) => b.addEventListener("click", () => { this.pause(); this.seek(+b.dataset.t); }));
    }

    // ---- drawing ----
    sizeCanvases() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const v = this.cv.getBoundingClientRect(), t = this.tl.getBoundingClientRect();
      const vw = Math.max(1, Math.round(v.width * dpr)), vh = Math.max(1, Math.round(v.height * dpr));
      if (this.cv.width !== vw || this.cv.height !== vh) { this.cv.width = vw; this.cv.height = vh; }
      const tw = Math.max(1, Math.round(t.width * dpr)), th = Math.max(1, Math.round(t.height * dpr));
      if (this.tl.width !== tw || this.tl.height !== th) { this.tl.width = tw; this.tl.height = th; }
      this.dpr = dpr;
    }

    draw3d() {
      const w = this.cv.width, h = this.cv.height;
      if (w < 2 || h < 2 || !this.cur()) return;
      if (w > RW || h > RH) { RW = Math.max(RW, w); RH = Math.max(RH, h); renderer.setSize(RW, RH, false); }
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      renderer.setViewport(0, RH - h, w, h);
      renderer.setScissor(0, RH - h, w, h);
      renderer.setScissorTest(true);
      renderer.setClearColor(STAGE, 1);
      renderer.render(this.scene, this.camera);
      this.ctx2d.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
    }

    drawTimeline() {
      const c = this.cur(), cv = this.tl, g = this.tctx, W = cv.width, H = cv.height, d = this.dpr || 1;
      if (!c || W < 2) return;
      if (!this.staticLayer || this.staticLayer.width !== W || this.staticLayer.height !== H) this.staticLayer = this.buildStatic(c, W, H, d);
      g.clearRect(0, 0, W, H);
      g.drawImage(this.staticLayer, 0, 0);
      const x = PADX * d + (this.t / c.dur) * (W - 2 * PADX * d);
      g.fillStyle = "rgba(255,255,255,.95)";
      g.fillRect(Math.round(x) - d * 0.75, 0, d * 1.5, H);
      g.beginPath();
      g.moveTo(x - 5 * d, 0); g.lineTo(x + 5 * d, 0); g.lineTo(x, 7 * d); g.closePath();
      g.fill();
    }

    buildStatic(c, W, H, d) {
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const g = cv.getContext("2d");
      const x0 = PADX * d, iw = W - 2 * PADX * d, X = (t) => x0 + (t / c.dur) * iw;
      const RULER = 18 * d, DOTS = 30 * d, MOT = 44 * d, AUD = H - RULER - DOTS - MOT, M0 = RULER + DOTS;
      g.font = `${10 * d}px "IBM Plex Mono", Consolas, monospace`;
      g.textBaseline = "top";
      // lanes
      g.fillStyle = "#121b21"; g.fillRect(0, 0, W, RULER);
      g.fillStyle = "#0f171c"; g.fillRect(0, M0 + MOT, W, AUD);
      g.fillStyle = "#141f25"; g.fillRect(0, RULER, W, DOTS);
      // frame ticks, half-seconds, seconds
      const pxF = iw / c.frames;
      g.fillStyle = "#2a3b45";
      if (pxF >= 3 * d) for (let f = 0; f <= c.frames; f++) g.fillRect(Math.round(X(f / c.fps)), RULER - 4 * d, d, 4 * d);
      const step = c.dur > 9 ? 1 : 0.5;
      for (let k = 0; k / 10 <= c.dur + 1e-6; k++) {
        const t = k / 10, major = k % (step * 10) === 0;
        g.fillStyle = major ? "#5f7681" : "#33464f";
        g.fillRect(Math.round(X(t)), major ? 2 * d : RULER - 7 * d, d, major ? RULER - 2 * d : 7 * d);
        if (major && t < c.dur - 0.2 && (k % 10 === 0 || (iw / c.dur) * step >= 34 * d)) { g.fillStyle = "#8ea2ab"; g.fillText(num(t, k % 10 ? 1 : 0) + "s", X(t) + 3 * d, 3 * d); }
        g.fillStyle = "rgba(255,255,255,.035)";
        if (major) g.fillRect(Math.round(X(t)), RULER, d, H - RULER);
      }
      // motion curve
      const base = M0 + MOT - 3 * d, amp = MOT - 7 * d;
      g.beginPath();
      g.moveTo(X(0), base);
      c.motion.forEach((v, f) => g.lineTo(X(f / c.fps), base - v * amp));
      g.lineTo(X(c.dur), base - c.motion[0] * amp);
      g.lineTo(X(c.dur), base);
      g.closePath();
      g.fillStyle = "rgba(64,217,255,.20)";
      g.fill();
      g.strokeStyle = "rgba(64,217,255,.85)";
      g.lineWidth = 1.2 * d;
      g.beginPath();
      c.motion.forEach((v, f) => (f ? g.lineTo : g.moveTo).call(g, X(f / c.fps), base - v * amp));
      g.lineTo(X(c.dur), base - c.motion[0] * amp);
      g.stroke();
      g.fillStyle = "#587079";
      g.textBaseline = "bottom";
      g.fillText("movimento", 6 * d, M0 + MOT - 2 * d);
      g.textBaseline = "top";
      // audio lane
      const mid = M0 + MOT + AUD / 2;
      if (this.audio) {
        const p = this.audio.peaks, dur = this.audio.buffer.duration;
        g.fillStyle = "rgba(255,191,51,.75)";
        for (let px = 0; px < iw; px += d) {
          const t = (px / iw) * c.dur;
          if (t > dur) break;
          const v = p[Math.min(p.length - 1, Math.floor((t / dur) * p.length))];
          const hh = Math.max(d, v * (AUD / 2 - 3 * d));
          g.fillRect(x0 + px, mid - hh, d, hh * 2);
        }
        if (dur < c.dur) { g.fillStyle = "rgba(255,138,107,.9)"; g.fillRect(Math.round(X(dur)), M0 + MOT, 1.5 * d, AUD); }
      } else {
        g.fillStyle = "#3d525c";
        g.textBaseline = "middle";
        g.fillText("audio: trascina un file sulla scheda", 6 * d, mid);
        g.textBaseline = "top";
      }
      // markers: one row of dots per event type, so close events of different types stay readable
      const kinds = [...new Set(c.markers.map((m) => m.kind))], rows = kinds.length <= 5;
      const nRows = rows ? kinds.length : 1, rowH = (DOTS - 4 * d) / nRows, rad = Math.min(3.4 * d, rowH * 0.42);
      c.markers.forEach((m) => {
        const x = Math.round(X(m.t)), col = COLORS[m.kind % COLORS.length], row = rows ? kinds.indexOf(m.kind) : 0;
        g.fillStyle = col;
        g.globalAlpha = 0.55;
        g.fillRect(x, RULER, d, H - RULER);
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(x + d / 2, RULER + 2 * d + (row + 0.5) * rowH, rad, 0, Math.PI * 2);
        g.fill();
      });
      // loop end
      g.fillStyle = "#40d9ff";
      g.fillRect(Math.round(X(c.dur)) - d, RULER, 2 * d, H - RULER);
      return cv;
    }
  }

  const PADX = 10;
  function peaksOf(buf) {
    const ch = buf.getChannelData(0), n = 2000, out = new Float32Array(n), per = Math.max(1, Math.floor(ch.length / n));
    let mx = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * per, e = Math.min(ch.length, j + per); j < e; j++) m = Math.max(m, Math.abs(ch[j]));
      out[i] = m;
      mx = Math.max(mx, m);
    }
    if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
    return out;
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]); }
  function setActive(card) {
    if (active === card) return;
    if (active) active.el.classList.remove("active");
    active = card;
    card.el.classList.add("active");
  }

  // ---------- page ----------
  const grid = $("#grid");
  A.forEach((a, i) => { const c = new Card(a, i); cards.push(c); grid.appendChild(c.el); });
  const io = new IntersectionObserver((ents) => ents.forEach((e) => {
    const c = cards.find((k) => k.el === e.target);
    if (c) { c.visible = e.isIntersecting; c.dirty = true; }
  }), { rootMargin: "200px" });
  cards.forEach((c) => { io.observe(c.el); c.sizeCanvases(); });
  window.activators = cards; // handy from the console

  // load all Hover clips (a few at a time), then the Idle ones in the background
  (async () => {
    const queue = cards.slice();
    const worker = async () => { while (queue.length) { const c = queue.shift(); await c.ensureClip("hover").catch(() => null); } };
    await Promise.all([worker(), worker(), worker()]);
    for (const c of cards) if (!c.a.single) await c.ensureClip("idle").catch(() => null);
  })();

  // top bar
  $("#all-play").addEventListener("click", () => { ensureAudio(); cards.forEach((c) => c.play()); });
  $("#all-pause").addEventListener("click", () => cards.forEach((c) => c.pause()));
  $("#all-zero").addEventListener("click", () => cards.forEach((c) => c.seek(0, true)));
  document.querySelectorAll("#all-clip button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#all-clip button").forEach((x) => x.classList.toggle("on", x === b));
    cards.forEach((c) => c.setClip(c.a.single ? "hover" : b.dataset.clip));
  }));
  document.querySelectorAll("#all-speed button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#all-speed button").forEach((x) => x.classList.toggle("on", x === b));
    cards.forEach((c) => c.setSpeed(+b.dataset.speed));
  }));

  // keyboard on the active card
  document.addEventListener("keydown", (e) => {
    if (!active || e.target.closest("input, textarea, select")) return;
    if (e.code === "Space") { e.preventDefault(); active.toggle(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); active.step(e.shiftKey ? -10 : -1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); active.step(e.shiftKey ? 10 : 1); }
    else if (e.key === "Home") { e.preventDefault(); active.seek(0, true); }
  });
  document.addEventListener("keyup", (e) => { if (e.code === "Space" && e.target.closest("button")) e.preventDefault(); });
  document.addEventListener("pointerdown", ensureAudio, { once: true });

  // loop
  let last = clock();
  function loop() {
    const now = clock();
    let dt = now - last;
    last = now;
    const resync = dt > 0.1;
    if (dt < 0 || dt > 0.25) dt = 0;
    for (const c of cards) {
      c.tick(dt);
      if (resync && c.playing) c.restartAudio();
      if (c.controls.enableDamping && c.visible) c.controls.update();
      if (c.visible && (c.dirty || c.playing)) { c.sizeCanvases(); c.draw3d(); c.drawTimeline(); c.dirty = false; }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
