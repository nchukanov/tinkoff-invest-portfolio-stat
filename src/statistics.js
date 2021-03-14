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
        if (pos.expectedYield && pos.totalPrice) {
            pos.expectedYield.percent = pos.expectedYield.value * 100 / pos.totalPrice.value;
        }
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
    mergeTwoPositions = (a, b) => {
        let result = R.mergeWith((prop1, prop2) => {
            if (isMoneyObject(prop1)) {
                return mergeMoneyObjects(prop1, prop2);
            } else if (typeof prop1 == 'number') {
                return prop1 + prop2;
            } else {
                return prop1;
            }
        })(a, b);

        if (result.averagePositionPrice) {
            result.averagePositionPrice.value /= 2;
        }
        if (result.price) {
            result.price /= 2;
        }
        if (result.expectedYield) {
            result = withExpectedYieldPercent(result);
        }

        return result;
    },
    mergeSamePositions = positions => {
        const positionsByFigi = R.pipe(R.groupBy(R.prop('figi')), Object.values)(positions);

        return positionsByFigi
            .map(samePositions => samePositions.reduce(mergeTwoPositions));
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
        commission = -calculateTotalCommissionInRub(operations),
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

function calculateTotalCommissionInRub(objectsWithCommission, currency) {
    let result = R.sum(objectsWithCommission.map(R.pipe(R.path(['commission', 'value']), R.defaultTo(0))));
    if (currency === 'USD') {
        result *= getRate('USD');
    }
    return result;
}

// noinspection JSUnusedGlobalSymbols
async function purchasesByInstrument(from, to, {renderer} = {}) {
    const purchasesList = (await purchases(from, to))
            .filter(it => it.operationType === 'Buy'),

        stocksFirstComparator = R.descend(R.prop('instrumentType')),
        rubFirstComparator = R.ascend(R.prop('currency')),
        byTickerComparator = R.ascend(R.prop('ticker')),
        sort = R.sortWith([stocksFirstComparator, rubFirstComparator, byTickerComparator]),

        makeAllValuesPositive = purchases => purchases.map(it => ({...it, payment: -it.payment})),  //make generic

        groupByInstrument = purchases => {
            const group = R.groupBy(it => `${it.instrumentType} ${it.currency}`);
            return R.pipe(group, Object.entries)(purchases)
                .map(([ticker, purchases]) => ({ticker, purchases}));
        },

        mergeSamePurchases = groups => groups
            .map(it => ({...it, purchases: mergeSamePositions(it.purchases)})),

        calculateTotals = purchases => {
            const currency = purchases[0].currency,
                payment = R.sum(purchases.map(R.prop('payment'))),
                commission = -calculateTotalCommissionInRub(purchases, currency);

            return {
                currency,
                instrumentType: purchases[0].instrumentType,
                payment: payment,
                commission: commission
            }
        },

        withTotals = groups => groups.map(it => ({
            ticker: it.ticker,
            ...calculateTotals(it.purchases),
            ...it
        })),

        prettifyValues = groups => groups
            .map(it => prettifyMoneyValues({
                ...it,
                payment: renderer?.('payment', it) ?? formatMoney(it.payment, it.currency),
                commission: formatMoney(it.commission, 'RUB'),
                purchases: it.purchases.map(prettifyMoneyValues)
            }));

    await preloadRate('USD', 'RUB');
    return R.pipe(sort, makeAllValuesPositive, groupByInstrument, mergeSamePurchases, withTotals, prettifyValues)(purchasesList);
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
            }));

    return mergeSamePositions(positions);
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
async function consolidatePositionsBy(compositionFn, positionParams) {
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

            const {totalPrice, expectedYield} = it.positions.reduce(mergeTwoPositions);
            return withExpectedYieldPercent({
                ...it,
                totalPrice,
                expectedYield
            });
        }

    if (!positionParams?.predicate) {
        positionParams = {
            ...positionParams,
            predicate: it => it.instrumentType !== 'Currency'
        };
    }

    //todo: order both positions and compositions by total price desc
    return (await positions(positionParams))
        .reduce(consolidatingReducer, [])
        .map(calculateConsolidatedTotals);
}

// noinspection JSUnusedGlobalSymbols
async function consolidatePositions(compositions, positionParams) {
    const findCompositionWithTicker = ticker => R.find(R.pipe(R.prop('tickers'), R.includes(ticker))),
        findOutCompositionName = pos => R.pipe(findCompositionWithTicker(pos.ticker), R.prop('name'))(compositions);

    return (await consolidatePositionsBy(findOutCompositionName, positionParams));
}

export {
    purchases,
    positions,
    currencySells,
    stocks,
    falls,
    consolidatePositions,
    consolidatePositionsBy,
    prettifyMoneyValues,
    formatMoney,
    formatMoneyObject,
    purchasesByInstrument,
    dividends
};