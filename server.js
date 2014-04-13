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
	addImage(req.files.file.path);
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
function setActive(id) {
	if (activeImage && activeImage.id === id) return Promise.resolve();

	var ext = imgExtById(id);
	return ext.then(function(ext){
		var img = imgById(id, ext);
		img.active = true;

		if (activeImage) {
			if (activeProcess) activeProcess.kill();
			activeImage.active = false;
			pubsub.publish("/images", activeImage);

		}

		activeImage = img;
		pubsub.publish("/images", img);
		activeProcess = cp.spawn("fbv", ["-e", "-a", img.download]);
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
function imgById(id, ext) {
	return {
		id: id,
		download: "images/" + id + "/image" + ext,
		thumbnail: "images/" + id + "/thumbnail.png",
		active: (activeImage && activeImage.id === id)
	};
}
function addImage(filename) {
	var id = "image-" + path.basename(filename).replace(/\..+$/, "");
 
	var img = imgById(id, path.extname(filename));

	return fs.mkdirAsync("images/" + id)
	.then(function(){
		return new Promise(function(resolve, reject){
			var child = cp.spawn("convert", ["-define", "registry:temporary-path=images/tmp", "-limit","memory","8mb","-limit","map","8mb", filename, "-thumbnail", "128x128", img.thumbnail], {stdio: "ignore"});
			child.on("close", resolve);
		});
	})
	.then(function(){
		return new Promise(function(resolve,reject){
			var stream = fs.createReadStream(filename).pipe(fs.createWriteStream(img.download));

			stream.on("error", reject);
			stream.on("close", resolve);
		});
	})
	.then(function(){
		pubsub.publish("/images", img);
	})
	.return(img);
}

server.listen(8000);
console.log("Listening: http://localhost:8000/");

