import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'index.js',
  output: {
    dir: 'dist',
    format: 'cjs',
    exports: 'auto'
  },
  plugins: [commonjs({
      ignore: ['@actions/core', '@actions/github']
  })],
};
