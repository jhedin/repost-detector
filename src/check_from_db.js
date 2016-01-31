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
var maskTextAsync = Promise.promisify(cv.MaskText);

var url = 'mongodb://localhost:27017/facepalm';

// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	return MongoClient.connectAsync(url)
}).catch(function (err) {
	console.log("could not login");
	console.log(err);
})
.then(function (db) {
	this.fp = jawfr.getSubreddit('facepalm');
	this.info = db.collection("info");
	this.dblinks = db.collection("links");

	return matches;
}).each(function(match) {

	this.dblinks.findOneAsync({"name": match[0]}).bind({match:match, dblinks:this.dblinks}).then(function (l1) {
		this.l1 = l1;
		return this.dblinks.findOne({"name": this.match[1]});
	}).then(function (l2){

		this.l2 = l2;

		this.l1.features.descriptors = parseMatrix(this.l1.features.descriptors);
		this.l2.features.descriptors = parseMatrix(this.l2.features.descriptors);

		return filteredMatchAsync(this.l1.features, this.l2.features);
					
	}).then(function(res){
		let d_good = res[0];
		let n_good = res[1];
		let d_h = res[2];
		let n_h = res[3];
		let c = res[4];

		console.log(this.match, res, (d_h < 30 && n_h > 12), (d_h < 20 && n_h > 6), (d_h < 12 && n_h > 3), c > 0.0000001,"|", ((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 6) || (d_h < 12 && n_h > 3)) && c > 0.0000001);

		return filteredMatchAsync(this.l2.features, this.l1.features);
					

	}).then(function(res){
		let d_good = res[0];
		let n_good = res[1];
		let d_h = res[2];
		let n_h = res[3];
		let c = res[4];

		var rev = this.match.reverse();

		console.log(this.match, res, (d_h < 30 && n_h > 12), (d_h < 20 && n_h > 6), (d_h < 12 && n_h > 3), c > 0.0000001,"|", ((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 6) || (d_h < 12 && n_h > 3)) && c > 0.0000001);
	})
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