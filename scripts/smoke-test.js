const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "server.js");
const dbBasePath = path.join(__dirname, "..", "data", "app.db");
const baseUrl = "http://127.0.0.1:3000";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    const filePath = `${dbBasePath}${suffix}`;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  const server = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    server.stdout.on("data", (chunk) => process.stdout.write(`SERVER: ${chunk}`));
    server.stderr.on("data", (chunk) => process.stderr.write(`SERVER ERR: ${chunk}`));

    await wait(2200);

    const admin = await request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin User",
        email: "admin@example.com",
        password: "secret123",
        role: "admin",
      }),
    });

    const member = await request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Member User",
        email: "member@example.com",
        password: "secret123",
        role: "member",
      }),
    });

    const project = await request("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        name: "Launch Board",
        description: "Assignment smoke test",
        memberIds: [member.user.id],
      }),
    });

    const task = await request("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        projectId: project.project.id,
        title: "Ship demo",
        description: "Record submission video",
        status: "todo",
        priority: "high",
        assignedTo: member.user.id,
      }),
    });

    const update = await request(`/api/tasks/${task.task.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member.token}`,
      },
      body: JSON.stringify({
        status: "done",
      }),
    });

    const dashboard = await request("/api/dashboard", {
      headers: {
        Authorization: `Bearer ${admin.token}`,
      },
    });

    console.log(
      JSON.stringify(
        {
          admin: admin.user.role,
          member: member.user.role,
          projectId: project.project.id,
          taskStatus: update.task.status,
          summary: dashboard.summary,
        },
        null,
        2
      )
    );
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
