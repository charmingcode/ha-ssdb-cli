ha-node-ssdb
=========
1.  if all ssdb-servers connect fail, throw error.
2.  npm install ha-ssdb-cli
3.  npm test

   ```js
   var co = require('co');
var wait = require('co-wait');
var hassdb = require('ha-ssdb-cli');

options = [
    {   
        host: '0.0.0.0',
        port: 8888,
        timeout: 0,
        promisify: true,  // make api methods promisify.
    },  
    {   
        host: '127.0.0.1',
        port: 38888,
        timeout: 0,
        promisify: true,  // make api methods promisify.
    }   
];

try {
    ssdb = new hassdb.createHAIns(options);
    co(function *() {
        var key = 'key';
        while (true) {
            console.log("----===--- 1");
            try {
                var a = yield ssdb.set(key, "123");
                console.log("----===--- 2");
                var b = yield ssdb.get(key);
                console.log("----===--- 3");
                var c = yield ssdb.info();
                console.log(a, b, c);  // 1 'val'
            } catch (err) {
                console.error(err.message);
            }   
            console.log('--- wait --- 1');
            yield wait(1000);
            console.log('--- wait --- 2');
            yield wait(1000);
            console.log('--- wait --- 3');
            yield wait(1000);
        }   
    });
} catch (err) {
    console.log('===---', err);
}

   ```

License
-------

Copyright (c) 2014 Eleme, Inc. detail see [LICENSE-MIT](./LICENSE-MIT)
