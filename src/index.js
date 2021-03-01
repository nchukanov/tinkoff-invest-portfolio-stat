import * as stat from './statistics.js';

!(async function run() {
    try {
        // noinspection JSUnusedLocalSymbols,JSMismatchedCollectionQueryUpdate
        const periods = {
                'Feb': [new Date(2021, 0, 28), new Date(2021, 1, 24)],
                'Mar': [new Date(2021, 1, 25), new Date()]
            },
            compositions = [{
                name: 'IT',
                tickers: ['FXIT', 'FXIM', 'TECH']
            }, {
                name: 'S&P 500',
                tickers: ['FXUS', 'SBSP', 'TSPX']
            }, {
                name: 'MOEX',
                tickers: ['TMOS', 'SBMX']
            }];

        console.dir(await stat.purchasesByInstrument(periods.Mar[0], periods.Mar[1]), {depth: 1})

        console.log(await stat.currencySells(periods.Feb[0], periods.Feb[1]));
        console.log(await stat.currencySells(periods.Mar[0], periods.Mar[1]));

        console.log((await stat.falls()).map(stat.prettifyMoneyValues))

        console.log((await stat.consolidate(compositions, {inCurrency: 'RUB'})).map(stat.prettifyMoneyValues));

    } catch (err) {
        console.error(err);
    }
})();