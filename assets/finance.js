// --- Date Helpers ---
const toYMD = (date) => { const d = new Date(date); const y = d.getUTCFullYear(); const m = (d.getUTCMonth() + 1).toString().padStart(2, '0'); const day = d.getUTCDate().toString().padStart(2, '0'); return `${y}-${m}-${day}`; };
const parseYMD = (s) => { if (!s || typeof s !== 'string') return null; const p = s.split('-').map(Number); if (p.length !== 3 || p.some(isNaN)) return null; const [y, m, d] = p; return new Date(Date.UTC(y, m - 1, d)); };
const addMonths = (d, m) => { const date = new Date(d); date.setUTCMonth(date.getUTCMonth() + m); return date; };
const getLastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// Midnight-UTC for a given local Date (or for now, when called with no arg)
const startOfDayUTC = (d = new Date()) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const todayUTC = () => startOfDayUTC();
const escapeHtml = (s) => { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
const formatMonthYear = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
};
const formatCurrency = (v, unitId = 'usd') => {
    const num = parseFloat(v);
    if (isNaN(num)) return '0.00';

    const unit = state.units.find(u => u.id === unitId) || state.units.find(u => u.isDefault);
    if (!unit) return num.toFixed(2);

    if (unitId === 'usd' || unit.symbol === '$') {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    } else {
        return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit.symbol}`;
    }
};

let priceTargetIdCounter = 0;

const generatePriceTargetId = () => `pt_${Date.now()}_${priceTargetIdCounter++}`;

const isValidPriceTarget = (target) => {
    if (!target || typeof target !== 'object') return false;
    if (!Number.isFinite(target.usdRate)) return false;
    if (!target.date || typeof target.date !== 'string') return false;
    const parsedDate = parseYMD(target.date) || new Date(target.date);
    return !!(parsedDate && !Number.isNaN(parsedDate.getTime()));
};

const normalizeUnitPriceTargets = (unit) => {
    if (!unit) return;
    if (!unit.activeScenario) unit.activeScenario = 'Base';
    if (!Array.isArray(unit.priceTargets)) {
        unit.priceTargets = [];
        return;
    }
    unit.priceTargets = unit.priceTargets
        .filter(target => target && typeof target === 'object')
        .map(target => {
            if (!target.id) {
                target.id = generatePriceTargetId();
            }
            if (!target.scenario) {
                target.scenario = 'Base';
            }
            if (target.usdRate !== null && target.usdRate !== undefined) {
                const numericRate = parseFloat(target.usdRate);
                target.usdRate = Number.isFinite(numericRate) ? numericRate : null;
            } else {
                target.usdRate = null;
            }
            if (typeof target.date !== 'string') {
                target.date = '';
            }
            return target;
        });
};

const createPriceTarget = (unit, overrides = {}) => {
    const baseRate = Number.isFinite(overrides.usdRate)
        ? overrides.usdRate
        : (Number.isFinite(unit?.usdRate) ? unit.usdRate : null);
    return {
        id: generatePriceTargetId(),
        date: typeof overrides.date === 'string' ? overrides.date : '',
        usdRate: Number.isFinite(baseRate) ? baseRate : null,
        scenario: overrides.scenario || unit?.activeScenario || 'Base'
    };
};

function sortUnitPriceTargets(unit) {
    if (!unit || !Array.isArray(unit.priceTargets)) {
        return;
    }
    unit.priceTargets.sort((a, b) => {
        const validA = isValidPriceTarget(a);
        const validB = isValidPriceTarget(b);
        if (!validA && !validB) return 0;
        if (!validA) return 1;
        if (!validB) return -1;
        const dateA = parseYMD(a.date) || new Date(a.date);
        const dateB = parseYMD(b.date) || new Date(b.date);
        const timeA = dateA.getTime();
        const timeB = dateB.getTime();
        if (timeA !== timeB) {
            return timeA - timeB;
        }
        return (a.usdRate ?? 0) - (b.usdRate ?? 0);
    });
}

const getEffectiveUsdRate = (unitId, date = null) => {
    if (!unitId || unitId === 'usd') return 1;
    const unit = state.units.find(u => u.id === unitId);
    if (!unit) return 1;

    normalizeUnitPriceTargets(unit);

    let effectiveRate = Number.isFinite(unit.usdRate) ? unit.usdRate : 1;

    if (!unit.growthEnabled) return effectiveRate;

    if (Array.isArray(unit.priceTargets) && unit.priceTargets.length > 0 && date) {
        const comparisonDate = (date instanceof Date) ? date : parseYMD(date) || new Date(date);
        if (!Number.isNaN(comparisonDate?.getTime?.())) {
            const targetTime = comparisonDate.getTime();

            // Get all valid targets sorted by date
            const activeScenario = unit.activeScenario || 'Base';
            const validTargets = unit.priceTargets
                .filter(t => isValidPriceTarget(t) && (t.scenario || 'Base') === activeScenario)
                .map(target => ({
                    time: (parseYMD(target.date) || new Date(target.date)).getTime(),
                    rate: target.usdRate
                }))
                .sort((a, b) => a.time - b.time);

            if (validTargets.length === 0) {
                return effectiveRate;
            }

            // Find the two targets we're between (or before/after all targets)
            let beforeTarget = null;
            let afterTarget = null;

            for (let i = 0; i < validTargets.length; i++) {
                if (validTargets[i].time <= targetTime) {
                    beforeTarget = validTargets[i];
                } else {
                    afterTarget = validTargets[i];
                    break;
                }
            }

            // If we're before all targets, interpolate between base rate and first target
            if (!beforeTarget && afterTarget) {
                // We need a reference time for the base rate
                // Use "today" as the reference point for the base usdRate
                const todayTime = todayUTC().getTime();

                const totalTimeDiff = afterTarget.time - todayTime;
                const currentTimeDiff = targetTime - todayTime;

                if (totalTimeDiff > 0 && currentTimeDiff >= 0) {
                    const fraction = currentTimeDiff / totalTimeDiff;
                    effectiveRate = effectiveRate + (afterTarget.rate - effectiveRate) * fraction;
                }

                return effectiveRate;
            }

            // If we're after all targets, apply growth rate from the last target
            if (!afterTarget) {
                if (beforeTarget.time === targetTime) {
                    return beforeTarget.rate;
                }

                // Apply annual growth rate after the last target
                const growthRate = Number.isFinite(unit.growthRate) ? unit.growthRate : 0;
                if (growthRate !== 0) {
                    const timeDiffMs = targetTime - beforeTarget.time;
                    const yearsDiff = timeDiffMs / (365.25 * 24 * 60 * 60 * 1000);
                    effectiveRate = beforeTarget.rate * Math.pow(1 + growthRate / 100, yearsDiff);
                    return effectiveRate;
                }

                return beforeTarget.rate;
            }

            // If exactly on a target
            if (beforeTarget.time === targetTime) {
                return beforeTarget.rate;
            }

            // Linear interpolation between beforeTarget and afterTarget
            const totalTimeDiff = afterTarget.time - beforeTarget.time;
            const currentTimeDiff = targetTime - beforeTarget.time;
            const fraction = currentTimeDiff / totalTimeDiff;

            effectiveRate = beforeTarget.rate + (afterTarget.rate - beforeTarget.rate) * fraction;
        }
    }

    return effectiveRate;
};

const convertToUSD = (amount, unitId, date = null) => {
    if (amount == null) return 0;
    const rate = getEffectiveUsdRate(unitId, date);
    return amount * rate;
};

const getUnitSignature = (unitId) => {
    const unit = state.units.find(u => u.id === unitId);
    if (!unit) {
        return `${unitId || 'usd'}:1`;
    }
    normalizeUnitPriceTargets(unit);
    const rate = Number.isFinite(unit.usdRate) ? unit.usdRate : 1;
    const targetsSignature = Array.isArray(unit.priceTargets)
        ? unit.priceTargets
            .filter(isValidPriceTarget)
            .map(t => `${t.id}:${t.date}:${t.usdRate}`)
            .join('|')
        : '';
    return `${unit.id}:${rate}:${targetsSignature}`;
};

const getUnitOptions = () => {
    return state.units.map(u => u.id);
};

const getUnitOptionsForDisplay = () => {
    return state.units.map(u => ({ value: u.id, display: u.symbol }));
};

function applyAccountDelta(accountEntry, date, dayIndex, deltaUsd) {
    if (!accountEntry || !Number.isFinite(deltaUsd)) {
        return;
    }
    const rate = getEffectiveUsdRate(accountEntry.units, date);
    const divisor = rate !== 0 ? rate : 1;
    const deltaNative = divisor !== 0 ? (deltaUsd / divisor) : 0;
    accountEntry.nativeBalance[dayIndex] += deltaNative;
    accountEntry.balance[dayIndex] = convertToUSD(accountEntry.nativeBalance[dayIndex], accountEntry.units, date);
}

// --- Vertical Line Helpers ---
function generateVerticalLines(startDate, endDate) {
    const lines = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const visibleYears = (currentViewEnd - currentViewStart) / (365.25 * 86400000);

    // Generate annual lines (January 1st of each year) - darker and thicker
    for (let year = start.getFullYear(); year <= end.getFullYear() + 1; year++) {
        const yearDate = new Date(year, 0, 1); // January 1st
        if (yearDate >= start && yearDate <= end) {
            lines.push({
                id: `year-${year}`,
                type: 'line',
                xMin: yearDate,
                xMax: yearDate,
                borderColor: 'rgba(23, 107, 88, 0.3)',
                borderWidth: 1,
                borderDash: [8, 4],
                label: {
                    content: year.toString(),
                    display: false
                }
            });
        }
    }

    // Generate quarterly lines (April 1, July 1, October 1) - lighter and thinner
    // Note: January 1 is already covered by annual lines
    const quarterlyMonths = [3, 6, 9]; // April, July, October (skipping January)
    for (let year = start.getFullYear(); visibleYears <= 6 && year <= end.getFullYear(); year++) {
        quarterlyMonths.forEach((month, index) => {
            const quarterDate = new Date(year, month, 1);
            if (quarterDate >= start && quarterDate <= end) {
                lines.push({
                    id: `quarter-${year}-${month}`,
                    type: 'line',
                    xMin: quarterDate,
                    xMax: quarterDate,
                    borderColor: 'rgba(180, 140, 50, 0.28)',
                    borderWidth: 1,
                    borderDash: [6, 4],
                    label: {
                        content: `Q${index + 2}`, // Q2, Q3, Q4 (Q1 is January 1st, covered by annual)
                        display: false
                    }
                });
            }
        });
    }

    // Dense recurring dates obscure the balance lines at long horizons.
    if (visibleYears > 2) return lines;

    // Add low-visibility markers for visible transaction dates.
    const txDateSet = new Set();
    state.transactions
        .filter(tx => tx?.isEnabled && state.transactionPlotOptions[tx.id] !== false)
        .forEach(txData => {
            const txInstance = new Transaction(txData);
            txInstance.generateDates(end).forEach(({ date }) => {
                if (date >= start && date <= end) {
                    txDateSet.add(toYMD(date));
                }
            });
        });

    const txLineColor = isDarkModeActive() ? 'rgba(203, 213, 225, 0.25)' : 'rgba(73, 80, 87, 0.18)';
    [...txDateSet]
        .sort()
        .forEach((ymd, idx) => {
            const txDate = parseYMD(ymd);
            if (!txDate) return;
            lines.push({
                id: `tx-marker-${idx}`,
                type: 'line',
                xMin: txDate,
                xMax: txDate,
                borderColor: txLineColor,
                borderWidth: 1.35,
                borderDash: [3, 4],
                label: {
                    display: false
                }
            });
        });

    return lines;
}

function getMinCashAnnotation(dates, balances) {
    const cashData = balances['Cash'];
    if (!cashData || !dates || dates.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let minIdx = -1;
    for (let i = 0; i < cashData.length; i++) {
        const v = cashData[i];
        if (typeof v === 'number' && v < min) {
            min = v;
            minIdx = i;
        }
    }
    if (minIdx < 0) return null;
    const minDate = dates[minIdx] instanceof Date ? dates[minIdx] : new Date(dates[minIdx]);
    return [
        {
            type: 'line',
            xMin: minDate,
            xMax: minDate,
            borderColor: 'rgba(220, 53, 69, 0.45)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: {
                content: 'Min Cash',
                display: false
            }
        },
        {
            type: 'line',
            yMin: min,
            yMax: min,
            borderColor: 'rgba(220, 53, 69, 0.45)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: {
                content: formatCurrency(min, 'usd'),
                display: false
            }
        }
    ];
}

// --- Financial Logic ---
class Transaction {
    constructor(data) {
        Object.assign(this, data);
        this.start_date = data.start_date ? parseYMD(data.start_date) : null;
        this.end_date = data.end_date ? parseYMD(data.end_date) : null;
    }
    getAmount(date) {
        if (!this.start_date) return convertToUSD(this.amount, this.units || 'usd', date);
        const y = (date.getUTCFullYear() - this.start_date.getUTCFullYear()) + (date.getUTCMonth() - this.start_date.getUTCMonth()) / 12;
        const b = (this.split_amount == null || (date.getUTCMonth() + 1) < this.split_month) ? this.amount : this.split_amount;
        const growth = this.annual_growth || 1.0; // Default to 1.0 if undefined
        const result = b * (growth ** Math.max(0, y));
        return convertToUSD(result, this.units || 'usd', date);
    }
    generateDates(endForecast) {
        // Check cache first - include amount in cache key since it can change
        const unitSignature = getUnitSignature(this.units || 'usd');
        const cacheKey = `${this.id || this.name}-${this.type}-${this.amount}-${unitSignature}-${toYMD(this.start_date)}-${this.end_date ? toYMD(this.end_date) : 'none'}-${toYMD(endForecast)}-${cacheVersion}`;

        if (transactionDateCache.has(cacheKey)) {
            return transactionDateCache.get(cacheKey);
        }

        const dates = [];
        if (!this.start_date || !endForecast) {
            console.warn(`Transaction ${this.name}: Missing start_date or endForecast`);
            transactionDateCache.set(cacheKey, dates);
            return dates;
        }
        const forecast_end = endForecast;

        switch (this.type) {
            case 'OneTime': {
                if (this.start_date <= forecast_end && (!this.end_date || this.start_date <= this.end_date)) {
                    dates.push({ date: this.start_date, amount: this.getAmount(this.start_date) });
                }
                break;
            }
            case 'Monthly': {
                if (!this.day_of_month) {
                    console.warn(`Monthly transaction ${this.name}: Missing day_of_month`);
                    break;
                }
                let currentDate = new Date(this.start_date); currentDate.setUTCDate(1);
                while (currentDate <= forecast_end) { const y = currentDate.getUTCFullYear(); const m = currentDate.getUTCMonth(); const day = Math.min(this.day_of_month, getLastDayOfMonth(y, m)); let c = new Date(Date.UTC(y, m, day)); if (c >= this.start_date && c <= forecast_end && (!this.end_date || c <= this.end_date)) { dates.push({ date: c, amount: this.getAmount(c) }); } currentDate = addMonths(currentDate, 1); }
                break;
            }
            case 'Weekly': {
                if (this.day_of_week === undefined || this.day_of_week === null) {
                    console.warn(`Weekly transaction ${this.name}: Missing day_of_week`);
                    break;
                }
                let currentDate = new Date(this.start_date); while (currentDate.getUTCDay() !== this.day_of_week) { currentDate.setUTCDate(currentDate.getUTCDate() + 1); }
                while (currentDate <= forecast_end) { if (currentDate >= this.start_date && (!this.end_date || currentDate <= this.end_date)) { dates.push({ date: new Date(currentDate), amount: this.getAmount(currentDate) }); } currentDate.setUTCDate(currentDate.getUTCDate() + 7); }
                break;
            }
            case 'BiWeekly': {
                if (!this.days_of_month) {
                    console.warn(`BiWeekly transaction ${this.name}: Missing days_of_month`);
                    break;
                }
                let year = this.start_date.getUTCFullYear(); let month = this.start_date.getUTCMonth();
                while (new Date(Date.UTC(year, month, 1)) <= forecast_end) { let days = this.days_of_month; if (typeof days === 'string') days = days.split(',').map(d => d.trim() === 'last' ? 'last' : parseInt(d.trim(), 10)); for (const day of days) { let c; if (day === 'last') { c = new Date(Date.UTC(year, month + 1, 0)); } else { const n = parseInt(day, 10); if (isNaN(n)) continue; const l = getLastDayOfMonth(year, month); if (n > l) continue; c = new Date(Date.UTC(year, month, n)); } if (c >= this.start_date && c <= forecast_end && (!this.end_date || c <= this.end_date)) { dates.push({ date: c, amount: this.getAmount(c) }); } } month++; if (month > 11) { month = 0; year++; } }

                break;
            }
            case 'Annual': {
                if (!this.day_of_month || !this.month_of_year) {
                    console.warn(`Annual transaction ${this.name}: Missing day_of_month or month_of_year`);
                    break;
                }
                let year = this.start_date.getUTCFullYear(); const m = this.month_of_year - 1;
                while (true) { const day = Math.min(this.day_of_month, getLastDayOfMonth(year, m)); let c = new Date(Date.UTC(year, m, day)); if (c > forecast_end) break; if (c >= this.start_date && (!this.end_date || c <= this.end_date)) { dates.push({ date: c, amount: this.getAmount(c) }); } year++; }
                break;
            }
            case 'Quarterly': {
                // Business quarters: Q1=Jan1, Q2=Apr1, Q3=Jul1, Q4=Oct1
                const quarterStartMonths = [0, 3, 6, 9]; // January, April, July, October
                let year = this.start_date.getUTCFullYear();
                const endYear = forecast_end.getUTCFullYear();

                while (year <= endYear) {
                    quarterStartMonths.forEach(month => {
                        const quarterDate = new Date(Date.UTC(year, month, 1));
                        if (quarterDate >= this.start_date && quarterDate <= forecast_end && (!this.end_date || quarterDate <= this.end_date)) {
                            dates.push({ date: quarterDate, amount: this.getAmount(quarterDate) });
                        }
                    });
                    year++;
                }

                break;
            }
            default:
                console.warn(`Unknown transaction type: ${this.type}`);
        }

        // Cache the results
        transactionDateCache.set(cacheKey, dates);

        return dates;
    }
}

// --- Global State ---
let state = {
    settings: {},
    accounts: [],
    loans: [],
    transactions: [],
    units: [
        { id: 'usd', name: 'USD', symbol: '$', usdRate: 1.0, isDefault: true, growthEnabled: true, priceTargets: [] }
    ],
    plotOptions: {},
    transactionPlotOptions: {},
    accountGroups: [],
    loanGroups: [],
    transactionGroups: []
};
const SCENARIO_STORAGE_KEY = 'financialForecastScenarios';
let applyToAll = false;
// Blocks Apply-to-all sync while a scenario switch is settling through the debounce chain
let _inScenarioSwitch = false;
let _scenarioSwitchTimer = null;

function setApplyToAll(value) {
    applyToAll = !!value;
    const toggle = document.getElementById('apply-to-all-toggle');
    if (toggle) toggle.checked = applyToAll;
}

// Copy the current working snapshot's items into every non-active scenario,
// preserving each scenario's own state for any items that don't exist in current.
function syncSnapshotToAllScenarios(currentSnap) {
    const collections = ['accounts', 'loans', 'transactions', 'units'];
    const groupCollections = ['accountGroups', 'loanGroups', 'transactionGroups'];

    for (const scenario of scenarioManager.scenarios) {
        if (scenario.id === scenarioManager.activeScenarioId) continue;
        const snap = scenario.snapshot;

        // For each collection, overwrite items by ID; add new; remove deleted
        for (const coll of collections) {
            const currentItems = currentSnap[coll] || [];
            const currentById = new Map(currentItems.map(i => [i.id, i]));
            const existing = snap[coll] || [];
            const existingIds = new Set(existing.map(i => i.id));

            // Items that exist in both: overwrite with current version
            // Items only in current: add them
            // Items only in existing: remove (they were deleted in active scenario)
            snap[coll] = currentItems.map(i => cloneData(i));
        }

        // Groups and plot options propagate wholesale
        for (const coll of groupCollections) {
            snap[coll] = cloneData(currentSnap[coll]);
        }
        snap.plotOptions = cloneData(currentSnap.plotOptions);
        snap.transactionPlotOptions = cloneData(currentSnap.transactionPlotOptions);
        scenario.updatedAt = currentSnap.timestamp;
    }
}

let scenarioManager = {
    activeScenarioId: null,
    scenarios: []
};
let chartInstance = null;
let datasetColorMap = new Map(); // Persistent color mapping for datasets

// Data cache system - separate data generation from chart manipulation
let dataCache = {
    balances: null,
    dates: null,
    itemsToPlot: null,
    rightAxisItems: null,
    lastCacheHash: null,
    isValid: false
};

const DEFAULT_DATA_FALLBACK_FILENAME = 'financial-forecast-all-2026-02-18T15-42-53-838Z.json';



function resolveDefaultDataPath() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('data')) {
        return decodeURIComponent(params.get('data'));
    }
    const meta = document.querySelector('meta[name="default-data-path"]');
    if (meta && meta.content) {
        return meta.content.trim();
    }
    return DEFAULT_DATA_FALLBACK_FILENAME;
}

async function loadDefaultDataFromFile(path) {
    if (!path || window.location.protocol === 'file:') {
        return null;
    }
    try {
        const response = await fetch(path, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn(`Failed to load default data from "${path}". If you are opening this file directly from disk, try serving it via a local web server (e.g., python -m http.server).`, error);
        return null;
    }
}

function applyImportedData(importData) {
    if (!importData || typeof importData !== 'object') {
        return { applied: false };
    }

    // Deep-clone all imported collections to break any aliasing with the source object
    if (Array.isArray(importData.accounts)) {
        state.accounts = cloneData(importData.accounts);
    }

    if (Array.isArray(importData.loans)) {
        state.loans = cloneData(importData.loans);
    }

    if (Array.isArray(importData.transactions)) {
        state.transactions = cloneData(importData.transactions);
    }

    if (Array.isArray(importData.fees)) {
        state.fees = cloneData(importData.fees);
    }

    if (Array.isArray(importData.units)) {
        state.units = cloneData(importData.units);
    }

    if (Array.isArray(importData.accountGroups)) {
        state.accountGroups = cloneData(importData.accountGroups);
    }

    if (Array.isArray(importData.loanGroups)) {
        state.loanGroups = cloneData(importData.loanGroups);
    }

    if (Array.isArray(importData.transactionGroups)) {
        state.transactionGroups = cloneData(importData.transactionGroups);
    }

    if (importData.plotOptions && typeof importData.plotOptions === 'object') {
        state.plotOptions = cloneData(importData.plotOptions);
    }
    if (importData.transactionPlotOptions && typeof importData.transactionPlotOptions === 'object') {
        state.transactionPlotOptions = cloneData(importData.transactionPlotOptions);
    }

    if (importData.viewRange && importData.viewRange.start && importData.viewRange.end) {
        const importedStart = new Date(importData.viewRange.start);
        const importedEnd = new Date(importData.viewRange.end);
        if (!Number.isNaN(importedStart.getTime()) && !Number.isNaN(importedEnd.getTime())) {
            currentViewStart = importedStart;
            currentViewEnd = importedEnd;
        }
    }

    state.yAxisFrozen = importData.yAxisFrozen || null;
    if (typeof importData.netWorthVisible === 'boolean') showNetWorth = importData.netWorthVisible;
    if (typeof importData.netWorthRightAxis === 'boolean') netWorthRightAxis = importData.netWorthRightAxis;

    // Ensure required collections exist even if not provided
    if (!Array.isArray(state.accounts)) state.accounts = [];
    if (!Array.isArray(state.loans)) state.loans = [];
    if (!Array.isArray(state.transactions)) state.transactions = [];
    if (!Array.isArray(state.fees)) state.fees = [];
    if (!Array.isArray(state.units) || state.units.length === 0) {
        state.units = [{ id: 'usd', name: 'USD', symbol: '$', usdRate: 1.0, isDefault: true, growthEnabled: true, priceTargets: [] }];
    }
    if (state.units.length > 0 && !state.units.some(u => u.isDefault)) {
        state.units[0].isDefault = true;
    }
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
    if (!Array.isArray(state.loanGroups)) state.loanGroups = [];
    if (!Array.isArray(state.transactionGroups)) state.transactionGroups = [];
    if (!state.plotOptions || typeof state.plotOptions !== 'object') {
        state.plotOptions = {};
    }
    if (!state.transactionPlotOptions || typeof state.transactionPlotOptions !== 'object') {
        state.transactionPlotOptions = {};
    }
    if (Object.keys(state.plotOptions).length === 0) {
        const cashAccount = state.accounts.find(acc => acc.name === 'Cash');
        if (cashAccount) {
            state.plotOptions[cashAccount.name] = true;
        }
    }

    // Normalize account data
    state.accounts.forEach(acc => {
        if (!acc.units) {
            acc.units = 'usd';
        }
        if (acc.saleDate === undefined) {
            acc.saleDate = '';
        }
    });

    state.units.forEach(unit => {
        normalizeUnitPriceTargets(unit);
        sortUnitPriceTargets(unit);
        // Ensure growthRate exists
        if (unit.growthRate === undefined || unit.growthRate === null) {
            unit.growthRate = 0;
        }
        if (unit.growthEnabled === undefined) {
            unit.growthEnabled = true;
        }
    });

    // Normalize loans
    state.loans.forEach(loan => {
        if (loan.isEnabled === undefined) {
            loan.isEnabled = true;
        }
        if (loan.linkedAccountId === undefined) {
            loan.linkedAccountId = '';
        }
    });

    // Normalize transactions
    state.transactions.forEach(tx => {
        if (tx.isEnabled === undefined) {
            tx.isEnabled = true;
        }
        if (!tx.units) {
            tx.units = 'usd';
        }
        if (tx.linkedAccountId === undefined) {
            tx.linkedAccountId = '';
        }
        if (state.transactionPlotOptions[tx.id] === undefined) {
            state.transactionPlotOptions[tx.id] = true;
        }
    });

    return {
        applied: true,
        openSections: importData.openSections || null
    };
}

function captureOpenSections() {
    const openSections = {};
    document.querySelectorAll('details.section-collapsible').forEach(details => {
        if (details.id) {
            openSections[details.id] = details.open;
        }
    });
    return openSections;
}

function buildSerializableState() {
    return {
        accounts: cloneData(state.accounts),
        loans: cloneData(state.loans),
        transactions: cloneData(state.transactions),
        fees: cloneData(state.fees),
        units: cloneData(state.units),
        accountGroups: cloneData(state.accountGroups),
        loanGroups: cloneData(state.loanGroups),
        transactionGroups: cloneData(state.transactionGroups),
        plotOptions: cloneData(state.plotOptions),
        transactionPlotOptions: cloneData(state.transactionPlotOptions),
        yAxisFrozen: state.yAxisFrozen || null,
        netWorthVisible: showNetWorth,
        netWorthRightAxis: netWorthRightAxis,
        viewRange: {
            start: currentViewStart.toISOString(),
            end: currentViewEnd.toISOString()
        },
        openSections: captureOpenSections(),
        timestamp: new Date().toISOString()
    };
}

function normalizeScenarioRegistry(rawRegistry) {
    const registry = {
        activeScenarioId: null,
        scenarios: []
    };

    if (!rawRegistry || typeof rawRegistry !== 'object') {
        return registry;
    }

    const rawScenarios = Array.isArray(rawRegistry.scenarios) ? rawRegistry.scenarios : [];
    registry.scenarios = rawScenarios
        .filter(scenario => scenario && typeof scenario === 'object' && scenario.snapshot && typeof scenario.snapshot === 'object')
        .map(scenario => ({
            id: typeof scenario.id === 'string' && scenario.id ? scenario.id : genId('scenario'),
            name: typeof scenario.name === 'string' && scenario.name.trim() ? scenario.name.trim() : 'Untitled Scenario',
            createdAt: typeof scenario.createdAt === 'string' ? scenario.createdAt : (typeof scenario.updatedAt === 'string' ? scenario.updatedAt : new Date().toISOString()),
            updatedAt: typeof scenario.updatedAt === 'string' ? scenario.updatedAt : new Date().toISOString(),
            snapshot: cloneData(scenario.snapshot)
        }));

    if (typeof rawRegistry.activeScenarioId === 'string' && registry.scenarios.some(scenario => scenario.id === rawRegistry.activeScenarioId)) {
        registry.activeScenarioId = rawRegistry.activeScenarioId;
    } else {
        registry.activeScenarioId = registry.scenarios[0]?.id || null;
    }

    return registry;
}

function saveScenarioRegistry() {
    try {
        localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(scenarioManager));
        return true;
    } catch (error) {
        console.error('Failed to save scenario registry:', error);
        setSaveStatus('Not saved - export a backup', 'error');
        showToast('Could not save your scenarios on this device. Export a backup before leaving.', 'error', 6000);
        return false;
    }
}

function loadScenarioRegistry() {
    try {
        const stored = localStorage.getItem(SCENARIO_STORAGE_KEY);
        if (!stored) {
            scenarioManager = normalizeScenarioRegistry(null);
            return false;
        }
        scenarioManager = normalizeScenarioRegistry(JSON.parse(stored));
        return scenarioManager.scenarios.length > 0;
    } catch (error) {
        console.error('Failed to load scenario registry:', error);
        scenarioManager = normalizeScenarioRegistry(null);
        return false;
    }
}

function getActiveScenarioRecord() {
    if (!scenarioManager || !Array.isArray(scenarioManager.scenarios)) {
        return null;
    }
    return scenarioManager.scenarios.find(scenario => scenario.id === scenarioManager.activeScenarioId) || null;
}

function applyScenarioSnapshot(snapshot) {
    // Block Apply-to-all for the entire debounce chain (250ms recalc + 1000ms save = 1250ms)
    _inScenarioSwitch = true;
    clearTimeout(_scenarioSwitchTimer);
    _scenarioSwitchTimer = setTimeout(() => { _inScenarioSwitch = false; }, 1500);
    // Preserve current graph bounds — switching scenarios should not move the zoom
    const savedStart = currentViewStart;
    const savedEnd = currentViewEnd;
    // Preserve Y-axis freeze state — scenario switches don't change freeze behavior
    const savedYAxisFrozen = state.yAxisFrozen;
    const { applied, openSections } = applyImportedData(snapshot);
    if (!applied) {
        _inScenarioSwitch = false;
        clearTimeout(_scenarioSwitchTimer);
        return false;
    }
    currentViewStart = savedStart;
    currentViewEnd = savedEnd;
    state.yAxisFrozen = savedYAxisFrozen;
    // If not frozen, clear any stale axis bounds the snapshot may have carried
    if (!state.yAxisFrozen && chartInstance) {
        clearAxisRange(chartInstance, 'y');
        clearAxisRange(chartInstance, 'y1');
    }
    restoreOpenSections(openSections);
    renderAll();
    recalculateAndDraw();
    return true;
}

// Ensure at least one scenario exists (creates "Default" from current state if needed)
function ensureDefaultScenario() {
    if (!Array.isArray(scenarioManager.scenarios) || scenarioManager.scenarios.length === 0) {
        const snap = buildSerializableState();
        const def = { id: genId('scenario'), name: 'Default', createdAt: snap.timestamp, updatedAt: snap.timestamp, snapshot: snap };
        scenarioManager.scenarios = [def];
        scenarioManager.activeScenarioId = def.id;
        saveScenarioRegistry();
    } else if (!scenarioManager.activeScenarioId || !scenarioManager.scenarios.some(s => s.id === scenarioManager.activeScenarioId)) {
        scenarioManager.activeScenarioId = scenarioManager.scenarios[0].id;
        saveScenarioRegistry();
    }
}

// Switch to a scenario by id — loads its snapshot into working state
function switchToScenario(scenarioId) {
    if (scenarioId === scenarioManager.activeScenarioId) return;
    const record = scenarioManager.scenarios.find(s => s.id === scenarioId);
    if (!record) return;
    // Flush the departing scenario synchronously before any timer can be cancelled
    const departing = getActiveScenarioRecord();
    if (departing) {
        const snap = buildSerializableState();
        departing.snapshot = snap;
        departing.updatedAt = snap.timestamp;
    }
    scenarioManager.activeScenarioId = scenarioId;
    saveScenarioRegistry();
    applyScenarioSnapshot(record.snapshot); // calls renderAll → renderScenarioBar
}

// Add a new scenario as a copy of the current working state, then switch to it
async function addScenario() {
    const base = 'Scenario';
    const existing = new Set(scenarioManager.scenarios.map(s => s.name));
    let n = scenarioManager.scenarios.length + 1;
    let suggested = `${base} ${n}`;
    while (existing.has(suggested)) { n++; suggested = `${base} ${n}`; }
    const typed = await showPlanDialog({ title: 'Explore a new scenario', message: 'Start with a copy of your current plan, then try a different path.', initialValue: suggested, confirmLabel: 'Create scenario' });
    if (typed === null) return; // cancelled
    const name = typed.trim() || suggested;
    const snap = buildSerializableState();
    const newRec = { id: genId('scenario'), name, createdAt: snap.timestamp, updatedAt: snap.timestamp, snapshot: snap };
    scenarioManager.scenarios.push(newRec);
    scenarioManager.activeScenarioId = newRec.id;
    saveScenarioRegistry();
    renderScenarioBar();
    showToast(`Created scenario "${name}"`, 'success');
}

// Rename a scenario (double-click on pill)
async function renameScenario(scenarioId) {
    const record = scenarioManager.scenarios.find(s => s.id === scenarioId);
    if (!record) return;
    const newName = await showPlanDialog({ title: 'Rename your scenario', initialValue: record.name, confirmLabel: 'Rename' });
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === record.name) return;
    record.name = trimmed;
    record.updatedAt = new Date().toISOString();
    saveScenarioRegistry();
    renderScenarioBar();
}

// Delete a scenario (must keep at least one)
async function deleteScenario(scenarioId) {
    if (scenarioManager.scenarios.length <= 1) { showToast('You must keep at least one scenario.', 'info'); return; }
    const record = scenarioManager.scenarios.find(s => s.id === scenarioId);
    if (!record) return;
    if (await showPlanDialog({ title: 'Delete this scenario?', message: `"${record.name}" will be removed from this browser. Your other scenarios will stay.`, confirmLabel: 'Delete scenario', danger: true }) === null) return;
    const wasActive = scenarioId === scenarioManager.activeScenarioId;
    scenarioManager.scenarios = scenarioManager.scenarios.filter(s => s.id !== scenarioId);
    if (wasActive) {
        scenarioManager.activeScenarioId = scenarioManager.scenarios[0].id;
        saveScenarioRegistry();
        applyScenarioSnapshot(scenarioManager.scenarios[0].snapshot);
        return;
    }
    saveScenarioRegistry();
    renderScenarioBar();
}

// Render the always-visible scenario pill bar at the top of the sidebar
function renderScenarioBar() {
    const bar = document.getElementById('scenario-bar');
    if (!bar) return;
    const restoreFocus = bar.contains(document.activeElement);
    const scenarios = scenarioManager.scenarios;
    const activeId = scenarioManager.activeScenarioId;
    const canDelete = scenarios.length > 1;
    bar.innerHTML = scenarios.map(s => {
        const isActive = s.id === activeId;
        const delBtn = canDelete
            ? `<button type="button" class="scenario-pill-del" onclick="deleteScenario('${s.id}')" title="Delete scenario" aria-label="Delete ${escapeHtml(s.name)}">&times;</button>`
            : '';
        return `<span class="scenario-entry"><button type="button" role="tab" tabindex="${isActive ? '0' : '-1'}" class="scenario-pill${isActive ? ' active' : ''}" onclick="switchToScenario('${s.id}')" ondblclick="event.stopPropagation();renameScenario('${s.id}')" title="${escapeHtml(s.name)} — double-click to rename" aria-selected="${isActive}">${escapeHtml(s.name)}</button>${delBtn}</span>`;
    }).join('') + `<button type="button" class="scenario-pill-add" onclick="addScenario()" title="New scenario (copy of current)" aria-label="Create scenario from current plan">+</button>`;
    syncWorkspaceUI();
    if (restoreFocus) bar.querySelector('[aria-selected="true"]')?.focus();
}

function restoreOpenSections(openSections) {
    if (!openSections || typeof openSections !== 'object') {
        return;
    }
    setTimeout(() => {
        Object.entries(openSections).forEach(([sectionId, isOpen]) => {
            const section = document.getElementById(sectionId);
            if (section) {
                section.open = isOpen;
            }
        });
    }, 50);
}

function cloneData(data) {
    if (typeof structuredClone === 'function') {
        return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data));
}

// Stable, collision-resistant id factory. Combines a timestamp with a random suffix
// so rapid successive calls within the same millisecond don't collide.
function genId(prefix) {
    const rand = Math.random().toString(36).slice(2, 11);
    return `${prefix}_${Date.now()}_${rand}`;
}

// Lightweight non-blocking toast. Replaces alert() for transient feedback.
// kind: 'info' | 'success' | 'error'
function showToast(message, kind = 'info', durationMs = 2400) {
    const container = document.getElementById('toast-container');
    if (!container) {
        // Fall back to console if container is not in the DOM
        if (kind === 'error') console.error(message);
        else console.log(message);
        return;
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    container.appendChild(toast);
    // Force a layout so the transition triggers
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 220);
    }, durationMs);
}

const THEME_STORAGE_KEY = 'financialForecastTheme';

function getDuplicateName(originalName, defaultLabel = 'Untitled') {
    const base = (originalName && typeof originalName === 'string') ? originalName.trim() : defaultLabel;
    const copyPattern = /^(.*?)(?:\s\((?:copy)(?:\s(\d+))?\))$/i;
    const match = base.match(copyPattern);
    if (!match) {
        return `${base} (copy)`;
    }
    const label = match[1].trim();
    const currentNumber = match[2] ? parseInt(match[2], 10) : 1;
    const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 2;
    return `${label} (copy ${nextNumber})`;
}

function getStoredTheme() {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') {
            return stored;
        }
    } catch (error) {
        console.warn('Unable to read stored theme preference:', error);
    }
    return null;
}

function isDarkModeActive() {
    return document.body.classList.contains('dark-mode');
}

function updateModeToggleButton(theme) {
    const btn = document.getElementById('mode-toggle-btn');
    if (!btn) {
        return;
    }
    const isDark = theme === 'dark';
    btn.classList.toggle('dark', isDark);
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

function updateChartTheme(isDark) {
    if (!chartInstance) {
        return;
    }
    chartInstance.data.datasets.forEach(dataset => {
        if (dataset._netWorth) dataset.borderColor = isDark ? '#8ad2b5' : '#176b58';
    });
    const axisColor = isDark ? '#d1d5db' : '#374151';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.25)';
    if (chartInstance.options.scales.x) {
        chartInstance.options.scales.x.ticks.color = axisColor;
        if (chartInstance.options.scales.x.grid) {
            chartInstance.options.scales.x.grid.color = gridColor;
        }
    }
    if (chartInstance.options.scales.y) {
        chartInstance.options.scales.y.ticks.color = axisColor;
        if (chartInstance.options.scales.y.grid) {
            chartInstance.options.scales.y.grid.color = gridColor;
        }
    }
    if (chartInstance.options.scales.y1) {
        chartInstance.options.scales.y1.ticks.color = axisColor;
        if (chartInstance.options.scales.y1.grid) {
            chartInstance.options.scales.y1.grid.color = gridColor;
        }
    }
    if (chartInstance.options.plugins && chartInstance.options.plugins.legend && chartInstance.options.plugins.legend.labels) {
        chartInstance.options.plugins.legend.labels.color = axisColor;
    }
    if (chartInstance.options.plugins && chartInstance.options.plugins.tooltip) {
        chartInstance.options.plugins.tooltip.backgroundColor = isDark ? '#1f2937' : '#f9fafb';
        chartInstance.options.plugins.tooltip.titleColor = isDark ? '#f3f4f6' : '#111827';
        chartInstance.options.plugins.tooltip.bodyColor = isDark ? '#e5e7eb' : '#1f2937';
    }
}

function applyTheme(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode', normalized === 'dark');
    try {
        localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (error) {
        console.warn('Unable to persist theme preference:', error);
    }
    updateModeToggleButton(normalized);
    updateChartTheme(normalized === 'dark');
    if (chartInstance) {
        chartInstance.update('none');
    }
}

function toggleTheme() {
    const nextTheme = isDarkModeActive() ? 'light' : 'dark';
    applyTheme(nextTheme);
}

function initializeTheme() {
    let theme = getStoredTheme();
    if (!theme && window.matchMedia) {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(theme || 'light');
}

// Generate a hash to determine if we need to regenerate data
function generateDataHash() {
    const hashData = {
        accounts: state.accounts.map(a => ({
            name: a.name,
            balance: a.balance,
            annual_growth: a.annual_growth,
            units: a.units,
            rightAxis: a.rightAxis,
            saleDate: a.saleDate || ''
        })),
        loans: state.loans.map(l => ({
            name: l.name,
            initial_balance: l.initial_balance,
            monthly_payment: l.monthly_payment,
            interest_rate: l.interest_rate,
            start_date: l.start_date,
            payoff_date: l.payoff_date,
            early_payoff_date: l.early_payoff_date,
            day_of_month: l.day_of_month,
            rightAxis: l.rightAxis,
            isEnabled: l.isEnabled
        })),
        transactions: state.transactions.map(t => ({
            name: t.name,
            type: t.type,
            amount: t.amount,
            units: t.units,
            from_account: t.from_account,
            to_account: t.to_account,
            start_date: t.start_date,
            end_date: t.end_date,
            day_of_month: t.day_of_month,
            days_of_month: t.days_of_month,
            day_of_week: t.day_of_week,
            month_of_year: t.month_of_year,
            annual_growth: t.annual_growth,
            isEnabled: t.isEnabled,
            linkedAccountId: t.linkedAccountId || ''
        })),
        fees: state.fees.map(f => ({
            name: f.name,
            assetId: f.assetId || '',
            feeType: f.feeType,
            amount: f.amount
        })),
        units: state.units.map(u => ({
            id: u.id,
            usdRate: u.usdRate,
            growthRate: u.growthRate,
            growthEnabled: u.growthEnabled,
            priceTargets: (u.priceTargets || []).map(pt => `${pt.date}:${pt.price}`).join(',')
        })),
        dateRange: {
            start: FULL_START_DATE.getTime(),
            end: FULL_END_DATE.getTime()
        }
    };
    return JSON.stringify(hashData);
}

// Get or generate cached data
function getCachedData() {
    const currentHash = generateDataHash();

    if (dataCache.isValid && dataCache.lastCacheHash === currentHash) {
        return dataCache;
    }

    // Regenerate data
    performanceProfile.start('Data Generation');
    const calculatedData = calculateBalances();
    performanceProfile.end('Data Generation');

    // Update cache
    dataCache = {
        ...calculatedData,
        lastCacheHash: currentHash,
        isValid: true
    };

    return dataCache;
}

// Invalidate cache when data changes
function invalidateDataCache() {
    dataCache.isValid = false;
}

// Date range management - Dynamic dates based on today
const today = new Date();
const FULL_START_DATE = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
const FULL_END_DATE = new Date(Date.UTC(today.getFullYear() + 30, today.getMonth(), today.getDate()));
let currentViewStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())); // Default to today
let currentViewEnd = new Date(Date.UTC(today.getFullYear() + 5, today.getMonth(), today.getDate()));   // Default 5-year view
let isManualZoom = false; // Flag to prevent feedback loops

// Initialize with zoom plugin registration
document.addEventListener('DOMContentLoaded', () => {
    // Register the zoom and annotation plugins
    if (window.Chart && window.ChartZoom) {
        Chart.register(window.ChartZoom);
    } else {
        console.warn('Chart.js or zoom plugin not available');
    }

    if (window.Chart && window['chartjs-plugin-annotation']) {
        Chart.register(window['chartjs-plugin-annotation']);
    } else {
        console.warn('Chart.js or annotation plugin not available');
    }

    initializeTheme();

    initialize().catch(error => {
        console.error('Failed to initialize application:', error);
        const banner = document.getElementById('app-error');
        banner.textContent = 'The forecast could not load. Check your connection and reload. Your existing saved data has not been cleared.';
        banner.hidden = false;
    });
});

// --- UI Rendering & State Persistence ---
function getUIState() {
    const openIds = new Set([...document.querySelectorAll('details[data-id][open]')].map(element => element.dataset.id));
    const focused = document.activeElement;
    return {
        openIds,
        focusedId: focused?.id,
        selectionStart: focused?.selectionStart,
        selectionEnd: focused?.selectionEnd
    };
}

function applyUIState({ openIds, focusedId, selectionStart, selectionEnd }) {
    for (const id of openIds) {
        const details = document.querySelector(`details[data-id="${id}"]`);
        if (details) details.open = true;
    }
    const focused = focusedId && document.getElementById(focusedId);
    if (!focused) return;
    focused.focus({ preventScroll: true });
    if (typeof focused.setSelectionRange === 'function' &&
        typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        focused.setSelectionRange(selectionStart, selectionEnd);
    }
}
const FIELD_LABELS = {
    annual_growth: 'Annual growth (1.04 = 4%)',
    interest_rate: 'Interest rate (0.05 = 5%)',
    usdRate: 'USD per unit',
    start_date: 'Start date',
    end_date: 'End date',
    payoff_date: 'Scheduled payoff date',
    early_payoff_date: 'Early payoff date',
    saleDate: 'Sale date',
    day_of_month: 'Day of month',
    from_account: 'From account',
    to_account: 'To account'
};

function createField(item, key, type = 'text', options = []) {
    const v = item[key] == null ? '' : item[key];
    const label = FIELD_LABELS[key] || key.replace(/_/g, ' ');
    if (type === 'select') {
        let h;
        if (key === 'units') {
            // Special handling for units to show symbols instead of IDs
            h = state.units.map(u => `<option value="${u.id}" ${v === u.id ? 'selected' : ''}>${u.symbol}</option>`).join('');
        } else {
            // Handle both string arrays and object arrays with value/label
            h = options.map(o => {
                if (typeof o === 'object' && o.value !== undefined && o.label !== undefined) {
                    return `<option value="${o.value}" ${v === o.value ? 'selected' : ''}>${o.label}</option>`;
                } else {
                    return `<option value="${o}" ${v === o ? 'selected' : ''}>${o}</option>`;
                }
            }).join('');
        }
        return `<div><label for="${item.id}_${key}">${label}</label><select id="${item.id}_${key}" data-id="${item.id}" data-key="${key}">${h}</select></div>`;
    }
    if (type === 'date') {
        return `<div><label for="${item.id}_${key}">${label}</label><div class="date-field-row"><input type="${type}" id="${item.id}_${key}" data-id="${item.id}" data-key="${key}" value="${escapeHtml(v)}"><div class="date-nudge-group"><div class="date-nudge-row"><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'month', -1)" title="Minus 1 month">\u22121m</button><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'week', -1)" title="Minus 1 week">\u22121w</button><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'day', -1)" title="Minus 1 day">\u22121d</button><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'day', 1)" title="Plus 1 day">+1d</button><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'week', 1)" title="Plus 1 week">+1w</button><button type="button" class="btn-nudge" onclick="nudgeDate('${item.id}', '${key}', 'month', 1)" title="Plus 1 month">+1m</button></div><div class="date-nudge-row"><button type="button" class="btn-today" onclick="setDateToToday('${item.id}', '${key}')" title="Set to today">Today</button><button type="button" class="btn-nudge btn-clear-date" onclick="clearDate('${item.id}', '${key}')" title="Clear date">Clear</button></div></div></div></div>`;
    }
    return `<div><label for="${item.id}_${key}">${label}</label><input type="${type}" id="${item.id}_${key}" data-id="${item.id}" data-key="${key}" value="${escapeHtml(v)}"></div>`;
}
function setDateToToday(itemId, key) {
    const input = document.getElementById(`${itemId}_${key}`);
    if (!input) return;
    input.value = toYMD(new Date());
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function clearDate(itemId, key) {
    const input = document.getElementById(`${itemId}_${key}`);
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function nudgeDate(itemId, key, unit, amount) {
    const input = document.getElementById(`${itemId}_${key}`);
    if (!input) return;
    // Parse existing YYYY-MM-DD value; fall back to today if empty/invalid
    let base = new Date();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((input.value || '').trim());
    if (m) {
        base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    if (unit === 'day') {
        base.setDate(base.getDate() + amount);
    } else if (unit === 'week') {
        base.setDate(base.getDate() + amount * 7);
    } else if (unit === 'month') {
        const targetDay = base.getDate();
        base.setDate(1);
        base.setMonth(base.getMonth() + amount);
        // Clamp to last valid day of the resulting month (e.g. Jan 31 -> Feb 28)
        const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        base.setDate(Math.min(targetDay, lastDay));
    }
    input.value = toYMD(base);
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function createCheckboxField(item, key, label) { const v = item[key]; return `<div><label for="${item.id}_${key}"><input type="checkbox" id="${item.id}_${key}" data-id="${item.id}" data-key="${key}" ${v ? 'checked' : ''}> ${label}</label></div>`; }
function renderUnits() {
    let html = '';
    state.units.forEach(unit => {
        normalizeUnitPriceTargets(unit);
        sortUnitPriceTargets(unit);
        html += `<details data-id="${unit.id}" data-type="unit">
            <summary>
                <span class="summary-name" title="${escapeHtml(unit.name)} (${escapeHtml(unit.symbol)})">${escapeHtml(unit.name)} (${escapeHtml(unit.symbol)})</span>
                <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8em; font-weight: normal; cursor: pointer; white-space: nowrap; overflow: visible; min-width: 0; color: var(--text-secondary, #6c757d);" onclick="event.stopPropagation()" title="Enable/disable growth and price targets">
                    <input type="checkbox" class="toggle-switch summary-checkbox"
                           data-id="${unit.id}" data-key="growthEnabled"
                           ${unit.growthEnabled ? 'checked' : ''}>
                    Growth
                </label>
                <span class="summary-info">
                    <input type="text"
                           data-id="${unit.id}"
                           data-key="usdRate"
                           data-type="number"
                           value="${unit.usdRate.toFixed(2)}"
                           readonly
                           title="Click to edit USD exchange rate">
                </span>
                ${!unit.isDefault ? `<button title="Delete" class="btn-delete-icon" data-delete-id="${unit.id}" data-type="unit">&times;</button>` : '<div style="width: 24px;"></div>'}
            </summary>
            <div class="details-content">
                ${!unit.isDefault ? `
                <div class="unit-quick-actions">
                    <button type="button" class="btn-sell-unit" data-sell-unit="${unit.id}" title="Open the Sell modal to record a sale of ${escapeHtml(unit.name)} shares">
                        💸 Sell ${escapeHtml(unit.symbol || unit.name)}…
                    </button>
                    <span class="unit-quick-hint">Records a sale transaction at the price implied by your active scenario on the chosen date.</span>
                </div>` : ''}
                <div class="form-grid">
                    ${createField(unit, 'name')}
                    ${createField(unit, 'symbol')}
                    ${createField(unit, 'usdRate', 'number')}
                    <div><label for="${unit.id}_growthRate">growth rate (% per year)</label><input type="number" id="${unit.id}_growthRate" data-id="${unit.id}" data-key="growthRate" value="${unit.growthRate != null ? unit.growthRate : 0}" step="0.1" ${!unit.growthEnabled ? 'disabled' : ''}></div>
                </div>
                <div class="price-targets">
                    <div class="price-targets-header">Price Targets</div>
                    ${(() => {
                        const activeScenario = unit.activeScenario || 'Base';
                        const scenarios = [...new Set(unit.priceTargets.map(t => t.scenario || 'Base').concat(activeScenario))];
                        const scenarioTargets = unit.priceTargets.filter(t => (t.scenario || 'Base') === activeScenario);
                        return `
                    <div class="scenario-tabs">
                        ${scenarios.map(s => `<button type="button" class="scenario-tab ${s === activeScenario ? 'active' : ''}" data-switch-scenario="${unit.id}" data-scenario="${escapeHtml(s)}" title="${escapeHtml(s)}">${escapeHtml(s)}${scenarios.length > 1 ? `<span class="scenario-delete" data-delete-scenario="${unit.id}" data-scenario="${escapeHtml(s)}" title="Delete scenario">&times;</span>` : ''}</button>`).join('')}
                        <button type="button" class="scenario-tab-add" data-duplicate-scenario="${unit.id}" title="Duplicate scenario" ${!unit.growthEnabled ? 'disabled' : ''}>⧉</button>
                        <button type="button" class="scenario-tab-add" data-add-scenario="${unit.id}" title="Add scenario" ${!unit.growthEnabled ? 'disabled' : ''}>+</button>
                    </div>
                    <div class="price-targets-rows">
                        ${scenarioTargets.map((target, index) => {
                            const dateValue = target?.date ? target.date : '';
                            const rateValue = target?.usdRate != null ? target.usdRate : '';
                            const dateId = `${unit.id}_price_date_${target.id}`;
                            const rateId = `${unit.id}_price_rate_${target.id}`;
                            return `
                            <div class="price-target-row">
                                <input type="date" id="${dateId}" aria-label="Target ${index + 1} date" data-id="${unit.id}" data-key="priceTargetDate" data-target-id="${target.id}" value="${dateValue}" ${!unit.growthEnabled ? 'disabled' : ''}>
                                <input type="number" id="${rateId}" aria-label="Target ${index + 1} price in USD" step="0.0001" data-id="${unit.id}" data-key="priceTargetRate" data-target-id="${target.id}" value="${rateValue}" ${!unit.growthEnabled ? 'disabled' : ''}>
                                <button type="button" class="price-target-remove" data-remove-price-target="${unit.id}" data-target-id="${target.id}" title="Remove price target" ${!unit.growthEnabled ? 'disabled' : ''}>&times;</button>
                            </div>`;
                        }).join('')}
                    </div>`;
                    })()}
                    <button type="button" class="btn-add" data-add-price-target="${unit.id}" style="margin-top: 8px;" ${!unit.growthEnabled ? 'disabled' : ''}>+ Add Price Target</button>
                </div>
            </div>
        </details>`;
    });

    document.getElementById('units-list').innerHTML = html;
}
function renderAccounts() {
    const ungroupedAccounts = state.accounts.filter(acc => !getItemGroup('account', acc.id));

    let html = '';
    const renderOrder = [];

    // If no groups, render all ungrouped items in their array order
    if (state.accountGroups.length === 0) {
        ungroupedAccounts.forEach(acc => {
            renderOrder.push({ type: 'item', item: acc });
        });
    } else {
        // For mixed group/item rendering, maintain the relative positions
        // by interleaving based on the actual indices in the state arrays
        const allElements = [];

        // Add ungrouped accounts with their position indices
        ungroupedAccounts.forEach(acc => {
            const originalIndex = state.accounts.findIndex(a => a.id === acc.id);
            const position = acc.positionIndex !== undefined ? acc.positionIndex : originalIndex;
            allElements.push({
                type: 'item',
                item: acc,
                originalIndex: position
            });
        });

        // Add groups with their stored position indices
        state.accountGroups.forEach((group, groupIndex) => {
            // Use stored position or calculate a default position
            let groupPosition = group.positionIndex;
            if (groupPosition === undefined) {
                // Default positioning: distribute groups evenly among accounts
                const totalAccounts = state.accounts.length;
                const totalGroups = state.accountGroups.length;
                groupPosition = (groupIndex + 1) * (totalAccounts / (totalGroups + 1));
                group.positionIndex = groupPosition; // Store for future use
            }

            allElements.push({
                type: 'group',
                item: group,
                originalIndex: groupPosition
            });
        });

        // Sort by original index to maintain proper ordering
        allElements.sort((a, b) => a.originalIndex - b.originalIndex);

        // Build render order from sorted elements
        allElements.forEach(element => {
            renderOrder.push({ type: element.type, item: element.item });
        });
    }

    // Render in the computed order
    html = '';

    renderOrder.forEach(element => {
        if (element.type === 'group') {
            const group = element.item;
            const groupAccounts = group.items.map(id => state.accounts.find(a => a.id === id)).filter(Boolean);

            // Calculate group checkbox state - checked if ALL items are plotted
            const allItemsPlotted = groupAccounts.length > 0 && groupAccounts.every(acc => state.plotOptions[acc.name]);

            html += `
                <div class="group-container draggable-item" draggable="true" data-group-id="${group.id}" data-group-type="account" data-type="group" data-id="${group.id}">
                    <div class="group-header" onclick="toggleGroup('account', '${group.id}')">
                        <div class="group-header-left">
                            <input type="checkbox" class="eye-toggle group-checkbox"
                                   ${allItemsPlotted ? 'checked' : ''}
                                   onclick="event.stopPropagation(); toggleGroupItems('account', '${group.id}', this.checked)"
                                   title="Show/hide all items in group">
                            <div class="group-name">
                                <input type="text" value="${group.name}"
                                       onclick="event.stopPropagation()"
                                       onchange="updateGroupName('account', '${group.id}', this.value)"
                                       onblur="updateGroupName('account', '${group.id}', this.value)">
                            </div>
                        </div>
                        <div class="group-header-right">
                            <span class="group-toggle">${group.collapsed ? '▶' : '▼'}</span>
                            <button class="group-add" onclick="event.stopPropagation(); addAccount('${group.id}')" title="Add Account to Group">+</button>
                            <button class="group-duplicate" onclick="event.stopPropagation(); duplicateGroup('account', '${group.id}')" title="Duplicate Group">⧉</button>
                            <button class="group-delete" onclick="event.stopPropagation(); removeGroup('account', '${group.id}')" title="Delete Group">&times;</button>
                        </div>
                    </div>
                    <div class="group-contents ${group.collapsed ? 'collapsed' : ''}">
                        ${groupAccounts.map(acc =>
                            `<details data-id="${acc.id}" class="draggable-item" draggable="true" data-type="account">
                                <summary>
                                    <span class="summary-toggles">
                                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-item="${acc.name}" ${state.plotOptions[acc.name] ? 'checked' : ''} title="Show/Hide on chart">
                                        <input type="checkbox" class="axis-toggle" data-id="${acc.id}" data-key="rightAxis" ${acc.rightAxis ? 'checked' : ''} title="Right Y-Axis">
                                    </span>
                                    <span class="summary-name" data-summary-field="name" title="${acc.name}">${acc.name}${accSaleBadge(acc)}</span>
                                    <span class="summary-info">
                                        <input type="text"
                                               data-id="${acc.id}"
                                               data-key="balance"
                                               data-type="number"
                                               value="${formatCurrency(acc.balance, acc.units)}"
                                               readonly
                                               title="Click to edit balance">
                                    </span>
                                    <button title="Delete" class="btn-delete-icon" data-delete-id="${acc.id}" data-type="account">&times;</button>
                                </summary>
                                <div class="details-content">
                                    <div class="form-grid">
                                        ${createField(acc, 'name')}
                                        ${createField(acc, 'balance', 'number')}
                                        ${createField(acc, 'annual_growth', 'number')}
                                        ${createField(acc, 'units', 'select', getUnitOptions())}
                                        ${createField(acc, 'tags')}
                                        ${createField(acc, 'saleDate', 'date')}
                                    </div>
                                </div>
                            </details>`
                        ).join('')}
                    </div>
                </div>
            `;
        } else {
            // Render individual account
            const acc = element.item;
            html += `<details data-id="${acc.id}" class="draggable-item" draggable="true" data-type="account">
                <summary>
                    <span class="summary-toggles">
                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-item="${acc.name}" ${state.plotOptions[acc.name] ? 'checked' : ''} title="Show/Hide on chart">
                        <input type="checkbox" class="axis-toggle" data-id="${acc.id}" data-key="rightAxis" ${acc.rightAxis ? 'checked' : ''} title="Right Y-Axis">
                    </span>
                    <span class="summary-name" data-summary-field="name" title="${acc.name}">${acc.name}${accSaleBadge(acc)}</span>
                    <span class="summary-info">
                        <input type="text"
                               data-id="${acc.id}"
                               data-key="balance"
                               data-type="number"
                               value="${formatCurrency(acc.balance, acc.units)}"
                               readonly
                               title="Click to edit balance">
                    </span>
                    <button title="Delete" class="btn-delete-icon" data-delete-id="${acc.id}" data-type="account">&times;</button>
                </summary>
                <div class="details-content">
                    <div class="form-grid">
                        ${createField(acc, 'name')}
                        ${createField(acc, 'balance', 'number')}
                        ${createField(acc, 'annual_growth', 'number')}
                        ${createField(acc, 'units', 'select', getUnitOptions())}
                        ${createField(acc, 'tags')}
                        ${createField(acc, 'saleDate', 'date')}
                    </div>
                </div>
            </details>`;
        }
    });

    document.getElementById('accounts-list').innerHTML = html;
}
function formatPayoffShort(dateStr) {
    const d = parseYMD(dateStr);
    if (!d) return '';
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}
function isFutureDate(dateStr) {
    const d = parseYMD(dateStr);
    if (!d) return false;
    return d > todayUTC();
}
function formatLoanRate(rate) {
    if (!rate || rate <= 0) return '';
    const pct = rate * 100;
    // Up to 3 decimals, strip trailing zeros
    let s = pct.toFixed(3);
    s = s.replace(/\.?0+$/, '');
    return `${s}%`;
}
function buildLoanSubtitleParts(loan) {
    const parts = [];
    const rateStr = formatLoanRate(loan.interest_rate);
    if (rateStr) parts.push(rateStr);
    if (isFutureDate(loan.start_date)) parts.push(`Starts ${formatPayoffShort(loan.start_date)}`);
    const early = loan.early_payoff_date ? formatPayoffShort(loan.early_payoff_date) : '';
    const regular = loan.payoff_date ? formatPayoffShort(loan.payoff_date) : '';
    if (early && regular) parts.push(`Payoff ${regular}, Early ${early}`);
    else if (early) parts.push(`Early Payoff ${early}`);
    else if (regular) parts.push(`Payoff ${regular}`);
    return parts;
}
function buildTxSubtitleParts(tx) {
    const parts = [];
    if (isFutureDate(tx.start_date)) parts.push(`${tx.type === 'OneTime' ? 'On' : 'Starts'} ${formatPayoffShort(tx.start_date)}`);
    if (tx.end_date) parts.push(`Ends ${formatPayoffShort(tx.end_date)}`);
    return parts;
}
function subtitleHtml(parts) {
    return parts.length ? `<span class="payoff-subtitle">${parts.join(' · ')}</span>` : '';
}
// Rebuild the .payoff-subtitle inside an existing summary-name element (live updates)
function rebuildSubtitleDOM(id, parts) {
    const summaryNameEl = document.querySelector(`details[data-id="${id}"] .summary-name`);
    if (!summaryNameEl) return;
    const existing = summaryNameEl.querySelector('.payoff-subtitle');
    if (existing) existing.remove();
    if (parts.length) {
        const span = document.createElement('span');
        span.className = 'payoff-subtitle';
        span.textContent = parts.join(' · ');
        summaryNameEl.appendChild(span);
    }
}
function loanSummaryName(loan) {
    return `<span class="summary-name" data-summary-field="name" title="${loan.name}">${loan.name}${subtitleHtml(buildLoanSubtitleParts(loan))}</span>`;
}
function getLoanCurrentBalance(loan) {
    const startDate = parseYMD(loan.start_date);
    if (!startDate) return loan.initial_balance || 0;
    const today = todayUTC();
    if (startDate >= today) return loan.initial_balance || 0;
    // Use daily compounding for consistency with the forecast chart
    const dailyRate = (loan.interest_rate || 0) / 365.25;
    const payment = loan.monthly_payment || 0;
    const dayOfMonth = loan.day_of_month || 1;
    let balance = loan.initial_balance || 0;
    // Walk payment-cycle by payment-cycle from start_date to today
    let d = new Date(startDate);
    while (d < today && balance > 0) {
        // Compute next payment date strictly after d
        let nextPayMonth = d.getUTCMonth();
        let nextPayYear = d.getUTCFullYear();
        let lastDay = getLastDayOfMonth(nextPayYear, nextPayMonth);
        let payDay = Math.min(dayOfMonth, lastDay);
        let nextPayDate = new Date(Date.UTC(nextPayYear, nextPayMonth, payDay));
        if (nextPayDate <= d) {
            // Move to next month
            nextPayMonth += 1;
            if (nextPayMonth > 11) { nextPayMonth = 0; nextPayYear++; }
            lastDay = getLastDayOfMonth(nextPayYear, nextPayMonth);
            payDay = Math.min(dayOfMonth, lastDay);
            nextPayDate = new Date(Date.UTC(nextPayYear, nextPayMonth, payDay));
        }
        const segmentEnd = nextPayDate <= today ? nextPayDate : today;
        const days = Math.max(0, Math.round((segmentEnd - d) / 86400000));
        if (days > 0 && dailyRate > 0) {
            balance *= Math.pow(1 + dailyRate, days);
        }
        if (nextPayDate <= today) {
            balance = Math.max(0, balance - payment);
            d = nextPayDate;
        } else {
            break;
        }
    }
    return Math.max(0, balance);
}
function updateLoanCurrentBalanceEl(id, loan) {
    const container = document.querySelector(`details[data-id="${id}"] .summary-info-stacked`);
    if (!container) return;
    let el = container.querySelector('.loan-current-balance');
    const currentBal = getLoanCurrentBalance(loan);
    const showCurrent = currentBal !== (loan.initial_balance || 0);
    if (showCurrent) {
        if (!el) {
            el = document.createElement('span');
            el.className = 'loan-current-balance';
            el.title = 'Estimated balance today';
            container.appendChild(el);
        }
        el.textContent = formatCurrency(currentBal);
    } else if (el) {
        el.remove();
    }
}
function getTypeIndicator(type, tx) {
    const indicators = {
        'Monthly': { text: 'M', class: 'monthly' },
        'Weekly': { text: 'W', class: 'weekly' },
        'BiWeekly': { text: 'BiW', class: 'biweekly' },
        'OneTime': { text: '1', class: 'onetime' },
        'Annual': { text: 'A', class: 'annual' },
        'Quarterly': { text: 'Q', class: 'quarterly' }
    };
    const indicator = indicators[type] || { text: '?', class: 'onetime' };
    if (type === 'OneTime' && tx && tx.start_date) {
        const d = parseYMD(tx.start_date);
        if (d) {
            indicator.text = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
        }
    }
    return `<span class="transaction-type-indicator ${indicator.class}" title="${type}">${indicator.text}</span>`;
}
// Returns true when a transaction's activity window is entirely before today
function isTxFullyPast(tx) {
    const today = todayUTC();
    if (tx.type === 'OneTime') {
        const d = parseYMD(tx.start_date);
        return !!(d && d < today);
    }
    // Recurring: only fully past when an end_date exists and has passed
    if (tx.end_date) {
        const d = parseYMD(tx.end_date) || new Date(tx.end_date);
        return !!(d && !isNaN(d.getTime()) && d < today);
    }
    return false;
}
function accSaleBadge(acc) {
    if (!acc.saleDate) return '';
    return `<span class="acc-sale-badge" title="Scheduled sale: ${escapeHtml(acc.saleDate)}">→ ${escapeHtml(acc.saleDate)}</span>`;
}
function txContingentBadge(tx) {
    if (!tx.linkedAccountId) return '';
    const acc = state.accounts.find(a => a.id === tx.linkedAccountId);
    if (!acc) return '';
    const soldLabel = acc.saleDate ? ` → sold ${acc.saleDate}` : '';
    return `<span class="tx-contingent-badge" title="Stops when ${escapeHtml(acc.name)} is sold">&#x26D3; ${escapeHtml(acc.name)}${escapeHtml(soldLabel)}</span>`;
}
function txSummaryName(tx) {
    return `<span class="summary-name" data-summary-field="name" title="${tx.name}">${getTypeIndicator(tx.type, tx)}${tx.name}${txContingentBadge(tx)}${subtitleHtml(buildTxSubtitleParts(tx))}</span>`;
}
function renderFees() {
    let html = '';

    if (state.fees.length === 0) {
        html = '<p style="color: #999; font-size: 0.9em;">No fees configured. Add fees to reduce cash deposits when assets are sold.</p>';
    } else {
        html = state.fees.map(fee => {
            const asset = state.accounts.find(a => a.id === fee.assetId);
            const assetName = asset ? asset.name : '(deleted)';
            const feeDisplay = fee.feeType === 'percent' ? `${parseFloat(fee.amount || 0)}%` : `$${formatCurrency(parseFloat(fee.amount || 0), 'usd')}`;
            return `<details class="fee-item" data-id="${fee.id}">
                <summary>
                    <span class="summary-name" data-summary-field="name" title="${fee.name}">${escapeHtml(fee.name)}</span>
                    <span class="summary-info" title="${assetName}">${escapeHtml(assetName)}</span>
                    <span class="summary-info">${feeDisplay}</span>
                    <button title="Delete" class="btn-delete-icon" data-delete-id="${fee.id}" data-type="fee">&times;</button>
                </summary>
                <div class="details-content">
                    <div class="form-grid">
                        ${createField(fee, 'name')}
                        ${createField(fee, 'assetId', 'select', [
                            { value: '', label: '-- Select Asset --' },
                            ...state.accounts.filter(a => a.saleDate).map(a => ({ value: a.id, label: a.name }))
                        ])}
                        ${createField(fee, 'feeType', 'select', [
                            { value: 'percent', label: 'Percent (%)' },
                            { value: 'fixed', label: 'Fixed ($)' }
                        ])}
                        ${createField(fee, 'amount', 'number')}
                    </div>
                </div>
            </details>`;
        }).join('');
    }

    html += '<button type="button" class="btn-add" onclick="addFee()" style="margin-top: 12px;">+ Add Fee</button>';
    document.getElementById('fees-list').innerHTML = html;
}
function renderLoans() {
    const ungroupedLoans = state.loans.filter(loan => !getItemGroup('loan', loan.id));

    // Create a unified, ordered list for rendering using positionIndex
    const renderItems = [];

    // Add all groups to render list
    state.loanGroups.forEach((group, index) => {
        const position = group.positionIndex !== undefined ? group.positionIndex : (index * 1000);
        renderItems.push({
            type: 'group',
            item: group,
            order: position
        });
    });

    // Add all ungrouped loans to render list
    ungroupedLoans.forEach((loan) => {
        const originalIndex = state.loans.findIndex(l => l.id === loan.id);
        const position = loan.positionIndex !== undefined ? loan.positionIndex : originalIndex;
        renderItems.push({
            type: 'loan',
            item: loan,
            order: position
        });
    });

    // Sort by order to get final render sequence
    renderItems.sort((a, b) => a.order - b.order);

    // Render all items in order
    let html = '';

    renderItems.forEach(renderItem => {
        if (renderItem.type === 'group') {
            const group = renderItem.item;
            const groupLoans = group.items.map(id => state.loans.find(l => l.id === id)).filter(Boolean);

            // Calculate group checkbox state - checked if ALL items are enabled
            const allItemsEnabled = groupLoans.length > 0 && groupLoans.every(loan => loan.isEnabled);

            html += `
                <div class="group-container draggable-item" draggable="true" data-group-id="${group.id}" data-group-type="loan" data-type="group" data-id="${group.id}">
                    <div class="group-header" onclick="toggleGroup('loan', '${group.id}')">
                        <div class="group-header-left">
                            <input type="checkbox" class="toggle-switch group-checkbox"
                                   ${allItemsEnabled ? 'checked' : ''}
                                   onclick="event.stopPropagation(); toggleGroupItems('loan', '${group.id}', this.checked)"
                                   title="Enable/disable all loans in group">
                            <div class="group-name">
                                <input type="text" value="${group.name}"
                                       onclick="event.stopPropagation()"
                                       onchange="updateGroupName('loan', '${group.id}', this.value)"
                                       onblur="updateGroupName('loan', '${group.id}', this.value)">
                            </div>
                        </div>
                        <div class="group-header-right">
                            <span class="group-toggle">${group.collapsed ? '▶' : '▼'}</span>
                            <button class="group-add" onclick="event.stopPropagation(); addLoan('${group.id}')" title="Add Loan to Group">+</button>
                            <button class="group-duplicate" onclick="event.stopPropagation(); duplicateGroup('loan', '${group.id}')" title="Duplicate Group">⧉</button>
                            <button class="group-delete" onclick="event.stopPropagation(); removeGroup('loan', '${group.id}')" title="Delete Group">&times;</button>
                        </div>
                    </div>
                    <div class="group-contents ${group.collapsed ? 'collapsed' : ''}">
                        ${groupLoans.map(loan => {
                            const currentBal = getLoanCurrentBalance(loan);
                            const showCurrent = currentBal !== (loan.initial_balance || 0);
                            return `<details data-id="${loan.id}" class="draggable-item" draggable="true" data-type="loan">
                                <summary>
                                    <span class="summary-toggles">
                                        <input type="checkbox" class="toggle-switch summary-checkbox" data-enable-loan-id="${loan.id}" ${loan.isEnabled ? 'checked' : ''} title="Enable/Disable">
                                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-item="${loan.name}" ${state.plotOptions[loan.name] ? 'checked' : ''} title="Show/Hide on chart">
                                        <input type="checkbox" class="axis-toggle" data-id="${loan.id}" data-key="rightAxis" ${loan.rightAxis ? 'checked' : ''} title="Right Y-Axis">
                                    </span>
                                    ${loanSummaryName(loan)}
                                    <span class="summary-info summary-info-stacked">
                                        <input type="text"
                                               data-id="${loan.id}"
                                               data-key="initial_balance"
                                               data-type="number"
                                               value="${formatCurrency(loan.initial_balance)}"
                                               readonly
                                               title="Click to edit initial balance">
                                        ${showCurrent ? `<span class="loan-current-balance" title="Estimated balance today">${formatCurrency(currentBal)}</span>` : ''}
                            ${loanEquityBadge(loan)}
                                    </span>
                                    <button title="Delete" class="btn-delete-icon" data-delete-id="${loan.id}" data-type="loan">&times;</button>
                                </summary>
                                <div class="details-content">
                                    <div class="form-grid">
                                        ${createField(loan, 'name')}
                                        ${createField(loan, 'initial_balance', 'number')}
                                        ${createField(loan, 'monthly_payment', 'number')}
                                        ${createField(loan, 'interest_rate', 'number')}
                                        ${createField(loan, 'start_date', 'date')}
                                        ${createField(loan, 'payoff_date', 'date')}
                                        ${createField(loan, 'early_payoff_date', 'date')}
                                        ${createField(loan, 'day_of_month', 'number')}
                                        ${createField(loan, 'tags')}
                                        ${loanLinkedAccountField(loan)}
                                    </div>
                                </div>
                            </details>`
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            // Render individual loan
            const loan = renderItem.item;
            const currentBal3 = getLoanCurrentBalance(loan);
            const showCurrent3 = currentBal3 !== (loan.initial_balance || 0);
            html += `<details data-id="${loan.id}" class="draggable-item" draggable="true" data-type="loan">
                <summary>
                    <span class="summary-toggles">
                        <input type="checkbox" class="toggle-switch summary-checkbox" data-enable-loan-id="${loan.id}" ${loan.isEnabled ? 'checked' : ''} title="Enable/Disable">
                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-item="${loan.name}" ${state.plotOptions[loan.name] ? 'checked' : ''} title="Show/Hide on chart">
                        <input type="checkbox" class="axis-toggle" data-id="${loan.id}" data-key="rightAxis" ${loan.rightAxis ? 'checked' : ''} title="Right Y-Axis">
                    </span>
                    ${loanSummaryName(loan)}
                    <span class="summary-info summary-info-stacked">
                        <input type="text"
                               data-id="${loan.id}"
                               data-key="initial_balance"
                               data-type="number"
                               value="${formatCurrency(loan.initial_balance)}"
                               readonly
                               title="Click to edit initial balance">
                        ${showCurrent3 ? `<span class="loan-current-balance" title="Estimated balance today">${formatCurrency(currentBal3)}</span>` : ''}
                    ${loanEquityBadge(loan)}
                    </span>
                    <button title="Delete" class="btn-delete-icon" data-delete-id="${loan.id}" data-type="loan">&times;</button>
                </summary>
                <div class="details-content">
                    <div class="form-grid">
                        ${createField(loan, 'name')}
                        ${createField(loan, 'initial_balance', 'number')}
                        ${createField(loan, 'monthly_payment', 'number')}
                        ${createField(loan, 'interest_rate', 'number')}
                        ${createField(loan, 'start_date', 'date')}
                        ${createField(loan, 'payoff_date', 'date')}
                        ${createField(loan, 'early_payoff_date', 'date')}
                        ${createField(loan, 'day_of_month', 'number')}
                        ${createField(loan, 'tags')}
                        ${loanLinkedAccountField(loan)}
                    </div>
                </div>
            </details>`;
        }
    });

    document.getElementById('loans-list').innerHTML = html;
}
function renderTransactions() {
    const ungroupedTransactions = state.transactions.filter(tx => !getItemGroup('transaction', tx.id));
    const accountNames = ["",...state.accounts.map(a => a.name), ...state.loans.map(l => l.name)];

    // Create a unified, ordered list for rendering using positionIndex
    const renderItems = [];

    // Add all groups to render list
    state.transactionGroups.forEach((group, index) => {
        const position = group.positionIndex !== undefined ? group.positionIndex : (index * 1000);
        renderItems.push({
            type: 'group',
            item: group,
            order: position
        });
    });

    // Add all ungrouped transactions to render list
    ungroupedTransactions.forEach((tx) => {
        const originalIndex = state.transactions.findIndex(t => t.id === tx.id);
        const position = tx.positionIndex !== undefined ? tx.positionIndex : originalIndex;
        renderItems.push({
            type: 'transaction',
            item: tx,
            order: position
        });
    });

    // Sort by order to get final render sequence
    renderItems.sort((a, b) => a.order - b.order);

    // Render all items in order
    let html = '';

    renderItems.forEach(renderItem => {
        if (renderItem.type === 'group') {
            const group = renderItem.item;
            const groupTransactions = group.items.map(id => state.transactions.find(t => t.id === id)).filter(Boolean);
            const allItemsEnabled = groupTransactions.length > 0 && groupTransactions.every(tx => tx.isEnabled);
            const allItemsVisible = groupTransactions.length > 0 && groupTransactions.every(tx => state.transactionPlotOptions[tx.id] !== false);

            html += `
                <div class="group-container draggable-item" draggable="true" data-group-id="${group.id}" data-group-type="transaction" data-type="group" data-id="${group.id}">
                    <div class="group-header" onclick="toggleGroup('transaction', '${group.id}')">
                        <div class="group-header-left">
                            <span class="summary-toggles">
                                <input type="checkbox" class="toggle-switch group-checkbox"
                                       ${allItemsEnabled ? 'checked' : ''}
                                       onclick="event.stopPropagation(); toggleGroupItems('transaction', '${group.id}', this.checked)"
                                       title="Check/uncheck all items in group">
                                <input type="checkbox" class="eye-toggle group-checkbox"
                                       ${allItemsVisible ? 'checked' : ''}
                                       onclick="event.stopPropagation(); toggleGroupTransactionVisibility('${group.id}', this.checked)"
                                       title="Show/hide transaction markers for this group">
                            </span>
                            <div class="group-name">
                                <input type="text" value="${group.name}"
                                       onclick="event.stopPropagation()"
                                       onchange="updateGroupName('transaction', '${group.id}', this.value)"
                                       onblur="updateGroupName('transaction', '${group.id}', this.value)">
                            </div>
                        </div>
                        <div class="group-header-right">
                            <span class="group-toggle">${group.collapsed ? '▶' : '▼'}</span>
                            <button class="group-add" onclick="event.stopPropagation(); addTransaction('${group.id}')" title="Add Transaction to Group">+</button>
                            <button class="group-duplicate" onclick="event.stopPropagation(); duplicateGroup('transaction', '${group.id}')" title="Duplicate Group">⧉</button>
                            <button class="group-delete" onclick="event.stopPropagation(); removeGroup('transaction', '${group.id}')" title="Delete Group">&times;</button>
                        </div>
                    </div>
                    <div class="group-contents ${group.collapsed ? 'collapsed' : ''}">
                        ${groupTransactions.map(tx => {
                            let typeSpecificFields = '';
                            switch (tx.type) {
                                case 'Monthly': typeSpecificFields = createField(tx, 'day_of_month', 'number'); break;
                                case 'Weekly': typeSpecificFields = createField(tx, 'day_of_week', 'number'); break;
                                case 'BiWeekly': typeSpecificFields = createField(tx, 'days_of_month'); break;
                                case 'Annual': typeSpecificFields = createField(tx, 'day_of_month', 'number') + createField(tx, 'month_of_year', 'number'); break;
                            }

                            return `<details data-id="${tx.id}" class="draggable-item${isTxFullyPast(tx) ? ' tx-stale' : ''}" draggable="true" data-type="transaction">
                                <summary>
                                    <span class="summary-toggles">
                                        <input type="checkbox" class="toggle-switch summary-checkbox" data-enable-tx-id="${tx.id}" ${tx.isEnabled ? 'checked' : ''} title="Enable/Disable">
                                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-tx-id="${tx.id}" ${state.transactionPlotOptions[tx.id] !== false ? 'checked' : ''} title="Show/Hide transaction markers on chart">
                                    </span>
                                    ${txSummaryName(tx)}
                                    <span class="summary-info">
                                        <input type="text" data-id="${tx.id}" data-key="amount" data-type="number" value="${formatCurrency(tx.amount, tx.units)}" readonly title="Click to edit amount">
                                    </span>
                                    <div class="summary-actions">
                                        <button title="Duplicate" class="btn-duplicate-icon" data-duplicate-id="${tx.id}" data-type="transaction">⧉</button>
                                        <button title="Delete" class="btn-delete-icon" data-delete-id="${tx.id}" data-type="transaction">&times;</button>
                                    </div>
                                </summary>
                                <div class="details-content">
                                    <div class="form-grid">
                                        ${createField(tx, 'name')}
                                        ${createField(tx, 'type', 'select', ['OneTime', 'Monthly', 'Weekly', 'BiWeekly', 'Annual', 'Quarterly'])}
                                        ${createField(tx, 'amount', 'number')}
                                        ${createField(tx, 'units', 'select', getUnitOptions())}
                                        ${createField(tx, 'split_amount', 'number')}
                                        ${createField(tx, 'split_month', 'number')}
                                        ${createField(tx, 'start_date', 'date')}
                                        ${createField(tx, 'end_date', 'date')}
                                        ${createField(tx, 'annual_growth', 'number')}
                                        ${createField(tx, 'from_account', 'select', accountNames)}
                                        ${createField(tx, 'to_account', 'select', accountNames)}
                                        ${typeSpecificFields}
                                        ${txLinkedAssetField(tx)}
                                    </div>
                                </div>
                            </details>`;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            // Render individual transaction
            const tx = renderItem.item;
            let typeSpecificFields = '';
            switch (tx.type) {
                case 'Monthly': typeSpecificFields = createField(tx, 'day_of_month', 'number'); break;
                case 'Weekly': typeSpecificFields = createField(tx, 'day_of_week', 'number'); break;
                case 'BiWeekly': typeSpecificFields = createField(tx, 'days_of_month'); break;
                case 'Annual': typeSpecificFields = createField(tx, 'day_of_month', 'number') + createField(tx, 'month_of_year', 'number'); break;
            }

            html += `<details data-id="${tx.id}" class="draggable-item${isTxFullyPast(tx) ? ' tx-stale' : ''}" draggable="true" data-type="transaction">
                <summary>
                    <span class="summary-toggles">
                        <input type="checkbox" class="toggle-switch summary-checkbox" data-enable-tx-id="${tx.id}" ${tx.isEnabled ? 'checked' : ''} title="Enable/Disable">
                        <input type="checkbox" class="eye-toggle summary-checkbox" data-plot-tx-id="${tx.id}" ${state.transactionPlotOptions[tx.id] !== false ? 'checked' : ''} title="Show/Hide transaction markers on chart">
                    </span>
                    ${txSummaryName(tx)}
                    <span class="summary-info">
                        <input type="text" data-id="${tx.id}" data-key="amount" data-type="number" value="${formatCurrency(tx.amount, tx.units)}" readonly title="Click to edit amount">
                    </span>
                    <div class="summary-actions">
                        <button title="Duplicate" class="btn-duplicate-icon" data-duplicate-id="${tx.id}" data-type="transaction">⧉</button>
                        <button title="Delete" class="btn-delete-icon" data-delete-id="${tx.id}" data-type="transaction">&times;</button>
                    </div>
                </summary>
                <div class="details-content">
                    <div class="form-grid">
                        ${createField(tx, 'name')}
                        ${createField(tx, 'type', 'select', ['OneTime', 'Monthly', 'Weekly', 'BiWeekly', 'Annual', 'Quarterly'])}
                        ${createField(tx, 'amount', 'number')}
                        ${createField(tx, 'units', 'select', getUnitOptions())}
                        ${createField(tx, 'split_amount', 'number')}
                        ${createField(tx, 'split_month', 'number')}
                        ${createField(tx, 'start_date', 'date')}
                        ${createField(tx, 'end_date', 'date')}
                        ${createField(tx, 'annual_growth', 'number')}
                        ${createField(tx, 'from_account', 'select', accountNames)}
                        ${createField(tx, 'to_account', 'select', accountNames)}
                        ${typeSpecificFields}
                        ${txLinkedAssetField(tx)}
                    </div>
                </div>
            </details>`;
        }
    });

    document.getElementById('transactions-list').innerHTML = html;
}
function syncNetWorthUI() {
    const btn = document.getElementById('net-worth-btn');
    const axisBtn = document.getElementById('net-worth-axis-btn');
    if (btn) { btn.classList.toggle('active', showNetWorth); btn.setAttribute('aria-pressed', String(showNetWorth)); }
    if (axisBtn) { axisBtn.classList.toggle('active', netWorthRightAxis); axisBtn.classList.toggle('nw-axis-visible', showNetWorth); axisBtn.setAttribute('aria-pressed', String(netWorthRightAxis)); }
}
function renderAll() { const uiState = getUIState(); renderUnits(); renderAccounts(); renderFees(); renderLoans(); renderTransactions(); applyUIState(uiState); renderScenarioBar(); syncNetWorthUI(); }

// Debounced variant — coalesces rapid renderAll() calls (e.g. typing into a name field)
let renderAllTimer = null;
function renderAllDebounced(ms = 250) {
    clearTimeout(renderAllTimer);
    renderAllTimer = setTimeout(() => {
        renderAllTimer = null;
        renderAll();
    }, ms);
}
function addAccount(groupId) {
    const newAccount = {
        id: genId('acc'),
        name: 'New Account',
        balance: 0,
        annual_growth: 1.0,
        units: 'usd',
        tags: '',
        rightAxis: false,
        saleDate: ''
    };

    state.accounts.unshift(newAccount);

    if (groupId) {
        const group = state.accountGroups.find(g => g.id === groupId);
        if (group) {
            group.collapsed = false;
            addItemToGroup('account', newAccount.id, groupId);
        }
    }

    invalidateDataCache();
    renderAll();

    setTimeout(() => {
        const newDetails = document.querySelector(`details[data-id="${newAccount.id}"]`);
        if (newDetails) {
            newDetails.open = true;
            const nameField = newDetails.querySelector(`input[data-key="name"]`);
            if (nameField) {
                nameField.focus();
                nameField.select();
            }
        }
    }, 50);

    saveToLocalStorageDebounced();
    recalculateAndDraw();
}

function addLoan(groupId) {
    const newLoan = {
        id: genId('loan'),
        name: 'New Loan',
        initial_balance: 10000,
        monthly_payment: 200,
        interest_rate: 0.05,
        start_date: toYMD(new Date()),
        payoff_date: toYMD(new Date(new Date().setFullYear(new Date().getFullYear() + 5))),
        early_payoff_date: '',
        day_of_month: 1,
        tags: 'debt',
        rightAxis: false,
        isEnabled: true,
        linkedAccountId: ''
    };

    state.loans.unshift(newLoan);

    if (groupId) {
        const group = state.loanGroups.find(g => g.id === groupId);
        if (group) {
            group.collapsed = false;
            addItemToGroup('loan', newLoan.id, groupId);
        }
    }

    invalidateDataCache();
    renderAll();

    setTimeout(() => {
        const newDetails = document.querySelector(`details[data-id="${newLoan.id}"]`);
        if (newDetails) {
            newDetails.open = true;
            const nameField = newDetails.querySelector(`input[data-key="name"]`);
            if (nameField) {
                nameField.focus();
                nameField.select();
            }
        }
    }, 50);

    saveToLocalStorageDebounced();
    recalculateAndDraw();
}

function addTransaction(groupId) {
    const newTransaction = {
        id: genId('tx'),
        type: 'OneTime',
        name: 'New Transaction',
        amount: 100,
        units: 'usd',
        start_date: toYMD(new Date()),
        from_account: 'Cash',
        isEnabled: true,
        linkedAccountId: ''
    };

    state.transactions.unshift(newTransaction);
    state.transactionPlotOptions[newTransaction.id] = true;

    if (groupId) {
        const group = state.transactionGroups.find(g => g.id === groupId);
        if (group) {
            group.collapsed = false;
            addItemToGroup('transaction', newTransaction.id, groupId);
        }
    }

    invalidateTransactionCache();
    renderAll();

    setTimeout(() => {
        const newDetails = document.querySelector(`details[data-id="${newTransaction.id}"]`);
        if (newDetails) {
            newDetails.open = true;
            const nameField = newDetails.querySelector(`input[data-key="name"]`);
            if (nameField) {
                nameField.focus();
                nameField.select();
            }
        }
    }, 50);

    saveToLocalStorageDebounced();
    recalculateAndDraw();
}
function addUnit() {
    const newUnit = {
        id: genId('unit'),
        name: 'New Unit',
        symbol: 'NU',
        usdRate: 1.0,
        growthRate: 0,
        growthEnabled: true,
        isDefault: false,
        priceTargets: []
    };
    state.units.push(newUnit);
    renderAll();

    // Automatically open the newly created unit details
    setTimeout(() => {
        const newDetails = document.querySelector(`details[data-id="${newUnit.id}"]`);
        if (newDetails) {
            newDetails.open = true;
            // Focus on the name field for easy editing
            const nameField = newDetails.querySelector(`input[data-key="name"]`);
            if (nameField) {
                nameField.focus();
                nameField.select();
            }
        }
    }, 50);
}
function removeAccount(id) {
    const acc = state.accounts.find(a => a.id === id);
    if(acc) delete state.plotOptions[acc.name];
    removeItemFromGroup('account', id);
    state.accounts = state.accounts.filter(a => a.id !== id);
    invalidateDataCache();
    renderAll();
    recalculateAndDraw();
}
function removeLoan(id) {
    const loan = state.loans.find(l => l.id === id);
    if(loan) delete state.plotOptions[loan.name];
    removeItemFromGroup('loan', id);
    state.loans = state.loans.filter(l => l.id !== id);
    invalidateDataCache();
    renderAll();
    recalculateAndDraw();
}
function removeTransaction(id) {
    removeItemFromGroup('transaction', id);
    delete state.transactionPlotOptions[id];
    state.transactions = state.transactions.filter(tx => tx.id !== id);
    invalidateDataCache(); // Clear cache when transactions change
    renderAll();
    recalculateAndDraw();
}
function removeUnit(id) {
    const unit = state.units.find(u => u.id === id);
    if (unit && !unit.isDefault) {
        // Reset any accounts/transactions using this unit back to USD
        state.accounts.forEach(acc => { if (acc.units === id) acc.units = 'usd'; });
        state.transactions.forEach(tx => { if (tx.units === id) tx.units = 'usd'; });
        state.units = state.units.filter(u => u.id !== id);
        invalidateTransactionCache();
        invalidateDataCache();
        renderAll();
        recalculateAndDraw();
    }
}

function addFee() {
    const newFee = {
        id: genId('fee'),
        name: 'New Fee',
        assetId: '',
        feeType: 'percent',
        amount: 0
    };

    state.fees.unshift(newFee);
    invalidateDataCache();
    renderAll();

    setTimeout(() => {
        const newDetails = document.querySelector(`details[data-id="${newFee.id}"]`);
        if (newDetails) {
            newDetails.open = true;
            const nameField = newDetails.querySelector(`input[data-key="name"]`);
            if (nameField) {
                nameField.focus();
                nameField.select();
            }
        }
    }, 50);

    saveToLocalStorageDebounced();
}

function removeFee(id) {
    state.fees = state.fees.filter(f => f.id !== id);
    invalidateDataCache();
    renderAll();
    saveToLocalStorageDebounced();
}

// --- Group Management Functions ---
function addGroup(type) {
    const newGroup = {
        id: genId('group'),
        name: 'New Group',
        collapsed: false,
        items: []
    };

    getGroupArrayForType(type).push(newGroup);

    renderAll();
    saveToLocalStorageDebounced();
}

function removeGroup(type, groupId) {
    const groups = getGroupArrayForType(type);
    const groupIndex = groups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) {
        console.warn('removeGroup: group not found', { type, groupId });
        return;
    }
    groups.splice(groupIndex, 1);
    renderAll();
    saveToLocalStorageDebounced();
}

function duplicateGroup(type, groupId) {
    const groups = getGroupArrayForType(type);
    const items = getItemArrayForType(type);
    if (!groups.length && !items.length) {
        console.warn('duplicateGroup: invalid type', type);
        return;
    }

    const originalGroup = groups.find(g => g.id === groupId);
    if (!originalGroup) {
        console.warn('duplicateGroup: group not found', groupId);
        return;
    }

    // Create new group with "(copy)" suffix
    const newGroup = {
        id: genId('group'),
        name: `${originalGroup.name} (copy)`,
        collapsed: false,
        items: []
    };

    // Duplicate all items in the group
    const duplicatedItemIds = [];
    originalGroup.items.forEach(itemId => {
        const originalItem = items.find(item => item.id === itemId);
        if (!originalItem) return;
        const duplicatedItem = cloneData(originalItem);
        duplicatedItem.id = genId(type);
        duplicatedItem.name = `${originalItem.name} (copy)`;
        if (type === 'transaction') {
            state.transactionPlotOptions[duplicatedItem.id] = state.transactionPlotOptions[originalItem.id] !== false;
        }
        items.unshift(duplicatedItem);
        duplicatedItemIds.push(duplicatedItem.id);
    });

    newGroup.items = duplicatedItemIds;
    groups.push(newGroup);

    invalidateTransactionCache();
    renderAll();
    recalculateAndDraw();
    saveToLocalStorageDebounced();
}

function duplicateTransaction(transactionId) {
    const originalIndex = state.transactions.findIndex(tx => tx.id === transactionId);
    if (originalIndex === -1) {
        console.warn('Transaction not found for duplication:', transactionId);
        return;
    }

    const originalTx = state.transactions[originalIndex];
    const duplicateTx = cloneData(originalTx);
    duplicateTx.id = genId('transaction');
    duplicateTx.name = getDuplicateName(originalTx.name, 'Transaction');
    state.transactionPlotOptions[duplicateTx.id] = state.transactionPlotOptions[originalTx.id] !== false;

    if (typeof originalTx.positionIndex === 'number') {
        duplicateTx.positionIndex = originalTx.positionIndex + 0.01;
    }

    state.transactions.splice(originalIndex + 1, 0, duplicateTx);

    const parentGroup = state.transactionGroups.find(group => group.items.includes(transactionId));
    if (parentGroup) {
        const originalPos = parentGroup.items.indexOf(transactionId);
        parentGroup.items.splice(originalPos + 1, 0, duplicateTx.id);
    }

    invalidateDataCache();
    renderAll();
    recalculateAndDraw();
    saveToLocalStorageDebounced();
}

function toggleGroup(type, groupId) {
    const group = getGroupArrayForType(type).find(g => g.id === groupId);
    if (group) {
        group.collapsed = !group.collapsed;
        renderAll();
        saveToLocalStorageDebounced();
    }
}

function updateGroupName(type, groupId, newName) {
    const group = getGroupArrayForType(type).find(g => g.id === groupId);
    if (group) {
        group.name = newName;
        saveToLocalStorageDebounced();
    }
}

function addItemToGroup(type, itemId, groupId) {
    const groups = getGroupArrayForType(type);
    if (!groups.length && type !== 'account' && type !== 'loan' && type !== 'transaction') {
        console.warn('addItemToGroup: invalid type', type);
        return false;
    }

    // Remove item from all groups first (to prevent duplicates)
    groups.forEach(group => {
        group.items = group.items.filter(id => id !== itemId);
    });

    const targetGroup = groups.find(g => g.id === groupId);
    if (!targetGroup) {
        console.warn('addItemToGroup: target group not found', groupId);
        return false;
    }
    if (!targetGroup.items.includes(itemId)) {
        targetGroup.items.push(itemId);
    }
    saveToLocalStorageDebounced();
    return true;
}

function removeItemFromGroup(type, itemId) {
    const groups = getGroupArrayForType(type);
    let removed = false;
    groups.forEach(group => {
        const before = group.items.length;
        group.items = group.items.filter(id => id !== itemId);
        if (group.items.length !== before) removed = true;
    });
    if (removed) saveToLocalStorageDebounced();
    return removed;
}

function getItemGroup(type, itemId) {
    return getGroupArrayForType(type).find(group => group.items.includes(itemId)) || null;
}

function toggleGroupItems(type, groupId, checked) {
    const groups = getGroupArrayForType(type);
    const items = getItemArrayForType(type);
    if (!groups.length && !items.length) {
        console.warn('toggleGroupItems: invalid type', type);
        return;
    }

    const group = groups.find(g => g.id === groupId);
    if (!group) {
        console.warn('toggleGroupItems: group not found', groupId);
        return;
    }

    let changedCount = 0;
    group.items.forEach(itemId => {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        let oldValue, newValue;
        if (type === 'transaction' || type === 'loan') {
            oldValue = item.isEnabled;
            item.isEnabled = checked;
            newValue = item.isEnabled;
        } else {
            // accounts: toggle plot options
            oldValue = !!state.plotOptions[item.name];
            if (checked) state.plotOptions[item.name] = true;
            else delete state.plotOptions[item.name];
            newValue = !!state.plotOptions[item.name];
        }
        if (oldValue !== newValue) changedCount++;
    });

    renderAll();
    if (changedCount > 0) recalculateAndDraw();
}

function toggleGroupTransactionVisibility(groupId, checked) {
    const group = state.transactionGroups.find(g => g.id === groupId);
    if (!group) return;

    group.items.forEach(txId => {
        state.transactionPlotOptions[txId] = checked;
    });

    renderAll();
    updateChartVisibility();
}

// --- Calculation Engine ---
function calculateBalances() {
    performanceProfile.start('Setup');
    const start = FULL_START_DATE;
    const end = FULL_END_DATE;
    const cashAccountName = (state.accounts.find(a => a.name === "Cash") || state.accounts[0] || {name: null}).name;

    // Pre-calculate the date range length for better performance
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const dates = [];
    let currentDate = new Date(start);
    while (currentDate <= end) {
        // Create UTC dates to match parseYMD behavior
        const utcDate = new Date(Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate()
        ));
        dates.push(utcDate);
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    performanceProfile.end('Setup');

    performanceProfile.start('Initialize Accounts');
    const balances = {};
    const accountData = {};

    // Find "today" in the dates array to set current balances
    const today = todayUTC();
    const todayIndex = dates.findIndex(d => d.getTime() === today.getTime());

    state.accounts.forEach(acc => {
        const units = acc.units || 'usd';
        const entry = {
            balance: new Array(dates.length).fill(0),
            nativeBalance: new Array(dates.length).fill(0),
            dailyGrowth: (acc.annual_growth || 1.0) ** (1 / 365.25),
            units
        };
        accountData[acc.name] = entry;

        const initialIndex = todayIndex >= 0 ? todayIndex : 0;
        const initialNative = acc.balance || 0;

        const initialDate = dates[initialIndex] || today;
        entry.nativeBalance[initialIndex] = initialNative;
        entry.balance[initialIndex] = convertToUSD(initialNative, units, initialDate);

        if (initialIndex > 0) {
            for (let i = 0; i < initialIndex; i++) {
                entry.nativeBalance[i] = initialNative;
                entry.balance[i] = convertToUSD(initialNative, units, dates[i] || today);
            }
        }
    });
    performanceProfile.end('Initialize Accounts');

    performanceProfile.start('Initialize Loans');
    const loanData = {};

    // Initialize ALL loans first (so they all have balance arrays)
    state.loans.forEach(loan => {
        loanData[loan.name] = {
            balance: new Array(dates.length).fill(0),
            dailyRate: (loan.interest_rate || 0) / 365.25,
            payoffDate: parseYMD(loan.payoff_date),
            earlyPayoffDate: parseYMD(loan.early_payoff_date)
        };
    });

    // Then process only enabled loans for calculations
    state.loans.filter(loan => loan.isEnabled).forEach(loan => {
        const loanStartDate = parseYMD(loan.start_date);

        // Set initial balance
        if (loanStartDate && loanStartDate.getTime() === start.getTime()) {
            // Loan starts exactly on forecast start date
            loanData[loan.name].balance[0] = loan.initial_balance || 0;
        } else if (loanStartDate && loanStartDate > start) {
            // Loan starts after forecast start
            const i = dates.findIndex(d => d.getTime() === loanStartDate.getTime());
            if (i !== -1) {
                loanData[loan.name].balance[i] = loan.initial_balance || 0;
            }
        } else if (loanStartDate && loanStartDate < start) {
            // Loan started before forecast period - use the same amortized
            // "present balance" calculation shown in the loan cell so the
            // chart's starting value matches the displayed current balance.
            loanData[loan.name].balance[0] = getLoanCurrentBalance(loan);
        }
    });

    const allTxs = new Map();
    const addTxToMap = (date, amount, tx) => { if (!date || date < start || date > end) return; const ymd = toYMD(date); if (!allTxs.has(ymd)) allTxs.set(ymd, []); allTxs.get(ymd).push({ amount, tx }); };

    performanceProfile.start('Generate Transaction Dates');

    state.transactions.filter(tx => tx.isEnabled).forEach(txData => {
        // Contingent transactions: cap end_date at the linked asset's sale date
        let effectiveTxData = txData;
        if (txData.linkedAccountId) {
            const linkedAcc = state.accounts.find(a => a.id === txData.linkedAccountId);
            if (linkedAcc?.saleDate) {
                const capDate = linkedAcc.saleDate;
                if (!txData.end_date || capDate < txData.end_date) {
                    effectiveTxData = { ...txData, end_date: capDate };
                }
            }
        }
        new Transaction(effectiveTxData).generateDates(end).forEach(t => addTxToMap(t.date, t.amount, txData));
    });
    state.loans.filter(loan => loan.isEnabled).forEach(loan => {
        const earlyPayoff = parseYMD(loan.early_payoff_date);
        const pTx = new Transaction({
            type: 'Monthly',
            name: `${loan.name} Payment`,
            amount: Math.abs(loan.monthly_payment || 0),
            start_date: loan.start_date,
            // BUGFIX: was loan.start_date (which produced no payments). Use early-payoff cap when set.
            end_date: loan.early_payoff_date || loan.payoff_date,
            day_of_month: loan.day_of_month || 1,
            annual_growth: 1.0,
            units: 'usd'
        });
        const paymentDates = pTx.generateDates(end);
        // If early payoff, only keep payments strictly before the early payoff date
        const filteredPayments = earlyPayoff
            ? paymentDates.filter(p => p.date < earlyPayoff)
            : paymentDates;
        filteredPayments.forEach(p => addTxToMap(p.date, p.amount, { name: `${loan.name} Payment`, from_account: "Cash", to_account: loan.name }));
    });

    performanceProfile.end('Generate Transaction Dates');

    performanceProfile.start('Daily Balance Calculations');
    for (let i = 1; i < dates.length; i++) {
        const ymd = toYMD(dates[i]);

        // Calculate account growth in native currency, then convert to USD for reporting
        for (const n in accountData) {
            const data = accountData[n];
            const previousNative = data.nativeBalance[i - 1] ?? 0;
            const nextNative = previousNative * data.dailyGrowth;
            data.nativeBalance[i] = nextNative;
            data.balance[i] = convertToUSD(nextNative, data.units, dates[i]);
        }
        for (const n in loanData) {
            // Check if this loan has an initial balance set for today (loan start date)
            if (loanData[n].balance[i] > 0) {
                // This day already has an initialized balance (loan start), don't overwrite it
                continue;
            }

            let p = loanData[n].balance[i-1];
            if (p > 0) {
                loanData[n].balance[i] = p * (1 + loanData[n].dailyRate);
            } else {
                loanData[n].balance[i] = 0; // Keep zero balances as zero
            }

            // Handle early payoff: pay remaining balance from Cash on the payoff date
            const epd = loanData[n].earlyPayoffDate;
            if (epd && dates[i].getTime() === epd.getTime() && loanData[n].balance[i] > 0) {
                const remaining = loanData[n].balance[i];
                loanData[n].balance[i] = 0;
                // Debit Cash for the lump-sum payoff
                if (accountData['Cash']) {
                    applyAccountDelta(accountData['Cash'], dates[i], i, -remaining);
                }
            }
        }

        // Debug loan balances around loan start date
        if (i >= 209 && i <= 213 && Object.keys(loanData).some(name => loanData[name].balance[i] > 0)) {
            // Only log if there are active loans in this period
        }

        if (allTxs.has(ymd)) {
            allTxs.get(ymd).forEach(({ amount, tx }) => {
                // New transaction logic: all amounts are positive, direction controlled by FROM/TO
                if (tx.from_account && tx.to_account) {
                    // TRANSFER: FROM account/loan TO account/loan
                    let debitAmount = amount;
                    let creditAmount = amount;
                    let skipTransaction = false;

                    // Check if paying TO a loan - only apply if loan has balance
                    if (loanData[tx.to_account]) {
                        const currentBalance = Math.max(loanData[tx.to_account].balance[i], 0);
                        if (currentBalance <= 0) {
                            // Loan is paid off, skip entire transaction
                            skipTransaction = true;
                        } else {
                            const applied = Math.min(amount, currentBalance);
                            loanData[tx.to_account].balance[i] = currentBalance - applied;
                            debitAmount = applied;
                            creditAmount = applied;
                        }
                    }

                    // Check if paying FROM a loan - only apply if loan has balance
                    if (!skipTransaction && loanData[tx.from_account]) {
                        const currentBalance = Math.max(loanData[tx.from_account].balance[i], 0);
                        if (currentBalance <= 0) {
                            skipTransaction = true;
                        } else {
                            const applied = Math.min(amount, currentBalance);
                            loanData[tx.from_account].balance[i] = currentBalance - applied;
                            creditAmount = applied;
                            debitAmount = applied;
                        }
                    }

                    // Only process account transfers if transaction wasn't skipped
                    if (!skipTransaction) {
                        if (accountData[tx.from_account]) {
                            applyAccountDelta(accountData[tx.from_account], dates[i], i, -debitAmount);
                        }

                        if (accountData[tx.to_account]) {
                            applyAccountDelta(accountData[tx.to_account], dates[i], i, creditAmount);
                        }
                    }

                } else if (tx.from_account && !tx.to_account) {
                    // EXPENSE: FROM account, TO nowhere (money leaves the system)
                    if (accountData[tx.from_account]) {
                        applyAccountDelta(accountData[tx.from_account], dates[i], i, -amount);
                    } else if (loanData[tx.from_account]) {
                        loanData[tx.from_account].balance[i] -= amount;
                    }

                } else if (!tx.from_account && tx.to_account) {
                    // INCOME: FROM nowhere, TO account (money enters the system)
                    if (accountData[tx.to_account]) {
                        applyAccountDelta(accountData[tx.to_account], dates[i], i, amount);
                    } else if (loanData[tx.to_account]) {
                        // Income to loan (reduces loan balance)
                        loanData[tx.to_account].balance[i] -= amount;
                    }

                } else {
                    // ERROR: Both FROM and TO are empty
                    console.warn('⚠️ Transaction with no from_account or to_account:', tx);
                }
            });
        }
        // --- Asset sale events ---
        // For any account with a saleDate matching today: zero the asset, zero its linked loan,
        // and credit Cash with the net equity (assetValue - loanBalance) minus any applicable fees.
        for (const acc of state.accounts) {
            if (!acc.saleDate) continue;
            if (toYMD(parseYMD(acc.saleDate) || new Date(acc.saleDate)) !== ymd) continue;
            const assetEntry = accountData[acc.name];
            if (!assetEntry) continue;
            const assetVal = assetEntry.balance[i] || 0;
            // Find an enabled loan linked to this account
            const linkedLoan = state.loans.find(l => l.isEnabled && l.linkedAccountId === acc.id);
            const loanBal = linkedLoan ? (loanData[linkedLoan.name]?.balance[i] || 0) : 0;
            let netProceeds = assetVal - loanBal;

            // Apply fees for this asset sale
            const assetFees = state.fees.filter(f => f.assetId === acc.id);
            let totalFeeAmount = 0;
            assetFees.forEach(fee => {
                let feeAmount = 0;
                if (fee.feeType === 'percent') {
                    feeAmount = Math.abs(netProceeds) * (parseFloat(fee.amount) || 0) / 100;
                } else if (fee.feeType === 'fixed') {
                    feeAmount = Math.abs(parseFloat(fee.amount) || 0);
                }
                totalFeeAmount += feeAmount;
            });
            netProceeds -= totalFeeAmount;

            // Zero the asset from today onward (growth * 0 = 0, so future days stay 0)
            assetEntry.nativeBalance[i] = 0;
            assetEntry.balance[i] = 0;
            // Zero the linked loan
            if (linkedLoan && loanData[linkedLoan.name]) {
                loanData[linkedLoan.name].balance[i] = 0;
            }
            // Credit net proceeds (after fees) to Cash
            if (netProceeds !== 0 && accountData[cashAccountName]) {
                applyAccountDelta(accountData[cashAccountName], dates[i], i, netProceeds);
            }
        }
        for (const n in loanData) {
            if (loanData[n].payoffDate && toYMD(loanData[n].payoffDate) === ymd && loanData[n].balance[i] > 0) {
                const payoffAmount = loanData[n].balance[i];
                if (accountData[cashAccountName]) {
                    // Use the same helper as other account adjustments so native balances stay in sync
                    applyAccountDelta(accountData[cashAccountName], dates[i], i, -payoffAmount);
                }
                loanData[n].balance[i] = 0;
            }
        }
    }
    performanceProfile.end('Daily Balance Calculations');

    performanceProfile.start('Finalize Results');
    // Keep account and loan balances in separate maps so that a name collision
    // (e.g. asset "Sleepy" + loan "Sleepy") can't cause one to overwrite the
    // other in `balances` and corrupt net worth.
    const accountBalances = {};
    const loanBalances = {};
    Object.keys(accountData).forEach(n => { accountBalances[n] = accountData[n].balance; });
    Object.keys(loanData).forEach(n => { loanBalances[n] = loanData[n].balance; });
    // `balances` is kept for legacy consumers (chart, plotOptions). When an
    // account and loan share the same name, the account wins here; the flat
    // map is inherently ambiguous, but NW uses the split maps below.
    Object.keys(loanData).forEach(n => { balances[n] = loanData[n].balance; });
    Object.keys(accountData).forEach(n => { balances[n] = accountData[n].balance; });
    performanceProfile.end('Finalize Results');

    if (performanceProfile.enabled) {
        const totalAccounts = Object.keys(accountData).length;
        const totalLoans = Object.keys(loanData).length;
    }

    return { dates, balances, accountBalances, loanBalances };
}

// --- Charting ---
function drawChart(data, updateMode = 'active') {
    if (!document.getElementById('balanceChart')) return;
    if (typeof Chart === 'undefined') {
        console.error('Chart.js library is not available; skipping chart render.');
        return;
    }
    const { dates, balances } = data;
    const ctx = document.getElementById('balanceChart').getContext('2d');
    const colors = ['#007bff', '#28a745', '#ffc107', '#17a2b8', '#6f42c1', '#fd7e14', '#20c997', '#e83e8c'];

    const itemsToPlot = Object.keys(state.plotOptions).filter(item => state.plotOptions[item] && balances[item]);

    // Separate items by axis
    const leftAxisItems = [];
    const rightAxisItems = [];

    itemsToPlot.forEach(name => {
        const item = [...state.accounts, ...state.loans].find(item => item.name === name);
        if (item && item.rightAxis) {
            rightAxisItems.push(name);
        } else {
            leftAxisItems.push(name);
        }
    });

    // Ensure consistent color assignment by sorting items and assigning colors deterministically
    const sortedItems = [...itemsToPlot].sort();
    sortedItems.forEach((name, index) => {
        if (!datasetColorMap.has(name)) {
            // Use a more distributed color assignment to ensure variety
            const colorIndex = index % colors.length;
            datasetColorMap.set(name, colors[colorIndex]);
        }
    });

    if (!chartInstance) {
        // First time: create chart with initial datasets
        const datasets = [];
        itemsToPlot.forEach(name => {
            const color = datasetColorMap.get(name);
            const item = [...state.accounts, ...state.loans].find(item => item.name === name);
            const yAxisID = (item && item.rightAxis) ? 'y1' : 'y';

            datasets.push({
                label: name,
                data: balances[name],
                borderColor: color,
                fill: false,
                tension: 0.1,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 0,
                pointBackgroundColor: 'transparent',
                pointBorderColor: 'transparent',
                yAxisID: yAxisID,
                segment: {
                    borderColor: ctx => {
                        const y = ctx.p1.raw;
                        return y < 0 ? '#dc3545' : color;
                    }
                }
            });
        });

        // Generate vertical lines for the time period
        const verticalLines = generateVerticalLines(FULL_START_DATE, FULL_END_DATE);
        if (document.getElementById('showMinCashLine')?.checked) {
            const minCashLine = getMinCashAnnotation(dates, balances);
            if (minCashLine) verticalLines.push(...minCashLine);
        }

        // Crosshair cursor plugin
        const cursorLinePlugin = {
            id: 'cursorLine',
            afterEvent(chart, args) {
                const { event } = args;
                const a = chart.chartArea;
                if (event.type === 'mousemove' && event.x >= a.left && event.x <= a.right && event.y >= a.top && event.y <= a.bottom) {
                    chart._cursorX = event.x;
                    chart._cursorY = event.y;
                } else if (event.type === 'mouseout') {
                    chart._cursorX = null;
                    chart._cursorY = null;
                }
                chart.draw();
            },
            afterDraw(chart) {
                if (chart._cursorX == null) return;
                const { ctx: c, chartArea: { left, right, top, bottom } } = chart;
                const color = isDarkModeActive() ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
                c.save();
                c.lineWidth = 1;
                c.strokeStyle = color;
                // Vertical line
                c.beginPath();
                c.moveTo(chart._cursorX, top);
                c.lineTo(chart._cursorX, bottom);
                c.stroke();
                // Horizontal line
                if (chart._cursorY != null) {
                    c.beginPath();
                    c.moveTo(left, chart._cursorY);
                    c.lineTo(right, chart._cursorY);
                    c.stroke();
                }
                c.restore();
            }
        };

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: dates, datasets: datasets },
            plugins: [cursorLinePlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 800,
                    easing: 'easeInOutQuart'
                },
                transitions: {
                    active: {
                        animation: {
                            duration: 400
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'MMM dd, yyyy' },
                        ticks: { maxTicksLimit: 8, maxRotation: 0 },
                        title: { display: true, text: 'Date' },
                        min: currentViewStart,
                        max: currentViewEnd
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Balance ($)' },
                        ticks: { callback: value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) },
                        suggestedMin: 0  // Ensure minimum y value never goes above $0
                    },
                    y1: {
                        type: 'linear',
                        display: rightAxisItems.length > 0,
                        position: 'right',
                        title: { display: true, text: 'Right Axis ($)' },
                        ticks: { callback: value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) },
                        grid: { drawOnChartArea: false },
                        suggestedMin: 0  // Ensure minimum y value never goes above $0
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`
                        }
                    },
                    annotation: {
                        annotations: verticalLines
                    },
                    zoom: {
                        zoom: {
                            wheel: {
                                enabled: true,
                                modifierKey: 'ctrl',  // Ctrl+scroll to zoom; macOS trackpad pinch sends ctrlKey natively
                                speed: 0.03
                            },
                            pinch: {
                                enabled: true
                            },
                            drag: {
                                enabled: true,
                                modifierKey: 'alt'
                            },
                            mode: 'x',
                            onZoom: function({chart}) {
                                // Only update tracking variables if this is a user-initiated zoom, not our programmatic zoom
                                if (!isManualZoom) {
                                    currentViewStart = new Date(chart.scales.x.min);
                                    currentViewEnd = new Date(chart.scales.x.max);
                                    updateChartDurationLabel();
                                }
                            }
                        },
                        pan: {
                            enabled: true,
                            mode: 'xy',
                            onPan: function({chart}) {
                                // Only update tracking variables if this is a user-initiated pan, not our programmatic zoom
                                if (!isManualZoom) {
                                    currentViewStart = new Date(chart.scales.x.min);
                                    currentViewEnd = new Date(chart.scales.x.max);
                                    updateChartDurationLabel();
                                }
                            },
                            onPanStart: function({chart, point}) {
                                // Pan start detected
                            },
                            onPanComplete: function({chart}) {
                                // Only update tracking variables if this is a user-initiated pan, not our programmatic zoom
                                if (!isManualZoom) {
                                    currentViewStart = new Date(chart.scales.x.min);
                                    currentViewEnd = new Date(chart.scales.x.max);
                                    updateChartDurationLabel();
                                }
                            }
                        },
                        limits: {
                            x: {min: FULL_START_DATE, max: FULL_END_DATE},
                            y: {min: 'original', max: 'original'}
                        }
                    }
                }
            }
        });

        // Double-click to reset zoom
        chartInstance.canvas.addEventListener('dblclick', () => {
            resetZoom();
        });

        updateChartTheme(isDarkModeActive());
        chartInstance.update('none');
        updateChartLegend();
    } else {
        // Update existing chart
        chartInstance.data.labels = dates;

        // Get current dataset labels
        const currentLabels = chartInstance.data.datasets.map(d => d.label);
        const newLabels = itemsToPlot;

        // Remove datasets that are no longer plotted (preserve special synthetic datasets)
        for (let i = chartInstance.data.datasets.length - 1; i >= 0; i--) {
            const dataset = chartInstance.data.datasets[i];
            if (dataset._netWorth) continue;
            if (!newLabels.includes(dataset.label)) {
                chartInstance.data.datasets.splice(i, 1);
            }
        }

        // Update existing datasets and add new ones
        newLabels.forEach(name => {
            const existingIndex = chartInstance.data.datasets.findIndex(d => d.label === name);
            const item = [...state.accounts, ...state.loans].find(item => item.name === name);
            const yAxisID = (item && item.rightAxis) ? 'y1' : 'y';

            if (existingIndex >= 0) {
                // Update existing dataset data and axis assignment
                const existingDataset = chartInstance.data.datasets[existingIndex];

                // Only update the data and axis, preserve all other properties including segment
                const newData = balances[name];
                existingDataset.data = newData;
                existingDataset.yAxisID = yAxisID;

                // Preserve segment property for red negative value coloring
                if (!existingDataset.segment) {
                    const color = existingDataset.borderColor;
                    existingDataset.segment = {
                        borderColor: ctx => {
                            const y = ctx.p1.raw;
                            return y < 0 ? '#dc3545' : color;
                        }
                    };
                }

                // Explicitly preserve point properties to prevent scatter points from appearing
                if (existingDataset.pointRadius === 0) {
                    existingDataset.pointRadius = 0;
                    existingDataset.pointHoverRadius = 0;
                    existingDataset.pointBackgroundColor = 'transparent';
                    existingDataset.pointBorderColor = 'transparent';
                }
            } else {
                // Add new dataset
                const color = datasetColorMap.get(name);
                chartInstance.data.datasets.push({
                    label: name,
                    data: balances[name],
                    borderColor: color,
                    fill: false,
                    tension: 0.1,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    pointBackgroundColor: 'transparent',
                    pointBorderColor: 'transparent',
                    yAxisID: yAxisID,
                    segment: {
                        borderColor: ctx => {
                            const y = ctx.p1.raw;
                            return y < 0 ? '#dc3545' : color;
                        }
                    }
                });
            }
        });

        // Update right axis visibility
        const hasRightAxisItems = rightAxisItems.length > 0 || (showNetWorth && netWorthRightAxis);
        chartInstance.options.scales.y1.display = hasRightAxisItems;

        // Ensure minimum y values never go above $0
        chartInstance.options.scales.y.suggestedMin = 0;
        chartInstance.options.scales.y1.suggestedMin = 0;

        // Re-apply frozen Y-axis if active
        if (state.yAxisFrozen) {
            const fy = state.yAxisFrozen;
            chartInstance.options.scales.y.min = fy.y.min;
            chartInstance.options.scales.y.max = fy.y.max;
            if (fy.y1 && chartInstance.options.scales.y1) {
                chartInstance.options.scales.y1.min = fy.y1.min;
                chartInstance.options.scales.y1.max = fy.y1.max;
            }
        }

        // Update vertical lines for new date range
        const verticalLines = generateVerticalLines(FULL_START_DATE, FULL_END_DATE);
        if (document.getElementById('showMinCashLine')?.checked) {
            const minCashLine = getMinCashAnnotation(dates, balances);
            if (minCashLine) verticalLines.push(...minCashLine);
        }
        chartInstance.options.plugins.annotation.annotations = verticalLines;

        // Update x-axis view range using direct scale modification instead of zoom API
        isManualZoom = true;
        chartInstance.options.scales.x.min = currentViewStart;
        chartInstance.options.scales.x.max = currentViewEnd;

        setTimeout(() => {
            isManualZoom = false;
        }, 100);

        // Use active mode here because we're updating data, not just view
        // Refresh Net Worth overlay dataset
        chartInstance.data.datasets = chartInstance.data.datasets.filter(ds => !ds._netWorth);
        if (showNetWorth) {
            const nwDs = buildNetWorthDataset(data);
            if (nwDs) chartInstance.data.datasets.push(nwDs);
        }
        updateChartTheme(isDarkModeActive());
        performanceProfile.start('Chart Data Update');
        chartInstance.update(updateMode);
        performanceProfile.end('Chart Data Update');
        updateChartLegend();
    }

    // Clean up color map for items that are completely removed
    const allAvailableItems = new Set([...Object.keys(balances)]);
    for (const [name] of datasetColorMap) {
        if (!allAvailableItems.has(name)) {
            datasetColorMap.delete(name);
        }
    }
}

// --- Main Execution & Event Handling ---
let debounceTimer;

// --- Local Storage Persistence ---
function saveToLocalStorage() {
    try {
        const saveData = buildSerializableState();
        localStorage.setItem('financialForecastData', JSON.stringify(saveData));
        // Auto-persist to the active scenario so edits are always reflected
        const active = getActiveScenarioRecord();
        if (active) {
            active.snapshot = saveData;
            active.updatedAt = saveData.timestamp;
            if (applyToAll && !_inScenarioSwitch && scenarioManager.scenarios.length > 1) {
                syncSnapshotToAllScenarios(saveData);
            }
            if (!saveScenarioRegistry()) return;
        }
        setSaveStatus('Saved on this device');
    } catch (error) {
        console.error('Failed to save to local storage:', error);
        setSaveStatus('Not saved - export a backup', 'error');
        showToast('Your changes could not be saved in this browser. Export a backup before leaving.', 'error', 6000);
    }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('financialForecastData');
        if (saved) {
            const saveData = JSON.parse(saved);
            const { applied, openSections } = applyImportedData(saveData);
            if (applied) {
                restoreOpenSections(openSections);
                renderAll();
                recalculateAndDraw();
                return true;
            }
        }
    } catch (error) {
        console.error('Failed to load from local storage:', error);
    }
    return false;
}

async function clearLocalStorage() {
    if (await showPlanDialog({ title: 'Clear saved copies?', message: 'Export a backup first. This removes saved plans and scenarios from this browser. Your current plan stays open, and editing it will save a new copy.', confirmLabel: 'Clear saved copies', danger: true }) === null) return;
    try {
        clearTimeout(saveTimer);
        saveTimer = null;
        localStorage.removeItem('financialForecastData');
        localStorage.removeItem(SCENARIO_STORAGE_KEY);
        setSaveStatus('Saved copies cleared', 'pending');
        showToast('Saved copies cleared. Your current plan is still open.', 'success');
    } catch (error) {
        console.error('Failed to clear local storage:', error);
        showToast('Saved data could not be cleared. Please try again.', 'error');
    }
}

// Debounced save function
let saveTimer;
function saveToLocalStorageDebounced() {
    clearTimeout(saveTimer);
    setSaveStatus('Saving changes...', 'pending');
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveToLocalStorage();
    }, 1000); // Save 1 second after last change
}

// --- Performance Profiling ---
const performanceProfile = {
    enabled: false,
    debugMode: false,
    timers: {},

    start(label) {
        if (!this.enabled) return;
        this.timers[label] = performance.now();
    },

    end(label) {
        if (!this.enabled || !this.timers[label]) return;
        const duration = performance.now() - this.timers[label];
        console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
        delete this.timers[label];
        return duration;
    },

    measure(label, fn) {
        if (!this.enabled) return fn();
        this.start(label);
        const result = fn();
        this.end(label);
        return result;
    },

    debug(message) {
        if (this.debugMode) {
            console.log(message);
        }
    }
};

// --- Transaction Date Cache ---
let transactionDateCache = new Map();
let cacheVersion = 0;

// Legacy function - now handled by main data cache system
function invalidateTransactionCache() {
    transactionDateCache.clear();
    cacheVersion++;
    invalidateDataCache(); // Delegate to main cache system
}

function recalculateAndDraw() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        try {
            performanceProfile.start('Total Recalculation');

            // Use cached data system - only regenerates if data actually changed
            const data = getCachedData();

            // Always redraw chart (fast operation) to reflect any view/visibility changes
            performanceProfile.measure('Draw Chart', () => drawChart(data));
            document.getElementById('app-error').hidden = true;

            // Update duration label after chart is drawn
            updateChartDurationLabel();

            // Save to local storage after recalculation
            saveToLocalStorageDebounced();

            performanceProfile.end('Total Recalculation');
        } catch (e) {
            console.error("Calculation Failed:", e);
            const banner = document.getElementById('app-error');
            banner.textContent = 'The forecast could not be calculated. Check your inputs and connection, then reload. Export a backup before leaving if you have unsaved edits.';
            banner.hidden = false;
        }
    }, 250);
}

// NEW: Fast chart update for visibility changes only
function updateChartVisibility() {
    if (chartInstance) {
        performanceProfile.start('Chart Visibility Update');

        // Use cached data - no need to recalculate balances
        const data = getCachedData();

        // Redraw chart with current cached data and new visibility settings
        performanceProfile.measure('Draw Chart', () => drawChart(data, 'none'));

        // Update duration label and save state
        updateChartDurationLabel();
        saveToLocalStorageDebounced();

        performanceProfile.end('Chart Visibility Update');
    }
}
function updateChartView() {
    if (chartInstance) {
        performanceProfile.start('View Update Only');

        // Set manual zoom flag to prevent feedback loops
        isManualZoom = true;

        // Try using the zoom plugin's API to programmatically zoom to the desired range
        try {
            chartInstance.zoomScale('x', {
                min: currentViewStart.getTime(),
                max: currentViewEnd.getTime()
            }, 'none'); // 'none' mode prevents animation and data updates

        } catch (error) {

            // Fallback: direct scale manipulation + forced redraw
            chartInstance.scales.x.min = currentViewStart.getTime();
            chartInstance.scales.x.max = currentViewEnd.getTime();
            chartInstance.options.scales.x.min = currentViewStart;
            chartInstance.options.scales.x.max = currentViewEnd;

            // Force a complete redraw
            chartInstance.update('resize');
        }

        updateChartDurationLabel();
        saveToLocalStorageDebounced();

        // Reset manual zoom flag after a short delay
        setTimeout(() => {
            isManualZoom = false;
        }, 100);

        performanceProfile.end('View Update Only');
    }
}
function clearAxisRange(chart, axisId) {
    const axisOptions = chart.options?.scales?.[axisId];
    if (axisOptions) {
        delete axisOptions.min;
        delete axisOptions.max;
    }

    const liveScale = chart.scales?.[axisId];
    if (liveScale) {
        if (liveScale.options) {
            delete liveScale.options.min;
            delete liveScale.options.max;
        }
        liveScale.min = undefined;
        liveScale.max = undefined;
    }
}

function updateChartLegend() {
    if (!chartInstance) return;
    const panel = document.getElementById('chart-legend');
    if (!panel) return;
    panel.innerHTML = '';
    chartInstance.data.datasets.forEach((ds, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'chart-legend-item' + (ds.hidden ? ' hidden' : '');
        item.setAttribute('aria-pressed', String(!ds.hidden));
        item.setAttribute('aria-label', `${ds.label}: toggle visibility`);
        const swatch = document.createElement('span');
        swatch.className = 'chart-legend-swatch';
        swatch.style.backgroundColor = ds.borderColor;
        const label = document.createElement('span');
        label.className = 'chart-legend-label';
        label.textContent = ds.label;
        label.title = ds.label;
        item.appendChild(swatch);
        item.appendChild(label);
        item.addEventListener('click', () => {
            ds.hidden = !ds.hidden;
            item.classList.toggle('hidden', ds.hidden);
            item.setAttribute('aria-pressed', String(!ds.hidden));
            chartInstance.update('none');
        });
        panel.appendChild(item);
    });
}

function toggleLegend() {
    const panel = document.getElementById('chart-legend');
    if (panel) {
        const collapsed = panel.classList.toggle('collapsed');
        document.getElementById('legend-toggle-btn').setAttribute('aria-expanded', String(!collapsed));
    }
}

function resetZoom() {
    if (!chartInstance) {
        return;
    }

    performanceProfile.start('Reset Zoom');

    const now = new Date();
    currentViewStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    currentViewEnd = new Date(currentViewStart);
    currentViewEnd.setFullYear(currentViewEnd.getFullYear() + 5);

    isManualZoom = true;

    if (typeof chartInstance.resetZoom === 'function') {
        chartInstance.resetZoom();
    }

    if (!state.yAxisFrozen) {
        clearAxisRange(chartInstance, 'y');
        clearAxisRange(chartInstance, 'y1');
    }

    if (chartInstance.scales?.x) {
        chartInstance.scales.x.min = currentViewStart.getTime();
        chartInstance.scales.x.max = currentViewEnd.getTime();
    }

    if (chartInstance.options.scales?.x) {
        chartInstance.options.scales.x.min = currentViewStart;
        chartInstance.options.scales.x.max = currentViewEnd;
    }

    chartInstance.update('resize');
    updateChartDurationLabel();
    saveToLocalStorageDebounced();

    setTimeout(() => {
        isManualZoom = false;
    }, 100);

    performanceProfile.end('Reset Zoom');
}

function toggleFreezeY() {
    if (!chartInstance) return;
    const btn = document.getElementById('freeze-y-btn');
    if (!state.yAxisFrozen) {
        // Freeze: capture current visible min/max
        const yScale = chartInstance.scales.y;
        const y1Scale = chartInstance.scales.y1;
        state.yAxisFrozen = {
            y: { min: yScale.min, max: yScale.max },
            y1: y1Scale ? { min: y1Scale.min, max: y1Scale.max } : null
        };
        chartInstance.options.scales.y.min = yScale.min;
        chartInstance.options.scales.y.max = yScale.max;
        if (y1Scale && chartInstance.options.scales.y1) {
            chartInstance.options.scales.y1.min = y1Scale.min;
            chartInstance.options.scales.y1.max = y1Scale.max;
        }
        btn.classList.add('active');
        btn.innerHTML = '&#x1f512; Y';
        btn.title = 'Unfreeze Y-axis scale';
    } else {
        // Unfreeze: remove fixed min/max
        state.yAxisFrozen = null;
        clearAxisRange(chartInstance, 'y');
        clearAxisRange(chartInstance, 'y1');
        chartInstance.options.scales.y.suggestedMin = 0;
        chartInstance.options.scales.y1.suggestedMin = 0;
        btn.classList.remove('active');
        btn.innerHTML = '&#x1f513; Y';
        btn.title = 'Freeze Y-axis scale';
    }
    btn.setAttribute('aria-pressed', String(Boolean(state.yAxisFrozen)));
    chartInstance.update();
    saveToLocalStorageDebounced();
}

function adjustYears(years) {
    if (chartInstance && years !== 0) {
        performanceProfile.start('Adjust Years');
        const yearMs = years * 365.25 * 24 * 60 * 60 * 1000;

        if (years > 0) {
            // Extending the view - add years to the end
            const newEnd = new Date(currentViewEnd.getTime() + yearMs);
            if (newEnd <= FULL_END_DATE) {
                currentViewEnd = newEnd;
            } else {
                // Don't exceed the full range
                currentViewEnd = new Date(FULL_END_DATE);
            }
        } else {
            // Reducing the view - remove years from the end
            const newEnd = new Date(currentViewEnd.getTime() + yearMs); // yearMs is negative here
            const minViewMs = 6 * 30.44 * 24 * 60 * 60 * 1000; // Minimum 6 months view

            if (newEnd > currentViewStart && (newEnd.getTime() - currentViewStart.getTime()) >= minViewMs) {
                currentViewEnd = newEnd;
            }
            // If reducing would make view too small, don't change anything
        }

        // Set manual zoom flag to prevent feedback loop
        isManualZoom = true;

        // Use the new fast view update function
        updateChartView();

        // Reset flag after a short delay
        setTimeout(() => {
            isManualZoom = false;
        }, 100);

        performanceProfile.end('Adjust Years');
    }
}

function adjustMonths(months) {
    if (chartInstance && months !== 0) {
        performanceProfile.start('Adjust Months');
        const monthMs = months * 30.44 * 24 * 60 * 60 * 1000; // Average month length

        if (months > 0) {
            // Extending the view - add months to the end
            const newEnd = new Date(currentViewEnd.getTime() + monthMs);
            if (newEnd <= FULL_END_DATE) {
                currentViewEnd = newEnd;
            } else {
                // Don't exceed the full range
                currentViewEnd = new Date(FULL_END_DATE);
            }
        } else {
            // Reducing the view - remove months from the end
            const newEnd = new Date(currentViewEnd.getTime() + monthMs); // monthMs is negative here
            const minViewMs = 1 * 30.44 * 24 * 60 * 60 * 1000; // Minimum 1 month view

            if (newEnd > currentViewStart && (newEnd.getTime() - currentViewStart.getTime()) >= minViewMs) {
                currentViewEnd = newEnd;
            }
            // If reducing would make view too small, don't change anything
        }

        // Set manual zoom flag to prevent feedback loop
        isManualZoom = true;

        // Use the new fast view update function
        updateChartView();

        // Reset flag after a short delay
        setTimeout(() => {
            isManualZoom = false;
        }, 100);

        performanceProfile.end('Adjust Months');
    }
}

// =====================================================================
// PRODUCT ENHANCEMENTS — Today panel, milestones, scenario overlay, sell-shares
// =====================================================================

// Module-level UI state (not persisted; purely view-level)
let showMilestones = false;
let showNetWorth = false;
let netWorthRightAxis = false;

// Toggle the Net Worth overlay line on the main chart
function toggleNetWorth() {
    showNetWorth = !showNetWorth;
    const btn = document.getElementById('net-worth-btn');
    if (btn) {
        btn.classList.toggle('active', showNetWorth);
        btn.setAttribute('aria-pressed', String(showNetWorth));
    }
    // Keep R button visible only when NW is on
    const axisBtn = document.getElementById('net-worth-axis-btn');
    if (axisBtn) axisBtn.classList.toggle('nw-axis-visible', showNetWorth);
    recalculateAndDraw();
}

function toggleNetWorthAxis() {
    netWorthRightAxis = !netWorthRightAxis;
    const btn = document.getElementById('net-worth-axis-btn');
    if (btn) {
        btn.classList.toggle('active', netWorthRightAxis);
        btn.setAttribute('aria-pressed', String(netWorthRightAxis));
    }
    if (showNetWorth) recalculateAndDraw();
}

// Build the Net Worth dataset to inject into the chart
function buildNetWorthDataset(data) {
    const nwSeries = computeNetWorthSeries(data);
    if (!nwSeries) return null;
    const axisId = netWorthRightAxis ? 'y1' : 'y';
    return {
        label: 'Net Worth',
        data: nwSeries,
        borderColor: isDarkModeActive() ? '#8ad2b5' : '#176b58',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointBackgroundColor: 'transparent',
        pointBorderColor: 'transparent',
        fill: false,
        tension: 0.1,
        yAxisID: axisId,
        _netWorth: true
    };
}

// --- Loan linked-asset helpers ---
// Returns HTML badge showing equity for a loan that has a linked asset account
function loanEquityBadge(loan) {
    if (!loan.linkedAccountId) return '';
    const acc = state.accounts.find(a => a.id === loan.linkedAccountId);
    if (!acc) return '';
    const assetVal = acc.balance || 0;
    const loanBal = getLoanCurrentBalance(loan);
    const equity = assetVal - loanBal;
    const pct = assetVal > 0 ? Math.round((equity / assetVal) * 100) : 0;
    const growthPct = (acc.annual_growth - 1) * 100;
    const growthDesc = growthPct >= 0
        ? `↑${growthPct.toFixed(1)}%/yr appreciation`
        : `↓${Math.abs(growthPct).toFixed(1)}%/yr depreciation`;
    const cls = equity >= 0 ? 'loan-equity' : 'loan-equity loan-equity-negative';
    return `<span class="${cls}" title="${escapeHtml(acc.name)}: ${formatCurrency(assetVal)} · ${growthDesc}">${equity >= 0 ? '+' : ''}${formatCurrency(equity)} equity (${pct}%)</span>`;
}

// Returns a select field for picking the asset account a transaction is contingent on
function txLinkedAssetField(tx) {
    const options = state.accounts.map(a => {
        const hasSale = a.saleDate ? ` → sold ${a.saleDate}` : '';
        return `<option value="${escapeHtml(a.id)}" ${tx.linkedAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}${escapeHtml(hasSale)}</option>`;
    }).join('');
    return `<div><label for="${tx.id}_linkedAccountId">stops when asset sold</label><select id="${tx.id}_linkedAccountId" data-id="${tx.id}" data-key="linkedAccountId"><option value="">— always active —</option>${options}</select></div>`;
}
// Returns a select field for picking the loan's linked asset account
function loanLinkedAccountField(loan) {
    const options = state.accounts.map(a => {
        const growthPct = (a.annual_growth - 1) * 100;
        const sign = growthPct >= 0 ? '+' : '';
        return `<option value="${escapeHtml(a.id)}" ${loan.linkedAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${sign}${growthPct.toFixed(1)}%/yr)</option>`;
    }).join('');
    return `<div><label for="${loan.id}_linkedAccountId">linked asset</label><select id="${loan.id}_linkedAccountId" data-id="${loan.id}" data-key="linkedAccountId"><option value="">— none —</option>${options}</select></div>`;
}
const MILESTONE_NW_THRESHOLDS = [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000];
const scenarioOverlay = { enabled: false, unitId: null, scenarios: new Set() };

// --- Net worth from cached / computed data ---
function computeNetWorthSeries(data) {
    if (!data || !data.dates) return null;
    const len = data.dates.length;
    const series = new Array(len).fill(0);
    // Prefer the split maps so shared account/loan names (e.g. an asset
    // and its linked loan both named "Sleepy") don't collide.
    const acctMap = data.accountBalances;
    const loanMap = data.loanBalances;
    if (acctMap && loanMap) {
        for (const name of Object.keys(acctMap)) {
            const arr = acctMap[name];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < len; i++) series[i] += arr[i] || 0;
        }
        for (const name of Object.keys(loanMap)) {
            const arr = loanMap[name];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < len; i++) series[i] -= arr[i] || 0;
        }
        return series;
    }
    // Legacy fallback (older cache shape): iterate flat balances.
    if (!data.balances) return series;
    const accountNames = new Set(state.accounts.map(a => a.name));
    const loanNames = new Set(state.loans.map(l => l.name));
    for (const name of Object.keys(data.balances)) {
        const arr = data.balances[name];
        if (!Array.isArray(arr)) continue;
        if (accountNames.has(name)) {
            for (let i = 0; i < len; i++) series[i] += arr[i] || 0;
        } else if (loanNames.has(name)) {
            for (let i = 0; i < len; i++) series[i] -= arr[i] || 0;
        }
    }
    return series;
}

// --- Today panel ---
function updateTodayPanel() {
    const panel = document.getElementById('today-panel');
    if (!panel) return;
    if (!dataCache.isValid || !dataCache.dates || !dataCache.balances) {
        panel.innerHTML = '';
        return;
    }
    const dates = dataCache.dates;
    const balances = dataCache.balances;
    const today = todayUTC();
    let todayIdx = dates.findIndex(d => d.getTime() >= today.getTime());
    if (todayIdx < 0) todayIdx = dates.length - 1;

    const oneYearLater = new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()));
    let plus12Idx = dates.findIndex(d => d.getTime() >= oneYearLater.getTime());
    if (plus12Idx < 0) plus12Idx = dates.length - 1;

    let totalAssets = 0;
    let totalDebt = 0;
    let cash = 0;
    const accountValues = [];
    for (const acc of state.accounts) {
        const arr = dataCache.accountBalances?.[acc.name] || balances[acc.name];
        const v = arr ? (arr[todayIdx] || 0) : 0;
        totalAssets += v;
        if (acc.name === 'Cash') cash = v;
        else accountValues.push({ name: acc.name, value: v });
    }
    for (const loan of state.loans) {
        const arr = dataCache.loanBalances?.[loan.name] || balances[loan.name];
        const v = arr ? (arr[todayIdx] || 0) : 0;
        totalDebt += v;
    }
    const netWorth = totalAssets - totalDebt;

    const nwSeries = computeNetWorthSeries(dataCache);
    const nw12 = nwSeries ? (nwSeries[plus12Idx] || 0) : netWorth;
    const deltaNW = nw12 - netWorth;
    const deltaPct = netWorth !== 0 ? (deltaNW / Math.abs(netWorth)) * 100 : 0;

    accountValues.sort((a, b) => b.value - a.value);
    const top = accountValues[0];
    const topPct = totalAssets > 0 && top ? (top.value / totalAssets) * 100 : 0;

    const todayStr = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    const stat = (label, value, sub = '', cls = '') =>
        `<div class="tp-stat"><div class="tp-label">${label}</div><div class="tp-value ${cls}">${value}</div>${sub ? `<div class="tp-sub">${sub}</div>` : ''}</div>`;
    panel.innerHTML = [
        stat('Net worth', formatCurrency(netWorth, 'usd'), 'Assets minus outstanding debt', netWorth >= 0 ? 'pos' : 'neg'),
        stat('Cash available', formatCurrency(cash, 'usd'), 'Current cash balance', cash >= 0 ? '' : 'neg'),
        stat('Total assets', formatCurrency(totalAssets, 'usd'), 'Across your accounts'),
        stat('Outstanding debt', formatCurrency(totalDebt, 'usd'), 'Across your loans', totalDebt > 0 ? 'neg' : ''),
        `<div class="snapshot-detail"><span>As of ${escapeHtml(todayStr)}</span><span>12-month net worth change: <strong>${deltaNW >= 0 ? '+' : ''}${formatCurrency(deltaNW, 'usd')} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%)</strong></span>${top ? `<span>Top position: ${escapeHtml(top.name)} (${topPct.toFixed(1)}% of assets)</span>` : ''}</div>`
    ].filter(Boolean).join('');
}

// --- Milestone annotations ---
function getMilestoneAnnotations() {
    if (!showMilestones || !dataCache.isValid || !dataCache.dates || !dataCache.balances) return [];
    const dates = dataCache.dates;
    const nwSeries = computeNetWorthSeries(dataCache);
    if (!nwSeries) return [];

    const annotations = [];
    const seen = new Set();

    // Net-worth upward threshold crossings
    for (let i = 1; i < nwSeries.length; i++) {
        const prev = nwSeries[i - 1];
        const cur = nwSeries[i];
        for (const t of MILESTONE_NW_THRESHOLDS) {
            if (seen.has(t)) continue;
            if (prev < t && cur >= t) {
                seen.add(t);
                annotations.push({
                    id: `milestone-nw-${t}`,
                    type: 'line',
                    xMin: dates[i],
                    xMax: dates[i],
                    borderColor: 'rgba(40, 167, 69, 0.6)',
                    borderWidth: 1.5,
                    borderDash: [4, 3],
                    label: {
                        display: true,
                        content: `🏁 ${formatCurrency(t, 'usd')}`,
                        position: 'start',
                        backgroundColor: 'rgba(40, 167, 69, 0.9)',
                        color: '#fff',
                        font: { size: 10, weight: 'bold' },
                        padding: 3,
                        yAdjust: 4
                    }
                });
                break;
            }
        }
    }

    // Loan payoff dates: first time balance drops to ~0 from positive
    for (const loan of state.loans) {
        if (!loan.isEnabled) continue;
        const arr = dataCache.balances[loan.name];
        if (!arr) continue;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i - 1] > 0.01 && arr[i] <= 0.01) {
                annotations.push({
                    id: `milestone-loan-${loan.id}`,
                    type: 'line',
                    xMin: dates[i],
                    xMax: dates[i],
                    borderColor: 'rgba(108, 117, 125, 0.55)',
                    borderWidth: 1.5,
                    borderDash: [3, 4],
                    label: {
                        display: true,
                        content: `💳 ${loan.name} paid`,
                        position: 'end',
                        backgroundColor: 'rgba(108, 117, 125, 0.9)',
                        color: '#fff',
                        font: { size: 10 },
                        padding: 3
                    }
                });
                break;
            }
        }
    }
    return annotations;
}

function toggleMilestones() {
    showMilestones = !showMilestones;
    const btn = document.getElementById('milestones-btn');
    if (btn) {
        btn.classList.toggle('active', showMilestones);
        btn.setAttribute('aria-pressed', String(showMilestones));
    }
    refreshChartAnnotations();
}

// Unified annotation refresh: vertical lines + min cash + milestones
function refreshChartAnnotations() {
    if (!chartInstance) return;
    const annotations = generateVerticalLines(FULL_START_DATE, FULL_END_DATE);
    if (document.getElementById('showMinCashLine')?.checked) {
        const dates = chartInstance.data.labels;
        const cashDataset = chartInstance.data.datasets.find(ds => ds.label === 'Cash');
        if (dates && cashDataset) {
            const minCashLine = getMinCashAnnotation(dates, { Cash: cashDataset.data });
            if (minCashLine) annotations.push(...minCashLine);
        }
    }
    annotations.push(...getMilestoneAnnotations());
    if (chartInstance.options.plugins.annotation) {
        chartInstance.options.plugins.annotation.annotations = annotations;
    }
    chartInstance.update('none');
}

// --- Scenario overlay (compare net worth across scenarios) ---
function toggleScenarioOverlay() {
    scenarioOverlay.enabled = !scenarioOverlay.enabled;
    const bar = document.getElementById('scenario-overlay-bar');
    const btn = document.getElementById('compare-btn');
    if (btn) {
        btn.classList.toggle('active', scenarioOverlay.enabled);
        btn.setAttribute('aria-pressed', String(scenarioOverlay.enabled));
    }
    if (scenarioOverlay.enabled) {
        // Default unit: first non-USD with >1 scenario
        if (!scenarioOverlay.unitId) {
            const candidate = state.units.find(u => !u.isDefault && new Set(u.priceTargets.map(t => t.scenario || 'Base')).size > 1)
                           || state.units.find(u => !u.isDefault);
            if (candidate) scenarioOverlay.unitId = candidate.id;
        }
        renderScenarioOverlayBar();
        bar?.classList.remove('hidden');
        applyScenarioOverlay();
    } else {
        bar?.classList.add('hidden');
        applyScenarioOverlay();
    }
}

const SCENARIO_COLORS = { Bear: '#dc3545', Bull: '#28a745', Mid: '#007bff', Base: '#6c757d' };
const scenarioColor = (name) => SCENARIO_COLORS[name] || '#fd7e14';

function renderScenarioOverlayBar() {
    const bar = document.getElementById('scenario-overlay-bar');
    if (!bar) return;
    const nonDefaultUnits = state.units.filter(u => !u.isDefault);
    if (nonDefaultUnits.length === 0) {
        bar.innerHTML = `<span class="so-label">No non-USD units defined. Add a unit (e.g. a stock) to compare scenarios.</span>`;
        return;
    }
    if (!scenarioOverlay.unitId || !state.units.find(u => u.id === scenarioOverlay.unitId)) {
        scenarioOverlay.unitId = nonDefaultUnits[0].id;
    }
    const unit = state.units.find(u => u.id === scenarioOverlay.unitId);
    const scenarios = [...new Set(unit.priceTargets.map(t => t.scenario || 'Base').concat(unit.activeScenario || 'Base'))];
    bar.innerHTML = `
        <span class="so-label">Compare net worth across scenarios for</span>
        <select id="so-unit-select" title="Which unit's scenarios to overlay">
            ${nonDefaultUnits.map(u => `<option value="${u.id}" ${u.id === unit.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
        ${scenarios.map(s => {
            const active = scenarioOverlay.scenarios.has(s);
            return `<span class="so-chip ${active ? 'active' : ''}" data-toggle-scenario="${escapeHtml(s)}" role="checkbox" aria-checked="${active}" tabindex="0"><span class="so-chip-color" style="background:${scenarioColor(s)}"></span>${escapeHtml(s)}</span>`;
        }).join('')}
        <button onclick="clearScenarioOverlay()" title="Remove all overlays">Clear</button>
        <span class="tp-sub" style="margin-left:auto;opacity:0.6">Dashed = overlay · Solid heavy = active</span>
    `;
    bar.querySelector('#so-unit-select')?.addEventListener('change', (e) => {
        scenarioOverlay.unitId = e.target.value;
        scenarioOverlay.scenarios.clear();
        renderScenarioOverlayBar();
        applyScenarioOverlay();
    });
    bar.querySelectorAll('[data-toggle-scenario]').forEach(el => {
        const toggle = () => {
            const s = el.dataset.toggleScenario;
            if (scenarioOverlay.scenarios.has(s)) scenarioOverlay.scenarios.delete(s);
            else scenarioOverlay.scenarios.add(s);
            renderScenarioOverlayBar();
            applyScenarioOverlay();
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    });
}

function clearScenarioOverlay() {
    scenarioOverlay.scenarios.clear();
    renderScenarioOverlayBar();
    applyScenarioOverlay();
}

// Recomputes balances for each selected scenario and overlays NW lines.
// Note: temporarily mutates unit.activeScenario; always restored in finally.
function applyScenarioOverlay() {
    if (!chartInstance) return;
    // Strip any existing overlay datasets
    chartInstance.data.datasets = chartInstance.data.datasets.filter(ds => !ds._scenarioOverlay);

    if (!scenarioOverlay.enabled || scenarioOverlay.scenarios.size === 0 || !scenarioOverlay.unitId) {
        chartInstance.update('none');
        return;
    }
    const unit = state.units.find(u => u.id === scenarioOverlay.unitId);
    if (!unit) {
        chartInstance.update('none');
        return;
    }
    const originalActive = unit.activeScenario;
    try {
        for (const scenarioName of scenarioOverlay.scenarios) {
            unit.activeScenario = scenarioName;
            const scenarioData = calculateBalances();
            const nwSeries = computeNetWorthSeries(scenarioData);
            if (!nwSeries) continue;
            const isActive = scenarioName === originalActive;
            chartInstance.data.datasets.push({
                label: `NW (${scenarioName}${isActive ? ', active' : ''})`,
                data: nwSeries,
                borderColor: scenarioColor(scenarioName),
                backgroundColor: 'transparent',
                borderWidth: isActive ? 2.5 : 2,
                borderDash: isActive ? [] : [6, 5],
                pointRadius: 0,
                fill: false,
                tension: 0.1,
                yAxisID: 'y',
                _scenarioOverlay: true
            });
        }
    } finally {
        unit.activeScenario = originalActive;
        // dataCache is not invalidated: we restored activeScenario, so the
        // already-cached "active scenario" data remains correct.
    }
    chartInstance.update('none');
}

// --- Sell shares modal ---
function openSellModal(unitId) {
    const unit = state.units.find(u => u.id === unitId);
    if (!unit || unit.isDefault) return;

    const sources = state.accounts.filter(a => (a.units || 'usd') === unitId);
    if (sources.length === 0) {
        showToast(`No accounts hold ${unit.name}. Create an account with units = ${unit.name} first.`, 'error', 5000);
        return;
    }
    const cashAccts = state.accounts.filter(a => (a.units || 'usd') === 'usd');
    if (cashAccts.length === 0) {
        showToast('No USD account to receive proceeds.', 'error');
        return;
    }
    const scenarios = [...new Set(unit.priceTargets.map(t => t.scenario || 'Base').concat(unit.activeScenario || 'Base'))];

    document.getElementById('sell-modal')?.remove();
    const returnFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.id = 'sell-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-card" role="dialog" aria-labelledby="sm-title" aria-modal="true">
            <h3 id="sm-title">Sell ${escapeHtml(unit.name)}</h3>
            <div class="modal-row"><label for="sm-shares">Shares</label><input type="number" id="sm-shares" step="any" min="0" value="100"></div>
            <div class="modal-row"><label for="sm-date">Date</label><input type="date" id="sm-date" value="${toYMD(todayUTC())}"></div>
            <div class="modal-row"><label for="sm-scenario">Scenario (preview only)</label>
                <select id="sm-scenario">
                    ${scenarios.map(s => `<option value="${escapeHtml(s)}" ${s === (unit.activeScenario || 'Base') ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                </select>
            </div>
            <div class="modal-row"><label for="sm-source">From account</label>
                <select id="sm-source">
                    ${sources.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)} (${(a.balance || 0).toLocaleString()} ${escapeHtml(unit.symbol || unit.name)})</option>`).join('')}
                </select>
            </div>
            <div class="modal-row"><label for="sm-dest">To (USD) account</label>
                <select id="sm-dest">
                    ${cashAccts.map(a => `<option value="${escapeHtml(a.name)}" ${a.name === 'Cash' ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                </select>
            </div>
            <div class="modal-row"><label for="sm-tax">Tax rate %</label><input type="number" id="sm-tax" step="0.1" min="0" max="60" value="${state.settings?.lastSellTaxRate ?? 23.8}"></div>
            <div class="modal-preview" id="sm-preview">—</div>
            <div class="modal-actions">
                <button id="sm-cancel">Cancel</button>
                <button id="sm-submit" class="btn-primary">Add sale transaction</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
    modal.addEventListener('keydown', event => trapFocus(event, modal));

    const sharesEl = modal.querySelector('#sm-shares');
    const dateEl = modal.querySelector('#sm-date');
    const scenarioEl = modal.querySelector('#sm-scenario');
    const sourceEl = modal.querySelector('#sm-source');
    const destEl = modal.querySelector('#sm-dest');
    const taxEl = modal.querySelector('#sm-tax');
    const previewEl = modal.querySelector('#sm-preview');

    const priceAt = (date, scenarioName) => {
        const originalActive = unit.activeScenario;
        unit.activeScenario = scenarioName;
        try { return getEffectiveUsdRate(unit.id, date); }
        finally { unit.activeScenario = originalActive; }
    };

    const updatePreview = () => {
        const shares = parseFloat(sharesEl.value) || 0;
        const date = parseYMD(dateEl.value) || todayUTC();
        const scenarioName = scenarioEl.value;
        const taxRate = (parseFloat(taxEl.value) || 0) / 100;
        const pricePerShare = priceAt(date, scenarioName);
        const gross = shares * pricePerShare;
        const tax = gross * taxRate;
        const net = gross - tax;
        previewEl.innerHTML = `
            Price per share (${escapeHtml(scenarioName)} @ ${escapeHtml(dateEl.value)}): <b>${formatCurrency(pricePerShare, 'usd')}</b><br>
            Gross proceeds: ${formatCurrency(gross, 'usd')}<br>
            Tax @ ${(taxRate * 100).toFixed(1)}%: −${formatCurrency(tax, 'usd')}<br>
            <span class="mp-final">Net to cash: ${formatCurrency(net, 'usd')}</span>
        `;
    };
    [sharesEl, dateEl, scenarioEl, taxEl].forEach(el => el.addEventListener('input', updatePreview));
    scenarioEl.addEventListener('change', updatePreview);
    updatePreview();

    const close = () => {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
            if (returnFocus?.isConnected) returnFocus.focus();
            else focusPlanner();
        }, 160);
    };
    modal.querySelector('#sm-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#sm-submit').addEventListener('click', () => {
        const shares = parseFloat(sharesEl.value) || 0;
        if (shares <= 0) { showToast('Enter a positive number of shares.', 'error'); return; }
        const dateStr = dateEl.value;
        if (!parseYMD(dateStr)) { showToast('Pick a valid date.', 'error'); return; }
        const source = sourceEl.value;
        const dest = destEl.value;
        const taxPct = parseFloat(taxEl.value) || 0;
        const taxRate = taxPct / 100;

        state.settings = state.settings || {};
        state.settings.lastSellTaxRate = taxPct;

        // Sale transaction: shares in native units, from holding → dest cash account.
        // The forecast engine converts via getEffectiveUsdRate at the txn date.
        const sellTx = {
            id: genId('tx'),
            type: 'OneTime',
            name: `Sell ${shares} ${unit.symbol || unit.name}`,
            amount: shares,
            units: unit.id,
            from_account: source,
            to_account: dest,
            start_date: dateStr,
            isEnabled: true
        };
        state.transactions.unshift(sellTx);
        state.transactionPlotOptions[sellTx.id] = true;

        // Tax expense (USD out of dest, money leaves system)
        if (taxRate > 0) {
            const pricePerShare = priceAt(parseYMD(dateStr), scenarioEl.value);
            const taxAmount = shares * pricePerShare * taxRate;
            const taxTx = {
                id: genId('tx'),
                type: 'OneTime',
                name: `Tax on ${shares} ${unit.symbol || unit.name} sale`,
                amount: taxAmount,
                units: 'usd',
                from_account: dest,
                to_account: '',
                start_date: dateStr,
                isEnabled: true
            };
            state.transactions.unshift(taxTx);
            state.transactionPlotOptions[taxTx.id] = true;
        }

        invalidateTransactionCache();
        invalidateDataCache();
        renderAll();
        recalculateAndDraw();
        saveToLocalStorageDebounced();
        showToast(`Sale of ${shares} ${unit.symbol || unit.name} added (open the Transactions section to view).`, 'success', 3500);
        close();
    });
    sharesEl.focus();
}

// Global Escape key closes the sell modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const m = document.getElementById('sell-modal');
        if (m) m.querySelector('#sm-cancel')?.click();
    }
});

// --- Chart Duration Label Functions ---
function updateChartDurationLabel() {
    const durationLabel = document.getElementById('chart-duration-label');
    if (!durationLabel || !currentViewStart || !currentViewEnd) return;

    const timeDiffMs = currentViewEnd.getTime() - currentViewStart.getTime();
    const daysDiff = timeDiffMs / (1000 * 60 * 60 * 24);
    const monthsDiff = daysDiff / 30.44; // Average month length
    const yearsDiff = daysDiff / 365.25; // Average year length

    let durationText;
    if (yearsDiff >= 1) {
        // Show in years if 1 year or more
        const roundedYears = Math.round(yearsDiff);
        if (roundedYears === 1) {
            durationText = '1 year';
        } else {
            durationText = `${roundedYears} years`;
        }
    } else {
        // Show in months if less than 1 year
        const months = Math.round(monthsDiff);
        if (months === 1) {
            durationText = '1 month';
        } else {
            durationText = `${months} months`;
        }
    }

    durationLabel.textContent = durationText;
    syncRangePresets();
    updateCashExtremaLabels();
    updateTodayPanel();
    refreshChartAnnotations();
    if (scenarioOverlay.enabled) applyScenarioOverlay();
}

function toggleMinCashLine() {
    if (!chartInstance) return;
    refreshChartAnnotations();
}

function updateCashExtremaLabels() {
    const minValueEl = document.getElementById('chart-min-cash-value');
    const firstNegativeEl = document.getElementById('chart-first-negative-value');
    const maxValueEl = document.getElementById('chart-max-cash-value');
    const lastValueEl = document.getElementById('chart-last-cash-value');
    const avgDeltaEl = document.getElementById('chart-avg-monthly-delta');
    const avgInEl = document.getElementById('chart-avg-monthly-in');
    const avgOutEl = document.getElementById('chart-avg-monthly-out');
    if (!minValueEl || !firstNegativeEl || !maxValueEl || !lastValueEl) return;

    const resetExtrema = () => {
        minValueEl.textContent = '—';
        firstNegativeEl.textContent = 'N/A';
        maxValueEl.textContent = '—';
        lastValueEl.textContent = '—';
        if (avgDeltaEl) avgDeltaEl.textContent = '—';
        if (avgInEl) avgInEl.textContent = '—';
        if (avgOutEl) avgOutEl.textContent = '—';
    };

    if (!chartInstance || !Array.isArray(chartInstance.data?.labels)) {
        resetExtrema();
        return;
    }

    const cashDataset = chartInstance.data.datasets.find(ds => ds.label === 'Cash');
    if (!cashDataset || !Array.isArray(cashDataset.data)) {
        resetExtrema();
        return;
    }

    const labels = chartInstance.data.labels;
    const startTime = currentViewStart ? currentViewStart.getTime() : null;
    const endTime = currentViewEnd ? currentViewEnd.getTime() : null;

    if (startTime == null || endTime == null) {
        resetExtrema();
        return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let minDate = null;
    let firstNegativeDate = null;
    let lastValue = null;
    let lastIndex = -1;
    let firstValue = null;
    let firstDate = null;
    let lastDate = null;
    let hasValue = false;

    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        const labelDate = label instanceof Date ? label : new Date(label);
        const labelTime = labelDate.getTime();
        if (Number.isNaN(labelTime)) continue;
        if (labelTime < startTime || labelTime > endTime) continue;

        const value = cashDataset.data[i];
        if (typeof value !== 'number' || Number.isNaN(value)) continue;

        if (value < min) {
            min = value;
            minDate = labelDate;
        }
        if (value > max) {
            max = value;
        }
        if (!firstNegativeDate && value < 0) {
            firstNegativeDate = labelDate;
        }

        if (firstValue === null) {
            firstValue = value;
            firstDate = labelDate;
        }

        // Track the last (rightmost) value
        if (i > lastIndex) {
            lastIndex = i;
            lastValue = value;
            lastDate = labelDate;
        }

        hasValue = true;
    }

    if (!hasValue) {
        resetExtrema();
        return;
    }

    minValueEl.textContent = minDate ? `${formatCurrency(min, 'usd')} @ ${formatMonthYear(minDate)}` : formatCurrency(min, 'usd');
    firstNegativeEl.textContent = firstNegativeDate ? `<0 @ ${formatMonthYear(firstNegativeDate)}` : 'N/A';
    maxValueEl.textContent = formatCurrency(max, 'usd');
    lastValueEl.textContent = lastValue !== null ? formatCurrency(lastValue, 'usd') : '—';

    let monthsInRange = 0;
    if (firstDate && lastDate && lastDate > firstDate) {
        monthsInRange = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * (365.25 / 12));
    }

    if (avgDeltaEl) {
        if (firstValue !== null && lastValue !== null && monthsInRange > 0) {
            const avg = (lastValue - firstValue) / monthsInRange;
            const sign = avg >= 0 ? '+' : '−';
            avgDeltaEl.textContent = `${sign}${formatCurrency(Math.abs(avg), 'usd')}`;
            avgDeltaEl.title = `Average monthly change in Cash from ${formatMonthYear(firstDate)} to ${formatMonthYear(lastDate)} (${monthsInRange.toFixed(1)} months)`;
        } else {
            avgDeltaEl.textContent = '—';
        }
    }

    if (avgInEl && avgOutEl) {
        if (monthsInRange > 0 && firstDate && lastDate) {
            // Enumerate the actual transactions and loan payments that touch
            // Cash within the visible range. This gives accurate gross
            // inflow/outflow even when income and expenses occur on the same
            // day (which would otherwise net out in chart deltas).
            let inflowSum = 0;
            let outflowSum = 0;

            const rangeStart = firstDate;
            const rangeEnd = lastDate;

            const accumulate = (tx, date, amountUsd) => {
                if (!date || date < rangeStart || date > rangeEnd) return;
                if (!Number.isFinite(amountUsd) || amountUsd === 0) return;
                if (tx.to_account === 'Cash' && tx.from_account !== 'Cash') {
                    inflowSum += Math.abs(amountUsd);
                } else if (tx.from_account === 'Cash' && tx.to_account !== 'Cash') {
                    outflowSum += Math.abs(amountUsd);
                }
            };

            // Regular transactions
            (state.transactions || [])
                .filter(tx => tx && tx.isEnabled && (tx.from_account === 'Cash' || tx.to_account === 'Cash'))
                .forEach(txData => {
                    try {
                        new Transaction(txData).generateDates(rangeEnd).forEach(({ date, amount }) => {
                            accumulate(txData, date, amount);
                        });
                    } catch (e) { /* ignore one bad tx */ }
                });

            // Loan payments (always paid from Cash)
            (state.loans || [])
                .filter(loan => loan && loan.isEnabled)
                .forEach(loan => {
                    try {
                        const earlyPayoff = parseYMD(loan.early_payoff_date);
                        const pTx = new Transaction({
                            type: 'Monthly',
                            name: `${loan.name} Payment`,
                            amount: Math.abs(loan.monthly_payment || 0),
                            start_date: loan.start_date,
                            // BUGFIX: was loan.start_date (which produced no payments).
                            end_date: loan.early_payoff_date || loan.payoff_date,
                            day_of_month: loan.day_of_month || 1,
                            annual_growth: 1.0,
                            units: 'usd'
                        });
                        const payments = pTx.generateDates(rangeEnd);
                        const filtered = earlyPayoff ? payments.filter(p => p.date < earlyPayoff) : payments;
                        filtered.forEach(p => {
                            accumulate({ from_account: 'Cash', to_account: loan.name }, p.date, p.amount);
                        });
                    } catch (e) { /* ignore */ }
                });

            const avgIn = inflowSum / monthsInRange;
            const avgOut = outflowSum / monthsInRange;
            avgInEl.textContent = `+${formatCurrency(avgIn, 'usd')}`;
            avgOutEl.textContent = `−${formatCurrency(avgOut, 'usd')}`;
            const rangeNote = `${formatMonthYear(firstDate)} → ${formatMonthYear(lastDate)} (${monthsInRange.toFixed(1)} months)`;
            avgInEl.title = `Average monthly money INTO Cash (gross). ${rangeNote}`;
            avgOutEl.title = `Average monthly money OUT of Cash (gross, includes loan payments). ${rangeNote}`;
        } else {
            avgInEl.textContent = '—';
            avgOutEl.textContent = '—';
        }
    }
}

// --- Export/Import Functions ---
function exportToJSON(dataType = 'all') {
    const exportData = {};
    const timestamp = new Date().toISOString();

    // Capture open/closed state of collapsible sections for 'all' exports
    let openSections = {};
    if (dataType === 'all') {
        document.querySelectorAll('details.section-collapsible').forEach(details => {
            if (details.id) {
                openSections[details.id] = details.open;
            }
        });
    }

    switch (dataType) {
        case 'accounts':
            exportData.accounts = state.accounts;
            break;
        case 'loans':
            exportData.loans = state.loans;
            break;
        case 'transactions':
            exportData.transactions = state.transactions;
            break;
        case 'all':
        default:
            Object.assign(exportData, buildSerializableState(), { openSections });
            break;
    }

    exportData.exportTimestamp = timestamp;
    exportData.exportType = dataType;

    const jsonString = JSON.stringify(exportData, null, 2);

    // Update embedded data tag so Cmd+S / Save As preserves data in the HTML
    if (dataType === 'all') {
        const embeddedEl = document.getElementById('embedded-data');
        if (embeddedEl) {
            embeddedEl.textContent = JSON.stringify(exportData);
        }
    }

    // Create and trigger download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financial-forecast-${dataType}-${timestamp.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Also copy to clipboard for easy pasting
    if (!navigator.clipboard?.writeText) {
        showToast('Export downloaded. Clipboard copying is unavailable in this browser.', 'info');
        return jsonString;
    }
    navigator.clipboard.writeText(jsonString).then(() => {
        showToast('Export downloaded and copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        showToast('Export downloaded (clipboard copy failed)', 'info');
    });

    return jsonString;
}

function importFromJSON(jsonString) {
    try {
        const importData = JSON.parse(jsonString);
        const { applied, openSections } = applyImportedData(importData);
        if (!applied) {
            throw new Error('No importable data was found in the JSON payload.');
        }

        restoreOpenSections(openSections);
        renderAll();
        recalculateAndDraw();

        return true;
    } catch (error) {
        console.error('Failed to import JSON:', error);
        showToast(`Import failed: ${error.message || 'invalid JSON'}`, 'error', 4500);
        return false;
    }
}

function handleFileImport(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const jsonString = e.target.result;
        importFromJSON(jsonString);

        // Clear the file input so the same file can be imported again if needed
        input.value = '';
    };
    reader.readAsText(file);
}
function handleSidebarInput(e) {
    const el = e.target;

    // Skip processing if element is currently being edited inline
    if (el.dataset.editing === 'true') {
        return;
    }

    const { id, key } = el.dataset;
    if (!id || !key) return;

    // Handle units separately
    for (const unit of state.units) {
        if (unit.id === id) {
            const oldValue = unit[key];
            if (el.type === 'checkbox') {
                unit[key] = el.checked;
            } else if (el.type === 'number') {
                unit[key] = el.value !== '' ? parseFloat(el.value) : 0;
            } else {
                unit[key] = el.value;
            }

            if (key === 'name' || key === 'symbol') {
                // Update summary name display
                const summaryNameEl = document.querySelector(`details[data-id="${id}"] .summary-name`);
                if (summaryNameEl) {
                    summaryNameEl.textContent = `${unit.name} (${unit.symbol})`;
                    summaryNameEl.title = `${unit.name} (${unit.symbol})`;
                }
                // Debounce \u2014 unit names appear in select dropdowns; avoid full rerender per keystroke.
                renderAllDebounced();
            } else if (key === 'usdRate') {
                // Update summary display for exchange rate
                const summaryRateEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                if (summaryRateEl) {
                    summaryRateEl.value = parseFloat(unit.usdRate).toFixed(2);
                }
                // Recalculate when exchange rates change
                invalidateTransactionCache();
                invalidateDataCache();
                recalculateAndDraw();
            } else if (key === 'growthRate') {
                // Recalculate when growth rate changes
                invalidateTransactionCache();
                invalidateDataCache();
                recalculateAndDraw();
            } else if (key === 'growthEnabled') {
                invalidateTransactionCache();
                invalidateDataCache();
                renderAll();
                recalculateAndDraw();
            } else if (key === 'priceTargetDate' || key === 'priceTargetRate') {
                const targetId = el.dataset.targetId;
                if (!targetId) {
                    saveToLocalStorageDebounced();
                    return;
                }

                normalizeUnitPriceTargets(unit);
                let target = unit.priceTargets.find(pt => pt.id === targetId);
                if (!target) {
                    target = createPriceTarget(unit);
                    target.id = targetId;
                    unit.priceTargets.push(target);
                }

                if (key === 'priceTargetDate') {
                    target.date = el.value;
                } else {
                    // For rate field, store raw value without formatting during typing
                    target.usdRate = el.value === '' ? null : parseFloat(el.value);
                }

                const targetComplete = isValidPriceTarget(target);

                saveToLocalStorageDebounced();

                if (targetComplete) {
                    sortUnitPriceTargets(unit);
                    invalidateTransactionCache();
                    invalidateDataCache();
                    recalculateAndDraw();
                }
                return;
            }
            return;
        }
    }

    for (const c of ['accounts', 'loans', 'transactions', 'fees']) {
        let item = state[c].find(i => i.id === id);
        if (item) {
            const oldName = item.name;
            const oldValue = item[key];
            if (el.type === 'checkbox') {
                item[key] = el.checked;
            } else if (el.type === 'number') {
                // For number fields, always store as number, removing any currency formatting
                const cleanValue = el.value.replace(/[$,]/g, '');
                item[key] = cleanValue !== '' ? parseFloat(cleanValue) : 0;
            } else {
                item[key] = el.value;
            }

            // Invalidate cache if any data properties changed
            invalidateDataCache();

            // Update summary fields when key fields change
            if (key === 'name') {
                if(state.plotOptions[oldName]) {
                    state.plotOptions[item.name] = state.plotOptions[oldName];
                    delete state.plotOptions[oldName];
                }
                // Update summary name display
                const summaryNameEl = document.querySelector(`details[data-id="${id}"] [data-summary-field="name"]`);
                if (summaryNameEl) {
                    summaryNameEl.textContent = item.name;
                    summaryNameEl.title = item.name;
                }
                // Full re-render is needed so dependent <select> dropdowns (from_account /
                // to_account) show the new name. Debounce it so typing doesn't trigger a
                // full sidebar rebuild on every keystroke.
                renderAllDebounced();
            } else if (key === 'type' && c === 'transactions') {
                // When transaction type changes, set default values for required fields and re-render

                // Set default values based on transaction type
                switch (item.type) {
                    case 'Monthly':
                        if (!item.day_of_month) item.day_of_month = 1;
                        break;
                    case 'Weekly':
                        if (!item.day_of_week) item.day_of_week = 1; // Monday
                        break;
                    case 'BiWeekly':
                        if (!item.days_of_month) item.days_of_month = '1, 15';
                        break;
                    case 'Annual':
                        if (!item.day_of_month) item.day_of_month = 1;
                        if (!item.month_of_year) item.month_of_year = 1; // January
                        break;
                }

                renderAll(); // Re-render to show/hide appropriate fields
            } else if (key === 'balance' && c === 'accounts') {
                const summaryBalanceEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                if (summaryBalanceEl) {
                    summaryBalanceEl.value = formatCurrency(item.balance, item.units);
                }
            } else if (key === 'initial_balance' && c === 'loans') {
                const summaryBalanceEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                if (summaryBalanceEl) {
                    summaryBalanceEl.value = formatCurrency(item.initial_balance, item.units);
                }
                updateLoanCurrentBalanceEl(id, item);
            } else if ((key === 'interest_rate' || key === 'monthly_payment' || key === 'day_of_month' ||
                        key === 'payoff_date' || key === 'early_payoff_date' || key === 'start_date') && c === 'loans') {
                // All these keys can affect the loan's current balance and/or subtitle
                updateLoanCurrentBalanceEl(id, item);
                // Subtitle reflects: interest_rate, start_date, payoff_date, early_payoff_date
                if (key !== 'monthly_payment' && key !== 'day_of_month') {
                    rebuildSubtitleDOM(id, buildLoanSubtitleParts(item));
                }
            } else if ((key === 'end_date' || key === 'start_date') && c === 'transactions') {
                rebuildSubtitleDOM(id, buildTxSubtitleParts(item));
                const detailsEl = document.querySelector(`details[data-id="${id}"]`);
                if (detailsEl) detailsEl.classList.toggle('tx-stale', isTxFullyPast(item));
            } else if (key === 'amount' && c === 'transactions') {
                const summaryAmountEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                if (summaryAmountEl) {
                    summaryAmountEl.value = formatCurrency(item.amount, item.units);
                }
            } else if (key === 'units') {
                // When units change, update the summary display to reflect the new formatting
                if (c === 'accounts') {
                    const summaryBalanceEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                    if (summaryBalanceEl) {
                        summaryBalanceEl.value = formatCurrency(item.balance, item.units);
                    }
                } else if (c === 'loans') {
                    const summaryBalanceEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                    if (summaryBalanceEl) {
                        summaryBalanceEl.value = formatCurrency(item.initial_balance, item.units);
                    }
                } else if (c === 'transactions') {
                    const summaryAmountEl = document.querySelector(`details[data-id="${id}"] .summary-info input`);
                    if (summaryAmountEl) {
                        summaryAmountEl.value = formatCurrency(item.amount, item.units);
                    }
                }
                // Recalculate since units affect the USD conversion values
                // (the trailing recalculateAndDraw() below handles this; both are debounced)
            } else if (key === 'saleDate' && c === 'accounts') {
                // Live-update the sale-date badge in the collapsed summary row
                const nameSpan = document.querySelector(`details[data-id="${id}"] .summary-name`);
                if (nameSpan) {
                    nameSpan.querySelector('.acc-sale-badge')?.remove();
                    if (item.saleDate) {
                        const badge = document.createElement('span');
                        badge.className = 'acc-sale-badge';
                        badge.title = `Scheduled sale: ${item.saleDate}`;
                        badge.textContent = `\u2192 ${item.saleDate}`;
                        nameSpan.appendChild(badge);
                    }
                }
            } else if (key === 'linkedAccountId') {
                // Live-update the contingent-asset badge in the collapsed summary row
                const nameSpan = document.querySelector(`details[data-id="${id}"] .summary-name`);
                if (nameSpan) {
                    nameSpan.querySelector('.tx-contingent-badge')?.remove();
                    if (item.linkedAccountId) {
                        const linkedAcc = state.accounts.find(a => a.id === item.linkedAccountId);
                        if (linkedAcc) {
                            const badge = document.createElement('span');
                            badge.className = 'tx-contingent-badge';
                            const soldLabel = linkedAcc.saleDate ? ` \u2192 sold ${linkedAcc.saleDate}` : '';
                            badge.title = `Stops when ${linkedAcc.name} is sold`;
                            badge.innerHTML = `&#x26D3; ${escapeHtml(linkedAcc.name)}${escapeHtml(soldLabel)}`;
                            nameSpan.appendChild(badge);
                        }
                    }
                }
            }
            break;
        }
    }
    recalculateAndDraw();
}
async function handleSidebarClick(e) {
    const el = e.target;

    // Sell-shares quick action (opens modal)
    if (el.matches('[data-sell-unit]')) {
        e.stopPropagation();
        e.preventDefault();
        openSellModal(el.dataset.sellUnit);
        return;
    }

    if (el.matches('[data-add-price-target]')) {
        e.stopPropagation();
        const unitId = el.dataset.addPriceTarget;
        const unit = state.units.find(u => u.id === unitId);
        if (unit) {
            normalizeUnitPriceTargets(unit);
            const activeScenario = unit.activeScenario || 'Base';
            const scenarioTargets = unit.priceTargets.filter(t => (t.scenario || 'Base') === activeScenario && isValidPriceTarget(t));
            let nextYear;
            if (scenarioTargets.length > 0) {
                const dates = scenarioTargets.map(t => parseYMD(t.date) || new Date(t.date)).filter(d => !isNaN(d.getTime()));
                const maxDate = dates.reduce((a, b) => a > b ? a : b, dates[0]);
                nextYear = maxDate.getUTCFullYear() + 1;
            } else {
                nextYear = new Date().getFullYear() + 1;
            }
            const defaultDate = `${nextYear}-12-31`;
            const newTarget = createPriceTarget(unit, { date: defaultDate, usdRate: undefined });
            newTarget.usdRate = null;
            unit.priceTargets.push(newTarget);
            sortUnitPriceTargets(unit);
            renderAll();
            saveToLocalStorageDebounced();
            requestAnimationFrame(() => {
                const selector = `input[data-id="${unitId}"][data-target-id="${newTarget.id}"][data-key="priceTargetDate"]`;
                const focusEl = document.querySelector(selector);
                if (focusEl) {
                    focusEl.focus();
                }
            });
        }
        return;
    }

    if (el.matches('[data-remove-price-target]')) {
        e.stopPropagation();
        const unitId = el.dataset.removePriceTarget;
        const targetId = el.dataset.targetId;
        const unit = state.units.find(u => u.id === unitId);
        if (unit && Array.isArray(unit.priceTargets) && targetId) {
            normalizeUnitPriceTargets(unit);
            const index = unit.priceTargets.findIndex(pt => pt.id === targetId);
            if (index !== -1) {
                const [removed] = unit.priceTargets.splice(index, 1);
                sortUnitPriceTargets(unit);
                renderAll();
                saveToLocalStorageDebounced();
                if (isValidPriceTarget(removed)) {
                    invalidateTransactionCache();
                    invalidateDataCache();
                    recalculateAndDraw();
                }
            }
        }
        return;
    }

    if (el.matches('[data-switch-scenario]') && !el.matches('.scenario-delete')) {
        e.stopPropagation();
        const unitId = el.dataset.switchScenario;
        const scenario = el.dataset.scenario;
        const unit = state.units.find(u => u.id === unitId);
        if (unit && scenario) {
            // Delay to allow dblclick to intercept for rename
            clearTimeout(window._scenarioClickTimer);
            window._scenarioClickTimer = setTimeout(() => {
                unit.activeScenario = scenario;
                renderAll();
                saveToLocalStorageDebounced();
                invalidateTransactionCache();
                invalidateDataCache();
                recalculateAndDraw();
            }, 250);
        }
        return;
    }

    if (el.matches('[data-delete-scenario]')) {
        e.stopPropagation();
        const unitId = el.dataset.deleteScenario;
        const scenario = el.dataset.scenario;
        const unit = state.units.find(u => u.id === unitId);
        if (unit && scenario) {
            const hadValid = unit.priceTargets.some(t => (t.scenario || 'Base') === scenario && isValidPriceTarget(t));
            unit.priceTargets = unit.priceTargets.filter(t => (t.scenario || 'Base') !== scenario);
            if (unit.activeScenario === scenario) {
                const remaining = [...new Set(unit.priceTargets.map(t => t.scenario || 'Base'))];
                unit.activeScenario = remaining.length ? remaining[0] : 'Base';
            }
            renderAll();
            saveToLocalStorageDebounced();
            if (hadValid) {
                invalidateTransactionCache();
                invalidateDataCache();
                recalculateAndDraw();
            }
        }
        return;
    }

    if (el.matches('[data-add-scenario]')) {
        e.stopPropagation();
        const unitId = el.dataset.addScenario;
        const unit = state.units.find(u => u.id === unitId);
        if (unit) {
            const name = await showPlanDialog({ title: 'New price scenario', initialValue: '', confirmLabel: 'Create scenario' });
            if (name && name.trim()) {
                unit.activeScenario = name.trim();
                renderAll();
                saveToLocalStorageDebounced();
            }
        }
        return;
    }

    if (el.matches('[data-duplicate-scenario]')) {
        e.stopPropagation();
        const unitId = el.dataset.duplicateScenario;
        const unit = state.units.find(u => u.id === unitId);
        if (unit) {
            normalizeUnitPriceTargets(unit);
            const src = unit.activeScenario || 'Base';
            const existing = new Set(unit.priceTargets.map(t => t.scenario || 'Base'));
            let newName = `${src} (copy)`;
            let i = 2;
            while (existing.has(newName)) { newName = `${src} (copy ${i++})`; }
            const srcTargets = unit.priceTargets.filter(t => (t.scenario || 'Base') === src);
            srcTargets.forEach(t => {
                unit.priceTargets.push({
                    id: generatePriceTargetId(),
                    date: t.date,
                    usdRate: t.usdRate,
                    scenario: newName
                });
            });
            unit.activeScenario = newName;
            sortUnitPriceTargets(unit);
            renderAll();
            saveToLocalStorageDebounced();
            invalidateTransactionCache();
            invalidateDataCache();
            recalculateAndDraw();
        }
        return;
    }

    if (el.matches('[data-duplicate-id]')) {
        e.stopPropagation();
        const { duplicateId, type } = el.dataset;
        if (type === 'transaction') {
            duplicateTransaction(duplicateId);
        }
        return;
    }

    // Handle inline editing of summary fields
    if (el.matches('.summary-info input[readonly]')) {
        const { id, key, type } = el.dataset;
        if (!id || !key) {
            return;
        }

        // Find the item to get the raw value
        let item = null;
        let itemSource = null;
        for (const c of ['accounts', 'loans', 'transactions', 'units']) {
            item = state[c].find(i => i.id === id);
            if (item) {
                itemSource = c;
                break;
            }
        }

        if (!item) {
            return;
        }

        // Mark element as being edited to prevent handleSidebarInput interference
        el.dataset.editing = 'true';

        // Switch to edit mode
        el.removeAttribute('readonly');
        el.value = item[key]; // Set raw numeric value
        el.focus();
        el.select();

        // Prevent invalid input during typing for number fields
        const editController = new AbortController();
        if (type === 'number') {
            el.addEventListener('input', (e) => {
                const value = e.target.value;
                // Allow empty, partial negative signs, and valid number patterns
                if (value !== '' && value !== '-' && isNaN(parseFloat(value.replace(/[$,]/g, '')))) {
                    // If invalid, revert to previous valid value or empty
                    const cleanValue = value.replace(/[^0-9.-]/g, '');
                    if (cleanValue !== value) {
                        e.target.value = cleanValue;
                    }
                }
            }, { signal: editController.signal });
        }

        // Handle when editing is finished
        const finishEdit = () => {
            editController.abort();
            // Remove editing flag
            delete el.dataset.editing;

            let newValue = el.value.trim();

            // Remove currency formatting if present (dollar signs, commas)
            newValue = newValue.replace(/[$,]/g, '');

            // Parse as number, but handle empty/invalid inputs gracefully
            if (type === 'number') {
                if (newValue === '' || newValue === '-') {
                    newValue = 0;
                } else {
                    const parsed = parseFloat(newValue);
                    if (isNaN(parsed)) {
                        // Make sure original value is also a number
                        newValue = typeof item[key] === 'number' ? item[key] : 0;
                    } else {
                        newValue = parsed;
                    }
                }
            }

            item[key] = newValue;

            // Update the display value and make readonly again
            // Ensure we have a valid number before formatting
            let displayValue;
            if (type === 'number') {
                if (itemSource === 'units' && key === 'usdRate') {
                    displayValue = parseFloat(newValue).toFixed(2);
                } else if (key === 'balance' && item.units) {
                    displayValue = formatCurrency(newValue, item.units);
                } else if (key === 'amount' && item.units) {
                    displayValue = formatCurrency(newValue, item.units);
                } else {
                    displayValue = formatCurrency(newValue);
                }
            } else {
                displayValue = newValue;
            }
            el.value = displayValue;
            el.setAttribute('readonly', 'readonly');

            // Update the detailed form field if it exists
            const detailField = document.getElementById(`${id}_${key}`);
            if (detailField) {
                detailField.value = newValue;
            }

            // Trigger recalculation
            if (itemSource === 'units') {
                invalidateTransactionCache();
                invalidateDataCache();
            }
            // Update loan current balance display if relevant field changed
            if (itemSource === 'loans') {
                updateLoanCurrentBalanceEl(id, item);
            }
            recalculateAndDraw();
        };

        // Finish editing on blur or Enter key
        el.addEventListener('blur', finishEdit, { once: true });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                el.blur(); // This will trigger the blur handler
            } else if (e.key === 'Escape') {
                // Cancel editing - restore original value
                delete el.dataset.editing; // Clear editing flag
                let originalFormatted;
                if (itemSource === 'units' && key === 'usdRate') {
                    originalFormatted = parseFloat(item[key]).toFixed(2);
                } else {
                    originalFormatted = (type === 'number') ? formatCurrency(item[key]) : item[key];
                }
                el.value = originalFormatted;
                el.setAttribute('readonly', 'readonly');
            }
        }, { once: true });

        return;
    }

    // Existing click handlers
    if (el.matches('.summary-checkbox')) {
        if(el.dataset.plotItem) {
            // Plot visibility change - just update chart display, no data recalculation needed
            state.plotOptions[el.dataset.plotItem] = el.checked;
            updateChartVisibility(); // Fast update for plot visibility
        } else if (el.dataset.plotTxId) {
            // Transaction marker visibility change - chart update only
            state.transactionPlotOptions[el.dataset.plotTxId] = el.checked;
            updateChartVisibility();
        } else if(el.dataset.enableTxId) {
            // Transaction enable/disable - affects balance calculations
            const tx = state.transactions.find(t => t.id === el.dataset.enableTxId);
            if(tx) tx.isEnabled = el.checked;
            invalidateDataCache(); // Transaction changes require data regeneration
            recalculateAndDraw();
        } else if(el.dataset.enableLoanId) {
            // Loan enable/disable - affects balance calculations
            const loan = state.loans.find(l => l.id === el.dataset.enableLoanId);
            if(loan) loan.isEnabled = el.checked;
            invalidateDataCache(); // Loan changes require data regeneration
            recalculateAndDraw();
        } else if(el.dataset.key === 'growthEnabled' && el.dataset.id) {
            const unit = state.units.find(u => u.id === el.dataset.id);
            if (unit) {
                unit.growthEnabled = el.checked;
                invalidateTransactionCache();
                invalidateDataCache();
                renderAll();
                recalculateAndDraw();
            }
        }
    } else if (el.matches('[data-delete-id]')) {
        const { deleteId, type } = el.dataset;
        if (type === 'account') removeAccount(deleteId);
        else if (type === 'loan') removeLoan(deleteId);
        else if (type === 'transaction') removeTransaction(deleteId);
        else if (type === 'unit') removeUnit(deleteId);
        else if (type === 'fee') removeFee(deleteId);
    }
}
function throttle(func, delay) { let inProgress = false; return (...args) => { if (inProgress) return; inProgress = true; setTimeout(() => { func(...args); inProgress = false; }, delay); }; }

// --- Drag and Drop System (Live Preview) ---
let dragState = null;
let dragOverRAF = null;

function initializeDragAndDrop() {
    const sidebar = document.getElementById('sidebar');
    sidebar.addEventListener('dragstart', handleDragStart, true);
    sidebar.addEventListener('dragend', handleDragEnd, true);
    sidebar.addEventListener('dragover', handleDragOver);
    sidebar.addEventListener('drop', handleDrop);
}

function setupDragAndDrop() {}

function getSectionType(el) {
    const list = el.closest('#accounts-list, #loans-list, #transactions-list');
    if (!list) return null;
    if (list.id === 'accounts-list') return 'account';
    if (list.id === 'loans-list') return 'loan';
    if (list.id === 'transactions-list') return 'transaction';
    return null;
}

function handleDragStart(e) {
    const item = e.target.closest('.draggable-item');
    if (!item) return;
    e.stopPropagation();

    const sectionType = getSectionType(item);
    if (!sectionType) return;

    const dragCategory = item.dataset.groupType || item.dataset.type;

    dragState = {
        el: item,
        id: item.dataset.id,
        type: item.dataset.type,
        groupType: item.dataset.groupType || null,
        sectionType: sectionType,
        category: dragCategory,
        committed: false   // true once we write to state on drop
    };

    e.dataTransfer.effectAllowed = 'move';
    // Set a minimal drag image to prevent browser from ghosting the whole container
    const dragImage = item.cloneNode(true);
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-9999px';
    dragImage.style.width = item.offsetWidth + 'px';
    dragImage.style.opacity = '0.7';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
    setTimeout(() => {
        document.body.removeChild(dragImage);
        item.classList.add('dragging');
    }, 0);
}

function handleDragEnd(e) {
    if (!dragState) return;
    if (dragOverRAF) { cancelAnimationFrame(dragOverRAF); dragOverRAF = null; }
    const wasCommitted = dragState.committed;
    dragState.el.classList.remove('dragging');
    document.querySelectorAll('.group-container.drop-target').forEach(el => el.classList.remove('drop-target'));

    if (!wasCommitted) {
        // Drag cancelled — revert to original state
        renderAll();
    }
    dragState = null;
}

// --- dragover: live-preview by moving the DOM element ---

function handleDragOver(e) {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const mouseY = e.clientY;
    const eventTarget = e.target;
    if (dragOverRAF) return;
    dragOverRAF = requestAnimationFrame(() => {
        dragOverRAF = null;
        if (!dragState) return;
        _livePreview(mouseY, eventTarget);
    });
}

function _livePreview(mouseY, eventTarget) {
    const { el: dragEl, category: dragCategory, sectionType, type: dragType } = dragState;

    // Remove previous group highlight
    document.querySelectorAll('.group-container.drop-target').forEach(el => el.classList.remove('drop-target'));

    // --- Case A: non-group item over a group container ---
    if (dragType !== 'group') {
        const gc = eventTarget.closest('.group-container');
        if (gc && gc !== dragEl) {
            const groupType = gc.dataset.groupType;
            if (groupType === dragCategory) {
                // Over a specific item inside the group?
                const itemInGroup = eventTarget.closest('.group-contents > .draggable-item');
                if (itemInGroup && itemInGroup !== dragEl) {
                    _moveDomNode(dragEl, itemInGroup, mouseY);
                    return;
                }
                // Over the group itself — move into group-contents at end
                const contents = gc.querySelector('.group-contents');
                if (contents && dragEl.parentNode !== contents) {
                    _flipMove(() => contents.appendChild(dragEl));
                }
                gc.classList.add('drop-target');
                return;
            }
        }
    }

    // --- Case B: over a top-level item / group in the same section ---
    const listEl = document.getElementById(`${sectionType}s-list`);
    if (!listEl) return;

    let target = eventTarget.closest('.draggable-item');
    // Walk up to a direct child of the list
    while (target && target.parentNode !== listEl) {
        if (target.parentNode && target.parentNode.classList.contains('group-contents')) {
            // We're inside a group — already handled in Case A above for non-group items.
            // For group-type drags, we just bail.
            return;
        }
        target = target.parentNode ? target.parentNode.closest('.draggable-item') : null;
    }
    if (!target || target === dragEl) return;

    const targetCategory = target.dataset.groupType || target.dataset.type;
    if (targetCategory !== dragCategory) return;

    // If the dragged item is inside a group-contents but we're hovering top-level,
    // just let _moveDomNode pull it out.
    _moveDomNode(dragEl, target, mouseY);
}

// Move dragEl before or after refEl based on mouseY, with FLIP animation on siblings
function _moveDomNode(dragEl, refEl, mouseY) {
    const rect = refEl.getBoundingClientRect();
    const before = mouseY < rect.top + rect.height / 2;
    const parent = refEl.parentNode;
    const desiredNext = before ? refEl : refEl.nextSibling;

    // Already in the right position? Skip to avoid unnecessary work.
    if (dragEl.parentNode === parent && dragEl.nextSibling === desiredNext) return;

    _flipMove(() => parent.insertBefore(dragEl, desiredNext));
}

// Execute a DOM mutation with FLIP animation on siblings
function _flipMove(mutationFn) {
    if (!dragState) { mutationFn(); return; }
    // Capture first rects of siblings (not the dragged item — it's being moved by cursor)
    const siblings = _getAnimatableSiblings();
    const firstRects = new Map();
    siblings.forEach(el => firstRects.set(el, el.getBoundingClientRect()));

    mutationFn();

    // FLIP: animate siblings from old position to new
    siblings.forEach(el => {
        const first = firstRects.get(el);
        if (!first) return;
        const last = el.getBoundingClientRect();
        const dy = first.top - last.top;
        if (Math.abs(dy) < 2) return;
        el.style.transform = `translateY(${dy}px)`;
        el.style.transition = 'none';
        el.offsetHeight; // force reflow
        el.style.transition = 'transform 150ms ease';
        el.style.transform = '';
        el.addEventListener('transitionend', function cleanup() {
            el.style.transition = '';
            el.style.transform = '';
            el.removeEventListener('transitionend', cleanup);
        });
    });
}

function _getAnimatableSiblings() {
    // All draggable items in the sidebar except the one being dragged
    const all = document.querySelectorAll('#sidebar .draggable-item');
    const result = [];
    for (const el of all) {
        if (dragState && el === dragState.el) continue;
        result.push(el);
    }
    return result;
}

// --- drop: commit the visible DOM order to state ---

function handleDrop(e) {
    e.preventDefault();
    if (!dragState) return;

    dragState.committed = true;
    dragState.el.classList.remove('dragging');
    document.querySelectorAll('.group-container.drop-target').forEach(el => el.classList.remove('drop-target'));

    _commitDomOrderToState();
    // Re-render to get a clean DOM that matches state exactly
    renderAll();
    saveToLocalStorageDebounced();
}

function _commitDomOrderToState() {
    // Read each section list's DOM order and write it back to state
    ['account', 'loan', 'transaction'].forEach(type => {
        const listEl = document.getElementById(`${type}s-list`);
        if (!listEl) return;

        const items = getItemArrayForType(type);
        const groups = getGroupArrayForType(type);

        // Clear all group memberships for this type
        groups.forEach(g => g.items = []);

        let posIdx = 0;
        // Walk direct children of the list in DOM order
        for (const child of listEl.children) {
            if (!child.classList.contains('draggable-item')) continue;

            if (child.dataset.type === 'group') {
                // It's a group container
                const gId = child.dataset.id;
                const group = groups.find(g => g.id === gId);
                if (group) {
                    group.positionIndex = posIdx++;
                    // Read items inside this group's .group-contents
                    const contents = child.querySelector('.group-contents');
                    if (contents) {
                        for (const inner of contents.children) {
                            if (!inner.classList.contains('draggable-item')) continue;
                            group.items.push(inner.dataset.id);
                        }
                    }
                }
            } else {
                // Ungrouped item
                const itemId = child.dataset.id;
                const item = items.find(i => i.id === itemId);
                if (item) {
                    item.positionIndex = posIdx++;
                }
            }
        }
    });
}

// --- Reorder helpers (kept for non-drag operations) ---

function getGroupArrayForType(type) {
    switch (type) {
        case 'account': return state.accountGroups;
        case 'loan': return state.loanGroups;
        case 'transaction': return state.transactionGroups;
        default: return [];
    }
}

function getItemArrayForType(type) {
    switch (type) {
        case 'account': return state.accounts;
        case 'loan': return state.loans;
        case 'transaction': return state.transactions;
        default: return [];
    }
}

function normalizePositions(category) {
    const items = getItemArrayForType(category);
    const groups = getGroupArrayForType(category);

    const topLevel = [];
    const ungrouped = items.filter(i => !getItemGroup(category, i.id));
    ungrouped.forEach(item => {
        topLevel.push({
            kind: 'item',
            id: item.id,
            pos: item.positionIndex !== undefined ? item.positionIndex : items.indexOf(item)
        });
    });
    groups.forEach((group, idx) => {
        topLevel.push({
            kind: 'group',
            id: group.id,
            pos: group.positionIndex !== undefined ? group.positionIndex : idx * 1000
        });
    });
    topLevel.sort((a, b) => a.pos - b.pos);

    topLevel.forEach((entry, idx) => {
        if (entry.kind === 'group') {
            const g = groups.find(gr => gr.id === entry.id);
            if (g) g.positionIndex = idx;
        } else {
            const item = items.find(i => i.id === entry.id);
            if (item) item.positionIndex = idx;
        }
    });
}

async function initialize() {
    // Try to load a saved scenario first, then fall back to the working snapshot.
    const loadedScenarioRegistry = loadScenarioRegistry();
    let loadedFromStorage = false;

    if (loadedScenarioRegistry) {
        const activeScenario = getActiveScenarioRecord();
        if (activeScenario) {
            const { applied, openSections } = applyImportedData(activeScenario.snapshot);
            if (applied) {
                restoreOpenSections(openSections);
                loadedFromStorage = true;
            }
        }
    }

    if (!loadedFromStorage) {
        loadedFromStorage = loadFromLocalStorage();

        if (!loadedFromStorage) {
        let defaultData = null;

        // Try embedded data first (works on file:// protocol)
        try {
            const embeddedEl = document.getElementById('embedded-data');
            if (embeddedEl) {
                const parsed = JSON.parse(embeddedEl.textContent);
                if (parsed && typeof parsed === 'object' && (parsed.accounts || parsed.loans || parsed.transactions)) {
                    defaultData = parsed;
                }
            }
        } catch (e) { /* no embedded data */ }

        // Fall back to fetching JSON file (only works over HTTP)
        if (!defaultData) {
            const defaultPath = resolveDefaultDataPath();
            if (defaultPath) {
                defaultData = await loadDefaultDataFromFile(defaultPath);
                if (!defaultData) {
                    console.warn(`Default data file "${defaultPath}" could not be loaded; falling back to embedded defaults.`);
                }
            }
        }

        const { applied, openSections } = applyImportedData(defaultData);
        if (applied) {
            restoreOpenSections(openSections);
        }
        }
    }

    // Guarantee a Default scenario exists now that data is loaded
    ensureDefaultScenario();

    const sidebarEl = document.getElementById('sidebar');
    sidebarEl.addEventListener('input', handleSidebarInput);
    sidebarEl.addEventListener('change', handleSidebarInput); // Also listen for change events
    sidebarEl.addEventListener('click', handleSidebarClick);
    sidebarEl.addEventListener('dblclick', async (e) => {
        const el = e.target.closest('[data-switch-scenario]');
        if (!el || el.matches('.scenario-delete')) return;
        e.stopPropagation();
        clearTimeout(window._scenarioClickTimer);
        const unitId = el.dataset.switchScenario;
        const oldName = el.dataset.scenario;
        const unit = state.units.find(u => u.id === unitId);
        if (!unit || !oldName) return;
        const newName = await showPlanDialog({ title: 'Rename price scenario', initialValue: oldName, confirmLabel: 'Rename' });
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        const trimmed = newName.trim();
        const existing = new Set(unit.priceTargets.map(t => t.scenario || 'Base'));
        if (existing.has(trimmed)) { showToast('A scenario with that name already exists.', 'error'); return; }
        unit.priceTargets.forEach(t => { if ((t.scenario || 'Base') === oldName) t.scenario = trimmed; });
        if (unit.activeScenario === oldName) unit.activeScenario = trimmed;
        renderAll();
        saveToLocalStorageDebounced();
    });
    initializeWorkspace();

    // Initialize drag and drop functionality
    initializeDragAndDrop();

    renderAll();
    recalculateAndDraw();

    // Restore freeze Y button state
    if (state.yAxisFrozen) {
        const btn = document.getElementById('freeze-y-btn');
        btn.classList.add('active');
        btn.innerHTML = '&#x1f512; Y';
        btn.title = 'Unfreeze Y-axis scale';
        btn.setAttribute('aria-pressed', 'true');
    }

    // Post-init: if Net Worth was saved as visible, trigger a second draw
    // after the chart has been created (update path reliably injects the dataset)
    if (showNetWorth) {
        setTimeout(() => recalculateAndDraw(), 350);
    }
}

// End of script - initialization handled above
