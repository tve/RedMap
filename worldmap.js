/**
 * Copyright 2015, 2017 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var path = require("path");
    var express = require("express");
    var sockjs = require('sockjs');
    var sockets = {}; // indexed by worldmap name

    var WorldMap = function(n) {
        RED.nodes.createNode(this,n);
        var uri = n.nameuri && n.name ? "worldmaps/"+n.name : "worldmap";
        if (!sockets[n.name]) {
            var fullPath = path.posix.join(RED.settings.httpNodeRoot, uri, 'leaflet', 'sockjs.min.js');
            this.log("Creating worldmap socket, name="+n.name+" nameuri="+n.nameuri+" uri="+uri+
                " fullPath="+fullPath);
            sockets[n.name] = sockjs.createServer({sockjs_url:fullPath, log:function() {}, transports:"xhr-polling"});
            sockets[n.name].installHandlers(RED.server, {prefix:path.posix.join(RED.settings.httpNodeRoot,'/'+uri+'/socket')});
        }
        this.lat = n.lat || "";
        this.lon = n.lon || "";
        this.zoom = n.zoom || "";
        this.layer = n.layer || "";
        this.cluster = n.cluster || "";
        this.maxage = n.maxage || "";
        this.showmenu = n.usermenu || "show";
        this.panit = n.panit || "false";
        this.layers = n.layers || "show";
        this.name = n.name;
        this.nameuri = !!n.nameuri;
        var node = this;
        var clients = {};
        //node.log("Serving map from "+__dirname+" as "+RED.settings.httpNodeRoot.slice(0,-1)+"/worldmap");
        RED.httpNode.use("/"+uri, express.static(__dirname + '/worldmap'));
        // add the cgi module for serving local maps....
        // FIXME: should only do this the first time
        RED.httpNode.use("/cgi-bin/mapserv", require('cgi')(__dirname + '/mapserv'));

        var callback = function(client) {
            //client.setMaxListeners(0);
            clients[client.id] = client;
            client.on('data', function(message) {
                message = JSON.parse(message);
                if (message.action === "connected") {
                    var c = {init:true};
                    if (node.lat && node.lat.length > 0) { c.lat = node.lat; }
                    if (node.lon && node.lon.length > 0) { c.lon = node.lon; }
                    if (node.zoom && node.zoom.length > 0) { c.zoom = node.zoom; }
                    if (node.layer && node.layer.length > 0) { c.layer = node.layer; }
                    if (node.cluster && node.cluster.length > 0) { c.cluster = node.cluster; }
                    if (node.maxage && node.maxage.length > 0) { c.maxage = node.maxage; }
                    c.showmenu = node.showmenu;
                    c.panit = node.panit;
                    c.showlayers = node.layers;
                    node.log("Client connect, sending: " + JSON.stringify({command:c}));
                    client.write(JSON.stringify({command:c}));
                }
            });
            client.on('close', function() {
                delete clients[client.id];
                node.status({fill:"green",shape:"ring",text:"connected "+Object.keys(clients).length});
            });
            node.status({fill:"green",shape:"dot",text:"connected "+Object.keys(clients).length});
        }
        node.on('input', function(msg) {
            if (msg.hasOwnProperty("_sessionid")) {
                if (clients.hasOwnProperty(msg._sessionid)) {
                    clients[msg._sessionid].write(JSON.stringify(msg.payload));
                }
            }
            else {
                for (var c in clients) {
                    if (clients.hasOwnProperty(c)) {
                        clients[c].write(JSON.stringify(msg.payload));
                    }
                }
            }
        });
        node.on("close", function() {
            for (var c in clients) {
                if (clients.hasOwnProperty(c)) {
                    clients[c].end();
                }
            }
            sockets[node.name].removeListener('connection', callback);
            node.status({});
        });
        sockets[node.name].on('connection', callback);
    }
    RED.nodes.registerType("worldmap",WorldMap);


    var WorldMapIn = function(n) {
        RED.nodes.createNode(this,n);
        if (!sockets[n.name]) {
            // FIXME: need to let worldmap node figure out socket name!
            var fullPath = path.posix.join(RED.settings.httpNodeRoot, 'worldmap', 'leaflet', 'sockjs.min.js');
            sockets[n.name] = sockjs.createServer({sockjs_url:fullPath, prefix:path.posix.join(RED.settings.httpNodeRoot,'/worldmap/socket')});
            sockets[n.name].installHandlers(RED.server);
        }
        var node = this;
        var clients = {};

        var callback = function(client) {
            //client.setMaxListeners(0);
            clients[client.id] = client;
            node.status({fill:"green",shape:"dot",text:"connected "+Object.keys(clients).length});
            client.on('data', function(message) {
                message = JSON.parse(message);
                node.send({payload:message, topic:"worldmap", _sessionid:client.id});
            });
            client.on('close', function() {
                delete clients[client.id];
                node.status({fill:"green",shape:"ring",text:"connected "+Object.keys(clients).length});
                node.send({payload:{action:"disconnect", clients:Object.keys(clients).length}, topic:"worldmap"});
            });
        }

        node.on("close", function() {
            for (var c in clients) {
                if (clients.hasOwnProperty(c)) {
                    clients[c].end();
                }
            }
            sockets[n.name].removeListener('connection', callback);
            node.status({});
        });
        sockets[n.name].on('connection', callback);
    }
    RED.nodes.registerType("worldmap in",WorldMapIn);


    var WorldMapTracks = function(n) {
        RED.nodes.createNode(this,n);
        this.depth = Number(n.depth) || 20;
        this.pointsarray = {};
        var node = this;

        node.on("input", function(msg) {
            if (msg.hasOwnProperty("payload") && msg.payload.hasOwnProperty("name")) {
                var newmsg = RED.util.cloneMessage(msg);
                if (msg.payload.deleted) {
                    delete node.pointsarray[msg.payload.name];
                    //newmsg.payload.name = msg.payload.name + "_";
                    node.send(newmsg);  // send the track to be deleted
                    return;
                }
                if (!node.pointsarray.hasOwnProperty(msg.payload.name)) {
                    node.pointsarray[msg.payload.name] = [];
                }
                node.pointsarray[msg.payload.name].push(msg.payload);
                if (node.pointsarray[msg.payload.name].length > node.depth) {
                    node.pointsarray[msg.payload.name].shift();
                }
                var line = [];
                for (var i=0; i<node.pointsarray[msg.payload.name].length; i++) {
                    var m = node.pointsarray[msg.payload.name][i];
                    if (m.hasOwnProperty("lat") && m.hasOwnProperty("lon")) {
                        line.push( [m.lat*1, m.lon*1] );
                        delete newmsg.payload.lat;
                        delete newmsg.payload.lon;
                    }
                    if (m.hasOwnProperty("latitude") && m.hasOwnProperty("longitude")) {
                        line.push( [m.latitude*1, m.longitude*1] );
                        delete newmsg.payload.latitude;
                        delete newmsg.payload.longitude;
                    }
                    if (m.hasOwnProperty("position") && m.position.hasOwnProperty("lat") && m.position.hasOwnProperty("lon")) {
                        line.push( [m.position.lat*1, m.position.lon*1] );
                        delete newmsg.payload.position;
                    }
                }
                if (line.length > 1) { // only send track if two points or more
                    newmsg.payload.line = line;
                    newmsg.payload.name = msg.payload.name + "_";
                    node.send(newmsg);  // send the track
                }
            }
        });

        node.on("close", function() {
            node.pointsarray = {};
        });
    }
    RED.nodes.registerType("worldmap-tracks",WorldMapTracks);
}
