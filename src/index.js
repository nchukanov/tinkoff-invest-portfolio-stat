import * as stat from './statistics.js';
import * as R from "ramda";

!(async function run() {
    try {
        // noinspection JSUnusedLocalSymbols,JSMismatchedCollectionQueryUpdate
        const periods = {
            'Feb': [new Date(2021, 0, 28), new Date(2021, 1, 24)],
            'Mar': [new Date(2021, 1, 25), new Date()]
        };

        // console.dir(await stat.purchasesByInstrument(periods.Mar[0], periods.Mar[1]), {depth: 2})

        // console.dir((await stat.positions()).map(stat.prettifyMoneyValues), {depth: null});

        // console.log(await stat.currencySells(periods.Feb[0], periods.Feb[1]));
        // console.log(await stat.currencySells(periods.Mar[0], periods.Mar[1]));

        // console.log((await stat.falls()).map(stat.prettifyMoneyValues));

        // console.log((await stat.dividends(2021)));

        // console.log(((await stat.purchases(periods.Feb[0], periods.Mar[1])).map(stat.prettifyMoneyValues)));
        // console.log(((await stat.purchases(periods.Mar[0], periods.Mar[1])).map(stat.prettifyMoneyValues)));

        //Consolidated Etfs
        /*const compositions = [{
            name: 'IT',
            tickers: ['FXIT', 'FXIM', 'TECH']
        }, {
            name: 'S&P 500',
            tickers: ['FXUS', 'SBSP', 'TSPX']
        }, {
            name: 'MOEX',
            tickers: ['TMOS', 'SBMX']
        }]
        console.log((await stat.consolidate(compositions,
            {inCurrency: 'RUB', predicate: R.propEq('instrumentType', 'Etf')}
        )).map(stat.prettifyMoneyValues));*/

        //Stocks vs Etfs
        /*console.dir((await stat.consolidateBy(
                R.prop('instrumentType'),                         
                {inCurrency: 'RUB', predicate: it => it.instrumentType !== 'Currency'})
        ).map(stat.prettifyMoneyValues), {depth: 2});*/

        //RUB vs USD
        /*console.dir((await stat.consolidateBy(
                it => it.totalPrice.originalCurrency || it.totalPrice.currency,
                {inCurrency: 'RUB', predicate: it => it.instrumentType !== 'Currency'})
        ).map(stat.prettifyMoneyValues), {depth: 2});*/

    } catch (err) {
        console.error(err);
    }
})();