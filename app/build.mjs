// Bundles the app into dist/index.html (one self-contained file: works offline, from a
// static host, or opened as an artifact) plus a web manifest so it installs to the home
// screen. `node build.mjs --serve` rebuilds on change and serves on http://localhost:8080.

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { watch } from "node:fs";

const serve = process.argv.includes("--serve");

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#11161a"/><path d="M14 30h68" stroke="#ff8a3d" stroke-width="5" stroke-linecap="round"/><path d="M48 30v10" stroke="#eef2ef" stroke-width="4"/><ellipse cx="42" cy="52" rx="20" ry="12" fill="#eef2ef"/><path d="M60 52h22l4-8" stroke="#eef2ef" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M28 70h30M34 64v6M50 64v6" stroke="#eef2ef" stroke-width="3" stroke-linecap="round"/></svg>`;

const manifest = {
  name: "Hover Trainer",
  short_name: "Hover Trainer",
  description: "RC helicopter hover trainer for your phone and transmitter.",
  start_url: "./",
  display: "fullscreen",
  orientation: "landscape",
  background_color: "#11161a",
  theme_color: "#11161a",
  icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
};

async function build() {
  const res = await esbuild.build({
    entryPoints: ["src/main.js"],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2022",
    write: false,
    legalComments: "none",
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = readFileSync("index.html", "utf8")
    .replace("<!--MANIFEST-->", `<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg">`)
    .replace("<!--APP-->", () => `<script>${js}</script>`);
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/index.html", html);
  // artifact.html: the same page without the document skeleton, for hosts that add their own
  const fragment = html
    .replace(/<!doctype html>\s*<html[^>]*>\s*<head>/i, "")
    .replace(/<\/head>\s*<body>/i, "")
    .replace(/<\/body>\s*<\/html>\s*$/i, "")
    .replace(/<meta charset="utf-8">\s*/i, "")
    .replace(/<link rel="manifest"[^>]*><link rel="icon"[^>]*>/, "");
  writeFileSync("dist/artifact.html", fragment.trimStart());
  writeFileSync("dist/manifest.webmanifest", JSON.stringify(manifest, null, 2));
  writeFileSync("dist/icon.svg", icon);
  console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
}

await build();

if (serve) {
  let t;
  watch("src", { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch((e) => console.error(e.message)), 100); });
  watch("index.html", () => { clearTimeout(t); t = setTimeout(() => build().catch((e) => console.error(e.message)), 100); });
  const types = { html: "text/html", webmanifest: "application/manifest+json", svg: "image/svg+xml" };
  createServer((req, res) => {
    const path = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
    try {
      const body = readFileSync(`dist/${path}`);
      res.writeHead(200, { "content-type": types[path.split(".").pop()] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  }).listen(8080, () => console.log("serving http://localhost:8080"));
}
