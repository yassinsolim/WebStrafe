import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [base, output] = process.argv.slice(2);
if (!base) throw new Error('usage: node tools/qa/bot-combat-check.mjs <local-dev-url> [output-directory]');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route(/supabase\.(co|in)/, route => route.abort());
  const page = await context.newPage();
  const messages = [];
  const events = new EventEmitter();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(frame.payload.toString());
    messages.push(message);
    events.emit('message', message);
  }));
  const waitForMessage = (match, after = 0, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const found = messages.slice(after).find(match);
    if (found) { resolve(found); return; }
    const onMessage = message => {
      if (!match(message)) return;
      clearTimeout(timer);
      events.off('message', onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      events.off('message', onMessage);
      reject(new Error(`Missing combat event; recent messages: ${messages.slice(-12).map(message => message.type).join(', ')}`));
    }, timeoutMs);
    events.on('message', onMessage);
  });

  await page.goto(`${base}/?shot=movement_test_scene&qa=1&weapon=awp&knife=karambit&quality=medium&hud=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__qa, null, { timeout: 30000 });
  try {
    await page.waitForFunction(() => window.__qa.state().localId, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__qa.state().players.some(player => player.id.startsWith('bot:')), null, { timeout: 15000 });
  } catch {
    throw new Error(`Combat setup failed: ${JSON.stringify({ state: await page.evaluate(() => window.__qa.state()), errors, messages: messages.slice(-3) })}`);
  }
  const initial = await page.evaluate(() => window.__qa.state());
  const bot = initial.players.find(player => player.id.startsWith('bot:'));
  console.log(JSON.stringify({ phase: 'joined', localId: initial.localId, bot, surf: initial.surf }));
  if (initial.surf.pvp === false) await page.evaluate(() => window.__qa.togglePvp());
  await waitForMessage(message => message.type === 'hit' && message.shooterId === bot.id && message.targetId === initial.localId);
  const snapshots = messages.filter(message => message.type === 'snapshot').flatMap(message => message.players.filter(player => player.id === bot.id));
  const displacement = Math.max(...snapshots.map(player => Math.hypot(player.position[0] - bot.pos[0], player.position[2] - bot.pos[2])));
  assert.ok(displacement > 0.5, `Bot stayed in place: ${displacement} m`);
  const naturalShots = messages.filter(message => message.type === 'shot' && message.playerId === bot.id);
  if (output) {
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'bot-alive.png') });
  }

  await page.waitForFunction(() => window.__qa.state().alive, null, { timeout: 10000 });
  const killStart = messages.length;
  const aimed = await page.evaluate(id => {
    window.__qa.equip('awp');
    const aimed = window.__qa.aimAt(id);
    if (aimed) window.__qa.fire();
    return aimed;
  }, bot.id);
  assert.ok(aimed, 'Bot was not available to aim at');
  await waitForMessage(message => message.type === 'death' && message.victimId === bot.id, killStart);
  await page.waitForFunction(id => {
    const displayed = window.__qa.state().players.some(player => player.id === id);
    const model = window.__webstrafe.scene.getObjectByName(`RemotePlayer:${id}`);
    return !displayed && !model;
  }, bot.id, { timeout: 1500 });
  const deadSnapshot = messages.slice(killStart).filter(message => message.type === 'snapshot')
    .some(message => message.players.some(player => player.id === bot.id && player.alive === false));
  assert.ok(deadSnapshot, 'Renderer removal was not backed by a dead server snapshot');
  if (output) await page.screenshot({ path: path.join(output, 'bot-dead.png') });
  await waitForMessage(message => message.type === 'respawn' && message.playerId === bot.id, killStart, 10000);
  await page.waitForFunction(id => window.__qa.state().players.some(player => player.id === id)
    && !!window.__webstrafe.scene.getObjectByName(`RemotePlayer:${id}`), bot.id, { timeout: 3000 });
  if (output) await page.screenshot({ path: path.join(output, 'bot-respawned.png') });
  assert.deepEqual(errors, []);
  const report = {
    botId: bot.id,
    displacementMetres: +displacement.toFixed(2),
    naturalShots: naturalShots.map(shot => shot.result),
    damagedPlayer: true,
    deadSnapshot,
    deadModelRemoved: true,
    respawnModelRestored: true,
    pageErrors: errors.length,
  };
  if (output) writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}