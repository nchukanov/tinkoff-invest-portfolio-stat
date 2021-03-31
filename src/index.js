import * as stat from './statistics.js';
import * as R from "ramda";
import chalk from 'chalk';
import figures from 'figures';
import bar from 'bars';

!(async function run() {
    try {
        // noinspection JSUnusedLocalSymbols,JSMismatchedCollectionQueryUpdate
        const periods = {
                Jan: [new Date(2021, 0, 1), new Date(2021, 0, 27)],
                Feb: [new Date(2021, 0, 28), new Date(2021, 1, 24)],
                Mar: [new Date(2021, 1, 25), new Date(2021, 2, 29)],
                currentMonth: [new Date(2021, 2, 30), new Date()],
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
                console.log(chalk.blue(str));
            };

        title('Currency Sells');
        heading('The whole year:')
        console.log(await stat.currencySells(periods.currentYear[0], periods.currentYear[1]));
        heading('This month:')
        console.log(await stat.currencySells(periods.currentMonth[0], periods.currentMonth[1]));

        //decline vs rise
        /*const falls = await stat.falls(),
            positions = await stat.positions();
        console.log(falls.map(stat.prettifyMoneyValues));
        console.log('downtrend #', falls.length, ', uptrend #', positions.length - falls.length);*/

        //dividends
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

        /*title('Stocks vs Etfs in RUB');
        console.log((await stat.consolidatePositionsBy(
                R.prop('instrumentType'),
                {inCurrency: 'RUB'})
        )
            .map(stat.prettifyMoneyValues)
            .map(({ticker, totalPrice, expectedYield}) => ({
                ticker,
                totalPrice: totalPrice.value,
                expectedYield: expectedYield.value
            })));*/

        /*title('RUB vs USD in RUB');
        console.log((await stat.consolidatePositionsBy(
            it => it.totalPrice.originalCurrency || it.totalPrice.currency,
            {inCurrency: 'RUB'}
        ))
            .map(stat.prettifyMoneyValues)
            .map(({ticker, totalPrice, expectedYield}) => ({
                ticker,
                totalPrice: totalPrice.value,
                expectedYield: expectedYield.value
            })));*/

        //Portfolio and purchases by instrument type and currency
        const purchaseLimits = {
                'Stock RUB': Number(process.env.LIMIT_STOCK_RUB),
                'Stock USD': Number(process.env.LIMIT_STOCK_USD),
                'Etf RUB': Number(process.env.LIMIT_ETF_RUB),
                'Etf USD': Number(process.env.LIMIT_ETF_USD)
            },
            hiddenTickers = ['FXRL', 'FXRW', 'FXRB'],

            compilePositionsTitle = ({totalPrice}) => {
                const inRub = totalPrice.currency === 'USD'
                    ? `[in RUB ${R.pipe(stat.convertToCurrency('RUB'), stat.formatMoneyObject, R.prop('value'))(totalPrice)}]`
                    : '';
                return `Portfolio ${stat.formatMoneyObject(totalPrice).value} ${inRub}`;
            },

            compilePurchasesTitle = ({ticker, currency, payment}) => {
                const
                    format = value => stat.formatMoney(value, currency),
                    purchasesLimit = purchaseLimits[ticker],
                    formattedPurchasePayment = R.pipe(format, payment > purchasesLimit ? chalk.red : R.identity)(payment),
                    formattedPurchaseLimit = purchasesLimit ? ` out of ${format(purchasesLimit)}` : '';

                return `Purchases [${formattedPurchasePayment}${formattedPurchaseLimit}]`;
            },

            outputPositionsGroup = unsortedPositions => {
                const positions = R.sort(R.ascend(R.path(['expectedYield', 'percent'])))(unsortedPositions)
                    .filter(pos => !hiddenTickers.includes(pos.ticker));

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

            outputPurchasesGroup = purchases => {
                subheading('Purchases for the period');
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

            mergeByTicker = (positionGroups, purchaseGroups) =>
                positionGroups.map(it => ({
                    ticker: it.ticker,
                    positionsGroup: it,
                    purchasesGroup: R.find(R.propEq('ticker', it.ticker), purchaseGroups)
                })),

            positionGroups = await stat.consolidatePositionsBy(it => `${it.instrumentType} ${it.totalPrice.currency}`),
            purchaseGroups = await stat.purchasesByInstrument(periods.currentMonth[0], periods.currentMonth[1]);


        title('Portfolio and purchases by instrument type and currency');
        mergeByTicker(positionGroups, purchaseGroups).forEach(({positionsGroup, purchasesGroup}) => {
            heading(`${positionsGroup.ticker}: 
                ${compilePositionsTitle(positionsGroup)}
                ${purchasesGroup ? compilePurchasesTitle(purchasesGroup) : 'Buy something, be tough'}`);

            outputPositionsGroup(positionsGroup.positions);
            purchasesGroup && outputPurchasesGroup(purchasesGroup.purchases);
            console.log();
        });

        const
            portfolioPositionToRub = ({totalPrice}) => stat.convertToCurrency('RUB', totalPrice).value,
            paymentToRub = ({currency, payment: value}) => stat.convertToCurrency('RUB', {currency, value}).value,

            totalPortfolioAmount = R.reduce(R.add, 0, positionGroups.map(portfolioPositionToRub)),
            totalPurchasesAmount = R.reduce(R.add, 0, purchaseGroups.map(paymentToRub)),
            totalCommission = R.reduce(R.add, 0, purchaseGroups.map(R.prop('commission')));
        heading('Totals:')
        console.log(`Portfolio  ${stat.formatMoney(totalPortfolioAmount, 'RUB')}`);
        console.log(`Purchases  ${stat.formatMoney(totalPurchasesAmount, 'RUB')}`);
        console.log(`Commission ${stat.formatMoney(totalCommission, 'RUB')}`);
    } catch (err) {
        console.error(err);
    }
})();