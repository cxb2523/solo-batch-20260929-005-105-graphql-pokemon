#!/usr/bin/env node
/**
 * Schema artifact generator.
 *
 * 业务源码仍是 ESM（Babel 转译）；为了让验收命令 `node scripts/buildSchema.js`
 * 无需 babel-node 也能直接运行，这里在入口先注册 babel-register / polyfill，
 * 再 require 业务模块。重复执行输出必须字节级一致（无漂移）。
 */
require('babel-polyfill');
require('babel-register');

const fs = require('fs');
const path = require('path');
const graphql = require('graphql').graphql;
const introspectionQuery = require('graphql/utilities').introspectionQuery;
const printSchema = require('graphql/utilities').printSchema;

const GraphQLSchema = require('../src/schema').default;

async function generateSchema(schema, relativePath) {
  const result = await graphql(schema, introspectionQuery);

  if (result.errors) {
    console.error(
      'ERROR introspecting schema: ',
      JSON.stringify(result.errors, null, 2)
    );
    process.exitCode = 1;
  } else {
    fs.writeFileSync(
      path.join(__dirname, `${relativePath}/schema.json`),
      JSON.stringify(result, null, 2)
    );

    fs.writeFileSync(
      path.join(__dirname, `${relativePath}/schema.graphql`),
      printSchema(schema)
    );
  }
}

(async () => {
  await generateSchema(GraphQLSchema, '../schemas');

  process.exit(0);
})();
