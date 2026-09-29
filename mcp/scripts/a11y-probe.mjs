#!/usr/bin/env node
// Runs inside a separate node process so a hung browser never blocks the MCP server.
// Playwright is resolved from the astryx checkout, not installed here.
//
//   node a11y-probe.mjs '<json>'   json = { repo, baseUrl, story, mode: 'tree'|'probe', selector?, control?, surface?, nested?, log?, activations? }
// Prints one JSON document on stdout.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const opts = JSON.parse(process.argv[2] ?? '{}');
const out = (v) => { process.stdout.write(JSON.stringify(v)); };

let chromium;
try {
  ({ chromium } = createRequire(join(opts.repo, 'package.json'))('@playwright/test'));
} catch (err) {
  out({ error: `@playwright/test not resolvable from ${opts.repo}: ${err.message.split('\n')[0]}. Run pnpm install in the checkout.` });
  process.exit(0);
}

const INTERACTIVE = /^(button|link|checkbox|radio|switch|textbox|combobox|tab|menuitem|menuitemcheckbox|menuitemradio|option|slider|spinbutton|searchbox|listbox|menu|tablist|treeitem)$/;
const url = `${opts.baseUrl.replace(/\/$/, '')}/iframe.html?viewMode=story&id=${encodeURIComponent(opts.story)}`;

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  out({ error: `Chromium failed to launch: ${err.message.split('\n')[0]}. In the checkout run: pnpm exec playwright install chromium` });
  process.exit(0);
}
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

try {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 }).catch((e) => { throw new Error(`cannot open ${url}: ${e.message.split('\n')[0]}. Start Storybook (pnpm storybook, port 6006) or serve a build (python3 -m http.server -d apps/storybook/dist 6127) and pass baseUrl.`); });
  if (res && res.status() >= 400) throw new Error(`${url} answered ${res.status()}`);
  const missing = await page.locator('h1', { hasText: /Couldn't find story/ }).count();
  if (missing) throw new Error(`Storybook has no story '${opts.story}'. Ids look like core-button--primary; see <baseUrl>/index.json`);
  await page.locator('#storybook-root *').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  await cdp.send('DOM.enable');

  const describe = async (backendNodeId) => {
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId, returnByValue: true,
        functionDeclaration: 'function(){ if (!this.tagName) return null; const c = this.className && typeof this.className === "string" ? "." + this.className.trim().split(/\\s+/).slice(0, 2).join(".") : ""; return this.tagName.toLowerCase() + (this.id ? "#" + this.id : "") + c; }',
      });
      return result.value;
    } catch {
      return null;
    }
  };

  const fullTree = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const build = async (n) => {
      const kids = [];
      for (const id of n.childIds ?? []) {
        const c = byId.get(id);
        if (!c) continue;
        if (c.ignored) kids.push(...(await build(c)));
        else kids.push(await node(c));
      }
      return kids;
    };
    const node = async (n) => {
      const role = n.role?.value ?? '';
      const props = Object.fromEntries((n.properties ?? []).map((p) => [p.name, p.value?.value]));
      const nameFrom = (n.name?.sources ?? []).filter((s) => s.value?.value !== undefined && !s.superseded).map((s) => s.attribute ? `${s.type}:${s.attribute}` : s.type);
      const entry = { role, name: n.name?.value ?? '' };
      if (n.description?.value) entry.description = n.description.value;
      if (nameFrom.length) entry.nameFrom = nameFrom;
      if (Object.keys(props).length) entry.states = props;
      if (INTERACTIVE.test(role) && n.backendDOMNodeId) entry.dom = await describe(n.backendDOMNodeId);
      const children = await build(n);
      if (children.length) entry.children = children;
      return entry;
    };
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    const tree = root ? (root.ignored ? await build(root) : [await node(root)]) : [];
    const interactive = nodes.filter((n) => !n.ignored && INTERACTIVE.test(n.role?.value ?? '')).map((n) => `${n.role.value} "${n.name?.value ?? ''}"`);
    return { tree, interactive, nodes: nodes.length, live: nodes.filter((n) => !n.ignored).length };
  };

  if (opts.mode === 'probe') {
    const { control, surface, nested, log: logSel = '[data-probe-log]', activations: actSel = '[data-a11y-activations]' } = opts;
    if (!control || !surface) throw new Error('probe mode needs control and surface selectors');
    const pageUrl = () => page.url().replace(/^.*iframe\.html/, 'iframe.html');
    const state = async () => ({
      log: await page.evaluate((s) => document.querySelector(s)?.textContent ?? null, logSel),
      activations: await page.evaluate((s) => document.querySelector(s)?.getAttribute('data-a11y-activations') ?? null, actSel),
      url: pageUrl(),
    });
    const hit = (sel) => page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return 'NO-ELEMENT';
      const r = e.getBoundingClientRect();
      const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), centre: h === e ? 'SUBJECT' : e.contains(h) ? 'DESCENDANT' : `${h?.tagName}:${(h?.textContent || '').trim().slice(0, 24)}` };
    }, sel);
    const goHome = async () => { await page.goto(url); await page.locator(control).first().waitFor({ state: 'attached' }); await page.waitForTimeout(300); };
    const result = { story: opts.story, base: opts.baseUrl, steps: {} };
    const step = async (name, fn) => {
      try { await fn(); await page.waitForTimeout(250); result.steps[name] = await state(); }
      catch (e) { result.steps[name] = { error: e.message.split('\n')[0].slice(0, 160) }; }
    };
    await page.locator(control).first().waitFor({ state: 'attached', timeout: 5000 });
    result.controlHit = await hit(control);
    result.treeBefore = (await fullTree()).interactive;
    result.steps.initial = await state();
    await step('controlClick', () => page.locator(control).first().click({ timeout: 3000 }));
    await goHome(); await step('surfaceClick', () => page.locator(surface).first().click({ timeout: 3000 }));
    await goHome(); await step('enterOnControl', async () => { await page.locator(control).first().focus(); await page.keyboard.press('Enter'); });
    await goHome(); await step('spaceOnControl', async () => { await page.locator(control).first().focus(); await page.keyboard.press('Space'); });
    await goHome(); await step('middleClickSurface', async () => { const r = await page.locator(surface).first().boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'middle' }); });
    if (nested) { await goHome(); result.nestedHit = await hit(nested); await step('nestedClick', () => page.locator(nested).first().click({ timeout: 3000 })); }
    await goHome(); await step('abortedPressOnControl', async () => { const r = await page.locator(control).first().boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.move(5, 5); await page.mouse.up(); });
    result.treeAfter = (await fullTree()).interactive;
    result.pageErrors = errors;
    out(result);
  } else {
    const t = await fullTree();
    const target = opts.selector ? page.locator(opts.selector).first() : page.locator('#storybook-root');
    let ariaSnapshot = '';
    try { ariaSnapshot = await target.ariaSnapshot({ timeout: 5000 }); } catch (e) { ariaSnapshot = `(ariaSnapshot failed: ${e.message.split('\n')[0]})`; }
    let focusWalk = [];
    try {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const d = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return 'body'; return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('aria-label') ? `[aria-label="${e.getAttribute('aria-label')}"]` : '') + (e.textContent ? `:"${e.textContent.trim().slice(0, 24)}"` : ''); });
        if (d === 'body' && i > 0) break;
        focusWalk.push(d);
      }
    } catch { /* focus walk is best effort */ }
    out({ story: opts.story, url, ...t, ariaSnapshot, focusWalk, pageErrors: errors });
  }
} catch (err) {
  out({ error: err.message.split('\n')[0], pageErrors: errors });
} finally {
  await browser.close();
}
