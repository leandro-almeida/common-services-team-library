const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const {v4: uuidv4} = require('uuid');

class FileCache {

  constructor(options) {
    this._cachePath = (options && options.fileCachePath) || process.env.FILE_CACHE_PATH || fs.realpathSync(os.tmpdir());
    // ensure no trailing path separator.
    if (this._cachePath.endsWith(path.sep)) {
      this._cachePath = this._cachePath.slice(0, -1);
    }

    try {
      fs.ensureDirSync(this._cachePath);
    } catch (e) {
      throw new Error(`Could not access cache directory '${this._cachePath}'.`);
    }
    //private helper functions.
    this._getHash = async (file) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file);
      return new Promise((resolve, reject) => {
        stream.on('readable', () => {
          let chunk;
          while (null !== (chunk = stream.read())) {
            hash.update(chunk);
          }
        });
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', error => reject(error));
      });
    };
    this._getHashPath = hash => `${this._cachePath}${path.sep}${hash}`;
    this._getTempFilePath = () => `${this._cachePath}${path.sep}${uuidv4()}`;
  }

  find(hash) {
    const result = {
      success: false,
      errorType: null,
      errorMsg: null,
      hash: null,
      name: null,
      ext: null,
      dir: null,
      path: null
    };
    if (!hash) {
      result.errorType = 400;
      result.errorMsg = 'Cannot find file; hash parameter is required.';
      return result;
    }

    try {
      const hashPath = this._getHashPath(hash);

      if (!fs.existsSync(hashPath)) {
        result.errorType = 404;
        result.errorMsg = `Hash '${hash}' not found.`;
        return result;
      }
      result.hash = hash;

      const files = fs.readdirSync(hashPath);
      if (!files || files.length !== 1) {
        result.errorType = 404;
        result.errorMsg = 'Hash found; could not read file from cache.';
        return result;
      } else {
        result.name = files[0];
        result.ext = path.extname(result.name).slice(1);
        result.dir = hashPath;
        result.path = `${hashPath}${path.sep}${result.name}`;
        result.success = true;
        return result;
      }
    } catch (e) {
      result.errorType = 500;
      result.errorMsg = `Unknown error getting file for hash '${hash}'.`;
      return result;
    }
  }

  async read(hash) {
    const file = this.find(hash);
    if (file.success) {
      return await fs.readFile(file.path);
    } else {
      throw Error(file.errorMsg);
    }
  }

  async move(source, name, options = {overwrite: false}) {
    const result = {success: false, errorType: null, errorMsg: null, hash: null};

    if (!source) {
      result.errorType = 400;
      result.errorMsg = 'Cannot move file; source parameter is required.';
      return result;
    }
    if (!name) {
      result.errorType = 400;
      result.errorMsg = 'Cannot move file; name parameter is required.';
      return result;
    }

    try {
      result.hash = await this._getHash(source);
    } catch (e) {
      result.errorType = 500;
      result.errorMsg = `Error creating hash for file '${source}'.`;
      return result;
    }

    const hashPath = this._getHashPath(result.hash);
    if (fs.existsSync(hashPath)) {
      if (options.overwrite) {
        await fs.remove(hashPath);
      } else {
        result.errorType = 405;
        result.errorMsg = `File already cached. Hash '${result.hash}'.`;
        return result;
      }
    }

    const dest = `${hashPath}${path.sep}${name}`;
    fs.ensureDirSync(hashPath);
    try {
      await fs.move(source, dest, options);
      result.success = await fs.existsSync(dest);
    } catch (e) {
      result.errorType = 500;
      result.errorMsg = 'Error moving file to cache.';
    }
    return result;
  }

  async remove(hash) {
    const result = {success: false, errorType: null, errorMsg: null};
    const file = this.find(hash);
    if (file.success) {
      await fs.remove(file.dir);
      result.success = !fs.existsSync(file.dir);
    } else {
      result.errorType = 404;
      result.errorMsg = `Could not remove file. Hash '${hash}', not found.`;
    }
    return result;
  }

  async write(content, name, contentEncodingType = 'base64', options = {overwrite: false}) {
    let result = {success: false, errorType: null, errorMsg: null, hash: null};

    if (!content) {
      result.errorType = 400;
      result.errorMsg = 'Cannot write file; content parameter is required.';
      return result;
    }
    if (!name) {
      result.errorType = 400;
      result.errorMsg = 'Cannot write file; name parameter is required.';
      return result;
    }
    const tmpFile = this._getTempFilePath();
    await fs.outputFile(tmpFile, content, {encoding: contentEncodingType});

    // name may only be an extension, if that is the case, let's generate a name
    let destFilename = path.extname(name) === '' ? path.format({
      name: uuidv4(),
      ext: (name.startsWith('.') ? name : `.${name}`)
    }) : name;
    result = await this.move(tmpFile, destFilename, options);
    if (!result.success) {
      result.errorMsg = `Error writing content to cache. ${result.errorMsg}`;
    }
    return result;
  }
}

module.exports = FileCache;
