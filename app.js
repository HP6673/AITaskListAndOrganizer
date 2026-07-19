(() => {
  'use strict';

  // ---------- config ----------
  const OLLAMA_URL = 'http://localhost:11434';
  const STORAGE_KEY = 'orbital-tasks-v1';

  const MIN_RADIUS = 75;      // px, closest orbit to the sun
  const MAX_RADIUS = 340;     // px, outer edge of the system
  const MIN_PLANET = 16;      // px, freshly created task
  const MAX_PLANET = 52;      // px, fully "grown" task
  const MAX_AGE_DAYS = 5;     // days to reach MAX_PLANET size

  const PALETTE = [
    ['#ff9d6c', '#c24b1f'], ['#6ec6ff', '#1f5fa8'], ['#a685ff', '#5c33b8'],
    ['#7de3a8', '#1f8a54'], ['#ffd166', '#c98a13'], ['#ff6c9c', '#b8225c'],
    ['#7ad8d8', '#1f8484'], ['#f0f0f0', '#8a8a8a'],
  ];

  // ---------- state ----------
  let tasks = loadTasks();
  let ollamaOk = false;
  let selectedTaskId = null;

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const orbitRoot = $('orbit-root');
  const sunCount = $('sun-count');
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
    return Math.round(MIN_PLANET + (MAX_PLANET - MIN_PLANET) * frac);
  }

  function colorFor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  function showToast(msg, ms = 3200) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  function fmtAge(days) {
    if (days < 1) {
      const h = Math.max(1, Math.round(days * 24));
      return `${h}h old`;
    }
    return `${Math.floor(days)}d old`;
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
    if (active.length === 0) {
      showToast('No active tasks to rank.');
      return;
    }
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

  // ---------- rendering ----------
  function render() {
    [...orbitRoot.querySelectorAll('.orbit-ring, .orbit-pivot')].forEach((el) => el.remove());

    const active = tasks.filter((t) => !t.completed);
    sunCount.textContent = String(active.length);

    const ranked = active
      .filter((t) => t.importanceRank !== null && t.importanceRank !== undefined)
      .sort((a, b) => a.importanceRank - b.importanceRank);
    const unranked = active
      .filter((t) => t.importanceRank === null || t.importanceRank === undefined)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const order = [...ranked, ...unranked];

    const count = order.length;
    const step = count > 1 ? Math.min(60, (MAX_RADIUS - MIN_RADIUS) / (count - 1)) : 0;

    order.forEach((task, i) => {
      const radius = count === 1 ? MIN_RADIUS + 40 : MIN_RADIUS + step * i;
      addOrbit(radius);
      addPlanet(task, radius, i);
    });

    renderLog();
  }

  function addOrbit(radius) {
    const ring = document.createElement('div');
    ring.className = 'orbit-ring';
    ring.style.width = `${radius * 2}px`;
    ring.style.height = `${radius * 2}px`;
    orbitRoot.appendChild(ring);
  }

  function addPlanet(task, radius, index) {
    const pivot = document.createElement('div');
    pivot.className = 'orbit-pivot';
    const duration = 14 + radius * 0.12;
    pivot.style.animationDuration = `${duration}s`;
    pivot.style.animationDelay = `-${(index * 997) % Math.round(duration * 100) / 100}s`;
    if (index % 2 === 1) pivot.style.animationDirection = 'reverse';

    const wrap = document.createElement('div');
    wrap.className = 'planet-wrap';
    wrap.style.left = `${radius}px`;

    const size = planetSize(task);
    const [c1, c2] = colorFor(task.id);
    const planet = document.createElement('div');
    planet.className = 'planet' + (task.importanceRank == null ? ' unranked' : '');
    planet.style.width = `${size}px`;
    planet.style.height = `${size}px`;
    planet.style.background = `radial-gradient(circle at 32% 28%, ${c1}, ${c2})`;
    planet.style.animationDuration = `${duration}s`;
    if (index % 2 === 1) planet.style.animationDirection = 'reverse';
    planet.dataset.id = task.id;
    planet.dataset.title = `${task.title} — ${fmtAge(ageDays(task.createdAt))}${task.importanceRank != null ? ` — priority #${task.importanceRank + 1}` : ' — unranked'}`;
    planet.addEventListener('click', () => openDetail(task.id));

    wrap.appendChild(planet);
    pivot.appendChild(wrap);
    orbitRoot.appendChild(pivot);
  }

  function renderLog() {
    const completed = tasks
      .filter((t) => t.completed)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 8);
    logList.innerHTML = '';
    if (completed.length === 0) {
      logList.innerHTML = '<li class="log-empty">Completed tasks will appear here.</li>';
      return;
    }
    completed.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t.title;
      li.title = t.title;
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
    showToast('Task launched into the asteroid belt.');
  }

  // ---------- modals: detail ----------
  function openDetail(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    selectedTaskId = id;
    $('detail-title-header').textContent = 'Task detail';
    $('detail-title').value = task.title;
    $('detail-notes').value = task.notes || '';
    const rankText = task.importanceRank != null ? `Priority #${task.importanceRank + 1}` : 'Not yet ranked';
    $('detail-meta').textContent = `${rankText} · ${fmtAge(ageDays(task.createdAt))} · created ${new Date(task.createdAt).toLocaleString()}`;
    detailModal.classList.remove('hidden');
  }
  function closeDetail() {
    detailModal.classList.add('hidden');
    selectedTaskId = null;
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
    showToast('Task complete. Logged to mission history.');
  }
  function deleteDetail() {
    if (!selectedTaskId) return;
    deleteTask(selectedTaskId);
    closeDetail();
    render();
  }

  // ---------- wiring ----------
  addBtn.addEventListener('click', openAdd);
  $('add-cancel').addEventListener('click', closeAdd);
  $('add-submit').addEventListener('click', submitAdd);
  addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAdd(); });
  addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

  $('detail-close').addEventListener('click', closeDetail);
  $('detail-save').addEventListener('click', saveDetail);
  $('detail-complete').addEventListener('click', completeDetail);
  $('detail-delete').addEventListener('click', deleteDetail);
  detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });

  rankBtn.addEventListener('click', runRank);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAdd(); closeDetail(); }
  });

  // ---------- init ----------
  buildStarfield();
  refreshOllamaStatus();
  render();
  setInterval(render, 30000);
  setInterval(refreshOllamaStatus, 20000);
})();
