import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log } from 'crawlee';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ===== PPE EVENT FUNCTIONS =====
// (unchanged)
async function emitPageProcessed(url) { log.info(`Page processed: ${url}`); }
async function emitImageExtracted(imageUrl) { log.info(`Image extracted: ${imageUrl}`); }
async function emitVideoFound(videoUrl) { log.info(`Video found: ${videoUrl}`); }
async function emitScreenshotGenerated(screenshotType = 'fullpage') { log.info(`Screenshot generated: ${screenshotType}`); }
async function emitTextExtracted(textLength) { log.info(`Text extracted: ${textLength} characters`); }
async function emitLinkDiscovered(linkUrl, linkType = 'internal') { log.info(`Link discovered: ${linkUrl} (${linkType})`); }
async function emitMetadataHarvested(metadataKeys) { log.info(`Metadata harvested: ${metadataKeys.length} keys`); }
async function emitArticleDetected(articleTitle) { log.info(`Article detected: ${articleTitle}`); }
async function emitDuplicateFiltered(duplicatesCount) { log.info(`Duplicates filtered: ${duplicatesCount} duplicates`); }
async function emitContentValidated(contentType) { log.info(`Content validated: ${contentType}`); }
async function emitBatchCompleted(batchSize) { log.info(`Batch completed: ${batchSize} items`); }
async function emitSessionStarted() { log.info('Session started'); }
async function emitSessionCompleted(totalPages, totalImages, totalVideos) {
    log.info(`Session completed: ${totalPages} pages, ${totalImages} images, ${totalVideos} videos`);
}

await Actor.init();
await emitSessionStarted();

let input = {};
try {
    const actorInput = await Actor.getInput();
    if (actorInput && Object.keys(actorInput).length > 0) input = actorInput;
    else throw new Error('No input from Actor');
} catch {
    const fs = await import('fs');
    const inputFile = process.env.APIFY_INPUT_FILE || 'test_input.json';
    if (fs.existsSync(inputFile)) {
        const inputData = fs.readFileSync(inputFile, 'utf8');
        input = JSON.parse(inputData);
    }
}

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

let totalPagesProcessed = 0;
let totalImagesFound = 0;
let totalVideosFound = 0;

const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: { headless, args: [`--window-size=${viewportWidth},${viewportHeight}`] },
    },
    maxRequestsPerCrawl: maxRequests,
    requestHandler: async ({ page, request, enqueueLinks }) => {
        log.info(`Processing ${request.url}`);
        request.userData = { startTime: Date.now() };

        await emitPageProcessed(request.url);
        totalPagesProcessed++;

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
            await emitScreenshotGenerated(screenshotFullPage ? 'fullpage' : 'viewport');
        }

        const content = await page.evaluate(() => {
            const getTextContent = (selector) => {
                const elements = document.querySelectorAll(selector);
                return Array.from(elements).map(el => el.textContent?.trim()).filter(text => text.length > 0);
            };
            return {
                headings: getTextContent('h1, h2, h3, h4, h5, h6'),
                paragraphs: getTextContent('p'),
                articles: getTextContent('article, .article, .post, .content'),
                allText: document.body?.innerText?.replace(/\s+/g, ' ').trim() || ''
            };
        });

        for (const textBlock of content.paragraphs) {
            if (textBlock.length > 0) await emitTextExtracted(textBlock.length);
        }

        const images = await page.evaluate(() =>
            Array.from(document.querySelectorAll('img'))
                .map(img => img.src)
                .filter(src => src && !src.startsWith('data:'))
        );
        for (const image of images) {
            await emitImageExtracted(image);
            totalImagesFound++;
        }

        const videos = await page.evaluate(() =>
            Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]'))
                .map(video => video.src || video.getAttribute('src'))
                .filter(src => src)
        );
        for (const video of videos) {
            await emitVideoFound(video);
            totalVideosFound++;
        }

        const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
                .map(link => link.href)
                .filter(href => href && !href.startsWith('javascript:'))
        );
        for (const link of links) {
            const linkType = link.startsWith('http') && !link.includes(new URL(request.url).hostname) ? 'external' : 'internal';
            await emitLinkDiscovered(link, linkType);
        }

        const metaInfo = await page.evaluate(() => {
            const getMeta = (name) =>
                document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
                document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') || null;
            return {
                description: getMeta('description'),
                keywords: getMeta('keywords'),
                author: getMeta('author'),
                publishDate: getMeta('article:published_time') || getMeta('datePublished'),
                modifiedDate: getMeta('article:modified_time') || getMeta('dateModified')
            };
        });

        const allMetadata = { ...metaInfo, ...meta };
        const metadataKeys = Object.keys(allMetadata).filter(key => allMetadata[key] !== null);
        if (metadataKeys.length > 0) await emitMetadataHarvested(metadataKeys);

        const autoTag = [];
        if (content.articles.length > 0) {
            autoTag.push('article');
            await emitArticleDetected(content.articles[0] || 'Article detected');
        }
        if (images.length > 0) autoTag.push('images');
        if (videos.length > 0) autoTag.push('videos');
        if (content.headings.length > 0) autoTag.push('structured');

        await emitContentValidated('webpage');

        const textSnippet = content.allText.slice(0, 500);

        await Dataset.pushData({
            url: request.url,
            title: pageTitle,
            meta: { ...metaInfo, ...meta },
            articles: content.articles,
            images,
            videos,
            links,
            content: content.allText,
            exports: { screenshotKey, screenshotUrl },
            autoTag,
            contentType: 'webpage',
            scrapedAt: new Date().toISOString(),
            processingTimeMs: Date.now() - request.userData?.startTime || 0,
            preview: { textSnippet, ...meta, screenshotKey, screenshotUrl },
        });

        await emitBatchCompleted(1);
        await enqueueLinks();
    },
    failedRequestHandler: async ({ request }) => log.error(`Request failed ${request.url}`),
});

try {
    if (startRequests.length > 0) await crawler.run(startRequests);
    else log.warning('No start URLs provided. Exiting.');
} catch (error) {
    log.error('Crawler failed:', error);
} finally {
    await emitSessionCompleted(totalPagesProcessed, totalImagesFound, totalVideosFound);

    const { items } = await Dataset.getData();
    const scrapedData = items || [];

    const s3 = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        forcePathStyle: true,
        ssl: true,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });

    const runId = Actor.getEnv().actorRunId;
    const key = `results/${runId}/data-${Date.now()}.json`;

    await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: JSON.stringify(scrapedData, null, 2),
        ContentType: 'application/json',
    }));

    const presignedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
        { expiresIn: 24 * 3600 }
    );

    await Actor.setValue('client-info', {
        message: '✅ Scrape complete. Data stored securely in Cloudflare R2.',
        downloadUrl: presignedUrl,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
}

await Actor.exit();
