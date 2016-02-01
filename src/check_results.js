'use strict'

// non matches, facepalm
/*[["t3_40utrn","t3_3zw6xw"],
["t3_40uhnk","t3_40kyy1"],
["t3_40ucjs","t3_3yf921"],
["t3_40pzln","t3_3yuubl"],
["t3_414vax","t3_3zyf0e"],
["t3_411uh3","t3_3yqutf"],
["t3_411q3p","t3_3y51jb"]]*/

/*
[["t3_3zl0v","t3_3z52pt"],
["t3_3zhwo","t3_3ysxk1"],
["t3_3zc5f","t3_3yqutf"],
["t3_3zxjy","t3_3ziqjd"],
["t3_3zxet","t3_3zvu4z"],
["t3_3znvg","t3_3zb1uc"],
["t3_40b0y","t3_3z49iz"],
["t3_40af0","t3_3z3xb5"],
["t3_40a11","t3_3znes3"],
["t3_406h9","t3_3z3xb5"],
["t3_4057m","t3_3z6i2r"],
["t3_403nd","t3_3yif7h"],
["t3_400wv","t3_3ze3g9"],
["t3_40j3i2","t3_40fzid"],
["t3_40encg","t3_3z7a8b"],
["t3_40d3ly","t3_403ndx"],
["t3_40c9bj","t3_3yh3lc"],
["t3_40p9j0","t3_3zrgiy"],
["t3_40m345","t3_3z2syk"],
["t3_40ll62","t3_40c9bj"],
["t3_40l30t","t3_4057ma"],
["t3_40kyy1","t3_40fzid"]]
*/

// matches, testbed
/*[["t3_42wfj8","t3_42wfb3"],
["t3_428r2i","t3_427hgq"],
["t3_427dzl","t3_427djp"],
["t3_427dor","t3_427djp"],
["t3_427dd5","t3_427d5f"],
["t3_427dav","t3_427d5f"],
["t3_427d83","t3_427d5f"]]*/


var Promise = require("bluebird");
var login = require('./settings.json');
var jawfr = require('jawfr')();
var cv = require('opencv');
var request = require("request");
var fs = require("fs");
var matches = require("./matches.json");

var readImageAsync = Promise.promisify(cv.readImage);
var detectAndComputeAsync = Promise.promisify(cv.DetectAndCompute);
var filteredMatchAsync = Promise.promisify(cv.FilteredMatch, {multiArgs: true});
var similarityAsync = Promise.promisify(cv.ImageSimilarity, {multiArgs: true});
var maskTextAsync = Promise.promisify(cv.MaskText);

// connect to all
jawfr.connect(login.ua, login.client, login.secret, login.user, login.pw).bind({})
.then(function() {
	this.fp = jawfr.getSubreddit('facepalm');

	this.names = [];

	for(let arr of matches) {
		this.names.push(arr[0]);
		this.names.push(arr[1]);
	}
	uniq(this.names);
	console.log(this.names.length);

	return jawfr.getLinks(this.names);
}).then(function(links) {
	return Promise.map(links, function(link){

		if(!link.preview) {
			console.log(link);
			return {nopreview:true};
		}

	  	var stream = request(link.preview.images[0].source.url).pipe(fs.createWriteStream("./" + link.name + ".jpg"));
	 	return new Promise(function(resolve,reject){
	    	stream.on("finish", function(){
	         	resolve();
		    });	
		}).bind({link:link})
		.then(function(){
			return readImageAsync("./" + this.link.name + ".jpg");
		}).then(function(image){
			return Promise.props({
				i2: maskTextAsync(image)
			});
		}).then(function(masked){
			masked.i2.save("./" + this.link.name + "_masked.jpg");
		});
	}, {concurrency: 5});
				
}).then(function(){

	return Promise.each(matches, function(match) {

		return readImageAsync("./" + match[0] + "_masked.jpg").bind({match:match})
		.then(function(i1){
			this.i1 = i1;
			return readImageAsync("./" + this.match[1] + "_masked.jpg");
		}).then(function(i2){
			this.i2 = i2;

			return similarityAsync(this.i1,this.i2);

		}).then(function(res){
			
			let d_good = res[1];
			let n_good = res[2];
			let d_h = res[3];
			let n_h = res[4];
			let c = res[5];

			console.log(this.match, res.slice(1), (d_h < 30 && n_h > 12), (d_h < 20 && n_h > 6), (d_h < 12 && n_h > 3), c > 0.0000001,"|", ((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 6) || (d_h < 12 && n_h > 3)) && c>0.0000001);
			res[0].save("./" + this.match[0] + "_" + this.match[1] + ".jpg");
			return similarityAsync(this.i2,this.i1);
		}).then(function(res){
			let d_good = res[1];
			let n_good = res[2];
			let d_h = res[3];
			let n_h = res[4];
			let c = res[5];

			var rev = this.match.reverse();

			res[0].save("./" + rev[0] + "_" + rev[1] + ".jpg");

			console.log(rev, res.slice(1), (d_h < 30 && n_h > 12), (d_h < 20 && n_h > 6), (d_h < 12 && n_h > 3), c > 0.0000001, "|", ((d_h < 30 && n_h > 12) || (d_h < 20 && n_h > 6) || (d_h < 12 && n_h > 3)) && c>0.0000001);
		});
	}, {concurrency: 10})

}).catch(function(err){
		console.log(err);
});


function uniq(a) {
    return a.sort().filter(function(item, pos, ary) {
        return !pos || item != ary[pos - 1];
    })
}
