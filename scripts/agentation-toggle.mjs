import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] ?? "toggle"; // on | off | toggle
const projectRoot = process.cwd();
const cursorDir = path.join(projectRoot, ".cursor");
const mcpPath = path.join(cursorDir, "mcp.json");

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readMcpConfig() {
  if (!exists(mcpPath)) return { mcpServers: {} };
  const raw = fs.readFileSync(mcpPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return { mcpServers: {} };
  return parsed.mcpServers
    ? { mcpServers: parsed.mcpServers }
    : { mcpServers: parsed.mcpServers ?? {} };
}

function writeMcpConfig(config) {
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), "utf-8");
}

function getAgentationServerConfig() {
  // agentation-mcp가 로컬에 설치되어 있으면 커맨드를 직접 사용하고,
  // 아니면 npx로 실행합니다.
  const binBase = path.join(projectRoot, "node_modules", ".bin");
  const binCandidates = [
    path.join(binBase, "agentation-mcp"),
    path.join(binBase, "agentation-mcp.cmd"),
    path.join(binBase, "agentation-mcp.exe"),
  ];
  const localBin = binCandidates.find((p) => exists(p));

  if (localBin) {
    return {
      command: "agentation-mcp",
      args: ["server"],
    };
  }

  return {
    command: "npx",
    args: ["-y", "agentation-mcp", "server"],
  };
}

const config = readMcpConfig();
const enabled = Boolean(config?.mcpServers?.agentation);

let nextEnabled = enabled;
if (mode === "status") {
  console.log(
    `[agentation MCP] ${enabled ? "ENABLED" : "DISABLED"} -> ${mcpPath}`
  );
  console.log("Cursor를 새로고침/재시작해서 적용을 확인하세요.");
  process.exit(0);
}
if (mode === "on") nextEnabled = true;
if (mode === "off") nextEnabled = false;
if (mode === "toggle") nextEnabled = !enabled;

if (nextEnabled) {
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers.agentation = getAgentationServerConfig();
} else {
  config.mcpServers = config.mcpServers ?? {};
  delete config.mcpServers.agentation;
}

writeMcpConfig(config);

console.log(
  `[agentation MCP] ${nextEnabled ? "ENABLED" : "DISABLED"} -> ${mcpPath}`
);
console.log("Cursor를 새로고침/재시작해서 적용을 확인하세요.");

