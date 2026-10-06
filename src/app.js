const fs = require('fs');
const path = require('path');
const Koa = require('koa');
const cors = require('koa-cors');
const graphqlHTTP = require('koa-graphql');
const convert = require('koa-convert');

const schema = require('./schema');

const app = new Koa();
const PORT = process.env.PORT || 5000;

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

app.use(convert(cors()));

// Tiny static file handler for the demo page in /content (no extra deps).
app.use(async (ctx, next) => {
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    return next();
  }

  let relativePath = null;

  if (ctx.path === '/' || ctx.path === '/index.html') {
    relativePath = 'index.html';
  } else if (ctx.path.startsWith('/content/')) {
    relativePath = ctx.path.slice('/content/'.length);
  }

  if (!relativePath || relativePath.indexOf('..') !== -1) {
    return next();
  }

  const filePath = path.join(CONTENT_DIR, relativePath);

  if (!filePath.startsWith(CONTENT_DIR) || !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()) {
    return next();
  }

  ctx.type = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  ctx.body = fs.createReadStream(filePath);
  return undefined;
});

app.use(convert(graphqlHTTP(async () => ({
  graphiql: true,
  schema,
  formatError: ({ message, locations, stack }) => ({
    message,
    locations,
    stack,
  }),
}))));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GraphQL-Pokemon started on http://localhost:${PORT}/`);
  });
}

module.exports = app;
