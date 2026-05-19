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
    const getText = (sel) => document.querySelector(sel)?.innerText?.trim() || null;
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
        .filter(img => !img.getAttribute('alt'))
        .length,
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
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(site.url, { waitUntil: 'networkidle', timeout: 60000 });
    // Extra wait for JS-heavy pages
    await page.waitForTimeout(3000);

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
    console.log(`  ✓ Saved to scraped-data/${site.name}.html + .json`);

    return result;
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    return { name: site.name, url: site.url, error: err.message };
  } finally {
    await context.close();
  }
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  for (const site of URLS) {
    const result = await scrape(site, browser);
    results.push(result);
  }

  await browser.close();

  // Save combined summary
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );

  console.log('\n✅ Done! All data saved to scraped-data/');
  console.log('   Next: share scraped-data/*.json with Claude to generate the SEO report.');
})();
