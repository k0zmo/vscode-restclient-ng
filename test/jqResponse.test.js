const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { mkdtemp, rmdir, unlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { delimiter, join, resolve } = require('node:path');
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
    const filter = { path: filterPath };
    const preview = await transformResponseWithJq(original, filter);
    assert.deepEqual(JSON.parse(preview.body), [{ id: 1, name: 'Żaneta' }]);
    assert.equal(preview.contentType, 'application/json; charset=utf-8');
    assert.equal(preview.headers['Content-Length'], String(Buffer.byteLength(preview.body)));
    assert.equal(preview.headers['X-Custom'], 'test');
    assert.equal(preview.headers['Content-Encoding'], undefined);
    assert.equal(preview.bodyBuffer.toString(), preview.body);
    assert.equal(original.body, input);
    assert.equal(original.headers['Content-Encoding'], 'gzip');

    const jqName = process.platform === 'win32' ? 'jq.exe' : 'jq';
    const jqPath = process.env.PATH.split(delimiter)
        .map(entry => resolve(entry, jqName))
        .find(existsSync);
    assert.ok(jqPath);
    assert.equal((await transformResponseWithJq(original, filter, jqPath)).body, preview.body);
    await assert.rejects(transformResponseWithJq(original, filter, './jq'), /absolute path/);
    await assert.rejects(transformResponseWithJq(original, filter, join(directory, jqName)), /Check rest-client-ng.jqPath/);

    await writeFile(filterPath, '.users[] | .id, .name');
    const stream = await transformResponseWithJq(original, filter);
    assert.equal(stream.contentType, 'text/plain; charset=utf-8');
    assert.deepEqual(stream.body.trim().split(/\r?\n/).map(line => JSON.parse(line)), [1, 'Żaneta']);

    await writeFile(filterPath, 'empty');
    assert.equal((await transformResponseWithJq(original, filter)).body, '');

    await writeFile(filterPath, '42, error("bad response")');
    await assert.rejects(transformResponseWithJq(original, filter), /bad response/);
    await assert.rejects(transformResponseWithJq(original, { path: join(directory, 'missing.jq') }), /missing\.jq/);
});

test('runs a multiline inline jq program as one argument', async () => {
    const input = '{"items":[1,2,3]}';
    const original = new HttpResponse(200, 'OK', '1.1', {}, input, input.length, 0, Buffer.from(input), {}, {});
    const program = '# Keep the line break after this comment\n.items\n| {label: "even", values: map(select(. % 2 == 0))}';
    assert.deepEqual(JSON.parse((await transformResponseWithJq(original, { program })).body), { label: 'even', values: [2] });
    assert.equal((await transformResponseWithJq(original, { program: '-1' })).body.trim(), '-1');
    await assert.rejects(transformResponseWithJq(original, { program: 'error("inline failure")' }), /inline failure/);
});
