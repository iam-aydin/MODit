// The install queue: questions for archives that arrive together are asked one archive at a time, counted "1/3", and a
// cancelled or unreadable archive skips only itself (src/renderer/queue.js, the same file the app window loads).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Q = require('../src/renderer/queue.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function rig() {
  const log = [], errors = [];
  let open = 0, maxOpen = 0;
  const q = Q.create((label, e) => errors.push([label, e.message]));
  // a dialog: it is "open" for a moment, then answers (null = the user pressed Cancel)
  const dialog = async (title, answer, ms = 4) => {
    open++; maxOpen = Math.max(maxOpen, open); log.push('open ' + title);
    await sleep(ms);
    open--; log.push('close ' + title);
    return answer;
  };
  return { q, log, errors, dialog, maxOpen: () => maxOpen };
}

test('3 downloads finishing at the same moment: one dialog at a time, in order, counted 1/3, 2/3, 3/3', async () => {
  const r = rig();
  const installed = [];
  const names = ['A.zip', 'B.zip', 'C.zip'];
  // all three "finished" in the same tick, exactly like three simultaneous downloads
  const all = names.map(n => r.q.add(n, async info => {
    const ok = await r.dialog(n + info.tag(), 'yes');
    if (ok) installed.push(n);
    return ok;
  }));
  assert.equal(r.q.pending(), 3);
  await Promise.all(all);
  assert.equal(r.maxOpen(), 1, 'two dialogs were open at the same time');
  assert.deepEqual(r.log, [
    'open A.zip (1/3)', 'close A.zip (1/3)',
    'open B.zip (2/3)', 'close B.zip (2/3)',
    'open C.zip (3/3)', 'close C.zip (3/3)',
  ], 'each dialog closes before the next one opens, in the order the downloads finished');
  assert.deepEqual(installed, names);
  assert.equal(r.q.pending(), 0);
});

test('cancelling one dialog skips only that mod', async () => {
  const r = rig();
  const installed = [];
  const answers = { 'A.zip': 'yes', 'B.zip': null, 'C.zip': 'yes' }; // the user cancels the second one
  await Promise.all(Object.keys(answers).map(n => r.q.add(n, async info => {
    const ok = await r.dialog(n + info.tag(), answers[n]);
    if (!ok) return null; // cancelled: nothing is installed, nothing else is affected
    installed.push(n);
    return n;
  })));
  assert.deepEqual(installed, ['A.zip', 'C.zip']);
  assert.deepEqual(r.log.filter(x => x.startsWith('open')), ['open A.zip (1/3)', 'open B.zip (2/3)', 'open C.zip (3/3)'], 'the counter keeps counting the skipped one');
  assert.equal(r.errors.length, 0, 'a cancel is not an error');
});

test('an archive that throws is reported and skipped; the others carry on', async () => {
  const r = rig();
  const installed = [];
  const run = n => r.q.add(n, async info => {
    if (n === 'B.zip') throw new Error('not an archive');
    await r.dialog(n + info.tag(), 'yes');
    installed.push(n);
  });
  await Promise.all(['A.zip', 'B.zip', 'C.zip'].map(run));
  assert.deepEqual(installed, ['A.zip', 'C.zip']);
  assert.deepEqual(r.errors, [['B.zip', 'not an archive']]);
  assert.equal(r.maxOpen(), 1);
});

test('a single archive has no counter; the count starts over once the queue is empty', async () => {
  const r = rig();
  const tags = [];
  await r.q.add('one.zip', async info => { tags.push(info.tag()); });
  assert.deepEqual(tags, [''], 'one archive: no "1/1"');
  await Promise.all(['a', 'b'].map(n => r.q.add(n, async info => { tags.push(info.tag()); })));
  assert.deepEqual(tags, ['', ' (1/2)', ' (2/2)'], 'the earlier archive does not count');
});

test('an archive that arrives while others are being asked about joins the count', async () => {
  const r = rig();
  const titles = [];
  const first = r.q.add('A.zip', async info => { await sleep(10); titles.push('A' + info.tag()); });
  const second = r.q.add('B.zip', async info => { titles.push('B' + info.tag()); });
  await sleep(2);                                        // A is open, B waits; now C is downloaded too
  const third = r.q.add('C.zip', async info => { titles.push('C' + info.tag()); });
  await Promise.all([first, second, third]);
  assert.deepEqual(titles, ['A (1/3)', 'B (2/3)', 'C (3/3)']);
});

test('the window loads the queue and every archive goes through it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="queue.js"></script>'), 'index.html must load queue.js');
  assert.ok(html.indexOf('queue.js') < html.indexOf('InstallQueue.create'), 'queue.js loads before it is used');
  assert.match(html, /IQ\.add\(/, 'handlePaths puts each archive into the queue');
  assert.doesNotMatch(html, /handleArchive\(p\)\.catch/, 'no archive may be handled outside the queue');
});
