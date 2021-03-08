import * as dotenv from 'dotenv'
import * as R from 'ramda';
import OpenAPI from '@tinkoff/invest-openapi-js-sdk';
import {exchangeRates} from 'exchange-rates-api';

dotenv.config();

const api = new OpenAPI({
    apiURL: 'https://api-invest.tinkoff.ru/openapi',
    secretToken: process.env.TOKEN,
    socketURL: 'wss://api-invest.tinkoff.ru/openapi/md/v1/md-openapi/ws'
});

const accounts = (await api.accounts()).accounts,
    usdRates = {},
    average = R.converge(R.divide, [R.sum, R.length]),
    withExpectedYieldPercent = pos => {
        pos.expectedYield.percent = pos.expectedYield.value * 100 / pos.totalPrice.value;
        return pos;
    },
    mergeMoneyObjects = (a, b) => {
        if (!R.eqProps('currency')(a, b)) {
            throw new Error(`Can't merge objects in different currencies. Try defining the 'inCurrency' attribute in the request`);
        }
        const result = {
            ...a,
            value: a.value + b.value
        };
        if (!R.eqProps('originalCurrency')(a, b)) {
            delete result.originalCurrency;
        }
        return result;
    },
    _mergePositionsReducer = (a, b) => {
        const result = R.mergeWith((prop1, prop2) => {
            if (isMoneyObject(prop1)) {
                return mergeMoneyObjects(prop1, prop2);
            } else if (typeof prop1 == 'number') {
                return prop1 + prop2;
            } else {
                return prop1;
            }
        })(a, b);

        result.averagePositionPrice.value /= 2;

        return withExpectedYieldPercent(result)
    },
    mergePositions = (positions) => {
        return positions.reduce(_mergePositionsReducer);
    },

    _portfolioPositions = await _getPortfolioPositions(),
    _getPositionByFigi = figi => R.find(R.propEq('figi', figi))(_portfolioPositions),
    addTickerAndName = operation => {
        const {ticker, name} = _getPositionByFigi(operation.figi);
        return {
            ticker,
            name,
            ...operation
        }
    };

function setPrimaryAccount() {
    api.setCurrentAccountId(accounts[0].brokerAccountId);
}

async function preloadRate(from, to) {
    if (!usdRates[from]) {
        usdRates[from] = await exchangeRates().base(from).symbols(to).fetch();
    }
}

function getRate(currency) {
    return usdRates[currency] || 1;
}

function formatMoney(value, symbol) {
    return value.toLocaleString('ru-RU', {
        style: 'currency',
        currency: symbol,
    });
}

function formatMoneyObject(obj) {
    const {value, currency, percent} = obj,
        result = {
            ...obj,
            value: formatMoney(value, currency)
        };

    if (!!percent) {
        result.percent = `${percent.toFixed(2)} %`
    }

    return result;
}

function isMoneyObject(obj) {
    const has = R.has(R.__, obj);
    return has('value') && has('currency');
}

function prettifyMoneyValues(position) {
    const result = mapValuesIn(position, formatMoneyObject, isMoneyObject);
    if (position.price) {
        result.price = formatMoney(position.price, position.currency);
        result.payment = formatMoney(position.payment, position.currency);
    }
    return result;
}

function mapValuesIn(obj, mapper, predicate = R.T) {
    return Object.fromEntries(
        Object.entries(obj)
            .map(([key, value]) => [key, predicate(value) ? mapper(value) : value])
    );
}

async function forEachAccount(op) {
    const result = await Promise.all(accounts.reduce((acc, it) => {
        api.setCurrentAccountId(it.brokerAccountId);
        return acc.concat(op());
    }, []));
    setPrimaryAccount();

    return result.flatMap(R.identity);
}

async function _getPortfolioPositions() {
    const getPositions = () => api.portfolio().then(R.prop('positions'));
    return forEachAccount(getPositions);
}

async function purchases(from, to) {
    const getOperations = () => api.operations({
        from: from.toISOString(),
        to: to.toISOString()
    }).then(R.prop('operations'));

    return (await forEachAccount(getOperations))
        .filter(it => it.operationType === 'Buy' && it.status === 'Done')
        .map(addTickerAndName)
}

// noinspection JSUnusedGlobalSymbols
async function currencySells(from, to) {
    const operations = (await api.operations({from: from.toISOString(), to: to.toISOString()})).operations
            .filter(it => it.operationType === 'Sell' && it.status === 'Done' && it.instrumentType === 'Currency'),

        quantity = R.sum(operations.map(R.prop('quantity'))),
        payment = R.sum(operations.map(R.prop('payment'))),
        commission = calculateTotalCommission(operations),
        averagePrice = average(operations.map(R.prop('price')));

    return {
        quantity: formatMoney(quantity, 'USD'),
        payment: formatMoney(payment, 'RUB'),
        commission: formatMoney(commission, 'RUB'),
        averagePrice: formatMoney(averagePrice, 'RUB')
    }
}

// noinspection JSUnusedGlobalSymbols
async function dividends(year) {
    const getOperations = () => api.operations({
        from: new Date(year, 0, 1).toISOString(),
        to: new Date(year, 11, 31).toISOString()
    }).then(R.prop('operations'));

    return (await forEachAccount(getOperations))
        .filter(it => it.operationType === 'Dividend')
        .map(addTickerAndName)
}

function calculateTotalCommission(objectsWithCommission, currency) {
    let result = R.sum(objectsWithCommission.map(R.pipe(R.path(['commission', 'value']), R.defaultTo(0))));
    if (currency === 'USD') {
        result *= getRate('USD');
    }
    return -result;
}

// noinspection JSUnusedGlobalSymbols
async function purchasesByInstrument(from, to) {
    const purchasesList = (await purchases(from, to))
            .filter(it => it.operationType === 'Buy'),

        groupByInstrument = R.groupBy(it => `${it.instrumentType} ${it.currency}`),

        calculateTotals = operations => {
            const currency = operations[0].currency,
                payment = -R.sum(operations.map(R.prop('payment'))),
                commission = calculateTotalCommission(operations, currency);

            return {
                currency,
                instrumentType: operations[0].instrumentType,
                payment: payment,
                commission: commission
            }
        },

        withTotals = groups => {
            const result = mapValuesIn(groups, operations => ({
                ...calculateTotals(operations),
                operations: operations
            }));

            result.commission = R.sum(Object.values(result).map(R.prop('commission')));

            return result;
        },

        prettifyValues = groups => {
            return mapValuesIn(groups, value => {
                if (typeof value === 'object') {
                    return {
                        ...value,
                        payment: formatMoney(value.payment, value.currency),
                        commission: formatMoney(value.commission, 'RUB'),
                        operations: value.operations.map(prettifyMoneyValues)
                    }
                } else {
                    return formatMoney(value, 'RUB');
                }
            });
        }

    await preloadRate('USD', 'RUB');
    return R.pipe(groupByInstrument, withTotals, prettifyValues)(purchasesList);
}

function convertToCurrency(toCurrency, moneyObj) {
    if (moneyObj.currency === 'USD' && toCurrency === 'RUB') {
        return {
            ...moneyObj,
            originalCurrency: moneyObj.currency,
            currency: toCurrency,
            value: getRate('USD') * moneyObj.value
        }
    } else {
        return moneyObj;
    }
}

async function positions({inCurrency, predicate = R.T} = {}) {
    if (inCurrency === 'RUB') {
        await preloadRate('USD', 'RUB');
    }

    const positions = (await _getPortfolioPositions())
            .filter(predicate)
            .map(it =>
                withExpectedYieldPercent({
                    ...it,
                    averagePositionPrice: convertToCurrency(inCurrency, it.averagePositionPrice),
                    totalPrice: convertToCurrency(inCurrency, {
                        currency: it.averagePositionPrice.currency,
                        value: it.averagePositionPrice.value * it.balance
                    }),
                    expectedYield: convertToCurrency(inCurrency, it.expectedYield)
                })),

        groupByFigi = R.pipe(R.groupBy(R.prop('figi')), Object.values);

    return groupByFigi(positions)
        .map(mergePositions);
}

// noinspection JSUnusedGlobalSymbols
async function stocks(positionParams) {
    return (await positions(positionParams))
        .filter(it => it.instrumentType !== 'Currency')
        .sort((a, b) => b.totalPrice.value - a.totalPrice.value);
}

// noinspection JSUnusedGlobalSymbols
async function falls(positionParams) {
    const expectedYieldPercent = R.path(['expectedYield', 'percent']);
    return (await positions(positionParams))
        .filter(it => expectedYieldPercent(it) < 0 && it.instrumentType !== 'Currency')
        .sort((a, b) => expectedYieldPercent(a) - expectedYieldPercent(b));
}

// noinspection JSUnusedGlobalSymbols
async function consolidateBy(compositionFn, positionParams) {
    const consolidatingReducer = (acc, it) => {
            const compositionTicker = compositionFn(it);
            if (!!compositionTicker) {
                const consolidatedPosition = R.find(R.propEq('ticker', compositionTicker))(acc);
                if (!!consolidatedPosition) {
                    consolidatedPosition.positions = [...consolidatedPosition.positions, it];
                } else {
                    acc = [...acc, {
                        ticker: compositionTicker,
                        consolidated: true,
                        positions: [it]
                    }]
                }
            } else {
                acc = [...acc, it]
            }

            return acc;
        },

        calculateConsolidatedTotals = it => {
            if (!it.consolidated) {
                return it;
            }

            const {totalPrice, expectedYield} = mergePositions(it.positions);
            return withExpectedYieldPercent({
                ...it,
                totalPrice,
                expectedYield
            });
        }

    //todo: order both positions and compositions by total price desc
    return (await positions(positionParams))
        .reduce(consolidatingReducer, [])
        .map(calculateConsolidatedTotals);
}

// noinspection JSUnusedGlobalSymbols
async function consolidate(compositions, positionParams) {
    const findCompositionWithTicker = ticker => R.find(R.pipe(R.prop('tickers'), R.includes(ticker))),
        findOutCompositionName = pos => R.pipe(findCompositionWithTicker(pos.ticker), R.prop('name'))(compositions);

    return (await consolidateBy(findOutCompositionName, positionParams));
}

export {
    purchases,
    positions,
    currencySells,
    stocks,
    falls,
    consolidate,
    consolidateBy,
    prettifyMoneyValues,
    formatMoney,
    purchasesByInstrument,
    dividends
};