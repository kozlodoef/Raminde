import test from 'node:test';
import assert from 'node:assert/strict';
import {eventCardStyle} from '../src/lib/event-colors.js';
import {COLORS} from '../src/domain/groups.js';
test('an event card uses the exact calendar/group colour',()=>{
  const a=eventCardStyle('#19815d');assert.equal(a['--event-color'],'#19815d');
  assert.equal(a['--event-tint'],'rgba(25, 129, 93, 0.14)');
  assert.equal(a['--event-tint-soft'],'rgba(25, 129, 93, 0.06)');
});
test('all palette colours remain distinct and unmodified',()=>{
  assert.deepEqual(COLORS.map(c=>eventCardStyle(c)['--event-color']),COLORS);
  assert.equal(new Set(COLORS.map(c=>eventCardStyle(c)['--event-color'])).size,COLORS.length);
});
test('the same group colour gives the same style for every occurrence',()=>{
  assert.deepEqual(eventCardStyle('#7854B9'),eventCardStyle('#7854b9'));
});
test('invalid or missing colours cannot inject CSS and use a visible fallback',()=>{
  for(const c of [null,undefined,'','red','url(https://example.com)',';color:red','#12345z'])
    assert.deepEqual(eventCardStyle(c),eventCardStyle('#146ad4'));
});
