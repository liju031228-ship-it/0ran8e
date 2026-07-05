#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const LABEL = "com.daily-hotspot.wecom";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const args = new Set(process.argv.slice(2));

async function main() {
  if (args.has("--uninstall")) {
    await uninstall();
    return;
  }

  const pushTime = process.env.PUSH_TIME || readEnvValue("PUSH_TIME") || "08:30";
  const [hour, minute] = parsePushTime(pushTime);
  const nodePath = findNodePath();

  await fs.mkdir(path.dirname(PLIST_PATH), { recursive: true });
  await fs.mkdir(path.join(ROOT_DIR, "data"), { recursive: true });

  const plist = buildPlist({ nodePath, hour, minute });
  await fs.writeFile(PLIST_PATH, plist, "utf8");
  reloadLaunchAgent();

  console.log(`Installed daily WeCom push at ${pushTime}.`);
  console.log(`LaunchAgent: ${PLIST_PATH}`);
}

function buildPlist({ nodePath, hour, minute }) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "push-wecom.js");
  const stdoutPath = path.join(ROOT_DIR, "data", "push-launchd.out.log");
  const stderrPath = path.join(ROOT_DIR, "data", "push-launchd.err.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(ROOT_DIR)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(scriptPath)}</string>
    <string>--refresh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

async function uninstall() {
  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  } catch {
  }

  await fs.rm(PLIST_PATH, { force: true });
  console.log(`Uninstalled ${LABEL}.`);
}

function reloadLaunchAgent() {
  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  } catch {
  }
  execFileSync("launchctl", ["load", PLIST_PATH], { stdio: "inherit" });
}

function findNodePath() {
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/opt/homebrew/opt/node/bin/node",
    "/opt/homebrew/opt/node@24/bin/node",
    "/usr/local/opt/node/bin/node",
    "/usr/local/opt/node@24/bin/node",
    process.execPath
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
    }
  }

  return "/usr/bin/env node";
}

function parsePushTime(value) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("PUSH_TIME must be HH:mm, for example 08:30.");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("PUSH_TIME must be a valid HH:mm time.");
  }
  return [hour, minute];
}

function readEnvValue(key) {
  try {
    const raw = fsSync.readFileSync(path.join(ROOT_DIR, ".env"), "utf8");
    const line = raw.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
    if (!line) return "";
    return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
