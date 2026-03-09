set -euo pipefail
cd "/Users/enclavesec/GimmieDatShyt"
mkdir -p storages .actor

# 1) Clean manifest
cat > .actor/actor.json <<'JSON'
{
  "actorSpecification": 1,
  "name": "jean-grey-multi-scraper",
  "title": "GimmieDatShyt",
  "version": "1.0.4",
  "input": "./INPUT_SCHEMA.json",
  "dockerfile": "./Dockerfile"
}
JSON

# 2) Dataset view
cat > storages/dataset.json <<'JSON'
{
  "actorSpecification": 1,
  "name": "jean-grey-multi-scraper",
  "title": "GimmieDatShyt",
  "version": "1.0.4",
  "storages": {
    "dataset": {
      "actorSpecification": 1,
      "views": {
        "overview": {
          "title": "Overview",
          "transformation": {
            "fields": [
              "url","title","meta","articles","images","videos",
              "links","exports","autoTag","contentType","scrapedAt","processingTimeMs"
            ]
          },
          "display": {
            "component": "table",
            "properties": {
              "url":        { "label": "🌐 URL", "format": "link" },
              "title":      { "label": "📰 Title", "format": "text" },
              "meta":       { "label": "🧠 Meta", "format": "object" },
              "articles":   { "label": "📄 Articles", "format": "array" },
              "images":     { "label": "🖼️ Images", "format": "array" },
              "videos":     { "label": "🎥 Videos", "format": "array" },
              "links":      { "label": "🔗 Links", "format": "array" },
              "exports":    { "label": "📤 Exports", "format": "object" },
              "autoTag":    { "label": "🏷️ Tags", "format": "array" },
              "contentType":{ "label": "📂 Type", "format": "text" },
              "scrapedAt":  { "label": "⏱️ Scraped At", "format": "date" },
              "processingTimeMs": { "label": "⚙️ ms", "format": "number" }
            }
          }
        }
      }
    }
  }
}
JSON

# 3) Patch JS (KV screenshot URLs) in web_scraper.js if present
if [ -f web_scraper.js ]; then
  node - <<'NODE'
const fs=require('fs');
let s=fs.readFileSync('web_scraper.js','utf8');
s=s.replace(
/const buf = await page\.screenshot\([^)]*\)\.catch\(\(\)\s*=>\s*null\);\s*/s,
`const buf = await page.screenshot({ fullPage: screenshotFullPage, type: 'png' }).catch(() => null);
if (buf) {
  const key = \`shot_\${Date.now()}.png\`;
  await Actor.setValue(key, buf, { contentType: 'image/png' });
  const storeId = Actor.getEnv().defaultKeyValueStoreId;
  const url = \`https://api.apify.com/v2/key-value-stores/\${storeId}/records/\${key}\`;
  data.images.push(url);
}
`
);
fs.writeFileSync('web_scraper.js', s);
NODE
fi

# 4) Normalize Instagram output if file exists
if [ -f instagram_playwright.js ]; then
  node - <<'NODE'
const fs=require('fs');
let s=fs.readFileSync('instagram_playwright.js','utf8');
s=s.replace(/videos:\s*item\.media_type === 'VIDEO'[^,]+,/,
            "videos: item.media_type === 'VIDEO' ? [item.media_url] : [],");
s=s.replace(/autoTag:\s*\{[^}]*\}/, "autoTag: ['media']");
fs.writeFileSync('instagram_playwright.js', s);
NODE
fi

# 5) Validate JSON
jq -e . .actor/actor.json >/dev/null
jq -e . storages/dataset.json >/dev/null

echo "OK"