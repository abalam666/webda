var assert = require("assert")
var Webda = require("../core.js");
var config = require("./config.json");
var fs = require("fs");

var webda;
var userStore;
var binary;

var normal = function(userStore, binary, map, webda, exposePath) {
  var eventFired = 0;
  var events = ['binaryGet', 'binaryUpdate', 'binaryCreate', 'binaryDelete'];
  for (let evt in events) {
    binary.on(events[evt], function(evt) {
      eventFired++;
    });
  }
  // Check CREATE - READ
  var hash;
  var user1;
  var user2;
  var user;
  var ctx;
  var error;
  return userStore.save({
    "test": "plop"
  }).then(function(user) {
    user1 = user;
    return userStore.save({
      "test": "plop"
    });
  }).then(function(user) {
    user2 = user;
    return binary.store(userStore, user1, map, {
      'path': './test/Dockerfile'
    }, {});
  }).then(function() {
    return userStore.get(user1.uuid);
  }).then(function(user) {
    user1 = user;
    assert.notEqual(user[map], undefined);
    assert.equal(user[map].length, 1);
    hash = user[map][0].hash;
    return binary.getUsageCount(hash);
  }).then(function(value) {
    assert.equal(value, 1);
    return binary.store(userStore, user2, map, {
      'path': './test/Dockerfile'
    }, {});
  }).then(function() {
    return userStore.get(user2.uuid);
  }).then(function(userArg) {
    user = userArg;
    assert.notEqual(user[map], undefined);
    assert.equal(user[map].length, 1);
    assert.equal(user[map][0].constructor.name, 'BinaryMap');
    hash = user[map][0].hash;
    return binary.getUsageCount(hash);
  }).then(function(value) {
    assert.equal(value, 2);
    return binary.delete(userStore, user, map, 0);
  }).then(function() {
    return userStore.get(user2.uuid);
  }).then(function(user) {
    assert.equal(user[map].length, 0);
    return binary.getUsageCount(hash);
  }).then(function(value) {
    assert.equal(value, 1);
    // Try to get images on user1 as user2
    ctx = webda.newContext({
      "type": "CRUD",
      "uuid": "PLOP"
    });
    error = false;
    ctx.session.userId = user2.uuid;
    let executor = webda.getExecutor(ctx, "test.webda.io", "GET", exposePath + "/users/" + user1.uuid + "/" + map + "/0");
    return executor.execute(ctx);
  }).catch(function(err) {
    error = err;
  }).then(function() {
    assert.equal(error, 403);
    ctx.session.userId = user1.uuid;
    let executor = webda.getExecutor(ctx, "test.webda.io", "GET", exposePath + "/users/" + user1.uuid + "/" + map + "/0");
    return executor.execute(ctx);
  }).then(function() {
    // We dont check for result as FileBinary will return datas and S3 a redirect
    if (fs.existsSync('./downloadTo.tmp')) {
      fs.unlinkSync('./downloadTo.tmp');
    }
    return binary.downloadTo(user1[map][0], './downloadTo.tmp');
  }).then(function() {
    // Check the result is the same
    assert.equal(fs.readFileSync('./downloadTo.tmp').toString(), fs.readFileSync('./test/Dockerfile').toString());
    return userStore.delete(user1.uuid);
  }).then(function() {
    return binary.getUsageCount(hash);
  }).then(function(value) {
    assert.equal(value, 0);
    return Promise.resolve();
  });
}

var notMapped = function(userStore, binary) {
  var exception = false;
  return userStore.save({
    "test": "plop"
  }).then(function(user1) {
    return binary.store(userStore, user1, 'images2', {
      'path': './test/Dockerfile'
    }, {});
  }).catch(function(err) {
    exception = true;
  }).then(function() {
    assert.equal(exception, true, 'Should have not succeed');
  });
}

var update = function(userStore, binary, map) {
  var user1;
  var user;
  let hash;
  return userStore.save({
    "test": "plop"
  }).then(function(user) {
    user1 = user;
    return binary.store(userStore, user1, map, {
      'path': './test/Dockerfile'
    }, {});
  }).then(function() {
    return userStore.get(user1.uuid);
  }).then(function(userArg) {
    user = userArg;
    assert.notEqual(user[map], undefined);
    assert.equal(user[map].length, 1);
    return binary.getUsageCount(user[map][0].hash);
  }).then(function(value) {
    assert.equal(value, 1);
    return binary.update(userStore, user, map, 0, {
      'path': './test/Dockerfile.txt'
    }, {});
  }).then(function() {
    return userStore.get(user1.uuid);
  }).then(function(userArg) {
    user = userArg;
    assert.notEqual(user[map], undefined);
    assert.equal(user[map].length, 1);
    assert.notEqual(hash, user[map][0].hash);
    assert.equal(user[map][0].mimetype, 'text/plain');
    assert.equal(user[map][0].name, 'Dockerfile.txt');
    return binary.getUsageCount(hash);
  }).then(function(value) {
    assert.equal(value, 0);
    return binary.getUsageCount(user[map][0].hash)
  }).then(function(value) {
    assert.equal(value, 1);
  });
}

describe('Binary', function() {
  var webda;
  var binary;
  var userStore;
  var skipS3;
  before(function() {
    skipS3 = process.env["WEBDA_AWS_TEST"] === undefined;
    if (skipS3) {
      console.log("Not running S3Binary test as no AWS env found");
    }
  });
  beforeEach(function() {
    webda = new Webda(config);
  });
  describe('Binary', function() {
    const Binary = require('../services/binary');
    var service = new Binary();

    it('abstract', function() {

      assert.throws(service.store, Error);
      assert.throws(service.getUsageCount, Error);
      assert.throws(service.update, Error);
      assert.throws(service.delete, Error);

    })

  });
  describe('FileBinary', function() {
    beforeEach(function() {
      userStore = webda.getService("Users");
      binary = webda.getService("binary");
      assert.notEqual(userStore, undefined);
      assert.notEqual(binary, undefined);
      return userStore.__clean().then(function() {
        return binary.__clean();
      });
    });
    it('normal', function() {
      return normal(userStore, binary, 'images', webda, '/binary');
    });
    it('not-mapped', function() {
      return notMapped(userStore, binary);
    });
    it('update', function() {
      return update(userStore, binary, 'images');
    });
  });
  describe('S3Binary', function() {
    beforeEach(function() {
      if (skipS3) {
        return;
      }
      userStore = webda.getService("users");
      binary = webda.getService("s3binary");
      assert.notEqual(userStore, undefined);
      assert.notEqual(binary, undefined);
      return userStore.__clean().then(function() {
        return binary.__clean();
      });
    });
    it('normal', function() {
      if (skipS3) {
        this.skip();
        return;
      }
      return normal(userStore, binary, 's3images', webda, '/s3binary');
    });
    it('not-mapped', function() {
      if (skipS3) {
        this.skip();
        return;
      }
      return notMapped(userStore, binary);
    });
    it('update', function() {
      if (skipS3) {
        this.skip();
        return;
      }
      return update(userStore, binary, 's3images');
    });
    it('getARN', function() {
      if (skipS3) {
        this.skip();
        return;
      }
      assert.equal(binary.getARNPolicy().Resource[0], 'arn:aws:s3:::webda-test');
    })
  });
  describe('challenge()', function() {
    it('_isValidChallenge', function() {
      binary = webda.getService("binary");
      assert.equal(binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e8157980"), true);
      assert.equal(binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798G"), false);
      assert.equal(binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798"), false);
      assert.equal(binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798."), false);
    });
  });
});
