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

var url = 'mongodb://localhost:27017/facepalmtestbed';


// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	return MongoClient.connectAsync(url)
}).catch(function(err){
	console.log("could not login");
	console.log(err);
})
.then(function(db) {
	this.fp = jawfr.getSubreddit('facepalmtestbed');
	this.info = db.collection("info");
	this.dblinks = db.collection("links");
	
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

			  	var stream = request(link.preview.images[0].source.url).pipe(fs.createWriteStream("./" + link.name + ".jpg"));
			 	return new Promise(function(resolve,reject){
			    	stream.on("finish", function(){
			         	resolve();
				    });
				
				}).then(function(){
					return readImageAsync("./" + link.name + ".jpg");

				}).then(function(image){
					return maskTextAsync(image);
				
				}).then(function(image){
					// clean up the download
					fs.unlinkSync("./" + link.name + ".jpg");
					//image.save("./" + link.name + "_masked.jpg");

					return Promise.props({
						features: detectAndComputeAsync(image),
						name: link.name,
						user: link.author,
						created_utc: link.created_utc,
						repost: []
					});
				});
			}, {concurrency: 5})

		}).then(function(docs) {
			
			this.docs = docs.filter(function(doc){
				if(doc.nopreview || doc.features.keypoints.length == 0) 
					return false;
				return true;
			})
			this.docs = this.docs.map(function(doc) {
				doc.features.descriptors = saveMatrix(doc.features.descriptors);
				return doc;
			});

			console.log(this.docs.length + " new links");
			
			return this.dblinks.insertManyAsync(this.docs)
		}).then(function() {
			var cursor = this.dblinks.find({});
			return cursor.toArrayAsync();

		}).then(function(savedLinks){

			this.docs = this.docs.map(function(item){
				item.features.descriptors = parseMatrix(item.features.descriptors)
				return item;
			});

			savedLinks = savedLinks.map(function(item){
				item.features.descriptors = parseMatrix(item.features.descriptors)
				return item;
			});
			
			return Promise.each(this.docs, function(nlink){
				
				return Promise.each(savedLinks, function(slink) {
					
			    		if(nlink.name == slink.name)
							return;

						if(nlink.created_utc < slink.created_utc)
							return;

						return Promise.props({
							nfirst: filteredMatchAsync(nlink.features, slink.features),
							sfirst: filteredMatchAsync(slink.features, nlink.features)
						})
						.then(function(res){

							var d_good = res.nfirst[0];
							var n_good = res.nfirst[1];
							var d_h = res.nfirst[2];
							var n_h = res.nfirst[3];
							if((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 5)) {
								d_good = res.sfirst[0];
								n_good = res.sfirst[1];
								d_h = res.sfirst[2];
								n_h = res.sfirst[3];
								if((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 5)) {
									console.log(nlink.name, slink.name, res)
									nlink.repost.push({
										name: slink.name, 
										d_good: d_good,
										n_good: n_good, 
										d_h:d_h, 
										n_h: n_h
									});
								}
							}
						}).catch(function(err){reject(err)});
					
				}, {concurrency: 30});

			},{concurency: 5});

		}).then(function(testedLinks) {
			
			var filteredLinks = testedLinks.filter(function(tlink){
				return tlink.repost.length > 0
			});
			console.log("found " + filteredLinks.length + " reposts");
			
			/*for(var l of filteredLinks){
				console.log({name: l.name, repost: l.repost})
			}*/

			// now we can report/comment

			this.info.update({"typ":"info"}, {$set:{"before": this.links[0].name}});

			return Promise.each(filteredLinks, function(link) {
				console.log(link.name + "=>" + link.repost[0].name);
				let l = jawfr.asLink(link);
				return l.report("repost /r/facepalm/comments/" + l.repost[0].name.slice(3));
			});
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


function parseMatrix(ser) {
	var mat = new cv.Matrix(ser.height, ser.width, cv.Constants.CV_8UC1);
	mat.put(new Buffer(ser.buffer, 'base64'));
	return mat;
}

function saveMatrix(mat) {
	var ser = {};
	ser.height = mat.height();
	ser.width = mat.width();
	// mongo doesn't understand typed arrays and such
	ser.buffer = mat.getData().toString('base64');
	return ser;
}