# Robos denunciados en el Metro de la CDMX: conteo contra tasa

Página: <https://sebastiancordoba.github.io/metro-denuncias-cdmx/>

Las listas oficiales y de prensa ordenan las estaciones del Metro por número de denuncias
de robo a pasajero. Aquí se comparan con las denuncias por millón de entradas, en las 124
estaciones donde esa tasa se puede medir con datos abiertos. Son DENUNCIAS (carpetas de
investigación de la FGJ CDMX), no robos; datos hasta el 31 de enero de 2025.

Este repositorio es **solo un espejo para publicar la página**: `index.html`, `estilo.css`,
`app.js`, `sw.js` y `datos.json`. Sin backend, sin compilación y sin dependencias externas;
una vez abierta, funciona sin conexión. El código que genera `datos.json`, el método y las
decisiones viven en el repositorio del proyecto (caso de titulación, ITAM, Sebastián
Córdoba), que se abrirá junto con este trabajo y lo reemplazará.

Para verla en tu máquina: `python3 -m http.server 8000` en esta carpeta y abre
<http://localhost:8000>.

Fuentes: carpetas de investigación de la FGJ CDMX, afluencia diaria y estaciones del STC
Metro, en el Portal de Datos Abiertos de la Ciudad de México.
