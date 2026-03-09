import { Actor } from 'apify';
import { log } from 'crawlee';
import { PlaywrightCrawler } from 'crawlee';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

await Actor.init();

// Get Actor input
const input = await Actor.getInput();
const { startUrls, maxRequests = 100, headless = true, saveScreenshot = true, screenshotFullPage = true, viewportWidth = 1280, viewportHeight = 800 } = input;

// Initialize scraped data array
const scrapedData = [];

// Create Playwright crawler
const crawler = new PlaywrightCrawler({
  launchContext: {
    launchOptions: {
      headless,
    },
  },
  maxRequestsPerCrawl: maxRequests,
  async requestHandler({ request, page }) {
    log.info(`Processing ${request.url}...`);
    
    // Set viewport
    await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
    
    // Extract page data
    const title = await page.title();
    const url = request.url;
    
    // Get images
    const images = await page.$$eval('img', imgs => 
      imgs.map(img => img.src).filter(src => src && src.startsWith('http'))
    );
    
    // Get videos
    const videos = await page.$$eval('video', vids => 
      vids.map(vid => vid.src).filter(src => src && src.startsWith('http'))
    );
    
    // Get links
    const links = await page.$$eval('a', anchors => 
      anchors.map(a => a.href).filter(href => href && href.startsWith('http'))
    );
    
    // Get text content
    const content = await page.$eval('body', body => body.innerText);
    
    // Get meta data
    const meta = await page.evaluate(() => {
      const metaTags = {};
      document.querySelectorAll('meta').forEach(tag => {
        const name = tag.getAttribute('name') || tag.getAttribute('property');
        const content = tag.getAttribute('content');
        if (name && content) metaTags[name] = content;
      });
      return metaTags;
    });
    
    // Take screenshot if enabled
    let screenshotUrl = null;
    if (saveScreenshot) {
      const screenshotBuffer = await page.screenshot({ 
        fullPage: screenshotFullPage 
      });
      // Store screenshot in Actor's key-value store
      const screenshotKey = `screenshot-${Date.now()}.png`;
      await Actor.setValue(screenshotKey, screenshotBuffer, { contentType: 'image/png' });
      screenshotUrl = `https://api.apify.com/v2/key-value-stores/${Actor.getEnv().defaultKeyValueStoreId}/records/${screenshotKey}`;
    }
    
    // Compile scraped data
    const pageData = {
      url,
      title,
      meta,
      images,
      videos,
      links,
      content,
      exports: {
        screenshotUrl
      },
      contentType: 'webpage',
      scrapedAt: new Date().toISOString(),
      processingTimeMs: Date.now() - request.handledAt
    };
    
    scrapedData.push(pageData);
  },
});

// Run the crawler
await crawler.run(startUrls);

// R2 upload configuration
const nowMillis = Date.now();
const now = new Date();
const pathName = `results/${Actor.getEnv().actorRunId || `local-${nowMillis}`}`;
const fileName = `data-${nowMillis}.json`;
const r2Path = `${pathName}/${fileName}`;

// S3 client setup
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

// Upload to R2 with error handling
try {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: r2Path,
    Body: JSON.stringify(scrapedData, null, 2),
    ContentType: 'application/json',
  }));

  log.info(`✅ Data uploaded to R2: ${r2Path}`);

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: r2Path }),
    { expiresIn: 24 * 3600 }
  );

  const outputPayload = {
    message: 'Upload completed',
    r2Path,
    uploadedAt: now.toISOString(),
    downloadUrl: presignedUrl,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    itemCount: scrapedData.length,
  };

  await Actor.setValue('OUTPUT', outputPayload);
  await Actor.setValue('client-info', outputPayload);
  await Actor.pushData({
    uploadPath: r2Path,
    timestamp: Date.now(),
    status: 'uploaded',
  });

} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log.error(`❌ R2 upload failed: ${errorMessage}`);

  const failPayload = {
    message: 'Upload failed',
    r2Path,
    uploadedAt: new Date().toISOString(),
    error: errorMessage,
  };

  await Actor.setValue('OUTPUT', failPayload);
  await Actor.setValue('client-info', failPayload);
  await Actor.pushData({
    uploadPath: r2Path,
    timestamp: Date.now(),
    status: 'upload_failed',
    error: errorMessage,
  });

  throw error; // remove this line if you want run to finish "successfully" even on upload failure
}

await Actor.exit();
