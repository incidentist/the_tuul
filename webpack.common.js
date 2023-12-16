var path = require("path");
var webpack = require("webpack");
var BundleTracker = require('webpack-bundle-tracker');
const { VueLoaderPlugin } = require('vue-loader');

module.exports = {
    context: __dirname,

    entry: './frontend/index.ts',

    output: {
        path: path.resolve('./api/assets/bundles/'),
        filename: "[name]-[contenthash].js",
        hashFunction: "xxhash64",
        clean: true
    },

    plugins: [
        new VueLoaderPlugin(),
        new BundleTracker({
            path: path.join(__dirname, 'api'),
            filename: 'webpack-stats.json',
        }),
        new webpack.ProvidePlugin({
            Vue: 'Vue'
        }),
        new webpack.EnvironmentPlugin({ 'API_HOSTNAME': "" })
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
        {
            test: /\.tsx?$/,
            loader: "ts-loader",
            options: { appendTsSuffixTo: [/\.vue$/] },
            exclude: /node_modules/,
        },

        ]
    },
    resolve: {
        extensions: ['.js', '.vue', '.ts', '.tsx'],
        alias: {
            'vue$': 'vue/dist/vue.esm.js',
            '@': path.resolve(__dirname, 'frontend')
        }
    }
};