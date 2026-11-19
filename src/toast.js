/* Small pop-up notifications ("Room booked", "Review published"...).
   toast('Text')            – success (green)
   toast('Text', 'error')   – error (red)
   toast('Text', 'info')    – neutral */

let items = [];
let nextId = 1;
const listeners = new Set();

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getToasts() { return items; }

function emit() { listeners.forEach((fn) => fn()); }

export function dismissToast(id) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(message, kind = 'success', ms = 4500) {
  const id = nextId++;
  items = items.concat({ id, message, kind }).slice(-4); // at most 4 on screen
  emit();
  setTimeout(() => dismissToast(id), ms);
  return id;
}
