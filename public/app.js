import { products, spending, alternatives, validate } from "./survey.js";

const form = document.querySelector("#survey");
const submit = form.querySelector("button");
const status = document.querySelector("#status");
const other = form.elements.other;
const id = crypto.randomUUID();
let dirty = false;
let pending = false;
const numerals = new Intl.NumberFormat("ar-EG");

function choice(parent, name, value, caption, type = "checkbox") {
  const label = document.createElement("label");
  label.className = "choice";
  const control = document.createElement("input");
  Object.assign(control, { type, name, value });
  label.append(control, document.createTextNode(caption));
  parent.append(label);
  return control;
}
for (const [group, options] of [["products", products], ["spending", spending]]) {
  const container = document.querySelector(group === "products" ? "#product-options" : "#spending-options");
  for (const [key, caption] of Object.entries(options)) {
    choice(container, group, key, caption, group === "products" ? "checkbox" : "radio");
  }
}
for (const [key, caption] of Object.entries(alternatives)) {
  const container = document.querySelector("#" + key + " .brand-controls");
  const names = document.createElement("div");
  names.className = "names";
  container.append(names);
  for (const ordinal of ["الأولى", "الثانية", "الثالثة"]) {
    const label = document.createElement("label");
    label.textContent = "الماركة " + ordinal;
    const field = document.createElement("input");
    Object.assign(field, { type: "text", name: key + "Name", dir: "auto", maxLength: 100, spellcheck: false });
    label.append(field);
    names.append(label);
  }
  const alternative = choice(container, key + "None", "yes", caption);
  alternative.parentElement.classList.add("alternative");
}

const inputs = name => [...form.querySelectorAll('input[name="' + name + '"]')];
function syncControls() {
  const choices = inputs("products");
  const selected = choices.filter(input => input.checked);
  document.querySelector("#count").textContent = numerals.format(selected.length) + " / ٣";
  for (const input of choices) input.disabled = selected.length === 3 && !input.checked;
  const showOther = selected.some(input => input.value === "other");
  document.querySelector("#other-field").hidden = !showOther;
  other.disabled = !showOther;
  for (const key of Object.keys(alternatives)) {
    const none = form.elements[key + "None"];
    for (const field of inputs(key + "Name")) field.disabled = none.checked;
  }
}
function answers() {
  const data = {
    id, products: inputs("products").filter(el => el.checked).map(el => el.value),
    other: other.disabled ? "" : other.value,
    spending: inputs("spending").find(el => el.checked)?.value
  };
  for (const key of Object.keys(alternatives)) {
    const none = form.elements[key + "None"].checked;
    data[key] = { none, names: none ? [] : inputs(key + "Name").map(el => el.value) };
  }
  return data;
}
function showErrors(errors) {
  let first;
  for (const key of ["products", "other", "current", "wanted", "spending"]) {
    const message = document.querySelector("#" + key + "-error");
    message.textContent = errors[key] || "";
    const fields = key === "other" ? [other] : [...document.querySelectorAll("#" + key + " input")].filter(el => el !== other);
    for (const field of fields) {
      if (errors[key]) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", message.id);
        if (!field.disabled) first ??= field;
      } else {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-describedby");
      }
    }
  }
  first?.focus();
}
form.addEventListener("input", () => {
  dirty = true;
  syncControls();
  if (form.querySelector('[aria-invalid="true"]')) {
    const { errors } = validate(answers());
    for (const message of form.querySelectorAll(".error")) {
      const key = message.id.replace("-error", "");
      if (!errors[key]) {
        message.textContent = "";
        for (const field of form.querySelectorAll('[aria-describedby="' + message.id + '"]')) {
          field.removeAttribute("aria-invalid");
          field.removeAttribute("aria-describedby");
        }
      }
    }
  }
});
window.addEventListener("beforeunload", event => { if (dirty) event.preventDefault(); });
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (pending) return;
  const input = answers();
  const { errors } = validate(input);
  showErrors(errors);
  status.textContent = "";
  if (Object.keys(errors).length) return;
  pending = true;
  submit.disabled = true;
  submit.textContent = "جارٍ الحفظ…";
  const groups = [...form.querySelectorAll("fieldset")];
  groups.forEach(group => { group.disabled = true; });
  try {
    const response = await fetch("/api/responses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (result.closed === true) {
      status.textContent = "انتهت فترة استقبال الإجابات.";
      return;
    }
    if (response.status === 422) {
      groups.forEach(group => { group.disabled = false; });
      showErrors(result.errors);
      return;
    }
    if (response.status === 409) {
      status.textContent = "حُفظت النسخة السابقة من إجاباتك. تعذّر استبدالها بالتعديلات الحالية.";
      return;
    }
    if (!response.ok || result.saved !== true) throw new Error();
    dirty = false;
    form.hidden = true;
    const success = document.querySelector("#success");
    success.hidden = false;
    success.focus();
  } catch {
    status.textContent = "تعذّر تأكيد الحفظ. إجاباتك ما زالت هنا. تحقّقي من الاتصال وأعيدي الإرسال.";
  } finally {
    groups.forEach(group => { group.disabled = false; });
    pending = false;
    submit.disabled = false;
    submit.textContent = "إرسال الإجابات";
  }
});
syncControls();
form.hidden = false;
