import {
  db, collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
} from "./firebase.js";
import { weekYear, rotationSide, buildWeekTasks } from "./rotation.js";
import { processCarryover } from "./carryover.js";

const DAYS    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CATS    = ["Produce","Dairy","Meat","Pantry","Frozen","Other"];
const NAME_A  = "Sahana";
const NAME_B  = "Raman";
const HID     = "home";
const week    = weekYear();

// ── UI state ──────────────────────────────────────────────────────────────────
let homeWho   = NAME_A, homeDay  = "Monday";
let maintWho  = NAME_A, maintPri = 2;
let selCat    = "Produce";
let editingId = null,   editWho  = NAME_A, editDay = "Monday";
let addingDay = null,   addWho   = NAME_A;
let pendingMeal = { date: null, type: null };

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await setDoc(doc(db, "households", HID), { nameA: NAME_A, nameB: NAME_B }, { merge: true });
  await maybeBootstrapWeek();
  listenToAll();
  buildStaticControls();
  setHeader("HomeSync", todayLabel());
}

async function maybeBootstrapWeek() {
  const snap = await getDocs(
    query(collection(db, `households/${HID}/tasks`), where("weekYear","==",week))
  );
  if (snap.empty) {
    const tasks = buildWeekTasks(NAME_A, NAME_B, rotationSide(), week);
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

// ── Listeners ─────────────────────────────────────────────────────────────────
function listenToAll() {
  onSnapshot(collection(db, `households/${HID}/tasks`), snap => {
    const d = {};
    snap.docs.forEach(x => { d[x.id] = { id: x.id, ...x.data() }; });
    renderHome(d);
    renderSchedule(d);
  });
  onSnapshot(collection(db, `households/${HID}/grocery`), snap => {
    const d = {};
    snap.docs.forEach(x => { d[x.id] = { id: x.id, ...x.data() }; });
    renderGrocery(d);
  });
  onSnapshot(collection(db, `households/${HID}/meals`), snap => {
    const d = {};
    snap.docs.forEach(x => { d[x.id] = { id: x.id, ...x.data() }; });
    renderMeals(d);
  });
  onSnapshot(collection(db, `households/${HID}/maintenance`), snap => {
    const d = {};
    snap.docs.forEach(x => { d[x.id] = { id: x.id, ...x.data() }; });
    renderMaint(d);
  });
}

// ── Event delegation — all clicks handled here, no inline onclick ─────────────
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id     = el.dataset.id;
  const val    = el.dataset.val;
  const day    = el.dataset.day;
  const type   = el.dataset.type;
  const date   = el.dataset.date;

  switch (action) {

    // ── Nav ──
    case "nav": {
      const labels = {
        home: ["HomeSync", todayLabel()],
        schedule: ["Schedule", "Week of " + weekLabel()],
        grocery:  ["Grocery",  "Shopping list"],
        meals:    ["Meal planner", weekLabel()],
        tasks:    ["Home tasks", "Maintenance & more"]
      };
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("on"));
      document.querySelectorAll(".ni").forEach(n => n.classList.remove("on"));
      document.getElementById("tab-" + val).classList.add("on");
      document.getElementById("n-" + val).classList.add("on");
      const [title, sub] = labels[val] || ["HomeSync", ""];
      setHeader(title, sub);
      break;
    }

    // ── Tasks ──
    case "toggle-task": {
      const status = el.dataset.status;
      await updateDoc(doc(db, `households/${HID}/tasks`, id),
        { status: status === "done" ? "pending" : "done" });
      break;
    }
    case "add-task": {
      const titleEl = document.getElementById("nt");
      const title   = titleEl.value.trim();
      if (!title) return;
      const r = doc(collection(db, `households/${HID}/tasks`));
      await setDoc(r, {
        id: r.id, title, day: homeDay, who: homeWho, assignee: homeWho,
        category: "chores", status: "pending", weekYear: week,
        carriedOver: false, estimatedMins: 20, notes: ""
      });
      titleEl.value = "";
      break;
    }
    case "home-who": {
      homeWho = val;
      highlightWho("home", val);
      break;
    }
    case "home-day": {
      homeDay = val;
      highlightDay("home-day-pills", val);
      break;
    }

    // ── Schedule ──
    case "open-day-add": {
      addingDay = day; addWho = NAME_A; editingId = null;
      renderScheduleFromCache();
      setTimeout(() => {
        const inp = document.getElementById("dap-input-" + day);
        if (inp) inp.focus();
      }, 50);
      break;
    }
    case "close-day-add": {
      addingDay = null;
      renderScheduleFromCache();
      break;
    }
    case "confirm-day-add": {
      const inp   = document.getElementById("dap-input-" + day);
      const title = inp ? inp.value.trim() : "";
      if (!title) return;
      const r = doc(collection(db, `households/${HID}/tasks`));
      await setDoc(r, {
        id: r.id, title, day: addingDay || day, who: addWho, assignee: addWho,
        category: "chores", status: "pending", weekYear: week,
        carriedOver: false, estimatedMins: 20, notes: ""
      });
      addingDay = null;
      break;
    }
    case "add-who": {
      addWho = val;
      highlightWhoInPanel("dap-who-" + day, val);
      break;
    }
    case "open-edit": {
      editingId = id; editWho = el.dataset.who; editDay = el.dataset.editday;
      addingDay = null;
      renderScheduleFromCache();
      setTimeout(() => {
        const inp = document.getElementById("ep-" + id);
        if (inp) inp.focus();
      }, 50);
      break;
    }
    case "cancel-edit": {
      editingId = null;
      renderScheduleFromCache();
      break;
    }
    case "edit-who": {
      editWho = val;
      highlightWhoInPanel("edit-who-" + id, val);
      break;
    }
    case "edit-day": {
      editDay = val;
      highlightDay("edit-day-" + id, val);
      break;
    }
    case "save-edit": {
      const inp   = document.getElementById("ep-" + id);
      const title = inp ? inp.value.trim() : null;
      const updates = { who: editWho, assignee: editWho, day: editDay };
      if (title) updates.title = title;
      await updateDoc(doc(db, `households/${HID}/tasks`, id), updates);
      editingId = null;
      break;
    }
    case "delete-task": {
      await deleteDoc(doc(db, `households/${HID}/tasks`, id));
      if (editingId === id) editingId = null;
      break;
    }

    // ── Grocery ──
    case "toggle-grocery": {
      const checked = el.dataset.checked === "true";
      await updateDoc(doc(db, `households/${HID}/grocery`, id), { checked: !checked });
      break;
    }
    case "add-grocery": {
      const name = document.getElementById("gn").value.trim();
      const qty  = document.getElementById("gq").value.trim() || "1";
      if (!name) return;
      const r = doc(collection(db, `households/${HID}/grocery`));
      await setDoc(r, { id: r.id, name, qty, category: selCat, checked: false });
      document.getElementById("gn").value = "";
      document.getElementById("gq").value = "";
      break;
    }
    case "clear-grocery": {
      const snap  = await getDocs(collection(db, `households/${HID}/grocery`));
      const batch = writeBatch(db);
      snap.docs.forEach(d => { if (d.data().checked) batch.delete(d.ref); });
      await batch.commit();
      break;
    }
    case "groc-cat": {
      selCat = val;
      highlightDay("cat-pills", val);
      break;
    }

    // ── Meals ──
    case "open-meal": {
      pendingMeal = { date, type };
      const lbl = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
      document.getElementById("mealAddLabel").textContent =
        "Add " + lbl[type] + " · " + date;
      document.getElementById("mealInput").value = "";
      document.getElementById("mealAddPanel").classList.add("show");
      document.getElementById("mealInput").focus();
      break;
    }
    case "confirm-meal": {
      const name = document.getElementById("mealInput").value.trim();
      if (name && pendingMeal.date) {
        const r = doc(collection(db, `households/${HID}/meals`));
        await setDoc(r, { id: r.id, date: pendingMeal.date, type: pendingMeal.type, name, cook: "shared" });
      }
      document.getElementById("mealAddPanel").classList.remove("show");
      pendingMeal = { date: null, type: null };
      break;
    }
    case "cancel-meal": {
      document.getElementById("mealAddPanel").classList.remove("show");
      pendingMeal = { date: null, type: null };
      break;
    }
    case "remove-meal": {
      await deleteDoc(doc(db, `households/${HID}/meals`, id));
      break;
    }

    // ── Maintenance ──
    case "toggle-maint": {
      const completed = el.dataset.completed === "true";
      await updateDoc(doc(db, `households/${HID}/maintenance`, id), { completed: !completed });
      break;
    }
    case "add-maint": {
      const title = document.getElementById("mn").value.trim();
      if (!title) return;
      const r = doc(collection(db, `households/${HID}/maintenance`));
      await setDoc(r, { id: r.id, title, assignee: maintWho, priority: maintPri, completed: false });
      document.getElementById("mn").value = "";
      break;
    }
    case "maint-who": {
      maintWho = val;
      highlightWho("maint", val);
      break;
    }
    case "pri": {
      maintPri = parseInt(val);
      highlightPri(maintPri);
      break;
    }
  }
});

// ── Highlight helpers ─────────────────────────────────────────────────────────
function highlightWho(ctx, w) {
  const prefix = ctx === "home" ? "wt" : "mwt";
  ["s","r","b"].forEach(k => {
    const el = document.getElementById(prefix + "-" + k);
    if (el) el.className = "wt-btn";
  });
  const key = w === NAME_A ? "s" : w === NAME_B ? "r" : "b";
  const el  = document.getElementById(prefix + "-" + key);
  if (el) el.className = "wt-btn sel-" + key;
}

function highlightWhoInPanel(containerId, w) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll(".wt-btn").forEach(btn => {
    btn.className = "wt-btn";
    const k = btn.dataset.val === NAME_A ? "s" : btn.dataset.val === NAME_B ? "r" : "b";
    if (btn.dataset.val === w) btn.className = "wt-btn sel-" + k;
  });
}

function highlightDay(containerId, val) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll(".dp").forEach(btn => {
    btn.className = btn.dataset.val === val ? "dp sel" : "dp";
  });
}

function highlightPri(p) {
  document.querySelectorAll("#pri-pills .pp").forEach(el => {
    const v = parseInt(el.dataset.val);
    el.className = "pp" + (v === p ? " sel-" + p : "");
  });
}

// ── Who toggle HTML ───────────────────────────────────────────────────────────
function whoToggleHTML(actionName, currentWho, extraData = "") {
  return [NAME_A, NAME_B, "Both"].map(w => {
    const k   = w === NAME_A ? "s" : w === NAME_B ? "r" : "b";
    const sel = currentWho === w ? "sel-" + k : "";
    return `<div class="wt-btn ${sel}" data-action="${actionName}" data-val="${w}" ${extraData}>${w}</div>`;
  }).join("");
}

function dayPillsHTML(actionName, currentDay, extraData = "") {
  return DAYS.map(d =>
    `<div class="dp ${currentDay === d ? "sel" : ""}" data-action="${actionName}" data-val="${d}" ${extraData}>${d.slice(0,3)}</div>`
  ).join("");
}

// ── Render: Home ──────────────────────────────────────────────────────────────
function renderHome(obj) {
  const all    = Object.values(obj).filter(t => t.weekYear === week);
  const dayIdx = new Date().getDay();
  const todayStr = DAYS[dayIdx === 0 ? 6 : dayIdx - 1];
  const todayT = all.filter(t => t.day === todayStr);
  const done   = all.filter(t => t.status === "done").length;
  const pct    = all.length ? Math.round(done * 100 / all.length) : 0;

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

  document.getElementById("todayList").innerHTML = todayT.length
    ? todayT.map(t => taskRowHTML(t, false)).join("")
    : `<p class="empty" style="padding:6px 16px">Nothing scheduled today</p>`;
}

// ── Render: Schedule ──────────────────────────────────────────────────────────
let schedCache = {};
function renderSchedule(obj) { schedCache = obj; renderScheduleFromCache(); }
function renderScheduleFromCache() {
  const all = Object.values(schedCache).filter(t => t.weekYear === week);
  document.getElementById("schedGrid").innerHTML = DAYS.map(day => {
    const dt       = all.filter(t => t.day === day);
    const isAdding = addingDay === day;
    const addPanel = `
      <div class="day-add-panel ${isAdding ? "show" : ""}">
        <div class="drawer-label">Task name</div>
        <input class="drawer-input" id="dap-input-${day}" placeholder="e.g. Clean the oven"/>
        <div class="drawer-label">Assign to</div>
        <div class="who-toggle" id="dap-who-${day}">
          ${whoToggleHTML("add-who", addWho, `data-day="${day}"`)}
        </div>
        <div class="ep-btns">
          <button class="save-btn"   data-action="confirm-day-add" data-day="${day}">Add task</button>
          <button class="cancel-btn" data-action="close-day-add"   data-day="${day}">Cancel</button>
        </div>
      </div>`;

    const rows = dt.map(t => {
      const isEditing = editingId === t.id;
      const ep = isEditing ? `
        <div class="edit-panel show">
          <div class="drawer-label">Task name</div>
          <input class="drawer-input" id="ep-${t.id}" value="${t.title}"/>
          <div class="drawer-label">Assign to</div>
          <div class="who-toggle" id="edit-who-${t.id}">
            ${whoToggleHTML("edit-who", editWho, `data-id="${t.id}"`)}
          </div>
          <div class="drawer-label">Move to day</div>
          <div class="day-pills" id="edit-day-${t.id}">
            ${dayPillsHTML("edit-day", editDay, `data-id="${t.id}"`)}
          </div>
          <div class="ep-btns">
            <button class="save-btn"   data-action="save-edit"   data-id="${t.id}">Save</button>
            <button class="cancel-btn" data-action="cancel-edit" data-id="${t.id}">Cancel</button>
          </div>
        </div>` : "";
      return taskRowHTML(t, true) + ep;
    }).join("");

    return `<div class="day-section">
      <div class="day-hdr">
        <span class="day-name">${day}</span>
        <div class="day-add-btn" data-action="open-day-add" data-day="${day}">+ Add</div>
      </div>
      ${addPanel}${rows}
      ${dt.length === 0 && !isAdding ? `<p class="empty" style="padding:6px 16px">Nothing yet</p>` : ""}
    </div>`;
  }).join("");
}

// ── Render: Grocery ───────────────────────────────────────────────────────────
function renderGrocery(obj) {
  const items = Object.values(obj);
  const cats  = [...new Set(items.map(i => i.category))].sort();
  document.getElementById("groceryList").innerHTML = cats.map(cat =>
    `<div class="groc-sec">${cat}</div>` +
    items.filter(i => i.category === cat).map(i => `
      <div class="groc-row ${i.checked ? "ck" : ""}"
           data-action="toggle-grocery" data-id="${i.id}" data-checked="${i.checked}">
        <div class="circ ${i.checked ? "done" : ""}"></div>
        <span>${i.name}</span>
        <span class="groc-qty">${i.qty}</span>
      </div>`).join("")
  ).join("");
}

// ── Render: Meals ─────────────────────────────────────────────────────────────
let mealsCache = {};
function renderMeals(obj) { mealsCache = obj; renderMealsFromCache(); }
function renderMealsFromCache() {
  const meals  = Object.values(mealsCache);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  document.getElementById("mealGrid").innerHTML = DAYS.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const date = d.toISOString().split("T")[0];
    return `<div class="meal-row">
      <div class="meal-day-lbl">${day.slice(0,3)}</div>
      ${["breakfast","lunch","dinner"].map(type => {
        const cls = type === "breakfast" ? "mc-b" : type === "lunch" ? "mc-l" : "mc-d";
        const m   = meals.find(x => x.date === date && x.type === type);
        return m
          ? `<div class="mc ${cls}" data-action="remove-meal" data-id="${m.id}">${m.name}</div>`
          : `<div class="mc-e" data-action="open-meal" data-date="${date}" data-type="${type}">+${type[0].toUpperCase()}</div>`;
      }).join("")}
    </div>`;
  }).join("");
}

// ── Render: Maintenance ───────────────────────────────────────────────────────
function renderMaint(obj) {
  const items = Object.values(obj).sort((a, b) => a.priority - b.priority);
  document.getElementById("maintList").innerHTML = items.map(t => `
    <div class="maint-row ${t.completed ? "done-row" : ""}"
         data-action="toggle-maint" data-id="${t.id}" data-completed="${t.completed}">
      <div class="circ ${t.completed ? "done" : ""}"></div>
      <div class="maint-info">
        <div class="maint-title">${t.title}</div>
        <div class="maint-meta">${whoBadge(t.assignee)}<div class="pdot p${t.priority}"></div></div>
      </div>
    </div>`).join("") || `<p class="empty" style="padding:6px 16px">No tasks</p>`;
}

// ── Task row HTML ─────────────────────────────────────────────────────────────
function taskRowHTML(t, showActions) {
  const co = t.carriedOver ? `<span class="co-pill">last week</span>` : "";
  const actions = showActions ? `
    <div class="task-actions">
      <div class="act-btn edit-btn" data-action="open-edit" data-id="${t.id}" data-who="${t.who}" data-editday="${t.day}">Edit</div>
      <div class="act-btn del-btn"  data-action="delete-task" data-id="${t.id}">Delete</div>
    </div>` : "";
  return `<div class="task-row">
    <div class="task-main" data-action="toggle-task" data-id="${t.id}" data-status="${t.status}">
      <div class="circ ${t.status === "done" ? "done" : t.carriedOver ? "carried" : ""}"></div>
      <div>
        <div class="t-name ${t.status === "done" ? "struck" : ""}">${t.title} ${co}</div>
        <div class="t-meta">${whoBadge(t.who)}<span>${t.estimatedMins}min</span></div>
      </div>
    </div>${actions}
  </div>`;
}

function whoBadge(w) {
  const cls = w === NAME_A ? "wb-s" : w === NAME_B ? "wb-r" : "wb-b";
  return `<span class="who-badge ${cls}">${w || "shared"}</span>`;
}

// ── Static controls ───────────────────────────────────────────────────────────
function buildStaticControls() {
  // Home who toggle
  document.getElementById("wt-s").dataset.action = "home-who";
  document.getElementById("wt-s").dataset.val    = NAME_A;
  document.getElementById("wt-r").dataset.action = "home-who";
  document.getElementById("wt-r").dataset.val    = NAME_B;
  document.getElementById("wt-b").dataset.action = "home-who";
  document.getElementById("wt-b").dataset.val    = "Both";
  highlightWho("home", NAME_A);

  // Maint who toggle
  document.getElementById("mwt-s").dataset.action = "maint-who";
  document.getElementById("mwt-s").dataset.val    = NAME_A;
  document.getElementById("mwt-r").dataset.action = "maint-who";
  document.getElementById("mwt-r").dataset.val    = NAME_B;
  document.getElementById("mwt-b").dataset.action = "maint-who";
  document.getElementById("mwt-b").dataset.val    = "Both";
  highlightWho("maint", NAME_A);

  // Home day pills
  document.getElementById("home-day-pills").innerHTML =
    dayPillsHTML("home-day", homeDay);

  // Category pills
  document.getElementById("cat-pills").innerHTML = CATS.map(c =>
    `<div class="dp ${c === selCat ? "sel" : ""}" data-action="groc-cat" data-val="${c}">${c}</div>`
  ).join("");

  // Priority pills
  document.getElementById("pri-pills").innerHTML =
    ["High","Medium","Low"].map((lbl, i) => {
      const p = i + 1;
      return `<div class="pp ${p === maintPri ? "sel-"+p : ""}" data-action="pri" data-val="${p}">${lbl}</div>`;
    }).join("");

  // Add task / grocery / maint / meal buttons
  document.getElementById("add-task-btn").dataset.action   = "add-task";
  document.getElementById("add-groc-btn").dataset.action   = "add-grocery";
  document.getElementById("add-maint-btn").dataset.action  = "add-maint";
  document.getElementById("clr-groc-btn").dataset.action   = "clear-grocery";
  document.getElementById("confirm-meal-btn").dataset.action = "confirm-meal";
  document.getElementById("cancel-meal-btn").dataset.action  = "cancel-meal";

  // Nav buttons
  ["home","schedule","grocery","meals","tasks"].forEach(t => {
    const el = document.getElementById("n-" + t);
    el.dataset.action = "nav";
    el.dataset.val    = t;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setHeader(title, sub) {
  document.getElementById("hdr-title").textContent = title;
  document.getElementById("hdr-sub").textContent   = sub;
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

function showCarryoverBanner(tasks) {
  const b = document.getElementById("carryoverBanner");
  b.style.display = "block";
  b.innerHTML = `<strong>${tasks.length} tasks carried over from last week</strong><br>` +
    tasks.map(t => `<span class="co-tag">${t.title} · ${t.who}</span>`).join(" ");
}

init();
