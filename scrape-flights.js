const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URLS = [
  {
    name: 'goibibo-delhi-shimla',
    url: 'https://www.goibibo.com/flights/delhi-to-shimla-flights/',
  },
  {
    name: 'goibibo-delhi-darjeeling',
    url: 'https://www.goibibo.com/flights/delhi-to-darjeeling-flights/',
  },
  {
    name: 'goibibo-pune-jalgaon',
    url: 'https://www.goibibo.com/flights/pune-to-jalgaon-flights/',
  },
  {
    name: 'goibibo-pune-nanded',
    url: 'https://www.goibibo.com/flights/pune-to-nanded-flights/',
  },
];

const OUTPUT_DIR = path.join(__dirname, 'scraped-data', 'flight-listings');

async function scrape(site, browser) {
  console.log(`\n→ Scraping: ${site.name}`);
  console.log(`  URL: ${site.url}`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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
    await page.goto(site.url, { waitUntil: 'load', timeout: 60000 });

    // Simulate scroll to trigger lazy-loaded content
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let y = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 300);
          y += 300;
          if (y >= 3000) { clearInterval(timer); resolve(); }
        }, 150);
      });
    });

    // Wait for flight listings or main content to appear
    await page.waitForTimeout(3000);

    // Extract H1
    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.innerText.trim() : null;
    });

    // Extract everything AFTER the H1 — the main content + flight listings
    const afterH1 = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return { text: null, html: null };

      // Get the parent section or next siblings after H1
      let node = h1.nextElementSibling;
      const sections = [];

      while (node) {
        const text = node.innerText?.trim();
        if (text && text.length > 0) {
          sections.push({
            tag: node.tagName,
            text: text.substring(0, 2000), // cap per section
          });
        }
        node = node.nextElementSibling;
        if (sections.length > 30) break; // cap total sections
      }
      return sections;
    });

    // Extract structured flight listings — look for flight cards/rows
    const flightListings = await page.evaluate(() => {
      const results = [];

      // Try common Goibibo flight card selectors
      const selectors = [
        '[data-testid="flight-card"]',
        '.flightCard',
        '.flightListing',
        '.flight-row',
        '.airlineRow',
        '.listingCard',
        '[class*="flightCard"]',
        '[class*="flight-card"]',
        '[class*="FlightCard"]',
        '[class*="listing"]',
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          els.forEach(el => {
            results.push({
              selector: sel,
              text: el.innerText?.trim().substring(0, 500),
            });
          });
          break;
        }
      }

      // If no structured cards, extract all text blocks that look like flight data
      if (results.length === 0) {
        // Look for price patterns, time patterns, airline names
        const allText = document.body.innerText;
        const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Find lines after the H1 text
        const h1El = document.querySelector('h1');
        const h1Text = h1El ? h1El.innerText.trim() : '';
        let h1Found = false;
        const afterH1Lines = [];

        for (const line of lines) {
          if (!h1Found && line.includes(h1Text.substring(0, 30))) {
            h1Found = true;
            continue;
          }
          if (h1Found) {
            afterH1Lines.push(line);
            if (afterH1Lines.length > 200) break;
          }
        }

        return [{ selector: 'text-extraction', text: afterH1Lines.join('\n') }];
      }

      return results;
    });

    // Extract full page text after H1 as fallback
    const fullTextAfterH1 = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return document.body.innerText.substring(0, 5000);

      // Walk DOM and collect text from elements that come after h1
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let found = false;
      const chunks = [];

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!found) {
          // Check if we've passed the H1
          if (h1.contains(node)) { found = true; continue; }
          if (found) {
            const t = node.textContent?.trim();
            if (t) chunks.push(t);
          }
        } else {
          const t = node.textContent?.trim();
          if (t) chunks.push(t);
        }
        if (chunks.join(' ').length > 8000) break;
      }
      return chunks.join('\n');
    });

    // Save full HTML too
    const html = await page.content();

    const result = {
      name: site.name,
      url: site.url,
      scrapedAt: new Date().toISOString(),
      h1,
      afterH1Sections: afterH1,
      flightListings,
      fullTextAfterH1: fullTextAfterH1.substring(0, 8000),
    };

    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.json`), JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}.html`), html, 'utf8');

    console.log(`  ✓ H1: ${h1}`);
    console.log(`  ✓ Sections after H1: ${Array.isArray(afterH1) ? afterH1.length : 0}`);
    console.log(`  ✓ Flight cards found: ${flightListings.length}`);
    console.log(`  ✓ Saved → scraped-data/flight-listings/${site.name}.json + .html`);

    return result;

  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(OUTPUT_DIR, `${site.name}-partial.html`), html, 'utf8');
      console.log(`  ~ Saved partial HTML`);
    } catch (_) {}
    return { name: site.name, url: site.url, error: err.message };
  } finally {
    await context.close();
  }
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-http2',
      '--disable-blink-features=AutomationControlled',
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

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all-listings.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );

  console.log('\n✅ Done! Data saved to scraped-data/flight-listings/');
  console.log('   Push this folder to the repo so Claude can analyse the flight data.');
})();
