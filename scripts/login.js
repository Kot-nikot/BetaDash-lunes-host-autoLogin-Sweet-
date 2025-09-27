// scripts/login.js
import { chromium } from '@playwright/test';
import fs from 'fs';

const LOGIN_URL = 'https://ctrl.lunes.host/auth/login';

// Telegram 通知
async function notifyTelegram({ ok, stage, msg, screenshotPath }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log('[WARN] TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID Не установлено，уведомление пропущено');
      return;
    }

    const text = [
      `🔔 Lunes автоматическая аутентификация：${ok ? '✅ Успешно' : '❌ Неудачно'}`,
      `Этап：${stage}`,
      msg ? `Информация：${msg}` : '',
      `Время：${new Date().toISOString()}`
    ].filter(Boolean).join('\n');

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    // Если есть скриншот, присылаем его
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const photoUrl = `https://api.telegram.org/bot${token}/sendPhoto`;
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', `Lunes автоматическое создание скриншота（${stage}）`);
      form.append('photo', new Blob([fs.readFileSync(screenshotPath)]), 'screenshot.png');
      await fetch(photoUrl, { method: 'POST', body: form });
    }
  } catch (e) {
    console.log('[WARN] Telegram сбой：', e.message);
  }
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Переменная окружения ${name} не установлена`);
  return v;
}

async function main() {
  const username = envOrThrow('LUNES_USERNAME');
  const password = envOrThrow('LUNES_PASSWORD');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const screenshot = (name) => `./${name}.png`;

  try {
    // 1) Открываем страницу входа
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Проверка CAPCHI
    const humanCheckText = await page.locator('text=/Verify you are human|Требуется подтверждение | Проверка безопасности|review the security/i').first();
    if (await humanCheckText.count()) {
      const sp = screenshot('01-human-check');
      await page.screenshot({ path: sp, fullPage: true });
      await notifyTelegram({ ok: false, stage: 'Открытие страницы входа', msg: 'Онарузена проверка на бота', screenshotPath: sp });
      process.exitCode = 2;
      return;
    }

    // 2) ввод данных пользоватенля
    const userInput = page.locator('input[name="username"]');
    const passInput = page.locator('input[name="password"]');
    await userInput.waitFor({ state: 'visible', timeout: 30_000 });
    await passInput.waitFor({ state: 'visible', timeout: 30_000 });

    await userInput.fill(username);
    await passInput.fill(password);

    const loginBtn = page.locator('button[type="submit"]');
    await loginBtn.waitFor({ state: 'visible', timeout: 15_000 });

    const spBefore = screenshot('02-before-submit');
    await page.screenshot({ path: spBefore, fullPage: true });

    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
      loginBtn.click({ timeout: 10_000 })
    ]);

    // 3) Скрин результата
    const spAfter = screenshot('03-after-submit');
    await page.screenshot({ path: spAfter, fullPage: true });

    const url = page.url();
    const successHint = await page.locator('text=/Dashboard|Logout|Sign out|Консоль | Панель управления/i').first().count();
    const stillOnLogin = /\/auth\/login/i.test(url);

    if (!stillOnLogin || successHint > 0) {
      await notifyTelegram({ ok: true, stage: 'Вход выполнен успешно', msg: `Текущий URL：${url}`, screenshotPath: spAfter });

      // **Вход в детали сервера**
      const serverLink = page.locator('a[href="/server/5202fe13"]');
      await serverLink.waitFor({ state: 'visible', timeout: 20_000 });
      await serverLink.click({ timeout: 10_000 });

      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      const spServer = screenshot('04-server-page');
      await page.screenshot({ path: spServer, fullPage: true });
      await notifyTelegram({ ok: true, stage: 'Вход на странице сервера', msg: 'Сведения для сервера успешно открыты', screenshotPath: spServer });

      // **Нажимаем Console **
      const consoleMenu = page.locator('a[href="/server/5202fe13"].active');
      await consoleMenu.waitFor({ state: 'visible', timeout: 15_000 });
      await consoleMenu.click({ timeout: 5_000 });

      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      // **Жмем Restart**
      const restartBtn = page.locator('button:has-text("Restart")');
      await restartBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await restartBtn.click();
      await notifyTelegram({ ok: true, stage: 'Нажмите Restart', msg: 'Перезагрузка VPS' });

      // Ждем перезагрузку VPS  10 сек）
      await page.waitForTimeout(10000);

      // **Ввод команды и нажатие ENTER**
      const commandInput = page.locator('input[placeholder="Type a command..."]');
      await commandInput.waitFor({ state: 'visible', timeout: 20_000 });
      await commandInput.fill('working properly');
      await commandInput.press('Enter');

      // Ожидание
      await page.waitForTimeout(5000);

      //скрин и уведомление
      const spCommand = screenshot('05-command-executed');
      await page.screenshot({ path: spCommand, fullPage: true });
      await notifyTelegram({ ok: true, stage: 'Команда выполнена', msg: 'restart.sh выполнен', screenshotPath: spCommand });

      process.exitCode = 0;
      return;
    }

    // Обработка ошибок входа
    const errorMsgNode = page.locator('text=/Invalid|incorrect|Ошибка|Сбой| Недействительный/i');
    const hasError = await errorMsgNode.count();
    const errorMsg = hasError ? await errorMsgNode.first().innerText().catch(() => '') : '';
    await notifyTelegram({
      ok: false,
      stage: 'Не удалось войти',
      msg: errorMsg ? `Подозрение на не удачу（${errorMsg}）` : 'Все еще на странице входа',
      screenshotPath: spAfter
    });
    process.exitCode = 1;
  } catch (e) {
    const sp = screenshot('99-error');
    try { await page.screenshot({ path: sp, fullPage: true }); } catch {}
    await notifyTelegram({ ok: false, stage: 'Исключение', msg: e?.message || String(e), screenshotPath: fs.existsSync(sp) ? sp : undefined });
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
