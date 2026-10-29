// リポジトリ直下から pm2 start ecosystem.config.cjs で起動する。
module.exports = {
  apps: [
    {
      name: 'kosuzu',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      env: { NODE_ENV: 'production' },
      out_file: 'logs/kosuzu-out.log',
      error_file: 'logs/kosuzu-error.log',
      merge_logs: true,
    },
  ],
};
