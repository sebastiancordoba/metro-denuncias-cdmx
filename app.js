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
  const blanco = [247, 247, 242], alto = [179, 65, 44], bajo = [47, 102, 144];
  const c = t >= 0 ? mezcla(blanco, alto, t) : mezcla(blanco, bajo, -t);
  return `rgb(${c.join(",")})`;
}
const radio = (d) => 3 + 1.05 * Math.sqrt(d);

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
  window.addEventListener("resize", ponVista);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function estadoRed() {
  $("#estado-red").textContent = navigator.onLine ? "" : "· sin conexión: todo sigue funcionando";
}

/* ------------------------------------------------------------------ mapa */
function forma(s, g) {
  // La forma codifica el estatus además del color: ▲ arriba, ▼ abajo, ○ no distinguible.
  const r = radio(s.denuncias);
  const relleno = colorRazon(s.razon_encogida);
  if (s.evidencia_insuficiente) return el("circle", { class: "est est-a insuficiente", r: Math.max(r, 4.2) }, g);
  if (s.estatus === "no") return el("circle", { class: "est est-a nodist", r, fill: relleno }, g);
  const R = r * 1.45, k = s.estatus === "arriba" ? -1 : 1;
  const pts = [[0, k * R], [R * 0.95, -k * R * 0.62], [-R * 0.95, -k * R * 0.62]].map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
  return el("polygon", { class: "est est-a dist", points: pts, fill: relleno }, g);
}

function dibujaMapa() {
  const svg = $("#mapa");
  const [w, h] = D.meta.viewbox;
  vistaTotal = { x: 0, y: 0, w, h };
  vista = { ...vistaTotal };
  svg.style.aspectRatio = `${w} / ${h}`;
  const defs = el("defs", {}, svg);
  const trama = el("pattern", { id: "trama", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 4, height: 4, fill: "#d9d7d0" }, trama);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#777", "stroke-width": 1.6 }, trama);

  const gl = el("g", { id: "lineas" }, svg);
  D.lineas.forEach((l) => el("polyline", { class: "linea-metro", points: l.puntos.map((p) => p.join(",")).join(" "), stroke: l.color }, gl));

  const orden = { edomex: 0, b: 1, a: 2, c: 3 };
  const peso = (s) => (s.estrato === "a" && s.estatus !== "no" && !s.evidencia_insuficiente ? 1 : 0);
  const ests = [...D.estaciones].sort((p, q) => orden[p.estrato] - orden[q.estrato] || peso(p) - peso(q) || q.denuncias - p.denuncias);
  const ge = el("g", {}, svg), gt = el("g", { id: "rotulos" }, svg);
  ests.forEach((s) => {
    const g = el("g", { class: "nodo" }, ge);
    let marca, r;
    if (s.estrato === "a") {
      r = radio(s.denuncias);
      el("circle", { class: "anillo" + (seMueve(s) ? " se-mueve" : ""), r: r * 1.5 + 4 }, g);
      marca = forma(s, g);
    } else if (s.estrato === "edomex") {
      r = 2.6;
      marca = el("circle", { class: "est est-edomex", r }, g);
    } else {
      r = s.estrato === "c" ? 7.5 : 3.4 + 0.3 * Math.sqrt(s.denuncias); // chicas a propósito: no se miden, no deben dominar
      marca = el("rect", { class: "est est-" + s.estrato, x: -r, y: -r, width: 2 * r, height: 2 * r, transform: "rotate(45)" }, g);
    }
    marca.dataset.nombre = s.nombre;
    marca.addEventListener("click", (ev) => { ev.stopPropagation(); elige(s.nombre); });
    marca.addEventListener("pointerenter", (ev) => muestraTooltip(ev, s));
    marca.addEventListener("pointerleave", () => ($("#tooltip").hidden = true));
    // Rótulo: las distinguibles (con evidencia suficiente) y las dos anómalas. Primero las de más evidencia.
    let rotulo = null;
    const conRotulo = s.estrato === "c" || (s.estrato === "a" && s.estatus !== "no" && !s.evidencia_insuficiente);
    if (conRotulo) {
      rotulo = el("text", { class: "rotulo" + (s.estrato === "c" ? " rotulo-c" : " rotulo-" + s.estatus) }, gt);
      rotulo.textContent = (s.estrato === "a" ? ESTATUS[s.estatus].glifo + " " : "") + s.nombre.replace("/Plaza de la Transparencia", "").replace("/Poder Judicial CDMX", "").replace("/Tenochtitlan", "").replace("/Arena Ciudad de México", "");
    }
    nodos.push({ s, g, r, rotulo, prioridad: s.estrato === "c" ? 1e6 : s.denuncias });
  });
  ponVista();

  $("#zoom-mas").addEventListener("click", () => zoom(0.6));
  $("#zoom-menos").addEventListener("click", () => zoom(1 / 0.6));
  $("#zoom-todo").addEventListener("click", () => { vista = { ...vistaTotal }; ponVista(); });
  $("#zoom-centro").addEventListener("click", verCentro);
  svg.addEventListener("wheel", (ev) => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 0.85 : 1 / 0.85, puntoSvg(ev)); }, { passive: false });
  const dedos = new Map();
  let previo = null;
  svg.addEventListener("pointerdown", (ev) => { dedos.set(ev.pointerId, ev); svg.classList.add("arrastrando"); previo = null; });
  const suelta = (ev) => { dedos.delete(ev.pointerId); previo = null; if (!dedos.size) svg.classList.remove("arrastrando"); };
  svg.addEventListener("pointerup", suelta);
  svg.addEventListener("pointercancel", suelta);
  svg.addEventListener("pointerleave", suelta);
  svg.addEventListener("pointermove", (ev) => {
    if (!dedos.has(ev.pointerId)) return;
    dedos.set(ev.pointerId, ev);
    const pts = [...dedos.values()];
    const caja = svg.getBoundingClientRect();
    const k = Math.max(vista.w / caja.width, vista.h / caja.height);
    if (pts.length === 1) {
      if (previo && previo.x !== undefined) { vista.x -= (ev.clientX - previo.x) * k; vista.y -= (ev.clientY - previo.y) * k; ponVista(); }
      previo = { x: ev.clientX, y: ev.clientY };
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (previo && previo.dist) zoom(previo.dist / dist, puntoSvg({ clientX: (pts[0].clientX + pts[1].clientX) / 2, clientY: (pts[0].clientY + pts[1].clientY) / 2 }));
      previo = { dist };
    }
  });
}

// El centro: el rectángulo que contiene a las correspondencias del primer cuadro, con margen.
function verCentro() {
  const c = ["Hidalgo", "Guerrero", "Pino Suárez", "Balderas", "Chabacano", "Candelaria", "Tacubaya", "Centro Médico"].map((n) => porNombre[n].xy);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const m = 40, x = Math.min(...xs) - m, y = Math.min(...ys) - m;
  const w = Math.max(...xs) - x + m, h = Math.max(...ys) - y + m;
  const razon = vistaTotal.w / vistaTotal.h;
  const W = Math.max(w, h * razon);
  vista = { x: x - (W - w) / 2, y: y - (W / razon - h) / 2, w: W, h: W / razon };
  ponVista();
}

function puntoSvg(ev) {
  const svg = $("#mapa");
  const p = svg.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return [q.x, q.y];
}
function zoom(f, centro) {
  const [cx, cy] = centro || [vista.x + vista.w / 2, vista.y + vista.h / 2];
  const w = Math.min(vistaTotal.w * 1.2, Math.max(vistaTotal.w / 14, vista.w * f));
  const k = w / vista.w;
  vista = { x: cx - (cx - vista.x) * k, y: cy - (cy - vista.y) * k, w, h: vista.h * k };
  ponVista();
}

function ponVista() {
  const svg = $("#mapa");
  svg.setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
  svg.classList.toggle("acercado", vista.w < vistaTotal.w * 0.98);
  // Los símbolos NO crecen con el acercamiento (crecen mucho menos): así acercarse separa las estaciones.
  const z = vista.w / vistaTotal.w;          // 1 = red completa; menor = más cerca
  const k = Math.pow(z, 0.72);               // escala de los símbolos en unidades del mapa
  $("#lineas").style.strokeWidth = 4 * Math.pow(z, 0.6);
  const ancho = svg.getBoundingClientRect().width || 600;
  const px = vista.w / ancho;                // unidades del mapa por pixel de pantalla
  const letra = 11.5 * px * (ancho < 520 ? 0.92 : 1);
  const ocupados = [];
  nodos.forEach((n) => n.g.setAttribute("transform", `translate(${n.s.xy[0]} ${n.s.xy[1]}) scale(${k})`));
  // Rótulos sin encimarse: entra primero el de más evidencia; el que choca se esconde hasta que te acerques.
  [...nodos].filter((n) => n.rotulo).sort((a, b) => b.prioridad - a.prioridad).forEach((n) => {
    const t = n.rotulo, [x, y] = n.s.xy;
    const w = t.textContent.length * letra * 0.56, h = letra * 1.15, sep = n.r * 1.5 * k + 2.5 * px;
    const opciones = [[x + sep, y + h * 0.35, "start"], [x - sep, y + h * 0.35, "end"], [x, y - sep - h * 0.15, "middle"], [x, y + sep + h * 0.85, "middle"]];
    let puesto = false;
    for (const [tx, ty, ancla] of opciones) {
      const x0 = ancla === "start" ? tx : ancla === "end" ? tx - w : tx - w / 2;
      const caja = [x0, ty - h * 0.85, x0 + w, ty + h * 0.2];
      const fuera = caja[0] < vista.x || caja[2] > vista.x + vista.w || caja[1] < vista.y || caja[3] > vista.y + vista.h;
      if (fuera || ocupados.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue;
      t.setAttribute("x", tx); t.setAttribute("y", ty); t.setAttribute("text-anchor", ancla);
      t.style.fontSize = letra + "px"; t.style.strokeWidth = letra * 0.28 + "px"; t.style.display = "";
      ocupados.push(caja); puesto = true;
      break;
    }
    if (!puesto) t.style.display = "none";
    // el propio símbolo también ocupa lugar, para que otro rótulo no lo tape
    ocupados.push([x - sep, y - sep, x + sep, y + sep]);
  });
}

function muestraTooltip(ev, s) {
  const t = $("#tooltip");
  let txt = `<strong>${esc(s.nombre)}</strong><br>`;
  if (s.estrato === "a") {
    txt += `${num(s.denuncias)} robos denunciados · tasa encogida: ${num(s.tasa_encogida_mm, 2)} denuncias por millón de entradas (IC 95 %: ${ic(s.tasa_encogida_ic95)})<br>${ESTATUS[s.estatus].glifo} ${ESTATUS[s.estatus].corto}`;
    if (s.evidencia_insuficiente) txt += ` · evidencia insuficiente: menos de ${D.meta.min_denuncias_para_recomendar} denuncias`;
  } else if (s.estrato === "edomex") txt += "Fuera de la CDMX: se denuncia ante otra fiscalía. No se mide.";
  else txt += `${num(s.denuncias)} robos denunciados · correspondencia: no medible con datos abiertos`;
  t.innerHTML = txt;
  t.hidden = false;
  const caja = $("#mapa-caja").getBoundingClientRect();
  t.style.left = Math.max(4, Math.min(ev.clientX - caja.left + 12, caja.width - 230)) + "px";
  t.style.top = ev.clientY - caja.top + 14 + "px";
}

function dibujaLeyenda() {
  const m = D.meta.modelo;
  // Las distinguibles con menos de 15 denuncias se dibujan punteadas (manda la regla de evidencia): que la cuenta cuadre a la vista.
  const pocas = (lado) => D.estaciones.filter((s) => s.estrato === "a" && s.estatus === lado && s.evidencia_insuficiente).length;
  const nota = (lado) => (pocas(lado) ? `; ${pocas(lado)} con menos de ${D.meta.min_denuncias_para_recomendar} denuncias van punteadas` : "");
  const cuad = (grueso) => `<svg width="16" height="16" viewBox="0 0 16 16"><defs><pattern id="trama-l" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#d9d7d0"/><line x1="0" y1="0" x2="0" y2="4" stroke="#777" stroke-width="1.6"/></pattern></defs><rect x="3.5" y="3.5" width="9" height="9" transform="rotate(45 8 8)" fill="url(#trama-l)" stroke="${grueso ? "#000" : "#555"}" stroke-width="${grueso ? 2 : 0.8}"/></svg>`;
  $("#leyenda").innerHTML = `
    <span class="item"><svg width="18" height="16"><polygon points="9,2 16,14 2,14" fill="#c9685a" stroke="#1d1d1b" stroke-width="1.4"/></svg> <b>▲ distinguible por arriba</b> (${m.arriba}${nota("arriba")})</span>
    <span class="item"><svg width="18" height="16"><polygon points="9,14 16,2 2,2" fill="#6f98b8" stroke="#1d1d1b" stroke-width="1.4"/></svg> <b>▼ distinguible por abajo</b> (${m.abajo}${nota("abajo")})</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="5.5" fill="#ece6dc" stroke="#999" stroke-width=".8"/></svg> <b>○ no distinguible</b> de una estación típica (${D.meta.estrato_a.estaciones - m.distinguibles}: la mayoría)</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="5" fill="#fff" stroke="#8a8a86" stroke-dasharray="2 1.5"/></svg> menos de ${D.meta.min_denuncias_para_recomendar} denuncias: evidencia insuficiente, salga donde salga</span>
    <span class="item"><span class="rampa-caja"><span class="rampa"></span><span><b>0.4</b><b>1.0</b><b>2.5</b></span></span> color: tasa encogida de denuncias ÷ la de una estación típica</span>
    <span class="item"><svg width="34" height="16"><circle cx="6" cy="8" r="3.5" fill="#ddd" stroke="#333"/><circle cx="23" cy="8" r="7.5" fill="#ddd" stroke="#333"/></svg> tamaño: robos denunciados</span>
    <span class="item">${cuad(false)} correspondencia: no medible con datos abiertos</span>
    <span class="item">${cuad(true)} Hidalgo y Guerrero: anómalas, sin explicación</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="3" fill="#e4e2dc" stroke="#aaa"/></svg> Estado de México: otra fiscalía</span>`;
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
    ? "Por CONTEO de robos denunciados"
    : "Por TASA encogida de denuncias por millón de entradas";
  $("#lista-nota").textContent = `${total} estaciones sin correspondencia. Solo ${D.meta.modelo.distinguibles} se distinguen de una estación típica (▲ ${D.meta.modelo.arriba}, ▼ ${D.meta.modelo.abajo}); las otras ${total - D.meta.modelo.distinguibles}, no.`;
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
    const etiq = (s.evidencia_insuficiente ? '<span class="etiqueta insuf">evidencia insuficiente</span>' : "")
      + (s.estatus !== "no" && !s.evidencia_insuficiente ? `<span class="etiqueta ${e.clase}">${e.glifo} ${e.corto}</span>` : "");
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
    const nombres = (l) => l.slice(0, 4).map((s) => `${esc(s.nombre)} (${s.pos_conteo}.º → ${s.pos_encogida}.º)`).join(", ");
    a.innerHTML = `<strong>${mov.length} estaciones cambian más de ${D.meta.umbral_de_cambio} lugares</strong> al pasar de conteo a tasa.
      <br><strong>Las que encabezan el conteo dejan la cabeza:</strong> ${nombres(bajan)}. No es que sean más seguras: su tasa no se distingue de la de una estación típica. Son ordinarias, y por eso muestran que el conteo ordena por volumen.
      <br><strong>Suben y sí se distinguen (▲):</strong> ${nombres(suben)}.`;
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
  if (s.evidencia_insuficiente && s.pos_encogida <= 20) lectura = `Sale en el lugar ${s.pos_encogida} por tasa encogida, pero con ${s.denuncias} denuncias en seis años <strong>no entra en ninguna recomendación</strong> y su intervalo incluye 1. El modelo encoge su tasa, pero no sustituye a esta regla: el orden solo no protege de la poca evidencia.`;
  else if (s.evidencia_insuficiente) lectura = `Con ${s.denuncias} denuncias en seis años <strong>no entra en ninguna recomendación</strong>, salga donde salga.`;
  else if (s.estatus === "arriba") lectura = `Su tasa encogida es <strong>${num(s.razon_encogida, 1)} veces</strong> la de una estación típica, y el intervalo no toca 1. Las listas por conteo la ponen en el lugar ${s.pos_conteo}.`;
  else if (s.estatus === "abajo") lectura = `Su tasa encogida es <strong>${num(s.razon_encogida, 2)} veces</strong> la de una estación típica, y el intervalo no toca 1: por pasajero se denuncia aquí menos que en la estación típica.`;
  else if (s.pos_conteo <= 15 && s.pos_encogida > 40) lectura = `<strong>Está entre las primeras por conteo (lugar ${s.pos_conteo}) y por tasa queda en el lugar ${s.pos_encogida} de ${n}.</strong> No es que sea más segura: su tasa no se distingue de la de una estación típica (el intervalo incluye 1). Es una estación ordinaria con muchísima afluencia, y eso es justo lo que muestra que el conteo ordena por volumen.`;
  else lectura = `Su tasa de denuncias <strong>no se distingue</strong> de la de una estación típica: el intervalo de la razón incluye 1. Así están ${n - m.modelo.distinguibles} de las ${n}.`;
  const sensible = s.sensible_al_umbral
    ? `<p class="nota"><strong>Sensible a cómo se asignan las carpetas.</strong> ${s.nombre === "Tasqueña"
      ? "Es una terminal con paradero y sus carpetas se dispersan alrededor: con un radio de 100 m tiene 42 denuncias, con 150 m (el usado) 59, y con 250 m 65."
      : "Con un radio de 100 m en vez de 150 m deja de distinguirse de la estación típica en el análisis descriptivo: estaba en el límite."}</p>` : "";
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas">${etiqs}</p>
    <p class="sub">${lineasTxt(s)} · estación sin correspondencia · hechos de 2019 a 2024</p>
    <dl class="cifras">
      ${cifra("Tasa encogida · denuncias por millón de entradas", num(s.tasa_encogida_mm, 2), `IC 95 %: ${ic(s.tasa_encogida_ic95)} · lugar ${s.pos_encogida} de ${n} · estación típica: ${num(m.modelo.tasa_de_la_estacion_tipica_mm, 2)}`, "principal")}
      ${cifra("Razón contra la estación típica", num(s.razon_encogida, 2), `IC 95 %: ${ic(s.razon_encogida_ic95)} · ${e.corto}`)}
      ${cifra("Robos denunciados", num(s.denuncias), `IC 95 %: ${num(byar(s.denuncias)[0])} a ${num(byar(s.denuncias)[1])} · lugar ${s.pos_conteo} de ${n} por conteo`)}
      ${cifra("Entradas", num(s.entradas_M, 1) + " M", "por torniquete, meses abierta")}
    </dl>
    <p class="nota">${lectura}</p>${sensible}
    <p class="secundaria"><strong>Tasa cruda (sin encoger):</strong> ${num(s.tasa_denuncias_mm, 2)} denuncias por millón de entradas (IC 95 %: ${ic(s.tasa_ic95)}). El modelo la jala hacia la estación típica en proporción a la poca evidencia: de ${num(s.tasa_denuncias_mm, 2)} a ${num(s.tasa_encogida_mm, 2)}.</p>
    ${serieSvg(s)}
    <p class="nota">La tasa encogida sale de una binomial negativa con efecto de estación y de año; intervalos al 95 % (los de la serie anual, de Poisson). Son denuncias: una tasa alta puede ser más robo o más disposición a denunciar.</p>`;
}

function fichaCorr(s) {
  const mult = s.transbordos_multiplo_de_entradas;
  const t7 = mult > 0
    ? `Para que su tasa de denuncias bajara a la de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón) harían falta <strong>${num(s.transbordos_necesarios_M)} millones de transbordos</strong> en seis años: <strong>${num(mult, 1)} veces sus entradas</strong>.`
    : `Aun contando solo sus entradas, su tasa de denuncias ya está por debajo de la de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón).`;
  const anom = s.estrato === "c"
    ? `<p class="nota"><strong>Hallazgo aparte.</strong> ${esc(s.nombre)} tiene ${num(s.razon_vs_controles, 1)} veces la tasa de denuncias de correspondencias comparables, y ${num(s.razon_vs_controles_solo_digital, 1)} veces si solo se cuentan denuncias digitales. Un flujo de transbordo de ${num(mult, 1)} veces sus entradas no es verosímil, y tener una agencia del Ministerio Público cerca no lo explica (se probó y se descartó). Con datos abiertos no se sabe si es más robo o algo de cómo se registra el lugar.</p>` : "";
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas"><span class="etiqueta nomedible">no medible con datos abiertos</span>${s.estrato === "c" ? ' <span class="etiqueta anomala">anómala, sin explicación</span>' : ""}</p>
    <p class="sub">${lineasTxt(s)} · correspondencia · hechos de 2019 a 2024</p>
    <dl class="cifras">
      ${cifra("Robos denunciados", num(s.denuncias), `IC 95 %: ${num(byar(s.denuncias)[0])} a ${num(byar(s.denuncias)[1])}`)}
      ${cifra("Entradas", num(s.entradas_M, 1) + " M", "solo quien entra por sus torniquetes")}
      ${cifra("Transbordos que harían falta", mult > 0 ? num(mult, 1) + " × sus entradas" : "ninguno", "cota aritmética, no estimación")}
    </dl>
    <p class="nota"><strong>Por qué aquí no hay ranking.</strong> Quien transborda está expuesto en la estación pero no pasa por su torniquete: las entradas subestiman a la gente que pasa por aquí y cualquier tasa saldría inflada. No hay dato público de transbordos por estación.</p>
    <p class="nota">${t7}</p>${anom}`;
}

function fichaEdomex(s) {
  return `<h3>${esc(s.nombre)}</h3><p class="etiquetas"><span class="etiqueta nomedible">no se mide</span></p>
    <p class="sub">${lineasTxt(s)} · Estado de México</p>
    <p class="nota">Un robo aquí se denuncia ante la Fiscalía del Estado de México, no ante la de la Ciudad de México: en estos datos tiene ${num(s.denuncias)} denuncias por construcción, no por seguridad.</p>`;
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
  let g = `<line x1="${m.l}" y1="${y(0)}" x2="${W - m.r}" y2="${y(0)}" stroke="#bbb"/>`;
  [0, max].forEach((v) => (g += `<text x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end">${num(v, 1)}</text>`));
  s.serie.forEach((a, i) => {
    g += `<text x="${x(i)}" y="${H - m.b + 12}" text-anchor="middle">${a.anio}</text>`;
    if (a.cerrada) { g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">cerrada</text>`; return; }
    g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">${a.denuncias} den.</text>`;
    const tope = Math.min(a.tasa_ic95[1], max);
    g += `<line x1="${x(i)}" y1="${y(a.tasa_ic95[0])}" x2="${x(i)}" y2="${y(tope)}" stroke="#777" stroke-width="1.4"/>`;
    if (a.tasa_ic95[1] > max) g += `<text x="${x(i) + 4}" y="${y(max) + 8}">↑ ${num(a.tasa_ic95[1], 1)}</text>`;
    g += `<circle cx="${x(i)}" cy="${y(a.tasa_denuncias_mm)}" r="3.2" fill="#777"/>`;
  });
  return `<svg class="serie" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tasa cruda de denuncias por millón de entradas por año, con intervalo de Poisson al 95 %">
    <text x="${m.l}" y="9">Tasa CRUDA por año (IC 95 %). 2019 es más alto en toda la red.</text>${g}</svg>`;
}

inicia().catch((e) => { $("#detalle").innerHTML = `<p class="pista">No se pudieron cargar los datos: ${esc(String(e))}</p>`; });
