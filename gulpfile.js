const concat = require('gulp-concat');
const dartSass = require('sass');
const del = require('del');
const fs = require('fs');
const gulpSass = require('gulp-sass');
const jsdoc2md = require("jsdoc-to-markdown");
const lazypipe = require('lazypipe');
const less = require('gulp-less');
const path = require('path');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const sass = gulpSass(dartSass);
const strip = require('gulp-strip-comments');
const uglify = require('gulp-uglify');
const uglifycss = require('gulp-uglifycss');
const wrapper = require('@risadams/gulp-wrapper');

const { resolve } = require('path');
const { readdir } = require('fs').promises;

const { src, dest, series, watch, parallel } = require('gulp');


// ----------------------------------------
// Internal task definitions
// ----------------------------------------
const cleanLibs = async () => del('dist/**/*');
const loadDependencies = async () => true;
const copyDependencies = async () => true;
const copySrc = async () => {

  let scripts = [
    'src/contrib/*.js',
    'src/constants.js',
    'src/utils.js',
    'src/selectize.js',
    'src/defaults.js',
    'src/selectize.jquery.js'
  ];

  // Add in all plugin scripts in a predictable order
  fs.readdirSync('src/plugins').sort().forEach((file) => {
    scripts.push(`src/plugins/${file}/plugin.js`);
  });

  setTimeout(async () => {
    await _compileLess();
    await _compileSass();
    await _compileJavascript(scripts);
    await _minifyScripts(scripts);
  }, 1000);
};
const watchFiles = async () => watch(['src/**/*.{js,css,less,scss}']).on('change', series(loadDependencies, copyDependencies, copySrc, generateJsDoc, forwardToDocs));
const forwardToDocs = async () => {
  setTimeout(async () => {
    src(['dist/css/**/*']).pipe(dest('docs/static/css'));
    src(['dist/js/**/*']).pipe(dest('docs/static/js'));
  }, 1500);
}
const generateJsDoc = async () => {
  (async () => {
    for await (const file of getFiles('src')) {
      if (path.extname(file) === '.js') {
        let basename = path.basename(file, '.js');
        if (basename === 'plugin') basename = `${path.dirname(file).split(path.sep).pop()} Plugin`;

        const output = `docs/docs/API/${basename}.mdx`;
        const toAdd = `---
title: ${basename}
description: API Reference for ${basename}
---
# API Documentation for ${basename}\n`;

        const data = await jsdoc2md.render({
          files: file,
          "no-gfm": false,
          "global-index-format": "none",
          "module-index-format": "none",
        });

        const sanatizedData = toAdd + data;
        fs.writeFileSync(output, sanatizedData);
      }
    }
  })();
}
// ----------------------------------------


// Helper methods and constants
const getYear = () => new Date().getFullYear();
const getVersion = () => process.env.npm_package_version;
const renameFileToParentDirName = (filepath) => {
  filepath.basename = path.basename(filepath.dirname);
  filepath.dirname = path.dirname(filepath.dirname);
}

async function* getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* getFiles(res);
    } else {
      yield res;
    }
  }
}

const license_header = `/**
 * Selectize (v@@version)
 * https://selectize.dev
 *
 * Copyright (c) 2013-2015 Brian Reavis & contributors
 * Copyright (c) 2020-@@YEAR Selectize Team & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
 * file except in compliance with the License. You may obtain a copy of the License at:
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 *
 * @author Brian Reavis <brian@thirdroute.com>
 * @author Ris Adams <selectize@risadams.com>
 */
`;

const amd_header = `const jQuery = require('jquery'); const $ = jQuery;
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  } else if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('jquery'));
  } else {
    root.Selectize = factory(root.jQuery);
  }
}(this, function ($) {
  'use strict';
`;

const amd_footer = `
  return Selectize;
}));
`

const __wrapScripts = lazypipe()
  .pipe(wrapper, {
    header: amd_header,
    footer: amd_footer
  })
  .pipe(strip, { trim: true })
  .pipe(wrapper, { header: license_header })
  .pipe(replace, /@@YEAR/g, getYear())
  .pipe(replace, /@@version/g, getVersion())
  ;

const __wrapStyles = lazypipe()
//  .pipe(uglifycss)
  .pipe(wrapper, { header: license_header })
  .pipe(replace, /@@YEAR/g, getYear())
  .pipe(replace, /@@version/g, getVersion())
  ;


// ----------------------------------------
// task internals

const _compileLess = async () => {
  src(['src/less/**.less']).pipe(dest('dist/less'));
  src(['src/plugins/**/*.less']).pipe(rename(renameFileToParentDirName)).pipe(dest('dist/less/plugins'));

  let plugin_styles = [];

  // Add in all plugin styles in a predictable order
  fs.readdirSync('src/plugins').sort().forEach((file) => {
    const path = `src/plugins/${file}/plugin.less`;
    if (fs.existsSync(path)) {
      plugin_styles.push(path);
    }
  });

}

const _compileSass = async () => {
  src(['src/scss/**.scss'])
    .pipe(replace(/\.\.\/plugins\/(.+)\/plugin.scss/g, 'plugins/$1.scss')) // fix relative paths GH#1886
    .pipe(dest('dist/scss'));
  src(['src/plugins/**/*.scss']).pipe(rename(renameFileToParentDirName)).pipe(dest('dist/scss/plugins'));

  let plugin_styles = [];

  // Add in all plugin styles in a predictable order
  fs.readdirSync('src/plugins').sort().forEach((file) => {
    const path = `src/plugins/${file}/plugin.scss`;
    if (fs.existsSync(path)) {
      plugin_styles.push(path);
    }
  });

  src(['src/scss/selectize.scss', ...plugin_styles])
    .pipe(concat('selectize.css'))
    .pipe(sass({
      includePaths: ['node_modules', 'src/scss'],
      silenceDeprecations: ['legacy-js-api', 'mixed-decls', 'color-functions', 'global-builtin', 'import'],
    }).on('error', sass.logError))
    .pipe(__wrapStyles())
    .pipe(dest('dist/css'));

  src(['src/scss/selectize.default.scss', ...plugin_styles])
    .pipe(concat('selectize.default.css'))
    .pipe(sass({
      includePaths: ['node_modules', 'src/scss'],
      silenceDeprecations: ['legacy-js-api', 'mixed-decls', 'color-functions', 'global-builtin', 'import'],
    }).on('error', sass.logError))
    .pipe(__wrapStyles())
    .pipe(dest('dist/css'));

  // build the bootstrap base sccss styles
  src(['src/scss/selectize.bootstrap.scss', ...plugin_styles])
    .pipe(concat('selectize.bootstrap.css'))
    .pipe(sass({
      includePaths: ['node_modules', 'src/scss'],
      silenceDeprecations: ['legacy-js-api', 'mixed-decls', 'color-functions', 'global-builtin', 'import'],
    }).on('error', sass.logError))
    .pipe(__wrapStyles())
    .pipe(dest('dist/css'));
}

const _compileJavascript = async (scripts) =>
  src(scripts)
    .pipe(concat('selectize.js'))
    .pipe(__wrapScripts())
    .pipe(dest('dist/js'));

const _minifyScripts = async (scripts) =>
  src(scripts)
    .pipe(concat('selectize.min.js'))
    .pipe(uglify())
    .pipe(__wrapScripts())
    .pipe(dest('dist/js'));

// public task definitions
exports.default = series(copyDependencies, copySrc);
exports.docs = parallel(generateJsDoc, forwardToDocs);
exports.loadDependencies = series(cleanLibs, loadDependencies);
exports.watch = series(watchFiles);
