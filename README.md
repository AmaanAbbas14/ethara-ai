# Team Task Manager

Full-stack assignment app for managing projects, teams, and tasks with `admin` / `member` role-based access.

## Features

- Signup and login with JWT authentication
- Admin and member roles
- Project creation and team membership management
- Task creation, assignment, status tracking, and overdue visibility
- Dashboard summary for total, in-progress, completed, and overdue tasks
- SQLite persistence for easy local setup and Railway deployment
- Next.js frontend with React-based UI

## Tech Stack

- Node.js
- Next.js
- React
- Express
- SQLite via `better-sqlite3`
- CSS via global Next.js styles

## Run locally

```bash
node -v
npm install
npm run build
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

Recommended Node version: `20.x`

## Role behavior

- The first registered user becomes `admin`
- All later signups are created as `member`
- Admins can create projects, manage members, and create/delete tasks
- Members can view assigned projects and update the status of their own tasks

## Railway deployment

1. Push this folder to GitHub.
2. Create a new Railway project from the repo.
3. In the web service, add a Volume and mount it to `/app/data`.
4. Set `JWT_SECRET` as an environment variable.
5. Railway will use the included [railway.json](/Users/amaanabbas/Downloads/ethara-ai/railway.json) file:

```bash
npm install
npm run build
npm start
```

6. After deploy, confirm the healthcheck passes at `/health`.
7. Open the generated Railway domain and create the first account. That first account becomes the admin.

## Why the volume matters

This project uses SQLite. On Railway, normal service storage is ephemeral, so SQLite data will be lost on redeploy unless you attach a persistent Volume. The app now automatically uses `RAILWAY_VOLUME_MOUNT_PATH` when Railway provides it.

## Submission checklist

- Live URL
- GitHub repo
- README
- 2 to 5 minute demo video
