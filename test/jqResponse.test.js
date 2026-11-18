const assert = require('node:assert/strict');
const { mkdtemp, rmdir, unlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { HttpResponse } = require('../out/src/models/httpResponse');
const { transformResponseWithJq } = require('../out/src/utils/jqResponse');

test('runs jq filters from a file and preserves the server response', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'rest client ng-'));
    const filterPath = join(directory, 'users filter.jq');
    t.after(async () => {
        await unlink(filterPath);
        await rmdir(directory);
    });
    const input = JSON.stringify({ users: [{ id: 1, name: 'Żaneta', active: true }] });
    const original = new HttpResponse(200, 'OK', '1.1', {
        'content-type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-Custom': 'test',
    }, input, Buffer.byteLength(input), 0, Buffer.from(input), {}, {});

    await writeFile(filterPath, '.users | map({id, name})');
    const preview = await transformResponseWithJq(original, filterPath);
    assert.deepEqual(JSON.parse(preview.body), [{ id: 1, name: 'Żaneta' }]);
    assert.equal(preview.contentType, 'application/json; charset=utf-8');
    assert.equal(preview.headers['Content-Length'], String(Buffer.byteLength(preview.body)));
    assert.equal(preview.headers['X-Custom'], 'test');
    assert.equal(preview.headers['Content-Encoding'], undefined);
    assert.equal(preview.bodyBuffer.toString(), preview.body);
    assert.equal(original.body, input);
    assert.equal(original.headers['Content-Encoding'], 'gzip');

    await writeFile(filterPath, '.users[] | .id, .name');
    const stream = await transformResponseWithJq(original, filterPath);
    assert.equal(stream.contentType, 'text/plain; charset=utf-8');
    assert.deepEqual(stream.body.trim().split(/\r?\n/).map(line => JSON.parse(line)), [1, 'Żaneta']);

    await writeFile(filterPath, 'empty');
    assert.equal((await transformResponseWithJq(original, filterPath)).body, '');

    await writeFile(filterPath, '42, error("bad response")');
    await assert.rejects(transformResponseWithJq(original, filterPath), /bad response/);
    await assert.rejects(transformResponseWithJq(original, join(directory, 'missing.jq')), /missing\.jq/);
});
