module.exports = {
  plugins: {
    'postcss-pxtorem': {
      rootValue: 16,
      unitPrecision: 5,
      propList: ['*'],
      replace: true,
      mediaQuery: true,
      minPixelValue: 2,
      exclude: /node_modules/i,
    },
  },
};
