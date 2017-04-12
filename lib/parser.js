//
// Nodejs ssdb protocol parser implementation
//

var Parser = exports.Parser = function() {}

Parser.prototype.feed = function(buf) {
  if (typeof this.buf === 'undefined') {
    this.buf = new Buffer(buf);
  } else {
    this.buf = Buffer.concat([this.buf, new Buffer(buf)]);
  }
};

Parser.prototype.get = function() {
  var len = this.buf.length;
  var ptr = 0;
  var ch = 0;
  var chunk = [];

  while (len > 0) {
    ch = [].indexOf.apply(this.buf, [10, ptr]);

    if (ch < 0)
      break;

    ch += 1;

    var dis = ch - ptr;

    if (dis === 1 || (dis === 2 && this.buf[ptr] === 13)) {
      this.buf = this.buf.slice(ch);
      return chunk;  // OK
    }

    var sz = parseInt(this.buf.slice(ptr, ch), 10);

    len -= dis + sz;
    ptr += dis + sz;

    if (len < 0) break;

    if (len >= 1 && this.buf[ptr] === 10) {
      len -= 1;
      ptr += 1;
    } else if (len >= 2 && this.buf[ptr] === 13 && this.buf[ptr + 1] === 10) {
      len -= 2;
      ptr += 2;
    } else {
      break;
    }

    chunk.push(this.buf.slice(ch, ch + sz).toString());
  }
};

Parser.prototype.clear = function() {
  this.buf = new Buffer('');
}
