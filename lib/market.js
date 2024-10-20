/**
 * Cryptonote Node.JS Pool
 * https://github.com/dvandal/cryptonote-nodejs-pool
 *
 * Market Exchanges
 **/

// Load required modules
var apiInterfaces = require('./apiInterfaces.js')(config.daemon, config.wallet, config.prices);

// Initialize log system
var logSystem = 'market';
require('./exceptionWriter.js')(logSystem);

/**
 * Get market prices
 **/
exports.get = function(exchange, tickers, callback) {
    if (!exchange) { 
        callback('No exchange specified', null);
    }
    exchange = exchange.toLowerCase();

    if (!tickers || tickers.length === 0) {
        callback('No tickers specified', null);
    }

    var marketPrices = [];
    var numTickers = tickers.length;
    var completedFetches = 0;

    getExchangeMarkets(exchange, function(error, marketData) {
        if (!marketData || marketData.length === 0) {
            callback({});
            return ;
        }

        for (var i in tickers) {
            (function(i){
                var pairName = tickers[i];
                var pairParts = pairName.split('-');
                var base = pairParts[0] || null;
                var target = pairParts[1] || null;

                if (!marketData[base]) {
                    completedFetches++;
                    if (completedFetches === numTickers) callback(marketPrices);
                } else {
                    var price = marketData[base][target] || null;
                    if (!price || price === 0) {
                        var cryptonatorBase;
                        if (marketData[base]['BTC']) cryptonatorBase = 'BTC';
                        else if (marketData[base]['ETH']) cryptonatorBase = 'ETH';
                        else if (marketData[base]['LTC']) cryptonatorBase = 'LTC';

                        if (!cryptonatorBase) {
                            completedFetches++;
                            if (completedFetches === numTickers) callback(marketPrices);
                        } else {
                            getExchangePrice("coingecko", cryptonatorBase, target, function(error, tickerData) {
                                completedFetches++;
                                if (tickerData && tickerData.price) {
                                    marketPrices[i] = {
                                        ticker: pairName,
                                        price: tickerData.price * marketData[base][cryptonatorBase],
                                        source: tickerData.source
                                    };
                                }
                                if (completedFetches === numTickers) callback(marketPrices);
                            });
                        }
                    } else {
                        completedFetches++;
                        marketPrices[i] = { ticker: pairName, price: price, source: exchange };
                        if (completedFetches === numTickers) callback(marketPrices);
                    }
                }
            })(i);
        }
    });
}

/**
 * Get Exchange Market Prices
 **/

var marketRequestsCache = {};

function getExchangeMarkets(exchange, callback) {
    callback = callback || function(){};
    if (!exchange) { 
        callback('No exchange specified', null);
    }
    exchange = exchange.toLowerCase();

    // Return cache if available
    var cacheKey = exchange;
    var currentTimestamp = Date.now() / 1000;

    if (marketRequestsCache[cacheKey] && marketRequestsCache[cacheKey].ts > (currentTimestamp - 300)) {
        callback(null, marketRequestsCache[cacheKey].data);
        return ;
    }

    // Altex
    if (exchange == "altex") {
        apiInterfaces.jsonHttpRequest('api.altex.exchange', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response || !response.success) callback('No market informations', {});

            var data = {};
            for (var ticker in response.data) {
                tickerParts = ticker.split('_');
                var target = tickerParts[0];
                var symbol = tickerParts[1];

                var price = +parseFloat(response.data[ticker].last);
                if (price === 0) continue;

                if (!data[symbol]) data[symbol] = {};
                data[symbol][target] = price;
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/v1/ticker');
    }

    // CoinGecko
    else if (exchange == "coingecko") {
        apiInterfaces.jsonHttpRequest('api.coingecko.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response || !response.tickers) callback('No market informations', {});

            var data = {};
            var total = 0;
            for (var i in response.tickers) {
                var symbol = response.tickers[i].base;
                var target = response.tickers[i].target;

                var price = +response.tickers[i].last;
                total = total + price;
                if (!price || price === 0) continue;

                log('info',logSystem, 'CoinGecko / %s \t Data = %s-%s = %s BTC',[response.tickers[i].market.name, symbol, target, price]);

                if (!data[symbol]) data[symbol] = {};
            }
            log('info',logSystem, 'CoinGecko / Exchanges \t Avg. = %s-%s = %s BTC',[symbol, target, (total /response.tickers.length)]);
            data[symbol][target] = (total / response.tickers.length);

            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/api/v3/coins/2acoin/tickers');
    }

    // CoinPaprika
    else if (exchange == "coinpaprika") {
        apiInterfaces.jsonHttpRequest('api.coinpaprika.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response) callback('No market informations', {});

            var data = {};
            var total = 0;
            for (var i in response) {
                var ticker = response[i];
                var pairName = ticker.pair;
                pairParts = pairName.split('/');

                var symbol = pairParts[0];
                //var target = pairParts[1];
                var target = 'USD';

                var price = +ticker.quotes.USD.price;
                var weight = ticker.adjusted_volume_24h_share;

                total = total + (price * (weight/100));
                if (!price || price === 0) continue;

                log('info',logSystem, 'CoinPaprika / %s \t Data = %s-%s = %s %s Vol: %s',[ticker.exchange_name, symbol, target, price, target, weight]);

                if (!data[symbol]) data[symbol] = {};
            }
            log('info',logSystem, 'CoinPaprika / Exchanges \t Weighted Avg. = %s-%s = %s ',[symbol, target, total]);
            data[symbol][target] = total;

            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/v1/coins/arms-2acoin/markets?quotes=BTC,USD,CAD,EUR');
    }

    // Crex24
    else if (exchange == "crex24") {
        apiInterfaces.jsonHttpRequest('api.crex24.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response || !response.Tickers) callback('No market informations', {});

            var data = {};
            for (var i in response.Tickers) {
                var ticker = response.Tickers[i];

                var pairName = ticker.PairName;
                pairParts = pairName.split('_');
                var target = pairParts[0];
                var symbol = pairParts[1];

                var price = +ticker.Last;
                if (!price || price === 0) continue;

                if (!data[symbol]) data[symbol] = {};
                data[symbol][target] = price;
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/CryptoExchangeService/BotPublic/ReturnTicker');
    }

    // Cryptopia
    else if (exchange == "cryptopia") {
        apiInterfaces.jsonHttpRequest('www.cryptopia.co.nz', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response || !response.Success) callback('No market informations', {});

            var data = {};
            for (var i in response.Data) {
                var ticker = response.Data[i];

                var pairName = ticker.Label;
                var pairParts = pairName.split('/');
                var target = pairParts[1];
                var symbol = pairParts[0];

                var price = +ticker.LastPrice;
                if (!price || price === 0) continue;

                if (!data[symbol]) data[symbol] = {};
                data[symbol][target] = price;
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/api/GetMarkets');
    }

    // Stocks.Exchange
    else if (exchange == "stocks.exchange") {
        apiInterfaces.jsonHttpRequest('stocks.exchange', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response) callback('No market informations', {});

            var data = {};
            for (var i in response) {
                var ticker = response[i];

                var pairName = ticker.market_name;
                var pairParts = pairName.split('_');
                var target = pairParts[1];
                var symbol = pairParts[0];

                var price = +ticker.last;
                if (!price || price === 0) continue;

                if (!data[symbol]) data[symbol] = {};
                data[symbol][target] = price;
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/api2/ticker');
    }

    // TradeOgre
    else if (exchange == "tradeogre") {
        apiInterfaces.jsonHttpRequest('tradeogre.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            var data = {};
            if (!error && response) {
                for (var i in response) {
                    for (var pairName in response[i]) {
                        pairParts = pairName.split('-');
                        var target = pairParts[0];
                        var symbol = pairParts[1];

                        var price = +response[i][pairName].price;
                        if (price === 0) continue;

                        if (!data[symbol]) data[symbol] = {};
                        data[symbol][target] = price;
                    }
                }
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/api/v1/markets');
    }

    // Kompler
    else if (exchange == "kompler") {
        apiInterfaces.jsonHttpRequest('api.kompler.exchange', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            var data = {};
            if (!error && response) {
                for (var i in response) {
                  var target = i;
                  for (var x in response[i]) {
                    var symbol = x;
                    if (response[i][x].lastPrice != null) {
                       var price = +response[i][x].lastPrice || null;
                       if (!price || price === 0) continue;
                       if (!data[symbol]) data[symbol] = {};
                       data[symbol][target] = price;
//                       console.log(symbol);
                    }
                  }
                }
            }
            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/v1/markets');
    }

    // FirstCryptoBank
    else if (exchange == "firstcryptobank") {
        apiInterfaces.jsonHttpRequest('fcbaccount.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            if (error) callback(error, {});
            if (!response || !response.result) callback('No market informations', {});

            var data = {};
            // FCB does not supply price data in their market API, we use the coin/pair infor
            var ticker = response.data;
            var target = 'BTC';
            var symbol = 'ARMS';
            var price = +ticker.last;

            if (!data[symbol]) data[symbol] = {};
            data[symbol][target] = price;

            if (!error) marketRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(null, data);
        }, '/api/public/v1/get/exchange/market?pair=BTC-ARMS');
    }

    // Unknown
    else {
        callback('Exchange not supported: ' + exchange);
    }
}
exports.getExchangeMarkets = getExchangeMarkets;

/**
 * Get Exchange Market Price
 **/

var priceRequestsCache = {};

function getExchangePrice(exchange, base, target, callback) {
    callback = callback || function(){};

    if (!exchange) { 
        callback('No exchange specified');
    }
    else if (!base) {
        callback('No base specified');
    }
    else if (!target) {
        callback('No target specified');
    }

    exchange = exchange.toLowerCase();
    base = base.toUpperCase();
    target = target.toUpperCase();

    // Return cache if available
    var cacheKey = exchange + '-' + base + '-' + target;
    var currentTimestamp = Date.now() / 1000;

    if (priceRequestsCache[cacheKey] && priceRequestsCache[cacheKey].ts > (currentTimestamp - 300)) {
        callback(null, priceRequestsCache[cacheKey].data);
        return ;
    }

    // Cryptonator
    if (exchange == "cryptonator") {
        var ticker = base + '-' + target;
        apiInterfaces.jsonHttpRequest('api.cryptonator.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.error) log('warn', logSystem, 'Cryptonator API error: %s', [response.error]);

            var error = response.error ? response.error : error;
            var price = response.success ? +response.ticker.price : null;
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/api/ticker/' + ticker);
    }

    // Coingecko
    else if (exchange == "coingecko") {
        var ticker = base + '-' + target;
        apiInterfaces.jsonHttpRequest('api.coingecko.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

//            var price = (response.bitcoin && response.bitcoin.usd) ? +response.bitcoin.usd : null;
            for (var key in response.bitcoin){
              var price = response.bitcoin[key];
            }
//            var price = response[base][target];
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/api/v3/simple/price?ids=BITCOIN&vs_currencies=' + target);
    }

    // Altex
    else if (exchange == "altex") {
        getExchangeMarkets(exchange, function(error, data) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            var price = null;
            if (!error && data[base] && data[base][target]) {
                price = data[base][target];
            }
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        });
    }

    // Crex24
    else if (exchange == "crex24") {
        var ticker = base + '_' + target;
        apiInterfaces.jsonHttpRequest('api.crex24.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.Error) log('warn', logSystem, 'Crex24 API error: %s', [response.Error]);

            var error = response.Error ? response.Error : error;
            var price = (response.Tickers && response.Tickers[0]) ? +response.Tickers[0].Last : null;
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/CryptoExchangeService/BotPublic/ReturnTicker?request=[NamePairs=' + ticker + ']');
    }

    // Cryptopia
    else if (exchange == "cryptopia") {
        var ticker = base + '_' + target;
        apiInterfaces.jsonHttpRequest('www.cryptopia.co.nz', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.Error) log('warn', logSystem, 'Cryptopia API error: %s', [response.Error]);

            var error = response.Error ? response.Error : error;
            var price = (response.Data && response.Data.LastPrice) ? +response.Data.LastPrice : null;

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/api/GetMarket/' + ticker);
    }

    // Stocks.Exchange
    else if (exchange == "stocks.exchange") {
        getExchangeMarkets(exchange, function(error, data) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);

            var price;
            if (!error && data[base] && data[base][target]) {
                price = data[base][target];
            }
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        });
    }

    // TradeOgre
    else if (exchange == "tradeogre") {
        var ticker = target + '-' + base;
        apiInterfaces.jsonHttpRequest('tradeogre.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.message) log('warn', logSystem, 'TradeOgre API error: %s', [response.message]);

            var error = response.message ? response.message : error;
            var price = +response.price || null;
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/api/v1/ticker/' + ticker);
    }

    // Kompler
    else if (exchange == "kompler") {
        var ticker = target + '-' + base;
        apiInterfaces.jsonHttpRequest('api.kompler.exchange', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.message) log('warn', logSystem, 'Kompler API error: %s', [response.message]);

            var error = response.message ? response.message : error;
            var price = +response.lastPrice || null;
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/v1/markets/' + target + '/' + base);
    }

    // FirstCryptoBank
    else if (exchange == "firstcryptobank") {
        var ticker = target + '-' + base;
        apiInterfaces.jsonHttpRequest('fcbaccount.com', 443, '', function(error, response) {
            if (error) log('error', logSystem, 'API request to %s has failed: %s', [exchange, error]);
            if (response.Error) log('warn', logSystem, 'FirstCryptoBank API error: %s', [response.Error]);

            var error = response.Error ? response.Error : error;
            var price = (response.data && response.data[0]) ? +response.data[0].last : null;
            if (!price) log('warn', logSystem, 'No exchange data for %s using %s', [ticker, exchange]);

            var data = { ticker: ticker, price: price, source: exchange };
            if (!error) priceRequestsCache[cacheKey] = { ts: currentTimestamp, data: data };
            callback(error, data);
        }, '/api/public/v1/get/exchange/market?pair=' + ticker );
    }

    // Unknown
    else {
        callback('Exchange not supported: ' + exchange);
    }
}
exports.getExchangePrice = getExchangePrice;
