var express = require("express");
var http = require("http");
var faye = require("faye");
var Promise = require("bluebird");
var fs = require("fs");
var globAsync = Promise.promisify(require("glob"));
var rimrafAsync = Promise.promisify(require("rimraf"));
var multer = require("multer");
var cp = require("child_process");
var path = require("path");
var bodyParser = require("body-parser");
var _ = require("lodash");

Promise.promisifyAll(fs);
Promise.promisifyAll(cp);

var app = express();
var server = http.createServer(app);
var bayeux = new faye.NodeAdapter({mount: "/pubsub"});
bayeux.attach(server);

var pubsub = bayeux.getClient();

var router = express.Router();
app.use(express.static("public"));
app.use("/images/:id", bodyParser());
app.use("/images/:id", function(req,res,next){
	if (req.query.download === "true") {
		return imgExtById(req.params.id)
		.then(function(ext){
			res.set("content-disposition", "attachment; filename=" + req.params.id + ext);
			return next();
		})
		.done();
	} else {
		return next();
	}
});
app.use("/images", multer({dest: "./images/uploads"}));
app.use("/images", express.static("images"));

app.get("/images", function(req, res) {
	globAsync("images/image-*/image.*")
	.map(imgByPath)
	.then(function(files){
		res.type("json");
		res.json(files);
	})
	.done();
});

app.delete("/images/:id", function(req, res){
	if (/^image-[a-z0-9-]+$/i.test(req.params.id)) {
		rimrafAsync("images/" + req.params.id)
		.then(function(){
			pubsub.publish("/images/delete", {id: req.params.id});
			res.json(204);
		})
		.done();
	} else {
		res.send(400, "Invalid image id given");
	}
});

app.post("/images", function(req, res){
	addImage(req.files.file.path).done();
	res.send(202);
});

/* IMAGE DISPLAY CODE */

var activeImage = null;
var activeProcess = null;
app.put("/images/:id", function(req,res){
	if (req.body.active === true) {
		setActive(req.body.id)
		.then(function(){
			res.json(204);
		})
		.done();
	} else {
		res.send(400, "Unsupported operation");
	}
});
function clearTTY(){
	return new Promise(function(resolve, reject){
		var child = cp.spawn("clear", {stdio:"inherit"});

		child.on("exit", resolve);
	});
}
function paintPicture(filename) {
	if (activeProcess) activeProcess.kill();
	return clearTTY()
	.then(function(){
		activeProcess = cp.spawn("fbv", ["-k", "-a", "-i", "-e", filename], {stdio: "ignore"});
	});
}
function setActive(id) {
	if (activeImage && activeImage.id === id) return Promise.resolve();

	var img = imgById(id);
	return img.then(function(img){

		if (activeImage) {
			activeImage.active = false;
			pubsub.publish("/images", activeImage);
		}

		activeImage = img;
		img.active = true;
		pubsub.publish("/images", img);

		return paintPicture();
	});
}

/* END DISPLAY CODE */


function imgExtById(id) {
	return globAsync("images/" + id + "/image.*")
	.then(function(file){
		return file[0] ? path.extname(file[0]) : "";
	});
}
function imgByPath(file) {
	return imgById(file.split("/")[1], path.extname(file));
}
function getThumbnail(id) {
	return "images/" + id + "/thumbnail.png";
}
function imgById(id, _ext) {
	var thumbnailFile = getThumbnail(id);
	var ext = _.isString(_ext) ? Promise.cast(_ext) : imgExtById(id);
	var thumbnail = fs.statAsync(thumbnailFile).catch(_.noop);

	return Promise.join(ext, thumbnail)
	.spread(function(ext, thumbnail){
		return {
			id: id,
			download: "images/" + id + "/image" + ext,
			thumbnail: thumbnail ? thumbnailFile : null,
			active: (activeImage && activeImage.id === id)
		};
	});
}
function addImage(filename) {
	var id = "image-" + path.basename(filename).replace(/\..+$/, "");
 
	var img = imgById(id, path.extname(filename));

	return Promise.join(img,fs.mkdirAsync("images/" + id))
	.spread(function(img){
		return img;
	})
	.tap(function(img){
		return fs.renameAsync(filename, img.download);
	})
	.tap(function(img){
		pubsub.publish("/images", img);
	})
	.tap(function(img){
		return new Promise(function(resolve, reject){
			var child = cp.spawn("convert", ["-define", "registry:temporary-path=images/tmp", "-limit","memory","8mb","-limit","map","8mb", img.download, "-thumbnail", "128x128", getThumbnail(img.id)], {stdio: "ignore"});
			child.on("close", resolve);
		});
	})
	.tap(function(img){
		img.thumbnail = getThumbnail(img.id);
		pubsub.publish("/images", img);

	});
}

server.listen(8000);
console.log("Listening: http://localhost:8000/");

