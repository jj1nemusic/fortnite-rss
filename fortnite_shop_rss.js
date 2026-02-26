#!/usr/bin/env node
/**
 * Fortnite Item Shop RSS Feed Generator
 *
 * Fetches the current Fortnite item shop from fortnite-api.com
 * and generates a valid RSS 2.0 XML feed.
 *
 * Usage:
 *   node fortnite_shop_rss.js                  # prints RSS XML to stdout
 *   node fortnite_shop_rss.js -o feed.xml      # writes to file
 *   node fortnite_shop_rss.js --serve 8080     # runs a tiny HTTP server on port 8080
 */

const https = require("https");
const http = require("http");
const fs = require("fs");

const API_URL = "https://fortnite-api.com/v2/shop";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fetchShop() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      API_URL,
      { headers: { "User-Agent": "FortniteShopRSS/1.0" } },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`API returned HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function itemNames(entry) {
  const names = [];
  for (const item of entry.brItems || []) {
    if (item.name) names.push(item.name);
  }
  for (const track of entry.tracks || []) {
    names.push(track.title || "Unknown Track");
  }
  return names;
}

function firstImage(entry) {
  const nda = entry.newDisplayAsset || {};
  for (const ri of nda.renderImages || []) {
    if (ri.image) return ri.image;
  }
  for (const item of entry.brItems || []) {
    const imgs = item.images || {};
    for (const key of ["featured", "icon", "smallIcon"]) {
      if (imgs[key]) return imgs[key];
    }
  }
  const bundle = entry.bundle || {};
  if (bundle.image) return bundle.image;
  return null;
}

function itemType(entry) {
  if (entry.bundle) return "Bundle";
  if (entry.tracks && entry.tracks.length) return "Jam Track";
  for (const item of entry.brItems || []) {
    const t = (item.type || {}).displayValue;
    if (t) return t;
  }
  return "Item";
}

function itemRarity(entry) {
  for (const item of entry.brItems || []) {
    const r = (item.rarity || {}).displayValue;
    if (r) return r;
  }
  return null;
}

function priceText(entry) {
  const regular = entry.regularPrice || 0;
  const final_ = entry.finalPrice || 0;
  const fmt = (n) => n.toLocaleString("en-US");
  if (regular !== final_ && regular > 0) {
    return `${fmt(final_)} V-Bucks (was ${fmt(regular)})`;
  }
  return `${fmt(final_)} V-Bucks`;
}

function layoutCategory(entry) {
  const layout = entry.layout || {};
  return layout.name || layout.category || null;
}

function rfc2822(date) {
  return date.toUTCString();
}

// ─── RSS Builder ───────────────────────────────────────────────────────────────

function buildRss(shopData) {
  const data = shopData.data || {};
  const shopDateStr = data.date || "";
  let shopDate;
  try {
    shopDate = new Date(shopDateStr);
    if (isNaN(shopDate)) throw new Error();
  } catch {
    shopDate = new Date();
  }

  const entries = data.entries || [];
  const lines = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
  lines.push("  <channel>");
  lines.push(`    <title>Fortnite Item Shop</title>`);
  lines.push(`    <link>https://fortnite-api.com</link>`);
  lines.push(
    `    <description>${escapeXml(
      `Fortnite Battle Royale Item Shop — ${shopDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`
    )}</description>`
  );
  lines.push(`    <language>en-us</language>`);
  lines.push(`    <lastBuildDate>${rfc2822(shopDate)}</lastBuildDate>`);
  lines.push(`    <generator>FortniteShopRSS/1.0</generator>`);

  const vbuckIcon =
    data.vbuckIcon || "https://fortnite-api.com/images/vbuck.png";
  lines.push(`    <image>`);
  lines.push(`      <url>${escapeXml(vbuckIcon)}</url>`);
  lines.push(`      <title>Fortnite Item Shop</title>`);
  lines.push(`      <link>https://fortnite-api.com</link>`);
  lines.push(`    </image>`);

  const seenOffers = new Set();

  for (const entry of entries) {
    const offerId = entry.offerId || "";
    if (seenOffers.has(offerId)) continue;
    seenOffers.add(offerId);

    const names = itemNames(entry);
    if (!names.length) continue;

    const titleText = names.join(", ");
    const type = itemType(entry);
    const rarity = itemRarity(entry);
    const price = priceText(entry);
    const category = layoutCategory(entry);
    const imageUrl = firstImage(entry);
    const inDate = entry.inDate || shopDateStr;
    const outDate = entry.outDate || "";

    // Build HTML description
    const desc = [];
    desc.push(`<strong>${escapeXml(type)}</strong>`);
    if (rarity) desc.push(` — ${escapeXml(rarity)}`);
    desc.push(`<br/>Price: ${escapeXml(price)}`);
    if (category) desc.push(`<br/>Section: ${escapeXml(category)}`);

    if (outDate) {
      try {
        const outDt = new Date(outDate);
        if (!isNaN(outDt)) {
          desc.push(
            `<br/>Leaves shop: ${outDt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}`
          );
        }
      } catch {}
    }

    const banner = entry.banner || {};
    if (banner.value) desc.push(`<br/>🏷️ ${escapeXml(banner.value)}`);

    for (const bi of entry.brItems || []) {
      if (bi.description) {
        desc.push(
          `<br/><em>${escapeXml(bi.name)}</em>: ${escapeXml(bi.description)}`
        );
      }
    }
    for (const track of entry.tracks || []) {
      desc.push(
        `<br/>🎵 <em>${escapeXml(track.title || "")}</em> by ${escapeXml(
          track.artist || ""
        )}`
      );
    }

    if (imageUrl) {
      desc.push(`<br/><img src="${escapeXml(imageUrl)}" width="256" />`);
    }

    const descriptionHtml = desc.join("");

    lines.push(`    <item>`);
    lines.push(
      `      <title>${escapeXml(titleText)} — ${escapeXml(price)}</title>`
    );
    lines.push(`      <description>${escapeXml(descriptionHtml)}</description>`);
    lines.push(
      `      <guid isPermaLink="false">${escapeXml(offerId)}</guid>`
    );

    try {
      const pubDate = new Date(inDate);
      if (!isNaN(pubDate)) {
        lines.push(`      <pubDate>${rfc2822(pubDate)}</pubDate>`);
      }
    } catch {}

    if (category) {
      lines.push(`      <category>${escapeXml(category)}</category>`);
    }

    if (imageUrl) {
      lines.push(
        `      <enclosure url="${escapeXml(imageUrl)}" type="image/png" length="0" />`
      );
    }

    lines.push(`    </item>`);
  }

  lines.push("  </channel>");
  lines.push("</rss>");
  lines.push("");

  return lines.join("\n");
}

// ─── HTTP Server ───────────────────────────────────────────────────────────────

function startServer(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const shop = await fetchShop();
      const xml = buildRss(shop);
      const buf = Buffer.from(xml, "utf-8");
      res.writeHead(200, {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Content-Length": buf.length,
      });
      res.end(buf);
    } catch (err) {
      const msg = String(err);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(msg);
    }
  });
  server.listen(port, () => {
    console.log(`Serving Fortnite Shop RSS at http://localhost:${port}/`);
  });
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let outputFile = null;
  let servePort = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output") {
      outputFile = args[++i];
    } else if (args[i] === "--serve") {
      servePort = parseInt(args[++i], 10);
    } else if (args[i] === "-h" || args[i] === "--help") {
      console.log(
        `Usage:
  node fortnite_shop_rss.js                  # print RSS XML to stdout
  node fortnite_shop_rss.js -o feed.xml      # write to file
  node fortnite_shop_rss.js --serve 8080     # HTTP server on port 8080`
      );
      process.exit(0);
    }
  }

  if (servePort) {
    startServer(servePort);
    return;
  }

  const shop = await fetchShop();
  const xml = buildRss(shop);

  if (outputFile) {
    fs.writeFileSync(outputFile, xml, "utf-8");
    process.stderr.write(`Wrote RSS feed to ${outputFile}\n`);
  } else {
    process.stdout.write(xml);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
