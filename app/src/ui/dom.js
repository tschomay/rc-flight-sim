// Small DOM helpers shared by the settings sheet: an element builder and form controls.

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

let uid = 0;

export function seg(label, options, value, set) {
  const name = `seg${uid++}`;
  return h("fieldset", { class: "field seg" }, h("legend", {}, label),
    h("div", { class: "seg-row" }, options.map(([v, text]) => {
      const id = `${name}-${v}`;
      return [h("input", { type: "radio", name, id, value: v, checked: value === v, onchange: () => set(v) }), h("label", { for: id }, text)];
    })));
}

export function toggle(label, value, set, hint) {
  const id = `t${uid++}`;
  return h("div", { class: "field toggle" },
    h("input", { type: "checkbox", id, checked: !!value, onchange: (e) => set(e.target.checked) }),
    h("label", { for: id }, label, hint ? h("small", {}, hint) : null));
}

export function slider(label, min, max, step, value, set, fmt = (v) => v) {
  const id = `s${uid++}`;
  const out = h("output", { for: id }, fmt(value));
  return h("div", { class: "field slider" },
    h("label", { for: id }, label, out),
    h("input", { type: "range", id, min, max, step, value, oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); set(v); } }));
}

export const fmt1 = (u) => (v) => `${(+v).toFixed(1)} ${u}`;

/** Radius choices for the hover circle; the settings keep its diameter. */
export const radii = (list) => list.map((r) => [r * 2, `${r} m`]);
