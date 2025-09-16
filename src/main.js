import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) || {};
const { startUrls = [], maxRequests = 100, headless = true } = input;

const startRequests = startUrls.map((s) => (typeof s === 'string' ? s : s.url));

const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: { headless },
    },
    maxRequestsPerCrawl: maxRequests,
    requestHandler: async ({ page, request, enqueueLinks }) => {
        log.info(`Processing ${request.url}`);

        const pageTitle = await page.title();
        const html = await page.content();

        await Dataset.pushData({
            url: request.url,
            title: pageTitle,
            htmlLength: html.length,
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
