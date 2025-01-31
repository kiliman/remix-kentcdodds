module.exports = {
  apps: [
    {
      name: 'Express',
      script: 'ts-node -r ./mocks/index.ts start.js',
      // uncomment this if you want to skip the local mocks
      // script: 'node start.js',
      watch: ['remix.config.js', 'app', 'mocks'],
      watch_options: {
        followSymlinks: false,
      },
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'Remix',
      // ignoring the error output because of circular deps with the compile-mdx stuff
      script: 'remix run 2> /dev/null',
      // script: 'remix run',
      ignore_watch: ['.'],
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
}
