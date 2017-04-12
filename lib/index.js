// exports
var HAssdb=require("./ha-ssdb").HAssdb;
exports.createHAIns = function (options) {
    return new HAssdb(options);
};
