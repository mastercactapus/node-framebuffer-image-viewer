(function(){

	var pubsub = new Faye.Client("/pubsub");

	var ImageView = Backbone.View.extend({
		className: "box",
		events: {
			"click .links": "onLinksClick",
			"click [rel=delete]": "onDeleteClick",
			"click": "onBoxClick"
		},
		initialize: function() {
			this.listenTo(this.model, "change:active", this.updateActive);
			this.render();
		},
		makeIcon: function(type) {
			var icons = {
				"open": "glyphicons_415_disk_open.png",
				"download": "glyphicons_364_cloud_download.png",
				"delete": "glyphicons_197_remove.png"
			};

			var img = $("<img>");
			img.prop("src", "/vendor/icons/" + icons[type]);
			return img;
		},
		makeLink: function(name, desc) {
			var urlName = (name==="open") ? "download" : name;
			var href = this.model.get(urlName) || this.model.url();
			if (name === "download") {
				href += "?download=true";
			}
			var link = $("<a>");
			link.prop("href", href);
			link.prop("title", desc);
			link.html(this.makeIcon(name));
			if (name === "open") {
				link.prop("target", "_blank");
			}
			link.prop("rel", name);

			return link;
		},
		updateActive: function() {
			if (this.model.get("active")) {
				this.$el.addClass("active");
			} else {
				this.$el.removeClass("active");
			}
		},
		render: function(){
			this.$el.empty();

			this.$el.css("background-image", "url('" + this.model.get("thumbnail") + "')");
			var links = $("<div>");
			links.addClass("links");
			//clear everything
			this.$el.append(links);

			links.append(this.makeLink("open", "Open this image in a new window"));
			links.append(this.makeLink("download", "Download this image to your computer"));
			links.append(this.makeLink("delete", "Delete this image from the server"));

			this.updateActive();
		},

		onDeleteClick: function(){
			this.model.destroy();

			return false;
		},
		onLinksClick: function(e){
			// when we click any of the links,
			// we don't want to update the screen

			e.wasLink = true;
		},
		onBoxClick: function(e){
			if (e.wasLink) return;
			this.model.save({
				active: true
			});
		}
	});



	var ImageCollection = Backbone.Collection.extend({
		url: "/images",
		comparator: "id"
	});






	var main = new(Backbone.View.extend({
		events: {
			"change input[type=file]": "onFileChange"
		},
		initialize: function() {
			this.collection = new ImageCollection();

			this.listenTo(this.collection, "add", this.addImage);
			this.listenTo(this.collection, "remove", this.removeImage);
			this.listenTo(this.collection, "sort", this.resetImages);

			this.imageViews = {};

			this.collection.fetch();
			this.$images = this.$("#images");

			pubsub.subscribe("/images", this.imageUpdate.bind(this));
			pubsub.subscribe("/images/delete", this.collection.remove.bind(this.collection));
		},

		imageUpdate: function(image) {
			this.collection.add(image, {merge: true});
		},

		addImage: function(image){
			this.imageViews[image.id] = new ImageView({model: image});
			this._appendImage(image);
		},
		_appendImage: function(image) {
			this.$images.append(this.imageViews[image.id].$el);
		},
		removeImage: function(image) {
			this.imageViews[image.id].remove();
		},
		resetImages: function(){
			_.each(this.imageViews, function(imageView){
				imageView.$el.detach();
			});

			this.collection.each(this._appendImage, this);
		},
		onFileChange: function(e){
			var $target = this.$(e.target);
			if (!$target.val()) return;
			var $form = $target.closest("form");
			$form.submit();
			$form.reset();
		}

	}))({el: document.body});

	Dropzone.options.imageUpload = {
		acceptedFiles: "image/*"
	};

}());
