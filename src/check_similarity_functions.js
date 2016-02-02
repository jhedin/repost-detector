'use strict'

//t3_3x1uqq is the earliest I can get a hold of

var Promise = require("bluebird");
var login = require('./settings.json');
var jawfr = require('jawfr')();
var cv = require('opencv');
var request = require("request");
var fs = require("fs");
var matches = require("./matches.json");

var mongodb = require('mongodb');

var MongoClient = mongodb.MongoClient;
var Collection = mongodb.Collection;

Promise.promisifyAll(Collection.prototype);
Promise.promisifyAll(MongoClient);
Promise.promisifyAll(mongodb.Cursor.prototype);


var readImageAsync = Promise.promisify(cv.readImage);
var detectAndComputeAsync = Promise.promisify(cv.DetectAndCompute);
var filteredMatchAsync = Promise.promisify(cv.FilteredMatch, {multiArgs: true});
var similarityAsync = Promise.promisify(cv.ImageSimilarity, {multiArgs: true});
var maskTextAsync = Promise.promisify(cv.MaskText);

var url = 'mongodb://localhost:27017/sim_test';

// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	return MongoClient.connectAsync(url)
}).catch(function (err) {
	console.log("could not login");
	console.log(err);
})
.then(function (db) {
	this.fp = jawfr.getSubreddit('facepalmtestbed');
	this.info = db.collection("info");
	this.dblinks = db.collection("links");

	this.names = [];

	for(let arr of matches) {
		this.names.push(arr[0]);
		this.names.push(arr[1]);
	}
	this.names = uniq(this.names);

	return jawfr.getLinks(this.names);

// downloader and masker
}).then(function(links) {
	console.log(links.length);
	return Promise.map(links, function(link){

		if(!link.preview) {
			console.log(link);
			return {nopreview:true};
		}
		// choose a reasonably sized image
		var loc = link.preview.images[0].source.url;

		if(link.preview.images[0].source.width * link.preview.images[0].source.height > 2000000 )
			loc = link.preview.images[0].resolutions[link.preview.images[0].resolutions.length - 1].url;

	  	var stream = request(loc).pipe(fs.createWriteStream("./" + link.name + ".jpg"));
	 	return new Promise(function(resolve,reject){
	    	stream.on("finish", function(){
	         	resolve();
		    });	
		}).bind({link:link})
		.then(function(){
			return readImageAsync("./" + this.link.name + ".jpg");
		}).then(function(image){
			return maskTextAsync(image);
		}).then(function(masked){
			masked.save("./" + this.link.name + "_masked.jpg");
			return {name: this.link.name, image:masked};
		});
	}, {concurrency: 5});

// start comparing			
}).then(function(images){
	this.table = {};
	for(var item of images) {
		this.table[item.name] = item.image;
	}
	return matches;
}).each(function(match) {

	// load both images

	if(!(this.table[match[0]] && this.table[match[1]])) {
		console.log("missing post");
		return {nopreview:true};
	}

	readImageAsync("./" + match[0] + "_masked.jpg").bind({match: match, dblinks: this.dblinks, table:this.table})
	.then(function(mi1){
		this.mi1 = mi1;
		return readImageAsync("./" + this.match[1] + "_masked.jpg");
	}).then(function(mi2){
		this.mi2 = mi2;
		return readImageAsync("./" + this.match[0] + ".jpg");
	}).then(function(i1){
		this.i1 = i1;
		return readImageAsync("./" + this.match[1] + ".jpg");
	}).then(function(i2){
		this.i2 = i2;

		return Promise.props({
			single: similarityAsync(this.i1,this.i2),
			msingle: similarityAsync(this.mi1,this.mi2),
			hsingle: similarityAsync(this.i1,this.mi2),
			tsingle: similarityAsync(this.table[match[0]],this.table[match[1]]),
			multipart: Promise.map([this.mi1, this.mi2], function(image) { 
				return detectAndComputeAsync(image);
			}).bind(this)
			.then(function(featureslist){
				// endcode / decode here

				featureslist[0].descriptors = saveMatrix(featureslist[0].descriptors);
				featureslist[1].descriptors = saveMatrix(featureslist[1].descriptors);
				
				return this.dblinks.insertManyAsync([{
					name: match[0],
					features: featureslist[0]
				},{
					name: match[1],
					features: featureslist[1]
				}]);

			}).then(function(){
				return this.match;
			}).map(function(name){
				return this.dblinks.findOne({name:name});
			}).then(function(docs){

				var dbfeatureslist = docs.map(function(doc) {
					doc.features.descriptors = parseMatrix(doc.features.descriptors);
					return doc.features;
				});

				return filteredMatchAsync(dbfeatureslist[0], dbfeatureslist[1]);
			}).catch(function(err){
				console.log("err: " + err);
			})
		});

	}).then(function(res){
		console.log(this.match);
		console.log(res.single.slice(1));
		res.single[0].save("./" + this.match[0] + "_" + this.match[1] + ".jpg");
		console.log(res.msingle.slice(1));
		res.msingle[0].save("./" + this.match[0] + "_" + this.match[1] + "_masked.jpg");
		console.log(res.hsingle.slice(1));
		res.hsingle[0].save("./" + this.match[0] + "_" + this.match[1] + "_half.jpg");
		console.log(res.tsingle.slice(1));
		res.tsingle[0].save("./" + this.match[0] + "_" + this.match[1] + "_table.jpg");
		console.log(res.multipart);
	}).catch(function(err){
		console.log(err)
	})

}).delay(2000).then(function(){
	this.dblinks.remove({});
}).catch(function(err){
	console.log(err)
});


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
function uniq(a) {
    return a.sort().filter(function(item, pos, ary) {
        return !pos || item != ary[pos - 1];
    })
}
