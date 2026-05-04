const express = require("express");
const path = require("path");
const fs = require("fs");
const next = require("next");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const dev = process.env.NODE_ENV !== "production";
const dataDir =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.db");
const nextApp = next({ dev, dir: __dirname });
const nextHandler = nextApp.getRequestHandler();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY(project_id, user_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
    priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    due_date TEXT,
    assigned_to INTEGER,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_to) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
`);

app.use(express.json());
const createToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  created_at: user.created_at,
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function getProjectForUser(projectId, user) {
  if (user.role === "admin") {
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  }

  return db
    .prepare(
      `
        SELECT p.*
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id
        WHERE p.id = ? AND pm.user_id = ?
      `
    )
    .get(projectId, user.id);
}

function getTaskWithProject(taskId) {
  return db
    .prepare(
      `
        SELECT
          t.*,
          p.name AS project_name
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?
      `
    )
    .get(taskId);
}

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE lower(email) = lower(?)")
    .get(email.trim());

  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const normalizedRole = userCount === 0 ? "admin" : "member";
  const passwordHash = await bcrypt.hash(password, 10);

  const result = db
    .prepare(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(name.trim(), email.trim().toLowerCase(), passwordHash, normalizedRole);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json({
    token: createToken(user),
    user: sanitizeUser(user),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
    .get(email.trim());

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  return res.json({
    token: createToken(user),
    user: sanitizeUser(user),
  });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  return res.json({ user: sanitizeUser(user) });
});

app.get("/health", (_req, res) => {
  return res.status(200).json({
    ok: true,
    storage: dataDir,
  });
});

app.get("/api/users", auth, requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `
        SELECT id, name, email, role, created_at
        FROM users
        ORDER BY role DESC, name ASC
      `
    )
    .all();

  return res.json({ users });
});

app.get("/api/projects", auth, (req, res) => {
  const projects =
    req.user.role === "admin"
      ? db
          .prepare(
            `
              SELECT
                p.*,
                owner.name AS owner_name,
                COUNT(DISTINCT pm.user_id) AS team_count,
                COUNT(DISTINCT t.id) AS task_count
              FROM projects p
              JOIN users owner ON owner.id = p.owner_id
              LEFT JOIN project_members pm ON pm.project_id = p.id
              LEFT JOIN tasks t ON t.project_id = p.id
              GROUP BY p.id
              ORDER BY p.created_at DESC
            `
          )
          .all()
      : db
          .prepare(
            `
              SELECT
                p.*,
                owner.name AS owner_name,
                COUNT(DISTINCT pm2.user_id) AS team_count,
                COUNT(DISTINCT t.id) AS task_count
              FROM project_members mine
              JOIN projects p ON p.id = mine.project_id
              JOIN users owner ON owner.id = p.owner_id
              LEFT JOIN project_members pm2 ON pm2.project_id = p.id
              LEFT JOIN tasks t ON t.project_id = p.id
              WHERE mine.user_id = ?
              GROUP BY p.id
              ORDER BY p.created_at DESC
            `
          )
          .all(req.user.id);

  return res.json({ projects });
});

app.post("/api/projects", auth, requireAdmin, (req, res) => {
  const { name, description = "", memberIds = [] } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: "Project name is required." });
  }

  const result = db
    .prepare(
      `
        INSERT INTO projects (name, description, owner_id)
        VALUES (?, ?, ?)
      `
    )
    .run(name.trim(), description.trim(), req.user.id);

  const projectId = Number(result.lastInsertRowid);
  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)"
  );

  insertMember.run(projectId, req.user.id);
  for (const memberId of memberIds) {
    insertMember.run(projectId, Number(memberId));
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return res.status(201).json({ project });
});

app.get("/api/projects/:id", auth, (req, res) => {
  const project = getProjectForUser(Number(req.params.id), req.user);
  if (!project) {
    return res.status(404).json({ error: "Project not found." });
  }

  const members = db
    .prepare(
      `
        SELECT u.id, u.name, u.email, u.role
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY u.name ASC
      `
    )
    .all(project.id);

  const tasks = db
    .prepare(
      `
        SELECT
          t.*,
          assignee.name AS assignee_name,
          creator.name AS creator_name
        FROM tasks t
        LEFT JOIN users assignee ON assignee.id = t.assigned_to
        JOIN users creator ON creator.id = t.created_by
        WHERE t.project_id = ?
        ORDER BY
          CASE t.status
            WHEN 'todo' THEN 1
            WHEN 'in_progress' THEN 2
            ELSE 3
          END,
          COALESCE(t.due_date, '9999-12-31') ASC,
          t.created_at DESC
      `
    )
    .all(project.id);

  return res.json({ project, members, tasks });
});

app.post("/api/projects/:id/members", auth, requireAdmin, (req, res) => {
  const projectId = Number(req.params.id);
  const project = getProjectForUser(projectId, req.user);
  if (!project) {
    return res.status(404).json({ error: "Project not found." });
  }

  const { memberId } = req.body;
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(memberId));
  if (!user) {
    return res.status(404).json({ error: "Selected user does not exist." });
  }

  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)")
    .run(projectId, Number(memberId));

  return res.status(201).json({ success: true });
});

app.delete("/api/projects/:projectId/members/:memberId", auth, requireAdmin, (req, res) => {
  const projectId = Number(req.params.projectId);
  const memberId = Number(req.params.memberId);
  const project = getProjectForUser(projectId, req.user);

  if (!project) {
    return res.status(404).json({ error: "Project not found." });
  }

  if (memberId === project.owner_id) {
    return res.status(400).json({ error: "Project owner cannot be removed." });
  }

  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, memberId);

  return res.json({ success: true });
});

app.post("/api/tasks", auth, requireAdmin, (req, res) => {
  const {
    projectId,
    title,
    description = "",
    status = "todo",
    priority = "medium",
    dueDate = null,
    assignedTo = null,
  } = req.body;

  if (!title?.trim() || !projectId) {
    return res.status(400).json({ error: "Project and title are required." });
  }

  const project = getProjectForUser(Number(projectId), req.user);
  if (!project) {
    return res.status(404).json({ error: "Project not found." });
  }

  if (assignedTo) {
    const membership = db
      .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(Number(projectId), Number(assignedTo));
    if (!membership) {
      return res.status(400).json({ error: "Assignee must be part of the project team." });
    }
  }

  const result = db
    .prepare(
      `
        INSERT INTO tasks (
          project_id, title, description, status, priority, due_date, assigned_to, created_by, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
    )
    .run(
      Number(projectId),
      title.trim(),
      description.trim(),
      status,
      priority,
      dueDate || null,
      assignedTo ? Number(assignedTo) : null,
      req.user.id
    );

  return res.status(201).json({
    task: getTaskWithProject(Number(result.lastInsertRowid)),
  });
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const taskId = Number(req.params.id);
  const task = getTaskWithProject(taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found." });
  }

  const project = getProjectForUser(task.project_id, req.user);
  if (!project) {
    return res.status(403).json({ error: "You do not have access to this task." });
  }

  const isAssignee = task.assigned_to === req.user.id;
  const isAdmin = req.user.role === "admin";
  if (!isAdmin && !isAssignee) {
    return res.status(403).json({ error: "Only admins or the assigned member can update this task." });
  }

  const next = {
    title: req.body.title ?? task.title,
    description: req.body.description ?? task.description,
    status: req.body.status ?? task.status,
    priority: req.body.priority ?? task.priority,
    dueDate: req.body.dueDate !== undefined ? req.body.dueDate : task.due_date,
    assignedTo: req.body.assignedTo !== undefined ? req.body.assignedTo : task.assigned_to,
  };

  if (!isAdmin) {
    next.title = task.title;
    next.description = task.description;
    next.priority = task.priority;
    next.dueDate = task.due_date;
    next.assignedTo = task.assigned_to;
  }

  if (next.assignedTo) {
    const membership = db
      .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(task.project_id, Number(next.assignedTo));
    if (!membership) {
      return res.status(400).json({ error: "Assignee must be part of the project team." });
    }
  }

  db.prepare(
    `
      UPDATE tasks
      SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    next.title,
    next.description,
    next.status,
    next.priority,
    next.dueDate || null,
    next.assignedTo ? Number(next.assignedTo) : null,
    taskId
  );

  return res.json({ task: getTaskWithProject(taskId) });
});

app.delete("/api/tasks/:id", auth, requireAdmin, (req, res) => {
  const taskId = Number(req.params.id);
  const task = getTaskWithProject(taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found." });
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  return res.json({ success: true });
});

app.get("/api/dashboard", auth, (req, res) => {
  const projectScope =
    req.user.role === "admin"
      ? ""
      : `
        AND t.project_id IN (
          SELECT project_id FROM project_members WHERE user_id = ${Number(req.user.id)}
        )
      `;

  const summary = db
    .prepare(
      `
        SELECT
          COUNT(*) AS totalTasks,
          SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todoTasks,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgressTasks,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completedTasks,
          SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status != 'done' THEN 1 ELSE 0 END) AS overdueTasks
        FROM tasks t
        WHERE 1 = 1
        ${projectScope}
      `
    )
    .get();

  const myTasks = db
    .prepare(
      `
        SELECT
          t.*,
          p.name AS project_name
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.assigned_to = ?
        ORDER BY
          CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now') THEN 0 ELSE 1 END,
          COALESCE(t.due_date, '9999-12-31') ASC
      `
    )
    .all(req.user.id);

  return res.json({
    summary: {
      totalTasks: summary.totalTasks || 0,
      todoTasks: summary.todoTasks || 0,
      inProgressTasks: summary.inProgressTasks || 0,
      completedTasks: summary.completedTasks || 0,
      overdueTasks: summary.overdueTasks || 0,
    },
    myTasks,
  });
});

nextApp
  .prepare()
  .then(() => {
    app.all(/.*/, (req, res) => nextHandler(req, res));

    app.listen(PORT, () => {
      console.log(`Team Task Manager running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start application", error);
    process.exit(1);
  });
