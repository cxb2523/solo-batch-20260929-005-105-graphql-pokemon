#!/usr/bin/env node
// 入口引导：业务源码使用 ESM（Babel 转译），这里先注册 babel-register / polyfill，
// 使 `node src/app.js` 可直接启动服务，无需 babel-node。
require('babel-polyfill');
require('babel-register');

const path = require('path');
const fs = require('fs');
const Koa = require('koa').default || require('koa');
const cors = require('koa-cors').default || require('koa-cors');
const graphqlHTTP = require('koa-graphql').default || require('koa-graphql');
const convert = require('koa-convert').default || require('koa-convert');

const schema = require('./schema').default;

const app = new Koa();
const contentDir = path.join(__dirname, '..', 'content');
const indexPagePath = path.join(contentDir, 'index.html');

// 录屏用的静态小页：GET / 返回填参即查的页面。
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && (ctx.path === '/' || ctx.path === '/index.html')) {
    ctx.type = 'html';
    ctx.body = fs.createReadStream(indexPagePath);
    return;
  }
  await next();
});

app
  .use(convert(cors()))
  .use(convert(graphqlHTTP(async () => ({
    graphiql: true,
    schema,
    formatError: ({ message, locations, stack }) => ({
      message,
      locations,
      stack,
    }),
  }))));

// 作为模块被 require 时只导出 app（测试在进程内起服务）；
// 直接 `node src/app.js` 运行时才监听端口。
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`GraphQL-Pokemon started on http://localhost:${PORT}/`);
  });
}

module.exports = app;
module.exports.default = app;
