// Nodejs client for https://github.com/ideawu/ssdb
// Copyright (c) 2014 Eleme, Inc.

'use strict';

var ssdb      = require('./ssdb');
var Conn      = ssdb.Conn;
var commands  = ssdb.commands;

// ha-ssdb Connection pool.
function HAssdb(options) {
  this.pool = [];
  this._registercmds();
  this._conn = null;
  this._cur  = 0;
  
  for (var i = 0; i < (options.length || 1); ++i) {
    //console.log(options[i]);
    this.create(options[i]);
  }
}

HAssdb.prototype.size = function() {
  return this.pool.length;
};

HAssdb.prototype.create = function(options) {
  var conn =  new Conn(options || {});
  return this.pool.push(conn);
};

HAssdb.prototype.acquire = function() {
};

HAssdb.prototype.destroy = function() {
  for (var i = 0; i < this.pool.length; i++)
    this.pool[i].close();
};

// Register commands to this HAssdb-proxy 
HAssdb.prototype._registercmds = function() {
  var self = this;

  for (var cmd in commands) {
    (function(cmd) {
      self[cmd] = function *() {
        var args = arguments;
        var ret = null;
        for(let i=0;i<self.pool.length;i++){
          try{
            self._cur = (self._cur+i)%self.pool.length;
            self._conn = self.pool[self._cur];
            // console.log('---=== try pool conn_index=', self._cur,
            //     'conn=', self._conn._conn.host, ':', self._conn._conn.port);
            ret = yield self._conn[cmd].apply(self._conn, arguments);
            break;
          } catch(err) {
            console.log('---=== try pool conn_index=', self._cur,
                'conn=', self._conn._conn.host, ':', self._conn._conn.port,
                'err=', err);
          }
        }
        if(ret==null){
            throw new Error('oh, no ssdb can connect');
        }
        return ret;
      };
    })(cmd);
  }
  return self;
};

// exports
exports.HAssdb = HAssdb;
