'use strict';
var Promise = require('bluebird');
var fs = require("fs");
var fsextra = require("fs-extra");
var extract = require('extract-zip')
var config    = require('../config');
var _ = require('lodash');
var common = {};
var AppError = require('../app-error');
var log4js = require('log4js');
var log = log4js.getLogger("cps:utils:common");
module.exports = common;

common.createFileFromRequest = function (url, filePath) {
  return new Promise((resolve, reject) => {
    fs.exists(filePath, function (exists) {
      if (!exists) {
        var request = require('request');
        request(url).on('error', function (error) {
          reject(error);
        })
        .on('response', function (response) {
          if (response.statusCode == 200) {
            let stream = fs.createWriteStream(filePath);
            response.pipe(stream);
            stream.on('close',function(){
              resolve(null);
            });
            stream.on('error', function (error) {
              reject(error)
            })
          } else {
            reject({message:'request fail'})
          }
        });
      }else {
        resolve(null);
      }
    });
  });
}

common.move = function (sourceDst, targertDst) {
  return new Promise((resolve, reject) => {
    fsextra.move(sourceDst, targertDst, {clobber: true, limit: 16}, function (err) {
      if (err) {
        log.error(err);
        reject(err);
      } else {
        log.debug(`move success sourceDst:${sourceDst} targertDst:${targertDst}`);
        resolve();
      }
    });
  });
};

common.deleteFolder = function (folderPath) {
  return new Promise((resolve, reject) => {
    fsextra.remove(folderPath, function (err) {
      if (err) {
        log.error(err);
        reject(err);
      }else {
        log.debug(`deleteFolder delete ${folderPath} success.`);
        resolve(null);
      }
    });
  });
};

common.deleteFolderSync = function (folderPath) {
  return fsextra.removeSync(folderPath);
};

common.createEmptyFolder = function (folderPath) {
  return new Promise((resolve, reject) => {
    log.debug(`createEmptyFolder Create dir ${folderPath}`);
    return common.deleteFolder(folderPath)
    .then((data) => {
      fsextra.mkdirs(folderPath, (err) => {
        if (err) {
          log.error(err);
          reject(new AppError.AppError(err.message));
        } else {
          resolve(folderPath);
        }
      });
    });
  });
};

common.createEmptyFolderSync = function (folderPath) {
  common.deleteFolderSync(folderPath);
  return fsextra.mkdirsSync(folderPath);
};

common.unzipFile = function (zipFile, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      log.debug(`unzipFile check zipFile ${zipFile} fs.R_OK`);
      fs.accessSync(zipFile, fs.R_OK);
      log.debug(`Pass unzipFile file ${zipFile}`);
    } catch (e) {
      log.error(e);
      return reject(new AppError.AppError(e.message))
    }
    extract(zipFile, {dir: outputPath}, function(err){
      if (err) {
        log.error(err);
        reject(new AppError.AppError(`it's not a zipFile`))
      } else {
        log.debug(`unzipFile success`);
        resolve(outputPath);
      }
    });
  });
};

common.uptoken = function (bucket, key) {
  var putPolicy = new qiniu.rs.PutPolicy(bucket+":"+key);
  return putPolicy.token();
};

common.uploadFileToStorage = function (key, filePath) {
  if (_.get(config, 'common.storageType') === 'local') {
    return common.uploadFileToLocal(key, filePath);
  }
};

common.uploadFileToLocal = function (key, filePath) {
  return new Promise((resolve, reject) => {
    var storageDir = _.get(config, 'local.storageDir');
    if (!storageDir) {
      throw new AppError.AppError('please set config local storageDir');
    }
    if (key.length < 3) {
      log.error(`generate key is too short, key value:${key}`);
      throw new AppError.AppError('generate key is too short.');
    }
    try {
      log.debug(`uploadFileToLocal check directory ${storageDir} fs.R_OK`);
      fs.accessSync(storageDir, fs.W_OK);
      log.debug(`uploadFileToLocal directory ${storageDir} fs.R_OK is ok`);
    } catch (e) {
      log.error(e);
      throw new AppError.AppError(e.message);
    }
    var subDir = key.substr(0, 2).toLowerCase();
    var finalDir = `${storageDir}/${subDir}`;
    var fileName = `${finalDir}/${key}`;
    if (fs.existsSync(fileName)) {
      return resolve(key);
    }
    var stats = fs.statSync(storageDir);
    if (!stats.isDirectory()) {
      var e = new AppError.AppError(`${storageDir} must be directory`);
      log.error(e);
      throw e;
    }
    if (!fs.existsSync(`${finalDir}`)) {
      fs.mkdirSync(`${finalDir}`);
      log.debug(`uploadFileToLocal mkdir:${finalDir}`);
    }
    try {
     fs.accessSync(filePath, fs.R_OK);
    } catch (e) {
      log.error(e);
      throw new AppError.AppError(e.message);
    }
    stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      var e = new AppError.AppError(`${filePath} must be file`);
      log.debug(e);
      throw e;
    }
    fsextra.copy(filePath, fileName,(err) => {
      if (err) {
        log.error(new AppError.AppError(err.message));
        return reject(new AppError.AppError(err.message));
      }
      log.debug(`uploadFileToLocal copy file ${key} success.`);
      resolve(key);
    });
  });
};

common.getBlobDownloadUrl = function (blobUrl) {
  var downloadUrl = '';
  var fileName = blobUrl;
  if (_.get(config, 'common.storageType') === 'local') {
    downloadUrl = _.get(config, 'local.downloadUrl');
    fileName = blobUrl.substr(0, 2).toLowerCase() + '/' + blobUrl;
  } else if (_.get(config, 'common.storageType') === 's3') {
    downloadUrl = _.get(config, 's3.downloadUrl');
  } else if (_.get(config, 'common.storageType') === 'oss') {
    downloadUrl = _.get(config, 'oss.downloadUrl');
  }
  return `${downloadUrl}/${fileName}`
};


common.diffCollectionsSync = function (collection1, collection2) {
  var diffFiles = [];
  var collection1Only = [];
  var newCollection2 = Object.assign({}, collection2);
  if (collection1 instanceof Object) {
    for(var key of Object.keys(collection1)) {
      if (_.isEmpty(newCollection2[key])) {
        collection1Only.push(key);
      } else {
        if (!_.eq(collection1[key], newCollection2[key])) {
          diffFiles.push(key);
        }
        delete newCollection2[key];
      }
    }
  }
  return {diff:diffFiles, collection1Only: collection1Only, collection2Only: Object.keys(newCollection2)}
};
