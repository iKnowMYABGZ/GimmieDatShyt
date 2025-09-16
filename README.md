# 📄 Simple Web Content Scraper
# GimmieDatShyt
A new Apify scraper based on the crawlee platform
GimmieDatShyt Scraper

Apify actor using Playwright + Crawlee. Configure input in `input_schema.json` and run locally with Node or on Apify.

Quick start:

```bash
npm ci
npm start
```

Input example:

```json
{
  "startUrls": [{"url": "https://example.com"}],
  "maxRequests": 50,
  "headless": true
}
```
This actor crawls blogs, news sites, and websites and extracts **valuable content** including:

- ✅ Page Title
- 🧠 Meta Description, Keywords, Publish Date
- ✍️ All readable content (`<p>`, `<h1>–<h3>`)
- 🖼️ Image URLs
- 📤 Exports in CSV or JSON format (via Apify)

## 💡 Use Cases

- Fine-tune ChatGPT or GPT-4 with your own web data
- Build a blog summarizer, translator, or SEO tool
- Extract content from competitors or client sites
- Collect articles and visuals for newsletters

---

## 🧪 Input Options

| Field | Description |
|-------|-------------|
| `startUrls` | Website/blog URLs to crawl |
| `maxRequestsPerCrawl` | Limit number of pages (default: 50) |
| `maxConcurrency` | Controls speed/load (default: 5) |

---

## 🧾 Output

Each item includes:
```json
{
  "url": "https://example.com/article",
  "title": "Example Article",
  "meta": {
    "description": "...",
    "keywords": "...",
    "publishDate": "2024-01-01"
  },
  "content": "Full article text here...",
  "images": [
    "https://example.com/img.jpg"
  ]
}
```
