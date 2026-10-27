const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'UTC';

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const embedded = JSON.parse(html.match(/<script id="embedded-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);

function createRuntime() {
    const elements = new Map([
        ['save-status', { dataset: {}, setAttribute() {} }],
        ['today-panel', { innerHTML: '' }]
    ]);
    const saved = new Map();
    const messages = [];
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : ['2026-10-27T16:00:00Z']));
        }
        static now() { return new Date('2026-10-27T16:00:00Z').getTime(); }
    }
    const context = vm.createContext({
        Date: FixedDate,
        console: { log: message => messages.push(message), error: message => messages.push(message), warn: message => messages.push(message) },
        performance,
        structuredClone,
        setTimeout,
        clearTimeout,
        Event,
        document: {
            addEventListener() {},
            querySelectorAll: () => [],
            getElementById: id => elements.get(id) || null
        },
        localStorage: {
            setItem: (key, value) => saved.set(key, value),
            getItem: key => saved.get(key) || null,
            removeItem: key => saved.delete(key)
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/finance.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/workspace.js'), 'utf8'), context);
    return {
        context, elements, saved, messages,
        run: code => vm.runInContext(code, context),
        load() {
            context.payload = structuredClone(embedded);
            return vm.runInContext('applyImportedData(payload)', context);
        }
    };
}

test('existing embedded plan and all financial collections still load', () => {
    const runtime = createRuntime();
    assert.equal(runtime.load().applied, true);
    for (const key of ['accounts', 'loans', 'transactions', 'units', 'fees']) {
        assert.equal(runtime.run(`state.${key}.length`), embedded[key].length, key);
    }
});

test('30-year forecast preserves original cash and net-worth results', () => {
    const runtime = createRuntime();
    runtime.load();
    const result = runtime.run(`(() => {
        const data = calculateBalances();
        const netWorth = computeNetWorthSeries(data);
        return {
            days: data.dates.length,
            cashFirst: data.balances.Cash[0],
            cashLast: data.balances.Cash.at(-1),
            netWorthFirst: netWorth[0],
            netWorthLast: netWorth.at(-1)
        };
    })()`);
    assert.equal(result.days, 10959);
    assert.equal(result.cashFirst, 40600);
    assert.ok(Math.abs(result.cashLast - 2393282.172515058) < 0.000001);
    assert.ok(Math.abs(result.netWorthFirst - 885077.8658361086) < 0.000001);
    assert.ok(Math.abs(result.netWorthLast - 10998098.159636479) < 0.000001);
});

test('snapshot uses split asset/loan maps for shared names and matches net worth', () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run('dataCache = { ...calculateBalances(), isValid: true }; updateTodayPanel()');
    const panel = runtime.elements.get('today-panel').innerHTML;
    assert.match(panel, /\$885,077\.87/);
    assert.match(panel, /\$1,289,796\.13/);
    assert.match(panel, /\+\$203,448\.76/);
    assert.doesNotMatch(panel, /\$645,029\.53/);
});

test('snapshot keeps compatibility with the legacy balance cache', () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run(`state.accounts = [{name:'Cash'}]; state.loans = [];
        dataCache = { isValid: true, dates: [todayUTC()], balances: {Cash:[123]} };
        updateTodayPanel();`);
    assert.match(runtime.elements.get('today-panel').innerHTML, /\$123\.00/);
});

test('saved state retains the existing JSON shape and scenario storage keys', () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run('ensureDefaultScenario(); saveToLocalStorage()');
    const snapshot = JSON.parse(runtime.saved.get('financialForecastData'));
    assert.deepEqual(snapshot.accounts, embedded.accounts);
    assert.deepEqual(snapshot.loans, embedded.loans);
    assert.ok(runtime.saved.has('financialForecastScenarios'));
    assert.equal(runtime.elements.get('save-status').dataset.state, 'saved');
});

test('storage failure visibly reports an unsaved plan', () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run(`localStorage.setItem = () => { throw new Error('Quota exceeded'); }; saveToLocalStorage()`);
    assert.equal(runtime.elements.get('save-status').dataset.state, 'error');
    assert.ok(runtime.messages.some(message => message.includes('could not be saved')));
});

test('clearing saved data requires confirmation and leaves the current plan intact', async () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run('ensureDefaultScenario(); saveToLocalStorage()');
    runtime.run('showPlanDialog = async () => null');
    await runtime.run('clearLocalStorage()');
    assert.ok(runtime.saved.has('financialForecastData'));
    runtime.run("showPlanDialog = async () => ''");
    await runtime.run('clearLocalStorage()');
    assert.equal(runtime.saved.has('financialForecastData'), false);
    assert.equal(runtime.run('scenarioManager.scenarios.length'), 1);
    assert.equal(runtime.run('state.accounts.length'), embedded.accounts.length);
});

test('range presets select exact calendar durations and reject invalid ranges', () => {
    const runtime = createRuntime();
    runtime.run(`chartInstance = {options:{scales:{y:{min:1,max:10},y1:{min:1,max:10}}},scales:{}};
        updateChartView = () => {};`);
    for (const months of [12, 36, 60, 120]) {
        runtime.run(`setForecastRange(${months})`);
        assert.equal(runtime.run('currentViewStart.toISOString().slice(0,10)'), '2026-10-27');
        assert.equal(runtime.run('currentViewEnd.getFullYear()'), 2026 + months / 12);
        assert.equal(runtime.run('currentViewEnd.getMonth()'), 9);
    }
    assert.equal(runtime.run('chartInstance.options.scales.y.min'), undefined);
    const previousEnd = runtime.run('currentViewEnd.getTime()');
    runtime.run('setForecastRange(-1)');
    assert.equal(runtime.run('currentViewEnd.getTime()'), previousEnd);
    assert.ok(runtime.messages.some(message => message.includes('supported forecast range')));
});

test('date nudges clamp month ends and preserve change notifications', () => {
    const runtime = createRuntime();
    let changes = 0;
    const input = { value: '2028-01-31', dispatchEvent: () => changes++ };
    runtime.elements.set('item_start_date', input);
    runtime.run("nudgeDate('item','start_date','month',1)");
    assert.equal(input.value, '2028-02-29');
    assert.equal(changes, 1);
});

test('focus restoration does not call text-selection APIs on numeric inputs', () => {
    const runtime = createRuntime();
    let focused = false;
    runtime.elements.set('balance', {
        focus: () => { focused = true; },
        setSelectionRange: () => { throw new Error('Unsupported on number inputs'); }
    });
    runtime.run("applyUIState({openIds: new Set(), focusedId:'balance', selectionStart:null, selectionEnd:null})");
    assert.equal(focused, true);
});

test('scenario creation and rename accept in-app dialog results and respect cancellation', async () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.run(`ensureDefaultScenario(); renderScenarioBar = () => {};
        showPlanDialog = async () => 'What if';`);
    await runtime.run('addScenario()');
    assert.equal(runtime.run('getActiveScenarioRecord().name'), 'What if');
    runtime.run("showPlanDialog = async () => 'New name'");
    await runtime.run('renameScenario(scenarioManager.activeScenarioId)');
    assert.equal(runtime.run('getActiveScenarioRecord().name'), 'New name');
    runtime.run('showPlanDialog = async () => null');
    await runtime.run('addScenario()');
    assert.equal(runtime.run('scenarioManager.scenarios.length'), 2);
});

test('JSON export prepares a downloadable active-plan backup without clipboard support', async () => {
    const runtime = createRuntime();
    runtime.load();
    let clicked = false;
    let blob;
    const anchor = { click: () => { clicked = true; } };
    runtime.context.Blob = Blob;
    runtime.context.URL = {
        createObjectURL: value => { blob = value; return 'blob:forecast-test'; },
        revokeObjectURL() {}
    };
    runtime.context.navigator = {};
    runtime.context.document.createElement = () => anchor;
    runtime.context.document.body = { appendChild() {}, removeChild() {} };
    const exported = runtime.run("exportToJSON('all')");
    assert.equal(clicked, true);
    assert.match(anchor.download, /^financial-forecast-all-.*\.json$/);
    assert.equal(blob.type, 'application/json');
    assert.equal(await blob.text(), exported);
    assert.deepEqual(JSON.parse(exported).accounts, embedded.accounts);
});

test('date markers simplify only beyond the documented zoom thresholds', () => {
    const runtime = createRuntime();
    runtime.load();
    runtime.context.document.body = { classList: { contains: () => false } };
    const markersAt = years => runtime.run(`currentViewEnd = new Date(currentViewStart.getTime() + ${years} * 365.25 * 86400000);
        generateVerticalLines(FULL_START_DATE, FULL_END_DATE).map(marker => marker.id)`);
    assert.ok(markersAt(2).some(id => id.startsWith('tx-marker-')));
    assert.equal(markersAt(2 + 1 / 365.25).some(id => id.startsWith('tx-marker-')), false);
    assert.ok(markersAt(6).some(id => id.startsWith('quarter-')));
    const annualOnly = markersAt(6 + 1 / 365.25);
    assert.equal(annualOnly.some(id => id.startsWith('quarter-')), false);
    assert.ok(annualOnly.every(id => id.startsWith('year-')));
});
