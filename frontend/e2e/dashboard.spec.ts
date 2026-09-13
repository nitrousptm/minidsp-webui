import { test, expect } from '@playwright/test';

test('shows the connected device and channel strips', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('2x4HD', { exact: false })).toBeVisible();
  await expect(page.locator('.channel-strip')).toHaveCount(6); // 2 inputs + 4 outputs
});

test('source dropdown shows the real device source on first load, not the first <option> by default', async ({
  page,
}) => {
  // Regression test: minidspd's first WS frame is very likely a level-only
  // tick with an empty (but present) master object. If that's trusted over
  // the initial HTTP fetch, the <select> falls back to displaying whichever
  // <option> happens to be listed first, looking like a silent reset.
  await page.goto('/');
  const select = page.locator('.master-bar select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('Usb'); // matches the mock's default master.source
});

test('delay can be set numerically and stays in sync with the slider', async ({ page }) => {
  await page.goto('/');
  const output = page.locator('.channel-strip').nth(2);
  const delayRow = output.locator('.slider-row', { hasText: 'Delay' });
  const delayNumber = delayRow.locator('input[type=number]');
  const delaySlider = delayRow.locator('input[type=range]');

  await delayNumber.fill('12.5');
  await delayNumber.blur();

  await expect(delayNumber).toHaveValue('12.5');
  await expect(delaySlider).toHaveValue('12.5');
});

test('routing button turns green when enabled', async ({ page }) => {
  await page.goto('/');
  const routingButton = page.locator('.channel-strip').nth(2).getByRole('button', { name: 'Input 1' });
  await expect(routingButton).toHaveClass(/active-green/);
  await routingButton.click();
  await expect(routingButton).not.toHaveClass(/active-green/);
  await routingButton.click();
  await expect(routingButton).toHaveClass(/active-green/);
});

test('opens the PEQ editor for an output and shows the frequency response chart', async ({ page }) => {
  await page.goto('/');
  await page.locator('.channel-strip').nth(2).getByRole('button', { name: 'PEQ' }).click();
  await expect(page.getByRole('heading', { name: /Parametric EQ/ })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.peq-table tbody tr')).toHaveCount(10);
});

test('enabling a PEQ slot turns the PEQ strip button yellow', async ({ page }) => {
  await page.goto('/');
  const output = page.locator('.channel-strip').nth(2);
  await output.getByRole('button', { name: 'PEQ' }).click();
  await page.locator('.peq-table tbody tr').first().locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(output.getByRole('button', { name: 'PEQ' })).toHaveClass(/active-yellow/);
});

test('imports a REW Filter Settings export into the PEQ slots', async ({ page }) => {
  await page.goto('/');
  const output = page.locator('.channel-strip').nth(2);
  await output.getByRole('button', { name: 'PEQ' }).click();
  await page.getByRole('button', { name: 'Import from REW…' }).click();

  const rewExport = [
    'Filter  1: ON  PK       Fc    100.0 Hz  Gain   3.00 dB  Q  4.318',
    'Filter  2: ON  LS       Fc     50.0 Hz  Gain   2.00 dB',
    'Filter  3: ON  NO       Fc     60.0 Hz  Gain -12.00 dB  Q  10.000',
  ].join('\n');
  await page.getByPlaceholder(/Filter  1: ON/).fill(rewExport);
  await page.getByRole('button', { name: 'Parse' }).click();

  await expect(page.getByText('2 filter(s) parsed')).toBeVisible();
  await expect(page.getByText(/Filter 3.*not supported/)).toBeVisible();

  await page.getByRole('button', { name: 'Apply to PEQ slots' }).click();
  const firstRow = page.locator('.peq-table tbody tr').first();
  await expect(firstRow.locator('select')).toHaveValue('PEAK');
  await expect(firstRow.locator('input[type=number]').first()).toHaveValue('100');
});

test('verifying PEQ against hardware shows a measured curve on the output PEQ editor', async ({ page }) => {
  // Not asserting on the transient "Measuring..." state here: against the
  // mock backend the whole round trip can resolve in well under a render
  // frame, which would make that assertion flaky (same lesson as the other
  // WS-race regressions in this suite - assert on settled state, not timing).
  await page.goto('/');
  await page.locator('.channel-strip').nth(2).getByRole('button', { name: 'PEQ' }).click();
  await page.getByRole('button', { name: 'Verify against hardware' }).click();
  await expect(page.getByText(/Measured with a real continuous sine sweep/)).toBeVisible({ timeout: 15000 });
});

test('the PEQ verify button is not offered for input channels (no output level meter to check)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.channel-strip').first().getByRole('button', { name: 'PEQ' }).click();
  await expect(page.getByRole('heading', { name: /Parametric EQ/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify against hardware' })).toHaveCount(0);
});

test('opens the crossover editor with high-pass and low-pass panels', async ({ page }) => {
  await page.goto('/');
  await page.locator('.channel-strip').nth(2).getByRole('button', { name: 'CROSSOVER' }).click();
  await expect(page.getByText('High-Pass')).toBeVisible();
  await expect(page.getByText('Low-Pass')).toBeVisible();
});

test('enabling the High-Pass crossover applies successfully and highlights the strip button', async ({ page }) => {
  // Regression test: minidspd rejects a crossover coeff array whose biquads
  // don't each carry their own `index` ("biquad index not specified"). This
  // exercises the real PUT round trip so a schema mismatch shows up here.
  const output = page.locator('.channel-strip').nth(2);
  const responses: number[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/outputs/0/crossover/0')) responses.push(res.status());
  });

  await page.goto('/');
  await output.getByRole('button', { name: 'CROSSOVER' }).click();
  const hpPanel = page.locator('.panel', { hasText: 'High-Pass' });
  await hpPanel.locator('input[type=checkbox]').check();

  await expect.poll(() => responses.at(-1)).toBe(200);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(output.getByRole('button', { name: 'CROSSOVER' })).toHaveClass(/active-yellow/);
});

test('dragging the High-Pass handle on the crossover chart changes its cut-off frequency', async ({ page }) => {
  await page.goto('/');
  await page.locator('.channel-strip').nth(2).getByRole('button', { name: 'CROSSOVER' }).click();
  const hpPanel = page.locator('.panel', { hasText: 'High-Pass' });
  await hpPanel.locator('input[type=checkbox]').check();

  const freqInput = hpPanel.locator('input[type=number]').first();
  const before = Number(await freqInput.inputValue());

  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  // Default HP is 80Hz Butterworth 24dB/oct; -3dB at cutoff on an 860x280
  // canvas (FREQ_MIN=20/MAX=20000, GAIN_MIN=-60/MAX=6) places the handle here.
  const handleX = box.x + 197;
  const handleY = box.y + 44;

  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX + 250, handleY, { steps: 10 });
  await page.mouse.up();

  const after = Number(await freqInput.inputValue());
  expect(after).not.toBe(before);
  expect(after).toBeGreaterThan(before); // dragged right = higher frequency
});

test('verifying crossover against hardware shows a measured curve', async ({ page }) => {
  await page.goto('/');
  await page.locator('.channel-strip').nth(2).getByRole('button', { name: 'CROSSOVER' }).click();
  await page.getByRole('button', { name: 'Verify against hardware' }).click();
  await expect(page.getByText(/Measured with a real continuous sine sweep/)).toBeVisible({ timeout: 15000 });
});

test('master volume slider keeps user input despite frequent live status pushes', async ({ page }) => {
  // Regression test: the master bar re-renders from the live-status
  // WebSocket several times a second (level meters). Without a local
  // override buffer, that feed snaps the slider back to the server's
  // pre-edit value faster than the user can drag it.
  await page.goto('/');
  const slider = page.locator('.master-bar input[type=range]');
  await slider.focus();
  const before = Number(await slider.inputValue());
  for (let i = 0; i < 6; i++) {
    await slider.press('ArrowRight');
    await page.waitForTimeout(60); // let the mock's 100ms poll tick land mid-sequence
  }
  const after = Number(await slider.inputValue());
  expect(after).toBeCloseTo(before + 3, 1); // 6 steps * 0.5dB, none lost to a reverted render
});

test('master volume does not drop back to the range minimum once the local override expires', async ({ page }) => {
  await page.goto('/');
  const slider = page.locator('.master-bar input[type=range]');
  await slider.focus();
  await slider.press('ArrowRight');

  const seenValues = new Set<string>();
  for (let i = 0; i < 12; i++) {
    seenValues.add(await slider.inputValue());
    await page.waitForTimeout(500);
  }
  expect(seenValues.size).toBe(1); // settles once and stays there, no snap-back to -127
});

test('source dropdown keeps the selected value despite frequent live status pushes', async ({ page }) => {
  await page.goto('/');
  const select = page.locator('.master-bar select');
  await select.selectOption('Toslink');
  await page.waitForTimeout(250); // span several 100ms poll ticks
  await expect(select).toHaveValue('Toslink');
});

test('source dropdown does not reset to the first option once the local override hands back to live status', async ({
  page,
}) => {
  // Regression test: minidspd's poll stream sends mostly level-only frames
  // with an *empty* (but present) master object; only ~1 in 10 ticks carries
  // the real source/volume. Naively trusting every frame blanks the display
  // once the local optimistic override expires, which native <select>
  // renders as falling back to its first <option> ("Analog") - looking like
  // the choice silently reverted.
  await page.goto('/');
  const select = page.locator('.master-bar select');
  await select.selectOption('Toslink');

  // Poll continuously well past the mock's full-status tick (every ~1s) and
  // the MasterBar's 4s safety-release timeout, watching for any flicker.
  const seenValues = new Set<string>();
  for (let i = 0; i < 12; i++) {
    seenValues.add(await select.inputValue());
    await page.waitForTimeout(500);
  }
  expect([...seenValues]).toEqual(['Toslink']);
});

test('opens the preset manager and lists 4 presets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage Presets…' }).click();
  await expect(page.locator('.peq-table tbody tr')).toHaveCount(4);
});

test('a failed preset activation surfaces an error and the UI still recovers on retry', async ({ page }) => {
  // Regression test: minidspd is known to occasionally time out on the
  // full-config push a preset activation triggers (minidspd-watchdog
  // restarts it when that happens). The handler used to let that rejection
  // skip its cleanup entirely - the preset tab stayed highlighted on the OLD
  // preset with no error shown, and (since the same minidspd hang also
  // stalls the live status WebSocket) the level meters looked frozen too,
  // with nothing telling the user why.
  let calls = 0;
  await page.route('**/api/presets/*/activate', (route) => {
    calls++;
    if (calls === 1) {
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'minidspd_unreachable', message: 'simulated device timeout' }) });
    } else {
      route.continue();
    }
  });

  await page.goto('/');
  const target = page.locator('.preset-tab', { hasText: 'Config 3' });
  await target.click();

  await expect(page.getByText(/Preset konnte nicht vollständig aktiviert werden/)).toBeVisible();

  await target.click();
  await expect(target).toHaveClass(/active/);
  await expect(page.getByText(/Preset konnte nicht vollständig aktiviert werden/)).not.toBeVisible();
});
