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

let D, porNombre = {}, modo = "conteo", periodo = "todo", elegida = null, vista = null, vistaTotal = null, nodos = [];

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
  dibujaPeriodos();
  $("#tab-estaciones").addEventListener("click", () => ponPestana("estaciones"));
  $("#tab-graficas").addEventListener("click", () => ponPestana("graficas"));
  $("#tab-desplegar").addEventListener("click", () => ponPestana("desplegar"));
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

// Periodo: «todo» usa el modelo (tasa encogida); un año usa la tasa CRUDA de ese año con su intervalo de Byar.
const MIN = () => D.meta.min_denuncias_para_recomendar;
const delAnio = (s) => s.serie.find((a) => a.anio === periodo && !a.cerrada);
const insuf = (s) => (periodo === "todo" ? s.evidencia_insuficiente : (delAnio(s)?.denuncias ?? 0) < MIN());

function dibujaPeriodos() {
  const caja = $("#periodos");
  ["todo", 2019, 2020, 2021, 2022, 2023, 2024].forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p === "todo" ? "2019–2024" : p;
    b.setAttribute("aria-pressed", p === periodo);
    b.addEventListener("click", () => ponPeriodo(p));
    caja.appendChild(b);
  });
}

function ponPeriodo(p) {
  if (p === periodo) return;
  periodo = p;
  document.querySelectorAll("#periodos button").forEach((b, i) => b.setAttribute("aria-pressed", ["todo", 2019, 2020, 2021, 2022, 2023, 2024][i] === p));
  document.body.classList.toggle("modo-anio", p !== "todo");
  dibujaLista();
  pintaAviso();
  marcaAnioMensual();
  if (elegida) elige(elegida, true, true);
}

// Lugar con empates compartidos (1, 2, 2, 4): con conteos chicos de un año, los empates son muchos.
function lugares(filas, valor) {
  const pos = new Map();
  filas.forEach((s, i) => pos.set(s.nombre, i && valor(s) === valor(filas[i - 1]) ? pos.get(filas[i - 1].nombre) : i + 1));
  return pos;
}

function filasDelPeriodo() {
  const a = D.estaciones.filter((s) => s.estrato === "a");
  if (periodo === "todo") {
    const clave = modo === "conteo" ? "pos_conteo" : "pos_encogida";
    const filas = a.sort((p, q) => p[clave] - q[clave] || q.denuncias - p.denuncias);
    return { filas, pos: new Map(filas.map((s) => [s.nombre, s[clave]])), total: filas.length };
  }
  const v = modo === "conteo" ? (s) => delAnio(s).denuncias : (s) => delAnio(s).tasa_denuncias_mm;
  const filas = a.filter(delAnio).sort((p, q) => v(q) - v(p) || delAnio(q).denuncias - delAnio(p).denuncias || p.nombre.localeCompare(q.nombre));
  return { filas, pos: lugares(filas, v), total: filas.length };
}

function dibujaLista() {
  const ol = $("#lista");
  const antes = new Map([...ol.children].map((li) => [li.dataset.nombre, li.getBoundingClientRect().top]));
  const ocultar = $("#ocultar-insuficientes").checked;
  const { filas: todas, pos, total } = filasDelPeriodo();
  const filas = todas.filter((s) => !(ocultar && insuf(s)));
  const anio = periodo !== "todo";
  $("#lista-titulo").textContent = anio
    ? `${periodo} · por ${modo === "conteo" ? "conteo" : "tasa cruda"} · ${total} estaciones abiertas`
    : `Por ${modo} · ${total} estaciones`;
  const suficientes = todas.filter((s) => !insuf(s)).length;
  $("#lista-nota").textContent = anio ? `${suficientes} de ${total} con ${MIN()} denuncias o más en ${periodo}. El mapa sigue en 2019–2024.` : "";
  ol.innerHTML = "";
  if (!filas.length) ol.innerHTML = `<li class="vacia">Ninguna estación tiene ${MIN()} denuncias o más en ${periodo}.</li>`;
  filas.forEach((s) => {
    const li = document.createElement("li");
    const y = anio ? delAnio(s) : null;
    li.dataset.nombre = s.nombre;
    li.classList.add("est-" + (anio ? "nodist" : ESTATUS[s.estatus].clase));
    if (insuf(s)) li.classList.add("insuficiente");
    if (!anio && seMueve(s)) li.classList.add("se-mueve");
    if (s.nombre === elegida) li.classList.add("elegida");
    let mov = "";
    if (!anio && modo === "tasa" && seMueve(s)) mov = s.cambio > 0 ? `<span class="mov sube">sube ${s.cambio}</span>` : `<span class="mov baja">baja ${-s.cambio}</span>`;
    const e = ESTATUS[s.estatus];
    const etiq = insuf(s) ? '<span class="etiqueta insuf">evidencia insuficiente</span>' : "";
    const [t, ic95] = anio ? [y.tasa_denuncias_mm, y.tasa_ic95] : [s.tasa_encogida_mm, s.tasa_encogida_ic95];
    const val = modo === "conteo"
      ? `${num(anio ? y.denuncias : s.denuncias)} <small>denuncias</small>`
      : `${num(t, 2)} <small>(${num(ic95[0], 2)}–${num(ic95[1], 2)})</small>`;
    li.innerHTML = `<span class="pos">${pos.get(s.nombre)}<small> de ${total}</small></span><span class="glifo" title="${e.corto}">${insuf(s) ? "·" : e.glifo}</span><span class="nom">${esc(s.nombre)} ${etiq}${mov}</span><span class="val">${val}</span>`;
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
  pintaAviso();
}

// El aviso de cambio es del periodo completo (modelo): en un año suelto no aplica.
function pintaAviso() {
  const a = $("#aviso-cambio");
  if (modo === "tasa" && periodo === "todo") {
    const mov = D.estaciones.filter((s) => s.estrato === "a" && seMueve(s));
    const bajan = mov.filter((s) => s.cambio < 0 && s.estatus === "no" && s.pos_encogida > 40).sort((p, q) => p.pos_conteo - q.pos_conteo);
    const suben = mov.filter((s) => s.cambio > 0 && s.estatus === "arriba").sort((p, q) => p.pos_encogida - q.pos_encogida);
    const nombres = (l) => l.slice(0, 3).map((s) => `<span class="nw">${esc(s.nombre)} <b>${s.pos_conteo} → ${s.pos_encogida}</b></span>`).join(" · ");
    a.innerHTML = `<strong>${mov.length} estaciones se mueven más de ${D.meta.umbral_de_cambio} lugares</strong>
      <br>Bajan: ${nombres(bajan)}
      <br>Suben ▲: ${nombres(suben)}`;
  } else a.innerHTML = "";
}

/* ------------------------------------------------------------------ pestaña «En el tiempo» */
// Todas las gráficas: SVG a mano, sin librerías. Tooltip común (#tip-g) con puntero o toque.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const PALETA = ["#d7263d", "#1b6ca8", "#e87511", "#118749", "#a02d96", "#b69c13", "#00a6a6", "#512826", "#e9468f", "#5b6b7b"];
let graficasListas = false;

function ponPestana(t) {
  const otra = t !== "estaciones";
  document.body.classList.toggle("tab-graficas", otra); // oculta mapa, lista, interruptor y «dos reglas»
  ["estaciones", "graficas", "desplegar"].forEach((k) => $("#tab-" + k).setAttribute("aria-selected", k === t));
  $("#graficas").hidden = t !== "graficas";
  $("#desplegar").hidden = t !== "desplegar";
  $("#tip-g").hidden = true;
  if (t === "graficas" && !graficasListas) { graficasListas = true; dibujaGraficas(); }
  if (t === "desplegar") dibujaDesplegar();
  if (!otra) ponRotulos();
  window.scrollTo(0, 0);
}

function tip(ev, html) {
  const t = $("#tip-g");
  if (!html) { t.hidden = true; return; }
  t.innerHTML = html; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 6) x = Math.max(6, ev.clientX - w - 14);
  if (y + h > innerHeight - 6) y = Math.max(6, ev.clientY - h - 14);
  t.style.left = x + "px"; t.style.top = y + "px";
}
// coordenadas del puntero en unidades del viewBox
function enSvg(svg, ev) {
  const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function montaSvg(caja, W, H, contenido, etiqueta) {
  caja.querySelector(".g-svg").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${etiqueta}">${contenido}</svg>`;
  const svg = caja.querySelector(".g-svg svg");
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") tip(ev, null); });
  return svg;
}
const ejeY = (m, W, y, max, paso, d = 1) => {
  let g = "";
  for (let v = 0; v <= max + 1e-9; v += paso) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="reja"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v, d)}</text>`;
  return g;
};
const techo = (v, paso) => Math.ceil(v / paso) * paso;

function dibujaGraficas() {
  graficaMensual();
  ["m-desde", "m-hasta"].forEach((id) => $("#" + id).addEventListener("input", (ev) => {
    const a = $("#m-desde"), b = $("#m-hasta");
    if (+a.value > +b.value - 5) { if (ev.target === a) a.value = +b.value - 5; else b.value = +a.value + 5; }
    graficaMensual();
  }));
  $("#m-todo").addEventListener("click", () => { $("#m-desde").value = 0; $("#m-hasta").value = 71; graficaMensual(); });
  graficaAnualInicia();
  graficaRed();
  graficaDispersion();
  graficaDistribucion();
  graficaEstacional();
  graficaHora();
  $("#mensual-nota").textContent = `No se ordena por mes: en el ${num(D.mensual.pct_meses_estacion_0_a_2, 0)} % de los ${num(D.mensual.meses_estacion)} meses-estación hubo 0 a 2 denuncias (máximo ${D.mensual.max_denuncias_estacion_mes}).`;
}

// 1. Serie mensual con rango elegible. La marca del eje cae JUSTO en el punto del mes que nombra.
function graficaMensual() {
  if (!graficasListas) return;
  const T = D.mensual.serie, i0 = +$("#m-desde").value, i1 = +$("#m-hasta").value, S = T.slice(i0, i1 + 1);
  const W = innerWidth < 700 ? 720 : 1000, H = 300, m = { l: 48, r: 14, t: 10, b: 34 };
  const max = techo(Math.max(...S.map((p) => p.tasa_ic95[1])), 0.5);
  const paso = (W - m.l - m.r) / Math.max(1, S.length - 1);
  const x = (i) => m.l + i * paso, y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  let g = ejeY(m, W, y, max, 0.5);
  const cada = S.length > 30 ? 12 : S.length > 12 ? 3 : 1;
  S.forEach((p, i) => {
    const mes = +p.mes.slice(5) - 1, anio = +p.mes.slice(0, 4);
    if (anio === periodo) g += `<rect x="${x(i) - paso / 2}" y="${m.t}" width="${paso}" height="${H - m.t - m.b}" class="banda-anio"/>`;
    if (mes % cada === 0) g += `<line x1="${x(i)}" x2="${x(i)}" y1="${H - m.b}" y2="${H - m.b + 5}" stroke="#7a8794"/><text x="${x(i)}" y="${H - m.b + 20}" text-anchor="${i === 0 ? "start" : "middle"}">${cada === 12 ? anio : MESES[mes] + " " + String(anio).slice(2)}</text>`;
  });
  const banda = S.map((p, i) => `${x(i).toFixed(1)},${y(p.tasa_ic95[1]).toFixed(1)}`).join(" ") + " " + S.map((p, i) => `${x(i).toFixed(1)},${y(p.tasa_ic95[0]).toFixed(1)}`).reverse().join(" ");
  g += `<polygon points="${banda}" class="ic"/><polyline points="${S.map((p, i) => `${x(i).toFixed(1)},${y(p.tasa_denuncias_mm).toFixed(1)}`).join(" ")}" class="tasa"/>`;
  S.forEach((p, i) => (g += `<circle cx="${x(i)}" cy="${y(p.tasa_denuncias_mm)}" r="${S.length > 40 ? 2.2 : 3.5}" class="punto"/>`));
  g += `<line class="guia" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><circle class="foco" r="5.5" visibility="hidden"/>`;
  const caja = $("#g-mensual");
  const svg = montaSvg(caja, W, H, g, "Denuncias por millón de entradas por mes, con intervalo al 95 %");
  const f = (p) => `${MESES[+p.mes.slice(5) - 1]} ${p.mes.slice(0, 4)}`;
  $("#m-rango").textContent = `${f(S[0])} – ${f(S[S.length - 1])}`;
  const guia = svg.querySelector(".guia"), foco = svg.querySelector(".foco");
  svg.addEventListener("pointermove", (ev) => {
    const q = enSvg(svg, ev), i = Math.max(0, Math.min(S.length - 1, Math.round((q.x - m.l) / paso))), p = S[i];
    guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.setAttribute("visibility", "visible");
    foco.setAttribute("cx", x(i)); foco.setAttribute("cy", y(p.tasa_denuncias_mm)); foco.setAttribute("visibility", "visible");
    tip(ev, `<b>${f(p)}</b><br>${num(p.tasa_denuncias_mm, 2)} por millón de entradas<br>IC 95 %: ${ic(p.tasa_ic95)}<br>${num(p.denuncias)} denuncias`);
  });
  svg.addEventListener("pointerleave", () => { guia.setAttribute("visibility", "hidden"); foco.setAttribute("visibility", "hidden"); });
}
function marcaAnioMensual() { graficaMensual(); }

// Gráfica de líneas por año con leyenda que aísla. series: [{nombre, color, puntos: [{anio, v, ic, den}]}]
function lineasAnuales(caja, series, etiqueta) {
  const W = 720, H = 260, m = { l: 50, r: 14, t: 12, b: 28 }, anios = [2019, 2020, 2021, 2022, 2023, 2024];
  let aislada = caja.dataset.aislada || null;
  if (aislada && !series.some((s) => s.nombre === aislada)) aislada = null;
  const visibles = series.filter((s) => !aislada || s.nombre === aislada);
  const vmax = Math.max(...visibles.flatMap((s) => s.puntos.map((p) => Math.min(p.ic[1], p.v * 2.2))), 0.5);
  const max = techo(vmax, vmax > 3 ? 1 : 0.5), y = (v) => H - m.b - (Math.min(v, max) / max) * (H - m.t - m.b);
  const x = (a) => m.l + 20 + ((a - 2019) / 5) * (W - m.l - m.r - 40);
  let g = ejeY(m, W, y, max, max > 3 ? 1 : 0.5);
  anios.forEach((a) => (g += `<text x="${x(a)}" y="${H - 8}" text-anchor="middle">${a}</text>`));
  visibles.forEach((s) => {
    // un año cerrado corta la línea
    let tramo = [];
    const tramos = [];
    anios.forEach((a) => { const p = s.puntos.find((q) => q.anio === a); if (p) tramo.push(p); else if (tramo.length) { tramos.push(tramo); tramo = []; } });
    if (tramo.length) tramos.push(tramo);
    if (aislada) s.puntos.forEach((p) => (g += `<line x1="${x(p.anio)}" x2="${x(p.anio)}" y1="${y(p.ic[0])}" y2="${y(p.ic[1])}" stroke="${s.color}" stroke-width="2" opacity=".45"/>`));
    tramos.forEach((t) => (g += `<polyline class="serie-l" data-n="${esc(s.nombre)}" points="${t.map((p) => `${x(p.anio)},${y(p.v)}`).join(" ")}" stroke="${s.color}"/>`));
    s.puntos.forEach((p) => (g += `<circle cx="${x(p.anio)}" cy="${y(p.v)}" r="3.6" fill="${s.color}" data-n="${esc(s.nombre)}"/>`));
  });
  g += `<circle class="foco" r="6.5" visibility="hidden"/>`;
  const svg = montaSvg(caja, W, H, g, etiqueta), foco = svg.querySelector(".foco");
  svg.addEventListener("pointermove", (ev) => {
    const q = enSvg(svg, ev);
    let mejor = null, dmin = 1e9;
    visibles.forEach((s) => s.puntos.forEach((p) => { const d = Math.hypot(x(p.anio) - q.x, y(p.v) - q.y); if (d < dmin) { dmin = d; mejor = [s, p]; } }));
    if (!mejor || dmin > 60) { foco.setAttribute("visibility", "hidden"); tip(ev, null); return; }
    const [s, p] = mejor;
    foco.setAttribute("cx", x(p.anio)); foco.setAttribute("cy", y(p.v)); foco.setAttribute("stroke", s.color); foco.setAttribute("visibility", "visible");
    svg.querySelectorAll(".serie-l").forEach((l) => l.classList.toggle("tenue", l.dataset.n !== s.nombre));
    tip(ev, `<b>${esc(s.nombre)} · ${p.anio}</b><br>${num(p.v, 2)} por millón de entradas<br>IC 95 %: ${ic(p.ic)}<br>${num(p.den)} denuncias${p.den < MIN() && s.estacion ? " · evidencia insuficiente" : ""}`);
  });
  svg.addEventListener("pointerleave", () => { foco.setAttribute("visibility", "hidden"); svg.querySelectorAll(".serie-l").forEach((l) => l.classList.remove("tenue")); });
  const ley = caja.querySelector(".g-leyenda");
  ley.innerHTML = "";
  series.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ley" + (aislada && aislada !== s.nombre ? " apagada" : "");
    b.setAttribute("aria-pressed", aislada === s.nombre);
    b.innerHTML = `<i style="background:${s.color}"></i>${esc(s.nombre)}`;
    b.addEventListener("click", () => { caja.dataset.aislada = aislada === s.nombre ? "" : s.nombre; lineasAnuales(caja, series, etiqueta); });
    ley.appendChild(b);
  });
}

// 2. Serie anual por estación: top por tasa (modelo) o por conteo, con 15 denuncias o más; se pueden agregar otras.
let anualGrupo = "tasa", anualExtra = [];
function graficaAnualInicia() {
    [["tasa", "Top 8 por tasa"], ["conteo", "Top 8 por conteo"]].forEach(([k, t]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = t; b.dataset.k = k;
    b.setAttribute("aria-pressed", k === anualGrupo);
    b.addEventListener("click", () => { anualGrupo = k; anualExtra = []; $("#g-anual").dataset.aislada = ""; document.querySelectorAll("#anual-grupo button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.k === k)); graficaAnual(); });
    $("#anual-grupo").appendChild(b);
  });
  const sel = $("#anual-agrega");
  D.estaciones.filter((s) => s.estrato === "a").sort((p, q) => p.nombre.localeCompare(q.nombre)).forEach((s) => sel.add(new Option(s.nombre, s.nombre)));
  sel.addEventListener("change", () => { if (sel.value && !anualExtra.includes(sel.value)) anualExtra.push(sel.value); sel.value = ""; graficaAnual(); });
  graficaAnual();
}
function graficaAnual() {
  const a = D.estaciones.filter((s) => s.estrato === "a" && !s.evidencia_insuficiente);
  const clave = anualGrupo === "tasa" ? "pos_encogida" : "pos_conteo";
  const top = a.sort((p, q) => p[clave] - q[clave]).slice(0, 8).map((s) => s.nombre);
  const nombres = [...top, ...anualExtra.filter((n) => !top.includes(n))];
  const series = nombres.map((n, i) => ({ nombre: n, estacion: true, color: PALETA[i % PALETA.length],
    puntos: porNombre[n].serie.filter((p) => !p.cerrada).map((p) => ({ anio: p.anio, v: p.tasa_denuncias_mm, ic: p.tasa_ic95, den: p.denuncias })) }));
  lineasAnuales($("#g-anual"), series, "Tasa cruda de denuncias por año, por estación");
}

// 3. Red completa contra el estrato, por año (c3_por_anio)
function graficaRed() {
  const nombres = { red: "Red completa (todas las carpetas)", estrato: "124 estaciones sin correspondencia" };
  const series = ["red", "estrato"].map((k, i) => ({ nombre: nombres[k], color: i ? "#f05a1a" : "#10233f",
    puntos: D.mensual.anual.filter((p) => p.serie.startsWith(k)).map((p) => ({ anio: p.anio, v: p.tasa_denuncias_mm, ic: p.tasa_ic95, den: p.denuncias })) }));
  lineasAnuales($("#g-red"), series, "Tasa de denuncias por año: red completa contra estrato");
}

// 4. Dispersión: denuncias (escala log) contra tasa cruda, las 124. Tocar un punto abre su ficha.
function graficaDispersion() {
  const A = D.estaciones.filter((s) => s.estrato === "a");
  $("#disp-sub").textContent = `Las 124 estaciones. ρ de Spearman = ${num(D.mensual.spearman_conteo_tasa, 3)}: el conteo y la tasa ordenan distinto. Toca un punto para ver su ficha.`;
  const W = 720, H = 340, m = { l: 50, r: 14, t: 12, b: 50 };
  const lx = (v) => Math.log10(v), x0 = lx(1), x1 = lx(Math.max(...A.map((s) => s.denuncias)) * 1.15);
  const ymax = techo(Math.max(...A.map((s) => s.tasa_denuncias_mm)), 0.5);
  const x = (v) => m.l + ((lx(v) - x0) / (x1 - x0)) * (W - m.l - m.r), y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  let g = ejeY(m, W, y, ymax, ymax > 3 ? 1 : 0.5);
  [1, 2, 5, 10, 20, 50, 100].forEach((v) => (g += `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}" class="reja"/><text x="${x(v)}" y="${H - m.b + 16}" text-anchor="middle">${v}</text>`));
  g += `<text x="${(W + m.l) / 2}" y="${H - 8}" text-anchor="middle">denuncias en 2019–2024 (escala log)</text>`;
  g += `<line x1="${x(MIN())}" x2="${x(MIN())}" y1="${m.t}" y2="${H - m.b}" class="corte-min"/><text x="${x(MIN()) - 4}" y="${m.t + 10}" text-anchor="end">&lt; ${MIN()}: evidencia insuficiente</text>`;
  A.forEach((s) => (g += `<circle cx="${x(s.denuncias).toFixed(1)}" cy="${y(s.tasa_denuncias_mm).toFixed(1)}" r="4.2" class="pt ${s.evidencia_insuficiente ? "pt-insuf" : "pt-" + s.estatus}" data-n="${esc(s.nombre)}"/>`));
  g += `<circle class="foco" r="8" visibility="hidden"/>`;
  const svg = montaSvg($("#g-dispersion"), W, H, g, "Denuncias contra tasa cruda, 124 estaciones"), foco = svg.querySelector(".foco");
  const cerca = (ev) => { const q = enSvg(svg, ev); let b = null, d = 1e9; A.forEach((s) => { const k = Math.hypot(x(s.denuncias) - q.x, y(s.tasa_denuncias_mm) - q.y); if (k < d) { d = k; b = s; } }); return d < 30 ? b : null; };
  svg.addEventListener("pointermove", (ev) => {
    const s = cerca(ev);
    if (!s) { foco.setAttribute("visibility", "hidden"); tip(ev, null); return; }
    foco.setAttribute("cx", x(s.denuncias)); foco.setAttribute("cy", y(s.tasa_denuncias_mm)); foco.setAttribute("visibility", "visible");
    tip(ev, `<b>${esc(s.nombre)}</b><br>${num(s.denuncias)} denuncias · lugar ${s.pos_conteo} por conteo<br>tasa cruda ${num(s.tasa_denuncias_mm, 2)} (IC ${ic(s.tasa_ic95)})<br>${s.evidencia_insuficiente ? "evidencia insuficiente" : ESTATUS[s.estatus].glifo + " " + ESTATUS[s.estatus].corto}`);
  });
  svg.addEventListener("click", (ev) => { const s = cerca(ev); if (s) { ponPestana("estaciones"); elige(s.nombre); } });
}

// 5. Distribución de la tasa cruda, apilando las de evidencia insuficiente
function graficaDistribucion() {
  const A = D.estaciones.filter((s) => s.estrato === "a"), ancho = 0.25;
  const nb = Math.ceil(Math.max(...A.map((s) => s.tasa_denuncias_mm)) / ancho);
  const bins = Array.from({ length: nb }, (_, i) => ({ de: i * ancho, suf: [], ins: [] }));
  A.forEach((s) => bins[Math.min(nb - 1, Math.floor(s.tasa_denuncias_mm / ancho))][s.evidencia_insuficiente ? "ins" : "suf"].push(s.nombre));
  const ninsuf = A.filter((s) => s.evidencia_insuficiente).length;
  $("#dist-sub").innerHTML = `Tasa cruda de las 124. <span class="cuadro"></span> ${124 - ninsuf} con ${MIN()} denuncias o más · <span class="cuadro insuf"></span> ${ninsuf} con evidencia insuficiente.`;
  const W = 720, H = 250, m = { l: 50, r: 14, t: 12, b: 50 };
  const cmax = techo(Math.max(...bins.map((b) => b.suf.length + b.ins.length)), 5);
  const bw = (W - m.l - m.r) / nb, y = (v) => H - m.b - (v / cmax) * (H - m.t - m.b);
  let g = ejeY(m, W, y, cmax, 5, 0);
  bins.forEach((b, i) => {
    const X = m.l + i * bw;
    g += `<rect x="${X + 1}" y="${y(b.suf.length)}" width="${bw - 2}" height="${y(0) - y(b.suf.length)}" class="barra" data-i="${i}"/>`;
    g += `<rect x="${X + 1}" y="${y(b.suf.length + b.ins.length)}" width="${bw - 2}" height="${y(b.suf.length) - y(b.suf.length + b.ins.length)}" class="barra insuf" data-i="${i}"/>`;
    if (i % 2 === 0) g += `<text x="${X}" y="${H - m.b + 16}" text-anchor="middle">${num(b.de, 1)}</text>`;
  });
  g += `<text x="${(W + m.l) / 2}" y="${H - 8}" text-anchor="middle">denuncias por millón de entradas</text>`;
  const svg = montaSvg($("#g-distribucion"), W, H, g, "Histograma de la tasa cruda");
  svg.addEventListener("pointermove", (ev) => {
    const q = enSvg(svg, ev), i = Math.floor((q.x - m.l) / bw), b = bins[i];
    svg.querySelectorAll(".barra").forEach((r) => r.classList.toggle("activa", +r.dataset.i === i));
    if (!b || !(b.suf.length + b.ins.length)) { tip(ev, null); return; }
    const lista = (l) => l.slice(0, 5).map(esc).join(", ") + (l.length > 5 ? ` y ${l.length - 5} más` : "");
    tip(ev, `<b>${num(b.de, 2)} a ${num(b.de + ancho, 2)}</b><br>${b.suf.length} con ${MIN()}+ denuncias${b.suf.length ? ": " + lista(b.suf) : ""}<br>${b.ins.length} insuficientes${b.ins.length ? ": " + lista(b.ins) : ""}`);
  });
  svg.addEventListener("pointerleave", () => svg.querySelectorAll(".barra").forEach((r) => r.classList.remove("activa")));
}

// 6. Estacionalidad: tasa por mes del año, régimen normal (eda_estacionalidad)
function graficaEstacional() {
  const E = D.mensual.estacionalidad, W = 720, H = 220, m = { l: 60, r: 14, t: 12, b: 28 };
  const max = techo(Math.max(...E.map((p) => p.tasa_ic95[1])), 0.25);
  const x = (i) => m.l + 20 + (i / 11) * (W - m.l - m.r - 40), y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  let g = ejeY(m, W, y, max, 0.25, 2);
  E.forEach((p, i) => {
    g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${MESES[p.mes - 1]}</text>`;
    g += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(p.tasa_ic95[0])}" y2="${y(p.tasa_ic95[1])}" stroke="#f05a1a" stroke-width="3" opacity=".35"/>`;
    g += `<circle cx="${x(i)}" cy="${y(p.tasa_denuncias_mm)}" r="5" class="punto"/>`;
  });
  g += `<circle class="foco" r="8" visibility="hidden"/>`;
  const svg = montaSvg($("#g-estacional"), W, H, g, "Tasa de denuncias por mes del año"), foco = svg.querySelector(".foco");
  svg.addEventListener("pointermove", (ev) => {
    const q = enSvg(svg, ev), i = Math.max(0, Math.min(11, Math.round(((q.x - m.l - 20) / (W - m.l - m.r - 40)) * 11))), p = E[i];
    foco.setAttribute("cx", x(i)); foco.setAttribute("cy", y(p.tasa_denuncias_mm)); foco.setAttribute("visibility", "visible");
    tip(ev, `<b>${MESES[p.mes - 1]}</b> (${p.n_meses} años)<br>${num(p.tasa_denuncias_mm, 2)} por millón de entradas<br>IC 95 %: ${ic(p.tasa_ic95)}<br>${num(p.denuncias)} denuncias`);
  });
  svg.addEventListener("pointerleave", () => foco.setAttribute("visibility", "hidden"));
}

// 7. Hora × día de la semana: conteos (eda_hora_dia_estrato)
function graficaHora() {
  const M = D.mensual.hora_dia, W = 720, H = 230, m = { l: 52, r: 8, t: 8, b: 26 };
  const max = Math.max(...M.flat());
  const cw = (W - m.l - m.r) / 24, ch = (H - m.t - m.b) / 7;
  let g = "";
  M.forEach((fila, d) => {
    g += `<text x="${m.l - 6}" y="${m.t + d * ch + ch / 2 + 4}" text-anchor="end">${DIAS[d].slice(0, 3)}</text>`;
    fila.forEach((v, h) => {
      const k = Math.sqrt(v / max);
      g += `<rect x="${m.l + h * cw + 0.5}" y="${m.t + d * ch + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="2" fill="rgb(${Math.round(255 - k * (255 - 16))},${Math.round(255 - k * (255 - 35))},${Math.round(255 - k * (255 - 63))})" class="celda"/>`;
    });
  });
  for (let h = 0; h < 24; h += 3) g += `<text x="${m.l + h * cw + cw / 2}" y="${H - 8}" text-anchor="middle">${h} h</text>`;
  g += `<rect class="marco" width="${cw}" height="${ch}" visibility="hidden"/>`;
  const svg = montaSvg($("#g-hora"), W, H, g, "Denuncias por hora del día y día de la semana"), marco = svg.querySelector(".marco");
  svg.addEventListener("pointermove", (ev) => {
    const q = enSvg(svg, ev), h = Math.floor((q.x - m.l) / cw), d = Math.floor((q.y - m.t) / ch);
    if (h < 0 || h > 23 || d < 0 || d > 6) { marco.setAttribute("visibility", "hidden"); tip(ev, null); return; }
    marco.setAttribute("x", m.l + h * cw); marco.setAttribute("y", m.t + d * ch); marco.setAttribute("visibility", "visible");
    tip(ev, `<b>${DIAS[d]}, ${h}:00 a ${h}:59</b><br>${num(M[d][h])} denuncias`);
  });
  svg.addEventListener("pointerleave", () => marco.setAttribute("visibility", "hidden"));
}

/* ------------------------------------------------------------------ pestaña «Dónde desplegar» */
// Tres listas (decisión 65). Dos vistas que no se mezclan: «probadas» (elegidas con 2019–2023, con lo que cubrieron
// en 2024) y «hoy» (2019–2024 completo, sin cifra de cobertura: 2024 ya está dentro de la lista).
let colDesplegar = 0, vistaDesp = "probadas", kDesp = 10;
function listasDesplegar() {
  const P = D.desplegar, fuente = vistaDesp === "probadas" ? P.probadas : P.hoy;
  const filas = (c) => fuente[c].slice(0, kDesp).map((x) => (typeof x === "string" ? { estacion: x } : x));
  return [
    { titulo: "Por conteo", sub: "más denuncias", filas: filas("conteo") },
    { titulo: "Por tasa", sub: "mayor tasa del modelo", filas: filas("tasa") },
    { titulo: "La que proponemos", sub: P.regla_propuesta, filas: filas("propuesta") },
  ];
}
function botonesDesp(caja, opciones, actual, poner) {
  caja.innerHTML = opciones.map(([v, t]) => `<button type="button" aria-pressed="${v === actual}" data-v="${v}">${t}</button>`).join("");
  caja.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { poner(b.dataset.v); dibujaDesplegar(); }));
}
function dibujaDesplegar() {
  const L = listasDesplegar(), probadas = vistaDesp === "probadas";
  botonesDesp($("#desp-vista"), [["probadas", "Probadas en 2024"], ["hoy", "Para desplegar hoy"]], vistaDesp, (v) => (vistaDesp = v));
  botonesDesp($("#desp-k"), [["10", "10 estaciones"], ["20", "20 estaciones"]], String(kDesp), (v) => (kDesp = +v));
  $("#desp-nota").textContent = probadas
    ? "Elegidas con 2019–2023; abajo, lo que cubrió cada lista en 2024."
    : "Elegidas con 2019–2024. Sin cifra de cobertura: 2024 ya está dentro de estas listas.";
  const veces = new Map();
  L.forEach((l) => l.filas.forEach((x) => veces.set(x.estacion, (veces.get(x.estacion) || 0) + 1)));
  const cub = L.map((l) => { const d = l.filas.reduce((a, x) => a + x.denuncias_2024, 0), e = l.filas.reduce((a, x) => a + x.entradas_2024_M, 0); return [d, d / e, e]; });
  $("#desp-cols").innerHTML = L.map((l, k) => {
    const filas = l.filas.map((x, i) => {
      const v = veces.get(x.estacion), s = porNombre[x.estacion];
      const marca = s && s.evidencia_insuficiente ? ' <span class="etiqueta insuf">evidencia insuficiente</span>' : "";
      return `<li class="en-${v}" data-n="${esc(x.estacion)}"><span class="pos">${i + 1}</span><span class="nom">${esc(x.estacion)}${marca}</span><span class="veces" title="en ${v} de las 3 listas">${"●".repeat(v)}${"○".repeat(3 - v)}</span></li>`;
    }).join("");
    const pie = probadas ? `<dl class="d-cubre"><div><dt>Denuncias de 2024 cubiertas</dt><dd>${num(cub[k][0])}</dd></div>
        <div><dt>Denuncias por millón de entradas</dt><dd>${num(cub[k][1], 2)}</dd></div>
        <div><dt>Afluencia a vigilar</dt><dd>${num(cub[k][2], 0)} M</dd></div></dl>` : "";
    return `<section class="d-col${k === colDesplegar ? " activa" : ""}" data-k="${k}">
      <h3>${l.titulo}</h3><p class="sub">${esc(l.sub)}</p><ol>${filas}</ol>${pie}</section>`;
  }).join("");
  $("#desp-selector").innerHTML = L.map((l, k) => `<button type="button" aria-pressed="${k === colDesplegar}" data-k="${k}">${l.titulo}</button>`).join("");
  $("#desp-selector").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { colDesplegar = +b.dataset.k; dibujaDesplegar(); }));
  // en teléfono se ve una lista a la vez: la comparación de lo que cubre cada una va en una tabla aparte
  $("#desp-resumen").innerHTML = probadas ? `<table><thead><tr><th>En 2024</th>${L.map((l) => `<th>${l.titulo.replace("La que proponemos", "Propuesta")}</th>`).join("")}</tr></thead><tbody>
    <tr><th>Denuncias</th>${cub.map((c) => `<td>${num(c[0])}</td>`).join("")}</tr>
    <tr><th>Por millón</th>${cub.map((c) => `<td>${num(c[1], 2)}</td>`).join("")}</tr>
    <tr><th>Afluencia</th>${cub.map((c) => `<td>${num(c[2], 0)} M</td>`).join("")}</tr></tbody></table>` : "";
  // pasar o tocar una estación la resalta en las tres listas
  document.querySelectorAll("#desp-cols li").forEach((li) => {
    const marca = (on) => document.querySelectorAll(`#desp-cols li[data-n="${CSS.escape(li.dataset.n)}"]`).forEach((x) => x.classList.toggle("resalta", on));
    li.addEventListener("pointerenter", () => marca(true));
    li.addEventListener("pointerleave", () => marca(false));
    li.addEventListener("click", () => { document.querySelectorAll("#desp-cols li.resalta").forEach((x) => x.classList.remove("resalta")); marca(true); });
  });
}

/* ------------------------------------------------------------------ detalle */
function elige(nombre, desdeLista, quieto) {
  elegida = nombre;
  document.querySelectorAll(".est.elegida, #lista li.elegida").forEach((n) => n.classList.remove("elegida"));
  document.querySelectorAll(`.est[data-nombre="${CSS.escape(nombre)}"]`).forEach((n) => n.classList.add("elegida"));
  const s = porNombre[nombre];
  if (s.estrato === "a" && insuf(s) && $("#ocultar-insuficientes").checked) { $("#ocultar-insuficientes").checked = false; dibujaLista(); }
  const li = document.querySelector(`#lista li[data-nombre="${CSS.escape(nombre)}"]`);
  if (li) { li.classList.add("elegida"); if (!desdeLista && !quieto) li.scrollIntoView({ block: "nearest" }); }
  $("#detalle").innerHTML = s.estrato === "a" ? fichaA(s) : s.estrato === "edomex" ? fichaEdomex(s) : fichaCorr(s);
  if (desdeLista && !quieto && matchMedia("(max-width: 860px)").matches) $("#detalle").scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (a.anio === periodo) g += `<rect x="${x(i) - 22}" y="${m.t - 2}" width="44" height="${H - m.t + 2}" rx="4" fill="#fff1e8"/>`;
    g += `<text x="${x(i)}" y="${H - m.b + 12}" text-anchor="middle"${a.anio === periodo ? ' font-weight="700"' : ""}>${a.anio}</text>`;
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
