import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrls = [],
    maxRequests = 100,
    headless = true,
    saveScreenshot = true,
    screenshotFullPage = true,
    viewportWidth = 1280,
    viewportHeight = 800,
} = input;

const startRequests = startUrls.map((s) => (typeof s === 'string' ? s : s.url));

const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: { headless },
        browserContextOptions: { viewport: { width: viewportWidth, height: viewportHeight } },
    },
    maxRequestsPerCrawl: maxRequests,
    requestHandler: async ({ page, request, enqueueLinks }) => {
        log.info(`Processing ${request.url}`);

        const pageTitle = await page.title();
        const html = await page.content();

        const meta = await page.evaluate(() => {
            const get = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
            return {
                ogTitle: get('meta[property="og:title"]') || document.title || null,
                ogDescription: get('meta[property="og:description"]') || get('meta[name="description"]') || null,
                ogImage: get('meta[property="og:image"]') || null,
            };
        });

        let screenshotKey = null;
        let screenshotUrl = null;
        if (saveScreenshot) {
            const store = await Actor.openKeyValueStore();
            const key = `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
            const buffer = await page.screenshot({ fullPage: screenshotFullPage });
            await store.setValue(key, buffer, { contentType: 'image/png' });
            const env = Actor.getEnv();
            screenshotKey = key;
            if (env?.defaultKeyValueStoreId) {
                screenshotUrl = `https://api.apify.com/v2/key-value-stores/${env.defaultKeyValueStoreId}/records/${encodeURIComponent(key)}`;
            }
        }

        const textSnippet = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500));

        await Dataset.pushData({
            url: request.url,
            title: pageTitle,
            htmlLength: html.length,
            preview: {
                textSnippet,
                ogTitle: meta.ogTitle,
                ogDescription: meta.ogDescription,
                ogImage: meta.ogImage,
                screenshotKey,
                screenshotUrl,
            },
        });

        await enqueueLinks();
    },
    failedRequestHandler: async ({ request }) => {
        log.error(`Request failed ${request.url}`);
    },
});

if (startRequests.length > 0) {
    await crawler.run(startRequests);
} else {
    log.warning('No start URLs provided. Exiting.');
}

await Actor.exit();
