var mongoose = require('mongoose')
  , Stats = require('../models/stats')
  , Markets = require('../models/markets')
  , Address = require('../models/address')
  , Tx = require('../models/tx')
  , Coin = require('../models/coin')
  , Richlist = require('../models/richlist')
  , Peers = require('../models/peers')
  , Nodes = require('../models/nodes')
  , Inf = require('../models/infnodes')
  , Pools = require('../models/pools')
  , LocationNodes = require('../models/locationnodes')
  , Income = require('../models/income')
  , TermDepositStats = require('../models/termdepositstats')
  , Heavy = require('../models/heavy')
  , lib = require('./explorer')
  , settings = require('./settings')
  , poloniex = require('./markets/poloniex')
  , bittrex = require('./markets/bittrex')
  , tradeogre = require('./markets/tradeogre')
  , bleutrade = require('./markets/bleutrade')
  , cryptsy = require('./markets/cryptsy')
  , cryptopia = require('./markets/cryptopia')
  , yobit = require('./markets/yobit')
  , empoex = require('./markets/empoex')
  , crex24 = require('./markets/crex24')
  , stex = require('./markets/stex')
  , coinsbit = require('./markets/coinsbit')
  , ccex = require('./markets/ccex');
//  , BTC38 = require('./markets/BTC38');

mongoose.set('useCreateIndex', true);
mongoose.set('runValidators', true);

function find_address(hash, cb) {
  Address.findOne({a_id: hash}, function(err, address) {
    if(address) {
      return cb(address);
    } else {
      return cb();
    }
  });
}

function find_coins(hash, cb) {
  Coin.find({address: hash}, function(err, coins){
    if(coins) {
      return cb(coins);
    } else {
      return cb();
    }
  });
}

function find_richlist(coin, cb) {
  Richlist.findOne({coin: coin}, function(err, richlist) {
    if(richlist) {
      return cb(richlist);
    } else {
      return cb();
    }
  });
}

function update_address(hash, txid, amount, type, cb) {
  // Check if address exists
  find_address(hash, function(address) {
    if (address) {
      // if coinbase (new coins PoW), update sent only and return cb.
      if ( hash == 'coinbase' ) {
        Address.updateOne({a_id:hash}, {
          sent: address.sent + amount,
            balance: 0,
        }, function() {
          return cb();
        });
      } else {
        // ensure tx doesnt already exist in address.txs
        lib.is_unique(address.txs, txid, function(unique, index) {
          var tx_array = address.txs;
          var received = address.received;
          var sent = address.sent;
          if (type == 'vin') {
            sent = sent + amount;
          } else {
            received = received + amount;
          }
          if (unique == true) {
            tx_array.push({addresses: txid, type: type});
            if ( tx_array.length > settings.txcount ) {
              tx_array.shift();
            }
            Address.updateOne({a_id:hash}, {
              txs: tx_array,
              received: received,
              sent: sent,
              balance: received - sent
            }, function() {
              return cb();
            });
          } else {
            if (type == tx_array[index].type) {
              return cb(); //duplicate
            } else {
              Address.updateOne({a_id:hash}, {
                txs: tx_array,
                received: received,
                sent: sent,
                balance: received - sent
              }, function() {
                return cb();
              });
            }
          }
        });
      }
    } else {
      //new address
      if (type == 'vin') {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vin'} ],
          sent: amount,
          balance: amount,
        });
      } else {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vout'} ],
          received: amount,
          balance: amount,
        });
      }

      newAddress.save(function(err) {
        if (err) {
          return cb(err);
        } else {
          //console.log('address saved: %s', hash);
          //console.log(newAddress);
          return cb();
        }
      });
    }
  });
}

function find_coin(id, cb) {
  Coin.findOne({coinid: id}, function(err, coin) {
    if(coin) {
      return cb(coin);
    } else {
      return cb(null);
    }
  });
}

function save_coin(coinid, value, script, type, address, spendable, height, cb) {
  find_coin(coinid, function(coin) {
    if(coin){
      console.log('coin ' + coinid + ' exist');
      return cb();
    } else {
      var newCoin = new Coin({
        coinid: coinid,
        value: value,
        script: script,
        type: type,
        address: address,
        height: height,
        spendable: spendable,
        spendHeight: 0
      });

      newCoin.save(function(err) {
        if (err) {
          return cb(err);
        } else {
          return cb();
        }
      });
    }
  });
}

/*
 * convertion tx vout to coin
 */
function tx_to_coin(txid, nHeight, cb) {
  lib.get_rawtransaction(txid, function(tx){
    if (tx != 'There was an error. Check your console.') {
      console.log('coins in tx: %d', tx.vout.length);
      //loop vout and get coin
      lib.syncLoop(tx.vout.length, function(loopOut) {
        var i = loopOut.iteration();
        if (tx.vout[i].scriptPubKey.type != 'nonstandard' && tx.vout[i].scriptPubKey.type != 'nulldata') { 
          var coinid = txid + '-' + tx.vout[i].n;
          var spendable = 1;
          var address = "";
          if(tx.vout[i].scriptPubKey.type == 'burn_and_data') spendable = 0;
          if(tx.vout[i].scriptPubKey.address && tx.vout[i].scriptPubKey.address.length == 1)
              address = tx.vout[i].scriptPubKey.address[0];
          save_coin(coinid, parseFloat(tx.vout[i].value), tx.vout[i].scriptPubKey.hex,
                    tx.vout[i].scriptPubKey.type, address, spendable, nHeight, function(err){
            if(err){
              return cb(err);
            } else {
              console.log(coinid + " is added");
              loopOut.next();
            }
          });
        } else {
          loopOut.next();
        }
      }, function(){
        //loop vin and update spendHeight
        lib.syncLoop(tx.vin.length, function(loopIn) {
          var j = loopIn.iteration();
          if(tx.vin[j].coinbase){
            console.log("coinbase tx");
            loopIn.next();
          } else {
            var coinid=tx.vin[j].txid + '-' + tx.vin[j].vout;
            Coin.updateOne({coinid:coinid}, {
              spendHeight: nHeight
            }, function() {
              console.log("SPEND: " + coinid);
              loopIn.next();
            });
          }
        }, function(){
          //end loop vin, vout
          return cb();
        });
      });
    } else {
      return cb('tx not found: ' + txid);
    }
  });
}

/*
 * update spentHeight from remove tx vin
 */
function tx_update_spent_coin(txid, cb) {
  lib.get_rawtransaction(txid, function(tx){
    if (tx != 'There was an error. Check your console.') {
      console.log('coins in tx: %d', tx.vin.length);
        lib.syncLoop(tx.vin.length, function(loopIn) {
          var j = loopIn.iteration();
          if(tx.vin[j].coinbase){
            console.log("coinbase tx");
            loopIn.next();
          } else {
            var coinid=tx.vin[j].txid + '-' + tx.vin[j].vout;
            Coin.updateOne({coinid:coinid}, {
              spendHeight: 0
            }, function() {
              console.log("UNDO SPEND: " + coinid);
              loopIn.next();
            });
          }
        }, function(){
          //end loop vin, vout
          return cb();
        });
    } else {
      return cb('tx not found: ' + txid);
    }
  });
}

function find_tx(txid, cb) {
  Tx.findOne({txid: txid}, function(err, tx) {
    if(tx) {
      return cb(tx);
    } else {
      return cb(null);
    }
  });
}

function save_tx(txid, cb) {
  //var s_timer = new Date().getTime();
  lib.exec_rawtransaction(txid, function(tx){
    if (tx != 'There was an error. Check your console.') {
      console.log(tx);
      //change to exec_block
      lib.exec_block(tx.blockhash, function(block){
        if (block) {
          lib.prepare_vin(tx, function(vin) {
            lib.prepare_vout(tx.vout, txid, vin, function(vout, nvin) {
              lib.syncLoop(vin.length, function (loop) {
                var i = loop.iteration();
                update_address(nvin[i].addresses, txid, nvin[i].amount, 'vin', function(){
                  loop.next();
                });
              }, function(){
                lib.syncLoop(vout.length, function (subloop) {
                  var t = subloop.iteration();
                  if (vout[t].addresses) {
                    update_address(vout[t].addresses, txid, vout[t].amount, 'vout', function(){
                      subloop.next();
                    });
                  } else {
                    subloop.next();
                  }
                }, function(){
                  lib.calculate_total(vout, function(total){
                    var newTx = new Tx({
                      txid: tx.txid,
                      vin: nvin,
                      vout: vout,
                      total: total.toFixed(8),
                      timestamp: tx.time,
                      blockhash: tx.blockhash,
                      blockindex: block.height,
                    });
                    newTx.save(function(err) {
                      if (err) {
                        return cb(err);
                      } else {
                        //console.log('txid: ');
                        return cb();
                      }
                    });
                  });
                });
              });
            });
          });
        } else {
          return cb('block not found: ' + tx.blockhash);
        }
      });
    } else {
      return cb('tx not found: ' + txid);
    }
  });
}

function get_market_data(market, cb) {
  switch(market) {
    case 'tradeogre':
      tradeogre.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'crex24':
      crex24.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'stex':
      stex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'coinsbit':
      coinsbit.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'bittrex':
      bittrex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'bleutrade':
      bleutrade.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'poloniex':
      poloniex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptsy':
      cryptsy.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptsy_id, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptopia':
      cryptopia.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptopia_id, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'ccex':
      ccex.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), settings.markets.ccex_key, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'yobit':
      yobit.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'empoex':
      empoex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    default:
      return cb(null);
  }
}

module.exports = {
  // initialize DB
  connect: function(database, cb) {
    mongoose.connect(database,{ useNewUrlParser: true, useUnifiedTopology: true }, function(err) {
      if (err) {
        console.log('Unable to connect to database: %s', database);
        console.log('Aborting');
        process.exit(1);

      }
      //console.log('Successfully connected to MongoDB');
      return cb();
    });
  },

  check_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(stats);
      } else {
        return cb(null);
      }
    });
  },

  create_stats: function(coin, cb) {
    var newStats = new Stats({
      coin: coin,
    });

    newStats.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial stats entry created for %s", coin);
        //console.log(newStats);
        return cb();
      }
    });
  },

  get_income: function(coin, cb) {
    Income.findOne({coin: coin}, function(err, income) {
      if(income) {
        return cb(income);
      } else {
        return cb(null);
      }
    });
  },

  get_address: function(hash, cb) {
    find_address(hash, function(address){
      return cb(address);
    });
  },

  get_coins_by_address(hash, cb) {
    find_coins(hash, function(coinsofaddress){
      return cb(coinsofaddress);
    });
  },

  get_richlist: function(coin, cb) {
    find_richlist(coin, function(richlist){
      return cb(richlist);
    });
  },

  get_address_stats: function(type, cb) {
    const data = {addresses: 0, active: 0, top10: 0, top50: 0};
    if(type == 'top'){
      Address.find({}).sort({balance: 'desc'}).limit(50).exec(function(err, addresses){
        if (err) {return cb()}
        var address;
        for (var i=0; i < addresses.length; i++ ){
          address = addresses[i];
          if (i >=1 && i <=9){
            data.top10 = data.top10 + address.balance / 100000000;
          }
          if (i >=10 && i <=49){
            data.top50 = data.top50 + address.balance / 100000000;
          }
        }
        Stats.updateOne({coin: settings.coin}, {
            top10: data.top10,
            top50: data.top50,
        }, function() {});
        return cb(data);
      });
    }
    if(type == 'active'){
      Address.find({balance: {$gt: 100000000}}).exec(function(err, addresses){
        if (err) {return cb()}
        data.active = addresses.length;
        Stats.updateOne({coin: settings.coin}, {
            active_addresses: addresses.length,
        }, function() {});
        return cb(data);
      });
    }
    if(type == 'count'){
      Address.countDocuments().exec(function(err, count){
        if (err) {return cb()}
        data.addresses = count;
        Stats.updateOne({coin: settings.coin}, {
            addresses: count,
        }, function() {});
        return cb(data);
      });
    }
  },

  //property: 'received' or 'balance'
  update_richlist: function(list, cb){
    if(list == 'received') {
      Address.find({}, 'a_id balance received').sort({received: 'desc'}).limit(200).exec(function(err, addresses){
        Richlist.updateOne({coin: settings.coin}, {
          received: addresses,
        }, function() {
          return cb();
        });
      });
    } else { //balance
      Address.find({}, 'a_id balance received').sort({balance: 'desc'}).limit(200).exec(function(err, addresses){
        Richlist.updateOne({coin: settings.coin}, {
          balance: addresses,
        }, function() {
          return cb();
        });
      });
    }
  },

  get_tx: function(txid, cb) {
    find_tx(txid, function(tx){
      return cb(tx);
    });
  },

  get_txs: function(block, cb) {
    var txs = [];
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      find_tx(block.tx[i], function(tx){
        if (tx) {
          txs.push(tx);
          loop.next();
        } else {
          loop.next();
        }
      })
    }, function(){
      return cb(txs);
    });
  },

  create_tx: function(txid, cb) {
    save_tx(txid, function(err){
      if (err) {
        return cb(err);
      } else {
        //console.log('tx stored: %s', txid);
        return cb();
      }
    });
  },

  create_txs: function(block, cb) {
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      save_tx(block.tx[i], function(err){
        if (err) {
          loop.next();
        } else {
          //console.log('tx stored: %s', block.tx[i]);
          loop.next();
        }
      });
    }, function(){
      return cb();
    });
  },

  get_last_txs: function(count, min, cb) {
    Tx.find({'total': {$gt: min}}).sort({_id: 'desc'}).limit(count).exec(function(err, txs){
      if (err) {
        return cb(err);
      } else {
        return cb(txs);
      }
    });
  },

  create_market: function(coin, exchange, market, cb) {
    var newMarkets = new Markets({
      market: market,
      coin: coin,
      exchange: exchange,
    });

    newMarkets.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial markets entry created for %s", market);
        //console.log(newMarkets);
        return cb();
      }
    });
  },

  // checks market data exists for given market
  check_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, exists) {
      if(exists) {
        return cb(market, true);
      } else {
        return cb(market, false);
      }
    });
  },

  // gets market data for given market
  get_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, data) {
      if(data) {
        return cb(data);
      } else {
        return cb(null);
      }
    });
  },

  // creates initial richlist entry in database; called on first launch of explorer
  create_richlist: function(coin, cb) {
    var newRichlist = new Richlist({
      coin: coin,
    });
    newRichlist.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial richlist entry created for %s", coin);
        //console.log(newRichlist);
        return cb();
      }
    });
  },
  // checks richlist data exists for given coin
  check_richlist: function(coin, cb) {
    Richlist.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  // drops richlist data for given coin
  delete_richlist: function(coin, cb) {
    Richlist.findOneAndRemove({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  create_heavy: function(coin, cb) {
    var newHeavy = new Heavy({
      coin: coin,
    });
    newHeavy.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial heavy entry created for %s", coin);
        console.log(newHeavy);
        return cb();
      }
    });
  },

  check_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, heavy) {
      if(heavy) {
        return cb(heavy);
      } else {
        return cb(null);
      }
    });
  },
  get_distribution: function(richlist, stats, cb){
    var distribution = {
      supply: stats.supply - stats.fee_burn,
      t_1_25: {percent: 0, total: 0 },
      t_26_50: {percent: 0, total: 0 },
      t_51_75: {percent: 0, total: 0 },
      t_76_100: {percent: 0, total: 0 },
      t_101_200: {percent: 0, total: 0 },
      t_201plus: {percent: 0, total: 0 }
    };
    lib.syncLoop(richlist.balance.length, function (loop) {
      var i = loop.iteration();
      var percentage = 0;
      if (i >= 1) {
        percentage = ((richlist.balance[i].balance / 100000000) / (stats.supply - stats.fee_burn)) * 100;
      }
      if (i <= 25 && i >= 1) {
        distribution.t_1_25.percent = distribution.t_1_25.percent + percentage;
        distribution.t_1_25.total = distribution.t_1_25.total + (richlist.balance[i].balance / 100000000);
      }
      if (i <= 50 && i > 25) {
        distribution.t_26_50.percent = distribution.t_26_50.percent + percentage;
        distribution.t_26_50.total = distribution.t_26_50.total + (richlist.balance[i].balance / 100000000);
      }
      if (i <= 75 && i > 50) {
        distribution.t_51_75.percent = distribution.t_51_75.percent + percentage;
        distribution.t_51_75.total = distribution.t_51_75.total + (richlist.balance[i].balance / 100000000);
      }
      if (i <= 100 && i > 75) {
        distribution.t_76_100.percent = distribution.t_76_100.percent + percentage;
        distribution.t_76_100.total = distribution.t_76_100.total + (richlist.balance[i].balance / 100000000);
      }
      if (i <= 200 && i > 100) {
        distribution.t_101_200.percent = distribution.t_101_200.percent + percentage;
        distribution.t_101_200.total = distribution.t_101_200.total + (richlist.balance[i].balance / 100000000);
      }
      loop.next();
    }, function(){
      distribution.t_201plus.percent = parseFloat(100 - distribution.t_101_200.percent - distribution.t_76_100.percent - distribution.t_51_75.percent - distribution.t_26_50.percent - distribution.t_1_25.percent).toFixed(2);
      distribution.t_201plus.total = parseFloat(distribution.supply - distribution.t_101_200.total - distribution.t_76_100.total - distribution.t_51_75.total - distribution.t_26_50.total - distribution.t_1_25.total).toFixed(8);
      distribution.t_1_25.percent = parseFloat(distribution.t_1_25.percent).toFixed(2);
      distribution.t_1_25.total = parseFloat(distribution.t_1_25.total).toFixed(8);
      distribution.t_26_50.percent = parseFloat(distribution.t_26_50.percent).toFixed(2);
      distribution.t_26_50.total = parseFloat(distribution.t_26_50.total).toFixed(8);
      distribution.t_51_75.percent = parseFloat(distribution.t_51_75.percent).toFixed(2);
      distribution.t_51_75.total = parseFloat(distribution.t_51_75.total).toFixed(8);
      distribution.t_76_100.percent = parseFloat(distribution.t_76_100.percent).toFixed(2);
      distribution.t_76_100.total = parseFloat(distribution.t_76_100.total).toFixed(8);
      distribution.t_101_200.percent = parseFloat(distribution.t_101_200.percent).toFixed(2);
      distribution.t_101_200.total = parseFloat(distribution.t_101_200.total).toFixed(8);
      return cb(distribution);
    });
  },
  // updates heavy stats for coin
  // height: current block height, count: amount of votes to store
  update_heavy: function(coin, height, count, cb) {
    var newVotes = [];
    lib.get_maxmoney( function (maxmoney) {
      lib.get_maxvote( function (maxvote) {
        lib.get_vote( function (vote) {
          lib.get_phase( function (phase) {
            lib.get_reward( function (reward) {
              lib.get_supply( function (supply) {
                lib.get_estnext( function (estnext) {
                  lib.get_nextin( function (nextin) {
                    lib.syncLoop(count, function (loop) {
                      var i = loop.iteration();
                      lib.get_blockhash(height-i, function (hash) {
                        lib.get_block(hash, function (block) {
                          newVotes.push({count:height-i,reward:block.reward,vote:block.vote});
                          loop.next();
                        });
                      });
                    }, function(){
                      console.log(newVotes);
                      Heavy.updateOne({coin: coin}, {
                        lvote: vote,
                        reward: reward,
                        supply: supply,
                        cap: maxmoney,
                        estnext: estnext,
                        phase: phase,
                        maxvote: maxvote,
                        nextin: nextin,
                        votes: newVotes,
                      }, function() {
                        //console.log('address updated: %s', hash);
                        return cb();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  },

  // updates market data for given market; called by sync.js
  update_markets_db: function(market, cb) {
    get_market_data(market, function (err, obj) {
      console.log(JSON.stringify(obj));
      if (err == null) {
        Markets.updateOne({market:market}, {
          chartdata: JSON.stringify(obj.chartdata),
          buys: obj.buys,
          sells: obj.sells,
          history: obj.trades,
          summary: obj.stats,
        }, function() {
          if ( market == settings.markets.default ) {
            Stats.updateOne({coin:settings.coin}, {
              last_price: obj.stats.last,
            }, function(){
              return cb(null);
            });
          } else {
            return cb(null);
          }
        });
      } else {
        return cb(err);
      }
    });
  },

  // updates stats data for given coin; called by sync.js
  update_db: function(coin, cb) {
    lib.get_blockcount( function (count) {
      if (!count){
        console.log('Unable to connect to explorer API');
        return cb(false);
      }
      lib.get_supply( function (supply){
        lib.get_connectioncount(function (connections) {
          Stats.updateOne({coin: coin}, {
            coin: coin,
            count : count,
            supply: supply,
            connections: connections,
          }, function() {
            return cb(true);
          });
        });
      });
    });
  },

  remove_spent_coin(coin, cb){
    Stats.findOne({coin: coin}, function(err, nstats) {
       console.log("remove spent coins at: " + nstats.coin_view_height);
       Coin.deleteMany({spendHeight: {$gt: 0}}, function(err){
         if(err){
           console.log('can not delete coins at height: %s', nstats.coin_view_height);
           process.exit(0);
         } else {
           return cb(null);
         }
       });
    });
  },

  delete_coin_lastStatsHeight(coin, cb){
    Stats.findOne({coin: coin}, function(err, nstats) {
      console.log("remove last block: " + nstats.coin_view_height);
      Coin.deleteMany({height: nstats.coin_view_height}, function(err){
        if(err){
          console.log('can not delete coins at height: %s', nstats.coin_view_height);
          process.exit(0);
        } else {

          lib.get_blockhash(nstats.coin_view_height, function(blockhash){
            if (blockhash != 'There was an error. Check your console.') {
              console.log('block %d: %s', nstats.coin_view_height, blockhash);
              lib.get_block(blockhash, function(block) {
                if (block != 'There was an error. Check your console.') {
                  if(block && block.tx){
                    console.log('txes in block: %d', block.tx.length);
                    lib.syncLoop(block.tx.length, function (subloop) {
                      var i = subloop.iteration();
                      console.log(block.tx[i]);
                      tx_update_spent_coin(block.tx[i], function(err){
                        if(err){
                          process.exit(0);
                        } else {
                          subloop.next();
                        }
                      });
                    }, function(){
                      Stats.updateOne({coin:settings.coin}, {
                        coin_view_height: nstats.coin_view_height - 1,
                      }, function(){
                        return cb(null);
                      });
                    });
                  } else {
                    console.log('cannot read block contain: %s', blockhash);
                    process.exit(0);
                  }
                } else {
                  console.log('block not found: %s', blockhash);
                  process.exit(0);
                }
              });
            } else {
              console.log('block hash not found: %d', nHeight);
              process.exit(0);
            }
          });

        }
      });
    });
  },

  update_coin_db: function(coin, start, end, timeout, cb) {
    Stats.findOne({coin: coin}, function(err, nstats) {
      var complete = false;
      var beginLoop = 0, endLoop = 0;

      beginLoop = nstats.coin_view_height + 1;
      if(end >= nstats.count) endLoop = nstats.count - 55;
      else if(end < nstats.count && end > nstats.coin_view_height) endLoop = end;
      else {
        console.log('coin_view_height: %s', nstats.coin_view_height);
        process.exit(0);
      }
      if(beginLoop > endLoop){
        console.log('begin: %s is superior than end: %s', beginLoop, endLoop);
        process.exit(0);
      }

      lib.syncLoop((endLoop - beginLoop) + 1, function (loop) {
        var x = loop.iteration();
        var nHeight = parseInt(beginLoop) + parseInt(x);
        lib.get_blockhash(nHeight, function(blockhash){
          if (blockhash != 'There was an error. Check your console.') {
            console.log('block %d: %s', nHeight, blockhash);
            lib.get_block(blockhash, function(block) {
              if (block != 'There was an error. Check your console.') {
                if(block && block.tx){
                  console.log('txes in block: %d', block.tx.length);
                  lib.syncLoop(block.tx.length, function (subloop) {
                    var i = subloop.iteration();
                    tx_to_coin(block.tx[i], nHeight, function(err){
                      if (err) {
                        console.log(err);
                      } else {
                        console.log('End block number %s', block.height);
                        subloop.next();
                      }
                    });
                  }, function(){
                    //end tx loop, begin new block. update stats collection
                    console.log("end loop for tx in block. next block!");
                    Stats.updateOne({coin: coin}, {
                      coin_view_height: nHeight,
                    }, function() {
                      blockhash = null;
                      block = null;
                      loop.next();
                    });
                  });
                } else {
                  console.log('cannot read block contain: %s', blockhash);
                  process.exit(0);
                }
              } else {
                console.log('block not found: %s', blockhash);
                process.exit(0);
              }
            });
          } else {
            console.log('block hash not found: %d', nHeight);
            process.exit(0);
          }
        });
      }, function(){
        console.log('finished update coin for block: %d', end);
        return cb();
      });
    });
  },

  // updates tx, address & richlist db's; called by sync.js
  update_tx_db: function(coin, start, end, timeout, cb) {
    var complete = false;
    var retryBlock = false;
    console.log('load block start: %d, end: %d', start, end);
    lib.syncLoop((end - start) + 1, function (loop) {
      var x = loop.iteration();
      console.log('block number :%d', start + x);
      if (x % 5 === 0) {
        Tx.find({}).where('blockindex').lt(start + x).sort({timestamp: 'desc'}).limit(settings.index.last_txs).exec(function(err, txs){
          Stats.updateOne({coin: coin}, {
            last: parseInt(start) + x - 1,
            last_txs: ''
          }, function() {});
        });
      }
      //chang to exec_blockhash
      lib.exec_blockhash(start + x, function(blockhash){
        if (blockhash != 'There was an error. Check your console.') {
          console.log('blockhash: %s', blockhash);
          lib.exec_block(blockhash, function(block) {
            if(block == 'There was an error. Check your console.') {
                console.log('block not found: There was an error. Check your console.', );
                process.exit(0);
            }
            console.log('block number :%d, hash :%s, block: %s', start + x, blockhash, JSON.stringify(block));
            if (block && block.tx) {
              console.log('txes in block: %d', block.tx.length);
              lib.syncLoop(block.tx.length, function (subloop) {
                var i = subloop.iteration();
                console.log('check tx: %s', block.tx[i]);
                Tx.findOne({txid: block.tx[i]}, function(err, tx) {
                  if(tx) {
                    console.log('tx found: %s', block.tx[i]);
                    tx = null;
                    subloop.next();
                  } else {
                    save_tx(block.tx[i], function(err){
                      if (err) {
                        console.log(err);
                        tx = null;
                        subloop.next();
                      } else {
                        console.log('%s: %s', block.height, block.tx[i]);
                        subloop.next();
                      }
                    });
                  }
                });
              }, function(){
                console.log('end of block: %s', blockhash);
                blockhash = null;
                block = null;
                loop.next();
              });
            } else {
              console.log('block not found: %s', blockhash);
              process.exit(0);
            }
/*
            setTimeout( function(){
                        console.log('find block infos timeout. Exit');
                        process.exit(0);
                      }, 10000);
*/
            });
        } else {
          console.log('block hash not found for block number: %d', start + x);
          process.exit(0);
        }
      });
    }, function(){
      console.log('End of process');
      return cb();
    });
  },

  get_tx_stats: function(height, cb){
    var deepth7 = height - 7*720;
    var deepth6 = height - 6*720;
    var deepth5 = height - 5*720;
    var deepth4 = height - 4*720;
    var deepth3 = height - 3*720;
    var deepth2 = height - 2*720;
    var deepth1 = height - 1*720;
    var blockH = height - 0;
    const cursor = Tx.aggregate([
                                     {$match: {
                                       $and: [
                                         {blockindex: {$gt: deepth7}},
                                         {vin: {$elemMatch: {addresses : {$ne: "coinbase"}}}}
                                       ]
                                     }},
                                     {$group: {
                                       "_id" : {
                                         $concat: [
                                           { $cond: [{$lt: ["$blockindex",deepth7]}, "L", ""]},
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth7 ]}, {$lt: ["$blockindex", deepth6]}]}, "H-"+deepth7, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth6 ]}, {$lt: ["$blockindex", deepth5]}]}, "H-"+deepth6, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth5 ]}, {$lt: ["$blockindex", deepth4]}]}, "H-"+deepth5, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth4 ]}, {$lt: ["$blockindex", deepth3]}]}, "H-"+deepth4, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth3 ]}, {$lt: ["$blockindex", deepth2]}]}, "H-"+deepth3, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth2 ]}, {$lt: ["$blockindex", deepth1]}]}, "H-"+deepth2, ""] },
                                           { $cond: [{$and:[ {$gte:["$blockindex", deepth1 ]}, {$lt: ["$blockindex", blockH]}]}, "H-"+deepth1, ""] },
                                           { $cond: [{$gte:["$blockindex",blockH]}, "H-X", ""]}
                                         ]
                                       },
                                       count: { $sum: 1 },
                                       total: { $sum: "$total" }
                                     }},
                                     {$sort : { _id : 1} }
                                  ]).cursor({ batchSize: 1000}).exec();
    const data = [];
    const result = async function () {
        var doc;
        while ((doc = await cursor.next())) {
          if (doc) {
            var item = {range: doc['_id'], count: doc['count'], total: doc['total']};
            data.push(item);
          }
        }
        return cb(data)
    };
    result();
  },

  create_peer: function(params, cb) {
    var newPeer = new Peers(params);
    newPeer.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_peer: function(address, cb) {
    Peers.findOne({address: address}, function(err, peer) {
      if (err) {
        return cb(null);
      } else {
        if (peer) {
         return cb(peer);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_peers: function(cb) {
    Peers.find({}, function(err, peers) {
      if (err) {
        return cb([]);
      } else {
        return cb(peers);
      }
    });
  },

  create_node: function(params, cb) {
    var newNode = new Nodes(params);
    newNode.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_node: function(address, cb) {
    Nodes.findOne({address: address}, function(err, node) {
      if (err) {
        return cb(null);
      } else {
        if (node) {
         return cb(node);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_nodes: function(cb) {
    Nodes.find({}, function(err, nodes) {
      if (err) {
        return cb([]);
      } else {
        return cb(nodes);
      }
    });
  },

  find_hco: function(begin, cb) {
    Coin.find({"type": "checklocktimeverify", "spendHeight": {$eq: 0}, "height": {$gt: begin}}, function(err, coins) {
console.log("found:" +coins.lenght)
      if(coins) {
        return cb(coins);
      } else {
        return cb();
      }
    });
  },

  create_infnode: function(params, cb) {
    var newInfNode = new Inf(params);
    newInfNode.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_infnode: function(address, cb) {
    Inf.findOne({burntx: address}, function(err, node) {
      if (err) {
        return cb(null);
      } else {
        if (node) {
         return cb(node);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_infnodes: function(cb) {
    Inf.find({}, function(err, nodes) {
      if (err) {
        return cb([]);
      } else {
        return cb(nodes);
      }
    });
  },

  get_node_expire: function(cb){
    const cursor = Nodes.aggregate([
                     {$project: {
                       _id: 0,
                     }},
                     {$project: {
                       "range": {
                         $concat: [
                           { $cond: [{$lte: ["$expire_height",0]}, "Unknown", ""]},
                           { $cond: [{$and:[ {$gt:["$expire_height", 0 ]}, {$lt: ["$expire_height", 400000]}]}, "Under 400k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 400000 ]}, {$lt: ["$expire_height", 410000]}]}, "400k - 410k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 410000 ]}, {$lt: ["$expire_height", 420000]}]}, "410k - 420k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 420000 ]}, {$lt: ["$expire_height", 430000]}]}, "420k - 430k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 430000 ]}, {$lt: ["$expire_height", 440000]}]}, "430k - 440k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 440000 ]}, {$lt: ["$expire_height", 450000]}]}, "440k - 450k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 450000 ]}, {$lt: ["$expire_height", 460000]}]}, "450k - 460k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 460000 ]}, {$lt: ["$expire_height", 470000]}]}, "460k - 470k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 470000 ]}, {$lt: ["$expire_height", 480000]}]}, "470k - 480k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 480000 ]}, {$lt: ["$expire_height", 490000]}]}, "480k - 490k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 490000 ]}, {$lt: ["$expire_height", 500000]}]}, "490k - 500k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 500000 ]}, {$lt: ["$expire_height", 510000]}]}, "500k - 510k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 510000 ]}, {$lt: ["$expire_height", 520000]}]}, "510k - 520k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 520000 ]}, {$lt: ["$expire_height", 530000]}]}, "520k - 530k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 530000 ]}, {$lt: ["$expire_height", 540000]}]}, "530k - 540k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 540000 ]}, {$lt: ["$expire_height", 550000]}]}, "540k - 550k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 550000 ]}, {$lt: ["$expire_height", 560000]}]}, "550k - 560k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 560000 ]}, {$lt: ["$expire_height", 570000]}]}, "560k - 570k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 570000 ]}, {$lt: ["$expire_height", 580000]}]}, "570k - 580k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 580000 ]}, {$lt: ["$expire_height", 590000]}]}, "580k - 590k", ""] },
                           { $cond: [{$and:[ {$gt:["$expire_height", 590000 ]}, {$lt: ["$expire_height", 600000]}]}, "590k - 600k", ""] },
                           { $cond: [{$gte:["$expire_height",600000]}, "Over 600k", ""]}
                         ]
                       }
                     }},
                     {$group: {
                       "_id" : "$range",
                       count: { $sum: 1 }
                     }},
                     {$sort : { _id : 1} }
                  ]).cursor({ batchSize: 1000}).exec();
    const data = [];
    const result = async function () {
        var doc;
        while ((doc = await cursor.next())) {
          if (doc) {
            var item = {range: doc['_id'], number: doc['count']};
            data.push(item);
          }
        }
        return cb(data)
    };
    result();
  },

  find_locationnode: function(location, cb) {
    LocationNodes.findOne({location: location}, function(err, locationnode) {
      if (err) {
        return cb(null);
      } else {
        if (locationnode) {
         return cb(locationnode);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_locationnodes: function(cb) {
    LocationNodes.find({}, function(err, locationnodes) {
      if (err) {
        return cb([]);
      } else {
        return cb(locationnodes);
      }
    });
  },

  create_locationnode: function(params, cb) {
    var newLocationNode = new LocationNodes(params);
    newLocationNode.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  update_locationnode: function(params, cb) {
    var newLocationNode = new LocationNodes(params);
    LocationNodes.updateOne(
      {location: newLocationNode.location},
      {
        location: newLocationNode.location,
        lil: newLocationNode.lil,
        mid: newLocationNode.mid,
        big: newLocationNode.big,
      },
      function() {
          return cb();
      }
    );
  },

  create_pool: function(params, cb) {
    var newPool = new Pools(params);
    newPool.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_pool: function(name, cb) {
    Pools.findOne({pool_name: name}, function(err, pool) {
      if (err) {
        return cb(null);
      } else {
        if (pool) {
         return cb(pool);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_pools: function(cb) {
    Pools.find({}, function(err, pools) {
      if (err) {
        return cb([]);
      } else {
        return cb(pools);
      }
    });
  },

  create_termdepositstats: function(params, cb) {
    var newTermDepositStats = new TermDepositStats(params);
    newTermDepositStats.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  get_termdepositstats: function(cb) {
    TermDepositStats.find({}, function(err, termDepositStats) {
      if (err) {
        return cb({term_deposit_wallets: 0});
      } else {
        return cb(termDepositStats);
      }
    });
  }
};
