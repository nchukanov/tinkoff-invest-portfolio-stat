import * as stat from './statistics.js';
import * as R from "ramda";
import chalk from 'chalk';
import figures from 'figures';
import bar from 'bars';

!(async function run() {
    try {
        // noinspection JSUnusedLocalSymbols,JSMismatchedCollectionQueryUpdate
        const periods = {
                'Jan': [new Date(2021, 0, 1), new Date(2021, 0, 27)],
                'Feb': [new Date(2021, 0, 28), new Date(2021, 1, 24)],
                'Mar': [new Date(2021, 1, 25), new Date()],
                currentYear: [new Date(2020, 11, 20), new Date()],
            },
            title = str => {
                console.log();
                console.log(chalk.bgBlue.whiteBright.bold(str));
                console.log();
            },
            heading = str => {
                console.log(chalk.blue.bold(str));
            },
            subheading = str => {
                console.log(chalk.whiteBright(str));
            };

        /*title('Currency Sells');
        console.log(await stat.currencySells(periods.Feb[0], periods.Feb[1]));
        console.log(await stat.currencySells(periods.Mar[0], periods.Mar[1]));*/

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
                {inCurrency: 'RUB'}
        )).map(stat.prettifyMoneyValues), {depth: 2});*/

        //Portfolio and purchases by instrument type and currency
        const purchaseLimits = {
                'Stock RUB': Number(process.env.LIMIT_STOCK_RUB),
                'Stock USD': Number(process.env.LIMIT_STOCK_USD),
                'Etf RUB': Number(process.env.LIMIT_ETF_RUB),
                'Etf USD': Number(process.env.LIMIT_ETF_USD)
            },

            outputPositionsGroup = group => {
                const positions = R.sort(R.ascend(R.path(['expectedYield', 'percent'])))(group.positions)
                    .filter(pos => !['FXRL', 'FXRW', 'FXRB'].includes(pos.ticker));

                const tableData = positions
                    .map(pos => {
                        return {
                            ticker: pos.ticker,
                            name: pos.name,
                            value: stat.formatMoneyObject(pos.totalPrice).value,
                            [`yield percent ${figures.arrowDown}`]: stat.formatMoneyObject(pos.expectedYield).percent,
                            'percent of presence': stat.formatPercent(pos.percent)
                        }
                    });
                subheading('Portfolio positions');
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
                        return `${stat.formatMoneyObject(pos.totalPrice).value} | ${stat.formatPercent(pos.percent)}`
                    }
                })));
            },

            outputPurchasesGroup = ({purchases}) => {
                subheading('Purchases within the period');
                console.table(purchases
                    .map(stat.prettifyMoneyValues)
                    .map(({ticker, name, price, quantity, payment}) => ({
                        [`ticker ${figures.arrowDown}`]: ticker,
                        name,
                        price,
                        quantity,
                        payment
                    })));
            },

            positions = await stat.consolidatePositionsBy(it => `${it.instrumentType} ${it.totalPrice.currency}`),
            purchases = await stat.purchasesByInstrument(periods.Mar[0], periods.Mar[1]);

        title('Portfolio and purchases by instrument type and currency');
        R.zip(positions, purchases).forEach(zip => {
            const {ticker, currency, totalPrice: totalPositionPrice} = zip[0],
                {payment: purchasePayment} = zip[1],

                format = value => stat.formatMoney(value, currency),
                purchasesLimit = purchaseLimits[ticker],
                formattedPurchasePayment = R.pipe(format, purchasePayment > purchasesLimit ? chalk.red : R.identity)(purchasePayment),
                formattedPurchaseLimit = purchasesLimit ? ` out of ${format(purchasesLimit)}` : '';

            heading(`${ticker}: 
                Portfolio ${stat.formatMoneyObject(totalPositionPrice).value}
                Purchases [${formattedPurchasePayment}${formattedPurchaseLimit}]`);

            outputPositionsGroup(zip[0]);
            outputPurchasesGroup(zip[1]);
            console.log();
        })

        const paymentToRub = ({currency, payment}) => currency === 'USD' ? stat.getRate('USD') * payment : payment,
            totalPurchasesAmount = R.reduce(R.add, 0, purchases.map(paymentToRub)),
            totalCommission = R.reduce(R.add, 0, purchases.map(R.prop('commission')));
        heading('Purchase totals:')
        console.log(`Purchases amount - ${stat.formatMoney(totalPurchasesAmount, 'RUB')}`);
        console.log(`Commission - ${stat.formatMoney(totalCommission, 'RUB')}`);

    } catch (err) {
        console.error(err);
    }
})();