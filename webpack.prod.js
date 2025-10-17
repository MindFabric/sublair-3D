const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = merge(common, {
    mode: 'production',
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        // Remove specific console methods, keep error and warn
                        pure_funcs: [
                            'console.log',
                            'console.debug',
                            'console.info',
                            'console.trace'
                        ]
                    },
                    format: {
                        comments: false, // Remove comments
                    },
                },
                extractComments: false, // Don't extract comments to separate file
            }),
        ],
    },
    plugins: [
        new webpack.BannerPlugin({
          banner:
          `Sketchbook 0.4 (https://github.com/swift502/Sketchbook)\nBuilt on three.js (https://github.com/mrdoob/three.js) and cannon.js (https://github.com/schteppe/cannon.js)`,
        }),
    ]
});