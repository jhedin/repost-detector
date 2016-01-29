var Promise = require("bluebird");
var cv = require("opencv");
var request = require("request");
var fs = require("fs");

var readImageAsync = Promise.promisify(cv.readImage);
var dissimilarityAsync = Promise.promisify(cv.ImageSimilarity);

var urls = [
  {
    url: "http://i.imgur.com/QxDki0v.png",
    name: "./image1.png" 
  },
  {
    url: "https://i.imgur.com/vAjKDkb.jpg",
    name: "./image2.jpg"
  }
];

Promise.map(urls, function(url) {
  var stream = request(url.url).pipe(fs.createWriteStream(url.name));
  return new Promise(function(resolve,reject){
    stream.on("finish", function(){
         resolve();
    });
  });
}).then(function(){

  return Promise.props({
    image1: readImageAsync('./image1.png'),
    image2: readImageAsync('./image2.jpg')
  });
})
.then(function(result){

    return dissimilarityAsync(result.image1, result.image2);
})
.then(function(result){
  console.log('Dissimilarity: ', result);
});
