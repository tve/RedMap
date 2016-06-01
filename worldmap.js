/**
 * Copyright 2015, 2016 IBM Corp.
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
    var express = require("express");
    var io = require('socket.io')(RED.server);

    var WorldMap = function(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        //node.log("Serving map from "+__dirname+" as "+RED.settings.httpNodeRoot.slice(0,-1)+"/worldmap");
        RED.httpNode.use("/worldmap", express.static(__dirname + '/worldmap'));
        var callback = function(socket) {
            node.status({fill:"green",shape:"dot",text:"connected"});
            node.on('input', function(msg) {
                socket.emit("worldmapdata",msg.payload);
            });
            socket.on('disconnect', function() {
                node.status({fill:"red",shape:"ring",text:"disconnected"});
            });
            node.on("close", function() {
                node.status({});
                socket.disconnect();
                io.sockets.removeListener('connection', callback);
            });
        }
        io.on('connection', callback );
    }
    RED.nodes.registerType("worldmap",WorldMap);

    var WorldMapIn = function(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        var callback = function(socket) {
            node.status({fill:"green",shape:"dot",text:"connected"});
            socket.on('worldmap', function(data) {
                node.send({payload:data, topic:"worldmap"});
            });
            socket.on('disconnect', function() {
                node.status({fill:"red",shape:"ring",text:"disconnected"});
                node.send({payload:{action:"disconnect"}, topic:"worldmap"});
            });
            node.on("close", function() {
                node.status({});
                socket.disconnect();
                io.sockets.removeListener('connection', callback);
            });
        }
        io.on('connection', callback);
    }
    RED.nodes.registerType("worldmap in",WorldMapIn);
}
