/* Robos DENUNCIADOS en el Metro de la CDMX: conteo contra tasa.
   Sin dependencias ni servicios externos: un JSON precomputado (datos.json) y SVG a mano.
   La magnitud que manda es la tasa ENCOGIDA del modelo; la cruda va siempre de secundaria. */
"use strict";

const SVG = "http://www.w3.org/2000/svg";
const $ = (s) => document.querySelector(s);
const el = (nombre, attrs = {}, padre) => {
  const e = document.createElementNS(SVG, nombre);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (padre) padre.appendChild(e);
  return e;
};
const num = (x, d = 0) => x.toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ic = (p, d = 2) => `${num(p[0], d)} a ${num(p[1], d)}`;

let D, porNombre = {}, modo = "conteo", elegida = null, vista = null, vistaTotal = null, nodos = [];

const ESTATUS = {
  arriba: { glifo: "▲", corto: "distinguible por arriba", clase: "arriba" },
  abajo: { glifo: "▼", corto: "distinguible por abajo", clase: "abajo" },
  no: { glifo: "○", corto: "no distinguible", clase: "nodist" },
};

// Divergente centrado en 1.0, en escala logarítmica, saturado en 1/2.5 y 2.5.
function colorRazon(r) {
  const t = Math.max(-1, Math.min(1, Math.log(Math.max(r, 0.01)) / Math.log(2.5)));
  const mezcla = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const blanco = [255, 255, 255], alto = [215, 38, 61], bajo = [27, 108, 168];
  const c = t >= 0 ? mezcla(blanco, alto, t) : mezcla(blanco, bajo, -t);
  return `rgb(${c.join(",")})`;
}
const radio = (d) => 3.4 + 0.95 * Math.sqrt(d);

async function inicia() {
  D = await (await fetch("datos.json")).json();
  D.estaciones.forEach((s) => (porNombre[s.nombre] = s));
  dibujaMapa();
  dibujaLeyenda();
  dibujaLista();
  $("#btn-conteo").addEventListener("click", () => ponModo("conteo"));
  $("#btn-tasa").addEventListener("click", () => ponModo("tasa"));
  $("#ocultar-insuficientes").addEventListener("change", dibujaLista);
  estadoRed();
  window.addEventListener("online", estadoRed);
  window.addEventListener("offline", estadoRed);
  window.addEventListener("resize", ponRotulos);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function estadoRed() {
  $("#estado-red").textContent = navigator.onLine ? "" : "· sin conexión";
}

/* ------------------------------------------------------------------ mapa */
/* Plano ESQUEMÁTICO, como los de transporte: el centro va ampliado con una distorsión radial fija
   (d' = R·(d/R)^0.58 alrededor de Bellas Artes), para que todo se lea de una vez, sin acercar nada.
   No está a escala, y el plano lo dice. */
let deforma = (p) => p;

function preparaPlano() {
  const c = porNombre["Bellas Artes"].xy;
  const todos = [...D.estaciones.map((s) => s.xy), ...D.lineas.flatMap((l) => l.puntos)];
  const R = Math.max(...todos.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  deforma = (p) => {
    const dx = p[0] - c[0], dy = p[1] - c[1], d = Math.hypot(dx, dy);
    if (d < 1e-6) return [c[0], c[1]];
    const k = (R * Math.pow(d / R, 0.58)) / d;
    return [c[0] + dx * k, c[1] + dy * k];
  };
  // Las líneas se densifican antes de deformarlas: si no, un tramo recto cortaría camino y las estaciones quedarían fuera de su línea.
  D.lineas.forEach((l) => {
    const pts = [];
    l.puntos.forEach((p, i) => {
      if (i) {
        const a = l.puntos[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1]) / 6));
        for (let j = 1; j < n; j++) pts.push([a[0] + ((p[0] - a[0]) * j) / n, a[1] + ((p[1] - a[1]) * j) / n]);
      }
      pts.push(p);
    });
    l.plano = pts.map(deforma);
  });
  D.estaciones.forEach((s) => (s.plano = deforma(s.xy)));
  const P = [...D.estaciones.map((s) => s.plano), ...D.lineas.flatMap((l) => l.plano)];
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), m = 46;
  vista = { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
}

function forma(s, g) {
  // La forma codifica el estatus además del color: ▲ arriba, ▼ abajo, ○ no distinguible.
  const r = radio(s.denuncias);
  const relleno = colorRazon(s.razon_encogida);
  if (s.evidencia_insuficiente) return el("circle", { class: "est est-a insuficiente", r: Math.max(r * 0.8, 4) }, g);
  if (s.estatus === "no") return el("circle", { class: "est est-a nodist", r: r * 0.8, fill: relleno }, g);
  const R = r * 1.4, k = s.estatus === "arriba" ? -1 : 1;
  const pts = [[0, k * R], [R * 0.95, -k * R * 0.62], [-R * 0.95, -k * R * 0.62]].map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
  return el("polygon", { class: "est est-a dist", points: pts, fill: relleno }, g);
}

function dibujaMapa() {
  const svg = $("#mapa");
  preparaPlano();
  svg.setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
  svg.style.aspectRatio = `${vista.w} / ${vista.h}`;
  const defs = el("defs", {}, svg);
  const trama = el("pattern", { id: "trama", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 4, height: 4, fill: "#ffffff" }, trama);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#10233f", "stroke-width": 1.5 }, trama);
  // traza urbana de fondo: dos retículas giradas, tenues. Es textura de plano, no dato.
  const calles = el("pattern", { id: "calles", width: 46, height: 46, patternUnits: "userSpaceOnUse", patternTransform: "rotate(14)" }, defs);
  el("path", { d: "M0 0H46M0 0V46M0 23H46M23 0V46", stroke: "#cfd8e0", "stroke-width": 1, fill: "none" }, calles);
  el("rect", { x: vista.x - 3000, y: vista.y - 3000, width: vista.w + 6000, height: vista.h + 6000, fill: "url(#calles)" }, svg); // de sobra: el plano llena su caja sea cual sea su proporción

  const pts = (l) => l.plano.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
  const gf = el("g", { class: "filetes" }, svg), gl = el("g", { id: "lineas" }, svg);
  D.lineas.forEach((l) => el("polyline", { class: "linea-filete", points: pts(l) }, gf));
  D.lineas.forEach((l) => el("polyline", { class: "linea-metro", points: pts(l), stroke: l.color }, gl));

  const orden = { edomex: 0, b: 1, a: 2, c: 3 };
  const peso = (s) => (s.estrato === "a" && s.estatus !== "no" && !s.evidencia_insuficiente ? 1 : 0);
  const ests = [...D.estaciones].sort((p, q) => orden[p.estrato] - orden[q.estrato] || peso(p) - peso(q) || q.denuncias - p.denuncias);
  const ge = el("g", {}, svg), gt = el("g", { id: "rotulos" }, svg);
  ests.forEach((s) => {
    const g = el("g", { class: "nodo", transform: `translate(${s.plano[0].toFixed(1)} ${s.plano[1].toFixed(1)})` }, ge);
    let marca, r;
    if (s.estrato === "a") {
      r = radio(s.denuncias);
      el("circle", { class: "anillo" + (seMueve(s) ? " se-mueve" : ""), r: r * 1.4 + 4 }, g);
      marca = forma(s, g);
    } else if (s.estrato === "edomex") {
      r = 2.8;
      marca = el("circle", { class: "est est-edomex", r }, g);
    } else {
      r = s.estrato === "c" ? 8 : 4.2 + 0.28 * Math.sqrt(s.denuncias); // chicas a propósito: no se miden, no deben dominar
      marca = el("rect", { class: "est est-" + s.estrato, x: -r, y: -r, width: 2 * r, height: 2 * r, rx: r * 0.35, transform: "rotate(45)" }, g);
    }
    marca.dataset.nombre = s.nombre;
    marca.setAttribute("tabindex", "0");
    marca.addEventListener("click", (ev) => { ev.stopPropagation(); elige(s.nombre); });
    marca.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); elige(s.nombre); } });
    marca.addEventListener("pointerenter", (ev) => muestraTooltip(ev, s));
    marca.addEventListener("pointerleave", () => ($("#tooltip").hidden = true));
    // Rótulo: las distinguibles (con evidencia suficiente) y las dos anómalas. Primero las de más evidencia.
    let rotulo = null;
    const conRotulo = s.estrato === "c" || (s.estrato === "a" && s.estatus !== "no" && !s.evidencia_insuficiente);
    if (conRotulo) {
      rotulo = el("text", { class: "rotulo" + (s.estrato === "c" ? " rotulo-c" : " rotulo-" + s.estatus) }, gt);
      rotulo.textContent = s.nombre.replace("/Plaza de la Transparencia", "").replace("/Poder Judicial CDMX", "").replace("/Tenochtitlan", "").replace("/Arena Ciudad de México", "");
    }
    nodos.push({ s, g, r, rotulo, prioridad: s.estrato === "c" ? 1e6 : s.denuncias });
  });
  // norte y aviso de que el plano no está a escala
  const gn = el("g", { class: "norte", id: "norte" }, svg);
  el("path", { d: "M0 -20 L7 6 L0 1 L-7 6 Z" }, gn);
  el("text", { y: 22, "text-anchor": "middle" }, gn).textContent = "N";
  ponRotulos();
}

// Rótulos sin encimarse: entra primero el de más evidencia; se prueban cuatro posiciones alrededor del símbolo.
function ponRotulos() {
  const svg = $("#mapa");
  const caja = svg.getBoundingClientRect();
  // unidades del plano por pixel de pantalla: el plano se ajusta a su caja por el lado que apriete
  const px = Math.max(vista.w / (caja.width || 700), vista.h / (caja.height || 600));
  // Símbolos, líneas y letra se dimensionan en PIXELES de pantalla: se leen igual en una laptop que en un proyector.
  const e = px * Math.max(0.78, Math.min(1.15, (caja.height || 600) / 640));
  nodos.forEach((n) => { n.g.setAttribute("transform", `translate(${n.s.plano[0].toFixed(1)} ${n.s.plano[1].toFixed(1)}) scale(${e.toFixed(3)})`); n.re = n.r * e; });
  svg.style.setProperty("--grosor", (4.6 * px).toFixed(2));
  svg.style.setProperty("--filete", (8.2 * px).toFixed(2));
  const letra = Math.max(10.5, Math.min(13.5, (caja.height || 600) / 46)) * px;
  $("#norte").setAttribute("transform", `translate(${vista.x + 26 * px} ${vista.y + vista.h - 34 * px}) scale(${px.toFixed(3)})`);
  const ocupados = nodos.map((n) => { const [x, y] = n.s.plano, d = n.re * 1.2; return [x - d, y - d, x + d, y + d]; });
  [...nodos].filter((n) => n.rotulo).sort((a, b) => b.prioridad - a.prioridad).forEach((n) => {
    const t = n.rotulo, [x, y] = n.s.plano;
    const w = t.textContent.length * letra * 0.57, h = letra * 1.15, sep = n.re * 1.45 + 2 * px;
    const opciones = [[x + sep, y + h * 0.35, "start"], [x - sep, y + h * 0.35, "end"], [x, y - sep - h * 0.1, "middle"], [x, y + sep + h * 0.8, "middle"],
      [x + sep * 0.8, y - sep * 0.7, "start"], [x - sep * 0.8, y - sep * 0.7, "end"], [x + sep * 0.8, y + sep * 0.7 + h * 0.6, "start"], [x - sep * 0.8, y + sep * 0.7 + h * 0.6, "end"]];
    let puesto = false;
    for (const [tx, ty, ancla] of opciones) {
      const x0 = ancla === "start" ? tx : ancla === "end" ? tx - w : tx - w / 2;
      const caja = [x0, ty - h * 0.82, x0 + w, ty + h * 0.22];
      const fuera = caja[0] < vista.x + 2 || caja[2] > vista.x + vista.w - 2 || caja[1] < vista.y + 2 || caja[3] > vista.y + vista.h - 2;
      const propio = [x - n.re * 1.2, y - n.re * 1.2, x + n.re * 1.2, y + n.re * 1.2];
      if (fuera || ocupados.some((o) => o.join() !== propio.join() && caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue;
      t.setAttribute("x", tx.toFixed(1)); t.setAttribute("y", ty.toFixed(1)); t.setAttribute("text-anchor", ancla);
      t.style.fontSize = letra.toFixed(2) + "px"; t.style.strokeWidth = (letra * 0.3).toFixed(2) + "px"; t.style.display = "";
      ocupados.push(caja); puesto = true;
      break;
    }
    if (!puesto) t.style.display = "none";
  });
}

function muestraTooltip(ev, s) {
  const t = $("#tooltip");
  let txt = `<strong>${esc(s.nombre)}</strong><br>`;
  if (s.estrato === "a") {
    txt += `${num(s.denuncias)} denuncias · ${num(s.tasa_encogida_mm, 2)} por millón de entradas (${ic(s.tasa_encogida_ic95)})<br>`;
    txt += s.evidencia_insuficiente ? "evidencia insuficiente" : `${ESTATUS[s.estatus].glifo} ${ESTATUS[s.estatus].corto}`;
  } else if (s.estrato === "edomex") txt += "Estado de México: no se mide";
  else txt += `${num(s.denuncias)} denuncias · correspondencia, no medible`;
  t.innerHTML = txt;
  t.hidden = false;
  const caja = $("#mapa-caja").getBoundingClientRect();
  t.style.left = Math.max(4, Math.min(ev.clientX - caja.left + 12, caja.width - 230)) + "px";
  t.style.top = ev.clientY - caja.top + 14 + "px";
}

function dibujaLeyenda() {
  const m = D.meta.modelo;
  const cuad = (grueso) => `<svg width="16" height="16" viewBox="0 0 16 16"><defs><pattern id="trama-l" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#fff"/><line x1="0" y1="0" x2="0" y2="4" stroke="#10233f" stroke-width="1.5"/></pattern></defs><rect x="3.5" y="3.5" width="9" height="9" transform="rotate(45 8 8)" fill="url(#trama-l)" stroke="#10233f" stroke-width="${grueso ? 2.4 : 1}" rx="1.5"/></svg>`;
  $("#leyenda").innerHTML = `
    <span class="item titulo-ley"><b>Tasa contra la estación típica</b></span>
    <span class="item"><svg width="18" height="16"><polygon points="9,2 16,14 2,14" fill="#e2586a" stroke="#10233f" stroke-width="1.4"/></svg> <b>Por arriba</b> (${m.arriba})</span>
    <span class="item"><svg width="18" height="16"><polygon points="9,14 16,2 2,2" fill="#5b97c4" stroke="#10233f" stroke-width="1.4"/></svg> <b>Por abajo</b> (${m.abajo})</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="5.5" fill="#fff" stroke="#10233f" stroke-width="1"/></svg> No distinguible (${D.meta.estrato_a.estaciones - m.distinguibles})</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="5" fill="#fff" stroke="#7a8794" stroke-dasharray="2 1.5"/></svg> &lt; ${D.meta.min_denuncias_para_recomendar} denuncias</span>
    <span class="item"><span class="rampa-caja"><span class="rampa"></span><span><b>0.4</b><b>1.0</b><b>2.5</b></span></span> × estación típica</span>
    <span class="item"><svg width="34" height="16"><circle cx="6" cy="8" r="3.5" fill="#fff" stroke="#10233f"/><circle cx="23" cy="8" r="7.5" fill="#fff" stroke="#10233f"/></svg> denuncias</span>
    <span class="item">${cuad(false)} correspondencia</span>
    <span class="item">${cuad(true)} Hidalgo y Guerrero</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="3" fill="#dfe6ec" stroke="#9aa7b3"/></svg> Edomex</span>`;
}

/* ------------------------------------------------------------------ lista */
const seMueve = (s) => !s.evidencia_insuficiente && Math.abs(s.cambio) > D.meta.umbral_de_cambio;

function dibujaLista() {
  const ol = $("#lista");
  const antes = new Map([...ol.children].map((li) => [li.dataset.nombre, li.getBoundingClientRect().top]));
  const ocultar = $("#ocultar-insuficientes").checked;
  const clave = modo === "conteo" ? "pos_conteo" : "pos_encogida";
  const total = D.meta.estrato_a.estaciones;
  const filas = D.estaciones.filter((s) => s.estrato === "a" && !(ocultar && s.evidencia_insuficiente))
    .sort((p, q) => p[clave] - q[clave] || q.denuncias - p.denuncias);
  $("#lista-titulo").textContent = modo === "conteo"
    ? `Por conteo · ${total} estaciones`
    : `Por tasa · ${total} estaciones`;
  ol.innerHTML = "";
  filas.forEach((s) => {
    const li = document.createElement("li");
    li.dataset.nombre = s.nombre;
    li.classList.add("est-" + ESTATUS[s.estatus].clase);
    if (s.evidencia_insuficiente) li.classList.add("insuficiente");
    if (seMueve(s)) li.classList.add("se-mueve");
    if (s.nombre === elegida) li.classList.add("elegida");
    let mov = "";
    if (modo === "tasa" && seMueve(s)) mov = s.cambio > 0 ? `<span class="mov sube">sube ${s.cambio}</span>` : `<span class="mov baja">baja ${-s.cambio}</span>`;
    const e = ESTATUS[s.estatus];
    const etiq = s.evidencia_insuficiente ? '<span class="etiqueta insuf">evidencia insuficiente</span>' : "";
    const val = modo === "conteo"
      ? `${num(s.denuncias)} <small>denuncias</small>`
      : `${num(s.tasa_encogida_mm, 2)} <small>(${num(s.tasa_encogida_ic95[0], 2)}–${num(s.tasa_encogida_ic95[1], 2)})</small>`;
    li.innerHTML = `<span class="pos">${s[clave]}<small> de ${total}</small></span><span class="glifo" title="${e.corto}">${s.evidencia_insuficiente ? "·" : e.glifo}</span><span class="nom">${esc(s.nombre)} ${etiq}${mov}</span><span class="val">${val}</span>`;
    li.addEventListener("click", () => elige(s.nombre, true));
    ol.appendChild(li);
  });
  // FLIP: cada fila viaja de donde estaba a donde queda, para que el reordenamiento se VEA
  if (antes.size && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    [...ol.children].forEach((li) => {
      const y0 = antes.get(li.dataset.nombre);
      if (y0 === undefined) return;
      const dy = y0 - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.animate([{ transform: `translateY(${Math.max(-600, Math.min(600, dy))}px)` }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  }
}

function ponModo(m) {
  if (m === modo) return;
  modo = m;
  document.body.classList.toggle("modo-tasa", m === "tasa");
  $("#btn-conteo").setAttribute("aria-pressed", m === "conteo");
  $("#btn-tasa").setAttribute("aria-pressed", m === "tasa");
  document.querySelectorAll(".anillo.se-mueve").forEach((a) => { a.style.animation = "none"; void a.getBoundingClientRect(); a.style.animation = ""; });
  dibujaLista();
  const a = $("#aviso-cambio");
  if (m === "tasa") {
    const mov = D.estaciones.filter((s) => s.estrato === "a" && seMueve(s));
    const bajan = mov.filter((s) => s.cambio < 0 && s.estatus === "no" && s.pos_encogida > 40).sort((p, q) => p.pos_conteo - q.pos_conteo);
    const suben = mov.filter((s) => s.cambio > 0 && s.estatus === "arriba").sort((p, q) => p.pos_encogida - q.pos_encogida);
    const nombres = (l) => l.slice(0, 3).map((s) => `<span class="nw">${esc(s.nombre)} <b>${s.pos_conteo} → ${s.pos_encogida}</b></span>`).join(" · ");
    a.innerHTML = `<strong>${mov.length} estaciones se mueven más de ${D.meta.umbral_de_cambio} lugares</strong>
      <br>Bajan: ${nombres(bajan)}
      <br>Suben ▲: ${nombres(suben)}`;
  } else a.innerHTML = "";
}

/* ------------------------------------------------------------------ detalle */
function elige(nombre, desdeLista) {
  elegida = nombre;
  document.querySelectorAll(".est.elegida, #lista li.elegida").forEach((n) => n.classList.remove("elegida"));
  document.querySelectorAll(`.est[data-nombre="${CSS.escape(nombre)}"]`).forEach((n) => n.classList.add("elegida"));
  const s = porNombre[nombre];
  if (s.estrato === "a" && s.evidencia_insuficiente && $("#ocultar-insuficientes").checked) { $("#ocultar-insuficientes").checked = false; dibujaLista(); }
  const li = document.querySelector(`#lista li[data-nombre="${CSS.escape(nombre)}"]`);
  if (li) { li.classList.add("elegida"); if (!desdeLista) li.scrollIntoView({ block: "nearest" }); }
  $("#detalle").innerHTML = s.estrato === "a" ? fichaA(s) : s.estrato === "edomex" ? fichaEdomex(s) : fichaCorr(s);
  if (desdeLista && matchMedia("(max-width: 860px)").matches) $("#detalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

const cifra = (t, v, sub, clase = "") => `<div class="cifra ${clase}"><dt>${t}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ""}</dd></div>`;
const lineasTxt = (s) => "Línea" + (s.lineas.length > 1 ? "s " : " ") + s.lineas.join(", ");

function fichaA(s) {
  const m = D.meta, n = m.estrato_a.estaciones, e = ESTATUS[s.estatus];
  const etiqs = `<span class="etiqueta ${e.clase}">${e.glifo} ${e.corto}</span>`
    + (s.evidencia_insuficiente ? ' <span class="etiqueta insuf">evidencia insuficiente</span>' : "")
    + (s.sensible_al_umbral ? ' <span class="etiqueta insuf">sensible a la asignación</span>' : "");
  let lectura;
  if (s.evidencia_insuficiente) lectura = `<strong>Evidencia insuficiente:</strong> ${s.denuncias} denuncias en seis años${s.pos_encogida <= 20 ? `; el lugar ${s.pos_encogida} por tasa no cuenta` : ""}. No entra en ninguna recomendación.`;
  else if (s.estatus === "arriba") lectura = `<strong>${num(s.razon_encogida, 1)} veces</strong> la tasa de una estación típica. Por conteo: lugar ${s.pos_conteo}.`;
  else if (s.estatus === "abajo") lectura = `<strong>${num(s.razon_encogida, 2)} veces</strong> la tasa de una estación típica.`;
  else if (s.pos_conteo <= 15 && s.pos_encogida > 40) lectura = `<strong>Lugar ${s.pos_conteo} por conteo, ${s.pos_encogida} por tasa.</strong> Mucha afluencia; tasa típica.`;
  else lectura = "Tasa no distinguible de la típica.";
  const sensible = s.sensible_al_umbral
    ? `<p>${s.nombre === "Tasqueña"
      ? "Sensible a cómo se asignan las carpetas: terminal con paradero; con un radio de 100 m tiene 42 denuncias, con 150 m (el usado) 59, y con 250 m 65."
      : "Sensible a cómo se asignan las carpetas: con un radio de 100 m en vez de 150 m deja de distinguirse en el análisis descriptivo."}</p>` : "";
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas">${etiqs}</p>
    <p class="sub">${lineasTxt(s)}</p>
    <dl class="cifras">
      ${cifra("Denuncias por millón de entradas", num(s.tasa_encogida_mm, 2), `IC 95 %: ${ic(s.tasa_encogida_ic95)} · lugar ${s.pos_encogida} de ${n}`, "principal")}
      ${cifra("× estación típica", num(s.razon_encogida, 2), `IC: ${ic(s.razon_encogida_ic95)}`)}
      ${cifra("Denuncias", num(s.denuncias), `IC: ${num(byar(s.denuncias)[0])} a ${num(byar(s.denuncias)[1])} · lugar ${s.pos_conteo}`)}
      ${cifra("Entradas", num(s.entradas_M, 1) + " M", "")}
    </dl>
    <p class="lectura">${lectura}</p>
    ${serieSvg(s)}
    <details class="como"><summary>¿Cómo se calcula?</summary>
      <p>Tasa de una binomial negativa con efecto de estación y de año, que jala la tasa cruda hacia la típica (${num(m.modelo.tasa_de_la_estacion_tipica_mm, 2)}) según la evidencia: cruda ${num(s.tasa_denuncias_mm, 2)} (IC ${ic(s.tasa_ic95)}) → ${num(s.tasa_encogida_mm, 2)}. Serie anual: tasa cruda con intervalo de Poisson. Son denuncias: una tasa alta puede ser más robo o más disposición a denunciar.</p>${sensible}
    </details>`;
}

function fichaCorr(s) {
  const mult = s.transbordos_multiplo_de_entradas;
  const t7 = mult > 0
    ? `Para bajar a la tasa de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón) harían falta ${num(s.transbordos_necesarios_M)} millones de transbordos en seis años: ${num(mult, 1)} veces sus entradas.`
    : `Aun contando solo sus entradas, su tasa ya está por debajo de la de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón).`;
  const anom = s.estrato === "c"
    ? `<p class="lectura"><strong>${num(s.razon_vs_controles, 1)} veces</strong> la tasa de correspondencias comparables. Sin explicación con datos abiertos.</p>` : "";
  const anomDet = s.estrato === "c"
    ? `<p>Con solo denuncias digitales: ${num(s.razon_vs_controles_solo_digital, 1)} veces. Un flujo de transbordo de ${num(mult, 1)} veces sus entradas no es verosímil, y una agencia del Ministerio Público cerca no lo explica (se probó y se descartó).</p>` : "";
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas"><span class="etiqueta nomedible">no medible</span>${s.estrato === "c" ? ' <span class="etiqueta anomala">anómala</span>' : ""}</p>
    <p class="sub">${lineasTxt(s)} · correspondencia</p>
    <dl class="cifras">
      ${cifra("Denuncias", num(s.denuncias), `IC: ${num(byar(s.denuncias)[0])} a ${num(byar(s.denuncias)[1])}`)}
      ${cifra("Entradas", num(s.entradas_M, 1) + " M", "")}
      ${cifra("Transbordos necesarios", mult > 0 ? num(mult, 1) + " ×" : "ninguno", "sus entradas")}
    </dl>
    ${anom}
    <details class="como"><summary>¿Cómo se calcula?</summary>
      <p>Quien transborda está en la estación pero no pasa por su torniquete: las entradas subestiman a la gente y la tasa saldría inflada. No hay dato público de transbordos por estación.</p>
      <p>${t7} Es una cota aritmética, no una estimación.</p>${anomDet}
    </details>`;
}

function fichaEdomex(s) {
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas"><span class="etiqueta nomedible">no se mide</span></p>
    <p class="sub">${lineasTxt(s)} · Estado de México</p>
    <p class="lectura">Se denuncia ante la fiscalía del Estado de México.</p>`;
}

function byar(d) {
  if (d === 0) return [0, 3.69];
  return [d * Math.pow(1 - 1 / (9 * d) - 1.96 / (3 * Math.sqrt(d)), 3), (d + 1) * Math.pow(1 - 1 / (9 * (d + 1)) + 1.96 / (3 * Math.sqrt(d + 1)), 3)];
}

function serieSvg(s) {
  const W = 320, H = 130, m = { l: 30, r: 8, t: 12, b: 30 };
  const abiertas = s.serie.filter((a) => !a.cerrada);
  // el techo lo fija la tasa, no un intervalo enorme de un año con dos denuncias; los bigotes que no caben se recortan
  const max = Math.max(D.meta.estrato_a.tasa_denuncias_mm * 1.5, 1.8 * Math.max(...abiertas.map((a) => a.tasa_denuncias_mm)));
  const x = (i) => m.l + (i + 0.5) * ((W - m.l - m.r) / s.serie.length);
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  let g = `<line x1="${m.l}" y1="${y(0)}" x2="${W - m.r}" y2="${y(0)}" stroke="#b8c4cf"/>`;
  [0, max].forEach((v) => (g += `<text x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end">${num(v, 1)}</text>`));
  s.serie.forEach((a, i) => {
    g += `<text x="${x(i)}" y="${H - m.b + 12}" text-anchor="middle">${a.anio}</text>`;
    if (a.cerrada) { g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">cerrada</text>`; return; }
    g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">${a.denuncias} den.</text>`;
    const tope = Math.min(a.tasa_ic95[1], max);
    g += `<line x1="${x(i)}" y1="${y(a.tasa_ic95[0])}" x2="${x(i)}" y2="${y(tope)}" stroke="#5b6b7b" stroke-width="1.4"/>`;
    if (a.tasa_ic95[1] > max) g += `<text x="${x(i) + 4}" y="${y(max) + 8}">↑ ${num(a.tasa_ic95[1], 1)}</text>`;
    g += `<circle cx="${x(i)}" cy="${y(a.tasa_denuncias_mm)}" r="3.2" fill="#5b6b7b"/>`;
  });
  return `<svg class="serie" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tasa cruda de denuncias por millón de entradas por año, con intervalo de Poisson al 95 %">
    <text x="${m.l}" y="9">Tasa cruda por año (IC 95 %)</text>${g}</svg>`;
}

inicia().catch((e) => { $("#detalle").innerHTML = `<p class="pista">No se pudieron cargar los datos: ${esc(String(e))}</p>`; });
