var mongodb = require('mongodb');
var Promise = require("bluebird");

var MongoClient = mongodb.MongoClient;
var Collection = mongodb.Collection;
var ObjectId = mongodb.ObjectID;

Promise.promisifyAll(Collection.prototype);
Promise.promisifyAll(MongoClient);
Promise.promisifyAll(mongodb.Cursor.prototype);

var duplicates = [];

var url = 'mongodb://localhost:27017/facepalmtestbed';

MongoClient.connectAsync(url).then(function(db) {

  var fp =db.collection("links");

  fp.aggregate([
    { $match: { 
      name: { "$ne": '' }  // discard selection criteria
    }},
    { $group: { 
      _id: { name: "$name"}, // can be grouped on multiple properties 
      dups: { "$addToSet": "$_id" }, 
      count: { "$sum": 1 } 
    }}, 
    { $match: { 
      count: { "$gt": 1 }    // Duplicates considered as count greater than one
    }}
  ])               // You can display result until this and check duplicates          
  .forEach(function(doc) {
      console.log(doc);
      doc.dups.shift();      // First element skipped for deleting
      doc.dups.forEach( function(dupId){ 
          fp.remove({"_id" : ObjectId(dupId)});
          }
      )    
  })
});