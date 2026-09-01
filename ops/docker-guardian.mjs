import http from "node:http";

const guardianVersion = "1.0.0";
const socketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const targetLabel = process.env.GUARDIAN_LABEL || "com.talentera.guardian";
const intervalMs = Math.max(15, Number(process.env.GUARDIAN_INTERVAL_SECONDS || 60)) * 1000;
const startPeriodMs = Math.max(0, Number(process.env.GUARDIAN_START_PERIOD_SECONDS || 300)) * 1000;
const restartTimeoutSeconds = Math.max(5, Number(process.env.GUARDIAN_RESTART_TIMEOUT_SECONDS || 15));
const maxRestartsPerHour = Math.max(1, Number(process.env.GUARDIAN_MAX_RESTARTS_PER_HOUR || 2));
const requestTimeoutMs = Math.max(3000, Number(process.env.GUARDIAN_REQUEST_TIMEOUT_MS || 10000));
const maxResponseBytes = 1024 * 1024;

let stopping = false;
let checking = false;
const restartHistory = new Map();

function log(level, event, details = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  })}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dockerRequest(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path,
        method,
        headers: {
          Accept: "application/json",
          Host: "localhost",
          Connection: "close",
        },
      },
      (response) => {
        const chunks = [];
        let bytes = 0;

        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxResponseBytes) {
            request.destroy(new Error("Docker API response exceeded 1 MiB"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: response.statusCode || 0, body });
        });
      },
    );

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error(`Docker API request timed out after ${requestTimeoutMs}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

function activeRestartHistory(containerKey, now) {
  const cutoff = now - 60 * 60 * 1000;
  const recent = (restartHistory.get(containerKey) || []).filter((time) => time >= cutoff);
  restartHistory.set(containerKey, recent);
  return recent;
}

async function findUnhealthyTargets() {
  const filters = encodeURIComponent(JSON.stringify({
    label: [`${targetLabel}=true`],
    health: ["unhealthy"],
  }));
  const response = await dockerRequest(`/containers/json?all=1&filters=${filters}`);

  if (response.statusCode !== 200) {
    throw new Error(`Docker API list failed with HTTP ${response.statusCode}: ${response.body.slice(0, 300)}`);
  }

  const containers = JSON.parse(response.body);
  return Array.isArray(containers) ? containers : [];
}

async function restartContainer(container) {
  const id = String(container.Id || "").trim();
  if (!id) return;

  const name = Array.isArray(container.Names) && container.Names[0]
    ? container.Names[0].replace(/^\//, "")
    : id.slice(0, 12);
  const now = Date.now();
  const history = activeRestartHistory(name, now);

  if (history.length >= maxRestartsPerHour) {
    log("error", "restart_rate_limited", {
      container: name,
      attemptsLastHour: history.length,
      maxRestartsPerHour,
    });
    return;
  }

  const response = await dockerRequest(
    `/containers/${encodeURIComponent(id)}/restart?t=${restartTimeoutSeconds}`,
    "POST",
  );

  if (response.statusCode !== 204) {
    throw new Error(
      `Docker API restart failed for ${name} with HTTP ${response.statusCode}: ${response.body.slice(0, 300)}`,
    );
  }

  history.push(now);
  restartHistory.set(name, history);
  log("warn", "container_restarted", {
    container: name,
    health: container.Status || "unhealthy",
    attemptsLastHour: history.length,
  });
}

async function runCheck() {
  if (checking || stopping) return;
  checking = true;

  try {
    const targets = await findUnhealthyTargets();
    if (targets.length === 0) {
      log("info", "check_ok", { unhealthyTargets: 0 });
      return;
    }

    log("warn", "unhealthy_targets_found", {
      containers: targets.map((container) =>
        Array.isArray(container.Names) && container.Names[0]
          ? container.Names[0].replace(/^\//, "")
          : String(container.Id || "").slice(0, 12),
      ),
    });

    for (const container of targets) {
      if (stopping) break;
      try {
        await restartContainer(container);
      } catch (error) {
        log("error", "restart_failed", {
          container: String(container.Id || "").slice(0, 12),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    log("error", "guardian_check_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    checking = false;
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log("info", "guardian_stopping", { signal });
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log("info", "guardian_started", {
  guardianVersion,
  targetLabel,
  intervalSeconds: intervalMs / 1000,
  startPeriodSeconds: startPeriodMs / 1000,
  maxRestartsPerHour,
});

if (startPeriodMs > 0) {
  await delay(startPeriodMs);
}

while (!stopping) {
  const startedAt = Date.now();
  await runCheck();
  const remaining = Math.max(1000, intervalMs - (Date.now() - startedAt));
  await delay(remaining);
}

log("info", "guardian_stopped");
