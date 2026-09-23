const crypto = require("crypto");
const { createApp, bad, forbidden, notFound, oid, clean, str, oneOf, created } = require("./http");
const { addAuthRoutes } = require("./authRoutes");

const app = createApp({
  app: "collab-workspace",
  dbName: "collab_workspace",
  setup: async (db) => {
    await db.collection("presence").createIndex({ workspaceId: 1, userId: 1 }, { unique: true });
    await db.collection("presence").createIndex({ seenAt: 1 }, { expireAfterSeconds: 3600 });
  },
});
addAuthRoutes(app);

const rid = () => crypto.randomBytes(6).toString("hex");
const ROLES = ["owner", "editor", "viewer"];

/* ---------- helpers ---------- */
async function loadWorkspace(db, id, user, { write = false, owner = false } = {}) {
  const ws = await db.collection("workspaces").findOne({ _id: oid(id) });
  if (!ws) throw notFound("Workspace not found.");
  const member = ws.members.find((m) => m.userId === user.id);
  if (!member) throw forbidden("You are not a member of this workspace.");
  if (owner && member.role !== "owner") throw forbidden("Only the owner can do that.");
  if (write && member.role === "viewer") throw forbidden("Viewers can look but not edit.");
  return { ws, role: member.role };
}

async function log(db, workspaceId, user, text) {
  await db.collection("activity").insertOne({ workspaceId: String(workspaceId), userId: user.id, userName: user.name, text, at: new Date() });
}

const blockTypes = ["h1", "h2", "text", "todo", "bullet", "code", "quote"];
const newBlock = (type = "text", text = "") => ({ id: rid(), type: oneOf(type, blockTypes, "Block type"), text: String(text).slice(0, 4000), checked: false });

/* ---------- workspaces ---------- */
app.get("/workspaces", { auth: true }, async ({ db, user }) => {
  const list = await db.collection("workspaces").find({ "members.userId": user.id }).sort({ createdAt: -1 }).toArray();
  return list.map((w) => ({ ...clean(w), role: w.members.find((m) => m.userId === user.id).role, inviteCode: undefined }));
});

app.post("/workspaces", { auth: true }, async ({ db, user, body }) => {
  const name = str(body.name, { min: 2, max: 60, label: "Workspace name" });
  const ws = {
    name,
    ownerId: user.id,
    inviteCode: crypto.randomBytes(4).toString("hex").toUpperCase(),
    members: [{ userId: user.id, name: user.name, email: user.email, role: "owner" }],
    createdAt: new Date(),
  };
  const { insertedId } = await db.collection("workspaces").insertOne(ws);
  const workspaceId = String(insertedId);
  const columns = [{ id: rid(), title: "To do" }, { id: rid(), title: "In progress" }, { id: rid(), title: "Done" }];
  const board = await db.collection("boards").insertOne({ workspaceId, name: "Product roadmap", columns, createdAt: new Date() });
  const seed = [
    ["Sketch the onboarding flow", 0], ["Review the launch checklist", 0], ["Build the invite screen", 1], ["Set up the workspace", 2],
  ];
  await db.collection("cards").insertMany(
    seed.map(([title, col], i) => ({
      boardId: String(board.insertedId), workspaceId, columnId: columns[col].id, title, description: "", assignee: "", labels: [], due: null,
      position: (i + 1) * 1024, createdBy: user.name, createdAt: new Date(), updatedAt: new Date(),
    })),
  );
  await db.collection("pages").insertOne({
    workspaceId, title: "Welcome to CollabSpace", createdAt: new Date(), updatedAt: new Date(), updatedBy: user.name,
    blocks: [
      newBlock("h1", "Welcome to CollabSpace"),
      newBlock("text", "Pages are shared with everyone in the workspace. Open this page in two windows and type in each: edits to different blocks never overwrite each other."),
      newBlock("todo", "Invite a teammate with the invite code"),
      newBlock("todo", "Drag a card on the board"),
      newBlock("code", "// blocks can hold code too\nconsole.log('hello team');"),
    ],
  });
  await log(db, workspaceId, user, "created the workspace");
  return created({ ...clean({ _id: insertedId, ...ws }), role: "owner" });
});

app.post("/workspaces/join", { auth: true }, async ({ db, user, body }) => {
  const code = str(body.code, { min: 1, max: 20, label: "Invite code" }).toUpperCase();
  const ws = await db.collection("workspaces").findOne({ inviteCode: code });
  if (!ws) throw notFound("That invite code does not match a workspace.");
  if (ws.members.some((m) => m.userId === user.id)) return { id: String(ws._id), alreadyMember: true };
  await db.collection("workspaces").updateOne({ _id: ws._id }, { $push: { members: { userId: user.id, name: user.name, email: user.email, role: "editor" } } });
  await log(db, ws._id, user, "joined the workspace");
  return { id: String(ws._id) };
});

app.get("/workspaces/:id", { auth: true }, async ({ db, user, params }) => {
  const { ws, role } = await loadWorkspace(db, params.id, user);
  const id = String(ws._id);
  const [boards, pages] = await Promise.all([
    db.collection("boards").find({ workspaceId: id }).sort({ createdAt: 1 }).project({ name: 1 }).toArray(),
    db.collection("pages").find({ workspaceId: id }).sort({ createdAt: 1 }).project({ title: 1, updatedAt: 1 }).toArray(),
  ]);
  return { ...clean(ws), inviteCode: role === "owner" ? ws.inviteCode : undefined, role, boards: boards.map(clean), pages: pages.map(clean) };
});

app.patch("/workspaces/:id/members/:userId", { auth: true }, async ({ db, user, params, body }) => {
  const { ws } = await loadWorkspace(db, params.id, user, { owner: true });
  const role = oneOf(body.role, ["editor", "viewer"], "Role");
  if (params.userId === ws.ownerId) throw bad("The owner's role cannot change.");
  const res = await db.collection("workspaces").updateOne({ _id: ws._id, "members.userId": params.userId }, { $set: { "members.$.role": role } });
  if (!res.matchedCount) throw notFound("Member not found.");
  await log(db, ws._id, user, `changed a member's role to ${role}`);
  return { ok: true };
});

app.delete("/workspaces/:id/members/:userId", { auth: true }, async ({ db, user, params }) => {
  const { ws } = await loadWorkspace(db, params.id, user, { owner: true });
  if (params.userId === ws.ownerId) throw bad("The owner cannot be removed.");
  await db.collection("workspaces").updateOne({ _id: ws._id }, { $pull: { members: { userId: params.userId } } });
  await log(db, ws._id, user, "removed a member");
  return { ok: true };
});

app.get("/workspaces/:id/activity", { auth: true }, async ({ db, user, params }) => {
  await loadWorkspace(db, params.id, user);
  const items = await db.collection("activity").find({ workspaceId: params.id }).sort({ at: -1 }).limit(30).toArray();
  return items.map(clean);
});

/* ---------- presence (who is online right now) ---------- */
app.post("/workspaces/:id/presence", { auth: true }, async ({ db, user, params, body }) => {
  await loadWorkspace(db, params.id, user);
  await db.collection("presence").updateOne(
    { workspaceId: params.id, userId: user.id },
    { $set: { name: user.name, where: str(body.where, { max: 60 }), seenAt: new Date() } },
    { upsert: true },
  );
  const since = new Date(Date.now() - 25 * 1000);
  const online = await db.collection("presence").find({ workspaceId: params.id, seenAt: { $gte: since } }).toArray();
  return online.map((p) => ({ userId: p.userId, name: p.name, where: p.where }));
});

/* ---------- boards ---------- */
app.post("/workspaces/:id/boards", { auth: true }, async ({ db, user, params, body }) => {
  const { ws } = await loadWorkspace(db, params.id, user, { write: true });
  const name = str(body.name, { min: 2, max: 60, label: "Board name" });
  const columns = [{ id: rid(), title: "To do" }, { id: rid(), title: "Doing" }, { id: rid(), title: "Done" }];
  const { insertedId } = await db.collection("boards").insertOne({ workspaceId: String(ws._id), name, columns, createdAt: new Date() });
  await log(db, ws._id, user, `created the board "${name}"`);
  return created({ id: String(insertedId), name });
});

async function loadBoard(db, id, user, opts) {
  const board = await db.collection("boards").findOne({ _id: oid(id) });
  if (!board) throw notFound("Board not found.");
  const { ws, role } = await loadWorkspace(db, board.workspaceId, user, opts);
  return { board, ws, role };
}

app.get("/boards/:id", { auth: true }, async ({ db, user, params }) => {
  const { board, ws, role } = await loadBoard(db, params.id, user);
  const cards = await db.collection("cards").find({ boardId: params.id }).sort({ position: 1 }).toArray();
  return { ...clean(board), role, members: ws.members.map((m) => ({ userId: m.userId, name: m.name })), cards: cards.map(clean) };
});

app.delete("/boards/:id", { auth: true }, async ({ db, user, params }) => {
  const { board, ws } = await loadBoard(db, params.id, user, { owner: true });
  await db.collection("cards").deleteMany({ boardId: params.id });
  await db.collection("boards").deleteOne({ _id: board._id });
  await log(db, ws._id, user, `deleted the board "${board.name}"`);
  return { ok: true };
});

app.post("/boards/:id/columns", { auth: true }, async ({ db, user, params, body }) => {
  const { board } = await loadBoard(db, params.id, user, { write: true });
  const title = str(body.title, { min: 1, max: 40, label: "Column title" });
  if (board.columns.length >= 8) throw bad("A board can have at most 8 columns.");
  const column = { id: rid(), title };
  await db.collection("boards").updateOne({ _id: board._id }, { $push: { columns: column } });
  return created(column);
});

app.patch("/boards/:id/columns/:columnId", { auth: true }, async ({ db, user, params, body }) => {
  const { board } = await loadBoard(db, params.id, user, { write: true });
  const title = str(body.title, { min: 1, max: 40, label: "Column title" });
  await db.collection("boards").updateOne({ _id: board._id, "columns.id": params.columnId }, { $set: { "columns.$.title": title } });
  return { ok: true };
});

app.delete("/boards/:id/columns/:columnId", { auth: true }, async ({ db, user, params }) => {
  const { board } = await loadBoard(db, params.id, user, { write: true });
  if (board.columns.length <= 1) throw bad("A board needs at least one column.");
  if (await db.collection("cards").findOne({ boardId: params.id, columnId: params.columnId })) throw bad("Move or delete the cards in this column first.");
  await db.collection("boards").updateOne({ _id: board._id }, { $pull: { columns: { id: params.columnId } } });
  return { ok: true };
});

/* ---------- cards ---------- */
function cardFields(body) {
  const out = {};
  if (body.title !== undefined) out.title = str(body.title, { min: 1, max: 140, label: "Title" });
  if (body.description !== undefined) out.description = str(body.description, { max: 4000 });
  if (body.assignee !== undefined) out.assignee = str(body.assignee, { max: 80 });
  if (body.labels !== undefined) out.labels = (Array.isArray(body.labels) ? body.labels : []).map((l) => str(l, { max: 20 })).filter(Boolean).slice(0, 5);
  if (body.due !== undefined) {
    out.due = body.due ? new Date(body.due) : null;
    if (out.due && Number.isNaN(out.due.getTime())) throw bad("Due date is not valid.");
  }
  return out;
}

app.post("/boards/:id/cards", { auth: true }, async ({ db, user, params, body }) => {
  const { board, ws } = await loadBoard(db, params.id, user, { write: true });
  if (!board.columns.some((c) => c.id === body.columnId)) throw bad("Unknown column.");
  const last = await db.collection("cards").find({ boardId: params.id, columnId: body.columnId }).sort({ position: -1 }).limit(1).toArray();
  const card = {
    boardId: params.id, workspaceId: String(ws._id), columnId: body.columnId, description: "", assignee: "", labels: [], due: null,
    ...cardFields({ title: body.title }), position: (last[0] ? last[0].position : 0) + 1024, createdBy: user.name, createdAt: new Date(), updatedAt: new Date(),
  };
  const { insertedId } = await db.collection("cards").insertOne(card);
  await log(db, ws._id, user, `added "${card.title}"`);
  return created(clean({ _id: insertedId, ...card }));
});

app.patch("/cards/:id", { auth: true }, async ({ db, user, params, body }) => {
  const card = await db.collection("cards").findOne({ _id: oid(params.id) });
  if (!card) throw notFound("Card not found.");
  const { board, ws } = await loadBoard(db, card.boardId, user, { write: true });
  const set = { ...cardFields(body), updatedAt: new Date() };
  if (body.columnId !== undefined) {
    if (!board.columns.some((c) => c.id === body.columnId)) throw bad("Unknown column.");
    set.columnId = body.columnId;
  }
  if (body.position !== undefined) set.position = Number(body.position) || card.position;
  await db.collection("cards").updateOne({ _id: card._id }, { $set: set });
  if (set.columnId && set.columnId !== card.columnId) {
    const to = board.columns.find((c) => c.id === set.columnId).title;
    await log(db, ws._id, user, `moved "${card.title}" to ${to}`);
  }
  return clean({ ...card, ...set });
});

app.delete("/cards/:id", { auth: true }, async ({ db, user, params }) => {
  const card = await db.collection("cards").findOne({ _id: oid(params.id) });
  if (!card) throw notFound("Card not found.");
  const { ws } = await loadBoard(db, card.boardId, user, { write: true });
  await db.collection("cards").deleteOne({ _id: card._id });
  await log(db, ws._id, user, `deleted "${card.title}"`);
  return { ok: true };
});

/* ---------- pages (block editor; every edit is an atomic per-block update) ---------- */
async function loadPage(db, id, user, opts) {
  const page = await db.collection("pages").findOne({ _id: oid(id) });
  if (!page) throw notFound("Page not found.");
  const { ws, role } = await loadWorkspace(db, page.workspaceId, user, opts);
  return { page, ws, role };
}
const touch = (user) => ({ updatedAt: new Date(), updatedBy: user.name });

app.post("/workspaces/:id/pages", { auth: true }, async ({ db, user, params, body }) => {
  const { ws } = await loadWorkspace(db, params.id, user, { write: true });
  const title = str(body.title || "Untitled page", { min: 1, max: 80, label: "Title" });
  const page = { workspaceId: String(ws._id), title, blocks: [newBlock("text", "")], createdAt: new Date(), ...touch(user) };
  const { insertedId } = await db.collection("pages").insertOne(page);
  await log(db, ws._id, user, `created the page "${title}"`);
  return created(clean({ _id: insertedId, ...page }));
});

app.get("/pages/:id", { auth: true }, async ({ db, user, params }) => {
  const { page, role } = await loadPage(db, params.id, user);
  return { ...clean(page), role };
});

app.patch("/pages/:id", { auth: true }, async ({ db, user, params, body }) => {
  const { page } = await loadPage(db, params.id, user, { write: true });
  await db.collection("pages").updateOne({ _id: page._id }, { $set: { title: str(body.title, { min: 1, max: 80, label: "Title" }), ...touch(user) } });
  return { ok: true };
});

app.delete("/pages/:id", { auth: true }, async ({ db, user, params }) => {
  const { page, ws } = await loadPage(db, params.id, user, { write: true });
  await db.collection("pages").deleteOne({ _id: page._id });
  await log(db, ws._id, user, `deleted the page "${page.title}"`);
  return { ok: true };
});

app.post("/pages/:id/blocks", { auth: true }, async ({ db, user, params, body }) => {
  const { page } = await loadPage(db, params.id, user, { write: true });
  const block = newBlock(body.type || "text", body.text || "");
  const index = page.blocks.findIndex((b) => b.id === body.afterId);
  const update = index >= 0 ? { $push: { blocks: { $each: [block], $position: index + 1 } } } : { $push: { blocks: block } };
  await db.collection("pages").updateOne({ _id: page._id }, { ...update, $set: touch(user) });
  return created(block);
});

app.patch("/pages/:id/blocks/:blockId", { auth: true }, async ({ db, user, params, body }) => {
  const { page } = await loadPage(db, params.id, user, { write: true });
  const set = {};
  if (body.text !== undefined) set["blocks.$.text"] = str(body.text, { max: 4000 });
  if (body.checked !== undefined) set["blocks.$.checked"] = Boolean(body.checked);
  if (body.type !== undefined) set["blocks.$.type"] = oneOf(body.type, blockTypes, "Block type");
  const res = await db.collection("pages").updateOne({ _id: page._id, "blocks.id": params.blockId }, { $set: { ...set, ...touch(user) } });
  if (!res.matchedCount) throw notFound("That block was deleted by someone else.");
  return { ok: true };
});

app.delete("/pages/:id/blocks/:blockId", { auth: true }, async ({ db, user, params }) => {
  const { page } = await loadPage(db, params.id, user, { write: true });
  if (page.blocks.length <= 1) throw bad("A page needs at least one block.");
  await db.collection("pages").updateOne({ _id: page._id }, { $pull: { blocks: { id: params.blockId } }, $set: touch(user) });
  return { ok: true };
});

module.exports = app;
