'use strict';

const asyncFn = require('promise-toolbox/asyncFn');
const defer = require('golike-defer').default;
const finished = require('readable-stream').finished;
const fromCallback = require('promise-toolbox/fromCallback');
const fs = require('fs');
const getStream = require('get-stream');
const path = require('path');
const t = require('tap');
const TOML = require('@iarna/toml');

const Smb2 = require('../');

const dir = 'smb2-tests-' + Date.now();
const file = dir + '\\file.txt';
const file2 = dir + '\\file2.txt';
const data = Buffer.from(
  Array.from({ length: 1024 }, function() {
    return Math.floor(Math.random() * 256);
  })
);

const tests = {
  mkdir: function(client) {
    return client.mkdir(dir);
  },
  writeFile: function(client) {
    return client.writeFile(file, data);
  },
  readFile: function(client) {
    return client.readFile(file).then(function(result) {
      t.same(result, data);
    });
  },
  statFile: function(client) {
    return client.stat(file).then(function(result) {
      t.same(result.size, data.length);
      t.same(result.isDirectory(), false);
    });
  },
  getSize: function(client) {
    return client.getSize(file).then(function(result) {
      t.same(result, data.length);
    });
  },
  exists: function(client) {
    return client
      .exists(file)
      .then(function(result) {
        t.same(result, true);
        return client.exists(file2);
      })
      .then(function(result) {
        t.same(result, false);
      });
  },
  statDir: function(client) {
    return client.stat(dir).then(function(result) {
      t.same(result.size, 0);
      t.same(result.isDirectory(), true);
    });
  },
  readdir: function(client) {
    return client.readdir(dir).then(function(result) {
      t.same(result.length, 1);
    });
  },
  readdirWithStats: function(client) {
    return client.readdir(dir, { stats: true }).then(function(result) {
      t.same(result.length, 1);
      t.same(result[0].name, 'file.txt');
      t.same(result[0].size, data.length);
      t.same(result[0].isDirectory(), false);
    });
  },
  rename: function(client) {
    return client
      .rename(file, file2)
      .then(function() {
        return client.readdir(dir);
      })
      .then(function(result) {
        t.same(result.length, 1);
        t.same(result[0], 'file2.txt');
      })
      .then(function() {
        return client.rename(file2, file);
      })
      .then(function() {
        return client.readdir(dir);
      })
      .then(function(result) {
        t.same(result.length, 1);
        t.same(result[0], 'file.txt');
      });
  },
  truncate: function(client) {
    return client
      .truncate(file, 10)
      .then(function() {
        return client.stat(file);
      })
      .then(function(result) {
        t.same(result.size, 10);
      });
  },
  unlink: function(client) {
    return client.unlink(file);
  },
  'open new file and write': asyncFn(function*(client) {
    var fd = yield client.open(file, 'w');
    try {
      t.same(yield client.write(fd, data, undefined, undefined, 0), {
        bytesWritten: data.length,
        buffer: data,
      });
    } finally {
      yield client.close(fd);
    }
    fd = yield client.open(file, 'r');
    try {
      try {
        t.same(yield client.read(fd, Buffer.alloc(1024), 0, 1024, 0), {
          bytesRead: data.length,
          buffer: data,
        });
      } finally {
        yield client.close(fd);
      }
      t.same(yield client.readFile(file), data);
    } finally {
      yield client.unlink(file);
    }
  }),
  createReadStream: defer(
    asyncFn(function*($d, client) {
      yield client.writeFile(file, data);
      $d.call(client, 'unlink', file);
      const fd = yield client.open(file, 'r');
      $d.call(client, 'close', fd);

      const readStream = yield client.createReadStream('', {
        autoClose: false,
        fd,
      });
      t.same(yield getStream.buffer(readStream), data);
      t.same(readStream.fileSize, data.length);
    })
  ),
  createWriteStream: defer(
    asyncFn(function*($d, client) {
      const fd = yield client.open(file, 'w');
      $d.call(client, 'unlink', file);
      $d.call(client, 'close', fd);

      const stream = yield client.createWriteStream('', {
        autoClose: false,
        fd,
      });
      yield fromCallback(cb => {
        finished(stream, cb);
        stream.end(data);
      });

      t.same(yield client.readFile(file), data);
    })
  ),
  rmdir: function(client) {
    return client.rmdir(dir);
  },
};

asyncFn(function*() {
  const options = TOML.parse(
    fs.readFileSync(path.join(__dirname, 'config.toml'))
  );
  options.autoCloseTimeout = 2000;
  const client = new Smb2(options);
  try {
    let result;
    for (const name of Object.keys(tests)) {
      result = yield t.test(name, function() {
        return tests[name](client, result);
      });
    }
  } finally {
    yield client.disconnect();
  }
})().catch(t.threw);
