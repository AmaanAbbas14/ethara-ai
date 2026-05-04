const state = {
  token: localStorage.getItem("ttm_token") || "",
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  projects: [],
  users: [],
  activeProjectId: null,
};

const authView = document.getElementById("auth-view");
const dashboardView = document.getElementById("dashboard-view");
const authMessage = document.getElementById("auth-message");
const adminMessage = document.getElementById("admin-message");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const showLoginButton = document.getElementById("show-login");
const showSignupButton = document.getElementById("show-signup");
const logoutButton = document.getElementById("logout-button");
const refreshProjectsButton = document.getElementById("refresh-projects");
const projectForm = document.getElementById("project-form");
const taskForm = document.getElementById("task-form");
const adminPanel = document.getElementById("admin-panel");

function setMessage(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? "#a6372f" : "#7f3210";
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  loginForm.classList.toggle("hidden", !isLogin);
  signupForm.classList.toggle("hidden", isLogin);
  showLoginButton.classList.toggle("active", isLogin);
  showSignupButton.classList.toggle("active", !isLogin);
  setMessage(authMessage, "");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
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

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("ttm_token", token);
  localStorage.setItem("ttm_user", JSON.stringify(user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.projects = [];
  state.users = [];
  state.activeProjectId = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function renderAuth() {
  authView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
}

function renderSummary(summary) {
  const summaryGrid = document.getElementById("summary-grid");
  const cards = [
    ["Total tasks", summary.totalTasks],
    ["To do", summary.todoTasks],
    ["In progress", summary.inProgressTasks],
    ["Completed", summary.completedTasks],
    ["Overdue", summary.overdueTasks],
  ];

  summaryGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="summary-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join("");
}

function renderProjects() {
  const list = document.getElementById("project-list");
  const projectSelect = document.getElementById("task-project");
  const projectOptions = state.projects
    .map((project) => `<option value="${project.id}">${project.name}</option>`)
    .join("");

  projectSelect.innerHTML = projectOptions;
  list.innerHTML =
    state.projects.length === 0
      ? `<div class="empty-state">No projects yet. Admins can create the first one below.</div>`
      : state.projects
          .map(
            (project) => `
              <article class="item-card">
                <span class="eyebrow">Project</span>
                <h4>${project.name}</h4>
                <p>${project.description || "No description added yet."}</p>
                <div class="project-meta">
                  <span class="chip">${project.team_count} team</span>
                  <span class="chip">${project.task_count} tasks</span>
                  <span class="chip">${project.owner_name}</span>
                </div>
                <button class="secondary-button" data-project-id="${project.id}" type="button">View details</button>
              </article>
            `
          )
          .join("");

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId);
  if (!activeProject && state.projects[0]) {
    state.activeProjectId = state.projects[0].id;
  }
}

function renderMyTasks(tasks) {
  const list = document.getElementById("my-task-list");
  list.innerHTML =
    tasks.length === 0
      ? `<div class="empty-state">No tasks are assigned to you right now.</div>`
      : tasks
          .map(
            (task) => `
              <article class="task-card">
                <span class="eyebrow">${task.project_name}</span>
                <h4>${task.title}</h4>
                <p>${task.description || "No extra details."}</p>
                <div class="task-meta">
                  <span class="chip ${task.status}">${task.status.replace("_", " ")}</span>
                  <span class="chip ${task.priority}">${task.priority}</span>
                  <span class="chip">${task.due_date || "No due date"}</span>
                </div>
                <label>
                  Update status
                  <select data-task-status="${task.id}">
                    <option value="todo" ${task.status === "todo" ? "selected" : ""}>To do</option>
                    <option value="in_progress" ${task.status === "in_progress" ? "selected" : ""}>In progress</option>
                    <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
                  </select>
                </label>
              </article>
            `
          )
          .join("");
}

function populateUsersForForms() {
  const membersSelect = document.getElementById("project-members");
  const options = state.users
    .map((user) => `<option value="${user.id}">${user.name} (${user.role})</option>`)
    .join("");

  membersSelect.innerHTML = options;
  syncTaskAssigneeOptions();
}

function syncTaskAssigneeOptions() {
  const projectId = Number(document.getElementById("task-project").value);
  const assigneeSelect = document.getElementById("task-assignee");

  if (!projectId) {
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>`;
    return;
  }

  api(`/api/projects/${projectId}`)
    .then(({ members }) => {
      assigneeSelect.innerHTML = `<option value="">Unassigned</option>${members
        .map((user) => `<option value="${user.id}">${user.name} (${user.role})</option>`)
        .join("")}`;
    })
    .catch(() => {
      assigneeSelect.innerHTML = `<option value="">Unassigned</option>`;
    });
}

async function renderProjectDetail(projectId) {
  const detail = document.getElementById("project-detail");
  const detailTitle = document.getElementById("detail-title");
  state.activeProjectId = projectId;

  try {
    const { project, members, tasks } = await api(`/api/projects/${projectId}`);
    const availableMembers =
      state.user.role === "admin"
        ? state.users.filter((user) => !members.some((member) => member.id === user.id))
        : [];

    detailTitle.textContent = project.name;
    detail.innerHTML = `
      <article class="item-card">
        <span class="eyebrow">Overview</span>
        <h4>${project.name}</h4>
        <p>${project.description || "No project description provided."}</p>
        <div class="project-meta">
          <span class="chip">${members.length} members</span>
          <span class="chip">${tasks.length} tasks</span>
        </div>
      </article>
      <article class="item-card">
        <span class="eyebrow">Team</span>
        ${
          state.user.role === "admin"
            ? `
              <label>
                Add member
                <div class="split-fields">
                  <select id="add-member-select">
                    <option value="">Select a user</option>
                    ${availableMembers
                      .map((user) => `<option value="${user.id}">${user.name} (${user.role})</option>`)
                      .join("")}
                  </select>
                  <button class="primary-button" data-add-member="${project.id}" type="button">Add</button>
                </div>
              </label>
            `
            : ""
        }
        <div class="stack-list">
          ${
            members.length
              ? members
                  .map(
                    (member) => `
                      <div class="task-card">
                        <strong>${member.name}</strong>
                        <div class="task-meta">
                          <span class="chip">${member.role}</span>
                          <span class="chip">${member.email}</span>
                        </div>
                        ${
                          state.user.role === "admin" && member.id !== project.owner_id
                            ? `<button class="secondary-button" data-remove-member="${project.id}:${member.id}" type="button">Remove</button>`
                            : ""
                        }
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No members on this project yet.</div>`
          }
        </div>
      </article>
      <article class="item-card">
        <span class="eyebrow">Tasks</span>
        <div class="stack-list">
          ${
            tasks.length
              ? tasks
                  .map(
                    (task) => `
                      <div class="task-card">
                        <h4>${task.title}</h4>
                        <p>${task.description || "No description."}</p>
                        <div class="task-meta">
                          <span class="chip ${task.status}">${task.status.replace("_", " ")}</span>
                          <span class="chip ${task.priority}">${task.priority}</span>
                          <span class="chip">Assignee: ${task.assignee_name || "Unassigned"}</span>
                          <span class="chip">Due: ${task.due_date || "No due date"}</span>
                        </div>
                        ${
                          state.user.role === "admin"
                            ? `<button class="secondary-button" data-delete-task="${task.id}" type="button">Delete task</button>`
                            : ""
                        }
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No tasks have been created for this project yet.</div>`
          }
        </div>
      </article>
    `;
  } catch (error) {
    detailTitle.textContent = "Project detail";
    detail.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

async function loadDashboard() {
  const [{ summary, myTasks }, { projects }, usersResponse] = await Promise.all([
    api("/api/dashboard"),
    api("/api/projects"),
    state.user.role === "admin" ? api("/api/users") : Promise.resolve({ users: [] }),
  ]);

  state.projects = projects;
  state.users = usersResponse.users;

  authView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  adminPanel.classList.toggle("hidden", state.user.role !== "admin");
  document.getElementById("welcome-title").textContent = `Welcome, ${state.user.name}`;
  document.getElementById("role-badge").textContent = state.user.role;

  renderSummary(summary);
  renderProjects();
  renderMyTasks(myTasks);

  if (state.user.role === "admin") {
    populateUsersForForms();
  }

  if (state.activeProjectId) {
    renderProjectDetail(state.activeProjectId);
  } else if (state.projects[0]) {
    renderProjectDetail(state.projects[0].id);
  } else {
    document.getElementById("detail-title").textContent = "Select a project";
    document.getElementById("project-detail").innerHTML =
      `<div class="empty-state">Create a project to start assigning work.</div>`;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    saveSession(data.token, data.user);
    await loadDashboard();
  } catch (error) {
    setMessage(authMessage, error.message, true);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(signupForm);
  try {
    const data = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    saveSession(data.token, data.user);
    await loadDashboard();
  } catch (error) {
    setMessage(authMessage, error.message, true);
  }
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(projectForm);
  const selected = Array.from(document.getElementById("project-members").selectedOptions).map((option) =>
    Number(option.value)
  );

  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        description: formData.get("description"),
        memberIds: selected,
      }),
    });
    projectForm.reset();
    setMessage(adminMessage, "Project created.");
    await loadDashboard();
  } catch (error) {
    setMessage(adminMessage, error.message, true);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(taskForm);
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: Number(formData.get("projectId")),
        title: formData.get("title"),
        description: formData.get("description"),
        status: formData.get("status"),
        priority: formData.get("priority"),
        dueDate: formData.get("dueDate") || null,
        assignedTo: formData.get("assignedTo") ? Number(formData.get("assignedTo")) : null,
      }),
    });
    taskForm.reset();
    setMessage(adminMessage, "Task created.");
    await loadDashboard();
  } catch (error) {
    setMessage(adminMessage, error.message, true);
  }
});

document.getElementById("task-project").addEventListener("change", syncTaskAssigneeOptions);
refreshProjectsButton.addEventListener("click", () => loadDashboard());

logoutButton.addEventListener("click", () => {
  clearSession();
  renderAuth();
});

showLoginButton.addEventListener("click", () => setAuthMode("login"));
showSignupButton.addEventListener("click", () => setAuthMode("signup"));

document.addEventListener("click", async (event) => {
  const projectButton = event.target.closest("[data-project-id]");
  const deleteTaskButton = event.target.closest("[data-delete-task]");
  const removeMemberButton = event.target.closest("[data-remove-member]");
  const addMemberButton = event.target.closest("[data-add-member]");

  if (projectButton) {
    await renderProjectDetail(Number(projectButton.dataset.projectId));
  }

  if (deleteTaskButton) {
    await api(`/api/tasks/${Number(deleteTaskButton.dataset.deleteTask)}`, {
      method: "DELETE",
    });
    await loadDashboard();
  }

  if (removeMemberButton) {
    const [projectId, memberId] = removeMemberButton.dataset.removeMember.split(":").map(Number);
    await api(`/api/projects/${projectId}/members/${memberId}`, {
      method: "DELETE",
    });
    await loadDashboard();
  }

  if (addMemberButton) {
    const projectId = Number(addMemberButton.dataset.addMember);
    const select = document.getElementById("add-member-select");
    if (!select.value) {
      setMessage(adminMessage, "Choose a user to add.", true);
      return;
    }
    await api(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ memberId: Number(select.value) }),
    });
    setMessage(adminMessage, "Member added.");
    await loadDashboard();
    await renderProjectDetail(projectId);
  }
});

document.addEventListener("change", async (event) => {
  const statusSelect = event.target.closest("[data-task-status]");
  if (!statusSelect) {
    return;
  }

  try {
    await api(`/api/tasks/${Number(statusSelect.dataset.taskStatus)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: statusSelect.value }),
    });
    await loadDashboard();
  } catch (error) {
    setMessage(adminMessage, error.message, true);
  }
});

(async function init() {
  setAuthMode("login");

  if (!state.token) {
    renderAuth();
    return;
  }

  try {
    const { user } = await api("/api/me");
    state.user = user;
    localStorage.setItem("ttm_user", JSON.stringify(user));
    await loadDashboard();
  } catch {
    clearSession();
    renderAuth();
  }
})();
