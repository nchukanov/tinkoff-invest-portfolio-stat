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
                Apr: [new Date(2021, 2, 30), new Date(2021, 3, 28)],
                May: [new Date(2021, 3, 29), new Date(2021, 4, 30)],
                Jun: [new Date(2021, 4, 31), new Date(2021, 5, 29)],
                Jul: [new Date(2021, 5, 30), new Date(2021, 6, 31)],
                currentMonth: [new Date(2021, 7, 1), new Date()]
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
        console.log(await stat.currencySells(periods.currentMonth[0], periods.currentMonth[1]));

        //decline vs rise
        /*const falls = await stat.falls(),
            positions = await stat.positions();
        console.log(falls.map(stat.prettifyMoneyValues));
        console.log('downtrend #', falls.length, ', uptrend #', positions.length - falls.length);*/

        title('Dividends 2021');
        const dividends = (await stat.dividends(2021))
                .map(R.pick(['ticker', 'name', 'date', 'payment', 'currency'])),
            payoutIn = currency => R.reduce(R.add, 0, dividends.filter(R.propEq('currency', currency)).map(R.prop('payment'))),
            totalPayoutInRub = payoutIn('RUB'),
            totalPayoutInUsd = payoutIn('USD');
        //console.log(dividends);
        console.log(`Payments ${stat.formatMoney(totalPayoutInRub, 'RUB')}; ${stat.formatMoney(totalPayoutInUsd, 'USD')}`);
        heading(`Total in RUB ${stat.formatMoney(totalPayoutInRub + stat.convertToCurrency('RUB', {currency: 'USD', value: totalPayoutInUsd}).value, 'RUB')}`)

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
            hiddenTickers = [/*RUB*/'SBMX', 'TMOS', 'FXWO', 'FXRW', 'FXIT', 'SBSP', 'FXRU', /*USD*/ 'TIPO', 'TECH'],
            etfAnnualYield = {
                'FXRB': '12,05 %',
                'FXRL': '41,06 %',
                'FXIM': '11,23 %',
                'FXUS': '60,68 %',
                'FXDE': '60,70 %',
                'FXKZ': '52,00 %',
                'FXCN': '40,27 %',
                'FXGD': '3Y 62,89 %',
            },

            nonHiddenTickerPredicate = ({ticker}) => !hiddenTickers.includes(ticker),

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

            outputPositionsGroup = ({instrumentType, positions}) => {
                const positionsByYield = R.sort(R.ascend(R.path(['expectedYield', 'percent'])))(positions);

                const tableData = positionsByYield
                    .map(pos => {
                        const result = {
                            ticker: pos.ticker,
                            name: pos.name,
                            value: stat.formatMoneyObject(pos.totalPrice).value,
                            [`yield ${figures.arrowDown}`]: stat.formatMoneyObject(pos.expectedYield).percent,
                            'presence': stat.formatPercent(pos.percent)
                        };

                        if (instrumentType === 'Etf') {
                            result['ann. yield'] = etfAnnualYield[pos.ticker] ?? '-';
                        }

                        return result;
                    });
                subheading('Portfolio positions');
                console.table(tableData);

                const barData = positionsByYield
                    .reduce((acc, pos) => ({
                        ...acc,
                        [pos.ticker]: pos.totalPrice.value
                    }), {});
                console.log(chalk.yellow(bar(barData, {
                    sort: true,
                    map: value => {
                        let pos = positionsByYield.filter(R.pathEq(['totalPrice', 'value'], value))[0];
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
                positionGroups.map(positionsGroup => {
                    let purchasesGroup = R.find(R.propEq('ticker', positionsGroup.ticker), purchaseGroups);
                    return ({
                        ticker: positionsGroup.ticker,
                        positionsGroup: {...positionsGroup, positions: positionsGroup.positions.filter(nonHiddenTickerPredicate)},
                        purchasesGroup: purchasesGroup //{...purchasesGroup, purchases: purchasesGroup.purchases.filter(nonHiddenTickerPredicate)}
                    });
                }),

            positionGroups = await stat.consolidatePositionsBy(it => `${it.instrumentType} ${it.totalPrice.currency}`),
            purchaseGroups = await stat.purchasesByInstrument(periods.currentMonth[0], periods.currentMonth[1]);


        title('Portfolio and purchases by instrument type and currency');
        mergeByTicker(positionGroups, purchaseGroups).forEach(({positionsGroup, purchasesGroup}) => {
            heading(`${positionsGroup.ticker}: 
                ${compilePositionsTitle(positionsGroup)}
                ${purchasesGroup ? compilePurchasesTitle(purchasesGroup) : 'Buy something, be tough'}`);

            outputPositionsGroup(positionsGroup);
            purchasesGroup && outputPurchasesGroup(purchasesGroup.purchases);
            console.log();
        });

        const
            paymentToRub = ({currency, payment}) => stat.convertToCurrency('RUB', {currency, payment}).payment,

            totalPortfolioAmount = R.reduce(R.add, 0, positionGroups.map(R.pipe(R.prop('totalPrice'), stat.convertToCurrency('RUB'), R.prop('value')))),
            totalPortfolioYield = R.reduce(R.add, 0, positionGroups.map(R.pipe(R.prop('expectedYield'), stat.convertToCurrency('RUB'), R.prop('value')))),
            totalPurchasesAmount = R.reduce(R.add, 0, purchaseGroups.map(paymentToRub)),
            totalCommission = R.reduce(R.add, 0, purchaseGroups.map(R.prop('commission')));

        heading('Totals:')
        console.log(`Portfolio  ${stat.formatMoney(totalPortfolioAmount, 'RUB')}`);
        console.log(`Yield      ${stat.formatMoney(totalPortfolioYield, 'RUB')}`);
        console.log();
        console.log(`Purchases  ${stat.formatMoney(totalPurchasesAmount, 'RUB')}`);
        console.log(`Commission ${stat.formatMoney(totalCommission, 'RUB')}`);
    } catch (err) {
        console.error(err);
    }
})();