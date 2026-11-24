import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const raiz = path.resolve(__dirname, "../../..");

test("OPS-004: nginx.conf entrega la SPA, proxea WebSocket y protege rutas internas", () => {
  const nginx = fs.readFileSync(path.join(raiz, "nginx.conf"), "utf8");

  assert.match(nginx, /include\s+\/etc\/nginx\/mime\.types;/);
  assert.match(nginx, /root\s+\/usr\/share\/nginx\/html;/);
  assert.match(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);
  assert.match(nginx, /location\s+\/assets\/\s*\{[^}]*try_files\s+\$uri\s+=404;/);
  assert.match(nginx, /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
  assert.match(nginx, /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/);
  assert.match(nginx, /add_header\s+X-Frame-Options\s+"DENY"\s+always;/);
  assert.match(nginx, /add_header\s+Permissions-Policy\s+"camera=\(\),\s*microphone=\(\),\s*geolocation=\(self\)"\s+always;/);
  const politicaCsp = nginx.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/)?.[1];
  assert.ok(politicaCsp, "Nginx debe publicar una CSP");

  const directiva = (nombre: string) =>
    politicaCsp.split(";").map((parte) => parte.trim()).find((parte) => parte.startsWith(`${nombre} `));

  assert.equal(directiva("default-src"), "default-src 'self'");
  assert.equal(directiva("script-src"), "script-src 'self'");
  assert.equal(directiva("style-src"), "style-src 'self'");
  assert.equal(directiva("style-src-elem"), "style-src-elem 'self'");
  assert.equal(directiva("object-src"), "object-src 'none'");
  assert.equal(directiva("frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directiva("base-uri"), "base-uri 'self'");
  assert.equal(directiva("form-action"), "form-action 'self'");
  assert.doesNotMatch(politicaCsp, /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(directiva("img-src"), "img-src 'self' data: https://tile.openstreetmap.org");
  assert.equal(directiva("font-src"), "font-src 'self'");
  assert.doesNotMatch(
    politicaCsp,
    /unpkg\.com|\*\.tile\.openstreetmap\.org|(?:^|[;\s])ws:(?:[;\s]|$)|(?:^|[;\s])wss:(?:[;\s]|$)/
  );

  const directivaAtributos = directiva("style-src-attr");
  assert.ok(directivaAtributos?.startsWith("style-src-attr 'unsafe-hashes' "));
  const mapa = fs.readFileSync(path.join(raiz, "web/src/componentes/mapa/MapaLeaflet.tsx"), "utf8").replace(/\r\n/g, "\n");
  const htmlPin = mapa.match(/const html = `([\s\S]*?)`;\s*return L\.divIcon/)?.[1];
  assert.ok(htmlPin, "El mapa debe mantener localizable la plantilla del pin para auditar sus hashes CSP");

  const estilosPin = ["#2563eb", "#dc2626", "#059669"].map((color) => {
    const html = htmlPin.replaceAll("${colorFondo}", color);
    const estilo = html.match(/style="([\s\S]*?)"/)?.[1];
    assert.ok(estilo, `Falta el estilo del pin ${color}`);
    return estilo;
  });
  const estilosAltura = [
    "min-height: 360px; height: 100%;",
    "min-height: 360px; height: 440px;",
    "min-height: 360px;",
  ];
  const hashesEsperados = [...estilosPin, ...estilosAltura].map(
    (estilo) => `'sha256-${createHash("sha256").update(estilo, "utf8").digest("base64")}'`
  );
  assert.deepEqual(
    directivaAtributos?.split(/\s+/).slice(2).sort(),
    hashesEsperados.sort(),
    "La CSP solo debe permitir los hashes de estilos conocidos del mapa"
  );
  for (const hash of hashesEsperados) {
    assert.ok(directivaAtributos?.includes(hash), `La CSP debe permitir solo el estilo explícito ${hash}`);
  }

  const connectSrc = directiva("connect-src");
  assert.equal(
    connectSrc,
    "connect-src 'self' ws://localhost:8080 ws://127.0.0.1:8080 wss://localhost:8080 wss://127.0.0.1:8080"
  );
  assert.match(nginx, /client_max_body_size\s+16k;/);
  assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=api_general:10m\s+rate=30r\/s;/);
  assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=auth_tokens:10m\s+rate=10r\/s;/);
  assert.match(nginx, /limit_req_status\s+429;/);
  assert.match(nginx, /location\s+=\s+\/tarifas\/geocodificacion-inversa/);
  assert.match(nginx, /location\s+=\s+\/tiempo-real\s*\{[^}]*proxy_set_header\s+Upgrade\s+\$http_upgrade;/s);
  assert.match(nginx, /location\s+=\s+\/ws\s*\{[^}]*proxy_set_header\s+Upgrade\s+\$http_upgrade;/s);
  assert.match(nginx, /location\s+\^~\s+\/interno\/\s*\{[^}]*return\s+404/s);
  assert.match(nginx, /location\s+\^~\s+\/estimaciones\/\s*\{[^}]*return\s+404/s);
  assert.match(nginx, /location\s+\^~\s+\/auth\/\s*\{[^}]*proxy_pass\s+http:\/\/auth_emulator;/s);
  assert.match(nginx, /location\s+=\s+\/auth\/login\s*\{[^}]*limit_req\s+zone=auth_tokens[^}]*proxy_pass\s+http:\/\/auth_emulator;/s);
  assert.match(nginx, /location\s+=\s+\/auth\/login\s*\{[^}]*proxy_connect_timeout\s+1500ms;[^}]*proxy_read_timeout\s+4s;/s);
  assert.match(nginx, /location\s+\^~\s+\/auth\/\s*\{[^}]*proxy_connect_timeout\s+1500ms;[^}]*proxy_read_timeout\s+4s;/s);
});

test("OPS-004: Dockerfile y docker-compose.yml compilan y publican dist/web en el gateway", () => {
  const dockerfile = fs.readFileSync(path.join(raiz, "Dockerfile"), "utf8");
  const compose = fs.readFileSync(path.join(raiz, "docker-compose.yml"), "utf8");

  assert.match(dockerfile, /COPY\s+.*vite\.config\.mts.*\.\//);
  assert.match(dockerfile, /COPY\s+web\s+\.\/web/);
  assert.match(dockerfile, /FROM\s+nginx:[^\s]+\s+AS\s+gateway/);
  assert.match(dockerfile, /COPY\s+--from=build\s+\/app\/dist\/web\s+\/usr\/share\/nginx\/html/);
  assert.match(compose, /nginx:[\s\S]*?target:\s*gateway/);
  assert.match(compose, /AUTH_DEMO_PASSWORD:\s+\$\{AUTH_DEMO_PASSWORD:-[^}]+\}/);
});
