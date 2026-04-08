import {
  db, collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
} from "./firebase.js";
import { weekYear, rotationSide, buildWeekTasks } from "./rotation.js";
import { processCarryover } from "./carryover.js";

const DAYS   = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CATS   = ["Produce","Dairy","Meat","Pantry","Frozen","Other"];
const NA     = "Sahana";
const NB     = "Raman";
const HID    = "home";
const week   = weekYear();

let homeWho  = NA, homeDay  = "Monday";
let maintWho = NA, maintPri = 2;
let selCat   = "Produce";
let editId   = null, editWho = NA, editDay = "Monday";
let addDay   = null, addWho  = NA;
let pendingMeal = { date: null, type: null, day: null };

// cached snapshots so re-renders don't need to re-fetch
let tasksCache = {}, mealsCache = {};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await setDoc(doc(db, "households", HID), { nameA: NA, nameB: NB }, { merge: true });
  await maybeBootstrapWeek();
  listenToAll();
  wireStatic();
  document.getElementById("hdr-sub").textContent = todayLabel();
}

async function maybeBootstrapWeek() {
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
}

// ── Firebase listeners ────────────────────────────────────────────────────────
function listenToAll() {
  onSnapshot(collection(db, `households/${HID}/tasks`), snap => {
    tasksCache = {};
    snap.docs.forEach(d => { tasksCache[d.id] = { id: d.id, ...d.data() }; });
    renderHome();
    renderSchedule();
  });
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function wb(w) {
  const c = w === NA ? "wb-s" : w === NB ? "wb-r" : "wb-b";
  return `<span class="who-badge ${c}">${w || "shared"}</span>`;
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric" });
}

function weekLabel() {
  const m = new Date();
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function setHeader(title, sub) {
  document.getElementById("hdr-title").textContent = title;
  document.getElementById("hdr-sub").textContent   = sub;
}

// Renders a who-toggle row and wires click events
function whoRow(containerId, current, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = [NA, NB, "Both"].map(w => {
    const k   = w === NA ? "s" : w === NB ? "r" : "b";
    const sel = current === w ? "sel-" + k : "";
    return `<div class="wt-btn ${sel}">${w}</div>`;
  }).join("");
  el.querySelectorAll(".wt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const w = btn.textContent;
      onChange(w);
      el.querySelectorAll(".wt-btn").forEach(b => b.className = "wt-btn");
      const k = w === NA ? "s" : w === NB ? "r" : "b";
      btn.className = "wt-btn sel-" + k;
    });
  });
}

// Renders day pill row and wires clicks
function dayPills(containerId, current, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = DAYS.map(d =>
    `<div class="dp ${d === current ? "sel" : ""}">${d.slice(0,3)}</div>`
  ).join("");
  el.querySelectorAll(".dp").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      onChange(DAYS[i]);
      el.querySelectorAll(".dp").forEach(b => b.classList.remove("sel"));
      btn.classList.add("sel");
    });
  });
}

function taskRowHTML(t, showActions) {
  const co   = t.carriedOver ? `<span class="co-pill">last week</span>` : "";
  const acts = showActions ? `
    <div class="task-actions">
      <div class="act-btn edit-btn" data-id="${t.id}">Edit</div>
      <div class="act-btn del-btn"  data-id="${t.id}">Delete</div>
    </div>` : "";
  return `<div class="task-row">
    <div class="task-main" data-id="${t.id}">
      <div class="circ ${t.status==="done"?"done":t.carriedOver?"carried":""}"></div>
      <div>
        <div class="t-name ${t.status==="done"?"struck":""}">${t.title} ${co}</div>
        <div class="t-meta">${wb(t.who || t.assignee)}<span>${t.estimatedMins}min</span></div>
      </div>
    </div>${acts}
  </div>`;
}

function wireTaskClicks(container, onToggle) {
  container.querySelectorAll(".task-main").forEach(el => {
    el.addEventListener("click", () => onToggle(el.dataset.id));
  });
}

// ── Render: Home ──────────────────────────────────────────────────────────────
function renderHome() {
  const all      = Object.values(tasksCache).filter(t => t.weekYear === week);
  const dayIdx   = new Date().getDay();
  const todayStr = DAYS[dayIdx === 0 ? 6 : dayIdx - 1];
  const todayT   = all.filter(t => t.day === todayStr);
  const done     = all.filter(t => t.status === "done").length;
  const pct      = all.length ? Math.round(done * 100 / all.length) : 0;

  document.getElementById("progressBar").style.width = pct + "%";
  document.getElementById("progressPct").textContent = pct + "% this week";
  document.getElementById("done-ct").textContent     = done;
  document.getElementById("tot-ct").textContent      = all.length;

  const carried = all.filter(t => t.carriedOver && t.status !== "done");
  const banner  = document.getElementById("carryoverBanner");
  if (carried.length) {
    banner.style.display = "block";
    banner.innerHTML = `<strong>${carried.length} carried over from last week</strong><br>` +
      carried.map(t => `<span class="co-tag">${t.title} · ${t.who}</span>`).join(" ");
  } else banner.style.display = "none";

  const list = document.getElementById("todayList");
  list.innerHTML = todayT.length
    ? todayT.map(t => taskRowHTML(t, false)).join("")
    : `<p class="empty" style="padding:6px 16px">Nothing scheduled today</p>`;

  wireTaskClicks(list, async id => {
    const t = Object.values(tasksCache).find(x => x.id === id);
    if (t) await updateDoc(doc(db, `households/${HID}/tasks`, id),
      { status: t.status === "done" ? "pending" : "done" });
  });
}

// ── Render: Schedule ──────────────────────────────────────────────────────────
function renderSchedule() {
  const all  = Object.values(tasksCache).filter(t => t.weekYear === week);
  const grid = document.getElementById("schedGrid");

  grid.innerHTML = DAYS.map(day => {
    const dt       = all.filter(t => t.day === day);
    const isAdding = addDay === day;
    return `<div class="day-section">
      <div class="day-hdr">
        <span class="day-name">${day}</span>
        <div class="day-add-btn" data-day="${day}">+ Add</div>
      </div>
      <div class="day-add-panel ${isAdding ? "show" : ""}" id="dap-${day}">
        <div class="drawer-label">Task name</div>
        <input class="drawer-input" id="dap-inp-${day}" placeholder="e.g. Clean the oven"/>
        <div class="drawer-label">Assign to</div>
        <div class="who-toggle" id="dap-who-${day}"></div>
        <div class="ep-btns">
          <button class="save-btn" data-day="${day}" id="dap-save-${day}">Add task</button>
          <button class="cancel-btn" id="dap-cancel-${day}">Cancel</button>
        </div>
      </div>
      ${dt.map(t => {
        const isEditing = editId === t.id;
        const ep = isEditing ? `
          <div class="edit-panel show">
            <div class="drawer-label">Task name</div>
            <input class="drawer-input" id="ep-inp-${t.id}" value="${t.title}"/>
            <div class="drawer-label">Assign to</div>
            <div class="who-toggle" id="ep-who-${t.id}"></div>
            <div class="drawer-label">Move to day</div>
            <div class="day-pills" id="ep-day-${t.id}"></div>
            <div class="ep-btns">
              <button class="save-btn" id="ep-save-${t.id}">Save</button>
              <button class="cancel-btn" id="ep-cancel-${t.id}">Cancel</button>
            </div>
          </div>` : `<div class="edit-panel"></div>`;
        return taskRowHTML(t, true) + ep;
      }).join("")}
      ${dt.length === 0 && !isAdding ? `<p class="empty" style="padding:6px 16px">Nothing yet</p>` : ""}
    </div>`;
  }).join("");

  // Wire day add buttons
  grid.querySelectorAll(".day-add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      addDay = btn.dataset.day; addWho = NA; editId = null;
      renderSchedule();
      setTimeout(() => { const i = document.getElementById("dap-inp-" + addDay); if (i) i.focus(); }, 30);
    });
  });

  // Wire add panels
  DAYS.forEach(day => {
    if (addDay === day) whoRow("dap-who-" + day, addWho, w => { addWho = w; });
    const saveBtn = document.getElementById("dap-save-" + day);
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const inp   = document.getElementById("dap-inp-" + day);
      const title = inp ? inp.value.trim() : "";
      if (!title) return;
      const r = doc(collection(db, `households/${HID}/tasks`));
      await setDoc(r, {
        id: r.id, title, day, who: addWho, assignee: addWho,
        category: "chores", status: "pending", weekYear: week,
        carriedOver: false, estimatedMins: 20, notes: ""
      });
      addDay = null;
    });
    const cancelBtn = document.getElementById("dap-cancel-" + day);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { addDay = null; renderSchedule(); });
  });

  // Wire task toggle + edit/delete
  wireTaskClicks(grid, async id => {
    const t = Object.values(tasksCache).find(x => x.id === id);
    if (t) await updateDoc(doc(db, `households/${HID}/tasks`, id),
      { status: t.status === "done" ? "pending" : "done" });
  });

  grid.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = Object.values(tasksCache).find(x => x.id === btn.dataset.id);
      if (!t) return;
      editId = t.id; editWho = t.who || t.assignee; editDay = t.day;
      addDay = null; renderSchedule();
      setTimeout(() => { const i = document.getElementById("ep-inp-" + t.id); if (i) i.focus(); }, 30);
    });
  });

  grid.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, `households/${HID}/tasks`, btn.dataset.id));
      if (editId === btn.dataset.id) editId = null;
    });
  });

  // Wire edit panels
  Object.values(tasksCache).forEach(t => {
    if (editId !== t.id) return;
    whoRow("ep-who-" + t.id, editWho, w => { editWho = w; });
    dayPills("ep-day-" + t.id, editDay, d => { editDay = d; });
    const saveBtn = document.getElementById("ep-save-" + t.id);
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const inp   = document.getElementById("ep-inp-" + t.id);
      const title = inp ? inp.value.trim() : null;
      const updates = { who: editWho, assignee: editWho, day: editDay };
      if (title) updates.title = title;
      await updateDoc(doc(db, `households/${HID}/tasks`, t.id), updates);
      editId = null;
    });
    const cancelBtn = document.getElementById("ep-cancel-" + t.id);
    if (cancelBtn) cancelBtn.addEventListener("click", () => { editId = null; renderSchedule(); });
  });
}

// ── Render: Grocery ───────────────────────────────────────────────────────────
function renderGrocery(obj) {
  const items = Object.values(obj);
  const cats  = [...new Set(items.map(i => i.category))].sort();
  const list  = document.getElementById("groceryList");
  list.innerHTML = cats.map(cat =>
    `<div class="groc-sec">${cat}</div>` +
    items.filter(i => i.category === cat).map(i => `
      <div class="groc-row ${i.checked ? "ck" : ""}" data-id="${i.id}">
        <div class="circ ${i.checked ? "done" : ""}"></div>
        <span>${i.name}</span>
        <span class="groc-qty">${i.qty}</span>
      </div>`).join("")
  ).join("");
  list.querySelectorAll(".groc-row").forEach(row => {
    row.addEventListener("click", async () => {
      const id  = row.dataset.id;
      const itm = Object.values(obj).find(x => x.id === id);
      if (itm) await updateDoc(doc(db, `households/${HID}/grocery`, id), { checked: !itm.checked });
    });
  });
}

// ── Render: Meals ─────────────────────────────────────────────────────────────
function renderMeals() {
  const meals  = Object.values(mealsCache);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const grid = document.getElementById("mealGrid");
  grid.innerHTML = DAYS.map((day, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const date = d.toISOString().split("T")[0];
    return `<div class="meal-row">
      <div class="meal-day-lbl">${day.slice(0,3)}</div>
      ${["breakfast","lunch","dinner"].map(type => {
        const cls = type === "breakfast" ? "mc-b" : type === "lunch" ? "mc-l" : "mc-d";
        const m   = meals.find(x => x.date === date && x.type === type);
        return m
          ? `<div class="mc ${cls}" data-id="${m.id}">${m.name}</div>`
          : `<div class="mc-e" data-date="${date}" data-type="${type}" data-day="${day}">+${type[0].toUpperCase()}</div>`;
      }).join("")}
    </div>`;
  }).join("");
  grid.querySelectorAll(".mc-e").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingMeal = { date: btn.dataset.date, type: btn.dataset.type, day: btn.dataset.day };
      const lbl = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
      document.getElementById("mealAddLabel").textContent =
        "Add " + lbl[pendingMeal.type] + " · " + pendingMeal.day;
      document.getElementById("mealInput").value = "";
      document.getElementById("mealAddPanel").classList.add("show");
      document.getElementById("mealInput").focus();
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
  const items = Object.values(obj).sort((a, b) => a.priority - b.priority);
  const list  = document.getElementById("maintList");
  list.innerHTML = items.map(t => `
    <div class="maint-row ${t.completed ? "done-row" : ""}" data-id="${t.id}">
      <div class="circ ${t.completed ? "done" : ""}"></div>
      <div class="maint-info">
        <div class="maint-title">${t.title}</div>
        <div class="maint-meta">${wb(t.assignee)}<div class="pdot p${t.priority}"></div></div>
      </div>
    </div>`).join("") || `<p class="empty" style="padding:6px 16px">No tasks</p>`;
  list.querySelectorAll(".maint-row").forEach(row => {
    row.addEventListener("click", async () => {
      const id  = row.dataset.id;
      const itm = Object.values(obj).find(x => x.id === id);
      if (itm) await updateDoc(doc(db, `households/${HID}/maintenance`, id), { completed: !itm.completed });
    });
  });
}

// ── Wire static controls (buttons that never re-render) ───────────────────────
function wireStatic() {
  // Who toggles
  whoRow("home-who-row",  homeWho,  w => { homeWho  = w; });
  whoRow("maint-who-row", maintWho, w => { maintWho = w; });

  // Home day pills
  dayPills("home-day-pills", homeDay, d => { homeDay = d; });

  // Category pills
  const catEl = document.getElementById("cat-pills");
  catEl.innerHTML = CATS.map(c =>
    `<div class="dp ${c === selCat ? "sel" : ""}">${c}</div>`
  ).join("");
  catEl.querySelectorAll(".dp").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      selCat = CATS[i];
      catEl.querySelectorAll(".dp").forEach(b => b.classList.remove("sel"));
      btn.classList.add("sel");
    });
  });

  // Priority pills
  const priEl = document.getElementById("pri-pills");
  priEl.innerHTML = ["High","Medium","Low"].map((lbl, i) => {
    const p = i + 1;
    return `<div class="pp ${p === maintPri ? "sel-"+p : ""}">${lbl}</div>`;
  }).join("");
  priEl.querySelectorAll(".pp").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      maintPri = i + 1;
      priEl.querySelectorAll(".pp").forEach((b, j) =>
        b.className = "pp" + (j === i ? " sel-" + (j+1) : ""));
    });
  });

  // Add task
  document.getElementById("add-task-btn").addEventListener("click", async () => {
    const title = document.getElementById("nt").value.trim();
    if (!title) return;
    const r = doc(collection(db, `households/${HID}/tasks`));
    await setDoc(r, {
      id: r.id, title, day: homeDay, who: homeWho, assignee: homeWho,
      category: "chores", status: "pending", weekYear: week,
      carriedOver: false, estimatedMins: 20, notes: ""
    });
    document.getElementById("nt").value = "";
  });

  // Add grocery
  document.getElementById("add-groc-btn").addEventListener("click", async () => {
    const name = document.getElementById("gn").value.trim();
    if (!name) return;
    const qty = document.getElementById("gq").value.trim() || "1";
    const r   = doc(collection(db, `households/${HID}/grocery`));
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
    const name = document.getElementById("mealInput").value.trim();
    if (name && pendingMeal.date) {
      const r = doc(collection(db, `households/${HID}/meals`));
      await setDoc(r, { id: r.id, date: pendingMeal.date, type: pendingMeal.type, name, cook: "shared" });
    }
    document.getElementById("mealAddPanel").classList.remove("show");
    pendingMeal = { date: null, type: null, day: null };
  });
  document.getElementById("cancel-meal-btn").addEventListener("click", () => {
    document.getElementById("mealAddPanel").classList.remove("show");
    pendingMeal = { date: null, type: null, day: null };
  });

  // Add maintenance
  document.getElementById("add-maint-btn").addEventListener("click", async () => {
    const title = document.getElementById("mn").value.trim();
    if (!title) return;
    const r = doc(collection(db, `households/${HID}/maintenance`));
    await setDoc(r, { id: r.id, title, assignee: maintWho, priority: maintPri, completed: false });
    document.getElementById("mn").value = "";
  });

  // Nav
  const navLabels = {
    home:     ["HomeSync",     todayLabel()],
    schedule: ["Schedule",     "Week of " + weekLabel()],
    grocery:  ["Grocery",      "Shopping list"],
    meals:    ["Meal planner", weekLabel()],
    tasks:    ["Home tasks",   "Maintenance & more"]
  };
  ["home","schedule","grocery","meals","tasks"].forEach(tab => {
    document.getElementById("n-" + tab).addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("on"));
      document.querySelectorAll(".ni").forEach(n  => n.classList.remove("on"));
      document.getElementById("tab-" + tab).classList.add("on");
      document.getElementById("n-"   + tab).classList.add("on");
      const [title, sub] = navLabels[tab];
      setHeader(title, sub);
    });
  });
}

function showCarryoverBanner(tasks) {
  const b = document.getElementById("carryoverBanner");
  b.style.display = "block";
  b.innerHTML = `<strong>${tasks.length} tasks carried over from last week</strong><br>` +
    tasks.map(t => `<span class="co-tag">${t.title} · ${t.who}</span>`).join(" ");
}

init();
