'use strict'

var Promise = require("bluebird");
var login = require('./settings.json');
var jawfr = require('jawfr')();
var cv = require('opencv');
var request = require("request");
var fs = require("fs");

var mongodb = require('mongodb');

var MongoClient = mongodb.MongoClient;
var Collection = mongodb.Collection;

Promise.promisifyAll(Collection.prototype);
Promise.promisifyAll(MongoClient);
Promise.promisifyAll(mongodb.Cursor.prototype);


var readImageAsync = Promise.promisify(cv.readImage);
var detectAndComputeAsync = Promise.promisify(cv.DetectAndCompute);
var filteredMatchAsync = Promise.promisify(cv.FilteredMatch, {multiArgs: true});
var maskTextAsync = Promise.promisify(cv.MaskText);

var url = 'mongodb://localhost:27017/facepalmImages';

// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	return MongoClient.connectAsync(url)
}).catch(function(err){
	console.log("could not login");
	console.log(err);
})
.then(function(db) {
	this.fp = jawfr.getSubreddit('cringepics');
	this.info = db.collection("info");
	this.dblinks = db.collection("links");
	//this.info.remove({});
	//this.info.insert({"typ":"info", "before": "t3_3pkcxl"});

	// get a list of new links to analyse
	var loop = function loop () {
		
		this.info.findOneAsync({"typ":"info"}).bind(this)
		.then(function(doc){
			console.log("looking before " + doc.before);
			return this.fp.getLinks({before: doc.before});

		}).then(function(links){

			if(links.length == 0) {
				this.links = [];
				throw "no new links";
			}
			
			this.links = links;

			// process the links' preview images
			return Promise.map(links, function(link){

				// reddit couldnt make a preview
				if(!link.preview) return {nopreview:true};

			  	var stream = request(link.preview.images[0].source.url).pipe(fs.createWriteStream("./images/cgp_" + link.name + ".jpg"));
			 	return new Promise(function(resolve,reject){
			    	stream.on("finish", function(){
			         	resolve();
				    });
				}).delay(1000);
			}, {concurrency: 1})

		}).then(function() {
			this.info.update({"typ":"info"}, {$set:{"before": this.links[0].name}});
			console.log("downloaded the set");
		}).catch(function(err) {
			console.log(err);
		}).then(function(){
			
			if(this.links.length > 40) {
				setTimeout(loop.bind(this), 100);
			} else {
				setTimeout(loop.bind(this), 60000);
			}
		});

	}.bind(this)();
}).catch(function(err) {
	console.log("uncaught error");
	console.log(err);
})