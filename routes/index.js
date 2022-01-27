var express = require('express')
  , fs = require("fs")
  , jsonminify = require("jsonminify")
  , router = express.Router()
  , settings = require('../lib/settings')
  , locale = require('../lib/locale')
  , db = require('../lib/database')
  , lib = require('../lib/explorer')
  , qr = require('qr-image');

function route_get_block(res, blockhash) {
  lib.get_block(blockhash, function (block) {
    if (block != 'There was an error. Check your console.') {
      if (blockhash == settings.genesis_block) {
        res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: 'GENESIS'});
      } else {
        db.get_txs(block, function(txs) {
          if (txs.length > 0) {
            res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: txs});
          } else {
            db.create_txs(block, function(){
              db.get_txs(block, function(ntxs) {
                if (ntxs.length > 0) {
                  res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: ntxs});
                } else {
                  route_get_index(res, 'Block not found: ' + blockhash);
                }
              });
            });
          }
        });
      }
    } else {
      route_get_index(res, 'Block not found: ' + blockhash);
    }
  });
}
/* GET functions */

function route_get_tx(res, txid) {
  if (txid == settings.genesis_tx) {
    route_get_block(res, settings.genesis_block);
  } else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        lib.get_blockcount(function(blockcount) {
          res.render('tx', { active: 'tx', tx: tx, confirmations: settings.confirmations, blockcount: blockcount});
        });
      }
      else {
        lib.get_rawtransaction(txid, function(rtx) {
          if (rtx.txid) {
            lib.prepare_vin(rtx, function(vin) {
              lib.prepare_vout(rtx.vout, rtx.txid, vin, function(rvout, rvin) {
                lib.calculate_total(rvout, function(total){
                  if (!rtx.confirmations > 0) {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      total: total.toFixed(8),
                      timestamp: rtx.time,
                      blockhash: '-',
                      blockindex: -1,
                    };
                    res.render('tx', { active: 'tx', tx: utx, confirmations: settings.confirmations, blockcount:-1});
                  } else {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      total: total.toFixed(8),
                      timestamp: rtx.time,
                      blockhash: rtx.blockhash,
                      blockindex: rtx.blockheight,
                    };
                    lib.get_blockcount(function(blockcount) {
                      res.render('tx', { active: 'tx', tx: utx, confirmations: settings.confirmations, blockcount: blockcount});
                    });
                  }
                });
              });
            });
          } else {
            route_get_index(res, null);
          }
        });
      }
    });
  }
}

function route_get_dashboard(res, error) {
  res.render('dashboard', { active: 'dashboard', error: error, warning: null});
}

function route_get_index(res, error) {
  res.render('index', { active: 'index', error: error, warning: null});
}

function route_get_address(res, hash, count) {
  db.get_address(hash, function(address) {
    if (address) {
      var txs = [];
      var hashes = address.txs.reverse();
      if (address.txs.length < count) {
        count = address.txs.length;
      }
      lib.syncLoop(count, function (loop) {
        var i = loop.iteration();
        db.get_tx(hashes[i].address, function(tx) {
          if (tx) {
            txs.push(tx);
            loop.next();
          } else {
            loop.next();
          }
        });
      }, function(){

        res.render('address', { active: 'address', address: address, txs: txs});
      });

    } else {
      route_get_index(res, hash + ' not found');
    }
  });
}

/* GET home page. */
router.get('/', function(req, res) {
  route_get_dashboard(res, null);
});

router.get('/info', function(req, res) {
  res.render('info', { active: 'info', address: settings.address, hashes: settings.api });
});

router.get('/gettermdepositstats', function(req, res) {
    var termdepositstatsFilename = "termdepositstats.json";
	termdepositstatsFilename = "./" + termdepositstatsFilename;

	var termdepositstatsStr;
	try{
		//read the settings sync
		termdepositstatsStr = fs.readFileSync(termdepositstatsFilename).toString();
	} catch(e){
		console.warn('No stats file found. Continuing using defaults!');
	}

	var termdepositstats = {"nAddress": 0, "nTimeLockedTxs": 0, "nTotalTimeLockedValue": 0, "nBurnFee": 0, "nBurnNode": 0};
	try {
		if(termdepositstatsStr) {
			termdepositstatsStr = jsonminify(termdepositstatsStr).replace(",]","]").replace(",}","}");
			termdepositstats = JSON.parse(termdepositstatsStr);
			res.send({ 	nAddress: termdepositstats.nAddress,
					nTimeLockedTxs: termdepositstats.nTimeLockedTxs,
					nTotalTimeLockedValue: termdepositstats.nTotalTimeLockedValue,
					nBurnFee: termdepositstats.nBurnFee,
					nBurnNode: termdepositstats.nBurnNode,
					distribution: termdepositstats.distribution
			});
		}else{
			res.send(termdepositstats);
		}
	}catch(e){
		res.send(termdepositstats);
	}
});

router.get('/officialpoolinfo', function(req, res) {
    var poolinfoFilename = "sin.pool.sinovate.io.json";
    poolinfoFilename = "./cache/" + poolinfoFilename;

    var poolinfoStr;
    try{
        //read json file
        poolinfoStr = fs.readFileSync(poolinfoFilename).toString();
    } catch(e) {
        console.warn('No stats file found. Continuing using defaults!');
    }

   var poolinfo = {"algo": "", "height": 0, "workers": 0, "hashrate": 0, "blocksfound": 0};
   try {
        if(poolinfoStr) {
            poolinfoStr = jsonminify(poolinfoStr).replace(",]","]").replace(",}","}");
            poolinfo = JSON.parse(poolinfoStr);
            res.send({
                algo: poolinfo.SIN.algo,
                height: poolinfo.SIN.height,
                workers: poolinfo.SIN.workers,
                hashrate: poolinfo.SIN.hashrate,
                blocksfound: poolinfo.SIN['24h_blocks']
            });
        } else {
            res.send(poolinfo);
        }
   } catch(e) {
        res.send(poolinfo);
   }
});

router.get('/getblockcount', function(req, res) {
    var summarystatsFilename = "summary.json";
	summarystatsFilename = "./" + summarystatsFilename;

	var summarystatsStr;
	try{
		//read the settings sync
		summarystatsStr = fs.readFileSync(summarystatsFilename).toString();
	} catch(e){
		console.warn('No stats file found. Continuing using defaults!');
	}
	var summarystats = {"blockcount": -1};
	try {
		if(summarystatsStr) {
			summarystatsStr = jsonminify(summarystatsStr).replace(",]","]").replace(",}","}");
			summarystats = JSON.parse(summarystatsStr);
			res.send(''+summarystats.data[0].blockcount);
		}else{
			res.send('');
		}
	}catch(e){
		res.send('');
	}
});

router.get('/summary', function(req, res) {
    var summarystatsFilename = "summary.json";
	summarystatsFilename = "./cache/" + summarystatsFilename;

	var summarystatsStr;
	try{
		//read the settings sync
		summarystatsStr = fs.readFileSync(summarystatsFilename).toString();
	} catch(e){
		console.warn('No stats file found. Continuing using defaults!');
	}

	var summarystats = {"difficulty":0,
						"difficultyHybrid":"",
						"supply":0,
						"hashrate":"0.0",
						"lastPrice":0,
						"connections":0,
						"blockcount":0,
						"explorerHeight": 0,
						"explorerAddress": 0,
						"explorerActiveAddress": 0,
						"explorerTop10": 0,
						"explorerTop50": 0,
						"burnFee":0,
						"burnNode":0};
	try {
		if(summarystatsStr) {
			summarystatsStr = jsonminify(summarystatsStr).replace(",]","]").replace(",}","}");
			summarystats = JSON.parse(summarystatsStr);
			res.send({
					difficulty: summarystats.data[0].difficulty,
					difficultyHybrid: summarystats.data[0].difficultyHybrid,
					supply: summarystats.data[0].supply - summarystats.data[0].burnFee,
					hashrate: summarystats.data[0].hashrate,
                                        known_hashrate: summarystats.data[0].known_hashrate,
					lastPrice: summarystats.data[0].lastPrice,
					connections: summarystats.data[0].connections,
					blockcount: summarystats.data[0].blockcount,
					explorerHeight: summarystats.data[0].explorerHeight,
					explorerAddress: summarystats.data[0].explorerAddress,
					explorerActiveAddress: summarystats.data[0].explorerActiveAddress,
					explorerTop10: summarystats.data[0].explorerTop10,
					explorerTop50: summarystats.data[0].explorerTop50,
					burnFee: summarystats.data[0].burnFee,
					burnNode: summarystats.data[0].burnNode,
                                        poolHeight: summarystats.data[0].poolHeight,
                                        tx_d0_count: summarystats.data[0].tx_d0_count,
                                        tx_d0_value: summarystats.data[0].tx_d0_value,
                                        tx_d1_count: summarystats.data[0].tx_d1_count,
                                        tx_d1_value: summarystats.data[0].tx_d1_value,
                                        tx_d2_count: summarystats.data[0].tx_d2_count,
                                        tx_d2_value: summarystats.data[0].tx_d2_value,
                                        tx_d3_count: summarystats.data[0].tx_d3_count,
                                        tx_d3_value: summarystats.data[0].tx_d3_value,
                                        tx_d4_count: summarystats.data[0].tx_d4_count,
                                        tx_d4_value: summarystats.data[0].tx_d4_value,
                                        tx_d5_count: summarystats.data[0].tx_d5_count,
                                        tx_d5_value: summarystats.data[0].tx_d5_value,
                                        tx_d6_count: summarystats.data[0].tx_d6_count,
                                        tx_d6_value: summarystats.data[0].tx_d6_value,
                                        inf_exp: summarystats.data[0].inf_exp,
                                        inf_exp_1d: summarystats.data[0].inf_exp_1d,
                                        inf_exp_7d: summarystats.data[0].inf_exp_7d,
                                        inf_exp_14d: summarystats.data[0].inf_exp_14d,
                                        inf_exp_30d: summarystats.data[0].inf_exp_30d,
                                        inf_exp_60d: summarystats.data[0].inf_exp_60d,
                                        inf_exp_90d: summarystats.data[0].inf_exp_90d,
                                        inf_exp_120d: summarystats.data[0].inf_exp_120d,
                                        inf_exp_150d: summarystats.data[0].inf_exp_150d,
                                        inf_exp_180d: summarystats.data[0].inf_exp_180d,
                                        inf_exp_270d: summarystats.data[0].inf_exp_270d,
                                        inf_exp_365d: summarystats.data[0].inf_exp_365d,
                                        inf_burnt_big: summarystats.data[0].inf_burnt_big,
                                        inf_burnt_mid: summarystats.data[0].inf_burnt_mid,
                                        inf_burnt_lil: summarystats.data[0].inf_burnt_lil,
                                        inf_online_big: summarystats.data[0].inf_online_big,
                                        inf_online_mid: summarystats.data[0].inf_online_mid,
                                        inf_online_lil: summarystats.data[0].inf_online_lil,
                                        in_burnt_big: summarystats.data[0].in_burnt_big,
                                        in_burnt_mid: summarystats.data[0].in_burnt_mid,
                                        in_burnt_lil: summarystats.data[0].in_burnt_lil,
                                        in_burnt_address: summarystats.data[0].in_burnt_address,
                                        in_burnt_tx: summarystats.data[0].in_burnt_tx,
                                        payout_miner: summarystats.data[0].payout_miner,
                                        payout_node_big: summarystats.data[0].payout_node_big,
                                        payout_node_mid: summarystats.data[0].payout_node_mid,
                                        payout_node_lil: summarystats.data[0].payout_node_lil,
                                        hco_3m: summarystats.data[0].hco_3m,
                                        hco_6m: summarystats.data[0].hco_6m,
                                        hco_12m: summarystats.data[0].hco_12m,
			});
		}else{
			res.send(summarystats);
		}
	}catch(e){
		res.send(summarystats);
	}
});

router.get('/getmoneysupply', function(req, res) {
    var summarystatsFilename = "summary.json";
	summarystatsFilename = "./cache/" + summarystatsFilename;

	var summarystatsStr;
	try{
		//read the settings sync
		summarystatsStr = fs.readFileSync(summarystatsFilename).toString();
	} catch(e){
		console.warn('No stats file found. Continuing using defaults!');
	}

	var summarystats = {"supply":0,
						"burnFee":0,
						"burnNode":0};
	try {
		if(summarystatsStr) {
			summarystatsStr = jsonminify(summarystatsStr).replace(",]","]").replace(",}","}");
			summarystats = JSON.parse(summarystatsStr);
			res.send( ' ' + (summarystats.data[0].supply - summarystats.data[0].burnFee));
		}else{
			res.send(' ' + 0);
		}
	}catch(e){
		res.send(' ' + 0);
	}
});

router.get('/poollist', function(req, res) {
	const data = [];
	db.get_pools(function(pools){
		if (pools){
			var count = pools.length;
			lib.syncLoop(count, function (loop) {
				var i = loop.iteration();
				data.push({
					createdAt: pools[i].createdAt,
					pool_name: pools[i].pool_name,
					homepage: pools[i].homepage,
					block_height: pools[i].block_height,
					workers: pools[i].workers,
					blocks_in_24h: pools[i].blocks_in_24h,
					last_block: pools[i].last_block,
					pool_hashrate: pools[i].pool_hashrate
				});
 				loop.next();
			}, function(){
				res.send({data: data});
			});
		} else {
			route_get_index(res, 'Pool list not found in database');
		}
	});
});

router.get('/markets/:market', function(req, res) {
  var market = req.params['market'];
  if (settings.markets.enabled.indexOf(market) != -1) {
    db.get_market(market, function(data) {
      function timeConverter(UNIX_timestamp){
        var a = new Date(UNIX_timestamp * 1000);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var year = a.getFullYear();
        var month = months[a.getMonth()];
        var date = a.getDate();
        var hour = a.getHours();
        var min = a.getMinutes();
        var sec = a.getSeconds();
        var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
        return time;
      }
      if (market === 'tradeogre') {
        for(var i=0; i < data.history.length; i++){
          data.history[i].date = timeConverter(data.history[i].date);
        }
      }
      console.log(data);
      res.render('./markets/' + market, {
        active: 'markets',
        marketdata: {
          coin: settings.markets.coin,
          exchange: settings.markets.exchange,
          data: data,
        },
        market: market
      });
    });
  } else {
    route_get_index(res, null);
  }
});

router.get('/richlist', function(req, res) {
  if (settings.display.richlist == true ) {
    db.get_stats(settings.coin, function (stats) {
      db.get_richlist(settings.coin, function(richlist){
        //console.log(richlist);
        if (richlist) {
          db.get_distribution(richlist, stats, function(distribution) {
            res.render('richlist', {
              active: 'richlist',
              balance: richlist.balance,
              received: richlist.received,
              stats: stats,
              dista: distribution.t_1_25,
              distb: distribution.t_26_50,
              distc: distribution.t_51_75,
              distd: distribution.t_76_100,
              diste: distribution.t_101_200,
              distf: distribution.t_201plus,
              show_dist: settings.richlist.distribution,
              show_received: settings.richlist.received,
              show_balance: settings.richlist.balance,
            });
          });
        } else {
          route_get_index(res, null);
        }
      });
    });
  } else {
    route_get_index(res, null);
  }
});

router.get('/movement', function(req, res) {
  res.render('movement', {active: 'movement', flaga: settings.movement.low_flag, flagb: settings.movement.high_flag, min_amount:settings.movement.min_amount});
});

router.get('/network', function(req, res) {
  res.render('network', {active: 'network'});
});

router.get('/dashboard', function(req, res) {
  res.render('dashboard', {active: 'dashboard'});
});

router.get('/reward', function(req, res){
  //db.get_stats(settings.coin, function (stats) {
    db.get_heavy(settings.coin, function (heavy) {
      //heavy = heavy;
      var votes = heavy.votes;
      votes.sort(function (a,b) {
        if (a.count < b.count) {
          return -1;
        } else if (a.count > b.count) {
          return 1;
        } else {
         return 0;
        }
      });

      res.render('reward', { active: 'reward', stats: stats, heavy: heavy, votes: heavy.votes });
    });
  //});
});

router.get('/tx/:txid', function(req, res) {
  route_get_tx(res, req.params['txid']);
});

router.get('/block/:hash', function(req, res) {
  route_get_block(res, req.params['hash']);
});

router.get('/address/:hash', function(req, res) {
  route_get_address(res, req.params['hash'], settings.txcount);
});

router.get('/address/:hash/:count', function(req, res) {
  route_get_address(res, req.params['hash'], req.params['count']);
});

router.post('/search', function(req, res) {
  var query = req.body.search;
  if (query.length == 64) {
    if (query == settings.genesis_tx) {
      res.redirect('/block/' + settings.genesis_block);
    } else {
      db.get_tx(query, function(tx) {
        if (tx) {
          res.redirect('/tx/' +tx.txid);
        } else {
          lib.get_block(query, function(block) {
            if (block != 'There was an error. Check your console.') {
              res.redirect('/block/' + query);
            } else {
              route_get_index(res, locale.ex_search_error + query );
            }
          });
        }
      });
    }
  } else {
    db.get_address(query, function(address) {
      if (address) {
        res.redirect('/address/' + address.a_id);
      } else {
        lib.get_blockhash(query, function(hash) {
          if (hash != 'There was an error. Check your console.') {
            res.redirect('/block/' + hash);
          } else {
            route_get_index(res, locale.ex_search_error + query );
          }
        });
      }
    });
  }
});

router.get('/qr/:string', function(req, res) {
  if (req.params['string']) {
    var address = qr.image(req.params['string'], {
      type: 'png',
      size: 4,
      margin: 1,
      ec_level: 'M'
    });
    res.type('png');
    address.pipe(res);
  }
});

router.get('/ext/summary', function(req, res) {
  lib.get_difficulty(function(difficulty) {
    difficultyHybrid = ''
    if (difficulty['proof-of-work']) {
            if (settings.index.difficulty == 'Hybrid') {
              difficultyHybrid = 'POS: ' + difficulty['proof-of-stake'];
              difficulty = 'POW: ' + difficulty['proof-of-work'];
            } else if (settings.index.difficulty == 'POW') {
              difficulty = difficulty['proof-of-work'];
            } else {
        difficulty = difficulty['proof-of-stake'];
      }
    }
    lib.get_hashrate(function(hashrate) {
      lib.get_connectioncount(function(connections){
        lib.get_blockcount(function(blockcount) {
          db.get_stats(settings.coin, function (stats) {
            lib.get_gettermdepositstats(function(termdepositstats){
              lib.get_officialpoolinfo(function(officialpoolinfo){
               db.get_income(settings.coin, function(income) {
                if (hashrate == 'There was an error. Check your console.') {
                  hashrate = 0;
                }
                res.send({ data: [{
                  difficulty: difficulty,
                  difficultyHybrid: difficultyHybrid,
                  supply: stats.supply,
                  hashrate: hashrate,
                  known_hashrate: stats.known_hashrate,
                  lastPrice: stats.last_price,
                  connections: connections,
                  blockcount: blockcount,
                  explorerHeight: stats.last,
                  explorerAddress: stats.address,
                  explorerActiveAddress: stats.active_address,
                  explorerTop10: stats.top10,
                  explorerTop50: stats.top50,
                  burnFee: stats.fee_burn,
                  burnNode: stats.node_burn,
                  poolHeight: officialpoolinfo.height,
                  tx_d0_count: stats.tx_d0_count,
                  tx_d0_value: stats.tx_d0_value,
                  tx_d1_count: stats.tx_d1_count,
                  tx_d1_value: stats.tx_d1_value,
                  tx_d2_count: stats.tx_d2_count,
                  tx_d2_value: stats.tx_d2_value,
                  tx_d3_count: stats.tx_d3_count,
                  tx_d3_value: stats.tx_d3_value,
                  tx_d4_count: stats.tx_d4_count,
                  tx_d4_value: stats.tx_d4_value,
                  tx_d5_count: stats.tx_d5_count,
                  tx_d5_value: stats.tx_d5_value,
                  tx_d6_count: stats.tx_d6_count,
                  tx_d6_value: stats.tx_d6_value,
                  inf_exp: stats.inf_exp,
                  inf_exp_1d: stats.inf_exp_1d,
                  inf_exp_7d: stats.inf_exp_7d,
                  inf_exp_14d: stats.inf_exp_14d,
                  inf_exp_30d: stats.inf_exp_30d,
                  inf_exp_60d: stats.inf_exp_60d,
                  inf_exp_90d: stats.inf_exp_90d,
                  inf_exp_120d: stats.inf_exp_120d,
                  inf_exp_150d: stats.inf_exp_150d,
                  inf_exp_180d: stats.inf_exp_180d,
                  inf_exp_270d: stats.inf_exp_270d,
                  inf_exp_365d: stats.inf_exp_365d,
                  inf_burnt_big: stats.inf_burnt_big,
                  inf_burnt_mid: stats.inf_burnt_mid,
                  inf_burnt_lil: stats.inf_burnt_lil,
                  inf_online_big: stats.inf_online_big,
                  inf_online_mid: stats.inf_online_mid,
                  inf_online_lil: stats.inf_online_lil,
                  in_burnt_big: income.in_burnt_big,
                  in_burnt_mid: income.in_burnt_mid,
                  in_burnt_lil: income.in_burnt_lil,
                  in_burnt_address: income.in_burnt_address,
                  in_burnt_tx: income.in_burnt_tx,
                  payout_miner: income.payout_miner,
                  payout_node_big: income.payout_node_big,
                  payout_node_mid: income.payout_node_mid,
                  payout_node_lil: income.payout_node_lil,
                  hco_3m: stats.hco_3m,
                  hco_6m: stats.hco_6m,
                  hco_12m: stats.hco_12m,
                }]});
               });
              });
            });
          });
        });
      });
    });
  });
});
router.get('/pool-stats', function(req, res) {
  res.render('poolstats', {});
});

router.get('/infinitynodes', function(req, res) {
  const moment = require('moment');
  res.render('infinitynodes', {moment: moment});
});

router.get('/hco', function(req, res) {
  res.render('hco', {});
});
module.exports = router;
