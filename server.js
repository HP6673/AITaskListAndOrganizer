import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'tasks.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const PORT = process.env.PORT || 5757;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage ----------

async function loadTasks() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveTasks(tasks) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(tasks, null, 2));
}

// ---------- ollama helpers ----------

async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function getOllamaStatus() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 3000);
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

function ageInDays(createdAt) {
  return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
}

async function rankWithOllama(model, tasks) {
  const payload = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes || '',
    ageDays: Math.round(ageInDays(t.createdAt) * 10) / 10,
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

  const validIds = new Set(tasks.map((t) => t.id));
  ranking = ranking.filter((id) => validIds.has(id));
  for (const t of tasks) {
    if (!ranking.includes(t.id)) ranking.push(t.id);
  }

  return ranking;
}

// ---------- routes ----------

app.get('/api/ollama/status', async (_req, res) => {
  res.json(await getOllamaStatus());
});

app.get('/api/tasks', async (_req, res) => {
  res.json(await loadTasks());
});

app.post('/api/tasks', async (req, res) => {
  const { title, notes } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const tasks = await loadTasks();
  const task = {
    id: randomUUID(),
    title: String(title).trim().slice(0, 200),
    notes: notes ? String(notes).trim().slice(0, 2000) : '',
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: null,
    importanceRank: null,
  };
  tasks.push(task);
  await saveTasks(tasks);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const { title, notes, completed } = req.body || {};
  if (title !== undefined) task.title = String(title).trim().slice(0, 200);
  if (notes !== undefined) task.notes = String(notes).trim().slice(0, 2000);
  if (completed !== undefined) {
    task.completed = Boolean(completed);
    task.completedAt = task.completed ? new Date().toISOString() : null;
  }
  await saveTasks(tasks);
  res.json(task);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [removed] = tasks.splice(idx, 1);
  await saveTasks(tasks);
  res.json(removed);
});

app.post('/api/rank', async (req, res) => {
  const { model } = req.body || {};
  const tasks = await loadTasks();
  const active = tasks.filter((t) => !t.completed);

  if (active.length === 0) return res.json({ tasks, fallback: false });
  if (!model) return res.status(400).json({ error: 'model is required' });

  try {
    const ranking = await rankWithOllama(model, active);
    ranking.forEach((id, index) => {
      const task = tasks.find((t) => t.id === id);
      if (task) task.importanceRank = index;
    });
    await saveTasks(tasks);
    res.json({ tasks, fallback: false });
  } catch (err) {
    // Fallback: keep oldest-first ordering so the app still functions without Ollama.
    const sorted = [...active].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    sorted.forEach((t, index) => {
      const task = tasks.find((x) => x.id === t.id);
      if (task) task.importanceRank = index;
    });
    await saveTasks(tasks);
    res.json({ tasks, fallback: true, error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Solar Todo running at http://localhost:${PORT}`);
});
