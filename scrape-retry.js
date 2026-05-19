const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URLS = [
  {
    name: 'cleartrip',
    url: 'https://www.cleartrip.com/flight-schedule/mumbai-new-delhi-flights.html',
    waitFor: 'domcontentloaded', // less strict than 'load'
  },
  {
    name: 'makemytrip',
    url: 'https://www.makemytrip.com/flights/mumbai-new_delhi-cheap-airtickets.html',
    waitFor: 'domcontentloaded',
  },
];

const OUTPUT_DIR = path.join(__dirname, 'scraped-data');

async function extractSEO(page) {
  return await page.evaluate(() => {
    const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr)?.trim() || null;
    const getAllText = (sel) => Array.from(document.querySelectorAll(sel)).map(el => el.innerText?.trim()).filter(Boolean);

    return {
      title: document.title || null,
      h1: getAllText('h1'),
      h2: getAllText('h2'),
      h3: getAllText('h3'),
      metaDescription: getAttr('meta[name="description"]', 'content'),
      metaKeywords: getAttr('meta[name="keywords"]', 'content'),
      canonical: getAttr('link[rel="canonical"]', 'href'),
      ogTitle: getAttr('meta[property="og:title"]', 'content'),
      ogDescription: getAttr('meta[property="og:description"]', 'content'),
      ogImage: getAttr('meta[property="og:image"]', 'content'),
      robots: getAttr('meta[name="robots"]', 'content'),
      lang: document.documentElement.getAttribute('lang'),
      structuredData: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(el => { try { return JSON.parse(el.innerText); } catch { return null; } })
        .filter(Boolean),
      internalLinks: Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.startsWith('/') || h.startsWith(window.location.origin)))
        .slice(0, 50),
      imgAltMissing: Array.from(document.querySelectorAll('img'))
        .filter(img => !img.getAttribute('alt')).length,
      totalImages: document.querySelectorAll('img').length,
      wordCount: document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0,
    };
  });
}

async function scrape(site, browser) {
  console.log(`\n→ Scraping: ${site.name} (${site.url})`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    await page.goto(site.url, { waitUntil: site.waitFor, timeout: 90000 });

    // Simulate human: scroll down slowly
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let y = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 200);
          y += 200;
          if (y >= 1200) { clearInterval(timer); resolve(); }
        }, 200);
      });
    });

    // Wait for h1 to appear
    await page.waitForSelector('h1', { timeout: 15000 }).catch(() => console.log('  ~ No H1 found within 15s, continuing...'));
    await page.waitForTimeout(3000);

    const html = await page.content();
    const seo = await extractSEO(page);

    const result = { name: site.name, url: site.url, scrapedAt: new Date().toISOString(), seo };

    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.html`), html, 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.json`), JSON.stringify(result, null, 2), 'utf8');

    console.log(`  ✓ Title: ${seo.title}`);
    console.log(`  ✓ H1: ${JSON.stringify(seo.h1)}`);
    console.log(`  ✓ Meta desc: ${seo.metaDescription?.substring(0, 80)}...`);
    console.log(`  ✓ Saved → scraped-data/${site.name}.html + .json`);

    return result;
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.html`), html, 'utf8');
      console.log(`  ~ Saved partial HTML anyway`);
    } catch (_) {}
    return { name: site.name, url: site.url, error: err.message };
  } finally {
    await context.close();
  }
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-http2',                          // fixes MMT ERR_HTTP2_PROTOCOL_ERROR
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized',
    ],
  });

  const results = [];
  for (const site of URLS) {
    const result = await scrape(site, browser);
    results.push(result);
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
  }

  await browser.close();

  // Merge with existing summary
  const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
  let existing = [];
  if (fs.existsSync(summaryPath)) {
    existing = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  }
  for (const r of results) {
    const idx = existing.findIndex(e => e.name === r.name);
    if (idx >= 0) existing[idx] = r;
    else existing.push(r);
  }
  fs.writeFileSync(summaryPath, JSON.stringify(existing, null, 2), 'utf8');

  console.log('\n✅ Done! summary.json updated.');
})();
