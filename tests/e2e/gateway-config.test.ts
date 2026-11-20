import assert from "node:assert/strict";
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
  assert.match(nginx, /add_header\s+Content-Security-Policy\s+"[^"]*default-src\s+'self'[^"]*script-src\s+'self'[^"]*frame-ancestors\s+'none'[^"]*"\s+always;/);
  assert.match(nginx, /client_max_body_size\s+16k;/);
  assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=api_general:10m\s+rate=30r\/s;/);
  assert.match(nginx, /limit_req_zone\s+\$binary_remote_addr\s+zone=auth_tokens:10m\s+rate=10r\/s;/);
  assert.match(nginx, /limit_req_status\s+429;/);
  assert.match(nginx, /location\s+=\s+\/tiempo-real\s*\{[^}]*proxy_set_header\s+Upgrade\s+\$http_upgrade;/s);
  assert.match(nginx, /location\s+=\s+\/ws\s*\{[^}]*proxy_set_header\s+Upgrade\s+\$http_upgrade;/s);
  assert.match(nginx, /location\s+\^~\s+\/interno\/\s*\{[^}]*return\s+404/s);
  assert.match(nginx, /location\s+\^~\s+\/estimaciones\/\s*\{[^}]*return\s+404/s);
  assert.match(nginx, /location\s+\^~\s+\/auth\/\s*\{[^}]*proxy_pass\s+http:\/\/auth_emulator;/s);
});

test("OPS-004: Dockerfile y docker-compose.yml compilan y publican dist/web en el gateway", () => {
  const dockerfile = fs.readFileSync(path.join(raiz, "Dockerfile"), "utf8");
  const compose = fs.readFileSync(path.join(raiz, "docker-compose.yml"), "utf8");

  assert.match(dockerfile, /COPY\s+.*vite\.config\.mts.*\.\//);
  assert.match(dockerfile, /COPY\s+web\s+\.\/web/);
  assert.match(dockerfile, /FROM\s+nginx:[^\s]+\s+AS\s+gateway/);
  assert.match(dockerfile, /COPY\s+--from=build\s+\/app\/dist\/web\s+\/usr\/share\/nginx\/html/);
  assert.match(compose, /nginx:[\s\S]*?target:\s*gateway/);
});
