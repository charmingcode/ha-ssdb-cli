// Nodejs client for https://github.com/ideawu/ssdb
// Copyright (c) 2014 Eleme, Inc.

'use strict';

var net         = require('net');
var util        = require('util');
var promisify   = require('promisify.js');
var createError = require('create-error.js');
var Parser      = require('./parser').Parser;

// Errors
// ssdb base error
var BaseError              = createError('BaseError', Error);
// thrown when socket error occurs
var SocketError            = createError('SocketError', BaseError);
// thrown when connection error occurs
var ConnectionError        = createError('ConnectionError', SocketError);
// thrown when connection is refused
var ConnectionRefusedError = createError('ConnectionRefusedError', ConnectionError);
// thrown when connection is timed out
var TimeoutError           = createError('TimeoutError', SocketError);
// thrown when ssdb command error occurs
var SSDBError              = createError('SSDBError', BaseError);
// thrown when ssdb command fails
var FailError              = createError('FailError', SSDBError);
// thrown when ssdb command error occurs on client side
var ClientError            = createError('ClientError', SSDBError);
// thrown when ssdb command error occurs on server side
var ServerError            = createError('ServerError', SSDBError);

// Cast responsed strings to Javascript types
var conversions = {
  int: function(list) {
    return parseInt(list[0], 10);
  },
  float: function(list) {
    return parseFloat(list[0]);
  },
  str: function(list) {
    return list[0];
  },
  bool: function(list) {
    return !!parseInt(list[0], 10);
  },
  list: function(list) {
    return list;
  }
};

// All avaliable commands
var commands = {
  set               : 'int',
  setx              : 'int',
  expire            : 'int',
  ttl               : 'int',
  setnx             : 'int',
  get               : 'str',
  getset            : 'str',
  del               : 'int',
  incr              : 'int',
  exists            : 'bool',
  getbit            : 'int',
  setbit            : 'int',
  countbit          : 'int',
  substr            : 'str',
  strlen            : 'int',
  keys              : 'list',
  scan              : 'list',
  rscan             : 'list',
  multi_set         : 'int',
  multi_get         : 'list',
  multi_del         : 'int',
  hset              : 'int',
  hget              : 'str',
  hdel              : 'int',
  hincr             : 'int',
  hexists           : 'bool',
  hsize             : 'int',
  hlist             : 'list',
  hrlist            : 'list',
  hkeys             : 'list',
  hgetall           : 'list',
  hscan             : 'list',
  hrscan            : 'list',
  hclear            : 'int',
  multi_hset        : 'int',
  multi_hget        : 'list',
  multi_hdel        : 'int',
  zset              : 'int',
  zget              : 'int',
  zdel              : 'int',
  zincr             : 'int',
  zexists           : 'bool',
  zsize             : 'int',
  zlist             : 'list',
  zrlist            : 'list',
  zkeys             : 'list',
  zscan             : 'list',
  zrscan            : 'list',
  zrank             : 'int',
  zrrank            : 'int',
  zrange            : 'list',
  zrrange           : 'list',
  zclear            : 'int',
  zcount            : 'int',
  zsum              : 'int',
  zavg              : 'float',
  zremrangebyrank   : 'int',
  zremrangebyscore  : 'int',
  multi_zset        : 'int',
  multi_zget        : 'list',
  multi_zdel        : 'int',
  qsize             : 'int',
  qclear            : 'int',
  qfront            : 'str',
  qback             : 'str',
  qget              : 'str',
  qslice            : 'list',
  qpush             : 'int',
  qpush_front       : 'int',
  qpush_back        : 'int',
  qpop              : 'str',
  qpop_front        : 'str',
  qpop_back         : 'str',
  qlist             : 'list',
  qrlist            : 'list',
  dbsize            : 'int',
  info              : 'list',
  auth              : 'bool'
};

// Low level connection object
function _Conn(options) {
  this.port = options.port || 8888;
  this.host = options.host || '0.0.0.0';
  this.auth = options.auth;  // default: undefined
  this.authCallback = options.authCallback ||
    function(err, data) { if (err) throw err; };
  this.timeout = options.timeout || 0;  // default: 0

  this.sock = null;
  this.callbacks = [];
  this.commands = [];
  this.parser = new Parser();
}

_Conn.prototype.connect = function(callback) {
  this.sock = net.Socket();
  this.sock.setTimeout(this.timeout);
  this.sock.setEncoding('utf8');
  this.sock.setNoDelay(true);
  this.sock.setKeepAlive(true);
  this.sock.connect(this.port, this.host, callback);
  var self = this;
  // register listeners
  this.sock.on('data', function(buf) {
    return self.onrecv(buf);
  });
  this.sock.on('error', function(err) {
    var error = null;
    if (err.code === 'ECONNREFUSED') {
      //throw new ConnectionRefusedError(err);
      error = new ConnectionRefusedError(err);
      self.sock = null;
    } else {
      //throw new ConnectionError(err);
      error = new ConnectionError(err);
      console.log('sock on error = ', error,
                  '\nremote_host', self.host, 'remote_port', self.port,
                  '\nstack = ', error.stack);
      // if (!self.sock.destroyed) {
      //     self.sock.destroy();
      // }
      self.sock = null;
    }
    // call callback
    var callback = self.callbacks.shift();

    if (callback) {
      callback(error, '');
    }
  });
  this.sock.on('timeout', function(err) {
    //throw new TimeoutError(err);
    var error = new TimeoutError(err);
    // call callback
    var callback = self.callbacks.shift();
    if (callback) {
      callback(error, '');
    }

  });
};

_Conn.prototype.close = function() {
  if (this.sock) {
    this.sock.end();
    this.sock.destroy();
    this.sock = null;
  }
  if (this.parser) {
    this.parser.clear();
  }
};

// Compile command & parameters to buffer before sent.
_Conn.prototype.compile = function(cmd, params) {
  var args = [];
  var list = [];
  var pattern = '%d\n%s\n';

  args.push(cmd);
  [].push.apply(args, params);

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    var bytes = Buffer.byteLength(util.format('%s', arg));
    list.push(util.format(pattern, bytes, arg));
  }

  list.push('\n');
  return new Buffer(list.join(''));
};

// Send command & parameters to ssdb
_Conn.prototype.send = function(cmd, params) {
  var buf = this.compile(cmd, params);
  // lazy connect
  if (!this.sock) {
    var self = this;
    return this.connect(function() {
      if (typeof self.auth !== 'undefined') {
        // auth on the first command
        var cmd = 'auth';
        var params = [self.auth];
        self.commands.unshift(cmd);
        self.callbacks.unshift(self.authCallback);
        self.send(cmd, params);
      }
      // tcp guarantees this `write` orders after `auth`
      self.sock.write(buf);
    });
  } else {
    return this.sock.write(buf);
  }
};


// Build Javascript values by type and data from socket
_Conn.prototype.buildValue = function(type, list) {
  return conversions[type](list);
};

// Build error message
_Conn.prototype.buildError = function(status, command) {
  return util.format('%s on command \'%s\'', status, command);
};

// Receive buffer from socket and call the responsive callback
_Conn.prototype.onrecv = function(buf) {
  var response;
  var responses = [];
  this.parser.feed(buf);

  while ((response = this.parser.get()) !== undefined) {
    responses.push(response);
  }

  var self = this;
  responses.forEach(function (response) {
    var error;
    var data;

    var status = response[0];
    var body = response.slice(1);
    var command = self.commands.shift();

    // build value
    switch (status) {
      case 'ok':
        var type = commands[command] || 'str';
        data = self.buildValue(type, body);
        break;
      case 'not_found':
        // do nothing, err: undefined, data: undefined
        break;
      case 'client_error':
        error = new ClientError(self.buildError(status, command));
        break;
      case 'fail':
        error = new FailError(self.buildError(status, command));
        break;
      case 'server_error':
        error = new ServerError(self.buildError(status, command));
        break;
      case 'error':
      default:
        // build error
        error = new SSDBError(self.buildError(status, command));
        break;
    }

    // call callback
    var callback = self.callbacks.shift();

    if (callback) {
      callback(error, data);
    }
  });
};

// Execute an command with parameters and callback.
_Conn.prototype.request = function(cmd, params, callback) {
  this.commands.push(cmd);
  this.callbacks.push(callback);
  return this.send(cmd, params);
};

// High level connection object.
function Conn(options) {
  this._conn = new _Conn(options);

  this._registercmds();

  if (options.promisify || false)
    this.promisify();

  if (options.thunkify || false)
    conn.thunkify();
}

// Register commands to this connection
Conn.prototype._registercmds = function() {
  var self = this;

  for (var cmd in commands) {
    (function(cmd) {
      self[cmd] = function() {
        var cb;
        var params = [].slice.call(arguments, 0, -1);
        var lastit = [].slice.call(arguments, -1)[0];

        if (typeof lastit === 'function') {
          cb = lastit;
        } else {
          params.push(lastit);
        }
        return self._conn.request(cmd, params, cb);
      };
    })(cmd);
  }
  return self;
};

Conn.prototype.promisify = function() {
  var self = this;

  for (var cmd in commands) {
    (function(cmd) {
      self[cmd] = promisify(self[cmd]);
    })(cmd);
  }
  return self;
};

Conn.prototype.thunkify = function() {
  var self = this;

  for (var cmd in commands) {
    (function(cmd) {
      var fn = self[cmd];
      self[cmd] = function () {
        var args = arguments;
        return function (cb) {
          [].push.call(args, cb);
          fn.apply(this, args);
        };
      };
    })(cmd);
  }
  return self;
};

Conn.prototype.close = function() {
  return this._conn.close();
};

// Connection pool.
function Pool(options) {
  this.pool = [];
  this.policy = options.policy;

  for (var i = 0; i < (options.size || 1); ++i)
    this.create(options);
}

// Poolling policies.
Pool.policies = {
  round_robin: 0,
  least_conn: 1,
};

Pool.prototype.size = function() {
  return this.pool.length;
};

Pool.prototype.create = function(options) {
  var conn =  new Conn(options || {});
  return this.pool.push(conn);
};

Pool.prototype.acquire = function() {
  if (this.pool.length === 1)
      return this.pool[0];

  switch(this.policy) {
    case Pool.policies.least_conn:
      this.pool.sort(function(a, b) {
        return a._conn.commands.length - b._conn.commands.length;
      });
      return this.pool[0];
    case Pool.policies.round_robin:
    default:
      // round robin acquire policy
      if (typeof this._round_robin_cursor === 'undefined')
        this._round_robin_cursor = 0;
      this._round_robin_cursor = (this._round_robin_cursor + 1) % this.size();
      return this.pool[this._round_robin_cursor];
  }
};

Pool.prototype.destroy = function() {
  for (var i = 0; i < this.pool.length; i++)
    this.pool[i].close();
};

// exports
exports.BaseError              = BaseError;
exports.SocketError            = SocketError;
exports.ConnectionError        = ConnectionError;
exports.ConnectionRefusedError = ConnectionRefusedError
exports.TimeoutError           = TimeoutError;
exports.SSDBError              = SSDBError;
exports.FailError              = FailError;
exports.ClientError            = ClientError;
exports.ServerError            = ServerError;
exports.commands               = commands;
exports.Conn                   = Conn;
exports.Pool                   = Pool;
exports.createPool             = function(options) {
  return new Pool(options || {});
};
