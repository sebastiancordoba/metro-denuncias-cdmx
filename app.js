/* Robos DENUNCIADOS en el Metro de la CDMX: conteo contra tasa.
   Sin dependencias ni servicios externos: un JSON precomputado (datos.json) y SVG a mano. */
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

let D, porNombre = {}, modo = "conteo", elegida = null, vista = null, vistaTotal = null;

// Divergente centrado en 1.0, en escala logarítmica, saturado en 1/3 y 3.
function colorRazon(r) {
  const t = Math.max(-1, Math.min(1, Math.log(Math.max(r, 0.01)) / Math.log(3)));
  const mezcla = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const blanco = [247, 247, 242], alto = [179, 65, 44], bajo = [47, 102, 144];
  const c = t >= 0 ? mezcla(blanco, alto, t) : mezcla(blanco, bajo, -t);
  return `rgb(${c.join(",")})`;
}
const radio = (d) => 3.2 + 1.15 * Math.sqrt(d);

async function inicia() {
  D = await (await fetch("datos.json")).json();
  D.estaciones.forEach((s) => (porNombre[s.nombre] = s));
  const m = D.meta;
  $("#corte").textContent = m.fecha_de_corte;
  $("#corte2").textContent = m.fecha_de_corte;
  $("#n-a").textContent = m.estrato_a.estaciones;
  $("#pct-sin").textContent = num(m.pct_sin_asignar, 1);
  $("#min-d").textContent = m.min_denuncias_para_recomendar;
  dibujaMapa();
  dibujaLeyenda();
  dibujaLista();
  $("#btn-conteo").addEventListener("click", () => ponModo("conteo"));
  $("#btn-tasa").addEventListener("click", () => ponModo("tasa"));
  $("#ver-insuficientes").addEventListener("change", dibujaLista);
  estadoRed();
  window.addEventListener("online", estadoRed);
  window.addEventListener("offline", estadoRed);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function estadoRed() {
  $("#estado-red").textContent = navigator.onLine ? "" : "sin conexión: todo sigue funcionando";
}

/* ------------------------------------------------------------------ mapa */
function dibujaMapa() {
  const svg = $("#mapa");
  const [w, h] = D.meta.viewbox;
  vistaTotal = { x: 0, y: 0, w, h };
  vista = { ...vistaTotal };
  ponVista();
  svg.style.aspectRatio = `${w} / ${h}`;
  const defs = el("defs", {}, svg);
  const trama = el("pattern", { id: "trama", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 4, height: 4, fill: "#d9d7d0" }, trama);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#777", "stroke-width": 1.6 }, trama);

  const gl = el("g", {}, svg);
  D.lineas.forEach((l) => el("polyline", { class: "linea-metro", points: l.puntos.map((p) => p.join(",")).join(" "), stroke: l.color, "stroke-width": 4 }, gl));

  const orden = { edomex: 0, a: 1, b: 2, c: 3 };
  const ests = [...D.estaciones].sort((p, q) => orden[p.estrato] - orden[q.estrato] || q.denuncias - p.denuncias);
  const ge = el("g", {}, svg);
  ests.forEach((s) => {
    const [x, y] = s.xy;
    let nodo;
    if (s.estrato === "a") {
      const r = radio(s.denuncias);
      el("circle", { class: "anillo" + (seMueve(s) ? " se-mueve" : ""), cx: x, cy: y, r: r + 3.5 }, ge);
      nodo = el("circle", { class: "est est-a" + (s.evidencia_insuficiente ? " insuficiente" : ""), cx: x, cy: y, r, fill: colorRazon(s.razon_obs_esp) }, ge);
    } else if (s.estrato === "edomex") {
      nodo = el("circle", { class: "est est-edomex", cx: x, cy: y, r: 3 }, ge);
    } else {
      const r = s.estrato === "c" ? 7.5 : 3.6 + 0.32 * Math.sqrt(s.denuncias);  // chicas a propósito: no se miden, no deben dominar
      nodo = el("rect", { class: "est est-" + s.estrato, x: x - r, y: y - r, width: 2 * r, height: 2 * r, transform: `rotate(45 ${x} ${y})` }, ge);
      if (s.estrato === "c") el("text", { class: "rotulo", x: x + r + 6, y: y + 4 }, ge).textContent = s.nombre;
    }
    nodo.dataset.nombre = s.nombre;
    nodo.addEventListener("click", (ev) => { ev.stopPropagation(); elige(s.nombre); });
    nodo.addEventListener("pointerenter", (ev) => muestraTooltip(ev, s));
    nodo.addEventListener("pointerleave", () => ($("#tooltip").hidden = true));
  });

  // acercar, alejar, arrastrar, rueda
  $("#zoom-mas").addEventListener("click", () => zoom(0.6));
  $("#zoom-menos").addEventListener("click", () => zoom(1 / 0.6));
  $("#zoom-todo").addEventListener("click", () => { vista = { ...vistaTotal }; ponVista(); });
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
      if (previo) { vista.x -= (ev.clientX - previo.x) * k; vista.y -= (ev.clientY - previo.y) * k; ponVista(); }
      previo = { x: ev.clientX, y: ev.clientY };
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (previo && previo.dist) zoom(previo.dist / dist, puntoSvg({ clientX: (pts[0].clientX + pts[1].clientX) / 2, clientY: (pts[0].clientY + pts[1].clientY) / 2 }));
      previo = { dist };
    }
  });
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
  const w = Math.min(vistaTotal.w * 1.2, Math.max(vistaTotal.w / 12, vista.w * f));
  const k = w / vista.w;
  vista = { x: cx - (cx - vista.x) * k, y: cy - (cy - vista.y) * k, w, h: vista.h * k };
  ponVista();
}
function ponVista() {
  const svg = $("#mapa");
  svg.setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.w} ${vista.h}`);
  svg.classList.toggle("acercado", vista.w < vistaTotal.w * 0.98);
}

function muestraTooltip(ev, s) {
  const t = $("#tooltip");
  let txt = `<strong>${esc(s.nombre)}</strong><br>`;
  if (s.estrato === "a") {
    txt += `${num(s.denuncias)} robos denunciados · ${num(s.tasa_denuncias_mm, 2)} denuncias por millón de entradas (IC 95 %: ${num(s.tasa_ic95[0], 2)} a ${num(s.tasa_ic95[1], 2)})`;
    if (s.evidencia_insuficiente) txt += "<br>Evidencia insuficiente: menos de " + D.meta.min_denuncias_para_recomendar + " denuncias";
  } else if (s.estrato === "edomex") txt += "Fuera de la CDMX: se denuncia ante otra fiscalía. No se mide.";
  else txt += `${num(s.denuncias)} robos denunciados · correspondencia: no medible con datos abiertos`;
  t.innerHTML = txt;
  t.hidden = false;
  const caja = $("#mapa-caja").getBoundingClientRect();
  t.style.left = Math.min(ev.clientX - caja.left + 12, caja.width - 220) + "px";
  t.style.top = ev.clientY - caja.top + 14 + "px";
}

function dibujaLeyenda() {
  const cuad = (clase, extra = "") => `<svg width="16" height="16" viewBox="0 0 16 16"><defs><pattern id="trama-l" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#d9d7d0"/><line x1="0" y1="0" x2="0" y2="4" stroke="#777" stroke-width="1.6"/></pattern></defs><rect x="3.5" y="3.5" width="9" height="9" transform="rotate(45 8 8)" fill="url(#trama-l)" stroke="${extra ? "#000" : "#555"}" stroke-width="${extra ? 2 : 0.8}"/></svg>`;
  $("#leyenda").innerHTML = `
    <span class="item"><span class="rampa-caja"><span class="rampa"></span><span><b>⅓</b><b>1.0</b><b>3</b></span></span>
      denuncias observadas ÷ esperadas por sus entradas</span>
    <span class="item"><svg width="34" height="16"><circle cx="6" cy="8" r="3.5" fill="#ddd" stroke="#333"/><circle cx="23" cy="8" r="7.5" fill="#ddd" stroke="#333"/></svg> tamaño = robos denunciados</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="5" fill="#fff" stroke="#8a8a86" stroke-dasharray="2 1.5"/></svg> menos de ${D.meta.min_denuncias_para_recomendar} denuncias: evidencia insuficiente</span>
    <span class="item">${cuad()} correspondencia: no medible con datos abiertos</span>
    <span class="item">${cuad("c", "c")} Hidalgo y Guerrero: anómalas, hallazgo aparte</span>
    <span class="item"><svg width="16" height="16"><circle cx="8" cy="8" r="3" fill="#e4e2dc" stroke="#aaa"/></svg> Estado de México: otra fiscalía</span>`;
}

/* ------------------------------------------------------------------ lista */
const seMueve = (s) => !s.evidencia_insuficiente && Math.abs(s.cambio) > D.meta.umbral_de_cambio;

function dibujaLista() {
  const ol = $("#lista");
  const antes = new Map([...ol.children].map((li) => [li.dataset.nombre, li.getBoundingClientRect().top]));
  const verInsuf = $("#ver-insuficientes").checked;
  const clave = modo === "conteo" ? "pos_conteo" : "pos_tasa";
  const filas = D.estaciones.filter((s) => s.estrato === "a" && (verInsuf || !s.evidencia_insuficiente))
    .sort((p, q) => p[clave] - q[clave] || q.denuncias - p.denuncias);
  $("#lista-nota").textContent = verInsuf ? "" : `El lugar es entre las ${D.meta.estrato_a.estaciones} estaciones; se saltan números porque ${D.meta.estrato_a.estaciones - filas.length} con menos de ${D.meta.min_denuncias_para_recomendar} denuncias no se listan.`;
  $("#lista-titulo").textContent = modo === "conteo"
    ? `Por CONTEO de robos denunciados · ${filas.length} estaciones sin correspondencia`
    : `Por TASA de denuncias por millón de entradas · ${filas.length} estaciones sin correspondencia`;
  ol.innerHTML = "";
  filas.forEach((s) => {
    const li = document.createElement("li");
    li.dataset.nombre = s.nombre;
    if (s.evidencia_insuficiente) li.classList.add("insuficiente");
    if (seMueve(s)) li.classList.add("se-mueve");
    if (s.nombre === elegida) li.classList.add("elegida");
    let mov = "";
    if (modo === "tasa" && seMueve(s)) mov = s.cambio > 0 ? `<span class="mov sube">▲ ${s.cambio} lugares</span>` : `<span class="mov baja">▼ ${-s.cambio} lugares</span>`;
    const etiq = s.evidencia_insuficiente ? ' <span class="etiqueta insuf">insuficiente</span>'
      : modo === "tasa" && s.firme ? ` <span class="etiqueta ${s.firme}">firme ${s.firme}</span>` : "";
    const val = modo === "conteo"
      ? `${num(s.denuncias)} <small>denuncias</small>`
      : `${num(s.tasa_denuncias_mm, 2)} <small>(${num(s.tasa_ic95[0], 2)}–${num(s.tasa_ic95[1], 2)}) por millón</small>`;
    li.innerHTML = `<span class="pos">${s[clave]}</span><span class="nom">${esc(s.nombre)}${etiq}${mov}</span><span class="val">${val}</span>`;
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
  // reinicia la animación de los anillos
  document.querySelectorAll(".anillo.se-mueve").forEach((a) => { a.style.animation = "none"; void a.getBoundingClientRect(); a.style.animation = ""; });
  dibujaLista();
  const a = $("#aviso-cambio");
  if (m === "tasa") {
    const mov = D.estaciones.filter((s) => s.estrato === "a" && seMueve(s));
    const bajan = mov.filter((s) => s.cambio < 0).sort((p, q) => p.pos_conteo - q.pos_conteo);
    const suben = mov.filter((s) => s.cambio > 0).sort((p, q) => p.pos_tasa - q.pos_tasa);
    const nombres = (l) => l.slice(0, 4).map((s) => `${esc(s.nombre)} (${s.pos_conteo}.º → ${s.pos_tasa}.º)`).join(", ");
    a.innerHTML = `<strong>${mov.length} estaciones cambian más de ${D.meta.umbral_de_cambio} lugares</strong> al pasar de conteo a tasa.
      <br>Bajan, sobre todo las terminales: ${nombres(bajan)}.
      <br>Suben: ${nombres(suben)}.`;
  } else a.innerHTML = "";
}

/* ------------------------------------------------------------------ detalle */
function elige(nombre, desdeLista) {
  elegida = nombre;
  document.querySelectorAll(".est.elegida, #lista li.elegida").forEach((n) => n.classList.remove("elegida"));
  document.querySelectorAll(`.est[data-nombre="${CSS.escape(nombre)}"]`).forEach((n) => n.classList.add("elegida"));
  const s = porNombre[nombre];
  if (s.estrato === "a" && s.evidencia_insuficiente && !$("#ver-insuficientes").checked) { $("#ver-insuficientes").checked = true; dibujaLista(); }
  const li = document.querySelector(`#lista li[data-nombre="${CSS.escape(nombre)}"]`);
  if (li) { li.classList.add("elegida"); if (!desdeLista) li.scrollIntoView({ block: "nearest" }); }
  $("#detalle").innerHTML = s.estrato === "a" ? fichaA(s) : s.estrato === "edomex" ? fichaEdomex(s) : fichaCorr(s);
  if (desdeLista && matchMedia("(max-width: 860px)").matches) $("#detalle").scrollIntoView({ behavior: "smooth", block: "start" });
}

const cifra = (t, v, sub) => `<div class="cifra"><dt>${t}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ""}</dd></div>`;
const lineasTxt = (s) => "Línea" + (s.lineas.length > 1 ? "s " : " ") + s.lineas.join(", ");

function fichaA(s) {
  const m = D.meta;
  const etiq = s.evidencia_insuficiente ? '<span class="etiqueta insuf">evidencia insuficiente</span>'
    : s.firme ? `<span class="etiqueta ${s.firme}">firme por ${s.firme} del promedio</span>` : "";
  let lectura;
  if (s.evidencia_insuficiente) lectura = `Con ${s.denuncias} denuncias en seis años el intervalo es tan ancho que esta estación <strong>no entra en ninguna recomendación</strong>, salga donde salga por tasa.`;
  else if (s.firme === "arriba") lectura = `Tiene <strong>${num(s.razon_obs_esp, 1)} veces</strong> las denuncias que se esperarían por sus entradas, y el intervalo no toca 1. Las listas por conteo la ponen en el lugar ${s.pos_conteo}.`;
  else if (s.firme === "abajo") lectura = `Tiene <strong>menos denuncias de las esperables</strong> por sus entradas (razón ${num(s.razon_obs_esp, 2)}), aunque por conteo ocupe el lugar ${s.pos_conteo}.`;
  else lectura = "Su tasa de denuncias no se distingue de la del conjunto de estaciones sin correspondencia: el intervalo incluye 1.";
  return `<h3>${esc(s.nombre)} ${etiq}</h3>
    <p class="sub">${lineasTxt(s)} · estación sin correspondencia · hechos de 2019 a 2024</p>
    <dl class="cifras">
      ${cifra("Robos denunciados", num(s.denuncias), `lugar ${s.pos_conteo} de ${m.estrato_a.estaciones} por conteo`)}
      ${cifra("Entradas", num(s.entradas_M, 1) + " M", "por torniquete, meses abierta")}
      ${cifra("Denuncias por millón de entradas", num(s.tasa_denuncias_mm, 2), `IC 95 %: ${num(s.tasa_ic95[0], 2)} a ${num(s.tasa_ic95[1], 2)} · lugar ${s.pos_tasa} por tasa · conjunto: ${num(m.estrato_a.tasa_denuncias_mm, 2)}`)}
      ${cifra("Observadas ÷ esperadas", num(s.razon_obs_esp, 2), `IC 95 %: ${num(s.razon_ic95[0], 2)} a ${num(s.razon_ic95[1], 2)} · esperadas: ${num(s.denuncias_esperadas, 1)}, descontando el año`)}
    </dl>
    <p class="nota">${lectura}</p>
    ${serieSvg(s)}
    <p class="nota">Intervalos de Poisson (aproximación de Byar). Son denuncias: una tasa alta puede ser más robo o más disposición a denunciar.</p>`;
}

function fichaCorr(s) {
  const mult = s.transbordos_multiplo_de_entradas;
  const t7 = mult > 0
    ? `Para que su tasa de denuncias bajara a la de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón) harían falta <strong>${num(s.transbordos_necesarios_M)} millones de transbordos</strong> en seis años: <strong>${num(mult, 1)} veces sus entradas</strong>.`
    : `Aun contando solo sus entradas, su tasa de denuncias ya está por debajo de la de las estaciones de paso (${num(D.meta.tasa_de_paso_usada_en_t7, 2)} por millón).`;
  const anom = s.estrato === "c"
    ? `<p class="nota"><strong>Hallazgo aparte.</strong> ${esc(s.nombre)} tiene ${num(s.razon_vs_controles, 1)} veces la tasa de denuncias de correspondencias comparables, y ${num(s.razon_vs_controles_solo_digital, 1)} veces si solo se cuentan denuncias digitales. Un flujo de transbordo de ${num(mult, 1)} veces sus entradas no es verosímil, y tener una agencia del Ministerio Público cerca no lo explica (se probó). Con datos abiertos no se sabe si es más robo o algo de cómo se registra el lugar.</p>` : "";
  return `<h3>${esc(s.nombre)} <span class="etiqueta nomedible">no medible con datos abiertos</span></h3>
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
  return `<h3>${esc(s.nombre)} <span class="etiqueta nomedible">no se mide</span></h3>
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
  const ref = D.meta.estrato_a.tasa_denuncias_mm;
  let g = `<line x1="${m.l}" y1="${y(0)}" x2="${W - m.r}" y2="${y(0)}" stroke="#bbb"/>`;
  g += `<line x1="${m.l}" y1="${y(ref)}" x2="${W - m.r}" y2="${y(ref)}" stroke="#b3412c" stroke-dasharray="3 3" stroke-width=".8"/><text x="${W - m.r}" y="${y(ref) - 3}" text-anchor="end" fill="#b3412c">conjunto del periodo: ${num(ref, 2)}</text>`;
  [0, max].forEach((v) => (g += `<text x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end">${num(v, 1)}</text>`));
  s.serie.forEach((a, i) => {
    g += `<text x="${x(i)}" y="${H - m.b + 12}" text-anchor="middle">${a.anio}</text>`;
    if (a.cerrada) { g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">cerrada</text>`; return; }
    g += `<text x="${x(i)}" y="${H - m.b + 23}" text-anchor="middle">${a.denuncias} den.</text>`;
    const tope = Math.min(a.tasa_ic95[1], max);
    g += `<line x1="${x(i)}" y1="${y(a.tasa_ic95[0])}" x2="${x(i)}" y2="${y(tope)}" stroke="#555" stroke-width="1.4"/>`;
    if (a.tasa_ic95[1] > max) g += `<text x="${x(i) + 4}" y="${y(max) + 8}">↑ ${num(a.tasa_ic95[1], 1)}</text>`;
    g += `<circle cx="${x(i)}" cy="${y(a.tasa_denuncias_mm)}" r="3.4" fill="#1d1d1b"/>`;
  });
  return `<svg class="serie" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Denuncias por millón de entradas por año, con intervalo de Poisson al 95 %">
    <text x="${m.l}" y="9">Denuncias por millón de entradas, por año (IC 95 %)</text>${g}</svg>`;
}

inicia().catch((e) => { $("#detalle").innerHTML = `<p class="pista">No se pudieron cargar los datos: ${esc(String(e))}</p>`; });
