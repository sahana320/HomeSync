import {
  db, collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
} from "./firebase.js";
import { weekYear, rotationSide, buildWeekTasks } from "./rotation.js";
import { processCarryover } from "./carryover.js";

const DAYS  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CATS  = ["Produce","Dairy","Meat","Pantry","Frozen","Other"];
const NA    = "Sahana";
const NB    = "Raman";
const HID   = "home";
const week  = weekYear();

// ── UI state ──────────────────────────────────────────────────────────────────
let quickWho = NA, quickDay = "Monday";
let maintWho = NA, maintPri = 2;
let selCat   = "Produce";
let modalWho = NA, editModalWho = NA;
let editingTaskId = null;
let pendingMeal   = { date: null, type: null, day: null };

// data caches
let tasksCache = {}, mealsCache = {};

// ── Sync status helper ────────────────────────────────────────────────────────
function setSyncStatus(state, text) {
  const dot = document.getElementById("sync-dot");
  const txt = document.getElementById("sync-text");
  if (dot) dot.className = "sync-dot " + state;
  if (txt) txt.textContent = text;
}

function hideLoading() {
  const el = document.getElementById("loading-screen");
  if (!el) return;
  el.style.opacity = "0";
  el.style.transition = "opacity .4s";
  setTimeout(() => el.style.display = "none", 400);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  setSyncStatus("saving", "Connecting...");
  try {
    await setDoc(doc(db, "households", HID), { nameA: NA, nameB: NB }, { merge: true });
    await maybeBootstrapWeek();
    setSyncStatus("live", "Live ✓");
  } catch (e) {
    console.error("Firebase init error:", e);
    setSyncStatus("error", "Connection error");
  }
  hideLoading();
  wireStatic();
  setDashDate();
  setWeekLabel();
  listenToAll();
}

async function maybeBootstrapWeek() {
  try {
    const snap = await getDocs(
      query(collection(db, `households/${HID}/tasks`), where("weekYear","==",week))
    );
    if (snap.empty) {
      const tasks = buildWeekTasks(NA, NB, rotationSide(), week);
      const batch = writeBatch(db);
      tasks.forEach(t => {
        const r = doc(collection(db, `households/${HID}/tasks`));
        batch.set(r, { ...t, id: r.id });
      });
      await batch.commit();
      const carried = await processCarryover(HID);
      if (carried.length) showCarryoverBanner(carried);
    }
  } catch(e) { console.error("Bootstrap error:", e); }
}

// ── Real-time listeners ───────────────────────────────────────────────────────
function listenToAll() {
  onSnapshot(collection(db, `households/${HID}/tasks`), snap => {
    tasksCache = {};
    snap.docs.forEach(d => { tasksCache[d.id] = { id: d.id, ...d.data() }; });
    renderDashboard();
    renderSchedule();
    setSyncStatus("live", "Live ✓");
  }, e => { console.error(e); setSyncStatus("error", "Sync error"); });

  onSnapshot(collection(db, `households/${HID}/grocery`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderGrocery(data);
  });

  onSnapshot(collection(db, `households/${HID}/meals`), snap => {
    mealsCache = {};
    snap.docs.forEach(d => { mealsCache[d.id] = { id: d.id, ...d.data() }; });
    renderMeals();
  });

  onSnapshot(collection(db, `households/${HID}/maintenance`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderMaint(data);
  });
}

// ── Nav ───────────────────────────────────────────────────────────────────────
window.showPage = (page) => {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  document.querySelector(`[data-page="${page}"]`).classList.add("active");
};

// ── Modals ────────────────────────────────────────────────────────────────────
window.openModal = (id) => document.getElementById(id).classList.add("open");
window.closeModal = (id) => document.getElementById(id).classList.remove("open");
document.querySelectorAll(".modal-overlay").forEach(el => {
  el.addEventListener("click", e => { if (e.target === el) el.classList.remove("open"); });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function wb(w) {
  const c = w === NA ? "wb-s" : w === NB ? "wb-r" : "wb-b";
  return `<span class="who-badge ${c}">${w || "shared"}</span>`;
}

function setDashDate() {
  const el = document.getElementById("dash-date");
  if (el) el.textContent = new Date().toLocaleDateString("en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function setWeekLabel() {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const end = new Date(monday); end.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lbl = `Week of ${fmt(monday)} – ${fmt(end)}`;
  ["sched-week-label","meals-week-label"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = lbl;
  });
}

function whoToggleHTML(id, current) {
  return `<div class="who-toggle" id="${id}">` +
    [NA, NB, "Both"].map(w => {
      const k   = w === NA ? "s" : w === NB ? "r" : "b";
      const sel = current === w ? " wt-" + k : "";
      return `<div class="wt-btn${sel}" data-who="${w}" data-toggle="${id}">${w}</div>`;
    }).join("") + `</div>`;
}

function pillRowHTML(id, items, current) {
  return `<div class="pill-row" id="${id}">` +
    items.map(v => `<div class="pill${v === current ? " active" : ""}" data-val="${v}">${v}</div>`).join("") +
    `</div>`;
}

// Global toggle handler for who buttons and pills
document.addEventListener("click", e => {
  const whoBtn = e.target.closest("[data-toggle]");
  if (whoBtn) {
    const toggleId = whoBtn.dataset.toggle;
    const w        = whoBtn.dataset.who;
    document.querySelectorAll(`[data-toggle="${toggleId}"]`).forEach(b => {
      const k = b.dataset.who === NA ? "s" : b.dataset.who === NB ? "r" : "b";
      b.className = "wt-btn" + (b.dataset.who === w ? " wt-" + k : "");
    });
    if (toggleId === "quick-who-toggle")  quickWho    = w;
    if (toggleId === "maint-who-toggle")  maintWho    = w;
    if (toggleId === "modal-who-toggle")  modalWho    = w;
    if (toggleId === "edit-who-toggle")   editModalWho = w;
  }
  const pill = e.target.closest(".pill-row .pill");
  if (pill) {
    const row = pill.closest(".pill-row");
    row.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    const rowId = row.id;
    if (rowId === "quick-day-pills") quickDay = pill.dataset.val;
    if (rowId === "cat-pills")       selCat   = pill.dataset.val;
    if (rowId === "pri-pills")       maintPri = parseInt(pill.dataset.val);
  }
});

// ── Static controls ───────────────────────────────────────────────────────────
function wireStatic() {
  // Quick add who toggle
  const qwt = document.getElementById("quick-who-toggle");
  if (qwt) qwt.outerHTML = whoToggleHTML("quick-who-toggle", NA).replace('id="quick-who-toggle"', 'id="quick-who-toggle"');
  setWhoToggle("quick-who-toggle", NA);

  // Quick day pills
  const qdp = document.getElementById("quick-day-pills");
  if (qdp) qdp.outerHTML = pillRowHTML("quick-day-pills", DAYS.map(d => d.slice(0,3)), "Mon").replace('id="quick-day-pills"', 'id="quick-day-pills"');
  buildPillRow("quick-day-pills",  DAYS.map(d=>d.slice(0,3)), "Mon",    v => quickDay = DAYS[DAYS.map(d=>d.slice(0,3)).indexOf(v)]);
  buildPillRow("cat-pills",        CATS,                       "Produce", v => selCat   = v);
  buildPriPills();
  setWhoToggle("quick-who-toggle", NA);
  setWhoToggle("maint-who-toggle", NA);
  buildModalWhoToggle("modal-who-toggle");
  buildModalWhoToggle("edit-who-toggle");

  // Quick add task
  document.getElementById("quick-add-btn").addEventListener("click", async () => {
    const title = document.getElementById("quick-title").value.trim();
    if (!title) return;
    const r = doc(collection(db, `households/${HID}/tasks`));
    await setDoc(r, {
      id: r.id, title, day: quickDay, who: quickWho, assignee: quickWho,
      category: "chores", status: "pending", weekYear: week,
      carriedOver: false, estimatedMins: 20, notes: ""
    });
    document.getElementById("quick-title").value = "";
    setSyncStatus("live", "Saved ✓");
  });

  // Add grocery
  document.getElementById("add-groc-btn").addEventListener("click", async () => {
    const name = document.getElementById("gn").value.trim();
    if (!name) return;
    const qty  = document.getElementById("gq").value.trim() || "1";
    const r = doc(collection(db, `households/${HID}/grocery`));
    await setDoc(r, { id: r.id, name, qty, category: selCat, checked: false });
    document.getElementById("gn").value = "";
    document.getElementById("gq").value = "";
  });

  // Clear grocery
  document.getElementById("clr-groc-btn").addEventListener("click", async () => {
    const snap  = await getDocs(collection(db, `households/${HID}/grocery`));
    const batch = writeBatch(db);
    snap.docs.forEach(d => { if (d.data().checked) batch.delete(d.ref); });
    await batch.commit();
  });

  // Meal confirm/cancel
  document.getElementById("confirm-meal-btn").addEventListener("click", async () => {
    const name = document.getElementById("meal-input").value.trim();
    if (name && pendingMeal.date) {
      const r = doc(collection(db, `households/${HID}/meals`));
      await setDoc(r, { id: r.id, date: pendingMeal.date, type: pendingMeal.type, name, cook: "shared" });
    }
    document.getElementById("meal-add-panel").style.display = "none";
    pendingMeal = { date: null, type: null, day: null };
  });
  document.getElementById("cancel-meal-btn").addEventListener("click", () => {
    document.getElementById("meal-add-panel").style.display = "none";
  });

  // Add maintenance
  document.getElementById("add-maint-btn").addEventListener("click", async () => {
    const title = document.getElementById("mn").value.trim();
    if (!title) return;
    const due   = document.getElementById("maint-due").value;
    const r     = doc(collection(db, `households/${HID}/maintenance`));
    await setDoc(r, { id: r.id, title, assignee: maintWho, priority: maintPri, dueDate: due, completed: false });
    document.getElementById("mn").value       = "";
    document.getElementById("maint-due").value = "";
  });

  // Schedule modal — save new task
  document.getElementById("modal-save-task-btn").addEventListener("click", async () => {
    const title = document.getElementById("modal-task-title").value.trim();
    const day   = document.getElementById("modal-task-day").value;
    const mins  = parseInt(document.getElementById("modal-task-mins").value) || 20;
    if (!title) return;
    const r = doc(collection(db, `households/${HID}/tasks`));
    await setDoc(r, {
      id: r.id, title, day, who: modalWho, assignee: modalWho,
      category: "chores", status: "pending", weekYear: week,
      carriedOver: false, estimatedMins: mins, notes: ""
    });
    document.getElementById("modal-task-title").value = "";
    closeModal("modal-add-task");
  });

  // Edit modal — save changes
  document.getElementById("modal-update-task-btn").addEventListener("click", async () => {
    const id    = editingTaskId;
    const title = document.getElementById("edit-task-title").value.trim();
    const day   = document.getElementById("edit-task-day").value;
    if (!id || !title) return;
    await updateDoc(doc(db, `households/${HID}/tasks`, id), { title, day, who: editModalWho, assignee: editModalWho });
    closeModal("modal-edit-task");
    editingTaskId = null;
  });
}

function setWhoToggle(id, current) {
  const container = document.getElementById(id);
  if (!container) return;
  container.innerHTML = [NA, NB, "Both"].map(w => {
    const k   = w === NA ? "s" : w === NB ? "r" : "b";
    const sel = w === current ? " wt-" + k : "";
    return `<div class="wt-btn${sel}" data-who="${w}" data-toggle="${id}">${w}</div>`;
  }).join("");
}

function buildModalWhoToggle(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = [NA, NB, "Both"].map(w => {
    const k = w === NA ? "s" : w === NB ? "r" : "b";
    return `<div class="wt-btn" data-who="${w}" data-toggle="${id}">${w}</div>`;
  }).join("");
  // default to first
  const first = el.querySelector(".wt-btn");
  if (first) {
    const w = first.dataset.who;
    const k = w === NA ? "s" : w === NB ? "r" : "b";
    first.className = "wt-btn wt-" + k;
    if (id === "modal-who-toggle") modalWho = w;
    if (id === "edit-who-toggle")  editModalWho = w;
  }
}

function buildPillRow(containerId, items, defaultVal, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map((v, i) =>
    `<div class="pill${i === 0 ? " active" : ""}" data-val="${v}">${v}</div>`
  ).join("");
  el.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.val);
    });
  });
}

function buildPriPills() {
  const el = document.getElementById("pri-pills");
  if (!el) return;
  const labels = ["High","Medium","Low"];
  el.innerHTML = labels.map((lbl, i) =>
    `<div class="pill${i+1 === maintPri ? " active" : ""}" data-val="${i+1}">${lbl}</div>`
  ).join("");
  el.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      maintPri = parseInt(btn.dataset.val);
    });
  });
}

// ── Render: Dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  const all      = Object.values(tasksCache).filter(t => t.weekYear === week);
  const dayIdx   = new Date().getDay();
  const todayStr = DAYS[dayIdx === 0 ? 6 : dayIdx - 1];
  const todayT   = all.filter(t => t.day === todayStr);
  const done     = all.filter(t => t.status === "done").length;
  const pct      = all.length ? Math.round(done * 100 / all.length) : 0;

  const el = id => document.getElementById(id);
  if (el("stat-done"))     el("stat-done").textContent     = pct + "%";
  if (el("stat-done-sub")) el("stat-done-sub").textContent = `${done} of ${all.length} done`;

  const remaining = todayT.filter(t => t.status !== "done").length;
  if (el("stat-today"))     el("stat-today").textContent     = remaining;
  if (el("stat-today-sub")) el("stat-today-sub").textContent = remaining === 1 ? "remaining" : "remaining";

  const sahanaTasks = all.filter(t => (t.who || t.assignee) === NA);
  const ramanTasks  = all.filter(t => (t.who || t.assignee) === NB);
  if (el("stat-sahana-ct")) el("stat-sahana-ct").textContent =
    `${sahanaTasks.filter(t=>t.status==="done").length}/${sahanaTasks.length} done`;
  if (el("stat-raman-ct"))  el("stat-raman-ct").textContent  =
    `${ramanTasks.filter(t=>t.status==="done").length}/${ramanTasks.length} done`;

  if (el("week-progress-fill")) el("week-progress-fill").style.width = pct + "%";

  // Week breakdown by day
  const breakdown = el("week-breakdown");
  if (breakdown) {
    breakdown.innerHTML = DAYS.map(day => {
      const dt   = all.filter(t => t.day === day);
      const dpct = dt.length ? Math.round(dt.filter(t=>t.status==="done").length*100/dt.length) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;">
        <div style="width:72px;color:var(--ink-soft);font-size:12px;">${day.slice(0,3)}</div>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:6px;width:${dpct}%;background:var(--sage);border-radius:3px;transition:width .4s"></div>
        </div>
        <div style="width:32px;text-align:right;color:var(--ink-muted);font-size:12px;">${dt.filter(t=>t.status==="done").length}/${dt.length}</div>
      </div>`;
    }).join("");
  }

  // Today's tasks list
  const list = el("today-list");
  if (list) {
    if (!todayT.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">Nothing scheduled for ${todayStr}</div></div>`;
    } else {
      list.innerHTML = todayT.map(t => {
        const co = t.carriedOver ? `<span class="co-pill">last week</span>` : "";
        return `<div class="task-row">
          <div class="task-check${t.status==="done"?" done":""}" data-id="${t.id}" data-status="${t.status}"></div>
          <div class="task-name${t.status==="done"?" struck":""}"> ${t.title}${co}</div>
          <div class="task-meta">${wb(t.who || t.assignee)}</div>
        </div>`;
      }).join("");
      list.querySelectorAll(".task-check").forEach(btn => {
        btn.addEventListener("click", async () => {
          const status = btn.dataset.status;
          await updateDoc(doc(db, `households/${HID}/tasks`, btn.dataset.id),
            { status: status === "done" ? "pending" : "done" });
        });
      });
    }
  }
}

// ── Render: Schedule ──────────────────────────────────────────────────────────
function renderSchedule() {
  const all  = Object.values(tasksCache).filter(t => t.weekYear === week);
  const grid = document.getElementById("sched-grid");
  if (!grid) return;

  grid.innerHTML = DAYS.map(day => {
    const dt = all.filter(t => t.day === day);
    const tasks = dt.map(t => `
      <div class="sched-task">
        <div class="sched-task-check${t.status==="done"?" done":""}" data-id="${t.id}" data-status="${t.status}"></div>
        <div class="sched-task-info">
          <div class="sched-task-name${t.status==="done"?" struck":""}">${t.title}${t.carriedOver?`<span class="co-pill">last week</span>`:""}</div>
          <div style="margin-top:3px">${wb(t.who || t.assignee)}</div>
        </div>
        <div class="sched-task-actions">
          <button class="sched-task-btn sched-edit-btn" data-id="${t.id}">Edit</button>
          <button class="sched-task-btn sched-del-btn"  data-id="${t.id}">Del</button>
        </div>
      </div>`).join("");

    return `<div class="sched-day">
      <div class="sched-day-hdr">
        <div class="sched-day-name">${day}</div>
        <div class="sched-day-add" data-day="${day}">+ Add</div>
      </div>
      <div class="sched-tasks">
        ${tasks || `<div class="sched-empty">Rest day</div>`}
      </div>
    </div>`;
  }).join("");

  // Toggle task done
  grid.querySelectorAll(".sched-task-check").forEach(btn => {
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, `households/${HID}/tasks`, btn.dataset.id),
        { status: btn.dataset.status === "done" ? "pending" : "done" });
    });
  });

  // Open add modal prefilled with day
  grid.querySelectorAll(".sched-day-add").forEach(btn => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      document.getElementById("modal-task-day").value = day;
      document.getElementById("modal-task-title").value = "";
      buildModalWhoToggle("modal-who-toggle");
      openModal("modal-add-task");
    });
  });

  // Edit
  grid.querySelectorAll(".sched-edit-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const t  = Object.values(tasksCache).find(x => x.id === id);
      if (!t) return;
      editingTaskId = id;
      document.getElementById("edit-task-title").value = t.title;
      document.getElementById("edit-task-day").value   = t.day;
      editModalWho = t.who || t.assignee || NA;
      setWhoToggle("edit-who-toggle", editModalWho);
      openModal("modal-edit-task");
    });
  });

  // Delete
  grid.querySelectorAll(".sched-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, `households/${HID}/tasks`, btn.dataset.id));
    });
  });
}

// ── Render: Grocery ───────────────────────────────────────────────────────────
function renderGrocery(obj) {
  const items  = Object.values(obj);
  const cats   = [...new Set(items.map(i => i.category))].sort();
  const active = items.filter(i => !i.checked).length;
  const sub    = document.getElementById("groc-subtitle");
  if (sub) sub.textContent = `${active} item${active !== 1 ? "s" : ""} remaining`;

  const list = document.getElementById("grocery-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-text">Your list is empty</div></div>`;
    return;
  }
  list.innerHTML = cats.map(cat => {
    const catItems = items.filter(i => i.category === cat);
    return `<div class="groc-section">${cat}</div>
      <div class="card" style="padding:0 20px;margin-bottom:12px">
        ${catItems.map(i => `
          <div class="groc-row${i.checked?" ck":""}" data-id="${i.id}" data-checked="${i.checked}">
            <div class="groc-check${i.checked?" done":""}"></div>
            <span>${i.name}</span>
            <span class="groc-qty">${i.qty}</span>
          </div>`).join("")}
      </div>`;
  }).join("");

  list.querySelectorAll(".groc-row").forEach(row => {
    row.addEventListener("click", async () => {
      const checked = row.dataset.checked === "true";
      await updateDoc(doc(db, `households/${HID}/grocery`, row.dataset.id), { checked: !checked });
    });
  });
}

// ── Render: Meals ─────────────────────────────────────────────────────────────
function renderMeals() {
  const meals  = Object.values(mealsCache);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const grid = document.getElementById("meal-grid");
  if (!grid) return;

  grid.innerHTML = DAYS.map((day, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const date = d.toISOString().split("T")[0];
    return `<div class="meal-row">
      <div class="meal-day-lbl">${day}</div>
      ${["breakfast","lunch","dinner"].map(type => {
        const cls = type === "breakfast" ? "mc-b" : type === "lunch" ? "mc-l" : "mc-d";
        const m   = meals.find(x => x.date === date && x.type === type);
        return m
          ? `<div class="mc ${cls}" data-id="${m.id}">${m.name}</div>`
          : `<div class="mc-e" data-date="${date}" data-type="${type}" data-day="${day}">+ ${type.slice(0,1).toUpperCase()}</div>`;
      }).join("")}
    </div>`;
  }).join("");

  grid.querySelectorAll(".mc-e").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingMeal = { date: btn.dataset.date, type: btn.dataset.type, day: btn.dataset.day };
      const lbl = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
      document.getElementById("meal-add-label").textContent =
        `Add ${lbl[pendingMeal.type]} · ${pendingMeal.day}`;
      document.getElementById("meal-input").value = "";
      document.getElementById("meal-add-panel").style.display = "block";
      document.getElementById("meal-input").focus();
    });
  });

  grid.querySelectorAll(".mc").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, `households/${HID}/meals`, btn.dataset.id));
    });
  });
}

// ── Render: Maintenance ───────────────────────────────────────────────────────
function renderMaint(obj) {
  const items = Object.values(obj);
  const list  = document.getElementById("maint-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-text">No home tasks yet</div></div>`;
    return;
  }
  const cats = { 1: "High Priority", 2: "Medium Priority", 3: "Low Priority" };
  const grouped = { 1: [], 2: [], 3: [] };
  items.forEach(t => grouped[t.priority] ? grouped[t.priority].push(t) : grouped[2].push(t));

  list.innerHTML = [1, 2, 3].map(pri => {
    const group = grouped[pri].sort((a,b) => a.completed - b.completed);
    if (!group.length) return "";
    return `<div class="maint-section-hdr">${cats[pri]}</div>
      <div class="card" style="padding:0 20px;margin-bottom:12px">
        ${group.map(t => `
          <div class="maint-row${t.completed?" done-row":""}" data-id="${t.id}" data-completed="${t.completed}">
            <div class="maint-check${t.completed?" done":""}"></div>
            <div class="maint-info">
              <div class="maint-title">${t.title}</div>
              <div class="maint-meta">
                ${wb(t.assignee)}
                ${t.dueDate ? `<span>Due ${new Date(t.dueDate + "T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>` : ""}
                <div class="pri-dot pri-${t.priority}"></div>
              </div>
            </div>
          </div>`).join("")}
      </div>`;
  }).join("");

  list.querySelectorAll(".maint-row").forEach(row => {
    row.addEventListener("click", async () => {
      const completed = row.dataset.completed === "true";
      await updateDoc(doc(db, `households/${HID}/maintenance`, row.dataset.id), { completed: !completed });
    });
  });
}

// ── Carryover banner ──────────────────────────────────────────────────────────
function showCarryoverBanner(tasks) {
  const b = document.getElementById("carryover-banner");
  if (!b) return;
  b.style.display = "block";
  b.innerHTML = `<strong>${tasks.length} tasks carried over from last week</strong><br>` +
    tasks.map(t => `<span class="co-tag">${t.title} · ${t.who}</span>`).join(" ");
}

init();
