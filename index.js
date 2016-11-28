module.exports = {
	gulp: function(gulp, build){
		
		var gulpif = require('gulp-if');
		var stylus = require('gulp-stylus');
		var cssmin = require('gulp-cssmin');
		var svgmin = require('gulp-svgmin');
		var imagemin = require('gulp-imagemin');
		var cheerio = require('gulp-cheerio');
		var stylusUtils = require('stylus').utils;
		var spritesmith = require('gulp.spritesmith');
		var uglify = require('gulp-uglify');
		var concat = require('gulp-concat');
		var run = require('run-sequence').use(gulp);
		var streamqueue = require('streamqueue');
		var bower = require('main-bower-files');
		var twig = require('gulp-twig');
		var browserSync;
		var nib = require('nib');
		var merge = require('merge-stream');
		var mergeObjects = require('merge');
		var path = require('path');
		var fs = require('fs');
		var sort = require('gulp-sort');
		var replace = require('gulp-replace');
		var through = require('through');
		var rename = require('gulp-rename');
		var spritesStorage;
		var svgStorage;

		var process = require('process');
		var production = process.env.NODE_ENV === 'production';
		var config = require('./package.json').build;
		
		if(build){
			config = mergeObjects.recursive(true, config, build);
		}
		
		gulp.task('css', function (callback){
			run(['css:sprites', 'css:svg', 'css:vendor'], 'css:stylus', callback);
		});


		gulp.task('css:svg:update', function(callback){
			run('css:svg', 'css:stylus', callback);
		});

		gulp.task('css:sprites:update', function(callback){
			run('css:sprites', 'css:stylus', callback);
		});

		gulp.task('css:svg', function(){
			svgStorage = {};

			var stream = gulp.src([config.source.svg + '/**/*.svg'])
				.pipe(svgmin())
				.pipe(cheerio({
					run: function ($) {
						$('svg').attr('preserveAspectRatio', 'none');
					},
					parserOptions: { xmlMode: true }
				}))
				.pipe(replace('&gt;', '>'))
				.pipe(through(
					function(file){
						var icon = file.contents.toString();
						var size = icon.match(/viewBox="[\d\.]+ [\d\.]+ ([\d\.]+) ([\d\.]+)"/i);

						if(size){
							svgStorage[path.basename(file.path, '.svg')] = {
								width: size[1],
								height: size[2],
								icon: icon.replace(/[{}\|\\\^~\[\]`"<>#%]/g, function(match) {
									return '%' + match[0].charCodeAt(0).toString(16).toUpperCase();
								}).trim()
							};
						}

					}
				))
			;

			return stream;
		});

		function unquote (str) {
			return str.replace(/^[\'\"]|[\'\"]$/g, '');
		}

		gulp.task('css:stylus', function(callback){
			var stream = gulp.src([config.source.css + '/*.styl'])
				.pipe(stylus({use: [nib(),
					function(stylus){
						stylus
							.define('str-replace', function (string, match, value) {
								// Replace matching chars in string and replace with needed value
								return unquote(string.toString()).replace(new RegExp(unquote(match.toString()), 'gm'), unquote(value.toString()));
							})
							.define('str-split', function (string, match) {
								return unquote(string.toString()).split(unquote(match.toString()));
							})
							.define('str-indexOf', function (match, string) {
								return unquote(string.toString()).indexOf(unquote(match.toString()));
							})
							.define('str-to-base64', function (string) {
								// Encode string to base64 format
								return new Buffer(unquote(string.toString())).toString('base64');
							});
					},

					function(stylus){
					stylus.define('$sprites-timestamp', (new Date).getTime());
					stylus.define('$sprites', stylusUtils.coerceObject(spritesStorage, true));
					stylus.define('$svg', stylusUtils.coerceObject(svgStorage, true));
				}]}))
				.on('error', function(error){
					console.log(error.message);
					callback();
				})
				.pipe(gulpif(production, cssmin()))
				.pipe(gulp.dest(config.destination.css));

			if(browserSync){
				stream.pipe(browserSync.reload({stream: true}));
			}

			return stream;
		});
	
		gulp.task('css:sprites', function(callback){
			var dir = config.source.sprites,
				stream;

			spritesStorage = {};

			if(!fs.existsSync(dir)){
				return callback();
			}

			stream = fs.readdirSync(dir)
				.filter(function(file){
					return fs.statSync(path.join(dir, file)).isDirectory();
				})
				.map(function(folder){
					var data = gulp.src(path.join(dir, folder, '/*.png')).pipe(spritesmith(
						config.retina
							?
								{
									retinaSrcFilter: path.join(dir, folder, '/*@2x.png'),
									retinaImgName: folder + '-2x.png',
									imgName: folder + '.png',
									cssName: folder,
									cssFormat: 'json_retina',
									algorithm: 'top-down'
								}
							:
								{
									imgName: folder + '.png',
									cssName: folder,
									cssFormat: 'json',
									algorithm: 'top-down'
								}
					
					));
			
					data.img.pipe(gulp.dest(config.destination.sprites));
					return data.css;
				});


			if(!stream.length){
				return callback();
			}

			stream = merge(stream);
			stream.pipe(through(
				function(file){
					spritesStorage[file.path] = JSON.parse(file.contents.toString());
				}
			));

			return stream;
		});



		gulp.task('css:vendor', function(){
			var stream = gulp.src(config.source.css + '/vendor/*.css');

			if(fs.existsSync('./bower_components')){
				stream = streamqueue(
					{objectMode: true},
					gulp.src(
						bower({
							includeDev: true,
							filter: '**/*.css'
						})
					)
						.pipe(replace(/url\('/gm, 'url(\'/images/vendor/'))
						.pipe(replace(/url\((?!')/gm, 'url(/images/vendor/')),
					stream
				);
			}

			stream
				.pipe(concat('vendor.css'))
				.pipe(gulp.dest(config.destination.css));

			return stream;
		});

		gulp.task('js', function(callback){
			run(['js:main', 'js:vendor'], callback);
		});

		gulp.task('js:main', function(callback){
			var dir = config.source.js,
				dest = config.destination.js,
				stream;

			if(!fs.existsSync(dir)){
				return callback();
			}

			stream = fs
				.readdirSync(dir)
				.filter(function(file){
					return fs.statSync(path.join(dir, file)).isDirectory() && file != 'vendor';
				})
				.map(function(folder){
					return gulp.src(path.join(dir, folder, '/*.js'))
						.pipe(sort())
						.pipe(concat(folder + '.js'))
						.pipe(gulpif(production, uglify()))
						.pipe(gulp.dest(dest));
				});

			stream = merge(
				stream,
				gulp.src(dir + '/*.js')
					.pipe(sort())
					.pipe(concat('common.js'))
					.pipe(gulpif(production, uglify()))
					.pipe(gulp.dest(dest))
			);

			if(browserSync){
				stream.pipe(browserSync.reload({stream: true}));
			}

			return stream;
		});


		gulp.task('js:vendor', function(){
			var stream = gulp.src(config.source.js + '/vendor/**/*.js');

			if(fs.existsSync('./bower_components')){
				stream = streamqueue(
					{objectMode: true},
					gulp.src(bower({includeDev: true, filter: '**/*.js'})),
					stream
				);
			}

			stream
				.pipe(concat('vendor.js'))
				.pipe(gulpif(production, uglify()))
				.pipe(gulp.dest(config.destination.js));

			if(browserSync){
				stream.pipe(browserSync.reload({stream: true}));
			}

			return stream;
		});


		gulp.task('fonts', function(){
			return gulp.src(config.source.fonts + '/**/*').pipe(gulp.dest(config.destination.fonts));
		});


		gulp.task('images', function(){
			if(fs.existsSync('./bower_components')){
				gulp
					.src(
						bower({
							includeDev: true,
							filter: ['**/*.png', '**/*.jpg', '**/*.gif']
						})
					)
					.pipe(gulpif(production, imagemin()))
					.pipe(gulp.dest(config.destination.images + '/vendor'));
			}

			return gulp.src(config.source.images + '/**/*')
				.pipe(gulpif(production, imagemin()))
				.pipe(gulp.dest(config.destination.images));
		});


		gulp.task('video', function(){
			return gulp.src(config.source.video + '/**/*').pipe(gulp.dest(config.destination.video));
		});



		gulp.task('html', function(callback){
			if(!fs.existsSync(config.source.html)){
				return callback();
			}

			var stream = gulp.src(config.source.html + '/*.twig')
				.pipe(twig(/*{data: JSON.parse(fs.readFileSync(config.source.html + '/data.json'))}*/))
				.on('error', console.log)
				.pipe(gulp.dest(config.destination.html));

			if(browserSync){
				stream.pipe(browserSync.reload({stream: true}));
			}

			return stream;
		});


		gulp.task('server', function(){
			browserSync = require('browser-sync');

			if(config.external){
				browserSync({proxy: path.basename(__dirname.replace(/[\/\\]markup$/, '')), open: false, notify: false, ghostMode: false, ui: false, port: 4000});
			}else{
				browserSync({server: {baseDir: './web'}, open: false, notify: false, ghostMode: false, ui: false});
			}
		});


		gulp.task('watch', ['server'], function(){
			if(!config.external){
				gulp.watch(config.source.html + '/**/*.twig', ['html']);
			}
			
			gulp.watch(config.source.css + '/**/*.styl', ['css:stylus']);
			gulp.watch(config.source.css + '/vendor/*.css', ['css:vendor']);
			gulp.watch([config.source.js + '/**/*.js', '!' + config.destination.js + '/vendor/**/*.js'], ['js']);
			gulp.watch(config.source.js + '/vendor/**/*.js', ['js:vendor']);
			gulp.watch(config.source.fonts + '/**/*', ['fonts']);
			gulp.watch(config.source.images + '/**/*', ['images']);
			gulp.watch(config.source.video + '/**/*', ['video']);
			gulp.watch(config.source.svg + '/**/*.svg', ['css:svg:update']);
			gulp.watch(config.source.sprites + '/**/*', ['css:sprites:update']);
		});


		gulp.task('default', function(callback){
			run('build', 'watch', callback);
		});

		gulp.task('build', function(callback){
			run(['css', 'js', 'fonts', 'images', 'video', 'html'], callback);
		});

		gulp.task('external', function(callback){
			run('external:build', 'watch', callback);
		});

		gulp.task('external:build', function(callback){
			config.external = true;
					
			for(var i in config.destination){
				config.destination[i] = './../' + config.destination[i];
			}
			
			run(['css', 'js', 'fonts', 'images', 'video'], callback);
		});
	}
};