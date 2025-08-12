// In-memory conversation state: { [phone]: { step, name, need } }
const state = new Map();

function setStep(phone, step) {
  const s = state.get(phone) || {};
  s.step = step;
  state.set(phone, s);
}

function setField(phone, key, val) {
  const s = state.get(phone) || {};
  s[key] = val;
  state.set(phone, s);
}

function get(phone) {
  return state.get(phone) || null;
}

function reset(phone) {
  state.delete(phone);
}

module.exports = { setStep, setField, get, reset };
