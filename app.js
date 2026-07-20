(() => {
  'use strict';

  // ---------- config ----------
  const OLLAMA_URL = 'http://localhost:11434';
  const STORAGE_KEY = 'orbital-tasks-v1';

  const MAX_AGE_DAYS = 5;     // days to reach the fully "grown" planet size
  const SUN_RADIUS = 42;      // px, matches #sun's 84px width in CSS

  const PALETTE = [
    ['#ff9d6c', '#c24b1f'], ['#6ec6ff', '#1f5fa8'], ['#a685ff', '#5c33b8'],
    ['#7de3a8', '#1f8a54'], ['#ffd166', '#c98a13'], ['#ff6c9c', '#b8225c'],
    ['#7ad8d8', '#1f8484'], ['#f0f0f0', '#8a8a8a'],
  ];

  // ---------- state ----------
  let tasks = loadTasks();
  let ollamaOk = false;
  let selectedTaskId = null;
  let orbitingPlanets = []; // { el, radius, angleOffset, periodMs, direction }
  let minRadius = 75;
  let maxRadius = 340;
  let minPlanet = 16;
  let maxPlanet = 52;
  let orbitClockOffset = 0; // subtracted from performance.now() to get orbit-time
  let orbitFrozenAt = null; // if set, orbits are paused and frozen at this orbit-time

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const orbitRoot = $('orbit-root');
  const sunCount = $('sun-count');
  const logPanel = $('log-panel');
  const logToggle = $('log-toggle');
  const logList = $('log-list');
  const ollamaDot = $('ollama-dot');
  const ollamaText = $('ollama-text');
  const modelSelect = $('model-select');
  const rankBtn = $('rank-btn');
  const addBtn = $('add-btn');
  const addModal = $('add-modal');
  const addTitle = $('add-title');
  const addNotes = $('add-notes');
  const detailModal = $('detail-modal');
  const toast = $('toast');
  const moveUpBtn = $('detail-move-up');
  const moveDownBtn = $('detail-move-down');
  const completeBtn = $('detail-complete');

  // ---------- local storage ----------
  function loadTasks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function persistTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  // ---------- helpers ----------
  function ageDays(createdAt) {
    return (Date.now() - new Date(createdAt).getTime()) / 86400000;
  }

  function planetSize(task) {
    const frac = Math.min(1, ageDays(task.createdAt) / MAX_AGE_DAYS);
    return Math.round(minPlanet + (maxPlanet - minPlanet) * frac);
  }

  function hashOf(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return hash;
  }

  function colorFor(id) {
    return PALETTE[hashOf(id) % PALETTE.length];
  }

  function showToast(msg, ms = 3200) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  function fmtAge(days) {
    const hours = days * 24;
    if (hours < 1) return '<1hr old';
    if (days < 1) return `${Math.round(hours)}h old`;
    return `${Math.floor(days)}d old`;
  }

  function getOrderedActive() {
    const active = tasks.filter((t) => !t.completed);
    const ranked = active
      .filter((t) => t.importanceRank !== null && t.importanceRank !== undefined)
      .sort((a, b) => a.importanceRank - b.importanceRank);
    const unranked = active
      .filter((t) => t.importanceRank === null || t.importanceRank === undefined)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return [...ranked, ...unranked];
  }

  // ---------- layout ----------
  // Derives both radii from the actual viewport so the whole system - every
  // orbit ring included - always fits without clipping. The inner radius
  // scales down with the outer one on small screens instead of using a fixed
  // floor, which would otherwise push the outer ring past the safe area.
  function computeRadii() {
    const topInset = 100;    // topbar + legend
    const bottomInset = 110; // add button / task list panel
    const sideInset = 50;
    const availW = window.innerWidth - sideInset * 2;
    const availH = window.innerHeight - topInset - bottomInset;
    const outerRaw = Math.max(60, Math.min(availW, availH) / 2 - 40); // room for planet size + tooltip
    const inner = Math.max(46, Math.min(75, outerRaw * 0.3)); // 46 keeps the closest orbit clear of the sun
    const outer = Math.max(inner + 30, Math.min(outerRaw, 620));
    return { inner, outer };
  }

  // Scales planet size with the same system size the orbits use, so planets
  // grow on a roomy window and shrink on a tight one instead of staying a
  // fixed pixel size. Also capped so the largest planet never overlaps the
  // sun or a neighboring orbit.
  function computePlanetSizeRange(innerR, outerR, step, count) {
    const sizeScale = Math.max(0.5, Math.min(1.8, outerR / 340));
    let minP = Math.max(10, Math.min(30, 16 * sizeScale));
    let maxP = Math.max(24, Math.min(96, 52 * sizeScale));

    const sunClearance = (innerR - SUN_RADIUS - 8) * 2;
    maxP = Math.min(maxP, sunClearance);
    if (count > 1) maxP = Math.min(maxP, step * 1.6);
    maxP = Math.max(maxP, minP);

    return { minPlanet: minP, maxPlanet: maxP };
  }

  // ---------- starfield ----------
  function buildStarfield() {
    const field = $('starfield');
    const n = 160;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      const size = Math.random() * 2 + 0.5;
      s.style.width = `${size}px`;
      s.style.height = `${size}px`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.setProperty('--base-op', String(Math.random() * 0.6 + 0.3));
      s.style.animationDelay = `${Math.random() * 3.5}s`;
      frag.appendChild(s);
    }
    field.appendChild(frag);
  }

  // ---------- ollama ----------
  async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  async function refreshOllamaStatus() {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 3000);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name);
      ollamaOk = true;
      ollamaDot.className = 'dot dot-ok';
      ollamaText.textContent = 'Ollama connected';
      modelSelect.innerHTML = '';
      if (models.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'no models pulled';
        modelSelect.appendChild(opt);
        rankBtn.disabled = true;
      } else {
        models.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          modelSelect.appendChild(opt);
        });
        const preferred = models.find((m) => m.startsWith('llama3.2')) || models[0];
        modelSelect.value = preferred;
        rankBtn.disabled = false;
      }
    } catch {
      ollamaOk = false;
      ollamaDot.className = 'dot dot-bad';
      ollamaText.textContent = 'Ollama unreachable — see README';
      modelSelect.innerHTML = '<option>unavailable</option>';
      rankBtn.disabled = true;
    }
  }

  async function rankWithOllama(model, activeTasks) {
    const payload = activeTasks.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      ageDays: Math.round(ageDays(t.createdAt) * 10) / 10,
    }));

    const system = `You are a ranking engine for a todo list. You will be given a JSON array of tasks, each with an id, title, optional notes, and how many days old the task is (ageDays).
Rank the tasks by TRUE IMPORTANCE AND URGENCY, considering: stated deadlines or time pressure in the title/notes, consequences of not doing it, dependencies mentioned, and general priority language (e.g. "urgent", "asap", "later", "someday"). Age alone is not importance - an old low-stakes task is still low priority.
Respond with ONLY a JSON object of the exact form {"ranking": ["id1","id2",...]} listing every single id given to you exactly once, ordered from MOST important first to LEAST important last. No explanation, no markdown, no extra keys.`;

    const res = await fetchWithTimeout(
      `${OLLAMA_URL}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      45000
    );

    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = await res.json();
    const content = data?.message?.content ?? '';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse Ollama ranking response');
      parsed = { ranking: JSON.parse(match[0]) };
    }

    let ranking = Array.isArray(parsed) ? parsed : parsed.ranking;
    if (!Array.isArray(ranking)) throw new Error('Ollama response missing ranking array');

    const validIds = new Set(activeTasks.map((t) => t.id));
    ranking = ranking.filter((id) => validIds.has(id));
    for (const t of activeTasks) {
      if (!ranking.includes(t.id)) ranking.push(t.id);
    }
    return ranking;
  }

  async function runRank() {
    if (!ollamaOk || !modelSelect.value) return;
    const active = tasks.filter((t) => !t.completed);
    if (active.length === 0) return;
    rankBtn.disabled = true;
    rankBtn.textContent = 'Scanning system…';
    try {
      const ranking = await rankWithOllama(modelSelect.value, active);
      ranking.forEach((id, index) => {
        const task = tasks.find((t) => t.id === id);
        if (task) task.importanceRank = index;
      });
      persistTasks();
      render();
      if (selectedTaskId) {
        const task = tasks.find((t) => t.id === selectedTaskId);
        if (task) updateDetailMeta(task);
      }
      showToast('Orbits recalculated by AI priority.');
    } catch (err) {
      const sorted = [...active].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      sorted.forEach((t, index) => {
        const task = tasks.find((x) => x.id === t.id);
        if (task) task.importanceRank = index;
      });
      persistTasks();
      render();
      showToast(`AI ranking failed (${err.message}) — used fallback order.`);
    } finally {
      rankBtn.disabled = false;
      rankBtn.textContent = 'Rank with AI';
    }
  }

  // ---------- task CRUD (local only) ----------
  function addTask(title, notes) {
    tasks.push({
      id: crypto.randomUUID(),
      title: title.trim().slice(0, 200),
      notes: notes.trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null,
      importanceRank: null,
    });
    persistTasks();
  }
  function updateTask(id, patch) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (patch.title !== undefined) task.title = patch.title.trim().slice(0, 200);
    if (patch.notes !== undefined) task.notes = patch.notes.trim().slice(0, 2000);
    if (patch.completed !== undefined) {
      task.completed = patch.completed;
      task.completedAt = patch.completed ? new Date().toISOString() : null;
    }
    persistTasks();
  }
  function deleteTask(id) {
    tasks = tasks.filter((t) => t.id !== id);
    persistTasks();
  }
  function moveTask(id, direction) {
    const order = getOrderedActive();
    const idx = order.findIndex((t) => t.id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= order.length) return;
    [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
    order.forEach((t, i) => { t.importanceRank = i; });
    persistTasks();
  }

  // ---------- rendering ----------
  function render() {
    ({ inner: minRadius, outer: maxRadius } = computeRadii());
    [...orbitRoot.querySelectorAll('.orbit-ring, .planet')].forEach((el) => el.remove());
    orbitingPlanets = [];

    const order = getOrderedActive();
    sunCount.textContent = String(order.length);

    const count = order.length;
    const step = count > 1 ? (maxRadius - minRadius) / (count - 1) : 0;
    ({ minPlanet, maxPlanet } = computePlanetSizeRange(minRadius, maxRadius, step, count));

    order.forEach((task, i) => {
      const radius = count === 1 ? (minRadius + maxRadius) / 2 : minRadius + step * i;
      addOrbit(radius);
      addPlanet(task, radius);
    });

    renderTaskList();
  }

  function addOrbit(radius) {
    const ring = document.createElement('div');
    ring.className = 'orbit-ring';
    ring.style.width = `${radius * 2}px`;
    ring.style.height = `${radius * 2}px`;
    orbitRoot.appendChild(ring);
  }

  function addPlanet(task, radius) {
    const size = planetSize(task);
    const [c1, c2] = colorFor(task.id);
    const hash = hashOf(task.id);

    const planet = document.createElement('div');
    planet.className = 'planet' + (task.importanceRank == null ? ' unranked' : '');
    planet.style.width = `${size}px`;
    planet.style.height = `${size}px`;
    planet.style.background = `radial-gradient(circle at 32% 28%, ${c1}, ${c2})`;
    planet.dataset.id = task.id;
    planet.dataset.title = `${task.title} — ${fmtAge(ageDays(task.createdAt))}${task.importanceRank != null ? ` — priority #${task.importanceRank + 1}` : ' — unranked'}`;
    planet.addEventListener('click', () => openDetail(task.id));
    orbitRoot.appendChild(planet);

    const entry = {
      el: planet,
      radius,
      angleOffset: (hash % 360) * (Math.PI / 180),
      periodMs: (14 + radius * 0.12) * 1000, // closer orbits move faster
      direction: hash % 2 === 0 ? 1 : -1,
    };
    orbitingPlanets.push(entry);
    positionPlanet(entry, orbitNow());
  }

  function positionPlanet(entry, now) {
    const angle = entry.angleOffset + entry.direction * (now / entry.periodMs) * Math.PI * 2;
    const x = Math.cos(angle) * entry.radius;
    const y = Math.sin(angle) * entry.radius;
    entry.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  // Orbit-time clock that can be frozen and resumed without any position
  // jump - used to stop planets moving while a task's popup is open.
  function orbitNow() {
    return orbitFrozenAt !== null ? orbitFrozenAt : performance.now() - orbitClockOffset;
  }
  function pauseOrbits() {
    if (orbitFrozenAt !== null) return;
    orbitFrozenAt = orbitNow();
  }
  function resumeOrbits() {
    if (orbitFrozenAt === null) return;
    orbitClockOffset = performance.now() - orbitFrozenAt;
    orbitFrozenAt = null;
  }

  function tick() {
    const now = orbitNow();
    for (const entry of orbitingPlanets) {
      if (entry.el.classList.contains('dying')) continue;
      positionPlanet(entry, now);
    }
    requestAnimationFrame(tick);
  }

  function renderTaskList() {
    const active = getOrderedActive();
    const completed = tasks
      .filter((t) => t.completed)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 15);

    logList.innerHTML = '';
    if (active.length === 0 && completed.length === 0) {
      logList.innerHTML = '<li class="log-empty">No tasks yet.</li>';
      return;
    }

    active.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t.title;
      li.title = t.title;
      li.addEventListener('click', () => openDetail(t.id));
      logList.appendChild(li);
    });
    completed.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'log-completed';
      li.textContent = t.title;
      li.title = t.title;
      li.addEventListener('click', () => openDetail(t.id));
      logList.appendChild(li);
    });
  }

  // ---------- modals: add ----------
  function openAdd() {
    addTitle.value = '';
    addNotes.value = '';
    addModal.classList.remove('hidden');
    addTitle.focus();
  }
  function closeAdd() {
    addModal.classList.add('hidden');
  }
  function submitAdd() {
    const title = addTitle.value.trim();
    if (!title) {
      addTitle.focus();
      return;
    }
    addTask(title, addNotes.value.trim());
    closeAdd();
    render();
    showToast('Task launched — asking AI to rank it…');
    runRank();
  }

  // ---------- modals: detail ----------
  function updateDetailMeta(task) {
    if (task.completed) {
      $('detail-meta').textContent = `Completed · ${fmtAge(ageDays(task.createdAt))} · done ${new Date(task.completedAt).toLocaleString()}`;
      moveUpBtn.disabled = true;
      moveDownBtn.disabled = true;
      completeBtn.disabled = true;
      completeBtn.textContent = 'Completed';
      return;
    }
    completeBtn.disabled = false;
    completeBtn.textContent = 'Mark Complete';
    const order = getOrderedActive();
    const idx = order.findIndex((t) => t.id === task.id);
    const rankText = task.importanceRank != null ? `Priority #${idx + 1} of ${order.length}` : 'Not yet ranked';
    $('detail-meta').textContent = `${rankText} · ${fmtAge(ageDays(task.createdAt))} · created ${new Date(task.createdAt).toLocaleString()}`;
    moveUpBtn.disabled = idx <= 0;
    moveDownBtn.disabled = idx === -1 || idx >= order.length - 1;
  }

  function openDetail(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    selectedTaskId = id;
    $('detail-title-header').textContent = 'Task detail';
    $('detail-title').value = task.title;
    $('detail-notes').value = task.notes || '';
    updateDetailMeta(task);
    detailModal.classList.remove('hidden');
    pauseOrbits();
  }
  function closeDetail() {
    detailModal.classList.add('hidden');
    selectedTaskId = null;
    resumeOrbits();
  }
  function saveDetail() {
    if (!selectedTaskId) return;
    updateTask(selectedTaskId, { title: $('detail-title').value.trim(), notes: $('detail-notes').value.trim() });
    closeDetail();
    render();
  }
  function completeDetail() {
    if (!selectedTaskId) return;
    const planetEl = document.querySelector(`.planet[data-id="${selectedTaskId}"]`);
    if (planetEl) planetEl.classList.add('dying');
    updateTask(selectedTaskId, { completed: true });
    closeDetail();
    setTimeout(render, planetEl ? 480 : 0);
    showToast('Task complete. Logged to task list.');
  }
  function deleteDetail() {
    if (!selectedTaskId) return;
    deleteTask(selectedTaskId);
    closeDetail();
    render();
  }
  function moveDetail(direction) {
    if (!selectedTaskId) return;
    moveTask(selectedTaskId, direction);
    render();
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (task) updateDetailMeta(task);
  }

  // ---------- wiring ----------
  addBtn.addEventListener('click', openAdd);
  $('add-cancel').addEventListener('click', closeAdd);
  $('add-submit').addEventListener('click', submitAdd);
  addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAdd(); });
  addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

  $('detail-close').addEventListener('click', closeDetail);
  $('detail-save').addEventListener('click', saveDetail);
  completeBtn.addEventListener('click', completeDetail);
  $('detail-delete').addEventListener('click', deleteDetail);
  detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });
  moveUpBtn.addEventListener('click', () => moveDetail(-1));
  moveDownBtn.addEventListener('click', () => moveDetail(1));

  rankBtn.addEventListener('click', () => runRank());

  logToggle.addEventListener('click', () => {
    logList.classList.toggle('collapsed');
    logPanel.classList.toggle('open', !logList.classList.contains('collapsed'));
    if (!logList.classList.contains('collapsed')) renderTaskList();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAdd(); closeDetail(); }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  // ---------- init ----------
  buildStarfield();
  refreshOllamaStatus();
  render();
  requestAnimationFrame(tick);
  setInterval(render, 30000);
  setInterval(refreshOllamaStatus, 20000);
})();
