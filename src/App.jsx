import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell, AuthProvider, AuthScreen, Avatar, Badge, Empty, ErrorNote, Field, Loading, Modal, ToastProvider,
  ago, api, useApi, useAsync, useAuth, useHashRoute, useToast,
} from "./kit.jsx";

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) {
    return (
      <AuthScreen
        title="CollabSpace"
        tagline="Plan work on boards and write it down on shared pages, together."
        points={["Kanban boards with drag and drop", "Pages that sync between teammates", "Owner, editor and viewer roles", "See who is online right now"]}
      />
    );
  }
  return <Router />;
}

function Router() {
  const { path, go } = useHashRoute("/");
  const m = path.match(/^\/(w|b|p)\/([a-f0-9]{24})/);
  const nav = [{ to: "/", label: "Workspaces" }];
  return (
    <AppShell brand="CollabSpace" mark="C" nav={nav} path={path} go={go}>
      {!m && <Home go={go} />}
      {m && m[1] === "w" && <WorkspaceFrame id={m[2]} kind="w" />}
      {m && m[1] === "b" && <WorkspaceFrame boardId={m[2]} kind="b" />}
      {m && m[1] === "p" && <WorkspaceFrame pageId={m[2]} kind="p" />}
    </AppShell>
  );
}

/* ---------- Home ---------- */
function Home({ go }) {
  const { data, loading, error, reload } = useApi("/workspaces");
  const { busy, run } = useAsync();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const create = async (e) => {
    e.preventDefault();
    const ws = await run(() => api("/workspaces", { method: "POST", body: { name } }), "Workspace created");
    if (ws) go(`/w/${ws.id}`);
  };
  const join = async (e) => {
    e.preventDefault();
    const res = await run(() => api("/workspaces/join", { method: "POST", body: { code } }), "Joined the workspace");
    if (res) go(`/w/${res.id}`);
  };
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Your workspaces</h1><p>Every workspace has its own boards, pages and people.</p></div>
      </div>
      <div className="grid cols-2">
        <form className="card stack-sm" onSubmit={create}>
          <h3>Create a workspace</h3>
          <div className="row"><input className="input" placeholder="e.g. Design team" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" disabled={busy}>Create</button></div>
        </form>
        <form className="card stack-sm" onSubmit={join}>
          <h3>Join with an invite code</h3>
          <div className="row"><input className="input mono" placeholder="8-character code" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn ghost" disabled={busy}>Join</button></div>
        </form>
      </div>
      {loading && <Loading />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty title="No workspaces yet">Create one above to get a starter board and a welcome page.</Empty>}
      <div className="auto-grid">
        {(data || []).map((w) => (
          <a key={w.id} href={`#/w/${w.id}`} className="card hover stack-sm" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="row between"><h3 style={{ margin: 0 }}>{w.name}</h3><Badge kind="accent">{w.role}</Badge></div>
            <p className="muted small" style={{ margin: 0 }}>{w.members.length} member{w.members.length === 1 ? "" : "s"} · created {ago(w.createdAt)}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------- Workspace frame: sidebar + presence + content ---------- */
function WorkspaceFrame({ id, boardId, pageId, kind }) {
  const board = useApi(`/boards/${boardId}`, { skip: kind !== "b", poll: 3000 });
  const page = useApi(`/pages/${pageId}`, { skip: kind !== "p", poll: 3000 });
  const wsId = kind === "w" ? id : kind === "b" ? board.data && board.data.workspaceId : page.data && page.data.workspaceId;
  const ws = useApi(`/workspaces/${wsId}`, { skip: !wsId, poll: 6000 });
  const [online, setOnline] = useState([]);
  const where = kind === "w" ? "Overview" : kind === "b" ? "a board" : "a page";

  useEffect(() => {
    if (!wsId) return undefined;
    const beat = () => api(`/workspaces/${wsId}/presence`, { method: "POST", body: { where } }).then(setOnline).catch(() => {});
    beat();
    const t = setInterval(() => !document.hidden && beat(), 10000);
    return () => clearInterval(t);
  }, [wsId, where]);

  const err = (kind === "b" && board.error) || (kind === "p" && page.error) || ws.error;
  if (err && !ws.data) return <ErrorNote message={err} />;
  if (!ws.data) return <Loading />;
  const w = ws.data;
  return (
    <div className="ws-layout">
      <aside className="ws-side card flat">
        <a href={`#/w/${w.id}`} className="ws-title">{w.name}</a>
        <div className="muted small">{w.role}</div>
        <SideList title="Boards" items={w.boards.map((b) => ({ id: b.id, label: b.name, href: `#/b/${b.id}`, active: b.id === boardId }))}
          onAdd={async (name) => { const b = await api(`/workspaces/${w.id}/boards`, { method: "POST", body: { name } }); window.location.hash = `/b/${b.id}`; }} canAdd={w.role !== "viewer"} label="New board" />
        <SideList title="Pages" items={w.pages.map((p) => ({ id: p.id, label: p.title, href: `#/p/${p.id}`, active: p.id === pageId }))}
          onAdd={async (title) => { const p = await api(`/workspaces/${w.id}/pages`, { method: "POST", body: { title } }); window.location.hash = `/p/${p.id}`; }} canAdd={w.role !== "viewer"} label="New page" />
        <div>
          <div className="side-h">Online now</div>
          <div className="row wrap" style={{ gap: "0.35rem" }}>
            {online.map((u) => <span key={u.userId} title={`${u.name} - ${u.where}`}><Avatar name={u.name} /></span>)}
          </div>
        </div>
      </aside>
      <section className="ws-main">
        {kind === "w" && <Overview ws={w} reload={ws.reload} />}
        {kind === "b" && (board.data ? <BoardView data={board.data} setData={board.setData} reload={board.reload} /> : board.error ? <ErrorNote message={board.error} /> : <Loading />)}
        {kind === "p" && (page.data ? <PageView key={page.data.id} data={page.data} /> : page.error ? <ErrorNote message={page.error} /> : <Loading />)}
      </section>
    </div>
  );
}

function SideList({ title, items, onAdd, canAdd, label }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    try { await onAdd(value); setValue(""); setAdding(false); } catch (err) { toast(err.message, "error"); }
  };
  return (
    <div>
      <div className="side-h">{title}</div>
      <nav className="side-list">
        {items.map((i) => <a key={i.id} href={i.href} className={i.active ? "active" : ""}>{i.label}</a>)}
      </nav>
      {canAdd && (adding ? (
        <form onSubmit={submit} className="row" style={{ marginTop: "0.4rem" }}>
          <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={label} onBlur={() => !value && setAdding(false)} />
        </form>
      ) : <button className="btn ghost sm" style={{ marginTop: "0.4rem" }} onClick={() => setAdding(true)}>+ {label}</button>)}
    </div>
  );
}

/* ---------- Overview: members + activity ---------- */
function Overview({ ws, reload }) {
  const { user } = useAuth();
  const activity = useApi(`/workspaces/${ws.id}/activity`, { poll: 5000 });
  const { run } = useAsync();
  const isOwner = ws.role === "owner";
  const setRole = (uid, role) => run(() => api(`/workspaces/${ws.id}/members/${uid}`, { method: "PATCH", body: { role } }).then(reload), "Role updated");
  const remove = (uid) => run(() => api(`/workspaces/${ws.id}/members/${uid}`, { method: "DELETE" }).then(reload), "Member removed");
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{ws.name}</h1><p>Overview of your team and what changed recently.</p></div></div>
      {isOwner && (
        <div className="card row between wrap">
          <div><b>Invite teammates</b><p className="muted small" style={{ margin: 0 }}>Share this code. New members join as editors.</p></div>
          <span className="kbd" style={{ fontSize: "1.1rem", letterSpacing: "0.15em" }}>{ws.inviteCode}</span>
        </div>
      )}
      <div className="grid cols-2">
        <div className="card stack-sm">
          <h3>Members ({ws.members.length})</h3>
          {ws.members.map((m) => (
            <div key={m.userId} className="row">
              <Avatar name={m.name} />
              <div className="grow"><b>{m.name}</b>{m.userId === user.id && <span className="muted small"> (you)</span>}<div className="muted small">{m.email}</div></div>
              {isOwner && m.role !== "owner" ? (
                <>
                  <select className="input" style={{ width: "auto" }} value={m.role} onChange={(e) => setRole(m.userId, e.target.value)}><option>editor</option><option>viewer</option></select>
                  <button className="btn ghost sm" onClick={() => remove(m.userId)}>Remove</button>
                </>
              ) : <Badge kind={m.role === "owner" ? "accent" : ""}>{m.role}</Badge>}
            </div>
          ))}
        </div>
        <div className="card stack-sm">
          <h3>Recent activity</h3>
          {!activity.data && <Loading />}
          {activity.data && activity.data.length === 0 && <p className="muted">Nothing yet.</p>}
          {(activity.data || []).map((a) => (
            <div key={a.id} className="row small"><Avatar name={a.userName} /><span className="grow"><b>{a.userName}</b> {a.text}</span><span className="muted">{ago(a.at)}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Board ---------- */
function BoardView({ data, setData, reload }) {
  const toast = useToast();
  const readOnly = data.role === "viewer";
  const [editing, setEditing] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [adding, setAdding] = useState({});

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(data.columns.map((c) => [c.id, []]));
    data.cards.forEach((c) => map[c.columnId] && map[c.columnId].push(c));
    Object.values(map).forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [data]);

  const guard = async (fn) => {
    try { await fn(); } catch (e) { toast(e.message, "error"); reload(); }
  };

  const addCard = (columnId) => guard(async () => {
    const title = (adding[columnId] || "").trim();
    if (!title) return;
    setAdding({ ...adding, [columnId]: "" });
    const card = await api(`/boards/${data.id}/cards`, { method: "POST", body: { columnId, title } });
    setData((d) => ({ ...d, cards: [...d.cards, card] }));
  });

  const drop = (columnId, e) => guard(async () => {
    e.preventDefault();
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const list = byColumn[columnId].filter((c) => c.id !== id);
    const nodes = [...e.currentTarget.querySelectorAll("[data-card]")].filter((n) => n.dataset.card !== id);
    let index = nodes.findIndex((n) => e.clientY < n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2);
    if (index < 0) index = list.length;
    const prev = list[index - 1];
    const next = list[index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1024 : next ? next.position / 2 : 1024;
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, columnId, position } : c)) }));
    await api(`/cards/${id}`, { method: "PATCH", body: { columnId, position } });
  });

  const addColumn = () => {
    const title = window.prompt("Column name");
    if (title) guard(async () => { const col = await api(`/boards/${data.id}/columns`, { method: "POST", body: { title } }); setData((d) => ({ ...d, columns: [...d.columns, col] })); });
  };
  const renameColumn = (col) => {
    const title = window.prompt("Rename column", col.title);
    if (title && title !== col.title) guard(async () => { await api(`/boards/${data.id}/columns/${col.id}`, { method: "PATCH", body: { title } }); reload(true); });
  };
  const deleteColumn = (col) => guard(async () => { await api(`/boards/${data.id}/columns/${col.id}`, { method: "DELETE" }); reload(true); });

  return (
    <div className="stack">
      <div className="page-head"><div><h1>{data.name}</h1><p>{data.cards.length} cards · syncs automatically every few seconds{readOnly ? " · you have view-only access" : ""}</p></div>
        {!readOnly && <button className="btn ghost" onClick={addColumn}>+ Column</button>}</div>
      <div className="kanban">
        {data.columns.map((col) => (
          <div key={col.id} className={`column${overCol === col.id ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }} onDragLeave={() => setOverCol(null)} onDrop={(e) => drop(col.id, e)}>
            <div className="row between column-head">
              <b>{col.title} <span className="muted small">{byColumn[col.id].length}</span></b>
              {!readOnly && (
                <span className="row" style={{ gap: "0.2rem" }}>
                  <button className="icon-btn sm" onClick={() => renameColumn(col)} aria-label={`Rename ${col.title}`}>✎</button>
                  <button className="icon-btn sm" onClick={() => deleteColumn(col)} aria-label={`Delete ${col.title}`}>×</button>
                </span>
              )}
            </div>
            <div className="cards">
              {byColumn[col.id].map((c) => (
                <div key={c.id} data-card={c.id} className={`kcard${dragId === c.id ? " dragging" : ""}`} draggable={!readOnly} onDragStart={() => setDragId(c.id)} onDragEnd={() => setDragId(null)} onClick={() => setEditing(c)}>
                  <div>{c.title}</div>
                  {(c.labels.length > 0 || c.due || c.assignee) && (
                    <div className="row wrap" style={{ gap: "0.3rem", marginTop: "0.4rem" }}>
                      {c.labels.map((l) => <Badge key={l} kind="accent">{l}</Badge>)}
                      {c.due && <Badge kind={new Date(c.due) < new Date() ? "danger" : ""}>{new Date(c.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Badge>}
                      {c.assignee && <Badge>{c.assignee}</Badge>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!readOnly && (
              <form onSubmit={(e) => { e.preventDefault(); addCard(col.id); }}>
                <input className="input" placeholder="+ Add a card" value={adding[col.id] || ""} onChange={(e) => setAdding({ ...adding, [col.id]: e.target.value })} />
              </form>
            )}
          </div>
        ))}
      </div>
      {editing && <CardModal card={editing} members={data.members} readOnly={readOnly} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(true); }} />}
    </div>
  );
}

function CardModal({ card, members, readOnly, onClose, onSaved }) {
  const [f, setF] = useState({ title: card.title, description: card.description, assignee: card.assignee, labels: card.labels.join(", "), due: card.due ? card.due.slice(0, 10) : "" });
  const { busy, run } = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const res = await run(() => api(`/cards/${card.id}`, { method: "PATCH", body: { ...f, labels: f.labels.split(",").map((l) => l.trim()).filter(Boolean), due: f.due || null } }), "Card saved");
    if (res) onSaved();
  };
  const del = async () => { if (await run(() => api(`/cards/${card.id}`, { method: "DELETE" }), "Card deleted")) onSaved(); };
  return (
    <Modal title="Card" onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <Field label="Title"><input className="input" value={f.title} onChange={set("title")} disabled={readOnly} /></Field>
        <Field label="Description"><textarea className="input" value={f.description} onChange={set("description")} disabled={readOnly} /></Field>
        <div className="grid cols-2">
          <Field label="Assignee"><select className="input" value={f.assignee} onChange={set("assignee")} disabled={readOnly}><option value="">Unassigned</option>{members.map((m) => <option key={m.userId}>{m.name}</option>)}</select></Field>
          <Field label="Due date"><input className="input" type="date" value={f.due} onChange={set("due")} disabled={readOnly} /></Field>
        </div>
        <Field label="Labels (comma separated)"><input className="input" value={f.labels} onChange={set("labels")} disabled={readOnly} /></Field>
        {!readOnly && <div className="row between"><button type="button" className="btn danger" onClick={del} disabled={busy}>Delete</button><button className="btn" disabled={busy}>Save</button></div>}
      </form>
    </Modal>
  );
}

/* ---------- Page (block editor) ---------- */
const TYPES = { text: "Text", h1: "Heading 1", h2: "Heading 2", todo: "To-do", bullet: "Bullet", quote: "Quote", code: "Code" };

function PageView({ data }) {
  const toast = useToast();
  const readOnly = data.role === "viewer";
  const [blocks, setBlocks] = useState(data.blocks);
  const [title, setTitle] = useState(data.title);
  const dirty = useRef(new Set());
  const timers = useRef({});
  const focused = useRef(null);
  const focusNext = useRef(null);
  const live = useApi(`/pages/${data.id}`, { poll: 2500 });

  useEffect(() => {
    if (!live.data) return;
    setBlocks((local) => {
      const localById = new Map(local.map((b) => [b.id, b]));
      return live.data.blocks.map((sb) => {
        const lb = localById.get(sb.id);
        return lb && (dirty.current.has(sb.id) || focused.current === sb.id) ? { ...sb, text: lb.text } : sb;
      });
    });
    if (document.activeElement && document.activeElement.dataset.title === undefined) setTitle((t) => (live.data.title !== t && document.activeElement.dataset.title !== "1" ? live.data.title : t));
  }, [live.data]);

  useEffect(() => {
    if (focusNext.current) {
      const el = document.querySelector(`[data-block="${focusNext.current}"]`);
      if (el) el.focus();
      focusNext.current = null;
    }
  });

  const patch = useCallback((id, body) => api(`/pages/${data.id}/blocks/${id}`, { method: "PATCH", body }).catch((e) => toast(e.message, "error")), [data.id, toast]);

  const edit = (id, text) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, text } : b)));
    dirty.current.add(id);
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => { await patch(id, { text }); dirty.current.delete(id); }, 450);
  };
  const setType = (id, type) => { setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, type } : b))); patch(id, { type }); };
  const toggle = (id, checked) => { setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, checked } : b))); patch(id, { checked }); };
  const addAfter = async (id, type = "text") => {
    try {
      const block = await api(`/pages/${data.id}/blocks`, { method: "POST", body: { type, afterId: id } });
      setBlocks((bs) => { const i = bs.findIndex((b) => b.id === id); const next = [...bs]; next.splice(i + 1, 0, block); return next; });
      focusNext.current = block.id;
    } catch (e) { toast(e.message, "error"); }
  };
  const remove = async (id) => {
    if (blocks.length <= 1) return;
    const i = blocks.findIndex((b) => b.id === id);
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    focusNext.current = blocks[i - 1] ? blocks[i - 1].id : blocks[i + 1] && blocks[i + 1].id;
    try { await api(`/pages/${data.id}/blocks/${id}`, { method: "DELETE" }); } catch (e) { toast(e.message, "error"); }
  };
  const saveTitle = () => title.trim() && title !== data.title && api(`/pages/${data.id}`, { method: "PATCH", body: { title } }).catch((e) => toast(e.message, "error"));
  const deletePage = async () => {
    if (!window.confirm("Delete this page for everyone?")) return;
    await api(`/pages/${data.id}`, { method: "DELETE" });
    window.location.hash = `/w/${data.workspaceId}`;
  };

  return (
    <div className="page-doc stack">
      <div className="row between wrap">
        <span className="muted small">Last edited by {live.data ? live.data.updatedBy : data.updatedBy} · {ago(live.data ? live.data.updatedAt : data.updatedAt)}{readOnly && " · view only"}</span>
        {!readOnly && <button className="btn ghost sm" onClick={deletePage}>Delete page</button>}
      </div>
      <input data-title="1" className="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} disabled={readOnly} aria-label="Page title" />
      <div className="blocks">
        {blocks.map((b) => (
          <div key={b.id} className={`block block-${b.type}`}>
            {b.type === "todo" && <input type="checkbox" checked={b.checked} disabled={readOnly} onChange={(e) => toggle(b.id, e.target.checked)} aria-label="Done" />}
            {b.type === "bullet" && <span className="bullet">•</span>}
            <AutoTextarea
              value={b.text}
              disabled={readOnly}
              blockId={b.id}
              className={b.checked ? "done" : ""}
              placeholder={b.type === "h1" ? "Heading" : "Type something, press Enter for a new block"}
              onFocus={() => (focused.current = b.id)}
              onBlur={() => { if (focused.current === b.id) focused.current = null; }}
              onChange={(text) => edit(b.id, text)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && b.type !== "code") { e.preventDefault(); addAfter(b.id, b.type === "todo" || b.type === "bullet" ? b.type : "text"); }
                if (e.key === "Backspace" && b.text === "") { e.preventDefault(); remove(b.id); }
              }}
            />
            {!readOnly && (
              <select className="type-pick" value={b.type} onChange={(e) => setType(b.id, e.target.value)} aria-label="Block type">
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AutoTextarea({ value, onChange, blockId, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  return <textarea ref={ref} rows={1} data-block={blockId} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
