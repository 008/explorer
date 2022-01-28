var mongoose = require('mongoose')
  , lib = require('../lib/explorer')
  , db = require('../lib/database')
  , Tx = require('../models/tx')
  , Inf = require('../models/infnodes')
  , settings = require('../lib/settings')
  , request = require('request');

mongoose.set('useCreateIndex', true);

var COUNT = 5000; //number of blocks to index

function exit() {
  mongoose.disconnect();
  process.exit(0);
}

var dbString = 'mongodb://' + settings.dbsettings.user;
dbString = dbString + ':' + settings.dbsettings.password;
dbString = dbString + '@' + settings.dbsettings.address;
dbString = dbString + ':' + settings.dbsettings.port;
dbString = dbString + '/' + settings.dbsettings.database;

mongoose.connect(dbString,{ useNewUrlParser: true, useUnifiedTopology: true }, function(err) {
  if (err) {
    console.log('Unable to connect to database: %s', dbString);
    console.log('Aborting');
    exit();
  } else {
    lib.get_infinitynode(function(infnodes){
      const keys = Object.keys(infnodes);
      lib.syncLoop(keys.length, function (loop) {
        var i = loop.iteration();
        var burntx = keys[i];
        console.log(burntx + ": " + JSON.stringify(infnodes[keys[i]]));
        loop.next();
      }, function() {
        exit();
      });//end loop
    });
  }// end else
});
