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
    average = R.converge(R.divide, [R.sum, R.length]);

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
    const result = mapValues(position, value => isMoneyObject(value) ? formatMoneyObject(value) : value);
    if (position.price) {
        result.price = formatMoney(position.price, position.currency);
        result.payment = formatMoney(position.payment, position.currency);
    }
    return result;
}

function mapValues(obj, mapper) {
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, mapper(value)])
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

//todo: merge same purchases into one by adding up all number fields
async function purchases(from, to) {
    const positions = await _getPortfolioPositions(),
        getPositionByFigi = figi => R.find(R.propEq('figi', figi))(positions),
        getOperations = () => api.operations({from: from.toISOString(), to: to.toISOString()}).then(R.prop('operations'));

    return (await forEachAccount(getOperations))
        .filter(it => it.operationType === 'Buy' && it.status === 'Done')
        .map(it => {
            const position = getPositionByFigi(it.figi);
            return {
                ticker: position?.ticker,
                name: position?.name,
                ...it
            }
        });
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
            const result = mapValues(groups, operations => ({
                ...calculateTotals(operations),
                operations: operations
            }));

            result.commission = R.sum(Object.values(result).map(R.prop('commission')));

            return result;
        },

        prettifyValues = groups => {
            return mapValues(groups, value => {
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

async function positions({inCurrency} = {}) {
    if (inCurrency === 'RUB') {
        await preloadRate('USD', 'RUB');
    }
    return (await _getPortfolioPositions())
        .map(it => {
            const totalPrice = it.averagePositionPrice.value * it.balance,
                expectedYieldPercent = it.expectedYield.value * 100 / totalPrice;

            return {
                ...it,
                averagePositionPrice: convertToCurrency(inCurrency, it.averagePositionPrice),
                totalPrice: convertToCurrency(inCurrency, {
                    currency: it.averagePositionPrice.currency,
                    value: totalPrice
                }),
                expectedYield: {
                    ...convertToCurrency(inCurrency, it.expectedYield),
                    percent: expectedYieldPercent
                }
            }
        });
}

// noinspection JSUnusedGlobalSymbols
async function stocks(positionsParams) {
    return (await positions(positionsParams))
        .filter(it => it.instrumentType !== 'Currency')
        .sort((a, b) => b.totalPrice.value - a.totalPrice.value);
}

// noinspection JSUnusedGlobalSymbols
async function falls(positionsParams) {
    const expectedYieldPercent = R.path(['expectedYield', 'percent']);
    return (await positions(positionsParams))
        .filter(it => expectedYieldPercent(it) < 0 && it.instrumentType !== 'Currency')
        .sort((a, b) => expectedYieldPercent(a) - expectedYieldPercent(b));
}

// noinspection JSUnusedGlobalSymbols
async function consolidate(compositions, positionsParams) {
    const getConfiguredCompositionWith = ticker => R.find(R.pipe(R.prop('tickers'), R.includes(ticker)))(compositions),

        consolidatingReducer = (acc, it) => {
            const configuredComposition = getConfiguredCompositionWith(it.ticker);
            if (!!configuredComposition) {
                const consolidatedPositionTicker = configuredComposition.name,
                    consolidatedPosition = R.find(R.propEq('ticker', consolidatedPositionTicker))(acc);
                if (!!consolidatedPosition) {
                    consolidatedPosition.positions = [...consolidatedPosition.positions, it];
                } else {
                    acc = [...acc, {
                        ticker: consolidatedPositionTicker,
                        name: consolidatedPositionTicker,
                        consolidated: true,
                        instrumentType: it.instrumentType,
                        positions: [it]
                    }]
                }
            } else {
                acc = [...acc, it]
            }

            return acc;
        },

        merge = (a, b) => ({...a, value: a.value + b.value}),

        calculateConsolidatedTotals = it => {
            if (!it.consolidated) {
                return it;
            }

            const totalPrice = it.positions.map(R.prop('totalPrice')).reduce(merge),
                expectedYield = it.positions.map(R.prop('expectedYield')).reduce(merge);
            return {
                ...it,
                totalPrice,
                expectedYield: {
                    ...expectedYield,
                    percent: expectedYield.value * 100 / totalPrice.value,
                }
            };
        }

    return (await positions(positionsParams))
        .filter(R.propEq('instrumentType', 'Etf'))
        .reduce(consolidatingReducer, [])
        .map(calculateConsolidatedTotals);
}

export {purchases, positions, currencySells, stocks, falls, consolidate, prettifyMoneyValues, purchasesByInstrument};