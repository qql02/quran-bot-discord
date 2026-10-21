import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDonationMessage } from '../src/utils/donation.js';

test('donation card: link button when configured, polite note when not, both languages', () => {
  for (const lang of ['ar', 'en']) {
    const on = buildDonationMessage(lang, 'https://example.com/support');
    const btn = on.components[0].toJSON().components[0];
    assert.equal(btn.url, 'https://example.com/support');
    assert.equal(btn.style, 5);                                   // Link button: Discord opens it, the bot never sees payment data
    const off = buildDonationMessage(lang, undefined);
    assert.equal(off.components, undefined);
    assert.ok(off.embeds[0].data.setDescription.length > 10);
  }
});
