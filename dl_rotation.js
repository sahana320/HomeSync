export function weekYear(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function prevWeekYear() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return weekYear(d);
}

// Even ISO week → side 0 (Sahana = Set 1, Raman = Set 2)
// Odd  ISO week → side 1 (flipped automatically)
export function rotationSide() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return week % 2;
}

export function buildWeekTasks(nameA, nameB, side, week) {
  const A = side === 0 ? nameA : nameB;
  const B = side === 0 ? nameB : nameA;

  const templates = [
    ["Monday",    "Vacuum living room",       "chores",      "A", 20],
    ["Monday",    "Wipe kitchen counters",    "chores",      "B", 10],
    ["Monday",    "Kids' school bags packed", "kids_pets",   "S", 10],
    ["Tuesday",   "Clean bathroom sink",      "chores",      "A", 15],
    ["Tuesday",   "Take out recycling",       "chores",      "B", 10],
    ["Tuesday",   "Pet feeding & water",      "kids_pets",   "B", 10],
    ["Wednesday", "Mop kitchen floor",        "chores",      "A", 20],
    ["Wednesday", "Laundry (wash + dry)",     "chores",      "B", 60],
    ["Wednesday", "Review grocery list",      "chores",      "S", 10],
    ["Thursday",  "Fold & put away laundry",  "chores",      "A", 30],
    ["Thursday",  "Dust surfaces",            "chores",      "A", 15],
    ["Thursday",  "Clean toilet & shower",    "chores",      "B", 20],
    ["Friday",    "Tidy living spaces",       "chores",      "A", 20],
    ["Friday",    "Grocery shopping",         "chores",      "B", 45],
    ["Friday",    "Kids' weekend plan",       "kids_pets",   "S", 15],
    ["Saturday",  "Yard / outdoor tidy",      "maintenance", "A", 30],
    ["Saturday",  "Meal prep for week",       "chores",      "B", 60],
    ["Sunday",    "Change bed sheets",        "chores",      "A", 20],
    ["Sunday",    "Plan next week meals",     "chores",      "S", 15],
  ];

  return templates.map(([day, title, category, set, mins]) => ({
    title,
    category,
    day,
    who:           set === "A" ? A : set === "B" ? B : "Both",
    assignee:      set === "A" ? A : set === "B" ? B : "Both",
    status:        "pending",
    weekYear:      week,
    carriedOver:   false,
    estimatedMins: mins,
    notes:         ""
  }));
}
