const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URLS = [
  {
    name: 'cleartrip',
    url: 'https://www.cleartrip.com/flight-schedule/mumbai-new-delhi-flights.html',
  },
  {
    name: 'makemytrip',
    url: 'https://www.makemytrip.com/flights/mumbai-new_delhi-cheap-airtickets.html',
  },
  {
    name: 'goibibo',
    url: 'https://www.goibibo.com/flights/mumbai-to-delhi-flights/',
  },
  {
    name: 'skyscanner',
    url: 'https://www.skyscanner.co.in/routes/bom/del/mumbai-to-delhi-indira-gandhi-international.html',
  },
  {
    name: 'ixigo',
    url: 'https://www.ixigo.com/cheap-flights/mumbai-new-delhi-bom-del',
  },
  {
    name: 'easemytrip',
    url: 'https://www.easemytrip.com/flights/mumbai-bom-to-delhi-del/',
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

  // Mask headless signals
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Use 'load' instead of 'networkidle' — less strict, works on more sites
    await page.goto(site.url, { waitUntil: 'load', timeout: 60000 });

    // Wait for h1 to appear (up to 10s), then grab content
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const html = await page.content();
    const seo = await extractSEO(page);

    const result = {
      name: site.name,
      url: site.url,
      scrapedAt: new Date().toISOString(),
      seo,
    };

    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.html`), html, 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.json`), JSON.stringify(result, null, 2), 'utf8');

    console.log(`  ✓ Title: ${seo.title}`);
    console.log(`  ✓ H1: ${JSON.stringify(seo.h1)}`);
    console.log(`  ✓ Meta desc: ${seo.metaDescription?.substring(0, 80)}...`);
    console.log(`  ✓ Saved → scraped-data/${site.name}.html + .json`);

    return result;
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    // Save whatever partial HTML we got
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.html`), html, 'utf8');
      console.log(`  ~ Saved partial HTML for ${site.name}`);
    } catch (_) {}
    return { name: site.name, url: site.url, error: err.message };
  } finally {
    await context.close();
  }
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const browser = await chromium.launch({
    headless: false,  // visible browser — harder for sites to detect
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized',
    ],
  });

  const results = [];
  for (const site of URLS) {
    const result = await scrape(site, browser);
    results.push(result);
    // Random delay between sites to mimic human behaviour
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  }

  await browser.close();

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );

  console.log('\n✅ Done! All data saved to scraped-data/');
  console.log('   Push scraped-data/ to the repo so Claude can generate the SEO report.');
})();
