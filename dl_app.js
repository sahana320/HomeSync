import {
  db, collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
} from "./firebase.js";
import { weekYear, rotationSide, buildWeekTasks } from "./rotation.js";
import { processCarryover } from "./carryover.js";

const DAYS   = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CATS   = ["Produce","Dairy","Meat","Pantry","Frozen","Other"];
const PEOPLE = { A: "Sahana", B: "Raman" };
const householdId = "home";
const week        = weekYear();

// ── UI state ──────────────────────────────────────────────────────────────────
let homeWho   = "Sahana", homeDay = DAYS[0];
let maintWho  = "Sahana", maintPri = 2;
let selCat    = "Produce";
let editingId = null, editWho = "Sahana", editDay = DAYS[0];
let addingDay = null,  addWho  = "Sahana";
let pendingMeal = { day: null, type: null };

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await setDoc(doc(db, "households", householdId),
    { nameA: PEOPLE.A, nameB: PEOPLE.B }, { merge: true });
  await maybeBootstrapWeek();
  listenToAll();
  buildStaticPills();
  setHeader("HomeSync", todayLabel());
  selWhoBtn("home", "Sahana");
  selWhoBtn("maint", "Sahana");
  selPriBtn(2);
}

async function maybeBootstrapWeek() {
  const snap = await getDocs(
    query(collection(db, `households/${householdId}/tasks`), where("weekYear","==",week))
  );
  if (snap.empty) {
    const side  = rotationSide();
    const tasks = buildWeekTasks(PEOPLE.A, PEOPLE.B, side, week);
    const batch = writeBatch(db);
    tasks.forEach(t => {
      const r = doc(collection(db, `households/${householdId}/tasks`));
      batch.set(r, { ...t, id: r.id });
    });
    await batch.commit();
    const carried = await processCarryover(householdId);
    if (carried.length) showCarryoverBanner(carried);
  }
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function listenToAll() {
  onSnapshot(collection(db, `households/${householdId}/tasks`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderHome(data);
    renderSchedule(data);
  });
  onSnapshot(collection(db, `households/${householdId}/grocery`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderGrocery(data);
  });
  onSnapshot(collection(db, `households/${householdId}/meals`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderMeals(data);
  });
  onSnapshot(collection(db, `households/${householdId}/maintenance`), snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });
    renderMaint(data);
  });
}

// ── Render helpers ────────────────────────────────────────────────────────────
function whoBadge(w) {
  const cls = w === PEOPLE.A ? "wb-s" : w === PEOPLE.B ? "wb-r" : "wb-b";
  return `<span class="who-badge ${cls}">${w}</span>`;
}

function taskRow(t, showActions = false) {
  const co = t.carriedOver ? `<span class="co-pill">last week</span>` : "";
  const actions = showActions ? `
    <div class="task-actions">
      <div class="act-btn edit-btn" onclick="openEdit('${t.id}','${t.who}','${t.day}')">Edit</div>
      <div class="act-btn del-btn"  onclick="deleteTask('${t.id}')">Delete</div>
    </div>` : "";
  return `<div class="task-row">
    <div class="task-main" onclick="toggleTask('${t.id}','${t.status}')">
      <div class="circ ${t.status==="done"?"done":t.carriedOver?"carried":""}"></div>
      <div>
        <div class="t-name ${t.status==="done"?"struck":""}">${t.title} ${co}</div>
        <div class="t-meta">${whoBadge(t.who)}<span>${t.estimatedMins}min</span></div>
      </div>
    </div>${actions}
  </div>`;
}

// ── Render: Home ──────────────────────────────────────────────────────────────
function renderHome(obj) {
  const all     = Object.values(obj).filter(t => t.weekYear === week);
  const todayStr = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
  const todayT  = all.filter(t => t.day === todayStr);
  const done    = all.filter(t => t.status === "done").length;
  const pct     = all.length ? Math.round(done * 100 / all.length) : 0;

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
    ? todayT.map(t => taskRow(t, false)).join("")
    : `<p class="empty" style="padding:6px 16px">Nothing scheduled today</p>`;
}

// ── Render: Schedule ──────────────────────────────────────────────────────────
function renderSchedule(obj) {
  const all = Object.values(obj).filter(t => t.weekYear === week);
  document.getElementById("schedGrid").innerHTML = DAYS.map(day => {
    const dt = all.filter(t => t.day === day);
    const isAdding = addingDay === day;
    const addPanel = `
      <div class="day-add-panel ${isAdding ? "show" : ""}" id="dap-${day}">
        <div class="drawer-label">Task name</div>
        <input class="drawer-input" id="dap-input-${day}" placeholder="e.g. Clean the oven"/>
        <div class="drawer-label">Assign to</div>
        <div class="who-toggle">
          ${["Sahana","Raman","Both"].map(w => {
            const k = w === PEOPLE.A ? "s" : w === PEOPLE.B ? "r" : "b";
            const sel = addWho === w ? "sel-"+k : "";
            return `<div class="wt-btn ${sel}" onclick="schedSelWho('${w}')">${w}</div>`;
          }).join("")}
        </div>
        <div class="ep-btns">
          <button class="save-btn" onclick="confirmDayAdd('${day}')">Add task</button>
          <button class="cancel-btn" onclick="closeDayAdd()">Cancel</button>
        </div>
      </div>`;

    const rows = dt.map(t => {
      const isEditing = editingId === t.id;
      const ep = isEditing ? `
        <div class="edit-panel show">
          <div class="drawer-label">Task name</div>
          <input class="drawer-input" id="ep-${t.id}" value="${t.title}"/>
          <div class="drawer-label">Assign to</div>
          <div class="who-toggle">
            ${["Sahana","Raman","Both"].map(w => {
              const k = w === PEOPLE.A ? "s" : w === PEOPLE.B ? "r" : "b";
              const sel = editWho === w ? "sel-"+k : "";
              return `<div class="wt-btn ${sel}" onclick="schedEditWho('${w}')">${w}</div>`;
            }).join("")}
          </div>
          <div class="drawer-label">Move to day</div>
          <div class="day-pills">${DAYS.map(d =>
            `<div class="dp ${editDay===d?"sel":""}" onclick="schedEditDay('${d}')">${d.slice(0,3)}</div>`
          ).join("")}</div>
          <div class="ep-btns">
            <button class="save-btn" onclick="saveEdit('${t.id}')">Save</button>
            <button class="cancel-btn" onclick="cancelEdit()">Cancel</button>
          </div>
        </div>` : "";
      return taskRow(t, true) + ep;
    }).join("");

    return `<div class="day-section">
      <div class="day-hdr">
        <span class="day-name">${day}</span>
        <div class="day-add-btn" onclick="openDayAdd('${day}')">+ Add</div>
      </div>
      ${addPanel}
      ${rows}
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
      <div class="groc-row ${i.checked ? "ck" : ""}" onclick="toggleGrocery('${i.id}',${i.checked})">
        <div class="circ ${i.checked ? "done" : ""}"></div>
        <span>${i.name}</span>
        <span class="groc-qty">${i.qty}</span>
      </div>`).join("")
  ).join("");
}

// ── Render: Meals ─────────────────────────────────────────────────────────────
function renderMeals(obj) {
  const meals  = Object.values(obj);
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
          ? `<div class="mc ${cls}" onclick="removeMeal('${m.id}')">${m.name}</div>`
          : `<div class="mc-e" onclick="openMealPanel('${date}','${type}')">+${type[0].toUpperCase()}</div>`;
      }).join("")}
    </div>`;
  }).join("");
}

// ── Render: Maintenance ───────────────────────────────────────────────────────
function renderMaint(obj) {
  const items = Object.values(obj).sort((a, b) => a.priority - b.priority);
  document.getElementById("maintList").innerHTML = items.map(t => `
    <div class="maint-row ${t.completed ? "done-row" : ""}" onclick="toggleMaint('${t.id}',${t.completed})">
      <div class="circ ${t.completed ? "done" : ""}"></div>
      <div class="maint-info">
        <div class="maint-title">${t.title}</div>
        <div class="maint-meta">${whoBadge(t.assignee)}<div class="pdot p${t.priority}"></div></div>
      </div>
    </div>`).join("") || `<p class="empty" style="padding:6px 16px">No tasks</p>`;
}

// ── Task actions ──────────────────────────────────────────────────────────────
window.toggleTask = async (id, status) => {
  await updateDoc(doc(db, `households/${householdId}/tasks`, id),
    { status: status === "done" ? "pending" : "done" });
};

window.addTask = async () => {
  const title = document.getElementById("nt").value.trim();
  if (!title) return;
  const r = doc(collection(db, `households/${householdId}/tasks`));
  await setDoc(r, {
    id: r.id, title, day: homeDay, assignee: homeWho, who: homeWho,
    category: "chores", status: "pending", weekYear: week,
    carriedOver: false, estimatedMins: 20, notes: ""
  });
  document.getElementById("nt").value = "";
};

window.deleteTask = async (id) => {
  await deleteDoc(doc(db, `households/${householdId}/tasks`, id));
  if (editingId === id) editingId = null;
};

window.openEdit = (id, who, day) => {
  editingId = id; editWho = who; editDay = day; addingDay = null;
  document.querySelectorAll("[data-snapshot]").forEach(() => {});
};

window.cancelEdit = () => { editingId = null; };
window.schedEditWho = (w) => { editWho = w; };
window.schedEditDay = (d) => { editDay = d; };

window.saveEdit = async (id) => {
  const titleEl = document.getElementById("ep-" + id);
  const newTitle = titleEl ? titleEl.value.trim() : null;
  const updates = { who: editWho, assignee: editWho, day: editDay };
  if (newTitle) updates.title = newTitle;
  await updateDoc(doc(db, `households/${householdId}/tasks`, id), updates);
  editingId = null;
};

// ── Schedule add ──────────────────────────────────────────────────────────────
window.openDayAdd = (day) => { addingDay = day; addWho = "Sahana"; editingId = null; };
window.closeDayAdd = () => { addingDay = null; };
window.schedSelWho = (w) => { addWho = w; };

window.confirmDayAdd = async (day) => {
  const el    = document.getElementById("dap-input-" + day);
  const title = el ? el.value.trim() : "";
  if (!title) return;
  const r = doc(collection(db, `households/${householdId}/tasks`));
  await setDoc(r, {
    id: r.id, title, day: addingDay || day, who: addWho, assignee: addWho,
    category: "chores", status: "pending", weekYear: week,
    carriedOver: false, estimatedMins: 20, notes: ""
  });
  addingDay = null;
};

// ── Grocery actions ───────────────────────────────────────────────────────────
window.toggleGrocery = async (id, current) => {
  await updateDoc(doc(db, `households/${householdId}/grocery`, id), { checked: !current });
};

window.addGrocery = async () => {
  const name = document.getElementById("gn").value.trim();
  const qty  = document.getElementById("gq").value.trim() || "1";
  if (!name) return;
  const r = doc(collection(db, `households/${householdId}/grocery`));
  await setDoc(r, { id: r.id, name, qty, category: selCat, checked: false });
  document.getElementById("gn").value = "";
  document.getElementById("gq").value = "";
};

window.clearGrocery = async () => {
  const snap  = await getDocs(collection(db, `households/${householdId}/grocery`));
  const batch = writeBatch(db);
  snap.docs.forEach(d => { if (d.data().checked) batch.delete(d.ref); });
  await batch.commit();
};

// ── Meal actions ──────────────────────────────────────────────────────────────
window.openMealPanel = (date, type) => {
  pendingMeal = { date, type };
  const lbl = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner" };
  document.getElementById("mealAddLabel").textContent =
    "Add " + lbl[type] + " · " + date;
  document.getElementById("mealInput").value = "";
  document.getElementById("mealAddPanel").classList.add("show");
};
window.closeMealPanel = () => {
  document.getElementById("mealAddPanel").classList.remove("show");
  pendingMeal = { date: null, type: null };
};
window.confirmMeal = async () => {
  const name = document.getElementById("mealInput").value.trim();
  if (name && pendingMeal.date) {
    const r = doc(collection(db, `households/${householdId}/meals`));
    await setDoc(r, { id: r.id, date: pendingMeal.date, type: pendingMeal.type, name, cook: "shared" });
  }
  closeMealPanel();
};
window.removeMeal = async (id) => {
  await deleteDoc(doc(db, `households/${householdId}/meals`, id));
};

// ── Maintenance actions ───────────────────────────────────────────────────────
window.toggleMaint = async (id, current) => {
  await updateDoc(doc(db, `households/${householdId}/maintenance`, id), { completed: !current });
};
window.addMaint = async () => {
  const title = document.getElementById("mn").value.trim();
  if (!title) return;
  const r = doc(collection(db, `households/${householdId}/maintenance`));
  await setDoc(r, { id: r.id, title, assignee: maintWho, priority: maintPri, completed: false });
  document.getElementById("mn").value = "";
};

// ── Who / pill selection ──────────────────────────────────────────────────────
window.selWho = (ctx, w) => {
  if (ctx === "home")  homeWho  = w;
  if (ctx === "maint") maintWho = w;
  selWhoBtn(ctx, w);
};

function selWhoBtn(ctx, w) {
  const prefix = ctx === "home" ? "wt" : "mwt";
  ["s","r","b"].forEach(k => {
    const el = document.getElementById(prefix + "-" + k);
    if (el) el.className = "wt-btn";
  });
  const key = w === PEOPLE.A ? "s" : w === PEOPLE.B ? "r" : "b";
  const el  = document.getElementById(prefix + "-" + key);
  if (el) el.className = "wt-btn sel-" + key;
}

function selPriBtn(p) {
  maintPri = p;
  document.querySelectorAll("#pri-pills .pp").forEach((el, i) => {
    el.className = "pp" + (i + 1 === p ? " sel-" + p : "");
  });
}

function buildStaticPills() {
  // Home day pills
  const hdp = document.getElementById("home-day-pills");
  if (hdp) hdp.innerHTML = DAYS.map(d =>
    `<div class="dp ${d === homeDay ? "sel" : ""}" onclick="setHomeDay('${d}')">${d.slice(0,3)}</div>`
  ).join("");

  // Category pills
  const cp = document.getElementById("cat-pills");
  if (cp) cp.innerHTML = CATS.map(c =>
    `<div class="dp ${c === selCat ? "sel" : ""}" onclick="setCat('${c}')">${c}</div>`
  ).join("");

  // Priority pills
  const pp = document.getElementById("pri-pills");
  if (pp) {
    pp.innerHTML = ["High","Medium","Low"].map((lbl, i) =>
      `<div class="pp ${i + 1 === maintPri ? "sel-" + (i + 1) : ""}" onclick="selPriBtn(${i + 1})">${lbl}</div>`
    ).join("");
  }
}

window.setHomeDay = (d) => {
  homeDay = d;
  document.querySelectorAll("#home-day-pills .dp").forEach((el, i) => {
    el.className = "dp" + (DAYS[i] === d ? " sel" : "");
  });
};

window.setCat = (c) => {
  selCat = c;
  document.querySelectorAll("#cat-pills .dp").forEach((el, i) => {
    el.className = "dp" + (CATS[i] === c ? " sel" : "");
  });
};

// ── Navigation ────────────────────────────────────────────────────────────────
window.go = (tab, title, sub) => {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("on"));
  document.querySelectorAll(".ni").forEach(n => n.classList.remove("on"));
  document.getElementById("tab-" + tab).classList.add("on");
  document.getElementById("n-" + tab).classList.add("on");
  setHeader(title, sub);
};

function setHeader(title, sub) {
  document.getElementById("hdr-title").textContent = title;
  document.getElementById("hdr-sub").textContent   = sub;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
window.todayLabel = () => {
  const d = new Date();
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};
window.weekLabel = () => {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function showCarryoverBanner(tasks) {
  const b = document.getElementById("carryoverBanner");
  b.style.display = "block";
  b.innerHTML = `<strong>${tasks.length} tasks carried over from last week</strong><br>` +
    tasks.map(t => `<span class="co-tag">${t.title} · ${t.who}</span>`).join(" ");
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
