process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_32_characters_long_min_reconai";
process.env.MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_introspect";
import fs from "fs";

const { default: app } = await import("../src/app.js");

function getPathFromRegex(regexp) {
  if (!regexp) return "";
  const str = regexp.source;
  if (str === "^\\/?$" || str === "^\\/?(?=\\/|$)") return "";
  let match = str
    .replace("^\\", "")
    .replace("\\/?(?=\\/|$)", "")
    .replace("(?=\\/|$)", "")
    .replace(/\\\//g, "/")
    .replace(/\^/g, "")
    .replace(/\$/g, "")
    .replace(/\?(?=\/|$)/g, "")
    .replace(/\/?\(\?=\\\/\|\$\)/g, "")
    .replace(/\\\+/g, "+")
    .replace(/\\\./g, ".");
  return match.startsWith("/") ? match : "/" + match;
}

const routes = [];

function walkRouter(router, basePath = "", inheritedMiddlewares = []) {
  if (!router || !router.stack) return;

  // First pass: collect router-level middlewares mounted with router.use(mw) where !layer.route and layer.name !== "router"
  const routerLevelMiddlewares = [...inheritedMiddlewares];
  
  for (const layer of router.stack) {
    if (!layer.route && layer.handle && layer.name !== "router") {
      const mwName = layer.handle.name || layer.name;
      if (mwName && mwName !== "anonymous" && mwName !== "<anonymous>" && mwName !== "router") {
        routerLevelMiddlewares.push(mwName);
      }
    }
  }

  for (const layer of router.stack) {
    if (layer.route) {
      const subPath = layer.route.path === "/" ? "" : layer.route.path;
      const fullPath = (basePath + subPath) || "/";
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      const routeMiddlewares = layer.route.stack
        .map(s => s.handle?.name || s.name)
        .filter(n => n && n !== "anonymous" && n !== "<anonymous>");

      const allMiddlewares = [...routerLevelMiddlewares, ...routeMiddlewares];
      // deduplicate preserving order
      const uniqueMiddlewares = Array.from(new Set(allMiddlewares));

      for (const method of methods) {
        routes.push({
          method,
          path: fullPath,
          middlewares: uniqueMiddlewares
        });
      }
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const mountPath = getPathFromRegex(layer.regexp);
      const combinedPath = (basePath === "/" ? "" : basePath) + (mountPath === "/" ? "" : mountPath);
      
      // Check if this layer has middleware attached before it in the parent router stack at the same mount
      walkRouter(layer.handle, combinedPath, routerLevelMiddlewares);
    }
  }
}

// In app._router.stack, handle prefix-bound routers and middlewares
// Note: app.use("/api/reconciliation", auth, roles, tenant, router) adds multiple layers for "/api/reconciliation"
const prefixMiddlewares = new Map();

for (const layer of app._router.stack) {
  if (!layer.route && layer.regexp) {
    const p = getPathFromRegex(layer.regexp);
    if (p && layer.name !== "router") {
      const mwName = layer.handle?.name || layer.name;
      if (mwName && mwName !== "anonymous" && mwName !== "<anonymous>") {
        if (!prefixMiddlewares.has(p)) prefixMiddlewares.set(p, []);
        prefixMiddlewares.get(p).push(mwName);
      }
    }
  }
}

// Now do the full walk passing prefix middlewares
function walkApp() {
  for (const layer of app._router.stack) {
    if (layer.route) {
      const fullPath = layer.route.path;
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      const mws = layer.route.stack.map(s => s.handle?.name || s.name).filter(Boolean);
      for (const method of methods) {
        routes.push({ method, path: fullPath, middlewares: mws });
      }
    } else if (layer.name === "router" && layer.handle && layer.handle.stack) {
      const mountPath = getPathFromRegex(layer.regexp);
      const inherited = prefixMiddlewares.get(mountPath) || [];
      walkRouter(layer.handle, mountPath, inherited);
    }
  }
}

walkApp();

// Sort routes by path, then method
routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// Format output
const lines = [];
lines.push("=== RECONAI 2.0: INTROSPECTED ROUTE INVENTORY ===");
lines.push(`Total Endpoints: ${routes.length}`);
lines.push("");
lines.push("METHOD | FULL PATH | MIDDLEWARES");
lines.push("-".repeat(95));

const unauthenticatedRoutes = [];

routes.forEach(r => {
  const isAuth = r.middlewares.some(m => m.toLowerCase().includes("auth"));
  const flag = isAuth ? "" : " [UNAUTHENTICATED]";
  if (!isAuth) unauthenticatedRoutes.push(r);
  lines.push(`${r.method.padEnd(6)} | ${r.path.padEnd(55)} | ${r.middlewares.join(", ") || "(none)"}${flag}`);
});

lines.push("");
lines.push("=== UNAUTHENTICATED ROUTES & JUSTIFICATIONS ===");
unauthenticatedRoutes.forEach(u => {
  let justification = "UNKNOWN";
  if (u.path === "/") justification = "Public root status probe for browser visitors on port 5000";
  else if (u.path === "/api/health") justification = "Public liveness/readiness probe for deployment orchestrators";
  else if (u.path === "/api/auth/login") justification = "Public authentication endpoint; accepts credentials to issue JWT token";
  else if (u.path === "/api/auth/service-token") justification = "Public machine service authentication endpoint to exchange service credentials for JWT";
  else if (u.path === "/api/webhooks/razorpay") justification = "Payment gateway ingress; cryptographically verified via HMAC SHA-256 signature, not user JWT";
  else if (u.path.startsWith("/api/policy-config")) justification = "Governed inside route handler via explicit RBAC middleware or 405 method guards";
  lines.push(`- ${u.method} ${u.path}: ${justification}`);
});

const outputText = lines.join("\n");
console.log(outputText);

fs.writeFileSync("evidence/stage6/05-route-inventory.txt", outputText, "utf8");
console.log("\nSaved to evidence/stage6/05-route-inventory.txt");
