#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
rm -f data/app.db data/app.db-shm data/app.db-wal

node server.js >/tmp/ethara-ai.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true' EXIT

sleep 2

admin=$(curl -s -X POST http://127.0.0.1:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin User","email":"admin@example.com","password":"secret123","role":"admin"}')
admin_token=$(printf '%s' "$admin" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token));')

member=$(curl -s -X POST http://127.0.0.1:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Member User","email":"member@example.com","password":"secret123","role":"member"}')
member_id=$(printf '%s' "$member" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).user.id)));')
member_token=$(printf '%s' "$member" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token));')

project=$(curl -s -X POST http://127.0.0.1:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $admin_token" \
  -d "{\"name\":\"Launch Board\",\"description\":\"Assignment smoke test\",\"memberIds\":[${member_id}]}")
project_id=$(printf '%s' "$project" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).project.id)));')

task=$(curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $admin_token" \
  -d "{\"projectId\":${project_id},\"title\":\"Ship demo\",\"description\":\"Record submission video\",\"status\":\"todo\",\"priority\":\"high\",\"assignedTo\":${member_id}}")
task_id=$(printf '%s' "$task" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).task.id)));')

update=$(curl -s -X PATCH "http://127.0.0.1:3000/api/tasks/${task_id}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $member_token" \
  -d '{"status":"done"}')

dashboard=$(curl -s http://127.0.0.1:3000/api/dashboard \
  -H "Authorization: Bearer $admin_token")

printf 'ADMIN=%s\n' "$admin"
printf 'MEMBER=%s\n' "$member"
printf 'PROJECT=%s\n' "$project"
printf 'TASK=%s\n' "$task"
printf 'UPDATE=%s\n' "$update"
printf 'DASHBOARD=%s\n' "$dashboard"
