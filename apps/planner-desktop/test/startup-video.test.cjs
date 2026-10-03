const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, transition } = require('../renderer/startup-video.js');

test('fast data does not cut off the video; ending enters once', () => {
  const ready = transition(initialState(), { type: 'ready' });
  assert.equal(ready.entered, false);
  const entered = transition(ready, { type: 'media-done' });
  assert.equal(entered.entered, true);
  assert.equal(transition(entered, { type: 'error', message: 'late' }), entered);
});
test('skip/end/fallback cannot bypass unfinished data', () => {
  let s = transition(initialState(), { type: 'phase', message: '真实阶段' });
  s = transition(s, { type: 'media-done' });
  assert.equal(s.entered, false);
  assert.equal(s.phase, '真实阶段');
  assert.equal(transition(s, { type: 'ready' }).entered, true);
});
test('errors interrupt video; only retry resumes the data gate', () => {
  const error = transition(initialState(), { type: 'error', message: '读取失败' });
  assert.equal(error.media, 'done');
  assert.equal(error.entered, false);
  assert.equal(transition(error, { type: 'phase', message: 'late' }).phase, '读取失败');
  const retried = transition(error, { type: 'retry' });
  assert.equal(retried.data, 'loading');
  assert.equal(retried.media, 'done');
  assert.equal(transition(retried, { type: 'ready' }).entered, true);
});
test('repeated failure remains actionable without restarting the video', () => {
  let s = transition(initialState(), { type: 'error', message: 'first' });
  s = transition(s, { type: 'retry' });
  s = transition(s, { type: 'error', message: 'second' });
  assert.equal(s.data, 'error');
  assert.equal(s.phase, 'second');
  assert.equal(s.media, 'done');
});
