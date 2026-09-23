# CollabSpace: collaborative workspace

A Notion and Trello style workspace for small teams. Create a workspace, plan work on kanban boards, write shared pages, and see who is online.

**Stack:** React 19 + Vite, Node.js serverless functions on Vercel, MongoDB Atlas, JWT sessions in HttpOnly cookies, bcrypt.

## Features
- **Workspaces** with an invite code and three roles: owner, editor, viewer (enforced on the server, not just hidden in the UI)
- **Kanban boards**: drag and drop cards between columns, edit details (assignee, labels, due date), add, rename and delete columns
- **Shared pages** with a block editor (headings, text, to-dos, bullets, quotes, code). Every edit is an atomic per-block update in MongoDB, so two people editing different blocks never overwrite each other
- **Near real-time sync** by short polling (boards every 3 s, pages every 2.5 s, paused while the tab is hidden), with optimistic updates
- **Presence**: heartbeat every 10 s shows who is online and where
- **Activity feed** of everything that changes in a workspace

### About "real-time"
Vercel serverless functions cannot hold WebSocket connections, so this app syncs with polling. The trade-off is a delay of a few seconds instead of instant pushes. Swapping the polling hook for a WebSocket or Server-Sent Events service would not change the data model.

## API
One serverless function (`api/[...path].js`) routes every request, because the free Vercel plan limits a deployment to 12 functions.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Workspaces | `GET/POST /workspaces`, `POST /workspaces/join`, `GET /workspaces/:id`, `PATCH/DELETE /workspaces/:id/members/:userId`, `GET /workspaces/:id/activity`, `POST /workspaces/:id/presence` |
| Boards | `POST /workspaces/:id/boards`, `GET/DELETE /boards/:id`, column routes under `/boards/:id/columns` |
| Cards | `POST /boards/:id/cards`, `PATCH/DELETE /cards/:id` |
| Pages | `POST /workspaces/:id/pages`, `GET/PATCH/DELETE /pages/:id`, block routes under `/pages/:id/blocks` |

## Run it locally
```bash
npm install
npm run build
```
The API needs a `MONGODB_URI` environment variable and Vercel's function runtime, so run `vercel dev` (or deploy to Vercel and add `MONGODB_URI` as an environment variable). Data goes to the `collab_workspace` database.

This is a public demo database: please do not enter real personal details.
