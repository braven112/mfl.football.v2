// PostCSS config: combines files via postcss-import, adds autoprefixer and cssnano in production.
module.exports = {
  plugins: [
    require('postcss-import'),
    require('autoprefixer'),
    // Minify in production
    ...(process.env.NODE_ENV === 'production' ? [require('cssnano')({ preset: 'default' })] : [])
  ]
};
