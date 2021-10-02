var path = require("path");
var webpack = require("webpack");
var BundleTracker = require('webpack-bundle-tracker');
const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = {
    context: __dirname,

    entry: './frontend/index.js',

    output: {
        path: path.resolve('./api/assets/bundles/'),
        filename: "[name]-[contenthash].js",
        clean: true
    },

    plugins: [
        new VueLoaderPlugin(),
        new BundleTracker({
            filename: './webpack-stats.json'
        }),
        new webpack.ProvidePlugin({
            Vue: 'Vue'
        }),
    ],
    module: {
        rules: [{
                test: /\.vue$/,
                loader: 'vue-loader'
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
        ]
    },
    resolve: {
        extensions: ['.js', '.vue'],
        alias: {
            'vue$': 'vue/dist/vue.esm.js',
            '@': path.resolve(__dirname, 'frontend')
        }
    }
};