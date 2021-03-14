import * as stat from './statistics.js';
import * as R from "ramda";
import chalk from 'chalk';
import figures from 'figures';
import bar from 'bars';

!(async function run() {
    try {
        // noinspection JSUnusedLocalSymbols,JSMismatchedCollectionQueryUpdate
        const periods = {
            'Feb': [new Date(2021, 0, 28), new Date(2021, 1, 24)],
            'Mar': [new Date(2021, 1, 25), new Date()]
        };

        // console.log(await stat.currencySells(periods.Feb[0], periods.Feb[1]));
        // console.log(await stat.currencySells(periods.Mar[0], periods.Mar[1]));

        //decline vs rise
        /*const falls = await stat.falls(),
            positions = await stat.positions();
        console.log(falls.map(stat.prettifyMoneyValues));
        console.log('downtrend #', falls.length, ', uptrend #', positions.length - falls.length);*/

        // console.log((await stat.dividends(2021)));

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
        console.log((await stat.consolidatePositions(compositions,
            {inCurrency: 'RUB', predicate: R.propEq('instrumentType', 'Etf')}
        )).map(stat.prettifyMoneyValues));*/

        //Stocks vs Etfs
        /*console.dir((await stat.consolidatePositionsBy(
                R.prop('instrumentType'),                         
                {inCurrency: 'RUB'})
        ).map(stat.prettifyMoneyValues), {depth: 2});*/

        //RUB vs USD
        /*console.dir((await stat.consolidatePositionsBy(
                it => it.totalPrice.originalCurrency || it.totalPrice.currency,
                {inCurrency: 'RUB')
        ).map(stat.prettifyMoneyValues), {depth: 2});*/

        const title = chalk.bgBlue.bold,
            heading = chalk.blue.bold;

        console.log(title('Portfolio by instrument type and currency'));
        console.log();
        (await stat.consolidatePositionsBy(it => `${it.instrumentType} ${it.totalPrice.currency}`))
            .forEach(group => {
                const positions = R.sort(R.ascend(R.path(['expectedYield', 'percent'])))(group.positions)
                    .filter(pos => !['FXRL', 'FXRW', 'FXRB'].includes(pos.ticker));
                console.log(heading(`${group.ticker} - ${stat.formatMoneyObject(group.totalPrice).value}`));

                const tableData = positions
                    .map(pos => {
                        const {value, percent} = stat.formatMoneyObject({
                            ...pos.totalPrice,
                            percent: pos.totalPrice.value * 100 / group.totalPrice.value
                        });
                        return {
                            ticker: pos.ticker,
                            name: pos.name,
                            value,
                            'share percent': percent,
                            [`yield percent ${figures.arrowDown}`]: stat.formatMoneyObject(pos.expectedYield).percent
                        }
                    });
                console.table(tableData);

                const barData = positions
                    .reduce((acc, pos) => ({
                        ...acc,
                        [pos.ticker]: pos.totalPrice.value
                    }), {});
                console.log(chalk.yellow(bar(barData, {
                    sort: true,
                    map: value => {
                        let pos = positions.filter(R.pathEq(['totalPrice', 'value'], value))[0];
                        return `${stat.formatMoneyObject(pos.totalPrice).value} | ${stat.formatMoneyObject(pos.expectedYield).percent}`
                    }
                })));
            });

        // console.log(((await stat.purchases(periods.Mar[0], periods.Mar[1])).map(stat.prettifyMoneyValues)));

        console.log(title('Purchases by instrument type and currency'));
        console.log();
        const limits = {
                'Stock RUB': Number(process.env.LIMIT_STOCK_RUB),
                'Stock USD': Number(process.env.LIMIT_STOCK_USD),
                'Etf RUB': Number(process.env.LIMIT_ETF_RUB),
                'Etf USD': Number(process.env.LIMIT_ETF_USD)
            },
            renderer = (key, {ticker, payment, currency}) => {
                if (key === 'payment' && payment > limits[ticker]) {
                    const format = value => stat.formatMoney(value, currency);
                    return `${chalk.red(format(payment))} out of ${format(limits[ticker])}`
                } else {
                    return undefined;
                }
            };

        (await stat.purchasesByInstrument(periods.Mar[0], periods.Mar[1], {renderer}))
            .forEach(({ticker, payment, purchases}) => {
                console.log(heading(`${ticker} [${payment}]`));
                console.table(purchases
                    .map(({ticker, name, price, quantity, payment}) => ({ticker, name, price, quantity, payment})));
            });

    } catch (err) {
        console.error(err);
    }
})();