"use client";

import { useEffect, useMemo, useState } from "react";

const initialSession = {
  token: "",
  user: null,
};

const emptySummary = {
  totalTasks: 0,
  todoTasks: 0,
  inProgressTasks: 0,
  completedTasks: 0,
  overdueTasks: 0,
};

function titleCase(value) {
  return value.replaceAll("_", " ");
}

function formatDate(value) {
  if (!value) return "No due date";
  return value;
}

function Message({ message, tone = "default" }) {
  if (!message) return <div className="message-spacer" />;
  return <p className={`message ${tone}`}>{message}</p>;
}

function Chip({ children, tone }) {
  return <span className={`chip ${tone || ""}`.trim()}>{children}</span>;
}

export default function HomePage() {
  const [session, setSession] = useState(initialSession);
  const [authMode, setAuthMode] = useState("login");
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState({ text: "", tone: "default" });
  const [adminMessage, setAdminMessage] = useState({ text: "", tone: "default" });
  const [summary, setSummary] = useState(emptySummary);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeProjectDetail, setActiveProjectDetail] = useState(null);
  const [projectMembersOptions, setProjectMembersOptions] = useState([]);
  const [projectDraft, setProjectDraft] = useState({
    name: "",
    description: "",
    memberIds: [],
  });
  const [taskDraft, setTaskDraft] = useState({
    projectId: "",
    title: "",
    description: "",
    assignedTo: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
  });
  const [loginDraft, setLoginDraft] = useState({ email: "", password: "" });
  const [signupDraft, setSignupDraft] = useState({ name: "", email: "", password: "" });

  const isAdmin = session.user?.role === "admin";

  const summaryCards = useMemo(
    () => [
      ["Total tasks", summary.totalTasks],
      ["To do", summary.todoTasks],
      ["In progress", summary.inProgressTasks],
      ["Completed", summary.completedTasks],
      ["Overdue", summary.overdueTasks],
    ],
    [summary]
  );

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  function saveSession(nextToken, nextUser) {
    const next = { token: nextToken, user: nextUser };
    setSession(next);
    window.localStorage.setItem("ttm_token", nextToken);
    window.localStorage.setItem("ttm_user", JSON.stringify(nextUser));
  }

  function clearSession() {
    setSession(initialSession);
    setProjects([]);
    setUsers([]);
    setMyTasks([]);
    setSummary(emptySummary);
    setActiveProjectId(null);
    setActiveProjectDetail(null);
    setProjectMembersOptions([]);
    window.localStorage.removeItem("ttm_token");
    window.localStorage.removeItem("ttm_user");
  }

  async function fetchProjectDetail(projectId, preserveMessage = true) {
    const { project, members, tasks } = await api(`/api/projects/${projectId}`);
    setActiveProjectId(projectId);
    setActiveProjectDetail({ project, members, tasks });
    setProjectMembersOptions(members);
    setTaskDraft((current) => ({
      ...current,
      projectId: String(projectId),
      assignedTo:
        current.assignedTo &&
        members.some((member) => String(member.id) === String(current.assignedTo))
          ? current.assignedTo
          : "",
    }));
    if (!preserveMessage) {
      setAdminMessage({ text: "", tone: "default" });
    }
  }

  async function loadDashboard(preferredProjectId = activeProjectId) {
    const requests = [
      api("/api/dashboard"),
      api("/api/projects"),
      isAdmin ? api("/api/users") : Promise.resolve({ users: [] }),
    ];

    const [{ summary: nextSummary, myTasks: nextMyTasks }, { projects: nextProjects }, usersResponse] =
      await Promise.all(requests);

    setSummary(nextSummary);
    setProjects(nextProjects);
    setUsers(usersResponse.users);
    setMyTasks(nextMyTasks);

    const nextProjectId =
      preferredProjectId && nextProjects.some((project) => project.id === preferredProjectId)
        ? preferredProjectId
        : nextProjects[0]?.id || null;

    if (nextProjectId) {
      await fetchProjectDetail(nextProjectId);
    } else {
      setActiveProjectId(null);
      setActiveProjectDetail(null);
      setProjectMembersOptions([]);
    }
  }

  useEffect(() => {
    const token = window.localStorage.getItem("ttm_token") || "";
    const user = JSON.parse(window.localStorage.getItem("ttm_user") || "null");

    if (!token || !user) {
      setBooting(false);
      return;
    }

    setSession({ token, user });
  }, []);

  useEffect(() => {
    if (!session.token) {
      setBooting(false);
      return;
    }

    let cancelled = false;

    async function restore() {
      try {
        const { user } = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${session.token}` },
        }).then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || "Failed to restore session.");
          }
          return data;
        });

        if (cancelled) return;
        const nextUser = user;
        window.localStorage.setItem("ttm_user", JSON.stringify(nextUser));
        setSession((current) => ({ ...current, user: nextUser }));
      } catch {
        if (cancelled) return;
        clearSession();
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [session.token]);

  useEffect(() => {
    if (!session.token || !session.user) return;
    loadDashboard().catch((error) => {
      setAuthMessage({ text: error.message, tone: "error" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user?.id, session.user?.role]);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setAuthMessage({ text: "", tone: "default" });
    try {
      const data = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginDraft),
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Login failed.");
        return payload;
      });
      saveSession(data.token, data.user);
    } catch (error) {
      setAuthMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    setBusy(true);
    setAuthMessage({ text: "", tone: "default" });
    try {
      const data = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupDraft),
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Signup failed.");
        return payload;
      });
      saveSession(data.token, data.user);
    } catch (error) {
      setAuthMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectDraft.name,
          description: projectDraft.description,
          memberIds: projectDraft.memberIds.map(Number),
        }),
      });
      setProjectDraft({ name: "", description: "", memberIds: [] });
      setAdminMessage({ text: "Project created.", tone: "success" });
      await loadDashboard();
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: Number(taskDraft.projectId),
          title: taskDraft.title,
          description: taskDraft.description,
          assignedTo: taskDraft.assignedTo ? Number(taskDraft.assignedTo) : null,
          status: taskDraft.status,
          priority: taskDraft.priority,
          dueDate: taskDraft.dueDate || null,
        }),
      });
      setTaskDraft((current) => ({
        ...current,
        title: "",
        description: "",
        assignedTo: "",
        status: "todo",
        priority: "medium",
        dueDate: "",
      }));
      setAdminMessage({ text: "Task created.", tone: "success" });
      await loadDashboard(Number(taskDraft.projectId));
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function updateTaskStatus(taskId, status) {
    try {
      await api(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadDashboard(activeProjectId);
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    }
  }

  async function deleteTask(taskId) {
    setBusy(true);
    try {
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      setAdminMessage({ text: "Task deleted.", tone: "success" });
      await loadDashboard(activeProjectId);
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function addMemberToProject() {
    const selectedId = document.getElementById("add-member-select")?.value;
    if (!selectedId || !activeProjectId) {
      setAdminMessage({ text: "Choose a user to add.", tone: "error" });
      return;
    }

    setBusy(true);
    try {
      await api(`/api/projects/${activeProjectId}/members`, {
        method: "POST",
        body: JSON.stringify({ memberId: Number(selectedId) }),
      });
      setAdminMessage({ text: "Member added.", tone: "success" });
      await loadDashboard(activeProjectId);
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(projectId, memberId) {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });
      setAdminMessage({ text: "Member removed.", tone: "success" });
      await loadDashboard(projectId);
    } catch (error) {
      setAdminMessage({ text: error.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const availableMembers =
    isAdmin && activeProjectDetail
      ? users.filter(
          (user) => !activeProjectDetail.members.some((member) => member.id === user.id)
        )
      : [];

  if (booting) {
    return (
      <main className="boot-screen">
        <div className="boot-card">Loading workspace...</div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <aside className="hero-panel">
        <p className="eyebrow">Ethara Assignment</p>
        <h1>Team Task Manager with role-based control.</h1>
        <p className="hero-copy">
          Create projects, manage teams, assign work, and track overdue tasks from one clean
          workspace.
        </p>
        <div className="hero-stats">
          <article className="stat-card">
            <span>Roles</span>
            <strong>Admin / Member</strong>
          </article>
          <article className="stat-card">
            <span>Frontend</span>
            <strong>Next.js + React</strong>
          </article>
          <article className="stat-card">
            <span>Backend</span>
            <strong>Express + SQLite</strong>
          </article>
        </div>
      </aside>

      <section className="app-panel">
        {!session.user ? (
          <section className="card auth-card">
            <div className="section-heading">
              <p className="eyebrow">Access</p>
              <h2>Sign in or create an account</h2>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={`tab-button ${authMode === "login" ? "active" : ""}`}
                onClick={() => setAuthMode("login")}
              >
                Login
              </button>
              <button
                type="button"
                className={`tab-button ${authMode === "signup" ? "active" : ""}`}
                onClick={() => setAuthMode("signup")}
              >
                Signup
              </button>
            </div>

            {authMode === "login" ? (
              <form className="form-grid" onSubmit={handleLogin}>
                <label>
                  Email
                  <input
                    type="email"
                    value={loginDraft.email}
                    onChange={(event) =>
                      setLoginDraft((current) => ({ ...current, email: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginDraft.password}
                    onChange={(event) =>
                      setLoginDraft((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? "Logging in..." : "Login"}
                </button>
              </form>
            ) : (
              <form className="form-grid" onSubmit={handleSignup}>
                <label>
                  Full name
                  <input
                    type="text"
                    value={signupDraft.name}
                    onChange={(event) =>
                      setSignupDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={signupDraft.email}
                    onChange={(event) =>
                      setSignupDraft((current) => ({ ...current, email: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    minLength={6}
                    value={signupDraft.password}
                    onChange={(event) =>
                      setSignupDraft((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? "Creating account..." : "Create account"}
                </button>
              </form>
            )}

            <p className="meta">The first account becomes admin. Later accounts join as members.</p>
            <Message message={authMessage.text} tone={authMessage.tone} />
          </section>
        ) : (
          <div className="dashboard-shell">
            <header className="toolbar card">
              <div>
                <p className="eyebrow">Workspace</p>
                <h2>Welcome, {session.user.name}</h2>
              </div>
              <div className="toolbar-actions">
                <span className="role-badge">{session.user.role}</span>
                <button
                  className="secondary-button"
                  onClick={clearSession}
                  type="button"
                >
                  Logout
                </button>
              </div>
            </header>

            <section className="summary-grid">
              {summaryCards.map(([label, value]) => (
                <article className="summary-card" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>

            <section className="layout-grid">
              <article className="card">
                <div className="section-heading inline-heading">
                  <div>
                    <p className="eyebrow">Projects</p>
                    <h3>Project list</h3>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => loadDashboard(activeProjectId)}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
                <div className="stack-list">
                  {projects.length === 0 ? (
                    <div className="empty-state">
                      No projects yet. Admins can create the first one below.
                    </div>
                  ) : (
                    projects.map((project) => (
                      <article className="item-card" key={project.id}>
                        <span className="eyebrow">Project</span>
                        <h4>{project.name}</h4>
                        <p>{project.description || "No description added yet."}</p>
                        <div className="meta-row">
                          <Chip>{project.team_count} team</Chip>
                          <Chip>{project.task_count} tasks</Chip>
                          <Chip>{project.owner_name}</Chip>
                        </div>
                        <button
                          className="secondary-button"
                          onClick={() => fetchProjectDetail(project.id, false)}
                          type="button"
                        >
                          View details
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </article>

              <article className="card">
                <div className="section-heading">
                  <p className="eyebrow">My tasks</p>
                  <h3>Assigned to me</h3>
                </div>
                <div className="stack-list">
                  {myTasks.length === 0 ? (
                    <div className="empty-state">No tasks are assigned to you right now.</div>
                  ) : (
                    myTasks.map((task) => (
                      <article className="task-card" key={task.id}>
                        <span className="eyebrow">{task.project_name}</span>
                        <h4>{task.title}</h4>
                        <p>{task.description || "No extra details."}</p>
                        <div className="meta-row">
                          <Chip tone={task.status}>{titleCase(task.status)}</Chip>
                          <Chip tone={task.priority}>{task.priority}</Chip>
                          <Chip>{formatDate(task.due_date)}</Chip>
                        </div>
                        <label>
                          Update status
                          <select
                            value={task.status}
                            onChange={(event) => updateTaskStatus(task.id, event.target.value)}
                          >
                            <option value="todo">To do</option>
                            <option value="in_progress">In progress</option>
                            <option value="done">Done</option>
                          </select>
                        </label>
                      </article>
                    ))
                  )}
                </div>
              </article>
            </section>

            {isAdmin ? (
              <section className="card">
                <div className="section-heading">
                  <p className="eyebrow">Admin controls</p>
                  <h3>Create projects and tasks</h3>
                </div>
                <div className="admin-grid">
                  <form className="form-grid compact" onSubmit={handleCreateProject}>
                    <h4>New project</h4>
                    <label>
                      Project name
                      <input
                        type="text"
                        value={projectDraft.name}
                        onChange={(event) =>
                          setProjectDraft((current) => ({ ...current, name: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        rows={3}
                        value={projectDraft.description}
                        onChange={(event) =>
                          setProjectDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Team members
                      <select
                        multiple
                        value={projectDraft.memberIds}
                        onChange={(event) =>
                          setProjectDraft((current) => ({
                            ...current,
                            memberIds: Array.from(event.target.selectedOptions, (option) => option.value),
                          }))
                        }
                      >
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary-button" disabled={busy} type="submit">
                      Create project
                    </button>
                  </form>

                  <form className="form-grid compact" onSubmit={handleCreateTask}>
                    <h4>New task</h4>
                    <label>
                      Project
                      <select
                        value={taskDraft.projectId}
                        onChange={async (event) => {
                          const nextProjectId = event.target.value;
                          setTaskDraft((current) => ({ ...current, projectId: nextProjectId }));
                          if (nextProjectId) {
                            await fetchProjectDetail(Number(nextProjectId));
                          }
                        }}
                        required
                      >
                        <option value="">Select a project</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Title
                      <input
                        type="text"
                        value={taskDraft.title}
                        onChange={(event) =>
                          setTaskDraft((current) => ({ ...current, title: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        rows={3}
                        value={taskDraft.description}
                        onChange={(event) =>
                          setTaskDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Assignee
                      <select
                        value={taskDraft.assignedTo}
                        onChange={(event) =>
                          setTaskDraft((current) => ({
                            ...current,
                            assignedTo: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {projectMembersOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="split-fields">
                      <label>
                        Status
                        <select
                          value={taskDraft.status}
                          onChange={(event) =>
                            setTaskDraft((current) => ({ ...current, status: event.target.value }))
                          }
                        >
                          <option value="todo">To do</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                        </select>
                      </label>
                      <label>
                        Priority
                        <select
                          value={taskDraft.priority}
                          onChange={(event) =>
                            setTaskDraft((current) => ({ ...current, priority: event.target.value }))
                          }
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Due date
                      <input
                        type="date"
                        value={taskDraft.dueDate}
                        onChange={(event) =>
                          setTaskDraft((current) => ({ ...current, dueDate: event.target.value }))
                        }
                      />
                    </label>
                    <button className="primary-button" disabled={busy} type="submit">
                      Create task
                    </button>
                  </form>
                </div>
                <Message message={adminMessage.text} tone={adminMessage.tone} />
              </section>
            ) : null}

            <section className="card">
              <div className="section-heading">
                <p className="eyebrow">Project detail</p>
                <h3>{activeProjectDetail?.project?.name || "Select a project"}</h3>
              </div>

              {!activeProjectDetail ? (
                <div className="empty-state">Choose a project to view team members and tasks.</div>
              ) : (
                <div className="project-detail">
                  <article className="item-card">
                    <span className="eyebrow">Overview</span>
                    <h4>{activeProjectDetail.project.name}</h4>
                    <p>{activeProjectDetail.project.description || "No project description provided."}</p>
                    <div className="meta-row">
                      <Chip>{activeProjectDetail.members.length} members</Chip>
                      <Chip>{activeProjectDetail.tasks.length} tasks</Chip>
                    </div>
                  </article>

                  <article className="item-card">
                    <span className="eyebrow">Team</span>
                    {isAdmin ? (
                      <label className="member-control">
                        Add member
                        <div className="split-fields">
                          <select id="add-member-select" defaultValue="">
                            <option value="">Select a user</option>
                            {availableMembers.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name} ({user.role})
                              </option>
                            ))}
                          </select>
                          <button className="primary-button" onClick={addMemberToProject} type="button">
                            Add
                          </button>
                        </div>
                      </label>
                    ) : null}

                    <div className="stack-list">
                      {activeProjectDetail.members.length === 0 ? (
                        <div className="empty-state">No members on this project yet.</div>
                      ) : (
                        activeProjectDetail.members.map((member) => (
                          <article className="task-card" key={member.id}>
                            <strong>{member.name}</strong>
                            <div className="meta-row">
                              <Chip>{member.role}</Chip>
                              <Chip>{member.email}</Chip>
                            </div>
                            {isAdmin && member.id !== activeProjectDetail.project.owner_id ? (
                              <button
                                className="secondary-button"
                                onClick={() => removeMember(activeProjectDetail.project.id, member.id)}
                                type="button"
                              >
                                Remove
                              </button>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </article>

                  <article className="item-card">
                    <span className="eyebrow">Tasks</span>
                    <div className="stack-list">
                      {activeProjectDetail.tasks.length === 0 ? (
                        <div className="empty-state">No tasks have been created for this project yet.</div>
                      ) : (
                        activeProjectDetail.tasks.map((task) => (
                          <article className="task-card" key={task.id}>
                            <h4>{task.title}</h4>
                            <p>{task.description || "No description."}</p>
                            <div className="meta-row">
                              <Chip tone={task.status}>{titleCase(task.status)}</Chip>
                              <Chip tone={task.priority}>{task.priority}</Chip>
                              <Chip>Assignee: {task.assignee_name || "Unassigned"}</Chip>
                              <Chip>Due: {formatDate(task.due_date)}</Chip>
                            </div>
                            {isAdmin ? (
                              <button
                                className="secondary-button"
                                onClick={() => deleteTask(task.id)}
                                type="button"
                              >
                                Delete task
                              </button>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </article>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
