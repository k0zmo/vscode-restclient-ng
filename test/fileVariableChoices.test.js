const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

let showQuickPick;
const load = Module._load;
const { FileVariableChoices } = (() => {
    Module._load = function (name, ...args) {
        if (name === 'vscode') {
            return {
                EventEmitter: class { fire() {} },
                window: { showQuickPick: (...params) => showQuickPick(...params) },
            };
        }
        return load.call(this, name, ...args);
    };
    try {
        return require('../out/src/utils/fileVariableChoices');
    } finally {
        Module._load = load;
    }
})();

test('picks file-local values once, and asks again after the selected option changes', async () => {
    const lines = [
        '@platformUrl = https://example.test',
        '@choice fabricId Local lab = fabric-123',
        '// @choice fabricId Staging = fabric-456',
        '# @choice fabricId Production = fabric-789',
        '###',
        'GET {{platformUrl}}/fabrics/{{fabricId}}',
        '@choice ignored Inside a request = value',
    ];
    const doc = {
        languageId: 'http',
        uri: 'file:///fabrics.http',
        version: 1,
        lineCount: lines.length,
        lineAt: index => ({ text: lines[index] }),
    };
    const request = lines[5];

    showQuickPick = () => assert.fail('This request should not prompt');
    assert.equal(await FileVariableChoices.resolveRequest(doc, 'GET {{platformUrl}}', new Map()), true);
    assert.equal(await FileVariableChoices.resolveRequest(doc, request, new Map([['fabricId', 'override']])), true);
    assert.deepEqual([...FileVariableChoices.getDefinitions(doc).keys()], ['fabricId']);

    showQuickPick = options => {
        assert.deepEqual(options.map(option => option.label), ['Local lab', 'Staging', 'Production']);
        return options[1];
    };
    const variables = new Map();
    assert.equal(await FileVariableChoices.resolveRequest(doc, request, variables), true);
    assert.equal(variables.get('fabricId'), 'fabric-456');
    assert.equal(FileVariableChoices.getSelection(doc, 'fabricId').label, 'Staging');

    showQuickPick = () => assert.fail('The file should reuse its selection');
    const nextVariables = new Map();
    assert.equal(await FileVariableChoices.resolveRequest(doc, request, nextVariables), true);
    assert.equal(nextVariables.get('fabricId'), 'fabric-456');

    showQuickPick = () => undefined;
    assert.equal(await FileVariableChoices.resolveRequest({ ...doc, uri: 'file:///other.http' }, request, new Map()), false);
    assert.equal(await FileVariableChoices.pick(doc, 'fabricId'), undefined);
    assert.equal(FileVariableChoices.getSelection(doc, 'fabricId').description, 'fabric-456');

    lines[2] = '// @choice fabricId Staging = fabric-999';
    doc.version++;
    assert.equal(await FileVariableChoices.resolveRequest(doc, request, new Map()), false);
    showQuickPick = options => options[1];
    assert.equal((await FileVariableChoices.pick(doc, 'fabricId')).description, 'fabric-999');
});
