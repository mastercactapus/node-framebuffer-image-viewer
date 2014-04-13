var express = require("express");
var http = require("http");

var app = express();
var router = express.Router();
app.use(express.static("public"));
router.get("/", function(req,res){
	res.sendfile("public/index.html");
});


app.listen(8000);

