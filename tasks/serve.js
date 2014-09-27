/*
 * grunt-serve
 * https://github.com/lud2k/grunt-serve
 *
 * Copyright (c) 2014 Ludovic Cabre
 * Licensed under the MIT license.
 */

'use strict';

// requires
var connect = require('connect'),
	http = require('http'),
	childProcess = require("child_process"),
	fs = require('fs'),
	dot = require('dot'),
	paths = require('path');

// load all template files
var loadTemplate = function(name) {
		return dot.template(fs.readFileSync(paths.join(__dirname, '..', 'pages', name)))
	},
	indexTmpl = loadTemplate('index.html'),
	notFoundTmpl = loadTemplate('not_found.html'),
	directoryTmpl = loadTemplate('directory.html'),
	errorTmpl = loadTemplate('error.html'),
	successTmpl = loadTemplate('error.html'),
	gruntErrorTmpl = loadTemplate('grunt_error.html'),
	missingTmpl = loadTemplate('missing.html');

/**
 * Definition of the exported method that will be called by Grunt on initialization.
 */
module.exports = function(grunt) {
	// register serve task
	grunt.registerTask('serve', 'Starts a http server that can be called to run tasks.', function() {
		// control when the task should end
	    var done = this.async();
	    
		// get options
		var options = this.options({
			port: 9000,
			silently: false
		});
		
		// start an HTTP server
		http.createServer(function(request, response) {
			try {
				// forward request
				handleRequest(request, response, grunt, options);
			} catch(e) {
				// show error
			    render(response, 500, errorTmpl, {
			    	error: 'Unexpected JavaScript exception "'+e+'"<br />'+e.stack.replace(/\n+/g, '<br />')
			    });
			}
		}).listen(options.port);

		// handle SIGINT signal properly
		process.on('SIGINT', function() {
			// terminate task
		    done();
		});
		
    	// a few messages
        grunt.log.write('Server is running on port '+options.port+'...\n');
        grunt.log.write('Press CTRL+C at any time to terminate it.\n');
	});
}

/**
 * Handles all requests to the server.
 * Each call with trigger a call to the following function.
 */
function handleRequest(request, response, grunt, options) {
	// get url from request
	var url = request.url,
		path = /[^?#]+/.exec(url)[0];
	
	// main page request?
	if (path == '/') {
		render(response, 200, indexTmpl, {
	    	host: request.headers.host,
	    	aliases: mapToArray(options.aliases, 'name'),
	    	files: filesInDirectory(grunt, '.')
	    });
		return;
	}

	// is this url for /task/?
	if (path.substr(0, 6) == '/task/') {
		// get parameters
		var match = /\/task\/([^\/]+)(\/(.+))?/.exec(url);
		if (match) {
			var tasks = match[1].split(','),
				output = match[3];
			
			// run tasks
			executeTasks(request, response, grunt, options, tasks, output, null);
			return;
		}
	}
	
	// does this path match an alias?
	var aliasName = path.substr(1);
	var aliases = options.aliases;
	if (aliases && aliases[aliasName]) {
		// get alias configuration
		var tasks = aliases[aliasName].tasks,
			output = aliases[aliasName].output,
			contentType = aliases[aliasName].contentType;
		
		// run tasks
		executeTasks(request, response, grunt, options, tasks, output, contentType);
		return;
	}
	
	// is this path a file?
	var file = path.substr(1);
    if (grunt.file.exists(file)) {
    	var stats = fs.statSync(file);
    	if (stats.isDirectory()) {
    		// show directory content
    		render(response, 200, directoryTmpl, {
    	    	files: filesInDirectory(grunt, file)
    	    });
    		
    	} else {
    		// return file
    		write(response, 200, grunt, file);
    	}
    } else {
    	render(response, 404, notFoundTmpl);
    }
}

/**
 * Runs Grunt to execute the given tasks.
 */
function executeTasks(request, response, grunt, options, tasks, output, contentType) {
	// execute tasks
	childProcess.exec('grunt '+tasks.join(' '), function(error, stdout, stderr) {
		try {
			// should we print the stdout?
			if (!options.silently) {
				// print stdout
				console.log(stdout);
				
				// print stderr (if any)
				if (stderr) {
					console.log(stderr);
				}
			}
			
			// any error? write logs and return
			if (stderr || error) {
			    render(response, 500, gruntErrorTmpl, {
			    	tasks: tasks,
			    	stdout: formatStdout(stdout),
			    	stderr: formatStdout(stderr)
			    });
				return;
			}
			
		    // the the output stdout?
		    if (output == 'stdout' || !output) {
			    // write stdout
		    	render(response, 200, successTmpl, {
		    		output: formatStdout(stdout)
		    	});
			    
		    } else {
		    	// requested output file exists?
				if (grunt.file.exists(output)) {
					// write file
		    		write(response, 200, grunt, output, contentType);
				} else {
					// show file not found
				    render(response, 500, missingTmpl, {
				    	output: output
				    });
				}
		    }
		} catch(e) {
			// show error
		    render(response, 500, errorTmpl, {
		    	error: 'Unexpected JavaScript exception "'+e+'"<br />'+e.stack.replace(/\n+/g, '<br />')
		    });
		}
	});
}

/**
 * Renders an html page and ends the request.
 */
function render(response, code, template, data) {
    response.writeHead(code, {"Content-Type": "text/html"});
    response.end(template(data));
}

/**
 * Writes a file's content to the output and ends the request.
 */
function write(response, code, grunt, file, contentType) {
    response.writeHead(200, headersForOutput(file, contentType));
	response.end(grunt.file.read(file));
}

/**
 * Converts a map to an array adding the key to the value.
 */
function mapToArray(map, name) {
	var ret = [];
	for (var key in map) {
		map[key][name] = key;
		ret.push(map[key]);
	}
	return ret;
}

/**
 * Returns the list of files in the given directory.
 */
function filesInDirectory(grunt, path) {
	var ret = [],
		files = fs.readdirSync(path);
	
	// for each file
	for (var i=0; i<files.length; i++) {
		var file = files[i],
			stats = fs.statSync(path ? paths.join(path, file) : file),
			isDir = stats.isDirectory();
		
		// skip ., .. and hidden files
		if (file.charAt(0) == '.') continue;
		
		ret.push({
			path: path ? path + '/' + file : file,
			name: file,
			isDir: isDir
		});
	}
	
	return ret;
}

/**
 * Returns the headers that fits the best the output.
 * Will also add headers to prevent caching.
 */
function headersForOutput(output, contentType) {
	// was a content type given?
	if (!contentType) {
		// default content type
		contentType = 'text/plain';
		
		// check output extension
		if (output.match(/\.js$/i)) {
			contentType = 'text/javascript';
		} else if (output.match(/\.css$/i)) {
			contentType = 'text/css';
		} else if (output.match(/\.xml$/i)) {
			contentType = 'text/xml';
		} else if (output.match(/\.json$/i)) {
			contentType = 'text/json';
		} else if (output.match(/\.html$/i)) {
			contentType = 'text/html';
		} else if (output.match(/\.png$/i)) {
			contentType = 'image/png';
		} else if (output.match(/\.jpg$/i)) {
			contentType = 'image/jpeg';
		} else if (output.match(/\.ico$/i)) {
			contentType = 'image/ico';
		} else if (output.match(/\.jpeg$/i)) {
			contentType = 'image/jpeg';
		}
	}
	
	return {
		'Content-Type': contentType,
		'Cache-Control': 'no-cache, no-store, must-revalidate',
		'Pragma': 'no-cache',
		'Expires': '0'
	};
}

/**
 * Converts Grunt's stdout into html.
 * (keeping the colors the same)
 */
function formatStdout(stdout) {
	var regex = /\x1B\[(\d+)m/g,
		opened = false,
		colors = {
			'0': '#000000',
			'30': '#000000',
			'31': '#CC0000',
			'32': '#00CC00',
			'33': '#CCCC00',
			'34': '#00CC00',
			'35': '#CC00CC',
			'36': '#00CCCC',
			'37': '#999999'
		},
		match;
	
	// replace all colors markers by html
	while ((match = regex.exec(stdout))) {
		var code = match[1]+'',
			start = stdout.substr(0, match.index),
			end = stdout.substr(match.index+3+code.length);
		
		if (code) {
			var colorEnd = opened ? '</span>' : '',
				colorStart = '<span style="color: '+colors[code]+'">';
			stdout = start + colorEnd + colorStart + end;
			
		} else {
			stdout = start + end;
		}
		
		opened = true;
	}
	
	// replace all line return by the html equivalent
	return stdout.replace(/\n+/g, '<br />');
}
