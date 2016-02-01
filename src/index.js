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

var url = 'mongodb://localhost:27017/facepalm';

// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	return MongoClient.connectAsync(url)
}).catch(function(err){
	console.log("could not login");
	console.log(err);
})
.then(function(db) {
	this.fp = jawfr.getSubreddit('facepalm');
	this.info = db.collection("info");
	this.dblinks = db.collection("links");
	
	// get a list of new links to analyse
	var loop = function loop () {
		
		this.info.findOneAsync({"typ":"info"}).bind(this)
		.then(function(doc){
			console.log("looking before " + doc.before);
			return this.fp.getLinks({before: doc.before});

		}).then(function(links){

			for(var i = 0; i < links.length; i++){
				if(links[i].preview) {
					links.slice(i);
					break;
				}
			}

			if(links.length == 0) {
				this.links = [];
				throw "no new links";
			}
			
			this.links = links;

			// process the links' preview images
			return Promise.map(links, function(link){

				// reddit couldnt make a preview
				if(!link.preview) return {nopreview:true};

				// choose a reasonably sized image
				var loc = link.preview.images[0].source.url;

				if(link.preview.images[0].source.width * link.preview.images[0].source.height > 2000000 )
					loc = link.preview.images[0].resolutions[link.preview.images[0].resolutions.length - 1].url;

			  	var stream = request(loc).pipe(fs.createWriteStream("./" + link.name + ".jpg"));
			 	return new Promise(function(resolve,reject){
			    	stream.on("finish", function(){
			         	resolve();
				    });
				    stream.on('error', function(e){reject(e)});
				
				}).bind({}).then(function(){
					return readImageAsync("./" + link.name + ".jpg");

				// saving the masked image has an effect on the feature finder (probably due to some compresion?) 
				// so, for ease of checking, use the saved/opened version, rather than the immediately computed one
				}).then(function(image){
					this.image = image;
					return maskTextAsync(image);
				}).then(function(masked){
					masked.save("./" + link.name + "_masked.jpg");
				}).then(function(){
					return readImageAsync("./" + link.name + "_masked.jpg");
				}).then(function(maskedSaved){
					// clean up the download
					fs.unlinkSync("./" + link.name + ".jpg");
					fs.unlinkSync("./" + link.name + "_masked.jpg");

					return Promise.props({
						features: detectAndComputeAsync(maskedSaved),
						features_text: detectAndComputeAsync(this.image),
						name: link.name,
						author: link.author,
						created_utc: link.created_utc,
						repost: []
					});
				}).catch(function(e){
					return {name:link.name, user: link.user, created_utc:link.created_utc, error:e};
				});
			}, {concurrency: 8})

		}).then(function(docs) {
			
			// reddit can't analyse every post to fiind an image; if there's no preview,
			// we cant check if its a repost
			// todo: try to find an image for no preview situations
			// removed posts also have no previews
			this.docs = docs.filter(function(doc){
				if(doc.nopreview || doc.features.keypoints.length == 0) 
					return false;
				return true;
			})
			this.docs = this.docs.map(function(doc) {
				doc.features.descriptors = saveMatrix(doc.features.descriptors);
				doc.features_text.descriptors = saveMatrix(doc.features_text.descriptors);
				return doc;
			});

			console.log(this.docs.length + " new links");
			
			return this.dblinks.insertManyAsync(this.docs)

			// done preprocessing/saving, now compare the new links against everything we've seen before
		}).then(function() {
			var cursor = this.dblinks.find({});
			return cursor.toArrayAsync();

		}).then(function(savedLinks){

			// turns the saved matrix data into something opencv can read
			this.docs = this.docs.map(function(item){
				item.features.descriptors = parseMatrix(item.features.descriptors);
				item.features_text.descriptors = parseMatrix(item.features_text.descriptors);
				return item;
			});
			savedLinks = savedLinks.map(function(item){
				item.features.descriptors = parseMatrix(item.features.descriptors)
				item.features_text.descriptors = parseMatrix(item.features_text.descriptors);
				return item;
			});
			
			return Promise.each(this.docs, function(nlink){
				
				return Promise.each(savedLinks, function(slink) {
						
						// this is the same link, or we don't know which would be the repost
						// also, if there's too much size difference, ORB wont run
			    		if(nlink.name == slink.name)
							return;
						if(nlink.created_utc < slink.created_utc)
							return;
						if(nlink.features.descriptors.width() != slink.features.descriptors.width() || nlink.features_text.descriptors.width() != slink.features_text.descriptors.width())
							return;

						// this is an inefficient way of checking the condition of the homography matrix
						return Promise.props({
							nfirst: filteredMatchAsync(nlink.features, slink.features),
							//sfirst: filteredMatchAsync(slink.features, nlink.features),
							nfirst_text: filteredMatchAsync(nlink.features_text, slink.features_text)
							//sfirst_text: filteredMatchAsync(slink.features_text, nlink.features_text)
						})
						.then(function(res){

							var nd_h = res.nfirst[2];
							var nn_h = res.nfirst[3];
							var nc = res.nfirst[4];
							//var sd_h = res.sfirst[2];
							//var sn_h = res.sfirst[3];
							//var sc = res.sfirst[4];
							if(((nd_h < 35 && nn_h > 12) || (nd_h < 20 && nn_h > 6) || (nd_h < 12 && nn_h > 3)) && nc > 0.000001) {	
								//if(((sd_h < 35 && sn_h > 12) || (sd_h < 20 && sn_h > 6) || (sd_h < 12 && sn_h > 3)) && sc > 0.0000001) {
									nlink.repost.push({
										name: slink.name, 
										res: res
									});
								//}
							} else {
								nd_h = res.nfirst_text[2];
								nn_h = res.nfirst_text[3];
								nc = res.nfirst_text[4];
								//sd_h = res.sfirst_text[2];
								//sn_h = res.sfirst_text[3];
								//sc = res.sfirst_text[4];
								if(((nd_h < 45 && nn_h > 20) ||(nd_h < 35 && nn_h > 12) || (nd_h < 20 && nn_h > 6)) && nc > 0.000001) {	
									//if(((sd_h < 35 && sn_h > 12) || (sd_h < 20 && sn_h > 6) || (sd_h < 12 && sn_h > 3)) && sc > 0.0000001) {
										nlink.repost.push({
											name: slink.name, 
											res: res,
											text: true
										});
									//}
								}
							}
						}).catch(function(err){console.log("error while matching",err)});
					
				}, {concurrency: 30});

			},{concurency: 8});

		}).then(function(testedLinks) {
			
			var filteredLinks = testedLinks.filter(function(tlink){
				return tlink.repost.length > 0
			});
			console.log("found " + filteredLinks.length + " reposts");

			return filteredLinks;

		}).each(function(link) {
			console.log(link.name + "=>" + link.repost[0].name);
			this.dblinks.update({"name": link.name}, {$set:{"repost": link.repost}});
			let l = jawfr.asLink(link);
			l.report("probably a repost, check my comment for a link");
			return l.reply("my bot thinks this is a repost of /r/facepalm/comments/" + link.repost[0].name.slice(3) + " with " + link.repost[0].res.nfirst.toString() + ", " + link.repost[0].res.nfirst_text.toString()  + " there are " + (link.repost.length - 1) + " other posts it might match");
		}).catch(function(err) {
			console.log(err);
		}).then(function(){

			// we're all done with this set of links; start on the next set
			if(this.links && this.links.length>0)
				this.info.update({"typ":"info"}, {$set:{"before": this.links[0].name}});
			
			if(this.links.length > 40) {
				setTimeout(loop.bind(this), 1);
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